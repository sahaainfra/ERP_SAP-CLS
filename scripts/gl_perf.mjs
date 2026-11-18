// npm run erp:gl-perf -- [--queries 50] [--journals 100000]
// Parts 23.01, 23.02 and 23.03 §14: fills 100 000 posted journals (two lines each: 200 000 lines) over 50 projects and the twelve months of a financial year, then times what the screens ask:
// the journal list (first page, a type and status filter, a deep page), one journal with its lines, the ledger of a busy account (first page, a deep page), the trial
// balance of the year (whole company, one project), and a save (a draft journal of two lines, checked against the account rules). Prints the query plans.
// The standard (05_GLOBAL_STANDARDS section 11) is p95 <= 500 ms for a list, <= 300 ms for one record, <= 800 ms for a save.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { createBase } from '../src/server/modules/proc/base.js';
import { bindFin, createFinService } from '../src/server/modules/fin/service.js';
import { createGlService } from '../src/server/modules/fin/gl.js';
import { createPostingService } from '../src/server/modules/fin/posting.js';
import { createApService } from '../src/server/modules/fin/ap.js';
import { createPaymentService } from '../src/server/modules/fin/payments.js';

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

// part 23.02 §14: 100 000 rows in the posting log (one per event, 10 % failed), then the worklist, its summary and the reconciliation
console.log('\nFilling 100 000 posting log rows...');
db.exec('BEGIN');
const insP = db.prepare("INSERT INTO fin_posting_log (company_id, event_id, event_type, event_date, doc_type, doc_id, doc_ref, journal_id, log_status, error_code, error, amount_paise, payload_json, created_by, source_type) VALUES (1, ?, 'inv.grn.posted', ?, 'inv_grns', ?, ?, ?, ?, ?, ?, ?, '{}', 'perf', 'perf')");
for (let i = 0; i < 100_000; i += 1) { const failed = i % 10 === 0; insP.run(`ev-${i}`, `2026-${String(4 + (i % 9)).padStart(2, '0')}-15`, String(i), `GRN/${i}`, failed ? null : 1 + (i % JOURNALS), failed ? 'FAILED' : 'POSTED', failed ? 'PERIOD_CLOSED' : null, failed ? 'The period is closed.' : null, 10_000 + i); }
db.exec('COMMIT'); db.exec('ANALYZE');
const peSvc = createPostingService({ db, base: createBase({ db }), gl, flags: { isOn: () => true } });
time('postings worklist: failed, first page (25)', 500, () => peSvc.postings.list(acc, { 'filter[status]': 'FAILED', pageSize: '25' }));
time('postings, all, page 200', 500, () => peSvc.postings.list(acc, { pageSize: '25', page: '200' }));
time('postings summary (counts, reasons)', 500, () => peSvc.postings.summary(acc));
time('one posting with its preview', 300, (i) => peSvc.postings.get(acc, 1 + ((i * 7919) % 100_000)));
time('sub-ledger vs GL reconciliation', 500, () => peSvc.reconcile(acc, { asOf: '2027-03-31' }));

// part 23.03 §14: 100 000 AP bills over 500 vendors (a tenth of them MSME), then the list, the TDS of a new bill (the year's prior bills of the vendor), the vendor ledger, the ageing and the MSME report
console.log('\nFilling 100 000 AP bills...');
db.exec('BEGIN');
const vendors = []; for (let v = 1; v <= 500; v += 1) vendors.push(Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, pan, msme_category, partner_status, steward_role, created_by) VALUES (1, ?, ?, ?, 'PRIVATE_LIMITED', 'AABCD1234E', ?, 'ACTIVE', 'PROCMGR', 'perf')").run(`V${v}`, `Vendor ${v}`, `V${v}`, v % 10 === 0 ? 'MICRO' : null).lastInsertRowid));
const insB = db.prepare("INSERT INTO ap_bills (company_id, doc_no, bill_source, source_ref, partner_id, payee_name, bill_date, due_date, msme, msme_due_date, gross_paise, total_paise, tds_nature, tds_base_paise, tds_paise, net_payable_paise, status, created_by) VALUES (1, ?, 'VENDOR_INVOICE', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONTRACTOR', ?, ?, ?, 'APPROVED', 'perf')");
for (let i = 0; i < 100_000; i += 1) { const v = vendors[i % 500]; const m = 4 + (i % 9); const date = `2026-${String(m).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}`; const amt = 100_000 + (i % 5_000_000); const msme = (i % 500) % 10 === 9 ? 1 : 0; insB.run(`APB/${i + 1}`, String(i + 1), v, `Vendor ${(i % 500) + 1}`, date, date, msme, msme ? date : null, amt, amt, amt, Math.round(amt / 50), amt - Math.round(amt / 50)); }
db.exec('COMMIT'); db.exec('ANALYZE');
const apSvc = createApService({ db, base: createBase({ db }), gl, flags: { isOn: () => true } });
time('AP bills list, first page (25)', 500, () => apSvc.bills.list(acc, { pageSize: '25' }));
time('AP bills, page 300', 500, () => apSvc.bills.list(acc, { pageSize: '25', page: '300' }));
time('TDS of a new bill (the vendor year counted)', 300, (i) => apSvc.tdsFor(1, { partnerId: vendors[i % 500], nature: 'CONTRACTOR', date: '2026-11-15', basePaise: 5_000_000 }));
time('vendor ledger (200 bills)', 500, (i) => apSvc.vendorLedger(acc, { partnerId: vendors[i % 500], from: undefined, to: undefined }));
time('payables ageing (100 000 bills)', 800, () => apSvc.ageing(acc, { asOf: '2027-01-31' }), 10);
time('MSME due report', 500, () => apSvc.msmeReport(acc, { asOf: '2026-12-31' }));

// part 23.04 §14: a bank account, 1 000 released proposals of 100 lines (100 000 lines and 100 000 payments, half confirmed with a UTR), then the lists, a payment, a run, the candidates, the cheque register
console.log('\nFilling 100 000 payments...');
db.exec('BEGIN');
const bankAcc = Number(db.prepare("INSERT INTO fin_bank_accounts (company_id, code, name, bank_name, ifsc, account_no_enc, account_last4, gl_account_id, file_format, cheque_next_no, cheque_last_no, created_by) VALUES (1, 'HDFC-CA', 'HDFC current', 'HDFC Bank', 'HDFC0000001', 'v1.x.x.x', '5678', ?, 'GENERIC_CSV', 100001, 900000, 'perf')").run(bank).lastInsertRowid);
const insPr = db.prepare("INSERT INTO pmt_proposals (company_id, doc_no, bank_account_id, pay_mode, pay_date, total_paise, lines_count, run_status, released_by, released_at, status, requested_by, approved_by, created_by) VALUES (1, ?, ?, ?, ?, ?, 100, 'RELEASED', 'cfo', ?, 'APPROVED', 'fin', 'acc', 'perf')");
const insPl = db.prepare("INSERT INTO pmt_proposal_lines (company_id, proposal_id, line_no, line_kind, ap_bill_id, partner_id, payee_name, amount_paise, line_status, created_by) VALUES (1, ?, ?, 'BILL', ?, ?, ?, ?, ?, 'perf')");
const insPay = db.prepare("INSERT INTO pmt_payments (company_id, doc_no, proposal_id, line_id, partner_id, payee_name, pay_mode, bank_account_id, amount_paise, utr, cheque_no, released_on, paid_on, pay_status, created_by) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'perf')");
for (let k = 0; k < 1000; k += 1) {
  const mode = k % 10 === 0 ? 'CHEQUE' : 'NEFT'; const date = `2026-${String(4 + (k % 8)).padStart(2, '0')}-${String(1 + (k % 27)).padStart(2, '0')}`;
  const pr = Number(insPr.run(`PP/${String(k + 1).padStart(6, '0')}`, bankAcc, mode, date, 100 * 50_000, `${date}T10:00:00.000Z`).lastInsertRowid);
  for (let j = 0; j < 100; j += 1) { const i = k * 100 + j; const v = vendors[i % 500]; const paid = i % 2 === 0; const l = Number(insPl.run(pr, j + 1, i + 1, v, `Vendor ${(i % 500) + 1}`, 50_000, paid ? 'PAID' : 'RELEASED').lastInsertRowid);
    insPay.run(`PAY/${String(i + 1).padStart(6, '0')}`, pr, l, v, `Vendor ${(i % 500) + 1}`, mode, bankAcc, 50_000, paid && mode !== 'CHEQUE' ? `UTR${String(i).padStart(12, '0')}` : null, mode === 'CHEQUE' ? String(100001 + i) : null, date, paid ? date : null, paid ? 'PAID' : 'PENDING'); }
}
db.exec('COMMIT'); db.exec('ANALYZE');
const pmSvc = createPaymentService({ db, base: createBase({ db }), gl, ap: apSvc });
time('payments list, first page (25)', 500, () => pmSvc.payments.list(acc, { pageSize: '25' }));
time('payments, sent to the bank, page 100', 500, () => pmSvc.payments.list(acc, { 'filter[status]': 'PENDING', pageSize: '25', page: '100' }));
time('payments, search by UTR', 500, (i) => pmSvc.payments.list(acc, { q: `UTR${String((i * 2 * 997) % 100_000).padStart(12, '0')}`, pageSize: '25' }));
time('one payment', 300, (i) => pmSvc.payments.get(acc, 1 + ((i * 7919) % 100_000)));
time('proposals list, first page (25)', 500, () => pmSvc.proposals.list(acc, { pageSize: '25' }));
time('one payment run (100 lines and payments)', 300, (i) => pmSvc.proposals.get(acc, 1 + (i % 1000)));
time('candidates: bills to pay (100 000 bills, 100 000 payments)', 800, () => pmSvc.proposals.candidates(fx, { dueBy: '2026-12-31', projectId: undefined, partnerId: undefined, msmeOnly: false }), 10);
time('cheque register (10 000 cheques)', 800, () => pmSvc.payments.chequeRegister(acc, { bankAccountId: bankAcc }), 10);

console.log('\nQuery plans:');
const plan = (label, sql, ...p) => { console.log(`- ${label}`); for (const r of db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...p)) console.log(`    ${r.detail}`); };
plan('list, one type and status', "SELECT x.* FROM fin_journals x WHERE x.company_id = 1 AND x.deleted_at IS NULL AND x.voucher_type = 'PV' AND x.status = 'APPROVED' ORDER BY x.voucher_date DESC, x.id DESC LIMIT 25");
plan('ledger rows of an account', "SELECT l.*, j.voucher_date FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id WHERE l.company_id = 1 AND l.account_id = ? AND j.status = 'APPROVED' AND j.voucher_date BETWEEN '2026-04-01' AND '2027-03-31' ORDER BY j.voucher_date, j.id, l.line_no LIMIT 100", bank);
plan('failed postings worklist', "SELECT x.* FROM fin_posting_log x WHERE x.company_id = 1 AND x.deleted_at IS NULL AND x.log_status = 'FAILED' ORDER BY x.event_date DESC, x.id DESC LIMIT 25");
plan('payments sent to the bank', "SELECT x.* FROM pmt_payments x JOIN pmt_proposals pr ON pr.id = x.proposal_id WHERE x.company_id = 1 AND x.deleted_at IS NULL AND x.pay_status = 'PENDING' ORDER BY x.id DESC LIMIT 25");
plan('trial balance', "SELECT l.account_id, SUM(l.debit_paise), SUM(l.credit_paise) FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id WHERE l.company_id = 1 AND j.status = 'APPROVED' AND j.voucher_date BETWEEN '2026-04-01' AND '2027-03-31' GROUP BY l.account_id");
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\nOVER THE LIMIT: ${bad.map((r) => `${r.label} (${r.p95} ms)`).join('; ')}` : '\nEvery measure is within its limit.');
process.exit(bad.length ? 1 : 0);
