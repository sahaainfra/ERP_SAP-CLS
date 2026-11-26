// Spreadsheet formula injection (part 02.07, section 13): a cell that starts with = + - @ tab or return is read by a spreadsheet as a
// formula. Every server-written CSV runs its cells through here, which puts a single quote in front of such a cell.
const DANGEROUS = /^[=+\-@\t\r]/;
export const neutralise = (v) => (typeof v === 'string' && DANGEROUS.test(v) ? `'${v}` : v);
export function csvCell(value) {
  // only text can be a formula: a number such as -1500 stays a number, not the text '-1500
  const s = value === null || value === undefined ? '' : typeof value === 'string' ? neutralise(value) : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (headers, rows) => `${[headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
