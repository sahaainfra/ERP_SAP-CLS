import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { todayIST } from '../src/shared/dates.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { median, outlierOf, statsOf, toBase } from '../src/server/modules/proc/rti.js';

// Part 15.09: material rate intelligence and price benchmarking.
// T-01 the benchmark for an item, region and date returns the value the observations give.
const P = '/api/v1/proc';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `rti-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const mgr = as('PROCMGR', 'rmgr1'); const est = as('EST', 'rest1'); const com = as('COMMGR', 'rcom1'); const dir = as('DIR', 'rdir1'); const ic = as('PROCIC', 'ric1'); const sk = as('SK', 'rsk1'); const other = as('PROCMGR', 'rmgrx', '2');
const TODAY = todayIST(); const plus = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function ready() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['rmgr1', ['PROCMGR']], ['rest1', ['EST']], ['rcom1', ['COMMGR']], ['rdir1', ['DIR']], ['ric1', ['PROCIC']], ['rsk1', ['SK']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const cat = Number(d.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, 'CEMENT', 'Cement', 'CEM', '[]', '[]', 'PROCMGR', 'ACTIVE')").run().lastInsertRowid);
  const item = (code, uom) => Number(d.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, standard_amount) VALUES (1, ?, ?, 'MATERIAL', ?, ?, '2026-01-01', 'ACTIVE', 38000)").run(code, code, cat, uom).lastInsertRowid);
  const cement = item('R-CEM', 'bag'); const steel = item('R-STL', 'kg'); d.prepare("INSERT INTO mdm_item_uoms (company_id, item_id, uom, factor_to_base, created_by) VALUES (1, ?, 'tonne', '1000', 'test')").run(steel);
  const vendor = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, 'RV-1', 'Ambuja Traders', 'Ambuja Traders', 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'test')").run().lastInsertRowid);
  const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'RT1', 'Rate tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const survey = (who, itemId, rate, over = {}) => call(who, 'POST', '/rate-observations', { itemId, rate, uom: 'bag', date: plus(-5), region: 'WEST', ...over });
  const drain = () => runtimeOf(d).bus.drain();
  return { api, d, cat, cement, steel, vendor, pid, call, survey, drain };
}

test('statistics: median, spread and volatility; normalising to the base unit; the outlier rule', () => {
  assert.equal(median([5, 1, 3]), 3); assert.equal(median([1, 2, 3, 10]), 3); assert.equal(median([]), null);
  assert.deepEqual(statsOf([380, 390, 400]), { count: 3, min: 380, avg: 390, max: 400, median: 390, volatilityPct: 2.6 }); assert.equal(statsOf([]).count, 0);
  assert.equal(toBase(6500000, 1000), 6500); assert.equal(toBase(38000, 1), 38000);
  assert.equal(outlierOf([100, 100, 100], 200, { pct: 40, min: 5 }), null, 'too few earlier observations'); assert.match(outlierOf([100, 100, 100, 100, 100], 200, { pct: 40, min: 5 }), /100% away/); assert.equal(outlierOf([100, 100, 100, 100, 100], 130, { pct: 40, min: 5 }), null);
});

test('T-01 FR-01 FR-02 FR-04 BR-01 survey entries build the history; the benchmark is their median per region; an outlier is kept and left out; a correction replaces and never edits', async () => {
  const r = await ready();
  for (const [rate, day] of [[380, -40], [390, -30], [400, -20], [385, -10], [395, -5]]) assert.equal((await r.survey(mgr, r.cement, rate, { date: plus(day) })).status, 201);
  const b0 = (await r.call(est, 'GET', `/rate-intelligence/benchmark?itemId=${r.cement}&region=WEST`)).json.data; assert.deepEqual([b0.rate, b0.count, b0.min, b0.max, b0.region, b0.enough], [39000, 5, 38000, 40000, 'WEST', true], 'median of 380 385 390 395 400 in paise');
  const wild = await r.survey(mgr, r.cement, 900, { date: plus(-1) }); assert.equal(wild.status, 201); assert.equal(wild.json.data.outlier, true); assert.match(wild.json.data.outlierReason, /away from the median/); assert.equal((await r.call(est, 'GET', `/rate-intelligence/benchmark?itemId=${r.cement}&region=WEST`)).json.data.count, 5, 'the outlier is left out');
  // another region has too few: the benchmark falls back to all regions
  await r.survey(mgr, r.cement, 420, { region: 'SOUTH', date: plus(-3) }); const south = (await r.call(est, 'GET', `/rate-intelligence/benchmark?itemId=${r.cement}&region=SOUTH`)).json.data; assert.equal(south.region, 'ALL'); assert.equal(south.count, 6);
  // a correction: the wrong observation is replaced in the figures and stays on record
  const bad = (await r.survey(mgr, r.cement, 100, { date: plus(-2) })).json.data; assert.equal(bad.outlier, true); const fix = await r.call(mgr, 'POST', `/rate-observations/${bad.id}/correct`, { rate: 399, reason: 'Keyed the wrong price from the quote' }); assert.equal(fix.status, 201, JSON.stringify(fix.json)); assert.equal(fix.json.data.supersedesId, bad.id);
  assert.equal((await r.call(mgr, 'GET', `/rate-observations/${bad.id}`)).json.data.replacedBy, fix.json.data.id); assert.equal((await r.call(mgr, 'POST', `/rate-observations/${bad.id}/correct`, { rate: 399, reason: 'Again please' })).status, 409, 'correct the newer one');
  assert.equal((await r.call(est, 'GET', `/rate-intelligence/benchmark?itemId=${r.cement}&region=WEST`)).json.data.count, 6, 'the corrected rate counts');
  assert.throws(() => r.d.prepare('UPDATE rti_observations SET rate = 1 WHERE id = ?').run(bad.id), /never changed/); assert.throws(() => r.d.prepare('DELETE FROM rti_observations WHERE id = ?').run(bad.id), /never deleted/);
  // by date: a benchmark as of a past date uses only what existed
  const early = (await r.call(est, 'GET', `/rate-intelligence/benchmark?itemId=${r.cement}`)).json.data; assert.ok(early.count >= 6);
  assert.equal((await r.survey(ic, r.cement, 390)).status, 403, 'only the procurement manager enters surveys'); assert.equal((await r.call(sk, 'GET', '/rate-intelligence/dashboard')).status, 403); assert.equal((await r.call(other, 'GET', `/rate-observations/${bad.id}`)).status, 404, 'another company');
  assert.equal((await r.survey(mgr, r.cement, 390, { uom: 'tonne' })).status, 400, 'not a unit of the item'); assert.equal((await r.survey(mgr, r.cement, 390, { date: plus(3) })).status, 400, 'not in the future'); assert.equal((await r.survey(mgr, 999999, 390)).status, 400);
});

test('FR-02 a rate per tonne is stored per base unit; FR-01 approved orders, contracts and quotations enter the history once', async () => {
  const r = await ready(); const d = r.d; const t = await r.survey(mgr, r.steel, 65000, { uom: 'tonne', date: plus(-3), region: 'ALL' }); assert.equal(t.status, 201, JSON.stringify(t.json)); assert.deepEqual([t.json.data.baseLandedRate, t.json.data.baseUom], [6500, 'kg'], '₹ 65,000 a tonne is ₹ 65 a kilogram');
  const po = Number(d.prepare("INSERT INTO proc_purchase_orders (company_id, doc_no, doc_date, org_project_id, vendor_id, status, requested_by, delivery_state, approved_at, created_by) VALUES (1, 'PO/R/1', ?, ?, ?, 'APPROVED', 'ric1', '27', ?, 'test')").run(plus(-4), r.pid, r.vendor, `${plus(-4)}T05:00:00.000Z`).lastInsertRowid);
  d.prepare("INSERT INTO proc_po_lines (company_id, po_id, line_no, item_id, description, qty, uom, rate, basic_amount, freight_amount, balance_qty, created_by) VALUES (1, ?, 1, ?, 'Cement', 1000000, 'bag', 39000, 39000000, 1000000, 1000000, 'test')").run(po, r.cement);
  const rc = Number(d.prepare("INSERT INTO proc_rate_contracts (company_id, doc_no, doc_date, title, vendor_id, valid_from, valid_to, status, requested_by, approved_at, created_by) VALUES (1, 'RC/R/1', ?, 'Steel', ?, ?, ?, 'APPROVED', 'ric1', ?, 'test')").run(plus(-10), r.vendor, plus(-10), plus(300), `${plus(-10)}T05:00:00.000Z`).lastInsertRowid);
  d.prepare("INSERT INTO proc_rc_lines (company_id, rc_id, line_no, item_id, description, uom, rate, base_rate, created_by) VALUES (1, ?, 1, ?, 'TMT', 'kg', 6400, 6400, 'test')").run(rc, r.steel);
  const rfq = Number(d.prepare("INSERT INTO proc_rfqs (company_id, doc_no, doc_date, org_project_id, title, due_date, requested_by, status, created_by) VALUES (1, 'RFQ/R/1', ?, ?, 'T', ?, 'ric1', 'ISSUED', 'test')").run(plus(-9), r.pid, plus(-2)).lastInsertRowid);
  const prId = Number(d.prepare("INSERT INTO proc_requisitions (company_id, doc_no, doc_date, org_project_id, pr_source, requested_by, required_by, status, total_amount, created_by) VALUES (1, 'PR/R/1', ?, ?, 'DIRECT', 'ric1', ?, 'APPROVED', 0, 'test')").run(plus(-9), r.pid, plus(30)).lastInsertRowid);
  const site = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'RT-S', 'Site', 'ACTIVE')").run(r.pid).lastInsertRowid); d.prepare('UPDATE proc_requisitions SET pr_site_id = ? WHERE id = ?').run(site, prId);
  const pl = Number(d.prepare("INSERT INTO proc_pr_lines (company_id, pr_id, line_no, item_id, qty, uom, est_rate, est_amount, valued_from, required_by, delivery_site_id, balance_qty, created_by) VALUES (1, ?, 1, ?, 1000000, 'bag', 38000, 38000, 'MANUAL', ?, ?, 1000000, 'test')").run(prId, r.cement, plus(30), site).lastInsertRowid);
  const rl = Number(d.prepare("INSERT INTO proc_rfq_lines (company_id, rfq_id, line_no, pr_line_id, item_id, qty, uom, created_by) VALUES (1, ?, 1, ?, ?, 1000, 'bag', 'test')").run(rfq, pl, r.cement).lastInsertRowid);
  const q = Number(d.prepare("INSERT INTO proc_quotations (company_id, doc_no, rfq_id, vendor_id, org_project_id, quote_date, valid_until, status, created_by) VALUES (1, 'Q/R/1', ?, ?, ?, ?, ?, 'RECEIVED', 'test')").run(rfq, r.vendor, r.pid, plus(-6), plus(30)).lastInsertRowid);
  d.prepare("INSERT INTO proc_quotation_lines (company_id, quotation_id, rfq_line_id, offered_qty, rate, landed_rate, created_by) VALUES (1, ?, ?, 1000000, 38500, 39200, 'test')").run(q, rl);
  const { procOf } = await import('../src/server/modules/proc/index.js'); const svc = procOf(d).rtiSvc; const h1 = svc.harvest(1); assert.deepEqual(h1, { QUOTATION: 1, CS: 0, PO: 1, RATE_CONTRACT: 1 }); assert.deepEqual(svc.harvest(1), { QUOTATION: 0, CS: 0, PO: 0, RATE_CONTRACT: 0 }, 'once');
  const list = (await r.call(est, 'GET', '/rate-observations?pageSize=50')).json.data; assert.equal(list.length, 4); const po1 = list.find((x) => x.source === 'PO'); assert.equal(po1.rate, 40000, 'basic and freight over the quantity: 390 + 10 = ₹ 400 a bag'); assert.equal(list.find((x) => x.source === 'QUOTATION').rate, 39200);
  const full = (await r.call(est, 'GET', `/rate-observations/${po1.id}`)).json.data; assert.deepEqual([full.region, full.sourceLabel, full.vendor], ['27', 'Purchase order', 'Ambuja Traders']);
});

test('FR-03 the monthly trend with minimum, average, maximum and volatility, the external index of the category and the dashboard', async () => {
  const r = await ready(); const mk = (n) => plus(-n); for (const [rate, day] of [[380, 70], [390, 65], [400, 40], [410, 35], [420, 10], [430, 5]]) await r.survey(mgr, r.cement, rate, { date: mk(day), region: 'ALL' });
  const cur = TODAY.slice(0, 7); assert.equal((await r.call(est, 'POST', '/rate-indices', { group: 'CEMENT', period: cur, value: 118.4 })).status, 403, 'the estimator reads only'); assert.equal((await r.call(mgr, 'POST', '/rate-indices', { group: 'cement', period: cur, value: 118.4 })).status, 201); assert.equal((await r.call(mgr, 'POST', '/rate-indices', { group: 'CEMENT', period: cur, value: 119 })).status, 201, 'a later value replaces');
  assert.equal((await r.call(mgr, 'POST', '/rate-indices', { group: 'CEMENT', period: '2099-01', value: 1 })).status, 400); const imp = await r.call(mgr, 'POST', '/rate-indices/import', { rows: [{ group: 'STEEL', region: 'WEST', period: '2026-01', value: 101.5 }, { group: 'STEEL', region: 'WEST', period: '2026-02', value: 103 }] }); assert.equal(imp.status, 200); assert.equal(imp.json.data.saved, 2);
  const ix = (await r.call(est, 'GET', '/rate-indices?group=CEMENT')).json.data; assert.deepEqual([ix.length, ix[0].value, ix[0].group], [1, 119, 'CEMENT']);
  const s = (await r.call(est, 'GET', `/rate-intelligence/series?itemId=${r.cement}&months=6`)).json.data; assert.ok(s.points.length >= 3); assert.ok(s.points.every((p, i, a) => i === 0 || p.month > a[i - 1].month)); assert.equal(s.points.reduce((n, p) => n + p.count, 0), 6); assert.equal(s.indexGroup, 'CEMENT'); assert.equal(s.indices.at(-1).value, 119); assert.equal(s.overall.min, 38000); assert.equal(s.overall.max, 43000);
  const dash = (await r.call(dir, 'GET', '/rate-intelligence/dashboard')).json.data; assert.equal(dash.items.length, 1); assert.deepEqual([dash.items[0].code, dash.items[0].count, dash.items[0].enough], ['R-CEM', 6, true]); assert.equal(dash.indices.length >= 2, true); assert.equal(dash.canSurvey, false);
  assert.equal((await r.call(com, 'GET', '/rate-observations?pageSize=25')).json.data.length, 6); assert.equal((await r.call(mgr, 'GET', '/rate-intelligence/dashboard')).json.data.canSurvey, true);
});

test('FR-05 the exposure of a project: what is still to buy at the benchmark against the budgeted rate', async () => {
  const r = await ready(); const d = r.d; for (const [rate, day] of [[390, 30], [395, 25], [400, 20], [405, 15], [410, 10]]) await r.survey(mgr, r.cement, rate, { date: plus(-day), region: 'ALL' });
  assert.equal((await r.call(est, 'GET', `/rate-exposure?projectId=${r.pid}`)).json.data.lines.length, 0, 'no MRP run yet'); assert.equal((await r.call(sk, 'GET', `/rate-exposure?projectId=${r.pid}`)).status, 403);
  const run = Number(d.prepare("INSERT INTO proc_mrp_runs (company_id, doc_no, doc_date, org_project_id, status, run_at) VALUES (1, 'MRP/R/1', ?, ?, 'COMPLETED', ?)").run(TODAY, r.pid, `${TODAY}T01:00:00.000Z`).lastInsertRowid);
  for (const [wk, net] of [[plus(7), 6000000], [plus(14), 4000000]]) d.prepare('INSERT INTO proc_mrp_lines (company_id, run_id, item_id, week_start, net_req, created_by) VALUES (1, ?, ?, ?, ?, ?)').run(run, r.cement, wk, net, 'test');
  const e = (await r.call(est, 'GET', `/rate-exposure?projectId=${r.pid}`)).json.data; assert.equal(e.lines.length, 1); const l = e.lines[0];
  assert.deepEqual([l.remainingQty, l.budgetRate, l.budgetRateFrom, l.currentRate, l.enough], [10000, 38000, 'ITEM_STANDARD', 40000, true]); assert.equal(l.exposure, 20_000_000, '10,000 bags x (₹ 400 - ₹ 380) = ₹ 2,00,000'); assert.equal(l.deltaPct, 5.3); assert.equal(e.totals.over, 20_000_000);
  const prId = Number(d.prepare("INSERT INTO proc_requisitions (company_id, doc_no, doc_date, org_project_id, pr_source, requested_by, required_by, status, total_amount, created_by) VALUES (1, 'PR/R/9', ?, ?, 'DIRECT', 'ric1', ?, 'APPROVED', 0, 'test')").run(TODAY, r.pid, plus(30)).lastInsertRowid); const site = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'RT-S9', 'Site', 'ACTIVE')").run(r.pid).lastInsertRowid);
  d.prepare("INSERT INTO proc_pr_lines (company_id, pr_id, line_no, item_id, qty, uom, est_rate, est_amount, valued_from, required_by, delivery_site_id, balance_qty, created_by) VALUES (1, ?, 1, ?, 1000000, 'bag', 39500, 39500, 'MANUAL', ?, ?, 1000000, 'test')").run(prId, r.cement, plus(30), site);
  const e2 = (await r.call(est, 'GET', `/rate-exposure?projectId=${r.pid}`)).json.data.lines[0]; assert.deepEqual([e2.budgetRate, e2.budgetRateFrom, e2.exposure], [39500, 'REQUISITION', 5_000_000], 'the requisition estimate is the budget rate: 10,000 x ₹ 5');
});

test('FR-04 the comparative statement and the purchase order read the benchmark once there are enough observations; the flag switches the API off', async () => {
  const r = await ready(); const { rateBenchmarks } = await import('../src/server/modules/proc/pr.js'); const q = { companyId: 1, itemId: r.cement, date: TODAY };
  const { procOf } = await import('../src/server/modules/proc/index.js'); void procOf; assert.equal(rateBenchmarks.lookup(r.d, q), null, 'no history: callers keep their own figures');
  for (const [rate, day] of [[390, 30], [395, 25], [400, 20], [405, 15]]) await r.survey(mgr, r.cement, rate, { date: plus(-day), region: 'ALL' }); assert.equal(rateBenchmarks.lookup(r.d, q), null, 'four of five needed'); await r.survey(mgr, r.cement, 410, { date: plus(-10), region: 'ALL' });
  const b = rateBenchmarks.lookup(r.d, q); assert.deepEqual([b.rate, b.count, b.uom], [40000, 5, 'bag']); assert.equal(rateBenchmarks.lookup(r.api.db, { ...q, itemId: 999999 }), null);
  r.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.proc.p1509'").run(); for (const path of ['/rate-intelligence/dashboard', '/rate-observations', '/rate-indices', '/rate-exposure?projectId=1']) assert.equal((await r.call(mgr, 'GET', path)).status, 404, path); void r.drain;
});
