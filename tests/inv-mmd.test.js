import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { todayIST } from '../src/shared/dates.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { invOf } from '../src/server/modules/inv/index.js';

// Part 16.11: materials management dashboard: the inventory value equals the stock ledger at the same entry, the KPIs and queues equal the documents behind them, the funnel carries each stage, scope and flag are enforced.
const I = '/api/v1/inv'; const W = '/api/v1/workflow';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `mmd-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const mgr = as('STOREMGR', 'dmgr1'); const mgr2 = as('STOREMGR', 'dmgr2'); const pmgr = as('PROCMGR', 'dpmgr1'); const accm = as('ACCMGR', 'dacc1'); const dir = as('DIR', 'ddir1'); const sk = as('SK', 'dsk1'); const qs = as('QS', 'dqs1'); const other = as('STOREMGR', 'dmgrx', '2');
const TODAY = todayIST(); const ago = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

function fill(d, table, vals) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all(); const sql = d.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql; const names = []; const params = [];
  const first = (name) => { const m = new RegExp(`CHECK \\(${name} IN \\(([^)]*)\\)\\)`).exec(sql); return m ? m[1].split(',')[0].trim().replace(/^'|'$/g, '') : null; };
  for (const c of cols) { if (c.name === 'id') continue; if (c.name === 'doc_no' && !('doc_no' in vals)) { names.push('doc_no'); params.push(`T/${table}/${(seq += 1)}`); continue; } if (c.name in vals) { names.push(c.name); params.push(vals[c.name]); } else if (c.notnull && c.dflt_value == null) { names.push(c.name); params.push(first(c.name) ?? (/INT|REAL|NUM/i.test(c.type) ? 1 : 'x')); } }
  return Number(d.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
}

async function ready() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['dmgr1', ['STOREMGR']], ['dmgr2', ['STOREMGR']], ['dpmgr1', ['PROCMGR']], ['dacc1', ['ACCMGR']], ['ddir1', ['DIR']], ['dpm1', ['PM']], ['dpm2', ['PM']], ['dsk1', ['SK']], ['dqs1', ['QS']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  d.exec('PRAGMA foreign_keys = OFF');
  const proj = (code) => Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, ?, ?, 'BUILDING', 'ACTIVE')").run(code, `Tower ${code}`).lastInsertRowid);
  const A = proj('DA1'); const B = proj('DB1'); const siteA = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'DA-S1', 'Site A', 'ACTIVE')").run(A).lastInsertRowid); const siteB = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'DB-S1', 'Site B', 'ACTIVE')").run(B).lastInsertRowid);
  const uid = Number(d.prepare("SELECT id FROM iam_users WHERE username = 'dpm2'").get().id); d.prepare("DELETE FROM iam_assignments WHERE user_id = ?").run(uid);
  d.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, reason, created_by, source_type) VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PM' AND company_id IS NULL), 'PROJECT', ?, 'ACTIVE', 'test', 'test', 'test')").run(uid, JSON.stringify([A]));
  const cat = Number(d.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, 'CEMENT', 'Cement', 'CEM', '[]', '[]', 'PROCMGR', 'ACTIVE')").run().lastInsertRowid);
  const item = (code) => Number(d.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (1, ?, ?, 'MATERIAL', ?, 'bag', '2026-01-01', 'ACTIVE', 1)").run(code, `Item ${code}`, cat).lastInsertRowid);
  const cement = item('MD-CEM'); const steel = item('MD-STL'); const sand = item('MD-SND');
  const vendor = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, 'MDV', 'Vendor Ltd', 'VendorCo', 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'test')").run().lastInsertRowid);
  const call = (who, method, path, body, k = key()) => api.call(method, `${I}${path}`, { ...who, headers: k, body });
  const get = (who, path) => api.call('GET', `${I}/materials${path}`, who);
  const tasksOf = async (who) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows;
  const act2 = async (who, instanceId) => { const task = (await tasksOf(who)).find((x) => x.instance.id === instanceId); assert.ok(task); return api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action: 'approve' } }); };
  const store = async (code, projectId, siteId) => { const c = await api.call('POST', `${I}/stores`, { ...mgr, headers: key(), body: { code, name: `Store ${code}`, type: 'SITE_STORE', projectId, siteId, keepers: ['dsk1'] } }); assert.equal(c.status, 201, JSON.stringify(c.json)); const s = await api.call('POST', `${I}/stores/${c.json.data.id}/submit`, { ...mgr, headers: key(), body: {} }); assert.equal((await act2(mgr2, s.json.data.workflowInstanceId)).status, 200); return c.json.data; };
  const move = async (st, itemId, type, qty, date, rate = 40) => { const r = await call(mgr, 'POST', '/movements', { storeId: st.id, itemId, type, qty, ...(type === 'ISSUE' ? {} : { rate }), date, reason: 'For the dashboard test' }); assert.equal(r.status, 201, JSON.stringify(r.json)); };
  return { api, d, A, B, siteA, siteB, cement, steel, sand, vendor, call, get, store, move, drain: () => runtimeOf(d).bus.drain() };
}
const ledgerSum = (d, where = '1 = 1', ...p) => d.prepare(`SELECT COALESCE(SUM(value), 0) AS v FROM inv_stock_ledger WHERE ${where}`).get(...p).v;

test('T-01 BR-01 the inventory value of the dashboard equals the stock ledger at the same entry, for the company, a project and a store', async () => {
  const r = await ready(); const sa = await r.store('MD-A', r.A, r.siteA); const sb = await r.store('MD-B', r.B, r.siteB);
  await r.move(sa, r.cement, 'RECEIPT', 500, ago(5), 40); await r.move(sa, r.cement, 'ISSUE', 120, ago(2)); await r.move(sb, r.steel, 'RECEIPT', 80, ago(3), 600);
  const company = (await r.get(mgr, '/dashboard')).json.data; const k = company.kpis.inventoryValue;
  assert.equal(k.value, ledgerSum(r.d), 'the dashboard equals an independent ledger sum'); assert.equal(k.ledgerValue, k.value); assert.equal(k.difference, 0); assert.equal(k.reconciled, true); assert.equal(k.asOfEntryId, r.d.prepare('SELECT MAX(id) AS m FROM inv_stock_ledger').get().m);
  assert.equal(k.value, r.d.prepare('SELECT SUM(value) AS v FROM inv_valuation').get().v, 'and the valuation of the books'); assert.ok(k.value > 0); assert.equal(company.view, 'company');
  const pa = (await r.get(mgr, `/dashboard?projectId=${r.A}`)).json.data; assert.equal(pa.view, 'project'); assert.equal(pa.kpis.inventoryValue.value, ledgerSum(r.d, 'project_id = ?', r.A), 'project view'); assert.equal(pa.kpis.inventoryValue.value, (380 * 40 * 100));
  const st = (await r.get(mgr, `/dashboard?storeId=${sb.id}`)).json.data; assert.equal(st.view, 'store'); assert.equal(st.kpis.inventoryValue.value, ledgerSum(r.d, 'store_id = ?', sb.id), 'store view'); assert.equal(st.kpis.inventoryValue.value, 80 * 600 * 100);
  assert.equal((await r.get(mgr, `/dashboard?projectId=${r.A}&storeId=${sb.id}`)).status, 404, 'a store of another project');
  r.d.prepare("UPDATE inv_valuation SET value = value + 100 WHERE store_id = ? AND item_id = ?").run(sa.id, r.cement); const bad = (await r.get(mgr, '/dashboard')).json.data; assert.equal(bad.kpis.inventoryValue.reconciled, false, 'a difference is shown, never hidden'); assert.equal(bad.kpis.inventoryValue.difference, 100); assert.ok(bad.alerts.some((a) => a.code === 'BOOKS'));
});

test('FR-01 FR-03 the KPIs, queues and drill-downs equal the documents behind them', async () => {
  const r = await ready(); const sa = await r.store('MD-C', r.A, r.siteA); const d = r.d;
  await r.move(sa, r.cement, 'RECEIPT', 200, ago(200), 50); await r.move(sa, r.steel, 'RECEIPT', 40, ago(10), 700); await r.move(sa, r.steel, 'ISSUE', 5, ago(1));
  // reorder: cement has 200 on hand, level 300 -> below; steel level 10 -> fine
  fill(d, 'inv_reorder_params', { company_id: 1, store_id: sa.id, item_id: r.cement, org_project_id: r.A, min_qty: 100_000, max_qty: 500_000, reorder_level: 300_000, reorder_qty: 200_000, effective_from: ago(30) }); fill(d, 'inv_reorder_params', { company_id: 1, store_id: sa.id, item_id: r.steel, org_project_id: r.A, min_qty: 1000, max_qty: 50_000, reorder_level: 10_000, reorder_qty: 5000, effective_from: ago(30) });
  // a received GRN with one line waiting for inspection for 6 days, another already passed
  const g = fill(d, 'inv_grns', { company_id: 1, org_project_id: r.A, store_id: sa.id, vendor_id: r.vendor, status: 'APPROVED', received_date: ago(6), po_id: 1, total_value: 100_000 }); fill(d, 'inv_grn_lines', { company_id: 1, grn_id: g, item_id: r.cement, received_qty: 10_000, accepted_qty: 10_000, rejected_qty: 0, inspection_required: 1, inspection_status: 'PENDING', line_value: 100_000 }); fill(d, 'inv_grn_lines', { company_id: 1, grn_id: g, line_no: 2, item_id: r.steel, received_qty: 1000, accepted_qty: 1000, rejected_qty: 0, inspection_status: 'PASSED', line_value: 5000 });
  // material requests: one waiting for approval, one approved and unplanned, one approved and fully served
  const mr1 = fill(d, 'proc_material_requests', { company_id: 1, org_project_id: r.A, mr_site_id: r.siteA, status: 'SUBMITTED', doc_date: ago(3), required_by: ago(1) }); fill(d, 'proc_mr_lines', { mr_id: mr1, item_id: r.cement, qty: 5000, fulfilled_qty: 0, fulfilment_mode: 'NONE' });
  const mr2 = fill(d, 'proc_material_requests', { company_id: 1, org_project_id: r.A, mr_site_id: r.siteA, status: 'APPROVED', doc_date: ago(2), required_by: ago(-5) }); fill(d, 'proc_mr_lines', { mr_id: mr2, item_id: r.steel, qty: 3000, fulfilled_qty: 0, fulfilment_mode: 'NONE' });
  const mr3 = fill(d, 'proc_material_requests', { company_id: 1, org_project_id: r.A, mr_site_id: r.siteA, status: 'APPROVED', doc_date: ago(2), required_by: ago(-5) }); fill(d, 'proc_mr_lines', { mr_id: mr3, item_id: r.sand, qty: 3000, fulfilled_qty: 3000, fulfilment_mode: 'ISSUE' });
  // a posted issue today, a transfer in transit, a site return and an RTV waiting, a count due
  fill(d, 'inv_issues', { company_id: 1, org_project_id: r.A, store_id: sa.id, status: 'POSTED', issue_date: TODAY, total_value: 350_000, issued_to_name: 'Crew 1' });
  const sb = await r.store('MD-D', r.B, r.siteB); fill(d, 'inv_transfers', { company_id: 1, from_store_id: sa.id, to_store_id: sb.id, from_project_id: r.A, to_project_id: r.B, status: 'IN_TRANSIT', dispatch_date: ago(4), required_by: ago(1), total_value: 90_000 });
  fill(d, 'inv_site_returns', { company_id: 1, org_project_id: r.A, store_id: sa.id, status: 'SUBMITTED', return_date: ago(2), total_value: 1000 }); fill(d, 'inv_rtvs', { company_id: 1, org_project_id: r.A, store_id: sa.id, status: 'SUBMITTED', rtv_date: ago(1), total_value: 2000, vendor_id: r.vendor });
  fill(d, 'inv_count_plans', { company_id: 1, store_id: sa.id, org_project_id: r.A, status: 'APPROVED', scheduled_date: ago(1) });
  const dash = (await r.get(mgr, `/dashboard?projectId=${r.A}`)).json.data; const k = dash.kpis;
  assert.equal(k.belowReorder.count, 1, 'cement is below its level, steel is not'); assert.equal(k.pendingGrnInspections.count, 1); assert.equal(k.pendingGrnInspections.late, 1, '6 days against 3 allowed'); assert.equal(k.pendingGrnInspections.value, 100_000);
  assert.deepEqual([k.openMrs.count, k.openMrs.awaiting, k.openMrs.late], [2, 2, 1], 'the served request is not open; the submitted one is late');
  assert.deepEqual([k.issuesToday.count, k.issuesToday.value], [1, 350_000]); assert.deepEqual([k.transfersInTransit.count, k.transfersInTransit.late, k.transfersInTransit.value], [1, 1, 90_000]);
  assert.equal(k.nonMoving.count, 1, 'cement has not moved for 200 days, steel was issued yesterday'); assert.equal(k.nonMoving.value, 200 * 50 * 100); assert.equal(k.nonMoving.status, 'bad');
  assert.deepEqual([dash.queues.mrsAwaiting.count, dash.queues.grnsPending.count, dash.queues.returnsPending.count, dash.queues.countsDue.count], [2, 1, 2, 1]);
  assert.ok(dash.alerts.some((a) => a.code === 'REORDER') && dash.alerts.some((a) => a.code === 'INSPECTION') && dash.alerts.some((a) => a.code === 'TRANSIT'));
  assert.ok(k.stockTurns.turns > 0, 'turns come from issues at cost over the average stock');
  // FR-04 every tile drills to its records
  const dr = async (kind) => (await r.get(mgr, `/drill?projectId=${r.A}&kind=${kind}`)).json.data;
  for (const [kind, n] of [['belowReorder', 1], ['pendingGrn', 1], ['openMrs', 2], ['issuesToday', 1], ['inTransit', 1], ['nonMoving', 1], ['returnsPending', 2], ['countsDue', 1], ['mrsAwaiting', 2]]) { const x = await dr(kind); assert.equal(x.rows.length, n, kind); assert.ok(x.rows.every((row) => row.docNo && row.link), `${kind} rows link to the record`); }
  assert.equal((await dr('inventory')).rows[0].value, ledgerSum(d, 'store_id = ?', sa.id));
  assert.equal((await r.get(mgr, '/drill?kind=bogus')).status, 400);
  // export: CSV with the same figures, formula-neutral, audited
  const ex = await r.get(mgr, `/export?projectId=${r.A}&kind=pendingGrn`); assert.equal(ex.status, 200); assert.match(ex.headers.get('content-type'), /csv/); assert.equal((await r.get(sk, '/export?kind=kpis')).status, 403);
  assert.ok(d.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'inv_dashboard' AND action = 'export'").get(), 'the export is written to the audit trail');
});

test('FR-02 the lifecycle funnel carries the quantity of each stage per material and opens the documents behind it', async () => {
  const r = await ready(); const sa = await r.store('MD-E', r.A, r.siteA); const d = r.d;
  const mr = fill(d, 'proc_material_requests', { company_id: 1, org_project_id: r.A, mr_site_id: r.siteA, status: 'APPROVED', doc_date: ago(20) }); fill(d, 'proc_mr_lines', { mr_id: mr, item_id: r.cement, qty: 1000_000 });
  const pr = fill(d, 'proc_requisitions', { company_id: 1, org_project_id: r.A, status: 'APPROVED', doc_date: ago(18) }); fill(d, 'proc_pr_lines', { pr_id: pr, item_id: r.cement, qty: 900_000 });
  const po = fill(d, 'proc_purchase_orders', { company_id: 1, org_project_id: r.A, vendor_id: r.vendor, status: 'APPROVED', approved_at: `${ago(15)}T10:00:00.000Z` }); fill(d, 'proc_po_lines', { po_id: po, item_id: r.cement, qty: 800_000 });
  const g = fill(d, 'inv_grns', { company_id: 1, org_project_id: r.A, store_id: sa.id, vendor_id: r.vendor, status: 'APPROVED', received_date: ago(10), po_id: po }); fill(d, 'inv_grn_lines', { company_id: 1, grn_id: g, item_id: r.cement, received_qty: 700_000, accepted_qty: 650_000, rejected_qty: 50_000, qc_rejected_qty: 10_000 });
  const is = fill(d, 'inv_issues', { company_id: 1, org_project_id: r.A, store_id: sa.id, status: 'POSTED', issue_date: ago(5) }); fill(d, 'inv_issue_lines', { company_id: 1, issue_id: is, item_id: r.cement, qty: 500_000, returned_qty: 20_000 });
  fill(d, 'inv_issues', { company_id: 1, org_project_id: r.A, store_id: sa.id, status: 'DRAFT', issue_date: ago(4) }); // a draft is not counted
  const f = (await r.get(mgr, `/funnel?projectId=${r.A}`)).json.data; const row = f.rows.find((x) => x.code === 'MD-CEM'); assert.ok(row); assert.equal(row.requiredSource, 'MR', 'no MRP run: the approved material requests');
  assert.deepEqual(row.stages.map((s) => s.qty), [1000, 900, 800, 700, 640, 500, 480]); assert.deepEqual(row.stages.map((s) => s.pctOfPrevious), [null, 90, 88.9, 87.5, 91.4, 78.1, 96]); assert.equal(row.widestGap.stage, 'issued');
  const mrpRun = fill(d, 'proc_mrp_runs', { company_id: 1, org_project_id: r.A, status: 'COMPLETED' }); fill(d, 'proc_mrp_lines', { run_id: mrpRun, item_id: r.cement, gross_req: 1200_000 });
  const f2 = (await r.get(mgr, `/funnel?projectId=${r.A}&itemId=${r.cement}`)).json.data.rows[0]; assert.equal(f2.requiredSource, 'MRP'); assert.equal(f2.stages[0].qty, 1200);
  for (const [stage, doc, qty] of [['required', 'MR', 1000], ['pr', null, 900], ['po', null, 800], ['delivered', null, 700], ['accepted', null, 640], ['issued', null, 500], ['consumed', null, 480]]) { const x = (await r.get(mgr, `/funnel/records?projectId=${r.A}&itemId=${r.cement}&stage=${stage}`)).json.data; assert.equal(x.rows.length, 1, stage); assert.equal(x.rows[0].qty, qty, stage); assert.ok(x.rows[0].link); void doc; }
  assert.equal((await r.get(mgr, `/funnel?projectId=${r.A}&q=zzzz`)).json.data.rows.length, 0); assert.equal((await r.get(mgr, '/funnel/records?itemId=1&stage=nope')).status, 400);
});

test('AC-03 who sees what: the five roles read, others do not; project scope isolates; another company and the flag are respected', async () => {
  const r = await ready(); const sa = await r.store('MD-F', r.A, r.siteA); const sb = await r.store('MD-G', r.B, r.siteB); await r.move(sa, r.cement, 'RECEIPT', 100, ago(2), 10); await r.move(sb, r.steel, 'RECEIPT', 50, ago(2), 20);
  for (const who of [mgr, pmgr, accm, dir]) assert.equal((await r.get(who, '/dashboard')).status, 200, who.user);
  for (const who of [sk, qs]) { assert.equal((await r.get(who, '/dashboard')).status, 403, who.user); assert.equal((await r.get(who, '/funnel')).status, 403, who.user); }
  const all = (await r.get(mgr, '/dashboard')).json.data.kpis.inventoryValue.value; assert.equal(all, 100 * 10 * 100 + 50 * 20 * 100);
  const uid = Number(r.d.prepare("SELECT id FROM iam_users WHERE username = 'dpm2'").get().id); const mm = invOf(r.d).mmd; const pmScoped = { user: 'dpm2', userId: uid, companyId: 1, roles: [] };
  assert.equal(mm.dashboard(pmScoped, {}).kpis.inventoryValue.value, 100 * 10 * 100, 'a project manager sees only the projects held'); assert.throws(() => mm.dashboard(pmScoped, { projectId: r.B }), /does not exist/, 'cross-project'); assert.throws(() => mm.dashboard(pmScoped, { storeId: sb.id }), /does not exist/, 'cross-store');
  assert.throws(() => mm.stageRecords(pmScoped, { projectId: r.B, itemId: r.steel, stage: 'issued' }), /does not exist/); assert.deepEqual(mm.projects(pmScoped).map((p) => p.id), [r.A]); assert.deepEqual(mm.stores(pmScoped).map((x) => x.id), [sa.id]);
  const o = await r.get(other, '/dashboard'); assert.equal(o.status === 200 ? o.json.data.kpis.inventoryValue.value : 0, 0, 'another company has its own figures'); assert.equal((await r.get(other, `/dashboard?projectId=${r.A}`)).status, 404);
  assert.equal((await r.get(mgr, '/dashboard?projectId=999999')).status, 404);
  r.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.inv.p1611'").run(); for (const p of ['/dashboard', '/funnel', '/drill?kind=inventory']) assert.equal((await r.get(mgr, p)).status, 404, p);
});

test('AC-04 the targets are parameters of the parameter engine and the dashboard stores nothing of its own', async () => {
  const r = await ready(); const keys = ['inv.mmd.target_turns', 'inv.mmd.non_moving_days', 'inv.mmd.target_non_moving_pct', 'inv.mmd.inspection_days'];
  const dash = (await r.get(mgr, '/dashboard')).json.data; assert.deepEqual([dash.targets.turns, dash.targets.nonMovingDays, dash.targets.nonMovingPct, dash.targets.inspectionDays], [4, 90, 10, 3]);
  const { parameterRegistry } = await import('../src/server/platform/parameters/index.js'); for (const k of keys) assert.ok(parameterRegistry.get(k), k);
  assert.equal(r.d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND (name LIKE 'mmd\\_%' ESCAPE '\\' OR name LIKE 'md\\_%' ESCAPE '\\')").get().n, 0, 'no table of its own');
});
