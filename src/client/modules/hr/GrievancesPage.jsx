import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import ListReport from '../../platform/list/ListReport.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { ext } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Grievances (HR, part 07.13, FR-06): the register of grievances: a person sees what they raised, the officers all of them with the officer, the date to resolve by and the status. An anonymous grievance is followed with its tracking code here.
export default function GrievancesPage() {
  const t = useT('sep');
  usePageTitle(t('grv.title'));
  const qc = useQueryClient();
  const session = useSession();
  const perms = session.data?.permissions ?? [];
  const [code, setCode] = useState(''); const [tr, setTr] = useState(null); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [reason, setReason] = useState('');
  const track = async (e) => { e.preventDefault(); setError(null); try { setTr(await ext.track(code.trim().toUpperCase())); } catch (x) { setTr(null); setError(errorInfo(x)); } };
  const answer = async (accept) => { setError(null); try { await ext.trackRespond({ code: code.trim().toUpperCase(), accept, reason: reason || null }); setNote(accept ? t('grv.closed') : t('grv.reopened')); setTr(await ext.track(code.trim().toUpperCase())); qc.invalidateQueries({ queryKey: ['ui', 'list'] }); } catch (x) { setError(errorInfo(x)); } };
  return (
    <section aria-labelledby="gl-title" data-testid="grievances">
      <PageHeader id="gl-title" srOnly title={t('grv.title')} />
      <ListReport listCode="hr.grievances" endpoint="/hr/grievances" title={t('grv.title')} session={session.data} rowHref={(r) => `/grievances/grievance?id=${r.id}`} onOpen={(r) => navigateTo(`/grievances/grievance?id=${r.id}`)} cardFields={['docNo', 'subject', 'slaDue', 'status']} statusKey="status"
        newAction={perms.includes('hr.grievance.create') ? { label: t('grv.raise'), onClick: () => navigateTo('/grievances/new') } : undefined} empty={{ title: t('grv.emptyTitle'), text: t('grv.emptyText') }} />
      <form className="mdm-panel mdm-fields" onSubmit={track} data-testid="gl-track" aria-label={t('grv.track')}>
        <h2>{t('grv.track')}</h2>
        <Field label={t('grv.code')} name="code" error={error}><input value={code} maxLength={12} onChange={(e) => setCode(e.target.value)} autoComplete="off" data-testid="gl-code" /></Field>
        <div className="actions"><button type="submit" className="btn" disabled={code.trim().length !== 12} data-testid="gl-track-go">{t('grv.find')}</button></div>
      </form>
      {error?.form && <p className="field-error" role="alert" data-testid="gl-error">{error.form}</p>}
      {note && <p className="mdm-banner" role="status">{note}</p>}
      {tr && (
        <div className="mdm-panel" data-testid="gl-tracked"><h2>{tr.docNo}: {tr.subject}</h2><p><StatusBadge status={tr.status === 'CLOSED' ? 'COMPLETED' : tr.status === 'RESOLVED' ? 'APPROVED' : 'IN_REVIEW'} label={t(`gst.${tr.status}`)} /> · {tr.category} · {t('grv.by', { date: tr.slaDue ?? '—' })}</p>
          {tr.notes.map((n, i) => <p key={i} className="small">{String(n.at).slice(0, 10)} · {n.text}</p>)}{tr.resolution && <p data-testid="gl-resolution">{tr.resolution}</p>}
          {tr.can.accept && <div className="mdm-fields"><label>{t('grv.reopenWhy')} <textarea rows="2" value={reason} onChange={(e) => setReason(e.target.value)} /></label><div className="actions"><button type="button" className="btn btn-primary" onClick={() => answer(true)} data-testid="gl-accept">{t('grv.accept')}</button><button type="button" className="btn" onClick={() => answer(false)}>{t('grv.reopen')}</button></div></div>}
        </div>
      )}
      <p className="small"><Link to="/grievances/new">{t('grv.raise')}</Link></p>
    </section>
  );
}
