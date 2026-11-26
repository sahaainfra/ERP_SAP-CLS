// Money, quantity, rate and percentage helpers on exact decimals (standards section 4.3):
// money 2 places, rates 4, quantities 3, percentages 4. Everything rounds half-up unless stated.
import { Decimal, ROUND, dec } from './decimal.js';

export const SCALE = Object.freeze({ money: 2, rate: 4, quantity: 3, percent: 4 });

export const money = (v) => dec(v).round(SCALE.money);
export const rate = (v) => dec(v).round(SCALE.rate);
export const quantity = (v) => dec(v).round(SCALE.quantity);
export const percent = (v) => dec(v).round(SCALE.percent);

/** Exact sum of many values, rounded once at the end (never round each term). */
export const sum = (values) => values.reduce((acc, v) => acc.add(v), Decimal.zero());

/** quantity x rate = amount, rounded to money once. */
export const lineAmount = (qty, unitRate) => money(dec(qty).mul(unitRate));

/** pct% of an amount, rounded to money (for example tax, retention, discount). */
export const percentOf = (amount, pct) => money(dec(amount).mul(pct).div(100, 8));

/**
 * Split an amount across weights so the parts add up to the total exactly (largest-remainder method).
 * Used for cost allocation: no paise are lost or invented.
 */
export function allocate(total, weights, scale = SCALE.money) {
  const t = dec(total).round(scale);
  // a negative total (a credit or a reversal) is split as its positive amount and negated, so the remainder is handed out too
  if (t.isNegative()) return allocate(t.neg(), weights, scale).map((p) => p.neg());
  const w = weights.map((x) => dec(x));
  const totalWeight = sum(w);
  if (totalWeight.isZero()) throw new RangeError('Weights add up to zero');
  const step = new Decimal(1n, scale);
  const exact = w.map((x) => t.mul(x).div(totalWeight, scale + 6));
  const floors = exact.map((x) => x.round(scale, ROUND.DOWN));
  let remainder = t.sub(sum(floors));
  const order = exact
    .map((x, i) => ({ i, frac: x.sub(floors[i]) }))
    .sort((a, b) => b.frac.cmp(a.frac) || a.i - b.i);
  const parts = floors.slice();
  for (const { i } of order) {
    if (remainder.cmp(step) < 0) break;
    parts[i] = parts[i].add(step);
    remainder = remainder.sub(step);
  }
  return parts.map((p) => p.round(scale));
}

/** Group digits Indian style (12,34,567) or international (1,234,567). */
export function groupDigits(digits, style = 'indian') {
  if (style === 'international' || digits.length <= 3) return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

/** Format as rupees: formatINR("1234567.5") -> "₹12,34,567.50". `symbol: false` gives the number only. */
export function formatINR(value, { symbol = true, grouping = 'indian', decimals = SCALE.money } = {}) {
  const fixed = dec(value).toFixed(decimals);
  const negative = fixed.startsWith('-');
  const [whole, frac] = fixed.replace('-', '').split('.');
  const body = `${groupDigits(whole, grouping)}${frac ? `.${frac}` : ''}`;
  return `${negative ? '-' : ''}${symbol ? '₹' : ''}${body}`;
}

/** Parse user text such as "₹ 12,34,567.50" or "-1,000" into a Decimal. */
export function parseINR(text) {
  const cleaned = String(text).replace(/[₹\s,]/g, '');
  return dec(cleaned);
}

// Storage in whole minor units (ADR-14): the database holds INTEGERs so SQL can add, compare and index them
// exactly. money is paise, rate is x10000, quantity is x1000, percent is x10000.

/** A decimal as the integer stored in the database, rounded half-up to the scale of `kind`. */
export function toUnits(value, kind) {
  const scale = SCALE[kind];
  if (scale === undefined) throw new RangeError(`Unknown kind "${kind}"; use money, rate, quantity or percent`);
  const n = Number(dec(value).round(scale).units);
  if (!Number.isSafeInteger(n)) throw new RangeError(`${value} is too large to store as whole ${kind} units`);
  return n;
}

/** The decimal an integer from the database stands for. */
export function fromUnits(units, kind) {
  const scale = SCALE[kind];
  if (scale === undefined) throw new RangeError(`Unknown kind "${kind}"; use money, rate, quantity or percent`);
  return new Decimal(BigInt(units), scale);
}
