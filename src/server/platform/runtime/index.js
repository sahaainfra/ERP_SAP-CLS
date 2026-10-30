import { createEventBus } from '../events/index.js';
import { createJobRunner } from '../jobs/index.js';
import { createScheduler } from '../jobs/scheduler.js';
import { metrics } from '../observability/metrics.js';
import { opsOf } from '../observability/ops.js';

/**
 * One event bus, job runner and scheduler per database, shared by the module that mounts the routes and by the
 * process entry point that starts the workers. Modules reach them through `runtimeOf(db)`.
 */
const runtimes = new WeakMap();

export function runtimeOf(db, options = {}) {
  let rt = runtimes.get(db);
  if (!rt) {
    const bus = createEventBus({ db, ...options.bus });
    const jobs = createJobRunner({ db, ...options.jobs });
    const scheduler = createScheduler({ db, jobs, ...options.scheduler });
    rt = { bus, jobs, scheduler, timers: [] };
    runtimes.set(db, rt);
  }
  return rt;
}

/**
 * Start the polling workers: relay and deliver events, run due jobs, tick the scheduler. Each loop catches its own
 * errors so one failure never stops the others. Returns a function that stops them.
 */
export function startWorkers(db, { intervalMs = 1000, logger = console } = {}) {
  const rt = runtimeOf(db);
  let busy = { events: false, jobs: false, schedule: false, ops: false };
  let ticks = 0;
  const guard = (name, fn) => async () => {
    if (busy[name]) return;
    busy[name] = true;
    try {
      await fn();
    } catch (err) {
      logger.error?.(`worker ${name} failed: ${err?.message ?? err}`);
    } finally {
      busy[name] = false;
    }
  };
  const timers = [
    setInterval(guard('events', () => rt.bus.drain()), intervalMs),
    setInterval(guard('jobs', async () => {
      rt.jobs.recoverStale();
      await rt.jobs.drain(5);
    }), intervalMs),
    setInterval(guard('schedule', () => rt.scheduler.tick()), Math.max(intervalMs, 5000)),
    // Every minute: save the request metrics and check the alert rules; once an hour also remove what is old.
    setInterval(guard('ops', () => {
      const ops = opsOf(db, { metrics, storagePath: process.cwd() });
      ops.tick();
      ticks += 1;
      if (ticks % 60 === 0) ops.purge();
    }), Math.max(intervalMs * 60, 60_000)),
  ];
  for (const t of timers) t.unref?.();
  return () => {
    for (const t of timers) clearInterval(t);
    busy = { events: true, jobs: true, schedule: true, ops: true };
  };
}
