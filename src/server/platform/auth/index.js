import { forbidden, unauthorized } from '../http/errors.js';

/**
 * Thin adapter until the IAM module (part 02.x) exists (recorded as D-001 in docs/erp/DEFECTS.md).
 * dev-headers mode trusts X-Erp-User, X-Erp-Roles and X-Erp-Company; config.js refuses it
 * in staging and production.
 */
const ROLE_PERMISSIONS = {
  SYSADM: [
    'org.view', 'org.company.manage', 'org.hr.manage',
    'core.flag.view', 'core.flag.configure', 'core.about.view', 'core.arch.view', 'core.health.view', 'core.integrity.view',
    'core.settings.view', 'core.settings.configure', 'core.fy.view', 'core.fy.configure', 'core.period.request_reopen',
    'core.numbering.view', 'core.numbering.configure', 'core.numbering.issue', 'core.numbering.preview',
    'core.param.view', 'core.param.configure', 'core.holiday.configure', 'core.requests.view', 'core.sample.use',
    'core.events.view', 'core.jobs.view', 'core.schedule.view', 'core.files.admin', 'core.files.configure', 'core.calc.view', 'core.calc.manage', 'core.ops.view', 'core.connectors.view', 'iam.security.view', 'iam.security.manage',
  ],
  ITADM: ['org.view', 'core.flag.view', 'core.about.view', 'core.arch.view', 'core.health.view', 'core.integrity.view', 'core.integrity.run', 'core.param.view', 'core.param.configure_system', 'core.numbering.view',
    'core.events.view', 'core.events.redrive', 'core.events.replay', 'core.jobs.view', 'core.jobs.manage', 'core.schedule.view', 'core.schedule.manage', 'core.requests.view', 'core.files.admin', 'core.ops.view', 'core.ops.manage', 'core.connectors.view', 'core.connectors.configure', 'iam.security.view', 'iam.security.manage'],
  // Finance: open and close periods, post into a soft-closed period, ask for a reopen, see the settings and the approval requests.
  ACCMGR: ['org.view', 'org.costcentre.manage', 'core.settings.view', 'core.fy.view', 'core.period.manage', 'core.period.request_reopen', 'core.period.post_soft_closed', 'core.numbering.view', 'core.numbering.preview', 'core.requests.view', 'core.sample.use', 'core.param.view'],
  CFO: ['org.view', 'core.settings.view', 'core.fy.view', 'core.period.manage', 'core.period.post_soft_closed', 'core.numbering.view', 'core.numbering.preview', 'core.requests.view', 'core.sample.use', 'core.param.view'],
  DIR: ['org.view', 'core.fy.view', 'core.requests.view'],
  // Project controls: views the calculation registry and approves new versions of the project formulas.
  // Human resources: departments and designations; asks for geofence changes. Project director: approves activations.
  HRMGR: ['org.view', 'org.hr.manage', 'org.geofence.request', 'core.requests.view'],
  PD: ['org.view', 'org.project.manage', 'org.site.manage', 'core.requests.view'],
  PCMGR: ['org.view', 'org.project.manage', 'org.site.manage', 'core.calc.view', 'core.requests.view'],
  PM: ['org.view', 'org.project.manage', 'org.site.manage', 'org.geofence.request', 'core.sample.use', 'core.numbering.preview'],
};

export function authenticate(config, resolver = null) {
  return (req, _res, next) => {
    if (config.authMode === 'iam') {
      // Part 02.01: a signed access token whose session is still live. The roles come from the user record, never from the token.
      const token = /^Bearer (.+)$/i.exec(req.get('authorization') ?? '')?.[1];
      if (!token) return next(unauthorized('Sign in first: no sign-in token was supplied.'));
      try {
        req.actor = resolver.resolve(token);
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
