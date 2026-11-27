import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { XPD_TONE, pc, pv8 } from './api.js';
import { History, useRunner } from './XpdParts.jsx';
import { useSearch } from '../site/parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Approved vendor list (part 15.08, FR-02, FR-05, BR-01): the vendors allowed for each category and region with status and validity; a suspension is suggested by a low score or proposed by people and approved by the procurement manager and the direction.
function Suspension({ t, id }) {
  const q = useQuery({ queryKey: ['proc', 'susp', id], queryFn: () => pv8.susp(id), retry: false }); const hq = useQuery({ queryKey: ['proc', 'susp-history', id, q.data?.status], queryFn: () => pv8.suspHistory(id), enabled: q.isSuccess, retry: false });
  const { error, setError, note, busy, run } = useRunner(); const [comment, setComment] = useState('');
  usePageTitle(t('v.suspTitle'));
  if (q.error?.status === 403) return <NoPermission what={t('v.suspTitle')} permission="proc.avl.view" />;
  if (q.isPending) return <Skeleton label={t('v.suspTitle')} rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data; const can = r.can;
  const why = (action, msg) => { const x = window.prompt(t('x.why')); if (x) run(() => pv8.suspAct(r.id, action, { reason: x }), msg); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('x.sayWhy') }); return; } run(() => pc.decide(r.taskId, action, comment.trim() || null), t(`x.done.${action}`)); };
  return (
    <div data-testid="su-object" data-status={r.status}>
      <PageHeader id="su-h" title={<>{r.docNo} <StatusBadge status={XPD_TONE[r.status]} label={t(`x.s.${r.status}`)} />{r.autoSuggested && <StatusBadge status="RETURNED" label={t('v.suggested')} />}</>} meta={<><Link to="/proc/avl">{t('x.back')}</Link> · <Link to={`/proc/vendor-scorecards?partner=${r.partnerId}`}>{r.vendor}</Link></>} />
      <p data-testid="su-reason">{r.reason}</p>
      {error?.form && <p className="field-error" role="alert" data-testid="su-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="su-note">{note}</p>}
      <div className="table-scroll"><table className="data-table" data-testid="su-entries"><caption>{t('v.entries')}</caption><thead><tr><th>{t('v.category')}</th><th>{t('v.region')}</th><th>{t('x.status')}</th></tr></thead><tbody>{r.entries.map((e) => <tr key={e.id}><td>{e.category}</td><td>{e.region}</td><td>{e.statusLabel}</td></tr>)}</tbody></table></div>
      <div className="actions-row no-print">
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => pv8.suspAct(r.id, 'submit'), t('x.submitted'))} data-testid="su-submit">{t('x.submit')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('x.withdrawn'))}>{t('x.withdraw')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('x.cancelled'))} data-testid="su-cancel">{t('x.cancel')}</button>}
        {r.workflowInstanceId && <Link to={`/workflow/instance?id=${r.workflowInstanceId}`}>{t('x.approval')}</Link>}
      </div>
      {r.taskId && <div className="mdm-panel no-print" data-testid="su-decide"><h2>{t('x.decide')}</h2><label>{t('x.comment')}<input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="su-comment" /></label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="su-approve">{t('x.approve')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')}>{t('x.return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')}>{t('x.reject')}</button></div></div>}
      <History t={t} data={hq.data} testId="su-history" />
    </div>
  );
}

function SuspensionList({ t, session }) {
  return <ListReport listCode="proc.avl_suspensions" endpoint="/proc/avl-suspensions" exportEndpoint="/ui/lists/proc.avl_suspensions/export" title={t('v.suspTitle')} session={session.data} rowHref={(r) => `/proc/avl?suspension=${r.id}`} onOpen={(r) => navigateTo(`/proc/avl?suspension=${r.id}`)} cardFields={['docNo', 'vendor', 'date', 'auto']} statusKey="status" empty={{ title: t('v.suspEmptyTitle'), text: t('v.suspEmptyBody') }} />;
}

export default function AvlPage() {
  const t = useT('proc'); usePageTitle(t('v.avlTitle')); const sp = useSearch(); const sid = Number(sp.get('suspension') ?? sp.get('id')) || null; const session = useSession(); const [tab, setTab] = useState('list');
  if (sid) return <section aria-labelledby="su-h" data-testid="proc-avl"><Suspension key={sid} t={t} id={sid} /></section>;
  return (
    <section aria-labelledby="avl-h" data-testid="proc-avl"><PageHeader id="avl-h" title={t('v.avlTitle')} subtitle={t('v.avlIntro')} />
      <div className="actions-row no-print"><button type="button" className={tab === 'list' ? 'btn btn-primary' : 'btn'} aria-pressed={tab === 'list'} onClick={() => setTab('list')} data-testid="avl-tab-list">{t('v.avlTitle')}</button><button type="button" className={tab === 'susp' ? 'btn btn-primary' : 'btn'} aria-pressed={tab === 'susp'} onClick={() => setTab('susp')} data-testid="avl-tab-susp">{t('v.suspTitle')}</button>
        <Link to="/proc/prequalifications">{t('v.preqTitle')}</Link> <Link to="/proc/vendor-scorecards">{t('v.scoreTitle')}</Link></div>
      {tab === 'list'
        ? <ListReport listCode="proc.avl" endpoint="/proc/avl" exportEndpoint="/ui/lists/proc.avl/export" title={t('v.avlTitle')} session={session.data} rowHref={(r) => `/proc/vendor-scorecards?partner=${r.partnerId}`} onOpen={(r) => navigateTo(`/proc/vendor-scorecards?partner=${r.partnerId}`)} cardFields={['vendor', 'category', 'region', 'validUntil']} statusKey="status" empty={{ title: t('v.avlEmptyTitle'), text: t('v.avlEmptyBody') }} />
        : <SuspensionList t={t} session={session} />}
    </section>
  );
}
