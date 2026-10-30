// Exact decimal arithmetic on BigInt (no floating point anywhere). Shared by the server (PDFs, services)
// and the client so both format and calculate identically. A Decimal is { units, scale }: value = units / 10^scale.

const DECIMAL = /^([+-]?)(\d+)(?:\.(\d+))?$/;
/** @param {number} n @returns {bigint} */
const pow10 = (n) => 10n ** BigInt(n);

export const ROUND = Object.freeze({ HALF_UP: 'HALF_UP', HALF_EVEN: 'HALF_EVEN', DOWN: 'DOWN', UP: 'UP' });

/**
 * Integer division of BigInts with the chosen rounding of the remainder.
 * @param {bigint} n
 * @param {bigint} d
 * @param {string} mode
 * @returns {bigint}
 */
function divRound(n, d, mode) {
  if (d === 0n) throw new RangeError('Division by zero');
  const negative = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  let q = an / ad;
  const r = an % ad;
  if (r !== 0n) {
    const twice = 2n * r;
    let up;
    if (mode === ROUND.DOWN) up = false;
    else if (mode === ROUND.UP) up = true;
    else if (mode === ROUND.HALF_EVEN) up = twice > ad || (twice === ad && q % 2n === 1n);
    else up = twice >= ad; // HALF_UP: ties go away from zero (the commercial rule)
    if (up) q += 1n;
  }
  return negative ? -q : q;
}

export class Decimal {
  /**
   * @param {bigint | number | string} units
   * @param {number} scale
   */
  constructor(units, scale = 0) {
    this.units = BigInt(units);
    this.scale = scale;
    Object.freeze(this);
  }

  /** Accepts a decimal string, a bigint or a safe integer. A non-integer Number is rejected: pass a string. */
  static of(value) {
    if (value instanceof Decimal) return value;
    if (typeof value === 'bigint') return new Decimal(value, 0);
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) throw new TypeError(`Pass "${value}" as a string: only integers may be passed as numbers`);
      return new Decimal(BigInt(value), 0);
    }
    if (typeof value === 'string') {
      const m = DECIMAL.exec(value.trim());
      if (!m) throw new RangeError(`"${value}" is not a decimal number`);
      const frac = m[3] ?? '';
      return new Decimal(BigInt(`${m[1] === '-' ? '-' : ''}${m[2]}${frac}`), frac.length);
    }
    throw new TypeError('Not a decimal value');
  }

  static zero() {
    return new Decimal(0n, 0);
  }

  /** @returns {[bigint, bigint, number]} both values as integers at the larger scale, and that scale */
  #aligned(other) {
    const o = Decimal.of(other);
    const scale = Math.max(this.scale, o.scale);
    return [this.units * pow10(scale - this.scale), o.units * pow10(scale - o.scale), scale];
  }

  add(other) {
    const [a, b, scale] = this.#aligned(other);
    return new Decimal(a + b, scale);
  }

  sub(other) {
    const [a, b, scale] = this.#aligned(other);
    return new Decimal(a - b, scale);
  }

  mul(other) {
    const o = Decimal.of(other);
    return new Decimal(this.units * o.units, this.scale + o.scale);
  }

  /** Divide and round to `scale` decimal places (default 4). */
  div(other, scale = 4, mode = ROUND.HALF_UP) {
    const o = Decimal.of(other);
    // value = (a/10^sa) / (b/10^sb); result units at `scale` = a * 10^(scale + sb - sa) / b
    const shift = scale + o.scale - this.scale;
    const num = shift >= 0 ? this.units * pow10(shift) : this.units;
    const den = shift >= 0 ? o.units : o.units * pow10(-shift);
    return new Decimal(divRound(num, den, mode), scale);
  }

  /** Round to `scale` decimal places. */
  round(scale, mode = ROUND.HALF_UP) {
    if (scale >= this.scale) return new Decimal(this.units * pow10(scale - this.scale), scale);
    return new Decimal(divRound(this.units, pow10(this.scale - scale), mode), scale);
  }

  neg() {
    return new Decimal(-this.units, this.scale);
  }

  abs() {
    return this.units < 0n ? this.neg() : this;
  }

  cmp(other) {
    const [a, b] = this.#aligned(other);
    return a < b ? -1 : a > b ? 1 : 0;
  }

  eq(other) {
    return this.cmp(other) === 0;
  }

  lt(other) {
    return this.cmp(other) < 0;
  }

  gt(other) {
    return this.cmp(other) > 0;
  }

  isZero() {
    return this.units === 0n;
  }

  isNegative() {
    return this.units < 0n;
  }

  /** Fixed-point text with exactly `scale` places (rounds half-up if it has more), e.g. "1234.50". */
  toFixed(scale = this.scale) {
    const r = this.round(scale);
    const negative = r.units < 0n;
    const digits = (negative ? -r.units : r.units).toString().padStart(scale + 1, '0');
    const whole = digits.slice(0, digits.length - scale);
    const frac = scale > 0 ? `.${digits.slice(digits.length - scale)}` : '';
    return `${negative ? '-' : ''}${whole}${frac}`;
  }

  toString() {
    return this.toFixed(this.scale);
  }

  toJSON() {
    return this.toString();
  }
}

export const dec = (value) => Decimal.of(value);
