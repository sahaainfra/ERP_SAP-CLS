import { useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { FRONT_TONE, WA_STATUSES, WA_TONE, fmtDate, fmtQty, st, today } from './api.js';
import { SiteDay, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Site Work Board (part 14.01, FR-06): the work authorised on a site for a day, by work front, for a tablet on site. A WA in draft is dragged to another front (the server checks the move;
// Undo moves it back). Filters by status, a compact zoom, a legend and printing.
/** The work fronts of a site (FR-01): their location, the activities still open there, the status and the open constraints; added and renamed by those who manage fronts. */
function Fronts({ t, siteId }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['site', 'fronts', siteId], queryFn: () => st.fronts(siteId), retry: false });
  const oq = useQuery({ queryKey: ['site', 'options', siteId, 'fronts'], queryFn: () => st.options(siteId, today()), retry: false });
  const [f, setF] = useState({ code: '', name: '', locationId: '' }); const [error, setError] = useState(null);
  const run = async (fn) => { setError(null); try { await fn(); qc.invalidateQueries({ queryKey: ['site'] }); return true; } catch (e) { setError(errorInfo(e)); return false; } };
  if (q.isPending) return <Skeleton label={t('wf.title')} rows={2} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return (
    <div className="mdm-panel" data-testid="wf-panel"><h2>{t('wf.title')}</h2>
      {q.data.fronts.length === 0 ? <p className="muted">{t('wf.empty')}</p> : (
        <div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('wf.title')}</caption><thead><tr><th>{t('wf.code')}</th><th>{t('wf.name')}</th><th>{t('wf.location')}</th><th>{t('f.status')}</th><th>{t('wf.activities')}</th><th>{t('wf.constraints')}</th>{q.data.canManage && <th><span className="sr-only">{t('act.actions')}</span></th>}</tr></thead>
          <tbody>{q.data.fronts.map((x) => <tr key={x.id} data-testid="wf-row"><td>{x.code}</td><td>{x.name}</td><td>{x.location ?? '—'}</td><td><StatusBadge status={FRONT_TONE[x.status]} label={t(`fs.${x.status}`)} /></td><td>{x.activities.map((a) => `${a.code} (${a.pct} %)`).join(', ') || '—'}</td><td>{x.constraintsSummary ?? '—'}</td>
            {q.data.canManage && <td><button type="button" className="btn" onClick={() => { const n = window.prompt(t('wf.rename'), x.name); if (n && n.trim().length >= 2) run(() => st.updateFront(x.id, { name: n.trim(), rowVersion: x.rowVersion })); }}>{t('wf.renameBtn')}</button> <button type="button" className="btn" onClick={() => window.confirm(t('wf.removeAsk')) && run(() => st.removeFront(x.id))}>{t('act.remove')}</button></td>}</tr>)}</tbody></table></div>
      )}
      {q.data.canManage && (
        <form className="form-grid" onSubmit={async (e) => { e.preventDefault(); if (await run(() => st.createFront({ siteId, code: f.code.trim(), name: f.name.trim(), locationId: f.locationId ? Number(f.locationId) : null }))) setF({ code: '', name: '', locationId: '' }); }} aria-label={t('wf.add')}>
          <Field label={t('wf.code')} name="code" error={error}><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required maxLength={30} data-testid="wf-code" /></Field>
          <Field label={t('wf.name')} name="name" error={error}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} maxLength={120} data-testid="wf-name" /></Field>
          <Field label={t('wf.location')} name="locationId" error={error}><select value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })} data-testid="wf-location"><option value="">—</option>{(oq.data?.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select></Field>
          <div className="actions"><button type="submit" className="btn" data-testid="wf-add">{t('wf.add')}</button></div>
        </form>
      )}
      {error?.form && <p className="field-error" role="alert">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
    </div>
  );
}

export default function BoardPage() {
  const t = useT('site'); usePageTitle(t('bd.title'));
  const sp = useSearch(); const qc = useQueryClient();
  const [siteId, setSiteId] = useState(Number(sp.get('siteId')) || null); const [date, setDate] = useState(sp.get('date') ?? today());
  const [status, setStatus] = useState(''); const [compact, setCompact] = useState(false); const [undo, setUndo] = useState(null); const [error, setError] = useState(null); const [over, setOver] = useState(null); const [fronts, setFronts] = useState(false);
  const dragged = useRef(null);
  const q = useQuery({ queryKey: ['site', 'board', siteId, date], queryFn: () => st.board(siteId, date), enabled: Boolean(siteId), retry: false });
  const onSite = useCallback((v) => setSiteId(v), []);
  const move = async (waId, to, from, back = false) => {
    setError(null); try { await st.move(waId, to); setUndo(back ? null : { waId, from, to }); qc.invalidateQueries({ queryKey: ['site'] }); } catch (e) { setError(errorInfo(e)); }
  };
  if (q.error?.status === 403) return <NoPermission what={t('bd.title')} permission="site.work_authorisation.view" />;
  const b = q.data; const show = (w) => !status || w.status === status;
  const Card = ({ w, lane }) => (
    <li className="mdm-panel" style={{ padding: compact ? 6 : 10, margin: '6px 0', cursor: w.movable && b.can.move ? 'grab' : 'default', borderLeft: w.emergency ? '4px solid var(--erp-color-status-warning-solid)' : undefined }} draggable={w.movable && b.can.move}
      onDragStart={(e) => { dragged.current = { id: w.id, from: lane }; e.dataTransfer.setData('text/plain', String(w.id)); }} data-testid="bd-card" data-wa={w.waNo} data-status={w.status}>
      <div><Link to={`/site/work-authorisations?id=${w.id}`}>{w.waNo}</Link> <StatusBadge status={WA_TONE[w.status]} label={t(`wst.${w.status}`)} />{w.overdue && <> <StatusBadge status="OVERDUE" label={t('wa.overdue')} /></>}</div>
      <div><strong>{w.activity}</strong></div>
      {!compact && <div className="muted">{w.startTime}–{w.endTime} · {fmtQty(w.plannedQty)} {w.uom ?? ''}{w.actualQty != null ? ` · ${t('wa.done')} ${fmtQty(w.actualQty)}` : ''} · {w.supervisor}</div>}
      {!compact && w.crews.length > 0 && <div className="muted">{w.crews.join('; ')}</div>}
      {(w.checksFailed > 0 || !w.inPlan) && <div className="muted">{w.checksFailed > 0 ? t('bd.failed', { n: w.checksFailed }) : ''}{!w.inPlan ? ` ${w.emergency ? t('wa.emergency') : t('wa.outside')}` : ''}</div>}
      {w.movable && b.can.move && b.lanes.length > 1 && (
        <label className="sr-only">{t('bd.moveTo')}<select value={lane ?? ''} onChange={(e) => move(w.id, e.target.value ? Number(e.target.value) : null, lane)}><option value="">{t('bd.noFront')}</option>{b.lanes.map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select></label>
      )}
    </li>
  );
  const Lane = ({ id, title, sub, tone, toneLabel, items, summary }) => (
    <section className="mdm-panel" style={{ minWidth: 240, flex: '1 1 260px', outline: over === (id ?? 'none') ? '2px dashed var(--erp-color-focus)' : undefined }} aria-label={title} data-testid="bd-lane" data-front={title}
      onDragOver={(e) => { if (dragged.current) { e.preventDefault(); setOver(id ?? 'none'); } }} onDragLeave={() => setOver(null)}
      onDrop={(e) => { e.preventDefault(); setOver(null); const d = dragged.current; dragged.current = null; if (d && d.from !== id) move(d.id, id, d.from); }}>
      <h2 style={{ fontSize: '1rem' }}>{title} {tone && <StatusBadge status={tone} label={toneLabel} />}</h2>
      {sub && <p className="muted">{sub}</p>}{summary && <p className="muted" data-testid="bd-constraints">{summary}</p>}
      {items.length === 0 ? <p className="muted">{t('bd.none')}</p> : <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{items.map((w) => <Card key={w.id} w={w} lane={id} />)}</ul>}
    </section>
  );
  return (
    <section aria-labelledby="bd-h" data-testid="site-board" style={compact ? { fontSize: '0.9em' } : undefined}>
      <PageHeader id="bd-h" title={t('bd.title')} />
      <div className="no-print"><SiteDay siteId={siteId} date={date} onSite={onSite} onDate={setDate} testId="bd" /></div>
      <div className="actions-row no-print">
        <Field label={t('f.status')} name="status"><select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="bd-status"><option value="">{t('f.all')}</option>{WA_STATUSES.map((k) => <option key={k} value={k}>{t(`wst.${k}`)}</option>)}</select></Field>
        <button type="button" className="btn" aria-pressed={compact} onClick={() => setCompact(!compact)} data-testid="bd-zoom">{compact ? t('bd.zoomIn') : t('bd.zoomOut')}</button>
        <button type="button" className="btn" disabled={!undo} onClick={() => undo && move(undo.waId, undo.from, undo.to, true)} data-testid="bd-undo">{t('bd.undo')}</button>
        <button type="button" className="btn" onClick={() => window.print()} data-testid="bd-print">{t('act.print')}</button>
        {b?.can.create && <Link to={`/site/work-authorisations?new=1&siteId=${siteId}&date=${date}`}>{t('wa.new')}</Link>}
        {siteId && <button type="button" className="btn" aria-expanded={fronts} onClick={() => setFronts(!fronts)} data-testid="bd-fronts">{t('wf.title')}</button>}
      </div>
      {error?.form && <p className="field-error" role="alert" data-testid="bd-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {fronts && siteId && <Fronts t={t} siteId={siteId} />}
      {!siteId && <p className="muted" data-testid="bd-pick">{t('f.chooseSiteFirst')}</p>}
      {siteId && q.isPending && <Skeleton label={t('bd.title')} rows={4} />}
      {q.isError && q.error?.status !== 403 && <ErrorState error={q.error} onRetry={q.refetch} />}
      {b && (
        <>
          <p data-testid="bd-totals">{b.site.projectCode} · {b.site.code} {b.site.name} · {fmtDate(b.date)}: {t('bd.totals', { a: b.totals.authorised, w: b.totals.waiting, d: b.totals.draft, c: b.totals.closed, e: b.totals.emergencies })}</p>
          <p className="muted" data-testid="bd-legend">{t('bd.legend')} {['APPROVED', 'EMERGENCY', 'SUBMITTED', 'DRAFT', 'CLOSED'].map((k) => <span key={k} style={{ marginRight: 8 }}><StatusBadge status={WA_TONE[k]} label={t(`wst.${k}`)} /></span>)}</p>
          {b.lanes.length === 0 && b.unassigned.length === 0 ? <p className="muted" data-testid="bd-empty">{t('bd.empty')} {b.can.create && <Link to={`/site/daily-plans?siteId=${siteId}&date=${date}`}>{t('dp.title')}</Link>}</p> : (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {b.lanes.map((l) => <Lane key={l.id} id={l.id} title={`${l.code} ${l.name}`} sub={l.location} tone={FRONT_TONE[l.status]} toneLabel={t(`fs.${l.status}`)} summary={l.constraintsSummary} items={l.was.filter(show)} />)}
              {(b.unassigned.length > 0 || b.lanes.length === 0) && <Lane id={null} title={t('bd.noFront')} items={b.unassigned.filter(show)} />}
            </div>
          )}
        </>
      )}
    </section>
  );
}
