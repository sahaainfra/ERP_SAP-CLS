import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { STATUS_TONE, download, fmtDate, fmtQty, pc } from './api.js';
import { useSearch } from '../site/parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import DocumentFlow from '../../platform/object/DocumentFlow.jsx';

// Material Requests (part 15.01, FR-01, FR-02): the site view with the fulfilment status of each request; the request itself with its lines, the free stock of the site, nearby stores and the central warehouse, the way each line is met (issue,
// transfer, purchase) and the requisitions it ended in. The construction manager decides it here; the procurement officer meets it.
const refresh = (qc) => { qc.invalidateQueries({ queryKey: ['proc'] }); qc.invalidateQueries({ queryKey: ['list'] }); };

function Fulfil({ t, m, onDone, run }) {
  const [rows, setRows] = useState({});
  const set = (id, k, v) => setRows({ ...rows, [id]: { mode: 'ISSUE', qty: '', storeCode: '', ...rows[id], [k]: v } });
  const go = () => { const lines = Object.entries(rows).filter(([, r]) => Number(r.qty) > 0).map(([id, r]) => ({ lineId: Number(id), mode: r.mode, qty: Number(r.qty), storeCode: r.mode === 'TRANSFER' ? r.storeCode || null : r.storeCode || null })); if (lines.length) run(() => pc.mrAct(m.id, 'fulfil', { lines }), t('p.fulfilDone')).then(onDone); };
  return (
    <div className="mdm-panel no-print" data-testid="mr-fulfil"><h2>{t('p.fulfilTitle')}</h2><p className="muted">{t('p.fulfilHelp')}</p>
      {m.lines.filter((l) => l.openQty > 0).map((l) => { const r = rows[l.id] ?? { mode: 'ISSUE', qty: '', storeCode: '' }; const stores = l.availability?.stores ?? [];
        return (
          <div key={l.id} className="form-grid" data-testid="mr-fulfil-line"><strong>{l.itemCode} · {t('p.openQty', { n: fmtQty(l.openQty), u: l.uom })}</strong>
            <label>{t('p.mode')}<select value={r.mode} onChange={(e) => set(l.id, 'mode', e.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="mr-fulfil-mode"><option value="ISSUE">{t('p.mode.ISSUE')}</option><option value="TRANSFER">{t('p.mode.TRANSFER')}</option></select></label>
            <label>{t('p.store')}<select value={r.storeCode} onChange={(e) => set(l.id, 'storeCode', e.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="mr-fulfil-store"><option value="">{t('p.choose')}</option>{stores.filter((s) => (r.mode === 'ISSUE' ? s.relation === 'SAME_SITE' : s.relation !== 'SAME_SITE')).map((s) => <option key={s.storeCode} value={s.storeCode}>{s.storeName} ({fmtQty(s.freeQty)})</option>)}</select></label>
            <label>{t('p.qty')}<input type="number" min="0" step="0.001" value={r.qty} onChange={(e) => set(l.id, 'qty', e.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="mr-fulfil-qty" /></label>
          </div>
        ); })}
      <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} onClick={go} data-testid="mr-fulfil-go">{t('p.fulfilGo')}</button><Link to={`/proc/consolidate?mr=${m.id}`}>{t('p.toPr')}</Link></div>
    </div>
  );
}

function Mr({ t, id }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['proc', 'mr', id], queryFn: () => pc.mr(id), retry: false });
  const hq = useQuery({ queryKey: ['proc', 'mr-history', id], queryFn: () => pc.mrHistory(id), enabled: q.isSuccess, retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false); const [comment, setComment] = useState('');
  usePageTitle(t('p.mrTitle'));
  if (q.error?.status === 403) return <NoPermission what={t('p.mrTitle')} permission="proc.material_request.view" />;
  if (q.isPending) return <Skeleton label={t('p.mrTitle')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const m = q.data; const can = m.can;
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); refresh(qc); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const why = (action, msg) => { const x = window.prompt(t('p.why')); if (x) run(() => pc.mrAct(m.id, action, { reason: x }), msg).then((d) => { if (d && action === 'amend') navigateTo(`/proc/material-requests?id=${d.id}`); }); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('p.sayWhy') }); return; } run(() => pc.decide(m.taskId, action, comment.trim() || null), t(`p.done.${action}`)); };
  return (
    <div data-testid="mr-object" data-status={m.status}>
      <PageHeader id="mr-h" title={<>{m.docNo} <StatusBadge status={STATUS_TONE[m.status]} label={t(`p.s.${m.status}`)} />{m.fulfilment && <> <StatusBadge status={m.fulfilment === 'COVERED' ? 'COMPLETED' : m.fulfilment === 'PARTIAL' ? 'IN_REVIEW' : 'DRAFT'} label={t(`p.f.${m.fulfilment}`)} /></>}</>} meta={<Link to="/proc/material-requests">{t('p.back')}</Link>} />
      <DocumentFlow type="MR" id={m.id} />
      <dl className="kv" data-testid="mr-figures"><div><dt>{t('p.project')}</dt><dd>{m.projectCode} · {m.siteCode}</dd></div><div><dt>{t('p.requiredBy')}</dt><dd>{fmtDate(m.requiredBy)}</dd></div><div><dt>{t('p.priority')}</dt><dd>{t(`p.pri.${m.priority}`)}</dd></div><div><dt>{t('p.requestedBy')}</dt><dd>{m.requestedBy}</dd></div>{m.waNo && <div><dt>{t('p.wa')}</dt><dd data-testid="mr-wa"><Link to={`/site/work-authorisations?id=${m.waId}`}>{m.waNo}</Link>{m.activity ? ` · ${m.activity}` : ''}</dd></div>}{m.approvedBy && <div><dt>{t('p.approvedBy')}</dt><dd>{m.approvedBy}</dd></div>}</dl>
      {m.purpose && <p>{m.purpose}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="mr-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="mr-note">{note}</p>}
      <div className="table-scroll"><table className="data-table" data-testid="mr-lines"><caption>{t('p.lines')}</caption><thead><tr><th>#</th><th>{t('p.item')}</th><th className="num">{t('p.qty')}</th><th>{t('p.wbs')}</th><th>{t('p.freeStock')}</th><th>{t('p.metBy')}</th><th>{t('p.requisitions')}</th></tr></thead>
        <tbody>{m.lines.map((l) => <tr key={l.id} data-testid="mr-line"><td>{l.lineNo}</td><td>{l.itemCode} · {l.itemName}</td><td className="num">{fmtQty(l.qty)} {l.uom}</td><td>{l.wbs ?? '—'}</td>
          <td>{l.availability ? <>{fmtQty(l.availability.controlQty)} {l.availability.covers && <StatusBadge status="AT_RISK" label={t('p.covers')} />}<ul className="muted small">{l.availability.stores.map((s) => <li key={s.storeCode}>{s.storeName}: {fmtQty(s.freeQty)}</li>)}</ul></> : '—'}</td>
          <td>{t(`p.mode.${l.mode}`)}{l.issueQty > 0 && <div className="small">{t('p.issued', { n: fmtQty(l.issueQty) })}</div>}{l.transferQty > 0 && <div className="small">{t('p.transferred', { n: fmtQty(l.transferQty) })}</div>}{l.prQty > 0 && <div className="small">{t('p.purchased', { n: fmtQty(l.prQty) })}</div>}</td>
          <td>{l.requisitions.map((x) => <Link key={x.id} to={`/proc/requisitions?id=${x.id}`}>{x.docNo} </Link>)}</td></tr>)}</tbody></table></div>
      <div className="actions-row no-print">
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => run(() => pc.mrAct(m.id, 'submit'), t('p.sent'))} data-testid="mr-submit">{t('p.send')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('p.withdrawn'))} data-testid="mr-withdraw">{t('p.withdraw')}</button>}
        {can.amend && <button type="button" className="btn" onClick={() => why('amend')} data-testid="mr-amend">{t('p.amend')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('p.cancelled'))} data-testid="mr-cancel">{t('p.cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('p.deleteAsk')) && await run(() => pc.mrDelete(m.id))) navigateTo('/proc/material-requests'); }} data-testid="mr-delete">{t('p.delete')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/material-requests/${m.id}/print`, `${m.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('p.fileFailed') }))} data-testid="mr-print">{t('p.print')}</button>}
        {m.workflowInstanceId && <Link to={`/workflow/instance?id=${m.workflowInstanceId}`}>{t('p.approval')}</Link>}
      </div>
      {m.taskId && (
        <div className="mdm-panel no-print" data-testid="mr-decide"><h2>{t('p.decide')}</h2>
          <label>{t('p.comment')}<input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="mr-comment" /></label>
          <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('approve')} data-testid="mr-approve">{t('p.approve')}</button><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('return')} data-testid="mr-return">{t('p.return')}</button><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('reject')} data-testid="mr-reject">{t('p.reject')}</button></div>
        </div>
      )}
      {can.process && m.lines.some((l) => l.openQty > 0) && <Fulfil t={t} m={m} onDone={() => q.refetch()} run={run} />}
      {hq.data && (hq.data.approvals.length > 0 || hq.data.audit.length > 0) && (
        <div className="table-scroll"><table className="data-table" data-testid="mr-history"><caption>{t('p.history')}</caption><thead><tr><th>{t('p.when')}</th><th>{t('p.who')}</th><th>{t('p.what')}</th><th>{t('p.comment')}</th></tr></thead>
          <tbody>{[...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, note: a.reason })), ...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, note: a.comment }))].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((r, i) => <tr key={i}><td>{String(r.at ?? '').slice(0, 16).replace('T', ' ')}</td><td>{r.who}</td><td>{r.what}</td><td>{r.note ?? ''}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

export default function MaterialRequestsPage() {
  const t = useT('proc'); usePageTitle(t('p.mrTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  if (id) return <section aria-labelledby="mr-h" data-testid="proc-mrs"><Mr key={id} t={t} id={id} /></section>;
  return (
    <section aria-labelledby="mrs-h" data-testid="proc-mrs">
      <PageHeader id="mrs-h" title={t('p.mrTitle')} subtitle={t('p.mrIntro')} />
      <div className="actions-row no-print">{perms.includes('proc.material_request.create') && <Link to="/proc/material-requests/new">{t('p.mrNew')}</Link>} {perms.includes('proc.requisition.create') && <Link to="/proc/consolidate">{t('p.consolidate')}</Link>} <Link to="/proc/requisitions">{t('p.prTitle')}</Link></div>
      <ListReport listCode="proc.material_requests" endpoint="/proc/material-requests" exportEndpoint="/ui/lists/proc.material_requests/export" title={t('p.mrTitle')} session={session.data} rowHref={(r) => `/proc/material-requests?id=${r.id}`} onOpen={(r) => navigateTo(`/proc/material-requests?id=${r.id}`)}
        cardFields={['docNo', 'site', 'requiredBy', 'priority', 'fulfilment']} statusKey="status" empty={{ title: t('p.mrEmptyTitle'), text: t('p.mrEmptyBody') }} />
    </section>
  );
}
