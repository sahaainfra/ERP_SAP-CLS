import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { toPdf } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { nowIso } from '../proc/base.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { STATUS, createFlow } from '../qa/flow.js';
import { annualTax, computeBreakup, r2 } from './engine.js';

// Part 24.02: monthly staff payroll.
//  FR-01 a run of a company (or a branch) for a period of the payroll calendar: the employees in service, their pay assignment in force (24.01), the LOCKED
//  attendance of the month (07.06: paid days, LOP, approved overtime — BR-01, an employee whose month is not locked is left out and listed), leave encashment
//  (07.07) and loss recoveries (16.09) captured from their events, advance instalments due (07.12), the arrears of retro revisions (24.01), inputs by payroll.
//  FR-02 gross to net with every component (the pay engine of 24.01), TDS on salary projected over the financial year under the employee's regime.
//  FR-03 checks: negative net pay (blocks), no verified bank account, a change against last month beyond the threshold. FR-05 a hold with its reason.
//  FR-04 draft → computed again until sent → PAY → HRMGR → CFO → locked: the inputs are applied, the advance recoveries recorded, the period locked;
//  a correction after the lock is a supplementary run. FR-06 the cost of each employee by project and site from the days at each site, else the deployments.

export const RUN_DOC = 'PAY_RUN';
const paise = (v) => Math.round(Number(v) * 100);
const rs = (p) => (p == null ? null : p / 100);
const monthEnd = (p) => { const [y, m] = p.split('-').map(Number); return `${p}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
const addMonths = (p, n) => { const [y, m] = p.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`; };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** The financial year of a period: 2026-10 → { code '2026-27', start '2026-04', months left in it counting this one }. */
export const fyOf = (period) => { const y = Number(period.slice(0, 4)); const m = Number(period.slice(5, 7)); const s = m >= 4 ? y : y - 1; return { code: `${s}-${String((s + 1) % 100).padStart(2, '0')}`, start: `${s}-04`, end: `${s + 1}-03`, left: (m >= 4 ? 16 - m : 4 - m) }; };
const CAPS = { sec80C: 150000, sec80CCD1B: 50000, sec80D: 100000, sec24b: 200000 };
export const VARIANCE_PCT = 20;
// D-745: a run of more employees than this is computed as a background job with progress; smaller runs are computed in the request.
if (!parameterRegistry.get('pay.run.async_employees')) parameterRegistry.define({ key: 'pay.run.async_employees', dataType: 'integer', default: 500, scopes: ['system', 'company'], description: 'Part 24.02 (D-745): a payroll run of more employees than this is computed as a background job with progress; smaller runs are computed at once.', min: 1, max: 1000000 });

export const payRunList = defineList({
  code: 'pay.runs', label: 'Payroll runs', permission: 'pay.run.view', from: 'pay_runs x', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.period'], defaultSort: '-period',
  columns: { docNo: { sql: 'x.doc_no', type: 'text', label: 'Run' }, period: { sql: 'x.period', type: 'text', label: 'Period', filter: 'eq' }, type: { sql: 'x.run_type', type: 'enum', label: 'Type', options: [['REGULAR', 'Regular'], ['SUPPLEMENTARY', 'Supplementary']] }, employees: { sql: 'x.employees_count', type: 'number', label: 'Employees' }, net: { sql: '(x.net_paise / 100.0)', type: 'money', label: 'Net' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(STATUS), filter: 'eq' } },
});

/** The deductions from income under the old regime (chapter VI-A within the caps, home-loan interest, professional tax); none under the new regime. Also used by the full-and-final (24.05). */
export function regimeDeductions(regime, ver, pfYear, ptYear) {
  if (regime !== 'OLD') return 0; const v = ver ?? {};
  return Math.min(CAPS.sec80C, (v.sec80C ?? 0) + pfYear) + Math.min(CAPS.sec80CCD1B, v.sec80CCD1B ?? 0) + Math.min(CAPS.sec80D, v.sec80D ?? 0) + Math.min(CAPS.sec24b, v.sec24b ?? 0) + (v.other ?? 0) + ptYear;
}
/** TDS of the month (FR-02): the tax of the projected year under the regime, less what was deducted, over the months left. Pure. */
export function tdsOfMonth({ params, ytdTaxable, monthTaxable, futureMonthly, monthsLeft, ytdTds, deductions = 0 }) {
  const annual = r2(ytdTaxable + monthTaxable + futureMonthly * Math.max(0, monthsLeft - 1)); const t = annualTax(params, annual, deductions);
  return { projectedAnnual: annual, ...t, ytdTds, monthsLeft, month: Math.max(0, Math.round((t.total - ytdTds) / Math.max(1, monthsLeft))) };
}

/** @param {{ db: any, base: any, flags: any, setup: any, expenses: () => any }} o */
export function createPayRunService({ db, base, flags, setup, expenses }) {
  const { may, audit, notify } = base;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const on = (companyId) => flags.isOn({ companyId, user: 'system', roles: [] }, 'ff.pay.p2402');
  const evt = (type, actor, companyId, entity, entityId, data) => publishEvent(db, { type, entity, entityId, actorId: actor?.user ?? 'system', companyId, data });
  const seesPay = (actor) => may(actor, 'pay.salary.view');
  const mask = (actor, v) => (seesPay(actor) ? v : null);
  const has = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
  const rolesOf = (companyId, user) => { try { return JSON.parse(db.prepare('SELECT roles_json FROM iam_users WHERE company_id = ? AND username = ?').get(companyId, user)?.roles_json ?? '[]').flat(); } catch { return []; } };

  // ---- inputs ----
  /** The payroll period an input from an event goes to: the earliest period still open from the month before the event (the next payroll to run), else the event's month. */
  const nextPeriod = (companyId, at) => { const m = (at ?? nowIso()).slice(0, 7); return db.prepare("SELECT MIN(period) AS p FROM pay_calendar WHERE company_id = ? AND cal_status IN ('OPEN', 'PROCESSING') AND period >= ? AND deleted_at IS NULL").get(companyId, addMonths(m, -1))?.p ?? m; };
  /** Leave encashment (07.07): days of wages, valued at the run. */
  function onEncashment(e) { const d = e.data ?? {}; const c = Number(e.companyId); if (!c || !d.employeeId || !(d.days > 0)) return; const period = (e.createdAt ?? nowIso()).slice(0, 7);
    db.prepare("INSERT OR IGNORE INTO pay_inputs (company_id, employee_id, period, component_code, qty_milli, basis, note, created_by, source_type, source_id) VALUES (?, ?, ?, 'LEAVE_ENC', ?, 'DAYS_OF_WAGES', ?, 'system', 'lv.encashment.input', ?)").run(c, Number(d.employeeId), nextPeriod(c, period), Math.round(Number(d.days) * 1000), `${d.leaveType} encashment ${d.year}`, `${e.entityId ?? ''}-${d.employeeId}-${d.leaveType}-${d.year}`); }
  /** A loss of a small asset recovered from salary (16.09). */
  function onLossRecovery(e) { const d = e.data ?? {}; const c = Number(e.companyId); if (!c || d.recoveryFrom !== 'SALARY' || !d.employeeId || !(d.amount > 0)) return;
    db.prepare("INSERT OR IGNORE INTO pay_inputs (company_id, employee_id, period, component_code, amount_paise, note, created_by, source_type, source_id) VALUES (?, ?, ?, 'RECOVERY', ?, ?, 'system', 'inv.asset.recovery_approved', ?)").run(c, Number(d.employeeId), nextPeriod(c, e.createdAt), paise(d.amount), `Loss ${d.docNo} (${d.tag ?? ''})`, String(d.lossId ?? e.entityId)); }
  const inputs = {
    list(actor, { period, status = 'PENDING' }) { need(actor, 'pay.run.view', 'see payroll inputs'); return db.prepare(`SELECT i.*, e.emp_code, e.full_name FROM pay_inputs i JOIN hr_employees e ON e.id = i.employee_id WHERE i.company_id = ? AND i.deleted_at IS NULL AND i.input_status = ?${period ? ' AND i.period <= ?' : ''} ORDER BY e.emp_code, i.id`).all(actor.companyId, status, ...(period ? [period] : []))
      .map((i) => ({ id: i.id, employeeId: i.employee_id, employee: `${i.emp_code} ${i.full_name}`, period: i.period, code: i.component_code, amount: mask(actor, rs(i.amount_paise)), qty: i.qty_milli == null ? null : i.qty_milli / 1000, basis: i.basis, note: i.note, source: i.source_type, status: i.input_status })); },
    add(actor, b) { need(actor, 'pay.input.manage', 'enter payroll inputs'); const e = db.prepare("SELECT id FROM hr_employees WHERE id = ? AND company_id = ? AND deleted_at IS NULL").get(Number(b.employeeId), actor.companyId); if (!e) throw badRequest('Correct the highlighted fields', [{ field: 'employeeId', message: 'Not an employee of the company.' }]);
      const comp = setup.compRows(actor.companyId).find((c) => c.code === b.code && c.calc_method === 'INPUT'); if (!comp) throw badRequest('Correct the highlighted fields', [{ field: 'code', message: 'Choose a monthly input component.' }]);
      const id = Number(db.prepare("INSERT INTO pay_inputs (company_id, employee_id, period, component_code, amount_paise, note, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'manual')").run(actor.companyId, e.id, b.period, b.code, paise(b.amount), b.note, actor.user).lastInsertRowid); audit(actor, 'pay_inputs', id, 'create', actor.companyId, { reason: b.note, newValues: { employeeId: e.id, code: b.code, amount: b.amount, period: b.period } }); return { id }; },
    cancel(actor, id, { reason }) { need(actor, 'pay.input.manage', 'cancel payroll inputs'); const i = db.prepare("SELECT * FROM pay_inputs WHERE id = ? AND company_id = ? AND input_status = 'PENDING' AND deleted_at IS NULL").get(Number(id), actor.companyId); if (!i) throw notFound('Only a pending input is cancelled.'); db.prepare("UPDATE pay_inputs SET input_status = 'CANCELLED', updated_by = ?, updated_at = ? WHERE id = ?").run(actor.user, nowIso(), i.id); audit(actor, 'pay_inputs', i.id, 'cancel', actor.companyId, { reason }); return { id: i.id, status: 'CANCELLED' }; },
  };

  // ---- the attendance of a month (07.06): only locked days count (BR-01) ----
  function attendanceOf(employeeId, period) {
    const rows = db.prepare("SELECT work_date, daily_site_id, paid_day, lop_day, ot_paid_minutes, ot_approved_minutes, ot_multiplier, locked FROM att_daily WHERE person_type = 'EMPLOYEE' AND person_id = ? AND work_date BETWEEN ? AND ?").all(employeeId, `${period}-01`, monthEnd(period));
    return { rows, locked: rows.length > 0 && rows.every((r) => r.locked), unlocked: rows.filter((r) => !r.locked).length };
  }
  const bankOk = (e) => e.salary_payment_mode !== 'BANK_TRANSFER' || Boolean(db.prepare("SELECT 1 FROM hr_employee_banks WHERE employee_id = ? AND bank_status = 'ACTIVE' AND verified_status = 'VERIFIED' AND deleted_at IS NULL").get(e.id));
  const declarationOf = (employeeId, fy) => db.prepare("SELECT * FROM pay_tax_declarations WHERE employee_id = ? AND fy = ? AND deleted_at IS NULL").get(employeeId, fy) ?? null;
  /** FR-06: the share of the month at each site (days at the site), else at each deployment, else none. */
  function allocationOf(companyId, employeeId, period, rows) {
    const bySite = new Map(); for (const r of rows) if (r.daily_site_id && r.paid_day > 0) bySite.set(r.daily_site_id, (bySite.get(r.daily_site_id) ?? 0) + r.paid_day);
    if (bySite.size) { const total = [...bySite.values()].reduce((a, b) => a + b, 0); return [...bySite.entries()].map(([siteId, days]) => ({ siteId, projectId: db.prepare('SELECT org_project_id FROM org_sites WHERE id = ?').get(siteId)?.org_project_id ?? null, days, share: Math.round((days / total) * 10000) / 10000, basis: 'ATTENDANCE' })); }
    if (has('hr_deployments')) { const from = `${period}-01`; const to = monthEnd(period); const deps = db.prepare("SELECT dep_project_id, dep_site_id, from_date, to_date FROM hr_deployments WHERE company_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND status IN ('APPROVED', 'ACTIVE', 'ENDED') AND deleted_at IS NULL AND from_date <= ? AND (to_date IS NULL OR to_date >= ?)").all(companyId, employeeId, to, from);
      const parts = deps.map((d) => ({ projectId: d.dep_project_id, siteId: d.dep_site_id, days: daysBetween(d.from_date > from ? d.from_date : from, d.to_date && d.to_date < to ? d.to_date : to) + 1 })).filter((x) => x.days > 0); const total = parts.reduce((a, b) => a + b.days, 0);
      if (total) return parts.map((x) => ({ ...x, share: Math.round((x.days / total) * 10000) / 10000, basis: 'DEPLOYMENT' })); }
    return [];
  }

  /** FR-01/FR-02: one employee's month. Returns { line } or { excluded: reason }. */
  /** The set-up an employee's month needs, read once per computation (the structure's components, the statutory parameters by state, the Code rule). */
  const memo = (cache, k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };
  function contextCached(cache, companyId, e, date) {
    const st = memo(cache, `st:${e.id}`, () => db.prepare('SELECT pf_applicable, esi_applicable, pt_state, lwf_state FROM hr_employee_statutory WHERE employee_id = ? AND deleted_at IS NULL').get(e.id) ?? {});
    const pa = (code, state) => memo(cache, `p:${code}:${state ?? ''}:${date}`, () => setup.paramsAt(companyId, code, state, date));
    return { params: { PF: pa('PF', null), ESI: pa('ESI', null), PT: st.pt_state ? pa('PT', st.pt_state) : null, LWF: st.lwf_state ? pa('LWF', st.lwf_state) : null, GRATUITY: pa('GRATUITY', null) }, flags: { pf: Boolean(st.pf_applicable), esi: Boolean(st.esi_applicable), ptState: st.pt_state, lwfState: st.lwf_state, gender: e.gender }, wageRule: memo(cache, `rule:${date}`, () => setup.wageRuleAt(companyId, date)) };
  }
  function computeEmployee(companyId, e, period, run, prevNet, cache = new Map()) {
    const end = monthEnd(period); const start = `${period}-01`; const a = setup.assignments.current(e.id, end); if (!a) return { excluded: 'NO_ASSIGNMENT' };
    const att = attendanceOf(e.id, period); if (!att.locked) return { excluded: att.rows.length ? 'ATTENDANCE_NOT_LOCKED' : 'NO_ATTENDANCE', detail: att.unlocked };
    const { comps, values } = memo(cache, `sc:${a.structure_id}`, () => setup.structComps(companyId, db.prepare('SELECT * FROM pay_structures WHERE id = ?').get(a.structure_id))); const ctx = contextCached(cache, companyId, e, end);
    const dim = Number(end.slice(8)); const inFrom = e.doj > start ? e.doj : start; const inTo = e.last_working_date && e.last_working_date < end ? e.last_working_date : end; const inService = Math.max(0, daysBetween(inFrom, inTo) + 1);
    const lop = att.rows.reduce((x, r) => x + (r.lop_day ?? 0), 0); const payable = Math.max(0, inService - lop); const factor = Math.round((payable / dim) * 10000) / 10000;
    const full = computeBreakup({ components: comps, values, overrides: JSON.parse(a.overrides_json), ctcAnnual: rs(a.ctc_annual_paise), params: ctx.params, employee: ctx.flags, month: period, wageRule: ctx.wageRule });
    // inputs of the month
    const inp = {}; /** @type {any} */ const used = { arrears: [], inputs: [], advances: [] }; const add = (code, v) => { if (v) inp[code] = r2((inp[code] ?? 0) + v); };
    const otMin = att.rows.reduce((x, r) => x + (r.ot_paid_minutes || r.ot_approved_minutes || 0), 0); const otMult = att.rows.find((r) => r.ot_multiplier)?.ot_multiplier ?? memo(cache, `ot:${end}`, () => setup.paramsAt(companyId, 'OT', null, end))?.multiplier ?? 2;
    const hourly = (full.wages.codeWages || full.fullGross) / (26 * 8); if (otMin > 0) add('OVERTIME', r2(hourly * otMult * (otMin / 60)));
    // arrears of the months before this one; the arrear of this month itself is not paid: the run pays the month at the new rate (cancelled at the lock)
    for (const ar of db.prepare("SELECT id, amount_paise, arrear_month FROM pay_arrears WHERE employee_id = ? AND company_id = ? AND arrear_status = 'PENDING' AND arrear_month <= ? AND deleted_at IS NULL").all(e.id, companyId, period)) { if (ar.arrear_month === period) { (used.cancelArrears ??= []).push(ar.id); continue; } add('ARREARS', rs(ar.amount_paise)); used.arrears.push(ar.id); }
    const dayRate = r2(((full.lines.find((l) => l.code === 'BASIC')?.full ?? 0) + (full.lines.find((l) => l.code === 'DA')?.full ?? 0)) / 26);
    for (const i of db.prepare("SELECT * FROM pay_inputs WHERE employee_id = ? AND company_id = ? AND input_status = 'PENDING' AND period <= ? AND deleted_at IS NULL").all(e.id, companyId, period)) { add(i.component_code, i.basis === 'DAYS_OF_WAGES' ? r2(dayRate * ((i.qty_milli ?? 0) / 1000)) : rs(i.amount_paise)); used.inputs.push(i.id); }
    if (has('exp_advance_recoveries')) for (const rc of db.prepare("SELECT r.id, r.amount_minor FROM exp_advance_recoveries r JOIN exp_advances a ON a.id = r.advance_id WHERE a.employee_id = ? AND r.company_id = ? AND r.kind = 'PAYROLL' AND r.rec_status = 'PLANNED' AND r.due_month <= ? AND r.deleted_at IS NULL").all(e.id, companyId, period)) { add('ADVANCE', rs(rc.amount_minor)); used.advances.push({ id: rc.id, amount: rs(rc.amount_minor) }); }
    const b = computeBreakup({ components: comps, values, overrides: JSON.parse(a.overrides_json), ctcAnnual: rs(a.ctc_annual_paise), params: ctx.params, employee: ctx.flags, month: period, wageRule: ctx.wageRule, factor, inputs: inp, esiGross: full.fullGross, ptGross: undefined });
    // TDS (FR-02): projected over the year under the declared regime
    const fy = fyOf(period); const decl = declarationOf(e.id, fy.code); const regime = decl?.regime ?? 'NEW'; const p = memo(cache, `tds:${regime}:${end}`, () => setup.paramsAt(companyId, regime === 'OLD' ? 'TDS_OLD' : 'TDS_NEW', null, end));
    const ytd = db.prepare("SELECT COALESCE(SUM(l.taxable_paise), 0) AS t, COALESCE(SUM(l.tds_paise), 0) AS d FROM pay_run_lines l JOIN pay_runs r ON r.id = l.run_id WHERE l.employee_id = ? AND r.status = 'APPROVED' AND r.period >= ? AND r.period < ? AND l.deleted_at IS NULL AND r.deleted_at IS NULL").get(e.id, fy.start, period);
    const ver = decl && decl.decl_status === 'VERIFIED' ? JSON.parse(decl.verified_json) : decl ? JSON.parse(decl.declarations_json) : {}; const pfYear = (b.lines.find((l) => l.code === 'PF_EE')?.amount ?? 0) * 12;
    const ded = regimeDeductions(regime, ver, pfYear, (b.lines.find((l) => l.code === 'PT')?.amount ?? 0) * 12);
    const tds = p ? tdsOfMonth({ params: p, ytdTaxable: rs(ytd.t), monthTaxable: b.taxableGross, futureMonthly: full.taxableGross, monthsLeft: fy.left, ytdTds: rs(ytd.d), deductions: ded }) : { month: 0 };
    const tl = b.lines.find((l) => l.code === 'TDS'); if (tl) { tl.amount = tds.month; b.deductions = r2(b.deductions + tds.month); b.net = r2(b.net - tds.month); }
    // FR-03: the checks
    const flags = []; if (b.net < 0) flags.push({ code: 'NEGATIVE_NET', severity: 'BLOCK', text: `Net pay is ₹${b.net}: hold the salary or reduce the deductions.` });
    const ok = bankOk(e); if (!ok) flags.push({ code: 'NO_BANK', severity: 'WARN', text: 'No verified bank account for a bank transfer.' });
    if (prevNet != null && prevNet > 0 && Math.abs(b.net - prevNet) / prevNet * 100 > VARIANCE_PCT) flags.push({ code: 'VARIANCE', severity: 'WARN', text: `Net ₹${b.net} against ₹${prevNet} last month (${Math.round(((b.net - prevNet) / prevNet) * 100)} %).` });
    if (payable < inService) flags.push({ code: 'LOP', severity: 'INFO', text: `${lop} day(s) of loss of pay.` });
    return { line: { assignmentId: a.id, daysInMonth: dim, payableDays: payable, paidDays: att.rows.reduce((x, r) => x + (r.paid_day ?? 0), 0), lopDays: lop, otHours: r2(otMin / 60), breakup: b, tds, regime, flags, allocation: allocationOf(companyId, e.id, period, att.rows), bankOk: ok, mode: e.salary_payment_mode, used } };
  }

  // ---- the run (approval-controlled) ----
  const flow = createFlow({ db, base, docType: RUN_DOC, table: 'pay_runs', perm: 'pay.run', label: 'payroll run', route: '/payroll/runs?id=', where: () => ({ pid: null, sid: null }),
    ctx: (r) => ({ total: rs(r.net_paise), period: r.period, makerRole: rolesOf(r.company_id, r.requested_by ?? r.created_by).includes('PAY') ? 'PAY' : 'OTHER' }), title: (r) => `Payroll ${r.period} (${r.run_type.toLowerCase()}): ${r.employees_count} employees, net ₹${rs(r.net_paise)}`, notifyCode: 'pay.run.decided', prefix: 'PRUN',
    beforeSubmit: (_a, r) => { if (!on(r.company_id)) throw unprocessable('Payroll runs are off for the company (ff.pay.p2402).'); if (!r.computed_at) throw unprocessable(JSON.parse(r.inputs_json || '{}').job ? 'The run is still being computed in the background: send it once it is done.' : 'Compute the run first.');
      const blocking = db.prepare("SELECT COUNT(*) AS n FROM pay_run_lines WHERE run_id = ? AND hold = 0 AND deleted_at IS NULL AND flags_json LIKE '%\"BLOCK\"%'").get(r.id).n; if (blocking) throw unprocessable(`${blocking} employee(s) have a blocking check (negative net pay): hold them or correct the inputs.`);
      const stale = db.prepare("SELECT COUNT(*) AS n FROM att_daily d JOIN pay_run_lines l ON l.employee_id = d.person_id AND d.person_type = 'EMPLOYEE' WHERE l.run_id = ? AND l.deleted_at IS NULL AND d.work_date BETWEEN ? AND ? AND d.locked = 0").get(r.id, `${r.period}-01`, monthEnd(r.period)).n; if (stale) throw unprocessable('The attendance of some employees was reopened after the run: compute it again (BR-01).'); },
    onApproved: (actor, r) => lock(actor, db.prepare('SELECT * FROM pay_runs WHERE id = ?').get(r.id)) });
  function lock(actor, r) {
    const lines = db.prepare('SELECT * FROM pay_run_lines WHERE run_id = ? AND deleted_at IS NULL').all(r.id); const maker = { user: r.requested_by, roles: rolesOf(r.company_id, r.requested_by), companyId: r.company_id };
    for (const l of lines) { const u = JSON.parse(l.tds_json || '{}').used ?? {};
      if (u.arrears?.length) db.prepare(`UPDATE pay_arrears SET arrear_status = 'PAID', paid_run_id = ?, updated_at = ? WHERE id IN (${u.arrears.map(Number).join(',')}) AND arrear_status = 'PENDING'`).run(r.id, nowIso());
      if (u.cancelArrears?.length) db.prepare(`UPDATE pay_arrears SET arrear_status = 'CANCELLED', paid_run_id = ?, remarks = 'paid at the new rate by the run of the month', updated_at = ? WHERE id IN (${u.cancelArrears.map(Number).join(',')}) AND arrear_status = 'PENDING'`).run(r.id, nowIso());
      if (u.inputs?.length) db.prepare(`UPDATE pay_inputs SET input_status = 'APPLIED', run_id = ?, updated_at = ? WHERE id IN (${u.inputs.map(Number).join(',')}) AND input_status = 'PENDING'`).run(r.id, nowIso());
      // the advance instalments recovered: recorded through the expenses service (07.12) as the payroll preparer
      for (const a of u.advances ?? []) { try { expenses()?.advances.recoveries.recover(maker, a.id, { amount: a.amount, reference: `${r.doc_no}` }); } catch (x) { notify(r.company_id, 'pay.run.alert', ['permission:pay.run.create'], r.doc_no, 'advance recovery', `The advance instalment ${a.id} could not be recorded: ${x.message}`, `/payroll/runs?id=${r.id}`, `${r.id}-adv-${a.id}`); } } }
    db.prepare('UPDATE pay_runs SET locked_at = ? WHERE id = ?').run(nowIso(), r.id); if (r.run_type === 'REGULAR' && r.period_id) db.prepare("UPDATE pay_calendar SET cal_status = 'LOCKED', updated_at = ? WHERE id = ?").run(nowIso(), r.period_id);
    evt('pay.run.approved', actor, r.company_id, 'pay_runs', r.id, { runId: r.id, docNo: r.doc_no, period: r.period, type: r.run_type, branchId: r.branch_id, employees: r.employees_count, gross: rs(r.gross_paise), deductions: rs(r.deductions_paise), employer: rs(r.employer_paise), net: rs(r.net_paise), tds: rs(r.tds_paise), held: r.held_count });
  }
  const lineView = (actor, l, e) => ({ id: l.id, employeeId: l.employee_id, employee: e ? `${e.emp_code} ${e.full_name}` : null, daysInMonth: l.days_in_month, payableDays: l.payable_days, paidDays: l.paid_days, lopDays: l.lop_days, otHours: l.ot_hours,
    gross: mask(actor, rs(l.gross_paise)), deductions: mask(actor, rs(l.deductions_paise)), employer: mask(actor, rs(l.employer_paise)), net: mask(actor, rs(l.net_paise)), tds: mask(actor, rs(l.tds_paise)), components: seesPay(actor) ? JSON.parse(l.components_json) : null, tdsWorking: seesPay(actor) ? (({ used: _used, ...t }) => t)(JSON.parse(l.tds_json || '{}')) : null, wages: seesPay(actor) ? JSON.parse(l.wages_json || '{}') : null,
    flags: JSON.parse(l.flags_json), hold: Boolean(l.hold), holdReason: l.hold_reason, allocation: JSON.parse(l.allocation_json), bankOk: Boolean(l.bank_ok), mode: l.payment_mode, version: l.version });
  const view = (actor, r, detail = false) => {
    const o = { id: r.id, docNo: r.doc_no, period: r.period, type: r.run_type, branchId: r.branch_id, employees: r.employees_count, gross: mask(actor, rs(r.gross_paise)), deductions: mask(actor, rs(r.deductions_paise)), employer: mask(actor, rs(r.employer_paise)), net: mask(actor, rs(r.net_paise)), tds: mask(actor, rs(r.tds_paise)), held: r.held_count, flags: r.flags_count, blocking: r.blocking_count, computedAt: r.computed_at, lockedAt: r.locked_at, status: r.status, statusLabel: STATUS[r.status], requestedBy: r.requested_by, approvedBy: r.approved_by, version: r.version, masked: !seesPay(actor), can: { ...flow.can(actor, r), compute: ['DRAFT', 'RETURNED'].includes(r.status) && may(actor, 'pay.run.edit'), hold: ['DRAFT', 'RETURNED'].includes(r.status) && may(actor, 'pay.run.edit') } };
    if (detail) { const emps = new Map(db.prepare('SELECT e.id, e.emp_code, e.full_name FROM hr_employees e JOIN pay_run_lines l ON l.employee_id = e.id WHERE l.run_id = ?').all(r.id).map((e) => [e.id, e]));
      o.lines = db.prepare('SELECT * FROM pay_run_lines WHERE run_id = ? AND deleted_at IS NULL ORDER BY id').all(r.id).map((l) => lineView(actor, l, emps.get(l.employee_id))); o.inputs = JSON.parse(r.inputs_json || '{}'); const jb = o.inputs.job ? db.prepare('SELECT status, progress, progress_message, error FROM core_jobs WHERE job_id = ?').get(o.inputs.job.id) : null; o.job = jb ? { id: o.inputs.job.id, status: jb.status, progress: jb.progress, message: jb.progress_message, error: jb.error, employees: o.inputs.job.employees } : null; o.computing = Boolean(jb && ['QUEUED', 'RUNNING'].includes(jb.status)); Object.assign(o.can, flow.approveInfo(actor, r)); o.history = flow.history(actor, r.id); }
    return o;
  };
  const editable = (actor, id) => { const r = flow.row(actor, id, 'pay.run.edit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict('Only a run in draft or returned is changed; after the lock, corrections go in a supplementary run.'); return r; };
  /** FR-01: (re)compute the run: the employees, their months and the totals. A hold is kept across a recomputation. */
  /** @param {any} actor @param {any} r @param {((done: number, total: number) => void) | null} [onProgress] */
  function compute(actor, r, onProgress = null) {
    const c = r.company_id; const end = monthEnd(r.period); const start = `${r.period}-01`; const holds = new Map(db.prepare('SELECT employee_id, hold_reason FROM pay_run_lines WHERE run_id = ? AND hold = 1 AND deleted_at IS NULL').all(r.id).map((h) => [h.employee_id, h.hold_reason]));
    const chosen = JSON.parse(r.inputs_json || '{}').employeeIds ?? null;
    // 24.05: a leaver whose last month is paid by the full-and-final settlement is not paid again by the run
    const settled = has('pay_fnf') ? new Set(db.prepare("SELECT employee_id, working_json FROM pay_fnf WHERE company_id = ? AND status NOT IN ('CANCELLED', 'REJECTED', 'SUPERSEDED') AND deleted_at IS NULL").all(c).filter((f) => (JSON.parse(f.working_json || '{}').lastSalaryPeriods ?? []).includes(r.period)).map((f) => f.employee_id)) : new Set();
    const emps = db.prepare(`SELECT * FROM hr_employees WHERE company_id = ? AND deleted_at IS NULL AND record_status = 'APPROVED' AND doj <= ? AND (last_working_date IS NULL OR last_working_date >= ?)${r.branch_id ? ' AND branch_id = ?' : ''} ORDER BY emp_code`).all(c, end, start, ...(r.branch_id ? [r.branch_id] : [])).filter((e) => (!chosen || chosen.includes(e.id)) && !settled.has(e.id));
    const prevRun = db.prepare("SELECT id FROM pay_runs WHERE company_id = ? AND period = ? AND run_type = 'REGULAR' AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(c, addMonths(r.period, -1));
    const prevNet = new Map(prevRun ? db.prepare('SELECT employee_id, net_paise FROM pay_run_lines WHERE run_id = ? AND deleted_at IS NULL').all(prevRun.id).map((x) => [x.employee_id, rs(x.net_paise)]) : []);
    const ins = db.prepare("INSERT INTO pay_run_lines (company_id, run_id, employee_id, assignment_id, days_in_month, payable_days, paid_days, lop_days, ot_hours, components_json, gross_paise, taxable_paise, deductions_paise, employer_paise, net_paise, tds_paise, tds_json, wages_json, flags_json, hold, hold_reason, allocation_json, bank_ok, payment_mode, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pay_runs')");
    // each employee's month is read and computed first (outside the write, so the progress of a background job is visible), then the lines are written at once
    const cache = new Map(); const results = emps.map((e, i) => { if (onProgress && i % 50 === 0) onProgress(i, emps.length); return { e, x: computeEmployee(c, e, r.period, r, prevNet.get(e.id) ?? null, cache) }; }); if (onProgress) onProgress(emps.length, emps.length);
    return transaction(db, () => {
      db.prepare('DELETE FROM pay_run_lines WHERE run_id = ?').run(r.id); const excluded = []; const T = { n: 0, gross: 0, ded: 0, er: 0, net: 0, tds: 0, held: 0, flags: 0, block: 0 };
      for (const { e, x } of results) { if (x.excluded) { excluded.push({ employeeId: e.id, employee: `${e.emp_code} ${e.full_name}`, reason: x.excluded, detail: x.detail ?? null }); continue; }
        const l = x.line; const b = l.breakup; const hold = holds.has(e.id); const totalPay = r2(b.gross + b.employer);
        const alloc = l.allocation.map((a) => ({ ...a, amount: r2(totalPay * a.share) }));
        ins.run(c, r.id, e.id, l.assignmentId, l.daysInMonth, l.payableDays, l.paidDays, l.lopDays, l.otHours, JSON.stringify(b.lines.filter((y) => y.amount || y.full).map((y) => ({ code: y.code, name: y.name, type: y.type, amount: y.amount, full: y.full }))), paise(b.gross), paise(b.taxableGross), paise(b.deductions), paise(b.employer), paise(b.net), paise(l.tds.month ?? 0), JSON.stringify({ ...l.tds, regime: l.regime, used: l.used }), JSON.stringify({ ...b.wages, pfWage: b.pfWage, esiWage: b.esiWage }), JSON.stringify(l.flags), hold ? 1 : 0, holds.get(e.id) ?? null, JSON.stringify(alloc), l.bankOk ? 1 : 0, l.mode, actor.user);
        T.n += 1; T.gross += paise(b.gross); T.ded += paise(b.deductions); T.er += paise(b.employer); T.tds += paise(l.tds.month ?? 0); if (hold) T.held += 1; else T.net += paise(b.net); if (l.flags.some((f) => f.severity !== 'INFO')) T.flags += 1; if (!hold && l.flags.some((f) => f.severity === 'BLOCK')) T.block += 1; }
      const prevJob = JSON.parse(r.inputs_json || '{}').job; const summary = { ...(chosen ? { employeeIds: chosen } : {}), ...(prevJob ? { job: prevJob } : {}), excluded, attendanceLocked: emps.length - excluded.filter((x) => x.reason !== 'NO_ASSIGNMENT').length, arrears: db.prepare("SELECT COUNT(*) AS n FROM pay_arrears WHERE company_id = ? AND arrear_status = 'PENDING' AND arrear_month <= ?").get(c, r.period).n, inputs: db.prepare("SELECT COUNT(*) AS n FROM pay_inputs WHERE company_id = ? AND input_status = 'PENDING' AND period <= ? AND deleted_at IS NULL").get(c, r.period).n };
      db.prepare('UPDATE pay_runs SET employees_count = ?, gross_paise = ?, deductions_paise = ?, employer_paise = ?, net_paise = ?, tds_paise = ?, held_count = ?, flags_count = ?, blocking_count = ?, inputs_json = ?, computed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(T.n, T.gross, T.ded, T.er, T.net, T.tds, T.held, T.flags, T.block, JSON.stringify(summary), nowIso(), actor.user, nowIso(), r.id);
      audit(actor, 'pay_runs', r.id, 'compute', c, { newValues: { employees: T.n, excluded: excluded.length, net: rs(T.net) } }); });
  }
  const empCount = (r) => { const chosen = JSON.parse(r.inputs_json || '{}').employeeIds ?? null; if (chosen) return chosen.length; return db.prepare(`SELECT COUNT(*) AS n FROM hr_employees WHERE company_id = ? AND deleted_at IS NULL AND record_status = 'APPROVED' AND doj <= ? AND (last_working_date IS NULL OR last_working_date >= ?)${r.branch_id ? ' AND branch_id = ?' : ''}`).get(r.company_id, monthEnd(r.period), `${r.period}-01`, ...(r.branch_id ? [r.branch_id] : [])).n; };
  /** D-745: a large run is queued as the job `pay.run.compute` (progress, cancellation, the preparer told when it is done); a small one is computed at once. */
  function computeOrQueue(actor, r) {
    const limit = Number(base.param(r.company_id, 'pay.run.async_employees') ?? 500); const n = empCount(r); const jobs = runtimeOf(db)?.jobs;
    if (!jobs || n <= limit) { compute(actor, r); return; }
    const pending = JSON.parse(r.inputs_json || '{}').job; if (pending && db.prepare("SELECT 1 FROM core_jobs WHERE job_id = ? AND status IN ('QUEUED', 'RUNNING')").get(pending.id)) throw conflict('The run is being computed already: wait for it to finish.');
    const job = jobs.enqueue('pay.run.compute', { runId: r.id, user: actor.user }, { createdBy: actor.user, companyId: r.company_id });
    db.prepare('UPDATE pay_runs SET inputs_json = ?, computed_at = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify({ ...JSON.parse(r.inputs_json || '{}'), job: { id: job.jobId, queuedAt: nowIso(), employees: n } }), actor.user, nowIso(), r.id);
    audit(actor, 'pay_runs', r.id, 'queue', r.company_id, { newValues: { jobId: job.jobId, employees: n } });
  }
  /** The background job: computes the run with progress, then tells the preparer. */
  function runJob(ctx) {
    const r = db.prepare('SELECT * FROM pay_runs WHERE id = ?').get(Number(ctx.params.runId)); if (!r || !['DRAFT', 'RETURNED'].includes(r.status)) { ctx.log('The run is no longer in draft: nothing to compute.'); return { skipped: true }; }
    const actor = { user: ctx.params.user, roles: rolesOf(r.company_id, ctx.params.user), companyId: r.company_id };
    compute(actor, r, (done, total) => { ctx.setProgress(total ? (done * 100) / total : 100, `${done} of ${total} employees`); ctx.throwIfCancelled(); });
    const x = db.prepare('SELECT * FROM pay_runs WHERE id = ?').get(r.id); ctx.log(`Computed ${x.employees_count} employee(s), net ${rs(x.net_paise)}`);
    notify(r.company_id, 'pay.run.alert', [`user:${ctx.params.user}`], r.doc_no, 'computed', `The payroll of ${r.period} is computed: ${x.employees_count} employee(s), net ₹${rs(x.net_paise)}. Review it and send it for approval.`, `/payroll/runs?id=${r.id}`, `${r.id}-computed-${ctx.jobId}`);
    return { runId: r.id, employees: x.employees_count };
  }
  const runs = {
    flow, runJob,
    list(actor, query) { need(actor, 'pay.run.view', 'see payroll runs'); return runList(db, payRunList, parseListRequest(payRunList, query), { select: 'x.*', scopeSql: 'x.company_id = :c', params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => view(actor, r) }); },
    get(actor, id) { return view(actor, flow.row(actor, id), true); },
    /** FR-01 step 1: the readiness of a period — attendance locked, pending arrears and inputs, advances due, employees without pay. */
    readiness(actor, { period, branchId }) { need(actor, 'pay.run.view', 'see payroll readiness'); const c = actor.companyId; const end = monthEnd(period); const start = `${period}-01`;
      const emps = db.prepare(`SELECT * FROM hr_employees WHERE company_id = ? AND deleted_at IS NULL AND record_status = 'APPROVED' AND doj <= ? AND (last_working_date IS NULL OR last_working_date >= ?)${branchId ? ' AND branch_id = ?' : ''}`).all(c, end, start, ...(branchId ? [branchId] : []));
      let locked = 0; let open = 0; let none = 0; let noPay = 0; for (const e of emps) { if (!setup.assignments.current(e.id, end)) noPay += 1; const a = attendanceOf(e.id, period); if (!a.rows.length) none += 1; else if (a.locked) locked += 1; else open += 1; }
      const cal = setup.calendar.periodOf(c, period); const reg = db.prepare("SELECT id, doc_no, status FROM pay_runs WHERE company_id = ? AND period = ? AND run_type = 'REGULAR' AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') AND deleted_at IS NULL AND COALESCE(branch_id, 0) = ?").get(c, period, branchId ?? 0);
      return { period, calendar: cal ? { id: cal.id, status: cal.cal_status, attendanceCutoff: cal.attendance_cutoff, inputsCutoff: cal.inputs_cutoff, payDate: cal.pay_date } : null, employees: emps.length, attendance: { locked, open, none }, withoutPay: noPay,
        arrears: db.prepare("SELECT COUNT(*) AS n FROM pay_arrears WHERE company_id = ? AND arrear_status = 'PENDING' AND arrear_month <= ?").get(c, period).n, inputs: db.prepare("SELECT COUNT(*) AS n FROM pay_inputs WHERE company_id = ? AND input_status = 'PENDING' AND period <= ? AND deleted_at IS NULL").get(c, period).n,
        advances: has('exp_advance_recoveries') ? db.prepare("SELECT COUNT(*) AS n FROM exp_advance_recoveries WHERE company_id = ? AND kind = 'PAYROLL' AND rec_status = 'PLANNED' AND due_month <= ? AND deleted_at IS NULL").get(c, period).n : 0, regular: reg ? { id: reg.id, docNo: reg.doc_no, status: reg.status } : null, canCreate: may(actor, 'pay.run.create') }; },
    create(actor, b) {
      need(actor, 'pay.run.create', 'run payroll'); const c = actor.companyId; const cal = setup.calendar.periodOf(c, b.period); if (!cal) throw unprocessable(`${b.period} is not in the payroll calendar: set up the year first.`);
      const type = b.type ?? 'REGULAR'; if (type === 'REGULAR' && cal.cal_status !== 'OPEN' && cal.cal_status !== 'PROCESSING') throw conflict(`${b.period} is locked: a correction is a supplementary run.`);
      if (type === 'SUPPLEMENTARY') { if (!b.employeeIds?.length) throw badRequest('Correct the highlighted fields', [{ field: 'employeeIds', message: 'Choose the employees of the supplementary run.' }]); if (!db.prepare("SELECT 1 FROM pay_runs WHERE company_id = ? AND period = ? AND run_type = 'REGULAR' AND status = 'APPROVED' AND deleted_at IS NULL").get(c, b.period)) throw unprocessable('A supplementary run follows the locked regular run of the period.'); }
      let id; try { id = Number(db.prepare("INSERT INTO pay_runs (company_id, doc_no, period, period_id, run_type, branch_id, inputs_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(c, flow.next(actor), b.period, cal.id, type, b.branchId ?? null, JSON.stringify(type === 'SUPPLEMENTARY' ? { employeeIds: b.employeeIds.map(Number) } : {}), actor.user).lastInsertRowid); } catch (x) { if (/UNIQUE/.test(String(x.message))) throw conflict(`The regular run of ${b.period} exists already.`); throw x; }
      if (type === 'REGULAR') db.prepare("UPDATE pay_calendar SET cal_status = 'PROCESSING' WHERE id = ? AND cal_status = 'OPEN'").run(cal.id);
      audit(actor, 'pay_runs', id, 'create', c, { newValues: { period: b.period, type } }); computeOrQueue(actor, db.prepare('SELECT * FROM pay_runs WHERE id = ?').get(id)); return runs.get(actor, id);
    },
    recompute(actor, id) { const r = editable(actor, id); computeOrQueue(actor, r); return runs.get(actor, r.id); },
    /** FR-05: hold or release the salary of an employee of the run, with the reason. */
    hold(actor, id, lineId, { hold, reason }) { const r = editable(actor, id); const l = db.prepare('SELECT * FROM pay_run_lines WHERE id = ? AND run_id = ? AND deleted_at IS NULL').get(Number(lineId), r.id); if (!l) throw notFound('That employee is not in the run.');
      if (hold && (reason ?? '').trim().length < 5) throw badRequest('Correct the highlighted fields', [{ field: 'reason', message: 'Say why the salary is held.' }]);
      db.prepare('UPDATE pay_run_lines SET hold = ?, hold_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(hold ? 1 : 0, hold ? reason : null, actor.user, nowIso(), l.id);
      const t = db.prepare("SELECT COUNT(*) FILTER (WHERE hold = 1) AS held, COALESCE(SUM(CASE WHEN hold = 0 THEN net_paise END), 0) AS net, COUNT(*) FILTER (WHERE hold = 0 AND flags_json LIKE '%\"BLOCK\"%') AS block FROM pay_run_lines WHERE run_id = ? AND deleted_at IS NULL").get(r.id);
      db.prepare('UPDATE pay_runs SET held_count = ?, net_paise = ?, blocking_count = ?, version = version + 1 WHERE id = ?').run(t.held, t.net, t.block, r.id); audit(actor, 'pay_run_lines', l.id, hold ? 'hold' : 'release', r.company_id, { reason }); return runs.get(actor, r.id); },
    remove(actor, id) { const r = flow.row(actor, id, 'pay.run.delete'); const out = flow.remove(actor, id); if (r.run_type === 'REGULAR' && r.period_id) db.prepare("UPDATE pay_calendar SET cal_status = 'OPEN' WHERE id = ? AND cal_status = 'PROCESSING'").run(r.period_id); return out; },
    submit(actor, id) { flow.submit(actor, id); return runs.get(actor, id); },
    withdraw(actor, id, b) { flow.withdraw(actor, id, b); return runs.get(actor, id); },
    cancel(actor, id, b) { const r = flow.row(actor, id); flow.cancel(actor, id, b); if (r.run_type === 'REGULAR' && r.period_id) db.prepare("UPDATE pay_calendar SET cal_status = 'OPEN' WHERE id = ? AND cal_status = 'PROCESSING'").run(r.period_id); return runs.get(actor, id); },
    history: (actor, id) => flow.history(actor, id),
    /** The payroll register (FR: report): the lines of the run with their components. */
    register(actor, id) { const x = runs.get(actor, id); return x; },
    /** The variance against last month: each employee's net and gross now and in the previous regular run. */
    variance(actor, id) { const r = flow.row(actor, id); const prev = db.prepare("SELECT id, doc_no FROM pay_runs WHERE company_id = ? AND period = ? AND run_type = 'REGULAR' AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(r.company_id, addMonths(r.period, -1));
      const pl = new Map(prev ? db.prepare('SELECT employee_id, gross_paise, net_paise FROM pay_run_lines WHERE run_id = ? AND deleted_at IS NULL').all(prev.id).map((x) => [x.employee_id, x]) : []);
      const rows = db.prepare('SELECT l.employee_id, l.gross_paise, l.net_paise, e.emp_code, e.full_name FROM pay_run_lines l JOIN hr_employees e ON e.id = l.employee_id WHERE l.run_id = ? AND l.deleted_at IS NULL ORDER BY e.emp_code').all(r.id).map((x) => { const p = pl.get(x.employee_id); const dn = p ? x.net_paise - p.net_paise : null; return { employeeId: x.employee_id, employee: `${x.emp_code} ${x.full_name}`, gross: mask(actor, rs(x.gross_paise)), net: mask(actor, rs(x.net_paise)), previousNet: p ? mask(actor, rs(p.net_paise)) : null, change: dn == null ? null : mask(actor, rs(dn)), changePct: p && p.net_paise ? Math.round((dn / p.net_paise) * 1000) / 10 : null, isNew: !p, beyond: p && p.net_paise ? Math.abs(dn / p.net_paise) * 100 > VARIANCE_PCT : false }; });
      const left = prev ? [...pl.keys()].filter((k) => !rows.some((x) => x.employeeId === k)).length : 0; return { run: { id: r.id, docNo: r.doc_no, period: r.period }, previous: prev ? { id: prev.id, docNo: prev.doc_no } : null, thresholdPct: VARIANCE_PCT, rows, joined: rows.filter((x) => x.isNew).length, left }; },
    print(actor, id) { const r = flow.row(actor, id, 'pay.run.print'); if (!seesPay(actor)) throw forbidden('You may not see salaries (permission pay.salary.view).'); const x = runs.get(actor, id); audit(actor, 'pay_runs', r.id, 'print', r.company_id);
      return { contentType: 'application/pdf', fileName: `${r.doc_no.replaceAll('/', '-')}.pdf`, buffer: toPdf({ title: `Payroll register ${x.period} · ${x.docNo} · ${x.statusLabel}`, columns: [{ key: 'e', label: 'Employee', type: 'text' }, { key: 'd', label: 'Days' }, { key: 'g', label: 'Gross' }, { key: 'x', label: 'Deductions' }, { key: 't', label: 'TDS' }, { key: 'n', label: 'Net' }], rows: x.lines.map((l) => ({ e: `${l.employee}${l.hold ? ' (held)' : ''}`, d: l.payableDays, g: l.gross, x: l.deductions, t: l.tds, n: l.net })), footer: [`${x.employees} employees; gross ₹${x.gross}; net ₹${x.net} (held ${x.held}); employer ₹${x.employer}; TDS ₹${x.tds}.`] }) }; },
    exportCsv(actor, id) { const r = flow.row(actor, id, 'pay.run.export'); if (!seesPay(actor)) throw forbidden('You may not see salaries (permission pay.salary.view).'); const x = runs.get(actor, id); audit(actor, 'pay_runs', r.id, 'export', r.company_id); const codes = [...new Set(x.lines.flatMap((l) => l.components.map((c) => c.code)))];
      return { contentType: 'text/csv; charset=utf-8', fileName: `payroll-${x.period}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Employee', 'Payable days', 'LOP', 'OT hours', ...codes, 'Gross', 'Deductions', 'Employer', 'Net', 'Held'], x.lines.map((l) => [l.employee, l.payableDays, l.lopDays, l.otHours, ...codes.map((k) => l.components.find((c) => c.code === k)?.amount ?? 0), l.gross, l.deductions, l.employer, l.net, l.hold ? l.holdReason : '']))}`, 'utf8') }; },
  };

  // ---- tax declarations (ESS) ----
  const myEmployee = (actor) => { const uid = actor.userId ?? db.prepare('SELECT id FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND is_active = 1').get(actor.companyId, actor.user)?.id; return uid ? db.prepare("SELECT * FROM hr_employees WHERE company_id = ? AND user_id = ? AND deleted_at IS NULL AND record_status = 'APPROVED'").get(actor.companyId, uid) ?? null : null; };
  const declView = (actor, d) => { const e = db.prepare('SELECT emp_code, full_name FROM hr_employees WHERE id = ?').get(d.employee_id); return { id: d.id, employeeId: d.employee_id, employee: e ? `${e.emp_code} ${e.full_name}` : null, fy: d.fy, regime: d.regime, declarations: JSON.parse(d.declarations_json), proofs: JSON.parse(d.proofs_json), verified: JSON.parse(d.verified_json), status: d.decl_status, submittedAt: d.submitted_at, verifiedBy: d.verified_by, verifiedAt: d.verified_at, note: d.verify_note, version: d.version }; };
  const declarations = {
    mine(actor, { fy }) { need(actor, 'pay.declaration.own', 'declare your taxes'); const e = myEmployee(actor); if (!e) throw unprocessable('Your user account is not linked to an employee record. Ask HR to link it.'); const d = declarationOf(e.id, fy); return { employee: `${e.emp_code} ${e.full_name}`, fy, declaration: d ? declView(actor, d) : null, caps: CAPS }; },
    /** The employee's own declaration: the regime and the amounts, sent for verification (proofs as file ids of the document service). */
    saveMine(actor, b) { need(actor, 'pay.declaration.own', 'declare your taxes'); const e = myEmployee(actor); if (!e) throw unprocessable('Your user account is not linked to an employee record. Ask HR to link it.'); const d = declarationOf(e.id, b.fy);
      if (d && d.decl_status === 'VERIFIED') throw conflict('Your declaration is verified; ask payroll to return it to change it.');
      const decl = JSON.stringify(b.declarations ?? {}); const proofs = JSON.stringify(b.proofs ?? []); const st = b.submit ? 'SUBMITTED' : 'DRAFT';
      if (d) db.prepare('UPDATE pay_tax_declarations SET regime = ?, declarations_json = ?, proofs_json = ?, decl_status = ?, submitted_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.regime, decl, proofs, st, b.submit ? nowIso() : d.submitted_at, actor.user, nowIso(), d.id);
      else db.prepare("INSERT INTO pay_tax_declarations (company_id, employee_id, fy, regime, declarations_json, proofs_json, decl_status, submitted_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ess')").run(actor.companyId, e.id, b.fy, b.regime, decl, proofs, st, b.submit ? nowIso() : null, actor.user);
      const x = declarationOf(e.id, b.fy); audit(actor, 'pay_tax_declarations', x.id, b.submit ? 'submit' : 'save', actor.companyId, { newValues: { regime: b.regime, declarations: b.declarations } });
      if (b.submit) notify(actor.companyId, 'pay.run.alert', ['permission:pay.declaration.verify'], `${e.emp_code}`, 'declaration', `${e.emp_code} ${e.full_name} sent the tax declaration of ${b.fy} (${b.regime} regime).`, '/payroll/declarations', `${x.id}-${x.version}`);
      return declarations.mine(actor, { fy: b.fy }); },
    list(actor, { fy, status }) { need(actor, 'pay.declaration.view', 'see tax declarations'); return db.prepare(`SELECT * FROM pay_tax_declarations WHERE company_id = ? AND deleted_at IS NULL${fy ? ' AND fy = ?' : ''}${status ? ' AND decl_status = ?' : ''} ORDER BY decl_status = 'SUBMITTED' DESC, id DESC LIMIT 500`).all(actor.companyId, ...(fy ? [fy] : []), ...(status ? [status] : [])).map((d) => declView(actor, d)); },
    /** Payroll verifies (the amounts proved, which the TDS uses) or returns it to the employee. */
    verify(actor, id, b) { need(actor, 'pay.declaration.verify', 'verify tax declarations'); const d = db.prepare('SELECT * FROM pay_tax_declarations WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!d) throw notFound('That declaration does not exist.'); if (d.decl_status !== 'SUBMITTED') throw conflict('Only a submitted declaration is verified or returned.');
      const mine = myEmployee(actor); if (mine && mine.id === d.employee_id) throw forbidden('You do not verify your own declaration.');
      db.prepare('UPDATE pay_tax_declarations SET decl_status = ?, verified_json = ?, verified_by = ?, verified_at = ?, verify_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.action === 'return' ? 'RETURNED' : 'VERIFIED', JSON.stringify(b.action === 'return' ? {} : b.verified ?? JSON.parse(d.declarations_json)), actor.user, nowIso(), b.note ?? null, actor.user, nowIso(), d.id);
      audit(actor, 'pay_tax_declarations', d.id, b.action === 'return' ? 'return' : 'verify', actor.companyId, { reason: b.note ?? null, newValues: { verified: b.verified } }); return declView(actor, db.prepare('SELECT * FROM pay_tax_declarations WHERE id = ?').get(d.id)); },
  };

  return { runs, inputs, declarations, consumers: { onEncashment, onLossRecovery }, computeEmployee };
}
