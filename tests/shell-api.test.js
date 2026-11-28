import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, setupCompany, startApi } from './helpers.js';

// Part 03.05: the application shell's server contract: the navigation registry per role (T-01), refusals (T-02), the maker-checker change of
// the registry and its audit, favourites, recent records, the working context (T-03 server side) and the launchpad.
const U = '/api/v1/ui';
const json = { 'content-type': 'application/json' };
const key = (k) => ({ ...json, 'idempotency-key': `shell-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const pm = as('PM', 'pm1');
const acc = as('ACCMGR', 'acc1');
const sys = as('SYSADM', 'sys1');
const sys2 = as('SYSADM', 'sys2');
const emp = as('PD', 'pd1');
const today = '2026-10-31';

async function world(api) {
  await setupCompany(api, { company: '1' });
  const mr = await api.call('POST', '/api/v1/core/number-series', { ...admin('1'), headers: key('n'), body: { docType: 'SAMPLE_MR', name: 'Sample material requests', prefix: 'MR', format: '{PREFIX}/{FY}/{SEQ:4}', resetRule: 'financial_year', reason: 'initial set-up' } });
  assert.equal(mr.status, 201, JSON.stringify(mr.json));
  const project = (await api.call('POST', '/api/v1/iam/org/projects', { ...pm, headers: key('p'), body: { code: 'NH1', name: 'NH-48 Widening', type: 'ROAD' } })).json.data;
  const site = (await api.call('POST', '/api/v1/iam/org/sites', { ...pm, headers: key('s'), body: { code: 'S1', name: 'Km 12 camp', projectId: project.id } })).json.data;
  return { project, site };
}
const nav = async (api, who) => (await api.call('GET', `${U}/navigation`, who)).json.data;
const codes = (n) => n.groups.flatMap((g) => g.pages.map((p) => p.code));
const record = async (api, w) => (await api.call('POST', `${U}/sample-requests`, { ...pm, headers: key('mk'), body: { title: 'Footing F3', docDate: today, requiredBy: '2026-11-05', projectId: w.project.id, siteId: w.site.id, priority: 'NORMAL', returnable: false, lines: [{ description: 'TMT bar', uom: 'MT', quantity: '2', unitRate: '58000' }] } })).json.data;
const propose = (api, who, code, changes, reason = 'Reorder for the site teams') => api.call('POST', `${U}/navigation/changes`, { ...who, headers: key('chg'), body: { code, changes, reason } });
const act = (api, who, id, action = 'approve', comment = 'checked and fine') => api.call('POST', `/api/v1/core/change-requests/${id}/act`, { ...who, headers: key('act'), body: { action, comment } });

test('T-01 three roles see exactly the entries their permissions and flags allow; the technical console stays out of business groups', async () => {
  const api = await startApi();
  await world(api);
  const p = await nav(api, pm);
  const a = await nav(api, sys);
  const e = await nav(api, emp);
  // every person: Home and their own account pages
  for (const n of [p, a, e]) assert.ok(codes(n).includes('home') && codes(n).includes('profile'));
  assert.ok(codes(p).includes('admin-sample-requests'), 'a project manager raises requests');
  assert.ok(!codes(p).includes('admin-users') && !codes(p).includes('admin-navigation') && !codes(p).includes('admin-console'), 'and sees no administration');
  for (const c of ['admin-users', 'admin-navigation', 'admin-console', 'admin-feature-flags', 'admin-company-settings']) assert.ok(codes(a).includes(c), `a system administrator sees ${c}`);
  assert.ok(!codes(e).includes('admin-navigation'), 'a project director cannot manage the registry');
  // BR-03: build, audit and design-system pages live only in the console and account placements
  const business = a.groups.filter((g) => g.placement === 'sidebar').flatMap((g) => g.pages.map((x) => x.code));
  for (const c of ['admin-about', 'admin-data-health', 'admin-architecture', 'admin-design-system', 'admin-feature-flags', 'admin-operations', 'admin-security-routes']) assert.ok(!business.includes(c), `${c} is not in a business group`);
  assert.ok(a.groups.find((g) => g.placement === 'console').pages.length >= 10);
  // the forbidden ones are listed as denied with the reason, never as menu entries
  assert.ok(p.denied.some((d) => d.route === '/admin/users' && d.reason === 'permission' && d.permissionKey === 'iam.user.view'));
  assert.ok(!p.groups.flatMap((g) => g.pages).some((x) => x.route === '/admin/users'));
  assert.equal(p.groups.find((g) => g.code === 'g-procurement').pages[0].quickCreate.route, '/admin/sample-requests?new=1');
  assert.deepEqual(p.quickCreate.map((q) => q.label), ['New sample material request', 'New project']);
  // groups appear only when they hold something
  assert.ok(p.groups.every((g) => g.pages.length > 0));
  await api.close();
});

test('BR-01 AC-02 every page has a permission key but Home and Profile; the registry holds every application page once', async () => {
  const api = await startApi();
  const pages = api.db.prepare("SELECT code, permission_key, route FROM ui_navigation_entries WHERE kind = 'page' AND is_active = 1").all();
  assert.ok(pages.length >= 55);
  assert.deepEqual(pages.filter((x) => !x.permission_key).map((x) => x.code).sort(), ['home', 'profile']);
  assert.equal(new Set(pages.map((x) => x.route)).size, pages.length, 'a route belongs to one entry');
  assert.throws(() => api.db.prepare("INSERT INTO ui_navigation_entries (code, parent_code, kind, label, route) VALUES ('x-page', 'g-home', 'page', 'X', '/x')").run(), /CHECK constraint/);
  assert.throws(() => api.db.prepare("INSERT INTO ui_navigation_entries (code, kind, label, quick_create_label) VALUES ('x-group', 'group', 'X', 'Make')").run(), /CHECK constraint/);
  await api.close();
});

test('T-02 the registry and its changes are for the system administrator; a forbidden page is refused by the API as well as hidden', async () => {
  const api = await startApi();
  await world(api);
  assert.equal((await api.call('GET', `${U}/navigation/registry`, pm)).status, 403);
  assert.equal((await api.call('GET', `${U}/navigation/registry/export`, pm)).status, 403);
  assert.equal((await api.call('GET', `${U}/navigation/registry/home/history`, pm)).status, 403);
  assert.equal((await propose(api, pm, 'home', { label: 'Start' })).status, 403);
  assert.equal((await api.call('GET', '/api/v1/iam/users', pm)).status, 403, 'the page hidden from a project manager is refused by its own API');
  const reg = (await api.call('GET', `${U}/navigation/registry`, sys)).json.data;
  assert.ok(reg.entries.length >= 75 && reg.options.permissions.includes('self') && reg.options.icons.includes('erp.group.home') && reg.options.groups.length >= 17);
  await api.close();
});

test('AC-05 a registry change is a request another administrator approves, then audited with old and new values; mistakes are refused', async () => {
  const api = await startApi();
  await world(api);
  const before = (await api.call('GET', `${U}/navigation/registry`, sys)).json.data.entries.find((e) => e.code === 'admin-users');
  // refusals first
  const bad = async (changes, re, status = 400) => {
    const r = await propose(api, sys, 'admin-users', changes);
    assert.equal(r.status, status, JSON.stringify(r.json));
    assert.match(JSON.stringify(r.json.error), re);
  };
  await bad({ permissionKey: null }, /Every page needs a permission key/);
  await bad({ permissionKey: 'nope.nothing.view' }, /not a permission key/);
  await bad({ featureFlag: 'ff.no.such' }, /not a feature flag/);
  await bad({ icon: 'erp.not.there' }, /not an icon/);
  await bad({ shortcut: 'h' }, /already opens/);
  await bad({ label: 'Users' }, /nothing to approve/, 422);
  assert.equal((await propose(api, sys, 'admin-navigation', { isActive: false })).status, 400, 'the registry page cannot hide itself');
  assert.equal((await propose(api, sys, 'g-home', { permissionKey: 'iam.user.view' })).status, 400, 'a group has no permission of its own');
  assert.equal((await propose(api, sys, 'no-such-entry', { label: 'x' })).status, 404);
  assert.equal((await propose(api, sys, 'admin-users', { label: 'People' }, 'no')).status, 400, 'a reason is needed');
  // a good one
  const ok = await propose(api, sys, 'admin-users', { label: 'People', sortOrder: 5, keywords: 'people accounts staff' });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(ok.json.data.status, 'SUBMITTED');
  assert.equal((await propose(api, sys, 'admin-users', { label: 'Staff' })).status, 409, 'one open request per entry');
  assert.equal((await nav(api, sys)).groups.flatMap((g) => g.pages).find((p) => p.code === 'admin-users').label, 'Users', 'nothing changed yet');
  assert.equal((await act(api, sys, ok.json.data.id)).status, 403, 'the requester cannot approve their own change');
  assert.equal((await act(api, pm, ok.json.data.id)).status, 403, 'a project manager cannot approve');
  const done = await act(api, sys2, ok.json.data.id);
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.data.status, 'APPROVED');
  const page = (await nav(api, sys)).groups.flatMap((g) => g.pages).find((p) => p.code === 'admin-users');
  assert.deepEqual([page.label, page.keywords], ['People', 'people accounts staff']);
  const after = (await api.call('GET', `${U}/navigation/registry`, sys)).json.data.entries.find((e) => e.code === 'admin-users');
  assert.equal(after.version, before.version + 1);
  const hist = (await api.call('GET', `${U}/navigation/registry/admin-users/history`, sys)).json.data;
  assert.equal(hist[0].action, 'update');
  assert.deepEqual([hist[0].oldValues.label, hist[0].newValues.label, hist[0].actor], ['Users', 'People', 'sys2']);
  assert.match(hist[0].reason, /Reorder/);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'ui.navigation.changed'").get().n, 1);
  // a request raised on an old version is refused when approved (the entry moved on)
  const first = await propose(api, sys, 'admin-roles', { label: 'Role list' });
  api.db.prepare("UPDATE ui_navigation_entries SET version = version + 1 WHERE code = 'admin-roles'").run();
  const stale = await act(api, sys2, first.json.data.id);
  assert.equal(stale.status, 422);
  assert.match(JSON.stringify(stale.json.error), /changed after this request/);
  assert.equal((await nav(api, sys)).groups.flatMap((g) => g.pages).find((p) => p.code === 'admin-roles').label, 'Roles');
  // a rejected request changes nothing
  const rej = await propose(api, sys, 'admin-assignments', { mobileVisible: false });
  assert.equal((await act(api, sys2, rej.json.data.id, 'reject', 'not needed on phones')).status, 200);
  assert.equal(api.db.prepare("SELECT mobile_visible FROM ui_navigation_entries WHERE code = 'admin-assignments'").get().mobile_visible, 1);
  await api.close();
});

test('AC-05 settings export and import: import only raises requests, unchanged and unknown entries are reported', async () => {
  const api = await startApi();
  await world(api);
  const exp = (await api.call('GET', `${U}/navigation/registry/export`, sys)).json.data;
  assert.ok(exp.entries.length >= 75 && exp.entries.every((e) => e.code && 'permissionKey' in e));
  const label = exp.entries.find((e) => e.code === 'admin-parameters');
  const imp = await api.call('POST', `${U}/navigation/registry/import`, { ...sys, headers: key('imp'), body: { reason: 'Settings from the test company', entries: [{ code: 'admin-parameters', label: 'Settings values' }, { code: 'admin-holidays', label: exp.entries.find((e) => e.code === 'admin-holidays').label }, { code: 'ghost', label: 'x' }, { code: 'admin-numbering', permissionKey: 'bad.key.here' }] } });
  assert.equal(imp.status, 201, JSON.stringify(imp.json));
  assert.deepEqual([imp.json.data.requested.length, imp.json.data.unchanged, imp.json.data.errors.map((x) => x.code)], [1, ['admin-holidays'], ['ghost', 'admin-numbering']]);
  assert.equal(api.db.prepare("SELECT label FROM ui_navigation_entries WHERE code = 'admin-parameters'").get().label, label.label, 'nothing is written until approved');
  assert.equal((await act(api, sys2, imp.json.data.requested[0].requestId)).status, 200);
  assert.equal(api.db.prepare("SELECT label FROM ui_navigation_entries WHERE code = 'admin-parameters'").get().label, 'Settings values');
  await api.close();
});

test('FR-06 favourites: pages and records, only what the person may open, their own, in the order they set', async () => {
  const api = await startApi();
  const w = await world(api);
  const r = await record(api, w);
  const a = await api.call('POST', `${U}/favourites`, { ...pm, headers: key('f1'), body: { navCode: 'admin-sample-requests' } });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  assert.deepEqual([a.json.data.title, a.json.data.route], ['Sample Material Requests', '/admin/sample-requests']);
  assert.equal((await api.call('POST', `${U}/favourites`, { ...pm, headers: key('f1'), body: { navCode: 'admin-sample-requests' } })).status, 409);
  assert.equal((await api.call('POST', `${U}/favourites`, { ...pm, headers: key('f2'), body: { navCode: 'admin-users' } })).status, 404, 'not a page this role may open');
  const rec = await api.call('POST', `${U}/favourites`, { ...pm, headers: key('f3'), body: { entity: 'sample_request', entityId: r.id } });
  assert.equal(rec.status, 201, JSON.stringify(rec.json));
  assert.equal(rec.json.data.route, `/admin/sample-requests?open=${r.id}`);
  assert.equal((await api.call('POST', `${U}/favourites`, { ...pm, headers: key('f4'), body: { entity: 'sample_request', entityId: 999 } })).status, 404);
  assert.equal((await api.call('POST', `${U}/favourites`, { ...pm, headers: key('f5'), body: { entity: 'user', entityId: 1 } })).status, 404, 'only registered record types');
  const home = await api.call('POST', `${U}/favourites`, { ...pm, headers: key('f6'), body: { navCode: 'home' } });
  const order = await api.call('PUT', `${U}/favourites/order`, { ...pm, headers: json, body: { ids: [home.json.data.id, rec.json.data.id, a.json.data.id] } });
  assert.deepEqual(order.json.data.map((f) => f.title === 'Home' ? 'home' : f.kind), ['home', 'record', 'page']);
  assert.equal((await api.call('GET', `${U}/favourites`, as('PM', 'pm2'))).json.data.length, 0, 'favourites are personal');
  assert.equal((await api.call('DELETE', `${U}/favourites/${a.json.data.id}`, as('PM', 'pm2'))).status, 404, 'and cannot be removed by someone else');
  assert.equal((await api.call('PUT', `${U}/favourites/order`, { ...as('PM', 'pm2'), headers: json, body: { ids: [a.json.data.id] } })).status, 400);
  assert.equal((await api.call('DELETE', `${U}/favourites/${a.json.data.id}`, pm)).status, 200);
  assert.equal((await api.call('GET', `${U}/favourites`, pm)).json.data.length, 2);
  await api.close();
});

test('FR-06 recent records: newest first, one entry per record, only records the person can open', async () => {
  const api = await startApi();
  const w = await world(api);
  const r1 = await record(api, w);
  const r2 = await record(api, w);
  const visit = (who, id, title) => api.call('POST', `${U}/recent`, { ...who, headers: json, body: { entity: 'sample_request', entityId: id, title, route: `/admin/sample-requests?open=${id}` } });
  assert.equal((await visit(pm, r1.id, 'Draft one')).status, 201);
  assert.equal((await visit(pm, r2.id, 'Draft two')).status, 201);
  assert.equal((await visit(pm, r1.id, 'Draft one')).status, 201);
  const list = (await api.call('GET', `${U}/recent`, pm)).json.data;
  assert.deepEqual(list.map((x) => x.entityId), [r1.id, r2.id]);
  assert.equal(list[0].type, 'Sample material request');
  assert.equal(api.db.prepare('SELECT visit_count FROM ui_recent_records WHERE entity_id = ?').get(r1.id).visit_count, 2);
  assert.equal((await visit(pm, 999, 'Nothing')).status, 404);
  assert.equal((await api.call('POST', `${U}/recent`, { ...pm, headers: json, body: { entity: 'sample_request', entityId: r1.id, title: 'x', route: 'https://evil.example/x' } })).status, 400, 'a route stays inside the application');
  assert.equal((await api.call('GET', `${U}/recent`, as('PM', 'pm2'))).json.data.length, 0, 'recent records are personal');
  assert.equal((await visit(as('EMP', 'emp1'), r1.id, 'x')).status, 404, 'a person who cannot open the record cannot record a visit to it');
  await api.close();
});

test('T-03 FR-03 the working context: choices come from the person\'s scope, are remembered per person, and wrong ones are refused', async () => {
  const api = await startApi();
  const w = await world(api);
  const first = (await api.call('GET', `${U}/context-options`, pm)).json.data;
  assert.deepEqual([first.companies.length, first.projects.map((p) => p.code), first.sites.map((s) => s.code), first.selected], [1, ['NH1'], ['S1'], { companyId: 1, projectId: null, siteId: null }]);
  const set = await api.call('PUT', `${U}/context`, { ...pm, headers: json, body: { projectId: w.project.id, siteId: w.site.id } });
  assert.equal(set.status, 200, JSON.stringify(set.json));
  assert.deepEqual(set.json.data.selected, { companyId: 1, projectId: w.project.id, siteId: w.site.id });
  assert.deepEqual((await api.call('GET', `${U}/context-options`, pm)).json.data.selected, set.json.data.selected, 'remembered');
  assert.equal((await api.call('GET', `${U}/context-options`, as('PM', 'pm2'))).json.data.selected.projectId, null, 'per person');
  const refuse = async (b, field) => {
    const r = await api.call('PUT', `${U}/context`, { ...pm, headers: json, body: b });
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.match(JSON.stringify(r.json.error), new RegExp(field));
  };
  await refuse({ projectId: 987654 }, 'projectId');
  await refuse({ siteId: w.site.id }, 'siteId');
  await refuse({ projectId: w.project.id, siteId: 987654 }, 'siteId');
  assert.deepEqual((await api.call('PUT', `${U}/context`, { ...pm, headers: json, body: { projectId: null, siteId: null } })).json.data.selected.projectId, null, 'all projects again');
  // a saved choice that left the person's scope is dropped, not trusted
  api.db.prepare("UPDATE ui_user_context SET context_project_id = ?").run(w.project.id);
  api.db.prepare("UPDATE org_projects SET status = 'CLOSED' WHERE id = ?").run(w.project.id);
  assert.equal((await api.call('GET', `${U}/context-options`, pm)).json.data.selected.projectId, null);
  await api.close();
});

test('FR-06 the launchpad gathers tiles by role, favourites, recent records and what is waiting; the bell counts approvals for the approver', async () => {
  const api = await startApi();
  const w = await world(api);
  const r = await record(api, w);
  const lp = (await api.call('GET', `${U}/launchpad`, pm)).json.data;
  assert.ok(lp.tiles.some((t) => t.code === 'admin-sample-requests') && !lp.tiles.some((t) => t.code === 'admin-users') && !lp.tiles.some((t) => t.code === 'admin-console'), 'tiles follow the role and leave the console out');
  assert.equal(lp.pending.approvals, 0);
  const sent = (await api.call('POST', `${U}/sample-requests/${r.id}/submit`, { ...pm, headers: key('sub'), body: { version: r.version } })).json.data;
  assert.equal(sent.status, 'SUBMITTED');
  // with the notification centre on (ff.eng.p0406) the bell counts unread notifications; this test is about the stand-in that counts the requests waiting
  api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.eng.p0406'").run();
  assert.equal((await api.call('GET', `${U}/bell`, acc)).json.data.unread, 1);
  assert.equal((await api.call('GET', `${U}/bell`, pm)).json.data.unread, 0, 'the requester has nothing to decide');
  assert.equal((await api.call('GET', `${U}/launchpad`, acc)).json.data.pending.approvals, 1);
  await api.call('POST', `${U}/favourites`, { ...pm, headers: key('f'), body: { navCode: 'admin-sample-bills' } });
  await api.call('POST', `${U}/recent`, { ...pm, headers: json, body: { entity: 'sample_request', entityId: r.id, title: sent.docNo, route: `/admin/sample-requests?open=${r.id}` } });
  const again = (await api.call('GET', `${U}/launchpad`, pm)).json.data;
  assert.deepEqual([again.favourites.map((f) => f.navCode), again.recent.map((x) => x.title)], [['admin-sample-bills'], [sent.docNo]]);
  await api.close();
});

test('PACK-07 recent working contexts: newest first, at most five, a repeat moves up, per person and company, and only what is still in scope', async (t) => {
  const api = await startApi(); t.after(() => api.close());
  const w = await world(api);
  const ids = [w.project.id];
  for (let i = 2; i <= 6; i += 1) ids.push((await api.call('POST', '/api/v1/iam/org/projects', { ...pm, headers: key(`p${i}`), body: { code: `NH${i}`, name: `Package ${i}`, type: 'ROAD' } })).json.data.id);
  const put = (who, body) => api.call('PUT', `${U}/context`, { ...who, headers: json, body });
  const recentOf = async (who) => (await api.call('GET', `${U}/context-options`, who)).json.data.recent;
  assert.deepEqual(await recentOf(pm), [], 'nothing chosen yet');
  assert.equal((await put(pm, { projectId: w.project.id, siteId: w.site.id })).status, 200);
  for (const id of ids.slice(1)) assert.equal((await put(pm, { projectId: id, siteId: null })).status, 200);
  assert.equal((await put(pm, { projectId: null, siteId: null })).status, 200); // "All projects" is not a recent context
  let r = await recentOf(pm);
  assert.deepEqual(r.map((x) => x.projectId), [ids[5], ids[4], ids[3], ids[2], ids[1]], 'the five newest, newest first; the oldest (NH1/S1) dropped');
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM ui_context_recent WHERE user_ref = 'pm1'").get().n, 5, 'only five are kept');
  // choosing an older one again moves it to the top without a duplicate
  await put(pm, { projectId: ids[2], siteId: null });
  r = await recentOf(pm);
  assert.deepEqual(r.map((x) => x.projectId), [ids[2], ids[5], ids[4], ids[3], ids[1]]);
  // per person: another person has their own list
  assert.deepEqual(await recentOf(as('PM', 'pm2')), []);
  // another company sees nothing of company 1
  assert.deepEqual(await recentOf({ roles: 'PM', user: 'pm1', company: '2' }), []);
  // a project that is closed leaves the list (it is no longer in scope)
  api.db.prepare("UPDATE org_projects SET status = 'CLOSED' WHERE id = ?").run(ids[5]);
  r = await recentOf(pm);
  assert.ok(!r.some((x) => x.projectId === ids[5]), 'a closed project is not offered');
  assert.equal(r.length, 4);
});
