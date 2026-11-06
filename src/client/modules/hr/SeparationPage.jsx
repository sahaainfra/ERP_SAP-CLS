import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { ext } from './api.js';

// Separation (HR, part 07.13): one resignation or termination with its clearance tracker: the notice, the last working day, the clearance of each department (HR waives one that cannot be done, with the reason), the exit interview, the
// full-and-final inputs (leave encashment, notice recovery or pay, gratuity, claims to pay, recoveries) and what still blocks their release (BR-01), the relieving and experience letters, and the history.
const TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'ACTIVE', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', SETTLED: 'COMPLETED' };
const CTONE = { PENDING: 'IN_REVIEW', CLEARED: 'COMPLETED', WAIVED: 'AT_RISK', CANCELLED: 'CANCELLED' };
const inr = (n) => (n == null ? '—' : `₹ ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export default function SeparationPage() {
  const t = useT('sep');
  const qc = useQueryClient();
  const id = Number(new URLSearchParams(window.location.search).get('id')) || null;
  const q = useQuery({ queryKey: ['ext', 'sep', id], queryFn: () => ext.separation(id), enabled: Boolean(id), retry: false });
  const f = useQuery({ queryKey: ['ext', 'fnf', id], queryFn: () => ext.fnf(id), enabled: Boolean(id) && Boolean(q.data && ['APPROVED', 'SETTLED'].includes(q.data.status)), retry: false });
  const h = useQuery({ queryKey: ['ext', 'history', id], queryFn: () => ext.sepHistory(id), enabled: Boolean(id) && q.isSuccess, retry: false });
  const [iv, setIv] = useState({ rating: '', reasonCode: '', wouldRejoin: '', comments: '' });
  const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const s = q.data;
  usePageTitle(s ? `${s.docNo} ${s.employee}` : t('sep.title'));
  if (!id) return <ErrorState error={new Error(t('sep.noId'))} />;
  if (q.error?.status === 403) return <NoPermission what={t('sep.title')} permission="hr.separation.view" />;
  if (q.isPending) return <Skeleton label={t('sep.title')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['ext'] }); } catch (e) { setError(errorInfo(e)); } };
  const why = (fn, done) => { const r = window.prompt(t('act.why')); if (r) run(() => fn(r), done); };
  const x = f.data;
  return (
    <section aria-labelledby="sp-title" data-testid="separation" data-status={s.status}>
      <h1 id="sp-title">{s.employee} <StatusBadge status={TONE[s.status]} label={t(`st.${s.status}`)} /></h1>
      <p className="muted">{s.docNo} · {t(`type.${s.type}`)} · {s.employeeCode}{s.designation ? ` · ${s.designation}` : ''} · {t(`reason.${s.reasonCode}`)}</p>
      {error?.form && <p className="field-error" role="alert" data-testid="sp-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="sp-note">{note}</p>}
      <dl className="op-figures" data-testid="sp-facts">
        <div><dt>{t('resign.submittedOn')}</dt><dd>{s.submittedOn}</dd></div><div><dt>{t('sep.notice')}</dt><dd>{t('resign.days', { n: s.noticeDays })} ({s.standardLwd})</dd></div><div><dt>{t('sep.lwd')}</dt><dd data-testid="sp-lwd">{s.lastWorkingDay}</dd></div>
        {s.waiverDays > 0 && <div><dt>{t('sep.waiver')}</dt><dd>{t('resign.days', { n: s.waiverDays })}</dd></div>}{s.buyoutDays > 0 && <div><dt>{t('sep.buyout')}</dt><dd>{t('resign.days', { n: s.buyoutDays })}</dd></div>}{s.noticePayDays > 0 && <div><dt>{t('sep.noticePay')}</dt><dd>{t('resign.days', { n: s.noticePayDays })}</dd></div>}
      </dl>
      {s.reason && <p>{s.reason}</p>}
      <div className="actions-row no-print" data-testid="sp-actions">
        {s.can.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => ext.sepAct(id, 'submit'), t('resign.sent'))} data-testid="sp-submit">{t('act.send')}</button>}
        {s.can.withdraw && <button type="button" className="btn" onClick={() => why((r) => ext.sepAct(id, 'withdraw', { reason: r }))} data-testid="sp-withdraw">{t('act.withdraw')}</button>}
        {s.can.cancel && <button type="button" className="btn" onClick={() => why((r) => ext.sepAct(id, 'cancel', { reason: r }), t('sep.cancelled'))} data-testid="sp-cancel">{t('act.cancel')}</button>}
        {s.can.print && <a className="btn" href={`/api/v1/hr/separations/${id}/print`} target="_blank" rel="noreferrer">{t('act.print')}</a>}
      </div>
      {s.clearances.length > 0 && (
        <>
          <h2>{t('sep.clearances')}</h2>
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t('sep.clearances')}>
            <table className="grid" data-testid="sp-clearances"><thead><tr><th>{t('clr.department')}</th><th>{t('clr.items')}</th><th>{t('sep.status')}</th><th><span className="sr-only">{t('act.actions')}</span></th></tr></thead>
              <tbody>{s.clearances.map((c) => (
                <tr key={c.id} data-testid="sp-clr-row" data-dept={c.department} data-status={c.status}>
                  <th scope="row" data-label={t('clr.department')}>{c.name}</th>
                  <td data-label={t('clr.items')}>{c.items.map((i) => <span key={i.code} className="small">{i.label}: {t(`item.${i.status}`)}{i.recovery ? ` (${inr(i.recovery)})` : ''}<br /></span>)}</td>
                  <td data-label={t('sep.status')}><StatusBadge status={CTONE[c.status]} label={t(`cst.${c.status}`)} />{c.waiveReason ? <span className="muted small"> · {c.waiveReason}</span> : null}</td>
                  <td data-label={t('act.actions')}>{c.can.waive && <button type="button" className="btn btn-small" onClick={() => why((r) => ext.waive(c.id, r), t('clr.waived'))} data-testid="sp-waive">{t('clr.waive')}</button>}</td>
                </tr>))}</tbody></table>
          </div>
        </>
      )}
      {s.can.interview && (
        <>
          <h2>{t('iv.title')}</h2>
          {s.interview?.rating ? <p data-testid="sp-interview">{t('iv.rating')}: {s.interview.rating} · {s.interview.wouldRejoin == null ? '' : s.interview.wouldRejoin ? t('iv.wouldRejoin') : t('iv.wouldNot')} · {s.interview.by}</p> : (
            <form className="mdm-panel mdm-fields" onSubmit={(e) => { e.preventDefault(); run(() => ext.interview(id, { rating: Number(iv.rating), reasonCode: iv.reasonCode || undefined, wouldRejoin: iv.wouldRejoin === '' ? undefined : iv.wouldRejoin === 'yes', responses: { comments: iv.comments || null } }), t('iv.saved')); }} data-testid="sp-interview-form" aria-label={t('iv.title')}>
              <Field label={t('iv.rating')} name="rating" error={error}><select value={iv.rating} onChange={(e) => setIv({ ...iv, rating: e.target.value })} required data-testid="sp-iv-rating"><option value="">–</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
              <Field label={t('iv.realReason')} name="reasonCode" error={error}><select value={iv.reasonCode} onChange={(e) => setIv({ ...iv, reasonCode: e.target.value })} data-testid="sp-iv-reason"><option value="">–</option>{['BETTER_OPPORTUNITY', 'PERSONAL', 'RELOCATION', 'HIGHER_STUDIES', 'HEALTH', 'OTHER'].map((r) => <option key={r} value={r}>{t(`reason.${r}`)}</option>)}</select></Field>
              <Field label={t('iv.rejoin')} name="wouldRejoin" error={error}><select value={iv.wouldRejoin} onChange={(e) => setIv({ ...iv, wouldRejoin: e.target.value })} data-testid="sp-iv-rejoin"><option value="">–</option><option value="yes">{t('iv.yes')}</option><option value="no">{t('iv.no')}</option></select></Field>
              <Field label={t('iv.comments')} name="comments" error={error}><textarea rows="2" value={iv.comments} onChange={(e) => setIv({ ...iv, comments: e.target.value })} data-testid="sp-iv-comments" /></Field>
              <div className="actions"><button type="submit" className="btn btn-primary" data-testid="sp-iv-save">{t('act.save')}</button></div>
            </form>
          )}
        </>
      )}
      {x && (
        <div className="mdm-panel" data-testid="sp-fnf">
          <h2>{t('fnf.title')}</h2>
          <dl className="op-figures">
            <div><dt>{t('fnf.served')}</dt><dd>{t('resign.days', { n: x.servedDays })}</dd></div><div><dt>{t('fnf.recoveryDays')}</dt><dd data-testid="fnf-recovery-days">{x.notice.recoveryDays}</dd></div><div><dt>{t('fnf.payDays')}</dt><dd>{x.notice.payInLieuDays}</dd></div>
            <div><dt>{t('fnf.leave')}</dt><dd data-testid="fnf-leave">{x.leaveEncashmentDays}</dd></div><div><dt>{t('fnf.gratuity')}</dt><dd data-testid="fnf-gratuity">{x.gratuity.eligible ? t('fnf.eligible', { n: x.gratuity.countedYears }) : t('fnf.notEligible', { n: x.gratuity.years })}</dd></div>
            <div><dt>{t('fnf.claims')}</dt><dd>{inr(x.reimbursements.amount)}</dd></div><div><dt>{t('fnf.recoveries')}</dt><dd>{inr(x.recoveries.total)}</dd></div>
          </dl>
          {x.released ? <p data-testid="fnf-released"><StatusBadge status="COMPLETED" label={t('fnf.released', { date: String(x.releasedAt).slice(0, 10) })} /></p> : x.blockers.length ? <ul className="mdm-list" data-testid="fnf-blockers">{x.blockers.map((b, i) => <li key={i} className="field-error">{b}</li>)}</ul> : <p className="muted">{t('fnf.ready')}</p>}
          {s.can.fnf && !x.released && <div className="actions"><button type="button" className="btn btn-primary" disabled={!x.canRelease} onClick={() => run(() => ext.release(id), t('fnf.releasedNote'))} data-testid="fnf-release">{t('fnf.release')}</button></div>}
        </div>
      )}
      {s.can.letter && (
        <div className="actions-row no-print" data-testid="sp-letters">
          {!s.relievingIssued ? <button type="button" className="btn" onClick={() => run(() => ext.letter(id, 'RELIEVING'), t('letter.issued'))} data-testid="sp-relieving">{t('letter.issueRelieving')}</button> : <a className="btn" href={`/api/v1/hr/separations/${id}/letters/relieving`} target="_blank" rel="noreferrer">{t('letter.relieving')}</a>}
          {!s.experienceIssued ? <button type="button" className="btn" onClick={() => run(() => ext.letter(id, 'EXPERIENCE'), t('letter.issued'))} data-testid="sp-experience">{t('letter.issueExperience')}</button> : <a className="btn" href={`/api/v1/hr/separations/${id}/letters/experience`} target="_blank" rel="noreferrer">{t('letter.experience')}</a>}
        </div>
      )}
      {h.data && <><h2>{t('act.history')}</h2><ul className="mdm-list" data-testid="sp-history">{[...h.data.approvals.map((a) => ({ at: a.at, text: `${a.event} · ${a.actor}${a.comment ? `: ${a.comment}` : ''}` })), ...h.data.audit.map((a) => ({ at: a.at, text: `${a.action} · ${a.by}${a.reason ? `: ${a.reason}` : ''}` }))].sort((a, b) => String(a.at).localeCompare(String(b.at))).map((r, i) => <li key={i}><span className="muted small">{String(r.at).slice(0, 16).replace('T', ' ')}</span> {r.text}</li>)}</ul></>}
      <p className="small"><Link to="/exit/separations">{t('list.title')}</Link></p>
    </section>
  );
}
