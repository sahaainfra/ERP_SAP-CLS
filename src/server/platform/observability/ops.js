import { statSync, statfsSync } from 'node:fs';
import { transaction } from '../db/index.js';
import { writeAudit } from '../audit/index.js';
import { publishEvent } from '../events/index.js';
import { log } from '../http/logger.js';
import { HIST_EDGES, addHist, emptyHist, percentile, withinMs } from './metrics.js';

/** Journeys with a service-level objective. The patterns match `METHOD route-pattern`; a trailing * matches a prefix. */
export const DEFAULT_SLOS = Object.freeze([
  ['login', 'Sign in', ['GET /api/v1/core/session'], 300, 9990, 'The session check every page makes on load. Stands in for sign-in until the IAM module (02.x) exists.'],
  ['attendance_punch', 'Attendance punch', ['POST /api/v1/attendance/*'], 500, 9950, 'No traffic until the attendance module is built.'],
  ['dpr_submit', 'Daily progress report submit', ['POST /api/v1/dpr/*'], 800, 9950, 'No traffic until the DPR module (14.x) is built.'],
  ['po_approval', 'Purchase order approval', ['POST /api/v1/procurement/*'], 800, 9950, 'No traffic until procurement is built. The approval decision below measures the approval engine meanwhile.'],
  ['payment_run', 'Payment run', ['POST /api/v1/payments/*'], 800, 9990, 'No traffic until payments are built.'],
  ['approval_decision', 'Approve or reject a request', ['POST /api/v1/core/change-requests/:id/act'], 800, 9950, 'A decision in the interim approvals inbox.'],
  ['file_upload', 'Attach a file', ['POST /api/v1/core/files', 'PUT /api/v1/core/files/uploads/:uploadId', 'POST /api/v1/core/files/uploads/:uploadId/complete'], 2000, 9950, 'A file arriving in one request or as chunks.'],
  ['bill_calculation', 'Calculate a bill', ['POST /api/v1/core/sample-bills', 'PATCH /api/v1/core/sample-bills/:id', 'POST /api/v1/core/sample-bills/:id/recalculate'], 800, 9950, 'A record calculated by the engine, with its trace.'],
].map(([journey, label, patterns, latency, availability, description]) => ({ journey, label, patterns, latency, availability, description })));

/** Alert rules. Units: error_rate in basis points of requests; counts for backlog, dead letters, failures and client errors; MB for the database; percent for free disk. */
export const DEFAULT_ALERT_RULES = Object.freeze([
  { code: 'error_spike', kind: 'error_rate', description: 'Server errors above 5% of requests in 5 minutes (at least 20 requests).', threshold: 500, unit: 'percent_bp', windowMinutes: 5, minRequests: 20, severity: 'critical' },
  { code: 'slo_breach', kind: 'slo_breach', description: 'A journey misses its availability or latency objective.', threshold: 0, unit: 'flag', windowMinutes: 5, minRequests: 0, severity: 'critical' },
  { code: 'outbox_backlog', kind: 'outbox_backlog', description: 'More than 1000 events waiting to be relayed.', threshold: 1000, unit: 'count', windowMinutes: 5, minRequests: 0, severity: 'warning' },
  { code: 'dead_letters', kind: 'dead_letters', description: 'A consumer gave up on an event (dead-letter queue is not empty).', threshold: 1, unit: 'count', windowMinutes: 5, minRequests: 0, severity: 'warning' },
  { code: 'job_failures', kind: 'job_failures', description: 'Three or more background jobs failed in the last hour.', threshold: 3, unit: 'count', windowMinutes: 60, minRequests: 0, severity: 'warning' },
  { code: 'disk_low', kind: 'disk_free', description: 'Less than 10% of the disk holding the data folder is free.', threshold: 10, unit: 'percent', windowMinutes: 5, minRequests: 0, severity: 'critical' },
  { code: 'db_large', kind: 'db_size', description: 'The database is larger than 5000 MB.', threshold: 5000, unit: 'mb', windowMinutes: 5, minRequests: 0, severity: 'warning' },
  { code: 'browser_errors', kind: 'client_errors', description: 'Twenty or more JavaScript errors reported by browsers in 15 minutes.', threshold: 20, unit: 'count', windowMinutes: 15, minRequests: 0, severity: 'warning' },
]);

export const CHANNELS = ['email', 'whatsapp'];
const iso = (ms) => new Date(ms).toISOString();
const matches = (patterns, key) => patterns.some((p) => (p.endsWith('*') ? key.startsWith(p.slice(0, -1)) : p === key));

/** The measured state of one journey against its objective. */
export function evaluateSlo(def, { persisted, live, last1h }) {
  const hist = addHist(persisted.hist, live.hist);
  const requests = persisted.requests + live.requests;
  const errors = persisted.serverErrors + live.serverErrors;
  const targetAvail = def.target_availability_bp / 10000;
  const p = percentile(hist, def.latency_percentile / 100);
  const availability = requests ? 1 - errors / requests : null;
  const allowed = requests * (1 - targetAvail);
  const used = allowed > 0 ? errors / allowed : errors > 0 ? Infinity : 0;
  const burn = last1h.requests && 1 - targetAvail > 0 ? last1h.serverErrors / last1h.requests / (1 - targetAvail) : 0;
  const latencyOk = p === null || p <= def.target_latency_ms;
  const within = requests ? withinMs(hist, def.target_latency_ms) / requests : null;
  let status = 'ok';
  if (requests === 0) status = 'no_data';
  else if (availability < targetAvail || !latencyOk) status = 'breached';
  else if (used >= 0.5 || (p !== null && p > 0.8 * def.target_latency_ms)) status = 'at_risk';
  return {
    journey: def.journey,
    label: def.label,
    description: def.description,
    enabled: def.enabled === 1,
    windowDays: def.window_days,
    targetLatencyMs: def.target_latency_ms,
    latencyPercentile: def.latency_percentile,
    targetAvailabilityPct: def.target_availability_bp / 100,
    requests,
    serverErrors: errors,
    availabilityPct: availability === null ? null : Math.round(availability * 100000) / 1000,
    latencyMs: p,
    withinTargetPct: within === null ? null : Math.round(within * 1000) / 10,
    errorBudget: { allowedErrors: Math.round(allowed * 100) / 100, usedPct: Number.isFinite(used) ? Math.round(used * 1000) / 10 : 100, remainingPct: Number.isFinite(used) ? Math.max(0, Math.round((1 - used) * 1000) / 10) : 0 },
    burnRate1h: Math.round(burn * 100) / 100,
    status,
  };
}

/**
 * Operations: saving request metrics, measuring journeys against their objectives, raising and resolving alerts, and putting the
 * state of the system in one summary (FR-02, FR-05, FR-06, FR-07). Notification channels are pluggable: nothing here knows how
 * to send an email or a WhatsApp message (defect D-047); an alert is recorded, announced as an event and logged, and each
 * configured channel records whether a sender exists for it.
 */
export function createOps({ db, metrics, storagePath, now = () => Date.now() }) {
  const senders = new Map();

  const sloDefs = () => db.prepare('SELECT * FROM core_slo_definitions WHERE deleted_at IS NULL AND is_active = 1 ORDER BY id').all();
  const rules = () => db.prepare('SELECT * FROM core_alert_rules WHERE deleted_at IS NULL AND is_active = 1 ORDER BY id').all();

  const ops = {
    /** Register how a channel delivers: sender({ channel, alert, rule }) returns { status }. Used by the notification service (04.09) and by tests. */
    setSender: (channel, fn) => senders.set(channel, fn),

    ensureDefaults() {
      const slo = db.prepare("INSERT OR IGNORE INTO core_slo_definitions (journey, label, description, route_patterns_json, target_latency_ms, target_availability_bp, window_days, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 30, 'system', 'reference_seed')");
      for (const d of DEFAULT_SLOS) slo.run(d.journey, d.label, d.description, JSON.stringify(d.patterns), d.latency, d.availability);
      const rule = db.prepare("INSERT OR IGNORE INTO core_alert_rules (code, kind, description, threshold, unit, window_minutes, min_requests, severity, channels_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[\"email\"]', 'system', 'reference_seed')");
      for (const r of DEFAULT_ALERT_RULES) rule.run(r.code, r.kind, r.description, r.threshold, r.unit, r.windowMinutes, r.minRequests, r.severity);
    },

    /** Save the completed minutes of request metrics, hour by hour, so objectives can be judged over weeks. */
    flushMetrics() {
      const rows = metrics.drainFlushable();
      if (rows.length === 0) return 0;
      transaction(db, () => {
        const get = db.prepare('SELECT id, hist_json FROM core_metric_samples WHERE bucket_hour = ? AND route_key = ?');
        const insert = db.prepare('INSERT INTO core_metric_samples (bucket_hour, route_key, requests, server_errors, client_errors, sum_ms, hist_json) VALUES (?, ?, ?, ?, ?, ?, ?)');
        const update = db.prepare('UPDATE core_metric_samples SET requests = requests + ?, server_errors = server_errors + ?, client_errors = client_errors + ?, sum_ms = sum_ms + ?, hist_json = ? WHERE id = ?');
        for (const r of rows) {
          const existing = get.get(r.hour, r.route);
          if (existing) update.run(r.requests, r.serverErrors, r.clientErrors, Math.round(r.sumMs), JSON.stringify(addHist(JSON.parse(existing.hist_json), r.hist)), existing.id);
          else insert.run(r.hour, r.route, r.requests, r.serverErrors, r.clientErrors, Math.round(r.sumMs), JSON.stringify(r.hist));
        }
      });
      return rows.length;
    },

    /** Every journey measured over its window: saved hours plus the minutes not saved yet. */
    sloReport() {
      return sloDefs().map((def) => {
        const patterns = JSON.parse(def.route_patterns_json);
        const match = (key) => matches(patterns, key);
        const from = iso(now() - def.window_days * 86_400_000);
        const persisted = { requests: 0, serverErrors: 0, hist: emptyHist() };
        for (const r of db.prepare('SELECT route_key, requests, server_errors, hist_json FROM core_metric_samples WHERE bucket_hour >= ?').all(from)) {
          if (!match(r.route_key)) continue;
          persisted.requests += r.requests;
          persisted.serverErrors += r.server_errors;
          persisted.hist = addHist(persisted.hist, JSON.parse(r.hist_json));
        }
        const live = metrics.aggregate(def.window_days * 1440, match, { onlyUnflushed: true });
        return evaluateSlo(def, { persisted, live, last1h: metrics.aggregate(60, match) });
      });
    },

    /** Database, disk, queues, jobs and caches: the state that is not a request. */
    system() {
      const loc = db.location?.() ?? null;
      const size = (f) => {
        try {
          return statSync(f).size;
        } catch {
          return 0;
        }
      };
      const pages = db.prepare('PRAGMA page_count').get().page_count * db.prepare('PRAGMA page_size').get().page_size;
      let disk;
      try {
        const s = statfsSync(storagePath);
        disk = { totalMb: Math.round((s.blocks * s.bsize) / 1048576), freeMb: Math.round((s.bavail * s.bsize) / 1048576), freePct: Math.round((s.bavail / s.blocks) * 1000) / 10 };
      } catch {
        disk = null;
      }
      const one = (sql, ...p) => db.prepare(sql).get(...p);
      const jobs = db.prepare("SELECT type, COUNT(*) AS n, AVG((julianday(finished_at) - julianday(started_at)) * 86400000) AS mean_ms FROM core_jobs WHERE status = 'SUCCEEDED' AND finished_at >= ? AND started_at IS NOT NULL GROUP BY type ORDER BY n DESC").all(iso(now() - 86_400_000));
      const hits = metrics.counters();
      const rate = (name) => {
        const h = hits[`cache.${name}.hit`] ?? 0;
        const m = hits[`cache.${name}.miss`] ?? 0;
        return { hits: h, misses: m, hitRatePct: h + m ? Math.round((h / (h + m)) * 1000) / 10 : null };
      };
      return {
        database: { engine: 'SQLite (one connection)', sizeMb: Math.round((loc ? size(loc) : pages) / 1048576 * 10) / 10, walMb: Math.round((loc ? size(`${loc}-wal`) : 0) / 1048576 * 10) / 10, connections: { open: 1, inTransaction: db.isTransaction, note: 'There is no pool: one connection serves the process' }, queries: metrics.counters()['db.queries'] ?? 0, slowQueries: metrics.counters()['db.slow_queries'] ?? 0 },
        disk,
        queues: {
          outboxUnpublished: one('SELECT COUNT(*) AS n FROM core_outbox WHERE published_at IS NULL').n,
          inboxPending: one("SELECT COUNT(*) AS n FROM core_inbox WHERE status = 'PENDING'").n,
          deadLetters: one("SELECT COUNT(*) AS n FROM core_inbox WHERE status = 'DEAD'").n,
          jobsQueued: one("SELECT COUNT(*) AS n FROM core_jobs WHERE status = 'QUEUED'").n,
          jobsRunning: one("SELECT COUNT(*) AS n FROM core_jobs WHERE status = 'RUNNING'").n,
          jobsFailedLastHour: one("SELECT COUNT(*) AS n FROM core_jobs WHERE status = 'FAILED' AND finished_at >= ?", iso(now() - 3_600_000)).n,
        },
        jobDurations: jobs.map((j) => ({ type: j.type, runs: j.n, meanMs: Math.round(j.mean_ms ?? 0) })),
        caches: { parameters: rate('parameters') },
        sockets: { connections: null, note: 'No socket server is built yet (D-026); connections will be counted here when it is.' },
      };
    },

    // ---- alerts ----
    evaluateAlerts() {
      const stamp = now();
      const sys = ops.system();
      const slos = ops.sloReport();
      const breaches = [];
      for (const r of rules().filter((x) => x.enabled === 1)) {
        const found = [];
        if (r.kind === 'error_rate') {
          const a = metrics.aggregate(r.window_minutes);
          if (a.requests >= r.min_requests && a.requests > 0) {
            const bp = Math.round((a.serverErrors / a.requests) * 10000);
            if (bp >= r.threshold) found.push({ key: 'all', value: `${(bp / 100).toFixed(2)}%`, message: `${a.serverErrors} of ${a.requests} requests failed with a server error in the last ${r.window_minutes} minutes (${(bp / 100).toFixed(2)}%, limit ${(r.threshold / 100).toFixed(2)}%).` });
          }
        } else if (r.kind === 'slo_breach') {
          for (const s of slos.filter((x) => x.enabled && x.status === 'breached')) found.push({ key: s.journey, value: s.status, message: `${s.label} is outside its objective: availability ${s.availabilityPct}% (target ${s.targetAvailabilityPct}%), p${s.latencyPercentile} ${s.latencyMs} ms (target ${s.targetLatencyMs} ms).` });
        } else if (r.kind === 'outbox_backlog' && sys.queues.outboxUnpublished >= r.threshold) {
          found.push({ key: 'outbox', value: String(sys.queues.outboxUnpublished), message: `${sys.queues.outboxUnpublished} events are waiting to be relayed (limit ${r.threshold}). Events are not reaching their consumers.` });
        } else if (r.kind === 'dead_letters' && sys.queues.deadLetters >= r.threshold) {
          found.push({ key: 'dlq', value: String(sys.queues.deadLetters), message: `${sys.queues.deadLetters} event(s) are in the dead-letter queue. Fix the consumer and re-drive them.` });
        } else if (r.kind === 'job_failures') {
          const n = db.prepare("SELECT COUNT(*) AS n FROM core_jobs WHERE status = 'FAILED' AND finished_at >= ?").get(iso(stamp - r.window_minutes * 60_000)).n;
          if (n >= r.threshold) found.push({ key: 'jobs', value: String(n), message: `${n} background jobs failed in the last ${r.window_minutes} minutes.` });
        } else if (r.kind === 'disk_free' && sys.disk && sys.disk.freePct <= r.threshold) {
          found.push({ key: 'disk', value: `${sys.disk.freePct}%`, message: `Only ${sys.disk.freePct}% of the disk (${sys.disk.freeMb} MB) is free (limit ${r.threshold}%).` });
        } else if (r.kind === 'db_size' && sys.database.sizeMb >= r.threshold) {
          found.push({ key: 'db', value: `${sys.database.sizeMb} MB`, message: `The database is ${sys.database.sizeMb} MB (limit ${r.threshold} MB).` });
        } else if (r.kind === 'client_errors') {
          const n = db.prepare("SELECT COUNT(*) AS n FROM core_client_events WHERE type = 'js_error' AND created_at >= ?").get(iso(stamp - r.window_minutes * 60_000)).n;
          if (n >= r.threshold) found.push({ key: 'browser', value: String(n), message: `Browsers reported ${n} JavaScript errors in the last ${r.window_minutes} minutes.` });
        }
        breaches.push({ rule: r, found });
      }
      const fired = [];
      const resolved = [];
      for (const { rule, found } of breaches) {
        const keys = new Set(found.map((f) => f.key));
        for (const f of found) {
          const dedupe = `${rule.code}:${f.key}`;
          if (db.prepare("SELECT 1 FROM core_alerts WHERE dedupe_key = ? AND status = 'OPEN'").get(dedupe)) continue;
          const last = db.prepare('SELECT fired_at FROM core_alerts WHERE dedupe_key = ? ORDER BY id DESC LIMIT 1').get(dedupe);
          if (last && stamp - Date.parse(last.fired_at) < rule.cooldown_minutes * 60_000) continue; // flapping: not again so soon
          fired.push(ops.fire(rule, dedupe, f));
        }
        for (const open of db.prepare("SELECT * FROM core_alerts WHERE rule_code = ? AND status = 'OPEN'").all(rule.code)) {
          if (!keys.has(open.dedupe_key.slice(rule.code.length + 1))) resolved.push(ops.resolve(open));
        }
      }
      // A rule that was disabled or deleted must not leave an alert open for ever.
      for (const open of db.prepare("SELECT * FROM core_alerts WHERE status = 'OPEN'").all()) {
        if (!breaches.some((b) => b.rule.code === open.rule_code)) resolved.push(ops.resolve(open));
      }
      return { fired, resolved };
    },

    fire(rule, dedupe, f) {
      const channels = JSON.parse(rule.channels_json);
      const notified = channels.map((channel) => {
        const sender = senders.get(channel);
        if (!sender) return { channel, to: 'ITADM', status: 'not_configured' };
        try {
          return { channel, to: 'ITADM', ...sender({ channel, rule, message: f.message, severity: rule.severity }) };
        } catch (err) {
          return { channel, to: 'ITADM', status: 'failed', error: String(err.message ?? err).slice(0, 200) };
        }
      });
      const id = transaction(db, () => {
        const res = db
          .prepare('INSERT INTO core_alerts (rule_code, dedupe_key, severity, message, value, threshold, status, fired_at, notified_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(rule.code, dedupe, rule.severity, f.message, f.value, String(rule.threshold), 'OPEN', iso(now()), JSON.stringify(notified));
        const alertId = Number(res.lastInsertRowid);
        publishEvent(db, { type: 'core.alert.fired', entity: 'alert', entityId: alertId, actorId: 'system', data: { rule: rule.code, severity: rule.severity, message: f.message, channels } });
        return alertId;
      });
      metrics.counter('alerts.fired');
      log.warn({ msg: 'alert fired', rule: rule.code, severity: rule.severity, alertMessage: f.message, alertId: id });
      return db.prepare('SELECT * FROM core_alerts WHERE id = ?').get(id);
    },

    resolve(alert) {
      transaction(db, () => {
        db.prepare("UPDATE core_alerts SET status = 'RESOLVED', resolved_at = ? WHERE id = ?").run(iso(now()), alert.id);
        publishEvent(db, { type: 'core.alert.resolved', entity: 'alert', entityId: alert.id, actorId: 'system', data: { rule: alert.rule_code } });
      });
      log.info({ msg: 'alert resolved', rule: alert.rule_code, alertId: alert.id });
      return { ...alert, status: 'RESOLVED' };
    },

    acknowledge(id, actor, correlationId = null) {
      const a = db.prepare('SELECT * FROM core_alerts WHERE id = ?').get(id);
      if (!a) return null;
      db.prepare('UPDATE core_alerts SET acknowledged_by = ?, acknowledged_at = ? WHERE id = ? AND acknowledged_at IS NULL').run(actor, iso(now()), id);
      writeAudit(db, { entity: 'core_alerts', entityId: id, action: 'acknowledge', actor, correlationId });
      return db.prepare('SELECT * FROM core_alerts WHERE id = ?').get(id);
    },

    alerts({ status = null, limit = 50 } = {}) {
      return db
        .prepare('SELECT * FROM core_alerts WHERE (:status IS NULL OR status = :status) ORDER BY id DESC LIMIT :limit')
        .all({ status, limit })
        .map((a) => ({ id: a.id, rule: a.rule_code, key: a.dedupe_key, severity: a.severity, message: a.message, value: a.value, threshold: a.threshold, status: a.status, firedAt: a.fired_at, resolvedAt: a.resolved_at, acknowledgedBy: a.acknowledged_by, acknowledgedAt: a.acknowledged_at, notified: JSON.parse(a.notified_json) }));
    },

    /** Remove saved metrics older than 35 days, client reports older than 14 and resolved alerts older than 90. */
    purge() {
      const a = db.prepare('DELETE FROM core_metric_samples WHERE bucket_hour < ?').run(iso(now() - 35 * 86_400_000)).changes;
      const b = db.prepare('DELETE FROM core_client_events WHERE created_at < ?').run(iso(now() - 14 * 86_400_000)).changes;
      const c = db.prepare("DELETE FROM core_alerts WHERE status = 'RESOLVED' AND resolved_at < ?").run(iso(now() - 90 * 86_400_000)).changes;
      return { metricRows: a, clientEvents: b, alerts: c };
    },

    /** The one call the scheduler makes every minute. */
    tick() {
      const saved = ops.flushMetrics();
      const alerts = ops.evaluateAlerts();
      return { saved, fired: alerts.fired.length, resolved: alerts.resolved.length };
    },
  };
  return ops;
}

export { HIST_EDGES };

const opsByDb = new WeakMap();
/** One operations object per database, shared by the app (the /metrics route), the module's routes and the workers. */
/** @param {any} db @param {{ metrics: any, storagePath: string, now?: () => number }} options */
export function opsOf(db, options) {
  let o = opsByDb.get(db);
  if (!o) {
    o = createOps({ db, ...options });
    opsByDb.set(db, o);
  }
  return o;
}
