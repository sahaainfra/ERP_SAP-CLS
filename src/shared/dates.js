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

/** Today's business date in Asia/Kolkata as YYYY-MM-DD. */
export function todayIST(now = new Date()) {
  const p = istParts(now);
  return `${p.y}-${pad(p.m + 1)}-${pad(p.d)}`;
}

/** Indian financial year (1 April to 31 March) of a business date: { label: "2026-27", start, end }. */
export function financialYear(text) {
  const { year, month } = parseBusinessDate(text);
  const start = month >= 4 ? year : year - 1;
  return { label: `${start}-${String((start + 1) % 100).padStart(2, '0')}`, start: `${start}-04-01`, end: `${start + 1}-03-31` };
}
