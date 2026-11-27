import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { ISSUE_TONE, download, fmtDate, fmtQty, fmtRs, is, iv } from './api.js';
import { History, useRunner } from './InvParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Site Returns (part 16.04, FR-04): unused, damaged or scrap material coming back from site with its condition and reason, at the rate it was issued; the store manager approves.
function ReturnForm({ t, issueId }) {
  const q = useQuery({ queryKey: ['inv', 'issue', issueId], queryFn: () => is.issue(issueId), retry: false }); const [cond, setCond] = useState('GOOD'); const [reason, setReason] = useState(''); const [qty, setQty] = useState({}); const [error, setError] = useState(null); const [busy, setBusy] = useState(false); usePageTitle(t('i.newReturn'));
  if (q.error?.status === 403 || q.error?.status === 404) return <NoPermission what={t('i.newReturn')} permission="inv.site_return.create" />; if (q.isPending) return <Skeleton label={t('i.newReturn')} rows={3} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const g = q.data; const rows = g.lines.filter((l) => l.qty > l.returnedQty); const chosen = rows.filter((l) => Number(qty[l.id]) > 0);
  const save = async (send) => { setError(null); setBusy(true); try { let d = await is.retCreate({ issueId: g.id, condition: cond, reason, lines: chosen.map((l) => ({ issueLineId: l.id, qty: Number(qty[l.id]) })) }); if (send) d = await is.retAct(d.id, 'submit'); navigateTo(`/inv/site-returns?id=${d.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  return (
    <section aria-labelledby="sr-h" data-testid="return-form"><PageHeader id="sr-h" title={t('i.newReturn')} subtitle={t('i.returnHelp')} meta={<><Link to={`/inv/issues?id=${g.id}`}>{g.docNo}</Link> · {g.issuedTo}</>} />
      {rows.length === 0 ? <p className="muted" data-testid="sr-none">{t('i.nothingToReturn')}</p> : (
        <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); save(false); }} noValidate>
          <div className="table-scroll"><table className="data-table"><caption>{t('r.lines')}</caption><thead><tr><th>{t('item')}</th><th className="num">{t('i.qty')}</th><th className="num">{t('i.returned')}</th><th className="num">{t('i.returnQty')}</th></tr></thead><tbody>{rows.map((l) => <tr key={l.id}><td data-label={t('item')}>{l.item}</td><td className="num" data-label={t('i.qty')}>{fmtQty(l.qty)}</td><td className="num" data-label={t('i.returned')}>{fmtQty(l.returnedQty)}</td><td data-label={t('i.returnQty')}><input aria-label={t('i.returnQty')} type="number" min="0" step="0.001" max={l.qty - l.returnedQty} value={qty[l.id] ?? ''} onChange={(ev) => setQty({ ...qty, [l.id]: ev.target.value })} style={{ minHeight: 44, width: 110 }} data-testid={`sr-qty-${l.lineNo}`} /></td></tr>)}</tbody></table></div>
          <div className="form-grid"><Field label={t('i.condition')} name="condition" error={error}><select value={cond} onChange={(ev) => setCond(ev.target.value)} style={{ minHeight: 48 }} data-testid="sr-cond">{['GOOD', 'DAMAGED', 'SCRAP'].map((c) => <option key={c} value={c}>{t(`i.cond.${c}`)}</option>)}</select></Field>
            <Field label={t('reason')} name="reason" error={error}><input value={reason} onChange={(ev) => setReason(ev.target.value)} maxLength={1000} style={{ minHeight: 48 }} data-testid="sr-reason" /></Field></div>
          {error?.form && <p className="field-error" role="alert" data-testid="sr-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
          <div className="actions-row"><button type="submit" className="btn" style={{ minHeight: 48 }} disabled={busy || !chosen.length || reason.trim().length < 5} data-testid="sr-save">{t('saveDraft')}</button><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !chosen.length || reason.trim().length < 5} onClick={() => save(true)} data-testid="sr-send">{t('sendForApproval')}</button></div></form>)}</section>
  );
}
function Return({ t, id }) {
  const q = useQuery({ queryKey: ['inv', 'sreturn', id], queryFn: () => is.ret(id), retry: false }); const hq = useQuery({ queryKey: ['inv', 'sreturn-history', id, q.data?.status], queryFn: () => is.retHistory(id), enabled: q.isSuccess, retry: false });
  const { error, setError, note, busy, run } = useRunner(); const [comment, setComment] = useState(''); usePageTitle(t('i.returnsPageTitle'));
  if (q.error?.status === 403 || q.error?.status === 404) return <NoPermission what={t('i.returnsPageTitle')} permission="inv.site_return.view" />; if (q.isPending) return <Skeleton label={t('i.returnsPageTitle')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data; const can = r.can; const why = (action, msg) => { const x = window.prompt(t('why')); if (x) run(() => is.retAct(r.id, action, { reason: x }), msg); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('sayWhy') }); return; } run(() => iv.decide(r.taskId, action, comment.trim() || null), t(`done.${action}`)); };
  return (
    <div data-testid="return-object" data-status={r.status}>
      <PageHeader id="srv-h" title={<>{r.docNo} <StatusBadge status={ISSUE_TONE[r.status === 'APPROVED' ? 'POSTED' : r.status]} label={t(`rs.${r.status}`)} /></>} meta={<><Link to="/inv/site-returns">{t('i.returnsPageTitle')}</Link> · <Link to={`/inv/issues?id=${r.issueId}`}>{r.issueNo}</Link> · {r.store} · {r.fromName}</>} />
      {error?.form && <p className="field-error" role="alert" data-testid="return-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="return-note">{note}</p>}
      <dl className="kv"><div><dt>{t('i.condition')}</dt><dd data-testid="return-cond">{t(`i.cond.${r.condition}`)}</dd></div><div><dt>{t('reason')}</dt><dd>{r.reason}</dd></div>{r.totalValue != null && <div><dt>{t('r.value')}</dt><dd data-testid="return-value">{fmtRs(r.totalValue)}</dd></div>}<div><dt>{t('g.requestedBy')}</dt><dd>{r.requestedBy}</dd></div>{r.approvedBy && <div><dt>{t('approvedBy')}</dt><dd>{r.approvedBy}</dd></div>}<div><dt>{t('r.date')}</dt><dd>{fmtDate(r.date)}</dd></div></dl>
      <div className="table-scroll"><table className="data-table" data-testid="return-lines"><caption>{t('r.lines')}</caption><thead><tr><th>{t('item')}</th><th className="num">{t('i.qty')}</th><th>{t('uom')}</th><th className="num">{t('i.rate')}</th></tr></thead><tbody>{r.lines.map((l) => <tr key={l.issueLineId}><td data-label={t('item')}>{l.item}</td><td className="num" data-label={t('i.qty')}>{fmtQty(l.qty)}</td><td data-label={t('uom')}>{l.uom}</td><td className="num" data-label={t('i.rate')}>{l.rate == null ? '—' : fmtRs(l.rate)}</td></tr>)}</tbody></table></div>
      <div className="actions-row no-print">{can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => is.retAct(r.id, 'submit'), t('submitted'))} data-testid="return-submit">{t('sendForApproval')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('withdrawn'))}>{t('withdraw')}</button>}{can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('cancelled'))} data-testid="return-cancel">{t('cancel')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/site-returns/${r.id}/print`, `${r.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('g.fileFailed') }))} data-testid="return-print">{t('g.print')}</button>}{r.workflowInstanceId && <Link to={`/workflow/instance?id=${r.workflowInstanceId}`}>{t('approval')}</Link>}</div>
      {r.taskId && <div className="mdm-panel no-print" data-testid="return-decide"><h2>{t('decide')}</h2><label>{t('comment')}<input value={comment} onChange={(ev) => setComment(ev.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="return-comment" /></label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="return-approve">{t('approve')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')}>{t('return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')}>{t('reject')}</button></div></div>}
      <History t={t} data={hq.data} testId="return-history" />
    </div>
  );
}
export default function SiteReturnsPage() {
  const t = useT('inv'); usePageTitle(t('i.returnsPageTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const issue = Number(sp.get('issue')) || null; const session = useSession();
  if (sp.get('new') === '1' && issue) return <ReturnForm key={issue} t={t} issueId={issue} />;
  if (id) return <section aria-labelledby="srv-h" data-testid="site-returns"><Return key={id} t={t} id={id} /></section>;
  return (
    <section aria-labelledby="srs-h" data-testid="site-returns"><PageHeader id="srs-h" title={t('i.returnsPageTitle')} subtitle={t('i.returnsIntro')} /><div className="actions-row no-print"><Link to="/inv/issues">{t('i.issuesTitle')}</Link></div>
      <ListReport listCode="inv.site_returns" endpoint="/inv/site-returns" exportEndpoint="/ui/lists/inv.site_returns/export" title={t('i.returnsPageTitle')} session={session.data} rowHref={(r) => `/inv/site-returns?id=${r.id}`} onOpen={(r) => navigateTo(`/inv/site-returns?id=${r.id}`)} cardFields={['docNo', 'issue', 'from', 'status']} statusKey="status" dateKey="date" empty={{ title: t('i.returnsEmptyTitle'), text: t('i.returnsEmptyBody') }} /></section>
  );
}
