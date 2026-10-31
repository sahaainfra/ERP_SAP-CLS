import { currentCorrelationId } from '../observability/context.js';
/** Append an audit-trail row inside the caller's transaction (who, what, old and new values, why). */
export function writeAudit(db, { entity, entityId, action, oldValues = null, newValues = null, reason = null, actor, correlationId = currentCorrelationId() }) {
  db.prepare(
    `INSERT INTO core_audit_log (entity, entity_id, action, old_values, new_values, reason, actor, correlation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entity,
    String(entityId),
    action,
    oldValues && JSON.stringify(oldValues),
    newValues && JSON.stringify(newValues),
    reason,
    actor,
    correlationId,
  );
}
