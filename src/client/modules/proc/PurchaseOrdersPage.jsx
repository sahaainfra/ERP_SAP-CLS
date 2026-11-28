import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { DELIVERY_TONE, PO_TONE, download, fmtDate, fmtQty, fmtRs, pc } from './api.js';
import { useSearch } from '../site/parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { AttachmentList } from '../core/components/Attachments.jsx';
import DocumentFlow from '../../platform/object/DocumentFlow.jsx';

// Purchase orders (part 15.05): the list with the delivery status; the order with its header, terms, lines with the delivery schedule and the GST split, approvals, amendments (compared), dispatches, goods received and advances.
// Approval is by value; on approval the commitment is posted and the order sent to the vendor with a link to acknowledge it; an approved order changes only by amendment; cancel is refused once goods are received.
const refresh = (qc) => { qc.invalidateQueries({ queryKey: ['proc'] }); qc.invalidateQueries({ queryKey: ['list'] }); };

function Po({ t, id }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['proc', 'po', id], queryFn: () => pc.po(id), retry: false });
  const hq = useQuery({ queryKey: ['proc', 'po-history', id, q.data?.status, q.data?.amendmentNo], queryFn: () => pc.poHistory(id), enabled: q.isSuccess, retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false); const [comment, setComment] = useState(''); const [link, setLink] = useState(null); const [adv, setAdv] = useState({ amount: '', reason: '' });
  usePageTitle(t('o.title'));
  if (q.error?.status === 403) return <NoPermission what={t('o.title')} permission="proc.purchase_order.view" />;
  if (q.isPending) return <Skeleton label={t('o.title')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data; const can = r.can; const tm = r.terms;
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); refresh(qc); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const why = (action, msg) => { const x = window.prompt(t('o.why')); if (x) run(() => pc.poAct(r.id, action, { reason: x }), msg); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('o.sayWhy') }); return; } run(() => pc.decide(r.taskId, action, comment.trim() || null), t(`o.done.${action}`)); };
  const m = (n) => (r.canSeeRates ? fmtRs(n) : '—');
  return (
    <div data-testid="po-object" data-status={r.status}>
      <PageHeader id="po-h" title={<>{r.docNo}{r.amendmentNo > 0 ? ` · ${t('o.amendment')} ${r.amendmentNo}` : ''} <StatusBadge status={PO_TONE[r.status]} label={t(`o.s.${r.status}`)} />{r.deliveryStatus && <> <StatusBadge status={DELIVERY_TONE[r.deliveryStatus]} label={t(`o.d.${r.deliveryStatus}`)} /></>}{r.overdue && <> <StatusBadge status="AT_RISK" label={t('o.overdue')} /></>}</>} meta={<><Link to="/proc/purchase-orders">{t('o.back')}</Link>{r.csId && <> · <Link to={`/proc/comparative-statements?id=${r.csId}`}>{r.csNo}</Link></>}</>} />
      <DocumentFlow type="PO" id={r.id} />
      <dl className="kv" data-testid="po-figures"><div><dt>{t('o.project')}</dt><dd>{r.projectCode}</dd></div><div><dt>{t('o.vendor')}</dt><dd>{r.vendor}</dd></div><div><dt>{t('o.source')}</dt><dd>{r.source === 'CS' ? t('o.srcCs') : `${t('o.srcDirect')}: ${r.directReason ?? ''}`}</dd></div>
        <div><dt>{t('o.basic')}</dt><dd>{m(r.totalBasic)}</dd></div><div><dt>{tm.supplyType === 'INTRA' ? t('o.cgstSgst') : tm.supplyType === 'INTER' ? t('o.igst') : t('o.gst')}</dt><dd data-testid="po-tax">{m(r.totalTax)}</dd></div>{r.totalFreight > 0 && <div><dt>{t('o.freight')}</dt><dd>{m(r.totalFreight)}</dd></div>}
        <div><dt>{t('o.total')}</dt><dd data-testid="po-total">{m(r.totalAmount)}</dd></div><div><dt>{t('o.sent')}</dt><dd data-testid="po-sent">{r.sentAt ? fmtDate(r.sentAt.slice(0, 10)) : r.sentStatus ? t(`o.send.${r.sentStatus}`) : '—'}</dd></div><div><dt>{t('o.acknowledged')}</dt><dd data-testid="po-ack">{r.acknowledgedAt ? fmtDate(r.acknowledgedAt.slice(0, 10)) : '—'}</dd></div></dl>
      <dl className="kv" data-testid="po-terms"><div><dt>{t('o.deliverTo')}</dt><dd>{tm.deliveryAddress ?? '—'} ({tm.deliveryStateCode})</dd></div><div><dt>{t('o.priceBasis')}</dt><dd>{tm.priceBasisLabel}</dd></div><div><dt>{t('o.payment')}</dt><dd>{tm.paymentTerms ?? '—'}{tm.advancePct ? `, ${t('o.advance')} ${tm.advancePct}%` : ''}{tm.creditDays ? `, ${tm.creditDays} ${t('o.days')}` : ''}</dd></div>
        {tm.warrantyTerms && <div><dt>{t('o.warranty')}</dt><dd>{tm.warrantyTerms}</dd></div>}{tm.ldTerms && <div><dt>{t('o.ld')}</dt><dd>{tm.ldTerms}</dd></div>}{tm.documentsRequired && <div><dt>{t('o.docsRequired')}</dt><dd>{tm.documentsRequired}</dd></div>}</dl>
      {r.warnings.map((w, i) => <p key={i} className="mdm-banner" role="status">{w.message}</p>)}
      {error?.form && <p className="field-error" role="alert" data-testid="po-error">{error.form}{error.code === 'EXCEPTION_REQUIRED' && <> <Link to="/controls/exceptions">{t('o.raiseException')}</Link></>}</p>}{note && <p className="mdm-banner" role="status" data-testid="po-note">{note}</p>}
      {link && <div className="mdm-panel" data-testid="po-link"><h2>{t('o.linkTitle')}</h2><p className="muted">{t('o.linkHelp')} {link.sendStatus !== 'QUEUED' && link.note}</p><input readOnly value={link.url} onFocus={(e) => e.target.select()} style={{ width: '100%', minHeight: 40 }} aria-label={t('o.linkTitle')} /></div>}
      <div className="table-scroll"><table className="data-table" data-testid="po-lines"><caption>{t('o.lines')}</caption><thead><tr><th>#</th><th>{t('o.item')}</th><th className="num">{t('o.qty')}</th>{r.canSeeRates && <><th className="num">{t('o.rate')}</th><th className="num">{t('o.gstPct')}</th><th className="num">{t('o.amount')}</th></>}<th>{t('o.schedule')}</th><th className="num">{t('o.received')}</th><th className="num">{t('o.balance')}</th><th>{t('o.requisition')}</th></tr></thead>
        <tbody>{r.lines.map((l) => <tr key={l.id} data-testid="po-line"><td>{l.lineNo}</td><td>{l.itemCode ? `${l.itemCode} · ` : ''}{l.description}</td><td className="num">{fmtQty(l.qty)} {l.uom}</td>{r.canSeeRates && <><td className="num">{fmtRs(l.rate)}{l.rateAboveCs && <div><StatusBadge status="REJECTED" label={t('o.aboveCs')} /></div>}</td><td className="num">{l.gstPct}%</td><td className="num">{fmtRs(l.amount)}</td></>}
          <td>{l.schedule.map((s) => <div key={s.id} className={s.overdue ? 'field-error' : ''}>{fmtDate(s.dueDate)}: {fmtQty(s.qty)} ({fmtQty(s.receivedQty)})</div>)}</td><td className="num">{fmtQty(l.receivedQty)}</td><td className="num">{fmtQty(l.balanceQty)}{l.shortClosedQty > 0 && <div className="muted small">{t('o.shortClosed')} {fmtQty(l.shortClosedQty)}</div>}</td><td>{l.prNo ? <Link to={`/proc/requisitions?id=${l.prId}`}>{l.prNo} #{l.prLineNo}</Link> : '—'}</td></tr>)}</tbody></table></div>
      <div className="actions-row no-print">
        {can.edit && <Link to={`/proc/po-new?edit=${r.id}`}>{t('o.edit')}</Link>}
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => run(() => pc.poAct(r.id, 'submit'), t('o.submitted'))} data-testid="po-submit">{t('o.submit')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('o.withdrawn'))} data-testid="po-withdraw">{t('o.withdraw')}</button>}
        {can.amend && <Link to={`/proc/po-amend?id=${r.id}`}>{t('o.amend')}</Link>}
        {can.shortClose && <button type="button" className="btn" onClick={() => why('short-close', t('o.requested'))} data-testid="po-short-close">{t('o.shortClose')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('o.requested'))} data-testid="po-cancel">{t('o.cancel')}</button>}
        {can.resend && <button type="button" className="btn" disabled={busy} onClick={() => run(() => pc.poAct(r.id, 'resend'), t('o.resent')).then((d) => d && setLink(d))} data-testid="po-resend">{t('o.resend')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('o.deleteAsk')) && await run(() => pc.poDelete(r.id))) navigateTo('/proc/purchase-orders'); }} data-testid="po-delete">{t('o.delete')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/purchase-orders/${r.id}/print`, `${r.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('o.fileFailed') }))} data-testid="po-print">{t('o.print')}</button>}
        {r.workflowInstanceId && <Link to={`/workflow/instance?id=${r.workflowInstanceId}`}>{t('o.approval')}</Link>}
      </div>
      {r.openAmendment && <p className="mdm-banner" role="status" data-testid="po-open-amend">{t('o.openAmend', { kind: t(`o.kind.${r.openAmendment.kind}`), s: t(`o.as.${r.openAmendment.status}`) })} {r.openAmendment.kind === 'AMEND' && <Link to={`/proc/po-amend?id=${r.id}&aid=${r.openAmendment.id}`}>{t('o.open')}</Link>}</p>}
      {r.taskId && (
        <div className="mdm-panel no-print" data-testid="po-decide"><h2>{t('o.decide')}</h2>
          <label>{t('o.comment')}<input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="po-comment" /></label>
          <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('approve')} data-testid="po-approve">{t('o.approve')}</button><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('return')}>{t('o.return')}</button><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('reject')}>{t('o.reject')}</button></div></div>)}
      {r.amendments.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="po-amendments"><caption>{t('o.amendments')}</caption><thead><tr><th>#</th><th>{t('o.kindH')}</th><th>{t('o.reason')}</th>{r.canSeeRates && <th className="num">{t('o.delta')}</th>}<th>{t('o.status')}</th></tr></thead><tbody>{r.amendments.map((a) => <tr key={a.id}><td>{a.amendmentNo}</td><td>{a.kind === 'AMEND' ? <Link to={`/proc/po-amend?id=${r.id}&aid=${a.id}`}>{t('o.kind.AMEND')}</Link> : t(`o.kind.${a.kind}`)}</td><td>{a.reason}</td>{r.canSeeRates && <td className="num">{a.kind === 'AMEND' ? fmtRs(a.deltaAmount) : '—'}</td>}<td>{t(`o.as.${a.status}`)}</td></tr>)}</tbody></table></div>}
      {r.dispatches.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="po-dispatches"><caption>{t('o.dispatches')}</caption><thead><tr><th>ASN</th><th>{t('o.dispatchDate')}</th><th>{t('o.expected')}</th><th>{t('o.vehicle')}</th><th>{t('o.eway')}</th><th>{t('o.by')}</th></tr></thead><tbody>{r.dispatches.map((d) => <tr key={d.id}><td>{d.asnNo}</td><td>{fmtDate(d.dispatchDate)}</td><td>{fmtDate(d.expectedArrival)}</td><td>{d.vehicleNo ?? ''}</td><td>{d.ewayBillNo ?? ''}</td><td>{d.enteredVia === 'VENDOR' ? t('o.byVendor') : t('o.byBuyer')}</td></tr>)}</tbody></table></div>}
      {r.dispatches.some((dispatch) => dispatch.invoiceFileId) && <details className="mdm-panel no-print">
        <summary>Supplier dispatch attachments</summary>
        <AttachmentList entity="proc_purchase_order" entityId={r.id} />
      </details>}
      {r.receipts.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="po-receipts"><caption>{t('o.grns')}</caption><thead><tr><th>GRN</th><th>{t('o.line')}</th><th>{t('o.receivedOn')}</th><th className="num">{t('o.received')}</th><th className="num">{t('o.accepted')}</th><th>{t('o.onTime')}</th></tr></thead><tbody>{r.receipts.map((x) => <tr key={x.id}><td>{x.grnRef}</td><td>{x.lineNo}</td><td>{fmtDate(x.receivedOn)}</td><td className="num">{fmtQty(x.qty)}</td><td className="num">{fmtQty(x.acceptedQty)}</td><td>{x.onTime ? t('o.yes') : t('o.no')}</td></tr>)}</tbody></table></div>}
      {(r.advances.length > 0 || can.advance) && (
        <div className="mdm-panel" data-testid="po-advances"><h2>{t('o.advances')}</h2>
          <ul>{r.advances.map((a) => <li key={a.id} data-testid="po-advance">{a.docNo}: {fmtRs(a.amount)} · {t(`o.as.${a.status}`)} · {a.reason}</li>)}</ul>
          {can.advance && <div className="actions-row no-print"><input type="number" min="0" step="0.01" value={adv.amount} placeholder={t('o.advAmount')} onChange={(e) => setAdv({ ...adv, amount: e.target.value })} style={{ minHeight: 'var(--erp-target-min)', width: 150 }} aria-label={t('o.advAmount')} data-testid="po-adv-amount" /><input value={adv.reason} placeholder={t('o.reason')} maxLength={500} onChange={(e) => setAdv({ ...adv, reason: e.target.value })} style={{ minHeight: 'var(--erp-target-min)', flex: 1 }} aria-label={t('o.reason')} data-testid="po-adv-reason" />
            <button type="button" className="btn" style={{ minHeight: 'var(--erp-target-min)' }} disabled={busy || !adv.amount || adv.reason.trim().length < 5} onClick={() => run(() => pc.poAct(r.id, 'advances', { amount: Number(adv.amount), reason: adv.reason.trim() }), t('o.advAsked')).then(() => setAdv({ amount: '', reason: '' }))} data-testid="po-adv-go">{t('o.askAdvance')}</button></div>}</div>)}
      {hq.data && (hq.data.approvals.length > 0 || hq.data.audit.length > 0) && (
        <div className="table-scroll"><table className="data-table" data-testid="po-history"><caption>{t('o.history')}</caption><thead><tr><th>{t('o.when')}</th><th>{t('o.who')}</th><th>{t('o.what')}</th><th>{t('o.comment')}</th></tr></thead>
          <tbody>{[...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, note: a.reason })), ...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, note: a.comment }))].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((h, i) => <tr key={i}><td>{String(h.at).slice(0, 16).replace('T', ' ')}</td><td>{h.who}</td><td>{h.what}</td><td>{h.note ?? ''}</td></tr>)}</tbody></table></div>)}
    </div>
  );
}

export default function PurchaseOrdersPage() {
  const t = useT('proc'); usePageTitle(t('o.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  if (id) return <section aria-labelledby="po-h" data-testid="proc-pos"><Po key={id} t={t} id={id} /></section>;
  return (
    <section aria-labelledby="pos-h" data-testid="proc-pos">
      <PageHeader id="pos-h" title={t('o.title')} subtitle={t('o.intro')} />
      <div className="actions-row no-print">{perms.includes('proc.purchase_order.create') && <Link to="/proc/po-new">{t('o.new')}</Link>} <Link to="/proc/po-tracker">{t('o.tracker')}</Link></div>
      <ListReport listCode="proc.purchase_orders" endpoint="/proc/purchase-orders" exportEndpoint="/ui/lists/proc.purchase_orders/export" title={t('o.title')} session={session.data} rowHref={(r) => `/proc/purchase-orders?id=${r.id}`} onOpen={(r) => navigateTo(`/proc/purchase-orders?id=${r.id}`)}
        cardFields={['docNo', 'vendor', 'project', 'amount', 'delivery']} statusKey="status" empty={{ title: t('o.emptyTitle'), text: t('o.emptyBody') }} />
    </section>
  );
}
