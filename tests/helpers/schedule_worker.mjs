// A separate application instance for the scheduler test: opens the shared database file, ticks the scheduler once at
// a fixed time and prints how many jobs this instance queued.
//   node schedule_worker.mjs <database file> <now ISO> <barrier ISO>
import { openDatabase, migrateUp } from '../../src/server/platform/db/index.js';
import { createJobRunner } from '../../src/server/platform/jobs/index.js';
import { createScheduler } from '../../src/server/platform/jobs/scheduler.js';

const [file, nowIso, barrierIso] = process.argv.slice(2);
const db = openDatabase(file);
migrateUp(db);
const jobs = createJobRunner({ db });
jobs.register('test.report', () => 'done');
const scheduler = createScheduler({ db, jobs, now: () => new Date(nowIso) });
// Start together: wait until the barrier time so every instance ticks at the same moment.
while (Date.now() < Date.parse(barrierIso)) await new Promise((r) => setTimeout(r, 5));
process.stdout.write(`${scheduler.tick()}\n`);
db.close();
