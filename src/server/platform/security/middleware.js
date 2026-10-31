import { hasPermissionAnywhere } from '../auth/index.js';
import { authzOf } from '../authz/index.js';
import { writeAudit } from '../audit/index.js';
import { forbidden } from '../http/errors.js';
import { parse } from '../validation/index.js';

// The stages of the request pipeline as middleware a route can name (part 02.07, section 6): Authenticate happens for every route in
// the application; a route adds Authorise, Validate and Audit with these. They are what the route policy checks centrally; a module
// that writes a new route can use them directly while its declaration is being written.

/**
 * Authorise: the person needs the permission, and, when `scope` is given, the permission for the record `scope(req)` returns
 * ({ companyId, projectId, siteId, ownerUserId ... }), decided by the permission engine.
 */
export function authorise(permission, { scope = null, db = null } = {}) {
  return (req, _res, next) => {
    try {
      if (!scope) {
        if (!hasPermissionAnywhere(req.actor, permission)) throw forbidden(`Your role does not include ${permission}. Ask a system administrator for access.`);
        return next();
      }
      const record = scope(req);
      const verdict = authzOf(db).check(req.actor, permission, record);
      if (!verdict.allowed) throw forbidden(verdict.reason ?? `Your role does not include ${permission} for this record.`);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/** Validate: the body, query or parameters against a Zod schema; the parsed value replaces them, and unknown fields are refused by strict schemas. */
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    try {
      req[source] = parse(schema, req[source]);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Audit: after a successful answer, write the audit entry for what the route did. `describe(req, res)` returns { entity, entityId, action, newValues?, reason? }. */
export function audit(db, describe) {
  return (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      try {
        const d = describe(req, res);
        if (d) writeAudit(db, { ...d, actor: req.actor?.user ?? 'unknown', companyId: req.actor?.companyId ?? null });
      } catch { /* the audit entry is best effort here; services that must audit do so in their transaction */ }
    });
    next();
  };
}
