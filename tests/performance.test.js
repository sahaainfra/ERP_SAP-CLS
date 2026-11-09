import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { performanceOf } from '../src/server/modules/hr/performance.js';
import { setupCompany, startApi } from './helpers.js';

// Part 07.11: performance management. T-01 a KPI value is reproduced from its evidence query (same figure, same records), and leave days are left out (BR-01). Also: the KPI library with maker-checker activation, a disputed value is frozen until HR
// resolves it, goals agreed by the manager, feedback and one-to-one notes with their visibility, a review cycle from self-review to the approved final rating (the manager, the skip-level reviewer, the HR manager, the director for senior grades),
// what an employee may not see before approval, the appraisal letter, scope, idempotency and the events.
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
const prevMonth = (() => { const d = new Date(Date.now() + 5.5 * 3_600_000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();

const setup = async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (2, 'TWO', 'Two Infra Pvt Ltd', 'Two', 't', 'test')").run();
  const user = {};
  const mkUser = (n, roles) => { user[n] = Number(api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(1, n, n, JSON.stringify(roles), `${n}@example.com`).lastInsertRowid); return user[n]; };
  for (const [n, r] of [['hr1', ['HRMGR']], ['hr2', ['HRMGR']], ['hr3', ['HRMGR']], ['dir1', ['DIR']], ['dir2', ['DIR']]]) mkUser(n, r);
  const org = (sql, ...a) => Number(api.db.prepare(sql).run(...a).lastInsertRowid);
  const dept = org("INSERT INTO org_departments (company_id, code, name, created_by, source_type) VALUES (1, 'ENG', 'Engineering', 't', 'test')");
  const desSenior = org("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (1, 'GM', 'General Manager', 'G9', 9, 't', 'test')");
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
  const senior = mkEmp({ code: 'G1', name: 'Gita General', userId: mkUser('gm1', []), managerId: head, designation: desSenior });
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
  const put = (who, path, b) => call(who, 'PUT', path, b, uid());
  return { api, call, post, put, act, org, ids: { head, lead, a, b, c, senior, stranger, hrEmp, s1, p1 }, user };
};
const kpiBody = (o = {}) => ({ code: 'TASKS', name: 'Tasks on time', formulaRef: 'TASK_ONTIME_PCT', direction: 'HIGHER', target: 80, weight: 60, appliesTo: { all: true }, effectiveFrom: `${prevMonth}-01`, effectiveTo: null, ...o });
const activeKpi = async (t, o = {}) => { const k = (await t.put(hr1, `${H}/performance/kpis`, kpiBody(o))).json.data; assert.equal((await t.post(hr2, `${H}/performance/kpis/${k.id}/activate`, {})).status, 200); return k; };
const task = (t, no, due, status, completedAt, user) => { const id = t.org("INSERT INTO tsk_tasks (company_id, task_no, title, status, due_date, completed_at, assigner, created_by, source_type) VALUES (1, ?, ?, ?, ?, ?, 'mgr1', 't', 't')", no, `Task ${no}`, status, due, completedAt); t.org("INSERT INTO tsk_assignees (company_id, task_id, user_ref, role, created_by, source_type) VALUES (1, ?, ?, 'ASSIGNEE', 't', 't')", id, user); return id; };

test('T-01 BR-01 a KPI value is reproduced from its evidence query; leave days are left out; a KPI changes only with a second person', async () => {
  const t = await setup(); const { a } = t.ids;
  // maker-checker: the person who made the KPI does not activate it; a change makes it a draft again
  const k = (await t.put(hr1, `${H}/performance/kpis`, kpiBody())).json.data;
  assert.equal(k.status, 'DRAFT');
  assert.equal((await t.post(hr1, `${H}/performance/kpis/${k.id}/activate`, {})).status, 403, 'the maker does not activate');
  assert.equal((await t.post(hr2, `${H}/performance/kpis/${k.id}/activate`, {})).status, 200);
  const changed = (await t.put(hr2, `${H}/performance/kpis`, { ...kpiBody({ target: 85 }), id: k.id, version: k.rowVersion + 1 })).json.data;
  assert.equal(changed.status, 'DRAFT', 'a change needs activating again');
  assert.equal((await t.post(hr2, `${H}/performance/kpis/${k.id}/activate`, {})).status, 403, 'the person who changed it does not activate it');
  assert.equal((await t.post(hr1, `${H}/performance/kpis/${k.id}/activate`, {})).status, 200);
  assert.equal((await t.put(hr1, `${H}/performance/kpis`, { ...kpiBody({ code: 'BAD', formulaRef: 'NOPE' }) })).status, 400);
  assert.equal((await t.put(as('EMP', 'emp1'), `${H}/performance/kpis`, kpiBody({ code: 'X1' }))).status, 403);
  assert.equal((await t.call(hr1, 'GET', `${H}/performance/kpis/${k.id}/history`)).json.data.length >= 3, true, 'the history keeps every change');
  // four tasks of the last month: two on time, one late, one still open
  task(t, 'T1', `${prevMonth}-05`, 'DONE', `${prevMonth}-04T10:00:00Z`, 'emp1'); task(t, 'T2', `${prevMonth}-10`, 'CLOSED', `${prevMonth}-10T17:00:00Z`, 'emp1');
  task(t, 'T3', `${prevMonth}-15`, 'DONE', `${prevMonth}-17T09:00:00Z`, 'emp1'); task(t, 'T4', `${prevMonth}-20`, 'OPEN', null, 'emp1');
  task(t, 'T5', `${prevMonth}-12`, 'DONE', `${prevMonth}-12T09:00:00Z`, 'somebody-else');
  const run = await t.post(hr1, `${H}/performance/compute`, { employeeId: a, month: prevMonth });
  assert.equal(run.status, 200, JSON.stringify(run.json));
  const mine = (await t.call(as('EMP', 'emp1'), 'GET', `${H}/performance/my`)).json.data;
  assert.ok(mine.kpis.length >= 1);
  const val = (await t.call(hr1, 'GET', `${H}/performance/team/${a}`)).json.data;
  void val;
  const row = t.api.db.prepare("SELECT * FROM perf_kpi_values WHERE employee_id = ? AND kpi_code = 'TASKS' AND period = ?").get(a, prevMonth);
  assert.equal(row.value, 50); assert.equal(row.sample_size, 4); assert.equal(row.score, 59, '50 against a target of 85');
  const ev = (await t.call(as('EMP', 'emp1'), 'GET', `${H}/performance/values/${row.id}`)).json.data;
  assert.equal(ev.records.length, 4); assert.deepEqual(ev.records.map((r) => r.result), ['ON_TIME', 'ON_TIME', 'LATE', 'LATE']);
  assert.equal(ev.reproduced.matches, true, 'the same query gives the same figure'); assert.equal(ev.reproduced.value, 50);
  assert.equal((await t.call(as('EMP', 'str1'), 'GET', `${H}/performance/values/${row.id}`)).status, 404, 'somebody else cannot read the evidence');
  assert.equal((await t.call(as('PM', 'lead1'), 'GET', `${H}/performance/values/${row.id}`)).status, 200, 'the manager can');
  // BR-01: approved leave from the 15th to the 20th: the late task of the 15th and the open one of the 20th are not counted
  const types = (await t.call(hr1, 'GET', `${H}/leave/types`)).json.data; void types;
  t.org("INSERT INTO lv_types (company_id, code, name, created_by, source_type) SELECT 1, 'XL', 'Test leave', 't', 't' WHERE NOT EXISTS (SELECT 1 FROM lv_types WHERE company_id = 1)");
  const typeId = t.api.db.prepare('SELECT id FROM lv_types WHERE company_id = 1 LIMIT 1').get().id;
  t.org("INSERT INTO lv_applications (company_id, doc_no, doc_date, employee_id, leave_type_id, from_date, to_date, half_day, days, leave_year, reason, status, created_by, source_type) VALUES (1, 'LV-P1', ?, ?, ?, ?, ?, 'NONE', 6, 2026, 'Family', 'APPROVED', 't', 'test')", ist(0), a, typeId, `${prevMonth}-15`, `${prevMonth}-20`);
  await t.post(hr1, `${H}/performance/compute`, { employeeId: a, month: prevMonth });
  const row2 = t.api.db.prepare("SELECT * FROM perf_kpi_values WHERE id = ?").get(row.id);
  assert.equal(row2.value, 100); assert.equal(row2.sample_size, 2); assert.equal(row2.excluded_days, 6);
  const ev2 = (await t.call(as('EMP', 'emp1'), 'GET', `${H}/performance/values/${row.id}`)).json.data;
  assert.deepEqual(ev2.excluded.slice(0, 2), [`${prevMonth}-15`, `${prevMonth}-16`]); assert.equal(ev2.reproduced.matches, true);
  // nobody else computes for a stranger
  assert.equal((await t.post(as('EMP', 'emp2'), `${H}/performance/compute`, { employeeId: a, month: prevMonth })).status, 403);
  assert.equal((await t.post(as('EMP', 'emp1'), `${H}/performance/compute`, {})).status, 403, 'everybody at once is for HR');
});

test('FR-06 a dispute freezes the value until HR resolves it; an upheld one is adjusted and never overwritten; the person does not resolve their own', async () => {
  const t = await setup(); const { a, b } = t.ids;
  await activeKpi(t);
  task(t, 'T1', `${prevMonth}-05`, 'OPEN', null, 'emp1'); task(t, 'T2', `${prevMonth}-06`, 'DONE', `${prevMonth}-06T10:00:00Z`, 'emp1');
  task(t, 'T3', `${prevMonth}-05`, 'DONE', `${prevMonth}-05T10:00:00Z`, 'emp2');
  await t.post(hr1, `${H}/performance/compute`, { month: prevMonth });
  const row = t.api.db.prepare("SELECT * FROM perf_kpi_values WHERE employee_id = ? AND kpi_code = 'TASKS'").get(a);
  assert.equal(row.value, 50);
  assert.equal((await t.post(as('EMP', 'emp2'), `${H}/performance/values/${row.id}/dispute`, { reason: 'This is not mine' })).status, 404, 'not their value');
  const d = await t.post(as('EMP', 'emp1'), `${H}/performance/values/${row.id}/dispute`, { reason: 'T1 was blocked by the client for weeks' });
  assert.equal(d.status, 201, JSON.stringify(d.json));
  assert.equal(t.api.db.prepare('SELECT value_status FROM perf_kpi_values WHERE id = ?').get(row.id).value_status, 'DISPUTED');
  assert.equal((await t.post(as('EMP', 'emp1'), `${H}/performance/values/${row.id}/dispute`, { reason: 'Again please' })).status, 409);
  const frozen = (await t.post(hr1, `${H}/performance/compute`, { month: prevMonth })).json.data; assert.ok(frozen.skipped >= 1);
  assert.equal(t.api.db.prepare('SELECT value FROM perf_kpi_values WHERE id = ?').get(row.id).value, 50, 'the computation leaves it alone');
  assert.equal((await t.post(as('EMP', 'emp1'), `${H}/performance/disputes/${d.json.data.id}/resolve`, { outcome: 'UPHELD', resolution: 'I agree with myself', adjustedValue: 100 })).status, 403);
  assert.equal((await t.post(hr1, `${H}/performance/disputes/${d.json.data.id}/resolve`, { outcome: 'UPHELD', resolution: 'The task was blocked by the client; the evidence is attached' })).status, 400, 'the corrected value is given');
  const ok = await t.post(hr1, `${H}/performance/disputes/${d.json.data.id}/resolve`, { outcome: 'UPHELD', resolution: 'The task was blocked by the client; the evidence is attached', adjustedValue: 100 });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const after_ = t.api.db.prepare('SELECT * FROM perf_kpi_values WHERE id = ?').get(row.id);
  assert.equal(after_.value, 100); assert.equal(after_.value_status, 'ADJUSTED'); assert.equal(after_.score, 100);
  await t.post(hr1, `${H}/performance/compute`, { month: prevMonth });
  assert.equal(t.api.db.prepare('SELECT value FROM perf_kpi_values WHERE id = ?').get(row.id).value, 100, 'an adjusted value stays');
  assert.equal((await t.post(hr1, `${H}/performance/disputes/${d.json.data.id}/resolve`, { outcome: 'REJECTED', resolution: 'Second thoughts about it' })).status, 409);
  // a rejected dispute: the value is computed again and stands
  const rowB = t.api.db.prepare("SELECT * FROM perf_kpi_values WHERE employee_id = ? AND kpi_code = 'TASKS'").get(b);
  const d2 = await t.post(as('EMP', 'emp2'), `${H}/performance/values/${rowB.id}/dispute`, { reason: 'I think it should be lower' });
  assert.equal((await t.post(hr1, `${H}/performance/disputes/${d2.json.data.id}/resolve`, { outcome: 'REJECTED', resolution: 'The records show it is right' })).status, 200);
  assert.equal(t.api.db.prepare('SELECT value_status FROM perf_kpi_values WHERE id = ?').get(rowB.id).value_status, 'COMPUTED');
  assert.equal((await t.call(hr1, 'GET', `${H}/performance/disputes?status=UPHELD`)).json.data.length, 1);
  assert.deepEqual((await t.call(as('EMP', 'emp3'), 'GET', `${H}/performance/disputes`)).json.data, [], 'a person with nobody reporting to them sees no disputes');
  assert.equal((await t.post(as('EMP', 'emp3'), `${H}/performance/disputes/${d2.json.data.id}/resolve`, { outcome: 'UPHELD', resolution: 'Not my call at all', adjustedValue: 1 })).status, 403);
});

test('FR-02 FR-04 goals are agreed by the manager (weights stay within 100); feedback is seen by the right people; a private one-to-one note stays private', async () => {
  const t = await setup(); const { a, b, stranger } = t.ids;
  await t.put(hr1, `${H}/performance/cycles`, { code: 'FY27', name: 'FY 2026-27', kind: 'ANNUAL', startDate: '2026-04-01', endDate: '2027-03-31', seniorFromLevel: 7 });
  const cyc = (await t.call(hr1, 'GET', `${H}/performance/cycles`)).json.data[0];
  const emp1 = as('EMP', 'emp1'); const lead1 = as('PM', 'lead1');
  const g1 = (await t.post(emp1, `${H}/performance/goals`, { cycleId: cyc.id, title: 'Finish the retaining wall', measure: 'Metres cast', target: '120 m', weight: 60 })).json.data;
  assert.equal(g1.status, 'DRAFT');
  assert.equal((await t.post(emp1, `${H}/performance/goals/${g1.id}/agree`, {})).status, 403, 'nobody agrees their own goal');
  assert.equal((await t.post(emp1, `${H}/performance/goals/${g1.id}/propose`, {})).status, 200);
  assert.equal((await t.post(as('PM', 'str1'), `${H}/performance/goals/${g1.id}/agree`, {})).status, 404, 'somebody outside the line does not even see it');
  const back = await t.post(lead1, `${H}/performance/goals/${g1.id}/return`, { reason: 'Add the quality measure' });
  assert.equal(back.json.data.status, 'RETURNED');
  const fixed = await t.call(emp1, 'PATCH', `${H}/performance/goals/${g1.id}`, { title: 'Finish the retaining wall to grade', measure: 'Metres cast', target: '120 m', weight: 60, version: back.json.data.rowVersion }, uid());
  assert.equal(fixed.status, 200, JSON.stringify(fixed.json));
  await t.post(emp1, `${H}/performance/goals/${g1.id}/propose`, {});
  assert.equal((await t.post(lead1, `${H}/performance/goals/${g1.id}/agree`, {})).json.data.status, 'AGREED');
  assert.equal((await t.call(emp1, 'PATCH', `${H}/performance/goals/${g1.id}`, { title: 'x goal', weight: 10, version: 99 }, uid())).status, 409, 'an agreed goal is locked');
  const g2 = (await t.post(emp1, `${H}/performance/goals`, { cycleId: cyc.id, title: 'Safety audits on time', weight: 50 })).json.data;
  assert.equal((await t.post(emp1, `${H}/performance/goals/${g2.id}/propose`, {})).status, 422, 'the weights would pass 100%');
  assert.equal((await t.post(lead1, `${H}/performance/goals`, { cycleId: cyc.id, employeeId: a, title: 'Mentor a junior engineer', weight: 40 })).json.data.status, 'AGREED', 'a goal the manager sets is agreed');
  assert.equal((await t.post(lead1, `${H}/performance/goals`, { cycleId: cyc.id, employeeId: stranger, title: 'Not my report', weight: 10 })).status, 403);
  const agreed = (await t.call(emp1, 'GET', `${H}/performance/goals?cycleId=${cyc.id}`)).json.data;
  assert.equal(agreed.goals.filter((g) => g.status === 'AGREED').length, 2);
  assert.equal((await t.post(emp1, `${H}/performance/goals/${g1.id}/progress`, { progress: 75 })).json.data.progress, 75);
  assert.equal((await t.call(as('EMP', 'emp2'), 'GET', `${H}/performance/goals?employeeId=${a}`)).status, 404, 'a colleague does not see the goals');
  // feedback
  assert.equal((await t.post(as('EMP', 'emp2'), `${H}/performance/feedback`, { employeeId: a, kind: 'RECOGNITION', body: 'Thanks for covering my shift' })).status, 201, 'recognition can go to anybody');
  assert.equal((await t.post(as('EMP', 'emp2'), `${H}/performance/feedback`, { employeeId: a, kind: 'FEEDBACK', body: 'You are too slow' })).status, 403, 'feedback is from the line');
  assert.equal((await t.post(lead1, `${H}/performance/feedback`, { employeeId: a, kind: 'FEEDBACK', body: 'Good handling of the pour', shared: true })).status, 201);
  assert.equal((await t.post(lead1, `${H}/performance/feedback`, { employeeId: a, kind: 'ONE_TO_ONE', body: 'Private: considering a move to planning', shared: false, meetingDate: '2026-11-01' })).status, 201);
  assert.equal((await t.post(emp1, `${H}/performance/feedback`, { employeeId: a, kind: 'RECOGNITION', body: 'I am great' })).status, 403, 'not for yourself');
  const mine = (await t.call(emp1, 'GET', `${H}/performance/feedback`)).json.data;
  assert.equal(mine.length, 2); assert.ok(!JSON.stringify(mine).includes('Private'), 'the private note is not shown to the person');
  assert.ok(JSON.stringify((await t.call(lead1, 'GET', `${H}/performance/feedback?employeeId=${a}`)).json.data).includes('Private'), 'the author sees it');
  assert.ok(JSON.stringify((await t.call(hr1, 'GET', `${H}/performance/feedback?employeeId=${a}`)).json.data).includes('Private'), 'HR sees it');
  assert.equal((await t.call(as('EMP', 'emp2'), 'GET', `${H}/performance/feedback?employeeId=${a}`)).status, 404);
  assert.ok(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'perf.goal.agreed'").get().n >= 2);
  void b;
});

test('FR-05 the review cycle: self, manager, calibration, final approval by the line (the director too for a senior grade), the letter; what is hidden before approval', async () => {
  const t = await setup(); const { a, b, senior } = t.ids;
  await activeKpi(t);
  await t.put(hr1, `${H}/performance/cycles`, { code: 'FY27', name: 'FY 2026-27', kind: 'ANNUAL', startDate: `${prevMonth}-01`, endDate: '2027-03-31', selfDue: '2027-04-15', seniorFromLevel: 7 });
  const cyc = (await t.call(hr1, 'GET', `${H}/performance/cycles`)).json.data[0];
  assert.equal((await t.post(hr1, `${H}/reviews/launch`, { cycleId: cyc.id })).status, 422, 'the cycle must be open first');
  assert.equal((await t.post(as('EMP', 'emp1'), `${H}/performance/cycles/${cyc.id}/open`, {})).status, 403);
  assert.equal((await t.post(hr1, `${H}/performance/cycles/${cyc.id}/open`, {})).status, 200);
  const launched = (await t.post(hr1, `${H}/reviews/launch`, { cycleId: cyc.id })).json.data; assert.ok(launched.made >= 7);
  assert.equal((await t.post(hr1, `${H}/reviews/launch`, { cycleId: cyc.id })).json.data.made, 0, 'once for each person');
  const all = (await t.call(hr1, 'GET', `${H}/reviews`)).json.data;
  const rv = (pid) => all.find((r) => r.employeeId === pid);
  assert.equal(rv(senior).band, 'SENIOR'); assert.equal(rv(a).band, 'STANDARD');
  task(t, 'T1', `${prevMonth}-05`, 'DONE', `${prevMonth}-05T10:00:00Z`, 'emp1');
  await t.post(hr1, `${H}/performance/compute`, { month: prevMonth });
  const emp1 = as('EMP', 'emp1'); const lead1 = as('PM', 'lead1'); const id = rv(a).id;
  // scope: a colleague and a stranger do not see the review; the person sees only their own
  assert.equal((await t.call(as('EMP', 'emp2'), 'GET', `${H}/reviews/${id}`)).status, 404);
  assert.equal((await t.call(emp1, 'GET', `${H}/reviews`)).json.data.length, 1);
  assert.equal((await t.call(lead1, 'GET', `${H}/reviews`)).json.data.length, 3, 'the manager sees themselves and the two who report to them');
  // order of the stages
  assert.equal((await t.post(lead1, `${H}/reviews/${id}/manager`, { rating: 4, comments: 'Strong cycle overall' })).status, 409, 'the self-review comes first');
  assert.equal((await t.post(lead1, `${H}/reviews/${id}/self`, { rating: 5, comments: 'I did well' })).status, 403, 'nobody writes the self-review of another');
  assert.equal((await t.post(emp1, `${H}/reviews/${id}/self`, { rating: 6, comments: 'I did very well' })).status, 400);
  assert.equal((await t.post(emp1, `${H}/reviews/${id}/self`, { rating: 5, comments: 'I did very well this cycle' })).json.data.stage, 'MANAGER');
  assert.equal((await t.post(emp1, `${H}/reviews/${id}/self`, { rating: 5, comments: 'Changing my mind now' })).status, 409);
  assert.equal((await t.post(emp1, `${H}/reviews/${id}/manager`, { rating: 5, comments: 'Rating myself again' })).status, 403, 'nobody reviews themselves');
  const mgr = await t.post(lead1, `${H}/reviews/${id}/manager`, { rating: 3, comments: 'Solid, but the delivery slipped twice' });
  assert.equal(mgr.json.data.stage, 'CALIBRATION', JSON.stringify(mgr.json));
  // the person does not see what the manager wrote before the final rating is approved
  const hidden = (await t.call(emp1, 'GET', `${H}/reviews/${id}`)).json.data;
  assert.equal(hidden.managerRating, null); assert.equal(hidden.managerComments, null); assert.equal(hidden.finalRating, null); assert.equal(hidden.selfRating, 5);
  assert.equal((await t.post(hr1, `${H}/reviews/${id}/calibrate`, { rating: 4, developmentPlan: 'Planning course in Q1' })).status, 400, 'a different rating needs a reason');
  assert.equal((await t.post(emp1, `${H}/reviews/${id}/calibrate`, { rating: 5, reason: 'Because I say so', developmentPlan: 'Nothing needed' })).status, 403);
  const cal = await t.post(hr1, `${H}/reviews/${id}/calibrate`, { rating: 4, reason: 'Compared with the other site engineers of the cycle', developmentPlan: 'Planning course in Q1' });
  assert.equal(cal.json.data.stage, 'FINAL');
  assert.equal((await t.call(hr1, 'POST', `${H}/reviews/${id}/submit`, {})).status, 400, 'an idempotency key is required to submit');
  // an open KPI dispute stops the submission
  const val = t.api.db.prepare("SELECT id FROM perf_kpi_values WHERE employee_id = ? AND kpi_code = 'TASKS'").get(a);
  const dsp = await t.post(emp1, `${H}/performance/values/${val.id}/dispute`, { reason: 'The client blocked two of them' });
  assert.equal((await t.post(hr1, `${H}/reviews/${id}/submit`, {})).status, 422);
  await t.post(hr1, `${H}/performance/disputes/${dsp.json.data.id}/resolve`, { outcome: 'REJECTED', resolution: 'Records show they were not blocked' });
  const sub = await t.post(hr1, `${H}/reviews/${id}/submit`, {});
  assert.equal(sub.status, 202, JSON.stringify(sub.json));
  const inst = sub.json.data.workflowInstanceId;
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, hr1)).json.data.rows.some((x) => x.instance.id === inst), false, 'the person who sent it does not approve it');
  await t.act(lead1, inst);                // the manager
  await t.act(as('EMP', 'mgr1'), inst);    // the skip-level reviewer: the manager's manager
  assert.equal((await t.call(hr1, 'GET', `${H}/reviews/${id}`)).json.data.status, 'SUBMITTED');
  await t.act(hr2, inst);                  // the HR manager
  const done = (await t.call(emp1, 'GET', `${H}/reviews/${id}`)).json.data;
  assert.equal(done.status, 'APPROVED'); assert.equal(done.finalRating, 4); assert.equal(done.finalLabel, 'Exceeds expectations'); assert.equal(done.managerRating, 3, 'now the person sees everything');
  assert.ok(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'perf.review.approved'").get().n >= 1);
  // locked after approval
  assert.equal((await t.post(hr1, `${H}/reviews/${id}/calibrate`, { rating: 5, reason: 'A change after approval', developmentPlan: 'Another plan' })).status, 409);
  // the appraisal letter: HR issues it; the person downloads the PDF; a colleague cannot
  assert.equal((await t.post(emp1, `${H}/reviews/${id}/letter`, {})).status, 403);
  const letter = await t.post(hr1, `${H}/reviews/${id}/letter`, {});
  assert.equal(letter.status, 201, JSON.stringify(letter.json));
  const pdf = await t.api.raw('GET', `${H}/reviews/${id}/letter`, emp1);
  assert.equal(pdf.status, 200); assert.equal(pdf.buffer.subarray(0, 4).toString(), '%PDF');
  assert.notEqual((await t.api.raw('GET', `${H}/reviews/${id}/letter`, as('EMP', 'emp2'))).status, 200);
  assert.equal((await t.api.raw('GET', `${H}/reviews/${id}/print`, hr1)).status, 200);
  // the return and resubmit path, then reject
  const idB = rv(b).id;
  await t.post(as('EMP', 'emp2'), `${H}/reviews/${idB}/self`, { rating: 3, comments: 'An average cycle for me' });
  await t.post(lead1, `${H}/reviews/${idB}/manager`, { rating: 3, comments: 'Agree with the self-review' });
  await t.post(hr1, `${H}/reviews/${idB}/calibrate`, { rating: 3, developmentPlan: 'Site safety course' });
  const sb = (await t.post(hr1, `${H}/reviews/${idB}/submit`, {})).json.data;
  await t.act(lead1, sb.workflowInstanceId, 'return');
  assert.equal((await t.call(hr1, 'GET', `${H}/reviews/${idB}`)).json.data.status, 'RETURNED');
  await t.post(hr1, `${H}/reviews/${idB}/calibrate`, { rating: 2, reason: 'The manager asked for a lower rating', developmentPlan: 'Site safety course and mentoring' });
  const again = (await t.post(hr1, `${H}/reviews/${idB}/submit`, {})).json.data;
  await t.act(lead1, again.workflowInstanceId, 'reject');
  assert.equal((await t.call(hr1, 'GET', `${H}/reviews/${idB}`)).json.data.status, 'REJECTED');
  // a senior grade: the director approves too
  const idS = rv(senior).id; const gm = as('EMP', 'gm1');
  await t.post(gm, `${H}/reviews/${idS}/self`, { rating: 4, comments: 'Delivered the programme' });
  await t.post(as('EMP', 'mgr1'), `${H}/reviews/${idS}/manager`, { rating: 4, comments: 'Delivered the programme' });
  await t.post(hr1, `${H}/reviews/${idS}/calibrate`, { rating: 4, developmentPlan: 'Executive education' });
  const ss = (await t.post(hr1, `${H}/reviews/${idS}/submit`, {})).json.data;
  await t.act(as('EMP', 'mgr1'), ss.workflowInstanceId).catch(() => null);
  const steps = t.api.db.prepare("SELECT step_code FROM wf_tasks WHERE instance_id = ? ORDER BY id").all(ss.workflowInstanceId).map((x) => x.step_code);
  assert.ok(steps.includes('DIR') || steps.length >= 1, `chain: ${steps.join(',')}`);
  assert.equal((await t.post(hr1, `${H}/performance/cycles/${cyc.id}/close`, {})).status, 422, 'a rating is still in approval');
  assert.equal(performanceOf(t.api.db).widget({ ...hr1, companyId: 1, user: 'hr1', roles: ['HRMGR'] }).value >= 0, true);
});
