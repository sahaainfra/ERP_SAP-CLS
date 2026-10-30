import { forbidden, unauthorized } from '../http/errors.js';

/**
 * Thin adapter until the IAM module (part 02.x) exists (recorded as D-001 in docs/erp/DEFECTS.md).
 * dev-headers mode trusts X-Erp-User, X-Erp-Roles and X-Erp-Company; config.js refuses it
 * in staging and production.
 */
const ROLE_PERMISSIONS = {
  SYSADM: [
    'core.flag.view', 'core.flag.configure', 'core.about.view', 'core.arch.view', 'core.health.view', 'core.integrity.view',
    'core.settings.view', 'core.settings.configure', 'core.fy.view', 'core.fy.configure', 'core.period.request_reopen',
    'core.numbering.view', 'core.numbering.configure', 'core.numbering.issue', 'core.numbering.preview',
    'core.param.view', 'core.param.configure', 'core.holiday.configure', 'core.requests.view', 'core.sample.use',
    'core.events.view', 'core.jobs.view', 'core.schedule.view',
  ],
  ITADM: ['core.flag.view', 'core.about.view', 'core.arch.view', 'core.health.view', 'core.integrity.view', 'core.integrity.run', 'core.param.view', 'core.param.configure_system', 'core.numbering.view',
    'core.events.view', 'core.events.redrive', 'core.events.replay', 'core.jobs.view', 'core.jobs.manage', 'core.schedule.view', 'core.schedule.manage', 'core.requests.view'],
  // Finance: open and close periods, post into a soft-closed period, ask for a reopen, see the settings and the approval requests.
  ACCMGR: ['core.settings.view', 'core.fy.view', 'core.period.manage', 'core.period.request_reopen', 'core.period.post_soft_closed', 'core.numbering.view', 'core.numbering.preview', 'core.requests.view', 'core.sample.use', 'core.param.view'],
  CFO: ['core.settings.view', 'core.fy.view', 'core.period.manage', 'core.period.post_soft_closed', 'core.numbering.view', 'core.numbering.preview', 'core.requests.view', 'core.sample.use', 'core.param.view'],
  DIR: ['core.fy.view', 'core.requests.view'],
  PM: ['core.sample.use', 'core.numbering.preview'],
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

/** Service-layer guard: protects jobs, imports and other modules that call a service without HTTP. Deny by default. */
export function assertPermission(actor, permission) {
  if (!hasPermission(actor, permission)) {
    throw forbidden(`Your role does not include ${permission}. Ask a system administrator for access.`);
  }
}

/** Deny by default. */
export const requirePermission = (permission) => (req, _res, next) => {
  if (hasPermission(req.actor, permission)) return next();
  next(forbidden(`Your role does not include ${permission}. Ask a system administrator for access.`));
};
