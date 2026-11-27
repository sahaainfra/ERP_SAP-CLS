import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { COUNT_TONE, download, fmtDate, fmtQty, iv, ra } from './api.js';
import { History, useRunner } from './InvParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Returnable asset movements (part 16.08): the list and the movement with its approval, posting and the recoveries it led to.
function Movement({ t, id }) {
  const q = useQuery({ queryKey: ['inv', 'rta-movement', id], queryFn: () => ra.movement(id), retry: false }); const hq = useQuery({ queryKey: ['inv', 'rta-history', id, q.data?.status], queryFn: () => ra.history(id), enabled: q.isSuccess, retry: false });
  const { error, setError, note, busy, run } = useRunner(); const [comment, setComment] = useState(''); usePageTitle(t('ra.movementTitle'));
  if (q.error?.status === 403 || q.error?.status === 404) return <NoPermission what={t('ra.movementsTitle')} permission="inv.movement.view" />;
  if (q.isPending) return <Skeleton label={t('ra.movementsTitle')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const x = q.data; const can = x.can; const why = (action, msg) => { const r = window.prompt(t('why')); if (r) run(() => ra.act(x.id, action, { reason: r }), msg); };
  const decide = (taskId, action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('sayWhy') }); return; } run(() => iv.decide(taskId, action, comment.trim() || null), t(`done.${action}`)); };
  return (
    <div data-testid="rtam-object" data-status={x.status}>
      <PageHeader id="rtam-h" title={<>{x.docNo} <StatusBadge status={COUNT_TONE[x.status]} label={t(`ra.ms.${x.status}`)} /></>} meta={<><Link to="/inv/rta-movements">{t('ra.movementsTitle')}</Link> · {t(`ra.mt.${x.type}`)} · {x.item}</>} />
      {error?.form && <p className="field-error" role="alert" data-testid="rtam-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="rtam-note">{note}</p>}
      <dl className="kv"><div><dt>{t('i.qty')}</dt><dd data-testid="rtam-qty">{fmtQty(x.qty)} {x.uom}</dd></div><div><dt>{t('ra.movement')}</dt><dd>{x.where || '—'}</dd></div><div><dt>{t('r.date')}</dt><dd>{fmtDate(x.date)}</dd></div>{x.expectedReturn && <div><dt>{t('ra.expected')}</dt><dd>{fmtDate(x.expectedReturn)}</dd></div>}{x.type === 'RETURN' && <div><dt>{t('ra.condition')}</dt><dd data-testid="rtam-split">{t('ra.split', { g: fmtQty(x.qtyGood), r: fmtQty(x.qtyRepairable), s: fmtQty(x.qtyScrap), l: fmtQty(x.qtyLost) })}</dd></div>}{x.vendor && <div><dt>{t('ra.vendor')}</dt><dd>{x.vendor}{x.hireRate != null ? ` · ${t(`ra.b.${x.hireBasis}`)}` : ''}</dd></div>}<div><dt>{t('g.requestedBy')}</dt><dd>{x.requestedBy}</dd></div>{x.reason && <div><dt>{t('cn.reason')}</dt><dd>{x.reason}</dd></div>}</dl>
      <div className="actions-row no-print">
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => ra.act(x.id, 'submit'), t('submitted'))} data-testid="rtam-submit">{t('sendForApproval')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('withdrawn'))}>{t('withdraw')}</button>}{can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('cancelled'))} data-testid="rtam-cancel">{t('cancel')}</button>}
        {can.amend && <button type="button" className="btn" disabled={busy} onClick={async () => { const d = await run(() => ra.act(x.id, 'amend')); if (d) navigateTo(`/inv/rta-movements?id=${d.id}`); }} data-testid="rtam-amend">{t('ra.amend')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/rta/movements/${x.id}/print`, `${x.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('g.fileFailed') }))} data-testid="rtam-print">{t('g.print')}</button>}{x.workflowInstanceId && <Link to={`/workflow/instance?id=${x.workflowInstanceId}`}>{t('approval')}</Link>}</div>
      {x.taskId && <div className="mdm-panel no-print" data-testid="rtam-decide"><h2>{t('decide')}</h2><label>{t('comment')}<input value={comment} onChange={(ev) => setComment(ev.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="rtam-comment" /></label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide(x.taskId, 'approve')} data-testid="rtam-approve">{t('approve')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide(x.taskId, 'return')}>{t('return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide(x.taskId, 'reject')}>{t('reject')}</button></div></div>}
      {x.recoveries?.length > 0 && <div className="mdm-panel" data-testid="rtam-recoveries"><h2>{t('ra.recoveriesTitle')}</h2><ul>{x.recoveries.map((r) => <li key={r.id}>{r.docNo} · {t(`ra.rk.${r.kind}`)} · {fmtQty(r.qty)} · {t(`ra.rs.${r.status}`)}</li>)}</ul><Link to="/inv/rta-hire?tab=recoveries">{t('ra.recoveriesTitle')}</Link></div>}
      <History t={t} data={hq.data} testId="rtam-history" />
    </div>
  );
}
export default function RtaMovementsPage() {
  const t = useT('inv'); usePageTitle(t('ra.movementsTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  if (id) return <section aria-labelledby="rtam-h" data-testid="rta-movements"><Movement key={id} t={t} id={id} /></section>;
  return (
    <section aria-labelledby="rtl-h" data-testid="rta-movements"><PageHeader id="rtl-h" title={t('ra.movementsTitle')} subtitle={t('ra.movementsIntro')} />
      <div className="actions-row no-print">{perms.includes('inv.movement.create') && <Link to="/inv/rta-issue">{t('ra.issueTitle')}</Link>} <Link to="/inv/rta">{t('ra.title')}</Link></div>
      <ListReport listCode="inv.rta_movements" endpoint="/inv/rta/movements" exportEndpoint="/ui/lists/inv.rta_movements/export" title={t('ra.movementsTitle')} session={session.data} rowHref={(r) => `/inv/rta-movements?id=${r.id}`} onOpen={(r) => navigateTo(`/inv/rta-movements?id=${r.id}`)} cardFields={['docNo', 'type', 'item', 'status']} statusKey="status" dateKey="date" empty={{ title: t('ra.mEmptyTitle'), text: t('ra.mEmptyBody') }} /></section>
  );
}
