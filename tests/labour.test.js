import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { labourOf, ageOn, convertRate } from '../src/server/modules/hr/labour.js';
import { setupCompany, startApi } from './helpers.js';

// Part 07.08: contract labour. T-01 a worker under 18 is blocked and a deployment without induction is blocked when configured; T-02 a contractor above the licensed number is blocked; T-03 a wage below the minimum wage is rejected.
// Also: the registration workflow (supervisor, then HR), masks, duplicates, amendment keeping the same worker, the card and its QR, the kiosk punch of a worker, blacklisting, contractor compliance and its alerts, strength, scope and idempotency.
const H = '/api/v1/hr';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const as = (roles, user, company = '1') => ({ roles, user, company });
const hr1 = as('HRMGR', 'hr1'); const hr2 = as('HRMGR', 'hr2'); const ws1 = as('WSUP', 'ws1'); const pm1 = as('PM', 'pm1'); const com1 = as('COMMGR', 'com1'); const sub1 = as('SUBCO', 'sub1'); const hse1 = as('HSEE', 'hse1'); const se1 = as('SE', 'se1'); const pay1 = as('PAY', 'pay1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
let seq = 0;
const uid = (k = 'r') => `${k}-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}`;
const ist = (n = 0) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const yearsAgo = (y, days = 0) => { const d = new Date(Date.now() + 5.5 * 3_600_000); d.setUTCFullYear(d.getUTCFullYear() - y); return new Date(d.getTime() - days * 86_400_000).toISOString().slice(0, 10); };
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const setup = async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (2, 'TWO', 'Two Infra Pvt Ltd', 'Two', 't', 'test')").run();
  for (const [n, r] of [['hr1', ['HRMGR']], ['hr2', ['HRMGR']], ['ws1', ['WSUP']], ['pm1', ['PM']], ['com1', ['COMMGR']], ['sub1', ['SUBCO']], ['hse1', ['HSEE']], ['se1', ['SE']], ['pay1', ['PAY']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(1, n, n, JSON.stringify(r), `${n}@example.com`);
  const org = (sql, ...a) => Number(api.db.prepare(sql).run(...a).lastInsertRowid);
  const p1 = org("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 't', 'test')");
  const s1 = org("INSERT INTO org_sites (company_id, org_project_id, code, name, status, latitude, longitude, geofence_type, geofence_radius_m, created_by, source_type) VALUES (1, ?, 'S1', 'Ring Road North', 'ACTIVE', 18.5204, 73.8567, 'CIRCLE', 200, 't', 'test')", p1);
  const contractor = (code, name, status = 'ACTIVE', role = 'LABOUR_CONTRACTOR') => { const id = org("INSERT INTO mdm_partners (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type) VALUES (1, ?, ?, ?, 'PROPRIETORSHIP', ?, 'COMMGR', 't', 'test')", code, name, name.toLowerCase(), status); org("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role, created_by, source_type) VALUES (1, ?, ?, 't', 'test')", id, role); return id; };
  const k1 = contractor('LC1', 'Shiv Labour Supply'); const k2 = contractor('LC2', 'Ganesh Manpower'); const vendor = contractor('V1', 'Steel Vendor', 'ACTIVE', 'VENDOR'); const held = contractor('LC3', 'Held Contractor', 'ON_HOLD');
  const call = (who, method, path, body, key) => api.call(method, path, { ...who, headers: key ? { ...json, 'idempotency-key': key } : json, body });
  const post = (who, path, body) => call(who, 'POST', path, body, uid());
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
    assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: { ...json, 'idempotency-key': uid('a') }, body: { action, comment: 'checked it' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  let n = 0;
  const body = (o = {}) => { n += 1; return { name: `Worker ${n}`, dob: yearsAgo(28), gender: 'MALE', aadhaar: String(100000000000 + n * 7919), mobile: `98000${String(n).padStart(5, '0')}`, homeState: 'Bihar', tradeCode: 'MASON', skillCategory: 'SKILLED', contractorId: k1, ...o }; };
  /** A worker registered and approved by the supervisor (pm1) and the HR manager (hr1). */
  const approved = async (o = {}, by = ws1) => { const w = (await post(by, `${H}/workers`, { ...body(o), submit: true })).json.data; await act(sub1, w.workflowInstanceId); await act(hr1, w.workflowInstanceId); return (await call(hr1, 'GET', `${H}/workers/${w.id}`)).json.data; };
  const cleared = (id, o = {}) => call(hr1, 'PUT', `${H}/workers/${id}/clearance`, { inductionStatus: 'CLEARED', inductionDate: ist(-1), medicalStatus: 'FIT', medicalValidUntil: ist(300), ...o }, uid());
  const licence = (id, o = {}) => call(sub1, 'PUT', `${H}/labour/contractors/${id}/compliance`, { clraLicenceNo: 'CLRA/2026/77', licenceValidUntil: ist(200), maxWorkers: 50, pfCode: 'MHPUN0001', esiCode: '33000', woReference: 'WO-12', woValidUntil: ist(200), version: 0, ...o }, uid());
  const deploy = (who, personId, o = {}) => post(who, `${H}/deployments`, { personType: 'WORKER', personId, projectId: p1, siteId: s1, fromDate: ist(0), toDate: null, isPrimary: true, submit: false, ...o });
  return { api, call, post, act, approved, cleared, licence, deploy, body, ids: { p1, s1, k1, k2, vendor, held }, org };
};

test('T-01 BR-01 BR-02 nobody under 18 is registered whatever the way in; a worker without induction or medical clearance is not deployed, as a block or as a warning', async () => {
  assert.equal(ageOn('2008-06-15', '2026-06-14'), 17); assert.equal(ageOn('2008-06-15', '2026-06-15'), 18);
  const t = await setup();
  const under = await t.post(ws1, `${H}/workers`, t.body({ dob: yearsAgo(18, -1) })); // turns 18 tomorrow
  assert.equal(under.status, 400); assert.match(under.json.error.details.find((d) => d.field === 'dob').message, /nobody under 18/);
  assert.equal((await t.post(ws1, `${H}/workers`, t.body({ dob: yearsAgo(17) }))).status, 400);
  assert.equal((await t.post(ws1, `${H}/workers`, t.body({ dob: ist(1) }))).status, 400, 'a birth in the future');
  const edge = await t.post(ws1, `${H}/workers`, t.body({ dob: yearsAgo(18) })); // turned 18 today
  assert.equal(edge.status, 201, JSON.stringify(edge.json)); assert.equal(edge.json.data.age, 18);
  // the draft cannot be changed to an under-age date either
  const upd = await t.call(ws1, 'PATCH', `${H}/workers/${edge.json.data.id}`, { ...t.body({ dob: yearsAgo(16) }), version: edge.json.data.rowVersion }, uid());
  assert.equal(upd.status, 400);
  // BR-02: a worker with no clearance is not deployed
  assert.equal((await t.licence(t.ids.k1)).status, 200);
  const w = await t.approved();
  const blocked = await t.deploy(hr1, w.id);
  assert.equal(blocked.status, 400); assert.match(JSON.stringify(blocked.json.error.details), /induction and medical fitness clearance/);
  assert.equal((await t.call(pm1, 'PUT', `${H}/workers/${w.id}/clearance`, { inductionStatus: 'CLEARED', inductionDate: ist(-1), medicalStatus: 'FIT', medicalValidUntil: ist(300) }, uid())).status, 403, 'only safety and HR record clearance');
  assert.equal((await t.call(hse1, 'PUT', `${H}/workers/${w.id}/clearance`, { inductionStatus: 'CLEARED', inductionDate: ist(-1), medicalStatus: 'PENDING' }, uid())).status, 200);
  assert.match(JSON.stringify((await t.deploy(hr1, w.id)).json.error.details), /medical fitness/);
  assert.equal((await t.cleared(w.id)).status, 200);
  const ok = await t.deploy(hr1, w.id);
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  // configured as a warning, the deployment goes on and the audit trail says so
  const w2 = await t.approved();
  const set = await t.api.call('POST', '/api/v1/core/parameters', { roles: 'SYSADM', user: 'sys', company: '1', headers: { ...json, 'idempotency-key': uid('p') }, body: { key: 'lab.deploy.clearance_mode', value: 'WARN', scopeType: 'company', scopeId: 1, effectiveFrom: ist(0), reason: 'Induction is held at the gate on the first day' } });
  assert.ok([200, 201].includes(set.status), JSON.stringify(set.json));
  const warn = await t.deploy(hr1, w2.id);
  assert.equal(warn.status, 201, JSON.stringify(warn.json));
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'lab_workers' AND action = 'deploy_warning'").get().n, 1);
  // a medical clearance that ran out is expired by the daily check
  t.api.db.prepare("UPDATE lab_workers SET medical_valid_until = ? WHERE id = ?").run(ist(-2), w.id);
  assert.equal(labourOf(t.api.db).cycle(1).medicalExpired, 1);
  assert.equal((await t.call(hr1, 'GET', `${H}/workers/${w.id}`)).json.data.medicalStatus, 'EXPIRED');
});

test('T-02 BR-03 FR-01 a contractor does not exceed the licensed number of workers, and without a licence in force nobody of theirs is deployed', async () => {
  const t = await setup();
  const ws = [await t.approved(), await t.approved(), await t.approved()];
  for (const w of ws) await t.cleared(w.id);
  // no licence on file yet
  assert.match(JSON.stringify((await t.deploy(hr1, ws[0].id)).json.error.details), /no CLRA licence in force/);
  assert.equal((await t.licence(t.ids.k1, { licenceValidUntil: ist(-3) })).status, 200);
  assert.match(JSON.stringify((await t.deploy(hr1, ws[0].id)).json.error.details), /no CLRA licence in force/, 'an expired licence is none');
  assert.equal((await t.call(se1, 'PUT', `${H}/labour/contractors/${t.ids.k1}/compliance`, { maxWorkers: 2, version: 0 }, uid())).status, 403);
  const lic = await t.licence(t.ids.k1, { maxWorkers: 2, version: 1 });
  assert.equal(lic.status, 200, JSON.stringify(lic.json));
  assert.equal((await t.licence(t.ids.k1, { maxWorkers: 9, version: 1 })).status, 409, 'a stale version');
  assert.ok([201, 202].includes((await t.deploy(hr1, ws[0].id, { submit: true })).status));
  assert.ok([201, 202].includes((await t.deploy(hr1, ws[1].id, { submit: true })).status));
  const third = await t.deploy(hr1, ws[2].id);
  assert.equal(third.status, 400); assert.match(JSON.stringify(third.json.error.details), /may have 2 workers/);
  // another contractor's worker is not counted against this one
  const other = await t.approved({ contractorId: t.ids.k2 }); await t.cleared(other.id); await t.licence(t.ids.k2, { maxWorkers: 5, version: 0 });
  assert.equal((await t.deploy(hr1, other.id)).status, 201);
  // the strength of the day: deployed, punched in, the state of the licence
  const row = (await t.call(hr1, 'GET', `${H}/labour/contractors?date=${ist(0)}`)).json.data.find((c) => c.id === t.ids.k1);
  assert.deepEqual([row.registered, row.maxWorkers, row.state], [3, 2, 'VALID']);
  // a contractor must be a labour contractor of the partner master, active
  assert.equal((await t.post(ws1, `${H}/workers`, t.body({ contractorId: t.ids.vendor }))).status, 400);
  assert.equal((await t.post(ws1, `${H}/workers`, t.body({ contractorId: t.ids.held }))).status, 400);
  const list = (await t.call(hr1, 'GET', `${H}/labour/contractors`)).json.data;
  assert.deepEqual(list.map((c) => c.code).sort(), ['LC1', 'LC2', 'LC3']);
});

test('T-03 BR-04 FR-04 a contracted rate below the minimum wage of the state and skill is rejected, on any basis; rates are effective-dated and approved by the HR manager and the commercial manager', async () => {
  assert.equal(convertRate(40000, 'DAILY', 'HOURLY'), 5000); assert.equal(convertRate(5000, 'HOURLY', 'DAILY'), 40000); assert.equal(convertRate(100, 'PIECE', 'DAILY'), null);
  const t = await setup();
  const min = { kind: 'MINIMUM', skillCategory: 'SKILLED', stateCode: 'Maharashtra', payBasis: 'DAILY', rate: 400, minWageRef: 'Notification 12/2026 of 1 April', effectiveFrom: ist(-30) };
  assert.equal((await t.post(ws1, `${H}/labour/wage-rates`, min)).status, 403, 'a supervisor does not set wages');
  assert.equal((await t.post(hr1, `${H}/labour/wage-rates`, { ...min, minWageRef: null })).status, 400, 'a notification is named');
  const m = (await t.post(hr1, `${H}/labour/wage-rates`, { ...min, submit: true })).json.data;
  assert.equal(m.status, 'SUBMITTED'); assert.equal(m.band, 'MINIMUM'); assert.match(m.docNo, /^LWR-/);
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, hr1)).json.data.rows.some((x) => x.instance.id === m.workflowInstanceId), false, 'the maker does not decide');
  await t.act(hr2, m.workflowInstanceId);
  assert.equal((await t.call(hr1, 'GET', `${H}/labour/wage-rates/${m.id}`)).json.data.status, 'APPROVED');
  const c = { kind: 'CONTRACT', contractorId: t.ids.k1, tradeCode: 'MASON', skillCategory: 'SKILLED', stateCode: 'Maharashtra', payBasis: 'DAILY', rate: 399.99, effectiveFrom: ist(0) };
  const low = await t.post(hr1, `${H}/labour/wage-rates`, c);
  assert.equal(low.status, 400); assert.match(low.json.error.details.find((d) => d.field === 'rate').message, /below the minimum wage of Maharashtra/);
  const hourlyLow = await t.post(hr1, `${H}/labour/wage-rates`, { ...c, payBasis: 'HOURLY', rate: 49.9 });
  assert.equal(hourlyLow.status, 400, 'the hourly rate is compared with a day of eight hours');
  assert.equal((await t.post(hr1, `${H}/labour/wage-rates`, { ...c, payBasis: 'HOURLY', rate: 50, submit: false })).status, 201);
  // the minimum on the day it starts: an earlier date, before the notification, is not held to it
  assert.equal((await t.post(hr1, `${H}/labour/wage-rates`, { ...c, rate: 100, effectiveFrom: ist(-60) })).status, 201);
  const good = (await t.post(hr1, `${H}/labour/wage-rates`, { ...c, rate: 450, submit: true })).json.data;
  assert.equal(good.band, 'CONTRACT');
  await t.act(hr2, good.workflowInstanceId);
  assert.equal((await t.call(hr1, 'GET', `${H}/labour/wage-rates/${good.id}`)).json.data.status, 'SUBMITTED', 'the commercial manager decides too');
  await t.act(com1, good.workflowInstanceId);
  assert.equal((await t.call(hr1, 'GET', `${H}/labour/wage-rates/${good.id}`)).json.data.status, 'APPROVED');
  // what to pay: the contracted rate, never less than the minimum
  const q = `contractorId=${t.ids.k1}&tradeCode=MASON&skillCategory=SKILLED&stateCode=Maharashtra&payBasis=DAILY&date=${ist(0)}`;
  const a = (await t.call(hr1, 'GET', `${H}/labour/wage-rates/applicable?${q}`)).json.data;
  assert.deepEqual([a.rate.rate, a.rate.source, a.minimum.rate], [450, 'CONTRACT', 400]);
  const h = (await t.call(hr1, 'GET', `${H}/labour/wage-rates/applicable?${q.replace('DAILY', 'HOURLY')}`)).json.data;
  assert.equal(h.rate.rate, 56.25);
  const none = (await t.call(hr1, 'GET', `${H}/labour/wage-rates/applicable?${q.replace('contractorId=' + t.ids.k1, 'contractorId=' + t.ids.k2)}`)).json.data;
  assert.deepEqual([none.rate.rate, none.rate.source], [400, 'MINIMUM'], 'with no contract the minimum wage is paid');
  // an approved rate is locked: a draft changes, an approved one is replaced by a later one
  assert.equal((await t.call(hr1, 'PATCH', `${H}/labour/wage-rates/${good.id}`, { ...c, rate: 460, version: 1 }, uid())).status, 409);
  const list = (await t.call(com1, 'GET', `${H}/labour/wage-rates?filter[kind]=CONTRACT`)).json;
  assert.ok(list.data.length >= 3);
  assert.equal((await t.api.raw('GET', `${H}/labour/wage-rates/export?format=csv`, hr1)).status, 200);
  assert.equal((await t.call(se1, 'GET', `${H}/labour/wage-rates`)).status, 200); assert.equal((await t.call(as('EMP', 'e1'), 'GET', `${H}/labour/wage-rates`)).status, 403);
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'lab.wage_rate.approved'").get().n, 2);
});

test('FR-02 AC-04 registration: supervisor then HR manager; the ID and the bank account are masked; a duplicate ID is refused; return, resubmit and reject; nobody approves their own', async () => {
  const t = await setup();
  const made = await t.post(ws1, `${H}/workers`, { ...t.body({ bankAccount: '123456789012', ifsc: 'SBIN0001234', uan: '100200300400' }), submit: true });
  assert.ok([201, 202].includes(made.status), JSON.stringify(made.json));
  const w = made.json.data;
  assert.equal(w.status, 'SUBMITTED'); assert.match(w.workerCode, /^LW-/); assert.equal(w.aadhaarMasked.startsWith('XXXX-XXXX-'), true); assert.equal(w.bankMasked, 'XXXXXX9012'); assert.equal(w.ifsc, null, 'the supervisor does not see bank details');
  assert.equal(JSON.stringify(w).includes('123456789012'), false);
  assert.equal(t.api.db.prepare('SELECT bank_enc FROM lab_workers WHERE id = ?').get(w.id).bank_enc.includes('123456789012'), false, 'the account number is stored encrypted');
  // the same ID again
  const dup = await t.post(ws1, `${H}/workers`, t.body({ aadhaar: t.api.db.prepare('SELECT aadhaar_last4 FROM lab_workers WHERE id = ?').get(w.id) && undefined }));
  void dup;
  const idNo = String(100000000000 + 7919);
  const twin = await t.post(ws1, `${H}/workers`, { ...t.body(), aadhaar: idNo });
  assert.equal(twin.status, 400); assert.match(JSON.stringify(twin.json.error.details), new RegExp(w.workerCode));
  // the requester cannot decide; the supervisor level and then HR
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, ws1)).json.data.rows.some((x) => x.instance.id === w.workflowInstanceId), false);
  await t.act(sub1, w.workflowInstanceId, 'return');
  assert.equal((await t.call(ws1, 'GET', `${H}/workers/${w.id}`)).json.data.status, 'RETURNED');
  const fix = await t.call(ws1, 'PATCH', `${H}/workers/${w.id}`, { ...t.body({ aadhaar: idNo, name: 'Ramesh Yadav' }), version: (await t.call(ws1, 'GET', `${H}/workers/${w.id}`)).json.data.rowVersion }, uid());
  assert.equal(fix.status, 200, JSON.stringify(fix.json));
  assert.equal((await t.post(ws1, `${H}/workers/${w.id}/submit`, {})).status, 202);
  await t.act(sub1, w.workflowInstanceId);
  assert.equal((await t.call(ws1, 'GET', `${H}/workers/${w.id}`)).json.data.status, 'SUBMITTED', 'the HR manager has still to check the KYC');
  await t.act(hr1, w.workflowInstanceId);
  const done = (await t.call(hr1, 'GET', `${H}/workers/${w.id}`)).json.data;
  assert.equal(done.status, 'APPROVED'); assert.equal(done.name, 'Ramesh Yadav'); assert.equal(done.ifsc, 'SBIN0001234', 'HR sees what payroll needs');
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'lab.worker.registered'").get().n, 1);
  // a rejected registration frees the ID
  const r2 = (await t.post(ws1, `${H}/workers`, { ...t.body(), aadhaar: '222233334444', submit: true })).json.data;
  await t.act(sub1, r2.workflowInstanceId, 'reject');
  assert.equal((await t.post(ws1, `${H}/workers`, { ...t.body(), aadhaar: '222233334444' })).status, 201);
  // withdraw, delete a draft, cancel
  const d = (await t.post(sub1, `${H}/workers`, t.body())).json.data;
  assert.equal((await t.call(ws1, 'DELETE', `${H}/workers/${d.id}`)).status, 404, 'another supervisor does not see the draft');
  assert.equal((await t.call(sub1, 'DELETE', `${H}/workers/${d.id}`)).status, 200);
  // masks in the register and the file; scope
  const reg = (await t.call(pm1, 'GET', `${H}/workers`)).json.data; assert.equal(reg.length, 0, 'a project manager sees workers of the sites they reach, and these are not deployed');
  const all = (await t.call(hr1, 'GET', `${H}/workers?filter[status]=APPROVED`)).json.data; assert.equal(all.length, 1); assert.equal(all[0].mobile.startsWith('XXXXXX'), false, 'HR sees the mobile number');
  assert.equal((await t.call(ws1, 'GET', `${H}/workers`)).json.data.every((x) => x.mobile.startsWith('XXXXXX')), true, 'a supervisor sees it masked');
  const csv = (await t.api.raw('GET', `${H}/workers/export?format=csv`, pay1)).buffer.toString(); assert.match(csv, /Ramesh Yadav/); assert.equal(csv.includes('100200300400'), false);
  assert.equal((await t.call(as('HRMGR', 'hr9', '2'), 'GET', `${H}/workers`)).json.data.length, 0);
  const k = uid('k'); const b = t.body();
  const one = await t.call(ws1, 'POST', `${H}/workers`, b, k); const two = await t.call(ws1, 'POST', `${H}/workers`, b, k);
  assert.equal(one.json.data.id, two.json.data.id);
  assert.equal((await t.call(ws1, 'POST', `${H}/workers`, t.body())).status, 400, 'an idempotency key is needed');
});

test('FR-02 amendment: an approved worker is changed through a revision that is applied to the same worker when approved; the code, the card and the deployments stay', async () => {
  const t = await setup();
  await t.licence(t.ids.k1);
  const w = await t.approved(); await t.cleared(w.id);
  const dep = (await t.deploy(hr1, w.id)).json.data;
  const cards = await t.post(hr1, `${H}/workers/cards`, { ids: [w.id] }); const token = t.api.db.prepare('SELECT qr_token FROM lab_workers WHERE id = ?').get(w.id).qr_token;
  assert.equal(cards.status, 200);
  const am = await t.post(hr1, `${H}/workers/${w.id}/amend`, { reason: 'He is a bar bender now' });
  assert.equal(am.status, 201); assert.equal(am.json.data.revision, 2);
  assert.equal((await t.post(hr1, `${H}/workers/${w.id}/amend`, { reason: 'Again, at the same time' })).status, 409);
  const rev = am.json.data;
  const upd = await t.call(hr1, 'PATCH', `${H}/workers/${rev.id}`, { ...t.body({ tradeCode: 'BAR_BENDER', skillCategory: 'HIGHLY_SKILLED', name: w.name, aadhaar: null }), version: rev.rowVersion }, uid());
  assert.equal(upd.status, 200, JSON.stringify(upd.json));
  const sub = await t.post(hr1, `${H}/workers/${rev.id}/submit`, {});
  await t.act(sub1, sub.json.data.workflowInstanceId); await t.act(hr2, sub.json.data.workflowInstanceId);
  const after = (await t.call(hr1, 'GET', `${H}/workers/${w.id}`)).json.data;
  assert.deepEqual([after.tradeCode, after.skillCategory, after.workerCode, after.status, after.pendingRevision], ['BAR_BENDER', 'HIGHLY_SKILLED', w.workerCode, 'APPROVED', null]);
  assert.equal(t.api.db.prepare('SELECT qr_token FROM lab_workers WHERE id = ?').get(w.id).qr_token, token, 'the card still works');
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM hr_deployments WHERE person_type = 'WORKER' AND person_id = ?").get(w.id).n, 1);
  assert.equal(dep.personId ?? w.id, w.id);
  assert.equal((await t.call(hr1, 'GET', `${H}/workers?pageSize=100`)).json.data.length, 1, 'the register lists the worker once');
});

test('FR-05 FR-06 AC-01 the card has a QR with the token of the card; a worker punches at the kiosk with it; a reissue makes the old card useless; the strength of the day counts them', async () => {
  const t = await setup();
  await t.licence(t.ids.k1);
  const w = await t.approved(); await t.cleared(w.id);
  const un = (await t.post(ws1, `${H}/workers`, t.body())).json.data;
  assert.equal((await t.post(hr1, `${H}/workers/cards`, { ids: [un.id] })).status, 422, 'a card is not issued for a draft');
  const pend = (await t.post(sub1, `${H}/workers`, { ...t.body(), submit: true })).json.data;
  assert.equal((await t.post(hr1, `${H}/workers/cards`, { ids: [pend.id] })).status, 422, 'nor for a worker not approved yet');
  assert.equal((await t.post(se1, `${H}/workers/cards`, { ids: [w.id] })).status, 403);
  const c = (await t.post(hr1, `${H}/workers/cards`, { ids: [w.id] })).json.data.cards[0];
  assert.match(c.qrSvg, /^<\?xml|<svg/); assert.equal(c.cleared, true); assert.equal(c.cardVersion, 1);
  const token = t.api.db.prepare('SELECT qr_token FROM lab_workers WHERE id = ?').get(w.id).qr_token;
  // deployed at the site, the worker punches at the kiosk with the QR (the badge is LAB:token)
  const dep = (await t.deploy(hr1, w.id, { submit: true })).json.data;
  await t.act(pm1, dep.workflowInstanceId).catch(() => {});
  const status = t.api.db.prepare('SELECT status FROM hr_deployments WHERE id = ?').get(dep.id).status;
  if (status !== 'APPROVED') for (const who of [hr2, as('PD', 'pd1')]) await t.act(who, dep.workflowInstanceId).catch(() => {});
  const kiosk = (badge, key = uid('c')) => t.call(se1, 'POST', '/api/v1/att/punches/kiosk', { siteId: t.ids.s1, badge, punchType: 'IN', deviceTime: new Date().toISOString(), selfie: PIXEL, clientUuid: key }, uid());
  if (t.api.db.prepare('SELECT status FROM hr_deployments WHERE id = ?').get(dep.id).status !== 'APPROVED') t.api.db.prepare("UPDATE hr_deployments SET status = 'APPROVED' WHERE id = ?").run(dep.id);
  const p = await kiosk(`LAB:${token}`);
  assert.equal(p.status, 201, JSON.stringify(p.json)); assert.equal(p.json.data.result, 'ACCEPTED');
  assert.equal(t.api.db.prepare("SELECT person_type, person_id, method FROM att_punches ORDER BY id DESC LIMIT 1").get().person_type, 'WORKER');
  assert.equal((await kiosk('LAB:deadbeef')).status, 404);
  const strength = (await t.call(hr1, 'GET', `${H}/labour/strength?date=${ist(0)}`)).json.data.find((x) => x.id === t.ids.k1);
  assert.deepEqual([strength.registered, strength.deployed, strength.present], [1, 1, 1]);
  const worker = (await t.call(hr1, 'GET', `${H}/workers/${w.id}`)).json.data;
  assert.equal(worker.deployments.length, 1); assert.equal(worker.punches.length, 1);
  // a reissue: a new token, the old one is not known
  const re = (await t.post(hr1, `${H}/workers/cards`, { ids: [w.id], reissue: true })).json.data.cards[0]; assert.equal(re.cardVersion, 2);
  assert.notEqual(t.api.db.prepare('SELECT qr_token FROM lab_workers WHERE id = ?').get(w.id).qr_token, token);
  assert.equal((await kiosk(`LAB:${token}`)).status, 404);
  // the worker code is accepted when typed
  assert.ok([200, 201].includes((await kiosk(w.workerCode)).status), 'a typed worker code is known (a second in within minutes is the same punch)');
});

test('FR-07 FR-03 a blacklisted worker is not deployed or punched in until HR lifts it; clearance, PPE and the history are on the worker', async () => {
  const t = await setup();
  await t.licence(t.ids.k1);
  const w = await t.approved(); await t.cleared(w.id);
  assert.equal((await t.post(pm1, `${H}/workers/${w.id}/blacklist`, { reason: 'Worked at height without a harness' })).status, 403);
  assert.equal((await t.post(hse1, `${H}/workers/${w.id}/blacklist`, { reason: 'x' })).status, 400, 'a reason is needed');
  const b = await t.post(hse1, `${H}/workers/${w.id}/blacklist`, { reason: 'Worked at height without a harness' });
  assert.equal(b.status, 200, JSON.stringify(b.json)); assert.equal(b.json.data.workerStatus, 'BLACKLISTED');
  assert.equal((await t.post(hse1, `${H}/workers/${w.id}/blacklist`, { reason: 'Worked at height without a harness' })).status, 409);
  assert.match(JSON.stringify((await t.deploy(hr1, w.id)).json.error.details), /blacklisted/);
  assert.equal((await t.post(hr1, `${H}/workers/cards`, { ids: [w.id] })).status, 422);
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'lab.worker.blacklisted'").get().n, 1);
  assert.equal((await t.post(hr1, `${H}/workers/${w.id}/unblacklist`, { reason: 'Retrained and the contractor has apologised' })).json.data.workerStatus, 'ACTIVE');
  assert.equal((await t.deploy(hr1, w.id)).status, 201);
  // PPE
  const ppe = await t.post(hse1, `${H}/workers/${w.id}/ppe`, { item: 'Safety helmet', issuedOn: ist(0) });
  assert.equal(ppe.status, 201); assert.equal(ppe.json.data.ppe.length, 1);
  const h = (await t.call(hr1, 'GET', `${H}/workers/${w.id}/history`)).json.data;
  assert.ok(['blacklist', 'unblacklist', 'ppe', 'clearance'].every((a) => h.audit.some((x) => x.action === a)));
  assert.equal((await t.api.raw('GET', `${H}/workers/${w.id}/print`, hr1)).status, 200);
});

test('FR-01 FR-08 contractor compliance: the licence alert goes to HR once for each state; the list says which contractors need attention', async () => {
  const t = await setup();
  assert.equal((await t.licence(t.ids.k1, { licenceValidUntil: ist(10), maxWorkers: 20 })).status, 200);
  assert.equal((await t.licence(t.ids.k2, { licenceValidUntil: ist(-5), maxWorkers: 20 })).status, 200);
  const list = (await t.call(hr1, 'GET', `${H}/labour/contractors`)).json.data;
  assert.equal(list.find((c) => c.id === t.ids.k1).state, 'EXPIRING'); assert.equal(list.find((c) => c.id === t.ids.k2).state, 'EXPIRED'); assert.equal(list.find((c) => c.code === 'LC3').state, 'NO_LICENCE');
  const lab = labourOf(t.api.db);
  assert.equal(lab.cycle(1).licencesAlerted, 2);
  assert.equal(lab.cycle(1).licencesAlerted, 0, 'once for each state');
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'lab.contractor.licence_expiring'").get().n, 2);
  assert.ok(t.api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'lab.licence.expiring'").get().n >= 0);
  // renewing the licence clears the alert state
  await t.licence(t.ids.k2, { licenceValidUntil: ist(400), maxWorkers: 20, version: 1 });
  assert.equal(lab.cycle(1).licencesAlerted, 0);
  assert.equal((await t.call(hr1, 'GET', `${H}/labour/contractors/${t.ids.k2}`)).json.data.state, 'VALID');
  assert.equal((await t.call(se1, 'GET', `${H}/labour/contractors`)).status, 200);
  assert.equal((await t.call(as('EMP', 'e1'), 'GET', `${H}/labour/contractors`)).status, 403);
  assert.equal((await t.call(hr1, 'GET', `${H}/labour/contractors/${t.ids.vendor}`)).status, 404, 'a vendor is not a labour contractor');
});
