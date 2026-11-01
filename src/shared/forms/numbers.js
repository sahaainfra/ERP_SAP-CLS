// Number entry for forms (part 03.02, BR-02): what a person types or pastes ("12,34,567.50", "1,234,567.5", "₹ 2,500",
// "18%") becomes a plain decimal string ("1234567.50"); what is stored is shown back with Indian grouping. Shared by the browser
// (field components, the line grid) and the server (the same rules decide what a pasted value means). No floating point.
import { dec } from '../decimal.js';
import { groupDigits } from '../money.js';

const INDIAN = /^\d{1,2}(,\d{2})*,\d{3}$/;
const INTERNATIONAL = /^\d{1,3}(,\d{3})+$/;

/**
 * Read a number a person typed or pasted. Returns { ok: true, value } with value a plain decimal string, or { ok: false, error }.
 * Accepts Indian (12,34,567) and international (1,234,567) grouping, a rupee sign, a percent sign, spaces and a leading minus;
 * refuses grouping that fits neither (12,3456), a comma used as the decimal mark (1.234,56) and more decimals than `scale`.
 */
export function parseNumberInput(text, { scale = 2, allowNegative = false, max = null } = {}) {
  const raw = String(text ?? '').trim();
  if (raw === '') return { ok: true, value: '' };
  let s = raw.replace(/[₹%\s\u00a0]/g, '').replace(/^Rs\.?/i, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); } // accounting style (1,000)
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  if (!/^[\d,]*(\.\d*)?$/.test(s) || !/\d/.test(s)) return { ok: false, error: 'Enter a number, for example 12,34,567.50' };
  const [whole, frac = ''] = s.split('.');
  if (whole.includes(',') && !INDIAN.test(whole) && !INTERNATIONAL.test(whole)) return { ok: false, error: 'The digit grouping is not right: use 12,34,567 or 1,234,567' };
  if (frac.length > scale) return { ok: false, error: scale === 0 ? 'Enter a whole number' : `Use at most ${scale} decimal places` };
  if (negative && !allowNegative) return { ok: false, error: 'Enter zero or more' };
  const digits = whole.replace(/,/g, '') || '0';
  const value = `${negative ? '-' : ''}${digits.replace(/^0+(?=\d)/, '')}${frac ? `.${frac}` : ''}`;
  if (max !== null && dec(value).cmp(dec(max)) > 0) return { ok: false, error: `Enter at most ${formatNumberInput(String(max), { scale: 0 })}` };
  return { ok: true, value };
}

/** Show a plain decimal with Indian grouping and exactly `scale` decimals ("1234567.5" -> "12,34,567.50"); "" stays "". */
export function formatNumberInput(value, { scale = 2, grouping = 'indian', trim = false } = {}) {
  if (value === '' || value === null || value === undefined) return '';
  const fixed = dec(value).toFixed(scale);
  const negative = fixed.startsWith('-');
  let [whole, frac] = fixed.replace('-', '').split('.');
  if (trim && frac) frac = frac.replace(/0+$/, '');
  return `${negative ? '-' : ''}${groupDigits(whole, grouping)}${frac ? `.${frac}` : ''}`;
}

/** The exact product the grid shows while typing; the server recomputes it with the calculation engine on save. */
export const multiply = (a, b, scale = 2) => (a === '' || b === '' ? '' : dec(a).mul(b).round(scale).toFixed(scale));

/** Exact total of a column of plain decimals ('' counts as nothing). */
export const total = (values, scale = 2) => values.filter((v) => v !== '' && v !== null && v !== undefined).reduce((acc, v) => acc.add(v), dec('0')).round(scale).toFixed(scale);
