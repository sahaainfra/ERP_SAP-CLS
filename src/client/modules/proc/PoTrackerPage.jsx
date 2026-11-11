import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, Tile, usePageTitle } from '../core/pages/ui.jsx';
import { fmtDate, fmtQty, pc } from './api.js';

// Open PO and delivery tracker (part 15.05, FR-06, FR-09): every open delivery by due date with the days overdue, filtered by project or overdue only, and the delivery performance of each vendor (on time, quantity, quality) from the receipts.
export default function PoTrackerPage() {
  const t = useT('proc'); usePageTitle(t('o.trackerTitle')); const [projectId, setProjectId] = useState(''); const [overdue, setOverdue] = useState(false);
  const pq = useQuery({ queryKey: ['proc', 'projects'], queryFn: pc.projects, retry: false });
  const qs = [projectId && `projectId=${projectId}`, overdue && 'overdueOnly=true'].filter(Boolean).join('&');
  const q = useQuery({ queryKey: ['proc', 'po-tracker', qs], queryFn: () => pc.tracker(qs), retry: false });
  const fq = useQuery({ queryKey: ['proc', 'po-perf'], queryFn: pc.performance, retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('o.trackerTitle')} permission="proc.purchase_order.view" />;
  if (q.isPending) return <Skeleton label={t('o.trackerTitle')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return (
    <section aria-labelledby="trk-h" data-testid="proc-po-tracker"><h1 id="trk-h">{t('o.trackerTitle')}</h1><p className="muted">{t('o.trackerIntro')}</p>
      <div className="actions-row no-print"><label>{t('o.project')} <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ minHeight: 44 }} data-testid="trk-project"><option value="">{t('o.all')}</option>{(pq.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></label>
        <label><input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} data-testid="trk-overdue" /> {t('o.overdueOnly')}</label><Link to="/proc/purchase-orders">{t('o.title')}</Link></div>
      <div className="tiles" data-testid="trk-summary"><Tile label={t('o.openDeliveries')} value={String(d.summary.open)} testId="trk-open" /><Tile label={t('o.overdueDeliveries')} value={String(d.summary.overdue)} status={d.summary.overdue ? 'bad' : 'neutral'} testId="trk-overdue-n" /><Tile label={t('o.openOrders')} value={String(d.summary.orders)} /><Tile label={t('o.unacknowledged')} value={String(d.summary.unacknowledged)} status={d.summary.unacknowledged ? 'warn' : 'neutral'} /></div>
      {d.rows.length === 0 ? <p className="muted" data-testid="trk-empty">{t('o.trackerEmpty')}</p> : (
        <div className="table-scroll"><table className="data-table" data-testid="trk-table"><thead><tr><th>{t('o.dueDate')}</th><th>{t('o.order')}</th><th>{t('o.vendor')}</th><th>{t('o.item')}</th><th className="num">{t('o.qty')}</th><th className="num">{t('o.received')}</th><th className="num">{t('o.balance')}</th><th>{t('o.days')}</th></tr></thead>
          <tbody>{d.rows.map((x, i) => <tr key={i} data-testid="trk-row" data-overdue={x.overdue ? '1' : '0'}><td>{fmtDate(x.dueDate)}</td><td><Link to={`/proc/purchase-orders?id=${x.poId}`}>{x.docNo}</Link> {!x.acknowledged && <StatusBadge status="RETURNED" label={t('o.notAck')} />}</td><td>{x.vendor}</td><td>{x.lineNo}. {x.description}</td><td className="num">{fmtQty(x.qty)} {x.uom}</td><td className="num">{fmtQty(x.receivedQty)}</td><td className="num">{fmtQty(x.balanceQty)}</td><td>{x.overdue ? <StatusBadge status="REJECTED" label={t('o.lateBy', { n: x.daysOverdue })} /> : t('o.onTrack')}</td></tr>)}</tbody></table></div>)}
      {fq.data && fq.data.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="trk-performance"><caption>{t('o.performance')}</caption><thead><tr><th>{t('o.vendor')}</th><th className="num">{t('o.orders')}</th><th className="num">{t('o.receipts')}</th><th className="num">{t('o.onTimePct')}</th><th className="num">{t('o.qtyPct')}</th><th className="num">{t('o.qualityPct')}</th></tr></thead>
        <tbody>{fq.data.map((v) => <tr key={v.vendorId} data-testid="trk-perf-row"><td>{v.name}</td><td className="num">{v.orders}</td><td className="num">{v.receipts}</td><td className="num">{v.onTimePct ?? '—'}</td><td className="num">{v.quantityPct ?? '—'}</td><td className="num">{v.qualityPct ?? '—'}</td></tr>)}</tbody></table></div>}
    </section>
  );
}
