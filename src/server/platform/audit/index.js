import { currentContext } from '../observability/context.js';
import { appendChain, hasChain } from './chain.js';
import { diffValues } from './diff.js';

export { backfillChain, hasChain, sealSegments, verifyChain } from './chain.js';
export { diffValues, maskForView } from './diff.js';
export { recordSecurityEvent, securityTap } from './security.js';

/**
 * Append an audit-trail row inside the caller's transaction (who, what, old and new values, why). The row is also chained
 * (part 02.06): it gets a sequence number, the field-level changes with sensitive fields masked, where the request came from
 * and a hash that includes the previous row's hash. `oldValues` and `newValues` are the record before and after (or null).
 */
export function writeAudit(db, { entity, entityId, action, oldValues = null, newValues = null, reason = null, actor, correlationId = currentContext()?.correlationId ?? null, companyId = null, onBehalfOf = null }) {
  const res = db.prepare(
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
  const id = Number(res.lastInsertRowid);
  if (hasChain(db)) {
    const ctx = currentContext();
    appendChain(db, id, {
      companyId: companyId ?? ctx?.companyId ?? null,
      actorId: ctx?.userId ?? null,
      onBehalfOf,
      ip: ctx?.ip ?? null,
      device: ctx?.device ?? null,
      changesJson: JSON.stringify(diffValues(oldValues, newValues)),
    });
  }
  return id;
}

/** The audit service used by every module (FR-01): record(db, entity, id, action, before, after, reason, { actor, companyId, onBehalfOf }). */
export function record(db, entity, id, action, before, after, reason, context = {}) {
  return writeAudit(db, { entity, entityId: id, action, oldValues: before, newValues: after, reason, actor: context.actor ?? 'system', companyId: context.companyId ?? null, onBehalfOf: context.onBehalfOf ?? null, correlationId: context.correlationId });
}
