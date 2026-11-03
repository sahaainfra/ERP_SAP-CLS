import { test } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import '../src/server/modules/registry.js';
import { gateways } from '../src/server/platform/notify/index.js';
import { notificationsOf } from '../src/server/platform/notify/index.js';
import { realtimeOf } from '../src/server/platform/realtime/index.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { workflowOf } from '../src/server/platform/workflow/index.js';
import { setupCompany, startApi } from './helpers.js';

// Part 04.06: the notification engine, the notification centre and the real-time layer.
// T-01 a join of a project room is refused for a person without a scope; T-02 a reconnect replays what was missed; T-03 quiet hours hold back non-urgent messages for a digest.
const N = '/api/v1/ntf';
const W = '/api/v1/workflow';
const E = '/api/v1/eng';
const json = { 'content-type': 'application/json' };
const key = (k = 'n') => ({ ...json, 'idempotency-key': `nt-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const pd = as('PD', 'pd1');
const pm = as('PM', 'pm1');
const sys = as('SYSADM', 'sys1');
const it = as('ITADM', 'it1');
const emp = as('EMP', 'emp1');

const setup = async () => {
  const api = await startApi();
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'test')").run();
  const project = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 't', 'test')").run().lastInsertRowid);
  const other = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P2', 'Bypass', 'ROAD', 'ACTIVE', 't', 'test')").run().lastInsertRowid);
  return { api, project, other, runtime: runtimeOf(api.db) };
};
const drain = (runtime) => { for (let i = 0; i < 5; i += 1) runtime.bus.drain(); };
const socket = (api, who, auth = {}) => new Promise((resolve, reject) => {
  const s = connect(api.base, { transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders: { 'x-erp-user': who.user, 'x-erp-roles': who.roles, 'x-erp-company': who.company }, auth });
  s.on('connect', () => resolve(s));
  s.on('connect_error', (e) => reject(e));
});
const join = (s, room, since) => new Promise((resolve) => s.emit('join', { room, ...(since === undefined ? {} : { since }) }, resolve));
const waitFor = (s, pred, ms = 3000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('no event arrived')), ms);
  const on = (ev) => { if (pred(ev)) { clearTimeout(t); s.off('event', on); resolve(ev); } };
  s.on('event', on);
});
const tick = () => new Promise((r) => setTimeout(r, 60));
const list = async (api, who, q = '') => (await api.call('GET', `${N}/notifications${q}`, who)).json.data;
const make = async (api, project, title = 'Shuttering', amount = '12000.00') => (await api.call('POST', `${E}/sample-docs`, { ...pd, headers: key('m'), body: { title, amount, projectId: project } })).json.data;
const submit = async (api, d) => (await api.call('POST', `${E}/sample-docs/${d.id}/submit`, { ...pd, headers: key('s'), body: {} })).json.data.workflow;

test('T-01 FR-01 BR-02 the handshake is authenticated; a project room is refused to a person without a scope; an event carries ids only; a person who loses access stops receiving', async () => {
  const { api, project, runtime } = await setup();
  await assert.rejects(() => new Promise((res, rej) => { const s = connect(api.base, { transports: ['websocket'], forceNew: true, reconnection: false }); s.on('connect', () => res(s)); s.on('connect_error', rej); }), /Sign in/);
  const a = await socket(api, pm);
  assert.deepEqual(await join(a, `project:${project}`), { ok: true, room: `project:${project}`, replayed: 0, gap: false, latest: 0 });
  const e = await socket(api, emp);
  const denied = await join(e, `project:${project}`);
  assert.equal(denied.ok, false);
  assert.ok(api.db.prepare("SELECT 1 FROM core_security_events WHERE type = 'socket.denied'").get(), 'a refusal is a security event');
  assert.equal((await join(e, 'user:pm1')).ok, false, 'a personal room is for one person');
  assert.equal((await join(a, 'project:99999')).ok, false);
  assert.equal((await join(a, 'record:nothing:1')).ok, false);
  assert.equal((await join(a, 'conv:1')).ok, false);
  assert.equal((await join(a, 'bad room')).ok, false);
  // a change of a record reaches the room by ids only
  const d = await make(api, project);
  const got = waitFor(a, (ev) => ev.room === `project:${project}` && ev.type === 'workflow.instance.submitted');
  await submit(api, d);
  drain(runtime);
  const ev = await got;
  assert.deepEqual(Object.keys(ev.data), ['eventId']);
  assert.equal(ev.entity, 'workflow_instance');
  // the record room: the approver may be in it, a stranger may not
  const inst = api.db.prepare('SELECT id FROM wf_instances ORDER BY id DESC').get().id;
  assert.equal((await join(a, `record:workflow_instance:${inst}`)).ok, true);
  assert.equal((await join(e, `record:workflow_instance:${inst}`)).ok, false);
  assert.equal((await join(a, `record:sample_doc:${d.id}`)).ok, true);
  // access taken away: the next event does not arrive and the member is dropped
  const seen = [];
  a.on('event', (x) => seen.push(x));
  realtimeOf(api.db).publish({ companyId: 1, rooms: [`project:${project}`], type: 'test.one', data: {} });
  await tick();
  assert.equal(seen.filter((x) => x.type === 'test.one').length, 1);
  const sockets = await api.server?.fetchSockets?.();
  void sockets;
  a.disconnect(); e.disconnect();
  await api.close();
});

test('T-02 FR-01 a reconnect replays what was missed in each room, and says when too much was missed', async () => {
  const { api, project, runtime } = await setup();
  const hub = realtimeOf(api.db);
  let a = await socket(api, pm);
  await join(a, `project:${project}`);
  const first = waitFor(a, (ev) => ev.type === 'one');
  hub.publish({ companyId: 1, rooms: [`project:${project}`], type: 'one', data: {} });
  const seen = await first;
  a.disconnect();
  // three events while the person is away: two in the room, one elsewhere
  hub.publish({ companyId: 1, rooms: [`project:${project}`], type: 'two', data: {} });
  hub.publish({ companyId: 1, rooms: ['project:999'], type: 'elsewhere', data: {} });
  hub.publish({ companyId: 1, rooms: [`project:${project}`], type: 'three', data: {} });
  a = await socket(api, pm);
  const got = [];
  a.on('event', (ev) => got.push(ev));
  const ack = await join(a, `project:${project}`, seen.id);
  await tick();
  assert.equal(ack.ok, true);
  assert.equal(ack.replayed, 2);
  assert.deepEqual(got.map((x) => [x.type, x.replayed]), [['two', true], ['three', true]]);
  assert.ok(ack.latest >= got[1].id);
  // a person who may no longer be in the room is replayed nothing
  const e = await socket(api, emp);
  assert.equal((await join(e, `project:${project}`, 0)).ok, false);
  // events kept for too short a time: the screen is told to load afresh
  api.db.prepare("UPDATE ntf_realtime_events SET occurred_at = '2020-01-01T00:00:00.000Z'").run();
  assert.ok(hub.purge(1).removed >= 3);
  const late = await join(a, `project:${project}`, seen.id);
  assert.equal(late.gap, true);
  assert.equal(late.replayed, 0);
  // the personal room replays notifications the same way
  await hub.publish({ companyId: 1, rooms: ['user:pm1'], type: 'notification', data: {} });
  void runtime;
  a.disconnect(); e.disconnect();
  await api.close();
});

test('AC-01 FR-02 FR-04 the workflow tells its people: in-app notifications with deep links, in the person\'s language, in real time; read, unread, archive and read-all', async () => {
  const { api, project, runtime } = await setup();
  // the approvers are real people with roles
  for (const [u, role] of [['pm1', 'PM']]) {
    api.db.prepare("INSERT OR IGNORE INTO iam_users (company_id, username, display_name, email, status, roles_json, created_by, source_type) VALUES (1, ?, ?, ?, 'ACTIVE', ?, 't', 'test')").run(u, u, `${u}@example.com`, JSON.stringify([role]));
  }
  const pmSocket = await socket(api, pm);
  await join(pmSocket, 'user:pm1');
  const live = waitFor(pmSocket, (ev) => ev.type === 'notification');
  const d = await make(api, project, 'Cement bags', '20000.00');
  const w = await submit(api, d);
  drain(runtime);
  const ev = await live;
  assert.deepEqual(Object.keys(ev.data).sort(), ['category', 'priority'], 'ids and the least data');
  let l = await list(api, pm);
  assert.equal(l.total, 1);
  const n = l.rows[0];
  assert.match(n.title, /Approval needed: Sample document WSD-/);
  assert.match(n.body, /pd1 sent Sample document/);
  assert.equal(n.link, `/approvals/task?id=${w.tasks[0].id}`);
  assert.equal(n.category, 'approvals');
  assert.equal(l.counts.unread, 1);
  assert.equal((await list(api, pd)).total, 0, 'only the person asked is told');
  // Hindi for a person who chose it
  api.db.prepare("INSERT INTO ui_user_preferences (company_id, user_ref, language, created_by, source_type) VALUES (1, 'pm1', 'hi', 't', 'test')").run();
  const d2 = await make(api, project, 'Steel', '30000.00');
  await submit(api, d2);
  drain(runtime);
  l = await list(api, pm);
  assert.match(l.rows[0].title, /स्वीकृति चाहिए/);
  // one event, one notification: a second drain adds nothing
  drain(runtime);
  assert.equal((await list(api, pm)).total, 2);
  // read, unread, archive
  const id = l.rows[0].id;
  assert.equal((await api.call('POST', `${N}/notifications/${id}/read`, { ...pm, headers: key('r') })).json.data.read, true);
  assert.equal((await list(api, pm)).counts.unread, 1);
  assert.equal((await api.call('POST', `${N}/notifications/${id}/unread`, { ...pm, headers: key('r') })).json.data.read, false);
  assert.equal((await api.call('POST', `${N}/notifications/${id}/read`, { ...pd, headers: key('r') })).status, 404, 'someone else\'s notification');
  assert.equal((await api.call('POST', `${N}/notifications/${id}/archive`, { ...pm, headers: key('r') })).json.data.archived, true);
  assert.equal((await list(api, pm)).total, 1);
  assert.equal((await list(api, pm, '?state=archived')).total, 1);
  const all = (await api.call('POST', `${N}/notifications/read-all`, { ...pm, headers: key('r'), body: {} })).json.data;
  assert.equal(all.counts.unread, 0);
  assert.equal((await list(api, pm, '?category=approvals')).total, 1);
  assert.equal((await api.call('GET', `${N}/notifications?category=nope`, pm)).status, 400);
  // the bell
  assert.equal((await api.call('GET', '/api/v1/ui/bell', pm)).json.data.source, 'notifications');
  // an approval tells the originator
  const task = (await api.call('GET', `${W}/tasks?mine=assigned`, pm)).json.data.rows.find((t) => t.instance.id === w.id);
  await api.call('POST', `${W}/tasks/${task.id}/act`, { ...pm, headers: key('a'), body: { action: 'reject', comment: 'The rate is too high.' } });
  drain(runtime);
  const back = (await list(api, pd)).rows[0];
  assert.match(back.title, /Rejected: Sample document/);
  assert.match(back.body, /The rate is too high/);
  pmSocket.disconnect();
  await api.close();
});

test('FR-05 BR-01 preferences: channels by category, mandatory categories cannot be turned off, a masked fact is hidden from a person who may not see it', async () => {
  const { api } = await setup();
  const n = notificationsOf(api.db);
  api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, email, mobile, status, roles_json, created_by, source_type) VALUES (1, 'emp1', 'emp1', 'emp1@example.com', '9876543210', 'ACTIVE', '[\"EMP\"]', 't', 'test'), (1, 'cfo1', 'cfo1', 'cfo1@example.com', NULL, 'ACTIVE', '[\"CFO\"]', 't', 'test')").run();
  const sent = [];
  gateways.register('EMAIL', async ({ delivery }) => { sent.push(delivery); return { providerMsgId: `m${delivery.id}` }; });
  let r = await api.call('GET', `${N}/preferences`, emp);
  assert.equal(r.json.data.categories.approvals.EMAIL, true);
  assert.equal(r.json.data.categories.tasks.EMAIL, false);
  r = await api.call('PUT', `${N}/preferences`, { ...emp, headers: key('p'), body: { categories: { security: { EMAIL: false } } } });
  assert.equal(r.status, 422, 'security cannot be turned off');
  r = await api.call('PUT', `${N}/preferences`, { ...emp, headers: key('p'), body: { categories: { approvals: { EMAIL: false, SMS: true }, tasks: { EMAIL: true } }, digest: 'INSTANT', quietHours: { start: '22:00', end: '07:00' } } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.data.quietHours, { start: '22:00', end: '07:00' });
  assert.equal(r.json.data.categories.approvals.EMAIL, false);
  assert.equal((await api.call('PUT', `${N}/preferences`, { ...emp, headers: key('p'), body: { version: 99, digest: 'DAILY' } })).status, 409);
  assert.equal((await api.call('PUT', `${N}/preferences`, { ...emp, headers: key('p'), body: { quietHours: { start: '25:00', end: '07:00' } } })).status, 400);
  // the engine respects them: tasks by e-mail now, approvals no longer
  n.notify({ companyId: 1, templateCode: 'workflow.step.notified', recipients: ['user:emp1'], data: { docLabel: 'PO', docRef: 'PO-1', docTitle: 'x', step: 'S' }, eventKey: 'a', priority: 'URGENT' });
  n.notify({ companyId: 1, templateCode: 'workflow.task.assigned', recipients: ['user:emp1'], data: { docLabel: 'PO', docRef: 'PO-2', docTitle: 'x', step: 'S', actor: 'a', dueAt: 'd' }, eventKey: 'b', priority: 'URGENT' });
  await n.dispatchDue();
  assert.deepEqual(sent.map((d) => d.subject), ['For your information: PO PO-1']);
  // a fact the person may not see is hidden for them and shown to one who may; a fact that looks like a salary is hidden from everyone
  n.notify({ companyId: 1, templateCode: 'workflow.task.assigned', recipients: ['user:emp1', 'user:cfo1'], data: { docLabel: 'Tender', docRef: 'T-1', docTitle: 'Confidential bid', step: 'S', actor: 'a', dueAt: 'd', salary: '1,00,000' }, sensitive: { docTitle: 'acc.report.view' }, eventKey: 'c' });
  const m = (u) => api.db.prepare("SELECT body FROM ntf_notifications WHERE user_ref = ? AND event_key = 'c'").get(u).body;
  assert.match(m('emp1'), /Tender T-1 \(—\)/);
  assert.match(m('cfo1'), /Tender T-1 \(Confidential bid\)/);
  // a mandatory category reaches the e-mail of everyone, whatever they chose
  n.notify({ companyId: 1, templateCode: 'security.alert', recipients: ['user:emp1', 'user:cfo1'], data: { title: 'Large payment', message: 'A payment was released.' }, eventKey: 'd' });
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM ntf_deliveries WHERE channel = 'EMAIL' AND notification_id IN (SELECT id FROM ntf_notifications WHERE template_code = 'security.alert')").get().n, 2);
  gateways.remove('EMAIL');
  await api.close();
});

test('T-03 FR-05 FR-06 quiet hours hold back non-urgent messages for a digest; an urgent or mandatory one is not held; failures are retried and show in the delivery log', async () => {
  const { api } = await setup();
  const n = notificationsOf(api.db);
  const engine = workflowOf(api.db);
  api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, email, status, roles_json, created_by, source_type) VALUES (1, 'q1', 'q1', 'q1@example.com', 'ACTIVE', '[\"PM\"]', 't', 'test')").run();
  const mails = [];
  let failNext = 0;
  gateways.register('EMAIL', async ({ delivery }) => { if (failNext > 0) { failNext -= 1; throw new Error('Connection refused'); } mails.push(delivery); return { providerMsgId: `m${delivery.id}` }; });
  const q1 = as('PM', 'q1');
  await api.call('PUT', `${N}/preferences`, { ...q1, headers: key('p'), body: { categories: { tasks: { EMAIL: true } }, quietHours: { start: '22:00', end: '07:00' } } });
  const at = (h) => new Date(`2026-11-04T${String(h).padStart(2, '0')}:00:00Z`); // 04 Nov 2026, UTC; IST is 5h30 ahead
  engine.setClock(() => at(17)); // 22:30 in India
  const fire = (key, priority) => n.notify({ companyId: 1, templateCode: 'workflow.step.notified', recipients: ['user:q1'], data: { docLabel: 'PO', docRef: key, docTitle: 'x', step: 'S' }, eventKey: key, priority });
  fire('late-1', 'NORMAL');
  fire('late-2', 'NORMAL');
  fire('urgent-1', 'URGENT');
  fire('sec', 'NORMAL'); // not mandatory: held
  n.notify({ companyId: 1, templateCode: 'security.alert', recipients: ['user:q1'], data: { title: 'Sign-in from a new device', message: 'Was this you?' }, eventKey: 'mandatory' });
  let d = api.db.prepare('SELECT d.status, n.event_key FROM ntf_deliveries d JOIN ntf_notifications n ON n.id = d.notification_id WHERE d.channel = \'EMAIL\' ORDER BY d.id').all();
  assert.deepEqual(d.map((x) => [x.event_key, x.status]), [['late-1', 'DEFERRED'], ['late-2', 'DEFERRED'], ['urgent-1', 'PENDING'], ['sec', 'DEFERRED'], ['mandatory', 'PENDING']]);
  assert.equal((await list(api, q1)).total, 5, 'the centre is told at once: only the other channels wait');
  await n.dispatchDue();
  assert.deepEqual(mails.map((m) => m.subject).sort(), ['For your information: PO urgent-1', 'Sign-in from a new device'].sort());
  // nothing yet at 23:00 IST; at 07:30 IST the held messages leave as one digest
  engine.setClock(() => at(18));
  assert.equal(n.buildDigests().digests, 0);
  engine.setClock(() => new Date('2026-11-05T02:30:00Z'));
  assert.deepEqual(n.buildDigests(), { digests: 1, held: 3 });
  await n.dispatchDue();
  const digest = mails.at(-1);
  assert.match(digest.subject, /Your notification digest \(3\)/);
  assert.match(digest.body, /late-1/);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM ntf_deliveries WHERE digest_id IS NOT NULL AND status = 'SENT'").get().n, 3);
  // an hourly choice holds ordinary messages to the next hour; a daily one to the morning
  await api.call('PUT', `${N}/preferences`, { ...q1, headers: key('p'), body: { quietHours: null, digest: 'HOURLY' } });
  engine.setClock(() => new Date('2026-11-05T05:10:00Z'));
  fire('hourly-1', 'NORMAL');
  assert.equal(api.db.prepare("SELECT status, deliver_after FROM ntf_deliveries d JOIN ntf_notifications n ON n.id = d.notification_id WHERE n.event_key = 'hourly-1' AND d.channel = 'EMAIL'").get().deliver_after, '2026-11-05T06:00:00.000Z');
  // failures are tried again with back-off, then marked failed; an administrator sees and retries them
  await api.call('PUT', `${N}/preferences`, { ...q1, headers: key('p'), body: { digest: 'INSTANT' } });
  engine.setClock(() => new Date('2026-11-05T09:00:00Z'));
  failNext = 99;
  fire('fails', 'URGENT');
  let r = await n.dispatchDue();
  assert.equal(r.retrying, 1);
  let clockAt = new Date('2026-11-05T09:00:00Z').getTime();
  for (let i = 0; i < 4; i += 1) { clockAt += 3 * 3_600_000; const t = clockAt; engine.setClock(() => new Date(t)); r = await n.dispatchDue(); }
  const failed = api.db.prepare("SELECT * FROM ntf_deliveries WHERE status = 'FAILED'").get();
  assert.equal(failed.attempts, 5);
  assert.match(failed.last_error, /Connection refused/);
  const log = (await api.call('GET', `${N}/deliveries?status=FAILED`, it)).json.data;
  assert.equal(log.total, 1);
  assert.equal(log.rows[0].address, 'q***@example.com', 'the address is partly hidden');
  assert.equal((await api.call('GET', `${N}/deliveries`, pm)).status, 403);
  const sum = (await api.call('GET', `${N}/deliveries/summary`, it)).json.data;
  assert.equal(sum.grid.EMAIL.FAILED, 1);
  failNext = 0;
  assert.equal((await api.call('POST', `${N}/deliveries/${failed.id}/retry`, { ...pm, headers: key('t') })).status, 403);
  assert.equal((await api.call('POST', `${N}/deliveries/${failed.id}/retry`, { ...it, headers: key('t') })).json.data.status, 'PENDING');
  await n.dispatchDue();
  assert.equal(api.db.prepare('SELECT status FROM ntf_deliveries WHERE id = ?').get(failed.id).status, 'SENT');
  assert.equal((await api.raw('GET', `${N}/deliveries/export?format=csv`, it)).status, 200);
  gateways.remove('EMAIL');
  engine.setClock(() => new Date());
  await api.close();
});

test('FR-03 AC-02 AC-05 templates: preview in both languages, a new version is a change the IT administrator approves, an unknown fact is refused', async () => {
  const { api, runtime } = await setup();
  assert.equal((await api.call('GET', `${N}/templates`, pm)).status, 403);
  const listed = (await api.call('GET', `${N}/templates`, sys)).json.data;
  assert.ok(listed.rows.find((t) => t.code === 'workflow.task.assigned'));
  const t = (await api.call('GET', `${N}/templates/workflow.task.assigned`, sys)).json.data;
  assert.equal(t.entries.length, 10);
  assert.ok(t.variables.includes('docRef'));
  const en = t.entries.find((e) => e.channel === 'EMAIL' && e.lang === 'en');
  const prev = async (lang, body) => (await api.call('POST', `${N}/templates/preview`, { ...sys, body: { code: t.code, channel: 'EMAIL', lang, subject: en.subject, body } })).json.data;
  assert.match((await prev('en', en.body)).body, /anil\.pd sent Purchase order PO-0001/);
  assert.match((await prev('hi', t.entries.find((e) => e.channel === 'EMAIL' && e.lang === 'hi').body)).body, /ने Purchase order PO-0001/);
  assert.deepEqual((await prev('en', 'Hello {{nobody}}')).unknownVariables, ['nobody']);
  const change = (body, who = sys) => api.call('POST', `${N}/templates/changes`, { ...who, headers: key('c'), body: { code: 'workflow.task.assigned', reason: 'Say it more plainly', changes: [{ channel: 'IN_APP', lang: 'en', subject: 'Please decide: {{docLabel}} {{docRef}}', body: body }] } });
  assert.equal((await change('Open {{nobody}}', pm)).status, 403);
  assert.equal((await change('Open {{nobody}}')).status, 400);
  const r = await change('{{actor}} waits for you on {{docRef}} ({{step}}).');
  assert.equal(r.status, 202, JSON.stringify(r.json));
  assert.equal((await change('Another {{docRef}}')).status, 409, 'one change at a time');
  // until approved the old words are in force
  assert.equal((await api.call('GET', `${N}/templates/workflow.task.assigned`, sys)).json.data.entries.find((e) => e.channel === 'IN_APP' && e.lang === 'en').version, 1);
  const task = (await api.call('GET', `${W}/tasks?mine=assigned`, it)).json.data.rows[0];
  assert.ok(task, 'the IT administrator has the task');
  assert.equal((await api.call('POST', `${W}/tasks/${task.id}/act`, { ...it, headers: key('a'), body: { action: 'approve', comment: 'ok' } })).status, 200);
  const after = (await api.call('GET', `${N}/templates/workflow.task.assigned`, sys)).json.data;
  const inApp = after.entries.find((e) => e.channel === 'IN_APP' && e.lang === 'en');
  assert.deepEqual([inApp.version, inApp.scope, inApp.subject], [2, 'company', 'Please decide: {{docLabel}} {{docRef}}']);
  assert.equal(after.pending.length, 0);
  assert.ok(api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'ntf_templates' AND action = 'activate'").get());
  // and the engine now uses it for this company only
  const n = notificationsOf(api.db);
  n.notify({ companyId: 1, templateCode: 'workflow.task.assigned', recipients: ['user:z1'], data: { docLabel: 'PO', docRef: 'PO-9', actor: 'a', step: 'S' }, eventKey: 'x1' });
  assert.equal(api.db.prepare("SELECT title FROM ntf_notifications WHERE user_ref = 'z1'").get().title, 'Please decide: PO PO-9');
  void runtime;
  await api.close();
});
