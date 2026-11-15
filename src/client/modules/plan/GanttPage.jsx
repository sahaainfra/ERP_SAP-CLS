import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ConfirmDialog } from '../../platform/feedback/Dialogs.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { STATUS_TONE, fmtDate, isoOf, ordOf, pl } from './api.js';
import { SchedulePicker, useSearch } from './parts.jsx';
import ResourcesPanel from './ResourcesPanel.jsx';
import { fmtDateTime } from '../../../shared/dates.js';

// Gantt Planner (part 13.02, FR-01, FR-02, FR-05): the schedule as bars grouped by WBS node, with the critical path, progress, links, the data date and today, zoom, collapse, filters and chosen columns.
// The planner drags a bar to move it, its right edge to stretch it, its end dot onto another bar to link them, or edits the selected activity in the panel; every change is tried on the server first
// (the CPM pass there says what moves and what conflicts with the logic or a constraint), conflicts are shown before anything is saved, and the last edits can be undone. Others see it read-only.
const ZOOM = { day: 26, week: 9, month: 3, quarter: 1.1 };
const ROW = 28; const HEAD = 40;
const COLS = [{ key: 'code', w: 76 }, { key: 'name', w: 210 }, { key: 'duration', w: 46, num: true }, { key: 'start', w: 92 }, { key: 'finish', w: 92 }, { key: 'tf', w: 44, num: true }, { key: 'pct', w: 46, num: true }];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* a private window */ } } };
const useNarrow = () => { const q = '(max-width: 700px)'; const [n, setN] = useState(() => window.matchMedia?.(q).matches ?? false); useEffect(() => { const m = window.matchMedia?.(q); if (!m) return undefined; const on = () => setN(m.matches); m.addEventListener('change', on); return () => m.removeEventListener('change', on); }, []); return n; };

/** The rows: WBS nodes (with the span of their work) and their activities, as the filter and the collapsed nodes leave them. */
function buildRows(d, { collapsed, filter, q }) {
  const wbsById = new Map(d.wbs.map((w) => [w.id, w])); const text = q.trim().toLowerCase();
  const acts = d.activities.filter((a) => (filter === 'critical' ? a.critical : filter === 'open' ? !a.actualFinish : filter === 'delayed' ? a.totalFloat != null && a.totalFloat < 0 : true) && (!text || `${a.code} ${a.name}`.toLowerCase().includes(text)));
  const own = new Map(); for (const a of acts) { const k = a.wbsId && wbsById.has(a.wbsId) ? a.wbsId : 0; if (!own.has(k)) own.set(k, []); own.get(k).push(a); }
  const need = new Set(); for (const k of own.keys()) { let w = wbsById.get(k); while (w) { need.add(w.id); w = w.parentId ? wbsById.get(w.parentId) : null; } }
  const kids = new Map(); for (const w of d.wbs) if (need.has(w.id)) { const p = w.parentId && need.has(w.parentId) ? w.parentId : 0; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(w); }
  const span = new Map(); const spanOf = (id) => { if (span.has(id)) return span.get(id); let s = null; let f = null; let n = 0; for (const a of own.get(id) ?? []) { n += 1; if (a.es && (!s || a.es < s)) s = a.es; if (a.ef && (!f || a.ef > f)) f = a.ef; } for (const c of kids.get(id) ?? []) { const x = spanOf(c.id); n += x.n; if (x.s && (!s || x.s < s)) s = x.s; if (x.f && (!f || x.f > f)) f = x.f; } const out = { s, f, n }; span.set(id, out); return out; };
  const rows = [];
  const walk = (w, level) => { const sp = spanOf(w.id); rows.push({ kind: 'wbs', id: w.id, label: `${w.code} ${w.name}`, level, start: sp.s, finish: sp.f, count: sp.n }); if (collapsed.has(w.id)) return; for (const a of own.get(w.id) ?? []) rows.push({ kind: 'act', a, level: level + 1 }); for (const c of kids.get(w.id) ?? []) walk(c, level + 1); };
  for (const w of kids.get(0) ?? []) walk(w, 1);
  const loose = own.get(0) ?? []; if (loose.length) { rows.push({ kind: 'wbs', id: 0, label: null, level: 1, start: null, finish: null, count: loose.length }); if (!collapsed.has(0)) for (const a of loose) rows.push({ kind: 'act', a, level: 2 }); }
  return { rows, shown: acts.length };
}

function Timescale({ from, days, ppd, zoom, width }) {
  const marks = []; const minor = [];
  for (let o = from; o < from + days; o += 1) {
    const iso = isoOf(o); const d = Number(iso.slice(8, 10)); const m = Number(iso.slice(5, 7)); const wd = (o + 3) % 7;
    if (zoom === 'quarter' || zoom === 'month' ? d === 1 && m === 1 : d === 1) marks.push({ o, label: zoom === 'quarter' || zoom === 'month' ? iso.slice(0, 4) : `${MONTHS[m - 1]} ${iso.slice(0, 4)}` });
    if (zoom === 'day' || (zoom === 'week' && wd === 0)) minor.push({ o, label: String(d) }); else if (zoom === 'month' && d === 1) minor.push({ o, label: MONTHS[m - 1] }); else if (zoom === 'quarter' && d === 1 && [1, 4, 7, 10].includes(m)) minor.push({ o, label: `Q${(m + 2) / 3}` });
  }
  return (
    <svg width={width} height={HEAD} aria-hidden="true" style={{ display: 'block' }}>
      {marks.map((x) => <g key={`M${x.o}`}><line x1={(x.o - from) * ppd} x2={(x.o - from) * ppd} y1={0} y2={HEAD} stroke="var(--erp-color-border-subtle)" /><text x={(x.o - from) * ppd + 3} y={14} fontSize="11" fontWeight="600" fill="var(--erp-color-text-secondary)">{x.label}</text></g>)}
      {minor.map((x) => <text key={`m${x.o}`} x={(x.o - from) * ppd + 2} y={33} fontSize="10" fill="var(--erp-color-text-muted)">{x.label}</text>)}
    </svg>
  );
}

export default function GanttPage() {
  const t = useT('plan');
  usePageTitle(t('g.title'));
  const qc = useQueryClient(); const sp = useSearch(); const narrow = useNarrow();
  const [projectId, setProjectId] = useState(null); const [scheduleId, setScheduleId] = useState(Number(sp.get('scheduleId')) || null);
  const [zoom, setZoom] = useState(() => store.get('plan.gantt.zoom', 'week')); const [filter, setFilter] = useState(sp.get('filter') ?? 'all'); const [q, setQ] = useState('');
  const [cols, setCols] = useState(() => store.get('plan.gantt.cols', COLS.map((c) => c.key))); const [collapsed, setCollapsed] = useState(new Set()); const [showLinks, setShowLinks] = useState(true); const [showBase, setShowBase] = useState(true);
  const [selected, setSelected] = useState(Number(sp.get('activityId')) || null); const [note, setNote] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const [pending, setPending] = useState(null);
  const [drag, setDrag] = useState(null); const [view, setView] = useState({ top: 0, height: 600 }); const [adding, setAdding] = useState(false);
  const scrollRef = useRef(null); const dragRef = useRef(null);
  useEffect(() => store.set('plan.gantt.zoom', zoom), [zoom]); useEffect(() => store.set('plan.gantt.cols', cols), [cols]);
  const sq = useQuery({ queryKey: ['plan', 'schedule', scheduleId], queryFn: () => pl.schedule(scheduleId), enabled: Boolean(scheduleId), retry: false });
  const gq = useQuery({ queryKey: ['plan', 'gantt', scheduleId], queryFn: () => pl.gantt(scheduleId), enabled: Boolean(scheduleId), retry: false, placeholderData: (x) => (x?.schedule?.id === scheduleId ? x : undefined) });
  const d = gq.data;
  const built = useMemo(() => (d ? buildRows(d, { collapsed, filter, q }) : { rows: [], shown: 0 }), [d, collapsed, filter, q]);
  const rows = built.rows;
  const range = useMemo(() => {
    if (!d) return null; const s = d.schedule; let lo = ordOf(s.start); let hi = ordOf(s.finish ?? s.start);
    for (const a of d.activities) { if (a.es) lo = Math.min(lo, ordOf(a.es)); if (a.ef) hi = Math.max(hi, ordOf(a.ef)); }
    if (s.dataDate) { lo = Math.min(lo, ordOf(s.dataDate)); hi = Math.max(hi, ordOf(s.dataDate)); }
    const today = ordOf(s.today); if (today >= lo - 30 && today <= hi + 30) { lo = Math.min(lo, today); hi = Math.max(hi, today); }
    lo -= 2; hi += zoom === 'day' ? 7 : 21; return { from: lo, days: hi - lo + 1 };
  }, [d, zoom]);
  useEffect(() => { const el = scrollRef.current; if (!el) return undefined; const on = () => setView({ top: el.scrollTop, height: el.clientHeight }); on(); el.addEventListener('scroll', on, { passive: true }); return () => el.removeEventListener('scroll', on); }, [d]);
  if (gq.error?.status === 403) return <NoPermission what={t('g.title')} permission="plan.schedule.view" />;
  const s = d?.schedule; const canEdit = Boolean(d?.can.edit); const ppd = ZOOM[zoom];
  const shownCols = COLS.filter((c) => cols.includes(c.key) && (!narrow || ['code', 'name'].includes(c.key))).map((c) => (narrow && c.key === 'name' ? { ...c, w: 120 } : c));
  const leftW = shownCols.reduce((a, c) => a + c.w, 0); const chartW = range ? range.days * ppd : 0;
  const X = (iso) => (ordOf(iso) - range.from) * ppd;
  const first = Math.max(0, Math.floor((view.top - HEAD) / ROW) - 10); const last = Math.min(rows.length, first + Math.ceil(view.height / ROW) + 25);
  const visible = rows.slice(first, last); const rowOf = new Map(); rows.forEach((r, i) => { if (r.kind === 'act') rowOf.set(r.a.id, i); });
  const act = selected ? d?.activities.find((a) => a.id === selected) : null;

  // ---- the edit cycle: try on the server, show the conflicts, save, undo --------------------------------------------------------------------------------------
  const refresh = () => qc.invalidateQueries({ queryKey: ['plan'] });
  const save = async (body, confirm) => { const r = await pl.ganttEdit(scheduleId, { ...body, confirm }); setPending(null); setNote(r); await refresh(); };
  const run = async (body) => {
    setError(null); setNote(null); setBusy(true);
    try { const c = await pl.ganttCheck(scheduleId, body); if (c.conflicts.length) setPending({ body, check: c }); else await save(body, false); return true; } catch (x) { setError(errorInfo(x)); return false; } finally { setBusy(false); }
  };
  const undo = async () => { setError(null); setBusy(true); try { const r = await pl.ganttUndo(scheduleId); setNote({ undone: true, summary: r.summary, finishAfter: r.finish }); await refresh(); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };

  // ---- dragging: move (bar), stretch (right edge), link (end dot onto another bar) --------------------------------------------------------------------------------
  const startDrag = (e, a, mode) => { if (!canEdit || busy || e.button > 0) return; e.preventDefault(); e.stopPropagation(); const box = e.currentTarget.ownerSVGElement.getBoundingClientRect(); dragRef.current = { mode, a, x0: e.clientX, box }; e.currentTarget.ownerSVGElement.setPointerCapture?.(e.pointerId); setDrag({ mode, id: a.id, days: 0, x: e.clientX - box.left, y: e.clientY - box.top }); setSelected(a.id); };
  const onMove = (e) => { const g = dragRef.current; if (!g) return; setDrag({ mode: g.mode, id: g.a.id, days: Math.round((e.clientX - g.x0) / ppd), x: e.clientX - g.box.left, y: e.clientY - g.box.top }); };
  const onUp = (e) => {
    const g = dragRef.current; dragRef.current = null; setDrag(null); if (!g) return; const days = Math.round((e.clientX - g.x0) / ppd);
    if (g.mode === 'move' && days && g.a.es) run({ op: 'MOVE', activityId: g.a.id, start: isoOf(ordOf(g.a.es) + days) });
    if (g.mode === 'resize' && days && g.a.ef) run({ op: 'RESIZE', activityId: g.a.id, finish: isoOf(Math.max(ordOf(g.a.es ?? g.a.ef), ordOf(g.a.ef) + days)) });
    if (g.mode === 'link') { const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-act-id]'); const to = hit ? Number(hit.getAttribute('data-act-id')) : null; if (to && to !== g.a.id) run({ op: 'LINK', predId: g.a.id, succId: to, type: 'FS', lag: 0 }); }
  };
  const toggle = (id) => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const cell = (c, a) => ({ code: a.code, name: a.name, duration: a.type === 'MILESTONE' ? '0' : a.duration, start: fmtDate(a.es), finish: fmtDate(a.ef), tf: a.totalFloat ?? '—', pct: `${Math.round(a.pctComplete)}` })[c.key];

  return (
    <section aria-labelledby="pgt-h" data-testid="plan-gantt">
      <h1 id="pgt-h">{t('g.title')}</h1>
      <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('f.schedule')}>
        <SchedulePicker projectId={projectId ?? sq.data?.projectId ?? null} scheduleId={scheduleId} onProject={(v) => { setProjectId(v); setScheduleId(null); setSelected(null); }} onSchedule={(v) => { setScheduleId(v); setSelected(null); setNote(null); }} testId="pgt" />
      </form>
      {!scheduleId && <p className="muted" data-testid="pgt-choose">{t('g.choose')} <Link to="/plan/schedules">{t('g.schedules')}</Link>.</p>}
      {scheduleId && gq.isPending && <Skeleton label={t('g.title')} rows={6} />}
      {gq.isError && gq.error?.status !== 403 && <ErrorState error={gq.error} onRetry={gq.refetch} />}
      {d && range && (
        <>
          <div className="actions no-print" role="toolbar" aria-label={t('g.toolbar')} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <StatusBadge status={STATUS_TONE[s.status]} label={t(`st.${s.status}`)} />
            <Field label={t('g.zoom')} name="zoom"><select value={zoom} onChange={(e) => setZoom(e.target.value)} data-testid="pgt-zoom">{Object.keys(ZOOM).map((z) => <option key={z} value={z}>{t(`g.zoom.${z}`)}</option>)}</select></Field>
            <Field label={t('g.filter')} name="filter"><select value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="pgt-filter">{['all', 'critical', 'delayed', 'open'].map((x) => <option key={x} value={x}>{t(`g.filter.${x}`)}</option>)}</select></Field>
            <Field label={t('g.search')} name="q"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} data-testid="pgt-search" /></Field>
            <button type="button" className="btn" onClick={() => setCollapsed(new Set())} data-testid="pgt-expand">{t('g.expand')}</button>
            <button type="button" className="btn" onClick={() => setCollapsed(new Set([0, ...d.wbs.map((w) => w.id)]))} data-testid="pgt-collapse">{t('g.collapse')}</button>
            <label className="check"><input type="checkbox" checked={showLinks} onChange={(e) => setShowLinks(e.target.checked)} data-testid="pgt-links" /> {t('g.links')}</label>
            {d.baseline && <label className="check" title={`${d.baseline.docNo} · ${fmtDate(d.baseline.finish)}`}><input type="checkbox" checked={showBase} onChange={(e) => setShowBase(e.target.checked)} data-testid="pgt-baseline" /> {t('g.baseline', { n: d.baseline.baselineNo })}</label>}
            <details className="pgt-cols"><summary className="btn">{t('g.columns')}</summary><fieldset><legend className="sr-only">{t('g.columns')}</legend>{COLS.map((c) => <label key={c.key} className="check"><input type="checkbox" checked={cols.includes(c.key)} disabled={c.key === 'code'} onChange={(e) => setCols(e.target.checked ? [...cols, c.key] : cols.filter((k) => k !== c.key))} data-testid={`pgt-col-${c.key}`} /> {t(`g.col.${c.key}`)}</label>)}</fieldset></details>
            {canEdit && <button type="button" className="btn" onClick={() => setAdding(!adding)} data-testid="pgt-add">{t('g.add')}</button>}
            {canEdit && <button type="button" className="btn" onClick={undo} disabled={busy || !d.can.undo} title={d.edits.find((x) => !x.undoneAt)?.summary ?? ''} data-testid="pgt-undo">{t('g.undo')}</button>}
            {(d.can.print || d.can.export) && <button type="button" className="btn" onClick={() => navigateTo(`/plan/programme?scheduleId=${s.id}`)} data-testid="pgt-print">{t('g.print')}</button>}
            {d.can.resources && <button type="button" className="btn" onClick={() => navigateTo(`/plan/histogram?scheduleId=${s.id}`)} data-testid="pgt-histogram">{t('g.histogram')}</button>}
          </div>
          {!canEdit && <p className="muted" role="status" data-testid="pgt-readonly">{['DRAFT', 'RETURNED'].includes(s.status) ? t('g.viewOnly') : t('g.locked')}</p>}
          {s.needsCalc && <p className="mdm-banner" role="status" data-testid="pgt-stale">{t('act.needsCalc')}</p>}
          {error?.form && <p className="field-error" role="alert" data-testid="pgt-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 3).join('; ')}` : ''}{error.correlationId ? ` (${error.correlationId})` : ''}</p>}
          {note && (
            <div className="mdm-banner" role="status" data-testid="pgt-note">
              {note.undone ? t('g.undone', { s: note.summary }) : t('g.saved', { s: note.summary, n: note.changedCount })} {note.finishAfter && t('g.finishIs', { d: fmtDate(note.finishAfter) })}
              {(note.warnings ?? []).map((w) => <span key={w.code} className="muted"> · {w.message}</span>)}
              {!note.undone && d.can.undo && <> <button type="button" className="btn btn-small" onClick={undo} disabled={busy} data-testid="pgt-note-undo">{t('g.undo')}</button></>}
            </div>
          )}
          {adding && canEdit && <AddForm t={t} wbs={d.wbs} after={act} busy={busy} onAdd={async (b) => { if (await run({ op: 'ADD', ...b })) setAdding(false); }} onCancel={() => setAdding(false)} />}
          <p className="muted" data-testid="pgt-count">{t('g.count', { n: built.shown, of: d.activities.length })} · {t('f.start')} {fmtDate(s.start)} · {t('f.finish')} <strong data-testid="pgt-finish">{fmtDate(s.finish)}</strong>{s.dataDate ? ` · ${t('f.dataDate')} ${fmtDate(s.dataDate)}` : ''}{canEdit ? ` · ${t('g.howTo')}` : ''}</p>
          <Legend t={t} />
          {d.activities.length === 0 ? <p className="muted" data-testid="pgt-empty">{t('act.empty')} {canEdit && <Link to={`/plan/generate?scheduleId=${s.id}`}>{t('gen.title')}</Link>}</p> : (
            <div ref={scrollRef} className="pgt-scroll" style={{ overflow: 'auto', maxHeight: '70vh', border: '1px solid var(--erp-color-border-subtle)', borderRadius: '0.4rem', background: 'var(--erp-color-bg-surface)', maxWidth: '100%' }} data-testid="pgt-chart" aria-label={t('g.chart')} role="region" tabIndex={-1}>
              <div style={{ display: 'grid', gridTemplateColumns: `${leftW}px ${chartW}px`, width: leftW + chartW }}>
                <div style={{ position: 'sticky', top: 0, left: 0, zIndex: 4, height: HEAD, display: 'flex', alignItems: 'flex-end', background: 'var(--erp-color-bg-surface-sunken)', borderBottom: '1px solid var(--erp-color-border-subtle)' }} role="row">
                  {shownCols.map((c) => <span key={c.key} role="columnheader" style={{ width: c.w, padding: '0 6px 6px', fontWeight: 600, fontSize: '0.8rem', textAlign: c.num ? 'right' : 'left' }}>{t(`g.col.${c.key}`)}</span>)}
                </div>
                <div style={{ position: 'sticky', top: 0, zIndex: 3, height: HEAD, background: 'var(--erp-color-bg-surface-sunken)', borderBottom: '1px solid var(--erp-color-border-subtle)' }}><Timescale from={range.from} days={range.days} ppd={ppd} zoom={zoom} width={chartW} /></div>
                <div role="rowgroup" style={{ position: 'sticky', left: 0, zIndex: 2, height: rows.length * ROW, background: 'var(--erp-color-bg-surface)', borderRight: '1px solid var(--erp-color-border-subtle)' }}>
                  {visible.map((r, k) => {
                    const i = first + k; const top = i * ROW;
                    if (r.kind === 'wbs') return <div key={`w${r.id}`} role="row" style={{ position: 'absolute', top, height: ROW, width: leftW, display: 'flex', alignItems: 'center', background: 'var(--erp-color-bg-surface-sunken)' }}><button type="button" className="btn-link" onClick={() => toggle(r.id)} aria-expanded={!collapsed.has(r.id)} style={{ paddingLeft: 6 + (r.level - 1) * 12, fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: leftW - 8, textAlign: 'left' }} data-testid="pgt-wbs">{collapsed.has(r.id) ? '▸' : '▾'} {r.label ?? t('act.noWbs')} <span className="muted">({r.count})</span></button></div>;
                    const a = r.a;
                    return (
                      <div key={a.id} role="row" aria-selected={selected === a.id} style={{ position: 'absolute', top, height: ROW, width: leftW, display: 'flex', alignItems: 'center', background: selected === a.id ? 'var(--erp-color-bg-selected)' : undefined, borderBottom: '1px solid var(--erp-color-border-subtle)' }} data-testid="pgt-row" data-code={a.code}>
                        {shownCols.map((c, ci) => <span key={c.key} role="gridcell" style={{ width: c.w, padding: '0 6px', paddingLeft: ci === 0 ? 6 + (r.level - 2) * 12 : 6, fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: c.num ? 'right' : 'left', fontWeight: c.key === 'code' && a.critical ? 600 : undefined, color: c.key === 'tf' && a.totalFloat < 0 ? 'var(--erp-color-status-error-fg)' : undefined }}>{ci === 0 ? <button type="button" className="btn-link" onClick={() => setSelected(a.id)} aria-label={`${a.code} ${a.name}`} data-testid="pgt-select">{a.code}</button> : cell(c, a)}</span>)}
                      </div>
                    );
                  })}
                </div>
                <svg width={chartW} height={rows.length * ROW} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { dragRef.current = null; setDrag(null); }} style={{ display: 'block', touchAction: drag ? 'none' : 'auto', userSelect: 'none' }} data-testid="pgt-svg" aria-hidden="true">
                  {zoom === 'day' && Array.from({ length: range.days }, (_, i) => (s.workWeek[(range.from + i + 3) % 7] === '1' ? null : <rect key={`n${i}`} x={i * ppd} y={0} width={ppd} height={rows.length * ROW} fill="var(--erp-color-bg-surface-sunken)" />))}
                  {visible.map((r, k) => (r.kind === 'wbs' ? <rect key={`b${first + k}`} x={0} y={(first + k) * ROW} width={chartW} height={ROW} fill="var(--erp-color-bg-surface-sunken)" /> : null))}
                  {s.dataDate && <line x1={X(s.dataDate)} x2={X(s.dataDate)} y1={0} y2={rows.length * ROW} stroke="var(--erp-color-status-warning-solid)" strokeDasharray="5 3" strokeWidth="1.5" />}
                  {ordOf(s.today) >= range.from && ordOf(s.today) < range.from + range.days && <line x1={X(s.today) + ppd / 2} x2={X(s.today) + ppd / 2} y1={0} y2={rows.length * ROW} stroke="var(--erp-color-status-info-solid)" strokeWidth="1" />}
                  {showLinks && d.links.map((l) => {
                    const pi = rowOf.get(l.predId); const si = rowOf.get(l.succId); if (pi == null || si == null || (Math.max(pi, si) < first) || (Math.min(pi, si) > last)) return null;
                    const p = rows[pi].a; const q2 = rows[si].a; if (!p.es || !q2.es) return null;
                    const xa = l.type[0] === 'S' ? X(p.es) : X(p.ef) + (p.type === 'MILESTONE' ? 0 : ppd); const xb = l.type[1] === 'S' ? X(q2.es) : X(q2.ef) + (q2.type === 'MILESTONE' ? 0 : ppd); const ya = pi * ROW + ROW / 2; const yb = si * ROW + ROW / 2; const bx = Math.max(xa + 4, Math.min(xb - 4, xa + 6));
                    return <path key={l.id} d={`M${xa},${ya} H${bx} V${yb} H${xb}`} fill="none" stroke="var(--erp-color-text-muted)" strokeWidth="1" markerEnd="url(#pgt-arrow)" />;
                  })}
                  <defs><marker id="pgt-arrow" viewBox="0 0 6 6" refX="6" refY="3" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6 z" fill="var(--erp-color-text-muted)" /></marker></defs>
                  {visible.map((r, k) => {
                    const y = (first + k) * ROW;
                    if (r.kind === 'wbs') return r.start && r.finish ? <rect key={`s${r.id}`} x={X(r.start)} y={y + ROW / 2 - 3} width={Math.max(2, X(r.finish) + ppd - X(r.start))} height={6} fill="var(--erp-color-text-primary)" opacity="0.75" /> : null;
                    const a = r.a; if (!a.es || !a.ef) return null;
                    const dd = drag?.id === a.id ? drag : null; const shift = dd?.mode === 'move' ? dd.days * ppd : 0; const stretch = dd?.mode === 'resize' ? dd.days * ppd : 0;
                    const x = X(a.es) + shift; const w = Math.max(ppd, X(a.ef) + ppd - X(a.es) + stretch); const fill = a.critical ? 'var(--erp-color-status-error-solid)' : 'var(--erp-chart-1)';
                    const bl = showBase ? d.baseline?.dates?.[a.id] : null; // the dates of the current baseline (13.03): a thin bar under the bar of today
                    const label = `${a.code} ${a.name}: ${fmtDate(a.es)} – ${fmtDate(a.ef)}${a.critical ? ` · ${t('f.critical')}` : ''} · TF ${a.totalFloat ?? '—'}${bl ? ` · ${t('g.baselineDates', { s: fmtDate(bl[0]), f: fmtDate(bl[1]) })}` : ''}`;
                    if (a.type === 'MILESTONE') return <g key={a.id} data-act-id={a.id} onPointerDown={(e) => startDrag(e, a, 'move')} style={{ cursor: canEdit ? 'grab' : 'default' }}><title>{label}</title><path d={`M${x},${y + 6} L${x + 8},${y + ROW / 2} L${x},${y + ROW - 6} L${x - 8},${y + ROW / 2} z`} fill={a.critical ? 'var(--erp-color-status-error-solid)' : 'var(--erp-color-text-primary)'} />{canEdit && <circle cx={x + 11} cy={y + ROW / 2} r="3.5" fill="var(--erp-color-bg-surface)" stroke="var(--erp-color-text-muted)" onPointerDown={(e) => startDrag(e, a, 'link')} style={{ cursor: 'crosshair' }} data-testid="pgt-linkdot" />}</g>;
                    return (
                      <g key={a.id} data-act-id={a.id} data-testid="pgt-bar" data-code={a.code}>
                        <title>{label}</title>
                        {bl && <rect x={X(bl[0])} y={y + ROW - 5} width={Math.max(ppd, X(bl[1]) + ppd - X(bl[0]))} height={3} fill="var(--erp-color-text-muted)" pointerEvents="none" data-testid="pgt-base" />}
                        <rect x={x} y={y + 6} width={w} height={ROW - 12} rx="3" fill={fill} opacity={dd ? 0.6 : 1} stroke={selected === a.id ? 'var(--erp-color-border-focus)' : 'none'} strokeWidth="2" onPointerDown={(e) => startDrag(e, a, 'move')} onClick={() => setSelected(a.id)} style={{ cursor: canEdit ? 'grab' : 'pointer' }} />
                        {(a.actualFinish || a.pctComplete > 0) && <rect x={x} y={y + ROW / 2 - 2} width={w * (a.actualFinish ? 1 : Math.min(1, a.pctComplete / 100))} height={4} fill="var(--erp-color-text-primary)" opacity="0.55" pointerEvents="none" />}
                        {canEdit && !a.actualStart && a.type === 'TASK' && <rect x={x + w - 5} y={y + 6} width={6} height={ROW - 12} fill="transparent" onPointerDown={(e) => startDrag(e, a, 'resize')} style={{ cursor: 'ew-resize' }} data-testid="pgt-resize" />}
                        {canEdit && <circle cx={x + w + 6} cy={y + ROW / 2} r="3.5" fill="var(--erp-color-bg-surface)" stroke="var(--erp-color-text-muted)" onPointerDown={(e) => startDrag(e, a, 'link')} style={{ cursor: 'crosshair' }} data-testid="pgt-linkdot" />}
                        {zoom !== 'quarter' && <text x={x + w + 12} y={y + ROW / 2 + 4} fontSize="10" fill="var(--erp-color-text-secondary)" pointerEvents="none">{dd ? (dd.mode === 'move' ? fmtDate(isoOf(ordOf(a.es) + dd.days)) : dd.mode === 'resize' ? fmtDate(isoOf(ordOf(a.ef) + dd.days)) : '') : (narrow ? '' : a.name.slice(0, 28))}</text>}
                      </g>
                    );
                  })}
                  {drag?.mode === 'link' && <line x1={(() => { const a = d.activities.find((x) => x.id === drag.id); return a?.ef ? X(a.ef) + ppd + 6 : 0; })()} y1={(rowOf.get(drag.id) ?? 0) * ROW + ROW / 2} x2={drag.x} y2={drag.y} stroke="var(--erp-color-border-focus)" strokeWidth="1.5" strokeDasharray="4 3" pointerEvents="none" />}
                </svg>
              </div>
            </div>
          )}
          {act && <ActivityPanel key={act.id} t={t} a={act} d={d} canEdit={canEdit} busy={busy} run={run} onClose={() => setSelected(null)} />}
          {act && d.can.resources && <ResourcesPanel key={`r${act.id}`} activity={act} projectId={s.projectId} canEdit={d.can.editResources} onSaved={refresh} />}
          {d.edits.length > 0 && (
            <details className="mdm-panel" data-testid="pgt-edits"><summary>{t('g.edits')}</summary>
              <ol>{d.edits.map((x) => <li key={x.id} className={x.undoneAt ? 'muted' : ''}>{x.summary} <span className="muted">· {x.by} · {fmtDateTime(x.at)}{x.finishBefore !== x.finishAfter ? ` · ${fmtDate(x.finishBefore)} → ${fmtDate(x.finishAfter)}` : ''}{x.undoneAt ? ` · ${t('g.undoneBy', { u: x.undoneBy })}` : ''}</span></li>)}</ol>
            </details>
          )}
          <ConfirmDialog open={Boolean(pending)} title={t('g.conflictTitle')} confirmLabel={t('g.saveAnyway')} danger
            text={pending ? `${pending.check.conflicts.map((c) => c.message).join(' ')} ${t('g.wouldMove', { n: pending.check.changedCount, a: fmtDate(pending.check.finishBefore), b: fmtDate(pending.check.finishAfter) })}` : ''}
            onConfirm={() => save(pending.body, true)} onCancel={() => setPending(null)} />
        </>
      )}
    </section>
  );
}

function Legend({ t }) {
  const sw = (bg, extra = {}) => <span aria-hidden="true" style={{ display: 'inline-block', width: '1.4rem', height: '0.6rem', borderRadius: 2, background: bg, verticalAlign: 'middle', marginRight: 4, ...extra }} />;
  return (
    <p className="muted" data-testid="pgt-legend" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem', fontSize: '0.8rem' }}>
      <span>{sw('var(--erp-color-status-error-solid)')}{t('g.leg.critical')}</span><span>{sw('var(--erp-chart-1)')}{t('g.leg.normal')}</span><span>{sw('var(--erp-color-text-primary)', { height: '0.25rem', opacity: 0.6 })}{t('g.leg.progress')}</span>
      <span>◆ {t('g.leg.milestone')}</span><span>{sw('var(--erp-color-text-primary)', { height: '0.35rem', opacity: 0.75 })}{t('g.leg.summary')}</span><span>{sw('transparent', { borderTop: '2px dashed var(--erp-color-status-warning-solid)', height: 0 })}{t('f.dataDate')}</span><span>{sw('var(--erp-color-status-info-solid)', { width: 2, height: '0.8rem' })}{t('g.leg.today')}</span>
    </p>
  );
}

function AddForm({ t, wbs, after, busy, onAdd, onCancel }) {
  const [f, setF] = useState({ name: '', actType: 'TASK', duration: '1', wbsId: after?.wbsId ? String(after.wbsId) : '', afterId: after ? String(after.id) : '' });
  return (
    <form className="mdm-panel" aria-label={t('g.add')} data-testid="pgt-add-form" onSubmit={(e) => { e.preventDefault(); onAdd({ name: f.name.trim(), actType: f.actType, duration: f.actType === 'MILESTONE' ? 0 : Number(f.duration || 1), wbsId: f.wbsId ? Number(f.wbsId) : null, afterId: f.afterId ? Number(f.afterId) : null }); }}>
      <div className="form-grid">
        <Field label={t('f.name')} name="name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} maxLength={200} data-testid="pgt-add-name" /></Field>
        <Field label={t('f.type')} name="actType"><select value={f.actType} onChange={(e) => setF({ ...f, actType: e.target.value })}>{['TASK', 'MILESTONE'].map((x) => <option key={x} value={x}>{t(`type.${x}`)}</option>)}</select></Field>
        {f.actType !== 'MILESTONE' && <Field label={t('f.duration')} name="duration"><input type="number" min="1" max="5000" value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} data-testid="pgt-add-duration" /></Field>}
        <Field label={t('f.wbs')} name="wbsId"><select value={f.wbsId} onChange={(e) => setF({ ...f, wbsId: e.target.value })}><option value="">—</option>{wbs.map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}</select></Field>
        {after && <label className="check"><input type="checkbox" checked={Boolean(f.afterId)} onChange={(e) => setF({ ...f, afterId: e.target.checked ? String(after.id) : '' })} /> {t('g.addAfter', { c: after.code })}</label>}
      </div>
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={busy || f.name.trim().length < 2} data-testid="pgt-add-save">{t('g.addSave')}</button><button type="button" className="btn" onClick={onCancel}>{t('act.cancel')}</button></div>
    </form>
  );
}

/** The selected activity: its dates and floats from the server, and (for the planner) the same edits as dragging, by keyboard. */
function ActivityPanel({ t, a, d, canEdit, busy, run, onClose }) {
  const [f, setF] = useState({ name: a.name, duration: String(a.duration), start: a.es ?? '', finish: a.ef ?? '' }); const [link, setLink] = useState({ predId: '', type: 'FS', lag: '0' });
  const code = (id) => d.activities.find((x) => x.id === id)?.code ?? '?';
  const preds = d.links.filter((l) => l.succId === a.id); const succs = d.links.filter((l) => l.predId === a.id);
  const submit = (e) => { e.preventDefault(); const b = { op: 'EDIT', activityId: a.id }; if (f.name.trim() !== a.name) b.name = f.name.trim(); if (a.type === 'TASK' && Number(f.duration) !== a.duration) b.duration = Number(f.duration); if (f.start && f.start !== a.es) b.start = f.start; if (f.finish && f.finish !== a.ef && a.type === 'TASK') b.finish = f.finish; run(b); };
  return (
    <div className="mdm-panel" data-testid="pgt-panel" aria-label={`${a.code} ${a.name}`} role="region">
      <h2>{a.code} · {a.name} <button type="button" className="btn btn-small" onClick={onClose} aria-label={t('g.closePanel')}>×</button></h2>
      <dl className="kv">
        <div><dt>{t('f.type')}</dt><dd>{t(`type.${a.type}`)}</dd></div><div><dt>{t('f.es')}</dt><dd>{fmtDate(a.es)}</dd></div><div><dt>{t('f.ef')}</dt><dd>{fmtDate(a.ef)}</dd></div><div><dt>{t('f.ls')}</dt><dd>{fmtDate(a.ls)}</dd></div><div><dt>{t('f.lf')}</dt><dd>{fmtDate(a.lf)}</dd></div>
        <div><dt>{t('f.tf')}</dt><dd data-testid="pgt-panel-tf">{a.totalFloat ?? '—'}</dd></div><div><dt>{t('f.ff')}</dt><dd>{a.freeFloat ?? '—'}</dd></div><div><dt>{t('g.constraint')}</dt><dd>{a.constraintType === 'NONE' ? '—' : `${t(`con.${a.constraintType}`)} ${fmtDate(a.constraintDate)}`}</dd></div>
        <div><dt>%</dt><dd>{a.pctComplete}</dd></div>
      </dl>
      <p className="muted">{t('g.preds')}: {preds.length ? preds.map((l) => <span key={l.id}>{code(l.predId)} {l.type}{l.lag ? (l.lag > 0 ? `+${l.lag}` : l.lag) : ''}{canEdit && <button type="button" className="btn-link" onClick={() => run({ op: 'UNLINK', linkId: l.id })} aria-label={t('g.unlink', { c: code(l.predId) })} data-testid="pgt-unlink"> ×</button>} </span>) : '—'} · {t('g.succs')}: {succs.length ? succs.map((l) => `${code(l.succId)} ${l.type}`).join(', ') : '—'}</p>
      {canEdit && (
        <>
          <form onSubmit={submit} aria-label={t('g.editActivity')} data-testid="pgt-edit-form">
            <div className="form-grid">
              <Field label={t('f.name')} name="name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={200} data-testid="pgt-edit-name" /></Field>
              {a.type === 'TASK' && <Field label={t('f.duration')} name="duration"><input type="number" min="1" max="5000" value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} disabled={Boolean(a.actualStart)} data-testid="pgt-edit-duration" /></Field>}
              {['TASK', 'MILESTONE'].includes(a.type) && <Field label={t('f.start')} name="start"><input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} disabled={Boolean(a.actualStart)} data-testid="pgt-edit-start" /></Field>}
              {a.type === 'TASK' && <Field label={t('f.finish')} name="finish"><input type="date" value={f.finish} onChange={(e) => setF({ ...f, finish: e.target.value })} disabled={Boolean(a.actualStart)} data-testid="pgt-edit-finish" /></Field>}
            </div>
            <div className="actions"><button type="submit" className="btn btn-primary" disabled={busy} data-testid="pgt-edit-save">{t('g.apply')}</button>{!a.actualStart && <button type="button" className="btn btn-danger" disabled={busy} onClick={() => { if (window.confirm(t('g.deleteConfirm', { c: a.code }))) run({ op: 'DELETE', activityId: a.id }); }} data-testid="pgt-delete">{t('g.delete')}</button>}</div>
          </form>
          <form className="form-grid" onSubmit={(e) => { e.preventDefault(); if (link.predId) run({ op: 'LINK', predId: Number(link.predId), succId: a.id, type: link.type, lag: Number(link.lag || 0) }); }} aria-label={t('act.addPred')} data-testid="pgt-link-form">
            <Field label={t('g.pred')} name="predId"><select value={link.predId} onChange={(e) => setLink({ ...link, predId: e.target.value })} data-testid="pgt-link-pred"><option value="">—</option>{d.activities.filter((x) => x.id !== a.id).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name.slice(0, 40)}</option>)}</select></Field>
            <Field label={t('act.linkType')} name="type"><select value={link.type} onChange={(e) => setLink({ ...link, type: e.target.value })}>{['FS', 'SS', 'FF', 'SF'].map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
            <Field label={t('act.lag')} name="lag"><input type="number" min="-999" max="999" value={link.lag} onChange={(e) => setLink({ ...link, lag: e.target.value })} /></Field>
            <div className="actions"><button type="submit" className="btn" disabled={busy || !link.predId} data-testid="pgt-link-save">{t('act.addPred')}</button></div>
          </form>
        </>
      )}
    </div>
  );
}
