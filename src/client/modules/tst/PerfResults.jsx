import { useMutation, useQuery } from '@tanstack/react-query';
import Chart from '../../platform/charts/Chart.jsx';
import { Card, CardGrid } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { Pager, ParamPanel, TONE, download, go, qs, read } from './common.jsx';

// Part 30.06: Performance Test Results (technical console, report pattern). The verdict of the latest load and soak runs heads the page;
// the chart of p95 by SLO kind over the runs comes first, then the SLOs (parameters, changed through the control center's maker-checker),
// the selected run's journeys against their SLOs (cards on a phone, sticky total) with the memory of the server over the run, and the runs.
const BASE = '/admin/performance-tests';
const KINDS = ['LIST', 'RECORD', 'SAVE', 'REPORT', 'REALTIME', 'BURST'];

export function PerfResults() {
  const t = useT('tst');
  const { number, dateTime } = useFormat();
  const search = useSearch();
  usePageTitle(t('pf.title'));
  const params = { profile: search.get('profile') ?? '', result: search.get('result') ?? '', run: search.get('run') ?? '', page: search.get('page') ?? '' };
  const q = useQuery({ queryKey: ['tst', 'perf', params], queryFn: () => read(`/tst/perf${qs(params)}`), retry: false, placeholderData: (p) => p });
  const exp = useMutation({ mutationFn: ([id, f]) => download(`/tst/perf/runs/${id}/export`, { format: f }, `performance.${f}`) });
  const n = (v, d = 0) => (v == null ? '—' : number(String(v), { decimals: d }));
  const set = (patch) => go(BASE, { ...patch, page: patch.page ?? '' });

  if (q.error?.status === 403) return <NoPermission what={t('pf.noPermission')} permission="tst.perf.view" />;
  if (q.isPending) return <section><PageHeader title={t('pf.title')} /><Skeleton label={t('pf.title')} rows={8} /></section>;
  if (q.error) return <section><PageHeader title={t('pf.title')} /><ErrorState error={q.error} onRetry={q.refetch} /></section>;
  const d = q.data; const S = d.slos; const sel = d.selected;
  const menu = sel && d.can.export ? ['xlsx', 'csv', 'pdf'].map((f) => ({ label: t('exportAs', { f: f.toUpperCase() }), testid: `pf-export-${f}`, onClick: () => exp.mutate([sel.id, f]) })) : [];
  const header = <PageHeader id="pf-h" title={t('pf.title')} subtitle={t('pf.subtitle')} menu={menu} status={<StatusBadge status={TONE[d.verdict]} label={t(`pf.verdict.${d.verdict}`)} variant="solid" />} />;
  if (!d.runs.total) return <section aria-labelledby="pf-h" data-testid="tst-perf">{header}<EmptyState title={t('pf.none')} message={t('pf.noneBody')} /></section>;
  const trend = { categories: d.trend.map((r) => r.runNo), series: KINDS.filter((k) => d.trend.some((r) => r[k] != null)).map((k) => ({ name: t(`pf.kind.${k}`), values: d.trend.map((r) => (r[k] == null ? 0 : Number(r[k]))), drill: d.trend.map((r) => `${BASE}?run=${r.id}`) })) };
  const L = d.last.LOAD; const K = d.last.SOAK;
  const sloOf = { LIST: S.LIST, RECORD: S.RECORD, SAVE: S.SAVE, REPORT: S.REPORT, REALTIME: S.REALTIME, BURST: S.SAVE };
  const memChart = sel?.memory?.length ? { categories: sel.memory.map((m) => `${Math.round(m.t / 60)}′`), series: [{ name: t('pf.rss'), values: sel.memory.map((m) => m.rssMb) }] } : null;
  const failed = sel ? sel.results.filter((x) => x.status === 'FAIL').length : 0;
  return <section aria-labelledby="pf-h" data-testid="tst-perf" data-verdict={d.verdict}>
    {header}
    {exp.error && <ErrorState error={exp.error} />}
    <Card title={t('pf.trend')} subtitle={t('pf.trendNote')} testid="pf-chart"><Chart type="line" data={trend} title={t('pf.trend')} onDrill={(to) => navigateTo(to)} exportName="performance-p95-by-kind" /></Card>
    <KpiRow testid="pf-tiles" label={t('pf.title')}>
      <KpiTile testid="pf-load" label={t('pf.lastLoad')} kind="quality" value={L ? t(`st.${L.result}`) : '—'} tone={L?.result === 'PASS' ? 'success' : L ? 'error' : 'neutral'} to={L ? `${BASE}?run=${L.id}` : BASE}>{L ? t('pf.runFacts', { run: L.runNo, users: n(L.users), requests: n(L.requests), errors: n(L.errors) }) : t('pf.notRun')}</KpiTile>
      <KpiTile testid="pf-soak" label={t('pf.lastSoak')} kind="quality" value={K ? t(`st.${K.result}`) : '—'} tone={K?.result === 'PASS' ? 'success' : K ? 'error' : 'warning'} to={K ? `${BASE}?run=${K.id}` : BASE}>{K ? t('pf.soakFacts', { hours: n(K.durationS / 3600, 1), growth: n(K.growthPct, 1) }) : t('pf.notRun')}</KpiTile>
      <KpiTile testid="pf-burst" label={t('pf.burst')} kind="count" value={n(S.BURST_PER_MIN)} unit={t('pf.perMin')}>{t('pf.burstNote')}</KpiTile>
      <KpiTile testid="pf-memory" label={t('pf.memoryMax')} kind="count" value={n(sel?.rss.max)} unit="MB">{sel ? t('pf.memoryOf', { start: n(sel.rss.start), end: n(sel.rss.end) }) : ''}</KpiTile>
    </KpiRow>
    <CardGrid>
      <Card title={t('pf.slos')} subtitle={t('pf.slosNote')} testid="pf-slos">
        <ul className="lp-list" data-testid="pf-slo-list">{['LIST', 'RECORD', 'SAVE', 'REPORT', 'REALTIME'].map((k) => <li key={k}><strong>{t(`pf.kind.${k}`)}</strong> ≤ {n(S[k])} ms {t('pf.atP95')}</li>)}<li><strong>{t('pf.kind.BURST')}</strong> {n(S.BURST_PER_MIN)} {t('pf.perMin')}</li><li><strong>{t('pf.soakGrowth')}</strong> ≤ {n(S.SOAK_GROWTH_PCT)} %</li></ul>
        {d.can.parameters && <p className="small"><Link to="/admin/control?tab=change">{t('pf.changeSlo')}</Link></p>}
      </Card>
      {memChart && <Card title={t('pf.memory')} subtitle={t('pf.memoryNote', { run: sel.runNo })} testid="pf-memory-chart"><Chart type="line" data={memChart} title={t('pf.memory')} exportName={`memory-${sel.runNo}`} /></Card>}
    </CardGrid>
    {sel && <Card title={t('pf.journeys', { run: sel.runNo })} subtitle={`${t(`pf.profile.${sel.profile}`)} · ${sel.tool} · ${sel.environment} · ${dateTime(sel.startedAt)} · ${n(sel.durationS)} s`} testid="pf-selected"
      menu={<StatusBadge status={TONE[sel.result]} label={t(`st.${sel.result}`)} size="sm" />}>
      {sel.machine && <p className="muted small" data-testid="pf-machine">{sel.machine}</p>}
      <div className="table-scroll"><table className="data-table" data-testid="pf-results" data-run={sel.runNo}>
        <thead><tr><th>{t('pf.model')}</th><th>{t('pf.journey')}</th><th className="num">{t('pf.requests')}</th><th className="num">p50</th><th className="num">p95</th><th className="num">p99</th><th className="num">{t('pf.slo')}</th><th className="num">{t('pf.rate')}</th><th>{t('status')}</th></tr></thead>
        <tbody>{sel.results.map((x) => <tr key={x.id} data-testid="pf-result" data-kind={x.sloKind} data-status={x.status}>
          <td data-label={t('pf.model')}>{t(`pf.model.${x.model}`)}</td><td data-label={t('pf.journey')}>{x.journey}<br /><span className="muted small">{t(`pf.kind.${x.sloKind}`)}{x.errors ? ` · ${t('pf.errorsN', { n: n(x.errors) })}` : ''}</span></td>
          <td data-label={t('pf.requests')} className="num">{n(x.requests)}</td><td data-label="p50" className="num">{n(x.p50, 1)}</td><td data-label="p95" className="num"><strong>{n(x.p95, 1)}</strong></td><td data-label="p99" className="num">{n(x.p99, 1)}</td>
          <td data-label={t('pf.slo')} className="num">{n(x.sloMs)}</td><td data-label={t('pf.rate')} className="num">{n(x.throughputRps, 1)}{x.targetRps ? ` / ${n(x.targetRps, 1)}` : ''}</td>
          <td data-label={t('status')}><StatusBadge status={TONE[x.status]} label={t(`st.${x.status}`)} size="sm" /></td>
        </tr>)}</tbody>
        <tfoot className="sticky-total"><tr><th scope="row" colSpan={2}>{t('pf.total', { n: n(sel.results.length), failed: n(failed) })}</th><td className="num" data-label={t('pf.requests')}>{n(sel.requests)}</td><td colSpan={5} className="small" data-label={t('pf.errors')}>{t('pf.errorsN', { n: n(sel.errors) })}</td><td data-label={t('status')}><StatusBadge status={TONE[sel.result]} label={t(`st.${sel.result}`)} size="sm" /></td></tr></tfoot>
      </table></div>
      <p className="small muted">{t('pf.sloOf', { list: n(sloOf.LIST), record: n(sloOf.RECORD), save: n(sloOf.SAVE) })}</p>
    </Card>}
    <Card title={t('pf.runs')} testid="pf-runs">
      <ParamPanel label={t('params')} done={t('done')} count={[params.profile, params.result].filter(Boolean).length} testid="pf-params">
        <Field name="pf-profile" label={t('pf.profileH')}><select value={params.profile} onChange={(e) => set({ profile: e.target.value })} data-testid="pf-f-profile"><option value="">{t('all')}</option>{['SMOKE', 'LOAD', 'STRESS', 'SOAK'].map((p) => <option key={p} value={p}>{t(`pf.profile.${p}`)}</option>)}</select></Field>
        <Field name="pf-result" label={t('status')}><select value={params.result} onChange={(e) => set({ result: e.target.value })} data-testid="pf-f-result"><option value="">{t('all')}</option>{['PASS', 'FAIL'].map((p) => <option key={p} value={p}>{t(`st.${p}`)}</option>)}</select></Field>
      </ParamPanel>
      {!d.runs.rows.length ? <EmptyState compact title={t('pf.noRuns')} message={t('pf.noRunsBody')} /> : <>
        <div className="table-scroll"><table className="data-table" data-testid="pf-run-table">
          <thead><tr><th>{t('pf.run')}</th><th>{t('pf.profileH')}</th><th className="num">{t('pf.users')}</th><th className="num">{t('pf.requests')}</th><th className="num">{t('pf.memoryMax')}</th><th>{t('sb.at')}</th><th>{t('status')}</th></tr></thead>
          <tbody>{d.runs.rows.map((r) => <tr key={r.id} data-testid="pf-run" data-profile={r.profile} data-result={r.result}>
            <td data-label={t('pf.run')}><a href={`${BASE}?run=${r.id}`} onClick={(e) => { e.preventDefault(); set({ run: r.id }); }}>{r.runNo}</a></td>
            <td data-label={t('pf.profileH')}>{t(`pf.profile.${r.profile}`)} · {r.tool}</td><td data-label={t('pf.users')} className="num">{n(r.users)}</td><td data-label={t('pf.requests')} className="num">{n(r.requests)}</td>
            <td data-label={t('pf.memoryMax')} className="num">{n(r.rss.max)}{r.growthPct != null ? <><br /><span className="small muted">{t('pf.growth', { pct: n(r.growthPct, 1) })}</span></> : null}</td>
            <td data-label={t('sb.at')}>{dateTime(r.startedAt)}</td><td data-label={t('status')}><StatusBadge status={TONE[r.result]} label={t(`st.${r.result}`)} size="sm" /></td>
          </tr>)}</tbody>
          <tfoot className="sticky-total"><tr><th scope="row" colSpan={6}>{t('pf.runsTotal', { n: n(d.runs.total) })}</th><td data-label={t('status')}>{t('pf.passOf', { pass: n(d.runs.rows.filter((r) => r.result === 'PASS').length), n: n(d.runs.rows.length) })}</td></tr></tfoot>
        </table></div>
        <Pager page={d.runs.page} pageSize={d.runs.pageSize} total={d.runs.total} onPage={(p) => set({ page: p })} t={t} testid="pf-pager" />
      </>}
    </Card>
  </section>;
}
