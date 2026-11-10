// npm run erp:site-wa-perf -- [--queries 20]
// Part 14.01: fills 50 projects with a site, two crews, a work front per zone and a schedule of 200 activities each, then 100 000 work authorisations (2 000 a project) with their resources and a use
// each, and times what the pages ask: the list and its filters, one WA, the board of a site for a day, the options of the form, a WA raised (with its checks), a use booked against a WA and a closure.
// Prints the query plans. The standard (05_GLOBAL_STANDARDS section 11): a list p95 <= 500 ms, one record <= 300 ms, a save <= 800 ms.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { createSiteService } from '../src/server/modules/site/service.js';

const args = process.argv.slice(2);
const queries = Number(args.includes('--queries') ? args[args.indexOf('--queries') + 1] : 20);
const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys = ON;'); migrateUp(db);
db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'perf')").run();
console.log('Filling...');
db.exec('BEGIN');
const cal = Number(db.prepare("INSERT INTO plan_calendars (company_id, code, name, work_week, status, requested_by, approved_by, created_by) VALUES (1, 'SIX', 'Six-day week', '1111110', 'ACTIVE', 'a', 'b', 'perf')").run().lastInsertRowid);
const P = []; const day = (k) => new Date(Date.UTC(2024, 0, 1) + (k % 700) * 86400000).toISOString().slice(0, 10);
for (let p = 1; p <= 50; p += 1) {
  const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'BUILDING', 'ACTIVE', 't', 'perf')").run(`P${p}`, `Project ${p}`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, ?, ?, 'ACTIVE')").run(pid, `S${p}`, `Site ${p}`).lastInsertRowid);
  const sid = Number(db.prepare("INSERT INTO plan_schedules (company_id, doc_no, doc_date, org_project_id, name, version_no, calendar_id, start_date, status, activities_count, created_by, source_type) VALUES (1, ?, '2024-01-01', ?, 'Programme', 1, ?, '2024-01-01', 'APPROVED', 200, 'perf', 'perf')").run(`SCH/${p}`, pid, cal).lastInsertRowid);
  const zones = []; const fronts = [];
  for (let z = 1; z <= 10; z += 1) { const loc = Number(db.prepare("INSERT INTO proj_locations (company_id, project_id, loc_type, code, name, created_by) VALUES (1, ?, 'ZONE', ?, ?, 'perf')").run(pid, `Z${z}`, `Zone ${z}`).lastInsertRowid); zones.push(loc); fronts.push(Number(db.prepare("INSERT INTO site_work_fronts (company_id, org_project_id, wf_site_id, location_id, code, name, project_id, site_id, created_by) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'perf')").run(pid, site, loc, `F${z}`, `Front ${z}`, pid, site).lastInsertRowid)); }
  const acts = []; for (let a = 0; a < 200; a += 1) acts.push(Number(db.prepare("INSERT INTO plan_activities (company_id, schedule_id, code, name, location_id, act_type, duration_days, qty, uom, sort_order, es, ef, project_id, created_by, source_type) VALUES (1, ?, ?, ?, ?, 'TASK', 10, 100000000, 'm3', ?, '2024-01-01', '2026-12-31', ?, 'perf', 'perf')").run(sid, `A${a}`, `Activity ${a}`, zones[a % 10], a, pid).lastInsertRowid));
  const crews = [1, 2].map((c) => Number(db.prepare("INSERT INTO hr_crews (company_id, crew_site_id, code, name, trade) VALUES (1, ?, ?, ?, ?)").run(site, `C${p}-${c}`, `Crew ${c}`, c === 1 ? 'Mason' : 'Carpenter').lastInsertRowid));
  P.push({ pid, site, sid, acts, crews, fronts });
}
const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, 'PF', 'Perf', 'PFT', '[]', '[]', 'EST', 'ACTIVE')").run().lastInsertRowid);
const items = Array.from({ length: 40 }, (_, i) => Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status) VALUES (1, ?, ?, 'MATERIAL', ?, 'BAG', '2024-01-01', 'ACTIVE')").run(`M${i}`, `Material ${i}`, cat).lastInsertRowid));
const ST = ['APPROVED', 'APPROVED', 'CLOSED', 'CLOSED', 'CLOSED', 'DRAFT', 'SUBMITTED', 'CANCELLED'];
const insW = db.prepare("INSERT INTO site_work_authorisations (company_id, wa_no, org_project_id, wa_site_id, work_front_id, plan_date, activity_id, location_id, planned_qty, uom, start_time, end_time, supervisor, in_plan, status, actual_qty, checks_json, requested_by, project_id, site_id, created_by, source_type) VALUES (1, ?, ?, ?, ?, ?, ?, NULL, ?, 'm3', '08:00', '17:00', ?, 1, ?, ?, '[]', 'perf', ?, ?, 'perf', 'perf')");
const insR = db.prepare("INSERT INTO site_wa_resources (company_id, wa_id, resource_type, item_id, trade, crew_id, res_key, label, uom, headcount, planned_qty, actual_qty, source, project_id, site_id, created_by) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, 'perf')");
const insU = db.prepare("INSERT INTO site_wa_uses (company_id, org_project_id, wa_id, use_kind, src_entity, src_id, resource_type, res_key, qty, uom, use_date, result, project_id, site_id, created_by) VALUES (1, ?, ?, 'ATTENDANCE', 'att_punch', ?, 'LABOUR', 'trade:mason', 1000, 'man-day', ?, 'PASS', ?, ?, 'perf')");
let n = 0; for (const x of P) for (let k = 0; k < 2000; k += 1) {
  n += 1; const st = ST[k % 8]; const d = day(k);
  const id = Number(insW.run(`WA/${String(n).padStart(6, '0')}`, x.pid, x.site, x.fronts[k % 10], d, x.acts[k % 200], 10000, `sup${k % 15}`, st, st === 'CLOSED' ? 9000 : null, x.pid, x.site).lastInsertRowid);
  insR.run(id, 'LABOUR', null, 'Mason', x.crews[0], 'trade:mason', 'Masons', 'man-day', 6, 6000, st === 'CLOSED' ? 6000 : 0, x.pid, x.site); insR.run(id, 'MATERIAL', items[k % 40], null, null, `item:${items[k % 40]}`, 'Cement', 'BAG', null, 20000, st === 'CLOSED' ? 21000 : 0, x.pid, x.site);
  insU.run(x.pid, id, `P${n}`, d, x.pid, x.site);
}
db.exec('COMMIT'); db.exec('ANALYZE');
console.log(`${db.prepare('SELECT COUNT(*) AS n FROM site_work_authorisations').get().n} work authorisations, ${db.prepare('SELECT COUNT(*) AS n FROM site_wa_resources').get().n} resources, ${db.prepare('SELECT COUNT(*) AS n FROM site_wa_uses').get().n} uses.\n`);
const svc = createSiteService({ db }); const se = { user: 'perf-se', roles: ['SE'], companyId: 1 }; const sk = { user: 'perf-sk', roles: ['SK'], companyId: 1 };
const results = []; const sorted = (ms) => [...ms].sort((a, b) => a - b);
const record = (label, limit, ms) => { const p = sorted(ms)[Math.floor(ms.length * 0.95)] ?? 0; results.push({ label, p, limit }); console.log(`${label.padEnd(52)} p50 ${sorted(ms)[Math.floor(ms.length / 2)].toFixed(1).padStart(8)} ms   p95 ${p.toFixed(1).padStart(8)} ms   limit ${limit} ms`); };
const time = (label, limit, fn, k = queries) => { const ms = []; for (let i = 0; i < k; i += 1) { const t = performance.now(); fn(i); ms.push(performance.now() - t); } record(label, limit, ms); };
const X = (i) => P[i % P.length]; const one = (i) => db.prepare("SELECT id FROM site_work_authorisations WHERE org_project_id = ? AND status = 'APPROVED' LIMIT 1 OFFSET ?").get(X(i).pid, i).id;
time('WA list, first page (100 000 rows)', 500, () => svc.was.list(se, { pageSize: '50' }));
time('WA list, approved of a site', 500, (i) => svc.was.list(se, { 'filter[status]': 'APPROVED', 'filter[siteId]': String(X(i).site), pageSize: '50' }));
time('WA list, a day of a project', 500, (i) => svc.was.list(se, { 'filter[planDate]': day(i * 7), 'filter[projectId]': String(X(i).pid), pageSize: '50' }));
time('WA list, search', 500, (i) => svc.was.list(se, { q: `sup${i % 15}`, pageSize: '25' }));
time('one WA with its checks, resources and uses', 300, (i) => svc.was.get(se, one(i)));
time('board of a site for a day', 500, (i) => svc.board(se, { siteId: X(i).site, date: day(i * 3) }));
time('options of the WA form of a site', 500, (i) => svc.was.options(se, { siteId: X(i).site, date: '2026-04-07' }));
time('a WA raised (with its checks and resources)', 800, (i) => svc.was.create(se, { siteId: X(i).site, planDate: '2026-04-07', activityId: X(i).acts[i], plannedQty: 5, startTime: '08:00', endTime: '17:00', crews: [{ crewId: X(i).crews[0] }] }));
const live = P.slice(0, queries).map((x, i) => one(i));
time('a material issue booked against a WA', 800, (i) => svc.recordUse(sk, { projectId: X(i).pid, waId: live[i % live.length], kind: 'MATERIAL_ISSUE', srcEntity: 'inv_issue', srcId: `MI-${i}`, itemId: db.prepare("SELECT item_id FROM site_wa_resources WHERE wa_id = ? AND resource_type = 'MATERIAL'").get(live[i % live.length]).item_id, qty: 1, date: db.prepare('SELECT plan_date FROM site_work_authorisations WHERE id = ?').get(live[i % live.length]).plan_date }));
time('a WA closed and reconciled', 800, (i) => svc.was.close(se, live[i % live.length], { actualQty: 9, varianceReason: 'perf', resources: [] }), Math.min(queries, live.length));
console.log('\nQuery plans:');
for (const [label, sql] of [
  ['list, newest first', "SELECT x.id FROM site_work_authorisations x JOIN org_projects p ON p.id = x.org_project_id WHERE x.deleted_at IS NULL AND x.company_id = 1 ORDER BY x.plan_date DESC, x.id LIMIT 50"],
  ['list, status of a site', "SELECT x.id FROM site_work_authorisations x WHERE x.wa_site_id = 5 AND x.status = 'APPROVED' AND x.deleted_at IS NULL ORDER BY x.plan_date DESC"],
  ['board of a site and a day', "SELECT x.id FROM site_work_authorisations x WHERE x.wa_site_id = 5 AND x.plan_date = '2024-03-01' AND x.deleted_at IS NULL"],
  ['remaining of an activity', "SELECT SUM(planned_qty) FROM site_work_authorisations WHERE activity_id = 5 AND status IN ('SUBMITTED', 'APPROVED', 'EMERGENCY') AND deleted_at IS NULL"],
  ['resources of a WA', 'SELECT id FROM site_wa_resources WHERE wa_id = 5 AND deleted_at IS NULL'],
  ['uses of a WA', "SELECT id FROM site_wa_uses WHERE wa_id = 5 AND use_kind = 'DPR' AND deleted_at IS NULL"],
  ['a use already booked', "SELECT id FROM site_wa_uses WHERE company_id = 1 AND use_kind = 'MATERIAL_ISSUE' AND src_entity = 'inv_issue' AND src_id = 'X' AND COALESCE(res_key, '') = '' AND deleted_at IS NULL"],
  ['live WAs of a site for a day', "SELECT id FROM site_work_authorisations WHERE wa_site_id = 5 AND plan_date = '2024-03-01' AND status IN ('APPROVED', 'EMERGENCY') AND deleted_at IS NULL"],
]) console.log(`- ${label}: ${db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ')}`);
const over = results.filter((r) => r.p > r.limit);
console.log(over.length ? `\nOVER THE LIMIT: ${over.map((r) => r.label).join('; ')}` : '\nAll within the limits.');
process.exit(over.length ? 1 : 0);
