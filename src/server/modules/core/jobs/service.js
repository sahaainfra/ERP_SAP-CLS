import { assertPermission } from '../../../platform/auth/index.js';
import { companyScope } from '../../../platform/db/scope.js';
import { badRequest, conflict, notFound, unprocessable } from '../../../platform/http/errors.js';
import { likePattern, pageResponse } from '../../../platform/pagination/index.js';
import { cronProblem, nextRuns } from '../../../../shared/cron.js';

/** Approved schedule changes are applied by the scheduler in the approver's transaction (maker-checker). */
export const createScheduleChangeHandler = (scheduler) => ({
  apply(_db, request, actor) {
    scheduler.applyChange(request.payload.scheduleId, request.payload.changes, { actor: actor.user, reason: request.reason });
  },
});

/** Background jobs and schedules: the lists, cancel and retry, and change requests for schedules. */
export function createJobService({ db, jobs, scheduler, approvals }) {
  const companyOf = (actor) => companyScope(actor).params._company_scope;
  const visible = (actor, row) => row && (row.company_id === null || row.company_id === companyOf(actor));
  const jobOrThrow = (actor, id) => {
    const row = db.prepare('SELECT * FROM core_jobs WHERE id = ?').get(id);
    if (!visible(actor, row)) throw notFound('That job does not exist.');
    return row;
  };

  return {
    types(actor) {
      assertPermission(actor, 'core.jobs.view');
      return jobs.types();
    },

    list(actor, query) {
      assertPermission(actor, 'core.jobs.view');
      const params = { c: companyOf(actor), q: likePattern(query.q), status: query.filters.status ?? null, type: query.filters.type ?? null };
      const where = "(company_id IS NULL OR company_id = :c) AND type LIKE :q ESCAPE '\\' AND (:status IS NULL OR status = :status) AND (:type IS NULL OR type = :type)";
      const total = db.prepare(`SELECT COUNT(*) AS n FROM core_jobs WHERE ${where}`).get(params).n;
      const sort = query.sort[0];
      const column = { id: 'id', startedAt: 'started_at' }[sort?.column] ?? 'id';
      const rows = db.prepare(`SELECT * FROM core_jobs WHERE ${where} ORDER BY ${column} ${sort?.dir === 'asc' ? 'ASC' : 'DESC'}, id DESC LIMIT :limit OFFSET :offset`).all({ ...params, limit: query.limit, offset: query.offset });
      return pageResponse(rows.map(jobs.present), total, query);
    },

    get(actor, id) {
      assertPermission(actor, 'core.jobs.view');
      return jobs.present(jobOrThrow(actor, id));
    },

    cancel(actor, id, { reason }, correlationId) {
      assertPermission(actor, 'core.jobs.manage');
      jobOrThrow(actor, id);
      return jobs.cancel(id, { actor: actor.user, reason: reason ?? null, correlationId });
    },

    retry(actor, id, { reason }, correlationId) {
      assertPermission(actor, 'core.jobs.manage');
      jobOrThrow(actor, id);
      return jobs.retry(id, { actor: actor.user, reason: reason ?? null, correlationId });
    },

    schedules(actor) {
      assertPermission(actor, 'core.schedule.view');
      companyOf(actor);
      return scheduler.list();
    },

    /** The next run times for an expression, shown in the cron editor before anything is saved. */
    preview(actor, { cron, count }) {
      assertPermission(actor, 'core.schedule.view');
      const problem = cronProblem(cron);
      if (problem) throw badRequest(problem, [{ field: 'cron', message: problem }]);
      return { cron, nextRuns: nextRuns(cron, new Date(), count) };
    },

    /** Changing a schedule is maker-checker: the IT Administrator asks, the System Administrator decides. */
    requestChange(actor, id, { changes, reason }) {
      assertPermission(actor, 'core.schedule.manage');
      const companyId = companyOf(actor);
      const s = scheduler.get(id) ?? (() => { throw notFound('That schedule does not exist.'); })();
      if (changes.cron !== undefined) {
        const problem = cronProblem(changes.cron);
        if (problem) throw badRequest(problem, [{ field: 'changes.cron', message: problem }]);
      }
      const effective = { cron: changes.cron ?? s.cron, enabled: changes.enabled ?? s.enabled };
      if (effective.cron === s.cron && effective.enabled === s.enabled) throw unprocessable('Nothing would change: the requested values are the current ones.');
      if (approvals.hasOpen(companyId, 'schedule_change', 'schedule', id)) throw conflict('There is already an open change request for this schedule. Decide or withdraw it first.');
      return approvals.submit(actor, {
        type: 'schedule_change',
        title: `Change schedule ${s.code}`,
        targetType: 'schedule',
        targetId: id,
        payload: { scheduleId: id, changes: Object.fromEntries(Object.entries(effective).filter(([k, v]) => v !== s[k])), from: { cron: s.cron, enabled: s.enabled } },
        reason,
        chain: ['SYSADM'],
      });
    },
  };
}
