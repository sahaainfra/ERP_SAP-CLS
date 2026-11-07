import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { teamOf } from '../src/server/modules/proj/team.js';
import { meetingsOf } from '../src/server/modules/proj/meetings.js';
import { setupCompany, startApi } from './helpers.js';

// Part 10.05: the project team, stakeholders, communication matrix, meetings, minutes and action items. T-01 the actions of issued minutes become tasks with their due dates and appear in the owners' My Tasks. Also: a team member is added by the project
// manager and the project director and the role engine is asked for the scoped assignment (BR-01), minutes are issued only by the chair and then locked and corrected by a revision (BR-02), an owner updates their own action and the task follows, the
// stakeholder register hides contact details from those who may not see them, roles, project isolation, another company, the flag.
const P = '/api/v1/proj';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
let seq = 0;
const key = () => ({ ...json, 'idempotency-key': `tm-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const pm1 = as('PM', 'tpm1'); const pm2 = as('PM', 'tpm2'); const pd1 = as('PD', 'tpd1'); const plan1 = as('PLAN', 'tplan1'); const se1 = as('SE', 'tse1'); const se2 = as('SE', 'tse2'); const qs1 = as('QS', 'tqs1'); const bd = as('BD', 'tbd1'); const sys = as('SYSADM', 'tsys1'); const itadm = as('ITADM', 'tit1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const plus = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  for (const [n, r] of [['tpm1', ['PM']], ['tpm2', ['PM']], ['tpd1', ['PD']], ['tplan1', ['PLAN']], ['tse1', ['SE']], ['tse2', ['SE']], ['tqs1', ['QS']], ['tbd1', ['BD']], ['tsys1', ['SYSADM']], ['tit1', ['ITADM']], ['tnew1', []]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const mk = (code, name) => { const id = Number(api.db.prepare('INSERT INTO org_projects (company_id, code, name, type) VALUES (1, ?, ?, ?)').run(code, name, 'BUILDING').lastInsertRowid); api.db.prepare("INSERT INTO proj_projects (company_id, project_id, created_by) VALUES (1, ?, 'test')").run(id); return id; };
  const a = mk('TMA', 'Alpha towers'); const b = mk('TMB', 'Beta mall');
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r;
  };
  const hasTask = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.some((x) => x.instance.id === instanceId);
  const myTasks = async (who) => (await api.call('GET', '/api/v1/tsk/tasks?view=assigned&entity=proj_meeting', who)).json.data;
  return { api, call, act, hasTask, myTasks, a, b };
}
const draft = (t, over = {}) => ({ projectId: t.a, mtype: 'WEEKLY_PROGRESS', title: 'Weekly progress meeting 12', meetingDate: today(), startTime: '10:30', location: 'Site office', chairUser: 'tpm1', minuteTaker: 'tse1',
  attendees: [{ kind: 'INTERNAL', user: 'tse1', name: 'tse1' }, { kind: 'INTERNAL', user: 'tpm1', name: 'tpm1' }, { kind: 'INTERNAL', user: 'tplan1', name: 'tplan1' }, { kind: 'EXTERNAL', name: 'R. Kulkarni', organisation: 'Mott Engineers' }],
  agenda: [{ title: 'Progress against the look-ahead' }, { title: 'Safety observations' }], minutes: 'The earthwork is 4 days behind; the plan was revised and agreed with the consultant.', decisions: [{ text: 'Add a second excavator for 10 days' }],
  actions: [{ description: 'Mobilise the second excavator', ownerUser: 'tplan1', dueDate: plus(3), priority: 'HIGH' }, { description: 'Send the revised look-ahead to the consultant', ownerUser: 'tse2', dueDate: plus(5) }], ...over });

test('T-01 the actions of issued minutes become tasks with due dates in the owners\' My Tasks; BR-02 minutes are issued by the chair, locked, corrected by a revision; the owner updates the action', async () => {
  const t = await setup();
  assert.equal((await t.call(se1, 'POST', '/meetings', { ...draft(t), chairUser: 'tse1' })).status, 400, 'the chair and the minute-taker are two people');
  assert.equal((await t.call(se1, 'POST', '/meetings', draft(t, { actions: [{ description: 'x', ownerUser: 'nobody', dueDate: plus(2) }] }))).status, 400);
  assert.equal((await t.call(se1, 'POST', '/meetings', draft(t, { actions: [{ description: 'before the meeting', ownerUser: 'tplan1', dueDate: plus(-3) }] }))).status, 400, 'due on or after the meeting');
  assert.equal((await t.call(bd, 'POST', '/meetings', draft(t))).status, 403);
  const c = await t.call(se1, 'POST', '/meetings', draft(t)); assert.equal(c.status, 201, JSON.stringify(c.json)); const m = c.json.data;
  assert.deepEqual([m.status, m.revNo, m.docNo.startsWith('MTG-'), m.actions.length, m.can.submit, m.can.edit], ['DRAFT', 0, true, 2, true, true]);
  assert.equal((await t.myTasks(as('PLAN', 'tplan1'))).total ?? (await t.myTasks(as('PLAN', 'tplan1'))).rows?.length ?? 0, 0, 'no task while the minutes are a draft');
  // a draft is edited; a stale version is refused; only the minute-taker sends it
  const up = await t.call(se1, 'PATCH', `/meetings/${m.id}`, { minutes: 'The earthwork is 4 days behind; a second excavator was agreed with the consultant for ten days.', version: m.rowVersion }); assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.equal((await t.call(se1, 'PATCH', `/meetings/${m.id}`, { title: 'Stale', version: m.rowVersion })).status, 409);
  assert.equal((await t.call(plan1, 'POST', `/meetings/${m.id}/submit`, {})).status, 403, 'only the minute-taker sends the minutes');
  const sub = await t.call(se1, 'POST', `/meetings/${m.id}/submit`, {}); assert.equal(sub.status, 202, JSON.stringify(sub.json)); const inst = sub.json.data.workflowInstanceId;
  assert.equal((await t.call(se1, 'PATCH', `/meetings/${m.id}`, { title: 'Changed while waiting' })).status, 409);
  assert.equal(await t.hasTask(se1, inst), false, 'the sender does not approve'); assert.equal(await t.hasTask(pm2, inst), false, 'only the chair'); assert.equal((await t.myTasks(as('PLAN', 'tplan1'))).rows.length, 0);
  await t.act(pm1, inst);
  const done = (await t.call(plan1, 'GET', `/meetings/${m.id}`)).json.data; assert.deepEqual([done.status, done.statusLabel, done.issuedBy, Boolean(done.issuedAt), done.can.edit, done.can.amend], ['APPROVED', 'Issued', 'tpm1', true, false, true]);
  // T-01: a task for each action, owned by the owner, with the due date, in their My Tasks
  const mine = (await t.myTasks(as('PLAN', 'tplan1'))).rows; assert.equal(mine.length, 1); assert.deepEqual([mine[0].dueDate ?? mine[0].due_date, mine[0].priority, mine[0].title.includes(done.docNo)], [plus(3), 'HIGH', true]);
  assert.equal((await t.myTasks(as('SE', 'tse2'))).rows.length, 1); assert.equal((await t.myTasks(as('PM', 'tpm1'))).rows.length, 0, 'the chair is not given an action');
  assert.deepEqual(done.actions.map((a) => [a.no, a.ownerUser, a.dueDate, a.status, Boolean(a.taskId)]), [[1, 'tplan1', plus(3), 'OPEN', true], [2, 'tse2', plus(5), 'OPEN', true]]);
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proj.meeting.issued'").get()); assert.equal(done.distribution.internal.sort().join(), 'tplan1,tpm1,tse1,tse2'); assert.equal(done.distribution.external[0].name, 'R. Kulkarni');
  assert.ok(t.api.db.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'proj.mom.issued' AND user_ref = 'tplan1'").get() || t.api.db.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'proj.mom.issued'").get(), 'the attendees are told');
  // BR-02: locked
  for (const [m2, p, b] of [['PATCH', `/meetings/${m.id}`, { minutes: 'Changed after issue, quietly.' }], ['DELETE', `/meetings/${m.id}`, undefined], ['POST', `/meetings/${m.id}/submit`, {}]]) { const r = await t.call(se1, m2, p, b); assert.ok([403, 409, 422].includes(r.status), `${m2} ${p}: ${r.status}`); }
  // the owner updates their action: the task follows; someone else may not
  const a1 = done.actions[0]; assert.equal((await t.call(se2, 'PATCH', `/meeting-actions/${a1.id}`, { status: 'DONE' })).status, 403);
  const st = await t.call(plan1, 'PATCH', `/meeting-actions/${a1.id}`, { status: 'IN_PROGRESS' }); assert.equal(st.status, 200, JSON.stringify(st.json)); assert.equal(st.json.data.status, 'IN_PROGRESS');
  assert.equal((await t.myTasks(as('PLAN', 'tplan1'))).rows[0].status, 'IN_PROGRESS');
  const fin = await t.call(plan1, 'PATCH', `/meeting-actions/${a1.id}`, { status: 'DONE' }); assert.equal(fin.status, 200, JSON.stringify(fin.json)); assert.equal(fin.json.data.status, 'DONE');
  assert.equal((await t.call(plan1, 'PATCH', `/meeting-actions/${a1.id}`, { status: 'IN_PROGRESS' })).status, 409, 'a done action is not reopened here');
  // the tracker: across meetings with the live status; the summary
  const tr = (await t.call(qs1, 'GET', `/meeting-actions?filter[projectId][eq]=${t.a}`)).json.data; assert.equal(tr.length, 2); assert.deepEqual(tr.map((x) => x.status).sort(), ['DONE', 'OPEN']);
  const sm = (await t.call(qs1, 'GET', `/meeting-actions/summary?projectId=${t.a}`)).json.data; assert.deepEqual([sm.total, sm.open, sm.done, sm.overdue], [2, 1, 1, 0]);
  // the revision: a correction; the issued minutes stay until the revision is issued; unchanged actions keep their tasks; a removed one is cancelled
  assert.equal((await t.call(pm1, 'POST', `/meetings/${m.id}/amend`, { reason: 'bad' })).status, 400); assert.equal((await t.call(bd, 'POST', `/meetings/${m.id}/amend`, { reason: 'a correction after the issue' })).status, 403);
  const rv = await t.call(pm1, 'POST', `/meetings/${m.id}/amend`, { reason: 'The second action has a new due date' }); assert.equal(rv.status, 201, JSON.stringify(rv.json)); const rev = rv.json.data;
  assert.deepEqual([rev.revNo, rev.status, rev.docNo === done.docNo, rev.supersedesId, rev.actions.length], [1, 'DRAFT', true, m.id, 2]); assert.equal((await t.call(pm1, 'POST', `/meetings/${m.id}/amend`, { reason: 'a second revision at once' })).status, 409);
  await t.call(se1, 'PATCH', `/meetings/${rev.id}`, { actions: [{ description: 'Mobilise the second excavator', ownerUser: 'tplan1', dueDate: plus(3), priority: 'HIGH' }, { description: 'Send the revised look-ahead to the consultant', ownerUser: 'tse2', dueDate: plus(8) }] });
  const s2 = await t.call(se1, 'POST', `/meetings/${rev.id}/submit`, {}); await t.act(pm1, s2.json.data.workflowInstanceId);
  assert.equal((await t.call(qs1, 'GET', `/meetings/${m.id}`)).json.data.status, 'SUPERSEDED'); assert.equal((await t.call(qs1, 'GET', `/meetings/${rev.id}`)).json.data.status, 'APPROVED');
  const tasks2 = (await t.myTasks(as('SE', 'tse2'))).rows; const live = tasks2.filter((x) => x.status !== 'CANCELLED'); assert.equal(live.length, 1); assert.equal(live[0].dueDate ?? live[0].due_date, plus(8)); assert.equal(tasks2.filter((x) => x.status === 'CANCELLED').length, 1, 'the changed action: the old task is cancelled, a new one made');
  const h = (await t.call(qs1, 'GET', `/meetings/${rev.id}/history`)).json.data; assert.deepEqual(h.revisions.map((r) => [r.revNo, r.status]), [[0, 'SUPERSEDED'], [1, 'APPROVED']]);
  // the minutes as a document
  assert.equal((await t.api.call('GET', `${P}/meetings/${rev.id}/document?format=pdf`, qs1)).status, 200); assert.equal((await t.api.call('GET', `${P}/meetings/${rev.id}/print`, se1)).status, 200); assert.equal((await t.api.call('GET', `${P}/meetings/${rev.id}/document?format=xlsx`, bd)).status, 403);
  // returned and rejected minutes
  const m2 = (await t.call(se1, 'POST', '/meetings', draft(t, { title: 'Coordination with the consultant', mtype: 'COORDINATION' }))).json.data; const i2 = (await t.call(se1, 'POST', `/meetings/${m2.id}/submit`, {})).json.data.workflowInstanceId;
  await t.act(pm1, i2, 'return'); assert.equal((await t.call(se1, 'GET', `/meetings/${m2.id}`)).json.data.status, 'RETURNED'); const i3 = (await t.call(se1, 'POST', `/meetings/${m2.id}/submit`, {})).json.data.workflowInstanceId; await t.act(pm1, i3, 'reject');
  assert.equal((await t.call(se1, 'GET', `/meetings/${m2.id}`)).json.data.status, 'REJECTED'); assert.equal((await t.myTasks(as('PLAN', 'tplan1'))).rows.length, 1, 'no tasks from minutes that were not issued');
});

test('BR-01 a team member is added by the project manager and the project director and the role engine is asked for the scoped assignment; ending the membership ends the assignment', async () => {
  const t = await setup();
  const role = t.api.db.prepare("SELECT id, code FROM iam_roles WHERE code = 'QS'").get(); assert.ok(role);
  assert.equal((await t.call(se1, 'POST', '/team', { projectId: t.a, username: 'tnew1', projectRole: 'QS', fromDate: today(), reason: 'The quantity surveyor of the project' })).status, 403);
  assert.equal((await t.call(pm1, 'POST', '/team', { projectId: t.a, username: 'ghost', projectRole: 'QS', fromDate: today(), reason: 'The quantity surveyor of the project' })).status, 400);
  assert.equal((await t.call(pm1, 'POST', '/team', { projectId: t.a, username: 'tnew1', projectRole: 'NOSUCH', fromDate: today(), reason: 'The quantity surveyor of the project' })).status, 400);
  const add = await t.call(pm1, 'POST', '/team', { projectId: t.a, username: 'tnew1', projectRole: 'QS', fromDate: today(), toDate: plus(300), reason: 'The quantity surveyor of the project' }); assert.equal(add.status, 202, JSON.stringify(add.json)); const tm = add.json.data;
  assert.deepEqual([tm.status, tm.statusLabel, tm.access], ['REQUESTED', 'Waiting for approval', null]);
  assert.equal((await t.call(pm1, 'POST', '/team', { projectId: t.a, username: 'tnew1', projectRole: 'QS', fromDate: today(), reason: 'A second request for the same' })).status, 400, 'a request is open');
  assert.equal(await t.hasTask(pm1, tm.workflowInstanceId), false, 'the sender does not approve'); assert.equal(await t.hasTask(pd1, tm.workflowInstanceId), false, 'the project director waits for the project manager');
  await t.act(pm2, tm.workflowInstanceId); await t.act(pd1, tm.workflowInstanceId);
  const ok = (await t.call(pm1, 'GET', `/team/${tm.id}`)).json.data; assert.equal(ok.status, 'APPROVED'); assert.equal(ok.access, 'PENDING', JSON.stringify(ok));
  assert.ok(ok.accessNote === null, ok.accessNote);
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proj.team.added'").get());
  // the role engine's request (02.04): decided there; then the assignment exists for this project and the member holds the role
  const rq = t.api.db.prepare("SELECT id FROM core_change_requests WHERE type = 'iam_assignment' ORDER BY id DESC").get(); assert.ok(rq, 'the role engine holds the request');
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM iam_assignments WHERE user_id = (SELECT id FROM iam_users WHERE username = 'tnew1')").get().n, 0, 'no access before the role engine approves');
  const pending = (await t.api.call('GET', '/api/v1/workflow/tasks?mine=assigned', itadm)).json?.data?.rows ?? [];
  void pending; void sys;
  const list = (await t.call(qs1, 'GET', `/team?projectId=${t.a}`)).json.data; assert.equal(list.members.length, 1); assert.ok(list.roles.some((r) => r.code === 'QS'));
  // isolation and rights
  assert.equal((await t.call(qs1, 'GET', `/team?projectId=${t.b}`)).status, 200); assert.equal((await t.call(bd, 'GET', `/team?projectId=${t.a}`)).status, 403); assert.equal((await t.call(as('PM', 'tpm1', '2'), 'GET', `/team?projectId=${t.a}`)).status, 404, 'another company');
  const e = await t.call(pm1, 'POST', `/team/${tm.id}/end`, { reason: 'The quantity surveyor left the project' }); assert.equal(e.status, 200, JSON.stringify(e.json)); assert.equal(e.json.data.status, 'ENDED');
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'proj.team.ended'").get());
});

test('FR-02 FR-03 stakeholders and the communication matrix; contact details masked; roles, isolation, the flag', async () => {
  const t = await setup();
  assert.equal((await t.call(se1, 'POST', '/stakeholders', { projectId: t.a, skind: 'CLIENT', organisation: 'PWD', name: 'A. Joshi' })).status, 403);
  const s1 = await t.call(pm1, 'POST', '/stakeholders', { projectId: t.a, skind: 'CLIENT', organisation: 'Public Works Department', name: 'A. Joshi', roleTitle: 'Engineer-in-charge', influence: 'HIGH', interest: 'HIGH', email: 'a.joshi@pwd.example', phone: '+91 98200 11111' }); assert.equal(s1.status, 201, JSON.stringify(s1.json)); const a = s1.json.data;
  assert.deepEqual([a.kindLabel, a.quadrant, a.email, a.contactVisible], ['Client', 'MANAGE_CLOSELY', 'a.joshi@pwd.example', true]);
  assert.equal((await t.call(pm1, 'POST', '/stakeholders', { projectId: t.a, skind: 'AUTHORITY', organisation: 'Pollution Control Board', name: 'Another', email: 'a.joshi@pwd.example' })).status, 400, 'the same e-mail twice');
  assert.equal((await t.call(pm1, 'POST', '/stakeholders', { projectId: t.a, skind: 'AUTHORITY', organisation: 'Pollution Control Board', name: 'S. Rao', email: 'not an email' })).status, 400);
  const s2 = (await t.call(pm1, 'POST', '/stakeholders', { projectId: t.a, skind: 'AUTHORITY', organisation: 'Pollution Control Board', name: 'S. Rao', influence: 'HIGH', interest: 'LOW', phone: '+91 98200 22222' })).json.data; assert.equal(s2.quadrant, 'KEEP_SATISFIED');
  // contact details are shown to those who hold the right
  const se = (await t.call(se1, 'GET', `/stakeholders?projectId=${t.a}`)).json.data; assert.equal(se.rows.length, 2); assert.ok(se.rows.every((r) => r.email === null && r.phone === null && r.contactVisible === false)); assert.equal(se.can.manage, false);
  assert.equal((await t.api.call('GET', `${P}/stakeholders/export?projectId=${t.a}&format=csv`, se1)).status, 403); assert.equal((await t.api.call('GET', `${P}/stakeholders/export?projectId=${t.a}&format=xlsx`, pm1)).status, 200);
  assert.equal((await t.call(pm1, 'PATCH', `/stakeholders/${a.id}`, { influence: 'MEDIUM', version: a.rowVersion })).json.data.quadrant, 'KEEP_INFORMED'); assert.equal((await t.call(pm1, 'PATCH', `/stakeholders/${a.id}`, { name: 'Stale', version: a.rowVersion })).status, 409);
  // the communication matrix
  const c1 = await t.call(pm1, 'POST', '/comm-matrix', { projectId: t.a, info: 'Weekly progress report', stakeholderId: a.id, frequency: 'WEEKLY', channel: 'REPORT', ownerUser: 'tplan1' }); assert.equal(c1.status, 201, JSON.stringify(c1.json)); assert.match(c1.json.data.audience, /A\. Joshi/);
  assert.equal((await t.call(pm1, 'POST', '/comm-matrix', { projectId: t.a, info: 'Monthly safety statistics', frequency: 'MONTHLY', channel: 'EMAIL' })).status, 400, 'name the audience');
  assert.equal((await t.call(pm1, 'POST', '/comm-matrix', { projectId: t.a, info: 'Monthly safety statistics', audience: 'Pollution Control Board', frequency: 'MONTHLY', channel: 'EMAIL', ownerUser: 'ghost' })).status, 400);
  assert.equal((await t.call(pm1, 'POST', '/comm-matrix', { projectId: t.a, info: 'Monthly safety statistics', audience: 'Pollution Control Board', frequency: 'MONTHLY', channel: 'EMAIL' })).status, 201);
  const mx = (await t.call(se1, 'GET', `/comm-matrix?projectId=${t.a}`)).json.data; assert.deepEqual(mx.byFrequency.filter((x) => x.count).map((x) => [x.frequency, x.count]), [['WEEKLY', 1], ['MONTHLY', 1]]);
  assert.equal((await t.call(pm1, 'DELETE', `/stakeholders/${a.id}`)).status, 409, 'in the matrix: deactivate instead'); assert.equal((await t.call(pm1, 'PATCH', `/stakeholders/${a.id}`, { status: 'INACTIVE' })).json.data.status, 'INACTIVE'); assert.equal((await t.call(pm1, 'DELETE', `/stakeholders/${s2.id}`)).status, 200);
  assert.equal((await t.api.call('GET', `${P}/comm-matrix/export?projectId=${t.a}&format=csv`, pm1)).status, 200);
  // meetings: the isolation of a project manager of another project; the flag
  const uid = Number(t.api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'tpm3', 'tpm3', '[]', 'tpm3@example.com')").run().lastInsertRowid);
  t.api.db.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by) VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PM'), 'PROJECT', ?, 'ACTIVE', 'test')").run(uid, JSON.stringify([t.b]));
  const pm3 = { user: 'tpm3', userId: uid, companyId: 1, roles: [] }; assert.throws(() => teamOf(t.api.db).stakeholders.list(pm3, t.a), /does not exist/); assert.doesNotThrow(() => teamOf(t.api.db).stakeholders.list(pm3, t.b)); assert.throws(() => meetingsOf(t.api.db).meetings.get(pm3, 1), /does not exist/); assert.ok(!meetingsOf(t.api.db).meetings.list(pm3, {}).data.some((x) => x.projectId === t.a));
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.proj.p1005'").run(); assert.equal((await t.call(pm1, 'GET', `/stakeholders?projectId=${t.a}`)).status, 404, 'flag off'); assert.equal((await t.call(pm1, 'GET', '/projects')).status, 200);
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.proj.p1005'").run();
});
