// End-to-end encryption for secure conversations (part 05.03). It runs in the browser and in Node and uses nothing but the WebCrypto API of the platform (ECDSA and ECDH on P-256, HKDF-SHA-256, AES-256-GCM, SHA-256),
// the audited implementation of the browser or of Node: there is no cryptographic primitive of our own in this file, only the way the standard ones are put together (docs/erp/LICENCE_REVIEW_05.03.md, ADR-231).
//
// Protocol "erp-e2e-v1" (see ARCHITECTURE section 52). It is NOT the Signal protocol and does not interoperate with it: the licence review did not approve libsignal (AGPL-3.0), so the part uses the permitted alternative.
//   * A device has an identity key (ECDSA), a signed pre-key (ECDH, signed by the identity key) and one-time pre-keys (ECDH). Only public keys ever leave the device.
//   * A message is encrypted once with a random content key (AES-GCM). For every receiving device that content key is wrapped with a key derived (HKDF) from an ephemeral-static Diffie-Hellman with the
//     device's signed pre-key and one one-time pre-key, and the envelope is signed with the sender's identity key. A group message is one such envelope per member device.
//   * What it gives: the server sees only ciphertext; a message cannot be forged by the server (signature); a used one-time pre-key is deleted, so an old message cannot be read after that key is gone.
//   * What it does not give (documented in D-276): no ratchet, so no post-compromise recovery and the signed pre-key protects messages sent without a one-time key until it is rotated.
const subtle = globalThis.crypto?.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const VERSION = 'erp-e2e-v1';
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

export const toB64 = (bytes) => { const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
export const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const sha256 = async (bytes) => new Uint8Array(await subtle.digest('SHA-256', bytes));
const rawPublic = async (key) => toB64(new Uint8Array(await subtle.exportKey('raw', key)));
const importEcdh = (b64) => subtle.importKey('raw', fromB64(b64), ECDH, false, []);
const importEcdsa = (b64) => subtle.importKey('raw', fromB64(b64), ECDSA, false, ['verify']);
const sign = async (privateKey, bytes) => toB64(new Uint8Array(await subtle.sign(SIGN, privateKey, bytes)));
const verify = async (publicB64, signatureB64, bytes) => { try { return await subtle.verify(SIGN, await importEcdsa(publicB64), fromB64(signatureB64), bytes); } catch { return false; } };
const spkBytes = (publicB64) => concat(enc.encode(`${VERSION}|signed-prekey|`), fromB64(publicB64));

/** The public identity key's short, stable fingerprint (base64 of its SHA-256). */
export async function fingerprint(identityKeyB64) { return toB64(await sha256(fromB64(identityKeyB64))); }

/** One-time pre-keys: the public parts go to the server, the private keys stay on the device. */
export async function makeOneTimePrekeys(startId, count) {
  const out = [];
  for (let i = 0; i < count; i += 1) { const k = await subtle.generateKey(ECDH, false, ['deriveBits']); out.push({ id: startId + i, publicKey: await rawPublic(k.publicKey), privateKey: k.privateKey }); }
  return out;
}

/** A signed pre-key, signed by the identity private key. */
export async function makeSignedPrekey(identityPrivateKey, id) {
  const k = await subtle.generateKey(ECDH, false, ['deriveBits']);
  const publicKey = await rawPublic(k.publicKey);
  return { id, publicKey, privateKey: k.privateKey, signature: await sign(identityPrivateKey, spkBytes(publicKey)) };
}

/** The keys of a new device. Private keys are non-extractable CryptoKeys: the browser keeps them in its IndexedDB and they cannot be read out, not even by this application. */
export async function generateDeviceKeys({ oneTimeCount = 20 } = {}) {
  const identity = await subtle.generateKey(ECDSA, false, ['sign', 'verify']);
  const identityKey = await rawPublic(identity.publicKey);
  return {
    registrationId: (new DataView(random(4).buffer).getUint32(0) % 16_000_000) + 1,
    identity: { publicKey: identityKey, privateKey: identity.privateKey },
    signedPrekey: await makeSignedPrekey(identity.privateKey, 1),
    oneTimePrekeys: await makeOneTimePrekeys(1, oneTimeCount),
  };
}

/** What the server is sent when a device registers: public keys only. */
export const registrationBody = (keys, { name, platform }) => ({
  name, platform, registrationId: keys.registrationId, identityKey: keys.identity.publicKey,
  signedPrekey: { id: keys.signedPrekey.id, publicKey: keys.signedPrekey.publicKey, signature: keys.signedPrekey.signature },
  oneTimePrekeys: keys.oneTimePrekeys.map((k) => ({ id: k.id, publicKey: k.publicKey })),
});

/** True when the signed pre-key was really signed by the identity key (the server checks this at registration and the sender again before encrypting). */
export const verifySignedPrekey = (identityKeyB64, spk) => verify(identityKeyB64, spk.signature, spkBytes(spk.publicKey));

// ---- safety numbers (FR-04) ----
const sortedSet = (fps) => [...new Set(fps)].sort();
/** One id for the set of devices a person has: it changes when a device is added or revoked. */
export const identitySetId = (fps) => sortedSet(fps).join('|');
async function personDigits(user, fps) {
  let h = enc.encode(`${VERSION}|safety|${user.toLowerCase()}|${identitySetId(fps)}`);
  for (let i = 0; i < 1024; i += 1) h = await sha256(concat(h, enc.encode(user.toLowerCase())));
  let out = '';
  for (let i = 0; i < 6; i += 1) { let n = 0n; for (let j = 0; j < 5; j += 1) n = n * 256n + BigInt(h[i * 5 + j]); out += String(n % 100_000n).padStart(5, '0'); }
  return out;
}
/** The safety number two people compare (60 digits in 12 groups); both sides compute the same number whoever looks. */
export async function safetyNumber(me, peer) {
  const a = { user: me.user, digits: await personDigits(me.user, me.fingerprints) };
  const b = { user: peer.user, digits: await personDigits(peer.user, peer.fingerprints) };
  const digits = [a, b].sort((x, y) => (x.user.toLowerCase() < y.user.toLowerCase() ? -1 : 1)).map((p) => p.digits).join('');
  return { digits, groups: digits.match(/.{5}/g) };
}
/** Compares what was trusted before with the devices the server now reports: 'new' (never seen), 'same', or 'changed' with the devices added and removed. */
export function compareTrust(stored, fingerprints) {
  const now = sortedSet(fingerprints);
  if (!stored) return { state: 'new', added: now, removed: [] };
  const before = sortedSet(stored.fingerprints);
  const added = now.filter((f) => !before.includes(f));
  const removed = before.filter((f) => !now.includes(f));
  return added.length || removed.length ? { state: 'changed', added, removed, verified: Boolean(stored.verified) } : { state: 'same', added: [], removed: [], verified: Boolean(stored.verified) };
}

// ---- messages ----
const wrapInfo = (uid, from, to) => enc.encode(`${VERSION}|wrap|${uid}|${from}|${to}`);
async function wrapKey(ikm, info) {
  const base = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const canonical = (h) => enc.encode(JSON.stringify([h.v, h.uid, h.from, h.to, h.eph, h.spk, h.otk, h.wiv, h.wk, h.iv, h.ct]));

/**
 * Encrypts one message for every device given. `sender` = { deviceId, identityPrivateKey }, `recipients` = bundles from the server
 * ({ deviceId, identityKey, signedPrekey: { id, publicKey, signature }, oneTimePrekey?: { id, publicKey } }). Returns one envelope (an opaque text) per device.
 */
export async function encryptMessage({ sender, messageUid, payload, recipients }) {
  const cek = random(32);
  const iv = random(12);
  const aad = enc.encode(`${VERSION}|${messageUid}|${sender.deviceId}`);
  const cekKey = await subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, cekKey, enc.encode(JSON.stringify(payload))));
  const out = [];
  for (const r of recipients) {
    if (!(await verifySignedPrekey(r.identityKey, r.signedPrekey))) throw new Error(`The keys of device ${r.deviceId} are not signed by that device (not sending).`);
    const eph = await subtle.generateKey(ECDH, false, ['deriveBits']);
    const dh1 = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: await importEcdh(r.signedPrekey.publicKey) }, eph.privateKey, 256));
    const dh2 = r.oneTimePrekey ? new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: await importEcdh(r.oneTimePrekey.publicKey) }, eph.privateKey, 256)) : new Uint8Array(0);
    const info = wrapInfo(messageUid, sender.deviceId, r.deviceId);
    const wiv = random(12);
    const wk = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: wiv, additionalData: info }, await wrapKey(concat(dh1, dh2), info), cek));
    const h = { v: 1, uid: messageUid, from: sender.deviceId, to: r.deviceId, eph: await rawPublic(eph.publicKey), spk: r.signedPrekey.id, otk: r.oneTimePrekey?.id ?? null, wiv: toB64(wiv), wk: toB64(wk), iv: toB64(iv), ct: toB64(ct) };
    out.push({ recipientDeviceId: r.deviceId, ciphertext: toB64(enc.encode(JSON.stringify({ h, s: await sign(sender.identityPrivateKey, canonical(h)) }))), usedOneTimePrekeyId: r.oneTimePrekey?.id ?? null });
  }
  return out;
}

/**
 * Decrypts an envelope on the receiving device. `device` = { deviceId, signedPrekeys: Map(id -> CryptoKey), oneTimePrekeys: Map(id -> CryptoKey) }; `senderIdentityKey` is what the server reports for the
 * sending device. Throws if the signature is wrong, the envelope was meant for another device or a key is missing. Returns { payload, messageUid, senderDeviceId, usedOneTimePrekeyId }.
 */
export async function decryptEnvelope({ device, envelope, senderIdentityKey }) {
  const { h, s } = JSON.parse(dec.decode(fromB64(envelope)));
  if (h.v !== 1) throw new Error('An envelope of an unknown version.');
  if (!(await verify(senderIdentityKey, s, canonical(h)))) throw new Error('The signature of the sender does not match: the message is not from that device.');
  if (h.to !== device.deviceId) throw new Error('This envelope is for another device.');
  const spk = device.signedPrekeys.get(h.spk);
  if (!spk) throw new Error('The signed pre-key for this message is no longer on this device.');
  let dh2 = new Uint8Array(0);
  if (h.otk != null) { const otk = device.oneTimePrekeys.get(h.otk); if (!otk) throw new Error('The one-time key for this message was already used or is gone.'); dh2 = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: await importEcdh(h.eph) }, otk, 256)); }
  const dh1 = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: await importEcdh(h.eph) }, spk, 256));
  const info = wrapInfo(h.uid, h.from, h.to);
  const cek = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(h.wiv), additionalData: info }, await wrapKey(concat(dh1, dh2), info), fromB64(h.wk)));
  const cekKey = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(h.iv), additionalData: enc.encode(`${VERSION}|${h.uid}|${h.from}`) }, cekKey, fromB64(h.ct));
  return { payload: JSON.parse(dec.decode(plain)), messageUid: h.uid, senderDeviceId: h.from, usedOneTimePrekeyId: h.otk };
}

// ---- attachments (FR-06): encrypted on the device before upload; the key travels inside the encrypted message ----
export async function encryptAttachment(bytes) {
  const key = random(32);
  const iv = random(12);
  const k = await subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  return { ciphertext: new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, k, bytes)), key: toB64(key), iv: toB64(iv), sha256: toB64(await sha256(bytes)), size: bytes.length };
}
export async function decryptAttachment(ciphertext, { key, iv, sha256: expected }) {
  const k = await subtle.importKey('raw', fromB64(key), 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, k, ciphertext));
  if (expected && toB64(await sha256(plain)) !== expected) throw new Error('The file does not match its checksum.');
  return plain;
}
