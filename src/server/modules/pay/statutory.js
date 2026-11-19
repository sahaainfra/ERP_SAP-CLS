import { createHash } from 'node:crypto';
import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { toPdf } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { todayIST } from '../../../shared/dates.js';
import { nowIso, rid } from '../proc/base.js';
import { STATUS, createFlow } from '../qa/flow.js';

// Part 24.04: statutory compliance. FR-01 the monthly ECR (EPFO) and ESI contribution files, the PT and LWF state reports; FR-02 challans (amount, date,
// reference) and the payment request of each approved filing (ACCMGR -> CFO, the statutory payment chain of section 9); FR-03 the TDS deduction register
// per month, the quarterly statement (24Q, Form 138 from 2026-27) and the annual Form 16 / Form 130 batch; FR-04 the labour registers per site (workmen,
// overtime, deductions, advances) from the wage runs of 24.03; FR-05 bonus (Payment of Bonus Act) and gratuity computations for provisioning and full and
// final settlement; FR-06 the BOCW cess per project and month. Every due date and rate is effective-dated master data (stat_rules; the parameters of
// pay_statutory_params), never a constant. BR-01: a file is validated against its record layout and its totals tie to the locked payroll before it is kept.

export const FILING_DOC = 'PAY_STAT_FILING';
export const FILING_TYPES = { ECR: 'EPF monthly return (ECR)', ESI: 'ESI monthly contribution', PT: 'Professional tax', LWF: 'Labour welfare fund', TDS_MONTHLY: 'TDS deposit (salary)', BOCW: 'BOCW cess' };
export const REGISTER_TYPES = { ECR_FILE: 'ECR file', ESI_FILE: 'ESI contribution file', PT_REPORT: 'Professional tax report', LWF_REPORT: 'LWF report', TDS_24Q_FILE: 'Quarterly TDS statement (24Q / 138)', FORM16_BATCH: 'Form 16 / Form 130 batch', WORKMEN_REGISTER: 'Register of workmen (site)', OVERTIME_REGISTER: 'Overtime register (site)', DEDUCTION_REGISTER: 'Deductions register (site)', ADVANCE_REGISTER: 'Advances register (site)' };
const DAY = 86_400_000;
const r0 = (v) => Math.round(Number(v ?? 0));
const rs = (p) => (p == null ? null : p / 100);
const paise = (v) => Math.round(Number(v ?? 0) * 100);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const monthEnd = (p) => { const [y, m] = p.split('-').map(Number); return `${p}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
const addMonths = (p, n) => { const [y, m] = p.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`; };
const ymd = (y, m, d) => { const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`; };
const monthsOfFy = (startYear) => Array.from({ length: 12 }, (_, i) => { const m = ((3 + i) % 12) + 1; const y = startYear + (m >= 4 ? 0 : 1); return `${y}-${String(m).padStart(2, '0')}`; });
export const fyStartOf = (fy) => Number(String(fy).slice(0, 4));
export const quarterOf = (code) => { const m = /^Q([1-4]) (\d{4})-\d{2}$/.exec(code ?? ''); if (!m) return null; const q = Number(m[1]); const s = Number(m[2]); const months = monthsOfFy(s).slice((q - 1) * 3, q * 3); return { q, fy: `${s}-${String((s + 1) % 100).padStart(2, '0')}`, months, code }; };

/** Due date of a statutory item from its rule's numbers (pure). Monthly: the day of the month after `offset` months from the period; the TDS for March uses
 *  its own rule. Quarterly (24Q): the month and the year shift of the rule from the financial year. Form 16 / 130: the month and year shift from the FY. */
export function dueOf(kind, period, params) {
  if (kind === 'QUARTER') { const q = quarterOf(period); if (!q) return null; const s = fyStartOf(q.fy); return ymd(s + (params.yearShift ?? 0), params.dueMonth, params.dueDay); }
  if (kind === 'FY') { const s = fyStartOf(period); return ymd(s + (params.yearShift ?? 1), params.dueMonth ?? 6, params.dueDay ?? 15); }
  const m = addMonths(period, params.offset ?? 1); return ymd(Number(m.slice(0, 4)), Number(m.slice(5, 7)), params.day ?? 15);
}
/** The rule in force on a date for a type and state: the state's own rule first, else the ALL rule; the latest effective one (pure). */
export function pickRule(rules, type, state, date) {
  const hits = rules.filter((r) => r.rule_type === type && (r.state_code === state || r.state_code === 'ALL') && r.effective_from <= date && (!r.effective_to || r.effective_to >= date) && !r.deleted_at);
  hits.sort((a, b) => (a.state_code === state ? 0 : 1) - (b.state_code === state ? 0 : 1) || (a.effective_from < b.effective_from ? 1 : -1));
  return hits[0] ?? null;
}
/** The ECR record of one employee (EPFO ECR 2.0, eleven fields separated by '#') from the line's contributions and wage bases (pure). */
export function ecrRecord(l) {
  const f = [l.uan, l.name.replace(/[#\r\n]/g, ' ').toUpperCase(), l.gross, l.epfWage, l.epsWage, l.edliWage, l.eeShare, l.epsShare, l.erDiff, l.ncpDays, 0];
  return f.join('#');
}
/** Validates an ECR record: twelve-digit UAN, eleven fields, whole rupees (pure). Returns the problems. */
export function ecrProblems(rec) { const p = []; const f = rec.split('#'); if (f.length !== 11) p.push(`expected 11 fields, found ${f.length}`); if (!/^\d{12}$/.test(f[0] ?? '')) p.push('UAN must be 12 digits'); for (const i of [2, 3, 4, 5, 6, 7, 8, 9, 10]) if (!/^\d+$/.test(f[i] ?? '')) p.push(`field ${i + 1} must be a whole number`); return p; }

/** @param {{ db: any, base: any, flags: any, setup: any, ctr?: any }} o */
export function createStatutoryService({ db, base, flags, setup }) {
  const { may, audit, number } = base;
  const need = (actor, key, what, pid = null, sid = null) => { if (!may(actor, key, pid, sid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const on = (companyId) => flags.isOn({ companyId, user: 'system', roles: [] }, 'ff.pay.p2404');
  const evt = (type, actor, companyId, entity, entityId, data) => publishEvent(db, { type, entity, entityId, actorId: actor?.user ?? 'system', companyId, data });
  const today = () => todayIST();
  const seesPay = (actor) => may(actor, 'pay.salary.view');
  const mask = (actor, v) => (seesPay(actor) ? v : null);
  const rulesOf = (companyId) => db.prepare("SELECT * FROM stat_rules WHERE (company_id = ? OR company_id IS NULL) AND deleted_at IS NULL ORDER BY effective_from").all(companyId);
  const rule = (companyId, type, state, date) => { const r = pickRule(rulesOf(companyId), type, state, date); return r ? { ...r, p: JSON.parse(r.params_json) } : null; };
  const regularRun = (companyId, period) => db.prepare("SELECT * FROM pay_runs WHERE company_id = ? AND period = ? AND run_type = 'REGULAR' AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(companyId, period);

  /** The lines of a locked run with the employee's statutory identity, the components in rupees and the wage bases (ECR, ESI, PT, LWF, TDS). */
  function linesOf(runId) {
    return db.prepare(`SELECT l.*, e.emp_code, e.full_name, e.doj, s.uan, s.esic_ip, s.pt_state, s.lwf_state, s.pan_last4 FROM pay_run_lines l JOIN hr_employees e ON e.id = l.employee_id LEFT JOIN hr_employee_statutory s ON s.employee_id = l.employee_id AND s.deleted_at IS NULL WHERE l.run_id = ? AND l.deleted_at IS NULL ORDER BY e.emp_code`).all(runId)
      .map((l) => { const comp = new Map(JSON.parse(l.components_json || '[]').map((c) => [c.code, Number(c.amount ?? 0)])); const w = JSON.parse(l.wages_json || '{}'); const tds = JSON.parse(l.tds_json || '{}');
        return { ...l, comp: (code) => r0(comp.get(code) ?? 0), pfBase: r0(w.pfBase ?? 0), pfWage: r0(w.pfWage ?? 0), esiWage: r0(w.esiWage ?? 0), regime: tds.regime ?? 'NEW', tdsRupees: rs(l.tds_paise), grossRupees: rs(l.gross_paise), name: l.full_name, code: l.emp_code }; });
  }

  // ================================================================ files and reports (FR-01, FR-03, FR-04; BR-01)
  /** The ECR file of a period: one record a member, validated and tied to the payroll (the EPF share and the ER difference equal the run's). */
  function ecrOf(companyId, run) {
    const period = run.period; const pf = setup.paramsAt(companyId, 'PF', null, monthEnd(period)) ?? {}; const ceiling = pf.wageCeiling ?? 15000; const epsCap = pf.epsCeiling ?? ceiling; const edliCap = pf.edliCeiling ?? ceiling;
    const recs = []; const problems = []; const T = { ee: 0, eps: 0, diff: 0, edli: 0, admin: 0, gross: 0 };
    for (const l of linesOf(run.id)) { if (!l.comp('PF_EE') && !l.comp('EPS_ER') && !l.comp('PF_ER')) continue;
      const rec = ecrRecord({ uan: l.uan ?? '', name: l.name, gross: r0(l.grossRupees), epfWage: l.pfWage, epsWage: Math.min(l.pfBase, epsCap), edliWage: Math.min(l.pfBase, edliCap), eeShare: l.comp('PF_EE'), epsShare: l.comp('EPS_ER'), erDiff: l.comp('PF_ER'), ncpDays: Math.round(Number(l.lop_days ?? 0)) });
      const p = ecrProblems(rec); if (p.length) problems.push({ employee: l.emp_code, problems: p }); else recs.push(rec);
      T.ee += l.comp('PF_EE'); T.eps += l.comp('EPS_ER'); T.diff += l.comp('PF_ER'); T.edli += l.comp('EDLI_ER'); T.admin += l.comp('PF_ADMIN'); T.gross += r0(l.grossRupees); }
    if (problems.length) throw unprocessable(`The ECR file is not valid for ${problems.length} employee(s): ${problems.slice(0, 3).map((p) => `${p.employee}: ${p.problems.join('; ')}`).join(' | ')}. Correct the UAN or the wage data and run payroll again.`, { problems });
    return { content: recs.join('\r\n') + (recs.length ? '\r\n' : ''), rows: recs.length, totals: { eeShare: T.ee, epsShare: T.eps, erDiff: T.diff, edli: T.edli, admin: T.admin, gross: T.gross, remittance: T.ee + T.eps + T.diff + T.edli + T.admin } };
  }
  /** The ESI monthly contribution file: IP number (10 digits), name, days, wages, employee and employer contributions, reason code, last working day. */
  function esiOf(companyId, run) {
    const rows = []; const problems = []; const T = { ee: 0, er: 0, wages: 0 };
    for (const l of linesOf(run.id)) { const ee = l.comp('ESI_EE'); const er = l.comp('ESI_ER'); if (!ee && !er) continue;
      if (!/^\d{10}$/.test(l.esic_ip ?? '')) { problems.push({ employee: l.emp_code, problems: ['ESIC IP number must be 10 digits'] }); continue; }
      rows.push([l.esic_ip, l.name.replace(/,/g, ' ').toUpperCase(), r0(l.paid_days) || 0, l.esiWage, ee, er, '0', '']); T.ee += ee; T.er += er; T.wages += l.esiWage; }
    if (problems.length) throw unprocessable(`The ESI file is not valid for ${problems.length} employee(s): ${problems.slice(0, 3).map((p) => `${p.employee}: ${p.problems.join('; ')}`).join(' | ')}.`, { problems });
    return { content: toCsv(['IP Number', 'IP Name', 'No of Days', 'Total Monthly Wages', 'IP Contribution', 'Employer Contribution', 'Reason Code', 'Last Working Day'], rows), rows: rows.length, totals: T };
  }
  /** A state tax or welfare report: the amount of a component per employee of the state. */
  function stateOf(companyId, run, field, code) {
    const rows = []; let total = 0; for (const l of linesOf(run.id)) { const st = l[field]; if (!st) continue; const amt = l.comp(code); if (!amt) continue; rows.push([st, l.emp_code, l.name, amt]); total += amt; }
    return { content: toCsv(['State', 'Employee', 'Name', 'Amount'], rows.sort((a, b) => a[1].localeCompare(b[1]))), rows: rows.length, totals: { amount: total } };
  }
  /** The TDS of the months of a quarter, per employee, with the regime; the PAN shows its last four digits only (the full PAN is read from the vault at export). */
  function tdsQuarterOf(companyId, quarter) {
    const q = quarterOf(quarter); if (!q) throw badRequest('Correct the highlighted fields', [{ field: 'period', message: 'A quarter such as Q1 2026-27.' }]);
    const per = new Map(); const T = { tds: 0 };
    for (const m of q.months) { const run = regularRun(companyId, m); if (!run) continue; for (const l of linesOf(run.id)) { if (!per.has(l.employee_id)) per.set(l.employee_id, { code: l.emp_code, name: l.name, pan: l.pan_last4 ? `XXXXXX${l.pan_last4}` : '', regime: l.regime, m: {}, tot: 0 }); const p = per.get(l.employee_id); p.m[m] = (p.m[m] ?? 0) + (l.tds_paise ?? 0); p.tot += l.tds_paise ?? 0; T.tds += l.tds_paise ?? 0; } }
    const rows = [...per.values()].sort((a, b) => a.code.localeCompare(b.code)).map((p) => [p.code, p.name, p.pan, p.regime, ...q.months.map((m) => rs(p.m[m] ?? 0)), rs(p.tot)]);
    return { content: toCsv(['Employee', 'Name', 'PAN', 'Regime', ...q.months, 'Total TDS'], rows), rows: rows.length, totals: { tds: rs(T.tds) } };
  }
  /** The Form 16 (FY 2025-26) or Form 130 (from 2026-27) batch: per employee the salary of the year, the standard deduction of the regime, the tax deducted. */
  function form16Of(companyId, fy) {
    const start = fyStartOf(fy); const months = monthsOfFy(start); const form = start >= 2026 ? '130' : '16'; const std = setup.paramsAt(companyId, start >= 2026 ? 'TDS_NEW' : 'TDS_OLD', null, `${start}-04-01`)?.standardDeduction ?? 0;
    const per = new Map(); const T = { gross: 0, tds: 0 };
    for (const m of months) { const run = regularRun(companyId, m); if (!run) continue; for (const l of linesOf(run.id)) { if (!per.has(l.employee_id)) per.set(l.employee_id, { code: l.emp_code, name: l.name, pan: l.pan_last4 ? `XXXXXX${l.pan_last4}` : '', regime: l.regime, months: 0, gross: 0, tds: 0, pt: 0, pf: 0 }); const p = per.get(l.employee_id); p.months += 1; p.gross += l.gross_paise; p.tds += l.tds_paise; p.pt += l.comp('PT') * 100; p.pf += l.comp('PF_EE') * 100; T.gross += l.gross_paise; T.tds += l.tds_paise; } }
    const rows = [...per.values()].sort((a, b) => a.code.localeCompare(b.code)).map((p) => { const stdP = p.regime === 'NEW' ? paise(std) : 0; return [p.code, p.name, p.pan, p.regime, p.months, rs(p.gross), rs(p.pf), rs(p.pt), rs(stdP), rs(Math.max(0, p.gross - p.pf - p.pt - stdP)), rs(p.tds)]; });
    const head = ['Employee', 'Name', 'PAN', 'Regime', 'Months', 'Gross salary', 'PF (16(iii))', 'Professional tax', 'Standard deduction', 'Taxable salary', 'Tax deducted'];
    return { form, head, data: rows, content: toCsv(head, rows), rows: rows.length, totals: { gross: rs(T.gross), tds: rs(T.tds) } };
  }
  /** Labour registers per site from the wage runs of the month (24.03): workers, overtime, deductions and advances. */
  function siteRegister(companyId, type, siteId, period) {
    const from = `${period}-01`; const to = monthEnd(period);
    const rows = db.prepare(`SELECT w.worker_code, w.name, w.trade_code, w.skill_category, p.legal_name AS contractor, SUM(l.days_milli) AS days, SUM(l.ot_milli) AS ot, SUM(l.gross_paise) AS gross, SUM(l.advance_paise) AS adv, SUM(l.canteen_paise) AS canteen, SUM(l.other_ded_paise) AS other, SUM(l.pf_paise) AS pf, SUM(l.esi_paise) AS esi, SUM(l.deductions_paise) AS ded, SUM(l.net_paise) AS net, SUM(l.ot_paise) AS otpay FROM pay_wage_lines l JOIN pay_wage_runs r ON r.id = l.run_id JOIN lab_workers w ON w.id = l.worker_id JOIN mdm_partners p ON p.id = r.contractor_id WHERE r.company_id = ? AND r.org_site_id = ? AND r.status = 'APPROVED' AND r.period_from <= ? AND r.period_to >= ? AND l.deleted_at IS NULL AND r.deleted_at IS NULL GROUP BY l.worker_id ORDER BY w.worker_code`).all(companyId, siteId, to, from);
    let head; let out;
    if (type === 'WORKMEN_REGISTER') { head = ['Worker', 'Name', 'Trade', 'Skill', 'Contractor', 'Days', 'OT hours']; out = rows.map((r) => [r.worker_code, r.name, r.trade_code, r.skill_category, r.contractor, r.days / 1000, r.ot / 1000]); }
    else if (type === 'OVERTIME_REGISTER') { head = ['Worker', 'Name', 'OT hours', 'Overtime wages']; out = rows.map((r) => [r.worker_code, r.name, r.ot / 1000, rs(r.otpay)]); }
    else if (type === 'DEDUCTION_REGISTER') { head = ['Worker', 'Name', 'Advance', 'Canteen', 'Other', 'PF', 'ESI', 'Total deductions']; out = rows.map((r) => [r.worker_code, r.name, rs(r.adv), rs(r.canteen), rs(r.other), rs(r.pf), rs(r.esi), rs(r.ded)]); }
    else { head = ['Worker', 'Name', 'Advance recovered', 'Net paid']; out = rows.filter((r) => r.adv > 0).map((r) => [r.worker_code, r.name, rs(r.adv), rs(r.net)]); }
    return { content: toCsv(head, out), rows: out.length, totals: {} };
  }
  /** Bonus of the year (Payment of Bonus Act s.12): eligible when every month's wages are within the eligibility ceiling; the bonus is the rate of the wages
   *  up to the calculation ceiling per month. The rate is chosen between the statutory minimum and maximum (dated parameter BONUS). */
  function bonusOf(companyId, fy, pct) {
    const start = fyStartOf(fy); const bp = setup.paramsAt(companyId, 'BONUS', null, `${start}-04-01`) ?? {};
    if (pct == null) pct = bp.minRate ?? 8.33; if (pct < (bp.minRate ?? 8.33) || pct > (bp.maxRate ?? 20)) throw badRequest('Correct the highlighted fields', [{ field: 'pct', message: `Between ${bp.minRate} % and ${bp.maxRate} % (the Act).` }]);
    const per = new Map(); for (const m of monthsOfFy(start)) { const run = regularRun(companyId, m); if (!run) continue; for (const l of linesOf(run.id)) { if (!per.has(l.employee_id)) per.set(l.employee_id, { code: l.emp_code, name: l.name, months: 0, eligible: true, base: 0 }); const p = per.get(l.employee_id); p.months += 1; const g = rs(l.gross_paise); if (g > (bp.eligibilityCeiling ?? 21000)) p.eligible = false; p.base += Math.min(g, bp.calculationCeiling ?? 7000); } }
    const rows = [...per.values()].sort((a, b) => a.code.localeCompare(b.code)).map((p) => ({ employee: `${p.code} ${p.name}`, months: p.months, eligible: p.eligible, bonusBase: p.base, bonus: p.eligible ? Math.round(p.base * pct) / 100 : 0 }));
    return { fy, pct, parameters: { minRate: bp.minRate, maxRate: bp.maxRate, eligibilityCeiling: bp.eligibilityCeiling, calculationCeiling: bp.calculationCeiling }, rows, totals: { eligible: rows.filter((r) => r.eligible).length, bonus: rows.reduce((a, r) => a + r.bonus, 0) } };
  }
  /** Gratuity on leaving (Payment of Gratuity Act s.4): fifteen days' wages for each completed year of service, from five years; wages are the last basic (and
   *  dearness allowance); the ceiling is the dated GRATUITY_CAP rule. */
  function gratuityOf(companyId, employeeId, leavingDate) {
    const e = db.prepare('SELECT id, emp_code, full_name, doj FROM hr_employees WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(employeeId), companyId); if (!e) throw notFound('That employee does not exist.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(leavingDate ?? '') || leavingDate < e.doj) throw badRequest('Correct the highlighted fields', [{ field: 'leavingDate', message: 'A date on or after the joining date.' }]);
    const yrs = (() => { const [a, b] = [e.doj, leavingDate].map((x) => x.split('-').map(Number)); let y = b[0] - a[0]; if (b[1] < a[1] || (b[1] === a[1] && b[2] < a[2])) y -= 1; return Math.max(0, y); })();
    const last = db.prepare("SELECT l.components_json FROM pay_run_lines l JOIN pay_runs r ON r.id = l.run_id WHERE l.employee_id = ? AND r.status = 'APPROVED' AND l.deleted_at IS NULL ORDER BY r.period DESC, r.id DESC LIMIT 1").get(e.id);
    const comp = new Map(JSON.parse(last?.components_json || '[]').map((c) => [c.code, Number(c.amount ?? 0)])); const wages = (comp.get('BASIC') ?? 0) + (comp.get('DA') ?? 0);
    const cap = rule(companyId, 'GRATUITY_CAP', 'ALL', leavingDate)?.p.capPaise ?? 200000000; const eligible = yrs >= 5 && wages > 0;
    const raw = eligible ? Math.round((wages * 15 * yrs) / 26 * 100) : 0; const amount = Math.min(cap, raw);
    return { employee: `${e.emp_code} ${e.full_name}`, joinedOn: e.doj, leavingDate, completedYears: yrs, eligible, lastWages: wages, formula: '15 / 26 × last wages × completed years', capPaise: cap, amount: rs(amount), capped: raw > cap, wagesSeen: wages > 0, reason: !eligible ? (yrs < 5 ? 'Less than five completed years (the Act: five years, or death or disability)' : 'No approved payroll to read the last wages from') : null };
  }
  /** The gratuity provision of a year: the monthly provision (the GRATUITY component of the structure) summed over the locked runs of the year, per employee. */
  function gratuityProvision(companyId, fy) {
    const start = fyStartOf(fy); const per = new Map(); let total = 0;
    for (const m of monthsOfFy(start)) { const run = regularRun(companyId, m); if (!run) continue; for (const l of linesOf(run.id)) { const amt = l.comp('GRATUITY'); if (!amt) continue; per.set(l.emp_code, (per.get(l.emp_code) ?? 0) + amt); total += amt; } }
    return { fy, rows: [...per.entries()].sort().map(([employee, amount]) => ({ employee, amount: amount })), totals: { provision: total } };
  }

  // ================================================================ calendar (FR-02)
  /** The statutory items of a financial year: each month's ECR, ESI, PT and LWF per state, the TDS deposit, the quarterly statements, the Form 16 / 130 batch and
   *  the BOCW cess, with the rule that sets each due date, its status and its filing. */
  function calendarOf(actor, companyId, fy) {
    const start = fyStartOf(fy); const months = monthsOfFy(start); const t = today(); const items = [];
    const states = (f) => db.prepare(`SELECT DISTINCT ${f} AS s FROM hr_employee_statutory WHERE company_id = ? AND ${f} IS NOT NULL AND deleted_at IS NULL`).all(companyId).map((x) => x.s);
    const ptStates = states('pt_state'); const lwfStates = states('lwf_state'); const filings = db.prepare('SELECT * FROM stat_filings WHERE company_id = ? AND deleted_at IS NULL AND period IN (' + months.map(() => '?').join(',') + ')').all(companyId, ...months);
    const find = (type, period, st) => filings.find((f) => f.filing_type === type && f.period === period && f.state_code === st && !['CANCELLED', 'REJECTED', 'SUPERSEDED'].includes(f.status)) ?? null;
    const add = (type, period, st, kind, params, legal, status, label) => { const f = find(type, period, st); const due = dueOf(kind, period, params); const filed = f && f.paid_on;
      items.push({ type, label: label ?? FILING_TYPES[type] ?? type, period, state: st, dueDate: due, ruleStatus: status, legalRef: legal, amountPaise: f?.amount_paise ?? null, filing: f ? { id: f.id, docNo: f.doc_no, status: f.status, statusLabel: STATUS[f.status], paidOn: f.paid_on, challanRef: f.challan_ref } : null,
        column: filed ? 'PAID' : !f || ['DRAFT', 'RETURNED'].includes(f.status) ? 'TO_FILE' : f.status === 'APPROVED' ? 'TO_PAY' : 'IN_APPROVAL', overdue: !filed && due < t, dueIn: Math.round((Date.parse(due) - Date.parse(t)) / DAY) }); };
    for (const m of months) {
      const rEcr = rule(companyId, 'ECR', 'ALL', `${m}-01`); if (rEcr) add('ECR', m, 'ALL', 'MONTHLY', rEcr.p, rEcr.legal_ref, rEcr.rule_status);
      const rEsi = rule(companyId, 'ESI', 'ALL', `${m}-01`); if (rEsi) add('ESI', m, 'ALL', 'MONTHLY', rEsi.p, rEsi.legal_ref, rEsi.rule_status);
      for (const st of ptStates) { const r = rule(companyId, 'PT', st, `${m}-01`); if (r) add('PT', m, st, 'MONTHLY', r.p, r.legal_ref, r.rule_status, `Professional tax ${st}`); }
      for (const st of lwfStates) { const r = rule(companyId, 'LWF', st, `${m}-01`); if (r && (r.p.months ?? []).includes(Number(m.slice(5)))) add('LWF', m, st, 'MONTHLY', r.p, r.legal_ref, r.rule_status, `Labour welfare fund ${st}`); }
      const mar = m.slice(5) === '03'; const rt = rule(companyId, mar ? 'TDS_MONTHLY_MAR' : 'TDS_MONTHLY', 'ALL', `${m}-01`); if (rt) add('TDS_MONTHLY', m, 'ALL', 'MONTHLY', rt.p, rt.legal_ref, rt.rule_status, 'TDS deposit (salary)');
      const rb = rule(companyId, 'BOCW', 'ALL', `${m}-01`); if (rb && db.prepare("SELECT 1 FROM stat_bocw_months WHERE company_id = ? AND period = ? AND deleted_at IS NULL").get(companyId, m)) add('BOCW', m, 'ALL', 'MONTHLY', rb.p, rb.legal_ref, rb.rule_status);
    }
    const quarters = [['Q1', 'TDS_24Q_Q1'], ['Q2', 'TDS_24Q_Q2'], ['Q3', 'TDS_24Q_Q3'], ['Q4', 'TDS_24Q_Q4']];
    for (const [i, [qq, rt]] of quarters.entries()) { const code = `${qq} ${fy}`; const r = rule(companyId, rt, 'ALL', `${months[i * 3]}-01`); if (r) items.push({ type: 'TDS_24Q', label: `Quarterly TDS statement ${qq}`, period: code, state: 'ALL', dueDate: dueOf('QUARTER', code, r.p), ruleStatus: r.rule_status, legalRef: r.legal_ref, amountPaise: null, filing: null, column: 'TO_FILE', overdue: dueOf('QUARTER', code, r.p) < t, dueIn: Math.round((Date.parse(dueOf('QUARTER', code, r.p)) - Date.parse(t)) / DAY) }); }
    const f16 = rule(companyId, 'FORM16', 'ALL', `${start}-04-01`); if (f16) items.push({ type: 'FORM16', label: `${f16.p.form === '130' ? 'Form 130' : 'Form 16'} batch`, period: fy, state: 'ALL', dueDate: dueOf('FY', fy, f16.p), ruleStatus: f16.rule_status, legalRef: f16.legal_ref, amountPaise: null, filing: null, column: 'TO_FILE', overdue: dueOf('FY', fy, f16.p) < t, dueIn: Math.round((Date.parse(dueOf('FY', fy, f16.p)) - Date.parse(t)) / DAY) });
    return { fy, today: t, items: items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.type.localeCompare(b.type)), states: { pt: ptStates, lwf: lwfStates }, can: { create: may(actor, 'pay.stat.filing.create'), registers: may(actor, 'pay.stat.register.generate') } };
  }

  // ================================================================ filings (FR-01, FR-02; section 9)
  const filingList = defineList({ code: 'pay.stat_filings', label: 'Statutory filings', permission: 'pay.stat.filing.view', from: 'stat_filings x', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.period', 'x.challan_ref'], defaultSort: '-dueDate',
    columns: { docNo: { sql: 'x.doc_no', type: 'text', label: 'Filing' }, type: { sql: 'x.filing_type', type: 'enum', label: 'Type', options: Object.entries(FILING_TYPES), filter: 'eq' }, period: { sql: 'x.period', type: 'text', label: 'Period', filter: 'eq' }, state: { sql: 'x.state_code', type: 'text', label: 'State' }, dueDate: { sql: 'x.due_date', type: 'date', label: 'Due' }, amount: { sql: '(x.amount_paise / 100.0)', type: 'money', label: 'Amount' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(STATUS), filter: 'eq' } } });
  const filingView = (actor, r) => ({ id: r.id, docNo: r.doc_no, type: r.filing_type, typeLabel: FILING_TYPES[r.filing_type], period: r.period, state: r.state_code, dueDate: r.due_date, amount: mask(actor, rs(r.amount_paise)), status: r.status, statusLabel: STATUS[r.status], challanRef: r.challan_ref, challanDate: r.challan_date, paidOn: r.paid_on, paymentRef: r.payment_ref, registerId: r.register_id, late: Boolean(r.paid_on && r.paid_on > r.due_date), requestedBy: r.requested_by, approvedBy: r.approved_by, version: r.version,
    can: { ...flow.can(actor, r), record: r.status === 'APPROVED' && !r.paid_on && may(actor, 'pay.stat.filing.edit', null, null) } });
  const flow = createFlow({ db, base, docType: FILING_DOC, table: 'stat_filings', perm: 'pay.stat.filing', label: 'statutory filing', route: '/payroll/compliance?id=', where: () => ({ pid: null, sid: null }),
    ctx: (r) => ({ total: rs(r.amount_paise), makerRole: 'PAY' }), title: (r) => `${FILING_TYPES[r.filing_type]} ${r.period}${r.state_code !== 'ALL' ? ` ${r.state_code}` : ''}: ₹${rs(r.amount_paise)}`, notifyCode: 'stat.filing.decided', prefix: 'STF',
    beforeSubmit: (_a, r) => { if (!on(r.company_id)) throw unprocessable('Statutory compliance is off for the company (ff.pay.p2404).'); if (!(r.amount_paise > 0)) throw unprocessable('Nothing is payable for this filing: an amount of zero is not sent for approval.'); if (['ECR', 'ESI'].includes(r.filing_type) && !r.register_id) throw unprocessable('Generate the file before sending the filing for approval.'); },
    onApproved: (actor, r) => { db.prepare("UPDATE stat_filings SET approved_amount_paise = amount_paise, updated_at = ? WHERE id = ?").run(nowIso(), r.id); if (r.filing_type === 'BOCW') db.prepare("UPDATE stat_bocw_months SET cess_status = 'DUE', updated_at = ? WHERE filing_id = ?").run(nowIso(), r.id);
      evt('pay.statutory.filing_approved', actor, r.company_id, 'stat_filings', r.id, { filingId: r.id, docNo: r.doc_no, type: r.filing_type, period: r.period, state: r.state_code, amount: rs(r.amount_paise), dueDate: r.due_date }); } });
  const filings = {
    flow,
    list(actor, query) { need(actor, 'pay.stat.filing.view', 'see statutory filings'); return runList(db, filingList, parseListRequest(filingList, query), { select: 'x.*', scopeSql: 'x.company_id = :c', params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => filingView(actor, r) }); },
    get(actor, id) { const r = flow.row(actor, id, 'pay.stat.filing.view'); const o = filingView(actor, r); o.history = flow.history(actor, r.id); Object.assign(o.can, flow.approveInfo(actor, r)); if (r.register_id) o.register = db.prepare('SELECT id, register_type, period, row_count, file_name, generated_at FROM stat_registers WHERE id = ?').get(r.register_id); return o; },
    /** A filing of a period: the amount is read from the locked payroll (or the BOCW cess of the company for the month), the file is generated and validated first. */
    create(actor, b) {
      need(actor, 'pay.stat.filing.create', 'prepare statutory filings'); const c = actor.companyId; if (!on(c)) throw unprocessable('Statutory compliance is off for the company (ff.pay.p2404).');
      const type = b.type; if (!FILING_TYPES[type]) throw badRequest('Correct the highlighted fields', [{ field: 'type', message: 'Choose a payment type.' }]);
      const period = type === 'BOCW' ? b.period : b.period; const st = type === 'PT' || type === 'LWF' ? b.state : 'ALL'; if ((type === 'PT' || type === 'LWF') && !st) throw badRequest('Correct the highlighted fields', [{ field: 'state', message: 'Choose the state.' }]);
      const kind = 'MONTHLY'; const rr = rule(c, type === 'TDS_MONTHLY' && period.slice(5) === '03' ? 'TDS_MONTHLY_MAR' : type, st, `${period}-01`); if (!rr) throw unprocessable(`No statutory rule of ${type} is in force for ${period}.`); if (rr.rule_status !== 'APPROVED') throw unprocessable(`The due date of ${FILING_TYPES[type]} is not confirmed yet (${rr.legal_ref}): confirm it in the statutory rules first.`);
      const due = dueOf(kind, period, rr.p); let amount = 0; let runId = null; let registerId = null;
      if (type === 'BOCW') { amount = db.prepare("SELECT COALESCE(SUM(cess_paise), 0) AS x FROM stat_bocw_months WHERE company_id = ? AND period = ? AND cess_status = 'OPEN' AND deleted_at IS NULL").get(c, period).x; }
      else { const run = regularRun(c, period); if (!run) throw unprocessable(`The payroll of ${period} is not locked: approve the payroll run first.`); runId = run.id;
        if (type === 'ECR') { const f = ecrOf(c, run); registerId = registerOf(actor, { registerType: 'ECR_FILE', period, runId: run.id, file: f }); amount = paise(f.totals.remittance); }
        else if (type === 'ESI') { const f = esiOf(c, run); registerId = registerOf(actor, { registerType: 'ESI_FILE', period, runId: run.id, file: f }); amount = paise(f.totals.ee + f.totals.er); }
        else if (type === 'PT') { amount = paise(stateOf(c, run, 'pt_state', 'PT').totals.amount); }
        else if (type === 'LWF') { amount = paise(stateOf(c, run, 'lwf_state', 'LWF_EE').totals.amount); }
        else if (type === 'TDS_MONTHLY') { amount = run.tds_paise; } }
      if (!(amount > 0) && type !== 'ECR' && type !== 'ESI') throw unprocessable('Nothing is payable for this period: the amount is zero.');
      if ((type === 'ECR' || type === 'ESI') && !(amount > 0)) throw unprocessable('No contributions in the period: nothing to file.');
      let id; try { id = Number(db.prepare("INSERT INTO stat_filings (company_id, doc_no, filing_type, period, state_code, due_date, amount_paise, source_run_id, register_id, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, 'api')").run(c, number(c, actor.user, 'STAT_FILING', 'stat_filings', 'STF'), type, period, st, due, amount, runId, registerId, actor.user).lastInsertRowid); }
      catch (x) { if (/UNIQUE/.test(String(x.message))) throw conflict(`${FILING_TYPES[type]} of ${period}${st !== 'ALL' ? ` ${st}` : ''} exists already.`); throw x; }
      if (type === 'BOCW') db.prepare("UPDATE stat_bocw_months SET filing_id = ?, cess_status = 'DUE', updated_at = ? WHERE company_id = ? AND period = ? AND cess_status = 'OPEN' AND deleted_at IS NULL").run(id, nowIso(), c, period);
      audit(actor, 'stat_filings', id, 'create', c, { newValues: { type, period, state: st, amount: rs(amount), dueDate: due } }); return filings.get(actor, id);
    },
    submit(actor, id) { flow.submit(actor, id); return filings.get(actor, id); },
    withdraw(actor, id, b) { flow.withdraw(actor, id, b); return filings.get(actor, id); },
    cancel(actor, id, b) { flow.cancel(actor, id, b); return filings.get(actor, id); },
    remove(actor, id) { flow.remove(actor, id); return { id: Number(id), deleted: true }; },
    /** FR-02 the challan: the bank reference and date of the payment of an approved filing (after approval only); a payment after the due date is flagged late. */
    record(actor, id, b) { const r = flow.row(actor, id, 'pay.stat.filing.edit'); if (r.status !== 'APPROVED') throw unprocessable('A challan is recorded once the filing is approved.');
      if (b.paidOn > today() || b.paidOn < b.challanDate) throw badRequest('Correct the highlighted fields', [{ field: 'paidOn', message: 'Between the challan date and today.' }]);
      transaction(db, () => { db.prepare('UPDATE stat_filings SET challan_ref = ?, challan_date = ?, paid_on = ?, payment_ref = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.challanRef, b.challanDate, b.paidOn, b.paymentRef ?? null, actor.user, nowIso(), r.id);
        if (r.filing_type === 'BOCW') db.prepare("UPDATE stat_bocw_months SET cess_status = 'PAID', updated_at = ? WHERE filing_id = ?").run(nowIso(), r.id);
        audit(actor, 'stat_filings', r.id, 'challan', r.company_id, { newValues: { challanRef: b.challanRef, paidOn: b.paidOn, late: b.paidOn > r.due_date } });
        evt('pay.statutory.paid', actor, r.company_id, 'stat_filings', r.id, { filingId: r.id, docNo: r.doc_no, type: r.filing_type, period: r.period, paidOn: b.paidOn, late: b.paidOn > r.due_date, amount: rs(r.amount_paise) }); });
      return filings.get(actor, r.id); },
  };

  // ================================================================ registers and files (FR-01, FR-03, FR-04)
  /** Keeps a generated file as a register (the content is kept with its checksum; an ECR or ESI file is kept once per period and run). */
  function registerOf(actor, { registerType, period, runId = null, file, siteId = null, state = null }) {
    const ext = registerType === 'ECR_FILE' || registerType === 'ESI_FILE' ? 'txt' : 'csv';
    const name = `${registerType.toLowerCase()}-${period}${state ? `-${state}` : ''}${siteId ? `-site${siteId}` : ''}.${ext}`;
    const type = ext === 'txt' ? 'text/plain; charset=utf-8' : 'text/csv; charset=utf-8';
    const id = Number(db.prepare("INSERT INTO stat_registers (company_id, register_type, period, state_code, org_site_id, source_run_id, row_count, amount_paise, file_name, content_type, content, checksum, generated_at, generated_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')")
      .run(actor.companyId, registerType, period, state, siteId, runId, file.rows, file.totals?.amount != null ? paise(file.totals.amount) : null, name, type, file.content, sha(file.content), nowIso(), actor.user, actor.user).lastInsertRowid);
    audit(actor, 'stat_registers', id, 'generate', actor.companyId, { newValues: { type: registerType, period, rows: file.rows } }); evt('pay.statutory.file_generated', actor, actor.companyId, 'stat_registers', id, { registerId: id, type: registerType, period, rows: file.rows }); return id;
  }
  const registers = {
    list(actor, q) { need(actor, 'pay.stat.register.view', 'see the registers'); const rows = db.prepare("SELECT id, register_type, period, state_code, org_site_id AS site_id, row_count, amount_paise, file_name, checksum, generated_at, generated_by FROM stat_registers WHERE company_id = ? AND deleted_at IS NULL" + (q.registerType ? ' AND register_type = ?' : '') + ' ORDER BY id DESC LIMIT 200').all(actor.companyId, ...(q.registerType ? [q.registerType] : []));
      return rows.map((r) => ({ id: r.id, type: r.register_type, typeLabel: REGISTER_TYPES[r.register_type], period: r.period, state: r.state_code, siteId: r.site_id, rows: r.row_count, amount: mask(actor, rs(r.amount_paise)), fileName: r.file_name, checksum: r.checksum.slice(0, 12), generatedAt: r.generated_at, generatedBy: r.generated_by })); },
    /** Generates a register or file for a period (or the financial year, the quarter, the site, the state), validated and tied to the payroll. */
    generate(actor, b) {
      const c = actor.companyId; if (!on(c)) throw unprocessable('Statutory compliance is off for the company (ff.pay.p2404).');
      const t = b.registerType; const need1 = t === 'FORM16_BATCH' ? 'pay.stat.form16.generate' : 'pay.stat.register.generate'; need(actor, need1, 'generate this register');
      let out; let rid0;
      if (['ECR_FILE', 'ESI_FILE', 'PT_REPORT', 'LWF_REPORT'].includes(t)) {
        const run = regularRun(c, b.period); if (!run) throw unprocessable(`The payroll of ${b.period} is not locked.`);
        if ((t === 'PT_REPORT' || t === 'LWF_REPORT') && !b.state) throw badRequest('Correct the highlighted fields', [{ field: 'state', message: 'Choose the state.' }]);
        out = t === 'ECR_FILE' ? ecrOf(c, run) : t === 'ESI_FILE' ? esiOf(c, run) : t === 'PT_REPORT' ? stateOf(c, run, 'pt_state', 'PT') : stateOf(c, run, 'lwf_state', 'LWF_EE');
        rid0 = registerOf(actor, { registerType: t, period: b.period, runId: run.id, file: out, state: b.state ?? null });
      } else if (t === 'TDS_24Q_FILE') { out = tdsQuarterOf(c, b.quarter); rid0 = registerOf(actor, { registerType: t, period: b.quarter, file: out }); }
      else if (t === 'FORM16_BATCH') { out = form16Of(c, b.fy); rid0 = registerOf(actor, { registerType: t, period: b.fy, file: out }); }
      else if (['WORKMEN_REGISTER', 'OVERTIME_REGISTER', 'DEDUCTION_REGISTER', 'ADVANCE_REGISTER'].includes(t)) { if (!b.siteId) throw badRequest('Correct the highlighted fields', [{ field: 'siteId', message: 'Choose the site.' }]); const s = db.prepare('SELECT id FROM org_sites WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(b.siteId), c); if (!s) throw notFound('That site does not exist.'); if (!may(actor, need1, null, s.id)) throw forbidden('You may not generate registers for this site.'); out = siteRegister(c, t, s.id, b.period); rid0 = registerOf(actor, { registerType: t, period: b.period, file: out, siteId: s.id }); }
      else throw badRequest('Correct the highlighted fields', [{ field: 'registerType', message: 'Choose a register.' }]);
      return { id: rid0, rows: out.rows, totals: out.totals };
    },
    get(actor, id) { need(actor, 'pay.stat.register.view', 'see the registers'); const r = db.prepare('SELECT * FROM stat_registers WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r) throw notFound('That register does not exist.'); return r; },
    download(actor, id) { need(actor, 'pay.stat.register.export', 'export the registers'); const r = registers.get(actor, id); audit(actor, 'stat_registers', r.id, 'export', actor.companyId, { newValues: { rows: r.row_count } });
      const body = r.content_type.startsWith('text/plain') ? r.content : `${String.fromCharCode(0xfeff)}${r.content}`; return { contentType: r.content_type, fileName: r.file_name, buffer: Buffer.from(body, 'utf8') }; },
    /** The Form 16 / 130 batch as a PDF with a line per employee (the register keeps the same content). */
    form16Pdf(actor, fy) { need(actor, 'pay.stat.form16.generate', 'generate the Form 16 batch'); const f = form16Of(actor.companyId, fy); audit(actor, 'stat_registers', 0, 'export', actor.companyId, { newValues: { form: f.form, fy, rows: f.rows } });
      const head = f.head; const rows = f.data.map((r) => Object.fromEntries(r.map((v, i) => [String(i), v == null ? '' : String(v)])));
      return { contentType: 'application/pdf', fileName: `form-${f.form}-${fy}.pdf`, buffer: toPdf({ title: `Form ${f.form} batch FY ${fy}`, columns: head.map((h, i) => ({ key: String(i), label: h, type: 'text' })), rows, footer: `${f.rows} employees · tax deducted Rs. ${f.totals.tds}` }) }; },
  };

  // ================================================================ rules (effective-dated master data)
  const rules_ = {
    list(actor) { need(actor, 'pay.stat.rule.view', 'see the statutory rules'); return rulesOf(actor.companyId).map((r) => ({ id: r.id, type: r.rule_type, state: r.state_code, params: JSON.parse(r.params_json), effectiveFrom: r.effective_from, effectiveTo: r.effective_to, legalRef: r.legal_ref, status: r.rule_status })); },
    /** Confirms a rule against its notification, or adds the rule of a new effective date (a new row; the old one is kept). */
    save(actor, b) { need(actor, 'pay.stat.rule.configure', 'configure the statutory rules'); const c = actor.companyId;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.effectiveFrom)) throw badRequest('Correct the highlighted fields', [{ field: 'effectiveFrom', message: 'A date such as 2026-04-01.' }]);
      if ((b.legalRef ?? '').trim().length < 10) throw badRequest('Correct the highlighted fields', [{ field: 'legalRef', message: 'Give the notification or section it comes from.' }]);
      const exists = db.prepare("SELECT id FROM stat_rules WHERE COALESCE(company_id, 0) = ? AND rule_type = ? AND state_code = ? AND effective_from = ? AND deleted_at IS NULL").get(c, b.type, b.state ?? 'ALL', b.effectiveFrom);
      if (exists) { db.prepare("UPDATE stat_rules SET params_json = ?, legal_ref = ?, rule_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(b.params), b.legalRef, b.status ?? 'APPROVED', actor.user, nowIso(), exists.id); audit(actor, 'stat_rules', exists.id, 'update', c, { reason: b.legalRef, newValues: { params: b.params } }); return { id: exists.id }; }
      const id = Number(db.prepare("INSERT INTO stat_rules (company_id, rule_type, state_code, params_json, effective_from, legal_ref, rule_status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(c, b.type, b.state ?? 'ALL', JSON.stringify(b.params), b.effectiveFrom, b.legalRef, b.status ?? 'APPROVED', actor.user).lastInsertRowid);
      audit(actor, 'stat_rules', id, 'create', c, { reason: b.legalRef, newValues: { type: b.type, effectiveFrom: b.effectiveFrom } }); return { id }; },
  };

  // ================================================================ BOCW cess (FR-06)
  const bocw = {
    list(actor, q) { need(actor, 'pay.stat.bocw.view', 'see the BOCW cess'); const rate = rule(actor.companyId, 'BOCW_RATE', 'ALL', today())?.p.rateBp ?? 100;
      return db.prepare("SELECT b.*, p.code AS pcode, p.name AS pname FROM stat_bocw_months b JOIN org_projects p ON p.id = b.org_project_id WHERE b.company_id = ? AND b.deleted_at IS NULL" + (q.period ? ' AND b.period = ?' : '') + ' ORDER BY b.period DESC, p.code LIMIT 300').all(actor.companyId, ...(q.period ? [q.period] : [])).map((r) => ({ id: r.id, projectId: r.org_project_id, project: `${r.pcode} ${r.pname}`, period: r.period, cost: mask(actor, rs(r.construction_cost_paise)), costSource: r.source_note, rateBp: r.cess_rate_bp, cess: mask(actor, rs(r.cess_paise)), status: r.cess_status, filingId: r.filing_id, defaultRateBp: rate })); },
    /** The construction cost of a project for a month (from the certified bills or the entered amount, with its source); the cess is the rate of the rule. */
    save(actor, b) { need(actor, 'pay.stat.bocw.manage', 'record the construction cost for the BOCW cess'); const c = actor.companyId; if (!on(c)) throw unprocessable('Statutory compliance is off for the company (ff.pay.p2404).');
      const p = db.prepare('SELECT id FROM org_projects WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(b.projectId), c); if (!p) throw notFound('That project does not exist.'); need(actor, 'pay.stat.bocw.manage', 'record the cost', p.id, null);
      if ((b.source ?? '').trim().length < 5) throw badRequest('Correct the highlighted fields', [{ field: 'source', message: 'Say where the cost comes from (for example the certified bills of the month).' }]);
      const rateBp = rule(c, 'BOCW_RATE', 'ALL', `${b.period}-01`)?.p.rateBp ?? 100; const cost = paise(b.constructionCost); const cess = Math.round((cost * rateBp) / 10000);
      const ex = db.prepare('SELECT * FROM stat_bocw_months WHERE company_id = ? AND org_project_id = ? AND period = ? AND deleted_at IS NULL').get(c, p.id, b.period);
      if (ex && ex.cess_status === 'PAID') throw conflict('The cess of this month is paid: a correction is recorded in the next month.');
      if (ex) db.prepare("UPDATE stat_bocw_months SET construction_cost_paise = ?, source_note = ?, cess_rate_bp = ?, cess_paise = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(cost, b.source, rateBp, cess, actor.user, nowIso(), ex.id);
      else db.prepare("INSERT INTO stat_bocw_months (company_id, org_project_id, period, construction_cost_paise, source_note, cess_rate_bp, cess_paise, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(c, p.id, b.period, cost, b.source, rateBp, cess, actor.user);
      audit(actor, 'stat_bocw_months', ex?.id ?? 0, 'save', c, { reason: b.source, newValues: { project: p.id, period: b.period, cost: rs(cost), cess: rs(cess) } }); return { cess: rs(cess), rateBp }; },
  };

  // ================================================================ bonus and gratuity (FR-05)
  const comps = {
    bonus(actor, q) { need(actor, 'pay.stat.register.view', 'see the bonus computation'); if (!seesPay(actor)) throw forbidden('You may not see the bonus amounts (permission pay.salary.view).'); return bonusOf(actor.companyId, q.fy, q.pct == null ? null : Number(q.pct)); },
    gratuity(actor, q) { need(actor, 'pay.stat.register.view', 'see the gratuity computation'); if (!seesPay(actor)) throw forbidden('You may not see the gratuity amounts (permission pay.salary.view).'); return gratuityOf(actor.companyId, q.employeeId, q.leavingDate); },
    provision(actor, q) { need(actor, 'pay.stat.register.view', 'see the gratuity provision'); if (!seesPay(actor)) throw forbidden('You may not see the gratuity provision (permission pay.salary.view).'); return gratuityProvision(actor.companyId, q.fy); },
  };
  return { filings, registers, rules: rules_, bocw, comps, calendarOf: (actor, fy) => { need(actor, 'pay.stat.calendar.view', 'see the statutory calendar'); return calendarOf(actor, actor.companyId, fy); }, ecrOf, esiOf, dueOf, rule, linesOf, form16Of, quarterOf, monthsOfFy, fyStartOf, _ecrRecord: ecrRecord };
}
export const STAT_STATUS = STATUS;
