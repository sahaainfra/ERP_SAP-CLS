import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, Tile, usePageTitle } from '../core/pages/ui.jsx';
import { daysAgo, fmtDate, fmtPct, fmtQty, st, today } from './api.js';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow } from '../../platform/design/Kpi.jsx';

// Productivity Dashboard (part 14.06, FR-02, FR-04, FR-05): the labour efficiency (the man-days the norm asks for over the man-days used), the man-days lost, by work type, crew and contractor, the weekly trend, the
// worst performers, the alerts and the records to check; every tile and row opens the report behind it.
const tone = (v, limit) => (v == null ? 'neutral' : v >= 100 ? 'success' : v >= limit ? 'warning' : 'danger');
export function ProdFilters({ t, f, set, projects, sites, testId = 'pd' }) {
  return (
    <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('cnd.prd.params')}>
      <div className="form-grid">
        <Field label={t('cnd.prg.project')} name="projectId"><select value={f.projectId} onChange={(e) => set({ ...f, projectId: e.target.value, siteId: '' })} data-testid={`${testId}-project`}><option value="">{t('cnd.prd.allProjects')}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
        <Field label={t('f.site')} name="siteId"><select value={f.siteId} onChange={(e) => set({ ...f, siteId: e.target.value })} data-testid={`${testId}-site`}><option value="">{t('dpr.allSites')}</option>{sites.filter((s) => !f.projectId || String(s.projectId) === String(f.projectId)).map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select></Field>
        <Field label={t('h.from')} name="from"><input type="date" value={f.from} max={f.to} onChange={(e) => e.target.value && set({ ...f, from: e.target.value })} data-testid={`${testId}-from`} /></Field>
        <Field label={t('h.to')} name="to"><input type="date" value={f.to} max={today()} onChange={(e) => e.target.value && set({ ...f, to: e.target.value })} data-testid={`${testId}-to`} /></Field>
      </div>
    </form>
  );
}
export const qsOf = (f, extra = {}) => new URLSearchParams(Object.entries({ projectId: f.projectId, siteId: f.siteId, from: f.from, to: f.to, ...extra }).filter(([, v]) => v)).toString();
export const useFilters = () => { const sp = useSearch(); return useState({ projectId: sp.get('projectId') ?? '', siteId: sp.get('siteId') ?? '', from: sp.get('from') ?? daysAgo(29), to: sp.get('to') ?? today() }); };

function Table({ t, title, rows, testId, link }) {
  return (
    <div className="mdm-panel" data-testid={testId}><h2>{title}</h2>
      {rows.length === 0 ? <p className="muted">{t('cnd.prd.noData')}</p> : <div className="table-scroll"><table className="data-table"><caption className="sr-only">{title}</caption><thead><tr><th>{t('cnd.prd.group')}</th><th className="num">{t('cnd.prd.output')}</th><th className="num">{t('cnd.prd.manDays')}</th><th className="num">{t('cnd.prd.perMd')}</th><th className="num">{t('cnd.prd.efficiency')}</th><th className="num">{t('cnd.prd.lost')}</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.key} data-testid={`${testId}-row`}><td>{link ? <Link to={link(r)}>{r.label}</Link> : r.label}</td><td className="num">{fmtQty(r.qty)} {r.uom ?? ''}</td><td className="num">{fmtQty(r.manDays)}</td><td className="num">{r.outputPerMd == null ? '—' : fmtQty(r.outputPerMd)}</td><td className="num">{fmtPct(r.efficiency)}</td><td className="num">{fmtQty(r.lostManDays)}</td></tr>)}</tbody></table></div>}
    </div>
  );
}

export default function ProductivityDashboardPage() {
  const t = useT('site'); usePageTitle(t('cnd.prd.title')); const [f, set] = useFilters();
  const q = useQuery({ queryKey: ['site', 'prod-dashboard', qsOf(f)], queryFn: () => st.prodDashboard(qsOf(f)), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('cnd.prd.title')} permission="site.productivity.view" />;
  const d = q.data; const rep = `/site/productivity-report?${qsOf(f)}`;
  return (
    <section aria-labelledby="pd-h" data-testid="site-productivity">
      <PageHeader id="pd-h" title={t('cnd.prd.title')} />
      <ProdFilters t={t} f={f} set={set} projects={d?.projects ?? []} sites={d?.sites ?? []} />
      {q.isPending && <Skeleton label={t('cnd.prd.title')} rows={6} />}
      {q.isError && q.error?.status !== 403 && <ErrorState error={q.error} onRetry={q.refetch} />}
      {d && (
        <>
          {d.records === 0 && d.outlierCount === 0 ? <div className="mdm-panel" data-testid="pd-empty"><h2>{t('cnd.prd.emptyTitle')}</h2><p className="muted">{t('cnd.prd.emptyBody')}</p><Link to="/site/dprs">{t('dpr.register')}</Link> · <Link to="/site/productivity-norms">{t('cnd.prd.norms')}</Link></div> : null}
          <KpiRow data-testid="pd-tiles">
            <Tile label={t('cnd.prd.efficiency')} value={fmtPct(d.efficiency)} status={tone(d.efficiency, d.limit)} hint={t('cnd.prd.limit', { n: d.limit })} to={rep} testId="pd-efficiency" />
            <Tile label={t('cnd.prd.machineEfficiency')} value={fmtPct(d.machineEfficiency)} status={tone(d.machineEfficiency, d.limit)} to={rep} testId="pd-machine" />
            <Tile label={t('cnd.prd.lost')} value={fmtQty(d.lostManDays)} status={d.lostManDays ? 'warning' : 'success'} to={rep} testId="pd-lost" />
            <Tile label={t('cnd.prd.belowNorm')} value={`${d.belowNorm} / ${d.records}`} to={rep} testId="pd-below" />
            <Tile label={t('cnd.prd.alerts')} value={d.alerts.length} status={d.alerts.length ? 'danger' : 'success'} testId="pd-alerts-count" />
            <Tile label={t('cnd.prd.toCheck')} value={d.outlierCount} status={d.outlierCount ? 'warning' : 'success'} testId="pd-outliers-count" />
          </KpiRow>
          <div className="mdm-panel" data-testid="pd-trend"><h2>{t('cnd.prd.trend')}</h2>
            {d.trend.length === 0 ? <p className="muted">{t('cnd.prd.noData')}</p> : <Chart type="line" data={{ categories: d.trend.map((w) => w.week.slice(5)), series: [{ name: t('cnd.prd.efficiency'), values: d.trend.map((w) => w.efficiency) }] }} title={`${t('cnd.prd.trend')} (%)`} />}
          </div>
          <div className="mdm-panel" data-testid="pd-worktype-chart"><h2>{t('cnd.prd.byWorkType')}</h2>
            {d.byWorkType.length === 0 ? <p className="muted">{t('cnd.prd.noData')}</p> : <Chart type="bar" data={{ categories: d.byWorkType.map((r) => r.label.replace('UOM:', '')), series: [{ name: t('cnd.prd.efficiency'), values: d.byWorkType.map((r) => r.efficiency ?? 0) }] }} title={`${t('cnd.prd.byWorkType')} (%)`} />}
          </div>
          <div className="mdm-panel" data-testid="pd-alerts"><h2>{t('cnd.prd.alertList')}</h2>
            {d.alerts.length === 0 ? <p className="muted">{t('cnd.prd.noAlerts')}</p> : <ul>{d.alerts.map((a) => <li key={a.id} data-testid="pd-alert"><StatusBadge status="OVERDUE" label={t('cnd.prd.low')} /> {a.site} · {a.activityCode}: {t('cnd.prd.alertText', { p: fmtPct(a.avgPctOfNorm), n: a.days, a: fmtDate(a.fromDate), b: fmtDate(a.toDate) })} · <Link to={`/site/productivity-records?filter[activity]=${a.activityCode}`}>{t('cnd.prg.open')}</Link></li>)}</ul>}
          </div>
          <div className="mdm-panel" data-testid="pd-worst"><h2>{t('cnd.prd.worst')}</h2>
            {d.worst.length === 0 ? <p className="muted">{t('cnd.prd.noData')}</p> : <ol>{d.worst.map((w) => <li key={w.key} data-testid="pd-worst-row"><Link to={`/site/productivity-records?filter[activity]=${w.key}`}>{w.label}</Link> · {fmtPct(w.efficiency)} · {t('cnd.prd.lostN', { n: fmtQty(w.lostManDays) })}</li>)}</ol>}
          </div>
          <Table t={t} title={t('cnd.prd.byCrew')} rows={d.byCrew} testId="pd-crew" link={() => `/site/productivity-report?${qsOf(f, { groupBy: 'CREW' })}`} />
          <Table t={t} title={t('cnd.prd.byContractor')} rows={d.byContractor} testId="pd-contractor" link={() => `/site/productivity-report?${qsOf(f, { groupBy: 'CONTRACTOR' })}`} />
          <div className="mdm-panel" data-testid="pd-reasons"><h2>{t('cnd.prd.reasons')}</h2>
            {d.reasons.length === 0 ? <p className="muted">{t('cnd.prd.noLoss')}</p> : <ul>{d.reasons.map((r) => <li key={r.reason}>{t(`cnd.prd.r.${r.reason}`)}: {fmtQty(r.lostManDays)} ({fmtPct(r.sharePct)})</li>)}</ul>}<Link to={rep}>{t('cnd.prd.reportLink')}</Link>
          </div>
          <div className="mdm-panel" data-testid="pd-outliers"><h2>{t('cnd.prd.dataCheck')}</h2><p className="muted">{t('cnd.prd.dataCheckHelp')}</p>
            {d.outliers.length === 0 ? <p className="muted">{t('cnd.prd.noOutliers')}</p> : <ul>{d.outliers.map((o) => <li key={o.id}>{fmtDate(o.date)} · {o.site} · {o.activityCode}: {fmtQty(o.qty)} / {fmtQty(o.manDays)} = {t('cnd.prd.timesNorm', { n: o.timesNorm })} · <Link to={`/site/dprs?id=${o.dprId}`}>{o.dprNo}</Link></li>)}</ul>}
          </div>
        </>
      )}
    </section>
  );
}
