import { Component, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../design/Icon.jsx';
import { ErrorState, Skeleton } from '../feedback/states.jsx';
import WidgetBody from './WidgetBody.jsx';
import { useWidgetData } from './api.js';
import { useFlagOn } from '../shell/api.js';
import { moveBy, moveTo, removeItem, resizeItem, setParams, spanAt, updatedText, widgetQuery, withDashFilters } from './layout.js';

// The pieces a dashboard is made of (part 03.07): the global filter bar, a widget in its frame and the grid that lays the frames out.
// Used by My Work, the Requests Overview and the Dashboard Designer's preview.

/** Project, site and period (financial-year presets) that every widget of the dashboard follows (FR-04). */
export function FilterBar({ filters, onChange, options, presets }) {
  const sites = (options?.sites ?? []).filter((s) => s.projectId === filters.projectId);
  const set = (patch) => onChange({ ...filters, ...patch });
  return (
    <form className="dash-filters" aria-label="Dashboard filters" onSubmit={(e) => e.preventDefault()}>
      <label>Project
        <select value={filters.projectId ?? ''} onChange={(e) => set({ projectId: e.target.value ? Number(e.target.value) : null, siteId: null })}>
          <option value="">All my projects</option>
          {(options?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
        </select>
      </label>
      <label>Site
        <select value={filters.siteId ?? ''} disabled={!filters.projectId} onChange={(e) => set({ siteId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">All sites</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}
        </select>
      </label>
      <label>Period
        <select value={filters.preset} onChange={(e) => set({ preset: e.target.value })}>
          {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          <option value="custom">Custom dates</option>
        </select>
      </label>
      {filters.preset === 'custom' && (
        <>
          <label>From<input type="date" value={filters.from ?? ''} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} /></label>
          <label>To<input type="date" value={filters.to ?? ''} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} /></label>
        </>
      )}
    </form>
  );
}

const SETTINGS = {
  'notice.text': (params, set) => (
    <>
      <label>Title (optional)<input value={params.title ?? ''} maxLength={80} onChange={(e) => set({ ...params, title: e.target.value })} /></label>
      <label>Notice<textarea value={params.text ?? ''} maxLength={1000} rows={3} aria-invalid={!params.text} onChange={(e) => set({ ...params, text: e.target.value })} /></label>
      {!params.text && <span className="field-error">Write the notice</span>}
    </>
  ),
  'requests.top': (params, set) => (
    <label>How many rows<input type="number" min={3} max={20} value={params.limit ?? 5} onChange={(e) => set({ ...params, limit: Math.min(20, Math.max(3, Number(e.target.value) || 5)) })} /></label>
  ),
};

/** A card that fails to draw says so in its own frame; the rest of the page stays (part 166.5). */
class CardBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p className="muted small" role="status" data-testid="card-failed">This card could not be drawn. Refresh it, or open the list behind it.</p> : this.props.children; }
}

/** Card sizes on the 12-column grid (part 166.5, FR-01): S a quarter, M a half, L two thirds, XL the whole width. */
export const CARD_SIZES = [['S', 3], ['M', 6], ['L', 8], ['XL', 12]];

/** One widget: title, when it was last read, refresh and open, and its body in the standard states. In edit mode it also carries the move, size and remove controls. */
function WidgetFrame({ item, widget, filters, presets, edit, index, count, onChange, layout, onDrill, drag }) {
  const [local, setLocal] = useState({});
  const [, tick] = useState(0);
  const params = useMemo(() => ({ ...item.params, ...local }), [item.params, local]);
  const query = widgetQuery(filters, presets, params);
  const q = useWidgetData(item.widget, query, { refreshSec: widget.refreshSec });
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);
  const v5 = useFlagOn('ff.ui.p16605'); // part 166.5: card sizes S/M/L/XL and the source of each card
  const settings = widget.paramsKey && SETTINGS[widget.paramsKey];
  const label = widget.title;
  let body;
  if (q.isPending) body = <Skeleton label={`Loading ${label}`} rows={2} />;
  else if (q.isError && !q.data) {
    body = q.error?.status === 403
      ? <p className="muted wd-masked" role="status"><Icon name="erp.action.lock" size={16} /> {q.error.message}</p>
      : <ErrorState title={`${label} could not be loaded`} error={q.error} onRetry={() => q.refetch()} />;
  } else body = <CardBoundary key={q.dataUpdatedAt}><WidgetBody widget={widget} result={q.data} onDrill={onDrill} setLocal={setLocal} /></CardBoundary>;
  const viewAll = widget.drillRoute ? withDashFilters(widget.drillRoute, filters) : null;
  const btn = (text, onClick, disabled = false) => <button type="button" className="btn btn-small" aria-label={`${text}: ${label}`} onClick={onClick} disabled={disabled}>{text}</button>;
  return (
    <article
      className={`dash-item wd ui-card wd-${widget.type}${edit ? ' is-editing' : ''}${drag.over === item.id ? ' is-over' : ''}`} data-widget={item.widget} data-testid={`widget-${item.widget}`} aria-labelledby={`wd-${item.id}`}
      draggable={edit} onDragStart={edit ? (e) => drag.start(e, item.id) : undefined} onDragOver={edit ? (e) => drag.over_(e, item.id) : undefined} onDrop={edit ? (e) => drag.drop(e, index) : undefined} onDragEnd={edit ? drag.end : undefined}
    >
      <header className="wd-head ui-card-head">
        {edit && <span className="wd-grip" aria-hidden="true" title="Drag to move">⠿</span>}
        <h2 id={`wd-${item.id}`} className="wd-title">{label}</h2>
        <span className="wd-meta small muted" data-testid="widget-updated">{q.data ? updatedText(q.data.asOf) : ''}</span>
        <button type="button" className="btn btn-small wd-refresh" aria-label={`Refresh ${label}`} onClick={() => q.refetch()} disabled={q.isFetching}><Icon name="erp.action.refresh" size={14} /></button>
      </header>
      {edit && (
        <div className="wd-edit" role="group" aria-label={`Arrange ${label}`}>
          {btn('Move earlier', () => onChange(moveBy(layout, item.id, -1)), index === 0)}
          {btn('Move later', () => onChange(moveBy(layout, item.id, 1)), index === count - 1)}
          {v5 && (
            <span className="wd-sizes" role="group" aria-label={`Size of ${label}`}>
              {CARD_SIZES.map(([name, w]) => <button key={name} type="button" className="btn btn-small" aria-pressed={item.w === w} aria-label={`Size ${name}: ${label}`} onClick={() => onChange(resizeItem(layout, item.id, { w }))}>{name}</button>)}
            </span>
          )}
          {btn('Narrower', () => onChange(resizeItem(layout, item.id, { w: item.w - 1 })), item.w <= 1)}
          {btn('Wider', () => onChange(resizeItem(layout, item.id, { w: item.w + 1 })), item.w >= 12)}
          {btn('Shorter', () => onChange(resizeItem(layout, item.id, { h: item.h - 1 })), item.h <= 1)}
          {btn('Taller', () => onChange(resizeItem(layout, item.id, { h: item.h + 1 })), item.h >= 4)}
          {btn('Remove', () => onChange(removeItem(layout, item.id)))}
          <span className="muted small">{item.w} wide, {item.h} tall</span>
          {settings && <fieldset className="wd-settings"><legend>Settings</legend>{settings(item.params ?? {}, (p) => onChange(setParams(layout, item.id, p)))}</fieldset>}
        </div>
      )}
      <div className="wd-body ui-card-body">{body}</div>
      {/* the Fiori card footer (part 166.2, U-03): "View all" opens the list behind the widget with the dashboard's project and site */}
      {v5 && q.data?.data?.source && <p className="wd-source small muted" data-testid="widget-source">Source: {q.data.data.source}</p>}
      {widget.drillRoute && !edit && <div className="ui-card-foot wd-foot"><a href={viewAll} onClick={(e) => { e.preventDefault(); onDrill(viewAll); }} aria-label={`Open ${label}`} data-testid="widget-view-all">View all <span aria-hidden="true">›</span></a></div>}
    </article>
  );
}

const useWidth = (ref) => {
  // the first frame takes the window's width (a phone draws the phone layout at once, not the desktop's and then the phone's: layout shift, 166.4)
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1280 : Math.max(320, Math.round(window.innerWidth))));
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return w;
};

/** The layout on its twelve-column grid. Phones get one column and tablets six; in edit mode a place is moved by drag-and-drop or by buttons. */
export function DashboardGrid({ layout, catalogue, filters, presets, edit = false, onChange = () => {}, onDrill }) {
  const ref = useRef(null);
  const width = useWidth(ref);
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);
  const drag = {
    over,
    start: (e, id) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); setDragging(id); },
    over_: (e, id) => { e.preventDefault(); setOver(id); },
    drop: (e, index) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain') || dragging; if (id) onChange(moveTo(layout, id, index)); setDragging(null); setOver(null); },
    end: () => { setDragging(null); setOver(null); },
  };
  const byCode = new Map(catalogue.map((w) => [w.code, w]));
  return (
    <div ref={ref} className="dash-grid" data-testid="dashboard-grid" data-edit={edit || undefined}>
      {layout.map((item, i) => {
        const widget = byCode.get(item.widget);
        if (!widget) return null;
        return (
          <div key={item.id} className="dash-cell" style={{ gridColumn: `span ${spanAt(item, width)}`, gridRow: width < 600 ? 'auto' : `span ${item.h}`, ...(width < 600 ? { minHeight: `${item.h * 150 + (item.h - 1) * 16}px` } : {}) }}>
            <WidgetFrame item={item} widget={widget} filters={filters} presets={presets} edit={edit} index={i} count={layout.length} layout={layout} onChange={onChange} onDrill={onDrill} drag={drag} />
          </div>
        );
      })}
    </div>
  );
}
