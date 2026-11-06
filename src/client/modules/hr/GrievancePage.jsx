import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { ext } from './api.js';

// Grievance (HR, part 07.13, FR-06): one grievance with its status, the officer, the date to resolve by (red when passed), the notes (the complainant sees those shared with them), the resolution; the officer assigns, writes notes, resolves or
// closes it as not a grievance; the complainant accepts the resolution or reopens it with a reason, or withdraws it while it is open.
const TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', IN_REVIEW: 'IN_REVIEW', RESOLVED: 'APPROVED', CLOSED: 'COMPLETED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
export default function GrievancePage() {
  const t = useT('sep');
  const qc = useQueryClient();
  const id = Number(new URLSearchParams(window.location.search).get('id')) || null;
  const q = useQuery({ queryKey: ['ext', 'grievance', id], queryFn: () => ext.grievance(id), enabled: Boolean(id), retry: false });
  const [txt, setTxt] = useState(''); const [shared, setShared] = useState(true); const [officer, setOfficer] = useState(''); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const g = q.data;
  usePageTitle(g ? g.docNo : t('grv.title'));
  if (!id) return <ErrorState error={new Error(t('sep.noId'))} />;
  if (q.error?.status === 403) return <NoPermission what={t('grv.title')} permission="hr.grievance.view" />;
  if (q.isPending) return <Skeleton label={t('grv.title')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); setNote(done); setTxt(''); qc.invalidateQueries({ queryKey: ['ext'] }); } catch (e) { setError(errorInfo(e)); } };
  const need = (fn) => { if (txt.trim().length < 5) { setError({ form: t('act.why') }); return; } fn(txt.trim()); };
  return (
    <section aria-labelledby="gv-title" data-testid="grievance" data-status={g.status}>
      <h1 id="gv-title">{g.subject} <StatusBadge status={TONE[g.status]} label={t(`gst.${g.status}`)} /></h1>
      <p className="muted">{g.docNo} · {t(`gcat.${g.category}`)} · {g.anonymous ? t('grv.anon') : g.complainant ?? ''} · {t('grv.raised', { date: g.raisedOn })} · <span className={g.overdue ? 'field-error' : ''} data-testid="gv-sla">{t('grv.by', { date: g.slaDue ?? '—' })}</span>{g.assignedTo ? ` · ${t('grv.officer')} ${g.assignedTo}` : ''}</p>
      {error?.form && <p className="field-error" role="alert" data-testid="gv-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="gv-note">{note}</p>}
      <p>{g.description}</p>
      {g.notes.length > 0 && <><h2>{t('grv.notes')}</h2><ul className="mdm-list" data-testid="gv-notes">{g.notes.map((n, i) => <li key={i}><span className="muted small">{String(n.at).slice(0, 16).replace('T', ' ')} · {n.by}{n.shared ? '' : ` · ${t('grv.internal')}`}</span><br />{n.text}</li>)}</ul></>}
      {g.resolution && <><h2>{t('grv.resolution')}</h2><p data-testid="gv-resolution">{g.resolution}</p></>}
      {(g.can.note || g.can.resolve || g.can.reject || g.can.accept || g.can.reopen || g.can.cancel) && (
        <div className="mdm-panel mdm-fields no-print">
          <label>{t('grv.text')} <textarea rows="3" value={txt} onChange={(e) => setTxt(e.target.value)} data-testid="gv-text" /></label>
          {g.can.note && <label className="check"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} data-testid="gv-shared" /> {t('grv.share')}</label>}
          <div className="actions" data-testid="gv-actions">
            {g.can.note && <button type="button" className="btn" onClick={() => need((x) => run(() => ext.grvAct(id, 'note', { text: x, shared }), t('grv.noted')))} data-testid="gv-note-add">{t('grv.addNote')}</button>}
            {g.can.resolve && <button type="button" className="btn btn-primary" onClick={() => need((x) => run(() => ext.grvAct(id, 'resolve', { resolution: x }), t('grv.resolved')))} data-testid="gv-resolve">{t('grv.resolve')}</button>}
            {g.can.reject && <button type="button" className="btn" onClick={() => need((x) => run(() => ext.grvAct(id, 'reject', { reason: x }), t('grv.rejected')))} data-testid="gv-reject">{t('grv.notGrievance')}</button>}
            {g.can.accept && <button type="button" className="btn btn-primary" onClick={() => run(() => ext.grvAct(id, 'respond', { accept: true }), t('grv.closed'))} data-testid="gv-accept">{t('grv.accept')}</button>}
            {g.can.reopen && <button type="button" className="btn" onClick={() => need((x) => run(() => ext.grvAct(id, 'respond', { accept: false, reason: x }), t('grv.reopened')))} data-testid="gv-reopen">{t('grv.reopen')}</button>}
            {g.can.cancel && <button type="button" className="btn" onClick={() => need((x) => run(() => ext.grvAct(id, 'withdraw', { reason: x }), t('grv.withdrawn')))} data-testid="gv-withdraw">{t('act.withdraw')}</button>}
          </div>
        </div>
      )}
      {g.can.assign && (
        <form className="mdm-fields no-print" onSubmit={(e) => { e.preventDefault(); run(() => ext.grvAct(id, 'assign', { officer: officer.trim() }), t('grv.assigned')); }} data-testid="gv-assign" aria-label={t('grv.assign')}>
          <Field label={t('grv.officerUser')} name="officer" error={error}><input value={officer} onChange={(e) => setOfficer(e.target.value)} data-testid="gv-officer" /></Field>
          <div className="actions"><button type="submit" className="btn" disabled={!officer.trim()} data-testid="gv-assign-go">{t('grv.assign')}</button></div>
        </form>
      )}
      {g.can.submit && <div className="actions"><button type="button" className="btn btn-primary" onClick={() => run(() => ext.grvAct(id, 'submit'), t('grv.sent'))} data-testid="gv-submit">{t('act.send')}</button></div>}
      {g.can.print && <p className="small"><a href={`/api/v1/hr/grievances/${id}/print`} target="_blank" rel="noreferrer">{t('act.print')}</a></p>}
      <p className="small"><Link to="/grievances">{t('grv.title')}</Link></p>
    </section>
  );
}
