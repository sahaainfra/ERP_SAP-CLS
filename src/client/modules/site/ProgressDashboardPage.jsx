import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, Tile, usePageTitle } from '../core/pages/ui.jsx';
import { fmtDate, fmtPct, fmtRatio, fmtRs, st, today } from './api.js';
import { ProjectDay, useProjects } from './progress-parts.jsx';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow } from '../../platform/design/Kpi.jsx';

// Progress Dashboard (part 14.05, FR-05, FR-06): physical progress planned against actual and forecast, the schedule and cost performance indexes, the S-curves (physical and financial), the variance of each WBS node
// and the milestones. Every tile and row opens the report behind it; money is shown only to those who may see it.
const tone = (v, limit) => (v == null ? 'neutral' : v >= limit ? 'success' : v >= limit - 0.1 ? 'warning' : 'danger');
export default function ProgressDashboardPage() {
  const t = useT('site'); usePageTitle(t('cnd.prg.title')); const sp = useSearch();
  const [projectId, setProjectId] = useState(Number(sp.get('projectId')) || null); const [asOf, setAsOf] = useState(today()); const [mode, setMode] = useState('physical');
  const pq = useProjects();
  const q = useQuery({ queryKey: ['site', 'prg-dashboard', projectId, asOf], queryFn: () => st.prgDashboard(`projectId=${projectId}&asOf=${asOf}`), enabled: Boolean(projectId), retry: false });
  if (pq.error?.status === 403 || q.error?.status === 403) return <NoPermission what={t('cnd.prg.title')} permission="site.period.view" />;
  const d = q.data; const base = `projectId=${projectId}&asOf=${asOf}`;
  const curve = d && (() => { const c = d.curve; const fin = mode === 'financial' && c.planned.financial; const pick = (o) => (fin ? o.financial : o.physical); return { categories: c.dates.map((x) => x.slice(2)), series: [{ name: t('cnd.prg.planned'), values: pick(c.planned) }, { name: t('cnd.prg.actual'), values: pick(c.actual) }, { name: t('cnd.prg.forecast'), values: pick(c.forecast) }] }; })();
  return (
    <section aria-labelledby="prg-h" data-testid="site-progress">
      <PageHeader id="prg-h" title={t('cnd.prg.title')} />
      <ProjectDay projectId={projectId} asOf={asOf} onProject={setProjectId} onAsOf={setAsOf} max={today()} />
      {pq.isSuccess && (pq.data ?? []).length === 0 && <p className="muted" data-testid="prg-no-projects">{t('cnd.prg.noProjects')}</p>}
      {q.isPending && projectId && <Skeleton label={t('cnd.prg.title')} rows={6} />}
      {q.isError && q.error?.status !== 403 && <ErrorState error={q.error} onRetry={q.refetch} />}
      {d && (
        <>
          <p className="muted" data-testid="prg-basis">{t('cnd.prg.basis', { s: d.schedule.docNo, b: d.baseline?.docNo ?? t('cnd.prg.noBaseline'), d: fmtDate(d.asOf) })}{d.baselineMissing && <> · <strong>{t('cnd.prg.baselineMissing')}</strong></>}</p>
          <KpiRow data-testid="prg-tiles">
            <Tile label={t('cnd.prg.physical')} value={fmtPct(d.project.physical)} to={`/site/progress-report?${base}`} testId="prg-physical" />
            <Tile label={t('cnd.prg.planned')} value={fmtPct(d.project.planned)} to={`/site/progress-report?${base}`} testId="prg-planned" />
            <Tile label={t('cnd.prg.spi')} value={fmtRatio(d.project.spi)} status={tone(d.project.spi, d.spiLimit)} hint={t('cnd.prg.target', { n: fmtRatio(d.spiLimit) })} to={`/site/progress-report?${base}`} testId="prg-spi" />
            {d.canSeeCost && <Tile label={t('cnd.prg.cpi')} value={fmtRatio(d.project.cpi)} status={tone(d.project.cpi, 1)} testId="prg-cpi" />}
            {d.canSeeCost && <Tile label={t('cnd.prg.sv')} value={fmtRs(d.project.sv)} status={d.project.sv < 0 ? 'danger' : 'success'} testId="prg-sv" />}
            {d.canSeeCost && <Tile label={t('cnd.prg.cv')} value={fmtRs(d.project.cv)} status={d.project.cv == null ? 'neutral' : d.project.cv < 0 ? 'danger' : 'success'} testId="prg-cv" />}
            {d.canSeeCost && <Tile label={t('cnd.prg.eac')} value={fmtRs(d.project.eac)} hint={`BAC ${fmtRs(d.project.bac)}`} testId="prg-eac" />}
            <Tile label={t('cnd.prg.finish')} value={d.project.forecastFinish ? fmtDate(d.project.forecastFinish) : '—'} hint={t('cnd.prg.baselineFinish', { d: d.project.baselineFinish ? fmtDate(d.project.baselineFinish) : '—' })} testId="prg-finish" />
          </KpiRow>
          <div className="mdm-panel" data-testid="prg-curve-panel"><h2>{t('cnd.prg.scurve')}</h2>
            <div className="actions-row no-print" role="group" aria-label={t('cnd.prg.mode')}>
              <button type="button" className={`btn ${mode === 'physical' ? 'btn-primary' : ''}`} aria-pressed={mode === 'physical'} onClick={() => setMode('physical')} data-testid="prg-mode-physical">{t('cnd.prg.physical')}</button>
              {d.canSeeCost && <button type="button" className={`btn ${mode === 'financial' ? 'btn-primary' : ''}`} aria-pressed={mode === 'financial'} onClick={() => setMode('financial')} data-testid="prg-mode-financial">{t('cnd.prg.financial')}</button>}
            </div>
            <Chart type="line" data={curve} title={`${t('cnd.prg.scurve')} (${mode === 'financial' ? '₹' : '%'})`} />
          </div>
          <div className="mdm-panel" data-testid="prg-exceptions"><h2>{t('cnd.prg.exceptions')}</h2>
            {d.exceptions.length === 0 ? <p className="muted">{t('cnd.prg.noExceptions')}</p> : <ul>{d.exceptions.map((x, i) => <li key={i} data-testid="prg-exception"><StatusBadge status="OVERDUE" label={t(`cnd.prg.x.${x.kind}`)} /> {x.code} {x.name}{x.spi != null ? ` · SPI ${fmtRatio(x.spi)}` : ''}{x.slipDays != null ? ` · ${t('cnd.prg.slip', { n: x.slipDays })}` : ''}{x.kind !== 'MILESTONE_LATE' && <> · <Link to={`/site/progress-report?${base}`}>{t('cnd.prg.open')}</Link></>}</li>)}</ul>}
          </div>
          <div className="mdm-panel" data-testid="prg-pending"><h2>{t('cnd.prg.pending')}</h2>
            {d.pending.length === 0 ? <p className="muted">{t('cnd.prg.nonePending')}</p> : <ul>{d.pending.map((p) => <li key={p.id}><Link to={`/site/periods?id=${p.id}`}>{p.docNo}</Link> · {t(`cnd.prg.pa.${p.action}`)}</li>)}</ul>}
            {d.lastClosed && <p className="muted">{t('cnd.prg.lastClosed')}: <Link to={`/site/periods?id=${d.lastClosed.id}`}>{d.lastClosed.docNo}</Link> ({fmtDate(d.lastClosed.periodEnd)}) · {fmtPct(d.lastClosed.physical)} / {fmtPct(d.lastClosed.planned)}{d.lastClosed.spi != null ? ` · SPI ${fmtRatio(d.lastClosed.spi)}` : ''}</p>}
          </div>
          <div className="mdm-panel" data-testid="prg-wbs"><h2>{t('cnd.prg.byWbs')}</h2>
            <div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('cnd.prg.byWbs')}</caption><thead><tr><th>{t('cnd.prg.wbs')}</th><th className="num">{t('cnd.prg.planned')}</th><th className="num">{t('cnd.prg.actual')}</th><th className="num">{t('cnd.prg.variance')}</th><th className="num">SPI</th></tr></thead>
              <tbody>{d.wbs.map((n) => <tr key={n.id} data-testid="prg-wbs-row" data-behind={n.behind ? '1' : undefined}><td style={{ paddingLeft: 8 + n.level * 16 }}><Link to={`/site/progress-report?${base}&wbsId=${n.id}`}>{n.code} {n.name}</Link></td><td className="num">{fmtPct(n.planned)}</td><td className="num">{fmtPct(n.physical)}</td><td className="num">{n.behind ? <StatusBadge status="OVERDUE" label={fmtPct(-n.varianceBehind || 0)} /> : fmtPct(-n.varianceBehind || 0)}</td><td className="num">{fmtRatio(n.spi)}</td></tr>)}</tbody></table></div>
          </div>
          <div className="mdm-panel" data-testid="prg-milestones"><h2>{t('cnd.prg.milestones')}</h2>
            {d.milestones.length === 0 ? <p className="muted">{t('cnd.prg.noMilestones')}</p> : <div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('cnd.prg.milestones')}</caption><thead><tr><th>{t('cnd.prg.activity')}</th><th>{t('cnd.prg.baselineDate')}</th><th>{t('cnd.prg.forecastDate')}</th><th>{t('cnd.prg.achieved')}</th><th className="num">{t('cnd.prg.slipCol')}</th></tr></thead>
              <tbody>{d.milestones.map((m) => <tr key={m.code} data-testid="prg-milestone-row"><td>{m.code} {m.name}</td><td>{m.baselineFinish ? fmtDate(m.baselineFinish) : '—'}</td><td>{m.forecastFinish ? fmtDate(m.forecastFinish) : '—'}</td><td>{m.actualFinish ? fmtDate(m.actualFinish) : '—'}</td><td className="num">{m.slipDays ?? '—'}</td></tr>)}</tbody></table></div>}
          </div>
        </>
      )}
    </section>
  );
}
