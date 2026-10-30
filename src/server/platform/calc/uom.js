import { Decimal, ROUND, dec } from '../../../shared/decimal.js';
import { notFound, unprocessable } from '../http/errors.js';

const gcd = (a, b) => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) [x, y] = [y, x % y];
  return x || 1n;
};
/** A factor as an exact fraction n/d, so a chain of conversions loses nothing until the final rounding. */
const fraction = (text) => {
  const d = dec(text);
  const den = 10n ** BigInt(d.scale);
  const g = gcd(d.units, den);
  return { n: d.units / g, d: den / g };
};
const mul = (a, b) => {
  const n = a.n * b.n;
  const d = a.d * b.d;
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
};
const ITEM_COST = 1000;
const GENERIC_COST = 1001;

/**
 * Unit-of-measure conversion (FR-03) over the conversion rows. A row says "1 from = factor to". An item-specific row
 * (cement: 1 BAG = 50 KG; a 12 mm bar: 1 NOS = 10.656 KG) beats a generic row for the same pair, and conversions may
 * chain (BAG to MT goes BAG -> KG with the item row, then KG -> MT with the generic one). Until the UOM master of part
 * 06.02 exists, the rows live in core_uom_conversions (defect D-042).
 */
export function createUomService({ db }) {
  const rows = (itemCode) =>
    db.prepare('SELECT item_code, from_uom, to_uom, factor FROM core_uom_conversions WHERE deleted_at IS NULL AND (item_code IS NULL OR item_code = ?)').all(itemCode ?? '');

  const known = (code) => db.prepare('SELECT 1 FROM core_uoms WHERE code = ? AND deleted_at IS NULL').get(code);

  function graph(itemCode) {
    const edges = new Map(); // "from>to" -> { from, to, n, d, item }
    const put = (from, to, f, item) => {
      const key = `${from}>${to}`;
      const existing = edges.get(key);
      if (existing && existing.item && !item) return; // an item row is never replaced by a generic one
      edges.set(key, { from, to, ...f, item });
    };
    // Generic rows first (both directions), then item rows (both directions) on top of them.
    for (const r of rows(itemCode).filter((x) => x.item_code === null)) {
      const f = fraction(r.factor);
      put(r.from_uom, r.to_uom, f, false);
      put(r.to_uom, r.from_uom, { n: f.d, d: f.n }, false);
    }
    for (const r of rows(itemCode).filter((x) => x.item_code !== null)) {
      const f = fraction(r.factor);
      put(r.from_uom, r.to_uom, f, true);
      put(r.to_uom, r.from_uom, { n: f.d, d: f.n }, true);
    }
    return edges;
  }

  /** Cheapest chain of conversions from -> to (item rows are cheaper than generic ones), or null. */
  function route(edges, from, to) {
    const best = new Map([[from, { cost: 0, path: [] }]]);
    const todo = [from];
    while (todo.length) {
      todo.sort((a, b) => best.get(a).cost - best.get(b).cost);
      const here = todo.shift();
      if (here === to) return best.get(here).path;
      for (const e of edges.values()) {
        if (e.from !== here) continue;
        const cost = best.get(here).cost + (e.item ? ITEM_COST : GENERIC_COST);
        if (!best.has(e.to) || cost < best.get(e.to).cost) {
          best.set(e.to, { cost, path: [...best.get(here).path, e] });
          if (!todo.includes(e.to)) todo.push(e.to);
        }
      }
    }
    return null;
  }

  return {
    known,
    /**
     * Convert a quantity. Returns { result, scale, path: [{ from, to, factor, source }], itemCode }. The result is rounded
     * once, half-up by default, to `scale` places (3, the quantity scale, unless told otherwise).
     */
    convert(quantity, fromUom, toUom, { itemCode = null, scale = 3, mode = ROUND.HALF_UP } = {}) {
      for (const u of [fromUom, toUom]) if (!known(u)) throw notFound(`"${u}" is not a unit of measure.`);
      const q = dec(quantity);
      if (fromUom === toUom) return { result: q.round(scale, mode).toFixed(scale), scale, path: [], itemCode };
      const path = route(graph(itemCode), fromUom, toUom);
      if (!path) throw unprocessable(`There is no conversion from ${fromUom} to ${toUom}${itemCode ? ` for ${itemCode}` : ''}. Add a conversion factor first.`);
      const total = path.reduce((acc, e) => mul(acc, { n: e.n, d: e.d }), { n: 1n, d: 1n });
      const result = q.mul(new Decimal(total.n, 0)).div(new Decimal(total.d, 0), scale, mode);
      return {
        result: result.toFixed(scale),
        scale,
        itemCode,
        path: path.map((e) => ({ from: e.from, to: e.to, factor: new Decimal(e.n, 0).div(new Decimal(e.d, 0), 8).toString().replace(/0+$/, '').replace(/\.$/, ''), source: e.item ? 'item' : 'generic' })),
      };
    },
  };
}
