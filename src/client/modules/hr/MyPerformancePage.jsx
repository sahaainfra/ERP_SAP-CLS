import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT, useLang } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { perf } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// My Performance (HR, part 07.11, FR-03 and FR-06): the person's KPIs of the open cycle: each with its value, target, score, the last six months as bars, and what it was computed from. A figure opens its evidence (the records behind it, the days
// left out for leave and transfer, and the same figure computed again from the same query); the person can dispute it, and it is frozen until HR decides. Beside them: goals, the review of the cycle and what waits for the person.
const TONE = { GREEN: 'COMPLETED', AMBER: 'AT_RISK', RED: 'OVERDUE', NONE: 'DRAFT' };
const fmt = (v, unit) => (v == null ? '—' : unit === 'PERCENT' ? `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%` : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 }));
export default function MyPerformancePage() {
  const t = useT('prf'); const lang = useLang();
  usePageTitle(t('my.title'));
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['perf', 'my'], queryFn: () => perf.my(), retry: false });
  const [open, setOpen] = useState(null); const [note, setNote] = useState(null); const [error, setError] = useState(null); const [reason, setReason] = useState('');
  const ev = useQuery({ queryKey: ['perf', 'evidence', open], queryFn: () => perf.evidence(open), enabled: Boolean(open), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('my.title')} permission="hr.perf.own" />;
  if (q.isPending) return <Skeleton label={t('my.title')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['perf'] });
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); setNote(done); refresh(); } catch (e) { setError(errorInfo(e)); } };
  const name = (k) => (lang === 'hi' && k.nameHi ? k.nameHi : k.name);
  return (
    <section aria-labelledby="mp-title" data-testid="my-performance">
      <PageHeader id="mp-title" title={t('my.title')} />
      <p className="muted" data-testid="mp-cycle">{d.cycle ? `${d.cycle.name} · ${d.cycle.startDate} → ${d.cycle.endDate}` : t('my.noCycle')}</p>
      {error?.form && <p className="field-error" role="alert" data-testid="mp-error">{error.form}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="mp-note">{note}</p>}
      <dl className="op-figures" data-testid="mp-tiles">
        <div><dt>{t('my.kpiScore')}</dt><dd data-testid="mp-score"><StatusBadge status={TONE[d.tone]} label={d.kpiScore == null ? '—' : String(d.kpiScore)} /></dd></div>
        <div><dt>{t('my.goalScore')}</dt><dd>{d.goalScore == null ? '—' : `${d.goalScore}%`}</dd></div>
        <div><dt>{t('my.review')}</dt><dd data-testid="mp-review">{d.review ? <Link to={`/performance/review?id=${d.review.id}`}>{t(`stage.${d.review.stage}`)}</Link> : '—'}</dd></div>
        <div><dt>{t('my.disputes')}</dt><dd>{d.openDisputes}</dd></div>
      </dl>
      {d.pending.length > 0 && <><h2>{t('my.pending')}</h2><ul className="mdm-list" data-testid="mp-pending">{d.pending.map((p) => <li key={p.kind}><Link to={p.to}>{t(`pending.${p.kind}`, { n: p.n ?? 0 })}</Link></li>)}</ul></>}
      <div className="actions-row no-print"><button type="button" className="btn" onClick={() => run(() => perf.compute({}), t('my.refreshed'))} data-testid="mp-refresh">{t('my.refresh')}</button>
        <Link to="/performance/goals">{t('goal.title')}</Link> · <Link to="/performance/feedback">{t('fb.title')}</Link></div>
      <h2>{t('my.kpis')}</h2>
      {d.kpis.length === 0 ? <p className="muted" data-testid="mp-none">{t('my.noKpis')}</p> : (
        <ul className="prf-kpis" data-testid="mp-kpis">{d.kpis.map((k) => (
          <li key={k.code} className="prf-kpi" data-code={k.code} data-tone={k.tone}>
            <div className="prf-kpi-head"><strong>{name(k)}</strong> <StatusBadge status={TONE[k.tone]} label={k.latest?.score == null ? '—' : String(k.latest.score)} /></div>
            <p className="muted small">{t('my.value')}: <span data-testid="mp-value">{fmt(k.latest?.value, k.unit)}</span> · {t('my.target')}: {fmt(k.target, k.unit)} {k.direction === 'LOWER' ? t('my.lower') : ''} · {t('my.weight')} {k.weight}%{k.latest?.excludedDays ? ` · ${t('my.excluded', { n: k.latest.excludedDays })}` : ''}{k.latest?.status === 'DISPUTED' ? ` · ${t('my.frozen')}` : ''}</p>
            <div className="prf-trend" role="img" aria-label={t('my.trend')}>{k.trend.map((x) => <span key={x.id} className="prf-bar" title={`${x.period}: ${fmt(x.value, k.unit)}`}><span style={{ blockSize: `${x.score ?? 0}%` }} /></span>)}</div>
            {k.latest && <button type="button" className="btn btn-small" onClick={() => { setOpen(k.latest.id); setReason(''); }} data-testid="mp-evidence">{t('my.evidence')}</button>}
          </li>))}</ul>
      )}
      {open && (
        <div className="mdm-panel" data-testid="mp-evidence-panel">
          <h2>{t('ev.title')}</h2>
          {ev.isPending ? <Skeleton label={t('ev.title')} rows={3} /> : ev.isError ? <ErrorState error={ev.error} onRetry={ev.refetch} /> : (
            <>
              <p>{ev.data.name} · {ev.data.period} · {t('my.value')} {fmt(ev.data.value, ev.data.unit)} · {t('my.target')} {fmt(ev.data.target, ev.data.unit)} · {t('ev.sample', { n: ev.data.sample })}</p>
              {ev.data.reproduced && <p data-testid="ev-reproduced">{ev.data.reproduced.matches ? t('ev.same', { v: fmt(ev.data.reproduced.value, ev.data.unit) }) : t('ev.differs', { v: fmt(ev.data.reproduced.value, ev.data.unit) })}</p>}
              {ev.data.note && <p>{ev.data.note} <span className="muted small">({ev.data.enteredBy})</span></p>}
              {ev.data.excluded.length > 0 && <p className="muted small" data-testid="ev-excluded">{t('ev.excluded', { n: ev.data.excluded.length })}: {ev.data.excluded.slice(0, 10).join(', ')}{ev.data.excluded.length > 10 ? '…' : ''}</p>}
              {ev.data.records.length === 0 ? <p className="muted">{t('ev.noRecords')}</p> : (
                <div className="table-wrap" tabIndex={0} role="region" aria-label={t('ev.title')}><table className="grid" data-testid="ev-records"><thead><tr><th>{t('ev.record')}</th><th>{t('ev.date')}</th><th>{t('ev.result')}</th></tr></thead>
                  <tbody>{ev.data.records.map((r, i) => <tr key={i}><th scope="row" data-label={t('ev.record')}>{r.ref}</th><td data-label={t('ev.date')}>{r.date ?? '—'}</td><td data-label={t('ev.result')}>{r.result}</td></tr>)}</tbody></table></div>
              )}
              {ev.data.dispute && <p data-testid="ev-dispute">{t('ev.dispute')}: {t(`dispute.${ev.data.dispute.status}`)}{ev.data.dispute.resolution ? ` · ${ev.data.dispute.resolution}` : ''}</p>}
              {ev.data.can.dispute && (
                <form className="mdm-fields" onSubmit={(e) => { e.preventDefault(); run(() => perf.dispute(open, reason.trim()), t('ev.disputed')); setOpen(null); }} data-testid="ev-dispute-form" aria-label={t('ev.raise')}>
                  <label>{t('ev.reason')} <textarea rows="2" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required data-testid="ev-reason" /></label>
                  <div className="actions"><button type="submit" className="btn btn-primary" data-testid="ev-raise">{t('ev.raise')}</button></div>
                </form>
              )}
            </>
          )}
          <div className="actions"><button type="button" className="btn" onClick={() => setOpen(null)}>{t('act.close')}</button></div>
        </div>
      )}
    </section>
  );
}
