import { HttpError } from '../http/errors.js';

/**
 * Period locks of project data (part 27.07 FR-04). A module that closes a month for a project registers a source here; the modules that keep
 * project records ask `assertProjectPeriodOpen` before they create, change, send or amend a record dated in that month. The rule lives with the
 * owner of the lock (the monthly close), and the record modules never read its tables: they only call this guard.
 *
 *   projectPeriodLocks.register({ code, locked(db, { companyId, projectId, date }) -> null | { ref, period, lockedAt } })
 *   assertProjectPeriodOpen(db, { companyId, projectId, date, what })   throws 422 PERIOD_LOCKED when a source reports a lock
 */
const sources = new Map();
export const projectPeriodLocks = {
  register(source) {
    if (!source?.code || typeof source.locked !== 'function') throw new Error('A period lock source needs a code and a locked() function');
    sources.set(source.code, source);
  },
  list: () => [...sources.values()],
};

/** The first lock that covers the date, or null. */
export function projectPeriodLock(db, { companyId, projectId, date }) {
  if (!companyId || !projectId || !date) return null;
  for (const source of sources.values()) {
    const lock = source.locked(db, { companyId: Number(companyId), projectId: Number(projectId), date: String(date).slice(0, 10) });
    if (lock) return { source: source.code, ...lock };
  }
  return null;
}

export function assertProjectPeriodOpen(db, { companyId, projectId, date, what = 'record' }) {
  const lock = projectPeriodLock(db, { companyId, projectId, date });
  if (lock) {
    throw new HttpError(422, 'PERIOD_LOCKED', `The month ${lock.period} of this project is closed and locked (${lock.ref}): a ${what} dated ${String(date).slice(0, 10)} cannot be created or changed. Record the correction in the next open month.`,
      [{ field: 'date', message: `${lock.period} is locked` }]);
  }
}
