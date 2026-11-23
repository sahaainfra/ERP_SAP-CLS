import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authHeaders } from '../api/index.js';
import { fetchFileUrl } from '../../modules/core/api/index.js';
import { browserTransport, uploadFile } from '../files/upload.js';
import { useLiveRefresh } from '../realtime/socket.js';
import { compareTrust, decryptAttachment, decryptEnvelope, encryptAttachment, encryptMessage, generateDeviceKeys, makeOneTimePrekeys, registrationBody, safetyNumber } from '../../../shared/e2e.js';
import { store } from './store.js';

// The browser side of secure messaging (part 05.03): set up this device, send and receive encrypted messages, check other people's keys. All cryptography is in src/shared/e2e.js (WebCrypto); this file only
// moves keys, envelopes and messages between that library, the device's store and the API. The server never sees plaintext.
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
export const MARKER = 'ERPE2E01';
export class KeyChangeError extends Error { constructor(changes) { super('The safety number of someone in this conversation changed.'); this.name = 'KeyChangeError'; this.changes = changes; } }
const scopeOf = (session) => `${session.user}`;
const trustKey = (session, peer) => `${scopeOf(session)}|${peer.toLowerCase()}`;
const msgKey = (session, uid) => `${scopeOf(session)}|${uid}`;
export const convKey = (session, convId) => `${scopeOf(session)}|${convId}`;

export const secApi = {
  ready: async () => (await api.get('/sec/ready')).data,
  mine: async () => (await api.get('/sec/devices')).data.rows,
  all: async (user) => (await api.get(`/sec/devices/all${user ? `?user=${encodeURIComponent(user)}` : ''}`)).data.rows,
  revoke: async (id, reason) => (await api.post(`/sec/devices/${id}/revoke`, { reason }, idem())).data,
  keysOf: async (user) => (await api.get(`/sec/prekeys/${encodeURIComponent(user)}`)).data,
  details: async (id) => (await api.get(`/sec/conversations/${id}`)).data,
  create: async (body) => (await api.post('/sec/conversations', body, idem())).data,
  disappearing: async (id, seconds) => (await api.put(`/sec/conversations/${id}/disappearing`, { seconds }, idem())).data,
  card: async (entity, id) => (await api.get(`/sec/cards?entity=${encodeURIComponent(entity)}&id=${encodeURIComponent(id)}`)).data,
  policy: async () => (await api.get('/sec/policy')).data,
  propose: async (body) => (await api.post('/sec/policy/changes', body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } })).data,
  licences: async (f = {}) => (await api.get(`/sec/licences?${new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString()}`)).data,
  saveLicence: async (b) => (await api.post('/sec/licences', b, idem())).data,
  scan: async () => (await api.post('/sec/licences/scan', {}, idem())).data,
  review: async (comment) => (await api.post('/sec/licences/reviews', { comment }, idem())).data,
};

/** This browser's device record, or null when it has not been set up. */
export const localDevice = (session) => store.get('keys', scopeOf(session));

/** Sets up secure messaging on this device: makes the keys, keeps the private ones here, sends the public ones. */
export async function ensureDevice(session, name) {
  const have = await localDevice(session);
  if (have) {
    const mine = await secApi.mine().catch(() => []);
    const row = mine.find((d) => d.id === have.deviceId);
    if (row && !row.revokedAt) return have;
    await store.wipe(scopeOf(session)); // revoked or gone on the server: this device's keys are useless
  }
  const keys = await generateDeviceKeys({ oneTimeCount: 30 });
  const label = name || `${/Android|iPhone|iPad/i.test(navigator.userAgent) ? 'Phone' : 'Computer'} browser, ${new Date().toLocaleDateString('en-IN')}`;
  const res = (await api.post('/sec/devices', registrationBody(keys, { name: label, platform: navigator.platform || 'browser' }), idem())).data;
  const rec = { scope: scopeOf(session), deviceId: res.id, identity: keys.identity, signedPrekeys: { [keys.signedPrekey.id]: keys.signedPrekey.privateKey }, oneTime: Object.fromEntries(keys.oneTimePrekeys.map((k) => [k.id, k.privateKey])), nextOneTimeId: 31 };
  await store.put('keys', rec);
  return rec;
}

const toMaps = (rec) => ({ deviceId: rec.deviceId, signedPrekeys: new Map(Object.entries(rec.signedPrekeys).map(([k, v]) => [Number(k), v])), oneTimePrekeys: new Map(Object.entries(rec.oneTime).map(([k, v]) => [Number(k), v])) });

/** Fetches what is waiting for this device, decrypts it, keeps it, tells the server it arrived, and tops up the one-time keys. Returns the number of new messages. */
export async function sync(session) {
  const rec = await localDevice(session);
  if (!rec) return 0;
  let got = 0;
  for (let round = 0; round < 20; round += 1) {
    const page = (await api.get(`/sec/envelopes?device=${rec.deviceId}&since=0&limit=100`)).data;
    if (!page.rows.length) break;
    const device = toMaps(rec);
    for (const e of page.rows) {
      let item;
      try {
        const d = await decryptEnvelope({ device, envelope: e.ciphertext, senderIdentityKey: e.senderIdentityKey });
        if (d.usedOneTimePrekeyId != null) { delete rec.oneTime[d.usedOneTimePrekeyId]; device.oneTimePrekeys.delete(d.usedOneTimePrekeyId); }
        item = { payload: d.payload, undecryptable: false };
      } catch (er) { item = { payload: { v: 1, t: 'text', body: '' }, undecryptable: true, reason: String(er.message ?? er) }; }
      await store.put('msgs', { k: msgKey(session, e.messageUid), convKey: convKey(session, e.conversationId), convId: e.conversationId, uid: e.messageUid, sender: e.sender, at: e.createdAt, expiresAt: e.expiresAt, mine: false, ...item });
      got += 1;
    }
    await store.put('keys', rec);
    await api.post('/sec/envelopes/ack', { deviceId: rec.deviceId, ids: page.rows.map((r) => r.id) }, idem());
    if (!page.hasMore) break;
  }
  const count = (await api.get(`/sec/devices/${rec.deviceId}/prekeys/count`)).data;
  if (count.oneTime < 8) {
    const more = await makeOneTimePrekeys(rec.nextOneTimeId, 30);
    for (const k of more) rec.oneTime[k.id] = k.privateKey;
    rec.nextOneTimeId += 30;
    await store.put('keys', rec);
    await api.post(`/sec/devices/${rec.deviceId}/prekeys`, { oneTimePrekeys: more.map((k) => ({ id: k.id, publicKey: k.publicKey })) }, idem());
  }
  return got;
}

/** The decrypted messages of one conversation, oldest first; what has disappeared is removed from the device now. */
export async function thread(session, convId) {
  const now = Date.now();
  const all = await store.conversation(convKey(session, convId));
  const live = [];
  for (const m of all) { if (m.expiresAt && Date.parse(m.expiresAt) <= now) await store.del('msgs', m.k); else live.push(m); }
  return live.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** What this device knows about the keys of other people: new (never seen), same, or changed. A first sight is trusted (and shown as not verified). */
export async function trustState(session, user, fingerprints) {
  const t = await store.get('trust', trustKey(session, user));
  return { stored: t ?? null, ...compareTrust(t, fingerprints) };
}
export const acceptKeys = (session, user, fingerprints, verified = false) => store.put('trust', { k: trustKey(session, user), user, fingerprints: [...fingerprints], verified, at: new Date().toISOString() });
export async function numberFor(session, user) {
  const [mine, theirs] = await Promise.all([secApi.keysOf(session.user), secApi.keysOf(user)]);
  const n = await safetyNumber({ user: session.user, fingerprints: mine.fingerprints }, { user, fingerprints: theirs.fingerprints });
  return { ...n, mine: mine.fingerprints, theirs: theirs.fingerprints, devices: theirs.devices.map(({ deviceNo, fingerprint }) => ({ deviceNo, fingerprint })), name: theirs.name, ...(await trustState(session, user, theirs.fingerprints)) };
}
/** Before sending: someone's devices changed since this device last accepted them. */
async function checkKeys(session, users) {
  const changes = [];
  for (const u of users) {
    const k = await secApi.keysOf(u);
    const st = await trustState(session, u, k.fingerprints);
    if (st.state === 'new') await acceptKeys(session, u, k.fingerprints, false);
    else if (st.state === 'changed') changes.push({ user: u, name: k.name, added: st.added, removed: st.removed, wasVerified: Boolean(st.verified), fingerprints: k.fingerprints });
  }
  if (changes.length) throw new KeyChangeError(changes);
}

/** Encrypts a payload for every device of the conversation and sends it. `members` are the other people of the conversation. */
export async function send(session, convId, payload, { members, disappearSeconds = 0 }) {
  const rec = await localDevice(session);
  if (!rec) throw new Error('Set up secure messaging on this device first.');
  await checkKeys(session, members);
  const uid = globalThis.crypto.randomUUID();
  for (let attempt = 0; ; attempt += 1) {
    const b = (await api.get(`/sec/conversations/${convId}/bundles?device=${rec.deviceId}`)).data;
    if (b.missing.length) throw new Error(`${b.missing.join(', ')} has no secure device.`);
    const sealed = await encryptMessage({ sender: { deviceId: rec.deviceId, identityPrivateKey: rec.identity.privateKey }, messageUid: uid, payload, recipients: b.devices });
    try {
      await api.post('/sec/envelopes', { conversationId: convId, senderDeviceId: rec.deviceId, messageUid: uid, envelopes: sealed.map((e) => ({ recipientDeviceId: e.recipientDeviceId, ciphertext: e.ciphertext })) }, { headers: { 'idempotency-key': `${uid}-${attempt}` } });
      break;
    } catch (er) { if (er?.status === 409 && attempt < 2) continue; throw er; }
  }
  const at = new Date().toISOString();
  await store.put('msgs', { k: msgKey(session, uid), convKey: convKey(session, convId), convId, uid, sender: session.user, at, expiresAt: disappearSeconds ? new Date(Date.now() + disappearSeconds * 1000).toISOString() : null, mine: true, payload, undecryptable: false });
  return uid;
}

/** An attachment: encrypted here, uploaded as ciphertext (the file service sees a .enc file), the key goes inside the encrypted message. */
export async function sendFile(session, convId, file, opts) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const enc = await encryptAttachment(bytes);
  const blob = new File([new TextEncoder().encode(MARKER), enc.ciphertext], `${globalThis.crypto.randomUUID()}.enc`, { type: 'application/octet-stream' });
  const up = await uploadFile(blob, { transport: browserTransport(authHeaders), entity: 'msg_conversation', entityId: convId });
  return send(session, convId, { v: 1, t: 'file', name: file.name, mime: file.type || 'application/octet-stream', fileId: up.id, key: enc.key, iv: enc.iv, sha256: enc.sha256, size: enc.size }, opts);
}
/** The download link of an attachment; a file still in its virus scan (409, uploaded seconds ago) is asked for again until the scan ends, up to 30 s. */
async function linkWhenScanned(fileId) {
  const until = Date.now() + 30_000;
  for (;;) {
    try { return await fetchFileUrl(fileId, {}); } catch (e) {
      if (!(e?.status === 409 && e?.code === 'FILE_NOT_AVAILABLE' && /being scanned/.test(e?.message ?? '')) || Date.now() > until) throw e;
      await new Promise((r) => { setTimeout(r, 1500); });
    }
  }
}

export async function openFile(payload) {
  const link = await linkWhenScanned(payload.fileId);
  const res = await fetch(link.url);
  const all = new Uint8Array(await res.arrayBuffer());
  const plain = await decryptAttachment(all.slice(MARKER.length), payload);
  const url = URL.createObjectURL(new Blob([plain], { type: payload.mime }));
  Object.assign(document.createElement('a'), { href: url, download: payload.name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The messages of one secure conversation; refreshed by a real-time hint (ids only) and every 8 seconds. */
export function useSecureThread(convId, session) {
  const qc = useQueryClient();
  useLiveRefresh(session?.user ? [`user:${session.user}`] : [], [['sec']]);
  return useQuery({
    queryKey: ['sec', 'thread', convId], enabled: Boolean(convId && session?.user), retry: false, refetchInterval: 8000,
    queryFn: async () => {
      const got = await sync(session).catch((e) => { throw e; });
      if (got) qc.invalidateQueries({ queryKey: ['msg'] });
      return { messages: await thread(session, convId), device: await localDevice(session).then((d) => (d ? { deviceId: d.deviceId } : null)) };
    },
  });
}
export const useSecureReady = () => useQuery({ queryKey: ['sec', 'ready'], queryFn: secApi.ready, retry: false });
