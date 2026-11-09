// npm run erp:bud-dept-perf -- [--queries 50]
// Part 12.04: fills 100 000 department budgets (2 000 cost centres x 10 financial years x 5 versions, one in force per cost centre and year), 120 000 budget lines (the budgets in force of the
// latest year, 5 accounts x 12 months), 100 000 ledger actuals and 60 projects, then times what the screens and the allocation ask: the list (first page, a filter, a deep page), one budget with its lines,
// the report by cost centre, account and month, the drill-down, the allocation preview over 500 cost centres, and a save. Prints the query plans of the list and the report.
// The standard (05_GLOBAL_STANDARDS section 11) is p95 <= 500 ms for a list, <= 300 ms for one record, <= 800 ms for a save.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { createBudgetService } from '../src/server/modules/bud/budgets.js';
import { createDeptService } from '../src/server/modules/bud/dept.js';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const queries = Number(opt('queries', 50));
const CC = 2000; const FYS = 10; const VERSIONS = 5; const ACTUALS = 100_000;
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
migrateUp(db);
db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'perf')").run();
const pad = (n) => String(n).padStart(2, '0');
console.log('Filling the masters...');
db.exec('BEGIN');
const fys = []; const periods = new Map();
for (let y = 0; y < FYS; y += 1) {
  const start = 2017 + y; const id = Number(db.prepare("INSERT INTO core_financial_years (company_id, code, start_date, end_date, status, created_by) VALUES (1, ?, ?, ?, 'Open', 'perf')").run(`${start}-${pad((start + 1) % 100)}`, `${start}-04-01`, `${start + 1}-03-31`).lastInsertRowid);
  fys.push(id); const ps = [];
  for (let m = 0; m < 12; m += 1) { const mm = ((3 + m) % 12) + 1; const yy = start + (m >= 9 ? 1 : 0); ps.push(Number(db.prepare("INSERT INTO core_periods (company_id, fy_id, period_no, name, start_date, end_date, created_by) VALUES (1, ?, ?, ?, ?, ?, 'perf')").run(id, m + 1, `M${mm} ${yy}`, `${yy}-${pad(mm)}-01`, `${yy}-${pad(mm)}-28`).lastInsertRowid)); }
  periods.set(id, ps);
}
const depts = []; for (let d = 0; d < 200; d += 1) depts.push(Number(db.prepare("INSERT INTO org_departments (company_id, kind, code, name, created_by, source_type) VALUES (1, 'DEPARTMENT', ?, ?, 'perf', 'perf')").run(`D${d}`, `Department ${d}`).lastInsertRowid));
const ccs = []; for (let c = 0; c < CC; c += 1) ccs.push(Number(db.prepare("INSERT INTO org_cost_centres (company_id, code, name, type, linked_type, linked_id, created_by, source_type) VALUES (1, ?, ?, 'COST', 'DEPARTMENT', ?, 'perf', 'perf')").run(`CC${c}`, `Cost centre ${c}`, depts[c % 200]).lastInsertRowid));
for (let p = 1; p <= 60; p += 1) { const id = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'ROAD', 'ACTIVE', 't', 'perf')").run(`P${p}`, `Project ${p}`).lastInsertRowid); db.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, contract_value, start_date, scheduled_completion, created_by) VALUES (1, ?, 'x', ?, '2026-04-01', '2027-03-31', 'perf')").run(id, 1_000_000_000 + p * 7_777_777); }
const accounts = db.prepare("SELECT a.id FROM fin_accounts a JOIN fin_account_groups g ON g.id = a.group_id WHERE a.company_id IS NULL AND g.nature = 'EXPENSE' AND a.is_control = 0 ORDER BY a.code LIMIT 5").all().map((x) => x.id);
db.exec('COMMIT');
console.log(`Filling ${CC * FYS * VERSIONS} budgets, their lines and ${ACTUALS} actuals...`);
db.exec('BEGIN');
const insB = db.prepare("INSERT INTO bud_dept_budgets (company_id, doc_no, doc_date, fy_id, cost_centre_id, department_id, version_no, vtype, name, status, total_amount, lines_count, requested_by, created_by, source_type) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prep', 'perf', 'perf')");
const insL = db.prepare("INSERT INTO bud_dept_lines (company_id, budget_id, account_id, period_id, amount, created_by, source_type) VALUES (1, ?, ?, ?, ?, 'perf', 'perf')");
const st = ['REJECTED', 'CANCELLED', 'SUPERSEDED', 'SUPERSEDED', 'APPROVED'];
let n = 0; const latest = fys.at(-1);
for (const fy of fys) for (let c = 0; c < CC; c += 1) for (let v = 1; v <= VERSIONS; v += 1) {
  n += 1; const inForce = v === VERSIONS; const lines = inForce && fy === latest;
  const id = Number(insB.run(`DEB/${String(n).padStart(6, '0')}`, `2026-0${1 + (n % 9)}-1${n % 9}`, fy, ccs[c], depts[c % 200], v, v === 1 ? 'ORIGINAL' : 'REVISED', `Budget ${c} ${v}`, st[v - 1], lines ? 60 * 1_000_000 : 50_000_000, lines ? 5 : 0).lastInsertRowid);
  if (lines) for (const a of accounts) for (const p of periods.get(fy)) insL.run(id, a, p, 1_000_000);
}
const insA = db.prepare("INSERT INTO bud_dept_actuals (company_id, fy_id, period_id, cost_centre_id, account_id, amount, src_type, src_id, src_line_id, doc_ref, posted_date, status, created_by, source_type) VALUES (1, ?, ?, ?, ?, ?, 'fin_journal', ?, '1', ?, '2026-05-01', 'POSTED', 'perf', 'perf')");
for (let i = 0; i < ACTUALS; i += 1) insA.run(latest, periods.get(latest)[i % 12], ccs[i % CC], accounts[i % 5], 50_000 + (i % 977), `J${i}`, `JV/${i}`);
db.prepare("INSERT INTO bud_alloc_rules (company_id, doc_no, fy_id, name, basis, rules_json, status, requested_by, approved_by, created_by) VALUES (1, 'ARL/0001', ?, 'Head office', 'REVENUE', ?, 'ACTIVE', 'acc', 'cfo', 'perf')").run(latest, JSON.stringify({ pool: { costCentreIds: ccs.slice(0, 500), accountIds: [] }, projectIds: [], fixed: [] }));
db.exec('COMMIT');
db.exec('ANALYZE');
console.log(`${db.prepare('SELECT COUNT(*) AS n FROM bud_dept_budgets').get().n} budgets, ${db.prepare('SELECT COUNT(*) AS n FROM bud_dept_lines').get().n} lines, ${db.prepare('SELECT COUNT(*) AS n FROM bud_dept_actuals').get().n} actuals.\n`);

const b = createBudgetService({ db }); const s = createDeptService({ db, base: b.budgetBase }).dept;
const cfo = { user: 'cfo', roles: ['CFO'], companyId: 1 }; const acc = { user: 'acc', roles: ['ACCMGR'], companyId: 1 };
const p95 = (ms) => [...ms].sort((x, y) => x - y)[Math.floor(ms.length * 0.95)] ?? 0;
const results = [];
const time = (label, limit, fn) => {
  const ms = [];
  for (let i = 0; i < queries; i += 1) { const t = performance.now(); fn(i); ms.push(performance.now() - t); }
  const p = p95(ms); results.push({ label, p95: Number(p.toFixed(1)), limit, ok: p <= limit });
  console.log(`${label.padEnd(46)} p50 ${[...ms].sort((x, y) => x - y)[Math.floor(ms.length / 2)].toFixed(1).padStart(7)} ms   p95 ${p.toFixed(1).padStart(7)} ms   (limit ${limit})`);
};
const someInForce = db.prepare("SELECT id FROM bud_dept_budgets WHERE fy_id = ? AND status = 'APPROVED' LIMIT 200").all(latest).map((x) => x.id);
time('list, first page (25)', 500, () => s.budgets.list(cfo, { pageSize: '25' }));
time('list, one year and status (25)', 500, () => s.budgets.list(cfo, { 'filter[fyId]': String(latest), 'filter[status]': 'APPROVED', pageSize: '25' }));
time('list, search by cost centre', 500, (i) => s.budgets.list(cfo, { q: `CC${(i * 37) % CC}`, pageSize: '25' }));
time('list, page 400', 500, () => s.budgets.list(cfo, { pageSize: '25', page: '400' }));
time('one budget with its lines', 300, (i) => s.budgets.get(cfo, someInForce[i % someInForce.length]));
time('report by cost centre (whole year)', 500, () => s.report(cfo, { fyId: latest, by: 'cost_centre', upTo: 12 }));
time('report by account', 500, () => s.report(cfo, { fyId: latest, by: 'account', upTo: 12 }));
time('report by month, one cost centre', 500, (i) => s.report(cfo, { fyId: latest, costCentreId: ccs[i % CC], by: 'month', upTo: 12 }));
time('drill-down, one cost centre and account', 500, (i) => s.reportDocs(cfo, { fyId: latest, costCentreId: ccs[i % CC], accountId: accounts[i % 5] }));
time('allocation preview (500 cost centres, 60 projects)', 500, () => s.runs.preview(acc, { ruleId: 1, fromPeriodNo: 1, toPeriodNo: 12, poolSource: 'BUDGET' }));
// a save: a new version of a budget in force (copy of 60 lines), then its lines replaced
const saves = someInForce.slice(0, queries);
time('save: new version, then replace its lines', 800, (i) => { const v = s.budgets.amend(acc, saves[i % saves.length], { reason: 'Performance check of a revision' }); s.budgets.update(acc, v.id, { lines: accounts.map((a) => ({ accountId: a, months: Array(12).fill(12000) })) }); });

console.log('\nQuery plans:');
const plan = (label, sql, ...p) => { console.log(`- ${label}`); for (const r of db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...p)) console.log(`    ${r.detail}`); };
plan('list, one year and status', "SELECT x.* FROM bud_dept_budgets x JOIN org_cost_centres c ON c.id = x.cost_centre_id JOIN core_financial_years f ON f.id = x.fy_id WHERE x.deleted_at IS NULL AND x.company_id = 1 AND x.fy_id = ? AND x.status = 'APPROVED' ORDER BY x.doc_date DESC, x.id DESC LIMIT 25", latest);
plan('report budget side, by cost centre', "SELECT b.cost_centre_id AS k, SUM(l.amount) FROM bud_dept_budgets b JOIN bud_dept_lines l ON l.budget_id = b.id AND l.deleted_at IS NULL WHERE b.company_id = 1 AND b.fy_id = ? AND b.status = 'APPROVED' AND b.deleted_at IS NULL AND b.cost_centre_id IN (SELECT c.id FROM org_cost_centres c WHERE c.company_id = 1) AND l.period_id IN (SELECT id FROM core_periods WHERE fy_id = ? AND period_no <= 12) GROUP BY b.cost_centre_id", latest, latest);
plan('report actual side, by cost centre', "SELECT x.cost_centre_id AS k, SUM(x.amount) FROM bud_dept_actuals x WHERE x.company_id = 1 AND x.fy_id = ? AND x.status = 'POSTED' AND x.deleted_at IS NULL AND x.cost_centre_id IN (SELECT c.id FROM org_cost_centres c WHERE c.company_id = 1) AND x.period_id IN (SELECT id FROM core_periods WHERE fy_id = ? AND period_no <= 12) GROUP BY x.cost_centre_id", latest, latest);
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\nOVER THE LIMIT: ${bad.map((r) => `${r.label} (${r.p95} ms)`).join('; ')}` : '\nEvery measure is within its limit.');
process.exit(bad.length ? 1 : 0);
