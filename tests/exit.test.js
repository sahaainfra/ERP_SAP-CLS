import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { employeesOf } from '../src/server/modules/hr/employees.js';
import { setupCompany, startApi } from './helpers.js';

// Part 07.13: exit, full-and-final inputs, grievances and disciplinary records. T-01 the last working day revokes the access (through the scheduled separation of 07.01), and the full-and-final is blocked until every clearance is cleared or
// waived. Also: the notice and the last working day, the chains (manager and HR manager for a resignation, HR manager and director for a termination), the clearances of the departments and what they cannot clear, the exit interview and its analysis,
// the letters, grievances (named and anonymous with a tracking code, SLA, resolution, reopening), disciplinary cases restricted to HR, scope.
const H = '/api/v1/hr';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const as = (roles, user, company = '1') => ({ roles, user, company });
const hr1 = as('HRMGR', 'hr1'); const hr2 = as('HRMGR', 'hr2'); const dir1 = as('DIR', 'dir1');
const emp1 = as('EMP', 'emp1'); const emp2 = as('EMP', 'emp2'); const lead1 = as('EMP', 'lead1');
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
  for (const [n, r] of [['hr1', ['HRMGR']], ['hr2', ['HRMGR']], ['hr3', ['HRMGR']], ['dir1', ['DIR']], ['it1', ['ITADM']], ['sk1', ['SK']], ['acc1', ['ACCMGR']], ['pay1', ['PAY']]]) mkUser(n, r);
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
  mkEmp({ code: 'H1', name: 'Hema HR', userId: user.hr3 });
  const call = (who, method, path, body, key) => api.call(method, path, { ...who, headers: key ? { ...json, 'idempotency-key': key } : json, body });
  const post = (who, path, body) => call(who, 'POST', path, body, uid());
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
    assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: { ...json, 'idempotency-key': uid('a') }, body: { action, comment: 'checked it' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  const put = (who, path, b) => call(who, 'PUT', path, b, uid());
  return { api, call, post, put, act, org, ids: { head, lead, a, b, c, stranger, s1, p1 }, user };
};
const resign = (o = {}) => ({ type: 'RESIGNATION', reasonCode: 'BETTER_OPPORTUNITY', reason: 'An offer closer to home', submittedOn: ist(0), ...o });
const accept = async (t, s) => { await t.act(lead1, s.workflowInstanceId); await t.act(hr2, s.workflowInstanceId); return (await t.call(hr1, 'GET', `${H}/separations/${s.id}`)).json.data; };
const clearAll = async (t, sep, skip = []) => {
  for (const c of sep.clearances) {
    if (skip.includes(c.department)) continue;
    const who = { IT: as('ITADM', 'it1'), STORES: as('SK', 'sk1'), ACCOUNTS: as('ACCMGR', 'acc1'), ADMIN: hr1, PROJECT: lead1, HR: hr1 }[c.department];
    const r = await t.put(who, `${H}/clearances/${c.id}`, { items: c.items.map((i) => ({ code: i.code, status: 'CLEARED', note: 'done' })), version: c.rowVersion });
    assert.equal(r.status, 200, `${c.department}: ${JSON.stringify(r.json)}`);
  }
};

test('T-01 BR-02 the last working day revokes the access; BR-01 the full-and-final is blocked until every clearance is cleared or waived', async () => {
  const t = await setup(); const { a, b } = t.ids;
  // the notice: 15 days on probation; asking for a shorter day needs a waiver or a buyout
  const pv = (await t.post(emp1, `${H}/separations/preview`, { type: 'RESIGNATION', submittedOn: ist(0), requestedLwd: ist(2) })).json.data;
  assert.equal(pv.noticeDays, 15); assert.equal(pv.shortDays, 13); assert.ok(pv.problems.length >= 1);
  assert.equal((await t.post(emp1, `${H}/separations`, resign({ requestedLwd: ist(2) }))).status, 400, 'short of the notice without a waiver or buyout');
  const s = (await t.post(emp1, `${H}/separations`, resign({ requestedLwd: ist(2), earlyMode: 'WAIVER', submit: true }))).json.data;
  assert.equal(s.status, 'SUBMITTED'); assert.equal(s.waiverDays, 13); assert.equal(s.lastWorkingDay, ist(2));
  assert.equal((await t.post(emp1, `${H}/separations`, resign())).status, 409, 'one separation at a time');
  const ok = await accept(t, s);
  assert.equal(ok.status, 'APPROVED'); assert.equal(ok.clearances.length, 6); assert.equal(ok.employmentStatus, 'NOTICE');
  assert.notEqual(t.api.db.prepare('SELECT p.lifecycle FROM iam_user_profiles p JOIN iam_users u ON u.id = p.user_id WHERE u.username = ?').get('emp1')?.lifecycle, 'DEACTIVATED', 'still working until the last day');
  // the exit interview before leaving (HR records it)
  assert.equal((await t.post(hr1, `${H}/separations/${s.id}/interview`, { rating: 4, reasonCode: 'BETTER_OPPORTUNITY', wouldRejoin: true, responses: { likedMost: 'The site team', improve: 'Faster approvals' } })).status, 200);
  // the last working day comes: the scheduled separation applies, the user account goes, hr.employee.separated is published
  employeesOf(t.api.db).cycle(1, { today: ist(2) });
  assert.equal(t.api.db.prepare('SELECT employment_status AS s FROM hr_employees WHERE id = ?').get(a).s, 'SEPARATED');
  assert.match(t.api.db.prepare('SELECT access_note AS n FROM hr_employees WHERE id = ?').get(a).n, /deactivated/, 'the access is revoked on the last working day');
  assert.equal(t.api.db.prepare('SELECT p.lifecycle FROM iam_user_profiles p JOIN iam_users u ON u.id = p.user_id WHERE u.username = ?').get('emp1').lifecycle, 'DEACTIVATED');
  assert.ok(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'hr.employee.separated'").get().n >= 1);
  // a resignation whose last day is past: separated at acceptance; the full-and-final waits for the clearances
  t.org("UPDATE hr_employees SET doj = '2019-01-01' WHERE id = ?", b);
  const s2 = (await t.post(emp2, `${H}/separations`, resign({ submittedOn: ist(-10), reason: 'Moving to another city', requestedLwd: ist(-1), earlyMode: 'BUYOUT', submit: true }))).json.data;
  const ok2 = await accept(t, s2);
  assert.equal(ok2.employmentStatus, 'SEPARATED');
  const blocked = await t.post(hr1, `${H}/separations/${s2.id}/fnf/release`, {});
  assert.equal(blocked.status, 422); assert.match(blocked.json.error.message, /Clearance pending/);
  // a department cannot clear what is not done: the exit interview is missing for HR
  const hrC = ok2.clearances.find((c) => c.department === 'HR');
  const noIv = await t.put(hr1, `${H}/clearances/${hrC.id}`, { items: hrC.items.map((i) => ({ code: i.code, status: 'CLEARED' })), version: hrC.rowVersion });
  assert.equal(noIv.status, 400); assert.match(JSON.stringify(noIv.json), /exit interview/);
  assert.equal((await t.put(emp2, `${H}/clearances/${hrC.id}`, { items: [{ code: 'DOCUMENTS', status: 'CLEARED' }], version: hrC.rowVersion })).status, 403, 'not their department, and not their own clearance');
  await t.post(hr1, `${H}/separations/${s2.id}/interview`, { rating: 3, reasonCode: 'RELOCATION', wouldRejoin: false });
  await clearAll(t, ok2, ['ADMIN']);
  assert.equal((await t.post(hr1, `${H}/separations/${s2.id}/fnf/release`, {})).status, 422, 'one clearance is still pending');
  const adminC = ok2.clearances.find((c) => c.department === 'ADMIN');
  assert.equal((await t.post(as('SK', 'sk1'), `${H}/clearances/${adminC.id}/waive`, { reason: 'Accommodation was never given' })).status, 403);
  assert.equal((await t.post(hr1, `${H}/clearances/${adminC.id}/waive`, { reason: 'Accommodation was never given' })).json.data.status, 'WAIVED');
  // the inputs: 19 days short of the notice bought out, gratuity eligible after 7 years
  const inputs = (await t.call(as('PAY', 'pay1'), 'GET', `${H}/separations/${s2.id}/fnf`)).json.data;
  assert.equal(inputs.canRelease, true, JSON.stringify(inputs.blockers)); assert.equal(inputs.gratuity.eligible, true); assert.ok(inputs.notice.recoveryDays > 0);
  const rel = await t.post(as('PAY', 'pay1'), `${H}/separations/${s2.id}/fnf/release`, {});
  assert.equal(rel.status, 200, JSON.stringify(rel.json));
  assert.equal((await t.call(hr1, 'GET', `${H}/separations/${s2.id}`)).json.data.status, 'SETTLED');
  assert.ok(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'hr.fnf.released'").get().n === 1);
  assert.equal((await t.post(as('PAY', 'pay1'), `${H}/separations/${s2.id}/fnf/release`, {})).status, 409);
  // the letters, after the last working day
  const letter = await t.post(hr1, `${H}/separations/${s2.id}/letters`, { kind: 'RELIEVING' });
  assert.equal(letter.status, 201, JSON.stringify(letter.json));
  assert.equal((await t.api.raw('GET', `${H}/separations/${s2.id}/letters/relieving`, hr1)).buffer.subarray(0, 4).toString(), '%PDF');
  assert.equal((await t.post(hr1, `${H}/separations/${s.id}/letters`, { kind: 'EXPERIENCE' })).status, 422, 'not before the last working day');
  // the analysis of the exit interviews
  const an = (await t.call(hr1, 'GET', `${H}/separations/analytics`)).json.data;
  assert.equal(an.interviews, 2); assert.equal(an.avgRating, 3.5); assert.equal(an.wouldRejoinPct, 50);
});

test('FR-01 a termination goes to the HR manager and the director; scope of separations; withdraw and cancel', async () => {
  const t = await setup(); const { c } = t.ids;
  assert.equal((await t.post(emp1, `${H}/separations`, { type: 'TERMINATION', employeeId: c, reasonCode: 'MISCONDUCT', reason: 'Repeated absence without leave', submittedOn: ist(0) })).status, 403);
  const tm = (await t.post(hr1, `${H}/separations`, { type: 'TERMINATION', employeeId: c, reasonCode: 'MISCONDUCT', reason: 'Repeated absence without leave', submittedOn: ist(0), requestedLwd: ist(0), submit: true })).json.data;
  assert.equal(tm.noticePayDays, 15, 'immediate: the notice is paid in lieu');
  const steps = () => t.api.db.prepare('SELECT step_code FROM wf_tasks WHERE instance_id = ? ORDER BY id').all(tm.workflowInstanceId).map((x) => x.step_code);
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, hr1)).json.data.rows.some((x) => x.instance.id === tm.workflowInstanceId), false, 'the HR manager who raised it does not approve it');
  await t.act(hr2, tm.workflowInstanceId);
  assert.equal((await t.call(hr1, 'GET', `${H}/separations/${tm.id}`)).json.data.status, 'SUBMITTED');
  await t.act(dir1, tm.workflowInstanceId);
  assert.equal((await t.call(hr1, 'GET', `${H}/separations/${tm.id}`)).json.data.status, 'APPROVED'); assert.deepEqual(steps(), ['HRMGR', 'DIR']);
  // scope: a colleague does not see it; the manager line does; HR sees all
  assert.equal((await t.call(emp2, 'GET', `${H}/separations/${tm.id}`)).status, 404);
  assert.equal((await t.call(as('EMP', 'mgr1'), 'GET', `${H}/separations/${tm.id}`)).status, 200);
  // a resignation withdrawn from approval, another returned and corrected, an accepted one cancelled before its last day
  const r1 = (await t.post(emp1, `${H}/separations`, resign({ submit: true }))).json.data;
  assert.equal((await t.post(emp1, `${H}/separations/${r1.id}/withdraw`, { reason: 'Changed my mind' })).json.data.status, 'DRAFT');
  const r1b = (await t.post(emp1, `${H}/separations/${r1.id}/submit`, {})).json.data;
  await t.act(lead1, r1b.workflowInstanceId, 'return');
  assert.equal((await t.call(emp1, 'GET', `${H}/separations/${r1.id}`)).json.data.status, 'RETURNED');
  await t.post(emp1, `${H}/separations/${r1.id}/submit`, {});
  const acc = await accept(t, (await t.call(emp1, 'GET', `${H}/separations/${r1.id}`)).json.data);
  assert.equal(acc.employmentStatus, 'NOTICE');
  assert.equal((await t.post(emp1, `${H}/separations/${r1.id}/cancel`, { reason: 'Not my call now' })).status, 422, 'an accepted one is cancelled by HR');
  assert.equal((await t.post(hr1, `${H}/separations/${r1.id}/cancel`, { reason: 'Retained with a counter-offer' })).json.data.status, 'CANCELLED');
  assert.equal(t.api.db.prepare('SELECT employment_status AS s FROM hr_employees WHERE id = ?').get(t.ids.a).s, 'ACTIVE', 'the person is active again');
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM hr_employee_changes WHERE employee_id = ? AND change_status = 'SCHEDULED'").get(t.ids.a).n, 0, 'the scheduled separation was taken back');
  assert.equal((await t.api.raw('GET', `${H}/separations/export?format=csv`, hr1)).status, 200);
  assert.equal((await t.call(emp1, 'POST', `${H}/separations`, resign())).status, 400, 'an idempotency key is required');
});

test('FR-06 grievances: named and anonymous (tracking code, no identity kept), assignment, SLA, resolution, reopening and closing', async () => {
  const t = await setup();
  const named = (await t.post(emp1, `${H}/grievances`, { category: 'WAGES', subject: 'Overtime not paid', description: 'Overtime of October was not in my salary', submit: true })).json.data;
  assert.equal(named.status, 'SUBMITTED'); assert.equal(named.slaDue, ist(7)); assert.equal(named.complainant, 'Asha Kulkarni (A1)');
  const anon = await t.post(emp2, `${H}/grievances`, { category: 'HARASSMENT', subject: 'Comments at the site office', description: 'A supervisor makes remarks every day', anonymous: true, submit: true });
  assert.equal(anon.status, 201); const code = anon.json.data.trackingCode; assert.match(code, /^[0-9A-F]{12}$/); assert.equal(anon.json.data.slaDue, ist(3), 'harassment has a shorter SLA');
  const row = t.api.db.prepare('SELECT * FROM hr_grievances WHERE doc_no = ?').get(anon.json.data.docNo);
  assert.equal(row.raised_by, null); assert.equal(row.complainant_id, null); assert.equal(row.created_by, 'anonymous', 'no identity is kept');
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'hr_grievances' AND entity_id = ? AND actor = 'emp2'").get(String(row.id)).n, 0);
  assert.equal((await t.post(emp2, `${H}/grievances`, { category: 'OTHER', subject: 'Draft', description: 'An anonymous draft is not kept', anonymous: true })).status, 400);
  // scope: the officer sees all; the person sees their own; a colleague nothing
  assert.equal((await t.call(emp2, 'GET', `${H}/grievances/${named.id}`)).status, 404);
  assert.equal((await t.call(emp1, 'GET', `${H}/grievances`)).json.data.length, 1);
  { const l = await t.call(hr1, 'GET', `${H}/grievances`); assert.ok(l.json.data?.length >= 2, JSON.stringify(l.json)); }
  // assignment, notes, resolution; the complainant reopens, then accepts
  assert.equal((await t.post(emp1, `${H}/grievances/${named.id}/assign`, { officer: 'hr2' })).status, 403);
  assert.equal((await t.post(hr1, `${H}/grievances/${named.id}/assign`, { officer: 'hr2' })).json.data.status, 'IN_REVIEW');
  await t.post(hr2, `${H}/grievances/${named.id}/note`, { text: 'Checked with payroll: the OT sheet was late', shared: true });
  await t.post(hr2, `${H}/grievances/${named.id}/note`, { text: 'Internal: supervisor forgot to submit', shared: false });
  const mine = (await t.call(emp1, 'GET', `${H}/grievances/${named.id}`)).json.data; assert.equal(mine.notes.length, 1, 'the private note is not shown to the complainant');
  await t.post(hr2, `${H}/grievances/${named.id}/resolve`, { resolution: 'Overtime will be paid with the November salary' });
  assert.equal((await t.post(emp1, `${H}/grievances/${named.id}/respond`, { accept: false })).status, 400, 'reopening needs a reason');
  assert.equal((await t.post(emp1, `${H}/grievances/${named.id}/respond`, { accept: false, reason: 'I want it this month, not next' })).json.data.status, 'IN_REVIEW');
  await t.post(hr2, `${H}/grievances/${named.id}/resolve`, { resolution: 'Paid as a separate transfer this week' });
  assert.equal((await t.post(emp1, `${H}/grievances/${named.id}/respond`, { accept: true })).json.data.status, 'CLOSED');
  // the anonymous one: tracked with the code; past its SLA it is told to HR once
  const tr = (await t.call(emp2, 'GET', `${H}/grievances/track?code=${code}`)).json.data; assert.equal(tr.status, 'SUBMITTED');
  assert.equal((await t.call(emp2, 'GET', `${H}/grievances/track?code=AAAAAAAAAAAA`)).status, 404);
  t.org("UPDATE hr_grievances SET sla_due = ? WHERE id = ?", ist(-1), row.id);
  const { exitOf } = await import('../src/server/modules/hr/exit.js');
  assert.equal(exitOf(t.api.db).cycle(1).overdue, 1); assert.equal(exitOf(t.api.db).cycle(1).overdue, 0, 'once');
  await t.post(hr1, `${H}/grievances/${row.id}/resolve`, { resolution: 'The supervisor was counselled and moved to another site' });
  assert.equal((await t.post(emp2, `${H}/grievances/track/respond`, { code, accept: true })).json.data.status, 'CLOSED');
  assert.equal((await t.api.raw('GET', `${H}/grievances/export?format=csv`, hr1)).status, 200);
});

test('FR-07 disciplinary cases are restricted: HR opens and decides, the employee answers the show-cause and sees only what concerns them', async () => {
  const t = await setup(); const { a } = t.ids;
  assert.equal((await t.post(emp2, `${H}/disciplinary`, { employeeId: a, incidentDate: ist(-3), category: 'CONDUCT', severity: 'MAJOR', incident: 'Shouted at the crew and walked off the site' })).status, 403);
  const c = (await t.post(hr1, `${H}/disciplinary`, { employeeId: a, incidentDate: ist(-3), category: 'CONDUCT', severity: 'MAJOR', incident: 'Shouted at the crew and walked off the site' })).json.data;
  assert.equal(c.status, 'OPEN');
  assert.equal((await t.call(emp2, 'GET', `${H}/disciplinary/${c.id}`)).status, 404, 'a colleague does not see it');
  assert.deepEqual((await t.call(lead1, 'GET', `${H}/disciplinary`)).json.data, [], 'not even the manager');
  const sc = (await t.post(hr1, `${H}/disciplinary/${c.id}/step`, { stage: 'SHOW_CAUSE', text: 'Explain why action should not be taken', dueDate: ist(4), version: c.rowVersion })).json.data;
  assert.equal(sc.status, 'SHOW_CAUSE');
  const mineList = await t.call(emp1, 'GET', `${H}/disciplinary`); assert.equal(mineList.status, 200, JSON.stringify(mineList.json)); assert.equal(mineList.json.data.length, 1, 'the employee lists their own case');
  const own = (await t.call(emp1, 'GET', `${H}/disciplinary/${c.id}`)).json.data;
  assert.equal(own.incident, null, 'the employee sees the show-cause, not the file'); assert.equal(own.can.respond, true);
  assert.equal((await t.post(emp1, `${H}/disciplinary/${c.id}/respond`, { text: 'The pour was unsafe and I stopped it; I apologise for shouting' })).json.data.status, 'RESPONDED');
  const r = (await t.call(hr1, 'GET', `${H}/disciplinary/${c.id}`)).json.data;
  const iq = (await t.post(hr1, `${H}/disciplinary/${c.id}/step`, { stage: 'INQUIRY', text: 'Statements of two crew members taken', version: r.rowVersion })).json.data;
  assert.equal((await t.post(hr1, `${H}/disciplinary/${c.id}/step`, { stage: 'CLOSE', text: 'Closing', version: iq.rowVersion })).status, 422, 'closed after an action');
  const act = (await t.post(hr1, `${H}/disciplinary/${c.id}/step`, { stage: 'ACTION', text: 'Written warning', action: 'WARNING', version: iq.rowVersion })).json.data;
  assert.equal(act.status, 'ACTION_TAKEN'); assert.equal(act.finalAction, 'WARNING');
  assert.equal((await t.post(hr1, `${H}/disciplinary/${c.id}/step`, { stage: 'CLOSE', text: 'Closed after the warning', version: iq.rowVersion })).status, 409, 'stale version');
  assert.equal((await t.post(hr1, `${H}/disciplinary/${c.id}/step`, { stage: 'CLOSE', text: 'Closed after the warning', version: act.rowVersion })).json.data.status, 'CLOSED');
  const seen = (await t.call(emp1, 'GET', `${H}/disciplinary/${c.id}`)).json.data;
  assert.equal(seen.actions.some((x) => x.stage === 'INQUIRY'), false, 'the inquiry notes stay with HR');
  assert.ok(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'hr_disciplinary_cases' AND action = 'view'").get().n >= 2, 'every look at a case is audited');
  assert.equal((await t.call(dir1, 'GET', `${H}/disciplinary/${c.id}`)).status, 200);
});
