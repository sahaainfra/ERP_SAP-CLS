import { forbidden, unauthorized } from './errors.js';

/**
 * Thin adapter until the IAM module (part 02.x) exists (recorded as D-001 in docs/erp/DEFECTS.md).
 * dev-headers mode trusts X-Erp-User, X-Erp-Roles and X-Erp-Company; config.js refuses it
 * in staging and production.
 */
const ROLE_PERMISSIONS = {
  SYSADM: ['core.flag.view', 'core.flag.configure', 'core.about.view'],
  ITADM: ['core.flag.view', 'core.about.view'],
};

export function authenticate(config) {
  return (req, _res, next) => {
    if (config.authMode !== 'dev-headers') return next(unauthorized('No authentication method is available.'));
    const user = req.get('x-erp-user');
    if (!user) return next(unauthorized('Sign in first: no user identity was supplied.'));
    const roles = (req.get('x-erp-roles') ?? '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    const company = Number.parseInt(req.get('x-erp-company') ?? '', 10);
    req.actor = { user, roles, companyId: Number.isInteger(company) ? company : null };
    next();
  };
}

export function permissionsOf(actor) {
  return [...new Set(actor.roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []))].sort();
}

export function hasPermission(actor, permission) {
  return permissionsOf(actor).includes(permission);
}

/** Deny by default. */
export const requirePermission = (permission) => (req, _res, next) => {
  if (hasPermission(req.actor, permission)) return next();
  next(forbidden(`Your role does not include ${permission}. Ask a system administrator for access.`));
};
