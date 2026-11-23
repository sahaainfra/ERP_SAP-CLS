import { createHash } from 'node:crypto';
import { createApprovalEngine } from '../../platform/approvals/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { assertPermissionAnywhere, hasPermissionAnywhere } from '../../platform/auth/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { transaction } from '../../platform/db/index.js';
import { eventTypes, publishEvent } from '../../platform/events/index.js';
import { FORMATS, writeExport } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { todayIST } from '../../../shared/dates.js';
import { createFlagService } from '../core/feature-flags/service.js';
import { requireMetricCatalogueSource } from './domain-metrics.js';
import { towerOf } from './control-tower.js';

/**
 * Part 27.05 — the daily morning management report.
 *
 * Each recipient gets one report a day, built as that person (their roles and project scopes decide every figure) from the data as at the
 * cut-off (06:00 IST by default) and frozen as a snapshot in `mr_reports` (BR-01: opening or regenerating the report of a date gives the same
 * figures, byte for byte, because it is drawn from the snapshot and its hash is kept). Sections follow the recipient's configuration (per user,
 * else per role); the executive summary is written by rules from the section figures; the exceptions (DPRs missing, overdue approvals,
 * stock-outs, collections due today) are listed first. A job delivers the reports at each configuration's time (in-app, e-mail, WhatsApp through
 * the notification engine); the PDF is drawn from the same snapshot. Configurations change only through a maker-checker request.
 */

export const MR_FLAG = 'ff.bi.p2705';
const CONFIG_TYPE = 'bi_morning_report_config';
const DELIVERY_JOB = 'bi.morning_report.deliver';
export const SECTIONS = Object.freeze(['tower', 'progress', 'attendance', 'stock', 'receivables', 'payables', 'approvals', 'tasks', 'risks', 'incidents']);
export const CHANNELS = Object.freeze(['IN_APP', 'EMAIL', 'WHATSAPP']);
const DEFAULT_CONFIG = Object.freeze({ sections: SECTIONS, cutoff: '06:00', time: '06:30', channels: ['IN_APP'], pdf: true });
const SNAPSHOT_VERSION = 1;

const deliveredShape = { type: 'object', required: ['reportNo', 'reportDate', 'recipient'], properties: { reportNo: { type: 'string' }, reportDate: { type: 'string' }, recipient: { type: 'string' }, exceptions: { type: 'integer' }, hash: { type: 'string' } } };
const configShape = { type: 'object', required: ['scopeType', 'scopeRef', 'version'], properties: { scopeType: { type: 'string' }, scopeRef: { type: 'string' }, version: { type: 'integer' }, requestId: { type: 'integer' } } };
eventTypes.define({ type: 'bi.morning_report.delivered', version: 1, schema: deliveredShape, owner: 'bi', description: 'A morning management report was generated and delivered to its recipient (part 27.05): data { reportNo, reportDate, recipient, exceptions, hash }.' });
eventTypes.define({ type: 'bi.morning_report.config_changed', version: 1, schema: configShape, owner: 'bi', description: 'An approved change to a morning report configuration took effect (maker-checker, part 27.05).' });

const rs = (paise) => Math.round(Number(paise ?? 0)) / 100;
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** The IST wall-clock time `hh:mm` on `date` as a UTC instant. */
const istInstant = (date, hhmm) => new Date(Date.parse(`${date}T${hhmm}:00+05:30`)).toISOString();
const nowIstHhmm = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(11, 16);
/** A canonical JSON (sorted keys) so the same figures always give the same hash. */
const canonical = (value) => (Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value ?? null));

/** The configurations in force: the latest approved version of each (scope type, scope ref). */
export function currentConfigs(db, companyId) {
  return db.prepare(`SELECT c.* FROM mr_configs c WHERE c.company_id = ? AND c.deleted_at IS NULL
    AND c.version = (SELECT MAX(x.version) FROM mr_configs x WHERE x.company_id = c.company_id AND x.scope_type = c.scope_type AND x.scope_ref = c.scope_ref AND x.deleted_at IS NULL)
    ORDER BY c.scope_type DESC, c.scope_ref`).all(companyId).map(presentConfig);
}
const presentConfig = (row) => {
  const sections = JSON.parse(row.sections_json); const delivery = JSON.parse(row.delivery_json);
  return { id: row.id, scopeType: row.scope_type, scopeRef: row.scope_ref, sections, cutoff: delivery.cutoff, time: delivery.time, channels: delivery.channels, pdf: delivery.pdf !== false,
    active: row.active === 1, version: row.version, approvedBy: row.created_by, approvedAt: row.created_at, requestId: row.request_id };
};

const contexts = new WeakMap();
const services = new WeakMap();
/** The morning report service of a database (for jobs and tests that call it without HTTP). */
export const morningOf = (db) => services.get(db) ?? null;
const contextOf = (db, environment) => contexts.get(db) ?? { db, flags: createFlagService({ db, environment }) };

export function requireMorningReport(context, actor) {
  if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, MR_FLAG)) throw notFound('The morning report is unavailable.');
  requireMetricCatalogueSource(context, actor);
}

export const morningApprovalHandlers = (environment) => ({
  [CONFIG_TYPE]: {
    authorize(db, actor) {
      requireMorningReport(contextOf(db, environment), actor);
      if (!hasPermissionAnywhere(actor, 'bi.morning_report.configure')) throw forbidden('Your role does not include bi.morning_report.configure.');
    },
    apply(db, request, actor) {
      const p = request.payload;
      const current = currentConfigs(db, request.companyId).find((c) => c.scopeType === p.scopeType && c.scopeRef === p.scopeRef);
      if ((current?.version ?? 0) !== p.baseVersion) throw conflict('The configuration changed after this request was raised. Raise a new request.');
      const version = p.baseVersion + 1;
      db.prepare(`INSERT INTO mr_configs (company_id, scope_type, scope_ref, sections_json, delivery_json, active, request_id, version, created_by, source_type, source_id, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'change_request', ?, ?)`)
        .run(request.companyId, p.scopeType, p.scopeRef, JSON.stringify(p.sections), JSON.stringify({ cutoff: p.cutoff, time: p.time, channels: p.channels, pdf: p.pdf }),
          p.active ? 1 : 0, request.id, version, actor.user, String(request.id), request.reason);
      writeAudit(db, { companyId: request.companyId, entity: 'mr_configs', entityId: `${p.scopeType}:${p.scopeRef}`, action: 'config_change', oldValues: current ?? null,
        newValues: { ...p, version, requestId: request.id, requestedBy: request.requestedBy }, actor: actor.user });
      publishEvent(db, { type: 'bi.morning_report.config_changed', entity: 'mr_configs', entityId: `${p.scopeType}:${p.scopeRef}`, actorId: actor.user, companyId: request.companyId,
        data: { scopeType: p.scopeType, scopeRef: p.scopeRef, version, requestId: request.id } });
    },
  },
});

export function createMorningReport(context, { jobs, scheduler, environment }) {
  const { db } = context;
  contexts.set(db, context);
  const authz = authzOf(db);
  const approvals = createApprovalEngine({ db, handlers: morningApprovalHandlers(environment) });
  const guard = (actor, permission) => { requireMorningReport(context, actor); assertPermissionAnywhere(actor, permission); };
  const may = (actor, permission) => hasPermissionAnywhere(actor, permission);
  const scope = (actor, permission, project, site = null) => authz.scopeFilter(actor, permission, { project, ...(site ? { site } : {}) }).sql;
  const has = (table) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));

  /** The configuration of a person: their own, else the first role of theirs that has one, else the default (not delivered). */
  function configFor(companyId, user, roles) {
    const all = currentConfigs(db, companyId);
    const own = all.find((c) => c.scopeType === 'USER' && c.scopeRef === user);
    const role = all.find((c) => c.scopeType === 'ROLE' && (roles ?? []).includes(c.scopeRef));
    return own ?? role ?? { ...DEFAULT_CONFIG, scopeType: 'DEFAULT', scopeRef: null, active: false, version: 0 };
  }

  // ---------------------------------------------------------------- the sections (each as the recipient, as at the cut-off)
  const builders = {
    tower(actor) {
      const tower = towerOf(db);
      if (!tower || !may(actor, 'bi.control_tower.view')) return null;
      try {
        const d = tower.portfolio(actor, { pageSize: 5 });
        return { tiles: d.tiles.filter((t) => t.state === 'OK').map((t) => ({ key: t.key, label: t.label, value: t.value, unit: t.unit, tone: t.tone })),
          distribution: d.distribution, red: d.matrix.rows.filter((r) => r.health.overall === 'RED').map((r) => ({ projectId: r.projectId, code: r.code, name: r.name })),
          openAlerts: d.alerts.open, criticalAlerts: d.alerts.critical, alerts: d.alerts.top.map((a) => ({ alertNo: a.alertNo, project: a.project, severity: a.severity, message: a.message })),
          route: '/bi/control-tower' };
      } catch (error) {
        if ([403, 404].includes(error.status)) return null;
        throw error;
      }
    },
    progress(actor, { date, cutoffAt }) {
      if (!has('site_dprs') || !may(actor, 'site.dpr.view')) return null;
      const sc = scope(actor, 'site.dpr.view', 's.org_project_id', 's.id');
      const sites = db.prepare(`SELECT s.id, s.code, s.name, p.code AS project, p.id AS projectId,
          (SELECT d.status FROM site_dprs d WHERE d.dpr_site_id = s.id AND d.dpr_date = :date AND d.deleted_at IS NULL AND d.status IN ('SUBMITTED','APPROVED') AND COALESCE(d.submitted_at, d.created_at) <= :cutoff ORDER BY d.id DESC LIMIT 1) AS status,
          (SELECT d.id FROM site_dprs d WHERE d.dpr_site_id = s.id AND d.dpr_date = :date AND d.deleted_at IS NULL AND d.status IN ('SUBMITTED','APPROVED') AND COALESCE(d.submitted_at, d.created_at) <= :cutoff ORDER BY d.id DESC LIMIT 1) AS dprId
        FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
        WHERE s.company_id = :c AND s.status = 'ACTIVE' AND s.site_type = 'SITE' AND (${sc}) ORDER BY p.code, s.code`).all({ c: actor.companyId, date, cutoff: cutoffAt });
      return { date, sites: sites.length, submitted: sites.filter((s) => s.status).length, approved: sites.filter((s) => s.status === 'APPROVED').length,
        missing: sites.filter((s) => !s.status).map((s) => ({ siteId: s.id, site: `${s.code} ${s.name}`, project: s.project, route: `/site/dpr-compliance?siteId=${s.id}&date=${date}` })),
        rows: sites.filter((s) => s.status).map((s) => ({ site: `${s.code} ${s.name}`, project: s.project, status: s.status, route: `/site/dprs?id=${s.dprId}` })), route: `/site/dpr-compliance?date=${date}` };
    },
    attendance(actor, { date }) {
      if (!has('att_daily') || !may(actor, 'att.register.view')) return null;
      const sc = scope(actor, 'att.register.view', 's.org_project_id', 's.id');
      const rows = db.prepare(`SELECT p.code AS project, COUNT(*) AS marked,
          SUM(CASE WHEN a.status IN ('PRESENT','ON_DUTY','HOLIDAY_WORKED','WEEKLY_OFF_WORKED') THEN 1 WHEN a.status = 'HALF_DAY' THEN 0.5 ELSE 0 END) AS present,
          SUM(CASE WHEN a.status = 'ABSENT' THEN 1 ELSE 0 END) AS absent, SUM(CASE WHEN a.status = 'MISSING_PUNCH' THEN 1 ELSE 0 END) AS missing,
          SUM(a.worked_minutes) AS minutes
        FROM att_daily a JOIN org_sites s ON s.id = a.daily_site_id JOIN org_projects p ON p.id = s.org_project_id
        WHERE a.company_id = :c AND a.work_date = :date AND a.deleted_at IS NULL AND (${sc}) GROUP BY p.id ORDER BY p.code`).all({ c: actor.companyId, date });
      return { date, present: rows.reduce((a, r) => a + r.present, 0), absent: rows.reduce((a, r) => a + r.absent, 0), missingPunch: rows.reduce((a, r) => a + r.missing, 0),
        manHours: Math.round(rows.reduce((a, r) => a + (r.minutes ?? 0), 0) / 6) / 10, rows: rows.map((r) => ({ ...r, manHours: Math.round((r.minutes ?? 0) / 6) / 10, minutes: undefined })), route: `/att/register?date=${date}` };
    },
    stock(actor) {
      if (!has('inv_reorder_params') || !may(actor, 'inv.stock.view')) return null;
      const sc = scope(actor, 'inv.stock.view', 'st.org_project_id', 'st.org_site_id');
      const rows = db.prepare(`SELECT st.id AS storeId, st.code AS store, i.id AS itemId, i.code AS item, i.name, i.base_uom AS uom, r.min_qty AS minQty, r.reorder_level AS reorderLevel,
          COALESCE((SELECT SUM(b.qty_on_hand - b.qty_reserved) FROM inv_balances b WHERE b.store_id = r.store_id AND b.item_id = r.item_id AND b.deleted_at IS NULL), 0) AS available
        FROM inv_reorder_params r JOIN inv_stores st ON st.id = r.store_id AND st.store_status = 'ACTIVE' JOIN mdm_items i ON i.id = r.item_id
        WHERE r.company_id = :c AND r.deleted_at IS NULL AND (${sc}) ORDER BY st.code, i.code`).all({ c: actor.companyId })
        .filter((r) => r.available <= Math.max(r.minQty, r.reorderLevel));
      const q = (v) => Math.round(v) / 1000;
      const short = rows.map((r) => ({ store: r.store, item: `${r.item} ${r.name}`, uom: r.uom, available: q(r.available), minQty: q(r.minQty), reorderLevel: q(r.reorderLevel), stockOut: r.available <= 0,
        route: `/inv/balances?storeId=${r.storeId}&itemId=${r.itemId}` }));
      return { stockOuts: short.filter((r) => r.stockOut).length, belowMinimum: short.length, rows: short.slice(0, 50), route: '/inv/reorder-suggestions' };
    },
    receivables(actor, { today }) {
      if (!has('ar_invoices') || !may(actor, 'fin.invoice.view')) return null;
      const sc = scope(actor, 'fin.invoice.view', 'x.org_project_id');
      const open = 'x.amount_paise - x.received_paise - x.credited_paise - x.written_off_paise';
      const r = db.prepare(`SELECT COALESCE(SUM(MAX(${open}, 0)), 0) AS outstanding,
          COALESCE(SUM(CASE WHEN x.due_date < :today THEN MAX(${open}, 0) ELSE 0 END), 0) AS overdue,
          COALESCE(SUM(CASE WHEN x.due_date = :today THEN MAX(${open}, 0) ELSE 0 END), 0) AS dueToday
        FROM ar_invoices x WHERE x.company_id = :c AND x.status = 'APPROVED' AND x.deleted_at IS NULL AND (${sc})`).get({ c: actor.companyId, today });
      const due = db.prepare(`SELECT x.id, x.doc_no AS docNo, x.invoice_no AS invoiceNo, p.legal_name AS client, ${open} AS openPaise
        FROM ar_invoices x LEFT JOIN mdm_partners p ON p.id = x.partner_id WHERE x.company_id = :c AND x.status = 'APPROVED' AND x.deleted_at IS NULL AND x.due_date = :today
          AND ${open} > 0 AND (${sc}) ORDER BY ${open} DESC LIMIT 20`).all({ c: actor.companyId, today });
      return { outstanding: rs(r.outstanding), overdue: rs(r.overdue), dueToday: rs(r.dueToday),
        dueRows: due.map((d) => ({ docNo: d.invoiceNo ?? d.docNo, client: d.client, amount: rs(d.openPaise), route: `/finance/receivables?id=${d.id}` })), route: '/finance/receivables?tab=ageing' };
    },
    payables(actor, { today }) {
      if (!has('ap_bills') || !may(actor, 'fin.bill.view')) return null;
      const sc = scope(actor, 'fin.bill.view', 'x.org_project_id', 'x.org_site_id');
      const open = 'x.net_payable_paise - x.adjusted_paise - x.paid_paise';
      const r = db.prepare(`SELECT COALESCE(SUM(MAX(${open}, 0)), 0) AS outstanding,
          COALESCE(SUM(CASE WHEN COALESCE(x.msme_due_date, x.due_date) < :today THEN MAX(${open}, 0) ELSE 0 END), 0) AS overdue,
          COALESCE(SUM(CASE WHEN COALESCE(x.msme_due_date, x.due_date) = :today THEN MAX(${open}, 0) ELSE 0 END), 0) AS dueToday,
          COALESCE(SUM(CASE WHEN x.msme = 1 AND COALESCE(x.msme_due_date, x.due_date) <= :today THEN MAX(${open}, 0) ELSE 0 END), 0) AS msmeDue
        FROM ap_bills x WHERE x.company_id = :c AND x.status = 'APPROVED' AND x.deleted_at IS NULL AND (${sc})`).get({ c: actor.companyId, today });
      return { outstanding: rs(r.outstanding), overdue: rs(r.overdue), dueToday: rs(r.dueToday), msmeDue: rs(r.msmeDue), route: '/finance/payables' };
    },
    approvals(actor, { cutoffAt }) {
      if (!has('wf_tasks')) return null;
      const roles = JSON.stringify(actor.roles ?? []);
      const rows = db.prepare(`SELECT t.id, t.step_code AS step, t.due_at AS dueAt, t.created_at AS createdAt, i.doc_type AS docType, i.doc_ref AS docRef
        FROM wf_tasks t JOIN wf_instances i ON i.id = t.instance_id
        WHERE t.company_id = :c AND t.status = 'OPEN' AND t.created_at <= :cutoff
          AND (t.assignee_user_id = :u OR (t.assignee_user_id IS NULL AND t.assignee_role IN (SELECT value FROM json_each(:roles))))
        ORDER BY COALESCE(t.due_at, '9999') LIMIT 200`).all({ c: actor.companyId, cutoff: cutoffAt, u: actor.user, roles });
      const overdue = rows.filter((r) => r.dueAt && r.dueAt < cutoffAt);
      return { pending: rows.length, overdue: overdue.length,
        rows: rows.slice(0, 20).map((r) => ({ docType: r.docType, docRef: r.docRef, step: r.step, dueAt: r.dueAt, overdue: Boolean(r.dueAt && r.dueAt < cutoffAt), route: `/approvals/task?id=${r.id}` })), route: '/approvals' };
    },
    tasks(actor, { today }) {
      if (!has('tsk_tasks')) return null;
      const rows = db.prepare(`SELECT t.id, t.task_no AS taskNo, t.title, t.priority, t.due_date AS dueDate, t.status FROM tsk_tasks t
        JOIN tsk_assignees a ON a.task_id = t.id AND a.role = 'ASSIGNEE' AND a.is_active = 1 AND a.user_ref = :u
        WHERE t.company_id = :c AND t.is_active = 1 AND t.status NOT IN ('DONE','VERIFIED','CLOSED','CANCELLED')
          AND (t.priority IN ('URGENT','HIGH') OR (t.due_date IS NOT NULL AND t.due_date <= :today))
        ORDER BY CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END, COALESCE(t.due_date, '9999') LIMIT 50`).all({ c: actor.companyId, u: actor.user, today });
      return { critical: rows.length, overdue: rows.filter((r) => r.dueDate && r.dueDate < today).length, rows: rows.slice(0, 20).map((r) => ({ ...r, route: `/tasks/task?id=${r.id}` })), route: '/tasks' };
    },
    risks(actor) {
      if (!has('proj_risks') || !may(actor, 'proj.risk.view')) return null;
      const sc = scope(actor, 'proj.risk.view', 'x.org_project_id');
      const rows = db.prepare(`SELECT x.id, x.doc_no AS docNo, x.title, x.level, x.score, p.code AS project FROM proj_risks x JOIN org_projects p ON p.id = x.org_project_id
        WHERE x.company_id = :c AND x.rtype = 'RISK' AND x.status = 'OPEN' AND x.level IN ('HIGH','CRITICAL') AND x.deleted_at IS NULL AND (${sc})
        ORDER BY CASE x.level WHEN 'CRITICAL' THEN 0 ELSE 1 END, x.score DESC, x.id LIMIT 50`).all({ c: actor.companyId });
      return { critical: rows.filter((r) => r.level === 'CRITICAL').length, high: rows.filter((r) => r.level === 'HIGH').length,
        rows: rows.slice(0, 10).map((r) => ({ ...r, route: `/proj/risks?id=${r.id}` })), route: '/proj/risks' };
    },
    incidents(actor, { date }) {
      if (!has('hse_incidents') || !may(actor, 'hse.incident.view')) return null;
      const sc = scope(actor, 'hse.incident.view', 'x.org_project_id', 'x.org_site_id');
      const rows = db.prepare(`SELECT x.id, x.doc_no AS docNo, x.incident_type AS type, x.classification, x.severity, x.occurred_at AS occurredAt, p.code AS project
        FROM hse_incidents x JOIN org_projects p ON p.id = x.org_project_id
        WHERE x.company_id = :c AND x.deleted_at IS NULL AND x.incident_status <> 'CANCELLED' AND substr(x.occurred_at, 1, 10) = :date AND (${sc}) ORDER BY x.occurred_at`).all({ c: actor.companyId, date });
      return { count: rows.length, lostTime: rows.filter((r) => ['LTI', 'FATALITY'].includes(r.classification)).length, rows: rows.map((r) => ({ ...r, route: `/hse/incidents?id=${r.id}` })), route: '/hse/incidents' };
    },
  };

  /** FR-04: the exceptions, worst first. */
  function exceptionsOf(s) {
    const out = [];
    for (const m of s.progress?.missing ?? []) out.push({ kind: 'DPR_MISSING', severity: 'WARNING', text: `No DPR for ${s.progress.date} from ${m.site} (${m.project}).`, route: m.route });
    for (const a of (s.approvals?.rows ?? []).filter((r) => r.overdue)) out.push({ kind: 'APPROVAL_OVERDUE', severity: 'WARNING', text: `Approval overdue: ${a.docType} ${a.docRef ?? ''} (${a.step}).`.replace(' ()', ''), route: a.route });
    for (const r of (s.stock?.rows ?? []).filter((x) => x.stockOut)) out.push({ kind: 'STOCK_OUT', severity: 'CRITICAL', text: `Stock-out: ${r.item} at ${r.store}.`, route: r.route });
    for (const r of s.receivables?.dueRows ?? []) out.push({ kind: 'COLLECTION_DUE', severity: 'INFO', text: `Collection due today: ₹${r.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} from ${r.client ?? 'client'} (${r.docNo}).`, route: r.route });
    for (const r of (s.incidents?.rows ?? []).filter((x) => ['LTI', 'FATALITY'].includes(x.classification))) out.push({ kind: 'LOST_TIME_INCIDENT', severity: 'CRITICAL', text: `${r.classification === 'FATALITY' ? 'Fatality' : 'Lost-time injury'} ${r.docNo} at ${r.project}.`, route: r.route });
    const rank = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
  }

  /** FR-02: the executive summary, written by rules from the figures (labelled as rule-based; an AI summary is part 28.02). */
  function summaryOf(s, date) {
    const lines = [];
    const inr = (v) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (s.tower) lines.push(s.tower.red.length ? `${s.tower.red.length} project(s) are red overall (${s.tower.red.slice(0, 3).map((p) => p.code).join(', ')}); ${s.tower.openAlerts} executive alert(s) open, ${s.tower.criticalAlerts} critical.` : `No project is red overall; ${s.tower.openAlerts} executive alert(s) open.`);
    if (s.progress) lines.push(s.progress.missing.length ? `DPRs for ${date}: ${s.progress.submitted} of ${s.progress.sites} site(s) reported; ${s.progress.missing.length} missing.` : `All ${s.progress.sites} site(s) reported their DPR for ${date}.`);
    if (s.attendance) lines.push(`Attendance on ${date}: ${s.attendance.present} present, ${s.attendance.absent} absent, ${s.attendance.manHours} man-hours.`);
    if (s.stock) lines.push(s.stock.belowMinimum ? `${s.stock.stockOuts} item(s) out of stock and ${s.stock.belowMinimum} at or below the reorder level.` : 'No item is at or below its reorder level.');
    if (s.receivables) lines.push(`Receivables ${inr(s.receivables.outstanding)}, of which ${inr(s.receivables.overdue)} overdue; ${inr(s.receivables.dueToday)} due today.`);
    if (s.payables) lines.push(`Payables ${inr(s.payables.outstanding)}, ${inr(s.payables.dueToday)} due today${s.payables.msmeDue ? `, ${inr(s.payables.msmeDue)} to MSME suppliers due` : ''}.`);
    if (s.approvals) lines.push(`${s.approvals.pending} approval(s) wait for you, ${s.approvals.overdue} overdue.`);
    if (s.tasks) lines.push(`${s.tasks.critical} urgent or due task(s), ${s.tasks.overdue} overdue.`);
    if (s.risks) lines.push(`${s.risks.critical} critical and ${s.risks.high} high risk(s) open.`);
    if (s.incidents) lines.push(s.incidents.count ? `${s.incidents.count} incident(s) on ${date}, ${s.incidents.lostTime} lost-time.` : `No incident on ${date}.`);
    return { kind: 'RULE_BASED', lines };
  }

  const recipientActor = (companyId, username) => {
    const u = db.prepare("SELECT id, username, roles_json FROM iam_users WHERE company_id = ? AND username = ? AND is_active = 1 AND status = 'ACTIVE'").get(companyId, username);
    if (!u) return null;
    return authz.enrich({ companyId, userId: u.id, user: u.username, roles: JSON.parse(u.roles_json || '[]') });
  };
  const nextNo = (companyId) => `MR-${String(Number(db.prepare("SELECT COALESCE(MAX(CAST(substr(report_no, 4) AS INTEGER)), 0) + 1 AS n FROM mr_reports WHERE company_id = ?").get(companyId).n)).padStart(6, '0')}`;

  /**
   * The report of `reportDate` for `actor`: the stored one, else built now from the data as at the cut-off and stored (BR-01). The figures are
   * those the recipient may see. Returns the stored row id.
   */
  function generate(actor, reportDate, { trigger = 'on_demand' } = {}) {
    const existing = db.prepare('SELECT id FROM mr_reports WHERE company_id = ? AND report_date = ? AND recipient_user = ? AND deleted_at IS NULL').get(actor.companyId, reportDate, actor.user);
    if (existing) return { id: existing.id, created: false };
    const config = configFor(actor.companyId, actor.user, actor.roles);
    const cutoffAt = istInstant(reportDate, config.cutoff);
    if (Date.now() < Date.parse(cutoffAt)) throw badRequest(`The report of ${reportDate} is built from the data at ${config.cutoff}; that time has not come yet.`, [{ field: 'date', message: 'is after the cut-off' }]);
    const date = addDays(reportDate, -1); // "yesterday" of the report
    const sections = {};
    for (const key of config.sections) if (builders[key]) sections[key] = builders[key](actor, { date, today: reportDate, cutoffAt }) ?? undefined;
    for (const k of Object.keys(sections)) if (sections[k] === undefined) delete sections[k];
    const snapshot = { version: SNAPSHOT_VERSION, reportDate, dataDate: date, cutoff: config.cutoff, cutoffAt, recipient: actor.user, config: { scopeType: config.scopeType, scopeRef: config.scopeRef, version: config.version },
      sections, exceptions: exceptionsOf(sections), summary: summaryOf(sections, date) };
    const body = canonical(snapshot);
    const hash = createHash('sha256').update(body).digest('hex');
    return transaction(db, () => {
      const again = db.prepare('SELECT id FROM mr_reports WHERE company_id = ? AND report_date = ? AND recipient_user = ? AND deleted_at IS NULL').get(actor.companyId, reportDate, actor.user);
      if (again) return { id: again.id, created: false };
      const reportNo = nextNo(actor.companyId);
      const id = Number(db.prepare(`INSERT INTO mr_reports (company_id, report_no, report_date, recipient_id, recipient_user, config_id, cutoff_at, snapshot_json, snapshot_hash,
          data_snapshot_ref, exceptions, generated_at, trigger, status, created_by, source_type, source_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GENERATED', ?, 'mr_config', ?)`)
        .run(actor.companyId, reportNo, reportDate, actor.userId ?? null, actor.user, config.id ?? null, cutoffAt, body, hash, `sha256:${hash}`, snapshot.exceptions.length,
          new Date().toISOString(), trigger, actor.user === 'system' ? 'system' : actor.user, config.id ? String(config.id) : null).lastInsertRowid);
      writeAudit(db, { companyId: actor.companyId, entity: 'mr_reports', entityId: id, action: 'generate', newValues: { reportNo, reportDate, recipient: actor.user, hash, trigger }, actor: actor.user });
      return { id, created: true, reportNo, hash, exceptions: snapshot.exceptions.length, config };
    });
  }

  const rowOf = (actor, id) => {
    const row = db.prepare('SELECT * FROM mr_reports WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    // a report is personal: only its recipient opens it (it holds what their scope shows)
    if (!row || row.recipient_user !== actor.user) throw notFound('That morning report does not exist.');
    return row;
  };
  const present = (row, withSnapshot = true) => ({ id: row.id, reportNo: row.report_no, reportDate: row.report_date, recipient: row.recipient_user, cutoffAt: row.cutoff_at,
    generatedAt: row.generated_at, deliveredAt: row.delivered_at, channels: row.channels_json ? JSON.parse(row.channels_json) : [], exceptions: row.exceptions, hash: row.snapshot_hash,
    trigger: row.trigger, ...(withSnapshot ? { snapshot: JSON.parse(row.snapshot_json) } : {}) });

  function open(actor, { id = null, date = null } = {}) {
    guard(actor, 'bi.morning_report.view');
    if (id) return present(rowOf(actor, id));
    const reportDate = date ?? todayIST();
    const made = generate(actor, reportDate);
    return present(rowOf(actor, made.id));
  }

  /** BR-01: rebuild the report of a stored snapshot and say whether the figures are identical (they are: the snapshot is the source). */
  function verify(actor, id) {
    guard(actor, 'bi.morning_report.view');
    const row = rowOf(actor, id);
    const hash = createHash('sha256').update(canonical(JSON.parse(row.snapshot_json))).digest('hex');
    return { id, hash, stored: row.snapshot_hash, identical: hash === row.snapshot_hash };
  }

  function archive(actor, query = {}) {
    guard(actor, 'bi.morning_report.view');
    const where = ['company_id = :c', 'recipient_user = :u', 'deleted_at IS NULL'];
    const params = { c: actor.companyId, u: actor.user };
    if (query.from) { where.push('report_date >= :from'); params.from = query.from; }
    if (query.to) { where.push('report_date <= :to'); params.to = query.to; }
    const pageSize = Math.min(Math.max(Number(query.pageSize ?? 25), 1), 100);
    const page = Math.max(Number(query.page ?? 1), 1);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM mr_reports WHERE ${where.join(' AND ')}`).get(params).n;
    const rows = db.prepare(`SELECT * FROM mr_reports WHERE ${where.join(' AND ')} ORDER BY report_date DESC, id DESC LIMIT :limit OFFSET :offset`).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });
    return { rows: rows.map((r) => present(r, false)), total, page, pageSize };
  }

  /** The PDF, XLSX or CSV of a report, drawn from its snapshot (the same figures as the page). */
  function exportReport(actor, id, format) {
    guard(actor, 'bi.morning_report.view');
    const row = rowOf(actor, id);
    const s = JSON.parse(row.snapshot_json);
    const rows = [
      ...s.summary.lines.map((line) => ({ section: 'Executive summary', item: line, value: '' })),
      ...s.exceptions.map((e) => ({ section: `Exception (${e.severity.toLowerCase()})`, item: e.text, value: '' })),
      ...Object.entries(s.sections).flatMap(([key, sec]) => Object.entries(sec).filter(([, v]) => typeof v === 'number').map(([k, v]) => ({ section: key, item: k, value: String(v) }))),
    ];
    const buffer = writeExport(format, { columns: [{ key: 'section', label: 'Section', type: 'text' }, { key: 'item', label: 'Item', type: 'text' }, { key: 'value', label: 'Value', type: 'text' }],
      rows, title: `Morning report ${row.report_no} — ${row.report_date}`, sheetName: 'Morning report',
      footer: [`Data as at ${s.cutoff} IST on ${s.reportDate} (cut-off ${s.cutoffAt}) · snapshot sha256:${row.snapshot_hash.slice(0, 16)} · ${row.recipient_user}`, 'Executive summary: rule-based.'] });
    writeAudit(db, { companyId: actor.companyId, entity: 'mr_reports', entityId: id, action: format === 'pdf' ? 'print' : 'export', newValues: { format }, actor: actor.user });
    return { buffer, contentType: FORMATS[format], fileName: `morning-report-${row.report_date}.${format}` };
  }

  // ---------------------------------------------------------------- FR-03: delivery by schedule
  function recipientsOf(companyId) {
    const users = db.prepare("SELECT username, roles_json FROM iam_users WHERE company_id = ? AND is_active = 1 AND status = 'ACTIVE' ORDER BY username").all(companyId);
    return users.map((u) => ({ user: u.username, config: configFor(companyId, u.username, JSON.parse(u.roles_json || '[]')) })).filter((r) => r.config.active);
  }

  /** Deliver today's reports whose time has come. Idempotent: one report per recipient and date. */
  function deliverDue(companyId, { now = nowIstHhmm(), date = todayIST() } = {}) {
    const ctx = { companyId, user: 'system' };
    if (!context.flags.isOn(ctx, MR_FLAG)) return { delivered: 0 };
    try { requireMorningReport(context, ctx); } catch (error) { if (error.status === 404) return { delivered: 0 }; throw error; }
    let delivered = 0; const failures = [];
    for (const { user, config } of recipientsOf(companyId)) {
      if (config.time > now || now < config.cutoff) continue;
      const actor = recipientActor(companyId, user);
      if (!actor || !hasPermissionAnywhere(actor, 'bi.morning_report.view')) continue;
      if (db.prepare('SELECT 1 FROM mr_reports WHERE company_id = ? AND report_date = ? AND recipient_user = ? AND delivered_at IS NOT NULL').get(companyId, date, user)) continue;
      try {
        transaction(db, () => {
          const made = generate(actor, date, { trigger: 'schedule' });
          const row = db.prepare('SELECT * FROM mr_reports WHERE id = ?').get(made.id);
          const stamp = new Date().toISOString();
          db.prepare('UPDATE mr_reports SET delivered_at = ?, channels_json = ?, status = \'DELIVERED\', updated_by = \'system\', updated_at = ?, version = version + 1 WHERE id = ?')
            .run(stamp, JSON.stringify(config.channels), stamp, row.id);
          const snap = JSON.parse(row.snapshot_json);
          notificationsOf(db).notify({ companyId, templateCode: 'bi.morning_report.ready', recipients: [`user:${user}`], channels: config.channels,
            data: { reportDate: date, exceptions: String(row.exceptions), headline: snap.summary.lines[0] ?? '' }, link: `/bi/morning-report?id=${row.id}`, category: 'alerts',
            priority: row.exceptions ? 'NORMAL' : 'LOW', sourceType: 'mr_reports', sourceId: row.id, eventKey: `mr:${row.id}:delivered` });
          publishEvent(db, { type: 'bi.morning_report.delivered', entity: 'mr_reports', entityId: row.id, actorId: 'system', companyId,
            data: { reportNo: row.report_no, reportDate: date, recipient: user, exceptions: row.exceptions, hash: row.snapshot_hash } });
        });
        delivered += 1;
      } catch (error) {
        failures.push({ user, error: String(error.message ?? error).slice(0, 200) });
      }
    }
    if (failures.length) writeAudit(db, { companyId, entity: 'mr_reports', entityId: 0, action: 'delivery_failed', newValues: { date, failures }, actor: 'system' });
    if (failures.length && delivered === 0) throw new Error(`Morning report delivery failed for ${failures.length} recipient(s): ${failures[0].error}`);
    return { delivered, failed: failures.length };
  }

  jobs.register(DELIVERY_JOB, ({ params }) => {
    if (params.companyId) return deliverDue(params.companyId, params);
    let delivered = 0;
    for (const { id } of db.prepare('SELECT id FROM org_companies WHERE is_active = 1 ORDER BY id').all()) delivered += deliverDue(id).delivered;
    return { delivered };
  }, { description: 'Generates and delivers the morning management reports whose time has come (part 27.05).' });
  scheduler.define({ code: DELIVERY_JOB, cron: '*/15 * * * *', jobType: DELIVERY_JOB, description: 'Deliver the morning management reports due (every 15 minutes; each recipient once a day).' });

  // ---------------------------------------------------------------- configuration (maker-checker)
  function settings(actor) {
    guard(actor, 'bi.morning_report.view');
    const configure = hasPermissionAnywhere(actor, 'bi.morning_report.configure');
    return { configs: currentConfigs(db, actor.companyId), mine: configFor(actor.companyId, actor.user, actor.roles), sections: SECTIONS, channels: CHANNELS,
      requests: configure ? approvals.list(actor, { type: CONFIG_TYPE, status: undefined, limit: 25, offset: 0 }).rows : [], can: { configure } };
  }

  function propose(actor, input) {
    guard(actor, 'bi.morning_report.configure');
    if (input.time < input.cutoff) throw badRequest('Deliver the report after its cut-off.', [{ field: 'time', message: 'is before the cut-off' }]);
    if (input.scopeType === 'USER' && !db.prepare("SELECT 1 FROM iam_users WHERE company_id = ? AND username = ? AND is_active = 1").get(actor.companyId, input.scopeRef)) {
      throw badRequest('That person is not an active user of this company.', [{ field: 'scopeRef', message: 'is unknown' }]);
    }
    return transaction(db, () => {
      const current = currentConfigs(db, actor.companyId).find((c) => c.scopeType === input.scopeType && c.scopeRef === input.scopeRef);
      const target = `mr_${input.scopeType}_${input.scopeRef}`;
      if (db.prepare("SELECT 1 FROM core_change_requests WHERE company_id = ? AND type = ? AND target_type = ? AND status = 'SUBMITTED'").get(actor.companyId, CONFIG_TYPE, target)) {
        throw conflict('A change to this configuration is already awaiting approval.');
      }
      if (current && canonical({ s: current.sections, c: current.cutoff, t: current.time, ch: current.channels, p: current.pdf, a: current.active })
        === canonical({ s: input.sections, c: input.cutoff, t: input.time, ch: input.channels, p: input.pdf, a: input.active })) throw conflict('These settings are already in force.');
      return approvals.submit(actor, { type: CONFIG_TYPE, title: `Morning report for ${input.scopeType === 'ROLE' ? 'role' : 'user'} ${input.scopeRef}`, targetType: target, targetId: 0,
        reason: input.reason, chain: ['DIR|CFO'], payload: { ...input, reason: undefined, baseVersion: current?.version ?? 0 } });
    });
  }

  function decide(actor, id, input) {
    guard(actor, 'bi.morning_report.configure');
    if (approvals.get(actor, id).type !== CONFIG_TYPE) throw notFound('That configuration request does not exist.');
    return approvals.act(actor, id, input);
  }

  const service = { open, verify, archive, exportReport, generate, deliverDue, settings, propose, decide, configFor, recipientActor,
    queueDelivery(actor) { guard(actor, 'bi.morning_report.configure'); return jobs.enqueue(DELIVERY_JOB, { companyId: actor.companyId }, { companyId: actor.companyId, createdBy: actor.user }); } };
  services.set(db, service);
  return service;
}
