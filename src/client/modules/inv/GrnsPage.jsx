import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { GRN_TONE, download, fmtDate, fmtQty, fmtRs, gr, iv } from './api.js';
import { History, useRunner } from './InvParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Goods Receipts (part 16.03): the list with the inspection status, and the receipt with its lines, the inspection by quality control, the documents and the postings it made (the trace to the stock ledger).
function Grn({ t, id }) {
  const q = useQuery({ queryKey: ['inv', 'grn', id], queryFn: () => gr.grn(id), retry: false }); const hq = useQuery({ queryKey: ['inv', 'grn-history', id, q.data?.status], queryFn: () => gr.history(id), enabled: q.isSuccess, retry: false });
  const { error, setError, note, busy, run } = useRunner(); const [comment, setComment] = useState(''); const [res, setRes] = useState({}); usePageTitle(t('r.grnTitle'));
  if (q.error?.status === 403 || q.error?.status === 404) return <NoPermission what={t('r.grnTitle')} permission="inv.grn.view" />;
  if (q.isPending) return <Skeleton label={t('r.grnTitle')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const g = q.data; const can = g.can; const why = (action, msg) => { const x = window.prompt(t('why')); if (x) run(() => gr.act(g.id, action, { reason: x }), msg); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('sayWhy') }); return; } run(() => iv.decide(g.taskId, action, comment.trim() || null), t(`done.${action}`)); };
  const inspect = () => run(() => gr.act(g.id, 'inspection', { results: Object.entries(res).map(([lineId, v]) => ({ lineId: Number(lineId), passedQty: Number(v.p || 0), failedQty: Number(v.f || 0) })).filter((x) => x.passedQty > 0 || x.failedQty > 0) }), t('r.inspected')).then((x) => { if (x) setRes({}); });
  return (
    <div data-testid="grn-object" data-status={g.status}>
      <PageHeader id="gr-h" title={<>{g.docNo} <StatusBadge status={GRN_TONE[g.status]} label={t(`rs.${g.status}`)} /></>} meta={<><Link to="/inv/grns">{t('r.grnTitle')}</Link> · {g.store} · {g.vendor}{g.poNo ? ` · ${g.poNo}` : ` · ${t('r.emergency')}`}</>} />
      {g.excess && <p className="mdm-banner" role="status" data-testid="grn-excess">{t('r.excessNote')}</p>}{g.emergency && <p className="mdm-banner" role="status">{t('r.emergencyWhy')}: {g.emergencyWhy}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="grn-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{note && <p className="mdm-banner" role="status" data-testid="grn-note">{note}</p>}
      <dl className="kv"><div><dt>{t('r.receivedOn')}</dt><dd>{fmtDate(g.date)}</dd></div>{g.gateNo && <div><dt>{t('r.gateEntry')}</dt><dd><Link to={`/inv/gate-entry?id=${g.gateInwardId}`}>{g.gateNo}</Link></dd></div>}<div><dt>{t('g.challanNo')}</dt><dd>{g.challanNo ?? '—'} {g.challanDate ? fmtDate(g.challanDate) : ''}</dd></div><div><dt>{t('r.invoiceNo')}</dt><dd>{g.invoiceNo ?? '—'}</dd></div>{g.totalValue != null && <div><dt>{t('r.value')}</dt><dd data-testid="grn-value">{fmtRs(g.totalValue)}</dd></div>}<div><dt>{t('g.requestedBy')}</dt><dd>{g.requestedBy}</dd></div>{g.approvedBy && <div><dt>{t('approvedBy')}</dt><dd>{g.approvedBy}</dd></div>}</dl>
      <div className="table-scroll"><table className="data-table" data-testid="grn-lines"><caption>{t('r.lines')}</caption><thead><tr><th>{t('item')}</th><th className="num">{t('r.ordered')}</th><th className="num">{t('r.challanQty')}</th><th className="num">{t('r.receivedQty')}</th><th className="num">{t('r.acceptedQty')}</th><th className="num">{t('r.rejectedQty')}</th><th>{t('r.batchNo')}</th><th>{t('r.inspection')}</th>{can.inspect && <th>{t('r.passed')} / {t('r.failed')}</th>}</tr></thead>
        <tbody>{g.lines.map((l) => <tr key={l.id} data-testid={`grn-line-${l.lineNo}`}><td data-label={t('item')}>{l.item}{l.directCharge ? ` (${t('r.direct')})` : ''}</td><td className="num" data-label={t('r.ordered')}>{fmtQty(l.orderedQty)}</td><td className="num" data-label={t('r.challanQty')}>{fmtQty(l.challanQty)}</td><td className="num" data-label={t('r.receivedQty')}>{fmtQty(l.receivedQty)}</td><td className="num" data-label={t('r.acceptedQty')}>{fmtQty(l.acceptedQty)}</td><td className="num" data-label={t('r.rejectedQty')}>{fmtQty(l.rejectedQty)}</td><td data-label={t('r.batchNo')}>{l.batchNo ?? '—'}{l.heatNo ? ` / ${l.heatNo}` : ''}{l.certName ? ` · ${l.certName}` : ''}</td>
          <td data-label={t('r.inspection')} data-testid={`grn-insp-${l.lineNo}`}>{t(`ri.${l.inspectionStatus}`)}{l.inspectionRequired ? ` (${t('r.released')} ${fmtQty(l.releasedQty)}, ${t('r.failed')} ${fmtQty(l.qcRejectedQty)}, ${t('r.waiting')} ${fmtQty(l.awaitingQc)})` : ''}</td>
          {can.inspect && <td>{l.awaitingQc > 0 ? <span className="actions-row"><input aria-label={t('r.passed')} type="number" min="0" step="0.001" max={l.awaitingQc} value={res[l.id]?.p ?? ''} onChange={(ev) => setRes({ ...res, [l.id]: { ...res[l.id], p: ev.target.value } })} style={{ minHeight: 44, width: 90 }} data-testid={`grn-pass-${l.lineNo}`} /><input aria-label={t('r.failed')} type="number" min="0" step="0.001" max={l.awaitingQc} value={res[l.id]?.f ?? ''} onChange={(ev) => setRes({ ...res, [l.id]: { ...res[l.id], f: ev.target.value } })} style={{ minHeight: 44, width: 90 }} data-testid={`grn-fail-${l.lineNo}`} /></span> : '—'}</td>}</tr>)}</tbody></table></div>
      <div className="actions-row no-print">
        {can.inspect && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !Object.values(res).some((v) => Number(v.p) > 0 || Number(v.f) > 0)} onClick={inspect} data-testid="grn-inspect">{t('r.saveInspection')}</button>}
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => gr.act(g.id, 'submit'), t('submitted'))} data-testid="grn-submit">{t('sendForApproval')}</button>}
        {can.returnToVendor && <button type="button" className="btn" style={{ minHeight: 48 }} onClick={() => navigateTo(`/inv/rtvs?new=1&grn=${g.id}`)} data-testid="grn-rtv">{t('r.returnToVendor')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('withdrawn'))}>{t('withdraw')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('cancelled'))} data-testid="grn-cancel">{t('cancel')}</button>}
        {can.amend && <button type="button" className="btn" onClick={() => { const inv = window.prompt(t('r.newInvoiceNo')); if (inv) why2(inv); }}>{t('r.amendDocs')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/grns/${g.id}/print`, `${g.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('g.fileFailed') }))} data-testid="grn-print">{t('g.print')}</button>}
        {g.workflowInstanceId && <Link to={`/workflow/instance?id=${g.workflowInstanceId}`}>{t('approval')}</Link>}</div>
      {g.taskId && <div className="mdm-panel no-print" data-testid="grn-decide"><h2>{t('decide')}</h2><label>{t('comment')}<input value={comment} onChange={(ev) => setComment(ev.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="grn-comment" /></label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="grn-approve">{t('r.approvePost')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')}>{t('return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')}>{t('reject')}</button></div></div>}
      {g.photos.length > 0 && <div className="mdm-panel"><h2>{t('g.photos')}</h2><ul>{g.photos.map((p) => <li key={p.fileId}><a href={`/api/v1/core/files/${p.fileId}/download`} target="_blank" rel="noreferrer">{p.name}</a></li>)}</ul></div>}
      {g.postings.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="grn-postings"><caption>{t('r.postings')}</caption><thead><tr><th>{t('r.entry')}</th><th>{t('r.type')}</th><th className="num">{t('qty')}</th><th>{t('r.date')}</th></tr></thead><tbody>{g.postings.map((p) => <tr key={p.docNo}><td><Link to={`/inv/ledger`}>{p.docNo}</Link></td><td>{p.type}</td><td className="num">{fmtQty(p.qty)}</td><td>{fmtDate(p.date)}</td></tr>)}</tbody></table></div>}
      {g.returns.length > 0 && <div className="mdm-panel" data-testid="grn-returns"><h2>{t('r.rtvTitle')}</h2><ul>{g.returns.map((r) => <li key={r.id}><Link to={`/inv/rtvs?id=${r.id}`}>{r.docNo}</Link> · {t(`rs.${r.status}`)}</li>)}</ul></div>}
      <History t={t} data={hq.data} testId="grn-history" />
    </div>
  );
  function why2(inv) { const x = window.prompt(t('why')); if (x) run(() => gr.act(g.id, 'amend', { reason: x, invoiceNo: inv }), t('g.amended')); }
}

export default function GrnsPage() {
  const t = useT('inv'); usePageTitle(t('r.grnTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  const sm = useQuery({ queryKey: ['inv', 'grn-summary'], queryFn: gr.summary, retry: false, enabled: !id });
  if (id) return <section aria-labelledby="gr-h" data-testid="grns"><Grn key={id} t={t} id={id} /></section>;
  const k = sm.data;
  return (
    <section aria-labelledby="grs-h" data-testid="grns"><PageHeader id="grs-h" title={t('r.grnTitle')} subtitle={t('r.grnIntro')} />
      <div className="actions-row no-print">{perms.includes('inv.grn.create') && <Link to="/inv/grn-new">{t('r.newTitle')}</Link>} <Link to="/inv/rtvs">{t('r.rtvTitle')}</Link> <Link to="/inv/gate-register">{t('g.registerTitle')}</Link></div>
      {k && <div className="kpi-row" role="list" data-testid="grn-kpis">{[['awaitingGrn', k.awaitingGrn], ['awaitingApproval', k.awaitingApproval], ['inspectionPending', k.inspectionPending], ['openReturns', k.openReturns]].map(([key, v]) => <div key={key} role="listitem" className="kpi-tile" data-testid={`grn-kpi-${key}`}><span className="kpi-value">{v}</span><span className="kpi-label">{t(`r.kpi.${key}`)}</span></div>)}</div>}
      <ListReport listCode="inv.grns" endpoint="/inv/grns" title={t('r.grnTitle')} session={session.data} rowHref={(r) => `/inv/grns?id=${r.id}`} onOpen={(r) => navigateTo(`/inv/grns?id=${r.id}`)} cardFields={['docNo', 'vendor', 'store', 'status']} statusKey="status" dateKey="date" empty={{ title: t('r.grnEmptyTitle'), text: t('r.grnEmptyBody') }} /></section>
  );
}
