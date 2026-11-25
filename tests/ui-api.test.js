import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApi, testConfig } from './helpers.js';

const U = '/api/v1/ui';
const json = { 'content-type': 'application/json' };
const pm = { roles: 'PM', user: 'pm1' };

test('FR-02 FR-03 a person has default preferences until they choose; a choice is saved, audited and announced', async () => {
  const api = await startApi();
  const first = await api.call('GET', `${U}/preferences`, pm);
  assert.equal(first.status, 200);
  assert.deepEqual(first.json.data, { theme: 'light', density: 'comfortable', language: 'en', startPage: null, tableSettings: {}, version: 0, saved: false, updatedAt: null });
  const saved = await api.call('PATCH', `${U}/preferences`, { ...pm, headers: json, body: { theme: 'dark', density: 'compact', language: 'hi', startPage: '/admin/users', tableSettings: { 'iam.users': { pageSize: 50, hidden: ['mobile'] } } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.data.theme, 'dark');
  assert.equal(saved.json.data.density, 'compact');
  assert.equal(saved.json.data.language, 'hi');
  assert.equal(saved.json.data.startPage, '/admin/users');
  assert.deepEqual(saved.json.data.tableSettings, { 'iam.users': { pageSize: 50, hidden: ['mobile'] } });
  assert.equal(saved.json.data.version, 1);
  // the same person on another device (another request) gets the same, and one field can change alone
  assert.equal((await api.call('GET', `${U}/preferences`, pm)).json.data.theme, 'dark');
  const one = await api.call('PATCH', `${U}/preferences`, { ...pm, headers: json, body: { theme: 'high-contrast', version: 1 } });
  assert.equal(one.json.data.theme, 'high-contrast');
  assert.equal(one.json.data.density, 'compact', 'the rest is kept');
  assert.equal(one.json.data.version, 2);
  const audit = api.db.prepare("SELECT action, old_values, new_values FROM core_audit_log WHERE entity = 'ui_user_preferences' ORDER BY id").all();
  assert.deepEqual(audit.map((a) => a.action), ['create', 'update']);
  assert.equal(JSON.parse(audit[1].old_values).theme, 'dark');
  assert.equal(JSON.parse(audit[1].new_values).theme, 'high-contrast');
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'ui.preferences.changed'").get().n, 2);
  await api.close();
});

test('a stale version is refused (409), and wrong values are refused naming the field (400)', async () => {
  const api = await startApi();
  const patch = (body) => api.call('PATCH', `${U}/preferences`, { ...pm, headers: json, body: body });
  assert.equal((await patch({ theme: 'dark' })).status, 200);
  assert.equal((await patch({ theme: 'light', version: 1 })).status, 200);
  const stale = await patch({ theme: 'dark', version: 1 });
  assert.equal(stale.status, 409);
  assert.match(stale.json.error.message, /another device/);
  for (const [body, field] of [[{ theme: 'purple' }, 'theme'], [{ density: 'tiny' }, 'density'], [{ language: 'fr' }, 'language'], [{ startPage: 'http://evil.example' }, 'startPage'], [{}, 'theme'], [{ colour: 'red' }, null], [{ tableSettings: { 'Bad Id': {} } }, 'tableSettings']]) {
    const r = await patch(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    if (field) assert.ok(r.json.error.details.some((d) => String(d.field).startsWith(field)), `${JSON.stringify(body)} names ${field}: ${JSON.stringify(r.json.error.details)}`);
  }
  await api.close();
});

test('AC-04 each person sees and changes only their own preferences, within their company', async () => {
  const api = await startApi();
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, company_id, code, legal_name, short_name, created_by, source_type) VALUES (2, 2, 'SECOND', 'Second Infra Pvt Ltd', 'Second', 't', 'seed')").run();
  await api.call('PATCH', `${U}/preferences`, { ...pm, headers: json, body: { theme: 'dark' } });
  assert.equal((await api.call('GET', `${U}/preferences`, { roles: 'PM', user: 'pm2' })).json.data.theme, 'light', 'another person');
  assert.equal((await api.call('GET', `${U}/preferences`, { ...pm, company: '2' })).json.data.theme, 'light', 'the same name in another company');
  assert.equal((await api.call('GET', `${U}/preferences`, { roles: 'EMP', user: 'emp1' })).status, 200, 'every signed-in person has preferences');
  assert.equal((await api.call('GET', `${U}/preferences`, { user: '' })).status, 401);
  // nothing in the API takes a user id: there is no way to name someone else
  assert.equal((await api.call('PATCH', `${U}/preferences`, { ...pm, headers: json, body: { theme: 'dark', userRef: 'pm2' } })).status, 400);
  await api.close();
});

test('FR-07 AC-02 the style guide: everyone outside production, only ui.styleguide.view in production; the contrast report passes', async () => {
  const api = await startApi();
  const open = await api.call('GET', `${U}/style-guide`, { roles: 'EMP', user: 'emp1' });
  assert.equal(open.status, 200);
  assert.equal(open.json.data.openToAll, true);
  assert.equal(open.json.data.contrast.failures.length, 0);
  assert.ok(open.json.data.contrast.rows.length > 100);
  assert.equal(open.json.data.tokens.color.light['brand.primary'], '#1D4F91');
  assert.deepEqual(open.json.data.icons.counts, { groups: 13, actions: 40, states: 11, construction: 14, modules: 175 });
  await api.close();
  // a production environment name with the test's header identities: loadConfig refuses that combination since AUD-DEF-007 (D-821), so the
  // test gives the app a test configuration whose environment is production; the rule under test is the style guide's, not the configuration's
  const prod = await startApi({}, { config: { ...testConfig(), environment: 'production' } });
  prod.db.prepare("UPDATE core_feature_flags SET enabled = 1, default_enabled = 1 WHERE key = 'ff.ui.p0301'").run(); // switched on for production
  assert.equal((await prod.call('GET', `${U}/style-guide`, { roles: 'EMP', user: 'emp1' })).status, 403);
  assert.equal((await prod.call('GET', `${U}/style-guide`, { roles: 'PM', user: 'pm1' })).status, 403);
  const sys = await prod.call('GET', `${U}/style-guide`, { roles: 'SYSADM', user: 'sys1' });
  assert.equal(sys.status, 200);
  assert.equal(sys.json.data.openToAll, false);
  await prod.close();
});

test('the ui routes are hidden while ff.ui.p0301 is off', async () => {
  const api = await startApi();
  api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.ui.p0301'").run();
  assert.equal((await api.call('GET', `${U}/preferences`, pm)).status, 404);
  assert.equal((await api.call('GET', `${U}/style-guide`, pm)).status, 404);
  await api.close();
});
