import { randomUUID } from 'node:crypto';

/**
 * Queue a domain event in the transactional outbox, in the caller's transaction (standards section 3.4).
 * `type` is `<module>.<entity>.<past_tense_verb>`. The payload carries the standard envelope; consumers
 * de-duplicate on eventId. Dispatch to consumers is built in part 01.04.
 */
export function publishEvent(db, { type, entity, entityId, version = null, actorId, companyId = null, projectId = null, siteId = null, data = {}, now = new Date() }) {
  const payload = {
    eventId: randomUUID(),
    occurredAt: now.toISOString(),
    companyId,
    projectId,
    siteId,
    entity,
    entityId: String(entityId),
    version,
    actorId,
    data,
  };
  db.prepare('INSERT INTO core_outbox (event_type, aggregate_id, payload) VALUES (?, ?, ?)').run(type, String(entityId), JSON.stringify(payload));
  return payload;
}
