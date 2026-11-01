import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createPublicKey, createVerify, hkdfSync, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { encryptPayload, endpointProblem, makeVapidKeys, sendPush, vapidAuthorization } from '../src/server/platform/push/index.js';
import { loadConfig } from '../src/server/platform/config/index.js';
import { parseCode, qrRegistry } from '../src/server/platform/qr/index.js';
import '../src/server/modules/ui/sample-request-object.js'; // registers the sample request's code

// Part 03.06: Web Push with node:crypto (VAPID, the encrypted message, the request), the endpoint rules, the configuration of the key pair and
// the QR code parser. The browser's side of the encryption is written out here as the specification says it.

const browser = () => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
};
/** What the browser does with an aes128gcm push body (RFC 8291 section 3.4). */
function decrypt(ua, body) {
  const salt = body.subarray(0, 16);
  assert.equal(body.readUInt32BE(16), 4096, 'record size');
  const idLength = body[20];
  const asPublic = body.subarray(21, 21 + idLength);
  const cipher = body.subarray(21 + idLength);
  const uaPublic = ua.ecdh.getPublicKey();
  const ikm = Buffer.from(hkdfSync('sha256', ua.ecdh.computeSecret(asPublic), ua.auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  assert.equal(plain.at(-1), 2, 'the last record ends with the delimiter 0x02');
  return plain.subarray(0, -1).toString('utf8');
}

test('FR-04 a push message is encrypted for the browser that subscribed, and only that browser can read it', () => {
  const ua = browser();
  const other = browser();
  const body = encryptPayload(ua.subscription, JSON.stringify({ title: 'Approval waiting', url: '/admin/approvals' }));
  assert.equal(decrypt(ua, body), '{"title":"Approval waiting","url":"/admin/approvals"}');
  assert.throws(() => decrypt(other, body), /Unsupported state|authenticate/i, 'another browser cannot read it');
  assert.notDeepEqual(encryptPayload(ua.subscription, 'x'), encryptPayload(ua.subscription, 'x'), 'a new salt and key every time');
  assert.throws(() => encryptPayload({ ...ua.subscription, auth: 'AAAA' }, 'x'), /not valid/);
  assert.throws(() => encryptPayload(ua.subscription, 'y'.repeat(4000)), /at most 3993/);
  assert.equal(decrypt(ua, encryptPayload(ua.subscription, 'रामू: ₹5,00,000')), 'रामू: ₹5,00,000', 'multi-byte text');
});

test('the VAPID authorization is a signed token for the push service the message goes to', () => {
  const keys = { ...makeVapidKeys(), subject: 'mailto:admin@example.com' };
  assert.equal(Buffer.from(keys.publicKey, 'base64url').length, 65);
  assert.equal(Buffer.from(keys.privateKey, 'base64url').length, 32);
  const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, { nowMs: Date.parse('2026-11-02T10:00:00Z') });
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
  assert.ok(m, header);
  assert.equal(m[4], keys.publicKey);
  assert.deepEqual(JSON.parse(Buffer.from(m[1], 'base64url')), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(Buffer.from(m[2], 'base64url')), { aud: 'https://fcm.googleapis.com', exp: Math.floor(Date.parse('2026-11-02T10:00:00Z') / 1000) + 43200, sub: 'mailto:admin@example.com' });
  const pub = Buffer.from(keys.publicKey, 'base64url');
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(createVerify('SHA256').update(`${m[1]}.${m[2]}`).verify({ key, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')), 'the signature verifies with the public key');
});

test('a subscription may only point at a browser vendor\'s push service', () => {
  for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://web.push.apple.com/abc', 'https://wns2-par02p.notify.windows.com/w/?token=abc']) assert.equal(endpointProblem(ok), null, ok);
  const bad = {
    'http://fcm.googleapis.com/x': /https/, 'https://localhost/x': /known browser push service/, 'https://127.0.0.1/x': /known/, 'https://10.0.0.5/x': /known/,
    'https://evil.example.com/x': /known/, 'https://fcm.googleapis.com.evil.example/x': /known/, 'https://user:pw@fcm.googleapis.com/x': /user name/,
    'https://fcm.googleapis.com:8443/x': /port/, 'not a url': /web address/, 'ftp://fcm.googleapis.com/x': /https/, [`https://fcm.googleapis.com/${'a'.repeat(700)}`]: /too long/,
  };
  for (const [url, why] of Object.entries(bad)) assert.match(endpointProblem(url), why, url.slice(0, 60));
  assert.equal(endpointProblem('http://127.0.0.1:9999/x', { allowHosts: ['127.0.0.1:9999'] }), null, 'a test server can be allowed');
});

test('sendPush posts the encrypted message with the VAPID header, and tells the caller when the subscription is gone', async () => {
  const ua = browser();
  const seen = [];
  let status = 201;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { seen.push({ headers: req.headers, body: Buffer.concat(chunks) }); res.statusCode = status; res.end(); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${server.address().port}/push/abc`;
  const vapid = { ...makeVapidKeys(), subject: 'mailto:admin@example.com' };
  try {
    const ok = await sendPush({ ...ua.subscription, endpoint }, { title: 'Hello' }, { vapid });
    assert.deepEqual(ok, { status: 201, ok: true, gone: false });
    assert.match(seen[0].headers.authorization, /^vapid t=.+, k=/);
    assert.equal(seen[0].headers['content-encoding'], 'aes128gcm');
    assert.equal(seen[0].headers.ttl, '3600');
    assert.equal(decrypt(ua, seen[0].body), '{"title":"Hello"}');
    status = 410;
    assert.deepEqual(await sendPush({ ...ua.subscription, endpoint }, { title: 'x' }, { vapid }), { status: 410, ok: false, gone: true });
    status = 404;
    assert.equal((await sendPush({ ...ua.subscription, endpoint }, { title: 'x' }, { vapid })).gone, true);
    status = 500;
    assert.deepEqual(await sendPush({ ...ua.subscription, endpoint }, { title: 'x' }, { vapid }), { status: 500, ok: false, gone: false });
  } finally {
    server.close();
  }
  // nobody listening: a failure result, not an exception
  assert.deepEqual(await sendPush({ ...ua.subscription, endpoint: 'http://127.0.0.1:1/x' }, { title: 'x' }, { vapid }), { status: 0, ok: false, gone: false });
});

test('the VAPID key pair comes from the environment, together or not at all', () => {
  const base = { NODE_ENV: 'test', DATABASE_PATH: ':memory:' };
  const keys = makeVapidKeys();
  assert.equal(loadConfig(base).push, null);
  const cfg = loadConfig({ ...base, PUSH_VAPID_PUBLIC_KEY: keys.publicKey, PUSH_VAPID_PRIVATE_KEY: keys.privateKey, PUSH_SUBJECT: 'mailto:ops@example.com' });
  assert.deepEqual(cfg.push, { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: 'mailto:ops@example.com' });
  assert.throws(() => loadConfig({ ...base, PUSH_VAPID_PUBLIC_KEY: keys.publicKey }), /must be set together/);
  assert.throws(() => loadConfig({ ...base, PUSH_VAPID_PUBLIC_KEY: 'short', PUSH_VAPID_PRIVATE_KEY: keys.privateKey }), /PUSH_VAPID_PUBLIC_KEY/);
});

test('FR-04 codes: ERP:TYPE:reference codes and printed numbers are read, junk and control characters are not', () => {
  assert.deepEqual(parseCode('  ERP:SAMPLE_REQUEST:42 '), { code: 'ERP:SAMPLE_REQUEST:42', typed: { type: 'SAMPLE_REQUEST', ref: '42' } });
  assert.deepEqual(parseCode('MR/2026-27/0001'), { code: 'MR/2026-27/0001', typed: null });
  assert.equal(parseCode(''), null);
  assert.equal(parseCode('a'.repeat(201)), null);
  assert.equal(parseCode('MR/1\n2'), null);
  assert.equal(qrRegistry.payload('ITEM', 'CEM-43'), 'ERP:ITEM:CEM-43');
  assert.throws(() => qrRegistry.register({ type: 'bad type' }), /Bad QR type/);
  assert.throws(() => qrRegistry.register({ type: 'SAMPLE_REQUEST' }), /already registered/);
});
