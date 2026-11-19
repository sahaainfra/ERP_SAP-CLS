// npm run erp:pay-perf -- [--queries 30]
// Parts 24.01 to 24.03 §14: payroll at volume — 2,000 employees and 100,000 pay assignments (24.01); times the screens and the saves: the assignment list (first
// page, a status), one assignment with its breakup, a CTC preview, an assignment saved. The standard (05_GLOBAL_STANDARDS §11): p95 <= 500 ms for a list,
// <= 300 ms for one record, <= 800 ms for a save. Prints the query plans.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { createBase } from '../src/server/modules/proc/base.js';
import { createStatutoryService } from '../src/server/modules/mdm/statutory.js';
import { createPaySetupService } from '../src/server/modules/pay/setup.js';

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
const plan = (label, sql) => { console.log(`- ${label}`); for (const r of db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()) console.log(`    ${r.detail}`); };
plan('the current assignment of an employee', "SELECT * FROM pay_assignments WHERE employee_id = 5 AND status = 'APPROVED' AND deleted_at IS NULL AND effective_to IS NULL ORDER BY effective_from DESC LIMIT 1");
plan('assignments waiting for approval', "SELECT x.* FROM pay_assignments x WHERE x.company_id = 1 AND x.deleted_at IS NULL AND x.status = 'SUBMITTED' ORDER BY x.effective_from DESC LIMIT 25");
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\nOVER THE LIMIT: ${bad.map((r) => `${r.label} (${r.p95} ms)`).join('; ')}` : '\nEvery measure is within its limit.');
process.exit(bad.length ? 1 : 0);
