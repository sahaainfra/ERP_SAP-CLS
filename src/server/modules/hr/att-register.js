import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { addDays, evaluateDay, weekday, withDefaults } from './att-calc.js';
import { attendanceOf } from './attendance.js';

// The attendance register (part 07.06). One row of att_daily is a person on a day: what the punches, the shift, the roster, the holidays, the approved regularisations, manual entries, visits and overtime make of it under the
// policy that resolves for that person. The engine is deterministic (BR-01): the same inputs always give the same row, and the row is recomputed whenever an input changes until the period is locked. A locked row is never
// rewritten (BR-03): what a later change would have changed is kept in att_arrears for payroll. The inputs come from services that exist today; leave (part 07.07) joins through `registerLeaveSource`.
export const STATUS_LABELS = { PRESENT: 'Present', ABSENT: 'Absent', HALF_DAY: 'Half day', ON_LEAVE: 'On leave', HOLIDAY: 'Holiday', WEEKLY_OFF: 'Weekly off', ON_DUTY: 'On duty', COMP_OFF: 'Comp-off', MISSING_PUNCH: 'Missing punch', HOLIDAY_WORKED: 'Worked on a holiday', WEEKLY_OFF_WORKED: 'Worked on a weekly off' };
export const STATUS_CODES = { PRESENT: 'P', ABSENT: 'A', HALF_DAY: 'H', ON_LEAVE: 'L', HOLIDAY: 'HD', WEEKLY_OFF: 'WO', ON_DUTY: 'OD', COMP_OFF: 'CO', MISSING_PUNCH: 'M', HOLIDAY_WORKED: 'HW', WEEKLY_OFF_WORKED: 'WW' };
export const FLAG_LABELS = {
  LATE: 'Late', EARLY: 'Early going', REGULARISED: 'Corrected by an approved regularisation', MANUAL: 'Entered by hand and approved', NO_SHIFT: 'No shift resolves: a standard day is assumed', NO_POLICY: 'No policy resolves: the default rules apply',
  OT_UNAPPROVED: 'Overtime worked is not approved, so it is not paid', OT_CAPPED: 'Overtime paid is capped by the approved hours', LATE_DEDUCTION: 'Half a day is deducted for late marks', EARLY_DEDUCTION: 'Half a day is deducted for early going', INVALID_PUNCHES: 'The out punch is not after the in punch',
  VISIT: 'Worked at a site visited with approval', LEAVE_PART: 'Part of the day is leave',
};
const nowIso = () => new Date().toISOString();
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const local = (iso) => new Date(Date.parse(iso) + 19_800_000).toISOString().slice(0, 16);
const monday = (date) => addDays(date, -((weekday(date) + 6) % 7));
const r2 = (n) => Math.round(n * 100) / 100;
const SYNTH_SHIFT = Object.freeze({ id: null, code: 'STD', name: 'Standard day', startMinute: 540, endMinute: 1080, breakMinutes: 60, graceMinutes: 15, halfDayMinutes: 240, fullDayMinutes: 480, otAfterMinutes: 480, roundingMinutes: 0, roundingMode: 'NEAREST', nightShift: false });
const PAY = { PRESENT: [1, 0], ABSENT: [0, 1], HALF_DAY: [0.5, 0.5], ON_LEAVE: [1, 0], HOLIDAY: [1, 0], WEEKLY_OFF: [1, 0], ON_DUTY: [1, 0], COMP_OFF: [1, 0], MISSING_PUNCH: [0, 0], HOLIDAY_WORKED: [1, 0], WEEKLY_OFF_WORKED: [1, 0] };
const PRESENCE = { PRESENT: 1, HALF_DAY: 0.5, ON_DUTY: 1, HOLIDAY_WORKED: 1, WEEKLY_OFF_WORKED: 1 };

/** Leave (part 07.07) joins the register here: a source answers `{ fraction (0.5 or 1), paid, code }` for a person and a day, or null. */
const leaveSources = [];
export const registerLeaveSource = (fn) => { leaveSources.push(fn); return () => { const i = leaveSources.indexOf(fn); if (i >= 0) leaveSources.splice(i, 1); }; };

export const dailyList = defineList({
  code: 'att.daily', label: 'Daily attendance', permission: 'att.register.view',
  from: 'att_daily d JOIN hr_employees e ON e.id = d.person_id LEFT JOIN org_sites s ON s.id = d.daily_site_id',
  where: "d.deleted_at IS NULL AND d.person_type = 'EMPLOYEE'", searchable: ['e.full_name', 'e.emp_code', 's.name'], defaultSort: '-workDate',
  columns: {
    workDate: { sql: 'd.work_date', type: 'date', label: 'Date' }, code: { sql: 'e.emp_code', type: 'text', label: 'Code' }, employee: { sql: 'e.full_name', type: 'text', label: 'Employee' }, site: { sql: 's.name', type: 'text', label: 'Site' },
    siteId: { sql: 'd.daily_site_id', type: 'number', label: 'Site id' }, status: { sql: 'd.status', type: 'enum', label: 'Status', options: Object.entries(STATUS_LABELS) },
    inTime: { sql: 'd.in_time', type: 'text', label: 'In' }, outTime: { sql: 'd.out_time', type: 'text', label: 'Out' }, workedMinutes: { sql: 'd.worked_minutes', type: 'number', label: 'Worked (min)' }, otMinutes: { sql: 'd.ot_paid_minutes', type: 'number', label: 'Overtime paid (min)' },
    lateMinutes: { sql: 'd.late_minutes', type: 'number', label: 'Late (min)' }, earlyMinutes: { sql: 'd.early_minutes', type: 'number', label: 'Early (min)' }, paidDay: { sql: 'd.paid_day', type: 'number', label: 'Paid day' }, lopDay: { sql: 'd.lop_day', type: 'number', label: 'LOP day' },
    source: { sql: 'd.source', type: 'enum', label: 'Source', options: [['PUNCH', 'Punches'], ['REGULARISATION', 'Regularisation'], ['MANUAL', 'Manual entry'], ['VISIT', 'Visit'], ['SYSTEM', 'Calendar'], ['LEAVE', 'Leave']] },
    locked: { sql: 'd.locked', type: 'enum', label: 'Locked', options: [['1', 'Locked'], ['0', 'Open']] },
    exception: { sql: "CAST(CASE WHEN d.status IN ('MISSING_PUNCH', 'ABSENT') OR d.late = 1 OR d.early_going = 1 OR (d.ot_minutes > 0 AND d.ot_paid_minutes < d.ot_minutes) THEN 1 ELSE 0 END AS TEXT)", type: 'enum', label: 'Exception', options: [['1', 'Has an exception'], ['0', 'Clean']] },
    periodStart: { sql: 'd.period_start', type: 'date', label: 'Period' },
  },
});
const MAX_RANGE_DAYS = 62;

export function createRegisterService({ db, dep }) {
  const authz = authzOf(db);
  const { may, need, event, usernameOf, myEmployee } = dep;
  const att = () => attendanceOf(db);
  const today = () => todayIST();
  const siteRow = (id) => (id ? db.prepare('SELECT id, name, code, org_project_id AS project_id FROM org_sites WHERE id = ?').get(id) : null);
  const scopeOf = (siteId) => { const s = siteRow(siteId); return s ? { projectId: s.project_id, siteId: s.id } : undefined; };
  const systemActor = (companyId) => ({ user: 'system', userId: null, companyId, roles: ['SYSADM'] });

  // ------------------------------------------------------------------ the locks that cover a day
  const lockCovering = (companyId, periodStart, siteId) => db.prepare("SELECT * FROM att_period_locks WHERE company_id = ? AND period_start = ? AND status IN ('LOCKED', 'REOPEN_PENDING') AND deleted_at IS NULL AND (lock_site_id IS NULL OR lock_site_id = ?) ORDER BY id LIMIT 1").get(companyId, periodStart, siteId ?? 0);
  const periodOf = (companyId, date) => att().periods.of(companyId, date);
  /** Is a day inside a locked period (for a site)? Requests for such a day are raised as arrears. */
  const lockedDay = (companyId, date, siteId) => { const p = periodOf(companyId, date); return lockCovering(companyId, p.start, siteId) ?? null; };

  // ------------------------------------------------------------------ the status engine
  function inputsOf(c, emp, date) {
    const punches = db.prepare("SELECT * FROM att_punches WHERE company_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND work_date = ? AND result IN ('ACCEPTED', 'FLAGGED') AND deleted_at IS NULL ORDER BY effective_time, id").all(c, emp.id, date);
    const approved = (table) => db.prepare(`SELECT * FROM ${table} WHERE company_id = ? AND employee_id = ? AND work_date = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`).get(c, emp.id, date);
    const ot = db.prepare("SELECT COALESCE(SUM(COALESCE(minutes_approved, minutes_requested)), 0) AS m FROM att_overtime_requests WHERE company_id = ? AND employee_id = ? AND work_date = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(c, emp.id, date).m;
    return { punches, reg: approved('att_regularisations'), manual: approved('att_manual_entries'), otApproved: ot };
  }
  const engaged = (c, emp, date, inp) => inp.punches.length > 0 || inp.reg || inp.manual
    || db.prepare("SELECT 1 FROM hr_deployments WHERE company_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND from_date <= ? AND (to_date IS NULL OR to_date >= ?)").get(c, emp.id, date, date)
    || db.prepare("SELECT 1 FROM att_daily WHERE company_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND work_date = ? AND deleted_at IS NULL").get(c, emp.id, date);

  /** The row a person's day makes, from the inputs only (nothing is written). */
  function computeDay(c, emp, date, f, inp) {
    const r = att().resolveFor(c, emp.id, date, f);
    const flags = []; const sources = {};
    const shift = r.shiftFull ?? SYNTH_SHIFT;
    if (!r.shiftFull && r.dayType === 'WORKING') flags.push('NO_SHIFT');
    const rules = r.policy ? r.policy.rules : withDefaults({});
    if (!r.policy) flags.push('NO_POLICY');
    const dayKind = r.dayType === 'WORKING' ? 'WORKING' : r.dayType === 'HOLIDAY' ? 'HOLIDAY' : 'WEEKLY_OFF';
    const period = periodOf(c, date);
    const before = db.prepare("SELECT COALESCE(SUM(late), 0) AS l, COALESCE(SUM(early_going), 0) AS e FROM att_daily WHERE company_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND period_start = ? AND work_date < ? AND deleted_at IS NULL").get(c, emp.id, period.start, date);
    const weekOt = db.prepare("SELECT COALESCE(SUM(ot_paid_minutes), 0) AS m FROM att_daily WHERE company_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND work_date >= ? AND work_date < ? AND deleted_at IS NULL").get(c, emp.id, monday(date), date).m;
    const siteId = inp.punches[0]?.punch_site_id ?? r.siteId ?? null;
    const base = { siteId, source: 'SYSTEM', status: 'ABSENT', late: 0, early: 0, lateMinutes: 0, earlyMinutes: 0, inTime: null, outTime: null, worked: 0, ot: 0, otApproved: inp.otApproved, otPaid: 0, mult: null, paid: 0, lop: 0, compOff: 0, flags, sources, notes: [] };
    const person = { grade: r.grade, category: r.category };

    // a manual entry that was approved decides the day (maker and checker)
    if (inp.manual) {
      const m = inp.manual; sources.manual = m.id; flags.push('MANUAL');
      if (m.entry_status === 'PRESENT' && m.in_time && m.out_time) {
        const ev = evaluateDay({ shift, rules, date, day: dayKind, punchIn: m.in_time, punchOut: m.out_time, person, lateMarksBefore: before.l, earlyMarksBefore: before.e, weekOtMinutes: weekOt });
        return finish(base, ev, { source: 'MANUAL', inTime: m.in_time, outTime: m.out_time, inp, flags, r });
      }
      const status = m.entry_status === 'PRESENT' ? (dayKind === 'WORKING' ? 'PRESENT' : dayKind === 'HOLIDAY' ? 'HOLIDAY_WORKED' : 'WEEKLY_OFF_WORKED') : m.entry_status;
      const [paid, lop] = PAY[status];
      return { ...base, source: 'MANUAL', status, inTime: m.in_time ?? null, outTime: m.out_time ?? null, worked: status === 'PRESENT' ? Math.max(0, shift.fullDayMinutes) : 0, paid, lop };
    }
    let inL = inp.punches.find((p) => p.punch_type === 'IN') ? local(inp.punches.find((p) => p.punch_type === 'IN').effective_time) : null;
    const outs = inp.punches.filter((p) => p.punch_type === 'OUT'); let outL = outs.length ? local(outs[outs.length - 1].effective_time) : null;
    let source = inp.punches.length ? 'PUNCH' : 'SYSTEM';
    if (inp.reg) { sources.regularisation = inp.reg.id; flags.push('REGULARISED'); source = 'REGULARISATION'; if (inp.reg.requested_in) inL = inp.reg.requested_in; if (inp.reg.requested_out) outL = inp.reg.requested_out; }
    const ev = evaluateDay({ shift, rules, date, day: dayKind, punchIn: inL, punchOut: outL, person, lateMarksBefore: before.l, earlyMarksBefore: before.e, weekOtMinutes: weekOt });
    const out = finish(base, ev, { source, inTime: inL, outTime: outL, inp, flags, r });
    // leave fills a day nobody worked (part 07.07)
    if (!inL && !outL && dayKind === 'WORKING') {
      for (const src of leaveSources) {
        const lv = src(db, c, emp.id, date);
        if (lv) { sources.leave = lv.code ?? true; if (lv.fraction >= 1) return { ...out, status: 'ON_LEAVE', source: 'LEAVE', paid: lv.paid ? 1 : 0, lop: lv.paid ? 0 : 1 }; flags.push('LEAVE_PART'); return { ...out, source: 'LEAVE', paid: r2(Math.min(1, out.paid + (lv.paid ? lv.fraction : 0))), lop: r2(Math.max(0, out.lop - (lv.paid ? lv.fraction : 0))) }; }
      }
    }
    return out;
  }
  function finish(base, ev, { source, inTime, outTime, inp, flags, r }) {
    let status = ev.status;
    if (status === 'INVALID') { status = 'MISSING_PUNCH'; flags.push('INVALID_PUNCHES'); }
    if (status === 'PRESENT' && inp.punches.some((p) => p.visit_id)) { status = 'ON_DUTY'; flags.push('VISIT'); }
    if (ev.lateMark) flags.push('LATE'); if (ev.earlyMark) flags.push('EARLY');
    let [paid, lop] = PAY[status] ?? [0, 0];
    for (const [flag, key] of [['LATE_DEDUCTION', 'lateDeduction'], ['EARLY_DEDUCTION', 'earlyDeduction']]) if (ev[key]) { flags.push(flag); const cut = Math.min(0.5, paid); paid = r2(paid - cut); lop = r2(lop + cut); }
    const otPolicy = ev.otPaidMinutes; const approved = base.otApproved;
    let otPaid = Math.min(otPolicy, approved);
    if (otPolicy > 0 && approved === 0) flags.push('OT_UNAPPROVED'); else if (otPolicy > approved) flags.push('OT_CAPPED');
    if (!['PRESENT', 'ON_DUTY', 'HOLIDAY_WORKED', 'WEEKLY_OFF_WORKED', 'HALF_DAY'].includes(status)) otPaid = 0;
    return { ...base, source, status, inTime, outTime, late: ev.lateMark ? 1 : 0, early: ev.earlyMark ? 1 : 0, lateMinutes: ev.lateMinutes, earlyMinutes: ev.earlyMinutes, worked: ev.workedMinutes, ot: ev.otMinutes, otPaid, mult: otPaid > 0 ? ev.otMultiplier : null, paid, lop, compOff: ev.compOff, notes: ev.notes, r };
  }
  const sigOf = (x) => JSON.stringify([x.status, r2(x.paid_day ?? x.paid), r2(x.lop_day ?? x.lop), x.ot_paid_minutes ?? x.otPaid]);
  const snapshot = (row) => row ? { status: row.status, paidDay: row.paid_day, lopDay: row.lop_day, otPaidMinutes: row.ot_paid_minutes, workedMinutes: row.worked_minutes } : {};

  /** Writes the computed row, or (when the period is locked) keeps the difference as arrears. Returns what happened. */
  function store(c, emp, date, rec, actorName) {
    const period = periodOf(c, date);
    const ex = db.prepare("SELECT * FROM att_daily WHERE company_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND work_date = ? AND deleted_at IS NULL").get(c, emp.id, date);
    const project = siteRow(rec.siteId)?.project_id ?? null;
    if (ex?.locked === 1 || (!ex && lockCovering(c, period.start, rec.siteId))) {
      const was = snapshot(ex); const now = { status: rec.status, paidDay: rec.paid, lopDay: rec.lop, otPaidMinutes: rec.otPaid, workedMinutes: rec.worked };
      return arrears(c, emp, date, period, ex?.daily_site_id ?? rec.siteId, ex ? was : null, now, actorName);
    }
    if (ex && sigOf(ex) === sigOf(rec) && ex.in_time === rec.inTime && ex.out_time === rec.outTime && ex.worked_minutes === rec.worked && ex.daily_site_id === (rec.siteId ?? null) && ex.ot_minutes === rec.ot && ex.late === rec.late && ex.early_going === rec.early && ex.ot_approved_minutes === rec.otApproved
      && ex.source === rec.source && ex.flags_json === JSON.stringify(rec.flags)) return { kind: 'same' };
    const vals = [rec.siteId ?? null, rec.status, rec.late, rec.early, rec.lateMinutes, rec.earlyMinutes, rec.inTime, rec.outTime, rec.worked, rec.ot, rec.otApproved, rec.otPaid, rec.mult, rec.paid, rec.lop, rec.compOff, rec.source, JSON.stringify(rec.sources), JSON.stringify(rec.flags), period.start, nowIso()];
    if (ex) {
      db.prepare('UPDATE att_daily SET daily_site_id = ?, status = ?, late = ?, early_going = ?, late_minutes = ?, early_minutes = ?, in_time = ?, out_time = ?, worked_minutes = ?, ot_minutes = ?, ot_approved_minutes = ?, ot_paid_minutes = ?, ot_multiplier = ?, paid_day = ?, lop_day = ?, comp_off = ?, source = ?, source_ids_json = ?, flags_json = ?, period_start = ?, computed_at = ?, project_id = ?, site_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(...vals, project, rec.siteId ?? null, actorName, nowIso(), ex.id);
      return { kind: 'updated' };
    }
    db.prepare("INSERT INTO att_daily (company_id, person_type, person_id, work_date, daily_site_id, status, late, early_going, late_minutes, early_minutes, in_time, out_time, worked_minutes, ot_minutes, ot_approved_minutes, ot_paid_minutes, ot_multiplier, paid_day, lop_day, comp_off, source, source_ids_json, flags_json, period_start, computed_at, project_id, site_id, created_by, source_type) VALUES (?, 'EMPLOYEE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'att_daily')")
      .run(c, emp.id, date, ...vals, project, rec.siteId ?? null, actorName);
    return { kind: 'created' };
  }
  /** After the lock: the row stays as it was and the difference waits for payroll. A change that is undone before payroll takes it removes the entry. */
  function arrears(c, emp, date, period, siteId, was, now, actorName) {
    const open = db.prepare("SELECT * FROM att_arrears WHERE company_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND work_date = ? AND status = 'OPEN' AND deleted_at IS NULL").get(c, emp.id, date);
    const first = open ? json(open.before_json, {}) : (was ?? {});
    const same = (first.status ?? null) === now.status && r2(first.paidDay ?? 0) === r2(now.paidDay) && r2(first.lopDay ?? 0) === r2(now.lopDay) && (first.otPaidMinutes ?? 0) === now.otPaidMinutes;
    if (same) {
      if (open) db.prepare("UPDATE att_arrears SET status = 'FOLDED', deleted_at = ?, deleted_by = ?, is_active = 0, cause = 'The change was undone', version = version + 1 WHERE id = ?").run(nowIso(), actorName, open.id);
      return { kind: 'locked' };
    }
    const deltas = [r2(now.paidDay - (first.paidDay ?? 0)), r2(now.lopDay - (first.lopDay ?? 0)), now.otPaidMinutes - (first.otPaidMinutes ?? 0)];
    const lock = lockCovering(c, period.start, siteId);
    if (open) db.prepare('UPDATE att_arrears SET after_json = ?, delta_paid = ?, delta_lop = ?, delta_ot_minutes = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(now), ...deltas, actorName, nowIso(), open.id);
    else db.prepare("INSERT INTO att_arrears (company_id, person_type, person_id, work_date, arrears_site_id, period_start, lock_id, before_json, after_json, delta_paid, delta_lop, delta_ot_minutes, cause, status, project_id, site_id, created_by, source_type) VALUES (?, 'EMPLOYEE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'An approved change after the period was locked', 'OPEN', ?, ?, ?, 'att_arrears')")
      .run(c, emp.id, date, siteId ?? null, period.start, lock?.id ?? null, JSON.stringify(first), JSON.stringify(now), ...deltas, siteRow(siteId)?.project_id ?? null, siteId ?? null, actorName);
    event('att.arrears.raised', { user: actorName }, 'att_arrears', 0, c, { personId: emp.id, workDate: date, periodStart: period.start, siteId: siteId ?? null, deltaPaidDays: deltas[0], deltaLopDays: deltas[1], deltaOtMinutes: deltas[2] }, siteRow(siteId)?.project_id ?? null, siteId ?? null);
    return { kind: 'arrears' };
  }

  const employeesIn = (c, from, to, siteId, employeeId) => {
    if (employeeId) return db.prepare("SELECT id, emp_code, full_name, doj, last_working_date, grade, employment_type FROM hr_employees WHERE id = ? AND company_id = ? AND deleted_at IS NULL AND record_status = 'APPROVED'").all(employeeId, c);
    const dep = siteId ? ' AND dep_site_id = :s' : ''; const pun = siteId ? ' AND punch_site_id = :s' : ''; const day = siteId ? ' AND daily_site_id = :s' : '';
    return db.prepare(`SELECT e.id, e.emp_code, e.full_name, e.doj, e.last_working_date, e.grade, e.employment_type FROM hr_employees e WHERE e.company_id = :c AND e.deleted_at IS NULL AND e.record_status = 'APPROVED' AND e.doj <= :to AND (e.last_working_date IS NULL OR e.last_working_date >= :from) AND (
      EXISTS (SELECT 1 FROM hr_deployments d WHERE d.company_id = :c AND d.person_type = 'EMPLOYEE' AND d.person_id = e.id AND d.status = 'APPROVED' AND d.deleted_at IS NULL AND d.from_date <= :to AND (d.to_date IS NULL OR d.to_date >= :from)${dep})
      OR EXISTS (SELECT 1 FROM att_punches p WHERE p.company_id = :c AND p.person_type = 'EMPLOYEE' AND p.person_id = e.id AND p.work_date BETWEEN :from AND :to${pun})
      OR EXISTS (SELECT 1 FROM att_daily x WHERE x.company_id = :c AND x.person_type = 'EMPLOYEE' AND x.person_id = e.id AND x.work_date BETWEEN :from AND :to AND x.deleted_at IS NULL${day})) ORDER BY e.emp_code`)
      .all(siteId ? { c, from, to, s: siteId } : { c, from, to });
  };

  /**
   * Recomputes the register for a range (FR-01, BR-01). Late marks and weekly overtime depend on the days before, so each person is taken day by day to the end of the attendance period (never beyond today).
   * A day in a locked period is not rewritten: the difference goes to arrears (BR-03).
   */
  function recompute(actor, /** @type {{ employeeId?: number, siteId?: number, from: string, to: string, cascade?: boolean, facts?: any }} */ { employeeId, siteId, from, to, cascade = true, facts }) {
    const c = actor.companyId;
    if (to < from) throw badRequest('Some fields are not valid.', [{ field: 'to', message: 'The end is not before the start' }]);
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_RANGE_DAYS) throw badRequest('Some fields are not valid.', [{ field: 'to', message: `Recompute at most ${MAX_RANGE_DAYS} days at a time` }]);
    const f = facts ?? att().facts(c);
    const out = { employees: 0, days: 0, created: 0, updated: 0, unchanged: 0, locked: 0, arrears: 0 };
    const end = Math.min(Date.parse(cascade ? periodOf(c, to).end : to), Date.parse(today()));
    const stop = new Date(end).toISOString().slice(0, 10);
    for (const emp of employeesIn(c, from, to, siteId, employeeId)) {
      out.employees += 1;
      for (let date = from; date <= stop; date = addDays(date, 1)) {
        if (date < emp.doj || (emp.last_working_date && date > emp.last_working_date)) continue;
        const inp = inputsOf(c, emp, date);
        if (!engaged(c, emp, date, inp)) continue;
        const rec = computeDay(c, emp, date, f, inp);
        if (siteId && rec.siteId !== siteId && !employeeId) continue;
        const res = store(c, emp, date, rec, actor.user);
        out.days += 1;
        if (res.kind === 'created') out.created += 1; else if (res.kind === 'updated') out.updated += 1; else if (res.kind === 'same') out.unchanged += 1; else { out.locked += 1; if (res.kind === 'arrears') out.arrears += 1; }
      }
    }
    return out;
  }
  const recomputeApi = (actor, b) => {
    const sc = b.siteId ? scopeOf(b.siteId) : undefined;
    need(actor, 'att.daily.recompute', 'recompute attendance', sc);
    return transaction(db, () => {
      const r = recompute(actor, b);
      writeAudit(db, { entity: 'att_daily', entityId: 0, action: 'recompute', newValues: { from: b.from, to: b.to, siteId: b.siteId ?? null, employeeId: b.employeeId ?? null, ...r }, actor: actor.user, companyId: actor.companyId });
      return r;
    });
  };
  /** What happens when an input changes (a punch, an approval): the person's days from that day to the end of the period. */
  function onChange(companyId, employeeId, date, facts) {
    if (!employeeId || !date || date > today()) return null;
    try { return recompute(systemActor(companyId), { employeeId, from: date, to: date, cascade: true, facts }); } catch (e) { if (e instanceof HttpError) return null; throw e; }
  }
  // A burst of punches (the morning rush, a device file) asks for the same person and day many times: the asks are gathered and worked off together a moment later, one set of facts for all.
  const pending = new Map(); let timer = null;
  function flushChanges() {
    timer = null;
    const batch = [...pending.values()]; pending.clear();
    const factsOf = new Map();
    for (const b of batch) {
      try { if (!factsOf.has(b.companyId)) factsOf.set(b.companyId, att().facts(b.companyId)); onChange(b.companyId, b.employeeId, b.date, factsOf.get(b.companyId)); } catch { /* the nightly run picks the day up */ }
    }
    return batch.length;
  }
  function queueChange(companyId, employeeId, date) {
    if (!employeeId || !date || date > today()) return;
    const k = `${companyId}|${employeeId}`; const was = pending.get(k);
    pending.set(k, { companyId, employeeId, date: was && was.date < date ? was.date : date });
    if (!timer) { timer = setTimeout(flushChanges, 1500); timer.unref?.(); }
  }

  // ------------------------------------------------------------------ the register, the daily list, the muster roll
  const periodById = (actor, id) => {
    const r = db.prepare('SELECT * FROM att_periods WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    if (!r) throw notFound('That attendance period does not exist.');
    return { start: r.period_start, end: r.period_end, label: r.label, status: r.status };
  };
  const periodArg = (actor, p) => { const d = p || today(); const per = periodOf(actor.companyId, d); return per; };
  const dayList = (a, b) => { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; };
  function rowsScope(actor, alias = 'd') { return authz.scopeFilter(actor, 'att.register.view', { project: `${alias}.project_id`, site: `${alias}.daily_site_id` }).sql; }
  function registerOf(actor, q, { muster = false } = {}) {
    need(actor, 'att.register.view', 'see the attendance register');
    const per = periodArg(actor, q.period);
    const c = actor.companyId;
    const where = ["d.company_id = :c", "d.person_type = 'EMPLOYEE'", 'd.deleted_at IS NULL', 'd.work_date BETWEEN :from AND :to', rowsScope(actor)];
    const params = { c, from: per.start, to: per.end };
    if (q.siteId) { where.push('d.daily_site_id = :site'); params.site = q.siteId; }
    if (q.departmentId) { where.push('e.department_id = :dep'); params.dep = q.departmentId; }
    if (q.crewId) { where.push("EXISTS (SELECT 1 FROM hr_crew_members m WHERE m.crew_id = :crew AND m.person_type = 'EMPLOYEE' AND m.person_id = d.person_id AND m.from_date <= :to AND (m.to_date IS NULL OR m.to_date >= :from) AND m.deleted_at IS NULL)"); params.crew = q.crewId; }
    if (muster || q.contract) where.push("e.employment_type = 'CONTRACT'");
    const rows = db.prepare(`SELECT d.*, e.emp_code, e.full_name, e.grade, e.employment_type, s.name AS site_name FROM att_daily d JOIN hr_employees e ON e.id = d.person_id LEFT JOIN org_sites s ON s.id = d.daily_site_id WHERE ${where.join(' AND ')} ORDER BY e.emp_code, d.work_date`).all(params);
    const days = dayList(per.start, per.end < today() ? per.end : per.end);
    const people = new Map();
    for (const d of rows) {
      let p = people.get(d.person_id);
      if (!p) { p = { employeeId: d.person_id, code: d.emp_code, name: d.full_name, grade: d.grade, employmentType: d.employment_type, site: d.site_name, cells: {}, totals: { presentDays: 0, paidDays: 0, lopDays: 0, absentDays: 0, leaveDays: 0, holidays: 0, weeklyOffs: 0, onDuty: 0, compOff: 0, halfDays: 0, lateMarks: 0, earlyMarks: 0, otMinutes: 0, otHours: 0, missingPunch: 0 } }; people.set(d.person_id, p); }
      const t = p.totals;
      p.cells[d.work_date] = { code: STATUS_CODES[d.status], status: d.status, late: d.late === 1, early: d.early_going === 1, worked: d.worked_minutes, ot: d.ot_paid_minutes, in: d.in_time, out: d.out_time, locked: d.locked === 1, flags: json(d.flags_json, []), paid: d.paid_day, lop: d.lop_day };
      t.presentDays = r2(t.presentDays + (PRESENCE[d.status] ?? 0)); t.paidDays = r2(t.paidDays + d.paid_day); t.lopDays = r2(t.lopDays + d.lop_day);
      if (d.status === 'ABSENT') t.absentDays += 1; if (d.status === 'ON_LEAVE') t.leaveDays += 1; if (d.status === 'HOLIDAY') t.holidays += 1; if (d.status === 'WEEKLY_OFF') t.weeklyOffs += 1; if (d.status === 'ON_DUTY') t.onDuty += 1; if (d.status === 'COMP_OFF') t.compOff += 1; if (d.status === 'HALF_DAY') t.halfDays += 1; if (d.status === 'MISSING_PUNCH') t.missingPunch += 1;
      t.lateMarks += d.late; t.earlyMarks += d.early_going; t.otMinutes += d.ot_paid_minutes; t.otHours = r2(t.otMinutes / 60);
    }
    const list = [...people.values()];
    const sum = (k) => r2(list.reduce((a, p) => a + p.totals[k], 0));
    const lock = lockCovering(c, per.start, q.siteId ?? null);
    return {
      period: { start: per.start, end: per.end, label: per.label, closed: per.status === 'CLOSED' }, days, weekdays: days.map((d) => weekday(d)),
      lock: lock ? { id: lock.id, status: lock.status, lockedAt: lock.locked_at, lockedBy: lock.locked_by, siteId: lock.lock_site_id } : null,
      legend: Object.entries(STATUS_CODES).map(([status, code]) => ({ code, status, label: STATUS_LABELS[status] })), rows: list,
      totals: { employees: list.length, presentDays: sum('presentDays'), paidDays: sum('paidDays'), lopDays: sum('lopDays'), otHours: r2(list.reduce((a, p) => a + p.totals.otMinutes, 0) / 60), missingPunch: sum('missingPunch') },
      can: { lock: may(actor, 'att.period.lock', q.siteId ? scopeOf(q.siteId) : undefined), recompute: may(actor, 'att.daily.recompute', q.siteId ? scopeOf(q.siteId) : undefined), export: may(actor, 'att.register.export') },
    };
  }
  const daily = {
    list(actor, query) {
      need(actor, 'att.register.view', 'see daily attendance');
      return runList(db, dailyList, parseListRequest(dailyList, query), { select: DAILY_SELECT, scopeSql: `d.company_id = :c AND ${rowsScope(actor)}`, params: { c: actor.companyId }, tieBreaker: 'd.id', map: dailyPresent });
    },
    exportSource(actor, req) {
      need(actor, 'att.register.export', 'export daily attendance');
      const opts = { select: DAILY_SELECT, scopeSql: `d.company_id = :c AND ${rowsScope(actor)}`, params: { c: actor.companyId }, tieBreaker: 'd.id' };
      return { title: dailyList.label, permission: 'att.register.export', personal: false, columns: Object.entries(dailyList.columns).filter(([k]) => !['siteId', 'exception', 'periodStart'].includes(k)).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, dailyList, req, opts), rows: () => runList(db, dailyList, req, { ...opts, limit: null, map: dailyPresent }).data, describe: describeReq(dailyList) };
    },
  };
  const describeReq = (def) => (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${def.columns[f.key]?.label ?? f.key} ${f.op} ${f.raw}`)].filter(Boolean);
  const DAILY_SELECT = "d.*, e.emp_code AS emp_code, e.full_name AS employee_name, s.name AS site_name, CASE WHEN d.status IN ('MISSING_PUNCH', 'ABSENT') OR d.late = 1 OR d.early_going = 1 OR (d.ot_minutes > 0 AND d.ot_paid_minutes < d.ot_minutes) THEN 1 ELSE 0 END AS is_exception";
  function dailyPresent(d) {
    return { id: d.id, workDate: d.work_date, code: d.emp_code, employee: d.employee_name, employeeId: d.person_id, site: d.site_name, status: d.status, statusLabel: STATUS_LABELS[d.status] ?? d.status, inTime: d.in_time, outTime: d.out_time, workedMinutes: d.worked_minutes, otMinutes: d.ot_paid_minutes, lateMinutes: d.late_minutes, earlyMinutes: d.early_minutes, paidDay: d.paid_day, lopDay: d.lop_day, source: d.source, locked: d.locked === 1, exception: d.is_exception === 1, flags: json(d.flags_json, []) };
  }
  /** The day of one person with everything that made it (the explanation behind a cell). */
  function dayDetail(actor, employeeId, date) {
    need(actor, 'att.register.view', 'see attendance');
    const row = db.prepare("SELECT * FROM att_daily WHERE company_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND work_date = ? AND deleted_at IS NULL").get(actor.companyId, employeeId, date);
    if (!row || !may(actor, 'att.register.view', scopeOf(row.daily_site_id))) throw notFound('There is no attendance for that person on that day.');
    const c = actor.companyId;
    const punches = db.prepare("SELECT punch_type AS type, effective_time AS at, result, punch_site_id AS siteId, method FROM att_punches WHERE company_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND work_date = ? AND deleted_at IS NULL ORDER BY effective_time").all(c, employeeId, date);
    const docs = (t, kind) => db.prepare(`SELECT id, doc_no AS docNo, status FROM ${t} WHERE company_id = ? AND employee_id = ? AND work_date = ? AND deleted_at IS NULL AND status != 'SUPERSEDED' ORDER BY id`).all(c, employeeId, date).map((x) => ({ ...x, kind }));
    const e = db.prepare('SELECT emp_code, full_name FROM hr_employees WHERE id = ?').get(employeeId);
    return { employeeId, code: e?.emp_code, employee: e?.full_name, date, status: row.status, statusLabel: STATUS_LABELS[row.status], paidDay: row.paid_day, lopDay: row.lop_day, workedMinutes: row.worked_minutes, otMinutes: row.ot_minutes, otApprovedMinutes: row.ot_approved_minutes, otPaidMinutes: row.ot_paid_minutes, inTime: row.in_time, outTime: row.out_time, locked: row.locked === 1, source: row.source, flags: json(row.flags_json, []).map((f) => ({ code: f, label: FLAG_LABELS[f] ?? f })), punches, requests: [...docs('att_regularisations', 'REGULARISATION'), ...docs('att_overtime_requests', 'OVERTIME'), ...docs('att_manual_entries', 'MANUAL')] };
  }
  /** The register as a file: one row per person, a column per day, then the totals. */
  function registerExport(actor, req, { muster = false } = {}) {
    need(actor, muster ? 'att.register.export' : 'att.register.export', 'export the attendance register');
    const f = Object.fromEntries(req.filters.map((x) => [x.key, x.raw]));
    const q = { period: f.periodStart || undefined, siteId: f.siteId ? Number(f.siteId) : undefined, departmentId: f.departmentId ? Number(f.departmentId) : undefined, crewId: f.crewId ? Number(f.crewId) : undefined };
    const reg = registerOf(actor, q, { muster });
    const columns = [{ key: 'code', label: 'Code', type: 'text' }, { key: 'name', label: 'Name', type: 'text' }, { key: 'site', label: 'Site', type: 'text' }, ...reg.days.map((d) => ({ key: `d${d}`, label: d.slice(8), type: 'text' })),
      ...[['presentDays', 'Present'], ['paidDays', 'Paid days'], ['lopDays', 'LOP days'], ['otHours', 'OT hours'], ['lateMarks', 'Late'], ['absentDays', 'Absent']].map(([key, label]) => ({ key, label, type: 'number' }))];
    const rows = reg.rows.map((p) => ({ code: p.code, name: p.name, site: p.site, ...Object.fromEntries(reg.days.map((d) => [`d${d}`, p.cells[d]?.code ?? ''])), ...p.totals }));
    return { title: muster ? 'Muster roll of contract labour' : 'Monthly attendance register', permission: 'att.register.export', personal: false, columns, count: () => rows.length, rows: () => rows, describe: () => [`period ${reg.period.start} to ${reg.period.end}`, ...(q.siteId ? [`site ${siteRow(q.siteId)?.name}`] : [])] };
  }
  const registerList = defineList({
    code: 'att.register', label: 'Monthly attendance register', permission: 'att.register.view', from: 'att_daily d', where: "d.deleted_at IS NULL AND d.person_type = 'EMPLOYEE'", searchable: [], defaultSort: 'periodStart',
    columns: { periodStart: { sql: 'd.period_start', type: 'date', label: 'Period' }, siteId: { sql: 'd.daily_site_id', type: 'number', label: 'Site' }, departmentId: { sql: 'd.id', type: 'number', label: 'Department' }, crewId: { sql: 'd.id', type: 'number', label: 'Crew' } },
  });
  const musterList = defineList({
    code: 'att.muster', label: 'Muster roll of contract labour', permission: 'att.register.view', from: 'att_daily d', where: "d.deleted_at IS NULL AND d.person_type = 'EMPLOYEE'", searchable: [], defaultSort: 'periodStart',
    columns: { periodStart: { sql: 'd.period_start', type: 'date', label: 'Period' }, siteId: { sql: 'd.daily_site_id', type: 'number', label: 'Site' }, crewId: { sql: 'd.id', type: 'number', label: 'Crew' } },
  });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  /** The printable register or muster roll (FR-08, FR-09). */
  function printRegister(actor, q, muster) {
    const reg = registerOf(actor, q, { muster });
    writeAudit(db, { entity: 'att_daily', entityId: 0, action: muster ? 'print_muster' : 'print_register', newValues: { period: reg.period.start, siteId: q.siteId ?? null }, actor: actor.user, companyId: actor.companyId });
    const head = `<tr><th>Code</th><th>Name</th>${reg.days.map((d) => `<th>${esc(d.slice(8))}</th>`).join('')}<th>Present</th><th>Paid</th><th>LOP</th><th>OT h</th></tr>`;
    const body = reg.rows.map((p) => `<tr><td>${esc(p.code)}</td><td>${esc(p.name)}</td>${reg.days.map((d) => `<td>${esc(p.cells[d]?.code ?? '')}</td>`).join('')}<td>${p.totals.presentDays}</td><td>${p.totals.paidDays}</td><td>${p.totals.lopDays}</td><td>${p.totals.otHours}</td></tr>`).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${muster ? 'Muster roll' : 'Attendance register'} ${esc(reg.period.label)}</title><style>body{font:10px system-ui,sans-serif;margin:16px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:2px 3px;text-align:center}td:nth-child(2){text-align:left;white-space:nowrap}</style></head><body><h2>${muster ? 'Muster roll of contract labour' : 'Monthly attendance register'}: ${esc(reg.period.label)} (${esc(reg.period.start)} to ${esc(reg.period.end)})</h2><table>${head}${body}</table><p>${reg.legend.map((l) => `${l.code} = ${esc(l.label)}`).join('; ')}</p><p>Printed by ${esc(actor.user)} on ${esc(nowIso())}${reg.lock ? `; locked by ${esc(reg.lock.lockedBy)}` : '; not locked'}</p></body></html>`;
  }

  // ------------------------------------------------------------------ the lock (FR-07)
  const lockView = (l) => ({ id: l.id, periodStart: l.period_start, periodEnd: l.period_end, siteId: l.lock_site_id, site: siteRow(l.lock_site_id)?.name ?? 'All sites', status: l.status, lockedAt: l.locked_at, lockedBy: l.locked_by, summary: json(l.summary_json, {}), reopenReason: l.reopen_reason, reopenRequestedBy: l.reopen_requested_by, reopenedAt: l.reopened_at, reopenedBy: l.reopened_by, workflowInstanceId: l.workflow_instance_id, version: l.version });
  const lockRow = (actor, id) => { const l = db.prepare('SELECT * FROM att_period_locks WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId); if (!l) throw notFound('That period lock does not exist.'); return l; };
  /** What stops a period from being locked: requests still open and days that are not settled. */
  function readiness(c, period, siteId) {
    const sitePart = siteId ? ' AND doc_site_id = ?' : '';
    const open = (t) => db.prepare(`SELECT id, doc_no AS docNo, employee_id AS employeeId, work_date AS workDate, status FROM ${t} WHERE company_id = ? AND deleted_at IS NULL AND status IN ('SUBMITTED', 'RETURNED') AND work_date BETWEEN ? AND ?${sitePart} ORDER BY work_date`).all(...[c, period.start, period.end, ...(siteId ? [siteId] : [])]);
    const missing = db.prepare(`SELECT person_id AS employeeId, work_date AS workDate FROM att_daily WHERE company_id = ? AND period_start = ? AND status = 'MISSING_PUNCH' AND deleted_at IS NULL${siteId ? ' AND daily_site_id = ?' : ''} ORDER BY work_date`).all(...[c, period.start, ...(siteId ? [siteId] : [])]);
    return { regularisations: open('att_regularisations'), overtime: open('att_overtime_requests'), manual: open('att_manual_entries'), missingPunch: missing, ready: false };
  }
  const readyOf = (r) => ({ ...r, ready: !r.regularisations.length && !r.overtime.length && !r.manual.length && !r.missingPunch.length });
  const locks = {
    list(actor, q = /** @type {any} */ ({})) {
      need(actor, 'att.register.view', 'see period locks');
      const rows = db.prepare('SELECT * FROM att_period_locks WHERE company_id = ? AND deleted_at IS NULL ORDER BY period_start DESC, id DESC LIMIT 100').all(actor.companyId);
      return rows.filter((l) => may(actor, 'att.register.view', l.lock_site_id ? scopeOf(l.lock_site_id) : undefined)).map(lockView).filter((l) => !q.siteId || l.siteId === q.siteId || l.siteId == null);
    },
    /** The state of a period for the lock page: the dates, the lock covering it, what is still open. */
    status(actor, q) {
      need(actor, 'att.register.view', 'see period locks');
      const per = periodArg(actor, q.period);
      const lock = lockCovering(actor.companyId, per.start, q.siteId ?? null);
      return { period: { start: per.start, end: per.end, label: per.label, ended: per.end < today() }, lock: lock ? lockView(lock) : null, readiness: readyOf(readiness(actor.companyId, per, q.siteId ?? null)), can: { lock: may(actor, 'att.period.lock', q.siteId ? scopeOf(q.siteId) : undefined) }, arrears: db.prepare("SELECT COUNT(*) AS n FROM att_arrears WHERE company_id = ? AND period_start = ? AND status = 'OPEN' AND deleted_at IS NULL").get(actor.companyId, per.start).n };
    },
    lock(actor, { period: p, periodId, siteId }) {
      const sc = siteId ? scopeOf(siteId) : undefined;
      if (siteId && !sc) throw badRequest('Some fields are not valid.', [{ field: 'siteId', message: 'That site does not exist' }]);
      need(actor, 'att.period.lock', 'lock attendance', sc);
      const c = actor.companyId; const per = periodId ? periodById(actor, periodId) : periodArg(actor, p);
      if (per.end >= today()) throw unprocessable(`A period is locked after its last day (${per.end}).`);
      return transaction(db, () => {
        if (lockCovering(c, per.start, siteId ?? null)) throw conflict('That period is already locked for these sites.');
        if (!siteId && db.prepare("SELECT 1 FROM att_period_locks WHERE company_id = ? AND period_start = ? AND status IN ('LOCKED', 'REOPEN_PENDING') AND deleted_at IS NULL").get(c, per.start)) throw conflict('Some sites of this period are locked already: lock the others by site.');
        recompute(actor, { siteId: siteId ?? undefined, from: per.start, to: per.end, cascade: false });
        const ready = readyOf(readiness(c, per, siteId ?? null));
        if (!ready.ready) throw new HttpError(409, 'PERIOD_NOT_READY', 'The period cannot be locked yet: some requests are still open or some days have a missing punch.', ready);
        const where = `company_id = ? AND period_start = ? AND deleted_at IS NULL${siteId ? ' AND daily_site_id = ?' : ''}`; const args = [c, per.start, ...(siteId ? [siteId] : [])];
        const s = db.prepare(`SELECT COUNT(DISTINCT person_id) AS employees, COUNT(*) AS days, COALESCE(SUM(paid_day), 0) AS paid, COALESCE(SUM(lop_day), 0) AS lop, COALESCE(SUM(ot_paid_minutes), 0) AS ot FROM att_daily WHERE ${where}`).get(...args);
        const summary = { employees: s.employees, days: s.days, paidDays: r2(s.paid), lopDays: r2(s.lop), otMinutes: s.ot };
        const id = Number(db.prepare("INSERT INTO att_period_locks (company_id, period_start, period_end, lock_site_id, status, locked_at, locked_by, summary_json, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, 'LOCKED', ?, ?, ?, ?, ?, ?, 'att_period_lock')")
          .run(c, per.start, per.end, siteId ?? null, nowIso(), actor.user, JSON.stringify(summary), sc?.projectId ?? null, siteId ?? null, actor.user).lastInsertRowid);
        db.prepare(`UPDATE att_daily SET locked = 1, updated_by = ?, updated_at = ?, version = version + 1 WHERE ${where}`).run(actor.user, nowIso(), ...args);
        writeAudit(db, { entity: 'att_period_locks', entityId: id, action: 'lock', newValues: { periodStart: per.start, siteId: siteId ?? null, ...summary }, actor: actor.user, companyId: c });
        event('att.period.locked', actor, 'att_period_lock', id, c, { lockId: id, periodStart: per.start, periodEnd: per.end, siteId: siteId ?? null, ...summary }, sc?.projectId ?? null, siteId ?? null);
        return lockView(db.prepare('SELECT * FROM att_period_locks WHERE id = ?').get(id));
      });
    },
    /** Reopening takes the HR manager's request and the finance head's approval; until then the rows stay locked. */
    reopen(actor, id, { reason, comment }) {
      const l = lockRow(actor, id);
      need(actor, 'att.period.lock', 'ask to reopen attendance', l.lock_site_id ? scopeOf(l.lock_site_id) : undefined);
      if (l.status !== 'LOCKED') throw conflict(l.status === 'REOPEN_PENDING' ? 'A request to reopen this period is already in approval.' : 'This period is not locked.');
      return transaction(db, () => {
        const inst = workflowOf(db).submit(actor, { docType: REOPEN_DOC, docId: id, comment: comment ?? reason, context: { periodStart: l.period_start, siteId: l.lock_site_id, employees: json(l.summary_json, {}).employees ?? 0 } });
        db.prepare("UPDATE att_period_locks SET status = 'REOPEN_PENDING', reopen_reason = ?, reopen_requested_by = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, inst.id, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'att_period_locks', entityId: id, action: 'reopen_request', reason, actor: actor.user, companyId: actor.companyId });
        return lockView(db.prepare('SELECT * FROM att_period_locks WHERE id = ?').get(id));
      });
    },
    /** Reopen by the period (as the API names it) and the site the lock was made for. */
    reopenPeriod(actor, periodId, { siteId, reason, comment }) {
      const per = periodById(actor, periodId);
      const l = db.prepare("SELECT * FROM att_period_locks WHERE company_id = ? AND period_start = ? AND status IN ('LOCKED', 'REOPEN_PENDING') AND deleted_at IS NULL AND COALESCE(lock_site_id, 0) = ?").get(actor.companyId, per.start, siteId ?? 0);
      if (!l) throw notFound('That period is not locked for those sites.');
      return locks.reopen(actor, l.id, { reason, comment });
    },
    get(actor, id) { const l = lockRow(actor, id); need(actor, 'att.register.view', 'see period locks', l.lock_site_id ? scopeOf(l.lock_site_id) : undefined); return lockView(l); },
  };
  const decisions = {
    reopen(instance, actor, outcome, comment) {
      const l = db.prepare('SELECT * FROM att_period_locks WHERE id = ?').get(Number(instance.docId));
      if (!l || l.status !== 'REOPEN_PENDING') return;
      const c = l.company_id; const now = nowIso();
      if (outcome === 'APPROVED') {
        const where = `company_id = ? AND period_start = ?${l.lock_site_id ? ' AND daily_site_id = ?' : ''}`; const args = [c, l.period_start, ...(l.lock_site_id ? [l.lock_site_id] : [])];
        db.prepare("UPDATE att_period_locks SET status = 'REOPENED', reopened_at = ?, reopened_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(now, actor.user, actor.user, now, l.id);
        db.prepare(`UPDATE att_daily SET locked = 0, updated_by = ?, updated_at = ?, version = version + 1 WHERE ${where}`).run(actor.user, now, ...args);
        db.prepare("UPDATE att_arrears SET status = 'FOLDED', cause = 'The period was reopened and recomputed', updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND period_start = ? AND status = 'OPEN' AND deleted_at IS NULL").run(actor.user, now, c, l.period_start);
        recompute(systemActor(c), { siteId: l.lock_site_id ?? undefined, from: l.period_start, to: l.period_end, cascade: false });
        event('att.period.reopened', actor, 'att_period_lock', l.id, c, { lockId: l.id, periodStart: l.period_start, periodEnd: l.period_end, siteId: l.lock_site_id, reason: l.reopen_reason }, null, l.lock_site_id);
      } else {
        db.prepare("UPDATE att_period_locks SET status = 'LOCKED', workflow_instance_id = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, l.id);
      }
      writeAudit(db, { entity: 'att_period_locks', entityId: l.id, action: outcome === 'APPROVED' ? 'reopen' : 'reopen_refused', reason: comment ?? null, actor: actor.user, companyId: c });
    },
  };
  const arrearsApi = {
    list(actor, q = /** @type {any} */ ({})) {
      need(actor, 'att.arrears.view', 'see arrears');
      const where = ['a.company_id = :c', 'a.deleted_at IS NULL', authz.scopeFilter(actor, 'att.arrears.view', { project: 'a.project_id', site: 'a.arrears_site_id' }).sql]; const p = { c: actor.companyId };
      if (q.periodStart) { where.push('a.period_start = :ps'); p.ps = q.periodStart; }
      if (q.status) { where.push('a.status = :st'); p.st = q.status; }
      return db.prepare(`SELECT a.*, e.emp_code, e.full_name FROM att_arrears a JOIN hr_employees e ON e.id = a.person_id WHERE ${where.join(' AND ')} ORDER BY a.period_start DESC, a.work_date, e.emp_code LIMIT 500`).all(p)
        .map((a) => ({ id: a.id, employeeId: a.person_id, code: a.emp_code, employee: a.full_name, workDate: a.work_date, periodStart: a.period_start, lockId: a.lock_id, before: json(a.before_json, {}), after: json(a.after_json, {}), deltaPaidDays: a.delta_paid, deltaLopDays: a.delta_lop, deltaOtMinutes: a.delta_ot_minutes, cause: a.cause, status: a.status }));
    },
  };

  // ------------------------------------------------------------------ the widget
  const widget = (actor) => {
    if (!may(actor, 'att.register.view')) return { value: 0, attention: 0 };
    const n = db.prepare(`SELECT COUNT(*) AS n FROM att_daily d WHERE d.company_id = :c AND d.work_date = :d AND d.deleted_at IS NULL AND d.status = 'MISSING_PUNCH' AND ${rowsScope(actor)}`).get({ c: actor.companyId, d: addDays(today(), -1) }).n;
    return { value: n, attention: n };
  };
  /** The nightly run: yesterday and the day before (late punches and approvals can still change them). */
  function nightly(companyId) {
    const to = addDays(today(), -1); const from = addDays(to, -2);
    return recompute(systemActor(companyId), { from, to, cascade: true });
  }
  return { recompute: recomputeApi, recomputeFor: recompute, onChange, queueChange, flushChanges, computeDay, lockedDay, readiness, locks, decisions, arrears: arrearsApi, daily, dayDetail, register: (actor, q) => registerOf(actor, q), muster: (actor, q) => registerOf(actor, q, { muster: true }), registerExport, registerList, musterList, printRegister, widget, nightly, systemActor, scopeOf, siteRow, myEmployee, usernameOf };
}

export const REOPEN_DOC = 'HR_ATT_REOPEN';
const services = new WeakMap();
export const bindRegister = (db, s) => services.set(db, s);
export const registerOf = (db) => services.get(db) ?? null;

const step = (code, name, roles, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: roles.map((role) => ({ kind: 'role', role })), slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
workflowTypes.register({
  docType: REOPEN_DOC, label: 'Reopen a locked attendance period', processOwner: 'HRMGR', route: () => '/att/lock',
  describe(db, companyId, id) { const l = db.prepare('SELECT period_start, period_end, reopen_requested_by, lock_site_id FROM att_period_locks WHERE id = ? AND company_id = ?').get(Number(id), companyId); const s = l?.lock_site_id ? db.prepare('SELECT org_project_id FROM org_sites WHERE id = ?').get(l.lock_site_id) : null; return l ? { ref: `LOCK-${id}`, title: `Reopen ${l.period_start} to ${l.period_end}`, originator: l.reopen_requested_by, projectId: s?.org_project_id, siteId: l.lock_site_id ?? undefined } : null; },
  summarise(db, _actor, id) { const l = db.prepare('SELECT * FROM att_period_locks WHERE id = ?').get(Number(id)); if (!l) return null; const s = json(l.summary_json, {}); return { fields: [{ label: 'Period', value: `${l.period_start} to ${l.period_end}` }, { label: 'Sites', value: l.lock_site_id ? (db.prepare('SELECT name FROM org_sites WHERE id = ?').get(l.lock_site_id)?.name ?? '—') : 'All sites' }, { label: 'Locked by', value: `${l.locked_by} on ${l.locked_at.slice(0, 10)}` }, { label: 'People and days', value: `${s.employees ?? 0} people, ${s.days ?? 0} days` }, { label: 'Why it is reopened', value: l.reopen_reason ?? '—' }] }; },
  defaultDefinition: { name: 'Reopen attendance: HR manager, finance head', settings: { resubmit: 'first', distinctApprovers: true, matrix: true }, steps: [step('HRMGR', 'HR manager', ['HRMGR']), step('CFO', 'Finance head', ['CFO'])] },
  hooks: {
    onApproved: (db, { instance, actor }) => registerOf(db)?.decisions.reopen(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => registerOf(db)?.decisions.reopen(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => registerOf(db)?.decisions.reopen(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => registerOf(db)?.decisions.reopen(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(REOPEN_DOC, ({ db, instance }) => {
  const l = db.prepare('SELECT * FROM att_period_locks WHERE id = ?').get(Number(instance.docId)); if (!l) return { sections: [] };
  const n = db.prepare("SELECT COUNT(*) AS n FROM att_arrears WHERE company_id = ? AND period_start = ? AND status = 'OPEN' AND deleted_at IS NULL").get(l.company_id, l.period_start).n;
  const s = json(l.summary_json, {});
  return { sections: [{ code: 'att-reopen', title: 'Before approving', kind: 'metrics', items: [{ label: 'Paid days when locked', value: String(s.paidDays ?? 0), format: 'text' }, { label: 'Corrections waiting as arrears', value: String(n), format: 'text', tone: n > 0 ? 'warn' : undefined }, { label: 'Payroll has been told', value: 'Yes: reopening tells payroll to take the period again', format: 'text' }] }] };
});
void forbidden; void workflowResolvers;
