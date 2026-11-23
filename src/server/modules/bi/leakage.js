import { createApprovalEngine } from '../../platform/approvals/index.js';
import { accountabilityOf } from '../../platform/accountability/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { assertPermissionAnywhere, hasPermissionAnywhere } from '../../platform/auth/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { transaction } from '../../platform/db/index.js';
import { eventTypes, publishEvent } from '../../platform/events/index.js';
import { FORMATS, writeExport } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { tasksOf } from '../../platform/tasks/index.js';
import { widgetRegistry } from '../../platform/widgets/index.js';
import { workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { amountOf } from '../bill/clientbill.js';
import { createFlagService } from '../core/feature-flags/service.js';
import { registerProject360Widget } from '../proj/p360.js';
import { requireMetricCatalogueSource } from './domain-metrics.js';

/**
 * Part 27.09 — wastage, leakage and duplication detection, and the protocol control tower.
 *
 * A library of detection rules (FR-01) reads the owners' records (accounts payable, payments, purchase orders, material reconciliation, fuel,
 * attendance, plant logs and hire, stock ledger, DPRs and measurements, the workflow engine, the 04.04 control engine) and raises one finding
 * per piece of evidence (`det_findings`, deduplicated): evidence, value at risk, an owner found through the RACI of 04.05 (then the project
 * manager, then a holder of the rule's owner role), a task (04.08), a notification and an event (FR-02). Findings are advisory (BR-01): nothing is
 * blocked or penalised, and a finding closes only with an outcome — confirmed loss (with the amount), prevented, or false positive; a false
 * positive goes through the workflow engine to the internal auditor (owner → AUD, section 9). A closed finding is never raised again for the same
 * evidence, and the share of false positives per rule is shown with the rule, so outcomes improve the thresholds (changed only by maker-checker).
 * The tower (FR-03) shows findings by type, project and value, the controls in ENFORCE against OBSERVE, and the exceptions trend.
 */

export const LEAKAGE_FLAG = 'ff.bi.p2709';
export const FP_DOC = 'BI_FINDING_FP';
const RULES_TYPE = 'bi_det_rule_change';
const RUN_JOB = 'bi.detection.run';
export const FINDING_STATUSES = ['OPEN', 'IN_REVIEW', 'PENDING_FP', 'CLOSED'];
export const OUTCOMES = ['CONFIRMED_LOSS', 'PREVENTED', 'FALSE_POSITIVE'];
const SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'];
const DUE_DAYS = { CRITICAL: 3, WARNING: 7, INFO: 14 };
const rs = (p) => Math.round(Number(p ?? 0)) / 100;
const inr = (rupees) => `₹${Number(rupees).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const iso = () => new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const has = (db, t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));

/**
 * The rule library (FR-01). `thresholds` are the defaults (each with its bounds); `process` is the RACI process (04.05) that names the owner;
 * `ownerRole` the role holder used when nobody is accountable.
 */
export const RULES = Object.freeze([
  { code: 'DUP_INVOICE', name: 'Duplicate vendor invoice', module: 'fin', queryRef: 'ap_bills: same vendor and bill number, or same vendor and amount within the window', process: 'VENDOR_PAY', ownerRole: 'ACCMGR', severity: 'CRITICAL',
    thresholds: { days: [3, 0, 60] } },
  { code: 'DUP_PAYMENT', name: 'Duplicate payment', module: 'fin', queryRef: 'pmt_payments: same payee and amount within the window, neither failed', process: 'VENDOR_PAY', ownerRole: 'ACCMGR', severity: 'CRITICAL',
    thresholds: { days: [7, 0, 60] } },
  { code: 'SPLIT_PO', name: 'Purchase orders split below the approval limit', module: 'proc', queryRef: 'proc_purchase_orders: same vendor and project, each below the limit, together above it, within the window', process: 'PO_ISSUE', ownerRole: 'PROCMGR', severity: 'WARNING',
    thresholds: { limit: [500_000, 10_000, 100_000_000], days: [7, 1, 90], minOrders: [2, 2, 20] } },
  { code: 'PO_ABOVE_BENCHMARK', name: 'Purchase order rate above benchmark', module: 'proc', queryRef: 'proc_po_lines: rate above the benchmark rate by more than the percent', process: 'PO_ISSUE', ownerRole: 'PROCMGR', severity: 'WARNING',
    thresholds: { pct: [10, 1, 200] } },
  { code: 'CONSUMPTION_ABOVE_NORM', name: 'Material consumption above norm', module: 'inv', queryRef: 'mrc_lines: wastage over the allowed percent in a monthly material reconciliation (16.10)', process: 'MAT_RECON', ownerRole: 'STOREMGR', severity: 'WARNING',
    thresholds: { minValue: [10_000, 0, 100_000_000] } },
  { code: 'FUEL_ANOMALY', name: 'Fuel anomaly', module: 'plant', queryRef: 'plt_fuel_anomalies: open, submitted or confirmed anomalies (17.04) valued at the issue rate', process: null, ownerRole: 'PLANTMGR', severity: 'WARNING',
    thresholds: { minLitres: [10, 0, 100_000] } },
  { code: 'ATTENDANCE_ANOMALY', name: 'Attendance anomaly (proxy punches)', module: 'hr', queryRef: 'att_anomalies: shared device, selfie mismatch, mock location or impossible travel, repeated for one person in the window', process: 'ATTENDANCE', ownerRole: 'HRMGR', severity: 'WARNING',
    thresholds: { days: [30, 1, 180], minCount: [3, 1, 100], dailyWage: [800, 0, 100_000] } },
  { code: 'IDLE_HIRED_EQUIPMENT', name: 'Idle equipment on hire', module: 'plant', queryRef: 'plt_logs of hired-in equipment (17.06 agreements): idle hours in the window valued at the hire rate', process: null, ownerRole: 'PLANTMGR', severity: 'WARNING',
    thresholds: { days: [30, 1, 180], hours: [16, 1, 1000] } },
  { code: 'STOCK_AGEING', name: 'Stock without movement', module: 'inv', queryRef: 'inv_stock_ledger: a store item with stock and no movement for the days', process: 'STOCK_ADJ', ownerRole: 'STOREMGR', severity: 'INFO',
    thresholds: { days: [180, 30, 1000], minValue: [10_000, 0, 100_000_000] } },
  { code: 'UNBILLED_WORK_AGEING', name: 'Executed work not measured', module: 'bill', queryRef: 'site_dpr_work of approved DPRs older than the days with no measurement-book entry, valued at the BOQ rate', process: 'RA_BILL', ownerRole: 'QS', severity: 'WARNING',
    thresholds: { days: [30, 7, 365], minValue: [10_000, 0, 100_000_000] } },
  { code: 'OVERDUE_APPROVAL', name: 'Approval overdue', module: 'core', queryRef: 'wf_tasks: open approval tasks past their due time by the days', process: null, ownerRole: 'PD', severity: 'INFO',
    thresholds: { days: [3, 1, 60] } },
  { code: 'EMERGENCY_UNREGULARISED', name: 'Emergency purchase not regularised', module: 'eng', queryRef: 'pcs_exceptions: emergency exceptions past their regularise-by date (04.04)', process: 'PO_ISSUE', ownerRole: 'PROCMGR', severity: 'CRITICAL',
    thresholds: { graceDays: [0, 0, 30] } },
  { code: 'REPEATED_EXCEPTIONS', name: 'Repeated control exceptions by one user', module: 'eng', queryRef: 'pcs_exceptions: one person raising at least the count in the window (04.04)', process: null, ownerRole: 'AUD', severity: 'WARNING',
    thresholds: { days: [30, 7, 180], count: [5, 2, 100] } },
].map((r) => Object.freeze(r)));
const ruleOf = (code) => RULES.find((r) => r.code === code);
const defaults = (rule) => Object.fromEntries(Object.entries(rule.thresholds).map(([k, [v]]) => [k, v]));

const findingShape = { type: 'object', required: ['findingNo', 'ruleCode'], properties: { findingNo: { type: 'string' }, ruleCode: { type: 'string' }, status: { type: 'string' }, outcome: { type: 'string' } } };
eventTypes.define({ type: 'bi.finding.raised', version: 1, schema: findingShape, owner: 'bi', description: 'A detection rule raised a leakage finding (part 27.09): data { findingNo, ruleCode, status, valueAtRisk, projectId, owner }.' });
eventTypes.define({ type: 'bi.finding.closed', version: 1, schema: findingShape, owner: 'bi', description: 'A leakage finding was closed with its outcome (confirmed loss, prevented, false positive) (part 27.09).' });
eventTypes.define({ type: 'bi.finding.escalated', version: 1, schema: findingShape, owner: 'bi', description: 'A leakage finding passed its due date and was escalated (part 27.09).' });

/** The settings in force for a company: the latest approved row per rule, else the rule's defaults. */
export function currentRules(db, companyId) {
  const rows = has(db, 'det_rules') ? db.prepare(`SELECT r.* FROM det_rules r WHERE r.company_id = ? AND r.deleted_at IS NULL
    AND r.version = (SELECT MAX(t.version) FROM det_rules t WHERE t.company_id = r.company_id AND t.code = r.code AND t.deleted_at IS NULL)`).all(companyId) : [];
  const byCode = new Map(rows.map((r) => [r.code, r]));
  return RULES.map((rule) => {
    const row = byCode.get(rule.code);
    return { code: rule.code, name: rule.name, module: rule.module, queryRef: rule.queryRef, process: rule.process, ownerRole: rule.ownerRole,
      bounds: Object.fromEntries(Object.entries(rule.thresholds).map(([k, [, lo, hi]]) => [k, { min: lo, max: hi }])),
      thresholds: { ...defaults(rule), ...(row ? JSON.parse(row.threshold_json) : {}) }, severity: row?.severity ?? rule.severity, active: row ? row.active === 1 : true,
      version: row?.version ?? 0, approvedBy: row?.created_by ?? null, approvedAt: row?.created_at ?? null };
  });
}

const contexts = new WeakMap();
const services = new WeakMap();
export const leakageOf = (db) => services.get(db) ?? null;
const contextOf = (db, environment) => contexts.get(db) ?? { db, flags: createFlagService({ db, environment }) };

export function requireLeakage(context, actor) {
  if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, LEAKAGE_FLAG)) throw notFound('The leakage tower is unavailable.');
  requireMetricCatalogueSource(context, actor);
}

/** Maker-checker for a rule change (section 9, standards): the configurator proposes, AUD or CFO approves (never the requester). */
export const leakageApprovalHandlers = (environment) => ({
  [RULES_TYPE]: {
    authorize(db, actor) {
      requireLeakage(contextOf(db, environment), actor);
      if (!hasPermissionAnywhere(actor, 'bi.det_rule.configure') && !hasPermissionAnywhere(actor, 'bi.finding.approve')) throw forbidden('Your role does not decide detection rule changes.');
    },
    apply(db, request, actor) {
      const { code, thresholds, severity, active, baseVersion } = request.payload;
      const current = currentRules(db, request.companyId).find((r) => r.code === code);
      if (!current) throw notFound('That detection rule does not exist.');
      if (current.version !== baseVersion) throw conflict('The rule changed after this request was raised. Raise a new request.');
      const rule = ruleOf(code);
      db.prepare(`INSERT INTO det_rules (company_id, code, name, module, query_ref, threshold_json, severity, active, request_id, version, created_by, source_id, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(request.companyId, code, rule.name, rule.module, rule.queryRef, JSON.stringify(thresholds), severity, active ? 1 : 0, request.id, baseVersion + 1, actor.user, String(request.id), request.reason);
      writeAudit(db, { companyId: request.companyId, entity: 'det_rules', entityId: code, action: 'settings_change', oldValues: { thresholds: current.thresholds, severity: current.severity, active: current.active, version: current.version },
        newValues: { thresholds, severity, active, version: baseVersion + 1, requestId: request.id, requestedBy: request.requestedBy }, actor: actor.user });
    },
  },
});

// section 9: closing a finding as a false positive — the owner sends it, the internal auditor decides
const fpStep = { code: 'AUD', name: 'Internal auditor review of the false positive', type: 'approval', mode: 'single', approvers: [{ kind: 'role', role: 'AUD' }], slaHours: 72, requireAttachment: false, checklist: [], when: null, notify: [], action: null };
const decideWith = (outcome) => (db, { instance, actor, comment }) => leakageOf(db)?.fpDecided(instance, actor, outcome, comment);
workflowTypes.register({
  docType: FP_DOC, label: 'Finding closed as false positive', processOwner: 'AUD', route: (id) => `/bi/leakage?tab=findings&id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM det_findings WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `False positive: ${r.title}`.slice(0, 200), originator: r.requested_by, projectId: r.project_id, siteId: r.site_id } : null; },
  summarise(db, _actor, id) {
    const r = db.prepare('SELECT * FROM det_findings WHERE id = ?').get(Number(id)); if (!r) return null;
    return { fields: [{ label: 'Rule', value: ruleOf(r.rule_code)?.name ?? r.rule_code }, { label: 'Value at risk', value: `₹${rs(r.value_at_risk)}` }, { label: 'Owner', value: r.owner_user ?? r.owner_role ?? '—' }, { label: 'Reason', value: r.resolution ?? '—' }] };
  },
  defaultDefinition: { name: 'False positive: the owner sends it, the internal auditor approves', settings: { resubmit: 'first', distinctApprovers: true }, steps: [fpStep] },
  hooks: { onApproved: decideWith('APPROVED'), onRejected: decideWith('REJECTED'), onReturned: decideWith('RETURNED'), onCancelled: decideWith('CANCELLED') },
});

export function createLeakage(context, { jobs, scheduler, environment }) {
  const { db } = context;
  contexts.set(db, context);
  const authz = authzOf(db);
  const approvals = createApprovalEngine({ db, handlers: leakageApprovalHandlers(environment) });
  const notify = notificationsOf(db);
  const may = (actor, key, projectId = null) => authz.check(actor, key, { companyId: actor.companyId, ...(projectId ? { projectId } : {}) }).allowed;
  const guard = (actor) => requireLeakage(context, actor);
  const audit = (actor, id, action, extra = {}) => writeAudit(db, { companyId: actor.companyId, entity: 'det_findings', entityId: id, action, actor: actor.user ?? 'system', ...extra });

  // ---------------------------------------------------------------- the detectors (FR-01): each returns its hits; nothing is written here
  const siteProject = (siteId) => (siteId ? db.prepare('SELECT org_project_id AS p FROM org_sites WHERE id = ?').get(siteId)?.p ?? null : null);
  const DETECT = {
    DUP_INVOICE(c, t) {
      if (!has(db, 'ap_bills')) return null;
      return db.prepare(`SELECT a.id AS a, b.id AS b, a.doc_no AS an, b.doc_no AS bn, a.bill_no AS abill, b.bill_no AS bbill, a.bill_date AS ad, b.bill_date AS bd, a.total_paise AS at, b.total_paise AS bt,
          b.org_project_id AS p, b.org_site_id AS s, COALESCE(b.payee_name, '') AS payee, UPPER(TRIM(a.bill_no)) = UPPER(TRIM(b.bill_no)) AS sameNo
        FROM ap_bills a JOIN ap_bills b ON b.company_id = a.company_id AND b.partner_id = a.partner_id AND b.id > a.id AND b.deleted_at IS NULL AND b.status NOT IN ('CANCELLED', 'REJECTED')
          AND (UPPER(TRIM(b.bill_no)) = UPPER(TRIM(a.bill_no)) OR (b.total_paise = a.total_paise AND ABS(julianday(b.bill_date) - julianday(a.bill_date)) <= ?))
        WHERE a.company_id = ? AND a.partner_id IS NOT NULL AND a.deleted_at IS NULL AND a.status NOT IN ('CANCELLED', 'REJECTED') ORDER BY b.id LIMIT 500`).all(t.days, c)
        .map((x) => ({ key: `${x.a}:${x.b}`, projectId: x.p, siteId: x.s, entity: 'ap_bills', entityId: x.b, entityRef: x.bn, value: Math.min(x.at, x.bt),
          title: `${x.bn} duplicates ${x.an} (${x.sameNo ? `same invoice ${x.bbill}` : `same amount within ${t.days} days`})${x.payee ? ` — ${x.payee}` : ''}`,
          evidence: { first: { docNo: x.an, billNo: x.abill, date: x.ad, amount: rs(x.at), route: `/finance/ap-bills?id=${x.a}` }, second: { docNo: x.bn, billNo: x.bbill, date: x.bd, amount: rs(x.bt), route: `/finance/ap-bills?id=${x.b}` }, match: x.sameNo ? 'BILL_NO' : 'AMOUNT_DATE', route: `/finance/ap-bills?id=${x.b}` } }));
    },
    DUP_PAYMENT(c, t) {
      if (!has(db, 'pmt_payments')) return null;
      return db.prepare(`SELECT a.id AS a, b.id AS b, a.doc_no AS an, b.doc_no AS bn, a.amount_paise AS amt, COALESCE(a.paid_on, a.released_on, substr(a.created_at, 1, 10)) AS ad, COALESCE(b.paid_on, b.released_on, substr(b.created_at, 1, 10)) AS bd, b.payee_name AS payee
        FROM pmt_payments a JOIN pmt_payments b ON b.company_id = a.company_id AND b.id > a.id AND b.amount_paise = a.amount_paise AND b.deleted_at IS NULL AND b.pay_status NOT IN ('FAILED', 'CANCELLED')
          AND ((a.partner_id IS NOT NULL AND b.partner_id = a.partner_id) OR (a.partner_id IS NULL AND b.partner_id IS NULL AND UPPER(b.payee_name) = UPPER(a.payee_name)))
          AND ABS(julianday(COALESCE(b.paid_on, b.released_on, substr(b.created_at, 1, 10))) - julianday(COALESCE(a.paid_on, a.released_on, substr(a.created_at, 1, 10)))) <= ?
        WHERE a.company_id = ? AND a.deleted_at IS NULL AND a.pay_status NOT IN ('FAILED', 'CANCELLED') AND a.amount_paise > 0 ORDER BY b.id LIMIT 500`).all(t.days, c)
        .map((x) => ({ key: `${x.a}:${x.b}`, projectId: null, siteId: null, entity: 'pmt_payments', entityId: x.b, entityRef: x.bn, value: x.amt, title: `${x.bn} pays ${x.payee ?? 'the same payee'} the same ${inr(rs(x.amt))} as ${x.an}`,
          evidence: { first: { docNo: x.an, date: x.ad, route: `/finance/payments?id=${x.a}` }, second: { docNo: x.bn, date: x.bd, route: `/finance/payments?id=${x.b}` }, amount: rs(x.amt), windowDays: t.days, route: `/finance/payments?id=${x.b}` } }));
    },
    SPLIT_PO(c, t) {
      if (!has(db, 'proc_purchase_orders')) return null;
      const limit = Math.round(t.limit * 100);
      const rows = db.prepare(`SELECT id, doc_no, doc_date, vendor_id, org_project_id AS p, po_site_id AS s, total_amount FROM proc_purchase_orders WHERE company_id = ? AND deleted_at IS NULL
        AND status IN ('SUBMITTED', 'APPROVED') AND total_amount < ? AND doc_date >= ? ORDER BY vendor_id, org_project_id, doc_date, id`).all(c, limit, daysAgo(180));
      const out = []; const groups = new Map();
      for (const r of rows) { const k = `${r.vendor_id}:${r.p}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
      for (const list of groups.values()) {
        let i = 0;
        while (i < list.length) {
          const win = list.filter((x) => x.doc_date >= list[i].doc_date && (Date.parse(x.doc_date) - Date.parse(list[i].doc_date)) / 86_400_000 <= t.days);
          const sum = win.reduce((n, x) => n + x.total_amount, 0);
          if (win.length >= t.minOrders && sum >= limit) {
            out.push({ key: win.map((x) => x.id).join(','), projectId: win[0].p, siteId: win[0].s, entity: 'proc_purchase_orders', entityId: win.at(-1).id, entityRef: win.at(-1).doc_no, value: sum,
              title: `${win.length} orders to one vendor within ${t.days} days, each below ${inr(t.limit)}, together ${inr(rs(sum))}`,
              evidence: { orders: win.map((x) => ({ docNo: x.doc_no, date: x.doc_date, amount: rs(x.total_amount), route: `/proc/purchase-orders?id=${x.id}` })), limit: t.limit, windowDays: t.days, route: `/proc/purchase-orders?id=${win.at(-1).id}` } });
            i += win.length;
          } else i += 1;
        }
      }
      return out;
    },
    PO_ABOVE_BENCHMARK(c, t) {
      if (!has(db, 'proc_po_lines')) return null;
      return db.prepare(`SELECT l.id, l.line_no, l.description, l.qty, l.rate, l.benchmark_rate AS bench, o.id AS po, o.doc_no, o.org_project_id AS p, o.po_site_id AS s FROM proc_po_lines l JOIN proc_purchase_orders o ON o.id = l.po_id
        WHERE o.company_id = ? AND o.deleted_at IS NULL AND l.deleted_at IS NULL AND o.status IN ('SUBMITTED', 'APPROVED') AND l.benchmark_rate > 0 AND l.rate * 100 > l.benchmark_rate * (100 + ?) ORDER BY l.id LIMIT 1000`).all(c, t.pct)
        .map((x) => ({ key: String(x.id), projectId: x.p, siteId: x.s, entity: 'proc_purchase_orders', entityId: x.po, entityRef: `${x.doc_no}/${x.line_no}`, value: Math.round(((x.rate - x.bench) * x.qty) / 1000),
          title: `${x.doc_no} line ${x.line_no} (${x.description}) at ${inr(rs(x.rate))} against a benchmark of ${inr(rs(x.bench))} (+${Math.round(((x.rate - x.bench) * 1000) / x.bench) / 10} %)`,
          evidence: { rate: rs(x.rate), benchmark: rs(x.bench), qty: x.qty / 1000, pct: t.pct, route: `/proc/purchase-orders?id=${x.po}` } }));
    },
    CONSUMPTION_ABOVE_NORM(c, t) {
      if (!has(db, 'mrc_lines')) return null;
      return db.prepare(`SELECT l.id, l.variance, l.avg_rate, l.wastage_pct, l.allowed_wastage_pct, l.theoretical, l.actual, r.id AS rid, r.doc_no, r.period, r.org_project_id AS p, r.org_site_id AS s, i.code AS item, i.name AS itemName
        FROM mrc_lines l JOIN mrc_reconciliations r ON r.id = l.recon_id LEFT JOIN mdm_items i ON i.id = l.item_id
        WHERE r.company_id = ? AND r.deleted_at IS NULL AND l.deleted_at IS NULL AND r.status IN ('SUBMITTED', 'APPROVED') AND l.over_allowed = 1 AND l.variance > 0 ORDER BY l.id LIMIT 1000`).all(c)
        .map((x) => ({ key: String(x.id), projectId: x.p, siteId: x.s, entity: 'mrc_reconciliations', entityId: x.rid, entityRef: `${x.doc_no} ${x.item ?? ''}`.trim(), value: Math.round((x.variance / 1000) * x.avg_rate),
          title: `${x.item ?? 'Material'} ${x.itemName ?? ''} consumed over the norm in ${x.period} (${x.doc_no})`.replace(/\s+/g, ' '),
          evidence: { theoretical: x.theoretical / 1000, actual: x.actual / 1000, excess: x.variance / 1000, wastagePct: x.wastage_pct, allowedPct: x.allowed_wastage_pct, avgRate: rs(x.avg_rate), route: `/inv/reconciliations?id=${x.rid}` } }))
        .filter((f) => f.value >= t.minValue * 100);
    },
    FUEL_ANOMALY(c, t) {
      if (!has(db, 'plt_fuel_anomalies')) return null;
      return db.prepare(`SELECT a.id, a.doc_no, a.rule_code, a.litres_at_risk, a.detected_on, a.org_project_id AS p, a.org_site_id AS s, e.asset_code,
          COALESCE((SELECT rate FROM plt_fuel_issues WHERE id = a.issue_id), (SELECT rate FROM plt_fuel_issues WHERE equipment_id = a.equipment_id AND rate > 0 ORDER BY id DESC LIMIT 1),
            (SELECT rate FROM plt_fuel_issues WHERE tank_id = a.tank_id AND rate > 0 ORDER BY id DESC LIMIT 1), 0) AS rate
        FROM plt_fuel_anomalies a LEFT JOIN plt_equipment e ON e.id = a.equipment_id
        WHERE a.company_id = ? AND a.deleted_at IS NULL AND a.anomaly_status IN ('OPEN', 'SUBMITTED', 'CONFIRMED') AND a.litres_at_risk >= ? ORDER BY a.id LIMIT 1000`).all(c, t.minLitres * 1000)
        .map((x) => ({ key: String(x.id), projectId: x.p, siteId: x.s, entity: 'plt_fuel_anomalies', entityId: x.id, entityRef: x.doc_no, value: Math.round((x.litres_at_risk / 1000) * x.rate),
          title: `${x.doc_no} ${x.rule_code.replace(/_/g, ' ').toLowerCase()}${x.asset_code ? ` on ${x.asset_code}` : ''}: ${x.litres_at_risk / 1000} litres at risk`,
          evidence: { anomaly: x.rule_code, litres: x.litres_at_risk / 1000, ratePerLitre: rs(x.rate), detectedOn: x.detected_on, route: `/plant/fuel-anomalies?id=${x.id}` } }));
    },
    ATTENDANCE_ANOMALY(c, t) {
      if (!has(db, 'att_anomalies')) return null;
      return db.prepare(`SELECT p.person_type AS pt, p.person_id AS pid, COUNT(*) AS n, COUNT(DISTINCT p.work_date) AS days, MIN(p.work_date) AS first, MAX(p.work_date) AS last, MAX(p.punch_site_id) AS s,
          GROUP_CONCAT(DISTINCT a.anomaly_type) AS types
        FROM att_anomalies a JOIN att_punches p ON p.id = a.punch_id
        WHERE a.company_id = ? AND a.deleted_at IS NULL AND a.status IN ('OPEN', 'PENDING_APPROVAL') AND a.anomaly_type IN ('SHARED_DEVICE', 'SELFIE_MISMATCH', 'MOCK_LOCATION', 'IMPOSSIBLE_TRAVEL') AND p.work_date >= ?
        GROUP BY p.person_type, p.person_id HAVING COUNT(*) >= ? ORDER BY n DESC LIMIT 500`).all(c, daysAgo(t.days), t.minCount)
        .map((x) => ({ key: `${x.pt}:${x.pid}:${x.first}`, projectId: siteProject(x.s), siteId: x.s, entity: 'att_punches', entityId: `${x.pt}:${x.pid}`, entityRef: `${x.pt} ${x.pid}`, value: x.days * Math.round(t.dailyWage * 100),
          title: `${x.n} suspected proxy punches (${String(x.types).toLowerCase().replace(/_/g, ' ')}) for ${x.pt.toLowerCase()} ${x.pid} between ${x.first} and ${x.last}`,
          evidence: { personType: x.pt, personId: x.pid, count: x.n, days: x.days, types: String(x.types).split(','), dailyWage: t.dailyWage, route: `/hr/attendance/anomalies?personId=${x.pid}` } }));
    },
    IDLE_HIRED_EQUIPMENT(c, t) {
      if (!has(db, 'plt_hire_agreements') || !has(db, 'plt_logs')) return null;
      const per = { HOUR: 1, DAY: 8, MONTH: 208 };
      return db.prepare(`SELECT h.id, h.doc_no, h.charge_basis, h.hire_rate, h.org_project_id AS p, h.org_site_id AS s, e.asset_code, SUM(l.idle_hrs) AS idle, COUNT(l.id) AS logs, MIN(l.log_date) AS first, MAX(l.log_date) AS last
        FROM plt_hire_agreements h JOIN plt_logs l ON l.equipment_id = h.equipment_id AND l.company_id = h.company_id AND l.deleted_at IS NULL AND l.status IN ('SUBMITTED', 'APPROVED')
          AND l.log_date >= h.from_date AND (h.to_date IS NULL OR l.log_date <= h.to_date) AND l.log_date >= ?
        LEFT JOIN plt_equipment e ON e.id = h.equipment_id
        WHERE h.company_id = ? AND h.deleted_at IS NULL AND h.direction = 'IN' AND h.status = 'APPROVED' GROUP BY h.id HAVING SUM(l.idle_hrs) >= ? ORDER BY idle DESC LIMIT 500`).all(daysAgo(t.days), c, t.hours * 1000)
        .map((x) => ({ key: `${x.id}:${x.first}`, projectId: x.p, siteId: x.s, entity: 'plt_hire_agreements', entityId: x.id, entityRef: x.doc_no, value: Math.round(((x.idle / 1000) * x.hire_rate) / per[x.charge_basis]),
          title: `${x.asset_code ?? x.doc_no} on hire idle ${x.idle / 1000} hours in ${t.days} days (${x.doc_no})`,
          evidence: { idleHours: x.idle / 1000, logs: x.logs, from: x.first, to: x.last, hireRate: rs(x.hire_rate), basis: x.charge_basis, route: `/plant/hire-agreements?id=${x.id}` } }));
    },
    STOCK_AGEING(c, t) {
      if (!has(db, 'inv_stock_ledger')) return null;
      return db.prepare(`SELECT l.store_id, l.item_id, l.balance_qty, l.balance_value, l.txn_date, s.code AS store, s.org_project_id AS p, s.org_site_id AS s, i.code AS item, i.name AS itemName
        FROM (SELECT MAX(id) AS id FROM inv_stock_ledger WHERE company_id = ? AND deleted_at IS NULL GROUP BY store_id, item_id) m JOIN inv_stock_ledger l ON l.id = m.id
        JOIN inv_stores s ON s.id = l.store_id LEFT JOIN mdm_items i ON i.id = l.item_id
        WHERE l.balance_qty > 0 AND l.txn_date < ? AND l.balance_value >= ? ORDER BY l.balance_value DESC LIMIT 1000`).all(c, daysAgo(t.days), Math.round(t.minValue * 100))
        .map((x) => ({ key: `${x.store_id}:${x.item_id}:${x.txn_date}`, projectId: x.p, siteId: x.s, entity: 'inv_stores', entityId: x.store_id, entityRef: `${x.store} ${x.item ?? ''}`.trim(), value: x.balance_value,
          title: `${x.item ?? 'Item'} ${x.itemName ?? ''} in ${x.store}: no movement since ${x.txn_date}`.replace(/\s+/g, ' '),
          evidence: { qty: x.balance_qty / 1000, value: rs(x.balance_value), lastMovement: x.txn_date, days: t.days, route: `/inv/stock?storeId=${x.store_id}&itemId=${x.item_id}` } }));
    },
    UNBILLED_WORK_AGEING(c, t) {
      if (!has(db, 'site_dpr_work') || !has(db, 'bill_mb_entries')) return null;
      return db.prepare(`SELECT a.id AS act, a.code, a.name, d.org_project_id AS p, d.dpr_site_id AS s, SUM(w.qty) AS qty, MIN(d.dpr_date) AS first, MAX(d.dpr_date) AS last, COUNT(DISTINCT d.id) AS dprs,
          (SELECT l.rate FROM plan_activity_boq x JOIN proj_boq_lines l ON l.id = x.boq_line_id WHERE x.activity_id = a.id AND x.deleted_at IS NULL ORDER BY x.id LIMIT 1) AS rate,
          (SELECT l.item_code FROM plan_activity_boq x JOIN proj_boq_lines l ON l.id = x.boq_line_id WHERE x.activity_id = a.id AND x.deleted_at IS NULL ORDER BY x.id LIMIT 1) AS boq
        FROM site_dpr_work w JOIN site_dprs d ON d.id = w.dpr_id JOIN plan_activities a ON a.id = w.activity_id
        WHERE d.company_id = ? AND d.status = 'APPROVED' AND d.deleted_at IS NULL AND w.deleted_at IS NULL AND d.dpr_date < ?
          AND NOT EXISTS (SELECT 1 FROM bill_mb_entries m WHERE m.dpr_work_id = w.id AND m.deleted_at IS NULL AND m.status <> 'CANCELLED')
        GROUP BY a.id, d.org_project_id ORDER BY first LIMIT 1000`).all(c, daysAgo(t.days))
        .map((x) => ({ key: `${x.act}:${x.first}`, projectId: x.p, siteId: x.s, entity: 'plan_activities', entityId: x.act, entityRef: x.code, value: x.rate ? amountOf(x.qty, x.rate) : 0,
          title: `${x.code} ${x.name}: ${x.qty / 1000} executed since ${x.first} not in the measurement book`,
          evidence: { qty: x.qty / 1000, dprs: x.dprs, from: x.first, to: x.last, boqItem: x.boq, days: t.days, route: `/bill/mb?activityId=${x.act}` } }))
        .filter((f) => f.value >= t.minValue * 100);
    },
    OVERDUE_APPROVAL(c, t) {
      if (!has(db, 'wf_tasks')) return null;
      return db.prepare(`SELECT t.id, t.due_at, t.assignee_role, u.username, i.id AS inst, i.doc_type, i.doc_ref, i.title, json_extract(i.context_json, '$.projectId') AS p, json_extract(i.context_json, '$.siteId') AS s
        FROM wf_tasks t JOIN wf_instances i ON i.id = t.instance_id LEFT JOIN iam_users u ON u.id = t.assignee_user_id
        WHERE i.company_id = ? AND i.status = 'RUNNING' AND t.status = 'OPEN' AND t.kind IN ('APPROVAL', 'REVIEW') AND t.due_at IS NOT NULL AND t.due_at < ? ORDER BY t.due_at LIMIT 1000`).all(c, new Date(Date.now() - t.days * 86_400_000).toISOString())
        .map((x) => ({ key: `${x.id}`, projectId: x.p == null ? null : Number(x.p), siteId: x.s == null ? null : Number(x.s), entity: 'wf_instances', entityId: x.inst, entityRef: x.doc_ref, value: 0, ownerUser: x.username ?? null, ownerRole: x.assignee_role ?? null,
          title: `Approval of ${x.doc_ref ?? x.doc_type} overdue since ${x.due_at.slice(0, 10)}${x.title ? ` — ${x.title}` : ''}`.slice(0, 300),
          evidence: { docType: x.doc_type, dueAt: x.due_at, assignee: x.username ?? x.assignee_role, route: `/workflow/tasks?instance=${x.inst}` } }));
    },
    EMERGENCY_UNREGULARISED(c, t) {
      if (!has(db, 'pcs_exceptions')) return null;
      return db.prepare(`SELECT e.id, e.exception_no, e.control_code, e.entity_ref, e.value_at_risk, e.regularise_by, e.raised_by, e.project_id AS p, e.site_id AS s FROM pcs_exceptions e
        WHERE e.company_id = ? AND e.is_active = 1 AND e.emergency = 1 AND e.regularised_at IS NULL AND e.status IN ('PENDING', 'APPROVED', 'USED', 'RETURNED') AND e.regularise_by < ? ORDER BY e.id LIMIT 1000`).all(c, new Date(Date.now() - t.graceDays * 86_400_000).toISOString())
        .map((x) => ({ key: String(x.id), projectId: x.p, siteId: x.s, entity: 'pcs_exceptions', entityId: x.id, entityRef: x.exception_no, value: x.value_at_risk ?? 0, ownerUser: x.raised_by,
          title: `Emergency ${x.exception_no} (${x.control_code}) not regularised by ${String(x.regularise_by).slice(0, 10)}${x.entity_ref ? ` — ${x.entity_ref}` : ''}`,
          evidence: { control: x.control_code, regulariseBy: x.regularise_by, raisedBy: x.raised_by, route: `/controls/exceptions?open=${x.id}` } }));
    },
    REPEATED_EXCEPTIONS(c, t) {
      if (!has(db, 'pcs_exceptions')) return null;
      return db.prepare(`SELECT e.raised_by AS u, COUNT(*) AS n, COALESCE(SUM(e.value_at_risk), 0) AS v, MIN(substr(e.created_at, 1, 10)) AS first, COUNT(DISTINCT e.project_id) AS projects, MAX(e.project_id) AS p,
          GROUP_CONCAT(DISTINCT e.control_code) AS controls FROM pcs_exceptions e
        WHERE e.company_id = ? AND e.is_active = 1 AND e.created_at >= ? GROUP BY e.raised_by HAVING COUNT(*) >= ? ORDER BY n DESC LIMIT 200`).all(c, daysAgo(t.days), t.count)
        .map((x) => ({ key: `${x.u}:${x.first}`, projectId: x.projects === 1 ? x.p : null, siteId: null, entity: 'iam_users', entityId: x.u, entityRef: x.u, value: x.v,
          title: `${x.u} raised ${x.n} control exceptions in ${t.days} days (${String(x.controls).split(',').slice(0, 4).join(', ')})`,
          evidence: { user: x.u, count: x.n, since: x.first, controls: String(x.controls).split(','), route: `/controls/exceptions?raisedBy=${encodeURIComponent(x.u)}` } }));
    },
  };

  // ---------------------------------------------------------------- owners (RACI 04.05 → project manager → role holder) and raising
  const user = (companyId, username) => (username ? db.prepare("SELECT id, username FROM iam_users WHERE company_id = ? AND username = ? AND is_active = 1 AND status = 'ACTIVE'").get(companyId, username) : null);
  const userById = (companyId, id) => (id ? db.prepare("SELECT id, username FROM iam_users WHERE company_id = ? AND id = ? AND is_active = 1 AND status = 'ACTIVE'").get(companyId, id) : null);
  const roleHolder = (companyId, role) => (role ? db.prepare(`SELECT u.id, u.username FROM iam_users u WHERE u.company_id = ? AND u.is_active = 1 AND u.status = 'ACTIVE'
    AND EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value = ?) ORDER BY u.username LIMIT 1`).get(companyId, role) : null);
  function ownerOf(companyId, rule, hit) {
    if (hit.ownerUser) { const u = user(companyId, hit.ownerUser); if (u) return { ...u, role: hit.ownerRole ?? null, basis: 'record' }; }
    if (rule.process && has(db, 'acc_raci_assignments')) {
      const r = accountabilityOf(db).resolve({ companyId, processCode: rule.process, projectId: hit.projectId ?? null, siteId: hit.siteId ?? null });
      const u = r ? (userById(companyId, r.accountable) ?? user(companyId, r.accountable)) : null;
      if (u) return { ...u, role: null, basis: `RACI ${rule.process} (${r.scope.type.toLowerCase()})` };
    }
    if (hit.projectId) {
      const p = db.prepare('SELECT pm_user FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1').get(hit.projectId);
      const u = user(companyId, p?.pm_user);
      if (u && !['AUD'].includes(rule.ownerRole)) return { ...u, role: 'PM', basis: 'project manager' };
    }
    const role = hit.ownerRole ?? rule.ownerRole;
    const u = roleHolder(companyId, role);
    return u ? { ...u, role, basis: `role ${role}` } : { id: null, username: null, role, basis: `role ${role} (nobody holds it)` };
  }
  const nextNo = (companyId) => `FND-${String(Number(db.prepare("SELECT COALESCE(MAX(CAST(substr(doc_no, 5) AS INTEGER)), 0) + 1 AS n FROM det_findings WHERE company_id = ?").get(companyId).n)).padStart(5, '0')}`;
  const dueIn = (days) => new Date(Date.now() + days * 86_400_000).toISOString();

  function upsert(companyId, rule, setting, hit) {
    const dedupe = `${rule.code}:${hit.key}`;
    const now = iso();
    const existing = db.prepare('SELECT id, status, value_at_risk, title FROM det_findings WHERE company_id = ? AND dedupe_key = ?').get(companyId, dedupe);
    if (existing) {
      // a closed finding is never raised again for the same evidence; an open one is refreshed
      if (existing.status === 'CLOSED') return 'SUPPRESSED';
      const changed = existing.value_at_risk !== hit.value || existing.title !== hit.title;
      db.prepare(`UPDATE det_findings SET last_seen_at = ?, occurrences = occurrences + ?, value_at_risk = ?, title = ?, evidence_json = ?, updated_by = 'system', updated_at = ?, version = version + ? WHERE id = ?`)
        .run(now, changed ? 1 : 0, hit.value, hit.title.slice(0, 300), JSON.stringify(hit.evidence), now, changed ? 1 : 0, existing.id);
      return 'REFRESHED';
    }
    const owner = ownerOf(companyId, rule, hit);
    const docNo = nextNo(companyId);
    const due = dueIn(DUE_DAYS[setting.severity]);
    const id = Number(db.prepare(`INSERT INTO det_findings (company_id, doc_no, rule_code, rule_version, project_id, site_id, entity, entity_id, entity_ref, title, value_at_risk, evidence_json, dedupe_key, severity,
        owner_id, owner_user, owner_role, owner_basis, status, detected_at, last_seen_at, due_at, created_by, source_type, source_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, 'system', ?, ?)`)
      .run(companyId, docNo, rule.code, setting.version, hit.projectId ?? null, hit.siteId ?? null, hit.entity, String(hit.entityId), hit.entityRef ?? null, hit.title.slice(0, 300), Math.max(0, Math.round(hit.value)),
        JSON.stringify(hit.evidence), dedupe, setting.severity, owner.id ?? null, owner.username ?? null, owner.role ?? null, owner.basis, now, now, due, hit.entity, String(hit.entityId)).lastInsertRowid);
    if (owner.username) {
      const made = tasksOf(db).create({ companyId, title: `${docNo}: ${rule.name}`.slice(0, 200), description: hit.title, entity: 'det_finding', entityId: id, entityLabel: docNo, projectId: hit.projectId ?? null,
        priority: setting.severity === 'CRITICAL' ? 'URGENT' : setting.severity === 'WARNING' ? 'HIGH' : 'MEDIUM', dueDate: due.slice(0, 10), assignees: [owner.username], origin: 'auto', assigner: 'system', actor: 'system',
        source: { type: 'det_finding', id: String(id) } });
      db.prepare('UPDATE det_findings SET task_id = ? WHERE id = ?').run(made.id, id);
    }
    const recipients = owner.username ? [`user:${owner.username}`] : owner.role ? [`role:${owner.role}`] : [];
    if (recipients.length) notify.notify({ companyId, templateCode: 'bi.finding.raised', recipients, data: { findingNo: docNo, rule: rule.name, title: hit.title, value: `₹${rs(hit.value)}` },
      priority: setting.severity === 'CRITICAL' ? 'URGENT' : 'NORMAL', category: 'alerts', projectId: hit.projectId ?? undefined, link: `/bi/leakage?tab=findings&id=${id}`, channels: ['IN_APP'],
      sourceType: 'det_finding', sourceId: id, eventKey: `det_finding:${id}:raised` });
    writeAudit(db, { companyId, entity: 'det_findings', entityId: id, action: 'raise', newValues: { docNo, rule: rule.code, projectId: hit.projectId ?? null, value: hit.value, owner: owner.username, basis: owner.basis }, actor: 'system' });
    publishEvent(db, { type: 'bi.finding.raised', entity: 'det_findings', entityId: id, actorId: 'system', companyId, projectId: hit.projectId ?? undefined,
      data: { findingNo: docNo, ruleCode: rule.code, status: 'OPEN', valueAtRisk: rs(hit.value), projectId: hit.projectId ?? null, owner: owner.username } });
    return 'RAISED';
  }

  /** One run of the library for a company (job, schedule or on demand). Each rule is independent: a failing rule is reported, the others still run. */
  function run(companyId, trigger = 'manual', only = null) {
    const actor = { companyId, user: 'system' };
    if (!context.flags.isOn(actor, LEAKAGE_FLAG)) return { skipped: true };
    const result = { trigger, raised: 0, refreshed: 0, suppressed: 0, rules: [] };
    for (const setting of currentRules(db, companyId)) {
      if (only && setting.code !== only) continue;
      if (!setting.active) { result.rules.push({ code: setting.code, skipped: 'inactive' }); continue; }
      let hits;
      try { hits = DETECT[setting.code](companyId, setting.thresholds); } catch (error) { result.rules.push({ code: setting.code, error: String(error.message).slice(0, 200) }); continue; }
      if (hits == null) { result.rules.push({ code: setting.code, skipped: 'source module not installed' }); continue; }
      const tally = { code: setting.code, hits: hits.length, raised: 0 };
      transaction(db, () => {
        for (const hit of hits) {
          const out = upsert(companyId, ruleOf(setting.code), setting, hit);
          if (out === 'RAISED') { result.raised += 1; tally.raised += 1; } else if (out === 'REFRESHED') result.refreshed += 1; else result.suppressed += 1;
        }
      });
      result.rules.push(tally);
    }
    result.escalated = escalate(companyId);
    writeAudit(db, { companyId, entity: 'det_findings', entityId: 0, action: 'detect', newValues: { trigger, raised: result.raised, refreshed: result.refreshed, suppressed: result.suppressed }, actor: 'system' });
    return result;
  }

  /** Escalation: an open finding past its due date tells the project director (or a director) and the internal auditor, once. */
  function escalate(companyId) {
    const late = db.prepare("SELECT * FROM det_findings WHERE company_id = ? AND status IN ('OPEN', 'IN_REVIEW') AND due_at < ? AND escalated_at IS NULL AND deleted_at IS NULL LIMIT 500").all(companyId, iso());
    for (const f of late) {
      transaction(db, () => {
        db.prepare("UPDATE det_findings SET escalated_at = ?, updated_by = 'system', updated_at = ? WHERE id = ?").run(iso(), iso(), f.id);
        notify.notify({ companyId, templateCode: 'bi.finding.escalated', recipients: ['role:PD', 'role:AUD'], data: { findingNo: f.doc_no, title: f.title, owner: f.owner_user ?? f.owner_role ?? '—' },
          priority: 'HIGH', category: 'alerts', projectId: f.project_id ?? undefined, link: `/bi/leakage?tab=findings&id=${f.id}`, channels: ['IN_APP'], sourceType: 'det_finding', sourceId: f.id, eventKey: `det_finding:${f.id}:escalated` });
        writeAudit(db, { companyId, entity: 'det_findings', entityId: f.id, action: 'escalate', newValues: { dueAt: f.due_at, owner: f.owner_user }, actor: 'system' });
        publishEvent(db, { type: 'bi.finding.escalated', entity: 'det_findings', entityId: f.id, actorId: 'system', companyId, projectId: f.project_id ?? undefined, data: { findingNo: f.doc_no, ruleCode: f.rule_code, status: f.status } });
      });
    }
    return late.length;
  }

  // ---------------------------------------------------------------- the findings (FR-02): scope, worklist, record, outcome
  /** What a person sees: the findings of the projects they hold bi.finding.view on (company-level findings need it company-wide), and always their own. */
  const scopeOf = (actor, p) => {
    const f = authz.scopeFilter(actor, 'bi.finding.view', { project: 'f.project_id' });
    Object.assign(p, f.params ?? {});
    const companyWide = may(actor, 'bi.finding.view');
    p.me = actor.user;
    return `(f.owner_user = :me OR (f.project_id IS NOT NULL AND (${f.sql})) OR (f.project_id IS NULL AND ${companyWide ? '1' : '0'}))`;
  };
  const projects = new Map();
  const projectLabel = (id) => { if (!id) return null; if (!projects.has(id)) projects.set(id, db.prepare('SELECT code FROM org_projects WHERE id = ?').get(id)?.code ?? null); return projects.get(id); };
  const canAct = (actor, f) => f.owner_user === actor.user || may(actor, 'bi.finding.act', f.project_id);
  function row(actor, id) {
    const f = db.prepare('SELECT * FROM det_findings WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
    if (!f) throw notFound('That finding does not exist.');
    const p = {}; const sql = scopeOf(actor, p);
    if (!db.prepare(`SELECT 1 FROM det_findings f WHERE f.id = :id AND ${sql}`).get({ ...p, id: f.id })) throw notFound('That finding does not exist.');
    return f;
  }
  const shape = (actor, f, detail = false) => {
    const rule = ruleOf(f.rule_code);
    const mine = f.owner_user === actor.user;
    const out = { id: f.id, docNo: f.doc_no, ruleCode: f.rule_code, rule: rule?.name ?? f.rule_code, module: rule?.module ?? null, projectId: f.project_id, project: projectLabel(f.project_id), siteId: f.site_id,
      title: f.title, valueAtRisk: rs(f.value_at_risk), severity: f.severity, owner: f.owner_user, ownerRole: f.owner_role, ownerBasis: f.owner_basis, status: f.status, outcome: f.outcome,
      lossAmount: f.loss_amount == null ? null : rs(f.loss_amount), detectedAt: f.detected_at, lastSeenAt: f.last_seen_at, occurrences: f.occurrences, dueAt: f.due_at, overdue: ['OPEN', 'IN_REVIEW'].includes(f.status) && f.due_at < iso(),
      escalatedAt: f.escalated_at, mine, rowVersion: f.version };
    if (!detail) return out;
    const act = canAct(actor, f);
    let taskId = null;
    if (f.status === 'PENDING_FP' && f.workflow_instance_id && may(actor, 'bi.finding.approve', f.project_id) && f.requested_by !== actor.user) {
      taskId = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === f.workflow_instance_id)?.id ?? null;
    }
    return { ...out, entity: f.entity, entityId: f.entity_id, entityRef: f.entity_ref, evidence: JSON.parse(f.evidence_json || '{}'), resolution: f.resolution, closedBy: f.closed_by, closedAt: f.closed_at,
      requestedBy: f.requested_by, approvedBy: f.approved_by, approvedAt: f.approved_at, taskId: f.task_id, workflowInstanceId: f.workflow_instance_id, approvalTaskId: taskId, method: rule?.queryRef ?? null,
      can: { start: act && f.status === 'OPEN', close: act && ['OPEN', 'IN_REVIEW'].includes(f.status), falsePositive: act && ['OPEN', 'IN_REVIEW'].includes(f.status), approve: Boolean(taskId) } };
  };

  const listFilter = (actor, q) => {
    const p = { c: actor.companyId };
    const where = ['f.company_id = :c', 'f.deleted_at IS NULL', scopeOf(actor, p)];
    if (q.status === 'ACTIVE') where.push("f.status IN ('OPEN', 'IN_REVIEW', 'PENDING_FP')"); else if (q.status) { where.push('f.status = :st'); p.st = q.status; }
    if (q.ruleCode) { where.push('f.rule_code = :rule'); p.rule = q.ruleCode; }
    if (q.projectId) { where.push('f.project_id = :pid'); p.pid = q.projectId; }
    if (q.outcome) { where.push('f.outcome = :oc'); p.oc = q.outcome; }
    if (q.severity) { where.push('f.severity = :sev'); p.sev = q.severity; }
    if (q.mine) where.push('f.owner_user = :me');
    if (q.overdue) { where.push("f.status IN ('OPEN', 'IN_REVIEW') AND f.due_at < :now"); p.now = iso(); }
    return { sql: where.join(' AND '), p };
  };
  const SORTS = { value: 'f.value_at_risk DESC, f.id DESC', newest: 'f.id DESC', due: 'f.due_at ASC, f.id' };
  function list(actor, q = {}) {
    guard(actor);
    const { sql, p } = listFilter(actor, q);
    const page = q.page ?? 1; const size = q.pageSize ?? 25;
    const total = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(f.value_at_risk), 0) AS v FROM det_findings f WHERE ${sql}`).get(p);
    const rows = db.prepare(`SELECT f.* FROM det_findings f WHERE ${sql} ORDER BY ${SORTS[q.sort] ?? SORTS.value} LIMIT :lim OFFSET :off`).all({ ...p, lim: size, off: (page - 1) * size });
    return { rows: rows.map((f) => shape(actor, f)), total: total.n, valueAtRisk: rs(total.v), page, pageSize: size };
  }
  function exportList(actor, q, format) {
    guard(actor); assertPermissionAnywhere(actor, 'bi.finding.export');
    const { sql, p } = listFilter(actor, q);
    const rows = db.prepare(`SELECT f.* FROM det_findings f WHERE ${sql} ORDER BY ${SORTS[q.sort] ?? SORTS.value} LIMIT 10000`).all(p).map((f) => shape(actor, f));
    const columns = [['docNo', 'Finding'], ['rule', 'Rule'], ['project', 'Project'], ['title', 'Finding'], ['valueAtRisk', 'Value at risk (₹)', 'number'], ['severity', 'Severity'], ['owner', 'Owner'], ['status', 'Status'], ['outcome', 'Outcome'], ['lossAmount', 'Confirmed loss (₹)', 'number'], ['detectedAt', 'Detected']]
      .map(([key, label, type = 'text']) => ({ key, label, type }));
    const buffer = writeExport(format, { columns, rows, title: 'Leakage findings', sheetName: 'Findings', footer: [`${rows.length} findings · value at risk ₹${rs(rows.reduce((n, r) => n + Math.round(r.valueAtRisk * 100), 0))} · findings are advisory (BR-01)`] });
    audit(actor, 0, 'export', { newValues: { format, rows: rows.length, filters: q } });
    return { buffer, contentType: FORMATS[format], fileName: `leakage-findings.${format}` };
  }
  const get = (actor, id) => { guard(actor); return shape(actor, row(actor, id), true); };
  const versionCheck = (f, rowVersion) => { if (rowVersion != null && f.version !== rowVersion) throw conflict('The finding changed since you opened it. Refresh and try again.'); };
  const needAct = (actor, f) => { if (!canAct(actor, f)) throw forbidden('Only the owner of the finding, or a role with bi.finding.act on its project, acts on it.'); };
  const closeTask = (f, who, why) => {
    if (!f.task_id) return;
    const t = tasksOf(db).get(f.task_id);
    if (t && !['DONE', 'VERIFIED', 'CLOSED', 'CANCELLED'].includes(t.status)) { try { tasksOf(db).act(who, f.task_id, 'complete', { reason: why }); } catch { /* the task belongs to the owner; the finding is the record */ } }
  };

  function start(actor, id, { rowVersion, note }) {
    guard(actor);
    return transaction(db, () => {
      const f = row(actor, id); needAct(actor, f); versionCheck(f, rowVersion);
      if (f.status !== 'OPEN') throw unprocessable('Only an open finding is taken into review.');
      db.prepare("UPDATE det_findings SET status = 'IN_REVIEW', remarks = COALESCE(?, remarks), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(note ?? null, actor.user, iso(), f.id);
      audit(actor, f.id, 'review', { oldValues: { status: f.status }, newValues: { status: 'IN_REVIEW', note: note ?? null } });
      return get(actor, f.id);
    });
  }

  /** BR-01: a finding closes only with an outcome. Confirmed loss carries the amount; prevented closes at once; a false positive goes to the auditor. */
  function close(actor, id, { outcome, resolution, lossAmount, rowVersion }) {
    guard(actor);
    if (!OUTCOMES.includes(outcome)) throw badRequest('Choose the outcome of the finding.', [{ field: 'outcome', message: 'is required' }]);
    if (outcome === 'FALSE_POSITIVE') return falsePositive(actor, id, { reason: resolution, rowVersion });
    return transaction(db, () => {
      const f = row(actor, id); needAct(actor, f); versionCheck(f, rowVersion);
      if (!['OPEN', 'IN_REVIEW'].includes(f.status)) throw unprocessable('This finding is not open.');
      if (outcome === 'CONFIRMED_LOSS' && !(lossAmount >= 0)) throw badRequest('Give the confirmed loss.', [{ field: 'lossAmount', message: 'is required for a confirmed loss' }]);
      const loss = outcome === 'CONFIRMED_LOSS' ? Math.round(lossAmount * 100) : null;
      db.prepare("UPDATE det_findings SET status = 'CLOSED', outcome = ?, loss_amount = ?, resolution = ?, closed_by = ?, closed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?")
        .run(outcome, loss, resolution, actor.user, iso(), actor.user, iso(), f.id);
      closeTask(f, actor.user, `Finding closed: ${outcome.toLowerCase().replace('_', ' ')}.`);
      audit(actor, f.id, 'close', { oldValues: { status: f.status }, newValues: { status: 'CLOSED', outcome, lossAmount: loss == null ? null : rs(loss), resolution } });
      publishEvent(db, { type: 'bi.finding.closed', entity: 'det_findings', entityId: f.id, actorId: actor.user, companyId: actor.companyId, projectId: f.project_id ?? undefined,
        data: { findingNo: f.doc_no, ruleCode: f.rule_code, status: 'CLOSED', outcome, lossAmount: loss == null ? null : rs(loss) } });
      return get(actor, f.id);
    });
  }

  function falsePositive(actor, id, { reason, rowVersion }) {
    guard(actor);
    if (!reason || reason.trim().length < 10) throw badRequest('Say why the finding is a false positive (at least 10 characters).', [{ field: 'resolution', message: 'is too short' }]);
    return transaction(db, () => {
      const f = row(actor, id); needAct(actor, f); versionCheck(f, rowVersion);
      if (!['OPEN', 'IN_REVIEW'].includes(f.status)) throw unprocessable('This finding is not open.');
      const context = { projectId: f.project_id ?? undefined, siteId: f.site_id ?? undefined, amount: rs(f.value_at_risk), rule: f.rule_code };
      let instanceId = f.workflow_instance_id;
      if (instanceId && db.prepare("SELECT 1 FROM wf_instances WHERE id = ? AND status = 'RETURNED'").get(instanceId)) workflowOf(db).resubmit(actor, instanceId, { comment: reason });
      else instanceId = workflowOf(db).submit(actor, { docType: FP_DOC, docId: String(f.id), comment: `${f.doc_no}: ${reason}`.slice(0, 300), context }).id;
      db.prepare("UPDATE det_findings SET status = 'PENDING_FP', resolution = ?, requested_by = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?")
        .run(reason.trim(), actor.user, instanceId, actor.user, iso(), f.id);
      audit(actor, f.id, 'submit', { oldValues: { status: f.status }, newValues: { status: 'PENDING_FP', reason } });
      return get(actor, f.id);
    });
  }

  /** The workflow outcome of a false positive (hooks): approved closes the finding; rejected or returned sends it back to review. */
  function fpDecided(instance, actor, outcome, comment) {
    const f = db.prepare('SELECT * FROM det_findings WHERE id = ?').get(Number(instance.docId ?? instance.doc_id));
    if (!f) return;
    const now = iso(); const who = actor?.user ?? 'system';
    if (outcome === 'APPROVED') {
      db.prepare("UPDATE det_findings SET status = 'CLOSED', outcome = 'FALSE_POSITIVE', closed_by = ?, closed_at = ?, approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?")
        .run(f.requested_by, now, who, now, who, now, f.id);
      closeTask(f, f.requested_by ?? who, 'Finding closed as a false positive (approved by the auditor).');
      publishEvent(db, { type: 'bi.finding.closed', entity: 'det_findings', entityId: f.id, actorId: who, companyId: f.company_id, projectId: f.project_id ?? undefined, data: { findingNo: f.doc_no, ruleCode: f.rule_code, status: 'CLOSED', outcome: 'FALSE_POSITIVE' } });
    } else {
      db.prepare("UPDATE det_findings SET status = 'IN_REVIEW', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(comment ?? `False positive ${outcome.toLowerCase()}`, who, now, f.id);
    }
    writeAudit(db, { companyId: f.company_id, entity: 'det_findings', entityId: f.id, action: `false_positive_${outcome.toLowerCase()}`, oldValues: { status: f.status }, newValues: { outcome, comment: comment ?? null }, actor: who });
  }

  function history(actor, id) {
    guard(actor);
    const f = row(actor, id);
    return db.prepare("SELECT action, actor, created_at AS at, old_values AS oldValues, new_values AS newValues FROM core_audit_log WHERE entity = 'det_findings' AND entity_id = ? ORDER BY id").all(String(f.id))
      .map((h) => ({ ...h, oldValues: h.oldValues ? JSON.parse(h.oldValues) : null, newValues: h.newValues ? JSON.parse(h.newValues) : null }));
  }

  // ---------------------------------------------------------------- the tower (FR-03)
  function tower(actor, q = {}) {
    guard(actor); assertPermissionAnywhere(actor, 'bi.leakage.view');
    const { sql, p } = listFilter(actor, { projectId: q.projectId });
    const active = "f.status IN ('OPEN', 'IN_REVIEW', 'PENDING_FP')";
    const t = db.prepare(`SELECT SUM(${active}) AS open, COALESCE(SUM(CASE WHEN ${active} THEN f.value_at_risk END), 0) AS v, SUM(${active} AND f.due_at < :now AND f.status <> 'PENDING_FP') AS overdue,
        SUM(f.status = 'PENDING_FP') AS pendingFp, COALESCE(SUM(f.loss_amount), 0) AS loss, SUM(f.outcome = 'FALSE_POSITIVE') AS fp, SUM(f.status = 'CLOSED') AS closed, SUM(f.outcome = 'PREVENTED') AS prevented,
        SUM(f.owner_user = :me AND f.status IN ('OPEN', 'IN_REVIEW')) AS mine FROM det_findings f WHERE ${sql}`).get({ ...p, now: iso() });
    const byRule = db.prepare(`SELECT f.rule_code AS code, COUNT(*) AS n, COALESCE(SUM(f.value_at_risk), 0) AS v FROM det_findings f WHERE ${sql} AND ${active} GROUP BY f.rule_code ORDER BY v DESC, n DESC`).all(p)
      .map((r) => ({ code: r.code, rule: ruleOf(r.code)?.name ?? r.code, count: r.n, valueAtRisk: rs(r.v), drill: `/bi/leakage?tab=findings&ruleCode=${r.code}` }));
    const byProject = db.prepare(`SELECT f.project_id AS id, COUNT(*) AS n, COALESCE(SUM(f.value_at_risk), 0) AS v FROM det_findings f WHERE ${sql} AND ${active} GROUP BY f.project_id ORDER BY v DESC LIMIT 10`).all(p)
      .map((r) => ({ projectId: r.id, project: projectLabel(r.id) ?? 'Company', count: r.n, valueAtRisk: rs(r.v), drill: `/bi/leakage?tab=findings${r.id ? `&projectId=${r.id}` : ''}` }));
    const top = db.prepare(`SELECT f.* FROM det_findings f WHERE ${sql} AND ${active} ORDER BY f.value_at_risk DESC, f.id DESC LIMIT 5`).all(p).map((f) => shape(actor, f));
    const since = daysAgo(84);
    const raised = db.prepare(`SELECT strftime('%Y-%W', f.detected_at) AS w, MIN(substr(f.detected_at, 1, 10)) AS d, COUNT(*) AS n FROM det_findings f WHERE ${sql} AND f.detected_at >= :since GROUP BY w ORDER BY w`).all({ ...p, since });
    let controls = null; let exceptions = [];
    if (has(db, 'pcs_control_points')) {
      const modes = db.prepare('SELECT mode, COUNT(*) AS n FROM pcs_control_points WHERE company_id = ? AND is_active = 1 AND deleted_at IS NULL GROUP BY mode').all(actor.companyId);
      const list = db.prepare('SELECT code, description, mode, module, owner_role FROM pcs_control_points WHERE company_id = ? AND is_active = 1 AND deleted_at IS NULL ORDER BY mode DESC, code LIMIT 200').all(actor.companyId);
      controls = { modes: Object.fromEntries(['OFF', 'OBSERVE', 'WARN', 'ENFORCE'].map((m) => [m, modes.find((x) => x.mode === m)?.n ?? 0])), total: list.length,
        list: list.map((c) => ({ code: c.code, description: c.description, mode: c.mode, module: c.module, ownerRole: c.owner_role })), route: '/controls/points' };
      const pf = q.projectId ? 'AND e.project_id = ?' : '';
      exceptions = db.prepare(`SELECT strftime('%Y-%W', e.created_at) AS w, MIN(substr(e.created_at, 1, 10)) AS d, COUNT(*) AS n, COALESCE(SUM(e.value_at_risk), 0) AS v FROM pcs_exceptions e
        WHERE e.company_id = ? AND e.is_active = 1 AND e.created_at >= ? ${pf} GROUP BY w ORDER BY w`).all(actor.companyId, since, ...(q.projectId ? [q.projectId] : []));
    }
    const weeks = [...new Set([...raised.map((r) => r.w), ...exceptions.map((r) => r.w)])].sort();
    const label = (w) => raised.find((r) => r.w === w)?.d ?? exceptions.find((r) => r.w === w)?.d ?? w;
    const outcomes = db.prepare(`SELECT f.rule_code AS code, SUM(f.status = 'CLOSED') AS closed, SUM(f.outcome = 'FALSE_POSITIVE') AS fp, SUM(f.outcome = 'CONFIRMED_LOSS') AS loss FROM det_findings f WHERE ${sql} GROUP BY f.rule_code`).all(p);
    const myApprovals = may(actor, 'bi.finding.approve') ? db.prepare("SELECT COUNT(*) AS n FROM det_findings WHERE company_id = ? AND status = 'PENDING_FP' AND requested_by <> ?").get(actor.companyId, actor.user).n : 0;
    return {
      asOf: iso(), projectId: q.projectId ?? null,
      tiles: { open: t.open ?? 0, valueAtRisk: rs(t.v), overdue: t.overdue ?? 0, pendingFalsePositive: t.pendingFp ?? 0, confirmedLoss: rs(t.loss), closed: t.closed ?? 0, prevented: t.prevented ?? 0,
        falsePositiveRate: t.closed ? Math.round(((t.fp ?? 0) * 1000) / t.closed) / 10 : null, mine: t.mine ?? 0 },
      byRule, byProject, top,
      trend: { categories: weeks.map(label), findings: weeks.map((w) => raised.find((r) => r.w === w)?.n ?? 0), exceptions: weeks.map((w) => exceptions.find((r) => r.w === w)?.n ?? 0) },
      controls, outcomes: outcomes.map((o) => ({ code: o.code, closed: o.closed ?? 0, falsePositives: o.fp ?? 0, confirmedLosses: o.loss ?? 0, precision: o.closed ? Math.round((1 - (o.fp ?? 0) / o.closed) * 1000) / 10 : null })),
      pending: { mine: t.mine ?? 0, approvals: myApprovals },
      projects: db.prepare(`SELECT DISTINCT p.id, p.code, p.name FROM det_findings f JOIN org_projects p ON p.id = f.project_id WHERE ${listFilter(actor, {}).sql} ORDER BY p.code`).all(listFilter(actor, {}).p),
      can: { run: hasPermissionAnywhere(actor, 'bi.det_rule.run'), export: hasPermissionAnywhere(actor, 'bi.finding.export'), rules: hasPermissionAnywhere(actor, 'bi.det_rule.view') },
    };
  }

  // ---------------------------------------------------------------- the rule configuration (maker-checker)
  function rules(actor) {
    guard(actor); assertPermissionAnywhere(actor, 'bi.det_rule.view');
    const stats = new Map(db.prepare(`SELECT rule_code AS code, COUNT(*) AS n, SUM(status <> 'CLOSED') AS open, SUM(outcome = 'FALSE_POSITIVE') AS fp, SUM(status = 'CLOSED') AS closed, MAX(detected_at) AS last
      FROM det_findings WHERE company_id = ? AND deleted_at IS NULL GROUP BY rule_code`).all(actor.companyId).map((r) => [r.code, r]));
    const configure = hasPermissionAnywhere(actor, 'bi.det_rule.configure');
    const decide = configure || hasPermissionAnywhere(actor, 'bi.finding.approve');
    return { rules: currentRules(db, actor.companyId).map((r) => { const s = stats.get(r.code); return { ...r, findings: s?.n ?? 0, open: s?.open ?? 0, lastFound: s?.last ?? null,
      falsePositiveRate: s?.closed ? Math.round(((s.fp ?? 0) * 1000) / s.closed) / 10 : null }; }),
    requests: decide ? approvals.list(actor, { type: RULES_TYPE, status: undefined, limit: 25, offset: 0 }).rows : [], can: { configure, decide, run: hasPermissionAnywhere(actor, 'bi.det_rule.run') } };
  }
  function proposeRule(actor, code, input) {
    guard(actor); assertPermissionAnywhere(actor, 'bi.det_rule.configure');
    const rule = ruleOf(code); if (!rule) throw notFound('That detection rule does not exist.');
    const problems = [];
    const thresholds = {};
    for (const [k, [, lo, hi]] of Object.entries(rule.thresholds)) {
      const v = input.thresholds?.[k];
      if (typeof v !== 'number' || Number.isNaN(v) || v < lo || v > hi) problems.push({ field: `thresholds.${k}`, message: `must be between ${lo} and ${hi}` }); else thresholds[k] = v;
    }
    for (const k of Object.keys(input.thresholds ?? {})) if (!(k in rule.thresholds)) problems.push({ field: `thresholds.${k}`, message: 'is not a threshold of this rule' });
    if (!SEVERITIES.includes(input.severity)) problems.push({ field: 'severity', message: 'is not a severity' });
    if (problems.length) throw badRequest('Correct the highlighted thresholds.', problems);
    return transaction(db, () => {
      const current = currentRules(db, actor.companyId).find((r) => r.code === code);
      if (current.active === input.active && current.severity === input.severity && JSON.stringify(current.thresholds) === JSON.stringify({ ...current.thresholds, ...thresholds })) throw conflict('These settings are already in force.');
      if (db.prepare("SELECT 1 FROM core_change_requests WHERE company_id = ? AND type = ? AND target_type = ? AND status = 'SUBMITTED'").get(actor.companyId, RULES_TYPE, `det_rule_${code}`)) throw conflict('A change to this rule is already awaiting approval.');
      return approvals.submit(actor, { type: RULES_TYPE, title: `Detection rule: ${rule.name}`, targetType: `det_rule_${code}`, targetId: 0, reason: input.reason, chain: ['AUD|CFO'],
        payload: { code, thresholds, severity: input.severity, active: input.active, baseVersion: current.version, from: { thresholds: current.thresholds, severity: current.severity, active: current.active } } });
    });
  }
  function decideRule(actor, id, input) {
    guard(actor);
    if (!hasPermissionAnywhere(actor, 'bi.det_rule.configure') && !hasPermissionAnywhere(actor, 'bi.finding.approve')) throw forbidden('Your role does not decide detection rule changes.');
    if (approvals.get(actor, id).type !== RULES_TYPE) throw notFound('That rule change does not exist.');
    return approvals.act(actor, id, input);
  }
  function queueRun(actor, ruleCode) {
    guard(actor); assertPermissionAnywhere(actor, 'bi.det_rule.run');
    if (ruleCode && !ruleOf(ruleCode)) throw notFound('That detection rule does not exist.');
    writeAudit(db, { companyId: actor.companyId, entity: 'det_findings', entityId: 0, action: 'run_request', newValues: { ruleCode: ruleCode ?? null }, actor: actor.user });
    return jobs.enqueue(RUN_JOB, { companyId: actor.companyId, trigger: 'manual', ruleCode: ruleCode ?? null }, { companyId: actor.companyId, createdBy: actor.user });
  }

  // ---------------------------------------------------------------- the job and its schedule
  jobs.register(RUN_JOB, ({ params }) => {
    if (params.companyId) return run(params.companyId, params.trigger ?? 'manual', params.ruleCode ?? null);
    const out = [];
    for (const { id } of db.prepare('SELECT id FROM org_companies WHERE is_active = 1 ORDER BY id').all()) {
      try { out.push({ companyId: id, ...run(id, 'schedule') }); } catch (error) { if (error.status !== 404) throw error; }
    }
    return { companies: out.length, raised: out.reduce((n, r) => n + (r.raised ?? 0), 0) };
  }, { description: 'Runs the wastage, leakage and duplication detection rules (part 27.09).' });
  // 05:30 IST every day, before the control tower (05:45) and the morning report
  scheduler.define({ code: RUN_JOB, cron: '30 5 * * *', jobType: RUN_JOB, description: 'Run the leakage detection rules daily at 05:30 IST.' });

  const service = { run, list, exportList, get, start, close, falsePositive, fpDecided, history, tower, rules, proposeRule, decideRule, queueRun, escalate };
  services.set(db, service);
  return service;
}

/** The dashboard widget (03.07) and Project 360 (10.08): open findings and their value at risk. */
const widgetOk = (db, actor) => {
  const c = contexts.get(db);
  if (!c || !leakageOf(db) || !hasPermissionAnywhere(actor, 'bi.leakage.view')) return false;
  try { requireLeakage(c, actor); return true; } catch (e) { if (e.status === 404) return false; throw e; }
};
widgetRegistry.register({
  code: 'bi.leakage_open', available: widgetOk,
  provider({ db, actor, filters }) {
    const t = leakageOf(db).tower(actor, { projectId: filters.projectId ?? undefined }).tiles;
    return { label: 'Leakage findings open', value: t.open, unit: 'findings', subtitle: `₹${t.valueAtRisk} at risk · ${t.overdue} overdue`, status: t.overdue ? 'red' : t.open ? 'amber' : 'green', drill: '/bi/leakage' };
  },
});
registerProject360Widget('bi.leakage_open', ({ db, actor, project }) => {
  if (!widgetOk(db, actor)) return null;
  const t = leakageOf(db).tower(actor, { projectId: project.project_id }).tiles;
  return { figures: [{ key: 'open', label: 'Open findings', value: t.open, drill: `/bi/leakage?tab=findings&projectId=${project.project_id}` }, { key: 'risk', label: 'Value at risk (₹)', value: t.valueAtRisk, drill: `/bi/leakage?tab=findings&projectId=${project.project_id}` }],
    note: 'Advisory findings of the detection rules (27.09)' };
});
