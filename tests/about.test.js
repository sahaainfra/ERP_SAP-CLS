import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.js';

let api;
before(async () => {
  api = await startApi();
});
after(() => api.close());

const ABOUT = '/api/v1/core/about';

test('AC-04 SYSADM and ITADM see version, build, commit and the applied migrations', async () => {
  for (const roles of ['SYSADM', 'ITADM']) {
    const r = await api.call('GET', ABOUT, { roles });
    assert.equal(r.status, 200, roles);
    const d = r.json.data;
    assert.match(d.version, /^\d+\.\d+\.\d+/);
    assert.equal(d.buildId, 'dev');
    assert.ok(d.commit);
    assert.equal(d.environment, 'test');
    assert.ok(d.migrations.length >= 4);
    assert.ok(d.migrations.every((m) => m.id && m.appliedAt));
  }
});

test('AC-04 everyone else is refused: no identity 401, other roles 403, no role 403', async () => {
  assert.equal((await api.call('GET', ABOUT, { user: null })).status, 401);
  assert.equal((await api.call('GET', ABOUT, { roles: 'PM' })).status, 403);
  assert.equal((await api.call('GET', ABOUT, {})).status, 403);
  const denied = await api.call('GET', ABOUT, { roles: 'PM' });
  assert.ok(!JSON.stringify(denied.json).includes('buildId'), 'a refusal leaks no build data');
});

test('the about response never includes secrets or environment variables', async () => {
  const text = JSON.stringify((await api.call('GET', ABOUT, { roles: 'SYSADM' })).json);
  assert.ok(!/DATABASE_PATH|AUTH_MODE|PATH=/i.test(text));
});
