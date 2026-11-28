import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { ISSUE_TONE, download, fmtDate, fmtQty, fmtRs, is, iv } from './api.js';
import { filePhoto } from './GateParts.jsx';
import { History, useRunner } from './InvParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import DocumentFlow from '../../platform/object/DocumentFlow.jsx';

// Material Issues (part 16.04): the list, and the issue slip with the lines, the authorisation it was issued against, the receiver acknowledgement (code or signature), the stock postings and the returns.
function Issue({ t, id }) {
  const q = useQuery({ queryKey: ['inv', 'issue', id], queryFn: () => is.issue(id), retry: false }); const hq = useQuery({ queryKey: ['inv', 'issue-history', id, q.data?.status], queryFn: () => is.history(id), enabled: q.isSuccess, retry: false });
  const { error, setError, note, busy, run } = useRunner(); const [comment, setComment] = useState(''); const [otp, setOtp] = useState(''); const [sig, setSig] = useState({ name: '', file: null }); const [sent, setSent] = useState(null); usePageTitle(t('i.issuesTitle'));
  if (q.error?.status === 403 || q.error?.status === 404) return <NoPermission what={t('i.issuesTitle')} permission="inv.issue.view" />;
  if (q.isPending) return <Skeleton label={t('i.issuesTitle')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const g = q.data; const can = g.can; const why = (action, msg) => { const x = window.prompt(t('why')); if (x) run(() => is.act(g.id, action, { reason: x }), msg); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('sayWhy') }); return; } run(() => iv.decide(g.taskId, action, comment.trim() || null), t(`done.${action}`)); };
  const makeCode = () => run(async () => { const r = await is.act(g.id, 'ack-code'); setSent(r); return r; }, t('i.codeMade'));
  const ackOtp = () => run(() => is.act(g.id, 'acknowledge', { method: 'OTP', otp }), t('i.issuedDone'));
  const ackSig = () => run(async () => { const up = await filePhoto(sig.file, 'inv_issue', g.id); return is.act(g.id, 'acknowledge', { method: 'SIGNATURE', receiverName: sig.name, signatureFileId: up.id }); }, t('i.issuedDone'));
  return (
    <div data-testid="issue-object" data-status={g.status}>
      <PageHeader id="iss-h" title={<>{g.docNo} <StatusBadge status={ISSUE_TONE[g.status]} label={t(`is.${g.status}`)} /></>} meta={<><Link to="/inv/issues">{t('i.issuesTitle')}</Link> · {g.store} · {t(`i.it.${g.type}`)} · {g.issuedTo}</>} />
      <DocumentFlow type="ISSUE" id={g.id} />
      {g.exceptionNeeded && <p className="mdm-banner" role="status" data-testid="issue-exception">{t('i.exceptionNote')}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="issue-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{note && <p className="mdm-banner" role="status" data-testid="issue-note">{note}</p>}
      <dl className="kv"><div><dt>{t('i.wa')}</dt><dd>{g.waNo ?? g.mrNo ?? t('i.noWa')}</dd></div><div><dt>{t('i.date')}</dt><dd>{fmtDate(g.date)}</dd></div>{g.totalValue != null && <div><dt>{t('r.value')}</dt><dd data-testid="issue-value">{fmtRs(g.totalValue)}</dd></div>}{g.recoverableValue > 0 && <div><dt>{t('i.recoverable')}</dt><dd>{fmtRs(g.recoverableValue)}</dd></div>}<div><dt>{t('g.requestedBy')}</dt><dd>{g.requestedBy}</dd></div>{g.acknowledged && <div><dt>{t('i.receivedBy')}</dt><dd data-testid="issue-ack">{g.receiverName} ({t(`i.am.${g.ackMethod}`)}) · {String(g.ackAt).slice(0, 16).replace('T', ' ')}</dd></div>}</dl>
      <div className="table-scroll"><table className="data-table" data-testid="issue-lines"><caption>{t('r.lines')}</caption><thead><tr><th>{t('item')}</th><th className="num">{t('i.qty')}</th><th className="num">{t('i.authorised')}</th><th className="num">{t('i.before')}</th><th className="num">{t('i.excess')}</th><th className="num">{t('i.returned')}</th><th className="num">{t('i.rate')}</th></tr></thead>
        <tbody>{g.lines.map((l) => <tr key={l.id} data-testid={`issue-line-${l.lineNo}`}><td data-label={t('item')}>{l.item}{l.batchNo ? ` · ${l.batchNo}` : ''}</td><td className="num" data-label={t('i.qty')}>{fmtQty(l.qty)} {l.uom}</td><td className="num" data-label={t('i.authorised')}>{fmtQty(l.authorisedQty)}</td><td className="num" data-label={t('i.before')}>{fmtQty(l.issuedBefore)}</td><td className="num" data-label={t('i.excess')}>{fmtQty(l.excessQty)}</td><td className="num" data-label={t('i.returned')}>{fmtQty(l.returnedQty)}</td><td className="num" data-label={t('i.rate')}>{l.rate == null ? '—' : fmtRs(l.rate)}</td></tr>)}</tbody></table></div>
      {can.acknowledge && <div className="mdm-panel no-print" data-testid="issue-ack-panel"><h2>{t('i.handOver')}</h2><p className="muted">{t('i.handOverHelp')}</p>
        <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={makeCode} data-testid="issue-code">{t('i.makeCode')}</button>{sent && <span data-testid="issue-code-sent">{sent.sentTo ? t('i.codeSentTo', { who: sent.sentTo }) : t('i.codeNoReceiver')}</span>}</div>
        <div className="form-grid"><Field label={t('i.code')} name="otp" error={error}><input inputMode="numeric" maxLength={6} value={otp} onChange={(ev) => setOtp(ev.target.value.replace(/\D/g, ''))} style={{ minHeight: 'var(--erp-target-large)', fontSize: 20 }} data-testid="issue-otp" /></Field></div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy || otp.length !== 6} onClick={ackOtp} data-testid="issue-ack-otp">{t('i.ackCode')}</button></div>
        <div className="form-grid"><Field label={t('i.receiverName')} name="receiverName" error={error}><input value={sig.name} onChange={(ev) => setSig({ ...sig, name: ev.target.value })} maxLength={120} style={{ minHeight: 'var(--erp-target-large)' }} data-testid="issue-sig-name" /></Field></div>
        <div className="actions-row"><label className="btn" style={{ minHeight: 'var(--erp-target-large)' }}>{sig.file ? `✓ ${t('i.signature')}` : t('i.signature')}<input type="file" accept="image/*" capture="environment" className="sr-only" data-testid="issue-sig-file" onChange={(ev) => setSig({ ...sig, file: ev.target.files?.[0] ?? null })} /></label><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy || !sig.file || sig.name.trim().length < 2} onClick={ackSig} data-testid="issue-ack-sig">{t('i.ackSignature')}</button></div></div>}
      <div className="actions-row no-print">
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => run(() => is.act(g.id, 'submit'), t('submitted'))} data-testid="issue-submit">{t('i.makeReady')}</button>}
        {can.returnToStore && <button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} onClick={() => navigateTo(`/inv/site-returns?new=1&issue=${g.id}`)} data-testid="issue-return">{t('i.returnToStore')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('withdrawn'))}>{t('withdraw')}</button>}{can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('cancelled'))} data-testid="issue-cancel">{t('cancel')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/issues/${g.id}/print`, `${g.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('g.fileFailed') }))} data-testid="issue-print">{t('g.print')}</button>}{g.workflowInstanceId && <Link to={`/workflow/instance?id=${g.workflowInstanceId}`}>{t('approval')}</Link>}</div>
      {g.taskId && <div className="mdm-panel no-print" data-testid="issue-decide"><h2>{t('decide')}</h2><label>{t('comment')}<input value={comment} onChange={(ev) => setComment(ev.target.value)} maxLength={500} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="issue-comment" /></label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('approve')} data-testid="issue-approve">{t('approve')}</button><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('return')}>{t('return')}</button><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('reject')}>{t('reject')}</button></div></div>}
      {g.postings.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="issue-postings"><caption>{t('r.postings')}</caption><thead><tr><th>{t('r.entry')}</th><th className="num">{t('qty')}</th><th>{t('r.date')}</th></tr></thead><tbody>{g.postings.map((p) => <tr key={p.docNo}><td><Link to="/inv/ledger">{p.docNo}</Link></td><td className="num">{fmtQty(p.qty)}</td><td>{fmtDate(p.date)}</td></tr>)}</tbody></table></div>}
      {g.returns.length > 0 && <div className="mdm-panel" data-testid="issue-returns"><h2>{t('i.returnsTitle')}</h2><ul>{g.returns.map((r) => <li key={r.id}><Link to={`/inv/site-returns?id=${r.id}`}>{r.docNo}</Link> · {t(`i.cond.${r.condition}`)} · {t(`rs.${r.status}`)}</li>)}</ul></div>}
      <History t={t} data={hq.data} testId="issue-history" />
    </div>
  );
}
export default function IssuesPage() {
  const t = useT('inv'); usePageTitle(t('i.issuesTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  const sm = useQuery({ queryKey: ['inv', 'issue-summary'], queryFn: is.summary, retry: false, enabled: !id });
  if (id) return <section aria-labelledby="iss-h" data-testid="issues"><Issue key={id} t={t} id={id} /></section>;
  const k = sm.data;
  return (
    <section aria-labelledby="isss-h" data-testid="issues"><PageHeader id="isss-h" title={t('i.issuesTitle')} subtitle={t('i.issuesIntro')} />
      <div className="actions-row no-print">{perms.includes('inv.issue.create') && <Link to="/inv/issue-new">{t('i.newTitle')}</Link>} <Link to="/inv/site-returns">{t('i.returnsPageTitle')}</Link> {perms.includes('inv.free_issue.view') && <Link to="/inv/free-issue">{t('i.freeTitle')}</Link>}</div>
      {k && <div className="kpi-row" role="list" data-testid="issue-kpis">{['awaitingApproval', 'readyToHandOver', 'issuedToday', 'withoutAuthorisation'].map((key) => <div key={key} role="listitem" className="kpi-tile" data-testid={`issue-kpi-${key}`}><span className="kpi-value">{k[key]}</span><span className="kpi-label">{t(`i.kpi.${key}`)}</span></div>)}</div>}
      <ListReport listCode="inv.issues" endpoint="/inv/issues" exportEndpoint="/ui/lists/inv.issues/export" title={t('i.issuesTitle')} session={session.data} rowHref={(r) => `/inv/issues?id=${r.id}`} onOpen={(r) => navigateTo(`/inv/issues?id=${r.id}`)} cardFields={['docNo', 'issuedTo', 'store', 'status']} statusKey="status" dateKey="date" empty={{ title: t('i.issuesEmptyTitle'), text: t('i.issuesEmptyBody') }} /></section>
  );
}
