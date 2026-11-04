import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { objectTypes } from '../../platform/objects/index.js';
import { realtimeOf } from '../../platform/realtime/index.js';
import { fingerprint, fromB64, verifySignedPrekey } from '../../../shared/e2e.js';
import { messagesOf } from '../msg/messages.js';
import { activePolicy, licenceApproved, secureReady } from './governance.js';

// The secure messaging service (part 05.03): devices and their public keys, pre-keys, secure conversations and the encrypted envelopes. The server never holds a private key and never sees plaintext (BR-01): an
// envelope is an opaque text it passes on, and when the receiving device has fetched it the text is emptied; only the metadata needed for delivery stays for the retention days of the policy.
const nowIso = () => new Date().toISOString();
const MAX_ENVELOPE_CHARS = 262_144;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const keyId = (id) => (/^\d+$/.test(String(id)) ? Number(id) : String(id));

export function createSecureService({ db }) {
  const authz = authzOf(db);
  const hub = realtimeOf(db);
  const msg = () => messagesOf(db).internals;
  const anywhere = (actor, key) => authz.check(actor, key).allowed;
  const ready = (actor) => {
    if (!secureReady(db, actor.companyId)) {
      throw unprocessable(licenceApproved(db, actor.companyId)
        ? 'Secure messaging is not switched on for your company (Secure Messaging Policy).'
        : 'Secure messaging is not available yet: the open-source licence review of the end-to-end library has not been approved (Open-Source Licence Register).');
    }
  };
  const deviceView = (d) => ({ id: d.id, deviceNo: d.device_no, name: d.device_name, platform: d.platform, fingerprint: d.fingerprint, registeredAt: d.created_at, lastSeenAt: d.last_seen_at, revokedAt: d.revoked_at, revokedBy: d.revoked_by, revokeReason: d.revoke_reason, user: d.user_ref });
  const activeDevices = (companyId, user) => db.prepare('SELECT * FROM sec_devices WHERE company_id = ? AND lower(user_ref) = lower(?) AND revoked_at IS NULL AND is_active = 1 ORDER BY device_no').all(companyId, user);
  const ownDevice = (actor, id) => {
    const d = db.prepare('SELECT * FROM sec_devices WHERE id = ? AND company_id = ? AND is_active = 1').get(Number(id), actor.companyId);
    if (!d || d.user_ref.toLowerCase() !== actor.user.toLowerCase()) throw notFound('That device does not exist, or it is not yours.');
    return d;
  };
  const secureConv = (actor, id) => {
    const c = msg().must(actor, id);
    const s = db.prepare('SELECT * FROM sec_conversations WHERE conversation_id = ? AND is_active = 1').get(c.id);
    if (!s) throw notFound('That is not a secure conversation.');
    return { c, s };
  };
  const membersOf = (convId) => db.prepare('SELECT user_ref FROM msg_members WHERE conversation_id = ? AND left_at IS NULL AND is_active = 1').all(convId).map((r) => r.user_ref);
  /** Tells the people who share a secure conversation with this person that their keys changed (ids only: the screens fetch the devices again and compare). */
  const keysChanged = (companyId, user, what) => {
    const rooms = new Set();
    for (const r of db.prepare("SELECT m2.user_ref FROM sec_conversations s JOIN msg_members m1 ON m1.conversation_id = s.conversation_id AND lower(m1.user_ref) = lower(?) AND m1.left_at IS NULL JOIN msg_members m2 ON m2.conversation_id = s.conversation_id AND m2.left_at IS NULL WHERE s.company_id = ? AND s.is_active = 1").all(user, companyId)) rooms.add(`user:${r.user_ref}`);
    rooms.add(`user:${user}`);
    hub.publish({ companyId, rooms: [...rooms], type: 'sec.keys.changed', entity: 'sec_device', entityId: 0, data: { user, what } });
  };
  const bundleOf = (d, consume) => {
    const spk = db.prepare('SELECT * FROM sec_prekeys WHERE device_id = ? AND signed = 1 AND is_active = 1 ORDER BY key_id DESC LIMIT 1').get(d.id);
    let otk = null;
    if (consume) {
      const k = db.prepare('SELECT * FROM sec_prekeys WHERE device_id = ? AND signed = 0 AND used_at IS NULL AND is_active = 1 ORDER BY key_id LIMIT 1').get(d.id);
      if (k) { db.prepare('UPDATE sec_prekeys SET used_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(nowIso(), nowIso(), k.id); otk = { id: k.key_id, publicKey: k.public_key }; }
    }
    return { deviceId: d.id, deviceNo: d.device_no, user: d.user_ref, registrationId: d.registration_id, identityKey: d.identity_key, fingerprint: d.fingerprint, signedPrekey: spk ? { id: spk.key_id, publicKey: spk.public_key, signature: spk.signature } : null, ...(otk ? { oneTimePrekey: otk } : {}) };
  };

  const devices = {
    /** A device registers its PUBLIC keys. The signed pre-key must be signed by the identity key (checked here and again by every sender). */
    async register(actor, b) {
      ready(actor);
      const policy = activePolicy(db, actor.companyId);
      for (const [what, v, len] of [['identity key', b.identityKey, 65], ['signed pre-key', b.signedPrekey.publicKey, 65]]) {
        let bytes; try { bytes = fromB64(v); } catch { bytes = new Uint8Array(0); }
        if (bytes.length !== len || bytes[0] !== 4) throw unprocessable(`The ${what} is not a P-256 public key.`, [{ field: what === 'identity key' ? 'identityKey' : 'signedPrekey', message: 'not a P-256 public key' }]);
      }
      if (!(await verifySignedPrekey(b.identityKey, b.signedPrekey))) throw unprocessable('The signed pre-key is not signed by the identity key of this device.', [{ field: 'signedPrekey', message: 'the signature does not match' }]);
      for (const k of b.oneTimePrekeys) if (fromB64(k.publicKey).length !== 65) throw unprocessable('A one-time pre-key is not a P-256 public key.');
      const fp = await fingerprint(b.identityKey);
      return transaction(db, () => {
        if (activeDevices(actor.companyId, actor.user).length >= policy.maxDevicesPerUser) throw unprocessable(`You already have ${policy.maxDevicesPerUser} devices. Revoke one you no longer use first.`);
        if (db.prepare('SELECT 1 FROM sec_devices WHERE company_id = ? AND fingerprint = ?').get(actor.companyId, fp)) throw conflict('That device key is already registered.');
        const no = (db.prepare('SELECT MAX(device_no) AS n FROM sec_devices WHERE company_id = ? AND lower(user_ref) = lower(?)').get(actor.companyId, actor.user).n ?? 0) + 1;
        const id = Number(db.prepare("INSERT INTO sec_devices (company_id, user_ref, device_no, device_name, platform, registration_id, identity_key, fingerprint, last_seen_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sec_device')")
          .run(actor.companyId, actor.user, no, b.name, b.platform ?? null, b.registrationId, b.identityKey, fp, nowIso(), actor.user).lastInsertRowid);
        db.prepare("INSERT INTO sec_prekeys (company_id, device_id, key_id, public_key, signature, signed, created_by, source_type) VALUES (?, ?, ?, ?, ?, 1, ?, 'sec_prekey')").run(actor.companyId, id, b.signedPrekey.id, b.signedPrekey.publicKey, b.signedPrekey.signature, actor.user);
        for (const k of b.oneTimePrekeys) db.prepare("INSERT INTO sec_prekeys (company_id, device_id, key_id, public_key, signed, created_by, source_type) VALUES (?, ?, ?, ?, 0, ?, 'sec_prekey')").run(actor.companyId, id, k.id, k.publicKey, actor.user);
        writeAudit(db, { entity: 'sec_device', entityId: id, action: 'register', newValues: { deviceNo: no, name: b.name, fingerprint: fp }, actor: actor.user, companyId: actor.companyId });
        keysChanged(actor.companyId, actor.user, 'device_added');
        return { id, deviceNo: no, fingerprint: fp };
      });
    },
    mine(actor) { return { rows: db.prepare('SELECT * FROM sec_devices WHERE company_id = ? AND lower(user_ref) = lower(?) AND is_active = 1 ORDER BY device_no').all(actor.companyId, actor.user).map(deviceView) }; },
    /** For the IT administrator: the devices of everyone (public data only), to revoke a lost one. */
    all(actor, { user } = {}) {
      if (!anywhere(actor, 'sec.device.manage')) throw forbidden('You may not see the devices of other people (permission sec.device.manage).');
      const rows = user ? db.prepare('SELECT * FROM sec_devices WHERE company_id = ? AND lower(user_ref) = lower(?) AND is_active = 1 ORDER BY user_ref, device_no').all(actor.companyId, user)
        : db.prepare('SELECT * FROM sec_devices WHERE company_id = ? AND is_active = 1 ORDER BY user_ref, device_no LIMIT 500').all(actor.companyId);
      return { rows: rows.map(deviceView) };
    },
    /** A lost device: its keys are removed from every future session (BR-02); what was on it cannot be recovered, by design. */
    revoke(actor, id, reason) {
      const d = db.prepare('SELECT * FROM sec_devices WHERE id = ? AND company_id = ? AND is_active = 1').get(Number(id), actor.companyId);
      const own = d && d.user_ref.toLowerCase() === actor.user.toLowerCase();
      if (!d || (!own && !anywhere(actor, 'sec.device.manage'))) throw notFound('That device does not exist, or you may not revoke it.');
      if (d.revoked_at) throw conflict('That device is already revoked.');
      return transaction(db, () => {
        db.prepare('UPDATE sec_devices SET revoked_at = ?, revoked_by = ?, revoke_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, reason, actor.user, nowIso(), d.id);
        db.prepare('DELETE FROM sec_prekeys WHERE device_id = ?').run(d.id);
        const dropped = db.prepare('DELETE FROM sec_envelopes WHERE recipient_device_id = ? AND delivered_at IS NULL').run(d.id).changes;
        writeAudit(db, { entity: 'sec_device', entityId: d.id, action: 'revoke', oldValues: { fingerprint: d.fingerprint }, newValues: { revokedBy: actor.user, undeliveredDropped: dropped }, actor: actor.user, companyId: actor.companyId, reason });
        keysChanged(actor.companyId, d.user_ref, 'device_revoked');
        return { id: d.id, revoked: true, undeliveredDropped: dropped };
      });
    },
  };

  const prekeys = {
    /** More one-time pre-keys (and, when the device rotates it, a new signed pre-key) for one of the person's own devices. */
    async upload(actor, deviceId, b) {
      ready(actor);
      const d = ownDevice(actor, deviceId);
      if (d.revoked_at) throw conflict('That device was revoked.');
      if (b.signedPrekey && !(await verifySignedPrekey(d.identity_key, b.signedPrekey))) throw unprocessable('The signed pre-key is not signed by the identity key of this device.');
      return transaction(db, () => {
        if (b.signedPrekey) db.prepare("INSERT INTO sec_prekeys (company_id, device_id, key_id, public_key, signature, signed, created_by, source_type) VALUES (?, ?, ?, ?, ?, 1, ?, 'sec_prekey')").run(actor.companyId, d.id, b.signedPrekey.id, b.signedPrekey.publicKey, b.signedPrekey.signature, actor.user);
        for (const k of b.oneTimePrekeys ?? []) db.prepare("INSERT OR IGNORE INTO sec_prekeys (company_id, device_id, key_id, public_key, signed, created_by, source_type) VALUES (?, ?, ?, ?, 0, ?, 'sec_prekey')").run(actor.companyId, d.id, k.id, k.publicKey, actor.user);
        return prekeys.count(actor, d.id);
      });
    },
    count(actor, deviceId) { const d = ownDevice(actor, deviceId); return { deviceId: d.id, oneTime: db.prepare('SELECT COUNT(*) AS n FROM sec_prekeys WHERE device_id = ? AND signed = 0 AND used_at IS NULL AND is_active = 1').get(d.id).n, highestId: db.prepare('SELECT MAX(key_id) AS n FROM sec_prekeys WHERE device_id = ?').get(d.id).n ?? 0 }; },
    /** The keys of a person's devices. Only people who may start a secure conversation with them, or already share one, can ask; a one-time key is used up only when `consume` is on. */
    bundle(actor, user, { consume = false } = {}) {
      ready(actor);
      const u = db.prepare("SELECT username, display_name FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND status = 'ACTIVE' AND is_active = 1").get(actor.companyId, user);
      if (!u) throw notFound('That person does not exist.');
      const self = u.username.toLowerCase() === actor.user.toLowerCase();
      const shared = db.prepare("SELECT 1 FROM sec_conversations s JOIN msg_members a ON a.conversation_id = s.conversation_id AND lower(a.user_ref) = lower(?) AND a.left_at IS NULL JOIN msg_members b ON b.conversation_id = s.conversation_id AND lower(b.user_ref) = lower(?) AND b.left_at IS NULL WHERE s.company_id = ? AND s.is_active = 1").get(actor.user, u.username, actor.companyId);
      if (!self && !shared && !conversations.mayCreate(actor)) throw notFound('That person does not exist.');
      return transaction(db, () => {
        const rows = activeDevices(actor.companyId, u.username).map((d) => bundleOf(d, consume));
        return { user: u.username, name: u.display_name, devices: rows, fingerprints: rows.map((r) => r.fingerprint) };
      });
    },
  };

  const conversations = {
    mayCreate(actor) {
      const roles = new Set((actor.roles ?? []).map((r) => String(r).toUpperCase()));
      return activePolicy(db, actor.companyId).creatorRoles.some((r) => roles.has(r));
    },
    create(actor, b) {
      ready(actor);
      const policy = activePolicy(db, actor.companyId);
      if (!conversations.mayCreate(actor)) throw forbidden(`Your role may not start secure conversations (Secure Messaging Policy: ${policy.creatorRoles.join(', ') || 'no role'}).`);
      const others = [...new Set(b.members.map((u) => u.trim()).filter(Boolean))].filter((u) => u.toLowerCase() !== actor.user.toLowerCase());
      if (!others.length) throw unprocessable('Choose at least one other person.', [{ field: 'members', message: 'choose someone' }]);
      if (others.length + 1 > policy.maxGroupMembers) throw unprocessable(`A secure conversation can have at most ${policy.maxGroupMembers} people.`, [{ field: 'members', message: `at most ${policy.maxGroupMembers} people` }]);
      const disappear = b.disappearSeconds ?? policy.defaultDisappearSeconds;
      if (!policy.allowedDisappearSeconds.includes(disappear)) throw unprocessable('That disappearing time is not allowed by the policy.', [{ field: 'disappearSeconds', message: 'not allowed' }]);
      if (!activeDevices(actor.companyId, actor.user).length) throw unprocessable('Set up secure messaging on this device first (it has no keys yet).');
      const users = [];
      for (const u of others) {
        const row = db.prepare("SELECT username FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND status = 'ACTIVE' AND is_active = 1").get(actor.companyId, u);
        if (!row) throw unprocessable(`${u} is not an active person of your company.`, [{ field: 'members', message: `${u} is not an active person` }]);
        if (!activeDevices(actor.companyId, row.username).length) throw unprocessable(`${row.username} has not set up secure messaging on any device yet, so they cannot receive encrypted messages.`, [{ field: 'members', message: `${row.username} has no secure device` }]);
        users.push(row.username);
      }
      const kind = users.length === 1 ? 'ONE_TO_ONE' : 'GROUP';
      const pair = kind === 'ONE_TO_ONE' ? [actor.user, users[0]].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase())).join('|') : null;
      return transaction(db, () => {
        if (pair) {
          const ex = db.prepare('SELECT * FROM sec_conversations WHERE company_id = ? AND pair_key = ? AND is_active = 1').get(actor.companyId, pair);
          if (ex) { msg().must(actor, ex.conversation_id); return { id: ex.conversation_id, created: false }; }
        }
        const title = b.title?.trim() || `Secure: ${[actor.user, ...users].join(', ')}`.slice(0, 120);
        const made = messagesOf(db).conversations.create(actor, { type: 'GROUP', title, members: users });
        db.prepare("INSERT INTO sec_conversations (company_id, conversation_id, kind, pair_key, disappear_seconds, policy_version, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'sec_conversation')").run(actor.companyId, made.id, kind, pair, disappear, policy.version, actor.user);
        writeAudit(db, { entity: 'sec_conversation', entityId: made.id, action: 'create', newValues: { kind, members: users.length + 1, disappearSeconds: disappear }, actor: actor.user, companyId: actor.companyId });
        return { id: made.id, created: true, kind };
      });
    },
    get(actor, id) {
      const { c, s } = secureConv(actor, id);
      return { id: c.id, kind: s.kind, disappearSeconds: s.disappear_seconds, members: membersOf(c.id).map((u) => ({ user: u, name: msg().nameOf(actor.companyId, u) })), allowedDisappearSeconds: activePolicy(db, actor.companyId).allowedDisappearSeconds, policy: (({ allowAttachments, maxAttachmentMb, screenshotWarning }) => ({ allowAttachments, maxAttachmentMb, screenshotWarning }))(activePolicy(db, actor.companyId)) };
    },
    /** The keys of every device of every member except the sender's own device: what the sender encrypts to. One-time pre-keys are used up here. */
    bundles(actor, id, senderDeviceId) {
      ready(actor);
      const { c } = secureConv(actor, id);
      const me = ownDevice(actor, senderDeviceId);
      if (me.revoked_at) throw conflict('This device was revoked: it can no longer send. Set it up again.');
      return transaction(db, () => {
        const members = membersOf(c.id);
        const rows = [];
        for (const u of members) for (const d of activeDevices(actor.companyId, u)) if (d.id !== me.id) rows.push({ ...bundleOf(d, true), name: msg().nameOf(actor.companyId, u) });
        return { conversationId: c.id, devices: rows, missing: members.filter((u) => !activeDevices(actor.companyId, u).length) };
      });
    },
    setDisappear(actor, id, seconds) {
      const { c, s } = secureConv(actor, id);
      if (!activePolicy(db, actor.companyId).allowedDisappearSeconds.includes(seconds)) throw unprocessable('That disappearing time is not allowed by the policy.', [{ field: 'seconds', message: 'not allowed' }]);
      db.prepare('UPDATE sec_conversations SET disappear_seconds = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(seconds, actor.user, nowIso(), s.id);
      writeAudit(db, { entity: 'sec_conversation', entityId: c.id, action: 'disappearing', oldValues: { seconds: s.disappear_seconds }, newValues: { seconds }, actor: actor.user, companyId: actor.companyId });
      hub.publish({ companyId: actor.companyId, rooms: membersOf(c.id).map((u) => `user:${u}`), type: 'sec.conversation.updated', entity: 'sec_conversation', entityId: c.id, data: { conversationId: c.id, what: 'disappearing' } });
      return { id: c.id, disappearSeconds: seconds };
    },
  };

  const envelopes = {
    /**
     * Stores the envelopes of one message: one per device of every member except the sending device. A sender that does not know a new or revoked device gets 409 with the devices that are expected, so the
     * message is never sent without a device that should read it and never to a device that was revoked. The service cannot read any envelope.
     */
    send(actor, b) {
      ready(actor);
      const { c, s } = secureConv(actor, b.conversationId);
      const me = ownDevice(actor, b.senderDeviceId);
      if (me.revoked_at) throw conflict('This device was revoked: it can no longer send.');
      const expected = new Map();
      for (const u of membersOf(c.id)) for (const d of activeDevices(actor.companyId, u)) if (d.id !== me.id) expected.set(d.id, d);
      const got = new Map(b.envelopes.map((e) => [e.recipientDeviceId, e]));
      if (got.size !== b.envelopes.length) throw unprocessable('A device appears twice.');
      const missing = [...expected.keys()].filter((i) => !got.has(i));
      const extra = [...got.keys()].filter((i) => !expected.has(i));
      if (missing.length || extra.length) throw conflict('The devices of this conversation changed. Fetch the keys again and encrypt for the current devices.', [{ field: 'envelopes', message: `missing ${missing.join(',') || 'none'}; not allowed ${extra.join(',') || 'none'}` }]);
      for (const e of b.envelopes) if (e.ciphertext.length > MAX_ENVELOPE_CHARS || !B64.test(e.ciphertext)) throw unprocessable('An envelope is not valid encrypted text.', [{ field: 'envelopes', message: 'not valid encrypted text' }]);
      return transaction(db, () => {
        const have = db.prepare('SELECT COUNT(*) AS n FROM sec_envelopes WHERE conversation_id = ? AND message_uid = ? AND sender_device_id = ?').get(c.id, b.messageUid, me.id).n;
        if (have === b.envelopes.length) return { messageUid: b.messageUid, stored: have, replay: true };
        if (have) throw conflict('Part of this message was stored already.');
        const at = nowIso();
        const expires = s.disappear_seconds ? new Date(Date.now() + s.disappear_seconds * 1000).toISOString() : null;
        for (const e of b.envelopes) {
          const d = expected.get(e.recipientDeviceId);
          db.prepare("INSERT INTO sec_envelopes (company_id, conversation_id, message_uid, sender_user, sender_device_id, recipient_user, recipient_device_id, ciphertext, size_bytes, expires_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sec_envelope')")
            .run(actor.companyId, c.id, b.messageUid, actor.user, me.id, d.user_ref, d.id, e.ciphertext, e.ciphertext.length, expires, actor.user);
        }
        msg().bumpActivity(c.id, at);
        writeAudit(db, { entity: 'sec_envelope', entityId: c.id, action: 'send', newValues: { conversationId: c.id, messageUid: b.messageUid, devices: b.envelopes.length }, actor: actor.user, companyId: actor.companyId });
        const rooms = [...new Set([...expected.values()].map((d) => `user:${d.user_ref}`))];
        hub.publish({ companyId: actor.companyId, rooms, type: 'sec.envelope.created', entity: 'sec_conversation', entityId: c.id, data: { conversationId: c.id } });
        msg().touchUsers(actor.companyId, c.id, 'secure');
        return { messageUid: b.messageUid, stored: b.envelopes.length, replay: false };
      });
    },
    /** The envelopes waiting for one of the person's own devices, oldest first, with the identity of the sending device so the receiver can check the signature. */
    fetch(actor, { deviceId, since, limit }) {
      const d = ownDevice(actor, deviceId);
      if (d.revoked_at) throw conflict('This device was revoked.');
      db.prepare('UPDATE sec_devices SET last_seen_at = ? WHERE id = ?').run(nowIso(), d.id);
      const rows = db.prepare(`SELECT e.id, e.conversation_id, e.message_uid, e.sender_user, e.sender_device_id, e.ciphertext, e.created_at, e.expires_at, sd.identity_key, sd.fingerprint, sd.device_no
        FROM sec_envelopes e JOIN sec_devices sd ON sd.id = e.sender_device_id WHERE e.recipient_device_id = ? AND e.id > ? AND e.delivered_at IS NULL AND e.is_active = 1 AND (e.expires_at IS NULL OR e.expires_at > ?) ORDER BY e.id LIMIT ?`).all(d.id, since, nowIso(), limit + 1);
      return { rows: rows.slice(0, limit).map((r) => ({ id: r.id, conversationId: r.conversation_id, messageUid: r.message_uid, sender: r.sender_user, senderDeviceId: r.sender_device_id, senderIdentityKey: r.identity_key, senderFingerprint: r.fingerprint, ciphertext: r.ciphertext, createdAt: r.created_at, expiresAt: r.expires_at })), hasMore: rows.length > limit };
    },
    /** The device has the envelopes: the ciphertext is emptied here; the delivery metadata stays for the retention days. */
    ack(actor, { deviceId, ids }) {
      const d = ownDevice(actor, deviceId);
      let n = 0;
      transaction(db, () => { for (const id of ids) n += db.prepare("UPDATE sec_envelopes SET ciphertext = '', delivered_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND recipient_device_id = ? AND delivered_at IS NULL").run(nowIso(), nowIso(), id, d.id).changes; });
      return { acked: n };
    },
  };

  /** A record card for a message of a secure conversation: it is drawn here from the record's own permission, so the card says "restricted" to a person who may not open the record, whatever the message said. */
  const card = (actor, entity, id) => {
    const def = objectTypes.get(entity);
    if (!def) throw notFound(`There is no record type called ${entity}.`);
    const restricted = { restricted: true, entity, entityId: String(id) };
    if (!authz.check(actor, def.permission).allowed) return restricted;
    const access = def.access(db, actor, keyId(id));
    if (!access) return restricted;
    const sum = def.summary ? def.summary(db, actor, keyId(id)) : null;
    return { restricted: false, entity, entityId: String(id), label: sum?.label ?? `${def.label} ${id}`, status: sum?.status ?? null, route: sum?.route ?? null };
  };

  /** Removes what policy no longer allows to be kept: disappeared messages, delivered metadata older than the retention days, and envelopes nobody fetched. */
  function purge(companyId) {
    const p = activePolicy(db, companyId);
    const now = Date.now();
    const iso = (days) => new Date(now - days * 86_400_000).toISOString();
    const expired = db.prepare('DELETE FROM sec_envelopes WHERE company_id = ? AND expires_at IS NOT NULL AND expires_at <= ?').run(companyId, nowIso()).changes;
    const metadata = db.prepare('DELETE FROM sec_envelopes WHERE company_id = ? AND delivered_at IS NOT NULL AND delivered_at <= ?').run(companyId, iso(p.metadataRetentionDays)).changes;
    const undelivered = db.prepare('DELETE FROM sec_envelopes WHERE company_id = ? AND delivered_at IS NULL AND created_at <= ?').run(companyId, iso(p.undeliveredRetentionDays)).changes;
    return { expired, metadata, undelivered };
  }

  return { devices, prekeys, conversations, envelopes, card, purge, ready: (actor) => secureReady(db, actor.companyId) };
}

const services = new WeakMap();
export const bindSecure = (db, s) => services.set(db, s);
export const secureOf = (db) => services.get(db);
