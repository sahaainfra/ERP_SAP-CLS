import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { dayIST, ext } from './api.js';

// Resignation (HR, part 07.13, FR-01, self-service): the employee states the reason and the day they would like to leave; the page shows the notice of the policy (shorter on probation) and the last working day it gives, and asks for a waiver or
// a buyout when the day asked for is earlier. The manager and the HR manager accept it. Afterwards the page tracks the resignation: the last working day, the clearance of each department, the exit interview the employee can fill, and the letters.
const TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'ACTIVE', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', SETTLED: 'COMPLETED' };
const CTONE = { PENDING: 'IN_REVIEW', CLEARED: 'COMPLETED', WAIVED: 'AT_RISK', CANCELLED: 'CANCELLED' };
const REASONS = ['BETTER_OPPORTUNITY', 'PERSONAL', 'RELOCATION', 'HIGHER_STUDIES', 'HEALTH', 'RETIREMENT', 'OTHER'];
export default function ResignationPage() {
  const t = useT('sep');
  usePageTitle(t('resign.title'));
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ext', 'mine'], queryFn: ext.mine, retry: false });
  const [v, setV] = useState({ reasonCode: 'BETTER_OPPORTUNITY', reason: '', submittedOn: dayIST(0), requestedLwd: '', earlyMode: 'NONE' });
  const [pv, setPv] = useState(null); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const [iv, setIv] = useState({ rating: '', likedMost: '', improve: '', wouldRejoin: '' });
  useEffect(() => { const timer = setTimeout(async () => { try { setPv(await ext.preview({ type: 'RESIGNATION', submittedOn: v.submittedOn, requestedLwd: v.requestedLwd || null, earlyMode: v.earlyMode })); } catch { setPv(null); } }, 300); return () => clearTimeout(timer); }, [v.submittedOn, v.requestedLwd, v.earlyMode]);
  if (q.error?.status === 403) return <NoPermission what={t('resign.title')} permission="hr.separation.create" />;
  if (q.isPending) return <Skeleton label={t('resign.title')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const s = d.separation;
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); setNote(done); qc.invalidateQueries({ queryKey: ['ext'] }); } catch (e) { setError(errorInfo(e)); } };
  return (
    <section aria-labelledby="rs-title" data-testid="resignation" data-status={s?.status ?? 'NONE'}>
      <h1 id="rs-title">{t('resign.title')}</h1>
      <p className="muted" data-testid="rs-policy">{d.employee.name} · {t('resign.joined', { date: d.employee.doj })} · {d.employee.confirmed ? t('resign.confirmed') : t('resign.probation')} · {t('resign.notice', { n: d.employee.noticeDays })}</p>
      {error?.form && <p className="field-error" role="alert" data-testid="rs-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="rs-note">{note}</p>}
      {!s ? (
        <form className="mdm-panel mdm-fields" onSubmit={(e) => { e.preventDefault(); run(() => ext.createSeparation({ type: 'RESIGNATION', reasonCode: v.reasonCode, reason: v.reason.trim(), submittedOn: v.submittedOn, requestedLwd: v.requestedLwd || null, earlyMode: v.earlyMode, submit: true }), t('resign.sent')); }} data-testid="rs-form" aria-label={t('resign.title')}>
          <Field label={t('resign.reasonCode')} name="reasonCode" error={error}><select value={v.reasonCode} onChange={(e) => setV({ ...v, reasonCode: e.target.value })} data-testid="rs-reason-code">{REASONS.map((r) => <option key={r} value={r}>{t(`reason.${r}`)}</option>)}</select></Field>
          <Field label={t('resign.reason')} name="reason" error={error}><textarea rows="3" value={v.reason} maxLength={1000} onChange={(e) => setV({ ...v, reason: e.target.value })} required data-testid="rs-reason" /></Field>
          <Field label={t('resign.submittedOn')} name="submittedOn" error={error}><input type="date" value={v.submittedOn} max={dayIST(0)} onChange={(e) => setV({ ...v, submittedOn: e.target.value })} data-testid="rs-submitted" /></Field>
          <Field label={t('resign.lwd')} name="requestedLwd" error={error} hint={pv ? t('resign.standard', { date: pv.standardLwd }) : null}><input type="date" value={v.requestedLwd} min={v.submittedOn} onChange={(e) => setV({ ...v, requestedLwd: e.target.value })} data-testid="rs-lwd" /></Field>
          {pv?.shortDays > 0 && <Field label={t('resign.early', { n: pv.shortDays })} name="earlyMode" error={error}><select value={v.earlyMode} onChange={(e) => setV({ ...v, earlyMode: e.target.value })} data-testid="rs-early"><option value="NONE">{t('resign.choose')}</option><option value="WAIVER">{t('resign.waiver')}</option><option value="BUYOUT">{t('resign.buyout')}</option></select></Field>}
          <p data-testid="rs-preview">{pv ? t('resign.leaveOn', { date: pv.lastWorkingDay }) : '—'}</p>
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="rs-send">{t('resign.send')}</button></div>
        </form>
      ) : (
        <>
          <dl className="op-figures" data-testid="rs-status">
            <div><dt>{t('sep.status')}</dt><dd><StatusBadge status={TONE[s.status]} label={t(`st.${s.status}`)} /></dd></div><div><dt>{t('sep.lwd')}</dt><dd data-testid="rs-lwd-shown">{s.lastWorkingDay}</dd></div>
            <div><dt>{t('sep.notice')}</dt><dd>{t('resign.days', { n: s.noticeDays })}</dd></div>{s.waiverDays > 0 && <div><dt>{t('sep.waiver')}</dt><dd>{t('resign.days', { n: s.waiverDays })}</dd></div>}{s.buyoutDays > 0 && <div><dt>{t('sep.buyout')}</dt><dd>{t('resign.days', { n: s.buyoutDays })}</dd></div>}
          </dl>
          {s.clearances.length > 0 && <><h2>{t('sep.clearances')}</h2><ul className="mdm-list" data-testid="rs-clearances">{s.clearances.map((c) => <li key={c.id}>{c.name} <StatusBadge status={CTONE[c.status]} label={t(`cst.${c.status}`)} /></li>)}</ul></>}
          {s.can.interview && !s.interview && (
            <form className="mdm-panel mdm-fields" onSubmit={(e) => { e.preventDefault(); run(() => ext.interview(s.id, { rating: Number(iv.rating), wouldRejoin: iv.wouldRejoin === '' ? undefined : iv.wouldRejoin === 'yes', reasonCode: s.reasonCode, responses: { likedMost: iv.likedMost || null, improve: iv.improve || null } }), t('iv.saved')); }} data-testid="rs-interview" aria-label={t('iv.title')}>
              <h2>{t('iv.title')}</h2>
              <Field label={t('iv.rating')} name="rating" error={error}><select value={iv.rating} onChange={(e) => setIv({ ...iv, rating: e.target.value })} required data-testid="iv-rating"><option value="">–</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
              <Field label={t('iv.liked')} name="likedMost" error={error}><textarea rows="2" value={iv.likedMost} onChange={(e) => setIv({ ...iv, likedMost: e.target.value })} data-testid="iv-liked" /></Field>
              <Field label={t('iv.improve')} name="improve" error={error}><textarea rows="2" value={iv.improve} onChange={(e) => setIv({ ...iv, improve: e.target.value })} data-testid="iv-improve" /></Field>
              <Field label={t('iv.rejoin')} name="wouldRejoin" error={error}><select value={iv.wouldRejoin} onChange={(e) => setIv({ ...iv, wouldRejoin: e.target.value })} data-testid="iv-rejoin"><option value="">–</option><option value="yes">{t('iv.yes')}</option><option value="no">{t('iv.no')}</option></select></Field>
              <div className="actions"><button type="submit" className="btn btn-primary" data-testid="iv-save">{t('act.save')}</button></div>
            </form>
          )}
          {s.interview && <p className="muted" data-testid="rs-interview-done">{t('iv.done')}</p>}
          <div className="actions-row">
            {s.can.withdraw && <button type="button" className="btn" onClick={() => { const why = window.prompt(t('act.why')); if (why) run(() => ext.sepAct(s.id, 'withdraw', { reason: why }), t('resign.withdrawn')); }} data-testid="rs-withdraw">{t('act.withdraw')}</button>}
            {s.relievingIssued && <a className="btn" href={`/api/v1/hr/separations/${s.id}/letters/relieving`} target="_blank" rel="noreferrer" data-testid="rs-relieving">{t('letter.relieving')}</a>}
            {s.experienceIssued && <a className="btn" href={`/api/v1/hr/separations/${s.id}/letters/experience`} target="_blank" rel="noreferrer" data-testid="rs-experience">{t('letter.experience')}</a>}
            <Link to={`/exit/separation?id=${s.id}`}>{t('sep.open')}</Link>
          </div>
        </>
      )}
      <p className="small"><Link to="/grievances/new">{t('grv.raise')}</Link></p>
    </section>
  );
}
