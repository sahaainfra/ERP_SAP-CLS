import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { SCORE_KEYS, inr, tdr } from './api.js';
import { TimelinePanel, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Bid / No-Bid Evaluation (business development, part 08.02, FR-03): the tender is scored from 1 to 5 on strategic fit, margin, risk, capacity and competition; the weights make a score out of 100 and a recommendation; a decision against it needs reasons.
// A colleague of the estimation team and then the director approve; the approved decision puts the tender in preparation (bid) or stops it (no bid).
const TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
const blank = () => ({ scores: Object.fromEntries(SCORE_KEYS.map((k) => [k, { score: '', note: '' }])), decision: 'BID', reasons: '' });
const fromDecision = (d) => ({ scores: Object.fromEntries(SCORE_KEYS.map((k) => [k, { score: String(d.scores?.[k]?.score ?? ''), note: d.scores?.[k]?.note ?? '' }])), decision: d.decision, reasons: d.reasons ?? '' });
const payload = (v) => ({ scores: Object.fromEntries(SCORE_KEYS.filter((k) => v.scores[k].score !== '').map((k) => [k, { score: Number(v.scores[k].score), note: v.scores[k].note.trim() || null }])), decision: v.decision, reasons: v.reasons.trim() || null });

export default function BidDecisionPage() {
  const t = useT('bd');
  const qc = useQueryClient();
  const params = useSearch();
  const id = Number(params.get('id')) || null; const tenderId = Number(params.get('tenderId')) || null;
  const dq = useQuery({ queryKey: ['bd', 'decision', id], queryFn: () => tdr.decision(id), enabled: Boolean(id), retry: false });
  const d = dq.data;
  const tq = useQuery({ queryKey: ['bd', 'tender', d?.tenderId ?? tenderId], queryFn: () => tdr.tender(d?.tenderId ?? tenderId), enabled: Boolean(d?.tenderId ?? tenderId), retry: false });
  const tender = tq.data;
  usePageTitle(d ? d.docNo : t('bid.title'));
  const [v, setV] = useState(blank); const [mode, setMode] = useState(id ? 'view' : 'form'); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [reason, setReason] = useState('');
  useEffect(() => { if (d && mode === 'view') setV(fromDecision(d)); }, [d, mode]);
  if (!id && !tenderId) return <ErrorState error={new Error(t('bid.noTender'))} />;
  if (id && dq.error?.status === 403) return <NoPermission what={t('bid.title')} permission="bd.bid_decision.view" />;
  if ((id && dq.isPending) || tq.isPending) return <Skeleton label={t('bid.title')} rows={5} />;
  if (dq.isError) return <ErrorState error={dq.error} onRetry={dq.refetch} />;
  if (tq.isError) return <ErrorState error={tq.error} onRetry={tq.refetch} />;
  const weights = d?.weights ?? tender.scoring.weights; const threshold = d?.threshold ?? tender.scoring.threshold;
  const rated = SCORE_KEYS.every((k) => v.scores[k].score !== '');
  const total = rated ? Math.round(SCORE_KEYS.reduce((a, k) => a + (weights[k] * Number(v.scores[k].score)) / 5, 0)) : null;
  const recommendation = total == null ? null : total >= threshold ? 'BID' : 'NO_BID';
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['bd'] }); return r ?? true; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const r = window.prompt(t('act.why')); if (r) run(() => fn(r), done); };
  const editing = mode !== 'view'; const ro = !editing;
  const save = async (submit) => {
    if (!id) { const r = await run(() => tdr.createDecision({ tenderId, ...payload(v), submit })); if (r?.id) navigateTo(`/bd/bid-decision?id=${r.id}`, { force: true }); return; }
    if (mode === 'amend') { const r = await run(() => tdr.decisionAct(id, 'amend', { ...payload(v), reason, version: d.rowVersion }), t('bid.amended')); if (r) setMode('view'); return; }
    const r = await run(() => tdr.updateDecision(id, { ...payload(v), version: d.rowVersion }), t('act.saved')); if (r) { setMode('view'); if (submit) await run(() => tdr.decisionAct(id, 'submit', {}), t('bid.sent')); }
  };
  const errBox = error?.form && <p className="field-error" role="alert" data-testid="bid-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>;
  return (
    <section aria-labelledby="bid-title-h" data-testid="bid-decision" data-status={d?.status ?? 'NEW'}>
      <header>
        <PageHeader id="bid-title-h" title={<>{d ? d.docNo : t('bid.new')} {d && <StatusBadge status={TONE[d.status]} label={d.statusLabel} />}</>} subtitle={<><Link to={`/bd/tender?id=${tender.id}`}>{tender.docNo}</Link> · {tender.nameOfWork} · {tender.clientName}</>} />
        <dl className="op-figures"><div><dt>{t('td.estCost')}</dt><dd>{inr(tender.estCost)}</dd></div><div><dt>{t('td.bidCapacity')}</dt><dd className={tender.bidCapacity != null && tender.bidCapacity < tender.estCost ? 'field-error' : ''}>{inr(tender.bidCapacity)}</dd></div><div><dt>{t('bid.score')}</dt><dd data-testid="bid-total">{total == null ? '—' : `${total}/100`}</dd></div><div><dt>{t('bid.recommended')}</dt><dd data-testid="bid-recommendation">{recommendation ? t(`decision.${recommendation}`) : '—'}</dd></div><div><dt>{t('bid.line')}</dt><dd>{threshold}</dd></div></dl>
        {errBox}{note && <p className="mdm-banner" role="status" data-testid="bid-note">{note}</p>}
        {d && (
          <div className="actions-row no-print" data-testid="bid-actions">
            {d.can.edit && !editing && <button type="button" className="btn" onClick={() => setMode('form')} data-testid="bid-edit">{t('act.edit')}</button>}
            {d.can.submit && !editing && <button type="button" className="btn btn-primary" onClick={() => run(() => tdr.decisionAct(id, 'submit', {}), t('bid.sent'))} data-testid="bid-submit">{t('bid.send')}</button>}
            {d.can.withdraw && <button type="button" className="btn" onClick={() => why((r) => tdr.decisionAct(id, 'withdraw', { reason: r }), t('act.withdrawn'))} data-testid="bid-withdraw">{t('act.withdraw')}</button>}
            {d.can.amend && !editing && <button type="button" className="btn" onClick={() => setMode('amend')} data-testid="bid-amend">{t('act.amend')}</button>}
            {d.can.cancel && <button type="button" className="btn" onClick={() => why((r) => tdr.decisionAct(id, 'cancel', { reason: r }), t('act.cancelled'))} data-testid="bid-cancel">{t('act.cancel')}</button>}
            {d.can.print && <a className="btn" href={`/api/v1/bd/bid-decisions/${id}/print`} target="_blank" rel="noreferrer">{t('act.print')}</a>}
          </div>)}
      </header>
      <form className="mdm-panel mdm-fields" onSubmit={(e) => { e.preventDefault(); save(false); }} data-testid="bid-form" aria-label={t('bid.title')}>
        {SCORE_KEYS.map((k) => (
          <fieldset key={k} className="mdm-fields" data-testid="bid-criterion" data-key={k}><legend>{t(`score.${k}`)} <span className="muted small">({weights[k]}%)</span></legend>
            <Field label={t('bid.scoreLabel', { what: t(`score.${k}`) })} name={`scores.${k}`} error={error}><select value={v.scores[k].score} disabled={ro} onChange={(e) => setV({ ...v, scores: { ...v.scores, [k]: { ...v.scores[k], score: e.target.value } } })} data-testid={`bid-${k}`}><option value="">–</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} — {t(`scale.${n}`)}</option>)}</select></Field>
            <Field label={t('bid.noteLabel', { what: t(`score.${k}`) })} name={`${k}Note`} error={error}><input value={v.scores[k].note} readOnly={ro} maxLength={300} onChange={(e) => setV({ ...v, scores: { ...v.scores, [k]: { ...v.scores[k], note: e.target.value } } })} /></Field>
          </fieldset>))}
        <Field label={t('bid.decision')} name="decision" error={error}><select value={v.decision} disabled={ro} onChange={(e) => setV({ ...v, decision: e.target.value })} data-testid="bid-decision-select"><option value="BID">{t('decision.BID')}</option><option value="NO_BID">{t('decision.NO_BID')}</option></select></Field>
        {recommendation && recommendation !== v.decision && <p className="muted" role="status" data-testid="bid-against">{t('bid.against', { rec: t(`decision.${recommendation}`) })}</p>}
        <Field label={t('bid.reasons')} name="reasons" error={error}><textarea rows="3" value={v.reasons} readOnly={ro} onChange={(e) => setV({ ...v, reasons: e.target.value })} data-testid="bid-reasons" /></Field>
        {mode === 'amend' && <Field label={t('act.amendReason')} name="reason" error={error}><textarea rows="2" value={reason} onChange={(e) => setReason(e.target.value)} required data-testid="bid-amend-reason" /></Field>}
        {editing && <div className="actions"><button type="button" className="btn" onClick={() => (id ? (setMode('view'), setV(fromDecision(d))) : navigateTo(`/bd/tender?id=${tenderId}`))}>{t('act.close')}</button><button type="submit" className="btn" data-testid="bid-save">{mode === 'amend' ? t('act.saveAmend') : t('act.saveDraft')}</button>{mode !== 'amend' && <button type="button" className="btn btn-primary" onClick={() => save(true)} data-testid="bid-save-send">{t('bid.saveSend')}</button>}</div>}
      </form>
      {d && d.eligibility && <p className="muted" data-testid="bid-eligibility">{t('el.summary', { passed: d.eligibility.passed, waived: d.eligibility.waived, failed: d.eligibility.failed, pending: d.eligibility.pending })}</p>}
      {d && <TimelinePanel kind={`bid-${id}-${d.rowVersion}`} load={() => tdr.decisionHistory(id)} />}
      {d && d.amendments.length > 0 && <div data-testid="amendments"><h2>{t('lead.amendments')}</h2>{d.amendments.map((a) => <p key={a.no}>#{a.no} · {a.by} · {a.reason} — {t('bid.before', { decision: t(`decision.${a.before.decision}`), score: a.before.totalScore })}</p>)}</div>}
      <p className="small"><Link to="/bd/bid-decisions">{t('bids.title')}</Link></p>
    </section>
  );
}
