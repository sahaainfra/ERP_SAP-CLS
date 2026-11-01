import { useSwipe, usePullToRefresh } from '../device/gestures.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authHeaders } from '../api/index.js';
import Icon from '../design/Icon.jsx';
import StatusBadge from '../design/StatusBadge.jsx';
import { formatNumberInput } from '../../../shared/forms/numbers.js';
import { formatBusinessDate, todayIst } from '../forms/dates.js';
import { formatDateTime } from '../format.js';
import { confirmLeave } from '../forms/guard.js';
import { ConfirmDialog } from '../feedback/Dialogs.jsx';
import { QueryError } from '../feedback/states.jsx';
import { NO_VALUE, OPERATOR_LABELS, PAGE_SIZES, datePresets, describeFilters, moveColumn, nextSort, removeFilter, setFilter, toQuery, viewConfig, visibleColumns, windowOf } from './state.js';

// The List Report (part 03.03): every register's list. The server does the work (BR-01): search, filters with operators, sort, pages of
// 25-200, the total count and the totals of numeric columns over the whole filtered set. The component adds the filter bar (quick
// chips, "mine", date presets, an advanced builder), saved views (personal or shared), the column chooser kept per person, selection
// with the page's bulk actions, exports on the server, row links and actions, cards on a phone, and the empty, error and no-permission
// states. API: see the Form Components / List Report section of the design system and docs/erp/ARCHITECTURE.md section 27.

const unwrap = async (p) => (await p).data;
const useMedia = (q) => {
  const [on, setOn] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false));
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(q);
    const on2 = () => setOn(mq.matches);
    mq.addEventListener('change', on2);
    return () => mq.removeEventListener('change', on2);
  }, [q]);
  return on;
};

/** A value shown the Indian way for its column type. */
export function formatCell(col, value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' && /^•+$/.test(value)) return value; // masked
  if (col.type === 'money') return formatNumberInput(value);
  if (col.type === 'number') return formatNumberInput(value, { scale: 0 });
  if (col.type === 'date') return formatBusinessDate(value);
  if (col.type === 'datetime') return formatDateTime(value);
  if (col.type === 'enum') return col.options?.find(([v]) => v === value)?.[1] ?? value;
  return String(value);
}

function FilterBuilder({ columns, onAdd }) {
  const filterable = columns.filter((c) => c.filterable && c.operators.length);
  const [key, setKey] = useState(filterable[0]?.key ?? '');
  const col = filterable.find((c) => c.key === key);
  const [op, setOp] = useState(col?.operators[0] ?? 'eq');
  const [value, setValue] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => { if (col && !col.operators.includes(op)) setOp(col.operators[0]); }, [col, op]);
  if (!col) return null;
  const input = (v, set, label) => (col.options
    ? <select aria-label={label} value={v} onChange={(e) => set(e.target.value)}><option value="">Choose...</option>{col.options.map(([o, l]) => <option key={o} value={o}>{l}</option>)}</select>
    : <input aria-label={label} type={col.type === 'date' || col.type === 'datetime' ? 'date' : 'text'} inputMode={['money', 'number'].includes(col.type) ? 'decimal' : undefined} value={v} onChange={(e) => set(e.target.value)} />);
  return (
    <form className="lr-builder" onSubmit={(e) => { e.preventDefault(); onAdd({ key, op, value: NO_VALUE.has(op) ? '1' : op === 'between' ? `${value},${to}` : value }); setValue(''); setTo(''); }} aria-label="Add a filter">
      <select aria-label="Field" value={key} onChange={(e) => setKey(e.target.value)}>{filterable.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
      <select aria-label="Operator" value={op} onChange={(e) => setOp(e.target.value)}>{col.operators.map((o) => <option key={o} value={o}>{OPERATOR_LABELS[o]}</option>)}</select>
      {!NO_VALUE.has(op) && input(value, setValue, 'Value')}
      {op === 'between' && input(to, setTo, 'Up to')}
      <button type="submit" className="btn btn-small" disabled={!NO_VALUE.has(op) && (value === '' || (op === 'between' && to === ''))}>Add filter</button>
    </form>
  );
}

function ViewsMenu({ list, views, current, canShare, onApply, onSave, onDelete, roles }) {
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [shareRoles, setShareRoles] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [error, setError] = useState('');
  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await onSave({ name: name.trim(), isShared: shared, shareScope: shared ? { roles: shareRoles.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) } : {}, isDefault: makeDefault });
      setName('');
    } catch (err) { setError(err.message); }
  };
  return (
    <details className="lr-menu" data-testid="views-menu">
      <summary className="btn"><Icon name="erp.action.pin" size={16} />{current ? `View: ${current.name}` : 'Views'}</summary>
      <div className="lr-pop" role="group" aria-label="Saved views">
        {views.length === 0 && <p className="muted small">No saved views yet. Save the current filters, columns and sort below.</p>}
        <ul className="lr-views">
          {views.map((v) => (
            <li key={v.id}>
              <button type="button" className="link" onClick={() => onApply(v)} aria-current={current?.id === v.id ? 'true' : undefined}>{v.name}</button>
              <span className="muted small">{v.isShared ? `shared${v.shareScope?.roles?.length ? ` with ${v.shareScope.roles.join(', ')}` : ''}${v.mine ? '' : ` by ${v.owner}`}` : 'personal'}{v.isDefault ? ', default' : ''}</span>
              {v.mine && <button type="button" className="link" aria-label={`Delete the view ${v.name}`} onClick={() => onDelete(v)}>Delete</button>}
            </li>
          ))}
        </ul>
        <form onSubmit={save} className="lr-saveview">
          <label className="ff-mini">Save the current view as<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required aria-label="View name" /></label>
          <label className="ff-check"><input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} /> Open with this view</label>
          {canShare && <label className="ff-check"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Share it</label>}
          {canShare && shared && <label className="ff-mini">With roles (comma separated, empty for everyone)<input value={shareRoles} onChange={(e) => setShareRoles(e.target.value)} placeholder={roles.join(', ')} aria-label="Share with roles" /></label>}
          <button type="submit" className="btn btn-small btn-primary" disabled={!name.trim()}>Save view</button>
          {error && <p className="ff-error" role="alert">{error}</p>}
          <p className="muted small">List {list}. Views keep columns, widths, filters, sort and page size.</p>
        </form>
      </div>
    </details>
  );
}

function ColumnChooser({ all, order, hidden, onChange, onReset }) {
  const keys = [...order.filter((k) => all.some((c) => c.key === k)), ...all.map((c) => c.key).filter((k) => !order.includes(k))];
  return (
    <details className="lr-menu" data-testid="column-chooser">
      <summary className="btn"><Icon name="erp.action.settings" size={16} />Columns</summary>
      <div className="lr-pop" role="group" aria-label="Choose and order columns">
        <ul className="lr-cols">
          {keys.map((k, i) => {
            const c = all.find((x) => x.key === k);
            return (
              <li key={k}>
                <label className="ff-check"><input type="checkbox" checked={!hidden.includes(k)} disabled={i === 0} onChange={(e) => onChange({ order: keys, hidden: e.target.checked ? hidden.filter((h) => h !== k) : [...hidden, k] })} /> {c.label}</label>
                <span className="lr-move">
                  <button type="button" className="btn btn-small" aria-label={`Move ${c.label} left`} disabled={i === 0} onClick={() => onChange({ order: moveColumn(keys, k, -1), hidden })}>↑</button>
                  <button type="button" className="btn btn-small" aria-label={`Move ${c.label} right`} disabled={i === keys.length - 1} onClick={() => onChange({ order: moveColumn(keys, k, 1), hidden })}>↓</button>
                </span>
              </li>
            );
          })}
        </ul>
        <button type="button" className="btn btn-small" onClick={onReset}>Reset columns</button>
      </div>
    </details>
  );
}

/**
 * <ListReport
 *   listCode="ui.sample_requests" endpoint="/ui/sample-requests" title="..."
 *   rowHref={(row) => url} onOpen={(row) => ...}          row click opens the record; the link also opens in a new tab
 *   cardFields={['docNo', 'title', 'status', 'total']}      what a phone shows
 *   statusKey="status" mineFilter={{ key: 'createdBy' }} dateKey="docDate"
 *   bulkActions={[{ id, label, permission, confirm, reasonFor?: 'cancel', run: async (ids, { reasonCode, reason }) => ({ results: [{ id, ok, message }] }) }]}
 *   rowActions={(row) => [{ label, onSelect }]} newAction={{ label, onClick }} session={session} empty={{ title, text }} />
 */
/** A row of the phone's card list: swipe it left (or press Actions) to show what can be done with it, swipe right to hide them. */
function CardRow({ rowHref, onOpenRow, actions, selectable, selected, onSelect, fields, label }) {
  const [shown, setShown] = useState(false);
  const swipe = useSwipe((dir) => setShown(dir === 'left'));
  return (
    <li className={`lr-card ${shown ? 'is-swiped' : ''}`} {...swipe} data-testid="list-card">
      {selectable && <input type="checkbox" aria-label={`Select ${label}`} checked={selected} onChange={onSelect} />}
      <a href={rowHref} onClick={onOpenRow} className="lr-card-link">{fields}</a>
      {actions.length > 0 && <button type="button" className="btn btn-small lr-card-more" aria-expanded={shown} aria-label={`Actions for ${label}`} onClick={() => setShown((v) => !v)}>Actions</button>}
      {shown && (
        <div className="lr-card-actions" role="group" aria-label={`Actions for ${label}`}>
          {actions.map((a) => <button key={a.label} type="button" className="btn" disabled={a.disabled} onClick={() => { setShown(false); a.onSelect(); }}>{a.label}</button>)}
        </div>
      )}
    </li>
  );
}

export default function ListReport({ listCode, endpoint, title, rowHref, onOpen, cardFields, statusKey, mineFilter, dateKey, bulkActions = [], rowActions, newAction, session, empty, permission, contextFilters = [] }) {
  const qc = useQueryClient();
  const narrow = useMedia('(max-width: 767px)');
  const desc = useQuery({ queryKey: ['ui', 'list', listCode], queryFn: () => unwrap(api.get(`/ui/lists/${listCode}`)), staleTime: 5 * 60_000, retry: false });
  const prefs = useQuery({ queryKey: ['ui', 'preferences'], queryFn: () => unwrap(api.get('/ui/preferences')), staleTime: 60_000, retry: false });
  const views = useQuery({ queryKey: ['ui', 'saved-views', listCode], queryFn: () => unwrap(api.get(`/ui/saved-views?list=${encodeURIComponent(listCode)}`)), retry: false });
  const [state, setState] = useState(null);
  const [view, setView] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [notice, setNotice] = useState('');
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkAsk, setBulkAsk] = useState(null); // the bulk action waiting for confirmation
  const [scrollTop, setScrollTop] = useState(0);
  const resizing = useRef(null);
  const columns = desc.data?.columns ?? [];

  // the drop-down menus (views, columns, export, filters, row actions) close on a click outside them or on Escape
  useEffect(() => {
    const closeOthers = (target) => document.querySelectorAll('details.lr-menu[open]').forEach((d) => { if (!d.contains(target)) d.open = false; });
    const onDown = (e) => closeOthers(e.target);
    const onKey = (e) => { if (e.key === 'Escape') closeOthers(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, []);

  // first state: the person's default view, else their table settings, else the list's defaults
  useEffect(() => {
    if (state || !desc.data || views.isPending || prefs.isPending) return;
    const saved = prefs.data?.tableSettings?.[listCode] ?? {};
    const def = (views.data ?? []).find((v) => v.isDefault && v.mine) ?? (views.data ?? []).find((v) => v.isDefault);
    const base = { q: '', sort: desc.data.defaultSort ?? '', page: 1, pageSize: saved.pageSize ?? 25, filters: [], columns: saved.columns ?? [], hidden: saved.hidden ?? [], widths: saved.widths ?? {} };
    setState(def ? { ...base, ...def.config, page: 1 } : base);
    if (def) setView(def);
  }, [state, desc.data, views.isPending, views.data, prefs.isPending, prefs.data, listCode]);

  // the working context (part 03.05) narrows the list on top of the person's own filters: { key, op, value } rows of the page
  const withContext = (st) => ({ ...st, filters: [...st.filters.filter((f) => !contextFilters.some((c) => c.key === f.key && c.op === f.op)), ...contextFilters] });
  const query = state ? toQuery(withContext(state)) : '';
  const list = useQuery({ queryKey: ['list', endpoint, query], queryFn: () => api.get(`${endpoint}?${query}`), enabled: Boolean(state), retry: false, placeholderData: (prev) => prev });
  const rows = list.data?.data ?? [];
  const pull = usePullToRefresh(() => list.refetch(), { enabled: Boolean(state) });
  const meta = list.data?.meta;
  const shown = state ? visibleColumns(columns, state) : [];

  // column choices follow the person (ui_user_preferences.table_settings_json, FR-04)
  const persist = useMutation({ mutationFn: (settings) => unwrap(api.patch('/ui/preferences', { tableSettings: { [listCode]: settings } })), onSuccess: (data) => qc.setQueryData(['ui', 'preferences'], data) });
  const update = (patch, { keep = false } = {}) => {
    setState((s) => ({ ...s, ...patch, page: patch.page ?? (keep ? s.page : 1) }));
    setSelected(new Set());
    setBulkResult(null);
  };
  const saveColumns = (next) => {
    update(next, { keep: true });
    const s = { ...state, ...next };
    persist.mutate({ pageSize: s.pageSize, columns: s.columns, hidden: s.hidden, widths: s.widths });
  };

  const saveView = useMutation({ mutationFn: (body) => unwrap(api.post('/ui/saved-views', { list: listCode, ...body, config: viewConfig(state) })), onSuccess: (v) => { qc.invalidateQueries({ queryKey: ['ui', 'saved-views', listCode] }); setView(v); setNotice(`View "${v.name}" saved.`); } });
  const deleteView = useMutation({ mutationFn: (v) => unwrap(api.delete(`/ui/saved-views/${v.id}`, {}, { version: v.version })), onSuccess: () => { qc.invalidateQueries({ queryKey: ['ui', 'saved-views', listCode] }); setView(null); setNotice('View deleted.'); } });

  const can = (p) => !p || Boolean(session?.permissions?.includes(p));
  const actions = bulkActions.filter((a) => can(a.permission));
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const runBulk = async (a, payload = {}) => {
    const ids = [...selected];
    setBulkResult(null);
    try {
      const out = await a.run(ids, payload);
      const ok = out.results.filter((r) => r.ok).length;
      setBulkResult({ label: a.label, ok, failed: out.results.filter((r) => !r.ok) });
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['list', endpoint] });
    } catch (err) {
      setBulkResult({ label: a.label, ok: 0, failed: [{ id: '-', message: `${err.message}${err.correlationId ? ` (Correlation ID ${err.correlationId})` : ''}` }] });
    }
  };

  const [exporting, setExporting] = useState('');
  const exportAs = async (format) => {
    setExporting(format);
    setNotice('');
    try {
      const res = await fetch(`/api/v1${endpoint}/export?${toQuery({ ...withContext(state), page: 1 }, { format })}`, { headers: { ...authHeaders(), 'x-correlation-id': globalThis.crypto.randomUUID() } });
      if (res.status === 202) {
        const job = (await res.json()).data;
        setNotice(`The export has ${job.rows} rows, so it is being prepared in the background. It will appear under My Exports when ready.`);
        qc.invalidateQueries({ queryKey: ['ui', 'exports'] });
        return;
      }
      if (!res.ok) { const e = await res.json().catch(() => null); throw new Error(e?.error?.message ?? `The server answered ${res.status}`); }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `${listCode}.${format}`;
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: name }).click();
      URL.revokeObjectURL(url);
      setNotice(`Exported ${res.headers.get('x-export-rows') ?? ''} rows as ${format.toUpperCase()}.`);
    } catch (err) {
      setNotice(`Export failed: ${err.message}`);
    } finally {
      setExporting('');
    }
  };

  // virtual scrolling for long pages
  const ROW_H = 44;
  const long = !narrow && rows.length > 60;
  const win = long ? windowOf({ count: rows.length, rowHeight: ROW_H, viewport: 560, scrollTop }) : { start: 0, end: rows.length, before: 0, after: 0 };
  const statusCol = columns.find((c) => c.key === statusKey);
  const presets = useMemo(() => datePresets(todayIst()), []);
  const dateFilter = state?.filters.find((f) => f.key === dateKey && f.op === 'between');
  const mine = mineFilter && state?.filters.some((f) => f.key === mineFilter.key && f.op === 'eq');
  const startResize = (key) => (e) => {
    e.preventDefault();
    const th = e.currentTarget.parentElement;
    resizing.current = { key, x: e.clientX, w: th.getBoundingClientRect().width };
    const move = (ev) => { const r = resizing.current; if (r) setState((s) => ({ ...s, widths: { ...s.widths, [r.key]: Math.max(60, Math.min(800, Math.round(r.w + ev.clientX - r.x))) } })); };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); resizing.current = null; setState((s) => { persist.mutate({ pageSize: s.pageSize, columns: s.columns, hidden: s.hidden, widths: s.widths }); return s; }); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };
  const resizeKey = (key) => (e) => {
    const by = e.key === 'ArrowRight' ? 20 : e.key === 'ArrowLeft' ? -20 : 0;
    if (!by) return;
    e.preventDefault();
    const w = Math.max(60, Math.min(800, (state.widths[key] ?? 160) + by));
    saveColumns({ widths: { ...state.widths, [key]: w } });
  };
  const open = (row) => (e) => {
    if (e.button === 1 || e.metaKey || e.ctrlKey || e.shiftKey) return; // a new tab or window: let the browser follow the link
    e.preventDefault();
    if (confirmLeave()) onOpen?.(row);
  };

  if (desc.isError || (list.isError && !list.data)) {
    const err = desc.error ?? list.error;
    return <QueryError error={err} what={title} permission={permission} onRetry={() => (desc.isError ? desc.refetch() : list.refetch())} />;
  }
  if (!state || !desc.data) return <div className="skeleton" aria-busy="true" aria-label={`Loading ${title}`}>{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton-row" />)}</div>;

  const filterWords = describeFilters(state.filters, columns);
  const firstKey = shown[0]?.key;
  return (
    <div className="lr" data-testid={`list-${listCode}`}>
      <div className="lr-bar" role="search">
        <input type="search" className="lr-search" aria-label={`Search ${title}`} placeholder="Search" value={state.q} onChange={(e) => update({ q: e.target.value })} />
        <ViewsMenu list={listCode} views={views.data ?? []} current={view} canShare={can('ui.view.share')} roles={session?.roles ?? []}
          onApply={(v) => { setView(v); update({ ...v.config, page: 1 }); setNotice(`View "${v.name}" applied.`); }} onSave={(b) => saveView.mutateAsync(b)} onDelete={(v) => window.confirm(`Delete the view "${v.name}"?`) && deleteView.mutate(v)} />
        <ColumnChooser all={columns} order={state.columns} hidden={state.hidden} onChange={({ order, hidden }) => saveColumns({ columns: order, hidden })} onReset={() => saveColumns({ columns: [], hidden: [], widths: {} })} />
        <details className="lr-menu" data-testid="export-menu">
          <summary className="btn"><Icon name="erp.action.export" size={16} />{exporting ? `Exporting ${exporting.toUpperCase()}...` : 'Export'}</summary>
          <div className="lr-pop" role="group" aria-label="Export the current view">
            <p className="muted small">The rows of the current filters and sort, with your masks. {meta ? `${meta.total} rows.` : ''}</p>
            {['xlsx', 'csv', 'pdf'].map((f) => <button key={f} type="button" className="btn btn-small" disabled={Boolean(exporting) || !meta?.total} onClick={() => exportAs(f)}>{f.toUpperCase()}</button>)}
          </div>
        </details>
        <span className="spacer" />
        {newAction && can(newAction.permission) && <button type="button" className="btn btn-primary" onClick={newAction.onClick}><Icon name="erp.action.create" size={16} />{newAction.label}</button>}
      </div>
      {contextFilters.length > 0 && <p className="muted small" data-testid="list-context">Showing the working context only: {contextFilters.map((c) => c.value).join(' / ')}. Choose All projects in the context at the top of the page to see everything.</p>}
      <div className="lr-quick" role="group" aria-label="Quick filters">
        {statusCol?.options?.map(([v, l]) => {
          const on = state.filters.some((f) => f.key === statusKey && f.op === 'in' && f.value.split(',').includes(v));
          const values = (state.filters.find((f) => f.key === statusKey && f.op === 'in')?.value ?? '').split(',').filter(Boolean);
          const next = on ? values.filter((x) => x !== v) : [...values, v];
          return <button key={v} type="button" className={`lr-chip ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => update({ filters: setFilter(removeFilter(state.filters, statusKey, 'in'), { key: statusKey, op: 'in', value: next.join(',') }) })}>{l}</button>;
        })}
        {mineFilter && <button type="button" className={`lr-chip ${mine ? 'is-on' : ''}`} aria-pressed={Boolean(mine)} onClick={() => update({ filters: mine ? removeFilter(state.filters, mineFilter.key, 'eq') : setFilter(state.filters, { key: mineFilter.key, op: 'eq', value: session?.user ?? '' }) })}>My records</button>}
        {dateKey && (
          <select aria-label="Date range" value={presets.find((p) => dateFilter?.value === `${p.from},${p.to}`)?.id ?? ''} onChange={(e) => { const p = presets.find((x) => x.id === e.target.value); update({ filters: p ? setFilter(removeFilter(state.filters, dateKey, 'between'), { key: dateKey, op: 'between', value: `${p.from},${p.to}` }) : removeFilter(state.filters, dateKey, 'between') }); }}>
            <option value="">Any date</option>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        )}
        <details className="lr-menu"><summary className="btn btn-small"><Icon name="erp.action.filter" size={16} />More filters</summary><div className="lr-pop"><FilterBuilder columns={columns} onAdd={(f) => update({ filters: setFilter(state.filters, f) })} /></div></details>
      </div>
      {state.filters.length > 0 && (
        <ul className="lr-active" aria-label="Active filters">
          {state.filters.map((f, i) => <li key={`${f.key}-${f.op}`} className="lr-chip is-on">{filterWords[i]} <button type="button" className="link" aria-label={`Remove the filter ${filterWords[i]}`} onClick={() => update({ filters: removeFilter(state.filters, f.key, f.op) })}>×</button></li>)}
          <li><button type="button" className="link" onClick={() => update({ filters: [], q: '' })}>Clear all</button></li>
        </ul>
      )}
      <p role="status" className="notice" data-testid="list-notice">{notice}</p>
      {actions.length > 0 && selected.size > 0 && (
        <div className="toolbar lr-bulk" role="group" aria-label="Actions for the selected rows" data-testid="bulk-bar">
          <strong>{selected.size} selected</strong>
          {actions.map((a) => <button key={a.id} type="button" className="btn" onClick={() => (a.confirm || a.reasonFor ? setBulkAsk(a) : runBulk(a))}>{a.label}</button>)}
          <button type="button" className="btn" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}
      <ConfirmDialog open={Boolean(bulkAsk)} title={bulkAsk ? `${bulkAsk.label}?` : ''} text={bulkAsk ? (typeof bulkAsk.confirm === 'function' ? bulkAsk.confirm(selected.size) : bulkAsk.confirm) : ''} confirmLabel={bulkAsk?.label} danger={Boolean(bulkAsk?.reasonFor)} reasonFor={bulkAsk?.reasonFor ?? null}
        onCancel={() => setBulkAsk(null)} onConfirm={async (payload) => { const a = bulkAsk; setBulkAsk(null); await runBulk(a, payload); }} />
      {bulkResult && (
        <div className={`state ${bulkResult.failed.length ? 'state-error' : ''}`} role="status" data-testid="bulk-result">
          <strong>{bulkResult.label}: {bulkResult.ok} done{bulkResult.failed.length ? `, ${bulkResult.failed.length} not done` : ''}.</strong>
          {bulkResult.failed.length > 0 && <ul>{bulkResult.failed.map((f) => <li key={f.id}>{f.label ?? `#${f.id}`}: {f.message}</li>)}</ul>}
        </div>
      )}
      {list.isPending && <div className="skeleton" aria-busy="true" aria-label={`Loading ${title}`}>{[0, 1, 2].map((i) => <div key={i} className="skeleton-row" />)}</div>}
      {meta && rows.length === 0 && (
        <div className="state">
          <h2>{state.filters.length || state.q ? `No ${title.toLowerCase()} match` : empty?.title ?? `No ${title.toLowerCase()} yet`}</h2>
          <p>{state.filters.length || state.q ? 'Change the search or remove a filter.' : empty?.text}</p>
          {state.filters.length || state.q ? <button type="button" className="btn" onClick={() => update({ filters: [], q: '' })}>Clear the filters</button> : newAction && can(newAction.permission) && <button type="button" className="btn btn-primary" onClick={newAction.onClick}>{newAction.label}</button>}
        </div>
      )}
      {(pull.offset > 0 || pull.refreshing) && <p className="pull-indicator" role="status" style={{ height: pull.offset }}>{pull.refreshing ? 'Refreshing...' : pull.ready ? 'Let go to refresh' : 'Pull down to refresh'}</p>}
      {rows.length > 0 && narrow && (
        <ul className="lr-cards" aria-label={title} data-testid="list-cards">
          {rows.map((r) => (
            <CardRow
              key={r.id} label={String(r[firstKey] ?? r.id)} rowHref={rowHref?.(r)} onOpenRow={open(r)} actions={rowActions ? rowActions(r) : []}
              selectable={actions.length > 0} selected={selected.has(r.id)} onSelect={() => setSelected((s0) => { const n = new Set(s0); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
              fields={(cardFields ?? shown.slice(0, 4).map((c) => c.key)).map((k, i) => {
                const c = columns.find((x) => x.key === k);
                if (!c) return null;
                return <span key={k} className={i === 0 ? 'lr-card-title' : 'lr-card-field'}>{i > 0 && <span className="muted small">{c.label}: </span>}{c.key === statusKey ? <StatusBadge status={r[k]} /> : formatCell(c, r[k]) || (i === 0 ? `#${r.id}` : '')}</span>;
              })}
            />
          ))}
        </ul>
      )}
      {rows.length > 0 && !narrow && (
        <div className={`lr-wrap ${long ? 'is-long' : ''}`} onScroll={(e) => long && setScrollTop(e.currentTarget.scrollTop)} tabIndex={0} aria-label={`${title} table`}>
          <table className="lr-table">
            <caption className="visually-hidden">{title}</caption>
            <thead>
              <tr>
                {actions.length > 0 && <th className="lr-sel" scope="col"><input type="checkbox" aria-label="Select every row on this page" checked={allOnPage} onChange={() => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))} /></th>}
                {shown.map((c, i) => {
                  const dir = state.sort === c.key ? 'ascending' : state.sort === `-${c.key}` ? 'descending' : 'none';
                  return (
                    <th key={c.key} scope="col" aria-sort={dir} className={`${i === 0 ? 'lr-freeze ' : ''}${['money', 'number'].includes(c.type) ? 'num' : ''}`} style={state.widths[c.key] ? { width: state.widths[c.key], minWidth: state.widths[c.key] } : undefined}>
                      {c.sortable ? <button type="button" className="lr-sort" onClick={() => update({ sort: nextSort(state.sort, c.key) })}>{c.label}<span aria-hidden="true">{dir === 'ascending' ? ' ▲' : dir === 'descending' ? ' ▼' : ''}</span></button> : c.label}
                      <span className="lr-resize" role="separator" aria-orientation="vertical" aria-label={`Resize ${c.label}`} tabIndex={0} onPointerDown={startResize(c.key)} onKeyDown={resizeKey(c.key)} />
                    </th>
                  );
                })}
                {rowActions && <th scope="col"><span className="visually-hidden">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {win.before > 0 && <tr aria-hidden="true" style={{ height: win.before }}><td colSpan={shown.length + 2} /></tr>}
              {rows.slice(win.start, win.end).map((r) => (
                <tr key={r.id} className={selected.has(r.id) ? 'is-selected' : ''} data-testid={`row-${r.id}`}>
                  {actions.length > 0 && <td className="lr-sel"><input type="checkbox" aria-label={`Select ${r[firstKey] ?? r.id}`} checked={selected.has(r.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} /></td>}
                  {shown.map((c, i) => (
                    <td key={c.key} className={`${i === 0 ? 'lr-freeze ' : ''}${['money', 'number'].includes(c.type) ? 'num' : ''}`} data-label={c.label}>
                      {i === 0 && rowHref ? <a href={rowHref(r)} onClick={open(r)}>{formatCell(c, r[c.key]) || `#${r.id}`}</a> : c.key === statusKey ? <StatusBadge status={r[c.key]} /> : formatCell(c, r[c.key])}
                    </td>
                  ))}
                  {rowActions && (
                    <td>
                      <details className="lr-menu lr-rowmenu">
                        <summary className="btn btn-small" aria-label={`Actions for ${r[firstKey] ?? r.id}`}><Icon name="erp.action.more" size={16} /></summary>
                        <div className="lr-pop lr-pop-right" role="menu">
                          {rowActions(r).map((a) => <button key={a.label} type="button" role="menuitem" className="link" disabled={a.disabled} onClick={(e) => { e.currentTarget.closest('details').open = false; a.onSelect(); }}>{a.label}</button>)}
                        </div>
                      </details>
                    </td>
                  )}
                </tr>
              ))}
              {win.after > 0 && <tr aria-hidden="true" style={{ height: win.after }}><td colSpan={shown.length + 2} /></tr>}
            </tbody>
            {meta && Object.keys(meta.totals ?? {}).length > 0 && (
              <tfoot>
                <tr data-testid="list-totals">
                  {actions.length > 0 && <td />}
                  {shown.map((c, i) => <td key={c.key} className={`${i === 0 ? 'lr-freeze ' : ''}${c.total ? 'num' : ''}`}>{i === 0 ? <strong>Total of {meta.total} rows</strong> : c.total ? <strong data-testid={`total-${c.key}`}>{formatCell(c, meta.totals[c.key])}</strong> : ''}</td>)}
                  {rowActions && <td />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {meta && narrow && Object.keys(meta.totals ?? {}).length > 0 && rows.length > 0 && (
        <p className="lr-cardtotals" data-testid="list-totals">Total of {meta.total} rows: {columns.filter((c) => c.total).map((c) => `${c.label} ${formatCell(c, meta.totals[c.key])}`).join(', ')}</p>
      )}
      {meta && (
        <div className="pager">
          <span>{meta.total} {title.toLowerCase()}, page {meta.page} of {meta.totalPages}{list.isFetching ? ' (updating...)' : ''}</span>
          <label className="shell-field"><span>Rows</span>
            <select aria-label="Rows per page" value={state.pageSize} onChange={(e) => saveColumns({ pageSize: Number(e.target.value), page: 1 })}>{PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select>
          </label>
          <button type="button" className="btn" disabled={state.page <= 1} onClick={() => update({ page: 1 }, { keep: true })}>First</button>
          <button type="button" className="btn" disabled={state.page <= 1} onClick={() => update({ page: state.page - 1 }, { keep: true })}>Previous</button>
          <button type="button" className="btn" disabled={state.page >= meta.totalPages} onClick={() => update({ page: state.page + 1 }, { keep: true })}>Next</button>
        </div>
      )}
    </div>
  );
}
