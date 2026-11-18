// npm run erp:proj-fin-perf -- [--queries 30]
// Parts 23.10 to 23.15 §14 (50 projects; 23.13 adds 100 000 cash forecast lines; 23.14 100 000 close tasks; 23.15 100 000 inter-company transactions): 100 000 journal lines over the projects and 100 000 revenue recognition records (23.10); then times what the screens and
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
import { createCostForecastService } from '../src/server/modules/fin/costforecast.js';
import { createProjectPlService } from '../src/server/modules/fin/projectpl.js';
import { createCashForecastService } from '../src/server/modules/fin/cashforecast.js';
import { createPeriodCloseService } from '../src/server/modules/fin/periodclose.js';
import { createInterCompanyService } from '../src/server/modules/fin/intercompany.js';

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
const cf = createCostForecastService({ db, base, flags }); const pa = createProjectAccountingService({ db, base, gl, flags, forecast: () => cf });
const acc = { user: 'acc', roles: ['ACCMGR'], companyId: 1 };
const p95 = (ms) => [...ms].sort((x, y) => x - y)[Math.floor(ms.length * 0.95)] ?? 0;
const results = [];
const time = (label, limit, fn, n = queries) => { const ms = []; for (let i = 0; i < n; i += 1) { const t = performance.now(); fn(i); ms.push(performance.now() - t); } const r = { label, p95: Math.round(p95(ms)), limit, ok: p95(ms) <= limit }; results.push(r); console.log(`${r.ok ? 'OK  ' : 'OVER'} ${label}: p95 ${r.p95} ms (limit ${limit})`); };

console.log('Filling 50 contracts and budgets, 100 000 journal lines and 100 000 revenue recognition records...');
db.exec('BEGIN');
let seq = 0;
/** A row with the columns given; the other NOT NULL columns get the first allowed value or a filler. */
/** @param {string} table @param {Record<string, any>} vals */
function fill(table, vals) {
  const cols = /** @type {any[]} */ (db.prepare(`PRAGMA table_info(${table})`).all()); const sql = String(/** @type {any} */ (db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table)).sql);
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
// 23.11: 50 projects × 200 WBS/cost code facts (10 000 lines), 100 000 forecasts
console.log('Filling 10 000 control facts and 100 000 cost forecasts...');
db.exec('BEGIN');
const ccIds = []; for (let k = 0; k < 200; k += 1) ccIds.push(fill('fin_cost_codes', { company_id: 1, code: `CC${k}`, name: `Cost ${k}` }));
const insF = db.prepare("INSERT INTO ctl_facts (company_id, org_project_id, wbs_id, cost_code_id, period_key, budget_cost, budget_qty, committed_cost, actual_cost, actual_qty, earned_cost, created_by) VALUES (1, ?, NULL, ?, '', ?, 1000000, ?, ?, 300000, ?, 'perf')");
for (const p of projects) for (const c of ccIds) insF.run(p, c, 10_000_000, 2_000_000, 4_000_000, 3_000_000);
const insC = db.prepare("INSERT INTO fc_forecasts (company_id, doc_no, org_project_id, period, version_no, budget_paise, eac_total_paise, vac_total_paise, status, created_by) VALUES (1, ?, ?, ?, 1, 2000000000, 2100000000, -100000000, ?, 'perf')");
for (let i = 0; i < 100_000; i += 1) { const p = projects[i % 50]; const k = Math.floor(i / 50); const per = `${1900 + Math.floor(k / 12)}-${String(1 + (k % 12)).padStart(2, '0')}`; insC.run(`FC/${i}`, p, per, k % 10 === 0 ? 'SUPERSEDED' : 'APPROVED'); }
db.exec('COMMIT'); db.exec('ANALYZE');
const pcm = { user: 'pcm', roles: ['PCMGR'], companyId: 1 };
time('cost forecast list, first page', 500, () => cf.forecasts.list(pcm, {}));
time('cost forecast list, a month', 500, () => cf.forecasts.list(pcm, { 'filter[period]': '2026-10' }));
let made = null; time('a forecast prepared from 200 facts (save)', 800, (i) => { const x = cf.forecasts.create(pcm, { projectId: projects[i % 50], period: '2026-11' }); made = x; db.prepare("UPDATE fc_forecasts SET status = 'CANCELLED' WHERE id = ?").run(x.id); }, 10);
time('one forecast with 200 lines and its bridge', 300, () => cf.forecasts.get(pcm, made.id));
time('forecast variance of all projects (100 000 forecasts)', 500, () => cf.reports.variance(pcm, { period: '2066-12' }), 10);
time('EAC trend of a project', 500, (i) => cf.reports.trend(pcm, { projectId: projects[i % 50] }));
// 23.12: the P&L over the 100 000 journal lines; 100 000 snapshots
const ps = createProjectPlService({ db, base, flags }); const cfo = { user: 'cfo', roles: ['CFO'], companyId: 1 };
db.exec('BEGIN'); const insS = db.prepare("INSERT INTO pl_snapshots (company_id, doc_no, org_project_id, period, revenue_paise, status, created_by) VALUES (1, ?, ?, ?, 100000, 'APPROVED', 'perf')");
for (let i = 0; i < 100_000; i += 1) { const k = Math.floor(i / 50); insS.run(`PLS/${i}`, projects[i % 50], `${1900 + Math.floor(k / 12)}-${String(1 + (k % 12)).padStart(2, '0')}`); } db.exec('COMMIT'); db.exec('ANALYZE');
time('project P&L of a month (month, year, to date, budget, forecast, 6-month trend)', 500, (i) => ps.pl.project(cfo, { projectId: projects[i % 50], period: '2026-10' }));
time('profitability of the year, 50 projects (100 000 journal lines)', 500, () => ps.portfolio(cfo, { from: '2026-04-01', to: '2027-03-31' }), 10);
time('P&L snapshot list, first page (100 000)', 500, () => ps.snapshots.list(cfo, {}));
time('drill-down of a P&L line', 500, (i) => ps.pl.drill(cfo, { projectId: projects[i % 50], line: 'MATERIAL', from: '2026-04-01', to: '2026-10-31' }));
// 23.13: 100 000 cash forecast lines over 50 forecasts; this week's forecast prepared from the ledger, the treasury, the variance, a project curve
const cs = createCashForecastService({ db, base, flags }); const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
db.exec('BEGIN'); const insCf = db.prepare("INSERT INTO cf_forecasts (company_id, doc_no, version_no, week_start, weeks, status, created_by) VALUES (1, ?, 1, ?, 13, 'SUPERSEDED', 'perf')"); const insCl = db.prepare("INSERT INTO cf_lines (company_id, forecast_id, org_project_id, category, week_start, inflow_paise, outflow_paise, source, created_by) VALUES (1, ?, ?, ?, ?, ?, ?, 'SOURCE', 'perf')");
const fids = []; for (let f = 0; f < 50; f += 1) { const ws = new Date(Date.UTC(2020, 0, 6 + 7 * f)).toISOString().slice(0, 10); fids.push(Number(insCf.run(`CF/P${f}`, ws).lastInsertRowid)); for (let i = 0; i < 2000; i += 1) { const wk = new Date(Date.UTC(2020, 0, 6 + 7 * (f + (i % 13)))).toISOString().slice(0, 10); insCl.run(fids[f], projects[i % 50], i % 2 ? 'AP_DUE' : 'AR_OPEN', wk, i % 2 ? 0 : 50000, i % 2 ? 40000 : 0); } }
db.exec('COMMIT'); db.exec('ANALYZE');
time('cash forecast list, first page', 500, () => cs.forecasts.list(acc, {}));
time('one cash forecast with 2 000 lines, a scenario', 300, (i) => cs.forecasts.get(acc, fids[i % 50], { scenario: i % 2 ? 'BOTH' : 'BASE' }));
let cfx = null; time('this week\'s forecast prepared from the source modules (save)', 800, () => { cfx = cs.forecasts.create(acc, { weekStart: today }); db.prepare("UPDATE cf_forecasts SET status = 'CANCELLED', deleted_at = 'x' WHERE id = ?").run(cfx.id); }, 10);
time('treasury and cash position', 300, () => cs.treasury(acc));
time('payment priority', 500, () => cs.priority.list(acc, {}));
time('project cash curve (100 000 journal lines)', 500, (i) => cs.projectCurve(acc, { projectId: projects[i % 50] }));
// 23.14: 10 000 closes with 100 000 tasks; the statements, the dashboard and one close over the 100 000 journal lines
const pcs = createPeriodCloseService({ db, base, flags, gl }); const oct = db.prepare("SELECT id FROM core_periods WHERE company_id = 1 AND start_date = '2026-10-01'").get().id;
db.exec('BEGIN'); const insP = db.prepare("INSERT INTO close_periods (company_id, doc_no, version_no, period_id, period, status, close_state, created_by) VALUES (1, ?, ?, ?, '2026-10', 'CANCELLED', 'IN_PROGRESS', 'perf')"); const insT = db.prepare("INSERT INTO close_tasks (company_id, close_id, task_code, name, module, sort_order, owner_id, due_date, created_by) VALUES (1, ?, ?, 'task', 'finance', ?, 'acc', '2026-11-07', 'perf')");
let lastClose = 0; for (let i = 0; i < 10_000; i += 1) { lastClose = Number(insP.run(`CL/P${i}`, i + 1, oct).lastInsertRowid); for (let k = 0; k < 10; k += 1) insT.run(lastClose, `T${k}`, k); } db.exec('COMMIT'); db.exec('ANALYZE');
const cfo2 = { user: 'cfo', roles: ['CFO'], companyId: 1 };
time('period close list, first page (10 000 closes)', 500, () => pcs.closes.list(acc, {}));
time('one close with its checklist and the checks', 300, () => pcs.closes.get(acc, lastClose));
time('statements of a month: Schedule III, cash flow, TB, comparatives (100 000 journal lines)', 500, () => pcs.statements.get(cfo2, { period: '2026-10', basis: 'MONTH' }), 10);
time('statements year to date', 500, () => pcs.statements.get(cfo2, { period: '2026-10', basis: 'YTD', statement: 'PL' }), 10);
time('finance dashboard (12-month trend, ageing, exceptions)', 800, () => pcs.dashboard(cfo2, { period: '2026-10' }), 10);
// 23.15: a subsidiary, 100 000 inter-company transactions (the last 1 000 posted with their mirror journals); the list, the reconciliation, the consolidation
db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (2, 'SUB', 'Sub Infra Pvt Ltd', 'Sub', 't', 'perf')").run(); fin.ensureSetup(2);
db.exec('BEGIN'); const fy2 = Number(db.prepare("INSERT INTO core_financial_years (company_id, code, start_date, end_date, status, created_by) VALUES (2, '2026-27', '2026-04-01', '2027-03-31', 'Open', 'perf')").run().lastInsertRowid);
for (let m = 0; m < 12; m += 1) { const mm = ((3 + m) % 12) + 1; const yy = 2026 + (m >= 9 ? 1 : 0); const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate(); db.prepare("INSERT INTO core_periods (company_id, fy_id, period_no, name, start_date, end_date, created_by) VALUES (2, ?, ?, ?, ?, ?, 'perf')").run(fy2, m + 1, `P${m + 1}`, `${yy}-${String(mm).padStart(2, '0')}-01`, `${yy}-${String(mm).padStart(2, '0')}-${last}`); }
const rel = Number(db.prepare("INSERT INTO ic_relationships (company_id, counterpart_company_id, relationship_type, holding_pct, created_by) VALUES (1, 2, 'SUBSIDIARY', 80, 'perf')").run().lastInsertRowid);
const inc = acct('420001'); const insI = db.prepare("INSERT INTO ic_transactions (company_id, doc_no, relationship_id, to_company_id, ic_type, txn_date, amount_paise, description, from_account_id, ic_state, status, created_by) VALUES (1, ?, ?, 2, 'CHARGE', ?, 100000, 'perf', ?, 'DRAFT', 'CANCELLED', 'perf')");
for (let i = 0; i < 99_000; i += 1) insI.run(`IC/P${i}`, rel, `2026-${String(4 + (i % 8)).padStart(2, '0')}-15`, inc); db.exec('COMMIT');
const ics = createInterCompanyService({ db, base, flags, gl, closes: () => pcs }); const exp2 = db.prepare("SELECT id FROM fin_accounts WHERE company_id = 2 AND code = '550001'").get().id;
db.exec('BEGIN'); for (let i = 0; i < 1000; i += 1) { const id = Number(db.prepare("INSERT INTO ic_transactions (company_id, doc_no, relationship_id, to_company_id, ic_type, txn_date, amount_paise, description, from_account_id, ic_state, status, created_by) VALUES (1, ?, ?, 2, 'CHARGE', '2026-10-10', 100000, 'perf', ?, 'AWAITING_COUNTERPART', 'APPROVED', 'perf')").run(`IC/A${i}`, rel, inc).lastInsertRowid);
  const ja = gl.postEngine(1, { date: '2026-10-10', narration: 'ic', sourceType: 'ic_transactions', sourceId: id, lines: [{ accountId: acct('160090'), debit: '1000' }, { accountId: inc, credit: '1000' }] }).journal; const jb = gl.postEngine(2, { date: '2026-10-10', narration: 'ic', sourceType: 'ic_transactions', sourceId: id, lines: [{ accountId: exp2, debit: '1000' }, { accountId: db.prepare("SELECT id FROM fin_accounts WHERE company_id = 2 AND code = '230090'").get().id, credit: '1000' }] }).journal;
  db.prepare("UPDATE ic_transactions SET ic_state = 'POSTED', to_account_id = ?, journals_json = ? WHERE id = ?").run(exp2, JSON.stringify({ from: ja.id, to: jb.id }), id); } db.exec('COMMIT'); db.exec('ANALYZE');
time('inter-company list, first page (100 000)', 500, () => ics.transactions.list(acc, {}));
time('one inter-company transaction with its mirror', 300, () => ics.transactions.get(acc, 99_500));
time('inter-company reconciliation (1 000 mirrored pairs)', 500, () => ics.reconciliation.get(acc, { asOf: '2026-10-31' }), 10);
time('consolidation preview, parent and subsidiary, YTD', 800, () => ics.consolidations.preview(cfo2, { period: '2026-10', basis: 'YTD' }), 10);
const plan = (label, sql) => { console.log(`- ${label}`); for (const r of db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()) console.log(`    ${r.detail}`); };
plan('ledger of a project to a date', "SELECT a.id, SUM(l.debit_paise) FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id JOIN fin_accounts a ON a.id = l.account_id WHERE j.company_id = 1 AND l.project_id = 5 AND j.status = 'APPROVED' AND j.deleted_at IS NULL AND l.deleted_at IS NULL AND j.voucher_date <= '2026-10-31' GROUP BY a.id");
plan('lines of a cash forecast', 'SELECT * FROM cf_lines WHERE forecast_id = 5 AND deleted_at IS NULL ORDER BY week_start, category, id');
plan('recognitions of a month', "SELECT x.* FROM pa_revenue_recognition x WHERE x.company_id = 1 AND x.deleted_at IS NULL AND x.period = '2026-10' ORDER BY x.period DESC LIMIT 25");
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\nOVER THE LIMIT: ${bad.map((r) => `${r.label} (${r.p95} ms)`).join('; ')}` : '\nEvery measure is within its limit.');
process.exit(bad.length ? 1 : 0);
