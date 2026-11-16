import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, Tile, usePageTitle } from '../core/pages/ui.jsx';
import { an, fmtDate, fmtRs } from './api.js';
import { Bars, ParamPanel } from './AnaParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow } from '../../platform/design/Kpi.jsx';
import { Card, CardGrid } from '../../platform/design/Card.jsx';

// Procurement dashboard (part 15.10, FR-01 to FR-04): the open requisitions, cycle time, orders waiting, overdue deliveries, spend, savings, single-source and emergency shares and open control exceptions; charts of spend and concentration; the four work queues.
// Every tile opens the records it counts; the figures are worked out by the server from live procurement data inside the data scope of the person.
const rs = (paise) => fmtRs((paise ?? 0) / 100);
const trend = (t, p) => (p == null ? null : <span className="muted small" data-testid="an-trend"> {p > 0 ? '▲' : p < 0 ? '▼' : '■'} {Math.abs(p)}% {t('n.vsPrevious')}</span>);

export default function ProcDashboardPage() {
  const t = useT('proc'); usePageTitle(t('n.dashTitle')); const [f, setF] = useState({ projectId: '', from: '', to: '' }); const [open, setOpen] = useState(null);
  const q = useQuery({ queryKey: ['proc', 'an-dash', f], queryFn: () => an.dashboard(f), retry: false }); const tq = useQuery({ queryKey: ['proc', 'an-tasks'], queryFn: an.myTasks, retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('n.dashTitle')} permission="proc.analytics.view" />;
  if (q.isPending) return <Skeleton label={t('n.dashTitle')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const k = d.kpis;
  const tiles = [
    ['openPrs', t('n.openPrs'), k.openPrs.count, 'neutral', `${rs(k.openPrs.value)} · ${t('n.oldest', { n: k.openPrs.oldestDays })}`, k.openPrs.records, '/proc/requisitions'],
    ['cycle', t('n.cycle'), k.cycleTime.avgDays == null ? '—' : `${k.cycleTime.avgDays} ${t('n.days')}`, k.cycleTime.status, `${t('n.target')} ≤ ${k.cycleTime.target} ${t('n.days')}`, null, '/proc/cycle-time', trend(t, k.cycleTime.changePct)],
    ['pending', t('n.posPending'), k.posPending.count, 'neutral', rs(k.posPending.value), k.posPending.records, '/proc/purchase-orders'],
    ['overdue', t('n.overdue'), k.overdueDeliveries.count, k.overdueDeliveries.count ? 'bad' : 'ok', t('n.maxLate', { n: k.overdueDeliveries.maxDays }), k.overdueDeliveries.records, '/proc/po-tracker'],
    ['spendMonth', t('n.spendMonth'), rs(k.spendMonth.value), 'neutral', `${k.spendMonth.count} ${t('n.orders')}`, null, '/proc/spend-analysis', trend(t, k.spendMonth.changePct)],
    ['spendFy', t('n.spendFy'), rs(k.spendFy.value), 'neutral', `${k.spendFy.count} ${t('n.orders')}`, null, '/proc/spend-analysis'],
    ['savings', t('n.savingsBudget'), k.savingsVsBudget.pct == null ? '—' : `${k.savingsVsBudget.pct}%`, k.savingsVsBudget.status, `${rs(k.savingsVsBudget.value)} · ${t('n.target')} ≥ ${k.savingsVsBudget.target}%`, null, '/proc/comparative-statements'],
    ['savingsL2', t('n.savingsL2'), k.savingsVsL2.pct == null ? '—' : `${k.savingsVsL2.pct}%`, 'neutral', rs(k.savingsVsL2.value), null, '/proc/comparative-statements'],
    ['single', t('n.singleSource'), k.singleSource.pct == null ? '—' : `${k.singleSource.pct}%`, k.singleSource.status, `${k.singleSource.count}/${k.singleSource.total} · ${t('n.target')} ≤ ${k.singleSource.target}%`, k.singleSource.records, '/proc/procurement-compliance'],
    ['emergency', t('n.emergency'), k.emergency.pct == null ? '—' : `${k.emergency.pct}%`, k.emergency.status, `${k.emergency.count}/${k.emergency.total} · ${t('n.target')} ≤ ${k.emergency.target}%`, k.emergency.records, '/proc/procurement-compliance'],
    ['exceptions', t('n.exceptions'), k.controlExceptions.visible ? k.controlExceptions.open : '—', k.controlExceptions.visible && k.controlExceptions.open ? 'bad' : 'neutral', k.controlExceptions.visible ? k.controlExceptions.byControl.map((c) => `${c.code}: ${c.count}`).join(' · ') || t('n.none') : t('n.companyOnly'), null, '/proc/procurement-compliance'],
  ];
  const shown = tiles.find((x) => x[0] === open);
  return (
    <section aria-labelledby="pd-h" data-testid="proc-pd"><PageHeader id="pd-h" title={<>{t('n.dashTitle')}{d.project ? ` · ${d.project.code}` : ''}</>} subtitle={<>{t('n.dashIntro')} {fmtDate(d.period.from)} – {fmtDate(d.period.to)}</>} />
      <ParamPanel t={t} value={f} onChange={setF} />
      <div className="actions-row no-print"><Link to="/approvals">{t('n.myActions')}{tq.data != null ? ` (${tq.data})` : ''}</Link><Link to="/proc/spend-analysis">{t('n.spendTitle')}</Link><Link to="/proc/cycle-time">{t('n.cycleTitle')}</Link><Link to="/proc/procurement-compliance">{t('n.complianceTitle')}</Link></div>
      <KpiRow data-testid="pd-tiles">{tiles.map(([id, label, value, status, hint,, , tr]) => <div key={id} className="tile-wrap"><Tile label={label} value={value} status={status} hint={hint} testId={`pd-${id}`} /><button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id} data-testid={`pd-open-${id}`}>{t('n.records')}</button>{tr}</div>)}</KpiRow>
      {shown && <div className="mdm-panel" data-testid="pd-drill"><h2>{shown[1]}</h2>{shown[5]?.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('n.record')}</th><th>{t('n.detail')}</th><th className="num">{t('n.value')}</th></tr></thead><tbody>{shown[5].map((r) => <tr key={r.id} data-testid="pd-drill-row"><td><Link to={r.link}>{r.docNo}</Link></td><td>{r.label}{r.ageDays != null ? ` · ${r.ageDays} ${t('n.days')}` : ''}{r.daysLate != null ? ` · ${r.daysLate} ${t('n.daysLate')}` : ''}</td><td className="num">{r.value == null ? '' : rs(r.value)}</td></tr>)}</tbody></table></div> : <p className="muted">{t('n.noRecordsHere')}</p>}<Link to={shown[6]}>{t('n.openList')}</Link></div>}
      <h2>{t('n.queues')}</h2>
      <CardGrid testid="pd-queues">{Object.entries(d.queues).map(([id, qu]) => <Card key={id} level={3} title={qu.label} subtitle={<><strong data-testid={`pd-queue-${id}-count`}>{qu.count}</strong> · {rs(qu.value)}</>} count={qu.count > qu.records.length ? { shown: qu.records.length, total: qu.count } : null} footer={<Link to={qu.route}>{t('n.openList')} ›</Link>} data-testid={`pd-queue-${id}`}>
        {qu.records.length === 0 ? <p className="muted">{t('n.queueEmpty')}</p> : <ul>{qu.records.map((r) => <li key={r.id}><Link to={r.link}>{r.docNo}</Link> <span className="muted">{r.label}{r.ageDays != null ? ` · ${r.ageDays} ${t('n.days')}` : ''}</span></li>)}</ul>}</Card>)}</CardGrid>
      <h2>{t('n.charts')}</h2>
      {d.charts.byCategory.rows.length === 0 && <div data-testid="pd-empty"><p className="muted">{t('n.emptyBody')}</p></div>}
      <div className="ui-card-grid" data-testid="pd-charts">
        <div className="mdm-panel"><h3>{t('n.byCategory')}</h3><Bars rows={d.charts.byCategory.rows.slice(0, 8)} format={rs} testId="pd-cat" label={t('n.byCategory')} /></div>
        <div className="mdm-panel"><h3>{t('n.byVendor')}</h3><Bars rows={d.charts.byVendor.rows} format={rs} testId="pd-vendor" label={t('n.byVendor')} /><p className="muted" data-testid="pd-concentration">{t('n.concentration', { hhi: d.charts.concentration.hhi, top5: d.charts.concentration.top5Pct })}</p></div>
        <div className="mdm-panel"><h3>{t('n.byProject')}</h3><Bars rows={d.charts.byProject.rows.slice(0, 8)} format={rs} testId="pd-project" label={t('n.byProject')} /></div>
        <div className="mdm-panel"><h3>{t('n.trend')}</h3><Bars rows={d.charts.trend.rows} format={rs} testId="pd-trend" label={t('n.trend')} /></div>
        <div className="mdm-panel"><h3>{t('n.cycleDistribution')}</h3><Bars rows={d.charts.cycleDistribution} format={(v) => String(v)} testId="pd-dist" label={t('n.cycleDistribution')} /></div>
      </div>
    </section>
  );
}
