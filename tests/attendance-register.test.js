import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { templateWorkbook } from '../src/server/modules/eng/xl-xlsx.js';
import { registerOf } from '../src/server/modules/hr/att-register.js';
import { punchesOf } from '../src/server/modules/hr/punches.js';
import { setupCompany, startApi } from './helpers.js';

// Part 07.06: the attendance register. T-01 the totals of the register equal an independent recomputation for a 30-day sample; T-02 a locked period turns every change into arrears and its reopening needs approval;
// T-03 an imported device file with duplicates is stored once. Also: the status engine (late marks, early going, missing punch, weekly off worked, half day), regularisation (the fourth in a month also goes to the HR manager),
// overtime (paid up to the hours approved; beyond 4 hours a day also the project manager), manual entries with maker and checker, scope, idempotent replay, exports and the events.
const A = '/api/v1/att';
const H = '/api/v1/hr';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const as = (roles, user, company = '1') => ({ roles, user, company });
const ws2 = as('WSUP', 'ws2'); const hr1 = as('HRMGR', 'hr1'); const hr2 = as('HRMGR', 'hr2'); const pm1 = as('PM', 'pm1'); const ws1 = as('WSUP', 'ws1'); const cfo1 = as('CFO', 'cfo1'); const pay1 = as('PAY', 'pay1'); const se1 = as('SE', 'se1');
const emp = (n) => as('EMP', `emp${n}`);
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
let seq = 0;
const uid = (k = 'r') => `${k}-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}`;
const iso = (date, hhmm) => new Date(Date.parse(`${date}T${hhmm}:00Z`) - 19_800_000).toISOString(); // India time to UTC
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const dayOf = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const FROM = '2026-08-01'; const TO = '2026-08-31'; // a past month: Saturday 1 August, Sundays are the weekly off

const setup = async (nEmployees = 4) => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (2, 'TWO', 'Two Infra Pvt Ltd', 'Two', 't', 'test')").run();
  const user = {};
  const mkUser = (n, roles) => { user[n] = Number(api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(1, n, `${n.toUpperCase()} Person`, JSON.stringify(roles), `${n}@example.com`).lastInsertRowid); return user[n]; };
  for (const [n, r] of [['hr1', ['HRMGR']], ['hr2', ['HRMGR']], ['pm1', ['PM']], ['se1', ['SE']], ['ws1', ['WSUP']], ['ws2', ['WSUP']], ['cfo1', ['CFO']], ['pay1', ['PAY']]]) mkUser(n, r);
  const org = (sql, ...a) => Number(api.db.prepare(sql).run(...a).lastInsertRowid);
  const dept = org("INSERT INTO org_departments (company_id, code, name, created_by, source_type) VALUES (1, 'ENG', 'Engineering', 't', 'test')");
  const des = org("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (1, 'SE', 'Site Engineer', 'G3', 3, 't', 'test')");
  const p1 = org("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 't', 'test')");
  const s1 = org("INSERT INTO org_sites (company_id, org_project_id, code, name, status, latitude, longitude, geofence_type, geofence_radius_m, created_by, source_type) VALUES (1, ?, 'S1', 'Ring Road North', 'ACTIVE', 18.5204, 73.8567, 'CIRCLE', 200, 't', 'test')", p1);
  const s2 = org("INSERT INTO org_sites (company_id, org_project_id, code, name, status, latitude, longitude, geofence_type, geofence_radius_m, created_by, source_type) VALUES (1, ?, 'S2', 'Ring Road South', 'ACTIVE', 18.4, 73.8, 'CIRCLE', 200, 't', 'test')", p1);
  let n = 0;
  const mkEmp = (o = {}) => { n += 1; return org("INSERT INTO hr_employees (company_id, emp_code, first_name, full_name, name_key, gender, dob, mobile, department_id, designation_id, grade, employment_type, doj, location_type, employment_status, record_status, user_id, manager_id, created_by, source_type) VALUES (1, ?, 'E', ?, ?, 'MALE', '1990-01-01', ?, ?, ?, 'G3', ?, '2026-01-01', 'SITE', 'ACTIVE', 'APPROVED', ?, ?, 't', 'test')", o.code ?? `E${n}`, o.name ?? `Employee ${n}`, `e${n}`, `91000${String(n).padStart(5, '0')}`, dept, des, o.type ?? 'PERMANENT', o.userId ?? null, o.managerId ?? null); };
  const deploy = (e, siteId = s1) => org("INSERT INTO hr_deployments (company_id, doc_no, doc_date, person_type, person_id, dep_project_id, dep_site_id, from_date, is_primary, status, project_id, site_id, created_by, source_type) VALUES (1, ?, '2026-01-01', 'EMPLOYEE', ?, ?, ?, '2026-01-01', 1, 'APPROVED', ?, ?, 't', 'test')", `DEP-${e}-${siteId}`, e, p1, siteId, p1, siteId);
  const emps = [];
  for (let i = 1; i <= nEmployees; i += 1) { const u = mkUser(`emp${i}`, []); const e = mkEmp({ userId: u, code: `W${i}` }); deploy(e); emps.push(e); }
  // the shift, the policy and the assignment: 09:00 to 18:00 with an hour's break, 15 minutes' grace, overtime after 8 hours worked, Sunday off
  const shift = org("INSERT INTO att_shifts (company_id, code, name, start_minute, end_minute, break_minutes, grace_minutes, half_day_minutes, full_day_minutes, ot_after_minutes, status, created_by, source_type) VALUES (1, 'GEN', 'General', 540, 1080, 60, 15, 240, 480, 480, 'ACTIVE', 't', 'test')");
  const rules = (ot) => JSON.stringify({ late: { enabled: true, countPerHalfDay: 3 }, earlyGoing: { enabled: true, graceMinutes: 0, countPerHalfDay: 3 }, missingPunch: { mode: 'REGULARISE' }, compOff: { enabled: false }, ot: { enabled: ot, multiplier: 2, maxPerDayMinutes: 360, maxPerWeekMinutes: 1200, eligibleGrades: [], eligibleCategories: [] } });
  const policy = (code, ot) => org("INSERT INTO att_policies (company_id, code, name, version_no, effective_from, rules_json, band, status, created_by, source_type) VALUES (1, ?, ?, 1, '2026-01-01', ?, 'STANDARD', 'APPROVED', 't', 'test')", code, `Policy ${code}`, rules(ot));
  policy('PO', true); policy('NOOT', false);
  org("INSERT INTO att_policy_assignments (company_id, scope_type, scope_id, policy_code, shift_id, weekly_off_json, effective_from, created_by, source_type) VALUES (1, 'COMPANY', 0, 'PO', ?, ?, '2026-01-01', 't', 'test')", shift, JSON.stringify({ type: 'FIXED', days: [0] }));
  const noOt = (e) => org("INSERT INTO att_policy_assignments (company_id, scope_type, scope_id, policy_code, effective_from, created_by, source_type) VALUES (1, 'EMPLOYEE', ?, 'NOOT', '2026-01-01', 't', 'test')", e);
  /** A punch straight into the table (as the phone, the kiosk or a device would have stored it). */
  const punch = (e, date, type, hhmm, o = {}) => org("INSERT INTO att_punches (company_id, person_type, person_id, punch_site_id, punch_type, work_date, device_time, server_time, effective_time, method, recorded_by, client_uuid, result, visit_id, project_id, site_id, created_by, source_type) VALUES (1, 'EMPLOYEE', ?, ?, ?, ?, ?, ?, ?, 'MOBILE', 't', ?, 'ACCEPTED', ?, ?, ?, 't', 'test')", e, o.site ?? s1, type, date, iso(date, hhmm), iso(date, hhmm), iso(date, hhmm), uid('u'), o.visit ?? null, p1, o.site ?? s1);
  const day = (e, date, inT, outT, o) => { if (inT) punch(e, date, 'IN', inT, o); if (outT) punch(e, date, 'OUT', outT, o); };
  const call = (who, method, path, body, key) => api.call(method, path, { ...who, headers: key ? { ...json, 'idempotency-key': key } : json, body });
  const post = (who, path, body) => call(who, 'POST', path, body, uid());
  const recompute = async (siteId = s1, from = FROM, to = TO) => { const r = await post(hr1, `${A}/recompute`, { siteId, from, to }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.data; };
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
    assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: { ...json, 'idempotency-key': uid('a') }, body: { action, comment: 'checked it' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  const hasTask = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.some((x) => x.instance.id === instanceId);
  const row = (e, date) => api.db.prepare("SELECT * FROM att_daily WHERE person_id = ? AND work_date = ? AND person_type = 'EMPLOYEE'").get(e, date);
  const period = (await api.call('GET', `${A}/periods/status?period=${FROM}`, hr1)).json?.data?.period;
  return { api, call, post, punch, day, recompute, act, hasTask, row, ids: { p1, s1, s2, shift }, emps, user, mkEmp, deploy, noOt, org, period };
};

// ---- the independent recomputation of T-01 (written from the rules of the policy, not from the engine) ----
const plan = {
  0: { '2026-08-05': [null, null], '2026-08-12': ['09:00', '14:30'], '2026-08-19': ['09:20', '18:20'], '2026-08-26': ['09:00', null], '2026-08-09': ['10:00', '14:00'] },
  1: { '2026-08-03': [null, null], '2026-08-04': [null, null], '2026-08-07': ['09:30', '18:30'], '2026-08-14': ['09:30', '18:30'], '2026-08-21': ['09:00', '15:00'] },
  2: { '2026-08-16': ['09:00', '13:00'], '2026-08-28': ['09:00', '17:30'] },
};
function expected(person) {
  const out = { present: 0, paid: 0, lop: 0, absent: 0, late: 0, early: 0, missing: 0, half: 0 };
  let lateMarks = 0; let earlyMarks = 0;
  for (let d = FROM; d <= TO; d = dayOf(d, 1)) {
    const sunday = new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
    const [i, o] = plan[person][d] ?? (sunday ? [null, null] : ['09:00', '18:00']);
    if (!i && !o) { if (sunday) out.paid += 1; else { out.absent += 1; out.lop += 1; } continue; }
    if (!i || !o) { out.missing += 1; continue; }
    const worked = toMin(o) - toMin(i) - 60;
    if (sunday) { out.present += 1; out.paid += 1; continue; }
    let paid = worked >= 480 ? 1 : worked >= 240 ? 0.5 : 0; if (worked >= 480) out.present += 1; else if (worked >= 240) { out.present += 0.5; out.half += 1; } else out.absent += 1;
    if (toMin(i) > 555) { lateMarks += 1; out.late += 1; if (lateMarks % 3 === 0) paid -= 0.5; }
    if (toMin(o) < 1080) { earlyMarks += 1; out.early += 1; if (earlyMarks % 3 === 0) paid = Math.max(0, paid - 0.5); }
    out.paid += paid; out.lop += 1 - paid;
  }
  return out;
}

test('T-01 FR-01 FR-02 BR-01 the totals of the monthly register equal an independent recomputation for a 30-day sample, recomputing changes nothing, and a cell explains itself', async () => {
  const t = await setup(3);
  assert.equal(t.period?.start, FROM, 'the attendance period is the calendar month');
  t.emps.forEach((e, p) => { for (let d = FROM; d <= TO; d = dayOf(d, 1)) { const sunday = new Date(`${d}T00:00:00Z`).getUTCDay() === 0; const [i, o] = plan[p][d] ?? (sunday ? [null, null] : ['09:00', '18:00']); t.day(e, d, i, o); } });
  const first = await t.recompute();
  assert.equal(first.employees, 3);
  assert.ok(first.created >= 90, `rows were made: ${JSON.stringify(first)}`);
  const again = await t.recompute();
  assert.equal(again.created + again.updated, 0, 'recomputing the same inputs changes nothing (BR-01)');
  const reg = (await t.call(hr1, 'GET', `${A}/register?period=${FROM}&siteId=${t.ids.s1}`)).json.data;
  assert.equal(reg.days.length, 31);
  assert.equal(reg.rows.length, 3);
  assert.ok(reg.legend.some((l) => l.code === 'P'));
  for (const [p, e] of t.emps.entries()) {
    const x = expected(p); const got = reg.rows.find((r) => r.employeeId === e).totals;
    assert.deepEqual([got.presentDays, got.paidDays, got.lopDays, got.absentDays, got.lateMarks, got.earlyMarks, got.missingPunch, got.halfDays], [x.present, x.paid, x.lop, x.absent, x.late, x.early, x.missing, x.half], `person ${p} ${JSON.stringify(got)} vs ${JSON.stringify(x)}`);
    assert.equal(got.otMinutes, 0, 'overtime nobody approved is not paid');
  }
  assert.equal(reg.totals.paidDays, t.emps.reduce((a, _e, p) => a + expected(p).paid, 0));
  // the cells: codes by status
  const a = reg.rows.find((r) => r.employeeId === t.emps[0]);
  assert.equal(a.cells['2026-08-05'].code, 'A'); assert.equal(a.cells['2026-08-02'].code, 'WO'); assert.equal(a.cells['2026-08-26'].code, 'M'); assert.equal(a.cells['2026-08-12'].code, 'H'); assert.equal(a.cells['2026-08-09'].code, 'WW'); assert.equal(a.cells['2026-08-19'].late, true);
  // a cell explains itself: the punches, the flags
  const d = (await t.call(hr1, 'GET', `${A}/day?employeeId=${t.emps[0]}&date=2026-08-19`)).json.data;
  assert.equal(d.status, 'PRESENT'); assert.equal(d.punches.length, 2); assert.ok(d.flags.some((f) => f.code === 'LATE'));
  // the daily list and its exceptions filter
  const ex = (await t.call(hr1, 'GET', `${A}/daily?filter[exception]=1&filter[siteId]=${t.ids.s1}&pageSize=200`)).json;
  assert.ok(ex.data.every((r) => r.exception));
  assert.ok(ex.data.some((r) => r.status === 'MISSING_PUNCH') && ex.data.some((r) => r.status === 'ABSENT'), JSON.stringify(ex.meta) + ex.data.map((r) => r.status).join());
  const all = (await t.call(hr1, 'GET', `${A}/daily?pageSize=200`)).json;
  assert.ok(all.data.length > ex.data.length);
  // the third late mark of a person is half a day: add two lates to the second person
  assert.equal(reg.rows.find((r) => r.employeeId === t.emps[1]).totals.lateMarks, 2);
});

test('FR-01 the status engine: the third late mark takes half a day, a missing punch waits, the weekly off worked is paid, a visit is on duty, a holiday and a day without a shift are handled', async () => {
  const t = await setup(2);
  const [e1, e2] = t.emps;
  // three lates: the third is half a day
  t.day(e1, '2026-08-03', '09:30', '18:30'); t.day(e1, '2026-08-04', '09:30', '18:30'); t.day(e1, '2026-08-05', '09:30', '18:30');
  t.day(e2, '2026-08-03', '09:00', null);
  // a holiday on the 10th for the company
  const cal = Number(t.api.db.prepare("SELECT id FROM core_holiday_calendars WHERE company_id = 1 LIMIT 1").get()?.id ?? 0);
  if (cal) t.api.db.prepare("INSERT INTO core_holidays (calendar_id, holiday_date, name, type, created_by, source_type) VALUES (?, '2026-08-10', 'Test holiday', 'NATIONAL', 't', 'test')").run(cal);
  t.day(e2, '2026-08-04', '09:00', '18:00', { visit: 99 });
  await t.recompute();
  const third = t.row(e1, '2026-08-05');
  assert.equal(third.status, 'PRESENT'); assert.equal(third.paid_day, 0.5); assert.equal(third.lop_day, 0.5); assert.ok(JSON.parse(third.flags_json).includes('LATE_DEDUCTION'));
  assert.equal(t.row(e1, '2026-08-03').paid_day, 1);
  const missing = t.row(e2, '2026-08-03');
  assert.equal(missing.status, 'MISSING_PUNCH'); assert.equal(missing.paid_day, 0); assert.equal(missing.lop_day, 0);
  assert.equal(t.row(e2, '2026-08-04').status, 'ON_DUTY');
  assert.equal(t.row(e1, '2026-08-02').status, 'WEEKLY_OFF'); assert.equal(t.row(e1, '2026-08-02').paid_day, 1);
  if (cal) { const h = t.row(e1, '2026-08-10'); assert.equal(h.status, 'HOLIDAY'); assert.equal(h.paid_day, 1); }
  // no punches on a working day is absent with a loss of pay
  const ab = t.row(e1, '2026-08-06'); assert.equal([ab.status, ab.paid_day, ab.lop_day].join(), 'ABSENT,0,1');
});

test('FR-03 BR-02 regularisation: the employee asks, the supervisor approves, the day is recomputed; nobody approves their own; the fourth in a month goes to the HR manager as well', async () => {
  const t = await setup(2);
  const [e1] = t.emps;
  t.day(e1, '2026-08-03', '09:00', null); // no out punch
  await t.recompute();
  assert.equal(t.row(e1, '2026-08-03').status, 'MISSING_PUNCH');
  const body = { employeeId: e1, workDate: '2026-08-03', requestedOut: '2026-08-03T18:05', reason: 'The device did not read my card' };
  // a person may not raise one for somebody else; the employee for themself
  assert.equal((await t.post(emp(2), `${H}/regularisations`, body)).status, 403);
  const made = await t.post(emp(1), `${H}/regularisations`, { ...body, submit: true });
  assert.ok([201, 202].includes(made.status), JSON.stringify(made.json));
  const reg = made.json.data;
  assert.equal(reg.status, 'SUBMITTED'); assert.equal(reg.band, 'STANDARD'); assert.match(reg.docNo, /^REG-/);
  // one request per person and day
  assert.equal((await t.post(emp(1), `${H}/regularisations`, body)).status, 400);
  // nobody else sees it; the employee and the approvers do
  assert.equal((await t.call(emp(2), 'GET', `${H}/regularisations/${reg.id}`)).status, 404);
  assert.equal((await t.call(emp(1), 'GET', `${H}/regularisations/${reg.id}`)).status, 200);
  assert.equal((await t.call(emp(2), 'GET', `${H}/regularisations`)).json.data.length, 0);
  // the requester cannot approve (SoD-05): the supervisor decides
  assert.equal(await t.hasTask(emp(1), reg.workflowInstanceId), false);
  await t.act(ws1, reg.workflowInstanceId);
  const done = (await t.call(emp(1), 'GET', `${H}/regularisations/${reg.id}`)).json.data;
  assert.equal(done.status, 'APPROVED');
  const r = t.row(e1, '2026-08-03');
  assert.equal(r.status, 'PRESENT'); assert.equal(r.source, 'REGULARISATION'); assert.ok(JSON.parse(r.flags_json).includes('REGULARISED')); assert.equal(r.paid_day, 1);
  // the fourth in the month also goes to the HR manager
  const ids = [];
  for (const d of ['2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']) ids.push((await t.post(emp(1), `${H}/regularisations`, { employeeId: e1, workDate: d, requestedIn: `${d}T09:00`, requestedOut: `${d}T18:00`, reason: 'I forgot to punch', submit: true })).json.data);
  assert.deepEqual(ids.map((x) => x.band), ['STANDARD', 'STANDARD', 'REPEATED', 'REPEATED']);
  const fourth = ids[2];
  await t.act(ws1, fourth.workflowInstanceId);
  assert.equal((await t.call(emp(1), 'GET', `${H}/regularisations/${fourth.id}`)).json.data.status, 'SUBMITTED', 'still waiting for the HR manager');
  await t.act(hr1, fourth.workflowInstanceId);
  assert.equal((await t.call(emp(1), 'GET', `${H}/regularisations/${fourth.id}`)).json.data.status, 'APPROVED');
  // a returned request is corrected and sent again; a withdrawn one goes back to draft
  const x = (await t.post(emp(1), `${H}/regularisations`, { employeeId: e1, workDate: '2026-08-11', requestedIn: '2026-08-11T09:00', requestedOut: '2026-08-11T18:00', reason: 'Card machine was down' })).json.data;
  assert.equal(x.status, 'DRAFT');
  const sub = await t.post(emp(1), `${H}/regularisations/${x.id}/submit`, {});
  assert.equal(sub.status, 202);
  const w = await t.post(emp(1), `${H}/regularisations/${x.id}/withdraw`, { reason: 'I will use a leave day' });
  assert.equal(w.json.data.status, 'DRAFT');
  assert.equal((await t.call(emp(1), 'DELETE', `${H}/regularisations/${x.id}`)).status, 200);
  // the register of requests: the HR manager sees all, the export is a file
  assert.ok((await t.call(hr1, 'GET', `${H}/regularisations`)).json.data.length >= 5);
  const csv = await t.api.raw('GET', `${H}/regularisations/export?format=csv`, hr1);
  assert.equal(csv.status, 200); assert.match(csv.buffer.toString(), /REG-/);
  assert.equal((await t.api.raw('GET', `${H}/regularisations/${reg.id}/print`, emp(1))).status, 200);
  assert.equal((await t.call(se1, 'GET', `${H}/regularisations/export?format=csv`)).status, 403);
});

test('FR-04 overtime is paid up to the hours approved: unapproved hours are not paid, the project manager also approves beyond 4 hours a day, a policy exception goes to the HR manager', async () => {
  const t = await setup(3);
  const [e1, e2, e3] = t.emps;
  t.noOt(e3);
  // worked 09:00 to 20:00: 600 minutes, 120 over the 8 hours
  for (const e of [e1, e2, e3]) t.day(e, '2026-08-03', '09:00', '20:00');
  t.day(e1, '2026-08-04', '09:00', '22:00'); // 720 worked: 240 over
  await t.recompute();
  const un = t.row(e1, '2026-08-03');
  assert.deepEqual([un.ot_minutes, un.ot_approved_minutes, un.ot_paid_minutes], [120, 0, 0]);
  assert.ok(JSON.parse(un.flags_json).includes('OT_UNAPPROVED'));
  // approval after the work for the 3rd; 'before the work' is for today or later
  assert.equal((await t.post(ws1, `${H}/overtime-requests`, { employeeId: e1, workDate: '2026-08-03', otType: 'PRE', minutes: 120, reason: 'Bridge deck pour' })).status, 400);
  const ot = (await t.post(ws1, `${H}/overtime-requests`, { employeeId: e1, workDate: '2026-08-03', otType: 'POST', minutes: 120, reason: 'Bridge deck pour', submit: true })).json.data;
  assert.equal(ot.band, 'STANDARD'); assert.match(ot.docNo, /^OTR-/);
  await t.act(pm1, ot.workflowInstanceId);
  const paid = t.row(e1, '2026-08-03');
  assert.deepEqual([paid.ot_approved_minutes, paid.ot_paid_minutes], [120, 120]);
  assert.equal(paid.ot_multiplier, 2);
  // approved 180 against 240 worked over: paid 180
  const small = (await t.post(ws1, `${H}/overtime-requests`, { employeeId: e1, workDate: '2026-08-04', otType: 'POST', minutes: 180, reason: 'Night pour', submit: true })).json.data;
  await t.act(pm1, small.workflowInstanceId);
  const capped = t.row(e1, '2026-08-04');
  assert.deepEqual([capped.ot_minutes, capped.ot_approved_minutes, capped.ot_paid_minutes], [240, 180, 180]); assert.ok(JSON.parse(capped.flags_json).includes('OT_CAPPED'));
  // more than 4 hours in a day also goes to the project manager: WSUP first, then PM
  t.day(e2, '2026-08-05', '09:00', '23:00');
  const big = (await t.post(ws2, `${H}/overtime-requests`, { employeeId: e2, workDate: '2026-08-05', otType: 'POST', minutes: 300, reason: 'Emergency repair', submit: true })).json.data;
  assert.equal(big.band, 'PM_LEVEL');
  await t.act(ws1, big.workflowInstanceId);
  assert.equal((await t.call(hr1, 'GET', `${H}/overtime-requests/${big.id}`)).json.data.status, 'SUBMITTED');
  await t.act(pm1, big.workflowInstanceId);
  assert.equal((await t.call(hr1, 'GET', `${H}/overtime-requests/${big.id}`)).json.data.status, 'APPROVED');
  // a person the policy does not pay overtime to: a policy exception reaches the HR manager
  const ex = (await t.post(ws2, `${H}/overtime-requests`, { employeeId: e3, workDate: '2026-08-03', otType: 'POST', minutes: 120, reason: 'Needed on site', submit: true })).json.data;
  assert.equal(ex.band, 'POLICY_EXCEPTION');
  await t.act(ws1, ex.workflowInstanceId); await t.act(pm1, ex.workflowInstanceId); await t.act(hr1, ex.workflowInstanceId);
  const nopay = t.row(e3, '2026-08-03');
  assert.equal(nopay.ot_paid_minutes, 0, 'the policy pays this person no overtime even when it was approved');
  // the overtime register and its export
  assert.ok((await t.call(hr1, 'GET', `${H}/overtime-requests?filter[status]=APPROVED`)).json.data.length >= 3);
  assert.equal((await t.api.raw('GET', `${H}/overtime-requests/export?format=csv`, hr1)).status, 200);
});

test('FR-05 a manual entry is made by one person and approved by another; it decides the day and the register says so', async () => {
  const t = await setup(2);
  const [e1] = t.emps;
  await t.recompute();
  assert.equal(t.row(e1, '2026-08-03').status, 'ABSENT');
  const made = (await t.post(hr1, `${H}/manual-entries`, { employeeId: e1, workDate: '2026-08-03', entryStatus: 'PRESENT', reason: 'Device was out of order, supervisor confirms', submit: true })).json.data;
  assert.match(made.docNo, /^MAN-/);
  assert.equal(await t.hasTask(hr1, made.workflowInstanceId), false, 'the maker cannot be the checker');
  assert.equal((await t.call(emp(1), 'GET', `${H}/manual-entries/${made.id}`)).status, 403);
  assert.equal((await t.post(emp(1), `${H}/manual-entries`, { employeeId: e1, workDate: '2026-08-04', entryStatus: 'PRESENT', reason: 'I was here' })).status, 403);
  await t.act(hr2, made.workflowInstanceId);
  const r = t.row(e1, '2026-08-03');
  assert.equal(r.status, 'PRESENT'); assert.equal(r.source, 'MANUAL'); assert.equal(r.paid_day, 1);
  // a half day by hand, and an amendment of an approved entry
  const half = (await t.post(hr1, `${H}/manual-entries`, { employeeId: e1, workDate: '2026-08-04', entryStatus: 'HALF_DAY', reason: 'Left after the first half, supervisor note', submit: true })).json.data;
  await t.act(hr2, half.workflowInstanceId);
  assert.deepEqual([t.row(e1, '2026-08-04').status, t.row(e1, '2026-08-04').paid_day], ['HALF_DAY', 0.5]);
  const am = await t.post(hr1, `${H}/manual-entries/${half.id}/amend`, { reason: 'It was a full day after all' });
  assert.equal(am.status, 201); assert.equal(am.json.data.revision, 2);
  const upd = await t.call(hr1, 'PATCH', `${H}/manual-entries/${am.json.data.id}`, { employeeId: e1, workDate: '2026-08-04', entryStatus: 'PRESENT', reason: 'It was a full day after all', version: am.json.data.rowVersion }, uid());
  assert.equal(upd.status, 200, JSON.stringify(upd.json));
  const sub = await t.post(hr1, `${H}/manual-entries/${am.json.data.id}/submit`, {});
  await t.act(hr2, sub.json.data.workflowInstanceId);
  assert.equal(t.row(e1, '2026-08-04').status, 'PRESENT');
  assert.equal((await t.call(hr1, 'GET', `${H}/manual-entries/${half.id}`)).json.data.status, 'SUPERSEDED');
  // cancelling an approved entry takes its effect away
  const c = await t.post(hr1, `${H}/manual-entries/${made.id}/cancel`, { reason: 'Entered for the wrong person' });
  assert.equal(c.json.data.status, 'CANCELLED');
  assert.equal(t.row(e1, '2026-08-03').status, 'ABSENT');
});

test('T-02 FR-07 BR-03 a period is locked only after the approvals; a locked day is never rewritten and a later change becomes arrears; reopening needs the HR manager and the finance head', async () => {
  const t = await setup(2);
  const [e1, e2] = t.emps;
  for (let d = FROM; d <= TO; d = dayOf(d, 1)) { const sunday = new Date(`${d}T00:00:00Z`).getUTCDay() === 0; if (!sunday) { t.day(e1, d, '09:00', '18:00'); if (d !== '2026-08-12') t.day(e2, d, '09:00', '18:00'); } }
  t.day(e2, '2026-08-13', null, null);
  // one day of e2 has only an in punch: the period is not ready
  t.punch(e2, '2026-08-20', 'IN', '09:00'); t.api.db.prepare("DELETE FROM att_punches WHERE person_id = ? AND work_date = '2026-08-20' AND punch_type = 'OUT'").run(e2);
  await t.recompute();
  const notReady = await t.post(hr1, `${A}/period-locks`, { period: FROM, siteId: t.ids.s1 });
  assert.equal(notReady.status, 409); assert.equal(notReady.json.error?.code ?? notReady.json.code, 'PERIOD_NOT_READY');
  const details = notReady.json.error?.details ?? notReady.json.details;
  assert.ok(JSON.stringify(details).includes('2026-08-20'), JSON.stringify(notReady.json));
  // regularise it; a pending request also stops the lock
  const reg = (await t.post(emp(2), `${H}/regularisations`, { employeeId: e2, workDate: '2026-08-20', requestedOut: '2026-08-20T18:00', reason: 'Card not read at the gate', submit: true })).json.data;
  const stillNot = await t.post(hr1, `${A}/period-locks`, { period: FROM, siteId: t.ids.s1 });
  assert.equal(stillNot.status, 409); assert.ok(JSON.stringify(stillNot.json).includes(reg.docNo));
  await t.act(ws1, reg.workflowInstanceId);
  assert.equal((await t.post(pay1, `${A}/period-locks`, { period: FROM, siteId: t.ids.s1 })).status, 403, 'payroll views, only HR locks');
  assert.equal((await t.post(hr1, `${A}/period-locks`, { period: '2026-11-01', siteId: t.ids.s1 })).status, 422, 'a period is locked after its last day');
  const locked = await t.post(hr1, `${A}/period-locks`, { period: FROM, siteId: t.ids.s1 });
  assert.equal(locked.status, 201, JSON.stringify(locked.json));
  const lock = locked.json.data;
  assert.equal(lock.status, 'LOCKED'); assert.ok(lock.summary.paidDays > 40);
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM att_daily WHERE period_start = ? AND locked = 0").get(FROM).n, 0);
  assert.equal((await t.post(hr1, `${A}/period-locks`, { period: FROM, siteId: t.ids.s1 })).status, 409, 'locked twice');
  // the event for payroll
  const ev = t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'att.period.locked'").all().map((r) => JSON.parse(r.payload));
  assert.equal(ev.length, 1); assert.equal(JSON.stringify(ev[0]).includes(String(lock.id)), true);
  // BR-03: the register says it is locked and a recompute leaves the rows alone
  const before = JSON.stringify(t.api.db.prepare('SELECT id, status, paid_day, lop_day, ot_paid_minutes, in_time, out_time FROM att_daily ORDER BY id').all());
  t.api.db.prepare("DELETE FROM att_punches WHERE person_id = ? AND work_date = '2026-08-18'").run(e1); // an input changes after the lock
  const rc = await t.recompute();
  assert.equal(rc.arrears >= 1, true, JSON.stringify(rc));
  assert.equal(JSON.stringify(t.api.db.prepare('SELECT id, status, paid_day, lop_day, ot_paid_minutes, in_time, out_time FROM att_daily ORDER BY id').all()), before, 'a locked row is never rewritten');
  const ar = (await t.call(pay1, 'GET', `${A}/arrears?periodStart=${FROM}`)).json.data;
  assert.equal(ar.length, 1); assert.deepEqual([ar[0].workDate, ar[0].deltaPaidDays, ar[0].deltaLopDays, ar[0].status], ['2026-08-18', -1, 1, 'OPEN']);
  assert.equal(JSON.parse(JSON.stringify(ar[0].before)).status, 'PRESENT');
  // a correction raised now is arrears, and has to say so
  const late = await t.post(emp(2), `${H}/manual-entries`, { employeeId: e2, workDate: '2026-08-12', entryStatus: 'PRESENT', reason: 'Was on site, supervisor confirms' });
  assert.equal(late.status, 403, 'EMP cannot make manual entries');
  const need = await t.post(hr1, `${H}/manual-entries`, { employeeId: e2, workDate: '2026-08-12', entryStatus: 'PRESENT', reason: 'Was on site, supervisor confirms' });
  assert.equal(need.status, 409); assert.equal(need.json.error?.code ?? need.json.code, 'PERIOD_LOCKED');
  const arrearsEntry = (await t.post(hr1, `${H}/manual-entries`, { employeeId: e2, workDate: '2026-08-12', entryStatus: 'PRESENT', reason: 'Was on site, supervisor confirms', arrears: true, submit: true })).json.data;
  assert.equal(arrearsEntry.arrears, true);
  await t.act(hr2, arrearsEntry.workflowInstanceId);
  assert.equal(t.row(e2, '2026-08-12') ? t.row(e2, '2026-08-12').status : 'none', 'ABSENT', 'the locked day stays as it was');
  const ar2 = (await t.call(hr1, 'GET', `${A}/arrears?periodStart=${FROM}&status=OPEN`)).json.data;
  assert.equal(ar2.length, 2);
  assert.deepEqual(ar2.find((x) => x.workDate === '2026-08-12').deltaPaidDays, 1);
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'att.arrears.raised'").get().n >= 2, true);
  // reopening: the HR manager asks, another HR manager and the finance head approve; until then the rows stay locked
  assert.equal((await t.post(pay1, `${A}/periods/${t.api.db.prepare('SELECT id FROM att_periods WHERE period_start = ?').get(FROM).id}/reopen`, { siteId: t.ids.s1, reason: 'Payroll wants it' })).status, 403);
  const reo = await t.post(hr1, `${A}/period-locks/${lock.id}/reopen`, { reason: 'Corrections after the audit' });
  assert.equal(reo.status, 202, JSON.stringify(reo.json));
  assert.equal(reo.json.data.status, 'REOPEN_PENDING');
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM att_daily WHERE period_start = ? AND locked = 1").get(FROM).n > 0, true);
  assert.equal((await t.post(hr1, `${A}/period-locks/${lock.id}/reopen`, { reason: 'Corrections after the audit' })).status, 409);
  await t.act(hr2, reo.json.data.workflowInstanceId);
  assert.equal((await t.call(hr1, 'GET', `${A}/period-locks/${lock.id}`)).json.data.status, 'REOPEN_PENDING', 'the finance head has not decided yet');
  await t.act(cfo1, reo.json.data.workflowInstanceId);
  assert.equal((await t.call(hr1, 'GET', `${A}/period-locks/${lock.id}`)).json.data.status, 'REOPENED');
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM att_daily WHERE period_start = ? AND locked = 1").get(FROM).n, 0);
  assert.equal(t.row(e2, '2026-08-12').status, 'PRESENT', 'the approved correction is in the register after the reopening');
  assert.equal(t.row(e1, '2026-08-18').status, 'ABSENT');
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM att_arrears WHERE status = 'OPEN'").get().n, 0);
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'att.period.reopened'").get().n, 1);
  // locked again, and the month before is not affected by anything
  const again = await t.post(hr1, `${A}/period-locks`, { period: FROM, siteId: t.ids.s1 });
  assert.equal(again.status, 201, JSON.stringify(again.json));
});

test('FR-02 FR-08 FR-09 scope and files: the register is scoped to the sites a person sees, the muster roll lists contract labour, and the register, daily and muster files are produced', async () => {
  const t = await setup(2);
  const [e1] = t.emps;
  const labour = t.mkEmp({ code: 'L1', type: 'CONTRACT', name: 'Contract Mason' }); t.deploy(labour);
  for (const e of [e1, labour]) { t.day(e, '2026-08-03', '09:00', '18:00'); t.day(e, '2026-08-04', '09:00', '18:00'); }
  await t.recompute();
  const muster = (await t.call(hr1, 'GET', `${A}/muster?period=${FROM}`)).json.data;
  assert.deepEqual(muster.rows.map((r) => r.code), ['L1']);
  const reg = (await t.call(hr1, 'GET', `${A}/register?period=${FROM}`)).json.data;
  assert.ok(reg.rows.length >= 2);
  assert.equal((await t.call(emp(1), 'GET', `${A}/register?period=${FROM}`)).status, 403, 'employees do not see the register');
  assert.equal((await t.call(as('HRMGR', 'hr9', '2'), 'GET', `${A}/register?period=${FROM}`)).json.data.rows.length, 0, 'another company sees nothing');
  for (const url of [`${A}/register/export?format=csv&filter[periodStart]=${FROM}`, `${A}/muster/export?format=csv&filter[periodStart]=${FROM}`, `${A}/daily/export?format=csv`]) {
    const f = await t.api.raw('GET', url, hr1); assert.equal(f.status, 200, `${url} ${f.buffer.toString().slice(0, 200)}`);
  }
  const csv = (await t.api.raw('GET', `${A}/register/export?format=csv&filter[periodStart]=${FROM}`, hr1)).buffer.toString();
  assert.match(csv, /W1/); assert.match(csv, /Paid days/);
  const xlsx = await t.api.raw('GET', `${A}/register/export?format=xlsx&filter[periodStart]=${FROM}`, hr1); assert.equal(xlsx.status, 200);
  const printed = await t.api.raw('GET', `${A}/register/print?period=${FROM}`, hr1); assert.equal(printed.status, 200); assert.match(printed.buffer.toString(), /Monthly attendance register/);
  assert.equal((await t.api.raw('GET', `${A}/muster/print?period=${FROM}`, hr1)).status, 200);
  assert.equal((await t.api.raw('GET', `${A}/register/export?format=csv`, pay1)).status, 200, 'payroll may export');
  // a recompute is for people who may; the range is bounded
  assert.equal((await t.post(emp(1), `${A}/recompute`, { siteId: t.ids.s1, from: FROM, to: TO })).status, 403);
  assert.equal((await t.post(hr1, `${A}/recompute`, { siteId: t.ids.s1, from: '2026-01-01', to: TO })).status, 400);
  assert.equal((await t.post(hr1, `${A}/recompute`, { from: FROM, to: TO })).status, 400, 'a site or an employee is named');
  // idempotent replay of a create
  const k = uid('k'); const b = { employeeId: e1, workDate: '2026-08-05', otType: 'POST', minutes: 60, reason: 'Extra pour' };
  const one = await t.call(ws1, 'POST', `${H}/overtime-requests`, b, k); const two = await t.call(ws1, 'POST', `${H}/overtime-requests`, b, k);
  assert.equal(one.json.data.id, two.json.data.id);
  assert.equal((await t.call(ws1, 'POST', `${H}/overtime-requests`, b)).status, 400, 'an idempotency key is needed');
});

test('FR-03 the approvals worklist lists the attendance tasks of the person and decides many at once; one refusal does not stop the others', async () => {
  const t = await setup(3);
  const made = [];
  for (const [i, e] of t.emps.entries()) { const d = dayOf('2026-08-03', i); t.day(e, d, '09:00', null); made.push((await t.post(as('EMP', `emp${i + 1}`), `${H}/regularisations`, { employeeId: e, workDate: d, requestedOut: `${d}T18:00`, reason: 'The reader failed', submit: true })).json.data); }
  const list = (await t.call(ws1, 'GET', `${A}/approvals`)).json.data;
  assert.equal(list.length, 3); assert.ok(list.every((x) => x.kind === 'regularisation' && x.employee));
  assert.equal((await t.call(se1, 'GET', `${A}/approvals`)).json.data.length, 0);
  const bad = await t.post(ws1, `${A}/approvals/bulk`, { taskIds: list.map((x) => x.taskId), decision: 'REJECT' });
  assert.equal(bad.status, 400, 'a rejection says why');
  const ok = await t.post(ws1, `${A}/approvals/bulk`, { taskIds: [...list.map((x) => x.taskId), 999999], decision: 'APPROVE' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual([ok.json.data.done, ok.json.data.failed], [3, 1]);
  for (const m of made) assert.equal((await t.call(hr1, 'GET', `${H}/regularisations/${m.id}`)).json.data.status, 'APPROVED');
});

test('T-03 FR-06 an imported device file with duplicates stores each event once, rejects bad rows one by one, and the register counts the punches', async () => {
  const t = await setup(3);
  const [e1, e2] = t.emps;
  const codeOf = (id) => t.api.db.prepare('SELECT emp_code FROM hr_employees WHERE id = ?').get(id).emp_code;
  const tpl = await t.api.call('GET', '/api/v1/xl/templates', hr1);
  const type = tpl.json.data.types.find((x) => x.code === 'ATT_DEVICE_PUNCH');
  assert.ok(type, 'HR sees the device import');
  assert.equal((await t.api.call('GET', '/api/v1/xl/templates', se1)).json?.data?.types?.some((x) => x.code === 'ATT_DEVICE_PUNCH') ?? false, false);
  const mk = (e, type2, time, dev = 'DEV-1', site = 'S1') => ({ employee: codeOf(e), site, punchType: type2, time, device: dev });
  const rows = [
    mk(e1, 'IN', '2026-08-03 09:02:11'), mk(e1, 'OUT', '2026-08-03 18:05:00'),
    mk(e2, 'IN', '2026-08-03 09:00:00'), mk(e2, 'OUT', '2026-08-03 18:00:00'),
    mk(e1, 'IN', '2026-08-03 09:02:11'), // the same event twice in the file
    mk(e2, 'IN', '2026-08-03 09:00:00', 'DEV-1'), // and again
    { ...mk(e1, 'IN', '2026-08-04 09:00:00'), employee: 'NOBODY' }, // an unknown person
    mk(e1, 'IN', '2026-08-04 25:99:00'), // a time that is not one
    mk(e2, 'IN', '2026-08-04 09:00:00', 'DEV-1', 'S9'), // a site that is not there
  ];
  const upload = async (data, { nothingNew = false } = {}) => {
    const wb = templateWorkbook({ importType: 'ATT_DEVICE_PUNCH', version: 0, title: 'ATT_DEVICE_PUNCH', columns: type.columns.map((c) => ({ key: c.key, label: c.label, required: c.required, type: c.type })), instructions: ['x'], rowsRaw: true, rows: data.map((r) => type.columns.map((c) => r[c.key] ?? '')) });
    const up = await t.api.raw('POST', '/api/v1/xl/jobs?type=ATT_DEVICE_PUNCH&fileName=device.xlsx&onExisting=SKIP', { ...hr1, headers: { 'content-type': 'application/octet-stream', 'idempotency-key': uid('xl') }, body: wb });
    assert.equal(up.status, 202, up.buffer.toString().slice(0, 300));
    const runtime = runtimeOf(t.api.db);
    const drain = async () => { for (let i = 0; i < 8; i += 1) { runtime.bus.drain(); await runtime.jobs.drain(); } };
    await drain();
    const job = up.json.data;
    const commit = await t.api.call('POST', `/api/v1/xl/jobs/${job.id}/commit`, { ...hr1, headers: { ...json, 'idempotency-key': uid('c') }, body: { skipInvalid: true } });
    if (nothingNew) { assert.equal(commit.status, 422); assert.match(commit.json.error.message, /nothing to import/); return job; }
    assert.ok([200, 202].includes(commit.status), JSON.stringify(commit.json).slice(0, 300));
    await drain();
    return job;
  };
  const job = await upload(rows);
  const done = t.api.db.prepare('SELECT status, last_error FROM xl_jobs WHERE id = ?').get(job.id);
  assert.equal(done.status, 'COMMITTED', done.last_error);
  const stored = t.api.db.prepare("SELECT COUNT(*) AS n FROM att_punches WHERE method = 'DEVICE'").get().n;
  assert.equal(stored, 4, 'four distinct events, each stored once');
  // the same file again: nothing new
  await upload(rows, { nothingNew: true });
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM att_punches WHERE method = 'DEVICE'").get().n, 4, 'a second load stores nothing');
  // an overlapping file adds only the new event
  await upload([mk(e1, 'OUT', '2026-08-03 18:05:00'), mk(e1, 'IN', '2026-08-05 09:10:00'), mk(e1, 'OUT', '2026-08-05 18:30:00')]);
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM att_punches WHERE method = 'DEVICE'").get().n, 6);
  // the register has the days
  await t.recompute();
  const d = t.row(e1, '2026-08-03'); assert.deepEqual([d.status, d.in_time, d.out_time], ['PRESENT', '2026-08-03T09:02', '2026-08-03T18:05']);
  assert.equal(t.row(e2, '2026-08-03').status, 'PRESENT');
  assert.equal(t.row(e1, '2026-08-05').late, 0, 'ten past nine is within the grace of 15 minutes');
});

test('BR-01 the register follows its inputs: a punch recorded now reaches the register without anybody asking, and the burst of a morning is worked off together', async () => {
  const t = await setup(3);
  const runtime = runtimeOf(t.api.db);
  const actor = { user: 'hr1', companyId: 1, roles: ['HRMGR'] };
  const now = new Date();
  for (const e of t.emps) punchesOf(t.api.db).recordDeviceSync(actor, { personId: e, siteId: t.ids.s1, punchType: 'IN', deviceTime: now.toISOString(), deviceId: 'DEV-9', clientUuid: uid('c').padEnd(36, '0').slice(0, 36), offline: true });
  runtime.bus.drain();
  const reg = registerOf(t.api.db);
  assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM att_daily').get().n, 0, 'nothing is worked out inside the request that stored the punch');
  assert.equal(reg.flushChanges(), 3, 'three people, once each');
  const rows = t.api.db.prepare("SELECT status, in_time FROM att_daily").all();
  assert.equal(rows.length, 3); assert.ok(rows.every((r) => r.in_time));
});
