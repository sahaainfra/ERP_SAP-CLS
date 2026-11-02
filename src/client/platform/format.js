// Formatting shared with the server: dates and money come from src/shared so a PDF and a screen agree. Dates follow the language of the screen and the
// person's hour format (part 03.09); amounts have their own helpers in platform/i18n (useFormat).
import { currentPrefs } from './i18n/index.js';
import { formatDate as dateOf, formatDateTime as dateTimeOf } from '../../shared/i18n/format.js';

export const formatDate = (value) => dateOf(value, currentPrefs());
export const formatDateTime = (value) => dateTimeOf(value, currentPrefs());
export { formatINR } from '../../shared/money.js';

/** Neutralise spreadsheet formula injection (standards section 13) and quote for CSV. */
export function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers, rows) {
  return `${[headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export const levelLabel = { default: 'Default', environment: 'Environment', company: 'Company', project: 'Project' };
