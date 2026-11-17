// npm run erp:gl-perf -- [--queries 50] [--journals 100000]
// Part 23.01 §14: fills 100 000 posted journals (two lines each: 200 000 lines) over 50 projects and the twelve months of a financial year, then times what the screens ask:
// the journal list (first page, a type and status filter, a deep page), one journal with its lines, the ledger of a busy account (first page, a deep page), the trial
// balance of the year (whole company, one project), and a save (a draft journal of two lines, checked against the account rules). Prints the query plans.
// The standard (05_GLOBAL_STANDARDS section 11) is p95 <= 500 ms for a list, <= 300 ms for one record, <= 800 ms for a save.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { createBase } from '../src/server/modules/proc/base.js';
import { bindFin, createFinService } from '../src/server/modules/fin/service.js';
import { createGlService } from '../src/server/modules/fin/gl.js';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const queries = Number(opt('queries', 50)); const JOURNALS = Number(opt('journals', 100_000));
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
migrateUp(db);
db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'perf')").run();
console.log('Filling the masters...');
db.exec('BEGIN');
const fy = Number(db.prepare("INSERT INTO core_financial_years (company_id, code, start_date, end_date, status, created_by) VALUES (1, '2026-27', '2026-04-01', '2027-03-31', 'Open', 'perf')").run().lastInsertRowid);
const periods = [];
for (let m = 0; m < 12; m += 1) {
  const mm = ((3 + m) % 12) + 1; const yy = 2026 + (m >= 9 ? 1 : 0); const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  periods.push({ id: Number(db.prepare("INSERT INTO core_periods (company_id, fy_id, period_no, name, start_date, end_date, created_by) VALUES (1, ?, ?, ?, ?, ?, 'perf')").run(fy, m + 1, `P${m + 1}`, `${yy}-${String(mm).padStart(2, '0')}-01`, `${yy}-${String(mm).padStart(2, '0')}-${last}`).lastInsertRowid), yy, mm, last });
}
const projects = []; for (let p = 1; p <= 50; p += 1) projects.push(Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'ROAD', 'ACTIVE', 't', 'perf')").run(`P${p}`, `Project ${p}`).lastInsertRowid));
db.exec('COMMIT');
const fin = createFinService({ db }); bindFin(db, fin); fin.ensureSetup(1);
const acct = (code) => db.prepare('SELECT id FROM fin_accounts WHERE company_id = 1 AND code = ?').get(code).id;
const expenses = ['560004', '560001', '560002', '560003', '510001'].map(acct); const bank = acct('150002');

console.log(`Filling ${JOURNALS} posted journals and ${JOURNALS * 2} lines...`);
db.exec('BEGIN');
const insJ = db.prepare("INSERT INTO fin_journals (company_id, doc_no, voucher_type, voucher_no, voucher_date, fy_id, period_id, kind, narration, total_paise, status, posted_at, posted_by, requested_by, approved_by, created_by, source_type) VALUES (1, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, 'APPROVED', '2026-12-01T00:00:00Z', 'acc', 'fin', 'acc', 'perf', 'perf')");
const insL = db.prepare("INSERT INTO fin_journal_lines (company_id, journal_id, line_no, account_id, debit_paise, credit_paise, project_id, created_by, source_type) VALUES (1, ?, ?, ?, ?, ?, ?, 'perf', 'perf')");
const types = ['JV', 'PV', 'RV', 'PJ'];
for (let i = 0; i < JOURNALS; i += 1) {
  const p = periods[i % 12]; const day = 1 + (i % (p.last - 1)); const date = `${p.yy}-${String(p.mm).padStart(2, '0')}-${String(day).padStart(2, '0')}`; const amt = 10_000 + ((i * 7919) % 5_000_000); const type = types[i % 4];
  const id = Number(insJ.run(`JNL/${String(i + 1).padStart(6, '0')}`, type, `${type}/2026-27/${String(i + 1).padStart(6, '0')}`, date, fy, p.id, `Perf journal ${i + 1}`, amt).lastInsertRowid);
  insL.run(id, 1, expenses[i % 5], amt, 0, projects[i % 50]); insL.run(id, 2, bank, 0, amt, null);
}
// the balance projection, as the postings write it (BR-02)
db.exec(`INSERT INTO fin_balances (company_id, account_id, period_id, dimension_hash, branch_id, cost_centre_id, project_id, site_id, debit_paise, credit_paise, created_by, source_type)
  SELECT 1, l.account_id, j.period_id, '|' || COALESCE(l.project_id, '') || '||', NULL, NULL, l.project_id, NULL, SUM(l.debit_paise), SUM(l.credit_paise), 'perf', 'perf' FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id GROUP BY l.account_id, j.period_id, l.project_id`);
db.exec('COMMIT');
db.exec('ANALYZE');
console.log(`${db.prepare('SELECT COUNT(*) AS n FROM fin_journals').get().n} journals, ${db.prepare('SELECT COUNT(*) AS n FROM fin_journal_lines').get().n} lines.\n`);

const gl = createGlService({ db, base: createBase({ db }) });
const acc = { user: 'acc', roles: ['ACCMGR'], companyId: 1 }; const fx = { user: 'fin', roles: ['FINEX'], companyId: 1 };
const p95 = (ms) => [...ms].sort((x, y) => x - y)[Math.floor(ms.length * 0.95)] ?? 0;
const results = [];
const time = (label, limit, fn, n = queries) => {
  const ms = [];
  for (let i = 0; i < n; i += 1) { const t = performance.now(); fn(i); ms.push(performance.now() - t); }
  const p = p95(ms); results.push({ label, p95: Number(p.toFixed(1)), limit, ok: p <= limit });
  console.log(`${label.padEnd(46)} p50 ${[...ms].sort((x, y) => x - y)[Math.floor(ms.length / 2)].toFixed(1).padStart(7)} ms   p95 ${p.toFixed(1).padStart(7)} ms   (limit ${limit})`);
};
time('list, first page (25)', 500, () => gl.journals.list(acc, { pageSize: '25' }));
time('list, one type and status (25)', 500, () => gl.journals.list(acc, { 'filter[voucherType]': 'PV', 'filter[status]': 'APPROVED', pageSize: '25' }));
time('list, search by voucher number', 500, (i) => gl.journals.list(acc, { q: `JV/2026-27/0${String((i * 997) % JOURNALS).padStart(5, '0')}`, pageSize: '25' }));
time('list, page 400', 500, () => gl.journals.list(acc, { pageSize: '25', page: '400' }));
time('one journal with its lines', 300, (i) => gl.journals.get(acc, 1 + ((i * 7919) % JOURNALS)));
time('ledger of a busy account, first page (100)', 500, () => gl.ledger(acc, { accountId: expenses[0], from: '2026-04-01', to: '2027-03-31', pageSize: 100 }));
time('ledger, one month, page 20', 500, () => gl.ledger(acc, { accountId: bank, from: '2026-09-01', to: '2026-09-30', page: 20, pageSize: 100 }));
time('ledger of one project', 500, (i) => gl.ledger(acc, { accountId: expenses[i % 5], projectId: projects[i % 50], to: '2027-03-31', pageSize: 100 }));
time('trial balance of the year', 500, () => gl.trialBalance(acc, { asOf: '2027-03-31' }));
time('trial balance of one project', 500, (i) => gl.trialBalance(acc, { asOf: '2027-03-31', projectId: projects[i % 50] }));
time('save: a draft journal of two lines', 800, (i) => gl.journals.create(fx, { voucherType: 'JV', voucherDate: '2026-11-15', kind: 'MANUAL', narration: `Perf save ${i}`, lines: [{ accountId: expenses[0], debit: 1000 + i, projectId: projects[0] }, { accountId: bank, credit: 1000 + i }] }));

console.log('\nQuery plans:');
const plan = (label, sql, ...p) => { console.log(`- ${label}`); for (const r of db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...p)) console.log(`    ${r.detail}`); };
plan('list, one type and status', "SELECT x.* FROM fin_journals x WHERE x.company_id = 1 AND x.deleted_at IS NULL AND x.voucher_type = 'PV' AND x.status = 'APPROVED' ORDER BY x.voucher_date DESC, x.id DESC LIMIT 25");
plan('ledger rows of an account', "SELECT l.*, j.voucher_date FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id WHERE l.company_id = 1 AND l.account_id = ? AND j.status = 'APPROVED' AND j.voucher_date BETWEEN '2026-04-01' AND '2027-03-31' ORDER BY j.voucher_date, j.id, l.line_no LIMIT 100", bank);
plan('trial balance', "SELECT l.account_id, SUM(l.debit_paise), SUM(l.credit_paise) FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id WHERE l.company_id = 1 AND j.status = 'APPROVED' AND j.voucher_date BETWEEN '2026-04-01' AND '2027-03-31' GROUP BY l.account_id");
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\nOVER THE LIMIT: ${bad.map((r) => `${r.label} (${r.p95} ms)`).join('; ')}` : '\nEvery measure is within its limit.');
process.exit(bad.length ? 1 : 0);
