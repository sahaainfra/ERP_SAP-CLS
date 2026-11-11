// Earned value (part 14.05, FR-04): the formulas once, as pure functions of whole paise. A ratio is null when it has no meaning (nothing planned, nothing spent), never zero or infinity.
const div = (a, b) => (b > 0 ? a / b : null);
const r4 = (x) => (x == null ? null : Math.round(x * 10000));
/** PV, EV, AC and BAC in paise (AC may be null: no cost yet); returns SV, CV, SPI, CPI, EAC (CPI-based: BAC / CPI) and TCPI ((BAC - EV) / (BAC - AC)), the ratios as ten-thousandths. */
export function metrics({ bac, pv, ev, ac }) {
  const hasAc = ac != null && ac > 0; const spi = div(ev, pv); const cpi = hasAc ? div(ev, ac) : null;
  const eac = cpi != null && cpi > 0 ? Math.round(bac / cpi) : null; const tcpi = hasAc && bac > ac ? (bac - ev) / (bac - ac) : null;
  return { bac, pv, ev, ac: ac ?? null, sv: ev - pv, cv: ac == null ? null : ev - ac, spi: r4(spi), cpi: r4(cpi), eac, tcpi: r4(tcpi) };
}
/** The roll-up of activities by weight: each has a weight (paise or any positive number) and a fraction 0..1; the result is the weighted fraction. With no weight at all the activities count alike. */
export function rollup(items) {
  const w = items.reduce((n, x) => n + x.weight, 0);
  if (w > 0) return items.reduce((n, x) => n + x.weight * x.pct, 0) / w;
  return items.length ? items.reduce((n, x) => n + x.pct, 0) / items.length : 0;
}
/** The planned fraction of an activity on a day, spread evenly over its days; a milestone (or one-day activity) is 0 before and 1 on its day. `ord` turns a date into a day number. */
export function plannedFraction(ord, start, finish, date) {
  if (!start || !finish) return 0; const d = ord(date); const s = ord(start); const f = ord(finish);
  if (d < s) return 0; if (d >= f) return 1; return (d - s + 1) / (f - s + 1);
}
