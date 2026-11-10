// npm run erp:plan-baseline-perf -- [--queries 20]
// Part 13.03: fills 50 projects and 20 schedules of 5 000 activities each (as the Gantt timing does), calculates them, adds 100 000 baselines (2 000 a project, each with a small picture) and one real
// baseline of 5 000 activities for every big schedule, then times what the pages ask: the list of baselines and one baseline, a baseline taken of 5 000 activities, the variance, the quality check, the
// schedule written as an MS Project and a P6 file, such a file read, checked and applied to a schedule. Prints the query plans.
// The standard (05_GLOBAL_STANDARDS section 11): a list p95 <= 500 ms, one record <= 300 ms, a save <= 800 ms. Taking a baseline or applying a file of 5 000 activities is a save with the reading of the
// whole schedule (and, for a file, the CPM pass): limit 3 s, as for the calculation of 13.01.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { createPlanService } from '../src/server/modules/plan/service.js';
import { createBaselineService } from '../src/server/modules/plan/baselines.js';

const args = process.argv.slice(2);
const queries = Number(args.includes('--queries') ? args[args.indexOf('--queries') + 1] : 20);
const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys = ON;'); migrateUp(db);
db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'perf')").run();
console.log('Filling...');
db.exec('BEGIN');
const cal = Number(db.prepare("INSERT INTO plan_calendars (company_id, code, name, work_week, status, requested_by, approved_by, created_by) VALUES (1, 'SIX', 'Six-day week', '1111110', 'ACTIVE', 'a', 'b', 'perf')").run().lastInsertRowid);
const projects = []; for (let p = 1; p <= 50; p += 1) projects.push(Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'BUILDING', 'ACTIVE', 't', 'perf')").run(`P${p}`, `Project ${p}`).lastInsertRowid));
const wbsOf = new Map(); for (const pid of projects) { const top = Number(db.prepare("INSERT INTO proj_wbs (company_id, project_id, code, name, level, created_by) VALUES (1, ?, '1', 'Works', 1, 'perf')").run(pid).lastInsertRowid); const kids = []; for (let k = 1; k <= 20; k += 1) kids.push(Number(db.prepare("INSERT INTO proj_wbs (company_id, project_id, parent_id, code, name, level, created_by) VALUES (1, ?, ?, ?, ?, 2, 'perf')").run(pid, top, `1.${k}`, `Part ${k}`).lastInsertRowid)); wbsOf.set(pid, { top, kids }); }
const insS = db.prepare("INSERT INTO plan_schedules (company_id, doc_no, doc_date, org_project_id, name, version_no, calendar_id, start_date, status, activities_count, created_by, source_type) VALUES (1, ?, '2026-04-01', ?, ?, ?, ?, '2026-04-06', ?, ?, 'perf', 'perf')");
const big = []; let n = 0;
for (const pid of projects) for (let v = 1; v <= 20; v += 1) { n += 1; const live = v === 20 && big.length < 20 && pid <= projects[19]; const id = Number(insS.run(`SCH/${String(n).padStart(5, '0')}`, pid, `Schedule ${n}`, v, cal, live ? 'DRAFT' : 'SUPERSEDED', live ? 5000 : 0).lastInsertRowid); if (live) big.push({ id, pid }); }
const insA = db.prepare("INSERT INTO plan_activities (company_id, schedule_id, code, name, wbs_id, act_type, duration_days, sort_order, project_id, created_by, source_type) VALUES (1, ?, ?, ?, ?, 'TASK', ?, ?, ?, 'perf', 'perf')");
const insL = db.prepare("INSERT INTO plan_dependencies (company_id, schedule_id, pred_id, succ_id, dep_type, lag_days, project_id, created_by) VALUES (1, ?, ?, ?, ?, ?, ?, 'perf')");
for (const s of big) {
  const ids = []; const kids = wbsOf.get(s.pid).kids;
  for (let i = 0; i < 5000; i += 1) ids.push(Number(insA.run(s.id, `A${i}`, `Activity ${i}`, kids[i % 20], 1 + (i % 9), i, s.pid).lastInsertRowid));
  for (let i = 1; i < 5000; i += 1) { if (i % 100 === 0) continue; /* 50 chains of 100 activities side by side: a programme of about two years */ insL.run(s.id, ids[i - 1], ids[i], 'FS', 0, s.pid); if (i % 100 > 7 && i % 2 === 0) insL.run(s.id, ids[i - 7], ids[i], 'SS', 2, s.pid); }
}
const TRADES = ['Mason', 'Carpenter', 'Bar bender', 'Helper', 'Electrician', 'Plumber', 'Painter', 'Welder'];
const PLANT = ['Tower crane', 'Concrete pump', 'Transit mixer', 'Excavator'];
const MAT = ['Cement', 'Steel', 'Sand', 'Aggregate'];
const insR = db.prepare("INSERT INTO plan_activity_resources (company_id, schedule_id, activity_id, resource_type, trade, res_key, label, uom, basis, qty_total, qty_per_day, project_id, created_by, source_type) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'perf', 'MANUAL')");
for (const s of big) {
  const acts = db.prepare('SELECT id, duration_days AS d FROM plan_activities WHERE schedule_id = ? ORDER BY id').all(s.id);
  acts.forEach((a, i) => {
    const kind = i % 10 < 6 ? 'LABOUR' : i % 10 < 8 ? 'PLANT' : 'MATERIAL'; const names = kind === 'LABOUR' ? TRADES : kind === 'PLANT' ? PLANT : MAT; const name = names[i % names.length];
    const perDay = (2 + (i % 7)) * 1000; insR.run(s.id, a.id, kind, name, `trade:${name.toLowerCase()}`, name, kind === 'LABOUR' ? 'Nos' : kind === 'PLANT' ? 'Hrs' : 'MT', i % 3 ? 'PER_DAY' : 'TOTAL', perDay * Number(a.d), perDay, s.pid);
  });
}
db.exec('COMMIT'); db.exec('ANALYZE');
console.log(`${db.prepare('SELECT COUNT(*) AS n FROM plan_activities').get().n} activities, ${db.prepare('SELECT COUNT(*) AS n FROM plan_dependencies').get().n} links, ${db.prepare('SELECT COUNT(*) AS n FROM plan_activity_resources').get().n} resource rows.`);
const svc = createPlanService({ db }).plan; const bl = createBaselineService({ db, plan: svc });
const planner = { user: 'planner', roles: ['PLAN'], companyId: 1 };
for (const s of big) svc.runCalc(planner, s.id);
console.log('Calculated.');
db.exec('BEGIN');
const insB = db.prepare("INSERT INTO plan_baselines (company_id, doc_no, doc_date, org_project_id, schedule_id, baseline_no, name, revision_type, reason, snapshot_json, snapshot_hash, start_date, finish_date, activities_count, status, requested_by, approved_by, approved_at, project_id, created_by, source_type) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'Filled for the timing', '{}', 'x', '2026-04-06', '2028-03-31', 100, ?, 'a', 'b', '2026-05-01', ?, 'perf', 'perf')");
let bn = 0; const anySchedule = new Map(db.prepare('SELECT org_project_id AS p, MIN(id) AS id FROM plan_schedules GROUP BY org_project_id').all().map((r) => [r.p, r.id]));
for (const pid of projects) for (let k = 0; k < 2000; k += 1) { bn += 1; insB.run(`BLX/${String(bn).padStart(6, '0')}`, `2026-${String(1 + (k % 12)).padStart(2, '0')}-15`, pid, anySchedule.get(pid), 1000 + k, `Baseline ${bn}`, k % 4 ? 'EOT' : 'RESEQUENCE', ['APPROVED', 'REJECTED', 'CANCELLED', 'APPROVED'][k % 4], pid); }
db.exec('COMMIT');
const real = big.map((s) => bl.baselines.create(planner, { scheduleId: s.id, name: 'Contract programme', revisionType: 'EOT', reason: 'The programme for the timing' }));
// the first of them is made the current baseline of its project, as an approval would
for (const b of real) db.prepare("UPDATE plan_baselines SET status = 'APPROVED', is_current = 1, approved_by = 'pd', approved_at = '2026-05-02' WHERE id = ?").run(b.id);
// the schedules move on: every tenth activity a day longer
for (const s of big) { db.prepare('UPDATE plan_activities SET duration_days = duration_days + 1 WHERE schedule_id = ? AND id % 10 = 0').run(s.id); svc.runCalc(planner, s.id); }
db.exec('ANALYZE');
console.log(`${db.prepare('SELECT COUNT(*) AS n FROM plan_baselines').get().n} baselines, ${db.prepare('SELECT COUNT(*) AS n FROM plan_activities').get().n} activities.\n`);
const results = []; const p95 = (ms) => [...ms].sort((a, b) => a - b)[Math.floor(ms.length * 0.95)] ?? 0;
const record = (label, limit, ms) => { const p = p95(ms); results.push({ label, p, limit }); console.log(`${label.padEnd(52)} p50 ${[...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)].toFixed(1).padStart(8)} ms   p95 ${p.toFixed(1).padStart(8)} ms   limit ${limit} ms`); };
const time = (label, limit, fn, k = queries) => { const ms = []; for (let i = 0; i < k; i += 1) { const t = performance.now(); fn(i); ms.push(performance.now() - t); } record(label, limit, ms); };
const S = (i) => big[i % big.length].id; const B = (i) => real[i % real.length].id;
const VQ = { scheduleId: null, withBaselineId: null, only: 'all', wbs: null, q: '', sort: '-finishVar', page: 1, pageSize: 50 }; const QQ = { highFloat: 44, longDuration: 44, tolerance: 5, check: null, page: 1, pageSize: 50 };
time('list of baselines, first page (100 000 rows)', 500, () => bl.baselines.list(planner, { pageSize: '50' }));
time('list of baselines, approved of one project', 500, (i) => bl.baselines.list(planner, { 'filter[status]': 'APPROVED', 'filter[projectId]': String(projects[i % 50]), pageSize: '50' }));
time('list of baselines, search by number', 500, (i) => bl.baselines.list(planner, { q: `BLX/0${String(10000 + i * 37)}`, pageSize: '25' }));
time('baselines of a project (2 001 rows) with the current one', 500, (i) => bl.baselines.ofProject(planner, big[i % big.length].pid));
time('one baseline', 300, (i) => bl.baselines.get(planner, B(i)));
time('current baseline of a project with its 5 000 activities', 500, (i) => bl.baselines.current(planner, big[i % big.length].pid));
time('variance of 5 000 activities, first page', 500, (i) => bl.variance(planner, B(i), VQ));
time('variance, the critical slips only', 500, (i) => bl.variance(planner, B(i), { ...VQ, only: 'critical' }));
time('quality check of 5 000 activities (14 checks)', 500, (i) => bl.quality(planner, QQ, { scheduleId: S(i) }));
time('baseline dates for the Gantt of 5 000 activities', 500, (i) => bl.ganttBaseline(planner, db.prepare('SELECT * FROM plan_schedules WHERE id = ?').get(S(i))));
time('schedule of 5 000 activities as an MS Project file', 3000, (i) => bl.exchangeFile(planner, { scheduleId: S(i) }, { format: 'msp' }), 5);
time('schedule of 5 000 activities as a P6 file', 3000, (i) => bl.exchangeFile(planner, { scheduleId: S(i) }, { format: 'p6' }), 5);
// a revision taken of 5 000 activities (with the change against the current baseline), then deleted so the next one can be taken
time('a baseline taken of 5 000 activities', 3000, (i) => { const b = bl.baselines.create(planner, { scheduleId: S(i), name: 'Revision', revisionType: 'EOT', reason: 'Timing of a revision' }); bl.baselines.remove(planner, b.id); }, 5);
// a file of 5 000 activities read, checked and applied to a blank schedule of another project
const file = bl.exchangeFile(planner, { scheduleId: big[0].id }, { format: 'msp' }).buffer; console.log(`\nMS Project file of 5 000 activities: ${(file.length / 1e6).toFixed(1)} MB`);
const targets = []; for (let k = 0; k < 3; k += 1) { const pid = projects[30 + k]; db.prepare("UPDATE plan_schedules SET status = 'CANCELLED' WHERE org_project_id = ?").run(pid); targets.push(svc.schedules.create(planner, { projectId: pid, name: 'From the file', calendarId: cal, startDate: '2026-04-06' }).id); }
const read = []; time('file of 5 000 activities read and checked', 3000, (i) => read.push(bl.imports.analyse(planner, { scheduleId: targets[i], format: null, fileName: 'big.xml' }, file)), 3);
time('file of 5 000 activities applied and calculated', 3000, (i) => { const r = bl.imports.apply(planner, read[i].id, {}); if (r.result.applied.created !== 5000) throw new Error('not applied'); }, 3);
console.log('\nQuery plans:');
for (const [label, sql] of [
  ['list, newest first', "SELECT x.id FROM plan_baselines x JOIN org_projects p ON p.id = x.org_project_id WHERE x.deleted_at IS NULL AND x.company_id = 1 ORDER BY x.doc_date DESC, x.id LIMIT 50"],
  ['list, status of a project', "SELECT x.id FROM plan_baselines x WHERE x.deleted_at IS NULL AND x.org_project_id = 5 AND x.status = 'APPROVED' ORDER BY x.baseline_no"],
  ['current baseline of a project', 'SELECT x.id FROM plan_baselines x WHERE x.org_project_id = 5 AND x.is_current = 1 AND x.deleted_at IS NULL'],
  ['open baseline of a project', "SELECT id FROM plan_baselines WHERE org_project_id = 5 AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL"],
  ['imports of a schedule', 'SELECT id FROM plan_imports WHERE org_project_id = 5 AND deleted_at IS NULL AND schedule_id = 9 ORDER BY id DESC LIMIT 100'],
]) console.log(`- ${label}: ${db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ')}`);
const over = results.filter((r) => r.p > r.limit);
console.log(over.length ? `\nOVER THE LIMIT: ${over.map((r) => r.label).join('; ')}` : '\nAll within the limits.');
process.exit(over.length ? 1 : 0);
