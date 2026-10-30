import { assertPermission } from '../../../platform/auth/index.js';
import { companyScope } from '../../../platform/db/scope.js';
import { envelopeOf } from '../../../platform/events/bus.js';
import { maskPayload } from '../../../platform/events/mask.js';
import { notFound } from '../../../platform/http/errors.js';
import { likePattern, pageResponse } from '../../../platform/pagination/index.js';
import { writeAudit } from '../../../platform/audit/index.js';

const iso = (s) => s;
/** The event log browses the most recent events only: scanning every payload of a large outbox cost over a second at 100,000 rows (baseline, part 01.07). Older events stay for replay (D-045). */
export const EVENT_LOG_WINDOW = 20_000;
const eventScope = "(json_extract(o.payload, '$.companyId') IS NULL OR json_extract(o.payload, '$.companyId') = :c)";

const presentEvent = (o) => {
  const e = envelopeOf(o);
  return {
    id: o.id,
    eventId: e.eventId,
    type: o.event_type,
    version: e.version ?? 1,
    occurredAt: e.occurredAt ?? o.created_at,
    companyId: e.companyId,
    entity: e.entity ?? null,
    entityId: e.entityId ?? o.aggregate_id,
    actorId: e.actorId ?? null,
    correlationId: e.correlationId ?? null,
    published: Boolean(o.published_at),
    publishedAt: iso(o.published_at),
    data: maskPayload(e.data),
  };
};

const presentLetter = (r, outbox) => ({
  id: r.id,
  consumer: r.consumer,
  eventId: r.event_id,
  eventType: r.event_type,
  companyId: r.company_id,
  status: r.status,
  attempts: r.attempts,
  lastError: r.last_error,
  nextAttemptAt: r.next_attempt_at,
  processedAt: r.processed_at,
  resolvedBy: r.resolved_by,
  resolution: r.resolution,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  event: outbox ? presentEvent(outbox) : null,
});

/** Operations console for the event bus: metrics, event log, event catalogue, dead letters, re-drive and replay. */
export function createEventService({ db, bus, jobs }) {
  const companyOf = (actor) => companyScope(actor).params._company_scope;
  const letter = (actor, id) => {
    const row = db.prepare('SELECT * FROM core_inbox WHERE id = ?').get(id);
    const company = companyOf(actor);
    if (!row || (row.company_id !== null && row.company_id !== company)) throw notFound('That dead letter does not exist.');
    return row;
  };

  return {
    metrics(actor) {
      assertPermission(actor, 'core.events.view');
      return bus.metrics({ companyId: companyOf(actor) });
    },

    types(actor) {
      assertPermission(actor, 'core.events.view');
      return db
        .prepare('SELECT type, version, schema_json, owner_module, description FROM core_event_types ORDER BY type, version')
        .all()
        .map((t) => ({ type: t.type, version: t.version, schema: JSON.parse(t.schema_json), owner: t.owner_module, description: t.description }));
    },

    list(actor, query) {
      assertPermission(actor, 'core.events.view');
      const floor = Math.max(0, db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM core_outbox').get().m - EVENT_LOG_WINDOW);
      const params = { c: companyOf(actor), floor, q: likePattern(query.q), type: query.filters.type ?? null, published: query.filters.published === undefined ? null : query.filters.published === 'true' ? 1 : 0 };
      const where = `o.id > :floor AND ${eventScope} AND o.event_type LIKE :q ESCAPE '\\' AND (:type IS NULL OR o.event_type = :type) AND (:published IS NULL OR (o.published_at IS NOT NULL) = :published)`;
      const total = db.prepare(`SELECT COUNT(*) AS n FROM core_outbox o WHERE ${where}`).get(params).n;
      const sort = query.sort[0];
      const column = { id: 'o.id', type: 'o.event_type', occurredAt: 'o.created_at' }[sort?.column] ?? 'o.id';
      const rows = db
        .prepare(`SELECT o.* FROM core_outbox o WHERE ${where} ORDER BY ${column} ${sort?.dir === 'asc' ? 'ASC' : 'DESC'}, o.id DESC LIMIT :limit OFFSET :offset`)
        .all({ ...params, limit: query.limit, offset: query.offset });
      return pageResponse(rows.map(presentEvent), total, query);
    },

    /** Dead letters by default; the status filter also shows discarded and still-retrying rows. */
    dlq(actor, query) {
      assertPermission(actor, 'core.events.view');
      const status = query.filters.status ?? 'DEAD';
      const params = { c: companyOf(actor), status, consumer: query.filters.consumer ?? null };
      const where = "(company_id IS NULL OR company_id = :c) AND status = :status AND (:consumer IS NULL OR consumer = :consumer)";
      const total = db.prepare(`SELECT COUNT(*) AS n FROM core_inbox WHERE ${where}`).get(params).n;
      const rows = db.prepare(`SELECT * FROM core_inbox WHERE ${where} ORDER BY id DESC LIMIT :limit OFFSET :offset`).all({ ...params, limit: query.limit, offset: query.offset });
      const outbox = db.prepare('SELECT * FROM core_outbox WHERE id = ?');
      return pageResponse(rows.map((r) => presentLetter(r, outbox.get(r.outbox_id))), total, query);
    },

    redrive(actor, id, { reason }, correlationId) {
      assertPermission(actor, 'core.events.redrive');
      letter(actor, id);
      return presentLetter(bus.redrive(id, { actor: actor.user, reason, correlationId }));
    },

    discard(actor, id, { reason }, correlationId) {
      assertPermission(actor, 'core.events.redrive');
      letter(actor, id);
      return presentLetter(bus.discard(id, { actor: actor.user, reason, correlationId }));
    },

    /** Queue a replay as a background job; it runs through the consumers with side effects suppressed. */
    replay(actor, { reason, ...params }, correlationId) {
      assertPermission(actor, 'core.events.replay');
      const companyId = companyOf(actor);
      if (params.consumer && !bus.consumers().some((c) => c.name === params.consumer)) throw notFound(`There is no consumer named ${params.consumer}.`);
      const job = jobs.enqueue('core.event_replay', { ...params, companyId }, { createdBy: actor.user, companyId });
      writeAudit(db, { entity: 'core_jobs', entityId: job.id, action: 'replay_requested', newValues: params, reason, actor: actor.user, correlationId });
      return job;
    },

    consumers(actor) {
      assertPermission(actor, 'core.events.view');
      return bus.consumers();
    },
  };
}
