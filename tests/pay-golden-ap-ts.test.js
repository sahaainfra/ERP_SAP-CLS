import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { computeBreakup } from '../src/server/modules/pay/engine.js';

// PACK-27: payroll golden outputs per state (Andhra Pradesh, Telangana) for PF, ESI, PT and LWF. The rates are the platform's seeded statutory
// parameters (pay_statutory_params, read from the migrated database, not typed here); Part 65 confirms them. The expected deductions come
// from an independent calculation written from the rules, and are frozen in tests/fixtures/pay-golden-ap-ts.json.
// Review by the HR/payroll owner: PENDING (the file says so). GOLDEN_CAPTURE=1 rewrites the file.
const FILE = new URL('./fixtures/pay-golden-ap-ts.json', import.meta.url);
const apis = []; after(async () => { for (const a of apis) await a.close(); });
const C = (code, t, m, x = {}) => ({ code, name: code, comp_type: t, calc_method: m, sequence: x.seq ?? 100, wage_class: 'WAGES', pf_applicable: x.pf ? 1 : 0, esi_applicable: x.esi ? 1 : 0, pt_applicable: x.pt ? 1 : 0, taxable: 1, prorate: 1, statutory_code: x.s });
const COMPS = [C('BASIC', 'EARNING', 'FIXED', { seq: 10, pf: 1, esi: 1, pt: 1 }), C('HRA', 'EARNING', 'FIXED', { seq: 20, esi: 1, pt: 1 }),
  ...['PF_EE', 'ESI_EE', 'PT', 'LWF_EE'].map((s, i) => C(s, 'DEDUCTION', 'STATUTORY', { s, seq: 210 + i })), ...['PF_ER', 'EPS_ER', 'ESI_ER', 'LWF_ER'].map((s, i) => C(s, 'EMPLOYER', 'STATUTORY', { s, seq: 310 + i }))];
const PEOPLE = [{ id: 'E12', basic: 8000, hra: 4000 }, { id: 'E18', basic: 10800, hra: 7200 }, { id: 'E30', basic: 18000, hra: 12000 }];
const MONTHS = ['2026-10', '2027-01'];

// the oracle, from the rules: PF 12 % of min(basic, ceiling), EPS 8.33 % of the same within the EPS ceiling, the employer EPF the rest of 12 %;
// ESI 0.75 % / 3.25 % of the gross, rounded up, only while the gross is within the ESI ceiling; PT by the slab of the gross; LWF in its months
function oracle(P, p, month) {
  const gross = p.basic + p.hra; const w = Math.min(p.basic, P.PF.wageCeiling); const pfEe = Math.round((w * P.PF.employeeRate) / 100); const eps = Math.round((Math.min(p.basic, P.PF.epsCeiling) * P.PF.epsRate) / 100);
  const esiOn = gross <= P.ESI.wageCeiling; const slab = P.PT ? P.PT.slabs.find((s) => s.upTo == null || gross <= s.upTo) : null; const lwfOn = P.LWF && (P.LWF.months ?? []).includes(Number(month.slice(5, 7)));
  return { gross, PF_EE: pfEe, EPS_ER: eps, PF_ER: pfEe - eps, ESI_EE: esiOn ? Math.ceil((gross * P.ESI.employeeRate) / 100) : 0, ESI_ER: esiOn ? Math.ceil((gross * P.ESI.employerRate) / 100) : 0, PT: slab ? Number(slab.amount) : 0, LWF_EE: lwfOn ? Number(P.LWF.employee) : 0, LWF_ER: lwfOn ? Number(P.LWF.employer) : 0 };
}

test('PACK-27 payroll golden per state: PF, ESI, PT and LWF for Andhra Pradesh and Telangana from the seeded parameters, against the oracle and the frozen file', async () => {
  const api = await startApi(); apis.push(api); await setupCompany(api); const d = api.db;
  const param = (code, state) => { const r = d.prepare("SELECT params_json, doc_no, status FROM pay_statutory_params WHERE company_id IS NULL AND code = ? AND state_code = ? AND deleted_at IS NULL ORDER BY effective_from DESC LIMIT 1").get(code, state); return r ? { ...JSON.parse(r.params_json), docNo: r.doc_no, status: r.status } : null; };
  const out = { reviewedByPayrollOwner: 'PENDING', ratesConfirmedByPart65: 'PENDING', note: 'Monthly amounts in rupees', states: {} };
  for (const state of ['AP', 'TS']) {
    const P = { PF: param('PF', 'ALL'), ESI: param('ESI', 'ALL'), PT: param('PT', state), LWF: param('LWF', state) };
    assert.ok(P.PF && P.ESI && P.PT, `${state}: PF, ESI and PT are seeded`);
    out.states[state] = { params: { PF: P.PF.docNo, ESI: P.ESI.docNo, PT: P.PT.docNo, LWF: P.LWF?.docNo ?? null }, rows: [] };
    for (const month of MONTHS) for (const p of PEOPLE) {
      const b = computeBreakup({ components: COMPS, values: { BASIC: p.basic, HRA: p.hra }, params: P, employee: { pf: true, esi: true, ptState: state, lwfState: state }, month, wageRule: false });
      const got = Object.fromEntries(['PF_EE', 'EPS_ER', 'PF_ER', 'ESI_EE', 'ESI_ER', 'PT', 'LWF_EE', 'LWF_ER'].map((k) => [k, b.lines.find((l) => l.code === k)?.amount ?? 0]));
      const want = oracle(P, p, month); const { gross, ...wantAmounts } = want;
      assert.deepEqual(got, wantAmounts, `${state} ${month} ${p.id}`);
      out.states[state].rows.push({ month, employee: p.id, gross, ...got });
    }
  }
  if (process.env.GOLDEN_CAPTURE === '1') writeFileSync(FILE, `${JSON.stringify(out, null, 1)}\n`);
  const golden = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.deepEqual(out.states, golden.states, 'the engine and the seeded parameters give the frozen golden outputs');
  // what the golden shows, in words
  const row = (s, m, e) => golden.states[s].rows.find((x) => x.month === m && x.employee === e);
  assert.deepEqual([row('TS', '2026-10', 'E18').PT, row('TS', '2026-10', 'E30').PT, row('TS', '2026-10', 'E12').PT], [150, 200, 0], 'PT slabs: up to 15,000 nil, to 20,000 ₹ 150, above ₹ 200');
  assert.deepEqual([row('TS', '2027-01', 'E18').LWF_EE, row('TS', '2027-01', 'E18').LWF_ER, row('TS', '2026-10', 'E18').LWF_EE], [2, 5, 0], 'Telangana LWF once a year, in January');
  assert.equal(golden.states.AP.params.LWF, null, 'no Andhra Pradesh LWF is seeded (D-885)');
  assert.deepEqual([row('AP', '2026-10', 'E30').ESI_EE, row('AP', '2026-10', 'E18').ESI_EE], [0, 135], 'ESI only up to ₹ 21,000: 0.75 % of 18,000');
  assert.deepEqual([row('AP', '2026-10', 'E30').PF_EE, row('AP', '2026-10', 'E30').EPS_ER, row('AP', '2026-10', 'E30').PF_ER], [1800, 1250, 550], 'PF on the ₹ 15,000 ceiling');
});
