import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { RESPONSES, TX_TONE, dayIST, eg, openPrint } from './api.js';
import { useSearch } from './parts.jsx';

// Transmittal (part 11.01, FR-03): the covering record, its drawings with the response codes A to D, and the actions along its life.
export default function TransmittalPage() {
  const t = useT('engg');
  const qc = useQueryClient();
  const id = Number(useSearch().get('id')) || null;
  const q = useQuery({ queryKey: ['engg', 'transmittal', id], queryFn: () => eg.transmittal(id), enabled: Boolean(id), retry: false });
  const h = useQuery({ queryKey: ['engg', 'transmittal-history', id], queryFn: () => eg.transmittalHistory(id), enabled: Boolean(id) && q.isSuccess, retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [resp, setResp] = useState({});
  usePageTitle(q.data ? `${q.data.docNo} ${q.data.party}` : t('tx.title'));
  if (!id) return <section aria-labelledby="tx-h" data-testid="tx-none"><h1 id="tx-h">{t('tx.title')}</h1><p className="muted"><Link to="/engg/transmittals">{t('nav.transmittals')}</Link></p></section>;
  if (q.error?.status === 403) return <NoPermission what={t('nav.transmittals')} permission="engg.transmittal.view" />;
  if (q.isPending) return <Skeleton label={t('tx.title')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const x = q.data; const c = x.can;
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['engg'] }); return r; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const r = window.prompt(t('act.why')); if (r) run(() => fn(r), done); };
  const answers = x.items.filter((i) => !i.responseCode && resp[i.id]?.code).map((i) => ({ itemId: i.id, code: resp[i.id].code, comments: resp[i.id].comments?.trim() || null, date: dayIST() }));
  const send = (e) => { e.preventDefault(); run(async () => { await eg.transmittalAct(x.id, 'responses', { responses: answers }); setResp({}); }, t('tx.responded')); };
  return (
    <section aria-labelledby="tx-h" data-testid="transmittal" data-status={x.status}>
      <header>
        <h1 id="tx-h">{x.docNo} · {x.party} <StatusBadge status={TX_TONE[x.status]} label={t(`txs.${x.status}`)} /></h1>
        <p className="muted">{x.projectCode} · {t(`dir.${x.direction}`)} · {t(`purpose.${x.purpose}`)}{x.issuedOn ? ` · ${t('tx.issuedOn')}: ${x.issuedOn}` : ''}{x.dueOn ? ` · ${t('tx.due')}: ${x.dueOn}` : ''}{x.overdue ? ` · ${t('dwg.overdue')}` : ''}{x.contact ? ` · ${x.contact}` : ''}</p>
        {x.coverNote && <p data-testid="tx-cover">{x.coverNote}</p>}
        {error?.form && <p className="field-error" role="alert" data-testid="tx-act-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
        {note && <p className="mdm-banner" role="status" data-testid="tx-note">{note}</p>}
        <div className="actions-row no-print">
          {c.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => eg.transmittalAct(x.id, 'submit'), x.needsApproval ? t('tx.sentForApproval') : t('tx.issued'))} data-testid="tx-submit">{x.needsApproval ? t('tx.submitApproval') : x.direction === 'IN' ? t('tx.register') : t('tx.issue')}</button>}
          {c.withdraw && <button type="button" className="btn" onClick={() => why((r) => eg.transmittalAct(x.id, 'withdraw', { reason: r }), t('tx.withdrawn'))} data-testid="tx-withdraw">{t('act.withdraw')}</button>}
          {c.cancel && <button type="button" className="btn" onClick={() => why((r) => eg.transmittalAct(x.id, 'cancel', { reason: r }), t('tx.cancelled'))} data-testid="tx-cancel">{t('act.cancel')}</button>}
          {c.amend && <button type="button" className="btn" onClick={async () => { const r = window.prompt(t('act.why')); if (r) { const n = await run(() => eg.transmittalAct(x.id, 'amend', { reason: r })); if (n) navigateTo(`/engg/transmittal?id=${n.id}`); } }} data-testid="tx-amend">{t('act.amend')}</button>}
          {c.delete && <button type="button" className="btn" onClick={async () => { if (await run(() => eg.removeTransmittal(x.id))) navigateTo('/engg/transmittals'); }} data-testid="tx-delete">{t('act.delete')}</button>}
          {c.print && <button type="button" className="btn" onClick={() => openPrint(`/transmittals/${x.id}/print`, `${x.docNo}.html`)} data-testid="tx-print">{t('act.print')}</button>}
          {x.workflowInstanceId && <Link to={`/workflow/instance?id=${x.workflowInstanceId}`}>{t('rev.approval')}</Link>}
        </div>
      </header>
      <form className="mdm-panel" aria-label={t('tx.drawings')} data-testid="tx-items" onSubmit={send}>
        <h2>{t('tx.drawings')}</h2>
        <div className="table-scroll"><table><thead><tr><th>{t('col.drawingNo')}</th><th>{t('col.title')}</th><th>{t('f.revision')}</th><th>{t('tx.copies')}</th><th>{t('tx.response')}</th></tr></thead>
          <tbody>{x.items.map((i) => (
            <tr key={i.id} data-testid={`tx-item-${i.drawingNo}`} data-response={i.responseCode ?? ''}>
              <td><Link to={`/engg/drawing?id=${i.drawingId}`}>{i.drawingNo}</Link></td><td>{i.title}</td>
              <td>{i.revision} {t(`code.${i.statusCode}`)}{i.banner ? <> <strong>{i.banner}</strong></> : null}</td><td>{i.copies}</td>
              <td>{i.responseCode ? <span data-testid={`tx-resp-${i.drawingNo}`}>{i.responseLabel}{i.comments ? ` — ${i.comments}` : ''}</span> : c.respond ? (
                <span>
                  <select aria-label={t('tx.response')} value={resp[i.id]?.code ?? ''} onChange={(e) => setResp({ ...resp, [i.id]: { ...resp[i.id], code: e.target.value } })} data-testid={`tx-code-${i.drawingNo}`}><option value="">—</option>{RESPONSES.map((k) => <option key={k} value={k}>{k} {t(`resp.${k}`)}</option>)}</select>
                  <input aria-label={t('tx.comments')} value={resp[i.id]?.comments ?? ''} onChange={(e) => setResp({ ...resp, [i.id]: { ...resp[i.id], comments: e.target.value } })} placeholder={t('tx.comments')} maxLength={1000} data-testid={`tx-comment-${i.drawingNo}`} />
                </span>) : '—'}</td>
            </tr>))}</tbody></table></div>
        {c.respond && <div className="actions"><button type="submit" className="btn btn-primary" disabled={answers.length === 0} data-testid="tx-respond">{t('tx.recordResponses')}</button></div>}
      </form>
      <div className="mdm-panel" data-testid="tx-history"><h2>{t('dwg.history')}</h2>
        <ol>{(h.data?.audit ?? []).map((a, n) => <li key={n}>{String(a.at).slice(0, 16).replace('T', ' ')} · {a.actor} · {a.action}{a.reason ? ` — ${a.reason}` : ''}</li>)}</ol></div>
    </section>
  );
}
