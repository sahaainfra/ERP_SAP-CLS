// npm run erp:site-dpr-perf -- [--queries 20]
// Part 14.02: fills 50 projects with a site each and 100 000 daily progress reports (2 000 a site, one a day) with a work, two labour, a material, an equipment and a note line each, and attendance and work
// authorisations for the last days, then times what the pages ask: the register and its filters, one report, the prefill of a day, a report made from it, the missing days, the compliance, the
// daily and the monthly report. Prints the query plans. Standard (05_GLOBAL_STANDARDS section 11): a list p95 <= 500 ms, one record <= 300 ms, a save <= 800 ms.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { todayIST } from '../src/shared/dates.js';
import { isoOf, ordOf } from '../src/server/modules/plan/cpm.js';
import { createDprService } from '../src/server/modules/site/dpr.js';
import { createDprReports } from '../src/server/modules/site/dpr-reports.js';

const args = process.argv.slice(2);
const queries = Number(args.includes('--queries') ? args[args.indexOf('--queries') + 1] : 20);
const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys = ON;'); migrateUp(db);
db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'perf')").run();
console.log('Filling...');
db.exec('BEGIN');
const today = todayIST(); const day = (n) => isoOf(ordOf(today) - n);
const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, 'PF', 'Perf', 'PFT', '[]', '[]', 'EST', 'ACTIVE')").run().lastInsertRowid);
const items = Array.from({ length: 20 }, (_, i) => Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status) VALUES (1, ?, ?, 'MATERIAL', ?, 'BAG', '2024-01-01', 'ACTIVE')").run(`M${i}`, `Material ${i}`, cat).lastInsertRowid));
const contractor = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type) VALUES (1, 'ACE', 'Ace Labour', 'ace', 'PRIVATE_LIMITED', 'ACTIVE', 'COMMGR', 't', 'perf')").run().lastInsertRowid);
const cal = Number(db.prepare("INSERT INTO plan_calendars (company_id, code, name, work_week, status, requested_by, approved_by, created_by) VALUES (1, 'SIX', 'Six-day week', '1111110', 'ACTIVE', 'a', 'b', 'perf')").run().lastInsertRowid);
const P = [];
for (let p = 1; p <= 50; p += 1) {
  const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'BUILDING', 'ACTIVE', 't', 'perf')").run(`P${p}`, `Project ${p}`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, ?, ?, 'ACTIVE')").run(pid, `S${p}`, `Site ${p}`).lastInsertRowid);
  const sid = Number(db.prepare("INSERT INTO plan_schedules (company_id, doc_no, doc_date, org_project_id, name, version_no, calendar_id, start_date, status, activities_count, created_by, source_type) VALUES (1, ?, '2024-01-01', ?, 'Programme', 1, ?, '2024-01-01', 'APPROVED', 50, 'perf', 'perf')").run(`SCH/${p}`, pid, cal).lastInsertRowid);
  const acts = Array.from({ length: 50 }, (_, a) => Number(db.prepare("INSERT INTO plan_activities (company_id, schedule_id, code, name, act_type, duration_days, qty, uom, sort_order, project_id, created_by, source_type) VALUES (1, ?, ?, ?, 'TASK', 10, 100000000, 'm3', ?, ?, 'perf', 'perf')").run(sid, `A${a}`, `Activity ${a}`, a, pid).lastInsertRowid));
  P.push({ pid, site, acts });
}
const insD = db.prepare("INSERT INTO site_dprs (company_id, doc_no, org_project_id, dpr_site_id, dpr_date, supervisor, scope, status, submitted_at, submitted_via, cutoff_at, late, requested_by, approved_by, approved_at, project_id, site_id, created_by, source_type) VALUES (1, ?, ?, ?, ?, ?, 'SITE', ?, ?, 'ONLINE', ?, ?, 'perf', 'perf', ?, ?, ?, 'perf', 'perf')");
const insW = db.prepare("INSERT INTO site_work_authorisations (company_id, wa_no, org_project_id, wa_site_id, plan_date, activity_id, planned_qty, uom, start_time, end_time, supervisor, in_plan, status, checks_json, requested_by, project_id, site_id, created_by, source_type) VALUES (1, ?, ?, ?, ?, ?, 10000, 'm3', '08:00', '17:00', 'sup', 1, 'APPROVED', '[]', 'perf', ?, ?, 'perf', 'perf')");
const insK = db.prepare("INSERT INTO site_dpr_work (company_id, dpr_id, wa_id, activity_id, qty, uom, planned_qty, prefill_qty, project_id, site_id, created_by) VALUES (1, ?, ?, ?, 9000, 'm3', 10000, 10000, ?, ?, 'perf')");
const insL = db.prepare("INSERT INTO site_dpr_labour (company_id, dpr_id, category, contractor_id, trade_code, headcount, man_days, ot_hours, att_headcount, att_man_days, variance_pct, flagged, project_id, site_id, created_by) VALUES (1, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, 0, ?, ?, 'perf')");
const insM = db.prepare("INSERT INTO site_dpr_materials (company_id, dpr_id, item_id, qty, uom, project_id, site_id, created_by) VALUES (1, ?, ?, 20000, 'BAG', ?, ?, 'perf')");
const insE = db.prepare("INSERT INTO site_dpr_equipment (company_id, dpr_id, equipment_key, label, hours_worked, project_id, site_id, created_by) VALUES (1, ?, 'plant:crane', 'Crane', 8000, ?, ?, 'perf')");
const insN = db.prepare("INSERT INTO site_dpr_notes (company_id, dpr_id, note_type, note_text, project_id, site_id, created_by) VALUES (1, ?, ?, 'Wet ground slowed the work', ?, ?, 'perf')");
let n = 0; const ST = ['APPROVED', 'APPROVED', 'APPROVED', 'SUBMITTED', 'DRAFT'];
for (const x of P) for (let k = 0; k < 2000; k += 1) {
  n += 1; const date = day(k + 14); const st = ST[k % 5]; const late = k % 7 === 0 ? 1 : 0; const sub = `${date}T10:00:00.000Z`;
  const id = Number(insD.run(`DPR/${String(n).padStart(6, '0')}`, x.pid, x.site, date, `sup${k % 9}`, st, st === 'DRAFT' ? null : sub, `${date}T13:30:00.000Z`, late, st === 'APPROVED' ? sub : null, x.pid, x.site).lastInsertRowid);
  const wa = Number(insW.run(`WAP/${String(n).padStart(6, '0')}`, x.pid, x.site, date, x.acts[k % 50], x.pid, x.site).lastInsertRowid);
  insK.run(id, wa, x.acts[k % 50], x.pid, x.site); insL.run(id, 'CONTRACT', contractor, 'Mason', 6, 6000, 6, 6000, x.pid, x.site); insL.run(id, 'STAFF', null, 'Site Engineer', 1, 1000, 1, 1000, x.pid, x.site);
  insM.run(id, items[k % 20], x.pid, x.site); insE.run(id, x.pid, x.site); insN.run(id, k % 3 === 0 ? 'HINDRANCE' : 'VISITOR', x.pid, x.site);
}
// the last fourteen days: a work authorisation on every site and day, and some of the reports of those days are missing
for (const x of P) for (let k = 0; k < 14; k += 1) insW.run(`WAR/${x.pid}/${k}`, x.pid, x.site, day(k), x.acts[k % 50], x.pid, x.site);
db.exec('COMMIT'); db.exec('ANALYZE');
console.log(`${db.prepare('SELECT COUNT(*) AS n FROM site_dprs').get().n} reports, ${db.prepare('SELECT COUNT(*) AS n FROM site_dpr_work').get().n} work lines, ${db.prepare('SELECT COUNT(*) AS n FROM site_dpr_labour').get().n} labour lines, ${db.prepare('SELECT COUNT(*) AS n FROM site_dpr_notes').get().n} notes.\n`);
const dprSvc = createDprService({ db }); const rep = createDprReports({ db, base: dprSvc.base }); const d = dprSvc.dprs;
const se = { user: 'perf-se', roles: ['SE', 'PLAN'], companyId: 1 };
const results = []; const sorted = (ms) => [...ms].sort((a, b) => a - b);
const record = (label, limit, ms) => { const p = sorted(ms)[Math.floor(ms.length * 0.95)] ?? 0; results.push({ label, p, limit }); console.log(`${label.padEnd(52)} p50 ${sorted(ms)[Math.floor(ms.length / 2)].toFixed(1).padStart(8)} ms   p95 ${p.toFixed(1).padStart(8)} ms   limit ${limit} ms`); };
const time = (label, limit, fn, k = queries) => { const ms = []; for (let i = 0; i < k; i += 1) { const t = performance.now(); fn(i); ms.push(performance.now() - t); } record(label, limit, ms); };
const X = (i) => P[i % P.length]; const one = (i) => db.prepare("SELECT id FROM site_dprs WHERE org_project_id = ? AND status = 'APPROVED' LIMIT 1 OFFSET ?").get(X(i).pid, i).id;
time('DPR register, first page (100 000 rows)', 500, () => d.list(se, { pageSize: '50' }));
time('DPR register, approved of a site', 500, (i) => d.list(se, { 'filter[status]': 'APPROVED', 'filter[siteId]': String(X(i).site), pageSize: '50' }));
time('DPR register, late of a project', 500, (i) => d.list(se, { 'filter[late]': '1', 'filter[projectId]': String(X(i).pid), pageSize: '50' }));
time('DPR register, search', 500, (i) => d.list(se, { q: `sup${i % 9}`, pageSize: '25' }));
time('one DPR with its sections and photos', 300, (i) => d.get(se, one(i)));
time('prefill of a site and day', 500, (i) => d.prefill(se, { siteId: X(i).site, date: day(i % 14), supervisor: undefined }));
time('a DPR started from the prefill', 800, (i) => { const x = X(i); const dt = day(2100 + i); insW.run(`WAN/${i}`, x.pid, x.site, dt, x.acts[i % 50], x.pid, x.site); return d.create(se, { siteId: x.site, dprDate: dt, usePrefill: true }); });
time('missing days of the last week', 500, () => rep.missing(se, {}), 5);
time('compliance of 14 days (50 sites)', 500, () => rep.compliance(se, {}), 5);
time('daily site report of the company (a day)', 500, (i) => rep.report(se, { period: 'DAY', date: day(14 + (i % 30)) }));
time('monthly progress report of a site', 500, (i) => rep.report(se, { period: 'MONTH', date: day(40 + i), siteId: X(i).site }), 8);
time('monthly progress report of the company', 3000, () => rep.report(se, { period: 'MONTH', date: day(60) }), 3);
console.log('\nQuery plans:');
for (const [label, sql] of [
  ['register, newest first', "SELECT x.id FROM site_dprs x JOIN org_projects p ON p.id = x.org_project_id WHERE x.deleted_at IS NULL AND x.company_id = 1 ORDER BY x.dpr_date DESC, x.id LIMIT 50"],
  ['register, status of a site', "SELECT x.id FROM site_dprs x WHERE x.dpr_site_id = 5 AND x.status = 'APPROVED' AND x.deleted_at IS NULL ORDER BY x.dpr_date DESC"],
  ['reports of a day', "SELECT * FROM site_dprs WHERE company_id = 1 AND dpr_date BETWEEN '2025-01-01' AND '2025-01-01' AND status = 'APPROVED' AND deleted_at IS NULL"],
  ['sections of a report', 'SELECT id FROM site_dpr_work WHERE dpr_id = 5 AND deleted_at IS NULL'],
  ['work lines of a work authorisation', 'SELECT SUM(qty) FROM site_dpr_work WHERE wa_id = 5 AND deleted_at IS NULL'],
  ['the report of a site and day (unique)', "SELECT id FROM site_dprs WHERE dpr_site_id = 5 AND dpr_date = '2025-01-01' AND scope = 'SITE' AND parent_dpr_id IS NULL AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED')"],
  ['expected site days (work authorisations)', "SELECT DISTINCT wa_site_id, plan_date FROM site_work_authorisations WHERE company_id = 1 AND plan_date BETWEEN '2025-01-01' AND '2025-01-14' AND status IN ('APPROVED', 'EMERGENCY', 'CLOSED') AND deleted_at IS NULL"],
]) console.log(`- ${label}: ${db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ')}`);
const over = results.filter((r) => r.p > r.limit);
console.log(over.length ? `\nOVER THE LIMIT: ${over.map((r) => r.label).join('; ')}` : '\nAll within the limits.');
process.exit(over.length ? 1 : 0);
