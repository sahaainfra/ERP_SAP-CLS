import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { createLogger } from '../src/server/platform/http/logger.js';
import { identityOf } from '../src/server/platform/identity/index.js';
import { LEGACY_ROLE_PERMISSIONS, ROLE_TEMPLATES, TEMPLATE_PERMISSIONS, authzOf, fieldRegistry, hierarchyRegistry, permissionRegistry } from '../src/server/platform/authz/index.js';
import { createOrgService } from '../src/server/modules/iam/org/service.js';
import { createUserStore } from '../src/server/modules/iam/users.js';
import { assignmentChain, roleChangeChain } from '../src/server/modules/iam/access/chains.js';
import { startApi } from './helpers.js';

const I = '/api/v1/iam';
const C = '/api/v1/core';
const PW = 'Tr0ub4dor&3-Excavator';
const idem = () => ({ 'idempotency-key': `a-${Math.random().toString(36).slice(2, 12)}` });
const quiet = () => createLogger({ write: () => {} });

/** An application in AUTH_MODE=iam with a clock, a cheap password hash, a sandbox email connector and MFA switched off. */
async function boot() {
  const clock = { t: Date.parse('2026-10-30T10:00:00.000Z') };
  const api = await startApi({ AUTH_MODE: 'iam' }, { logger: quiet(), identityOptions: { passwordCost: { memory: 8, passes: 1 }, now: () => clock.t } });
  const identity = identityOf(api.db);
  const store = createUserStore({ db: api.db, identity });
  api.db.prepare("INSERT INTO iam_auth_policy (company_id, settings_json, created_by, source_type) VALUES (1, ?, 'test', 'seed')").run(JSON.stringify({ mfa: { enforced: false } }));
  const orgService = createOrgService({ db: api.db, approvals: null, clock: () => clock.t });
  const http = async (method, path, { token, body, headers = {} } = {}) => {
    const res = await fetch(api.base + path, { method, headers: { 'content-type': 'application/json', 'x-token-delivery': 'body', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, json, text };
  };
  const mk = (username, roles) => store.create({ companyId: 1, username, email: `${username}@example.com`, displayName: `${username} Kumar`, roles, password: PW });
  const login = async (username) => (await http('POST', `${I}/auth/login`, { body: { username, password: PW, deviceId: 'device-aaaaaaaa', deviceName: 'Laptop' } })).json?.data?.accessToken ?? null;
  const as = async (username, roles) => {
    await mk(username, roles);
    const me = { token: await login(username), username, get: (p) => http('GET', p, { token: me.token }), post: (p, body = {}) => http('POST', p, { token: me.token, body, headers: idem() }), patch: (p, body) => http('PATCH', p, { token: me.token, body }), relogin: async () => { me.token = await login(username); return me; } };
    assert.ok(me.token, `${username} signs in`);
    return me;
  };
  const idOf = (name) => Number(api.db.prepare('SELECT id FROM iam_users WHERE username = ?').get(name).id);
  const roleId = (code) => Number(api.db.prepare('SELECT id FROM iam_roles WHERE code = ? AND company_id IS NULL').get(code).id);
  const decide = (who, id, action = 'approve') => who.post(`${C}/change-requests/${id}/act`, { action, comment: 'checked and fine' });
  /** Approve every step of a request: the IT administrator, then the director. */
  const approveAll = async (steps, id) => { for (const who of steps) assert.equal((await decide(who, id)).status, 200); };
  return { api, clock, identity, store, orgService, http, mk, login, as, idOf, roleId, decide, approveAll, close: () => api.close() };
}

test('AC-01 the 23 owner roles and the supporting roles are seeded, locked and mapped from the roles that existed', async () => {
  const api = await startApi();
  const owner = ROLE_TEMPLATES.filter((t) => t.owner);
  assert.equal(owner.length, 23);
  assert.equal(owner.filter((t) => t.category === 'HEAD_OFFICE').length, 10);
  assert.equal(owner.filter((t) => t.category === 'SITE_OFFICE').length, 13);
  assert.equal(ROLE_TEMPLATES.length, 44, '23 owner roles, 17 supporting roles and 4 external roles');
  const rows = api.db.prepare("SELECT code, kind, status, is_system FROM iam_roles WHERE company_id IS NULL ORDER BY code").all();
  assert.equal(rows.length, 44);
  assert.ok(rows.every((r) => r.kind === 'SYSTEM' && r.status === 'ACTIVE' && r.is_system === 1));
  for (const code of ['SYSADM', 'PROCMGR', 'SK', 'SUBCO', 'SUPADM', 'AUD', 'EMP', 'X-SUP', 'X-CON']) assert.ok(rows.some((r) => r.code === code), code);
  const mapping = api.db.prepare('SELECT m.legacy_role, m.mapping_type, r.code FROM iam_role_mapping m JOIN iam_roles r ON r.id = m.new_role_id ORDER BY m.legacy_role').all();
  assert.deepEqual(mapping.map((m) => m.legacy_role), Object.keys(LEGACY_ROLE_PERMISSIONS).sort());
  assert.ok(mapping.every((m) => m.mapping_type === 'ALIAS' && m.code === m.legacy_role));
  // the stored grants are the templates', and seeding again changes nothing
  for (const t of ROLE_TEMPLATES) {
    const stored = api.db.prepare("SELECT p.perm_key FROM iam_role_permissions p JOIN iam_roles r ON r.id = p.role_id WHERE r.code = ? AND r.company_id IS NULL AND p.effect = 'allow' ORDER BY p.perm_key").all(t.code).map((p) => p.perm_key);
    assert.deepEqual(stored, [...t.permissions].sort(), t.code);
  }
  assert.equal(authzOf(api.db).seed().changed, 0, 'seeding is repeatable');
  const keys = new Set(api.db.prepare('SELECT perm_key FROM iam_permissions').all().map((p) => p.perm_key));
  for (const k of Object.values(TEMPLATE_PERMISSIONS).flat()) assert.ok(keys.has(k), `${k} is in the registry`);
  assert.equal(api.db.prepare("SELECT sensitive FROM iam_permissions WHERE perm_key = 'iam.user.manage'").get().sensitive, 1);
  assert.equal(api.db.prepare("SELECT sensitive FROM iam_permissions WHERE perm_key = 'org.view'").get().sensitive, 0);
  assert.ok(permissionRegistry.get('iam.role.manage'));
  await api.close();
});

test('T-01 permission matrix: every seeded role against sample endpoints answers exactly what its template grants', async () => {
  const api = await startApi();
  const probes = [
    ['/api/v1/core/feature-flags', 'core.flag.view'], ['/api/v1/iam/org/projects', 'org.view'], ['/api/v1/iam/users', 'iam.user.view'], ['/api/v1/iam/roles', 'iam.role.view'],
    ['/api/v1/iam/assignments', 'iam.assignment.view'], ['/api/v1/core/connectors', 'core.connectors.view'], ['/api/v1/core/change-requests', 'core.requests.view'], ['/api/v1/iam/admin/policy', 'iam.security.view'],
  ];
  let checked = 0;
  for (const t of ROLE_TEMPLATES) {
    for (const [path, perm] of probes) {
      const r = await api.call('GET', path, { roles: t.code, user: `m-${t.code}` });
      const allowed = t.permissions.includes(perm);
      assert.equal(r.status === 200, allowed, `${t.code} GET ${path}: ${r.status}`);
      if (!allowed) assert.equal(r.status, 403, `${t.code} ${path}`);
      checked += 1;
    }
  }
  assert.equal(checked, 44 * 8);
  // the auditor reads and changes nothing; the break-glass role is permission-checked like any other
  assert.equal((await api.call('POST', `${I}/roles`, { roles: 'AUD', headers: idem(), body: { code: 'XAUD', name: 'x' } })).status, 403);
  assert.equal((await api.call('POST', `${I}/roles`, { roles: 'ITADM', headers: idem(), body: { code: 'XIT', name: 'x' } })).status, 403, 'the checker cannot make');
  assert.equal((await api.call('GET', `${I}/roles`, { user: null })).status, 401);
  assert.equal((await api.call('GET', `${I}/roles`, { roles: 'NOSUCHROLE', user: 'x' })).status, 403, 'deny by default');
  await api.close();
});

test('assignment and role-change chains', () => {
  const policy = ['SYSADM', 'ITADM', 'CFO', 'DIR'];
  assert.deepEqual(assignmentChain({ codes: ['PM'], privilegedCodes: policy, bySysadm: false }), ['SYSADM']);
  assert.deepEqual(assignmentChain({ codes: ['PM'], privilegedCodes: policy, bySysadm: true }), ['ITADM']);
  assert.deepEqual(assignmentChain({ codes: ['ITADM'], privilegedCodes: policy, bySysadm: false }), ['SYSADM', 'ITADM|DIR'], 'a privileged role: the IT administrator or the director');
  assert.deepEqual(assignmentChain({ codes: ['PM'], privilegedCodes: policy, sensitive: true, bySysadm: false }), ['SYSADM', 'ITADM|DIR'], 'a custom role with a sensitive permission');
  assert.deepEqual(assignmentChain({ codes: ['CFO'], privilegedCodes: policy, bySysadm: false }), ['SYSADM', 'DIR'], 'a finance approver');
  assert.deepEqual(assignmentChain({ codes: ['SUPADM'], privilegedCodes: policy, bySysadm: false }), ['SYSADM', 'DIR'], 'the break-glass role');
  assert.deepEqual(assignmentChain({ codes: ['SUPADM'], privilegedCodes: policy, bySysadm: true }), ['ITADM', 'DIR'], 'a system administrator cannot be the first approver of their own request');
  assert.deepEqual(roleChangeChain({ privileged: false }), ['ITADM']);
  assert.deepEqual(roleChangeChain({ privileged: true }), ['ITADM', 'DIR']);
});

test('T-02 cross-project isolation: a person assigned to project A cannot list, read or change project B through any endpoint', async () => {
  const app = await boot();
  const sys = await app.as('sysadmin', ['SYSADM']);
  const it = await app.as('indu', ['ITADM']);
  const hr = await app.as('hema', ['HRMGR']);
  const dir = await app.as('dina', ['DIR']);
  await app.mk('pam', []);
  const pooja = { user: 'pooja', roles: ['PM'], companyId: 1 };
  const a = app.orgService.create(pooja, 'projects', { code: 'PA', name: 'Alpha road', type: 'ROAD' }, {});
  const b = app.orgService.create(pooja, 'projects', { code: 'PB', name: 'Bravo bridge', type: 'BRIDGE' }, {});
  const sa = app.orgService.create(pooja, 'sites', { code: 'A1', name: 'Alpha camp', projectId: a.id }, {});
  const sb = app.orgService.create(pooja, 'sites', { code: 'B1', name: 'Bravo camp', projectId: b.id }, {});
  const doc = (project, title) => app.api.db.prepare("INSERT INTO core_sample_documents (company_id, project_id, doc_date, title, status, created_by, source_type) VALUES (1, ?, '2026-10-15', ?, 'DRAFT', 't', 'sample_document')").run(project, title).lastInsertRowid;
  const docA = Number(doc(a.id, 'Memo A'));
  const docB = Number(doc(b.id, 'Memo B'));

  const ask = await sys.post(`${I}/assignments`, { userId: app.idOf('pam'), roleId: app.roleId('PM'), scopeType: 'PROJECT', scopeIds: [a.id], reason: 'Runs the Alpha road project' });
  assert.equal(ask.status, 201, ask.text);
  assert.deepEqual(ask.json.data.chain, ['ITADM', 'DIR'], 'a project manager manages projects, a sensitive permission: the IT administrator, then the director');
  assert.equal((await app.decide(sys, ask.json.data.id)).status, 403, 'the maker cannot be the checker');
  assert.equal((await hr.post(`${I}/assignments`, { userId: app.idOf('pam'), roleId: app.roleId('PM'), scopeType: 'COMPANY', reason: 'Not HR to give' })).status, 403, 'only the system administrator makes assignments');
  const pamToken = await app.login('pam');
  assert.equal((await app.http('GET', `${I}/org/projects`, { token: pamToken })).json.error.code, 'ONBOARDING_RESTRICTED', 'nothing before approval');
  await app.approveAll([it, dir], ask.json.data.id);
  const pam = { token: pamToken, get: (p) => app.http('GET', p, { token: pamToken }), patch: (p, body) => app.http('PATCH', p, { token: pamToken, body }), post: (p, body) => app.http('POST', p, { token: pamToken, body, headers: idem() }) };

  const projects = await pam.get(`${I}/org/projects`);
  assert.deepEqual(projects.json.data.map((p) => p.code), ['PA'], 'only the project they are assigned to');
  assert.equal(projects.json.meta.total, 1);
  assert.equal((await pam.get(`${I}/org/projects/${a.id}`)).status, 200);
  for (const p of [`${I}/org/projects/${b.id}`, `${I}/org/projects/${b.id}/history`, `${I}/org/projects/${b.id}/requests`, `${I}/org/sites/${sb.id}`, `${I}/org/sites/${sb.id}/history`]) assert.equal((await pam.get(p)).status, 404, p);
  assert.deepEqual((await pam.get(`${I}/org/sites`)).json.data.map((s) => s.code), ['A1']);
  assert.equal((await pam.get(`${I}/org/sites?q=Bravo`)).json.meta.total, 0, 'a search does not reach across');
  assert.equal((await pam.get(`${I}/org/sites?filter[projectId]=${b.id}`)).json.meta.total, 0, 'a filter does not either');
  const ctx = (await pam.get(`${I}/org/context`)).json.data;
  assert.deepEqual(ctx.projects.map((p) => p.code), ['PA']);
  assert.deepEqual(ctx.sites.map((s) => s.code), ['A1']);

  // changing: inside the scope only
  assert.equal((await pam.patch(`${I}/org/projects/${a.id}`, { name: 'Alpha road widening', version: a.version })).status, 200);
  assert.equal((await pam.patch(`${I}/org/projects/${b.id}`, { name: 'Taken over', version: b.version })).status, 404);
  assert.equal((await pam.post(`${I}/org/projects/${b.id}/activation-requests`, { reason: 'Mobilised and ready' })).status, 404);
  const mine = await pam.post(`${I}/org/sites`, { code: 'A2', name: 'Alpha plant yard', projectId: a.id });
  assert.equal(mine.status, 201, mine.text);
  assert.equal((await pam.post(`${I}/org/sites`, { code: 'B2', name: 'Bravo plant yard', projectId: b.id })).status, 403, 'a site cannot be added to a project outside the scope');
  assert.equal((await pam.post(`${I}/org/projects`, { code: 'PC', name: 'Charlie', type: 'ROAD' })).status, 403, 'a project is company-level: only a company-wide grant creates one');
  for (const p of ['departments', 'branches', 'designations', 'locations']) assert.equal((await pam.get(`${I}/org/${p}`)).status, 403, `${p} are company-level`);
  assert.equal((await pam.get(`${I}/org/tree`)).status, 403);
  assert.equal((await pam.get(`${I}/users`)).status, 403);
  assert.equal((await pam.get(`${I}/admin/policy`)).status, 403);

  // another endpoint that carries a project: the sample documents
  assert.deepEqual((await pam.get(`${C}/sample-documents`)).json.data.map((d) => d.title), ['Memo A']);
  assert.equal((await pam.post(`${C}/sample-documents/${docB}/submit`, { version: 1 })).status, 404);
  assert.deepEqual((await sys.get(`${C}/sample-documents`)).json.data.map((d) => d.title).sort(), ['Memo A', 'Memo B'], 'a company-wide grant sees both');
  assert.ok(docA);

  // the person's page of access
  const access = (await pam.get(`${I}/me/access`)).json.data;
  assert.deepEqual(access.scopes['org.view'], { projects: [a.id], sites: [] }, 'the project covers its sites, including ones added later');
  assert.ok(sa.id && mine.json.data.id);
  assert.ok(!access.companyWide.includes('org.view'));
  assert.ok(access.anywhere.includes('org.view'));
  assert.equal((await pam.get(`${I}/me`)).json.data.lifecycle, 'ACTIVE', 'the person left onboarding when the assignment was approved');

  // ending the assignment closes it again, and the person goes back to onboarding
  const row = (await sys.get(`${I}/assignments?filter[userId]=${app.idOf('pam')}`)).json.data[0];
  assert.equal(row.scopeType, 'PROJECT');
  assert.deepEqual(row.scopeNames, ['PA']);
  assert.equal(row.inForce, true);
  assert.equal((await sys.post(`${I}/assignments/${row.id}/end`, { reason: 'Moved to another project' })).status, 200);
  assert.equal((await pam.get(`${I}/org/projects`)).json.error.code, 'ONBOARDING_RESTRICTED');
  await app.close();
});

test('a scoped grant never reaches a route that does not look at the record', async () => {
  const app = await boot();
  const sys = await app.as('sysadmin', ['SYSADM']);
  const it = await app.as('indu', ['ITADM']);
  await app.mk('pat', []);
  const a = app.orgService.create({ user: 'pooja', roles: ['PM'], companyId: 1 }, 'projects', { code: 'PA', name: 'Alpha', type: 'ROAD' }, {});
  // ITADM holds technical administration; given to a person for one project it must still not become company-wide
  const ask = await sys.post(`${I}/assignments`, { userId: app.idOf('pat'), roleId: app.roleId('ITADM'), scopeType: 'PROJECT', scopeIds: [a.id], reason: 'Technical support for Alpha only' });
  assert.deepEqual(ask.json.data.chain, ['ITADM', 'DIR'], 'a privileged role asked by a system administrator: IT administrator then director');
  const dir = await app.as('dina', ['DIR']);
  assert.equal((await app.decide(it, ask.json.data.id)).status, 200);
  assert.equal((await app.decide(it, ask.json.data.id)).status, 403, 'the same person cannot decide two steps');
  assert.equal((await app.decide(dir, ask.json.data.id)).status, 200);
  const pat = { token: await app.login('pat') };
  for (const p of [`${C}/connectors`, `${C}/jobs`, `${C}/events`, `${C}/feature-flags`, `${I}/admin/policy`, `${I}/admin/sessions`]) assert.equal((await app.http('GET', p, pat)).status, 403, p);
  assert.ok((await app.http('GET', `${C}/session`, pat)).json.data.permissions.includes('core.connectors.view'), 'the menu may show it');
  await app.close();
});

test('AC-02 the effective-permission viewer says allowed or refused, and which grant decided', async () => {
  const app = await boot();
  const sys = await app.as('sysadmin', ['SYSADM']);
  const it = await app.as('indu', ['ITADM']);
  const dir = await app.as('dina', ['DIR']);
  await app.mk('pam', []);
  const pooja = { user: 'pooja', roles: ['PM'], companyId: 1 };
  const a = app.orgService.create(pooja, 'projects', { code: 'PA', name: 'Alpha road', type: 'ROAD' }, {});
  const b = app.orgService.create(pooja, 'projects', { code: 'PB', name: 'Bravo bridge', type: 'BRIDGE' }, {});
  const ask = await sys.post(`${I}/assignments`, { userId: app.idOf('pam'), roleId: app.roleId('PM'), scopeType: 'PROJECT', scopeIds: [a.id], reason: 'Runs the Alpha road project' });
  await app.approveAll([it, dir], ask.json.data.id);
  const row = (res, key) => res.json.data.permissions.find((p) => p.key === key);
  const none = await sys.get(`${I}/effective?userId=${app.idOf('pam')}`);
  assert.equal(none.status, 200, none.text);
  assert.equal(row(none, 'org.view').allowed, true);
  assert.match(row(none, 'org.view').reason, /part of the company/);
  assert.equal(row(none, 'org.view').sources[0].role, 'PM');
  assert.equal(row(none, 'org.view').sources[0].scopeType, 'PROJECT');
  assert.equal(row(none, 'core.settings.configure').allowed, false);
  assert.match(row(none, 'core.settings.configure').reason, /None of the roles held grants/);
  const inA = await sys.get(`${I}/effective?userId=${app.idOf('pam')}&recordType=project&recordId=${a.id}`);
  assert.equal(row(inA, 'org.project.manage').allowed, true);
  assert.match(row(inA, 'org.project.manage').reason, /inside the scope/);
  assert.equal(inA.json.data.record.label, 'Project PA Alpha road');
  const inB = await sys.get(`${I}/effective?userId=${app.idOf('pam')}&recordType=project&recordId=${b.id}`);
  assert.equal(row(inB, 'org.project.manage').allowed, false);
  assert.match(row(inB, 'org.project.manage').reason, /outside the scope/);
  assert.equal((await sys.get(`${I}/effective?userId=${app.idOf('pam')}&recordType=nothing&recordId=1`)).status, 400);
  assert.equal((await sys.get(`${I}/effective?userId=${app.idOf('pam')}&recordType=project&recordId=999`)).status, 404);
  assert.equal((await sys.get(`${I}/effective?userId=999`)).status, 404);
  assert.equal((await it.get(`${I}/effective?userId=${app.idOf('pam')}`)).status, 200, 'the checker may read it too');
  await app.close();
});

test('BR-03 a custom role is made by one person and checked by another; a system role is locked', async () => {
  const app = await boot();
  const sys = await app.as('sysadmin', ['SYSADM']);
  const it = await app.as('indu', ['ITADM']);
  const dir = await app.as('dina', ['DIR']);
  const hr = await app.as('hema', ['HRMGR']);
  const pm = app.roleId('PM');
  assert.equal((await hr.post(`${I}/roles`, { code: 'SITELEAD', name: 'Site lead' })).status, 403);
  const made = await sys.post(`${I}/roles`, { code: 'sitelead', name: 'Site lead', description: 'Runs one site', cloneFromId: pm });
  assert.equal(made.status, 201, made.text);
  const role = made.json.data;
  assert.equal(role.code, 'SITELEAD');
  assert.equal(role.kind, 'CUSTOM');
  assert.equal(role.status, 'DRAFT');
  assert.equal(role.parent.code, 'PM');
  assert.deepEqual(role.permissions.map((p) => p.key).sort(), [...TEMPLATE_PERMISSIONS.PM].sort(), 'a copy starts as the template');
  assert.equal((await sys.post(`${I}/roles`, { code: 'SITELEAD', name: 'Again' })).status, 409);
  assert.equal((await sys.post(`${I}/roles`, { code: 'PM', name: 'Clash' })).status, 409, 'a system code is taken');
  const locked = await sys.patch(`${I}/roles/${pm}`, { name: 'Renamed', version: 1 });
  assert.equal(locked.status, 422);
  assert.match(locked.json.error.message, /locked/);
  assert.equal((await sys.post(`${I}/roles/${pm}/change-requests`, { permissions: { allow: ['org.view'], deny: [] }, reason: 'Cutting the template' })).status, 422);

  // a draft grants nothing, and a change is a request
  await app.mk('sam', []);
  const early = await sys.post(`${I}/assignments`, { userId: app.idOf('sam'), roleId: role.id, scopeType: 'COMPANY', reason: 'Before it is active' });
  assert.equal(early.status, 422, 'a draft role cannot be assigned');
  const bad = await sys.post(`${I}/roles/${role.id}/change-requests`, { permissions: { allow: ['no.such.permission'], deny: [] }, reason: 'A key nobody registered' });
  assert.equal(bad.status, 400);
  const overlap = await sys.post(`${I}/roles/${role.id}/change-requests`, { permissions: { allow: ['org.view'], deny: ['org.view'] }, reason: 'Allowed and denied' });
  assert.equal(overlap.status, 400);
  const allow = [...TEMPLATE_PERMISSIONS.PM, 'core.fy.view'].filter((k) => k !== 'core.numbering.preview');
  const asked = await sys.post(`${I}/roles/${role.id}/change-requests`, { permissions: { allow, deny: ['core.numbering.preview'] }, masks: [{ entity: 'employee', field: 'salary', rule: 'show' }], activate: true, reason: 'The role the site leads need' });
  assert.equal(asked.status, 201, asked.text);
  assert.deepEqual(asked.json.data.chain, ['ITADM', 'DIR'], 'the role holds a sensitive permission, so the director checks too');
  assert.equal((await sys.post(`${I}/roles/${role.id}/change-requests`, { clearance: 'confidential', reason: 'A second open change' })).status, 409);
  assert.equal(app.api.db.prepare("SELECT status FROM iam_roles WHERE id = ?").get(role.id).status, 'DRAFT', 'nothing changes before approval');
  assert.equal((await app.decide(sys, asked.json.data.id)).status, 403);
  assert.equal((await app.decide(it, asked.json.data.id)).status, 200);
  assert.equal(app.api.db.prepare("SELECT status FROM iam_roles WHERE id = ?").get(role.id).status, 'DRAFT', 'one approval of two is not enough');
  assert.equal((await app.decide(dir, asked.json.data.id)).status, 200);
  const live = (await sys.get(`${I}/roles/${role.id}`)).json.data;
  assert.equal(live.status, 'ACTIVE');
  assert.deepEqual(live.permissions.filter((p) => p.effect === 'deny').map((p) => p.key), ['core.numbering.preview']);
  assert.ok(live.permissions.some((p) => p.key === 'core.fy.view' && p.effect === 'allow'));
  assert.deepEqual(live.masks, [{ entity: 'employee', field: 'salary', rule: 'show' }]);
  assert.equal(live.requests.length, 1);
  assert.equal(live.requests[0].status, 'APPROVED');

  // now it can be given, and its deny beats an allow from another role
  const give = await sys.post(`${I}/assignments`, { userId: app.idOf('sam'), roleId: role.id, scopeType: 'COMPANY', reason: 'Leads the Pune site' });
  assert.equal(give.status, 201, give.text);
  assert.deepEqual(give.json.data.chain, ['ITADM', 'DIR'], 'a custom role with a sensitive permission is a privileged assignment');
  await app.decide(it, give.json.data.id);
  await app.decide(dir, give.json.data.id);
  app.api.db.prepare("UPDATE iam_users SET roles_json = '[\"PM\"]' WHERE username = 'sam'").run();
  const samToken = await app.login('sam');
  const sam = { token: samToken };
  assert.equal((await app.http('GET', `${C}/financial-years`, sam)).status, 200, 'core.fy.view comes from the custom role');
  const eff = (await sys.get(`${I}/effective?userId=${app.idOf('sam')}`)).json.data.permissions.find((p) => p.key === 'core.numbering.preview');
  assert.equal(eff.allowed, false, 'PM allows it, the custom role denies it, and deny wins');
  assert.match(eff.reason, /explicitly denied/);
  assert.equal(eff.sources.filter((s) => s.effect === 'deny')[0].role, 'SITELEAD');

  // retiring is refused while somebody holds the role
  const retire = await sys.post(`${I}/roles/${role.id}/change-requests`, { retire: true, reason: 'No longer needed' });
  assert.equal(retire.status, 422);
  assert.match(retire.json.error.message, /still hold this role/);
  const list = (await sys.get(`${I}/roles?filter[kind]=CUSTOM`)).json.data;
  assert.deepEqual(list.map((r) => [r.code, r.holders, r.status]), [['SITELEAD', 1, 'ACTIVE']]);
  assert.equal((await sys.get(`${I}/roles?filter[kind]=SYSTEM&pageSize=100`)).json.meta.total, 44);
  const cmp = (await sys.get(`${I}/roles/compare?a=${pm}&b=${role.id}`)).json.data;
  assert.equal(cmp.onlyA, 0);
  assert.equal(cmp.onlyB, 1, 'core.fy.view');
  assert.ok(cmp.permissions.find((p) => p.key === 'core.numbering.preview' && p.a === 'allow' && p.b === 'deny'));
  assert.ok(cmp.masks.find((m) => m.field === 'employee.salary' && m.a === 'default' && m.b === 'show'));
  await app.close();
});

test('BR-01 explicit deny overrides allow, a union within scope, and a record above a role\'s clearance is refused (FR-09)', async () => {
  const api = await startApi();
  const authz = authzOf(api.db);
  const mkRole = (code, allow, deny = [], clearance = 'internal') => {
    const id = Number(api.db.prepare("INSERT INTO iam_roles (company_id, code, name, kind, category, is_system, status, clearance, created_by) VALUES (1, ?, ?, 'CUSTOM', 'CUSTOM', 0, 'ACTIVE', ?, 't')").run(code, code, clearance).lastInsertRowid);
    for (const k of allow) api.db.prepare("INSERT INTO iam_role_permissions (role_id, perm_key, effect) VALUES (?, ?, 'allow')").run(id, k);
    for (const k of deny) api.db.prepare("INSERT INTO iam_role_permissions (role_id, perm_key, effect) VALUES (?, ?, 'deny')").run(id, k);
    return id;
  };
  mkRole('READER', ['org.view', 'core.fy.view']);
  mkRole('BLOCKER', [], ['core.fy.view']);
  mkRole('SECRET', ['org.view'], [], 'restricted');
  authz.invalidate();
  const actor = (roles) => ({ user: 'u', roles, companyId: 1 });
  assert.equal((await api.call('GET', `${C}/financial-years`, { roles: 'READER', user: 'u' })).status, 200);
  assert.equal((await api.call('GET', `${C}/financial-years`, { roles: 'READER,BLOCKER', user: 'u' })).status, 403, 'a deny in any role held beats an allow in another');
  assert.equal(authz.check(actor(['READER']), 'org.view', { companyId: 1, confidentiality: 'internal' }).allowed, true);
  assert.equal(authz.check(actor(['READER']), 'org.view', { companyId: 1, confidentiality: 'confidential' }).allowed, false, 'above the clearance of internal');
  assert.match(authz.check(actor(['READER']), 'org.view', { companyId: 1, confidentiality: 'restricted' }).reason, /highest level/);
  assert.equal(authz.check(actor(['READER', 'SECRET']), 'org.view', { companyId: 1, confidentiality: 'restricted' }).allowed, true, 'the highest clearance of the roles held');
  assert.equal(authz.check(actor(['READER']), 'org.view', { companyId: 2 }).allowed, false, 'another company');
  assert.equal(authz.check(actor(['READER']), 'core.sample.use').allowed, false, 'deny by default');
  // a role that is not active grants nothing
  api.db.prepare("UPDATE iam_roles SET status = 'RETIRED' WHERE code = 'READER'").run();
  authz.invalidate();
  assert.equal((await api.call('GET', `${C}/financial-years`, { roles: 'READER', user: 'u' })).status, 403);
  await api.close();
});

test('T-03 a masked field is absent from the API, the search and the export for a role that may not see it', async () => {
  const app = await boot();
  const hr = await app.as('hema', ['HRMGR']);
  const it = await app.as('indu', ['ITADM']);
  const sys = await app.as('sysadmin', ['SYSADM']);
  const created = await hr.post(`${I}/users`, { displayName: 'Anil Verma', email: 'anil@example.com', mobile: '9876543210' });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.data.mobile, '+919876543210', 'the role that manages users sees it');
  assert.match((await it.get(`${I}/users/${created.json.data.id}`)).json.data.mobile, /^\+91•+3210$/, 'a viewer sees it partly');
  const csv = (list) => list.map((u) => [u.displayName, u.mobile].join(',')).join('\n'); // what the page's export writes
  assert.ok(!csv((await it.get(`${I}/users?pageSize=100`)).json.data).includes('9876543210'), 'and so does the export');
  assert.ok(csv((await hr.get(`${I}/users?pageSize=100`)).json.data).includes('9876543210'));
  for (const who of [it, hr, sys]) assert.equal((await who.get(`${I}/users?q=9876543210`)).json.meta.total, 0, 'a number cannot be found by searching for it');
  // the sample field of the employee master, declared before the master exists
  const authz = authzOf(app.api.db);
  const record = { name: 'Ravi', salary: 90000, bank_account: '123456789012' };
  const as = (roles) => ({ user: 'u', roles, companyId: 1 });
  assert.deepEqual(authz.mask(as(['PM']), 'employee', record), { name: 'Ravi', bank_account: '••••••••9012' }, 'salary is not there at all');
  assert.ok(fieldRegistry.get('employee', 'salary'));
  assert.equal(authz.maskRule(as(['PM']), 'employee', 'salary'), 'hide');
  assert.equal(authz.mask(as(['PM']), 'org_company', { pan: 'ABCDE1234F' }).pan, 'AB******4F');
  assert.equal(authz.mask(as(['SYSADM']), 'org_company', { pan: 'ABCDE1234F' }).pan, 'ABCDE1234F');
  assert.equal(authz.mask(as(['PM']), 'iam_user', { mobile: '+919876543210' }).mobile, '+91•••••••3210'.replace('•••••••', '••••••'));
  // a role may be given the field through an approved change
  app.api.db.prepare("INSERT INTO iam_roles (company_id, code, name, kind, category, is_system, status, created_by) VALUES (1, 'PAYVIEW', 'Payroll view', 'CUSTOM', 'CUSTOM', 0, 'ACTIVE', 't')").run();
  const rid = Number(app.api.db.prepare("SELECT id FROM iam_roles WHERE code = 'PAYVIEW'").get().id);
  app.api.db.prepare("INSERT INTO iam_field_masks (role_id, entity, field, rule) VALUES (?, 'employee', 'salary', 'show')").run(rid);
  authz.invalidate();
  assert.equal(authz.mask(as(['PAYVIEW']), 'employee', record).salary, 90000);
  assert.equal(authz.mask(as(['PAYVIEW', 'PM']), 'employee', record).salary, 90000, 'the most permissive rule among the roles held');
  await app.close();
});

test('T-04 the legacy comparison shows nobody lost access or gained any that is not new to this part', async () => {
  const app = await boot();
  const sys = await app.as('sysadmin', ['SYSADM']);
  for (const [i, code] of Object.keys(LEGACY_ROLE_PERMISSIONS).entries()) await app.mk(`legacy-${i}-${code.toLowerCase()}`, [code]);
  await app.mk('multi', ['PM', 'ACCMGR']);
  await app.mk('stranger', ['SUPPLIER']);
  await app.mk('nobody', []);
  const res = await sys.get(`${I}/legacy-comparison?pageSize=100`);
  assert.equal(res.status, 200, res.text);
  const d = res.json;
  assert.equal(d.clean, true);
  assert.equal(d.summary.lost, 0, 'nobody lost access');
  assert.equal(d.summary.gained, 0, 'nobody gained access beyond the new role and assignment permissions');
  assert.equal(d.summary.unmapped, 1, 'the one role the engine has never heard of is flagged, not silently dropped');
  const byName = Object.fromEntries(d.data.map((r) => [r.username, r]));
  assert.equal(byName['legacy-0-sysadm'].result, 'NEW_ONLY');
  const sysadm = ROLE_TEMPLATES.find((t) => t.code === 'SYSADM');
  assert.deepEqual(byName['legacy-0-sysadm'].newOnly, sysadm.permissions.filter((k) => !LEGACY_ROLE_PERMISSIONS.SYSADM.includes(k)).sort(), 'only what the role engine and the privileged-access part added');
  assert.ok(byName['legacy-0-sysadm'].newOnly.includes('iam.role.manage') && byName['legacy-0-sysadm'].newOnly.includes('iam.sod.manage'));
  assert.equal(byName['multi'].result, 'NEW_ONLY', 'the permissions added since: asking for elevated access, deciding a review');
  assert.deepEqual(byName['multi'].gained, []);
  assert.equal(byName.stranger.result, 'UNMAPPED');
  assert.deepEqual(byName.stranger.unmapped, ['SUPPLIER']);
  assert.equal(byName.nobody.result, 'SAME');
  const pmOnly = d.data.find((r) => r.roles.length === 1 && r.roles[0] === 'PM');
  assert.deepEqual(pmOnly.newOnly, ['acc.ledger.view', 'acc.raci.maintain', 'acc.raci.view', 'acc.report.view', 'alr.alert.manage', 'alr.alert.view', 'alr.rule.edit', 'alr.rule.view', 'att.anomaly.review', 'att.anomaly.view', 'att.arrears.view', 'att.assignment.view', 'att.policy.view', 'att.punch.kiosk', 'att.punch.own', 'att.punch.view', 'att.register.export', 'att.register.view', 'att.roster.approve', 'att.roster.change', 'att.roster.edit', 'att.roster.view', 'att.shift.view', 'bud.budget.approve', 'bud.budget.export', 'bud.budget.print', 'bud.budget.view', 'bud.change.amend', 'bud.change.approve', 'bud.change.cancel', 'bud.change.create', 'bud.change.delete', 'bud.change.edit', 'bud.change.export', 'bud.change.print', 'bud.change.submit', 'bud.change.view', 'bud.check.configure', 'bud.check.use', 'bud.check.view', 'bud.ledger.export', 'bud.ledger.view', 'col.activity.view', 'col.comment.moderate', 'col.trace.link', 'doc.config.view', 'doc.document.create', 'doc.document.view', 'doc.document.view_confidential', 'eng.delegation.use', 'eng.pcs.emergency', 'eng.pcs.raise', 'eng.pcs.view', 'eng.sample.import', 'eng.sample.use', 'engg.deliverable.export', 'engg.deliverable.print', 'engg.deliverable.view', 'engg.drawing.approve', 'engg.drawing.distribute', 'engg.drawing.export', 'engg.drawing.print', 'engg.drawing.view', 'engg.letter.amend', 'engg.letter.approve', 'engg.letter.cancel', 'engg.letter.create', 'engg.letter.edit', 'engg.letter.export', 'engg.letter.issue', 'engg.letter.print', 'engg.letter.submit', 'engg.letter.view', 'engg.letter.view_confidential', 'engg.rfi.export', 'engg.rfi.print', 'engg.rfi.view', 'engg.submittal.approve', 'engg.submittal.export', 'engg.submittal.print', 'engg.submittal.view', 'engg.transmittal.export', 'engg.transmittal.print', 'engg.transmittal.view', 'engg.vdr_item.export', 'engg.vdr_item.print', 'engg.vdr_item.view', 'est.bb.approve', 'est.bb.export', 'est.bb.print', 'est.bb.view', 'est.estimate.print', 'est.estimate.view', 'est.takeoff.approve', 'est.takeoff.export', 'est.takeoff.print', 'est.takeoff.view', 'fin.coa.view', 'hr.advance.approve', 'hr.advance.cancel', 'hr.advance.create', 'hr.advance.delete', 'hr.advance.edit', 'hr.advance.print', 'hr.advance.submit', 'hr.advance.view', 'hr.application.amend', 'hr.application.approve', 'hr.application.cancel', 'hr.application.create', 'hr.application.delete', 'hr.application.edit', 'hr.application.export', 'hr.application.print', 'hr.application.submit', 'hr.application.view', 'hr.cert.check', 'hr.cert.view', 'hr.claim.approve', 'hr.claim.cancel', 'hr.claim.create', 'hr.claim.delete', 'hr.claim.edit', 'hr.claim.print', 'hr.claim.submit', 'hr.claim.view', 'hr.clearance.clear', 'hr.clearance.view', 'hr.crew.edit', 'hr.crew.members', 'hr.crew.view', 'hr.deployment.amend', 'hr.deployment.approve', 'hr.deployment.cancel', 'hr.deployment.create', 'hr.deployment.delete', 'hr.deployment.edit', 'hr.deployment.export', 'hr.deployment.import', 'hr.deployment.print', 'hr.deployment.submit', 'hr.deployment.view', 'hr.employee.export', 'hr.employee.team.view', 'hr.ess.letter.cancel', 'hr.ess.letter.create', 'hr.ess.letter.delete', 'hr.ess.letter.edit', 'hr.ess.letter.print', 'hr.ess.letter.submit', 'hr.ess.letter.view', 'hr.ess.team', 'hr.ess.view', 'hr.expense.report', 'hr.grievance.cancel', 'hr.grievance.create', 'hr.grievance.delete', 'hr.grievance.edit', 'hr.grievance.submit', 'hr.grievance.view', 'hr.interview.give', 'hr.overtime_request.amend', 'hr.overtime_request.approve', 'hr.overtime_request.cancel', 'hr.overtime_request.create', 'hr.overtime_request.delete', 'hr.overtime_request.edit', 'hr.overtime_request.export', 'hr.overtime_request.print', 'hr.overtime_request.submit', 'hr.overtime_request.view', 'hr.perf.feedback', 'hr.perf.own', 'hr.perf.team', 'hr.regularisation.amend', 'hr.regularisation.approve', 'hr.regularisation.cancel', 'hr.regularisation.create', 'hr.regularisation.delete', 'hr.regularisation.edit', 'hr.regularisation.export', 'hr.regularisation.print', 'hr.regularisation.submit', 'hr.regularisation.view', 'hr.requisition.approve', 'hr.requisition.cancel', 'hr.requisition.create', 'hr.requisition.delete', 'hr.requisition.edit', 'hr.requisition.print', 'hr.requisition.submit', 'hr.requisition.view', 'hr.review.approve', 'hr.review.edit', 'hr.review.print', 'hr.review.view', 'hr.separation.approve', 'hr.separation.cancel', 'hr.separation.create', 'hr.separation.delete', 'hr.separation.edit', 'hr.separation.print', 'hr.separation.submit', 'hr.separation.view', 'hr.session.approve', 'hr.session.view', 'hr.skill.assess', 'hr.skill.view', 'hr.training.nominate', 'hr.training.own', 'hr.training.report', 'hr.transfer.amend', 'hr.transfer.approve', 'hr.transfer.cancel', 'hr.transfer.create', 'hr.transfer.delete', 'hr.transfer.edit', 'hr.transfer.print', 'hr.transfer.submit', 'hr.transfer.view', 'hr.travel_request.approve', 'hr.travel_request.cancel', 'hr.travel_request.create', 'hr.travel_request.delete', 'hr.travel_request.edit', 'hr.travel_request.print', 'hr.travel_request.submit', 'hr.travel_request.view', 'hr.worker.approve', 'hr.worker.cancel', 'hr.worker.create', 'hr.worker.delete', 'hr.worker.edit', 'hr.worker.export', 'hr.worker.print', 'hr.worker.submit', 'hr.worker.view', 'iam.elevation.request', 'iam.review.decide', 'lv.team.view', 'mdm.analyse.approve', 'mdm.analyse.export', 'mdm.analyse.print', 'mdm.analyse.view', 'mdm.item.rate.view', 'mdm.record.view', 'msg.announcement.send', 'msg.channel.manage', 'msg.instruction.send', 'off.sync.confirm', 'plan.baseline.approve', 'plan.baseline.export', 'plan.baseline.print', 'plan.baseline.view', 'plan.calendar.view', 'plan.constraint.manage', 'plan.constraint.view', 'plan.delay.approve', 'plan.delay.export', 'plan.delay.print', 'plan.delay.view', 'plan.lookahead.view', 'plan.resource.view', 'plan.schedule.export', 'plan.schedule.print', 'plan.schedule.view', 'plan.weekly_plan.approve', 'plan.weekly_plan.export', 'plan.weekly_plan.print', 'plan.weekly_plan.view', 'proc.comparative_statement.approve', 'proc.comparative_statement.export', 'proc.comparative_statement.print', 'proc.comparative_statement.view', 'proc.material_request.export', 'proc.material_request.print', 'proc.material_request.view', 'proc.requisition.approve', 'proc.requisition.cost', 'proc.requisition.emergency', 'proc.requisition.export', 'proc.requisition.print', 'proc.requisition.view', 'proc.rfq.print', 'proc.rfq.view', 'proc.run.print', 'proc.run.view', 'proj.action.update', 'proj.baseline_pack.print', 'proj.baseline_pack.view', 'proj.boq.map', 'proj.boq.rates', 'proj.gis.approve', 'proj.gis.cancel', 'proj.gis.create', 'proj.gis.delete', 'proj.gis.edit', 'proj.gis.export', 'proj.gis.import', 'proj.gis.print', 'proj.gis.progress', 'proj.gis.submit', 'proj.gis.view', 'proj.handover.manage', 'proj.issue.amend', 'proj.issue.approve', 'proj.issue.cancel', 'proj.issue.create', 'proj.issue.delete', 'proj.issue.edit', 'proj.issue.export', 'proj.issue.print', 'proj.issue.submit', 'proj.issue.view', 'proj.meeting.amend', 'proj.meeting.approve', 'proj.meeting.cancel', 'proj.meeting.create', 'proj.meeting.delete', 'proj.meeting.edit', 'proj.meeting.export', 'proj.meeting.print', 'proj.meeting.submit', 'proj.meeting.view', 'proj.milestone.manage', 'proj.p360.export', 'proj.p360.view', 'proj.project.amend', 'proj.project.edit', 'proj.project.print', 'proj.project.transition', 'proj.project.view', 'proj.risk.amend', 'proj.risk.approve', 'proj.risk.cancel', 'proj.risk.create', 'proj.risk.delete', 'proj.risk.edit', 'proj.risk.export', 'proj.risk.print', 'proj.risk.submit', 'proj.risk.view', 'proj.stakeholder.contact', 'proj.stakeholder.export', 'proj.stakeholder.manage', 'proj.stakeholder.view', 'proj.team.manage', 'proj.team.view', 'proj.version.amend', 'proj.version.approve', 'proj.version.export', 'proj.version.print', 'proj.version.view', 'proj.wbs.approve', 'proj.wbs.baseline', 'proj.wbs.change', 'proj.wbs.export', 'proj.wbs.view', 'sig.document.cancel', 'sig.document.sign', 'sig.document.view', 'site.control.approve', 'site.control.export', 'site.control.reconcile', 'site.control.view', 'site.daily_plan.view', 'site.diary.export', 'site.diary.view', 'site.dpr.approve', 'site.dpr.export', 'site.dpr.print', 'site.dpr.report', 'site.dpr.view', 'site.hindrance.approve', 'site.hindrance.cancel', 'site.hindrance.close', 'site.hindrance.export', 'site.hindrance.print', 'site.hindrance.view', 'site.instruction.acknowledge', 'site.instruction.amend', 'site.instruction.approve', 'site.instruction.cancel', 'site.instruction.close', 'site.instruction.comply', 'site.instruction.cost', 'site.instruction.create', 'site.instruction.delete', 'site.instruction.edit', 'site.instruction.export', 'site.instruction.print', 'site.instruction.submit', 'site.instruction.view', 'site.period.approve', 'site.period.cost', 'site.period.export', 'site.period.print', 'site.period.view', 'site.productivity.approve', 'site.productivity.export', 'site.productivity.record', 'site.productivity.view', 'site.visitor.export', 'site.visitor.view', 'site.weather.export', 'site.weather.view', 'site.work_authorisation.approve', 'site.work_authorisation.cancel', 'site.work_authorisation.export', 'site.work_authorisation.print', 'site.work_authorisation.view', 'site.work_front.view', 'tpl.document.deliver', 'tpl.document.generate', 'tpl.document.view', 'tpl.template.view', 'tsk.instruction.create', 'tsk.task.assign', 'tsk.team.view', 'ui.view.share', 'xl.import.use'], 'a project manager gains only the rights to use the sample document (04.01), to delegate (04.02), to see and raise control exceptions (04.04), to keep the RACI and read the ledger of their projects, (04.05), to give tasks, raise instructions and see the tasks of their team (04.08), to keep alert rules and settle the alerts of their projects (04.09), to register and see documents, confidential ones too, and see the document configuration (04.10), to moderate comments, add trace links and read the activity feed of their projects (04.14), to confirm old offline work (04.15), to make project channels (05.01), to ask for elevated access, to decide a review and to share list views (03.03), to see the chart of accounts and cost codes (06.05), to see, print, export and release project rate analyses (06.06), to deploy people, keep crews and approve deployments and transfers of their projects (07.03), to plan rosters, ask for and approve roster changes and read shifts, policies and assignments of their projects (07.04), to punch for themselves, see the punches and anomalies of their sites, review them and run the kiosk (07.05), to use self-service and ask for letters, and see their team (07.09), to nominate people to trainings, see certificates and skills of their team, assess skills and see the training report (07.10), to write their own performance reviews, set goals, give feedback and see the performance of their team (07.11), to raise their own claims, advances and travel requests, approve those of their team, and see the expense analysis (07.12), to resign, raise grievances, approve the resignations of their team and clear the exit items of their department (07.13), to see and print estimates with the costs masked (09.01), to release, print and export take-off sheets and bar bending schedules (09.02), to keep the project master, its milestones and its moves within their projects (10.01), to see and print the commercial baseline and keep handover meetings (10.02), to see, baseline, change, approve and export the WBS of their projects (10.03), to see, approve, amend, print and export BOQ versions, map items and see rates (10.04), to keep the project team, stakeholders and meetings, issue minutes as the chair and update their own actions (10.05), and to keep the risk register, issue log and monthly review of their projects (10.06), and to keep the map layers, overlays and progress of their projects (10.07), and to see and export Project 360 (10.08), and to approve, distribute, print and export drawings and see transmittals (11.01), and to see, print and export RFIs (11.02), and to approve, print and export submittals (11.03), and to see, print and export deliverables and vendor documents (11.04), and to keep, approve, issue and export the correspondence register including confidential letters (11.05), and to approve, print and export project budgets (12.01), and to request, approve and export budget changes and drawdowns (12.02), and to see the budget check settings, propose them, use the check and read the commitment ledger (12.03), and to see, approve, cancel, print and export work authorisations and see work fronts and daily plans (14.01), and to see, approve, print and export daily progress reports and read their reports (14.02)');
  assert.equal(pmOnly.after - pmOnly.before, 421);
  assert.equal((await sys.get(`${I}/legacy-comparison?filter[result]=UNMAPPED`)).json.meta.total, 1);
  const map = (await sys.get(`${I}/legacy-mapping`)).json.data;
  assert.equal(map.length, 9);
  assert.ok(map.every((m) => m.mappingType === 'ALIAS' && m.roleCode === m.legacyRole));
  // and the comparison does catch a real loss
  app.api.db.prepare("DELETE FROM iam_role_permissions WHERE perm_key = 'org.project.manage' AND role_id = (SELECT id FROM iam_roles WHERE code = 'PM' AND company_id IS NULL)").run();
  authzOf(app.api.db).invalidate();
  const broken = (await sys.get(`${I}/legacy-comparison?pageSize=100`)).json;
  assert.equal(broken.clean, false);
  assert.ok(broken.summary.lost >= 1);
  assert.deepEqual(broken.data.find((r) => r.roles.length === 1 && r.roles[0] === 'PM').lost, ['org.project.manage']);
  await app.close();
});

test('FR-06 a change takes effect at once on the instance that made it and within 60 seconds on any other', async () => {
  const clock = { t: Date.parse('2026-10-30T10:00:00.000Z') };
  const api = await startApi({}, { identityOptions: { now: () => clock.t } });
  const authz = authzOf(api.db);
  const id = Number(api.db.prepare("INSERT INTO iam_roles (company_id, code, name, kind, category, is_system, status, created_by) VALUES (1, 'LOOKER', 'Looker', 'CUSTOM', 'CUSTOM', 0, 'ACTIVE', 't')").run().lastInsertRowid);
  api.db.prepare("INSERT INTO iam_role_permissions (role_id, perm_key, effect) VALUES (?, 'iam.role.view', 'allow')").run(id);
  authz.invalidate();
  const get = () => api.call('GET', `${I}/roles`, { roles: 'LOOKER', user: 'u' });
  assert.equal((await get()).status, 200);
  // another instance changes the stored grants: this one does not know until its cache expires
  api.db.prepare('DELETE FROM iam_role_permissions WHERE role_id = ?').run(id);
  assert.equal((await get()).status, 200, 'still cached');
  clock.t += 29_000;
  assert.equal((await get()).status, 200, 'still cached after 29 seconds');
  clock.t += 2_000;
  assert.equal((await get()).status, 403, 'refreshed after 30 seconds');
  // and the instance that made the change refreshes at once
  api.db.prepare("INSERT INTO iam_role_permissions (role_id, perm_key, effect) VALUES (?, 'iam.role.view', 'allow')").run(id);
  authz.invalidate();
  assert.equal((await get()).status, 200);
  await api.close();
});

/** A calendar day in India, n days from today: the test is about dates, so it must not depend on the day it is run. */
const day = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
test('FR-03 an assignment can be dated: it applies from its start date and not after its end date', async () => {
  const app = await boot();
  const sys = await app.as('sysadmin', ['SYSADM']);
  const it = await app.as('indu', ['ITADM']);
  const dir = await app.as('dina', ['DIR']);
  await app.mk('tara', []);
  const ask = await sys.post(`${I}/assignments`, { userId: app.idOf('tara'), roleId: app.roleId('PCMGR'), scopeType: 'COMPANY', effectiveFrom: day(2), effectiveTo: day(17), reason: 'Covers project controls for two weeks' });
  assert.equal(ask.status, 201, ask.text);
  await app.approveAll([it, dir], ask.json.data.id);
  const tara = { token: await app.login('tara') };
  const can = async () => (await app.http('GET', `${C}/formulas`, tara)).status;
  assert.equal(await can(), 403, 'not yet: ONBOARDING_RESTRICTED until the start date');
  assert.equal((await app.http('GET', `${I}/me`, tara)).json.data.lifecycle, 'ONBOARDING');
  app.clock.t = Date.parse(`${day(3)}T06:00:00.000Z`);
  tara.token = await app.login('tara');
  assert.equal(await can(), 200, 'in force');
  // the daily job moves the person out of onboarding
  const { runtimeOf } = await import('../src/server/platform/runtime/index.js');
  const jobs = runtimeOf(app.api.db).jobs;
  await jobs.enqueue('iam.assignment_sync', {});
  await jobs.drain();
  assert.equal(app.api.db.prepare("SELECT lifecycle FROM iam_user_profiles WHERE user_id = ?").get(app.idOf('tara')).lifecycle, 'ACTIVE');
  app.clock.t = Date.parse(`${day(18)}T06:00:00.000Z`);
  tara.token = await app.login('tara');
  assert.equal(await can(), 403, 'ended');
  await jobs.enqueue('iam.assignment_sync', {});
  await jobs.drain();
  assert.equal(app.api.db.prepare("SELECT lifecycle FROM iam_user_profiles WHERE user_id = ?").get(app.idOf('tara')).lifecycle, 'ONBOARDING');
  // bad inputs
  await sys.relogin();
  const bad = (body) => sys.post(`${I}/assignments`, { userId: app.idOf('tara'), roleId: app.roleId('PM'), reason: 'A request that cannot be right', ...body });
  assert.equal((await bad({ scopeType: 'PROJECT', scopeIds: [] })).status, 400, 'a project scope names a project');
  assert.equal((await bad({ scopeType: 'PROJECT', scopeIds: [999] })).status, 400, 'that exists');
  assert.equal((await bad({ scopeType: 'COMPANY', scopeIds: [1] })).status, 400);
  assert.equal((await bad({ effectiveFrom: '2026-12-10', effectiveTo: '2026-12-01' })).status, 400);
  assert.equal((await bad({ effectiveTo: '2026-01-01' })).status, 400, 'already past');
  assert.equal((await sys.post(`${I}/assignments`, { userId: 999, roleId: app.roleId('PM'), reason: 'No such person at all' })).status, 404);
  await app.close();
});

test('FR-08 a manager sees the records of the people in the departments they head, when the entity and the parameter allow it', async () => {
  const api = await startApi();
  const authz = authzOf(api.db);
  hierarchyRegistry.register('test_doc');
  const org = createOrgService({ db: api.db, approvals: null, clock: () => Date.now() });
  const hrActor = { user: 'h', roles: ['HRMGR'], companyId: 1 };
  const head = Number(api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (1, 'head', 'Head', '[]')").run().lastInsertRowid);
  const staff = Number(api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (1, 'staff', 'Staff', '[]')").run().lastInsertRowid);
  const other = Number(api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (1, 'other', 'Other', '[]')").run().lastInsertRowid);
  const dept = org.create(hrActor, 'departments', { code: 'ENG', name: 'Engineering', kind: 'DEPARTMENT', headUserId: head }, {});
  const sub = org.create(hrActor, 'departments', { code: 'QA', name: 'Quality', kind: 'DEPARTMENT', parentId: dept.id }, {});
  for (const [u, d] of [[head, dept.id], [staff, sub.id], [other, null]]) api.db.prepare("INSERT INTO iam_user_profiles (company_id, user_id, lifecycle, department_id) VALUES (1, ?, 'ACTIVE', ?)").run(u, d);
  const role = Number(api.db.prepare("INSERT INTO iam_roles (company_id, code, name, kind, category, is_system, status, created_by) VALUES (1, 'OWNREAD', 'Own records', 'CUSTOM', 'CUSTOM', 0, 'ACTIVE', 't')").run().lastInsertRowid);
  api.db.prepare("INSERT INTO iam_role_permissions (role_id, perm_key, effect) VALUES (?, 'core.sample.use', 'allow')").run(role);
  api.db.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by) VALUES (1, ?, ?, 'OWN', '[]', 'ACTIVE', 't')").run(head, role);
  authz.invalidate();
  const actor = { user: 'head', userId: head, roles: [], companyId: 1 };
  const filter = authz.scopeFilter(actor, 'core.sample.use', { owner: 't.owner_id' }, 'test_doc');
  assert.match(filter.sql, new RegExp(`t.owner_id = ${head}`));
  assert.match(filter.sql, new RegExp(`t.owner_id IN \\(${staff}\\)`), 'the person in a sub-department is a reportee; the one in no department is not');
  assert.ok(!filter.sql.includes(String(other)));
  const own = authz.check(actor, 'core.sample.use', { companyId: 1, ownerUserId: head });
  assert.equal(own.allowed, true);
  assert.equal(authz.check(actor, 'core.sample.use', { companyId: 1, ownerUserId: staff, entity: 'test_doc' }).allowed, true, 'a reportee');
  assert.equal(authz.check(actor, 'core.sample.use', { companyId: 1, ownerUserId: other, entity: 'test_doc' }).allowed, false);
  assert.equal(authz.check(actor, 'core.sample.use', { companyId: 1, ownerUserId: staff }).allowed, false, 'an entity that has not opted in');
  // switched off for the company with the parameter
  api.db.prepare("INSERT INTO core_parameters (company_id, key, value, data_type, scope_type, scope_id, effective_from, created_by, source_type) VALUES (1, 'iam.hierarchy.reportees_test_doc', 'false', 'boolean', 'company', 1, '2020-01-01', 't', 'test')").run();
  authz.invalidate();
  assert.equal(authz.check(actor, 'core.sample.use', { companyId: 1, ownerUserId: staff, entity: 'test_doc' }).allowed, false, 'the parameter turned it off');
  assert.ok(!authz.scopeFilter(actor, 'core.sample.use', { owner: 't.owner_id' }, 'test_doc').sql.includes(`IN (${staff})`));
  await api.close();
});

test('the permission list, the maskable fields and the onboarding gate still hold for a person with only a scoped assignment', async () => {
  const app = await boot();
  const sys = await app.as('sysadmin', ['SYSADM']);
  const pm = await app.as('pooja', ['PM']);
  const perms = (await sys.get(`${I}/permissions`)).json.data;
  assert.ok(perms.length > 50);
  assert.ok(perms.find((p) => p.key === 'iam.user.manage' && p.sensitive && p.module === 'iam' && p.entity === 'user' && p.action === 'manage'));
  assert.ok(perms.find((p) => p.key === 'org.view' && p.roles >= 20));
  const fields = (await sys.get(`${I}/mask-fields`)).json.data;
  assert.ok(fields.find((f) => f.entity === 'employee' && f.field === 'salary' && f.defaultRule === 'hide'));
  assert.equal((await pm.get(`${I}/permissions`)).status, 403);
  assert.equal((await pm.get(`${I}/me/access`)).status, 200, 'everyone reads their own access');
  assert.equal((await app.http('GET', `${I}/me/access`)).status, 401);
  await app.close();
});
