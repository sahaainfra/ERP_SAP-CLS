import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { todayIST } from '../src/shared/dates.js';
import { AGE_BUCKETS, CYCLE_BUCKETS, bucketise, concentration, daysBetween, fyStart } from '../src/server/modules/proc/ana.js';

// Part 15.10: procurement dashboard and analytics.
// T-01 the dashboard KPIs equal a recomputation from the test data (the figures below are worked out by hand from what is inserted).
const P = '/api/v1/proc';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `ana-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const mgr = as('PROCMGR', 'amgr1'); const com = as('COMMGR', 'acom1'); const dir = as('DIR', 'adir1'); const cfo = as('CFO', 'acfo1'); const ic = as('PROCIC', 'aic1'); const sk = as('SK', 'ask1'); const other = as('PROCMGR', 'amgrx', '2');
const TODAY = todayIST(); const plus = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function ready() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['amgr1', ['PROCMGR']], ['acom1', ['COMMGR']], ['adir1', ['DIR']], ['acfo1', ['CFO']], ['aic1', ['PROCIC']], ['ask1', ['SK']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const proj = (code) => Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, ?, ?, 'BUILDING', 'ACTIVE')").run(code, `Tower ${code}`).lastInsertRowid);
  const A = proj('AN1'); const B = proj('AN2'); const siteA = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'AN-S1', 'Site', 'ACTIVE')").run(A).lastInsertRowid); const siteB = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'AN-S2', 'Site', 'ACTIVE')").run(B).lastInsertRowid);
  const cat = (code, name) => Number(d.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, ?, ?, ?, '[]', '[]', 'PROCMGR', 'ACTIVE')").run(code, name, code.slice(0, 3)).lastInsertRowid);
  const cement = cat('CEMENT', 'Cement'); const steel = cat('STEEL', 'Steel'); const item = (code, c) => Number(d.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status) VALUES (1, ?, ?, 'MATERIAL', ?, 'bag', '2026-01-01', 'ACTIVE')").run(code, code, c).lastInsertRowid);
  const iC = item('AN-CEM', cement); const iS = item('AN-STL', steel);
  const vendor = (code) => Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, ?, ?, ?, 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'test')").run(code, `Vendor ${code}`, `Vendor ${code}`).lastInsertRowid);
  const v1 = vendor('AV-1'); const v2 = vendor('AV-2');
  const pr = (project, site, status, docDate, approvedAt, emergency, qty, balance, est, itemId = iC) => { const id = Number(d.prepare("INSERT INTO proc_requisitions (company_id, doc_no, doc_date, org_project_id, pr_site_id, pr_source, requested_by, required_by, status, total_amount, is_emergency, approved_at, created_by) VALUES (1, ?, ?, ?, ?, 'DIRECT', 'aic1', ?, ?, ?, ?, ?, 'test')").run(`PR/A/${(seq += 1)}`, docDate, project, site, plus(30), status, qty * est / 1000, emergency ? 1 : 0, approvedAt).lastInsertRowid);
    const line = Number(d.prepare("INSERT INTO proc_pr_lines (company_id, pr_id, line_no, item_id, qty, uom, est_rate, est_amount, valued_from, required_by, delivery_site_id, balance_qty, created_by) VALUES (1, ?, 1, ?, ?, 'bag', ?, ?, 'MANUAL', ?, ?, ?, 'test')").run(id, itemId, qty, est, qty * est / 1000, plus(30), site, balance).lastInsertRowid); return { id, line }; };
  const rfq = (project, site, status = 'ISSUED') => { const prr = pr(project, site, 'CLOSED', plus(-30), plus(-29), 0, 1000, 0, 100); const id = Number(d.prepare("INSERT INTO proc_rfqs (company_id, doc_no, doc_date, org_project_id, title, due_date, requested_by, status, issued_at, est_total, created_by) VALUES (1, ?, ?, ?, 'T', ?, 'aic1', ?, ?, 100, 'test')").run(`RFQ/A/${(seq += 1)}`, plus(-28), project, plus(5), status, `${plus(-27)}T05:00:00.000Z`).lastInsertRowid); const line = Number(d.prepare("INSERT INTO proc_rfq_lines (company_id, rfq_id, line_no, pr_line_id, item_id, qty, uom, created_by) VALUES (1, ?, 1, ?, ?, 1000, 'bag', 'test')").run(id, prr.line, iC).lastInsertRowid); return { id, line }; };
  const cs = (project, status, approvedDaysAgo, r) => Number(d.prepare("INSERT INTO proc_comparative_statements (company_id, doc_no, doc_date, rfq_id, org_project_id, status, non_l1, requested_by, approved_at, total_value, created_by) VALUES (1, ?, ?, ?, ?, ?, 0, 'aic1', ?, 0, 'test')").run(`CS/A/${(seq += 1)}`, plus(-approvedDaysAgo), r.id, project, status, status === 'APPROVED' ? `${plus(-approvedDaysAgo)}T05:00:00.000Z` : null).lastInsertRowid);
  const csLine = (csId, r, vendorId, landed, selected, budget) => { const q = Number(d.prepare("INSERT INTO proc_quotations (company_id, doc_no, rfq_id, vendor_id, org_project_id, quote_date, valid_until, status, created_by) VALUES (1, ?, ?, ?, (SELECT org_project_id FROM proc_rfqs WHERE id = ?), ?, ?, 'RECEIVED', 'test')").run(`Q/A/${(seq += 1)}`, r.id, vendorId, r.id, plus(-20), plus(30)).lastInsertRowid); const ql = Number(d.prepare("INSERT INTO proc_quotation_lines (company_id, quotation_id, rfq_line_id, offered_qty, rate, landed_rate, created_by) VALUES (1, ?, ?, 1000000, ?, ?, 'test')").run(q, r.line, landed, landed).lastInsertRowid);
    d.prepare('INSERT INTO proc_cs_lines (company_id, cs_id, rfq_line_id, vendor_id, quotation_id, quotation_line_id, offered_qty, landed_rate, selected_qty, budget_rate, created_by) VALUES (1, ?, ?, ?, ?, ?, 1000000, ?, ?, ?, ?)').run(csId, r.line, vendorId, q, ql, landed, selected, budget ?? null, 'test'); };
  const po = (project, vendorId, status, approvedDaysAgo, total, over = {}) => { const id = Number(d.prepare("INSERT INTO proc_purchase_orders (company_id, doc_no, doc_date, org_project_id, vendor_id, po_source, cs_id, status, requested_by, total_amount, approved_at, sent_at, created_by) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'aic1', ?, ?, ?, 'test')").run(`PO/A/${(seq += 1)}`, plus(-approvedDaysAgo), project, vendorId, over.source ?? 'CS', over.csId ?? null, status, total, approvedDaysAgo == null ? null : `${plus(-approvedDaysAgo)}T05:00:00.000Z`, over.sent ? `${plus(-1)}T05:00:00.000Z` : null).lastInsertRowid);
    const line = Number(d.prepare("INSERT INTO proc_po_lines (company_id, po_id, line_no, pr_line_id, item_id, description, qty, uom, rate, line_amount, balance_qty, created_by) VALUES (1, ?, 1, ?, ?, 'x', 100000, 'bag', ?, ?, 100000, 'test')").run(id, over.prLine ?? null, over.itemId ?? iC, 40000, total).lastInsertRowid); return { id, line }; };
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  return { api, d, A, B, siteA, siteB, cement, steel, iC, iS, v1, v2, pr, rfq, cs, csLine, po, call };
}

test('the buckets, the financial year, the concentration index and the day count are worked out one way', () => {
  assert.deepEqual(bucketise([0, 3, 4, 20, 31, 90], CYCLE_BUCKETS).map((b) => b.count), [2, 1, 0, 1, 2]); assert.deepEqual(bucketise([1, 8, 40], AGE_BUCKETS).map((b) => b.count), [1, 1, 0, 1]);
  assert.equal(fyStart('2026-11-12'), '2026-04-01'); assert.equal(fyStart('2027-02-01'), '2026-04-01'); assert.equal(fyStart('2026-04-01'), '2026-04-01'); assert.equal(daysBetween('2026-01-01', '2026-01-11'), 10);
  assert.deepEqual(concentration([50, 30, 20]), { hhi: 3800, top5Pct: 100, vendors: 3 }); assert.deepEqual(concentration([]), { hhi: 0, top5Pct: 0, vendors: 0 }); assert.equal(concentration([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]).top5Pct, 50);
});

test('T-01 FR-01 FR-03 the KPIs and the work queues equal what the data gives', async () => {
  const r = await ready(); const d = r.d;
  const pr1 = r.pr(r.A, r.siteA, 'APPROVED', plus(-20), `${plus(-18)}T05:00:00.000Z`, 0, 100000, 100000, 40000); r.pr(r.A, r.siteA, 'SUBMITTED', plus(-3), null, 0, 50000, 50000, 20000); r.pr(r.B, r.siteB, 'APPROVED', plus(-40), `${plus(-39)}T05:00:00.000Z`, 1, 100000, 0, 40000);
  const rA = r.rfq(r.A, r.siteA, 'ISSUED'); d.prepare("INSERT INTO proc_rfq_vendors (company_id, rfq_id, vendor_id, response_status, created_by) VALUES (1, ?, ?, 'SENT', 'test')").run(rA.id, r.v1); const cs1 = r.cs(r.A, 'APPROVED', 10, rA); r.csLine(cs1, rA, r.v1, 38000, 100000, 40000); r.csLine(cs1, rA, r.v2, 42000, 0, 40000);
  const rB = r.rfq(r.B, r.siteB, 'CLOSED'); const cs2 = r.cs(r.B, 'APPROVED', 2, rB); r.csLine(cs2, rB, r.v1, 30000, 50000, null); const cs3 = r.cs(r.A, 'SUBMITTED', 1, rA); void cs3;
  const po1 = r.po(r.A, r.v1, 'APPROVED', 10, 4_000_000, { csId: cs1, prLine: pr1.line, sent: true }); r.po(r.A, r.v2, 'APPROVED', 5, 1_000_000, { source: 'DIRECT' }); r.po(r.B, r.v1, 'SUBMITTED', 1, 2_000_000); r.po(r.B, r.v2, 'CLOSED', 2, 3_000_000, { csId: cs2 });
  d.prepare("INSERT INTO proc_po_schedules (company_id, po_id, po_line_id, due_date, qty, received_qty, created_by) VALUES (1, ?, ?, ?, 100000, 40000, 'test')").run(po1.id, po1.line, plus(-4));
  const k = (await r.call(mgr, 'GET', '/analytics/dashboard')).json.data.kpis;
  // open requisitions: 100 bags at ₹ 400 (balance) and 50 bags at ₹ 200 (submitted); the emergency one is fully ordered
  assert.deepEqual([k.openPrs.count, k.openPrs.value, k.openPrs.oldestDays], [2, 5_000_000, 20]); assert.deepEqual(k.openPrs.ageing.map((b) => b.count), [1, 0, 1, 0]);
  assert.deepEqual([k.cycleTime.count, k.cycleTime.avgDays], [1, 8], 'requisition approved 18 days ago, order 10 days ago'); assert.equal(k.cycleTime.status, 'ok');
  assert.deepEqual([k.posPending.count, k.posPending.value], [1, 2_000_000]);
  assert.deepEqual([k.overdueDeliveries.count, k.overdueDeliveries.lines, k.overdueDeliveries.maxDays], [1, 1, 4]);
  const monthSpend = [[10, 4_000_000], [5, 1_000_000], [2, 3_000_000]].filter(([n]) => plus(-n).slice(0, 7) === TODAY.slice(0, 7)).reduce((s, [, v]) => s + v, 0); assert.equal(k.spendMonth.value, monthSpend); assert.equal(k.spendFy.value, 8_000_000);
  assert.deepEqual([k.savingsVsBudget.value, k.savingsVsBudget.pct, k.savingsVsBudget.status], [200_000, 5, 'ok'], '100 bags: budget ₹ 400, bought at ₹ 380'); assert.deepEqual([k.savingsVsL2.value, k.savingsVsL2.pct], [400_000, 9.5], 'the next quote was ₹ 420');
  assert.deepEqual([k.singleSource.count, k.singleSource.total, k.singleSource.pct, k.singleSource.status], [2, 3, 66.7, 'bad'], 'one direct order and one statement with a single quote'); assert.deepEqual([k.emergency.count, k.emergency.total, k.emergency.pct], [1, 4, 25], 'two approved and two closed requisitions (the closed ones belong to the RFQs)');
  assert.deepEqual([k.controlExceptions.visible, k.controlExceptions.open], [true, 0]);
  const q = (await r.call(mgr, 'GET', '/analytics/dashboard')).json.data.queues; assert.equal(q.prsAwaitingRfq.count, 1, 'the approved requisition with a balance and no RFQ'); assert.equal(q.rfqsAwaitingQuotes.count, 1); assert.equal(q.csAwaitingApproval.count, 1); assert.equal(q.posAwaitingRelease.count, 1, 'the direct order is not sent yet'); assert.equal(q.posAwaitingRelease.records[0].link.startsWith('/proc/purchase-orders?id='), true);
  // a project filter narrows every figure
  const kb = (await r.call(mgr, 'GET', `/analytics/dashboard?projectId=${r.B}`)).json.data; assert.deepEqual([kb.kpis.openPrs.count, kb.kpis.posPending.count, kb.kpis.spendFy.value, kb.kpis.emergency.count], [0, 1, 3_000_000, 1]); assert.equal(kb.project.code, 'AN2');
});

test('FR-02 FR-04 the spend report by category, vendor, project and month with the orders behind each row, the cycle time and the compliance reports', async () => {
  const r = await ready(); const rA = r.rfq(r.A, r.siteA); const cs1 = r.cs(r.A, 'APPROVED', 10, rA); r.csLine(cs1, rA, r.v1, 38000, 100000, 40000); r.csLine(cs1, rA, r.v2, 42000, 0, 40000);
  const pr1 = r.pr(r.A, r.siteA, 'APPROVED', plus(-20), `${plus(-18)}T05:00:00.000Z`, 0, 100000, 100000, 40000); r.po(r.A, r.v1, 'APPROVED', 10, 4_000_000, { csId: cs1, prLine: pr1.line, itemId: r.iC }); r.po(r.B, r.v2, 'APPROVED', 5, 1_000_000, { source: 'DIRECT', itemId: r.iS }); r.po(r.B, r.v2, 'APPROVED', 3, 500_000, { source: 'DIRECT', itemId: r.iS });
  const byCat = (await r.call(com, 'GET', '/analytics/spend?groupBy=category')).json.data; assert.deepEqual(byCat.rows.map((x) => [x.label, x.value]), [['Cement', 4_000_000], ['Steel', 1_500_000]]); assert.equal(byCat.total, 5_500_000); assert.equal(byCat.rows[0].sharePct, 72.7);
  const byVendor = (await r.call(com, 'GET', '/analytics/spend?groupBy=vendor')).json.data; assert.deepEqual(byVendor.rows.map((x) => [x.label, x.value, x.count]), [['Vendor AV-1', 4_000_000, 1], ['Vendor AV-2', 1_500_000, 2]]); assert.deepEqual([byVendor.concentration.hhi, byVendor.concentration.top5Pct], [Math.round(72.7273 ** 2 + 27.2727 ** 2), 100]);
  const byProject = (await r.call(com, 'GET', '/analytics/spend?groupBy=project')).json.data; assert.deepEqual(byProject.rows.map((x) => x.value), [4_000_000, 1_500_000]); assert.equal((await r.call(com, 'GET', '/analytics/spend?groupBy=month')).json.data.total, 5_500_000);
  const det = (await r.call(com, 'GET', `/analytics/spend/detail?groupBy=vendor&key=${r.v2}`)).json.data.rows; assert.equal(det.length, 2); assert.ok(det.every((x) => x.link.startsWith('/proc/purchase-orders?id='))); assert.equal((await r.call(com, 'GET', `/analytics/spend/detail?groupBy=category&key=${r.steel}`)).json.data.rows.length, 2);
  const cy = (await r.call(mgr, 'GET', '/analytics/cycle-time')).json.data; assert.deepEqual([cy.count, cy.avgDays, cy.medianDays, cy.maxDays], [1, 8, 8, 8]); assert.equal(cy.stages.at(-1).avgDays, 8); assert.equal(cy.rows[0].days, 8); assert.deepEqual(cy.distribution.map((b) => b.count), [0, 0, 1, 0, 0]);
  const co = (await r.call(mgr, 'GET', '/analytics/compliance')).json.data; assert.deepEqual([co.singleSource.count, co.singleSource.total, co.singleSource.rows[0].kind], [2, 3, 'DIRECT']); assert.equal(co.emergency.count, 0); assert.equal(co.exceptions.visible, true);
  assert.equal((await r.call(mgr, 'GET', '/analytics/spend?from=2026-12-01&to=2026-01-01')).status, 400, 'a period that ends before it starts');
});

test('AC-03 who sees what: the roles of the part read, procurement officers and the storekeeper do not; another company sees nothing; the flag switches it off', async () => {
  const r = await ready(); r.po(r.A, r.v1, 'APPROVED', 3, 1_000_000, { source: 'DIRECT' });
  for (const who of [mgr, com, dir, cfo]) assert.equal((await r.call(who, 'GET', '/analytics/dashboard')).status, 200, who.user);
  for (const who of [ic, sk]) assert.equal((await r.call(who, 'GET', '/analytics/dashboard')).status, 403, who.user);
  assert.equal((await r.call(other, 'GET', '/analytics/dashboard')).json.data.kpis.spendFy.value, 0, 'another company has its own figures'); assert.equal((await r.call(other, 'GET', `/analytics/dashboard?projectId=${r.A}`)).status, 404, 'a project of another company');
  assert.equal((await r.call(mgr, 'GET', '/analytics/dashboard?projectId=999999')).status, 404);
  r.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.proc.p1510'").run(); for (const path of ['/analytics/dashboard', '/analytics/spend', '/analytics/cycle-time', '/analytics/compliance']) assert.equal((await r.call(mgr, 'GET', path)).status, 404, path);
});

test('the Project 360 slot for procurement shows the figures of the project', async () => {
  const r = await ready(); r.pr(r.A, r.siteA, 'SUBMITTED', plus(-2), null, 0, 50000, 50000, 20000); r.po(r.A, r.v1, 'APPROVED', 3, 1_000_000, { source: 'DIRECT' });
  const { procOf } = await import('../src/server/modules/proc/index.js'); const w = procOf(r.d).anaSvc.projectWidget({ user: 'amgr1', companyId: 1, roles: ['PROCMGR'] }, r.A);
  assert.deepEqual(w.figures.map((f) => [f.key, f.value]), [['openPrs', 1], ['posPending', 0], ['overdue', 0], ['spendFy', 10_000]]); assert.equal(w.rows.length, 1); assert.match(w.rows[0].drill, /purchase-orders/);
});
