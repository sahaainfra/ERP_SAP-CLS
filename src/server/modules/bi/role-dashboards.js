import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { writeAudit } from '../../platform/audit/index.js';
import { assertPermissionAnywhere } from '../../platform/auth/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { ROLE_TEMPLATES, TEMPLATE_PERMISSIONS } from '../../platform/authz/templates.js';
import { FORMATS, writeExport } from '../../platform/export/index.js';
import { notFound } from '../../platform/http/errors.js';
import { roleLayouts, widgetAliases, widgetRegistry } from '../../platform/widgets/index.js';
import { todayIST } from '../../../shared/dates.js';
import { requireMetricCatalogueSource } from './domain-metrics.js';

/**
 * Part 27.10 — role dashboards consolidation.
 *
 * FR-02: one default dashboard per role of the catalogue (06), on the dashboard framework of 03.07 (dashboard code `role-dashboard`). The
 * layouts live here in code, are resolved like every other dashboard (a person's own copy, then a role default approved in the Dashboard
 * Designer — maker-checker, 03.07 — then this layout), and keep only the widgets the person may use. New widgets fill the gaps the brief names:
 * today's work authorisations, open material requests and RFIs (site engineer), GRNs awaiting approval and today's issues (storekeeper),
 * payments due, unmatched bank lines and month-close tasks (accounts). Each provider reads its owner's records with the person's scope.
 * FR-01/FR-03: the inventory of every widget and dashboard with its provider, permission, drill, source (certified metric, service, framework),
 * where it is used and its status; older duplicate widgets are retired in favour of the overview cards that read the same services (an alias
 * keeps saved layouts working). BR-01: the scan finds hard-coded figures or sample data in dashboard code (`scanSources`, CI and T-01).
 */

export const ROLE_DASH_FLAG = 'ff.bi.p2710';
export const ROLE_DASHBOARD = 'role-dashboard';
const has = (db, t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
const rs = (p) => Math.round(Number(p ?? 0)) / 100;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** FR-03: older widgets that duplicate an overview card of 166.5 (same service, same figure); retired by the 27.10 migration. */
export const RETIRED = Object.freeze({
  'bill.certified_not_billed': 'ov.qs.certified_not_billed', 'bill.unbilled_wip': 'ov.qs.unbilled_wip', 'hse.ltifr': 'ov.hse.ltifr', 'hse.safe_manhours': 'ov.hse.safe_hours',
  'qa.first_time_ir': 'ov.qa.first_time_ir', 'qa.open_ncr': 'ov.qa.open_ncr', 'hr.headcount': 'ov.hr.headcount',
});
for (const [from, to] of Object.entries(RETIRED)) widgetAliases.register(from, to);

/** Widgets backed by a certified metric of 27.03 (FR-01 mapping). */
export const CERTIFIED = Object.freeze({ 'bi.spi': 'spi', 'bi.cpi': 'cpi', 'bi.eac': 'eac', 'bi.dso': 'dso', 'bi.ltifr': 'ltifr', 'bi.gross_margin': 'gross-margin', 'bi.revenue_to_date': 'revenue-to-date', 'bi.stock_turns': 'stock-turns', 'bi.project_count': 'project-count' });

// ---------------------------------------------------------------- FR-02: the default dashboard of each role
const T = 'ov.todo.mine'; const N = 'ov.feed.notifications'; const C = 'calendar.month'; const Q = 'actions.quick';
export const ROLE_WIDGETS = Object.freeze({
  SYSADM: [T, 'approvals.timeliness', 'controls.exceptions', 'projects.mine', N],
  ITADM: [T, 'approvals.timeliness', 'drafts.mine', 'mentions.mine', N],
  SUPADM: [T, 'approvals.timeliness', N],
  DIR: [T, 'bi.exec_alerts', 'bi.eac', 'bi.revenue_to_date', 'bi.gross_margin', 'bi.spi', 'bi.cpi', 'bi.dso', 'bi.ltifr', 'ov.tower.outstanding', N],
  CFO: [T, 'fin.payments_due', 'fin.bank_unmatched', 'fin.close_tasks', 'bi.dso', 'bi.gross_margin', 'bi.revenue_to_date', 'ov.tower.outstanding', 'bi.leakage_open', N],
  ACCMGR: [T, 'fin.payments_due', 'fin.bank_unmatched', 'fin.close_tasks', N],
  FINEX: [T, 'fin.payments_due', 'fin.bank_unmatched', 'fin.close_tasks', N],
  SACC: [T, N, Q],
  PAY: [T, 'att.missing_punches', 'ov.wf.overtime', 'ov.hr.headcount', N],
  PROCMGR: [T, 'ov.proc.open_prs', 'ov.proc.overdue', 'ov.proc.spend_fy', 'proc.mr_open', 'ov.proc.queues', N],
  PROCIC: [T, 'proc.mr_open', N, Q],
  COMMGR: [T, 'ov.qs.certified_not_billed', 'ov.qs.margin', 'ov.tower.outstanding', 'ov.tower.margin', N],
  HRMGR: [T, 'ov.hr.headcount', 'ov.hr.joiners', 'ov.wf.attendance_today', 'att.anomalies_open', 'ov.hr.pending', N],
  QCMGR: [T, 'ov.qa.open_ir', 'ov.qa.open_ncr', 'ov.qa.first_time_ir', 'ov.qa.exceptions', N, C],
  PCMGR: [T, 'bi.spi', 'bi.cpi', 'bi.eac', 'bi.why_cost', 'bi.leakage_open', 'proj.milestones.late', N],
  PD: [T, 'bi.exec_alerts', 'bi.spi', 'bi.cpi', 'bi.work_done_today', 'bi.why_cost', 'proj.risks.critical', 'bi.leakage_open', N],
  PM: [T, 'site.wa_today', 'site.dpr_compliance', 'bi.work_done_today', 'ov.qs.unbilled_wip', 'ov.budget.available', 'ov.qa.open_ir', 'ov.hse.ltifr', 'proj.milestones.late', N, C, Q],
  CM: [T, 'site.wa_today', 'site.dpr_compliance', 'proc.mr_open', 'engg.rfi_open', N, C],
  SE: [T, 'site.wa_today', 'site.dpr_compliance', 'proc.mr_open', 'engg.rfi_open', N, Q],
  CSUP: [T, 'site.wa_today', N, Q], WSUP: [T, 'site.wa_today', N, Q], PMSUP: [T, 'site.wa_today', 'ov.plant.breakdown', N, Q],
  SK: [T, 'inv.grn_pending', 'inv.issues_today', 'ov.stores.below_reorder', 'ov.stores.pending', N, Q],
  STOREMGR: [T, 'inv.grn_pending', 'inv.issues_today', 'ov.stores.value', 'ov.stores.below_reorder', 'ov.stores.ageing', N],
  QCE: [T, 'site.wa_today', N, C],
  HSEE: [T, 'ov.hse.safe_hours', 'ov.hse.ltifr', 'ov.hse.observations', 'ov.hse.incidents', N, C], HSEO: [T, 'ov.hse.safe_hours', 'ov.hse.observations', 'ov.hse.leading', N],
  SUBCO: [T, N, Q],
  AUD: [T, 'bi.leakage_open', 'controls.exceptions', 'approvals.timeliness', N],
  BD: [T, 'bd.tender_deadlines', 'bd.weighted_forecast', N, C], EST: [T, 'bd.tender_deadlines', N, C],
  QS: [T, 'ov.qs.unbilled_wip', 'ov.qs.certified_not_billed', 'ov.qs.queues', 'bi.why_cost', N, Q],
  PLAN: [T, 'bi.spi', 'site.dpr_compliance', 'engg.rfi_open', N, C],
  DOC: [T, 'engg.rfi_open', 'drafts.mine', N], DESIGN: [T, 'engg.rfi_open', 'mentions.mine', N],
  SECMGR: [T, N, C], SECSUP: [T, N, Q], GUARD: [T, N, Q],
  PLANTMGR: [T, 'ov.plant.utilisation', 'ov.plant.breakdown', 'ov.plant.expiring', 'ov.plant.fleet', N],
  EMP: [T, 'tasks.mine', N, C],
  'X-SUP': [T, N], 'X-SUB': [T, N], 'X-CLI': [T, N], 'X-CON': [T, N],
});
const KPI_SIZE = { w: 3, h: 1 }; const CARD_SIZE = { w: 6, h: 2 };
const SIZE = { 'calendar.month': { w: 6, h: 3 }, 'actions.quick': { w: 6, h: 1 } };
const KPIS = new Set(['kpi', 'gauge']);
export function roleLayout(db, role) {
  const codes = ROLE_WIDGETS[role] ?? [T, N];
  const types = new Map(db.prepare('SELECT code, type FROM ui_widgets').all().map((r) => [r.code, r.type]));
  return codes.map((code, i) => ({ id: `r${i + 1}`, widget: code, ...(SIZE[code] ?? (KPIS.has(types.get(code)) ? KPI_SIZE : CARD_SIZE)) }));
}

// ---------------------------------------------------------------- FR-02: the new widgets (each reads its owner's records in the person's scope)
const scopeOf = (db, actor, key, cols) => { const f = authzOf(db).scopeFilter(actor, key, cols); return { sql: f.sql, params: f.params ?? {} }; };
const kpi = (value, extra) => ({ value, kind: 'count', ...extra });
const NEW_WIDGETS = [
  { code: 'site.wa_today', table: 'site_work_authorisations', perm: 'site.work_authorisation.view', provider: ({ db, actor, filters }) => {
    const s = scopeOf(db, actor, 'site.work_authorisation.view', { project: 'w.org_project_id', site: 'w.wa_site_id' }); const day = todayIST();
    const r = db.prepare(`SELECT COUNT(*) AS n, SUM(w.status = 'SUBMITTED') AS waiting, SUM(w.status = 'EMERGENCY') AS emergency FROM site_work_authorisations w
      WHERE w.company_id = :c AND w.deleted_at IS NULL AND w.plan_date = :d AND w.status IN ('SUBMITTED', 'APPROVED', 'EMERGENCY') AND (${s.sql}) ${filters.projectId ? 'AND w.org_project_id = :p' : ''}`).get({ ...s.params, c: actor.companyId, d: day, ...(filters.projectId ? { p: filters.projectId } : {}) });
    return kpi(r.n ?? 0, { unit: 'WAs', subtitle: `today · ${r.waiting ?? 0} awaiting approval · ${r.emergency ?? 0} emergency`, status: r.waiting ? 'amber' : 'green', drill: `/site/work-authorisations?date=${day}` });
  } },
  { code: 'proc.mr_open', table: 'proc_material_requests', perm: 'proc.material_request.view', provider: ({ db, actor, filters }) => {
    const s = scopeOf(db, actor, 'proc.material_request.view', { project: 'm.org_project_id', site: 'm.mr_site_id' }); const day = todayIST();
    const r = db.prepare(`SELECT COUNT(*) AS n, SUM(m.required_by < :d) AS late, SUM(m.status = 'SUBMITTED') AS waiting FROM proc_material_requests m
      WHERE m.company_id = :c AND m.deleted_at IS NULL AND m.status IN ('SUBMITTED', 'APPROVED', 'EMERGENCY') AND (${s.sql}) ${filters.projectId ? 'AND m.org_project_id = :p' : ''}`).get({ ...s.params, c: actor.companyId, d: day, ...(filters.projectId ? { p: filters.projectId } : {}) });
    return kpi(r.n ?? 0, { unit: 'MRs', subtitle: `open · ${r.late ?? 0} past the required date · ${r.waiting ?? 0} awaiting approval`, status: r.late ? 'red' : r.n ? 'amber' : 'green', drill: '/proc/material-requests?status=APPROVED' });
  } },
  { code: 'engg.rfi_open', table: 'engg_rfis', perm: 'engg.rfi.view', provider: ({ db, actor, filters }) => {
    const s = scopeOf(db, actor, 'engg.rfi.view', { project: 'r.org_project_id', site: 'r.rfi_site_id' }); const day = todayIST();
    const r = db.prepare(`SELECT COUNT(*) AS n, SUM(r.required_by < :d) AS late, SUM(r.hold_activity = 1) AS holds FROM engg_rfis r
      WHERE r.company_id = :c AND r.deleted_at IS NULL AND r.status IN ('SUBMITTED', 'ISSUED', 'RESPONDED', 'CLOSE_REQUESTED') AND (${s.sql}) ${filters.projectId ? 'AND r.org_project_id = :p' : ''}`).get({ ...s.params, c: actor.companyId, d: day, ...(filters.projectId ? { p: filters.projectId } : {}) });
    return kpi(r.n ?? 0, { unit: 'RFIs', subtitle: `open · ${r.late ?? 0} overdue · ${r.holds ?? 0} holding work`, status: r.late ? 'red' : r.n ? 'amber' : 'green', drill: '/engg/rfis' });
  } },
  { code: 'inv.grn_pending', table: 'inv_grns', perm: 'inv.grn.view', provider: ({ db, actor, filters }) => {
    const s = scopeOf(db, actor, 'inv.grn.view', { project: 'g.org_project_id', site: 'g.org_site_id' });
    const r = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(g.total_value), 0) AS v, MIN(g.received_date) AS oldest FROM inv_grns g
      WHERE g.company_id = :c AND g.deleted_at IS NULL AND g.status IN ('SUBMITTED', 'RETURNED') AND (${s.sql}) ${filters.projectId ? 'AND g.org_project_id = :p' : ''}`).get({ ...s.params, c: actor.companyId, ...(filters.projectId ? { p: filters.projectId } : {}) });
    return kpi(r.n ?? 0, { unit: 'GRNs', subtitle: `awaiting approval · ₹${rs(r.v).toLocaleString('en-IN')}${r.oldest ? ` · oldest ${r.oldest}` : ''}`, status: r.n ? 'amber' : 'green', drill: '/inv/grns?status=SUBMITTED' });
  } },
  { code: 'inv.issues_today', table: 'inv_issues', perm: 'inv.issue.view', provider: ({ db, actor, filters }) => {
    const s = scopeOf(db, actor, 'inv.issue.view', { project: 'i.org_project_id', site: 'i.org_site_id' }); const day = todayIST();
    const r = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(i.total_value), 0) AS v, SUM(i.status = 'SUBMITTED') AS waiting FROM inv_issues i
      WHERE i.company_id = :c AND i.deleted_at IS NULL AND i.issue_date = :d AND i.status IN ('SUBMITTED', 'APPROVED', 'POSTED') AND (${s.sql}) ${filters.projectId ? 'AND i.org_project_id = :p' : ''}`).get({ ...s.params, c: actor.companyId, d: day, ...(filters.projectId ? { p: filters.projectId } : {}) });
    return kpi(r.n ?? 0, { unit: 'issues', subtitle: `today · ₹${rs(r.v).toLocaleString('en-IN')} · ${r.waiting ?? 0} awaiting approval`, status: 'neutral', drill: `/inv/issues?date=${day}` });
  } },
  { code: 'fin.payments_due', table: 'ap_bills', perm: 'fin.bill.view', provider: ({ db, actor, filters }) => {
    const s = scopeOf(db, actor, 'fin.bill.view', { project: 'b.org_project_id', site: 'b.org_site_id' }); const day = todayIST();
    const r = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(b.net_payable_paise - b.paid_paise - b.adjusted_paise), 0) AS v, SUM(b.due_date < :d) AS late,
        COALESCE(SUM(CASE WHEN b.due_date < :d THEN b.net_payable_paise - b.paid_paise - b.adjusted_paise END), 0) AS lv FROM ap_bills b
      WHERE b.company_id = :c AND b.deleted_at IS NULL AND b.status = 'APPROVED' AND b.hold_reason IS NULL AND b.net_payable_paise - b.paid_paise - b.adjusted_paise > 0 AND b.due_date <= :w
        AND (${s.sql}) ${filters.projectId ? 'AND b.org_project_id = :p' : ''}`).get({ ...s.params, c: actor.companyId, d: day, w: addDays(day, 7), ...(filters.projectId ? { p: filters.projectId } : {}) });
    return { value: rs(r.v), kind: 'money', unit: '', currency: 'INR', subtitle: `${r.n ?? 0} bills due in 7 days · ${r.late ?? 0} overdue (₹${rs(r.lv).toLocaleString('en-IN')})`, status: r.late ? 'red' : r.n ? 'amber' : 'green', drill: '/finance/ap-bills?due=7' };
  } },
  { code: 'fin.bank_unmatched', table: 'fin_bank_statements', perm: 'fin.bank_statement.view', provider: ({ db, actor }) => {
    const r = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(s.debit_paise + s.credit_paise), 0) AS v, MIN(s.txn_date) AS oldest FROM fin_bank_statements s
      WHERE s.company_id = ? AND s.deleted_at IS NULL AND s.match_status = 'UNMATCHED'`).get(actor.companyId);
    return kpi(r.n ?? 0, { unit: 'lines', subtitle: `bank lines not reconciled · ₹${rs(r.v).toLocaleString('en-IN')}${r.oldest ? ` · since ${r.oldest}` : ''}`, status: r.n ? 'amber' : 'green', drill: '/finance/bank-reconciliation' });
  } },
  { code: 'fin.close_tasks', table: 'close_tasks', perm: 'fin.period.view', provider: ({ db, actor }) => {
    const day = todayIST();
    const r = db.prepare(`SELECT COUNT(*) AS n, SUM(t.due_date < ?) AS late, MAX(p.period) AS period FROM close_tasks t JOIN close_periods p ON p.id = t.close_id
      WHERE t.company_id = ? AND t.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status NOT IN ('APPROVED', 'CANCELLED') AND t.task_status IN ('OPEN', 'IN_PROGRESS') AND t.mandatory = 1`).get(day, actor.companyId);
    return kpi(r.n ?? 0, { unit: 'tasks', subtitle: r.period ? `open in the close of ${r.period} · ${r.late ?? 0} overdue` : 'no month close in progress', status: r.late ? 'red' : r.n ? 'amber' : 'green', drill: '/finance/period-close' });
  } },
];
const contexts = new WeakMap();
export const bindRoleDashboards = (db, context) => contexts.set(db, context);
for (const w of NEW_WIDGETS) {
  widgetRegistry.register({
    code: w.code,
    // the owner's table must exist; the widget's permission is checked by the framework (ui_widgets.permission_key)
    available: (db) => has(db, w.table) && (w.code !== 'fin.close_tasks' || has(db, 'close_periods')),
    provider: (ctx) => w.provider({ ...ctx, filters: ctx.filters ?? {} }),
  });
}
export const NEW_WIDGET_CODES = NEW_WIDGETS.map((w) => w.code);

// ---------------------------------------------------------------- BR-01: the scan for hard-coded figures and sample data in dashboard code
const RULES = [
  { code: 'LITERAL_KPI', re: /<(?:KpiTile|Tile)\b[^>]*\bvalue=(?:"[\d₹.,%\s]+"|'[\d₹.,%\s]+'|\{\s*['"]?[\d.,]+['"]?\s*\})/g, why: 'A KPI tile with a literal value' },
  { code: 'SAMPLE_DATA', re: /\b(?:sampleData|mockData|dummyData|fakeData|demoData|PREVIEW_DATA|SAMPLE_ROWS|hardcoded(?:Value|Figure)s?)\b/g, why: 'Sample, mock or demo data in a page' },
  { code: 'LOREM', re: /lorem ipsum/gi, why: 'Placeholder text' },
  { code: 'LITERAL_PROVIDER', re: /provider\s*\([^)]*\)\s*\{\s*return\s*\{\s*(?:[a-z]+:\s*'[^']*',\s*)*value:\s*[1-9]\d*\s*[,}]/g, why: 'A widget provider returning a literal figure' },
];
const walk = (dir, out = []) => { for (const f of readdirSync(dir)) { const p = join(dir, f); const st = statSync(p); if (st.isDirectory()) walk(p, out); else if (/\.(jsx?|mjs)$/.test(f) && !/\.test\./.test(f)) out.push(p); } return out; };
/** Scan the client pages and the server widget providers. Returns { files, findings: [{ rule, file, line, text, why }] }. */
export function scanSources(root = process.cwd()) {
  const dirs = [join(root, 'src/client'), join(root, 'src/server/modules')].filter((d) => { try { return statSync(d).isDirectory(); } catch { return false; } });
  if (!dirs.length) return { available: false, files: 0, findings: [] };
  const self = join('src', 'server', 'modules', 'bi', 'role-dashboards.js');
  const files = dirs.flatMap((d) => walk(d)).filter((f) => !f.endsWith(self));
  const findings = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const rule of RULES) {
      for (const m of text.matchAll(rule.re)) {
        const line = text.slice(0, m.index).split('\n').length;
        findings.push({ rule: rule.code, file: relative(root, file), line, text: m[0].slice(0, 120), why: rule.why });
      }
    }
  }
  return { available: true, files: files.length, findings, scannedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------- FR-01: the dashboard inventory (technical console report)
export function requireRoleDashboards(context, actor) {
  if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, ROLE_DASH_FLAG)) throw notFound('Role dashboards are unavailable.');
  requireMetricCatalogueSource(context, actor);
}

export function createRoleDashboards(context) {
  const { db } = context;
  bindRoleDashboards(db, context);
  let lastScan = null;
  const sourceOf = (code) => {
    if (CERTIFIED[code]) return { kind: 'CERTIFIED_METRIC', ref: CERTIFIED[code] };
    if (code.startsWith('ov.')) return { kind: 'OVERVIEW_SERVICE', ref: code.split('.')[1] };
    if (NEW_WIDGET_CODES.includes(code)) return { kind: 'OWNER_SERVICE', ref: code.split('.')[0] };
    if (['self'].includes(code)) return { kind: 'FRAMEWORK', ref: null };
    return { kind: 'OWNER_SERVICE', ref: code.split('.')[0] };
  };
  function inventory(actor, q = {}) {
    requireRoleDashboards(context, actor); assertPermissionAnywhere(actor, 'bi.dashboard_inventory.view');
    const rows = db.prepare('SELECT * FROM ui_widgets WHERE deleted_at IS NULL ORDER BY module, code').all();
    const dashboards = db.prepare('SELECT code, name, owner_type, owner_ref, layout_json, permission_key FROM ui_dashboards WHERE is_active = 1 AND deleted_at IS NULL AND (company_id IS NULL OR company_id = ?)').all(actor.companyId);
    const usedIn = new Map();
    for (const d of dashboards) for (const i of JSON.parse(d.layout_json || '[]')) { const k = i.widget; if (!usedIn.has(k)) usedIn.set(k, new Set()); usedIn.get(k).add(d.code); }
    const roleUse = new Map();
    for (const [role, codes] of Object.entries(ROLE_WIDGETS)) for (const c of codes) { if (!roleUse.has(c)) roleUse.set(c, new Set()); roleUse.get(c).add(role); if (!usedIn.has(c)) usedIn.set(c, new Set()); usedIn.get(c).add(ROLE_DASHBOARD); }
    const self = new Set(['self']);
    const widgets = rows.map((r) => {
      const provider = Boolean(widgetRegistry.get(r.code));
      const retired = r.is_active === 0 ? (RETIRED[r.code] ?? null) : null;
      const issues = [];
      if (!provider) issues.push('NO_PROVIDER');
      if (!r.drill_route && !self.has(r.permission_key) && !['calendar', 'actions', 'notice'].includes(r.type)) issues.push('NO_DRILL');
      if (r.is_active === 1 && !usedIn.has(r.code)) issues.push('UNUSED');
      const status = retired ? 'RETIRED' : issues.includes('NO_PROVIDER') ? 'NO_PROVIDER' : issues.length ? 'REVIEW' : 'OK';
      const src = sourceOf(r.code);
      return { code: r.code, title: r.title, module: r.module, type: r.type, permission: r.permission_key, drill: r.drill_route, refreshSec: r.refresh_sec, provider, source: src.kind, sourceRef: src.ref,
        dashboards: [...(usedIn.get(r.code) ?? [])].sort(), roles: [...(roleUse.get(r.code) ?? [])].sort(), status, issues, supersededBy: retired, active: r.is_active === 1 };
    }).filter((w) => (!q.module || w.module === q.module) && (!q.status || w.status === q.status) && (!q.type || w.type === q.type) && (!q.source || w.source === q.source));
    const roles = ROLE_TEMPLATES.map((t) => {
      const codes = ROLE_WIDGETS[t.code] ?? [];
      const perms = new Set(TEMPLATE_PERMISSIONS[t.code] ?? []);
      const visible = codes.filter((c) => { const r = rows.find((x) => x.code === c && x.is_active === 1); return r && (r.permission_key === 'self' || perms.has(r.permission_key)); });
      return { role: t.code, name: t.name, category: t.category, widgets: codes.length, visible: visible.length, hidden: codes.filter((c) => !visible.includes(c)), route: `/bi/role-dashboard` };
    });
    const byModule = Object.entries(widgets.reduce((m, w) => { m[w.module] = (m[w.module] ?? 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).map(([module, count]) => ({ module, count }));
    const totals = { widgets: widgets.length, ok: widgets.filter((w) => w.status === 'OK').length, review: widgets.filter((w) => w.status === 'REVIEW').length, retired: widgets.filter((w) => w.status === 'RETIRED').length,
      noProvider: widgets.filter((w) => w.status === 'NO_PROVIDER').length, certified: widgets.filter((w) => w.source === 'CERTIFIED_METRIC').length, dashboards: new Set([...dashboards.map((d) => d.code), ROLE_DASHBOARD]).size,
      roles: roles.length, rolesCovered: roles.filter((r) => r.visible >= 2).length };
    if (!lastScan) lastScan = scanSources();
    return { asOf: new Date().toISOString(), totals, byModule, widgets, roles,
      dashboards: [...new Set([...dashboards.map((d) => d.code), ROLE_DASHBOARD])].sort().map((code) => { const list = dashboards.filter((d) => d.code === code); return { code, name: list[0]?.name ?? 'Role dashboard', layouts: list.length, roleDefaults: list.filter((d) => d.owner_type === 'role').length, personal: list.filter((d) => d.owner_type === 'user').length }; }),
      scan: { available: lastScan.available, files: lastScan.files, findings: lastScan.findings, scannedAt: lastScan.scannedAt } };
  }
  function rescan(actor) { requireRoleDashboards(context, actor); assertPermissionAnywhere(actor, 'bi.dashboard_inventory.view'); lastScan = scanSources(); writeAudit(db, { companyId: actor.companyId, entity: 'ui_widgets', entityId: 0, action: 'scan', newValues: { files: lastScan.files, findings: lastScan.findings.length }, actor: actor.user }); return lastScan; }
  function exportInventory(actor, q, format) {
    const inv = inventory(actor, q); assertPermissionAnywhere(actor, 'bi.dashboard_inventory.view');
    const columns = [['code', 'Widget'], ['title', 'Title'], ['module', 'Module'], ['type', 'Type'], ['source', 'Source'], ['sourceRef', 'Source ref'], ['permission', 'Permission'], ['drill', 'Drill'], ['dashboards', 'Dashboards'], ['roles', 'Roles'], ['status', 'Status'], ['supersededBy', 'Superseded by']]
      .map(([key, label]) => ({ key, label, type: 'text' }));
    const rows = inv.widgets.map((w) => ({ ...w, dashboards: w.dashboards.join(' '), roles: w.roles.join(' '), drill: w.drill ?? '', sourceRef: w.sourceRef ?? '', supersededBy: w.supersededBy ?? '' }));
    const buffer = writeExport(format, { columns, rows, title: 'Dashboard inventory', sheetName: 'Widgets', footer: [`${inv.totals.widgets} widgets · ${inv.totals.ok} OK · ${inv.totals.review} to review · ${inv.totals.retired} retired · ${inv.totals.certified} on certified metrics · scan findings ${inv.scan.findings.length}`] });
    writeAudit(db, { companyId: actor.companyId, entity: 'report', entityId: 'bi.dashboard_inventory', action: 'export', newValues: { format, rows: rows.length }, actor: actor.user });
    return { buffer, contentType: FORMATS[format], fileName: `dashboard-inventory.${format}` };
  }
  /** FR-02: the role dashboard, for the page: which roles the person holds, and the layout source for each. */
  function mine(actor) {
    requireRoleDashboards(context, actor);
    return { roles: (actor.roles ?? []).filter((r) => ROLE_WIDGETS[r]).map((r) => ({ role: r, name: ROLE_TEMPLATES.find((t) => t.code === r)?.name ?? r, widgets: ROLE_WIDGETS[r].length })), dashboard: ROLE_DASHBOARD };
  }
  return { inventory, rescan, exportInventory, mine };
}

/** The layouts in code (166.5 mechanism), registered once the widget table is known. */
export function registerRoleLayouts(db) {
  roleLayouts.register(ROLE_DASHBOARD, Object.fromEntries(Object.keys(ROLE_WIDGETS).map((role) => [role, roleLayout(db, role)])));
}
