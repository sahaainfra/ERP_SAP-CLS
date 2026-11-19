import { createHash } from 'node:crypto';
import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { toPdf } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { createVault } from '../../platform/integrations/vault.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { todayIST } from '../../../shared/dates.js';
import { templateServiceOf } from '../eng/templates.js';
import { definePostingEvent } from '../fin/posting.js';
import { buildBankFile, nameMatch, templateOf, validateBankFile } from '../fin/payments.js';
import { nowIso, rid, same } from '../proc/base.js';
import { STATUS, createFlow } from '../qa/flow.js';
import { annualTax } from './engine.js';
import { fyOf, regimeDeductions } from './runs.js';
import { pickRule } from './statutory.js';

// Part 24.05: the end of the payroll cycle.
//  FR-01 posting through the posting engine (23.02): the approved payroll run (salary cost by project, site, department and cost centre from the allocation of
//   24.02; statutory payables; advances and recoveries; net pay payable), the approved wage run (24.03) and its payment, the approved full-and-final; the labour
//   cost reaches project control (12.03 ledger -> 14.07) once the journal is posted.
//  FR-02 the salary bank transfer: the net pay of the locked run (held salaries left out until released), a settlement's net pay; the bank file in the template of
//   the company's bank account (built and checked by the 23.04 file builder), released by someone other than its preparer, posted (Dr salaries payable, Cr bank),
//   then confirmed line by line with the UTR; a line the bank returns is reversed and can be paid again.
//  FR-03 payslips from the template library (04.11: the standard payslip, or the Hindi one), kept and sent password-protected (AES-128), in self-service (07.09).
//  FR-04 the full-and-final of a leaver whose clearance is complete (BR-01: exit 07.13 released the inputs): last salary (the payroll engine), leave encashment,
//   notice pay or recovery, gratuity (Code on Social Security from 21-11-2025), bonus, recoveries (advances, items, pending inputs), TDS on the year; approval
//   PAY -> HRMGR -> CFO; payment; the statement; the relieving letter from exit.

export const FNF_DOC = 'PAY_FNF';
const paise = (v) => Math.round(Number(v) * 100);
const rs = (p) => (p == null ? null : p / 100);
const s2 = (p) => (p / 100).toFixed(2);
const money = (p) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthEnd = (p) => { const [y, m] = p.split('-').map(Number); return `${p}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
const addMonths = (p, n) => { const [y, m] = p.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`; };
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (p) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;

if (!parameterRegistry.get('pay.payslip.async_count')) parameterRegistry.define({ key: 'pay.payslip.async_count', dataType: 'integer', default: 50, scopes: ['system', 'company'], description: 'Part 24.05: payslips of more employees than this are generated as a background job with progress; fewer are generated at once.', min: 1, max: 100000 });

// ================================================================ pure: the posting of a payroll run (T-01)
const PF = ['PF_EE', 'PF_ER', 'EPS_ER', 'EDLI_ER', 'PF_ADMIN']; const ESI = ['ESI_EE', 'ESI_ER']; const LWF = ['LWF_EE', 'LWF_ER'];
/** Splits an amount in paise over shares so the parts add up to it exactly (the largest remainders take the odd paise). */
export function splitPaise(total, shares) {
  if (!shares.length) return [];
  const sum = shares.reduce((a, s) => a + s, 0) || 1; const raw = shares.map((s) => (total * s) / sum); const out = raw.map((x) => Math.floor(x));
  let left = total - out.reduce((a, b) => a + b, 0); const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0 && k < order.length; k += 1, left -= 1) out[order[k][1]] += 1;
  return out;
}
/**
 * The journal figures of a payroll run, in paise: the cost of each project, site, department and cost centre (salary = earnings and reimbursements, employer
 * contributions, gratuity provision), the advance recovered from each employee, and the payables. Debits equal credits.
 * @param {{ employeeId: number, departmentId?: number|null, costCentreId?: number|null, components: { code: string, type: string, amount: number }[], allocation?: { projectId?: number|null, siteId?: number|null, share: number }[] }[]} lines
 */
export function runPosting(lines) {
  const cost = new Map(); const adv = new Map(); const T = { pf: 0, esi: 0, pt: 0, lwf: 0, tds: 0, other: 0, gratuity: 0, recoveries: 0, net: 0 };
  for (const l of lines) {
    let salary = 0; let employer = 0; let grat = 0; let ded = 0;
    for (const c of l.components) {
      const a = paise(c.amount ?? 0); if (!a) continue;
      if (c.type === 'EARNING' || c.type === 'REIMBURSEMENT') { salary += a; continue; }
      if (c.type === 'EMPLOYER') { if (c.code === 'GRATUITY') { grat += a; T.gratuity += a; } else { employer += a; if (PF.includes(c.code)) T.pf += a; else if (ESI.includes(c.code)) T.esi += a; else if (LWF.includes(c.code)) T.lwf += a; else T.other += a; } continue; }
      ded += a;
      if (PF.includes(c.code)) T.pf += a; else if (ESI.includes(c.code)) T.esi += a; else if (LWF.includes(c.code)) T.lwf += a; else if (c.code === 'PT') T.pt += a; else if (c.code === 'TDS') T.tds += a;
      else if (c.code === 'ADVANCE') adv.set(l.employeeId, (adv.get(l.employeeId) ?? 0) + a); else if (c.code === 'RECOVERY') T.recoveries += a; else T.other += a;
    }
    T.net += salary - ded;
    const alloc = (l.allocation ?? []).filter((x) => x.share > 0); const parts = alloc.length ? alloc : [{ projectId: null, siteId: null, share: 1 }];
    const sh = parts.map((p) => p.share); const S = splitPaise(salary, sh); const E = splitPaise(employer, sh); const G = splitPaise(grat, sh);
    parts.forEach((p, i) => { const k = `${p.projectId ?? ''}|${p.siteId ?? ''}|${l.departmentId ?? ''}|${l.costCentreId ?? ''}`; const x = cost.get(k) ?? { projectId: p.projectId ?? null, siteId: p.siteId ?? null, departmentId: l.departmentId ?? null, costCentreId: l.costCentreId ?? null, salary: 0, employer: 0, gratuity: 0 }; x.salary += S[i]; x.employer += E[i]; x.gratuity += G[i]; cost.set(k, x); });
  }
  const costs = [...cost.values()]; const advances = [...adv.entries()].map(([employeeId, amount]) => ({ employeeId, amount }));
  const debit = costs.reduce((a, c) => a + c.salary + c.employer + c.gratuity, 0);
  const credit = T.pf + T.esi + T.pt + T.lwf + T.tds + T.other + T.gratuity + T.recoveries + T.net + advances.reduce((a, x) => a + x.amount, 0);
  return { cost: costs, advances, totals: T, debit, credit, balanced: debit === credit };
}

// ================================================================ pure: the full-and-final (T-01 worked example)
/** Service from the joining date to the last working day (both counted): years, months, days. */
export function serviceOf(doj, lwd) {
  const a = doj.split('-').map(Number); const e = addDays(lwd, 1).split('-').map(Number);
  let y = e[0] - a[0]; let m = e[1] - a[1]; let d = e[2] - a[2];
  if (d < 0) { m -= 1; d += new Date(Date.UTC(e[0], e[1] - 1, 0)).getUTCDate(); }
  if (m < 0) { y -= 1; m += 12; }
  return { years: y, months: m, days: d };
}
/**
 * The settlement of a leaver from its inputs (rupees in, paise inside, rupees out). Every figure carries its working.
 * @param {any} x
 */
export function fnfCompute(x) {
  const comps = []; const add = (code, label, type, amountPaise, working, taxablePaise = type === 'EARNING' ? amountPaise : 0) => { if (amountPaise > 0) comps.push({ code, label, type, amount: rs(amountPaise), taxable: rs(taxablePaise), working }); return amountPaise; };
  const R = x.rules; const B = R.basis; const W = {};
  // last salary (the payroll engine's lines of the months not paid by a run; its own TDS is replaced by the tax of the year below)
  for (const l of x.lastSalary?.earnings ?? []) add(`LAST_${l.code}`, `${l.name} (last salary)`, 'EARNING', paise(l.amount), `${x.lastSalary.periods.join(', ')}: from the payroll engine`, l.taxable === false ? 0 : paise(l.amount));
  for (const l of x.lastSalary?.deductions ?? []) if (l.code !== 'TDS') add(`LAST_${l.code}`, `${l.name} (last salary)`, 'DEDUCTION', paise(l.amount), 'Statutory deduction of the last salary');
  for (const l of x.lastSalary?.employer ?? []) if (l.code !== 'GRATUITY') add(`ER_${l.code}`, `${l.name} (employer, last salary)`, 'EMPLOYER', paise(l.amount), 'Employer contribution of the last salary (not paid to the employee)');
  // leave encashment: days × (basic + DA) / divisor; exempt up to the least of the cap and the months of average salary
  const day = (paise(x.monthly.basicDa) / B.encashDivisor); const enc = Math.round(day * x.leaveDays);
  const encExempt = Math.min(enc, R.leaveExempt.capPaise, Math.round(paise(x.monthly.basicDa) * R.leaveExempt.monthsOfAverage));
  add('LEAVE_ENC', 'Leave encashment', 'EARNING', enc, `${x.leaveDays} day(s) × basic and DA ${money(paise(x.monthly.basicDa))} / ${B.encashDivisor}; exempt ${money(encExempt)} (the least of the cap ${money(R.leaveExempt.capPaise)}, ${R.leaveExempt.monthsOfAverage} months' salary and the amount)`, enc - encExempt);
  // notice: pay in lieu given by the company, or a recovery for the notice not served
  const noticeDay = paise(x.monthly.gross) / B.noticeDivisor;
  add('NOTICE_PAY', 'Notice pay in lieu', 'EARNING', Math.round(noticeDay * (x.noticePayDays ?? 0)), `${x.noticePayDays} day(s) × gross ${money(paise(x.monthly.gross))} / ${B.noticeDivisor}`);
  add('NOTICE_RECOVERY', 'Notice period recovery', 'DEDUCTION', Math.round(noticeDay * (x.noticeRecoveryDays ?? 0)), `${x.noticeRecoveryDays} day(s) not served × gross ${money(paise(x.monthly.gross))} / ${B.noticeDivisor}`);
  // gratuity: fifteen days' wages for each completed year (and a part beyond six months), from the years of the rule; capped; exempt up to its cap
  const sv = serviceOf(x.service.doj, x.service.lwd); const E = R.eligibility;
  const counted = sv.years + (sv.months > E.partYearMonths || (sv.months === E.partYearMonths && sv.days > 0) ? 1 : 0);
  const minYears = x.service.employmentType === 'CONTRACT' ? E.fixedTermMinYears : E.minYears; const eligible = sv.years >= minYears;
  const gWage = E.wageBase === 'CODE' ? paise(x.monthly.codeWages ?? x.monthly.basicDa) : paise(x.monthly.basicDa);
  const gRaw = eligible ? Math.round((gWage * B.gratuityDays * counted) / B.gratuityDivisor) : 0; const grat = Math.min(gRaw, R.gratuityCapPaise);
  const gExempt = Math.min(grat, R.gratuityExemptCapPaise);
  W.gratuity = { service: sv, countedYears: counted, minYears, eligible, wageBase: E.wageBase, monthlyWage: rs(gWage), raw: rs(gRaw), capped: gRaw > R.gratuityCapPaise };
  if (!eligible) comps.push({ code: 'GRATUITY', label: 'Gratuity', type: 'INFO', amount: 0, taxable: 0, working: `Not eligible: ${sv.years} year(s) ${sv.months} month(s) of service, ${minYears} year(s) needed` });
  else add('GRATUITY', 'Gratuity', 'EARNING', grat, `${B.gratuityDays} / ${B.gratuityDivisor} × ${E.wageBase === 'CODE' ? 'wages (Code on Wages)' : 'basic and DA'} ${money(gWage)} × ${counted} year(s) (${sv.years} y ${sv.months} m ${sv.days} d)${gRaw > R.gratuityCapPaise ? `, capped at ${money(R.gratuityCapPaise)}` : ''}; exempt ${money(gExempt)}`, grat - gExempt);
  // bonus of the year
  if (x.bonus?.eligible) add('BONUS', 'Statutory bonus', 'EARNING', paise(x.bonus.amount), `${x.bonus.rate} % of the bonus wages of the year (Code on Wages, chapter IV)`);
  // recoveries
  add('ADVANCE', 'Advance recovery', 'DEDUCTION', paise(x.recoveries?.advances ?? 0), 'Balance of the advances (07.12) not yet recovered');
  (x.recoveries?.items ?? []).forEach((it, i) => add(`ITEM_${i + 1}`, `Recovery: ${it.label}`, 'DEDUCTION', paise(it.amount), 'Clearance (07.13)'));
  (x.recoveries?.inputs ?? []).forEach((it, i) => add(`INPUT_${i + 1}`, `Recovery: ${it.label}`, 'DEDUCTION', paise(it.amount), 'Payroll input pending'));
  (x.adjustments ?? []).forEach((a, i) => add(`ADJ_${i + 1}`, a.label, a.type, paise(a.amount), `Adjustment: ${a.reason}`, a.type === 'EARNING' && a.taxable !== false ? paise(a.amount) : 0));
  // TDS: the tax of the whole year less what was deducted (no salary follows from this employer)
  const earn = comps.filter((c) => c.type === 'EARNING'); const taxableNow = earn.reduce((a, c) => a + paise(c.taxable ?? 0), 0);
  let tds = 0;
  if (x.tax?.params) { const year = paise(x.tax.ytdTaxable ?? 0) + taxableNow; const t = annualTax(x.tax.params, rs(year), x.tax.deductions ?? 0); tds = Math.max(0, paise(t.total) - paise(x.tax.ytdTds ?? 0)); W.tax = { regime: x.tax.params.regime, yearTaxable: rs(year), tax: t.total, deducted: x.tax.ytdTds ?? 0, now: rs(tds) }; }
  add('TDS', 'Income tax (TDS on the settlement)', 'DEDUCTION', tds, W.tax ? `Tax of the year ${money(paise(W.tax.tax))} on ${money(paise(W.tax.yearTaxable))} (${W.tax.regime} regime) less ${money(paise(W.tax.deducted))} deducted` : '');
  const gross = earn.reduce((a, c) => a + paise(c.amount), 0); const deductions = comps.filter((c) => c.type === 'DEDUCTION').reduce((a, c) => a + paise(c.amount), 0);
  const net = gross - deductions;
  return { components: comps, gross: rs(gross), deductions: rs(deductions), tds: rs(tds), net: rs(net), payable: rs(Math.max(0, net)), recoverable: rs(Math.max(0, -net)), employer: rs(comps.filter((c) => c.type === 'EMPLOYER').reduce((a, c) => a + paise(c.amount), 0)), working: W };
}

// ================================================================ posting events (23.02 engine), registered by this module
/** The figures the engine posts for a payroll run, read from its locked lines. */
export function runPostingData(db, runId) {
  const lines = db.prepare('SELECT l.employee_id, l.components_json, l.allocation_json, e.department_id, e.cost_centre_id FROM pay_run_lines l JOIN hr_employees e ON e.id = l.employee_id WHERE l.run_id = ? AND l.deleted_at IS NULL').all(Number(runId))
    .map((l) => ({ employeeId: l.employee_id, departmentId: l.department_id, costCentreId: l.cost_centre_id, components: json(l.components_json, []), allocation: json(l.allocation_json, []) }));
  const p = runPosting(lines); const T = p.totals;
  return { cost: p.cost.map((c) => ({ ...c, salary: s2(c.salary), employer: s2(c.employer), gratuity: s2(c.gratuity) })), advances: p.advances.map((a) => ({ employeeId: a.employeeId, amount: s2(a.amount) })),
    pfPayable: s2(T.pf), esiPayable: s2(T.esi), ptPayable: s2(T.pt), lwfPayable: s2(T.lwf), tdsPayable: s2(T.tds), otherPayable: s2(T.other), gratuityProvision: s2(T.gratuity), recoveries: s2(T.recoveries), netPayable: s2(T.net), _check: { debit: p.debit, credit: p.credit, balanced: p.balanced } };
}
/** The figures of an approved wage run: the employer contributions split into PF and ESI by the ESI rates in force (the line keeps their total). */
export function wagePostingData(db, runId, esiErRate = null) {
  const r = db.prepare('SELECT * FROM pay_wage_runs WHERE id = ?').get(Number(runId)); if (!r) return {};
  const rate = esiErRate ?? (json(db.prepare("SELECT params_json FROM pay_statutory_params WHERE code = 'ESI' AND status = 'APPROVED' AND (company_id = ? OR company_id IS NULL) AND effective_from <= ? AND deleted_at IS NULL ORDER BY company_id IS NULL, effective_from DESC LIMIT 1").get(r.company_id, r.period_to)?.params_json, {}).employerRate ?? 3.25);
  let gross = 0; let er = 0; let pf = 0; let esi = 0; let advances = 0; let rec = 0; let net = 0;
  for (const l of db.prepare('SELECT * FROM pay_wage_lines WHERE run_id = ? AND deleted_at IS NULL').all(r.id)) {
    const esiEr = l.esi_paise > 0 ? Math.min(l.employer_paise, Math.ceil((l.gross_paise * rate) / 10000) * 100) : 0;
    gross += l.gross_paise; er += l.employer_paise; pf += l.pf_paise + (l.employer_paise - esiEr); esi += l.esi_paise + esiEr; advances += l.advance_paise; rec += l.canteen_paise + l.other_ded_paise; net += l.net_paise;
  }
  return { gross: s2(gross), employer: s2(er), pfPayable: s2(pf), esiPayable: s2(esi), advances: s2(advances), recoveries: s2(rec), net: s2(net) };
}
definePostingEvent('pay.run.approved', { label: 'Payroll run approved (24.02)', docType: 'pay_runs', idField: 'runId', refField: 'docNo', date: (d) => (d.period ? monthEnd(d.period) : null), amounts: ['pfPayable', 'esiPayable', 'ptPayable', 'lwfPayable', 'tdsPayable', 'otherPayable', 'gratuityProvision', 'recoveries', 'netPayable'], text: ['docNo', 'period', 'type'], ids: ['runId', 'branchId'], itemAmounts: { cost: ['salary', 'employer', 'gratuity'], advances: ['amount'] }, enrich: (db, _c, d) => runPostingData(db, d.runId) });
definePostingEvent('pay.wage_run.approved', { label: 'Labour wage run approved (24.03)', docType: 'pay_wage_runs', idField: 'runId', refField: 'docNo', date: (d) => d.periodTo, amounts: ['gross', 'employer', 'pfPayable', 'esiPayable', 'advances', 'recoveries', 'net'], text: ['docNo', 'periodFrom', 'periodTo', 'cycle'], ids: ['projectId', 'siteId', 'contractorId'], enrich: (db, _c, d) => wagePostingData(db, d.runId) });
definePostingEvent('pay.wage_run.paid', { label: 'Labour wages paid (24.03)', docType: 'pay_wage_payments', idField: 'runId', docId: (d, e) => (d.runId ? `${d.runId}:${e?.eventId ?? ''}` : null), refField: 'docNo', date: (d) => d.paidOn, amounts: ['net'], text: ['docNo', 'mode', 'paidOn'], ids: ['projectId', 'siteId'] });
definePostingEvent('pay.fnf.approved', { label: 'Full-and-final settlement approved (24.05)', docType: 'pay_fnf', idField: 'fnfId', refField: 'docNo', date: (d) => d.approvedOn, amounts: ['salary', 'leaveEncashment', 'gratuity', 'employer', 'receivable', 'pfPayable', 'esiPayable', 'ptPayable', 'lwfPayable', 'tdsPayable', 'recoveries', 'advances', 'netPayable'], text: ['docNo', 'employee'], ids: ['employeeId', 'departmentId', 'costCentreId'] });

/** The posting figures of an approved settlement (for the engine). */
export function fnfPostingData(f) {
  const c = json(f.components_json, []); const sum = (fn) => c.filter(fn).reduce((a, x) => a + paise(x.amount), 0);
  const isPf = (x) => PF.some((k) => x.code.endsWith(k)); const isEsi = (x) => ESI.some((k) => x.code.endsWith(k)); const isLwf = (x) => LWF.some((k) => x.code.endsWith(k));
  const earn = (x) => x.type === 'EARNING'; const ded = (x) => x.type === 'DEDUCTION'; const er = (x) => x.type === 'EMPLOYER';
  const salary = sum((x) => earn(x) && x.code !== 'LEAVE_ENC' && x.code !== 'GRATUITY'); const net = f.net_paise;
  return { salary: s2(salary), leaveEncashment: s2(sum((x) => x.code === 'LEAVE_ENC')), gratuity: s2(sum((x) => x.code === 'GRATUITY' && earn(x))), employer: s2(sum(er)), receivable: s2(Math.max(0, -net)),
    pfPayable: s2(sum((x) => (ded(x) || er(x)) && isPf(x))), esiPayable: s2(sum((x) => (ded(x) || er(x)) && isEsi(x))), ptPayable: s2(sum((x) => ded(x) && x.code.endsWith('_PT'))), lwfPayable: s2(sum((x) => (ded(x) || er(x)) && isLwf(x))),
    tdsPayable: s2(sum((x) => ded(x) && x.code === 'TDS')), advances: s2(sum((x) => ded(x) && (x.code === 'ADVANCE' || x.code === 'LAST_ADVANCE'))),
    recoveries: s2(sum((x) => (ded(x) || er(x)) && !isPf(x) && !isEsi(x) && !isLwf(x) && !x.code.endsWith('_PT') && x.code !== 'TDS' && x.code !== 'ADVANCE' && x.code !== 'LAST_ADVANCE' && !er(x)) + sum((x) => er(x) && !isPf(x) && !isEsi(x) && !isLwf(x))), netPayable: s2(Math.max(0, net)) };
}

const lists = {
  fnf: defineList({ code: 'pay.fnf', label: 'Full and final settlements', permission: 'pay.fnf.view', from: 'pay_fnf x JOIN hr_employees e ON e.id = x.employee_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'e.emp_code', 'e.full_name'], defaultSort: '-lastWorkingDay',
    columns: { docNo: { sql: 'x.doc_no', type: 'text', label: 'Settlement' }, employee: { sql: "e.emp_code || ' ' || e.full_name", type: 'text', label: 'Employee' }, lastWorkingDay: { sql: 'x.last_working_day', type: 'date', label: 'Last working day' }, dueDate: { sql: 'x.due_date', type: 'date', label: 'Pay by' },
      net: { sql: '(x.net_paise / 100.0)', type: 'money', label: 'Net' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(STATUS), filter: 'eq' }, payStatus: { sql: 'x.pay_status', type: 'enum', label: 'Payment', options: [['UNPAID', 'Not paid'], ['IN_TRANSFER', 'In a bank transfer'], ['PAID', 'Paid'], ['RECOVERABLE', 'To recover'], ['NIL', 'Nothing to pay']], filter: 'eq' } } }),
};
export const fnfList = lists.fnf;
export const PAY_STATUS = { UNPAID: 'Not paid', IN_TRANSFER: 'In a bank transfer', PAID: 'Paid', RECOVERABLE: 'To recover from the employee', NIL: 'Nothing to pay' };
export const TRANSFER_STATUS = { DRAFT: 'Prepared', RELEASED: 'Released to the bank', PART_CONFIRMED: 'Partly confirmed', CONFIRMED: 'Confirmed', CANCELLED: 'Cancelled' };

/** @param {{ db: any, base: any, flags: any, setup: any, runs: any, stat: any, vaultKey?: string|null, gl: () => any, posting: () => any, expenses: () => any }} o */
export function createSettleService({ db, base, flags, setup, runs, stat, vaultKey = null, gl, posting, expenses }) {
  const { may, audit, notify, number } = base;
  const vault = createVault({ secret: vaultKey ?? undefined });
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const on = (companyId) => flags.isOn({ companyId, user: 'system', roles: [] }, 'ff.pay.p2405');
  const gate = (companyId) => { if (!on(companyId)) throw unprocessable('Payroll posting and settlement are off for the company (ff.pay.p2405).'); };
  const evt = (type, actor, companyId, entity, entityId, data, projectId = null) => publishEvent(db, { type, entity, entityId, actorId: actor?.user ?? 'system', companyId, projectId, data });
  const seesPay = (actor) => may(actor, 'pay.salary.view');
  const mask = (actor, v) => (seesPay(actor) ? v : null);
  const sys = (companyId) => ({ user: 'system', userId: null, companyId, roles: ['SYSADM'] });
  const rolesOf = (companyId, user) => { try { return JSON.parse(db.prepare('SELECT roles_json FROM iam_users WHERE company_id = ? AND username = ?').get(companyId, user)?.roles_json ?? '[]').flat(); } catch { return []; } };
  const myEmployee = (actor) => { const uid = actor.userId ?? db.prepare('SELECT id FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND is_active = 1').get(actor.companyId, actor.user)?.id; return uid ? db.prepare("SELECT * FROM hr_employees WHERE company_id = ? AND user_id = ? AND deleted_at IS NULL").get(actor.companyId, uid) ?? null : null; };
  const runRow = (actor, id) => { const r = db.prepare('SELECT * FROM pay_runs WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r) throw notFound('That payroll run does not exist.'); return r; };
  const outboxOf = (type, entityId) => { const x = db.prepare('SELECT payload FROM core_outbox WHERE event_type = ? AND aggregate_id = ? ORDER BY id DESC LIMIT 1').get(type, String(entityId)); return x ? JSON.parse(x.payload) : null; };
  const logOf = (companyId, docType, docId) => db.prepare('SELECT l.*, j.doc_no AS voucher FROM fin_posting_log l LEFT JOIN fin_journals j ON j.id = l.journal_id WHERE l.company_id = ? AND l.doc_type = ? AND l.doc_id = ? ORDER BY l.id DESC LIMIT 1').get(companyId, docType, String(docId));
  const logView = (l) => (l ? { id: l.id, status: l.log_status, errorCode: l.error_code, error: l.error, journalId: l.journal_id, voucher: l.voucher ?? null, postedAt: l.posted_at, attempts: l.attempts } : null);

  // ================================================================ FR-01 posting
  const fnfRules = (companyId) => db.prepare('SELECT * FROM pay_fnf_rules WHERE (company_id = ? OR company_id IS NULL) AND deleted_at IS NULL ORDER BY effective_from').all(companyId);
  const fnfRule = (companyId, type, date) => { const r = pickRule(fnfRules(companyId), type, 'ALL', date); return r ? { ...r, p: json(r.params_json, {}) } : null; };
  /** Posts an event of this module now (an approval from before the engine took it, or one that failed): the engine's own handling, once per event. */
  function postEvent(actor, type, entityId) {
    const pe = posting(); if (!pe) throw unprocessable('The posting engine (23.02) is not running.');
    if (!flags.isOn({ companyId: actor.companyId, user: 'system', roles: [] }, 'ff.fin.p2302')) throw unprocessable('The posting engine is off for the company (ff.fin.p2302).');
    const e = outboxOf(type, entityId); if (!e || Number(e.companyId) !== actor.companyId) throw unprocessable('The approval event of this document was not found: it has not been approved yet.');
    const row = pe.handle(e, { retry: true, user: actor.user }); audit(actor, 'fin_posting_log', row?.id ?? 0, 'post', actor.companyId, { newValues: { event: type, entityId, status: row?.log_status, error: row?.error_code } }); return row;
  }
  /** The labour cost of a posted payroll or wage run to the project cost ledger (12.03 -> 14.07): one event a project, a line a site and department. */
  function onPosted(e) {
    const d = e.data ?? {}; const c = Number(e.companyId); if (!c || !['pay_runs', 'pay_wage_runs'].includes(d.docType)) return;
    if (d.docType === 'pay_wage_runs') { const r = db.prepare('SELECT * FROM pay_wage_runs WHERE id = ?').get(Number(d.docId)); if (!r) return; const x = wagePostingData(db, r.id);
      evt('hr.payroll.posted', null, c, 'pay_wage_runs', r.id, { projectId: r.org_project_id, sourceType: 'pay_wage_runs', sourceId: String(r.id), docRef: r.doc_no, date: r.period_to, lines: [{ lineId: `${r.org_site_id}`, resourceType: 'LABOUR', amount: Number(x.gross) + Number(x.employer), qty: r.days_milli / 1000, description: `Wages ${r.doc_no} ${r.period_from} to ${r.period_to}` }] }, r.org_project_id); return; }
    const r = db.prepare('SELECT * FROM pay_runs WHERE id = ?').get(Number(d.docId)); if (!r) return; const x = runPostingData(db, r.id); const by = new Map();
    for (const k of x.cost) { if (!k.projectId) continue; const l = by.get(k.projectId) ?? []; l.push({ lineId: `${k.siteId ?? ''}-${k.departmentId ?? ''}-${k.costCentreId ?? ''}`, resourceType: 'LABOUR', amount: Math.round((Number(k.salary) + Number(k.employer) + Number(k.gratuity)) * 100) / 100, qty: 0, description: `Staff payroll ${r.period} ${r.doc_no}` }); by.set(k.projectId, l); }
    for (const [projectId, lines] of by) evt('hr.payroll.posted', null, c, 'pay_runs', r.id, { projectId, sourceType: 'pay_runs', sourceId: String(r.id), docRef: r.doc_no, date: monthEnd(r.period), lines }, projectId);
  }
  const transfersOfRun = (runId) => db.prepare("SELECT * FROM pay_transfers WHERE run_id = ? AND transfer_status != 'CANCELLED' AND deleted_at IS NULL ORDER BY id").all(runId);
  const paidState = (runId) => db.prepare(`SELECT l.id, l.employee_id, l.net_paise, l.hold, l.hold_reason, l.payment_mode, e.emp_code, e.full_name, (SELECT t.line_status FROM pay_transfer_lines t WHERE t.run_line_id = l.id AND t.line_status IN ('INCLUDED', 'PAID') AND t.deleted_at IS NULL LIMIT 1) AS tstatus
    FROM pay_run_lines l JOIN hr_employees e ON e.id = l.employee_id WHERE l.run_id = ? AND l.deleted_at IS NULL ORDER BY e.emp_code`).all(runId);
  const postingSvc = {
    /** The approved runs of the company (newest first) with where each stands: posted, paid, payslips sent. */
    /** @param {any} actor @param {{ period?: string }} [q] */
    runs(actor, { period } = {}) {
      need(actor, 'pay.posting.view', 'see payroll posting');
      return db.prepare(`SELECT * FROM pay_runs WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL${period ? ' AND period = ?' : ''} ORDER BY period DESC, id DESC LIMIT 60`).all(actor.companyId, ...(period ? [period] : [])).map((r) => {
        const st = paidState(r.id); const slips = db.prepare("SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE email_status IN ('QUEUED', 'SENT')) AS sent FROM pay_payslips WHERE run_id = ? AND slip_status = 'GENERATED' AND deleted_at IS NULL").get(r.id);
        return { id: r.id, docNo: r.doc_no, period: r.period, type: r.run_type, employees: r.employees_count, net: mask(actor, rs(r.net_paise)), posting: logView(logOf(actor.companyId, 'pay_runs', r.id)), paid: st.filter((x) => x.tstatus === 'PAID').length, inTransfer: st.filter((x) => x.tstatus === 'INCLUDED').length, held: st.filter((x) => x.hold).length, payslips: slips.n, payslipsSent: slips.sent };
      });
    },
    /** The run as the posting page shows it: the journal it makes (preview, balanced), the posting, the transfers, the employees not yet paid and why, the payslips. */
    run(actor, id) {
      need(actor, 'pay.posting.view', 'see payroll posting'); const r = runRow(actor, id); if (r.status !== 'APPROVED') throw unprocessable('Only an approved, locked payroll run is posted and paid.');
      const x = runPostingData(db, r.id); const acc = (code) => db.prepare('SELECT name FROM fin_accounts WHERE company_id = ? AND code = ?').get(actor.companyId, code)?.name ?? code;
      const proj = (pid) => (pid ? db.prepare('SELECT code FROM org_projects WHERE id = ?').get(pid)?.code ?? String(pid) : 'Head office'); const site = (sid) => (sid ? db.prepare('SELECT name FROM org_sites WHERE id = ?').get(sid)?.name ?? '' : '');
      const dr = (code, amount, dims) => ({ account: code, name: acc(code), side: 'DR', amount: Number(amount), dims }); const cr = (code, amount, dims = '') => ({ account: code, name: acc(code), side: 'CR', amount: Number(amount), dims });
      const preview = [...x.cost.flatMap((c) => [dr('530001', c.salary, `${proj(c.projectId)} ${site(c.siteId)}`.trim()), dr('530003', c.employer, `${proj(c.projectId)} ${site(c.siteId)}`.trim()), dr('530004', c.gratuity, `${proj(c.projectId)} ${site(c.siteId)}`.trim())]),
        cr('230011', x.pfPayable), cr('230012', x.esiPayable), cr('230013', x.ptPayable), cr('230014', x.lwfPayable), cr('230004', x.tdsPayable), cr('230015', x.otherPayable), cr('240011', x.gratuityProvision), cr('420010', x.recoveries), ...x.advances.map((a) => cr('160002', a.amount, `employee ${a.employeeId}`)), cr('230010', x.netPayable)].filter((l) => l.amount > 0);
      const byProject = new Map(); for (const c of x.cost) { const k = proj(c.projectId); byProject.set(k, (byProject.get(k) ?? 0) + paise(c.salary) + paise(c.employer) + paise(c.gratuity)); }
      const st = paidState(r.id); const banked = new Map(db.prepare("SELECT employee_id FROM hr_employee_banks WHERE company_id = ? AND bank_status = 'ACTIVE' AND verified_status = 'VERIFIED' AND deleted_at IS NULL").all(r.company_id).map((b) => [b.employee_id, true]));
      const unpaid = st.filter((l) => !l.tstatus).map((l) => ({ lineId: l.id, employeeId: l.employee_id, employee: `${l.emp_code} ${l.full_name}`, net: mask(actor, rs(l.net_paise)), hold: Boolean(l.hold), holdReason: l.hold_reason, reason: l.hold ? 'HELD' : l.payment_mode !== 'BANK_TRANSFER' ? 'NOT_BANK' : !banked.get(l.employee_id) ? 'NO_BANK' : l.net_paise <= 0 ? 'NIL' : 'READY' }));
      const slips = db.prepare("SELECT email_status AS s, COUNT(*) AS n FROM pay_payslips WHERE run_id = ? AND slip_status = 'GENERATED' AND deleted_at IS NULL GROUP BY email_status").all(r.id);
      return { run: { id: r.id, docNo: r.doc_no, period: r.period, type: r.run_type, employees: r.employees_count, gross: mask(actor, rs(r.gross_paise)), net: mask(actor, rs(r.net_paise)), held: r.held_count, lockedAt: r.locked_at },
        posting: logView(logOf(actor.companyId, 'pay_runs', r.id)), preview: seesPay(actor) ? preview : [], totals: { debit: rs(x._check.debit), credit: rs(x._check.credit), balanced: x._check.balanced }, byProject: seesPay(actor) ? [...byProject.entries()].map(([project, amount]) => ({ project, amount: rs(amount) })) : [],
        transfers: transfersOfRun(r.id).map((t) => transferView(actor, t)), unpaid, paid: st.filter((l) => l.tstatus === 'PAID').length, inTransfer: st.filter((l) => l.tstatus === 'INCLUDED').length,
        payslips: { total: slips.reduce((a, s) => a + s.n, 0), byStatus: Object.fromEntries(slips.map((s) => [s.s, s.n])) },
        can: { post: may(actor, 'pay.posting.post'), transfer: may(actor, 'pay.transfer.create'), release: may(actor, 'pay.transfer.release'), confirm: may(actor, 'pay.transfer.confirm'), hold: may(actor, 'pay.transfer.hold'), payslips: may(actor, 'pay.payslip.generate'), email: may(actor, 'pay.payslip.distribute') } };
    },
    post(actor, id) { need(actor, 'pay.posting.post', 'post the payroll'); const r = runRow(actor, id); if (r.status !== 'APPROVED') throw unprocessable('Only an approved, locked payroll run is posted.'); gate(r.company_id); postEvent(actor, 'pay.run.approved', r.id); return postingSvc.run(actor, r.id); },
    /** The approved wage runs with the posting of the wages and of each payment. */
    /** @param {any} actor @param {{ period?: string }} [q] */
    wageRuns(actor, { period } = {}) {
      need(actor, 'pay.posting.view', 'see payroll posting');
      return db.prepare(`SELECT x.*, p.code AS pcode, s.name AS site FROM pay_wage_runs x JOIN org_projects p ON p.id = x.org_project_id JOIN org_sites s ON s.id = x.org_site_id WHERE x.company_id = ? AND x.status = 'APPROVED' AND x.deleted_at IS NULL${period ? " AND substr(x.period_to, 1, 7) = ?" : ''} ORDER BY x.period_to DESC, x.id DESC LIMIT 60`).all(actor.companyId, ...(period ? [period] : []))
        .map((r) => ({ id: r.id, docNo: r.doc_no, project: r.pcode, site: r.site, periodFrom: r.period_from, periodTo: r.period_to, workers: r.workers_count, net: mask(actor, rs(r.net_paise)), posting: logView(logOf(actor.companyId, 'pay_wage_runs', r.id)), paid: r.paid_count, payments: db.prepare("SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE log_status = 'POSTED') AS posted FROM fin_posting_log WHERE company_id = ? AND doc_type = 'pay_wage_payments' AND doc_id LIKE ?").get(actor.companyId, `${r.id}:%`) }));
    },
    postWage(actor, id) { need(actor, 'pay.posting.post', 'post the wages'); const r = db.prepare("SELECT * FROM pay_wage_runs WHERE id = ? AND company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(rid(id), actor.companyId); if (!r) throw notFound('Only an approved wage run is posted.'); gate(r.company_id); postEvent(actor, 'pay.wage_run.approved', r.id); return postingSvc.wageRuns(actor, {}).find((x) => x.id === r.id); },
    /** FR-02 salary hold handling after the lock: a salary not yet in a bank transfer is held (or released) with the reason; the amounts of the run do not change. */
    hold(actor, runId, lineId, { hold, reason }) {
      need(actor, 'pay.transfer.hold', 'hold or release salaries'); const r = runRow(actor, runId); if (r.status !== 'APPROVED') throw unprocessable('Before the approval the hold is set on the payroll run itself.');
      const l = db.prepare('SELECT * FROM pay_run_lines WHERE id = ? AND run_id = ? AND deleted_at IS NULL').get(rid(lineId), r.id); if (!l) throw notFound('That employee is not in the run.');
      if (db.prepare("SELECT 1 FROM pay_transfer_lines WHERE run_line_id = ? AND line_status IN ('INCLUDED', 'PAID') AND deleted_at IS NULL").get(l.id)) throw conflict('This salary is in a bank transfer already: take it out of the transfer first.');
      if (Boolean(l.hold) === hold) throw conflict(hold ? 'The salary is held already.' : 'The salary is not held.');
      db.prepare('UPDATE pay_run_lines SET hold = ?, hold_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(hold ? 1 : 0, hold ? reason : `Released: ${reason}`, actor.user, nowIso(), l.id);
      audit(actor, 'pay_run_lines', l.id, hold ? 'hold_after_lock' : 'release_hold', r.company_id, { reason, oldValues: { hold: Boolean(l.hold), reason: l.hold_reason } });
      if (!hold) notify(r.company_id, 'pay.settle.alert', ['permission:pay.transfer.create'], r.doc_no, 'salary released', `A held salary of ${r.period} was released (${reason}): pay it in the next bank transfer of the run.`, `/payroll/posting?run=${r.id}`, `${l.id}-rel-${Date.now()}`);
      return postingSvc.run(actor, r.id);
    },
  };

  // ================================================================ FR-02 salary bank transfers (23.04 bank file builder)
  const bankOf = (companyId, id) => db.prepare("SELECT * FROM fin_bank_accounts WHERE id = ? AND company_id = ? AND acct_status = 'ACTIVE' AND deleted_at IS NULL").get(Number(id), companyId);
  const empBank = (employeeId) => db.prepare("SELECT * FROM hr_employee_banks WHERE employee_id = ? AND bank_status = 'ACTIVE' AND verified_status = 'VERIFIED' AND deleted_at IS NULL ORDER BY is_primary DESC, id DESC LIMIT 1").get(employeeId);
  const transferView = (actor, t, detail = false) => {
    const o = { id: t.id, docNo: t.doc_no, kind: t.source_kind, runId: t.run_id, fnfId: t.fnf_id, bankAccountId: t.bank_account_id, bank: db.prepare('SELECT code, name, account_last4 FROM fin_bank_accounts WHERE id = ?').get(t.bank_account_id) ?? null, mode: t.pay_mode, payDate: t.pay_date, lines: t.lines_count, total: rs(t.total_paise), paid: rs(t.paid_paise), status: t.transfer_status, statusLabel: TRANSFER_STATUS[t.transfer_status], fileName: t.file_name, preparedBy: t.prepared_by, releasedBy: t.released_by, releasedAt: t.released_at, journalId: t.journal_id, voucher: t.journal_id ? db.prepare('SELECT doc_no FROM fin_journals WHERE id = ?').get(t.journal_id)?.doc_no ?? null : null };
    const sod = same(t.prepared_by, actor.user) || same(t.created_by, actor.user);
    o.can = { release: t.transfer_status === 'DRAFT' && may(actor, 'pay.transfer.release') && !sod, releaseBlocked: t.transfer_status === 'DRAFT' && may(actor, 'pay.transfer.release') && sod ? 'You prepared this transfer: another person releases it.' : null, cancel: t.transfer_status === 'DRAFT' && may(actor, 'pay.transfer.create'), file: t.transfer_status !== 'DRAFT' && t.transfer_status !== 'CANCELLED' && may(actor, 'pay.transfer.release'), confirm: ['RELEASED', 'PART_CONFIRMED'].includes(t.transfer_status) && may(actor, 'pay.transfer.confirm') };
    if (detail) o.items = db.prepare('SELECT l.*, e.emp_code, e.full_name FROM pay_transfer_lines l JOIN hr_employees e ON e.id = l.employee_id WHERE l.transfer_id = ? AND l.deleted_at IS NULL ORDER BY e.emp_code').all(t.id)
      .map((l) => ({ id: l.id, employeeId: l.employee_id, employee: `${l.emp_code} ${l.full_name}`, amount: mask(actor, rs(l.amount_paise)), bank: l.bank_last4 ? `••••${l.bank_last4} · ${l.bank_ifsc}` : null, nameMatch: l.name_match, status: l.line_status, utr: l.utr, paidOn: l.paid_on, reason: l.failure_reason }));
    return o;
  };
  const transferRow = (actor, id) => { const t = db.prepare('SELECT * FROM pay_transfers WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!t) throw notFound('That salary transfer does not exist.'); return t; };
  const transfers = {
    banks(actor) { need(actor, 'pay.transfer.view', 'see salary transfers'); return db.prepare("SELECT id, code, name, bank_name, account_last4, file_format FROM fin_bank_accounts WHERE company_id = ? AND acct_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY code").all(actor.companyId).map((b) => ({ id: b.id, code: b.code, name: b.name, bankName: b.bank_name, account: `••••${b.account_last4}`, format: b.file_format })); },
    /** @param {any} actor @param {{ runId?: number, fnfId?: number }} [q] */
    list(actor, { runId, fnfId } = {}) { need(actor, 'pay.transfer.view', 'see salary transfers'); return db.prepare(`SELECT * FROM pay_transfers WHERE company_id = ? AND deleted_at IS NULL${runId ? ' AND run_id = ?' : ''}${fnfId ? ' AND fnf_id = ?' : ''} ORDER BY id DESC LIMIT 200`).all(actor.companyId, ...(runId ? [Number(runId)] : []), ...(fnfId ? [Number(fnfId)] : [])).map((t) => transferView(actor, t)); },
    get(actor, id) { need(actor, 'pay.transfer.view', 'see salary transfers'); return transferView(actor, transferRow(actor, id), true); },
    /** The net pay still to pay of a locked run (held salaries, cash and cheque payees, those without a verified account left out and listed), or of a settlement. */
    create(actor, b) {
      need(actor, 'pay.transfer.create', 'prepare salary transfers'); const c = actor.companyId; gate(c);
      const bank = bankOf(c, b.bankAccountId); if (!bank) throw badRequest('Correct the highlighted fields', [{ field: 'bankAccountId', message: 'Choose an active bank account of the company.' }]);
      if (b.payDate < todayIST()) throw badRequest('Correct the highlighted fields', [{ field: 'payDate', message: 'The value date is today or later.' }]);
      let picks = []; let kind; let runId = null; let fnfId = null; const left = [];
      if (b.runId) { const r = runRow(actor, b.runId); if (r.status !== 'APPROVED') throw unprocessable('Only an approved, locked payroll run is paid.'); runId = r.id; kind = transfersOfRun(r.id).length ? 'HELD_RELEASE' : 'PAY_RUN';
        for (const l of paidState(r.id)) { if (l.tstatus) continue; const why = l.hold ? `held: ${l.hold_reason}` : l.payment_mode !== 'BANK_TRANSFER' ? `paid by ${String(l.payment_mode ?? '').toLowerCase().replace('_', ' ')}` : l.net_paise <= 0 ? 'nothing to pay' : null; if (why) { left.push({ employee: `${l.emp_code} ${l.full_name}`, reason: why }); continue; } picks.push({ employeeId: l.employee_id, runLineId: l.id, amount: l.net_paise, name: l.full_name, who: `${l.emp_code} ${l.full_name}` }); } }
      else { const f = fnfRow(actor, b.fnfId); if (f.status !== 'APPROVED') throw unprocessable('A settlement is paid once it is approved.'); if (f.pay_status !== 'UNPAID') throw conflict(`The settlement is ${PAY_STATUS[f.pay_status].toLowerCase()}.`); if (openAmendment(f.id)) throw conflict('An amendment of this settlement is open: it is paid once the amendment is decided.'); fnfId = f.id; kind = 'FNF';
        const e = db.prepare('SELECT emp_code, full_name FROM hr_employees WHERE id = ?').get(f.employee_id); picks = [{ employeeId: f.employee_id, fnfId: f.id, amount: f.payable_paise, name: e.full_name, who: `${e.emp_code} ${e.full_name}` }]; }
      const rows = []; for (const p of picks) { const bk = empBank(p.employeeId); if (!bk) { left.push({ employee: p.who, reason: 'no verified bank account' }); continue; } const m = nameMatch(p.name, bk.account_name, Number(base.param(c, 'fin.pmt.name_match_pct') ?? 60)); if (!m.ok) { left.push({ employee: p.who, reason: `the name on the bank account (${bk.account_name}) does not match` }); continue; } rows.push({ ...p, bank: bk }); }
      if (!rows.length) throw unprocessable(`Nothing to pay by bank transfer${left.length ? `: ${left.slice(0, 5).map((x) => `${x.employee} (${x.reason})`).join('; ')}` : ''}.`);
      if (b.mode === 'RTGS' && rows.some((x) => x.amount < Number(base.param(c, 'fin.pmt.rtgs_min') ?? 200000) * 100)) throw badRequest('Correct the highlighted fields', [{ field: 'mode', message: 'RTGS carries payments of ₹2 lakh or more: use NEFT.' }]);
      return transaction(db, () => {
        const total = rows.reduce((a, x) => a + x.amount, 0);
        const id = Number(db.prepare("INSERT INTO pay_transfers (company_id, doc_no, source_kind, run_id, fnf_id, bank_account_id, pay_mode, pay_date, lines_count, total_paise, transfer_status, prepared_by, created_by, source_type, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, 'api', ?)")
          .run(c, number(c, actor.user, 'PAY_TRANSFER', 'pay_transfers', 'SAL'), kind, runId, fnfId, bank.id, b.mode, b.payDate, rows.length, total, actor.user, actor.user, left.length ? JSON.stringify(left) : null).lastInsertRowid);
        const ins = db.prepare("INSERT INTO pay_transfer_lines (company_id, transfer_id, employee_id, run_line_id, fnf_id, amount_paise, employee_bank_id, bank_last4, bank_ifsc, account_name, name_match, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MATCH', ?, 'api')");
        for (const x of rows) { try { ins.run(c, id, x.employeeId, x.runLineId ?? null, x.fnfId ?? null, x.amount, x.bank.id, x.bank.account_last4, x.bank.ifsc, x.bank.account_name, actor.user); } catch (er) { if (/UNIQUE/.test(String(er.message))) throw conflict(`${x.who} is in another salary transfer already.`); throw er; } }
        if (fnfId) db.prepare("UPDATE pay_fnf SET pay_status = 'IN_TRANSFER', updated_at = ? WHERE id = ?").run(nowIso(), fnfId);
        audit(actor, 'pay_transfers', id, 'create', c, { newValues: { kind, runId, fnfId, lines: rows.length, total: rs(total), left: left.length } });
        notify(c, 'pay.settle.alert', ['permission:pay.transfer.release'], `SAL ${id}`, 'ready to release', `A salary transfer of ${rows.length} employee(s), ${money(total)}, is ready: release it to the bank (a person other than ${actor.user}).`, `/payroll/posting?transfer=${id}`, `${id}-ready`);
        return { ...transfers.get(actor, id), left };
      });
    },
    cancel(actor, id, { reason }) { need(actor, 'pay.transfer.create', 'cancel salary transfers'); const t = transferRow(actor, id); if (t.transfer_status !== 'DRAFT') throw conflict('A transfer released to the bank is not cancelled: confirm its lines as returned instead.');
      transaction(db, () => { db.prepare("UPDATE pay_transfers SET transfer_status = 'CANCELLED', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), t.id); db.prepare("UPDATE pay_transfer_lines SET line_status = 'REMOVED', updated_at = ? WHERE transfer_id = ?").run(nowIso(), t.id); if (t.fnf_id) db.prepare("UPDATE pay_fnf SET pay_status = 'UNPAID', updated_at = ? WHERE id = ?").run(nowIso(), t.fnf_id); audit(actor, 'pay_transfers', t.id, 'cancel', t.company_id, { reason }); });
      return transfers.get(actor, t.id); },
    /** Released by a person other than the preparer: the bank file is built in the account's template and checked before it is kept; the payment is posted. */
    release(actor, id) {
      need(actor, 'pay.transfer.release', 'release salary transfers'); const t = transferRow(actor, id); gate(t.company_id);
      if (t.transfer_status !== 'DRAFT') throw conflict('This transfer was released already.'); if (same(t.prepared_by, actor.user) || same(t.created_by, actor.user)) throw forbidden('You prepared this transfer: another person releases it (segregation of duties).');
      const bank = bankOf(t.company_id, t.bank_account_id); if (!bank) throw unprocessable('The bank account of the transfer is no longer active: cancel the transfer and prepare it again.');
      const tpl = templateOf(bank); const lines = db.prepare("SELECT l.*, e.emp_code, e.email FROM pay_transfer_lines l JOIN hr_employees e ON e.id = l.employee_id WHERE l.transfer_id = ? AND l.line_status = 'INCLUDED' AND l.deleted_at IS NULL ORDER BY l.id").all(t.id);
      const debitAccount = vault.decrypt(bank.account_no_enc, `fin_bank_account/${bank.company_id}/${bank.code}`);
      const recs = lines.map((l, i) => { const bk = db.prepare('SELECT * FROM hr_employee_banks WHERE id = ?').get(l.employee_bank_id); if (!bk || bk.bank_status !== 'ACTIVE') throw unprocessable(`The bank account of ${l.emp_code} changed after the transfer was prepared: cancel it and prepare it again.`);
        return { seq: i + 1, mode: t.pay_mode, amountPaise: l.amount_paise, valueDate: t.pay_date, beneficiaryName: bk.account_name, accountNo: String(vault.decrypt(bk.account_enc, `hr_employee_bank/${t.company_id}/${l.employee_id}`)).replace(/\s/g, ''), ifsc: bk.ifsc, reference: `${t.doc_no.replaceAll('/', '')}${String(i + 1).padStart(4, '0')}`, debitAccount, email: l.email ?? '', purpose: t.source_kind === 'FNF' ? 'Full and final settlement' : 'Salary' }; });
      const text = buildBankFile(tpl, recs); const problems = validateBankFile(tpl, text, { count: recs.length, totalPaise: recs.reduce((a, x) => a + x.amountPaise, 0) });
      if (problems.length) throw unprocessable(`The bank file did not pass its check, so it is not released: ${problems.join(' ')}`);
      const total = recs.reduce((a, x) => a + x.amountPaise, 0); const today = t.pay_date;
      return transaction(db, () => {
        const pay = gl()?.postEngine(t.company_id, { voucherType: 'PV', date: today, narration: `Salary transfer ${t.doc_no}: ${recs.length} employee(s) by ${t.pay_mode}`, sourceType: 'pay_transfers', sourceId: String(t.id), user: actor.user, lines: [{ accountId: db.prepare("SELECT id FROM fin_accounts WHERE company_id = ? AND code = '230010'").get(t.company_id)?.id, debit: s2(total) }, { accountId: bank.gl_account_id, credit: s2(total) }] });
        db.prepare("UPDATE pay_transfers SET transfer_status = 'RELEASED', file_name = ?, file_text = ?, file_hash = ?, released_by = ?, released_at = ?, journal_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?")
          .run(`${t.doc_no.replaceAll('/', '-')}-${bank.code}-${t.pay_mode}.${tpl.delimiter === ',' ? 'csv' : 'txt'}`, text, createHash('sha256').update(text).digest('hex'), actor.user, nowIso(), pay?.journal?.id ?? null, actor.user, nowIso(), t.id);
        audit(actor, 'pay_transfers', t.id, 'release', t.company_id, { newValues: { lines: recs.length, total: rs(total), journal: pay?.journal?.id ?? null } });
        evt('pay.salary.released', actor, t.company_id, 'pay_transfers', t.id, { transferId: t.id, docNo: t.doc_no, kind: t.source_kind, runId: t.run_id, fnfId: t.fnf_id, lines: recs.length, amount: rs(total), payDate: t.pay_date, journalId: pay?.journal?.id ?? null });
        return transfers.get(actor, t.id);
      });
    },
    file(actor, id) { need(actor, 'pay.transfer.release', 'download the bank file'); const t = transferRow(actor, id); if (!t.file_text) throw unprocessable('The bank file is made when the transfer is released.'); audit(actor, 'pay_transfers', t.id, 'export', t.company_id, { reason: 'bank file downloaded' }); return { contentType: t.file_name.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8', fileName: t.file_name, buffer: Buffer.from(t.file_text, 'utf8') }; },
    /** The bank's confirmation, line by line: paid with the UTR, or returned (the payment reversed: the salary is payable again and can go in a new transfer). */
    confirm(actor, id, { rows }) {
      need(actor, 'pay.transfer.confirm', 'confirm salary transfers'); const t = transferRow(actor, id); if (!['RELEASED', 'PART_CONFIRMED'].includes(t.transfer_status)) throw conflict('Only a transfer released to the bank is confirmed.');
      const bank = db.prepare('SELECT * FROM fin_bank_accounts WHERE id = ?').get(t.bank_account_id); const results = [];
      transaction(db, () => {
        for (const row of rows) {
          const l = db.prepare('SELECT l.*, e.emp_code, e.full_name FROM pay_transfer_lines l JOIN hr_employees e ON e.id = l.employee_id WHERE l.id = ? AND l.transfer_id = ? AND l.deleted_at IS NULL').get(row.lineId, t.id);
          if (!l) { results.push({ lineId: row.lineId, ok: false, message: 'Not a line of this transfer.' }); continue; } if (l.line_status !== 'INCLUDED') { results.push({ lineId: l.id, ok: false, message: `Already ${l.line_status.toLowerCase()}.` }); continue; }
          if (row.paidOn < t.pay_date) { results.push({ lineId: l.id, ok: false, message: 'The date is before the value date of the transfer.' }); continue; }
          if (row.status === 'PAID') {
            db.prepare("UPDATE pay_transfer_lines SET line_status = 'PAID', utr = ?, paid_on = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(row.utr, row.paidOn, actor.user, nowIso(), l.id);
            if (l.fnf_id) { const f = db.prepare('SELECT * FROM pay_fnf WHERE id = ?').get(l.fnf_id); const late = f.due_date && row.paidOn > f.due_date ? 1 : 0; db.prepare("UPDATE pay_fnf SET pay_status = 'PAID', paid_on = ?, late = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(row.paidOn, late, nowIso(), f.id);
              evt('pay.fnf.paid', actor, t.company_id, 'pay_fnf', f.id, { fnfId: f.id, docNo: f.doc_no, employeeId: f.employee_id, separationId: f.separation_id, amount: rs(l.amount_paise), paidOn: row.paidOn, utr: row.utr, late: Boolean(late) });
              notify(t.company_id, 'pay.fnf.decided', ['permission:hr.separation.letter'], f.doc_no, 'paid', `The full and final of ${l.emp_code} ${l.full_name} is paid (UTR ${row.utr})${late ? ', after its due date' : ''}: issue the relieving letter.`, `/payroll/fnf?id=${f.id}`, `${f.id}-paid`); }
            results.push({ lineId: l.id, ok: true, message: 'Paid' });
          } else {
            const rev = gl()?.postEngine(t.company_id, { voucherType: 'JV', date: row.paidOn, narration: `Salary returned by the bank: ${t.doc_no} ${l.emp_code} (${row.reason})`, sourceType: 'pay_transfer_lines', sourceId: String(l.id), user: actor.user, lines: [{ accountId: bank.gl_account_id, debit: s2(l.amount_paise) }, { accountId: db.prepare("SELECT id FROM fin_accounts WHERE company_id = ? AND code = '230010'").get(t.company_id)?.id, credit: s2(l.amount_paise) }] });
            db.prepare("UPDATE pay_transfer_lines SET line_status = 'FAILED', failure_reason = ?, paid_on = ?, reversal_journal_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(row.reason, row.paidOn, rev?.journal?.id ?? null, actor.user, nowIso(), l.id);
            if (l.fnf_id) db.prepare("UPDATE pay_fnf SET pay_status = 'UNPAID', updated_at = ? WHERE id = ?").run(nowIso(), l.fnf_id);
            evt('pay.salary.returned', actor, t.company_id, 'pay_transfer_lines', l.id, { transferId: t.id, docNo: t.doc_no, employeeId: l.employee_id, amount: rs(l.amount_paise), reason: row.reason });
            notify(t.company_id, 'pay.settle.alert', ['permission:pay.transfer.create'], t.doc_no, 'returned by the bank', `The salary of ${l.emp_code} ${l.full_name} (${money(l.amount_paise)}) was returned: ${row.reason}. Correct the bank account and pay it in a new transfer.`, `/payroll/posting?transfer=${t.id}`, `${l.id}-failed`);
            results.push({ lineId: l.id, ok: true, message: 'Returned and reversed' });
          }
        }
        const s = db.prepare("SELECT COUNT(*) FILTER (WHERE line_status = 'INCLUDED') AS open, COALESCE(SUM(CASE WHEN line_status = 'PAID' THEN amount_paise END), 0) AS paid FROM pay_transfer_lines WHERE transfer_id = ? AND deleted_at IS NULL").get(t.id);
        db.prepare('UPDATE pay_transfers SET transfer_status = ?, paid_paise = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(s.open ? 'PART_CONFIRMED' : 'CONFIRMED', s.paid, actor.user, nowIso(), t.id);
        audit(actor, 'pay_transfers', t.id, 'confirm', t.company_id, { newValues: { rows: rows.length, paid: results.filter((x) => x.message === 'Paid').length, returned: results.filter((x) => x.message !== 'Paid' && x.ok).length } });
        if (!s.open) evt('pay.salary.paid', actor, t.company_id, 'pay_transfers', t.id, { transferId: t.id, docNo: t.doc_no, kind: t.source_kind, runId: t.run_id, fnfId: t.fnf_id, paid: rs(s.paid) });
      });
      return { results, transfer: transfers.get(actor, t.id) };
    },
  };

  // ================================================================ FR-03 payslips (04.11 templates, password-protected)
  /** The password of an employee's payslips: the employee code in capitals and the date of birth as DDMMYYYY (told in the e-mail, never sent). */
  const passwordOf = (e) => `${String(e.emp_code).toUpperCase()}${e.dob ? `${e.dob.slice(8, 10)}${e.dob.slice(5, 7)}${e.dob.slice(0, 4)}` : ''}`;
  const langOf = (e, asked) => { if (asked && asked !== 'auto') return asked; const l = json(e.languages_json, []).map((x) => String(x?.code ?? x).toLowerCase()); return l[0] === 'hi' || (l.includes('hi') && !l.includes('en')) ? 'hi' : 'en'; };
  async function slipOne(r, l, lang, reason) {
    const tpl = templateServiceOf(db); if (!tpl) throw unprocessable('The document templates (04.11) are not running.');
    const e = db.prepare('SELECT e.*, d.name AS dept, g.name AS designation FROM hr_employees e LEFT JOIN org_departments d ON d.id = e.department_id LEFT JOIN org_designations g ON g.id = e.designation_id WHERE e.id = ?').get(l.employee_id);
    const st = db.prepare('SELECT pan_last4 FROM hr_employee_statutory WHERE employee_id = ? AND deleted_at IS NULL').get(e.id); const bk = empBank(e.id);
    const comps = json(l.components_json, []); const fmt = (c) => ({ label: c.name, amount: Number(c.amount).toFixed(2) });
    const data = { docDate: monthEnd(r.period), employee: { name: e.full_name, code: e.emp_code }, designation: e.designation ?? '', department: e.dept ?? '', month: monthLabel(r.period), daysPaid: l.payable_days, pan: st?.pan_last4 ? `XXXXXX${st.pan_last4}` : '', bank: { account: bk ? `XXXXXX${bk.account_last4}` : '' },
      lines: comps.filter((c) => (c.type === 'EARNING' || c.type === 'REIMBURSEMENT') && c.amount > 0).map(fmt), deductions: comps.filter((c) => c.type === 'DEDUCTION' && c.amount > 0).map(fmt) };
    const entityId = `PSL-${r.id}-${e.id}`; const s = sys(r.company_id); const docNo = `PSL/${r.period}/${e.emp_code}${r.run_type === 'SUPPLEMENTARY' ? `/S${r.id}` : ''}`;
    tpl.records.publish(s, { docType: 'PAYSLIP', entityId, docNo, approved: true, data, reason });
    const g = await tpl.generate(s, { docType: 'PAYSLIP', entityId, templateCode: lang === 'hi' ? 'PAYSLIP_HI' : undefined, password: passwordOf(e), reason, purpose: 'OFFICIAL' }, { internal: true });
    return transaction(db, () => { db.prepare("UPDATE pay_payslips SET slip_status = 'SUPERSEDED', updated_at = ? WHERE run_id = ? AND employee_id = ? AND slip_status = 'GENERATED'").run(nowIso(), r.id, e.id);
      return Number(db.prepare("INSERT INTO pay_payslips (company_id, run_id, run_line_id, employee_id, period, lang, generated_doc_id, file_id, net_paise, protected, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'system', 'pay_runs')").run(r.company_id, r.id, l.id, e.id, r.period, lang, g.id, g.fileId, l.net_paise).lastInsertRowid); });
  }
  async function slipsOf(actor, r, { employeeIds, lang = 'auto' }, onProgress = null) {
    const lines = db.prepare(`SELECT * FROM pay_run_lines WHERE run_id = ? AND deleted_at IS NULL${employeeIds?.length ? ` AND employee_id IN (${employeeIds.map(Number).join(',')})` : ''} ORDER BY id`).all(r.id);
    const done = []; const failed = [];
    for (const [i, l] of lines.entries()) {
      if (onProgress) onProgress(i, lines.length);
      const e = db.prepare('SELECT emp_code, languages_json FROM hr_employees WHERE id = ?').get(l.employee_id); const prev = db.prepare("SELECT 1 FROM pay_payslips WHERE run_id = ? AND employee_id = ? AND slip_status = 'GENERATED'").get(r.id, l.employee_id);
      try { done.push(await slipOne(r, l, langOf(e, lang), prev ? `Payslip of ${r.period} generated again by ${actor.user}` : undefined)); } catch (x) { failed.push({ employee: e.emp_code, message: [x.message, ...(x.details ?? []).map((p) => `${p.field}: ${p.message}`)].join(' ') }); }
    }
    audit(actor, 'pay_runs', r.id, 'payslips', r.company_id, { newValues: { generated: done.length, failed: failed.length } });
    if (done.length) evt('pay.payslip.published', actor, r.company_id, 'pay_runs', r.id, { runId: r.id, docNo: r.doc_no, period: r.period, payslips: done.length });
    return { generated: done.length, failed };
  }
  const slipView = (actor, p) => ({ id: p.id, runId: p.run_id, employeeId: p.employee_id, employee: p.emp_code ? `${p.emp_code} ${p.full_name}` : null, period: p.period, lang: p.lang, net: mask(actor, rs(p.net_paise)), protected: Boolean(p.protected), email: p.email_status, emailTo: p.email_to ? p.email_to.replace(/^(.).*(@.*)$/, '$1•••$2') : null, emailError: p.email_error, emailedAt: p.emailed_at, viewedAt: p.viewed_at, views: p.view_count, generatedAt: p.created_at });
  const payslips = {
    /** FR-03: the payslips of an approved run (a large run as a background job with progress). */
    async generate(actor, b) {
      need(actor, 'pay.payslip.generate', 'generate payslips'); const r = runRow(actor, b.runId); if (r.status !== 'APPROVED') throw unprocessable('Payslips are generated from an approved, locked payroll run.'); gate(r.company_id);
      const n = b.employeeIds?.length ?? db.prepare('SELECT COUNT(*) AS n FROM pay_run_lines WHERE run_id = ? AND deleted_at IS NULL').get(r.id).n; const limit = Number(base.param(r.company_id, 'pay.payslip.async_count') ?? 50); const jobs = runtimeOf(db)?.jobs;
      if (jobs && n > limit) { const job = jobs.enqueue('pay.payslips.generate', { runId: r.id, user: actor.user, employeeIds: b.employeeIds ?? null, lang: b.lang }, { createdBy: actor.user, companyId: r.company_id }); audit(actor, 'pay_runs', r.id, 'payslips_queued', r.company_id, { newValues: { jobId: job.jobId, employees: n } }); return { queued: true, jobId: job.jobId, employees: n }; }
      return { queued: false, ...(await slipsOf(actor, r, b)) };
    },
    async job(ctx) {
      const r = db.prepare('SELECT * FROM pay_runs WHERE id = ?').get(Number(ctx.params.runId)); if (!r) return { skipped: true }; const actor = { user: ctx.params.user, roles: rolesOf(r.company_id, ctx.params.user), companyId: r.company_id };
      const out = await slipsOf(actor, r, { employeeIds: ctx.params.employeeIds ?? undefined, lang: ctx.params.lang }, (d, t) => { ctx.setProgress(t ? (d * 100) / t : 100, `${d} of ${t} payslips`); ctx.throwIfCancelled(); });
      notify(r.company_id, 'pay.settle.alert', [`user:${ctx.params.user}`], r.doc_no, 'payslips ready', `${out.generated} payslip(s) of ${r.period} are ready${out.failed.length ? `; ${out.failed.length} could not be made` : ''}. Send them by e-mail from the posting page.`, `/payroll/posting?run=${r.id}`, `${r.id}-slips-${ctx.jobId}`); return out;
    },
    /** E-mail each payslip (a signed link to the protected PDF, through the delivery of 04.11); the employee's own address from the employee record. */
    email(actor, b) {
      need(actor, 'pay.payslip.distribute', 'send payslips'); const r = runRow(actor, b.runId); gate(r.company_id); const tpl = templateServiceOf(db); if (!tpl) throw unprocessable('The document templates (04.11) are not running.');
      const rows = db.prepare(`SELECT p.*, e.emp_code, e.full_name, e.email FROM pay_payslips p JOIN hr_employees e ON e.id = p.employee_id WHERE p.run_id = ? AND p.slip_status = 'GENERATED' AND p.deleted_at IS NULL${b.employeeIds?.length ? ` AND p.employee_id IN (${b.employeeIds.map(Number).join(',')})` : ''}`).all(r.id);
      if (!rows.length) throw unprocessable('Generate the payslips first.'); const out = { sent: 0, noAddress: 0, blocked: 0 };
      for (const p of rows) {
        if (!p.email) { db.prepare("UPDATE pay_payslips SET email_status = 'NO_ADDRESS', updated_at = ? WHERE id = ?").run(nowIso(), p.id); out.noAddress += 1; continue; }
        const d = tpl.delivery.send(sys(r.company_id), p.generated_doc_id, { channel: 'EMAIL', recipients: [p.email], subject: `Payslip for ${monthLabel(r.period)}`, message: `Dear ${p.full_name},\n\nYour payslip for ${monthLabel(r.period)} is attached. It opens with a password: your employee code in capital letters followed by your date of birth as DDMMYYYY (for example E0412 and 15 August 1990 give E041215081990).` }, { internal: true }).deliveries[0];
        const ok = d && d.status !== 'BLOCKED'; db.prepare('UPDATE pay_payslips SET email_status = ?, email_to = ?, email_error = ?, emailed_at = ?, delivery_id = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(ok ? 'QUEUED' : 'BLOCKED', p.email, ok ? null : d?.error ?? 'Not sent', ok ? nowIso() : null, d?.id ?? null, nowIso(), p.id); if (ok) out.sent += 1; else out.blocked += 1;
      }
      audit(actor, 'pay_runs', r.id, 'payslips_email', r.company_id, { newValues: out }); return out;
    },
    /** The distribution status of the payslips of a run. */
    list(actor, { runId }) { need(actor, 'pay.payslip.view', 'see payslips'); const r = runRow(actor, runId);
      const rows = db.prepare("SELECT p.*, e.emp_code, e.full_name FROM pay_payslips p JOIN hr_employees e ON e.id = p.employee_id WHERE p.run_id = ? AND p.slip_status = 'GENERATED' AND p.deleted_at IS NULL ORDER BY e.emp_code").all(r.id).map((p) => slipView(actor, p));
      const sync = db.prepare("SELECT d.status FROM tpl_deliveries d WHERE d.id = ?"); for (const p of rows) { if (p.email === 'QUEUED') { const id = db.prepare('SELECT delivery_id FROM pay_payslips WHERE id = ?').get(p.id)?.delivery_id; const s = id ? sync.get(id)?.status : null; if (s && ['SENT', 'DELIVERED', 'READ'].includes(s)) p.email = 'SENT'; else if (s === 'FAILED') p.email = 'FAILED'; } }
      return { run: { id: r.id, docNo: r.doc_no, period: r.period, employees: r.employees_count }, rows, counts: { generated: rows.length, emailed: rows.filter((x) => ['QUEUED', 'SENT'].includes(x.email)).length, noAddress: rows.filter((x) => x.email === 'NO_ADDRESS').length, viewed: rows.filter((x) => x.viewedAt).length } }; },
    /** Self-service: the employee's own payslips. */
    mine(actor) { need(actor, 'pay.payslip.own', 'see your payslips'); const e = myEmployee(actor); if (!e) throw unprocessable('Your user account is not linked to an employee record. Ask HR to link it.');
      return { employee: `${e.emp_code} ${e.full_name}`, passwordHint: 'Your employee code in capitals followed by your date of birth as DDMMYYYY', rows: db.prepare("SELECT p.*, r.doc_no FROM pay_payslips p JOIN pay_runs r ON r.id = p.run_id WHERE p.employee_id = ? AND p.slip_status = 'GENERATED' AND p.deleted_at IS NULL ORDER BY p.period DESC, p.id DESC LIMIT 36").all(e.id).map((p) => ({ id: p.id, period: p.period, month: monthLabel(p.period), lang: p.lang, net: rs(p.net_paise), run: p.doc_no, viewedAt: p.viewed_at })) }; },
    /** The protected PDF: to the employee themself (the view is recorded) or to payroll. */
    async download(actor, id) {
      const p = db.prepare('SELECT * FROM pay_payslips WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!p) throw notFound('That payslip does not exist.');
      const own = may(actor, 'pay.payslip.own') && myEmployee(actor)?.id === p.employee_id; if (!own && !may(actor, 'pay.payslip.view')) throw notFound('That payslip does not exist.');
      if (own) db.prepare('UPDATE pay_payslips SET viewed_at = COALESCE(viewed_at, ?), view_count = view_count + 1 WHERE id = ?').run(nowIso(), p.id);
      audit(actor, 'pay_payslips', p.id, own ? 'view_own' : 'download', p.company_id);
      return templateServiceOf(db).generated.content(sys(p.company_id), p.generated_doc_id, { download: true });
    },
  };

  // ================================================================ FR-04 full-and-final settlement
  const openAmendment = (id) => Boolean(db.prepare("SELECT 1 FROM pay_fnf WHERE amends_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(id));
  const fnfRow = (actor, id, key = 'pay.fnf.view') => { const f = db.prepare('SELECT * FROM pay_fnf WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!f || !may(actor, key)) throw notFound('That settlement does not exist.'); return f; };
  const flow = createFlow({ db, base, docType: FNF_DOC, table: 'pay_fnf', perm: 'pay.fnf', label: 'full and final settlement', route: '/payroll/fnf?id=', where: () => ({ pid: null, sid: null }),
    ctx: (r) => ({ total: rs(r.net_paise), makerRole: 'PAY' }), title: (r) => `Full and final ${db.prepare('SELECT emp_code, full_name FROM hr_employees WHERE id = ?').get(r.employee_id)?.emp_code ?? ''}: net ₹${rs(r.net_paise)}`, notifyCode: 'pay.fnf.decided', prefix: 'FNF',
    beforeSubmit: (_a, r) => { gate(r.company_id); const w = json(r.working_json, {}); if (w.blockers?.length) throw unprocessable(`The settlement cannot be sent yet: ${w.blockers.join('; ')}.`); if (!r.computed_at) throw unprocessable('Compute the settlement first.');
      const sep = db.prepare('SELECT status FROM hr_separations WHERE id = ?').get(r.separation_id); if (sep?.status !== 'SETTLED') throw unprocessable('The clearance of the leaver is not complete (BR-01): the full-and-final inputs have not been released by HR.'); },
    onApproved: (actor, r) => approved(actor, db.prepare('SELECT * FROM pay_fnf WHERE id = ?').get(r.id)) });
  /** BR-01 and the inputs: the separation (07.13) with its released inputs, the employee, the last approved payroll. */
  function inputsOf(companyId, sepId) {
    const s = db.prepare('SELECT * FROM hr_separations WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(sepId), companyId); if (!s) throw notFound('That separation does not exist.');
    if (s.status !== 'SETTLED' || !s.fnf_json) throw unprocessable('The full-and-final is computed only after the clearance is complete and HR has released the inputs (BR-01).');
    return { s, x: json(s.fnf_json, {}), e: db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(s.employee_id) };
  }
  /** Computes the settlement: every figure from the engines and the dated rules; blockers listed. */
  function compute(f) {
    const c = f.company_id; const { s, x, e } = inputsOf(c, f.separation_id); const lwd = s.last_working_day; const lwdP = lwd.slice(0, 7); const blockers = [];
    // the months not paid by a payroll run, up to the last working day (at most three)
    const lastPaid = db.prepare("SELECT MAX(r.period) AS p FROM pay_run_lines l JOIN pay_runs r ON r.id = l.run_id WHERE l.employee_id = ? AND r.status = 'APPROVED' AND l.deleted_at IS NULL AND r.deleted_at IS NULL").get(e.id).p;
    const periods = []; for (let p = lastPaid ? addMonths(lastPaid, 1) : lwdP; p <= lwdP && periods.length < 3; p = addMonths(p, 1)) periods.push(p);
    if (lastPaid && addMonths(lastPaid, 3) < lwdP) blockers.push(`No approved payroll since ${lastPaid}: run the payroll of the months before the last one`);
    const last = { periods: [], earnings: [], deductions: [], employer: [], used: [] };
    for (const p of periods) {
      const inRun = db.prepare("SELECT r.doc_no, r.status FROM pay_run_lines l JOIN pay_runs r ON r.id = l.run_id WHERE l.employee_id = ? AND r.period = ? AND r.status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND l.deleted_at IS NULL AND r.deleted_at IS NULL LIMIT 1").get(e.id, p);
      if (inRun) { blockers.push(`The payroll ${inRun.doc_no} of ${p} includes the employee and is not approved: approve it (the month is paid there) or take the employee out`); continue; }
      const out = runs.computeEmployee(c, { ...e, last_working_date: lwd }, p, null, null);
      if (out.excluded) { blockers.push(`The last salary of ${p} cannot be computed: ${out.excluded === 'ATTENDANCE_NOT_LOCKED' ? 'the attendance of the month is not locked' : out.excluded === 'NO_ATTENDANCE' ? 'there is no attendance for the month' : 'no pay assignment is in force'}`); continue; }
      last.periods.push(p); last.used.push(out.line.used); const tx = new Set(out.line.breakup.lines.filter((l) => l.taxable).map((l) => l.code));
      for (const l of out.line.breakup.lines) { if (!l.amount) continue; const item = { code: l.code, name: l.name, amount: l.amount, taxable: l.type === 'EARNING' ? tx.has(l.code) : false }; if (l.type === 'EARNING' || l.type === 'REIMBURSEMENT') last.earnings.push({ ...item, taxable: l.type === 'EARNING' && item.taxable }); else if (l.type === 'DEDUCTION') last.deductions.push(item); else last.employer.push(item); }
    }
    // the monthly pay from the last approved run line (the full month)
    const ll = db.prepare("SELECT l.components_json, l.wages_json, l.days_in_month, l.payable_days FROM pay_run_lines l JOIN pay_runs r ON r.id = l.run_id WHERE l.employee_id = ? AND r.status = 'APPROVED' AND r.run_type = 'REGULAR' AND l.deleted_at IS NULL ORDER BY r.period DESC, r.id DESC LIMIT 1").get(e.id);
    const lc = json(ll?.components_json, []); const full = (code) => Number(lc.find((k) => k.code === code)?.full ?? lc.find((k) => k.code === code)?.amount ?? 0);
    const grossFull = lc.filter((k) => k.type === 'EARNING').reduce((a, k) => a + Number(k.full ?? k.amount ?? 0), 0); const wj = json(ll?.wages_json, {}); const scale = ll && ll.payable_days > 0 ? ll.days_in_month / ll.payable_days : 1;
    const monthly = { gross: Math.round(grossFull * 100) / 100, basicDa: full('BASIC') + full('DA'), codeWages: wj.codeWages ? Math.round(Number(wj.codeWages) * scale * 100) / 100 : full('BASIC') + full('DA') };
    if (!ll) blockers.push('No approved payroll of the employee to read the monthly pay from');
    // the dated rules
    const rl = (t) => fnfRule(c, t, lwd); const rules = { eligibility: rl('GRATUITY_ELIGIBILITY')?.p, gratuityCapPaise: stat?.rule(c, 'GRATUITY_CAP', 'ALL', lwd)?.p.capPaise ?? 200000000, gratuityExemptCapPaise: rl('GRATUITY_EXEMPT')?.p.capPaise ?? 200000000, leaveExempt: rl('LEAVE_ENC_EXEMPT')?.p, basis: rl('FNF_BASIS')?.p };
    for (const [k, v] of Object.entries({ GRATUITY_ELIGIBILITY: rules.eligibility, LEAVE_ENC_EXEMPT: rules.leaveExempt, FNF_BASIS: rules.basis })) if (!v) blockers.push(`No settlement rule ${k} is in force on ${lwd}`);
    // bonus of the year so far
    const fy = fyOf(lwdP); let bonus = null; const rate = f.bonus_rate_bp != null ? f.bonus_rate_bp / 100 : null;
    try { const bo = stat?.bonusOf(c, fy.code, rate); const row = bo?.rows.find((r0) => r0.employee.startsWith(`${e.emp_code} `)); if (row) bonus = { eligible: row.eligible && row.bonus > 0, amount: row.bonus, rate: bo.pct }; } catch (er) { blockers.push(`Bonus: ${er.message}`); }
    // tax of the year
    const ytd = db.prepare("SELECT COALESCE(SUM(l.taxable_paise), 0) AS t, COALESCE(SUM(l.tds_paise), 0) AS d FROM pay_run_lines l JOIN pay_runs r ON r.id = l.run_id WHERE l.employee_id = ? AND r.status = 'APPROVED' AND r.period >= ? AND r.period <= ? AND l.deleted_at IS NULL AND r.deleted_at IS NULL").get(e.id, fy.start, lwdP);
    const ytdTaxable = rs(ytd.t); const ytdTds = rs(ytd.d);
    const decl = db.prepare('SELECT * FROM pay_tax_declarations WHERE employee_id = ? AND fy = ? AND deleted_at IS NULL').get(e.id, fy.code); const regime = decl?.regime ?? 'NEW';
    const params = setup.paramsAt(c, regime === 'OLD' ? 'TDS_OLD' : 'TDS_NEW', null, lwd); const ver = decl ? json(decl.decl_status === 'VERIFIED' ? decl.verified_json : decl.declarations_json, {}) : {};
    const pfMonth = Number(lc.find((k) => k.code === 'PF_EE')?.amount ?? 0); const ptMonth = Number(lc.find((k) => k.code === 'PT')?.amount ?? 0);
    // pending recoveries entered for payroll that no run will now take (loss recoveries 16.09, other recoveries)
    const usedInputs = new Set(last.used.flatMap((u) => u.inputs ?? [])); const pendingInputs = db.prepare("SELECT * FROM pay_inputs WHERE employee_id = ? AND company_id = ? AND input_status = 'PENDING' AND component_code IN ('RECOVERY', 'LOAN') AND deleted_at IS NULL").all(e.id, c).filter((i) => !usedInputs.has(i.id));
    const advInLast = last.used.flatMap((u) => u.advances ?? []).reduce((a, v) => a + Number(v.amount ?? 0), 0);
    const advBalance = Math.max(0, Number(x.recoveries?.advances ?? 0) - advInLast);
    const input = { lastSalary: last.periods.length ? last : null, monthly, leaveDays: Number(x.leaveEncashmentDays ?? 0), noticeRecoveryDays: Number(x.notice?.recoveryDays ?? 0), noticePayDays: Number(x.notice?.payInLieuDays ?? 0), service: { doj: e.doj, lwd, employmentType: e.employment_type }, rules, bonus,
      recoveries: { advances: advBalance, items: (x.recoveries?.items ?? []).map((it) => ({ label: `${it.item} (${it.department})`, amount: Number(it.amount ?? 0) })), inputs: pendingInputs.map((i) => ({ id: i.id, label: i.note ?? i.component_code, code: i.component_code, amount: rs(i.amount_paise) })) },
      adjustments: json(f.adjustments_json, []), tax: params ? { params, ytdTaxable, ytdTds, deductions: regimeDeductions(regime, ver, pfMonth * 12, ptMonth * 12) } : null };
    if (blockers.length) return { blockers, input, result: null };
    const res = fnfCompute(input); const due = (() => { const r0 = rl('FNF_DUE'); if (!r0) return null; let d = lwd; let n = r0.p.workingDays ?? 2; while (n > 0) { d = addDays(d, 1); if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) n -= 1; } return d; })();
    return { blockers, input, result: res, due };
  }
  function store(actor, f) {
    const out = compute(f); const r = out.result; const lastP = out.input.lastSalary?.periods ?? [];
    const working = { ...(r?.working ?? {}), blockers: out.blockers, lastSalaryPeriods: lastP, used: out.input.lastSalary?.used ?? [], inputIds: (out.input.recoveries.inputs ?? []).map((i) => i.id), monthly: out.input.monthly, bonus: out.input.bonus, leaveDays: out.input.leaveDays, notice: { recoveryDays: out.input.noticeRecoveryDays, payDays: out.input.noticePayDays } };
    db.prepare('UPDATE pay_fnf SET inputs_json = ?, components_json = ?, working_json = ?, gross_paise = ?, deductions_paise = ?, tds_paise = ?, net_paise = ?, payable_paise = ?, recoverable_paise = ?, due_date = COALESCE(?, due_date), computed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
      .run(JSON.stringify(out.input), JSON.stringify(r?.components ?? []), JSON.stringify(working), paise(r?.gross ?? 0), paise(r?.deductions ?? 0), paise(r?.tds ?? 0), paise(r?.net ?? 0), paise(r?.payable ?? 0), paise(r?.recoverable ?? 0), out.due ?? null, r ? nowIso() : null, actor.user, nowIso(), f.id);
  }
  const fnfView = (actor, f, detail = false) => {
    const e = db.prepare('SELECT e.emp_code, e.full_name, g.name AS designation, e.doj, e.employment_type, d.name AS dept FROM hr_employees e LEFT JOIN org_departments d ON d.id = e.department_id LEFT JOIN org_designations g ON g.id = e.designation_id WHERE e.id = ?').get(f.employee_id); const sep = db.prepare('SELECT doc_no, sep_type, reason_code, relieving_doc_id FROM hr_separations WHERE id = ?').get(f.separation_id);
    const w = json(f.working_json, {});
    const o = { id: f.id, docNo: f.doc_no, employeeId: f.employee_id, employee: `${e.emp_code} ${e.full_name}`, designation: e.designation, department: e.dept, doj: e.doj, employmentType: e.employment_type, separationId: f.separation_id, separation: sep?.doc_no, separationType: sep?.sep_type, lastWorkingDay: f.last_working_day, dueDate: f.due_date,
      gross: mask(actor, rs(f.gross_paise)), deductions: mask(actor, rs(f.deductions_paise)), tds: mask(actor, rs(f.tds_paise)), net: mask(actor, rs(f.net_paise)), payable: mask(actor, rs(f.payable_paise)), recoverable: mask(actor, rs(f.recoverable_paise)),
      status: f.status, statusLabel: STATUS[f.status], payStatus: f.pay_status, payStatusLabel: PAY_STATUS[f.pay_status], paidOn: f.paid_on, late: Boolean(f.late), computedAt: f.computed_at, blockers: w.blockers ?? [], relievingIssued: Boolean(sep?.relieving_doc_id), version: f.version, amendsId: f.amends_id, remarks: f.remarks, requestedBy: f.requested_by, approvedBy: f.approved_by, approvedAt: f.approved_at };
    if (detail) { o.components = seesPay(actor) ? json(f.components_json, []) : []; o.adjustments = json(f.adjustments_json, []); o.bonusRate = f.bonus_rate_bp != null ? f.bonus_rate_bp / 100 : null; o.working = seesPay(actor) ? { gratuity: w.gratuity ?? null, tax: w.tax ?? null, monthly: w.monthly ?? null, lastSalaryPeriods: w.lastSalaryPeriods ?? [], leaveDays: w.leaveDays, notice: w.notice, bonus: w.bonus } : null;
      o.transfers = db.prepare("SELECT * FROM pay_transfers WHERE fnf_id = ? AND deleted_at IS NULL ORDER BY id DESC").all(f.id).map((t) => transferView(actor, t)); o.posting = logView(logOf(actor.companyId, 'pay_fnf', f.id)); o.history = flow.history(actor, f.id);
      o.can = { ...flow.can(actor, f), ...flow.approveInfo(actor, f), compute: ['DRAFT', 'RETURNED'].includes(f.status) && may(actor, 'pay.fnf.edit'), pay: f.status === 'APPROVED' && f.pay_status === 'UNPAID' && f.payable_paise > 0 && !openAmendment(f.id) && may(actor, 'pay.transfer.create'), print: may(actor, 'pay.fnf.print') && seesPay(actor), relieving: f.pay_status === 'PAID' || f.pay_status === 'NIL' || f.pay_status === 'RECOVERABLE' ? may(actor, 'hr.separation.letter') && !sep?.relieving_doc_id : false, amend: f.status === 'APPROVED' && f.pay_status === 'UNPAID' && may(actor, 'pay.fnf.amend') }; }
    return o;
  };
  /** On approval: the posting event, the inputs used marked, the payment state; payroll, HR and accounts told. */
  function approved(actor, f) {
    const e = db.prepare('SELECT * FROM hr_employees WHERE id = ?').get(f.employee_id); const w = json(f.working_json, {});
    const ps = f.net_paise > 0 ? 'UNPAID' : f.net_paise < 0 ? 'RECOVERABLE' : 'NIL'; db.prepare('UPDATE pay_fnf SET pay_status = ?, updated_at = ? WHERE id = ?').run(ps, nowIso(), f.id);
    for (const u of w.used ?? []) { if (u.arrears?.length) db.prepare(`UPDATE pay_arrears SET arrear_status = 'PAID', remarks = ?, updated_at = ? WHERE id IN (${u.arrears.map(Number).join(',')}) AND arrear_status = 'PENDING'`).run(`paid in the full and final ${f.doc_no}`, nowIso()); if (u.inputs?.length) db.prepare(`UPDATE pay_inputs SET input_status = 'APPLIED', note = COALESCE(note, '') || ?, updated_at = ? WHERE id IN (${u.inputs.map(Number).join(',')}) AND input_status = 'PENDING'`).run(` (full and final ${f.doc_no})`, nowIso());
      for (const a of u.advances ?? []) { try { expenses()?.advances.recoveries.recover({ user: f.requested_by, roles: rolesOf(f.company_id, f.requested_by), companyId: f.company_id }, a.id, { amount: a.amount, reference: f.doc_no }); } catch (x) { notify(f.company_id, 'pay.settle.alert', ['permission:pay.fnf.create'], f.doc_no, 'advance recovery', `The advance instalment ${a.id} could not be recorded: ${x.message}`, `/payroll/fnf?id=${f.id}`, `${f.id}-adv-${a.id}`); } } }
    if (w.inputIds?.length) db.prepare(`UPDATE pay_inputs SET input_status = 'APPLIED', note = COALESCE(note, '') || ?, updated_at = ? WHERE id IN (${w.inputIds.map(Number).join(',')}) AND input_status = 'PENDING'`).run(` (full and final ${f.doc_no})`, nowIso());
    // an amendment replaces the settlement it amends: the earlier journal is reversed
    if (f.amends_id) { const old = db.prepare('SELECT * FROM pay_fnf WHERE id = ?').get(f.amends_id); db.prepare("UPDATE pay_fnf SET status = 'SUPERSEDED', updated_at = ? WHERE id = ?").run(nowIso(), old.id); const j = db.prepare("SELECT id FROM fin_journals WHERE company_id = ? AND source_type = 'pay_fnf' AND source_id = ? AND kind = 'ENGINE' AND status != 'CANCELLED'").get(f.company_id, String(old.id)); if (j) gl()?.reverseEngine(f.company_id, j.id, { date: todayIST(), reason: `Replaced by the amendment ${f.doc_no}`, user: actor.user }); }
    const pd = fnfPostingData(f);
    evt('pay.fnf.approved', actor, f.company_id, 'pay_fnf', f.id, { fnfId: f.id, docNo: f.doc_no, employeeId: f.employee_id, employee: `${e.emp_code} ${e.full_name}`, departmentId: e.department_id, costCentreId: e.cost_centre_id, separationId: f.separation_id, approvedOn: todayIST(), net: rs(f.net_paise), dueDate: f.due_date, ...pd });
    notify(f.company_id, 'pay.fnf.decided', ['permission:pay.transfer.create'], f.doc_no, 'approved', ps === 'UNPAID' ? `The full and final of ${e.emp_code} ${e.full_name} is approved: pay ${money(f.payable_paise)} by ${f.due_date ?? 'the due date'}.` : ps === 'RECOVERABLE' ? `The full and final of ${e.emp_code} ${e.full_name} is approved: ${money(f.recoverable_paise)} is to be recovered from the employee.` : `The full and final of ${e.emp_code} ${e.full_name} is approved with nothing to pay.`, `/payroll/fnf?id=${f.id}`, `${f.id}-appr`);
  }
  const fnf = {
    flow, compute: (f) => compute(f),
    list(actor, query) { need(actor, 'pay.fnf.view', 'see settlements'); return runList(db, fnfList, parseListRequest(fnfList, query), { select: 'x.*', scopeSql: 'x.company_id = :c', params: { c: actor.companyId }, tieBreaker: 'x.id', map: (f) => fnfView(actor, f) }); },
    /** The leavers whose inputs HR released (clearance complete) and who have no settlement yet. */
    candidates(actor) { need(actor, 'pay.fnf.view', 'see settlements'); return db.prepare("SELECT s.id, s.doc_no, s.last_working_day, s.fnf_released_at, e.emp_code, e.full_name FROM hr_separations s JOIN hr_employees e ON e.id = s.employee_id WHERE s.company_id = ? AND s.status = 'SETTLED' AND s.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM pay_fnf f WHERE f.separation_id = s.id AND f.status NOT IN ('CANCELLED', 'REJECTED', 'SUPERSEDED') AND f.deleted_at IS NULL) ORDER BY s.last_working_day").all(actor.companyId).map((s) => ({ separationId: s.id, separation: s.doc_no, employee: `${s.emp_code} ${s.full_name}`, lastWorkingDay: s.last_working_day, releasedAt: s.fnf_released_at })); },
    get(actor, id) { return fnfView(actor, fnfRow(actor, id), true); },
    create(actor, b, { system = false } = {}) {
      if (!system) need(actor, 'pay.fnf.create', 'prepare settlements'); const c = actor.companyId; gate(c); const { s } = inputsOf(c, b.separationId);
      if (db.prepare("SELECT 1 FROM pay_fnf WHERE separation_id = ? AND status NOT IN ('CANCELLED', 'REJECTED', 'SUPERSEDED') AND deleted_at IS NULL").get(s.id)) throw conflict('A settlement of this separation exists already.');
      let id; try { id = Number(db.prepare("INSERT INTO pay_fnf (company_id, doc_no, employee_id, separation_id, last_working_day, status, requested_by, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)").run(c, flow.next(actor), s.employee_id, s.id, s.last_working_day, system ? null : actor.user, actor.user, system ? 'hr.fnf.released' : 'api', String(s.id)).lastInsertRowid); }
      catch (x) { if (/UNIQUE/.test(String(x.message))) throw conflict('A settlement of this separation exists already.'); throw x; }
      store(actor, db.prepare('SELECT * FROM pay_fnf WHERE id = ?').get(id)); audit(actor, 'pay_fnf', id, 'create', c, { newValues: { separation: s.doc_no, employeeId: s.employee_id } });
      return system ? { id } : fnf.get(actor, id);
    },
    update(actor, id, b) { const f = fnfRow(actor, id, 'pay.fnf.edit'); if (!['DRAFT', 'RETURNED'].includes(f.status)) throw conflict('Only a draft or returned settlement is changed; an approved one is amended.'); if (b.version !== f.version) throw conflict('The settlement was changed by someone else; reload it.');
      db.prepare('UPDATE pay_fnf SET adjustments_json = COALESCE(?, adjustments_json), bonus_rate_bp = ?, remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.adjustments ? JSON.stringify(b.adjustments) : null, b.bonusRate === undefined ? f.bonus_rate_bp : b.bonusRate == null ? null : Math.round(b.bonusRate * 100), b.remarks === undefined ? f.remarks : b.remarks, actor.user, nowIso(), f.id);
      store(actor, db.prepare('SELECT * FROM pay_fnf WHERE id = ?').get(f.id)); audit(actor, 'pay_fnf', f.id, 'update', f.company_id, { oldValues: { adjustments: json(f.adjustments_json, []), net: rs(f.net_paise) }, newValues: { adjustments: b.adjustments, bonusRate: b.bonusRate, net: rs(db.prepare('SELECT net_paise FROM pay_fnf WHERE id = ?').get(f.id).net_paise) } });
      return fnf.get(actor, f.id); },
    recompute(actor, id) { const f = fnfRow(actor, id, 'pay.fnf.edit'); if (!['DRAFT', 'RETURNED'].includes(f.status)) throw conflict('Only a draft or returned settlement is computed again.'); store(actor, f); audit(actor, 'pay_fnf', f.id, 'compute', f.company_id); return fnf.get(actor, f.id); },
    remove(actor, id) { flow.remove(actor, id); return { id: Number(id), deleted: true }; },
    submit(actor, id) { const f = fnfRow(actor, id, 'pay.fnf.submit'); if (['DRAFT', 'RETURNED'].includes(f.status)) store(actor, f); flow.submit(actor, id); return fnf.get(actor, id); },
    withdraw(actor, id, b) { flow.withdraw(actor, id, b); return fnf.get(actor, id); },
    cancel(actor, id, b) { flow.cancel(actor, id, b); return fnf.get(actor, id); },
    /** An approved settlement not yet paid is changed by an amendment: a new version, approved again; on its approval the earlier one is superseded and its journal reversed. */
    amend(actor, id, { reason }) { const f = fnfRow(actor, id, 'pay.fnf.amend'); if (f.status !== 'APPROVED') throw conflict('Only an approved settlement is amended.'); if (f.pay_status !== 'UNPAID') throw conflict(`The settlement is ${PAY_STATUS[f.pay_status].toLowerCase()}: it is not amended.`);
      if (openAmendment(f.id)) throw conflict('An amendment of this settlement is open already.');
      const nid = Number(db.prepare("INSERT INTO pay_fnf (company_id, doc_no, employee_id, separation_id, last_working_day, adjustments_json, bonus_rate_bp, amends_id, status, remarks, requested_by, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 'amendment', ?)").run(f.company_id, `${f.doc_no}-A${(db.prepare('SELECT COUNT(*) AS n FROM pay_fnf WHERE amends_id = ?').get(f.id).n ?? 0) + 1}`, f.employee_id, f.separation_id, f.last_working_day, f.adjustments_json, f.bonus_rate_bp, f.id, reason, actor.user, actor.user, String(f.id)).lastInsertRowid);
      store(actor, db.prepare('SELECT * FROM pay_fnf WHERE id = ?').get(nid)); audit(actor, 'pay_fnf', nid, 'amend', f.company_id, { reason, newValues: { amends: f.doc_no } }); return fnf.get(actor, nid); },
    history: (actor, id) => flow.history(actor, id),
    compare(actor, id) { const f = fnfRow(actor, id); if (!f.amends_id) return null; const o = fnfRow(actor, f.amends_id); const a = new Map(json(o.components_json, []).map((x) => [x.code, x])); const b = new Map(json(f.components_json, []).map((x) => [x.code, x]));
      return { from: o.doc_no, to: f.doc_no, rows: [...new Set([...a.keys(), ...b.keys()])].map((k) => ({ code: k, label: (b.get(k) ?? a.get(k)).label, before: mask(actor, a.get(k)?.amount ?? 0), after: mask(actor, b.get(k)?.amount ?? 0) })).filter((r) => r.before !== r.after), net: { before: mask(actor, rs(o.net_paise)), after: mask(actor, rs(f.net_paise)) } }; },
    /** The F&F statement (PDF): every component with its working, the totals and the payment. */
    print(actor, id) { const f = fnfRow(actor, id, 'pay.fnf.print'); if (!seesPay(actor)) throw forbidden('You may not see salaries (permission pay.salary.view).'); const v = fnfView(actor, f, true); audit(actor, 'pay_fnf', f.id, 'print', f.company_id);
      const rows = v.components.filter((c) => c.type !== 'INFO').map((c) => ({ c: c.label, k: c.type === 'EARNING' ? 'Earning' : c.type === 'DEDUCTION' ? 'Deduction' : 'Employer (not paid to the employee)', a: c.amount.toFixed(2), w: c.working }));
      return { contentType: 'application/pdf', fileName: `${f.doc_no.replaceAll('/', '-')}.pdf`, buffer: toPdf({ title: `Full and final settlement ${v.docNo} · ${v.employee} · ${v.statusLabel}`, columns: [{ key: 'c', label: 'Component', type: 'text' }, { key: 'k', label: 'Kind', type: 'text' }, { key: 'a', label: 'Amount (Rs.)', type: 'money' }, { key: 'w', label: 'Working', type: 'text' }], rows,
        footer: [`Joined ${v.doj} · last working day ${v.lastWorkingDay} · separation ${v.separation} (${v.separationType})`, `Earnings Rs. ${v.gross.toFixed(2)} · deductions Rs. ${v.deductions.toFixed(2)} (TDS Rs. ${v.tds.toFixed(2)}) · net Rs. ${v.net.toFixed(2)}`, `Pay by ${v.dueDate ?? '-'} · ${v.payStatusLabel}${v.paidOn ? ` on ${v.paidOn}` : ''}${v.late ? ' (late)' : ''} · approved by ${v.approvedBy ?? '-'} ${v.approvedAt ? v.approvedAt.slice(0, 10) : ''}`] }) }; },
    exportCsv(actor, query = {}) { need(actor, 'pay.fnf.export', 'export settlements'); const l = fnf.list(actor, { ...query, page: 1, pageSize: 100 }); audit(actor, 'pay_fnf', 0, 'export', actor.companyId, { reason: `${l.data.length} row(s)` });
      return { contentType: 'text/csv; charset=utf-8', fileName: `full-and-final-${todayIST()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Settlement', 'Employee', 'Last working day', 'Pay by', 'Earnings', 'Deductions', 'TDS', 'Net', 'Status', 'Payment', 'Paid on', 'Late'], l.data.map((x) => [x.docNo, x.employee, x.lastWorkingDay, x.dueDate ?? '', x.gross ?? '', x.deductions ?? '', x.tds ?? '', x.net ?? '', x.statusLabel, x.payStatusLabel, x.paidOn ?? '', x.late ? 'yes' : '']))}`, 'utf8') }; },
    /** Adjustments of a draft from a CSV (label, EARNING or DEDUCTION, amount, reason; a header row is optional): checked as a whole, then recomputed on the server. */
    import(actor, id, { csv }) { const f = fnfRow(actor, id, 'pay.fnf.import'); if (!['DRAFT', 'RETURNED'].includes(f.status)) throw conflict('Adjustments are imported into a draft or returned settlement.');
      const rows = csv.split(/\r?\n/).map((l) => l.split(',').map((x) => x.trim().replace(/^"|"$/g, ''))).filter((r) => r.length >= 4 && r[0]); const body = /label/i.test(rows[0]?.[0] ?? '') ? rows.slice(1) : rows; const problems = []; const adj = [];
      body.forEach((r, i) => { const type = r[1].toUpperCase(); const amount = Number(r[2]); if (!['EARNING', 'DEDUCTION'].includes(type)) problems.push({ field: `rows.${i + 1}.type`, message: 'EARNING or DEDUCTION' }); if (!(amount > 0)) problems.push({ field: `rows.${i + 1}.amount`, message: 'An amount above zero' }); if ((r[3] ?? '').length < 5) problems.push({ field: `rows.${i + 1}.reason`, message: 'Say why (at least 5 characters)' }); adj.push({ label: r[0].slice(0, 80), type, amount, reason: r[3] }); });
      if (!adj.length) problems.push({ field: 'csv', message: 'No rows' }); if (problems.length) throw badRequest('Correct the rows of the file', problems);
      return fnf.update(actor, id, { version: f.version, adjustments: [...json(f.adjustments_json, []), ...adj] }); },
    /** hr.fnf.released (07.13): the draft settlement is prepared for payroll at once. */
    onReleased(e) { const c = Number(e.companyId); if (!c || !on(c)) return; const sepId = Number(e.entityId); if (!sepId || db.prepare("SELECT 1 FROM pay_fnf WHERE separation_id = ? AND status NOT IN ('CANCELLED', 'REJECTED', 'SUPERSEDED') AND deleted_at IS NULL").get(sepId)) return;
      try { const out = fnf.create(sys(c), { separationId: sepId }, { system: true }); notify(c, 'pay.fnf.decided', ['permission:pay.fnf.create'], `FNF ${out.id}`, 'to prepare', `The full-and-final inputs of a leaver were released by HR: the settlement is drafted; check it and send it for approval.`, `/payroll/fnf?id=${out.id}`, `${out.id}-draft`); } catch (x) { notify(c, 'pay.settle.alert', ['permission:pay.fnf.create'], `SEP ${sepId}`, 'settlement not drafted', `The settlement of the separation ${sepId} could not be drafted: ${x.message}`, '/payroll/fnf', `${sepId}-fail`); } },
  };

  return { posting: postingSvc, transfers, payslips, fnf, consumers: { onPosted }, passwordOf };
}
