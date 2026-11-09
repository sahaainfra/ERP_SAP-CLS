// The attendance calculations of part 07.04, in one place and with no database: what a shift is, what a day's punches mean under a policy, how a week off pattern falls, and how an attendance period is cut.
// Times are minutes of the day and datetimes are local (IST) strings "YYYY-MM-DDTHH:mm"; the server and the examples on the policy editor use these same functions (FR-01, FR-04, FR-06).
export const DAY = 1440;
const ms = (iso) => Date.parse(`${iso}:00Z`);
const toIso = (t) => new Date(t).toISOString().slice(0, 16);
export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
export const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const parseHhmm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s)); if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null; return Number(m[1]) * 60 + Number(m[2]); };

/** A shift crosses midnight when it ends at or before the minute it starts. Length and paid length in minutes. */
export const shiftSpan = (shift) => {
  const crosses = shift.endMinute <= shift.startMinute;
  const length = shift.endMinute - shift.startMinute + (crosses ? DAY : 0);
  return { crosses, length, paid: Math.max(0, length - (shift.breakMinutes ?? 0)) };
};
/** The shift of the day `date`: its start and end as datetimes (a night shift ends on the next calendar day). */
export const shiftWindow = (shift, date) => {
  const { length } = shiftSpan(shift);
  const start = ms(`${date}T${hhmm(shift.startMinute)}`);
  return { start, end: start + length * 60_000 };
};
const roundTo = (minutes, step, mode) => {
  if (!step) return minutes;
  const r = minutes / step;
  return (mode === 'UP' ? Math.ceil(r) : mode === 'DOWN' ? Math.floor(r) : Math.round(r)) * step;
};

export const DEFAULT_RULES = Object.freeze({
  late: { enabled: true, countPerHalfDay: 3 },
  earlyGoing: { enabled: true, graceMinutes: 0, countPerHalfDay: 3 },
  missingPunch: { mode: 'REGULARISE' },
  compOff: { enabled: false, minMinutes: 240, expiryDays: 60 },
  ot: { enabled: false, multiplier: 2, holidayMultiplier: null, maxPerDayMinutes: 240, maxPerWeekMinutes: 720, eligibleGrades: [], eligibleCategories: [] },
});
/** Rules with every part present (a stored policy may predate a part). */
export const withDefaults = (r = {}) => ({
  late: { ...DEFAULT_RULES.late, ...r.late }, earlyGoing: { ...DEFAULT_RULES.earlyGoing, ...r.earlyGoing }, missingPunch: { ...DEFAULT_RULES.missingPunch, ...r.missingPunch },
  compOff: { ...DEFAULT_RULES.compOff, ...r.compOff }, ot: { ...DEFAULT_RULES.ot, ...r.ot },
});
/** Does the policy touch pay (overtime, or a deduction for lates, early going or a missing punch)? Those changes also go to the director. */
export const payImpacting = (rules) => {
  const r = withDefaults(rules);
  return r.ot.enabled || (r.late.enabled && r.late.countPerHalfDay > 0) || (r.earlyGoing.enabled && r.earlyGoing.countPerHalfDay > 0) || ['HALF_DAY', 'ABSENT'].includes(r.missingPunch.mode) || r.compOff.enabled;
};

/**
 * One day of attendance. `day` says what kind of day it is (WORKING, WEEKLY_OFF, HOLIDAY); `punchIn` and `punchOut` are datetimes or null; `person` has the grade and category for the overtime rule;
 * `lateMarksBefore` and `earlyMarksBefore` count the marks already given in the attendance period, and `weekOtMinutes` the overtime already paid in the week.
 */
export function evaluateDay({ shift, rules: raw, date, day = 'WORKING', punchIn = null, punchOut = null, person = /** @type {any} */ ({}), lateMarksBefore = 0, earlyMarksBefore = 0, weekOtMinutes = 0 }) {
  const rules = withDefaults(raw);
  const w = shiftWindow(shift, date);
  const out = { date, day, status: 'ABSENT', workedMinutes: 0, lateMinutes: 0, lateMark: false, earlyMinutes: 0, earlyMark: false, lateDeduction: false, earlyDeduction: false, otMinutes: 0, otPaidMinutes: 0, otMultiplier: null, otEligible: false, compOff: 0, notes: [] };
  const scheduledPaid = shiftSpan(shift).paid;
  if (day !== 'WORKING' && !punchIn && !punchOut) return { ...out, status: day === 'HOLIDAY' ? 'HOLIDAY' : 'WEEKLY_OFF' };
  if (!punchIn && !punchOut) return { ...out, notes: ['No punch on a working day'] };
  if (!punchIn || !punchOut) {
    const mode = rules.missingPunch.mode;
    out.notes.push('One punch is missing');
    if (mode === 'HALF_DAY') return { ...out, status: 'HALF_DAY' };
    if (mode === 'ABSENT') return { ...out, status: 'ABSENT' };
    if (mode === 'ASSUME_SHIFT') return { ...out, status: 'PRESENT', workedMinutes: scheduledPaid, notes: [...out.notes, 'The whole shift is assumed'] };
    return { ...out, status: 'MISSING_PUNCH', notes: [...out.notes, 'Waiting for the person to regularise it'] };
  }
  const tin = ms(punchIn); const tout = ms(punchOut);
  if (!(tout > tin)) return { ...out, status: 'INVALID', notes: ['The out punch is not after the in punch'] };
  const present = (tout - tin) / 60_000;
  out.workedMinutes = roundTo(Math.max(0, present - (shift.breakMinutes ?? 0)), shift.roundingMinutes, shift.roundingMode);
  if (day === 'WORKING') {
    const late = Math.max(0, (tin - w.start) / 60_000 - (shift.graceMinutes ?? 0));
    if (late > 0 && rules.late.enabled) { out.lateMinutes = Math.round(late); out.lateMark = true; }
    const early = Math.max(0, (w.end - tout) / 60_000 - (rules.earlyGoing.graceMinutes ?? 0));
    if (early > 0 && rules.earlyGoing.enabled) { out.earlyMinutes = Math.round(early); out.earlyMark = true; }
  }
  const full = shift.fullDayMinutes; const half = shift.halfDayMinutes;
  out.status = day !== 'WORKING' ? (day === 'HOLIDAY' ? 'HOLIDAY_WORKED' : 'WEEKLY_OFF_WORKED') : out.workedMinutes >= full ? 'PRESENT' : out.workedMinutes >= half ? 'HALF_DAY' : 'ABSENT';
  // "3 lates = half a day": the mark that completes a set turns the day into a half day deduction
  if (out.lateMark && rules.late.countPerHalfDay > 0 && (lateMarksBefore + 1) % rules.late.countPerHalfDay === 0) { out.lateDeduction = true; out.notes.push(`Late mark number ${lateMarksBefore + 1}: half a day is deducted`); }
  if (out.earlyMark && rules.earlyGoing.countPerHalfDay > 0 && (earlyMarksBefore + 1) % rules.earlyGoing.countPerHalfDay === 0) { out.earlyDeduction = true; out.notes.push(`Early going number ${earlyMarksBefore + 1}: half a day is deducted`); }
  // overtime: after N hours of work (the shift) or on a day off, for the people the policy names, capped by day and by week
  const otAfter = day === 'WORKING' ? shift.otAfterMinutes : 0;
  if (otAfter != null) {
    out.otMinutes = Math.max(0, out.workedMinutes - otAfter);
    const grade = rules.ot.eligibleGrades; const cat = rules.ot.eligibleCategories;
    out.otEligible = rules.ot.enabled && (grade.length === 0 || grade.includes(person.grade)) && (cat.length === 0 || cat.includes(person.category));
    if (out.otMinutes > 0 && !out.otEligible) out.notes.push('Overtime is not paid to this grade or category');
    if (out.otEligible && out.otMinutes > 0) {
      const dayCap = rules.ot.maxPerDayMinutes ?? Infinity; const weekLeft = Math.max(0, (rules.ot.maxPerWeekMinutes ?? Infinity) - weekOtMinutes);
      out.otPaidMinutes = Math.min(out.otMinutes, dayCap, weekLeft);
      if (out.otPaidMinutes < out.otMinutes) out.notes.push('Overtime is capped by the daily or weekly limit');
      out.otMultiplier = day === 'HOLIDAY' && rules.ot.holidayMultiplier ? rules.ot.holidayMultiplier : rules.ot.multiplier;
    }
  }
  if (day !== 'WORKING' && rules.compOff.enabled && out.workedMinutes >= rules.compOff.minMinutes) { out.compOff = out.workedMinutes >= full ? 1 : 0.5; out.notes.push(`Comp-off of ${out.compOff} day earned, valid ${rules.compOff.expiryDays} days`); }
  return out;
}

/** Is `date` a weekly off? `off` is { type: 'FIXED', days: [0], nthSaturdayOff: [2, 4] } or { type: 'ROTATIONAL', anchor, cycle: [0, 0, 0, 0, 0, 0, 1] } (1 = off). */
export function isWeeklyOff(off, date) {
  if (!off) return false;
  if (off.type === 'ROTATIONAL') {
    const n = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${off.anchor}T00:00:00Z`)) / 86_400_000);
    return off.cycle[((n % off.cycle.length) + off.cycle.length) % off.cycle.length] === 1;
  }
  const wd = weekday(date);
  if ((off.days ?? []).includes(wd)) return true;
  if (wd === 6 && (off.nthSaturdayOff ?? []).length) return off.nthSaturdayOff.includes(Math.ceil(Number(date.slice(8, 10)) / 7));
  return false;
}

/** The shift a rotating pattern gives on a date: { anchor, cycle: [shiftId | null, ...] }; null is a day off. */
export function patternShift(pattern, date) {
  const n = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${pattern.anchor}T00:00:00Z`)) / 86_400_000);
  if (n < 0) return undefined;
  return pattern.cycle[n % pattern.cycle.length];
}

/** The attendance period a date falls in when periods start on `startDay` (1 = the calendar month; 26 = the 26th to the 25th). */
export function periodFor(startDay, date) {
  const y = Number(date.slice(0, 4)); const m = Number(date.slice(5, 7)); const d = Number(date.slice(8, 10));
  const sm = d >= startDay ? m : m - 1;
  const start = new Date(Date.UTC(y, sm - 1, startDay));
  const next = new Date(Date.UTC(y, sm, startDay));
  const startS = start.toISOString().slice(0, 10);
  const endS = addDays(next.toISOString().slice(0, 10), -1);
  const label = startDay === 1 ? new Date(Date.UTC(y, sm - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : `${startS} to ${endS}`;
  return { start: startS, end: endS, label };
}
export { toIso };
