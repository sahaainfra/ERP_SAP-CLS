import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import '../src/server/modules/registry.js';
import { createApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/platform/config/index.js';
import { migrateUp } from '../src/server/platform/db/index.js';
import { silentLogger } from '../src/server/platform/http/logger.js';
import { identityOf } from '../src/server/platform/identity/index.js';
import { authzOf, ROLE_TEMPLATES, permissionRegistry } from '../src/server/platform/authz/index.js';
import { ROUTE_POLICY } from '../src/server/platform/security/route-policy.js';
import { DEFAULT_SETTINGS, assertDeclared, buildRegistry, checkKeys, createExportGuard, createPolicy, neutralise, runRouteTests, securityOf, securitySettingsOf, toCsv } from '../src/server/platform/security/index.js';
import express from 'express';
import { z } from 'zod';
import { audit, authorise, validate } from '../src/server/platform/security/index.js';
import { errorHandler } from '../src/server/platform/http/errors.js';
import { createUserStore } from '../src/server/modules/iam/users.js';
import { startApi } from './helpers.js';

const C = '/api/v1/core';
const PW = 'Tr0ub4dor&3-Excavator'; // secret-scan:allow label text, not a credential
const WRONG = 'wrong-password-123'; // secret-scan:allow label text, not a credential
const I = '/api/v1/iam';
const AUD = { roles: 'AUD', user: 'auditor1' };
const ITADM = { roles: 'ITADM', user: 'it1' };
const SYS = { roles: 'SYSADM', user: 'sysadmin' };
const key = () => ({ 'idempotency-key': `a-${Math.random().toString(36).slice(2, 12)}`, 'content-type': 'application/json' });
const settingsWith = (patch) => ({ ...DEFAULT_SETTINGS, ...patch });

test('AC-01 FR-01 every route of the application is declared in the route policy, and the policy names no route that does not exist', async () => {
  const api = await startApi();
  const sec = securityOf(api.db);
  assert.deepEqual(sec.registry.undeclared, [], 'routes without a declaration');
  assert.deepEqual(sec.registry.stale, [], 'declarations of routes that do not exist');
  assert.ok(sec.registry.routes.length >= 270, `${sec.registry.routes.length} routes`);
  // each declaration has a guard, a rate class and, where it is a permission route, keys that exist
  const known = new Set([...permissionRegistry.list().map((p) => p.key), ...ROLE_TEMPLATES.flatMap((t) => t.permissions), ...api.db.prepare('SELECT perm_key FROM iam_permissions').all().map((p) => p.perm_key)]);
  assert.deepEqual(checkKeys(sec.registry, known), []);
  for (const r of ROUTE_POLICY) {
    assert.ok(['permission', 'self', 'record', 'public', 'infra'].includes(r.g), `${r.m} ${r.p} guard`);
    assert.ok(['auth', 'otp', 'export', 'write', 'read', 'webhook'].includes(r.rate), `${r.m} ${r.p} rate class`);
    if (r.g === 'permission') assert.ok(r.k && [r.k].flat().length > 0, `${r.m} ${r.p} names a permission`);
    if (r.m !== 'GET' && r.g !== 'infra') assert.equal(r.audit, true, `${r.m} ${r.p} is audited`);
  }
  // the snapshot is in the database
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM core_route_registry').get().n, sec.registry.routes.length);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_route_registry WHERE guard = 'public'").get().n, ROUTE_POLICY.filter((r) => r.g === 'public').length);
  await api.close();
});

test('BR-01 a route without a declaration stops a staging or production start; development only reports it', async () => {
  const built = { undeclared: ['GET /api/v1/x/new'], stale: [], routes: [] };
  assert.throws(() => assertDeclared(built, { environment: 'production' }), /Refusing to start.*GET \/api\/v1\/x\/new/);
  assert.throws(() => assertDeclared(built, { environment: 'staging' }), /Refusing to start/);
  const said = [];
  assertDeclared(built, { environment: 'development', log: (t) => said.push(t) });
  assertDeclared(built, { environment: 'test', log: (t) => said.push(t) });
  assert.equal(said.length, 2);
  assertDeclared({ undeclared: [], stale: [], routes: [] }, { environment: 'production' });
  // and for real: the application itself refuses to start when a declaration is missing
  const dir = mkdtempSync(join(tmpdir(), 'erp-sec-'));
  const env = { NODE_ENV: 'staging', DATABASE_PATH: join(dir, 'a.sqlite'), AUTH_MODE: 'iam', AUTH_SECRET: 'a'.repeat(40), FILE_URL_SECRET: 'b'.repeat(40), VAULT_KEY: 'c'.repeat(40) };
  const make = () => { const db = new DatabaseSync(env.DATABASE_PATH); db.exec('PRAGMA foreign_keys = ON;'); migrateUp(db); return createApp({ config: loadConfig(env), db, logger: silentLogger }); };
  assert.ok(make(), 'every route declared: it starts');
  const removed = ROUTE_POLICY.splice(0, 1);
  try {
    assert.throws(() => make(), /Refusing to start: 1 route\(s\) are not in the route policy/);
  } finally {
    ROUTE_POLICY.unshift(...removed);
  }
});

test('T-01 AC-01 every route: without signing in 401, without the permission 403; the result is recorded for the registry page', async () => {
  const api = await startApi();
  const sec = securityOf(api.db);
  const result = await runRouteTests({ app: sec.app, db: api.db, routes: sec.registry.routes, limiter: sec.limiter, authMode: 'dev-headers' });
  assert.deepEqual(result.failures, []);
  assert.equal(result.failed, 0);
  const expected = ROUTE_POLICY.filter((r) => !['public', 'infra'].includes(r.g)).length;
  assert.equal(result.tested, expected);
  assert.equal(result.passed, expected);
  const stored = api.db.prepare("SELECT last_test_result AS r, COUNT(*) AS n FROM core_route_registry GROUP BY last_test_result").all().map((x) => `${x.r}:${x.n}`).sort();
  assert.deepEqual(stored, [`pass:${expected}`, `skipped:${sec.registry.routes.length - expected}`].sort());
  // a route that does not refuse is found: a declaration with the wrong guard fails the test
  const wrong = sec.registry.routes.map((r) => (r.path === '/api/v1/core/about' ? { ...r, rule: { ...r.rule, g: 'permission' } } : r));
  assert.equal((await runRouteTests({ app: sec.app, db: api.db, routes: wrong, limiter: sec.limiter, authMode: 'dev-headers' })).failed, 0);
  await api.close();
});

test('T-01 in sign-in mode every route that is not public answers 401 without a token', async () => {
  const api = await startApi({ AUTH_MODE: 'iam' });
  const sec = securityOf(api.db);
  const result = await runRouteTests({ app: sec.app, db: api.db, routes: sec.registry.routes, limiter: sec.limiter, authMode: 'iam' });
  assert.deepEqual(result.failures, []);
  assert.ok(result.passed >= 250);
  await api.close();
});

test('FR-01 the policy matches the most specific route first, and a person without the declared permission is refused before the route runs', async () => {
  const policy = createPolicy();
  assert.equal(policy.find('GET', '/api/v1/iam/roles/compare').p, '/api/v1/iam/roles/compare');
  assert.equal(policy.find('GET', '/api/v1/iam/roles/12').p, '/api/v1/iam/roles/:id');
  assert.equal(policy.find('GET', '/api/v1/iam/nothing'), null);
  const api = await startApi();
  const refused = await api.call('GET', `${I}/users`, { roles: 'EMP', user: 'emp1' });
  assert.equal(refused.status, 403);
  assert.match(refused.json.error.message, /iam\.user\.view/);
  assert.equal((await api.call('GET', `${I}/users`, SYS)).status, 200);
  // a route declared "self" is open to every signed-in person, and still needs sign-in
  assert.equal((await api.call('GET', `${C}/display-settings`, { roles: 'EMP', user: 'emp1' })).status, 200);
  assert.equal((await api.call('GET', `${C}/display-settings`, { user: '' })).status, 401);
  await api.close();
});

test('T-02 AC-02 FR-03 rate limits: sign-in and second-step endpoints are limited per address, the refusal says when to retry and is a security event', async () => {
  const api = await startApi();
  securitySettingsOf(api.db).write(settingsWith({ rateLimits: { ...DEFAULT_SETTINGS.rateLimits, auth: { ipPerMinute: 3, userPerMinute: 3 }, otp: { ipPerMinute: 2, userPerMinute: 2 } } }), 'test');
  const post = (path, body = {}) => fetch(`${api.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const statuses = [];
  for (let i = 0; i < 5; i += 1) statuses.push((await post(`${I}/auth/login`, { username: 'nobody', password: WRONG, deviceId: 'device-aaaaaaaa', deviceName: 'x' })).status);
  assert.deepEqual(statuses.map((s) => s === 429), [false, false, false, true, true], statuses.join(','));
  const limited = await post(`${I}/auth/login`, { username: 'nobody', password: 'x' });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1, 'Retry-After');
  assert.equal((await limited.json()).error.code, 'RATE_LIMITED');
  const otp = [];
  for (let i = 0; i < 4; i += 1) otp.push((await post(`${I}/auth/mfa/verify`, { challengeToken: 'x'.repeat(20), code: '123456' })).status);
  assert.deepEqual(otp.map((s) => s === 429), [false, false, true, true]);
  // the first refusal of each is a security event, once
  const events = api.db.prepare("SELECT details_json FROM core_security_events WHERE type = 'rate_limit.exceeded'").all().map((e) => JSON.parse(e.details_json).class).sort();
  assert.deepEqual(events, ['auth', 'otp']);
  // another kind of request is not affected
  assert.equal((await api.call('GET', `${I}/users`, SYS)).status, 200);
  await api.close();
});

test('FR-03 a signed-in person is limited too, per person and per kind of request', async () => {
  const api = await startApi();
  securitySettingsOf(api.db).write(settingsWith({ rateLimits: { ...DEFAULT_SETTINGS.rateLimits, read: { ipPerMinute: 1000, userPerMinute: 4 } } }), 'test');
  const codes = [];
  for (let i = 0; i < 6; i += 1) codes.push((await api.call('GET', `${C}/display-settings`, { roles: 'EMP', user: 'busy1' })).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 429, 429]);
  assert.equal((await api.call('GET', `${C}/display-settings`, { roles: 'EMP', user: 'calm1' })).status, 200, 'another person is not limited');
  await api.close();
});

test('FR-04 AC-02 security headers are on every answer: pages, API answers, refusals and errors', async () => {
  const api = await startApi();
  const probes = [
    () => fetch(`${api.base}/health/live`),
    () => fetch(`${api.base}/api/v1/core/about`),
    () => api.call('GET', `${C}/about`, SYS),
    () => api.call('GET', `${C}/about`, { roles: 'EMP', user: 'emp1' }),
    () => fetch(`${api.base}/api/v1/does-not-exist`),
  ];
  for (const p of probes) {
    const res = await p();
    const h = res.headers;
    const csp = h.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'(;|$)/, 'only this application\'s scripts');
    assert.doesNotMatch(/script-src[^;]*/.exec(csp)[0], /unsafe/, 'no inline or eval scripts');
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.equal(h.get('x-frame-options'), 'DENY');
    assert.equal(h.get('x-content-type-options'), 'nosniff');
    assert.equal(h.get('referrer-policy'), 'no-referrer');
    assert.match(h.get('permissions-policy'), /camera=\(self\).*microphone=\(\)/);
    assert.equal(h.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(h.get('x-powered-by'), null);
  }
  assert.equal((await fetch(`${api.base}/api/v1/core/about`)).headers.get('cache-control'), 'no-store', 'API answers are never cached');
  // HSTS only where the connection is secure
  assert.equal((await fetch(`${api.base}/health/live`)).headers.get('strict-transport-security'), null);
  assert.match((await fetch(`${api.base}/health/live`, { headers: { 'x-forwarded-proto': 'https' } })).headers.get('strict-transport-security'), /^max-age=31536000; includeSubDomains$/);
  await api.close();
});

test('FR-04 CORS: only this site and the listed origins; a foreign page cannot change data; preflights are answered only for allowed origins', async () => {
  const api = await startApi();
  const get = (origin) => fetch(`${api.base}/api/v1/core/display-settings`, { headers: { origin, 'x-erp-user': 'u', 'x-erp-roles': 'EMP', 'x-erp-company': '1' } });
  assert.equal((await get(api.base)).headers.get('access-control-allow-origin'), api.base, 'its own origin');
  assert.equal((await get('https://evil.example.com')).headers.get('access-control-allow-origin'), null, 'a foreign origin gets no CORS headers, so the browser withholds the answer');
  const foreignPost = await fetch(`${api.base}/api/v1/core/audit/export-log`, { method: 'POST', headers: { origin: 'https://evil.example.com', 'content-type': 'application/json', 'x-erp-user': 'u', 'x-erp-roles': 'EMP', 'x-erp-company': '1' }, body: '{}' });
  assert.equal(foreignPost.status, 403);
  assert.equal((await foreignPost.json()).error.code, 'CORS_FORBIDDEN');
  const pre = (origin) => fetch(`${api.base}/api/v1/core/about`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'GET' } });
  assert.equal((await pre('https://evil.example.com')).status, 403);
  securitySettingsOf(api.db).write(settingsWith({ cors: { allowedOrigins: ['https://erp.partner.example'] } }), 'test');
  const ok = await pre('https://erp.partner.example');
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://erp.partner.example');
  assert.match(ok.headers.get('access-control-allow-headers'), /Idempotency-Key/);
  assert.equal(ok.headers.get('vary'), 'Origin');
  assert.equal((await get('https://erp.partner.example')).headers.get('access-control-allow-origin'), 'https://erp.partner.example');
  await api.close();
});

test('FR-04 cookie sessions: a request that changes data with the session cookie and no token needs the CSRF header', async () => {
  const api = await startApi();
  const post = (headers) => fetch(`${api.base}/api/v1/iam/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' });
  const refused = await post({ cookie: 'erp_rt=abcdefghijklmnopqrstuvwxyz0123456789abcd' });
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error.code, 'CSRF');
  assert.notEqual((await post({ cookie: 'erp_rt=abc', 'x-erp-csrf': '1' })).status, 403, 'with the header it goes on (and is then judged as a refresh token)');
  // signing in does not use the cookie, so a person who is already signed in can sign in again
  const login = await fetch(`${api.base}/api/v1/iam/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'erp_rt=abc' }, body: '{}' });
  assert.notEqual((await login.json()).error?.code, 'CSRF');
  assert.notEqual((await (await post({ cookie: 'erp_rt=abc', authorization: 'Bearer nonsense' })).json()).error.code, 'CSRF', 'a bearer token is a different proof');
  await api.close();
});

test('FR-05 T-03 the security settings are validated and changed only by an approved request; the history shows what changed', async () => {
  const api = await startApi();
  const base = securitySettingsOf(api.db).get().settings;
  const next = structuredClone(base);
  next.rateLimits.read.userPerMinute = 999;
  next.exports.personalApprovalThreshold = 500;
  const ask = (who, body) => api.call('POST', `${C}/security-settings/change-requests`, { ...who, headers: key(), body });
  assert.equal((await ask(SYS, { settings: next, reason: 'tighten the reads' })).status, 403, 'the system administrator reads; the IT administrator changes');
  assert.equal((await ask({ roles: 'EMP', user: 'e1' }, { settings: next, reason: 'tighten the reads' })).status, 403);
  // validation
  const unsafe = structuredClone(base);
  unsafe.headers.csp = `default-src 'self'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'`;
  const bad = await ask(ITADM, { settings: unsafe, reason: 'allow inline scripts' });
  assert.equal(bad.status, 400, bad.json && JSON.stringify(bad.json.error.details));
  assert.match(JSON.stringify(bad.json.error.details), /Inline or eval/);
  const noFrame = structuredClone(base);
  noFrame.headers.csp = "default-src 'self'; script-src 'self'";
  assert.equal((await ask(ITADM, { settings: noFrame, reason: 'drop frame rule' })).status, 400);
  const badOrigin = structuredClone(base);
  badOrigin.cors.allowedOrigins = ['https://x.example.com/path'];
  assert.equal((await ask(ITADM, { settings: badOrigin, reason: 'path in origin' })).status, 400);
  assert.equal((await ask(ITADM, { settings: base, reason: 'no change at all' })).status, 422);
  assert.equal((await ask(ITADM, { settings: next, reason: 'x' })).status, 400, 'a reason is required');
  // the change
  const raised = await ask(ITADM, { settings: next, reason: 'tighten the reads and the export threshold' });
  assert.equal(raised.status, 201, raised.text);
  assert.deepEqual(raised.json.data.chain, ['SYSADM|DIR']);
  assert.equal((await ask(ITADM, { settings: next, reason: 'a second open change' })).status, 409);
  assert.equal(securitySettingsOf(api.db).get().settings.exports.personalApprovalThreshold, 1000, 'nothing changes before approval');
  const act = (who) => api.call('POST', `${C}/change-requests/${raised.json.data.id}/act`, { ...who, headers: key(), body: { action: 'approve', comment: 'checked and fine' } });
  assert.equal((await act(ITADM)).status, 403, 'the requester cannot approve, and the IT administrator is not the checker');
  assert.equal((await act(SYS)).status, 200);
  const now = (await api.call('GET', `${C}/security-settings`, AUD)).json.data;
  assert.equal(now.settings.exports.personalApprovalThreshold, 500);
  assert.equal(now.settings.rateLimits.read.userPerMinute, 999);
  assert.equal(now.version, 1);
  assert.equal(now.customised, true);
  assert.equal(now.pending, null);
  // audited with the diff, visible in the record history, and announced
  const hist = (await api.call('GET', `${C}/audit/history?entity=core_security_settings&id=1`, AUD)).json.data;
  assert.equal(hist.length, 1);
  assert.deepEqual(hist[0].changes['exports.personalApprovalThreshold'], { old: 1000, new: 500 });
  assert.deepEqual(hist[0].changes['limits.read.userPerMinute'], { old: base.rateLimits.read.userPerMinute, new: 999 });
  assert.ok(api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'core.security.settings_changed'").get());
  // viewing
  assert.equal((await api.call('GET', `${C}/security-settings`, { roles: 'EMP', user: 'e1' })).status, 403);
  assert.equal((await api.call('GET', `${C}/security-settings`, SYS)).status, 200);
  await api.close();
});

test('FR-05 the settings page reports whether each secret is set, never its value', async () => {
  const secret = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-secret-value'; // secret-scan:allow fake credential for the test
  const api = await startApi({ AUTH_SECRET: secret, VAULT_KEY: `${secret}-v` });
  const res = await api.call('GET', `${C}/security-settings`, AUD);
  assert.equal(res.status, 200);
  const byName = Object.fromEntries(res.json.data.secrets.map((s) => [s.name, s.set]));
  assert.deepEqual(byName, { AUTH_SECRET: true, VAULT_KEY: true, FILE_URL_SECRET: false, HEALTH_TOKEN: false });
  assert.doesNotMatch(JSON.stringify(res.json), /secret-value/);
  await api.close();
});

test('T-routes the registry API: totals, filters, and who may run the self-test', async () => {
  const api = await startApi();
  const list = await api.call('GET', `${C}/routes?pageSize=200`, AUD);
  assert.equal(list.status, 200, list.text);
  assert.equal(list.json.summary.total, ROUTE_POLICY.length);
  assert.equal(list.json.summary.undeclared, 0);
  assert.equal(list.json.summary.declaredPct, 100);
  assert.ok(list.json.modules.some((m) => m.module === 'core') && list.json.modules.some((m) => m.module === 'iam'));
  assert.equal((await api.call('GET', `${C}/routes?filter[guard]=public&pageSize=200`, AUD)).json.meta.total, ROUTE_POLICY.filter((r) => r.g === 'public').length);
  assert.equal((await api.call('GET', `${C}/routes?q=security-settings`, AUD)).json.meta.total, 2);
  assert.equal((await api.call('GET', `${C}/routes?filter[nope]=1`, AUD)).status, 400);
  assert.equal((await api.call('GET', `${C}/routes`, { roles: 'EMP', user: 'e1' })).status, 403);
  assert.equal((await api.call('POST', `${C}/routes/self-test`, { ...AUD, headers: key() })).status, 403, 'the auditor reads the registry; the IT administrator runs the test');
  const run = await api.call('POST', `${C}/routes/self-test`, { ...ITADM, headers: key() });
  assert.equal(run.status, 200, run.text);
  assert.equal(run.json.data.failed, 0);
  assert.ok(run.json.data.passed > 200);
  const after = (await api.call('GET', `${C}/routes?filter[result]=pass&pageSize=1`, AUD)).json;
  assert.equal(after.meta.total, run.json.data.passed);
  assert.equal(after.summary.failed, 0);
  assert.ok(after.summary.testedAt);
  await api.close();
});

test('FR-08 AC-06 an export needs its permission, neutralises formulas, is logged; a bulk export of people needs approval and can be used once', async () => {
  const api = await startApi();
  const identity = identityOf(api.db);
  const store = createUserStore({ db: api.db, identity });
  await store.create({ companyId: 1, username: 'hr1', email: 'hr1@example.com', displayName: 'HR One', roles: ['HRMGR'], password: PW });
  await store.create({ companyId: 1, username: 'evil1', email: 'evil1@example.com', displayName: '=HYPERLINK("http://evil.example")', roles: ['PM'], password: PW });
  await store.create({ companyId: 1, username: 'plus1', email: 'plus1@example.com', displayName: '+cmd|calc', roles: ['PM'], password: PW });
  const HR = { roles: 'HRMGR', user: 'hr1' };
  const exp = (who, body = {}) => api.call('POST', `${I}/users/export`, { ...who, headers: key(), body });
  assert.equal((await exp({ roles: 'PM', user: 'pm1' })).status, 403, 'no export permission');
  assert.equal((await exp(AUD)).status, 403, 'the auditor reads; it does not export people');
  const small = await api.raw('POST', `${I}/users/export`, { ...HR, headers: key(), body: JSON.stringify({}) });
  assert.equal(small.status, 200);
  assert.match(small.headers.get('content-type'), /text\/csv/);
  assert.equal(small.headers.get('x-export-rows'), '3');
  const text = small.buffer.toString('utf8');
  assert.match(text, /^Username,Name,Employee code/);
  assert.match(text, /"'=HYPERLINK\(""http:\/\/evil\.example""\)"/, 'a formula is neutralised');
  assert.match(text, /'\+cmd\|calc/);
  assert.doesNotMatch(text, /(^|,)=HYPERLINK/m);
  assert.equal(toCsv(['a'], [['=1+1'], ['@x'], ['-5'], ['ok']]), "a\r\n'=1+1\r\n'@x\r\n'-5\r\nok\r\n");
  assert.equal(neutralise('plain'), 'plain');
  // logged in the audit trail, with its filters, and as a security event
  const trail = (await api.call('GET', `${C}/audit?entity=report&action=export`, AUD)).json.data;
  assert.equal(trail.length, 1);
  assert.equal(trail[0].actor, 'hr1');
  assert.equal(trail[0].changes.rows.new, 3);
  assert.ok((await api.call('GET', `${C}/security-events?type=export.sensitive`, SYS)).json.data.length >= 1);
  // above the threshold it waits for the HR manager or the director
  securitySettingsOf(api.db).write(settingsWith({ exports: { personalApprovalThreshold: 2 } }), 'test');
  const waiting = await exp(HR, { filters: { status: 'ACTIVE' } });
  assert.equal(waiting.status, 202, waiting.text);
  assert.equal(waiting.json.data.status, 'APPROVAL_REQUIRED');
  assert.equal(waiting.json.data.threshold, 2);
  const reqId = waiting.json.data.request.id;
  assert.deepEqual(waiting.json.data.request.chain, ['HRMGR|DIR']);
  assert.equal((await exp(HR, { filters: { status: 'ACTIVE' } })).json.data.request.id, reqId, 'asking again does not raise another');
  assert.equal((await exp(HR, { filters: { status: 'ACTIVE' }, approvalId: reqId })).status, 422, 'not approved yet');
  const decide = (who) => api.call('POST', `${C}/change-requests/${reqId}/act`, { ...who, headers: key(), body: { action: 'approve', comment: 'needed for the audit' } });
  assert.equal((await decide(HR)).status, 403, 'the requester cannot approve');
  assert.equal((await decide({ roles: 'DIR', user: 'dir1' })).status, 200);
  assert.equal((await exp({ roles: 'HRMGR', user: 'hr2' }, { filters: { status: 'ACTIVE' }, approvalId: reqId })).status, 422, 'the approval is the requester\'s');
  assert.equal((await exp(HR, { approvalId: reqId })).status, 422, 'a different export (other filters) needs its own approval');
  const released = await api.raw('POST', `${I}/users/export`, { ...HR, headers: key(), body: JSON.stringify({ filters: { status: 'ACTIVE' }, approvalId: reqId }) });
  assert.equal(released.status, 200, released.buffer.toString());
  assert.equal((await exp(HR, { filters: { status: 'ACTIVE' }, approvalId: reqId })).status, 422, 'an approval is used once');
  // an export that failed before its file left gives the approval back, once
  createExportGuard({ db: api.db, approvals: null }).release({ user: 'hr1', companyId: 1 }, reqId, 'the file could not be built');
  assert.equal((await api.raw('POST', `${I}/users/export`, { ...HR, headers: key(), body: JSON.stringify({ filters: { status: 'ACTIVE' }, approvalId: reqId }) })).status, 200, 'given back: usable again');
  assert.equal((await exp(HR, { filters: { status: 'ACTIVE' }, approvalId: reqId })).status, 422, 'and spent again');
  const grants = api.db.prepare("SELECT action FROM core_audit_log WHERE entity = 'export_grant' ORDER BY id").all().map((r) => r.action);
  assert.deepEqual(grants, ['approved', 'used', 'released', 'used']);
  assert.equal((await api.call('GET', `${C}/security-events?type=export.sensitive&severity=HIGH`, SYS)).json.data.length, 2, 'each bulk export of people (here two, on the given-back approval) is a high event');
  await api.close();
});

test('BR-02 AC-03 real-time rooms: joining checks the permission, every event checks it again, and a member who lost it is dropped', async () => {
  const api = await startApi();
  const sec = securityOf(api.db);
  const authz = authzOf(api.db);
  sec.rooms.register('project', { permission: 'org.view', resolve: (_db, id) => ({ companyId: 1, projectId: Number(id) }) });
  assert.ok(sec.rooms.kinds().includes('project'), 'the real-time layer of 04.06 registers the rooms of sites, departments and conversations beside it');
  const actor = (user, roles) => authz.enrich({ user, roles, companyId: 1 });
  const pm = actor('pm1', ['PM']);
  assert.deepEqual(sec.rooms.join(pm, 'project:12'), { joined: 'project:12' });
  assert.throws(() => sec.rooms.join(actor('emp1', ['EMP']), 'project:12'), (e) => e.status === 403);
  assert.throws(() => sec.rooms.join(pm, 'project:12;drop'), (e) => e.status === 404, 'a malformed room name');
  assert.throws(() => sec.rooms.join(pm, 'secret:1'), (e) => e.status === 403, 'an unknown kind of room');
  assert.ok(api.db.prepare("SELECT 1 FROM core_security_events WHERE type = 'socket.denied' AND username = 'emp1'").get(), 'the refusal is a security event');
  // events are checked for each member each time
  const got = [];
  const left = [];
  const members = [{ actor: pm, send: (e) => got.push(['pm1', e]), leave: (r) => left.push(['pm1', r]) }, { actor: actor('qs1', ['QS']), send: (e) => got.push(['qs1', e]), leave: (r) => left.push(['qs1', r]) }];
  assert.deepEqual(sec.rooms.deliver('project:12', { n: 1 }, members).delivered.sort(), ['pm1', 'qs1']);
  members[1].actor = actor('qs1', ['EMP']); // the role was taken away after the member joined
  const second = sec.rooms.deliver('project:12', { n: 2 }, members);
  assert.deepEqual(second.delivered, ['pm1']);
  assert.deepEqual(second.dropped, ['qs1']);
  assert.deepEqual(left, [['qs1', 'project:12']]);
  assert.deepEqual(got.filter(([u]) => u === 'qs1').map(([, e]) => e.n), [1], 'nothing reached them after the role went');
  await api.close();
});

test('FR-02 work done for a person runs with that person\'s grants and context, and only while they can sign in', async () => {
  const api = await startApi();
  const sec = securityOf(api.db);
  const store = createUserStore({ db: api.db, identity: identityOf(api.db) });
  const pm = await store.create({ companyId: 1, username: 'pm1', email: 'pm1@example.com', displayName: 'PM One', roles: ['PM'], password: PW });
  const seen = sec.actAs.run(pm.id, (a) => ({ user: a.user, hasOrg: a.grants.perms.includes('org.view'), hasUsers: a.grants.perms.includes('iam.user.manage') }));
  assert.deepEqual(seen, { user: 'pm1', hasOrg: true, hasUsers: false });
  api.db.prepare("UPDATE iam_user_profiles SET lifecycle = 'SUSPENDED' WHERE user_id = ?").run(pm.id);
  assert.throws(() => sec.actAs.run(pm.id, () => 1), (e) => e.status === 422 && /suspended/.test(e.message));
  assert.throws(() => sec.actAs.run(99999, () => 1), (e) => e.status === 404);
  await api.close();
});

test('the buildRegistry check reports a route nobody declared and a declaration nobody needs', () => {
  const policy = createPolicy([{ m: 'GET', p: '/api/v1/a', g: 'permission', k: 'x.y', s: null, scope: 'company', rate: 'read', audit: false }, { m: 'GET', p: '/api/v1/gone', g: 'self', k: null, s: null, scope: 'company', rate: 'read', audit: false }]);
  const fakeApp = { router: { stack: [{ route: { path: '/api/v1/a', methods: { get: true } } }, { route: { path: '/api/v1/b', methods: { post: true } } }] } };
  const built = buildRegistry(fakeApp, policy);
  assert.deepEqual(built.undeclared, ['POST /api/v1/b']);
  assert.deepEqual(built.stale, ['GET /api/v1/gone']);
  assert.deepEqual(checkKeys(built, new Set(['other.key'])), ['GET /api/v1/a: x.y']);
});

test('FR-05 rotating VAULT_KEY re-encrypts every stored credential, checks each one, and a wrong old key changes nothing', async () => {
  const { createVault } = await import('../src/server/platform/integrations/vault.js');
  const { rotateVaultKey } = await import('../src/server/platform/security/rotate.js');
  const api = await startApi();
  const OLD = 'old-vault-key-0123456789-0123456789-abc';
  const NEW = 'new-vault-key-9876543210-9876543210-xyz';
  api.db.prepare("INSERT INTO core_connectors (company_id, code, name, type, provider, environment, config_json, status, created_by) VALUES (1, 'mail.rot', 'Mail', 'email', 'sandbox', 'development', '{}', 'ENABLED', 't')").run();
  const cid = api.db.prepare("SELECT id FROM core_connectors WHERE code = 'mail.rot'").get().id;
  const vault = createVault({ secret: OLD });
  api.db.prepare("INSERT INTO core_connector_secrets (company_id, connector_id, key, encrypted_value, status, created_by, source_type) VALUES (1, ?, 'apiKey', ?, 'ACTIVE', 't', 'connector_secret')").run(cid, vault.encrypt('s3cr3t-value', `1/${cid}/apiKey`));
  const before = api.db.prepare('SELECT encrypted_value FROM core_connector_secrets').get().encrypted_value;
  assert.throws(() => rotateVaultKey({ db: api.db, oldKey: 'wrong-old-key-0123456789-0123456789-abc', newKey: NEW, apply: true }), /./);
  assert.equal(api.db.prepare('SELECT encrypted_value FROM core_connector_secrets').get().encrypted_value, before, 'a wrong old key changes nothing');
  assert.deepEqual(rotateVaultKey({ db: api.db, oldKey: OLD, newKey: NEW }), { values: 1, applied: false });
  assert.equal(api.db.prepare('SELECT encrypted_value FROM core_connector_secrets').get().encrypted_value, before, 'a dry run changes nothing');
  assert.throws(() => rotateVaultKey({ db: api.db, oldKey: OLD, newKey: 'short' }), /32 characters/);
  assert.deepEqual(rotateVaultKey({ db: api.db, oldKey: OLD, newKey: NEW, apply: true }), { values: 1, applied: true });
  const after = api.db.prepare('SELECT encrypted_value FROM core_connector_secrets').get().encrypted_value;
  assert.notEqual(after, before);
  assert.equal(createVault({ secret: NEW }).decrypt(after, `1/${cid}/apiKey`), 's3cr3t-value');
  assert.throws(() => createVault({ secret: OLD }).decrypt(after, `1/${cid}/apiKey`));
  await api.close();
});

test('section 6 the pipeline stages are middleware a route can name: Authorise (with a scope), Validate and Audit', async () => {
  const api = await startApi();
  const authz = authzOf(api.db);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.actor = authz.enrich({ user: req.get('x-u'), roles: [req.get('x-r')], companyId: 1 }); next(); });
  app.post('/x/:project', authorise('org.view'), validate(z.object({ name: z.string().min(3) }).strict()), audit(api.db, (req) => ({ entity: 'thing', entityId: req.params.project, action: 'create', newValues: req.body })), (req, res) => res.status(201).json({ ok: true, name: req.body.name }));
  app.get('/y/:project', authorise('org.view', { db: api.db, scope: (req) => ({ companyId: 1, projectId: Number(req.params.project) }) }), (_req, res) => res.json({ ok: true }));
  app.use(errorHandler(silentLogger));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, who, body) => fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-u': who.u, 'x-r': who.r }, body: body ? JSON.stringify(body) : undefined });
  assert.equal((await call('POST', '/x/5', { u: 'e', r: 'EMP' }, { name: 'abc' })).status, 403, 'authorise first');
  assert.equal((await call('POST', '/x/5', { u: 'p', r: 'PM' }, { name: 'a' })).status, 400, 'then validate');
  assert.equal((await call('POST', '/x/5', { u: 'p', r: 'PM' }, { name: 'abc', extra: 1 })).status, 400, 'unknown fields are refused');
  assert.equal((await call('POST', '/x/5', { u: 'p', r: 'PM' }, { name: 'abc' })).status, 201);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'thing'").get().n, 1, 'only the success is audited');
  assert.equal((await call('GET', '/y/7', { u: 'p', r: 'PM' })).status, 200, 'the scope check goes to the permission engine');
  assert.equal((await call('GET', '/y/7', { u: 'e', r: 'EMP' })).status, 403);
  await new Promise((resolve) => server.close(resolve));
  await api.close();
});
