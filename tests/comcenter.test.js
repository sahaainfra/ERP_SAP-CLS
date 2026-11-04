import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { messagesOf } from '../src/server/modules/msg/messages.js';
import { autoGroupsOf } from '../src/server/modules/msg/autogroups.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { realtimeOf } from '../src/server/platform/realtime/index.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { setupCompany, startApi } from './helpers.js';

// Part 05.04: the Communication Center. T-01 assigning a person to a project adds them to its group (within a minute: by the event at once, by the minute job at the latest), ending the assignment removes them;
// T-02 an instruction nobody acknowledged by its due time escalates; T-03 a message becomes a task with its attachments, linked back.
const M = '/api/v1/msg';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const key = (k = 'c') => ({ ...json, 'idempotency-key': `cc-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const pd = as('PD', 'pd1');
const pm = as('PM', 'pm1');
const se = as('SE', 'se1');
const se2 = as('SE', 'se2');
const aud = as('AUD', 'aud1');
const sys = as('SYSADM', 'sys1');
const itadm = as('ITADM', 'it1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const user = (api, name, roles) => api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(name, `${name.toUpperCase()} Kumar`, JSON.stringify(roles), `${name}@example.com`);
const act = async (api, who, instanceId, action = 'approve') => {
  const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
  assert.ok(task, `${who.user} has the task`);
  assert.equal((await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key('a'), body: { action, comment: 'checked and fine' } })).status, 200);
};
const setup = async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'test')").run();
  for (const [n, r] of [['pd1', ['PD']], ['pm1', ['PM']], ['se1', ['SE']], ['se2', ['SE']], ['aud1', ['AUD']], ['dir1', ['DIR']], ['sys1', ['SYSADM']], ['it1', ['ITADM']]]) user(api, n, r);
  const events = [];
  realtimeOf(api.db).setEmitter(async ({ room, event }) => { events.push({ room, ...event }); });
  const call = (who, method, path, body, k) => api.call(method, `${M}${path}`, { ...who, headers: key(k), body });
  const project = (code, status = 'ACTIVE') => Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'ROAD', ?, 't', 't')").run(code, `Project ${code}`, status).lastInsertRowid);
  const site = (projectId, code) => Number(api.db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status, created_by, source_type) VALUES (1, ?, ?, ?, 'ACTIVE', 't', 't')").run(projectId, code, `Site ${code}`).lastInsertRowid);
  const assign = (username, roleCode, projectId) => { const uid = Number(api.db.prepare('SELECT id FROM iam_users WHERE username = ?').get(username).id); return Number(api.db.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, reason, created_by, source_type) VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = ? AND company_id IS NULL), 'PROJECT', ?, 'ACTIVE', 'test', 'test', 'test')").run(uid, roleCode, JSON.stringify([projectId])).lastInsertRowid); };
  const group = async (who, title, members) => (await call(who, 'POST', '/conversations', { type: 'GROUP', title, members })).json.data.id;
  const say = async (who, id, body) => { const r = await call(who, 'POST', `/conversations/${id}/messages`, { body }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.data; };
  const runtime = runtimeOf(api.db);
  const drain = () => { for (let i = 0; i < 6; i += 1) runtime.bus.drain(); };
  return { api, call, events, project, site, assign, group, say, runtime, drain };
};
const memberNames = (api, convId) => api.db.prepare('SELECT user_ref FROM msg_members WHERE conversation_id = ? AND left_at IS NULL AND is_active = 1 ORDER BY user_ref').all(convId).map((r) => r.user_ref);

test('T-01 FR-01 auto groups: project, site and department groups are made, follow assignments with a system message, and leave manual members alone', async () => {
  const t = await setup();
  const p = t.project('ALPHA');
  const s = t.site(p, 'ALP-S1');
  const dept = Number(t.api.db.prepare("INSERT INTO org_departments (company_id, code, name, status, created_by, source_type) VALUES (1, 'QA', 'Quality', 'ACTIVE', 't', 't')").run().lastInsertRowid);
  const groups = autoGroupsOf(t.api.db);
  const first = groups.sync(1);
  assert.ok(first.created >= 3, JSON.stringify(first));
  const projConv = t.api.db.prepare("SELECT * FROM msg_conversations WHERE conv_type = 'PROJECT' AND project_id = ?").get(p);
  const siteConv = t.api.db.prepare("SELECT * FROM msg_conversations WHERE conv_type = 'SITE' AND site_id = ?").get(s);
  const deptConv = t.api.db.prepare("SELECT * FROM msg_conversations WHERE conv_type = 'DEPARTMENT' AND department_id = ?").get(dept);
  assert.ok(projConv && siteConv && deptConv, 'the groups exist');
  assert.equal(projConv.title, 'ALPHA Project ALPHA');
  assert.deepEqual(memberNames(t.api, projConv.id), []);
  // a second run changes nothing
  assert.deepEqual([groups.sync(1).created, groups.sync(1).added], [0, 0]);
  // assigning a person adds them (the event runs the sync at once), with a system message and a notification
  const a1 = t.assign('se1', 'SE', p);
  publishEvent(t.api.db, { type: 'iam.assignment.created', entity: 'assignment', entityId: a1, actorId: 'test', companyId: 1, data: { username: 'se1', role: 'SE' } });
  t.drain();
  assert.deepEqual(memberNames(t.api, projConv.id), ['se1'], 'the person is in the project group');
  assert.deepEqual(memberNames(t.api, siteConv.id), ['se1'], 'and in the group of its site');
  const msgs = (await t.call(se, 'GET', `/conversations/${projConv.id}/messages`)).json.data.rows;
  assert.ok(msgs.some((m) => m.kind === 'SYSTEM' && /SE1 Kumar joined/.test(m.body) && /assigned to the project/.test(m.body)), 'the group says who joined and why');
  assert.ok(t.api.db.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'msg.autogroup.joined' AND user_ref = 'se1'").get(), 'the person is told');
  // someone added by hand stays when the assignment of another ends
  t.assign('pd1', 'PD', p); groups.sync(1); // the project director is in the group and may add people (msg.channel.manage)
  const add = await t.call(pd, 'POST', `/conversations/${projConv.id}/members`, { users: ['se2'] });
  assert.equal(add.status, 200, JSON.stringify(add.json));
  assert.ok(memberNames(t.api, projConv.id).includes('se2'));
  // the assignment ends: the person is removed by the next run (the job does it every minute), the hand-made member stays
  t.api.db.prepare("UPDATE iam_assignments SET status = 'ENDED' WHERE id = ?").run(a1);
  const second = groups.sync(1);
  assert.equal(second.removed, 2, 'removed from the project group and the site group');
  assert.deepEqual(memberNames(t.api, projConv.id), ['pd1', 'se2']);
  assert.ok((await t.call(pd, 'GET', `/conversations/${projConv.id}/messages`)).json.data.rows.some((m) => m.kind === 'SYSTEM' && /left/.test(m.body) && /assignment/.test(m.body)));
  // the job does the same work
  const a2 = t.assign('se1', 'SE', p);
  assert.ok(a2);
  await t.runtime.jobs.run?.('msg.comcenter');
  groups.sync(1);
  assert.ok(memberNames(t.api, projConv.id).includes('se1'), 'back after a new assignment');
});

test('FR-01 team and discipline groups come from rules that change only by an approved change; maker cannot approve', async () => {
  const t = await setup();
  const p = t.project('BRAVO');
  t.assign('se1', 'SE', p); t.assign('pm1', 'PM', p);
  const rules = (over = []) => ({ rules: [{ groupType: 'PROJECT', scopeType: 'COMPANY' }, { groupType: 'SITE', scopeType: 'COMPANY' }, { groupType: 'DEPARTMENT', scopeType: 'COMPANY' }, { groupType: 'DISCIPLINE', scopeType: 'COMPANY', title: 'Civil', roleFilter: ['SE'] }, ...over], reason: 'Civil engineers need their own group' });
  assert.equal((await t.call(se, 'GET', '/auto-group-rules')).status, 403);
  assert.equal((await t.call(pd, 'POST', '/auto-group-rules/changes', rules())).status, 403, 'only the system administrator proposes');
  assert.equal((await t.call(sys, 'POST', '/auto-group-rules/changes', { rules: [{ groupType: 'DISCIPLINE', title: '', roleFilter: [] }], reason: 'a bad rule' })).status, 400);
  const first = (await t.call(sys, 'GET', '/auto-group-rules')).json.data;
  assert.equal(first.rules.length, 3, 'the standard rules');
  const prop = await t.call(sys, 'POST', '/auto-group-rules/changes', rules());
  assert.equal(prop.status, 202, JSON.stringify(prop.json));
  assert.equal((await t.call(sys, 'POST', '/auto-group-rules/changes', rules())).status, 409, 'one change at a time');
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, sys)).json.data.rows.find((x) => x.instance.id === prop.json.data.workflow.id), undefined, 'the maker cannot approve');
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM msg_conversations WHERE conv_type = 'TEAM'").get().n, 0, 'nothing changes before approval');
  await act(t.api, itadm, prop.json.data.workflow.id);
  const team = t.api.db.prepare("SELECT * FROM msg_conversations WHERE conv_type = 'TEAM'").get();
  assert.ok(team, 'the discipline group exists after approval');
  assert.equal(team.title, 'BRAVO · Civil');
  assert.deepEqual(memberNames(t.api, team.id), ['se1'], 'only people with a role of the group');
  const now = (await t.call(aud, 'GET', '/auto-group-rules')).json.data;
  assert.equal(now.rules.length, 4);
  assert.equal(now.history[0].status, 'ACTIVE');
  assert.ok(now.groups.some((g) => g.title === 'BRAVO · Civil'));
  // a rejected change changes nothing
  const rej = await t.call(sys, 'POST', '/auto-group-rules/changes', { rules: [{ groupType: 'PROJECT', scopeType: 'COMPANY' }], reason: 'Only the project groups' });
  await act(t.api, itadm, rej.json.data.workflow.id, 'reject');
  assert.equal((await t.call(aud, 'GET', '/auto-group-rules')).json.data.rules.length, 4);
  assert.equal((await t.call(sys, 'POST', '/auto-group-rules/sync')).status, 200);
  assert.equal((await t.call(aud, 'POST', '/auto-group-rules/sync')).status, 403);
});

test('FR-03 BR-01 instructions: only the sender, only with the right, only to the people of the conversation; acknowledgement, bulk rules, register and export', async () => {
  const t = await setup();
  const g = await t.group(pm, 'Pier 4 crew', ['se1', 'se2', 'pd1']);
  const m = await t.say(pm, g, 'Stop all concreting on pier 4 until the pump is re-calibrated');
  const other = await t.say(se, g, 'Understood');
  const due = new Date(Date.now() + 2 * 86_400_000).toISOString();
  // BR-01
  assert.equal((await t.call(se, 'POST', `/messages/${other.id}/instruction`, { priority: 'HIGH', dueAt: due })).status, 403, 'a site engineer may not send instructions');
  assert.equal((await t.call(pd, 'POST', `/messages/${m.id}/instruction`, { priority: 'HIGH', dueAt: due })).status, 403, 'only the sender of the message');
  assert.equal((await t.call(as('PM', 'pm9'), 'POST', `/messages/${m.id}/instruction`, { priority: 'HIGH', dueAt: due })).status, 404, 'not a member: the message does not exist for them');
  assert.equal((await t.call(pm, 'POST', `/messages/${m.id}/instruction`, { priority: 'HIGH' })).status, 422, 'a due time is needed to escalate');
  assert.equal((await t.call(pm, 'POST', `/messages/${m.id}/instruction`, { priority: 'HIGH', dueAt: '2020-01-01' })).status, 422, 'not in the past');
  const made = await t.call(pm, 'POST', `/messages/${m.id}/instruction`, { priority: 'HIGH', dueAt: due, title: 'Stop concreting on pier 4' });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const i = made.json.data;
  assert.deepEqual([i.priority, i.total, i.acknowledged, i.status], ['HIGH', 3, 0, 'OPEN']);
  assert.equal((await t.call(pm, 'POST', `/messages/${m.id}/instruction`, { priority: 'LOW', dueAt: due })).status, 409, 'one instruction per message');
  // it shows on the message, in the group and in the notifications
  const shown = (await t.call(se, 'GET', `/conversations/${g}/messages`)).json.data.rows.find((r) => r.id === m.id);
  assert.deepEqual([shown.instruction.priority, shown.instruction.mine.recipient, shown.instruction.mine.acknowledgedAt], ['HIGH', true, null]);
  assert.ok(t.events.some((e) => e.type === 'msg.instruction.created' && e.room === 'user:se1'));
  // the worklist: urgent first
  const m2 = await t.say(pm, g, 'Daily report by 6');
  await t.call(pm, 'POST', `/messages/${m2.id}/instruction`, { priority: 'LOW', dueAt: due, title: 'Daily report' });
  const pend = (await t.call(se, 'GET', '/acknowledgements/pending')).json.data;
  assert.deepEqual(pend.rows.map((r) => r.title), ['Stop concreting on pier 4', 'Daily report']);
  assert.equal(pend.counts.pending, 2);
  // a high priority one cannot be acknowledged in bulk; a low one can
  assert.equal((await t.call(se, 'POST', '/acknowledgements/bulk', { ids: [i.id] })).status, 422);
  const low = pend.rows[1].id;
  assert.equal((await t.call(se, 'POST', '/acknowledgements/bulk', { ids: [low] })).json.data.acknowledged, 1);
  // acknowledging: only a recipient, once (a replay answers the same)
  assert.equal((await t.call(as('SE', 'se9'), 'POST', `/instructions/${i.id}/ack`, {})).status, 404);
  assert.equal((await t.call(pm, 'POST', `/instructions/${i.id}/ack`, {})).status, 404, 'the sender is not a recipient');
  const ack = await t.call(se, 'POST', `/instructions/${i.id}/ack`, { response: 'Done, pump isolated' });
  assert.deepEqual([ack.status, ack.json.data.acknowledged, ack.json.data.percent], [200, 1, 33]);
  assert.equal((await t.call(se, 'POST', `/instructions/${i.id}/ack`, {})).json.data.replay, true);
  assert.ok(t.events.some((e) => e.type === 'msg.instruction.acknowledged' && e.room === 'user:pm1'), 'the sender is told in real time');
  // the register: the sender's own, with percentages; the recipients are in the details
  const reg = (await t.call(pm, 'GET', '/instructions')).json.data;
  assert.equal(reg.rows.length, 2);
  assert.equal(reg.rows.find((r) => r.id === i.id).percent, 33);
  const det = (await t.call(pm, 'GET', `/instructions/${i.id}`)).json.data;
  assert.deepEqual(det.recipients.map((r) => [r.username, Boolean(r.acknowledgedAt)]).sort(), [['pd1', false], ['se1', true], ['se2', false]]);
  assert.equal((await t.call(se2, 'GET', `/instructions/${i.id}`)).json.data.recipients, undefined, 'a recipient sees no list of the others');
  assert.equal((await t.call(as('SE', 'se9'), 'GET', `/instructions/${i.id}`)).status, 404);
  assert.equal((await t.call(se, 'GET', '/instructions')).status, 403, 'the register is for those who may send instructions');
  assert.equal((await t.call(pm, 'GET', '/instructions?view=all')).status, 403);
  assert.equal((await t.call(aud, 'GET', '/instructions?view=all')).json.data.rows.length, 2);
  const csv = await t.api.raw('GET', `${M}/instructions/export?view=all`, aud);
  assert.equal(csv.status, 200);
  assert.match(csv.buffer.toString('utf8'), /Instruction,Conversation,Sender,Priority/);
  // everyone acknowledges: completed, the sender is told
  await t.call(se2, 'POST', `/instructions/${i.id}/ack`, {});
  const done = await t.call(pd, 'POST', `/instructions/${i.id}/ack`, {});
  assert.equal(done.json.data.status, 'COMPLETED');
  assert.ok(t.api.db.prepare("SELECT 1 FROM msg_messages WHERE conversation_id = ? AND kind = 'SYSTEM' AND body LIKE 'Everyone acknowledged%'").get(g));
  // cancel
  assert.equal((await t.call(pm, 'POST', `/instructions/${(await t.call(pm, 'GET', '/instructions?status=OPEN')).json.data.rows[0].id}/cancel`, { reason: 'Replaced by a new one' })).json.data.status, 'CANCELLED');
});

test('T-02 FR-03 FR-06 an instruction nobody acknowledged by its due time escalates to the managers; a flagged conversation escalates when unresolved', async () => {
  const t = await setup();
  const p = t.project('CHARLIE');
  const g = await t.group(pm, 'Pier crew', ['se1', 'se2']);
  t.api.db.prepare('UPDATE msg_conversations SET project_id = ? WHERE id = ?').run(p, g);
  const m = await t.say(pm, g, 'Submit the pour records today');
  const i = (await t.call(pm, 'POST', `/messages/${m.id}/instruction`, { priority: 'URGENT', dueAt: new Date(Date.now() + 3_600_000).toISOString() })).json.data;
  const { createCommService } = await import('../src/server/modules/msg/comcenter.js');
  const comm = createCommService({ db: t.api.db, base: messagesOf(t.api.db) });
  assert.equal(comm.instructions.escalate(1), 0, 'not before the due time');
  await t.call(se, 'POST', `/instructions/${i.id}/ack`, {}); // se1 acknowledges, se2 does not
  t.api.db.prepare('UPDATE msg_instructions SET due_at = ? WHERE id = ?').run(new Date(Date.now() - 60_000).toISOString(), i.id);
  assert.equal(comm.instructions.escalate(1), 1, 'escalated at the due time');
  assert.equal(comm.instructions.escalate(1), 0, 'once');
  const row = t.api.db.prepare('SELECT * FROM msg_instructions WHERE id = ?').get(i.id);
  assert.deepEqual([row.instruction_status, row.escalation_level], ['ESCALATED', 1]);
  const note = t.api.db.prepare("SELECT body FROM msg_messages WHERE conversation_id = ? AND kind = 'SYSTEM' AND body LIKE 'Not acknowledged%'").get(g);
  assert.match(note.body, /SE2 Kumar/);
  assert.ok(t.api.db.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'msg.instruction.escalated' AND user_ref = 'pm1'").get(), 'the sender is told');
  assert.ok(t.api.db.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'msg.instruction' AND user_ref = 'se2'").get(), 'the recipients were told when it was sent');
  assert.equal((await t.call(pm, 'GET', '/instructions?overdue=1')).json.data.rows.length, 1);
  // the late acknowledgement still counts and completes it
  assert.equal((await t.call(se2, 'POST', `/instructions/${i.id}/ack`, {})).json.data.status, 'COMPLETED');
  // FR-06: flag the conversation; nothing happens before the time; then managers are told and join the group
  const flag = await t.call(se, 'POST', `/conversations/${g}/escalate`, { reason: 'The crane is still not on site', afterHours: 1 });
  assert.equal(flag.status, 201, JSON.stringify(flag.json));
  assert.equal((await t.call(se, 'POST', `/conversations/${g}/escalate`, { reason: 'And again the same thing', afterHours: 1 })).status, 409);
  assert.equal(comm.escalations.cycle(1), 0);
  t.api.db.prepare('UPDATE msg_escalations SET escalate_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), flag.json.data.id);
  assert.equal(comm.escalations.cycle(1), 1);
  const esc = (await t.call(se, 'GET', '/escalations?view=mine')).json.data.rows[0];
  assert.equal(esc.status, 'ESCALATED');
  assert.ok(esc.escalatedTo.length >= 1, 'the managers of the path');
  assert.ok(memberNames(t.api, g).includes(esc.escalatedTo[0].username), 'a manager joins a group');
  assert.equal((await t.call(se, 'GET', '/conversations?view=escalated')).json.data.rows.length, 1);
  assert.equal((await t.call(as('SE', 'se9'), 'POST', `/escalations/${esc.id}/resolve`, { resolution: 'not mine' })).status, 404);
  assert.equal((await t.call(se, 'POST', `/escalations/${esc.id}/resolve`, { resolution: 'The crane arrived' })).json.data.status, 'RESOLVED');
  // a direct conversation is never opened to the managers
  const d = (await t.call(se, 'POST', '/conversations', { type: 'DIRECT', members: ['se2'] })).json.data.id;
  const f2 = await t.call(se, 'POST', `/conversations/${d}/escalate`, { reason: 'We disagree about the plan', afterHours: 1 });
  t.api.db.prepare('UPDATE msg_escalations SET escalate_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), f2.json.data.id);
  comm.escalations.cycle(1);
  assert.deepEqual(memberNames(t.api, d), ['se1', 'se2']);
});

test('FR-04 announcements: audience, scope, publish now or later, read tracking, confirmation and quiz, expiry', async () => {
  const t = await setup();
  const p = t.project('DELTA');
  t.assign('se1', 'SE', p); t.assign('se2', 'SE', p);
  const body = (over = {}) => ({ title: 'Monsoon safety briefing', body: 'Work at height stops when wind passes 40 km/h.', audience: { projectIds: [p] }, requireConfirmation: true, quiz: [{ q: 'At what wind speed does work at height stop?', options: ['20 km/h', '40 km/h', '60 km/h'], correct: 1 }], ...over });
  assert.equal((await t.call(se, 'POST', '/announcements', body())).status, 403, 'a site engineer may not announce');
  assert.equal((await t.call(pm, 'POST', '/announcements', body({ audience: { all: true } }))).status, 201, 'a draft for everyone can be written ...');
  const size = await t.call(pm, 'POST', '/announcements/audience', { audience: { projectIds: [p] } });
  assert.equal(size.json.data.recipients, 2);
  assert.equal((await t.call(pm, 'POST', '/announcements', { ...body(), quiz: [{ q: 'Which?', options: ['a', 'b'], correct: 5 }] })).status, 400, 'the right answer must be an option');
  const a = (await t.call(pm, 'POST', '/announcements', body())).json.data;
  assert.equal(a.status, 'DRAFT');
  assert.equal((await t.call(pd, 'PUT', `/announcements/${a.id}`, { ...body(), version: a.version })).status, 404, 'only the author edits');
  const edited = (await t.call(pm, 'PUT', `/announcements/${a.id}`, { ...body({ title: 'Monsoon safety briefing (rev 2)' }), version: a.version })).json.data;
  assert.equal((await t.call(pm, 'PUT', `/announcements/${a.id}`, { ...body(), version: a.version })).status, 409, 'a stale version');
  // all-company needs company rights: a project scoped publish only to its own project
  assert.equal((await t.call(pm, 'POST', `/announcements/${a.id}/publish`)).status, 200);
  const sent = (await t.call(pm, 'GET', `/announcements/${a.id}`)).json.data;
  assert.deepEqual([sent.status, sent.stats.recipients, sent.stats.read], ['PUBLISHED', 2, 0]);
  assert.equal(sent.title, edited.title);
  assert.ok(sent.quiz[0].correct !== undefined, 'the author sees the right answer');
  assert.equal((await t.call(pm, 'POST', `/announcements/${a.id}/publish`)).status, 409);
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'msg.announcement'").get().n, 2, 'both recipients are notified');
  // the recipient: sees it, reading is recorded, the quiz hides the answers, a wrong answer does not confirm
  const inbox = (await t.call(se, 'GET', '/announcements')).json.data;
  assert.equal(inbox.rows.length, 1);
  assert.equal(inbox.unread, 1);
  const seen = (await t.call(se, 'GET', `/announcements/${a.id}`)).json.data;
  assert.equal(seen.quiz[0].correct, undefined, 'a recipient never gets the answers');
  assert.equal((await t.call(se, 'POST', `/announcements/${a.id}/read`)).json.data.mine.readAt !== null, true);
  assert.equal((await t.call(as('SE', 'se9'), 'GET', `/announcements/${a.id}`)).status, 404, 'not addressed to them');
  assert.equal((await t.call(se, 'POST', `/announcements/${a.id}/confirm`, { answers: [] })).status, 422);
  const wrong = (await t.call(se, 'POST', `/announcements/${a.id}/confirm`, { answers: [0] })).json.data;
  assert.deepEqual([wrong.passed, wrong.score, wrong.of], [false, 0, 1]);
  const right = (await t.call(se, 'POST', `/announcements/${a.id}/confirm`, { answers: [1] })).json.data;
  assert.equal(right.passed, true);
  assert.equal(right.mine.attempts, 2);
  const stat = (await t.call(pm, 'GET', `/announcements/${a.id}`)).json.data;
  assert.deepEqual([stat.stats.read, stat.stats.confirmed, stat.stats.confirmedPercent], [1, 1, 50]);
  assert.deepEqual(stat.recipients.map((r) => [r.username, Boolean(r.confirmedAt)]).sort(), [['se1', true], ['se2', false]]);
  assert.equal((await t.call(aud, 'GET', '/announcements?view=all')).json.data.rows.length, 2, 'the published one and the draft for everyone');
  assert.equal((await t.call(pd, 'GET', '/announcements?view=all')).status, 200);
  assert.equal((await t.call(se, 'GET', '/announcements?view=all')).status, 403);
  // an audience nobody matches, a scheduled one, expiry
  assert.equal((await t.call(pm, 'POST', `/announcements/${(await t.call(pm, 'POST', '/announcements', body({ audience: { roles: ['PCMGR'], projectIds: [p] } }))).json.data.id}/publish`)).status, 422);
  const later = (await t.call(pm, 'POST', '/announcements', body({ title: 'Tomorrow', quiz: [], requireConfirmation: false, publishAt: new Date(Date.now() + 86_400_000).toISOString() }))).json.data;
  assert.equal((await t.call(pm, 'POST', `/announcements/${later.id}/publish`)).json.data.status, 'SCHEDULED');
  const { createCommService } = await import('../src/server/modules/msg/comcenter.js');
  const comm = createCommService({ db: t.api.db, base: messagesOf(t.api.db) });
  assert.equal(comm.announcements.cycle(1).published, 0);
  t.api.db.prepare('UPDATE msg_announcements SET publish_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), later.id);
  assert.equal(comm.announcements.cycle(1).published, 1);
  t.api.db.prepare('UPDATE msg_announcements SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), a.id);
  assert.equal(comm.announcements.cycle(1).expired, 1);
  assert.equal((await t.call(as('SE', 'se2'), 'POST', `/announcements/${a.id}/confirm`, { answers: [1] })).status, 409, 'no confirmation after expiry');
  assert.equal((await t.call(pm, 'POST', `/announcements/${later.id}/cancel`, { reason: 'No longer needed' })).json.data.status, 'CANCELLED');
});

test('T-03 FR-05 BR-02 message to action: a task is made from a message with its attachments and linked back; other kinds are listed as not live and refuse', async () => {
  const t = await setup();
  const p = t.project('ECHO');
  const g = await t.group(pm, 'Pier crew', ['se1', 'se2']);
  t.api.db.prepare('UPDATE msg_conversations SET project_id = ? WHERE id = ?').run(p, g);
  // a clean file the sender attached to the conversation
  const fileId = Number(t.api.db.prepare("INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, linked_entity, linked_id, created_by, source_type) VALUES (1, 'c1/test/pier-photo', 'pier-photo.jpg', 'jpg', 'image/jpeg', 'image', 5, 'abc', 'CLEAN', 'msg_conversation', ?, 'pm1', 'test')").run(g).lastInsertRowid);
  const sent = await t.call(pm, 'POST', `/conversations/${g}/messages`, { body: 'The pier cap has a crack, please inspect and report by Friday', attachments: [fileId] });
  assert.equal(sent.status, 201, JSON.stringify(sent.json));
  const mid = sent.json.data.id;
  const types = (await t.call(se, 'GET', '/action-types')).json.data.rows;
  assert.deepEqual(types.filter((x) => x.available).map((x) => x.type), ['TASK']);
  assert.deepEqual(types.find((x) => x.type === 'NCR'), { type: 'NCR', label: 'Non-conformance report', part: '18.04', available: false, allowed: false });
  const draft = (await t.call(se, 'GET', `/messages/${mid}/action-draft?type=TASK`)).json.data;
  assert.match(draft.title, /pier cap has a crack/);
  assert.equal(draft.projectId, p);
  assert.deepEqual(draft.attachments.map((f) => f.name), ['pier-photo.jpg']);
  assert.equal((await t.call(as('SE', 'se9'), 'GET', `/messages/${mid}/action-draft?type=TASK`)).status, 404, 'not a member');
  // not live: nothing is created
  const ncr = await t.call(se, 'POST', `/messages/${mid}/to-action`, { type: 'NCR' });
  assert.equal(ncr.status, 409);
  assert.match(ncr.json.error.message, /18\.04/);
  // BR-02: giving a task to someone else needs the task right
  assert.equal((await t.call(se, 'POST', `/messages/${mid}/to-action`, { type: 'TASK', assignees: ['se2'] })).status, 403);
  // the task: for the author themselves, linked back, attachments copied as files of the task
  const { filesOf } = await import('../src/server/platform/files/registry.js');
  const copies = [];
  const real = filesOf(t.api.db);
  if (real) { const orig = real.copyTo; real.copyTo = async (actor, o) => { copies.push(o); return orig.call(real, actor, o).catch(() => ({ id: 0 })); }; }
  const made = await t.call(pm, 'POST', `/messages/${mid}/to-action`, { type: 'TASK', assignees: ['se1'], dueDate: '2026-11-20', priority: 'HIGH' });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const task = made.json.data;
  assert.equal(task.entity, 'tsk_task');
  const row = t.api.db.prepare('SELECT * FROM tsk_tasks WHERE id = ?').get(task.id);
  assert.deepEqual([row.priority, row.due_date, row.project_id, row.source_type, row.source_id], ['HIGH', '2026-11-20', p, 'msg_message', String(mid)]);
  assert.match(row.description, /pier cap has a crack/);
  assert.equal(t.api.db.prepare('SELECT user_ref FROM tsk_assignees WHERE task_id = ? AND role = \'ASSIGNEE\'').get(task.id).user_ref, 'se1');
  if (real) assert.deepEqual(copies.map((c) => [c.fileId, c.entity, c.entityId]), [[fileId, 'tsk_task', task.id]]);
  // the message shows what it became; the conversation says so; the trace link is written by the event
  const shown = (await t.call(se, 'GET', `/conversations/${g}/messages`)).json.data.rows.find((r) => r.id === mid);
  assert.deepEqual(shown.actions.map((a) => [a.type, a.entity, Number(a.id)]), [['TASK', 'tsk_task', task.id]]);
  assert.ok(t.api.db.prepare("SELECT 1 FROM msg_messages WHERE conversation_id = ? AND kind = 'SYSTEM' AND body LIKE '%made task%'").get(g));
  for (let i = 0; i < 6; i += 1) t.runtime.bus.drain();
  const traced = t.api.db.prepare("SELECT * FROM col_trace_links WHERE from_entity = 'msg_message' AND from_id = ? AND to_entity = 'tsk_task'").get(String(mid));
  assert.ok(traced, 'linked back in the trace');
  // a retry with the same key makes nothing twice
  const k = key('same');
  const one = await t.api.call('POST', `${M}/messages/${mid}/to-action`, { ...pm, headers: k, body: { type: 'TASK' } });
  const two = await t.api.call('POST', `${M}/messages/${mid}/to-action`, { ...pm, headers: k, body: { type: 'TASK' } });
  assert.equal(one.json.data.id, two.json.data.id);
  // a secure conversation's message is not readable here
  assert.equal((await t.call(pm, 'GET', `/messages/${mid}/action-draft?type=RFI`)).json.data.available, false);
});

test('FR-02 the Communication Center summary: tiles, pending items, exceptions, and the views of the list', async () => {
  const t = await setup();
  const p = t.project('FOXTROT');
  t.assign('se1', 'SE', p);
  autoGroupsOf(t.api.db).sync(1);
  const g = await t.group(pm, 'Pier crew', ['se1', 'se2']);
  const m = await t.say(pm, g, 'Report by 6');
  const i = (await t.call(pm, 'POST', `/messages/${m.id}/instruction`, { priority: 'HIGH', dueAt: new Date(Date.now() + 86_400_000).toISOString() })).json.data;
  const sum = (await t.call(se, 'GET', '/center/summary')).json.data;
  assert.equal(sum.tiles.pendingAcknowledgements.pending, 1);
  assert.equal(sum.tiles.importantInstructions.open, 1);
  assert.ok(sum.tiles.projects.total >= 1);
  assert.equal(sum.tiles.unread.total >= 1, true);
  assert.equal(sum.pending[0].id, i.id);
  assert.deepEqual([sum.can.instruct, sum.can.announce, sum.can.seeAll], [false, false, false]);
  const boss = (await t.call(pm, 'GET', '/center/summary')).json.data;
  assert.deepEqual([boss.can.instruct, boss.can.announce], [true, true]);
  assert.equal(boss.tiles.importantInstructions.sentOpen, 1);
  assert.equal((await t.call(se, 'GET', '/conversations?view=important')).json.data.rows.map((c) => c.id).join(), String(g));
  assert.equal((await t.call(pm, 'GET', '/conversations?view=important')).json.data.rows.length, 0, 'the sender has nothing to acknowledge');
  assert.equal((await t.call(se, 'GET', '/conversations?view=PROJECT')).json.data.rows.length, 1);
  // the flag is per company
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.msg.p0504'").run();
  assert.equal((await t.call(se, 'GET', '/center/summary')).status, 404);
});
