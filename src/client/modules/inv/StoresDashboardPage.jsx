import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, Tile, usePageTitle } from '../core/pages/ui.jsx';
import { Bars } from '../proc/AnaParts.jsx';
import { fmtDate, fmtQty, fmtRs, iv } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow } from '../../platform/design/Kpi.jsx';

// Stores dashboard (part 16.01): stock value by store, items below their reorder level, the age of the stock, what waits for approval, the latest movements and the state of the books (balances against the ledger).
export default function StoresDashboardPage() {
  const t = useT('inv'); usePageTitle(t('dashTitle')); const [projectId, setProjectId] = useState('');
  const pq = useQuery({ queryKey: ['inv', 'projects'], queryFn: iv.projects, retry: false }); const q = useQuery({ queryKey: ['inv', 'dash', projectId], queryFn: () => iv.dashboard({ projectId }), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('dashTitle')} permission="inv.stock.view" />;
  if (q.isPending) return <Skeleton label={t('dashTitle')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const k = d.tiles;
  return (
    <section aria-labelledby="sd-h" data-testid="inv-sd"><PageHeader id="sd-h" title={t('dashTitle')} subtitle={t('dashIntro')} />
      <div className="mdm-panel no-print"><label>{t('project')}<select value={projectId} onChange={(ev) => setProjectId(ev.target.value)} style={{ minHeight: 44 }} data-testid="sd-project"><option value="">{t('allProjects')}</option>{(pq.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label></div>
      <div className="actions-row no-print"><Link to="/inv/stores">{t('storesTitle')}</Link> <Link to="/inv/balances">{t('balancesTitle')}</Link> <Link to="/inv/ledger">{t('ledgerTitle')}</Link> {d.canValues && <Link to="/inv/valuation">{t('valuationTitle')}</Link>} <Link to="/inv/adjustments">{t('adjTitle')}</Link></div>
      <KpiRow data-testid="sd-tiles"><Tile label={t('tileStores')} value={k.stores} testId="sd-stores" /><Tile label={t('tileValue')} value={k.totalValue == null ? '—' : fmtRs(k.totalValue)} testId="sd-value" /><Tile label={t('tileReorder')} value={k.belowReorder} status={k.belowReorder ? 'bad' : 'ok'} testId="sd-reorder" /><Tile label={t('tileReserved')} value={k.reservedLines} testId="sd-reserved" />
        <Tile label={t('tilePending')} value={k.pendingApprovals} testId="sd-pending" />{k.integrityProblems != null && <Tile label={t('tileBooks')} value={k.integrityProblems === 0 ? t('booksOk') : k.integrityProblems} status={k.integrityProblems ? 'bad' : 'ok'} testId="sd-books" />}</KpiRow>
      {d.byStore.length === 0 ? <div data-testid="sd-empty"><h2>{t('emptyTitle')}</h2><p className="muted">{t('emptyBody')}</p><Link to="/inv/stores?new=1">{t('newStore')}</Link></div> : <>
        {d.canValues && <div className="mdm-panel"><h2>{t('valueByStore')}</h2><Bars rows={d.byStore.map((s) => ({ key: s.id, label: `${s.code} ${s.name}`, value: s.value, link: `/inv/balances?q=${encodeURIComponent(s.code)}` }))} format={fmtRs} testId="sd-bars" label={t('valueByStore')} /></div>}
        <div className="table-scroll"><table className="data-table" data-testid="sd-reorder-table"><caption>{t('belowReorder')}</caption><thead><tr><th>{t('item')}</th><th className="num">{t('free')}</th><th className="num">{t('reorderLevel')}</th></tr></thead>
          <tbody>{d.belowReorder.length === 0 ? <tr><td colSpan={3} className="muted">{t('nothingBelow')}</td></tr> : d.belowReorder.map((r) => <tr key={r.itemId} data-testid="sd-reorder-row"><td><Link to={`/inv/ledger?itemId=${r.itemId}`}>{r.code} {r.name}</Link></td><td className="num">{fmtQty(r.free)} {r.uom}</td><td className="num">{fmtQty(r.reorderLevel)}</td></tr>)}</tbody></table></div>
        {d.canValues && <div className="mdm-panel"><h2>{t('ageing')}</h2><Bars rows={d.ageing.map((a) => ({ key: a.label, label: `${a.label} ${t('days')} (${a.lines})`, value: a.value }))} format={fmtRs} testId="sd-age" label={t('ageing')} /></div>}
        <div className="table-scroll"><table className="data-table" data-testid="sd-recent"><caption>{t('recent')}</caption><thead><tr><th>{t('entry')}</th><th>{t('item')}</th><th>{t('store')}</th><th>{t('date')}</th><th className="num">{t('in')}</th><th className="num">{t('out')}</th></tr></thead>
          <tbody>{d.recent.map((l) => <tr key={l.id}><td>{l.docNo}</td><td>{l.item?.code} {l.item?.name}</td><td>{l.store}</td><td>{fmtDate(l.date)}</td><td className="num">{fmtQty(l.qtyIn)}</td><td className="num">{fmtQty(l.qtyOut)}</td></tr>)}</tbody></table></div></>}
      {d.integrity?.length > 0 && <p className="field-error" role="alert" data-testid="sd-integrity">{t('booksProblem', { n: d.integrity.length })}</p>}
    </section>
  );
}
