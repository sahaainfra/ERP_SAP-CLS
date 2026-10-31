import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, pbkdf2Sync } from 'node:crypto';
import '../src/server/modules/registry.js';
import { createLogger } from '../src/server/platform/http/logger.js';
import { identityOf } from '../src/server/platform/identity/index.js';
import { counterAt, totpAt } from '../src/server/platform/identity/totp.js';
import { sandboxMessages } from '../src/server/platform/integrations/providers.js';
import { createUserStore } from '../src/server/modules/iam/users.js';
import { startApi } from './helpers.js';

const C = '/api/v1/iam';
const PW = 'Tr0ub4dor&3-Excavator';
const idem = () => ({ 'idempotency-key': `iam-${Math.random().toString(36).slice(2, 12)}` });
const quiet = () => createLogger({ write: () => {} });

/** An application in AUTH_MODE=iam with a controllable clock, a cheap password hash and a sandbox email connector. */
async function boot(config = {}) {
  const clock = { t: Date.parse('2026-10-30T10:00:00.000Z') };
  const api = await startApi({ AUTH_MODE: 'iam', ...config }, { logger: quiet(), identityOptions: { passwordCost: { memory: 8, passes: 1 }, now: () => clock.t } });
  const identity = identityOf(api.db);
  const users = createUserStore({ db: api.db, identity });
  api.db.prepare("INSERT INTO core_connectors (company_id, code, name, type, provider, environment, config_json, status, created_by) VALUES (1, 'mail.main', 'Mail', 'email', 'sandbox', 'development', '{\"fromAddress\":\"noreply@example.com\"}', 'ENABLED', 'test')").run();
  const http = async (method, path, { token, body, headers = {}, country, ip } = {}) => {
    const res = await fetch(api.base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-token-delivery': 'body', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(country ? { 'x-geo-country': country } : {}), ...(ip ? { 'x-forwarded-for': ip } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
  };
  const login = (username, password = PW, extra = {}, opts = {}) => http('POST', `${C}/auth/login`, { body: { username, password, deviceId: 'device-aaaaaaaa', deviceName: 'Site laptop', ...extra }, ...opts });
  const mk = (username, roles, over = {}) => users.create({ companyId: 1, username, email: `${username}@example.com`, displayName: username, roles, password: PW, ...over });
  const authed = (token) => ({ get: (p) => http('GET', p, { token }), post: (p, body, h = {}) => http('POST', p, { token, body, headers: { ...idem(), ...h } }), del: (p) => http('DELETE', p, { token }) });
  const code = (secret) => totpAt(secret, counterAt(clock.t));
  return { api, clock, identity, users, http, login, mk, authed, code, close: () => api.close() };
}

/** A privileged user with an authenticator set up, signed in. */
async function enrolled(app, username = 'sysadmin') {
  await app.mk(username, ['SYSADM']);
  const first = await app.login(username);
  assert.equal(first.json.data.status, 'mfa_enrolment_required');
  const begin = await app.http('POST', `${C}/auth/mfa/enrol/begin`, { body: { challengeToken: first.json.data.challengeToken } });
  const secret = begin.json.data.secret;
  const done = await app.http('POST', `${C}/auth/mfa/enrol/confirm`, { body: { challengeToken: first.json.data.challengeToken, code: app.code(secret), deviceId: 'device-aaaaaaaa', deviceName: 'Site laptop' } });
  assert.equal(done.json.data.status, 'ok', JSON.stringify(done.json));
  return { secret, token: done.json.data.accessToken, backupCodes: done.json.data.backupCodes, session: done.json.data.session.id };
}

test('T-04 existing users sign in with their current password after deployment, and the old hash is replaced by Argon2id', async () => {
  const app = await boot();
  const salt = Buffer.from('legacy-salt-123456');
  const legacy = `pbkdf2_sha256$120000$${salt.toString('base64')}$${pbkdf2Sync('Old-Password-1', salt, 120000, 32, 'sha256').toString('base64')}`;
  app.users.importHashed({ companyId: 1, username: 'meera', email: 'meera@example.com', displayName: 'Meera', roles: ['PM'], passwordHash: legacy });
  app.users.importHashed({ companyId: 1, username: 'ravi', displayName: 'Ravi', roles: ['PM'], passwordHash: `sha256$pepper$${createHash('sha256').update('pepperOld-Password-3').digest('hex')}` });
  const before = app.api.db.prepare("SELECT password_hash, algo FROM iam_credentials WHERE user_id = (SELECT id FROM iam_users WHERE username = 'meera')").get();
  assert.equal(before.password_hash, legacy);

  const ok = await app.login('meera', 'Old-Password-1');
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.data.status, 'ok');
  const after = app.api.db.prepare("SELECT password_hash, algo FROM iam_credentials WHERE user_id = (SELECT id FROM iam_users WHERE username = 'meera')").get();
  assert.match(after.password_hash, /^\$argon2id\$/);
  assert.equal(after.algo, 'argon2id');
  assert.equal((await app.login('meera', 'Old-Password-1')).json.data.status, 'ok', 'the same password still works on the new hash');
  assert.equal((await app.login('ravi', 'Old-Password-3')).json.data.status, 'ok');
  assert.equal((await app.login('meera', 'Old-Password-2')).status, 401);
  assert.equal(app.api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE action = 'hash_upgraded'").get().n, 2);
  // sign in by email too (FR-01)
  assert.equal((await app.login('meera@example.com', 'Old-Password-1')).json.data.status, 'ok');
  await app.close();
});

test('BR-01 a wrong password, an unknown user and a locked account all get exactly the same answer', async () => {
  const app = await boot();
  await app.mk('pooja', ['PM']);
  const answers = [];
  answers.push(await app.login('pooja', 'wrong-Password-1'));
  answers.push(await app.login('nobody-here', 'wrong-Password-1'));
  for (let i = 0; i < 6; i += 1) await app.login('pooja', 'wrong-Password-1', { captchaToken: 'x' });
  answers.push(await app.login('pooja', PW, { captchaToken: 'x' }));
  for (const a of answers) {
    assert.equal(a.status, 401);
    assert.equal(a.json.error.code, 'UNAUTHENTICATED');
  }
  assert.equal(answers[0].json.error.message, answers[1].json.error.message);
  assert.ok(!/exist|lock|disabled|password is wrong|unknown/i.test(answers[0].json.error.message), 'the message names no cause');
  assert.deepEqual(answers[0].json.error.details, answers[1].json.error.details);
  await app.close();
});

test('T-01 lockout after repeated failures with a growing delay, CAPTCHA first, unlock after the timeout', async () => {
  const app = await boot();
  await app.mk('pooja', ['PM']);
  const wrong = (extra) => app.login('pooja', 'wrong-Password-1', extra);
  for (let i = 0; i < 3; i += 1) assert.equal((await wrong()).status, 401);
  // after 3 failures a CAPTCHA is needed, and it is the same for a name that does not exist
  const challenge = (await app.http('POST', `${C}/auth/captcha`, { body: { username: 'pooja' } })).json.data;
  assert.equal(challenge.required, true);
  assert.equal((await app.http('POST', `${C}/auth/captcha`, { body: { username: 'ghost-user' } })).json.data.required, false);
  const missing = await app.login('pooja', PW);
  assert.equal(missing.status, 401, 'the right password is not enough without the CAPTCHA');
  assert.equal(missing.json.error.details[0].field, 'captcha');
  const answer = (c) => String(c.question.match(/\d+/g).reduce((sum, n) => sum + Number(n), 0)); // "What is 12 + 34?"
  assert.equal((await app.login('pooja', PW, { captchaToken: challenge.challenge.token, captchaAnswer: '1' })).status, 401, 'a wrong answer');
  // two more failures reach the threshold of 5 (each with an answered CAPTCHA)
  for (let i = 0; i < 2; i += 1) {
    const c = (await app.http('POST', `${C}/auth/captcha`, { body: { username: 'pooja' } })).json.data.challenge;
    await wrong({ captchaToken: c.token, captchaAnswer: answer(c) });
  }
  const c1 = (await app.http('POST', `${C}/auth/captcha`, { body: { username: 'pooja' } })).json.data.challenge;
  const locked = await app.login('pooja', PW, { captchaToken: c1.token, captchaAnswer: answer(c1) });
  assert.equal(locked.status, 401, 'locked: even the right password is refused');
  const cred = () => app.api.db.prepare("SELECT failed_count, locked_until FROM iam_credentials WHERE user_id = (SELECT id FROM iam_users WHERE username = 'pooja')").get();
  assert.equal(cred().failed_count, 5);
  assert.equal(Date.parse(cred().locked_until) - app.clock.t, 60_000, 'the first lock is one minute');
  assert.equal(app.api.db.prepare("SELECT COUNT(*) AS n FROM iam_login_events WHERE result = 'locked'").get().n >= 2, true);
  assert.equal(app.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'iam.account.locked'").get().n, 1);

  app.clock.t += 30_000;
  const c2 = (await app.http('POST', `${C}/auth/captcha`, { body: { username: 'pooja' } })).json.data.challenge;
  assert.equal((await app.login('pooja', PW, { captchaToken: c2.token, captchaAnswer: answer(c2) })).status, 401, 'still locked after 30 seconds');
  app.clock.t += 31_000;
  // the lock has run out; one more wrong password is the sixth failure and doubles the delay
  const c2b = (await app.http('POST', `${C}/auth/captcha`, { body: { username: 'pooja' } })).json.data.challenge;
  await wrong({ captchaToken: c2b.token, captchaAnswer: answer(c2b) });
  assert.equal(Date.parse(cred().locked_until) - app.clock.t, 120_000, 'progressive delay: two minutes the second time');
  app.clock.t += 121_000;
  const c3 = (await app.http('POST', `${C}/auth/captcha`, { body: { username: 'pooja' } })).json.data.challenge;
  const ok = await app.login('pooja', PW, { captchaToken: c3.token, captchaAnswer: answer(c3) });
  assert.equal(ok.json.data.status, 'ok', 'unlocked after the delay');
  assert.equal(cred().failed_count, 0);
  assert.equal((await app.http('POST', `${C}/auth/captcha`, { body: { username: 'pooja' } })).json.data.required, false, 'a good sign-in clears the count');

  // after a good sign-in the count starts again, so the first lock is one minute once more
  for (let i = 0; i < 5; i += 1) {
    const need = (await app.http('POST', `${C}/auth/captcha`, { body: { username: 'pooja' } })).json.data;
    await wrong(need.required ? { captchaToken: need.challenge.token, captchaAnswer: answer(need.challenge) } : {});
  }
  assert.equal(Date.parse(cred().locked_until) - app.clock.t, 60_000);
  await app.close();
});

test('T-03 / BR-02 a privileged role cannot sign in without a second step; the second step is checked and remembered devices do not skip it', async () => {
  const app = await boot();
  const s = await enrolled(app);
  assert.equal(s.backupCodes.length, 10);
  assert.ok(app.api.db.prepare('SELECT secret_encrypted FROM iam_mfa_factors WHERE type = ?').get('totp').secret_encrypted.startsWith('v1.'), 'the seed is encrypted at rest');
  assert.ok(!JSON.stringify(app.api.db.prepare('SELECT * FROM iam_mfa_factors').all()).includes(s.secret), 'and appears nowhere in plain text');

  const again = await app.login('sysadmin', PW, { rememberDevice: true });
  assert.equal(again.json.data.status, 'mfa_required', 'a password alone never completes the sign-in');
  assert.equal(again.json.data.accessToken, undefined);
  const ct = again.json.data.challengeToken;
  const verify = (body) => app.http('POST', `${C}/auth/mfa/verify`, { body: { challengeToken: ct, deviceId: 'device-aaaaaaaa', deviceName: 'Site laptop', ...body } });
  assert.equal((await verify({ method: 'totp', code: '000000' })).status, 401);
  assert.equal((await verify({ method: 'totp', code: app.code(s.secret) })).status, 401, 'the code of the step used at enrolment cannot be used again');
  app.clock.t += 30_000;
  const ok = await verify({ method: 'totp', code: app.code(s.secret), rememberDevice: true });
  assert.equal(ok.json.data.status, 'ok');
  assert.equal(ok.json.data.deviceToken, null, 'a privileged role does not get a remembered device');

  app.clock.t += 30_000;
  const third = await app.login('sysadmin', PW, { deviceToken: ok.json.data.deviceToken });
  assert.equal(third.json.data.status, 'mfa_required');
  // a backup code works once
  const bk = await app.http('POST', `${C}/auth/mfa/verify`, { body: { challengeToken: third.json.data.challengeToken, method: 'backup', code: s.backupCodes[0] } });
  assert.equal(bk.json.data.status, 'ok');
  const fourth = await app.login('sysadmin', PW);
  assert.equal((await app.http('POST', `${C}/auth/mfa/verify`, { body: { challengeToken: fourth.json.data.challengeToken, method: 'backup', code: s.backupCodes[0] } })).status, 401, 'a backup code is single-use');
  assert.equal(app.api.db.prepare("SELECT COUNT(*) AS n FROM iam_login_events WHERE result = 'mfa_failed'").get().n >= 3, true);

  // a person with no privileged role is not forced, but may choose to
  await app.mk('pooja', ['PM']);
  assert.equal((await app.login('pooja')).json.data.status, 'ok');
  await app.close();
});

test('FR-02 a text-message code works as a second step; enrolment and delivery go through the SMS connector', async () => {
  const sent = [];
  const sms = await new Promise((resolve) => {
    import('node:http').then(({ createServer }) => {
      const server = createServer((req, res) => {
        let body = '';
        req.on('data', (d) => { body += d; });
        req.on('end', () => { sent.push(JSON.parse(body)); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
      });
      server.listen(0, '127.0.0.1', () => resolve(server));
    });
  });
  const app = await boot();
  app.api.db.prepare("INSERT INTO core_connectors (company_id, code, name, type, provider, environment, config_json, status, created_by) VALUES (1, 'sms.otp', 'SMS', 'sms', 'http_json', 'development', ?, 'ENABLED', 'test')").run(JSON.stringify({ baseUrl: `http://127.0.0.1:${sms.address().port}` }));
  const c = app.api.db.prepare("SELECT * FROM core_connectors WHERE code = 'sms.otp'").get();
  const { integrationsOf } = await import('../src/server/platform/integrations/index.js');
  const i = integrationsOf(app.api.db);
  i.secrets.stage({ user: 't' }, c, 'api_key', 'sms-gateway-key-123');
  i.secrets.promote(c, ['api_key'], { user: 't' });

  const s = await enrolled(app);
  const me = app.authed(s.token);
  const begin = await me.post(`${C}/me/mfa/phone/begin`, { phone: '+919876543210', channel: 'sms' });
  assert.equal(begin.status, 200, JSON.stringify(begin.json));
  const otp = /\b(\d{6})\b/.exec(sent[0].message)[1];
  assert.equal(sent[0].to, '+919876543210');
  assert.equal((await me.post(`${C}/me/mfa/phone/confirm`, { channel: 'sms', code: '111111' })).status, 422);
  assert.equal((await me.post(`${C}/me/mfa/phone/confirm`, { channel: 'sms', code: otp })).status, 200);
  const factors = (await me.get(`${C}/me`)).json.data.mfa.factors;
  assert.deepEqual(factors.map((f) => f.type).sort(), ['sms', 'totp']);
  assert.ok(!JSON.stringify(factors).includes('9876543210'), 'the number is masked');

  app.clock.t += 60_000;
  const step = await app.login('sysadmin');
  const smsFactor = step.json.data.factors.find((f) => f.type === 'sms');
  assert.equal((await app.http('POST', `${C}/auth/mfa/send`, { body: { challengeToken: step.json.data.challengeToken, factorId: smsFactor.id } })).json.data.sent, true);
  const otp2 = /\b(\d{6})\b/.exec(sent[1].message)[1];
  const done = await app.http('POST', `${C}/auth/mfa/verify`, { body: { challengeToken: step.json.data.challengeToken, method: 'sms', factorId: smsFactor.id, code: otp2 } });
  assert.equal(done.json.data.status, 'ok');
  // a connector that is not there means "could not send", said plainly
  app.api.db.prepare("UPDATE core_connectors SET status = 'DISABLED' WHERE code = 'sms.otp'").run();
  const off = await me.post(`${C}/me/mfa/phone/begin`, { phone: '+919876543210', channel: 'whatsapp' });
  assert.equal(off.status, 503);
  await new Promise((r) => sms.close(r));
  await app.close();
});

test('T-02 a refresh token is replaced on each use; presenting an old one ends the whole session', async () => {
  const app = await boot();
  await app.mk('pooja', ['PM']);
  const first = (await app.login('pooja')).json.data;
  assert.equal((await app.authed(first.accessToken).get('/api/v1/core/session')).json.data.user, 'pooja');

  app.clock.t += 60_000;
  const second = (await app.http('POST', `${C}/auth/refresh`, { body: { refreshToken: first.refreshToken } })).json.data;
  assert.notEqual(second.refreshToken, first.refreshToken);
  assert.equal(second.session.id, first.session.id, 'same session');
  app.clock.t += 60_000;
  const third = (await app.http('POST', `${C}/auth/refresh`, { body: { refreshToken: second.refreshToken } })).json.data;
  assert.equal((await app.authed(third.accessToken).get('/api/v1/core/session')).status, 200);

  // the first token is presented again: someone copied it
  const reuse = await app.http('POST', `${C}/auth/refresh`, { body: { refreshToken: first.refreshToken } });
  assert.equal(reuse.status, 401);
  assert.equal((await app.http('POST', `${C}/auth/refresh`, { body: { refreshToken: third.refreshToken } })).status, 401, 'the newest token of that family is dead too');
  assert.equal((await app.authed(third.accessToken).get('/api/v1/core/session')).status, 401, 'and so is its access token');
  const s = app.api.db.prepare('SELECT revoked_reason FROM iam_sessions WHERE public_id = ?').get(first.session.id);
  assert.equal(s.revoked_reason, 'refresh_reuse');
  assert.equal(app.api.db.prepare("SELECT COUNT(*) AS n FROM iam_login_events WHERE result = 'refresh_reuse'").get().n, 1);
  assert.equal(app.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'iam.refresh.reuse_detected'").get().n, 1);
  assert.equal((await app.http('POST', `${C}/auth/refresh`, { body: { refreshToken: 'x'.repeat(40) } })).status, 401);
  await app.close();
});

test('the refresh token travels in an HttpOnly SameSite=Strict cookie and needs the CSRF header', async () => {
  const app = await boot();
  await app.mk('pooja', ['PM']);
  const res = await fetch(`${app.api.base}${C}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'pooja', password: PW, deviceId: 'device-aaaaaaaa' }) });
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /^erp_rt=[\w-]{40,}; HttpOnly; SameSite=Strict; Path=\/api\/v1\/iam\/auth; Max-Age=\d+/);
  const body = await res.json();
  assert.equal(body.data.refreshToken, undefined, 'a browser never sees the refresh token in the body');
  const jar = cookie.split(';')[0];
  const noHeader = await fetch(`${app.api.base}${C}/auth/refresh`, { method: 'POST', headers: { cookie: jar, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noHeader.status, 403, 'a cookie alone is refused: a cross-site form cannot send the header');
  assert.equal((await noHeader.json()).error.code, 'CSRF');
  const ok = await fetch(`${app.api.base}${C}/auth/refresh`, { method: 'POST', headers: { cookie: jar, 'x-erp-csrf': '1', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(ok.status, 200);
  assert.notEqual(ok.headers.get('set-cookie').split(';')[0], jar, 'rotated');
  const out = await fetch(`${app.api.base}${C}/auth/logout`, { method: 'POST', headers: { cookie: ok.headers.get('set-cookie').split(';')[0], 'x-erp-csrf': '1', 'content-type': 'application/json' }, body: '{}' });
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  await app.close();
});

test('FR-06 / AC-02 idle timeout, absolute timeout, the session limit and sign-out all end a session at once', async () => {
  const app = await boot();
  await app.mk('pooja', ['PM']);
  app.api.db.prepare('INSERT INTO iam_auth_policy (company_id, settings_json) VALUES (1, ?)').run(JSON.stringify({ session: { accessMinutes: 60 } }));
  app.identity.policies.invalidate();
  const a = (await app.login('pooja')).json.data;
  const who = (t) => app.authed(t).get('/api/v1/core/session');
  assert.equal((await who(a.accessToken)).status, 200);
  app.clock.t += 31 * 60_000;
  assert.equal((await who(a.accessToken)).status, 401, 'idle for 31 minutes with a 30 minute limit, though the access token has not expired');
  assert.equal(app.api.db.prepare('SELECT revoked_reason FROM iam_sessions WHERE public_id = ?').get(a.session.id).revoked_reason, 'idle');

  const b = (await app.login('pooja')).json.data;
  const started = app.clock.t;
  let token = b.refreshToken;
  let status = 200;
  for (let i = 0; i < 40 && status === 200; i += 1) {
    app.clock.t += 25 * 60_000; // always active inside the idle window
    const r = await app.http('POST', `${C}/auth/refresh`, { body: { refreshToken: token } });
    status = r.status;
    if (status === 200) token = r.json.data.refreshToken;
  }
  assert.equal(status, 401, 'past the absolute limit of 12 hours, even though it was never idle');
  assert.ok(app.clock.t - started > 12 * 3_600_000 && app.clock.t - started <= 12 * 3_600_000 + 25 * 60_000);
  assert.equal(app.api.db.prepare('SELECT revoked_reason FROM iam_sessions WHERE public_id = ?').get(b.session.id).revoked_reason, 'expired');

  const c = (await app.login('pooja')).json.data;
  assert.equal((await app.authed(c.accessToken).post(`${C}/auth/logout`, {})).status, 200);
  assert.equal((await who(c.accessToken)).status, 401, 'signing out ends the token that was just issued');

  // the concurrent limit: the oldest session makes room
  app.api.db.prepare('UPDATE iam_auth_policy SET settings_json = ? WHERE company_id = 1').run(JSON.stringify({ session: { accessMinutes: 60, maxConcurrent: 2 } }));
  app.identity.policies.invalidate();
  const s1 = (await app.login('pooja')).json.data;
  app.clock.t += 1000;
  const s2 = (await app.login('pooja')).json.data;
  app.clock.t += 1000;
  const s3 = (await app.login('pooja')).json.data;
  assert.equal((await who(s1.accessToken)).status, 401, 'the oldest was ended');
  assert.equal((await who(s2.accessToken)).status, 200);
  assert.equal((await who(s3.accessToken)).status, 200);
  assert.equal(app.api.db.prepare("SELECT COUNT(*) AS n FROM iam_sessions WHERE revoked_reason = 'concurrent_limit'").get().n, 1);
  await app.close();
});

test('FR-07 / AC-02 people see their own sessions and devices, end the others, and cannot touch anyone else\'s; administrators can force a sign-out', async () => {
  const app = await boot();
  await app.mk('pooja', ['PM']);
  await app.mk('meera', ['PM']);
  const s = await enrolled(app, 'sysadmin');
  app.clock.t += 1000;
  const p1 = (await app.login('pooja', PW, { deviceId: 'phone-device-1', deviceName: 'Pooja phone' })).json.data;
  const p2 = (await app.login('pooja', PW, { deviceId: 'laptop-device-2', deviceName: 'Pooja laptop' })).json.data;
  const m1 = (await app.login('meera')).json.data;
  const pooja = app.authed(p2.accessToken);

  const list = (await pooja.get(`${C}/me/sessions`)).json.data;
  assert.deepEqual(list.map((x) => [x.device, x.current]).sort(), [['Pooja laptop', true], ['Pooja phone', false]]);
  assert.ok(!JSON.stringify(list).includes(m1.session.id), 'only her own');
  assert.equal((await pooja.get(`${C}/me/devices`)).json.data.length, 2);
  assert.equal((await pooja.del(`${C}/me/sessions/${m1.session.id}`)).status, 404, 'cannot end another person\'s session');
  assert.equal((await app.authed(m1.accessToken).get('/api/v1/core/session')).status, 200);

  const out = await pooja.post(`${C}/me/sessions/sign-out-others`, {});
  assert.equal(out.json.data.ended, 1);
  assert.equal((await app.authed(p1.accessToken).get('/api/v1/core/session')).status, 401);
  assert.equal((await pooja.get('/api/v1/core/session')).status, 200, 'the current session stays');

  // administrators
  const admin = app.authed(s.token);
  const all = (await admin.get(`${C}/admin/sessions`)).json;
  assert.ok(all.data.some((x) => x.user === 'meera'));
  const forced = await admin.post(`${C}/admin/sessions/${m1.session.id}/revoke`, { reason: 'lost laptop reported' });
  assert.equal(forced.json.data.ended, 1);
  assert.equal((await app.authed(m1.accessToken).get('/api/v1/core/session')).status, 401, 'forced sign-out is immediate');
  const everything = await admin.post(`${C}/admin/users/pooja/sign-out`, { reason: 'account compromised' });
  assert.equal(everything.json.data.ended, 1);
  assert.equal((await pooja.get('/api/v1/core/session')).status, 401);
  assert.equal(app.api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE action IN ('forced_sign_out', 'forced_sign_out_all')").get().n, 2);
  // devices: forgetting one ends its sessions
  const p3 = (await app.login('pooja', PW, { deviceId: 'phone-device-1', deviceName: 'Pooja phone' })).json.data;
  const devices = (await app.authed(p3.accessToken).get(`${C}/me/devices`)).json.data;
  const phone = devices.find((d) => d.name === 'Pooja phone');
  assert.equal((await app.authed(p3.accessToken).del(`${C}/me/devices/${phone.id}`)).status, 200);
  assert.equal((await app.authed(p3.accessToken).get('/api/v1/core/session')).status, 401);
  await app.close();
});

test('AC-05 who may do what: own account for everyone, security administration for ITADM and SYSADM, nothing across companies, and nothing without a sign-in', async () => {
  const app = await boot();
  const s = await enrolled(app, 'sysadmin');
  await app.mk('pooja', ['PM']);
  const p = (await app.login('pooja')).json.data;
  const pm = app.authed(p.accessToken);
  for (const path of ['/admin/policy', '/admin/sessions', '/admin/users', '/admin/login-events']) {
    assert.equal((await pm.get(C + path)).status, 403, `PM ${path}`);
    assert.equal((await app.authed(s.token).get(C + path)).status, 200, `SYSADM ${path}`);
    assert.equal((await app.http('GET', C + path)).status, 401, `anonymous ${path}`);
  }
  assert.equal((await pm.post(`${C}/admin/users/sysadmin/unlock`, { reason: 'trying it' })).status, 403);
  assert.equal((await pm.post(`${C}/admin/policy/change-requests`, { changes: { session: { idleMinutes: 20 } }, reason: 'trying it' })).status, 403);
  assert.equal((await pm.get(`${C}/me`)).status, 200);
  assert.equal((await app.http('GET', `${C}/me`)).status, 401);
  assert.equal((await app.http('GET', '/api/v1/core/session', { token: 'garbage.token.here' })).status, 401);
  assert.equal((await app.http('GET', '/api/v1/core/session', { headers: { 'x-erp-user': 'sysadmin', 'x-erp-roles': 'SYSADM', 'x-erp-company': '1' } })).status, 401, 'development headers mean nothing in iam mode');

  // another company's administrator sees none of this company's people or events
  app.api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (2, 'other-admin', 'Other', '[\"SYSADM\"]')").run();
  const users = (await app.authed(s.token).get(`${C}/admin/users`)).json.data;
  assert.ok(users.every((u) => u.username !== 'other-admin'));
  assert.equal((await app.authed(s.token).post(`${C}/admin/users/other-admin/unlock`, { reason: 'cross company' })).status, 404);
  assert.equal((await app.authed(s.token).post(`${C}/admin/users/other-admin/sign-out`, { reason: 'cross company' })).status, 404);
  const none = await app.authed(s.token).get(`${C}/admin/sessions?filter[user]=other-admin`);
  assert.equal(none.json.data.length, 0);
  await app.close();
});

test('FR-03 changing a password: policy and history are enforced, other sessions end, and an expired password must be replaced at sign-in', async () => {
  const app = await boot();
  await app.mk('pooja', ['PM'], { email: 'pooja@example.com' });
  const a = (await app.login('pooja')).json.data;
  const b = (await app.login('pooja', PW, { deviceId: 'other-device-1' })).json.data;
  const me = app.authed(a.accessToken);
  const change = (next, current = PW) => me.post(`${C}/auth/password/change`, { currentPassword: current, newPassword: next });
  assert.equal((await change('short')).status, 422);
  assert.equal((await change('Password123')).status, 422);
  assert.equal((await change('pooja-is-great-2026')).status, 422, 'contains the username');
  assert.equal((await change(PW)).status, 422, 'the current password counts as history');
  assert.equal((await change('New-Passw0rd-Alpha', 'not-my-password')).status, 422);
  const ok = await change('New-Passw0rd-Alpha');
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.otherSessionsEnded, 1);
  assert.equal((await app.authed(b.accessToken).get('/api/v1/core/session')).status, 401);
  assert.equal((await me.get('/api/v1/core/session')).status, 200);
  assert.equal((await app.login('pooja', PW)).status, 401, 'the old password no longer works');
  // history of five
  let current = 'New-Passw0rd-Alpha';
  for (const n of ['Second-Passw0rd-Bravo', 'Third-Passw0rd-Charlie', 'Fourth-Passw0rd-Delta', 'Fifth-Passw0rd-Echo']) {
    assert.equal((await change(n, current)).status, 200);
    current = n;
  }
  assert.equal((await change('New-Passw0rd-Alpha', current)).status, 422, 'still one of the last 5');
  assert.equal((await change(PW, current)).status, 200, 'the sixth-oldest may be used again');
  current = PW;

  // expiry: after 90 days the sign-in asks for a new password first
  app.clock.t += 91 * 86_400_000;
  const step = await app.login('pooja', current);
  assert.equal(step.json.data.status, 'password_change_required');
  assert.equal(step.json.data.accessToken, undefined);
  const weak = await app.http('POST', `${C}/auth/password/required-change`, { body: { challengeToken: step.json.data.challengeToken, newPassword: 'short' } });
  assert.equal(weak.status, 422);
  const done = await app.http('POST', `${C}/auth/password/required-change`, { body: { challengeToken: step.json.data.challengeToken, newPassword: 'Brand-New-Passw0rd-Foxtrot', deviceId: 'device-aaaaaaaa' } });
  assert.equal(done.json.data.status, 'ok');
  assert.equal(app.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'iam.password.changed'").get().n >= 7, true);
  await app.close();
});

test('FR-05 forgotten password: the answer never reveals the account, the code works once, and everything signed in is ended', async () => {
  const app = await boot();
  await app.mk('pooja', ['PM'], { email: 'pooja@example.com' });
  const live = (await app.login('pooja')).json.data;
  const ask = (identifier) => app.http('POST', `${C}/auth/password/forgot`, { body: { identifier } });
  const real = await ask('pooja@example.com');
  const fake = await ask('nobody@example.com');
  assert.deepEqual(real.json, fake.json, 'identical answers');
  const mail = sandboxMessages().filter((m) => m.to.includes('pooja@example.com') && /reset code/i.test(m.subject)).at(-1);
  assert.ok(mail, 'the code went to the address on file');
  assert.equal(sandboxMessages().filter((m) => m.to.includes('nobody@example.com')).length, 0);
  const code = /([A-Z0-9]{5}-[A-Z0-9]{5})/.exec(mail.text)[1];
  assert.equal(app.api.db.prepare('SELECT COUNT(*) AS n FROM iam_password_resets WHERE token_hash = ?').get(code).n, 0, 'the code is stored only as a hash');
  const reset = (c, pw = 'Reset-Passw0rd-Golf') => app.http('POST', `${C}/auth/password/reset`, { body: { identifier: 'pooja@example.com', code: c, newPassword: pw } });
  assert.equal((await reset('AAAAA-AAAAA')).status, 422);
  assert.equal((await reset(code, 'short')).status, 422);
  assert.equal((await reset(code)).status, 200);
  assert.equal((await reset(code, 'Another-Passw0rd-Hotel')).status, 422, 'single use');
  assert.equal((await app.authed(live.accessToken).get('/api/v1/core/session')).status, 401, 'the old session ended');
  assert.equal((await app.login('pooja', 'Reset-Passw0rd-Golf')).json.data.status, 'ok');
  // guessing is throttled
  await ask('pooja@example.com');
  for (let i = 0; i < 6; i += 1) await reset('ZZZZZ-ZZZZZ');
  const latest = sandboxMessages().filter((m) => m.to.includes('pooja@example.com') && /reset code/i.test(m.subject)).at(-1);
  assert.equal((await reset(/([A-Z0-9]{5}-[A-Z0-9]{5})/.exec(latest.text)[1], 'Late-Passw0rd-India')).status, 422, 'locked out of guessing, even with the right code');
  await app.close();
});

test('FR-08 / AC-03 login history, and a suspicious-login alert for a new device, a new country and impossible travel', async () => {
  const app = await boot();
  await app.mk('pooja', ['PM'], { email: 'pooja@example.com' });
  const first = await app.login('pooja', PW, { deviceId: 'device-home-1', deviceName: 'Home laptop' }, { country: 'IN' });
  assert.deepEqual(first.json.data.suspicious, [], 'the first sign-in sets the baseline');
  app.clock.t += 3_600_000;
  const second = await app.login('pooja', PW, { deviceId: 'device-new-22', deviceName: 'Hotel PC' }, { country: 'AE' });
  assert.deepEqual(second.json.data.suspicious.map((x) => x.split(' (')[0]), ['new device', 'new country', 'impossible travel']);
  assert.ok(second.json.data.suspicious[2].includes('IN to AE'));
  const calm = await app.login('pooja', PW, { deviceId: 'device-home-1', deviceName: 'Home laptop' }, { country: 'AE' });
  assert.deepEqual(calm.json.data.suspicious, [], 'a known device in a country already seen is not an alert');

  const ev = app.api.db.prepare("SELECT reason, geo_country FROM iam_login_events WHERE result = 'suspicious'").all();
  assert.equal(ev.length, 1);
  assert.match(ev[0].reason, /new device; new country \(AE\); impossible travel/);
  assert.equal(app.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'iam.login.suspicious'").get().n, 1);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(sandboxMessages().some((m) => m.to.includes('pooja@example.com') && /New sign-in/.test(m.subject) && /impossible travel/.test(m.text)), 'the person is told');

  const s = await enrolled(app, 'sysadmin');
  const events = (await app.authed(s.token).get(`${C}/admin/login-events?filter[user]=pooja&pageSize=50`)).json;
  assert.ok(events.meta.total >= 4);
  assert.deepEqual([...new Set(events.data.map((e) => e.result))].sort(), ['success', 'suspicious']);
  assert.equal((await app.authed(s.token).get(`${C}/admin/login-events?filter[result]=suspicious`)).json.data.length, 1);
  assert.equal((await app.authed(s.token).get(`${C}/admin/login-events?filter[result]=bogus&filter[bad]=1`)).status, 400);
  // she sees her own history too
  const fresh = await app.login('pooja', PW, { deviceId: 'device-home-1', deviceName: 'Home laptop' }, { country: 'AE' });
  const mine = (await app.authed(fresh.json.data.accessToken).get(`${C}/me/login-events`)).json.data;
  assert.ok(mine.some((e) => e.result === 'suspicious'));
  // failed attempts against a name that does not exist are in the log, without a user
  await app.login('ghost', 'whatever-123');
  const log = (await app.authed(s.token).get(`${C}/admin/login-events?filter[user]=ghost`)).json.data;
  assert.deepEqual(log.map((e) => [e.result, e.reason]), [['failure', 'unknown user']]);
  await app.close();
});

test('AC-06 the policy changes only through an approved request: the other administrator decides, the requester cannot, and it takes effect and is audited', async () => {
  const app = await boot();
  const sys = await enrolled(app, 'sysadmin');
  await app.mk('ishaan', ['ITADM']);
  const stepIt = await app.login('ishaan');
  const begin = await app.http('POST', `${C}/auth/mfa/enrol/begin`, { body: { challengeToken: stepIt.json.data.challengeToken } });
  const conf = await app.http('POST', `${C}/auth/mfa/enrol/confirm`, { body: { challengeToken: stepIt.json.data.challengeToken, code: app.code(begin.json.data.secret), deviceId: 'device-bbbbbbbb' } });
  const it = app.authed(conf.json.data.accessToken);
  const admin = app.authed(sys.token);

  assert.equal((await it.get(`${C}/admin/policy`)).json.data.settings.session.idleMinutes, 30);
  assert.equal((await it.post(`${C}/admin/policy/change-requests`, { changes: { password: { minLength: 6 } }, reason: 'make it easier' })).status, 400, 'below the floor');
  assert.equal((await it.post(`${C}/admin/policy/change-requests`, { changes: { session: { idleMinutes: 30 } }, reason: 'same as now' })).status, 422);
  assert.equal((await it.post(`${C}/admin/policy/change-requests`, { changes: {}, reason: 'nothing at all' })).status, 400);
  const req = await it.post(`${C}/admin/policy/change-requests`, { changes: { session: { idleMinutes: 20, maxConcurrent: 3 }, lockout: { threshold: 4 } }, reason: 'tighten sessions for the audit' });
  assert.equal(req.status, 201, JSON.stringify(req.json));
  assert.deepEqual(req.json.data.chain, ['SYSADM']);
  assert.equal((await it.post(`${C}/admin/policy/change-requests`, { changes: { session: { idleMinutes: 25 } }, reason: 'a second open request' })).status, 409);
  assert.equal((await it.get(`${C}/admin/policy`)).json.data.settings.session.idleMinutes, 30, 'nothing changes before the decision');
  const act = (token, id) => app.http('POST', `/api/v1/core/change-requests/${id}/act`, { token, headers: idem(), body: { action: 'approve', comment: 'ok' } });
  assert.equal((await act(conf.json.data.accessToken, req.json.data.id)).status, 403, 'the requester cannot decide');
  assert.equal((await act(sys.token, req.json.data.id)).status, 200);
  const p = (await admin.get(`${C}/admin/policy`)).json.data;
  assert.deepEqual([p.settings.session.idleMinutes, p.settings.session.maxConcurrent, p.settings.lockout.threshold, p.settings.password.minLength, p.version], [20, 3, 4, 10, 1]);
  assert.ok(p.history.some((h) => h.action === 'change_approved'));
  assert.equal(app.api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'iam_auth_policy' AND action = 'change_approved'").get().n, 1);
  assert.equal(app.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'iam.policy.changed'").get().n, 1);

  // the new idle limit applies at once
  app.clock.t += 21 * 60_000;
  assert.equal((await admin.get('/api/v1/core/session')).status, 401);
  await app.close();
});

test('FR-10 field mode: a remembered device and a PIN open a session for a field role, never for a privileged one', async () => {
  const app = await boot();
  await app.mk('pooja', ['PM']);
  const s = await enrolled(app, 'sysadmin');
  const first = (await app.login('pooja', PW, { deviceId: 'site-phone-0001', deviceName: 'Site phone', rememberDevice: true })).json.data;
  assert.ok(first.deviceToken, 'a device token is issued when asked for');
  const me = app.authed(first.accessToken);
  const dev = (await me.get(`${C}/me/devices`)).json.data[0];
  assert.equal((await me.post(`${C}/me/devices/${dev.id}/pin`, { pin: '1234' })).status, 422, 'a run of digits');
  assert.equal((await me.post(`${C}/me/devices/${dev.id}/pin`, { pin: '4827' })).status, 200);
  assert.equal((await me.get(`${C}/me/devices`)).json.data[0].hasPin, true);
  assert.ok(!JSON.stringify(app.api.db.prepare('SELECT * FROM iam_devices').all()).includes('4827'), 'the PIN is stored hashed');

  const unlock = (pin, token = first.deviceToken) => app.http('POST', `${C}/auth/pin-unlock`, { body: { deviceToken: token, pin } });
  const ok = await unlock('4827');
  assert.equal(ok.json.data.status, 'ok');
  assert.equal(app.api.db.prepare('SELECT auth_method FROM iam_sessions WHERE public_id = ?').get(ok.json.data.session.id).auth_method, 'pin');
  assert.equal((await app.authed(ok.json.data.accessToken).get('/api/v1/core/session')).json.data.user, 'pooja');
  for (let i = 0; i < 5; i += 1) assert.equal((await unlock('0000')).status, 401);
  assert.equal((await unlock('4827')).status, 401, 'five wrong PINs remove the PIN');
  assert.equal((await me.get(`${C}/me/devices`)).json.data[0].hasPin, false);

  // privileged roles: no PIN, no remembered device, no unlock
  assert.equal((await app.authed(s.token).post(`${C}/me/devices/${(await app.authed(s.token).get(`${C}/me/devices`)).json.data[0].id}/pin`, { pin: '4827' })).status, 422);
  assert.equal((await unlock('4827', 'x'.repeat(43))).status, 401);
  await app.close();
});

test('the first step of sign-in is the same in development mode, and the signed-in routes need an iam session', async () => {
  const api = await startApi({}, { logger: quiet() });
  const cfg = await fetch(`${api.base}${C}/auth/config`).then((r) => r.json());
  assert.equal(cfg.data.mode, 'dev-headers');
  assert.equal((await api.call('GET', `${C}/me`, { roles: 'SYSADM' })).status, 400, 'a development identity has no session to show');
  await api.close();
  const app = await boot();
  const live = await fetch(`${app.api.base}${C}/auth/config`).then((r) => r.json());
  assert.deepEqual([live.data.mode, live.data.passwordMinLength, live.data.rememberDeviceDays, live.data.sso], ['iam', 10, 30, []]);
  await app.close();
});

test('the whole sign-in area behind the session is hidden while ff.iam.p0201 is OFF, but signing in still works', async () => {
  const app = await boot();
  await app.mk('pooja', ['PM']);
  const p = (await app.login('pooja')).json.data;
  app.api.db.prepare("INSERT INTO core_feature_flags (key, description, default_enabled, environment, company_id, enabled, created_by, source_type) VALUES ('ff.iam.p0201', 'x', 0, NULL, 1, 0, 't', 't')").run();
  assert.equal((await app.authed(p.accessToken).get(`${C}/me`)).status, 404);
  assert.equal((await app.authed(p.accessToken).get(`${C}/me/sessions`)).status, 404);
  assert.equal((await app.login('pooja')).json.data.status, 'ok');
  assert.equal((await app.authed(p.accessToken).get('/api/v1/core/session')).status, 200);
  await app.close();
});
