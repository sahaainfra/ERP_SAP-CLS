import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { registerOf } from '../src/server/modules/hr/att-register.js';
import { leaveOf } from '../src/server/modules/hr/leave.js';
import { accrualsFor, countDays, yearEnd } from '../src/server/modules/hr/lv-calc.js';
import { setupCompany, startApi } from './helpers.js';

// Part 07.07: leave. T-01 the sandwich rule and half days; T-02 the accrual of a joiner in the middle of a month is pro-rated. Also: the rules of a type (balance, maximum run, certificate, gender, service, overlap), apply, approve (the ledger is charged,
// the attendance register shows leave, the approver is delegated), cancel and amend, the approval chain (the HR manager beyond 10 days or for a special type; nobody approves their own), balance adjustments, comp-off, the year-end,
// the team calendar and the balance report, scope, idempotency and events.
const H = '/api/v1/hr';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const as = (roles, user, company = '1') => ({ roles, user, company });
const hr1 = as('HRMGR', 'hr1'); const hr2 = as('HRMGR', 'hr2'); const pm1 = as('PM', 'pm1'); const pay1 = as('PAY', 'pay1'); const mgr = as('EMP', 'mgr1');
const emp = (n) => as('EMP', `emp${n}`);
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
let seq = 0;
const uid = (k = 'r') => `${k}-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}`;

const setup = async (nEmployees = 3) => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (2, 'TWO', 'Two Infra Pvt Ltd', 'Two', 't', 'test')").run();
  const user = {};
  const mkUser = (n, roles) => { user[n] = Number(api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(1, n, `${n.toUpperCase()} Person`, JSON.stringify(roles), `${n}@example.com`).lastInsertRowid); return user[n]; };
  for (const [n, r] of [['hr1', ['HRMGR']], ['hr2', ['HRMGR']], ['pm1', ['PM']], ['pay1', ['PAY']], ['mgr1', ['PM']], ['cover1', ['PM']]]) mkUser(n, r);
  const org = (sql, ...a) => Number(api.db.prepare(sql).run(...a).lastInsertRowid);
  const dept = org("INSERT INTO org_departments (company_id, code, name, created_by, source_type) VALUES (1, 'ENG', 'Engineering', 't', 'test')");
  const des = org("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (1, 'SE', 'Site Engineer', 'G3', 3, 't', 'test')");
  const p1 = org("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 't', 'test')");
  const s1 = org("INSERT INTO org_sites (company_id, org_project_id, code, name, status, latitude, longitude, geofence_type, geofence_radius_m, created_by, source_type) VALUES (1, ?, 'S1', 'Ring Road North', 'ACTIVE', 18.5204, 73.8567, 'CIRCLE', 200, 't', 'test')", p1);
  let n = 0;
  const mkEmp = (o = {}) => { n += 1; return org("INSERT INTO hr_employees (company_id, emp_code, first_name, full_name, name_key, gender, dob, mobile, department_id, designation_id, grade, employment_type, doj, location_type, employment_status, record_status, user_id, manager_id, site_id, project_id, created_by, source_type) VALUES (1, ?, 'E', ?, ?, ?, '1990-01-01', ?, ?, ?, 'G3', 'PERMANENT', ?, 'SITE', 'ACTIVE', 'APPROVED', ?, ?, ?, ?, 't', 'test')", o.code ?? `E${n}`, o.name ?? `Employee ${n}`, `e${n}`, o.gender ?? 'MALE', `91000${String(n).padStart(5, '0')}`, dept, des, o.doj ?? '2026-01-01', o.userId ?? null, o.managerId ?? null, s1, p1); };
  const deploy = (e) => org("INSERT INTO hr_deployments (company_id, doc_no, doc_date, person_type, person_id, dep_project_id, dep_site_id, from_date, is_primary, status, project_id, site_id, created_by, source_type) VALUES (1, ?, '2026-01-01', 'EMPLOYEE', ?, ?, ?, '2026-01-01', 1, 'APPROVED', ?, ?, 't', 'test')", `DEP-${e}`, e, p1, s1, p1, s1);
  const manager = mkEmp({ name: 'Manager', userId: user.mgr1, code: 'M1' }); deploy(manager);
  const emps = [];
  for (let i = 1; i <= nEmployees; i += 1) { const u = mkUser(`emp${i}`, []); const e = mkEmp({ userId: u, managerId: manager, code: `W${i}` }); deploy(e); emps.push(e); }
  // Monday to Saturday work, Sunday off
  const shift = org("INSERT INTO att_shifts (company_id, code, name, start_minute, end_minute, break_minutes, grace_minutes, half_day_minutes, full_day_minutes, ot_after_minutes, status, created_by, source_type) VALUES (1, 'GEN', 'General', 540, 1080, 60, 15, 240, 480, 480, 'ACTIVE', 't', 'test')");
  org("INSERT INTO att_policies (company_id, code, name, version_no, effective_from, rules_json, band, status, created_by, source_type) VALUES (1, 'PO', 'Policy PO', 1, '2026-01-01', ?, 'STANDARD', 'APPROVED', 't', 'test')", JSON.stringify({ late: { enabled: true, countPerHalfDay: 3 }, earlyGoing: { enabled: true, graceMinutes: 0, countPerHalfDay: 3 }, missingPunch: { mode: 'REGULARISE' }, compOff: { enabled: true, minMinutes: 240, expiryDays: 60 }, ot: { enabled: false } }));
  org("INSERT INTO att_policy_assignments (company_id, scope_type, scope_id, policy_code, shift_id, weekly_off_json, effective_from, created_by, source_type) VALUES (1, 'COMPANY', 0, 'PO', ?, ?, '2026-01-01', 't', 'test')", shift, JSON.stringify({ type: 'FIXED', days: [0] }));
  const call = (who, method, path, body, key) => api.call(method, path, { ...who, headers: key ? { ...json, 'idempotency-key': key } : json, body });
  const post = (who, path, body) => call(who, 'POST', path, body, uid());
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
    assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: { ...json, 'idempotency-key': uid('a') }, body: { action, comment: 'checked it' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  const hasTask = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.some((x) => x.instance.id === instanceId);
  const types = (await call(hr1, 'GET', `${H}/leave/types`)).json.data; const T = Object.fromEntries(types.map((x) => [x.code, x.id]));
  const accrue = async (from = '2026-01-01', to = '2026-12-31') => { const r = await post(hr1, `${H}/leave/accrual/run`, { from, to }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.data; };
  const apply = (who, e, code, fromDate, toDate, o = {}) => post(who, `${H}/applications`, { employeeId: e, leaveTypeId: T[code], fromDate, toDate, halfDay: 'NONE', reason: 'Family function', ...o });
  const bal = async (who, e, code, year = 2026) => (await call(who, 'GET', `${H}/leave/balance?employeeId=${e}&year=${year}`)).json.data.find((b) => b.code === code);
  return { api, call, post, act, hasTask, accrue, apply, bal, T, ids: { p1, s1, manager }, emps, user, mkEmp, deploy, org };
};

test('T-01 BR-01 the sandwich rule and half days: holidays and weekly offs are not leave unless they lie between leave days and the type says so', () => {
  const week = (d) => (new Date(`${d}T00:00:00Z`).getUTCDay() === 0 ? 'WEEKLY_OFF' : d === '2026-08-15' ? 'HOLIDAY' : 'WORKING');
  // Friday 7 August to Monday 10 August: the Sunday is between
  assert.equal(countDays({ from: '2026-08-07', to: '2026-08-10', dayType: week, sandwich: false }).days, 3, 'Friday, Saturday and Monday; the Sunday is not leave');
  const sw = countDays({ from: '2026-08-07', to: '2026-08-10', dayType: week, sandwich: true });
  assert.deepEqual([sw.days, sw.sandwiched], [4, 1], 'with the sandwich rule the Sunday counts');
  // off days at the start or the end are never leave
  assert.equal(countDays({ from: '2026-08-09', to: '2026-08-11', dayType: week, sandwich: true }).days, 2, 'Sunday at the start does not count');
  assert.equal(countDays({ from: '2026-08-08', to: '2026-08-09', dayType: week, sandwich: true }).days, 1, 'Sunday at the end does not count');
  assert.ok(countDays({ from: '2026-08-09', to: '2026-08-09', dayType: week }).error, 'a range of off days only is refused');
  // a holiday inside counts only with the sandwich rule; Friday 14 to Monday 17 has Saturday the 15th as a holiday and the Sunday
  assert.equal(countDays({ from: '2026-08-14', to: '2026-08-17', dayType: week, sandwich: false }).days, 2);
  assert.equal(countDays({ from: '2026-08-14', to: '2026-08-17', dayType: week, sandwich: true }).days, 4);
  // half days
  assert.equal(countDays({ from: '2026-08-05', to: '2026-08-05', half: 'FIRST', dayType: week }).days, 0.5);
  assert.ok(countDays({ from: '2026-08-05', to: '2026-08-06', half: 'FIRST', dayType: week }).error, 'a half day is for one day');
  assert.ok(countDays({ from: '2026-08-09', to: '2026-08-09', half: 'SECOND', dayType: week }).error, 'a half day on a weekly off is refused');
  assert.equal(countDays({ from: '2026-08-10', to: '2026-08-12', dayType: week }).days, 3);
  // year-end of a balance
  assert.deepEqual(yearEnd({ balance: 20, rules: { encashable: true, encashMax: 5, carryForwardMax: 10 } }), { encash: 5, carry: 10, lapse: 5 });
  assert.deepEqual(yearEnd({ balance: 4, rules: { carryForwardMax: 10 } }), { encash: 0, carry: 4, lapse: 0 });
  assert.deepEqual(yearEnd({ balance: -2, rules: { carryForwardMax: 10 } }), { encash: 0, carry: -2, lapse: 0 });
});

test('T-02 FR-02 the accrual of a joiner in the middle of a month is pro-rated; a month is credited once', async () => {
  // pure: monthly quota 12 a year is 1 a month; joined on 16 November of a 30-day month: 15 of 30 days
  const rules = { quota: 12, accrual: 'MONTHLY' };
  assert.deepEqual(accrualsFor({ rules, doj: '2026-11-16', year: 2026, month: 11 }), [{ key: 'M2026-11', days: 0.5 }]);
  assert.deepEqual(accrualsFor({ rules, doj: '2026-11-16', year: 2026, month: 12 }), [{ key: 'M2026-12', days: 1 }]);
  assert.deepEqual(accrualsFor({ rules, doj: '2026-11-16', year: 2026, month: 10 }), [], 'nothing before joining');
  assert.deepEqual(accrualsFor({ rules, doj: '2026-11-01', year: 2026, month: 11 }), [{ key: 'M2026-11', days: 1 }]);
  assert.deepEqual(accrualsFor({ rules: { quota: 12, accrual: 'QUARTERLY' }, doj: '2026-01-01', year: 2026, month: 4 }), [{ key: 'Q2026-2', days: 3 }]);
  assert.deepEqual(accrualsFor({ rules: { quota: 12, accrual: 'QUARTERLY' }, doj: '2026-01-01', year: 2026, month: 5 }), []);
  assert.equal(accrualsFor({ rules: { quota: 12, accrual: 'ANNUAL' }, doj: '2026-07-01', year: 2026, month: 7 })[0].days, 6, 'annual: half a year in service, half the quota');
  // through the service
  const t = await setup(2);
  const joiner = t.mkEmp({ code: 'J1', name: 'Joiner', doj: '2026-11-16' }); t.deploy(joiner);
  const first = await t.accrue('2026-11-01', '2026-12-31');
  assert.ok(first.credited > 0);
  const cl = await t.bal(hr1, joiner, 'CL');
  assert.equal(cl.accrued, 1.5, 'half of November and all of December');
  const again = await t.accrue('2026-11-01', '2026-12-31');
  assert.equal(again.credited, 0, 'a second run adds nothing');
  assert.equal((await t.bal(hr1, joiner, 'CL')).accrued, 1.5);
  // the ledger says why
  const ledger = (await t.call(hr1, 'GET', `${H}/leave/ledger?employeeId=${joiner}&year=2026`)).json.data.filter((l) => l.typeCode === 'CL');
  assert.deepEqual(ledger.map((l) => l.days), [0.5, 1]);
  // the sick leave is annual, pro-rata for the joiner by months: half of November and December is 1.5 of 12 months
  assert.equal((await t.bal(hr1, joiner, 'SL')).accrued, 1.5);
  // a man has no maternity leave
  assert.equal(await t.bal(hr1, joiner, 'ML'), undefined);
  assert.ok(await t.bal(hr1, joiner, 'PL'));
});

test('FR-02 FR-03 the rules of a type: balance, longest run, certificate, gender, service, overlap, one year', async () => {
  const t = await setup(2);
  const [e1] = t.emps;
  await t.accrue('2026-01-01', '2026-12-31');
  const fem = t.mkEmp({ code: 'F1', gender: 'FEMALE' }); t.deploy(fem);
  const newbie = t.mkEmp({ code: 'N1', doj: '2026-07-20' }); t.deploy(newbie);
  const bad = async (res, field) => { assert.equal(res.status, 400, JSON.stringify(res.json)); assert.ok(res.json.error.details.some((d) => d.field === field), JSON.stringify(res.json.error.details)); return res.json.error.details.find((d) => d.field === field).message; };
  // casual leave is at most 3 days at a time
  assert.match(await bad(await t.apply(hr1, e1, 'CL', '2026-08-03', '2026-08-07'), 'toDate'), /at most 3 days/);
  // sick leave over 2 days needs a certificate
  assert.match(await bad(await t.apply(hr1, e1, 'SL', '2026-08-03', '2026-08-05'), 'attachmentFileId'), /certificate/);
  // maternity leave only for women; paternity only for men
  assert.match(await bad(await t.apply(hr1, e1, 'ML', '2026-08-03', '2026-08-04'), 'leaveTypeId'), /does not apply/);
  assert.equal((await t.apply(hr1, fem, 'PL', '2026-08-03', '2026-08-04')).status, 400);
  // earned leave needs 90 days of service
  assert.match(await bad(await t.apply(hr1, newbie, 'EL', '2026-08-03', '2026-08-04'), 'fromDate'), /90 days of service/);
  // half days: not for a type that cannot, one day only
  assert.equal((await t.apply(hr1, e1, 'BL', '2026-08-03', '2026-08-03', { halfDay: 'FIRST' })).status, 400);
  assert.equal((await t.apply(hr1, e1, 'CL', '2026-08-03', '2026-08-04', { halfDay: 'FIRST' })).status, 400);
  // the year, the balance
  assert.match(await bad(await t.apply(hr1, e1, 'CL', '2026-12-31', '2027-01-01'), 'toDate'), /one calendar year/);
  assert.match(await bad(await t.apply(hr1, e1, 'EL', '2026-08-03', '2026-08-31'), 'toDate'), /Not enough|at most/);
  // a leave on the days already covered
  const one = await t.apply(hr1, e1, 'CL', '2026-08-04', '2026-08-05');
  assert.equal(one.status, 201, JSON.stringify(one.json));
  assert.match(await bad(await t.apply(hr1, e1, 'SL', '2026-08-05', '2026-08-05'), 'fromDate'), /already covers/);
  // the preview the form shows
  const pv = (await t.call(emp(1), 'GET', `${H}/leave/check?employeeId=${e1}&leaveTypeId=${t.T.EL}&fromDate=2026-09-04&toDate=2026-09-07`)).json.data;
  assert.deepEqual([pv.days, pv.sandwiched, pv.problems.length], [4, 1, 0], 'earned leave has the sandwich rule: Friday to Monday is four days');
  assert.equal((await t.call(emp(2), 'GET', `${H}/leave/check?employeeId=${e1}&leaveTypeId=${t.T.CL}&fromDate=2026-09-04&toDate=2026-09-04`)).status, 403, 'nobody checks the leave of somebody else');
});

test('FR-03 FR-04 BR-03 apply, approve, cancel: the ledger is charged and given back, the register shows leave, the approver is covered, and the team sees the clash', async () => {
  const t = await setup(3);
  const [e1, e2] = t.emps;
  await t.accrue('2026-01-01', '2026-12-31');
  const before = await t.bal(emp(1), e1, 'CL');
  assert.equal(before.remaining, 12);
  // Asha applies for two days in the past; a colleague of the same manager has applied for the same days
  const other = (await t.apply(emp(2), e2, 'CL', '2026-08-05', '2026-08-06', { submit: true })).json.data;
  assert.equal(other.status, 'SUBMITTED');
  const made = await t.apply(emp(1), e1, 'CL', '2026-08-05', '2026-08-06', { submit: true });
  assert.ok([201, 202].includes(made.status), JSON.stringify(made.json));
  const app = made.json.data;
  assert.equal(app.status, 'SUBMITTED'); assert.equal(app.band, 'STANDARD'); assert.match(app.docNo, /^LV-/); assert.equal(app.days, 2);
  const pv = (await t.call(emp(1), 'GET', `${H}/leave/check?employeeId=${e1}&leaveTypeId=${t.T.CL}&fromDate=2026-08-05&toDate=2026-08-05`)).json.data;
  assert.equal(pv.clashes.length, 1, 'the team calendar clash is shown'); assert.equal(pv.problems[0]?.message.match(/already covers/) !== null, true);
  // waiting for approval reserves the days
  const mid = await t.bal(emp(1), e1, 'CL'); assert.deepEqual([mid.remaining, mid.reserved, mid.available], [12, 2, 10]);
  // the requester cannot approve; the reporting manager can
  assert.equal(await t.hasTask(emp(1), app.workflowInstanceId), false);
  assert.equal(await t.hasTask(hr1, app.workflowInstanceId), false, 'it goes to the reporting manager, not to the HR manager');
  const list = (await t.call(mgr, 'GET', `${H}/leave/approvals`)).json.data;
  assert.equal(list.length, 2); assert.ok(list.find((x) => x.docNo === app.docNo).clashes.length >= 1);
  await t.act(mgr, app.workflowInstanceId);
  const done = (await t.call(emp(1), 'GET', `${H}/applications/${app.id}`)).json.data;
  assert.equal(done.status, 'APPROVED');
  const after = await t.bal(emp(1), e1, 'CL'); assert.deepEqual([after.availed, after.remaining, after.reserved], [2, 10, 0]);
  // the event and the register (BR-03)
  const ev = t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'lv.application.approved'").all().map((r) => JSON.parse(r.payload));
  assert.equal(ev.length, 1); assert.ok(JSON.stringify(ev[0]).includes('"days":2'));
  registerOf(t.api.db).flushChanges();
  const rows = t.api.db.prepare("SELECT work_date, status, source, paid_day FROM att_daily WHERE person_id = ? AND work_date BETWEEN '2026-08-05' AND '2026-08-06' ORDER BY work_date").all(e1);
  assert.deepEqual(rows.map((r) => [r.status, r.source, r.paid_day]), [['ON_LEAVE', 'LEAVE', 1], ['ON_LEAVE', 'LEAVE', 1]]);
  // a started leave is not cancelled: it is amended; the ledger shows the lines
  assert.equal((await t.post(emp(1), `${H}/applications/${app.id}/cancel`, { reason: 'Plans changed' })).status, 422);
  const am = await t.post(emp(1), `${H}/applications/${app.id}/amend`, { reason: 'Back after one day' });
  assert.equal(am.status, 201); assert.equal(am.json.data.revision, 2);
  const upd = await t.call(emp(1), 'PATCH', `${H}/applications/${am.json.data.id}`, { leaveTypeId: t.T.CL, fromDate: '2026-08-05', toDate: '2026-08-05', halfDay: 'NONE', reason: 'Back after one day', version: am.json.data.rowVersion }, uid());
  assert.equal(upd.status, 200, JSON.stringify(upd.json));
  const sub = await t.post(emp(1), `${H}/applications/${am.json.data.id}/submit`, {});
  await t.act(mgr, sub.json.data.workflowInstanceId);
  const am2 = await t.bal(emp(1), e1, 'CL'); assert.deepEqual([am2.availed, am2.remaining], [1, 11], 'the amendment gave one day back');
  assert.equal((await t.call(emp(1), 'GET', `${H}/applications/${app.id}`)).json.data.status, 'SUPERSEDED');
  registerOf(t.api.db).flushChanges();
  assert.equal(t.api.db.prepare("SELECT status FROM att_daily WHERE person_id = ? AND work_date = '2026-08-06'").get(e1).status, 'ABSENT', 'the day not taken is absent again');
  // a future leave is cancelled directly: the days go back and the event goes out
  const fut = (await t.apply(emp(1), e1, 'CL', '2026-12-14', '2026-12-15', { submit: true })).json.data;
  await t.act(mgr, fut.workflowInstanceId);
  assert.equal((await t.bal(emp(1), e1, 'CL')).remaining, 9);
  const c = await t.post(emp(1), `${H}/applications/${fut.id}/cancel`, { reason: 'Plans changed' });
  assert.equal(c.status, 200, JSON.stringify(c.json)); assert.equal(c.json.data.status, 'CANCELLED');
  assert.equal((await t.bal(emp(1), e1, 'CL')).remaining, 11);
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'lv.application.cancelled'").get().n, 1);
  // withdraw, return and resubmit, reject
  const w = (await t.apply(emp(1), e1, 'CL', '2026-09-01', '2026-09-01', { submit: true })).json.data;
  assert.equal((await t.post(emp(1), `${H}/applications/${w.id}/withdraw`, { reason: 'Not needed' })).json.data.status, 'DRAFT');
  assert.equal((await t.post(emp(1), `${H}/applications/${w.id}/submit`, {})).status, 202);
  const w2 = (await t.call(emp(1), 'GET', `${H}/applications/${w.id}`)).json.data;
  await t.act(mgr, w2.workflowInstanceId, 'return');
  assert.equal((await t.call(emp(1), 'GET', `${H}/applications/${w.id}`)).json.data.status, 'RETURNED');
  assert.equal((await t.post(emp(1), `${H}/applications/${w.id}/submit`, {})).status, 202);
  await t.act(mgr, w2.workflowInstanceId, 'reject');
  assert.equal((await t.call(emp(1), 'GET', `${H}/applications/${w.id}`)).json.data.status, 'REJECTED');
  assert.equal((await t.bal(emp(1), e1, 'CL')).remaining, 11, 'a rejected leave costs nothing');
  // the history and the print
  const h = (await t.call(emp(1), 'GET', `${H}/applications/${app.id}/history`)).json.data; assert.ok(h.approvals.length >= 2 && h.audit.length >= 2);
  assert.equal((await t.api.raw('GET', `${H}/applications/${app.id}/print`, emp(1))).status, 200);
});

test('FR-04 the chain: the HR manager also decides beyond 10 days or for a special type; delegation covers the approver while on leave', async () => {
  const t = await setup(2);
  const [e1] = t.emps;
  await t.accrue('2026-01-01', '2026-12-31');
  // 12 days of leave without pay (a long leave) go to the manager and the HR manager
  const long = (await t.apply(emp(1), e1, 'LOP', '2026-08-03', '2026-08-15', { submit: true })).json.data;
  assert.equal(long.band, 'EXTENDED'); assert.equal(long.days, 13);
  await t.act(mgr, long.workflowInstanceId);
  assert.equal((await t.call(emp(1), 'GET', `${H}/applications/${long.id}`)).json.data.status, 'SUBMITTED', 'waits for the HR manager');
  await t.act(hr1, long.workflowInstanceId);
  assert.equal((await t.call(emp(1), 'GET', `${H}/applications/${long.id}`)).json.data.status, 'APPROVED');
  // unpaid leave is leave without pay: the register shows it as a loss
  registerOf(t.api.db).flushChanges();
  const lop = t.api.db.prepare("SELECT status, paid_day, lop_day FROM att_daily WHERE person_id = ? AND work_date = '2026-08-04'").get(e1);
  assert.deepEqual([lop.status, lop.paid_day, lop.lop_day], ['ON_LEAVE', 0, 1]);
  // a special type (bereavement) also goes to the HR manager, even for one day
  const sp = (await t.apply(emp(1), e1, 'BL', '2026-09-01', '2026-09-01', { submit: true })).json.data;
  assert.equal(sp.band, 'EXTENDED');
  // the manager is away: the cover is named, and the delegation is made and ended
  const mEmp = t.ids.manager;
  const away = (await t.post(mgr, `${H}/applications`, { employeeId: mEmp, leaveTypeId: t.T.LOP, fromDate: '2026-12-21', toDate: '2026-12-23', halfDay: 'NONE', reason: 'Wedding in the family', delegateUser: 'cover1', submit: true })).json.data;
  assert.equal(away.band, 'STANDARD');
  // the manager of the manager: none; so the HR manager decides
  await t.act(hr1, away.workflowInstanceId);
  const d = t.api.db.prepare("SELECT delegator, delegate, status, from_date, to_date FROM wf_delegations WHERE source_type = 'lv_application'").all();
  assert.equal(d.length, 1); assert.deepEqual([d[0].delegator, d[0].delegate, d[0].status, d[0].to_date], ['mgr1', 'cover1', 'ACTIVE', '2026-12-23']);
  const c = await t.post(mgr, `${H}/applications/${away.id}/cancel`, { reason: 'The wedding was moved' });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.equal(t.api.db.prepare("SELECT status FROM wf_delegations WHERE source_type = 'lv_application'").get().status, 'REVOKED');
  // the cover cannot be oneself
  assert.equal((await t.post(mgr, `${H}/applications`, { employeeId: mEmp, leaveTypeId: t.T.LOP, fromDate: '2026-12-28', toDate: '2026-12-28', halfDay: 'NONE', reason: 'A day off', delegateUser: 'mgr1' })).status, 400);
});

test('FR-05 a balance adjustment is asked for by HR and decided by another HR manager; it cannot take a balance below what the type allows', async () => {
  const t = await setup(2);
  const [e1] = t.emps;
  await t.accrue('2026-01-01', '2026-12-31');
  assert.equal((await t.post(emp(1), `${H}/leave/adjustments`, { employeeId: e1, leaveTypeId: t.T.EL, year: 2026, days: 5, reason: 'Opening balance of the old system' })).status, 403);
  const bad = await t.post(hr1, `${H}/leave/adjustments`, { employeeId: e1, leaveTypeId: t.T.CL, year: 2026, days: -20, reason: 'Correction' });
  assert.equal(bad.status, 400);
  const a = (await t.post(hr1, `${H}/leave/adjustments`, { employeeId: e1, leaveTypeId: t.T.EL, year: 2026, days: 5, reason: 'Opening balance of the old system', submit: true })).json.data;
  assert.equal(a.status, 'SUBMITTED'); assert.match(a.docNo, /^LVA-/);
  assert.equal(await t.hasTask(hr1, a.workflowInstanceId), false, 'the maker is not the checker');
  const before = (await t.bal(hr1, e1, 'EL')).remaining;
  await t.act(hr2, a.workflowInstanceId);
  const b = await t.bal(hr1, e1, 'EL');
  assert.equal(b.remaining, before + 5); assert.equal(b.adjusted, 5);
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'lv.balance.adjusted'").get().n, 1);
  assert.equal((await t.call(hr1, 'GET', `${H}/leave/adjustments`)).json.data.length, 1);
  const ledger = (await t.call(hr1, 'GET', `${H}/leave/ledger?employeeId=${e1}&typeId=${t.T.EL}&year=2026`)).json.data;
  assert.ok(ledger.some((l) => l.type === 'ADJUSTMENT' && l.days === 5));
});

test('FR-06 comp-off earned by working on a day off is credited once, valid for its days, and lapses when it expires unused', async () => {
  const t = await setup(2);
  const [e1] = t.emps;
  const day = t.org("INSERT INTO att_daily (company_id, person_type, person_id, work_date, daily_site_id, status, worked_minutes, paid_day, comp_off, computed_at, period_start, created_by, source_type) VALUES (1, 'EMPLOYEE', ?, '2026-08-09', ?, 'WEEKLY_OFF_WORKED', 480, 1, 1, ?, '2026-08-01', 't', 'test')", e1, t.ids.s1, new Date().toISOString());
  const svc = leaveOf(t.api.db);
  assert.equal(svc.creditCompOff(1, '2026-08-01', '2026-08-31').credited, 1);
  assert.equal(svc.creditCompOff(1, '2026-08-01', '2026-08-31').credited, 0, 'once');
  const co = await t.bal(hr1, e1, 'CO'); assert.deepEqual([co.accrued, co.remaining], [1, 1]);
  const led = (await t.call(hr1, 'GET', `${H}/leave/ledger?employeeId=${e1}&typeId=${t.T.CO}&year=2026`)).json.data;
  assert.equal(led[0].expiresOn, '2026-10-08');
  assert.equal(svc.lapseCompOff(1, '2026-09-01').lapsed, 0, 'not expired yet');
  assert.equal(svc.lapseCompOff(1, '2026-10-09').lapsed, 1);
  assert.equal((await t.bal(hr1, e1, 'CO')).remaining, 0);
  assert.equal(svc.lapseCompOff(1, '2026-10-10').lapsed, 0, 'and only once');
  void day;
  // a comp-off taken before it expires does not lapse
  t.org("INSERT INTO att_daily (company_id, person_type, person_id, work_date, daily_site_id, status, worked_minutes, paid_day, comp_off, computed_at, period_start, created_by, source_type) VALUES (1, 'EMPLOYEE', ?, '2026-08-16', ?, 'WEEKLY_OFF_WORKED', 480, 1, 0.5, ?, '2026-08-01', 't', 'test')", e1, t.ids.s1, new Date().toISOString());
  svc.creditCompOff(1, '2026-08-01', '2026-08-31');
  const used = (await t.apply(emp(1), e1, 'CO', '2026-08-24', '2026-08-24', { halfDay: 'FIRST', submit: true })).json.data;
  await t.act(mgr, used.workflowInstanceId);
  assert.equal((await t.bal(hr1, e1, 'CO')).remaining, 0);
  assert.equal(svc.lapseCompOff(1, '2026-12-01').lapsed, 0, 'what was used is not lapsed');
});

test('FR-08 AC-01 year-end: encash up to the limit, carry forward up to the limit, lapse the rest; once; not while applications wait; the payroll inputs go out', async () => {
  const t = await setup(2);
  const [e1, e2] = t.emps;
  t.api.db.prepare("UPDATE hr_employees SET doj = '2025-01-01'").run();
  await t.accrue('2025-01-01', '2025-12-31');
  assert.equal((await t.bal(hr1, e1, 'EL', 2025)).remaining, 18);
  // one person took 4 days of earned leave in 2025
  const took = (await t.apply(emp(1), e1, 'EL', '2025-06-02', '2025-06-05', { submit: true })).json.data;
  await t.act(mgr, took.workflowInstanceId);
  assert.equal((await t.bal(hr1, e1, 'EL', 2025)).remaining, 14);
  // this year is not over; a waiting application blocks the run
  assert.equal((await t.call(hr1, 'GET', `${H}/leave/year-end/preview?year=2026`)).status, 200);
  assert.equal((await t.post(hr1, `${H}/leave/year-end`, { year: 2026 })).status, 422);
  const waiting = (await t.apply(emp(2), e2, 'CL', '2025-12-01', '2025-12-01', { submit: true })).json.data;
  const blocked = await t.post(hr1, `${H}/leave/year-end`, { year: 2025 });
  assert.equal(blocked.status, 409); assert.match(blocked.json.error.message, new RegExp(waiting.docNo));
  await t.act(mgr, waiting.workflowInstanceId, 'reject');
  const pv = (await t.call(hr1, 'GET', `${H}/leave/year-end/preview?year=2025`)).json.data;
  const el1 = pv.rows.find((r) => r.employeeId === e1 && r.type === 'EL');
  assert.deepEqual([el1.balance, el1.encash, el1.carry, el1.lapse], [14, 14, 0, 0], 'the whole balance is within the encashment limit');
  const el2 = pv.rows.find((r) => r.employeeId === e2 && r.type === 'EL');
  assert.deepEqual([el2.balance, el2.encash, el2.carry, el2.lapse], [18, 15, 3, 0]);
  const cl = pv.rows.find((r) => r.employeeId === e2 && r.type === 'CL'); assert.deepEqual([cl.encash, cl.carry, cl.lapse], [0, 0, 12], 'casual leave lapses');
  assert.equal((await t.post(emp(1), `${H}/leave/year-end`, { year: 2025 })).status, 403);
  const run = await t.post(hr1, `${H}/leave/year-end`, { year: 2025 });
  assert.equal(run.status, 201, JSON.stringify(run.json));
  assert.equal(run.json.data.encash, 44); // 14 + 15, and the manager 15
  assert.equal((await t.bal(hr1, e2, 'EL', 2025)).remaining, 0);
  const next = await t.bal(hr1, e2, 'EL', 2026); assert.equal(next.opening, 3);
  assert.equal((await t.bal(hr1, e1, 'CL', 2025)).lapsed, 12);
  assert.equal((await t.post(hr1, `${H}/leave/year-end`, { year: 2025 })).status, 409, 'once');
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'lv.encashment.input'").get().n, 3);
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'lv.year_end.processed'").get().n, 1);
  assert.equal((await t.call(hr1, 'GET', `${H}/leave/year-end`)).json.data[0].year, 2025);
});

test('FR-01 FR-07 AC-03 types are configured by HR; the team calendar and the balance report are scoped and exported; nobody sees the leave of others', async () => {
  const t = await setup(3);
  const [e1, e2] = t.emps;
  await t.accrue('2026-01-01', '2026-12-31');
  assert.equal((await t.call(emp(1), 'GET', `${H}/leave/types`)).status, 403);
  assert.equal((await t.call(emp(1), 'GET', `${H}/leave/type-options?employeeId=${e1}`)).json.data.some((x) => x.code === 'ML'), false, 'a man is not offered maternity leave');
  // a new type, a bad rule, a change with the version
  const rules = { quota: 2, accrual: 'ANNUAL', proRata: false, special: false, allowHalfDay: true, sandwich: false, advanceMax: 0, carryForwardMax: 0, encashable: false, minServiceDays: 0, genders: [], categories: [] };
  assert.equal((await t.post(emp(1), `${H}/leave/types`, { code: 'VOL', name: 'Volunteering leave', paid: true, rules })).status, 403);
  const made = await t.post(hr1, `${H}/leave/types`, { code: 'vol', name: 'Volunteering leave', paid: true, rules });
  assert.equal(made.status, 201, JSON.stringify(made.json)); assert.equal(made.json.data.code, 'VOL');
  assert.equal((await t.post(hr1, `${H}/leave/types`, { code: 'VOL', name: 'Again', paid: true, rules })).status, 409);
  assert.equal((await t.post(hr1, `${H}/leave/types`, { code: 'BAD', name: 'Bad', paid: true, rules: { ...rules, quota: -1 } })).status, 400);
  const up = await t.call(hr1, 'PATCH', `${H}/leave/types/${made.json.data.id}`, { name: 'Volunteering days', paid: true, rules: { ...rules, quota: 3 }, status: 'ACTIVE', version: made.json.data.rowVersion }, uid());
  assert.equal(up.status, 200); assert.equal(up.json.data.rules.quota, 3);
  assert.equal((await t.call(hr1, 'PATCH', `${H}/leave/types/${made.json.data.id}`, { name: 'xx', paid: true, rules, status: 'ACTIVE', version: 1 }, uid())).status, 409, 'a stale version');
  // leave to show
  const l1 = (await t.apply(emp(1), e1, 'CL', '2026-08-05', '2026-08-06', { submit: true })).json.data;
  await t.act(mgr, l1.workflowInstanceId);
  await t.apply(emp(2), e2, 'CL', '2026-08-06', '2026-08-06', { submit: true });
  const cal = (await t.call(pm1, 'GET', `${H}/leave/calendar?from=2026-08-01&to=2026-08-31`)).json.data;
  assert.equal(cal.rows.length, 2); assert.equal(cal.perDay['2026-08-06'], 2); assert.equal(cal.perDay['2026-08-05'], 1);
  assert.equal(cal.rows.find((r) => r.employeeId === e1).cells['2026-08-05'].status, 'APPROVED');
  assert.equal(cal.rows.find((r) => r.employeeId === e2).cells['2026-08-06'].status, 'SUBMITTED');
  assert.equal((await t.call(emp(1), 'GET', `${H}/leave/calendar?from=2026-08-01&to=2026-08-31`)).status, 403);
  assert.equal((await t.call(pm1, 'GET', `${H}/leave/calendar?from=2026-01-01&to=2026-12-31`)).status, 400, 'at most 62 days');
  // my leave, and the applications of others
  const mine = (await t.call(emp(1), 'GET', `${H}/leave/my`)).json.data; assert.equal(mine.employeeId, e1); assert.equal(mine.applications.length, 1);
  assert.equal((await t.call(emp(2), 'GET', `${H}/applications/${l1.id}`)).status, 404);
  assert.equal((await t.call(emp(2), 'GET', `${H}/applications`)).json.data.every((r) => r.employeeId === e2), true);
  assert.equal((await t.call(emp(2), 'GET', `${H}/leave/balance?employeeId=${e1}`)).status, 403);
  assert.equal((await t.post(emp(2), `${H}/applications`, { employeeId: e1, leaveTypeId: t.T.CL, fromDate: '2026-09-01', toDate: '2026-09-01', halfDay: 'NONE', reason: 'Not mine' })).status, 403);
  assert.equal((await t.call(as('HRMGR', 'hr9', '2'), 'GET', `${H}/applications`)).json.data.length, 0, 'another company sees nothing');
  // the report, its filters and totals, the exports
  const rep = (await t.call(hr1, 'GET', `${H}/leave/balances?filter[typeCode]=CL&pageSize=100`)).json;
  assert.equal(rep.data.length, 4); assert.equal(rep.meta.totals.accrued, 48); // three employees and the manager
  assert.equal((await t.call(pay1, 'GET', `${H}/leave/balances`)).status, 200);
  for (const url of [`${H}/leave/balances/export?format=csv`, `${H}/applications/export?format=csv`, `${H}/applications/export?format=xlsx`]) assert.equal((await t.api.raw('GET', url, hr1)).status, 200, url);
  assert.match((await t.api.raw('GET', `${H}/applications/export?format=csv`, hr1)).buffer.toString(), /LV-/);
  assert.equal((await t.api.raw('GET', `${H}/applications/export?format=csv`, emp(1))).status, 403);
  // idempotent replay of a create, and a key is needed
  const k = uid('k'); const b = { employeeId: e1, leaveTypeId: t.T.CL, fromDate: '2026-10-01', toDate: '2026-10-01', halfDay: 'NONE', reason: 'Replay test' };
  const one = await t.call(emp(1), 'POST', `${H}/applications`, b, k); const two = await t.call(emp(1), 'POST', `${H}/applications`, b, k);
  assert.equal(one.json.data.id, two.json.data.id);
  assert.equal((await t.call(emp(1), 'POST', `${H}/applications`, b)).status, 400);
});
