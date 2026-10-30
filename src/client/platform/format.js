// Formatting shared with the server: dates and money come from src/shared so a PDF and a screen agree.
export { formatDate, formatDateTime } from '../../shared/dates.js';
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
