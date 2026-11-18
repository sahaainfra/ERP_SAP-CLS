import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { JN_TONE, gl, money } from './api.js';

// Part 23.01: the journals of the book (List Report) and one journal (its lines with their dimensions, its source document, its reversal, its approval).
const big = { minHeight: 48, fontSize: '1rem' };

/** The call runner of the general ledger pages: the error (form and fields), a note when done, and the lists refreshed. */
export function useGlRunner() {
  const qc = useQueryClient(); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false);
  const run = async (fn, done) => {
    setError(null); setNote(null); setBusy(true);
    try { const x = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['gl'] }); qc.invalidateQueries({ queryKey: ['list'] }); return x; }
    catch (e) { setError({ form: e?.message ?? String(e), fields: e?.errors?.length ? Object.fromEntries(e.errors.map((x) => [x.field, x.message])) : null, correlationId: e?.correlationId ?? null }); return null; }
    finally { setBusy(false); }
  };
  return { error, setError, note, setNote, busy, run };
}
export function GlError({ error, id = 'gl-error' }) {
  if (!error?.form) return null;
  return <div className="field-error" role="alert" data-testid={id}><p>{error.form}{error.correlationId ? ` (${error.correlationId})` : ''}</p>{error.fields && <ul>{Object.entries(error.fields).map(([k, v]) => <li key={k}>{v}</li>)}</ul>}</div>;
}
export function JStatus({ x }) { const t = useT('fin'); return <StatusBadge status={JN_TONE[x.status]} label={t(`st.${x.status}`)} />; }

function Lines({ x }) {
  const t = useT('fin');
  return (
    <div className="table-scroll" data-testid="gl-lines"><table className="data-table"><caption>{t('jn.lines')}</caption>
      <thead><tr><th scope="col">#</th><th scope="col">{t('jn.account')}</th><th scope="col">{t('jn.dims')}</th><th scope="col">{t('jn.lineNarration')}</th><th scope="col" className="num">{t('jn.debit')}</th><th scope="col" className="num">{t('jn.credit')}</th></tr></thead>
      <tbody>{x.lines.map((l) => (
        <tr key={l.id} data-testid={`gl-line-${l.lineNo}`}><td>{l.lineNo}</td><td><Link to={`/finance/ledger?accountId=${l.accountId}&to=${x.voucherDate}`}>{l.account}</Link></td>
          <td>{Object.entries(l.labels).filter(([, v]) => v).map(([k, v]) => <span key={k} className="chip">{v}</span>)}</td><td>{l.narration ?? ''}</td>
          <td className="num">{l.debit ? money(l.debit) : ''}</td><td className="num">{l.credit ? money(l.credit) : ''}</td></tr>))}</tbody>
      <tfoot><tr><th scope="row" colSpan={4}>{t('tb.total')}</th><td className="num"><strong data-testid="gl-debit">{money(x.debit)}</strong></td><td className="num"><strong data-testid="gl-credit">{money(x.credit)}</strong></td></tr></tfoot>
    </table></div>
  );
}

function Actions({ x }) {
  const t = useT('fin'); const { error, setError, note, busy, run } = useGlRunner(); const [comment, setComment] = useState(''); const can = x.can ?? {};
  const hq = useQuery({ queryKey: ['gl', 'history', x.id, x.status], queryFn: () => gl.history(x.id), retry: false });
  const why = (action, done) => { const r = globalThis.prompt(t('act.why')); if (r) run(() => gl.act(x.id, action, { reason: r }), done); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('act.sayWhy') }); return; } run(() => gl.decide(x.taskId, action, comment.trim() || null), t(`done.${action}`)); };
  const reverse = () => { const r = globalThis.prompt(t('jn.reverseWhy')); if (!r) return; const d = globalThis.prompt(t('jn.reverseDate'), x.voucherDate > new Date().toISOString().slice(0, 10) ? x.voucherDate : new Date().toISOString().slice(0, 10)); if (!d) return; run(async () => { const rv = await gl.act(x.id, 'reverse', { reason: r, date: d }); navigateTo(`/finance/journals?id=${rv.id}`); return rv; }, t('jn.reversed')); };
  return (
    <>
      <GlError error={error} />{note && <p className="mdm-banner" role="status" data-testid="gl-note">{note}</p>}
      <div className="actions-row no-print">
        {can.edit && <Link to={`/finance/journal-entry?id=${x.id}`}>{t('jn.edit')}</Link>}
        {can.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => gl.act(x.id, 'submit'), t('jn.submitted'))} data-testid="gl-submit">{t('act.submit')}</button>}
        {can.withdraw && <button type="button" className="btn" disabled={busy} onClick={() => why('withdraw', t('act.withdrawn'))} data-testid="gl-withdraw">{t('act.withdraw')}</button>}
        {can.cancel && <button type="button" className="btn" disabled={busy} onClick={() => why('cancel', t('act.cancelled'))} data-testid="gl-cancel">{t('act.cancel')}</button>}
        {can.delete && <button type="button" className="btn" disabled={busy} onClick={() => { if (globalThis.confirm(t('jn.confirmDelete'))) run(async () => { await gl.remove(x.id); navigateTo('/finance/journals'); }, t('jn.deleted')); }} data-testid="gl-delete">{t('jn.delete')}</button>}
        {can.reverse && <button type="button" className="btn" disabled={busy} onClick={reverse} data-testid="gl-reverse">{t('jn.reverse')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => gl.file(`/journals/${x.id}/print`, `${x.docNo.replaceAll('/', '-')}.pdf`).catch(() => globalThis.alert?.(t('act.exportFailed')))} data-testid="gl-print">{t('act.print')}</button>}
      </div>
      {x.approve && x.taskId && (
        <div className="mdm-panel no-print" data-testid="gl-decide"><h2>{t('act.decision')}</h2>
          <label>{t('act.comment')}<textarea value={comment} onChange={(ev) => setComment(ev.target.value)} rows={2} style={{ width: '100%', fontSize: '1rem' }} data-testid="gl-comment" /></label>
          <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => decide('approve')} data-testid="gl-approve">{t('act.approve')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => decide('return')} data-testid="gl-return">{t('act.return')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => decide('reject')} data-testid="gl-reject">{t('act.reject')}</button></div>
        </div>
      )}
      {hq.data && (
        <div className="table-scroll" data-testid="gl-history"><table className="data-table"><caption>{t('act.history')}</caption><thead><tr><th scope="col">{t('act.when')}</th><th scope="col">{t('act.who')}</th><th scope="col">{t('act.event')}</th><th scope="col">{t('act.comment')}</th></tr></thead>
          <tbody>{[...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, c: a.comment })), ...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, c: a.reason }))].sort((a, b) => String(a.at).localeCompare(String(b.at))).map((h, i) => <tr key={i}><td>{String(h.at).slice(0, 16).replace('T', ' ')}</td><td>{h.who}</td><td>{h.what}</td><td>{h.c ?? ''}</td></tr>)}</tbody></table></div>
      )}
    </>
  );
}

function Journal({ id }) {
  const t = useT('fin'); const q = useQuery({ queryKey: ['gl', 'journal', id], queryFn: () => gl.journal(id), retry: false }); usePageTitle(t('jn.title'));
  if (q.error?.status === 403 || q.error?.status === 404) return <NoPermission what={t('jn.title')} permission="fin.journal.view" />;
  if (q.isPending) return <Skeleton label={t('jn.title')} rows={5} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const x = q.data; const row = (k, v) => <tr><th scope="row">{t(k)}</th><td>{v}</td></tr>;
  return (
    <div data-testid="gl-journal" data-status={x.status}>
      <PageHeader id="jn-h" title={<>{x.docNo} <JStatus x={x} /></>} subtitle={x.narration} meta={<><Link to="/finance/journals">{t('jn.title')}</Link> · {t(`vt.${x.voucherType}`)} · {x.voucherDate}{x.period ? ` · ${x.period}` : ''}</>} />
      <KpiRow label={t('jn.total')}><KpiTile label={t('jn.total')} value={money(x.total)} amount={x.total} kind="money" valueTestid="gl-total" /><KpiTile label={t('jn.lines')} value={String(x.lines.length)} /></KpiRow>
      <div className="table-scroll" data-testid="gl-facts"><table className="data-table"><tbody>
        {row('jn.type', t(`vt.${x.voucherType}`))}{row('jn.kind', t(`kind.${x.kind}`))}{x.voucherNo && row('jn.voucher', x.voucherNo)}{row('jn.draftNo', x.draftNo)}{row('jn.madeBy', x.requestedBy ?? '')}
        {x.postedAt && row('jn.postedAt', `${String(x.postedAt).slice(0, 16).replace('T', ' ')} ${t('jn.by', { who: x.postedBy })}`)}
        {x.autoReverseOn && row('jn.autoReverse', x.autoReverseOn)}
        {x.source && row('jn.source', x.source.route ? <Link to={x.source.route}>{x.source.label} {x.source.id}</Link> : `${x.source.label} ${x.source.id}`)}
        {x.reversalOf && row('jn.reversalOf', <Link to={`/finance/journals?id=${x.reversalOf.id}`}>{x.reversalOf.docNo}</Link>)}
        {x.reversedBy && row('jn.reversedBy', <Link to={`/finance/journals?id=${x.reversedBy.id}`}>{x.reversedBy.docNo}</Link>)}
        {x.pendingReversal && row('jn.pendingReversal', <Link to={`/finance/journals?id=${x.pendingReversal.id}`}>{x.pendingReversal.docNo}</Link>)}
      </tbody></table></div>
      <Lines x={x} />
      <Actions x={x} />
    </div>
  );
}

export default function JournalsPage() {
  const t = useT('fin'); usePageTitle(t('jn.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="jn-h"><Journal id={id} /></section>;
  return (
    <section aria-labelledby="jns-h" data-testid="gl-journals">
      <PageHeader id="jns-h" title={t('jn.title')} subtitle={t('jn.intro')} />
      <ListReport listCode="fin.journals" endpoint="/fin/journals" title={t('jn.title')} session={session.data} rowHref={(r) => `/finance/journals?id=${r.id}`} onOpen={(r) => navigateTo(`/finance/journals?id=${r.id}`)}
        cardFields={['docNo', 'voucherDate', 'narration', 'total', 'status']} statusKey="status" dateKey="voucherDate"
        newAction={{ label: t('jn.new'), permission: 'fin.journal.create', onClick: () => navigateTo('/finance/journal-entry') }}
        empty={{ title: t('jn.emptyTitle'), text: t('jn.emptyBody') }} />
    </section>
  );
}
