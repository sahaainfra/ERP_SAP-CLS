import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { CONSTRAINT_TYPES, fmtDate, pl } from './api.js';
import { SchedulePicker, useSearch } from './parts.jsx';

// Look-ahead Board (part 13.04, FR-01, FR-03): the activities of the next weeks, a column for each week, each card with its open constraints and whether it is ready. A card is moved to another week by
// dragging it (or with its "Move to week" choice): the move is the Gantt edit of 13.02, tried on the server first (the changed dates and the conflicts are shown) and undone from the same bar.
// Ready cards are ticked and taken into a weekly plan.
const WEEKS = [2, 3, 4, 6, 8, 12];

function Card({ t, a, canMove, columns, picked, onPick, onMove, onAdd, canAdd }) {
  return (
    <li className={`la-card${a.ready ? '' : ' la-blocked'}`} draggable={canMove} onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(a.id)); e.dataTransfer.effectAllowed = 'move'; }} data-testid="la-card" data-code={a.code} data-ready={a.ready ? '1' : '0'}
      style={{ listStyle: 'none', border: `1px solid ${a.ready ? 'var(--erp-color-border-subtle)' : 'var(--erp-color-status-error-solid)'}`, borderRadius: 6, padding: 8, marginBottom: 8, background: 'var(--erp-color-bg-surface)' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
        {a.ready && <input type="checkbox" checked={picked} onChange={() => onPick(a.id)} aria-label={t('la.pick', { c: a.code })} data-testid="la-pick" />}
        <strong>{a.code}</strong> <span>{a.name}</span>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>{fmtDate(a.es)} – {fmtDate(a.ef)} · {t('f.dur')} {a.duration}{a.totalFloat != null ? ` · TF ${a.totalFloat}` : ''}{a.critical ? ` · ${t('f.critical')}` : ''}{a.location ? ` · ${a.location}` : ''}{a.started ? ` · ${Math.round(a.pctComplete)} %` : ''}</div>
      <div data-testid="la-status" style={{ marginTop: 4 }}>
        {a.ready ? <span style={{ color: 'var(--erp-color-status-success-fg, var(--erp-color-text-primary))' }}>✓ {t('la.ready')}</span> : <span style={{ color: 'var(--erp-color-status-error-fg)' }}>⚠ {t('la.blocked', { n: a.constraints.length })}</span>}
      </div>
      {a.constraints.length > 0 && <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 12 }}>{a.constraints.map((c) => <li key={c.id} data-testid="la-constraint"><strong>{t(`ct.${c.type}`)}</strong>{c.overdue ? ` · ${t('la.overdue')}` : ''}: {c.description}{c.owner ? ` · ${c.owner}` : ''}{c.dueDate ? ` · ${fmtDate(c.dueDate)}` : ''}</li>)}</ul>}
      <div className="no-print" style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        {canMove && <label className="sr-only" htmlFor={`mv-${a.id}`}>{t('la.moveTo')}</label>}
        {canMove && <select id={`mv-${a.id}`} value="" onChange={(e) => e.target.value && onMove(a, e.target.value)} data-testid="la-move"><option value="">{t('la.moveTo')}</option>{columns.filter((c) => c.weekStart !== a.week).map((c) => <option key={c.weekStart} value={c.weekStart}>{fmtDate(c.weekStart)}</option>)}</select>}
        {canAdd && <button type="button" className="btn" onClick={() => onAdd(a)} data-testid="la-add-constraint">{t('la.addConstraint')}</button>}
      </div>
    </li>
  );
}

export default function LookaheadPage() {
  const t = useT('plan');
  usePageTitle(t('la.title'));
  const sp = useSearch(); const qc = useQueryClient();
  const [projectId, setProjectId] = useState(null); const [scheduleId, setScheduleId] = useState(Number(sp.get('scheduleId')) || null);
  const [weeks, setWeeks] = useState(6); const [siteId, setSiteId] = useState(''); const [locationId, setLocationId] = useState(''); const [onlyBlocked, setOnlyBlocked] = useState(false); const [q, setQ] = useState('');
  const [picked, setPicked] = useState([]); const [move, setMove] = useState(null); const [adding, setAdding] = useState(null); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false); const [lastEdit, setLastEdit] = useState(false);
  const sq = useQuery({ queryKey: ['plan', 'schedule', scheduleId], queryFn: () => pl.schedule(scheduleId), enabled: Boolean(scheduleId), retry: false });
  const pid = projectId ?? sq.data?.projectId ?? null;
  const oq = useQuery({ queryKey: ['plan', 'la-options', pid], queryFn: () => pl.lookaheadOptions(pid), enabled: Boolean(pid), retry: false });
  const qs = new URLSearchParams({ weeks: String(weeks), ...(siteId ? { siteId } : {}), ...(locationId ? { locationId } : {}), ...(onlyBlocked ? { onlyBlocked: 'true' } : {}), ...(q.trim() ? { q: q.trim() } : {}) }).toString();
  const bq = useQuery({ queryKey: ['plan', 'lookahead', scheduleId, qs], queryFn: () => pl.lookahead(scheduleId, qs), enabled: Boolean(scheduleId), retry: false, placeholderData: (x) => x });
  if (bq.error?.status === 403 || oq.error?.status === 403) return <NoPermission what={t('la.title')} permission="plan.lookahead.view" />;
  const d = bq.data; const can = d?.can ?? {};
  const refresh = () => qc.invalidateQueries({ queryKey: ['plan'] });
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(typeof done === 'function' ? done(x) : done); refresh(); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const tryMove = async (a, weekStart) => { setError(null); setNote(null); setBusy(true); try { setMove({ a, weekStart, check: await pl.ganttCheck(scheduleId, { op: 'MOVE', activityId: a.id, start: weekStart }) }); } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); } };
  const doMove = async () => { const ok = await run(() => pl.ganttEdit(scheduleId, { op: 'MOVE', activityId: move.a.id, start: move.weekStart, confirm: move.check.conflicts.length > 0 }), t('la.moved', { c: move.a.code })); if (ok) { setMove(null); setLastEdit(true); } };
  const cols = d?.columns ?? []; const toggle = (id) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const onDrop = (e, weekStart) => { e.preventDefault(); const a = d.activities.find((x) => x.id === Number(e.dataTransfer.getData('text/plain'))); if (a && a.week !== weekStart && can.move) tryMove(a, weekStart); };
  return (
    <section aria-labelledby="la-h" data-testid="plan-lookahead">
      <h1 id="la-h">{t('la.title')}</h1>
      <p className="muted">{t('la.intro')}</p>
      <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('act.filters')}>
        <SchedulePicker projectId={pid} scheduleId={scheduleId} onProject={(v) => { setProjectId(v); setScheduleId(null); setPicked([]); }} onSchedule={(v) => { setScheduleId(v); setPicked([]); }} testId="la" />
        {oq.data && !scheduleId && oq.data.scheduleId && <p><button type="button" className="btn" onClick={() => setScheduleId(oq.data.scheduleId)} data-testid="la-use-current">{t('la.useCurrent', { s: oq.data.schedule.docNo })}</button></p>}
        <div className="form-grid">
          <Field label={t('la.weeks')} name="weeks"><select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} data-testid="la-weeks">{WEEKS.map((n) => <option key={n} value={n}>{t('la.nWeeks', { n })}</option>)}</select></Field>
          <Field label={t('la.site')} name="siteId"><select value={siteId} onChange={(e) => setSiteId(e.target.value)} data-testid="la-site"><option value="">{t('la.allSites')}</option>{(oq.data?.sites ?? []).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</select></Field>
          <Field label={t('la.front')} name="locationId"><select value={locationId} onChange={(e) => setLocationId(e.target.value)} data-testid="la-front"><option value="">{t('la.allFronts')}</option>{(oq.data?.locations ?? []).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</select></Field>
          <Field label={t('act.search')} name="q"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} data-testid="la-search" /></Field>
          <label className="check"><input type="checkbox" checked={onlyBlocked} onChange={(e) => setOnlyBlocked(e.target.checked)} data-testid="la-only-blocked" /> {t('la.onlyBlocked')}</label>
        </div>
        {d && (
          <div className="actions">
            {can.detect && <button type="button" className="btn" disabled={busy} onClick={() => run(() => pl.detect(scheduleId), (x) => t('la.detected', { r: x.raised, c: x.cleared }))} data-testid="la-detect">{t('la.detect')}</button>}
            {can.save && <button type="button" className="btn" disabled={busy} onClick={() => run(() => pl.saveLookahead(scheduleId, { weeks, siteId: siteId ? Number(siteId) : null, locationId: locationId ? Number(locationId) : null, from: d.from }), t('la.saved'))} data-testid="la-save">{t('la.save')}</button>}
            {can.plan && <button type="button" className="btn btn-primary" disabled={picked.length === 0} onClick={() => navigateTo(`/plan/weekly?scheduleId=${scheduleId}&week=${d.from}&add=${picked.join(',')}${siteId ? `&siteId=${siteId}` : ''}`)} data-testid="la-plan">{t('la.plan', { n: picked.length })}</button>}
            {lastEdit && can.move && <button type="button" className="btn" disabled={busy} onClick={() => run(() => pl.ganttUndo(scheduleId), t('la.undone')).then((x) => x && setLastEdit(false))} data-testid="la-undo">{t('g.undo')}</button>}
            <Link to={`/plan/constraints?scheduleId=${scheduleId}`}>{t('con.title')}</Link>
          </div>
        )}
      </form>
      {!scheduleId && <p className="muted" data-testid="la-choose">{t('la.choose')}</p>}
      {scheduleId && bq.isPending && <Skeleton label={t('la.title')} rows={5} />}
      {bq.isError && bq.error?.status !== 403 && <ErrorState error={bq.error} onRetry={bq.refetch} />}
      {error?.form && <p className="field-error" role="alert" data-testid="la-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 3).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="la-note">{note}</p>}
      {move && (
        <div className="mdm-panel" role="dialog" aria-label={t('la.moveCheck')} data-testid="la-move-panel">
          <h2>{t('la.moveTitle', { c: move.a.code, d: fmtDate(move.weekStart) })}</h2>
          {move.check.conflicts.map((c, i) => <p key={i} className="field-error" role="alert" data-testid="la-conflict">{c.message}</p>)}
          {move.check.warnings.map((c, i) => <p key={i} className="muted">{c.message}</p>)}
          <p>{t('la.moveFinish', { a: fmtDate(move.check.finishBefore), b: fmtDate(move.check.finishAfter) })}</p>
          {move.check.changed.length > 0 && <ul>{move.check.changed.slice(0, 8).map((x) => <li key={x.code}>{x.code}: {fmtDate(x.es)} – {fmtDate(x.ef)}</li>)}</ul>}
          <div className="actions"><button type="button" className="btn btn-primary" disabled={busy} onClick={doMove} data-testid="la-move-apply">{move.check.conflicts.length ? t('la.moveAnyway') : t('la.moveApply')}</button><button type="button" className="btn" onClick={() => setMove(null)} data-testid="la-move-cancel">{t('act.cancel')}</button></div>
        </div>
      )}
      {adding && (
        <form className="mdm-panel" onSubmit={async (e) => { e.preventDefault(); if (await run(() => pl.createConstraint({ activityId: adding.a.id, type: adding.type, description: adding.description.trim(), owner: adding.owner.trim() || null, dueDate: adding.dueDate || null }), t('la.constraintAdded'))) setAdding(null); }} data-testid="la-constraint-form" aria-label={t('la.addConstraint')}>
          <h2>{t('la.addFor', { c: adding.a.code })}</h2>
          <div className="form-grid">
            <Field label={t('f.type')} name="type"><select value={adding.type} onChange={(e) => setAdding({ ...adding, type: e.target.value })} data-testid="la-ctype">{CONSTRAINT_TYPES.map((k) => <option key={k} value={k}>{t(`ct.${k}`)}</option>)}</select></Field>
            <Field label={t('con.owner')} name="owner"><input value={adding.owner} onChange={(e) => setAdding({ ...adding, owner: e.target.value })} maxLength={60} data-testid="la-cowner" /></Field>
            <Field label={t('con.due')} name="dueDate"><input type="date" value={adding.dueDate} onChange={(e) => setAdding({ ...adding, dueDate: e.target.value })} data-testid="la-cdue" /></Field>
          </div>
          <Field label={t('f.name')} name="description"><input value={adding.description} onChange={(e) => setAdding({ ...adding, description: e.target.value })} required minLength={3} maxLength={500} data-testid="la-cdesc" /></Field>
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="la-csave">{t('act.save')}</button><button type="button" className="btn" onClick={() => setAdding(null)}>{t('act.cancel')}</button></div>
        </form>
      )}
      {d && (
        <>
          {d.schedule.needsCalc && <p className="mdm-banner" role="status">{t('act.needsCalc')}</p>}
          <dl className="kv" data-testid="la-summary">
            <div><dt>{t('f.schedule')}</dt><dd>{d.schedule.docNo} v{d.schedule.versionNo}</dd></div><div><dt>{t('la.window')}</dt><dd>{fmtDate(d.from)} – {fmtDate(d.to)}</dd></div><div><dt>{t('f.activities')}</dt><dd data-testid="la-n">{d.summary.activities}</dd></div>
            <div><dt>{t('la.ready')}</dt><dd data-testid="la-n-ready">{d.summary.ready}{d.summary.readyPct != null ? ` (${d.summary.readyPct} %)` : ''}</dd></div><div><dt>{t('la.blockedLabel')}</dt><dd data-testid="la-n-blocked">{d.summary.blocked}</dd></div><div><dt>{t('la.openConstraints')}</dt><dd>{d.summary.constraints}{d.summary.overdue ? ` · ${t('la.nOverdue', { n: d.summary.overdue })}` : ''}</dd></div>
          </dl>
          <p className="muted"><span aria-hidden="true">✓</span> {t('la.ready')} · <span aria-hidden="true">⚠</span> {t('la.blockedLabel')} · {can.move ? t('la.dragHint') : t('la.readOnly')}</p>
          {d.activities.length === 0 && <p className="muted" data-testid="la-empty">{t('la.empty')}</p>}
          <div className="table-scroll"><div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols.length}, minmax(240px, 1fr))`, gap: 12, minWidth: cols.length * 252 }} data-testid="la-board">
            {cols.map((c) => (
              <section key={c.weekStart} aria-label={t('la.weekOf', { d: fmtDate(c.weekStart) })} onDragOver={(e) => can.move && e.preventDefault()} onDrop={(e) => onDrop(e, c.weekStart)} data-testid="la-col" data-week={c.weekStart} style={{ background: 'var(--erp-color-bg-surface-sunken)', borderRadius: 8, padding: 8 }}>
                <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>{fmtDate(c.weekStart)} <span className="muted">· {c.activities} · ✓ {c.ready} · ⚠ {c.blocked}</span></h2>
                <ul style={{ margin: 0, padding: 0 }}>{d.activities.filter((a) => a.week === c.weekStart).map((a) => <Card key={a.id} t={t} a={a} canMove={can.move} columns={cols} picked={picked.includes(a.id)} onPick={toggle} onMove={tryMove} onAdd={(x) => setAdding({ a: x, type: 'ACCESS', description: '', owner: '', dueDate: '' })} canAdd={can.addConstraint} />)}</ul>
              </section>
            ))}
          </div></div>
        </>
      )}
    </section>
  );
}
