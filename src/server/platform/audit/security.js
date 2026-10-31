import { currentContext } from '../observability/context.js';

// The security event log (part 02.06, FR-04). Events that matter to security are written to core_security_events in the
// same transaction as the thing that happened. Most come from domain events (`securityTap`, called by publishEvent, so every
// module and parts 02.01 and 02.04 are covered without each calling this); failed authorisation attempts, sign-in failures and
// exports are written by the request pipeline, the sign-in code and the export log.
const ok = new WeakSet();
const available = (db) => {
  if (ok.has(db)) return true;
  const t = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'core_security_events'").get();
  if (t) ok.add(db);
  return Boolean(t);
};

/** @type {Record<string, [string, 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL']>} domain event type -> [security event type, severity] */
export const SECURITY_EVENTS = {
  'iam.login.succeeded': ['login.success', 'INFO'],
  'iam.login.suspicious': ['login.suspicious', 'HIGH'],
  'iam.account.locked': ['account.locked', 'HIGH'],
  'iam.session.revoked': ['session.revoked', 'INFO'],
  'iam.refresh.reuse_detected': ['token.reuse_detected', 'CRITICAL'],
  'iam.password.changed': ['password.changed', 'INFO'],
  'iam.mfa.enrolled': ['mfa.enrolled', 'INFO'],
  'iam.policy.changed': ['policy.changed', 'HIGH'],
  'iam.user.suspended': ['user.suspended', 'WARNING'],
  'iam.user.reactivated': ['user.reactivated', 'WARNING'],
  'iam.user.deactivated': ['user.deactivated', 'WARNING'],
  'iam.user.roles_changed': ['permission.changed', 'HIGH'],
  'iam.role.changed': ['permission.changed', 'HIGH'],
  'iam.assignment.created': ['permission.changed', 'HIGH'],
  'iam.assignment.ended': ['permission.changed', 'WARNING'],
  'iam.sod.rule_changed': ['sod.rule_changed', 'HIGH'],
  'iam.sod.violation_detected': ['sod.violation', 'WARNING'],
  'iam.elevation.requested': ['elevation.requested', 'WARNING'],
  'iam.elevation.started': ['elevation.started', 'HIGH'],
  'iam.elevation.ended': ['elevation.ended', 'INFO'],
  'iam.elevation.revoked': ['elevation.revoked', 'WARNING'],
  'iam.review.closed': ['access_review.closed', 'INFO'],
  'iam.account.dormant_suspended': ['user.dormant_suspended', 'WARNING'],
  'core.audit.tamper_detected': ['audit.tamper_detected', 'CRITICAL'],
};

/**
 * Write one security event (inside the caller's transaction when there is one). `details` must not carry secrets; it is shown
 * to administrators as written.
 */
export function recordSecurityEvent(db, { companyId = null, userId = null, username = null, type, severity = 'INFO', details = {}, ip = null, correlationId = null, sourceType = null, sourceId = null, occurredAt = new Date().toISOString() }) {
  if (!available(db)) return null;
  const ctx = currentContext();
  const res = db.prepare('INSERT OR IGNORE INTO core_security_events (company_id, occurred_at, user_id, username, type, severity, details_json, ip, correlation_id, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(companyId ?? ctx?.companyId ?? null, occurredAt, userId ?? ctx?.userId ?? null, username, type, severity, JSON.stringify(details), ip ?? ctx?.ip ?? null, correlationId ?? ctx?.correlationId ?? null, sourceType, sourceId == null ? null : String(sourceId));
  return res.changes ? Number(res.lastInsertRowid) : null;
}

/** Called by publishEvent for every domain event: those that matter to security are logged with it. */
export function securityTap(db, payload) {
  const map = SECURITY_EVENTS[payload.type];
  if (!map || !available(db)) return;
  const data = payload.data ?? {};
  recordSecurityEvent(db, {
    companyId: payload.companyId, username: data.username ?? data.user ?? (typeof payload.actorId === 'string' ? payload.actorId : null), type: map[0], severity: map[1],
    details: { event: payload.type, entity: payload.entity, entityId: payload.entityId, by: payload.actorId, ...data }, occurredAt: payload.occurredAt,
  });
}
