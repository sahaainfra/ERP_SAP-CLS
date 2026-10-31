import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { conflict, unprocessable } from '../../platform/http/errors.js';
import { passwordProblems } from '../../platform/identity/index.js';

/**
 * A thin user store until the user master of part 02.03 exists (defect D-059): just what is needed to sign someone in. It is also
 * the one place that creates users and sets passwords for the administrator tool and for tests.
 */
export function createUserStore({ db, identity }) {
  const present = (u) => ({
    id: u.id, username: u.username, email: u.email, mobile: u.mobile, displayName: u.display_name, roles: JSON.parse(u.roles_json), companyId: u.company_id, status: u.status, lastLoginAt: u.last_login_at,
  });

  /** The profile row of part 02.03: a person created with a role is Active, one without a role is Onboarding. */
  const profile = (id, companyId, roles, actor) => db.prepare("INSERT INTO iam_user_profiles (company_id, user_id, lifecycle, created_by, source_type) VALUES (?, ?, ?, ?, 'user_profile') ON CONFLICT (user_id) DO NOTHING").run(companyId, id, roles.length > 0 ? 'ACTIVE' : 'ONBOARDING', actor);

  const store = {
    present,

    /** Find by username, email or mobile number (FR-01). */
    find(identifier) {
      const id = String(identifier ?? '').trim();
      if (!id) return null;
      return db.prepare('SELECT * FROM iam_users WHERE (username = :id OR email = :id OR mobile = :id) AND is_active = 1 AND deleted_at IS NULL').get({ id }) ?? null;
    },
    byId: (id) => db.prepare('SELECT * FROM iam_users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL').get(id) ?? null,
    byUsername: (name) => db.prepare('SELECT * FROM iam_users WHERE username = ? AND is_active = 1 AND deleted_at IS NULL').get(name) ?? null,
    credentials: (userId) => db.prepare('SELECT * FROM iam_credentials WHERE user_id = ? AND is_active = 1').get(userId) ?? null,

    /** Create a user with a password that meets the policy. `mustChange` makes the first login set a new one. */
    async create({ companyId, username, email = null, mobile = null, displayName, roles, password, mustChange = false, actor = 'system' }) {
      const policy = identity.policies.for(companyId);
      const problems = passwordProblems(password, policy, { username, email: email ?? '' });
      if (problems.length) throw unprocessable(`The password is not acceptable: ${problems.join(' ')}`, problems.map((message) => ({ field: 'password', message })));
      if (store.find(username) || (email && store.find(email)) || (mobile && store.find(mobile))) throw conflict('A user with that username, email or mobile number already exists.');
      const hash = await identity.hasher.hash(password);
      const expires = policy.password.expiryDays ? new Date(identity.now() + policy.password.expiryDays * 86_400_000).toISOString() : null;
      return transaction(db, () => {
        const res = db.prepare('INSERT INTO iam_users (company_id, username, email, mobile, display_name, roles_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(companyId, username, email, mobile, displayName, JSON.stringify(roles), actor, 'iam_user');
        const id = Number(res.lastInsertRowid);
        db.prepare('INSERT INTO iam_credentials (company_id, user_id, password_hash, algo, expires_at, must_change, history_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(companyId, id, hash, 'argon2id', expires, mustChange ? 1 : 0, JSON.stringify([hash]), actor, 'iam_user');
        profile(id, companyId, roles, actor);
        writeAudit(db, { entity: 'iam_users', entityId: id, action: 'create', newValues: { username, roles, companyId }, actor });
        return present(store.byId(id));
      });
    },

    /** Store a password hash exactly as given (used to import users from the system this one replaces: BR-03). */
    importHashed({ companyId, username, email = null, mobile = null, displayName, roles, passwordHash, actor = 'import' }) {
      return transaction(db, () => {
        const res = db.prepare('INSERT INTO iam_users (company_id, username, email, mobile, display_name, roles_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(companyId, username, email, mobile, displayName, JSON.stringify(roles), actor, 'legacy_import');
        const id = Number(res.lastInsertRowid);
        db.prepare('INSERT INTO iam_credentials (company_id, user_id, password_hash, algo, history_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(companyId, id, passwordHash, passwordHash.split('$')[0] || 'legacy', JSON.stringify([]), actor, 'legacy_import');
        profile(id, companyId, roles, actor);
        writeAudit(db, { entity: 'iam_users', entityId: id, action: 'import', newValues: { username, roles, algo: passwordHash.split('$')[0] }, actor });
        return present(store.byId(id));
      });
    },
  };
  return store;
}
