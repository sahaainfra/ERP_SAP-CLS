// npm run erp:proj-fin-perf -- [--queries 30]
// Parts 23.10 to 23.15 §14 (50 projects): 100 000 journal lines over the projects and 100 000 revenue recognition records (23.10); then times what the screens and
// the runs ask: the recognition list (first page, a month), one record, the preview of a month (worked out from the ledger), the project trial balance, the WIP
// report and the overhead report. Prints the query plans. The standard (05_GLOBAL_STANDARDS §11): p95 <= 500 ms for a list, <= 300 ms for one record,
// <= 800 ms for a save.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { createBase } from '../src/server/modules/proc/base.js';
import { bindFin, createFinService } from '../src/server/modules/fin/service.js';
import { createGlService } from '../src/server/modules/fin/gl.js';
import { createProjectAccountingService } from '../src/server/modules/fin/projacct.js';

const args = process.argv.slice(2);
const queries = Number(args.includes('--queries') ? args[args.indexOf('--queries') + 1] : 30);
const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys = OFF;'); migrateUp(db);
db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'perf')").run();
db.prepare("INSERT INTO core_company_settings (company_id, legal_name, gstins_json) VALUES (1, 'Main Infra Pvt Ltd', '[{\"gstin\":\"36AAACM1234F1Z5\",\"stateCode\":\"36\"}]') ON CONFLICT(company_id) DO NOTHING").run();
db.exec('BEGIN');
const fy = Number(db.prepare("INSERT INTO core_financial_years (company_id, code, start_date, end_date, status, created_by) VALUES (1, '2026-27', '2026-04-01', '2027-03-31', 'Open', 'perf')").run().lastInsertRowid);
for (let m = 0; m < 12; m += 1) { const mm = ((3 + m) % 12) + 1; const yy = 2026 + (m >= 9 ? 1 : 0); const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate(); db.prepare("INSERT INTO core_periods (company_id, fy_id, period_no, name, start_date, end_date, created_by) VALUES (1, ?, ?, ?, ?, ?, 'perf')").run(fy, m + 1, `P${m + 1}`, `${yy}-${String(mm).padStart(2, '0')}-01`, `${yy}-${String(mm).padStart(2, '0')}-${last}`); }
const projects = []; for (let p = 1; p <= 50; p += 1) projects.push(Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'ROAD', 'ACTIVE', 't', 'perf')").run(`P${p}`, `Project ${p}`).lastInsertRowid));
db.exec('COMMIT');
const fin = createFinService({ db }); bindFin(db, fin); fin.ensureSetup(1);
const acct = (code) => db.prepare('SELECT id FROM fin_accounts WHERE company_id = 1 AND code = ?').get(code).id;
const flags = { isOn: () => true }; const base = createBase({ db }); const gl = createGlService({ db, base });
const pa = createProjectAccountingService({ db, base, gl, flags });
const acc = { user: 'acc', roles: ['ACCMGR'], companyId: 1 };
const p95 = (ms) => [...ms].sort((x, y) => x - y)[Math.floor(ms.length * 0.95)] ?? 0;
const results = [];
const time = (label, limit, fn, n = queries) => { const ms = []; for (let i = 0; i < n; i += 1) { const t = performance.now(); fn(i); ms.push(performance.now() - t); } const r = { label, p95: Math.round(p95(ms)), limit, ok: p95(ms) <= limit }; results.push(r); console.log(`${r.ok ? 'OK  ' : 'OVER'} ${label}: p95 ${r.p95} ms (limit ${limit})`); };

console.log('Filling 50 contracts and budgets, 100 000 journal lines and 100 000 revenue recognition records...');
db.exec('BEGIN');
let seq = 0;
/** A row with the columns given; the other NOT NULL columns get the first allowed value or a filler. */
function fill(table, vals) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all(); const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql;
  const first = (name) => { const m = new RegExp(`CHECK \\(${name} IN \\(([^)]*)\\)\\)`).exec(sql); return m ? m[1].split(',')[0].trim().replace(/^'|'$/g, '') : null; };
  const names = []; const params = []; for (const c of cols) { if (c.name === 'id') continue; if (c.name in vals) { names.push(c.name); params.push(vals[c.name]); } else if (c.notnull && c.dflt_value == null) { names.push(c.name); params.push(first(c.name) ?? (/INT|REAL|NUM/i.test(c.type) ? 1 : `perf${(seq += 1)}`)); } }
  return Number(db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
}
for (const p of projects) { fill('ctr_contracts', { company_id: 1, org_project_id: p, original_paise: 10000000000, revised_paise: 10000000000, status: 'APPROVED', contract_state: 'ACTIVE' }); fill('bud_budgets', { company_id: 1, org_project_id: p, version_no: 1, status: 'APPROVED', total_amount: 8000000000, direct_total: 8000000000 }); }
const insJ = db.prepare("INSERT INTO fin_journals (company_id, doc_no, voucher_no, voucher_type, voucher_date, kind, narration, total_paise, status, created_by) VALUES (1, ?, ?, 'JV', ?, 'MANUAL', 'perf', ?, 'APPROVED', 'perf')");
const insL = db.prepare('INSERT INTO fin_journal_lines (company_id, journal_id, line_no, account_id, debit_paise, credit_paise, project_id, created_by) VALUES (1, ?, ?, ?, ?, ?, ?, \'perf\')');
const a510 = acct('510001'); const a220 = acct('220001'); const a140 = acct('140001'); const a410 = acct('410001');
for (let i = 0; i < 50_000; i += 1) { const p = projects[i % 50]; const d = `2026-${String(4 + (i % 7)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`; const v = 100_000 + i; const j = Number(insJ.run(`JV/${i}`, `JV/${i}`, d, v).lastInsertRowid); if (i % 3) { insL.run(j, 1, a510, v, 0, p); insL.run(j, 2, a220, 0, v, p); } else { insL.run(j, 1, a140, v, 0, p); insL.run(j, 2, a410, 0, v, p); } }
const insR = db.prepare("INSERT INTO pa_revenue_recognition (company_id, doc_no, org_project_id, period, method, poc_ppm, contract_revenue_paise, recognised_cum_paise, recognised_period_paise, status, created_by) VALUES (1, ?, ?, ?, 'COST_TO_COST', ?, 10000000000, ?, ?, ?, 'perf')");
for (let i = 0; i < 100_000; i += 1) { const p = projects[i % 50]; const k = Math.floor(i / 50); const y = 1900 + Math.floor(k / 12); const per = `${y}-${String(1 + (k % 12)).padStart(2, '0')}`; insR.run(`RR/${i}`, p, per, k % 1_000_000, k * 1000, 1000, k % 10 === 0 ? 'SUPERSEDED' : 'APPROVED'); }
db.exec('COMMIT'); db.exec('ANALYZE');
time('revenue recognition list, first page', 500, () => pa.recognition.list(acc, {}));
time('revenue recognition list, a month', 500, () => pa.recognition.list(acc, { 'filter[period]': '2026-10' }));
time('revenue recognition list, page 200', 500, () => pa.recognition.list(acc, { page: '200' }));
time('one recognition with its trace', 300, (i) => pa.recognition.get(acc, 1 + (i * 997) % 100_000));
time('preview of a month (from the ledger: 2 000 lines of the project)', 800, (i) => pa.recognition.preview(acc, { projectId: projects[i % 50], period: '2026-10', method: 'COST_TO_COST' }));
time('project trial balance of the year', 500, (i) => pa.reports.trialBalance(acc, { projectId: projects[i % 50], from: '2026-04-01', to: '2027-03-31' }));
time('WIP report of the month (100 000 records)', 500, () => pa.reports.wip(acc, { period: '2066-12' }), 10);
time('overhead report of the year', 500, () => pa.reports.overheads(acc, { from: '2026-04', to: '2027-03' }));
const plan = (label, sql) => { console.log(`- ${label}`); for (const r of db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()) console.log(`    ${r.detail}`); };
plan('ledger of a project to a date', "SELECT a.id, SUM(l.debit_paise) FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id JOIN fin_accounts a ON a.id = l.account_id WHERE j.company_id = 1 AND l.project_id = 5 AND j.status = 'APPROVED' AND j.deleted_at IS NULL AND l.deleted_at IS NULL AND j.voucher_date <= '2026-10-31' GROUP BY a.id");
plan('recognitions of a month', "SELECT x.* FROM pa_revenue_recognition x WHERE x.company_id = 1 AND x.deleted_at IS NULL AND x.period = '2026-10' ORDER BY x.period DESC LIMIT 25");
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\nOVER THE LIMIT: ${bad.map((r) => `${r.label} (${r.p95} ms)`).join('; ')}` : '\nEvery measure is within its limit.');
process.exit(bad.length ? 1 : 0);
