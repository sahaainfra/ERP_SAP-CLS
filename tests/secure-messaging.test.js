import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { realtimeOf } from '../src/server/platform/realtime/index.js';
import { checkType } from '../src/server/platform/files/types.js';
import { compareTrust, decryptAttachment, decryptEnvelope, encryptAttachment, encryptMessage, fingerprint, generateDeviceKeys, makeOneTimePrekeys, makeSignedPrekey, registrationBody, safetyNumber, toB64 } from '../src/shared/e2e.js';
import { setupCompany, startApi } from './helpers.js';

// Part 05.03: secure end-to-end messaging. T-01 the database holds only ciphertext for secure messages; T-02 a key change triggers the safety-number warning; T-03 an attachment decrypts only on member devices.
// The tests play the part of the browser: they generate keys, register devices, encrypt, send, fetch and decrypt with the same library the browser uses (src/shared/e2e.js).
const S = '/api/v1/sec';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const key = (k = 's') => ({ ...json, 'idempotency-key': `sec-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const pd = as('PD', 'pd1');
const pm = as('PM', 'pm1');
const se = as('SE', 'se1');
const dir = as('DIR', 'dir1');
const sys = as('SYSADM', 'sys1');
const itadm = as('ITADM', 'it1');
const aud = as('AUD', 'aud1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const POLICY = (over = {}) => ({ enabled: true, creatorRoles: ['DIR', 'PD', 'PM'], maxGroupMembers: 10, maxDevicesPerUser: 3, allowAttachments: true, maxAttachmentMb: 10, defaultDisappearSeconds: 0, allowedDisappearSeconds: [0, 3600, 86_400], metadataRetentionDays: 90, undeliveredRetentionDays: 14, screenshotWarning: true, effectiveFrom: today(), reason: 'Sensitive tender talks', ...over });
const user = (api, name, roles) => api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(name, `${name.toUpperCase()} Kumar`, JSON.stringify(roles), `${name}@example.com`);
const act = async (api, who, instanceId, action = 'approve', comment = 'checked and fine') => {
  const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
  assert.ok(task, `${who.user} has the task`);
  const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key('a'), body: { action, comment } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
};
const setup = async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'test')").run();
  for (const [n, r] of [['pd1', ['PD']], ['pm1', ['PM']], ['se1', ['SE']], ['dir1', ['DIR']], ['sys1', ['SYSADM']], ['it1', ['ITADM']], ['aud1', ['AUD']]]) user(api, n, r);
  const events = [];
  realtimeOf(api.db).setEmitter(async ({ room, event }) => { events.push({ room, ...event }); });
  const call = (who, method, path, body, k) => api.call(method, `${S}${path}`, { ...who, headers: key(k), body });
  /** The whole approval path: the review, then the policy that switches secure messaging on. */
  const enable = async (over) => {
    const rev = await call(sys, 'POST', '/licences/reviews', { comment: 'Review of the end-to-end library and the open-source components' });
    assert.equal(rev.status, 202, JSON.stringify(rev.json));
    await act(api, itadm, rev.json.data.workflow.id);
    await act(api, dir, rev.json.data.workflow.id);
    const prop = await call(sys, 'POST', '/policy/changes', POLICY(over));
    assert.equal(prop.status, 202, JSON.stringify(prop.json));
    await act(api, itadm, prop.json.data.workflow.id);
  };
  return { api, call, events, enable };
};

/** A browser of one person: it holds its device keys, registers, encrypts, sends, fetches and decrypts. */
class Device {
  constructor(t, who, name = 'Phone') { this.t = t; this.who = who; this.name = name; this.signed = new Map(); this.onetime = new Map(); }
  async register() {
    this.keys = await generateDeviceKeys({ oneTimeCount: 6 });
    const r = await this.t.call(this.who, 'POST', '/devices', registrationBody(this.keys, { name: this.name, platform: 'test' }));
    assert.equal(r.status, 201, JSON.stringify(r.json));
    this.id = r.json.data.id;
    this.signed.set(this.keys.signedPrekey.id, this.keys.signedPrekey.privateKey);
    for (const k of this.keys.oneTimePrekeys) this.onetime.set(k.id, k.privateKey);
    return this;
  }
  async send(convId, payload, uid = `m-${Math.random().toString(36).slice(2, 14)}-${Date.now()}`) {
    const b = await this.t.call(this.who, 'GET', `/conversations/${convId}/bundles?device=${this.id}`);
    assert.equal(b.status, 200, JSON.stringify(b.json));
    const sealed = await encryptMessage({ sender: { deviceId: this.id, identityPrivateKey: this.keys.identity.privateKey }, messageUid: uid, payload, recipients: b.json.data.devices });
    const r = await this.t.call(this.who, 'POST', '/envelopes', { conversationId: convId, senderDeviceId: this.id, messageUid: uid, envelopes: sealed.map((e) => ({ recipientDeviceId: e.recipientDeviceId, ciphertext: e.ciphertext })) });
    return { r, uid, sealed };
  }
  async receive() {
    const f = await this.t.call(this.who, 'GET', `/envelopes?device=${this.id}&since=0`);
    assert.equal(f.status, 200, JSON.stringify(f.json));
    const out = [];
    for (const e of f.json.data.rows) {
      const d = await decryptEnvelope({ device: { deviceId: this.id, signedPrekeys: this.signed, oneTimePrekeys: this.onetime }, envelope: e.ciphertext, senderIdentityKey: e.senderIdentityKey });
      if (d.usedOneTimePrekeyId != null) this.onetime.delete(d.usedOneTimePrekeyId);
      out.push({ ...d, conversationId: e.conversationId, sender: e.sender, envelopeId: e.id });
    }
    if (out.length) assert.equal((await this.t.call(this.who, 'POST', '/envelopes/ack', { deviceId: this.id, ids: out.map((m) => m.envelopeId) })).json.data.acked, out.length);
    return out;
  }
}

test('AC-01 BR-01 the gate: nothing works until the licence review is approved and the policy is on; the review is approved by the IT administrator and then the director', async () => {
  const t = await setup();
  assert.equal((await t.call(pd, 'GET', '/ready')).json.data.ready, false);
  // no device can register before the gate is open
  const keys = await generateDeviceKeys({ oneTimeCount: 2 });
  const body = registrationBody(keys, { name: 'Phone', platform: 'test' });
  assert.equal((await t.call(pd, 'POST', '/devices', body)).status, 422, 'no registration before the licence review');
  // the policy cannot be switched on before the review is approved
  const early = await t.call(sys, 'POST', '/policy/changes', POLICY());
  assert.equal(early.status, 422);
  assert.match(early.json.error.message, /licence review/i);
  // the register: seeded entries, the AGPL library is not yet decided
  const reg = (await t.call(aud, 'GET', '/licences')).json.data;
  const sig = reg.rows.find((r) => r.component.startsWith('libsignal'));
  assert.equal(sig.licence, 'AGPL-3.0-only');
  assert.equal(sig.copyleft, true);
  assert.equal(reg.approved, false);
  // only people with the right see or change the register
  assert.equal((await t.call(se, 'GET', '/licences')).status, 403);
  assert.equal((await t.call(itadm, 'POST', '/licences/reviews', { comment: 'I should not be able to send this' })).status, 403, 'the IT administrator approves, the system administrator sends');
  // the review: maker cannot approve; ITADM first, then DIR
  const rev = await t.call(sys, 'POST', '/licences/reviews', { comment: 'Review of the end-to-end library and the open-source components' });
  assert.equal(rev.status, 202, JSON.stringify(rev.json));
  assert.equal((await t.call(sys, 'POST', '/licences/reviews', { comment: 'A second review at the same time' })).status, 409, 'one review at a time');
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, dir)).json.data.rows.find((x) => x.instance.id === rev.json.data.workflow.id), undefined, 'the director gets it only after the IT administrator');
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, sys)).json.data.rows.find((x) => x.instance.id === rev.json.data.workflow.id), undefined, 'the maker cannot approve');
  await act(t.api, itadm, rev.json.data.workflow.id);
  assert.equal((await t.call(aud, 'GET', '/licences')).json.data.approved, false, 'half approved is not approved');
  await act(t.api, dir, rev.json.data.workflow.id);
  const after2 = (await t.call(aud, 'GET', '/licences')).json.data;
  assert.equal(after2.approved, true);
  const byName = Object.fromEntries(after2.rows.map((r) => [r.component, r.status]));
  assert.equal(byName['libsignal (Signal Protocol)'], 'REJECTED');
  assert.equal(byName['@matrix-org/olm (Olm and Megolm)'], 'NOT_USED');
  assert.equal(byName['erp-e2e-v1 (company code over the platform WebCrypto API)'], 'APPROVED');
  assert.equal(after2.reviews[0].status, 'APPROVED');
  // the policy: still off until it is approved; the maker (system administrator) cannot approve it
  const prop = await t.call(sys, 'POST', '/policy/changes', POLICY());
  assert.equal(prop.status, 202, JSON.stringify(prop.json));
  assert.equal((await t.call(pd, 'GET', '/ready')).json.data.ready, false, 'not on before approval');
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, sys)).json.data.rows.find((x) => x.instance.id === prop.json.data.workflow.id), undefined);
  await act(t.api, itadm, prop.json.data.workflow.id);
  assert.equal((await t.call(pd, 'GET', '/ready')).json.data.ready, true);
  assert.equal((await t.call(pd, 'GET', '/ready')).json.data.canCreate, true);
  assert.equal((await t.call(se, 'GET', '/ready')).json.data.canCreate, false, 'a site engineer is not in the creator roles');
  // the register scan reads the project and keeps decisions
  const scan = await t.call(sys, 'POST', '/licences/scan');
  assert.equal(scan.status, 200);
  assert.ok(scan.json.data.added > 10);
  const csv = await t.api.raw('GET', `${S}/licences/export?status=TO_REVIEW`, aud);
  assert.equal(csv.status, 200);
  assert.match(csv.buffer.toString('utf8'), /Component,Version,Licence/);
  // a register entry's status never changes by editing it
  const edit = await t.call(sys, 'POST', '/licences', { component: 'libsignal (Signal Protocol)', version: '0.50', licence: 'AGPL-3.0-only', usage: 'Not used', obligations: 'Source offer', reason: 'Version noted for the record' });
  assert.equal(edit.status, 200);
  assert.equal((await t.call(aud, 'GET', '/licences')).json.data.rows.find((r) => r.component.startsWith('libsignal')).status, 'REJECTED');
});

test('T-01 FR-02 FR-03 BR-01 two devices per person: the database holds only ciphertext, and the right devices decrypt', async () => {
  const t = await setup();
  await t.enable();
  const words = 'TOP-SECRET-slurry-pump-rate-4711-INR';
  const a = await new Device(t, pd, 'Pooja phone').register();
  const b1 = await new Device(t, pm, 'Meera phone').register();
  const b2 = await new Device(t, pm, 'Meera laptop').register();
  // a conversation needs people with a device and a role the policy names
  assert.equal((await t.call(se, 'POST', '/conversations', { members: ['pd1'] })).status, 403, 'a site engineer may not start one');
  assert.equal((await t.call(pd, 'POST', '/conversations', { members: ['se1'] })).status, 422, 'se1 has no device');
  const made = await t.call(pd, 'POST', '/conversations', { members: ['pm1'] });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const conv = made.json.data.id;
  assert.equal((await t.call(pd, 'POST', '/conversations', { members: ['pm1'] })).json.data.created, false, 'the same pair has one secure conversation');
  // it is in the unified list, labelled secure, with no text
  const list = (await t.api.call('GET', '/api/v1/msg/conversations', { ...pm, headers: key('l') })).json.data.rows.find((c) => c.id === conv);
  assert.equal(list.secure.kind, 'ONE_TO_ONE');
  assert.equal(list.last.excerpt, 'Encrypted message');
  // the plain message API refuses to carry text into it
  const plain = await t.api.call('POST', `/api/v1/msg/conversations/${conv}/messages`, { ...pd, headers: key('p'), body: { body: words } });
  assert.equal(plain.status, 422);
  // send
  const sent = await a.send(conv, { v: 1, t: 'text', body: words });
  assert.equal(sent.r.status, 201, JSON.stringify(sent.r.json));
  assert.equal(sent.sealed.length, 2, 'one envelope for each device of the other person');
  assert.equal((await t.api.call('GET', '/api/v1/msg/conversations', { ...pm, headers: key('l') })).json.data.rows.find((c) => c.id === conv).unread, 1, 'one unread secure message');
  // T-01: look for the words in every column of every table of the database
  const texts = [words, 'slurry-pump', '4711'];
  const tables = t.api.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
  for (const table of tables) {
    const cols = t.api.db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    for (const col of cols) for (const needle of texts) {
      const hit = t.api.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE CAST("${col}" AS TEXT) LIKE ?`).get(`%${needle}%`).n;
      assert.equal(hit, 0, `${table}.${col} holds the words of a secure message`);
    }
  }
  const stored = t.api.db.prepare('SELECT ciphertext, recipient_user FROM sec_envelopes WHERE conversation_id = ?').all(conv);
  assert.equal(stored.length, 2);
  assert.ok(stored.every((r) => r.ciphertext.length > 100 && /^[A-Za-z0-9+/]+=*$/.test(r.ciphertext)), 'only encrypted text');
  // both devices of the other person read it; nobody else can
  const got1 = await b1.receive();
  const got2 = await b2.receive();
  assert.equal(got1[0].payload.body, words);
  assert.equal(got2[0].payload.body, words);
  assert.equal(got1[0].sender, 'pd1');
  // after delivery the ciphertext is gone, the delivery facts stay
  const after1 = t.api.db.prepare('SELECT ciphertext, delivered_at FROM sec_envelopes WHERE conversation_id = ?').all(conv);
  assert.ok(after1.every((r) => r.ciphertext === '' && r.delivered_at), 'ciphertext emptied once delivered');
  assert.equal((await b1.receive()).length, 0, 'nothing is delivered twice');
  // an envelope of one device cannot be opened by the other device of the same person
  const again = await a.send(conv, { v: 1, t: 'text', body: 'second' });
  const raw = t.api.db.prepare('SELECT * FROM sec_envelopes WHERE conversation_id = ? AND recipient_device_id = ? AND delivered_at IS NULL').get(conv, b1.id);
  await assert.rejects(decryptEnvelope({ device: { deviceId: b2.id, signedPrekeys: b2.signed, oneTimePrekeys: b2.onetime }, envelope: raw.ciphertext, senderIdentityKey: a.keys.identity.publicKey }), /another device/);
  await assert.rejects(decryptEnvelope({ device: { deviceId: b1.id, signedPrekeys: b2.signed, oneTimePrekeys: b2.onetime }, envelope: raw.ciphertext, senderIdentityKey: a.keys.identity.publicKey }), /pre-key|one-time|decrypt|operation/i, 'the keys of another device do not open it');
  // a forged sender is detected: the envelope is signed by the sender's device
  const other = await generateDeviceKeys({ oneTimeCount: 1 });
  await assert.rejects(decryptEnvelope({ device: { deviceId: b1.id, signedPrekeys: b1.signed, oneTimePrekeys: b1.onetime }, envelope: raw.ciphertext, senderIdentityKey: other.identity.publicKey }), /signature/);
  assert.equal((await b1.receive())[0].payload.body, 'second');
  assert.ok(again.r.status === 201);
  // a replay of the same message is not stored twice; an incomplete device list is refused with the devices expected
  const replay = await t.call(pd, 'POST', '/envelopes', { conversationId: conv, senderDeviceId: a.id, messageUid: again.uid, envelopes: again.sealed.map((e) => ({ recipientDeviceId: e.recipientDeviceId, ciphertext: e.ciphertext })) });
  assert.equal(replay.json.data.replay, true);
  const partial = await t.call(pd, 'POST', '/envelopes', { conversationId: conv, senderDeviceId: a.id, messageUid: `partial-${Date.now()}-abcdefgh`, envelopes: [{ recipientDeviceId: b1.id, ciphertext: again.sealed[0].ciphertext }] });
  assert.equal(partial.status, 409);
  // a non-member sees nothing and can post nothing
  const c = await new Device(t, dir, 'Director phone').register();
  assert.equal((await t.call(dir, 'GET', `/conversations/${conv}`)).status, 404);
  assert.equal((await t.call(dir, 'GET', `/conversations/${conv}/bundles?device=${c.id}`)).status, 404);
  assert.equal((await c.t.call(dir, 'POST', '/envelopes', { conversationId: conv, senderDeviceId: c.id, messageUid: `intruder-${Date.now()}-abcdefgh`, envelopes: [{ recipientDeviceId: b1.id, ciphertext: again.sealed[0].ciphertext }] })).status, 404);
  assert.equal((await t.call(dir, 'GET', `/envelopes?device=${b1.id}&since=0`)).status, 404, 'another person\'s device queue is not readable');
});

test('FR-03 FR-05 a secure group: every device of every member, disappearing messages, the purge job', async () => {
  const t = await setup();
  await t.enable();
  const a = await new Device(t, pd).register();
  const b = await new Device(t, pm).register();
  const d = await new Device(t, dir).register();
  const made = await t.call(pd, 'POST', '/conversations', { members: ['pm1', 'dir1'], title: 'Tender 14 pricing', disappearSeconds: 3600 });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal(made.json.data.kind, 'GROUP');
  const conv = made.json.data.id;
  assert.equal((await t.call(pd, 'POST', '/conversations', { members: ['pm1', 'dir1'], disappearSeconds: 7 })).status, 422, 'a time the policy does not allow');
  await a.send(conv, { v: 1, t: 'text', body: 'Quote the bridge at the floor price' });
  assert.equal((await b.receive())[0].payload.body, 'Quote the bridge at the floor price');
  assert.equal((await d.receive())[0].payload.body, 'Quote the bridge at the floor price');
  const exp = t.api.db.prepare('SELECT expires_at FROM sec_envelopes WHERE conversation_id = ? LIMIT 1').get(conv).expires_at;
  assert.ok(Date.parse(exp) > Date.now() && Date.parse(exp) <= Date.now() + 3_600_000 + 5000, 'expires an hour after sending');
  // the group's members cannot be changed through the Messages API (their keys decide who can read)
  assert.equal((await t.api.call('POST', `/api/v1/msg/conversations/${conv}/members`, { ...pd, headers: key('m'), body: { users: ['se1'] } })).status, 422);
  // disappearing time can be changed by a member within the policy
  assert.equal((await t.call(pm, 'PUT', `/conversations/${conv}/disappearing`, { seconds: 86_400 })).json.data.disappearSeconds, 86_400);
  assert.equal((await t.call(pm, 'PUT', `/conversations/${conv}/disappearing`, { seconds: 5 })).status, 422);
  // purge removes what has disappeared
  await a.send(conv, { v: 1, t: 'text', body: 'short lived' });
  t.api.db.prepare("UPDATE sec_envelopes SET expires_at = '2020-01-01T00:00:00.000Z' WHERE conversation_id = ? AND delivered_at IS NULL").run(conv);
  assert.equal((await b.receive()).length, 0, 'an expired envelope is not delivered');
  const { secureOf } = await import('../src/server/modules/sec/service.js');
  const purged = secureOf(t.api.db).purge(1);
  assert.ok(purged.expired >= 2, JSON.stringify(purged));
  t.api.db.prepare("UPDATE sec_envelopes SET delivered_at = '2020-01-01T00:00:00.000Z' WHERE delivered_at IS NOT NULL").run();
  assert.ok(secureOf(t.api.db).purge(1).metadata >= 2, 'delivery metadata is removed after the retention days');
});

test('T-02 FR-04 BR-02 a new or revoked device changes the safety number and the warning; a lost device is revoked and cannot send or receive', async () => {
  const t = await setup();
  await t.enable();
  const a = await new Device(t, pd).register();
  const b1 = await new Device(t, pm, 'Meera phone').register();
  const conv = (await t.call(pd, 'POST', '/conversations', { members: ['pm1'] })).json.data.id;
  // what pd sees of pm: the identity keys of every device
  const fpsOf = async (who, user) => (await t.call(who, 'GET', `/prekeys/${user}`)).json.data;
  const first = await fpsOf(pd, 'pm1');
  assert.equal(first.devices.length, 1);
  assert.ok(!first.devices[0].oneTimePrekey, 'looking at keys does not use them up');
  const mine = (await fpsOf(pd, 'pd1')).fingerprints;
  const n1 = await safetyNumber({ user: 'pd1', fingerprints: mine }, { user: 'pm1', fingerprints: first.fingerprints });
  const n1b = await safetyNumber({ user: 'pm1', fingerprints: first.fingerprints }, { user: 'pd1', fingerprints: mine });
  assert.equal(n1.digits, n1b.digits, 'both people see the same 60 digits');
  assert.equal(n1.digits.length, 60);
  // pd's device remembers (and verifies) what it saw
  const trusted = { fingerprints: first.fingerprints, verified: true };
  assert.equal(compareTrust(trusted, first.fingerprints).state, 'same');
  assert.equal(compareTrust(undefined, first.fingerprints).state, 'new');
  const events0 = t.events.length;
  // Meera sets up a new device: her set of devices changes, so the number changes and the old trust is warned about
  const b2 = await new Device(t, pm, 'Meera new phone').register();
  assert.ok(t.events.slice(events0).some((e) => e.type === 'sec.keys.changed' && e.room === 'user:pd1'), 'the other member is told in real time (ids only)');
  const second = await fpsOf(pd, 'pm1');
  assert.equal(second.devices.length, 2);
  const warn = compareTrust(trusted, second.fingerprints);
  assert.equal(warn.state, 'changed');
  assert.equal(warn.added.length, 1);
  assert.equal(warn.verified, true, 'it was verified before, so the warning is the strong one');
  const n2 = await safetyNumber({ user: 'pd1', fingerprints: mine }, { user: 'pm1', fingerprints: second.fingerprints });
  assert.notEqual(n2.digits, n1.digits, 'the safety number changed');
  // a sender that does not know the new device is refused with the devices expected (nothing is sent without it)
  const old = await encryptMessage({ sender: { deviceId: a.id, identityPrivateKey: a.keys.identity.privateKey }, messageUid: `stale-${Date.now()}-abcdefgh`, payload: { v: 1, t: 'text', body: 'stale' }, recipients: first.devices.map((d) => ({ ...d, oneTimePrekey: undefined })) });
  const stale = await t.call(pd, 'POST', '/envelopes', { conversationId: conv, senderDeviceId: a.id, messageUid: `stale-${Date.now()}-abcdefgh`, envelopes: old.map((e) => ({ recipientDeviceId: e.recipientDeviceId, ciphertext: e.ciphertext })) });
  assert.equal(stale.status, 409);
  // Meera loses her first phone: she (or the IT administrator) revokes it
  const queued = await a.send(conv, { v: 1, t: 'text', body: 'before the loss' });
  assert.equal(queued.r.status, 201);
  assert.equal((await t.call(se, 'POST', `/devices/${b1.id}/revoke`, { reason: 'I am not the owner' })).status, 404, 'someone else cannot revoke it');
  assert.equal((await t.call(pd, 'GET', '/devices/all')).status, 403);
  const rev = await t.call(itadm, 'POST', `/devices/${b1.id}/revoke`, { reason: 'Phone lost on the site visit' });
  assert.equal(rev.status, 200, JSON.stringify(rev.json));
  assert.equal(rev.json.data.undeliveredDropped, 1, 'what was waiting for the lost device is dropped');
  assert.equal((await t.call(pm, 'GET', `/envelopes?device=${b1.id}&since=0`)).status, 409, 'the revoked device is out of every session');
  assert.equal((await t.call(pm, 'POST', '/devices/' + b1.id + '/revoke', { reason: 'Again after the loss' })).status, 409);
  const third = await fpsOf(pd, 'pm1');
  assert.deepEqual(third.devices.map((d) => d.deviceId), [b2.id]);
  assert.equal(compareTrust({ fingerprints: second.fingerprints, verified: true }, third.fingerprints).state, 'changed');
  // the new device reads what comes after; what was on the lost phone is not recoverable by design
  await a.send(conv, { v: 1, t: 'text', body: 'after the loss' });
  const got = await b2.receive();
  assert.deepEqual(got.map((m) => m.payload.body), ['before the loss', 'after the loss'], 'the new device gets what was sent after it registered');
  const all = (await t.call(itadm, 'GET', '/devices/all?user=pm1')).json.data.rows;
  assert.equal(all.length, 2);
  assert.ok(all.find((d) => d.id === b1.id).revokedAt);
  assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM sec_prekeys WHERE device_id = ?').get(b1.id).n, 0, 'its pre-keys are gone');
  // the number of devices is limited by the policy
  await new Device(t, pm, 'Third').register();
  await new Device(t, pm, 'Fourth').register();
  const cap = await t.call(pm, 'POST', '/devices', registrationBody(await generateDeviceKeys({ oneTimeCount: 1 }), { name: 'Fifth', platform: 'test' }));
  assert.equal(cap.status, 422, 'at most 3 active devices in this policy');
  // a signed pre-key that was not signed by the device is refused at registration
  const keys = await generateDeviceKeys({ oneTimeCount: 1 });
  const evil = await generateDeviceKeys({ oneTimeCount: 1 });
  const bad = registrationBody(keys, { name: 'Forged', platform: 'test' });
  bad.signedPrekey = { ...bad.signedPrekey, signature: (await makeSignedPrekey(evil.identity.privateKey, 1)).signature };
  assert.equal((await t.call(pd, 'POST', '/devices', bad)).status, 422);
  // fingerprints are stable
  assert.equal(await fingerprint(a.keys.identity.publicKey), (await fpsOf(pd, 'pd1')).devices[0].fingerprint);
  // top up the one-time keys of a device
  const more = await makeOneTimePrekeys(100, 3);
  const up = await t.call(pd, 'POST', `/devices/${a.id}/prekeys`, { oneTimePrekeys: more.map((k) => ({ id: k.id, publicKey: k.publicKey })) });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.ok(up.json.data.oneTime >= 3);
});

test('T-03 FR-06 an attachment is encrypted before upload: the stored file is unreadable and only a member device can open it', async () => {
  const t = await setup();
  await t.enable();
  const a = await new Device(t, pd).register();
  const b = await new Device(t, pm).register();
  const outsider = await new Device(t, dir).register();
  const conv = (await t.call(pd, 'POST', '/conversations', { members: ['pm1'] })).json.data.id;
  const drawing = new TextEncoder().encode('%PDF-1.7 BRIDGE-DRAWING-B14-REV-C confidential pier loads');
  const enc = await encryptAttachment(drawing);
  // what is uploaded to the file service: a marker and ciphertext; it is accepted as a .enc file, a real document under that name is not
  const upload = new Uint8Array([...new TextEncoder().encode('ERPE2E01'), ...enc.ciphertext]);
  assert.equal(checkType('drawing.enc', Buffer.from(upload)).ok, true);
  assert.equal(checkType('drawing.enc', Buffer.from(drawing)).ok, false, 'a readable file under the .enc name is refused');
  assert.ok(!Buffer.from(upload).includes(Buffer.from('BRIDGE-DRAWING')), 'the uploaded bytes do not contain the content');
  // the key travels inside the encrypted message
  await a.send(conv, { v: 1, t: 'file', name: 'drawing.pdf', mime: 'application/pdf', fileId: 4242, key: enc.key, iv: enc.iv, sha256: enc.sha256, size: enc.size });
  const got = (await b.receive())[0].payload;
  const plain = await decryptAttachment(upload.slice(8), got);
  assert.equal(new TextDecoder().decode(plain), new TextDecoder().decode(drawing));
  // a device that is not in the conversation has neither the message nor the key: the file cannot be opened
  assert.equal((await t.call(dir, 'GET', `/envelopes?device=${outsider.id}&since=0`)).json.data.rows.length, 0);
  await assert.rejects(decryptAttachment(upload.slice(8), { key: toB64(new Uint8Array(32)), iv: enc.iv, sha256: enc.sha256 }));
  // a flipped byte is detected
  const bent = upload.slice(8); bent[10] ^= 1;
  await assert.rejects(decryptAttachment(bent, got));
  // a record card is drawn for the reader: a person who may not open the record sees "restricted"
  t.api.db.prepare("INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, created_by, source_type) VALUES ('x', 'x', 0, 't', 't')").run();
  const card = await t.call(pm, 'GET', '/cards?entity=sample_doc&id=1');
  assert.equal(card.status, 200);
  assert.equal(card.json.data.restricted, true);
  assert.equal((await t.call(pm, 'GET', '/cards?entity=nothing_here&id=1')).status, 404);
});

test('FR-07 AC-04 the policy: dated, approved by a second person, with history; roles, devices and licence rights are separate', async () => {
  const t = await setup();
  await t.enable();
  assert.equal((await t.call(se, 'GET', '/policy')).status, 403);
  assert.equal((await t.call(pd, 'POST', '/policy/changes', POLICY())).status, 403, 'only the system administrator proposes');
  assert.equal((await t.call(aud, 'GET', '/policy')).status, 200);
  const first = await t.call(sys, 'POST', '/policy/changes', POLICY({ creatorRoles: ['DIR'], maxGroupMembers: 5, reason: 'Only the director may start them' }));
  assert.equal(first.status, 202);
  assert.equal((await t.call(sys, 'POST', '/policy/changes', POLICY())).status, 409, 'one change at a time');
  assert.equal((await t.call(sys, 'GET', '/policy')).json.data.pending.version, 2);
  await act(t.api, dir, first.json.data.workflow.id);
  const now = (await t.call(sys, 'GET', '/policy')).json.data;
  assert.deepEqual(now.policy.creatorRoles, ['DIR']);
  assert.equal(now.policy.maxGroupMembers, 5);
  assert.equal(now.history.length, 2);
  assert.equal((await t.call(pd, 'GET', '/ready')).json.data.canCreate, false, 'pd lost the right');
  // a future date stays scheduled; a rejected change changes nothing
  const later = await t.call(sys, 'POST', '/policy/changes', POLICY({ effectiveFrom: new Date(Date.now() + 5.5 * 3_600_000 + 3 * 86_400_000).toISOString().slice(0, 10) }));
  await act(t.api, itadm, later.json.data.workflow.id);
  assert.equal((await t.call(sys, 'GET', '/policy')).json.data.history[0].status, 'SCHEDULED');
  assert.deepEqual((await t.call(sys, 'GET', '/policy')).json.data.policy.creatorRoles, ['DIR']);
  assert.equal((await t.call(sys, 'POST', '/policy/changes', POLICY({ reason: 'x' }))).status, 400, 'a reason is required');
  assert.equal((await t.call(sys, 'POST', '/policy/changes', POLICY({ defaultDisappearSeconds: 5 }))).status, 400, 'the default must be an allowed time');
  assert.equal((await t.call(sys, 'POST', '/policy/changes', POLICY({ effectiveFrom: '2020-01-01' }))).status, 400, 'not in the past');
  const exp = await t.call(aud, 'GET', '/policy/export');
  assert.equal(exp.status, 200);
  assert.ok(exp.json.data.history.length >= 3);
});

test('AC-04 isolation: another company sees none of the devices, keys or conversations', async () => {
  const t = await setup();
  await t.enable();
  await new Device(t, pd).register();
  await new Device(t, pm).register();
  const conv = (await t.call(pd, 'POST', '/conversations', { members: ['pm1'] })).json.data.id;
  t.api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (2, 'OTHER', 'Other Pvt Ltd', 'Other', 't', 'test')").run();
  t.api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (2, 'other1', 'Other PD', '[\"PD\"]', 'o@example.com')").run();
  const foreign = { roles: 'PD', user: 'other1', company: '2' };
  assert.equal((await t.call(foreign, 'GET', `/conversations/${conv}`)).status, 404);
  assert.equal((await t.call(foreign, 'GET', '/prekeys/pm1')).status, 422, 'secure messaging is not switched on for the other company, and it has no such person');
  assert.equal((await t.call(foreign, 'GET', '/devices')).json.data.rows.length, 0);
  assert.equal((await t.call({ ...foreign, roles: 'ITADM' }, 'GET', '/devices/all')).json.data.rows.length, 0);
  // a person who is neither allowed to start a secure conversation nor in one cannot pull someone's keys
  assert.equal((await t.call(se, 'GET', '/prekeys/pm1')).status, 404);
  // without the feature flag the routes are not there
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.msg.p0503'").run();
  assert.equal((await t.call(pd, 'GET', '/ready')).status, 404);
});
