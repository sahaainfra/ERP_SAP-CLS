import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { GRN_TONE, download, fmtDate, fmtQty, fmtRs, gr, iv } from './api.js';
import { History, useRunner } from './InvParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Returns to Vendor (part 16.03, FR-05): material rejected at the store or failed by quality control goes back. The procurement manager approves; the approval takes the failed stock out, prepares the vendor-return gate pass and triggers the debit note.
function RtvForm({ t, grnId }) {
  const q = useQuery({ queryKey: ['inv', 'grn', grnId], queryFn: () => gr.grn(grnId), retry: false }); const [reason, setReason] = useState(''); const [qty, setQty] = useState({}); const [error, setError] = useState(null); const [busy, setBusy] = useState(false); usePageTitle(t('r.newRtv'));
  if (q.error?.status === 403 || q.error?.status === 404) return <NoPermission what={t('r.newRtv')} permission="inv.rtv.create" />;
  if (q.isPending) return <Skeleton label={t('r.newRtv')} rows={3} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const g = q.data; const rows = g.lines.filter((l) => l.returnableQty > 0); const chosen = rows.filter((l) => Number(qty[l.id]) > 0);
  const save = async (send) => { setError(null); setBusy(true); try { let d = await gr.rtvCreate({ grnId: g.id, reason, lines: chosen.map((l) => ({ grnLineId: l.id, qty: Number(qty[l.id]) })) }); if (send) d = await gr.rtvAct(d.id, 'submit'); navigateTo(`/inv/rtvs?id=${d.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  return (
    <section aria-labelledby="rn-h" data-testid="rtv-form"><PageHeader id="rn-h" title={t('r.newRtv')} subtitle={t('r.rtvHelp')} meta={<><Link to={`/inv/grns?id=${g.id}`}>{g.docNo}</Link> · {g.vendor}</>} />
      {rows.length === 0 ? <p className="muted" data-testid="rn-none">{t('r.nothingToReturn')}</p> : (
        <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); save(false); }} noValidate>
          <div className="table-scroll"><table className="data-table"><caption>{t('r.lines')}</caption><thead><tr><th>{t('item')}</th><th className="num">{t('r.returnable')}</th><th className="num">{t('r.returnQty')}</th></tr></thead><tbody>{rows.map((l) => <tr key={l.id}><td data-label={t('item')}>{l.item}</td><td className="num" data-label={t('r.returnable')}>{fmtQty(l.returnableQty)}</td><td data-label={t('r.returnQty')}><input aria-label={t('r.returnQty')} type="number" min="0" step="0.001" max={l.returnableQty} value={qty[l.id] ?? ''} onChange={(ev) => setQty({ ...qty, [l.id]: ev.target.value })} style={{ minHeight: 44, width: 110 }} data-testid={`rn-qty-${l.lineNo}`} /></td></tr>)}</tbody></table></div>
          <Field label={t('reason')} name="reason" error={error}><input value={reason} onChange={(ev) => setReason(ev.target.value)} maxLength={1000} style={{ minHeight: 48 }} data-testid="rn-reason" /></Field>
          {error?.form && <p className="field-error" role="alert" data-testid="rn-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
          <div className="actions-row"><button type="submit" className="btn" style={{ minHeight: 48 }} disabled={busy || !chosen.length || reason.trim().length < 5} data-testid="rn-save">{t('saveDraft')}</button><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !chosen.length || reason.trim().length < 5} onClick={() => save(true)} data-testid="rn-send">{t('sendForApproval')}</button></div></form>)}</section>
  );
}

function Rtv({ t, id }) {
  const q = useQuery({ queryKey: ['inv', 'rtv', id], queryFn: () => gr.rtv(id), retry: false }); const hq = useQuery({ queryKey: ['inv', 'rtv-history', id, q.data?.status], queryFn: () => gr.rtvHistory(id), enabled: q.isSuccess, retry: false });
  const { error, setError, note, busy, run } = useRunner(); const [comment, setComment] = useState(''); usePageTitle(t('r.rtvTitle'));
  if (q.error?.status === 403 || q.error?.status === 404) return <NoPermission what={t('r.rtvTitle')} permission="inv.rtv.view" />;
  if (q.isPending) return <Skeleton label={t('r.rtvTitle')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data; const can = r.can; const why = (action, msg) => { const x = window.prompt(t('why')); if (x) run(() => gr.rtvAct(r.id, action, { reason: x }), msg); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('sayWhy') }); return; } run(() => iv.decide(r.taskId, action, comment.trim() || null), t(`done.${action}`)); };
  return (
    <div data-testid="rtv-object" data-status={r.status}>
      <PageHeader id="rv-h" title={<>{r.docNo} <StatusBadge status={GRN_TONE[r.status]} label={t(`rs.${r.status}`)} /></>} meta={<><Link to="/inv/rtvs">{t('r.rtvTitle')}</Link> · <Link to={`/inv/grns?id=${r.grnId}`}>{r.grnNo}</Link> · {r.vendor}</>} />
      {error?.form && <p className="field-error" role="alert" data-testid="rtv-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="rtv-note">{note}</p>}
      <dl className="kv"><div><dt>{t('reason')}</dt><dd>{r.reason}</dd></div>{r.totalValue != null && <div><dt>{t('r.value')}</dt><dd data-testid="rtv-value">{fmtRs(r.totalValue)}</dd></div>}<div><dt>{t('g.requestedBy')}</dt><dd>{r.requestedBy}</dd></div>{r.approvedBy && <div><dt>{t('approvedBy')}</dt><dd>{r.approvedBy}</dd></div>}{r.gatePassNo && <div><dt>{t('r.gatePass')}</dt><dd data-testid="rtv-pass"><Link to={`/inv/gate-pass?id=${r.gatePassId}`}>{r.gatePassNo}</Link> ({t(`gps.${r.gatePassStatus}`)})</dd></div>}{r.debitNote && <div><dt>{t('r.debitNote')}</dt><dd data-testid="rtv-debit">{t('r.debitTriggered')}</dd></div>}<div><dt>{t('r.date')}</dt><dd>{fmtDate(r.date)}</dd></div></dl>
      <div className="table-scroll"><table className="data-table" data-testid="rtv-lines"><caption>{t('r.lines')}</caption><thead><tr><th>{t('item')}</th><th className="num">{t('qty')}</th><th>{t('uom')}</th><th className="num">{t('r.fromStock')}</th></tr></thead><tbody>{r.lines.map((l) => <tr key={l.grnLineId}><td data-label={t('item')}>{l.item}</td><td className="num" data-label={t('qty')}>{fmtQty(l.qty)}</td><td data-label={t('uom')}>{l.uom}</td><td className="num" data-label={t('r.fromStock')}>{fmtQty(l.fromStock)}</td></tr>)}</tbody></table></div>
      <div className="actions-row no-print">{can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => gr.rtvAct(r.id, 'submit'), t('submitted'))} data-testid="rtv-submit">{t('sendForApproval')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('withdrawn'))}>{t('withdraw')}</button>}{can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('cancelled'))} data-testid="rtv-cancel">{t('cancel')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/rtvs/${r.id}/print`, `${r.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('g.fileFailed') }))} data-testid="rtv-print">{t('g.print')}</button>}{r.workflowInstanceId && <Link to={`/workflow/instance?id=${r.workflowInstanceId}`}>{t('approval')}</Link>}</div>
      {r.taskId && <div className="mdm-panel no-print" data-testid="rtv-decide"><h2>{t('decide')}</h2><label>{t('comment')}<input value={comment} onChange={(ev) => setComment(ev.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="rtv-comment" /></label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="rtv-approve">{t('approve')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')}>{t('return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')}>{t('reject')}</button></div></div>}
      <History t={t} data={hq.data} testId="rtv-history" />
    </div>
  );
}

export default function RtvsPage() {
  const t = useT('inv'); usePageTitle(t('r.rtvTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const grn = Number(sp.get('grn')) || null; const session = useSession();
  if (sp.get('new') === '1' && grn) return <RtvForm key={grn} t={t} grnId={grn} />;
  if (id) return <section aria-labelledby="rv-h" data-testid="rtvs"><Rtv key={id} t={t} id={id} /></section>;
  return (
    <section aria-labelledby="rvs-h" data-testid="rtvs"><PageHeader id="rvs-h" title={t('r.rtvTitle')} subtitle={t('r.rtvIntro')} /><div className="actions-row no-print"><Link to="/inv/grns">{t('r.grnTitle')}</Link></div>
      <ListReport listCode="inv.rtvs" endpoint="/inv/rtvs" title={t('r.rtvTitle')} session={session.data} rowHref={(r) => `/inv/rtvs?id=${r.id}`} onOpen={(r) => navigateTo(`/inv/rtvs?id=${r.id}`)} cardFields={['docNo', 'grn', 'vendor', 'status']} statusKey="status" dateKey="date" empty={{ title: t('r.rtvEmptyTitle'), text: t('r.rtvEmptyBody') }} /></section>
  );
}
