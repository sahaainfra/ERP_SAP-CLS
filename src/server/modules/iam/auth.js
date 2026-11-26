import { createHash, randomInt } from 'node:crypto';
import { localisationOf } from '../../platform/i18n/index.js';
import { transaction } from '../../platform/db/index.js';
import { recordSecurityEvent, writeAudit } from '../../platform/audit/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { HttpError, badRequest, unauthorized, unprocessable } from '../../platform/http/errors.js';
import { hashToken, isBreached, newPublicId, newToken, passwordProblems, signJwt, verifyJwt } from '../../platform/identity/index.js';

const GENERIC = 'Sign-in failed. Check your details and try again. If you have tried several times, wait a few minutes first.';
const MFA_FAILED = 'That code is not right or has expired. Try again.';
const iso = (ms) => new Date(ms).toISOString();
const norm = (s) => String(s ?? '').trim().toLowerCase();
const sha = (s) => createHash('sha256').update(s).digest('hex');
const RESET_MINUTES = 30;

/** Never says which part of the sign-in was wrong (BR-01). */
const failed = (details = []) => new HttpError(401, 'UNAUTHENTICATED', GENERIC, details);

/** `XXXXX-XXXXX` from an alphabet without look-alike characters, for codes people type. */
const typedCode = () => {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const pick = () => Array.from({ length: 5 }, () => a[randomInt(a.length)]).join('');
  return `${pick()}-${pick()}`;
};

/**
 * Sign-in, MFA, token refresh, sign-out and password flows (FR-01 to FR-08). Everything that decides who a person is happens
 * here, in one place: lockout, CAPTCHA, MFA, devices, sessions and the suspicious-login checks.
 */
export function createAuthService({ db, identity, users, mfa, notifier }) {
  /** The translator for a person's own language (part 03.09: messages go out in the language of their recipient). */
  const msg = (user) => { const loc = localisationOf(db); return loc.translator(user.company_id, loc.languageOf({ companyId: user.company_id, userId: user.id, username: user.username })); };
  const { hasher, policies, secret } = identity;
  const now = () => identity.now();

  // ---- the login throttle: the same for a name that exists and one that does not ----
  const getThrottle = (key) => db.prepare('SELECT * FROM iam_login_throttle WHERE key = ?').get(key) ?? null;
  const clearThrottle = (key) => db.prepare('DELETE FROM iam_login_throttle WHERE key = ?').run(key);
  function addFailure(key, policy) {
    const row = getThrottle(key);
    const recent = row && row.last_failed_at && now() - Date.parse(row.last_failed_at) < 86_400_000;
    const count = (recent ? row.failed_count : 0) + 1;
    const { threshold, baseDelayMinutes, maxDelayMinutes } = policy.lockout;
    const lockedUntil = count >= threshold ? iso(now() + Math.min(baseDelayMinutes * 2 ** (count - threshold), maxDelayMinutes) * 60_000) : null;
    db.prepare('INSERT INTO iam_login_throttle (key, failed_count, locked_until, last_failed_at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET failed_count = excluded.failed_count, locked_until = excluded.locked_until, last_failed_at = excluded.last_failed_at')
      .run(key, count, lockedUntil, iso(now()));
    return { count, lockedUntil };
  }
  const isLocked = (row) => Boolean(row?.locked_until && row.locked_until > iso(now()));

  /** @param {{ user?: any, username?: any, result: string, ctx?: { ip?: string, userAgent?: string, country?: string | null, correlationId?: string }, device?: any, reason?: string | null, session?: string | null, companyId?: number | null }} e */
  function record({ user = null, username = null, result, ctx = {}, device = null, reason = null, session = null, companyId = null }) {
    const res = db.prepare('INSERT INTO iam_login_events (company_id, user_id, username_attempted, result, ip, user_agent, device_label, device_fingerprint, geo_country, reason, session_public_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(user?.company_id ?? companyId, user?.id ?? null, user ? user.username : String(username ?? '').slice(0, 100), result, ctx.ip ?? null, (ctx.userAgent ?? '').slice(0, 300), device?.name ?? null, device?.fingerprint ?? null, ctx.country ?? null, reason, session, iso(now()));
    // failed attempts are also security events (part 02.06); successes, lockouts and token reuse arrive as domain events
    const failed = { failure: 'login.failure', mfa_failed: 'mfa.failed', pin_failed: 'pin.failed' }[result];
    if (failed) recordSecurityEvent(db, { companyId: user?.company_id ?? companyId, userId: user?.id ?? null, username: user ? user.username : String(username ?? '').slice(0, 100), type: failed, severity: 'WARNING', details: { reason }, ip: ctx.ip ?? null, correlationId: ctx.correlationId ?? null, sourceType: 'iam_login_events', sourceId: Number(res.lastInsertRowid), occurredAt: iso(now()) });
  }

  // ---- CAPTCHA after a few failures (FR-04): a signed sum, no third party ----
  const captchaMark = (answer) => sha(`${secret}:captcha:${answer}`);
  const captcha = {
    issue() {
      const a = randomInt(10, 60);
      const b = randomInt(10, 60);
      return { token: signJwt({ t: 'captcha', h: captchaMark(a + b) }, secret, { expiresInSec: 300, nowMs: now() }), question: `What is ${a} + ${b}?` };
    },
    check: (token, answer) => {
      const claims = verifyJwt(token, secret, { type: 'captcha', nowMs: now() });
      return Boolean(claims) && claims.h === captchaMark(Number(String(answer ?? '').trim()));
    },
  };

  const challenge = (step, user, device, policy, extra = {}) =>
    signJwt({ t: 'challenge', step, uid: user.id, dev: device, ...extra }, secret, { expiresInSec: policy.mfa.challengeMinutes * 60, nowMs: now() });
  function openChallenge(token, steps) {
    const c = verifyJwt(token, secret, { type: 'challenge', nowMs: now() });
    if (!c || !steps.includes(c.step)) throw unauthorized('That sign-in step has expired. Start again.');
    const user = users.byId(c.uid);
    if (!user || user.status !== 'ACTIVE') throw unauthorized('That sign-in step has expired. Start again.');
    return { claims: c, user, policy: policies.for(user.company_id), device: c.dev };
  }

  const deviceOf = (body) => {
    const id = String(body.deviceId ?? '').trim();
    return id.length >= 8 && id.length <= 100 ? { fingerprint: sha(id), name: String(body.deviceName ?? 'Unnamed device').slice(0, 80), platform: String(body.platform ?? '').slice(0, 40) } : { fingerprint: sha(`anonymous:${body.deviceName ?? ''}`), name: String(body.deviceName ?? 'Unnamed device').slice(0, 80), platform: String(body.platform ?? '').slice(0, 40), anonymous: true };
  };

  const rolesOf = (user) => JSON.parse(user.roles_json);
  const privileged = (user, policy) => policy.mfa.enforced && rolesOf(user).some((r) => policy.mfa.requiredRoles.includes(r));

  function trustedDevice(user, deviceToken, device) {
    if (!deviceToken) return null;
    const row = db.prepare('SELECT * FROM iam_devices WHERE user_id = ? AND token_hash = ? AND is_active = 1').get(user.id, hashToken(deviceToken));
    return row && row.trusted_until && row.trusted_until > iso(now()) && row.device_fingerprint === device.fingerprint ? row : null;
  }

  /** Decide the next step after the password is right: change it, enrol/verify MFA, or sign in. */
  async function proceed(user, cred, policy, body, device, ctx, { mfaDone = false, passwordChecked = false } = {}) {
    if (!passwordChecked && (cred.must_change === 1 || (cred.expires_at && cred.expires_at <= iso(now())))) {
      return { status: 'password_change_required', challengeToken: challenge('password', user, device, policy), message: cred.must_change === 1 ? 'Choose a new password to continue.' : 'Your password has expired. Choose a new one to continue.' };
    }
    if (!mfaDone) {
      const factors = mfa.verifiedFactors(user.id);
      const trusted = trustedDevice(user, body.deviceToken, device);
      const strict = privileged(user, policy) && !policy.mfa.rememberForPrivileged;
      if (factors.length === 0 && privileged(user, policy)) {
        record({ user, result: 'mfa_required', ctx, device, reason: 'enrolment required' });
        return { status: 'mfa_enrolment_required', challengeToken: challenge('enrol', user, device, policy, { remember: Boolean(body.rememberDevice) }), message: 'Your role needs a second step. Set up an authenticator app to continue.' };
      }
      if (factors.length > 0 && !(trusted && !strict)) {
        record({ user, result: 'mfa_required', ctx, device });
        return { status: 'mfa_required', challengeToken: challenge('mfa', user, device, policy, { remember: Boolean(body.rememberDevice) }), factors: factors.map((f) => ({ id: f.id, type: f.type, hint: f.type === 'totp' ? null : `ends ${String(f.phone).slice(-3)}` })).concat(mfa.hasBackupCodes(user.id) ? [{ id: 0, type: 'backup', hint: null }] : []) };
      }
      return finish(user, policy, body, device, ctx, { mfa: Boolean(trusted), method: 'password', remember: Boolean(body.rememberDevice) });
    }
    return finish(user, policy, body, device, ctx, { mfa: true, method: 'password' });
  }

  /** Create the session and tokens, remember the device, run the suspicious-login checks. */
  async function finish(user, policy, body, device, ctx, { mfa: mfaUsed, method, remember = false }) {
    const stamp = iso(now());
    const prior = db.prepare("SELECT geo_country, device_fingerprint, at FROM iam_login_events WHERE user_id = ? AND result = 'success' ORDER BY id DESC LIMIT 50").all(user.id);
    const known = db.prepare('SELECT * FROM iam_devices WHERE user_id = ? AND device_fingerprint = ? AND is_active = 1').get(user.id, device.fingerprint);
    const reasons = [];
    if (prior.length > 0) {
      if (policy.alerts.newDevice && !known) reasons.push('new device');
      const countries = prior.map((p) => p.geo_country).filter(Boolean);
      if (policy.alerts.newCountry && ctx.country && countries.length > 0 && !countries.includes(ctx.country)) reasons.push(`new country (${ctx.country})`);
      const last = prior.find((p) => p.geo_country);
      if (policy.alerts.impossibleTravelHours > 0 && ctx.country && last && last.geo_country !== ctx.country && now() - Date.parse(last.at) < policy.alerts.impossibleTravelHours * 3_600_000) {
        reasons.push(`impossible travel (${last.geo_country} to ${ctx.country} in ${Math.max(1, Math.round((now() - Date.parse(last.at)) / 60_000))} minutes)`);
      }
    }
    let deviceToken = null;
    const out = transaction(db, () => {
      let deviceId = known?.id ?? null;
      const rememberDays = remember && (!privileged(user, policy) || policy.mfa.rememberForPrivileged) ? policy.mfa.rememberDeviceDays : 0;
      if (known) {
        db.prepare('UPDATE iam_devices SET last_seen_at = ?, name = ? WHERE id = ?').run(stamp, device.name, known.id);
      } else {
        deviceId = Number(db.prepare('INSERT INTO iam_devices (company_id, user_id, device_fingerprint, name, platform, last_seen_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(user.company_id, user.id, device.fingerprint, device.name, device.platform, stamp, user.username, 'login').lastInsertRowid);
      }
      if (rememberDays > 0) {
        deviceToken = newToken();
        db.prepare('UPDATE iam_devices SET token_hash = ?, trusted_until = ? WHERE id = ?').run(hashToken(deviceToken), iso(now() + rememberDays * 86_400_000), deviceId);
      }
      // the concurrent-session limit: the least recently used session makes room
      const live = db.prepare('SELECT id, public_id FROM iam_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at').all(user.id, stamp);
      for (const old of live.slice(0, Math.max(0, live.length - policy.session.maxConcurrent + 1))) {
        db.prepare("UPDATE iam_sessions SET revoked_at = ?, revoked_reason = 'concurrent_limit', revoked_by = 'system' WHERE id = ?").run(stamp, old.id);
        publishEvent(db, { type: 'iam.session.revoked', entity: 'session', entityId: old.public_id, actorId: user.username, companyId: user.company_id, data: { reason: 'concurrent_limit' } });
      }
      const publicId = newPublicId();
      const sessionId = Number(db.prepare('INSERT INTO iam_sessions (public_id, company_id, user_id, device_id, ip, user_agent, auth_method, mfa_at, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(publicId, user.company_id, user.id, deviceId, ctx.ip ?? null, (ctx.userAgent ?? '').slice(0, 300), method, mfaUsed ? stamp : null, stamp, stamp, iso(now() + policy.session.absoluteHours * 3_600_000)).lastInsertRowid);
      const refreshToken = newToken();
      db.prepare('INSERT INTO iam_refresh_tokens (session_id, token_hash) VALUES (?, ?)').run(sessionId, hashToken(refreshToken));
      db.prepare('UPDATE iam_users SET last_login_at = ? WHERE id = ?').run(stamp, user.id);
      db.prepare('UPDATE iam_credentials SET failed_count = 0, locked_until = NULL WHERE user_id = ?').run(user.id);
      record({ user, result: 'success', ctx, device, session: publicId, reason: method === 'pin' ? 'pin unlock' : null });
      publishEvent(db, { type: 'iam.login.succeeded', entity: 'session', entityId: publicId, actorId: user.username, companyId: user.company_id, data: { method, mfa: Boolean(mfaUsed) } });
      if (reasons.length) {
        record({ user, result: 'suspicious', ctx, device, session: publicId, reason: reasons.join('; ') });
        publishEvent(db, { type: 'iam.login.suspicious', entity: 'session', entityId: publicId, actorId: user.username, companyId: user.company_id, data: { reasons } });
      }
      return { publicId, refreshToken };
    });
    if (reasons.length && user.email) {
      const t = msg(user);
      void notifier.email(user.company_id, user.email, t('notify', 'signin.subject'), t('notify', 'signin.body', { reasons: reasons.join(', '), time: stamp, device: device.name }));
    }
    return { status: 'ok', ...issueAccess(user, out.publicId, policy), refreshToken: out.refreshToken, deviceToken, user: users.present(user), session: { id: out.publicId }, suspicious: reasons };
  }

  function issueAccess(user, publicId, policy) {
    const expiresInSec = policy.session.accessMinutes * 60;
    return { accessToken: signJwt({ t: 'access', sid: publicId, uid: user.id }, secret, { expiresInSec, nowMs: now() }), expiresIn: expiresInSec };
  }

  async function setPassword(user, plain, { actor, event }) {
    const policy = policies.for(user.company_id);
    const cred = users.credentials(user.id);
    const history = JSON.parse(cred.history_json);
    let reused = false;
    for (const h of history.slice(-policy.password.historyCount)) if ((await hasher.verify(h, plain)).ok) reused = true;
    const breached = policy.password.breachedCheck === 'hibp' ? await isBreached(plain, identity.fetchImpl) : false;
    const problems = passwordProblems(plain, policy, { username: user.username, email: user.email ?? '', breached, reused });
    if (problems.length) throw unprocessable(`That password cannot be used: ${problems.join(' ')}`, problems.map((message) => ({ field: 'newPassword', message })));
    const hash = await hasher.hash(plain);
    const stamp = iso(now());
    transaction(db, () => {
      db.prepare('UPDATE iam_credentials SET password_hash = ?, algo = ?, changed_at = ?, expires_at = ?, must_change = 0, history_json = ?, failed_count = 0, locked_until = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE user_id = ?')
        .run(hash, 'argon2id', stamp, policy.password.expiryDays ? iso(now() + policy.password.expiryDays * 86_400_000) : null, JSON.stringify([...history, hash].slice(-Math.max(policy.password.historyCount, 5))), actor, stamp, user.id);
      clearThrottle(norm(user.username));
      writeAudit(db, { entity: 'iam_credentials', entityId: user.id, action: event, newValues: { user: user.username }, actor });
      publishEvent(db, { type: 'iam.password.changed', entity: 'user', entityId: user.id, actorId: actor, companyId: user.company_id, data: { how: event } });
    });
  }

  function revokeSessions(userId, { except = null, reason, by }) {
    const rows = db.prepare('SELECT id, public_id, company_id FROM iam_sessions WHERE user_id = ? AND revoked_at IS NULL AND (? IS NULL OR public_id != ?)').all(userId, except, except);
    for (const s of rows) {
      db.prepare('UPDATE iam_sessions SET revoked_at = ?, revoked_reason = ?, revoked_by = ? WHERE id = ?').run(iso(now()), reason, by, s.id);
      publishEvent(db, { type: 'iam.session.revoked', entity: 'session', entityId: s.public_id, actorId: by, companyId: s.company_id, data: { reason } });
    }
    return rows.length;
  }

  const service = {
    captcha,
    revokeSessions,
    setPassword,
    record,
    rolesOf,
    privileged,

    /** Does this sign-in name need a CAPTCHA? Answered from the throttle alone, so it is the same for names that do not exist. */
    captchaFor(username) {
      const user = users.find(username);
      const policy = policies.for(user?.company_id ?? null);
      const th = getThrottle(norm(username));
      return th && th.failed_count >= policy.lockout.captchaAfter ? { required: true, challenge: captcha.issue() } : { required: false };
    },

    async login(body, ctx) {
      const key = norm(body.username);
      const user = users.find(body.username);
      const policy = policies.for(user?.company_id ?? null);
      const device = deviceOf(body);
      const th = getThrottle(key);
      if (th && th.failed_count >= policy.lockout.captchaAfter && !captcha.check(body.captchaToken, body.captchaAnswer)) {
        record({ user, username: body.username, result: 'failure', ctx, device, reason: 'captcha not answered' });
        throw failed([{ field: 'captcha', message: 'Answer the question to continue.' }]);
      }
      if (isLocked(th)) {
        record({ user, username: body.username, result: 'locked', ctx, device, reason: 'sign-in refused while locked' });
        throw failed();
      }
      const cred = user ? users.credentials(user.id) : null;
      let verdict = { ok: false, needsRehash: false };
      if (user && cred && user.status === 'ACTIVE') verdict = await hasher.verify(cred.password_hash, body.password);
      else await hasher.decoy(body.password);
      if (!verdict.ok) {
        const { count, lockedUntil } = addFailure(key, policy);
        if (user && cred) {
          db.prepare('UPDATE iam_credentials SET failed_count = ?, locked_until = ? WHERE user_id = ?').run(count, lockedUntil, user.id);
        }
        record({ user, username: body.username, result: 'failure', ctx, device, reason: !user ? 'unknown user' : user.status !== 'ACTIVE' ? 'account disabled' : 'wrong password' });
        if (lockedUntil && user) {
          record({ user, result: 'locked', ctx, device, reason: `locked until ${lockedUntil}` });
          publishEvent(db, { type: 'iam.account.locked', entity: 'user', entityId: user.id, actorId: 'system', companyId: user.company_id, data: { until: lockedUntil, failures: count } });
        }
        throw failed();
      }
      clearThrottle(key);
      if (verdict.needsRehash) {
        // BR-03: a hash written by the old system (or with weaker settings) is replaced at the first successful login.
        const hash = await hasher.hash(body.password);
        db.prepare('UPDATE iam_credentials SET password_hash = ?, algo = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE user_id = ?').run(hash, 'argon2id', 'system', iso(now()), user.id);
        writeAudit(db, { entity: 'iam_credentials', entityId: user.id, action: 'hash_upgraded', newValues: { from: verdict.algo, to: 'argon2id' }, actor: 'system' });
      }
      return proceed(user, users.credentials(user.id), policy, body, device, ctx);
    },

    /** Second step: a code from the app, a backup code, or a text/WhatsApp code. */
    async verifyMfa(body, ctx) {
      const { claims, user, policy, device } = openChallenge(body.challengeToken, ['mfa']);
      const key = `mfa:${user.id}`;
      if (isLocked(getThrottle(key))) throw unauthorized(MFA_FAILED);
      const ok = await mfa.check(user, body.method, body.code, body.factorId, now());
      if (!ok) {
        const { lockedUntil } = addFailure(key, policy);
        record({ user, result: 'mfa_failed', ctx, device, reason: lockedUntil ? 'locked after repeated wrong codes' : body.method });
        throw unauthorized(MFA_FAILED);
      }
      clearThrottle(key);
      return finish(user, policy, body, device, ctx, { mfa: true, method: 'password', remember: Boolean(body.rememberDevice ?? claims.remember) });
    },

    /** Send a one-time code to the text or WhatsApp factor chosen on the second step. */
    async sendMfaCode(body) {
      const { user } = openChallenge(body.challengeToken, ['mfa']);
      return mfa.sendCode(user, body.factorId);
    },

    /** Enrolment during sign-in (a privileged role with no factor yet): begin, then confirm, which also completes the sign-in. */
    enrolBegin(body) {
      const { user } = openChallenge(body.challengeToken, ['enrol']);
      return mfa.totpBegin(user);
    },
    async enrolConfirm(body, ctx) {
      const { claims, user, policy, device } = openChallenge(body.challengeToken, ['enrol']);
      const key = `mfa:${user.id}`;
      if (isLocked(getThrottle(key))) throw unauthorized(MFA_FAILED);
      const result = mfa.totpConfirm(user, body.code, now());
      if (!result) {
        addFailure(key, policy);
        record({ user, result: 'mfa_failed', ctx, device, reason: 'enrolment code' });
        throw unauthorized(MFA_FAILED);
      }
      clearThrottle(key);
      const login = await finish(user, policy, body, device, ctx, { mfa: true, method: 'password', remember: Boolean(body.rememberDevice ?? claims.remember) });
      return { ...login, backupCodes: result.backupCodes };
    },

    /** A forced or expired password change, before the session exists. */
    async changeRequiredPassword(body, ctx) {
      const { user, policy, device } = openChallenge(body.challengeToken, ['password']);
      await setPassword(user, body.newPassword, { actor: user.username, event: 'password_changed' });
      record({ user, result: 'password_changed', ctx, device, reason: 'required change' });
      return proceed(user, users.credentials(user.id), policy, body, device, ctx, { passwordChecked: true });
    },

    /** A new access token for a live refresh token; the refresh token is replaced each time and reuse of an old one ends the session (T-02). */
    refresh(refreshToken, ctx) {
      const row = refreshToken ? db.prepare('SELECT t.id, t.status, t.session_id, s.public_id, s.user_id, s.company_id, s.expires_at, s.last_seen_at, s.revoked_at FROM iam_refresh_tokens t JOIN iam_sessions s ON s.id = t.session_id WHERE t.token_hash = ?').get(hashToken(refreshToken)) : null;
      if (!row) throw unauthorized('Your sign-in has expired. Sign in again.');
      const user = users.byId(row.user_id);
      const stamp = iso(now());
      if (row.status === 'USED') {
        if (!row.revoked_at) {
          transaction(db, () => {
            db.prepare("UPDATE iam_sessions SET revoked_at = ?, revoked_reason = 'refresh_reuse', revoked_by = 'system' WHERE id = ?").run(stamp, row.session_id);
            record({ user, result: 'refresh_reuse', ctx, session: row.public_id, reason: 'an old refresh token was presented again; the session was ended' });
            publishEvent(db, { type: 'iam.refresh.reuse_detected', entity: 'session', entityId: row.public_id, actorId: 'system', companyId: row.company_id, data: {} });
            publishEvent(db, { type: 'iam.session.revoked', entity: 'session', entityId: row.public_id, actorId: 'system', companyId: row.company_id, data: { reason: 'refresh_reuse' } });
          });
        }
        throw unauthorized('Your sign-in is no longer valid. Sign in again.');
      }
      const policy = policies.for(row.company_id);
      if (row.revoked_at || !user || user.status !== 'ACTIVE' || row.expires_at <= stamp || now() - Date.parse(row.last_seen_at) > policy.session.idleMinutes * 60_000) {
        if (!row.revoked_at) db.prepare("UPDATE iam_sessions SET revoked_at = ?, revoked_reason = 'expired', revoked_by = 'system' WHERE id = ?").run(stamp, row.session_id);
        throw unauthorized('You were signed out because the session timed out. Sign in again.');
      }
      const next = newToken();
      transaction(db, () => {
        db.prepare('UPDATE iam_refresh_tokens SET status = ?, used_at = ? WHERE id = ?').run('USED', stamp, row.id);
        db.prepare('INSERT INTO iam_refresh_tokens (session_id, token_hash) VALUES (?, ?)').run(row.session_id, hashToken(next));
        db.prepare('UPDATE iam_sessions SET last_seen_at = ? WHERE id = ?').run(stamp, row.session_id);
      });
      return { status: 'ok', ...issueAccess(user, row.public_id, policy), refreshToken: next, user: users.present(user), session: { id: row.public_id } };
    },

    logout(actor, ctx) {
      if (!actor?.sessionId) return { ok: true };
      db.prepare("UPDATE iam_sessions SET revoked_at = ?, revoked_reason = 'logout', revoked_by = ? WHERE public_id = ? AND revoked_at IS NULL").run(iso(now()), actor.user, actor.sessionId);
      record({ user: users.byId(actor.userId), result: 'logout', ctx, session: actor.sessionId });
      return { ok: true };
    },

    /** The refresh token alone is enough to sign out (the access token may already be gone). */
    logoutByRefresh(refreshToken, ctx) {
      const row = refreshToken ? db.prepare('SELECT s.public_id, s.user_id FROM iam_refresh_tokens t JOIN iam_sessions s ON s.id = t.session_id WHERE t.token_hash = ?').get(hashToken(refreshToken)) : null;
      if (row) {
        db.prepare("UPDATE iam_sessions SET revoked_at = ?, revoked_reason = 'logout', revoked_by = 'user' WHERE public_id = ? AND revoked_at IS NULL").run(iso(now()), row.public_id);
        record({ user: users.byId(row.user_id), result: 'logout', ctx, session: row.public_id });
      }
      return { ok: true };
    },

    async changePassword(actor, body, ctx) {
      const user = users.byId(actor.userId);
      if (!user) throw badRequest('Password change needs a signed-in user.');
      const cred = users.credentials(user.id);
      if (!(await hasher.verify(cred.password_hash, body.currentPassword)).ok) {
        throw new HttpError(422, 'BUSINESS_RULE', 'The current password is not right.', [{ field: 'currentPassword', message: 'The current password is not right.' }]);
      }
      await setPassword(user, body.newPassword, { actor: user.username, event: 'password_changed' });
      const ended = revokeSessions(user.id, { except: actor.sessionId, reason: 'password_changed', by: user.username });
      record({ user, result: 'password_changed', ctx, session: actor.sessionId, reason: `${ended} other session(s) ended` });
      return { changed: true, otherSessionsEnded: ended };
    },

    /** Always the same answer, whether or not the account exists (BR-01). The code goes to the email address on file. */
    async forgotPassword(body, ctx) {
      const user = users.find(body.identifier);
      const sent = { sent: true, message: 'If that account exists, a reset code has been sent to its email address. It works for 30 minutes.' };
      if (!user || user.status !== 'ACTIVE' || !user.email) {
        await hasher.decoy('decoy');
        return sent;
      }
      const code = typedCode();
      db.prepare('UPDATE iam_password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(iso(now()), user.id);
      db.prepare('INSERT INTO iam_password_resets (user_id, token_hash, expires_at, ip, created_at) VALUES (?, ?, ?, ?, ?)').run(user.id, hashToken(code), iso(now() + RESET_MINUTES * 60_000), ctx.ip ?? null, iso(now()));
      const t = msg(user);
      await notifier.email(user.company_id, user.email, t('notify', 'reset.subject'), t('notify', 'reset.body', { code, minutes: RESET_MINUTES }));
      return sent;
    },

    async resetPassword(body, ctx) {
      const user = users.find(body.identifier);
      const key = `reset:${norm(body.identifier)}`;
      const policy = policies.for(user?.company_id ?? null);
      const bad = () => new HttpError(422, 'BUSINESS_RULE', 'The reset code is not right or has expired. Ask for a new one.');
      if (isLocked(getThrottle(key))) throw bad();
      const row = user ? db.prepare('SELECT * FROM iam_password_resets WHERE user_id = ? AND token_hash = ? AND used_at IS NULL AND expires_at > ?').get(user.id, hashToken(String(body.code ?? '').trim().toUpperCase()), iso(now())) : null;
      if (!row || user.status !== 'ACTIVE') {
        addFailure(key, policy);
        throw bad();
      }
      await setPassword(user, body.newPassword, { actor: user.username, event: 'password_reset' });
      db.prepare('UPDATE iam_password_resets SET used_at = ? WHERE id = ?').run(iso(now()), row.id);
      clearThrottle(key);
      revokeSessions(user.id, { reason: 'password_reset', by: user.username });
      record({ user, result: 'password_reset', ctx, reason: 'reset code used' });
      return { reset: true };
    },

    /** Field mode (FR-10): a registered, trusted device and its PIN start a session without the password. Never for roles that need MFA. */
    async pinUnlock(body, ctx) {
      const dev = body.deviceToken ? db.prepare('SELECT * FROM iam_devices WHERE token_hash = ? AND is_active = 1').get(hashToken(body.deviceToken)) : null;
      const user = dev ? users.byId(dev.user_id) : null;
      const policy = policies.for(user?.company_id ?? null);
      if (!dev || !user || user.status !== 'ACTIVE' || !dev.pin_hash || !dev.trusted_until || dev.trusted_until <= iso(now()) || privileged(user, policy)) {
        await hasher.decoy(String(body.pin ?? ''));
        throw failed();
      }
      // the try is counted before the (slow) check, in one statement, so tries sent at the same time cannot all read the same count
      const counted = db.prepare('UPDATE iam_devices SET pin_failed = pin_failed + 1 WHERE id = ? AND pin_hash IS NOT NULL AND pin_failed < 5').run(dev.id);
      if (counted.changes !== 1) {
        await hasher.decoy(String(body.pin ?? ''));
        throw failed();
      }
      const ok = (await hasher.verify(dev.pin_hash, String(body.pin))).ok;
      if (!ok) {
        const failures = db.prepare('SELECT pin_failed FROM iam_devices WHERE id = ?').get(dev.id).pin_failed;
        // five wrong PINs remove the PIN: the person has to sign in with the password again
        db.prepare('UPDATE iam_devices SET pin_hash = CASE WHEN ? >= 5 THEN NULL ELSE pin_hash END WHERE id = ?').run(failures, dev.id);
        record({ user, result: 'pin_failed', ctx, device: { name: dev.name, fingerprint: dev.device_fingerprint }, reason: failures >= 5 ? 'PIN removed after 5 wrong tries' : 'wrong PIN' });
        throw failed();
      }
      db.prepare('UPDATE iam_devices SET pin_failed = 0 WHERE id = ?').run(dev.id);
      return finish(user, policy, body, { fingerprint: dev.device_fingerprint, name: dev.name, platform: dev.platform ?? '' }, ctx, { mfa: false, method: 'pin' });
    },
  };
  return service;
}
