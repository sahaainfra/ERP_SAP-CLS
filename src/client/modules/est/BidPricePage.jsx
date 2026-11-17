import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { bidPreview, est, fetchFile, inr, rv } from './api.js';
import { EstimatePicker, useSearch } from './parts.jsx';
import { SummaryTable } from './ReviewPage.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Bid Price Finalisation (part 09.03, FR-02, FR-05, BR-01, BR-02): the discount or rebate on the selling amount with its reason (the bid price follows at once; above the threshold the director approves it before the estimate
// is sent), the summary of the bid price, and the priced BOQ in the client's format: Excel, PDF or print, with the rates in figures and in words. A BOQ of an estimate not yet approved is marked as a draft, not for submission.
const DTONE = { NOT_REQUIRED: 'APPROVED', DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
export default function BidPricePage() {
  const t = useT('est');
  const qc = useQueryClient();
  const sp = useSearch(); const sid = Number(sp.get('summary')) || null;
  const sq = useQuery({ queryKey: ['est', 'of-summary', sid], queryFn: () => rv.ofSummary(sid), enabled: Boolean(sid), retry: false });
  const id = Number(sp.get('id')) || sq.data?.estimateId || null;
  const q = useQuery({ queryKey: ['est', 'review', id], queryFn: () => rv.panel(id), enabled: Boolean(id), retry: false });
  const lq = useQuery({ queryKey: ['est', 'all'], queryFn: () => est.list({ pageSize: 100 }), enabled: !id && !sid, retry: false });
  const x = q.data;
  usePageTitle(x ? `${t('bid.title')} ${x.estimate.ref}` : t('bid.title'));
  const [v, setV] = useState({ discountPct: '0', discountReason: '' }); const [words, setWords] = useState(true); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  useEffect(() => { if (x) setV({ discountPct: x.summary.discountPct, discountReason: x.summary.discountReason ?? '' }); }, [x?.summary.rowVersion, x?.estimate.id]);
  if (!id && !sid) return (<section aria-labelledby="bid-h" data-testid="bid-none"><PageHeader id="bid-h" title={t('bid.title')} subtitle={t('rev.choose')} />{lq.data && <EstimatePicker id="bid-pick" value={null} onChange={(n) => n && navigateTo(`/est/bid-price?id=${n}`)} rows={lq.data.data ?? []} label={t('imp.estimate')} />}</section>);
  if (q.error?.status === 403 || sq.error?.status === 403) return <NoPermission what={t('bid.title')} permission="est.review.view" />;
  if (sq.isError) return <ErrorState error={sq.error} onRetry={sq.refetch} />;
  if (!id || q.isPending) return <Skeleton label={t('bid.title')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['est'] }); return r ?? true; } catch (e) { setError(errorInfo(e)); return null; } };
  const s = x.summary; const e = x.estimate; const edit = x.can.editBid && s.discountStatus !== 'SUBMITTED';
  const p = bidPreview(s.selling, v.discountPct, s.gstPct); const over = Number(v.discountPct || 0) > Number(s.thresholdPct);
  const boq = (format) => run(() => fetchFile(`/est/estimates/${e.id}/priced-boq?format=${format}&words=${words}`, { open: format === 'html' }), format === 'html' ? null : t('bid.downloaded'));
  return (
    <section aria-labelledby="bid-h" data-testid="bid-price" data-status={s.discountStatus}>
      <header>
        <PageHeader id="bid-h" title={<>{t('bid.title')} {e.ref} <StatusBadge status={DTONE[s.discountStatus]} label={t(`dstatus.${s.discountStatus}`)} /></>} subtitle={<><Link to={`/est/review?id=${e.id}`}>{e.title}</Link> · {e.statusLabel}{e.status !== 'APPROVED' ? ` · ${t('bid.notForBid')}` : ''}</>} />
        {error?.form && <p className="field-error" role="alert" data-testid="bid-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
        {note && <p className="mdm-banner" role="status" data-testid="bid-note">{note}</p>}
      </header>
      <form className="mdm-panel mdm-fields" onSubmit={(ev) => { ev.preventDefault(); run(() => rv.discount(e.id, { discountPct: String(v.discountPct || '0'), discountReason: v.discountReason.trim() || null, version: s.rowVersion }), t('bid.saved')); }} aria-label={t('bid.discount')} data-testid="bid-form">
        <h2>{t('bid.discount')}</h2>
        <fieldset disabled={!edit} className="mdm-fields">
          <Field label={t('bid.discountPct')} name="discountPct" error={error} hint={t('bid.threshold', { pct: s.thresholdPct })}><input type="number" min="0" max="100" step="0.01" value={v.discountPct} onChange={(ev) => setV({ ...v, discountPct: ev.target.value })} required data-testid="bid-pct" /></Field>
          <Field label={t('bid.reason')} name="discountReason" error={error}><textarea rows={2} value={v.discountReason} onChange={(ev) => setV({ ...v, discountReason: ev.target.value })} data-testid="bid-reason" /></Field>
        </fieldset>
        <dl className="op-figures" data-testid="bid-live"><div><dt>{t('bid.discount')}</dt><dd>{inr(p.discount)}</dd></div><div><dt>{t('bid.net')}</dt><dd>{inr(p.net)}</dd></div><div><dt>{t('fig.gst', { pct: s.gstPct })}</dt><dd>{inr(p.gst)}</dd></div><div><dt>{t('bid.price')}</dt><dd data-testid="bid-live-price">{inr(p.bid)}</dd></div></dl>
        {over && <p className="small field-error" data-testid="bid-over">{t('bid.needsDirector', { pct: s.thresholdPct })}</p>}
        <div className="actions">
          {edit && <button type="submit" className="btn" data-testid="bid-save">{t('act.save')}</button>}
          {x.can.editBid && ['DRAFT', 'RETURNED'].includes(s.discountStatus) && <button type="button" className="btn btn-primary" onClick={() => run(() => rv.discountAct(e.id, 'submit'), t('bid.sentDirector'))} data-testid="bid-send">{t('bid.sendDirector')}</button>}
          {s.discountStatus === 'SUBMITTED' && x.can.editBid && <button type="button" className="btn" onClick={() => { const r = window.prompt(t('act.why')); if (r) run(() => rv.discountAct(e.id, 'withdraw', { reason: r }), t('obj.withdrawn')); }}>{t('act.withdraw')}</button>}
        </div>
      </form>
      <h2>{t('tab.summary')}</h2>
      <SummaryTable s={s} />
      <div className="mdm-panel" data-testid="bid-boq">
        <h2>{t('bid.boq')}</h2>
        <p className="small muted">{e.status === 'APPROVED' ? t('bid.boqApproved') : t('bid.boqDraft')}</p>
        <label><input type="checkbox" checked={words} onChange={(ev) => setWords(ev.target.checked)} data-testid="bid-words" /> {t('bid.words')}</label>
        {x.can.exportBoq ? (
          <div className="actions-row"><button type="button" className="btn btn-primary" onClick={() => boq('xlsx')} data-testid="bid-xlsx">{t('bid.excel')}</button> <button type="button" className="btn" onClick={() => boq('pdf')} data-testid="bid-pdf">{t('bid.pdf')}</button> <button type="button" className="btn" onClick={() => boq('html')} data-testid="bid-print">{t('bid.boqPrint')}</button></div>
        ) : <p className="muted">{t('bid.noExport')}</p>}
      </div>
      <p className="small"><Link to={`/est/estimate?id=${e.id}`}>{e.ref}</Link> · <Link to={`/est/review?id=${e.id}`}>{t('rev.title')}</Link></p>
    </section>
  );
}
