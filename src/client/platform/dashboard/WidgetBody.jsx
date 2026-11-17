import { currentPrefs } from '../i18n/index.js';
import { formatCompact, formatMoney } from '../../../shared/i18n/format.js';
import Chart from '../charts/Chart.jsx';
import Icon from '../design/Icon.jsx';
import { EmptyState } from '../feedback/states.jsx';
import { formatCount } from '../charts/scale.js';
import { useState } from 'react';
import { useFlagOn } from '../shell/api.js';
import { useDecideTask } from './api.js';

// What each kind of widget draws from the data its endpoint returned (part 03.07, FR-01). Nothing here holds a value of its own: a result
// with nothing in it is an empty state that says what is missing (BR-02).
const STATUS_WORD = { green: 'On track', amber: 'Needs attention', red: 'Late', neutral: '' };
const STATUS_ICON = { green: 'erp.state.approved', amber: 'erp.state.hold', red: 'erp.state.overdue' };
const EMPTY = {
  'approvals.list': ['Nothing is waiting for you', 'Requests that need your decision will appear here.'],
  'tasks.mine': ['No tasks yet', 'Tasks assigned to you will appear here once the task service is in use.'],
  'mentions.mine': ['No mentions', 'When someone mentions you in a comment on a record, it appears here.'],
  'projects.mine': ['No projects in your scope', 'The projects you can work in will appear here.'],
  'requests.overdue': ['Nothing is overdue', 'Requests that are past their required-by date appear here.'],
};

const Open = ({ to, onDrill, children, className = '' }) => (
  to ? <a className={className} href={to} onClick={(e) => { e.preventDefault(); onDrill(to); }}>{children}</a> : <span className={className}>{children}</span>
);

// a money figure: the whole amount below a lakh, then ₹ 2.32 L or ₹ 1.25 Cr (the whole amount stays in the tooltip and for screen readers)
const money = ({ value }) => (value === null || value === undefined ? '—' : Math.abs(Number(value)) >= 100000 ? formatCompact(String(value), currentPrefs()) : formatMoney(String(value), currentPrefs()));
const moneyFull = ({ value }) => (value === null || value === undefined ? '—' : formatMoney(String(value), currentPrefs()));

// the deviation from the target (part 166.5): the difference and its share of the target, with its sign
const deviation = (d) => {
  if (typeof d.value !== 'number' || typeof d.target !== 'number') return '';
  const diff = Math.round((d.value - d.target) * 100) / 100;
  const pct = d.target !== 0 ? ` (${diff >= 0 ? '+' : '−'}${Math.abs(Math.round((diff * 1000) / d.target) / 10)}%)` : '';
  return ` · deviation ${diff >= 0 ? '+' : '−'}${d.kind === 'money' ? money({ value: Math.abs(diff) }) : formatCount(Math.abs(diff))}${pct}`;
};

function Kpi({ data, onDrill }) {
  if (data.empty) return <EmptyState compact title={data.emptyTitle ?? 'Nothing to show'} message={data.emptyText ?? ''} />;
  if (data.masked) return <p className="muted wd-masked"><Icon name="erp.action.lock" size={16} /> Hidden for your role.</p>;
  const up = data.trendPct !== null && data.trendPct !== undefined && data.trendPct >= 0;
  return (
    <Open to={data.drill} onDrill={onDrill} className="wd-kpi">
      {data.subtitle && <span className="wd-kpi-sub muted small" data-testid="kpi-subtitle">{data.subtitle}</span>}
      <span className="wd-kpi-value" data-testid="kpi-value" title={data.kind === 'money' && data.value !== null && data.value !== undefined ? moneyFull(data) : undefined}>{data.value === null || data.value === undefined ? <><span aria-hidden="true">—</span><span className="sr-only">Not measured</span></> : data.kind === 'money' ? <><span aria-hidden="true">{money(data)}</span><span className="sr-only">{moneyFull(data)}</span></> : formatCount(data.value)}</span>
      {data.kind !== 'money' && data.unit && <span className="wd-kpi-unit">{data.unit}</span>}
      {data.trendPct !== null && data.trendPct !== undefined && (
        <span className={`wd-trend ${up ? 'is-up' : 'is-down'}`}>{up ? '▲' : '▼'} {Math.abs(data.trendPct)}% <span className="muted">vs the period before ({data.kind === 'money' ? money({ ...data, value: data.previous }) : formatCount(data.previous)})</span></span>
      )}
      {data.target !== null && data.target !== undefined && <span className="muted small" data-testid="kpi-target">Target {data.kind === 'money' ? money({ value: data.target }) : formatCount(data.target)}{deviation(data)}</span>}
      {STATUS_WORD[data.status] && <span className={`wd-rag is-${data.status}`}><Icon name={STATUS_ICON[data.status]} size={14} /> {STATUS_WORD[data.status]}</span>}
      {data.note && <span className="muted small">{data.note}</span>}
    </Open>
  );
}

function Rows({ code, data, onDrill }) {
  if (data.rows.length === 0) { const [t, m] = EMPTY[code] ?? ['Nothing to show', 'There is nothing in this list for you now.']; return <EmptyState compact title={t} message={m} />; }
  return (
    <>
      <ul className="wd-rows">
        {data.rows.map((r) => (
          <li key={r.id}>
            <Open to={r.drill} onDrill={onDrill} className="wd-row">
              <span className="wd-row-title">{r.title}</span>
              <span className="wd-row-sub muted small">{r.subtitle}{r.days > 0 ? ` (${r.days} day${r.days === 1 ? '' : 's'} late)` : ''}</span>
              {r.due && <span className={`wd-due small${r.overdue ? ' is-late' : ''}`}>{r.overdue ? 'Past its time' : `Due ${new Date(r.due).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}`}</span>}
            </Open>
          </li>
        ))}
      </ul>
      {data.total > data.rows.length && data.drill && <Open to={data.drill} onDrill={onDrill} className="small">See all {data.total}</Open>}
    </>
  );
}

function Table({ data, onDrill }) {
  if (data.rows.length === 0) return <EmptyState compact title="Nothing in this period" message="Change the period or project above to see more." />;
  return (
    <div className="table-scroll">
      <table className="wd-table">
        <thead><tr>{data.columns.map((c) => <th key={c.key} scope="col" className={c.align === 'end' ? 'num' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={i}>{data.columns.map((c, ci) => (
              <td key={c.key} className={c.align === 'end' ? 'num' : ''}>{ci === 0 && r.drill ? <Open to={r.drill} onDrill={onDrill}>{r[c.key]}</Open> : r[c.key]}</td>
            ))}</tr>
          ))}
        </tbody>
      </table>
      {data.masked && <p className="muted small">Values are hidden for your role; the rows are ordered by the date needed.</p>}
    </div>
  );
}

/** Sites as a plain plot of their positions (no map tiles are downloaded): each point is a link to the site's project. */
function SiteMap({ data, onDrill }) {
  if (data.points.length === 0) return <EmptyState compact title="No site positions" message="Sites appear here once they have a latitude and longitude." />;
  const lats = data.points.map((p) => p.lat);
  const lngs = data.points.map((p) => p.lng);
  const [la0, la1] = [Math.min(...lats), Math.max(...lats)];
  const [ln0, ln1] = [Math.min(...lngs), Math.max(...lngs)];
  const x = (v) => 20 + (ln1 === ln0 ? 0.5 : (v - ln0) / (ln1 - ln0)) * 280;
  const y = (v) => 130 - (la1 === la0 ? 0.5 : (v - la0) / (la1 - la0)) * 110;
  return (
    <>
      <svg viewBox="0 0 320 150" className="ch-svg" role="img" aria-label={`${data.points.length} site positions, north is up. The list below has the same sites.`} focusable="false">
        <rect x="1" y="1" width="318" height="148" rx="6" fill="var(--erp-color-bg-surface-sunken)" stroke="var(--erp-color-border-subtle)" />
        {data.points.map((p) => (
          <a key={p.id} href={p.drill} onClick={(e) => { e.preventDefault(); onDrill(p.drill); }}>
            <circle cx={x(p.lng)} cy={y(p.lat)} r="6" fill="var(--erp-chart-1)" stroke="var(--erp-color-bg-surface)" strokeWidth="2"><title>{p.title}</title></circle>
            <text x={x(p.lng) + 9} y={y(p.lat) + 4} fontSize="10" fill="var(--erp-color-text-secondary)">{p.label}</text>
          </a>
        ))}
      </svg>
      <ul className="wd-sitelist small muted">{data.points.map((p) => <li key={p.id}>{p.title}, {p.lat.toFixed(3)}, {p.lng.toFixed(3)}</li>)}</ul>
    </>
  );
}

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const monthLabel = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shiftMonth = (m, by) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)) - 1 + by, 1)); return d.toISOString().slice(0, 7); };

function Calendar({ data, onDrill, setLocal }) {
  const first = new Date(`${data.month}-01T00:00:00Z`);
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${data.month}-${String(i + 1).padStart(2, '0')}`)];
  const at = (d) => data.events.filter((e) => e.date === d);
  return (
    <div className="wd-cal">
      <div className="wd-cal-head">
        <button type="button" className="btn btn-small" aria-label="Previous month" onClick={() => setLocal({ month: shiftMonth(data.month, -1) })}><Icon name="erp.action.previous" size={14} /></button>
        <strong>{monthLabel(data.month)}</strong>
        <button type="button" className="btn btn-small" aria-label="Next month" onClick={() => setLocal({ month: shiftMonth(data.month, 1) })}><Icon name="erp.action.next" size={14} /></button>
      </div>
      <div className="wd-cal-grid" role="grid" aria-label={monthLabel(data.month)}>
        <div className="wd-cal-row" role="row">{WEEK.map((d) => <span key={d} className="wd-cal-dow" role="columnheader">{d}</span>)}</div>
        {Array.from({ length: Math.ceil(cells.length / 7) }, (_, w) => (
          <div key={w} className="wd-cal-row" role="row">
            {cells.slice(w * 7, w * 7 + 7).map((d, i) => (d === null ? <span key={`b${w}-${i}`} role="gridcell" /> : (
              <span key={d} role="gridcell" className={`wd-cal-day${d === data.today ? ' is-today' : ''}${at(d).length ? ' has-event' : ''}`} aria-label={`${d}${at(d).length ? `: ${at(d).map((e) => e.label).join('; ')}` : ''}`}>{Number(d.slice(8))}</span>
            )))}
          </div>
        ))}
      </div>
      {data.events.length === 0 ? <p className="muted small">Nothing is scheduled this month.</p> : (
        <ul className="wd-events small">
          {data.events.map((e, i) => <li key={`${e.date}-${i}`} className={`is-${e.kind}`}><span className="muted">{e.date.slice(8)} {WEEK[(new Date(`${e.date}T00:00:00Z`).getUTCDay() + 6) % 7]}</span> <Open to={e.drill} onDrill={onDrill}>{e.label}</Open></li>)}
        </ul>
      )}
    </div>
  );
}

function Actions({ data, onDrill }) {
  if (data.actions.length === 0) return <EmptyState compact title="No quick actions" message="Actions you can start appear here." />;
  return <div className="wd-actions">{data.actions.map((a) => <a key={a.route} className="btn" href={a.route} onClick={(e) => { e.preventDefault(); onDrill(a.route); }}>{a.icon && <Icon name={a.icon} size={16} />}{a.label}</a>)}</div>;
}

/** Top-N (part 166.5): rows with a name, a value and a bar against the largest; each row opens its record or list. */
function TopN({ data, onDrill }) {
  if (data.rows.length === 0) return <EmptyState compact title={data.emptyTitle ?? 'Nothing to rank'} message={data.emptyText ?? 'Rows appear here once there are figures in the period.'} />;
  const max = Math.max(...data.rows.map((r) => Math.abs(Number(r.value) || 0)), 1);
  const show = (v) => (data.kind === 'money' ? money({ value: v }) : data.kind === 'pct' ? `${formatCount(v)}%` : formatCount(v));
  return (
    <ol className="wd-topn" data-testid="topn">
      {data.rows.map((r, i) => (
        <li key={r.id ?? `${r.label}-${i}`}>
          <Open to={r.drill} onDrill={onDrill} className="wd-topn-row">
            <span className="wd-topn-label">{r.label}{r.sub && <span className="muted small"> {r.sub}</span>}</span>
            <strong className="wd-topn-value" title={data.kind === 'money' ? moneyFull({ value: r.value }) : undefined}>{show(Number(r.value) || 0)}</strong>
            <span className="wd-topn-bar" aria-hidden="true"><span className={Number(r.value) < 0 ? 'is-neg' : ''} style={{ width: `${Math.round((Math.abs(Number(r.value) || 0) / max) * 100)}%` }} /></span>
          </Open>
        </li>
      ))}
    </ol>
  );
}

/** To-do and approvals (part 166.5): what waits for the person's decision, with its key facts; Approve, or Return with a reason. */
function Todo({ data, onDrill }) {
  const decide = useDecideTask();
  const [returning, setReturning] = useState(null);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState(null);
  if (data.rows.length === 0) return <EmptyState compact title="Nothing is waiting for you" message="Approvals that need your decision appear here." />;
  const act = (row, action, comment) => decide.mutate({ taskId: row.taskId, action, comment }, { onSuccess: () => { setDone(`${row.title}: ${action === 'approve' ? 'approved' : 'returned'}.`); setReturning(null); setReason(''); } });
  return (
    <>
      {done && <p className="wd-done small" role="status">{done}</p>}
      {decide.isError && <p className="field-error small" role="alert">{decide.error?.message}</p>}
      <ul className="wd-todo" data-testid="todo">
        {data.rows.map((r) => (
          <li key={r.taskId}>
            <Open to={r.drill} onDrill={onDrill} className="wd-row"><span className="wd-row-title">{r.title}</span></Open>
            {r.facts?.length > 0 && <span className="wd-todo-facts muted small">{r.facts.join(' · ')}</span>}
            {returning === r.taskId ? (
              <form className="wd-todo-return" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) act(r, 'return', reason.trim()); }}>
                <label className="small">Reason for returning<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} aria-invalid={!reason.trim()} /></label>
                <button type="submit" className="btn btn-small" disabled={!reason.trim() || decide.isPending}>Return</button>
                <button type="button" className="btn btn-small" onClick={() => { setReturning(null); setReason(''); }}>Cancel</button>
              </form>
            ) : (
              <span className="wd-todo-actions">
                <button type="button" className="btn btn-small btn-primary" disabled={decide.isPending} onClick={() => act(r, 'approve')} aria-label={`Approve ${r.title}`}>Approve</button>
                <button type="button" className="btn btn-small" disabled={decide.isPending} onClick={() => setReturning(r.taskId)} aria-label={`Return ${r.title}`}>Return</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {data.total > data.rows.length && data.drill && <Open to={data.drill} onDrill={onDrill} className="small">See all {data.total}</Open>}
    </>
  );
}

const isEmptyChart = (type, d) => (type === 'donut' ? d.slices.length === 0 || d.slices.every((s) => s.value === 0)
  : type === 'gauge' ? d.value === null
    : type === 'heatmap' ? d.rows.length === 0
      : type === 'gantt' ? d.rows.length === 0
        : type === 'scatter' ? d.points.length === 0
          : d.categories.length === 0);
const CHART_TYPES = new Set(['bar', 'stacked', 'line', 'area', 'donut', 'gauge', 'heatmap', 'gantt', 'scatter']);

/** The body of a widget by its type. `setLocal` merges settings of the widget's own into its request (the calendar's month). */
export default function WidgetBody({ widget, result, onDrill, setLocal }) {
  const v5 = useFlagOn('ff.ui.p16605'); // part 166.5: "Show as table" on every chart
  const d = result.data;
  const { type, code, title } = widget;
  if (d?.masked && type !== 'kpi') return <p className="muted wd-masked"><Icon name="erp.action.lock" size={16} /> Hidden for your role.</p>;
  if (type === 'kpi') return <Kpi data={d} onDrill={onDrill} />;
  if (CHART_TYPES.has(type)) {
    if (isEmptyChart(type, d)) return <EmptyState compact title={type === 'gauge' ? 'Nothing decided yet' : 'Nothing in this period'} message={type === 'gauge' ? 'The gauge appears once approvals are decided in the period.' : 'Change the period or project above to see more.'} />;
    return <Chart type={type} data={d} title={title} onDrill={onDrill} exportName={code.replace(/\./g, '-')} tableSwitch={v5} />;
  }
  if (type === 'list' || type === 'alerts') return <Rows code={code} data={d} onDrill={onDrill} />;
  if (type === 'table') return <Table data={d} onDrill={onDrill} />;
  if (type === 'topn') return <TopN data={d} onDrill={onDrill} />;
  if (type === 'todo') return <Todo data={d} onDrill={onDrill} />;
  if (type === 'map') return <SiteMap data={d} onDrill={onDrill} />;
  if (type === 'calendar') return <Calendar data={d} onDrill={onDrill} setLocal={setLocal} />;
  if (type === 'actions') return <Actions data={d} onDrill={onDrill} />;
  if (type === 'notice') return d.text ? <div className="wd-notice">{d.title && <strong>{d.title}</strong>}<p>{d.text}</p></div> : <EmptyState compact title="No notice written" message="Open the layout editor and write the notice." />;
  return <p className="muted">This widget type is not available.</p>;
}
