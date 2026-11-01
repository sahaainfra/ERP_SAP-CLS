import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../design/Icon.jsx';
import { ErrorState, Skeleton } from '../feedback/states.jsx';
import WidgetBody from './WidgetBody.jsx';
import { useWidgetData } from './api.js';
import { moveBy, moveTo, removeItem, resizeItem, setParams, spanAt, updatedText, widgetQuery } from './layout.js';

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

/** One widget: title, when it was last read, refresh and open, and its body in the standard states. In edit mode it also carries the move, size and remove controls. */
function WidgetFrame({ item, widget, filters, presets, edit, index, count, onChange, layout, onDrill, drag }) {
  const [local, setLocal] = useState({});
  const [, tick] = useState(0);
  const params = useMemo(() => ({ ...item.params, ...local }), [item.params, local]);
  const query = widgetQuery(filters, presets, params);
  const q = useWidgetData(item.widget, query, { refreshSec: widget.refreshSec });
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);
  const settings = widget.paramsKey && SETTINGS[widget.paramsKey];
  const label = widget.title;
  let body;
  if (q.isPending) body = <Skeleton label={`Loading ${label}`} rows={2} />;
  else if (q.isError && !q.data) {
    body = q.error?.status === 403
      ? <p className="muted wd-masked" role="status"><Icon name="erp.action.lock" size={16} /> {q.error.message}</p>
      : <ErrorState title={`${label} could not be loaded`} error={q.error} onRetry={() => q.refetch()} />;
  } else body = <WidgetBody widget={widget} result={q.data} onDrill={onDrill} setLocal={setLocal} />;
  const btn = (text, onClick, disabled = false) => <button type="button" className="btn btn-small" aria-label={`${text}: ${label}`} onClick={onClick} disabled={disabled}>{text}</button>;
  return (
    <article
      className={`dash-item wd wd-${widget.type}${edit ? ' is-editing' : ''}${drag.over === item.id ? ' is-over' : ''}`} data-widget={item.widget} data-testid={`widget-${item.widget}`} aria-labelledby={`wd-${item.id}`}
      draggable={edit} onDragStart={edit ? (e) => drag.start(e, item.id) : undefined} onDragOver={edit ? (e) => drag.over_(e, item.id) : undefined} onDrop={edit ? (e) => drag.drop(e, index) : undefined} onDragEnd={edit ? drag.end : undefined}
    >
      <header className="wd-head">
        {edit && <span className="wd-grip" aria-hidden="true" title="Drag to move">⠿</span>}
        <h2 id={`wd-${item.id}`} className="wd-title">{label}</h2>
        <span className="wd-meta small muted" data-testid="widget-updated">{q.data ? updatedText(q.data.asOf) : ''}</span>
        <button type="button" className="btn btn-small wd-refresh" aria-label={`Refresh ${label}`} onClick={() => q.refetch()} disabled={q.isFetching}><Icon name="erp.action.refresh" size={14} /></button>
        {widget.drillRoute && !edit && <a className="btn btn-small" href={widget.drillRoute} onClick={(e) => { e.preventDefault(); onDrill(widget.drillRoute); }} aria-label={`Open ${label}`}>Open</a>}
      </header>
      {edit && (
        <div className="wd-edit" role="group" aria-label={`Arrange ${label}`}>
          {btn('Move earlier', () => onChange(moveBy(layout, item.id, -1)), index === 0)}
          {btn('Move later', () => onChange(moveBy(layout, item.id, 1)), index === count - 1)}
          {btn('Narrower', () => onChange(resizeItem(layout, item.id, { w: item.w - 1 })), item.w <= 1)}
          {btn('Wider', () => onChange(resizeItem(layout, item.id, { w: item.w + 1 })), item.w >= 12)}
          {btn('Shorter', () => onChange(resizeItem(layout, item.id, { h: item.h - 1 })), item.h <= 1)}
          {btn('Taller', () => onChange(resizeItem(layout, item.id, { h: item.h + 1 })), item.h >= 4)}
          {btn('Remove', () => onChange(removeItem(layout, item.id)))}
          <span className="muted small">{item.w} wide, {item.h} tall</span>
          {settings && <fieldset className="wd-settings"><legend>Settings</legend>{settings(item.params ?? {}, (p) => onChange(setParams(layout, item.id, p)))}</fieldset>}
        </div>
      )}
      <div className="wd-body">{body}</div>
    </article>
  );
}

const useWidth = (ref) => {
  const [w, setW] = useState(1280);
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
          <div key={item.id} className="dash-cell" style={{ gridColumn: `span ${spanAt(item, width)}`, gridRow: width < 600 ? 'auto' : `span ${item.h}` }}>
            <WidgetFrame item={item} widget={widget} filters={filters} presets={presets} edit={edit} index={i} count={layout.length} layout={layout} onChange={onChange} onDrill={onDrill} drag={drag} />
          </div>
        );
      })}
    </div>
  );
}
