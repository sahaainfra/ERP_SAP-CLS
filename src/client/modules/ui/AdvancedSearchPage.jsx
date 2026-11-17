import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Icon from '../../platform/design/Icon.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { toCsv } from '../../platform/format.js';
import { api } from '../../platform/api/index.js';
import { useContextOptions } from '../../platform/shell/api.js';
import { clickResult, searchQuery, useDeleteSearchView, useSaveSearchView, useSearch, useSearchTypes, useSearchViews } from '../../platform/search/api.js';
import { downloadCsv, navigateTo } from '../core/pages/ui.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Advanced Search (part 03.08, FR-05): the same search as the palette with filters for each kind of record, results grouped by kind or listed page by
// page for one or more kinds, saved filters, and an export of what is listed. The filters are kept in the address, so a search can be shared and the Back
// button returns to it.

const SORTS = [['relevance', 'Best match'], ['updated', 'Newest first'], ['title', 'Title A to Z']];
const SIZES = [25, 50, 100];
const read = () => {
  const p = new URLSearchParams(window.location.search);
  const list = (k) => (p.get(k) ?? '').split(',').filter(Boolean);
  return { q: p.get('q') ?? '', types: list('types'), status: list('status'), projectId: p.get('projectId') ?? '', siteId: p.get('siteId') ?? '', from: p.get('from') ?? '', to: p.get('to') ?? '', sort: p.get('sort') ?? 'relevance', page: Number(p.get('page') ?? 1) || 1, pageSize: Number(p.get('pageSize') ?? 25) || 25 };
};
const stored = (s) => ({ q: s.q, types: s.types, status: s.status, projectId: s.projectId, siteId: s.siteId, from: s.from, to: s.to, sort: s.sort === 'relevance' ? '' : s.sort, pageSize: s.pageSize === 25 ? '' : s.pageSize, page: s.page > 1 ? s.page : '' });
const empty = { q: '', types: [], status: [], projectId: '', siteId: '', from: '', to: '', sort: 'relevance', page: 1, pageSize: 25 };

/** Fields of a saved view for these filters (the list contract of the saved-view service). */
const toView = (s) => ({
  columns: [], hidden: [], widths: {}, sort: s.sort, pageSize: s.pageSize, q: s.q,
  filters: [
    s.types.length && { key: 'entity', op: 'in', value: s.types.join(',') }, s.status.length && { key: 'status', op: 'in', value: s.status.join(',') },
    s.projectId && { key: 'projectId', op: 'eq', value: String(s.projectId) }, s.siteId && { key: 'siteId', op: 'eq', value: String(s.siteId) },
    s.from && { key: 'docDate', op: 'gte', value: s.from }, s.to && { key: 'docDate', op: 'lte', value: s.to },
  ].filter(Boolean),
});
const fromView = (v) => {
  const f = (k, op) => v.config.filters.find((x) => x.key === k && (!op || x.op === op))?.value ?? '';
  return { ...empty, q: v.config.q, types: f('entity').split(',').filter(Boolean), status: f('status').split(',').filter(Boolean), projectId: f('projectId'), siteId: f('siteId'), from: f('docDate', 'gte'), to: f('docDate', 'lte'), sort: ['relevance', 'updated', 'title'].includes(v.config.sort) ? v.config.sort : 'relevance', pageSize: SIZES.includes(v.config.pageSize) ? v.config.pageSize : 25 };
};

function Mark({ text, q }) {
  const terms = [...new Set(String(q).toLowerCase().split(/\s+/).filter((t) => t.length >= 2))];
  if (!text || !terms.length) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return String(text).split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

function Row({ item, q, position, language }) {
  const client = useQueryClient();
  const open = (e) => {
    e.preventDefault();
    clickResult({ entity: item.entity, entityId: item.entityId, position, q }, client);
    navigateTo(item.route);
  };
  return (
    <li className="srch-row" data-testid="search-result">
      <Icon name={item.icon ?? 'erp.action.search'} size={18} />
      <div className="srch-body">
        <a className="srch-title" href={item.route} onClick={open}><Mark text={item.title} q={q} /></a>
        <div className="srch-meta muted small">
          {item.code && item.code !== item.title && <span><Mark text={item.code} q={q} /></span>}
          {item.subtitle && <span><Mark text={item.subtitle} q={q} /></span>}
          {item.projectCode && <span>Project {item.projectCode}</span>}
        </div>
      </div>
      {item.status && <StatusBadge status={item.status} />}
      <a className="btn btn-small" href={item.route} onClick={open} aria-label={`Open ${item.title}`}>{language === 'hi' ? 'खोलें' : 'Open'}</a>
    </li>
  );
}

export default function AdvancedSearchPage() {
  useEffect(() => { document.title = 'Advanced Search - ERP'; }, []);
  const [s, setS] = useState(read);
  const [draft, setDraft] = useState(s.q);
  const [notice, setNotice] = useState('');
  const [viewName, setViewName] = useState('');
  const dialog = useRef(null);
  const types = useSearchTypes();
  const ctx = useContextOptions();
  const views = useSearchViews();
  const saveView = useSaveSearchView();
  const deleteView = useDeleteSearchView();
  const language = document.documentElement.lang === 'hi' ? 'hi' : 'en';
  const paged = s.types.length > 0;
  const params = { q: s.q, types: s.types, status: s.status, projectId: s.projectId, siteId: s.siteId, from: s.from, to: s.to, sort: s.sort, source: 'page', perGroup: paged ? undefined : 5, ...(paged ? { page: s.page, pageSize: s.pageSize } : {}) };
  const result = useSearch(params, { enabled: s.q.trim().length > 0 });

  const apply = (patch, { reset = true } = {}) => {
    const next = { ...s, ...patch, ...(reset && !('page' in patch) ? { page: 1 } : {}) };
    setS(next);
    const qs = searchQuery(stored(next));
    window.history.replaceState(null, '', qs ? `/search?${qs}` : '/search');
  };
  useEffect(() => { const t = setTimeout(() => { if (draft !== s.q) apply({ q: draft }); }, 250); return () => clearTimeout(t); });
  useEffect(() => { const onPop = () => { const n = read(); setS(n); setDraft(n.q); }; window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop); }, []);

  const typeList = types.data ?? [];
  const chosen = typeList.filter((t) => s.types.includes(t.type));
  const statuses = useMemo(() => [...new Set((chosen.length ? chosen : typeList).flatMap((t) => t.statuses))], [chosen, typeList]);
  const dateLabel = chosen.length === 1 ? chosen[0].dateLabel : 'Date';
  const sites = (ctx.data?.sites ?? []).filter((x) => !s.projectId || x.projectId === Number(s.projectId));
  const counts = result.data?.counts ?? {};
  const data = result.data;
  const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const filtersOn = s.types.length + s.status.length + (s.projectId ? 1 : 0) + (s.siteId ? 1 : 0) + (s.from ? 1 : 0) + (s.to ? 1 : 0) > 0;

  const exportCsv = async () => {
    const all = [];
    for (let page = 1; page <= 20; page += 1) {
      const res = (await api.get(`/ui/search?${searchQuery({ ...params, perGroup: undefined, page, pageSize: 100 })}`)).data;
      all.push(...res.items);
      if (res.items.length < 100 || page * 100 >= res.total) break;
    }
    downloadCsv('search-results.csv', toCsv(['Type', 'Number', 'Title', 'Details', 'Status', 'Project'], all.map((i) => [typeList.find((t) => t.type === i.entity)?.label ?? i.entity, i.code ?? '', i.title, i.subtitle ?? '', i.status ?? '', i.projectCode ?? ''])));
  };
  const submitView = async (e) => {
    e.preventDefault();
    try { await saveView.mutateAsync({ name: viewName.trim(), isShared: false, shareScope: { roles: [], projects: [] }, isDefault: false, config: toView(s) }); setNotice(`Saved the filters as "${viewName.trim()}".`); setViewName(''); dialog.current?.close(); } catch { /* the message shows in the dialog */ }
  };
  const totalPages = data?.mode === 'page' ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section aria-labelledby="search-title" data-testid="advanced-search">
      <PageHeader id="search-title" title={"Advanced Search"} subtitle={"Find records, documents and people you may see. Type part of a name or number; a document number such as MR/2026-27/000123 finds that record first. Names also match when spelled in Hindi or with a small mistake."} />
      {notice && <p role="status" className="notice" data-testid="search-notice">{notice}</p>}
      <form className="srch-form" role="search" onSubmit={(e) => { e.preventDefault(); apply({ q: draft }); }}>
        <label className="field srch-q"><span>Search for</span><input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="A name, a number, a word from the text" autoFocus aria-describedby="search-help" maxLength={200} /></label>
        <label className="field"><span>Project</span>
          <select value={s.projectId} onChange={(e) => apply({ projectId: e.target.value, siteId: '' })}><option value="">All my projects</option>{(ctx.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></label>
        <label className="field"><span>Site</span>
          <select value={s.siteId} onChange={(e) => apply({ siteId: e.target.value })} disabled={sites.length === 0}><option value="">All sites</option>{sites.map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</select></label>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}><legend>Status</legend>
          <select multiple size={Math.min(4, Math.max(2, statuses.length))} aria-label="Status" value={s.status} onChange={(e) => apply({ status: [...e.target.selectedOptions].map((o) => o.value) })}>{statuses.map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</option>)}</select></fieldset>
        <label className="field"><span>{dateLabel} from</span><input type="date" value={s.from} onChange={(e) => apply({ from: e.target.value })} /></label>
        <label className="field"><span>{dateLabel} to</span><input type="date" value={s.to} min={s.from || undefined} onChange={(e) => apply({ to: e.target.value })} /></label>
        <label className="field"><span>Sort by</span><select value={s.sort} onChange={(e) => apply({ sort: e.target.value })}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <button type="submit" className="btn btn-primary">Search</button>
      </form>
      <p id="search-help" className="sr-only">Results update as you type.</p>

      <div className="srch-tools">
        <details className="lr-menu"><summary className="btn">Saved filters{views.data?.length ? ` (${views.data.length})` : ''}</summary>
          <div role="menu" className="srch-menu">
            {(views.data ?? []).length === 0 && <p className="muted small">No saved filters yet.</p>}
            {(views.data ?? []).map((v) => (
              <div key={v.id} className="srch-meta">
                <button type="button" className="btn" role="menuitem" onClick={() => { const n = fromView(v); setS(n); setDraft(n.q); window.history.replaceState(null, '', `/search?${searchQuery(stored(n))}`); }}>{v.name}</button>
                {v.mine && <button type="button" className="btn btn-small" aria-label={`Delete saved filters ${v.name}`} onClick={() => deleteView.mutate(v, { onSuccess: () => setNotice(`Deleted "${v.name}".`) })}>Delete</button>}
              </div>
            ))}
          </div>
        </details>
        <button type="button" className="btn" onClick={() => dialog.current?.showModal()} disabled={!s.q && !filtersOn}>Save these filters</button>
        <button type="button" className="btn" onClick={exportCsv} disabled={!data || data.total === 0}>Export CSV</button>
        {filtersOn && <button type="button" className="btn" onClick={() => apply({ types: [], status: [], projectId: '', siteId: '', from: '', to: '' })}>Clear filters</button>}
        {paged && <label className="field field-inline"><span>Per page</span><select value={s.pageSize} onChange={(e) => apply({ pageSize: Number(e.target.value) })}>{SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>}
      </div>

      <ul className="srch-types" aria-label="Kinds of record">
        <li><button type="button" className={`lr-chip${s.types.length === 0 ? ' is-on' : ''}`} aria-pressed={s.types.length === 0} onClick={() => apply({ types: [] })}>All</button></li>
        {typeList.map((t) => (
          <li key={t.type}><button type="button" className={`lr-chip${s.types.includes(t.type) ? ' is-on' : ''}`} aria-pressed={s.types.includes(t.type)} onClick={() => apply({ types: toggle(s.types, t.type) })}>
            <Icon name={t.icon} size={14} />{language === 'hi' && t.labelHi ? t.labelHi : t.label}{s.q && counts[t.type] !== undefined && <span className="srch-count">{counts[t.type]}</span>}</button></li>
        ))}
      </ul>

      <div aria-live="polite" aria-busy={result.isFetching}>
        {types.isSuccess && typeList.length === 0 && <EmptyState title="Nothing to search yet" message="Your role does not include any records that can be searched. Ask a system administrator if you expected to find some." />}
        {!s.q.trim() && typeList.length > 0 && <EmptyState title="Type to search" message="Try a project code, a person's name, a document number or a word from a request. Pick a kind above to narrow it." />}
        {s.q.trim() && result.isPending && <Skeleton label="Searching" rows={4} />}
        {s.q.trim() && result.isError && <ErrorState title="The search could not be completed" error={result.error} onRetry={() => result.refetch()} />}
        {data && data.total === 0 && <EmptyState title={`Nothing found for "${s.q}"`} message={filtersOn ? 'No record you may see matches with these filters. Clear a filter or check the spelling.' : 'No record you may see matches. Check the spelling, or try fewer letters.'} action={filtersOn ? { label: 'Clear filters', onClick: () => apply({ types: [], status: [], projectId: '', siteId: '', from: '', to: '' }) } : null} />}
        {data?.mode === 'grouped' && data.groups.map((g) => (
          <section key={g.type} className="srch-group" aria-labelledby={`g-${g.type}`}>
            <header><h2 id={`g-${g.type}`}><Icon name={g.icon} size={16} /> {language === 'hi' && g.labelHi ? g.labelHi : g.label} <span className="muted small">({g.total})</span></h2>
              {g.total > g.items.length && <button type="button" className="btn btn-small" onClick={() => apply({ types: [g.type] })}>Show all {g.total}</button>}</header>
            <ul className="srch-list">{g.items.map((it, n) => <Row key={it.id} item={{ ...it, icon: g.icon }} q={s.q} position={n} language={language} />)}</ul>
          </section>
        ))}
        {data?.mode === 'page' && data.total > 0 && (
          <>
            <ul className="srch-list">{data.items.map((it, n) => <Row key={it.id} item={{ ...it, icon: typeList.find((t) => t.type === it.entity)?.icon }} q={s.q} position={(data.page - 1) * data.pageSize + n} language={language} />)}</ul>
            <div className="pager">
              <span>{data.total} result{data.total === 1 ? '' : 's'}{data.capped ? ' (the first 500; narrow the search to see others)' : ''}, page {data.page} of {totalPages}</span>
              <button type="button" className="btn" disabled={s.page <= 1} onClick={() => apply({ page: s.page - 1 }, { reset: false })}>Previous</button>
              <button type="button" className="btn" disabled={s.page >= totalPages} onClick={() => apply({ page: s.page + 1 }, { reset: false })}>Next</button>
            </div>
          </>
        )}
        {data && <p className="muted small">Found in {data.took} ms. Only records your role and projects allow are searched.</p>}
      </div>

      <dialog ref={dialog} className="dialog" aria-labelledby="save-filters-title">
        <form onSubmit={submitView} method="dialog">
          <h2 id="save-filters-title">Save these filters</h2>
          <label className="field"><span>Name</span><input value={viewName} onChange={(e) => setViewName(e.target.value)} maxLength={80} required /></label>
          {saveView.isError && <p role="alert" className="error">{saveView.error.message}{saveView.error.correlationId && <> (Correlation ID: <code>{saveView.error.correlationId}</code>)</>}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => dialog.current?.close()}>Cancel</button><button type="submit" className="btn btn-primary" disabled={!viewName.trim() || saveView.isPending}>Save</button></div>
        </form>
      </dialog>
    </section>
  );
}
