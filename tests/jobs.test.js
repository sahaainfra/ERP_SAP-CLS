import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cronProblem, nextRun, nextRuns, parseCron } from '../src/shared/cron.js';
import { createJobRunner, JobCancelled } from '../src/server/platform/jobs/index.js';
import { createScheduler } from '../src/server/platform/jobs/scheduler.js';
import { openDatabase, migrateUp, ROOT } from '../src/server/platform/db/index.js';
import { memoryDb } from './helpers.js';

const clocked = (db, start = '2026-10-30T10:00:00.000Z', opts = {}) => {
  const clock = { t: Date.parse(start) };
  const jobs = createJobRunner({ db, now: () => new Date(clock.t), ...opts });
  return { jobs, clock };
};
const row = (db, id) => ({ ...db.prepare('SELECT * FROM core_jobs WHERE id = ?').get(id) });

// ---- cron ----
test('cron expressions are evaluated in Indian Standard Time', () => {
  assert.equal(nextRun('0 2 * * *', '2026-10-30T12:00:00.000Z'), '2026-10-30T20:30:00.000Z', '02:00 IST is 20:30 UTC the day before');
  assert.equal(nextRun('0 2 * * *', '2026-10-30T20:30:00.000Z'), '2026-10-31T20:30:00.000Z', 'strictly after the given time');
  assert.equal(nextRun('*/15 * * * *', '2026-10-30T10:07:30.000Z'), '2026-10-30T10:15:00.000Z');
  assert.equal(nextRun('30 9 * * 1-5', '2026-10-30T10:00:00.000Z'), '2026-11-02T04:00:00.000Z', 'Friday 15:30 IST -> Monday 09:30 IST');
  assert.equal(nextRun('0 0 1 * *', '2026-10-30T10:00:00.000Z'), '2026-10-31T18:30:00.000Z', 'first of the month, midnight IST');
  assert.equal(nextRun('0 12 29 2 *', '2026-10-30T10:00:00.000Z'), '2028-02-29T06:30:00.000Z', 'leap day');
  assert.deepEqual(nextRuns('0 9,17 * * *', '2026-10-30T00:00:00.000Z', 3), ['2026-10-30T03:30:00.000Z', '2026-10-30T11:30:00.000Z', '2026-10-31T03:30:00.000Z']);
  const both = parseCron('0 9 15 * 1');
  assert.ok(!both.domAny && !both.dowAny);
  assert.equal(nextRun('0 9 15 * 1', '2026-10-30T10:00:00.000Z'), '2026-11-02T03:30:00.000Z', 'day-of-month OR day-of-week when both are given: Monday 2 Nov comes before the 15th');
});

test('invalid schedules are refused with a message that says what is wrong', () => {
  for (const [expr, text] of [['* * * *', /five fields/], ['61 * * * *', /minute field must be between/], ['* 24 * * *', /hour/], ['* * 0 * *', /day of month/], ['* * * 13 *', /month/], ['*/0 * * * *', /step/], ['a b c d e', /not valid/], ['5-2 * * * *', /between/]]) {
    assert.match(cronProblem(expr), text, expr);
  }
  assert.equal(cronProblem('0 2 * * 7'), null, '7 is Sunday');
  assert.throws(() => nextRun('0 0 31 2 *', '2026-01-01T00:00:00.000Z'), /never runs/);
});

// ---- jobs ----
test('FR-06 a queued job runs with progress, a log and a result, and announces its completion', async () => {
  const db = memoryDb();
  const { jobs } = clocked(db);
  jobs.register('test.report', (ctx) => {
    ctx.log(`started with ${ctx.params.rows} rows`);
    ctx.setProgress(40, 'halfway');
    ctx.setProgress(250); // clamped
    return { rows: ctx.params.rows * 2 };
  });
  const queued = jobs.enqueue('test.report', { rows: 21 }, { createdBy: 'asha', companyId: 1 });
  assert.deepEqual([queued.status, queued.progress, queued.attempts], ['QUEUED', 0, 0]);
  const done = await jobs.runNext();
  assert.deepEqual([done.status, done.progress, done.result, done.attempts], ['SUCCEEDED', 100, { rows: 42 }, 1]);
  assert.match(done.log[0], /started with 21 rows/);
  assert.equal(await jobs.runNext(), null, 'nothing else is due');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'core.job.completed'").get().n, 1);
  assert.throws(() => jobs.enqueue('test.nope', {}), /no job type/);
  assert.throws(() => jobs.register('Bad Type', () => {}), /module.job_name/);
  assert.throws(() => jobs.register('test.report', () => {}), /already registered/);
});

test('FR-06 a failing job retries with back-off and, after its last attempt, fails and says so', async () => {
  const db = memoryDb();
  const { jobs, clock } = clocked(db);
  let calls = 0;
  jobs.register('test.flaky', () => {
    calls += 1;
    throw new Error('upstream unavailable');
  }, { maxAttempts: 3 });
  const { id } = jobs.enqueue('test.flaky', {});
  let r = await jobs.runNext();
  assert.deepEqual([r.status, r.attempts, r.error], ['QUEUED', 1, 'upstream unavailable']);
  assert.equal(await jobs.runNext(), null, 'not due before the back-off has passed');
  assert.equal(Date.parse(row(db, id).run_after) - clock.t, 60_000);
  clock.t += 60_000;
  r = await jobs.runNext();
  assert.deepEqual([r.status, r.attempts], ['QUEUED', 2]);
  clock.t += 120_000;
  r = await jobs.runNext();
  assert.deepEqual([r.status, r.attempts, calls], ['FAILED', 3, 3]);
  const event = db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'core.job.failed'").get();
  assert.equal(JSON.parse(event.payload).data.error, 'upstream unavailable');
});

test('FR-06 cancellation: a queued job stops at once, a running job stops at its next check', async () => {
  const db = memoryDb();
  const { jobs } = clocked(db);
  let release;
  const gate = new Promise((r) => (release = r));
  jobs.register('test.long', async (ctx) => {
    ctx.setProgress(10, 'working');
    await gate;
    ctx.throwIfCancelled();
    return 'finished';
  }, { maxAttempts: 1 });
  const queued = jobs.enqueue('test.long', {});
  const out = jobs.cancel(queued.id, { actor: 'itadm', reason: 'no longer needed' });
  assert.equal(out.status, 'CANCELLED');
  assert.equal(await jobs.runNext(), null);
  assert.throws(() => jobs.cancel(queued.id, { actor: 'itadm' }), /cannot be cancelled/);

  const running = jobs.enqueue('test.long', {});
  const pending = jobs.runNext();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(row(db, running.id).status, 'RUNNING');
  const asked = jobs.cancel(running.id, { actor: 'itadm', reason: 'wrong parameters' });
  assert.deepEqual([asked.status, asked.cancelRequested], ['RUNNING', true]);
  release();
  const finished = await pending;
  assert.equal(finished.status, 'CANCELLED');
  assert.ok(JobCancelled);
  const retried = jobs.retry(running.id, { actor: 'itadm', reason: 'parameters corrected' });
  assert.deepEqual([retried.status, retried.attempts], ['QUEUED', 0]);
  assert.throws(() => jobs.retry(retried.id, { actor: 'itadm' }), /only failed or cancelled/);
  const audit = db.prepare("SELECT action FROM core_audit_log WHERE entity = 'core_jobs' ORDER BY id").all().map((a) => a.action);
  assert.deepEqual(audit, ['cancel', 'cancel', 'retry']);
});

test('a job claimed by two runners on the same queue runs once', async () => {
  const db = memoryDb();
  const a = clocked(db).jobs;
  const b = clocked(db).jobs;
  let runs = 0;
  for (const j of [a, b]) j.register('test.once', async () => { runs += 1; await new Promise((r) => setTimeout(r, 5)); });
  a.enqueue('test.once', {});
  const results = await Promise.all([a.runNext(), b.runNext()]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(runs, 1);
});

test('a job left RUNNING by a dead worker goes back to the queue', async () => {
  const db = memoryDb();
  const { jobs, clock } = clocked(db, undefined, { staleAfterMs: 5 * 60_000 });
  jobs.register('test.crash', () => 'ok');
  const { id } = jobs.enqueue('test.crash', {});
  db.prepare("UPDATE core_jobs SET status = 'RUNNING', started_at = ?, heartbeat_at = ?, attempts = 1 WHERE id = ?").run(new Date(clock.t).toISOString(), new Date(clock.t).toISOString(), id);
  assert.equal(jobs.recoverStale(), 0, 'a fresh heartbeat is left alone');
  clock.t += 6 * 60_000;
  assert.equal(jobs.recoverStale(), 1);
  assert.equal((await jobs.runNext()).status, 'SUCCEEDED');
});

// ---- schedules ----
test('FR-06 a schedule queues a job when due, advances its next run, and runs a missed slot once', () => {
  const db = memoryDb();
  const { jobs, clock } = clocked(db, '2026-10-30T10:00:00.000Z');
  jobs.register('test.report', () => 'done');
  const scheduler = createScheduler({ db, jobs, now: () => new Date(clock.t) });
  scheduler.define({ code: 'test.nightly', cron: '0 2 * * *', jobType: 'test.report', params: { x: 1 } });
  const s = scheduler.list()[0];
  assert.equal(s.nextRunAt, '2026-10-30T20:30:00.000Z');
  assert.equal(scheduler.tick(), 0, 'not due yet');
  clock.t = Date.parse('2026-10-30T20:30:05.000Z');
  assert.equal(scheduler.tick(), 1);
  assert.equal(scheduler.tick(), 0, 'the same slot never runs twice');
  const job = db.prepare('SELECT * FROM core_jobs').get();
  assert.deepEqual([job.type, job.created_by, job.schedule_code, job.scheduled_for, JSON.parse(job.params_json)], ['test.report', 'scheduler', 'test.nightly', '2026-10-30T20:30:00.000Z', { x: 1 }]);
  assert.equal(scheduler.get(s.id).nextRunAt, '2026-10-31T20:30:00.000Z');
  clock.t = Date.parse('2026-11-04T00:00:00.000Z'); // four slots missed while the system was down
  assert.equal(scheduler.tick(), 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM core_jobs').get().n, 2, 'one catch-up run, not one per missed slot');
  scheduler.define({ code: 'test.nightly', cron: '5 5 * * *', jobType: 'test.report' });
  assert.equal(scheduler.get(s.id).cron, '0 2 * * *', 'defining again never overwrites an edited schedule');
  assert.throws(() => scheduler.define({ code: 'test.bad', cron: 'nope', jobType: 'test.report' }), /five fields/);
});

test('a disabled schedule does not run', () => {
  const db = memoryDb();
  const { jobs, clock } = clocked(db);
  jobs.register('test.report', () => 'done');
  const scheduler = createScheduler({ db, jobs, now: () => new Date(clock.t) });
  scheduler.define({ code: 'test.off', cron: '* * * * *', jobType: 'test.report', enabled: false });
  clock.t += 3_600_000;
  assert.equal(scheduler.tick(), 0);
});

test('T-04 a scheduled job runs once across several application instances ticking at the same moment', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'erp-sched-'));
  const file = join(dir, 'sched.sqlite');
  try {
    const db = openDatabase(file);
    migrateUp(db);
    const jobs = createJobRunner({ db });
    jobs.register('test.report', () => 'done');
    const scheduler = createScheduler({ db, jobs, now: () => new Date('2026-10-30T10:00:00.000Z') });
    scheduler.define({ code: 'test.shared', cron: '0 2 * * *', jobType: 'test.report' });
    db.close();
    const barrier = new Date(Date.now() + 1500).toISOString();
    const runs = await Promise.all(
      [1, 2, 3, 4].map(
        () =>
          new Promise((resolve, reject) => {
            const child = spawn(process.execPath, ['tests/helpers/schedule_worker.mjs', file, '2026-10-30T20:31:00.000Z', barrier], { cwd: ROOT });
            let out = '';
            let err = '';
            child.stdout.on('data', (d) => (out += d));
            child.stderr.on('data', (d) => (err += d));
            child.on('close', (code) => (code === 0 ? resolve(Number(out.trim())) : reject(new Error(err))));
          }),
      ),
    );
    assert.equal(runs.reduce((a, b) => a + b, 0), 1, `queued per instance: ${runs.join(', ')}`);
    const check = openDatabase(file);
    assert.equal(check.prepare('SELECT COUNT(*) AS n FROM core_jobs').get().n, 1);
    check.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an approved change is applied to a schedule with an audit row and an event', () => {
  const db = memoryDb();
  const { jobs, clock } = clocked(db);
  jobs.register('test.report', () => 'done');
  const scheduler = createScheduler({ db, jobs, now: () => new Date(clock.t) });
  scheduler.define({ code: 'test.edit', cron: '0 2 * * *', jobType: 'test.report' });
  const { id } = scheduler.list()[0];
  const out = scheduler.applyChange(id, { cron: '0 4 * * *', enabled: false }, { actor: 'sysadmin', reason: 'move after the backup' });
  assert.deepEqual([out.cron, out.enabled, out.nextRunAt], ['0 4 * * *', false, '2026-10-30T22:30:00.000Z']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'core_schedules'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'core.schedule.changed'").get().n, 1);
  assert.throws(() => scheduler.applyChange(id, { cron: 'bad' }, { actor: 'x' }), /five fields/);
  assert.throws(() => scheduler.applyChange(999, {}, { actor: 'x' }), /does not exist/);
});
