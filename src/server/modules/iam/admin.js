import { assertPermission } from '../../platform/auth/index.js';
import { companyScope } from '../../platform/db/scope.js';
import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, notFound, unprocessable } from '../../platform/http/errors.js';
import { likePattern, orderBySql, pageResponse } from '../../platform/pagination/index.js';
import { mergePolicy, policyProblems } from '../../platform/identity/index.js';

const iso = (ms) => new Date(ms).toISOString();

/** An approved change to the authentication policy is applied in the approver's transaction (maker-checker). */
export function createPolicyChangeHandler({ identity }) {
  return {
    apply(db, request, actor) {
      const row = db.prepare('SELECT * FROM iam_auth_policy WHERE company_id = ? AND is_active = 1').get(request.companyId);
      const before = mergePolicy(row ? JSON.parse(row.settings_json) : null);
      const next = mergePolicy(before, request.payload.changes);
      const problems = policyProblems(next);
      if (problems.length) throw unprocessable(`The requested policy is no longer valid: ${problems.join(' ')}`);
      const stamp = iso(Date.now());
      if (row) db.prepare('UPDATE iam_auth_policy SET settings_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(next), actor.user, stamp, row.id);
      else db.prepare("INSERT INTO iam_auth_policy (company_id, settings_json, created_by, source_type) VALUES (?, ?, ?, 'auth_policy')").run(request.companyId, JSON.stringify(next), actor.user);
      writeAudit(db, { entity: 'iam_auth_policy', entityId: request.companyId, action: 'change_approved', oldValues: before, newValues: next, reason: request.reason, actor: actor.user });
      publishEvent(db, { type: 'iam.policy.changed', entity: 'auth_policy', entityId: request.companyId, actorId: actor.user, companyId: request.companyId, data: { requestId: request.id, sections: Object.keys(request.payload.changes) } });
      identity.policies.invalidate(request.companyId);
    },
  };
}

/** The signed-in person's own sessions and devices, and the administrator's view of everyone's (FR-07, FR-08). */
export function createSecurityService({ db, identity, users, auth, mfa, approvals, profileExtras = (/** @type {any} */ _actor) => ({}) }) {
  const now = () => identity.now();
  const company = (actor) => companyScope(actor).params._company_scope;
  const own = (actor) => {
    const u = actor?.userId ? users.byId(actor.userId) : null;
    if (!u) throw badRequest('This needs a signed-in user. It is not available with development headers.');
    return u;
  };
  const sessionRow = (s, currentId) => ({
    id: s.public_id, current: s.public_id === currentId, device: s.device_name ?? null, platform: s.device_platform ?? null, ip: s.ip, userAgent: s.user_agent, method: s.auth_method,
    createdAt: s.created_at, lastSeenAt: s.last_seen_at, expiresAt: s.expires_at, mfa: Boolean(s.mfa_at), ...(s.username ? { user: s.username } : {}),
  });

  return {
    // ---- own account ----
    profile(actor) {
      const u = own(actor);
      const policy = identity.policies.for(u.company_id);
      const cred = users.credentials(u.id);
      return {
        ...users.present(u), ...profileExtras(actor), mfa: mfa.summary(u.id), mfaRequired: auth.privileged(u, policy), passwordChangedAt: cred.changed_at, passwordExpiresAt: cred.expires_at,
        policy: { minPasswordLength: policy.password.minLength, rememberDeviceDays: policy.mfa.rememberDeviceDays, idleMinutes: policy.session.idleMinutes },
      };
    },

    sessions(actor) {
      const u = own(actor);
      return db.prepare('SELECT s.*, d.name AS device_name, d.platform AS device_platform FROM iam_sessions s LEFT JOIN iam_devices d ON d.id = s.device_id WHERE s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > ? ORDER BY s.last_seen_at DESC')
        .all(u.id, iso(now())).map((s) => sessionRow(s, actor.sessionId));
    },

    revokeMine(actor, publicId, ctx) {
      const u = own(actor);
      const s = db.prepare('SELECT * FROM iam_sessions WHERE public_id = ? AND user_id = ? AND revoked_at IS NULL').get(publicId, u.id);
      if (!s) throw notFound('That session does not exist or has already ended.');
      db.prepare("UPDATE iam_sessions SET revoked_at = ?, revoked_reason = 'user', revoked_by = ? WHERE id = ?").run(iso(now()), u.username, s.id);
      auth.record({ user: u, result: 'logout', ctx, session: publicId, reason: 'ended from My Sessions' });
      publishEvent(db, { type: 'iam.session.revoked', entity: 'session', entityId: publicId, actorId: u.username, companyId: u.company_id, data: { reason: 'user' } });
      return { ended: 1, current: publicId === actor.sessionId };
    },

    signOutOthers(actor, ctx) {
      const u = own(actor);
      const ended = auth.revokeSessions(u.id, { except: actor.sessionId, reason: 'user', by: u.username });
      auth.record({ user: u, result: 'forced_logout', ctx, session: actor.sessionId, reason: `signed out ${ended} other session(s)` });
      return { ended };
    },

    devices(actor) {
      const u = own(actor);
      return db.prepare('SELECT * FROM iam_devices WHERE user_id = ? AND is_active = 1 ORDER BY last_seen_at DESC').all(u.id).map((d) => ({
        id: d.id, name: d.name, platform: d.platform, registeredAt: d.registered_at, lastSeenAt: d.last_seen_at, trustedUntil: d.trusted_until && d.trusted_until > iso(now()) ? d.trusted_until : null, hasPin: Boolean(d.pin_hash),
      }));
    },

    forgetDevice(actor, deviceId) {
      const u = own(actor);
      const d = db.prepare('SELECT * FROM iam_devices WHERE id = ? AND user_id = ? AND is_active = 1').get(deviceId, u.id);
      if (!d) throw notFound('That device does not exist.');
      transaction(db, () => {
        db.prepare("UPDATE iam_devices SET is_active = 0, deleted_at = ?, deleted_by = ?, token_hash = NULL, trusted_until = NULL, pin_hash = NULL WHERE id = ?").run(iso(now()), u.username, d.id);
        for (const s of db.prepare('SELECT public_id, company_id FROM iam_sessions WHERE device_id = ? AND revoked_at IS NULL').all(d.id)) {
          db.prepare("UPDATE iam_sessions SET revoked_at = ?, revoked_reason = 'device_removed', revoked_by = ? WHERE public_id = ?").run(iso(now()), u.username, s.public_id);
        }
        writeAudit(db, { entity: 'iam_devices', entityId: d.id, action: 'removed', newValues: { device: d.name }, actor: u.username });
      });
      return { removed: true };
    },

    /** Set the quick-unlock PIN of this device (field mode). Not available to roles that need MFA. */
    async setPin(actor, deviceId, pin) {
      const u = own(actor);
      if (auth.privileged(u, identity.policies.for(u.company_id))) throw unprocessable('A PIN cannot replace the password and second step for your role.');
      const d = db.prepare('SELECT * FROM iam_devices WHERE id = ? AND user_id = ? AND is_active = 1').get(deviceId, u.id);
      if (!d) throw notFound('That device does not exist.');
      if (!d.trusted_until || d.trusted_until <= iso(now())) throw unprocessable('Remember this device when you sign in, then set its PIN.');
      if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) throw unprocessable('Choose a PIN that is not a simple run of digits.');
      db.prepare('UPDATE iam_devices SET pin_hash = ?, pin_failed = 0, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(await identity.hasher.hash(pin), u.username, iso(now()), d.id);
      writeAudit(db, { entity: 'iam_devices', entityId: d.id, action: 'pin_set', newValues: { device: d.name }, actor: u.username });
      return { set: true };
    },

    myEvents(actor) {
      const u = own(actor);
      return db.prepare("SELECT result, ip, device_label, geo_country, reason, at FROM iam_login_events WHERE user_id = ? AND result IN ('success', 'failure', 'locked', 'suspicious', 'mfa_failed', 'refresh_reuse', 'password_changed', 'password_reset') ORDER BY id DESC LIMIT 30").all(u.id)
        .map((e) => ({ result: e.result, ip: e.ip, device: e.device_label, country: e.geo_country, reason: e.reason, at: e.at }));
    },

    // ---- MFA of the signed-in person ----
    totpBegin: (actor) => mfa.totpBegin(own(actor)),
    totpConfirm(actor, code) {
      const r = mfa.totpConfirm(own(actor), code, now());
      if (!r) throw unprocessable('That code is not right. Check the time on your phone and try again.', [{ field: 'code', message: 'That code is not right.' }]);
      return r;
    },
    phoneBegin: (actor, body) => mfa.phoneBegin(own(actor), body),
    phoneConfirm(actor, channel, code) {
      const r = mfa.phoneConfirm(own(actor), channel, code);
      if (!r) throw unprocessable('That code is not right or has expired.', [{ field: 'code', message: 'That code is not right or has expired.' }]);
      return r;
    },
    regenerateBackup: (actor) => mfa.regenerateBackup(own(actor)),
    removeFactor(actor, factorId) {
      const u = own(actor);
      return mfa.remove(u, factorId, { required: auth.privileged(u, identity.policies.for(u.company_id)) });
    },

    // ---- administration ----
    policy(actor) {
      assertPermission(actor, 'iam.security.view');
      const c = company(actor);
      const row = db.prepare('SELECT * FROM iam_auth_policy WHERE company_id = ? AND is_active = 1').get(c);
      const history = db.prepare("SELECT action, actor, reason, at FROM (SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'iam_auth_policy' AND entity_id = ?) ORDER BY at DESC LIMIT 15").all(String(c));
      return { settings: mergePolicy(row ? JSON.parse(row.settings_json) : null), customised: Boolean(row), version: row?.version ?? 0, openRequest: approvals.hasOpen(c, 'auth_policy_change', 'auth_policy', c), history: history.map((h) => ({ ...h })) };
    },

    requestPolicyChange(actor, { changes, reason }) {
      assertPermission(actor, 'iam.security.manage');
      const c = company(actor);
      const stored = db.prepare('SELECT settings_json FROM iam_auth_policy WHERE company_id = ? AND is_active = 1').get(c);
      const current = mergePolicy(stored ? JSON.parse(stored.settings_json) : null);
      const next = mergePolicy(current, changes);
      const problems = policyProblems(next);
      if (problems.length) throw badRequest('The policy is not valid.', problems.map((message) => ({ field: 'policy', message })));
      if (JSON.stringify(next) === JSON.stringify(current)) throw unprocessable('Nothing would change: the requested values are the current ones.');
      if (approvals.hasOpen(c, 'auth_policy_change', 'auth_policy', c)) throw conflict('There is already an open policy change. Decide or withdraw it first.');
      const sections = Object.keys(changes);
      const chain = actor.roles.includes('SYSADM') ? ['ITADM'] : ['SYSADM'];
      return approvals.submit(actor, {
        type: 'auth_policy_change', title: `Change the authentication policy (${sections.join(', ')})`, targetType: 'auth_policy', targetId: c,
        payload: { changes, from: Object.fromEntries(sections.map((s) => [s, current[s]])) }, reason, chain,
      });
    },

    sessionsAll(actor, query) {
      assertPermission(actor, 'iam.security.view');
      const params = { c: company(actor), q: likePattern(query.q), user: query.filters.user ?? null, now: iso(now()) };
      const where = "s.company_id = :c AND s.revoked_at IS NULL AND s.expires_at > :now AND (:user IS NULL OR u.username = :user) AND (u.username LIKE :q ESCAPE '\\' OR COALESCE(s.ip, '') LIKE :q ESCAPE '\\')";
      const from = 'FROM iam_sessions s JOIN iam_users u ON u.id = s.user_id LEFT JOIN iam_devices d ON d.id = s.device_id';
      const total = db.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${where}`).get(params).n;
      const rows = db.prepare(`SELECT s.*, u.username, d.name AS device_name, d.platform AS device_platform ${from} WHERE ${where} ORDER BY s.last_seen_at DESC LIMIT :limit OFFSET :offset`).all({ ...params, limit: query.limit, offset: query.offset });
      return pageResponse(rows.map((s) => sessionRow(s, null)), total, query);
    },

    revokeAny(actor, publicId, { reason }, ctx) {
      assertPermission(actor, 'iam.security.manage');
      const s = db.prepare('SELECT s.*, u.username FROM iam_sessions s JOIN iam_users u ON u.id = s.user_id WHERE s.public_id = ? AND s.company_id = ? AND s.revoked_at IS NULL').get(publicId, company(actor));
      if (!s) throw notFound('That session does not exist or has already ended.');
      transaction(db, () => {
        db.prepare("UPDATE iam_sessions SET revoked_at = ?, revoked_reason = 'forced', revoked_by = ? WHERE id = ?").run(iso(now()), actor.user, s.id);
        auth.record({ user: users.byId(s.user_id), result: 'forced_logout', ctx, session: publicId, reason: `by ${actor.user}: ${reason}` });
        writeAudit(db, { entity: 'iam_sessions', entityId: publicId, action: 'forced_sign_out', newValues: { user: s.username }, reason, actor: actor.user, correlationId: ctx.correlationId });
        publishEvent(db, { type: 'iam.session.revoked', entity: 'session', entityId: publicId, actorId: actor.user, companyId: s.company_id, data: { reason: 'forced' } });
      });
      return { ended: 1 };
    },

    signOutUser(actor, username, { reason }, ctx) {
      assertPermission(actor, 'iam.security.manage');
      const u = users.byUsername(username);
      if (!u || u.company_id !== company(actor)) throw notFound('That user does not exist.');
      return transaction(db, () => {
        const ended = auth.revokeSessions(u.id, { reason: 'forced', by: actor.user });
        auth.record({ user: u, result: 'forced_logout', ctx, reason: `by ${actor.user}: ${reason} (${ended} session(s))` });
        writeAudit(db, { entity: 'iam_users', entityId: u.id, action: 'forced_sign_out_all', newValues: { ended }, reason, actor: actor.user, correlationId: ctx.correlationId });
        return { ended };
      });
    },

    unlock(actor, username, { reason }, ctx) {
      assertPermission(actor, 'iam.security.manage');
      const u = users.byUsername(username);
      if (!u || u.company_id !== company(actor)) throw notFound('That user does not exist.');
      transaction(db, () => {
        db.prepare('UPDATE iam_credentials SET failed_count = 0, locked_until = NULL WHERE user_id = ?').run(u.id);
        db.prepare('DELETE FROM iam_login_throttle WHERE key IN (?, ?)').run(u.username.toLowerCase(), `mfa:${u.id}`);
        writeAudit(db, { entity: 'iam_users', entityId: u.id, action: 'unlocked', reason, actor: actor.user, correlationId: ctx.correlationId });
      });
      return { unlocked: true };
    },

    loginEvents(actor, query) {
      assertPermission(actor, 'iam.security.view');
      const params = {
        c: company(actor), q: likePattern(query.q), user: query.filters.user ?? null, result: query.filters.result ?? null,
        from: query.from ? `${query.from}T00:00:00.000Z` : null, to: query.to ? `${query.to}T23:59:59.999Z` : null,
      };
      const where = "(e.company_id = :c OR e.company_id IS NULL) AND (:user IS NULL OR COALESCE(u.username, e.username_attempted) = :user) AND (:result IS NULL OR e.result = :result) AND (:from IS NULL OR e.at >= :from) AND (:to IS NULL OR e.at <= :to) AND (COALESCE(u.username, e.username_attempted, '') LIKE :q ESCAPE '\\' OR COALESCE(e.ip, '') LIKE :q ESCAPE '\\' OR COALESCE(e.reason, '') LIKE :q ESCAPE '\\')";
      const from = 'FROM iam_login_events e LEFT JOIN iam_users u ON u.id = e.user_id';
      const total = db.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${where}`).get(params).n;
      const order = orderBySql(query.sort, { at: 'e.at', result: 'e.result' }, 'e.id DESC');
      const rows = db.prepare(`SELECT e.*, COALESCE(u.username, e.username_attempted) AS who ${from} WHERE ${where} ${order} LIMIT :limit OFFSET :offset`).all({ ...params, limit: query.limit, offset: query.offset });
      return pageResponse(rows.map((e) => ({ id: e.id, at: e.at, user: e.who, result: e.result, ip: e.ip, country: e.geo_country, device: e.device_label, userAgent: e.user_agent, reason: e.reason, session: e.session_public_id })), total, query);
    },

    usersAll(actor, query) {
      assertPermission(actor, 'iam.security.view');
      const params = { c: company(actor), q: likePattern(query.q), now: iso(now()) };
      const where = "u.company_id = :c AND u.is_active = 1 AND u.deleted_at IS NULL AND (u.username LIKE :q ESCAPE '\\' OR u.display_name LIKE :q ESCAPE '\\')";
      const total = db.prepare(`SELECT COUNT(*) AS n FROM iam_users u WHERE ${where}`).get({ c: params.c, q: params.q }).n;
      const rows = db.prepare(`SELECT u.*, c.locked_until, c.failed_count, c.expires_at AS password_expires_at, (SELECT COUNT(*) FROM iam_mfa_factors f WHERE f.user_id = u.id AND f.type != 'backup' AND f.verified_at IS NOT NULL AND f.is_active = 1) AS factors, (SELECT COUNT(*) FROM iam_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > :now) AS live_sessions FROM iam_users u LEFT JOIN iam_credentials c ON c.user_id = u.id WHERE ${where} ORDER BY u.username LIMIT :limit OFFSET :offset`).all({ ...params, limit: query.limit, offset: query.offset });
      const policy = identity.policies.for(params.c);
      return pageResponse(rows.map((u) => ({
        username: u.username, displayName: u.display_name, roles: JSON.parse(u.roles_json), status: u.status, lastLoginAt: u.last_login_at, mfaEnrolled: u.factors > 0,
        mfaRequired: policy.mfa.enforced && JSON.parse(u.roles_json).some((r) => policy.mfa.requiredRoles.includes(r)), locked: Boolean(u.locked_until && u.locked_until > params.now), liveSessions: u.live_sessions,
      })), total, query);
    },
  };
}
