// Financial years and their monthly periods, for any start month (India: April). Business dates are YYYY-MM-DD.
import { parseBusinessDate } from './dates.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12

/** The financial year that starts on `startDate`: its code ("2026-27"), end date and twelve monthly periods. */
export function fiscalYearFrom(startDate) {
  const { year, month, day } = parseBusinessDate(startDate);
  if (day !== 1) throw new RangeError('A financial year starts on the first day of a month');
  const periods = [];
  for (let i = 0; i < 12; i++) {
    const m = ((month - 1 + i) % 12) + 1;
    const y = year + Math.floor((month - 1 + i) / 12);
    periods.push({ periodNo: i + 1, name: `${MONTHS[m - 1]} ${y}`, startDate: `${y}-${pad(m)}-01`, endDate: `${y}-${pad(m)}-${pad(lastDay(y, m))}` });
  }
  const endYear = month === 1 ? year : year + 1;
  const code = month === 1 ? String(year) : `${year}-${pad(endYear % 100)}`;
  return { code, startDate, endDate: periods[11].endDate, periods };
}

/** The status words of a period, per module, and what each allows. */
export const PERIOD_STATUS = Object.freeze(['Open', 'Soft-closed', 'Closed']);

/** Can a posting go into a period with this status? `privileged` actors may post into a soft-closed period. */
export function postingAllowed(status, { privileged = false } = {}) {
  if (status === 'Open') return true;
  if (status === 'Soft-closed') return privileged;
  return false;
}
