// The one chart theme (part 166.2, U-08): every chart of every module takes its series colours, number format and empty state from here, so
// a series looks the same on the cost report and on the dashboard. The colours are the UI v3 tokens --ui-c1 … --ui-c8 (src/client/ui-v3.css),
// which fall back to the design tokens --erp-chart-1 … 8; both follow the light, dark and high-contrast themes.

export const SERIES_COUNT = 8;

/** The colour of series number i (eight colours, then they repeat). */
export const seriesColour = (i) => { const n = (((i % SERIES_COUNT) + SERIES_COUNT) % SERIES_COUNT) + 1; return `var(--ui-c${n}, var(--erp-chart-${n}))`; };

/** A number in a tooltip, axis or legend, the Indian way (12,34,567.5). */
export const formatCount = (n) => (typeof n === 'number' ? n.toLocaleString('en-IN', { maximumFractionDigits: 1 }) : String(n ?? ''));

/**
 * An axis tick in Indian short form (Part 12): 15,00,00,000 is "15 Cr", 2,50,000 is "2.5 L", smaller numbers keep their grouping. Only the axis
 * is shortened, so a label fits the margin; the tooltip and the table give the full figure.
 */
export const formatAxis = (n) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n ?? '');
  const a = Math.abs(n);
  const short = (v, u) => `${Number(v.toFixed(2)).toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${u}`;
  if (a >= 1e7) return short(n / 1e7, 'Cr');
  if (a >= 1e5) return short(n / 1e5, 'L');
  return formatCount(n);
};

/** Whether a chart has nothing to draw: no category, no slice, no row, or only zeros and gaps. */
export function isEmptyChart(type, d) {
  if (!d) return true;
  if (type === 'gauge') return d.value === null || d.value === undefined;
  if (type === 'donut') return !d.slices?.length || d.slices.every((s) => !s.value);
  if (type === 'heatmap') return !d.rows?.length || !d.cols?.length;
  if (type === 'gantt') return !d.rows?.length;
  if (type === 'scatter') return !d.points?.length;
  return !d.categories?.length || !d.series?.length || d.series.every((s) => s.values.every((v) => v === null || v === undefined || v === 0));
}
