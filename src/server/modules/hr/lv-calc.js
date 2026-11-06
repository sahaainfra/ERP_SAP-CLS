import { addDays } from './att-calc.js';

// The leave calculations of part 07.07 in one place and with no database (BR-01): how many days a leave takes (holidays and weekly offs excluded unless the sandwich rule applies, half days), what a person earns by
// accrual (annual, quarterly or monthly, pro-rata for a joiner), and what year-end does with a balance (encash, carry forward, lapse).
const r2 = (n) => Math.round(n * 100) / 100;
export const LEAVE_YEAR_START = '01-01'; // the leave year is the calendar year
export const DEFAULT_RULES = Object.freeze({
  quota: 0, accrual: 'ANNUAL', proRata: true, carryForwardMax: 0, encashable: false, encashMax: null, minServiceDays: 0, maxConsecutive: null, documentAfterDays: null,
  sandwich: false, allowHalfDay: true, advanceMax: 0, special: false, genders: [], categories: [], expiryDays: null,
});
export const withDefaults = (r = /** @type {any} */ ({})) => /** @type {any} */ ({ ...DEFAULT_RULES, ...r, genders: r.genders ?? [], categories: r.categories ?? [] });

/**
 * The days a leave takes. `dayType(date)` says WORKING, WEEKLY_OFF or HOLIDAY (ROSTER_OFF counts as WEEKLY_OFF). Off days at the start or end of the range are not leave. Off days inside it count only
 * with the sandwich rule. A half day is one working day taken as a half (`half` FIRST or SECOND), only for a single day. Returns { days, working, sandwiched, offDays, perDay }.
 */
export function countDays({ from, to, half = 'NONE', dayType, sandwich = false }) {
  if (to < from) return { days: 0, working: 0, sandwiched: 0, offDays: 0, perDay: [], error: 'The end is before the start' };
  const dates = []; for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const kind = dates.map((d) => (dayType(d) === 'WORKING' ? 'W' : 'O'));
  if (half !== 'NONE') {
    if (from !== to) return { days: 0, working: 0, sandwiched: 0, offDays: 0, perDay: [], error: 'A half day is for one day' };
    if (kind[0] !== 'W') return { days: 0, working: 0, sandwiched: 0, offDays: 1, perDay: [], error: 'That day is a holiday or a weekly off' };
    return { days: 0.5, working: 0.5, sandwiched: 0, offDays: 0, perDay: [{ date: from, days: 0.5, kind: 'HALF' }] };
  }
  const first = kind.indexOf('W'); const last = kind.lastIndexOf('W');
  const perDay = []; let working = 0; let sandwiched = 0;
  dates.forEach((d, i) => {
    if (kind[i] === 'W') { working += 1; perDay.push({ date: d, days: 1, kind: 'WORKING' }); }
    else if (first >= 0 && i > first && i < last && sandwich) { sandwiched += 1; perDay.push({ date: d, days: 1, kind: 'SANDWICH' }); }
  });
  return { days: working + sandwiched, working, sandwiched, offDays: dates.length - working - sandwiched, perDay, ...(first < 0 ? { error: 'Every day of that range is a holiday or a weekly off' } : {}) };
}

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1..12
/** The share of the month (0..1) a person who joined on `doj` is in service. */
export function monthShare(doj, y, m) {
  const first = `${y}-${String(m).padStart(2, '0')}-01`; const n = daysInMonth(y, m);
  const last = `${y}-${String(m).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
  if (doj > last) return 0;
  if (doj <= first) return 1;
  return (n - Number(doj.slice(8, 10)) + 1) / n;
}
/**
 * What a person earns at one accrual date. MONTHLY: quota/12 for the month, pro-rata in the joining month. QUARTERLY: quota/4 for the quarter that starts that month, pro-rata by the days in service.
 * ANNUAL: the whole quota on 1 January (or on joining: pro-rata by the days left in the year). Keys make the credit happen once. Returns [{ key, days }].
 */
export function accrualsFor({ rules: raw, doj, year, month }) {
  const rules = withDefaults(raw); const q = Number(rules.quota) || 0;
  if (!q || rules.accrual === 'NONE') return [];
  const shareOf = (from, to) => { // the share of a span of months the person is in service
    let tot = 0; let got = 0;
    for (let m = from; m <= to; m += 1) { tot += 1; got += rules.proRata === false ? (monthShare(doj, year, m) > 0 ? 1 : 0) : monthShare(doj, year, m); }
    return got / tot;
  };
  if (rules.accrual === 'MONTHLY') { const s = rules.proRata === false ? (monthShare(doj, year, month) > 0 ? 1 : 0) : monthShare(doj, year, month); return s > 0 ? [{ key: `M${year}-${String(month).padStart(2, '0')}`, days: r2((q / 12) * s) }] : []; }
  if (rules.accrual === 'QUARTERLY') { if ((month - 1) % 3 !== 0) return []; const s = shareOf(month, month + 2); return s > 0 ? [{ key: `Q${year}-${(month - 1) / 3 + 1}`, days: r2((q / 4) * s) }] : []; }
  // ANNUAL: credited once for the year, from the month the person is in service, pro-rata by months
  if (rules.accrual === 'ANNUAL') { const s = shareOf(1, 12); if (s <= 0) return []; const joinedThisYear = doj.slice(0, 4) === String(year); return month === 1 || (joinedThisYear && Number(doj.slice(5, 7)) === month) ? [{ key: `A${year}`, days: r2(q * s) }] : []; }
  return [];
}
/** Year-end of one balance: encash up to the limit (when the type may be encashed), carry forward up to the limit, lapse the rest. A negative balance is carried as it is (advance leave is recovered next year). */
export function yearEnd({ balance, rules: raw }) {
  const rules = withDefaults(raw);
  if (balance <= 0) return { encash: 0, carry: balance, lapse: 0 };
  const encash = rules.encashable ? r2(Math.min(balance, rules.encashMax ?? balance)) : 0;
  const rest = r2(balance - encash);
  const carry = r2(Math.min(rest, Number(rules.carryForwardMax) || 0));
  return { encash, carry, lapse: r2(rest - carry) };
}
export const DEFAULT_TYPES = [
  { code: 'CL', name: 'Casual leave', paid: 1, sort: 10, rules: { quota: 12, accrual: 'MONTHLY', carryForwardMax: 0, maxConsecutive: 3, sandwich: false } },
  { code: 'SL', name: 'Sick leave', paid: 1, sort: 20, rules: { quota: 12, accrual: 'ANNUAL', carryForwardMax: 0, documentAfterDays: 2, sandwich: false } },
  { code: 'EL', name: 'Earned (privilege) leave', paid: 1, sort: 30, rules: { quota: 18, accrual: 'MONTHLY', carryForwardMax: 30, encashable: true, encashMax: 15, minServiceDays: 90, sandwich: true } },
  { code: 'ML', name: 'Maternity leave', paid: 1, sort: 40, rules: { quota: 182, accrual: 'ANNUAL', proRata: false, special: true, genders: ['FEMALE'], minServiceDays: 80, sandwich: true, allowHalfDay: false } },
  { code: 'PL', name: 'Paternity leave', paid: 1, sort: 50, rules: { quota: 15, accrual: 'ANNUAL', proRata: false, special: true, genders: ['MALE'], sandwich: true, allowHalfDay: false } },
  { code: 'CO', name: 'Compensatory off', paid: 1, sort: 60, rules: { quota: 0, accrual: 'NONE', expiryDays: 60, sandwich: false } },
  { code: 'BL', name: 'Bereavement / special leave', paid: 1, sort: 70, rules: { quota: 5, accrual: 'ANNUAL', proRata: false, special: true, sandwich: true, allowHalfDay: false } },
  { code: 'LOP', name: 'Leave without pay', paid: 0, sort: 90, rules: { quota: 0, accrual: 'NONE', advanceMax: 365, sandwich: true } },
];
