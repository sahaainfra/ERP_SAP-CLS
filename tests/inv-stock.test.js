import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { todayIST } from '../src/shared/dates.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { fifoOut, wavgOut } from '../src/server/modules/inv/stock.js';

// Part 16.01: stores, bins, the stock ledger, balances, valuation, reservations, adjustments.
// T-01 the weighted average rate after receipts and issues matches the worked example; T-02 negative stock is blocked and the ledger equals the balances.
const I = '/api/v1/inv'; const W = '/api/v1/workflow';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `inv-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const mgr = as('STOREMGR', 'imgr1'); const mgr2 = as('STOREMGR', 'imgr2'); const acc = as('ACCMGR', 'iacc1'); const sk = as('SK', 'isk1'); const sk2 = as('SK', 'isk2'); const pm = as('PM', 'ipm1'); const pr = as('PROCMGR', 'ipr1'); const other = as('STOREMGR', 'imgrx', '2');
const TODAY = todayIST();

async function ready() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['imgr1', ['STOREMGR']], ['imgr2', ['STOREMGR']], ['iacc1', ['ACCMGR']], ['isk1', ['SK']], ['isk2', ['SK']], ['ipm1', ['PM']], ['ipr1', ['PROCMGR']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'IV1', 'Stores tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid); const pid2 = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'IV2', 'Stores other', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const site = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'IV-S1', 'Tower site', 'ACTIVE')").run(pid).lastInsertRowid); const site2 = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'IV-S2', 'Other site', 'ACTIVE')").run(pid2).lastInsertRowid);
  const cat = Number(d.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, 'CEMENT', 'Cement', 'CEM', '[]', '[]', 'PROCMGR', 'ACTIVE')").run().lastInsertRowid);
  const item = (code, over = {}) => Number(d.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked, batch_tracked, serial_tracked, reorder_level) VALUES (1, ?, ?, 'MATERIAL', ?, 'bag', '2026-01-01', 'ACTIVE', 1, ?, ?, ?)").run(code, code, cat, over.batch ? 1 : 0, over.serial ? 1 : 0, over.reorder ?? 0).lastInsertRowid);
  const cement = item('IV-CEM', { reorder: 500_000 }); const steel = item('IV-STL'); const batched = item('IV-BAT', { batch: true }); const serial = item('IV-SER', { serial: true });
  const call = (who, method, path, body, k = key()) => api.call(method, `${I}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => { const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`); return api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: action === 'approve' ? 'Fine, approved' : 'Please correct this and send again' } }); };
  const store = async (code, over = {}) => { const c = await call(mgr, 'POST', '/stores', { code, name: `Store ${code}`, type: 'SITE_STORE', projectId: pid, siteId: site, keepers: ['isk1'], ...over }); assert.equal(c.status, 201, JSON.stringify(c.json)); const s = await call(mgr, 'POST', `/stores/${c.json.data.id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); assert.equal((await act(mgr2, s.json.data.workflowInstanceId)).status, 200); return (await call(mgr, 'GET', `/stores/${c.json.data.id}`)).json.data; };
  const post = (who, body) => call(who, 'POST', '/movements', { date: TODAY, reason: 'Test movement', ...body });
  const drain = () => runtimeOf(d).bus.drain(); const events = (type) => d.prepare('SELECT payload FROM core_outbox WHERE event_type = ? ORDER BY id').all(type).map((x) => { const j = JSON.parse(x.payload); return j.data ?? j; });
  return { api, d, pid, pid2, site, site2, cement, steel, batched, serial, call, act, store, post, drain, events };
}

test('weighted average and FIFO take-out are worked out one way', () => {
  assert.equal(wavgOut({ qty: 200_000, value: 900_000, avgRate: 4500 }, 50_000), 225_000); assert.equal(wavgOut({ qty: 200_000, value: 900_000, avgRate: 4500 }, 200_000), 900_000, 'the last of it takes the whole value'); assert.equal(wavgOut({ qty: 0, value: 0, avgRate: 4500 }, 10_000), 45_000, 'negative stock at the last rate');
  assert.deepEqual(fifoOut([{ id: 1, qty: 100_000, rate: 4000 }, { id: 2, qty: 100_000, rate: 5000 }], 150_000), { value: 400_000 + 250_000, used: [{ id: 1, take: 100_000, left: 0 }, { id: 2, take: 50_000, left: 50_000 }], short: 0 });
  assert.equal(fifoOut([{ id: 1, qty: 10_000, rate: 4000 }], 30_000).short, 20_000);
});

test('FR-01 FR-02 a store is made, approved by another store manager and gets a default bin; bins are added; the keeper sees only the store they keep', async () => {
  const r = await ready(); const c = await r.call(mgr, 'POST', '/stores', { code: 'ST-A', name: 'Tower store', type: 'SITE_STORE', projectId: r.pid, siteId: r.site, keepers: ['isk1'] }); assert.equal(c.status, 201, JSON.stringify(c.json)); const st = c.json.data;
  assert.deepEqual([st.status, st.bins.length, st.bins[0].isDefault, st.valuation, st.allowNegative], ['DRAFT', 1, true, 'WAVG', false]); assert.equal((await r.call(mgr, 'POST', '/stores', { code: 'st-a', name: 'x y', type: 'YARD', keepers: [] })).status, 409, 'the code is unique');
  assert.equal((await r.post(mgr, { storeId: st.id, itemId: r.cement, type: 'RECEIPT', qty: 10, rate: 40 })).status, 422, 'stock moves only in an approved store');
  const s = await r.call(mgr, 'POST', `/stores/${st.id}/submit`); assert.equal(s.status, 202); assert.equal((await r.act(mgr2, s.json.data.workflowInstanceId)).status, 200);
  assert.equal((await r.call(mgr, 'GET', `/stores/${st.id}`)).json.data.status, 'ACTIVE'); await r.drain(); assert.equal(r.events('inv.store.activated').length, 1);
  const bin = await r.call(mgr, 'POST', `/stores/${st.id}/bins`, { code: 'A-01', zone: 'A', rack: '1', shelf: '2', capacity: 500 }); assert.equal(bin.status, 201); assert.equal(bin.json.data.bins.length, 2); assert.equal((await r.call(mgr, 'POST', `/stores/${st.id}/bins`, { code: 'a-01' })).status, 409);
  assert.equal((await r.call(sk, 'POST', `/stores/${st.id}/bins`, { code: 'B-01' })).status, 403, 'the keeper does not shape the store');
  const other2 = await r.store('ST-B', { projectId: r.pid2, siteId: r.site2, keepers: ['isk2'] }); const skList = (await r.call(sk, 'GET', '/stores')).json.data; assert.deepEqual(skList.map((x) => x.code), ['ST-A'], 'only the stores they keep'); assert.equal((await r.call(sk, 'GET', `/stores/${other2.id}`)).status, 404);
  assert.equal((await r.call(pm, 'GET', '/stores')).json.data.length, 2, 'the project manager sees the stores'); assert.equal((await r.call(other, 'GET', `/stores/${st.id}`)).status, 404, 'another company');
});

test('T-01 FR-03 FR-05 the weighted average rate after receipts and issues, with the running balance on every entry', async () => {
  const r = await ready(); const st = await r.store('ST-W');
  assert.equal((await r.post(mgr, { storeId: st.id, itemId: r.cement, type: 'RECEIPT', qty: 100, rate: 40 })).status, 201); assert.equal((await r.post(mgr, { storeId: st.id, itemId: r.cement, type: 'RECEIPT', qty: 100, rate: 50 })).status, 201);
  const v1 = (await r.call(mgr, 'GET', `/ledger?itemId=${r.cement}&storeId=${st.id}`)).json.data; assert.deepEqual(v1.rows.map((x) => [x.balanceQty, x.balanceValue]), [[100, 400_000], [200, 900_000]], 'average ₹ 45 after the second receipt');
  const iss = await r.post(mgr, { storeId: st.id, itemId: r.cement, type: 'ISSUE', qty: 50 }); assert.equal(iss.status, 201, JSON.stringify(iss.json)); assert.deepEqual([iss.json.data.entries[0].qtyOut, iss.json.data.entries[0].rate, iss.json.data.entries[0].value, iss.json.data.entries[0].balanceQty, iss.json.data.entries[0].balanceValue], [50, 4500, -225_000, 150, 675_000], '50 bags at ₹ 45; 150 left worth ₹ 6,750');
  assert.equal((await r.post(mgr, { storeId: st.id, itemId: r.cement, type: 'RECEIPT', qty: 50, rate: 60 })).status, 201); const card = (await r.call(mgr, 'GET', `/ledger?itemId=${r.cement}&storeId=${st.id}`)).json.data; const last = card.rows.at(-1); assert.deepEqual([last.balanceQty, last.balanceValue], [200, 975_000], '(6,750 + 3,000) over 200 bags: ₹ 48.75');
  const bal = (await r.call(mgr, 'GET', '/balances')).json.data; assert.deepEqual([bal.length, bal[0].onHand, bal[0].avgRate, bal[0].value], [1, 200, 4875, 975_000]);
  const all = await r.post(mgr, { storeId: st.id, itemId: r.cement, type: 'ISSUE', qty: 200 }); assert.equal(all.json.data.entries[0].value, -975_000, 'the last of it takes the whole value'); assert.equal((await r.call(mgr, 'GET', '/balances')).json.data.length, 0, 'an empty store has no balance lines');
  assert.deepEqual((await r.call(mgr, 'GET', '/integrity')).json.data.problems, []);
});

test('T-02 BR-01 BR-02 BR-03 negative stock is blocked, reserved stock cannot be issued, the ledger cannot be changed and balances equal the ledger', async () => {
  const r = await ready(); const st = await r.store('ST-N'); await r.post(mgr, { storeId: st.id, itemId: r.cement, type: 'RECEIPT', qty: 100, rate: 40 });
  const neg = await r.post(mgr, { storeId: st.id, itemId: r.cement, type: 'ISSUE', qty: 150 }); assert.equal(neg.status, 422); assert.match(neg.json.error.message, /Not enough stock/);
  const rv = await r.call(mgr, 'POST', '/reservations', { storeId: st.id, itemId: r.cement, qty: 60, sourceType: 'WORK_AUTHORISATION', sourceId: 'WA-1' }); assert.equal(rv.status, 201, JSON.stringify(rv.json)); assert.equal((await r.post(mgr, { storeId: st.id, itemId: r.cement, type: 'ISSUE', qty: 50 })).status, 422, '40 are free, 60 reserved');
  assert.equal((await r.call(mgr, 'POST', '/reservations', { storeId: st.id, itemId: r.cement, qty: 50, sourceType: 'MATERIAL_REQUEST', sourceId: 'MR-1' })).status, 422, 'only 40 are free to reserve');
  const using = await r.post(mgr, { storeId: st.id, itemId: r.cement, type: 'ISSUE', qty: 60, reservationId: rv.json.data.id }); assert.equal(using.status, 201, JSON.stringify(using.json)); assert.equal((await r.call(mgr, 'GET', '/reservations?status=CONSUMED')).json.data.length, 1);
  const e = using.json.data.entries[0]; assert.throws(() => r.d.prepare('UPDATE inv_stock_ledger SET qty_out = 1 WHERE id = ?').run(e.id), /never changed/); assert.throws(() => r.d.prepare('DELETE FROM inv_stock_ledger WHERE id = ?').run(e.id), /never deleted/);
  const rev = await r.call(mgr, 'POST', `/ledger/${e.id}/reverse`, { reason: 'Issued to the wrong site' }); assert.equal(rev.status, 201, JSON.stringify(rev.json)); assert.equal(rev.json.data.entry.type, 'REVERSAL'); assert.equal(rev.json.data.entry.balanceQty, 100); assert.equal((await r.call(mgr, 'POST', `/ledger/${e.id}/reverse`, { reason: 'Again please' })).status, 409); assert.equal((await r.call(mgr, 'POST', `/ledger/${rev.json.data.entry.id}/reverse`, { reason: 'Reverse the reversal' })).status, 422);
  assert.deepEqual((await r.call(mgr, 'GET', '/integrity')).json.data.problems, []);
  r.d.exec('DROP TRIGGER trg_inv_ledger_no_update'); r.d.prepare('UPDATE inv_balances SET qty_on_hand = qty_on_hand + 1000 WHERE store_id = ?').run(st.id); const bad = (await r.call(mgr, 'GET', '/integrity')).json.data.problems; assert.ok(bad.some((p) => p.kind === 'BALANCE_QTY'), 'a changed balance is found');
  assert.equal((await r.call(sk, 'GET', '/integrity')).status, 403); assert.equal((await r.call(sk, 'POST', `/ledger/${e.id}/reverse`, { reason: 'A keeper reverses' })).status, 403);
});

test('FR-05 FIFO stores take from the oldest receipt; batches and serial numbers are kept; an issue without a bin takes from the oldest lines', async () => {
  const r = await ready(); const f = await r.store('ST-F'); assert.equal((await r.call(mgr, 'POST', `/stores/${f.id}/change`, { reason: 'First in, first out for this yard', valuationMethod: 'FIFO' })).status, 202);
  const chg = r.d.prepare('SELECT * FROM inv_store_changes').get(); const inst = r.d.prepare('SELECT workflow_instance_id FROM inv_store_changes').get().workflow_instance_id; assert.equal((await r.act(mgr2, inst)).status, 200); assert.equal((await r.call(mgr, 'GET', `/stores/${f.id}`)).json.data.valuation, 'WAVG', 'not yet: the accounts manager is to approve'); assert.equal((await r.act(acc, inst)).status, 200); assert.equal((await r.call(mgr, 'GET', `/stores/${f.id}`)).json.data.valuation, 'FIFO'); void chg;
  await r.post(mgr, { storeId: f.id, itemId: r.steel, type: 'RECEIPT', qty: 100, rate: 40 }); await r.post(mgr, { storeId: f.id, itemId: r.steel, type: 'RECEIPT', qty: 100, rate: 50 });
  const out = await r.post(mgr, { storeId: f.id, itemId: r.steel, type: 'ISSUE', qty: 150 }); assert.equal(out.json.data.entries[0].value, -(400_000 + 250_000), '100 at ₹ 40 and 50 at ₹ 50'); const bal = (await r.call(mgr, 'GET', '/balances')).json.data[0]; assert.deepEqual([bal.onHand, bal.value], [50, 250_000]);
  const b = await r.store('ST-BATCH'); assert.equal((await r.post(mgr, { storeId: b.id, itemId: r.batched, type: 'RECEIPT', qty: 10, rate: 10 })).status, 400, 'a batch item needs the batch'); await r.post(mgr, { storeId: b.id, itemId: r.batched, type: 'RECEIPT', qty: 10, rate: 10, batchNo: 'B1' }); await r.post(mgr, { storeId: b.id, itemId: r.batched, type: 'RECEIPT', qty: 20, rate: 12, batchNo: 'B2' });
  const two = (await r.call(mgr, 'GET', `/balances?filter[itemCode]=IV-BAT`)).json.data; assert.deepEqual(two.map((x) => [x.batch, x.onHand]).sort(), [['B1', 10], ['B2', 20]]); const iss = await r.post(mgr, { storeId: b.id, itemId: r.batched, type: 'ISSUE', qty: 25 }); assert.equal(iss.json.data.entries.length, 2, 'from B1 first, then B2'); assert.deepEqual(iss.json.data.entries.map((x) => x.qtyOut), [10, 15]);
  assert.equal((await r.post(mgr, { storeId: b.id, itemId: r.serial, type: 'RECEIPT', qty: 2, rate: 10, serialNo: 'S1' })).status, 400, 'a serial number is one piece'); assert.equal((await r.post(mgr, { storeId: b.id, itemId: r.serial, type: 'RECEIPT', qty: 1, rate: 10, serialNo: 'S1' })).status, 201); assert.equal((await r.post(mgr, { storeId: b.id, itemId: r.steel, type: 'RECEIPT', qty: 1, rate: 10, serialNo: 'S1' })).status, 400, 'no serial numbers on this item');
  assert.deepEqual((await r.call(mgr, 'GET', '/integrity')).json.data.problems, []);
});

test('FR-07 stock belongs to a project or the pool; a transfer moves it between stores and between owners with a financial transfer event', async () => {
  const r = await ready(); const a = await r.store('ST-P1'); const b = await r.store('ST-P2', { projectId: r.pid2, siteId: r.site2, keepers: ['isk2'] }); const c = await r.store('ST-CW', { type: 'CENTRAL_WAREHOUSE', projectId: null, siteId: null, keepers: [] });
  await r.post(mgr, { storeId: a.id, itemId: r.cement, type: 'RECEIPT', qty: 100, rate: 40 }); const own = (await r.call(mgr, 'GET', '/balances')).json.data[0]; assert.equal(own.project, 'IV1', 'a site store holds the stock of its project');
  const t = await r.call(mgr, 'POST', '/transfers', { fromStoreId: a.id, toStoreId: b.id, itemId: r.cement, qty: 30, toOwnerProjectId: r.pid2, reason: 'Needed on the other project' }); assert.equal(t.status, 201, JSON.stringify(t.json)); assert.equal(t.json.data.interProject, true); assert.equal(t.json.data.in[0].value, 120_000, 'at the value it left');
  await r.drain(); const ev = r.events('inv.stock.transferred'); assert.equal(ev.length, 1); assert.deepEqual([ev[0].fromProjectId, ev[0].toProjectId, ev[0].value, ev[0].qty], [r.pid, r.pid2, 120_000, 30]);
  const sameOwner = await r.call(mgr, 'POST', '/transfers', { fromStoreId: a.id, toStoreId: c.id, itemId: r.cement, qty: 20, reason: 'To the central yard' }); assert.equal(sameOwner.json.data.interProject, false); await r.drain(); assert.equal(r.events('inv.stock.transferred').length, 1, 'no financial event inside a project');
  const pool = (await r.call(mgr, 'GET', '/balances')).json.data.map((x) => [x.store, x.project, x.onHand]).sort(); assert.deepEqual(pool, [['ST-CW', 'IV1', 20], ['ST-P1', 'IV1', 50], ['ST-P2', 'IV2', 30]]);
  const val = (await r.call(mgr, 'GET', '/valuation?groupBy=project')).json.data; assert.deepEqual(val.rows.map((x) => [x.label, x.value]), [['IV1', 280_000], ['IV2', 120_000]]); assert.equal(val.total, 400_000); assert.equal((await r.call(mgr, 'GET', '/valuation?groupBy=category')).json.data.rows[0].label, 'Cement'); assert.equal((await r.call(mgr, 'GET', '/valuation?groupBy=store')).json.data.rows.length, 3);
  assert.equal((await r.call(mgr, 'POST', '/transfers', { fromStoreId: a.id, toStoreId: a.id, itemId: r.cement, qty: 1, reason: 'Same store' })).status, 400); assert.deepEqual((await r.call(mgr, 'GET', '/integrity')).json.data.problems, []);
});

test('FR-08 opening stock loads all or nothing, once; FR-04 inspection holds stock back; FR-06 reservations are released', async () => {
  const r = await ready(); const st = await r.store('ST-O'); const row = (over = {}) => ({ storeCode: 'ST-O', itemCode: 'IV-CEM', qty: 100, rate: 38, ...over });
  const bad = await r.call(mgr, 'POST', '/opening-stock', { rows: [row(), row({ itemCode: 'NOPE' }), row({ storeCode: 'NOPE' })] }); assert.equal(bad.status, 400); assert.equal(bad.json.error.details.length, 2); assert.equal((await r.call(mgr, 'GET', '/balances')).json.data.length, 0, 'nothing was saved');
  const ok = await r.call(mgr, 'POST', '/opening-stock', { rows: [row(), row({ itemCode: 'IV-STL', qty: 40, rate: 62 })] }); assert.equal(ok.status, 201, JSON.stringify(ok.json)); assert.equal(ok.json.data.loaded, 2); assert.equal((await r.call(mgr, 'POST', '/opening-stock', { rows: [row()] })).status, 400, 'loaded once'); assert.equal((await r.call(sk, 'POST', '/opening-stock', { rows: [row({ itemCode: 'IV-STL' })] })).status, 403);
  const line = (await r.call(mgr, 'GET', `/balances?filter[itemCode]=IV-CEM`)).json.data[0]; const hold = await r.call(mgr, 'POST', '/inspection', { balanceId: line.id, action: 'HOLD', qty: 30 }); assert.equal(hold.status, 200, JSON.stringify(hold.json)); assert.deepEqual([hold.json.data.inspection, hold.json.data.available], [30, 70]);
  assert.equal((await r.post(mgr, { storeId: st.id, itemId: r.cement, type: 'ISSUE', qty: 80 })).status, 422, 'only 70 are free'); assert.equal((await r.call(mgr, 'POST', '/inspection', { balanceId: line.id, action: 'RELEASE', qty: 40 })).status, 422); assert.equal((await r.call(mgr, 'POST', '/inspection', { balanceId: line.id, action: 'RELEASE', qty: 30 })).json.data.available, 100);
  const rv = (await r.call(mgr, 'POST', '/reservations', { storeId: st.id, itemId: r.cement, qty: 40, sourceType: 'TRANSFER', sourceId: 'TR-7', neededBy: TODAY })).json.data; assert.equal((await r.call(mgr, 'GET', '/balances?filter[itemCode]=IV-CEM')).json.data[0].reserved, 40); const rel = await r.call(mgr, 'POST', `/reservations/${rv.id}/release`, { reason: 'The transfer was cancelled' }); assert.equal(rel.json.data.status, 'RELEASED'); assert.equal((await r.call(mgr, 'GET', '/balances?filter[itemCode]=IV-CEM')).json.data[0].reserved, 0);
  await r.drain(); const lv = r.d.prepare("SELECT free_qty FROM proc_stock_levels WHERE store_code = 'ST-O' AND item_id = ?").get(r.cement); assert.equal(lv?.free_qty, 100_000, 'the requisition sees the free stock of the store (15.01)');
});

test('FR-05 adjustments: a quantity correction and a revaluation are approved before they post; the maker never posts', async () => {
  const r = await ready(); const st = await r.store('ST-AD'); await r.post(mgr, { storeId: st.id, itemId: r.cement, type: 'RECEIPT', qty: 100, rate: 40 });
  const q = await r.call(sk, 'POST', '/adjustments', { storeId: st.id, type: 'QUANTITY', reason: 'Count found 3 bags short', lines: [{ itemId: r.cement, qtyDelta: -3 }] }); assert.equal(q.status, 201, JSON.stringify(q.json)); assert.equal(q.json.data.valueDelta, null, 'the keeper sees no value'); assert.equal(r.d.prepare('SELECT value_delta FROM inv_adjustments').get().value_delta, -12_000);
  const s = await r.call(sk, 'POST', `/adjustments/${q.json.data.id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); assert.equal((await r.call(mgr, 'GET', '/balances')).json.data[0].onHand, 100, 'nothing posted yet'); assert.equal((await r.act(mgr, s.json.data.workflowInstanceId)).status, 200);
  const a = (await r.call(mgr, 'GET', `/adjustments/${q.json.data.id}`)).json.data; assert.deepEqual([a.status, a.valueDelta], ['APPROVED', -12_000]); assert.equal((await r.call(mgr, 'GET', '/balances')).json.data[0].onHand, 97);
  const rev = await r.call(mgr, 'POST', '/adjustments', { storeId: st.id, type: 'REVALUATION', reason: 'The GRN rate was keyed wrong', lines: [{ itemId: r.cement, newRate: 42 }] }); assert.equal(rev.json.data.valueDelta, 19_400, '97 bags x ₹ 2'); const rs = await r.call(mgr, 'POST', `/adjustments/${rev.json.data.id}/submit`); assert.equal((await r.act(mgr2, rs.json.data.workflowInstanceId)).status, 200); assert.equal((await r.call(mgr, 'GET', `/adjustments/${rev.json.data.id}`)).json.data.status, 'SUBMITTED', 'the accounts manager is to approve'); assert.equal((await r.act(acc, rs.json.data.workflowInstanceId)).status, 200);
  const bal = (await r.call(mgr, 'GET', '/balances')).json.data[0]; assert.deepEqual([bal.onHand, bal.avgRate, bal.value], [97, 4200, 407_400]); const card = (await r.call(mgr, 'GET', `/ledger?itemId=${r.cement}&storeId=${st.id}`)).json.data; assert.equal(card.rows.at(-1).type, 'REVALUATION'); assert.deepEqual((await r.call(mgr, 'GET', '/integrity')).json.data.problems, []);
  const gain = await r.call(mgr, 'POST', '/adjustments', { storeId: st.id, type: 'QUANTITY', reason: 'Found stock not booked', lines: [{ itemId: r.cement, qtyDelta: 5, rate: 42 }] }); const gs = await r.call(mgr, 'POST', `/adjustments/${gain.json.data.id}/submit`); assert.equal((await r.call(mgr, 'POST', `/adjustments/${gain.json.data.id}/cancel`, { reason: 'Counted again: not needed' })).status, 200); void gs;
  assert.equal((await r.call(pm, 'POST', '/adjustments', { storeId: st.id, type: 'QUANTITY', reason: 'A project manager adjusts', lines: [{ itemId: r.cement, qtyDelta: 1 }] })).status, 403);
});

test('AC-03 who sees what: values are hidden from the keeper, procurement and accounts read, the dashboard counts and reorder, the flag switches it off', async () => {
  const r = await ready(); const st = await r.store('ST-D'); await r.post(mgr, { storeId: st.id, itemId: r.cement, type: 'RECEIPT', qty: 100, rate: 40 });
  const mine = (await r.call(sk, 'GET', '/balances')).json.data[0]; assert.deepEqual([mine.onHand, mine.avgRate, mine.value], [100, null, null]); assert.equal((await r.call(sk, 'GET', '/valuation')).status, 403); assert.equal((await r.call(sk2, 'GET', '/balances')).json.data.length, 0, 'not their store'); assert.equal((await r.post(sk2, { storeId: st.id, itemId: r.cement, type: 'ISSUE', qty: 1 })).status, 404);
  assert.equal((await r.post(sk, { storeId: st.id, itemId: r.cement, type: 'ISSUE', qty: 10 })).status, 201, 'the keeper issues from their store'); const ledger = (await r.call(sk, 'GET', `/ledger?itemId=${r.cement}`)).json.data; assert.equal(ledger.rows.every((x) => x.value === null && x.rate === null), true);
  for (const who of [pr, acc, pm]) assert.equal((await r.call(who, 'GET', '/balances')).json.data[0].value > 0, true, who.user); assert.equal((await r.call(pr, 'POST', '/movements', { storeId: st.id, itemId: r.cement, type: 'ISSUE', qty: 1, reason: 'Procurement posts' })).status, 403);
  const dash = (await r.call(mgr, 'GET', '/dashboard')).json.data; assert.deepEqual([dash.tiles.stores, dash.tiles.totalValue, dash.tiles.belowReorder, dash.tiles.integrityProblems], [1, 360_000, 1, 0]); assert.equal(dash.belowReorder[0].code, 'IV-CEM'); assert.equal(dash.byStore[0].value, 360_000); assert.equal(dash.ageing[0].value, 360_000); assert.equal(dash.recent.length, 2);
  const skDash = (await r.call(sk, 'GET', '/dashboard')).json.data; assert.deepEqual([skDash.tiles.totalValue, skDash.tiles.integrityProblems], [null, null]);
  assert.equal((await r.call(other, 'GET', '/balances')).json.data.length, 0, 'another company'); r.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.inv.p1601'").run(); for (const path of ['/dashboard', '/stores', '/balances']) assert.equal((await r.call(mgr, 'GET', path)).status, 404, path);
});
