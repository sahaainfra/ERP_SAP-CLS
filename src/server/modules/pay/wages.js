import { transaction } from '../../platform/db/index.js';
import { toPdf } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { todayIST } from '../../../shared/dates.js';
import { nowIso, rid, same } from '../proc/base.js';
import { qaHelpers } from '../qa/common.js';
import { STATUS, createFlow } from '../qa/flow.js';

// Part 24.03: labour wages and contract labour payroll.
//  FR-01 the wages of the direct (departmental) labour of a site: the days and the overtime from the labour punches of 07.06 (a worker's day from the first IN to
//  the last OUT less the rest interval: a full day from the hours of a working day, half a day from half of them, overtime beyond in blocks), the daily rate — the
//  contract rate or the state minimum wage for the skill, whichever is higher (07.08) — overtime at the multiplier of the ordinary rate, piece work from the
//  measured quantities (22.01) with the minimum wage of the days guaranteed, allowances, deductions (advance, canteen, other, PF and ESI when the worker has a UAN
//  or an ESIC number) within the cap of the Code on Wages. FR-02 weekly, fortnightly (1–15, 16–end) or monthly cycles. BR-01 a rate below the minimum is refused.
//  The run is approved SACC → PM → HRMGR (the SACC step is skipped when the SACC prepared it), locked, then each worker is paid by bank or cash (FR-04) and
//  acknowledges on the supervisor's phone by the QR of the worker card or a photograph; a payment after the due date of the cycle is recorded as late.
//  FR-03 the principal employer verifies a labour contractor's wage sheet of a month against the attendance: missing workers, fewer days than attended, wages
//  below the minimum, late or no payment; the verifier verifies, returns or holds the contractor's payments (21.04, through the hold sources of the
//  subcontractor workspace). FR-05 the muster roll and the wage register of a period (24.04 reads them).

export const WAGE_DOC = 'PAY_WAGE_RUN';
export const CYCLES = ['WEEKLY', 'FORTNIGHTLY', 'MONTHLY'];
export const CHECK_STATUS = { DRAFT: 'Being compiled', SUBMITTED: 'Waiting for verification', VERIFIED: 'Verified', RETURNED: 'Returned for correction', VARIANCE: 'Variance: payments held' };
const DAY = 86_400_000;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const monthEnd = (iso) => { const [y, m] = iso.slice(0, 7).split('-').map(Number); return `${iso.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
const daysIn = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY) + 1;
const minutesOf = (iso) => Math.floor(Date.parse(iso) / 60_000);
const rs = (p) => (p == null ? null : p / 100);
const paise = (v) => Math.round(Number(v ?? 0) * 100);
const milli = (v) => Math.round(Number(v ?? 0) * 1000);
const un = (m) => (m == null ? null : m / 1000);

/** FR-02: the period of a wage cycle that starts on a day — a week of seven days; a fortnight 1–15 or 16–end of the month; a calendar month. Pure. */
export function cycleOf(cycle, from) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? '')) return { error: 'Give the first day of the period.' };
  const d = Number(from.slice(8, 10));
  if (cycle === 'WEEKLY') return { from, to: addDays(from, 6) };
  if (cycle === 'FORTNIGHTLY') { if (d !== 1 && d !== 16) return { error: 'A fortnight starts on the 1st or the 16th.' }; return { from, to: d === 1 ? `${from.slice(0, 8)}15` : monthEnd(from) }; }
  if (cycle === 'MONTHLY') { if (d !== 1) return { error: 'A month starts on the 1st.' }; return { from, to: monthEnd(from) }; }
  return { error: 'Choose weekly, fortnightly or monthly.' };
}

/** FR-01: a worker's day from the punches (first IN, last OUT): the day (1, ½ or 0) and the overtime minutes in whole blocks. Without an OUT the day counts as
 *  one and is flagged for the supervisor (no overtime is paid on it). Pure. */
export function dayOf(punches, rules) {
  const ins = punches.filter((p) => p.type === 'IN').map((p) => p.at).sort(); const outs = punches.filter((p) => p.type === 'OUT').map((p) => p.at).sort();
  if (!ins.length) return null; const first = ins[0]; const last = outs.length ? outs[outs.length - 1] : null;
  if (!last || last <= first) return { in: first, out: null, workedMinutes: null, day: 1, otMinutes: 0, missingOut: true };
  const day = rules.dayHours * 60; const span = minutesOf(last) - minutesOf(first); const worked = span > day ? span - rules.restMinutes : span;
  const ot = Math.max(0, worked - day); const block = rules.otBlockMinutes || 1;
  return { in: first, out: last, workedMinutes: worked, day: worked >= day ? 1 : worked >= rules.halfDayHours * 60 ? 0.5 : 0, otMinutes: Math.floor(ot / block) * block, missingOut: false };
}

/** FR-01: the wages of a line, in paise. Daily: days × rate; piece: quantity × piece rate with the minimum wage of the days guaranteed (the top-up); overtime at
 *  the multiplier of the ordinary hourly rate (the daily rate ÷ the hours of a day; for piece work the minimum); PF on the wages without overtime and allowances
 *  up to the ceiling for the period; ESI when the monthly wage (26 days) is within the ceiling; the deductions within the cap of the Code on Wages. Pure. */
export function wageOf(o) {
  const days = o.days ?? 0; const piece = o.basis === 'PIECE'; const rate = o.rate ?? 0; const min = o.minRate ?? null;
  const basic = piece ? 0 : Math.round(days * rate); const pieceAmt = piece ? Math.round((o.pieceQty ?? 0) * (o.pieceRate ?? 0)) : 0;
  const topup = piece && min != null ? Math.max(0, Math.round(days * min) - pieceAmt) : 0;
  const ordinary = piece ? (min ?? 0) : rate; const otRate = Math.round((ordinary / o.dayHours) * o.otMultiplier); const ot = Math.round((o.otHours ?? 0) * otRate);
  const allowances = o.allowances ?? 0; const gross = basic + pieceAmt + topup + ot + allowances; const wages = basic + pieceAmt + topup;
  let pf = 0; let pfEr = 0; if (o.pf) { const ceil = o.pf.restrictToCeiling === false ? Infinity : Math.round((o.pf.wageCeiling * 100 * o.periodDays) / 30); const b = Math.min(wages, ceil); pf = Math.round((b * o.pf.employeeRate) / 100); pfEr = Math.round((b * ((o.pf.employerEpfRate ?? 0) + (o.pf.epsRate ?? 0) + (o.pf.edliRate ?? 0) + (o.pf.adminRate ?? 0))) / 100); }
  let esi = 0; let esiEr = 0; const esiCovered = Boolean(o.esi) && (piece ? (min ?? 0) : rate) * 26 <= o.esi.wageCeiling * 100;
  if (esiCovered) { esi = Math.ceil((gross * o.esi.employeeRate) / 10000) * 100; esiEr = Math.ceil((gross * o.esi.employerRate) / 10000) * 100; }
  const own = (o.advance ?? 0) + (o.canteen ?? 0) + (o.other ?? 0); const deductions = own + pf + esi; const net = gross - deductions;
  const flags = [];
  if (!piece && min != null && rate < min) flags.push({ code: 'BELOW_MINIMUM', severity: 'BLOCK', message: `The rate ₹${rs(rate)} is below the minimum wage ₹${rs(min)} a day.` });
  if (min == null) flags.push({ code: 'NO_MINIMUM', severity: 'WARN', message: 'No minimum wage is on file for the state and the skill: add it in the labour wage rates (07.08).' });
  if (topup > 0) flags.push({ code: 'MIN_TOPUP', severity: 'INFO', message: `Piece work below the minimum wage of the days: ₹${rs(topup)} added.` });
  if (o.capPct != null && gross > 0 && deductions > Math.round((gross * o.capPct) / 100)) flags.push({ code: 'DEDUCTION_CAP', severity: 'BLOCK', message: `Deductions ₹${rs(deductions)} are above ${o.capPct} % of the wages (Code on Wages s.18).` });
  if (net < 0) flags.push({ code: 'NEGATIVE_NET', severity: 'BLOCK', message: 'The deductions are more than the wages.' });
  return { basic, piece: pieceAmt, topup, ot, otRate, allowances, gross, pf, esi, pfEr, esiEr, employer: pfEr + esiEr, deductions, net, esiCovered, flags };
}

/** FR-03: the contractor's wage sheet against the attendance of the month. attendance: [{ workerId, code, name, days, otHours, minRate }]; sheet: [{ workerCode,
 *  days, otHours, gross, deductions, net, paidOn }] (money in rupees). A worker missing from the sheet, fewer days than attended, wages below the minimum of the
 *  days and the overtime, no payment or a payment after the due date are blocking; more days than attended and workers paid without attendance are warnings. Pure. */
export function compareSheet({ attendance, sheet, dueOn, dayHours, otMultiplier, capPct }) {
  const out = []; const byCode = new Map(sheet.map((s) => [String(s.workerCode).toUpperCase(), s])); const seen = new Set();
  const add = (code, severity, w, message, extra = {}) => out.push({ code, severity, workerCode: w.code ?? w.workerCode, worker: w.name ?? null, message, ...extra });
  for (const a of attendance) {
    const s = byCode.get(String(a.code).toUpperCase()); seen.add(String(a.code).toUpperCase());
    if (!s) { add('MISSING_FROM_SHEET', 'BLOCK', a, `Attended ${a.days} day(s) but is not on the wage sheet.`, { attendanceDays: a.days }); continue; }
    if (s.days < a.days - 0.001) add('DAYS_SHORT', 'BLOCK', a, `Paid for ${s.days} day(s), attended ${a.days}.`, { attendanceDays: a.days, sheetDays: s.days });
    else if (s.days > a.days + 0.001) add('DAYS_EXCESS', 'WARN', a, `Paid for ${s.days} day(s), attended only ${a.days}.`, { attendanceDays: a.days, sheetDays: s.days });
    if (a.minRate != null) { const due = Math.round(Math.min(s.days, a.days) * a.minRate + Math.min(s.otHours ?? 0, a.otHours ?? 0) * Math.round((a.minRate / dayHours) * otMultiplier)); if (paise(s.gross) + 100 < due) add('BELOW_MINIMUM', 'BLOCK', a, `Wages ₹${s.gross} are below the minimum ₹${rs(due)} for the days and overtime.`, { minimum: rs(due), gross: s.gross }); }
    else add('NO_MINIMUM', 'WARN', a, 'No minimum wage on file for the worker\'s skill: the wages could not be checked.');
    if (capPct != null && s.gross > 0 && s.deductions > (s.gross * capPct) / 100 + 0.005) add('DEDUCTION_CAP', 'WARN', a, `Deductions ₹${s.deductions} are above ${capPct} % of the wages.`);
    if (!s.paidOn) add('NOT_PAID', 'BLOCK', a, 'No date of payment on the sheet.');
    else if (s.paidOn > dueOn) add('LATE_PAYMENT', 'BLOCK', a, `Paid on ${s.paidOn}, due by ${dueOn}.`, { paidOn: s.paidOn, dueOn });
  }
  for (const s of sheet) if (!seen.has(String(s.workerCode).toUpperCase())) add(s.known ? 'NO_ATTENDANCE' : 'UNKNOWN_WORKER', 'WARN', s, s.known ? `On the sheet for ${s.days} day(s) without attendance at the site.` : 'Not a registered worker of the contractor.');
  return { variances: out, blocking: out.filter((v) => v.severity === 'BLOCK').length };
}

export const wageRunList = defineList({
  code: 'pay.wage_runs', label: 'Wage runs', permission: 'pay.wage_run.view', from: 'pay_wage_runs x JOIN org_sites s ON s.id = x.org_site_id JOIN mdm_partners c ON c.id = x.contractor_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 's.name', 'c.legal_name'], defaultSort: '-periodFrom',
  columns: { docNo: { sql: 'x.doc_no', type: 'text', label: 'Run' }, site: { sql: 's.name', type: 'text', label: 'Site' }, contractor: { sql: 'c.legal_name', type: 'text', label: 'Labour contractor' }, siteId: { sql: 'x.org_site_id', type: 'number', label: 'Site', filter: 'eq' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project', filter: 'eq' },
    cycle: { sql: 'x.cycle', type: 'enum', label: 'Cycle', options: [['WEEKLY', 'Weekly'], ['FORTNIGHTLY', 'Fortnightly'], ['MONTHLY', 'Monthly']], filter: 'eq' }, periodFrom: { sql: 'x.period_from', type: 'date', label: 'From' }, periodTo: { sql: 'x.period_to', type: 'date', label: 'To' },
    workers: { sql: 'x.workers_count', type: 'number', label: 'Workers' }, net: { sql: '(x.net_paise / 100.0)', type: 'money', label: 'Net' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(STATUS), filter: 'eq' } },
});
export const wageCheckList = defineList({
  code: 'pay.wage_checks', label: 'Contractor wage verification', permission: 'pay.wage_check.view', from: 'pay_contractor_wage_checks x JOIN mdm_partners c ON c.id = x.contractor_id JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'c.legal_name', 'p.code'], defaultSort: 'verifyDue',
  columns: { docNo: { sql: 'x.doc_no', type: 'text', label: 'Check' }, contractor: { sql: 'c.legal_name', type: 'text', label: 'Labour contractor' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, period: { sql: 'x.period', type: 'text', label: 'Month', filter: 'eq' },
    verifyDue: { sql: 'x.verify_due_on', type: 'date', label: 'Verify by' }, variances: { sql: 'x.variance_count', type: 'number', label: 'Variances' }, workers: { sql: 'x.workers_count', type: 'number', label: 'Workers' },
    status: { sql: 'x.check_status', type: 'enum', label: 'Status', options: Object.entries(CHECK_STATUS), filter: 'eq' } },
});

/** @param {{ db: any, base: any, flags: any, setup: any, labour: () => any, ctr: () => any }} o */
export function createPayWageService({ db, base, flags, setup, labour, ctr }) {
  const { may, audit, notify } = base; const { evt, gate, scopeOf, pcode, fileOk } = qaHelpers({ db, base });
  const today = () => todayIST();
  const on = (companyId) => flags.isOn({ companyId, user: 'system', roles: [] }, 'ff.pay.p2403');
  const lab = () => { const l = labour(); if (!l) throw unprocessable('The labour module (07.08) is not running: wage rates cannot be read.'); return l; };
  const rolesOf = (companyId, user) => { try { return JSON.parse(db.prepare('SELECT roles_json FROM iam_users WHERE company_id = ? AND username = ?').get(companyId, user)?.roles_json ?? '[]').flat(); } catch { return []; } };
  const seesRates = (actor, r) => may(actor, 'pay.wage_rate.view', r?.org_project_id ?? null, r?.org_site_id ?? null);
  const site = (id) => db.prepare('SELECT s.*, p.code AS pcode, p.name AS pname, p.branch_id, b.state_code FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id LEFT JOIN org_branches b ON b.id = p.branch_id WHERE s.id = ? AND s.deleted_at IS NULL').get(rid(id));
  const partner = (id) => db.prepare('SELECT id, legal_name FROM mdm_partners WHERE id = ?').get(rid(id));
  /** The working-day rules (OT) and the Code-on-Wages rules (MIN_WAGE) in force on a day: dated master data of 24.01. */
  const rulesAt = (companyId, date) => { const ot = setup.paramsAt(companyId, 'OT', null, date) ?? {}; const mw = setup.paramsAt(companyId, 'MIN_WAGE', null, date) ?? {};
    return { dayHours: ot.dayHours ?? 8, restMinutes: ot.restMinutes ?? 60, halfDayHours: ot.halfDayHours ?? 4, otBlockMinutes: ot.otBlockMinutes ?? 30, otMultiplier: ot.multiplier ?? 2, payDueDays: mw.payDueDays ?? { WEEKLY: 0, FORTNIGHTLY: 2, MONTHLY: 7 }, capPct: mw.deductionCapPct ?? 50, verifyDays: mw.verifyDays ?? 3, set: Boolean(ot.dayHours && mw.payDueDays) }; };

  // ---- attendance of workers from the punches of 07.06 ----
  /** The days of the workers of a contractor at a site (or at every site of a project) between two days: { workerId: { days: [...], days total, ot hours } }. */
  function attendanceOf(companyId, { contractorId, siteId, projectId, from, to, rules }) {
    const rows = db.prepare(`SELECT t.person_id, t.work_date, t.punch_type, t.effective_time, t.result FROM att_punches t JOIN lab_workers w ON w.id = t.person_id AND t.person_type = 'WORKER' WHERE t.company_id = ? AND w.contractor_id = ? AND t.work_date BETWEEN ? AND ? AND t.result IN ('ACCEPTED', 'FLAGGED') AND t.deleted_at IS NULL AND ${siteId ? 't.punch_site_id = ?' : 't.punch_site_id IN (SELECT id FROM org_sites WHERE org_project_id = ?)'} ORDER BY t.person_id, t.work_date, t.effective_time`).all(companyId, contractorId, from, to, siteId ?? projectId);
    const by = new Map(); for (const r of rows) { const k = r.person_id; if (!by.has(k)) by.set(k, new Map()); const m = by.get(k); if (!m.has(r.work_date)) m.set(r.work_date, []); m.get(r.work_date).push({ type: r.punch_type, at: r.effective_time, flagged: r.result === 'FLAGGED' }); }
    const out = new Map(); for (const [wid, m] of by) { const days = []; for (const [date, ps] of m) { const d = dayOf(ps, rules); if (d) days.push({ date, ...d, flagged: ps.some((p) => p.flagged) }); }
      out.set(wid, { days, total: days.reduce((a, d) => a + d.day, 0), otMinutes: days.reduce((a, d) => a + d.otMinutes, 0), missingOut: days.filter((d) => d.missingOut).length, flagged: days.filter((d) => d.flagged).length }); }
    return out;
  }
  const workerOf = (companyId, id) => db.prepare("SELECT * FROM lab_workers WHERE id = ? AND company_id = ? AND root_id = id AND deleted_at IS NULL").get(id, companyId);

  // ================================================================== wage runs (FR-01, FR-02, FR-04)
  const flow = createFlow({ db, base, docType: WAGE_DOC, table: 'pay_wage_runs', perm: 'pay.wage_run', label: 'wage run', route: '/payroll/wage-runs?id=',
    ctx: (r) => ({ total: rs(r.net_paise), makerRole: rolesOf(r.company_id, r.requested_by ?? r.created_by).includes('SACC') ? 'SACC' : 'OTHER' }),
    title: (r) => `Wages ${r.period_from} to ${r.period_to}: ${r.workers_count} workers, net ₹${rs(r.net_paise)}`, notifyCode: 'pay.wage_run.decided', prefix: 'WAGE',
    beforeSubmit: (actor, r) => { if (!on(r.company_id)) throw unprocessable('Labour wages are off for the company (ff.pay.p2403).'); compute(actor, r); const x = db.prepare('SELECT * FROM pay_wage_runs WHERE id = ?').get(r.id);
      if (!x.workers_count) throw unprocessable('No worker has attendance in the period: there is nothing to pay.'); if (x.blocking_count) throw unprocessable(`${x.blocking_count} worker(s) have a blocking check (rate below the minimum, deductions above the cap or negative net): correct them first.`); },
    onApproved: (actor, r) => lock(actor, db.prepare('SELECT * FROM pay_wage_runs WHERE id = ?').get(r.id)) });
  function lock(actor, r) {
    db.prepare('UPDATE pay_wage_runs SET locked_at = ? WHERE id = ?').run(nowIso(), r.id);
    evt('pay.wage_run.approved', actor, r.company_id, 'pay_wage_runs', r.id, { runId: r.id, docNo: r.doc_no, projectId: r.org_project_id, siteId: r.org_site_id, contractorId: r.contractor_id, cycle: r.cycle, periodFrom: r.period_from, periodTo: r.period_to, payDueOn: r.pay_due_on, workers: r.workers_count, gross: rs(r.gross_paise), deductions: rs(r.deductions_paise), employer: rs(r.employer_paise), net: rs(r.net_paise) }, r.org_project_id);
    notify(r.company_id, 'pay.wage_run.decided', [`user:${r.requested_by}`, 'permission:pay.wage_run.disburse'], r.doc_no, 'approved: pay the workers', `${r.doc_no} is approved: pay the ${r.workers_count} workers by ${r.pay_due_on} and take their acknowledgement.`, `/payroll/wage-runs?id=${r.id}`, `${r.id}-approved`, { projectId: r.org_project_id, siteId: r.org_site_id });
  }
  const inputsOf = (l) => ({ basis: l.pay_basis, pieceQty: un(l.piece_qty_milli), pieceRate: l.piece_rate_paise, pieceUom: l.piece_uom, pieceSources: JSON.parse(l.piece_source_json || '[]'), rateOverride: l.rate_override_paise, allowances: l.allowances_paise, advance: l.advance_paise, canteen: l.canteen_paise, other: l.other_ded_paise, adjust: JSON.parse(l.adjust_json || '[]'), paid: l.paid_on ? { mode: l.paid_mode, on: l.paid_on, ref: l.paid_ref, by: l.paid_by } : null });
  /** One worker's line from the attendance and the inputs kept on the line. */
  function lineOf(r, w, att, input, rules, cache) {
    const l = lab(); const key = `${w.contractor_id}:${w.trade_code}:${w.skill_category}:${r.state_code ?? w.home_state}`;
    const rate = cache.get(key) ?? (() => { const st = r.state_code ?? w.home_state ?? null; const q = { contractorId: w.contractor_id, tradeCode: w.trade_code, skillCategory: w.skill_category, stateCode: st, date: r.period_to }; const v = { daily: l.applicable(r.company_id, { ...q, payBasis: 'DAILY' }), piece: l.applicable(r.company_id, { ...q, payBasis: 'PIECE' }) }; cache.set(key, v); return v; })();
    const adj = (f) => input.adjust.filter((a) => a.field === f).reduce((a, b) => a + b.delta, 0);
    const days = Math.max(0, (att?.total ?? 0) + adj('days')); const otHours = Math.max(0, (att?.otMinutes ?? 0) / 60 + adj('otHours'));
    const minRate = rate.daily.minimum?.rateMinor ?? null; const daily = input.rateOverride ?? rate.daily.rate?.rateMinor ?? null;
    const pieceRate = input.basis === 'PIECE' ? (input.pieceRate ?? rate.piece.rate?.rateMinor ?? null) : null;
    const pfP = w.uan ? memo(cache, `pf:${r.period_to}`, () => setup.paramsAt(r.company_id, 'PF', null, r.period_to)) : null; const esiP = w.esic_ip ? memo(cache, `esi:${r.period_to}`, () => setup.paramsAt(r.company_id, 'ESI', null, r.period_to)) : null;
    const x = wageOf({ basis: input.basis, days, otHours, rate: daily ?? 0, minRate, pieceQty: input.pieceQty ?? 0, pieceRate: pieceRate ?? 0, dayHours: rules.dayHours, otMultiplier: rules.otMultiplier, allowances: input.allowances ?? 0, advance: input.advance ?? 0, canteen: input.canteen ?? 0, other: input.other ?? 0, pf: pfP, esi: esiP, periodDays: daysIn(r.period_from, r.period_to), capPct: rules.capPct });
    const flags = [...x.flags];
    if (input.basis !== 'PIECE' && daily == null) flags.push({ code: 'NO_RATE', severity: 'BLOCK', message: 'No contract rate or minimum wage for the worker\'s skill: add one in the labour wage rates.' });
    if (input.basis === 'PIECE' && pieceRate == null) flags.push({ code: 'NO_PIECE_RATE', severity: 'BLOCK', message: 'Give the piece rate (no approved piece rate of the contractor).' });
    if (input.basis === 'PIECE' && !(input.pieceQty > 0)) flags.push({ code: 'NO_PIECE_QTY', severity: 'WARN', message: 'No quantity of piece work: the minimum wage of the days is paid.' });
    if (att?.missingOut) flags.push({ code: 'MISSING_OUT', severity: 'WARN', message: `${att.missingOut} day(s) without an OUT punch counted as full days: confirm the muster.` });
    if (att?.flagged) flags.push({ code: 'PUNCH_FLAGGED', severity: 'INFO', message: `${att.flagged} day(s) from flagged punches.` });
    if (!w.bank_last4) flags.push({ code: 'NO_BANK', severity: 'INFO', message: 'No bank account: pay in cash against acknowledgement.' });
    if (input.adjust.length) flags.push({ code: 'ADJUSTED', severity: 'INFO', message: input.adjust.map((a) => `${a.field} ${a.delta > 0 ? '+' : ''}${a.delta}: ${a.reason}`).join('; ') });
    return { days, otHours, minRate, rate: input.basis === 'PIECE' ? 0 : (daily ?? 0), rateSource: input.rateOverride != null ? 'OVERRIDE' : rate.daily.rate?.source ?? null, pieceRate, x, flags, att };
  }
  const memo = (cache, k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };
  /** FR-01: (re)compute a run: the workers with attendance in the period, each line from its attendance and the inputs kept on it; the totals. */
  function compute(actor, r) {
    const c = r.company_id; const rules = rulesAt(c, r.period_to); const att = attendanceOf(c, { contractorId: r.contractor_id, siteId: r.org_site_id, from: r.period_from, to: r.period_to, rules });
    const kept = new Map(db.prepare('SELECT * FROM pay_wage_lines WHERE run_id = ? AND deleted_at IS NULL').all(r.id).map((l) => [l.worker_id, inputsOf(l)]));
    const ids = [...new Set([...att.keys(), ...[...kept.entries()].filter(([, i]) => i.basis === 'PIECE' || i.adjust.length).map(([k]) => k)])];
    const blank = { basis: 'DAILY', pieceQty: null, pieceRate: null, pieceUom: null, pieceSources: [], rateOverride: null, allowances: 0, advance: 0, canteen: 0, other: 0, adjust: [], paid: null };
    const COLS = ['trade_code', 'skill_category', 'pay_basis', 'days_milli', 'ot_milli', 'piece_qty_milli', 'piece_uom', 'piece_rate_paise', 'piece_source_json', 'rate_paise', 'min_rate_paise', 'rate_source', 'rate_override_paise', 'ot_rate_paise', 'basic_paise', 'ot_paise', 'piece_paise', 'topup_paise', 'allowances_paise', 'gross_paise', 'advance_paise', 'canteen_paise', 'other_ded_paise', 'pf_paise', 'esi_paise', 'deductions_paise', 'employer_paise', 'net_paise', 'days_json', 'adjust_json', 'flags_json'];
    const ins = db.prepare(`INSERT INTO pay_wage_lines (company_id, run_id, worker_id, ${COLS.join(', ')}, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ${COLS.map(() => '?').join(', ')}, ?, ?, ?, 'pay_wage_runs')`);
    const upd = db.prepare(`UPDATE pay_wage_lines SET ${COLS.map((c) => `${c} = ?`).join(', ')}, updated_by = ?, updated_at = ? WHERE id = ?`);
    const lineIds = new Map(db.prepare('SELECT id, worker_id FROM pay_wage_lines WHERE run_id = ? AND deleted_at IS NULL').all(r.id).map((x) => [x.worker_id, x.id]));
    return transaction(db, () => {
      const keep = new Set(); const excluded = []; const T = { n: 0, days: 0, ot: 0, gross: 0, ded: 0, er: 0, net: 0, flags: 0, block: 0 }; const cache = new Map();
      for (const wid of ids) { const w = workerOf(c, wid); if (!w) continue; if (w.worker_status !== 'ACTIVE' && !att.has(wid)) continue;
        if (w.worker_status === 'BLACKLISTED') { excluded.push({ workerId: wid, worker: `${w.worker_code} ${w.name}`, reason: 'BLACKLISTED' }); continue; }
        const input = kept.get(wid) ?? blank; const L = lineOf(r, w, att.get(wid), input, rules, cache); const x = L.x;
        const vals = [w.trade_code, w.skill_category, input.basis, milli(L.days), milli(L.otHours), milli(input.pieceQty ?? 0), input.pieceUom ?? null, L.pieceRate, JSON.stringify(input.pieceSources), L.rate, L.minRate, L.rateSource, input.rateOverride, x.otRate, x.basic, x.ot, x.piece, x.topup, x.allowances, x.gross, input.advance ?? 0, input.canteen ?? 0, input.other ?? 0, x.pf, x.esi, x.deductions, x.employer, x.net, JSON.stringify(L.att?.days ?? []), JSON.stringify(input.adjust), JSON.stringify(L.flags)];
        if (lineIds.has(wid)) upd.run(...vals, actor.user, nowIso(), lineIds.get(wid)); else ins.run(c, r.id, wid, ...vals, r.org_project_id, r.org_site_id, actor.user); keep.add(wid);
        T.n += 1; T.days += milli(L.days); T.ot += milli(L.otHours); T.gross += x.gross; T.ded += x.deductions; T.er += x.employer; T.net += x.net; if (L.flags.some((f) => f.severity !== 'INFO')) T.flags += 1; if (L.flags.some((f) => f.severity === 'BLOCK')) T.block += 1; }
      for (const [wid, lid] of lineIds) if (!keep.has(wid)) db.prepare('DELETE FROM pay_wage_lines WHERE id = ?').run(lid);
      const summary = { excluded, rules, attendanceWorkers: att.size, rulesFromMaster: rules.set };
      db.prepare('UPDATE pay_wage_runs SET workers_count = ?, days_milli = ?, ot_milli = ?, gross_paise = ?, deductions_paise = ?, employer_paise = ?, net_paise = ?, flags_count = ?, blocking_count = ?, summary_json = ?, computed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(T.n, T.days, T.ot, T.gross, T.ded, T.er, T.net, T.flags, T.block, JSON.stringify(summary), nowIso(), actor.user, nowIso(), r.id);
      audit(actor, 'pay_wage_runs', r.id, 'compute', c, { newValues: { workers: T.n, net: rs(T.net), blocking: T.block } });
    });
  }
  const workerNames = (ids) => new Map(ids.length ? db.prepare(`SELECT id, worker_code, name, bank_last4, uan, esic_ip FROM lab_workers WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((w) => [w.id, w]) : []);
  const lineView = (actor, r, l, w) => { const s = seesRates(actor, r); const m = (v) => (s ? rs(v) : null);
    return { id: l.id, workerId: l.worker_id, workerCode: w?.worker_code ?? null, worker: w?.name ?? null, trade: l.trade_code, skill: l.skill_category, basis: l.pay_basis, days: un(l.days_milli), otHours: un(l.ot_milli), pieceQty: un(l.piece_qty_milli), pieceUom: l.piece_uom, pieceRate: m(l.piece_rate_paise), pieceSources: JSON.parse(l.piece_source_json),
      rate: m(l.rate_paise), minRate: m(l.min_rate_paise), rateSource: s ? l.rate_source : null, rateOverride: m(l.rate_override_paise), otRate: m(l.ot_rate_paise), basic: m(l.basic_paise), ot: m(l.ot_paise), piece: m(l.piece_paise), topup: m(l.topup_paise), allowances: m(l.allowances_paise), gross: m(l.gross_paise),
      advance: m(l.advance_paise), canteen: m(l.canteen_paise), other: m(l.other_ded_paise), pf: m(l.pf_paise), esi: m(l.esi_paise), deductions: m(l.deductions_paise), employer: m(l.employer_paise), net: rs(l.net_paise), dayLog: JSON.parse(l.days_json), adjust: JSON.parse(l.adjust_json), flags: JSON.parse(l.flags_json),
      bank: w?.bank_last4 ? `••${w.bank_last4}` : null, pf_: Boolean(w?.uan), esi_: Boolean(w?.esic_ip), paidMode: l.paid_mode, paidOn: l.paid_on, paidRef: l.paid_ref, paidBy: l.paid_by, late: Boolean(l.paid_on && l.paid_on > r.pay_due_on), ack: l.ack_status, ackMethod: l.ack_method, ackBy: l.ack_by, ackAt: l.ack_at, ackNote: l.ack_note, version: l.version }; };
  const view = (actor, r, detail = false) => {
    const s = site(r.org_site_id); const o = { id: r.id, docNo: r.doc_no, projectId: r.org_project_id, project: s?.pcode ?? null, siteId: r.org_site_id, site: s?.name ?? null, contractorId: r.contractor_id, contractor: partner(r.contractor_id)?.legal_name ?? null, cycle: r.cycle, periodFrom: r.period_from, periodTo: r.period_to, payDueOn: r.pay_due_on, state: r.state_code,
      workers: r.workers_count, days: un(r.days_milli), otHours: un(r.ot_milli), gross: rs(r.gross_paise), deductions: rs(r.deductions_paise), employer: rs(r.employer_paise), net: rs(r.net_paise), flags: r.flags_count, blocking: r.blocking_count, paid: r.paid_count, acknowledged: r.acked_count, computedAt: r.computed_at, lockedAt: r.locked_at, disbursedAt: r.disbursed_at,
      status: r.status, statusLabel: STATUS[r.status], requestedBy: r.requested_by, approvedBy: r.approved_by, version: r.version, rates: seesRates(actor, r),
      can: { ...flow.can(actor, r), compute: ['DRAFT', 'RETURNED'].includes(r.status) && may(actor, 'pay.wage_run.edit', r.org_project_id, r.org_site_id), disburse: r.status === 'APPROVED' && r.paid_count < r.workers_count && may(actor, 'pay.wage_run.disburse', r.org_project_id, r.org_site_id), acknowledge: r.status === 'APPROVED' && r.paid_count > 0 && may(actor, 'pay.wage_run.acknowledge', r.org_project_id, r.org_site_id) } };
    if (detail) { const lines = db.prepare('SELECT * FROM pay_wage_lines WHERE run_id = ? AND deleted_at IS NULL ORDER BY id').all(r.id); const ws = workerNames(lines.map((l) => l.worker_id)); o.lines = lines.map((l) => lineView(actor, r, l, ws.get(l.worker_id))).sort((a, b) => String(a.workerCode).localeCompare(String(b.workerCode))); o.summary = JSON.parse(r.summary_json || '{}'); Object.assign(o.can, flow.approveInfo(actor, r)); o.history = flow.history(actor, r.id); }
    return o;
  };
  const editable = (actor, id) => { const r = flow.row(actor, id, 'pay.wage_run.edit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict('Only a wage run in draft or returned is changed; an approved run is amended.'); return r; };
  const totals = (runId) => { const t = db.prepare("SELECT COUNT(*) FILTER (WHERE paid_on IS NOT NULL) AS paid, COUNT(*) FILTER (WHERE ack_status = 'ACKNOWLEDGED') AS acked, COUNT(*) AS n FROM pay_wage_lines WHERE run_id = ? AND deleted_at IS NULL").get(runId); return t; };

  const runs = {
    flow,
    list(actor, query) { return runList(db, wageRunList, parseListRequest(wageRunList, query), { select: 'x.*', scopeSql: scopeOf(actor, 'pay.wage_run.view'), params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => view(actor, r) }); },
    get(actor, id) { return view(actor, flow.row(actor, id), true); },
    /** The sites and the departmental labour contractors the user may run wages for, with the workers of each contractor at the site. */
    options(actor) { gate(actor, 'pay.wage_run.view', 'see wage runs');
      const sites = db.prepare("SELECT s.id, s.code, s.name, s.org_project_id, p.code AS pcode FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE s.company_id = ? AND s.deleted_at IS NULL AND s.status = 'ACTIVE' ORDER BY p.code, s.code").all(actor.companyId).filter((s) => may(actor, 'pay.wage_run.view', s.org_project_id, s.id));
      const contractors = db.prepare("SELECT DISTINCT p.id, p.legal_name, (SELECT COUNT(*) FROM lab_workers w WHERE w.contractor_id = p.id AND w.company_id = ? AND w.root_id = w.id AND w.worker_status = 'ACTIVE' AND w.deleted_at IS NULL) AS workers FROM mdm_partners p JOIN lab_workers w ON w.contractor_id = p.id WHERE w.company_id = ? AND w.deleted_at IS NULL ORDER BY p.legal_name").all(actor.companyId, actor.companyId);
      return { sites: sites.map((s) => ({ id: s.id, projectId: s.org_project_id, label: `${s.pcode} · ${s.name}`, canCreate: may(actor, 'pay.wage_run.create', s.org_project_id, s.id) })), contractors: contractors.map((c) => ({ id: c.id, name: c.legal_name, workers: c.workers })), cycles: CYCLES, today: today() }; },
    create(actor, b) {
      const s = site(b.siteId); if (!s || s.company_id !== actor.companyId) throw badRequest('Correct the highlighted fields', [{ field: 'siteId', message: 'Choose a site of the company.' }]);
      if (!may(actor, 'pay.wage_run.create', s.org_project_id, s.id)) throw forbidden('You may not run wages for this site (permission pay.wage_run.create).');
      if (!on(actor.companyId)) throw unprocessable('Labour wages are off for the company (ff.pay.p2403).');
      const c = partner(b.contractorId); if (!c || !db.prepare('SELECT 1 FROM lab_workers WHERE company_id = ? AND contractor_id = ? AND deleted_at IS NULL LIMIT 1').get(actor.companyId, c.id)) throw badRequest('Correct the highlighted fields', [{ field: 'contractorId', message: 'Choose a labour contractor with registered workers.' }]);
      const p = cycleOf(b.cycle, b.periodFrom); if (p.error) throw badRequest('Correct the highlighted fields', [{ field: 'periodFrom', message: p.error }]);
      if (p.to > today()) throw unprocessable(`The period ends on ${p.to}: wages are run after the last day of the period.`);
      const clash = db.prepare("SELECT doc_no FROM pay_wage_runs WHERE company_id = ? AND org_site_id = ? AND contractor_id = ? AND status NOT IN ('CANCELLED', 'REJECTED', 'SUPERSEDED') AND deleted_at IS NULL AND period_from <= ? AND period_to >= ?").get(actor.companyId, s.id, c.id, p.to, p.from);
      if (clash) throw conflict(`${clash.doc_no} already covers part of ${p.from} to ${p.to} for this site and contractor.`);
      const rules = rulesAt(actor.companyId, p.to); const due = addDays(p.to, Number(rules.payDueDays[b.cycle] ?? 7));
      const id = Number(db.prepare("INSERT INTO pay_wage_runs (company_id, doc_no, org_project_id, org_site_id, contractor_id, cycle, period_from, period_to, pay_due_on, state_code, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, flow.next(actor, { projectId: s.org_project_id }), s.org_project_id, s.id, c.id, b.cycle, p.from, p.to, due, s.state_code ?? null, s.org_project_id, s.id, actor.user).lastInsertRowid);
      audit(actor, 'pay_wage_runs', id, 'create', actor.companyId, { newValues: { siteId: s.id, contractorId: c.id, cycle: b.cycle, from: p.from, to: p.to } });
      compute(actor, db.prepare('SELECT * FROM pay_wage_runs WHERE id = ?').get(id)); return runs.get(actor, id);
    },
    recompute(actor, id) { const r = editable(actor, id); compute(actor, r); return runs.get(actor, r.id); },
    /** FR-01: the inputs of a worker's line — piece work (quantity from measurements), a rate above the applicable one, allowances, deductions, a corrected muster
     *  with the reason. BR-01: a rate below the minimum wage is refused. The line and the run are computed again. */
    updateLine(actor, id, lineId, b) {
      const r = editable(actor, id); const l = db.prepare('SELECT * FROM pay_wage_lines WHERE id = ? AND run_id = ? AND deleted_at IS NULL').get(rid(lineId), r.id); if (!l) throw notFound('That worker is not in the run.');
      if (b.version != null && b.version !== l.version) throw conflict('The line was changed by someone else: refresh and try again.');
      const cur = inputsOf(l); const nx = { ...cur }; const errs = [];
      if (b.basis) nx.basis = b.basis;
      if (b.rateOverride !== undefined) { nx.rateOverride = b.rateOverride == null ? null : paise(b.rateOverride); if (nx.rateOverride != null && l.min_rate_paise != null && nx.rateOverride < l.min_rate_paise) errs.push({ field: 'rateOverride', message: `Below the minimum wage ₹${rs(l.min_rate_paise)} a day (BR-01).` }); }
      if (b.pieceRate !== undefined) { nx.pieceRate = b.pieceRate == null ? null : paise(b.pieceRate); }
      if (b.pieceUom !== undefined) nx.pieceUom = b.pieceUom;
      if (b.pieceSources !== undefined) { const src = []; let q = 0; for (const x of b.pieceSources) { const mb = db.prepare("SELECT id, doc_no, org_project_id, qty_th, uom, status FROM bill_mb_entries WHERE id = ? AND company_id = ? AND deleted_at IS NULL").get(rid(x.mbId), actor.companyId);
          if (!mb || mb.org_project_id !== r.org_project_id) { errs.push({ field: 'pieceSources', message: `Measurement ${x.mbId} is not of the project.` }); continue; } if (mb.status !== 'APPROVED') { errs.push({ field: 'pieceSources', message: `Measurement ${mb.doc_no} is not approved.` }); continue; }
          if (x.qty * 1000 > mb.qty_th) { errs.push({ field: 'pieceSources', message: `Measurement ${mb.doc_no} has only ${mb.qty_th / 1000} ${mb.uom ?? ''}.` }); continue; } src.push({ mbId: mb.id, docNo: mb.doc_no, qty: x.qty, uom: mb.uom }); q += x.qty; }
        nx.pieceSources = src; if (src.length) { nx.pieceQty = Math.round(q * 1000) / 1000; nx.pieceUom = nx.pieceUom ?? src[0].uom ?? null; } }
      if (b.pieceQty !== undefined && !(b.pieceSources?.length)) nx.pieceQty = b.pieceQty;
      for (const [k, f] of [['allowances', 'allowances'], ['advance', 'advance'], ['canteen', 'canteen'], ['otherDeductions', 'other']]) if (b[k] !== undefined) nx[f] = paise(b[k]);
      if (b.adjust) { if ((b.adjust.reason ?? '').trim().length < 5) errs.push({ field: 'adjust.reason', message: 'Say why the muster is corrected.' }); else { const a = []; if (b.adjust.days) a.push({ field: 'days', delta: b.adjust.days, reason: b.adjust.reason, by: actor.user, at: nowIso() }); if (b.adjust.otHours) a.push({ field: 'otHours', delta: b.adjust.otHours, reason: b.adjust.reason, by: actor.user, at: nowIso() }); nx.adjust = [...cur.adjust, ...a]; } }
      if (errs.length) throw badRequest('Correct the highlighted fields', errs);
      db.prepare('UPDATE pay_wage_lines SET pay_basis = ?, rate_override_paise = ?, piece_rate_paise = ?, piece_qty_milli = ?, piece_uom = ?, piece_source_json = ?, allowances_paise = ?, advance_paise = ?, canteen_paise = ?, other_ded_paise = ?, adjust_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(nx.basis, nx.rateOverride, nx.pieceRate, milli(nx.pieceQty ?? 0), nx.pieceUom ?? null, JSON.stringify(nx.pieceSources), nx.allowances ?? 0, nx.advance ?? 0, nx.canteen ?? 0, nx.other ?? 0, JSON.stringify(nx.adjust), actor.user, nowIso(), l.id);
      audit(actor, 'pay_wage_lines', l.id, 'update', r.company_id, { oldValues: { basis: cur.basis, rateOverride: rs(cur.rateOverride), pieceQty: cur.pieceQty, allowances: rs(cur.allowances), advance: rs(cur.advance), canteen: rs(cur.canteen), other: rs(cur.other) }, newValues: { basis: nx.basis, rateOverride: rs(nx.rateOverride), pieceQty: nx.pieceQty, allowances: rs(nx.allowances), advance: rs(nx.advance), canteen: rs(nx.canteen), other: rs(nx.other) }, reason: b.adjust?.reason ?? null });
      // keep the inputs: compute() reads them back from the line
      compute(actor, db.prepare('SELECT * FROM pay_wage_runs WHERE id = ?').get(r.id)); return runs.get(actor, r.id);
    },
    remove(actor, id) { const r = flow.row(actor, id, 'pay.wage_run.delete'); flow.remove(actor, id); db.prepare('UPDATE pay_wage_lines SET deleted_at = ?, deleted_by = ? WHERE run_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, r.id); return { id: r.id, deleted: true }; },
    submit(actor, id) { flow.submit(actor, id); return runs.get(actor, id); },
    withdraw(actor, id, b) { flow.withdraw(actor, id, b); return runs.get(actor, id); },
    cancel(actor, id, b) { flow.cancel(actor, id, b); return runs.get(actor, id); },
    history(actor, id) { return flow.history(actor, flow.row(actor, id).id); },
    /** An approved run is amended by a new run of the same period (the old one is superseded once the new one is approved). */
    amend(actor, id, { reason }) { const r = flow.row(actor, id, 'pay.wage_run.amend'); if (r.status !== 'APPROVED') throw unprocessable('Only an approved wage run is amended.'); if (r.paid_count > 0) throw conflict('Workers of this run were paid already: pay a difference in the next run.');
      if (db.prepare("SELECT 1 FROM pay_wage_runs WHERE amends_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.id)) throw conflict('An amendment of this run is open already.');
      const nid = Number(db.prepare("INSERT INTO pay_wage_runs (company_id, doc_no, org_project_id, org_site_id, contractor_id, cycle, period_from, period_to, pay_due_on, state_code, amends_id, remarks, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'amendment')").run(r.company_id, flow.next(actor, { projectId: r.org_project_id }), r.org_project_id, r.org_site_id, r.contractor_id, r.cycle, r.period_from, r.period_to, r.pay_due_on, r.state_code, r.id, reason, r.org_project_id, r.org_site_id, actor.user).lastInsertRowid);
      for (const l of db.prepare('SELECT * FROM pay_wage_lines WHERE run_id = ? AND deleted_at IS NULL').all(r.id)) db.prepare("INSERT INTO pay_wage_lines (company_id, run_id, worker_id, pay_basis, piece_qty_milli, piece_uom, piece_rate_paise, piece_source_json, rate_override_paise, allowances_paise, advance_paise, canteen_paise, other_ded_paise, adjust_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'amendment')").run(r.company_id, nid, l.worker_id, l.pay_basis, l.piece_qty_milli, l.piece_uom, l.piece_rate_paise, l.piece_source_json, l.rate_override_paise, l.allowances_paise, l.advance_paise, l.canteen_paise, l.other_ded_paise, l.adjust_json, actor.user);
      audit(actor, 'pay_wage_runs', nid, 'amend', r.company_id, { reason, newValues: { amends: r.doc_no } }); compute(actor, db.prepare('SELECT * FROM pay_wage_runs WHERE id = ?').get(nid)); return runs.get(actor, nid); },
    /** FR-04: record the payment of workers of an approved run (bank transfer to the worker's account, or cash). A payment after the due date is late. */
    pay(actor, id, b) {
      const r = flow.row(actor, id); if (!may(actor, 'pay.wage_run.disburse', r.org_project_id, r.org_site_id)) throw forbidden('You may not pay wages (permission pay.wage_run.disburse).'); if (r.status !== 'APPROVED') throw unprocessable('Wages are paid once the run is approved.');
      if (b.paidOn > today() || b.paidOn < r.period_to) throw badRequest('Correct the highlighted fields', [{ field: 'paidOn', message: `Between ${r.period_to} and today.` }]);
      const lines = db.prepare(`SELECT l.*, w.bank_last4 FROM pay_wage_lines l JOIN lab_workers w ON w.id = l.worker_id WHERE l.run_id = ? AND l.deleted_at IS NULL AND l.id IN (${b.lineIds.map(() => '?').join(',')})`).all(r.id, ...b.lineIds.map(rid));
      if (lines.length !== b.lineIds.length) throw notFound('Some of the workers are not in the run.'); const paid = lines.filter((l) => l.paid_on); if (paid.length) throw conflict(`${paid.length} of them are paid already.`);
      if (b.mode === 'BANK') { const nob = lines.filter((l) => !l.bank_last4); if (nob.length) throw unprocessable(`${nob.length} worker(s) have no bank account: pay them in cash.`); if (!(b.reference ?? '').trim()) throw badRequest('Correct the highlighted fields', [{ field: 'reference', message: 'Give the bank reference of the transfer.' }]); }
      transaction(db, () => { for (const l of lines) db.prepare('UPDATE pay_wage_lines SET paid_mode = ?, paid_on = ?, paid_ref = ?, paid_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.mode, b.paidOn, b.reference ?? null, actor.user, actor.user, nowIso(), l.id);
        const t = totals(r.id); db.prepare('UPDATE pay_wage_runs SET paid_count = ?, acked_count = ?, disbursed_at = CASE WHEN ? = ? THEN ? ELSE disbursed_at END, updated_at = ? WHERE id = ?').run(t.paid, t.acked, t.paid, t.n, nowIso(), nowIso(), r.id);
        audit(actor, 'pay_wage_runs', r.id, 'pay', r.company_id, { newValues: { workers: lines.length, mode: b.mode, paidOn: b.paidOn, net: rs(lines.reduce((a, l) => a + l.net_paise, 0)), late: b.paidOn > r.pay_due_on } });
        evt('pay.wage_run.paid', actor, r.company_id, 'pay_wage_runs', r.id, { runId: r.id, docNo: r.doc_no, projectId: r.org_project_id, siteId: r.org_site_id, mode: b.mode, paidOn: b.paidOn, workers: lines.length, net: rs(lines.reduce((a, l) => a + l.net_paise, 0)), late: b.paidOn > r.pay_due_on, complete: t.paid === t.n }, r.org_project_id); });
      return runs.get(actor, r.id);
    },
    /** FR-04 (phone): the worker acknowledges the wages received — by the QR of the worker card (the card's code must be the worker's) or a photograph attached to
     *  the line; a worker who disputes the amount says why and the HR manager is told. */
    acknowledge(actor, id, lineId, b) {
      const r = flow.row(actor, id); if (!may(actor, 'pay.wage_run.acknowledge', r.org_project_id, r.org_site_id)) throw forbidden('You may not record acknowledgements (permission pay.wage_run.acknowledge).');
      const l = db.prepare('SELECT * FROM pay_wage_lines WHERE id = ? AND run_id = ? AND deleted_at IS NULL').get(rid(lineId), r.id); if (!l) throw notFound('That worker is not in the run.'); if (!l.paid_on) throw unprocessable('Record the payment first.'); if (l.ack_status !== 'PENDING') throw conflict('The acknowledgement is recorded already.');
      let fileId = null; if (b.method === 'CARD') { const wid = lab().byToken(r.company_id, b.badge ?? ''); if (wid !== l.worker_id) throw unprocessable('The card is not the worker\'s: scan the card of the worker who is paid.'); } else { fileId = fileOk(actor, b.fileId, 'pay_wage_lines', l.id).id; }
      if (b.disputed && (b.note ?? '').trim().length < 5) throw badRequest('Correct the highlighted fields', [{ field: 'note', message: 'Say what the worker disputes.' }]);
      db.prepare('UPDATE pay_wage_lines SET ack_status = ?, ack_method = ?, ack_file_id = ?, ack_by = ?, ack_at = ?, ack_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.disputed ? 'DISPUTED' : 'ACKNOWLEDGED', b.method, fileId, actor.user, nowIso(), b.note ?? null, actor.user, nowIso(), l.id);
      const t = totals(r.id); db.prepare('UPDATE pay_wage_runs SET acked_count = ? WHERE id = ?').run(t.acked, r.id);
      audit(actor, 'pay_wage_lines', l.id, b.disputed ? 'dispute' : 'acknowledge', r.company_id, { newValues: { method: b.method }, reason: b.note ?? null });
      if (b.disputed) notify(r.company_id, 'pay.wage_run.decided', ['role:HRMGR', `user:${r.requested_by}`], r.doc_no, 'wages disputed', `A worker of ${r.doc_no} disputes the wages paid: ${b.note}`, `/payroll/wage-runs?id=${r.id}`, `${l.id}-dispute`, { projectId: r.org_project_id, siteId: r.org_site_id });
      return runs.get(actor, r.id);
    },
    /** FR-04: wage slips of the run as a printable page in English or Hindi (the PDF standard fonts cannot draw Devanagari; the browser prints the page). */
    slips(actor, id, { lang = 'en', lineId } = {}) {
      const r = flow.row(actor, id); if (!may(actor, 'pay.wage_run.print', r.org_project_id, r.org_site_id)) throw forbidden('You may not print wage slips (permission pay.wage_run.print).'); const x = view({ ...actor }, r, true); const L = SLIP[lang] ?? SLIP.en;
      const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); const m = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      const lines = x.lines.filter((l) => !lineId || l.id === Number(lineId));
      const slip = (l) => `<section class="slip"><h2>${esc(L.title)} · ${esc(x.docNo)}</h2><p>${esc(L.period)}: ${esc(x.periodFrom)} – ${esc(x.periodTo)} · ${esc(x.project)} ${esc(x.site)} · ${esc(x.contractor)}</p><p><b>${esc(l.workerCode)} ${esc(l.worker)}</b> · ${esc(l.trade)} · ${esc(l.skill)}</p><table>
${[[L.days, l.days], [L.ot, l.otHours], [L.rate, m(l.rate)], [L.minRate, m(l.minRate)], [L.basic, m(l.basic)], [L.piece, l.piece ? `${m(l.piece)} (${l.pieceQty} ${esc(l.pieceUom ?? '')})` : '—'], [L.topup, m(l.topup)], [L.otPay, m(l.ot)], [L.allowances, m(l.allowances)], [L.gross, m(l.gross)], [L.advance, m(l.advance)], [L.canteen, m(l.canteen)], [L.other, m(l.other)], [L.pf, m(l.pf)], [L.esi, m(l.esi)], [L.deductions, m(l.deductions)], [L.net, m(l.net)], [L.paid, l.paidOn ? `${l.paidOn} · ${l.paidMode === 'BANK' ? L.bank : L.cash}${l.paidRef ? ` · ${esc(l.paidRef)}` : ''}` : '—'], [L.ack, l.ack === 'ACKNOWLEDGED' ? `${L.yes} · ${esc(l.ackAt?.slice(0, 10))}` : l.ack === 'DISPUTED' ? L.disputed : '—']].map(([k, v]) => `<tr><th>${esc(k)}</th><td>${typeof v === 'string' && v.startsWith('₹') ? v : esc(v)}</td></tr>`).join('')}</table><p class="sign">${esc(L.sign)}</p></section>`;
      audit(actor, 'pay_wage_runs', r.id, 'print', r.company_id, { newValues: { slips: lines.length, lang } });
      const html = `<!doctype html><html lang="${lang === 'hi' ? 'hi' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(L.title)} ${esc(x.docNo)}</title><style>body{font-family:system-ui,'Noto Sans Devanagari',sans-serif;margin:16px;color:#111;background:#fff}.slip{border:1px solid #999;padding:12px;margin:0 0 16px;page-break-inside:avoid;max-width:560px}h2{font-size:16px;margin:0 0 6px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:3px 6px;border-bottom:1px solid #ddd;font-size:13px}td{text-align:right}.sign{margin-top:24px;font-size:12px}@media print{.slip{border-color:#000}}</style></head><body>${lines.map(slip).join('\n')}</body></html>`;
      return { contentType: 'text/html; charset=utf-8', fileName: `wage-slips-${r.doc_no.replaceAll('/', '-')}-${lang}.html`, buffer: Buffer.from(html, 'utf8') };
    },
    /** FR-05: the muster roll of the run (CLRA Form XVI layout): each worker by day — P, ½, A — with the overtime hours. */
    muster(actor, id, { format = 'csv' } = {}) {
      const r = flow.row(actor, id); if (!may(actor, 'pay.wage_run.export', r.org_project_id, r.org_site_id)) throw forbidden('You may not export the muster roll (permission pay.wage_run.export).');
      const dates = []; for (let d = r.period_from; d <= r.period_to; d = addDays(d, 1)) dates.push(d); const x = view(actor, r, true);
      const rows = x.lines.map((l) => { const by = new Map(l.dayLog.map((d) => [d.date, d])); return [`${l.workerCode}`, l.worker, l.trade, ...dates.map((d) => { const v = by.get(d); return !v ? 'A' : v.day === 1 ? 'P' : v.day === 0.5 ? '½' : 'A'; }), String(l.days), String(l.otHours)]; });
      const head = ['Worker', 'Name', 'Trade', ...dates.map((d) => d.slice(8)), 'Days', 'OT hours']; audit(actor, 'pay_wage_runs', r.id, 'export', r.company_id, { newValues: { muster: rows.length } });
      if (format === 'pdf') return { contentType: 'application/pdf', fileName: `muster-${r.doc_no.replaceAll('/', '-')}.pdf`, buffer: toPdf({ title: `Muster roll (Form XVI) ${x.project} ${x.site} · ${x.contractor} · ${r.period_from} to ${r.period_to}`, columns: head.map((h, i) => ({ key: String(i), label: h, type: 'text' })), rows: rows.map((row) => Object.fromEntries(row.map((v, i) => [String(i), v.replace('½', '1/2')]))) }) };
      return { contentType: 'text/csv; charset=utf-8', fileName: `muster-${r.doc_no.replaceAll('/', '-')}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(head, rows)}`) };
    },
    /** FR-05: the wage register (CLRA Form XVII layout) of approved runs in a range, by project, site or contractor; the page and 24.04 read it. */
    register(actor, q) {
      const scope = scopeOf(actor, 'pay.wage_run.view', 'x'); const where = [scope, "x.status = 'APPROVED'", 'x.deleted_at IS NULL', 'x.period_from >= :from', 'x.period_to <= :to']; const params = { c: actor.companyId, from: q.from, to: q.to };
      if (q.projectId) { where.push('x.org_project_id = :p'); params.p = q.projectId; } if (q.siteId) { where.push('x.org_site_id = :s'); params.s = q.siteId; } if (q.contractorId) { where.push('x.contractor_id = :k'); params.k = q.contractorId; }
      const rs0 = db.prepare(`SELECT x.* FROM pay_wage_runs x WHERE ${where.join(' AND ')} ORDER BY x.period_from, x.id LIMIT 500`).all(params); const out = []; const T = { workers: 0, days: 0, gross: 0, deductions: 0, net: 0, paid: 0, late: 0, acknowledged: 0 };
      for (const r of rs0) { const x = view(actor, r, true); for (const l of x.lines) { out.push({ runId: r.id, docNo: r.doc_no, site: x.site, contractor: x.contractor, periodFrom: r.period_from, periodTo: r.period_to, payDueOn: r.pay_due_on, ...l }); T.workers += 1; T.days += l.days; T.gross += l.gross ?? 0; T.deductions += l.deductions ?? 0; T.net += l.net; if (l.paidOn) T.paid += 1; if (l.late) T.late += 1; if (l.ack === 'ACKNOWLEDGED') T.acknowledged += 1; } }
      return { from: q.from, to: q.to, runs: rs0.length, rows: out, totals: { ...T, days: Math.round(T.days * 1000) / 1000, gross: Math.round(T.gross * 100) / 100, deductions: Math.round(T.deductions * 100) / 100, net: Math.round(T.net * 100) / 100 }, rates: rs0.every((r) => seesRates(actor, r)) };
    },
    registerFile(actor, q) {
      gate(actor, 'pay.wage_run.export', 'export the wage register'); const x = runs.register(actor, q); const rows = x.rows.map(regRow);
      audit(actor, 'pay_wage_runs', 0, 'export', actor.companyId, { newValues: { register: rows.length, from: q.from, to: q.to } });
      if (q.format === 'pdf') return { contentType: 'application/pdf', fileName: `wage-register-${q.from}-${q.to}.pdf`, buffer: toPdf({ title: `Register of wages (Form XVII) ${q.from} to ${q.to}`, columns: REG_HEAD.map((h, i) => ({ key: String(i), label: h, type: 'text' })), rows: rows.map((row) => Object.fromEntries(row.map((v, i) => [String(i), v == null ? '' : String(v)]))) }) };
      return { contentType: 'text/csv; charset=utf-8', fileName: `wage-register-${q.from}-${q.to}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(REG_HEAD, rows)}`) };
    },
    /** The lines of one run in the layout of the register (any status). */
    exportCsv(actor, id) { const r = flow.row(actor, id); if (!may(actor, 'pay.wage_run.export', r.org_project_id, r.org_site_id)) throw forbidden('You may not export wage runs (permission pay.wage_run.export).'); const x = view(actor, r, true);
      const rows = x.lines.map((l) => regRow({ docNo: r.doc_no, site: x.site, contractor: x.contractor, periodFrom: r.period_from, periodTo: r.period_to, ...l })); audit(actor, 'pay_wage_runs', r.id, 'export', r.company_id, { newValues: { rows: rows.length } });
      return { contentType: 'text/csv; charset=utf-8', fileName: `${r.doc_no.replaceAll('/', '-')}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(REG_HEAD, rows)}`) }; },
    print(actor, id) { const r = flow.row(actor, id); if (!may(actor, 'pay.wage_run.print', r.org_project_id, r.org_site_id)) throw forbidden('You may not print wage runs (permission pay.wage_run.print).'); const x = view(actor, r, true);
      audit(actor, 'pay_wage_runs', r.id, 'print', r.company_id); return { contentType: 'application/pdf', fileName: `${r.doc_no.replaceAll('/', '-')}.pdf`, buffer: toPdf({ title: `Wage run ${x.docNo} · ${x.project} ${x.site} · ${x.contractor} · ${x.periodFrom} to ${x.periodTo} · ${x.statusLabel}`, columns: [{ key: 'w', label: 'Worker', type: 'text' }, { key: 'd', label: 'Days' }, { key: 'o', label: 'OT h' }, { key: 'g', label: 'Gross' }, { key: 'x', label: 'Deductions' }, { key: 'n', label: 'Net' }, { key: 'p', label: 'Paid', type: 'text' }],
        rows: x.lines.map((l) => ({ w: `${l.workerCode} ${l.worker}`, d: l.days, o: l.otHours, g: l.gross ?? '', x: l.deductions ?? '', n: l.net, p: l.paidOn ?? '' })), footer: `Workers ${x.workers} · net Rs. ${x.net} · approved by ${x.approvedBy ?? '-'}` }) }; },
  };

  // ================================================================== contractor wage verification (FR-03, BR-01)
  const checkRow = (actor, id, key = 'pay.wage_check.view') => { const r = db.prepare('SELECT * FROM pay_contractor_wage_checks WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r || !may(actor, 'pay.wage_check.view', r.org_project_id, r.org_site_id)) throw notFound('That wage check does not exist.'); if (key !== 'pay.wage_check.view' && !may(actor, key, r.org_project_id, r.org_site_id)) throw forbidden(`You may not do that (permission ${key}).`); return r; };
  /** The attendance of the contractor's workers in the month with the minimum wage of each. */
  function attendanceRows(r) {
    const rules = rulesAt(r.company_id, monthEnd(`${r.period}-01`)); const att = attendanceOf(r.company_id, { contractorId: r.contractor_id, siteId: r.org_site_id, projectId: r.org_project_id, from: `${r.period}-01`, to: monthEnd(`${r.period}-01`), rules });
    const l = lab(); const out = []; for (const [wid, a] of att) { const w = workerOf(r.company_id, wid); if (!w) continue; const st = r.state_code ?? w.home_state ?? null;
      const min = st ? l.minimumWage(r.company_id, { stateCode: st, skillCategory: w.skill_category, tradeCode: w.trade_code, payBasis: 'DAILY', date: monthEnd(`${r.period}-01`) }) : null;
      out.push({ workerId: wid, code: w.worker_code, name: w.name, skill: w.skill_category, trade: w.trade_code, days: a.total, otHours: Math.round((a.otMinutes / 60) * 100) / 100, minRate: min?.rateMinor ?? null, minRef: min?.docNo ?? null }); }
    return { rows: out.sort((a, b) => a.code.localeCompare(b.code)), rules };
  }
  function evaluate(r, sheet) { const { rows, rules } = attendanceRows(r); const known = new Set(db.prepare('SELECT worker_code FROM lab_workers WHERE company_id = ? AND contractor_id = ? AND deleted_at IS NULL').all(r.company_id, r.contractor_id).map((w) => String(w.worker_code).toUpperCase()));
    const cmp = compareSheet({ attendance: rows, sheet: sheet.map((s) => ({ ...s, known: known.has(String(s.workerCode).toUpperCase()) })), dueOn: r.pay_due_on, dayHours: rules.dayHours, otMultiplier: rules.otMultiplier, capPct: rules.capPct }); return { rows, ...cmp }; }
  const checkView = (actor, r, detail = false) => { const s = r.org_site_id ? site(r.org_site_id) : null; const vs = JSON.parse(r.variances_json || '[]'); const t = today();
    const o = { id: r.id, docNo: r.doc_no, contractorId: r.contractor_id, contractor: partner(r.contractor_id)?.legal_name ?? null, projectId: r.org_project_id, project: pcode(r.org_project_id), siteId: r.org_site_id, site: s?.name ?? null, period: r.period, payDueOn: r.pay_due_on, verifyDueOn: r.verify_due_on, overdueDays: r.check_status === 'SUBMITTED' && r.verify_due_on < t ? Math.round((Date.parse(t) - Date.parse(r.verify_due_on)) / DAY) : 0,
      workers: r.workers_count, attendanceDays: un(r.attendance_days_milli), sheetDays: un(r.sheet_days_milli), sheetGross: rs(r.sheet_gross_paise), sheetNet: rs(r.sheet_net_paise), variances: r.variance_count, blocking: r.blocking_count, top: vs.slice(0, 3).map((v) => v.message), sheetFileId: r.wage_sheet_file_id, proofFileId: r.proof_file_id,
      status: r.check_status, statusLabel: CHECK_STATUS[r.check_status], hold: Boolean(r.hold_requested), submittedBy: r.submitted_by, submittedAt: r.submitted_at, verifiedBy: r.verified_by, verifiedAt: r.verified_at, note: r.decision_note, version: r.version,
      can: { edit: ['DRAFT', 'RETURNED', 'VARIANCE'].includes(r.check_status) && may(actor, 'pay.wage_check.manage', r.org_project_id, r.org_site_id), verify: r.check_status === 'SUBMITTED' && !same(r.submitted_by, actor.user) && may(actor, 'pay.wage_check.verify', r.org_project_id, r.org_site_id) } };
    if (detail) { o.sheet = JSON.parse(r.sheet_json || '[]'); o.varianceList = vs; o.attendance = attendanceRows(r).rows.map((a) => ({ ...a, minRate: rs(a.minRate) })); o.history = db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'pay_contractor_wage_checks' AND entity_id = ? ORDER BY id").all(String(r.id)); }
    return o; };
  /** Tells the subcontractor workspace (21.04) to set or lift the hold from the wage checks of the contractor on the project. */
  const rehold = (actor, r) => { try { ctr()?.svc?.subcontractors?.recomputeHold(r.company_id, r.contractor_id, r.org_project_id, actor); } catch (x) { notify(r.company_id, 'pay.wage_check.alert', ['role:HRMGR'], r.doc_no, 'hold not updated', `The payment hold of the contractor could not be updated: ${x.message}`, `/payroll/contractor-wages?id=${r.id}`, `${r.id}-hold-${Date.now()}`); } };
  function store(actor, r, sheet) { const e = evaluate(r, sheet); const sum = (f) => sheet.reduce((a, s) => a + Number(s[f] ?? 0), 0);
    db.prepare('UPDATE pay_contractor_wage_checks SET sheet_json = ?, workers_count = ?, attendance_days_milli = ?, sheet_days_milli = ?, sheet_gross_paise = ?, sheet_net_paise = ?, variances_json = ?, variance_count = ?, blocking_count = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
      .run(JSON.stringify(sheet), e.rows.length, milli(e.rows.reduce((a, x) => a + x.days, 0)), milli(sum('days')), paise(sum('gross')), paise(sum('net')), JSON.stringify(e.variances), e.variances.length, e.blocking, actor.user, nowIso(), r.id); return e; }
  /** Reads a wage sheet in CSV (worker code, days, OT hours, gross, deductions, net, paid on) — the contractor's own format is mapped to these columns. */
  function parseSheetCsv(text) { const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean); if (!lines.length) return { rows: [], errors: [{ row: 0, message: 'The sheet is empty.' }] };
    const head = lines[0].toLowerCase().split(',').map((h) => h.trim().replace(/[^a-z]/g, '')); const col = (names) => head.findIndex((h) => names.includes(h)); const ix = { code: col(['workercode', 'worker', 'code']), days: col(['days', 'daysworked']), ot: col(['othours', 'ot', 'overtime']), gross: col(['gross', 'grosswages']), ded: col(['deductions', 'deduction']), net: col(['net', 'netpaid', 'netwages']), paid: col(['paidon', 'dateofpayment', 'paymentdate']) };
    if (ix.code < 0 || ix.days < 0 || ix.gross < 0 || ix.net < 0) return { rows: [], errors: [{ row: 1, message: 'The first row must name the columns: worker code, days, OT hours, gross, deductions, net, paid on.' }] };
    const rows = []; const errors = []; lines.slice(1).forEach((ln, i) => { const c = ln.split(',').map((v) => v.trim()); const n = (k) => (ix[k] < 0 || c[ix[k]] === '' ? 0 : Number(c[ix[k]])); const row = { workerCode: c[ix.code], days: n('days'), otHours: n('ot'), gross: n('gross'), deductions: n('ded'), net: n('net'), paidOn: ix.paid >= 0 && c[ix.paid] ? c[ix.paid] : null };
      if (!row.workerCode || [row.days, row.otHours, row.gross, row.deductions, row.net].some((v) => !Number.isFinite(v) || v < 0) || (row.paidOn && !/^\d{4}-\d{2}-\d{2}$/.test(row.paidOn))) errors.push({ row: i + 2, message: 'A worker code, numbers not below zero and a date as YYYY-MM-DD are needed.' }); else rows.push(row); });
    return { rows, errors }; }
  const checks = {
    list(actor, query) { return runList(db, wageCheckList, parseListRequest(wageCheckList, query), { select: 'x.*', scopeSql: scopeOf(actor, 'pay.wage_check.view'), params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => checkView(actor, r) }); },
    /** The worklist: checks waiting for verification first, by the date they are due; counts for the badge. */
    worklist(actor) { const scope = scopeOf(actor, 'pay.wage_check.view'); const rows = db.prepare(`SELECT x.* FROM pay_contractor_wage_checks x WHERE ${scope} AND x.deleted_at IS NULL AND x.check_status IN ('SUBMITTED', 'DRAFT', 'RETURNED', 'VARIANCE') ORDER BY CASE x.check_status WHEN 'SUBMITTED' THEN 0 WHEN 'VARIANCE' THEN 1 ELSE 2 END, x.verify_due_on, x.id LIMIT 200`).all({ c: actor.companyId }).map((r) => checkView(actor, r));
      return { rows, counts: { toVerify: rows.filter((r) => r.status === 'SUBMITTED').length, overdue: rows.filter((r) => r.overdueDays > 0).length, held: rows.filter((r) => r.hold).length, open: rows.filter((r) => ['DRAFT', 'RETURNED'].includes(r.status)).length } }; },
    get(actor, id) { return checkView(actor, checkRow(actor, id), true); },
    create(actor, b) {
      const p = db.prepare('SELECT p.id, p.company_id, b.state_code FROM org_projects p LEFT JOIN org_branches b ON b.id = p.branch_id WHERE p.id = ? AND p.deleted_at IS NULL').get(rid(b.projectId)); if (!p || p.company_id !== actor.companyId) throw badRequest('Correct the highlighted fields', [{ field: 'projectId', message: 'Choose a project of the company.' }]);
      const s = b.siteId ? site(b.siteId) : null; if (b.siteId && (!s || s.org_project_id !== p.id)) throw badRequest('Correct the highlighted fields', [{ field: 'siteId', message: 'Choose a site of the project.' }]);
      if (!may(actor, 'pay.wage_check.manage', p.id, s?.id ?? null)) throw forbidden('You may not compile contractor wage checks here (permission pay.wage_check.manage).'); if (!on(actor.companyId)) throw unprocessable('Labour wages are off for the company (ff.pay.p2403).');
      const c = partner(b.contractorId); if (!c || !db.prepare('SELECT 1 FROM lab_workers WHERE company_id = ? AND contractor_id = ? AND deleted_at IS NULL LIMIT 1').get(actor.companyId, c.id)) throw badRequest('Correct the highlighted fields', [{ field: 'contractorId', message: 'Choose a labour contractor with registered workers.' }]);
      if (`${b.period}-01` > today()) throw badRequest('Correct the highlighted fields', [{ field: 'period', message: 'A month that has begun.' }]);
      const end = monthEnd(`${b.period}-01`); const rules = rulesAt(actor.companyId, end); const due = addDays(end, Number(rules.payDueDays.MONTHLY ?? 7)); const vdue = addDays(due, Number(rules.verifyDays ?? 3));
      let id; try { id = Number(db.prepare("INSERT INTO pay_contractor_wage_checks (company_id, doc_no, contractor_id, org_project_id, org_site_id, period, pay_due_on, verify_due_on, state_code, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, base.number(actor.companyId, actor.user, 'PAY_WAGE_CHECK', 'pay_contractor_wage_checks', 'CWV', { projectId: p.id }), c.id, p.id, s?.id ?? null, b.period, due, vdue, s?.state_code ?? p.state_code ?? null, p.id, s?.id ?? null, actor.user).lastInsertRowid); }
      catch (x) { if (/UNIQUE/.test(String(x.message))) throw conflict(`The wage check of ${c.legal_name} for ${b.period} exists already.`); throw x; }
      const r = db.prepare('SELECT * FROM pay_contractor_wage_checks WHERE id = ?').get(id); store(actor, r, []); audit(actor, 'pay_contractor_wage_checks', id, 'create', actor.companyId, { newValues: { contractorId: c.id, projectId: p.id, siteId: s?.id ?? null, period: b.period } }); return checks.get(actor, id);
    },
    /** FR-03: the contractor's wage sheet — rows, or a CSV file's text — compared with the attendance at once. */
    saveSheet(actor, id, b) {
      const r = checkRow(actor, id, 'pay.wage_check.manage'); if (!['DRAFT', 'RETURNED', 'VARIANCE'].includes(r.check_status)) throw conflict('The sheet of a check waiting for verification or verified is not changed.');
      if (b.version != null && b.version !== r.version) throw conflict('The check was changed by someone else: refresh and try again.');
      let rows = b.lines ?? []; if (b.csv != null) { const p = parseSheetCsv(b.csv); if (p.errors.length) throw badRequest('The wage sheet has errors', p.errors.map((e) => ({ field: `csv.row${e.row}`, message: `Row ${e.row}: ${e.message}` }))); rows = p.rows; }
      const dup = rows.map((x) => String(x.workerCode).toUpperCase()).filter((c, i, a) => a.indexOf(c) !== i); if (dup.length) throw badRequest('Correct the highlighted fields', [{ field: 'lines', message: `A worker appears twice: ${[...new Set(dup)].join(', ')}.` }]);
      const e = store(actor, r, rows); audit(actor, 'pay_contractor_wage_checks', r.id, 'sheet', r.company_id, { newValues: { rows: rows.length, variances: e.variances.length, blocking: e.blocking } }); return checks.get(actor, r.id);
    },
    attach(actor, id, { kind, fileId }) { const r = checkRow(actor, id, 'pay.wage_check.manage'); if (!['DRAFT', 'RETURNED', 'VARIANCE'].includes(r.check_status)) throw conflict('The documents of a check waiting for verification or verified are not changed.'); const f = fileOk(actor, fileId, 'pay_contractor_wage_checks', r.id);
      db.prepare(`UPDATE pay_contractor_wage_checks SET ${kind === 'PROOF' ? 'proof_file_id' : 'wage_sheet_file_id'} = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(f.id, actor.user, nowIso(), r.id); audit(actor, 'pay_contractor_wage_checks', r.id, 'attach', r.company_id, { newValues: { kind, fileId: f.id } }); return checks.get(actor, r.id); },
    submit(actor, id) {
      const r = checkRow(actor, id, 'pay.wage_check.manage'); if (!['DRAFT', 'RETURNED', 'VARIANCE'].includes(r.check_status)) throw unprocessable('Only a check being compiled, returned or held is sent for verification.');
      const errs = []; if (!JSON.parse(r.sheet_json).length) errs.push({ field: 'sheet', message: 'Enter or upload the wage sheet.' }); if (!r.wage_sheet_file_id) errs.push({ field: 'sheetFile', message: 'Attach the contractor\'s signed wage sheet.' }); if (!r.proof_file_id) errs.push({ field: 'proofFile', message: 'Attach the proof of payment (bank statement or acknowledgements).' }); if (errs.length) throw badRequest('The check is not complete', errs);
      const e = store(actor, r, JSON.parse(r.sheet_json)); db.prepare("UPDATE pay_contractor_wage_checks SET check_status = 'SUBMITTED', submitted_by = ?, submitted_at = ?, updated_at = ? WHERE id = ?").run(actor.user, nowIso(), nowIso(), r.id); audit(actor, 'pay_contractor_wage_checks', r.id, 'submit', r.company_id, { newValues: { variances: e.variances.length, blocking: e.blocking } });
      notify(r.company_id, 'pay.wage_check.alert', ['permission:pay.wage_check.verify'], r.doc_no, 'verify the wages', `${partner(r.contractor_id)?.legal_name} ${r.period}: ${e.variances.length} variance(s), ${e.blocking} blocking. Verify by ${r.verify_due_on}.`, `/payroll/contractor-wages?id=${r.id}`, `${r.id}-submit-${r.version}`, { projectId: r.org_project_id, siteId: r.org_site_id }); return checks.get(actor, r.id);
    },
    /** BR-01: the verifier (not the person who compiled it) verifies a sheet without blocking variances, returns it with the reason, or holds the contractor's
     *  payments on the project (21.04) for the variances. Verifying lifts a hold of this check. */
    decide(actor, id, { decision, note }) {
      const r = checkRow(actor, id, 'pay.wage_check.verify'); if (r.check_status !== 'SUBMITTED') throw unprocessable('Only a check waiting for verification is decided.'); if (same(r.submitted_by, actor.user)) throw forbidden('The person who compiled the check does not verify it.');
      const e = store(actor, r, JSON.parse(r.sheet_json)); if (decision === 'VERIFY' && e.blocking) throw unprocessable(`${e.blocking} blocking variance(s): return the sheet or hold the contractor's payments.`);
      if (decision !== 'VERIFY' && (note ?? '').trim().length < 5) throw badRequest('Correct the highlighted fields', [{ field: 'note', message: 'Say why.' }]);
      const to = decision === 'VERIFY' ? 'VERIFIED' : decision === 'HOLD' ? 'VARIANCE' : 'RETURNED'; const hold = decision === 'HOLD' ? 1 : decision === 'VERIFY' ? 0 : r.hold_requested;
      db.prepare('UPDATE pay_contractor_wage_checks SET check_status = ?, hold_requested = ?, verified_by = ?, verified_at = ?, decision_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, hold, actor.user, nowIso(), note ?? null, actor.user, nowIso(), r.id);
      audit(actor, 'pay_contractor_wage_checks', r.id, decision.toLowerCase(), r.company_id, { reason: note ?? null, newValues: { status: to, hold: Boolean(hold), variances: e.variances.length } });
      const x = db.prepare('SELECT * FROM pay_contractor_wage_checks WHERE id = ?').get(r.id);
      evt(decision === 'VERIFY' ? 'pay.contractor_wage.verified' : 'pay.contractor_wage.variance', actor, r.company_id, 'pay_contractor_wage_checks', r.id, { checkId: r.id, docNo: r.doc_no, contractorId: r.contractor_id, projectId: r.org_project_id, siteId: r.org_site_id, period: r.period, workers: x.workers_count, variances: e.variances.length, blocking: e.blocking, hold: Boolean(hold), decision }, r.org_project_id);
      if (hold !== r.hold_requested) rehold(actor, x);
      notify(r.company_id, 'pay.wage_check.alert', [`user:${r.submitted_by}`], r.doc_no, decision === 'VERIFY' ? 'verified' : decision === 'HOLD' ? 'payments held' : 'returned', `${r.doc_no} ${decision === 'VERIFY' ? 'is verified' : decision === 'HOLD' ? `holds the contractor's payments: ${note}` : `is returned: ${note}`}.`, `/payroll/contractor-wages?id=${r.id}`, `${r.id}-${decision}-${x.version}`, { projectId: r.org_project_id, siteId: r.org_site_id });
      return checks.get(actor, r.id);
    },
    /** 21.04 asks for the reasons a contractor is held on a project: the wage checks held for variances. */
    holdReasons(companyId, contractorId, projectId) { return db.prepare("SELECT doc_no, period, variance_count, blocking_count FROM pay_contractor_wage_checks WHERE company_id = ? AND contractor_id = ? AND org_project_id = ? AND hold_requested = 1 AND deleted_at IS NULL ORDER BY period").all(companyId, contractorId, projectId)
      .map((x) => ({ period: x.period, source: 'pay.wage_check', docNo: x.doc_no, missing: [], returned: false, message: `${x.period}: wage sheet ${x.doc_no} has ${x.blocking_count} blocking variance(s) of ${x.variance_count} (contract labour wages)` })); },
    parseSheetCsv,
  };
  return { runs, checks, compute, rulesAt, attendanceOf };
}

const REG_HEAD = ['Run', 'Site', 'Contractor', 'From', 'To', 'Worker', 'Name', 'Trade', 'Days', 'OT hours', 'Rate', 'Basic', 'Piece', 'OT', 'Allowances', 'Gross', 'PF', 'ESI', 'Other deductions', 'Net', 'Paid on', 'Mode', 'Late', 'Acknowledged'];
const regRow = (l) => [l.docNo, l.site, l.contractor, l.periodFrom, l.periodTo, l.workerCode, l.worker, l.trade, l.days, l.otHours, l.rate, l.basic, l.piece, l.ot, l.allowances, l.gross, l.pf, l.esi, l.deductions == null ? null : Math.round(((l.advance ?? 0) + (l.canteen ?? 0) + (l.other ?? 0)) * 100) / 100, l.net, l.paidOn, l.paidMode, l.late ? 'yes' : '', l.ack === 'ACKNOWLEDGED' ? 'yes' : l.ack === 'DISPUTED' ? 'disputed' : ''];
/** The labels of the wage slip (FR-04) in English and Hindi. */
const SLIP = {
  en: { title: 'Wage slip', period: 'Period', days: 'Days worked', ot: 'Overtime hours', rate: 'Daily rate', minRate: 'Minimum wage a day', basic: 'Wages for the days', piece: 'Piece work', topup: 'Minimum wage top-up', otPay: 'Overtime wages', allowances: 'Allowances', gross: 'Gross wages', advance: 'Advance recovered', canteen: 'Canteen', other: 'Other deductions', pf: 'Provident fund', esi: 'ESI', deductions: 'Total deductions', net: 'Net wages paid', paid: 'Paid on', bank: 'bank transfer', cash: 'cash', ack: 'Acknowledged', yes: 'yes', disputed: 'disputed', sign: 'Signature or thumb impression of the worker: ____________' },
  hi: { title: 'मज़दूरी पर्ची', period: 'अवधि', days: 'काम के दिन', ot: 'ओवरटाइम घंटे', rate: 'दैनिक दर', minRate: 'न्यूनतम मज़दूरी प्रतिदिन', basic: 'दिनों की मज़दूरी', piece: 'नग-दर काम', topup: 'न्यूनतम मज़दूरी पूर्ति', otPay: 'ओवरटाइम मज़दूरी', allowances: 'भत्ते', gross: 'कुल मज़दूरी', advance: 'अग्रिम वसूली', canteen: 'कैंटीन', other: 'अन्य कटौती', pf: 'भविष्य निधि', esi: 'ईएसआई', deductions: 'कुल कटौती', net: 'शुद्ध भुगतान', paid: 'भुगतान तिथि', bank: 'बैंक अंतरण', cash: 'नकद', ack: 'पावती', yes: 'हाँ', disputed: 'विवादित', sign: 'मज़दूर के हस्ताक्षर या अंगूठे का निशान: ____________' },
};
