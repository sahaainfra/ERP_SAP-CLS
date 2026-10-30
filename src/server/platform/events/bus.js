import { transaction } from '../db/index.js';
import { writeAudit } from '../audit/index.js';
import { notFound, unprocessable } from '../http/errors.js';
import { log } from '../http/logger.js';
import { currentContext, runWithContext } from '../observability/context.js';
import { metrics } from '../observability/metrics.js';
import { parseTraceparent, tracer } from '../observability/tracing.js';
import { publishEvent } from './publish.js';

const DEFAULT_BACKOFF = (attempt) => Math.min(30_000 * 2 ** (attempt - 1), 3_600_000); // 30 s, 1 min, 2 min ... up to 1 h
const matches = (pattern, type) => pattern === '*' || (pattern.endsWith('.*') ? type.startsWith(pattern.slice(0, -1)) : pattern === type);
const iso = (ms) => new Date(ms).toISOString();

/** The envelope of a stored outbox row. Rows older than the envelope standard (or hand-written ones) get a stable id. */
export function envelopeOf(row) {
  /** @type {any} */
  const payload = (() => {
    try {
      return JSON.parse(row.payload) ?? {};
    } catch {
      return {};
    }
  })();
  return { ...payload, type: row.event_type, eventId: payload.eventId ?? `legacy-${row.id}`, companyId: payload.companyId ?? null, data: payload.data ?? {} };
}

/**
 * The internal event bus over the transactional outbox. Producers call publishEvent inside their transaction; this
 * bus does the rest:
 *   relayOnce    fans each unpublished outbox row out to the consumers subscribed to its type (one inbox row per
 *                consumer and eventId, so the same event is never queued twice) and marks the row published;
 *   deliverOnce  runs due inbox rows; a handler that throws is retried with exponential back-off and, after
 *                `maxAttempts`, becomes a dead letter that an administrator can re-drive or discard;
 *   replay       re-runs history for a type and date range through the consumers' handlers with `replay: true`
 *                and without touching the inbox (BR-03), to rebuild a projection.
 * A handler runs in one transaction together with the update of its inbox row, so its database effects and the
 * "processed" mark commit or roll back together (BR-02). Handlers are synchronous for that reason.
 */
/** @param {{ db: any, now?: () => Date, maxAttempts?: number, backoffMs?: (attempt: number) => number, batchSize?: number }} options */
export function createEventBus({ db, now = () => new Date(), maxAttempts = 5, backoffMs = DEFAULT_BACKOFF, batchSize = 50 }) {
  /** @type {Map<string, { name: string, patterns: string[], handler: Function, maxAttempts: number, reset: Function | null }>} */
  const consumers = new Map();

  const subscribersOf = (type) => [...consumers.values()].filter((c) => c.patterns.some((p) => matches(p, type)));
  const outboxRow = (id) => db.prepare('SELECT * FROM core_outbox WHERE id = ?').get(id);

  /** One try of one inbox row (the body of deliver). */
  function attempt(consumer, row, event) {
    const stamp = iso(now().getTime());
    const started = process.hrtime.bigint();
    try {
      const done = transaction(db, () => {
        const current = db.prepare('SELECT status FROM core_inbox WHERE id = ?').get(row.id);
        if (!current || current.status !== 'PENDING') return false; // processed or resolved elsewhere
        if (!event) throw new Error('The event is no longer in the outbox');
        consumer.handler(event, { db, replay: false, attempt: row.attempts + 1, consumer: consumer.name });
        db.prepare("UPDATE core_inbox SET status = 'PROCESSED', attempts = attempts + 1, processed_at = ?, last_error = NULL, updated_at = ? WHERE id = ?").run(stamp, stamp, row.id);
        return true;
      });
      if (done) {
        metrics.counter('events.processed');
        log.info({ msg: 'event handled', consumer: consumer.name, eventType: row.event_type, eventId: event?.eventId, attempt: row.attempts + 1, durationMs: Math.round(Number(process.hrtime.bigint() - started) / 1e6) });
      }
      return done ? 'processed' : 'skipped';
    } catch (err) {
      const attempts = row.attempts + 1;
      const dead = attempts >= consumer.maxAttempts;
      const message = String(err?.message ?? err).slice(0, 1000);
      db.prepare("UPDATE core_inbox SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ? AND status = 'PENDING'").run(
        dead ? 'DEAD' : 'PENDING',
        attempts,
        message,
        dead ? row.next_attempt_at : iso(now().getTime() + backoffMs(attempts)),
        stamp,
        row.id,
      );
      currentContext()?.span?.end({ status: 'error', attributes: { 'error.message': message } });
      metrics.counter(dead ? 'events.dead_lettered' : 'events.failed');
      (dead ? log.error : log.warn)({ msg: dead ? 'event dead-lettered' : 'event handler failed', consumer: consumer.name, eventType: row.event_type, eventId: event?.eventId, attempt: attempts, error: message });
      if (dead) {
        publishEvent(db, { type: 'core.event.dead_lettered', entity: 'inbox', entityId: row.id, actorId: 'system', companyId: row.company_id, data: { consumer: row.consumer, eventId: row.event_id, eventType: row.event_type, attempts, error: message } });
      }
      return dead ? 'dead' : 'retry';
    }
  }

  const bus = {
    consumers: () => [...consumers.values()].map(({ name, patterns, maxAttempts: m }) => ({ name, patterns, maxAttempts: m })),

    /** Register a consumer. `consumer` is its stable name (the de-duplication key); `reset` empties its projection before a replay. */
    /** @param {string | string[]} pattern @param {Function} handler @param {{ consumer?: string, maxAttempts?: number, reset?: Function | null }} [options] */
    subscribe(pattern, handler, { consumer, maxAttempts: max = maxAttempts, reset = null } = {}) {
      if (!consumer) throw new Error('A consumer needs a name');
      if (typeof handler !== 'function') throw new Error('A consumer needs a handler function');
      const patterns = [].concat(pattern);
      const existing = consumers.get(consumer);
      if (existing) {
        existing.patterns = [...new Set([...existing.patterns, ...patterns])];
        return;
      }
      consumers.set(consumer, { name: consumer, patterns, handler, maxAttempts: max, reset });
    },

    /** Fan unpublished outbox rows out to their consumers. Safe to run from several instances at once. */
    relayOnce(limit = batchSize) {
      const rows = db.prepare('SELECT id FROM core_outbox WHERE published_at IS NULL ORDER BY id LIMIT ?').all(limit);
      let relayed = 0;
      for (const { id } of rows) {
        relayed += transaction(db, () => {
          const row = outboxRow(id);
          if (!row || row.published_at) return 0; // another instance got there first
          const event = envelopeOf(row);
          const stamp = iso(now().getTime());
          for (const c of subscribersOf(row.event_type)) {
            db.prepare(
              `INSERT OR IGNORE INTO core_inbox (consumer, event_id, outbox_id, event_type, company_id, next_attempt_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
            ).run(c.name, event.eventId, row.id, row.event_type, event.companyId, stamp);
          }
          db.prepare('UPDATE core_outbox SET published_at = ? WHERE id = ?').run(stamp, row.id);
          return 1;
        });
      }
      return relayed;
    },

    /** Run due inbox rows once. Returns { processed, failed, dead }. */
    deliverOnce(limit = batchSize) {
      const due = db
        .prepare("SELECT * FROM core_inbox WHERE status = 'PENDING' AND next_attempt_at <= ? ORDER BY id LIMIT ?")
        .all(iso(now().getTime()), limit);
      const out = { processed: 0, failed: 0, dead: 0 };
      for (const row of due) {
        const r = bus.deliver(row);
        if (r === 'processed') out.processed += 1;
        else if (r === 'retry') out.failed += 1;
        else if (r === 'dead') out.dead += 1;
      }
      return out;
    },

    /** Run one inbox row. Returns 'processed', 'retry', 'dead' or 'skipped'. */
    deliver(row) {
      const consumer = consumers.get(row.consumer);
      if (!consumer) return 'skipped'; // another service owns this consumer
      const source = outboxRow(row.outbox_id);
      const event = source ? envelopeOf(source) : null;
      // The consumer works inside the correlation ID and trace of the request that raised the event.
      return runWithContext({ correlationId: event?.correlationId ?? undefined, user: undefined }, () =>
        tracer.withSpan(`consume ${consumer.name}`, { kind: 'consumer', parent: parseTraceparent(event?.traceparent), attributes: { 'messaging.event_type': row.event_type, 'messaging.consumer': consumer.name, 'messaging.attempt': row.attempts + 1 } }, () => attempt(consumer, row, event)),
      );
    },

    /** Relay and deliver until nothing is due (tests, and the worker's single tick). */
    drain({ maxRounds = 20 } = {}) {
      const total = { relayed: 0, processed: 0, failed: 0, dead: 0 };
      for (let i = 0; i < maxRounds; i += 1) {
        const relayed = bus.relayOnce();
        const d = bus.deliverOnce();
        total.relayed += relayed;
        total.processed += d.processed;
        total.failed += d.failed;
        total.dead += d.dead;
        if (relayed === 0 && d.processed + d.failed + d.dead === 0) break;
      }
      return total;
    },

    /** Put a dead letter back in the queue with a fresh attempt count. */
    redrive(id, { actor, reason, correlationId = null }) {
      return transaction(db, () => {
        const row = db.prepare('SELECT * FROM core_inbox WHERE id = ?').get(id);
        if (!row) throw notFound('That dead letter does not exist.');
        if (row.status !== 'DEAD') throw unprocessable(`This event is ${row.status.toLowerCase()}, not dead, so there is nothing to re-drive.`);
        const stamp = iso(now().getTime());
        db.prepare("UPDATE core_inbox SET status = 'PENDING', attempts = 0, next_attempt_at = ?, updated_at = ?, resolved_by = ?, resolution = 'redriven' WHERE id = ?").run(stamp, stamp, actor, id);
        writeAudit(db, { entity: 'core_inbox', entityId: id, action: 'redrive', oldValues: { status: 'DEAD', lastError: row.last_error }, newValues: { status: 'PENDING' }, reason, actor, correlationId });
        publishEvent(db, { type: 'core.event.redriven', entity: 'inbox', entityId: id, actorId: actor, companyId: row.company_id, correlationId, data: { consumer: row.consumer, eventId: row.event_id, eventType: row.event_type } });
        return db.prepare('SELECT * FROM core_inbox WHERE id = ?').get(id);
      });
    },

    /** Give up on a dead letter on purpose: it stays in the table, marked discarded, with who decided and why. */
    discard(id, { actor, reason, correlationId = null }) {
      return transaction(db, () => {
        const row = db.prepare('SELECT * FROM core_inbox WHERE id = ?').get(id);
        if (!row) throw notFound('That dead letter does not exist.');
        if (row.status !== 'DEAD') throw unprocessable(`This event is ${row.status.toLowerCase()}, not dead, so it cannot be discarded.`);
        const stamp = iso(now().getTime());
        db.prepare("UPDATE core_inbox SET status = 'DISCARDED', updated_at = ?, resolved_by = ?, resolution = 'discarded' WHERE id = ?").run(stamp, actor, id);
        writeAudit(db, { entity: 'core_inbox', entityId: id, action: 'discard', oldValues: { status: 'DEAD', lastError: row.last_error }, newValues: { status: 'DISCARDED' }, reason, actor, correlationId });
        publishEvent(db, { type: 'core.event.discarded', entity: 'inbox', entityId: id, actorId: actor, companyId: row.company_id, correlationId, data: { consumer: row.consumer, eventId: row.event_id, eventType: row.event_type } });
        return db.prepare('SELECT * FROM core_inbox WHERE id = ?').get(id);
      });
    },

    /**
     * Re-run history through consumers (FR-05). `types` are patterns; `from` and `to` are dates or timestamps (UTC) on the
     * event's occurredAt. With `reset`, each consumer's own reset hook empties its projection first. Handlers see
     * `ctx.replay === true` and must not send notifications or call outside systems (BR-03). The inbox is untouched.
     */
    /** @param {{ types?: string | string[], from?: string | null, to?: string | null, consumer?: string | null, reset?: boolean, companyId?: number | null, onProgress?: (percent: number, message: string) => void, isCancelled?: () => boolean }} options */
    replay({ types = ['*'], from = null, to = null, consumer = null, reset = false, companyId = null, onProgress = () => {}, isCancelled = () => false }) {
      const targets = consumer ? [consumers.get(consumer)].filter(Boolean) : [...consumers.values()];
      if (consumer && targets.length === 0) throw notFound(`There is no consumer named ${consumer}.`);
      const patterns = [].concat(types);
      const lower = from ? (from.length === 10 ? `${from}T00:00:00.000Z` : from) : null;
      const upper = to ? (to.length === 10 ? `${to}T23:59:59.999Z` : to) : null;
      if (reset) {
        for (const t of targets) {
          if (t.reset) transaction(db, () => t.reset(db));
        }
      }
      const total = db.prepare('SELECT COUNT(*) AS n FROM core_outbox').get().n || 1;
      let lastId = 0;
      let events = 0;
      let deliveries = 0;
      for (;;) {
        const page = db.prepare('SELECT * FROM core_outbox WHERE id > ? ORDER BY id LIMIT 500').all(lastId);
        if (page.length === 0) break;
        for (const row of page) {
          lastId = row.id;
          if (isCancelled()) return { events, deliveries, cancelled: true };
          if (!patterns.some((p) => matches(p, row.event_type))) continue;
          const event = envelopeOf(row);
          if (lower && (event.occurredAt ?? row.created_at) < lower) continue;
          if (upper && (event.occurredAt ?? row.created_at) > upper) continue;
          if (companyId !== null && event.companyId !== null && event.companyId !== companyId) continue;
          events += 1;
          for (const t of targets) {
            if (!t.patterns.some((p) => matches(p, row.event_type))) continue;
            transaction(db, () => t.handler(event, { db, replay: true, attempt: 1, consumer: t.name }));
            deliveries += 1;
          }
        }
        onProgress(Math.min(99, Math.round((lastId / Math.max(total, lastId)) * 100)), `${events} events replayed`);
      }
      return { events, deliveries, cancelled: false };
    },

    /** Throughput, lag and failures for the monitor. `companyId` limits events to the company's and the system's own. */
    metrics({ companyId = null } = {}) {
      const at = now().getTime();
      const hour = iso(at - 3_600_000);
      const day = iso(at - 86_400_000);
      const scope = companyId === null ? '1 = 1' : '(json_extract(payload, \'$.companyId\') IS NULL OR json_extract(payload, \'$.companyId\') = :c)';
      const inboxScope = companyId === null ? '1 = 1' : '(company_id IS NULL OR company_id = :c)';
      const p = (extra = {}) => (companyId === null ? extra : { c: companyId, ...extra });
      /** @type {(sql: string, params?: any) => any} */
      const one = (sql, params) => db.prepare(sql).get(params);
      const age = (stamp) => (stamp ? Math.max(0, Math.round((at - Date.parse(stamp)) / 1000)) : 0);

      const oldestUnpublished = one(`SELECT MIN(created_at) AS t FROM core_outbox WHERE published_at IS NULL AND ${scope}`, p()).t;
      const byStatus = Object.fromEntries(
        db.prepare(`SELECT status, COUNT(*) AS n FROM core_inbox WHERE ${inboxScope} GROUP BY status`).all(p()).map((r) => [r.status, r.n]),
      );
      const oldestPending = one(`SELECT MIN(next_attempt_at) AS t FROM core_inbox WHERE status = 'PENDING' AND next_attempt_at <= :now AND ${inboxScope}`, p({ now: iso(at) })).t;
      const consumersOut = [...consumers.values()].map((c) => {
        const rows = Object.fromEntries(
          db.prepare(`SELECT status, COUNT(*) AS n FROM core_inbox WHERE consumer = :name AND ${inboxScope} GROUP BY status`).all(p({ name: c.name })).map((r) => [r.status, r.n]),
        );
        return { name: c.name, patterns: c.patterns, pending: rows.PENDING ?? 0, processed: rows.PROCESSED ?? 0, dead: rows.DEAD ?? 0, discarded: rows.DISCARDED ?? 0 };
      });
      const registered = new Set(db.prepare('SELECT DISTINCT type FROM core_event_types').all().map((r) => r.type));
      const recentTypes = db
        .prepare(`SELECT event_type AS type, COUNT(*) AS n FROM core_outbox WHERE created_at >= :day AND ${scope} GROUP BY event_type ORDER BY n DESC, event_type`)
        .all(p({ day }));
      return {
        generatedAt: iso(at),
        events: {
          total: one(`SELECT COUNT(*) AS n FROM core_outbox WHERE ${scope}`, p()).n,
          lastHour: one(`SELECT COUNT(*) AS n FROM core_outbox WHERE created_at >= :hour AND ${scope}`, p({ hour })).n,
          lastDay: one(`SELECT COUNT(*) AS n FROM core_outbox WHERE created_at >= :day AND ${scope}`, p({ day })).n,
          unpublished: one(`SELECT COUNT(*) AS n FROM core_outbox WHERE published_at IS NULL AND ${scope}`, p()).n,
          relayLagSeconds: age(oldestUnpublished),
          byType: recentTypes.slice(0, 10),
          unregisteredTypes: recentTypes.filter((t) => !registered.has(t.type)).map((t) => t.type),
        },
        inbox: {
          pending: byStatus.PENDING ?? 0,
          processed: byStatus.PROCESSED ?? 0,
          dead: byStatus.DEAD ?? 0,
          discarded: byStatus.DISCARDED ?? 0,
          deliveryLagSeconds: age(oldestPending),
        },
        consumers: consumersOut,
      };
    },
  };
  return bus;
}
