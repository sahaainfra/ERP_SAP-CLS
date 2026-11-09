// The sharing of an overhead pool over projects (part 12.04, BR-01). Pure and exact: whole paise only, no floating point.

/**
 * Shares `pool` (paise) over `weights` (non-negative whole numbers: a revenue, a direct cost or a fixed percentage x 10 000) in proportion.
 * Every part is rounded down; the rounding residual (never more than one paise per part) goes to the largest weight, the first of them on a tie,
 * so that the parts add up to the pool exactly (BR-01, T-01).
 * @param {number} pool paise, >= 0
 * @param {number[]} weights
 * @returns {{ parts: number[], residual: number, residualIndex: number, total: number }}
 */
export function allocateByWeights(pool, weights) {
  if (!Number.isSafeInteger(pool) || pool < 0) throw new RangeError('The pool is a whole number of paise, zero or more');
  if (!weights.length) throw new RangeError('There is nothing to share the pool with');
  const w = weights.map((x) => { if (!Number.isSafeInteger(x) || x < 0) throw new RangeError('A weight is a whole number, zero or more'); return BigInt(x); });
  const sum = w.reduce((a, b) => a + b, 0n);
  if (sum <= 0n) throw new RangeError('The weights add up to zero');
  const parts = w.map((x) => Number((BigInt(pool) * x) / sum));
  const residual = pool - parts.reduce((a, b) => a + b, 0);
  let residualIndex = 0;
  weights.forEach((x, i) => { if (x > weights[residualIndex]) residualIndex = i; });
  parts[residualIndex] += residual;
  return { parts, residual, residualIndex, total: parts.reduce((a, b) => a + b, 0) };
}

/** The share of each weight in percent x 10 000 (100 % = 1 000 000), rounded half up; for display only, never used to allocate. */
export function sharesOf(weights) {
  const sum = weights.reduce((a, b) => a + BigInt(b), 0n);
  return weights.map((x) => (sum > 0n ? Number((BigInt(x) * 1_000_000n * 2n + sum) / (sum * 2n)) : 0));
}

/** Do two pool definitions ({ costCentreIds, accountIds }, an empty or missing account list meaning every account) take the same money? */
export function poolsOverlap(a, b) {
  const sa = new Set(a.costCentreIds ?? []);
  if (!(b.costCentreIds ?? []).some((x) => sa.has(x))) return false;
  const xa = a.accountIds ?? []; const xb = b.accountIds ?? [];
  if (!xa.length || !xb.length) return true;
  const set = new Set(xa);
  return xb.some((x) => set.has(x));
}
