// npm run erp:pay-perf -- [--queries 30]
// Parts 24.01 to 24.03 §14: payroll at volume — 2,000 employees and 100,000 pay assignments (24.01); a month's run for the 2,000 and 98,000 run lines before it (24.02); times the screens and the saves: the assignment list (first
// page, a status), one assignment with its breakup, a CTC preview, an assignment saved. The standard (05_GLOBAL_STANDARDS §11): p95 <= 500 ms for a list,
// <= 300 ms for one record, <= 800 ms for a save. Prints the query plans.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { createBase } from '../src/server/modules/proc/base.js';
import { createStatutoryService } from '../src/server/modules/mdm/statutory.js';
import { createPaySetupService } from '../src/server/modules/pay/setup.js';
import { createPayRunService } from '../src/server/modules/pay/runs.js';
import { createPayWageService } from '../src/server/modules/pay/wages.js';
import { createStatutoryService as createFilingService } from '../src/server/modules/pay/statutory.js';
import { createLabourService } from '../src/server/modules/hr/labour.js';

const args = process.argv.slice(2);
const queries = Number(args.includes('--queries') ? args[args.indexOf('--queries') + 1] : 30);
const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys = OFF;'); migrateUp(db);
db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'perf')").run();
const results = []; const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]; };
const time = (label, limit, fn, n = queries) => { const ms = []; for (let i = 0; i < n; i += 1) { const t = performance.now(); fn(i); ms.push(performance.now() - t); } const r = { label, p95: Math.round(p95(ms)), limit, ok: p95(ms) <= limit }; results.push(r); console.log(`${r.ok ? 'OK  ' : 'OVER'} ${label}: p95 ${r.p95} ms (limit ${limit})`); };
const flags = { isOn: () => true }; const base = createBase({ db }); const s = createPaySetupService({ db, base, flags, statutory: createStatutoryService({ db, flags: null }) });
const pay = { user: 'pay', roles: ['PAY'], companyId: 1 };
const st = s.structures.save(pay, { code: 'STAFF', name: 'Staff', grade: 'M2', components: ['BASIC', 'HRA', 'CONVEYANCE', 'SPECIAL', 'PF_EE', 'PT', 'PF_ER', 'EPS_ER', 'EDLI_ER', 'PF_ADMIN', 'GRATUITY'].map((code) => ({ code, ...(code === 'CONVEYANCE' ? { value: 1600 } : {}) })) });
console.log('Filling 2 000 employees and 100 000 pay assignments...');
db.exec('BEGIN');
const insE = db.prepare("INSERT INTO hr_employees (company_id, emp_code, first_name, full_name, gender, dob, mobile, employment_type, doj, record_status, employment_status, created_by) VALUES (1, ?, 'E', ?, 'MALE', '1990-01-01', '9000000000', 'PERMANENT', '2000-01-01', 'APPROVED', 'ACTIVE', 'perf')");
const insS = db.prepare("INSERT INTO hr_employee_statutory (company_id, employee_id, pf_applicable, pt_state, created_by) VALUES (1, ?, 1, 'TS', 'perf')");
const emps = []; for (let i = 0; i < 2000; i += 1) { const id = Number(insE.run(`E${i}`, `Employee ${i}`).lastInsertRowid); insS.run(id); emps.push(id); }
const b = s.assignments.breakupOf(1, db.prepare('SELECT * FROM pay_structures WHERE id = ?').get(st.id), emps[0], 600000, {}, '2026-04-01');
const insA = db.prepare("INSERT INTO pay_assignments (company_id, doc_no, employee_id, structure_id, assignment_kind, ctc_annual_paise, component_values_json, gross_monthly_paise, effective_from, effective_to, reason, status, created_by) VALUES (1, ?, ?, ?, 'REVISION', 60000000, ?, ?, ?, ?, 'perf', ?, 'perf')");
const json = JSON.stringify(b);
for (let i = 0; i < 100_000; i += 1) { const k = Math.floor(i / 2000); const from = `${1977 + Math.floor(k / 12) + 1}-${String(1 + (k % 12)).padStart(2, '0')}-01`; insA.run(`PAS/P${i}`, emps[i % 2000], st.id, json, Math.round(b.fullGross * 100), from, '2025-12-31', i < 2000 && i % 10 === 0 ? 'SUBMITTED' : 'APPROVED'); }
db.exec('COMMIT'); db.exec('ANALYZE');
time('pay assignment list, first page (100 000)', 500, () => s.assignments.list(pay, {}));
time('pay assignment list, those waiting for approval', 500, () => s.assignments.list(pay, { 'filter[status]': 'SUBMITTED' }));
time('one assignment with its breakup', 300, (i) => s.assignments.get(pay, 1 + (i * 997) % 100000));
time('CTC breakup preview of a structure for an employee', 300, (i) => s.structures.preview(pay, { structureId: st.id, ctcAnnual: 600000 + i * 1000, employeeId: emps[i % 2000], date: '2026-10-01' }));
time('an assignment saved (validated and computed)', 800, (i) => { const a = s.assignments.create(pay, { employeeId: emps[i * 10 + 1], structureId: st.id, ctcAnnual: 720000, effectiveFrom: '2026-10-01', reason: 'perf' }); db.prepare("UPDATE pay_assignments SET status = 'CANCELLED' WHERE id = ?").run(a.id); }, Math.min(queries, 50));
// 24.02: the payroll of October for the 2,000 employees (a month of locked attendance each: 62,000 days), and 49 locked runs of 2,000 lines before it (98,000 lines)
const rsvc = createPayRunService({ db, base, flags, setup: s, expenses: () => null });
s.calendar.generate(pay, { fyStart: '2026-04-01' });
db.exec('BEGIN'); const insD = db.prepare("INSERT INTO att_daily (company_id, person_type, person_id, work_date, status, paid_day, lop_day, locked, computed_at, source) VALUES (1, 'EMPLOYEE', ?, ?, 'PRESENT', 1, 0, 1, '2026-11-01', 'SYSTEM')");
for (const e of emps) for (let d = 1; d <= 31; d += 1) insD.run(e, `2026-10-${String(d).padStart(2, '0')}`);
db.prepare("UPDATE pay_assignments SET effective_to = NULL WHERE id IN (SELECT MAX(id) FROM pay_assignments GROUP BY employee_id)").run(); db.prepare("UPDATE pay_assignments SET status = 'APPROVED'").run();
const insR = db.prepare("INSERT INTO pay_runs (company_id, doc_no, period, run_type, employees_count, status, created_by) VALUES (1, ?, ?, 'REGULAR', 2000, 'APPROVED', 'perf')"); const insL = db.prepare("INSERT INTO pay_run_lines (company_id, run_id, employee_id, days_in_month, payable_days, gross_paise, net_paise, created_by) VALUES (1, ?, ?, 30, 30, 5000000, 4500000, 'perf')");
for (let k = 0; k < 49; k += 1) { const rid = Number(insR.run(`PRUN/P${k}`, `${2020 + Math.floor(k / 12)}-${String(1 + (k % 12)).padStart(2, '0')}`).lastInsertRowid); for (const e of emps) insL.run(rid, e); }
db.exec('COMMIT'); db.exec('ANALYZE');
let run = null; time('the payroll of a month computed for 2,000 employees (a save run as one request)', 8000, () => { if (run) { db.prepare('DELETE FROM pay_run_lines WHERE run_id = ?').run(run.id); db.prepare('DELETE FROM pay_runs WHERE id = ?').run(run.id); db.prepare("UPDATE pay_calendar SET cal_status = 'OPEN'").run(); } run = rsvc.runs.create(pay, { period: '2026-10' }); }, 3);
time('payroll run list, first page (50 runs, 100 000 lines)', 500, () => rsvc.runs.list(pay, {}));
time('one run with its 2,000 lines', 800, () => rsvc.runs.get(pay, run.id), 5);
time('variance against last month (2,000 employees)', 500, () => rsvc.runs.variance(pay, run.id), 5);
const plan = (label, sql) => { console.log(`- ${label}`); for (const r of db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()) console.log(`    ${r.detail}`); };
// 24.03: labour wages — 50 projects with a site each, 2,000 workers of a departmental gang and 200 of a labour contractor, 2,000 approved weekly wage runs of
// 50 workers (100,000 wage lines); a week of punches for 200 workers at one site; the contractor's month of punches for its 200 workers
const lab = createLabourService({ db, dep: { may: () => true, need: () => {}, nextDoc: () => 'X', event: () => {}, root: (x) => x, usernameOf: () => 'perf' }, vaultKey: 'perf-vault-key-0000000000000000' });
const wsvc = createPayWageService({ db, base, flags, setup: s, labour: () => lab, ctr: () => null });
db.exec('BEGIN');
const br = Number(db.prepare("INSERT INTO org_branches (company_id, code, name, state_code, created_by) VALUES (1, 'TSB', 'Telangana', 'TS', 'perf')").run().lastInsertRowid); const sites = [];
for (let k = 0; k < 50; k += 1) { const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, branch_id) VALUES (1, ?, ?, 'BUILDING', 'ACTIVE', ?)").run(`PR${k}`, `Project ${k}`, br).lastInsertRowid); sites.push({ pid, sid: Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, ?, ?, 'ACTIVE')").run(pid, `S${k}`, `Site ${k}`).lastInsertRowid) }); }
const partner = (n) => Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, ?, ?, ?, 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'perf')").run(n, n, n).lastInsertRowid);
const dept = partner('Departmental gang'); const subk = partner('Shree Labour');
const insRate = db.prepare("INSERT INTO lab_wage_rates (company_id, doc_no, doc_date, status, kind, contractor_id, trade_code, skill_category, state_code, pay_basis, rate_minor, effective_from, created_by) VALUES (1, ?, '2026-04-01', 'APPROVED', ?, ?, ?, ?, 'TS', 'DAILY', ?, '2026-04-01', 'perf')");
insRate.run('MW1', 'MINIMUM', null, null, 'SKILLED', 70000); insRate.run('MW2', 'MINIMUM', null, null, 'UNSKILLED', 50000); insRate.run('CR1', 'CONTRACT', dept, 'MASON', 'SKILLED', 80000);
const insW = db.prepare("INSERT INTO lab_workers (company_id, doc_no, doc_date, status, worker_code, name, dob, gender, home_state, trade_code, skill_category, contractor_id, worker_status, uan, created_by) VALUES (1, ?, '2026-04-01', 'APPROVED', ?, ?, '1990-01-01', 'MALE', 'TS', ?, ?, ?, 'ACTIVE', ?, 'perf')");
const workers = []; for (let i = 0; i < 2200; i += 1) { const c = i < 2000 ? dept : subk; const id = Number(insW.run(`LW${i}`, `W${i}`, `Worker ${i}`, i % 3 ? 'MASON' : 'HELPER', i % 3 ? 'SKILLED' : 'UNSKILLED', c, i % 2 ? '1002003004' : null).lastInsertRowid); workers.push(id); }
db.exec('UPDATE lab_workers SET root_id = id');
const insWR = db.prepare("INSERT INTO pay_wage_runs (company_id, doc_no, org_project_id, org_site_id, contractor_id, cycle, period_from, period_to, pay_due_on, state_code, workers_count, net_paise, status, created_by) VALUES (1, ?, ?, ?, ?, 'WEEKLY', ?, ?, ?, 'TS', 50, 14000000, 'APPROVED', 'perf')");
const insWL = db.prepare("INSERT INTO pay_wage_lines (company_id, run_id, worker_id, trade_code, skill_category, days_milli, rate_paise, basic_paise, gross_paise, net_paise, created_by) VALUES (1, ?, ?, 'MASON', 'SKILLED', 6000, 80000, 480000, 480000, 480000, 'perf')");
const day0 = Date.parse('2025-01-06T00:00:00Z');
for (let k = 0; k < 2000; k += 1) { const st0 = sites[k % 50]; const from = new Date(day0 + Math.floor(k / 50) * 7 * 86_400_000).toISOString().slice(0, 10); const to = new Date(Date.parse(`${from}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  const rid = Number(insWR.run(`WAGE/P${k}`, st0.pid, st0.sid, dept, from, to, to).lastInsertRowid); for (let j = 0; j < 50; j += 1) insWL.run(rid, workers[(k * 50 + j) % 2000]); }
const insP = db.prepare("INSERT INTO att_punches (company_id, person_type, person_id, punch_site_id, punch_type, work_date, device_time, server_time, effective_time, method, recorded_by, client_uuid, result, created_by, source_type) VALUES (1, 'WORKER', ?, ?, ?, ?, ?, ?, ?, 'MOBILE', 'perf', ?, 'ACCEPTED', 'perf', 'perf')");
const punch = (w, sid, date, type, hhmm) => { const at = `${date}T${hhmm}:00+05:30`; insP.run(w, sid, type, date, at, at, at, `${w}-${date}-${type}`); };
for (let i = 0; i < 200; i += 1) for (let d = 2; d <= 7; d += 1) { const dt = `2026-11-0${d}`; punch(workers[i], sites[0].sid, dt, 'IN', '08:00'); punch(workers[i], sites[0].sid, dt, 'OUT', i % 4 ? '17:00' : '19:00'); }
for (let i = 2000; i < 2200; i += 1) for (let d = 1; d <= 26; d += 1) { const dt = `2026-10-${String(d).padStart(2, '0')}`; punch(workers[i], sites[1].sid, dt, 'IN', '08:00'); punch(workers[i], sites[1].sid, dt, 'OUT', '17:00'); }
db.exec('COMMIT'); db.exec('ANALYZE');
const sacc = { user: 'sacc', roles: ['SACC'], companyId: 1 };
let wr = null; time('a week\'s wages computed for 200 workers from 2,400 punches (one save)', 800, () => { if (wr) { db.prepare('DELETE FROM pay_wage_lines WHERE run_id = ?').run(wr.id); db.prepare('DELETE FROM pay_wage_runs WHERE id = ?').run(wr.id); } wr = wsvc.runs.create(sacc, { siteId: sites[0].sid, contractorId: dept, cycle: 'WEEKLY', periodFrom: '2026-11-02' }); }, 5);
console.log(`  (run of ${wr.workers} workers, net ₹${wr.net})`);
time('wage run list, first page (2,000 runs, 100 000 lines)', 500, () => wsvc.runs.list(sacc, {}));
time('wage run list, one site', 500, (i) => wsvc.runs.list(sacc, { 'filter[siteId]': String(sites[i % 50].sid) }));
time('one wage run with its 50 lines', 300, (i) => wsvc.runs.get(sacc, 1 + (i * 37) % 2000));
time('a worker\'s wages saved (piece work, deductions) and the run computed again', 800, (i) => wsvc.runs.updateLine(sacc, wr.id, wr.lines[i % wr.lines.length].id, { allowances: i, canteen: 20 }), 10);
time('wage register of a month (200 runs, 10 000 lines)', 500, () => wsvc.runs.register(sacc, { from: '2025-02-01', to: '2025-02-28' }), 5);
let ck = null; time('a contractor\'s month checked against the attendance of 200 workers (one save)', 800, () => { if (ck) db.prepare('DELETE FROM pay_contractor_wage_checks WHERE id = ?').run(ck.id); ck = wsvc.checks.create({ user: 'subco', roles: ['SUBCO'], companyId: 1 }, { contractorId: subk, projectId: sites[1].pid, siteId: sites[1].sid, period: '2026-10' });
  ck = wsvc.checks.saveSheet({ user: 'subco', roles: ['SUBCO'], companyId: 1 }, ck.id, { lines: ck.attendance.map((a, k) => ({ workerCode: a.code, days: k % 10 ? a.days : a.days - 1, gross: a.days * 700, net: a.days * 700, paidOn: '2026-11-05' })) }); }, 5);
console.log(`  (variances found: ${ck.variances})`);
time('contractor wage verification worklist', 500, () => wsvc.checks.worklist({ user: 'hr', roles: ['HRMGR'], companyId: 1 }));
// 24.04: the statutory files of a month for the 2,000 employees of the computed payroll (ECR and ESI with their UANs), and the year's calendar
db.exec("UPDATE hr_employee_statutory SET uan = printf('%012d', employee_id), esic_ip = printf('%010d', employee_id) WHERE uan IS NULL");
const stat = createFilingService({ db, base, flags, setup: s });
db.prepare("UPDATE pay_runs SET status = 'APPROVED', locked_at = ? WHERE id = ?").run(new Date().toISOString(), run.id);
time('the ECR file of a month for 2,000 employees (validated and kept)', 800, () => stat.registers.generate(pay, { registerType: 'ECR_FILE', period: run.period }), 3);
time('the statutory calendar of a financial year (2026-27)', 500, () => stat.calendarOf(pay, '2026-27'), 5);
plan('wage runs of a site', "SELECT x.* FROM pay_wage_runs x WHERE x.company_id = 1 AND x.deleted_at IS NULL AND x.org_site_id = 3 ORDER BY x.period_from DESC LIMIT 25");
plan('the punches of a contractor\'s workers at a site in a week', "SELECT t.person_id FROM att_punches t JOIN lab_workers w ON w.id = t.person_id AND t.person_type = 'WORKER' WHERE t.company_id = 1 AND w.contractor_id = 2 AND t.work_date BETWEEN '2026-11-02' AND '2026-11-08' AND t.result IN ('ACCEPTED', 'FLAGGED') AND t.deleted_at IS NULL AND t.punch_site_id = 1");
plan('the current assignment of an employee', "SELECT * FROM pay_assignments WHERE employee_id = 5 AND status = 'APPROVED' AND deleted_at IS NULL AND effective_to IS NULL ORDER BY effective_from DESC LIMIT 1");
plan('assignments waiting for approval', "SELECT x.* FROM pay_assignments x WHERE x.company_id = 1 AND x.deleted_at IS NULL AND x.status = 'SUBMITTED' ORDER BY x.effective_from DESC LIMIT 25");
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\nOVER THE LIMIT: ${bad.map((r) => `${r.label} (${r.p95} ms)`).join('; ')}` : '\nEvery measure is within its limit.');
process.exit(bad.length ? 1 : 0);
