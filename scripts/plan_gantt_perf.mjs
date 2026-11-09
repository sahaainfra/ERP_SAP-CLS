// npm run erp:plan-gantt-perf -- [--queries 20]
// Part 13.02: fills 50 projects and 20 schedules of 5 000 activities each (100 000 activities in chains of 100 side by side, about 148 000 links) with 100 000 resource rows (labour by trade, plant and material), calculates them, then times
// what the pages ask: the Gantt of a 5 000-activity schedule, a drag checked and saved (with the recalculation) and undone, the resources of an activity and their save, the histograms (week, month, one type), a
// drill-down, the loading by month, and the printable programme (layout of 5 000 activities; the PDF of 1 000 on A3). Prints the query plans.
// The standard (05_GLOBAL_STANDARDS section 11): a list p95 <= 500 ms, one record <= 300 ms, a save <= 800 ms. A Gantt edit of a 5 000-activity schedule is a save plus the CPM pass (limit 3 s, part 13.01).
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { createPlanService } from '../src/server/modules/plan/service.js';
import { createGanttService } from '../src/server/modules/plan/gantt.js';
import { createProgramme } from '../src/server/modules/plan/programme.js';

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
const svc = createPlanService({ db }).plan; const g = createGanttService({ db, plan: svc }); const programme = createProgramme({ db, gantt: g });
const planner = { user: 'planner', roles: ['PLAN'], companyId: 1 };
for (const s of big) svc.runCalc(planner, s.id);
// availability: capacity in force for two trades on every project with a big schedule
for (const s of big) for (const tr of ['Mason', 'Carpenter']) db.prepare("INSERT INTO plan_resource_capacity (company_id, org_project_id, resource_type, trade, res_key, label, uom, qty_per_day, from_date, to_date, status, requested_by, approved_by, project_id, created_by) VALUES (1, ?, 'LABOUR', ?, ?, ?, 'Nos', 40000, '2026-04-01', '2040-12-31', 'ACTIVE', 'a', 'b', ?, 'perf')").run(s.pid, tr, `trade:${tr.toLowerCase()}`, tr, s.pid);
console.log('Calculated.\n');
const results = []; const p95 = (ms) => [...ms].sort((a, b) => a - b)[Math.floor(ms.length * 0.95)] ?? 0;
const record = (label, limit, ms) => { const p = p95(ms); results.push({ label, p, limit }); console.log(`${label.padEnd(52)} p50 ${[...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)].toFixed(1).padStart(8)} ms   p95 ${p.toFixed(1).padStart(8)} ms   limit ${limit} ms`); };
const time = (label, limit, fn, k = queries) => { const ms = []; for (let i = 0; i < k; i += 1) { const t = performance.now(); fn(i); ms.push(performance.now() - t); } record(label, limit, ms); };
const timeAsync = async (label, limit, fn, k = queries) => { const ms = []; for (let i = 0; i < k; i += 1) { const t = performance.now(); await fn(i); ms.push(performance.now() - t); } record(label, limit, ms); };
const A = (i) => big[i % big.length].id;
const actAt = (i, off) => db.prepare('SELECT id, duration_days AS d FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL ORDER BY id LIMIT 1 OFFSET ?').get(A(i), off);
const HQ = { type: null, bucket: 'week', dates: 'early', from: null, to: null, key: null };
time('Gantt of 5 000 activities (rows, links, WBS)', 500, (i) => g.data(planner, A(i)));
time('histogram by week, all resources', 500, (i) => g.histogram(planner, A(i), HQ));
time('histogram by month, labour, late dates', 500, (i) => g.histogram(planner, A(i), { ...HQ, bucket: 'month', type: 'LABOUR', dates: 'late' }));
time('histogram by day, one quarter', 500, (i) => g.histogram(planner, A(i), { ...HQ, bucket: 'day', from: '2026-10-01', to: '2026-12-31' }));
time('drill-down: the activities behind a bar', 500, (i) => g.drill(planner, A(i), { type: 'LABOUR', key: 'trade:mason', from: '2026-10-05', to: '2026-10-11', dates: 'early' }));
time('loading by month (for 12.01 and 17.08)', 500, (i) => g.loading(planner, A(i)));
time('resources of one activity', 300, (i) => g.resourcesOf(planner, actAt(i, 100 + i).id));
time('save: resources of one activity', 800, (i) => g.saveResources(planner, actAt(i, 200 + i).id, { rows: [{ type: 'LABOUR', itemId: null, trade: 'Mason', uom: 'Nos', basis: 'PER_DAY', qty: 4 + (i % 3), sourceType: 'MANUAL' }, { type: 'PLANT', itemId: null, trade: 'Concrete pump', uom: 'Hrs', basis: 'TOTAL', qty: 16, sourceType: 'MANUAL' }] }));
time('recent edits of a schedule', 300, (i) => g.edits(planner, A(i)));
const EDIT = { type: 'FS', lag: 0, actType: 'TASK', confirm: true };
time('Gantt edit checked (5 000 activities recalculated)', 3000, (i) => g.edit(planner, A(i), { ...EDIT, op: 'EDIT', activityId: actAt(i, 2500).id, duration: 12 + (i % 6) }, { dryRun: true }), 5);
time('Gantt edit saved (recalculation, before and after)', 3000, (i) => g.edit(planner, A(i), { ...EDIT, op: 'EDIT', activityId: actAt(i, 2500).id, duration: 20 + i }), 5);
time('Gantt edit undone (rows restored, recalculated)', 3000, (i) => g.undo(planner, A(i)), 5);
time('programme layout, 5 000 activities on A1', 3000, (i) => programme.build(planner, A(i), { format: 'json', paper: 'A1', scale: 'month', filter: 'all', wbsId: null, from: null, to: null, links: true }), 5);
const branch = (i) => wbsOf.get(big[i % big.length].pid).kids.slice(0, 4);
await timeAsync('programme image (SVG), a WBS branch of 250', 3000, (i) => programme.render(planner, A(i), { format: 'svg', paper: 'A3', scale: 'month', filter: 'all', wbsId: branch(i)[0], from: null, to: null, links: true }), 5);
await timeAsync('programme PDF on A3, 5 000 activities', 30000, (i) => programme.render(planner, A(i), { format: 'pdf', paper: 'A3', scale: 'month', filter: 'all', wbsId: null, from: null, to: null, links: false }), 2);
console.log('\nQuery plans:');
const plan = (label, sql, ...p) => { console.log(`- ${label}`); for (const r of db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...p)) console.log(`    ${r.detail}`); };
plan('resources of a schedule (histogram)', 'SELECT r.* FROM plan_activity_resources r JOIN plan_activities a ON a.id = r.activity_id WHERE r.schedule_id = ? AND r.deleted_at IS NULL AND a.deleted_at IS NULL', A(0));
plan('resources of an activity', 'SELECT * FROM plan_activity_resources WHERE activity_id = ? AND deleted_at IS NULL ORDER BY resource_type, label', actAt(0, 5).id);
plan('capacity in force on a project', "SELECT * FROM plan_resource_capacity WHERE company_id = 1 AND org_project_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL", projects[0]);
plan('latest edit of a schedule', 'SELECT * FROM plan_gantt_edits WHERE schedule_id = ? AND undone_at IS NULL AND deleted_at IS NULL ORDER BY id DESC LIMIT 1', A(0));
const bad = results.filter((r) => r.p > r.limit);
console.log(bad.length ? `\nOVER THE LIMIT: ${bad.map((r) => `${r.label} (${r.p.toFixed(0)} ms)`).join('; ')}` : '\nEvery measure is within its limit.');
process.exit(bad.length ? 1 : 0);
