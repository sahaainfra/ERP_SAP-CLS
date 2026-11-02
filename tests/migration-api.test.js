import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { pageCode, registeredPages } from '../e2e/pages.js';
import { setupCompany, startApi } from './helpers.js';

// Part 03.10: the migration tracker. Every page of the application has a row (AC-01); a page is verified only by the owner of its module and not by the
// person who migrated it, and not while a High or Critical defect is open (BR-02); a module is signed off as a whole; the old address of a page is a
// redirect that another administrator approves (T-03, AC-05); the export honours the filters and is audited.
const U = '/api/v1/ui';
const json = { 'content-type': 'application/json' };
const key = (k = 'm') => ({ ...json, 'idempotency-key': `mig-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const it1 = as('ITADM', 'it1');
const it2 = as('ITADM', 'it2');
const sys = as('SYSADM', 'sys1');
const sys2 = as('SYSADM', 'sys2');
const pcm = as('PCMGR', 'pcm1');
const pm = as('PM', 'pm1');
const act = (api, who, id, action = 'approve') => api.call('POST', `/api/v1/core/change-requests/${id}/act`, { ...who, headers: key('act'), body: { action, comment: 'checked and fine' } });
const post = (api, who, path, body) => api.call('POST', `${U}/page-migration${path}`, { ...who, headers: key(), body });
const get = async (api, who, q = '') => (await api.call('GET', `${U}/page-migration${q}`, who));
const page = async (api, code) => (await get(api, it1)).json.data.rows.find((r) => r.code === code);

test('AC-01 FR-01 FR-06 every page the client registers has a row, with a page type, an owner and a status; nothing else is tracked', async () => {
  const api = await startApi();
  await setupCompany(api, { company: '1' });
  const res = await get(api, it1);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const rows = res.json.data.rows;
  assert.deepEqual(rows.map((r) => r.code).sort(), registeredPages().map((p) => pageCode(p.route)).sort(), 'the tracker and the registered pages are the same set');
  assert.deepEqual(rows.map((r) => r.newRoute).sort(), registeredPages().map((p) => p.route).sort());
  for (const r of rows) {
    assert.ok(['DASHBOARD', 'LIST', 'OBJECT', 'FORM', 'WORKLIST', 'REPORT'].includes(r.type), r.code);
    assert.ok(['core', 'iam', 'ui'].includes(r.module) && r.ownerRole && r.migratedInPart, r.code);
    assert.equal(r.status, 'MIGRATED', `${r.code} is seeded migrated, never verified`);
    assert.equal(r.redirects, false);
  }
  const s = res.json.data.summary;
  assert.equal(s.totals.total, rows.length);
  assert.equal(s.byModule.reduce((n, m) => n + m.total, 0), rows.length);
  assert.equal(s.byType.reduce((n, t) => n + t.total, 0), rows.length);
  assert.equal(s.totals.verified, 0);
  // the filters
  assert.ok((await get(api, it1, '?module=iam')).json.data.rows.every((r) => r.module === 'iam'));
  assert.ok((await get(api, it1, '?type=WORKLIST')).json.data.rows.every((r) => r.type === 'WORKLIST'));
  assert.deepEqual((await get(api, it1, '?q=feature%20flags')).json.data.rows.map((r) => r.code), ['admin.feature-flags']);
  assert.equal((await get(api, it1, '?status=BOGUS')).status, 400);
  assert.equal((await get(api, it1, '?defects=open')).json.data.rows.length > 0, true);
  await api.close();
});

test('AC-04 who sees and who signs: the tracker is for SYSADM, ITADM and the project controls manager; a project manager has no access', async () => {
  const api = await startApi();
  await setupCompany(api, { company: '1' });
  for (const who of [sys, it1, pcm]) assert.equal((await get(api, who)).status, 200);
  assert.equal((await get(api, pm)).status, 403);
  assert.equal((await api.call('GET', `${U}/page-migration/pending`, pm)).status, 403);
  assert.equal((await api.call('GET', `${U}/page-migration/export`, pm)).status, 403);
  assert.equal((await post(api, pm, '/admin.users/status', { to: 'VERIFIED', reason: 'looks right', version: 1 })).status, 403);
  // the addresses to redirect are for everyone signed in
  assert.equal((await api.call('GET', `${U}/page-migration/redirects`, as('EMP', 'emp1'))).status, 200);
  await api.close();
});

test('BR-02 AC-02 a page is verified by its owner, not by the person who migrated it, and not while a High or Critical defect is open; a module is signed off as a whole', async () => {
  const api = await startApi();
  await setupCompany(api, { company: '1' });
  const code = 'admin.feature-flags'; // a core page: the owner is the IT administrator
  let p = await page(api, code);
  assert.equal(p.ownerRole, 'ITADM');
  const verify = (who, version) => post(api, who, `/${code}/status`, { to: 'VERIFIED', reason: 'checked with the business user', version });
  assert.equal((await verify(sys, p.version)).status, 403, 'a system administrator does not own a core page');
  assert.equal((await post(api, it1, `/${code}/status`, { to: 'VERIFIED', reason: 'no', version: p.version })).status, 400, 'a reason of some length');
  // a High defect blocks it
  const added = await post(api, it1, `/${code}/defects`, { text: 'The toggle does nothing on a phone', severity: 'High', ownerPart: '01.05', version: p.version });
  assert.equal(added.status, 201, JSON.stringify(added.json));
  p = added.json.data;
  const blocked = await verify(it1, p.version);
  assert.equal(blocked.status, 422);
  assert.match(blocked.json.error.message, /High or Critical/);
  const defect = p.defects.find((d) => d.severity === 'High');
  assert.equal((await post(api, it1, `/${code}/defects/${defect.id}/resolve`, { note: 'Fixed and checked on a phone', version: p.version - 1 })).status, 409, 'stale version');
  p = (await post(api, it1, `/${code}/defects/${defect.id}/resolve`, { note: 'Fixed and checked on a phone', version: p.version })).json.data;
  assert.equal(p.defects.find((d) => d.id === defect.id).status, 'RESOLVED');
  assert.equal((await post(api, it1, `/${code}/defects/${defect.id}/resolve`, { note: 'Again, to be sure it works', version: p.version })).status, 422);
  assert.equal((await verify(it1, p.version - 1)).status, 409);
  const ok = await verify(it1, p.version);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual([ok.json.data.status, ok.json.data.verifiedBy], ['VERIFIED', 'it1']);
  assert.equal((await verify(it1, ok.json.data.version)).status, 422, 'already verified');
  // reopening makes the reopener the migrator: they cannot verify it again themselves
  const reopened = await post(api, it2, `/${code}/status`, { to: 'MIGRATED', reason: 'the page changed after the check', version: ok.json.data.version });
  assert.deepEqual([reopened.json.data.status, reopened.json.data.migratedBy, reopened.json.data.verifiedBy], ['MIGRATED', 'it2', null]);
  const self = await verify(it2, reopened.json.data.version);
  assert.equal(self.status, 403);
  assert.match(self.json.error.message, /someone else must verify/);
  assert.equal((await verify(it1, reopened.json.data.version)).status, 200);
  // scheduling to the part that will rebuild it
  const sch = await post(api, it1, '/admin.users/status', { to: 'SCHEDULED', reason: 'rebuilt with the people master', version: (await page(api, 'admin.users')).version });
  assert.equal(sch.status, 400, 'a part is named');
  const sc2 = await post(api, sys, '/admin.users/status', { to: 'SCHEDULED', scheduledPart: '07.01', reason: 'rebuilt with the employee master', version: (await page(api, 'admin.users')).version });
  assert.deepEqual([sc2.json.data.status, sc2.json.data.scheduledPart], ['SCHEDULED', '07.01']);
  // a module is signed off as a whole by its owner: the others are skipped with the reason
  const before = (await get(api, it1)).json.data.summary.byModule.find((m) => m.module === 'core');
  assert.equal((await post(api, sys, '/modules/core/signoff', { comment: 'all core pages checked with the owners' })).status, 403, 'not the owner of core');
  await post(api, it1, '/admin.about/defects', { text: 'The page shows a figure that is wrong', severity: 'Critical', ownerPart: '01.01', version: (await page(api, 'admin.about')).version });
  const signoff = await post(api, it2, '/modules/core/signoff', { comment: 'all core pages checked with the owners' });
  assert.equal(signoff.status, 200, JSON.stringify(signoff.json));
  assert.deepEqual(signoff.json.data.skipped, [{ code: 'admin.about', reason: '1 High or Critical defect(s) open' }], 'the page with a Critical defect is left; the others are verified (the one it2 reopened was verified by it1 before)');
  assert.equal(signoff.json.data.verified.length, before.migrated - signoff.json.data.skipped.length);
  assert.ok(signoff.json.data.summary.verified >= signoff.json.data.verified.length);
  assert.equal((await api.call('GET', `${U}/page-migration?status=VERIFIED&module=core`, it1)).json.data.rows.every((r) => r.verifiedBy), true);
  // everything above is in the audit trail
  const actions = api.db.prepare("SELECT DISTINCT action FROM core_audit_log WHERE entity = 'ui_page_migration'").all().map((a) => a.action).sort();
  assert.deepEqual(actions, ['defect_added', 'defect_resolved', 'reopen', 'schedule', 'signoff', 'verify']);
  await api.close();
});

test('T-03 FR-04 AC-05 the old address of a page is a redirect that another system administrator approves; an address of a real page is refused', async () => {
  const api = await startApi();
  await setupCompany(api, { company: '1' });
  const code = 'admin.users';
  const p = await page(api, code);
  const ask = (who, oldRoute, version = p.version) => post(api, who, `/${code}/route`, { oldRoute, reason: 'the old address was in bookmarks', version });
  assert.equal((await ask(sys, '/admin/people')).status, 201);
  const open = (await api.call('GET', `${U}/page-migration/pending`, sys)).json.data;
  assert.equal(open.length, 1);
  assert.deepEqual([open[0].code, open[0].oldRoute], [code, '/admin/people']);
  assert.equal((await ask(sys, '/admin/people-old')).status, 409, 'one at a time');
  assert.deepEqual((await api.call('GET', `${U}/page-migration/redirects`, as('EMP', 'e'))).json.data, [], 'not in force until approved');
  assert.equal((await act(api, sys, open[0].id)).status, 403, 'the person who asked cannot approve');
  assert.equal((await act(api, sys2, open[0].id)).status, 200);
  assert.deepEqual((await api.call('GET', `${U}/page-migration/redirects`, as('EMP', 'e'))).json.data, [{ from: '/admin/people', to: '/admin/users' }]);
  const now = await page(api, code);
  assert.deepEqual([now.oldRoute, now.redirects], ['/admin/people', true]);
  assert.equal((await get(api, it1)).json.data.summary.totals.redirects, 1);
  // refused: the address of a real page, an address that redirects elsewhere, a bad address
  assert.equal((await post(api, sys, '/admin.roles/route', { oldRoute: '/admin/users', reason: 'the old address was in bookmarks', version: (await page(api, 'admin.roles')).version })).status, 400);
  assert.equal((await post(api, sys, '/admin.roles/route', { oldRoute: '/admin/people', reason: 'the old address was in bookmarks', version: (await page(api, 'admin.roles')).version })).status, 400);
  assert.equal((await post(api, sys, '/admin.roles/route', { oldRoute: 'admin/people', reason: 'the old address was in bookmarks', version: (await page(api, 'admin.roles')).version })).status, 400);
  assert.equal((await post(api, sys, '/admin.roles/route', { oldRoute: '//evil.example/x', reason: 'the old address was in bookmarks', version: (await page(api, 'admin.roles')).version })).status, 400, 'never another site');
  // taking the redirect away is a request too
  const clear = await ask(sys2, '/admin/users', now.version);
  assert.equal(clear.status, 201);
  assert.equal((await act(api, sys, clear.json.data.id)).status, 200);
  assert.deepEqual((await api.call('GET', `${U}/page-migration/redirects`, as('EMP', 'e'))).json.data, []);
  const audit = api.db.prepare("SELECT old_values, new_values, reason FROM core_audit_log WHERE entity = 'ui_page_migration' AND action = 'update' ORDER BY id").all();
  assert.deepEqual(audit.map((a) => JSON.parse(a.new_values).oldRoute), ['/admin/people', '/admin/users']);
  await api.close();
});

test('FR-07 the export honours the filters and is audited; an idempotent replay of a sign-off changes nothing twice', async () => {
  const api = await startApi();
  await setupCompany(api, { company: '1' });
  const csv = await api.raw('GET', `${U}/page-migration/export?format=csv&module=ui&type=DASHBOARD`, it1);
  assert.equal(csv.status, 200);
  const lines = csv.buffer.toString('utf8').trim().split(/\r?\n/);
  assert.match(lines[0], /^\uFEFF?Page,Module,Name,Page type,Status/);
  const body = lines.slice(1, lines.indexOf(''));
  assert.ok(body.length > 0 && body.every((l) => l.includes(',ui,') && l.includes('DASHBOARD')), 'only the filtered pages');
  const xlsx = await api.raw('GET', `${U}/page-migration/export?format=xlsx`, it1);
  assert.match(xlsx.headers.get('content-type'), /spreadsheetml/);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'ui_page_migration' AND action = 'export'").get().n, 2);
  assert.equal((await api.call('GET', `${U}/page-migration/export?format=pdf`, it1)).status, 400);
  const k = { ...json, 'idempotency-key': 'mig-replay-0001' };
  const first = await api.call('POST', `${U}/page-migration/modules/ui/signoff`, { ...pcm, headers: k, body: { comment: 'checked with the module owner' } });
  const replay = await api.call('POST', `${U}/page-migration/modules/ui/signoff`, { ...pcm, headers: k, body: { comment: 'checked with the module owner' } });
  assert.equal(first.status, 200);
  assert.deepEqual(replay.json, first.json, 'the same answer, not a second sign-off');
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'ui_page_migration' AND action = 'signoff'").get().n, 1);
  await api.close();
});
