import { transaction } from '../db/index.js';
import { writeAudit } from '../audit/index.js';
import { publishEvent } from '../events/index.js';
import { cronProblem, nextRun } from '../../../shared/cron.js';
import { badRequest, notFound } from '../http/errors.js';

const iso = (ms) => new Date(ms).toISOString();

/**
 * Scheduled jobs (FR-06). `tick` finds due schedules and queues a job for each. Only one instance can win a run: the
 * schedule row is advanced with a compare-and-swap on next_run_at, and the job row is unique per (schedule, scheduled time),
 * so two application instances ticking at the same moment queue exactly one job. A schedule that was missed while
 * the system was down runs once, not once per missed slot.
 */
export function createScheduler({ db, jobs, now = () => new Date() }) {
  const present = (s) => ({
    id: s.id,
    code: s.code,
    description: s.description,
    cron: s.cron,
    jobType: s.job_type,
    params: JSON.parse(s.params_json),
    enabled: s.enabled === 1,
    lastRunAt: s.last_run_at,
    nextRunAt: s.next_run_at,
    version: s.version,
    updatedBy: s.updated_by ?? s.created_by,
    updatedAt: s.updated_at ?? s.created_at,
  });

  const scheduler = {
    present,

    /** Make sure a schedule exists. An existing row (possibly edited by an administrator) is left as it is. */
    define({ code, cron, jobType, params = {}, description = '', enabled = true }) {
      const problem = cronProblem(cron);
      if (problem) throw new Error(`Schedule ${code}: ${problem}`);
      db.prepare(
        `INSERT OR IGNORE INTO core_schedules (code, description, cron, job_type, params_json, enabled, next_run_at, created_by, source_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'system', 'schedule_seed')`,
      ).run(code, description, cron, jobType, JSON.stringify(params), enabled ? 1 : 0, nextRun(cron, now()));
    },

    list: () => db.prepare('SELECT * FROM core_schedules WHERE is_active = 1 ORDER BY code').all().map(present),
    get: (id) => {
      const s = db.prepare('SELECT * FROM core_schedules WHERE id = ? AND is_active = 1').get(id);
      return s ? present(s) : null;
    },

    /** Queue jobs for every due schedule. Returns how many this instance queued. */
    tick() {
      const at = now();
      const due = db.prepare('SELECT * FROM core_schedules WHERE enabled = 1 AND is_active = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at, id').all(iso(at.getTime()));
      let queued = 0;
      for (const s of due) {
        const won = transaction(db, () => {
          const advanced = db
            .prepare('UPDATE core_schedules SET last_run_at = ?, next_run_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND next_run_at = ? AND enabled = 1')
            .run(iso(at.getTime()), nextRun(s.cron, at), iso(at.getTime()), s.id, s.next_run_at);
          if (advanced.changes !== 1) return false; // another instance took this run
          jobs.enqueue(s.job_type, JSON.parse(s.params_json), { createdBy: 'scheduler', scheduleCode: s.code, scheduledFor: s.next_run_at });
          return true;
        });
        if (won) queued += 1;
      }
      return queued;
    },

    /** Apply an approved change (cron, enabled, params). Called by the approval handler in the approver's transaction. */
    applyChange(id, changes, { actor, reason, correlationId = null }) {
      const s = db.prepare('SELECT * FROM core_schedules WHERE id = ? AND is_active = 1').get(id);
      if (!s) throw notFound('That schedule does not exist.');
      const cron = changes.cron ?? s.cron;
      const problem = cronProblem(cron);
      if (problem) throw badRequest(problem, [{ field: 'cron', message: problem }]);
      const enabled = changes.enabled === undefined ? s.enabled : changes.enabled ? 1 : 0;
      const params = changes.params === undefined ? s.params_json : JSON.stringify(changes.params);
      const stamp = iso(now().getTime());
      db.prepare('UPDATE core_schedules SET cron = ?, enabled = ?, params_json = ?, next_run_at = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?').run(cron, enabled, params, nextRun(cron, now()), actor, stamp, id);
      writeAudit(db, {
        entity: 'core_schedules',
        entityId: id,
        action: 'update',
        oldValues: { cron: s.cron, enabled: s.enabled === 1 },
        newValues: { cron, enabled: enabled === 1 },
        reason,
        actor,
        correlationId,
      });
      publishEvent(db, { type: 'core.schedule.changed', entity: 'schedule', entityId: id, actorId: actor, data: { code: s.code, cron, enabled: enabled === 1 } });
      return scheduler.get(id);
    },
  };
  return scheduler;
}
