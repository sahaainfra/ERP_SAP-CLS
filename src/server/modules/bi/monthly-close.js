import { transaction } from '../../platform/db/index.js';
import { eventTypes, publishEvent } from '../../platform/events/index.js';
import { FORMATS, writeExport } from '../../platform/export/index.js';
import { badRequest, conflict, notFound, unprocessable } from '../../platform/http/errors.js';
import { projectPeriodLocks } from '../../platform/locks/index.js';
import { workflowTypes, workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { createBase, nowIso, rid } from '../proc/base.js';
import { STATUS, createFlow } from '../qa/flow.js';
import { invOf } from '../inv/index.js';
import { requireMetricCatalogueSource } from './domain-metrics.js';
import { assertPermissionAnywhere } from '../../platform/auth/index.js';

/**
 * Part 27.07 — the monthly closing protocol of a project, the Project MIS and the Budget Master.
 *
 * A close is one project and month. Its checklist is read live from the owners (FR-01):
 *   DPRS            every active site has approved DPRs and none waits (14.02)
 *   ATTENDANCE      the month's attendance is locked (07.06)
 *   MATERIAL_RECON  no active site lacks an approved material reconciliation (16.10, its `missing` reader)
 *   MEASUREMENT     no measurement of the month waits for approval (22.01)
 *   CVR             the month's cost-value reconciliation is approved (22.09)                   depends on MEASUREMENT
 *   COSTS_POSTED    no cost posting of the project failed in the month (23.02)
 *   FORECAST        the month's cost forecast is approved (23.11)                               depends on CVR, COSTS_POSTED
 *   FINANCE_CLOSED  the finance period is closed (23.14)                                         depends on COSTS_POSTED
 * A close is sent for approval only when every mandatory step passes (BR-01); sending freezes the Project MIS (FR-02) and the Budget Master
 * (FR-03, budget vs committed vs actual vs forecast by cost head from the approved forecast) in the record. The chain is QS (when someone else
 * prepared it) → PM → PD, through the workflow engine; the approval re-checks every step and locks the month: DPRs dated in it are refused
 * by the shared period-lock guard (FR-04), and `bi.monthly_close.locked` tells the modules. An approved close changes only by amendment.
 */

export const MC_FLAG = 'ff.bi.p2707';
export const MC_DOC = 'BI_MONTHLY_CLOSE';
export const STEPS = Object.freeze([
  { code: 'DPRS', name: 'DPRs complete', owner: 'PM', module: 'site', deps: [] },
  { code: 'ATTENDANCE', name: 'Attendance locked', owner: 'HRMGR', module: 'hr', deps: [] },
  { code: 'MATERIAL_RECON', name: 'Material reconciliation approved', owner: 'STOREMGR', module: 'inv', deps: [] },
  { code: 'MEASUREMENT', name: 'Measurements and bills updated', owner: 'QS', module: 'bill', deps: [] },
  { code: 'CVR', name: 'Cost-value reconciliation approved', owner: 'QS', module: 'bill', deps: ['MEASUREMENT'] },
  { code: 'COSTS_POSTED', name: 'Costs posted', owner: 'ACCMGR', module: 'fin', deps: [] },
  { code: 'FORECAST', name: 'Cost forecast approved', owner: 'PCMGR', module: 'fin', deps: ['CVR', 'COSTS_POSTED'] },
  { code: 'FINANCE_CLOSED', name: 'Finance period closed', owner: 'CFO', module: 'fin', deps: ['COSTS_POSTED'] },
].map((s) => Object.freeze({ ...s, mandatory: true })));

const rs = (p) => (p == null ? null : Math.round(Number(p)) / 100);
const monthEnd = (period) => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const nextMonth = (period) => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7); };
const services = new WeakMap();
export const monthlyClosesOf = (db) => services.get(db) ?? null;

const lockedShape = { type: 'object', required: ['closeId', 'projectId', 'period'], properties: { closeId: { type: 'integer' }, docNo: { type: 'string' }, projectId: { type: 'integer' }, period: { type: 'string' } } };
eventTypes.define({ type: 'bi.monthly_close.locked', version: 1, schema: lockedShape, owner: 'bi',
  description: 'The monthly close of a project was approved and the month locked (part 27.07 FR-04): data { closeId, docNo, projectId, period }. Project modules refuse back-dated changes in that month; MIS and the Budget Master of the month are frozen in the close.' });

/** FR-04: the monthly close is a source of the shared period lock. */
projectPeriodLocks.register({
  code: 'bi.monthly_close',
  locked(db, { companyId, projectId, date }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'mc_monthly_closes'").get()) return null;
    const r = db.prepare(`SELECT doc_no, period, locked_at FROM mc_monthly_closes WHERE company_id = ? AND project_id = ? AND period = ? AND lock_state = 'LOCKED' AND deleted_at IS NULL
      ORDER BY id DESC LIMIT 1`).get(companyId, projectId, date.slice(0, 7));
    return r ? { ref: r.doc_no, period: r.period, lockedAt: r.locked_at } : null;
  },
});

const step = (code, name, role, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
const decideWith = (outcome) => (db, { instance, actor, comment }) => monthlyClosesOf(db)?.flow.decide(instance, actor, outcome, comment);
workflowTypes.register({
  docType: MC_DOC, label: 'Project monthly close', processOwner: 'PD', route: (id) => `/bi/monthly-close?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT m.*, p.code FROM mc_monthly_closes m JOIN org_projects p ON p.id = m.project_id WHERE m.id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `Monthly close ${r.code} ${r.period}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) {
    const r = db.prepare('SELECT * FROM mc_monthly_closes WHERE id = ?').get(Number(id)); if (!r) return null;
    const c = JSON.parse(r.checklist_json || '[]'); const mis = JSON.parse(r.mis_json || '{}');
    return { fields: [{ label: 'Month', value: r.period }, { label: 'Checklist', value: `${c.filter((x) => x.state === 'PASS').length} of ${c.length} steps passed` },
      { label: 'Budget / EAC', value: `₹${mis.cost?.budget ?? '—'} / ₹${mis.cost?.eac ?? '—'}` }, { label: 'CVR margin', value: mis.cvr ? `₹${mis.cvr.margin ?? '—'} (${mis.cvr.marginPct ?? '—'} %)` : '—' }] };
  },
  defaultDefinition: { name: 'Monthly close: QS (when someone else prepared it), then the project manager, then the project director', settings: { resubmit: 'first', distinctApprovers: true },
    steps: [step('QS', 'Quantity surveyor review', 'QS', { field: 'makerRole', op: 'ne', value: 'QS' }), step('PM', 'Project manager review', 'PM'), step('PD', 'Management approval (project director)', 'PD')] },
  hooks: { onApproved: decideWith('APPROVED'), onRejected: decideWith('REJECTED'), onReturned: decideWith('RETURNED'), onCancelled: decideWith('CANCELLED') },
});

export function requireMonthlyClose(context, actor) {
  if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, MC_FLAG)) throw notFound('The monthly close is unavailable.');
  requireMetricCatalogueSource(context, actor);
}

export function createMonthlyClose(context) {
  const { db } = context;
  const base = createBase({ db });
  const { may, need, audit, authz } = base;
  const has = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
  const rolesOf = (companyId, user) => { const u = db.prepare('SELECT roles_json FROM iam_users WHERE company_id = ? AND username = ?').get(companyId, user); return u ? JSON.parse(u.roles_json || '[]') : []; };
  const one = (sql, ...a) => db.prepare(sql).get(...a);

  // ---------------------------------------------------------------- FR-01: the checklist, live from the owners
  function checksOf(companyId, projectId, period) {
    const from = `${period}-01`; const to = monthEnd(period); const out = {};
    const sites = db.prepare("SELECT id, code FROM org_sites WHERE company_id = ? AND org_project_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL AND site_type = 'SITE'").all(companyId, projectId);
    if (has('site_dprs')) {
      const pending = one("SELECT COUNT(*) AS n FROM site_dprs WHERE company_id = ? AND org_project_id = ? AND dpr_date BETWEEN ? AND ? AND status IN ('DRAFT','SUBMITTED','RETURNED') AND deleted_at IS NULL", companyId, projectId, from, to).n;
      const without = sites.filter((s) => !one("SELECT 1 FROM site_dprs WHERE dpr_site_id = ? AND dpr_date BETWEEN ? AND ? AND status = 'APPROVED' AND deleted_at IS NULL", s.id, from, to));
      out.DPRS = { pass: pending === 0 && without.length === 0, detail: pending || without.length ? `${pending} DPR(s) wait for approval; ${without.length} site(s) without an approved DPR (${without.map((s) => s.code).join(', ') || '—'})` : `${sites.length} site(s) reported, none waiting`, route: `/site/dpr-compliance?projectId=${projectId}&from=${from}&to=${to}` };
    }
    if (has('att_period_locks')) {
      const covers = (siteId) => one(`SELECT 1 FROM att_period_locks WHERE company_id = ? AND status = 'LOCKED' AND deleted_at IS NULL AND period_start <= ? AND period_end >= ? AND (lock_site_id IS NULL${siteId ? ' OR lock_site_id = ?' : ''})`, companyId, from, to, ...(siteId ? [siteId] : []));
      const open = sites.filter((s) => !covers(s.id));
      out.ATTENDANCE = { pass: sites.length ? open.length === 0 : Boolean(covers(null)), detail: open.length ? `Attendance not locked for ${open.map((s) => s.code).join(', ')}` : 'Attendance of the month is locked', route: '/att/register' };
    }
    const mrc = invOf(db)?.mrc?.recons;
    if (mrc) {
      const missing = mrc.missing(companyId, period).filter((m) => m.projectId === projectId);
      out.MATERIAL_RECON = { pass: missing.length === 0, detail: missing.length ? `No approved reconciliation for ${missing.map((m) => m.site).join(', ')}` : 'Every site with stores is reconciled', route: `/inv/reconciliations?period=${period}` };
    }
    if (has('bill_mb_entries')) {
      const n = one("SELECT COUNT(*) AS n FROM bill_mb_entries WHERE company_id = ? AND org_project_id = ? AND measured_on BETWEEN ? AND ? AND status IN ('DRAFT','SUBMITTED','RETURNED') AND deleted_at IS NULL", companyId, projectId, from, to).n;
      out.MEASUREMENT = { pass: n === 0, detail: n ? `${n} measurement(s) of the month wait for approval` : 'Every measurement of the month is approved', route: `/bill/mb?projectId=${projectId}` };
    }
    if (has('bill_cvr_reports')) {
      const r = one("SELECT id, doc_no FROM bill_cvr_reports WHERE company_id = ? AND org_project_id = ? AND period = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1", companyId, projectId, period);
      out.CVR = { pass: Boolean(r), detail: r ? `${r.doc_no} approved` : 'No approved cost-value reconciliation for the month', route: r ? `/bill/cvr?id=${r.id}` : `/bill/cvr?projectId=${projectId}`, ref: r?.doc_no };
    }
    if (has('fin_posting_log')) {
      const n = one("SELECT COUNT(*) AS n FROM fin_posting_log WHERE company_id = ? AND project_id = ? AND event_date BETWEEN ? AND ? AND log_status = 'FAILED'", companyId, projectId, from, to).n;
      out.COSTS_POSTED = { pass: n === 0, detail: n ? `${n} posting(s) of the month failed and are not resolved` : 'Every cost of the month is posted', route: '/finance/posting' };
    }
    if (has('fc_forecasts')) {
      const r = one("SELECT id, doc_no FROM fc_forecasts WHERE company_id = ? AND org_project_id = ? AND period = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY version_no DESC, id DESC LIMIT 1", companyId, projectId, period);
      out.FORECAST = { pass: Boolean(r), detail: r ? `${r.doc_no} approved` : 'No approved cost forecast for the month', route: r ? `/finance/cost-forecasts?id=${r.id}` : '/finance/cost-forecasts', ref: r?.doc_no };
    }
    if (has('close_periods')) {
      const r = one("SELECT id, doc_no FROM close_periods WHERE company_id = ? AND period = ? AND close_state = 'CLOSED' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1", companyId, period);
      out.FINANCE_CLOSED = { pass: Boolean(r), detail: r ? `${r.doc_no} closed` : 'The finance period is not closed', route: r ? `/finance/close?id=${r.id}` : '/finance/close', ref: r?.doc_no };
    }
    const states = {};
    return STEPS.map((s) => {
      const c = out[s.code] ?? { pass: false, detail: 'The owning module is not installed', route: null };
      const waiting = s.deps.filter((d) => states[d] !== 'PASS');
      const state = c.pass ? 'PASS' : waiting.length ? 'WAITING' : 'OPEN';
      states[s.code] = state;
      return { code: s.code, name: s.name, ownerRole: s.owner, module: s.module, mandatory: s.mandatory, dependsOn: s.deps, waitingFor: c.pass ? [] : waiting, state, detail: c.detail, route: c.route, ref: c.ref ?? null };
    });
  }

  // ---------------------------------------------------------------- FR-02: the Project MIS, FR-03: the Budget Master
  function misOf(companyId, projectId, period) {
    const from = `${period}-01`; const to = monthEnd(period); const m = {};
    if (has('prs_periods')) {
      const p = one(`SELECT p.id, p.doc_no, p.period_end, p.physical_pct, p.planned_pct, e.spi, e.cpi FROM prs_periods p LEFT JOIN prs_evm e ON e.period_id = p.id AND e.wbs_id IS NULL AND e.deleted_at IS NULL
        WHERE p.company_id = ? AND p.org_project_id = ? AND p.status = 'APPROVED' AND p.period_end <= ? AND p.deleted_at IS NULL ORDER BY p.period_end DESC LIMIT 1`, companyId, projectId, to);
      m.progress = p ? { ref: p.doc_no, asOf: p.period_end, physicalPct: p.physical_pct == null ? null : p.physical_pct / 100, plannedPct: p.planned_pct == null ? null : p.planned_pct / 100,
        spi: p.spi == null ? null : p.spi / 10000, cpi: p.cpi == null ? null : p.cpi / 10000, route: `/site/periods?id=${p.id}` } : null;
    }
    const fc = has('fc_forecasts') ? one("SELECT id, doc_no FROM fc_forecasts WHERE company_id = ? AND org_project_id = ? AND period = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY version_no DESC, id DESC LIMIT 1", companyId, projectId, period) : null;
    const lines = fc ? db.prepare(`SELECT COALESCE(h.code, 'UNMAPPED') AS headCode, COALESCE(h.name, 'Not mapped to a cost head') AS headName, SUM(l.budget_paise) AS budget, SUM(l.committed_paise) AS committed,
        SUM(l.actual_paise) AS actual, SUM(l.eac_paise) AS eac FROM fc_forecast_lines l LEFT JOIN fin_cost_codes c ON c.id = l.cost_code_id LEFT JOIN fin_cost_heads h ON h.id = c.cost_head_id
      WHERE l.forecast_id = ? AND l.deleted_at IS NULL GROUP BY h.id ORDER BY headCode`).all(fc.id) : [];
    const budgetMaster = { forecastRef: fc?.doc_no ?? null, route: fc ? `/finance/cost-forecasts?id=${fc.id}` : null,
      rows: lines.map((l) => ({ head: l.headCode, name: l.headName, budget: rs(l.budget), committed: rs(l.committed), actual: rs(l.actual), eac: rs(l.eac), variance: rs(l.budget - l.eac),
        variancePct: l.budget ? Math.round(((l.budget - l.eac) * 1000) / l.budget) / 10 : null })) };
    const sum = (k) => Math.round(budgetMaster.rows.reduce((n, r) => n + (r[k] ?? 0), 0) * 100) / 100;
    budgetMaster.totals = { budget: sum('budget'), committed: sum('committed'), actual: sum('actual'), eac: sum('eac'), variance: sum('variance') };
    m.cost = { budget: budgetMaster.totals.budget, committed: budgetMaster.totals.committed, actual: budgetMaster.totals.actual, eac: budgetMaster.totals.eac, variance: budgetMaster.totals.variance, route: budgetMaster.route };
    if (has('bill_cvr_reports')) {
      const c = one("SELECT id, doc_no, margin_paise, margin_bp, forecast_margin_bp FROM bill_cvr_reports WHERE company_id = ? AND org_project_id = ? AND period = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1", companyId, projectId, period);
      m.cvr = c ? { ref: c.doc_no, margin: rs(c.margin_paise), marginPct: c.margin_bp == null ? null : c.margin_bp / 100, forecastMarginPct: c.forecast_margin_bp == null ? null : c.forecast_margin_bp / 100, route: `/bill/cvr?id=${c.id}` } : null;
    }
    if (has('bill_client_bills')) {
      const b = one("SELECT COALESCE(SUM(gross_paise), 0) AS v, COUNT(*) AS n FROM bill_client_bills WHERE company_id = ? AND org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND period_to BETWEEN ? AND ?", companyId, projectId, from, to);
      const r = has('ar_receipts') && has('ar_allocations') ? one(`SELECT COALESCE(SUM(a.amount_paise), 0) AS v FROM ar_allocations a JOIN ar_receipts r ON r.id = a.receipt_id JOIN ar_invoices i ON i.id = a.invoice_id
        WHERE r.company_id = ? AND i.org_project_id = ? AND r.status = 'APPROVED' AND r.deleted_at IS NULL AND r.receipt_date BETWEEN ? AND ?`, companyId, projectId, from, to) : { v: 0 };
      m.billing = { billed: rs(b.v), bills: b.n, collected: rs(r.v), route: `/bill/client-bills?projectId=${projectId}` };
    }
    if (has('ap_bills')) {
      const p = one("SELECT COALESCE(SUM(net_payable_paise - adjusted_paise - paid_paise), 0) AS v FROM ap_bills WHERE company_id = ? AND org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND net_payable_paise - adjusted_paise - paid_paise > 0", companyId, projectId);
      m.cash = { payablesOpen: rs(p.v), receivablesOpen: m.billing ? Math.max(0, Math.round(((m.billing.billed ?? 0) - (m.billing.collected ?? 0)) * 100) / 100) : null, route: '/finance/payables' };
    }
    if (has('site_dprs')) {
      const r = one(`SELECT COALESCE(SUM(l.man_days), 0) AS manDays FROM site_dpr_labour l JOIN site_dprs d ON d.id = l.dpr_id WHERE d.company_id = ? AND d.org_project_id = ? AND d.status = 'APPROVED' AND d.dpr_date BETWEEN ? AND ? AND l.deleted_at IS NULL`, companyId, projectId, from, to);
      const e = one(`SELECT COALESCE(SUM(x.hours_worked), 0) AS h, COALESCE(SUM(x.hours_idle + x.hours_breakdown), 0) AS idle FROM site_dpr_equipment x JOIN site_dprs d ON d.id = x.dpr_id WHERE d.company_id = ? AND d.org_project_id = ? AND d.status = 'APPROVED' AND d.dpr_date BETWEEN ? AND ? AND x.deleted_at IS NULL`, companyId, projectId, from, to);
      m.resources = { manDays: r.manDays / 1000, plantHours: e.h / 1000, idleHours: e.idle / 1000, route: `/site/dprs?projectId=${projectId}` };
    }
    m.qualityHse = {
      ncrsOpen: has('qa_ncrs') ? one("SELECT COUNT(*) AS n FROM qa_ncrs WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL AND status NOT IN ('CLOSED','CANCELLED','REJECTED')", companyId, projectId).n : null,
      incidents: has('hse_incidents') ? one("SELECT COUNT(*) AS n FROM hse_incidents WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL AND incident_status <> 'CANCELLED' AND substr(occurred_at, 1, 7) = ?", companyId, projectId, period).n : null,
      lostTime: has('hse_incidents') ? one("SELECT COUNT(*) AS n FROM hse_incidents WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL AND incident_status <> 'CANCELLED' AND classification IN ('LTI','FATALITY') AND substr(occurred_at, 1, 7) = ?", companyId, projectId, period).n : null,
      route: '/hse/incidents' };
    if (has('proj_risks')) m.risks = { high: one("SELECT COUNT(*) AS n FROM proj_risks WHERE company_id = ? AND org_project_id = ? AND rtype = 'RISK' AND status = 'OPEN' AND level IN ('HIGH','CRITICAL') AND deleted_at IS NULL", companyId, projectId).n, route: `/proj/risks?projectId=${projectId}` };
    if (has('plan_activities') && has('plan_schedules')) {
      const nm = nextMonth(period); const nmEnd = monthEnd(nm);
      const a = one(`SELECT COUNT(*) AS n FROM plan_activities a JOIN plan_schedules s ON s.id = a.schedule_id WHERE s.company_id = ? AND s.org_project_id = ? AND a.deleted_at IS NULL AND s.deleted_at IS NULL
        AND a.es BETWEEN ? AND ?`, companyId, projectId, `${nm}-01`, nmEnd);
      m.lookAhead = { month: nm, activitiesStarting: a?.n ?? 0, route: `/plan/lookahead?projectId=${projectId}` };
    }
    return { mis: m, budgetMaster };
  }

  // ---------------------------------------------------------------- the record (approval-controlled through the shared flow)
  const flow = createFlow({ db, base, docType: MC_DOC, table: 'mc_monthly_closes', perm: 'bi.monthly_close', label: 'monthly close', route: '/bi/monthly-close?id=',
    where: (r) => ({ pid: r.project_id, sid: null }), prefix: 'MC', notifyCode: 'bi.monthly_close.decided',
    ctx: (r) => ({ period: r.period, makerRole: rolesOf(r.company_id, r.requested_by ?? r.created_by).includes('QS') ? 'QS' : 'OTHER' }),
    title: (r) => `Monthly close ${r.period}`,
    beforeSubmit: (actor, r) => {
      requireMonthlyClose(context, { companyId: r.company_id, user: actor.user });
      const checks = checksOf(r.company_id, r.project_id, r.period);
      const open = checks.filter((c) => c.mandatory && c.state !== 'PASS');
      if (open.length) throw unprocessable(`The close cannot be sent while mandatory steps are open: ${open.map((c) => `${c.name} (${c.detail})`).join('; ')}.`, open.map((c) => ({ field: c.code, message: c.detail })));
      const { mis, budgetMaster } = misOf(r.company_id, r.project_id, r.period);
      db.prepare('UPDATE mc_monthly_closes SET checklist_json = ?, mis_json = ?, budget_master_json = ?, snapshot_at = ? WHERE id = ?').run(JSON.stringify(checks), JSON.stringify(mis), JSON.stringify(budgetMaster), nowIso(), r.id);
    },
    onApproved: (actor, r) => {
      const x = db.prepare('SELECT * FROM mc_monthly_closes WHERE id = ?').get(r.id);
      // BR-01: the lock only after every mandatory step is still approved at the moment of approval
      const open = checksOf(x.company_id, x.project_id, x.period).filter((c) => c.mandatory && c.state !== 'PASS');
      if (open.length) throw unprocessable(`Steps reopened since the close was sent: ${open.map((c) => c.name).join('; ')}. Return it to the preparer.`);
      const now = nowIso();
      db.prepare("UPDATE mc_monthly_closes SET lock_state = 'LOCKED', locked_at = ? WHERE id = ?").run(now, x.id);
      if (x.parent_close_id) db.prepare("UPDATE mc_monthly_closes SET status = 'SUPERSEDED', lock_state = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, x.parent_close_id);
      audit(actor, 'mc_monthly_closes', x.id, 'lock', x.company_id, { newValues: { period: x.period, projectId: x.project_id } });
      publishEvent(db, { type: 'bi.monthly_close.locked', entity: 'mc_monthly_closes', entityId: x.id, actorId: actor.user, companyId: x.company_id, projectId: x.project_id, data: { closeId: x.id, docNo: x.doc_no, projectId: x.project_id, period: x.period } });
    },
  });

  const guard = (actor) => requireMonthlyClose(context, actor);
  const projectOf = (actor, projectId, key) => {
    const p = db.prepare("SELECT id, code, name FROM org_projects WHERE id = ? AND company_id = ? AND deleted_at IS NULL").get(rid(projectId), actor.companyId);
    if (!p || !may(actor, 'bi.monthly_close.view', p.id)) throw notFound('That project does not exist.');
    need(actor, key, 'do that for this project', p.id);
    return p;
  };

  function view(actor, r, detail = true) {
    const p = db.prepare('SELECT code, name FROM org_projects WHERE id = ?').get(r.project_id);
    const live = ['DRAFT', 'RETURNED'].includes(r.status);
    const checklist = live ? checksOf(r.company_id, r.project_id, r.period) : JSON.parse(r.checklist_json || '[]');
    const can = flow.can(actor, r);
    const out = { id: r.id, docNo: r.doc_no, projectId: r.project_id, project: `${p?.code} ${p?.name}`, projectCode: p?.code, period: r.period, versionNo: r.version_no, parentId: r.parent_close_id,
      status: r.status, statusLabel: STATUS[r.status] ?? r.status, lockState: r.lock_state, lockedAt: r.locked_at, requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at,
      snapshotAt: r.snapshot_at, rowVersion: r.version, checklist, passed: checklist.filter((c) => c.state === 'PASS').length, steps: checklist.length,
      can: { ...can, amend: may(actor, 'bi.monthly_close.amend', r.project_id) && r.status === 'APPROVED' && r.lock_state === 'LOCKED' && !db.prepare("SELECT 1 FROM mc_monthly_closes WHERE parent_close_id = ? AND deleted_at IS NULL AND status IN ('DRAFT','SUBMITTED','RETURNED')").get(r.id),
        print: may(actor, 'bi.monthly_close.print', r.project_id), export: may(actor, 'bi.monthly_close.export', r.project_id) } };
    if (detail) {
      const frozen = !live && r.mis_json;
      const live2 = frozen ? null : misOf(r.company_id, r.project_id, r.period);
      out.mis = frozen ? JSON.parse(r.mis_json) : live2.mis;
      out.budgetMaster = frozen ? JSON.parse(r.budget_master_json) : live2.budgetMaster;
      out.frozen = Boolean(frozen);
      out.approval = flow.approveInfo(actor, r);
    }
    return out;
  }

  const closes = {
    flow,
    /** The board: every project in scope × its close of the month (or none), grouped by stage. */
    board(actor, q) {
      guard(actor); assertPermissionAnywhere(actor, 'bi.monthly_close.view');
      const period = q.period ?? todayIST().slice(0, 7);
      const scope = authz.scopeFilter(actor, 'bi.monthly_close.view', { project: 'p.id' }).sql;
      const projects = db.prepare(`SELECT p.id, p.code, p.name FROM org_projects p WHERE p.company_id = ? AND p.deleted_at IS NULL AND p.status IN ('ACTIVE','ON_HOLD') AND (${scope}) ORDER BY p.code`).all(actor.companyId);
      const cards = projects.map((p) => {
        const r = db.prepare("SELECT * FROM mc_monthly_closes WHERE company_id = ? AND project_id = ? AND period = ? AND deleted_at IS NULL AND status NOT IN ('CANCELLED','REJECTED','SUPERSEDED') ORDER BY id DESC LIMIT 1").get(actor.companyId, p.id, period);
        const checks = r && !['DRAFT', 'RETURNED'].includes(r.status) ? JSON.parse(r.checklist_json || '[]') : checksOf(actor.companyId, p.id, period);
        const column = !r ? 'NOT_STARTED' : r.lock_state === 'LOCKED' ? 'LOCKED' : r.status === 'SUBMITTED' ? 'IN_APPROVAL' : 'PREPARING';
        return { projectId: p.id, project: `${p.code} ${p.name}`, code: p.code, column, closeId: r?.id ?? null, docNo: r?.doc_no ?? null, status: r?.status ?? null, statusLabel: r ? STATUS[r.status] : null,
          rowVersion: r?.version ?? null, passed: checks.filter((c) => c.state === 'PASS').length, steps: checks.length, steps2: checks.map((c) => ({ code: c.code, state: c.state })),
          blocking: checks.filter((c) => c.state !== 'PASS').map((c) => c.name),
          can: { create: !r && may(actor, 'bi.monthly_close.create', p.id), submit: Boolean(r) && ['DRAFT', 'RETURNED'].includes(r.status) && may(actor, 'bi.monthly_close.submit', p.id), withdraw: r?.status === 'SUBMITTED' && r.requested_by === actor.user } };
      });
      const columns = ['NOT_STARTED', 'PREPARING', 'IN_APPROVAL', 'LOCKED'].map((key) => ({ key, count: cards.filter((c) => c.column === key).length }));
      return { period, steps: STEPS.map((s) => ({ code: s.code, name: s.name, ownerRole: s.owner })), columns, cards };
    },
    list(actor, q = {}) {
      guard(actor); assertPermissionAnywhere(actor, 'bi.monthly_close.view');
      const scope = authz.scopeFilter(actor, 'bi.monthly_close.view', { project: 'x.project_id' }).sql;
      const where = ['x.company_id = :c', 'x.deleted_at IS NULL', `(${scope})`]; const params = { c: actor.companyId };
      if (q.period) { where.push('x.period = :period'); params.period = q.period; }
      if (q.projectId) { where.push('x.project_id = :project'); params.project = Number(q.projectId); }
      if (q.status) { where.push('x.status = :status'); params.status = q.status; }
      const pageSize = Math.min(Math.max(Number(q.pageSize ?? 25), 1), 100); const page = Math.max(Number(q.page ?? 1), 1);
      const total = db.prepare(`SELECT COUNT(*) AS n FROM mc_monthly_closes x WHERE ${where.join(' AND ')}`).get(params).n;
      const rows = db.prepare(`SELECT x.*, p.code FROM mc_monthly_closes x JOIN org_projects p ON p.id = x.project_id WHERE ${where.join(' AND ')} ORDER BY x.period DESC, p.code, x.id DESC LIMIT :limit OFFSET :offset`)
        .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });
      return { rows: rows.map((r) => ({ id: r.id, docNo: r.doc_no, project: r.code, projectId: r.project_id, period: r.period, versionNo: r.version_no, status: r.status, statusLabel: STATUS[r.status], lockState: r.lock_state, lockedAt: r.locked_at })), total, page, pageSize };
    },
    get(actor, id) { guard(actor); return view(actor, flow.row(actor, id)); },
    create(actor, { projectId, period, remarks }) {
      guard(actor);
      const p = projectOf(actor, projectId, 'bi.monthly_close.create');
      if (period > todayIST().slice(0, 7)) throw badRequest('A month that has not started cannot be closed.', [{ field: 'period', message: 'is in the future' }]);
      return transaction(db, () => {
        const dup = db.prepare("SELECT doc_no FROM mc_monthly_closes WHERE company_id = ? AND project_id = ? AND period = ? AND deleted_at IS NULL AND status NOT IN ('CANCELLED','REJECTED','SUPERSEDED')").get(actor.companyId, p.id, period);
        if (dup) throw conflict(`${dup.doc_no} is already the close of ${p.code} for ${period}: open it instead.`);
        const docNo = flow.next(actor);
        const coreP = db.prepare("SELECT id FROM core_periods WHERE company_id = ? AND start_date = ? LIMIT 1").get(actor.companyId, `${period}-01`);
        const id = Number(db.prepare(`INSERT INTO mc_monthly_closes (company_id, doc_no, project_id, period, period_id, status, lock_state, requested_by, created_by, source_type, remarks)
          VALUES (?, ?, ?, ?, ?, 'DRAFT', 'OPEN', ?, ?, 'api', ?)`).run(actor.companyId, docNo, p.id, period, coreP?.id ?? null, actor.user, actor.user, remarks ?? null).lastInsertRowid);
        audit(actor, 'mc_monthly_closes', id, 'create', actor.companyId, { newValues: { projectId: p.id, period } });
        return closes.get(actor, id);
      });
    },
    update(actor, id, { remarks, rowVersion }) {
      guard(actor); const r = flow.row(actor, id, 'bi.monthly_close.edit');
      if (!['DRAFT', 'RETURNED'].includes(r.status)) throw unprocessable('Only a draft or a returned close is changed.');
      if (rowVersion !== r.version) throw conflict('Someone changed this close; reload it.');
      db.prepare('UPDATE mc_monthly_closes SET remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(remarks ?? null, actor.user, nowIso(), r.id);
      audit(actor, 'mc_monthly_closes', r.id, 'update', r.company_id, { oldValues: { remarks: r.remarks }, newValues: { remarks } });
      return closes.get(actor, r.id);
    },
    remove(actor, id) { guard(actor); flow.remove(actor, id); return { id: Number(id), deleted: true }; },
    submit(actor, id, rowVersion) {
      guard(actor); const r = flow.row(actor, id, 'bi.monthly_close.submit');
      if (rowVersion !== undefined && rowVersion !== r.version) throw conflict('Someone changed this close; reload it.');
      flow.submit(actor, id); return closes.get(actor, id);
    },
    withdraw(actor, id, b) { guard(actor); flow.withdraw(actor, id, b); return closes.get(actor, id); },
    cancel(actor, id, b) { guard(actor); flow.cancel(actor, id, b); return closes.get(actor, id); },
    history(actor, id) { guard(actor); return flow.history(actor, id); },
    /** An approved close changes only by an amendment: a new version, prepared and approved again; the month stays locked meanwhile. */
    amend(actor, id, { reason }) {
      guard(actor); const r = flow.row(actor, id, 'bi.monthly_close.amend');
      if (r.status !== 'APPROVED' || r.lock_state !== 'LOCKED') throw unprocessable('Only an approved, locked close is amended.');
      if (db.prepare("SELECT 1 FROM mc_monthly_closes WHERE parent_close_id = ? AND deleted_at IS NULL AND status IN ('DRAFT','SUBMITTED','RETURNED')").get(r.id)) throw conflict('An amendment of this close is already open.');
      return transaction(db, () => {
        const nid = Number(db.prepare(`INSERT INTO mc_monthly_closes (company_id, doc_no, project_id, period, period_id, version_no, parent_close_id, status, lock_state, requested_by, reason, created_by, source_type, source_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', 'OPEN', ?, ?, ?, 'amendment', ?)`).run(r.company_id, `${r.doc_no.replace(/-A\d+$/, '')}-A${r.version_no}`, r.project_id, r.period, r.period_id, r.version_no + 1, r.id, actor.user, reason, actor.user, String(r.id)).lastInsertRowid);
        audit(actor, 'mc_monthly_closes', nid, 'amend', r.company_id, { newValues: { from: r.doc_no, reason } });
        return closes.get(actor, nid);
      });
    },
    /** The Project MIS pack (FR-02) and the Budget Master (FR-03) as a PDF/XLSX/CSV, from the frozen snapshot of a sent or approved close. */
    exportPack(actor, id, { format, part }) {
      guard(actor); const r = flow.row(actor, id, format === 'pdf' ? 'bi.monthly_close.print' : 'bi.monthly_close.export');
      const v = view(actor, r);
      const rows = part === 'budget' ? v.budgetMaster.rows.map((b) => ({ section: b.head, item: b.name, budget: b.budget, committed: b.committed, actual: b.actual, eac: b.eac, variance: b.variance }))
        : Object.entries(v.mis).filter(([, sec]) => sec).flatMap(([k, sec]) => Object.entries(sec).filter(([, x]) => typeof x === 'number' || typeof x === 'string').filter(([n]) => n !== 'route')
          .map(([n, x]) => ({ section: k, item: n, value: String(x) })));
      const columns = part === 'budget'
        ? [['section', 'Cost head', 'text'], ['item', 'Name', 'text'], ['budget', 'Budget (₹)', 'number'], ['committed', 'Committed (₹)', 'number'], ['actual', 'Actual (₹)', 'number'], ['eac', 'Forecast EAC (₹)', 'number'], ['variance', 'Variance (₹)', 'number']]
        : [['section', 'Section', 'text'], ['item', 'Figure', 'text'], ['value', 'Value', 'text']];
      const buffer = writeExport(format, { columns: columns.map(([key, label, type]) => ({ key, label, type })), rows, title: `${part === 'budget' ? 'Budget Master' : 'Project MIS'} ${v.project} ${v.period}`,
        sheetName: part === 'budget' ? 'Budget Master' : 'Project MIS', footer: [`${v.docNo} · ${v.statusLabel}${v.lockState === 'LOCKED' ? ` · locked ${v.lockedAt}` : ''} · ${v.frozen ? `snapshot ${v.snapshotAt}` : 'live figures (not yet sent)'}`] });
      audit(actor, 'mc_monthly_closes', r.id, format === 'pdf' ? 'print' : 'export', r.company_id, { newValues: { part, format } });
      return { buffer, contentType: FORMATS[format], fileName: `${part === 'budget' ? 'budget-master' : 'project-mis'}-${v.projectCode}-${v.period}.${format}` };
    },
    exportList(actor, q, format) {
      guard(actor); assertPermissionAnywhere(actor, 'bi.monthly_close.export');
      const all = []; let page = 1; let total;
      do { const l = closes.list(actor, { ...q, page, pageSize: 100 }); all.push(...l.rows); total = l.total; page += 1; } while (all.length < total);
      const columns = [['docNo', 'Close', 'text'], ['project', 'Project', 'text'], ['period', 'Month', 'text'], ['versionNo', 'Version', 'number'], ['statusLabel', 'Status', 'text'], ['lockState', 'Lock', 'text'], ['lockedAt', 'Locked at', 'text']]
        .map(([key, label, type]) => ({ key, label, type }));
      audit(actor, 'mc_monthly_closes', 0, 'export', actor.companyId, { newValues: { rows: all.length, format } });
      return { buffer: writeExport(format, { columns, rows: all, title: 'Monthly closes', sheetName: 'Monthly closes', footer: [`${all.length} close(s)`] }), contentType: FORMATS[format], fileName: `monthly-closes.${format}` };
    },
    checksOf,
    misOf,
  };
  void workflowOf;
  services.set(db, closes);
  return closes;
}
