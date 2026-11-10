// npm run erp:plan-delay-perf -- [--queries 20]
// Part 13.05: fills 50 projects and 20 schedules of 5 000 activities each (as the Gantt timing does), calculates them, adds 100 000 delays (2 000 a project) with an analysis and evidence each, then times
// what the pages ask: the register and its filters, one delay, a time-impact analysis of a 5 000-activity schedule (preview and save), the summary of a project and of the company, and what the claims
// read. Prints the query plans.
// The standard (05_GLOBAL_STANDARDS section 11): a list p95 <= 500 ms, one record <= 300 ms, a save <= 800 ms; an analysis is two CPM passes of the schedule (limit 3 s, part 13.01).
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { createPlanService } from '../src/server/modules/plan/service.js';
import { createDelayService } from '../src/server/modules/plan/delays.js';

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
const svc = createPlanService({ db }).plan; const dl = createDelayService({ db, plan: svc });
const planner = { user: 'planner', roles: ['PLAN'], companyId: 1 };
for (const s of big) svc.runCalc(planner, s.id);
console.log('Calculated.');
db.exec('BEGIN');
const CAUSE = ['LATE_DRAWINGS', 'LATE_HANDOVER', 'CHANGE', 'WEATHER', 'FORCE_MAJEURE', 'CONTRACTOR_RESOURCES', 'STATUTORY', 'OTHER']; const RESP = ['EMPLOYER', 'CONTRACTOR', 'NEUTRAL']; const ST = ['APPROVED', 'APPROVED', 'DRAFT', 'SUBMITTED', 'REJECTED'];
const insD = db.prepare("INSERT INTO plan_delays (company_id, doc_no, doc_date, org_project_id, schedule_id, title, cause_category, responsibility, start_date, end_date, delay_days, affected_activities_json, impact_days, status, project_id, created_by, source_type) VALUES (1, ?, '2026-04-01', ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, 'perf', 'perf')");
const insT = db.prepare("INSERT INTO plan_tia (company_id, delay_id, schedule_id, schedule_copy_ref, data_date, fragnet_json, completion_before, completion_after, impact_days, impact_working_days, analysed_by, analysed_at, project_id, created_by) VALUES (1, ?, ?, 'SCH v1', ?, '{}', '2028-01-10', '2028-01-15', 5, 4, 'perf', '2026-04-01', ?, 'perf')");
const insE = db.prepare("INSERT INTO plan_delay_evidence (company_id, delay_id, entity, entity_id, label, project_id, created_by) VALUES (1, ?, 'engg_letter', ?, 'Letter', ?, 'perf')");
const sched = new Map(db.prepare('SELECT org_project_id AS p, MIN(id) AS id FROM plan_schedules GROUP BY org_project_id').all().map((r) => [r.p, r.id]));
let dn = 0; for (const pid of projects) for (let k = 0; k < 2000; k += 1) { dn += 1; const start = new Date(Date.UTC(2024, 0, 1) + (k % 900) * 86400000).toISOString().slice(0, 10); const len = 1 + (k % 20); const end = new Date(Date.parse(`${start}T00:00:00Z`) + (len - 1) * 86400000).toISOString().slice(0, 10);
  const id = Number(insD.run(`DLX/${String(dn).padStart(6, '0')}`, pid, sched.get(pid), `Delay ${dn} hold for the drawings of level ${k % 30}`, CAUSE[k % 8], RESP[k % 3], start, end, len, k % 7, ST[k % 5], pid).lastInsertRowid); insT.run(id, sched.get(pid), start, pid); insE.run(id, String(k), pid); }
db.exec('COMMIT'); db.exec('ANALYZE');
console.log(`${db.prepare('SELECT COUNT(*) AS n FROM plan_delays').get().n} delays, ${db.prepare('SELECT COUNT(*) AS n FROM plan_tia').get().n} analyses, ${db.prepare('SELECT COUNT(*) AS n FROM plan_delay_evidence').get().n} evidence links.\n`);
const results = []; const p95 = (ms) => [...ms].sort((a, b) => a - b)[Math.floor(ms.length * 0.95)] ?? 0;
const record = (label, limit, ms) => { const p = p95(ms); results.push({ label, p, limit }); console.log(`${label.padEnd(52)} p50 ${[...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)].toFixed(1).padStart(8)} ms   p95 ${p.toFixed(1).padStart(8)} ms   limit ${limit} ms`); };
const time = (label, limit, fn, k = queries) => { const ms = []; for (let i = 0; i < k; i += 1) { const t = performance.now(); fn(i); ms.push(performance.now() - t); } record(label, limit, ms); };
// a real delay on each of the first four big schedules, with an activity in the middle of a chain
const real = big.slice(0, 4).map((s) => { const mid = db.prepare('SELECT id, code FROM plan_activities WHERE schedule_id = ? ORDER BY id LIMIT 1 OFFSET 2550').get(s.id); const prev = db.prepare('SELECT code FROM plan_activities WHERE schedule_id = ? ORDER BY id LIMIT 1 OFFSET 2549').get(s.id);
  const d = dl.delays.create(planner, { projectId: s.pid, scheduleId: s.id, title: 'Late drawings of the core', cause: 'LATE_DRAWINGS', responsibility: 'EMPLOYER', startDate: '2026-05-04', endDate: '2026-05-12', activityIds: [mid.id], mitigation: null, concurrency: null }); return { d, s, code: mid.code, prev: prev.code }; });
const FR = (x) => ({ activities: [{ code: 'F10', name: 'Hold for the drawings', duration: 8 }], links: [{ pred: x.prev, succ: 'F10', type: 'FS', lag: 0 }, { pred: 'F10', succ: x.code, type: 'FS', lag: 0 }] });
const B = (i) => real[i % real.length];
time('delay register, first page (100 000 rows)', 500, () => dl.delays.list(planner, { pageSize: '50' }));
time('delay register, approved of a project', 500, (i) => dl.delays.list(planner, { 'filter[status]': 'APPROVED', 'filter[projectId]': String(projects[i % 50]), pageSize: '50' }));
time('delay register, employer delays of a cause', 500, (i) => dl.delays.list(planner, { 'filter[responsibility]': 'EMPLOYER', 'filter[cause]': CAUSE[i % 8], pageSize: '50' }));
time('delay register, search', 500, (i) => dl.delays.list(planner, { q: `level ${i % 30}`, pageSize: '25' }));
time('one delay with its evidence and analyses', 300, (i) => dl.delays.get(planner, B(i).d.id));
time('time-impact analysis preview, 5 000 activities', 3000, (i) => dl.tia.preview(planner, B(i).d.id, { scheduleId: null, dataDate: '2026-05-04', fragnet: FR(B(i)) }), 8);
time('time-impact analysis saved, 5 000 activities', 3000, (i) => dl.tia.save(planner, B(i).d.id, { scheduleId: null, dataDate: '2026-05-04', fragnet: FR(B(i)), note: null }), 8);
time('summary of a project (2 000 delays)', 500, (i) => dl.summary(planner, { projectId: projects[i % 50], status: 'APPROVED', from: null, to: null, cause: null, responsibility: null }));
time('summary of the company (100 000 delays)', 500, () => dl.summary(planner, { projectId: null, status: 'APPROVED', from: null, to: null, cause: null, responsibility: null }));
time('what the claims read of a project', 500, (i) => dl.claims(planner, projects[i % 50]));
time('a delay saved', 800, (i) => dl.delays.update(planner, B(i).d.id, { mitigation: `Crew moved ${i}` }));
console.log(`\nAnalysis of ${B(0).code}: ${JSON.stringify((({ completionBefore, completionAfter, impactDays }) => ({ completionBefore, completionAfter, impactDays }))(dl.tia.preview(planner, B(0).d.id, { scheduleId: null, dataDate: '2026-05-04', fragnet: FR(B(0)) })))}`);
console.log('\nQuery plans:');
for (const [label, sql] of [
  ['register, newest first', "SELECT x.id FROM plan_delays x JOIN org_projects p ON p.id = x.org_project_id WHERE x.deleted_at IS NULL AND x.company_id = 1 ORDER BY x.start_date DESC, x.id LIMIT 50"],
  ['register, status of a project', "SELECT x.id FROM plan_delays x WHERE x.org_project_id = 5 AND x.status = 'APPROVED' AND x.deleted_at IS NULL ORDER BY x.start_date"],
  ['register, cause and responsibility', "SELECT x.id FROM plan_delays x WHERE x.company_id = 1 AND x.cause_category = 'WEATHER' AND x.responsibility = 'NEUTRAL' AND x.status = 'APPROVED'"],
  ['analyses of a delay', 'SELECT id FROM plan_tia WHERE delay_id = 5 AND deleted_at IS NULL ORDER BY id DESC'],
  ['evidence of a delay', 'SELECT id FROM plan_delay_evidence WHERE delay_id = 5 AND deleted_at IS NULL'],
  ['the draft of an RFI', "SELECT id FROM plan_delays WHERE src_entity = 'engg_rfi' AND src_id = '5' AND company_id = 1 AND deleted_at IS NULL"],
]) console.log(`- ${label}: ${db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ')}`);
const over = results.filter((r) => r.p > r.limit);
console.log(over.length ? `\nOVER THE LIMIT: ${over.map((r) => r.label).join('; ')}` : '\nAll within the limits.');
process.exit(over.length ? 1 : 0);
