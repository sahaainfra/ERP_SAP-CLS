import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULES } from '../src/server/modules/registry.js';
import { ERROR_CODES } from '../src/server/platform/http/errors.js';
import { ROOT } from '../src/server/platform/db/index.js';
import { startApi } from './helpers.js';

let api;
before(async () => {
  api = await startApi();
});
after(() => api.close());

const GUIDE = '/api/v1/core/architecture';

test('AC-06 the architecture guide is for SYSADM and ITADM only', async () => {
  for (const roles of ['SYSADM', 'ITADM']) assert.equal((await api.call('GET', GUIDE, { roles })).status, 200, roles);
  assert.equal((await api.call('GET', GUIDE, { roles: 'PM' })).status, 403);
  assert.equal((await api.call('GET', GUIDE, { user: null })).status, 401);
});

test('the guide serves the markdown, the module map, the error codes and the pagination contract', async () => {
  const d = (await api.call('GET', GUIDE, { roles: 'ITADM' })).json.data;
  assert.match(d.markdown, /^# Architecture and API conventions/);
  assert.deepEqual(d.modules.map((m) => m.code), MODULES.map((m) => m.code));
  assert.ok(d.modules[0].resources.includes('feature-flags'));
  assert.ok(!('mount' in d.modules[0]), 'functions never reach the client');
  assert.deepEqual(d.errorCodes, ERROR_CODES);
  assert.equal(d.pagination.limits.maxPageSize, 200);
  assert.match(d.pagination.response, /meta/);
});

test('AC-01 the folder structure in the guide matches the repository', () => {
  const guide = readFileSync(join(ROOT, 'docs', 'erp', 'ARCHITECTURE.md'), 'utf8');
  for (const dir of readdirSync(join(ROOT, 'src', 'server', 'platform'))) assert.ok(guide.includes(`platform/${dir}`), `guide mentions platform/${dir}`);
  for (const m of MODULES) {
    assert.ok(guide.includes(`modules/${m.code}`), `guide mentions modules/${m.code}`);
    const files = readdirSync(join(ROOT, 'src', 'server', 'modules', m.code));
    assert.ok(files.includes('index.js'), 'a module has an index.js that mounts it');
  }
});

test('BR-01 controllers hold no SQL and no business rules: no database access outside repositories and services', () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  for (const file of walk(join(ROOT, 'src', 'server', 'modules')).filter((f) => /(controller|routes|validators)\.js$/.test(f))) {
    const text = readFileSync(file, 'utf8');
    assert.ok(!/\.prepare\(|\.exec\(|SELECT |INSERT |UPDATE /.test(text), `${file} must not touch the database`);
  }
});

test('BR-02 no list endpoint can return an unbounded page', async () => {
  const r = await api.call('GET', '/api/v1/core/feature-flags?pageSize=201', { roles: 'SYSADM' });
  assert.equal(r.status, 400);
  const ok = await api.call('GET', '/api/v1/core/feature-flags?pageSize=200', { roles: 'SYSADM' });
  assert.equal(ok.json.meta.pageSize, 200);
});

test('the list endpoint now also sorts and filters through the shared helper, and rejects unknown columns', async () => {
  const sorted = await api.call('GET', '/api/v1/core/feature-flags?sort=-key&pageSize=3', { roles: 'SYSADM' });
  const keys = sorted.json.data.map((r) => r.key);
  assert.deepEqual(keys, [...keys].sort().reverse());
  const filtered = await api.call('GET', '/api/v1/core/feature-flags?filter[environment]=test', { roles: 'SYSADM' });
  assert.ok(filtered.json.data.length > 0 && filtered.json.data.every((r) => r.environment === 'test'));
  assert.equal((await api.call('GET', '/api/v1/core/feature-flags?sort=remarks', { roles: 'SYSADM' })).status, 400);
  assert.equal((await api.call('GET', '/api/v1/core/feature-flags?filter[remarks]=x', { roles: 'SYSADM' })).status, 400);
});

test('service-level guard: calling a service without the permission is refused even without HTTP', async () => {
  const { createFlagService } = await import('../src/server/modules/core/feature-flags/service.js');
  const { memoryDb } = await import('./helpers.js');
  const svc = createFlagService({ db: memoryDb(), environment: 'test' });
  const pm = { user: 'p', roles: ['PM'], companyId: 1 };
  assert.throws(() => svc.list(pm, { page: 1, pageSize: 25, q: '', sort: [], filters: {}, limit: 25, offset: 0 }), { status: 403 });
  assert.throws(() => svc.set(pm, 'ff.prog.p0001', { scope: { level: 'company', companyId: 1 }, enabled: true, reason: 'valid reason' }), { status: 403 });
});
