import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { download, fmtDate, pl } from './api.js';
import { SchedulePicker, useSearch } from './parts.jsx';

// Critical Path & Float Report (part 13.01, FR-06): the finish the server's pass worked out, the critical chains, the activities by total float (a bar for each band), the near-critical work up to a threshold, and a link from every row to the activities.
const Bar = ({ n, max, label }) => <span role="img" aria-label={label} style={{ display: 'inline-block', width: '10rem', height: '0.7rem', background: 'var(--erp-color-border-subtle)', borderRadius: '0.3rem', overflow: 'hidden', verticalAlign: 'middle' }}><span style={{ display: 'block', width: `${max ? (n * 100) / max : 0}%`, height: '100%', background: 'var(--erp-color-status-info-solid)' }} /></span>;
function Rows({ rows, t, testId, scheduleId }) {
  return (
    <div className="table-scroll"><table className="data-table" data-testid={testId}><caption className="sr-only">{testId}</caption>
      <thead><tr><th>{t('f.code')}</th><th>{t('f.activity')}</th><th>{t('f.wbs')}</th><th className="num">{t('f.dur')}</th><th>{t('f.es')}</th><th>{t('f.ef')}</th><th>{t('f.lf')}</th><th className="num">{t('f.tf')}</th><th className="num">{t('f.ff')}</th><th className="num">%</th></tr></thead>
      <tbody>{rows.map((a) => <tr key={a.id} data-testid="pc-row"><td><Link to={`/plan/activities?scheduleId=${scheduleId}&filter=${a.critical ? 'critical' : 'all'}`}>{a.code}</Link></td><td>{a.name}</td><td>{a.wbs ?? '—'}</td><td className="num">{a.duration}</td><td>{fmtDate(a.es)}</td><td>{fmtDate(a.ef)}</td><td>{fmtDate(a.lf)}</td><td className={`num${a.totalFloat < 0 ? ' field-error' : ''}`}>{a.totalFloat}</td><td className="num">{a.freeFloat ?? '—'}</td><td className="num">{a.pctComplete}</td></tr>)}</tbody></table></div>
  );
}
export default function CriticalPage() {
  const t = useT('plan');
  usePageTitle(t('crit.title'));
  const session = useSession(); const perms = session.data?.permissions ?? []; const sp = useSearch();
  const [projectId, setProjectId] = useState(null); const [scheduleId, setScheduleId] = useState(Number(sp.get('scheduleId')) || null); const [near, setNear] = useState(5);
  const sq = useQuery({ queryKey: ['plan', 'schedule', scheduleId], queryFn: () => pl.schedule(scheduleId), enabled: Boolean(scheduleId), retry: false });
  const q = useQuery({ queryKey: ['plan', 'critical', scheduleId, near], queryFn: () => pl.critical(scheduleId, near), enabled: Boolean(scheduleId), retry: false, placeholderData: (x) => x });
  if (q.error?.status === 403) return <NoPermission what={t('crit.title')} permission="plan.schedule.view" />;
  const r = q.data; const max = r ? Math.max(1, ...r.buckets.map((b) => b.count)) : 1;
  return (
    <section aria-labelledby="pc-h" data-testid="plan-critical">
      <h1 id="pc-h">{t('crit.title')}</h1>
      <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('crit.params')}>
        <SchedulePicker projectId={projectId ?? sq.data?.projectId ?? null} scheduleId={scheduleId} onProject={(v) => { setProjectId(v); setScheduleId(null); }} onSchedule={setScheduleId} testId="pc" />
        <div className="form-grid"><Field label={t('crit.near')} name="near"><input type="number" min="0" max="100" step="1" value={near} onChange={(e) => setNear(Number(e.target.value || 0))} data-testid="pc-near" /></Field></div>
        {r && perms.includes('plan.schedule.export') && <div className="actions"><button type="button" className="btn" onClick={() => download(`/schedules/${scheduleId}/critical/export`, `critical-path-${r.docNo}.csv`).catch(() => null)} data-testid="pc-export">{t('crit.export')}</button></div>}
      </form>
      {!scheduleId && <p className="muted" data-testid="pc-choose">{t('crit.choose')}</p>}
      {scheduleId && q.isPending && <Skeleton label={t('crit.title')} rows={4} />}
      {q.isError && q.error?.status !== 403 && <ErrorState error={q.error} onRetry={q.refetch} />}
      {r && (
        <>
          {r.needsCalc && <p className="mdm-banner" role="status" data-testid="pc-stale">{t('crit.stale')}</p>}
          <dl className="kv" data-testid="pc-summary">
            <div><dt>{t('f.start')}</dt><dd>{fmtDate(r.start)}</dd></div><div><dt>{t('f.finish')}</dt><dd data-testid="pc-finish">{fmtDate(r.finish)}</dd></div><div><dt>{t('f.dataDate')}</dt><dd>{fmtDate(r.dataDate)}</dd></div>
            <div><dt>{t('f.activities')}</dt><dd>{r.totals.activities}</dd></div><div><dt>{t('f.critical')}</dt><dd data-testid="pc-critical">{r.totals.critical}</dd></div><div><dt>{t('crit.nearCount')}</dt><dd>{r.totals.nearCritical}</dd></div><div><dt>{t('crit.negative')}</dt><dd className={r.totals.negative ? 'field-error' : ''}>{r.totals.negative}</dd></div>
          </dl>
          <h2>{t('crit.byFloat')}</h2>
          <table className="data-table" data-testid="pc-buckets"><caption className="sr-only">{t('crit.byFloat')}</caption><thead><tr><th>{t('crit.band')}</th><th className="num">{t('f.activities')}</th><th /></tr></thead>
            <tbody>{r.buckets.map((b) => <tr key={b.label}><td>{t(`band.${b.label}`)}</td><td className="num">{b.count}</td><td><Bar n={b.count} max={max} label={`${b.count}`} /></td></tr>)}</tbody></table>
          <h2>{t('crit.paths')}</h2>
          {r.paths.length === 0 ? <p className="muted" data-testid="pc-nopath">{t('crit.noPath')}</p> : <ol data-testid="pc-paths">{r.paths.map((p, i) => <li key={i}>{p.codes.join(' → ')} <span className="muted">({fmtDate(p.start)} – {fmtDate(p.finish)})</span></li>)}</ol>}
          <h2>{t('crit.criticalList')}</h2>
          {r.critical.length === 0 ? <p className="muted">{t('crit.noneCritical')}</p> : <Rows rows={r.critical} t={t} testId="pc-critical-table" scheduleId={scheduleId} />}
          <h2>{t('crit.nearList', { n: near })}</h2>
          {r.nearCritical.length === 0 ? <p className="muted" data-testid="pc-nonear">{t('crit.noneNear')}</p> : <Rows rows={r.nearCritical} t={t} testId="pc-near-table" scheduleId={scheduleId} />}
        </>
      )}
    </section>
  );
}
