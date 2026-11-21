import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import { Card, CardGrid } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { downloadReport } from './api.js';

// Part 27.06: daily execution intelligence (overview page, UI v3 §3.4) and the work-done / WIP valuation report. Every figure comes from the
// daily snapshots of approved DPRs (GET /bi/execution); the budget cost and margin are hidden for roles without bi.execution.cost.

const read = async (path) => (await api.get(path)).data;
const qs = (o) => { const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)); const s = p.toString(); return s ? `?${s}` : ''; };
const go = (patch) => {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) p.delete(k); else p.set(k, String(v)); }
  navigateTo(`/bi/execution${p.toString() ? `?${p}` : ''}`);
};

function Filters({ options, search, date }) {
  const t = useT('ex');
  const projectId = search.get('projectId') ?? '';
  const sites = options.sites.filter((s) => !projectId || String(s.projectId) === projectId);
  return <div className="actions-row" data-testid="ex-filters">
    <Field name="ex-project" label={t('f.project')}><select value={projectId} onChange={(e) => go({ projectId: e.target.value, siteId: '' })}><option value="">{t('f.all')}</option>{options.projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
    <Field name="ex-site" label={t('f.site')}><select value={search.get('siteId') ?? ''} onChange={(e) => go({ siteId: e.target.value })}><option value="">{t('f.all')}</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select></Field>
    <Field name="ex-date" label={t('f.date')}><input type="date" value={date} onChange={(e) => go({ date: e.target.value })} /></Field>
  </div>;
}

function Overview({ d }) {
  const t = useT('ex');
  const { money, number } = useFormat();
  const inr = (v) => (v == null ? '—' : money(String(v)));
  const n = (v, dec = 0) => (v == null ? '—' : number(String(v), { decimals: dec }));
  const T = d.tiles;
  const pct = T.planned ? Math.round((T.executed * 1000) / T.planned) / 10 : null;
  const trend = { categories: d.trend.map((r) => r.date.slice(5)), series: [{ name: t('t.planned'), values: d.trend.map((r) => r.planned ?? 0) }, { name: t('t.executed'), values: d.trend.map((r) => r.executed ?? 0),
    drill: d.trend.map((r) => `/bi/execution?date=${r.date}`) }], unit: '₹' };
  return <>
    <KpiRow testid="ex-tiles" label={t('tab.overview')}>
      <KpiTile testid="ex-tile-executed" valueTestid="ex-executed" label={t('t.executed')} kind="money" amount={T.executed} value={inr(T.executed)} tone={pct == null ? 'neutral' : pct < 80 ? 'warning' : 'success'}
        trend={T.previousExecuted != null ? { previous: T.previousExecuted, better: 'up', label: t('vsYesterday') } : undefined} to={`/bi/execution?tab=valuation&date=${d.date}`}>{pct == null ? null : `${n(pct, 1)}% ${t('vsPlan')}`}</KpiTile>
      <KpiTile label={t('t.planned')} kind="money" amount={T.planned} value={inr(T.planned)} to={`/bi/execution?tab=valuation&date=${d.date}`} />
      <KpiTile testid="ex-tile-wip" label={t('t.wip')} kind="money" amount={T.wip} value={inr(T.wip)} tone={T.wip ? 'warning' : 'neutral'} to="/bill/qty-recon" />
      <KpiTile label={t('t.billedGap')} kind="money" amount={T.billedGap} value={inr(T.billedGap)} to="/bill/qs-dashboard" />
      <KpiTile label={t('t.cumulative')} kind="money" amount={T.cumulative} value={inr(T.cumulative)} to="/bill/qty-recon" />
      <KpiTile label={t('t.balance')} kind="money" amount={T.balance} value={inr(T.balance)} to="/bill/qty-recon" />
      <KpiTile testid="ex-tile-cost" label={t('t.cost')} kind="money" amount={T.cost ?? undefined} value={d.costVisible ? inr(T.cost) : t('masked')} />
      <KpiTile label={t('t.margin')} kind="money" amount={T.margin ?? undefined} value={d.costVisible ? inr(T.margin) : t('masked')} tone={T.margin != null && T.margin < 0 ? 'error' : 'neutral'}>{T.marginPct != null ? `${n(T.marginPct, 1)}%` : null}</KpiTile>
      <KpiTile label={t('t.labour')} kind="people" value={n(T.labour)} to={`/site/dprs?date=${d.date}`} />
      <KpiTile label={t('t.plant')} kind="time" value={n(T.plantHours, 1)} unit="h" to={`/site/dprs?date=${d.date}`} />
      <KpiTile label={t('t.hindrances')} kind="risk" value={n(T.hindrances)} tone={T.hindrances ? 'warning' : 'success'} to="/site/hindrances" />
      <KpiTile label={t('t.rfis')} kind="count" value={`${n(T.rfisRaised)} / ${n(T.rfisAnswered)}`} to="/engg/rfis" />
    </KpiRow>
    <CardGrid testid="ex-cards">
      <Card title={t('c.trend')} subtitle={t('c.trendSub')} viewAll={`/bi/execution?tab=valuation&date=${d.date}`} viewAllLabel={t('viewAll')} testid="ex-card-trend">
        <Chart type="line" data={trend} title={t('c.trend')} onDrill={(to) => navigateTo(to)} exportName="work-done-trend" />
      </Card>
      <Card title={t('c.exceptions')} count={{ shown: Math.min(d.exceptions.length, 10), total: d.exceptions.length }} testid="ex-card-exceptions" viewAll="/site/hindrances" viewAllLabel={t('viewAll')}>
        {d.exceptions.length === 0 ? <EmptyState compact title={t('c.noExceptions')} /> : <ul className="wd-todo">{d.exceptions.slice(0, 10).map((x) => <li key={`${x.kind}${x.site}`} data-kind={x.kind}>
          <StatusBadge status={x.kind === 'BEHIND_PLAN' ? 'AT_RISK' : 'RETURNED'} label={x.kind === 'BEHIND_PLAN' ? t('m.achieved') : t('m.hindrances')} size="sm" /> <Link to={x.route}>{t(`x.${x.kind}`, { site: x.site, project: x.project, pct: x.achievedPct, count: x.count })}</Link></li>)}</ul>}
      </Card>
    </CardGrid>
    <Card title={t('c.sites')} testid="ex-card-sites">
      {d.sites.length === 0 ? <EmptyState title={t('m.empty')} message={t('m.emptyBody')} action={<Link to="/site/dprs">{t('m.dprs')}</Link>} />
        : <div className="table-scroll"><table className="data-table" data-testid="ex-sites">
          <thead><tr><th>{t('m.site')}</th><th>{t('m.project')}</th><th className="num">{t('m.planned')}</th><th className="num">{t('m.executed')}</th><th className="num">{t('m.achieved')}</th>{d.costVisible && <th className="num">{t('m.cost')}</th>}<th className="num">{t('m.labour')}</th><th className="num">{t('m.plant')}</th><th className="num">{t('m.hindrances')}</th></tr></thead>
          <tbody>{d.sites.map((s) => <tr key={s.siteId} data-testid="ex-site-row" data-site={s.siteId}>
            <td data-label={t('m.site')}><Link to={s.valuation}>{s.site}</Link></td><td data-label={t('m.project')}>{s.project}</td>
            <td data-label={t('m.planned')} className="num">{inr(s.planned)}</td><td data-label={t('m.executed')} className="num">{inr(s.executed)}</td>
            <td data-label={t('m.achieved')} className="num">{s.achievedPct == null ? '—' : `${n(s.achievedPct, 1)}%`}</td>
            {d.costVisible && <td data-label={t('m.cost')} className="num">{inr(s.cost)}</td>}
            <td data-label={t('m.labour')} className="num">{n(s.labour)}</td><td data-label={t('m.plant')} className="num">{n(s.plantHours, 1)}</td>
            <td data-label={t('m.hindrances')} className="num">{s.hindrances ? <Link to={`/site/hindrances?siteId=${s.siteId}`}>{s.hindrances}</Link> : 0}</td>
          </tr>)}</tbody>
        </table></div>}
    </Card>
  </>;
}

function Valuation({ search, date, canExport }) {
  const t = useT('ex');
  const { money, number } = useFormat();
  const inr = (v) => (v == null ? '—' : money(String(v)));
  const projectId = search.get('projectId'); const siteId = search.get('siteId');
  const params = { projectId, siteId, date };
  const q = useQuery({ queryKey: ['bi', 'valuation', params], queryFn: () => read(`/bi/execution/valuation${qs(params)}`), enabled: Boolean(projectId), retry: false });
  const [format, setFormat] = useState('xlsx');
  const download = useMutation({ mutationFn: () => downloadReport(`/api/v1/bi/execution/valuation/export${qs({ ...params, format })}`, `work-done.${format}`) });
  if (!projectId) return <EmptyState title={t('v.choose')} message={t('v.chooseBody')} />;
  if (q.isPending) return <Skeleton label={t('valuationTitle')} rows={5} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const v = q.data;
  if (!v.captured || !v.items.length) return <EmptyState title={t('m.empty')} message={t('m.emptyBody')} action={<Link to="/site/dprs">{t('m.dprs')}</Link>} />;
  return <>
    {canExport && <div className="actions-row"><label className="sr-only" htmlFor="ex-format">{t('format')}</label>
      <select id="ex-format" value={format} onChange={(e) => setFormat(e.target.value)}>{['xlsx', 'csv', 'pdf'].map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}</select>
      <button type="button" className="btn" onClick={() => download.mutate()} disabled={download.isPending} data-testid="ex-export">{t('export')}</button></div>}
    {download.error && <ErrorState error={download.error} />}
    <KpiRow>
      <KpiTile label={t('t.executed')} kind="money" amount={v.totals.executed} value={inr(v.totals.executed)} />
      <KpiTile label={t('t.planned')} kind="money" amount={v.totals.planned} value={inr(v.totals.planned)} />
      {v.totals.wip != null && <KpiTile label={t('t.wip')} kind="money" amount={v.totals.wip} value={inr(v.totals.wip)} />}
      <KpiTile label={t('t.cost')} kind="money" amount={v.totals.cost ?? undefined} value={v.costVisible ? inr(v.totals.cost) : t('masked')} />
    </KpiRow>
    <div className="table-scroll"><table className="data-table" data-testid="ex-valuation">
      <thead><tr><th>{t('v.item')}</th><th>{t('v.description')}</th><th className="num">{t('v.qty')}</th><th className="num">{t('v.rate')}</th><th className="num">{t('v.value')}</th>{v.costVisible && <><th className="num">{t('v.cost')}</th><th className="num">{t('v.margin')}</th></>}<th>{t('v.dprs')}</th></tr></thead>
      <tbody>{v.items.map((it) => <tr key={it.code} data-testid="ex-valuation-row" data-code={it.code}>
        <td data-label={t('v.item')}>{it.code}</td><td data-label={t('v.description')}>{it.description}</td>
        <td data-label={t('v.qty')} className="num">{number(String(it.qty), { decimals: 3 })} {it.uom}</td><td data-label={t('v.rate')} className="num">{inr(it.rate)}</td>
        <td data-label={t('v.value')} className="num">{inr(it.value)}</td>
        {v.costVisible && <><td data-label={t('v.cost')} className="num">{inr(it.cost)}</td><td data-label={t('v.margin')} className="num">{inr(it.margin)}</td></>}
        <td data-label={t('v.dprs')}>{it.dprs.map((x) => <Link key={x.id} to={x.route}>{x.no}</Link>)}</td>
      </tr>)}</tbody>
    </table></div>
  </>;
}

export function ExecutionIntelligence() {
  const t = useT('ex');
  const { dateTime, date: fmtDate } = useFormat();
  const search = useSearch();
  const tab = search.get('tab') === 'valuation' ? 'valuation' : 'overview';
  usePageTitle(tab === 'valuation' ? t('valuationTitle') : t('title'));
  const filters = { projectId: search.get('projectId') ?? '', siteId: search.get('siteId') ?? '', date: search.get('date') ?? '' };
  const q = useQuery({ queryKey: ['bi', 'execution', filters], queryFn: () => read(`/bi/execution${qs(filters)}`), retry: false, placeholderData: (p) => p });
  const run = useMutation({ mutationFn: (day) => api.post('/bi/execution/captures', { date: day, ...(filters.projectId ? { projectId: Number(filters.projectId) } : {}) }, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } }) });
  if (q.error?.status === 403) return <NoPermission what={t('noPermission')} permission="bi.execution.view" />;
  if (q.isPending) return <section><PageHeader title={t('title')} /><Skeleton label={t('title')} rows={6} /></section>;
  if (q.error) return <section><PageHeader title={t('title')} /><ErrorState error={q.error} onRetry={q.refetch} /></section>;
  const d = q.data;
  return <section aria-labelledby="ex-h" data-testid="bi-execution">
    <PageHeader id="ex-h" title={tab === 'valuation' ? t('valuationTitle') : t('title')}
      subtitle={d.lastCapturedAt ? t('asOf', { date: fmtDate(d.date), time: dateTime(d.lastCapturedAt) }) : t('notCaptured')}
      actions={d.can.run && <button type="button" className="btn" onClick={() => run.mutate(d.date)} disabled={run.isPending} data-testid="ex-recompute">{t('recompute')}</button>} />
    {run.isSuccess && <p role="status">{t('queued')}</p>}
    {run.error && <ErrorState error={run.error} />}
    <div role="tablist" aria-label={t('title')} className="tabs" data-testid="ex-tabs">
      {['overview', 'valuation'].map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => go({ tab: k === 'overview' ? '' : k })}>{t(`tab.${k}`)}</button>)}
    </div>
    <Filters options={d.options} search={search} date={d.date} />
    {tab === 'overview' ? <Overview d={d} /> : <Valuation search={search} date={d.date} canExport={d.can.export} />}
  </section>;
}
