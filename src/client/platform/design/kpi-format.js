// Formatting of key figures in tiles (part 166.2, U-02): a large rupee amount is shortened the Indian way, in lakh (L) and crore (Cr), so a
// tile stays readable on a phone; the exact amount is kept for the tooltip, for screen readers and on the page the tile leads to.
import { formatINR } from '../../../shared/money.js';

const LAKH = 1e5;
const CRORE = 1e7;

/** The amount as a number, or null when it is not one (a masked "•••", an empty value). */
export function toAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value).replace(/[₹,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/**
 * "₹ 2.43 Cr" for 2,43,00,000; "₹ 4.08 L" for 4,08,000; below one lakh the exact amount ("₹ 80,000.00"). Null when it is not a number.
 * Two decimals, rounded half away from zero, the way the figure is read aloud in a site meeting.
 */
export function abbreviateINR(value) {
  const n = toAmount(value);
  if (n === null) return null;
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  const two = (x) => (Math.round(x * 100 + Number.EPSILON) / 100).toFixed(2);
  if (a >= CRORE) return `${sign}₹ ${two(a / CRORE)} Cr`;
  if (a >= LAKH) return `${sign}₹ ${two(a / LAKH)} L`;
  return `${sign}₹ ${formatINR(a, { symbol: false })}`;
}

/** The exact amount the Indian way ("₹ 2,43,00,000.00"), for the tooltip and the screen reader. */
export const exactINR = (value) => {
  const n = toAmount(value);
  return n === null ? null : `${n < 0 ? '-' : ''}₹ ${formatINR(Math.abs(n), { symbol: false })}`;
};

/**
 * The change against the previous period: { delta, pct, direction: 'up' | 'down' | 'flat', good: true | false | null }.
 * `better` says which way is good for this figure ('up' for revenue, 'down' for cost or delay); without it nothing is judged.
 */
export function trendOf(current, previous, better) {
  const c = toAmount(current);
  const p = toAmount(previous);
  if (c === null || p === null) return null;
  const delta = c - p;
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const pct = p === 0 ? null : Math.round((delta / Math.abs(p)) * 1000) / 10;
  const good = !better || direction === 'flat' ? null : direction === better;
  return { delta, pct, direction, good };
}
