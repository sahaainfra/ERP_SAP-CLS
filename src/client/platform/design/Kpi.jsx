import Icon from './Icon.jsx';
import { abbreviateINR, exactINR, toAmount, trendOf } from './kpi-format.js';
import { navigateTo } from '../../modules/core/pages/ui.jsx';

// Key figures (part 166.2, U-02 and U-07; UI v3 standard §3, overview page): a row of tiles, each with a label, the value and its unit, an icon
// that says what kind of figure it is (money, quantity, time, safety, quality, people, risk — the "kpi" group of the icon registry), a tone, a
// trend against the previous period and, when there is one, a link to the page behind it. Pages never lay key figures out in the form grid
// (lint rule erp/kpi-in-form-grid).

/** The kinds of figure and their registry icon. */
export const KPI_KINDS = ['money', 'quantity', 'count', 'percent', 'time', 'safety', 'quality', 'people', 'risk', 'capacity'];
const iconOf = (kind) => (KPI_KINDS.includes(kind) ? `erp.kpi.${kind}` : null);
const TONES = new Set(['neutral', 'info', 'success', 'warning', 'error']);
// the status words the older Tile took, mapped onto the tones
const TONE_OF = { ok: 'success', good: 'success', bad: 'error', danger: 'error', warn: 'warning', red: 'error', amber: 'warning', green: 'success' };

function Trend({ trend, value, amount }) {
  const t = trendOf(amount ?? value, trend.previous, trend.better);
  if (!t) return null;
  const arrow = { up: '▲', down: '▼', flat: '=' }[t.direction];
  const tone = t.good === null ? 'neutral' : t.good ? 'success' : 'error';
  const label = trend.label ?? 'vs previous';
  return (
    <span className={`kpi-trend kpi-trend-${tone}`} data-direction={t.direction}>
      <span aria-hidden="true">{arrow}</span> {t.pct === null ? '' : `${Math.abs(t.pct)}% `}<span className="kpi-trend-label">{label}</span>
    </span>
  );
}

/**
 * `<KpiTile label="Certified" kind="money" amount={x.certified} value={money(x.certified)} />`.
 *
 * - `value`: the figure as the page formats it (exact). `amount`: the raw number of a money figure; when it is a lakh or more the tile shows
 *   it shortened (₹ 2.43 Cr) and keeps `value` (or the exact rupees) in the tooltip and for screen readers.
 * - `kind`: one of KPI_KINDS (picks the icon); `icon`: a registry key instead. `unit`: shown after the value (m³, days, %).
 * - `tone`: neutral, info, success, warning or error (a few older words are understood). `trend`: { previous, better: 'up' | 'down', label }.
 * - `to`: the page behind the figure (keep the filters in it); `onClick`: the tile is a button instead (a filter of the page it is on), and
 *   `pressed` says whether that filter is on. `testid` is on the tile, `valueTestid` on the value.
 * - `children`: a second line (a note, a badge).
 */
export function KpiTile({ label, value, amount, kind, icon, unit, tone = 'neutral', trend, to, onClick, pressed, testid, valueTestid, children, ...rest }) {
  const toneKey = TONES.has(tone) ? tone : TONE_OF[tone] ?? 'neutral';
  const n = kind === 'money' ? toAmount(amount ?? value) : null;
  const shortText = n !== null && Math.abs(n) >= 1e5 ? abbreviateINR(n) : null;
  const exact = shortText ? (typeof value === 'string' || typeof value === 'number' ? String(value) : exactINR(n)) : null;
  const glyph = icon ?? iconOf(kind);
  const body = (
    <>
      <span className="kpi-head">
        {glyph && <span className="kpi-icon"><Icon name={glyph} size={20} /></span>}
        <span className="tile-label kpi-label">{label}</span>
      </span>
      <span className="kpi-figure">
        <span className="tile-value kpi-value" data-testid={valueTestid} title={exact ?? undefined}>
          {shortText ? <><span aria-hidden="true">{shortText}</span><span className="sr-only">{exact}</span></> : (value ?? '—')}
        </span>
        {unit && <span className="kpi-unit">{unit}</span>}
      </span>
      {trend && <Trend trend={trend} value={value} amount={amount} />}
      {children && <span className="kpi-extra">{children}</span>}
    </>
  );
  const cls = `tile kpi-tile kpi-tone-${toneKey} tile-${tone}`;
  if (onClick) return <button type="button" className={`${cls} kpi-button`} aria-pressed={pressed} onClick={onClick} data-testid={testid} data-kind={kind} {...rest}>{body}</button>;
  return (
    <div className={cls} data-testid={testid} data-kind={kind} {...rest}>
      {to ? <a className="kpi-link" href={to} onClick={(e) => { e.preventDefault(); navigateTo(to); }}>{body}<span className="kpi-chevron" aria-hidden="true">›</span></a> : body}
    </div>
  );
}

/** The row the tiles sit in: a responsive grid, two columns on a phone, as many as fit on a desktop. */
export function KpiRow({ children, testid, label, className = '', ...rest }) {
  return <div className={`tiles kpi-row ${className}`.trim()} role="group" aria-label={label} data-testid={testid} {...rest}>{children}</div>;
}
