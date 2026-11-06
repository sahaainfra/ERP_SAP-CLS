import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { EmptyState, ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, errorInfo } from '../core/pages/ui.jsx';
import { TYPES, bd, dayIST } from './api.js';

/** The tabs of an object page (Details, Interactions, Documents, Approvals, Timeline, Related): a tab list a keyboard can walk with the arrow keys. */
export function Tabs({ tabs, active, onChange, label }) {
  const t = useT('bd');
  const move = (e, i) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length; onChange(tabs[n]); document.getElementById(`tab-${tabs[n]}`)?.focus(); } };
  return (
    <div role="tablist" aria-label={label} className="tabs no-print" data-testid="tabs">
      {tabs.map((k, i) => <button key={k} id={`tab-${k}`} type="button" role="tab" aria-selected={active === k} tabIndex={active === k ? 0 : -1} className={`btn${active === k ? ' btn-primary' : ''}`} onClick={() => onChange(k)} onKeyDown={(e) => move(e, i)} data-testid={`tab-${k}`}>{t(`tab.${k}`)}</button>)}
    </div>
  );
}

/** FR-03: the interactions of a lead, an opportunity or a client, and the form to log one with its next action (which makes a reminder task). */
export function InteractionsPanel({ entity, entityId, canLog }) {
  const t = useT('bd');
  const qc = useQueryClient();
  const key = ['bd', 'interactions', entity, entityId];
  const q = useQuery({ queryKey: key, queryFn: () => bd.interactions(entity, entityId), retry: false });
  const blank = { type: 'CALL', date: dayIST(0), participants: '', notes: '', emailRef: '', nextAction: '', nextActionDate: '' };
  const [v, setV] = useState(blank); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); setNote(done); qc.invalidateQueries({ queryKey: ['bd'] }); } catch (e) { setError(errorInfo(e)); } };
  const submit = (e) => { e.preventDefault(); run(async () => { await bd.logInteraction({ entity, entityId, type: v.type, date: v.date, participants: v.participants.split(',').map((x) => x.trim()).filter(Boolean), notes: v.notes.trim(), emailRef: v.emailRef.trim() || null, nextAction: v.nextAction.trim() || null, nextActionDate: v.nextActionDate || null }); setV(blank); }, t('int.logged')); };
  return (
    <div data-testid="interactions">
      {error?.form && <p className="field-error" role="alert" data-testid="int-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="int-note">{note}</p>}
      {canLog && (
        <form className="mdm-panel mdm-fields no-print" onSubmit={submit} data-testid="int-form" aria-label={t('int.log')}>
          <h2>{t('int.log')}</h2>
          <Field label={t('int.type')} name="type" error={error}><select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })} data-testid="int-type">{TYPES.map((k) => <option key={k} value={k}>{t(`itype.${k}`)}</option>)}</select></Field>
          <Field label={t('int.date')} name="date" error={error}><input type="date" value={v.date} max={dayIST(0)} onChange={(e) => setV({ ...v, date: e.target.value })} data-testid="int-date" /></Field>
          <Field label={t('int.participants')} name="participants" error={error} hint={t('int.participantsHint')}><input value={v.participants} onChange={(e) => setV({ ...v, participants: e.target.value })} data-testid="int-participants" /></Field>
          <Field label={t('int.notes')} name="notes" error={error}><textarea rows="3" value={v.notes} maxLength={2000} onChange={(e) => setV({ ...v, notes: e.target.value })} required data-testid="int-notes" /></Field>
          {v.type === 'EMAIL' && <Field label={t('int.emailRef')} name="emailRef" error={error}><input value={v.emailRef} onChange={(e) => setV({ ...v, emailRef: e.target.value })} data-testid="int-email" /></Field>}
          <Field label={t('int.next')} name="nextAction" error={error}><input value={v.nextAction} maxLength={200} onChange={(e) => setV({ ...v, nextAction: e.target.value })} data-testid="int-next" /></Field>
          <Field label={t('int.nextDate')} name="nextActionDate" error={error}><input type="date" value={v.nextActionDate} min={v.date} onChange={(e) => setV({ ...v, nextActionDate: e.target.value })} data-testid="int-next-date" /></Field>
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="int-save">{t('int.save')}</button></div>
        </form>
      )}
      {q.isPending ? <Skeleton label={t('tab.interactions')} rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.data.rows.length === 0 ? <EmptyState title={t('int.none')} message={canLog ? t('int.noneHint') : ''} /> : (
        <ul className="mdm-list" data-testid="int-list">{q.data.rows.map((x) => (
          <li key={x.id} data-testid="int-row" data-type={x.type}>
            <strong>{t(`itype.${x.type}`)}</strong> · {x.date} · <span className="muted small">{x.createdBy}{x.fromLead ? ` · ${t('int.fromLead')}` : ''}{x.participants.length ? ` · ${x.participants.join(', ')}` : ''}</span>
            <p>{x.notes}</p>
            {x.nextAction && <p className={x.overdue ? 'field-error' : 'muted'} data-testid="int-next-row">{t('int.nextLabel')}: {x.nextAction} · {x.nextActionDate}{x.nextDone ? ` · ${t('int.done')}` : ''}</p>}
            <div className="actions no-print">
              {x.can.done && <button type="button" className="btn btn-small" onClick={() => run(() => bd.interactionDone(x.id), t('int.markedDone'))} data-testid="int-done">{t('int.markDone')}</button>}
              {x.can.edit && <button type="button" className="btn btn-small" onClick={() => run(() => bd.removeInteraction(x.id), t('int.removed'))} data-testid="int-remove">{t('int.remove')}</button>}
            </div>
          </li>))}</ul>
      )}
    </div>
  );
}

/** The approval history, the pipeline moves and the amendments of a record. */
export function TimelinePanel({ load, kind }) {
  const t = useT('bd');
  const q = useQuery({ queryKey: ['bd', 'history', kind], queryFn: load, retry: false });
  if (q.isPending) return <Skeleton label={t('tab.timeline')} rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const approvals = [...(d.approvals ?? []), ...(d.awardApprovals ?? [])];
  return (
    <div data-testid="timeline">
      <h2>{t('tab.approvals')}</h2>
      {approvals.length === 0 ? <p className="muted">{t('tl.noApprovals')}</p> : <ul className="mdm-list" data-testid="tl-approvals">{approvals.map((a, i) => <li key={i}><strong>{a.event}</strong> · {a.actor}{a.step_code ? ` · ${a.step_code}` : ''} · <span className="muted small">{String(a.at).slice(0, 16).replace('T', ' ')}</span>{a.comment ? <><br />{a.comment}</> : null}</li>)}</ul>}
      {d.stages && <><h2>{t('tl.stages')}</h2><ul className="mdm-list" data-testid="tl-stages">{d.stages.map((s, i) => <li key={i}>{s.fromStage ? `${t(`stage.${s.fromStage}`)} → ` : ''}<strong>{t(`stage.${s.toStage}`)}</strong> · {s.probability}% · {s.by} · <span className="muted small">{String(s.at).slice(0, 10)}</span>{s.reason ? <><br />{s.reason}</> : null}</li>)}</ul></>}
      <h2>{t('tl.audit')}</h2>
      <ul className="mdm-list">{d.audit.map((a, i) => <li key={i}>{a.action} · {a.actor} · <span className="muted small">{String(a.at).slice(0, 16).replace('T', ' ')}</span>{a.reason ? ` · ${a.reason}` : ''}</li>)}</ul>
    </div>
  );
}
