import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { api } from '../../platform/api/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, usePageTitle } from '../core/pages/ui.jsx';
import { download, fmtDate, fmtPct, st } from './api.js';
import { ProjectDay } from './progress-parts.jsx';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow } from '../../platform/design/Kpi.jsx';

// Client Progress Report (part 14.05, FR-06): the report the client receives, in percentages and dates, with no cost: the overall progress, the WBS table, the milestones and the S-curve. From a closed period it is
// that period's snapshot and never changes; with no period chosen it is the picture as at the latest closed one, or today. It exports to PDF and Excel and prints.
export default function ClientProgressPage() {
  const t = useT('site'); usePageTitle(t('cnd.cli.title')); const sp = useSearch();
  const [projectId, setProjectId] = useState(Number(sp.get('projectId')) || null); const [periodId, setPeriodId] = useState(sp.get('periodId') || ''); const [error, setError] = useState(null);
  const pq = useQuery({ queryKey: ['site', 'cli-periods', projectId], queryFn: async () => (await api.get(`/site/periods?filter[projectId]=${projectId}&filter[status]=APPROVED&pageSize=50&sort=-periodEnd`)).data, enabled: Boolean(projectId), retry: false });
  const qs = `projectId=${projectId}${periodId ? `&periodId=${periodId}` : ''}`;
  const q = useQuery({ queryKey: ['site', 'prg-client', qs], queryFn: () => st.prgClient(qs), enabled: Boolean(projectId), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('cnd.cli.title')} permission="site.period.view" />;
  const r = q.data; const exp = (f) => download(`/progress/client-report/export?${qs}&format=${f}`, `client-progress.${f}`).catch(() => setError(t('bl.fileFailed')));
  return (
    <section aria-labelledby="cli-h" data-testid="site-client-progress">
      <PageHeader id="cli-h" title={t('cnd.cli.title')} />
      <ProjectDay projectId={projectId} onProject={(v) => { setProjectId(v); setPeriodId(''); }} testId="cli" />
      {projectId && <div className="mdm-panel no-print"><div className="form-grid"><Field label={t('cnd.cli.period')} name="periodId"><select value={periodId} onChange={(e) => setPeriodId(e.target.value)} data-testid="cli-period"><option value="">{t('cnd.cli.latest')}</option>{(pq.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.docNo} · {fmtDate(p.periodStart)} – {fmtDate(p.periodEnd)}</option>)}</select></Field></div>
        {r && <div className="actions-row"><button type="button" className="btn" onClick={() => exp('pdf')} data-testid="cli-pdf">PDF</button><button type="button" className="btn" onClick={() => exp('xlsx')} data-testid="cli-xlsx">XLSX</button><button type="button" className="btn" onClick={() => window.print()} data-testid="cli-print">{t('act.print')}</button></div>}{error && <p className="field-error" role="alert">{error}</p>}</div>}
      {q.isPending && projectId && <Skeleton label={t('cnd.cli.title')} rows={5} />}
      {q.isError && q.error?.status !== 403 && <ErrorState error={q.error} onRetry={q.refetch} />}
      {r && (
        <article className="mdm-panel" data-testid="cli-report" data-live={r.live ? '1' : '0'}>
          <h2>{r.company}</h2><p><strong>{r.project.code} · {r.project.name}</strong> · {r.period ? t('cnd.cli.forPeriod', { n: r.period.docNo, a: fmtDate(r.period.start), b: fmtDate(r.period.end) }) : t('cnd.cli.asAt', { d: fmtDate(r.asOf) })}</p>
          <KpiRow><div className="tile" data-testid="cli-planned"><div className="tile-label">{t('cnd.prg.planned')}</div><div className="tile-value">{fmtPct(r.summary.planned)}</div></div><div className="tile" data-testid="cli-actual"><div className="tile-label">{t('cnd.prg.actual')}</div><div className="tile-value">{fmtPct(r.summary.physical)}</div></div><div className="tile"><div className="tile-label">{t('cnd.prg.forecast')}</div><div className="tile-value">{fmtPct(r.summary.forecast)}</div></div></KpiRow>
          <p>{t('cnd.cli.finish', { b: r.summary.baselineFinish ? fmtDate(r.summary.baselineFinish) : '—', f: r.summary.forecastFinish ? fmtDate(r.summary.forecastFinish) : '—' })}</p>
          <Chart type="line" data={{ categories: r.curve.dates.map((x) => x.slice(2)), series: [{ name: t('cnd.prg.planned'), values: r.curve.planned }, { name: t('cnd.prg.actual'), values: r.curve.actual }, { name: t('cnd.prg.forecast'), values: r.curve.forecast }] }} title={`${t('cnd.prg.scurve')} (%)`} />
          <div className="table-scroll"><table className="data-table" data-testid="cli-wbs"><caption>{t('cnd.prg.byWbs')}</caption><thead><tr><th>{t('cnd.prg.wbs')}</th><th className="num">{t('cnd.prg.planned')}</th><th className="num">{t('cnd.prg.actual')}</th><th className="num">{t('cnd.prg.forecast')}</th><th className="num">{t('cnd.prg.variance')}</th></tr></thead>
            <tbody>{r.wbs.map((n) => <tr key={n.code}><td>{n.code} {n.name}</td><td className="num">{fmtPct(n.planned)}</td><td className="num">{fmtPct(n.physical)}</td><td className="num">{fmtPct(n.forecast)}</td><td className="num">{fmtPct(n.variance)}</td></tr>)}</tbody></table></div>
          {r.milestones.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="cli-milestones"><caption>{t('cnd.prg.milestones')}</caption><thead><tr><th>{t('cnd.prg.activity')}</th><th>{t('cnd.prg.baselineDate')}</th><th>{t('cnd.prg.forecastDate')}</th><th>{t('cnd.prg.achieved')}</th></tr></thead><tbody>{r.milestones.map((m) => <tr key={m.code}><td>{m.code} {m.name}</td><td>{m.baselineFinish ? fmtDate(m.baselineFinish) : '—'}</td><td>{m.forecastFinish ? fmtDate(m.forecastFinish) : '—'}</td><td>{m.actualFinish ? fmtDate(m.actualFinish) : '—'}</td></tr>)}</tbody></table></div>}
        </article>
      )}
    </section>
  );
}
