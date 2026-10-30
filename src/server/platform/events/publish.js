import { randomUUID } from 'node:crypto';
import { currentContext } from '../observability/context.js';
import { formatTraceparent } from '../observability/tracing.js';
import { EventSchemaError, eventTypes } from './registry.js';

/**
 * Queue a domain event in the transactional outbox, in the caller's transaction (standards section 3.4), so the
 * event exists only if the business change commits (BR-01). `type` is `<module>.<entity>.<past_tense_verb>`.
 * `version` is the entity's version when the event was raised (optional, sent as entityVersion).
 * The envelope is: eventId, type, version (the catalogue version of the event), occurredAt, companyId, projectId, siteId, entity, entityId, actorId,
 * correlationId and data. A type declared in the catalogue has its `data` validated and takes the catalogue version;
 * the relay (bus.js) fans the event out to the consumers subscribed to it, which de-duplicate on eventId.
 */
export function publishEvent(db, { type, entity, entityId, version = null, actorId, companyId = null, projectId = null, siteId = null, correlationId = null, data = {}, now = new Date() }) {
  const def = eventTypes.get(type);
  if (def) {
    const problems = eventTypes.validate(type, data);
    if (problems.length) throw new EventSchemaError(type, problems);
  }
  // The event carries the correlation ID and trace of the work that raised it, so its consumers' log lines and spans join them (T-01).
  const ctx = currentContext();
  const payload = {
    eventId: randomUUID(),
    type,
    version: def ? def.version : 1,
    entityVersion: version,
    occurredAt: now.toISOString(),
    companyId,
    projectId,
    siteId,
    entity,
    entityId: String(entityId),
    actorId,
    correlationId: correlationId ?? ctx?.correlationId ?? null,
    traceparent: ctx?.span ? formatTraceparent(ctx.span.traceId, ctx.span.spanId) : null,
    data,
  };
  db.prepare('INSERT INTO core_outbox (event_type, aggregate_id, payload) VALUES (?, ?, ?)').run(type, String(entityId), JSON.stringify(payload));
  return payload;
}
