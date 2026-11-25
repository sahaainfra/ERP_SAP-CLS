import { badRequest, notFound } from '../../platform/http/errors.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { todayIST } from '../../../shared/dates.js';
import { rid } from './base.js';
import { median } from './rti.js';

// Procurement dashboard and analytics (part 15.10). Nothing is stored: every figure is worked out from the live procurement tables (requisitions, RFQs, comparative statements, purchase orders, receipts, control exceptions) inside the data scope of the person,
// so a KPI always equals a recomputation of the records behind it (T-01), and every KPI, chart row and queue names the records it counts so that it can be opened.
for (const [key, def, description, min, max] of [
  ['proc.ana.target_cycle_days', 10, 'FR-01: the target number of days from an approved purchase requisition to an approved purchase order; the KPI turns red above it.', 1, 365],
  ['proc.ana.target_single_source_pct', 5, 'FR-01: the share (percent) of purchase orders without competition above which the KPI turns red.', 0, 100],
  ['proc.ana.target_emergency_pct', 5, 'FR-01: the share (percent) of emergency purchase requisitions above which the KPI turns red.', 0, 100],
  ['proc.ana.target_savings_pct', 3, 'FR-01: the savings (percent) against the budget rate below which the KPI turns red.', 0, 100],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType: 'integer', default: def, scopes: ['system', 'company'], description, min, max });

const DAY = 86_400_000;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
/** The Indian financial year (April to March) that a date falls in: its first day. */
export const fyStart = (iso) => { const y = Number(iso.slice(0, 4)); return `${Number(iso.slice(5, 7)) >= 4 ? y : y - 1}-04-01`; };
export const CYCLE_BUCKETS = [['0-3', 0, 3], ['4-7', 4, 7], ['8-14', 8, 14], ['15-30', 15, 30], ['31+', 31, Infinity]];
export const AGE_BUCKETS = [['0-7', 0, 7], ['8-15', 8, 15], ['16-30', 16, 30], ['31+', 31, Infinity]];
/** Counts values into labelled day buckets. */
export const bucketise = (values, buckets) => buckets.map(([label, lo, hi]) => ({ label, count: values.filter((v) => v >= lo && v <= hi).length }));
/** The Herfindahl index of shares (0 to 10000) and the share of the biggest five. */
export function concentration(amounts) {
  const total = amounts.reduce((a, b) => a + b, 0); if (!total) return { hhi: 0, top5Pct: 0, vendors: amounts.length }; const sorted = [...amounts].sort((a, b) => b - a);
  return { hhi: Math.round(sorted.reduce((s, x) => s + ((x / total) * 100) ** 2, 0)), top5Pct: Math.round((sorted.slice(0, 5).reduce((a, b) => a + b, 0) / total) * 1000) / 10, vendors: amounts.length };
}
const pct1 = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

export function createAnaService({ db, base }) {
  const { authz, param, may, need, fail } = base;
  const pn = (companyId, key) => Number(param(companyId, key) ?? 0);
  const KEY = 'proc.analytics.view';
  /** The data scope of the person on a project column; `unrestricted` says whether they see every project. */
  const scope = (actor, col) => { need(actor, KEY, 'see procurement analytics'); const f = authz.scopeFilter(actor, KEY, { project: col }); return { sql: f.sql, params: f.params ?? {}, unrestricted: Boolean(f.unrestricted) }; };
  const projectOf = (actor, projectId) => { if (!projectId) return null; const p = db.prepare('SELECT id, code, name, company_id FROM org_projects WHERE id = ? AND deleted_at IS NULL').get(rid(projectId)); if (!p || p.company_id !== actor.companyId || !may(actor, KEY, p.id)) throw notFound('That project does not exist.'); return p; };
  const period = (q) => { const to = q?.to ?? todayIST(); const from = q?.from ?? fyStart(to); if (from > to) fail([{ field: 'from', message: 'The period starts after it ends' }]); return { from, to }; };
  const project = (id) => db.prepare('SELECT code FROM org_projects WHERE id = ?').get(id)?.code ?? '';
  const vname = (id) => { const v = db.prepare('SELECT trade_name, legal_name FROM mdm_partners WHERE id = ?').get(id); return v ? (v.trade_name ?? v.legal_name) : ''; };
  const rec = (route, id, docNo, label, extra = {}) => ({ id, docNo, label, link: `${route}?id=${id}`, ...extra });
  /** Builds the WHERE of a query over `alias` with the company, the data scope and an optional project. */
  const where = (actor, alias, pj) => { const s = scope(actor, `${alias}.org_project_id`); return { sql: `${alias}.company_id = :c AND ${alias}.deleted_at IS NULL AND ${s.sql}${pj ? ` AND ${alias}.org_project_id = :pj` : ''}`, params: { c: actor.companyId, ...s.params, ...(pj ? { pj: pj.id } : {}) }, unrestricted: s.unrestricted }; };

  // ---- the figures -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  function openPrs(actor, pj, today) {
    const w = where(actor, 'r', pj);
    const rows = db.prepare(`SELECT r.id, r.doc_no, r.doc_date, r.org_project_id, r.status, SUM(CASE WHEN r.status = 'SUBMITTED' THEN l.qty ELSE l.balance_qty END * COALESCE(l.est_rate, 0) / 1000) AS val FROM proc_requisitions r JOIN proc_pr_lines l ON l.pr_id = r.id AND l.deleted_at IS NULL WHERE ${w.sql} AND r.status IN ('SUBMITTED', 'APPROVED', 'EMERGENCY') GROUP BY r.id HAVING SUM(CASE WHEN r.status = 'SUBMITTED' THEN l.qty ELSE l.balance_qty END) > 0 ORDER BY r.doc_date, r.id`).all(w.params);
    const ages = rows.map((r) => daysBetween(r.doc_date, today));
    return { count: rows.length, value: Math.round(rows.reduce((s, r) => s + r.val, 0)), ageing: bucketise(ages, AGE_BUCKETS), oldestDays: ages.length ? Math.max(...ages) : 0, records: rows.slice(0, 10).map((r) => rec('/proc/requisitions', r.id, r.doc_no, project(r.org_project_id), { value: Math.round(r.val), ageDays: daysBetween(r.doc_date, today), status: r.status })) };
  }
  /** Per approved purchase order: the days from its requisition's approval to its own, with the stages in between. */
  function cycleRows(actor, pj, { from, to }) {
    const w = where(actor, 'o', pj);
    return db.prepare(`SELECT o.id, o.doc_no, o.org_project_id, o.vendor_id, o.total_amount, substr(o.approved_at, 1, 10) AS po_d,
      (SELECT MIN(substr(r.approved_at, 1, 10)) FROM proc_po_lines l JOIN proc_pr_lines pl ON pl.id = l.pr_line_id JOIN proc_requisitions r ON r.id = pl.pr_id WHERE l.po_id = o.id AND l.deleted_at IS NULL AND r.approved_at IS NOT NULL) AS pr_d,
      (SELECT substr(f.issued_at, 1, 10) FROM proc_comparative_statements s JOIN proc_rfqs f ON f.id = s.rfq_id WHERE s.id = o.cs_id) AS rfq_d, (SELECT substr(s.approved_at, 1, 10) FROM proc_comparative_statements s WHERE s.id = o.cs_id) AS cs_d
      FROM proc_purchase_orders o WHERE ${w.sql} AND o.status IN ('APPROVED', 'CLOSED') AND o.approved_at IS NOT NULL AND substr(o.approved_at, 1, 10) BETWEEN :from AND :to ORDER BY o.approved_at, o.id`).all({ ...w.params, from, to })
      .map((r) => ({ ...r, days: r.pr_d ? Math.max(0, daysBetween(r.pr_d, r.po_d)) : null, prToRfq: r.pr_d && r.rfq_d ? Math.max(0, daysBetween(r.pr_d, r.rfq_d)) : null, rfqToCs: r.rfq_d && r.cs_d ? Math.max(0, daysBetween(r.rfq_d, r.cs_d)) : null, csToPo: r.cs_d ? Math.max(0, daysBetween(r.cs_d, r.po_d)) : null }));
  }
  const avg = (v) => (v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null);
  function cycleStats(rows) { const d = rows.filter((r) => r.days != null).map((r) => r.days); return { count: d.length, avgDays: avg(d), medianDays: median(d), maxDays: d.length ? Math.max(...d) : null, distribution: bucketise(d, CYCLE_BUCKETS) }; }
  function spendTotals(actor, pj, from, to) { const w = where(actor, 'o', pj); const r = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(o.total_amount), 0) AS v FROM proc_purchase_orders o WHERE ${w.sql} AND o.status IN ('APPROVED', 'CLOSED') AND substr(o.approved_at, 1, 10) BETWEEN :from AND :to`).get({ ...w.params, from, to }); return { count: r.n, value: r.v }; }
  /** Savings of the awarded lines of approved comparative statements: against the budget rate and against the next quoted rate (L2). */
  function savings(actor, pj, { from, to }) {
    const w = where(actor, 's', pj);
    const rows = db.prepare(`SELECT cl.selected_qty AS q, cl.landed_rate AS lr, cl.budget_rate AS br, (SELECT MIN(c2.landed_rate) FROM proc_cs_lines c2 WHERE c2.cs_id = cl.cs_id AND c2.rfq_line_id = cl.rfq_line_id AND c2.deleted_at IS NULL AND c2.landed_rate > cl.landed_rate) AS l2 FROM proc_cs_lines cl JOIN proc_comparative_statements s ON s.id = cl.cs_id WHERE ${w.sql} AND s.status IN ('APPROVED', 'SUPERSEDED') AND substr(s.approved_at, 1, 10) BETWEEN :from AND :to AND cl.deleted_at IS NULL AND cl.selected_qty > 0`).all({ ...w.params, from, to });
    const amt = (qty, rate) => Math.round((qty * rate) / 1000); let sb = 0; let bb = 0; let s2 = 0; let b2 = 0;
    for (const r of rows) { if (r.br > 0) { sb += amt(r.q, r.br) - amt(r.q, r.lr); bb += amt(r.q, r.br); } if (r.l2 > 0) { s2 += amt(r.q, r.l2) - amt(r.q, r.lr); b2 += amt(r.q, r.l2); } }
    return { vsBudget: sb, vsBudgetPct: pct1(sb, bb), budgetBase: bb, vsL2: s2, vsL2Pct: pct1(s2, b2), l2Base: b2, lines: rows.length };
  }
  function singleSource(actor, pj, { from, to }) {
    const w = where(actor, 'o', pj);
    const rows = db.prepare(`SELECT o.id, o.doc_no, o.org_project_id, o.vendor_id, o.total_amount, o.po_source, o.direct_reason, (SELECT COUNT(DISTINCT c.vendor_id) FROM proc_cs_lines c WHERE c.cs_id = o.cs_id AND c.deleted_at IS NULL) AS quoted FROM proc_purchase_orders o WHERE ${w.sql} AND o.status IN ('APPROVED', 'CLOSED') AND substr(o.approved_at, 1, 10) BETWEEN :from AND :to ORDER BY o.approved_at DESC, o.id DESC`).all({ ...w.params, from, to });
    const single = rows.filter((r) => r.po_source === 'DIRECT' || (r.po_source === 'CS' && r.quoted <= 1));
    return { total: rows.length, count: single.length, pct: pct1(single.length, rows.length), value: single.reduce((s, r) => s + r.total_amount, 0), totalValue: rows.reduce((s, r) => s + r.total_amount, 0), rows: single };
  }
  function emergency(actor, pj, { from, to }) {
    const w = where(actor, 'r', pj);
    const rows = db.prepare(`SELECT r.id, r.doc_no, r.org_project_id, r.is_emergency, r.total_amount, r.emergency_reason, r.regularised_at, r.regularise_by FROM proc_requisitions r WHERE ${w.sql} AND r.status IN ('APPROVED', 'EMERGENCY', 'CLOSED') AND r.doc_date BETWEEN :from AND :to ORDER BY r.doc_date DESC, r.id DESC`).all({ ...w.params, from, to });
    const em = rows.filter((r) => r.is_emergency); return { total: rows.length, count: em.length, pct: pct1(em.length, rows.length), value: em.reduce((s, r) => s + r.total_amount, 0), rows: em };
  }
  function nonL1(actor, pj, { from, to }) {
    const w = where(actor, 's', pj);
    const rows = db.prepare(`SELECT s.id, s.doc_no, s.org_project_id, s.total_value, s.reason_code, s.justification, s.savings_vs_budget FROM proc_comparative_statements s WHERE ${w.sql} AND s.status IN ('APPROVED', 'SUPERSEDED') AND substr(s.approved_at, 1, 10) BETWEEN :from AND :to ORDER BY s.approved_at DESC`).all({ ...w.params, from, to });
    const flagged = db.prepare(`SELECT s.id, s.doc_no, s.org_project_id, s.total_value, s.reason_code, s.justification FROM proc_comparative_statements s WHERE ${w.sql} AND s.non_l1 = 1 AND s.status IN ('APPROVED', 'SUPERSEDED') AND substr(s.approved_at, 1, 10) BETWEEN :from AND :to ORDER BY s.approved_at DESC`).all({ ...w.params, from, to });
    return { total: rows.length, count: flagged.length, pct: pct1(flagged.length, rows.length), rows: flagged };
  }
  /** Open control exceptions of the procurement controls. A person who does not see every project sees none (an exception is not tied to one project). */
  function exceptions(actor, w) {
    if (!w.unrestricted) return { visible: false, open: null, rows: [], byControl: [] };
    const rows = db.prepare("SELECT id, exception_no, control_code, entity, entity_ref, status, value_at_risk, reason_code, raised_by FROM pcs_exceptions WHERE company_id = ? AND control_code LIKE 'CP-PROC-%' AND status IN ('DRAFT', 'PENDING', 'APPROVED') ORDER BY id DESC").all(actor.companyId);
    const by = new Map(); for (const r of rows) by.set(r.control_code, (by.get(r.control_code) ?? 0) + 1);
    return { visible: true, open: rows.length, rows: rows.slice(0, 50), byControl: [...by.entries()].sort().map(([code, count]) => ({ code, count })) };
  }
  function overdue(actor, pj, today) {
    const w = where(actor, 'o', pj);
    const rows = db.prepare(`SELECT o.id, o.doc_no, o.org_project_id, o.vendor_id, MIN(s.due_date) AS first_due, COUNT(*) AS lines, SUM(s.qty - s.received_qty) AS short FROM proc_po_schedules s JOIN proc_purchase_orders o ON o.id = s.po_id WHERE ${w.sql} AND o.status = 'APPROVED' AND s.due_date < :today AND s.received_qty < s.qty GROUP BY o.id ORDER BY first_due`).all({ ...w.params, today });
    return { count: rows.length, lines: rows.reduce((s, r) => s + r.lines, 0), maxDays: rows.length ? Math.max(...rows.map((r) => daysBetween(r.first_due, today))) : 0, records: rows.slice(0, 10).map((r) => rec('/proc/purchase-orders', r.id, r.doc_no, vname(r.vendor_id), { daysLate: daysBetween(r.first_due, today), lines: r.lines })) };
  }
  /** FR-03: the four queues: requisitions waiting for an RFQ, RFQs waiting for quotes, statements waiting for approval and orders waiting to be sent. */
  function queues(actor, pj, today) {
    const q = {};
    let w = where(actor, 'r', pj);
    const prs = db.prepare(`SELECT r.id, r.doc_no, r.doc_date, r.org_project_id, SUM(l.balance_qty * COALESCE(l.est_rate, 0) / 1000) AS val FROM proc_requisitions r JOIN proc_pr_lines l ON l.pr_id = r.id AND l.deleted_at IS NULL AND l.balance_qty > 0 WHERE ${w.sql} AND r.status IN ('APPROVED', 'EMERGENCY') AND NOT EXISTS (SELECT 1 FROM proc_rfq_lines rl JOIN proc_rfqs f ON f.id = rl.rfq_id WHERE rl.pr_line_id = l.id AND rl.deleted_at IS NULL AND f.status NOT IN ('CANCELLED', 'SUPERSEDED') AND f.deleted_at IS NULL) GROUP BY r.id ORDER BY r.doc_date, r.id`).all(w.params);
    q.prsAwaitingRfq = { label: 'Requisitions awaiting an RFQ', route: '/proc/requisitions', count: prs.length, value: Math.round(prs.reduce((s, r) => s + r.val, 0)), records: prs.slice(0, 8).map((r) => rec('/proc/requisitions', r.id, r.doc_no, project(r.org_project_id), { value: Math.round(r.val), ageDays: daysBetween(r.doc_date, today) })) };
    w = where(actor, 'f', pj);
    const rfqs = db.prepare(`SELECT f.id, f.doc_no, f.org_project_id, f.due_date, f.est_total, (SELECT COUNT(*) FROM proc_rfq_vendors v WHERE v.rfq_id = f.id AND v.deleted_at IS NULL AND v.response_status IN ('INVITED', 'SENT', 'VIEWED')) AS waiting FROM proc_rfqs f WHERE ${w.sql} AND f.status = 'ISSUED' AND EXISTS (SELECT 1 FROM proc_rfq_vendors v WHERE v.rfq_id = f.id AND v.deleted_at IS NULL AND v.response_status IN ('INVITED', 'SENT', 'VIEWED')) ORDER BY f.due_date, f.id`).all(w.params);
    q.rfqsAwaitingQuotes = { label: 'RFQs awaiting quotes', route: '/proc/rfqs', count: rfqs.length, value: rfqs.reduce((s, r) => s + r.est_total, 0), records: rfqs.slice(0, 8).map((r) => rec('/proc/rfqs', r.id, r.doc_no, project(r.org_project_id), { value: r.est_total, waiting: r.waiting, daysToDue: daysBetween(today, r.due_date) })) };
    w = where(actor, 's', pj);
    const css = db.prepare(`SELECT s.id, s.doc_no, s.org_project_id, s.total_value, s.doc_date FROM proc_comparative_statements s WHERE ${w.sql} AND s.status = 'SUBMITTED' ORDER BY s.doc_date, s.id`).all(w.params);
    q.csAwaitingApproval = { label: 'Comparative statements awaiting approval', route: '/proc/comparative-statements', count: css.length, value: css.reduce((s, r) => s + r.total_value, 0), records: css.slice(0, 8).map((r) => rec('/proc/comparative-statements', r.id, r.doc_no, project(r.org_project_id), { value: r.total_value, ageDays: daysBetween(r.doc_date, today) })) };
    w = where(actor, 'o', pj);
    const pos = db.prepare(`SELECT o.id, o.doc_no, o.org_project_id, o.vendor_id, o.total_amount, substr(o.approved_at, 1, 10) AS d FROM proc_purchase_orders o WHERE ${w.sql} AND o.status = 'APPROVED' AND o.sent_at IS NULL ORDER BY o.approved_at, o.id`).all(w.params);
    q.posAwaitingRelease = { label: 'Purchase orders awaiting release to the vendor', route: '/proc/purchase-orders', count: pos.length, value: pos.reduce((s, r) => s + r.total_amount, 0), records: pos.slice(0, 8).map((r) => rec('/proc/purchase-orders', r.id, r.doc_no, vname(r.vendor_id), { value: r.total_amount, ageDays: r.d ? daysBetween(r.d, today) : 0 })) };
    return q;
  }

  // ---- the dashboard (FR-01, FR-02, FR-03) -------------------------------------------------------------------------------------------------------------------------------------------------------------------
  function spendBy(actor, pj, { from, to }, groupBy) {
    const w = where(actor, 'o', pj); const P = { ...w.params, from, to }; const base_ = `${w.sql} AND o.status IN ('APPROVED', 'CLOSED') AND substr(o.approved_at, 1, 10) BETWEEN :from AND :to`;
    let rows;
    if (groupBy === 'category') rows = db.prepare(`SELECT COALESCE(c.id, 0) AS k, COALESCE(c.name, 'Services and other') AS label, SUM(l.line_amount) AS v, COUNT(DISTINCT o.id) AS n FROM proc_po_lines l JOIN proc_purchase_orders o ON o.id = l.po_id LEFT JOIN mdm_items i ON i.id = l.item_id LEFT JOIN mdm_item_categories c ON c.id = i.category_id WHERE ${base_} AND l.deleted_at IS NULL GROUP BY COALESCE(c.id, 0) ORDER BY v DESC`).all(P);
    else if (groupBy === 'vendor') rows = db.prepare(`SELECT o.vendor_id AS k, COALESCE(v.trade_name, v.legal_name) AS label, SUM(o.total_amount) AS v, COUNT(*) AS n FROM proc_purchase_orders o JOIN mdm_partners v ON v.id = o.vendor_id WHERE ${base_} GROUP BY o.vendor_id ORDER BY v DESC`).all(P);
    else if (groupBy === 'project') rows = db.prepare(`SELECT o.org_project_id AS k, p.code || ' ' || p.name AS label, SUM(o.total_amount) AS v, COUNT(*) AS n FROM proc_purchase_orders o JOIN org_projects p ON p.id = o.org_project_id WHERE ${base_} GROUP BY o.org_project_id ORDER BY v DESC`).all(P);
    else rows = db.prepare(`SELECT substr(o.approved_at, 1, 7) AS k, substr(o.approved_at, 1, 7) AS label, SUM(o.total_amount) AS v, COUNT(*) AS n FROM proc_purchase_orders o WHERE ${base_} GROUP BY substr(o.approved_at, 1, 7) ORDER BY k`).all(P);
    const total = rows.reduce((s, r) => s + r.v, 0); return { groupBy, rows: rows.map((r) => ({ key: r.k, label: r.label, value: r.v, count: r.n, sharePct: pct1(r.v, total) })), total };
  }
  function dashboard(actor, q = {}) {
    const pj = projectOf(actor, q.projectId); const today = todayIST(); const { from, to } = period({ from: q.from, to: q.to ?? today }); const cid = actor.companyId;
    const monthFrom = `${today.slice(0, 7)}-01`; const prevMonthTo = addDays(monthFrom, -1); const prevMonthFrom = `${prevMonthTo.slice(0, 7)}-01`; const fy = fyStart(today);
    const span = daysBetween(from, to) + 1; const prev = { from: addDays(from, -span), to: addDays(from, -1) };
    const cyc = cycleStats(cycleRows(actor, pj, { from, to })); const cycPrev = cycleStats(cycleRows(actor, pj, prev));
    const spendMonth = spendTotals(actor, pj, monthFrom, today); const spendPrev = spendTotals(actor, pj, prevMonthFrom, prevMonthTo); const spendFy = spendTotals(actor, pj, fy, today);
    const sav = savings(actor, pj, { from, to }); const ss = singleSource(actor, pj, { from, to }); const em = emergency(actor, pj, { from, to }); const w0 = where(actor, 'o', pj);
    const pend = db.prepare(`SELECT o.id, o.doc_no, o.org_project_id, o.vendor_id, o.total_amount FROM proc_purchase_orders o WHERE ${w0.sql} AND o.status = 'SUBMITTED' ORDER BY o.id`).all(w0.params);
    const od = overdue(actor, pj, today); const prs = openPrs(actor, pj, today); const ex = exceptions(actor, w0);
    const t = { cycle: pn(cid, 'proc.ana.target_cycle_days'), single: pn(cid, 'proc.ana.target_single_source_pct'), emergency: pn(cid, 'proc.ana.target_emergency_pct'), savings: pn(cid, 'proc.ana.target_savings_pct') };
    const change = (a, b) => (a != null && b ? Math.round(((a - b) / b) * 1000) / 10 : null);
    const kpis = {
      openPrs: { ...prs, route: '/proc/requisitions' },
      cycleTime: { avgDays: cyc.avgDays, medianDays: cyc.medianDays, count: cyc.count, previousAvgDays: cycPrev.avgDays, changePct: change(cyc.avgDays, cycPrev.avgDays), target: t.cycle, status: cyc.avgDays == null ? 'neutral' : cyc.avgDays > t.cycle ? 'bad' : 'ok', route: '/proc/cycle-time' },
      posPending: { count: pend.length, value: pend.reduce((s, r) => s + r.total_amount, 0), records: pend.slice(0, 10).map((r) => rec('/proc/purchase-orders', r.id, r.doc_no, vname(r.vendor_id), { value: r.total_amount })), route: '/proc/purchase-orders' },
      overdueDeliveries: { ...od, route: '/proc/po-tracker' },
      spendMonth: { ...spendMonth, previousValue: spendPrev.value, changePct: change(spendMonth.value, spendPrev.value), route: '/proc/spend-analysis' }, spendFy: { ...spendFy, from: fy, route: '/proc/spend-analysis' },
      savingsVsBudget: { value: sav.vsBudget, pct: sav.vsBudgetPct, base: sav.budgetBase, target: t.savings, status: sav.vsBudgetPct == null ? 'neutral' : sav.vsBudgetPct < t.savings ? 'bad' : 'ok', route: '/proc/comparative-statements' },
      savingsVsL2: { value: sav.vsL2, pct: sav.vsL2Pct, base: sav.l2Base, route: '/proc/comparative-statements' },
      singleSource: { count: ss.count, total: ss.total, pct: ss.pct, value: ss.value, target: t.single, status: ss.pct == null ? 'neutral' : ss.pct > t.single ? 'bad' : 'ok', route: '/proc/procurement-compliance', records: ss.rows.slice(0, 10).map((r) => rec('/proc/purchase-orders', r.id, r.doc_no, vname(r.vendor_id), { value: r.total_amount })) },
      emergency: { count: em.count, total: em.total, pct: em.pct, value: em.value, target: t.emergency, status: em.pct == null ? 'neutral' : em.pct > t.emergency ? 'bad' : 'ok', route: '/proc/procurement-compliance', records: em.rows.slice(0, 10).map((r) => rec('/proc/requisitions', r.id, r.doc_no, project(r.org_project_id), { value: r.total_amount })) },
      controlExceptions: { visible: ex.visible, open: ex.open, byControl: ex.byControl, route: '/proc/procurement-compliance' },
    };
    const vendors = spendBy(actor, pj, { from, to }, 'vendor');
    return {
      project: pj ? { id: pj.id, code: pj.code, name: pj.name } : null, period: { from, to }, fy: { from: fy, to: today }, kpis, queues: queues(actor, pj, today),
      charts: { byCategory: spendBy(actor, pj, { from, to }, 'category'), byVendor: { ...vendors, rows: vendors.rows.slice(0, 10) }, byProject: spendBy(actor, pj, { from, to }, 'project'), trend: spendBy(actor, pj, { from: addDays(`${today.slice(0, 7)}-01`, -335), to: today }, 'month'), cycleDistribution: cyc.distribution, concentration: concentration(vendors.rows.map((r) => r.value)) },
      targets: t,
    };
  }

  // ---- the reports (FR-04) --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const spendReport = (actor, q = {}) => { const pj = projectOf(actor, q.projectId); const p = period(q); const groupBy = q.groupBy ?? 'category'; return { project: pj ? { id: pj.id, code: pj.code } : null, period: p, ...spendBy(actor, pj, p, groupBy), concentration: groupBy === 'vendor' ? concentration(spendBy(actor, pj, p, 'vendor').rows.map((r) => r.value)) : null }; };
  /** The orders behind a row of the spend report. */
  function spendDetail(actor, q) {
    if (q.key == null || q.key === '') throw badRequest('Choose the row of the spend report: key is required.', [{ field: 'key', message: 'Required' }]); // part 30.05: was a server error
    const pj = projectOf(actor, q.projectId); const p = period(q); const w = where(actor, 'o', pj); const P = { ...w.params, ...p, k: q.key }; const b = `${w.sql} AND o.status IN ('APPROVED', 'CLOSED') AND substr(o.approved_at, 1, 10) BETWEEN :from AND :to`;
    const filter = q.groupBy === 'vendor' ? 'AND o.vendor_id = :k' : q.groupBy === 'project' ? 'AND o.org_project_id = :k' : q.groupBy === 'month' ? 'AND substr(o.approved_at, 1, 7) = :k' : Number(q.key) === 0 ? 'AND EXISTS (SELECT 1 FROM proc_po_lines l LEFT JOIN mdm_items i ON i.id = l.item_id WHERE l.po_id = o.id AND l.deleted_at IS NULL AND i.category_id IS NULL)' : 'AND EXISTS (SELECT 1 FROM proc_po_lines l JOIN mdm_items i ON i.id = l.item_id WHERE l.po_id = o.id AND l.deleted_at IS NULL AND i.category_id = :k)';
    const rows = db.prepare(`SELECT o.id, o.doc_no, o.org_project_id, o.vendor_id, o.total_amount, substr(o.approved_at, 1, 10) AS d FROM proc_purchase_orders o WHERE ${b} ${filter} ORDER BY o.approved_at DESC LIMIT 200`).all(P);
    return { rows: rows.map((r) => rec('/proc/purchase-orders', r.id, r.doc_no, `${project(r.org_project_id)} · ${vname(r.vendor_id)}`, { value: r.total_amount, date: r.d })) };
  }
  function cycleReport(actor, q = {}) {
    const pj = projectOf(actor, q.projectId); const p = period(q); const rows = cycleRows(actor, pj, p); const s = cycleStats(rows); const d = (k) => avg(rows.map((r) => r[k]).filter((x) => x != null));
    return { project: pj ? { id: pj.id, code: pj.code } : null, period: p, ...s, target: pn(actor.companyId, 'proc.ana.target_cycle_days'), stages: [{ key: 'prToRfq', label: 'Requisition approved to RFQ issued', avgDays: d('prToRfq') }, { key: 'rfqToCs', label: 'RFQ issued to statement approved', avgDays: d('rfqToCs') }, { key: 'csToPo', label: 'Statement approved to order approved', avgDays: d('csToPo') }, { key: 'total', label: 'Requisition approved to order approved', avgDays: s.avgDays }],
      rows: rows.filter((r) => r.days != null).sort((a, b) => b.days - a.days).slice(0, 100).map((r) => rec('/proc/purchase-orders', r.id, r.doc_no, `${project(r.org_project_id)} · ${vname(r.vendor_id)}`, { days: r.days, prToRfq: r.prToRfq, rfqToCs: r.rfqToCs, csToPo: r.csToPo, value: r.total_amount })) };
  }
  function complianceReport(actor, q = {}) {
    const pj = projectOf(actor, q.projectId); const p = period(q); const ss = singleSource(actor, pj, p); const em = emergency(actor, pj, p); const nl = nonL1(actor, pj, p); const ex = exceptions(actor, where(actor, 'o', pj));
    return { project: pj ? { id: pj.id, code: pj.code } : null, period: p,
      singleSource: { count: ss.count, total: ss.total, pct: ss.pct, value: ss.value, rows: ss.rows.slice(0, 100).map((r) => rec('/proc/purchase-orders', r.id, r.doc_no, `${project(r.org_project_id)} · ${vname(r.vendor_id)}`, { value: r.total_amount, kind: r.po_source === 'DIRECT' ? 'DIRECT' : 'ONE_QUOTE', reason: r.direct_reason })) },
      emergency: { count: em.count, total: em.total, pct: em.pct, value: em.value, rows: em.rows.slice(0, 100).map((r) => rec('/proc/requisitions', r.id, r.doc_no, project(r.org_project_id), { value: r.total_amount, reason: r.emergency_reason, regularised: Boolean(r.regularised_at) })) },
      nonL1: { count: nl.count, total: nl.total, pct: nl.pct, rows: nl.rows.slice(0, 100).map((r) => rec('/proc/comparative-statements', r.id, r.doc_no, project(r.org_project_id), { value: r.total_value, reason: r.reason_code })) },
      exceptions: { visible: ex.visible, open: ex.open, byControl: ex.byControl, rows: ex.rows.map((r) => ({ id: r.id, exceptionNo: r.exception_no, control: r.control_code, ref: r.entity_ref, status: r.status, valueAtRisk: r.value_at_risk, reason: r.reason_code, link: `/eng/exceptions?id=${r.id}` })) } };
  }
  /** The small figure set of the procurement slot of Project 360 (10.08). */
  function projectWidget(actor, projectId) {
    const d = dashboard(actor, { projectId }); const k = d.kpis;
    return { figures: [{ key: 'openPrs', label: 'Open requisitions', value: k.openPrs.count, drill: '/proc/requisitions' }, { key: 'posPending', label: 'Orders awaiting approval', value: k.posPending.count, drill: '/proc/purchase-orders' }, { key: 'overdue', label: 'Overdue deliveries', value: k.overdueDeliveries.count, drill: '/proc/po-tracker' }, { key: 'spendFy', label: 'Spend this financial year (₹)', value: Math.round(k.spendFy.value / 100), drill: '/proc/spend-analysis' }],
      rows: d.queues.posAwaitingRelease.records.slice(0, 3).map((r) => ({ label: `${r.docNo} awaiting release`, value: Math.round((r.value ?? 0) / 100), drill: r.link })) };
  }
  const projects = (actor) => { need(actor, KEY, 'see procurement analytics'); return db.prepare("SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code").all(actor.companyId).filter((p) => may(actor, KEY, p.id)); };
  return { dashboard, spendReport, spendDetail, cycleReport, complianceReport, projectWidget, projects, cycleStats, concentration };
}
