import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import '../src/server/modules/registry.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { fill } from './qa-helpers.js';
import { setupCompany, startApi } from './helpers.js';

// Part 29.02: business connectors on the integration hub.
// T-01 a bank statement sync matches transactions, and biometric duplicates are de-duplicated; FR-01 penny-drop; FR-02 Tally export with
// approved mappings and reconciliation; FR-03 punches into attendance through its own service (BR-01); FR-05 telematics; FR-07 health, logs,
// runs and errors; section 8: ITADM configures, ACCMGR/HRMGR approve mappings; mappings are used only once approved.
const A = '/api/v1/admin/connectors';
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `con-${Date.now().toString(36)}-${(seq += 1)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const it = as('ITADM', 'con-it'); const acc = as('ACCMGR', 'con-acc'); const hr = as('HRMGR', 'con-hr'); const plm = as('PLANTMGR', 'con-plm'); const se = as('SE', 'con-se'); const aud = as('AUD', 'con-aud');
const opened = []; after(async () => { for (const c of opened) await c(); });
const today = new Date().toISOString().slice(0, 10);
const ddmmyyyy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** The connected systems: a bank, a biometric bridge and a telematics provider, all answering over HTTP. */
function systems(state) {
  return createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
    const body = JSON.parse(b || '{}'); res.setHeader('content-type', 'application/json'); state.calls.push({ path: req.url, body });
    if (req.url === '/statements') return res.end(JSON.stringify({ format: 'CSV', content: state.statement }));
    if (req.url === '/penny-drop') return res.end(JSON.stringify({ valid: body.accountNo !== '000000000', nameAtBank: body.accountNo === '111122223333' ? 'SHREE CEMENT TRADERS PVT LTD' : 'SOMEONE ELSE', utr: 'PD1' }));
    if (req.url === '/punches') return res.end(JSON.stringify({ punches: state.punches }));
    if (req.url === '/readings') return res.end(JSON.stringify({ readings: state.readings }));
    res.statusCode = 404; return res.end('{}');
  }); });
}

async function setup() {
  const state = { calls: [], statement: '', punches: [], readings: [] };
  const srv = systems(state); await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`;
  const api = await startApi(); opened.push(async () => { await api.close(); srv.close(); }); await setupCompany(api); const db = api.db;
  for (const [n, r] of [['con-it', 'ITADM'], ['con-acc', 'ACCMGR'], ['con-hr', 'HRMGR'], ['con-plm', 'PLANTMGR'], ['con-se', 'SE'], ['con-aud', 'AUD']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify([r]), `${n}@example.com`);
  db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.admin.p2902', 1, 'Connectors fixture', 0, 1)").run();
  const project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'CN-1', 'Ring road', 'ROAD', 'ACTIVE')").run().lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name) VALUES (1, ?, 'CN-S1', 'Ring road site')").run(project).lastInsertRowid);
  db.exec('PRAGMA foreign_keys = OFF');
  const conn = db.prepare("INSERT INTO core_connectors (company_id, code, name, type, provider, environment, config_json, status) VALUES (1, ?, ?, ?, ?, 'development', ?, 'ENABLED')");
  conn.run('bank.sbi', 'SBI host-to-host', 'bank', 'bank_http', JSON.stringify({ baseUrl: base, corporateId: 'CORP1' }));
  conn.run('bio.site1', 'Site 1 devices', 'biometric', 'biometric_http', JSON.stringify({ baseUrl: base, siteId: site }));
  conn.run('gps.fleet', 'Fleet GPS', 'maps', 'telematics_http', JSON.stringify({ baseUrl: base }));
  const gl = fill(db, 'fin_accounts', { company_id: 1, code: '1201', name: 'SBI current account', account_type: 'BANK', normal_side: 'DR' });
  const exp = fill(db, 'fin_accounts', { company_id: 1, code: '5101', name: 'Cement consumed', account_type: 'EXPENSE', normal_side: 'DR' });
  const bank = fill(db, 'fin_bank_accounts', { company_id: 1, code: 'SBI-CA', name: 'SBI current', bank_name: 'SBI', ifsc: 'SBIN0001234', account_no_enc: 'enc', account_last4: '4321', gl_account_id: gl });
  // the books: a payment of ₹ 1,18,000 released today with its UTR
  fill(db, 'pmt_payments', { company_id: 1, doc_no: 'PAY-1', proposal_id: 1, line_id: 1, partner_id: 1, payee_name: 'Shree Cement', pay_mode: 'NEFT', bank_account_id: bank, amount_paise: 11_800_000, released_on: today, paid_on: today, utr: 'UTR77', pay_status: 'PAID' });
  // two approved journals, one with an unmapped account
  const j1 = fill(db, 'fin_journals', { company_id: 1, doc_no: 'JV/1', voucher_type: 'JV', voucher_no: 'JV/1', voucher_date: today, kind: 'MANUAL', narration: 'Cement consumed', total_paise: 500_000, status: 'APPROVED', posted_at: today });
  fill(db, 'fin_journal_lines', { company_id: 1, journal_id: j1, line_no: 1, account_id: exp, debit_paise: 500_000, credit_paise: 0 });
  fill(db, 'fin_journal_lines', { company_id: 1, journal_id: j1, line_no: 2, account_id: gl, debit_paise: 0, credit_paise: 500_000 });
  const other = fill(db, 'fin_accounts', { company_id: 1, code: '9999', name: 'Suspense', account_type: 'GENERAL', normal_side: 'DR' });
  const j2 = fill(db, 'fin_journals', { company_id: 1, doc_no: 'JV/2', voucher_type: 'JV', voucher_no: 'JV/2', voucher_date: today, kind: 'MANUAL', narration: 'Suspense', total_paise: 1000, status: 'APPROVED', posted_at: today });
  fill(db, 'fin_journal_lines', { company_id: 1, journal_id: j2, line_no: 1, account_id: other, debit_paise: 1000, credit_paise: 0 });
  fill(db, 'fin_journal_lines', { company_id: 1, journal_id: j2, line_no: 2, account_id: gl, debit_paise: 0, credit_paise: 1000 });
  // an employee who punches at the site, and a machine with a tracker
  fill(db, 'hr_employees', { company_id: 1, emp_code: 'E-101', first_name: 'Ravi', full_name: 'Ravi Kumar', gender: 'MALE', dob: '1990-01-01', mobile: '9000000001', employment_type: 'PERMANENT', doj: '2024-01-01', record_status: 'APPROVED', project_id: project });
  fill(db, 'plt_equipment', { company_id: 1, doc_no: 'EQ-1', asset_code: 'EXC-07', class_item_id: 1, requested_by: 'plant', status: 'APPROVED' });
  db.exec('PRAGMA foreign_keys = ON');
  const call = (who, method, path, body) => api.call(method, path, { ...who, headers: key(), body });
  const approveMapping = async (who, proposed) => { const r = await call(who, 'POST', `${A}/mappings/requests/${proposed.requestId}/act`, { action: 'approve', comment: 'Checked' }); assert.equal(r.status, 200, JSON.stringify(r.json)); };
  return { api, db, call, state, bank, site, approveMapping };
}

test('T-01 FR-01 the bank statement sync reaches 23.06 and matches the payment; a second sync takes nothing twice; penny-drop compares the name', async () => {
  const t = await setup();
  t.state.statement = ['Txn Date,Narration,Ref No,Debit,Credit,Balance', `${ddmmyyyy(today)},NEFT SHREE CEMENT,UTR77,"1,18,000.00",,"8,82,000.00"`, `${ddmmyyyy(today)},BANK CHARGES,,59.00,,"8,81,941.00"`].join('\n');
  assert.equal((await t.call(it, 'POST', `${A}/bank.sbi/bank-statement`, { bankAccountId: t.bank, from: today, to: today })).json.data.status, 'FAILED', 'IT may run it, but the import needs the finance right (BR-01)');
  const r = await t.call(acc, 'POST', `${A}/bank.sbi/bank-statement`, { bankAccountId: t.bank, from: today, to: today });
  assert.equal(r.status, 201, JSON.stringify(r.json)); const run = r.json.data;
  assert.deepEqual([run.status, run.detail.lines, run.detail.matched, run.detail.unmatched], ['SUCCEEDED', 2, 1, 1], JSON.stringify(run.detail));
  assert.equal(t.db.prepare("SELECT match_status FROM fin_bank_statements WHERE ref = 'UTR77'").get().match_status, 'AUTO');
  const again = (await t.call(acc, 'POST', `${A}/bank.sbi/bank-statement`, { bankAccountId: t.bank, from: today, to: today })).json.data;
  assert.deepEqual([again.detail.lines, again.detail.duplicates], [0, 2], 'lines seen before are not taken twice');
  assert.equal(t.state.calls.find((c) => c.path === '/statements').body.accountRef, 'SBI-CA', 'the bank is asked by account code, never the stored number');
  assert.ok(t.db.prepare("SELECT 1 FROM core_integration_logs WHERE operation = 'fetchStatement' AND status = 'success'").get(), 'the hub logs the call');
  const ok = (await t.call(acc, 'POST', `${A}/bank.sbi/validate-account`, { ifsc: 'HDFC0000123', accountNo: '111122223333', name: 'Shree Cement Traders Pvt Ltd' })).json.data;
  assert.deepEqual([ok.status, ok.detail.valid, ok.detail.nameScore], ['SUCCEEDED', true, 100]);
  const bad = (await t.call(acc, 'POST', `${A}/bank.sbi/validate-account`, { ifsc: 'HDFC0000123', accountNo: '555566667777', name: 'Shree Cement Traders Pvt Ltd' })).json.data;
  assert.equal(bad.status, 'FAILED'); assert.match(bad.problems[0].message, /does not match/);
  assert.equal((await t.call(se, 'POST', `${A}/bank.sbi/validate-account`, { ifsc: 'HDFC0000123', accountNo: '111122223333', name: 'x y' })).status, 403);
  // section 9: a bank connector whose activation (ITADM → CFO in the hub) is not yet approved cannot be synced
  t.db.prepare("INSERT INTO core_connectors (company_id, code, name, type, provider, environment, config_json, status) VALUES (1, 'bank.hdfc', 'HDFC', 'bank', 'bank_http', 'development', '{}', 'PENDING')").run();
  const pending = await t.call(acc, 'POST', `${A}/bank.hdfc/bank-statement`, { bankAccountId: t.bank, from: today, to: today });
  assert.equal(pending.status, 422); assert.match(pending.json.error.message, /activation needs approval/);
});

test('T-01 FR-03 BR-01 biometric punches go through attendance: mapped device users, a punch pulled twice stored once', async () => {
  const t = await setup();
  // device user 17 is employee E-101 — used only once the HR manager approves the mapping
  const m = (await t.call(it, 'POST', `${A}/mappings`, { connector: 'bio.site1', entity: 'biometric_user', internal: 'E-101', external: '17', reason: 'Enrolled on the gate device' })).json.data;
  assert.equal(m.status, 'PENDING'); assert.equal(m.approver, 'HRMGR');
  assert.equal((await t.call(it, 'POST', `${A}/mappings/requests/${m.requestId}/act`, { action: 'approve', comment: 'self' })).status !== 200, true, 'IT cannot approve its own mapping');
  const at = `${today}T08:01:00+05:30`;
  t.state.punches = [{ logId: 'L1', userCode: '17', time: at, direction: 'IN', deviceSerial: 'ZK-1' }, { logId: 'L1', userCode: '17', time: at, direction: 'IN', deviceSerial: 'ZK-1' }, { logId: 'L2', userCode: '99', time: at, direction: 'IN', deviceSerial: 'ZK-1' }];
  const before = (await t.call(hr, 'POST', `${A}/bio.site1/biometric`, { since: `${today}T00:00:00Z` })).json.data;
  assert.equal(before.errors, 3, 'no approved mapping yet: device codes are not employee codes');
  await t.approveMapping(hr, m);
  const run = (await t.call(hr, 'POST', `${A}/bio.site1/biometric`, { since: `${today}T00:00:00Z` })).json.data;
  assert.deepEqual([run.detail.pulled, run.detail.stored + run.detail.refusedByRules, run.detail.replayed, run.errors], [3, 1, 1, 1], JSON.stringify(run));
  assert.match(run.problems[0].message, /not known/);
  assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM att_punches WHERE method = 'DEVICE'").get().n, 1, 'T-01: the duplicate is not stored');
  const again = (await t.call(hr, 'POST', `${A}/bio.site1/biometric`, { since: `${today}T00:00:00Z` })).json.data;
  assert.equal(again.detail.replayed, 2); assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM att_punches WHERE method = 'DEVICE'").get().n, 1);
});

test('FR-02 FR-05 FR-07 Tally export with approved mappings and reconciliation; telematics; health, runs and roles', async () => {
  const t = await setup();
  for (const [internal, external] of [['SBI Current A/c', '1201'], ['Cement Consumption', '5101']]) {
    const m = (await t.call(it, 'POST', `${A}/mappings`, { connector: 'ACCOUNTING_EXPORT', entity: 'gl_account', internal, external, reason: 'Ledger names in Tally' })).json.data;
    assert.equal(m.approver, 'ACCMGR'); await t.approveMapping(acc, m);
  }
  const ex = await t.call(acc, 'POST', `${A}/accounting-export`, { from: today, to: today, companyName: 'Main Infra' });
  assert.equal(ex.status, 201, JSON.stringify(ex.json)); const run = ex.json.data;
  assert.deepEqual([run.status, run.detail.journals, run.detail.exported, run.detail.debit, run.detail.credit, run.detail.balanced], ['PARTIAL', 2, 1, '5000.00', '5000.00', true]);
  assert.match(run.problems[0].message, /9999 Suspense has no approved Tally ledger mapping/);
  const file = await t.api.raw('GET', `${A}/runs/${run.id}/output`, acc); assert.equal(file.status, 200);
  const x = file.buffer.toString('utf8');
  assert.match(x, /<LEDGERNAME>Cement Consumption<\/LEDGERNAME><ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE><AMOUNT>-5000.00<\/AMOUNT>/);
  assert.match(x, /<LEDGER NAME="SBI Current A\/c" ACTION="Create">/); assert.match(x, /<SVCURRENTCOMPANY>Main Infra<\/SVCURRENTCOMPANY>/);
  assert.equal((await t.call(it, 'POST', `${A}/accounting-export`, { from: today, to: today })).status, 403, 'IT does not export the books');
  // telematics: the tracker id mapped to the asset code
  const m = (await t.call(it, 'POST', `${A}/mappings`, { connector: 'gps.fleet', entity: 'equipment', internal: 'EXC-07', external: 'TRK-555', reason: 'Tracker fitted on the excavator' })).json.data; await t.approveMapping(plm, m);
  t.state.readings = [{ trackerId: 'TRK-555', timestamp: `${today}T06:00:00Z`, lat: 17.4, lng: 78.5, engineHours: 1204.5, ignition: true, fuelLevel: 60 }];
  const tel = (await t.call(plm, 'POST', `${A}/gps.fleet/telematics`, { since: `${today}T00:00:00Z` })).json.data;
  assert.equal(tel.status, 'SUCCEEDED', JSON.stringify(tel)); assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM plt_telematics').get().n, 1);
  // FR-07: the list with health, the runs report and its export; roles
  const l = (await t.call(it, 'GET', A)).json.data; const bank = l.rows.find((c) => c.code === 'bank.sbi');
  assert.deepEqual([bank.health, l.canConfigure], ['UNKNOWN', true]); assert.equal(l.rows.find((c) => c.code === 'gps.fleet').health, 'HEALTHY');
  const runs = (await t.call(aud, 'GET', `${A}/runs`)).json.data; assert.ok(runs.total >= 2);
  assert.equal((await t.api.raw('GET', `${A}/runs/export?format=csv`, aud)).status, 200);
  assert.equal((await t.call(aud, 'POST', `${A}/mappings`, { connector: 'gps.fleet', entity: 'equipment', internal: 'X', external: 'Y', reason: 'auditor may not' })).status, 403);
  assert.equal((await t.call(se, 'GET', A)).status, 403);
  const dup = await t.call(it, 'POST', `${A}/mappings`, { connector: 'gps.fleet', entity: 'equipment', internal: 'EXC-08', external: 'TRK-556', reason: 'second tracker' });
  assert.equal((await t.call(it, 'POST', `${A}/mappings`, { connector: 'gps.fleet', entity: 'equipment', internal: 'EXC-09', external: 'TRK-556', reason: 'same tracker again' })).status, 409, JSON.stringify(dup.json));
  // volume: 100,000 runs list fast
  t.db.exec('BEGIN'); const ins = t.db.prepare("INSERT INTO int_sync_runs (company_id, connector_code, kind, direction, started_at, status) VALUES (1, 'bio.site1', 'BIOMETRIC', 'INBOUND', '2026-11-01T00:00:00Z', 'SUCCEEDED')");
  for (let i = 0; i < 100_000; i += 1) ins.run(); t.db.exec('COMMIT');
  const t0 = performance.now(); const v = await t.call(aud, 'GET', `${A}/runs?connector=bio.site1&pageSize=25`); assert.equal(v.status, 200); assert.ok(performance.now() - t0 < 500);
  void runtimeOf;
});
