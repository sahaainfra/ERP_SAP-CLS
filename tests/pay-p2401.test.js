import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ready as qaReady, as, fill, key, U as QU } from './qa-helpers.js';
import { computeBreakup, monthFactor } from '../src/server/modules/pay/engine.js';
import { todayIST } from '../src/shared/dates.js';

// Part 24.01: payroll set-up.
//  T-01 the PF wage ceiling (12 % of min(wages, 15,000)); the Code-on-Wages add-back; arrears of a retro-dated revision.
//  and: components and the formula builder; structures with the CTC breakup; statutory parameters by date and state (PAY -> CFO); the payroll calendar; pay
//  assignments (HRMGR -> CFO, the director for a senior grade) setting the employee's monthly pay; salaries masked for the auditor; rights.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const U = { ...QU, pay: as('PAY', 'pay1'), hr: as('HRMGR', 'hr1'), cfo: as('CFO', 'cfo1'), dir: as('DIR', 'dir1'), aud: as('AUD', 'aud1'), se: as('SE', 'se9') };
const P = '/api/v1/pay';
const C = (code, t, m, x = {}) => ({ code, name: code, comp_type: t, calc_method: m, sequence: x.seq ?? 100, wage_class: x.wc ?? 'WAGES', pf_applicable: 0, esi_applicable: 0, pt_applicable: 1, taxable: 1, prorate: 1, formula: x.f, percent_bp: x.p, base_codes: x.b, statutory_code: x.s });
const PF = { employeeRate: 12, epsRate: 8.33, edliRate: 0.5, adminRate: 0.5, wageCeiling: 15000, epsCeiling: 15000, edliCeiling: 15000, restrictToCeiling: true };

test('T-01 PF on min(wages, ceiling); wages under the Code add back the excess of the exclusions; the first month of a revision by its days', () => {
  const comps = [C('BASIC', 'EARNING', 'FIXED', { seq: 10 }), C('HRA', 'EARNING', 'FIXED', { seq: 20, wc: 'EXCLUDED' }), C('PF_EE', 'DEDUCTION', 'STATUTORY', { s: 'PF_EE', seq: 210 }), C('PF_ER', 'EMPLOYER', 'STATUTORY', { s: 'PF_ER', seq: 310 }), C('EPS_ER', 'EMPLOYER', 'STATUTORY', { s: 'EPS_ER', seq: 320 })];
  const pf = (basic, hra, wageRule = true) => computeBreakup({ components: comps, values: { BASIC: basic, HRA: hra }, params: { PF }, employee: { pf: true }, month: '2026-10', wageRule });
  let b = pf(30000, 12000); assert.equal(b.lines.find((l) => l.code === 'PF_EE').amount, 1800, '12 % of the 15,000 ceiling'); assert.equal(b.lines.find((l) => l.code === 'EPS_ER').amount, 1250); assert.equal(b.lines.find((l) => l.code === 'PF_ER').amount, 550);
  b = pf(10000, 2000); assert.equal(b.lines.find((l) => l.code === 'PF_EE').amount, 1200, 'below the ceiling: 12 % of the wages');
  b = pf(5000, 15000); assert.equal(b.wages.addedBack, 5000, 'exclusions 15,000 of 20,000: the excess over half (10,000) is wages'); assert.equal(b.wages.codeWages, 10000); assert.equal(b.lines.find((l) => l.code === 'PF_EE').amount, 1200);
  b = pf(5000, 15000, false); assert.equal(b.wages.addedBack, 0, 'before the Code: no add-back'); assert.equal(monthFactor('2026-08', '2026-08-17'), 0.4839);
});

test('AC-01 components, structures, statutory parameters and assignments configured with approvals; arrears of a retro revision; masking and rights', async () => {
  const r = await qaReady(opened, { users: Object.values(U) }); const d = r.d; const call = (who, method, path, body, k = key()) => r.api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const emp = (code, gender = 'MALE') => { const id = fill(d, 'hr_employees', { company_id: 1, emp_code: code, first_name: code, full_name: `Employee ${code}`, gender, dob: '1990-01-01', mobile: '9000000000', employment_type: 'PERMANENT', doj: '2025-01-01', record_status: 'APPROVED', employment_status: 'ACTIVE', grade: 'M2' }); fill(d, 'hr_employee_statutory', { company_id: 1, employee_id: id, pf_applicable: 1, esi_applicable: 0, pt_state: 'TS' }); return id; };
  const e1 = emp('E1'); const e2 = emp('E2');
  // FR-01/FR-02: the template components; a formula checked by the calculation engine
  const cl = await call(U.pay, 'GET', '/components'); assert.equal(cl.status, 200, JSON.stringify(cl.json)); assert.ok(cl.json.data.components.length >= 25); assert.equal(cl.json.data.components.find((c) => c.code === 'HRA').wageClass, 'EXCLUDED');
  assert.equal((await call(U.hr, 'POST', '/components', { code: 'FOOD', name: 'Food', type: 'EARNING', method: 'FIXED' })).status, 403);
  const bad = await call(U.pay, 'POST', '/components', { code: 'SITE_HRA', name: 'Site HRA', type: 'EARNING', method: 'FORMULA', formula: 'round(BASIC * 10 / 100 + GHOST, 0)', sequence: 35 }); assert.equal(bad.status, 400); assert.match(JSON.stringify(bad.json), /GHOST/);
  assert.equal((await call(U.pay, 'POST', '/components', { code: 'SITE_HRA', name: 'Site HRA', type: 'EARNING', method: 'FORMULA', formula: 'round(min(BASIC, PF_CEILING) * 10 / 100, 0)', sequence: 35, wageClass: 'EXCLUDED' })).status, 200);
  const ft = (await call(U.pay, 'POST', '/components/test', { code: 'SITE_HRA', formula: 'round(min(BASIC, PF_CEILING) * 10 / 100, 0)', values: { BASIC: 30000 } })).json.data; assert.equal(ft.amount, 1500);
  // FR-03: structures and the CTC preview
  const lines = ['BASIC', 'HRA', 'CONVEYANCE', 'SPECIAL', 'PF_EE', 'PT', 'PF_ER', 'EPS_ER', 'EDLI_ER', 'PF_ADMIN', 'GRATUITY'].map((code) => ({ code, ...(code === 'CONVEYANCE' ? { value: 1600 } : {}) }));
  const st = await call(U.pay, 'POST', '/structures', { code: 'STAFF', name: 'Staff', grade: 'M2', components: lines }); assert.equal(st.status, 200, JSON.stringify(st.json)); const sid = st.json.data.id;
  const sen = (await call(U.pay, 'POST', '/structures', { code: 'SENIOR', name: 'Senior management', grade: 'S1', senior: true, components: lines })).json.data.id;
  const pv = (await call(U.pay, 'POST', '/structures/preview', { structureId: sid, ctcAnnual: 900000, employeeId: e1, date: '2026-10-01' })).json.data; const amt = (b, c) => b.lines.find((l) => l.code === c)?.amount;
  assert.deepEqual([amt(pv, 'BASIC'), amt(pv, 'HRA'), amt(pv, 'CONVEYANCE'), amt(pv, 'PF_EE'), amt(pv, 'PT')], [30000, 12000, 1600, 1800, 200]); assert.equal(pv.ctcMonthly, 75000, 'the special allowance takes the balance of the CTC');
  assert.equal((await call(U.pay, 'POST', '/structures', { id: sid, components: [{ code: 'BASIC', value: 5 }] })).status, 400, 'BASIC is a formula, not a fixed amount');
  // FR-06: a statutory parameter change PAY -> CFO; the new slab is read from its date
  const sp = await call(U.pay, 'POST', '/statutory-params', { code: 'PT', state: 'TS', effectiveFrom: '2026-12-01', params: { slabs: [{ upTo: 15000, amount: 0 }, { upTo: 20000, amount: 150 }, { upTo: null, amount: 250 }] }, legalRef: 'Telangana notification (test)' }); assert.equal(sp.status, 201, JSON.stringify(sp.json));
  assert.equal((await call(U.pay, 'POST', '/statutory-params', { code: 'PT', state: 'TS', effectiveFrom: '2026-12-01', params: { slabs: [{ upTo: 100, amount: 0 }] }, legalRef: 'Wrong slabs here' })).status, 400, 'the last slab has no limit');
  assert.equal((await call(U.pay, 'POST', `/statutory-params/${sp.json.data.id}/submit`)).status, 202); assert.equal((await r.act(U.cfo, r.wf('pay_statutory_params', sp.json.data.id))).status, 200);
  assert.equal(r.events('pay.statutory.approved').at(-1).code, 'PT'); const pv2 = (await call(U.pay, 'POST', '/structures/preview', { structureId: sid, ctcAnnual: 900000, employeeId: e1, date: '2026-12-15' })).json.data; assert.equal(amt(pv2, 'PT'), 250);
  // FR-05: the calendar
  const cal = await call(U.pay, 'POST', '/calendar/generate', { fyStart: '2026-04-01', payDay: 1 }); assert.equal(cal.status, 200); assert.equal(cal.json.data.made, 12); assert.equal(cal.json.data.rows[0].payDate, '2026-05-01');
  // FR-04: the first assignment; HRMGR -> CFO; the monthly pay of the employee set
  const a1 = await call(U.pay, 'POST', '/assignments', { employeeId: e1, structureId: sid, ctcAnnual: 600000, effectiveFrom: '2026-04-01', reason: 'Joining structure' }); assert.equal(a1.status, 201, JSON.stringify(a1.json)); const g1 = a1.json.data.breakup.fullGross;
  assert.equal((await call(U.pay, 'POST', '/assignments', { employeeId: e1, structureId: sid, ctcAnnual: 610000, effectiveFrom: '2026-04-01', reason: 'Second one at once' })).status, 409, 'one assignment in progress');
  assert.equal((await call(U.pay, 'POST', `/assignments/${a1.json.data.id}/submit`)).status, 202); let inst = r.wf('pay_assignments', a1.json.data.id);
  assert.equal((await r.act(U.hr, inst)).status, 200); assert.equal((await r.act(U.cfo, inst)).status, 200);
  assert.equal((await call(U.pay, 'GET', `/assignments/${a1.json.data.id}`)).json.data.status, 'APPROVED');
  const payLines = () => d.prepare("SELECT component_code, monthly_paise FROM hr_employee_pay WHERE employee_id = ? AND deleted_at IS NULL AND effective_to IS NULL AND source_type = 'pay_assignments' ORDER BY component_code").all(e1);
  assert.equal(payLines().reduce((a, x) => a + x.monthly_paise, 0), Math.round(g1 * 100), 'the employee master holds the gross from the date');
  // BR-01: a revision dated back to August: arrears for each month up to last month
  const a2 = await call(U.pay, 'POST', '/assignments', { employeeId: e1, structureId: sid, ctcAnnual: 720000, effectiveFrom: '2026-08-01', reason: 'Annual increment' }); assert.equal(a2.status, 201, JSON.stringify(a2.json)); assert.equal(a2.json.data.kind, 'REVISION'); assert.equal(a2.json.data.incrementPct, 20);
  const g2 = a2.json.data.breakup.fullGross; assert.equal((await call(U.pay, 'POST', `/assignments/${a2.json.data.id}/submit`)).status, 202); inst = r.wf('pay_assignments', a2.json.data.id);
  assert.equal((await call(U.pay, 'GET', `/assignments/${a2.json.data.id}`)).json.data.can.approve, false, 'the maker does not approve'); assert.equal((await r.act(U.hr, inst)).status, 200); assert.equal((await r.act(U.cfo, inst)).status, 200);
  const x2 = (await call(U.pay, 'GET', `/assignments/${a2.json.data.id}`)).json.data; const months = []; for (let m = '2026-08'; m < todayIST().slice(0, 7); m = `${m.slice(0, 4)}-${String(Number(m.slice(5)) + 1).padStart(2, '0')}`) months.push(m);
  assert.equal(new Set(x2.arrearLines.map((l) => l.month)).size, months.length); assert.ok(Math.abs(x2.arrears - Math.round((g2 - g1) * months.length * 100) / 100) <= months.length, `arrears ${x2.arrears} for ${months.length} month(s) of ${g2 - g1}`);
  assert.equal((await call(U.pay, 'GET', `/assignments/${a1.json.data.id}`)).json.data.effectiveTo, '2026-07-31'); assert.equal(r.events('pay.assignment.approved').at(-1).arrears, x2.arrears);
  const ar = (await call(U.pay, 'GET', `/arrears?employeeId=${e1}`)).json.data; assert.equal(ar.length, x2.arrearLines.length);
  // a senior grade goes to the director as well
  const a3 = await call(U.pay, 'POST', '/assignments', { employeeId: e2, structureId: sen, ctcAnnual: 3600000, effectiveFrom: todayIST().slice(0, 7) + '-01', reason: 'Appointed head of projects' }); assert.equal(a3.status, 201, JSON.stringify(a3.json));
  assert.equal((await call(U.pay, 'POST', `/assignments/${a3.json.data.id}/submit`)).status, 202); inst = r.wf('pay_assignments', a3.json.data.id); assert.equal((await r.act(U.hr, inst)).status, 200); assert.equal((await r.act(U.cfo, inst)).status, 200);
  assert.equal((await call(U.pay, 'GET', `/assignments/${a3.json.data.id}`)).json.data.status, 'SUBMITTED', 'the director still to approve'); assert.equal((await r.act(U.dir, inst)).status, 200); assert.equal((await call(U.pay, 'GET', `/assignments/${a3.json.data.id}`)).json.data.status, 'APPROVED');
  // masking and rights
  const audView = (await call(U.aud, 'GET', `/assignments/${a2.json.data.id}`)).json.data; assert.equal(audView.ctcAnnual, null); assert.equal(audView.breakup, null); assert.equal(audView.masked, true);
  assert.equal((await call(U.se, 'GET', '/assignments')).status, 403); assert.equal((await call(U.hr, 'POST', '/assignments', { employeeId: e2, structureId: sid, ctcAnnual: 100000, effectiveFrom: '2026-12-01', reason: 'Not allowed' })).status, 403);
  assert.equal((await call(as('PAY', 'pay9', '2'), 'GET', `/assignments/${a1.json.data.id}`)).status, 404); assert.equal((await call(U.cfo, 'GET', `/assignments/${a2.json.data.id}/print`)).status, 200);
});
