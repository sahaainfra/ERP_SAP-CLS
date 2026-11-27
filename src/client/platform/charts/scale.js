// The geometry and the text of the charts (part 03.07, FR-08). Plain functions, so they run in Node for the tests: ticks, bands, paths, colours,
// the table that every chart can be read as, and the CSV of that table.

/** A tidy top for an axis and the ticks up to it: niceTicks(37) -> { max: 40, step: 10, ticks: [0, 10, 20, 30, 40] }. With `whole` (counts) no step is below 1. */
export function niceTicks(maxValue, count = 4, whole = false) {
  const max = Math.max(0, Number(maxValue) || 0);
  if (max === 0) return { max: 1, step: 1, ticks: [0, 1] };
  const rough = max / count;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = Math.max(whole ? 1 : 0, (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { max: top, step, ticks };
}

/** n bands across a width with a gap between them: [{ x, w }]. */
export function bands(n, width, gap = 0.25) {
  if (n <= 0) return [];
  const each = width / n;
  const w = each * (1 - gap);
  return Array.from({ length: n }, (_, i) => ({ x: i * each + (each - w) / 2, w }));
}

/** The path of a line through points [[x, y], ...]. */
export const linePath = (pts) => pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${round(x)},${round(y)}`).join(' ');

/** The path of the area between a line and a baseline y. */
export function areaPath(pts, baseline) {
  if (pts.length === 0) return '';
  return `${linePath(pts)} L${round(pts.at(-1)[0])},${round(baseline)} L${round(pts[0][0])},${round(baseline)} Z`;
}

const round = (n) => Math.round(n * 100) / 100;
const polar = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

/** The path of a ring segment from angle a0 to a1 (radians, 0 at the top, clockwise); a whole circle is drawn as two halves. */
export function arcPath(cx, cy, outer, inner, a0, a1) {
  const start = a0 - Math.PI / 2;
  let end = a1 - Math.PI / 2;
  if (end - start >= Math.PI * 2 - 1e-6) end = start + Math.PI * 2 - 1e-4;
  const large = end - start > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, outer, start);
  const [x1, y1] = polar(cx, cy, outer, end);
  const [x2, y2] = polar(cx, cy, inner, end);
  const [x3, y3] = polar(cx, cy, inner, start);
  return `M${round(x0)},${round(y0)} A${outer},${outer} 0 ${large} 1 ${round(x1)},${round(y1)} L${round(x2)},${round(y2)} A${inner},${inner} 0 ${large} 0 ${round(x3)},${round(y3)} Z`;
}

/** The angles of each slice of a donut: [{ a0, a1, share }] for values that add up to the whole circle. */
export function sliceAngles(values) {
  const total = values.reduce((a, v) => a + Math.max(0, v), 0);
  let at = 0;
  return values.map((v) => {
    const share = total > 0 ? Math.max(0, v) / total : 0;
    const out = { a0: at, a1: at + share * Math.PI * 2, share };
    at = out.a1;
    return out;
  });
}

/** Where a day falls on a time axis from `start` to `end` (ISO dates): 0 to 1, clamped. */
export function dayFraction(day, start, end) {
  const t = (d) => Date.parse(`${d}T00:00:00Z`);
  const span = t(end) - t(start);
  return span <= 0 ? 0 : Math.min(1, Math.max(0, (t(day) - t(start)) / span));
}

/** The fill of a heat map cell: the more, the darker, never fully white (a zero stays visible as a cell). */
export const heatFill = (value, max) => `color-mix(in srgb, var(--erp-chart-1) ${Math.round(8 + (max > 0 ? (value / max) * 82 : 0))}%, var(--erp-color-bg-surface))`;

// the series colours and the number format are the one chart theme of part 166.2 (U-08)
export { seriesColour, formatCount } from './theme.js';

/** Every chart read as a table: { columns: [label], rows: [[cell]] }. The accessible alternative and the source of the CSV. */
export function chartTable(type, d) {
  if (type === 'donut') return { columns: ['Slice', 'Value'], rows: d.slices.map((s) => [s.label, s.value]) };
  if (type === 'gauge') return { columns: ['Measure', 'Value', 'Target'], rows: d.value === null ? [] : [[d.title ?? 'Value', d.value, d.target ?? '']] };
  if (type === 'heatmap') return { columns: ['', ...d.cols], rows: d.rows.map((r, ri) => [r, ...d.cols.map((_, ci) => d.cells.find((c) => c.row === ri && c.col === ci)?.value ?? 0)]) };
  if (type === 'gantt') return { columns: ['Item', 'Start', 'End', 'Status'], rows: d.rows.map((r) => [r.label, r.start, r.end, r.status ?? '']) };
  if (type === 'scatter') return { columns: ['', d.xLabel ?? 'x', d.yLabel ?? 'y'], rows: d.points.map((pt) => [pt.label, pt.x, pt.y]) };
  return { columns: ['', ...d.series.map((s) => s.name)], rows: d.categories.map((c, i) => [c, ...d.series.map((s) => s.values[i] ?? '')]) };
}

/** CSV of a table. A cell that a spreadsheet would read as a formula is made text (formula injection), quotes and commas are escaped. */
export function toCsv({ columns, rows }) {
  const cell = (v) => {
    let t = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = `'${t}`;
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [columns, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

// the tooltip follows the pointer; near the right or bottom edge of the screen it opens on the other side, so it is never cut off on a phone (Part 12)
const TIP_W = 256;
const TIP_H = 64;
export const tipStyle = (tip, vw = globalThis.innerWidth ?? 1024, vh = globalThis.innerHeight ?? 768) => ({
  left: Math.max(4, tip.x + 12 + TIP_W > vw ? tip.x - 12 - TIP_W : tip.x + 12),
  top: Math.max(4, tip.y + 12 + TIP_H > vh ? tip.y - 12 - TIP_H : tip.y + 12),
});
