import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { errorInfo, Field, Link, navigateTo, useOneAtATime, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { aw, dayIST, inr, tdr } from './api.js';
import { TimelinePanel, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Award / Loss (business development, part 08.03, FR-06, FR-07): the negotiation rounds with the client, then the outcome of a submitted tender. A win records the letter of acceptance and the contract value and the director accepts it;
// a loss records who won and why. Once approved the tender is closed as awarded or lost, the EMD refund falls due, the opportunity follows and the award is announced for the project set-up (part 10.02, not built yet).
const TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
const blank = { outcome: 'WON', loaNo: '', loaDate: '', awardedValue: '', awardedTo: '', lossReasonCode: '', lossReason: '' };
export default function AwardPage() {
  const t = useT('bd');
  const qc = useQueryClient();
  const once = useOneAtATime(); // one save at a time: a double click does not save twice
  const session = useSession();
  const perms = session.data?.permissions ?? [];
  const params = useSearch();
  const id = Number(params.get('id')) || null; const tenderParam = Number(params.get('tenderId')) || null;
  const q = useQuery({ queryKey: ['bd', 'award', id, tenderParam], queryFn: () => (id ? aw.award(id) : aw.tenderAward(tenderParam)), enabled: Boolean(id || tenderParam), retry: false });
  const a = q.data; const tenderId = a?.tenderId ?? tenderParam;
  const tq = useQuery({ queryKey: ['bd', 'tender', tenderId], queryFn: () => tdr.tender(tenderId), enabled: Boolean(tenderId) && !q.isPending, retry: false });
  const nq = useQuery({ queryKey: ['bd', 'negotiations', tenderId], queryFn: () => aw.negotiations(tenderId), enabled: Boolean(tenderId) && !a, retry: false });
  const rq = useQuery({ queryKey: ['bd', 'results', tenderId], queryFn: () => aw.results(tenderId), enabled: Boolean(tenderId) && !a, retry: false });
  usePageTitle(a ? a.docNo : t('aw.record'));
  const [v, setV] = useState(blank); const [neg, setNeg] = useState({ heldOn: dayIST(0), ourOffer: '', clientCounter: '', notes: '' });
  const [error, setError] = useState(null); const [note, setNote] = useState(null);
  useEffect(() => { if (a) setV({ outcome: a.outcome, loaNo: a.loaNo ?? '', loaDate: a.loaDate ?? '', awardedValue: a.awardedValue ?? '', awardedTo: a.awardedTo ?? '', lossReasonCode: a.lossReasonCode ?? '', lossReason: a.lossReason ?? '' }); }, [a?.id, a?.rowVersion]);
  if (!id && !tenderParam) return <ErrorState error={new Error(t('bid.noTender'))} />;
  if (q.error?.status === 403) return <NoPermission what={t('aw.record')} permission="bd.award.view" />;
  if (q.isPending || tq.isPending) return <Skeleton label={t('aw.record')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (tq.isError) return <ErrorState error={tq.error} onRetry={tq.refetch} />;
  const tn = tq.data; const negotiations = a ? a.negotiations : nq.data ?? []; const results = a ? a.results : rq.data?.rows ?? [];
  const run = once(async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['bd'] }); return r ?? true; } catch (x) { setError(errorInfo(x)); return null; } });
  const why = (fn, done) => { const r = window.prompt(t('act.why')); if (r) run(() => fn(r), done); };
  const body = () => ({ outcome: v.outcome, ...(v.outcome === 'WON' ? { loaNo: v.loaNo.trim() || null, loaDate: v.loaDate || null, awardedValue: v.awardedValue === '' ? null : Number(v.awardedValue) } : { awardedTo: v.awardedTo.trim() || null, lossReasonCode: v.lossReasonCode || null, lossReason: v.lossReason.trim() || null }) });
  const editable = a ? a.can.edit : perms.includes('bd.award.create') && tn.stage === 'SUBMITTED';
  const save = async (submit) => {
    if (a) { const r = await run(() => aw.updateAward(a.id, { ...body(), version: a.rowVersion }), t('act.saved')); if (r && submit) await run(() => aw.awardAct(a.id, 'submit'), t('aw.sent')); return; }
    const r = await run(() => aw.createAward({ tenderId, ...body(), submit }), submit ? t('aw.sent') : t('act.saved')); if (r?.id) navigateTo(`/bd/award?id=${r.id}`, { force: true });
  };
  const reasons = a?.lostReasons ?? rq.data?.lostReasons ?? [];
  const l1 = results.find((r) => r.rank === 1);
  return (
    <section aria-labelledby="aw-title" data-testid="award" data-status={a?.status ?? 'NEW'}>
      <header>
        <PageHeader id="aw-title" title={a ? <>{t(a.outcome === 'WON' ? 'aw.won' : 'aw.lost')} {a.docNo} <StatusBadge status={TONE[a.status]} label={a.statusLabel} /></> : t('aw.record')} subtitle={<><Link to={`/bd/tender?id=${tn.id}`}>{tn.docNo}</Link> · {tn.nameOfWork} · {t(`tstage.${tn.stage}`)}</>} />
        {error?.form && <p className="field-error" role="alert" data-testid="aw-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
        {note && <p className="mdm-banner" role="status" data-testid="aw-note">{note}</p>}
        {a && <div className="actions-row no-print">
          {a.can.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => aw.awardAct(a.id, 'submit'), t('aw.sent'))} data-testid="aw-submit">{t('aw.send')}</button>}
          {a.can.withdraw && <button type="button" className="btn" onClick={() => why((r) => aw.awardAct(a.id, 'withdraw', { reason: r }), t('act.withdrawn'))}>{t('act.withdraw')}</button>}
          {a.can.cancel && <button type="button" className="btn" onClick={() => why((r) => aw.awardAct(a.id, 'cancel', { reason: r }), t('act.cancelled'))}>{t('act.cancel')}</button>}
          {a.can.print && <a className="btn" href={`/api/v1/bd/awards/${a.id}/print`} target="_blank" rel="noreferrer">{t('act.print')}</a>}
        </div>}
      </header>
      {results.length > 0 && <p data-testid="aw-results">{t('aw.opening', { n: results.length })} {results.filter((r) => r.rank && r.rank <= 3).map((r) => `L${r.rank} ${r.bidder} ${inr(r.quoted)}`).join(' · ')}</p>}
      <div className="mdm-panel" data-testid="aw-negotiations">
        <h2>{t('aw.negotiations')}</h2>
        {negotiations.length === 0 ? <p className="muted">{t('aw.noNegotiations')}</p> : <ol className="mdm-list">{negotiations.map((n) => <li key={n.id}>{t('aw.round', { n: n.round })} · {n.heldOn} · {t('aw.ourOffer')} {inr(n.ourOffer)} · {t('aw.counter')} {inr(n.clientCounter)}<br />{n.notes}</li>)}</ol>}
        {tn.stage === 'SUBMITTED' && perms.includes('bd.award.create') && (
          <form className="mdm-fields" onSubmit={async (e) => { e.preventDefault(); if (await run(() => aw.addNegotiation(tenderId, { heldOn: neg.heldOn, ourOffer: neg.ourOffer === '' ? null : Number(neg.ourOffer), clientCounter: neg.clientCounter === '' ? null : Number(neg.clientCounter), notes: neg.notes.trim() }), t('aw.negSaved'))) setNeg({ ...neg, ourOffer: '', clientCounter: '', notes: '' }); }} data-testid="aw-neg-form" aria-label={t('aw.negotiations')}>
            <Field label={t('int.date')} name="heldOn" error={error}><input type="date" value={neg.heldOn} max={dayIST(0)} onChange={(e) => setNeg({ ...neg, heldOn: e.target.value })} /></Field>
            <Field label={t('aw.ourOffer')} name="ourOffer" error={error}><input type="number" min="0" step="0.01" value={neg.ourOffer} onChange={(e) => setNeg({ ...neg, ourOffer: e.target.value })} data-testid="aw-neg-offer" /></Field>
            <Field label={t('aw.counter')} name="clientCounter" error={error}><input type="number" min="0" step="0.01" value={neg.clientCounter} onChange={(e) => setNeg({ ...neg, clientCounter: e.target.value })} /></Field>
            <Field label={t('aw.negNotes')} name="notes" error={error}><textarea rows={2} value={neg.notes} onChange={(e) => setNeg({ ...neg, notes: e.target.value })} required data-testid="aw-neg-notes" /></Field>
            <div className="actions"><button type="submit" className="btn" data-testid="aw-neg-save">{t('aw.addRound')}</button></div>
          </form>)}
      </div>
      <form className="mdm-panel mdm-fields" onSubmit={(e) => { e.preventDefault(); save(true); }} data-testid="aw-form" aria-label={t('aw.outcome')}>
        <h2>{t('aw.outcome')}</h2>
        <fieldset disabled={!editable} className="mdm-fields">
          <div role="radiogroup" aria-label={t('aw.outcome')} className="actions">{['WON', 'LOST'].map((o) => <label key={o}><input type="radio" name="outcome" checked={v.outcome === o} onChange={() => setV({ ...v, outcome: o })} data-testid={`aw-outcome-${o}`} /> {t(o === 'WON' ? 'aw.won' : 'aw.lost')}</label>)}</div>
          {v.outcome === 'WON' ? (<>
            <Field label={t('aw.loaNo')} name="loaNo" error={error}><input value={v.loaNo} onChange={(e) => setV({ ...v, loaNo: e.target.value })} data-testid="aw-loa" /></Field>
            <Field label={t('aw.loaDate')} name="loaDate" error={error}><input type="date" value={v.loaDate} max={dayIST(0)} onChange={(e) => setV({ ...v, loaDate: e.target.value })} data-testid="aw-loa-date" /></Field>
            <Field label={t('aw.value')} name="awardedValue" error={error}><input type="number" min="0" step="0.01" value={v.awardedValue} onChange={(e) => setV({ ...v, awardedValue: e.target.value })} data-testid="aw-value" /></Field>
          </>) : (<>
            <Field label={t('aw.awardedTo')} name="awardedTo" error={error} hint={l1 && !l1.isUs ? t('aw.l1Hint', { name: l1.bidder }) : undefined}><input value={v.awardedTo} onChange={(e) => setV({ ...v, awardedTo: e.target.value })} data-testid="aw-to" /></Field>
            <Field label={t('aw.lossCode')} name="lossReasonCode" error={error}><select value={v.lossReasonCode} onChange={(e) => setV({ ...v, lossReasonCode: e.target.value })} data-testid="aw-loss-code"><option value="">–</option>{reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}</select></Field>
            <Field label={t('aw.lossReason')} name="lossReason" error={error}><textarea rows={2} value={v.lossReason} onChange={(e) => setV({ ...v, lossReason: e.target.value })} data-testid="aw-loss-reason" /></Field>
          </>)}
          {editable && <div className="actions"><button type="button" className="btn" onClick={() => save(false)} data-testid="aw-save">{t('act.saveDraft')}</button><button type="submit" className="btn btn-primary" data-testid="aw-send">{t('aw.send')}</button></div>}
        </fieldset>
      </form>
      {a && <>
        <h2>{t('aw.files')}</h2>
        <AttachmentList entity="tdr_award" entityId={a.id} canEdit={a.can.edit} />
        {a.can.edit && <FileUploader entity="tdr_award" entityId={a.id} />}
        <TimelinePanel kind={`aw-${a.id}-${a.rowVersion}`} load={async () => a.history} />
      </>}
      <p className="small"><Link to="/bd/awards">{t('aw.list')}</Link></p>
    </section>
  );
}
