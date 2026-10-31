import { createVault } from '../integrations/vault.js';
import { unauthorized } from '../http/errors.js';
import { createPasswordHasher } from './password.js';
import { DEFAULT_POLICY, mergePolicy } from './policy.js';
import { DEV_AUTH_SECRET, hashToken, verifyJwt } from './tokens.js';

export { DEFAULT_POLICY, mergePolicy, policyProblems, passwordProblems, isBreached } from './policy.js';
export { createPasswordHasher } from './password.js';
export { hashToken, newPublicId, newToken, signJwt, verifyJwt } from './tokens.js';

const POLICY_CACHE_MS = 15_000;
const TOUCH_EVERY_MS = 30_000;

/**
 * Who is making this request (FR-06). Every request carrying an access token is checked against its session row, so signing out,
 * a forced sign-out, an idle timeout or a disabled user takes effect on the very next request, not when the token expires.
 */
function createResolver({ db, secret, policyFor, now }) {
  let find = null;
  const lookup = () =>
    (find ??= db.prepare(
      `SELECT s.id, s.public_id, s.user_id, s.company_id, s.last_seen_at, s.expires_at, s.auth_method, u.username, u.roles_json, u.status
     FROM iam_sessions s JOIN iam_users u ON u.id = s.user_id
     WHERE s.public_id = ? AND s.revoked_at IS NULL`,
    ));
  return {
    resolve(token) {
      const claims = verifyJwt(token, secret, { type: 'access', nowMs: now() });
      if (!claims) throw unauthorized('Your sign-in has expired. Sign in again.');
      const s = lookup().get(claims.sid);
      const stamp = new Date(now()).toISOString();
      if (!s || s.status !== 'ACTIVE' || s.user_id !== claims.uid) throw unauthorized('Your sign-in is no longer valid. Sign in again.');
      const policy = policyFor(s.company_id);
      const idleMs = policy.session.idleMinutes * 60_000;
      if (s.expires_at <= stamp || now() - Date.parse(s.last_seen_at) > idleMs) {
        db.prepare("UPDATE iam_sessions SET revoked_at = ?, revoked_reason = ?, revoked_by = 'system' WHERE id = ? AND revoked_at IS NULL").run(stamp, s.expires_at <= stamp ? 'expired' : 'idle', s.id);
        throw unauthorized('You were signed out because the session timed out. Sign in again.');
      }
      if (now() - Date.parse(s.last_seen_at) > TOUCH_EVERY_MS) db.prepare('UPDATE iam_sessions SET last_seen_at = ? WHERE id = ?').run(stamp, s.id);
      return { user: s.username, roles: JSON.parse(s.roles_json), companyId: s.company_id, userId: s.user_id, sessionId: s.public_id, authMethod: s.auth_method };
    },
  };
}

const instances = new WeakMap();

/**
 * The identity services of a database, created once: password hasher, vault for TOTP secrets, policy store and the request
 * resolver. `options` apply the first time only (the application passes the config; tests pass a clock and a cheap hash cost).
 */
export function identityOf(db, options = {}) {
  let i = instances.get(db);
  if (!i) {
    const now = options.now ?? (() => Date.now());
    const secret = options.authSecret ?? DEV_AUTH_SECRET;
    const cache = new Map();
    const hasTable = () => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'iam_auth_policy'").get());
    const policies = {
      /** The policy of a company: stored settings over the defaults. */
      for(companyId) {
        const hit = cache.get(companyId);
        if (hit && now() - hit.at < POLICY_CACHE_MS) return hit.policy;
        const row = hasTable() && companyId != null ? db.prepare('SELECT settings_json FROM iam_auth_policy WHERE company_id = ? AND is_active = 1').get(companyId) : null;
        const policy = row ? mergePolicy(JSON.parse(row.settings_json)) : mergePolicy(null);
        cache.set(companyId, { at: now(), policy });
        return policy;
      },
      invalidate(companyId) {
        if (companyId == null) cache.clear();
        else cache.delete(companyId);
      },
    };
    i = {
      now,
      secret,
      policies,
      defaults: DEFAULT_POLICY,
      hasher: createPasswordHasher({ cost: options.passwordCost }),
      vault: createVault({ secret: options.vaultKey ?? undefined }),
      fetchImpl: options.fetchImpl ?? ((/** @type {any} */ url, /** @type {any} */ init) => globalThis.fetch(url, init)),
      resolver: createResolver({ db, secret, policyFor: (c) => policies.for(c), now }),
      hashToken,
    };
    instances.set(db, i);
  }
  return i;
}
