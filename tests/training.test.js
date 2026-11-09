import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';

// Part 07.10: training, certifications, skills and the competency matrix. T-01 an expired operator licence blocks the operator assignment check (and the deployment). Also: courses, sessions (internal open on submit, external with a fee approved by
// the manager and the HR manager), nominations inside the reporting line, QR sign-in window, attendance and scores, certificates given by a passed course, verification by somebody else, the daily watch, the skill matrix, mandatory training compliance, the cost report.
const H = '/api/v1/hr';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const as = (roles, user, company = '1') => ({ roles, user, company });
const hr1 = as('HRMGR', 'hr1'); const hr2 = as('HRMGR', 'hr2');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
let seq = 0;
const uid = (k = 'r') => `${k}-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}`;
const ist = (n = 0) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const at = (n, hhmm) => `${ist(n)}T${hhmm}`;

const setup = async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (2, 'TWO', 'Two Infra Pvt Ltd', 'Two', 't', 'test')").run();
  const user = {};
  const mkUser = (n, roles) => { user[n] = Number(api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(1, n, n, JSON.stringify(roles), `${n}@example.com`).lastInsertRowid); return user[n]; };
  for (const [n, r] of [['hr1', ['HRMGR']], ['hr2', ['HRMGR']], ['hr3', ['HRMGR']]]) mkUser(n, r);
  const org = (sql, ...a) => Number(api.db.prepare(sql).run(...a).lastInsertRowid);
  const dept = org("INSERT INTO org_departments (company_id, code, name, created_by, source_type) VALUES (1, 'ENG', 'Engineering', 't', 'test')");
  const desOp = org("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (1, 'OP', 'Crane Operator', 'G2', 2, 't', 'test')");
  const des = org("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (1, 'SE', 'Site Engineer', 'G3', 3, 't', 'test')");
  const p1 = org("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 't', 'test')");
  const s1 = org("INSERT INTO org_sites (company_id, org_project_id, code, name, status, latitude, longitude, geofence_type, geofence_radius_m, created_by, source_type) VALUES (1, ?, 'S1', 'Ring Road North', 'ACTIVE', 18.5204, 73.8567, 'CIRCLE', 200, 't', 'test')", p1);
  let n = 0;
  const mkEmp = (o = {}) => { n += 1; return org("INSERT INTO hr_employees (company_id, emp_code, first_name, full_name, name_key, gender, dob, mobile, department_id, designation_id, grade, employment_type, doj, location_type, employment_status, record_status, user_id, manager_id, site_id, project_id, created_by, source_type) VALUES (1, ?, 'E', ?, ?, 'MALE', '1990-01-01', ?, ?, ?, 'G3', 'PERMANENT', '2026-01-01', 'SITE', 'ACTIVE', 'APPROVED', ?, ?, ?, ?, 't', 'test')", o.code ?? `E${n}`, o.name ?? `Employee ${n}`, `e${n}`, `91000${String(n).padStart(5, '0')}`, dept, o.designation ?? des, o.userId ?? null, o.managerId ?? null, s1, p1); };
  // a line: head (mgr1) <- lead (lead1) <- a, b ; head <- c ; and a stranger (str1) in the same company
  const head = mkEmp({ code: 'M1', name: 'Meera Head', userId: mkUser('mgr1', ['EMP']) });
  const lead = mkEmp({ code: 'L1', name: 'Lalit Lead', userId: mkUser('lead1', ['EMP']), managerId: head });
  const a = mkEmp({ code: 'A1', name: 'Asha Kulkarni', userId: mkUser('emp1', []), managerId: lead });
  const b = mkEmp({ code: 'B1', name: 'Bhanu Rao', userId: mkUser('emp2', []), managerId: lead });
  const c = mkEmp({ code: 'C1', name: 'Chitra Iyer', userId: mkUser('emp3', []), managerId: head });
  const oper = mkEmp({ code: 'O1', name: 'Om Operator', userId: mkUser('op1', []), managerId: lead, designation: desOp });
  const stranger = mkEmp({ code: 'S1', name: 'Sanjay Stranger', userId: mkUser('str1', []) });
  api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (2, 'hr9', 'HR9', '[\"HRMGR\"]', 'hr9@example.com')").run();
  mkEmp({ code: 'H1', name: 'Hema HR', userId: user.hr3 });
  const call = (who, method, path, body, key) => api.call(method, path, { ...who, headers: key ? { ...json, 'idempotency-key': key } : json, body });
  const post = (who, path, body) => call(who, 'POST', path, body, uid());
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
    assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: { ...json, 'idempotency-key': uid('a') }, body: { action, comment: 'checked it' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  const put = (who, path, body) => call(who, 'PUT', path, body, uid());
  return { api, call, post, put, act, org, ids: { head, lead, a, b, c, oper, stranger, s1, p1, dept }, user };
};
const course = (t, o = {}) => t.put(hr1, `${H}/training/courses`, { code: 'WAH', title: 'Working at height', category: 'SAFETY', mode: 'INTERNAL', mandatoryFor: { all: true }, validityMonths: 12, passScore: 60, ...o });
const sessionBody = (courseId, t, o = {}) => ({ courseId, startAt: at(-0, '09:00'), endAt: at(0, '17:00'), trainer: 'Trainer T', venue: 'Site hall', projectId: t.ids.p1, siteId: t.ids.s1, capacity: 10, cost: 0, ...o });

test('T-01 BR-01 an expired operator licence blocks the operator assignment check and the deployment; a valid, verified one lets it pass', async () => {
  const t = await setup(); const { oper, s1, p1 } = t.ids;
  assert.equal((await t.put(hr1, `${H}/training/cert-types`, { code: 'OPLIC', name: 'Crane operator licence', validityMonths: 24, alertDays: 30, requiredFor: { designationCodes: ['OP'] } })).status, 200);
  const make = async (validFrom, validUntil, number) => (await t.post(hr1, `${H}/training/certs`, { personType: 'EMPLOYEE', personId: oper, certType: 'OPLIC', number, issuer: 'RTO Pune', validFrom, validUntil })).json.data;
  const old = await make('2020-01-01', ist(-10), 'LIC-1');
  // not verified: it does not count, even before it expires
  assert.equal(old.state, 'EXPIRED');
  const v = await t.post(hr1, `${H}/training/certs/${old.id}/verify`, {});
  assert.equal(v.status, 403, 'the person who recorded it does not verify it');
  assert.equal((await t.post(hr2, `${H}/training/certs/${old.id}/verify`, {})).status, 200);
  const check = (await t.post(hr1, `${H}/training/certs/check`, { personType: 'EMPLOYEE', personId: oper, certTypes: ['OPLIC'] })).json.data;
  assert.equal(check.ok, false);
  assert.match(check.problems[0], /expired on/);
  // the deployment of the operator is refused
  const dep = { personId: oper, projectId: p1, siteId: s1, siteRole: 'Crane operator', fromDate: ist(1), toDate: null, isPrimary: true, submit: false };
  const refused = await t.post(hr1, `${H}/deployments`, dep);
  assert.equal(refused.status, 400, JSON.stringify(refused.json));
  assert.match(JSON.stringify(refused.json), /Crane operator licence.*expired/);
  // a new licence, recorded and verified by somebody else: the check passes and the deployment is accepted
  const fresh = await make(ist(-5), ist(400), 'LIC-2');
  assert.equal(fresh.state, 'UNVERIFIED');
  assert.equal((await t.post(hr1, `${H}/training/certs/check`, { personType: 'EMPLOYEE', personId: oper, certTypes: ['OPLIC'] })).json.data.ok, false, 'a certificate that nobody verified does not count');
  assert.equal((await t.post(hr2, `${H}/training/certs/${fresh.id}/verify`, {})).status, 200);
  assert.equal((await t.post(hr1, `${H}/training/certs/check`, { personType: 'EMPLOYEE', personId: oper, certTypes: ['OPLIC'] })).json.data.ok, true);
  assert.equal((await t.post(hr1, `${H}/deployments`, dep)).status, 201);
  // a revoked one stops counting
  assert.equal((await t.post(hr2, `${H}/training/certs/${fresh.id}/revoke`, { reason: 'Licence suspended by the RTO' })).status, 200);
  assert.equal((await t.post(hr1, `${H}/training/certs/check`, { personType: 'EMPLOYEE', personId: oper, certTypes: ['OPLIC'] })).json.data.ok, false);
  // an unknown type is not a pass
  assert.equal((await t.post(hr1, `${H}/training/certs/check`, { personType: 'EMPLOYEE', personId: oper, certTypes: ['NOPE'] })).json.data.ok, false);
});

test('FR-01 sessions: an internal session opens on submit, an external one with a fee goes to the manager and the HR manager; the creator cannot approve; moves and locks', async () => {
  const t = await setup();
  t.api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'pm9', 'PM9', '[\"PM\"]', 'pm9@example.com')").run();
  const c = (await course(t)).json.data;
  const s = (await t.post(hr1, `${H}/sessions`, sessionBody(c.id, t))).json.data;
  assert.equal(s.status, 'DRAFT'); assert.equal(s.band, 'INTERNAL');
  assert.equal((await call_(t, hr1, 'POST', `${H}/sessions`, sessionBody(c.id, t))).status, 400, 'an idempotency key is required');
  assert.equal((await t.post(hr1, `${H}/sessions`, sessionBody(c.id, t, { endAt: at(0, '08:00') }))).status, 400, 'ends before it starts');
  const moved = await t.post(hr1, `${H}/sessions/${s.id}/reschedule`, { startAt: at(1, '09:00'), endAt: at(1, '17:00') });
  assert.equal(moved.json.data.startAt, at(1, '09:00'));
  const opened_ = (await t.post(hr1, `${H}/sessions/${s.id}/submit`, {})).json.data;
  assert.equal(opened_.status, 'APPROVED', 'an internal session without a fee needs no approval chain');
  assert.equal((await t.post(hr1, `${H}/sessions/${s.id}/reschedule`, { startAt: at(2, '09:00'), endAt: at(2, '17:00') })).status, 409, 'an open session is locked');
  // external with a fee
  const ext = (await course(t, { code: 'WELD', title: 'Welding course (external)', mode: 'EXTERNAL', mandatoryFor: {}, passScore: null })).json.data;
  const e = (await t.post(hr1, `${H}/sessions`, sessionBody(ext.id, t, { cost: 25000, trainer: 'Institute X' }))).json.data;
  assert.equal(e.band, 'EXTERNAL'); assert.equal(e.cost, 25000);
  const sub = (await t.post(hr1, `${H}/sessions/${e.id}/submit`, {})).json.data;
  assert.equal(sub.status, 'SUBMITTED');
  assert.equal((await t.post(hr1, `${H}/sessions/${e.id}/submit`, {})).status, 409, 'already submitted');
  const own = await t.api.call('GET', `${W}/tasks?mine=assigned`, hr1);
  assert.equal(own.json.data.rows.some((x) => x.instance.id === sub.workflowInstanceId), false, 'the creator never approves their own session');
  await t.act(as('PM', 'pm9'), sub.workflowInstanceId);
  assert.equal((await t.call(hr1, 'GET', `${H}/sessions/${e.id}`)).json.data.status, 'SUBMITTED', 'the HR manager is still to decide');
  await t.act(hr2, sub.workflowInstanceId);
  const approved = (await t.call(hr1, 'GET', `${H}/sessions/${e.id}`)).json.data;
  assert.equal(approved.status, 'APPROVED');
  assert.equal((await t.call(hr1, 'GET', `${H}/sessions/${e.id}/history`)).json.data.approvals.length >= 2, true);
  // a second external session is rejected by the manager: it is closed
  const e2 = (await t.post(hr1, `${H}/sessions`, sessionBody(ext.id, t, { cost: 9000 }))).json.data;
  const sub2 = (await t.post(hr1, `${H}/sessions/${e2.id}/submit`, {})).json.data;
  await t.act(as('PM', 'pm9'), sub2.workflowInstanceId, 'reject');
  assert.equal((await t.call(hr1, 'GET', `${H}/sessions/${e2.id}`)).json.data.status, 'REJECTED');
  // a third is returned, corrected and sent again
  const e3 = (await t.post(hr1, `${H}/sessions`, sessionBody(ext.id, t, { cost: 8000 }))).json.data;
  const sub3 = (await t.post(hr1, `${H}/sessions/${e3.id}/submit`, {})).json.data;
  await t.act(as('PM', 'pm9'), sub3.workflowInstanceId, 'return');
  assert.equal((await t.call(hr1, 'GET', `${H}/sessions/${e3.id}`)).json.data.status, 'RETURNED');
  assert.equal((await t.post(hr1, `${H}/sessions/${e3.id}/submit`, {})).json.data.status, 'SUBMITTED');
  // withdrawn from approval goes back to a draft
  assert.equal((await t.post(hr1, `${H}/sessions/${e3.id}/withdraw`, { reason: 'Plans changed' })).status, 422, 'an approver acted already: it is cancelled, not withdrawn');
  assert.equal((await t.post(hr1, `${H}/sessions/${e3.id}/cancel`, { reason: 'Plans changed' })).json.data.status, 'CANCELLED');
  // an internal course cannot carry an external fee
  assert.equal((await t.post(hr1, `${H}/sessions`, sessionBody(c.id, t, { cost: 100 }))).status, 400);
  // the calendar and the list
  const cal = (await t.call(hr1, 'GET', `${H}/sessions/calendar?from=${ist(-1)}&to=${ist(5)}`)).json.data;
  assert.ok(cal.length >= 2);
  assert.ok((await t.call(hr1, 'GET', `${H}/sessions`)).json.data.length >= 2);
  // a draft is deleted by its maker only
  const d = (await t.post(hr1, `${H}/sessions`, sessionBody(c.id, t))).json.data;
  assert.equal((await t.call(hr2, 'DELETE', `${H}/sessions/${d.id}`)).status, 403);
  assert.equal((await t.call(hr1, 'DELETE', `${H}/sessions/${d.id}`)).status, 200);
});
const call_ = (t, who, method, path, body) => t.api.call(method, path, { ...who, headers: json, body });

test('FR-01 FR-05 nominations stay inside the reporting line, QR sign-in has a window, attendance and scores give the certificate, feedback, cost', async () => {
  const t = await setup(); const { a, b, c, stranger, lead, oper } = t.ids;
  await t.put(hr1, `${H}/training/cert-types`, { code: 'WAHT', name: 'Working at height ticket', validityMonths: 12, alertDays: 30 });
  const co = (await course(t, { certTypeCode: 'WAHT' })).json.data;
  const s = (await t.post(hr1, `${H}/sessions`, sessionBody(co.id, t, { capacity: 3, startAt: at(0, '00:01'), endAt: at(0, '23:58') }))).json.data;
  await t.post(hr1, `${H}/sessions/${s.id}/submit`, {});
  const lead1 = as('EMP', 'lead1');
  // a manager nominates the people who report to them, not a stranger
  assert.equal((await t.post(as('PM', 'lead1'), `${H}/sessions/${s.id}/nominations`, { people: [{ personType: 'EMPLOYEE', personId: stranger }] })).status, 403);
  const nom = await t.post(as('PM', 'lead1'), `${H}/sessions/${s.id}/nominations`, { people: [{ personType: 'EMPLOYEE', personId: a }, { personType: 'EMPLOYEE', personId: b }] });
  assert.equal(nom.status, 201, JSON.stringify(nom.json));
  assert.equal(nom.json.data.attendance.length, 2);
  // an employee cannot nominate
  assert.equal((await t.post(as('EMP', 'emp1'), `${H}/sessions/${s.id}/nominations`, { people: [{ personType: 'EMPLOYEE', personId: a }] })).status, 403);
  // the QR is for the trainer's side; the employee signs in with the token
  assert.equal((await t.call(as('EMP', 'emp1'), 'GET', `${H}/sessions/${s.id}/qr`)).status, 403);
  const qr = (await t.call(hr1, 'GET', `${H}/sessions/${s.id}/qr`)).json.data;
  assert.match(qr.svg, /<svg/); assert.match(qr.url, /\/training\/mine\?t=/);
  assert.equal((await t.post(as('EMP', 'emp1'), `${H}/training/sign-in`, { token: 'not-a-real-token-1' })).status, 404);
  const si = await t.post(as('EMP', 'emp1'), `${H}/training/sign-in`, { token: qr.token });
  assert.equal(si.status, 200, JSON.stringify(si.json));
  // the third seat goes to a walk-in, the fourth person is refused
  assert.equal((await t.post(as('EMP', 'emp3'), `${H}/training/sign-in`, { token: qr.token })).status, 200);
  assert.equal((await t.post(as('EMP', 'str1'), `${H}/training/sign-in`, { token: qr.token })).status, 422, 'all seats are taken');
  // the trainer marks the scores: one passes, one fails; the one who did not come is closed as absent
  const detail = (await t.call(hr1, 'GET', `${H}/sessions/${s.id}`)).json.data;
  const rowOf = (pid) => detail.attendance.find((x) => x.personId === pid);
  assert.equal(rowOf(a).attendance, 'ATTENDED'); assert.equal(rowOf(a).method, 'QR');
  const mk = await t.post(hr1, `${H}/sessions/${s.id}/attendance`, { rows: [{ attendanceId: rowOf(a).id, score: 82 }, { attendanceId: rowOf(c).id, attendance: 'ATTENDED', score: 40 }] });
  assert.equal(mk.status, 200, JSON.stringify(mk.json));
  assert.equal((await t.post(as('EMP', 'emp1'), `${H}/sessions/${s.id}/attendance`, { rows: [{ attendanceId: rowOf(a).id, score: 100 }] })).status, 403, 'the trainee does not mark their own score');
  assert.equal((await t.post(as('EMP', 'emp1'), `${H}/sessions/${s.id}/feedback`, { rating: 5, comment: 'Clear and practical' })).status, 200);
  assert.equal((await t.post(as('EMP', 'emp2'), `${H}/sessions/${s.id}/feedback`, { rating: 4 })).status, 422, 'somebody who did not attend gives no feedback');
  const done = (await t.post(hr1, `${H}/sessions/${s.id}/complete`, {})).json.data;
  assert.equal(done.status, 'COMPLETED'); assert.equal(done.certificatesIssued, 1, 'only the one who passed');
  const after_ = (await t.call(hr1, 'GET', `${H}/sessions/${s.id}`)).json.data;
  assert.equal(after_.attendance.find((x) => x.personId === b).attendance, 'ABSENT');
  assert.equal(after_.attendance.find((x) => x.personId === c).passed, false);
  assert.equal((await t.post(hr1, `${H}/sessions/${s.id}/attendance`, { rows: [{ attendanceId: rowOf(a).id, score: 100 }] })).status, 422, 'closed');
  // the certificate of the passer: verified, valid for 12 months
  const mine = (await t.call(as('EMP', 'emp1'), 'GET', `${H}/training/mine`)).json.data;
  assert.equal(mine.certificates.length, 1); assert.equal(mine.certificates[0].certType, 'WAHT'); assert.equal(mine.certificates[0].state, 'VALID');
  assert.equal(mine.history.length, 1);
  // costs
  void lead; void lead1; void oper;
  const costs = (await t.call(hr1, 'GET', `${H}/training/costs`)).json.data;
  assert.equal(costs.sessions, 1); assert.equal(costs.byProject.length, 1);
});

test('FR-03 certificates: own record unverified, scope (own and reportees), update needs re-verification, the daily watch tells HR once, export, events', async () => {
  const t = await setup(); const { a, b, lead, stranger } = t.ids;
  await t.put(hr1, `${H}/training/cert-types`, { code: 'FAID', name: 'First aid', validityMonths: 24, alertDays: 30 });
  // an employee records their own certificate; it waits for HR
  const own = await t.post(as('EMP', 'emp1'), `${H}/training/certs`, { personType: 'EMPLOYEE', personId: a, certType: 'FAID', number: 'FA-1', issuer: 'Red Cross', validFrom: ist(-300), validUntil: ist(15) });
  assert.equal(own.status, 201, JSON.stringify(own.json)); assert.equal(own.json.data.verified, false);
  assert.equal((await t.post(as('EMP', 'emp1'), `${H}/training/certs`, { personType: 'EMPLOYEE', personId: b, certType: 'FAID', validFrom: ist(-3) })).status, 403, 'not for somebody else');
  assert.equal((await t.post(as('EMP', 'emp1'), `${H}/training/certs/${own.json.data.id}/verify`, {})).status, 403);
  assert.equal((await t.post(hr1, `${H}/training/certs`, { personType: 'EMPLOYEE', personId: a, certType: 'FAID', number: 'FA-1', validFrom: ist(-300) })).status, 409, 'the same number twice');
  assert.equal((await t.post(hr1, `${H}/training/certs/${own.json.data.id}/verify`, {})).status, 200);
  const x = (await t.call(hr1, 'GET', `${H}/training/certs/${own.json.data.id}`)).json.data;
  assert.equal(x.state, 'EXPIRING'); assert.equal(x.daysLeft, 15);
  // scope: the lead sees the line, the stranger sees nothing of it
  const leadList = (await t.call(as('PM', 'lead1'), 'GET', `${H}/training/certs`)).json.data;
  assert.equal(leadList.length, 1);
  assert.equal((await t.call(as('PM', 'lead1'), 'GET', `${H}/training/certs/${x.id}`)).status, 200);
  assert.equal((await t.call(as('PM', 'str1'), 'GET', `${H}/training/certs/${x.id}`)).status, 404);
  assert.equal((await t.call(as('EMP', 'emp2'), 'GET', `${H}/training/certs/${x.id}`)).status, 403, 'an employee has no certificate register');
  // another company sees nothing
  assert.equal((await t.call(as('HRMGR', 'hr9', '2'), 'GET', `${H}/training/certs/${x.id}`)).status, 404);
  // a change of a verified certificate needs verifying again
  const up = await t.call(hr1, 'PATCH', `${H}/training/certs/${x.id}`, { validFrom: ist(-300), validUntil: ist(500), number: 'FA-1', issuer: 'Red Cross', version: x.rowVersion }, uid());
  assert.equal(up.status, 200, JSON.stringify(up.json)); assert.equal(up.json.data.verified, false);
  assert.equal((await t.call(hr1, 'PATCH', `${H}/training/certs/${x.id}`, { validFrom: ist(-300), version: x.rowVersion }, uid())).status, 409, 'stale version');
  // the daily watch: a licence that ends in 5 days is told to HR once
  const near = (await t.post(hr1, `${H}/training/certs`, { personType: 'EMPLOYEE', personId: b, certType: 'FAID', number: 'FA-9', validFrom: ist(-100), validUntil: ist(5) })).json.data;
  const trn = (await import('../src/server/modules/hr/training.js')).trainingOf(t.api.db);
  assert.equal(trn.cycle(1).alerted, 1);
  assert.equal(trn.cycle(1).alerted, 0, 'once for each state');
  const ev = t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'trn.cert.expiring'").get().n;
  assert.equal(ev, 1);
  void near; void lead; void stranger;
  // export honours the permission
  { const r = await t.api.raw('GET', `${H}/training/certs/export?format=csv`, hr1); assert.equal(r.status, 200); assert.match(r.buffer.toString(), /FA-9/); }
  assert.equal((await t.api.raw('GET', `${H}/training/certs/export?format=csv`, as('PM', 'lead1'))).status, 403);
  // a delete: only an unverified certificate, by its maker or HR
  assert.equal((await t.api.raw('GET', `${H}/sessions/export?format=csv`, hr1)).status, 200);
  assert.equal((await t.call(hr1, 'DELETE', `${H}/training/certs/${x.id}`)).status, 200);
});

test('FR-02 FR-04 FR-06 mandatory training compliance, the skill matrix with assessments, and cost by project and department', async () => {
  const t = await setup(); const { a, b, c, lead, s1, oper } = t.ids;
  const co = (await course(t, { mandatoryFor: { all: true }, validityMonths: 12 })).json.data;
  const s = (await t.post(hr1, `${H}/sessions`, sessionBody(co.id, t, { startAt: at(0, '00:01'), endAt: at(0, '23:58') }))).json.data;
  await t.post(hr1, `${H}/sessions/${s.id}/submit`, {});
  await t.post(hr1, `${H}/sessions/${s.id}/nominations`, { people: [{ personType: 'EMPLOYEE', personId: a }, { personType: 'EMPLOYEE', personId: b }] });
  const det = (await t.call(hr1, 'GET', `${H}/sessions/${s.id}`)).json.data;
  await t.post(hr1, `${H}/sessions/${s.id}/attendance`, { rows: [{ attendanceId: det.attendance[0].id, attendance: 'ATTENDED', score: 90 }, { attendanceId: det.attendance[1].id, attendance: 'ATTENDED', score: 30 }] });
  await t.post(hr1, `${H}/sessions/${s.id}/complete`, {});
  const rep = (await t.call(hr1, 'GET', `${H}/training/compliance`)).json.data;
  const stat = (pid) => rep.rows.find((r) => r.personId === pid)?.status;
  assert.equal(stat(a), 'COMPLIANT'); assert.equal(stat(b), 'NOT_DONE', 'failed the test'); assert.equal(stat(c), 'NOT_DONE');
  assert.equal(rep.summary.compliant, 1); assert.ok(rep.summary.notDone >= 2);
  assert.equal(rep.byCourse[0].required, rep.summary.required);
  const only = (await t.call(hr1, 'GET', `${H}/training/compliance?status=NOT_DONE`)).json.data;
  assert.ok(only.rows.every((r) => r.status === 'NOT_DONE'));
  // a manager sees the compliance of their own line; an employee has no report
  const leadRep = (await t.call(as('PM', 'lead1'), 'GET', `${H}/training/compliance`)).json.data;
  assert.ok(leadRep.rows.every((r) => [lead, a, b, oper].includes(r.personId)));
  assert.equal((await t.call(as('EMP', 'emp1'), 'GET', `${H}/training/compliance`)).status, 403);
  // the skill matrix
  assert.equal((await t.put(hr1, `${H}/training/skill-defs`, { code: 'SHUTTER', name: 'Shuttering', trade: 'Carpentry' })).status, 200);
  assert.equal((await t.put(hr1, `${H}/training/skill-defs`, { code: 'BARBEND', name: 'Bar bending', trade: 'Steel' })).status, 200);
  assert.equal((await t.post(as('PM', 'lead1'), `${H}/training/skills/assess`, { personType: 'EMPLOYEE', personId: a, skillCode: 'SHUTTER', level: 3 })).status, 201);
  assert.equal((await t.post(as('PM', 'lead1'), `${H}/training/skills/assess`, { personType: 'EMPLOYEE', personId: a, skillCode: 'SHUTTER', level: 4 })).status, 201);
  assert.equal((await t.post(as('PM', 'lead1'), `${H}/training/skills/assess`, { personType: 'EMPLOYEE', personId: lead, skillCode: 'SHUTTER', level: 2 })).status, 403, 'nobody assesses themselves');
  assert.equal((await t.post(as('PM', 'str1'), `${H}/training/skills/assess`, { personType: 'EMPLOYEE', personId: a, skillCode: 'SHUTTER', level: 1 })).status, 403, 'only the reporting line assesses');
  assert.equal((await t.post(as('PM', 'lead1'), `${H}/training/skills/assess`, { personType: 'EMPLOYEE', personId: a, skillCode: 'SHUTTER', level: 5 })).status, 400);
  const m = (await t.call(as('PM', 'lead1'), 'GET', `${H}/training/skills/matrix`)).json.data;
  const row = m.people.find((p) => p.id === a);
  assert.equal(row.cells.SHUTTER.level, 4, 'the latest assessment counts');
  assert.equal(m.totals.find((x) => x.code === 'SHUTTER').trainers, 1);
  assert.equal((await t.call(as('PM', 'lead1'), 'GET', `${H}/training/skills/matrix?trade=Steel`)).json.data.skills.length, 1);
  assert.equal((await t.call(hr1, 'GET', `${H}/training/skills/history?personType=EMPLOYEE&personId=${a}&skillCode=SHUTTER`)).json.data.length, 2);
  void c; void s1;
});

test('AC-03 roles and permissions: set-up and cost reports are for HR; my training for every employee; the idempotency, validation and audit of the write routes', async () => {
  const t = await setup(); const { a } = t.ids;
  assert.equal((await t.put(as('EMP', 'emp1'), `${H}/training/courses`, { code: 'X1', title: 'Nope', category: 'SAFETY', mode: 'INTERNAL' })).status, 403);
  assert.equal((await t.put(hr1, `${H}/training/courses`, { code: 'bad code!', title: 'Nope', category: 'SAFETY', mode: 'INTERNAL' })).status, 400);
  const c1 = (await course(t)).json.data;
  assert.equal((await course(t)).status, 409, 'the code exists');
  const edit = await t.put(hr1, `${H}/training/courses`, { id: c1.id, code: 'WAH', title: 'Working at height (updated)', category: 'SAFETY', mode: 'INTERNAL', mandatoryFor: { all: true }, validityMonths: 12, passScore: 70, version: c1.rowVersion });
  assert.equal(edit.status, 200); assert.equal(edit.json.data.passScore, 70);
  assert.equal((await t.put(hr1, `${H}/training/courses`, { id: c1.id, code: 'WAH', title: 'Stale', category: 'SAFETY', mode: 'INTERNAL', version: c1.rowVersion })).status, 409);
  const me = await t.call(as('EMP', 'emp1'), 'GET', `${H}/training/mine`);
  assert.equal(me.status, 200); assert.deepEqual(me.json.data.upcoming, []);
  assert.equal((await t.call(as('EMP', 'emp1'), 'GET', `${H}/training/costs`)).status, 403);
  assert.equal((await t.call(as('EMP', 'emp1'), 'GET', `${H}/sessions`)).status, 403);
  assert.equal((await t.call(as('EMP', 'nobody'), 'GET', `${H}/training/mine`)).status, 422, 'no employee record for the user');
  const audit = t.api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'trn_courses'").get().n;
  assert.ok(audit >= 2);
  void a;
});
