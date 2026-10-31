import { notFound, unprocessable } from '../http/errors.js';
import { runWithContext } from '../observability/context.js';

/**
 * The pipeline for background work done for a person (part 02.07, FR-02). A job that acts for a user does not run as "system":
 * it builds that person's actor, with the grants the permission engine computes for them now, and runs inside a context that
 * carries their name for the audit trail. Every service guard then applies to the job exactly as it would to the person. The
 * person must still be able to sign in (not suspended or deactivated).
 */
export function createActAs({ db, authz }) {
  return {
    actorFor(userId) {
      const u = db.prepare("SELECT u.id, u.company_id, u.username, u.roles_json, COALESCE(p.lifecycle, 'ACTIVE') AS lifecycle FROM iam_users u LEFT JOIN iam_user_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.is_active = 1").get(userId);
      if (!u) throw notFound('That person does not exist.');
      if (!['ACTIVE', 'ONBOARDING'].includes(u.lifecycle)) throw unprocessable(`${u.username} is ${u.lifecycle.toLowerCase()}, so work cannot be done for them.`);
      const actor = { user: u.username, userId: u.id, companyId: u.company_id, roles: JSON.parse(u.roles_json) };
      return authz.enrich(actor);
    },
    /** Run `fn(actor)` as this person. */
    run(userId, fn) {
      const actor = this.actorFor(userId);
      return runWithContext({ companyId: actor.companyId, userId: actor.userId, actorName: actor.user }, () => fn(actor));
    },
  };
}
