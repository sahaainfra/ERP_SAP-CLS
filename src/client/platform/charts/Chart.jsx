import { useId, useRef, useState } from 'react';
import { arcPath, areaPath, bands, chartTable, dayFraction, formatCount, heatFill, linePath, niceTicks, seriesColour, sliceAngles, toCsv } from './scale.js';
import { downloadCsv } from '../../modules/core/pages/ui.jsx';

// The chart library (part 03.07, FR-08). Every chart is drawn in SVG from the design tokens (--erp-chart-1..8 and the status colours, so
// light and dark themes both work), has a tooltip on hover and focus, a legend, the same data as a table (the accessible alternative),
// and exports to CSV and PNG. A mark that has an address (`drill`) is a link: click, Enter or Space opens it.
const W = 480;
const H = 240;
const PAD = { l: 48, r: 10, t: 12, b: 34 };
const short = (s, n = 12) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const TEXT = 'var(--erp-color-text-secondary)';

function Mark({ label, drill, onDrill, setTip, children }) {
  const go = drill && onDrill ? () => onDrill(drill) : null;
  const show = (e) => setTip({ label, x: e.clientX, y: e.clientY });
  const showFocus = (e) => { const r = e.currentTarget.getBoundingClientRect(); setTip({ label, x: r.left + r.width / 2, y: r.top }); };
  return (
    <g
      className={go ? 'ch-mark is-link' : 'ch-mark'} tabIndex={go ? 0 : undefined} role={go ? 'link' : undefined} aria-label={go ? label : undefined} data-drill={drill || undefined}
      onMouseMove={show} onMouseLeave={() => setTip(null)} onFocus={go ? showFocus : undefined} onBlur={() => setTip(null)} onClick={go ?? undefined}
      onKeyDown={go ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } } : undefined}
    >
      {children}
    </g>
  );
}

function Axes({ ticks, plotW, plotH, y }) {
  return (
    <g aria-hidden="true">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={PAD.l + plotW} y1={y(t)} y2={y(t)} stroke="var(--erp-color-border-subtle)" strokeWidth="1" />
          <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={TEXT}>{formatCount(t)}</text>
        </g>
      ))}
      <line x1={PAD.l} x2={PAD.l + plotW} y1={PAD.t + plotH} y2={PAD.t + plotH} stroke="var(--erp-color-border-strong)" strokeWidth="1" />
    </g>
  );
}

function Cartesian({ kind, data, onDrill, setTip }) {
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const n = data.categories.length;
  const stacked = kind === 'stacked';
  const sums = data.categories.map((_, i) => data.series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const top = stacked ? Math.max(...sums, 0) : Math.max(...data.series.flatMap((s) => s.values), 0);
  const { max, ticks } = niceTicks(top, 4, data.series.every((x) => x.values.every(Number.isInteger)));
  const y = (v) => PAD.t + plotH - (v / max) * plotH;
  const cols = bands(n, plotW, kind === 'bar' || stacked ? 0.3 : 0);
  const centre = (i) => PAD.l + cols[i].x + cols[i].w / 2;
  const drillOf = (s, i) => s.drill?.[i] ?? data.drill;
  const unit = data.unit ? ` ${data.unit}` : '';
  const skip = Math.ceil(n / 8);
  return (
    <>
      <Axes ticks={ticks} plotW={plotW} plotH={plotH} y={y} />
      {data.categories.map((c, i) => (i % skip === 0 ? <text key={c} x={centre(i)} y={H - PAD.b + 16} textAnchor="middle" fontSize="11" fill={TEXT} aria-hidden="true">{short(c, 10)}</text> : null))}
      {(kind === 'bar' || stacked) && data.categories.map((c, i) => {
        let base = 0;
        return data.series.map((s, si) => {
          const v = s.values[i] ?? 0;
          const slot = stacked ? cols[i].w : cols[i].w / data.series.length;
          const x = PAD.l + cols[i].x + (stacked ? 0 : slot * si);
          const y0 = stacked ? y(base + v) : y(v);
          const h = (stacked ? y(base) : y(0)) - y0;
          base += v;
          return v === 0 ? null : (
            <Mark key={`${c}-${si}`} label={`${c}, ${s.name}: ${formatCount(v)}${unit}`} drill={drillOf(s, i)} onDrill={onDrill} setTip={setTip}>
              <rect x={x} y={y0} width={Math.max(1, slot)} height={Math.max(1, h)} rx="2" fill={seriesColour(si)} />
            </Mark>
          );
        });
      })}
      {(kind === 'line' || kind === 'area') && data.series.map((s, si) => {
        // a missing value (null) is a gap in the line, not a zero (S-curves: the actual stops at the data date, the forecast starts there)
        const pts = s.values.map((v, i) => (v == null ? null : [centre(i), y(v)]));
        const runs = []; for (const p of pts) { if (p) { if (runs.at(-1)?.open) runs.at(-1).pts.push(p); else runs.push({ open: true, pts: [p] }); } else if (runs.at(-1)) runs.at(-1).open = false; }
        return (
          <g key={s.name}>
            {kind === 'area' && runs.map((r, ri) => <path key={`a${ri}`} d={areaPath(r.pts, PAD.t + plotH)} fill={seriesColour(si)} fillOpacity="0.18" aria-hidden="true" />)}
            {runs.map((r, ri) => <path key={`l${ri}`} d={linePath(r.pts)} fill="none" stroke={seriesColour(si)} strokeWidth="2.5" strokeLinejoin="round" aria-hidden="true" />)}
            {pts.map((pt, i) => pt && (
              <Mark key={data.categories[i]} label={`${data.categories[i]}, ${s.name}: ${formatCount(s.values[i])}${unit}`} drill={drillOf(s, i)} onDrill={onDrill} setTip={setTip}>
                <circle cx={pt[0]} cy={pt[1]} r={n > 24 ? 2 : 4} fill="var(--erp-color-bg-surface)" stroke={seriesColour(si)} strokeWidth="2" />
              </Mark>
            ))}
          </g>
        );
      })}
    </>
  );
}

function Donut({ data, onDrill, setTip }) {
  const angles = sliceAngles(data.slices.map((s) => s.value));
  const total = data.slices.reduce((a, s) => a + s.value, 0);
  return (
    <g transform="translate(120 120)">
      {data.slices.map((s, i) => (
        <Mark key={s.label} label={`${s.label}: ${formatCount(s.value)} (${Math.round(angles[i].share * 100)}%)`} drill={s.drill} onDrill={onDrill} setTip={setTip}>
          <path d={arcPath(0, 0, 100, 62, angles[i].a0, angles[i].a1)} fill={seriesColour(i)} stroke="var(--erp-color-bg-surface)" strokeWidth="2" />
        </Mark>
      ))}
      <text y="2" textAnchor="middle" fontSize="28" fontWeight="700" fill="var(--erp-color-text-primary)" aria-hidden="true">{formatCount(total)}</text>
      <text y="22" textAnchor="middle" fontSize="12" fill={TEXT} aria-hidden="true">{data.unit ?? 'total'}</text>
    </g>
  );
}

const RAG = { green: 'var(--erp-color-status-success-solid)', amber: 'var(--erp-color-status-warning-solid)', red: 'var(--erp-color-status-error-solid)' };
const RAG_WORD = { green: 'On target', amber: 'Close to target', red: 'Below target' };

function Gauge({ data }) {
  const frac = Math.min(1, Math.max(0, (data.value - (data.min ?? 0)) / ((data.max ?? 100) - (data.min ?? 0))));
  const tFrac = data.target === null || data.target === undefined ? null : Math.min(1, Math.max(0, (data.target - (data.min ?? 0)) / ((data.max ?? 100) - (data.min ?? 0))));
  const at = (f, r) => { const a = -Math.PI + f * Math.PI; return [Math.cos(a) * r, Math.sin(a) * r]; };
  const [tx1, ty1] = tFrac === null ? [0, 0] : at(tFrac, 62);
  const [tx2, ty2] = tFrac === null ? [0, 0] : at(tFrac, 108);
  return (
    <g transform="translate(120 128)">
      <path d={arcPath(0, 0, 100, 70, -Math.PI / 2, Math.PI / 2)} fill="var(--erp-color-bg-surface-sunken)" />
      {frac > 0 && <path d={arcPath(0, 0, 100, 70, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI)} fill={RAG[data.status] ?? seriesColour(0)} />}
      {tFrac !== null && <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} stroke="var(--erp-color-text-primary)" strokeWidth="3" />}
      <text y="-8" textAnchor="middle" fontSize="30" fontWeight="700" fill="var(--erp-color-text-primary)">{formatCount(data.value)}{data.unit}</text>
      <text y="14" textAnchor="middle" fontSize="12" fill={TEXT}>{data.target === null || data.target === undefined ? '' : `Target ${formatCount(data.target)}${data.unit}`}</text>
    </g>
  );
}

function Heatmap({ data, onDrill, setTip }) {
  const left = 70;
  const top = 26;
  const cw = (W - left - 8) / data.cols.length;
  const ch = Math.min(28, (H - top - 8) / Math.max(1, data.rows.length));
  const max = Math.max(...data.cells.map((c) => c.value), 0);
  return (
    <g>
      {data.cols.map((c, ci) => <text key={c} x={left + ci * cw + cw / 2} y={16} textAnchor="middle" fontSize="11" fill={TEXT} aria-hidden="true">{short(c, 12)}</text>)}
      {data.rows.map((r, ri) => <text key={r} x={left - 6} y={top + ri * ch + ch / 2 + 4} textAnchor="end" fontSize="11" fill={TEXT} aria-hidden="true">{short(r, 10)}</text>)}
      {data.cells.map((c) => (
        <Mark key={`${c.row}-${c.col}`} label={`${data.rows[c.row]}, ${data.cols[c.col]}: ${formatCount(c.value)}${data.unit ? ` ${data.unit}` : ''}`} drill={c.value > 0 ? c.drill : null} onDrill={onDrill} setTip={setTip}>
          <rect x={left + c.col * cw + 1} y={top + c.row * ch + 1} width={cw - 2} height={ch - 2} rx="3" fill={heatFill(c.value, max)} />
          <text x={left + c.col * cw + cw / 2} y={top + c.row * ch + ch / 2 + 4} textAnchor="middle" fontSize="11" fill={max > 0 && c.value / max > 0.85 ? 'var(--erp-color-text-on-primary)' : 'var(--erp-color-text-primary)'}>{formatCount(c.value)}</text>
        </Mark>
      ))}
    </g>
  );
}

const GANTT_STATUS = { Draft: 3, Submitted: 0 };
function Gantt({ data, onDrill, setTip }) {
  const left = 86;
  const start = data.rows.map((r) => r.start).sort()[0];
  const end = data.rows.map((r) => r.end).sort().at(-1);
  const rowH = Math.min(26, (H - 40) / Math.max(1, data.rows.length));
  const w = W - left - 10;
  return (
    <g>
      <text x={left} y={H - 12} fontSize="11" fill={TEXT} aria-hidden="true">{start}</text>
      <text x={W - 10} y={H - 12} fontSize="11" textAnchor="end" fill={TEXT} aria-hidden="true">{end}</text>
      {data.rows.map((r, i) => {
        const x0 = left + dayFraction(r.start, start, end) * w;
        const x1 = left + dayFraction(r.end, start, end) * w;
        return (
          <Mark key={`${r.label}-${i}`} label={`${r.label}: ${r.start} to ${r.end}${r.status ? `, ${r.status.toLowerCase()}` : ''}`} drill={r.drill} onDrill={onDrill} setTip={setTip}>
            <text x={left - 6} y={12 + i * rowH + rowH / 2} textAnchor="end" fontSize="11" fill={TEXT}>{short(r.label, 12)}</text>
            <rect x={x0} y={12 + i * rowH + 3} width={Math.max(6, x1 - x0)} height={rowH - 6} rx="3" fill={seriesColour(GANTT_STATUS[r.status] ?? 1)} />
          </Mark>
        );
      })}
    </g>
  );
}

/** The legend: what each colour means, with the value where the chart has one per colour. */
function Legend({ type, data }) {
  const items = type === 'donut' ? data.slices.map((s, i) => ({ label: s.label, value: s.value, i }))
    : type === 'heatmap' || type === 'gauge' ? []
      : type === 'gantt' ? [...new Set(data.rows.map((r) => r.status ?? 'Open'))].map((label) => ({ label, i: GANTT_STATUS[label] ?? 1 }))
        : data.series.length > 1 ? data.series.map((s, i) => ({ label: s.name, i })) : [];
  if (type === 'gauge') return <p className="ch-legend muted small"><span className="ch-rag" style={{ background: RAG[data.status] }} aria-hidden="true" />{RAG_WORD[data.status] ?? ''}{data.decided ? `, from ${data.decided} decided approval${data.decided === 1 ? '' : 's'}` : ''}</p>;
  if (type === 'heatmap') return <p className="ch-legend muted small">Darker means more.</p>;
  if (items.length === 0) return null;
  return (
    <ul className="ch-legend" aria-label="Legend">
      {items.map((it) => <li key={it.label}><span className="ch-swatch" style={{ background: seriesColour(it.i) }} aria-hidden="true" />{it.label}{it.value !== undefined ? <strong>{formatCount(it.value)}</strong> : null}</li>)}
    </ul>
  );
}

/** Draw an SVG as a PNG: the colours the page resolves from its tokens are written into the copy, so it looks the same away from the page. */
export async function exportPng(svg, filename) {
  const style = getComputedStyle(svg);
  const copy = svg.cloneNode(true);
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', String(svg.viewBox.baseVal.width));
  copy.setAttribute('height', String(svg.viewBox.baseVal.height));
  copy.setAttribute('font-family', style.fontFamily);
  const bg = style.getPropertyValue('--erp-color-bg-surface').trim() || 'Canvas';
  const resolve = (t) => t.replace(/var\((--[\w-]+)\)/g, (_, name) => style.getPropertyValue(name).trim() || 'currentColor');
  const markup = resolve(new XMLSerializer().serializeToString(copy)).replace('>', `><rect width="100%" height="100%" fill="${bg}"/>`);
  const img = new Image();
  const loaded = new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await loaded;
  const canvas = document.createElement('canvas');
  canvas.width = svg.viewBox.baseVal.width * 2;
  canvas.height = svg.viewBox.baseVal.height * 2;
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((ok) => { canvas.toBlob(ok, 'image/png'); });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

/**
 * One chart. `type` is bar, stacked, line, area, donut, gauge, heatmap or gantt; `data` is what the widget's endpoint returned.
 * `onDrill(address)` is called for a mark that has one.
 */
export default function Chart({ type, data, title, onDrill, exportName = 'chart' }) {
  const id = useId();
  const svgRef = useRef(null);
  const [tip, setTip] = useState(null);
  const table = chartTable(type, data);
  const pointCount = table.rows.length;
  const body = type === 'donut' ? <Donut data={data} onDrill={onDrill} setTip={setTip} />
    : type === 'gauge' ? <Gauge data={data} />
      : type === 'heatmap' ? <Heatmap data={data} onDrill={onDrill} setTip={setTip} />
        : type === 'gantt' ? <Gantt data={data} onDrill={onDrill} setTip={setTip} />
          : <Cartesian kind={type} data={data} onDrill={onDrill} setTip={setTip} />;
  const box = type === 'donut' ? '0 0 240 240' : type === 'gauge' ? '0 0 240 150' : `0 0 ${W} ${H}`;
  return (
    <figure className="ch" data-chart={type}>
      <svg ref={svgRef} viewBox={box} role="group" aria-roledescription="chart" aria-labelledby={`${id}-t`} focusable="false" className="ch-svg">
        <title id={`${id}-t`}>{`${title}. ${pointCount} ${pointCount === 1 ? 'row' : 'rows'}; the same figures are in the table below.`}</title>
        {body}
      </svg>
      {tip && <div className="ch-tip" role="status" style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.label}</div>}
      <Legend type={type} data={data} />
      <figcaption className="ch-foot">
        <details className="ch-table">
          <summary>View as table</summary>
          <div className="table-scroll">
            <table>
              <caption className="sr-only">{title}</caption>
              <thead><tr>{table.columns.map((c, i) => <th key={`${c}-${i}`} scope="col">{c}</th>)}</tr></thead>
              <tbody>{table.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => (ci === 0 ? <th key={ci} scope="row">{String(c)}</th> : <td key={ci}>{typeof c === 'number' ? formatCount(c) : String(c ?? '')}</td>))}</tr>)}</tbody>
            </table>
          </div>
        </details>
        <span className="ch-export">
          <button type="button" className="btn btn-small" onClick={() => downloadCsv(`${exportName}.csv`, `\uFEFF${toCsv(table)}`)}>CSV</button>
          <button type="button" className="btn btn-small" onClick={() => exportPng(svgRef.current, `${exportName}.png`)}>PNG</button>
        </span>
      </figcaption>
    </figure>
  );
}
