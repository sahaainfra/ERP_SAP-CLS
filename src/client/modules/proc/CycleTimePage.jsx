import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, Tile, usePageTitle } from '../core/pages/ui.jsx';
import { an, fmtDate, saveCsv } from './api.js';
import { Bars, ParamPanel } from './AnaParts.jsx';

// Procurement cycle time (part 15.10, FR-01, FR-02): the days from an approved requisition to an approved purchase order, the stages between, the distribution and the slowest orders.
export default function CycleTimePage() {
  const t = useT('proc'); usePageTitle(t('n.cycleTitle')); const [f, setF] = useState({ projectId: '', from: '', to: '' });
  const q = useQuery({ queryKey: ['proc', 'an-cycle', f], queryFn: () => an.cycle(f), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('n.cycleTitle')} permission="proc.analytics.view" />;
  if (q.isPending) return <Skeleton label={t('n.cycleTitle')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const day = (v) => (v == null ? '—' : `${v} ${t('n.days')}`);
  return (
    <section aria-labelledby="ct-h" data-testid="proc-ct"><h1 id="ct-h">{t('n.cycleTitle')}</h1><p className="muted">{t('n.cycleIntro')} {fmtDate(d.period.from)} – {fmtDate(d.period.to)}</p>
      <ParamPanel t={t} value={f} onChange={setF} />
      {d.count === 0 ? <div data-testid="ct-empty"><h2>{t('n.emptyTitle')}</h2><p className="muted">{t('n.cycleEmptyBody')}</p><Link to="/proc/purchase-orders">{t('n.openList')}</Link></div>
        : <>
          <div className="tiles" data-testid="ct-tiles"><Tile label={t('n.avg')} value={day(d.avgDays)} status={d.avgDays > d.target ? 'bad' : 'ok'} hint={`${t('n.target')} ≤ ${d.target} ${t('n.days')}`} testId="ct-avg" /><Tile label={t('n.median')} value={day(d.medianDays)} testId="ct-median" /><Tile label={t('n.slowest')} value={day(d.maxDays)} testId="ct-max" /><Tile label={t('n.orders')} value={d.count} testId="ct-count" /></div>
          <div className="table-scroll"><table className="data-table" data-testid="ct-stages"><caption>{t('n.stages')}</caption><thead><tr><th>{t('n.stage')}</th><th className="num">{t('n.avgDays')}</th></tr></thead><tbody>{d.stages.map((s) => <tr key={s.key}><td>{s.label}</td><td className="num">{s.avgDays ?? '—'}</td></tr>)}</tbody></table></div>
          <div className="mdm-panel"><h2>{t('n.cycleDistribution')}</h2><Bars rows={d.distribution} format={(v) => String(v)} testId="ct-dist" label={t('n.cycleDistribution')} /></div>
          <div className="table-scroll"><table className="data-table" data-testid="ct-rows"><caption>{t('n.slowestOrders')}</caption><thead><tr><th>{t('n.record')}</th><th>{t('n.detail')}</th><th className="num">{t('n.days')}</th></tr></thead><tbody>{d.rows.map((r) => <tr key={r.id} data-testid="ct-row"><td><Link to={r.link}>{r.docNo}</Link></td><td>{r.label}</td><td className="num">{r.days}</td></tr>)}</tbody></table></div>
          <div className="actions-row no-print"><button type="button" className="btn" onClick={() => saveCsv('procurement-cycle-time.csv', [[t('n.record'), t('n.detail'), t('n.days')], ...d.rows.map((r) => [r.docNo, r.label, r.days])])} data-testid="ct-export">{t('n.exportCsv')}</button></div>
        </>}
    </section>
  );
}
