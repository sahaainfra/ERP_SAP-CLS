import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { fill } from './qa-helpers.js';
import { setupCompany, startApi } from './helpers.js';

// Part 29.05: legacy data migration and opening balances.
// T-01 the trial balance after migration equals the legacy closing; the stock value is equal. FR-01 plan with owners and sequence; FR-02
// mapping workbook and cleansing; FR-03 trial loads with reconciliation, rolled back; FR-04 cut-over with freeze window, delta load and
// rollback point; FR-05 sign-off per object; BR-01 the final load only after two passed trials and the sign-off; section 9 owner → CFO.
const M = '/api/v1/admin/migration';
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `mig-${Date.now().toString(36)}-${(seq += 1)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const it = as('ITADM', 'mg-it'); const fin = as('FINEX', 'mg-fin'); const acc = as('ACCMGR', 'mg-acc'); const cfo = as('CFO', 'mg-cfo'); const sk = as('STOREMGR', 'mg-st'); const hr = as('HRMGR', 'mg-hr'); const hr2 = as('HRMGR', 'mg-hr2'); const aud = as('AUD', 'mg-aud'); const se = as('SE', 'mg-se');
const opened = []; after(async () => { for (const c of opened) await c(); });
const hour = (h) => new Date(Date.now() + h * 3_600_000).toISOString();

async function setup() {
  const api = await startApi(); opened.push(() => api.close()); await setupCompany(api); const db = api.db;
  for (const u of [it, fin, acc, cfo, sk, hr, hr2, aud, se]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(u.user, u.user, JSON.stringify([u.roles]), `${u.user}@example.com`);
  db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.admin.p2905', 1, 'Migration fixture', 0, 1)").run();
  const call = (who, method, path, body) => api.call(method, path, { ...who, headers: key(), body });
  assert.equal((await call(fin, 'GET', '/api/v1/fin/journals/options')).status, 200, 'the chart of accounts is set up');
  const plan = async (body) => { const r = await call(it, 'POST', `${M}/objects`, body); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.data; };
  const trial = (who, code, csv, controls) => call(who, 'POST', `${M}/objects/${code}/runs`, { type: 'TRIAL', csv, controls });
  return { api, db, call, plan, trial };
}

// the legacy closing trial balance, in the legacy system's own account codes
const LEGACY_TB = 'GL Code,Dr,Cr\nB-001,"12,50,000.00",\nC-001,25000.00,\nE-900,,"12,75,000.00"\n';
const MAP_TB = { rename: { 'GL Code': 'accountCode', Dr: 'debit', Cr: 'credit' }, upper: [], defaults: {}, values: { accountCode: { 'B-001': '150002', 'C-001': '150001', 'E-900': '320001' } }, dropBlank: ['accountCode'] };

test('T-01 FR-02 FR-03 FR-05 BR-01 the opening trial balance: mapped, two trial loads that leave nothing, signed off by the owner and the CFO, then loaded in the freeze; it ties out to the legacy closing', async () => {
  const t = await setup();
  const o = await t.plan({ code: 'OB-TB', name: 'Opening trial balance', kind: 'OPENING_TB', phase: 'BALANCES', sequence: 10, ownerRole: 'ACCMGR' });
  assert.deepEqual([o.status, o.financial, o.trialsNeeded], ['PLANNED', true, 2]);
  assert.equal((await t.call(se, 'GET', M)).status, 403); assert.equal((await t.call(fin, 'POST', `${M}/objects`, { code: 'X1', name: 'Not lead', kind: 'OPENING_TB', phase: 'BALANCES', sequence: 1, ownerRole: 'ACCMGR' })).status, 403);
  // without the mapping the legacy codes are not accounts: the trial fails and names them
  const raw = (await t.trial(fin, 'OB-TB', LEGACY_TB)).json.data;
  assert.equal(raw.status, 'FAILED'); assert.ok(raw.problems.length > 0);
  assert.equal((await t.call(it, 'PUT', `${M}/objects/OB-TB/mapping`, MAP_TB)).json.data.mappingVersion, 2);
  assert.equal((await t.api.raw('GET', `${M}/objects/OB-TB/mapping/export`, it)).status, 200);
  const journals = () => t.db.prepare("SELECT COUNT(*) AS n FROM fin_journals WHERE company_id = 1 AND kind = 'OPENING'").get().n;
  const legacyControls = { totalDebit: '1275000.00', totalCredit: '1275000.00', tb: [{ accountCode: '150002', debit: '1250000.00', credit: '' }, { accountCode: '150001', debit: '25000.00', credit: '' }, { accountCode: '320001', debit: '', credit: '1275000.00' }] };
  for (let i = 0; i < 2; i += 1) {
    const r = await t.trial(fin, 'OB-TB', LEGACY_TB, legacyControls);
    assert.equal(r.status, 201, JSON.stringify(r.json)); assert.equal(r.json.data.status, 'PASSED', JSON.stringify(r.json.data));
    assert.ok(r.json.data.reconciliation.every((x) => x.ok)); assert.equal(journals(), 0, 'a trial load leaves nothing behind');
  }
  // a trial against a legacy report that differs fails its reconciliation
  const off = (await t.trial(fin, 'OB-TB', LEGACY_TB, { ...legacyControls, tb: [{ accountCode: '150002', debit: '1240000.00', credit: '' }, ...legacyControls.tb.slice(1)] })).json.data;
  assert.equal(off.status, 'FAILED'); assert.ok(off.reconciliation.some((x) => !x.ok && x.check === 'Account 150002'));
  // BR-01: no final load before sign-off; sign-off needs two passed trials; owner then CFO
  assert.equal((await t.call(fin, 'POST', `${M}/objects/OB-TB/runs`, { type: 'FINAL', csv: LEGACY_TB, controls: legacyControls })).status, 422);
  const so = await t.call(it, 'POST', `${M}/objects/OB-TB/sign-off`, { reason: 'Two clean trials against the March closing' });
  assert.equal(so.status, 200, JSON.stringify(so.json)); assert.equal(so.json.data.status, 'SIGNOFF');
  assert.notEqual((await t.call(cfo, 'POST', `${M}/objects/OB-TB/sign-off/act`, { action: 'approve' })).status, 200, 'the CFO signs after the owner');
  assert.equal((await t.call(acc, 'POST', `${M}/objects/OB-TB/sign-off/act`, { action: 'approve', comment: 'Ties to the audited closing' })).json.data.status, 'SIGNOFF');
  assert.equal((await t.call(cfo, 'POST', `${M}/objects/OB-TB/sign-off/act`, { action: 'approve', comment: 'Agreed' })).json.data.status, 'SIGNED_OFF');
  // FR-04: the final load runs only in the freeze window
  assert.match((await t.call(fin, 'POST', `${M}/objects/OB-TB/runs`, { type: 'FINAL', csv: LEGACY_TB, controls: legacyControls })).json.error.message, /freeze window/);
  const cut = (await t.call(it, 'POST', `${M}/cutovers`, { name: 'Go-live April', freezeFrom: hour(-1), freezeTo: hour(24), rollbackPoint: 'Database backup taken before the freeze; legacy stays read-only' })).json.data;
  assert.equal(cut.steps.length, 8);
  assert.equal((await t.call(it, 'POST', `${M}/cutovers/${cut.id}/status`, { status: 'FROZEN' })).json.data.status, 'FROZEN');
  assert.equal((await t.call(it, 'POST', `${M}/cutovers/${cut.id}/steps/1`, { done: true, note: 'Legacy locked at 18:00' })).json.data.steps[0].done, true);
  const fl = await t.call(fin, 'POST', `${M}/objects/OB-TB/runs`, { type: 'FINAL', csv: LEGACY_TB, controls: legacyControls });
  assert.equal(fl.status, 201, JSON.stringify(fl.json)); assert.equal(fl.json.data.status, 'LOADED');
  // T-01: the migrated trial balance equals the legacy closing, account by account
  const tb = t.db.prepare("SELECT a.code, SUM(l.debit_paise) - SUM(l.credit_paise) AS net FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id JOIN fin_accounts a ON a.id = l.account_id WHERE j.company_id = 1 AND j.kind = 'OPENING' GROUP BY a.code ORDER BY a.code").all().map((r) => [r.code, r.net]);
  assert.deepEqual(tb, [['150001', 2_500_000], ['150002', 125_000_000], ['320001', -127_500_000]]);
  assert.equal((await t.call(aud, 'GET', `${M}/objects/OB-TB`)).json.data.status, 'LOADED');
  assert.equal((await t.call(fin, 'POST', `${M}/objects/OB-TB/runs`, { type: 'TRIAL', csv: LEGACY_TB })).status, 409, 'a loaded object takes no more trials');
});

test('T-01 FR-01 FR-04 opening stock equals the legacy value; the plan sequence; a failing final load is rolled back; a delta load skips what exists', async () => {
  const t = await setup();
  t.db.exec('PRAGMA foreign_keys = OFF');
  fill(t.db, 'inv_stores', { company_id: 1, code: 'ST-HO', name: 'Central store', status: 'APPROVED', store_status: 'ACTIVE' });
  for (const c of ['CEM-53', 'TMT-12']) fill(t.db, 'mdm_items', { company_id: 1, code: c, name: c, base_uom: 'NOS', status: 'APPROVED', stock_tracked: 1 });
  t.db.exec('PRAGMA foreign_keys = ON');
  const stock = 'Store,Item,Qty,Rate\nst-ho,OPC53,200,385.50\nst-ho,FE500-12,1500.5,62.25\n';
  await t.plan({ code: 'OB-STOCK', name: 'Opening stock', kind: 'OPENING_STOCK', phase: 'BALANCES', sequence: 20, ownerRole: 'STOREMGR' });
  const des = await t.plan({ code: 'DESIG', name: 'Designations', kind: 'TEMPLATE:ORG_DESIGNATION', phase: 'MASTERS', sequence: 1, ownerRole: 'HRMGR' });
  assert.equal(des.financial, false); assert.equal((await t.call(it, 'POST', `${M}/objects`, { code: 'BAD-PHASE', name: 'Stock in masters', kind: 'OPENING_STOCK', phase: 'MASTERS', sequence: 2, ownerRole: 'STOREMGR' })).status, 422);
  await t.call(it, 'PUT', `${M}/objects/OB-STOCK/mapping`, { rename: { Store: 'storeCode', Item: 'itemCode', Qty: 'qty', Rate: 'rate' }, upper: ['storeCode'], defaults: {}, values: { itemCode: { OPC53: 'CEM-53', 'FE500-12': 'TMT-12' } }, dropBlank: [] });
  const value = '170506.13'; // 200 × 385.50 + 1500.5 × 62.25 = 77,100.00 + 93,406.13
  for (let i = 0; i < 2; i += 1) { const res = await t.trial(sk, 'OB-STOCK', stock, { stockValue: value }); assert.equal(res.status, 201, JSON.stringify(res.json)); assert.equal(res.json.data.status, 'PASSED', JSON.stringify(res.json.data)); }
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM inv_stock_ledger').get().n, 0, 'trials leave no stock');
  await t.call(it, 'POST', `${M}/objects/OB-STOCK/sign-off`, { reason: 'Stock counted and valued at March' });
  assert.equal((await t.call(sk, 'POST', `${M}/objects/OB-STOCK/sign-off/act`, { action: 'approve', comment: 'Count sheets agree' })).json.data.status, 'SIGNOFF');
  assert.equal((await t.call(cfo, 'POST', `${M}/objects/OB-STOCK/sign-off/act`, { action: 'approve' })).json.data.status, 'SIGNED_OFF');
  const cut = (await t.call(it, 'POST', `${M}/cutovers`, { name: 'Go-live', freezeFrom: hour(-1), freezeTo: hour(12), rollbackPoint: 'Backup before the freeze' })).json.data;
  await t.call(it, 'POST', `${M}/cutovers/${cut.id}/status`, { status: 'FROZEN' });
  // FR-01: the masters phase comes first
  assert.match((await t.call(sk, 'POST', `${M}/objects/OB-STOCK/runs`, { type: 'FINAL', csv: stock, controls: { stockValue: value } })).json.error.message, /earlier phase first: Designations/);
  t.db.prepare("UPDATE mig_objects SET status = 'LOADED' WHERE code = 'DESIG'").run();
  // the rollback point: a final load whose reconciliation fails keeps nothing
  const bad = (await t.call(sk, 'POST', `${M}/objects/OB-STOCK/runs`, { type: 'FINAL', csv: stock, controls: { stockValue: '170000.00' } })).json.data;
  assert.equal(bad.status, 'ROLLED_BACK'); assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM inv_stock_ledger').get().n, 0);
  const good = (await t.call(sk, 'POST', `${M}/objects/OB-STOCK/runs`, { type: 'FINAL', csv: stock, controls: { stockValue: value } })).json.data;
  assert.equal(good.status, 'LOADED', JSON.stringify(good));
  // T-01: the stock value in the ledger equals the legacy value
  assert.equal(t.db.prepare("SELECT SUM(value) AS v FROM inv_stock_ledger WHERE txn_type = 'OPENING'").get().v, 17_050_613);
  // a delta load on a template object skips what exists
  t.db.prepare("UPDATE mig_objects SET status = 'SIGNED_OFF' WHERE code = 'DESIG'").run();
  for (let i = 0; i < 2; i += 1) t.db.prepare("INSERT INTO mig_runs (company_id, object_code, environment, run_type, status, mapping_version, input_hash, started_at) VALUES (1, 'DESIG', 'TRIAL', 'TRIAL', 'PASSED', 1, 'x', '2026-11-01')").run();
  const csv = 'code,name,level\nMG-SE,Site Engineer,3\nMG-PM,Project Manager,8\n';
  assert.equal((await t.call(hr, 'POST', `${M}/objects/DESIG/runs`, { type: 'FINAL', csv })).json.data.status, 'LOADED');
  const delta = (await t.call(hr, 'POST', `${M}/objects/DESIG/runs`, { type: 'FINAL', csv: `${csv}MG-QS,Quantity Surveyor,4\n`, delta: true })).json.data;
  assert.deepEqual([delta.status, delta.mode, delta.detail.created, delta.detail.skipped], ['LOADED', 'DELTA', 1, 2]);
  const board = (await t.call(aud, 'GET', M)).json.data;
  assert.deepEqual(board.rows.map((r) => r.code), ['DESIG', 'OB-STOCK']); assert.equal(board.totals.loaded, 2); assert.equal(board.cutover.status, 'FROZEN');
  assert.equal((await t.call(aud, 'POST', `${M}/objects/DESIG/runs`, { type: 'TRIAL', csv })).status, 403);
});
