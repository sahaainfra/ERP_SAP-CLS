import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import ListReport from '../../platform/list/ListReport.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { dayIST, ext } from './api.js';

// Separations (HR, part 07.13): the list of resignations and terminations with their last working day and status; HR starts a termination here (the HR manager and the director approve it) and reads the analysis of the exit interviews:
// how many leavers were interviewed, the average rating, how many would come back, the reasons and the departments.
export default function SeparationsPage() {
  const t = useT('sep');
  usePageTitle(t('list.title'));
  const qc = useQueryClient();
  const session = useSession();
  const perms = session.data?.permissions ?? [];
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState({ employeeId: '', reasonCode: 'MISCONDUCT', reason: '', submittedOn: dayIST(0), requestedLwd: '' });
  const [error, setError] = useState(null);
  const an = useQuery({ queryKey: ['ext', 'analytics'], queryFn: () => ext.analytics({}), enabled: perms.includes('hr.separation.interview'), retry: false });
  const start = async (e) => {
    e.preventDefault(); setError(null);
    try { const s = await ext.createSeparation({ type: 'TERMINATION', employeeId: Number(v.employeeId), reasonCode: v.reasonCode, reason: v.reason.trim(), submittedOn: v.submittedOn, requestedLwd: v.requestedLwd || null, submit: true }); qc.invalidateQueries({ queryKey: ['ui', 'list'] }); navigateTo(`/exit/separation?id=${s.id}`, { force: true }); } catch (x) { setError(errorInfo(x)); }
  };
  return (
    <section aria-labelledby="sl-title" data-testid="separations">
      <h1 id="sl-title" className="sr-only">{t('list.title')}</h1>
      <ListReport listCode="hr.separations" endpoint="/hr/separations" title={t('list.title')} session={session.data} rowHref={(r) => `/exit/separation?id=${r.id}`} onOpen={(r) => navigateTo(`/exit/separation?id=${r.id}`)} cardFields={['employee', 'type', 'lastWorkingDay', 'status']} statusKey="status"
        newAction={perms.includes('hr.separation.terminate') ? { label: t('list.terminate'), onClick: () => setAdding(true) } : undefined} empty={{ title: t('list.emptyTitle'), text: t('list.emptyText') }} />
      {adding && (
        <form className="mdm-panel mdm-fields" onSubmit={start} data-testid="sl-terminate" aria-label={t('list.terminate')}>
          <h2>{t('list.terminate')}</h2>
          <LookupField id="sl-emp" label={t('list.employee')} lookup="hr/employees" value={v.employeeId} onChange={(x) => setV({ ...v, employeeId: x })} error={error?.fields?.employeeId} required />
          <Field label={t('resign.reasonCode')} name="reasonCode" error={error}><select value={v.reasonCode} onChange={(e) => setV({ ...v, reasonCode: e.target.value })} data-testid="sl-reason-code">{['MISCONDUCT', 'PERFORMANCE', 'REDUNDANCY', 'CONTRACT_END', 'OTHER'].map((r) => <option key={r} value={r}>{t(`reason.${r}`)}</option>)}</select></Field>
          <Field label={t('resign.reason')} name="reason" error={error}><textarea rows="3" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} required data-testid="sl-reason" /></Field>
          <Field label={t('resign.submittedOn')} name="submittedOn" error={error}><input type="date" value={v.submittedOn} onChange={(e) => setV({ ...v, submittedOn: e.target.value })} data-testid="sl-on" /></Field>
          <Field label={t('resign.lwd')} name="requestedLwd" error={error} hint={t('list.lwdHint')}><input type="date" value={v.requestedLwd} onChange={(e) => setV({ ...v, requestedLwd: e.target.value })} data-testid="sl-lwd" /></Field>
          {error?.form && <p className="field-error" role="alert">{error.form}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => setAdding(false)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" disabled={!v.employeeId} data-testid="sl-send">{t('act.send')}</button></div>
        </form>
      )}
      {an.data && (
        <div data-testid="sl-analytics">
          <h2>{t('an.title')}</h2>
          <dl className="op-figures"><div><dt>{t('an.leavers')}</dt><dd>{an.data.leavers}</dd></div><div><dt>{t('an.interviews')}</dt><dd>{an.data.interviews}</dd></div><div><dt>{t('an.rating')}</dt><dd>{an.data.avgRating ?? '—'}</dd></div><div><dt>{t('an.rejoin')}</dt><dd>{an.data.wouldRejoinPct == null ? '—' : `${an.data.wouldRejoinPct}%`}</dd></div></dl>
          {an.data.byReason.length > 0 && <ul className="trn-bars" aria-label={t('an.reasons')}>{an.data.byReason.map((r) => <li key={r.key}><span>{t(`reason.${r.key}`)}</span><span className="trn-bar" role="img" aria-label={String(r.n)}><span style={{ inlineSize: `${an.data.interviews ? Math.round((r.n / an.data.interviews) * 100) : 0}%` }} /></span><span>{r.n}</span></li>)}</ul>}
        </div>
      )}
      <p className="small"><Link to="/exit/clearances">{t('clr.title')}</Link> · <Link to="/grievances">{t('grv.title')}</Link></p>
    </section>
  );
}
