import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { perf } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Appraisal Review (HR, part 07.11, FR-05): one review of one person in one cycle, in its stages: the person writes their self-review (a rating of 1 to 5 and what they did), the manager reviews, HR calibrates (a rating that differs from the
// manager's carries its reason) and writes the development plan, then the final rating is approved by the manager, the skip-level reviewer and the HR manager (the director too for senior grades). The KPI and goal scores are shown beside the rating,
// never instead of it. Before approval the person does not see what the manager and HR wrote. After approval HR issues the appraisal letter and the person downloads it.
const TONE = { DRAFT: 'IN_REVIEW', SUBMITTED: 'IN_REVIEW', APPROVED: 'COMPLETED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
const STAGES = ['SELF', 'MANAGER', 'CALIBRATION', 'FINAL', 'DONE'];
export default function ReviewPage() {
  const t = useT('prf');
  const qc = useQueryClient();
  const id = Number(new URLSearchParams(window.location.search).get('id')) || null;
  const q = useQuery({ queryKey: ['perf', 'review', id], queryFn: () => perf.review(id), enabled: Boolean(id), retry: false });
  const h = useQuery({ queryKey: ['perf', 'history', id], queryFn: () => perf.history(id), enabled: Boolean(id) && q.isSuccess, retry: false });
  const [f, setF] = useState({ rating: '', comments: '', reason: '', plan: '' }); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const r = q.data;
  usePageTitle(r ? `${r.docNo} ${r.employee}` : t('rv.title'));
  if (!id) return <ErrorState error={new Error(t('rv.noId'))} />;
  if (q.error?.status === 403) return <NoPermission what={t('rv.title')} permission="hr.review.view" />;
  if (q.isPending) return <Skeleton label={t('rv.title')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['perf'] }); } catch (e) { setError(errorInfo(e)); } };
  const ratings = [1, 2, 3, 4, 5];
  const select = (value, onChange, testid) => <select value={value} onChange={(e) => onChange(e.target.value)} required data-testid={testid}><option value="">{t('s.pick')}</option>{ratings.map((n) => <option key={n} value={n}>{n} · {t(`rating.${n}`)}</option>)}</select>;
  return (
    <section aria-labelledby="rv-title" data-testid="review" data-status={r.status} data-stage={r.stage}>
      <PageHeader id="rv-title" title={<>{r.employee} <StatusBadge status={TONE[r.status]} label={t(`rv.st.${r.status}`)} /></>} subtitle={<>{r.docNo} · {r.code}{r.designation ? ` · ${r.designation}` : ''} · {r.cycle}{r.band === 'SENIOR' ? ` · ${t('rv.senior')}` : ''}</>} />
      <ol className="prf-stages" aria-label={t('rv.stages')}>{STAGES.map((s) => <li key={s} aria-current={s === r.stage ? 'step' : undefined} className={STAGES.indexOf(s) < STAGES.indexOf(r.stage) ? 'prf-done' : ''}>{t(`stage.${s}`)}</li>)}</ol>
      {error?.form && <p className="field-error" role="alert" data-testid="rv-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="rv-note">{note}</p>}
      <dl className="op-figures" data-testid="rv-scores">
        <div><dt>{t('my.kpiScore')}</dt><dd data-testid="rv-kpi">{r.kpiScore ?? '—'}</dd></div><div><dt>{t('my.goalScore')}</dt><dd>{r.goalScore == null ? '—' : `${r.goalScore}%`}</dd></div>
        <div><dt>{t('rv.self')}</dt><dd data-testid="rv-self-rating">{r.selfRating ?? '—'}</dd></div><div><dt>{t('rv.manager')}</dt><dd data-testid="rv-manager-rating">{r.hidden ? t('rv.hidden') : r.managerRating ?? '—'}</dd></div>
        <div><dt>{t('rv.final')}</dt><dd data-testid="rv-final">{r.finalRating ? `${r.finalRating} · ${t(`rating.${r.finalRating}`)}` : r.hidden ? t('rv.hidden') : '—'}</dd></div>
      </dl>
      <h2>{t('my.kpis')}</h2>
      {r.kpis.length === 0 ? <p className="muted">{t('my.noKpis')}</p> : <ul className="mdm-list" data-testid="rv-kpis">{r.kpis.map((k) => <li key={k.code}>{k.name}: {k.avgScore ?? '—'} <span className="muted small">({t('my.target')} {k.target}, {t('my.weight')} {k.weight}%)</span></li>)}</ul>}
      {r.openDisputes > 0 && <p className="field-error" data-testid="rv-disputes">{t('rv.openDisputes', { n: r.openDisputes })}</p>}
      <h2>{t('goal.title')}</h2>
      {r.goals.length === 0 ? <p className="muted">{t('goal.none')}</p> : <ul className="mdm-list" data-testid="rv-goals">{r.goals.map((g) => <li key={g.id}>{g.title} · {g.weight}% · {g.progress}%</li>)}</ul>}
      {r.feedback.length > 0 && <><h2>{t('fb.title')}</h2><ul className="mdm-list">{r.feedback.map((x, i) => <li key={i}><span className="muted small">{t(`fb.kind.${x.kind}`)}</span> {x.body}</li>)}</ul></>}
      {r.selfComments && <><h2>{t('rv.self')}</h2><p data-testid="rv-self-comments">{r.selfComments}</p></>}
      {r.managerComments && <><h2>{t('rv.manager')}</h2><p data-testid="rv-manager-comments">{r.managerComments}</p></>}
      {r.calibrationReason && <p className="muted">{t('rv.calibrationReason')}: {r.calibrationReason}</p>}
      {r.developmentPlan && <><h2>{t('rv.plan')}</h2><p data-testid="rv-plan">{r.developmentPlan}</p></>}
      {r.can.self && (
        <form className="mdm-panel mdm-fields" aria-label={t('rv.selfForm')} data-testid="rv-self-form" onSubmit={(e) => { e.preventDefault(); run(() => perf.reviewAct(id, 'self', { rating: Number(f.rating), comments: f.comments.trim() }), t('rv.sent')); }}>
          <h2>{t('rv.selfForm')}</h2>
          <Field label={t('rv.rating')} name="rating" error={error}>{select(f.rating, (x) => setF({ ...f, rating: x }), 'rv-rating')}</Field>
          <Field label={t('rv.comments')} name="comments" error={error}><textarea rows="4" value={f.comments} onChange={(e) => setF({ ...f, comments: e.target.value })} minLength={5} required data-testid="rv-comments" /></Field>
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="rv-self-send">{t('act.send')}</button></div>
        </form>
      )}
      {r.can.manager && (
        <form className="mdm-panel mdm-fields" aria-label={t('rv.managerForm')} data-testid="rv-manager-form" onSubmit={(e) => { e.preventDefault(); run(() => perf.reviewAct(id, 'manager', { rating: Number(f.rating), comments: f.comments.trim() }), t('rv.sent')); }}>
          <h2>{t('rv.managerForm')}</h2>
          <Field label={t('rv.rating')} name="rating" error={error}>{select(f.rating, (x) => setF({ ...f, rating: x }), 'rv-rating')}</Field>
          <Field label={t('rv.comments')} name="comments" error={error}><textarea rows="4" value={f.comments} onChange={(e) => setF({ ...f, comments: e.target.value })} minLength={5} required data-testid="rv-comments" /></Field>
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="rv-manager-send">{t('act.send')}</button></div>
        </form>
      )}
      {r.can.calibrate && (
        <form className="mdm-panel mdm-fields" aria-label={t('rv.calibrateForm')} data-testid="rv-calibrate-form" onSubmit={(e) => { e.preventDefault(); run(() => perf.reviewAct(id, 'calibrate', { rating: Number(f.rating), reason: f.reason.trim() || null, developmentPlan: f.plan.trim() }), t('rv.calibrated')); }}>
          <h2>{t('rv.calibrateForm')}</h2>
          <Field label={t('rv.finalRating')} name="rating" error={error}>{select(f.rating, (x) => setF({ ...f, rating: x }), 'rv-cal-rating')}</Field>
          <Field label={t('rv.calibrationReason')} name="reason" error={error} hint={t('rv.reasonHint')}><textarea rows="2" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} data-testid="rv-reason" /></Field>
          <Field label={t('rv.plan')} name="developmentPlan" error={error}><textarea rows="3" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} minLength={5} required data-testid="rv-plan-input" /></Field>
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="rv-calibrate-save">{t('act.save')}</button></div>
        </form>
      )}
      <div className="actions-row no-print" data-testid="rv-actions">
        {r.can.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => perf.reviewAct(id, 'submit'), t('rv.submitted'))} data-testid="rv-submit">{t('rv.submit')}</button>}
        {r.can.sendBack && <button type="button" className="btn" onClick={() => { const why = window.prompt(t('goal.why')); if (why) run(() => perf.reviewAct(id, 'send-back', { reason: why }), t('rv.backed')); }} data-testid="rv-send-back">{t('rv.sendBack')}</button>}
        {r.can.withdraw && <button type="button" className="btn" onClick={() => { const why = window.prompt(t('goal.why')); if (why) run(() => perf.reviewAct(id, 'withdraw', { reason: why })); }} data-testid="rv-withdraw">{t('act.withdraw')}</button>}
        {r.can.cancel && <button type="button" className="btn" onClick={() => { const why = window.prompt(t('goal.why')); if (why) run(() => perf.reviewAct(id, 'cancel', { reason: why })); }} data-testid="rv-cancel">{t('act.cancel')}</button>}
        {r.can.letter && <button type="button" className="btn btn-primary" onClick={() => run(() => perf.reviewAct(id, 'letter'), t('rv.letterIssued'))} data-testid="rv-letter">{t('rv.letter')}</button>}
        {r.can.download && <a className="btn" href={`/api/v1/hr/reviews/${id}/letter`} target="_blank" rel="noreferrer" data-testid="rv-download">{t('rv.download')}</a>}
        {r.can.print && <a className="btn" href={`/api/v1/hr/reviews/${id}/print`} target="_blank" rel="noreferrer" data-testid="rv-print">{t('cal.print')}</a>}
      </div>
      {h.data && (h.data.approvals.length > 0 || h.data.audit.length > 0) && <><h2>{t('ses.history')}</h2><ul className="mdm-list" data-testid="rv-history">{[...h.data.approvals.map((a) => ({ at: a.at, text: `${a.event} · ${a.actor}${a.comment ? `: ${a.comment}` : ''}` })), ...h.data.audit.map((a) => ({ at: a.at, text: `${a.action} · ${a.by}${a.reason ? `: ${a.reason}` : ''}` }))].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((x, i) => <li key={i}><span className="muted small">{String(x.at).slice(0, 16).replace('T', ' ')}</span> {x.text}</li>)}</ul></>}
      <p className="small"><Link to="/performance">{t('my.title')}</Link> · <Link to="/performance/reviews">{t('rvl.title')}</Link></p>
    </section>
  );
}
