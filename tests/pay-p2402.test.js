import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ready as qaReady, as, fill, key, U as QU } from './qa-helpers.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { annualTax } from '../src/server/modules/pay/engine.js';
import { fyOf, tdsOfMonth } from '../src/server/modules/pay/runs.js';

// Part 24.02: monthly staff payroll.
//  T-01 gross to net for sample employees equals the hand calculation; LOP pro-rates the month.
//  and: only locked attendance (BR-01); overtime, arrears, advances, loss recoveries and inputs; TDS over the year; checks (negative net blocks; hold); PAY →
//  HRMGR → CFO and the lock (inputs applied, arrears paid, the period locked); the register and the variance; tax declarations; rights.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const U = { ...QU, pay: as('PAY', 'pay1'), hr: as('HRMGR', 'hr1'), cfo: as('CFO', 'cfo1'), aud: as('AUD', 'aud1'), se: as('SE', 'se9'), emp: as('EMP', 'ravi') };
const P = '/api/v1/pay';
const r2 = (v) => Math.round(v * 100) / 100;

test('T-01 the TDS of a month spreads the tax of the projected year over the months left', () => {
  const p = { regime: 'NEW', standardDeduction: 75000, slabs: [{ upTo: 400000, rate: 0 }, { upTo: 800000, rate: 5 }, { upTo: 1200000, rate: 10 }, { upTo: 1600000, rate: 15 }, { upTo: 2000000, rate: 20 }, { upTo: 2400000, rate: 25 }, { upTo: null, rate: 30 }], rebateIncomeUpTo: 1200000, rebateMax: 60000, cess: 4 };
  assert.equal(annualTax(p, 1200000).total, 0, 'within the rebate'); assert.equal(fyOf('2026-10').left, 6); assert.equal(fyOf('2027-02').code, '2026-27');
  const t = tdsOfMonth({ params: p, ytdTaxable: 900000, monthTaxable: 150000, futureMonthly: 150000, monthsLeft: 6, ytdTds: 60000 }); assert.equal(t.projectedAnnual, 1800000); assert.equal(t.total, annualTax(p, 1800000).total); assert.equal(t.month, Math.round((t.total - 60000) / 6));
});

test('AC-01 payroll from locked inputs: computed, checked, approved PAY → HRMGR → CFO and locked; T-01 gross to net and LOP', async () => {
  const r = await qaReady(opened, { users: Object.values(U) }); const d = r.d; const call = (who, method, path, body, k = key()) => r.api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const emp = (code, user = null) => { const uid = user ? d.prepare('SELECT id FROM iam_users WHERE username = ?').get(user).id : null; const id = fill(d, 'hr_employees', { company_id: 1, emp_code: code, first_name: code, full_name: `Employee ${code}`, gender: 'MALE', dob: '1990-01-01', mobile: '9000000000', employment_type: 'PERMANENT', doj: '2025-01-01', record_status: 'APPROVED', employment_status: 'ACTIVE', salary_payment_mode: 'BANK_TRANSFER', user_id: uid }); fill(d, 'hr_employee_statutory', { company_id: 1, employee_id: id, pf_applicable: 1, esi_applicable: 0, pt_state: 'TS' }); return id; };
  const e1 = emp('E1', 'ravi'); const e2 = emp('E2'); const e3 = emp('E3'); fill(d, 'hr_employee_banks', { company_id: 1, employee_id: e1, account_last4: '1234', ifsc: 'HDFC0000001', bank_status: 'ACTIVE', verified_status: 'VERIFIED', is_primary: 1 });
  // the set-up of 24.01: a structure, assignments approved, the calendar
  const sid = (await call(U.pay, 'POST', '/structures', { code: 'STAFF', name: 'Staff', components: ['BASIC', 'HRA', 'CONVEYANCE', 'SPECIAL', 'PF_EE', 'PT', 'TDS', 'RECOVERY', 'INCENTIVE', 'OVERTIME', 'ARREARS', 'ADVANCE', 'PF_ER', 'EPS_ER', 'EDLI_ER', 'PF_ADMIN', 'GRATUITY'].map((code) => ({ code, ...(code === 'CONVEYANCE' ? { value: 1600 } : {}) })) })).json.data.id;
  const approveAsg = async (b) => { const a = await call(U.pay, 'POST', '/assignments', b); assert.equal(a.status, 201, JSON.stringify(a.json)); await call(U.pay, 'POST', `/assignments/${a.json.data.id}/submit`); const i = r.wf('pay_assignments', a.json.data.id); await r.act(U.hr, i); await r.act(U.cfo, i); return (await call(U.pay, 'GET', `/assignments/${a.json.data.id}`)).json.data; };
  await approveAsg({ employeeId: e1, structureId: sid, ctcAnnual: 600000, effectiveFrom: '2026-04-01', reason: 'Joining' });
  const rev = await approveAsg({ employeeId: e1, structureId: sid, ctcAnnual: 660000, effectiveFrom: '2026-09-01', reason: 'Increment' }); assert.ok(rev.arrearLines.some((a) => a.month === '2026-09'));
  await approveAsg({ employeeId: e2, structureId: sid, ctcAnnual: 480000, effectiveFrom: '2026-04-01', reason: 'Joining' }); await approveAsg({ employeeId: e3, structureId: sid, ctcAnnual: 360000, effectiveFrom: '2026-04-01', reason: 'Joining' });
  assert.equal((await call(U.pay, 'POST', '/calendar/generate', { fyStart: '2026-04-01' })).status, 200);
  // attendance of October: E1 two days LOP and 2 hours of overtime, locked; E2 not locked; E3 locked
  const att = (id, locked, lopDays = [], otDay = null) => { for (let k = 1; k <= 31; k += 1) { const date = `2026-10-${String(k).padStart(2, '0')}`; const lop = lopDays.includes(k) ? 1 : 0; fill(d, 'att_daily', { company_id: 1, person_type: 'EMPLOYEE', person_id: id, work_date: date, status: lop ? 'ABSENT' : 'PRESENT', paid_day: 1 - lop, lop_day: lop, ot_paid_minutes: k === otDay ? 120 : 0, locked: locked ? 1 : 0, computed_at: '2026-11-01T00:00:00Z', source: 'SYSTEM' }); } };
  att(e1, true, [6, 7], 10); att(e2, false); att(e3, true);
  // inputs: a loss recovery from its event (16.09), an incentive by payroll, a large recovery that makes E3's net negative
  publishEvent(d, { type: 'inv.asset.recovery_approved', entity: 'ast_loss_reports', entityId: 77, actorId: 'stores', companyId: 1, data: { lossId: 77, docNo: 'LOSS/77', recoveryFrom: 'SALARY', employeeId: e1, amount: 1500, tag: 'DRILL-9' } }); await r.drain();
  assert.equal((await call(U.hr, 'POST', '/inputs', { employeeId: e1, period: '2026-10', code: 'INCENTIVE', amount: 5000, note: 'Site target bonus' })).status, 403);
  assert.equal((await call(U.pay, 'POST', '/inputs', { employeeId: e1, period: '2026-10', code: 'INCENTIVE', amount: 5000, note: 'Site target bonus' })).status, 201);
  assert.equal((await call(U.pay, 'POST', '/inputs', { employeeId: e3, period: '2026-10', code: 'RECOVERY', amount: 40000, note: 'Damaged equipment' })).status, 201);
  const rd = (await call(U.pay, 'GET', '/runs/readiness?period=2026-10')).json.data; assert.deepEqual([rd.attendance.locked, rd.attendance.open, rd.inputs], [2, 1, 3]);
  // the run
  const c = await call(U.pay, 'POST', '/runs', { period: '2026-10' }); assert.equal(c.status, 201, JSON.stringify(c.json)); let run = c.json.data;
  assert.equal((await call(U.pay, 'POST', '/runs', { period: '2026-10' })).status, 409, 'one regular run a period');
  assert.equal(run.employees, 2); assert.deepEqual(run.inputs.excluded.map((x) => [x.employeeId, x.reason]), [[e2, 'ATTENDANCE_NOT_LOCKED']], 'BR-01: only locked attendance');
  const L1 = run.lines.find((l) => l.employeeId === e1); const amt = (l, code) => l.components.find((x) => x.code === code)?.amount ?? 0; const full = (l, code) => l.components.find((x) => x.code === code)?.full ?? 0;
  // T-01: by hand — 29 of 31 days; every prorated earning × 29/31; PF 12 % of the 15,000 ceiling; PT 200; overtime 2 h at twice wages ÷ 208; September's arrear
  assert.deepEqual([L1.daysInMonth, L1.payableDays, L1.lopDays, L1.otHours], [31, 29, 2, 2]);
  for (const code of ['BASIC', 'HRA', 'CONVEYANCE', 'SPECIAL']) assert.equal(amt(L1, code), r2(full(L1, code) * Math.round((29 / 31) * 10000) / 10000), `${code} prorated`);
  assert.equal(amt(L1, 'PF_EE'), 1800); assert.equal(amt(L1, 'PT'), 200); assert.equal(amt(L1, 'RECOVERY'), 1500); assert.equal(amt(L1, 'INCENTIVE'), 5000);
  assert.equal(amt(L1, 'OVERTIME'), r2((L1.wages.codeWages ? (full(L1, 'BASIC') + full(L1, 'SPECIAL')) : 0) / 208 * 2 * 2), 'overtime at twice the hourly wages');
  const sep = rev.arrearLines.filter((a) => a.month === '2026-09').reduce((x, a) => x + a.amount, 0); assert.equal(amt(L1, 'ARREARS'), r2(sep), "September's arrear; October is paid at the new rate");
  const gross = r2(L1.components.filter((x) => x.type === 'EARNING').reduce((x, y) => x + y.amount, 0)); assert.equal(L1.gross, gross); assert.equal(L1.net, r2(gross - L1.deductions)); assert.equal(L1.tds, 0, 'within the rebate of the new regime');
  const L3 = run.lines.find((l) => l.employeeId === e3); assert.ok(L3.net < 0); assert.ok(L3.flags.some((f) => f.code === 'NEGATIVE_NET')); assert.ok(L3.flags.some((f) => f.code === 'NO_BANK'));
  // FR-03/FR-05: a blocking check stops the submission until the salary is held
  assert.equal((await call(U.pay, 'POST', `/runs/${run.id}/submit`)).status, 422);
  assert.equal((await call(U.pay, 'POST', `/runs/${run.id}/lines/${L3.id}/hold`, { hold: true })).status, 400, 'say why');
  run = (await call(U.pay, 'POST', `/runs/${run.id}/lines/${L3.id}/hold`, { hold: true, reason: 'Recovery under review' })).json.data; assert.equal(run.held, 1); assert.equal(run.net, L1.net, 'a held salary is not in the net payable');
  run = (await call(U.pay, 'POST', `/runs/${run.id}/compute`)).json.data; assert.equal(run.held, 1, 'the hold survives a recomputation');
  // PAY → HRMGR → CFO; the lock
  assert.equal((await call(U.pay, 'POST', `/runs/${run.id}/submit`)).status, 202); const inst = r.wf('pay_runs', run.id);
  assert.equal((await call(U.pay, 'GET', `/runs/${run.id}`)).json.data.can.approve, false, 'the preparer does not approve');
  assert.equal((await r.act(U.hr, inst)).status, 200); assert.equal((await r.act(U.cfo, inst)).status, 200);
  run = (await call(U.pay, 'GET', `/runs/${run.id}`)).json.data; assert.equal(run.status, 'APPROVED'); assert.ok(run.lockedAt);
  assert.equal(d.prepare("SELECT cal_status FROM pay_calendar WHERE company_id = 1 AND period = '2026-10'").get().cal_status, 'LOCKED');
  assert.deepEqual(d.prepare("SELECT arrear_month, arrear_status FROM pay_arrears WHERE employee_id = ? GROUP BY arrear_month ORDER BY arrear_month").all(e1).map((x) => [x.arrear_month, x.arrear_status]), [['2026-09', 'PAID'], ['2026-10', 'CANCELLED']]);
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM pay_inputs WHERE input_status = 'APPLIED'").get().n, 3); assert.equal(r.events('pay.run.approved').at(-1).employees, 2);
  assert.equal((await call(U.pay, 'POST', `/runs/${run.id}/compute`)).status, 409, 'locked: corrections go in a supplementary run');
  // the register, the variance, the cost allocation
  const v = (await call(U.pay, 'GET', `/runs/${run.id}/variance`)).json.data; assert.equal(v.previous, null); assert.equal(v.joined, 2);
  assert.equal((await call(U.pay, 'GET', `/runs/${run.id}/export`)).status, 200); assert.equal((await call(U.aud, 'GET', `/runs/${run.id}`)).json.data.net, null, 'masked for the auditor');
  // tax declarations: the employee declares, payroll verifies
  const dm = await call(U.emp, 'POST', '/declarations/mine', { fy: '2026-27', regime: 'OLD', declarations: { sec80C: 120000, sec80D: 25000 }, submit: true }); assert.equal(dm.status, 200, JSON.stringify(dm.json)); assert.equal(dm.json.data.declaration.status, 'SUBMITTED');
  const list = (await call(U.pay, 'GET', '/declarations?fy=2026-27')).json.data; assert.equal(list[0].regime, 'OLD');
  assert.equal((await call(U.hr, 'POST', `/declarations/${list[0].id}/verify`, { action: 'verify' })).status, 403);
  assert.equal((await call(U.pay, 'POST', `/declarations/${list[0].id}/verify`, { action: 'verify', verified: { sec80C: 100000, sec80D: 25000 } })).json.data.status, 'VERIFIED');
  // rights and isolation
  assert.equal((await call(U.se, 'GET', '/runs')).status, 403); assert.equal((await call(U.hr, 'POST', '/runs', { period: '2026-11' })).status, 403);
  assert.equal((await call(as('PAY', 'pay9', '2'), 'GET', `/runs/${run.id}`)).status, 404);
});
