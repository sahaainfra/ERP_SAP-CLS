import { Router } from 'express';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { createApprovalEngine } from '../../platform/approvals/index.js';
import { createFlagService } from '../core/api.js';
import { eventTypes } from '../../platform/events/index.js';
import { notFound } from '../../platform/http/errors.js';
import { identityOf } from '../../platform/identity/index.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrationsOf } from '../../platform/integrations/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { createPolicyChangeHandler, createSecurityService } from './admin.js';
import { createAuthService } from './auth.js';
import { createMfaService } from './mfa.js';
import { createNotifier } from './notify.js';
import { authRoutes, securityRoutes } from './routes.js';
import { createUserStore } from './users.js';
import { ENTITIES } from './org/entities.js';
import { orgRoutes } from './org/routes.js';
import { createOrgService, orgHandlers } from './org/service.js';

export { orgHandlers };

// Part 02.01: authentication. Events this module publishes:
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required });
const str = { type: 'string' };
/** @type {[string, string, any][]} */
const IAM_EVENTS = [
  ['iam.login.succeeded', 'A person signed in.', obj({ method: str }, ['method'])],
  ['iam.login.suspicious', 'A sign-in looked unusual: a new device, a new country or impossible travel.', obj({ reasons: { type: 'array' } }, ['reasons'])],
  ['iam.account.locked', 'An account was locked after repeated wrong passwords.', obj({ until: str }, ['until'])],
  ['iam.session.revoked', 'A session ended before its time: sign-out, a forced sign-out, the session limit or a security reason.', obj({ reason: str }, ['reason'])],
  ['iam.refresh.reuse_detected', 'An old refresh token was presented again; its session was ended.', obj()],
  ['iam.password.changed', 'A password was changed or reset.', obj({ how: str }, ['how'])],
  ['iam.mfa.enrolled', 'A second step was set up.', obj({ type: str }, ['type'])],
  ['iam.policy.changed', 'The authentication policy was changed after approval.', obj({ sections: { type: 'array' } }, ['sections'])],
];
// Part 02.02: organisation events, <module>.<entity>.<verb>.
const ORG_VERBS = { created: 'was created', updated: 'was changed', deactivated: 'was deactivated', activated: 'was activated' };
const orgData = obj({ code: str }, ['code']);
for (const e of Object.values(ENTITIES)) {
  for (const [verb, text] of Object.entries(ORG_VERBS)) IAM_EVENTS.push([`iam.${e.event}.${verb}`, `A ${e.noun} ${text}.`, orgData]);
}
IAM_EVENTS.push(
  ['iam.project.status_changed', 'A project moved to another status (on hold, resumed, completed or closed).', obj({ code: str, from: str, to: str }, ['code', 'from', 'to'])],
  ['iam.site.geofence_changed', 'The geofence of a site was changed after approval.', obj({ code: str, geofenceType: str }, ['code'])],
  ['iam.department.head_changed', 'The head of a department changed.', obj({ code: str }, ['code'])],
  ['iam.project.manager_changed', 'The project manager of a project changed.', obj({ code: str }, ['code'])],
  ['iam.site.in_charge_changed', 'The in-charge of a site changed.', obj({ code: str }, ['code'])],
);
for (const [type, description, schema] of IAM_EVENTS) eventTypes.define({ type, version: 1, schema, owner: 'iam', description });

integrityRegistry.register({
  technicalTables: ['iam_sessions', 'iam_refresh_tokens', 'iam_login_events', 'iam_login_throttle', 'iam_password_resets'],
  companyOptional: ['org_companies'],
  statuses: {
    iam_users: ['ACTIVE', 'DISABLED'], org_companies: ['ACTIVE', 'INACTIVE'], org_branches: ['ACTIVE', 'INACTIVE'], org_departments: ['ACTIVE', 'INACTIVE'], org_designations: ['ACTIVE', 'INACTIVE'],
    org_projects: ['DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CLOSED'], org_sites: ['DRAFT', 'ACTIVE', 'INACTIVE'], org_locations: ['ACTIVE', 'INACTIVE'], org_cost_centres: ['ACTIVE', 'INACTIVE'],
  },
  uniqueKeys: [{ table: 'org_projects', columns: ['company_id', 'code'] }, { table: 'org_locations', columns: ['company_id', 'code'] }, { table: 'org_designations', columns: ['company_id', 'code'] }],
});

/** The approval handler for authentication policy changes; the shared approval engine (in core) calls it when a request is approved. */
export const policyChangeHandlerFor = (db, config) => createPolicyChangeHandler({ identity: identityOf(db, { authSecret: config.authSecret ?? undefined, vaultKey: config.vaultKey ?? undefined }) });

/** Module "iam": who people are and how they prove it. Until 02.03 it also holds a thin user store (defect D-059). */
export const iam = {
  code: 'iam',
  name: 'Identity, Organisation, Security & Access Control',
  routePrefix: '/api/v1/iam',
  ownerPart: '02.x',
  status: 'Authentication (02.01) and organisation (02.02)',
  tables: ['iam_users', 'iam_credentials', 'iam_mfa_factors', 'iam_devices', 'iam_auth_policy', 'iam_sessions', 'iam_refresh_tokens', 'iam_login_events', 'iam_login_throttle', 'iam_password_resets', 'org_companies', 'org_branches', 'org_departments', 'org_designations', 'org_projects', 'org_sites', 'org_locations', 'org_cost_centres', 'org_assignments'],
  resources: ['auth', 'me', 'admin', 'org'],

  mount(api, { db, config, publicApi }) {
    const identity = identityOf(db, { authSecret: config.authSecret ?? undefined, vaultKey: config.vaultKey ?? undefined });
    const integrations = integrationsOf(db, { vaultKey: config.vaultKey ?? undefined });
    const migrated = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'iam_users'").get());
    const flagService = createFlagService({ db, environment: config.environment });
    const users = createUserStore({ db, identity });
    const notifier = createNotifier({ identity, integrations });
    const mfa = createMfaService({ db, identity, notifier });
    const auth = createAuthService({ db, identity, users, mfa, notifier });
    const idempotentRequired = idempotency(db, { required: true });

    if (migrated) {
      const runtime = runtimeOf(db);
      runtime.jobs.register(
        'iam.session_purge',
        (ctx) => {
          const cut = new Date(identity.now() - 30 * 86_400_000).toISOString();
          const tokens = db.prepare('DELETE FROM iam_refresh_tokens WHERE session_id IN (SELECT id FROM iam_sessions WHERE (revoked_at IS NOT NULL AND revoked_at < ?) OR expires_at < ?)').run(cut, cut).changes;
          const sessions = db.prepare('DELETE FROM iam_sessions WHERE ((revoked_at IS NOT NULL AND revoked_at < ?) OR expires_at < ?) AND id NOT IN (SELECT session_id FROM iam_refresh_tokens)').run(cut, cut).changes;
          const resets = db.prepare('DELETE FROM iam_password_resets WHERE expires_at < ?').run(cut).changes;
          const throttle = db.prepare('DELETE FROM iam_login_throttle WHERE last_failed_at < ?').run(cut).changes;
          const events = db.prepare('DELETE FROM iam_login_events WHERE at < ?').run(new Date(identity.now() - 400 * 86_400_000).toISOString()).changes;
          ctx.log(`Removed ${sessions} sessions (${tokens} tokens), ${resets} reset codes, ${throttle} throttles and ${events} login events past their retention`);
          return { sessions, tokens, resets, throttle, events };
        },
        { maxAttempts: 2, description: 'Deletes ended sessions and their refresh tokens after 30 days, reset codes and throttles after 30 days, and login history after 400 days.' },
      );
      runtime.jobs.register('iam.org_effective_apply', (ctx) => { const r = createOrgService({ db, approvals: null, clock: () => identity.now() }).applyDueAssignments(); ctx.log(`Applied ${r.applied} scheduled organisation change(s)`); return r; }, { maxAttempts: 2, description: 'Applies scheduled changes of department head, project manager and site in-charge whose effective date has come.' });
      runtime.scheduler.define({ code: 'iam.org_effective_daily', cron: '10 0 * * *', jobType: 'iam.org_effective_apply', description: 'Daily application of effective-dated organisation changes (00:10 IST)' });
      runtime.scheduler.define({ code: 'iam.session_purge_daily', cron: '45 3 * * *', jobType: 'iam.session_purge', description: 'Daily clean-up of ended sessions (03:45 IST)' });
    }

    // Sign-in routes: no token yet. AUTH_MODE=iam is the switch that makes them the way in, so the feature flag does not gate them.
    const refreshMaxAgeSec = 72 * 3600;
    publicApi.use('/iam', authRoutes({ auth, config, identity, refreshMaxAgeSec }));

    // Everything behind sign-in is hidden while ff.iam.p0201 is OFF for the company.
    const approvals = createApprovalEngine({ db, handlers: { auth_policy_change: createPolicyChangeHandler({ identity }), ...orgHandlers } });
    const orgService = createOrgService({ db, approvals, clock: () => identity.now() });
    const orgRouter = Router();
    orgRouter.use((req, _res, next) => (flagService.isOn(req.actor, 'ff.iam.p0202') ? next() : next(notFound('The organisation master is not enabled for your company yet (feature flag ff.iam.p0202 is OFF).'))));
    orgRouter.use(orgRoutes(orgService, { idempotentRequired }));
    api.use('/iam/org', orgRouter);
    const service = createSecurityService({ db, identity, users, auth, mfa, approvals });
    const router = Router();
    router.use((req, _res, next) => (req.path.startsWith('/me') || req.path.startsWith('/admin') || req.path === '/auth/password/change' ? (flagService.isOn(req.actor, 'ff.iam.p0201') ? next() : next(notFound('Sign-in management is not enabled for your company yet (feature flag ff.iam.p0201 is OFF).'))) : next()));
    router.use(securityRoutes(service, auth, { idempotentRequired }));
    api.use('/iam', router);
    return { users, auth, mfa, identity, service, orgService };
  },
};

