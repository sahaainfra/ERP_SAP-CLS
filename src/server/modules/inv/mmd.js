import { forbidden, notFound } from '../../platform/http/errors.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { todayIST } from '../../../shared/dates.js';
import { rid } from '../proc/base.js';
import { daysBetween } from '../proc/ana.js';

// Materials management dashboard (part 16.11). Nothing is stored: every figure is worked out on request from the live stock ledger, balances and the documents of the material lifecycle (material request, requisition, order, goods receipt and inspection,
// issue, transfer, count), inside the data scope of the person. The inventory value is the valuation of the books and, at the same ledger entry, the sum of the stock ledger (BR-01); a difference is shown, never hidden.
// Quantities are thousandths of the base unit in the tables and units in the API, money paise.
for (const [key, def, description, min, max] of [
  ['inv.mmd.target_turns', 4, 'FR-01: the stock turns a year (issues at cost over the average stock value) below which the KPI turns red.', 0, 1000],
  ['inv.mmd.non_moving_days', 90, 'FR-01: stock with no issue or transfer out for this many days is non-moving.', 7, 3650],
  ['inv.mmd.target_non_moving_pct', 10, 'FR-01: the share (percent) of the inventory value that is non-moving above which the KPI turns red.', 0, 100],
  ['inv.mmd.inspection_days', 3, 'FR-03: a goods receipt line waiting for inspection longer than this many days is late.', 0, 365],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType: 'integer', default: def, scopes: ['system', 'company'], description, min, max });

export const FUNNEL_STAGES = ['required', 'pr', 'po', 'delivered', 'accepted', 'issued', 'consumed'];
export const DRILL_KINDS = ['inventory', 'belowReorder', 'pendingGrn', 'openMrs', 'issuesToday', 'inTransit', 'nonMoving', 'wastage', 'mrsAwaiting', 'returnsPending', 'countsDue'];
const DAY = 86_400_000;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const d3 = (n) => Math.round(n) / 1000;
const pct1 = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const prevMonth = (iso) => { const y = Number(iso.slice(0, 4)); const m = Number(iso.slice(5, 7)); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const LIMIT = 200; const BOM = String.fromCharCode(0xfeff);

export function createMmdService({ db, base, mrc, proc, flags }) {
  const { authz, param, may, fail, audit } = base;
  const KEY = 'inv.dashboard.view'; const EXPORT = 'inv.dashboard.export';
  const pn = (companyId, key) => Number(param(companyId, key) ?? 0);
  /** A person holds the right if they hold it for the whole company or for any project or site (the data scope then narrows every query). */
  const holds = (actor, key) => authz.hasAnywhere(actor, key);
  const gate = (actor, what = 'see the materials dashboard', key = KEY) => { if (!holds(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const canValues = (actor) => holds(actor, 'inv.stock.values');
  const sc = (actor, col) => { gate(actor); const f = authz.scopeFilter(actor, KEY, { project: col }); return { sql: f.sql, unrestricted: Boolean(f.unrestricted) }; };
  const projectCode = (id) => (id ? (db.prepare('SELECT code FROM org_projects WHERE id = ?').get(id)?.code ?? '') : 'POOL');
  const itemOf = (id) => db.prepare('SELECT code, name, base_uom FROM mdm_items WHERE id = ?').get(id);
  const vname = (id) => { const v = db.prepare('SELECT trade_name, legal_name FROM mdm_partners WHERE id = ?').get(id); return v ? (v.trade_name ?? v.legal_name) : ''; };
  const storeCode = (id) => db.prepare('SELECT code FROM inv_stores WHERE id = ?').get(id)?.code ?? '';
  const row = (route, id, docNo, label, extra = {}) => ({ id, docNo, label, link: `${route}?id=${id}`, ...extra });

  function projectOf(actor, id) {
    if (!id) return null; const p = db.prepare('SELECT id, code, name, company_id FROM org_projects WHERE id = ? AND deleted_at IS NULL').get(rid(id));
    if (!p || p.company_id !== actor.companyId || !may(actor, KEY, p.id)) throw notFound('That project does not exist.'); return p;
  }
  function storeOf(actor, id) {
    if (!id) return null; const s = db.prepare('SELECT id, code, name, org_project_id, org_site_id, company_id FROM inv_stores WHERE id = ? AND deleted_at IS NULL').get(rid(id));
    if (!s || s.company_id !== actor.companyId || !(s.org_project_id ? may(actor, KEY, s.org_project_id) : may(actor, KEY))) throw notFound('That store does not exist.'); return s;
  }
  /** The query context: project and store resolved and checked against the data scope, the period and today. */
  function ctx(actor, q = {}) {
    gate(actor); const pj = projectOf(actor, q.projectId); const st = storeOf(actor, q.storeId);
    if (pj && st && st.org_project_id !== pj.id) throw notFound('That store does not belong to the project.');
    const today = todayIST(); const to = q.to ?? today; const from = q.from ?? addDays(to, -89); if (from > to) fail([{ field: 'from', message: 'The period starts after it ends' }]);
    return { pj, st, today, from, to, view: st ? 'store' : pj ? 'project' : 'company' };
  }
  /** WHERE of the active stores `s` in scope (and the project or store chosen). */
  function storeWhere(actor, c) {
    const f = sc(actor, 's.org_project_id'); const P = { c: actor.companyId }; let sql = `s.company_id = :c AND s.deleted_at IS NULL AND s.store_status = 'ACTIVE' AND ${f.sql}`;
    if (c.pj) { sql += ' AND s.org_project_id = :pj'; P.pj = c.pj.id; } if (c.st) { sql += ' AND s.id = :st'; P.st = c.st.id; } return { sql, params: P, unrestricted: f.unrestricted && !c.pj && !c.st };
  }
  /** WHERE of a document table `alias` with its project column and optional store column. */
  function docWhere(actor, alias, c, { project = `${alias}.org_project_id`, store = `${alias}.store_id`, deleted = true } = {}) {
    const f = sc(actor, project); const P = { c: actor.companyId }; let sql = `${alias}.company_id = :c${deleted ? ` AND ${alias}.deleted_at IS NULL` : ''} AND ${f.sql}`;
    if (c.pj) { sql += ` AND ${project} = :pj`; P.pj = c.pj.id; } if (c.st && store) { sql += ` AND ${store} = :st`; P.st = c.st.id; } return { sql, params: P };
  }

  // ---- the figures (FR-01) ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  /** BR-01: the valuation of the books and the stock ledger summed up to the same ledger entry. */
  function inventory(actor, c) {
    const w = storeWhere(actor, c); const v = canValues(actor); const asOf = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM inv_stock_ledger WHERE company_id = ?').get(actor.companyId).id;
    const stores = db.prepare(`SELECT s.id, s.code, s.name, s.org_project_id AS pid, COALESCE((SELECT SUM(x.value) FROM inv_valuation x WHERE x.store_id = s.id AND x.deleted_at IS NULL), 0) AS value,
      COALESCE((SELECT SUM(l.value) FROM inv_stock_ledger l WHERE l.store_id = s.id AND l.id <= :asOf), 0) AS ledger,
      (SELECT COUNT(*) FROM inv_valuation x WHERE x.store_id = s.id AND x.deleted_at IS NULL AND x.qty <> 0) AS items FROM inv_stores s WHERE ${w.sql} ORDER BY value DESC, s.code`).all({ ...w.params, asOf });
    const value = stores.reduce((n, s) => n + s.value, 0); const ledger = stores.reduce((n, s) => n + s.ledger, 0); const byProject = new Map();
    for (const s of stores) { const k = s.pid ?? 0; const e = byProject.get(k) ?? { key: k, label: s.pid ? projectCode(s.pid) : 'Central', value: 0 }; e.value += s.value; byProject.set(k, e); }
    return { value: v ? value : null, ledgerValue: v ? ledger : null, difference: v ? value - ledger : null, reconciled: value === ledger, asOfEntryId: asOf, stores: stores.length, items: stores.reduce((n, s) => n + s.items, 0),
      byStore: stores.map((s) => ({ id: s.id, code: s.code, name: s.name, project: projectCode(s.pid), value: v ? s.value : null, ledgerValue: v ? s.ledger : null, items: s.items, link: `/inv/balances?q=${encodeURIComponent(s.code)}` })),
      byProject: [...byProject.values()].sort((a, b) => b.value - a.value).map((p) => ({ ...p, value: v ? p.value : null })),
      rows: [] };
  }
  /** The month-end stock value of the last twelve months (the ledger running total of the stores in scope). */
  function valueTrend(actor, c) {
    if (!canValues(actor)) return []; const w = storeWhere(actor, c);
    const months = db.prepare(`SELECT substr(l.txn_date, 1, 7) AS m, SUM(l.value) AS v FROM inv_stock_ledger l JOIN inv_stores s ON s.id = l.store_id WHERE ${w.sql} GROUP BY m ORDER BY m`).all(w.params);
    let run = 0; const all = months.map((r) => ({ month: r.m, value: (run += r.v) })); return all.slice(-12);
  }
  /** Issues at cost over the average stock value, annualised. */
  function turns(actor, c) {
    const w = storeWhere(actor, c); const days = daysBetween(c.from, c.to) + 1;
    const issues = -db.prepare(`SELECT COALESCE(SUM(l.value), 0) AS v FROM inv_stock_ledger l JOIN inv_stores s ON s.id = l.store_id WHERE ${w.sql} AND l.txn_type = 'ISSUE' AND l.txn_date BETWEEN :from AND :to`).get({ ...w.params, from: c.from, to: c.to }).v;
    const opening = db.prepare(`SELECT COALESCE(SUM(l.value), 0) AS v FROM inv_stock_ledger l JOIN inv_stores s ON s.id = l.store_id WHERE ${w.sql} AND l.txn_date < :from`).get({ ...w.params, from: c.from }).v;
    const closing = db.prepare(`SELECT COALESCE(SUM(l.value), 0) AS v FROM inv_stock_ledger l JOIN inv_stores s ON s.id = l.store_id WHERE ${w.sql} AND l.txn_date <= :to`).get({ ...w.params, to: c.to }).v;
    const avg = (opening + closing) / 2; const target = pn(actor.companyId, 'inv.mmd.target_turns'); const t = avg > 0 ? Math.round(((issues * 365) / days / avg) * 100) / 100 : null;
    return { turns: canValues(actor) ? t : null, issues: canValues(actor) ? issues : null, averageValue: canValues(actor) ? Math.round(avg) : null, days, target, status: t == null ? 'neutral' : t < target ? 'bad' : 'ok' };
  }
  function belowReorder(actor, c) {
    const w = storeWhere(actor, c);
    const rows = db.prepare(`SELECT * FROM (SELECT p.store_id, p.item_id, p.reorder_level, p.reorder_qty, i.code AS icode, i.name AS iname, i.base_uom AS uom, s.code AS scode, s.org_project_id AS pid,
      COALESCE((SELECT SUM(b.qty_on_hand - b.qty_reserved - b.qty_inspection) FROM inv_balances b WHERE b.store_id = p.store_id AND b.item_id = p.item_id AND b.deleted_at IS NULL), 0) AS free
      FROM inv_reorder_params p JOIN inv_stores s ON s.id = p.store_id JOIN mdm_items i ON i.id = p.item_id
      WHERE ${w.sql} AND p.deleted_at IS NULL AND p.reorder_level > 0 AND p.effective_from <= :today
        AND p.id = (SELECT p2.id FROM inv_reorder_params p2 WHERE p2.store_id = p.store_id AND p2.item_id = p.item_id AND p2.deleted_at IS NULL AND p2.effective_from <= :today ORDER BY p2.effective_from DESC, p2.id DESC LIMIT 1)) WHERE free <= reorder_level ORDER BY (free * 1.0 / reorder_level), scode, icode`).all({ ...w.params, today: c.today });
    const out = rows.map((r) => ({ id: `${r.store_id}-${r.item_id}`, docNo: r.icode, label: `${r.icode} ${r.iname}`, store: r.scode, project: projectCode(r.pid), qty: d3(r.free), uom: r.uom, note: `Reorder level ${d3(r.reorder_level)}, reorder quantity ${d3(r.reorder_qty)}`, status: r.free <= 0 ? 'OUT' : 'LOW', link: `/inv/ledger?itemId=${r.item_id}` }));
    return { count: out.length, rows: out };
  }
  function pendingGrn(actor, c) {
    const w = docWhere(actor, 'g', c); const days = pn(actor.companyId, 'inv.mmd.inspection_days');
    const rows = db.prepare(`SELECT g.id, g.doc_no, g.org_project_id AS pid, g.store_id, g.vendor_id, g.received_date AS d, COUNT(*) AS lines, SUM(l.line_value) AS val FROM inv_grns g JOIN inv_grn_lines l ON l.grn_id = g.id AND l.deleted_at IS NULL AND l.inspection_status = 'PENDING' WHERE ${w.sql} AND g.status = 'APPROVED' GROUP BY g.id ORDER BY g.received_date, g.id`).all(w.params)
      .map((r) => { const age = Math.max(0, daysBetween(r.d, c.today)); return { id: r.id, docNo: r.doc_no, label: vname(r.vendor_id), project: projectCode(r.pid), store: storeCode(r.store_id), date: r.d, ageDays: age, late: age > days, qty: r.lines, uom: 'lines', value: r.val, status: age > days ? 'LATE' : 'PENDING', link: `/inv/grns?id=${r.id}` }; });
    return { count: rows.length, value: rows.reduce((n, r) => n + r.value, 0), late: rows.filter((r) => r.late).length, oldestDays: rows.length ? Math.max(...rows.map((r) => r.ageDays)) : 0, rows };
  }
  function openMrs(actor, c) {
    const w = docWhere(actor, 'm', c, { store: null }); /** @type {Record<string, any>} */ const P = /** @type {Record<string, any>} */ ({ ...w.params }); let extra = ''; if (c.st?.org_site_id) { extra = ' AND m.mr_site_id = :site'; P.site = c.st.org_site_id; }
    const rows = db.prepare(`SELECT m.id, m.doc_no, m.org_project_id AS pid, m.status, m.priority, m.required_by, m.doc_date,
      (SELECT COALESCE(SUM(l.qty - l.fulfilled_qty), 0) FROM proc_mr_lines l WHERE l.mr_id = m.id AND l.deleted_at IS NULL) AS open_qty,
      (SELECT COALESCE(SUM(CASE WHEN l.fulfilment_mode = 'NONE' THEN l.qty - l.fulfilled_qty ELSE 0 END), 0) FROM proc_mr_lines l WHERE l.mr_id = m.id AND l.deleted_at IS NULL) AS unplanned
      FROM proc_material_requests m WHERE ${w.sql}${extra} AND m.status IN ('SUBMITTED', 'APPROVED') ORDER BY m.required_by, m.id`).all(P)
      .filter((r) => r.status === 'SUBMITTED' || r.open_qty > 0)
      .map((r) => ({ id: r.id, docNo: r.doc_no, label: r.status === 'SUBMITTED' ? 'Waiting for approval' : r.unplanned > 0 ? 'Approved, not yet planned' : 'Approved, being fulfilled', project: projectCode(r.pid), date: r.required_by, ageDays: Math.max(0, daysBetween(r.doc_date, c.today)), late: r.required_by < c.today, status: r.status, note: `${r.priority} priority`, awaiting: r.status === 'SUBMITTED' || r.unplanned > 0, link: `/proc/material-requests?id=${r.id}` }));
    return { count: rows.length, awaiting: rows.filter((r) => r.awaiting).length, late: rows.filter((r) => r.late).length, rows };
  }
  function issuesToday(actor, c) {
    const w = docWhere(actor, 'i', c);
    const rows = db.prepare(`SELECT i.id, i.doc_no, i.org_project_id AS pid, i.store_id, i.issued_to_name, i.total_value, i.issue_date FROM inv_issues i WHERE ${w.sql} AND i.status = 'POSTED' AND i.issue_date = :today ORDER BY i.id DESC`).all({ ...w.params, today: c.today })
      .map((r) => ({ id: r.id, docNo: r.doc_no, label: r.issued_to_name, project: projectCode(r.pid), store: storeCode(r.store_id), date: r.issue_date, value: r.total_value, status: 'POSTED', link: `/inv/issues?id=${r.id}` }));
    return { count: rows.length, value: rows.reduce((n, r) => n + r.value, 0), rows };
  }
  function inTransit(actor, c) {
    const a = sc(actor, 't.from_project_id'); const b = sc(actor, 't.to_project_id'); const P = { c: actor.companyId }; let sql = `t.company_id = :c AND t.deleted_at IS NULL AND (${a.sql} OR ${b.sql})`;
    if (c.pj) { sql += ' AND (t.from_project_id = :pj OR t.to_project_id = :pj)'; P.pj = c.pj.id; } if (c.st) { sql += ' AND (t.from_store_id = :st OR t.to_store_id = :st)'; P.st = c.st.id; }
    const rows = db.prepare(`SELECT t.id, t.doc_no, t.from_store_id, t.to_store_id, t.total_value, t.dispatch_date, t.required_by FROM inv_transfers t WHERE ${sql} AND t.status = 'IN_TRANSIT' ORDER BY t.dispatch_date, t.id`).all(P)
      .map((r) => { const age = r.dispatch_date ? Math.max(0, daysBetween(r.dispatch_date, c.today)) : 0; return { id: r.id, docNo: r.doc_no, label: `${storeCode(r.from_store_id)} → ${storeCode(r.to_store_id)}`, store: storeCode(r.to_store_id), date: r.dispatch_date, ageDays: age, late: Boolean(r.required_by && r.required_by < c.today), value: r.total_value, status: 'IN_TRANSIT', link: `/inv/transfers?id=${r.id}` }; });
    return { count: rows.length, value: rows.reduce((n, r) => n + r.value, 0), late: rows.filter((r) => r.late).length, rows };
  }
  /** Stock held with no issue, transfer out or scrap for the number of days set. */
  function nonMoving(actor, c, total) {
    const w = storeWhere(actor, c); const days = pn(actor.companyId, 'inv.mmd.non_moving_days'); const limit = addDays(c.today, -days);
    const rows = db.prepare(`SELECT * FROM (SELECT x.store_id, x.item_id, x.qty, x.value, s.code AS scode, s.org_project_id AS pid, i.code AS icode, i.name AS iname, i.base_uom AS uom,
      COALESCE((SELECT MAX(l.txn_date) FROM inv_stock_ledger l WHERE l.store_id = x.store_id AND l.item_id = x.item_id AND l.txn_type IN ('ISSUE', 'TRANSFER_OUT', 'SCRAP')), (SELECT MIN(l.txn_date) FROM inv_stock_ledger l WHERE l.store_id = x.store_id AND l.item_id = x.item_id), :today) AS last_move
      FROM inv_valuation x JOIN inv_stores s ON s.id = x.store_id JOIN mdm_items i ON i.id = x.item_id WHERE ${w.sql} AND x.deleted_at IS NULL AND x.qty > 0 AND x.value > 0) WHERE last_move <= :limit ORDER BY value DESC`).all({ ...w.params, today: c.today, limit })
      .map((r) => ({ id: `${r.store_id}-${r.item_id}`, docNo: r.icode, label: `${r.icode} ${r.iname}`, project: projectCode(r.pid), store: r.scode, date: r.last_move, ageDays: daysBetween(r.last_move, c.today), qty: d3(r.qty), uom: r.uom, value: r.value, status: 'NON_MOVING', link: `/inv/ledger?itemId=${r.item_id}` }));
    const value = rows.reduce((n, r) => n + r.value, 0); const share = pct1(value, total); const target = pn(actor.companyId, 'inv.mmd.target_non_moving_pct'); const v = canValues(actor);
    return { count: rows.length, value: v ? value : null, pct: v ? share : null, days, target, status: share == null ? 'neutral' : share > target ? 'bad' : 'ok', rows: v ? rows : rows.map((r) => ({ ...r, value: null })) };
  }
  function returnsPending(actor, c) {
    const w = docWhere(actor, 'r', c); const w2 = docWhere(actor, 'v', c);
    const sr = db.prepare(`SELECT r.id, r.doc_no, r.org_project_id AS pid, r.store_id, r.from_name, r.return_date AS d, r.total_value AS val FROM inv_site_returns r WHERE ${w.sql} AND r.status IN ('SUBMITTED', 'APPROVED') AND r.posted_at IS NULL ORDER BY r.return_date, r.id`).all(w.params)
      .map((r) => ({ id: `SR${r.id}`, docNo: r.doc_no, label: `Site return from ${r.from_name}`, project: projectCode(r.pid), store: storeCode(r.store_id), date: r.d, ageDays: Math.max(0, daysBetween(r.d, c.today)), value: r.val, status: 'SITE_RETURN', link: `/inv/site-returns?id=${r.id}` }));
    const rv = db.prepare(`SELECT v.id, v.doc_no, v.org_project_id AS pid, v.store_id, v.vendor_id, v.rtv_date AS d, v.total_value AS val FROM inv_rtvs v WHERE ${w2.sql} AND v.status IN ('SUBMITTED', 'APPROVED') AND v.posted_at IS NULL ORDER BY v.rtv_date, v.id`).all(w2.params)
      .map((r) => ({ id: `RT${r.id}`, docNo: r.doc_no, label: `Return to ${vname(r.vendor_id)}`, project: projectCode(r.pid), store: storeCode(r.store_id), date: r.d, ageDays: Math.max(0, daysBetween(r.d, c.today)), value: r.val, status: 'RTV', link: `/inv/rtvs?id=${r.id}` }));
    const rows = [...sr, ...rv].sort((a, b) => b.ageDays - a.ageDays); return { count: rows.length, value: rows.reduce((n, r) => n + r.value, 0), rows };
  }
  function countsDue(actor, c) {
    const w = docWhere(actor, 'p', c);
    const rows = db.prepare(`SELECT p.id, p.doc_no, p.org_project_id AS pid, p.store_id, p.plan_type, p.scheduled_date AS d, p.status FROM inv_count_plans p WHERE ${w.sql} AND p.status IN ('APPROVED', 'COUNTING') AND p.scheduled_date <= :today ORDER BY p.scheduled_date, p.id`).all({ ...w.params, today: c.today })
      .map((r) => ({ id: r.id, docNo: r.doc_no, label: `${r.plan_type === 'FULL' ? 'Full count' : 'Cycle count'}${r.status === 'COUNTING' ? ' in progress' : ' to start'}`, project: projectCode(r.pid), store: storeCode(r.store_id), date: r.d, ageDays: Math.max(0, daysBetween(r.d, c.today)), late: r.d < c.today, status: r.status, link: `/inv/count-plans?id=${r.id}` }));
    return { count: rows.length, late: rows.filter((r) => r.late).length, rows };
  }
  /** Wastage against the allowed, from the monthly reconciliations (16.10): its trend service is called, not copied. */
  function wastage(actor, c) {
    const m = mrc(); const none = { available: false, count: 0, pct: null, allowedPct: null, status: 'neutral', rows: [] };
    if (!m || !flags.isOn(actor, 'ff.inv.p1610') || !holds(actor, 'inv.reconciliation.view')) return none;
    let t; try { t = m.recons.trend(actor, {}); } catch (e) { if (e.status === 403) return none; throw e; } const pts = t.points.filter((p) => (!c.pj || p.projectId === c.pj.id) && (!c.st?.org_site_id || p.siteId === c.st.org_site_id));
    const period = pts.length ? pts.map((p) => p.period).sort().at(-1) : null; const cur = pts.filter((p) => p.period === period); const wt = cur.reduce((n, p) => n + (p.theoretical || 0), 0);
    const avg = (k) => (wt > 0 ? Math.round((cur.reduce((n, p) => n + p[k] * (p.theoretical || 0), 0) / wt) * 10) / 10 : null); const pct = avg('wastagePct'); const allowed = avg('allowedPct');
    const over = cur.filter((p) => p.wastagePct > p.allowedPct).sort((a, b) => b.wastagePct - b.allowedPct - (a.wastagePct - a.allowedPct));
    return { available: true, period, count: over.length, lines: cur.length, pct, allowedPct: allowed, status: pct == null ? 'neutral' : pct > allowed ? 'bad' : 'ok',
      rows: over.slice(0, LIMIT).map((p) => ({ id: `${p.reconId}-${p.itemId}`, docNo: p.period, label: p.item, store: p.site, qty: p.variance, value: p.valueOfVariance ?? null, note: `Wastage ${p.wastagePct}% against ${p.allowedPct}% allowed`, status: p.status, link: `/inv/reconciliations?id=${p.reconId}` })) };
  }
  function reconciliation(actor, c) {
    const m = mrc(); const period = prevMonth(c.today);
    if (!m || !flags.isOn(actor, 'ff.inv.p1610') || !holds(actor, 'inv.reconciliation.view')) return { available: false, period, sites: 0, approved: 0, missing: 0, inProgress: 0, closeReady: false, status: 'neutral', route: '/inv/reconciliations' };
    let s; try { s = m.recons.status(actor, period); } catch (e) { if (e.status === 403) return { available: false, period, sites: 0, approved: 0, missing: 0, inProgress: 0, closeReady: false, status: 'neutral', route: '/inv/reconciliations' }; throw e; } const rows = s.rows.filter((r) => (!c.pj || r.projectId === c.pj.id) && (!c.st?.org_site_id || r.siteId === c.st.org_site_id)); const t = { sites: rows.length, approved: rows.filter((r) => r.status === 'APPROVED').length, missing: rows.filter((r) => r.status === 'MISSING').length };
    return { available: true, period, ...t, inProgress: t.sites - t.approved - t.missing, closeReady: t.sites > 0 && t.approved === t.sites, status: t.sites === 0 ? 'neutral' : t.missing > 0 ? 'bad' : t.approved === t.sites ? 'ok' : 'warn', route: '/inv/reconciliations' };
  }
  const procurement = (actor, c) => {
    const p = proc(); if (!p || !flags.isOn(actor, 'ff.proc.p1510') || !holds(actor, 'proc.analytics.view')) return null;
    let k; try { k = p.anaSvc.dashboard(actor, { projectId: c.pj?.id }).kpis; } catch (e) { if (e.status === 403) return null; throw e; } return { openPrs: k.openPrs.count, ordersAwaitingApproval: k.posPending.count, overdueDeliveries: k.overdueDeliveries.count, route: '/proc/dashboard' };
  };

  /** All the figures with their full record lists (the dashboard slices them; the drill-down returns them whole). */
  function figures(actor, q = {}) {
    const c = ctx(actor, q); const inv = inventory(actor, c); const nm = nonMoving(actor, c, inv.value);
    return { c, inv, trend: valueTrend(actor, c), turns: turns(actor, c), belowReorder: belowReorder(actor, c), pendingGrn: pendingGrn(actor, c), mrs: openMrs(actor, c), issuesToday: issuesToday(actor, c), inTransit: inTransit(actor, c), nonMoving: nm, returns: returnsPending(actor, c), counts: countsDue(actor, c), wastage: wastage(actor, c), recon: reconciliation(actor, c) };
  }
  const slice = (rows, n = 8) => rows.slice(0, n);

  function dashboard(actor, q = {}) {
    const f = figures(actor, q); const { c } = f; const v = canValues(actor); const t = f.trend; const prev = t.length >= 2 ? t.at(-2).value : null;
    const kpis = {
      inventoryValue: { value: f.inv.value, ledgerValue: f.inv.ledgerValue, difference: f.inv.difference, reconciled: f.inv.reconciled, asOfEntryId: f.inv.asOfEntryId, stores: f.inv.stores, items: f.inv.items, previousMonthEnd: v ? prev : null, changePct: v && prev ? Math.round(((f.inv.value - prev) / prev) * 1000) / 10 : null, status: f.inv.reconciled ? 'ok' : 'bad', route: '/inv/balances', drill: 'inventory' },
      stockTurns: { ...f.turns, route: '/inv/ledger', drill: 'inventory' },
      belowReorder: { count: f.belowReorder.count, out: f.belowReorder.rows.filter((r) => r.status === 'OUT').length, status: f.belowReorder.count ? 'bad' : 'ok', route: '/inv/reorder-suggestions', drill: 'belowReorder' },
      pendingGrnInspections: { count: f.pendingGrn.count, late: f.pendingGrn.late, value: v ? f.pendingGrn.value : null, oldestDays: f.pendingGrn.oldestDays, status: f.pendingGrn.late ? 'bad' : 'ok', route: '/inv/grns', drill: 'pendingGrn' },
      openMrs: { count: f.mrs.count, awaiting: f.mrs.awaiting, late: f.mrs.late, status: f.mrs.late ? 'bad' : 'ok', route: '/proc/material-requests', drill: 'openMrs' },
      issuesToday: { count: f.issuesToday.count, value: v ? f.issuesToday.value : null, route: '/inv/issues', drill: 'issuesToday' },
      transfersInTransit: { count: f.inTransit.count, late: f.inTransit.late, value: v ? f.inTransit.value : null, status: f.inTransit.late ? 'bad' : 'ok', route: '/inv/in-transit', drill: 'inTransit' },
      nonMoving: { count: f.nonMoving.count, value: f.nonMoving.value, pct: f.nonMoving.pct, days: f.nonMoving.days, target: f.nonMoving.target, status: f.nonMoving.status, route: '/inv/ageing', drill: 'nonMoving' },
      wastage: { available: f.wastage.available, period: f.wastage.period ?? null, pct: f.wastage.pct, allowedPct: f.wastage.allowedPct, overAllowed: f.wastage.count, lines: f.wastage.lines ?? 0, status: f.wastage.status, route: '/inv/wastage-trend', drill: 'wastage' },
      reconciliation: { ...f.recon },
    };
    const queues = {
      mrsAwaiting: { label: 'Material requests awaiting action', route: '/proc/material-requests', count: f.mrs.awaiting, drill: 'mrsAwaiting', records: slice(f.mrs.rows.filter((r) => r.awaiting)) },
      grnsPending: { label: 'Goods receipts pending inspection', route: '/inv/grns', count: f.pendingGrn.count, drill: 'pendingGrn', records: slice(f.pendingGrn.rows).map((r) => ({ ...r, value: v ? r.value : null })) },
      returnsPending: { label: 'Returns pending', route: '/inv/site-returns', count: f.returns.count, drill: 'returnsPending', records: slice(f.returns.rows).map((r) => ({ ...r, value: v ? r.value : null })) },
      countsDue: { label: 'Stock counts due', route: '/inv/count-plans', count: f.counts.count, drill: 'countsDue', records: slice(f.counts.rows) },
    };
    const alerts = [];
    if (!f.inv.reconciled) alerts.push({ code: 'BOOKS', level: 'bad', text: 'The stock value of the books differs from the stock ledger.', link: '/inv/ledger' });
    if (f.belowReorder.count) alerts.push({ code: 'REORDER', level: 'bad', text: `${f.belowReorder.count} item(s) are at or below their reorder level.`, link: '/inv/reorder-suggestions', drill: 'belowReorder' });
    if (f.pendingGrn.late) alerts.push({ code: 'INSPECTION', level: 'bad', text: `${f.pendingGrn.late} goods receipt(s) wait for inspection beyond ${pn(actor.companyId, 'inv.mmd.inspection_days')} day(s).`, link: '/inv/grns', drill: 'pendingGrn' });
    if (f.inTransit.late) alerts.push({ code: 'TRANSIT', level: 'bad', text: `${f.inTransit.late} transfer(s) in transit are past the date they were needed.`, link: '/inv/in-transit', drill: 'inTransit' });
    if (f.mrs.late) alerts.push({ code: 'MR_LATE', level: 'warn', text: `${f.mrs.late} open material request(s) are past their required date.`, link: '/proc/material-requests', drill: 'openMrs' });
    if (f.nonMoving.status === 'bad') alerts.push({ code: 'NON_MOVING', level: 'warn', text: `Non-moving stock is ${f.nonMoving.pct}% of the inventory value (target ${f.nonMoving.target}%).`, link: '/inv/ageing', drill: 'nonMoving' });
    if (f.turns.status === 'bad') alerts.push({ code: 'TURNS', level: 'warn', text: `Stock turns are ${f.turns.turns} a year (target ${f.turns.target}).`, link: '/inv/ledger' });
    if (f.wastage.status === 'bad') alerts.push({ code: 'WASTAGE', level: 'bad', text: `Wastage is ${f.wastage.pct}% against ${f.wastage.allowedPct}% allowed; ${f.wastage.count} material line(s) are over.`, link: '/inv/wastage-trend', drill: 'wastage' });
    if (f.recon.available && f.recon.missing) alerts.push({ code: 'RECON_MISSING', level: 'warn', text: `${f.recon.missing} site(s) have no material reconciliation for ${f.recon.period}.`, link: '/inv/reconciliations' });
    return { view: c.view, project: c.pj ? { id: c.pj.id, code: c.pj.code, name: c.pj.name } : null, store: c.st ? { id: c.st.id, code: c.st.code, name: c.st.name } : null, period: { from: c.from, to: c.to }, today: c.today, canValues: v, canExport: holds(actor, EXPORT),
      kpis, queues, alerts, charts: { valueByStore: f.inv.byStore.slice(0, 12), valueByProject: f.inv.byProject, valueTrend: f.trend }, procurement: procurement(actor, c),
      targets: { turns: f.turns.target, nonMovingPct: f.nonMoving.target, nonMovingDays: f.nonMoving.days, inspectionDays: pn(actor.companyId, 'inv.mmd.inspection_days') } };
  }

  // ---- drill-down (FR-04) ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const TITLES = { inventory: 'Inventory value by store', belowReorder: 'Items at or below their reorder level', pendingGrn: 'Goods receipts pending inspection', openMrs: 'Open material requests', issuesToday: 'Issues posted today', inTransit: 'Transfers in transit', nonMoving: 'Non-moving stock', wastage: 'Material lines over the allowed wastage', mrsAwaiting: 'Material requests awaiting action', returnsPending: 'Returns pending', countsDue: 'Stock counts due' };
  function drill(actor, q = {}) {
    if (!DRILL_KINDS.includes(q.kind)) fail([{ field: 'kind', message: 'Choose what to open' }]); const f = figures(actor, q); const v = canValues(actor);
    const map = { belowReorder: f.belowReorder.rows, pendingGrn: f.pendingGrn.rows, openMrs: f.mrs.rows, mrsAwaiting: f.mrs.rows.filter((r) => r.awaiting), issuesToday: f.issuesToday.rows, inTransit: f.inTransit.rows, nonMoving: f.nonMoving.rows, wastage: f.wastage.rows, returnsPending: f.returns.rows, countsDue: f.counts.rows,
      inventory: f.inv.byStore.map((s) => ({ id: s.id, docNo: s.code, label: s.name, project: s.project, store: s.code, qty: s.items, uom: 'items', value: s.value, note: s.ledgerValue != null && s.ledgerValue !== s.value ? `Ledger ${s.ledgerValue}` : '', link: s.link })) };
    const rows = (map[q.kind] ?? []).slice(0, LIMIT).map((r) => ({ ...r, value: v ? (r.value ?? null) : null }));
    return { kind: q.kind, title: TITLES[q.kind], view: f.c.view, project: f.c.pj ? { id: f.c.pj.id, code: f.c.pj.code } : null, store: f.c.st ? { id: f.c.st.id, code: f.c.st.code } : null, total: (map[q.kind] ?? []).length, rows, truncated: (map[q.kind] ?? []).length > LIMIT };
  }

  // ---- the lifecycle funnel (FR-02) ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const STAGE_LABEL = { required: 'Required (MRP)', pr: 'Requisitioned', po: 'Ordered', delivered: 'Delivered', accepted: 'Accepted', issued: 'Issued', consumed: 'Consumed' };
  /** Per item: the quantity at each stage of material request, requisition, order, receipt, inspection, issue and consumption. */
  function funnel(actor, q = {}) {
    const c = ctx(actor, q); const sums = {}; const add = (stage, key, rows) => { for (const r of rows) { sums[r.item_id] ??= {}; sums[r.item_id][stage] = (sums[r.item_id][stage] ?? 0) + r[key]; } };
    const f1 = docWhere(actor, 'r', c, { store: null }); const date = (col) => `AND substr(${col}, 1, 10) BETWEEN :from AND :to`; const R = { from: c.from, to: c.to };
    add('mrp', 'q', db.prepare(`SELECT l.item_id, SUM(l.gross_req) AS q FROM proc_mrp_lines l JOIN proc_mrp_runs r ON r.id = l.run_id WHERE ${f1.sql} AND l.deleted_at IS NULL AND r.status IN ('COMPLETED', 'CLOSED') AND r.id = (SELECT MAX(r2.id) FROM proc_mrp_runs r2 WHERE r2.org_project_id = r.org_project_id AND r2.status IN ('COMPLETED', 'CLOSED') AND r2.deleted_at IS NULL) GROUP BY l.item_id`).all(f1.params));
    const fm = docWhere(actor, 'm', c, { store: null }); add('mr', 'q', db.prepare(`SELECT l.item_id, SUM(l.qty) AS q FROM proc_mr_lines l JOIN proc_material_requests m ON m.id = l.mr_id WHERE ${fm.sql} AND l.deleted_at IS NULL AND m.status IN ('APPROVED', 'CLOSED') ${date('m.doc_date')} GROUP BY l.item_id`).all({ ...fm.params, ...R }));
    const fp = docWhere(actor, 'r', c, { store: null }); add('pr', 'q', db.prepare(`SELECT l.item_id, SUM(l.qty) AS q FROM proc_pr_lines l JOIN proc_requisitions r ON r.id = l.pr_id WHERE ${fp.sql} AND l.deleted_at IS NULL AND l.item_id IS NOT NULL AND r.status IN ('APPROVED', 'EMERGENCY', 'CLOSED') ${date('r.doc_date')} GROUP BY l.item_id`).all({ ...fp.params, ...R }));
    const fo = docWhere(actor, 'o', c, { store: null }); add('po', 'q', db.prepare(`SELECT l.item_id, SUM(l.qty) AS q FROM proc_po_lines l JOIN proc_purchase_orders o ON o.id = l.po_id WHERE ${fo.sql} AND l.deleted_at IS NULL AND l.item_id IS NOT NULL AND o.status IN ('APPROVED', 'CLOSED') ${date('o.approved_at')} GROUP BY l.item_id`).all({ ...fo.params, ...R }));
    const fg = docWhere(actor, 'g', c); const grn = db.prepare(`SELECT l.item_id, SUM(l.received_qty) AS delivered, SUM(l.accepted_qty - l.qc_rejected_qty) AS accepted FROM inv_grn_lines l JOIN inv_grns g ON g.id = l.grn_id WHERE ${fg.sql} AND l.deleted_at IS NULL AND g.status = 'APPROVED' ${date('g.received_date')} GROUP BY l.item_id`).all({ ...fg.params, ...R });
    add('delivered', 'delivered', grn); add('accepted', 'accepted', grn);
    const fi = docWhere(actor, 'i', c); const iss = db.prepare(`SELECT l.item_id, SUM(l.qty) AS issued, SUM(l.qty - l.returned_qty) AS consumed FROM inv_issue_lines l JOIN inv_issues i ON i.id = l.issue_id WHERE ${fi.sql} AND l.deleted_at IS NULL AND i.status = 'POSTED' ${date('i.issue_date')} GROUP BY l.item_id`).all({ ...fi.params, ...R });
    add('issued', 'issued', iss); add('consumed', 'consumed', iss);
    const needle = (q.q ?? '').toLowerCase(); const rows = [];
    for (const [id, s] of Object.entries(sums)) {
      const it = db.prepare('SELECT i.id, i.code, i.name, i.base_uom, i.category_id, k.name AS category FROM mdm_items i LEFT JOIN mdm_item_categories k ON k.id = i.category_id WHERE i.id = ? AND i.company_id = ?').get(Number(id), actor.companyId); if (!it) continue;
      if (q.itemId && it.id !== Number(q.itemId)) continue; if (q.categoryId && it.category_id !== Number(q.categoryId)) continue; if (needle && !`${it.code} ${it.name}`.toLowerCase().includes(needle)) continue;
      const requiredSource = (s.mrp ?? 0) > 0 ? 'MRP' : 'MR'; const qty = { required: requiredSource === 'MRP' ? s.mrp : (s.mr ?? 0), pr: s.pr ?? 0, po: s.po ?? 0, delivered: s.delivered ?? 0, accepted: s.accepted ?? 0, issued: s.issued ?? 0, consumed: s.consumed ?? 0 };
      if (FUNNEL_STAGES.every((k) => qty[k] === 0)) continue;
      const stages = FUNNEL_STAGES.map((k, n) => ({ key: k, label: STAGE_LABEL[k], qty: d3(qty[k]), pctOfPrevious: n === 0 ? null : pct1(qty[k], qty[FUNNEL_STAGES[n - 1]]), pctOfRequired: pct1(qty[k], qty.required) }));
      const gap = stages.slice(1).filter((x) => x.pctOfPrevious != null && x.pctOfPrevious < 100).sort((a, b) => a.pctOfPrevious - b.pctOfPrevious)[0] ?? null;
      rows.push({ itemId: it.id, code: it.code, name: it.name, uom: it.base_uom, category: it.category ?? '', requiredSource, stages, widestGap: gap ? { stage: gap.key, label: gap.label, pctOfPrevious: gap.pctOfPrevious } : null });
    }
    rows.sort((a, b) => a.code.localeCompare(b.code));
    const reached = FUNNEL_STAGES.map((k, n) => ({ key: k, label: STAGE_LABEL[k], items: rows.filter((r) => r.stages[n].qty > 0).length }));
    return { view: c.view, project: c.pj ? { id: c.pj.id, code: c.pj.code } : null, store: null, period: { from: c.from, to: c.to }, stages: FUNNEL_STAGES.map((k) => ({ key: k, label: STAGE_LABEL[k] })), rows: rows.slice(0, 500), total: rows.length, itemsReaching: reached };
  }
  /** The documents behind one stage of one item. */
  function stageRecords(actor, q = {}) {
    if (!FUNNEL_STAGES.includes(q.stage)) fail([{ field: 'stage', message: 'Choose a stage' }]); if (!q.itemId) fail([{ field: 'itemId', message: 'Choose an item' }]);
    const c = ctx(actor, q); const it = db.prepare('SELECT id FROM mdm_items WHERE id = ? AND company_id = ?').get(rid(q.itemId), actor.companyId); if (!it) throw notFound('That item does not exist.'); const R = { from: c.from, to: c.to, it: it.id }; let rows;
    const bd = (col) => `AND substr(${col}, 1, 10) BETWEEN :from AND :to`;
    if (q.stage === 'required') {
      const w = docWhere(actor, 'm', c, { store: null }); rows = db.prepare(`SELECT m.id, m.doc_no, m.org_project_id AS pid, m.doc_date AS d, SUM(l.qty) AS qty FROM proc_mr_lines l JOIN proc_material_requests m ON m.id = l.mr_id WHERE ${w.sql} AND l.deleted_at IS NULL AND l.item_id = :it AND m.status IN ('APPROVED', 'CLOSED') ${bd('m.doc_date')} GROUP BY m.id ORDER BY m.doc_date DESC`).all({ ...w.params, ...R }).map((r) => row('/proc/material-requests', r.id, r.doc_no, 'Material request', { project: projectCode(r.pid), date: r.d, qty: d3(r.qty) }));
    } else if (q.stage === 'pr') {
      const w = docWhere(actor, 'r', c, { store: null }); rows = db.prepare(`SELECT r.id, r.doc_no, r.org_project_id AS pid, r.doc_date AS d, SUM(l.qty) AS qty FROM proc_pr_lines l JOIN proc_requisitions r ON r.id = l.pr_id WHERE ${w.sql} AND l.deleted_at IS NULL AND l.item_id = :it AND r.status IN ('APPROVED', 'EMERGENCY', 'CLOSED') ${bd('r.doc_date')} GROUP BY r.id ORDER BY r.doc_date DESC`).all({ ...w.params, ...R }).map((r) => row('/proc/requisitions', r.id, r.doc_no, 'Purchase requisition', { project: projectCode(r.pid), date: r.d, qty: d3(r.qty) }));
    } else if (q.stage === 'po') {
      const w = docWhere(actor, 'o', c, { store: null }); rows = db.prepare(`SELECT o.id, o.doc_no, o.org_project_id AS pid, o.vendor_id, substr(o.approved_at, 1, 10) AS d, SUM(l.qty) AS qty FROM proc_po_lines l JOIN proc_purchase_orders o ON o.id = l.po_id WHERE ${w.sql} AND l.deleted_at IS NULL AND l.item_id = :it AND o.status IN ('APPROVED', 'CLOSED') ${bd('o.approved_at')} GROUP BY o.id ORDER BY o.approved_at DESC`).all({ ...w.params, ...R }).map((r) => row('/proc/purchase-orders', r.id, r.doc_no, vname(r.vendor_id), { project: projectCode(r.pid), date: r.d, qty: d3(r.qty) }));
    } else if (q.stage === 'delivered' || q.stage === 'accepted') {
      const w = docWhere(actor, 'g', c); const col = q.stage === 'delivered' ? 'l.received_qty' : '(l.accepted_qty - l.qc_rejected_qty)'; rows = db.prepare(`SELECT g.id, g.doc_no, g.org_project_id AS pid, g.vendor_id, g.received_date AS d, SUM(${col}) AS qty FROM inv_grn_lines l JOIN inv_grns g ON g.id = l.grn_id WHERE ${w.sql} AND l.deleted_at IS NULL AND l.item_id = :it AND g.status = 'APPROVED' ${bd('g.received_date')} GROUP BY g.id ORDER BY g.received_date DESC`).all({ ...w.params, ...R }).map((r) => row('/inv/grns', r.id, r.doc_no, vname(r.vendor_id), { project: projectCode(r.pid), date: r.d, qty: d3(r.qty) }));
    } else {
      const w = docWhere(actor, 'i', c); const col = q.stage === 'issued' ? 'l.qty' : '(l.qty - l.returned_qty)'; rows = db.prepare(`SELECT i.id, i.doc_no, i.org_project_id AS pid, i.issued_to_name, i.issue_date AS d, SUM(${col}) AS qty FROM inv_issue_lines l JOIN inv_issues i ON i.id = l.issue_id WHERE ${w.sql} AND l.deleted_at IS NULL AND l.item_id = :it AND i.status = 'POSTED' ${bd('i.issue_date')} GROUP BY i.id ORDER BY i.issue_date DESC`).all({ ...w.params, ...R }).map((r) => row('/inv/issues', r.id, r.doc_no, r.issued_to_name, { project: projectCode(r.pid), date: r.d, qty: d3(r.qty) }));
    }
    const item = itemOf(it.id); return { stage: q.stage, label: STAGE_LABEL[q.stage], item: { id: it.id, ...item }, rows: rows.slice(0, LIMIT), total: rows.length };
  }

  // ---- export (FR-04) --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  /** CSV of the dashboard figures, a drill-down list or the funnel; filters, scope and value masks as on screen. */
  function exportCsv(actor, q = {}) {
    gate(actor, 'export the materials dashboard', EXPORT); const kind = q.kind ?? 'kpis'; const v = canValues(actor); const money = (p) => (v && p != null ? p / 100 : '');
    let headers; let rows; let name;
    if (kind === 'funnel') {
      const f = funnel(actor, q); headers = ['Item code', 'Item', 'Unit', 'Category', ...FUNNEL_STAGES.map((k) => STAGE_LABEL[k])]; rows = f.rows.map((r) => [r.code, r.name, r.uom, r.category, ...r.stages.map((s) => s.qty)]); name = 'material-lifecycle-funnel';
    } else if (kind === 'kpis') {
      const d = dashboard(actor, q); const k = d.kpis; headers = ['Figure', 'Value', 'Detail']; name = 'materials-dashboard';
      rows = [['Inventory value (Rs)', money(k.inventoryValue.value), `Ledger ${money(k.inventoryValue.ledgerValue)}; ${k.inventoryValue.reconciled ? 'reconciled' : 'DIFFERENT'}`], ['Stock turns a year', k.stockTurns.turns ?? '', `Target ${k.stockTurns.target}`], ['Items at or below reorder', k.belowReorder.count, `${k.belowReorder.out} out of stock`],
        ['Goods receipts pending inspection', k.pendingGrnInspections.count, `${k.pendingGrnInspections.late} late`], ['Open material requests', k.openMrs.count, `${k.openMrs.awaiting} awaiting action`], ['Issues today', k.issuesToday.count, `Rs ${money(k.issuesToday.value)}`], ['Transfers in transit', k.transfersInTransit.count, `${k.transfersInTransit.late} late`],
        ['Non-moving value (Rs)', money(k.nonMoving.value), `${k.nonMoving.pct ?? ''}% of stock, ${k.nonMoving.days} days`], ['Wastage %', k.wastage.pct ?? '', `Allowed ${k.wastage.allowedPct ?? ''}; ${k.wastage.overAllowed} over`], ['Reconciliation', k.reconciliation.available ? `${k.reconciliation.approved}/${k.reconciliation.sites} approved` : '', `Month ${k.reconciliation.period}`]];
    } else {
      const d = drill(actor, q); headers = ['Document', 'Description', 'Project', 'Store', 'Date', 'Age (days)', 'Quantity', 'Unit', 'Value (Rs)', 'Status', 'Note']; name = `materials-${q.kind}`;
      rows = d.rows.map((r) => [r.docNo ?? '', r.label ?? '', r.project ?? '', r.store ?? '', r.date ?? '', r.ageDays ?? '', r.qty ?? '', r.uom ?? '', money(r.value), r.status ?? '', r.note ?? '']);
    }
    audit(actor, 'inv_dashboard', 0, 'export', actor.companyId, { reason: `${kind} ${rows.length} row(s)` });
    return { contentType: 'text/csv; charset=utf-8', fileName: `${name}-${todayIST()}.csv`, buffer: Buffer.from(`${BOM}${toCsv(headers, rows)}`, 'utf8') };
  }

  // ---- the small slot of Project 360 and the pick lists ----------------------------------------------------------------------------------------------------------------------------------------------------------------
  function projectWidget(actor, projectId) {
    const f = figures(actor, { projectId }); const v = canValues(actor);
    return { figures: [{ key: 'value', label: 'Inventory value', value: v ? Math.round(f.inv.value / 100) : null, drill: '/inv/dashboard' }, { key: 'reorder', label: 'Items below reorder', value: f.belowReorder.count, drill: '/inv/dashboard' }, { key: 'inspection', label: 'Receipts pending inspection', value: f.pendingGrn.count, drill: '/inv/grns' }, { key: 'mrs', label: 'Open material requests', value: f.mrs.count, drill: '/proc/material-requests' }, { key: 'transit', label: 'Transfers in transit', value: f.inTransit.count, drill: '/inv/in-transit' }],
      rows: f.pendingGrn.rows.slice(0, 3).map((r) => ({ label: `${r.docNo} waiting for inspection`, value: r.ageDays, drill: r.link })) };
  }
  const projects = (actor) => { gate(actor); return db.prepare("SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code").all(actor.companyId).filter((p) => may(actor, KEY, p.id)); };
  const stores = (actor, projectId) => { gate(actor); return db.prepare("SELECT id, code, name, org_project_id FROM inv_stores WHERE company_id = ? AND deleted_at IS NULL AND store_status = 'ACTIVE' ORDER BY code").all(actor.companyId).filter((s) => (!projectId || s.org_project_id === Number(projectId)) && (s.org_project_id ? may(actor, KEY, s.org_project_id) : may(actor, KEY))); };
  const categories = (actor) => { gate(actor); return db.prepare('SELECT id, name FROM mdm_item_categories WHERE company_id = ? AND deleted_at IS NULL ORDER BY name').all(actor.companyId); };
  return { dashboard, drill, funnel, stageRecords, exportCsv, projectWidget, projects, stores, categories, figures };
}
