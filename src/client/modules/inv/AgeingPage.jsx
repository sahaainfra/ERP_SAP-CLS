import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { fmtDate, fmtQty, fmtRs, ro, saveCsv } from './api.js';
import { useSearch } from '../site/parts.jsx';

// Stock Ageing and Non-moving, with Redeployment Opportunities (part 16.07, FR-03): stock by the age of its receipt, items that have not been issued for a long time, and other stores that are short of the same item.
const BUCKETS = ['0-30', '31-90', '91-180', '181-365', '>365'];
function Chart({ t, totals }) {
  const max = Math.max(1, ...totals.map((b) => b.qty)); return (
    <div className="mdm-panel" data-testid="ageing-chart" role="img" aria-label={t('ag.chartLabel')}><h2>{t('ag.chartTitle')}</h2>
      <div style={{ display: 'grid', gap: 6 }}>{totals.map((b) => <div key={b.label} style={{ display: 'grid', gridTemplateColumns: '84px 1fr 120px', gap: 8, alignItems: 'center' }} data-testid={`ageing-bucket-${b.label}`}><span>{b.label} {t('tr.days')}</span><span style={{ background: 'var(--erp-color-border-subtle)', borderRadius: 4, height: 16 }}><span style={{ display: 'block', width: `${(b.qty / max) * 100}%`, minWidth: b.qty ? 4 : 0, height: 16, borderRadius: 4, background: 'var(--erp-color-border-strong)' }} /></span><span className="num">{fmtQty(b.qty)}{b.value != null ? ` · ${fmtRs(b.value)}` : ''}</span></div>)}</div></div>
  );
}
export default function AgeingPage() {
  const t = useT('inv'); usePageTitle(t('ag.title')); const sp = useSearch(); const tab = sp.get('tab') === 'redeploy' ? 'redeploy' : 'ageing'; const session = useSession(); const perms = session.data?.permissions ?? []; const [cls, setCls] = useState(''); const [storeId, setStoreId] = useState('');
  const oq = useQuery({ queryKey: ['inv', 'reorder-options'], queryFn: ro.options, retry: false }); const aq = useQuery({ queryKey: ['inv', 'ageing', cls, storeId], queryFn: () => ro.ageing({ class: cls, storeId }), retry: false, enabled: tab === 'ageing' }); const rq = useQuery({ queryKey: ['inv', 'redeploy'], queryFn: ro.redeploy, retry: false, enabled: tab === 'redeploy' });
  const q = tab === 'ageing' ? aq : rq; if (q.error?.status === 403) return <NoPermission what={t('ag.title')} permission="inv.ageing.view" />; const d = aq.data; const rd = rq.data;
  return (
    <section aria-labelledby="ag-h" data-testid="ageing"><h1 id="ag-h">{t('ag.title')}</h1><p className="muted">{t('ag.intro')}</p>
      <div className="actions-row no-print">{[['ageing', 'ag.tabAgeing'], ['redeploy', 'ag.tabRedeploy']].map(([k, l]) => <Link key={k} to={`/inv/ageing?tab=${k}`} aria-current={tab === k ? 'page' : undefined} data-testid={`ageing-tab-${k}`}>{t(l)}</Link>)}</div>
      {tab === 'ageing' && <div className="mdm-panel no-print"><div className="form-grid"><Field label={t('tr.store')} name="storeId" error={null}><select value={storeId} onChange={(ev) => setStoreId(ev.target.value)} style={{ minHeight: 44 }} data-testid="ageing-store"><option value="">{t('tr.allStores')}</option>{(oq.data?.stores ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field>
        <Field label={t('ag.class')} name="class" error={null}><select value={cls} onChange={(ev) => setCls(ev.target.value)} style={{ minHeight: 44 }} data-testid="ageing-class"><option value="">{t('ag.allClasses')}</option>{['ACTIVE', 'SLOW', 'NON_MOVING'].map((c) => <option key={c} value={c}>{t(`ag.c.${c}`)}</option>)}</select></Field></div>
        {d && perms.includes('inv.ageing.export') && <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => saveCsv('stock-ageing.csv', [[t('tr.store'), t('item'), t('i.qty'), ...BUCKETS, t('ag.lastIssue'), t('ag.class'), t('r.value')], ...d.rows.map((r) => [r.store, r.item, r.qty, ...r.buckets, r.lastIssue ?? '', r.class, r.value == null ? '' : r.value / 100])])} data-testid="ageing-export">{t('i.exportCsv')}</button></div>}</div>}
      {q.isPending ? <Skeleton label={t('ag.title')} rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : tab === 'ageing' ? (d.rows.length === 0 ? <div className="mdm-panel" data-testid="ageing-empty"><h2>{t('ag.emptyTitle')}</h2><p>{t('ag.emptyBody')}</p></div> : (<>
        <div className="kpi-row" role="list" data-testid="ageing-kpis">{[['nonMoving', 'NON_MOVING'], ['slow', 'SLOW'], ['active', 'ACTIVE']].map(([k, c]) => <div key={k} role="listitem" className="kpi-tile" data-testid={`ageing-kpi-${k}`}><span className="kpi-value">{d.counts[k]}</span><span className="kpi-label">{t(`ag.c.${c}`)}</span></div>)}</div>
        <p className="muted">{t('ag.rule', { slow: d.slowDays, dead: d.nonMovingDays })}</p><Chart t={t} totals={d.totals} />
        <div className="table-scroll"><table className="data-table" data-testid="ageing-table"><caption>{t('ag.title')}</caption><thead><tr><th>{t('tr.store')}</th><th>{t('item')}</th><th className="num">{t('i.qty')}</th>{BUCKETS.map((b) => <th key={b} className="num">{b}</th>)}<th>{t('ag.lastIssue')}</th><th>{t('ag.class')}</th><th className="num">{t('r.value')}</th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={`${r.storeId}-${r.itemId}`} className={r.class === 'NON_MOVING' ? 'is-warn' : ''} data-testid={`ageing-row-${r.store}-${r.itemId}`}><td data-label={t('tr.store')}>{r.store}</td><td data-label={t('item')}>{r.item}</td><td className="num" data-label={t('i.qty')}>{fmtQty(r.qty)} {r.uom}</td>{r.buckets.map((b, i) => <td key={BUCKETS[i]} className="num" data-label={BUCKETS[i]}>{fmtQty(b)}</td>)}<td data-label={t('ag.lastIssue')}>{r.lastIssue ? fmtDate(r.lastIssue) : t('ag.never')}</td><td data-label={t('ag.class')}>{t(`ag.c.${r.class}`)}</td><td className="num" data-label={t('r.value')}>{r.value == null ? '—' : fmtRs(r.value)}</td></tr>)}</tbody></table></div></>)
      ) : (rd.rows.length === 0 ? <div className="mdm-panel" data-testid="redeploy-empty"><h2>{t('ag.rdEmptyTitle')}</h2><p>{t('ag.rdEmptyBody')}</p></div> : (
        <div className="table-scroll"><table className="data-table" data-testid="redeploy-table"><caption>{t('ag.tabRedeploy')}</caption><thead><tr><th>{t('item')}</th><th>{t('tr.from')}</th><th>{t('ag.class')}</th><th>{t('tr.to')}</th><th className="num">{t('ag.shortBy')}</th><th className="num">{t('ag.canMove')}</th><th className="num">{t('r.value')}</th><th /></tr></thead>
          <tbody>{rd.rows.map((r) => <tr key={`${r.fromStoreId}-${r.toStoreId}-${r.itemId}`} data-testid={`redeploy-row-${r.fromStore}-${r.toStore}`}><td data-label={t('item')}>{r.item}</td><td data-label={t('tr.from')}>{r.fromStore}</td><td data-label={t('ag.class')}>{t(`ag.c.${r.class}`)} · {r.daysSinceMove} {t('tr.days')}</td><td data-label={t('tr.to')}>{r.toStore}{r.betweenProjects ? ` · ${t('tr.betweenProjects')}` : ''}</td><td className="num" data-label={t('ag.shortBy')}>{fmtQty(r.shortBy)}</td><td className="num" data-label={t('ag.canMove')}>{fmtQty(r.qty)} {r.uom}</td><td className="num" data-label={t('r.value')}>{r.value == null ? '—' : fmtRs(r.value)}</td><td>{perms.includes('inv.transfer.create') && <Link to="/inv/transfer-new">{t('ag.transfer')}</Link>}</td></tr>)}</tbody></table></div>))}
    </section>
  );
}
