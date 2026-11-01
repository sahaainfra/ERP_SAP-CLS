// Business dates for the date fields (part 03.02, FR-01): shown as DD-MMM-YYYY (standards section 13), kept as YYYY-MM-DD, typed in
// any of the ways people in India write a date. Pure functions, tested in Node.
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n) => String(n).padStart(2, '0');

export const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const real = (y, m, d) => {
  const t = new Date(Date.UTC(y, m, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m && t.getUTCDate() === d;
};

/** "2026-10-31" -> "31-Oct-2026"; anything else as it is. */
export function formatBusinessDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  return m ? `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}` : (iso ?? '');
}

/**
 * Read a typed date: 31-10-2026, 31/10/2026, 31.10.26, 31-Oct-2026, 31 October 2026, 2026-10-31. Day first (the Indian order).
 * Returns "YYYY-MM-DD" or null when it is not a real date.
 */
export function parseTypedDate(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return real(+m[1], +m[2] - 1, +m[3]) ? isoOf(+m[1], +m[2] - 1, +m[3]) : null;
  m = /^(\d{1,2})[-/. ](\d{1,2}|[A-Za-z]{3,9})[-/. ](\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const day = +m[1];
  const month = /^\d+$/.test(m[2]) ? +m[2] - 1 : MONTHS.findIndex((x) => x.toLowerCase() === m[2].slice(0, 3).toLowerCase());
  const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  return month >= 0 && real(year, month, day) ? isoOf(year, month, day) : null;
}

/** Today in India as YYYY-MM-DD. */
export function todayIst(now = Date.now()) {
  return new Date(now + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

/** The weeks of a month for a calendar grid, Monday first: [[{ iso, day, inMonth }]]. */
export function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = Date.UTC(year, month, 1 - offset);
  const weeks = [];
  for (let w = 0; w < 6; w += 1) {
    const week = [];
    for (let d = 0; d < 7; d += 1) {
      const t = new Date(start + (w * 7 + d) * 86_400_000);
      week.push({ iso: t.toISOString().slice(0, 10), day: t.getUTCDate(), inMonth: t.getUTCMonth() === month, weekday: t.getUTCDay() });
    }
    if (w >= 4 && !week.some((x) => x.inMonth)) break;
    weeks.push(week);
  }
  return weeks;
}

/** A date moved by some days (for keyboard movement in the calendar). */
export const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
