import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.js';

let api;
before(async () => {
  api = await startApi();
});
after(() => api.close());

const LIST = '/api/v1/core/feature-flags';

test('401 without identity, with the standard error envelope and a correlation id', async () => {
  const r = await api.call('GET', LIST, { user: null });
  assert.equal(r.status, 401);
  assert.equal(r.json.error.code, 'UNAUTHENTICATED');
  assert.ok(r.json.error.correlationId);
  assert.equal(r.headers.get('x-correlation-id'), r.json.error.correlationId);
  assert.ok(!JSON.stringify(r.json).includes('at '), 'no stack trace');
});

test('403 for roles without core.flag.view (deny by default)', async () => {
  assert.equal((await api.call('GET', LIST, { roles: 'PM' })).status, 403);
  assert.equal((await api.call('GET', LIST, {})).status, 403);
});

test('ITADM can view but not configure; SYSADM can do both', async () => {
  assert.equal((await api.call('GET', LIST, { roles: 'ITADM' })).status, 200);
  const body = { scope: { level: 'company', companyId: 1 }, enabled: true, reason: 'pilot rollout' };
  assert.equal((await api.call('PATCH', `${LIST}/ff.prog.p0001`, { roles: 'ITADM', body })).status, 403);
  assert.equal((await api.call('PATCH', `${LIST}/ff.prog.p0001`, { roles: 'SYSADM', body })).status, 200);
});

test('list returns paginated data with meta and honours search', async () => {
  const r = await api.call('GET', `${LIST}?page=1&pageSize=2&q=p0002`, { roles: 'SYSADM' });
  assert.equal(r.status, 200);
  assert.ok(r.json.data.length <= 2 && r.json.data.every((x) => x.key === 'ff.prog.p0002'));
  assert.equal(r.json.meta.pageSize, 2);
  assert.ok(r.json.meta.total >= 3);
  assert.equal((await api.call('GET', `${LIST}?pageSize=500`, { roles: 'SYSADM' })).status, 400);
});

test('400 validation errors list the offending fields', async () => {
  const bad = await api.call('PATCH', `${LIST}/ff.prog.p0001`, {
    roles: 'SYSADM',
    body: { scope: { level: 'project', companyId: 1 }, enabled: 'yes', reason: 'x' },
  });
  assert.equal(bad.status, 400);
  const fields = bad.json.error.details.map((d) => d.field);
  assert.ok(fields.includes('enabled') && fields.includes('reason'), fields.join(','));
  const noProject = await api.call('PATCH', `${LIST}/ff.prog.p0001`, {
    roles: 'SYSADM',
    body: { scope: { level: 'project', companyId: 1 }, enabled: true, reason: 'valid reason' },
  });
  assert.equal(noProject.status, 400);
  assert.ok(noProject.json.error.details.some((d) => d.field === 'scope.projectId'));
});

test('PATCH needs a reason and writes an audit row with the actor', async () => {
  const r = await api.call('PATCH', `${LIST}/ff.prog.p0001`, {
    user: 'meera',
    roles: 'SYSADM',
    body: { scope: { level: 'environment', environment: 'production' }, enabled: true, reason: 'go-live approved' },
  });
  assert.equal(r.status, 200);
  const audit = api.db.prepare("SELECT * FROM core_audit_log WHERE actor = 'meera'").all();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].correlation_id, r.json ? r.headers.get('x-correlation-id') : null);
});

test('409 on a missing or stale version; the retry with the current version succeeds', async () => {
  const patch = (version, enabled) =>
    api.call('PATCH', `${LIST}/ff.prog.p0002`, {
      roles: 'SYSADM',
      body: { scope: { level: 'company', companyId: 1 }, enabled, reason: 'rollback test', version },
    });
  const created = await patch(undefined, true);
  assert.equal(created.status, 200);
  assert.equal(created.json.data.version, 1);
  assert.equal((await patch(undefined, false)).status, 409);
  const stale = await patch(7, false);
  assert.equal(stale.status, 409);
  assert.match(stale.json.error.message, /Refresh/);
  const ok = await patch(1, false);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.version, 2);
  assert.equal(ok.json.data.enabled, false);
});

test('evaluate returns booleans for the caller scope and scoped changes apply immediately', async () => {
  const before = await api.call('GET', `${LIST}/evaluate?keys=ff.prog.p0001,ff.nope`, { roles: '' });
  assert.equal(before.status, 200);
  assert.deepEqual(Object.keys(before.json.data).sort(), ['ff.nope', 'ff.prog.p0001']);
  assert.equal(before.json.data['ff.nope'], false);
  const patch = await api.call('PATCH', `${LIST}/ff.prog.p0001`, {
    roles: 'SYSADM',
    company: '3',
    body: { scope: { level: 'company', companyId: 3 }, enabled: false, reason: 'disable for company 3' },
  });
  assert.equal(patch.status, 200);
  const c3 = await api.call('GET', `${LIST}/evaluate?keys=ff.prog.p0001`, { company: '3' });
  const c4 = await api.call('GET', `${LIST}/evaluate?keys=ff.prog.p0001`, { company: '4' });
  assert.equal(c3.json.data['ff.prog.p0001'], false, 'company 3 override applies at once');
  assert.equal(c4.json.data['ff.prog.p0001'], true, 'other companies keep the environment default (ON in test)');
});

test('cross-company isolation: no evaluating, changing or listing another company', async () => {
  assert.equal((await api.call('GET', `${LIST}/evaluate?keys=ff.prog.p0001&company_id=2`, { company: '1' })).status, 403);
  const body = { scope: { level: 'company', companyId: 2 }, enabled: true, reason: 'sneaky change' };
  assert.equal((await api.call('PATCH', `${LIST}/ff.prog.p0001`, { roles: 'SYSADM', company: '1', body })).status, 403);
  await api.call('PATCH', `${LIST}/ff.prog.p0001`, { roles: 'SYSADM', company: '7', body: { ...body, scope: { level: 'company', companyId: 7 } } });
  const list = await api.call('GET', `${LIST}?pageSize=200`, { roles: 'SYSADM', company: '1' });
  assert.ok(list.json.data.every((x) => x.companyId == null || x.companyId === 1), 'company 7 rows must not leak');
});

test('idempotent replay: repeating the same PATCH leaves the same value and a consistent history', async () => {
  const body = { scope: { level: 'environment', environment: 'staging' }, enabled: true, reason: 'replay safe' };
  const first = await api.call('PATCH', `${LIST}/ff.prog.p0002`, { roles: 'SYSADM', body });
  assert.equal(first.status, 200);
  const replay = await api.call('PATCH', `${LIST}/ff.prog.p0002`, { roles: 'SYSADM', body });
  assert.equal(replay.status, 409, 'a blind replay without the version is rejected rather than applied twice');
  const row = api.db.prepare("SELECT enabled, version FROM core_feature_flags WHERE key='ff.prog.p0002' AND environment='staging'").get();
  assert.equal(row.enabled, 1);
  assert.equal(row.version, 1);
});

test('session endpoint reports permissions; unknown API route is a 404 envelope', async () => {
  const s = await api.call('GET', '/api/v1/core/session', { roles: 'ITADM' });
  assert.deepEqual(s.json.data.permissions, ['core.about.view', 'core.arch.view', 'core.events.redrive', 'core.events.replay', 'core.events.view', 'core.files.admin', 'core.flag.view', 'core.health.view', 'core.integrity.run', 'core.integrity.view', 'core.jobs.manage', 'core.jobs.view', 'core.numbering.view', 'core.param.configure_system', 'core.param.view', 'core.requests.view', 'core.schedule.manage', 'core.schedule.view']);
  const nf = await api.call('GET', '/api/v1/nothing', { roles: 'SYSADM' });
  assert.equal(nf.status, 404);
  assert.equal(nf.json.error.code, 'NOT_FOUND');
});
