import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { aw, inr, tdr } from './api.js';
import { TimelinePanel } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Bid Submission (business development, part 08.03, FR-01, FR-03, BR-01): the checklist of the bid (technical and financial envelopes, signed documents, the digital signature, the proof of the EMD, the prequalification documents), the credentials package,
// the price of the approved estimate and the final bid. A bid that differs from the estimate says why and the director approves it; once approved and ready, the submission on the portal is recorded with its acknowledgement.
// Estimation (part 09.03) is not built yet: the estimate is entered by hand and marked so.
const TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
const num = (v) => (v === '' || v == null ? null : Number(v));
export default function SubmissionPage() {
  const t = useT('bd');
  const qc = useQueryClient();
  const session = useSession();
  const tenderId = Number(new URLSearchParams(window.location.search).get('tenderId')) || null;
  const q = useQuery({ queryKey: ['bd', 'submission', tenderId], queryFn: () => aw.submission(tenderId), enabled: Boolean(tenderId), retry: false });
  const tq = useQuery({ queryKey: ['bd', 'tender', tenderId], queryFn: () => tdr.tender(tenderId), enabled: Boolean(tenderId), retry: false });
  const s = q.data;
  usePageTitle(s ? s.docNo : t('sub.title'));
  const [v, setV] = useState({ estimate: '', estimateRef: '', bidAmount: '', adjustmentReason: '' });
  const [rec, setRec] = useState({ submittedAt: '', portalRef: '' }); const [link, setLink] = useState('');
  const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const lib = useQuery({ queryKey: ['bd', 'credentials-all'], queryFn: () => aw.credentials({ pageSize: 200 }), enabled: Boolean(s?.can.edit), retry: false });
  useEffect(() => { if (s) setV({ estimate: s.estimate ?? '', estimateRef: s.estimateRef ?? '', bidAmount: s.bidAmount ?? '', adjustmentReason: s.adjustmentReason ?? '' }); }, [s?.id, s?.rowVersion]);
  if (!tenderId) return <ErrorState error={new Error(t('bid.noTender'))} />;
  if (q.error?.status === 403) return <NoPermission what={t('sub.title')} permission="bd.submission.view" />;
  if (q.isPending || tq.isPending) return <Skeleton label={t('sub.title')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (tq.isError) return <ErrorState error={tq.error} onRetry={tq.refetch} />;
  const tn = tq.data;
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['bd'] }); return r ?? true; } catch (x) { setError(errorInfo(x)); return null; } };
  const why = (fn, done) => { const r = window.prompt(t('act.why')); if (r) run(() => fn(r), done); };
  const errBox = error?.form && <p className="field-error" role="alert" data-testid="sub-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>;
  const head = <p className="muted"><Link to={`/bd/tender?id=${tn.id}`}>{tn.docNo}</Link> · {tn.nameOfWork}{tn.submissionAt ? ` · ${t('sub.deadline', { at: tn.submissionAt.replace('T', ' ') })}` : ''}</p>;
  if (!s) {
    return (
      <section aria-labelledby="sub-title" data-testid="submission-new">
        <PageHeader id="sub-title" title={t('sub.title')} />{head}{errBox}
        <p>{t('sub.none')}</p>
        {(session.data?.permissions ?? []).includes('bd.submission.manage') && ['BID', 'READY'].includes(tn.stage) && <button type="button" className="btn btn-primary" onClick={() => run(() => aw.createSubmission({ tenderId }), t('sub.started'))} data-testid="sub-start">{t('sub.start')}</button>}
      </section>
    );
  }
  const items = s.items; const diff = num(v.bidAmount) != null && num(v.estimate) != null ? num(v.bidAmount) - num(v.estimate) : null;
  const toggle = (code, done) => run(() => aw.updateSubmission(s.id, { items: items.map((i) => ({ code: i.code, done: i.code === code ? done : i.done, note: i.note ?? null })), version: s.rowVersion }));
  const saveFigures = (e) => { e.preventDefault(); run(() => aw.updateSubmission(s.id, { estimate: num(v.estimate), estimateRef: v.estimateRef.trim() || null, bidAmount: num(v.bidAmount), adjustmentReason: v.adjustmentReason.trim() || null, version: s.rowVersion }), t('act.saved')); };
  const linked = new Set(s.package.map((c) => c.id));
  return (
    <section aria-labelledby="sub-title" data-testid="submission" data-status={s.status}>
      <header>
        <PageHeader id="sub-title" title={<>{t('sub.title')} {s.docNo} <StatusBadge status={TONE[s.status]} label={s.statusLabel} /></>} />
        {head}
        <dl className="op-figures" data-testid="sub-figures">
          <div><dt>{t('sub.checklist')}</dt><dd data-testid="sub-progress">{s.done}/{items.length}</dd></div>
          <div><dt>{t('sub.estimate')}</dt><dd>{inr(s.estimate)}{s.estimateSource === 'MANUAL' ? <span className="muted small"> · {t('sub.manual')}</span> : null}</dd></div>
          <div><dt>{t('sub.bid')}</dt><dd data-testid="sub-bid">{inr(s.bidAmount)}</dd></div>
          {s.adjustment ? <div><dt>{t('sub.adjustment')}</dt><dd className="field-error" data-testid="sub-adjustment">{inr(s.adjustment)} ({s.adjustmentPct}%)</dd></div> : null}
          {s.submittedAt && <div><dt>{t('sub.submittedAt')}</dt><dd data-testid="sub-submitted">{s.submittedAt.replace('T', ' ')} · {s.portalRef}</dd></div>}
        </dl>
        {errBox}{note && <p className="mdm-banner" role="status" data-testid="sub-note">{note}</p>}
        <div className="actions-row no-print">
          {s.can.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => aw.submissionAct(s.id, 'submit'), t('sub.sent'))} data-testid="sub-submit">{t('sub.send')}</button>}
          {s.can.withdraw && <button type="button" className="btn" onClick={() => why((r) => aw.submissionAct(s.id, 'withdraw', { reason: r }), t('act.withdrawn'))}>{t('act.withdraw')}</button>}
          {s.can.amend && <button type="button" className="btn" onClick={() => why((r) => aw.submissionAct(s.id, 'amend', { reason: r, version: s.rowVersion }), t('emd.amended'))}>{t('act.amend')}</button>}
          {tn.stage === 'SUBMITTED' && <button type="button" className="btn" onClick={() => navigateTo(`/bd/bid-results?tenderId=${tn.id}`)} data-testid="sub-results">{t('res.title')}</button>}
        </div>
      </header>
      <div className="mdm-panel" data-testid="sub-security">
        <h2>{t('sub.security')}</h2>
        {s.security.length === 0 ? <p className="muted">{t('sub.noSecurity')}</p> : <ul className="mdm-list">{s.security.map((x) => <li key={x.kind} className={x.ok ? '' : 'field-error'} data-testid={`sub-sec-${x.kind}`}>{x.ok ? '✓' : '✗'} {x.text}{!x.ok && <> · <Link to={`/bd/emd/record?tenderId=${tn.id}&kind=${x.kind}`}>{t('sub.request')}</Link></>}</li>)}</ul>}
      </div>
      <fieldset className="mdm-panel" data-testid="sub-checklist" disabled={!s.can.edit}>
        <legend>{t('sub.checklist')}</legend>
        {items.map((i) => <label key={i.code} className="check"><input type="checkbox" checked={i.done} onChange={(e) => toggle(i.code, e.target.checked)} data-testid={`sub-item-${i.code}`} /> {t(`subitem.${i.code}`, { defaultValue: i.label })}{i.by ? <span className="muted small"> · {i.by}</span> : null}</label>)}
      </fieldset>
      <form className="mdm-panel mdm-fields" onSubmit={saveFigures} data-testid="sub-price" aria-label={t('sub.price')}>
        <h2>{t('sub.price')}</h2>
        <p className="small muted">{t('sub.estimateNote')}</p>
        <fieldset disabled={!s.can.edit} className="mdm-fields">
          <Field label={t('sub.estimate')} name="estimate" error={error}><input type="number" min="0" step="0.01" value={v.estimate} onChange={(e) => setV({ ...v, estimate: e.target.value })} data-testid="sub-estimate" /></Field>
          <Field label={t('sub.estimateRef')} name="estimateRef" error={error}><input value={v.estimateRef} onChange={(e) => setV({ ...v, estimateRef: e.target.value })} data-testid="sub-estimate-ref" /></Field>
          <Field label={t('sub.bid')} name="bidAmount" error={error}><input type="number" min="0" step="0.01" value={v.bidAmount} onChange={(e) => setV({ ...v, bidAmount: e.target.value })} data-testid="sub-bid-amount" /></Field>
          {diff ? <Field label={t('sub.adjustmentReason')} name="adjustmentReason" error={error} hint={t('sub.adjustmentHint', { amount: inr(diff) })}><textarea value={v.adjustmentReason} onChange={(e) => setV({ ...v, adjustmentReason: e.target.value })} rows={2} data-testid="sub-adjustment-reason" /></Field> : null}
          <div className="actions"><button type="submit" className="btn" data-testid="sub-save">{t('act.save')}</button></div>
        </fieldset>
      </form>
      <div className="mdm-panel" data-testid="sub-package">
        <h2>{t('sub.package')}</h2>
        {s.package.length === 0 ? <p className="muted">{t('sub.noPackage')}</p> : <ul className="mdm-list">{s.package.map((c) => <li key={c.linkId}>{c.docNo} · {c.title} <span className="muted small">{c.typeLabel}{c.expired ? ` · ${t('cr.expired')}` : ''}</span>{s.can.edit && <button type="button" className="btn btn-small" onClick={() => run(() => aw.unlinkCredential(c.linkId))} aria-label={t('sub.unlink', { name: c.title })}>✕</button>}</li>)}</ul>}
        {s.can.edit && lib.data && (
          <form className="actions" onSubmit={(e) => { e.preventDefault(); if (link) run(() => aw.linkCredential(tn.id, { credentialId: Number(link) }), t('sub.linked')).then(() => setLink('')); }}>
            <select value={link} onChange={(e) => setLink(e.target.value)} aria-label={t('sub.addCredential')} data-testid="sub-cred">{[<option key="" value="">{t('sub.addCredential')}</option>, ...(lib.data.data ?? []).filter((c) => !linked.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.docNo} · {c.title}</option>)]}</select>
            <button type="submit" className="btn" data-testid="sub-link">{t('sub.link')}</button> <Link to="/bd/credentials">{t('cr.title')}</Link>
          </form>)}
      </div>
      {s.can.record && (
        <form className="mdm-panel mdm-fields" onSubmit={(e) => { e.preventDefault(); run(() => aw.submissionAct(s.id, 'record', { submittedAt: rec.submittedAt, portalRef: rec.portalRef.trim() }), t('sub.recorded')); }} data-testid="sub-record" aria-label={t('sub.recordTitle')}>
          <h2>{t('sub.recordTitle')}</h2>
          <Field label={t('sub.submittedAt')} name="submittedAt" error={error}><input type="datetime-local" value={rec.submittedAt} max={tn.submissionAt?.slice(0, 16)} onChange={(e) => setRec({ ...rec, submittedAt: e.target.value })} required data-testid="sub-at" /></Field>
          <Field label={t('sub.portalRef')} name="portalRef" error={error}><input value={rec.portalRef} onChange={(e) => setRec({ ...rec, portalRef: e.target.value })} required data-testid="sub-ref" /></Field>
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="sub-record-save">{t('sub.recordTitle')}</button></div>
        </form>)}
      <h2>{t('sub.files')}</h2>
      <AttachmentList entity="tdr_submission" entityId={s.id} canEdit={s.can.edit} />
      {s.can.edit && <FileUploader entity="tdr_submission" entityId={s.id} />}
      <TimelinePanel kind={`sub-${s.id}-${s.rowVersion}`} load={async () => s.history} />
    </section>
  );
}
