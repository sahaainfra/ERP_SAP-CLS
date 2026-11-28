import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { Bars } from '../proc/AnaParts.jsx';
import { fmtRs, iv, saveCsv } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Stock valuation (part 16.01, FR-05): the value of the stock by store, project (owner) or item category, at the moving weighted average or FIFO value of each store.
export default function StockValuationPage() {
  const t = useT('inv'); usePageTitle(t('valuationTitle')); const [groupBy, setGroupBy] = useState('store'); const q = useQuery({ queryKey: ['inv', 'valuation', groupBy], queryFn: () => iv.valuation({ groupBy }), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('valuationTitle')} permission="inv.stock.values" />;
  if (q.isPending) return <Skeleton label={t('valuationTitle')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return (
    <section aria-labelledby="vl-h" data-testid="inv-vl"><PageHeader id="vl-h" title={t('valuationTitle')} subtitle={t('valuationIntro')} />
      <div className="mdm-panel no-print" data-testid="vl-params"><label>{t('groupBy')}<select value={groupBy} onChange={(ev) => setGroupBy(ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="vl-group">{['store', 'project', 'category'].map((g) => <option key={g} value={g}>{t(`g.${g}`)}</option>)}</select></label></div>
      {d.rows.length === 0 ? <div data-testid="vl-empty"><h2>{t('emptyTitle')}</h2><p className="muted">{t('emptyBody')}</p><Link to="/inv/posting">{t('postingTitle')}</Link></div> : <>
        <Bars rows={d.rows.slice(0, 12)} format={fmtRs} testId="vl-bars" label={t(`g.${groupBy}`)} />
        <div className="table-scroll"><table className="data-table" data-testid="vl-table"><caption>{t(`g.${groupBy}`)}</caption><thead><tr><th>{t(`g.${groupBy}`)}</th><th className="num">{t('items')}</th><th className="num">{t('value')}</th><th className="num">{t('share')}</th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.key} data-testid="vl-row"><td>{r.label}</td><td className="num">{r.items}</td><td className="num">{fmtRs(r.value)}</td><td className="num">{r.sharePct}%</td></tr>)}</tbody><tfoot><tr><th>{t('total')}</th><th className="num">{d.lines}</th><th className="num" data-testid="vl-total">{fmtRs(d.total)}</th><th /></tr></tfoot></table></div>
        <div className="actions-row no-print"><button type="button" className="btn" onClick={() => saveCsv(`stock-valuation-by-${groupBy}.csv`, [[t(`g.${groupBy}`), t('items'), t('value'), t('share')], ...d.rows.map((r) => [r.label, r.items, r.value / 100, r.sharePct])])} data-testid="vl-export">{t('exportCsv')}</button></div></>}
    </section>
  );
}
