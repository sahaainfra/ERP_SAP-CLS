// Date helpers for India: business dates are plain YYYY-MM-DD (no time zone), timestamps are UTC ISO strings
// shown in Asia/Kolkata as DD-MMM-YYYY (standards sections 4.3 and 13). No Intl, so output is identical
// on every runtime.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, '0');

function istParts(value) {
  const t = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(t.getTime())) return null;
  const d = new Date(t.getTime() + IST_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes() };
}

/** DD-MMM-YYYY HH:mm in Asia/Kolkata; "-" for empty or invalid input. */
export function formatDateTime(iso) {
  if (!iso) return '-';
  const p = istParts(iso);
  return p ? `${pad(p.d)}-${MONTHS[p.m]}-${p.y} ${pad(p.h)}:${pad(p.min)}` : '-';
}

/** DD-MMM-YYYY in Asia/Kolkata for a timestamp. */
export function formatDate(iso) {
  if (!iso) return '-';
  const p = istParts(iso);
  return p ? `${pad(p.d)}-${MONTHS[p.m]}-${p.y}` : '-';
}

/** Validate a business date "YYYY-MM-DD" (a real calendar day) and return its parts, or throw. */
export function parseBusinessDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text));
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const check = new Date(Date.UTC(y, mo - 1, d));
    if (check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d) return { year: y, month: mo, day: d };
  }
  throw new RangeError(`"${text}" is not a valid date; use YYYY-MM-DD`);
}

/** DD-MMM-YYYY for a business date. */
export function formatBusinessDate(text) {
  const { year, month, day } = parseBusinessDate(text);
  return `${pad(day)}-${MONTHS[month - 1]}-${year}`;
}

/**
 * The current instant. Tests and the weekday/year-end CI jobs fix it with ERP_TEST_NOW (an ISO timestamp, for example
 * 2026-11-15T06:00:00Z for a Sunday); the variable is ignored when NODE_ENV is production and in the browser.
 */
export function clockNow() {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  if (env?.ERP_TEST_NOW && env.NODE_ENV !== 'production') { const t = new Date(env.ERP_TEST_NOW); if (!Number.isNaN(t.getTime())) return t; }
  return new Date();
}

/** Today's business date in Asia/Kolkata as YYYY-MM-DD. */
export function todayIST(now = clockNow()) {
  const p = istParts(now);
  return `${p.y}-${pad(p.m + 1)}-${pad(p.d)}`;
}

/** Indian financial year (1 April to 31 March) of a business date: { label: "2026-27", start, end }. */
export function financialYear(text) {
  const { year, month } = parseBusinessDate(text);
  const start = month >= 4 ? year : year - 1;
  return { label: `${start}-${String((start + 1) % 100).padStart(2, '0')}`, start: `${start}-04-01`, end: `${start + 1}-03-31` };
}

/**
 * Whole days from `b` to `a` (a - b), for a business date "YYYY-MM-DD", an ISO timestamp or a Date. Text and numbers are
 * converted before the subtraction, so a value that arrives from the database as a string never reaches `-` as a string.
 * @param {string | number | Date} a
 * @param {string | number | Date} b
 */
export function daysBetween(a, b) {
  const ms = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : new Date(v)).getTime();
  return Math.round((ms(a) - ms(b)) / 86_400_000);
}

// ---- the one display format for dates and times in the application (part 166.1 F-04): "16 Nov 2026" and "16 Nov 2026, 12:10 am", in Asia/Kolkata ----
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A business date "YYYY-MM-DD" has no time zone and is shown as it is; a timestamp (ISO text, number or Date) is shown on its day in India. */
function dayParts(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && BUSINESS_DATE.test(value)) { const [y, m, d] = value.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCMonth() === m - 1 ? { y, m: m - 1, d } : null; }
  const p = istParts(value);
  return p ? { y: p.y, m: p.m, d: p.d, h: p.h, min: p.min } : null;
}
/** 16 Nov 2026; an em dash for nothing or for something that is not a date. */
export function fmtDate(value) {
  const p = dayParts(value);
  return p ? `${pad(p.d)} ${SHORT[p.m]} ${p.y}` : '—';
}
/** 16 Nov 2026, 12:10 am (India time). A business date has no time and is shown as a date. */
export function fmtDateTime(value) {
  const p = dayParts(value);
  if (!p) return '—';
  if (p.h === undefined) return fmtDate(value);
  return `${pad(p.d)} ${SHORT[p.m]} ${p.y}, ${p.h % 12 === 0 ? 12 : p.h % 12}:${pad(p.min)} ${p.h < 12 ? 'am' : 'pm'}`;
}
/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", else the date. `now` is for tests. */
export function fmtRelative(value, now = clockNow()) {
  const t = value == null || value === '' ? NaN : new Date(typeof value === 'string' && BUSINESS_DATE.test(value) ? `${value}T00:00:00+05:30` : value).getTime();
  if (Number.isNaN(t)) return '—';
  const sec = Math.round((new Date(now).getTime() - t) / 1000);
  if (sec < -60) return fmtDate(value);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)} h ago`;
  const days = daysBetween(todayIST(new Date(now)), todayIST(new Date(t)));
  if (days === 1) return 'yesterday';
  return days < 7 ? `${days} days ago` : fmtDate(value);
}
