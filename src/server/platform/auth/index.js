import { forbidden, unauthorized } from '../http/errors.js';
import { TEMPLATE_PERMISSIONS } from '../authz/templates.js';

/**
 * Thin adapter until the IAM module (part 02.x) exists (recorded as D-001 in docs/erp/DEFECTS.md).
 * dev-headers mode trusts X-Erp-User, X-Erp-Roles and X-Erp-Company; config.js refuses it
 * in staging and production.
 */

/**
 * The permissions of each system role as defined in code (platform/authz/templates.js). Requests carry the engine's computed grants
 * (actor.grants); this table answers for an actor that has none, such as a service call made with a hand-built actor.
 */
const ROLE_PERMISSIONS = TEMPLATE_PERMISSIONS;

/** Every system role code: what a role request may name. */
export const ROLE_CODES = Object.freeze(Object.keys(ROLE_PERMISSIONS));

/**
 * Who is calling. With the role engine (part 02.04) every request's actor is given its computed grants (`actor.grants`: what each of
 * its roles allows and denies, and where) before any route runs; without one the actor is checked against the role templates.
 */
export function authenticate(config, resolver = null, authz = null) {
  return (req, _res, next) => {
    // Part 29.03: the public API gateway has already authenticated an API client (OAuth2 client credentials) and built its service actor
    if (req.apiClient && req.actor) return next();
    if (config.authMode === 'iam') {
      // Part 02.01: a signed access token whose session is still live. The roles come from the user record, never from the token.
      const token = /^Bearer (.+)$/i.exec(req.get('authorization') ?? '')?.[1];
      if (!token) return next(unauthorized('Sign in first: no sign-in token was supplied.'));
      try {
        req.actor = resolver.resolve(token);
        if (authz) authz.enrich(req.actor);
      } catch (err) {
        return next(err);
      }
      return next();
    }
    if (config.authMode !== 'dev-headers') return next(unauthorized('No authentication method is available.'));
    const user = req.get('x-erp-user');
    if (!user) return next(unauthorized('Sign in first: no user identity was supplied.'));
    const roles = (req.get('x-erp-roles') ?? '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    const company = Number.parseInt(req.get('x-erp-company') ?? '', 10);
    req.actor = { user, roles, companyId: Number.isInteger(company) ? company : null };
    if (authz) authz.enrich(req.actor);
    next();
  };
}

/** Every permission the actor holds anywhere, company-wide or only for part of the company (what a menu and a page ask). */
export function permissionsOf(actor) {
  if (actor.grants) return actor.grants.anywhere;
  return [...new Set(actor.roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []))].sort();
}

/** The permissions held for the whole company. A grant scoped to a project or site does not count here: it is honoured only by code that checks the record. */
export const companyPermissionsOf = (actor) => (actor.grants ? actor.grants.perms : permissionsOf(actor));

/** Held for the whole company. Deny by default: this is the check every route that does not look at a record makes. */
export function hasPermission(actor, permission) {
  return companyPermissionsOf(actor).includes(permission);
}

/** Held for the whole company or for part of it: the first question of code that then limits what it shows to the actor's scope. */
export function hasPermissionAnywhere(actor, permission) {
  return permissionsOf(actor).includes(permission);
}

export function assertPermissionAnywhere(actor, permission) {
  if (!hasPermissionAnywhere(actor, permission)) {
    throw forbidden(`Your role does not include ${permission}. Ask a system administrator for access.`);
  }
}

/** Service-layer guard: protects jobs, imports and other modules that call a service without HTTP. Deny by default. */
export function assertPermission(actor, permission) {
  if (!hasPermission(actor, permission)) {
    throw forbidden(`Your role does not include ${permission}. Ask a system administrator for access.`);
  }
}

/** For a route whose service then limits the answer to the actor's scope: held for the whole company or for part of it. */
export const requirePermissionAnywhere = (permission) => (req, _res, next) => {
  if (hasPermissionAnywhere(req.actor, permission)) return next();
  next(forbidden(`Your role does not include ${permission}. Ask a system administrator for access.`));
};

/** Deny by default. */
export const requirePermission = (permission) => (req, _res, next) => {
  if (hasPermission(req.actor, permission)) return next();
  next(forbidden(`Your role does not include ${permission}. Ask a system administrator for access.`));
};
