// npm run erp:plan-perf -- [--queries 20]
// Part 13.01: fills 50 projects, 20 schedules of 5 000 activities each (100 000 activities, about 150 000 links) and 1 000 schedule versions, then times what the pages ask: the schedule list, the activities grid (a page, critical,
// delayed, a WBS branch, a search, a deep page), the CPM pass of a 5 000-activity schedule (FR-06: under 3 s), the float report, and a save. Prints the query plans.
// The standard (05_GLOBAL_STANDARDS section 11): a list p95 <= 500 ms, one record <= 300 ms, a save <= 800 ms; the pass of 5 000 activities < 3 s.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { createPlanService } from '../src/server/modules/plan/service.js';

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
  for (let i = 1; i < 5000; i += 1) { insL.run(s.id, ids[i - 1], ids[i], 'FS', 0, s.pid); if (i > 7 && i % 2 === 0) insL.run(s.id, ids[i - 7], ids[i], 'SS', 2, s.pid); }
}
db.exec('COMMIT'); db.exec('ANALYZE');
console.log(`${db.prepare('SELECT COUNT(*) AS n FROM plan_schedules').get().n} schedules, ${db.prepare('SELECT COUNT(*) AS n FROM plan_activities').get().n} activities, ${db.prepare('SELECT COUNT(*) AS n FROM plan_dependencies').get().n} links.\n`);
const svc = createPlanService({ db }).plan; const planner = { user: 'planner', roles: ['PLAN'], companyId: 1 };
const results = []; const p95 = (ms) => [...ms].sort((a, b) => a - b)[Math.floor(ms.length * 0.95)] ?? 0;
const time = (label, limit, fn, k = queries) => { const ms = []; for (let i = 0; i < k; i += 1) { const t = performance.now(); fn(i); ms.push(performance.now() - t); } const p = p95(ms); results.push({ label, p, limit }); console.log(`${label.padEnd(46)} p50 ${[...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)].toFixed(1).padStart(7)} ms   p95 ${p.toFixed(1).padStart(7)} ms   (limit ${limit})`); };
const A = (i) => big[i % big.length].id;
time('schedule list, first page', 500, () => svc.schedules.list(planner, { pageSize: '25' }));
time('schedule list, one project', 500, (i) => svc.schedules.list(planner, { 'filter[projectId]': String(projects[i % 50]), pageSize: '25' }));
time('one schedule', 300, (i) => svc.schedules.get(planner, A(i)));
time('CPM pass, 5 000 activities (FR-06)', 3000, (i) => svc.runCalc(planner, A(i)), 5);
time('activities, first page of 100', 500, (i) => svc.activities.list(planner, A(i), { filter: 'all', q: '', page: 1, pageSize: 100, wbsId: null }));
time('activities, critical', 500, (i) => svc.activities.list(planner, A(i), { filter: 'critical', q: '', page: 1, pageSize: 100, wbsId: null }));
time('activities, a WBS branch', 500, (i) => svc.activities.list(planner, A(i), { filter: 'all', q: '', page: 1, pageSize: 100, wbsId: wbsOf.get(big[i % big.length].pid).kids[3] }));
time('activities, search', 500, (i) => svc.activities.list(planner, A(i), { filter: 'all', q: 'Activity 42', page: 1, pageSize: 100, wbsId: null }));
time('activities, page 50', 500, (i) => svc.activities.list(planner, A(i), { filter: 'all', q: '', page: 50, pageSize: 100, wbsId: null }));
time('float report', 500, (i) => svc.critical(planner, A(i), { near: 5 }));
time('save: one activity', 800, (i) => svc.activities.update(planner, db.prepare('SELECT id FROM plan_activities WHERE schedule_id = ? LIMIT 1 OFFSET ?').get(A(i), i * 7).id, { duration: 3 + (i % 5) }));
console.log('\nQuery plans:');
const plan = (label, sql, ...p) => { console.log(`- ${label}`); for (const r of db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...p)) console.log(`    ${r.detail}`); };
plan('activities of a schedule, critical', "SELECT a.* FROM plan_activities a LEFT JOIN proj_wbs w ON w.id = a.wbs_id WHERE a.schedule_id = ? AND a.deleted_at IS NULL AND a.is_critical = 1 ORDER BY COALESCE(w.code, '~'), a.sort_order, a.id LIMIT 100", A(0));
plan('links of a schedule', 'SELECT pred_id, succ_id FROM plan_dependencies WHERE schedule_id = ? AND deleted_at IS NULL', A(0));
plan('schedules of a project', "SELECT * FROM plan_schedules x WHERE x.company_id = 1 AND x.org_project_id = ? AND x.deleted_at IS NULL ORDER BY x.doc_date DESC LIMIT 25", projects[0]);
const bad = results.filter((r) => r.p > r.limit);
console.log(bad.length ? `\nOVER THE LIMIT: ${bad.map((r) => `${r.label} (${r.p.toFixed(0)} ms)`).join('; ')}` : '\nEvery measure is within its limit.');
process.exit(bad.length ? 1 : 0);
