import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { tasksOf, nextDate } from '../src/server/platform/tasks/index.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { workflowOf } from '../src/server/platform/workflow/index.js';
import { setupCompany, startApi } from './helpers.js';

// Part 04.08: task management and the routing of senior-initiated tasks.
// T-01 an instruction routes to the right employee through the matrix, and a missing mapping goes to the head of the department; T-02 an overdue task escalates along the path; T-03 a task that needs
// evidence cannot be completed without a file.
const T = '/api/v1/tsk';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const key = (k = 't') => ({ ...json, 'idempotency-key': `tk-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const pd = as('PD', 'pd1');
const pm = as('PM', 'pm1');
const hr = as('HRMGR', 'hr1');
const sys = as('SYSADM', 'sys1');
const emp = as('EMP', 'emp1');
const emp2 = as('EMP', 'emp2');

const user = (api, name, roles) => api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(name, name.toUpperCase(), JSON.stringify(roles), `${name}@example.com`);
const setup = async () => {
  const api = await startApi();
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'test')").run();
  for (const [n, r] of [['pd1', ['PD']], ['pm1', ['PM']], ['hr1', ['HRMGR']], ['hr2', ['HRMGR']], ['sys1', ['SYSADM']], ['emp1', ['EMP']], ['emp2', ['EMP']], ['safehead', ['EMP']], ['dir1', ['DIR']]]) user(api, n, r);
  const project = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 't', 'test')").run().lastInsertRowid);
  const head = api.db.prepare("SELECT id FROM iam_users WHERE username = 'safehead'").get().id;
  const dept = Number(api.db.prepare("INSERT INTO org_departments (company_id, kind, code, name, head_user_id, created_by, source_type) VALUES (1, 'DEPARTMENT', 'HSE', 'Safety', ?, 't', 't')").run(head).lastInsertRowid);
  const hrDept = Number(api.db.prepare("INSERT INTO org_departments (company_id, kind, code, name, created_by, source_type) VALUES (1, 'DEPARTMENT', 'HRD', 'Human resources', 't', 't')").run().lastInsertRowid);
  return { api, project, dept, hrDept, core: tasksOf(api.db), runtime: runtimeOf(api.db), engine: workflowOf(api.db) };
};
const row = (api, { topic, name = topic, dept, role, fallback = null, evidence = 0, verify = 0, process = null, days = 5 }) => api.db.prepare("INSERT INTO tsk_routing_matrix (company_id, topic_code, topic_name, department_id, role_code, fallback_user_ref, raci_process_code, default_priority, default_due_days, requires_evidence, requires_verification, effective_from, status, batch_id, created_by, source_type) VALUES (1, ?, ?, ?, ?, ?, ?, 'HIGH', ?, ?, ?, '2026-01-01', 'ACTIVE', 1, 't', 'test')").run(topic, name, dept, role, fallback, process, days, evidence, verify);
const make = async (api, who, body = {}) => { const r = await api.call('POST', `${T}/tasks`, { ...who, headers: key('m'), body: { title: 'Check the shuttering', ...body } }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.data; };
const act = (api, who, id, action, body = {}) => api.call('POST', `${T}/tasks/${id}/${action}`, { ...who, headers: key(action), body });

test('T-01 FR-03 an instruction by topic goes to the employee the matrix names; with no mapping or nobody in the role it goes to the head of the department', async () => {
  const { api, dept, hrDept, project, core } = await setup();
  row(api, { topic: 'hr.leave', name: 'Leave policy', dept: hrDept, role: 'HRMGR', verify: 1 });
  row(api, { topic: 'safety.ppe', name: 'Protective equipment', dept, role: 'QAMGR', evidence: 1 });
  row(api, { topic: 'safety.drill', name: 'Fire drill', dept, role: 'QAMGR', fallback: 'emp2' });
  // the holder of the role with the fewest open tasks (hr2 already has one)
  await make(api, hr, { title: 'Existing', assignees: ['hr2'], projectId: project }).catch(() => null);
  core.create({ companyId: 1, title: 'Existing task', assignees: ['hr2'], assigner: 'pd1', actor: 'pd1' });
  const preview = await api.call('GET', `${T}/tasks/route?topicCode=hr.leave`, pd);
  assert.deepEqual([preview.json.data.employee, preview.json.data.via, preview.json.data.department.name, preview.json.data.role], ['hr1', 'role_holder', 'Human resources', 'HRMGR']);
  const r = await api.call('POST', `${T}/instructions`, { ...pd, headers: key('i'), body: { title: 'Brief the sites on the leave policy', topicCode: 'hr.leave', projectId: project } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const t = r.json.data;
  assert.deepEqual([t.origin, t.status, t.requiresAcceptance, t.requiresVerification, t.priority, t.departmentId], ['instruction', 'OPEN', true, true, 'HIGH', hrDept]);
  assert.deepEqual(t.assignees.map((a) => a.user), ['hr1']);
  assert.equal(t.assigner, 'pd1');
  assert.equal(t.routing.via, 'role_holder');
  assert.ok(t.dueDate > core.today(), 'the due date comes from the topic');
  // nobody holds QAMGR: the fallback person, then the head of the department
  const fb = await api.call('POST', `${T}/instructions`, { ...pd, headers: key('i'), body: { title: 'Run the fire drill', topicCode: 'safety.drill' } });
  assert.deepEqual([fb.json.data.assignees[0].user, fb.json.data.routing.via], ['emp2', 'fallback']);
  const head = await api.call('POST', `${T}/instructions`, { ...pd, headers: key('i'), body: { title: 'Issue helmets', topicCode: 'safety.ppe' } });
  assert.deepEqual([head.json.data.assignees[0].user, head.json.data.routing.via, head.json.data.requiresEvidence], ['safehead', 'department_head', true]);
  assert.match(head.json.data.routing.trail.join(' '), /Nobody holds the role QAMGR/);
  // a topic the matrix does not know: the head of the department the sender named; with no department at all, a clear refusal
  const unknown = await api.call('POST', `${T}/instructions`, { ...pd, headers: key('i'), body: { title: 'Something odd', topicCode: 'nothing.here', departmentId: dept } });
  assert.deepEqual([unknown.json.data.assignees[0].user, unknown.json.data.routing.failed !== null], ['safehead', true]);
  assert.ok(api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'tsk_tasks' AND action = 'routing_failed'").get(), 'a routing failure is written down');
  const none = await api.call('POST', `${T}/instructions`, { ...pd, headers: key('i'), body: { title: 'Something odd', topicCode: 'nothing.here' } });
  assert.equal(none.status, 422);
  // the person must accept; only they can
  assert.equal((await act(api, as('EMP', 'emp1'), t.id, 'accept')).status, 404, 'someone with no part in the task does not see it');
  assert.equal((await act(api, as('HRMGR', 'hr1'), t.id, 'start')).status, 409, 'it must be accepted first');
  assert.equal((await act(api, as('HRMGR', 'hr1'), t.id, 'accept')).json.data.status, 'ACCEPTED');
  // only seniors raise instructions
  assert.equal((await api.call('POST', `${T}/instructions`, { ...emp, headers: key('i'), body: { title: 'Do it', topicCode: 'hr.leave' } })).status, 403);
  await api.close();
});

test('T-03 FR-04 BR-01 evidence and verification: no completion without a file, no closing before the assigner verifies, the doer cannot verify', async () => {
  const { api, project } = await setup();
  const t = await make(api, pd, { title: 'Photograph the rebar', assignees: ['emp1'], requiresEvidence: true, requiresVerification: true, projectId: project, dueDate: '2099-01-01' });
  assert.equal(t.status, 'OPEN');
  assert.equal((await act(api, emp, t.id, 'start')).json.data.status, 'IN_PROGRESS');
  const blocked = await act(api, emp, t.id, 'complete');
  assert.equal(blocked.status, 422);
  assert.match(blocked.json.error.message, /needs evidence/);
  // a file through the file service
  api.db.prepare("INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, linked_entity, linked_id, created_by, source_type) VALUES (1, ?, 'rebar.jpg', 'jpg', 'image/jpeg', 'image', 1000, ?, 'CLEAN', 'tsk_task', ?, 'emp1', 'test')").run(`k-${Math.random()}`, `h-${Math.random()}`, t.id);
  api.db.prepare("UPDATE core_files SET scan_status = 'INFECTED' WHERE linked_entity = 'tsk_task'").run();
  assert.equal((await act(api, emp, t.id, 'complete')).status, 422, 'an infected file is not evidence');
  api.db.prepare("UPDATE core_files SET scan_status = 'CLEAN' WHERE linked_entity = 'tsk_task'").run();
  const done = await act(api, emp, t.id, 'complete');
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.data.status, 'DONE');
  // BR-01: not closed before it is verified; the doer cannot verify; the assigner can
  assert.equal((await act(api, pd, t.id, 'close')).status, 422);
  assert.equal((await act(api, emp, t.id, 'verify')).status, 403);
  assert.equal((await act(api, pm, t.id, 'verify')).status, 403, 'a manager who sees the task still cannot verify it');
  assert.equal((await act(api, as('EMP', 'stranger'), t.id, 'verify')).status, 404, 'a stranger does not see the task');
  const ver = await act(api, pd, t.id, 'verify');
  assert.equal(ver.status, 200, JSON.stringify(ver.json));
  assert.deepEqual([ver.json.data.status, ver.json.data.verifiedBy], ['CLOSED', 'pd1']);
  assert.ok(api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'tsk_tasks' AND action = 'verify'").get());
  // sent back with a reason; the reason is required
  assert.equal((await act(api, pd, t.id, 'reopen', {})).status, 400);
  const back = await act(api, pd, t.id, 'reopen', { reason: 'The photo is of the wrong bay.' });
  assert.deepEqual([back.json.data.status, back.json.data.verifiedBy], ['IN_PROGRESS', null]);
  // a delegate of the assigner may verify
  await act(api, emp, t.id, 'complete');
  assert.equal((await act(api, as('DIR', 'dir1'), t.id, 'verify')).status, 403, 'a director who is not the delegate cannot');
  api.db.prepare("INSERT INTO wf_delegations (company_id, delegator, delegate, delegator_roles_json, from_date, to_date, reason, status, created_by, source_type) VALUES (1, 'pd1', 'dir1', '[\"PD\"]', '2000-01-01', '2099-01-01', 'on leave', 'ACTIVE', 't', 't')").run();
  const viaDelegate = await act(api, as('DIR', 'dir1'), t.id, 'verify');
  assert.equal(viaDelegate.status, 200, JSON.stringify(viaDelegate.json));
  assert.equal(viaDelegate.json.data.verifiedBy, 'dir1');
  await api.close();
});

test('BR-02 FR-01 dependencies: a task does not start before its predecessors are done (a setting makes it a warning); loops are refused', async () => {
  const { api, core } = await setup();
  const a = await make(api, pd, { title: 'Pour the footing', assignees: ['emp1'] });
  const b = await make(api, pd, { title: 'Erect the columns', assignees: ['emp1'], dependsOn: [a.id] });
  const view = (await api.call('GET', `${T}/tasks/${b.id}`, emp)).json.data;
  assert.deepEqual(view.dependencies.map((d) => d.taskNo), [a.taskNo]);
  assert.equal(view.warnings.length, 1);
  const stop = await act(api, emp, b.id, 'start');
  assert.equal(stop.status, 422);
  assert.match(stop.json.error.message, new RegExp(a.taskNo));
  // a loop is refused
  const loop = await api.call('POST', `${T}/tasks/${a.id}/dependencies`, { ...pd, headers: key('d'), body: { add: b.id } });
  assert.equal(loop.status, 422);
  assert.match(loop.json.error.message, /loop/);
  assert.equal((await api.call('POST', `${T}/tasks/${a.id}/dependencies`, { ...pd, headers: key('d'), body: { add: a.id } })).status, 422);
  // finished predecessor: the successor starts
  await act(api, emp, a.id, 'start');
  assert.equal((await act(api, emp, a.id, 'complete')).json.data.status, 'CLOSED');
  assert.equal((await act(api, emp, b.id, 'start')).status, 200);
  // the setting: warn only
  const c = await make(api, pd, { title: 'Strip the formwork', assignees: ['emp1'], dependsOn: [b.id] });
  assert.equal((await act(api, emp, c.id, 'start')).status, 422);
  const set = await api.call('POST', '/api/v1/core/parameters', { ...sys, headers: key('p'), body: { key: 'tsk.dependency_block', value: '0', scopeType: 'company', scopeId: 1, effectiveFrom: core.today(), reason: 'warn only at this company' } });
  assert.equal(set.status, 201, JSON.stringify(set.json));
  const warned = await act(api, emp, c.id, 'start');
  assert.equal(warned.status, 200, JSON.stringify(warned.json));
  assert.equal(warned.json.data.status, 'IN_PROGRESS');
  assert.equal(warned.json.data.warnings.length, 1, 'it starts, and says what is not done yet');
  void core;
  await api.close();
});

test('T-02 FR-05 an overdue task escalates along the path of part 04.02, once for each level, and a reminder comes before the date', async () => {
  const { api, project, engine, core } = await setup();
  const t = await make(api, pd, { title: 'Renew the site insurance', assignees: ['emp1'], dueDate: core.today(), projectId: project });
  // the clock moves
  const base = Date.parse(`${core.today()}T06:00:00.000Z`);
  const day = (n) => new Date(base + n * 86_400_000);
  const svc = (await import('../src/server/modules/eng/tasks.js')).createTaskService({ db: api.db, engine });
  engine.setClock(() => day(0));
  assert.equal(svc.sweep().reminded, 1, 'a task due today is reminded');
  assert.equal(svc.sweep().reminded, 0, 'once a day');
  assert.equal(svc.sweep().escalated, 0, 'not late yet');
  engine.setClock(() => day(1));
  const one = svc.sweep();
  assert.equal(one.escalated, 1);
  let task = (await api.call('GET', `${T}/tasks/${t.id}`, emp)).json.data;
  assert.equal(task.escalationLevel, 1);
  assert.equal(task.escalations[0].level, 1);
  assert.ok(task.escalations[0].toRole, 'the level names a role of the path');
  assert.equal(svc.sweep().escalated, 0, 'a level is climbed once');
  engine.setClock(() => day(3));
  assert.equal(svc.sweep().escalated, 1);
  task = (await api.call('GET', `${T}/tasks/${t.id}`, emp)).json.data;
  assert.equal(task.escalationLevel, 2);
  assert.deepEqual(task.escalations.map((e) => e.level), [1, 2]);
  assert.equal(task.overdue, true);
  assert.ok(api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'tsk.task.escalated'").get());
  assert.ok(api.db.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'tsk.task.escalated'").get(), 'the escalation is notified');
  // a finished task is left alone
  const u = await make(api, pd, { title: 'Done in time', assignees: ['emp1'], dueDate: day(-5).toISOString().slice(0, 10) });
  await act(api, emp, u.id, 'complete');
  assert.equal(svc.sweep().escalated, 0);
  await api.close();
});

test('FR-07 recurring tasks: the next occurrence is made when the period comes; dates add days, weeks and months', async () => {
  const { api, engine, core } = await setup();
  assert.equal(nextDate({ freq: 'WEEKLY', interval: 1 }, '2026-11-03'), '2026-11-10');
  assert.equal(nextDate({ freq: 'MONTHLY', interval: 1 }, '2026-01-31'), '2026-02-28');
  assert.equal(nextDate({ freq: 'DAILY', interval: 3 }, '2026-12-30'), '2027-01-02');
  const t = await make(api, pd, { title: 'Weekly safety walk', assignees: ['emp1'], dueDate: core.today(), recurrence: { freq: 'WEEKLY', interval: 1 }, checklist: ['Walk the scaffolds', 'Check the fire points'] });
  assert.deepEqual(t.recurrence, { freq: 'WEEKLY', interval: 1 });
  await act(api, emp, t.id, 'start');
  const svc = (await import('../src/server/modules/eng/tasks.js')).createTaskService({ db: api.db, engine });
  assert.equal(svc.sweep().repeated, 1, 'its day has come');
  assert.equal(svc.sweep().repeated, 0, 'one occurrence at a time');
  const list = (await api.call('GET', `${T}/tasks?view=assigned&status=open`, emp)).json.data;
  assert.equal(list.total, 2);
  const next = list.rows.find((r) => r.id !== t.id);
  assert.equal(next.dueDate, nextDate({ freq: 'WEEKLY', interval: 1 }, core.today()));
  assert.equal(next.origin, 'auto');
  assert.equal(next.seriesId, t.id);
  assert.equal(next.checklist.total, 2);
  assert.equal(next.checklist.done, 0);
  assert.equal((await api.call('POST', `${T}/tasks`, { ...pd, headers: key('r'), body: { title: 'Bad rule', recurrence: { freq: 'HOURLY', interval: 1 }, dueDate: core.today() } })).status, 400);
  await api.close();
});

test('FR-01 FR-02 FR-06 tasks: make, list by view, checklist, comments, reassign, cancel; a module makes a task once for the same source; the sample document leaves a task when it is rejected', async () => {
  const { api, core, project, runtime } = await setup();
  // a person gives themselves a task; giving one to someone else needs the right
  const own = await make(api, emp, { title: 'My own reminder' });
  assert.deepEqual(own.assignees.map((a) => a.user), ['emp1']);
  assert.equal((await api.call('POST', `${T}/tasks`, { ...emp, headers: key('m'), body: { title: 'Do this for me', assignees: ['emp2'] } })).status, 403);
  const t = await make(api, pm, { title: 'Prepare the pour plan', assignees: ['emp1'], watchers: ['emp2'], projectId: project, entity: 'project', entityId: String(project), entityLabel: 'Ring Road', checklist: ['Get the drawing'], priority: 'URGENT', dueDate: '2099-03-01' });
  assert.match(t.taskNo, /^TSK-\d{5}$/);
  // the views
  const mine = (await api.call('GET', `${T}/tasks?view=assigned`, emp)).json.data;
  assert.deepEqual(mine.rows.map((r) => r.title).sort(), ['My own reminder', 'Prepare the pour plan']);
  assert.deepEqual((await api.call('GET', `${T}/tasks?view=watching`, emp2)).json.data.rows.map((r) => r.title), ['Prepare the pour plan']);
  assert.equal((await api.call('GET', `${T}/tasks?view=created`, pm)).json.data.total, 1);
  assert.equal((await api.call('GET', `${T}/tasks?view=team`, emp)).status, 403);
  assert.equal((await api.call('GET', `${T}/tasks?view=team&projectId=${project}`, pm)).json.data.total, 1);
  assert.equal((await api.call('GET', `${T}/tasks?entity=project&entityId=${project}&view=all`, pm)).json.data.total, 1);
  assert.equal((await api.call('GET', `${T}/tasks/${t.id}`, as('EMP', 'stranger'))).status, 404);
  // the checklist and the comments
  const c1 = await api.call('POST', `${T}/tasks/${t.id}/checklist`, { ...emp, headers: key('c'), body: { toggle: { id: (await api.call('GET', `${T}/tasks/${t.id}`, emp)).json.data.checklistItems[0].id, done: true } } });
  assert.equal(c1.json.data.checklist.done, 1);
  assert.equal((await api.call('POST', `${T}/tasks/${t.id}/checklist`, { ...emp, headers: key('c'), body: { add: 'Book the pump' } })).json.data.checklist.total, 2);
  assert.equal((await api.call('POST', `${T}/tasks/${t.id}/comments`, { ...emp2, headers: key('c'), body: { body: 'Pump is free on Friday.' } })).json.data.comments.length, 1);
  // changing it: version check, and who may
  const ver = (await api.call('GET', `${T}/tasks/${t.id}`, pm)).json.data.version;
  assert.equal((await api.call('PATCH', `${T}/tasks/${t.id}`, { ...emp, headers: key('u'), body: { title: 'Mine now' } })).status, 403);
  assert.equal((await api.call('PATCH', `${T}/tasks/${t.id}`, { ...pm, headers: key('u'), body: { title: 'Prepare the pour plan v2', version: ver + 5 } })).status, 409);
  assert.equal((await api.call('PATCH', `${T}/tasks/${t.id}`, { ...pm, headers: key('u'), body: { title: 'Prepare the pour plan v2', version: ver } })).json.data.title, 'Prepare the pour plan v2');
  // reassign, then cancel
  assert.deepEqual((await api.call('PUT', `${T}/tasks/${t.id}/people`, { ...pm, headers: key('p'), body: { assignees: ['emp2'] } })).json.data.assignees.map((a) => a.user), ['emp2']);
  assert.equal((await act(api, pm, t.id, 'cancel', {})).status, 400);
  assert.equal((await act(api, pm, t.id, 'cancel', { reason: 'The pour is moved.' })).json.data.status, 'CANCELLED');
  assert.equal((await act(api, pm, t.id, 'start')).status, 409);
  // FR-02: a module makes a task through the service, once for the same source
  const a1 = core.create({ companyId: 1, title: 'Close NCR-123', entity: 'ncr', entityId: '123', assignees: ['emp1'], origin: 'auto', source: { type: 'ncr', id: '123' }, assigner: 'system', actor: 'system', dueDate: '2099-01-01' });
  const a2 = core.create({ companyId: 1, title: 'Close NCR-123', entity: 'ncr', entityId: '123', assignees: ['emp1'], origin: 'auto', source: { type: 'ncr', id: '123' }, assigner: 'system', actor: 'system' });
  assert.deepEqual([a1.existing, a2.existing, a2.id === a1.id], [false, true, true]);
  assert.equal((await api.call('GET', `${T}/tasks?origin=auto`, emp)).json.data.rows.some((r) => r.entity === 'ncr'), true);
  // the notification of the assignment, and the event
  assert.ok(api.db.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'tsk.task.assigned' AND user_ref = 'emp1'").get());
  assert.ok(api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'tsk.task.created'").get());
  // the work source of "my work"
  const work = await api.call('GET', '/api/v1/ui/work', emp);
  if (work.status === 200) assert.ok(JSON.stringify(work.json).includes('Close NCR-123'));
  // the sample document: a rejection leaves a task for the person who wrote it
  const d = (await api.call('POST', '/api/v1/eng/sample-docs', { ...pd, headers: key('s'), body: { title: 'Shuttering', amount: '12000.00', projectId: project } })).json.data;
  await api.call('POST', `/api/v1/eng/sample-docs/${d.id}/submit`, { ...pd, headers: key('s'), body: {} });
  const task = (await api.call('GET', `${W}/tasks?mine=assigned`, pm)).json.data.rows[0];
  await api.call('POST', `${W}/tasks/${task.id}/act`, { ...pm, headers: key('r'), body: { action: 'reject', comment: 'Too expensive.' } });
  for (let i = 0; i < 5; i += 1) runtime.bus.drain();
  const auto = (await api.call('GET', `${T}/tasks?view=assigned&origin=auto`, pd)).json.data.rows;
  assert.equal(auto.length, 1);
  assert.match(auto[0].title, /Review the rejection/);
  assert.equal(auto[0].entity, 'workflow_instance');
  await api.close();
});

test('FR-03 AC-04 the responsibility matrix: a change is sent for approval and nothing changes until the system administrator approves; one change at a time; bad input refused', async () => {
  const { api, dept } = await setup();
  const body = (over = {}) => ({ rows: [{ topicCode: 'safety.ppe', topicName: 'Protective equipment', departmentId: dept, role: 'PM', defaultPriority: 'HIGH', defaultDueDays: 3, requiresEvidence: true, requiresVerification: false, effectiveFrom: '2099-01-01', ...(over.row ?? {}) }], reason: 'Safety asked for it', ...over.top });
  assert.equal((await api.call('GET', `${T}/routing`, emp)).status, 403);
  assert.equal((await api.call('POST', `${T}/routing/changes`, { ...pm, headers: key('x'), body: body() })).status, 403);
  assert.equal((await api.call('POST', `${T}/routing/changes`, { ...hr, body: body() })).status, 400, 'Idempotency-Key is required');
  assert.equal((await api.call('POST', `${T}/routing/changes`, { ...hr, headers: key('x'), body: body({ row: { role: 'NOPE' } }) })).status, 400);
  assert.equal((await api.call('POST', `${T}/routing/changes`, { ...hr, headers: key('x'), body: body({ row: { departmentId: 99999 } }) })).status, 400);
  assert.equal((await api.call('POST', `${T}/routing/changes`, { ...hr, headers: key('x'), body: body({ row: { effectiveFrom: '2001-01-01' } }) })).status, 400);
  const ok = await api.call('POST', `${T}/routing/changes`, { ...hr, headers: key('x'), body: body() });
  assert.equal(ok.status, 202, JSON.stringify(ok.json));
  assert.equal((await api.call('POST', `${T}/routing/changes`, { ...hr, headers: key('x'), body: body() })).status, 409);
  let list = (await api.call('GET', `${T}/routing`, sys)).json.data;
  assert.deepEqual(list.rows.map((r) => r.status), ['PENDING']);
  assert.equal(list.canEdit, true);
  assert.equal((await api.call('GET', `${T}/tasks/route?topicCode=safety.ppe`, pd)).json.data.via, null, 'a pending row is not in force');
  const task = (await api.call('GET', `${W}/tasks?mine=assigned`, sys)).json.data.rows.find((t) => JSON.stringify(t).includes('TSK_ROUTING'));
  assert.ok(task);
  assert.equal((await api.call('POST', `${W}/tasks/${task.id}/act`, { ...sys, headers: key('a'), body: { action: 'approve', comment: 'ok' } })).status, 200);
  list = (await api.call('GET', `${T}/routing`, sys)).json.data;
  assert.deepEqual(list.rows.map((r) => r.status), ['ACTIVE']);
  assert.ok(api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'tsk_routing_matrix' AND action = 'activate'").get());
  await api.close();
});

test('FR-06 the team dashboard: workload, overdue by person and the trend; only for those who see their team, within their projects; AC-03 who may do what', async () => {
  const { api, project, core } = await setup();
  await make(api, pm, { title: 'Late one', assignees: ['emp1'], projectId: project, dueDate: '2020-01-01' });
  await make(api, pm, { title: 'On time', assignees: ['emp2'], projectId: project, dueDate: '2099-01-01' });
  core.create({ companyId: 1, title: 'Another project', assignees: ['emp2'], assigner: 'pd1', actor: 'pd1', dueDate: '2020-01-01' });
  const d = await api.call('GET', `${T}/dashboard`, pm);
  assert.equal(d.status, 200, JSON.stringify(d.json));
  assert.ok(d.json.data.tiles.open >= 2);
  assert.ok(d.json.data.tiles.overdue >= 1);
  const person = d.json.data.people.find((p) => p.user === 'emp1');
  assert.deepEqual([person.open, person.overdue], [1, 1]);
  assert.equal(d.json.data.trend.length, 8);
  assert.equal(d.json.data.overdueList[0].title, 'Late one');
  for (const [who, status] of [[emp, 403], [as('EMP', 'x'), 403], [sys, 200], [hr, 200], [{ user: null }, 401]]) assert.equal((await api.call('GET', `${T}/dashboard`, who)).status, status);
  assert.equal((await api.call('GET', `${T}/tasks/export?view=assigned&format=csv`, emp)).status, 200);
  assert.equal((await api.call('GET', `${T}/tasks/counts`, emp)).json.data.open, 1);
  await api.close();
});
