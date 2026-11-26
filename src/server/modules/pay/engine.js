import { CalcError, definitionProblems, runDefinition } from '../../../shared/calc.js';

// Part 24.01: the pay engine — one place for the arithmetic of payroll (24.01 previews and assignments, 24.02 monthly runs, 24.03 wages). Pure: the caller
// passes the components, the values, the statutory parameters in force and the employee's flags; amounts are rupees (2 places).
//  FR-01/FR-02 earnings in their sequence: FIXED (the structure's or the assignment's value), PERCENT (of other components), FORMULA (an expression of the
//  calculation engine 01.06 over CTC_MONTHLY, CTC_ANNUAL and the components before it), BALANCE (what is left of the monthly CTC after the other earnings and the
//  employer contributions), INPUT (a monthly input of the run). Statutory: PF on min(wages, ceiling), EPS, EDLI, admin; ESI within its ceiling; professional
//  tax by state slabs; labour welfare fund in its months; gratuity provision on the Code-on-Wages wage base.
//  Code on Wages s.2(y) (in force 21-11-2025): wages = components classed WAGES; when the EXCLUDED components are more than half of the remuneration, the excess
//  is added back to wages. PF, gratuity and bonus are worked out on that base when the rule is in force on the date.
export const r2 = (v) => Math.round(Number(v) * 100) / 100;
const r0 = (v) => Math.round(Number(v));
const NAME = /^[A-Z][A-Z0-9_]*$/;

/** Problems of a component formula (empty when sound): syntax and unknown names. `names` are what it may use. */
export function formulaProblems(code, formula, names) {
  if (!NAME.test(code)) return [`${code} is not a component code (capital letters, digits and _).`];
  // the calculation language names are lower-case: a formula is written in component codes and read in lower case
  try { return definitionProblems({ expression: `${code.toLowerCase()} = ${String(formula).toLowerCase()}`, inputs: names.map((n) => ({ name: n.toLowerCase(), type: 'decimal' })), outputs: [{ name: code.toLowerCase(), type: 'money' }] }).map((m) => m.replace(/"([a-z0-9_]+)"|: ([a-z0-9_]+)/g, (x) => x.toUpperCase())); } catch (e) { return [e.message]; }
}
/** One formula evaluated with the values it may use; returns the amount and the steps. */
export function evalFormula(code, formula, env) {
  const names = Object.keys(env).filter((k) => NAME.test(k)); const lc = code.toLowerCase();
  try { const r = runDefinition({ expression: `${lc} = ${String(formula).toLowerCase()}`, inputs: names.map((n) => ({ name: n.toLowerCase(), type: 'decimal' })), outputs: [{ name: lc, type: 'money' }] }, Object.fromEntries(names.map((n) => [n.toLowerCase(), String(env[n] ?? 0)])));
    return { amount: Number(r.outputs[lc]), trace: r.trace.steps.map((t) => ({ ...t, name: t.name.toUpperCase(), formula: t.formula.toUpperCase() })) }; }
  catch (e) { throw new CalcError(`${code}: ${e.message}`); }
}

/** The professional tax of a month for a monthly gross under a state's slabs (February may differ; women may be exempt up to a limit). */
/** @param {any} p @param {number} gross @param {{ month?: string, gender?: string }} [o] */
export function ptFor(p, gross, { month, gender } = {}) {
  if (!p?.slabs?.length) return 0;
  if (gender === 'FEMALE' && p.womenExemptUpTo && gross <= p.womenExemptUpTo) return 0;
  const s = p.slabs.find((x) => x.upTo == null || gross <= x.upTo); if (!s) return 0;
  return Number(month?.slice(5, 7) === '02' && s.februaryAmount != null ? s.februaryAmount : s.amount);
}

/** Annual income tax under a regime's slabs after the standard deduction, with the rebate and the cess (TDS projection of 24.02). */
export function annualTax(p, grossAnnual, deductions = 0) {
  if (!p) return { taxable: 0, tax: 0, rebate: 0, cess: 0, total: 0 };
  const taxable = Math.max(0, grossAnnual - (p.standardDeduction ?? 0) - (p.regime === 'OLD' ? deductions : 0));
  let tax = 0; let prev = 0; for (const s of p.slabs) { const top = s.upTo ?? Infinity; if (taxable > prev) tax += (Math.min(taxable, top) - prev) * s.rate / 100; prev = top; if (taxable <= top) break; }
  let rebate = 0; if (p.rebateIncomeUpTo != null && taxable <= p.rebateIncomeUpTo) rebate = Math.min(tax, p.rebateMax ?? tax);
  const after = Math.max(0, tax - rebate); const cess = after * (p.cess ?? 0) / 100;
  return { taxable: r0(taxable), tax: r0(tax), rebate: r0(rebate), cess: r0(cess), total: r0(after + cess) };
}

/**
 * The monthly breakup of a structure.
 * @param {{ components: any[], values?: Record<string, number>, overrides?: Record<string, number>, inputs?: Record<string, number>, ctcAnnual?: number,
 *   params?: Record<string, any>, employee?: { pf?: boolean, esi?: boolean, ptState?: string|null, lwfState?: string|null, gender?: string },
 *   month?: string, wageRule?: boolean, factor?: number, esiGross?: number, ptGross?: number }} o
 * `components`: the structure's components with their definition; `values`: monthly values of FIXED components; `overrides`: the assignment's values;
 * `inputs`: monthly inputs (INPUT components); `params`: { PF, ESI, PT, LWF, GRATUITY }; `factor`: paid days ÷ days of the month for components that prorate.
 */
export function computeBreakup(o) {
  const comps = [...o.components].sort((a, b) => a.sequence - b.sequence || String(a.code).localeCompare(String(b.code)));
  const ctcM = (o.ctcAnnual ?? 0) / 12; const f = o.factor ?? 1; const P = o.params ?? {}; const emp = o.employee ?? {};
  const env = { CTC_MONTHLY: r2(ctcM), CTC_ANNUAL: r2(o.ctcAnnual ?? 0), PF_CEILING: P.PF?.wageCeiling ?? 15000, ESI_CEILING: P.ESI?.wageCeiling ?? 21000 };
  const full = {}; const traces = {};
  const earnings = comps.filter((c) => c.comp_type === 'EARNING' || c.comp_type === 'REIMBURSEMENT');
  // the full-month earnings (before proration), BALANCE last
  const fixedPass = () => { for (const c of earnings) { if (c.calc_method === 'BALANCE') continue; let v = 0;
    if (c.calc_method === 'FIXED') v = o.overrides?.[c.code] ?? o.values?.[c.code] ?? 0;
    else if (c.calc_method === 'PERCENT') v = r0((c.base_codes ?? []).reduce((a, b) => a + (full[b] ?? 0), 0) * (c.percent_bp ?? 0) / 10000);
    else if (c.calc_method === 'FORMULA') { const x = evalFormula(c.code, c.formula, { ...env, ...full }); v = x.amount; traces[c.code] = x.trace; }
    else if (c.calc_method === 'INPUT') v = 0;
    if (o.overrides?.[c.code] != null && c.calc_method !== 'INPUT') v = o.overrides[c.code];
    full[c.code] = r2(v); env[c.code] = full[c.code]; } };
  fixedPass();
  const bal = earnings.find((c) => c.calc_method === 'BALANCE');
  const statutory = (earn, month) => {
    const sum = (pred) => r2(Object.entries(earn).filter(([k]) => pred(comps.find((c) => c.code === k))).reduce((a, [, v]) => a + v, 0));
    const isE = (c) => c && c.comp_type === 'EARNING';
    const wagesClassed = sum((c) => isE(c) && c.wage_class === 'WAGES'); const excluded = sum((c) => isE(c) && c.wage_class === 'EXCLUDED'); const rem = wagesClassed + excluded;
    const addBack = o.wageRule && excluded > rem / 2 ? r2(excluded - Math.floor(rem / 2)) : 0; const codeWages = r2(wagesClassed + addBack);
    const pfBase = o.wageRule ? codeWages : sum((c) => isE(c) && c.pf_applicable); const out = {}; const has = (code) => comps.some((c) => c.statutory_code === code);
    if (emp.pf && P.PF) { const pf = P.PF; const w = pf.restrictToCeiling === false ? pfBase : Math.min(pfBase, pf.wageCeiling); /* the ceiling applies unless contributions on the full wage are chosen, as in wage runs */ const eps = r0(Math.min(pfBase, pf.epsCeiling ?? pf.wageCeiling) * pf.epsRate / 100);
      if (has('PF_EE')) out.PF_EE = r0(w * pf.employeeRate / 100); if (has('EPS_ER')) out.EPS_ER = eps; if (has('PF_ER')) out.PF_ER = Math.max(0, r0(w * pf.employeeRate / 100) - eps);
      if (has('EDLI_ER')) out.EDLI_ER = r0(Math.min(pfBase, pf.edliCeiling ?? pf.wageCeiling) * pf.edliRate / 100); if (has('PF_ADMIN')) out.PF_ADMIN = r0(w * pf.adminRate / 100); out.pfWage = r2(w); }
    const esiBase = sum((c) => isE(c) && c.esi_applicable);
    if (emp.esi && P.ESI && (o.esiGross ?? esiBase) <= P.ESI.wageCeiling) { if (has('ESI_EE')) out.ESI_EE = Math.ceil(r2(esiBase * P.ESI.employeeRate / 100)); if (has('ESI_ER')) out.ESI_ER = Math.ceil(r2(esiBase * P.ESI.employerRate / 100)); out.esiWage = esiBase; }
    if (has('PT') && P.PT) out.PT = ptFor(P.PT, o.ptGross ?? sum((c) => isE(c) && c.pt_applicable), { month, gender: emp.gender });
    if (P.LWF && month && (P.LWF.months ?? []).includes(Number(month.slice(5, 7)))) { if (has('LWF_EE')) out.LWF_EE = Number(P.LWF.employee ?? 0); if (has('LWF_ER')) out.LWF_ER = Number(P.LWF.employer ?? 0); }
    if (has('GRATUITY') && P.GRATUITY) out.GRATUITY = r0((o.wageRule ? codeWages : sum((c) => isE(c) && ['BASIC', 'DA'].includes(c.code))) * P.GRATUITY.rate / 100);
    return { out, wages: { wagesClassed, excluded, remuneration: rem, addedBack: addBack, codeWages, pfBase, ruleApplies: Boolean(o.wageRule) } };
  };
  const employerOf = (s) => comps.filter((c) => c.comp_type === 'EMPLOYER').reduce((a, c) => a + (s.out[c.statutory_code] ?? 0), 0);
  if (bal) { // the balance of the CTC: a fixed point, the employer contributions depending on the earnings
    let b = 0; for (let k = 0; k < 8; k += 1) { full[bal.code] = r2(Math.max(0, b)); const s = statutory(full, o.month); const others = earnings.filter((c) => c.code !== bal.code && c.calc_method !== 'INPUT' && c.comp_type === 'EARNING').reduce((a, c) => a + (full[c.code] ?? 0), 0); const nb = r2(ctcM - others - employerOf(s)); if (Math.abs(nb - b) < 0.01) { b = nb; break; } b = nb; }
    full[bal.code] = r2(Math.max(0, b)); env[bal.code] = full[bal.code];
  }
  // the month: prorated earnings plus the inputs
  const earn = {}; for (const c of earnings) { const v = c.calc_method === 'INPUT' ? (o.inputs?.[c.code] ?? 0) : (c.prorate ? r2((full[c.code] ?? 0) * f) : full[c.code] ?? 0); if (v || c.calc_method !== 'INPUT') earn[c.code] = r2(v); }
  const fullGross = r2(earnings.filter((c) => c.comp_type === 'EARNING' && c.calc_method !== 'INPUT').reduce((a, c) => a + (full[c.code] ?? 0), 0));
  const s = statutory(Object.fromEntries(Object.entries(earn).filter(([k]) => comps.find((c) => c.code === k)?.comp_type === 'EARNING')), o.month);
  const lines = []; for (const c of comps) { let amount;
    if (c.comp_type === 'EARNING' || c.comp_type === 'REIMBURSEMENT') amount = earn[c.code] ?? 0;
    else if (c.calc_method === 'STATUTORY') amount = s.out[c.statutory_code] ?? 0;
    else amount = o.inputs?.[c.code] ?? o.overrides?.[c.code] ?? 0;
    lines.push({ code: c.code, name: c.name, type: c.comp_type, method: c.calc_method, wageClass: c.wage_class, taxable: Boolean(c.taxable), full: c.comp_type === 'EARNING' ? full[c.code] ?? 0 : null, amount: r2(amount), trace: traces[c.code] ?? null }); }
  const tot = (t) => r2(lines.filter((l) => l.type === t).reduce((a, l) => a + l.amount, 0));
  const gross = tot('EARNING'); const deductions = tot('DEDUCTION'); const employer = tot('EMPLOYER'); const reimb = tot('REIMBURSEMENT');
  return { lines, gross, fullGross, deductions, employer, reimbursements: reimb, net: r2(gross + reimb - deductions), ctcMonthly: r2(fullGross + employer), ctcAnnual: r2((fullGross + employer) * 12), taxableGross: r2(lines.filter((l) => l.type === 'EARNING' && l.taxable).reduce((a, l) => a + l.amount, 0)), wages: s.wages, pfWage: s.out.pfWage ?? 0, esiWage: s.out.esiWage ?? 0 };
}

/** The days of a month a date range covers, as a factor of the month (for the first month of a retro-dated revision). */
export function monthFactor(month, from) {
  const [y, m] = month.split('-').map(Number); const days = new Date(Date.UTC(y, m, 0)).getUTCDate(); const start = from > `${month}-01` ? Number(from.slice(8, 10)) : 1;
  return Math.round(((days - start + 1) / days) * 10000) / 10000;
}
