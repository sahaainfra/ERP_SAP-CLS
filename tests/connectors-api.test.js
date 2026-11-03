import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import '../src/server/modules/registry.js';
import { logBuffer } from '../src/server/platform/observability/logbuffer.js';
import { createLogger } from '../src/server/platform/http/logger.js';
import { signWebhook } from '../src/server/platform/integrations/webhooks.js';
import { startApi } from './helpers.js';

const C = '/api/v1/core';
const SECRET = 'sk-test-API-KEY-9f8e7d6c5b4a'; // secret-scan:allow fake credential for the test
const WHSEC = 'whsec_0123456789abcdef';
const itadm = { roles: 'ITADM', user: 'ishaan', company: '1' };
const sys = { roles: 'SYSADM', user: 'sysadmin', company: '1' };
const cfo = { roles: 'CFO', user: 'chitra', company: '1' };
const pm = { roles: 'PM', user: 'pooja', company: '1' };
const key = (n) => ({ 'idempotency-key': `hub8-${n}-${Math.random().toString(36).slice(2, 10)}` });
const quiet = () => createLogger({ write: () => {} });

/** A stand-in for an email service: records requests; `mode` decides the answer. */
async function emailServer() {
  const seen = [];
  const state = { status: 200 };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(state.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(state.status < 400 ? { id: 'msg-1', ok: true } : { error: 'nope' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { seen, state, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

const approve = async (api, requestId, who, n) => api.call('POST', `${C}/change-requests/${requestId}/act`, { ...who, headers: key(n), body: { action: 'approve', comment: 'ok' } });

async function createSandbox(api, code = 'mail.main', over = {}) {
  const res = await api.call('POST', `${C}/connectors`, { ...itadm, headers: key('c'), body: { code, type: 'email', name: 'Main mail', provider: 'sandbox', environment: 'development', config: { fromAddress: 'noreply@example.com' }, secrets: { api_key: SECRET }, enabled: true, reason: 'office email', ...over } });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal((await approve(api, res.json.data.request.id, sys, 'a')).status, 200);
  return res.json.data.connector.id;
}

test('AC-05 who may see and change connectors: ITADM configures, SYSADM views, everyone else and anonymous nothing', async () => {
  const api = await startApi({}, { logger: quiet() });
  for (const path of ['/connectors', '/connectors/catalog', '/integration-logs']) {
    assert.equal((await api.call('GET', C + path, itadm)).status, 200, `ITADM ${path}`);
    assert.equal((await api.call('GET', C + path, sys)).status, 200, `SYSADM ${path}`);
    assert.equal((await api.call('GET', C + path, pm)).status, 403, `PM ${path}`);
    assert.equal((await api.call('GET', C + path, { user: null })).status, 401, `anonymous ${path}`);
  }
  const create = { code: 'mail.x', type: 'email', name: 'X', provider: 'sandbox', config: { fromAddress: 'a@example.com' }, secrets: {}, reason: 'try it out' };
  for (const [who, name] of [[sys, 'SYSADM'], [pm, 'PM'], [cfo, 'CFO']]) {
    assert.equal((await api.call('POST', `${C}/connectors`, { ...who, headers: key(name), body: create })).status, 403, `${name} cannot create`);
  }
  assert.equal((await api.call('POST', `${C}/connectors`, { ...itadm, body: create })).status, 400, 'Idempotency-Key is required');
  await api.close();
});

test('FR-01 / BR-02 a connector is created by request: unusable until the System Administrator approves; the requester cannot approve', async () => {
  const api = await startApi({}, { logger: quiet() });
  const res = await api.call('POST', `${C}/connectors`, { ...itadm, headers: key(1), body: { code: 'mail.main', type: 'email', name: 'Main mail', provider: 'sandbox', environment: 'development', config: { fromAddress: 'noreply@example.com' }, secrets: { api_key: SECRET }, enabled: true, reason: 'office email' } });
  assert.equal(res.status, 201);
  assert.equal(res.json.data.connector.status, 'PENDING');
  assert.deepEqual(res.json.data.request.chain, ['SYSADM']);
  const id = res.json.data.connector.id;
  assert.equal((await api.call('POST', `${C}/connectors/${id}/test`, { ...itadm, headers: key(2) })).status, 409, 'cannot test before approval');
  assert.equal((await approve(api, res.json.data.request.id, itadm, 3)).status, 403, 'the requester cannot decide');
  assert.equal((await approve(api, res.json.data.request.id, sys, 4)).status, 200);
  const c = (await api.call('GET', `${C}/connectors/${id}`, sys)).json.data;
  assert.deepEqual([c.status, c.secrets.map((s) => s.key), c.pendingSecrets], ['ENABLED', ['api_key'], []]);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'core_connectors' AND action = 'create_approved'").get().n, 1);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'core.connector.changed'").get().n, 1);
  assert.equal((await api.call('POST', `${C}/connectors`, { ...itadm, headers: key(5), body: { code: 'mail.main', type: 'email', name: 'Again', provider: 'sandbox', config: { fromAddress: 'a@example.com' }, secrets: {}, reason: 'duplicate code' } })).status, 409);
  await api.close();
});

test('input rules: unknown provider, wrong settings, credentials in settings, credentials the provider does not use', async () => {
  const api = await startApi({}, { logger: quiet() });
  let seq = 0;
  const post = (over) => api.call('POST', `${C}/connectors`, { ...itadm, headers: key(++seq), body: { code: 'mail.t', type: 'email', name: 'Test mail', provider: 'sandbox', config: { fromAddress: 'a@example.com' }, secrets: {}, reason: 'test only', ...over } });
  assert.equal((await post({ provider: 'carrier_pigeon' })).status, 422);
  assert.equal((await post({ type: 'telex' })).status, 400);
  assert.equal((await post({ config: { fromAddress: 'not-an-email' } })).status, 400);
  const leaky = await post({ config: { fromAddress: 'a@example.com', api_key: 'oops' } });
  assert.equal(leaky.status, 400);
  assert.match(JSON.stringify(leaky.json), /Credentials go in the secrets/);
  assert.equal((await post({ config: { fromAddress: 'a@example.com', colour: 'red' } })).status, 400);
  assert.equal((await post({ secrets: { random_secret: 'abcdefgh' } })).status, 400);
  assert.equal((await post({ provider: 'http_api', config: { baseUrl: 'http://example.com', fromAddress: 'a@example.com' }, secrets: { api_key: SECRET } })).status, 400, 'plain http to a public host');
  assert.equal((await post({ provider: 'http_api', config: { baseUrl: 'https://mail.example.com', fromAddress: 'a@example.com' }, enabled: true })).status, 422, 'switching on needs the credential');
  assert.equal((await post({ code: 'Bad Code' })).status, 400);
  assert.equal((await post({ reason: 'x' })).status, 400);
  await api.close();
});

test('FR-02 / BR-01 / T-03 credentials are write-only: no API response, log line or audit row ever holds a value', async () => {
  logBuffer.clear();
  const api = await startApi({}, { logger: quiet() });
  const id = await createSandbox(api);
  const responses = [
    (await api.call('GET', `${C}/connectors/${id}`, itadm)).json,
    (await api.call('GET', `${C}/connectors/${id}/secrets`, itadm)).json,
    (await api.call('GET', `${C}/connectors`, sys)).json,
    (await api.call('GET', `${C}/change-requests`, sys)).json,
    (await api.call('POST', `${C}/connectors/${id}/test`, { ...itadm, headers: key('t') })).json,
    (await api.call('POST', `${C}/connectors/${id}/sample`, { ...itadm, headers: key('s') })).json,
    (await api.call('GET', `${C}/integration-logs`, itadm)).json,
  ];
  const secrets = (await api.call('GET', `${C}/connectors/${id}/secrets`, itadm)).json.data;
  assert.deepEqual(secrets.map((s) => [s.key, s.status, s.isSet]), [['api_key', 'ACTIVE', true]]);
  for (const r of responses) assert.ok(!JSON.stringify(r).includes(SECRET), 'no response holds the value');
  const stored = api.db.prepare('SELECT encrypted_value FROM core_connector_secrets').all().map((r) => r.encrypted_value).join('|');
  assert.ok(!stored.includes(SECRET), 'encrypted at rest');
  for (const table of ['core_audit_log', 'core_outbox', 'core_change_requests', 'core_integration_logs', 'core_jobs']) {
    assert.ok(!JSON.stringify(api.db.prepare(`SELECT * FROM ${table}`).all()).includes(SECRET), `${table} holds no value`);
  }
  assert.ok(!JSON.stringify(logBuffer.recent(1000)).includes(SECRET), 'the application log holds no value');
  assert.ok(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'core_connector_secrets' AND action = 'access'").get().n >= 2, 'opening the credentials was audited');
  await api.close();
  logBuffer.clear();
});

test('AC-01 / AC-02 a sample email connector is configured, tested and used through the abstraction; the log shows the redacted calls with correlation IDs', async () => {
  const api = await startApi({}, { logger: quiet() });
  const id = await createSandbox(api);
  const t = await api.call('POST', `${C}/connectors/${id}/test`, { ...itadm, headers: { ...key('t'), 'x-correlation-id': 'test-corr-0001' } });
  assert.equal(t.status, 200);
  assert.deepEqual([t.json.data.status, t.json.data.connector.health.status], ['ok', 'ok']);
  const s = await api.call('POST', `${C}/connectors/${id}/sample`, { ...itadm, headers: { ...key('s'), 'x-correlation-id': 'sample-corr-0002' } });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.equal(s.json.data.operation, 'send');
  assert.equal(s.json.data.result.accepted, 1);
  const logs = (await api.call('GET', `${C}/integration-logs`, sys)).json;
  assert.equal(logs.data.length, 2);
  const sent = logs.data.find((l) => l.operation === 'send');
  assert.deepEqual([sent.connector, sent.status, sent.direction, sent.correlationId], ['mail.main', 'success', 'outbound', 'sample-corr-0002']);
  assert.match(sent.user, /^u_[0-9a-f]{10}$/);
  assert.ok(!JSON.stringify(logs).includes('ishaan'), 'the user is a pseudonym');
  const detail = (await api.call('GET', `${C}/integration-logs/${sent.id}`, sys)).json.data;
  assert.ok(detail.request.includes('"subject"') && !detail.request.includes('This message was sent'), 'the body text is not in the log');
  assert.equal((await api.call('GET', `${C}/integration-logs?filter[connector]=mail.main&filter[status]=success&q=sample-corr`, itadm)).json.data.length, 1);
  assert.equal((await api.call('GET', `${C}/integration-logs?filter[status]=failure`, itadm)).json.data.length, 0);
  assert.equal((await api.call('GET', `${C}/integration-logs?filter[bogus]=1`, itadm)).status, 400);
  assert.equal((await api.call('GET', `${C}/integration-logs/${sent.id}`, { ...sys, company: '2' })).status, 404, 'another company cannot read it');
  assert.equal((await api.call('POST', `${C}/connectors/${id}/sample`, { ...sys, headers: key('x') })).status, 403, 'SYSADM cannot exercise a connector');
  await api.close();
});

test('FR-04 a real HTTP provider: bearer key and idempotency key are sent; a failing provider trips the breaker which the connector list shows; disabling is immediate', async () => {
  const mail = await emailServer();
  const api = await startApi({}, { logger: quiet() });
  const created = await api.call('POST', `${C}/connectors`, { ...itadm, headers: key(1), body: { code: 'mail.http', type: 'email', name: 'HTTP mail', provider: 'http_api', environment: 'development', config: { baseUrl: mail.url, fromAddress: 'noreply@example.com' }, secrets: { api_key: SECRET }, maxRetries: 0, breakerThreshold: 2, breakerResetSeconds: 30, retryBackoffMs: 0, enabled: true, reason: 'real email provider' } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  await approve(api, created.json.data.request.id, sys, 2);
  const id = created.json.data.connector.id;
  assert.equal((await api.call('POST', `${C}/connectors/${id}/test`, { ...itadm, headers: key(3) })).json.data.status, 'ok');
  assert.equal((await api.call('POST', `${C}/connectors/${id}/sample`, { ...itadm, headers: key(4) })).status, 200);
  const post = mail.seen.find((r) => r.method === 'POST');
  assert.equal(post.headers.authorization, `Bearer ${SECRET}`);
  assert.equal(post.url, '/send');
  mail.state.status = 500;
  assert.equal((await api.call('POST', `${C}/connectors/${id}/sample`, { ...itadm, headers: key(5) })).status, 503);
  assert.equal((await api.call('POST', `${C}/connectors/${id}/sample`, { ...itadm, headers: key(6) })).status, 503);
  const before = mail.seen.length;
  const open = await api.call('POST', `${C}/connectors/${id}/sample`, { ...itadm, headers: key(7) });
  assert.equal(open.status, 503);
  assert.match(open.json.error.message, /paused after repeated failures/);
  assert.equal(mail.seen.length, before, 'the open circuit made no call');
  assert.equal((await api.call('GET', `${C}/connectors/${id}`, sys)).json.data.breaker.state, 'open');
  assert.equal((await api.call('GET', `${C}/integration-logs?filter[status]=circuit_open`, sys)).json.data.length, 1);

  const off = await api.call('POST', `${C}/connectors/${id}/disable`, { ...itadm, headers: key(8), body: { reason: 'provider outage' } });
  assert.equal(off.json.data.status, 'DISABLED');
  assert.equal((await api.call('POST', `${C}/connectors/${id}/disable`, { ...itadm, headers: key(9), body: { reason: 'again again' } })).status, 422);
  assert.equal((await api.call('POST', `${C}/connectors/${id}/disable`, { ...sys, headers: key(10), body: { reason: 'not allowed' } })).status, 403);
  assert.equal((await api.call('POST', `${C}/connectors/${id}/sample`, { ...itadm, headers: key(11) })).status, 422);
  await mail.close();
  await api.close();
});

test('BR-02 changes and credential rotation are requests: nothing changes before approval; banking connectors also need the CFO', async () => {
  const api = await startApi({}, { logger: quiet() });
  const id = await createSandbox(api);
  const ask = (body, n) => api.call('POST', `${C}/connectors/${id}/change-requests`, { ...itadm, headers: key(n), body });
  assert.equal((await ask({ changes: {}, reason: 'nothing at all' }, 1)).status, 422);
  assert.equal((await ask({ changes: { rateLimitPerMinute: 60 }, reason: 'same as now' }, 2)).status, 422);
  assert.equal((await ask({ changes: { rateLimitPerMinute: 0 }, reason: 'zero is not valid' }, 3)).status, 400);
  const req = await ask({ changes: { rateLimitPerMinute: 120, maxRetries: 4 }, secrets: { api_key: 'rotated-KEY-1234567890' }, secretExpiry: { api_key: '2030-01-01' }, reason: 'rotate the key and raise limits' }, 4); // secret-scan:allow fake credential for the test
  assert.equal(req.status, 201, JSON.stringify(req.json));
  assert.ok(!JSON.stringify(req.json).includes('rotated-KEY'), 'the request does not carry the value');
  assert.equal((await ask({ changes: { retentionDays: 30 }, reason: 'a second open request' }, 5)).status, 409);
  const before = (await api.call('GET', `${C}/connectors/${id}`, sys)).json.data;
  assert.deepEqual([before.rateLimitPerMinute, before.pendingSecrets, before.openRequest], [60, ['api_key'], true]);
  assert.equal((await api.call('POST', `${C}/change-requests/${req.json.data.id}/act`, { ...itadm, headers: key(6), body: { action: 'approve', comment: 'self' } })).status, 403);
  assert.equal((await approve(api, req.json.data.id, sys, 7)).status, 200);
  const after = (await api.call('GET', `${C}/connectors/${id}`, sys)).json.data;
  assert.deepEqual([after.rateLimitPerMinute, after.maxRetries, after.pendingSecrets, after.version], [120, 4, [], 3]);
  assert.equal(after.secrets[0].expiresAt, '2030-01-01T23:59:59.000Z');
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_connector_secrets WHERE status = 'RETIRED'").get().n, 1, 'the old key was retired, not deleted');
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'core_connectors' AND action = 'change_approved'").get().n, 1);

  // A bank connector: SYSADM then the CFO.
  const bank = await api.call('POST', `${C}/connectors`, { ...itadm, headers: key(8), body: { code: 'bank.hdfc', type: 'bank', name: 'HDFC', provider: 'http_json', config: { baseUrl: 'https://api.bank.example.com' }, secrets: { api_key: 'bank-KEY-1234567890' }, reason: 'bank payment files' } }); // secret-scan:allow fake credential for the test
  assert.equal(bank.status, 201, JSON.stringify(bank.json));
  assert.deepEqual(bank.json.data.request.chain, ['SYSADM', 'CFO']);
  const rid = bank.json.data.request.id;
  assert.equal((await approve(api, rid, cfo, 9)).status, 403, 'the CFO cannot go first');
  assert.equal((await approve(api, rid, sys, 10)).status, 200);
  assert.equal((await api.call('GET', `${C}/connectors/${bank.json.data.connector.id}`, sys)).json.data.status, 'PENDING', 'one approval of two changes nothing');
  assert.equal((await approve(api, rid, cfo, 11)).status, 200);
  assert.equal((await api.call('GET', `${C}/connectors/${bank.json.data.connector.id}`, sys)).json.data.status, 'DISABLED');
  await api.close();
});

test('T-02 inbound webhooks: signature checked, replays ignored, the verified payload becomes an event; unknown or unsigned ones are 404 or 401', async () => {
  const api = await startApi({}, { logger: quiet() });
  const id = await createSandbox(api, 'mail.hook', { secrets: { api_key: SECRET, webhook_secret: WHSEC } });
  const send = (body, { secret = WHSEC, ts = String(Math.floor(Date.now() / 1000)), delivery, sig } = {}) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    return fetch(`${api.base}${C}/webhooks/mail.hook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-timestamp': ts, 'x-signature': sig ?? `sha256=${signWebhook(secret, ts, Buffer.from(raw))}`, ...(delivery ? { 'x-delivery-id': delivery } : {}) }, body: raw }).then(async (r) => ({ status: r.status, json: await r.json() }));
  };
  const ok = await send({ event: 'delivered', messageId: 'm-1', recipientEmail: 'meera@example.com' }, { delivery: 'evt-1' });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.json.data.received, ok.json.data.duplicate], [true, false]);
  const event = JSON.parse(api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'core.webhook.received'").get().payload);
  assert.deepEqual([event.data.connector, event.data.deliveryId, event.data.payload.event, event.companyId], ['mail.hook', 'evt-1', 'delivered', 1]);

  const replay = await send({ event: 'delivered', messageId: 'm-1' }, { delivery: 'evt-1' });
  assert.equal(replay.status, 200);
  assert.equal(replay.json.data.duplicate, true);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'core.webhook.received'").get().n, 1, 'a replay raises no second event');

  assert.equal((await send({ event: 'x' }, { secret: 'wrong-secret-value' })).status, 401, 'wrong signature'); // secret-scan:allow fake credential for the test
  assert.equal((await send({ event: 'x' }, { sig: '' })).status, 401, 'no signature');
  assert.equal((await send({ event: 'x' }, { ts: String(Math.floor(Date.now() / 1000) - 3600) })).status, 401, 'old timestamp');
  const tampered = JSON.stringify({ event: 'refund' });
  const signedFor = signWebhook(WHSEC, String(Math.floor(Date.now() / 1000)), Buffer.from(JSON.stringify({ event: 'paid' })));
  assert.equal((await send(tampered, { sig: signedFor })).status, 401, 'a body changed after signing');
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'core.webhook.received'").get().n, 1);

  const unknown = await fetch(`${api.base}${C}/webhooks/nothing.here`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(unknown.status, 404);
  const logs = (await api.call('GET', `${C}/integration-logs?filter[direction]=inbound`, itadm)).json.data;
  assert.deepEqual(logs.map((l) => l.status).sort(), ['duplicate', 'rejected', 'rejected', 'rejected', 'rejected', 'success']);
  assert.ok(!JSON.stringify(logs).includes(WHSEC));
  const detail = (await api.call('GET', `${C}/integration-logs/${logs.find((l) => l.status === 'success').id}`, itadm)).json.data;
  assert.ok(!detail.request.includes('meera@example.com'), 'identifiers in the payload are masked in the log');

  api.db.prepare("UPDATE core_connectors SET status = 'DISABLED' WHERE id = ?").run(id);
  assert.equal((await send({ event: 'x' })).status, 404, 'a switched-off connector accepts nothing');
  await api.close();
});

test('the integration screens are hidden while ff.core.p0108 is OFF for the company, and the webhook receiver stops too', async () => {
  const api = await startApi({}, { logger: quiet() });
  await createSandbox(api, 'mail.hook', { secrets: { api_key: SECRET, webhook_secret: WHSEC } });
  await api.call('PATCH', `${C}/feature-flags/ff.core.p0108`, { ...sys, headers: key(1), body: { scope: { level: 'company', companyId: 1 }, enabled: false, reason: 'switching integrations off' } });
  for (const path of ['/connectors', '/connectors/catalog', '/integration-logs']) assert.equal((await api.call('GET', C + path, itadm)).status, 404, path);
  const ts = String(Math.floor(Date.now() / 1000));
  const raw = '{"a":1}';
  const res = await fetch(`${api.base}${C}/webhooks/mail.hook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-timestamp': ts, 'x-signature': signWebhook(WHSEC, ts, Buffer.from(raw)) }, body: raw });
  assert.equal(res.status, 404);
  assert.equal((await api.call('GET', `${C}/connectors`, { ...itadm, company: '2' })).status, 200, 'another company still has it');
  await api.close();
});

test('connectors of one company are invisible to another', async () => {
  const api = await startApi({}, { logger: quiet() });
  const id = await createSandbox(api);
  const other = { ...itadm, company: '2' };
  assert.equal((await api.call('GET', `${C}/connectors`, other)).json.data.length, 0);
  for (const path of [`/connectors/${id}`, `/connectors/${id}/secrets`]) assert.equal((await api.call('GET', C + path, other)).status, 404, path);
  assert.equal((await api.call('POST', `${C}/connectors/${id}/test`, { ...other, headers: key(1) })).status, 404);
  assert.equal((await api.call('POST', `${C}/connectors/${id}/change-requests`, { ...other, headers: key(2), body: { changes: { name: 'Hijack' }, reason: 'cross company' } })).status, 404);
  await api.close();
});

test('the catalogue lists the types, their providers, settings and credentials, and which types need the CFO', async () => {
  const api = await startApi({}, { logger: quiet() });
  const cat = (await api.call('GET', `${C}/connectors/catalog`, itadm)).json.data;
  assert.deepEqual(cat.map((t) => t.type), ['email', 'sms', 'whatsapp', 'gsp', 'bank', 'biometric', 'maps', 'ocr', 'ai', 'storage']);
  assert.deepEqual(cat.filter((t) => t.needsCfo).map((t) => t.type), ['gsp', 'bank']);
  const email = cat[0];
  assert.deepEqual(email.providers.map((p) => p.provider), ['sandbox', 'http_api', 'sendgrid']);
  assert.ok(email.providers[1].secrets.some((s) => s.name === 'api_key' && s.required));
  await api.close();
});
