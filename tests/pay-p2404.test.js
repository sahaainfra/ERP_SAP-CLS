import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ready, as, fill, key, U as QU } from './qa-helpers.js';
import { dueOf, ecrProblems, ecrRecord, pickRule, quarterOf } from '../src/server/modules/pay/statutory.js';
import { createVault } from '../src/server/platform/integrations/vault.js';

// Part 24.04: statutory compliance.
//  T-01 the ECR file passes the format check and its PF totals equal the payroll's; due dates come from the dated rules (March TDS, quarters, Form 16 and 130).
//  and: the filing chain PAY → ACCMGR → CFO, the challan and a late payment; a rule not yet confirmed blocks its payment; BOCW cess at the rate; bonus eligibility
//  and ceiling; gratuity at five years and the cap; the registers and the rights.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const U = { ...QU, pay: as('PAY', 'pay1'), acc: as('ACCMGR', 'acc1'), cfo: as('CFO', 'cfo1'), hr: as('HRMGR', 'hr1'), aud: as('AUD', 'aud1'), se: as('SE', 'se1') };
const P = '/api/v1/pay';

test('T-01 the due dates come from the dated rules: ECR on the 15th of the next month; TDS on the 7th, March on 30 April; quarterly statements; Form 16 and Form 130', () => {
  const r = (type, state, date, rules) => pickRule(rules, type, state, date);
  const rules = [
    { rule_type: 'ECR', state_code: 'ALL', effective_from: '2014-09-01', params_json: '{"offset":1,"day":15}', rule_status: 'APPROVED' },
    { rule_type: 'TDS_MONTHLY', state_code: 'ALL', effective_from: '2025-04-01', params_json: '{"offset":1,"day":7}', rule_status: 'APPROVED' },
    { rule_type: 'TDS_MONTHLY_MAR', state_code: 'ALL', effective_from: '2025-04-01', params_json: '{"offset":1,"day":30}', rule_status: 'APPROVED' },
    { rule_type: 'FORM16', state_code: 'ALL', effective_from: '2025-04-01', params_json: '{"dueMonth":6,"dueDay":15,"yearShift":1,"form":"16"}', rule_status: 'APPROVED' },
    { rule_type: 'FORM16', state_code: 'ALL', effective_from: '2026-04-01', params_json: '{"dueMonth":6,"dueDay":15,"yearShift":1,"form":"130"}', rule_status: 'TO_CONFIRM' },
    { rule_type: 'PT', state_code: 'ALL', effective_from: '2014-06-02', params_json: '{"offset":1,"day":15}', rule_status: 'TO_CONFIRM' },
    { rule_type: 'PT', state_code: 'TS', effective_from: '2014-06-02', params_json: '{"offset":1,"day":10}', rule_status: 'APPROVED' },
  ].map((x) => ({ ...x, state_code: x.state_code, deleted_at: null, effective_to: null }));
  assert.equal(dueOf('MONTHLY', '2026-10', JSON.parse(r('ECR', 'ALL', '2026-10-01', rules).params_json)), '2026-11-15');
  assert.equal(dueOf('MONTHLY', '2026-03', JSON.parse(r('TDS_MONTHLY', 'ALL', '2026-03-01', rules).params_json)), '2026-04-07');
  assert.equal(dueOf('MONTHLY', '2026-03', JSON.parse(r('TDS_MONTHLY_MAR', 'ALL', '2026-03-01', rules).params_json)), '2026-04-30', 'March tax by 30 April');
  assert.equal(dueOf('MONTHLY', '2026-01', { offset: 1, day: 31 }), '2026-02-28', 'the day is held to the month end');
  const q1 = quarterOf('Q1 2025-26'); assert.deepEqual(q1.months, ['2025-04', '2025-05', '2025-06']);
  assert.equal(dueOf('QUARTER', 'Q1 2025-26', { dueMonth: 7, dueDay: 31, yearShift: 0 }), '2025-07-31');
  assert.equal(dueOf('QUARTER', 'Q3 2025-26', { dueMonth: 1, dueDay: 31, yearShift: 1 }), '2026-01-31');
  assert.equal(dueOf('QUARTER', 'Q4 2025-26', { dueMonth: 5, dueDay: 15, yearShift: 1 }), '2026-05-15');
  assert.equal(dueOf('FY', '2025-26', JSON.parse(r('FORM16', 'ALL', '2025-04-01', rules).params_json)), '2026-06-15', 'Form 16 for 2025-26');
  assert.equal(dueOf('FY', '2026-27', JSON.parse(r('FORM16', 'ALL', '2026-04-01', rules).params_json)), '2027-06-15', 'Form 130 for 2026-27');
  assert.equal(r('FORM16', 'ALL', '2026-04-01', rules).rule_status, 'TO_CONFIRM', 'Form 130 is not confirmed yet');
  assert.equal(r('PT', 'TS', '2026-10-01', rules).rule_status, 'APPROVED', 'a state rule is preferred over the default');
  assert.equal(r('PT', 'MH', '2026-10-01', rules).rule_status, 'TO_CONFIRM', 'a state without a rule uses the default, to be confirmed');
  assert.equal(r('ECR', 'ALL', '2010-01-01', rules), null, 'no rule before its effective date');
});

test('T-01 the ECR record: eleven fields, a twelve-digit UAN, whole rupees; a bad record is refused', () => {
  const rec = ecrRecord({ uan: '100200300400', name: 'Ravi Kumar', gross: 25000, epfWage: 15000, epsWage: 15000, edliWage: 15000, eeShare: 1800, epsShare: 1250, erDiff: 551, ncpDays: 2 });
  assert.equal(rec, '100200300400#RAVI KUMAR#25000#15000#15000#15000#1800#1250#551#2#0');
  assert.deepEqual(ecrProblems(rec), []);
  assert.match(ecrProblems(ecrRecord({ uan: '1002', name: 'A#B', gross: 1, epfWage: 1, epsWage: 1, edliWage: 1, eeShare: 1, epsShare: 1, erDiff: 1.5, ncpDays: 0 })).join(';'), /UAN must be 12 digits.*whole number/);
  assert.equal(ecrRecord({ uan: '1', name: 'A#B', gross: 1, epfWage: 1, epsWage: 1, edliWage: 1, eeShare: 1, epsShare: 1, erDiff: 1, ncpDays: 0 }).split('#').length, 11, 'a # in a name cannot split the record');
});

// The locked payroll of October 2026 for two employees: the contributions as the 24.01/24.02 engine writes them (components in rupees, bases in wages_json).
function payroll(d, companyId) {
  const e1 = fill(d, 'hr_employees', { company_id: companyId, emp_code: 'P1', first_name: 'Ravi', full_name: 'Ravi Kumar', gender: 'MALE', dob: '1990-01-01', mobile: '9000000001', employment_type: 'PERMANENT', doj: '2020-01-01', record_status: 'APPROVED', employment_status: 'ACTIVE' });
  const e2 = fill(d, 'hr_employees', { company_id: companyId, emp_code: 'P2', first_name: 'Sita', full_name: 'Sita Devi', gender: 'FEMALE', dob: '1992-01-01', mobile: '9000000002', employment_type: 'PERMANENT', doj: '2021-04-01', record_status: 'APPROVED', employment_status: 'ACTIVE' });
  fill(d, 'hr_employee_statutory', { company_id: companyId, employee_id: e1, pf_applicable: 1, esi_applicable: 0, pt_state: 'TS', lwf_state: 'TS', uan: '100200300400', pan_last4: '1234' });
  fill(d, 'hr_employee_statutory', { company_id: companyId, employee_id: e2, pf_applicable: 1, esi_applicable: 1, pt_state: 'TS', uan: '100200300401', esic_ip: '3100200301', pan_last4: '5678' });
  // D-749: Ravi's PAN is kept encrypted by HR (the vault slot of the employee's PAN); Sita's is not on file
  d.prepare('UPDATE hr_employee_statutory SET pan_enc = ? WHERE employee_id = ?').run(createVault().encrypt('ABCDE1234F', `hr_employee_pan/${companyId}/${e1}`), e1);
  const run = fill(d, 'pay_runs', { company_id: companyId, period: '2026-10', run_type: 'REGULAR', status: 'APPROVED', employees_count: 2, gross_paise: 4500000, net_paise: 3800000, tds_paise: 150000, locked_at: '2026-11-02T00:00:00Z' });
  const comps1 = [{ code: 'BASIC', name: 'Basic', type: 'EARNING', amount: 20000 }, { code: 'PF_EE', name: 'PF', type: 'DEDUCTION', amount: 1800 }, { code: 'PF_ER', name: 'EPF', type: 'EMPLOYER', amount: 551 }, { code: 'EPS_ER', name: 'EPS', type: 'EMPLOYER', amount: 1250 }, { code: 'EDLI_ER', name: 'EDLI', type: 'EMPLOYER', amount: 75 }, { code: 'PF_ADMIN', name: 'Admin', type: 'EMPLOYER', amount: 75 }, { code: 'PT', name: 'PT', type: 'DEDUCTION', amount: 200 }, { code: 'GRATUITY', name: 'Gratuity', type: 'EMPLOYER', amount: 800 }];
  const comps2 = [{ code: 'BASIC', name: 'Basic', type: 'EARNING', amount: 25000 }, { code: 'PF_EE', name: 'PF', type: 'DEDUCTION', amount: 1800 }, { code: 'PF_ER', name: 'EPF', type: 'EMPLOYER', amount: 551 }, { code: 'EPS_ER', name: 'EPS', type: 'EMPLOYER', amount: 1250 }, { code: 'EDLI_ER', name: 'EDLI', type: 'EMPLOYER', amount: 75 }, { code: 'PF_ADMIN', name: 'Admin', type: 'EMPLOYER', amount: 75 }, { code: 'ESI_EE', name: 'ESI', type: 'DEDUCTION', amount: 188 }, { code: 'ESI_ER', name: 'ESI', type: 'EMPLOYER', amount: 813 }, { code: 'PT', name: 'PT', type: 'DEDUCTION', amount: 200 }];
  fill(d, 'pay_run_lines', { company_id: companyId, run_id: run, employee_id: e1, days_in_month: 31, payable_days: 31, paid_days: 31, lop_days: 0, components_json: JSON.stringify(comps1), gross_paise: 2000000, deductions_paise: 200000, employer_paise: 250000, net_paise: 1800000, tds_paise: 90000, tds_json: JSON.stringify({ regime: 'NEW' }), wages_json: JSON.stringify({ pfBase: 20000, pfWage: 15000, esiWage: 20000 }) });
  fill(d, 'pay_run_lines', { company_id: companyId, run_id: run, employee_id: e2, days_in_month: 31, payable_days: 29, paid_days: 29, lop_days: 2, components_json: JSON.stringify(comps2), gross_paise: 2500000, deductions_paise: 219800, employer_paise: 226300, net_paise: 2000000, tds_paise: 60000, tds_json: JSON.stringify({ regime: 'OLD' }), wages_json: JSON.stringify({ pfBase: 25000, pfWage: 15000, esiWage: 25000 }) });
  return { run, e1, e2 };
}

test('AC-01 the statutory chain on a locked payroll: the ECR file tied to the payroll, a filing approved PAY → ACCMGR → CFO, the challan, a late payment flagged, duplicates refused, the rights', async () => {
  const r = await ready(opened, { users: Object.values(U) }); const d = r.d; const call = (who, method, path, body, k = key()) => r.api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const pay = payroll(d, 1);
  // the ECR file: the record layout is checked and the totals tie to the locked payroll
  const reg = await call(U.pay, 'POST', '/stat/registers', { registerType: 'ECR_FILE', period: '2026-10' }); assert.equal(reg.status, 201, JSON.stringify(reg.json));
  assert.equal(reg.json.data.rows, 2);
  const file = await r.api.raw('GET', `${P}/stat/registers/${reg.json.data.id}/download`, U.aud); assert.equal(file.status, 403, 'the auditor does not export');
  const dl = await r.api.raw('GET', `${P}/stat/registers/${reg.json.data.id}/download`, U.pay); assert.equal(dl.status, 200); const lines = dl.buffer.toString('utf8').trim().split(/\r?\n/);
  assert.equal(lines.length, 2); for (const l of lines) assert.equal(l.split('#').length, 11);
  const eeFile = lines.reduce((a, l) => a + Number(l.split('#')[6]), 0); const eePayroll = d.prepare("SELECT components_json FROM pay_run_lines WHERE run_id = ?").all(pay.run).reduce((a, x) => a + JSON.parse(x.components_json).find((c) => c.code === 'PF_EE').amount, 0);
  assert.equal(eeFile, eePayroll, 'the EPF employee share of the file equals the payroll');
  assert.equal(lines[1].split('#')[9], '2', 'two days without pay are non-contributing days');
  // the ESI file: only Sita is in ESI, with her IP number
  const esi = await call(U.pay, 'POST', '/stat/registers', { registerType: 'ESI_FILE', period: '2026-10' }); assert.equal(esi.status, 201); assert.equal(esi.json.data.rows, 1);
  // a filing: prepared by payroll; the amount is the remittance of the file
  const f = await call(U.pay, 'POST', '/stat/filings', { type: 'ECR', period: '2026-10' }); assert.equal(f.status, 201, JSON.stringify(f.json)); const fid = f.json.data.id;
  assert.equal(f.json.data.dueDate, '2026-11-15'); assert.equal(f.json.data.amount, 7502, 'the remittance: EPF 3,600, EPS 2,500, the ER difference 1,102, EDLI 150, admin 150');
  assert.equal((await call(U.pay, 'POST', '/stat/filings', { type: 'ECR', period: '2026-10' })).status, 409, 'one ECR a month');
  assert.equal((await call(U.pay, 'POST', '/stat/filings', { type: 'PT', period: '2026-10', state: 'MH' })).status, 422, 'no PT rule for MH: the default is to be confirmed');
  assert.equal((await call(U.aud, 'POST', '/stat/filings', { type: 'ECR', period: '2026-10' })).status, 403);
  assert.equal((await call(U.pay, 'POST', `/stat/filings/${fid}/submit`)).status, 202);
  assert.equal((await call(U.cfo, 'POST', `/stat/filings/${fid}/submit`)).status, 403, 'only the maker sends it'); const inst = r.wf('stat_filings', fid);
  const row = (await call(U.pay, 'GET', `/stat/filings/${fid}`)).json.data; assert.equal(row.status, 'SUBMITTED'); assert.equal(row.can.approve, false);
  assert.equal((await r.tasksOf(U.pay)).filter((t) => t.instance.id === inst).length, 0, 'the preparer has no approval task');
  assert.equal((await r.act(U.acc, inst)).status, 200); assert.equal((await r.act(U.cfo, inst)).status, 200);
  const done = (await call(U.pay, 'GET', `/stat/filings/${fid}`)).json.data; assert.equal(done.status, 'APPROVED');
  assert.equal(r.events('pay.statutory.filing_approved').length, 1, 'the payment request is released');
  // the challan: a payment after the due date is late
  assert.equal((await call(U.pay, 'POST', `/stat/filings/${fid}/challan`, { challanRef: 'CH-2026-11-001', challanDate: '2026-11-16', paidOn: '2026-11-16' })).status, 200, 'paid after the due date');
  const paid = (await call(U.pay, 'GET', `/stat/filings/${fid}`)).json.data; assert.equal(paid.late, true); assert.equal(paid.challanRef, 'CH-2026-11-001');
  assert.equal(r.events('pay.statutory.paid')[0].late, true);
  // the calendar shows the year's items: ECR of October paid, the Form 130 batch and the quarterly statements with their dates
  const cal = (await call(U.pay, 'GET', '/stat/calendar?fy=2026-27')).json.data; const ecr = cal.items.find((x) => x.type === 'ECR' && x.period === '2026-10');
  assert.equal(ecr.column, 'PAID'); assert.equal(cal.items.find((x) => x.type === 'FORM16').dueDate, '2027-06-15'); assert.equal(cal.items.find((x) => x.type === 'TDS_24Q' && x.period === 'Q3 2026-27').dueDate, '2027-01-31');
  // the TDS statement and the Form 16 / 130 batch
  const q = await call(U.pay, 'POST', '/stat/registers', { registerType: 'TDS_24Q_FILE', quarter: 'Q3 2026-27' }); assert.equal(q.status, 201); assert.equal(q.json.data.rows, 2);
  assert.deepEqual(q.json.data.panMissing, ['P2'], 'D-749: the employee without a PAN on file is named');
  const qf = (await r.api.raw('GET', `${P}/stat/registers/${q.json.data.id}/download`, U.pay)).buffer.toString('utf8'); assert.match(qf, /P1,Ravi Kumar,ABCDE1234F,/, 'D-749: the full PAN from the vault'); assert.doesNotMatch(qf, /P2,Sita Devi,[A-Z]{5}/);
  assert.match(d.prepare("SELECT reason FROM core_audit_log WHERE entity = 'stat_registers' AND action = 'generate' ORDER BY id DESC LIMIT 1").get().reason ?? '', /PAN read from the vault for 1/);
  const f130 = await r.api.raw('GET', `${P}/stat/form16/pdf?fy=2026-27`, U.hr); assert.equal(f130.status, 200);
  assert.equal((await call(U.hr, 'POST', '/stat/registers', { registerType: 'FORM16_BATCH', fy: '2026-27' })).status, 201, 'HR generates the batch');
  const list = (await call(U.aud, 'GET', '/stat/registers')).json.data; assert.ok(list.length >= 3); assert.equal(list[0].amount, null, 'the auditor sees no amounts');
});

test('AC-02 BOCW cess at the rate of the month, the filing and the challan; a rule of the cess not confirmed; the bonus and gratuity computations; the rules', async () => {
  const r = await ready(opened, { users: Object.values(U) }); const d = r.d; const call = (who, method, path, body, k = key()) => r.api.call(method, `${P}${path}`, { ...who, headers: k, body });
  payroll(d, 1); const proj = fill(d, 'org_projects', { company_id: 1, code: 'BP1', name: 'Tower', type: 'BUILDING', status: 'ACTIVE' });
  // BOCW: 1 % of the construction cost of the month; the cess is a rule (to be confirmed) and is not filed before it is
  const b = await call(U.pay, 'POST', '/stat/bocw', { projectId: proj, period: '2026-10', constructionCost: 2500000, source: 'Certified bills of the month (23.05)' }); assert.equal(b.status, 201, JSON.stringify(b.json)); assert.equal(b.json.data.cess, 25000);
  assert.equal((await call(U.pay, 'POST', '/stat/bocw', { projectId: proj, period: '2026-10', constructionCost: 1, source: 'x' })).status, 400, 'a source is needed');
  const fb = await call(U.pay, 'POST', '/stat/filings', { type: 'BOCW', period: '2026-10' }); assert.equal(fb.status, 422, 'the BOCW rule is to be confirmed before a payment');
  // the bonus: eligible when every month is within 21,000; the calculation base is capped at 7,000 a month; the rate between 8.33 and 20
  assert.equal((await call(U.pay, 'GET', '/stat/bonus?fy=2026-27&pct=5')).status, 400, 'below the minimum rate');
  const bo = (await call(U.pay, 'GET', '/stat/bonus?fy=2026-27&pct=8.33')).json.data; assert.equal(bo.parameters.calculationCeiling, 7000); assert.equal(bo.rows.length, 2);
  const e1 = bo.rows.find((x) => x.employee.startsWith('P1')); const e2 = bo.rows.find((x) => x.employee.startsWith('P2'));
  assert.equal(e1.eligible, true); assert.equal(e1.bonusBase, 7000, 'capped at 7,000'); assert.equal(e1.bonus, 583.1, '8.33 % of 7,000');
  assert.equal(e2.eligible, false, 'wages above 21,000: not eligible');
  // gratuity: 15 / 26 of the last wages for each completed year, from five years; the cap of the rule
  const g = (await call(U.pay, 'GET', `/stat/gratuity?employeeId=${pay(d).e1}&leavingDate=2026-12-31`)).json.data; assert.equal(g.completedYears, 6);
  assert.equal(g.eligible, true); assert.equal(g.capPaise, 200000000); assert.equal(g.amount, 69230.77, 'by hand: 20,000 × 15 × 6 / 26 (the basic of the last month)');
  const g2 = (await call(U.pay, 'GET', `/stat/gratuity?employeeId=${pay(d).e2}&leavingDate=2025-12-31`)).json.data; assert.equal(g2.eligible, false, 'four completed years: not yet five');
  assert.equal((await call(U.pay, 'GET', `/stat/gratuity?employeeId=${pay(d).e2}&leavingDate=2026-12-31`)).json.data.eligible, true, 'five completed years');
  assert.equal((await call(U.pay, 'GET', `/stat/gratuity?employeeId=${pay(d).e1}&leavingDate=2019-01-01`)).status, 400, 'a leaving date before joining is refused');
  const prov = (await call(U.pay, 'GET', '/stat/gratuity-provision?fy=2026-27')).json.data; assert.equal(prov.totals.provision, 800);
  // the rules: a new one is kept with its legal reference; the auditor cannot change them
  assert.equal((await call(U.cfo, 'POST', '/stat/rules', { type: 'PT', state: 'TS', params: { offset: 1, day: 10 }, effectiveFrom: '2026-04-01', legalRef: 'Telangana Professional Tax Act 1987, Schedule: due date confirmed' })).status, 201);
  assert.equal((await call(U.cfo, 'POST', '/stat/rules', { type: 'PT', state: 'TS', params: { offset: 1, day: 10 }, effectiveFrom: '2026-04-01', legalRef: 'short' })).status, 400, 'a legal reference is needed');
  assert.equal((await call(U.pay, 'POST', '/stat/rules', { type: 'PT', state: 'TS', params: { offset: 1, day: 10 }, effectiveFrom: '2026-04-01', legalRef: 'Telangana Professional Tax Act 1987, Schedule: due date confirmed' })).status, 403, 'payroll does not configure the rules');
  assert.equal((await call(U.aud, 'GET', '/stat/rules')).status, 200, 'the auditor reads the rules');
});

// The helper of the payroll fixture reads the employee's id by code.
function pay(d) { return { e1: d.prepare("SELECT id FROM hr_employees WHERE emp_code = 'P1'").get().id, e2: d.prepare("SELECT id FROM hr_employees WHERE emp_code = 'P2'").get().id }; }
