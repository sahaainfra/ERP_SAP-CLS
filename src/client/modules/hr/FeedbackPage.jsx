import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { dayIST, perf } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Feedback & One-to-One (HR, part 07.11, FR-04): what colleagues and the manager wrote about the person (recognition, feedback, one-to-one notes they share), and what the person wrote. Anybody can recognise anybody; feedback and one-to-one notes
// go from a manager to the people who report to them, and a note can be kept private to the manager (HR can read it). The person gets a notification of what is shared.
export default function FeedbackPage() {
  const t = useT('prf');
  usePageTitle(t('fb.title'));
  const qc = useQueryClient();
  const [who, setWho] = useState('');
  const q = useQuery({ queryKey: ['perf', 'feedback', who], queryFn: () => perf.feedback(who || undefined), retry: false });
  const [v, setV] = useState({ employeeId: '', kind: 'RECOGNITION', body: '', shared: true, meetingDate: dayIST(0) });
  const [error, setError] = useState(null); const [note, setNote] = useState(null);
  if (q.error?.status === 403) return <NoPermission what={t('fb.title')} permission="hr.perf.own" />;
  const send = async (e) => {
    e.preventDefault(); setError(null); setNote(null);
    try { await perf.give({ employeeId: Number(v.employeeId), kind: v.kind, body: v.body.trim(), shared: v.shared, meetingDate: v.kind === 'ONE_TO_ONE' ? v.meetingDate : null }); setNote(t('fb.sent')); setV({ ...v, body: '' }); qc.invalidateQueries({ queryKey: ['perf'] }); } catch (x) { setError(errorInfo(x)); }
  };
  return (
    <section aria-labelledby="fb-title" data-testid="feedback">
      <PageHeader id="fb-title" title={t('fb.title')} />
      <form className="mdm-panel mdm-fields" onSubmit={send} data-testid="fb-form" aria-label={t('fb.give')}>
        <h2>{t('fb.give')}</h2>
        <LookupField id="fb-person" label={t('team.person')} lookup="hr/employees" value={v.employeeId} onChange={(x) => setV({ ...v, employeeId: x })} error={error?.fields?.employeeId} required />
        <Field label={t('fb.kindLabel')} name="kind" error={error}><select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} data-testid="fb-kind">{['RECOGNITION', 'FEEDBACK', 'ONE_TO_ONE'].map((k) => <option key={k} value={k}>{t(`fb.kind.${k}`)}</option>)}</select></Field>
        {v.kind === 'ONE_TO_ONE' && <Field label={t('fb.meeting')} name="meetingDate" error={error}><input type="date" value={v.meetingDate} onChange={(e) => setV({ ...v, meetingDate: e.target.value })} data-testid="fb-date" /></Field>}
        <Field label={t('fb.body')} name="body" error={error}><textarea rows="3" value={v.body} maxLength={1000} onChange={(e) => setV({ ...v, body: e.target.value })} required data-testid="fb-body" /></Field>
        {v.kind !== 'RECOGNITION' && <label className="check"><input type="checkbox" checked={v.shared} onChange={(e) => setV({ ...v, shared: e.target.checked })} data-testid="fb-shared" /> {t('fb.shared')}</label>}
        {error?.form && <p className="field-error" role="alert" data-testid="fb-error">{error.form}</p>}
        <div className="actions"><button type="submit" className="btn btn-primary" disabled={!v.employeeId} data-testid="fb-send">{t('act.send')}</button></div>
      </form>
      {note && <p className="mdm-banner" role="status" data-testid="fb-note">{note}</p>}
      <div className="mdm-fields no-print"><LookupField id="fb-about" label={t('fb.about')} lookup="hr/employees" value={who} onChange={setWho} hint={t('goal.forHint')} /></div>
      <h2>{t('fb.list')}</h2>
      {q.isPending ? <Skeleton label={t('fb.list')} rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.data.length === 0 ? <EmptyState title={t('fb.none')} message={t('fb.noneHint')} /> : (
        <ul className="mdm-list" data-testid="fb-list">{q.data.map((f) => (
          <li key={f.id} data-testid="fb-row" data-kind={f.kind}><span className="muted small">{t(`fb.kind.${f.kind}`)} · {f.direction === 'RECEIVED' ? t('fb.from', { name: f.author }) : t('fb.to', { name: f.person })} · {String(f.at).slice(0, 10)}{f.shared ? '' : ` · ${t('fb.private')}`}</span><br />{f.body}</li>))}</ul>
      )}
      <p className="small"><Link to="/performance">{t('my.title')}</Link></p>
    </section>
  );
}
