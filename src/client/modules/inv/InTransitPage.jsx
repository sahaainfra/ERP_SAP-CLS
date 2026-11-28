import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { fmtDate, fmtQty, fmtRs, saveCsv, tr } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// In-Transit Stock Ageing (part 16.05, FR-04): what has left a store and is not yet in another, or is held as a discrepancy, with its age and value; every row opens its transfer.
export default function InTransitPage() {
  const t = useT('inv'); usePageTitle(t('tr.reportTitle')); const session = useSession(); const perms = session.data?.permissions ?? []; const [storeId, setStoreId] = useState('');
  const oq = useQuery({ queryKey: ['inv', 'transfer-options'], queryFn: tr.options, retry: false }); const rq = useQuery({ queryKey: ['inv', 'in-transit', storeId], queryFn: () => tr.inTransit(storeId ? { storeId } : {}), retry: false });
  if (rq.error?.status === 403) return <NoPermission what={t('tr.reportTitle')} permission="inv.transfer.view" />;
  const d = rq.data;
  return (
    <section aria-labelledby="it-h" data-testid="in-transit"><PageHeader id="it-h" title={t('tr.reportTitle')} subtitle={t('tr.reportIntro')} meta={<Link to="/inv/transfers">{t('tr.title')}</Link>} />
      <div className="mdm-panel no-print"><div className="form-grid"><Field label={t('tr.store')} name="storeId" error={null}><select value={storeId} onChange={(ev) => setStoreId(ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="it-store"><option value="">{t('tr.allStores')}</option>{(oq.data?.stores ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field></div>
        {d && perms.includes('inv.transfer.export') && <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-min)' }} onClick={() => saveCsv('in-transit.csv', [[t('tr.title'), t('item'), t('tr.from'), t('tr.to'), t('tr.dispatched'), t('tr.age'), t('tr.onTheRoad'), t('tr.held'), t('r.value')], ...d.rows.map((x) => [x.docNo, x.item, x.from, x.to, x.dispatchDate, x.ageDays, x.onTheRoadQty, x.heldQty, x.value == null ? '' : x.value / 100])])} data-testid="it-export">{t('i.exportCsv')}</button></div>}</div>
      {rq.isPending ? <Skeleton label={t('tr.reportTitle')} rows={3} /> : rq.isError ? <ErrorState error={rq.error} onRetry={rq.refetch} /> : d.rows.length === 0 ? <div className="mdm-panel" data-testid="it-empty"><h2>{t('tr.itEmptyTitle')}</h2><p>{t('tr.itEmptyBody')}</p></div> : (<>
        <div className="kpi-row" role="list" data-testid="it-ageing">{d.ageing.map((b) => <div key={b.label} role="listitem" className="kpi-tile" data-testid={`it-bucket-${b.label}`}><span className="kpi-value">{b.lines}</span><span className="kpi-label">{b.label} {t('tr.days')} · {fmtQty(b.qty)}{b.value != null ? ` · ${fmtRs(b.value)}` : ''}</span></div>)}</div>
        <p data-testid="it-totals">{t('tr.totalsLine', { n: d.totals.transfers, o: d.totals.overdue, days: d.alertDays })}{d.totals.value != null ? ` · ${fmtRs(d.totals.value)}` : ''}</p>
        <div className="table-scroll"><table className="data-table" data-testid="it-table"><caption>{t('tr.reportTitle')}</caption><thead><tr><th>{t('tr.title')}</th><th>{t('item')}</th><th>{t('tr.from')}</th><th>{t('tr.to')}</th><th>{t('tr.dispatched')}</th><th className="num">{t('tr.age')}</th><th className="num">{t('tr.onTheRoad')}</th><th className="num">{t('tr.held')}</th><th className="num">{t('r.value')}</th></tr></thead>
          <tbody>{d.rows.map((x, i) => <tr key={i} className={x.ageDays > d.alertDays ? 'is-warn' : ''} data-testid={`it-row-${i}`}><td data-label={t('tr.title')}><Link to={`/inv/transfers?id=${x.transferId}`}>{x.docNo}</Link></td><td data-label={t('item')}>{x.item}</td><td data-label={t('tr.from')}>{x.from}</td><td data-label={t('tr.to')}>{x.to}</td><td data-label={t('tr.dispatched')}>{x.dispatchDate ? fmtDate(x.dispatchDate) : '—'}</td><td className="num" data-label={t('tr.age')}>{x.ageDays}</td><td className="num" data-label={t('tr.onTheRoad')}>{fmtQty(x.onTheRoadQty)}</td><td className="num" data-label={t('tr.held')}>{fmtQty(x.heldQty)}</td><td className="num" data-label={t('r.value')}>{x.value == null ? '—' : fmtRs(x.value)}</td></tr>)}</tbody></table></div></>)}
    </section>
  );
}
