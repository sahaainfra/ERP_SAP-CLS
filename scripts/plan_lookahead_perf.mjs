// npm run erp:plan-lookahead-perf -- [--queries 20]
// Part 13.04: fills 50 projects and 20 schedules of 5 000 activities each (as the Gantt timing does), calculates them, adds 100 000 constraints, 100 000 closed weekly plans of 3 commitments each (300 000
// rows) and a real weekly plan of 200 commitments for four big schedules, then times what the pages ask: the look-ahead board of six weeks of a 5 000-activity schedule, the detection of the constraints
// (RFIs, drawings, predecessors, labour), the constraint log and its filters, the weekly plans and one plan, the daily breakdown, a save, the PPC report. Prints the query plans.
// The standard (05_GLOBAL_STANDARDS section 11): a list p95 <= 500 ms, one record <= 300 ms, a save <= 800 ms.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { createPlanService } from '../src/server/modules/plan/service.js';
import { createLookaheadService } from '../src/server/modules/plan/lookahead.js';

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
const svc = createPlanService({ db }).plan; const la = createLookaheadService({ db, plan: svc });
const planner = { user: 'planner', roles: ['PLAN'], companyId: 1 }; const today = new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const monday = (iso) => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));
// the schedules start this week so that the six weeks of the look-ahead hold their first activities
for (const s of big) { db.prepare('UPDATE plan_schedules SET start_date = ? WHERE id = ?').run(monday(today), s.id); svc.runCalc(planner, s.id); }
console.log('Calculated.');
db.exec('BEGIN');
const site = new Map(); for (const pid of projects) site.set(pid, Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name) VALUES (1, ?, ?, 'Site 1')").run(pid, `S${pid}`).lastInsertRowid));
const crew = new Map(); for (const pid of projects) crew.set(pid, Number(db.prepare("INSERT INTO hr_crews (company_id, crew_site_id, code, name, trade) VALUES (1, ?, ?, 'Gang', 'Mason')").run(site.get(pid), `C${pid}`).lastInsertRowid));
for (const s of big) db.prepare("INSERT INTO hr_deployments (company_id, doc_no, doc_date, person_type, person_id, dep_project_id, crew_id, from_date, status) VALUES (1, ?, '2026-01-01', 'WORKER', ?, ?, ?, '2026-01-01', 'APPROVED')").run(`DEP/${s.pid}`, s.pid, s.pid, crew.get(s.pid));
// open RFIs and drawings without an IFC revision on the WBS nodes of the big projects
for (const s of big) { const kids = db.prepare('SELECT id FROM proj_wbs WHERE project_id = ? AND parent_id IS NOT NULL ORDER BY id LIMIT 6').all(s.pid); kids.forEach((k, i) => { db.prepare("INSERT INTO engg_rfis (company_id, rfi_no, org_project_id, subject, question, discipline, wbs_id, required_by, status) VALUES (1, ?, ?, 'Level of footing', 'Please confirm', 'STRUCTURAL', ?, ?, 'ISSUED')").run(`RFI/${s.pid}/${i}`, s.pid, k.id, addDays(today, 14)); db.prepare("INSERT INTO engg_drawings (company_id, org_project_id, drawing_no, title, discipline, wbs_id) VALUES (1, ?, ?, 'Layout', 'STRUCTURAL', ?)").run(s.pid, `DWG/${s.pid}/${i}`, k.id); }); }
// 100 000 constraints (nine in ten cleared) on activities of the big schedules, then 100 000 closed weekly plans of 3 commitments
const acts = new Map(big.map((s) => [s.id, db.prepare('SELECT id FROM plan_activities WHERE schedule_id = ? ORDER BY id LIMIT 5000').all(s.id).map((r) => r.id)]));
const insC = db.prepare("INSERT INTO plan_constraints (company_id, org_project_id, schedule_id, activity_id, ctype, description, owner_user, due_date, origin, status, cleared_on, cleared_by, project_id, created_by, source_type) VALUES (1, ?, ?, ?, ?, 'Filled for the timing', ?, ?, 'MANUAL', ?, ?, ?, ?, 'perf', 'perf')");
const TYPES = ['DRAWING', 'RFI', 'SUBMITTAL', 'MATERIAL', 'LABOUR', 'PLANT', 'PERMIT', 'ACCESS'];
for (let k = 0; k < 100000; k += 1) { const s = big[k % big.length]; const a = acts.get(s.id)[k % 5000]; const open = k % 10 === 0; insC.run(s.pid, s.id, a, TYPES[k % 8], `user${k % 40}`, addDays(today, (k % 60) - 20), open ? 'OPEN' : 'CLEARED', open ? null : today, open ? null : 'perf', s.pid); }
const insP = db.prepare("INSERT INTO plan_weekly_plans (company_id, doc_no, doc_date, org_project_id, wp_site_id, schedule_id, week_start, revision_no, status, items_count, completed_count, ppc, project_id, created_by, source_type) VALUES (1, ?, '2026-01-05', ?, ?, ?, ?, 1, 'CLOSED', 3, 2, 6667, ?, 'perf', 'perf')");
const insI = db.prepare("INSERT INTO plan_weekly_items (company_id, plan_id, activity_id, crew_id, committed_qty, completed_qty, uom, completed, variance_code, project_id, created_by, source_type) VALUES (1, ?, ?, NULL, 10000, ?, 'cum', ?, ?, ?, 'perf', 'perf')");
let p = 0; for (const pid of projects) { const sid = db.prepare('SELECT MIN(id) AS id FROM plan_schedules WHERE org_project_id = ?').get(pid).id; const three = acts.get(big[0].id).slice(0, 3);
  for (let w = 0; w < 2000; w += 1) { p += 1; const id = Number(insP.run(`WPX/${String(p).padStart(6, '0')}`, pid, site.get(pid), sid, addDays('2000-01-03', 7 * w), pid).lastInsertRowid); for (let i = 0; i < 3; i += 1) insI.run(id, three[i], i < 2 ? 10000 : 0, i < 2 ? 1 : 0, i < 2 ? null : 'LABOUR', pid); } }
db.exec('COMMIT'); db.exec('ANALYZE');
console.log(`${db.prepare('SELECT COUNT(*) AS n FROM plan_constraints').get().n} constraints, ${db.prepare('SELECT COUNT(*) AS n FROM plan_weekly_plans').get().n} weekly plans, ${db.prepare('SELECT COUNT(*) AS n FROM plan_weekly_items').get().n} commitments.\n`);
const results = []; const p95 = (ms) => [...ms].sort((a, b) => a - b)[Math.floor(ms.length * 0.95)] ?? 0;
const record = (label, limit, ms) => { const p = p95(ms); results.push({ label, p, limit }); console.log(`${label.padEnd(52)} p50 ${[...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)].toFixed(1).padStart(8)} ms   p95 ${p.toFixed(1).padStart(8)} ms   limit ${limit} ms`); };
const time = (label, limit, fn, k = queries) => { const ms = []; for (let i = 0; i < k; i += 1) { const t = performance.now(); fn(i); ms.push(performance.now() - t); } record(label, limit, ms); };
const S = (i) => big[i % big.length]; const LQ = { weeks: 6, from: null, siteId: null, locationId: null, onlyBlocked: false, q: '' };
// the real plans: 200 commitments on activities of a big schedule that run this week, for the first four big schedules
const plans = []; for (const s of big.slice(0, 4)) { const week = monday(today); const rows = db.prepare('SELECT id FROM plan_activities WHERE schedule_id = ? AND es IS NOT NULL AND es <= ? AND ef >= ? AND actual_finish IS NULL ORDER BY id LIMIT 200').all(s.id, addDays(week, 6), week);
  plans.push(la.weekly.create(planner, { scheduleId: s.id, siteId: null, weekStart: week, note: 'Timing', items: rows.map((r) => ({ activityId: r.id, crewId: null, committedQty: 10, uom: 'cum' })) })); }
console.log(`A weekly plan of ${plans[0].items} commitments for each of ${plans.length} schedules.\n`);
time('detect constraints of a 5 000-activity schedule', 3000, (i) => la.sync(1, S(i).id), 5);
time('look-ahead board, six weeks, 5 000 activities', 500, (i) => la.lookaheads.board(planner, S(i).id, LQ));
time('look-ahead board, blocked only', 500, (i) => la.lookaheads.board(planner, S(i).id, { ...LQ, onlyBlocked: true }));
time('constraint log, first page (100 000 rows)', 500, () => la.constraints.list(planner, { pageSize: '50' }));
time('constraint log, open ones of a project', 500, (i) => la.constraints.list(planner, { 'filter[status]': 'OPEN', 'filter[projectId]': String(S(i).pid), pageSize: '50' }));
time('constraint log, search', 500, (i) => la.constraints.list(planner, { q: `user${i % 40}`, pageSize: '25' }));
time('weekly plans, first page (100 000 rows)', 500, () => la.weekly.list(planner, { pageSize: '50' }));
time('weekly plans of a project, closed', 500, (i) => la.weekly.list(planner, { 'filter[status]': 'CLOSED', 'filter[projectId]': String(projects[i % 50]), pageSize: '50' }));
time('one weekly plan of 200 commitments', 300, (i) => la.weekly.get(planner, plans[i % plans.length].id));
time('daily breakdown of 200 commitments', 300, (i) => la.weekly.daily(planner, plans[i % plans.length].id));
time('PPC report of a project (2 000 weeks)', 500, (i) => la.ppcReport(planner, { projectId: projects[i % 50], siteId: null, from: null, to: null }));
time('a weekly plan saved (200 commitments)', 800, (i) => { const pl = plans[i % plans.length]; la.weekly.update(planner, pl.id, { note: `Saved ${i}`, items: la.weekly.get(planner, pl.id).lines.map((l) => ({ activityId: l.activityId, crewId: null, committedQty: l.committedQty, uom: l.uom })) }); }, 4);
console.log('\nQuery plans:');
for (const [label, sql] of [
  ['board: activities of a window', "SELECT a.id FROM plan_activities a WHERE a.schedule_id = 9 AND a.deleted_at IS NULL AND a.act_type IN ('TASK', 'MILESTONE') AND a.actual_finish IS NULL AND a.es <= '2026-12-31' AND a.ef >= '2026-11-01'"],
  ['board: open constraints of activities', "SELECT id FROM plan_constraints WHERE status = 'OPEN' AND deleted_at IS NULL AND activity_id IN (1, 2, 3)"],
  ['log: open of a project by due date', "SELECT x.id FROM plan_constraints x WHERE x.org_project_id = 5 AND x.status = 'OPEN' AND x.deleted_at IS NULL ORDER BY x.due_date"],
  ['detection: open automatic ones of a schedule', "SELECT id FROM plan_constraints WHERE schedule_id = 9 AND origin = 'AUTO' AND status = 'OPEN' AND deleted_at IS NULL"],
  ['plans: a project and a week', "SELECT id FROM plan_weekly_plans WHERE org_project_id = 5 AND COALESCE(wp_site_id, 0) = 0 AND week_start = '2026-11-09' AND deleted_at IS NULL"],
  ['plans: closed of a project for the report', "SELECT id FROM plan_weekly_plans WHERE org_project_id = 5 AND status = 'CLOSED' AND deleted_at IS NULL ORDER BY week_start"],
  ['commitments of a plan', 'SELECT id FROM plan_weekly_items WHERE plan_id = 5 AND deleted_at IS NULL'],
]) console.log(`- ${label}: ${db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ')}`);
const over = results.filter((r) => r.p > r.limit);
console.log(over.length ? `\nOVER THE LIMIT: ${over.map((r) => r.label).join('; ')}` : '\nAll within the limits.');
process.exit(over.length ? 1 : 0);
