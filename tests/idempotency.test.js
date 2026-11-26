import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { errorHandler } from '../src/server/platform/http/errors.js';
import { silentLogger } from '../src/server/platform/http/logger.js';
import { applyPipeline } from '../src/server/platform/http/pipeline.js';
import { idempotency, requestHash } from '../src/server/platform/http/idempotency.js';
import { memoryDb, startApi } from './helpers.js';

// A tiny "payment" endpoint that counts how many times it really ran.
async function payApp({ required = true, clock = { now: Date.now() } } = {}) {
  const db = memoryDb();
  const state = { runs: 0 };
  const app = express();
  applyPipeline(app, { logger: silentLogger });
  app.use((req, _res, next) => {
    req.actor = { user: req.get('x-user') ?? 'meera' };
    next();
  });
  const idem = idempotency(db, { required, now: () => clock.now });
  app.post('/pay', idem, (req, res) => {
    if (req.body.amount < 0) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'bad amount', details: [], correlationId: req.correlationId } });
    if (req.body.amount === 999) return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'boom', details: [], correlationId: req.correlationId } });
    state.runs += 1;
    res.status(201).json({ data: { payment: state.runs, amount: req.body.amount } });
  });
  app.post('/refund', idem, (_req, res) => res.status(201).json({ data: { refund: true } }));
  app.use(errorHandler(silentLogger));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body, { key, user } = {}) => {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}), ...(user ? { 'x-user': user } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, headers: res.headers, json: await res.json() };
  };
  return { db, state, post, clock, close: () => new Promise((r) => server.close(r)) };
}

test('T-02 a repeated request with the same key and body returns the stored response and does not run again', async () => {
  const app = await payApp();
  const first = await app.post('/pay', { amount: 100 }, { key: 'pay-key-0001' });
  const second = await app.post('/pay', { amount: 100 }, { key: 'pay-key-0001' });
  assert.equal(first.status, 201);
  assert.deepEqual(second.json, first.json);
  assert.equal(second.status, first.status);
  assert.equal(second.headers.get('idempotency-replayed'), 'true');
  assert.equal(first.headers.get('idempotency-replayed'), null);
  assert.equal(app.state.runs, 1, 'the action ran exactly once');
  await app.close();
});

test('T-02 / BR-02 the same key with a different body is rejected with 422 and does not run', async () => {
  const app = await payApp();
  await app.post('/pay', { amount: 100 }, { key: 'pay-key-0002' });
  const r = await app.post('/pay', { amount: 250 }, { key: 'pay-key-0002' });
  assert.equal(r.status, 422);
  assert.equal(r.json.error.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.match(r.json.error.message, /different request/);
  assert.equal(app.state.runs, 1);
  await app.close();
});

test('the order of keys in the JSON body does not matter, but the content does', async () => {
  const app = await payApp();
  await app.post('/pay', { amount: 5, note: { a: 1, b: 2 } }, { key: 'pay-key-0003' });
  const same = await app.post('/pay', { note: { b: 2, a: 1 }, amount: 5 }, { key: 'pay-key-0003' });
  assert.equal(same.headers.get('idempotency-replayed'), 'true');
  const other = await app.post('/pay', { note: { b: 3, a: 1 }, amount: 5 }, { key: 'pay-key-0003' });
  assert.equal(other.status, 422);
  assert.equal(requestHash({ method: 'POST', originalUrl: '/x', body: { a: 1, b: 2 } }), requestHash({ method: 'POST', originalUrl: '/x', body: { b: 2, a: 1 } }));
  await app.close();
});

test('keys are scoped to the user and to the endpoint', async () => {
  const app = await payApp();
  await app.post('/pay', { amount: 1 }, { key: 'shared-key-01', user: 'meera' });
  const otherUser = await app.post('/pay', { amount: 1 }, { key: 'shared-key-01', user: 'ravi' });
  assert.equal(otherUser.headers.get('idempotency-replayed'), null);
  const otherEndpoint = await app.post('/refund', {}, { key: 'shared-key-01', user: 'meera' });
  assert.equal(otherEndpoint.status, 201);
  assert.equal(otherEndpoint.headers.get('idempotency-replayed'), null);
  assert.equal(app.state.runs, 2);
  await app.close();
});

test('a required key must be present and well formed', async () => {
  const app = await payApp();
  const missing = await app.post('/pay', { amount: 1 });
  assert.equal(missing.status, 400);
  assert.deepEqual(missing.json.error.details.map((d) => d.field), ['Idempotency-Key']);
  assert.equal((await app.post('/pay', { amount: 1 }, { key: 'short' })).status, 400);
  assert.equal((await app.post('/pay', { amount: 1 }, { key: 'has spaces in it' })).status, 400);
  assert.equal(app.state.runs, 0);
  await app.close();
});

test('an optional key (required: false) lets a request without one run normally', async () => {
  const app = await payApp({ required: false });
  assert.equal((await app.post('/pay', { amount: 1 })).status, 201);
  assert.equal((await app.post('/pay', { amount: 1 })).status, 201);
  assert.equal(app.state.runs, 2);
  await app.close();
});

test('only successful responses are stored: after a 400 or a 500 the same key can be used again', async () => {
  const app = await payApp();
  const bad = await app.post('/pay', { amount: -1 }, { key: 'pay-key-0004' });
  assert.equal(bad.status, 400);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM core_idempotency_keys').get().n, 0, 'a failed request leaves no key behind');
  const fixed = await app.post('/pay', { amount: 10 }, { key: 'pay-key-0004' });
  assert.equal(fixed.status, 201, 'a corrected request can reuse the key');
  const crash = await app.post('/pay', { amount: 999 }, { key: 'pay-key-0005' });
  assert.equal(crash.status, 500);
  assert.equal((await app.post('/pay', { amount: 5 }, { key: 'pay-key-0005' })).status, 201);
  await app.close();
});

test('a key expires: after the retention time the same key runs the action again', async () => {
  const clock = { now: Date.parse('2026-10-30T10:00:00Z') };
  const app = await payApp({ clock });
  await app.post('/pay', { amount: 1 }, { key: 'pay-key-0006' });
  clock.now += 23 * 60 * 60 * 1000;
  assert.equal((await app.post('/pay', { amount: 1 }, { key: 'pay-key-0006' })).headers.get('idempotency-replayed'), 'true');
  clock.now += 2 * 60 * 60 * 1000;
  const later = await app.post('/pay', { amount: 1 }, { key: 'pay-key-0006' });
  assert.equal(later.headers.get('idempotency-replayed'), null);
  assert.equal(app.state.runs, 2);
  await app.close();
});

test('expired keys are purged as new ones arrive, so the table does not grow without bound', async () => {
  const clock = { now: Date.parse('2026-10-30T10:00:00Z') };
  const app = await payApp({ clock });
  for (let i = 0; i < 5; i++) await app.post('/pay', { amount: i }, { key: `old-key-${i}-abcdef` });
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM core_idempotency_keys').get().n, 5);
  clock.now += 48 * 60 * 60 * 1000;
  await app.post('/pay', { amount: 100 }, { key: 'new-key-abcdef' });
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM core_idempotency_keys').get().n, 1);
  await app.close();
});

test('a second request with a key whose first request is still running gets 409 REQUEST_IN_PROGRESS', async () => {
  const app = await payApp();
  const body = { amount: 7 };
  const hash = requestHash({ method: 'POST', originalUrl: '/pay', body });
  app.db
    .prepare('INSERT INTO core_idempotency_keys (key, user_id, endpoint, request_hash, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run('inflight-key-01', 'meera', 'POST /pay', hash, new Date(Date.now() + 3600_000).toISOString());
  const r = await app.post('/pay', body, { key: 'inflight-key-01' });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, 'REQUEST_IN_PROGRESS');
  assert.equal(app.state.runs, 0);
  await app.close();
});

test('a retry that takes over an abandoned claim keeps its answer when the original request ends late', async () => {
  const db = memoryDb();
  const clock = { now: Date.now() };
  let release; const held = new Promise((r) => { release = r; });
  let runs = 0;
  const app = express();
  applyPipeline(app, { logger: silentLogger });
  app.use((req, _res, next) => { req.actor = { user: 'meera' }; next(); });
  app.post('/post', idempotency(db, { required: true, now: () => clock.now }), async (req, res) => {
    runs += 1; const mine = runs;
    if (mine === 1) { await held; return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'late failure', details: [] } }); }
    res.status(201).json({ data: { run: mine } });
  });
  app.use(errorHandler(silentLogger));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const post = async () => { const res = await fetch(`http://127.0.0.1:${server.address().port}/post`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'slow-key-0001' }, body: '{}' }); return { status: res.status, json: await res.json() }; };
  const first = post();
  while (runs === 0) await new Promise((r) => setTimeout(r, 5));
  clock.now += 16 * 60 * 1000; // the first claim looks abandoned
  const retry = await post();
  assert.deepEqual([retry.status, retry.json.data.run], [201, 2], 'the retry took over the claim and ran');
  release(); assert.equal((await first).status, 500);
  await new Promise((r) => setTimeout(r, 20));
  const again = await post();
  assert.deepEqual([again.status, again.json.data?.run], [201, 2], 'the late failure of the original did not remove the retry\'s answer: it is replayed');
  assert.equal(runs, 2);
  await new Promise((r) => server.close(r));
});

test('the real app: a flag change retried with the same Idempotency-Key is applied once', async () => {
  const api = await startApi();
  const body = { scope: { level: 'company', companyId: 1 }, enabled: false, reason: 'retry safe change' };
  const headers = { 'idempotency-key': 'flag-change-0001' };
  const first = await api.call('PATCH', '/api/v1/core/feature-flags/ff.prog.p0001', { roles: 'SYSADM', body, headers });
  const retry = await api.call('PATCH', '/api/v1/core/feature-flags/ff.prog.p0001', { roles: 'SYSADM', body, headers });
  assert.equal(first.status, 200);
  assert.deepEqual(retry.json, first.json);
  assert.equal(retry.headers.get('idempotency-replayed'), 'true');
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'core_feature_flags'").get().n, 1, 'audited once');
  const different = await api.call('PATCH', '/api/v1/core/feature-flags/ff.prog.p0001', { roles: 'SYSADM', body: { ...body, enabled: true }, headers });
  assert.equal(different.status, 422);
  await api.close();
});
