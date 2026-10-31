import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import '../src/server/modules/registry.js';
import { createLogger } from '../src/server/platform/http/logger.js';
import { identityOf } from '../src/server/platform/identity/index.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { createOrgService } from '../src/server/modules/iam/org/service.js';
import { createUserStore } from '../src/server/modules/iam/users.js';
import { parseCsv, parseImportCsv } from '../src/server/modules/iam/usermgmt/import.js';
import { normaliseEmail, normaliseMobile } from '../src/server/modules/iam/usermgmt/validators.js';
import { startApi } from './helpers.js';

const I = '/api/v1/iam';
const C = '/api/v1/core';
const PW = 'Tr0ub4dor&3-Excavator';
const GOOD = 'Culvert-Pour-47-Slab';
const WEAK = 'password123'; // on the common-password list
const idem = () => ({ 'idempotency-key': `u-${Math.random().toString(36).slice(2, 12)}` });
const quiet = () => createLogger({ write: () => {} });

/** An application in AUTH_MODE=iam with a clock, a cheap password hash, a sandbox email connector and MFA switched off (the sign-in tests cover MFA). */
async function boot(extra = {}) {
  const clock = { t: Date.parse('2026-10-30T10:00:00.000Z') };
  const api = await startApi({ AUTH_MODE: 'iam' }, { logger: quiet(), identityOptions: { passwordCost: { memory: 8, passes: 1 }, now: () => clock.t }, ...extra });
  const identity = identityOf(api.db);
  const store = createUserStore({ db: api.db, identity });
  api.db.prepare("INSERT INTO core_connectors (company_id, code, name, type, provider, environment, config_json, status, created_by) VALUES (1, 'mail.main', 'Mail', 'email', 'sandbox', 'development', '{\"fromAddress\":\"noreply@example.com\"}', 'ENABLED', 'test')").run();
  api.db.prepare("INSERT INTO iam_auth_policy (company_id, settings_json, created_by, source_type) VALUES (1, ?, 'test', 'seed')").run(JSON.stringify({ mfa: { enforced: false } }));
  const orgService = createOrgService({ db: api.db, approvals: null, clock: () => clock.t });
  const http = async (method, path, { token, body, headers = {}, raw } = {}) => {
    const res = await fetch(api.base + path, {
      method, headers: { ...(raw ? {} : { 'content-type': 'application/json' }), 'x-token-delivery': 'body', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, json, text, headers: res.headers };
  };
  const mk = (username, roles, over = {}) => store.create({ companyId: 1, username, email: `${username}@example.com`, displayName: `${username} Kumar`, roles, password: PW, ...over });
  const login = async (username, password = PW) => {
    const r = await http('POST', `${I}/auth/login`, { body: { username, password, deviceId: 'device-aaaaaaaa', deviceName: 'Laptop' } });
    return r.json?.data?.accessToken ?? null;
  };
  /** A signed-in person with helpers that carry their token and a fresh idempotency key. */
  const as = async (username, roles) => {
    await mk(username, roles);
    const token = await login(username);
    assert.ok(token, `${username} signs in`);
    const me = { token, username, get: (p) => http('GET', p, { token: me.token }), post: (p, body = {}, h = {}) => http('POST', p, { token: me.token, body, headers: { ...idem(), ...h } }), patch: (p, body) => http('PATCH', p, { token: me.token, body }), del: (p) => http('DELETE', p, { token: me.token }), relogin: async () => { me.token = await login(username); return me; } };
    return me;
  };
  const decide = (who, id, action = 'approve') => who.post(`${C}/change-requests/${id}/act`, { action, comment: 'checked and fine' });
  return { api, clock, identity, store, orgService, http, mk, login, as, decide, close: () => api.close() };
}

const person = (over = {}) => ({ displayName: 'Anil Verma', email: 'anil.verma@example.com', mobile: '98765 43210', ...over });

test('AC-01 invite, activate, ask for a role, approve, and the person has access', async () => {
  const app = await boot();
  const hr = await app.as('hema', ['HRMGR']);
  const sys = await app.as('sysadmin', ['SYSADM']);

  const created = await hr.post(`${I}/users`, { ...person(), invite: true });
  assert.equal(created.status, 201, created.text);
  const u = created.json.data;
  assert.equal(u.status, 'INVITED');
  assert.equal(u.username, 'anil.verma');
  assert.equal(u.mobile, '+919876543210', 'the mobile number is stored in one format');
  assert.equal(u.inviteResult.delivered, true);
  assert.equal(u.inviteResult.invitation.channel, 'email');
  const token = /token=([\w-]+)/.exec(u.inviteResult.devLink)[1];
  assert.equal(u.inviteResult.invitation.sentTo, 'anil.verma@example.com');

  assert.equal(await app.login('anil.verma', GOOD), null, 'an invited person cannot sign in before accepting');
  assert.equal((await app.http('GET', `${I}/invitations/${token}`)).json.data.displayName, 'Anil Verma');

  const weak = await app.http('POST', `${I}/invitations/${token}/accept`, { body: { password: WEAK } });
  assert.equal(weak.status, 422, 'the password policy applies');
  const accepted = await app.http('POST', `${I}/invitations/${token}/accept`, { body: { password: GOOD } });
  assert.equal(accepted.status, 200, accepted.text);
  assert.equal(accepted.json.data.status, 'ONBOARDING', 'no role yet');
  assert.equal((await app.http('POST', `${I}/invitations/${token}/accept`, { body: { password: GOOD } })).status, 410, 'a link works once');
  assert.equal((await app.http('GET', `${I}/invitations/${token}`)).status, 410);

  // AC-02: restricted onboarding state
  const anil = { token: await app.login('anil.verma', GOOD) };
  assert.ok(anil.token);
  const me = await app.http('GET', `${I}/me`, anil);
  assert.equal(me.json.data.onboarding, true);
  assert.equal(me.json.data.lifecycle, 'ONBOARDING');
  assert.equal((await app.http('GET', `${C}/session`, anil)).json.data.roles.length, 0);
  assert.equal((await app.http('GET', `${I}/org/projects`, anil)).json.error.code, 'ONBOARDING_RESTRICTED');

  const asked = await hr.post(`${I}/users/${u.id}/role-requests`, { roles: ['PM'], reason: 'Joins the Pune site team' });
  assert.equal(asked.status, 201, asked.text);
  assert.deepEqual(asked.json.data.chain, ['SYSADM']);
  assert.equal((await app.http('GET', `${I}/org/projects`, anil)).status, 403, 'asking is not granting');
  assert.equal((await app.decide(hr, asked.json.data.id)).status, 403, 'the requester cannot decide');
  const done = await app.decide(sys, asked.json.data.id);
  assert.equal(done.status, 200, done.text);

  // the same token now carries the new role: nothing to refresh
  assert.equal((await app.http('GET', `${I}/org/projects`, anil)).status, 200);
  const after = (await hr.get(`${I}/users/${u.id}`)).json.data;
  assert.equal(after.status, 'ACTIVE');
  assert.deepEqual(after.roles, ['PM']);
  assert.equal(after.grants[0].role, 'PM');
  assert.equal(after.grants[0].action, 'GRANTED');
  assert.equal(after.requests.length, 1);
  await app.close();
});

test('T-01 a user without an approved role gets 403 on every module API, and keeps only the profile', async () => {
  const app = await boot();
  await app.mk('newbie', []);
  const tok = { token: await app.login('newbie') };
  assert.ok(tok.token);
  const closed = [
    `${C}/feature-flags`, `${C}/company-settings`, `${C}/number-series`, `${C}/change-requests`, `${C}/events`, `${C}/jobs`, `${C}/connectors`, `${C}/calc/formulas`, `${C}/health/overview`,
    `${I}/org/projects`, `${I}/org/context`, `${I}/org/tree`, `${I}/org/departments`, `${I}/users`, `${I}/admin/users`, `${I}/admin/sessions`, `${I}/admin/policy`, `${I}/admin/login-events`,
  ];
  for (const p of closed) {
    const r = await app.http('GET', p, tok);
    assert.equal(r.status, 403, `${p} -> ${r.status}`);
    assert.equal(r.json.error.code, 'ONBOARDING_RESTRICTED', p);
  }
  for (const p of [`${I}/org/projects`, `${I}/users`]) assert.equal((await app.http('POST', p, { ...tok, body: {}, headers: idem() })).status, 403, `POST ${p}`);
  for (const p of [`${I}/me`, `${I}/me/sessions`, `${I}/me/devices`, `${C}/session`, `${C}/feature-flags/evaluate?keys=ff.iam.p0203`]) assert.equal((await app.http('GET', p, tok)).status, 200, `${p} stays open`);
  const patched = await app.http('PATCH', `${I}/me`, { ...tok, body: { language: 'hi', version: (await app.http('GET', `${I}/me`, tok)).json.data.version } });
  assert.equal(patched.status, 200, patched.text);
  await app.close();
});

test('T-02 suspending or deactivating ends every session at once', async () => {
  const app = await boot();
  const hr = await app.as('hema', ['HRMGR']);
  const it = await app.as('indu', ['ITADM']);
  const target = await app.as('pooja', ['PM']);
  const other = { token: await app.login('pooja') };
  const id = (await hr.get(`${I}/users?q=pooja`)).json.data[0].id;
  assert.equal((await app.http('GET', `${I}/org/projects`, other)).status, 200);

  assert.equal((await it.post(`${I}/users`, person())).status, 403, 'ITADM may view and suspend, not create');
  assert.equal((await it.get(`${I}/users`)).status, 200);
  const s = await it.post(`${I}/users/${id}/suspend`, { reason: 'Left the site without notice' });
  assert.equal(s.status, 200, s.text);
  assert.equal(s.json.data.status, 'SUSPENDED');
  assert.equal((await app.http('GET', `${I}/org/projects`, other)).status, 401, 'the very next request fails');
  assert.equal((await target.get(`${I}/me`)).status, 401);
  assert.equal(await app.login('pooja'), null, 'and so does signing in');
  assert.equal((await it.post(`${I}/users/${id}/suspend`, { reason: 'Second time round' })).status, 422);

  const back = await it.post(`${I}/users/${id}/reactivate`, { reason: 'Back after review' });
  assert.equal(back.status, 200, back.text);
  assert.equal(back.json.data.status, 'ACTIVE', 'a suspended person keeps their role');
  assert.ok(await app.login('pooja'));

  const dead = await hr.post(`${I}/users/${id}/deactivate`, { reason: 'Resigned from the company' });
  assert.equal(dead.status, 200, dead.text);
  assert.equal(dead.json.data.status, 'DEACTIVATED');
  assert.deepEqual(dead.json.data.roles, [], 'the roles are taken away');
  assert.equal(await app.login('pooja'), null);
  assert.equal((await it.post(`${I}/users/${id}/reactivate`, { reason: 'Rehired by HR' })).status, 403, 'only user managers bring back a deactivated person');
  const re = await hr.post(`${I}/users/${id}/reactivate`, { reason: 'Rehired by HR' });
  assert.equal(re.json.data.status, 'ONBOARDING', 'back with a password but no role: access needs a new approval');
  assert.ok(await app.login('pooja'), 'the old password still works');
  assert.equal((await app.http('GET', `${I}/org/projects`, { token: await app.login('pooja') })).status, 403);
  const events = app.api.db.prepare("SELECT event_type FROM core_outbox WHERE event_type LIKE 'iam.user.%' ORDER BY id").all().map((e) => e.event_type);
  for (const t of ['iam.user.suspended', 'iam.user.reactivated', 'iam.user.deactivated']) assert.ok(events.includes(t), t);
  await app.close();
});

test('the last system administrator and one\'s own account are protected', async () => {
  const app = await boot();
  const sys = await app.as('sysadmin', ['SYSADM']);
  const id = (await sys.get(`${I}/users?q=sysadmin`)).json.data[0].id;
  assert.match((await sys.post(`${I}/users/${id}/suspend`, { reason: 'Testing the guard' })).json.error.message, /own account/);
  assert.match((await sys.post(`${I}/users/${id}/deactivate`, { reason: 'Testing the guard' })).json.error.message, /own account/);
  await app.mk('second-admin', ['SYSADM']);
  const other = (await sys.get(`${I}/users?q=second-admin`)).json.data[0].id;
  assert.equal((await sys.post(`${I}/users/${other}/suspend`, { reason: 'Second one can go' })).status, 200, 'one admin is left, so the other may be suspended');
  const hr = await app.as('hema', ['HRMGR']);
  assert.match((await hr.post(`${I}/users/${id}/suspend`, { reason: 'Nobody would be left' })).json.error.message, /only active system administrator/);
  assert.match((await hr.post(`${I}/users/${id}/roles/revoke`, { roles: ['SYSADM'], reason: 'Nobody would be left' })).json.error.message, /only active system administrator/);
  await app.close();
});

test('AC-02 deactivation needs the pending work handed over, and BR-02 lists what blocks it', async () => {
  const app = await boot();
  const hr = await app.as('hema', ['HRMGR']);
  const hr2 = await app.as('hari', ['HRMGR']);
  const sys = await app.as('sysadmin', ['SYSADM']);
  await app.as('indu', ['ITADM']);
  const ids = (n) => Number(app.api.db.prepare('SELECT id FROM iam_users WHERE username = ?').get(n).id);
  const actor = { user: 'hema', roles: ['HRMGR'], companyId: 1 };
  const dept = app.orgService.create(actor, 'departments', { code: 'ENG', name: 'Engineering', kind: 'DEPARTMENT' }, {});
  app.orgService.assign(actor, 'departments', dept.id, { userId: ids('hari'), effectiveFrom: '2026-10-01', reason: 'Appointed head' }, {});
  const open = await hr2.post(`${I}/users/${ids('indu')}/role-requests`, { roles: ['PCMGR'], reason: 'Needs project control access' });
  assert.equal(open.status, 201, open.text);

  const check = (await hr.get(`${I}/users/${ids('hari')}/deactivation-check`)).json.data;
  assert.equal(check.canDeactivate, false);
  assert.equal(check.successorNeeded, true);
  assert.deepEqual(check.blockers.map((b) => b.type).sort(), ['approval requests raised by this person', 'organisation roles (department head, project manager, site in-charge)']);

  const refused = await hr.post(`${I}/users/${ids('hari')}/deactivate`, { reason: 'Resigned from the company' });
  assert.equal(refused.status, 422);
  assert.match(refused.json.error.message, /approval requests raised/);
  assert.match(refused.json.error.message, /Choose a person to take them over/);
  assert.equal((await hr.post(`${I}/users/${ids('hari')}/deactivate`, { reason: 'Resigned from the company', successorId: ids('indu') })).status, 400, 'the successor must be an active person who can take over a role request');
  // hema takes over: hema was not involved in the request
  const done = await hr.post(`${I}/users/${ids('hari')}/deactivate`, { reason: 'Resigned from the company', successorId: ids('hema') });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.json.data.handedOver.requests, 1);
  assert.equal(done.json.data.handedOver.organisationRoles, 1);
  assert.equal(done.json.data.handedOver.successor, 'hema');
  assert.equal(app.api.db.prepare('SELECT requested_by FROM core_change_requests WHERE id = ?').get(open.json.data.id).requested_by, 'hema');
  assert.equal(app.api.db.prepare('SELECT head_user_id FROM org_departments WHERE id = ?').get(dept.id).head_user_id, ids('hema'));
  assert.equal((await hr2.get(`${I}/me`)).status, 401, 'the session of the deactivated person ended');
  assert.equal((await sys.get(`${I}/users/${ids('hari')}/timeline`)).json.data[0].action, 'deactivate');
  // the request is still decided properly: hema is now the requester, so hema cannot approve it, SYSADM steps in
  assert.equal((await app.decide(hr, open.json.data.id)).status, 403);
  assert.equal((await app.decide(sys, open.json.data.id)).status, 200);

  await app.close();
});

test('BR-02 an approval step that only one person can decide blocks their deactivation until another holds the role', async () => {
  const app = await boot();
  const hr = await app.as('hema', ['HRMGR']);
  const sys = await app.as('sysadmin', ['SYSADM']);
  await app.as('indu', ['ITADM']);
  await app.mk('raj', []);
  const id = (n) => Number(app.api.db.prepare('SELECT id FROM iam_users WHERE username = ?').get(n).id);
  const asked = await hr.post(`${I}/users/${id('raj')}/role-requests`, { roles: ['SYSADM'], reason: 'Takes over administration' });
  assert.equal((await app.decide(sys, asked.json.data.id)).status, 200, 'step one done; step two waits for an ITADM');
  const check = (await hr.get(`${I}/users/${id('indu')}/deactivation-check`)).json.data;
  assert.deepEqual(check.blockers.map((b) => [b.type, b.reassignable]), [['approval steps only this person can decide', false]]);
  assert.equal(check.successorNeeded, false);
  const refused = await hr.post(`${I}/users/${id('indu')}/deactivate`, { reason: 'Moved to another company', successorId: id('hema') });
  assert.equal(refused.status, 422);
  assert.match(refused.json.error.message, /Give the role to another person first/);
  await app.mk('ina', ['ITADM']);
  const free = await hr.post(`${I}/users/${id('indu')}/deactivate`, { reason: 'Moved to another company' });
  assert.equal(free.status, 200, free.text);
  await app.close();
});

test('a privileged role needs two approvals by other people, and the chain depends on who asks', async () => {
  const app = await boot();
  const hr = await app.as('hema', ['HRMGR']);
  const sys = await app.as('sysadmin', ['SYSADM']);
  const it = await app.as('indu', ['ITADM']);
  const dir = await app.as('dina', ['DIR']);
  await app.mk('raj', []);
  const raj = Number(app.api.db.prepare("SELECT id FROM iam_users WHERE username = 'raj'").get().id);
  assert.equal((await hr.post(`${I}/users/${raj}/role-requests`, { roles: ['NOSUCHROLE'], reason: 'Nothing like it exists' })).status, 400);
  const asked = await hr.post(`${I}/users/${raj}/role-requests`, { roles: ['SYSADM'], reason: 'Takes over administration' });
  assert.deepEqual(asked.json.data.chain, ['SYSADM', 'ITADM']);
  assert.equal((await hr.post(`${I}/users/${raj}/role-requests`, { roles: ['PM'], reason: 'A second request at once' })).status, 409, 'one open request per person');
  assert.equal((await app.decide(it, asked.json.data.id)).status, 403, 'step one needs a system administrator');
  assert.equal((await app.decide(sys, asked.json.data.id)).status, 200);
  assert.equal(JSON.parse(app.api.db.prepare('SELECT roles_json FROM iam_users WHERE id = ?').get(raj).roles_json).length, 0, 'not yet');
  assert.equal((await app.decide(it, asked.json.data.id)).status, 200);
  assert.deepEqual(JSON.parse(app.api.db.prepare('SELECT roles_json FROM iam_users WHERE id = ?').get(raj).roles_json), ['SYSADM']);
  // a system administrator who asks is not their own approver: the chain moves to the IT administrator and a director
  await app.mk('sam', []);
  const sam = Number(app.api.db.prepare("SELECT id FROM iam_users WHERE username = 'sam'").get().id);
  const byAdmin = await sys.post(`${I}/users/${sam}/role-requests`, { roles: ['CFO'], reason: 'Finance lead joins' });
  assert.deepEqual(byAdmin.json.data.chain, ['ITADM', 'DIR']);
  assert.equal((await app.decide(it, byAdmin.json.data.id)).status, 200);
  assert.equal((await app.decide(it, byAdmin.json.data.id)).status, 403, 'the same person cannot decide two steps');
  assert.equal((await app.decide(dir, byAdmin.json.data.id)).status, 200);
  // taking a role away is direct, audited, and puts a person with no role back into onboarding
  const gone = await hr.post(`${I}/users/${sam}/roles/revoke`, { roles: ['CFO'], reason: 'Moved to another company' });
  assert.equal(gone.status, 200, gone.text);
  assert.equal(gone.json.data.status, 'ONBOARDING');
  assert.deepEqual(gone.json.data.grants.map((g) => g.action), ['REVOKED', 'GRANTED']);
  await app.close();
});

test('FR-07 duplicates by email, mobile, username and employee link are refused with who already has the account', async () => {
  const app = await boot();
  const hr = await app.as('hema', ['HRMGR']);
  const first = (await hr.post(`${I}/users`, person({ employeeCode: 'E-1001' }))).json.data;
  const again = await hr.post(`${I}/users`, person({ displayName: 'Anil V', email: 'ANIL.VERMA@example.com' }));
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, 'DUPLICATE_USER');
  assert.ok(again.json.error.details.some((d) => d.field === 'email' && /Anil Verma/.test(d.message)));
  const mobile = await hr.post(`${I}/users`, person({ email: 'other@example.com', mobile: '09876543210' }));
  assert.equal(mobile.status, 409, 'the same number written another way');
  assert.ok(mobile.json.error.details.some((d) => d.field === 'mobile'));
  const emp = await hr.post(`${I}/users`, person({ email: 'third@example.com', mobile: '9123456780', employeeCode: 'E-1001' }));
  assert.equal(emp.status, 409);
  assert.ok(emp.json.error.details.some((d) => d.field === 'employeeCode'));
  const live = (await hr.get(`${I}/users/duplicates?email=anil.verma@example.com&mobile=%2B919876543210`)).json.data;
  assert.deepEqual(live.map((d) => d.field).sort(), ['email', 'mobile']);
  assert.equal((await hr.get(`${I}/users/duplicates?email=anil.verma@example.com&excludeId=${first.id}`)).json.data.length, 0, 'editing a person does not clash with themselves');

  // a deactivated person keeps the account: the duplicate says so
  await hr.post(`${I}/users/${first.id}/deactivate`, { reason: 'Resigned from the company' });
  const rehire = await hr.post(`${I}/users`, person());
  assert.equal(rehire.status, 409);
  assert.match(rehire.json.error.message, /reactivate/);
  // another company's account is refused without saying whose
  app.api.db.prepare("INSERT INTO iam_users (company_id, username, email, display_name, roles_json) VALUES (2, 'outsider', 'outside@example.com', 'Outsider', '[]')").run();
  const cross = await hr.post(`${I}/users`, person({ email: 'outside@example.com', mobile: '9000000001' }));
  assert.equal(cross.status, 409);
  assert.equal(cross.json.error.details[0].userId, null);
  assert.doesNotMatch(JSON.stringify(cross.json), /Outsider|outsider/);
  await app.close();
});

test('FR-01 validation, links to the organisation, editing and optimistic locking', async () => {
  const app = await boot();
  const hr = await app.as('hema', ['HRMGR']);
  const actor = { user: 'hema', roles: ['HRMGR'], companyId: 1 };
  const dept = app.orgService.create(actor, 'departments', { code: 'ENG', name: 'Engineering', kind: 'DEPARTMENT' }, {});
  assert.equal((await hr.post(`${I}/users`, { displayName: 'No contact' })).status, 400);
  assert.equal((await hr.post(`${I}/users`, person({ mobile: '12345' }))).status, 400);
  assert.equal((await hr.post(`${I}/users`, person({ departmentId: 999 }))).status, 400, 'the department must exist');
  assert.equal((await hr.post(`${I}/users`, person({ userType: 'ROBOT' }))).status, 400);
  const key = idem();
  const made = await hr.post(`${I}/users`, person({ departmentId: dept.id, language: 'hi' }), key);
  assert.equal(made.status, 201, made.text);
  const replay = await hr.post(`${I}/users`, person({ departmentId: dept.id, language: 'hi' }), key);
  assert.equal(replay.status, 201);
  assert.equal(app.api.db.prepare("SELECT COUNT(*) AS n FROM iam_users WHERE email = 'anil.verma@example.com'").get().n, 1, 'a replayed request creates one user');
  const u = made.json.data;
  assert.equal(u.departmentName, 'Engineering');
  assert.equal(u.language, 'hi');

  const patched = await hr.patch(`${I}/users/${u.id}`, { displayName: 'Anil K Verma', employeeCode: 'E-2002', version: u.version });
  assert.equal(patched.status, 200, patched.text);
  assert.equal(patched.json.data.employeeCode, 'E-2002');
  assert.equal((await hr.patch(`${I}/users/${u.id}`, { displayName: 'Stale', version: u.version })).status, 409, 'a stale version is refused');
  assert.equal((await hr.patch(`${I}/users/${u.id}`, { displayName: 'Anil K Verma', version: patched.json.data.version })).status, 422, 'nothing changed');
  assert.equal((await hr.patch(`${I}/users/${u.id}`, { email: null, mobile: null, version: patched.json.data.version })).status, 400, 'a person keeps a way to be reached');
  assert.equal((await hr.patch(`${I}/users/${u.id}`, { nonsense: 1, version: 1 })).status, 400);
  const log = (await hr.get(`${I}/users/${u.id}/timeline`)).json.data;
  assert.deepEqual(log.map((l) => l.action), ['update', 'create']);
  assert.equal(log[0].before.displayName, 'Anil Verma');
  assert.equal(log[0].after.displayName, 'Anil K Verma');
  await app.close();
});

test('FR-02 invitations: resend replaces the link, pauses between sends, expires, and can be withdrawn', async () => {
  const app = await boot();
  const hr = await app.as('hema', ['HRMGR']);
  const u = (await hr.post(`${I}/users`, person())).json.data;
  const t1 = /token=([\w-]+)/.exec((await hr.post(`${I}/users/${u.id}/invite`, {})).json.data.devLink)[1];
  assert.equal((await hr.post(`${I}/users/${u.id}/invite`, {})).status, 429, 'not twice in half a minute');
  app.clock.t += 60_000;
  const secondRes = await hr.post(`${I}/users/${u.id}/invite`, { channel: 'email' });
  assert.equal(secondRes.status, 200, secondRes.text);
  const second = secondRes.json.data;
  assert.equal(second.invitation.resendCount, 1);
  const t2 = /token=([\w-]+)/.exec(second.devLink)[1];
  assert.equal((await app.http('GET', `${I}/invitations/${t1}`)).status, 410, 'the old link stopped working');
  assert.equal((await app.http('GET', `${I}/invitations/${t2}`)).status, 200);
  assert.equal((await hr.post(`${I}/users/${u.id}/invite`, { channel: 'sms' })).status, 429);
  app.clock.t += 60_000;
  const smsRes = await hr.post(`${I}/users/${u.id}/invite`, { channel: 'sms' });
  assert.equal(smsRes.status, 200, smsRes.text);
  assert.equal(smsRes.json.data.invitation.channel, 'sms', 'the mobile number is used for text messages');

  // withdrawn
  assert.equal((await hr.del(`${I}/users/${u.id}/invitation`)).status, 200);
  assert.equal((await hr.del(`${I}/users/${u.id}/invitation`)).status, 422);
  // expiry (7 days) and the daily job
  app.clock.t += 60_000;
  const t3 = /token=([\w-]+)/.exec((await hr.post(`${I}/users/${u.id}/invite`, {})).json.data.devLink)[1];
  app.clock.t += 8 * 86_400_000;
  await hr.relogin();
  const gone = await app.http('GET', `${I}/invitations/${t3}`);
  assert.equal(gone.status, 410);
  assert.equal(gone.json.error.code, 'INVITATION_EXPIRED');
  assert.equal((await app.http('POST', `${I}/invitations/${t3}/accept`, { body: { password: GOOD } })).status, 410);
  assert.equal((await hr.get(`${I}/users/${u.id}`)).json.data.invitation.status, 'EXPIRED');
  assert.equal(app.api.db.prepare("SELECT status FROM iam_invitations WHERE token_hash IS NOT NULL ORDER BY id DESC LIMIT 1").get().status, 'EXPIRED', 'marked when the link was used');
  assert.equal((await hr.post(`${I}/users/${u.id}/invite`, {})).status, 200, 'an expired invitation can be replaced');
  // a person who is not Invited, or has no address for the channel, is refused clearly
  const noMobile = (await hr.post(`${I}/users`, { displayName: 'Mail Only', email: 'mailonly@example.com' })).json.data;
  assert.equal((await hr.post(`${I}/users/${noMobile.id}/invite`, { channel: 'sms' })).status, 400);
  await app.mk('regular', ['PM']);
  assert.equal((await hr.post(`${I}/users/${Number(app.api.db.prepare("SELECT id FROM iam_users WHERE username = 'regular'").get().id)}/invite`, {})).status, 422);
  const svc = (await hr.post(`${I}/users`, person({ displayName: 'Bot', email: 'bot@example.com', mobile: '9111111111', userType: 'SERVICE_ACCOUNT' }))).json.data;
  assert.equal((await hr.post(`${I}/users/${svc.id}/invite`, {})).status, 422, 'service accounts are not invited');
  await app.close();
});

test('T-03 a bulk import rejects duplicates and bad rows with row-level errors, and imports nothing unless asked to skip them', async () => {
  const app = await boot();
  const hr = await app.as('hema', ['HRMGR']);
  const actor = { user: 'hema', roles: ['HRMGR'], companyId: 1 };
  app.orgService.create(actor, 'departments', { code: 'ENG', name: 'Engineering', kind: 'DEPARTMENT' }, {});
  await hr.post(`${I}/users`, { displayName: 'Existing Person', email: 'existing@example.com', mobile: '9000000009' });
  const csv = [
    'name,email,mobile,language,userType,employeeCode,department',
    'Good One,good.one@example.com,9811111111,en,INTERNAL,E-1,ENG',
    'Good Two,good.two@example.com,9822222222,hi,,E-2,',
    'Same Email Twice,good.one@example.com,9833333333,,,,',
    'Already There,existing@example.com,9844444444,,,,',
    'Mobile Used,someone@example.com,+91 90000 00009,,,,',
    'Bad Mobile,badmobile@example.com,12345,,,,',
    'Bad Department,baddept@example.com,9855555555,,,,NOPE',
    ',nameless@example.com,9866666666,,,,',
    '"Quoted, Name",quoted@example.com,9877777777,en,EXTERNAL_PORTAL,E-3,',
  ].join('\r\n');
  const post = (mode, extra = '') => app.http('POST', `${I}/users/import?mode=${mode}${extra}`, { token: hr.token, raw: true, body: csv, headers: { 'content-type': 'text/csv', ...idem() } });

  const before = app.api.db.prepare('SELECT COUNT(*) AS n FROM iam_users').get().n;
  const preview = await post('validate');
  assert.equal(preview.status, 200, preview.text);
  const d = preview.json.data;
  assert.equal(d.total, 9);
  assert.equal(d.valid, 3);
  const at = (row, field) => d.errors.find((e) => e.row === row && e.field === field)?.message;
  assert.match(at(4, 'email'), /appears in row 2/, 'duplicate inside the file');
  assert.match(at(5, 'email'), /already used by Existing Person/, 'duplicate of an existing account');
  assert.match(at(6, 'mobile'), /already used by Existing Person/, 'the same number written another way');
  assert.match(at(7, 'mobile'), /valid mobile/);
  assert.match(at(8, 'department'), /No active department/);
  assert.match(at(9, 'displayName'), /required/);
  assert.equal(app.api.db.prepare('SELECT COUNT(*) AS n FROM iam_users').get().n, before, 'a preview writes nothing');

  const rejected = await post('commit');
  assert.equal(rejected.status, 422);
  assert.ok(rejected.json.error.details.some((e) => e.field === 'row 5: email'), 'the response names the row');
  assert.equal(app.api.db.prepare('SELECT COUNT(*) AS n FROM iam_users').get().n, before, 'nothing is imported when any row is wrong');

  const partial = await post('commit', '&skipInvalid=true&invite=true');
  assert.equal(partial.status, 200, partial.text);
  assert.equal(partial.json.data.created, 3);
  assert.equal(partial.json.data.invited, 3);
  const list = (await hr.get(`${I}/users?filter[status]=INVITED&sort=displayName`)).json.data;
  assert.deepEqual(list.map((u) => u.displayName), ['Existing Person', 'Good One', 'Good Two', 'Quoted, Name']);
  assert.equal(list[1].departmentName, 'Engineering');
  assert.equal(list[3].userType, 'EXTERNAL_PORTAL');
  assert.equal(list[1].invitation.status, 'PENDING');
  // running it again: every row is now a duplicate
  const twice = await post('validate');
  assert.ok(twice.json.data.errors.filter((e) => /already used/.test(e.message)).length >= 6);
  assert.equal((await app.http('POST', `${I}/users/import?mode=commit`, { token: hr.token, raw: true, body: csv, headers: { 'content-type': 'text/csv' } })).status, 400, 'a commit needs an idempotency key');
  assert.equal((await app.http('POST', `${I}/users/import?mode=validate`, { token: hr.token, raw: true, body: 'foo,bar\n1,2', headers: { 'content-type': 'text/csv' } })).status, 400, 'unknown columns are named');
  assert.equal((await app.http('GET', `${I}/users/import/template`, { token: hr.token })).text.split('\n')[0], 'username,displayName,email,mobile,language,userType,employeeCode,department,project');
  const pm = await app.as('pooja', ['PM']);
  assert.equal((await app.http('POST', `${I}/users/import?mode=validate`, { token: pm.token, raw: true, body: csv, headers: { 'content-type': 'text/csv' } })).status, 403);
  await app.close();
});

test('the list filters, sorts, searches, masks and stays inside the company', async () => {
  const app = await boot();
  const hr = await app.as('hema', ['HRMGR']);
  const it = await app.as('indu', ['ITADM']);
  const actor = { user: 'hema', roles: ['HRMGR'], companyId: 1 };
  const eng = app.orgService.create(actor, 'departments', { code: 'ENG', name: 'Engineering', kind: 'DEPARTMENT' }, {});
  const fin = app.orgService.create(actor, 'departments', { code: 'FIN', name: 'Finance', kind: 'DEPARTMENT' }, {});
  const proj = app.orgService.create({ ...actor, roles: ['PM'] }, 'projects', { code: 'P1', name: 'Bridge', type: 'ROAD' }, {});
  for (const [i, d] of [[1, eng.id], [2, eng.id], [3, fin.id]]) await hr.post(`${I}/users`, { displayName: `Person ${i}`, email: `p${i}@example.com`, mobile: `98000000${i}0`, departmentId: d, projectId: i === 1 ? proj.id : null });
  app.api.db.prepare("INSERT INTO iam_users (company_id, username, email, display_name, roles_json) VALUES (2, 'elsewhere', 'else@example.com', 'Person Elsewhere', '[]')").run();
  const names = async (q, who = hr) => (await who.get(`${I}/users?${q}`)).json.data.map((u) => u.displayName);
  assert.deepEqual(await names(`filter[departmentId]=${eng.id}&sort=-displayName`), ['Person 2', 'Person 1']);
  assert.deepEqual(await names(`filter[projectId]=${proj.id}`), ['Person 1']);
  assert.deepEqual(await names('filter[status]=INVITED&q=person&sort=displayName'), ['Person 1', 'Person 2', 'Person 3']);
  assert.deepEqual(await names('filter[type]=SERVICE_ACCOUNT'), []);
  assert.deepEqual(await names('filter[role]=HRMGR'), ['hema Kumar']);
  assert.ok(!(await names('q=person')).includes('Person Elsewhere'), 'another company is invisible');
  const page = (await hr.get(`${I}/users?pageSize=2&page=2&sort=displayName`)).json;
  assert.equal(page.meta.total, 5);
  assert.equal(page.meta.totalPages, 3);
  assert.equal((await hr.get(`${I}/users?filter[status]=NOPE`)).status, 400);
  assert.equal((await hr.get(`${I}/users?sort=password`)).status, 400);
  assert.equal((await hr.get(`${I}/users?filter[roleX]=1`)).status, 400);
  const full = (await hr.get(`${I}/users?q=Person 1`)).json.data[0];
  const masked = (await it.get(`${I}/users?q=Person 1`)).json.data[0];
  assert.equal(full.mobile, '+919800000010');
  assert.match(masked.mobile, /^\+91•+0010$/, 'a view-only role sees the mobile number masked');
  assert.equal(masked.canManage, false);
  const elsewhere = Number(app.api.db.prepare("SELECT id FROM iam_users WHERE username = 'elsewhere'").get().id);
  for (const p of [`${I}/users/${elsewhere}`, `${I}/users/${elsewhere}/timeline`, `${I}/users/${elsewhere}/sessions`]) assert.equal((await hr.get(p)).status, 404, p);
  assert.equal((await hr.post(`${I}/users/${elsewhere}/suspend`, { reason: 'Not in this company' })).status, 404);
  assert.equal((await hr.post(`${I}/users/${elsewhere}/role-requests`, { roles: ['PM'], reason: 'Not in this company' })).status, 404);
  await app.close();
});

test('AC-04 every role sees and does exactly what it should', async () => {
  const app = await boot();
  const people = {};
  for (const [n, r] of [['sys', 'SYSADM'], ['hr', 'HRMGR'], ['it', 'ITADM'], ['pm', 'PM'], ['acc', 'ACCMGR'], ['cfo', 'CFO'], ['pd', 'PD'], ['dir', 'DIR']]) people[n] = await app.as(`u-${n}`, [r]);
  await app.as('target', ['PM']);
  const id = Number(app.api.db.prepare("SELECT id FROM iam_users WHERE username = 'target'").get().id);
  const expect = { sys: [200, 201], hr: [200, 201], it: [200, 403], pm: [403, 403], acc: [403, 403], cfo: [403, 403], pd: [403, 403], dir: [403, 403] };
  for (const [n, [read, write]] of Object.entries(expect)) {
    assert.equal((await people[n].get(`${I}/users`)).status, read, `${n} reads`);
    assert.equal((await people[n].get(`${I}/users/${id}`)).status, read, `${n} reads one`);
    assert.equal((await people[n].post(`${I}/users`, { displayName: `By ${n}`, email: `by-${n}@example.com` })).status, write, `${n} creates`);
    assert.equal((await people[n].get(`${I}/users/${id}/deactivation-check`)).status, n === 'sys' || n === 'hr' ? 200 : 403, `${n} check`);
  }
  // own profile for everybody; suspend for the three roles that hold it
  for (const n of Object.keys(people)) assert.equal((await people[n].get(`${I}/me`)).status, 200, `${n} reads their profile`);
  assert.equal((await people.pm.post(`${I}/users/${id}/suspend`, { reason: 'Not allowed for this role' })).status, 403);
  assert.equal((await people.it.post(`${I}/users/${id}/suspend`, { reason: 'Allowed for IT administrators' })).status, 200);
  assert.equal((await people.it.post(`${I}/users/${id}/deactivate`, { reason: 'Not allowed for IT here' })).status, 403);
  assert.equal((await people.it.post(`${I}/users/${id}/role-requests`, { roles: ['PM'], reason: 'Not allowed for IT here' })).status, 403);
  assert.equal((await people.pm.post(`${I}/users/bulk`, { action: 'suspend', ids: [id], reason: 'Not allowed for this role' })).status, 403);
  assert.equal((await app.http('GET', `${I}/users`)).status, 401);
  assert.equal((await app.http('PATCH', `${I}/me`, { body: { language: 'hi', version: 1 } })).status, 401);
  await app.close();
});

test('bulk invite and bulk suspend report each person separately', async () => {
  const app = await boot();
  const hr = await app.as('hema', ['HRMGR']);
  const a = (await hr.post(`${I}/users`, { displayName: 'A One', email: 'a1@example.com' })).json.data;
  const b = (await hr.post(`${I}/users`, { displayName: 'B Two', email: 'b2@example.com' })).json.data;
  await app.mk('active-one', ['PM']);
  const live = Number(app.api.db.prepare("SELECT id FROM iam_users WHERE username = 'active-one'").get().id);
  const inv = (await hr.post(`${I}/users/bulk`, { action: 'invite', ids: [a.id, b.id, live, 99999] })).json.data;
  assert.equal(inv.succeeded, 2);
  assert.equal(inv.failed, 2);
  assert.match(inv.results.find((r) => r.id === live).error, /nothing to invite/);
  assert.equal(inv.results.find((r) => r.id === 99999).code, 'NOT_FOUND');
  const sus = (await hr.post(`${I}/users/bulk`, { action: 'suspend', ids: [a.id, live], reason: 'Site closed for the monsoon' })).json.data;
  assert.equal(sus.succeeded, 1, 'only the active person can be suspended');
  assert.equal((await hr.post(`${I}/users/bulk`, { action: 'suspend', ids: [live] })).status, 400, 'a suspension needs a reason');
  assert.equal((await hr.post(`${I}/users/bulk`, { action: 'invite', ids: [] })).status, 400);
  assert.equal((await hr.post(`${I}/users/bulk`, { action: 'invite', ids: Array.from({ length: 201 }, (_, i) => i + 1) })).status, 400);
  await app.close();
});

test('FR-06 the profile: own details, preferences, a photo and a signature through the document service', async () => {
  const storage = mkdtempSync(join(tmpdir(), 'erp-prof-'));
  const app = await boot({ storagePath: storage });
  try {
    const pm = await app.as('pooja', ['PM']);
    const me0 = (await pm.get(`${I}/me`)).json.data;
    assert.equal(me0.language, 'en');
    assert.deepEqual(me0.preferences.notifications, { email: true, sms: false, whatsapp: false, inApp: true });
    const ok = await pm.patch(`${I}/me`, { displayName: 'Pooja Rao', language: 'hi', preferences: { theme: 'dark', notifications: { sms: true } }, version: me0.version });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.data.language, 'hi');
    assert.equal(ok.json.data.preferences.theme, 'dark');
    assert.equal(ok.json.data.preferences.notifications.sms, true);
    assert.equal((await pm.get(`${I}/me`)).json.data.displayName, 'Pooja Rao');
    assert.equal((await pm.patch(`${I}/me`, { language: 'en', version: me0.version })).status, 409, 'a stale profile is refused');
    assert.equal((await pm.patch(`${I}/me`, { email: 'x@example.com', version: ok.json.data.version })).status, 400, 'email and mobile are changed by an administrator, not here');
    assert.equal((await pm.patch(`${I}/me`, { language: 'fr', version: ok.json.data.version })).status, 400);
    assert.equal((await pm.patch(`${I}/me`, { photoFileId: 12345, version: ok.json.data.version })).status, 400, 'a photo must be one of your own uploads');

    const uid = Number(app.api.db.prepare("SELECT id FROM iam_users WHERE username = 'pooja'").get().id);
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#336' } }).png().toBuffer();
    const upload = async (token, name, buf = png, entityId = uid) => {
      const fd = new FormData();
      fd.append('entity', 'iam_user_profile');
      fd.append('entityId', String(entityId));
      fd.append('file', new Blob([buf]), name);
      return app.http('POST', `${C}/files`, { token, raw: true, body: fd });
    };
    const up = await upload(pm.token, 'me.png');
    assert.equal(up.status, 201, up.text);
    const early = await pm.patch(`${I}/me`, { photoFileId: up.json.data.id, version: ok.json.data.version });
    assert.equal(early.status, 409, 'still being scanned');
    await runtimeOf(app.api.db).jobs.drain();
    const set = await pm.patch(`${I}/me`, { photoFileId: up.json.data.id, signatureFileId: up.json.data.id, version: (await pm.get(`${I}/me`)).json.data.version });
    assert.equal(set.status, 200, set.text);
    assert.equal(set.json.data.photoFileId, up.json.data.id);
    const link = await pm.get(`${C}/files/${up.json.data.id}/url`);
    assert.equal(link.status, 200, 'the owner opens it through a signed link');
    // somebody else's profile is not theirs to attach to
    const other = await app.as('other', ['PM']);
    assert.notEqual((await upload(other.token, 'mine.png', png, uid)).status, 201);
    // an administrator may see a profile picture, an ordinary colleague may not
    const hr = await app.as('hema', ['HRMGR']);
    assert.equal((await hr.get(`${C}/files/${up.json.data.id}`)).status, 200);
    assert.equal((await other.get(`${C}/files/${up.json.data.id}`)).status, 403);
    const text = Buffer.from('not an image');
    const bad = await upload(pm.token, 'notes.txt', text);
    assert.equal(bad.status, 201, 'the document service accepts text');
    await runtimeOf(app.api.db).jobs.drain();
    assert.equal((await pm.patch(`${I}/me`, { photoFileId: bad.json.data.id, version: set.json.data.version })).status, 400, 'but a photo must be an image');
  } finally {
    await app.close();
    rmSync(storage, { recursive: true, force: true });
  }
});

test('the profile of someone without a profile row falls back to their sign-in status, and a migration backfill covers existing people', async () => {
  const app = await boot();
  const hr = await app.as('hema', ['HRMGR']);
  app.api.db.prepare("INSERT INTO iam_users (company_id, username, email, display_name, roles_json, status) VALUES (1, 'legacy-a', 'la@example.com', 'Legacy Active', '[\"PM\"]', 'ACTIVE')").run();
  app.api.db.prepare("INSERT INTO iam_users (company_id, username, email, display_name, roles_json, status) VALUES (1, 'legacy-b', 'lb@example.com', 'Legacy Off', '[]', 'DISABLED')").run();
  const rows = (await hr.get(`${I}/users?q=legacy&sort=username`)).json.data;
  assert.deepEqual(rows.map((r) => [r.username, r.status]), [['legacy-a', 'ACTIVE'], ['legacy-b', 'SUSPENDED']]);
  const a = rows[0];
  const edit = await hr.patch(`${I}/users/${a.id}`, { language: 'hi', version: a.version });
  assert.equal(edit.status, 200, edit.text);
  assert.equal(app.api.db.prepare('SELECT COUNT(*) AS n FROM iam_user_profiles WHERE user_id = ?').get(a.id).n, 1, 'editing creates the missing row');
  await app.close();
});

test('units: mobile and email normalising, CSV parsing, and the import file rules', () => {
  assert.equal(normaliseMobile('98765 43210'), '+919876543210');
  assert.equal(normaliseMobile('09876543210'), '+919876543210');
  assert.equal(normaliseMobile('+91-98765-43210'), '+919876543210');
  assert.equal(normaliseMobile('919876543210'), '+919876543210');
  assert.equal(normaliseMobile('+44 20 7946 0958'), '+442079460958');
  assert.equal(normaliseMobile('12345'), undefined);
  assert.equal(normaliseMobile('  '), null);
  assert.equal(normaliseEmail('  A@B.COM '), 'a@b.com');
  assert.deepEqual(parseCsv('a,b\r\n"x, y","he said ""hi"""\n\n1,2'), [['a', 'b'], ['x, y', 'he said "hi"'], [''], ['1', '2']]);
  assert.deepEqual(parseCsv('﻿a,b\n"multi\nline",2\n'), [['a', 'b'], ['multi\nline', '2']]);
  assert.throws(() => parseCsv('a,"open'), /never closed/);
  assert.throws(() => parseImportCsv(''), /empty/);
  assert.throws(() => parseImportCsv('email\nx@y.com'), /displayName/);
  assert.throws(() => parseImportCsv('name\nAnil'), /email or a mobile/);
  assert.throws(() => parseImportCsv('name,email,shoe\nAnil,a@b.com,9'), /Unknown column\(s\): shoe/);
  assert.throws(() => parseImportCsv('name,email\n'), /no people/);
  assert.throws(() => parseImportCsv(`name,email\n${Array.from({ length: 2001 }, (_, i) => `P${i},p${i}@x.com`).join('\n')}`), /at most 2000/);
  const rows = parseImportCsv('Full Name,E-mail,Phone,Type\nAnil,a@b.com,9876543210,external portal\n,,,\nBad,notmail,,').rows;
  assert.equal(rows.length, 2, 'blank lines are skipped');
  assert.equal(rows[0].data.values.userType, 'EXTERNAL_PORTAL');
  assert.equal(rows[0].row, 2);
  assert.equal(rows[1].row, 4, 'row numbers are the numbers a spreadsheet shows');
  assert.ok(rows[1].errors.some((e) => e.field === 'email'));
});

test('the daily job marks unused invitations as expired, and leaves current ones alone', async () => {
  const app = await boot();
  const hr = await app.as('hema', ['HRMGR']);
  const a = (await hr.post(`${I}/users`, { displayName: 'Old Invite', email: 'old@example.com', invite: true })).json.data;
  app.clock.t += 8 * 86_400_000;
  await hr.relogin();
  const b = (await hr.post(`${I}/users`, { displayName: 'New Invite', email: 'new@example.com', invite: true })).json.data;
  const jobs = runtimeOf(app.api.db).jobs;
  const done = await jobs.enqueue('iam.invitation_expiry', {});
  await jobs.drain();
  assert.ok(done);
  const status = (id) => app.api.db.prepare('SELECT status FROM iam_invitations WHERE user_id = ?').get(id).status;
  assert.equal(status(a.id), 'EXPIRED');
  assert.equal(status(b.id), 'PENDING');
  assert.ok(app.api.db.prepare("SELECT 1 FROM core_schedules WHERE code = 'iam.invitation_expiry_daily'").get(), 'the schedule is defined');
  await app.close();
});

test('T-01 every documented route that needs a sign-in refuses a person with no approved role, whatever its path', async () => {
  const app = await boot();
  await app.mk('newbie', []);
  const tok = { token: await app.login('newbie') };
  assert.ok(tok.token);
  const text = readFileSync(fileURLToPath(new URL('../docs/erp/openapi.yaml', import.meta.url)), 'utf8');
  const routes = [];
  let path = null;
  for (const line of text.split(/\r?\n/)) {
    const p = /^ {2}(\/\S+):\s*$/.exec(line);
    if (p) path = p[1];
    const m = /^ {4}(get|post|patch|put|delete):\s*$/.exec(line);
    if (m && path) routes.push([m[1].toUpperCase(), path.replace(/\{[^}]+\}/g, '1')]);
  }
  const open = [/^\/api\/v1\/iam\/me(\/|$)/, /^\/api\/v1\/iam\/auth\/password\/change$/, /^\/api\/v1\/core\/session$/, /^\/api\/v1\/core\/feature-flags\/evaluate$/, /^\/api\/v1\/core\/files(\/|$)/];
  let gated = 0;
  // the open routes include ones that end the caller's own session, so they are tried after the closed ones
  const ordered = [...routes].sort((x, y) => Number(open.some((re) => re.test(x[1]))) - Number(open.some((re) => re.test(y[1]))));
  for (const [method, p] of ordered) {
    if (!p.startsWith('/api/v1/') || p.startsWith('/api/v1/iam/auth/')) continue; // the sign-in routes carry their own proof
    const body = method === 'GET' || method === 'DELETE' ? undefined : {};
    const anon = await app.http(method, p, { body, headers: idem() });
    if (anon.status !== 401) continue; // reachable without signing in (the sign-in routes, signed download links, webhooks): not behind the gate
    const r = await app.http(method, p, { ...tok, body, headers: idem() });
    if (open.some((re) => re.test(p))) {
      assert.notEqual(r.json?.error?.code, 'ONBOARDING_RESTRICTED', `${method} ${p} stays open`);
    } else {
      assert.equal(r.status, 403, `${method} ${p} -> ${r.status}`);
      assert.equal(r.json.error.code, 'ONBOARDING_RESTRICTED', `${method} ${p}`);
      gated += 1;
    }
  }
  assert.ok(gated > 120, `only ${gated} routes were checked`);
  await app.close();
});
