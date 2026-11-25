import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ready as qaReady, as, fill, key, U as QU } from './qa-helpers.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { createVault } from '../src/server/platform/integrations/vault.js';
import { finOf } from '../src/server/modules/fin/service.js';
import { fnfCompute, runPosting, serviceOf, splitPaise } from '../src/server/modules/pay/settle.js';
import { opensWith } from '../src/server/modules/eng/tpl-protect.js';
import { todayIST } from '../src/shared/dates.js';

// Part 24.05: payroll posting, payslips, bank transfers and full-and-final settlement.
//  T-01 postings balance and allocate by project; the F&F computation matches the worked example.
//  and: the run posted by the engine (23.02) with the labour cost to the project ledger; the salary transfer (hold after the lock, preparer never releases, the
//  bank file checked, the payment posted, confirmed with the UTR, a returned salary reversed and paid again); payslips password-protected, in self-service, by
//  e-mail; the F&F only after the clearance (BR-01), approved PAY → HRMGR → CFO, posted, paid, late flag; rights, masking, other companies.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const U = { ...QU, pay: as('PAY', 'pay1'), hr: as('HRMGR', 'hr1'), cfo: as('CFO', 'cfo1'), acc: as('ACCMGR', 'acc1'), aud: as('AUD', 'aud1'), emp: as('EMP', 'ravi'), emp2: as('EMP', 'sita') };
const P = '/api/v1/pay';

test('T-01 a payroll run posts balanced: the cost of each employee split by project and site to the paisa, payables by kind, advances by employee', () => {
  assert.deepEqual(splitPaise(1000001, [0.6, 0.4]), [600001, 400000], 'the odd paisa goes to the largest remainder');
  assert.deepEqual(splitPaise(100, [1, 1, 1]), [34, 33, 33]);
  const lines = [
    { employeeId: 1, departmentId: 7, costCentreId: null, allocation: [{ projectId: 10, siteId: 100, share: 0.6 }, { projectId: 11, siteId: 110, share: 0.4 }],
      components: [{ code: 'BASIC', type: 'EARNING', amount: 25000 }, { code: 'HRA', type: 'EARNING', amount: 10000.01 }, { code: 'PF_EE', type: 'DEDUCTION', amount: 1800 }, { code: 'PT', type: 'DEDUCTION', amount: 200 }, { code: 'TDS', type: 'DEDUCTION', amount: 1500 }, { code: 'ADVANCE', type: 'DEDUCTION', amount: 2000 }, { code: 'PF_ER', type: 'EMPLOYER', amount: 550 }, { code: 'EPS_ER', type: 'EMPLOYER', amount: 1250 }, { code: 'GRATUITY', type: 'EMPLOYER', amount: 1202.4 }] },
    { employeeId: 2, departmentId: 8, costCentreId: 3, allocation: [],
      components: [{ code: 'BASIC', type: 'EARNING', amount: 15000 }, { code: 'REIMB', type: 'REIMBURSEMENT', amount: 500 }, { code: 'ESI_EE', type: 'DEDUCTION', amount: 116.25 }, { code: 'ESI_ER', type: 'EMPLOYER', amount: 503.75 }, { code: 'RECOVERY', type: 'DEDUCTION', amount: 300 }, { code: 'LWF_EE', type: 'DEDUCTION', amount: 2 }, { code: 'LWF_ER', type: 'EMPLOYER', amount: 5 }] },
  ];
  const p = runPosting(lines);
  assert.equal(p.balanced, true); assert.equal(p.debit, p.credit);
  const a = p.cost.find((c) => c.projectId === 10); const b = p.cost.find((c) => c.projectId === 11); const ho = p.cost.find((c) => c.projectId === null);
  assert.equal(a.salary + b.salary, 3500001, 'the salary of employee 1 is all allocated'); assert.equal(a.salary, 2100001); assert.equal(b.salary, 1400000);
  assert.equal(a.employer + b.employer, 180000); assert.equal(a.gratuity + b.gratuity, 120240);
  assert.equal(ho.salary, 1550000, 'no allocation: head office, with the reimbursement'); assert.equal(ho.departmentId, 8); assert.equal(ho.costCentreId, 3);
  assert.equal(p.totals.pf, 360000); assert.equal(p.totals.esi, 62000); assert.equal(p.totals.pt, 20000); assert.equal(p.totals.lwf, 700); assert.equal(p.totals.tds, 150000); assert.equal(p.totals.recoveries, 30000); assert.equal(p.totals.gratuity, 120240);
  assert.deepEqual(p.advances, [{ employeeId: 1, amount: 200000 }]);
  assert.equal(p.totals.net, (3500001 - 550000) + (1550000 - 41825), 'net pay = earnings and reimbursements less deductions');
});

test('T-01 the full-and-final worked example: last salary, leave encashment, notice recovery, gratuity under the Code, recoveries and TDS', () => {
  assert.deepEqual(serviceOf('2019-06-10', '2026-10-31'), { years: 7, months: 4, days: 22 });
  assert.deepEqual(serviceOf('2021-11-01', '2026-10-31'), { years: 5, months: 0, days: 0 });
  const tdsNew = { regime: 'NEW', standardDeduction: 75000, slabs: [{ upTo: 400000, rate: 0 }, { upTo: 800000, rate: 5 }, { upTo: 1200000, rate: 10 }, { upTo: 1600000, rate: 15 }, { upTo: 2000000, rate: 20 }, { upTo: 2400000, rate: 25 }, { upTo: null, rate: 30 }], rebateIncomeUpTo: 1200000, rebateMax: 60000, cess: 4 };
  const rules = { eligibility: { minYears: 5, fixedTermMinYears: 1, partYearMonths: 6, wageBase: 'CODE' }, gratuityCapPaise: 200000000, gratuityExemptCapPaise: 200000000, leaveExempt: { capPaise: 250000000, monthsOfAverage: 10 }, basis: { encashDivisor: 26, noticeDivisor: 30, gratuityDays: 15, gratuityDivisor: 26 } };
  const x = fnfCompute({
    lastSalary: { periods: ['2026-10'], earnings: [{ code: 'BASIC', name: 'Basic pay', amount: 25000, taxable: true }, { code: 'DA', name: 'Dearness allowance', amount: 5000, taxable: true }, { code: 'HRA', name: 'House rent allowance', amount: 15000, taxable: true }, { code: 'SPECIAL', name: 'Special allowance', amount: 5000, taxable: true }],
      deductions: [{ code: 'PF_EE', name: 'Provident fund (employee)', amount: 1800 }, { code: 'PT', name: 'Professional tax', amount: 200 }, { code: 'TDS', name: 'TDS', amount: 999 }], employer: [{ code: 'PF_ER', name: 'Employer EPF', amount: 550 }, { code: 'EPS_ER', name: 'Employer EPS', amount: 1250 }, { code: 'GRATUITY', name: 'Gratuity provision', amount: 1443 }] },
    monthly: { gross: 50000, basicDa: 30000, codeWages: 30000 }, leaveDays: 12, noticeRecoveryDays: 5, noticePayDays: 0, service: { doj: '2019-06-10', lwd: '2026-10-31', employmentType: 'PERMANENT' }, rules, bonus: { eligible: false },
    recoveries: { advances: 10000, items: [{ label: 'Laptop charger (IT)', amount: 1500 }], inputs: [] }, adjustments: [], tax: { params: tdsNew, ytdTaxable: 300000, ytdTds: 0, deductions: 0 } });
  const amt = (code) => x.components.find((c) => c.code === code)?.amount;
  assert.equal(amt('LEAVE_ENC'), 13846.15, '12 days × 30,000 / 26');
  assert.equal(amt('NOTICE_RECOVERY'), 8333.33, '5 days × 50,000 / 30');
  assert.equal(amt('GRATUITY'), 121153.85, '15 / 26 × 30,000 × 7 years (4 months beyond: not counted)');
  assert.equal(x.working.gratuity.countedYears, 7); assert.equal(x.working.gratuity.eligible, true);
  assert.equal(amt('LAST_TDS'), undefined, 'the TDS of the last salary is replaced by the tax of the year');
  assert.equal(amt('ER_GRATUITY'), undefined, 'no gratuity provision on the last salary: the gratuity is paid');
  assert.equal(x.gross, 185000, '50,000 last salary + 13,846.15 encashment + 121,153.85 gratuity');
  assert.equal(x.tds, 0, 'the year\'s taxable 3,50,000 (exempt gratuity and encashment) is within the nil slab');
  assert.equal(x.deductions, 21833.33, 'PF 1,800 + PT 200 + notice 8,333.33 + advance 10,000 + item 1,500');
  assert.equal(x.net, 163166.67); assert.equal(x.payable, 163166.67); assert.equal(x.recoverable, 0); assert.equal(x.employer, 1800);
  // under five years: no gratuity; a fixed-term employee from one year under the Code; a part year beyond six months counts
  const short = fnfCompute({ ...structuredClone({ lastSalary: null, monthly: { gross: 50000, basicDa: 30000, codeWages: 30000 }, leaveDays: 0, noticeRecoveryDays: 0, noticePayDays: 0, rules, recoveries: {}, adjustments: [], tax: null }), service: { doj: '2022-12-01', lwd: '2026-10-31', employmentType: 'PERMANENT' } });
  assert.equal(short.components.find((c) => c.code === 'GRATUITY').type, 'INFO'); assert.equal(short.gross, 0);
  const ft = fnfCompute({ lastSalary: null, monthly: { gross: 50000, basicDa: 30000, codeWages: 32000 }, leaveDays: 0, noticeRecoveryDays: 0, noticePayDays: 0, rules, recoveries: {}, adjustments: [], tax: null, service: { doj: '2025-03-01', lwd: '2026-10-31', employmentType: 'CONTRACT' } });
  assert.equal(ft.working.gratuity.countedYears, 2, '1 year 8 months: the part beyond six months counts'); assert.equal(ft.gross, Math.round((32000 * 15 * 2 / 26) * 100) / 100, 'on the Code-on-Wages base');
  // recoveries above the earnings: recoverable from the employee; tax above the rebate
  const neg = fnfCompute({ lastSalary: null, monthly: { gross: 50000, basicDa: 30000 }, leaveDays: 2, noticeRecoveryDays: 30, noticePayDays: 0, rules, recoveries: { advances: 20000 }, adjustments: [{ label: 'Notice waiver credit', type: 'EARNING', amount: 1000, reason: 'Approved by HR' }], tax: null, service: { doj: '2025-03-01', lwd: '2026-10-31', employmentType: 'PERMANENT' } });
  assert.equal(neg.payable, 0); assert.ok(neg.recoverable > 0); assert.equal(neg.net, -neg.recoverable);
  const big = fnfCompute({ lastSalary: null, monthly: { gross: 300000, basicDa: 200000 }, leaveDays: 300, noticeRecoveryDays: 0, noticePayDays: 60, rules, recoveries: {}, adjustments: [], tax: { params: tdsNew, ytdTaxable: 2100000, ytdTds: 300000, deductions: 0 }, service: { doj: '2006-04-01', lwd: '2026-10-31', employmentType: 'PERMANENT' } });
  assert.equal(big.components.find((c) => c.code === 'GRATUITY').amount, 2000000, 'capped at ₹20 lakh'); assert.ok(big.tds > 0, 'notice pay and the encashment above its exemption are taxed');
});

/** A locked October payroll of two employees in two projects, with banks, departments and the user links; the company's bank account. */
function fixture(r) {
  const d = r.d; const v = createVault(); finOf(d).ensureSetup(1);
  const dept = fill(d, 'org_departments', { company_id: 1, code: 'PRJ', name: 'Projects' });
  const uid = (u) => d.prepare('SELECT id FROM iam_users WHERE username = ?').get(u).id;
  const emp = (code, name, user, extra = {}) => { const id = fill(d, 'hr_employees', { company_id: 1, emp_code: code, first_name: name.split(' ')[0], full_name: name, gender: 'MALE', dob: '1990-08-15', mobile: '9000000000', employment_type: 'PERMANENT', doj: '2019-06-10', record_status: 'APPROVED', employment_status: 'ACTIVE', salary_payment_mode: 'BANK_TRANSFER', department_id: dept, user_id: user ? uid(user) : null, email: `${code.toLowerCase()}@example.com`, ...extra });
    fill(d, 'hr_employee_statutory', { company_id: 1, employee_id: id, pf_applicable: 1, esi_applicable: 0, pt_state: 'TS', pan_last4: '1234' });
    fill(d, 'hr_employee_banks', { company_id: 1, employee_id: id, account_enc: v.encrypt(`50100${id}1234567`, `hr_employee_bank/1/${id}`), account_hash: `h${id}`, account_last4: '4567', ifsc: 'HDFC0000123', account_name: name.toUpperCase(), bank_status: 'ACTIVE', verified_status: 'VERIFIED', is_primary: 1 }); return id; };
  const e1 = emp('E1', 'Ravi Kumar', 'ravi'); const e2 = emp('E2', 'Sita Devi', 'sita', { languages_json: '["hi"]' }); const e3 = emp('E3', 'Arjun Rao', null, { email: null });
  const comps = (basic) => [{ code: 'BASIC', name: 'Basic pay', type: 'EARNING', amount: basic, full: basic }, { code: 'DA', name: 'Dearness allowance', type: 'EARNING', amount: 5000, full: 5000 }, { code: 'HRA', name: 'House rent allowance', type: 'EARNING', amount: 15000, full: 15000 }, { code: 'SPECIAL', name: 'Special allowance', type: 'EARNING', amount: 5000, full: 5000 },
    { code: 'PF_EE', name: 'Provident fund (employee)', type: 'DEDUCTION', amount: 1800 }, { code: 'PT', name: 'Professional tax', type: 'DEDUCTION', amount: 200 }, { code: 'TDS', name: 'Income tax (TDS on salary)', type: 'DEDUCTION', amount: 1000 }, { code: 'PF_ER', name: 'Employer EPF', type: 'EMPLOYER', amount: 550 }, { code: 'EPS_ER', name: 'Employer EPS (pension)', type: 'EMPLOYER', amount: 1250 }, { code: 'GRATUITY', name: 'Gratuity provision', type: 'EMPLOYER', amount: 1443 }];
  const run = fill(d, 'pay_runs', { company_id: 1, period: '2026-10', run_type: 'REGULAR', status: 'APPROVED', employees_count: 3, gross_paise: 15000000, net_paise: 14100000, tds_paise: 300000, locked_at: '2026-11-02T00:00:00Z', doc_no: 'PRUN/2026-10' });
  const line = (e, alloc) => fill(d, 'pay_run_lines', { company_id: 1, run_id: run, employee_id: e, days_in_month: 31, payable_days: 31, paid_days: 31, lop_days: 0, components_json: JSON.stringify(comps(25000)), gross_paise: 5000000, taxable_paise: 5000000, deductions_paise: 300000, employer_paise: 324300, net_paise: 4700000, tds_paise: 100000, tds_json: '{"regime":"NEW"}', wages_json: JSON.stringify({ codeWages: 30000 }), flags_json: '[]', allocation_json: JSON.stringify(alloc), payment_mode: 'BANK_TRANSFER', bank_ok: 1 });
  const l1 = line(e1, [{ projectId: r.A, siteId: r.site, share: 0.75 }, { projectId: r.B, siteId: null, share: 0.25 }]); const l2 = line(e2, [{ projectId: r.A, siteId: r.site, share: 1 }]); const l3 = line(e3, []);
  const glBank = d.prepare("SELECT id FROM fin_accounts WHERE company_id = 1 AND code = '150002'").get().id;
  const bank = fill(d, 'fin_bank_accounts', { company_id: 1, code: 'HDFC1', name: 'HDFC current', bank_name: 'HDFC Bank', ifsc: 'HDFC0000001', account_no_enc: v.encrypt('99887766554433', 'fin_bank_account/1/HDFC1'), account_last4: '4433', gl_account_id: glBank, file_format: 'GENERIC_CSV', acct_status: 'ACTIVE' });
  return { run, e1, e2, e3, l1, l2, l3, bank, dept };
}
const journalOf = (d, sourceType, sourceId) => { const j = d.prepare("SELECT * FROM fin_journals WHERE company_id = 1 AND source_type = ? AND source_id = ? AND status != 'CANCELLED'").get(sourceType, String(sourceId)); if (!j) return null; const lines = d.prepare('SELECT l.*, a.code FROM fin_journal_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.journal_id = ?').all(j.id); return { j, lines, dr: lines.reduce((s, l) => s + l.debit_paise, 0), cr: lines.reduce((s, l) => s + l.credit_paise, 0) }; };

test('AC-01 the payroll is posted by project, paid through a checked bank file, the payslips distributed; holds and returned salaries; the rights', async () => {
  const r = await qaReady(opened, { users: Object.values(U) }); const d = r.d; const call = (who, method, path, body, k = key()) => r.api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const f = fixture(r);
  // FR-01: the approval of the run is posted by the engine (23.02) with the 24.05 rule
  publishEvent(d, { type: 'pay.run.approved', entity: 'pay_runs', entityId: f.run, actorId: 'cfo1', companyId: 1, data: { runId: f.run, docNo: 'PRUN/2026-10', period: '2026-10', type: 'REGULAR', employees: 3, net: 141000 } }); await r.drain(); await r.drain();
  const pj = journalOf(d, 'pay_runs', f.run); assert.ok(pj, JSON.stringify(d.prepare('SELECT error_code, error FROM fin_posting_log').all()));
  assert.equal(pj.dr, pj.cr, 'the payroll journal balances'); assert.equal(pj.dr, 3 * (5000000 + 324300));
  const sal = pj.lines.filter((l) => l.code === '530001'); assert.equal(sal.filter((l) => l.project_id === r.A).reduce((s, l) => s + l.debit_paise, 0), 3750000 + 5000000, 'project A: 75 % of E1 and all of E2');
  assert.equal(sal.find((l) => l.project_id === r.B).debit_paise, 1250000); assert.ok(sal.every((l) => l.department_id === f.dept), 'the department dimension the account needs');
  assert.equal(pj.lines.find((l) => l.code === '230010').credit_paise, 3 * 4700000, 'net pay payable'); assert.equal(pj.lines.find((l) => l.code === '230011').credit_paise, 3 * 360000, 'PF: employee, EPF and EPS');
  assert.equal(pj.lines.find((l) => l.code === '240011').credit_paise, 3 * 144300, 'gratuity provision'); assert.equal(pj.lines.find((l) => l.code === '230004').credit_paise, 300000, 'TDS payable');
  // the labour cost goes to the project cost ledger, a project at a time
  const lc = r.events('hr.payroll.posted'); assert.equal(lc.length, 2); assert.equal(lc.find((x) => x.projectId === r.B).lines[0].resourceType, 'LABOUR');
  // D-833 (owner's decision): the labour cost is charged to the allocated projects in the cost ledger, even though neither project's set-up
  // (proj_projects) is complete in this fixture; it used to be refused, retried and dead-lettered
  await r.drain(); await r.drain();
  const actual = (pid) => d.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM bud_actuals WHERE company_id = 1 AND src_type = 'pay_runs' AND src_id = ? AND org_project_id = ? AND deleted_at IS NULL").get(String(f.run), pid).n;
  const costOf = (pid) => lc.find((x) => x.projectId === pid).lines.reduce((t, l) => t + Math.round(Number(l.amount) * 100), 0);
  assert.ok(actual(r.A) > 0 && actual(r.B) > 0, 'both allocated projects carry their labour cost');
  assert.equal(actual(r.A), costOf(r.A)); assert.equal(actual(r.B), costOf(r.B));
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM core_inbox WHERE consumer = 'bud.ledger' AND status = 'DEAD'").get().n, 0, 'nothing dead-lettered');
  const page = await call(U.pay, 'GET', `/posting/runs/${f.run}`); assert.equal(page.status, 200, JSON.stringify(page.json)); assert.equal(page.json.data.posting.status, 'POSTED'); assert.equal(page.json.data.totals.balanced, true);
  assert.equal((await call(U.pay, 'POST', `/posting/runs/${f.run}/post`)).json.data.posting.status, 'POSTED', 'posting again changes nothing (one journal an event)');
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM fin_journals WHERE source_type = 'pay_runs'").get().n, 1);
  // FR-02 hold after the lock: Arjun's salary is held by HR with the reason
  assert.equal((await call(U.aud, 'POST', `/posting/runs/${f.run}/lines/${f.l3}/hold`, { hold: true, reason: 'Absconding, under inquiry' })).status, 403);
  assert.equal((await call(U.hr, 'POST', `/posting/runs/${f.run}/lines/${f.l3}/hold`, { hold: true, reason: 'Absconding, under inquiry' })).status, 200);
  const today = todayIST();
  const t1 = await call(U.pay, 'POST', '/transfers', { runId: f.run, bankAccountId: f.bank, payDate: today, mode: 'NEFT' }); assert.equal(t1.status, 201, JSON.stringify(t1.json));
  assert.equal(t1.json.data.lines, 2); assert.equal(t1.json.data.total, 94000); assert.match(t1.json.data.left[0].reason, /held/);
  assert.equal((await call(U.pay, 'POST', '/transfers', { runId: f.run, bankAccountId: f.bank, payDate: today })).status, 422, 'nothing left to pay: the held salary only');
  assert.equal((await call(U.pay, 'POST', `/transfers/${t1.json.data.id}/release`)).status, 403, 'payroll does not release');
  const rel = await call(U.acc, 'POST', `/transfers/${t1.json.data.id}/release`); assert.equal(rel.status, 200, JSON.stringify(rel.json)); assert.equal(rel.json.data.status, 'RELEASED');
  const fileRes = await r.api.raw('GET', `${P}/transfers/${t1.json.data.id}/file`, U.acc); assert.equal(fileRes.status, 200); const recs = fileRes.buffer.toString('utf8').trim().split(/\r?\n/);
  assert.equal(recs.length, 3, 'header and two records'); assert.match(recs[1], /^1,NEFT,47000\.00,/); assert.ok(recs[1].includes('RAVI KUMAR') && recs[1].includes('HDFC0000123'));
  const tj = journalOf(d, 'pay_transfers', t1.json.data.id); assert.equal(tj.lines.find((l) => l.code === '230010').debit_paise, 9400000); assert.equal(tj.lines.find((l) => l.code === '150002').credit_paise, 9400000, 'Dr salaries payable, Cr bank');
  // the bank confirms Ravi, returns Sita's: reversed, and Sita is payable again
  const items = (await call(U.cfo, 'GET', `/transfers/${t1.json.data.id}`)).json.data.items; const ravi = items.find((i) => i.employeeId === f.e1); const sita = items.find((i) => i.employeeId === f.e2);
  const conf = await call(U.cfo, 'POST', `/transfers/${t1.json.data.id}/confirm`, { rows: [{ lineId: ravi.id, status: 'PAID', utr: 'HDFCN52026111900001', paidOn: today }, { lineId: sita.id, status: 'FAILED', paidOn: today, reason: 'Account closed' }] });
  assert.equal(conf.status, 200, JSON.stringify(conf.json)); assert.equal(conf.json.data.transfer.status, 'CONFIRMED'); assert.equal(conf.json.data.transfer.paid, 47000);
  const rv = journalOf(d, 'pay_transfer_lines', sita.id); assert.equal(rv.lines.find((l) => l.code === '230010').credit_paise, 4700000, 'the returned salary is payable again');
  assert.equal(r.events('pay.salary.returned').length, 1);
  // HR releases the hold; the next transfer of the run takes Arjun and Sita
  assert.equal((await call(U.hr, 'POST', `/posting/runs/${f.run}/lines/${f.l3}/hold`, { hold: false, reason: 'Inquiry closed, rejoined' })).status, 200);
  const t2 = await call(U.pay, 'POST', '/transfers', { runId: f.run, bankAccountId: f.bank, payDate: today }); assert.equal(t2.status, 201); assert.equal(t2.json.data.kind, 'HELD_RELEASE'); assert.equal(t2.json.data.lines, 2);
  // payslips: generated from the template library, protected with the employee's password, in Hindi for Sita
  assert.equal((await call(U.aud, 'POST', '/payslips/generate', { runId: f.run })).status, 403);
  const g = await call(U.pay, 'POST', '/payslips/generate', { runId: f.run }); assert.equal(g.status, 202, JSON.stringify(g.json)); assert.equal(g.json.data.generated, 3, JSON.stringify(g.json.data.failed));
  const list = (await call(U.pay, 'GET', `/payslips?runId=${f.run}`)).json.data; assert.equal(list.rows.find((x) => x.employeeId === f.e2).lang, 'hi'); assert.equal(list.counts.generated, 3);
  const mine = (await call(U.emp, 'GET', '/payslips/mine')).json.data; assert.equal(mine.rows.length, 1); assert.equal(mine.rows[0].month, 'October 2026');
  const pdf = await r.api.raw('GET', `${P}/payslips/${mine.rows[0].id}/download`, U.emp); assert.equal(pdf.status, 200); assert.equal(pdf.buffer.subarray(0, 5).toString(), '%PDF-');
  assert.ok(opensWith(pdf.buffer, 'E115081990'), 'the employee code and the date of birth open it'); assert.ok(!opensWith(pdf.buffer, 'E1'), 'nothing else does');
  assert.ok(!pdf.buffer.toString('latin1').includes('Ravi Kumar'), 'the content is encrypted');
  const sitaSlip = list.rows.find((x) => x.employeeId === f.e2).id; assert.equal((await r.api.raw('GET', `${P}/payslips/${sitaSlip}/download`, U.emp)).status, 404, 'another employee\'s payslip is not shown');
  assert.ok((await call(U.pay, 'GET', `/payslips?runId=${f.run}`)).json.data.rows.find((x) => x.employeeId === f.e1).viewedAt, 'the view is recorded');
  const mail = await call(U.pay, 'POST', '/payslips/email', { runId: f.run }); assert.equal(mail.status, 202); assert.equal(mail.json.data.sent, 2); assert.equal(mail.json.data.noAddress, 1);
  const msg = d.prepare("SELECT * FROM comm_messages WHERE channel = 'EMAIL' AND to_address = 'e1@example.com'").get(); assert.ok(msg, 'the e-mail is queued'); assert.ok(JSON.parse(msg.attachments_json)[0].url, 'with a signed link to the protected file');
  // masking: the auditor sees the run's state, not the salaries
  const audPage = (await call(U.aud, 'GET', `/posting/runs/${f.run}`)).json.data; assert.equal(audPage.run.net, null); assert.equal(audPage.preview.length, 0);
  // another company sees nothing
  assert.equal((await r.api.call('GET', `${P}/posting/runs/${f.run}`, { ...as('PAY', 'pay2', '2') })).status, 404);
  // idempotent replay: the same key gives the same transfer
  const k = key(); const a1 = await call(U.pay, 'POST', `/transfers/${t2.json.data.id}/cancel`, { reason: 'Prepared on the wrong account' }, k); const a2 = await call(U.pay, 'POST', `/transfers/${t2.json.data.id}/cancel`, { reason: 'Prepared on the wrong account' }, k);
  assert.equal(a1.status, 200); assert.equal(a2.status, 200); assert.equal(a2.json.data.status, 'CANCELLED');
});

test('AC-01 the full-and-final after the clearance (BR-01): computed, approved PAY → HRMGR → CFO, posted, paid by bank with the late flag; amendment; rights', async () => {
  const r = await qaReady(opened, { users: Object.values(U) }); const d = r.d; const call = (who, method, path, body, k = key()) => r.api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const f = fixture(r);
  const inputs = { employeeId: f.e1, employee: 'Ravi Kumar', code: 'E1', doj: '2019-06-10', lastWorkingDay: '2026-10-31', noticeDays: 30, servedDays: 25, notice: { shortDays: 5, waiverDays: 0, recoveryDays: 5, payInLieuDays: 0 }, leaveEncashmentDays: 12, gratuity: { years: 7.39, countedYears: 7, minYears: 5, eligible: true }, reimbursements: { pendingClaims: 0, amount: 0 }, recoveries: { advances: 10000, items: [{ department: 'IT', item: 'Laptop charger', amount: 1500 }], total: 11500 }, clearances: [], canRelease: true, blockers: [] };
  const sep = fill(d, 'hr_separations', { company_id: 1, doc_no: 'SEP/1', doc_date: '2026-10-01', employee_id: f.e1, sep_type: 'RESIGNATION', reason_code: 'BETTER_OPPORTUNITY', reason: 'Moving on', submitted_on: '2026-10-06', notice_days: 30, standard_lwd: '2026-11-05', last_working_day: '2026-10-31', status: 'APPROVED' });
  // BR-01: not before the clearance is complete and the inputs released
  assert.equal((await call(U.pay, 'POST', '/fnf', { separationId: sep })).status, 422);
  d.prepare("UPDATE hr_separations SET status = 'SETTLED', fnf_json = ?, fnf_released_at = '2026-11-03T10:00:00Z', fnf_released_by = 'hr1' WHERE id = ?").run(JSON.stringify(inputs), sep);
  assert.equal((await call(U.pay, 'GET', '/fnf/candidates')).json.data.length, 1);
  assert.equal((await call(U.hr, 'POST', '/fnf', { separationId: sep })).status, 403, 'HR approves, payroll prepares');
  const c = await call(U.pay, 'POST', '/fnf', { separationId: sep }); assert.equal(c.status, 201, JSON.stringify(c.json)); const id = c.json.data.id;
  const x = c.json.data; const amt = (code) => x.components.find((k) => k.code === code)?.amount;
  assert.deepEqual(x.blockers, []); assert.equal(x.working.lastSalaryPeriods.length, 0, 'October is paid by the locked run');
  assert.equal(amt('LEAVE_ENC'), 13846.15); assert.equal(amt('NOTICE_RECOVERY'), 8333.33); assert.equal(amt('GRATUITY'), 121153.85); assert.equal(amt('ADVANCE'), 10000); assert.equal(amt('ITEM_1'), 1500);
  assert.equal(x.net, 13846.15 + 121153.85 - 8333.33 - 10000 - 1500 - x.tds); assert.equal(x.dueDate, '2026-11-03', 'two working days after the last working day (Code on Wages s.17(2))');
  assert.equal((await call(U.pay, 'POST', '/fnf', { separationId: sep })).status, 409, 'one settlement a separation');
  // an adjustment from a CSV; optimistic locking
  const imp = await call(U.pay, 'POST', `/fnf/${id}/import`, { csv: 'label,type,amount,reason\nShift allowance arrears,EARNING,2000,Approved by HR on 1 Nov' }); assert.equal(imp.status, 200, JSON.stringify(imp.json)); assert.equal(imp.json.data.net, Math.round((x.net + 2000) * 100) / 100);
  assert.equal((await call(U.pay, 'PATCH', `/fnf/${id}`, { version: 1, adjustments: [] })).status, 409, 'a stale version is refused');
  // the auditor reads without amounts; an employee does not read
  const audv = (await call(U.aud, 'GET', `/fnf/${id}`)).json.data; assert.equal(audv.net, null); assert.deepEqual(audv.components, []);
  assert.equal((await call(U.emp, 'GET', '/fnf')).status, 403);
  // PAY → HRMGR → CFO; payroll does not approve its own
  const sub = await call(U.pay, 'POST', `/fnf/${id}/submit`); assert.equal(sub.status, 202, JSON.stringify(sub.json)); const wf = r.wf('pay_fnf', id);
  assert.equal((await r.tasksOf(U.pay)).filter((t) => t.instance.id === wf).length, 0, 'the preparer has no approval task');
  // returned by HR for correction, sent again by payroll, then approved at both levels
  assert.equal((await r.act(U.hr, wf, 'return')).status, 200); assert.equal((await call(U.pay, 'GET', `/fnf/${id}`)).json.data.status, 'RETURNED');
  assert.equal((await call(U.pay, 'POST', `/fnf/${id}/submit`)).status, 202); const wf2 = r.wf('pay_fnf', id);
  assert.equal((await r.act(U.hr, wf2)).status, 200); assert.equal((await r.act(U.cfo, wf2)).status, 200); await r.drain(); await r.drain();
  const ap = (await call(U.pay, 'GET', `/fnf/${id}`)).json.data; assert.equal(ap.status, 'APPROVED'); assert.equal(ap.payStatus, 'UNPAID');
  assert.equal((await call(U.pay, 'PATCH', `/fnf/${id}`, { version: ap.version, adjustments: [] })).status, 409, 'an approved settlement is locked');
  const fj = journalOf(d, 'pay_fnf', id); assert.ok(fj, JSON.stringify(d.prepare("SELECT error_code, error FROM fin_posting_log WHERE doc_type = 'pay_fnf'").all())); assert.equal(fj.dr, fj.cr, 'the settlement journal balances');
  assert.equal(fj.lines.find((l) => l.code === '240011').debit_paise, 12115385, 'gratuity paid against the provision'); assert.equal(fj.lines.find((l) => l.code === '160002' && l.credit_paise).employee_id, f.e1, 'the advance recovered from the employee');
  // an amendment before payment: a new version, approved again; the earlier journal reversed
  const am = await call(U.pay, 'POST', `/fnf/${id}/amend`, { reason: 'Bonus rate to be applied' }); assert.equal(am.status, 201, JSON.stringify(am.json));
  assert.equal((await call(U.pay, 'POST', '/transfers', { fnfId: id, bankAccountId: f.bank, payDate: todayIST() })).status, 409, 'not paid while its amendment is open');
  const aid = am.json.data.id; assert.equal((await call(U.pay, 'POST', `/fnf/${aid}/cancel`, { reason: 'No change after all' })).status, 200);
  // paid by bank transfer: released by the CFO, confirmed; the settlement is paid, late against its due date
  const t = await call(U.pay, 'POST', '/transfers', { fnfId: id, bankAccountId: f.bank, payDate: todayIST() }); assert.equal(t.status, 201, JSON.stringify(t.json)); assert.equal(t.json.data.kind, 'FNF');
  assert.equal((await call(U.cfo, 'POST', `/transfers/${t.json.data.id}/release`)).status, 200);
  const line = (await call(U.cfo, 'GET', `/transfers/${t.json.data.id}`)).json.data.items[0];
  assert.equal((await call(U.cfo, 'POST', `/transfers/${t.json.data.id}/confirm`, { rows: [{ lineId: line.id, status: 'PAID', utr: 'HDFCN52026111900099', paidOn: todayIST() }] })).status, 200);
  const paid = (await call(U.pay, 'GET', `/fnf/${id}`)).json.data; assert.equal(paid.payStatus, 'PAID'); assert.equal(paid.late, true, 'paid after 2026-11-03');
  assert.equal(r.events('pay.fnf.paid')[0].fnfId, id);
  // the statement
  const pr = await r.api.raw('GET', `${P}/fnf/${id}/print`, U.pay); assert.equal(pr.status, 200); assert.equal(pr.buffer.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await r.api.raw('GET', `${P}/fnf/${id}/print`, U.aud)).status, 403);
  const ex = await r.api.raw('GET', `${P}/fnf/export`, U.pay); assert.equal(ex.status, 200); assert.match(ex.buffer.toString('utf8'), /E1 Ravi Kumar/);
  assert.equal((await r.api.call('GET', `${P}/fnf/${id}`, { ...as('PAY', 'pay2', '2') })).status, 404, 'another company sees nothing');
});

test('AC-04 the settlement cannot be approved outside its workflow, and the posting rule set balances for a wage run and its cash payment', async () => {
  const r = await qaReady(opened, { users: Object.values(U) }); const d = r.d; const call = (who, method, path, body, k = key()) => r.api.call(method, `${P}${path}`, { ...who, headers: k, body });
  finOf(d).ensureSetup(1);
  const contractor = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, 'LC1', 'Labour Co', 'Labour Co', 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'test')").run().lastInsertRowid);
  const wr = fill(d, 'pay_wage_runs', { company_id: 1, doc_no: 'WR/1', org_project_id: r.A, org_site_id: r.site, contractor_id: contractor, cycle: 'WEEKLY', period_from: '2026-10-19', period_to: '2026-10-25', pay_due_on: '2026-10-27', workers_count: 2, gross_paise: 2000000, deductions_paise: 300000, employer_paise: 250000, net_paise: 1700000, status: 'APPROVED', summary_json: '{}' });
  const worker = (code) => fill(d, 'lab_workers', { company_id: 1, worker_code: code, name: `Worker ${code}`, contractor_id: contractor });
  for (const [w, esi] of [[worker('W1'), 7500], [worker('W2'), 0]]) fill(d, 'pay_wage_lines', { company_id: 1, run_id: wr, worker_id: w, pay_basis: 'DAILY', gross_paise: 1000000, advance_paise: 50000, canteen_paise: 20000, other_ded_paise: 0, pf_paise: 60000, esi_paise: esi, deductions_paise: 130000 + esi, employer_paise: 125000, net_paise: 870000 - esi, days_json: '[]', adjust_json: '{}', flags_json: '[]', ack_status: 'PENDING' });
  publishEvent(d, { type: 'pay.wage_run.approved', entity: 'pay_wage_runs', entityId: wr, actorId: 'hr1', companyId: 1, projectId: r.A, data: { runId: wr, docNo: 'WR/1', projectId: r.A, siteId: r.site, periodFrom: '2026-10-19', periodTo: '2026-10-25' } });
  publishEvent(d, { type: 'pay.wage_run.paid', entity: 'pay_wage_runs', entityId: wr, actorId: 'sacc', companyId: 1, projectId: r.A, data: { runId: wr, docNo: 'WR/1', projectId: r.A, siteId: r.site, mode: 'CASH', paidOn: '2026-10-27', workers: 2, net: 17325, late: false, complete: true } });
  await r.drain(); await r.drain();
  const w = journalOf(d, 'pay_wage_runs', wr); assert.ok(w, JSON.stringify(d.prepare('SELECT event_type, error_code, error FROM fin_posting_log').all())); assert.equal(w.dr, w.cr);
  assert.ok(w.lines.filter((l) => l.code === '530002').every((l) => l.project_id === r.A && l.site_id === r.site), 'site labour wages on the project and site');
  const cash = d.prepare("SELECT j.id FROM fin_journals j WHERE j.source_type = 'pay_wage_payments'").all(); assert.equal(cash.length, 1, 'the cash payment is posted once');
  assert.equal(r.events('hr.payroll.posted').find((e) => e.sourceType === 'pay_wage_runs').projectId, r.A);
  const list = (await call(U.pay, 'GET', '/posting/wage-runs')).json.data; assert.equal(list[0].posting.status, 'POSTED'); assert.equal(list[0].payments.posted, 1);
  // a settlement is approved only through its workflow: no route sets APPROVED; withdraw/cancel need their rights
  assert.equal((await call(U.cfo, 'PATCH', '/fnf/1', { version: 1 })).status, 403);
  assert.equal((await r.api.call('POST', `${P}/fnf/1/approve`, { ...U.cfo, headers: key(), body: {} })).status, 404);
});
