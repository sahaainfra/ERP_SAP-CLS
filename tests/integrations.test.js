import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { createBreaker, createRateLimiter } from '../src/server/platform/integrations/breaker.js';
import { integrationsOf, IntegrationError } from '../src/server/platform/integrations/index.js';
import { endpointProblem, sandboxMessages } from '../src/server/platform/integrations/providers.js';
import { createVault } from '../src/server/platform/integrations/vault.js';
import { deliveryIdOf, signWebhook, verifyWebhook } from '../src/server/platform/integrations/webhooks.js';
import { memoryDb } from './helpers.js';

const SECRET = 'sk-live-abc123SECRETvalue'; // secret-scan:allow fake credential for the test
const actor = { user: 'ishaan', roles: ['ITADM'], companyId: 1 };
const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

function setup() {
  const clock = { t: Date.parse('2026-10-30T10:00:00.000Z') };
  const calls = [];
  const sleeps = [];
  const state = { handler: async () => reply(200, { ok: true }) };
  const db = memoryDb();
  const i = integrationsOf(db, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return state.handler(url, init);
    },
    now: () => clock.t,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.t += ms;
    },
  });
  const add = (over = {}, { secret = SECRET } = {}) => {
    const o = { code: 'mail.main', type: 'email', provider: 'http_api', status: 'ENABLED', timeout_ms: 2000, max_retries: 2, retry_backoff_ms: 500, rate_limit_per_minute: 60, breaker_threshold: 3, breaker_reset_seconds: 30, retention_days: 90, config: { baseUrl: 'http://127.0.0.1:9', fromAddress: 'noreply@example.com' }, ...over };
    const res = db.prepare(
      `INSERT INTO core_connectors (company_id, code, name, type, provider, environment, config_json, status, timeout_ms, max_retries, retry_backoff_ms, rate_limit_per_minute, breaker_threshold, breaker_reset_seconds, retention_days, created_by)
       VALUES (1, ?, 'Main mail', ?, ?, 'development', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'test')`,
    ).run(o.code, o.type, o.provider, JSON.stringify(o.config), o.status, o.timeout_ms, o.max_retries, o.retry_backoff_ms, o.rate_limit_per_minute, o.breaker_threshold, o.breaker_reset_seconds, o.retention_days);
    const c = db.prepare('SELECT * FROM core_connectors WHERE id = ?').get(Number(res.lastInsertRowid));
    if (secret) {
      i.secrets.stage(actor, c, 'api_key', secret);
      i.secrets.promote(c, ['api_key'], actor);
    }
    return c;
  };
  const mail = { to: ['a@example.com'], subject: 'Hello', text: 'Dear customer, PAN ABCDE1234F' };
  const logs = () => db.prepare('SELECT * FROM core_integration_logs ORDER BY id').all();
  return { db, i, clock, calls, sleeps, state, add, mail, logs };
}

test('AC-03 the vault encrypts at rest, binds a value to its slot, and detects tampering', () => {
  const vault = createVault({ secret: 'k'.repeat(40) });
  const blob = vault.encrypt(SECRET, '1/2/api_key');
  assert.ok(!blob.includes(SECRET) && blob.startsWith('v1.'));
  assert.equal(vault.decrypt(blob, '1/2/api_key'), SECRET);
  assert.throws(() => vault.decrypt(blob, '1/3/api_key'), 'the same ciphertext does not open in another slot');
  assert.throws(() => vault.decrypt(blob.slice(0, -2) + 'AA', '1/2/api_key'));
  assert.throws(() => createVault({ secret: 'z'.repeat(40) }).decrypt(blob, '1/2/api_key'), 'another key cannot read it');
  assert.notEqual(vault.encrypt(SECRET, 'x'), vault.encrypt(SECRET, 'x'), 'a fresh nonce each time');
});

test('AC-03 / T-03 stored secrets are ciphertext, reading is audited, and nothing but read() returns a value', () => {
  const { db, i, add } = setup();
  const c = add();
  const stored = db.prepare('SELECT encrypted_value FROM core_connector_secrets WHERE connector_id = ?').get(c.id).encrypted_value;
  assert.ok(!stored.includes(SECRET));
  assert.deepEqual(i.secrets.describe(c.id).map((s) => [s.key, s.status, s.isSet]), [['api_key', 'ACTIVE', true]]);
  assert.ok(!JSON.stringify(i.secrets.describe(c.id)).includes(SECRET));
  const out = i.secrets.read(c, ['api_key', 'webhook_secret'], { purpose: 'unit test', actor: 'ishaan' });
  assert.deepEqual(out.values, { api_key: SECRET });
  const audit = db.prepare("SELECT * FROM core_audit_log WHERE entity = 'core_connector_secrets' AND action = 'access'").all();
  assert.equal(audit.length, 1);
  assert.deepEqual(JSON.parse(audit[0].new_values), { connector: 'mail.main', keys: ['api_key'], purpose: 'unit test' });
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM core_audit_log').all()).includes(SECRET), 'no audit row holds a value');
});

test('rotation: a staged value replaces the active one only on promotion, and an expired value is refused', () => {
  const { db, i, add, clock } = setup();
  const c = add();
  i.secrets.stage(actor, c, 'api_key', 'new-value-123456');
  assert.equal(i.secrets.read(c, ['api_key']).values.api_key, SECRET, 'still the old value until approved');
  assert.deepEqual(i.secrets.describe(c.id).map((s) => s.status), ['ACTIVE', 'PENDING']);
  i.secrets.promote(c, ['api_key'], actor);
  assert.equal(i.secrets.read(c, ['api_key']).values.api_key, 'new-value-123456');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM core_connector_secrets WHERE status = 'RETIRED'").get().n, 1);
  assert.throws(() => i.secrets.promote(c, ['nothing_staged'], actor), /no longer staged/);
  i.secrets.stage(actor, c, 'api_key', 'third-value-123456', { expiresAt: new Date(clock.t - 1000).toISOString() });
  i.secrets.promote(c, ['api_key'], actor);
  assert.deepEqual(i.secrets.read(c, ['api_key']).expired, ['api_key']);
});

test('T-01 the circuit breaker opens after repeated failures, probes once after the reset time, and closes on recovery', () => {
  let t = 0;
  const b = createBreaker({ threshold: 3, resetMs: 1000, now: () => t });
  assert.equal(b.allow(), true);
  assert.deepEqual([b.failure(), b.failure(), b.failure()], [null, null, 'open']);
  assert.equal(b.allow(), false, 'open: calls are refused');
  t = 999;
  assert.equal(b.allow(), false);
  t = 1000;
  assert.equal(b.allow(), true, 'one probe goes through');
  assert.equal(b.allow(), false, 'but only one');
  assert.equal(b.failure(), 'open', 'a failed probe opens it again');
  t = 2000;
  assert.equal(b.allow(), true);
  assert.equal(b.success(), 'closed');
  assert.deepEqual([b.allow(), b.snapshot().state, b.snapshot().failures], [true, 'closed', 0]);
  b.failure();
  b.success();
  assert.deepEqual([b.failure(), b.failure()], [null, null], 'a success resets the count');
});

test('the rate limiter allows N calls per sliding minute', () => {
  let t = 0;
  const r = createRateLimiter({ now: () => t });
  assert.deepEqual([r.take('a', 2).ok, r.take('a', 2).ok, r.take('a', 2).ok], [true, true, false]);
  assert.equal(r.take('b', 2).ok, true, 'limits are per key');
  t = 60_001;
  assert.equal(r.take('a', 2).ok, true);
});

test('AC-01 a call goes through the abstraction: credentials from the vault, redacted log, idempotency key and correlation ID passed on', async () => {
  const { i, add, calls, logs, mail } = setup();
  add();
  const out = await i.hub.call('mail.main', 'send', mail, { companyId: 1, actor, idempotencyKey: 'idem-0001', correlationId: 'corr-abc-0001' });
  assert.equal(out.ok, true);
  assert.equal(out.attempts, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:9/send');
  assert.equal(calls[0].init.headers.authorization, `Bearer ${SECRET}`);
  assert.equal(calls[0].init.headers['idempotency-key'], 'idem-0001');
  assert.equal(calls[0].init.headers['x-correlation-id'], 'corr-abc-0001');
  const [row] = logs();
  assert.deepEqual([row.direction, row.operation, row.status, row.http_status, row.attempts, row.correlation_id], ['outbound', 'send', 'success', 200, 1, 'corr-abc-0001']);
  assert.match(row.user_ref, /^u_[0-9a-f]{10}$/);
  assert.ok(!row.request_redacted.includes('Dear customer') && !row.request_redacted.includes('ABCDE1234F'), 'message text and identifiers are not logged');
  assert.ok(row.request_redacted.includes('Hello') && row.request_redacted.includes('"to"'), 'the shape of the request is');
});

test('AC-01 the sandbox provider needs no network and keeps what it was sent', async () => {
  const { i, add, mail, calls } = setup();
  add({ code: 'mail.sandbox', provider: 'sandbox', config: { fromAddress: 'noreply@example.com' } }, { secret: null });
  const before = sandboxMessages().length;
  const out = await i.hub.call('mail.sandbox', 'send', mail, { companyId: 1, actor });
  assert.equal(out.data.accepted, 1);
  assert.equal(calls.length, 0);
  assert.equal(sandboxMessages().length, before + 1);
});

test('FR-04 retryable failures are retried with doubling back-off and the attempts are logged once', async () => {
  const { i, add, state, sleeps, calls, logs, mail } = setup();
  add();
  let n = 0;
  state.handler = async () => (++n < 3 ? reply(503, { error: 'busy' }) : reply(200, { ok: true }));
  const out = await i.hub.call('mail.main', 'send', mail, { companyId: 1, actor });
  assert.deepEqual([out.attempts, calls.length, sleeps], [3, 3, [500, 1000]]);
  assert.equal(logs().length, 1);
  assert.equal(logs()[0].attempts, 3);
});

test('FR-04 a 4xx answer is not retried and does not count against the provider', async () => {
  const { i, add, state, calls, logs, mail } = setup();
  add({ breaker_threshold: 1 });
  state.handler = async () => reply(400, { error: 'bad address' });
  await assert.rejects(i.hub.call('mail.main', 'send', mail, { companyId: 1, actor }), (e) => e instanceof IntegrationError && e.code === 'PROVIDER_ERROR' && e.retryable === false && e.httpStatus === 400);
  assert.equal(calls.length, 1);
  assert.equal(i.hub.breakerState(1).state, 'closed', 'a bad request does not open the circuit');
  assert.equal(logs()[0].status, 'failure');
});

test('FR-04 a provider that does not answer in time is a timeout', async () => {
  const { i, add, state, logs, mail } = setup();
  add({ timeout_ms: 100, max_retries: 0 });
  state.handler = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  await assert.rejects(i.hub.call('mail.main', 'send', mail, { companyId: 1, actor }), (e) => e.code === 'TIMEOUT' && e.retryable === true);
  assert.equal(logs()[0].status, 'timeout');
});

test('T-01 the breaker trips after repeated failures, fails fast without calling out, then recovers; the change is announced as an event', async () => {
  const { db, i, add, state, calls, clock, logs, mail } = setup();
  add({ max_retries: 0, breaker_threshold: 3, breaker_reset_seconds: 30 });
  state.handler = async () => reply(500, { error: 'down' });
  for (let n = 0; n < 3; n += 1) await assert.rejects(i.hub.call('mail.main', 'send', mail, { companyId: 1, actor }), (e) => e.code === 'PROVIDER_ERROR');
  assert.equal(calls.length, 3);
  assert.equal(i.hub.breakerState(1).state, 'open');
  await assert.rejects(i.hub.call('mail.main', 'send', mail, { companyId: 1, actor }), (e) => e.code === 'CIRCUIT_OPEN' && e.retryable === true && e.retryAfterMs > 0);
  assert.equal(calls.length, 3, 'no call reached the provider while open');
  assert.equal(logs().at(-1).status, 'circuit_open');
  clock.t += 31_000;
  state.handler = async () => reply(200, { ok: true });
  assert.equal((await i.hub.call('mail.main', 'send', mail, { companyId: 1, actor })).ok, true, 'the probe succeeds');
  assert.equal(i.hub.breakerState(1).state, 'closed');
  const events = db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'core.connector.health_changed' ORDER BY id").all().map((r) => JSON.parse(r.payload).data.state);
  assert.deepEqual(events, ['circuit_open', 'circuit_closed']);
});

test('FR-04 the rate limit is per connector and refuses with a retry hint', async () => {
  const { i, add, clock, calls, mail } = setup();
  add({ rate_limit_per_minute: 2 });
  await i.hub.call('mail.main', 'send', mail, { companyId: 1, actor });
  await i.hub.call('mail.main', 'send', mail, { companyId: 1, actor });
  await assert.rejects(i.hub.call('mail.main', 'send', mail, { companyId: 1, actor }), (e) => e.code === 'RATE_LIMITED' && e.retryAfterMs > 0);
  assert.equal(calls.length, 2);
  clock.t += 61_000;
  assert.equal((await i.hub.call('mail.main', 'send', mail, { companyId: 1, actor })).ok, true);
});

test('a call is refused, and logged, when the connector is off, unapproved, mis-set or the request is invalid', async () => {
  const { i, add, logs, mail, calls } = setup();
  add({ code: 'mail.off', status: 'DISABLED' });
  add({ code: 'mail.new', status: 'PENDING' });
  add({ code: 'mail.nokey' }, { secret: null });
  add({ code: 'mail.ok' });
  const code = async (name, op, payload, companyId = 1) => i.hub.call(name, op, payload, { companyId, actor }).then(() => 'ok', (e) => e.code);
  assert.equal(await code('mail.off', 'send', mail), 'CONNECTOR_DISABLED');
  assert.equal(await code('mail.new', 'send', mail), 'CONNECTOR_NOT_APPROVED');
  assert.equal(await code('mail.nokey', 'send', mail), 'SECRET_MISSING');
  assert.equal(await code('mail.ok', 'fax', mail), 'UNKNOWN_OPERATION');
  assert.equal(await code('mail.ok', 'send', { to: ['nope'], subject: '', text: '' }), 'INVALID_PAYLOAD');
  assert.equal(await code('mail.none', 'send', mail), 'CONNECTOR_NOT_FOUND');
  assert.equal(await code('mail.ok', 'send', mail, 2), 'CONNECTOR_NOT_FOUND', 'another company cannot use this connector');
  assert.equal(calls.length, 0);
  assert.deepEqual(logs().map((l) => l.status), ['rejected', 'rejected', 'rejected', 'rejected', 'rejected']);
});

test('T-03 a credential that comes back in a provider response or error never reaches the log', async () => {
  const { i, add, state, logs, mail } = setup();
  add({ max_retries: 0 });
  state.handler = async () => reply(200, { echoed: `token=${SECRET}`, note: 'ok' });
  await i.hub.call('mail.main', 'send', mail, { companyId: 1, actor });
  state.handler = async () => reply(500, { detail: `bad key ${SECRET}` });
  await assert.rejects(i.hub.call('mail.main', 'send', mail, { companyId: 1, actor }));
  const all = JSON.stringify(logs());
  assert.ok(!all.includes(SECRET), 'the secret value is not in the log');
  assert.ok(all.includes('[secret]'), 'it was replaced');
});

test('FR-07 test connection records health, and a change of health is announced', async () => {
  const { db, i, add, state } = setup();
  const c = add({ max_retries: 0 });
  const ok = await i.hub.testConnection(c.id, { actor });
  assert.equal(ok.status, 'ok');
  state.handler = async () => reply(500, { error: 'down' });
  const bad = await i.hub.testConnection(c.id, { actor });
  assert.equal(bad.status, 'failed');
  assert.match(bad.message, /HTTP 500/);
  const row = db.prepare('SELECT last_health_status, last_health_message FROM core_connectors WHERE id = ?').get(c.id);
  assert.equal(row.last_health_status, 'failed');
  assert.equal(i.hub.breakerState(c.id).state, 'closed', 'a health test does not trip the breaker');
  const states = db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'core.connector.health_changed' ORDER BY id").all().map((r) => JSON.parse(r.payload).data.state);
  assert.deepEqual(states, ['healthy', 'unhealthy']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM core_integration_logs WHERE direction = 'test'").get().n, 2);
});

test('FR-05 the log is purged per connector retention', async () => {
  const { db, i, add, mail, clock } = setup();
  const c = add({ retention_days: 7 });
  await i.hub.call('mail.main', 'send', mail, { companyId: 1, actor });
  db.prepare("UPDATE core_integration_logs SET created_at = '2026-10-01T00:00:00.000Z'").run();
  await i.hub.call('mail.main', 'send', mail, { companyId: 1, actor });
  assert.equal(i.hub.purgeLogs(), 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM core_integration_logs WHERE connector_id = ?').get(c.id).n, 1);
  assert.ok(clock.t > 0);
});

test('T-02 a webhook needs a valid signature and a fresh timestamp; delivery IDs identify a replay', () => {
  const body = Buffer.from('{"event":"paid"}');
  const nowMs = Date.parse('2026-10-30T10:00:00Z');
  const ts = String(Math.floor(nowMs / 1000));
  const sig = signWebhook('whsec_123456', ts, body);
  assert.deepEqual(verifyWebhook({ secret: 'whsec_123456', rawBody: body, signature: sig, timestamp: ts, nowMs }), { ok: true }); // secret-scan:allow fake credential for the test
  assert.deepEqual(verifyWebhook({ secret: 'whsec_123456', rawBody: body, signature: `sha256=${sig}`, timestamp: ts, nowMs }), { ok: true }); // secret-scan:allow fake credential for the test
  const reason = (args) => verifyWebhook({ secret: 'whsec_123456', rawBody: body, signature: sig, timestamp: ts, nowMs, ...args }).reason; // secret-scan:allow fake credential for the test
  assert.equal(reason({ signature: undefined }), 'missing_signature');
  assert.equal(reason({ signature: sig.replace(/.$/, sig.endsWith('0') ? '1' : '0') }), 'bad_signature');
  assert.equal(reason({ rawBody: Buffer.from('{"event":"refund"}') }), 'bad_signature', 'a changed body fails');
  assert.equal(reason({ secret: 'another' }), 'bad_signature');
  assert.equal(reason({ timestamp: 'abc' }), 'bad_timestamp');
  assert.equal(reason({ nowMs: nowMs + 301_000 }), 'stale_timestamp');
  assert.equal(reason({ signature: 'short' }), 'bad_signature');
  assert.equal(deliveryIdOf('evt_42', sig, ts), 'evt_42');
  assert.equal(deliveryIdOf(undefined, sig, ts), deliveryIdOf('bad id with spaces', sig, ts));
});

test('endpoint rules: https only, plain http only to localhost outside production, no private addresses in production', () => {
  assert.equal(endpointProblem('https://api.example.com', 'production'), null);
  assert.equal(endpointProblem('http://localhost:8080', 'development'), null);
  assert.match(endpointProblem('http://localhost:8080', 'production'), /https/);
  assert.match(endpointProblem('http://api.example.com', 'development'), /https/);
  assert.match(endpointProblem('https://10.0.0.5', 'production'), /private/);
  assert.match(endpointProblem('https://192.168.1.4', 'production'), /private/);
  assert.match(endpointProblem('not a url', 'development'), /valid/);
});
