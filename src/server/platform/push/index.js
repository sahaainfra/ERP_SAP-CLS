import { createCipheriv, createECDH, createPrivateKey, createSign, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Web Push (part 03.06), with nothing but node:crypto: the application's VAPID key pair (RFC 8292), the encryption of the message for the
// browser's key (RFC 8291, aes128gcm of RFC 8188) and the request to the browser vendor's push service. The service that decides what to
// send and to whom is the notification service (04.06); this module only delivers one message to one subscription.

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(s, 'base64url');

/** Push services the browsers use. A subscription may only point at one of them, never at an address of ours or of the network. */
export const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com', 'push.apple.com', 'notify.windows.com'];

/** Why an endpoint may not be stored, or null. `allowHosts` adds hosts (a local test server, never in production). */
export function endpointProblem(endpoint, { allowHosts = [] } = {}) {
  let u;
  try { u = new URL(endpoint); } catch { return 'is not a web address'; }
  if (endpoint.length > 600) return 'is too long';
  if (u.username || u.password) return 'must not carry a user name or password';
  const host = u.hostname.toLowerCase();
  if (allowHosts.includes(host) || allowHosts.includes(u.host.toLowerCase())) return null;
  if (u.protocol !== 'https:') return 'must be an https address';
  if (u.port && u.port !== '443') return 'must use the standard https port';
  if (!PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return 'is not the address of a known browser push service';
  return null;
}

/** A VAPID key pair as { publicKey, privateKey } in the base64url form of the Web Push specifications (65 and 32 bytes). */
export function makeVapidKeys() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  return { publicKey: b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)])), privateKey: jwk.d };
}

/**
 * The key pair the application uses: the configured one, else (outside production) one made once and kept in the storage folder, else
 * null, which means this installation offers no push.
 */
export function loadVapid({ config, dir }) {
  if (config.push) return { ...config.push };
  if (config.environment === 'production' || config.environment === 'staging' || !dir) return null;
  const file = join(dir, 'vapid.json');
  try {
    if (existsSync(file)) return { ...JSON.parse(readFileSync(file, 'utf8')), subject: config.appUrl ?? 'mailto:admin@example.com' };
    mkdirSync(dir, { recursive: true });
    const keys = makeVapidKeys();
    writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
    return { ...keys, subject: config.appUrl ?? 'mailto:admin@example.com' };
  } catch {
    return null;
  }
}

const privateKeyOf = (vapid) => {
  const pub = fromB64u(vapid.publicKey);
  return createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: vapid.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
};

/** The Authorization header that proves to the push service that this application sent the message (RFC 8292). */
export function vapidAuthorization(endpoint, vapid, { nowMs = Date.now() } = {}) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: vapid.subject }));
  const signature = createSign('SHA256').update(`${header}.${claims}`).sign({ key: privateKeyOf(vapid), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${vapid.publicKey}`;
}

/** The body of a push request: the message encrypted for one subscription (RFC 8291: aes128gcm, one record). */
export function encryptPayload(subscription, payload, { salt = randomBytes(16), ephemeral = createECDH('prime256v1') } = {}) {
  const uaPublic = fromB64u(subscription.p256dh);
  const authSecret = fromB64u(subscription.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length !== 16) throw new Error('The subscription keys are not valid.');
  let asPublic;
  try { asPublic = ephemeral.getPublicKey(); } catch { ephemeral.generateKeys(); asPublic = ephemeral.getPublicKey(); } // a fresh key pair for each message unless one was given
  const secret = ephemeral.computeSecret(uaPublic);
  const ikm = Buffer.from(hkdfSync('sha256', secret, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const data = Buffer.from(payload);
  if (data.length > 3993) throw new Error('A push message may hold at most 3993 bytes.');
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([data, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, body]);
}

/**
 * Deliver one message to one subscription. Resolves { status, ok, gone }: `gone` means the push service says the subscription no longer
 * exists (404 or 410), so the caller should forget it. A network failure resolves with status 0 instead of throwing.
 * @param {{ vapid: any, fetchImpl?: typeof fetch, ttl?: number, urgency?: string, nowMs?: number }} options
 */
export async function sendPush(subscription, message, options) {
  const { vapid, fetchImpl = fetch, ttl = 3600, urgency = 'normal', nowMs = Date.now() } = options;
  const body = encryptPayload(subscription, JSON.stringify(message));
  try {
    const res = await fetchImpl(subscription.endpoint, {
      method: 'POST',
      headers: { Authorization: vapidAuthorization(subscription.endpoint, vapid, { nowMs }), TTL: String(ttl), Urgency: urgency, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', 'Content-Length': String(body.length) },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status, ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410 };
  } catch {
    return { status: 0, ok: false, gone: false };
  }
}
