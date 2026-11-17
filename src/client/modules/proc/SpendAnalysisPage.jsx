import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { an, fmtDate, fmtRs, saveCsv } from './api.js';
import { Bars, ParamPanel } from './AnaParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Spend analysis (part 15.10, FR-02, FR-04): the value of approved purchase orders by category, vendor, project or month in a period, with the share of each row, the orders behind it and a CSV export.
const rs = (paise) => fmtRs((paise ?? 0) / 100);
export default function SpendAnalysisPage() {
  const t = useT('proc'); usePageTitle(t('n.spendTitle')); const [f, setF] = useState({ projectId: '', from: '', to: '' }); const [groupBy, setGroupBy] = useState('category'); const [pick, setPick] = useState(null);
  const q = useQuery({ queryKey: ['proc', 'an-spend', f, groupBy], queryFn: () => an.spend({ ...f, groupBy }), retry: false });
  const dq = useQuery({ queryKey: ['proc', 'an-spend-detail', f, groupBy, pick], queryFn: () => an.spendDetail({ ...f, groupBy, key: pick }), enabled: pick != null, retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('n.spendTitle')} permission="proc.analytics.view" />;
  if (q.isPending) return <Skeleton label={t('n.spendTitle')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return (
    <section aria-labelledby="sp-h" data-testid="proc-sp"><PageHeader id="sp-h" title={t('n.spendTitle')} subtitle={<>{t('n.spendIntro')} {fmtDate(d.period.from)} – {fmtDate(d.period.to)}</>} />
      <ParamPanel t={t} value={f} onChange={(v) => { setF(v); setPick(null); }}>
        <label>{t('n.groupBy')}<select value={groupBy} onChange={(ev) => { setGroupBy(ev.target.value); setPick(null); }} style={{ minHeight: 44 }} data-testid="sp-group">{['category', 'vendor', 'project', 'month'].map((g) => <option key={g} value={g}>{t(`n.g.${g}`)}</option>)}</select></label></ParamPanel>
      {d.rows.length === 0 ? <div data-testid="sp-empty"><h2>{t('n.emptyTitle')}</h2><p className="muted">{t('n.emptyBody')}</p><Link to="/proc/purchase-orders">{t('n.openList')}</Link></div>
        : <>
          <Bars rows={d.rows.slice(0, 12)} format={rs} testId="sp-bars" label={t(`n.g.${groupBy}`)} />
          <div className="table-scroll"><table className="data-table" data-testid="sp-table"><caption>{t(`n.g.${groupBy}`)}</caption><thead><tr><th>{t(`n.g.${groupBy}`)}</th><th className="num">{t('n.orders')}</th><th className="num">{t('n.spend')}</th><th className="num">{t('n.share')}</th><th /></tr></thead>
            <tbody>{d.rows.map((r) => <tr key={r.key} data-testid="sp-row"><td>{r.label}</td><td className="num">{r.count}</td><td className="num">{rs(r.value)}</td><td className="num">{r.sharePct}%</td><td><button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setPick(pick === r.key ? null : r.key)} aria-expanded={pick === r.key} data-testid="sp-open">{t('n.records')}</button></td></tr>)}</tbody>
            <tfoot><tr><th>{t('n.total')}</th><th className="num">{d.rows.reduce((s, r) => s + r.count, 0)}</th><th className="num" data-testid="sp-total">{rs(d.total)}</th><th /><th /></tr></tfoot></table></div>
          {d.concentration && <p className="muted" data-testid="sp-concentration">{t('n.concentration', { hhi: d.concentration.hhi, top5: d.concentration.top5Pct })}</p>}
          {pick != null && <div className="mdm-panel" data-testid="sp-detail"><h2>{t('n.ordersBehind')}</h2>{dq.isPending ? <Skeleton label={t('n.records')} rows={2} /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('n.record')}</th><th>{t('n.detail')}</th><th>{t('n.date')}</th><th className="num">{t('n.value')}</th></tr></thead><tbody>{(dq.data?.rows ?? []).map((r) => <tr key={r.id} data-testid="sp-detail-row"><td><Link to={r.link}>{r.docNo}</Link></td><td>{r.label}</td><td>{fmtDate(r.date)}</td><td className="num">{rs(r.value)}</td></tr>)}</tbody></table></div>}</div>}
          <div className="actions-row no-print"><button type="button" className="btn" onClick={() => saveCsv(`spend-by-${groupBy}.csv`, [[t(`n.g.${groupBy}`), t('n.orders'), t('n.spend'), t('n.share')], ...d.rows.map((r) => [r.label, r.count, r.value / 100, r.sharePct])])} data-testid="sp-export">{t('n.exportCsv')}</button></div>
        </>}
    </section>
  );
}
