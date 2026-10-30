import { randomUUID } from 'node:crypto';
import { transaction } from '../db/index.js';
import { writeAudit } from '../audit/index.js';
import { publishEvent } from '../events/index.js';
import { log as appLog } from '../http/logger.js';
import { currentContext, runWithContext } from '../observability/context.js';
import { metrics } from '../observability/metrics.js';
import { formatTraceparent, parseTraceparent, tracer } from '../observability/tracing.js';
import { notFound, unprocessable } from '../http/errors.js';

const DEFAULT_BACKOFF = (attempt) => Math.min(60_000 * 2 ** (attempt - 1), 3_600_000);
const iso = (ms) => new Date(ms).toISOString();
const MAX_LOG_LINES = 200;
/** The correlation ID and trace of the request that queued a job travel in its parameters under these keys. */
const stripTrace = ({ _cid, _tp, ...rest }) => rest;

/** Thrown by a handler (or by `ctx.throwIfCancelled()`) to stop a job that was asked to cancel. */
export class JobCancelled extends Error {
  constructor() {
    super('The job was cancelled');
  }
}

/**
 * Background jobs (FR-06): queued work with progress, cancellation, retries with back-off and a history.
 * `register(type, handler)` declares what a job type does; `enqueue` queues one; `runNext` claims and runs the oldest
 * due job. A claim is a single UPDATE ... RETURNING, so several instances can poll the same table and each job runs once.
 * Handlers receive { jobId, params, setProgress(percent, message), log(message), isCancelled(), throwIfCancelled() } and may be async.
 */
/** @param {{ db: any, now?: () => Date, backoffMs?: (attempt: number) => number, staleAfterMs?: number }} options */
export function createJobRunner({ db, now = () => new Date(), backoffMs = DEFAULT_BACKOFF, staleAfterMs = 10 * 60_000 }) {
  /** @type {Map<string, { handler: Function, maxAttempts: number, description: string }>} */
  const handlers = new Map();

  const present = (r) => ({
    id: r.id,
    jobId: r.job_id,
    type: r.type,
    params: stripTrace(JSON.parse(r.params_json)),
    correlationId: JSON.parse(r.params_json)._cid ?? null,
    status: r.status,
    progress: r.progress,
    progressMessage: r.progress_message,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    runAfter: r.run_after,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationMs: r.started_at && r.finished_at ? Math.max(0, Date.parse(r.finished_at) - Date.parse(r.started_at)) : null,
    error: r.error,
    result: r.result_json ? JSON.parse(r.result_json) : null,
    log: JSON.parse(r.log_json),
    cancelRequested: r.cancel_requested === 1,
    createdBy: r.created_by,
    companyId: r.company_id,
    scheduleCode: r.schedule_code,
    createdAt: r.created_at,
  });

  const runner = {
    present,
    types: () => [...handlers.entries()].map(([type, h]) => ({ type, description: h.description, maxAttempts: h.maxAttempts })),

    register(type, handler, { maxAttempts = 3, description = '' } = {}) {
      if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(type)) throw new Error(`Job type "${type}" must look like module.job_name`);
      if (handlers.has(type)) throw new Error(`Job type ${type} is already registered`);
      handlers.set(type, { handler, maxAttempts, description });
    },

    /** Queue a job. Inside a caller's transaction it commits with it (like an event). */
    enqueue(type, params = {}, { createdBy = 'system', companyId = null, runAfter = null, scheduleCode = null, scheduledFor = null, maxAttempts = null } = {}) {
      const def = handlers.get(type);
      if (!def) throw unprocessable(`There is no job type ${type}.`);
      const jobId = randomUUID();
      const ctx = currentContext();
      const stored = { ...params, ...(ctx?.correlationId ? { _cid: ctx.correlationId } : {}), ...(ctx?.span ? { _tp: formatTraceparent(ctx.span.traceId, ctx.span.spanId) } : {}) };
      db.prepare(
        `INSERT INTO core_jobs (job_id, type, params_json, run_after, max_attempts, created_by, company_id, schedule_code, scheduled_for)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(jobId, type, JSON.stringify(stored), runAfter ?? iso(now().getTime()), maxAttempts ?? def.maxAttempts, createdBy, companyId, scheduleCode, scheduledFor);
      return present(db.prepare('SELECT * FROM core_jobs WHERE job_id = ?').get(jobId));
    },

    get: (id) => {
      const r = db.prepare('SELECT * FROM core_jobs WHERE id = ?').get(id);
      return r ? present(r) : null;
    },

    /** Jobs stuck in RUNNING with no heartbeat (the instance died) go back to the queue. */
    recoverStale() {
      const cutoff = iso(now().getTime() - staleAfterMs);
      const stuck = db.prepare("SELECT id FROM core_jobs WHERE status = 'RUNNING' AND COALESCE(heartbeat_at, started_at) < ?").all(cutoff);
      for (const { id } of stuck) {
        db.prepare("UPDATE core_jobs SET status = 'QUEUED', progress_message = 'Re-queued after the worker stopped responding', updated_at = ? WHERE id = ? AND status = 'RUNNING'").run(iso(now().getTime()), id);
      }
      return stuck.length;
    },

    /** Claim and run the oldest due job. Resolves to the finished job, or null when nothing is due. */
    async runNext() {
      const at = iso(now().getTime());
      const claimed = db
        .prepare(
          `UPDATE core_jobs SET status = 'RUNNING', attempts = attempts + 1, started_at = ?, heartbeat_at = ?, finished_at = NULL, error = NULL, progress = 0, progress_message = NULL, updated_at = ?
           WHERE id = (SELECT id FROM core_jobs WHERE status = 'QUEUED' AND run_after <= ? ORDER BY run_after, id LIMIT 1) AND status = 'QUEUED'
           RETURNING *`,
        )
        .get(at, at, at, at);
      if (!claimed) return null;
      return runner.execute(claimed);
    },

    async execute(row) {
      const def = handlers.get(row.type);
      const log = [];
      const flush = () => db.prepare('UPDATE core_jobs SET log_json = ?, heartbeat_at = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(log.slice(-MAX_LOG_LINES)), iso(now().getTime()), iso(now().getTime()), row.id);
      const isCancelled = () => db.prepare('SELECT cancel_requested FROM core_jobs WHERE id = ?').get(row.id)?.cancel_requested === 1;
      const raw = JSON.parse(row.params_json);
      const ctx = {
        jobId: row.job_id,
        params: stripTrace(raw),
        attempt: row.attempts,
        db,
        setProgress(percent, message = null) {
          db.prepare('UPDATE core_jobs SET progress = ?, progress_message = ?, heartbeat_at = ?, updated_at = ? WHERE id = ?').run(Math.max(0, Math.min(100, Math.round(percent))), message, iso(now().getTime()), iso(now().getTime()), row.id);
        },
        log(message) {
          log.push(`${iso(now().getTime())} ${message}`);
          flush();
        },
        isCancelled,
        throwIfCancelled() {
          if (isCancelled()) throw new JobCancelled();
        },
      };
      let outcome;
      const started = process.hrtime.bigint();
      appLog.info({ msg: 'job started', jobId: row.job_id, jobType: row.type, attempt: row.attempts, ...(raw._cid ? { correlationId: raw._cid } : {}) });
      try {
        if (!def) throw new Error(`No handler is registered for job type ${row.type}`);
        const result = await runWithContext({ correlationId: raw._cid ?? undefined }, () => tracer.withSpan(`job ${row.type}`, { kind: 'consumer', parent: parseTraceparent(raw._tp), attributes: { 'job.id': row.job_id, 'job.attempt': row.attempts } }, () => def.handler(ctx)));
        outcome = isCancelled() ? { status: 'CANCELLED' } : { status: 'SUCCEEDED', result };
      } catch (err) {
        if (err instanceof JobCancelled) outcome = { status: 'CANCELLED' };
        else outcome = { status: 'FAILED', error: String(err?.message ?? err).slice(0, 1000) };
      }
      metrics.counter(`jobs.${outcome.status.toLowerCase()}`);
      (outcome.status === 'FAILED' ? appLog.warn : appLog.info)({ msg: `job ${outcome.status.toLowerCase()}`, jobId: row.job_id, jobType: row.type, durationMs: Math.round(Number(process.hrtime.bigint() - started) / 1e6), ...(raw._cid ? { correlationId: raw._cid } : {}), ...(outcome.error ? { error: outcome.error } : {}) });
      return runner.finish(row, outcome, log);
    },

    finish(row, outcome, log) {
      const stamp = iso(now().getTime());
      const current = db.prepare('SELECT * FROM core_jobs WHERE id = ?').get(row.id);
      const existing = JSON.parse(current.log_json);
      const lines = log.length ? log : existing;
      if (outcome.status === 'FAILED') {
        if (current.attempts < current.max_attempts) {
          db.prepare("UPDATE core_jobs SET status = 'QUEUED', error = ?, run_after = ?, log_json = ?, updated_at = ? WHERE id = ?").run(outcome.error, iso(now().getTime() + backoffMs(current.attempts)), JSON.stringify(lines.slice(-MAX_LOG_LINES)), stamp, row.id);
        } else {
          transaction(db, () => {
            db.prepare("UPDATE core_jobs SET status = 'FAILED', error = ?, finished_at = ?, log_json = ?, updated_at = ? WHERE id = ?").run(outcome.error, stamp, JSON.stringify(lines.slice(-MAX_LOG_LINES)), stamp, row.id);
            publishEvent(db, { type: 'core.job.failed', entity: 'job', entityId: row.job_id, actorId: current.created_by, companyId: current.company_id, data: { jobType: current.type, attempts: current.attempts, error: outcome.error } });
          });
        }
      } else if (outcome.status === 'CANCELLED') {
        db.prepare("UPDATE core_jobs SET status = 'CANCELLED', finished_at = ?, progress_message = 'Cancelled', log_json = ?, updated_at = ? WHERE id = ?").run(stamp, JSON.stringify(lines.slice(-MAX_LOG_LINES)), stamp, row.id);
      } else {
        transaction(db, () => {
          db.prepare("UPDATE core_jobs SET status = 'SUCCEEDED', progress = 100, finished_at = ?, error = NULL, result_json = ?, log_json = ?, updated_at = ? WHERE id = ?").run(stamp, outcome.result === undefined ? null : JSON.stringify(outcome.result), JSON.stringify(lines.slice(-MAX_LOG_LINES)), stamp, row.id);
          publishEvent(db, { type: 'core.job.completed', entity: 'job', entityId: row.job_id, actorId: current.created_by, companyId: current.company_id, data: { jobType: current.type } });
        });
      }
      return runner.get(row.id);
    },

    /** Cancel a queued job at once, or ask a running one to stop at its next check. */
    cancel(id, { actor, reason = null, correlationId = null }) {
      return transaction(db, () => {
        const row = db.prepare('SELECT * FROM core_jobs WHERE id = ?').get(id);
        if (!row) throw notFound('That job does not exist.');
        if (!['QUEUED', 'RUNNING'].includes(row.status)) throw unprocessable(`This job is ${row.status.toLowerCase()}, so it cannot be cancelled.`);
        const stamp = iso(now().getTime());
        if (row.status === 'QUEUED') db.prepare("UPDATE core_jobs SET status = 'CANCELLED', finished_at = ?, progress_message = 'Cancelled before it started', cancel_requested = 1, updated_at = ? WHERE id = ?").run(stamp, stamp, id);
        else db.prepare('UPDATE core_jobs SET cancel_requested = 1, progress_message = ?, updated_at = ? WHERE id = ?').run('Cancellation requested', stamp, id);
        writeAudit(db, { entity: 'core_jobs', entityId: id, action: 'cancel', oldValues: { status: row.status }, newValues: { cancelRequested: true }, reason, actor, correlationId });
        return runner.get(id);
      });
    },

    /** Run a failed or cancelled job again as a new queued job with the same parameters. */
    retry(id, { actor, reason = null, correlationId = null }) {
      return transaction(db, () => {
        const row = db.prepare('SELECT * FROM core_jobs WHERE id = ?').get(id);
        if (!row) throw notFound('That job does not exist.');
        if (!['FAILED', 'CANCELLED'].includes(row.status)) throw unprocessable(`This job is ${row.status.toLowerCase()}; only failed or cancelled jobs can be retried.`);
        const fresh = runner.enqueue(row.type, JSON.parse(row.params_json), { createdBy: actor, companyId: row.company_id });
        writeAudit(db, { entity: 'core_jobs', entityId: id, action: 'retry', newValues: { newJobId: fresh.jobId }, reason, actor, correlationId });
        return fresh;
      });
    },

    /** Run due jobs until the queue is empty (tests and the single-process worker). */
    async drain(limit = 100) {
      let ran = 0;
      while (ran < limit && (await runner.runNext())) ran += 1;
      return ran;
    },
  };
  return runner;
}
