import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { toCsv, toPdf, toXlsx } from '../../platform/export/index.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { parameterRegistry, createParameterStore } from '../../platform/parameters/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';

// The project control engine (part 14.07).
// - One fact store (`ctl_facts`) keyed by project, WBS node, cost code, resource type and period holds planned, budgeted, committed, actual, earned, billed, certified and forecast quantity and cost (FR-01). Each value has one owner and the
//   engine only reads it (BR-01): the budget (12.01), the commitments and the actual cost (12.03), the progress (14.05). Nothing can be typed into the facts; there is no write route for them.
// - The facts follow the events of the owners (FR-02) and a nightly reconciliation compares them with the ledgers again, by an independent query; a difference above the tolerance is an alert (BR-02) and is then repaired by a refresh.
// - Double counting (FR-03): material cost is counted once. By default (`site.control.material_cost_at` = ISSUE) the cost of a stock item is counted at its issue (source ISSUE) and the receipt into the store (GRN_STOCK) is not; an item bought for
//   direct delivery to site (GRN_DIRECT, or a GRN without a kind) is counted at the receipt. With the value GRN every receipt counts and the issues do not.
// - A cost that came without a WBS node or a cost code is a line in the queue of unallocated costs (FR-06). The QS or project controls propose where it belongs and the project manager approves; the ledger row of 12.03 is never changed, the
//   approved allocation is an overlay the facts apply.
export const ALLOC_DOC = 'SITE_CTL_ALLOC';
export const ALLOC_STATUS = { OPEN: 'Waiting for allocation', SUBMITTED: 'Waiting for approval', ALLOCATED: 'Allocated', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', CLEARED: 'Cleared at the source' };
export const REASONS = { NO_WBS: 'No WBS node', NO_COST_CODE: 'No cost code', NO_WBS_NO_COST_CODE: 'No WBS node and no cost code' };
export const RESOURCES = { MATERIAL: 'Material', LABOUR: 'Labour', EQUIPMENT: 'Equipment', TRANSPORT: 'Transport', SUBCONTRACT: 'Subcontract', OTHER: 'Other' };
export const GROUPS = { WBS: 'WBS node', COST_CODE: 'Cost code', COST_HEAD: 'Cost head', RESOURCE: 'Resource type', MONTH: 'Month' };
export const MEASURES = { BUDGET: 'Budget', PLANNED: 'Planned', COMMITTED: 'Committed', ACTUAL: 'Actual', EARNED: 'Earned', UNALLOCATED: 'Unallocated' };
const nowIso = () => new Date().toISOString();
const rid = (v) => parseInt(String(v), 10);
const lower = (s) => String(s ?? '').toLowerCase();
const same = (a, b) => Boolean(a && b && lower(a) === lower(b));
const rs = (n) => (n == null ? null : Math.round(n) / 100);
const d3 = (n) => (n == null ? null : n / 1000);
const ratio = (n, d) => (d > 0 ? Math.round((n / d) * 10000) / 10000 : null);
const keyOf = (w, c, r, p) => `${w ?? 0}|${c ?? 0}|${r}|${p}`;
const MEASURE_COLS = ['planned_qty', 'planned_cost', 'budget_qty', 'budget_cost', 'committed_cost', 'actual_qty', 'actual_cost', 'earned_cost', 'certified_value', 'billed_value'];

for (const [key, dataType, def, description, extra] of [
  ['site.control.material_cost_at', 'string', 'ISSUE', 'FR-03: where the cost of a material is counted once. ISSUE: a stock item at its issue (the receipt into the store is not counted), an item for direct delivery to site at its receipt. GRN: every receipt, no issue.', {}],
  ['site.control.recon_tolerance_minor', 'integer', 100, 'BR-02: the difference, in paise, between the control facts and a source ledger above which the nightly reconciliation raises an alert.', { min: 0, max: 100000000 }],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });

export const allocList = defineList({
  code: 'site.control_unallocated', label: 'Unallocated costs', permission: 'site.control.view', from: 'ctl_unallocated x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_ref', 'x.vendor_name', 'x.description', 'x.src_id', 'p.code'], defaultSort: '-ageDays',
  columns: {
    project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' }, source: { sql: 'x.src_type', type: 'text', label: 'Source' }, doc: { sql: 'x.doc_ref', type: 'text', label: 'Document' }, vendor: { sql: 'x.vendor_name', type: 'text', label: 'Vendor' },
    resource: { sql: 'x.resource_type', type: 'enum', label: 'Resource', options: Object.entries(RESOURCES) }, amount: { sql: 'x.amount', type: 'text', label: 'Amount' }, date: { sql: 'x.actual_date', type: 'date', label: 'Date' },
    ageDays: { sql: "CAST(julianday('now') - julianday(x.actual_date) AS INTEGER)", type: 'number', label: 'Age (days)' }, reason: { sql: 'x.reason', type: 'enum', label: 'Why', options: Object.entries(REASONS) }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(ALLOC_STATUS) },
  },
});

/** @param {{ db: any, evaluate?: (companyId: number, projectId: number, asOf: string) => any }} deps */
export function createControlService({ db, evaluate = () => null }) {
  const authz = authzOf(db);
  const param = (companyId, key) => createParameterStore(db).get(key, { companyId, date: todayIST() });
  const may = (actor, key, pid) => authz.check(actor, key, { companyId: actor.companyId, projectId: pid }).allowed;
  const need = (actor, key, what, pid) => { if (!may(actor, key, pid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p); };
  const audit = (actor, entity, id, action, companyId, extra = {}) => writeAudit(db, { entity, entityId: id, action, actor: actor?.user ?? 'system', companyId, ...extra });
  const notify = (companyId, code, recipients, ref, subject, detail, link, sourceId, scope = {}) => { if (!recipients.length) return; try { notificationsOf(db).notify({ companyId, templateCode: code, recipients, data: { ref, subject, detail, link }, link, sourceType: `${code}.${sourceId}`, sourceId, ...scope }); } catch { /* saved anyway */ } };
  const project = (actor, projectId, key = 'site.control.view') => {
    const p = db.prepare('SELECT id, code, name, company_id FROM org_projects WHERE id = ? AND deleted_at IS NULL').get(rid(projectId));
    if (!p || p.company_id !== actor.companyId || !may(actor, 'site.control.view', p.id)) throw notFound('That project does not exist.'); if (key !== 'site.control.view') need(actor, key, 'do that for this project', p.id); return p;
  };
  const projects = (actor) => db.prepare("SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code").all(actor.companyId).filter((p) => may(actor, 'site.control.view', p.id)).map((p) => ({ id: p.id, code: p.code, name: p.name, canSubmit: may(actor, 'site.control.submit', p.id), canApprove: may(actor, 'site.control.approve', p.id), canReconcile: may(actor, 'site.control.reconcile', p.id) }));
  const materialRule = (companyId) => (String(param(companyId, 'site.control.material_cost_at') ?? 'ISSUE').toUpperCase() === 'GRN' ? 'GRN' : 'ISSUE');
  /** FR-03: is an actual row counted in the facts? A stock receipt or an issue is counted by the company's rule, never both; everything else is counted. */
  const countedBy = (rule, a) => {
    if (a.resource_type !== 'MATERIAL') return { counted: true, why: null };
    if (a.src_type === 'GRN_STOCK') return rule === 'GRN' ? { counted: true, why: null } : { counted: false, why: 'Receipt into the store: the cost of a stock item is counted at its issue' };
    if (a.src_type === 'ISSUE') return rule === 'ISSUE' ? { counted: true, why: null } : { counted: false, why: 'Issue from the store: the cost is counted at the receipt (company setting)' };
    return { counted: true, why: null };
  };
  const budgetOf = (projectId) => db.prepare("SELECT * FROM bud_budgets WHERE org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY version_no DESC, id DESC LIMIT 1").get(projectId) ?? null;
  const wbsLabel = (id) => { if (!id) return '— (no WBS node)'; const w = db.prepare('SELECT code, name FROM proj_wbs WHERE id = ?').get(id); return w ? `${w.code} ${w.name}` : `WBS ${id}`; };
  const codeLabel = (id) => { if (!id) return '— (no cost code)'; const c = db.prepare('SELECT code, name FROM fin_cost_codes WHERE id = ?').get(id); return c ? `${c.code} ${c.name}` : `Cost code ${id}`; };
  const headLabel = (id) => { if (!id) return '— (no cost head)'; const c = db.prepare('SELECT code, name FROM fin_cost_heads WHERE id = ?').get(id); return c ? `${c.code} ${c.name}` : `Cost head ${id}`; };
  const event = (type, companyId, projectId, entityId, data) => publishEvent(db, { type, entity: 'site_control', entityId, actorId: 'system', companyId, projectId, data });

  // ---- the fact store: derived from the owners of each value (FR-01, FR-02, FR-03, BR-01) ------------------------------------------------------------------------------------------
  /** Rebuilds the facts of a project from the budget, the commitments, the actuals and the progress; returns what changed. Safe to repeat. */
  function refresh(companyId, projectId, why = 'event') {
    const rule = materialRule(companyId); const acc = new Map(); const get = (w, c, r, p) => { const k = keyOf(w, c, r, p); if (!acc.has(k)) acc.set(k, { wbs: w ?? null, code: c ?? null, res: r, period: p, ...Object.fromEntries(MEASURE_COLS.map((m) => [m, 0])) }); return acc.get(k); };
    const cur = budgetOf(projectId); const today = todayIST(); const ev = (() => { try { return evaluate(companyId, projectId, today); } catch { return null; } })();
    const node = new Map((ev?.wbs ?? []).map((n) => [n.id, n])); const proj = ev?.project ?? null;
    const frac = (wbsId, k) => { const n = wbsId ? node.get(wbsId) : null; if (n) return Number(n[k] ?? 0); return wbsId ? 0 : Number(proj?.[k] ?? 0); };
    if (cur) {
      for (const l of db.prepare("SELECT wbs_id, cost_code_id, resource_type, SUM(qty) AS q, SUM(amount) AS a FROM bud_lines WHERE budget_id = ? AND deleted_at IS NULL AND line_kind IN ('DIRECT', 'OVERHEAD') GROUP BY wbs_id, cost_code_id, resource_type").all(cur.id)) {
        const g = get(l.wbs_id, l.cost_code_id, l.resource_type, ''); g.budget_qty += l.q; g.budget_cost += l.a;
        g.planned_cost = Math.round(g.budget_cost * frac(l.wbs_id, 'planned')); g.planned_qty = Math.round(g.budget_qty * frac(l.wbs_id, 'planned')); g.earned_cost = Math.round(g.budget_cost * frac(l.wbs_id, 'financial'));
      }
    }
    for (const c of db.prepare("SELECT wbs_id, cost_code_id, resource_type, SUM(amount - consumed_amount - released_amount) AS n FROM bud_commitments WHERE org_project_id = ? AND deleted_at IS NULL AND status IN ('OPEN', 'PARTIAL') GROUP BY wbs_id, cost_code_id, resource_type").all(projectId)) get(c.wbs_id, c.cost_code_id, c.resource_type, '').committed_cost += c.n;
    const overlay = new Map(db.prepare("SELECT src_type, src_id, src_line_id, alloc_wbs_id, alloc_cost_code_id FROM ctl_unallocated WHERE org_project_id = ? AND status = 'ALLOCATED' AND deleted_at IS NULL").all(projectId).map((u) => [`${u.src_type}|${u.src_id}|${u.src_line_id}`, u]));
    const queue = [];
    for (const a of db.prepare("SELECT * FROM bud_actuals WHERE org_project_id = ? AND status = 'POSTED' AND deleted_at IS NULL").all(projectId)) {
      if (!countedBy(rule, a).counted) continue;
      const al = overlay.get(`${a.src_type}|${a.src_id}|${a.src_line_id}`); const w = a.wbs_id ?? al?.alloc_wbs_id ?? null; const c = a.cost_code_id ?? al?.alloc_cost_code_id ?? null;
      const g = get(w, c, a.resource_type, String(a.actual_date).slice(0, 7)); g.actual_cost += a.amount; g.actual_qty += a.qty;
      if (w == null || c == null) queue.push({ a, reason: w == null && c == null ? 'NO_WBS_NO_COST_CODE' : w == null ? 'NO_WBS' : 'NO_COST_CODE' });
    }
    const now = nowIso(); let changed = 0; let queued = 0; let queuedAmount = 0;
    transaction(db, () => {
      const have = new Map(db.prepare('SELECT * FROM ctl_facts WHERE org_project_id = ? AND deleted_at IS NULL').all(projectId).map((r) => [keyOf(r.wbs_id, r.cost_code_id, r.resource_type, r.period_key), r]));
      for (const [k, v] of acc) {
        const r = have.get(k); have.delete(k);
        if (!r) { db.prepare(`INSERT INTO ctl_facts (company_id, org_project_id, wbs_id, cost_code_id, resource_type, period_key, ${MEASURE_COLS.join(', ')}, refreshed_at, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ${MEASURE_COLS.map(() => '?').join(', ')}, ?, ?, 'system', 'site_control', ?)`).run(companyId, projectId, v.wbs, v.code, v.res, v.period, ...MEASURE_COLS.map((m) => v[m]), now, projectId, String(projectId)); changed += 1; continue; }
        if (MEASURE_COLS.some((m) => r[m] !== v[m])) { db.prepare(`UPDATE ctl_facts SET ${MEASURE_COLS.map((m) => `${m} = ?`).join(', ')}, refreshed_at = ?, updated_by = 'system', updated_at = ?, version = version + 1 WHERE id = ?`).run(...MEASURE_COLS.map((m) => v[m]), now, now, r.id); changed += 1; }
      }
      for (const r of have.values()) if (MEASURE_COLS.some((m) => r[m] !== 0)) { db.prepare(`UPDATE ctl_facts SET ${MEASURE_COLS.map((m) => `${m} = 0`).join(', ')}, refreshed_at = ?, updated_by = 'system', updated_at = ?, version = version + 1 WHERE id = ?`).run(now, now, r.id); changed += 1; }
      // FR-06: the costs that could not be placed wait in the queue; one that was placed or reversed at its source clears
      const live = new Set();
      for (const { a, reason } of queue) {
        const sk = `${a.src_type}|${a.src_id}|${a.src_line_id}`; live.add(sk);
        const q = db.prepare('SELECT * FROM ctl_unallocated WHERE company_id = ? AND src_type = ? AND src_id = ? AND src_line_id = ? AND deleted_at IS NULL').get(companyId, a.src_type, a.src_id, a.src_line_id);
        if (!q) { db.prepare('INSERT INTO ctl_unallocated (company_id, org_project_id, src_type, src_id, src_line_id, doc_ref, vendor_name, description, resource_type, amount, qty, actual_date, reason, status, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'OPEN\', ?, \'system\', ?, ?)').run(companyId, projectId, a.src_type, a.src_id, a.src_line_id, a.doc_ref, a.vendor_name, a.description, a.resource_type, a.amount, a.qty, a.actual_date, reason, projectId, a.src_type, a.src_id); queued += 1; queuedAmount += a.amount; }
        else if (['OPEN', 'RETURNED'].includes(q.status) && (q.amount !== a.amount || q.reason !== reason)) db.prepare('UPDATE ctl_unallocated SET amount = ?, qty = ?, reason = ?, updated_by = \'system\', updated_at = ?, version = version + 1 WHERE id = ?').run(a.amount, a.qty, reason, now, q.id);
      }
      for (const q of db.prepare("SELECT * FROM ctl_unallocated WHERE org_project_id = ? AND status IN ('OPEN', 'RETURNED') AND deleted_at IS NULL").all(projectId)) if (!live.has(`${q.src_type}|${q.src_id}|${q.src_line_id}`)) db.prepare("UPDATE ctl_unallocated SET status = 'CLEARED', updated_by = 'system', updated_at = ?, version = version + 1 WHERE id = ?").run(now, q.id);
      if (changed || queued) event('site.control.updated', companyId, projectId, projectId, { projectId, why, facts: changed, unallocated: queued });
    });
    if (queued) { const p = db.prepare('SELECT code FROM org_projects WHERE id = ?').get(projectId); notify(companyId, 'site.control.unallocated', ['role:QS|PCMGR'], String(p?.code ?? projectId), String(p?.code ?? projectId), `${queued} cost line(s), ${rs(queuedAmount)}, came without a WBS node or a cost code and wait to be allocated.`, '/site/control-unallocated', `${projectId}.${now}`, { projectId }); }
    return { projectId, changed, queued };
  }
  /** The consumer of the owners' events (FR-02): the facts of the project of the event are rebuilt. */
  function onEvent(e) {
    const d = e.data ?? {}; const companyId = Number(e.companyId ?? e.company_id); const projectId = Number(d.projectId ?? e.projectId ?? e.project_id); if (!companyId || !projectId) return null;
    if (!db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(projectId, companyId)) return null; return refresh(companyId, projectId, e.type ?? 'event');
  }

  // ---- reconciliation against the source ledgers, by a separate query (FR-02, BR-02) ---------------------------------------------------------------------------------------------
  function reconcile(companyId, projectId, { kind = 'MANUAL', user = 'system' } = {}) {
    const tol = Number(param(companyId, 'site.control.recon_tolerance_minor') ?? 100); const rule = materialRule(companyId); const cur = budgetOf(projectId); const diffs = []; let checked = 0;
    const facts = db.prepare('SELECT * FROM ctl_facts WHERE org_project_id = ? AND deleted_at IS NULL').all(projectId); const fmap = new Map(); for (const f of facts) { const k = keyOf(f.wbs_id, f.cost_code_id, f.resource_type, f.period_key); fmap.set(k, f); }
    const seen = new Set();
    const cmp = (measure, k, label, expected, actual, qty = false) => { checked += 1; const diff = actual - expected; if (Math.abs(diff) > (qty ? 0 : tol)) diffs.push({ measure, key: k, label, expected: qty ? d3(expected) : rs(expected), actual: qty ? d3(actual) : rs(actual), difference: qty ? d3(diff) : rs(diff) }); };
    const expBudget = cur ? db.prepare("SELECT wbs_id w, cost_code_id c, resource_type r, SUM(qty) q, SUM(amount) a FROM bud_lines WHERE budget_id = ? AND deleted_at IS NULL AND line_kind IN ('DIRECT', 'OVERHEAD') GROUP BY 1, 2, 3").all(cur.id) : [];
    const expCommit = db.prepare("SELECT wbs_id w, cost_code_id c, resource_type r, SUM(amount - consumed_amount - released_amount) n FROM bud_commitments WHERE org_project_id = ? AND deleted_at IS NULL AND status IN ('OPEN', 'PARTIAL') GROUP BY 1, 2, 3").all(projectId);
    const expActual = db.prepare(`SELECT COALESCE(a.wbs_id, u.alloc_wbs_id) w, COALESCE(a.cost_code_id, u.alloc_cost_code_id) c, a.resource_type r, substr(a.actual_date, 1, 7) p, SUM(a.amount) n, SUM(a.qty) q
      FROM bud_actuals a LEFT JOIN ctl_unallocated u ON u.company_id = a.company_id AND u.src_type = a.src_type AND u.src_id = a.src_id AND u.src_line_id = a.src_line_id AND u.status = 'ALLOCATED' AND u.deleted_at IS NULL
      WHERE a.org_project_id = ? AND a.status = 'POSTED' AND a.deleted_at IS NULL AND (a.resource_type <> 'MATERIAL' OR (CASE a.src_type WHEN 'GRN_STOCK' THEN ? = 'GRN' WHEN 'ISSUE' THEN ? = 'ISSUE' ELSE 1 END)) GROUP BY 1, 2, 3, 4`).all(projectId, rule, rule);
    const lbl = (w, c, r, p) => `${wbsLabel(w)} / ${codeLabel(c)} / ${RESOURCES[r] ?? r}${p ? ` / ${p}` : ''}`;
    for (const x of expBudget) { const k = keyOf(x.w, x.c, x.r, ''); seen.add(k); const f = fmap.get(k); cmp('Budget cost', k, lbl(x.w, x.c, x.r, ''), x.a, f?.budget_cost ?? 0); cmp('Budget quantity', k, lbl(x.w, x.c, x.r, ''), x.q, f?.budget_qty ?? 0, true); }
    for (const x of expCommit) { const k = keyOf(x.w, x.c, x.r, ''); seen.add(k); cmp('Committed cost', k, lbl(x.w, x.c, x.r, ''), x.n, fmap.get(k)?.committed_cost ?? 0); }
    for (const x of expActual) { const k = keyOf(x.w, x.c, x.r, x.p); seen.add(k); const f = fmap.get(k); cmp('Actual cost', k, lbl(x.w, x.c, x.r, x.p), x.n, f?.actual_cost ?? 0); cmp('Actual quantity', k, lbl(x.w, x.c, x.r, x.p), x.q, f?.actual_qty ?? 0, true); }
    // a fact with nothing behind it in the ledgers
    const exp = { budget: new Set(expBudget.map((x) => keyOf(x.w, x.c, x.r, ''))), commit: new Set(expCommit.map((x) => keyOf(x.w, x.c, x.r, ''))), actual: new Set(expActual.map((x) => keyOf(x.w, x.c, x.r, x.p))) };
    for (const [k, f] of fmap) {
      if (f.budget_cost && !exp.budget.has(k)) cmp('Budget cost', k, lbl(f.wbs_id, f.cost_code_id, f.resource_type, f.period_key), 0, f.budget_cost);
      if (f.committed_cost && !exp.commit.has(k)) cmp('Committed cost', k, lbl(f.wbs_id, f.cost_code_id, f.resource_type, f.period_key), 0, f.committed_cost);
      if (f.actual_cost && !exp.actual.has(k)) cmp('Actual cost', k, lbl(f.wbs_id, f.cost_code_id, f.resource_type, f.period_key), 0, f.actual_cost);
    }
    const status = diffs.length ? 'DIFFERENCES' : 'CLEAN'; const now = nowIso();
    const id = Number(db.prepare('INSERT INTO ctl_recon_runs (company_id, org_project_id, run_kind, status, tolerance, checked, diff_count, diff_json, run_at, run_by, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'site_control\', ?)').run(companyId, projectId, kind, status, tol, checked, diffs.length, JSON.stringify(diffs.slice(0, 200)), now, user, projectId, user, String(projectId)).lastInsertRowid);
    if (diffs.length) {
      const p = db.prepare('SELECT code FROM org_projects WHERE id = ?').get(projectId);
      event('site.control.reconciliation_failed', companyId, projectId, id, { projectId, runId: id, differences: diffs.length, tolerance: rs(tol) });
      notify(companyId, 'site.control.recon_alert', ['role:PCMGR|PM'], String(p?.code), String(p?.code), `The control figures of ${p?.code} differed from the ledgers in ${diffs.length} place(s) above the tolerance; they were rebuilt.`, `/site/control?projectId=${projectId}`, id, { projectId });
    }
    return { id, projectId, kind, status, checked, tolerance: rs(tol), differences: diffs, runAt: now };
  }
  /** The nightly job: for every project of a company that has the engine on, reconcile, and rebuild what differed. */
  function nightly(companyId) {
    const out = { projects: 0, clean: 0, differing: 0 };
    for (const p of db.prepare("SELECT id FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE'").all(companyId)) {
      const hasData = db.prepare('SELECT 1 FROM ctl_facts WHERE org_project_id = ? LIMIT 1').get(p.id) || db.prepare('SELECT 1 FROM bud_budgets WHERE org_project_id = ? AND deleted_at IS NULL LIMIT 1').get(p.id); if (!hasData) continue;
      const r = reconcile(companyId, p.id, { kind: 'NIGHTLY' }); out.projects += 1; if (r.status === 'CLEAN') out.clean += 1; else { out.differing += 1; refresh(companyId, p.id, 'reconciliation'); }
    }
    return out;
  }

  // ---- the views (FR-04, FR-05) ---------------------------------------------------------------------------------------------------------------------------------------------------
  const SUMS = 'SUM(f.planned_cost) AS planned, SUM(f.budget_cost) AS budget, SUM(f.committed_cost) AS committed, SUM(f.actual_cost) AS actual, SUM(f.earned_cost) AS earned, SUM(f.billed_value) AS billed, SUM(f.certified_value) AS certified, SUM(f.budget_qty) AS bq, SUM(f.actual_qty) AS aq';
  const periodSql = (period) => (period ? " AND (f.period_key = '' OR f.period_key = :period)" : '');
  const figure = (g) => {
    const budget = g.budget ?? 0; const committed = g.committed ?? 0; const actual = g.actual ?? 0; const earned = g.earned ?? 0; const planned = g.planned ?? 0; const cpi = ratio(earned, actual); const spi = ratio(earned, planned);
    const outlook = actual + committed > budget ? actual + committed : (cpi && cpi > 0 ? Math.round(budget / cpi) : budget);
    return { budget: rs(budget), planned: rs(planned), committed: rs(committed), actual: rs(actual), earned: rs(earned), billed: rs(g.billed ?? 0), certified: rs(g.certified ?? 0), forecast: null, outlook: rs(outlook), available: rs(budget - committed - actual), usedPct: budget > 0 ? Math.round(((committed + actual) / budget) * 10000) / 100 : null, costVariance: rs(earned - actual), scheduleVariance: rs(earned - planned), cpi, spi, over: actual + committed > budget && (budget > 0 || actual + committed > 0) };
  };
  function grouped(projectId, by, period) {
    const base = { WBS: ['f.wbs_id', 'f.wbs_id'], COST_CODE: ['f.cost_code_id', 'f.cost_code_id'], RESOURCE: ['f.resource_type', 'f.resource_type'], MONTH: ['f.period_key', 'f.period_key'] };
    const params = { p: projectId, ...(period ? { period } : {}) };
    if (by === 'COST_HEAD') return db.prepare(`SELECT c.cost_head_id AS k, ${SUMS} FROM ctl_facts f LEFT JOIN fin_cost_codes c ON c.id = f.cost_code_id WHERE f.org_project_id = :p AND f.deleted_at IS NULL${periodSql(period)} GROUP BY 1`).all(params).map((r) => ({ ...r, id: r.k ?? null, label: headLabel(r.k) }));
    const [expr] = base[by] ?? base.WBS;
    return db.prepare(`SELECT ${expr} AS k, ${SUMS} FROM ctl_facts f WHERE f.org_project_id = :p AND f.deleted_at IS NULL${periodSql(period)} GROUP BY 1`).all(params).map((r) => ({ ...r, id: by === 'RESOURCE' || by === 'MONTH' ? r.k : (r.k ?? null), label: by === 'WBS' ? wbsLabel(r.k) : by === 'COST_CODE' ? codeLabel(r.k) : by === 'RESOURCE' ? (RESOURCES[r.k] ?? r.k) : (r.k === '' ? 'Standing figures (budget, committed, earned)' : r.k) }));
  }
  const total = (rows) => rows.reduce((t, r) => { for (const k of ['planned', 'budget', 'committed', 'actual', 'earned', 'billed', 'certified', 'bq', 'aq']) t[k] += r[k] ?? 0; return t; }, { planned: 0, budget: 0, committed: 0, actual: 0, earned: 0, billed: 0, certified: 0, bq: 0, aq: 0 });
  const lastRun = (projectId) => { const r = db.prepare('SELECT * FROM ctl_recon_runs WHERE org_project_id = ? ORDER BY id DESC LIMIT 1').get(projectId); return r ? { id: r.id, kind: r.run_kind, status: r.status, checked: r.checked, differences: r.diff_count, runAt: r.run_at, tolerance: rs(r.tolerance) } : null; };
  const unallocatedOf = (actor, projectId) => { const q = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS a FROM ctl_unallocated WHERE org_project_id = ? AND status IN ('OPEN', 'RETURNED', 'SUBMITTED') AND deleted_at IS NULL").get(projectId); return { count: q.n, amount: rs(q.a) }; };
  const prepared = (actor, q) => {
    const p = project(actor, q.projectId); const by = q.groupBy ?? 'WBS'; if (!GROUPS[by]) fail([{ field: 'groupBy', message: 'Use WBS, COST_CODE, COST_HEAD, RESOURCE or MONTH' }]);
    if (q.period && !/^\d{4}-\d{2}$/.test(q.period)) fail([{ field: 'period', message: 'Use a month as YYYY-MM' }]); return { p, by };
  };
  const toRow = (g, by) => ({ key: `${by}:${g.id ?? 0}`, id: g.id ?? null, label: g.label, ...figure(g) });
  function facts(actor, q) {
    const { p, by } = prepared(actor, q); const rows = grouped(p.id, by, q.period).sort((a, b) => String(a.label).localeCompare(String(b.label), 'en', { numeric: true })).map((g) => toRow(g, by));
    const t = total(grouped(p.id, 'WBS', q.period)); return { projectId: p.id, projectCode: p.code, projectName: p.name, groupBy: by, groupLabel: GROUPS[by], period: q.period ?? null, budgetDocNo: budgetOf(p.id)?.doc_no ?? null, rows, totals: figure(t), unallocated: unallocatedOf(actor, p.id), reconciliation: lastRun(p.id), materialRule: materialRule(actor.companyId) };
  }
  function dashboard(actor, q) {
    const p = project(actor, q.projectId); const period = q.period ?? null; const wbs = grouped(p.id, 'WBS', period); const t = figure(total(wbs)); const head = grouped(p.id, 'COST_HEAD', period).map((g) => toRow(g, 'COST_HEAD')).sort((a, b) => (b.budget ?? 0) - (a.budget ?? 0));
    const months = db.prepare("SELECT f.period_key AS m, SUM(f.actual_cost) AS actual FROM ctl_facts f WHERE f.org_project_id = ? AND f.deleted_at IS NULL AND f.period_key <> '' GROUP BY 1 ORDER BY 1").all(p.id); let cum = 0; const trend = months.map((m) => { cum += m.actual; return { month: m.m, actual: rs(m.actual), cumulative: rs(cum) }; });
    const nodes = wbs.map((g) => toRow(g, 'WBS')).sort((a, b) => String(a.label).localeCompare(String(b.label), 'en', { numeric: true }));
    const un = unallocatedOf(actor, p.id); const run = lastRun(p.id); const exceptions = [];
    for (const r of nodes) if (r.over) exceptions.push({ kind: 'OVER_BUDGET', label: r.label, detail: `Committed and actual ${r.usedPct == null ? '' : `${r.usedPct} % `}of the budget`, groupBy: 'WBS', id: r.id, amount: rs(Math.round((r.actual + (r.committed ?? 0) - (r.budget ?? 0)) * 100)) });
    for (const r of nodes) if (r.cpi != null && r.cpi < 0.9 && (r.actual ?? 0) > 0) exceptions.push({ kind: 'COST_BEHIND', label: r.label, detail: `Cost performance ${r.cpi}: earned ${r.earned}, spent ${r.actual}`, groupBy: 'WBS', id: r.id });
    if (un.count) exceptions.push({ kind: 'UNALLOCATED', label: `${un.count} unallocated cost line(s)`, detail: `${un.amount} waits to be allocated`, link: '/site/control-unallocated' });
    if (run?.status === 'DIFFERENCES') exceptions.push({ kind: 'RECONCILIATION', label: 'The last reconciliation found differences', detail: `${run.differences} difference(s) on ${run.runAt.slice(0, 10)}; the figures were rebuilt` });
    const mine = db.prepare("SELECT COUNT(*) AS n FROM ctl_unallocated WHERE org_project_id = ? AND status = 'SUBMITTED' AND deleted_at IS NULL").get(p.id).n;
    return { projectId: p.id, projectCode: p.code, projectName: p.name, period, budgetDocNo: budgetOf(p.id)?.doc_no ?? null, tiles: t, byWbs: nodes, byCostHead: head, byResource: grouped(p.id, 'RESOURCE', period).map((g) => toRow(g, 'RESOURCE')), trend, exceptions, unallocated: un, reconciliation: run, myPending: may(actor, 'site.control.approve', p.id) ? mine : 0, materialRule: materialRule(actor.companyId), projects: projects(actor), can: { reconcile: may(actor, 'site.control.reconcile', p.id), export: may(actor, 'site.control.export', p.id) } };
  }
  /** FR-05: the budget against the actual cost with the quantity and the rate variance split; planned against earned; committed against budget. The split of a key is (earned qty - actual qty) x budget rate and (budget rate - actual rate) x actual qty; with the earned value that is the cost variance. */
  function variance(actor, q) {
    const { p, by } = prepared(actor, { ...q, groupBy: q.groupBy ?? 'WBS' }); if (by === 'MONTH') fail([{ field: 'groupBy', message: 'The variance analysis groups by WBS, cost code, cost head or resource' }]);
    const keys = db.prepare(`SELECT f.wbs_id AS w, f.cost_code_id AS c, f.resource_type AS r, SUM(f.budget_cost) AS bc, SUM(f.budget_qty) AS bq, SUM(f.actual_cost) AS ac, SUM(f.actual_qty) AS aq, SUM(f.earned_cost) AS ec, SUM(f.planned_cost) AS pc, SUM(f.committed_cost) AS cc, k.cost_head_id AS h
      FROM ctl_facts f LEFT JOIN fin_cost_codes k ON k.id = f.cost_code_id WHERE f.org_project_id = :p AND f.deleted_at IS NULL${periodSql(q.period)} GROUP BY 1, 2, 3`).all({ p: p.id, ...(q.period ? { period: q.period } : {}) });
    const out = new Map();
    for (const x of keys) {
      const gk = by === 'WBS' ? x.w : by === 'COST_CODE' ? x.c : by === 'COST_HEAD' ? x.h : x.r; const label = by === 'WBS' ? wbsLabel(x.w) : by === 'COST_CODE' ? codeLabel(x.c) : by === 'COST_HEAD' ? headLabel(x.h) : (RESOURCES[x.r] ?? x.r);
      const g = out.get(gk ?? 0) ?? { id: gk ?? null, label, bc: 0, bq: 0, eq: 0, aq: 0, ac: 0, ec: 0, pc: 0, cc: 0, qtyVar: 0, rateVar: 0 }; out.set(gk ?? 0, g);
      const br = x.bq > 0 ? x.bc / x.bq : 0; const eq = x.bc > 0 ? (x.bq * x.ec) / x.bc : 0; const qv = (eq - x.aq) * br; const cv = x.ec - x.ac;
      g.bc += x.bc; g.bq += x.bq; g.eq += eq; g.aq += x.aq; g.ac += x.ac; g.ec += x.ec; g.pc += x.pc; g.cc += x.cc; g.qtyVar += qv; g.rateVar += cv - qv;
    }
    const shape = (g) => ({ id: g.id, label: g.label, budget: rs(g.bc), budgetQty: d3(g.bq), budgetRate: g.bq > 0 ? rs(Math.round((g.bc * 1000) / g.bq)) : null, earnedQty: d3(Math.round(g.eq)), actualQty: d3(g.aq), actualRate: g.aq > 0 ? rs(Math.round((g.ac * 1000) / g.aq)) : null, planned: rs(g.pc), earned: rs(g.ec), actual: rs(g.ac), committed: rs(g.cc),
      quantityVariance: rs(Math.round(g.qtyVar)), rateVariance: rs(Math.round(g.rateVar)), costVariance: rs(g.ec - g.ac), scheduleVariance: rs(g.ec - g.pc), committedOverBudget: rs(g.cc + g.ac - g.bc), over: g.cc + g.ac > g.bc && g.bc > 0 });
    const rows = [...out.values()].sort((a, b) => String(a.label).localeCompare(String(b.label), 'en', { numeric: true })).map(shape);
    const all = [...out.values()].reduce((t, g) => { for (const k of ['bc', 'bq', 'eq', 'aq', 'ac', 'ec', 'pc', 'cc', 'qtyVar', 'rateVar']) t[k] += g[k]; return t; }, { id: null, label: 'Total', bc: 0, bq: 0, eq: 0, aq: 0, ac: 0, ec: 0, pc: 0, cc: 0, qtyVar: 0, rateVar: 0 });
    return { projectId: p.id, projectCode: p.code, projectName: p.name, groupBy: by, groupLabel: GROUPS[by], period: q.period ?? null, rows, totals: shape(all), can: { export: may(actor, 'site.control.export', p.id) } };
  }
  function varianceExport(actor, q) {
    need(actor, 'site.control.export', 'export the variance analysis', q.projectId); const r = variance(actor, q); const co = db.prepare('SELECT legal_name FROM org_companies WHERE id = ?').get(actor.companyId)?.legal_name ?? '';
    audit(actor, 'ctl_facts', 'variance', 'export', actor.companyId, { newValues: { format: q.format, groupBy: r.groupBy, project: r.projectCode } });
    const columns = [['label', r.groupLabel], ['budget', 'Budget'], ['planned', 'Planned'], ['earned', 'Earned'], ['actual', 'Actual'], ['committed', 'Committed'], ['budgetQty', 'Budget qty'], ['earnedQty', 'Earned qty'], ['actualQty', 'Actual qty'], ['budgetRate', 'Budget rate'], ['actualRate', 'Actual rate'], ['quantityVariance', 'Quantity variance'], ['rateVariance', 'Rate variance'], ['costVariance', 'Cost variance'], ['scheduleVariance', 'Schedule variance']].map(([key, label]) => ({ key, label, type: 'text' }));
    const rows = [...r.rows, r.totals].map((g) => Object.fromEntries(columns.map((c) => [c.key, String(g[c.key] ?? '')])));
    const footer = [`${co}: ${r.projectCode} quantity and rate variance by ${r.groupLabel.toLowerCase()}${r.period ? `, ${r.period}` : ''}`, 'Quantity variance = (earned quantity - actual quantity) x budget rate; rate variance = (budget rate - actual rate) x actual quantity; together they are the cost variance (earned - actual).'];
    const name = `control-variance-${r.projectCode}`;
    if (q.format === 'csv') return { buffer: Buffer.from(toCsv({ columns, rows, footer })), contentType: 'text/csv; charset=utf-8', fileName: `${name}.csv`, rows: rows.length };
    if (q.format === 'pdf') return { buffer: toPdf({ columns, rows, footer, title: footer[0] }), contentType: 'application/pdf', fileName: `${name}.pdf`, rows: rows.length };
    return { buffer: toXlsx({ columns, rows, footer, sheetName: 'Variance' }), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: `${name}.xlsx`, rows: rows.length };
  }
  /** FR-04: the source documents behind a figure of the facts. */
  function drill(actor, q) {
    const p = project(actor, q.projectId); const m = q.measure; if (!MEASURES[m]) fail([{ field: 'measure', message: `Use one of ${Object.keys(MEASURES).join(', ')}` }]);
    const f = { w: q.wbsId === undefined ? undefined : (q.wbsId === 0 ? null : q.wbsId), c: q.costCodeId === undefined ? undefined : (q.costCodeId === 0 ? null : q.costCodeId), r: q.resourceType };
    const cond = (alias, wc = 'wbs_id', cc = 'cost_code_id') => { const parts = []; const params = []; if (f.w !== undefined) { parts.push(f.w === null ? `${alias}.${wc} IS NULL` : `${alias}.${wc} = ?`); if (f.w !== null) params.push(f.w); } if (f.c !== undefined) { parts.push(f.c === null ? `${alias}.${cc} IS NULL` : `${alias}.${cc} = ?`); if (f.c !== null) params.push(f.c); } if (f.r) { parts.push(`${alias}.resource_type = ?`); params.push(f.r); } return { sql: parts.length ? ` AND ${parts.join(' AND ')}` : '', params }; };
    const rule = materialRule(actor.companyId); let rows = [];
    if (m === 'BUDGET') { const cur = budgetOf(p.id); const c = cond('l'); rows = cur ? db.prepare(`SELECT l.* FROM bud_lines l WHERE l.budget_id = ? AND l.deleted_at IS NULL AND l.line_kind IN ('DIRECT', 'OVERHEAD')${c.sql} ORDER BY l.sort_order, l.id LIMIT 500`).all(cur.id, ...c.params).map((l) => ({ id: l.id, kind: 'Budget line', docRef: cur.doc_no, description: l.resource_name, wbs: wbsLabel(l.wbs_id), costCode: codeLabel(l.cost_code_id), resource: RESOURCES[l.resource_type], qty: d3(l.qty), amount: rs(l.amount), date: null, counted: true, link: `/bud/budgets?id=${cur.id}` })) : []; }
    if (m === 'COMMITTED') { const c = cond('c'); rows = db.prepare(`SELECT c.* FROM bud_commitments c WHERE c.org_project_id = ? AND c.deleted_at IS NULL AND c.status IN ('OPEN', 'PARTIAL')${c.sql} ORDER BY c.id DESC LIMIT 500`).all(p.id, ...c.params).map((x) => ({ id: x.id, kind: `${x.stage} commitment`, docRef: x.doc_ref ?? `${x.src_type} ${x.src_id}`, description: x.vendor_name ?? x.description, wbs: wbsLabel(x.wbs_id), costCode: codeLabel(x.cost_code_id), resource: RESOURCES[x.resource_type], qty: d3(x.qty), amount: rs(x.amount - x.consumed_amount - x.released_amount), date: x.commit_date, counted: true, link: `/bud/ledger?projectId=${p.id}` })); }
    if (m === 'ACTUAL') {
      const c = cond('a'); const per = q.period ? ' AND substr(a.actual_date, 1, 7) = ?' : '';
      rows = db.prepare(`SELECT a.*, u.alloc_wbs_id, u.alloc_cost_code_id FROM bud_actuals a LEFT JOIN ctl_unallocated u ON u.company_id = a.company_id AND u.src_type = a.src_type AND u.src_id = a.src_id AND u.src_line_id = a.src_line_id AND u.status = 'ALLOCATED' AND u.deleted_at IS NULL WHERE a.org_project_id = ? AND a.status = 'POSTED' AND a.deleted_at IS NULL${c.sql}${per} ORDER BY a.actual_date DESC, a.id DESC LIMIT 500`).all(p.id, ...c.params, ...(q.period ? [q.period] : [])).map((x) => { const cb = countedBy(rule, x); return { id: x.id, kind: x.src_type, docRef: x.doc_ref ?? `${x.src_type} ${x.src_id}`, description: x.vendor_name ?? x.description, wbs: wbsLabel(x.wbs_id ?? x.alloc_wbs_id), costCode: codeLabel(x.cost_code_id ?? x.alloc_cost_code_id), resource: RESOURCES[x.resource_type], qty: d3(x.qty), amount: rs(x.amount), date: x.actual_date, counted: cb.counted, note: cb.why, link: `/bud/ledger?projectId=${p.id}` }; });
    }
    if (m === 'EARNED' || m === 'PLANNED') {
      let ev = null; try { ev = evaluate(actor.companyId, p.id, todayIST()); } catch { ev = null; }
      const wid = f.w; const ids = (() => { if (!ev || !wid) return null; const under = new Set([wid]); let grew = true; while (grew) { grew = false; for (const n of ev.wbs) if (!under.has(n.id) && under.has(n.parentId)) { under.add(n.id); grew = true; } } return under; })();
      rows = (ev?.activities ?? []).filter((a) => !wid || ids?.has(a.wbsId)).map((a) => ({ id: a.code, kind: 'Activity', docRef: a.code, description: a.name, wbs: wbsLabel(a.wbsId), costCode: '', resource: '', qty: a.cumQty, amount: rs(m === 'EARNED' ? a.ev : a.pv), date: null, counted: true, note: `${m === 'EARNED' ? 'Financial progress' : 'Planned'} ${Math.round((m === 'EARNED' ? a.financial : a.planned) * 10000) / 100} % of a budget of ${rs(a.bac)}`, link: `/site/progress?projectId=${p.id}` }));
    }
    if (m === 'UNALLOCATED') rows = db.prepare("SELECT * FROM ctl_unallocated WHERE org_project_id = ? AND deleted_at IS NULL AND status IN ('OPEN', 'RETURNED', 'SUBMITTED') ORDER BY id DESC LIMIT 500").all(p.id).map((x) => ({ id: x.id, kind: ALLOC_STATUS[x.status], docRef: x.doc_ref ?? `${x.src_type} ${x.src_id}`, description: x.vendor_name ?? x.description, wbs: REASONS[x.reason], costCode: '', resource: RESOURCES[x.resource_type], qty: d3(x.qty), amount: rs(x.amount), date: x.actual_date, counted: true, link: `/site/control-unallocated?id=${x.id}` }));
    return { projectId: p.id, projectCode: p.code, measure: m, measureLabel: MEASURES[m], period: q.period ?? null, rows, total: rs(rows.filter((r) => r.counted).reduce((a, r) => a + Math.round((r.amount ?? 0) * 100), 0)), materialRule: rule };
  }
  const reconRuns = (actor, projectId) => { const p = project(actor, projectId); return db.prepare('SELECT * FROM ctl_recon_runs WHERE org_project_id = ? ORDER BY id DESC LIMIT 30').all(p.id).map((r) => ({ id: r.id, kind: r.run_kind, status: r.status, checked: r.checked, differences: r.diff_count, tolerance: rs(r.tolerance), runAt: r.run_at, runBy: r.run_by, detail: (() => { try { return JSON.parse(r.diff_json ?? '[]'); } catch { return []; } })() })); };
  const runReconcile = (actor, { projectId }) => {
    const p = project(actor, projectId, 'site.control.reconcile'); audit(actor, 'ctl_recon_runs', String(p.id), 'reconcile', actor.companyId);
    const r = reconcile(actor.companyId, p.id, { kind: 'MANUAL', user: actor.user }); const repaired = r.status === 'DIFFERENCES' ? refresh(actor.companyId, p.id, 'reconciliation') : null; return { ...r, repaired: Boolean(repaired) };
  };
  const rebuildNow = (actor, { projectId }) => { const p = project(actor, projectId, 'site.control.reconcile'); audit(actor, 'ctl_facts', String(p.id), 'refresh', actor.companyId); return refresh(actor.companyId, p.id, 'manual'); };

  // ---- the queue of unallocated costs and its approval (FR-06, section 9): QS or project controls propose, the project manager approves ---------------------------------------------------
  const arow = (actor, id, key = 'site.control.view') => {
    const r = db.prepare('SELECT * FROM ctl_unallocated WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'site.control.view', r.org_project_id)) throw notFound('That unallocated cost does not exist.'); if (key !== 'site.control.view') need(actor, key, 'do that with an unallocated cost', r.org_project_id); return r;
  };
  const priority = (r) => { const age = Math.max(0, Math.floor((Date.parse(todayIST()) - Date.parse(r.actual_date)) / 86400000)); return age >= 14 || r.amount >= 10000000 ? 'HIGH' : age >= 7 || r.amount >= 1000000 ? 'MEDIUM' : 'NORMAL'; };
  const aview = (actor, r) => {
    const p = db.prepare('SELECT code, name FROM org_projects WHERE id = ?').get(r.org_project_id); const can = (k) => may(actor, k, r.org_project_id); const own = same(r.requested_by, actor.user); const open = ['OPEN', 'RETURNED'].includes(r.status);
    return { id: r.id, projectId: r.org_project_id, projectCode: p?.code, sourceType: r.src_type, sourceId: r.src_id, lineId: r.src_line_id, docRef: r.doc_ref, vendor: r.vendor_name, description: r.description, resourceType: r.resource_type, resourceLabel: RESOURCES[r.resource_type], amount: rs(r.amount), qty: d3(r.qty), date: r.actual_date, ageDays: Math.max(0, Math.floor((Date.parse(todayIST()) - Date.parse(r.actual_date)) / 86400000)), priority: priority(r),
      reason: r.reason, reasonLabel: REASONS[r.reason], status: r.status, statusLabel: ALLOC_STATUS[r.status], allocWbsId: r.alloc_wbs_id, allocCostCodeId: r.alloc_cost_code_id, allocatedTo: r.status === 'OPEN' ? null : { wbs: r.alloc_wbs_id ? wbsLabel(r.alloc_wbs_id) : null, costCode: r.alloc_cost_code_id ? codeLabel(r.alloc_cost_code_id) : null },
      note: r.note, requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, workflowInstanceId: r.workflow_instance_id, rowVersion: r.version,
      can: { submit: can('site.control.submit') && open && !['CLEARED'].includes(r.status), withdraw: r.status === 'SUBMITTED' && own, approve: can('site.control.approve') && r.status === 'SUBMITTED' && !own } };
  };
  const ascope = (actor) => { const f = authz.scopeFilter(actor, 'site.control.view', { project: 'x.org_project_id' }); return { sql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  const unallocated = {
    list(actor, query) {
      if (!authz.check(actor, 'site.control.view').allowed) throw forbidden('You may not see unallocated costs (permission site.control.view).'); const sc = ascope(actor);
      return runList(db, allocList, parseListRequest(allocList, query), { select: 'x.*, p.code AS pcode', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (x) => ({ id: x.id, project: x.pcode, projectId: x.org_project_id, source: x.src_type, doc: x.doc_ref ?? `${x.src_type} ${x.src_id}`, vendor: x.vendor_name, resource: x.resource_type, resourceLabel: RESOURCES[x.resource_type], amount: String(rs(x.amount)), date: x.actual_date, ageDays: Math.max(0, Math.floor((Date.parse(todayIST()) - Date.parse(x.actual_date)) / 86400000)), priority: priority(x), reason: x.reason, status: x.status, statusLabel: ALLOC_STATUS[x.status] }) });
    },
    get(actor, id) { const v = aview(actor, arow(actor, id)); if (v.can.approve && v.workflowInstanceId) v.taskId = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === v.workflowInstanceId)?.id ?? null; return v; },
    options(actor, projectId) {
      const p = project(actor, projectId);
      return { projectId: p.id, wbs: db.prepare('SELECT id, code, name FROM proj_wbs WHERE project_id = ? AND deleted_at IS NULL ORDER BY code').all(p.id).map((w) => ({ id: w.id, label: `${w.code} ${w.name}` })), costCodes: db.prepare('SELECT id, code, name FROM fin_cost_codes WHERE (company_id = ? OR company_id IS NULL) AND deleted_at IS NULL ORDER BY code').all(actor.companyId).map((c) => ({ id: c.id, label: `${c.code} ${c.name}` })) };
    },
    /** Proposes where the cost belongs and sends it for approval (maker); a returned one is corrected and sent again. */
    submit(actor, id, b) {
      const r = arow(actor, id, 'site.control.submit'); if (!['OPEN', 'RETURNED'].includes(r.status)) throw unprocessable(`${ALLOC_STATUS[r.status]}: it is not sent for allocation now.`);
      const wbs = b.wbsId ? db.prepare('SELECT id FROM proj_wbs WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(b.wbsId, r.org_project_id) : null; const code = b.costCodeId ? db.prepare('SELECT id FROM fin_cost_codes WHERE id = ? AND (company_id = ? OR company_id IS NULL) AND deleted_at IS NULL').get(b.costCodeId, r.company_id) : null;
      const problems = []; if (b.wbsId && !wbs) problems.push({ field: 'wbsId', message: 'Not a WBS node of this project' }); if (b.costCodeId && !code) problems.push({ field: 'costCodeId', message: 'Not a cost code of this company' });
      if (['NO_WBS', 'NO_WBS_NO_COST_CODE'].includes(r.reason) && !b.wbsId) problems.push({ field: 'wbsId', message: 'Choose the WBS node' }); if (['NO_COST_CODE', 'NO_WBS_NO_COST_CODE'].includes(r.reason) && !b.costCodeId) problems.push({ field: 'costCodeId', message: 'Choose the cost code' }); fail(problems);
      if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this cost; reload it.');
      return transaction(db, () => {
        const ctx = { projectId: r.org_project_id, amount: r.amount }; db.prepare('UPDATE ctl_unallocated SET alloc_wbs_id = ?, alloc_cost_code_id = ?, allocated_to_json = ?, note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.wbsId ?? null, b.costCodeId ?? null, JSON.stringify({ wbsId: b.wbsId ?? null, costCodeId: b.costCodeId ?? null }), b.note ?? null, actor.user, nowIso(), r.id);
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: ALLOC_DOC, docId: String(r.id), comment: `${r.doc_ref ?? r.src_id}: ${rs(r.amount)}`.slice(0, 300), context: ctx }); db.prepare('UPDATE ctl_unallocated SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE ctl_unallocated SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id); audit(actor, 'ctl_unallocated', r.id, 'submit', r.company_id, { newValues: { wbsId: b.wbsId ?? null, costCodeId: b.costCodeId ?? null } }); return unallocated.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = arow(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only an allocation waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return unallocated.get(actor, r.id); },
    history(actor, id) { const r = arow(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'ctl_unallocated' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    decide(instance, actor, outcome, comment) {
      const r = db.prepare('SELECT * FROM ctl_unallocated WHERE id = ?').get(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return; const now = nowIso(); const p = db.prepare('SELECT code FROM org_projects WHERE id = ?').get(r.org_project_id);
      if (outcome === 'APPROVED') {
        db.prepare("UPDATE ctl_unallocated SET status = 'ALLOCATED', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, r.id); audit(actor, 'ctl_unallocated', r.id, 'approve', r.company_id);
        refresh(r.company_id, r.org_project_id, 'allocation');
        notify(r.company_id, 'site.control.alloc_approved', [`user:${r.requested_by}`], r.doc_ref ?? r.src_id, String(p?.code), `The cost ${r.doc_ref ?? r.src_id} (${rs(r.amount)}) is allocated to ${r.alloc_wbs_id ? wbsLabel(r.alloc_wbs_id) : 'its WBS node'}${r.alloc_cost_code_id ? `, ${codeLabel(r.alloc_cost_code_id)}` : ''}; the control figures are rebuilt.`, `/site/control-unallocated?id=${r.id}`, r.id); return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : 'OPEN'; // a rejection or a withdrawal puts the cost back in the queue
      db.prepare('UPDATE ctl_unallocated SET status = ?, workflow_instance_id = ?, alloc_wbs_id = ?, alloc_cost_code_id = ?, allocated_to_json = ?, note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, outcome === 'RETURNED' ? r.workflow_instance_id : null, outcome === 'RETURNED' ? r.alloc_wbs_id : null, outcome === 'RETURNED' ? r.alloc_cost_code_id : null, outcome === 'RETURNED' ? r.allocated_to_json : null, outcome === 'REJECTED' ? `Not approved${comment ? `: ${comment}` : ''}` : (comment ?? r.note), actor.user, now, r.id);
      audit(actor, 'ctl_unallocated', r.id, withdrawn ? 'withdraw' : outcome.toLowerCase(), r.company_id, { reason: comment });
      if (outcome === 'REJECTED') notify(r.company_id, 'site.control.alloc_rejected', [`user:${r.requested_by}`], r.doc_ref ?? r.src_id, String(p?.code), `The allocation of ${r.doc_ref ?? r.src_id} was not approved${comment ? `: ${comment}` : ''}; it is back in the queue.`, `/site/control-unallocated?id=${r.id}`, r.id);
    },
  };

  return { facts, dashboard, variance, varianceExport, drill, reconRuns, runReconcile, rebuildNow, refresh, onEvent, reconcile, nightly, unallocated, allocDecide: unallocated.decide, projects, materialRule, countedBy };
}
