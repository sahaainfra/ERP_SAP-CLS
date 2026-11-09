import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { EMD_MODES, aw, dayIST, inr, tdr } from './api.js';
import { TimelinePanel, useSearch } from './parts.jsx';

// EMD / Fee (business development, part 08.03, FR-02, BR-02): the EMD or tender fee of a tender is asked of finance (mode, amount, payee, the day it is needed); estimation, the accounts manager and the CFO approve; accounts records the instrument (number, bank, validity) and,
// after the result, follows the refund (asked for, received, forfeited or adjusted into the security of the contract). The amount is the tender's unless the tender exempts it, with the reason.
const TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
const RTONE = { NOT_APPLICABLE: 'CANCELLED', NOT_DUE: 'DRAFT', DUE: 'AT_RISK', REQUESTED: 'IN_REVIEW', REFUNDED: 'COMPLETED', FORFEITED: 'REJECTED', ADJUSTED: 'COMPLETED' };
export default function EmdPage() {
  const t = useT('bd');
  const qc = useQueryClient();
  const params = useSearch();
  const id = Number(params.get('id')) || null; const tenderId = Number(params.get('tenderId')) || null; const kind = params.get('kind') === 'FEE' ? 'FEE' : 'EMD';
  const q = useQuery({ queryKey: ['bd', 'emd', id], queryFn: () => aw.emd(id), enabled: Boolean(id), retry: false });
  const tq = useQuery({ queryKey: ['bd', 'tender', tenderId], queryFn: () => tdr.tender(tenderId), enabled: !id && Boolean(tenderId), retry: false });
  const e = q.data;
  usePageTitle(e ? e.docNo : t(kind === 'FEE' ? 'emd.newFee' : 'emd.newEmd'));
  const [v, setV] = useState({ mode: kind === 'FEE' ? 'ONLINE' : 'BG', payee: '', neededBy: '', exemptionReason: '' });
  const [iss, setIss] = useState({ instrumentNo: '', bank: '', issueDate: dayIST(0), validUntil: '' }); const [rf, setRf] = useState(null);
  const [error, setError] = useState(null); const [note, setNote] = useState(null);
  if (!id && !tenderId) return <ErrorState error={new Error(t('bid.noTender'))} />;
  if (id && q.error?.status === 403) return <NoPermission what={t('emd.register')} permission="bd.emd.view" />;
  if ((id && q.isPending) || (!id && tq.isPending)) return <Skeleton label={t('emd.register')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (tq.isError) return <ErrorState error={tq.error} onRetry={tq.refetch} />;
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['bd'] }); return r ?? true; } catch (x) { setError(errorInfo(x)); return null; } };
  const why = (fn, done) => { const r = window.prompt(t('act.why')); if (r) run(() => fn(r), done); };
  const errBox = error?.form && <p className="field-error" role="alert" data-testid="emd-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>;
  if (!id) {
    const tn = tq.data; const amount = kind === 'EMD' ? tn.emd : tn.tenderFee;
    const create = async (submit) => { const r = await run(() => aw.createEmd({ tenderId, kind, mode: v.mode, payee: v.payee.trim() || null, neededBy: v.neededBy || null, ...(v.mode === 'EXEMPT' ? { amount: 0, exemptionReason: v.exemptionReason.trim() } : {}), submit })); if (r?.id) navigateTo(`/bd/emd/record?id=${r.id}`, { force: true }); };
    return (
      <section aria-labelledby="emd-title" data-testid="emd-new">
        <h1 id="emd-title">{t(kind === 'FEE' ? 'emd.newFee' : 'emd.newEmd')}</h1>
        <p className="muted"><Link to={`/bd/tender?id=${tn.id}`}>{tn.docNo}</Link> · {tn.nameOfWork} · {t('emd.asked', { amount: inr(amount) })}</p>
        {errBox}
        <form className="mdm-panel mdm-fields" onSubmit={(x) => { x.preventDefault(); create(true); }} data-testid="emd-form" aria-label={t('emd.newEmd')}>
          <Field label={t('emd.mode')} name="mode" error={error}><select value={v.mode} onChange={(x) => setV({ ...v, mode: x.target.value })} data-testid="emd-mode">{EMD_MODES.filter((m) => kind === 'EMD' || m !== 'BG').map((m) => <option key={m} value={m}>{t(`emdmode.${m}`)}</option>)}</select></Field>
          <Field label={t('emd.amount')} name="amount" error={error}><input value={v.mode === 'EXEMPT' ? '0' : String(amount)} readOnly data-testid="emd-amount" /></Field>
          {v.mode === 'EXEMPT' && <Field label={t('emd.exemption')} name="exemptionReason" error={error}><input value={v.exemptionReason} onChange={(x) => setV({ ...v, exemptionReason: x.target.value })} required data-testid="emd-exemption" /></Field>}
          <Field label={t('emd.payee')} name="payee" error={error}><input value={v.payee} onChange={(x) => setV({ ...v, payee: x.target.value })} data-testid="emd-payee" /></Field>
          <Field label={t('emd.neededBy')} name="neededBy" error={error}><input type="date" value={v.neededBy} max={tn.submissionAt?.slice(0, 10)} onChange={(x) => setV({ ...v, neededBy: x.target.value })} data-testid="emd-needed" /></Field>
          <div className="actions"><button type="button" className="btn" onClick={() => create(false)} data-testid="emd-save">{t('act.saveDraft')}</button><button type="submit" className="btn btn-primary" data-testid="emd-send">{t('emd.send')}</button></div>
        </form>
      </section>
    );
  }
  return (
    <section aria-labelledby="emd-title" data-testid="emd" data-status={e.status} data-refund={e.refundStatus}>
      <header>
        <h1 id="emd-title">{e.kind === 'EMD' ? t('emd.emd') : t('emd.fee')} {e.docNo} <StatusBadge status={TONE[e.status]} label={e.statusLabel} /> <StatusBadge status={RTONE[e.refundStatus]} label={t(`refund.${e.refundStatus}`)} /></h1>
        <p className="muted"><Link to={`/bd/tender?id=${e.tenderId}`}>{e.tenderNo}</Link> · {e.nameOfWork}</p>
        <dl className="op-figures" data-testid="emd-figures"><div><dt>{t('emd.amount')}</dt><dd>{inr(e.amount)}</dd></div><div><dt>{t('emd.mode')}</dt><dd>{t(`emdmode.${e.mode}`)}</dd></div><div><dt>{t('emd.instrument')}</dt><dd data-testid="emd-instrument">{e.instrumentNo ?? '—'}{e.bank ? ` · ${e.bank}` : ''}</dd></div><div><dt>{t('cr.validUntil')}</dt><dd className={e.expiring ? 'field-error' : ''}>{e.validUntil ?? '—'}</dd></div>{e.ageDays != null && <div><dt>{t('emd.age')}</dt><dd data-testid="emd-age">{t('emd.ageDays', { n: e.ageDays, b: e.ageBucket })}</dd></div>}</dl>
        {errBox}{note && <p className="mdm-banner" role="status" data-testid="emd-note">{note}</p>}
        <div className="actions-row no-print">
          {e.can.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => aw.emdAct(id, 'submit'), t('emd.sent'))} data-testid="emd-submit">{t('emd.send')}</button>}
          {e.can.withdraw && <button type="button" className="btn" onClick={() => why((r) => aw.emdAct(id, 'withdraw', { reason: r }), t('act.withdrawn'))}>{t('act.withdraw')}</button>}
          {e.can.cancel && <button type="button" className="btn" onClick={() => why((r) => aw.emdAct(id, 'cancel', { reason: r }), t('act.cancelled'))} data-testid="emd-cancel">{t('act.cancel')}</button>}
          {e.can.amend && <button type="button" className="btn" onClick={() => why((r) => aw.emdAct(id, 'amend', { reason: r, version: e.rowVersion }), t('emd.amended'))}>{t('act.amend')}</button>}
          {e.can.print && <a className="btn" href={`/api/v1/bd/emd/${id}/print`} target="_blank" rel="noreferrer">{t('act.print')}</a>}
        </div>
      </header>
      {e.can.issue && (
        <form className="mdm-panel mdm-fields" onSubmit={(x) => { x.preventDefault(); run(() => aw.emdAct(id, 'issue', { instrumentNo: iss.instrumentNo.trim(), bank: iss.bank.trim() || null, issueDate: iss.issueDate, ...(iss.validUntil ? { validUntil: iss.validUntil } : {}) }), t('emd.issued')); }} data-testid="emd-issue" aria-label={t('emd.record')}>
          <h2>{t('emd.record')}</h2>
          <Field label={e.mode === 'ONLINE' ? t('emd.utr') : t('emd.instrumentNo')} name="instrumentNo" error={error}><input value={iss.instrumentNo} onChange={(x) => setIss({ ...iss, instrumentNo: x.target.value })} required data-testid="emd-instrument-no" /></Field>
          <Field label={t('emd.bank')} name="bank" error={error}><input value={iss.bank} onChange={(x) => setIss({ ...iss, bank: x.target.value })} data-testid="emd-bank" /></Field>
          <Field label={t('emd.issueDate')} name="issueDate" error={error}><input type="date" value={iss.issueDate} max={dayIST(0)} onChange={(x) => setIss({ ...iss, issueDate: x.target.value })} /></Field>
          {e.mode === 'BG' && <Field label={t('cr.validUntil')} name="validUntil" error={error}><input type="date" value={iss.validUntil} onChange={(x) => setIss({ ...iss, validUntil: x.target.value })} required data-testid="emd-valid" /></Field>}
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="emd-issue-save">{t('act.save')}</button></div>
        </form>)}
      {e.can.refund && (
        <div className="mdm-panel" data-testid="emd-refund">
          <h2>{t('emd.refundTitle')}</h2>
          <div className="actions">{['REQUESTED', 'REFUNDED', 'FORFEITED', 'ADJUSTED'].filter((a) => a !== 'REQUESTED' || e.refundStatus === 'DUE').map((a) => <button key={a} type="button" className={`btn${a === 'REFUNDED' ? ' btn-primary' : ''}`} onClick={() => setRf({ action: a, reference: '', note: '', date: dayIST(0) })} data-testid={`emd-refund-${a}`}>{t(`refundact.${a}`)}</button>)}</div>
          {rf && (
            <form className="mdm-fields" onSubmit={async (x) => { x.preventDefault(); if (await run(() => aw.emdAct(id, 'refund', { action: rf.action, date: rf.date, reference: rf.reference.trim() || null, note: rf.note.trim() || null }), t('emd.refundSaved'))) setRf(null); }} data-testid="emd-refund-form" aria-label={t(`refundact.${rf.action}`)}>
              {rf.action === 'REFUNDED' && <Field label={t('emd.refundRef')} name="reference" error={error}><input value={rf.reference} onChange={(x) => setRf({ ...rf, reference: x.target.value })} required data-testid="emd-refund-ref" /></Field>}
              <Field label={t('comp.note')} name="note" error={error}><input value={rf.note} onChange={(x) => setRf({ ...rf, note: x.target.value })} /></Field>
              <Field label={t('int.date')} name="date" error={error}><input type="date" value={rf.date} max={dayIST(0)} onChange={(x) => setRf({ ...rf, date: x.target.value })} /></Field>
              <div className="actions"><button type="button" className="btn" onClick={() => setRf(null)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="emd-refund-save">{t('act.save')}</button></div>
            </form>)}
        </div>)}
      {e.refundedOn && <p data-testid="emd-refunded">{t(`refund.${e.refundStatus}`)}: {e.refundedOn}{e.refundRef ? ` · ${e.refundRef}` : ''}{e.refundNote ? ` · ${e.refundNote}` : ''}</p>}
      <h2>{t('emd.files')}</h2>
      <AttachmentList entity="tdr_emd" entityId={id} canEdit />
      <FileUploader entity="tdr_emd" entityId={id} />
      <TimelinePanel kind={`emd-${id}-${e.rowVersion}`} load={async () => e.history} />
      <p className="small"><Link to="/bd/emd">{t('emd.register')}</Link></p>
    </section>
  );
}
