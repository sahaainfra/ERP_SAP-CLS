import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { attendanceOf } from '../src/server/modules/hr/attendance.js';
import { evaluateDay, isWeeklyOff, periodFor, shiftSpan } from '../src/server/modules/hr/att-calc.js';
import { setupCompany, startApi } from './helpers.js';

// Part 07.04: shifts, work calendars and attendance policies. T-01 the policy, shift and weekly off resolve from the employee override, the crew, the site and the company default as of the date; T-02 a night shift that crosses
// midnight computes its hours, lates and overtime correctly. Also: the calculations (grace, late marks, half day, overtime caps, missing punch, comp-off, rounding), weekly off patterns, attendance periods, policy versions and
// their approval (the director too when pay is touched), effective dates and closed periods, shifts in use, assignments, rosters, a change and a swap through the supervisor and the project manager, scope and idempotent replay.
const A = '/api/v1/hr/att';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const key = (k = 'a') => ({ ...json, 'idempotency-key': `at-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const hr1 = as('HRMGR', 'hr1'); const hr2 = as('HRMGR', 'hr2'); const dir = as('DIR', 'dir1'); const pm1 = as('PM', 'pm1'); const ws = as('WSUP', 'ws1'); const se = as('SE', 'se1'); const other = as('HRMGR', 'hr9', '2');
const day = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const RULES = (o = {}) => ({ late: { enabled: true, countPerHalfDay: 3 }, earlyGoing: { enabled: true, graceMinutes: 10, countPerHalfDay: 3 }, missingPunch: { mode: 'HALF_DAY' }, compOff: { enabled: true, minMinutes: 240, expiryDays: 60 }, ot: { enabled: true, multiplier: 2, holidayMultiplier: 2.5, maxPerDayMinutes: 120, maxPerWeekMinutes: 600, eligibleGrades: [], eligibleCategories: [] }, ...o });
const SHIFT = (o = {}) => ({ code: 'GEN', name: 'General', startTime: '09:00', endTime: '18:00', breakMinutes: 60, graceMinutes: 10, halfDayHours: 4, fullDayHours: 8, otAfterHours: 8, roundingMinutes: 0, roundingMode: 'NEAREST', nightShift: false, ...o });
const setup = async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (2, 'TWO', 'Two Infra Pvt Ltd', 'Two', 't', 'test')").run();
  const user = {};
  for (const [n, r, c] of [['hr1', ['HRMGR'], 1], ['hr2', ['HRMGR'], 1], ['dir1', ['DIR'], 1], ['pm1', ['PM'], 1], ['ws1', ['WSUP'], 1], ['se1', ['SE'], 1], ['aud1', ['AUD'], 1], ['hr9', ['HRMGR'], 2], ['emp1', [], 1]]) user[n] = Number(api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, n, `${n.toUpperCase()} Person`, JSON.stringify(r), `${n}@example.com`).lastInsertRowid);
  const org = (sql, ...a) => Number(api.db.prepare(sql).run(...a).lastInsertRowid);
  const dept = org("INSERT INTO org_departments (company_id, code, name, created_by, source_type) VALUES (1, 'ENG', 'Engineering', 't', 'test')");
  const des = org("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (1, 'SE', 'Site Engineer', 'G3', 3, 't', 'test')");
  const p1 = org("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 't', 'test')");
  const s1 = org("INSERT INTO org_sites (company_id, org_project_id, code, name, status, created_by, source_type) VALUES (1, ?, 'S1', 'Ring Road North', 'ACTIVE', 't', 'test')", p1);
  const s2 = org("INSERT INTO org_sites (company_id, org_project_id, code, name, status, created_by, source_type) VALUES (1, ?, 'S2', 'Ring Road South', 'ACTIVE', 't', 'test')", p1);
  const crew1 = org("INSERT INTO hr_crews (company_id, crew_site_id, code, name, trade, project_id, site_id, created_by, source_type) VALUES (1, ?, 'C1', 'Crew One', 'Fitter', ?, ?, 't', 'test')", s1, p1, s1);
  const crew2 = org("INSERT INTO hr_crews (company_id, crew_site_id, code, name, trade, project_id, site_id, created_by, source_type) VALUES (1, ?, 'C2', 'Crew Two', 'Fitter', ?, ?, 't', 'test')", s1, p1, s1);
  let n = 0;
  const emp = (o = {}) => { n += 1; return org("INSERT INTO hr_employees (company_id, emp_code, first_name, full_name, name_key, gender, dob, mobile, department_id, designation_id, grade, employment_type, doj, location_type, employment_status, record_status, user_id, created_by, source_type) VALUES (1, ?, 'E', ?, ?, 'MALE', '1990-01-01', ?, ?, ?, ?, ?, '2026-01-01', 'SITE', 'ACTIVE', 'APPROVED', ?, 't', 'test')", `E${n}`, o.name ?? `Employee ${n}`, `e${n}`, `9100000${String(n).padStart(3, '0')}`, dept, des, o.grade ?? 'G3', o.category ?? 'PERMANENT', o.userId ?? null); };
  /** An approved deployment (written directly: the deployment workflow is the subject of 07.03). */
  const deploy = (employeeId, siteId, crewId = null, projectId = p1) => org("INSERT INTO hr_deployments (company_id, doc_no, doc_date, person_type, person_id, dep_project_id, dep_site_id, crew_id, from_date, is_primary, status, project_id, site_id, created_by, source_type) VALUES (1, ?, '2026-01-01', 'EMPLOYEE', ?, ?, ?, ?, '2026-01-01', 1, 'APPROVED', ?, ?, 't', 'test')", `DEP-${employeeId}-${siteId}`, employeeId, projectId, siteId, crewId, projectId, siteId);
  const ids = { dept, des, p1, s1, s2, crew1, crew2 };
  const call = (who, method, path, body, k) => api.call(method, `${A}${path}`, { ...who, headers: key(k), body });
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
    assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key('x'), body: { action, comment: 'checked it' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  const hasTask = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.some((x) => x.instance.id === instanceId);
  const shift = async (o = {}) => { const r = await call(hr1, 'POST', '/shifts', SHIFT(o)); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.data; };
  /** An approved policy: made by hr1, approved by hr2 (and the director when it touches pay). */
  const policy = async (code, rules = RULES(), effectiveFrom = '2026-01-01') => {
    const r = await call(hr1, 'POST', '/policies', { code, name: `Policy ${code}`, effectiveFrom, rules, submit: true });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    await act(hr2, r.json.data.workflowInstanceId);
    if (r.json.data.band === 'PAY_IMPACTING') await act(dir, r.json.data.workflowInstanceId);
    const g = (await call(hr1, 'GET', `/policies/${r.json.data.id}`)).json.data;
    assert.equal(g.status, 'APPROVED');
    return g;
  };
  const assign = (b) => call(hr1, 'POST', '/assignments', { scopeId: 0, ...b });
  return { api, call, act, hasTask, ids, emp, deploy, user, shift, policy, assign };
};

test('T-02 FR-01 a night shift that crosses midnight: the length, the lates, the early going, the hours worked and the overtime are right', () => {
  const night = { startMinute: 22 * 60, endMinute: 6 * 60, breakMinutes: 30, graceMinutes: 10, halfDayMinutes: 240, fullDayMinutes: 450, otAfterMinutes: 450, roundingMinutes: 0, roundingMode: 'NEAREST' };
  const sp = shiftSpan(night);
  assert.deepEqual([sp.crosses, sp.length, sp.paid], [true, 480, 450]);
  const rules = RULES({ ot: { enabled: true, multiplier: 2, holidayMultiplier: null, maxPerDayMinutes: 120, maxPerWeekMinutes: 600, eligibleGrades: [], eligibleCategories: [] } });
  // in at 21:55 on the 5th, out at 06:20 on the 6th: 8h25 present, 7h55 worked, 5 minutes over the shift end, overtime 25 minutes
  const full = evaluateDay({ shift: night, rules, date: '2026-11-05', punchIn: '2026-11-05T21:55', punchOut: '2026-11-06T06:20' });
  assert.equal(full.workedMinutes, 475); assert.equal(full.status, 'PRESENT'); assert.equal(full.lateMark, false); assert.equal(full.otMinutes, 25); assert.equal(full.otPaidMinutes, 25); assert.equal(full.otMultiplier, 2);
  // 15 minutes late (5 over the grace), leaves 40 minutes early: 6h45 worked, a half day is not enough for a full one
  const late = evaluateDay({ shift: night, rules, date: '2026-11-05', punchIn: '2026-11-05T22:15', punchOut: '2026-11-06T05:20' });
  assert.deepEqual([late.lateMinutes, late.lateMark, late.earlyMinutes, late.earlyMark, late.workedMinutes, late.status], [5, true, 30, true, 395, 'HALF_DAY']);
  // the same hours in a day shift give the same worked time
  const day8 = evaluateDay({ shift: { startMinute: 540, endMinute: 1080, breakMinutes: 60, graceMinutes: 10, halfDayMinutes: 240, fullDayMinutes: 480, otAfterMinutes: 480, roundingMinutes: 0, roundingMode: 'NEAREST' }, rules, date: '2026-11-05', punchIn: '2026-11-05T09:00', punchOut: '2026-11-05T18:00' });
  assert.equal(day8.workedMinutes, 480); assert.equal(day8.status, 'PRESENT'); assert.equal(day8.otMinutes, 0);
  // a punch out before the punch in is not a day
  assert.equal(evaluateDay({ shift: night, rules, date: '2026-11-05', punchIn: '2026-11-06T06:00', punchOut: '2026-11-05T22:00' }).status, 'INVALID');
});

test('FR-04 the calculations: three lates are half a day, overtime is capped by day and week and limited by grade, a missing punch follows the policy, comp-off on a day off, rounding', () => {
  const shift = { startMinute: 540, endMinute: 1080, breakMinutes: 60, graceMinutes: 10, halfDayMinutes: 240, fullDayMinutes: 480, otAfterMinutes: 480, roundingMinutes: 15, roundingMode: 'DOWN' };
  const rules = RULES();
  const d = (o) => evaluateDay({ shift, rules, date: '2026-11-05', ...o });
  const on = d({ punchIn: '2026-11-05T09:10', punchOut: '2026-11-05T18:00' });
  assert.equal(on.lateMark, false, 'within the grace');
  assert.equal(on.workedMinutes, 465, '8h50 present less the break, rounded down to 15 minutes');
  assert.equal(on.status, 'HALF_DAY' === on.status ? 'HALF_DAY' : on.status);
  const l3 = d({ punchIn: '2026-11-05T09:30', punchOut: '2026-11-05T19:00', lateMarksBefore: 2 });
  assert.deepEqual([l3.lateMinutes, l3.lateMark, l3.lateDeduction], [20, true, true], 'the third late mark costs half a day');
  assert.equal(d({ punchIn: '2026-11-05T09:30', punchOut: '2026-11-05T19:00', lateMarksBefore: 1 }).lateDeduction, false);
  // overtime: 3 hours beyond 8, capped at 2 hours a day; the week has 540 minutes already, so only 60 are left
  const ot = d({ punchIn: '2026-11-05T09:00', punchOut: '2026-11-05T21:00' });
  assert.deepEqual([ot.otMinutes, ot.otPaidMinutes, ot.otMultiplier], [180, 120, 2]);
  assert.equal(d({ punchIn: '2026-11-05T09:00', punchOut: '2026-11-05T21:00', weekOtMinutes: 540 }).otPaidMinutes, 60);
  const graded = evaluateDay({ shift, rules: RULES({ ot: { ...RULES().ot, eligibleGrades: ['G5'], eligibleCategories: ['PERMANENT'] } }), date: '2026-11-05', punchIn: '2026-11-05T09:00', punchOut: '2026-11-05T21:00', person: { grade: 'G3', category: 'PERMANENT' } });
  assert.deepEqual([graded.otEligible, graded.otPaidMinutes], [false, 0]);
  // a missing punch
  for (const [mode, status] of [['HALF_DAY', 'HALF_DAY'], ['ABSENT', 'ABSENT'], ['ASSUME_SHIFT', 'PRESENT'], ['REGULARISE', 'MISSING_PUNCH']]) assert.equal(evaluateDay({ shift, rules: RULES({ missingPunch: { mode } }), date: '2026-11-05', punchIn: '2026-11-05T09:00' }).status, status);
  assert.equal(d({}).status, 'ABSENT');
  // a Sunday worked: comp-off, overtime from the first minute is not paid (the shift starts overtime only on a working day), a holiday has its own multiplier
  const sunday = d({ day: 'WEEKLY_OFF', punchIn: '2026-11-08T09:00', punchOut: '2026-11-08T18:00' });
  assert.deepEqual([sunday.status, sunday.compOff], ['WEEKLY_OFF_WORKED', 1]);
  assert.equal(d({ day: 'WEEKLY_OFF' }).status, 'WEEKLY_OFF');
  assert.equal(d({ day: 'HOLIDAY' }).status, 'HOLIDAY');
});

test('FR-03 FR-06 weekly offs (fixed, second and fourth Saturday, rotational) and the attendance period (calendar month, or the 26th to the 25th)', () => {
  assert.equal(isWeeklyOff({ type: 'FIXED', days: [0] }, '2026-11-08'), true);
  assert.equal(isWeeklyOff({ type: 'FIXED', days: [0] }, '2026-11-09'), false);
  const sat = { type: 'FIXED', days: [0], nthSaturdayOff: [2, 4] };
  assert.deepEqual(['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28'].map((d) => isWeeklyOff(sat, d)), [false, true, false, true]);
  const rot = { type: 'ROTATIONAL', anchor: '2026-11-01', cycle: [0, 0, 0, 0, 0, 0, 1] };
  assert.deepEqual(['2026-11-07', '2026-11-08', '2026-11-14', '2026-10-31'].map((d) => isWeeklyOff(rot, d)), [true, false, true, true]);
  assert.deepEqual(periodFor(1, '2026-11-17'), { start: '2026-11-01', end: '2026-11-30', label: periodFor(1, '2026-11-17').label });
  assert.deepEqual([periodFor(26, '2026-11-17').start, periodFor(26, '2026-11-17').end], ['2026-10-26', '2026-11-25']);
  assert.deepEqual([periodFor(26, '2026-11-26').start, periodFor(26, '2026-11-26').end], ['2026-11-26', '2026-12-25']);
  assert.deepEqual([periodFor(26, '2027-01-10').start, periodFor(26, '2027-01-10').end], ['2026-12-26', '2027-01-25']);
});

test('T-01 BR-01 FR-05 policy, shift and weekly off resolve from the employee override, then the crew, the site and the company default, as of the date; a new version takes effect from its date only', async () => {
  const t = await setup();
  const gen = await t.shift(); const early = await t.shift({ code: 'EARLY', name: 'Early', startTime: '06:00', endTime: '14:00', breakMinutes: 30, fullDayHours: 7, halfDayHours: 3.5, otAfterHours: 7.5 });
  const nightShift = await t.shift({ code: 'NIGHT', name: 'Night', startTime: '22:00', endTime: '06:00', breakMinutes: 30, fullDayHours: 7, halfDayHours: 3.5, otAfterHours: 7.5 });
  assert.equal(nightShift.crossesMidnight, true); assert.equal(nightShift.nightShift, true);
  await t.policy('CO'); await t.policy('SITEP', RULES({ late: { enabled: true, countPerHalfDay: 2 } })); await t.policy('CREWP', RULES({ late: { enabled: false, countPerHalfDay: 0 } }));
  const e = t.emp(); t.deploy(e, t.ids.s1, t.ids.crew1);
  const eOther = t.emp(); t.deploy(eOther, t.ids.s1, t.ids.crew2);
  const eElse = t.emp(); t.deploy(eElse, t.ids.s2, null);
  const resolve = async (id, date, who = hr1) => (await t.call(who, 'GET', `/resolve?employeeId=${id}&date=${date}`)).json.data;
  assert.equal((await resolve(e, day(0))).policy, null, 'nothing assigned yet');
  // the company default
  assert.equal((await t.assign({ scopeType: 'COMPANY', policyCode: 'CO', shiftId: gen.id, weeklyOff: { type: 'FIXED', days: [0] }, effectiveFrom: '2026-01-01' })).status, 201);
  let r = await resolve(e, '2026-11-09');
  assert.deepEqual([r.policy.code, r.shift.code, r.sources.policy.level, r.sources.shift.level, r.dayType], ['CO', 'GEN', 'COMPANY', 'COMPANY', 'WORKING']);
  assert.equal((await resolve(e, '2026-11-08')).dayType, 'WEEKLY_OFF', 'a Sunday');
  // the site, then the crew, then the employee
  assert.equal((await t.assign({ scopeType: 'SITE', scopeId: t.ids.s1, policyCode: 'SITEP', effectiveFrom: '2026-01-01' })).status, 201);
  r = await resolve(e, '2026-11-09');
  assert.deepEqual([r.policy.code, r.sources.policy.level, r.shift.code, r.sources.shift.level], ['SITEP', 'SITE', 'GEN', 'COMPANY'], 'attribute by attribute: the site gives the policy, the company still gives the shift');
  assert.equal((await resolve(eElse, '2026-11-09')).policy.code, 'CO', 'another site keeps the company default');
  assert.equal((await t.assign({ scopeType: 'CREW', scopeId: t.ids.crew1, policyCode: 'CREWP', shiftId: early.id, effectiveFrom: '2026-01-01' })).status, 201);
  r = await resolve(e, '2026-11-09');
  assert.deepEqual([r.policy.code, r.sources.policy.level, r.shift.code, r.sources.shift.level], ['CREWP', 'CREW', 'EARLY', 'CREW']);
  assert.equal((await resolve(eOther, '2026-11-09')).policy.code, 'SITEP', 'the other crew of the site');
  assert.equal((await t.assign({ scopeType: 'EMPLOYEE', scopeId: e, shiftId: nightShift.id, effectiveFrom: day(5) })).status, 201);
  assert.equal((await resolve(e, day(4))).shift.code, 'EARLY', 'the override starts on its date');
  r = await resolve(e, day(5));
  assert.deepEqual([r.shift.code, r.sources.shift.level, r.policy.code, r.shift.nightShift], ['NIGHT', 'EMPLOYEE', 'CREWP', true]);
  // a new assignment of the same place ends the one in force the day before (effective dates)
  assert.equal((await t.assign({ scopeType: 'SITE', scopeId: t.ids.s1, policyCode: 'CO', effectiveFrom: day(10) })).status, 201);
  const siteRows = (await t.call(hr1, 'GET', `/assignments?scopeType=SITE&scopeId=${t.ids.s1}&includeEnded=true`)).json.data;
  assert.equal(siteRows.length, 2);
  assert.equal(siteRows.find((x) => x.policyCode === 'SITEP').effectiveTo, day(9));
  assert.equal((await resolve(eOther, day(9))).policy.code, 'SITEP'); assert.equal((await resolve(eOther, day(10))).policy.code, 'CO');
  assert.equal((await t.assign({ scopeType: 'SITE', scopeId: t.ids.s1, policyCode: 'CO', effectiveFrom: day(10) })).status, 409, 'an assignment already starts on that date');
  // BR-02: a new version of a policy governs only the dates from its effective date
  const v1 = (await t.call(hr1, 'GET', `/policies?filter[code]=CO`)).json.data.find((x) => x.code === 'CO');
  const am = await t.call(hr1, 'POST', `/policies/${v1.id}/amend`, { effectiveFrom: day(20), reason: 'Lates now cost half a day after two' });
  assert.equal(am.status, 201, JSON.stringify(am.json));
  const body = { name: 'Policy CO', effectiveFrom: day(20), rules: RULES({ late: { enabled: true, countPerHalfDay: 2 } }), changeNote: 'Two lates', version: am.json.data.rowVersion };
  assert.equal((await t.call(hr1, 'PATCH', `/policies/${am.json.data.id}`, body)).status, 200);
  const sub = await t.call(hr1, 'POST', `/policies/${am.json.data.id}/submit`, {});
  await t.act(hr2, sub.json.data.workflowInstanceId); await t.act(dir, sub.json.data.workflowInstanceId);
  assert.equal((await resolve(eOther, day(19))).policy.rules.late.countPerHalfDay, 3, 'before its date the old version governs');
  const after = await resolve(eOther, day(20));
  assert.deepEqual([after.policy.version, after.policy.rules.late.countPerHalfDay], [2, 2]);
  // the person sees their own shift; a stranger does not see another's
  const mineUser = t.user.emp1; t.api.db.prepare('UPDATE hr_employees SET user_id = ? WHERE id = ?').run(mineUser, e);
  const own = await t.api.call('GET', `${A}/my-shift?from=${day(4)}&days=3`, { roles: '', user: 'emp1', company: '1' });
  assert.equal(own.status, 200, JSON.stringify(own.json));
  assert.deepEqual(own.json.data.days.map((x) => x.shift?.code), ['EARLY', 'NIGHT', 'NIGHT']);
  assert.equal((await t.api.call('GET', `${A}/resolve?employeeId=${eOther}&date=${day(1)}`, { roles: '', user: 'emp1', company: '1' })).status, 404);
  assert.equal((await t.call(other, 'GET', `/resolve?employeeId=${e}&date=${day(1)}`)).status, 404, 'another company');
  // the evaluation for a person and a day: night shift for the override
  const ev = await t.call(hr1, 'POST', '/evaluate', { employeeId: e, date: day(5), punchIn: `${day(5)}T21:50`, punchOut: `${day(6)}T06:00` });
  assert.equal(ev.status, 200, JSON.stringify(ev.json));
  assert.deepEqual([ev.json.data.status, ev.json.data.workedMinutes], ['PRESENT', 460]);
});

test('FR-04 BR-02 a policy version: the HR manager approves, the director too when it touches pay; the maker never approves; effective date after a closed period; returned and amended', async () => {
  const t = await setup();
  const calm = { late: { enabled: false, countPerHalfDay: 0 }, earlyGoing: { enabled: false, graceMinutes: 0, countPerHalfDay: 0 }, missingPunch: { mode: 'REGULARISE' }, compOff: { enabled: false, minMinutes: 240, expiryDays: 60 }, ot: { enabled: false, multiplier: 2, holidayMultiplier: null, maxPerDayMinutes: 0, maxPerWeekMinutes: 0, eligibleGrades: [], eligibleCategories: [] } };
  const std = await t.call(hr1, 'POST', '/policies', { code: 'PLAIN', name: 'Plain', effectiveFrom: '2026-01-01', rules: calm, submit: true });
  assert.equal(std.status, 201, JSON.stringify(std.json));
  assert.equal(std.json.data.band, 'STANDARD');
  const inst = std.json.data.workflowInstanceId;
  assert.equal(await t.hasTask(hr1, inst), false, 'the maker never approves');
  assert.equal(await t.hasTask(dir, inst), false, 'no pay impact: no director');
  await t.act(hr2, inst);
  assert.equal((await t.call(hr1, 'GET', `/policies/${std.json.data.id}`)).json.data.status, 'APPROVED');
  const pay = await t.call(hr1, 'POST', '/policies', { code: 'PAYP', name: 'Pay', effectiveFrom: '2026-01-01', rules: RULES(), submit: true });
  assert.equal(pay.json.data.band, 'PAY_IMPACTING');
  await t.act(hr2, pay.json.data.workflowInstanceId);
  assert.equal((await t.call(hr1, 'GET', `/policies/${pay.json.data.id}`)).json.data.status, 'SUBMITTED', 'waiting for the director');
  assert.equal(await t.hasTask(dir, pay.json.data.workflowInstanceId), true);
  await t.act(dir, pay.json.data.workflowInstanceId, 'return');
  const back = (await t.call(hr1, 'GET', `/policies/${pay.json.data.id}`)).json.data;
  assert.equal(back.status, 'RETURNED');
  const edit = await t.call(hr1, 'PATCH', `/policies/${back.id}`, { name: 'Pay', effectiveFrom: '2026-01-01', rules: RULES({ ot: { ...RULES().ot, multiplier: 1.5 } }), changeNote: 'x', version: back.rowVersion });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  assert.equal((await t.call(hr1, 'POST', `/policies/${back.id}/submit`, {})).status, 202);
  await t.act(hr2, pay.json.data.workflowInstanceId); await t.act(dir, pay.json.data.workflowInstanceId);
  assert.equal((await t.call(hr1, 'GET', `/policies/${back.id}`)).json.data.status, 'APPROVED');
  // locked; validation; permissions
  assert.equal((await t.call(hr1, 'PATCH', `/policies/${back.id}`, { name: 'Pay', effectiveFrom: '2026-01-01', rules: RULES(), version: 99 })).status, 409);
  const bad = await t.call(hr1, 'POST', '/policies', { code: 'BAD', name: 'Bad', effectiveFrom: '2026-01-01', rules: { ot: { enabled: true, multiplier: 9, holidayMultiplier: null, maxPerDayMinutes: 100, maxPerWeekMinutes: 100, eligibleGrades: [], eligibleCategories: [] } } });
  assert.equal(bad.status, 400);
  assert.equal((await t.call(hr1, 'POST', '/policies', { code: 'plain', name: 'Again', effectiveFrom: '2026-01-01', rules: calm })).status, 400, 'the code is used');
  assert.equal((await t.call(se, 'POST', '/policies', { code: 'X1', name: 'No', effectiveFrom: '2026-01-01', rules: calm })).status, 403);
  assert.equal((await t.call(pm1, 'GET', '/policies')).status, 200, 'a project manager reads');
  assert.equal((await t.call(other, 'GET', `/policies/${back.id}`)).status, 404);
  // the new version after a closed period
  await t.call(hr1, 'PUT', '/period', { startDay: 1, effectiveFrom: '2026-01-01' });
  const ps = (await t.call(hr1, 'GET', `/periods?from=2026-08-01&to=${day(0)}`)).json.data;
  const sorted = [...ps].sort((a, b) => a.start.localeCompare(b.start));
  const first = sorted.find((p) => p.end < day(0));
  assert.ok(first, 'a past period exists');
  const earlier = sorted.filter((p) => p.end < first.end && p.status === 'OPEN');
  assert.equal(earlier.length, 0);
  const closed = await t.call(hr1, 'POST', `/periods/${first.id}/close`, {});
  assert.equal(closed.status, 200, JSON.stringify(closed.json));
  const late = await t.call(hr1, 'POST', `/policies/${std.json.data.id}/amend`, { effectiveFrom: first.end, reason: 'Back-dated change' });
  assert.equal(late.status, 400, 'a closed period is never recalculated');
  assert.match(JSON.stringify(late.json), /closed/);
  assert.equal((await t.assign({ scopeType: 'COMPANY', policyCode: 'PLAIN', effectiveFrom: first.start })).status, 400);
  assert.equal((await t.call(hr1, 'POST', `/periods/${first.id}/close`, {})).status, 409);
  const ok = await t.call(hr1, 'POST', `/policies/${std.json.data.id}/amend`, { effectiveFrom: day(30), reason: 'Next month' });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal((await t.call(hr1, 'GET', `/policies/${ok.json.data.id}/compare`)).status, 200);
  assert.equal((await t.call(hr1, 'GET', `/policies/${std.json.data.id}/print`)).status, 200);
});

test('FR-01 a shift: the code is unique, a night shift is flagged by its times, a shift in use keeps its times, only HR keeps shifts', async () => {
  const t = await setup();
  const s = await t.shift();
  assert.deepEqual([s.startTime, s.endTime, s.crossesMidnight, s.lengthMinutes, s.paidMinutes, s.fullDayHours], ['09:00', '18:00', false, 540, 480, 8]);
  assert.equal((await t.call(hr1, 'POST', '/shifts', SHIFT({ code: 'gen' }))).status, 400, 'unique code');
  const bad = await t.call(hr1, 'POST', '/shifts', SHIFT({ code: 'BAD', fullDayHours: 12, otAfterHours: 5 }));
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.json.error.details.map((d) => d.field).sort(), ['fullDayHours', 'otAfterHours']);
  assert.equal((await t.call(se, 'POST', '/shifts', SHIFT({ code: 'X' }))).status, 403);
  assert.equal((await t.call(se, 'GET', '/shifts')).status, 200, 'everyone with a role may see the shifts');
  const body = (o = {}) => ({ ...SHIFT(), version: s.rowVersion, status: 'ACTIVE', ...o });
  const ren = await t.call(hr1, 'PATCH', `/shifts/${s.id}`, body({ name: 'General day' }));
  assert.equal(ren.status, 200, JSON.stringify(ren.json));
  await t.assign({ scopeType: 'COMPANY', shiftId: s.id, effectiveFrom: '2026-01-01' });
  const used = (await t.call(hr1, 'GET', `/shifts/${s.id}`)).json.data;
  assert.equal(used.inUse, true);
  const locked = await t.call(hr1, 'PATCH', `/shifts/${s.id}`, body({ name: 'General day', startTime: '08:30', version: used.rowVersion }));
  assert.equal(locked.status, 409, JSON.stringify(locked.json));
  assert.equal((await t.call(hr1, 'PATCH', `/shifts/${s.id}`, body({ name: 'Renamed again', version: used.rowVersion }))).status, 200, 'the name may change');
  const list = (await t.call(hr1, 'GET', '/shifts')).json;
  assert.equal(list.data.length, 1);
  const ex = await t.api.raw('GET', `${A}/shifts/export?format=csv`, hr1);
  assert.equal(ex.status, 200);
  const evalR = await t.call(hr1, 'POST', '/evaluate', { shiftId: s.id, rules: RULES(), date: day(0), punchIn: `${day(0)}T09:25`, punchOut: `${day(0)}T18:30`, lateMarksBefore: 2 });
  assert.equal(evalR.status, 200, JSON.stringify(evalR.json));
  assert.deepEqual([evalR.json.data.lateMinutes, evalR.json.data.lateDeduction, evalR.json.data.status], [15, true, 'PRESENT']);
});

test('FR-02 rosters: a rotating pattern per crew shows on the planner, a change of one day and a swap go to the supervisor and the project manager, and the approved change resolves', async () => {
  const t = await setup();
  const a = await t.shift({ code: 'A', name: 'Morning', startTime: '06:00', endTime: '15:00' }); const b = await t.shift({ code: 'B', name: 'Evening', startTime: '14:00', endTime: '23:00' });
  const p = t.emp({ name: 'Priya' }); const q = t.emp({ name: 'Qadir' }); const rr = t.emp({ name: 'Ravi' });
  for (const e of [p, q, rr]) t.deploy(e, t.ids.s1, t.ids.crew1);
  const from = day(3);
  const bad = await t.call(pm1, 'POST', '/rosters', { siteId: t.ids.s1, crewId: t.ids.crew1, name: 'Rotation', cycle: [a.id, a.id, b.id, null], fromDate: day(0) });
  assert.equal(bad.status, 400, 'a roster starts tomorrow or later');
  assert.equal((await t.call(se, 'POST', '/rosters', { siteId: t.ids.s1, name: 'x', cycle: [a.id], fromDate: from })).status, 403);
  const made = await t.call(pm1, 'POST', '/rosters', { siteId: t.ids.s1, crewId: t.ids.crew1, name: 'Rotation', cycle: [a.id, a.id, b.id, null], fromDate: from });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const next = await t.call(pm1, 'POST', '/rosters', { siteId: t.ids.s1, crewId: t.ids.crew1, name: 'Next rotation', cycle: [a.id], fromDate: day(8) });
  assert.equal(next.status, 201, 'a later roster ends the one in force the day before');
  assert.equal((await t.call(pm1, 'GET', `/rosters?siteId=${t.ids.s1}&crewId=${t.ids.crew1}`)).json.data.find((x) => x.name === 'Rotation').toDate, day(7));
  assert.equal((await t.call(pm1, 'POST', '/rosters', { siteId: t.ids.s1, crewId: t.ids.crew1, name: 'Clash', cycle: [a.id], fromDate: day(5) })).status, 409, 'a roster of the crew starts inside these dates');
  const board = (await t.call(ws, 'GET', `/roster-board?siteId=${t.ids.s1}&from=${from}&days=4`)).json.data;
  assert.equal(board.rows.length, 3);
  assert.deepEqual(board.rows[0].days.map((d) => d.shift), ['A', 'A', 'B', null]);
  assert.deepEqual(board.rows[0].days.map((d) => d.source), ['ROSTER', 'ROSTER', 'ROSTER', 'ROSTER']);
  assert.equal((await t.call(as('NOBODY', 'nb1'), 'GET', `/roster-board?siteId=${t.ids.s1}`)).status, 403);
  assert.equal((await t.call(other, 'GET', `/roster-board?siteId=${t.ids.s1}`)).status, 404);
  // a change of one day, raised by the supervisor: the project manager only
  const target = day(4);
  const ch = await t.call(ws, 'POST', '/roster-changes', { siteId: t.ids.s1, kind: 'CHANGE', employeeId: p, workDate: target, shiftId: b.id, reason: 'Covering for a colleague', submit: true });
  assert.equal(ch.status, 201, JSON.stringify(ch.json));
  assert.equal(ch.json.data.band, 'RAISED_BY_WSUP');
  assert.equal(await t.hasTask(ws, ch.json.data.workflowInstanceId), false, 'the supervisor who raised it does not approve it');
  assert.equal((await t.api.call('GET', `${A}/resolve?employeeId=${p}&date=${target}`, hr1)).json.data.shift.code, 'A', 'not yet');
  await t.act(pm1, ch.json.data.workflowInstanceId);
  assert.equal((await t.api.call('GET', `${A}/resolve?employeeId=${p}&date=${target}`, hr1)).json.data.shift.code, 'B');
  assert.equal((await t.api.call('GET', `${A}/resolve?employeeId=${p}&date=${target}`, hr1)).json.data.sources.shift.level, 'ROSTER_CHANGE');
  // a swap, raised by HR, between two crews with different rotations: the supervisor, then the project manager
  const t2 = day(3);
  await t.call(pm1, 'POST', '/rosters', { siteId: t.ids.s1, crewId: t.ids.crew2, name: 'Other rotation', cycle: [b.id, b.id, a.id, null], fromDate: from });
  t.api.db.prepare("UPDATE hr_deployments SET crew_id = ? WHERE person_id = ?").run(t.ids.crew2, rr);
  const before = async (id) => (await t.api.call('GET', `${A}/resolve?employeeId=${id}&date=${t2}`, hr1)).json.data.shift.code;
  assert.deepEqual([await before(p), await before(rr)], ['A', 'B']);
  const sw = await t.call(hr1, 'POST', '/roster-changes', { siteId: t.ids.s1, kind: 'SWAP', employeeId: p, swapEmployeeId: rr, workDate: t2, reason: 'Personal reasons', submit: true });
  assert.equal(sw.status, 201, JSON.stringify(sw.json));
  assert.equal(sw.json.data.band, 'STANDARD');
  const inst = sw.json.data.workflowInstanceId;
  assert.equal(await t.hasTask(pm1, inst), false, 'the supervisor first');
  await t.act(ws, inst);
  assert.equal(await t.hasTask(pm1, inst), true, 'then the project manager');
  await t.act(pm1, inst);
  assert.deepEqual([await before(p), await before(rr)], ['B', 'A'], 'each takes the shift of the other');
  assert.equal((await t.call(hr1, 'POST', '/roster-changes', { siteId: t.ids.s1, kind: 'CHANGE', employeeId: p, workDate: t2, shiftId: a.id, reason: 'Again the same day' })).status, 400, 'one change a day');
  assert.equal((await t.call(hr1, 'POST', '/roster-changes', { siteId: t.ids.s1, kind: 'CHANGE', employeeId: q, workDate: day(-1), shiftId: a.id, reason: 'In the past' })).status, 400);
  assert.equal((await t.call(se, 'POST', '/roster-changes', { siteId: t.ids.s1, kind: 'CHANGE', employeeId: q, workDate: day(6), shiftId: a.id, reason: 'Not allowed' })).status, 403);
  // a rejected change changes nothing; cancelling an approved one puts the day back
  const rj = await t.call(hr1, 'POST', '/roster-changes', { siteId: t.ids.s1, kind: 'CHANGE', employeeId: q, workDate: day(6), isOff: true, reason: 'A day off asked for', submit: true });
  await t.act(ws, rj.json.data.workflowInstanceId, 'reject');
  assert.equal((await t.call(hr1, 'GET', `/roster-changes/${rj.json.data.id}`)).json.data.status, 'REJECTED');
  const cancelled = await t.call(pm1, 'POST', `/roster-changes/${ch.json.data.id}/cancel`, { reason: 'No longer needed' });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.json));
  assert.equal((await t.api.call('GET', `${A}/resolve?employeeId=${p}&date=${target}`, hr1)).json.data.shift.code, 'A');
  assert.equal((await t.call(ws, 'GET', `/roster-changes?siteId=${t.ids.s1}`)).json.data.length >= 3, true);
});

test('FR-06 the attendance period: calendar month or the 26th to the 25th, periods are closed in order and after their last day, and idempotent replay', async () => {
  const t = await setup();
  assert.equal((await t.call(hr1, 'GET', '/period')).json.data.current, 1);
  assert.equal((await t.call(se, 'PUT', '/period', { startDay: 26, effectiveFrom: '2026-01-01' })).status, 403);
  const set = await t.call(hr1, 'PUT', '/period', { startDay: 26, effectiveFrom: '2026-01-01' });
  assert.equal(set.status, 200, JSON.stringify(set.json));
  assert.equal(set.json.data.current, 26);
  const list = (await t.call(hr1, 'GET', `/periods?from=2026-06-01&to=${day(0)}`)).json.data;
  assert.ok(list.length >= 4);
  assert.ok(list.every((x) => x.start.endsWith('-26')), 'the periods run from the 26th');
  const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start));
  assert.equal((await t.call(hr1, 'POST', `/periods/${sorted[1].id}/close`, {})).status, 422, 'in order');
  assert.equal((await t.call(hr1, 'POST', `/periods/${sorted[0].id}/close`, {})).status, 200);
  assert.equal((await t.call(hr1, 'POST', `/periods/${sorted[1].id}/close`, {})).status, 200);
  const current = list.find((x) => x.start <= day(0) && x.end >= day(0));
  assert.equal((await t.call(hr1, 'POST', `/periods/${current.id}/close`, {})).status, 422, 'not before its last day');
  assert.equal((await t.call(hr1, 'PUT', '/period', { startDay: 1, effectiveFrom: sorted[0].start })).status, 422, 'the new start day cannot reach a closed period');
  const ev = t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'att.period.closed'").get().n;
  assert.equal(ev, 2);
  const k = key('same');
  const body = { code: 'IDEM', name: 'Idempotent', startTime: '08:00', endTime: '17:00', halfDayHours: 4, fullDayHours: 8 };
  const one = await t.api.call('POST', `${A}/shifts`, { ...hr1, headers: k, body });
  const two = await t.api.call('POST', `${A}/shifts`, { ...hr1, headers: k, body });
  assert.equal(one.status, 201); assert.equal(two.json.data.id, one.json.data.id);
  assert.equal((await t.api.call('POST', `${A}/shifts`, { ...hr1, headers: json, body: { ...body, code: 'IDEM2' } })).status, 400, 'an idempotency key is required to create');
  void attendanceOf;
});
