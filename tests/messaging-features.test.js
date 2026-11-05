import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import '../src/server/modules/registry.js';
import { realtimeOf } from '../src/server/platform/realtime/index.js';
import { messagesOf } from '../src/server/modules/msg/messages.js';
import { featuresOf } from '../src/server/modules/msg/features.js';
import { todayIST } from '../src/shared/dates.js';
import { setupCompany, startApi } from './helpers.js';

// Part 05.02: messaging features.
// T-01 receipt states update in real time for the sender of a group message; T-02 search never returns what was said while the person was out of the conversation; T-03 (a call over TURN between a desktop and
// Android Chrome) cannot be run here: the credentials of the TURN server and the signalling of a call are tested, the rest is in the completion report.
const M = '/api/v1/msg';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const key = (k = 'm') => ({ ...json, 'idempotency-key': `mf-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const pd = as('PD', 'pd1');
const pm = as('PM', 'pm1');
const se = as('SE', 'se1');
const aud = as('AUD', 'aud1');
const dir = as('DIR', 'dir1');
const sys = as('SYSADM', 'sys1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const user = (api, name, roles) => api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(name, `${name.toUpperCase()} Kumar`, JSON.stringify(roles), `${name}@example.com`);
const setup = async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'test')").run();
  for (const [n, r] of [['pd1', ['PD']], ['pm1', ['PM']], ['se1', ['SE']], ['aud1', ['AUD']], ['dir1', ['DIR']], ['sys1', ['SYSADM']]]) user(api, n, r);
  const events = [];
  realtimeOf(api.db).setEmitter(async ({ room, event }) => { events.push({ room, ...event }); });
  const call = (who, method, path, body, k) => api.call(method, `${M}${path}`, { ...who, headers: key(k), body });
  const group = async (who, title, members) => (await call(who, 'POST', '/conversations', { type: 'GROUP', title, members })).json.data.id;
  const say = async (who, id, body, extra = {}) => { const r = await call(who, 'POST', `/conversations/${id}/messages`, { body, ...extra }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.data; };
  const msgs = async (who, id, q = '') => (await call(who, 'GET', `/conversations/${id}/messages${q}`)).json.data.rows;
  const setConfig = (over) => { const cur = JSON.parse(api.db.prepare("SELECT config_json FROM msg_config WHERE status = 'ACTIVE'").get()?.config_json ?? '{}'); const ver = (api.db.prepare('SELECT MAX(config_version) AS v FROM msg_config').get().v ?? 0) + 1; api.db.prepare("UPDATE msg_config SET status = 'RETIRED' WHERE status = 'ACTIVE'").run(); api.db.prepare("INSERT INTO msg_config (company_id, config_json, config_version, status, effective_from, reason, created_by, source_type) VALUES (1, ?, ?, 'ACTIVE', '2026-01-01', 'test', 't', 'test')").run(JSON.stringify({ ...cur, ...over }), ver); };
  return { api, call, group, say, msgs, events, setConfig };
};
const act = async (api, who, instanceId) => {
  const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
  assert.ok(task, `${who.user} has the task`);
  assert.equal((await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key('a'), body: { action: 'approve', comment: 'ok' } })).status, 200);
};

test('FR-01 presence: online, away, offline and last seen, only for people one shares a conversation with, and what a person hides stays hidden; typing reaches the room as it happens', async () => {
  const { api, call, group, events } = await setup();
  const g = await group(pd, 'Leads', ['pm1']);
  assert.equal((await call(pm, 'POST', '/presence', { status: 'ONLINE' })).status, 200);
  const get = async (who, users) => (await call(who, 'GET', `/presence?users=${users}`)).json.data.rows;
  assert.deepEqual((await get(pd, 'pm1')).map((r) => [r.username, r.state]), [['pm1', 'ONLINE']]);
  assert.deepEqual(await get(pd, 'se1,aud1'), [], 'people one shares no conversation with are not shown');
  api.db.prepare('UPDATE msg_presence SET last_seen_at = ? WHERE user_ref = ?').run(new Date(Date.now() - 120_000).toISOString(), 'pm1');
  assert.equal((await get(pd, 'pm1'))[0].state, 'AWAY');
  const longAgo = new Date(Date.now() - 3_600_000).toISOString();
  api.db.prepare('UPDATE msg_presence SET last_seen_at = ? WHERE user_ref = ?').run(longAgo, 'pm1');
  const off = (await get(pd, 'pm1'))[0];
  assert.deepEqual([off.state, off.lastSeen], ['OFFLINE', longAgo]);
  // privacy: no last seen; then not even online
  assert.equal((await call(pm, 'PUT', '/me/settings', { showLastSeen: false })).json.data.showLastSeen, false);
  const hidden = (await get(pd, 'pm1'))[0];
  assert.deepEqual([hidden.lastSeen, hidden.lastSeenHidden], [null, true]);
  await call(pm, 'POST', '/presence', { status: 'ONLINE' });
  await call(pm, 'PUT', '/me/settings', { showOnline: false });
  assert.equal((await get(pd, 'pm1'))[0].state, 'OFFLINE', 'a person who hides their presence looks offline');
  assert.equal((await call(pm, 'PUT', '/me/settings', {})).status, 400);
  // typing is told to the room, not kept
  const before = api.db.prepare('SELECT COUNT(*) AS n FROM ntf_realtime_events').get().n;
  assert.equal((await call(pd, 'POST', `/conversations/${g}/typing`)).status, 200);
  const t = events.find((e) => e.type === 'msg.typing');
  assert.deepEqual([t.room, t.data.user, t.transient], [`conv:${g}`, 'pd1', true]);
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM ntf_realtime_events').get().n, before, 'typing is never logged');
  assert.equal((await call(se, 'POST', `/conversations/${g}/typing`)).status, 404, 'only a member can type into it');
});

test('T-01 FR-02 receipts: sent, delivered, read for the sender of a group message, in real time; who read it and when; privacy and the enforced policy', async () => {
  const { api, call, group, say, msgs, events, setConfig } = await setup();
  const g = await group(pd, 'Bridge', ['pm1', 'se1']);
  const m = await say(pd, g, 'Pour at 6 am');
  const state = async () => (await msgs(pd, g)).find((x) => x.id === m.id).receipt;
  assert.deepEqual(await state(), { state: 'sent', delivered: 0, read: 0, of: 2 });
  assert.equal((await call(pm, 'POST', `/conversations/${g}/delivered`, {})).status, 200);
  assert.deepEqual(await state(), { state: 'sent', delivered: 1, read: 0, of: 2 }, 'one of two: not yet delivered to the group');
  assert.ok(events.some((e) => e.type === 'msg.receipt.updated' && e.room === `conv:${g}` && e.data.user === 'pm1' && e.data.state === 'delivered'), 'the sender\'s screen is told at once');
  await call(se, 'POST', `/conversations/${g}/delivered`, {});
  assert.equal((await state()).state, 'delivered');
  await call(pm, 'POST', `/conversations/${g}/read`, {});
  assert.deepEqual(await state(), { state: 'delivered', delivered: 2, read: 1, of: 2 });
  assert.ok(events.some((e) => e.type === 'msg.receipt.updated' && e.data.user === 'pm1' && e.data.state === 'read'));
  await call(se, 'POST', `/conversations/${g}/read`, {});
  assert.equal((await state()).state, 'read');
  assert.equal((await call(pm, 'POST', `/conversations/${g}/delivered`, {})).json.data.marked, 0, 'twice changes nothing');
  // who and when: the sender and the administrators, not others
  const d = (await call(pd, 'GET', `/messages/${m.id}/receipts`)).json.data;
  assert.deepEqual([d.total, d.delivered, d.read], [2, 2, 2]);
  assert.ok(d.recipients.every((r) => r.readAt && r.deliveredAt));
  assert.equal((await call(pm, 'GET', `/messages/${m.id}/receipts`)).status, 403);
  // privacy: a reader who turns receipts off is not shown as having read, and loses the view of others'
  await call(se, 'PUT', '/me/settings', { shareReadReceipts: false });
  const hidden = (await call(pd, 'GET', `/messages/${m.id}/receipts`)).json.data;
  assert.deepEqual([hidden.read, hidden.recipients.find((r) => r.username === 'se1').readHidden], [1, true]);
  assert.deepEqual(await state(), { state: 'delivered', delivered: 2, read: 1, of: 2 });
  const mine = await say(se, g, 'Noted');
  await call(pd, 'POST', `/conversations/${g}/read`, {});
  assert.equal((await msgs(se, g)).find((x) => x.id === mine.id).receipt.read, 0, 'and se1 cannot see who read theirs');
  // the organisation can enforce receipts
  setConfig({ enforceReadReceipts: true });
  assert.equal((await state()).read, 2);
  assert.equal((await call(pd, 'GET', `/messages/${m.id}/receipts`)).json.data.recipients.find((r) => r.username === 'se1').readHidden, false);
  assert.equal((await msgs(se, g)).find((x) => x.id === mine.id).receipt.read, 1);
  void api;
});

test('T-02 FR-03 search: by text, sender, date and kind across my conversations, with a jump to the message in context; never what was said while I was out, never a conversation I am not in', async () => {
  const { api, call, group, say, msgs } = await setup();
  const g = await group(pd, 'Plant', ['pm1', 'se1']);
  const other = await group(pd, 'Private', ['pm1']);
  await say(pd, g, 'Crane 12 arrives Monday');
  await say(pm, g, 'Concrete pump is booked for Tuesday');
  const lost = await say(pd, g, 'Budget figure is 4.2 crore');
  await say(pd, other, 'Crane 12 is not for se1');
  const url = await say(pd, g, 'Drawing at https://example.com/dwg/12 please');
  const run = async (who, q) => (await call(who, 'GET', `/search?${q}`)).json.data.rows;
  assert.deepEqual((await run(se, 'q=crane')).map((r) => r.conversation), ['Plant'], 'the conversation se1 is not in is not searched');
  assert.deepEqual((await run(pd, 'q=crane')).map((r) => r.conversation).sort(), ['Plant', 'Private']);
  assert.deepEqual((await run(se, 'q=pump&sender=pm1')).map((r) => r.messageId.toString()), [String((await msgs(se, g)).find((x) => /pump/.test(x.body)).id)]);
  assert.equal((await run(se, 'q=pump&sender=pd1')).length, 0);
  assert.match((await run(se, 'q=Tuesday'))[0].snippet, /Tuesday/);
  assert.equal((await run(se, 'kind=links')).length, 1);
  assert.equal((await run(se, `q=crane&from=${todayIST()}&to=${todayIST()}`)).length, 1);
  assert.equal((await run(se, 'q=crane&from=2020-01-01&to=2020-01-31')).length, 0);
  assert.equal((await call(se, 'GET', '/search')).status, 422, 'something to look for');
  assert.equal((await run(se, 'q=%25')).length, 0, 'a percent sign is a character, not a wildcard');
  // jump in context
  const ar = await call(se, 'GET', `/conversations/${g}/messages?around=${lost.id}&limit=4`);
  assert.equal(ar.status, 200, JSON.stringify(ar.json));
  const around = ar.json.data;
  assert.ok(around.rows.some((r) => r.id === lost.id) && around.rows.length <= 5);
  // T-02: se1 leaves, things are said, se1 comes back
  assert.equal((await call(se, 'DELETE', `/conversations/${g}/members/se1`)).status, 200);
  await say(pd, g, 'Secret decision: we drop the subcontractor');
  assert.equal((await run(se, 'q=Secret')).length, 0, 'not a member now: nothing');
  await new Promise((r) => setTimeout(r, 15));
  assert.equal((await call(pd, 'POST', `/conversations/${g}/members`, { users: ['se1'] })).status, 200);
  await say(pd, g, 'Welcome back, se1');
  assert.deepEqual((await run(se, 'q=Secret')).length, 0, 'said while out: never shown');
  assert.equal((await run(se, 'q=Welcome')).length, 1);
  assert.equal((await run(se, 'q=Budget')).length, 1, 'said before they left: still theirs');
  assert.ok(!(await msgs(se, g)).some((m) => /Secret/.test(m.body)), 'nor in the history of the conversation');
  assert.ok((await msgs(pd, g)).some((m) => /Secret/.test(m.body)));
  const star = await call(se, 'POST', `/messages/${url.id}/star`, { on: true });
  assert.equal(star.status, 200);
  const secretId = (await msgs(pd, g)).find((m) => /Secret/.test(m.body)).id;
  assert.equal((await call(se, 'POST', `/messages/${secretId}/star`, { on: true })).status, 404, 'cannot even star what they never saw');
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM msg_member_periods WHERE user_ref = ?').get('se1').n, 2, 'two periods of membership are kept');
});

test('FR-04 FR-05 edit, delete for me and for everyone with their own windows, stars and pins', async () => {
  const { api, call, group, say, msgs, setConfig } = await setup();
  const g = await group(pd, 'Crew', ['pm1']);
  const a = await say(pd, g, 'First');
  const b = await say(pm, g, 'Second');
  // delete for me: gone for me, still there for the other person
  assert.equal((await call(pm, 'POST', `/messages/${a.id}/hide`, {})).status, 200);
  assert.ok(!(await msgs(pm, g)).some((m) => m.id === a.id));
  assert.ok((await msgs(pd, g)).some((m) => m.id === a.id));
  // separate windows
  setConfig({ editWindowMinutes: 60, deleteWindowMinutes: 1 });
  api.db.prepare('UPDATE msg_messages SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 5 * 60_000).toISOString(), b.id);
  assert.equal((await call(pm, 'PATCH', `/messages/${b.id}`, { body: 'Second, corrected' })).status, 200, 'inside the edit window');
  assert.equal((await call(pm, 'DELETE', `/messages/${b.id}`)).status, 422, 'outside the delete window');
  assert.equal((await msgs(pm, g)).find((m) => m.id === b.id).canDelete, false);
  // stars
  assert.equal((await call(pm, 'POST', `/messages/${b.id}/star`, { on: true })).json.data.starred, true);
  assert.equal((await msgs(pm, g)).find((m) => m.id === b.id).starred, true);
  assert.equal((await msgs(pd, g)).find((m) => m.id === b.id).starred, false, 'stars are personal');
  assert.deepEqual((await call(pm, 'GET', '/starred')).json.data.rows.map((r) => [r.messageId, r.conversation]), [[b.id, 'Crew']]);
  await call(pm, 'POST', `/messages/${b.id}/star`, { on: false });
  assert.equal((await call(pm, 'GET', '/starred')).json.data.total, 0);
  // pins: an administrator, up to five, shown to all
  assert.equal((await call(pm, 'POST', `/messages/${b.id}/pin`, { on: true })).status, 403);
  assert.equal((await call(pd, 'POST', `/messages/${b.id}/pin`, { on: true })).json.data.pinned, true);
  assert.deepEqual((await call(pm, 'GET', `/conversations/${g}/pins`)).json.data.rows.map((r) => r.messageId), [b.id]);
  assert.equal((await msgs(pm, g)).find((m) => m.id === b.id).pinned, true);
  const extra = [];
  for (let i = 0; i < 5; i += 1) extra.push(await say(pd, g, `Pinned ${i}`));
  for (const e of extra.slice(0, 4)) assert.equal((await call(pd, 'POST', `/messages/${e.id}/pin`, { on: true })).status, 200);
  assert.equal((await call(pd, 'POST', `/messages/${extra[4].id}/pin`, { on: true })).status, 422, 'at most five');
  assert.equal((await call(pd, 'POST', `/messages/${b.id}/pin`, { on: false })).json.data.pinned, false);
});

test('FR-06 FR-07 the media gallery (photos, documents, links) and voice notes with their waveform; file, video and voice limits', async () => {
  const { api, call, group, say, msgs, setConfig } = await setup();
  const g = await group(pd, 'Site', ['pm1']);
  const file = (name, category, size, by = 'pd1') => Number(api.db.prepare("INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, linked_entity, linked_id, created_by, source_type) VALUES (1, ?, ?, 'x', ?, ?, ?, 'h', 'CLEAN', 'msg_conversation', ?, ?, 'test')").run(`k/${Math.random()}`, name, category === 'image' ? 'image/jpeg' : category === 'video' ? 'video/mp4' : category === 'audio' ? 'audio/webm' : 'application/pdf', category === 'audio' ? 'video' : category, size, g, by).lastInsertRowid);
  await say(pd, g, '', { attachments: [file('slab.jpg', 'image', 1000)] });
  await say(pd, g, 'Drawing see https://example.com/a.', { attachments: [file('plan.pdf', 'document', 2000)] });
  await say(pm, g, 'Walkthrough', { attachments: [file('walk.mp4', 'video', 5000, 'pm1')] });
  const media = async (who, kind) => (await call(who, 'GET', `/conversations/${g}/media?kind=${kind}`)).json.data;
  assert.deepEqual((await media(pm, 'photos')).rows.map((r) => r.file.name).sort(), ['slab.jpg', 'walk.mp4']);
  assert.deepEqual((await media(pm, 'documents')).rows.map((r) => r.file.name), ['plan.pdf']);
  assert.deepEqual((await media(pm, 'links')).rows.map((r) => r.url), ['https://example.com/a']);
  assert.equal((await call(se, 'GET', `/conversations/${g}/media`)).status, 404, 'members only');
  // voice note with a waveform
  const v = await say(pd, g, '', { kind: 'VOICE', attachments: [file('voice.webm', 'audio', 800)], voice: { durationMs: 4200, waveform: [3, 20, 55, 80, 40, 10] } });
  const got = (await msgs(pm, g)).find((m) => m.id === v.id);
  assert.deepEqual([got.kind, got.voice], ['VOICE', { durationMs: 4200, waveform: [3, 20, 55, 80, 40, 10] }]);
  assert.equal((await call(pd, 'GET', '/search?kind=voice')).json.data.rows.length, 1);
  // limits come from the settings
  setConfig({ maxFileMb: 1, maxVideoMb: 2, maxVoiceSeconds: 10 });
  const big = (size) => file('big.pdf', 'document', size);
  assert.equal((await call(pd, 'POST', `/conversations/${g}/messages`, { body: 'x', attachments: [big(2 * 1024 * 1024)] })).status, 422);
  assert.equal((await call(pd, 'POST', `/conversations/${g}/messages`, { body: 'x', attachments: [file('v.mp4', 'video', 3 * 1024 * 1024)] })).status, 422);
  assert.equal((await call(pd, 'POST', `/conversations/${g}/messages`, { kind: 'VOICE', body: '', attachments: [file('long.webm', 'audio', 100)], voice: { durationMs: 11_000, waveform: [] } })).status, 422);
  assert.equal((await call(pd, 'POST', `/conversations/${g}/messages`, { body: 'ok', attachments: [file('small.pdf', 'document', 500_000)] })).status, 201);
});

test('FR-09 legal hold and retention: a held conversation keeps everything; retention removes old messages elsewhere; a hold is released by someone else', async () => {
  const { api, call, group, say, setConfig } = await setup();
  const held = await group(pd, 'Dispute', ['pm1']);
  const free = await group(pd, 'Chat', ['pm1']);
  assert.equal((await call(pm, 'POST', `/conversations/${held}/hold`, { reason: 'Arbitration with the supplier' })).status, 403);
  assert.equal((await call(aud, 'POST', `/conversations/${held}/hold`, { reason: 'x' })).status, 400);
  const placed = await call(aud, 'POST', `/conversations/${held}/hold`, { reason: 'Arbitration with the supplier' });
  assert.equal(placed.status, 201, JSON.stringify(placed.json));
  assert.equal((await call(aud, 'POST', `/conversations/${held}/hold`, { reason: 'Again please' })).status, 409);
  const old = new Date(Date.now() - 400 * 86_400_000).toISOString();
  const a = await say(pd, held, 'Held words');
  const b = await say(pd, free, 'Free words');
  api.db.prepare('UPDATE msg_messages SET created_at = ? WHERE id IN (?, ?)').run(old, a.id, b.id);
  const gone = await say(pd, held, 'Deleted but held');
  const gone2 = await say(pd, free, 'Deleted and free');
  await call(pd, 'DELETE', `/messages/${gone.id}`);
  await call(pd, 'DELETE', `/messages/${gone2.id}`);
  api.db.prepare('UPDATE msg_messages SET deleted_at = ? WHERE id IN (?, ?)').run(old, gone.id, gone2.id);
  setConfig({ retentionDays: 365, deletedContentRetentionDays: 30 });
  const r = messagesOf(api.db).admin.purge(1);
  assert.deepEqual([r.purged, r.expired], [1, 1]);
  const body = (id) => api.db.prepare('SELECT body, status FROM msg_messages WHERE id = ?').get(id);
  assert.equal(body(a.id).body, 'Held words', 'a held conversation keeps old messages');
  assert.equal(body(gone.id).body, 'Deleted but held', 'and the words of deleted ones');
  assert.deepEqual({ ...body(b.id) }, { body: '', status: 'DELETED' });
  assert.equal(body(gone2.id).body, '');
  // release: not by the person who placed it
  const hid = placed.json.data.id;
  assert.equal((await call(aud, 'POST', `/holds/${hid}/release`, { reason: 'Settled' })).status, 403);
  assert.equal((await call(dir, 'POST', `/holds/${hid}/release`, { reason: 'Settled in court' })).status, 200);
  assert.equal(messagesOf(api.db).admin.purge(1).purged, 1);
  assert.equal((await call(dir, 'GET', '/holds')).json.data.rows[0].active, false);
  assert.ok(api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'msg_holds' AND action = 'place'").get());
});

test('FR-08 BR-02 calls: ringing, joining, signalling between the two, decline, end with the duration in the conversation, a missed call, a limit, TURN credentials, never recorded', async () => {
  const { api, call, group, events, setConfig, msgs, say } = await setup();
  const dm = (await call(pd, 'POST', '/conversations', { type: 'DIRECT', members: ['pm1'] })).json.data.id;
  const started = await call(pd, 'POST', `/conversations/${dm}/calls`, { type: 'VIDEO' });
  assert.equal(started.status, 201, JSON.stringify(started.json));
  const callId = started.json.data.call.id;
  assert.deepEqual([started.json.data.call.status, started.json.data.recording], ['RINGING', 'OFF']);
  assert.ok(events.some((e) => e.type === 'msg.call.ringing' && e.room === 'user:pm1' && e.data.callId === callId), 'the invitee\'s screen rings');
  assert.ok(api.db.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'msg.call' AND user_ref = 'pm1'").get(), 'and a notification is sent');
  assert.deepEqual((await call(pm, 'GET', '/calls/ringing')).json.data.rows.map((r) => r.id), [callId]);
  assert.equal((await call(pd, 'POST', `/conversations/${dm}/calls`, { type: 'AUDIO' })).status, 409, 'one call at a time');
  assert.equal((await call(se, 'POST', `/calls/${callId}/join`)).status, 404, 'a stranger cannot join');
  const joined = await call(pm, 'POST', `/calls/${callId}/join`);
  assert.deepEqual([joined.json.data.call.status, joined.json.data.peers], ['ACTIVE', ['pd1']]);
  // signalling goes only to the other person in the call, and is not kept
  const before = api.db.prepare('SELECT COUNT(*) AS n FROM ntf_realtime_events').get().n;
  assert.equal((await call(pm, 'POST', `/calls/${callId}/signal`, { to: 'pd1', kind: 'offer', data: { sdp: 'v=0' } })).status, 200);
  const sig = events.filter((e) => e.type === 'msg.call.signal');
  assert.deepEqual([sig.length, sig[0].room, sig[0].data.from, sig[0].data.kind], [1, 'user:pd1', 'pm1', 'offer']);
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM ntf_realtime_events').get().n, before);
  assert.equal((await call(se, 'POST', `/calls/${callId}/signal`, { to: 'pd1', kind: 'offer', data: {} })).status, 404);
  const odd = await call(pm, 'POST', `/calls/${callId}/signal`, { to: 'se1', kind: 'offer', data: {} });
  assert.equal(odd.status, 422, JSON.stringify(odd.json));
  assert.equal((await call(pm, 'POST', `/calls/${callId}/signal`, { to: 'pd1', kind: 'offer', data: { x: 'y'.repeat(40_000) } })).status, 400);
  // ending: the conversation records it
  api.db.prepare('UPDATE msg_calls SET answered_at = ? WHERE id = ?').run(new Date(Date.now() - 125_000).toISOString(), callId);
  const ended = (await call(pd, 'POST', `/calls/${callId}/end`)).json.data;
  assert.equal(ended.status, 'ENDED');
  assert.ok(ended.durationSeconds >= 120);
  assert.ok((await msgs(pd, dm)).some((m) => m.kind === 'SYSTEM' && /Video call ended, 2 min/.test(m.body)));
  assert.equal((await call(pm, 'POST', `/calls/${callId}/join`)).status, 422, 'a call that is over cannot be joined');
  assert.equal((await call(pd, 'GET', `/conversations/${dm}/calls`)).json.data.rows.length, 1);
  // decline
  const c2 = (await call(pm, 'POST', `/conversations/${dm}/calls`, { type: 'AUDIO' })).json.data.call.id;
  assert.equal((await call(pd, 'POST', `/calls/${c2}/decline`)).json.data.status, 'DECLINED');
  // a missed call: nobody answers within the ring time
  const c3 = (await call(pd, 'POST', `/conversations/${dm}/calls`, { type: 'AUDIO' })).json.data.call.id;
  api.db.prepare('UPDATE msg_calls SET started_at = ? WHERE id = ?').run(new Date(Date.now() - 60_000).toISOString(), c3);
  assert.equal((await call(pm, 'GET', '/calls/ringing')).json.data.rows.length, 0);
  assert.equal(api.db.prepare('SELECT status FROM msg_calls WHERE id = ?').get(c3).status, 'MISSED');
  assert.ok(api.db.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'msg.call.missed' AND user_ref = 'pm1'").get());
  assert.ok((await msgs(pd, dm)).some((m) => /Missed voice call/.test(m.body)));
  // a small group: a limit on the people in it, and on the size of the conversation
  const g = await group(pd, 'Team', ['pm1', 'se1', 'aud1', 'dir1']);
  const gc = (await call(pd, 'POST', `/conversations/${g}/calls`, { type: 'AUDIO' })).json.data.call.id;
  for (const w of [pm, se, aud]) assert.equal((await call(w, 'POST', `/calls/${gc}/join`)).status, 200);
  const full = await call(dir, 'POST', `/calls/${gc}/join`);
  assert.equal(full.status, 422, 'four at once is the limit');
  assert.match(full.json.error.message, /at most 4/);
  // TURN credentials work for an hour and are made with the shared secret
  setConfig({ stunUrls: ['stun:stun.example.com:3478'], turnUrls: ['turn:turn.example.com:3478'], turnSecret: 'shared-secret', turnTtlSeconds: 3600, callsEnabled: true });
  await call(pd, 'POST', `/calls/${gc}/end`);
  const dm2 = (await call(pd, 'POST', '/conversations', { type: 'DIRECT', members: ['se1'] })).json.data.id;
  const ice = (await call(pd, 'POST', `/conversations/${dm2}/calls`, { type: 'AUDIO' })).json.data.iceServers;
  assert.deepEqual(ice[0], { urls: ['stun:stun.example.com:3478'] });
  const [exp, who] = ice[1].username.split(':');
  assert.equal(who, 'pd1');
  assert.ok(Number(exp) > Date.now() / 1000 + 3500);
  assert.equal(ice[1].credential, createHmac('sha1', 'shared-secret').update(ice[1].username).digest('base64'));
  // an external provider: a room address, no signalling here
  await call(pd, 'POST', `/calls/${(await call(pd, 'GET', `/conversations/${dm2}/calls`)).json.data.active}/end`);
  setConfig({ callProvider: 'EXTERNAL', providerBaseUrl: 'https://meet.example.com' });
  const ext = (await call(pd, 'POST', `/conversations/${dm2}/calls`, { type: 'VIDEO' })).json.data;
  assert.match(ext.joinUrl, /^https:\/\/meet\.example\.com\/erp-[0-9a-f]{18}$/);
  assert.deepEqual(ext.iceServers, []);
  await call(pd, 'POST', `/calls/${ext.call.id}/end`);
  setConfig({ callsEnabled: false });
  assert.equal((await call(pd, 'POST', `/conversations/${dm2}/calls`, { type: 'AUDIO' })).status, 422);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('msg_calls') WHERE name LIKE '%record%'").get().n, 0, 'calls are never recorded: there is nowhere to keep a recording');
  void say; void featuresOf;
});

test('AC-04 the messaging settings: a change is a new version approved by a second person, in force from its date, audited, with history; secrets are never shown; calls are never recorded', async () => {
  const { api, call } = await setup();
  const body = (over = {}) => ({ editWindowMinutes: 30, deleteWindowMinutes: 10, deletedContentRetentionDays: 60, retentionDays: 0, maxFileMb: 20, maxVideoMb: 40, maxVoiceSeconds: 120, enforceReadReceipts: false, callsEnabled: true, callProvider: 'WEBRTC',
    providerBaseUrl: '', stunUrls: ['stun:stun.example.com:3478'], turnUrls: ['turn:turn.example.com:3478'], turnSecret: 's3cret', turnTtlSeconds: 3600, maxCallParticipants: 4, recording: 'OFF', effectiveFrom: todayIST(), reason: 'Site teams need longer to fix typos', ...over });
  const propose = (who, over, k = 'c') => call(who, 'POST', '/config/changes', body(over), k);
  assert.equal((await call(pm, 'GET', '/config')).status, 403);
  assert.equal((await propose(pm)).status, 403);
  assert.equal((await propose(sys, { recording: 'ON' })).status, 400, 'calls are never recorded');
  assert.equal((await propose(sys, { callProvider: 'EXTERNAL' })).status, 400, 'an external provider needs its address');
  assert.equal((await propose(sys, { stunUrls: ['not an address'] })).status, 400);
  assert.equal((await propose(sys, { effectiveFrom: '2020-01-01' })).status, 400, 'not in the past');
  assert.equal((await propose(sys, { maxCallParticipants: 20 })).status, 400);
  assert.equal((await call(sys, 'GET', '/config')).json.data.config.editWindowMinutes, 15, 'the defaults until a change is approved');
  const prop = await propose(sys);
  assert.equal(prop.status, 202, JSON.stringify(prop.json));
  assert.equal((await propose(sys, {}, 'c2')).status, 409, 'one change at a time');
  const shown = (await call(sys, 'GET', '/config')).json.data;
  assert.deepEqual([shown.pending.version, shown.pending.status, shown.pending.config.turnSecret], [1, 'PENDING', '••••••']);
  assert.equal(shown.config.editWindowMinutes, 15, 'not before approval');
  assert.equal((await api.call('GET', `${W}/tasks?mine=assigned`, sys)).json.data.rows.find((x) => x.instance.id === prop.json.data.workflow.id), undefined, 'the maker cannot approve');
  await act(api, dir, prop.json.data.workflow.id);
  const after = (await call(sys, 'GET', '/config')).json.data;
  assert.deepEqual([after.config.editWindowMinutes, after.config.deleteWindowMinutes, after.config.turnSecret, after.history[0].status], [30, 10, '••••••', 'ACTIVE']);
  assert.ok(api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'msg_config' AND action = 'approve'").get());
  assert.ok(api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'msg_config' AND action = 'propose' AND reason = ?").get('Site teams need longer to fix typos'));
  // the new window applies to messages
  const g = (await call(pd, 'POST', '/conversations', { type: 'GROUP', title: 'Windows', members: ['pm1'] })).json.data.id;
  const m = (await call(pm, 'POST', `/conversations/${g}/messages`, { body: 'text' })).json.data;
  api.db.prepare('UPDATE msg_messages SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 20 * 60_000).toISOString(), m.id);
  assert.equal((await call(pm, 'PATCH', `/messages/${m.id}`, { body: 'fixed' })).status, 200, 'edit window 30 minutes');
  assert.equal((await call(pm, 'DELETE', `/messages/${m.id}`)).status, 422, 'delete window 10 minutes');
  // a secret left blank is kept; a future date is scheduled and takes over on its day; a rejected change changes nothing
  const next = await propose(sys, { turnSecret: '', editWindowMinutes: 45, effectiveFrom: '2099-01-01' }, 'c3');
  assert.equal(next.status, 202);
  await act(api, dir, next.json.data.workflow.id);
  assert.equal((await call(sys, 'GET', '/config')).json.data.config.editWindowMinutes, 30);
  assert.equal(api.db.prepare("SELECT status FROM msg_config WHERE config_version = 2").get().status, 'SCHEDULED');
  assert.equal(JSON.parse(api.db.prepare('SELECT config_json FROM msg_config WHERE config_version = 2').get().config_json).turnSecret, 's3cret');
  api.db.prepare("UPDATE msg_config SET effective_from = ? WHERE config_version = 2").run(todayIST());
  assert.equal((await call(sys, 'GET', '/config')).json.data.config.editWindowMinutes, 45);
  const rej = await propose(sys, { editWindowMinutes: 5 }, 'c4');
  const task = (await api.call('GET', `${W}/tasks?mine=assigned`, dir)).json.data.rows.find((x) => x.instance.id === rej.json.data.workflow.id);
  assert.equal((await api.call('POST', `${W}/tasks/${task.id}/act`, { ...dir, headers: key('r'), body: { action: 'reject', comment: 'The window is too short for the sites.' } })).status, 200);
  assert.equal((await call(sys, 'GET', '/config')).json.data.config.editWindowMinutes, 45);
  assert.deepEqual((await call(sys, 'GET', '/config')).json.data.history.map((h) => h.status), ['REJECTED', 'ACTIVE', 'RETIRED']);
  const exp = await api.raw('GET', `${M}/config/export`, { ...aud });
  assert.equal(exp.status, 200);
  assert.equal(exp.buffer.toString().includes('s3cret'), false);
  api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.msg.p0502'").run();
  assert.equal((await call(sys, 'GET', '/config')).status, 404, 'the feature flag switches it off');
  assert.equal((await call(pd, 'GET', '/conversations')).status, 200, 'and leaves the Messages app of 05.01 working');
});
