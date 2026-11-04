import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { realtimeOf } from '../src/server/platform/realtime/index.js';
import { setupCompany, startApi } from './helpers.js';

// Part 05.01: the unified Messages app.
// T-01 counts and checksums of the earlier stores equal the unified index; T-02 a non-member cannot fetch messages by API or join the real-time room; T-03 a record link card hides its details from a reader without the right.
const M = '/api/v1/msg';
const json = { 'content-type': 'application/json' };
const key = (k = 'm') => ({ ...json, 'idempotency-key': `msg-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const pd = as('PD', 'pd1');
const pm = as('PM', 'pm1');
const se = as('SE', 'se1');
const emp = as('EMP', 'emp1');
const it = as('ITADM', 'it1');
const aud = as('AUD', 'aud1');
const sys = as('SYSADM', 'sys1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const user = (api, name, roles) => api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(name, `${name.toUpperCase()} Kumar`, JSON.stringify(roles), `${name}@example.com`);
const setup = async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'test')").run();
  for (const [n, r] of [['pd1', ['PD']], ['pm1', ['PM']], ['se1', ['SE']], ['emp1', ['EMP']], ['it1', ['ITADM']], ['aud1', ['AUD']], ['sys1', ['SYSADM']]]) user(api, n, r);
  const project = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 't', 'test')").run().lastInsertRowid);
  const call = (who, method, path, body, k) => api.call(method, `${M}${path}`, { ...who, headers: key(k), body });
  const dm = async (a, b) => { const r = await call(a, 'POST', '/conversations', { type: 'DIRECT', members: [b.user] }); assert.ok([200, 201].includes(r.status), JSON.stringify(r.json)); return r.json.data.id; };
  const say = async (who, id, body, extra = {}) => { const r = await call(who, 'POST', `/conversations/${id}/messages`, { body, ...extra }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.data; };
  return { api, project, call, dm, say };
};

test('FR-01 FR-02 a direct conversation is made once whoever starts it, listed for both with the other person\'s name, and refused for oneself or a stranger', async () => {
  const { call, dm } = await setup();
  const a = await dm(pd, pm);
  assert.equal(await dm(pm, pd), a, 'the same conversation from the other side');
  assert.equal((await call(pd, 'POST', '/conversations', { type: 'DIRECT', members: ['pd1'] })).status, 422, 'not with oneself');
  assert.equal((await call(pd, 'POST', '/conversations', { type: 'DIRECT', members: ['nobody'] })).status, 422);
  assert.equal((await call(pd, 'POST', '/conversations', { type: 'DIRECT', members: ['pm1', 'se1'] })).status, 422);
  assert.equal((await call(pd, 'POST', '/conversations', { type: 'GROUP', members: ['pm1'] })).status, 422, 'a group has a name');
  assert.equal((await call(pd, 'POST', '/conversations', { type: 'NONSENSE', members: [] })).status, 400);
  const mine = (await call(pd, 'GET', '/conversations')).json.data;
  const theirs = (await call(pm, 'GET', '/conversations')).json.data;
  assert.deepEqual([mine.rows[0].title, mine.rows[0].type], ['PM1 Kumar', 'DIRECT']);
  assert.equal(theirs.rows[0].title, 'PD1 Kumar');
  assert.equal((await call(se, 'GET', '/conversations')).json.data.rows.length, 0, 'a stranger sees nothing');
});

test('T-02 BR-01 a person who is not a member cannot read, write, react, open the details or join the real-time room; a member who leaves loses it all', async () => {
  const { api, call, dm, say } = await setup();
  const id = await dm(pd, pm);
  const m = await say(pd, id, 'Private words');
  for (const [method, path, body] of [['GET', `/conversations/${id}`], ['GET', `/conversations/${id}/messages`], ['POST', `/conversations/${id}/messages`, { body: 'hi' }], ['POST', `/messages/${m.id}/reactions`, { emoji: '👍' }], ['PATCH', `/messages/${m.id}`, { body: 'x' }], ['DELETE', `/messages/${m.id}`], ['POST', `/conversations/${id}/read`, {}], ['PUT', `/conversations/${id}/settings`, { pinned: true }], ['POST', `/conversations/${id}/members`, { users: ['se1'] }]]) {
    const r = await call(se, method, path, body);
    assert.equal(r.status, 404, `${method} ${path}`);
  }
  const hub = realtimeOf(api.db);
  const actor = (who) => ({ user: who.user, userId: api.db.prepare('SELECT id FROM iam_users WHERE username = ?').get(who.user).id, companyId: 1, roles: [who.roles] });
  assert.equal(hub.canJoin(actor(pd), `conv:${id}`).allowed, true);
  assert.equal(hub.canJoin(actor(pm), `conv:${id}`).allowed, true);
  assert.equal(hub.canJoin(actor(se), `conv:${id}`).allowed, false, 'a non-member cannot join the room');
  assert.equal(hub.mayStay(actor(se), `conv:${id}`), false);
  assert.equal(hub.canJoin(actor(pd), 'conv:99999').allowed, false);
  assert.ok(api.db.prepare("SELECT 1 FROM core_security_events WHERE type = 'socket.denied'").get(), 'the refusal is a security event');
  // the sender's words went to the room as ids only
  const ev = api.db.prepare("SELECT data_json FROM ntf_realtime_events WHERE room = ? AND event_type = 'msg.message.created'").get(`conv:${id}`);
  assert.deepEqual(JSON.parse(ev.data_json), { conversationId: id, messageId: m.id });
  // a group: a member who leaves can no longer read it
  const g = (await call(pd, 'POST', '/conversations', { type: 'GROUP', title: 'Site leads', members: ['pm1', 'se1'] })).json.data.id;
  await say(pd, g, 'Welcome');
  assert.equal((await call(se, 'GET', `/conversations/${g}/messages`)).status, 200);
  assert.equal((await call(se, 'DELETE', `/conversations/${g}/members/se1`)).json.data.left, true);
  assert.equal((await call(se, 'GET', `/conversations/${g}/messages`)).status, 404);
  assert.equal(hub.canJoin(actor(se), `conv:${g}`).allowed, false);
});

test('FR-03 FR-04 messages: replies, idempotent sends, mentions of members only, notifications that honour mute and mention-only, unread counts and reading', async () => {
  const { api, call, say } = await setup();
  const g = (await call(pd, 'POST', '/conversations', { type: 'GROUP', title: 'Bridge team', members: ['pm1', 'se1'] })).json.data.id;
  const first = await say(pd, g, 'Slab pour tomorrow @pm1', { clientId: 'client-id-0001' });
  const again = await call(pd, 'POST', `/conversations/${g}/messages`, { body: 'Slab pour tomorrow @pm1', clientId: 'client-id-0001' });
  assert.equal(again.json.data.id, first.id, 'the same client id is the same message');
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM msg_messages WHERE kind != ?').get('SYSTEM').n, 1);
  assert.deepEqual(first.mentions.map((x) => x.username), ['pm1']);
  const refused = await call(pd, 'POST', `/conversations/${g}/messages`, { body: 'Ask @emp1 about it' });
  assert.equal(refused.status, 422);
  assert.match(refused.json.error.message, /@emp1 is not in this conversation/);
  assert.equal((await call(pd, 'POST', `/conversations/${g}/messages`, { body: '   ' })).status, 422);
  assert.equal((await call(pd, 'POST', `/conversations/${g}/messages`, { body: 'x'.repeat(4001) })).status, 400);
  const reply = await say(pm, g, 'Confirmed', { replyToId: first.id });
  assert.equal(reply.replyTo.id, first.id);
  assert.equal((await call(pm, 'POST', `/conversations/${g}/messages`, { body: 'x', replyToId: 99999 })).status, 404);
  // notifications: pm1 was mentioned, se1 gets the plain one; the sender gets none
  const n = api.db.prepare("SELECT template_code, user_ref FROM ntf_notifications WHERE template_code LIKE 'msg.%' ORDER BY id").all().map((x) => `${x.template_code}:${x.user_ref}`);
  assert.deepEqual(n.slice(0, 2).sort(), ['msg.mention:pm1', 'msg.message:se1']);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE source_id = ? AND user_ref = 'pd1'").get(String(first.id)).n, 0, 'nothing for the sender about their own message');
  // mute and mention-only
  await call(se, 'PUT', `/conversations/${g}/settings`, { mentionOnly: true });
  await call(pm, 'PUT', `/conversations/${g}/settings`, { mutedUntil: new Date(Date.now() + 3_600_000).toISOString() });
  const before = api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code LIKE 'msg.%'").get().n;
  await say(pd, g, 'Plain note for everyone');
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code LIKE 'msg.%'").get().n, before, 'muted and mention-only people are not told');
  await say(pd, g, 'Now @se1 specifically');
  assert.ok(api.db.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'msg.mention' AND user_ref = 'se1' AND body LIKE '%specifically%'").get());
  // unread counts and reading
  const list = (who) => call(who, 'GET', '/conversations').then((r) => r.json.data.rows.find((c) => c.id === g));
  assert.equal((await list(se)).unread, 4);
  assert.equal((await list(pd)).unread, 0, 'writing in a conversation marks it read up to that message');
  assert.equal((await call(se, 'POST', `/conversations/${g}/read`, {})).status, 200);
  assert.equal((await list(se)).unread, 0);
  assert.equal((await call(se, 'GET', '/unread')).json.data.unread, 0);
  const page = (await call(se, 'GET', `/conversations/${g}/messages?limit=2`)).json.data;
  assert.equal(page.rows.length, 2);
  assert.equal(page.hasMore, true);
  const older = (await call(se, 'GET', `/conversations/${g}/messages?before=${page.rows[0].id}&limit=50`)).json.data;
  assert.ok(older.rows.every((r) => r.id < page.rows[0].id));
});

test('BR-02 FR-03 a message can be edited and deleted for everyone inside the edit window; later only an administrator may delete it, with a reason; the audit trail keeps the words; the retention job blanks them', async () => {
  const { api, call, say } = await setup();
  const g = (await call(pd, 'POST', '/conversations', { type: 'GROUP', title: 'Plant', members: ['pm1'] })).json.data.id;
  const mine = await say(pd, g, 'Original text');
  assert.equal((await call(pd, 'PATCH', `/messages/${mine.id}`, { body: 'Corrected text' })).json.data.body, 'Corrected text');
  assert.equal((await call(pd, 'GET', `/conversations/${g}/messages`)).json.data.rows.at(-1).editedAt !== null, true);
  assert.equal((await call(pm, 'PATCH', `/messages/${mine.id}`, { body: 'Hijack' })).status, 403);
  assert.equal((await call(pm, 'DELETE', `/messages/${mine.id}`)).status, 403, 'a member who is not an administrator cannot delete another\'s');
  const del = await call(pd, 'DELETE', `/messages/${mine.id}`);
  assert.equal(del.status, 200);
  const seen = (await call(pm, 'GET', `/conversations/${g}/messages`)).json.data.rows.find((r) => r.id === mine.id);
  assert.deepEqual([seen.deleted, seen.body, seen.canEdit], [true, '', false], 'message deleted for everyone');
  assert.equal((await call(pd, 'PATCH', `/messages/${mine.id}`, { body: 'again' })).status, 422);
  assert.equal((await call(pd, 'DELETE', `/messages/${mine.id}`)).status, 409);
  const trail = api.db.prepare("SELECT old_values FROM core_audit_log WHERE entity = 'msg_messages' AND action = 'delete'").get();
  assert.match(trail.old_values, /Corrected text/);
  // after the window: the sender cannot, an administrator can with a reason
  const late = await say(pm, g, 'A later message');
  api.db.prepare('UPDATE msg_messages SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 20 * 60_000).toISOString(), late.id);
  assert.equal((await call(pm, 'PATCH', `/messages/${late.id}`, { body: 'x' })).status, 422);
  assert.equal((await call(pm, 'DELETE', `/messages/${late.id}`)).status, 422);
  assert.equal((await call(pd, 'DELETE', `/messages/${late.id}`)).status, 422, 'an administrator needs a reason');
  assert.equal((await call(pd, 'DELETE', `/messages/${late.id}`, { reason: 'Contains a supplier rate' })).status, 200);
  // retention: the text of a deleted message is blanked after the period
  api.db.prepare("UPDATE msg_messages SET deleted_at = ? WHERE id IN (?, ?)").run(new Date(Date.now() - 40 * 86_400_000).toISOString(), mine.id, late.id);
  const purge = await api.call('GET', `${M}/verify`, sys);
  assert.equal(purge.status, 200);
  const { messagesOf } = await import('../src/server/modules/msg/messages.js');
  assert.equal(messagesOf(api.db).admin.purge(1).purged, 2);
  assert.equal(api.db.prepare('SELECT body FROM msg_messages WHERE id = ?').get(mine.id).body, '');
  // reactions
  const r = await say(pd, g, 'React to me');
  assert.equal((await call(pm, 'POST', `/messages/${r.id}/reactions`, { emoji: '👍' })).json.data.count, 1);
  assert.equal((await call(pm, 'POST', `/messages/${r.id}/reactions`, { emoji: '🤖' })).status, 400);
  const row = (await call(pd, 'GET', `/conversations/${g}/messages`)).json.data.rows.find((x) => x.id === r.id);
  assert.deepEqual(row.reactions.map((x) => [x.emoji, x.count, x.mine]), [['👍', 1, false]]);
});

test('T-03 FR-05 a record link card shows live status and key fields to a reader who may open the record and "restricted record" to one who may not; a sender cannot link what they cannot open', async () => {
  const { api, call, say, project } = await setup();
  const doc = (await api.call('POST', '/api/v1/eng/sample-docs', { ...pd, headers: key('d'), body: { title: 'Shuttering for the bridge', amount: '12000.00', projectId: project } })).json.data;
  // the record picker: the kinds the person may open, and a search among them
  assert.ok((await call(pd, 'GET', '/record-types')).json.data.rows.some((t) => t.type === 'sample_doc'));
  assert.deepEqual((await call(emp, 'GET', '/record-types')).json.data.rows, []);
  assert.deepEqual((await call(pd, 'GET', '/records?type=sample_doc&q=bridge')).json.data.rows.map((r) => r.id), [String(doc.id)]);
  assert.equal((await call(emp, 'GET', '/records?type=sample_doc&q=bridge')).status, 404);
  assert.equal((await call(pd, 'GET', '/records?type=nothing_here')).status, 404);
  const g = (await call(pd, 'POST', '/conversations', { type: 'GROUP', title: 'Bridge', members: ['pm1', 'emp1'] })).json.data.id;
  assert.equal((await call(emp, 'POST', `/conversations/${g}/messages`, { body: 'look', recordLinks: [{ entity: 'sample_doc', id: String(doc.id) }] })).status, 422, 'emp1 cannot open it, so cannot link it');
  const sent = await say(pd, g, 'Please check', { recordLinks: [{ entity: 'sample_doc', id: String(doc.id) }] });
  assert.equal(sent.links[0].restricted, false);
  const cardFor = async (who) => (await call(who, 'GET', `/conversations/${g}/messages`)).json.data.rows.find((r) => r.id === sent.id).links[0];
  const pmCard = await cardFor(pm);
  assert.deepEqual([pmCard.restricted, pmCard.label, pmCard.status, pmCard.amount, pmCard.route], [false, `${doc.docNo}: Shuttering for the bridge`, 'DRAFT', '12000.00', `/engine/sample-docs?open=${doc.id}`]);
  const empCard = await cardFor(emp);
  assert.deepEqual(empCard, { entity: 'sample_doc', restricted: true, label: 'Restricted record' });
  assert.equal(JSON.stringify(empCard).includes('Shuttering'), false);
  // the card is live: the status follows the record
  api.db.prepare("UPDATE eng_sample_docs SET status = 'APPROVED', locked = 1 WHERE id = ?").run(doc.id);
  assert.equal((await cardFor(pm)).status, 'APPROVED');
  // the details tab lists the linked records with the same rule
  const det = (await call(emp, 'GET', `/conversations/${g}`)).json.data;
  assert.deepEqual(det.links.map((l) => l.restricted), [true]);
  assert.equal((await call(pd, 'POST', `/conversations/${g}/messages`, { body: 'x', recordLinks: [{ entity: 'nothing_here', id: '1' }] })).status, 422);
});

test('FR-04 attachments: only files the sender uploaded to this conversation can be sent; the details list the shared files', async () => {
  const { api, call, say, dm } = await setup();
  const a = await dm(pd, pm);
  const b = (await call(pd, 'POST', '/conversations', { type: 'GROUP', title: 'Other', members: ['se1'] })).json.data.id;
  const file = (conv, by, name = 'site.jpg') => Number(api.db.prepare("INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, linked_entity, linked_id, created_by, source_type) VALUES (1, ?, ?, 'jpg', 'image/jpeg', 'image', 10, 'h', 'CLEAN', 'msg_conversation', ?, ?, 'test')").run(`k/${Math.random()}`, name, conv, by).lastInsertRowid);
  const mine = file(a, 'pd1');
  assert.equal((await call(pd, 'POST', `/conversations/${a}/messages`, { attachments: [file(b, 'pd1')] })).status, 422, 'a file of another conversation');
  assert.equal((await call(pd, 'POST', `/conversations/${a}/messages`, { attachments: [file(a, 'pm1')] })).status, 422, 'a file someone else uploaded');
  assert.equal((await call(pd, 'POST', `/conversations/${a}/messages`, { attachments: [99999] })).status, 422);
  const sent = await say(pd, a, '', { attachments: [mine] });
  assert.deepEqual([sent.kind, sent.attachments.map((f) => f.name)], ['FILE', ['site.jpg']]);
  const voice = await say(pd, a, '', { kind: 'VOICE', attachments: [file(a, 'pd1', 'voice.webm')] });
  assert.equal(voice.kind, 'VOICE');
  const det = (await call(pm, 'GET', `/conversations/${a}`)).json.data;
  assert.deepEqual(det.files.map((f) => f.name).sort(), ['site.jpg', 'voice.webm']);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM msg_messages WHERE kind = 'FILE'").get().n, 1);
});

test('FR-06 members: add, remove, leave, make an administrator; a direct conversation cannot change; the last administrator cannot be removed; a limit applies', async () => {
  const { call, say, dm } = await setup();
  const g = (await call(pd, 'POST', '/conversations', { type: 'GROUP', title: 'Crew', members: ['pm1'] })).json.data.id;
  assert.equal((await call(pm, 'POST', `/conversations/${g}/members`, { users: ['se1'] })).status, 403, 'only an administrator adds');
  const added = (await call(pd, 'POST', `/conversations/${g}/members`, { users: ['se1', 'se1'] })).json.data;
  assert.deepEqual(added.members.map((m) => m.username).sort(), ['pd1', 'pm1', 'se1']);
  assert.equal((await call(pd, 'POST', `/conversations/${g}/members`, { users: ['ghost1'] })).status, 422);
  assert.ok((await call(se, 'GET', `/conversations/${g}/messages`)).json.data.rows.some((r) => r.kind === 'SYSTEM' && /added/.test(r.body)));
  assert.equal((await call(pd, 'PATCH', `/conversations/${g}/members/pm1`, { role: 'ADMIN' })).status, 200);
  assert.equal((await call(pm, 'DELETE', `/conversations/${g}/members/se1`)).json.data.members.length, 2);
  assert.equal((await call(se, 'GET', `/conversations/${g}`)).status, 404);
  assert.equal((await call(pd, 'PATCH', `/conversations/${g}/members/pd1`, { role: 'MEMBER' })).status, 200);
  assert.equal((await call(pm, 'PATCH', `/conversations/${g}/members/pm1`, { role: 'MEMBER' })).status, 422, 'a conversation keeps one administrator');
  assert.equal((await call(pm, 'PATCH', `/conversations/${g}`, { title: 'Crew B' })).json.data.title, 'Crew B');
  assert.equal((await call(pd, 'PATCH', `/conversations/${g}`, { title: 'Hijack' })).status, 403);
  const d = await dm(pd, pm);
  assert.equal((await call(pd, 'POST', `/conversations/${d}/members`, { users: ['se1'] })).status, 422);
  assert.equal((await call(pd, 'DELETE', `/conversations/${d}/members/pm1`)).status, 422);
  // archive for everyone, and a person's own archive and pin
  assert.equal((await call(pm, 'POST', `/conversations/${g}/archive`, { archived: true })).status, 200);
  assert.equal((await call(pm, 'POST', `/conversations/${g}/messages`, { body: 'x' })).status, 422);
  assert.equal((await call(pm, 'GET', '/conversations')).json.data.rows.some((c) => c.id === g), false);
  assert.equal((await call(pm, 'GET', '/conversations?view=archived')).json.data.rows[0].id, g);
  await call(pd, 'PUT', `/conversations/${d}/settings`, { pinned: true });
  await say(pd, d, 'hello');
  assert.equal((await call(pd, 'GET', '/conversations')).json.data.rows[0].id, d);
  assert.equal((await call(pd, 'GET', '/conversations?q=PM1')).json.data.rows.length, 1);
});

test('FR-01 FR-06 project and department channels need the right to make them and are made once; a record conversation is made once and only for people who can open the record', async () => {
  const { api, call, say, project } = await setup();
  assert.equal((await call(se, 'POST', '/conversations', { type: 'PROJECT', projectId: project })).status, 403);
  const ch = await call(pm, 'POST', '/conversations', { type: 'PROJECT', projectId: project });
  assert.equal(ch.status, 201, JSON.stringify(ch.json));
  const again = await call(pm, 'POST', '/conversations', { type: 'PROJECT', projectId: project });
  assert.deepEqual([again.status, again.json.data.id], [200, ch.json.data.id]);
  assert.equal((await call(pm, 'GET', `/conversations/${ch.json.data.id}`)).json.data.title, 'P1 Ring Road');
  assert.equal((await call(pm, 'POST', '/conversations', { type: 'PROJECT', projectId: 999 })).status, 422);
  const doc = (await api.call('POST', '/api/v1/eng/sample-docs', { ...pd, headers: key('d'), body: { title: 'Kerb stones', amount: '5000.00', projectId: project } })).json.data;
  const rc = await call(pd, 'POST', '/conversations', { type: 'RECORD', entity: 'sample_doc', entityId: String(doc.id), members: ['pm1'] });
  assert.equal(rc.status, 201, JSON.stringify(rc.json));
  assert.equal((await call(pm, 'POST', '/conversations', { type: 'RECORD', entity: 'sample_doc', entityId: String(doc.id) })).json.data.id, rc.json.data.id, 'one conversation for a record');
  assert.equal((await call(pd, 'POST', '/conversations', { type: 'RECORD', entity: 'sample_doc', entityId: String(doc.id), members: ['emp1'] })).status, 422, 'a person who cannot open the record cannot be put in');
  assert.equal((await call(emp, 'POST', '/conversations', { type: 'RECORD', entity: 'sample_doc', entityId: String(doc.id) })).status, 404);
  assert.equal((await call(pd, 'POST', `/conversations/${rc.json.data.id}/members`, { users: ['emp1'] })).status, 422);
  const det = (await call(pd, 'GET', `/conversations/${rc.json.data.id}`)).json.data;
  assert.deepEqual([det.type, det.entity, det.title.includes('Kerb stones')], ['RECORD', 'sample_doc', true]);
  void say;
});

test('FR-01 T-01 BR-03 external threads of the gateway are indexed and read in place, read-only, for those who may read the communication log; counts and checksums equal the source', async () => {
  const { api, call } = await setup();
  const ins = (key, dir, body, status = 'SENT') => api.db.prepare("INSERT INTO comm_messages (company_id, channel, direction, to_address, body_redacted, subject, conversation_key, related_entity, related_id, status, created_by, source_type) VALUES (1, 'WHATSAPP', ?, ?, ?, 'Order', ?, 'sample_doc', '1', ?, 'system', 'test')").run(dir, key.replace(/^(wa|mail):/, ''), body, key, status);
  for (const [k, n] of [['wa:+919800000001', 4], ['wa:+919800000002', 2], ['mail:vendor@example.com', 3]]) for (let i = 0; i < n; i += 1) ins(k, i % 2 ? 'IN' : 'OUT', `Message ${i} of ${k}`, i % 2 ? 'RECEIVED' : 'SENT');
  api.db.prepare("INSERT INTO comm_messages (company_id, channel, direction, to_address, body_redacted, status, created_by, source_type) VALUES (1, 'SMS', 'OUT', '+919800000009', 'No thread', 'SENT', 'system', 'test')").run();
  assert.equal((await call(pd, 'GET', '/conversations')).json.data.rows.length, 0, 'without the right to the log the threads are not there');
  const list = (await call(it, 'GET', '/conversations')).json.data;
  assert.deepEqual([list.rows.length, list.rows.every((c) => c.type === 'EXTERNAL' && c.readOnly)], [3, true]);
  assert.equal(list.rows.find((c) => c.title.includes('+919800000001')).unread, 2, 'incoming messages are unread');
  const wa = list.rows.find((c) => c.title.includes('+919800000001'));
  const msgs = (await call(it, 'GET', `/conversations/${wa.id}/messages`)).json.data;
  assert.deepEqual([msgs.rows.length, msgs.readOnly, msgs.rows[0].channel, msgs.rows[1].direction], [4, true, 'WHATSAPP', 'IN']);
  assert.equal((await call(it, 'POST', `/conversations/${wa.id}/messages`, { body: 'reply' })).status, 422, 'read-only here');
  assert.equal((await call(pd, 'GET', `/conversations/${wa.id}/messages`)).status, 404);
  await call(it, 'POST', `/conversations/${wa.id}/read`, {});
  assert.equal((await call(it, 'GET', '/conversations')).json.data.rows.find((c) => c.id === wa.id).unread, 0);
  // a new incoming message appears in the same thread after the next index
  ins('wa:+919800000001', 'IN', 'Late message', 'RECEIVED');
  const after = (await call(it, 'GET', '/conversations')).json.data.rows.find((c) => c.id === wa.id);
  assert.deepEqual([after.unread, after.messageCount, after.last.excerpt], [1, 5, 'Late message']);
  // T-01: counts and checksums
  assert.equal((await call(pd, 'GET', '/verify')).status, 403);
  const v = (await call(sys, 'GET', '/verify')).json.data;
  const gw = v.stores.find((s) => s.store === 'comm_messages');
  assert.deepEqual([gw.threads, gw.indexedThreads, gw.messages, gw.reachableMessages, gw.match, v.ok], [3, 3, 10, 10, true, true]);
  assert.equal(gw.checksum, gw.indexChecksum);
  assert.equal(gw.checksum, gw.readChecksum);
  assert.deepEqual(v.stores.map((s) => s.store), ['comm_messages', 'col_comments', 'ui_record_comments', 'tsk_comments']);
  // compliance export: the auditor, audited, deleted content marked; others refused
  assert.equal((await call(pd, 'GET', `/conversations/${wa.id}/export`)).status, 403);
  const ex = await api.raw('GET', `${M}/conversations/${wa.id}/export`, { ...aud });
  assert.equal(ex.status, 200);
  assert.match(ex.buffer.toString(), /Late message/);
  assert.ok(api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'msg_conversations' AND action = 'compliance_export'").get());
});

test('FR-02 FR-07 the thread index: forwarding marks the message, people search, and the feature flag switches the API off; settings are parameters', async () => {
  const { api, call, say, dm } = await setup();
  const a = await dm(pd, pm);
  const b = (await call(pd, 'POST', '/conversations', { type: 'GROUP', title: 'Leads', members: ['se1'] })).json.data.id;
  const m = await say(pd, a, 'Forward me');
  const f = await call(pd, 'POST', `/messages/${m.id}/forward`, { conversationIds: [b] });
  assert.equal(f.status, 201, JSON.stringify(f.json));
  const got = (await call(se, 'GET', `/conversations/${b}/messages`)).json.data.rows.at(-1);
  assert.deepEqual([got.body, got.forwarded.from.username], ['Forward me', 'pd1']);
  assert.equal((await call(se, 'POST', `/messages/${m.id}/forward`, { conversationIds: [b] })).status, 404, 'se1 cannot forward what they cannot read');
  const ppl = (await call(pd, 'GET', '/people?q=PM')).json.data.rows;
  assert.deepEqual(ppl.map((p) => p.username), ['pm1']);
  const set = (body) => api.call('POST', '/api/v1/core/parameters', { ...sys, headers: key('p'), body: { scopeType: 'company', scopeId: 1, effectiveFrom: new Date().toISOString().slice(0, 10), reason: 'Site teams need longer to fix typos', ...body } });
  assert.equal((await set({ key: 'msg.edit_window_minutes', value: 5000 })).status, 400);
  assert.equal((await set({ key: 'msg.group_max_members', value: 2 })).status, 201);
  assert.equal((await call(pd, 'POST', `/conversations/${b}/members`, { users: ['pm1'] })).status, 422, 'the member limit applies');
  api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.msg.p0501'").run();
  assert.equal((await call(pd, 'GET', '/conversations')).status, 404);
});
