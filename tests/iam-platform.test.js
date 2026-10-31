import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, pbkdf2Sync, scryptSync } from 'node:crypto';
import { createPasswordHasher } from '../src/server/platform/identity/password.js';
import { DEFAULT_POLICY, isBreached, mergePolicy, passwordProblems, policyProblems } from '../src/server/platform/identity/policy.js';
import { base32Decode, base32Encode, counterAt, newTotpSecret, otpauthUri, totpAt, verifyTotp } from '../src/server/platform/identity/totp.js';
import { hashToken, newToken, signJwt, verifyJwt } from '../src/server/platform/identity/tokens.js';
import { loadConfig } from '../src/server/platform/config/index.js';

const cheap = { memory: 8, passes: 1, parallelism: 1 };
const hasher = createPasswordHasher({ cost: cheap });
const KEY = 'unit-test-signing-key-0123456789abcdef';

test('FR-01 passwords are hashed with Argon2id, salted, and verified in constant time', async () => {
  const a = await hasher.hash('Correct-Horse-9');
  const b = await hasher.hash('Correct-Horse-9');
  assert.match(a, /^\$argon2id\$v=19\$m=8,t=1,p=1\$/);
  assert.notEqual(a, b, 'a random salt each time');
  assert.deepEqual(await hasher.verify(a, 'Correct-Horse-9'), { ok: true, algo: 'argon2id', needsRehash: false });
  assert.equal((await hasher.verify(a, 'correct-horse-9')).ok, false);
  assert.equal((await hasher.verify('$argon2id$garbage', 'x')).ok, false, 'a malformed stored value is a failed login, not a crash');
  const stronger = createPasswordHasher({ cost: { memory: 16, passes: 2, parallelism: 1 } });
  assert.equal((await stronger.verify(a, 'Correct-Horse-9')).needsRehash, true, 'weaker settings are upgraded at the next login');
});

test('T-04 / BR-03 hashes from the system this one replaces still verify and are flagged for upgrade', async () => {
  const salt = Buffer.from('legacy-salt-123456');
  const pbkdf2 = `pbkdf2_sha256$120000$${salt.toString('base64')}$${pbkdf2Sync('Old-Password-1', salt, 120000, 32, 'sha256').toString('base64')}`;
  const scr = `scrypt$16384$8$1$${salt.toString('base64')}$${scryptSync('Old-Password-2', salt, 32, { N: 16384, r: 8, p: 1 }).toString('base64')}`;
  const sha = `sha256$pepper$${createHash('sha256').update('pepperOld-Password-3').digest('hex')}`;
  for (const [stored, plain, algo] of [[pbkdf2, 'Old-Password-1', 'pbkdf2_sha256'], [scr, 'Old-Password-2', 'scrypt'], [sha, 'Old-Password-3', 'sha256']]) {
    assert.deepEqual(await hasher.verify(stored, plain), { ok: true, algo, needsRehash: true }, algo);
    assert.equal((await hasher.verify(stored, `${plain}x`)).ok, false, `${algo} wrong password`);
  }
  assert.equal((await hasher.verify('md5$abc$def', 'x')).ok, false, 'an unknown format never matches');
});

test('FR-02 TOTP matches the RFC 6238 test vectors, tolerates one step of drift and refuses a step used twice', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(totpAt(secret, counterAt(59_000), 8), '94287082');
  assert.equal(totpAt(secret, counterAt(1_111_111_109_000), 8), '07081804');
  assert.deepEqual(base32Decode(secret), Buffer.from('12345678901234567890'));
  const now = 1_700_000_000_000;
  const c = counterAt(now);
  assert.equal(verifyTotp(secret, totpAt(secret, c), { nowMs: now }), c);
  assert.equal(verifyTotp(secret, totpAt(secret, c - 1), { nowMs: now }), c - 1, 'one step late');
  assert.equal(verifyTotp(secret, totpAt(secret, c + 1), { nowMs: now }), c + 1, 'one step early');
  assert.equal(verifyTotp(secret, totpAt(secret, c - 3), { nowMs: now }), null, 'three steps off');
  assert.equal(verifyTotp(secret, totpAt(secret, c), { nowMs: now, lastCounter: c }), null, 'a code cannot be used twice');
  assert.equal(verifyTotp(secret, '12345', { nowMs: now }), null);
  assert.equal(newTotpSecret().length, 32);
  assert.match(otpauthUri({ issuer: 'Construction ERP', account: 'a@b.co', secret }), /^otpauth:\/\/totp\/Construction%20ERP:a%40b\.co\?secret=GEZ.*&issuer=Construction%20ERP/);
});

test('signed tokens: tampering, another type and expiry are all refused', () => {
  const now = 1_700_000_000_000;
  const t = signJwt({ t: 'access', sid: 'abc' }, KEY, { expiresInSec: 60, nowMs: now });
  assert.equal(verifyJwt(t, KEY, { type: 'access', nowMs: now + 1000 }).sid, 'abc');
  assert.equal(verifyJwt(t, KEY, { type: 'challenge', nowMs: now + 1000 }), null, 'an access token is not a challenge');
  assert.equal(verifyJwt(t, KEY, { type: 'access', nowMs: now + 61_000 }), null, 'expired');
  assert.equal(verifyJwt(t, 'another-key-another-key-another-key', { type: 'access', nowMs: now }), null);
  const [h, , s] = t.split('.');
  const forged = `${h}.${Buffer.from(JSON.stringify({ t: 'access', sid: 'evil', exp: 9_999_999_999 })).toString('base64url')}.${s}`;
  assert.equal(verifyJwt(forged, KEY, { nowMs: now }), null);
  assert.equal(verifyJwt('not.a.token', KEY), null);
  const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"t":"access","exp":9999999999}').toString('base64url')}.`;
  assert.equal(verifyJwt(none, KEY), null);
  assert.notEqual(newToken(), newToken());
  assert.equal(hashToken('x'), hashToken('x'));
  assert.equal(hashToken('x').length, 64);
});

test('FR-03 the password policy: length, username, common passwords, breaches and history', () => {
  const policy = mergePolicy(null);
  const bad = (pw, ctx) => passwordProblems(pw, policy, ctx);
  assert.deepEqual(bad('Tr0ub4dor&3xyz'), []);
  assert.match(bad('Short1!')[0], /at least 10/);
  assert.match(bad('Password123')[0] ?? '', /too common|at least/);
  assert.ok(bad('1111111111').some((p) => /common/.test(p)));
  assert.ok(bad('meera.sharma-2026', { username: 'meera.sharma' }).some((p) => /username/.test(p)));
  assert.ok(bad('Tr0ub4dor&3xyz', { breached: true }).some((p) => /breach/.test(p)));
  assert.ok(bad('Tr0ub4dor&3xyz', { reused: true }).some((p) => /reuse/.test(p)));
  assert.equal(bad('x'.repeat(129)).some((p) => /at most 128/.test(p)), true);
});

test('FR-03 the optional breached-password check sends only five characters of the hash and treats a failure as "not breached"', async () => {
  const sha = createHash('sha1').update('Tr0ub4dor&3xyz').digest('hex').toUpperCase();
  const seen = [];
  const fake = async (url) => {
    seen.push(url);
    return { ok: true, text: async () => `0018A45C4D1DEF81644B54AB7F969B88D65:3\r\n${sha.slice(5)}:42\r\nFFF:1` };
  };
  assert.equal(await isBreached('Tr0ub4dor&3xyz', fake), true);
  assert.equal(seen[0], `https://api.pwnedpasswords.com/range/${sha.slice(0, 5)}`, 'only the prefix is sent');
  assert.equal(await isBreached('another-Password-77', async () => ({ ok: true, text: async () => 'ABCDE:1' })), false);
  assert.equal(await isBreached('x', async () => { throw new Error('offline'); }), false);
  assert.equal(await isBreached('x', async () => ({ ok: false })), false);
});

test('the policy validates its own limits, and a partial change keeps every other value', () => {
  assert.deepEqual(policyProblems(mergePolicy(null)), []);
  const merged = mergePolicy(null, { lockout: { threshold: 8 }, session: { idleMinutes: 15 } });
  assert.deepEqual([merged.lockout.threshold, merged.lockout.baseDelayMinutes, merged.session.idleMinutes, merged.session.maxConcurrent], [8, 1, 15, 5]);
  const problems = (changes) => policyProblems(mergePolicy(null, changes));
  assert.match(problems({ password: { minLength: 6 } })[0], /minimum password length/);
  assert.match(problems({ password: { historyCount: 3 } })[0], /last 5/);
  assert.match(problems({ lockout: { threshold: 2 } })[0], /3 to 20/);
  assert.match(problems({ lockout: { captchaAfter: 9 } })[0], /CAPTCHA/);
  assert.match(problems({ mfa: { rememberDeviceDays: 90 } })[0], /0 to 30/);
  assert.match(problems({ session: { idleMinutes: 600 } })[0], /5 to 480/);
  assert.match(problems({ session: { absoluteHours: 1, idleMinutes: 120 } })[0], /at least as long/);
  assert.match(problems({ sso: { enabled: true, providers: [{ id: 'ms', type: 'oidc', issuer: 'http://insecure', clientId: 'abc' }] } })[0], /https issuer/);
  assert.deepEqual(DEFAULT_POLICY.mfa.requiredRoles, ['SYSADM', 'ITADM', 'CFO', 'DIR']);
});

test('configuration: AUTH_MODE=iam needs AUTH_SECRET in staging and production, and is accepted now', () => {
  const base = { DATABASE_PATH: 'x', AUTH_MODE: 'iam', FILE_URL_SECRET: 'f'.repeat(32), VAULT_KEY: 'v'.repeat(32) };
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production' }), /AUTH_SECRET is required/);
  assert.equal(loadConfig({ ...base, NODE_ENV: 'production', AUTH_SECRET: 'a'.repeat(32) }).authMode, 'iam');
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', AUTH_SECRET: 'short' }), /AUTH_SECRET/);
  assert.equal(loadConfig({ ...base, NODE_ENV: 'development' }).authMode, 'iam');
});
