import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPermission } from '../../../platform/auth/index.js';
import { companyScope } from '../../../platform/db/scope.js';
import { ROOT, transaction } from '../../../platform/db/index.js';
import { writeAudit } from '../../../platform/audit/index.js';
import { publishEvent } from '../../../platform/events/index.js';
import { log } from '../../../platform/http/logger.js';
import { conflict, notFound, unprocessable } from '../../../platform/http/errors.js';
import { logBuffer } from '../../../platform/observability/logbuffer.js';
import { percentile } from '../../../platform/observability/metrics.js';
import { pseudonym } from '../../../platform/observability/context.js';
import { redactText } from '../../../platform/observability/redact.js';
import { DEFAULT_SLOS } from '../../../platform/observability/ops.js';

export const BASELINE_FILE = join(ROOT, 'docs', 'erp', 'perf', 'baseline.json');
const rate = new Map(); // user -> recent report times (a browser in a loop must not flood the log)
const MAX_PER_MINUTE = 60;

const presentRule = (r) => ({ code: r.code, kind: r.kind, description: r.description, threshold: r.threshold, unit: r.unit, windowMinutes: r.window_minutes, minRequests: r.min_requests, severity: r.severity, channels: JSON.parse(r.channels_json), cooldownMinutes: r.cooldown_minutes, enabled: r.enabled === 1, version: r.version });
const presentSlo = (d) => ({ journey: d.journey, label: d.label, description: d.description, routePatterns: JSON.parse(d.route_patterns_json), targetLatencyMs: d.target_latency_ms, latencyPercentile: d.latency_percentile, targetAvailabilityBp: d.target_availability_bp, windowDays: d.window_days, enabled: d.enabled === 1, version: d.version });

/** Approved changes to an alert rule or a service-level objective are applied in the approver's transaction (maker-checker). */
export const opsConfigChangeHandler = {
  apply(db, request, actor) {
    const { target, key, changes } = request.payload;
    const stamp = new Date().toISOString();
    if (target === 'alert_rule') {
      const row = db.prepare('SELECT * FROM core_alert_rules WHERE code = ? AND deleted_at IS NULL').get(key);
      if (!row) throw unprocessable('The alert rule no longer exists.');
      const next = {
        threshold: changes.threshold ?? row.threshold, window_minutes: changes.windowMinutes ?? row.window_minutes, min_requests: changes.minRequests ?? row.min_requests,
        cooldown_minutes: changes.cooldownMinutes ?? row.cooldown_minutes, severity: changes.severity ?? row.severity,
        channels_json: changes.channels ? JSON.stringify(changes.channels) : row.channels_json, enabled: changes.enabled === undefined ? row.enabled : changes.enabled ? 1 : 0,
      };
      db.prepare('UPDATE core_alert_rules SET threshold = :threshold, window_minutes = :window_minutes, min_requests = :min_requests, cooldown_minutes = :cooldown_minutes, severity = :severity, channels_json = :channels_json, enabled = :enabled, updated_by = :actor, updated_at = :now, version = version + 1 WHERE code = :code')
        .run({ ...next, actor: actor.user, now: stamp, code: key });
      writeAudit(db, { entity: 'core_alert_rules', entityId: row.id, action: 'change_approved', oldValues: presentRule(row), newValues: next, reason: request.reason, actor: actor.user });
    } else {
      const row = db.prepare('SELECT * FROM core_slo_definitions WHERE journey = ? AND deleted_at IS NULL').get(key);
      if (!row) throw unprocessable('The objective no longer exists.');
      const next = {
        target_latency_ms: changes.targetLatencyMs ?? row.target_latency_ms, latency_percentile: changes.latencyPercentile ?? row.latency_percentile,
        target_availability_bp: changes.targetAvailabilityBp ?? row.target_availability_bp, window_days: changes.windowDays ?? row.window_days, enabled: changes.enabled === undefined ? row.enabled : changes.enabled ? 1 : 0,
      };
      db.prepare('UPDATE core_slo_definitions SET target_latency_ms = :target_latency_ms, latency_percentile = :latency_percentile, target_availability_bp = :target_availability_bp, window_days = :window_days, enabled = :enabled, updated_by = :actor, updated_at = :now, version = version + 1 WHERE journey = :journey')
        .run({ ...next, actor: actor.user, now: stamp, journey: key });
      writeAudit(db, { entity: 'core_slo_definitions', entityId: row.id, action: 'change_approved', oldValues: presentSlo(row), newValues: next, reason: request.reason, actor: actor.user });
    }
    publishEvent(db, { type: 'core.ops_config.changed', entity: target, entityId: key, actorId: actor.user, companyId: request.companyId, data: { target, key, requestId: request.id } });
  },
};

/** The operations dashboard's data, the alert and objective configuration, traces, browser reports and the stored baseline. */
export function createOpsService({ db, ops, metrics, tracer, approvals, jobs, now = () => Date.now() }) {
  const companyOf = (actor) => companyScope(actor).params._company_scope;
  const view = (actor) => {
    assertPermission(actor, 'core.ops.view');
    companyOf(actor);
  };
  const manage = (actor) => {
    assertPermission(actor, 'core.ops.manage');
    return companyOf(actor);
  };
  const win = (minutes) => {
    const a = metrics.aggregate(minutes);
    return { minutes, requests: a.requests, perMinute: Math.round((a.requests / minutes) * 100) / 100, serverErrors: a.serverErrors, clientErrors: a.clientErrors, errorRatePct: a.requests ? Math.round((a.serverErrors / a.requests) * 10000) / 100 : 0, p50: a.requests ? percentile(a.hist, 0.5) : null, p95: a.requests ? percentile(a.hist, 0.95) : null, p99: a.requests ? percentile(a.hist, 0.99) : null };
  };
  const baseline = () => {
    if (!existsSync(BASELINE_FILE)) return { available: false };
    try {
      return { available: true, ...JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) };
    } catch {
      return { available: false, problem: 'The stored baseline could not be read.' };
    }
  };

  return {
    summary(actor) {
      view(actor);
      const routes = metrics.routes(60);
      const clientRows = db.prepare("SELECT type, COUNT(*) AS n FROM core_client_events WHERE created_at >= ? GROUP BY type").all(new Date(now() - 3_600_000).toISOString());
      const base = baseline();
      return {
        generatedAt: new Date(now()).toISOString(),
        process: metrics.process(),
        http: {
          last5m: win(5),
          last1h: win(60),
          topRoutes: routes.slice(0, 10),
          slowest: routes.filter((r) => r.requests >= 3).sort((a, b) => (b.p95 ?? 0) - (a.p95 ?? 0)).slice(0, 5),
          failing: routes.filter((r) => r.serverErrors > 0).sort((a, b) => b.serverErrors - a.serverErrors).slice(0, 5),
        },
        system: ops.system(),
        slos: ops.sloReport(),
        alerts: { open: ops.alerts({ status: 'OPEN' }), recent: ops.alerts({ limit: 10 }) },
        slowQueries: metrics.slowQueries(10),
        topQueries: metrics.queryStats(5),
        clientReports: { lastHour: Object.fromEntries(clientRows.map((r) => [r.type, r.n])), recent: this.clientEvents(actor, { limit: 8 }) },
        baseline: base.available ? { available: true, generatedAt: base.generatedAt, environment: base.environment, journeys: base.journeys.length, failing: base.journeys.filter((j) => !j.meetsStandard).length } : base,
        tracing: { traces: tracer.size(), exporter: 'In memory; OTLP/JSON export per trace (the OpenTelemetry SDK is not installed, D-046)' },
      };
    },

    slos(actor) {
      view(actor);
      const status = new Map(ops.sloReport().map((s) => [s.journey, s]));
      return db.prepare('SELECT * FROM core_slo_definitions WHERE deleted_at IS NULL ORDER BY id').all().map((d) => ({ ...presentSlo(d), measured: status.get(d.journey) }));
    },

    alertRules(actor) {
      view(actor);
      return db.prepare('SELECT * FROM core_alert_rules WHERE deleted_at IS NULL ORDER BY id').all().map(presentRule);
    },

    alerts(actor, q) {
      view(actor);
      return ops.alerts({ status: q.status ?? null, limit: q.limit });
    },

    acknowledge(actor, id, correlationId) {
      manage(actor);
      const a = ops.acknowledge(id, actor.user, correlationId);
      if (!a) throw notFound('That alert does not exist.');
      return ops.alerts({ limit: 200 }).find((x) => x.id === id);
    },

    /** Evaluate now: save the metrics and check every alert rule (the workers do this every minute). */
    tick(actor) {
      manage(actor);
      return ops.tick();
    },

    requestChange(actor, kind, key, { changes, reason }) {
      const companyId = manage(actor);
      const table = kind === 'alert_rule' ? 'core_alert_rules' : 'core_slo_definitions';
      const row = db.prepare(`SELECT * FROM ${table} WHERE ${kind === 'alert_rule' ? 'code' : 'journey'} = ? AND deleted_at IS NULL`).get(key);
      if (!row) throw notFound(kind === 'alert_rule' ? 'That alert rule does not exist.' : 'That objective does not exist.');
      const current = kind === 'alert_rule' ? presentRule(row) : presentSlo(row);
      const changed = Object.fromEntries(Object.entries(changes).filter(([k, v]) => JSON.stringify(current[k]) !== JSON.stringify(v)));
      if (Object.keys(changed).length === 0) throw unprocessable('Nothing would change: the requested values are the current ones.');
      if (approvals.hasOpen(companyId, 'ops_config_change', kind, row.id)) throw conflict('There is already an open change request for this item. Decide or withdraw it first.');
      return approvals.submit(actor, { type: 'ops_config_change', title: `Change ${kind === 'alert_rule' ? 'alert rule' : 'objective'} ${key}`, targetType: kind, targetId: row.id, payload: { target: kind, key, changes: changed, from: Object.fromEntries(Object.keys(changed).map((k) => [k, current[k]])) }, reason, chain: ['SYSADM'] });
    },

    traces(actor, q) {
      view(actor);
      return tracer.recent(200).filter((t) => (!q.status || t.status === q.status) && (q.minMs === undefined || t.durationMs >= q.minMs)).slice(0, q.limit);
    },
    trace(actor, traceId) {
      view(actor);
      return tracer.get(traceId) ?? (() => { throw notFound('That trace is no longer kept. Only the most recent traces are held in memory.'); })();
    },
    otlp(actor, traceId) {
      view(actor);
      return tracer.otlp(traceId) ?? (() => { throw notFound('That trace is no longer kept.'); })();
    },

    /** Everything that happened under one correlation ID: log lines, traces, events, jobs and browser reports. */
    follow(actor, { correlationId }) {
      view(actor);
      const events = db.prepare("SELECT id, event_type, created_at, published_at FROM core_outbox WHERE json_extract(payload, '$.correlationId') = ? ORDER BY id").all(correlationId).map((e) => ({ id: e.id, type: e.event_type, at: e.created_at, published: Boolean(e.published_at) }));
      const jobs = db.prepare("SELECT id, job_id, type, status, error, created_at FROM core_jobs WHERE json_extract(params_json, '$._cid') = ? ORDER BY id").all(correlationId).map((j) => ({ id: j.id, type: j.type, status: j.status, error: j.error, at: j.created_at }));
      const client = db.prepare('SELECT type, message, path, status, created_at FROM core_client_events WHERE correlation_id = ? ORDER BY id').all(correlationId).map((c) => ({ ...c }));
      return { correlationId, logs: logBuffer.byCorrelation(correlationId), traces: tracer.byCorrelation(correlationId), events, jobs, clientReports: client };
    },

    /** Browser reports: JavaScript errors, failed API calls and page-load timings, tied to the correlation ID of the request involved (FR-04). */
    recordClientEvents(actor, { events }) {
      const company = companyOf(actor);
      const stamp = now();
      const recent = (rate.get(actor.user) ?? []).filter((t) => stamp - t < 60_000);
      if (recent.length + events.length > MAX_PER_MINUTE) {
        rate.set(actor.user, recent);
        throw unprocessable('Too many reports from this browser in the last minute. They were not recorded.');
      }
      rate.set(actor.user, [...recent, ...events.map(() => stamp)]);
      const insert = db.prepare('INSERT INTO core_client_events (company_id, user_ref, type, message, path, status, correlation_id, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const e of events) {
        const path = e.path ? redactText(e.path.split('?')[0].split('#')[0]).slice(0, 200) : null;
        insert.run(company, pseudonym(actor.user), e.type, e.message ? redactText(e.message).slice(0, 300) : null, path, e.status ?? null, e.correlationId ?? null, e.durationMs === undefined ? null : Math.round(e.durationMs));
        metrics.counter(`client.${e.type}`);
        if (e.type !== 'page_load') log.warn({ msg: `browser ${e.type}`, correlationId: e.correlationId, path, status: e.status, error: e.message ? e.message.slice(0, 300) : undefined });
      }
      return { recorded: events.length };
    },
    clientEvents(actor, { type = null, limit = 30 } = {}) {
      view(actor);
      return db.prepare('SELECT type, message, path, status, correlation_id, duration_ms, created_at FROM core_client_events WHERE (:type IS NULL OR type = :type) ORDER BY id DESC LIMIT :limit').all({ type, limit }).map((c) => ({ type: c.type, message: c.message, path: c.path, status: c.status, correlationId: c.correlation_id, durationMs: c.duration_ms, at: c.created_at }));
    },

    baseline(actor) {
      view(actor);
      return baseline();
    },

    /**
     * Follow-one-request test: logs a line, raises an event and queues a job (the consumer and the job log under the same
     * correlation ID), then fails on purpose. The caller gets a 500 with the correlation ID and can follow it.
     */
    forceError(actor, correlationId) {
      manage(actor);
      log.info({ msg: 'diagnostic started', actor: pseudonym(actor.user) });
      transaction(db, () => {
        publishEvent(db, { type: 'core.ops.diagnostic', entity: 'diagnostic', entityId: correlationId ?? 'none', actorId: actor.user, data: { note: 'forced by an administrator' } });
      });
      jobs.enqueue('core.ops_diagnostic', {}, { createdBy: actor.user });
      log.warn({ msg: 'diagnostic about to fail on purpose' });
      throw new Error('Diagnostic failure forced by an administrator (nothing is wrong).');
    },

    knownJourneys: DEFAULT_SLOS.map((s) => s.journey),
  };
}

