import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { essOf } from '../src/server/modules/hr/ess.js';
import { setupCompany, startApi } from './helpers.js';

// Part 07.09: employee and manager self-service. T-01 a manager cannot see the bank details of a reportee and an employee cannot see the attendance of anybody else. Also: the reporting line (direct and indirect), my home, my attendance
// calendar, the team of a manager (presence, approvals waiting, who is away), my requests for a change of my details, the letters (ask, approve, issue from the template library, download), scope, idempotency and the events.
const H = '/api/v1/hr';
const A = '/api/v1/att';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const as = (roles, user, company = '1') => ({ roles, user, company });
const hr1 = as('HRMGR', 'hr1'); const hr2 = as('HRMGR', 'hr2');
const emp = (u) => as('EMP', u);
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
let seq = 0;
const uid = (k = 'r') => `${k}-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}`;
const ist = (n = 0) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

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
  const des = org("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (1, 'SE', 'Site Engineer', 'G3', 3, 't', 'test')");
  const p1 = org("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 't', 'test')");
  const s1 = org("INSERT INTO org_sites (company_id, org_project_id, code, name, status, latitude, longitude, geofence_type, geofence_radius_m, created_by, source_type) VALUES (1, ?, 'S1', 'Ring Road North', 'ACTIVE', 18.5204, 73.8567, 'CIRCLE', 200, 't', 'test')", p1);
  let n = 0;
  const mkEmp = (o = {}) => { n += 1; return org("INSERT INTO hr_employees (company_id, emp_code, first_name, full_name, name_key, gender, dob, mobile, department_id, designation_id, grade, employment_type, doj, location_type, employment_status, record_status, user_id, manager_id, site_id, project_id, created_by, source_type) VALUES (1, ?, 'E', ?, ?, 'MALE', '1990-01-01', ?, ?, ?, 'G3', 'PERMANENT', '2026-01-01', 'SITE', 'ACTIVE', 'APPROVED', ?, ?, ?, ?, 't', 'test')", o.code ?? `E${n}`, o.name ?? `Employee ${n}`, `e${n}`, `91000${String(n).padStart(5, '0')}`, dept, des, o.userId ?? null, o.managerId ?? null, s1, p1); };
  // a line: head (mgr1) <- lead (lead1) <- a, b ; head <- c ; and a stranger (str1) in the same company
  const head = mkEmp({ code: 'M1', name: 'Meera Head', userId: mkUser('mgr1', ['EMP']) });
  const lead = mkEmp({ code: 'L1', name: 'Lalit Lead', userId: mkUser('lead1', ['EMP']), managerId: head });
  const a = mkEmp({ code: 'A1', name: 'Asha Kulkarni', userId: mkUser('emp1', []), managerId: lead });
  const b = mkEmp({ code: 'B1', name: 'Bhanu Rao', userId: mkUser('emp2', []), managerId: lead });
  const c = mkEmp({ code: 'C1', name: 'Chitra Iyer', userId: mkUser('emp3', []), managerId: head });
  const stranger = mkEmp({ code: 'S1', name: 'Sanjay Stranger', userId: mkUser('str1', []) });
  api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (2, 'hr9', 'HR9', '[\"HRMGR\"]', 'hr9@example.com')").run();
  const hrEmp = mkEmp({ code: 'H1', name: 'Hema HR', userId: user.hr3 });
  const call = (who, method, path, body, key) => api.call(method, path, { ...who, headers: key ? { ...json, 'idempotency-key': key } : json, body });
  const post = (who, path, body) => call(who, 'POST', path, body, uid());
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
    assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: { ...json, 'idempotency-key': uid('a') }, body: { action, comment: 'checked it' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  const punch = (e, date, type, hhmm) => org("INSERT INTO att_punches (company_id, person_type, person_id, punch_site_id, punch_type, work_date, device_time, server_time, effective_time, method, recorded_by, client_uuid, result, project_id, site_id, created_by, source_type) VALUES (1, 'EMPLOYEE', ?, ?, ?, ?, ?, ?, ?, 'MOBILE', 't', ?, 'ACCEPTED', ?, ?, 't', 'test')", e, s1, type, date, new Date(Date.parse(`${date}T${hhmm}:00Z`) - 19_800_000).toISOString(), new Date(Date.parse(`${date}T${hhmm}:00Z`) - 19_800_000).toISOString(), new Date(Date.parse(`${date}T${hhmm}:00Z`) - 19_800_000).toISOString(), uid('u'), p1, s1);
  const daily = (e, date, status, extra = {}) => org("INSERT INTO att_daily (company_id, person_type, person_id, work_date, daily_site_id, status, in_time, out_time, worked_minutes, paid_day, lop_day, late, computed_at, period_start, created_by, source_type) VALUES (1, 'EMPLOYEE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 't', 'test')", e, date, s1, status, extra.in ?? null, extra.out ?? null, extra.worked ?? 0, extra.paid ?? (status === 'ABSENT' ? 0 : 1), extra.lop ?? (status === 'ABSENT' ? 1 : 0), extra.late ?? 0, new Date().toISOString(), `${date.slice(0, 7)}-01`);
  return { api, call, post, act, punch, daily, org, ids: { head, lead, a, b, c, stranger, hrEmp, s1, p1 }, user };
};

test('T-01 BR-01 a manager does not see the bank details of a reportee; an employee does not see the attendance of anybody else', async () => {
  const t = await setup();
  const { a, b, stranger, lead } = t.ids;
  t.org("INSERT INTO hr_employee_banks (company_id, employee_id, account_enc, account_hash, account_last4, ifsc, account_name, bank_status, is_primary, created_by, source_type) VALUES (1, ?, 'enc', 'hash', '4321', 'SBIN0001234', 'Asha Kulkarni', 'ACTIVE', 1, 't', 'test')", a);
  // the manager's own view of a reportee: basic data only
  const rec = (await t.call(as('PM', 'lead1'), 'GET', `${H}/employees/${a}`)).json;
  assert.equal(rec.error, undefined, JSON.stringify(rec));
  const text = JSON.stringify(rec.data);
  assert.equal(/4321|SBIN0001234|account|pan\b|aadhaar/i.test(text), false, `no bank or ID details to a manager: ${(text.match(/.{30}(4321|SBIN0001234|account|pan\b|aadhaar).{30}/i) ?? [])[0]}`);
  const m = (await t.call(as('EMP', 'lead1'), 'GET', `${H}/ess/team/members/${a}`)).json.data;
  assert.equal(JSON.stringify(m).match(/4321|SBIN|mobile|dob|account|address/i), null);
  assert.equal(m.name, 'Asha Kulkarni');
  // HR sees the account (masked), the employee sees theirs
  assert.match(JSON.stringify((await t.call(hr1, 'GET', `${H}/employees/${a}`)).json.data), /4321/);
  // an employee and the attendance of others
  assert.equal((await t.call(emp('emp1'), 'GET', `${A}/day?employeeId=${b}&date=${ist(-1)}`)).status, 403);
  assert.equal((await t.call(emp('emp1'), 'GET', `${A}/register?period=${ist(-1)}`)).status, 403);
  assert.equal((await t.call(emp('emp1'), 'GET', `${A}/daily`)).status, 403);
  assert.equal((await t.call(emp('emp1'), 'GET', `${H}/ess/team/members/${b}`)).status, 404, 'a colleague is not a reportee');
  assert.equal((await t.call(emp('lead1'), 'GET', `${H}/ess/team/members/${stranger}`)).status, 404);
  assert.equal((await t.call(emp('lead1'), 'GET', `${H}/ess/team/members/${lead}`)).status, 404, 'nor is oneself');
  // the calendar is the person's own
  t.daily(a, ist(-1), 'PRESENT', { in: `${ist(-1)}T09:00`, out: `${ist(-1)}T18:00`, worked: 480 }); t.daily(b, ist(-1), 'ABSENT');
  const mine = (await t.call(emp('emp1'), 'GET', `${H}/ess/attendance?month=${ist(-1).slice(0, 7)}`)).json.data;
  assert.equal(mine.employeeId, a); assert.deepEqual(mine.days.map((d) => d.status), ['PRESENT']);
  assert.equal((await t.call(emp('emp1'), 'GET', `${H}/ess/attendance?employeeId=${b}`)).status, 400, 'no way to name somebody else');
});

test('FR-02 BR-01 the team of a manager is the people who report to them, directly or through others: presence, approvals waiting, who is away', async () => {
  const t = await setup();
  const { a, b, c, lead, head, stranger } = t.ids;
  await t.post(hr1, `${H}/leave/accrual/run`, { from: `${ist(0).slice(0, 4)}-01-01`, to: ist(0) });
  // today: a is in, b has leave approved, c has nothing yet; yesterday b was absent
  t.punch(a, ist(0), 'IN', '09:05');
  const types = (await t.call(hr1, 'GET', `${H}/leave/types`)).json.data;
  t.org("INSERT INTO lv_applications (company_id, doc_no, doc_date, employee_id, leave_type_id, doc_site_id, from_date, to_date, half_day, days, leave_year, reason, status, created_by, source_type) VALUES (1, 'LV-X1', ?, ?, ?, ?, ?, ?, 'NONE', 1, ?, 'Family', 'APPROVED', 't', 'test')", ist(0), b, types[0].id, t.ids.s1, ist(0), ist(0), Number(ist(0).slice(0, 4)));
  t.org("INSERT INTO lv_applications (company_id, doc_no, doc_date, employee_id, leave_type_id, doc_site_id, from_date, to_date, half_day, days, leave_year, reason, status, created_by, source_type) VALUES (1, 'LV-X2', ?, ?, ?, ?, ?, ?, 'NONE', 2, ?, 'Wedding', 'SUBMITTED', 't', 'test')", ist(0), c, types[0].id, t.ids.s1, ist(3), ist(4), Number(ist(0).slice(0, 4)));
  const m = (await t.call(emp('mgr1'), 'GET', `${H}/ess/team`)).json.data;
  assert.deepEqual(m.members.map((x) => x.code).sort(), ['A1', 'B1', 'C1', 'L1'], 'direct and indirect reportees, nobody else');
  assert.equal(m.members.find((x) => x.code === 'L1').direct, true); assert.equal(m.members.find((x) => x.code === 'A1').direct, false);
  const byCode = Object.fromEntries(m.members.map((x) => [x.code, x]));
  assert.deepEqual([byCode.A1.status, byCode.B1.status, byCode.C1.status], ['WORKING', 'ON_LEAVE', 'NOT_IN']);
  assert.equal(byCode.A1.inTime, '09:05'); assert.equal(byCode.B1.leaveType, 'Casual leave');
  assert.deepEqual(m.summary, { total: 4, present: 1, onLeave: 1, absent: 0, notIn: 2, late: 0 });
  assert.equal(m.away.length, 2); assert.deepEqual(m.away.map((x) => [x.name, x.waiting]), [['Bhanu Rao', false], ['Chitra Iyer', true]]);
  // the lead sees two, a colleague none, the stranger none
  assert.deepEqual((await t.call(emp('lead1'), 'GET', `${H}/ess/team`)).json.data.members.map((x) => x.code).sort(), ['A1', 'B1']);
  assert.equal((await t.call(emp('emp1'), 'GET', `${H}/ess/team`)).json.data.members.length, 0);
  assert.equal((await t.call(emp('str1'), 'GET', `${H}/ess/team`)).json.data.members.length, 0);
  assert.equal(m.members.some((x) => x.code === 'S1'), false);
  // a past day: the register's rows decide
  t.daily(a, ist(-2), 'ABSENT'); t.daily(b, ist(-2), 'PRESENT', { in: `${ist(-2)}T09:00`, out: `${ist(-2)}T18:00`, worked: 480 });
  const past = (await t.call(emp('lead1'), 'GET', `${H}/ess/team?date=${ist(-2)}`)).json.data;
  assert.deepEqual([past.members.find((x) => x.code === 'A1').status, past.members.find((x) => x.code === 'B1').status, past.summary.absent], ['ABSENT', 'PRESENT', 1]);
  // approvals waiting for the manager: the lead is the manager of the leave of c? no: c reports to the head, who decides through the inbox
  const done = (await t.post(emp('emp1'), `${H}/applications`, { employeeId: a, leaveTypeId: types[0].id, fromDate: ist(5), toDate: ist(5), halfDay: 'NONE', reason: 'Family function', submit: true })).json;
  assert.ok(done.data, JSON.stringify(done));
  const lm = (await t.call(emp('lead1'), 'GET', `${H}/ess/team`)).json.data;
  assert.equal(lm.approvals.leave, 1); assert.equal(lm.approvalsTotal, 1);
  assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM hr_employees').get().n >= 7, true);
  void head; void stranger; void lead;
});

test('FR-01 my home: today, the month, the balances, what waits for me; a user with no employee record is told so', async () => {
  const t = await setup();
  const { a } = t.ids;
  await t.post(hr1, `${H}/leave/accrual/run`, { from: `${ist(0).slice(0, 4)}-01-01`, to: ist(0) });
  t.punch(a, ist(0), 'IN', '09:10');
  t.daily(a, `${ist(0).slice(0, 7)}-01`, 'PRESENT', { in: '09:00', out: '18:00', worked: 480 }); t.daily(a, `${ist(0).slice(0, 7)}-02`, 'ABSENT');
  const types = (await t.call(hr1, 'GET', `${H}/leave/types`)).json.data;
  await t.post(emp('emp1'), `${H}/applications`, { employeeId: a, leaveTypeId: types[0].id, fromDate: ist(6), toDate: ist(6), halfDay: 'NONE', reason: 'Family function', submit: true });
  await t.post(emp('emp1'), `${H}/regularisations`, { employeeId: a, workDate: ist(-1), requestedIn: `${ist(-1)}T09:00`, requestedOut: `${ist(-1)}T18:00`, reason: 'The reader failed at the gate', submit: true });
  const ch = await t.post(emp('emp1'), `${H}/employees/me/changes`, { type: 'PROFILE', changes: { mobile: '9811122233' }, reason: 'New number' });
  assert.equal(ch.status, 202, JSON.stringify(ch.json));
  const h = (await t.call(emp('emp1'), 'GET', `${H}/ess/home`)).json.data;
  assert.deepEqual([h.employee.code, h.today.status, h.today.inTime], ['A1', 'WORKING', '09:10']);
  assert.ok(h.balances.some((b) => b.code === 'CL' && b.remaining > 0)); assert.equal(h.month.absent >= 0, true);
  assert.deepEqual([h.pending.leave, h.pending.regularisations, h.pending.profile, h.isManager], [1, 1, 1, false]);
  assert.equal((await t.call(emp('lead1'), 'GET', `${H}/ess/home`)).json.data.isManager, true);
  const list = (await t.call(emp('emp1'), 'GET', `${H}/ess/profile-changes`)).json.data;
  assert.equal(list.length, 1); assert.deepEqual([list[0].type, list[0].status], ['PROFILE', 'PENDING']);
  // someone with no employee record
  const r = await t.call(hr1, 'GET', `${H}/ess/home`);
  assert.equal(r.status, 422); assert.equal(r.json.error.code, 'NO_EMPLOYEE');
  assert.equal((await t.call(as('HRMGR', 'hr9', '2'), 'GET', `${H}/ess/home`)).status, 422, 'another company: no employee of theirs');
  assert.equal(essOf(t.api.db).reporteesOf(t.ids.head).length, 4);
});

test('FR-03 a letter: the employee asks, the HR manager approves, HR issues it from the template library, the employee downloads it; nobody else can', async () => {
  const t = await setup();
  const { a } = t.ids;
  assert.equal((await t.post(emp('emp1'), `${H}/ess/letters`, { letterType: 'EMPLOYMENT', purpose: 'x' })).status, 400);
  assert.equal((await t.post(emp('emp1'), `${H}/ess/letters`, { letterType: 'WAGES', purpose: 'A bank loan' })).status, 400);
  const draft = (await t.post(emp('emp1'), `${H}/ess/letters`, { letterType: 'EMPLOYMENT', purpose: 'a bank loan for a house', addressedTo: 'The Branch Manager, SBI' })).json.data;
  assert.equal(draft.status, 'DRAFT'); assert.match(draft.docNo, /^LTR-/); assert.equal(draft.employeeId, a);
  assert.equal((await t.call(emp('emp2'), 'GET', `${H}/ess/letters/${draft.id}`)).status, 404, 'nobody else sees it');
  assert.equal((await t.post(emp('emp2'), `${H}/ess/letters/${draft.id}/submit`, {})).status, 404);
  const sub = await t.post(emp('emp1'), `${H}/ess/letters/${draft.id}/submit`, {});
  assert.equal(sub.status, 202); const inst = sub.json.data.workflowInstanceId;
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, emp('emp1'))).json.data.rows.some((x) => x.instance.id === inst), false, 'the employee does not decide');
  assert.equal((await t.post(hr1, `${H}/ess/letters/${draft.id}/issue`, {})).status, 422, 'not approved yet');
  await t.act(hr1, inst);
  const ok = (await t.call(emp('emp1'), 'GET', `${H}/ess/letters/${draft.id}`)).json.data; assert.equal(ok.status, 'APPROVED'); assert.equal(ok.can.issue, false); assert.equal(ok.can.download, false);
  assert.equal((await t.post(emp('emp1'), `${H}/ess/letters/${draft.id}/issue`, {})).status, 403, 'the employee does not issue their own letter');
  assert.equal((await t.call(emp('emp1'), 'GET', `${H}/ess/letters/${draft.id}/content`)).status, 422, 'not issued yet');
  const queue = (await t.call(hr1, 'GET', `${H}/ess/letters?scope=all`)).json.data; assert.equal(queue[0].id, draft.id);
  assert.equal((await t.call(emp('emp1'), 'GET', `${H}/ess/letters?scope=all`)).status, 403);
  const issued = await t.post(hr1, `${H}/ess/letters/${draft.id}/issue`, {});
  assert.equal(issued.status, 201, JSON.stringify(issued.json));
  assert.equal(issued.json.data.status, 'ISSUED'); assert.ok(issued.json.data.generatedDocId);
  const pdf = await t.api.raw('GET', `${H}/ess/letters/${draft.id}/content`, emp('emp1'));
  assert.equal(pdf.status, 200, pdf.buffer.toString().slice(0, 200)); assert.equal(pdf.buffer.subarray(0, 4).toString(), '%PDF');
  assert.equal((await t.api.raw('GET', `${H}/ess/letters/${draft.id}/content`, emp('emp2'))).status, 404);
  assert.equal((await t.api.raw('GET', `${H}/ess/letters/${draft.id}/content`, hr1)).status, 200, 'HR may open it');
  assert.equal((await t.post(hr1, `${H}/ess/letters/${draft.id}/issue`, {})).status, 422, 'issued once');
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type IN ('ess.letter.approved', 'ess.letter.issued')").get().n, 2);
  // a salary certificate states the salary HR gives; a returned request is corrected and sent again; a rejected one is final
  const sal = (await t.post(emp('emp2'), `${H}/ess/letters`, { letterType: 'SALARY', purpose: 'a visa application', submit: true })).json.data;
  await t.act(hr1, sal.workflowInstanceId, 'return');
  assert.equal((await t.call(emp('emp2'), 'GET', `${H}/ess/letters/${sal.id}`)).json.data.status, 'RETURNED');
  const fixed = await t.call(emp('emp2'), 'PATCH', `${H}/ess/letters/${sal.id}`, { letterType: 'SALARY', purpose: 'a visa application for the UK', addressedTo: null, version: (await t.call(emp('emp2'), 'GET', `${H}/ess/letters/${sal.id}`)).json.data.rowVersion }, uid());
  assert.equal(fixed.status, 200, JSON.stringify(fixed.json));
  assert.equal((await t.post(emp('emp2'), `${H}/ess/letters/${sal.id}/submit`, {})).status, 202);
  await t.act(hr2, sal.workflowInstanceId);
  assert.equal((await t.post(hr1, `${H}/ess/letters/${sal.id}/issue`, {})).status, 400, 'the salary is needed');
  const si = await t.post(hr1, `${H}/ess/letters/${sal.id}/issue`, { salaryMonthly: 45000 });
  assert.equal(si.status, 201, JSON.stringify(si.json));
  const rej = (await t.post(emp('emp3'), `${H}/ess/letters`, { letterType: 'NOC', purpose: 'a course abroad', submit: true })).json.data;
  await t.act(hr1, rej.workflowInstanceId, 'reject');
  assert.equal((await t.call(emp('emp3'), 'GET', `${H}/ess/letters/${rej.id}`)).json.data.status, 'REJECTED');
  // withdraw, delete, cancel, history; the HR manager's own letter is decided by another HR manager
  const w = (await t.post(emp('emp3'), `${H}/ess/letters`, { letterType: 'NOC', purpose: 'a course in Pune', submit: true })).json.data;
  assert.equal((await t.post(emp('emp3'), `${H}/ess/letters/${w.id}/withdraw`, { reason: 'Not needed any more' })).json.data.status, 'DRAFT');
  assert.equal((await t.call(emp('emp3'), 'DELETE', `${H}/ess/letters/${w.id}`)).status, 200);
  const own = (await t.post(as('HRMGR', 'hr3'), `${H}/ess/letters`, { letterType: 'EMPLOYMENT', purpose: 'a rental agreement', submit: true })).json.data;
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, as('HRMGR', 'hr3'))).json.data.rows.some((x) => x.instance.id === own.workflowInstanceId), false);
  const h = (await t.call(emp('emp1'), 'GET', `${H}/ess/letters/${draft.id}/history`)).json.data; assert.ok(h.approvals.length >= 1 && h.audit.some((x) => x.action === 'issue'));
  // idempotent create
  const k = uid('k'); const b = { letterType: 'NOC', purpose: 'a course in Mumbai' };
  const one = await t.call(emp('emp3'), 'POST', `${H}/ess/letters`, b, k); const two = await t.call(emp('emp3'), 'POST', `${H}/ess/letters`, b, k);
  assert.equal(one.json.data.id, two.json.data.id);
  assert.equal((await t.call(emp('emp3'), 'POST', `${H}/ess/letters`, b)).status, 400);
});
