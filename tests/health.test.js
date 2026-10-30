import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.js';

const READY = '/health/ready';
const fresh = async (config = {}, app = {}) => startApi(config, app);

test('live is public and needs no dependency', async () => {
  const api = await fresh();
  const r = await api.call('GET', '/health/live', { user: null });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { status: 'ok' });
  await api.close();
});

test('ready reports database, queue and storage as ok for an administrator', async () => {
  const api = await fresh();
  for (const roles of ['ITADM', 'SYSADM']) {
    const r = await api.call('GET', READY, { roles });
    assert.equal(r.status, 200, roles);
    assert.equal(r.json.status, 'ok');
    assert.deepEqual(Object.keys(r.json.checks).sort(), ['database', 'queue', 'storage']);
    for (const c of Object.values(r.json.checks)) assert.ok(c.status === 'ok' && Number.isInteger(c.ms) && c.detail);
  }
  await api.close();
});

test('ready is restricted: no identity 401, other roles 403, and it reveals nothing to them', async () => {
  const api = await fresh();
  const none = await api.call('GET', READY, { user: null });
  assert.equal(none.status, 401);
  const pm = await api.call('GET', READY, { roles: 'PM' });
  assert.equal(pm.status, 403);
  assert.ok(!JSON.stringify([none.json, pm.json]).includes('checks'));
  await api.close();
});

test('AC-03 database stopped: ready is 503 and names the database; live still answers', async () => {
  const api = await fresh();
  api.db.close();
  const r = await api.call('GET', READY, { roles: 'ITADM' });
  assert.equal(r.status, 503);
  assert.equal(r.json.status, 'fail');
  assert.equal(r.json.checks.database.status, 'fail');
  assert.ok(!/SELECT|at \w+\.js/.test(JSON.stringify(r.json)), 'no SQL or stack in the detail');
  assert.equal((await api.call('GET', '/health/live', { user: null })).status, 200);
  await api.close();
});

test('AC-03 queue stopped (outbox unreadable): 503 naming the queue, other checks still report ok', async () => {
  const api = await fresh();
  api.db.exec('DROP TABLE core_outbox');
  const r = await api.call('GET', READY, { roles: 'ITADM' });
  assert.equal(r.status, 503);
  assert.equal(r.json.checks.queue.status, 'fail');
  assert.equal(r.json.checks.database.status, 'ok');
  assert.equal(r.json.checks.storage.status, 'ok');
  await api.close();
});

test('AC-03 storage unavailable: 503 naming storage', async () => {
  const api = await fresh({}, { storagePath: 'Z:/this/folder/does/not/exist' });
  const r = await api.call('GET', READY, { roles: 'ITADM' });
  assert.equal(r.status, 503);
  assert.equal(r.json.checks.storage.status, 'fail');
  assert.equal(r.json.checks.database.status, 'ok');
  await api.close();
});

test('a stale unpublished event backlog is "degraded": still 200, but visible', async () => {
  const api = await fresh();
  api.db
    .prepare("INSERT INTO core_outbox (event_type, aggregate_id, payload, created_at) VALUES ('x.y.z', '1', '{}', ?)")
    .run(new Date(Date.now() - 60 * 60 * 1000).toISOString());
  const r = await api.call('GET', READY, { roles: 'ITADM' });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'degraded');
  assert.equal(r.json.checks.queue.status, 'degraded');
  await api.close();
});

test('a monitoring token opens ready without a user; a wrong or missing token does not', async () => {
  const token = 'monitoring-token-0123456789';
  const api = await fresh({ HEALTH_TOKEN: token });
  const ok = await api.call('GET', READY, { user: null, headers: { 'x-health-token': token } });
  assert.equal(ok.status, 200);
  const wrong = await api.call('GET', READY, { user: null, headers: { 'x-health-token': `${token}x` } });
  assert.equal(wrong.status, 401);
  assert.equal((await api.call('GET', READY, { user: null })).status, 401);
  await api.close();
  const noTokenConfigured = await fresh();
  assert.equal((await noTokenConfigured.call('GET', READY, { user: null, headers: { 'x-health-token': token } })).status, 401);
  await noTokenConfigured.close();
});

test('a too-short HEALTH_TOKEN is refused at start-up', async () => {
  await assert.rejects(fresh({ HEALTH_TOKEN: 'short' }), /at least 16 characters/);
});
