import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { est, inr, qty } from './api.js';
import { EstimatePicker, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Version Comparison (part 09.01, FR-07, T-01): two versions of one estimate, item by item (matched by the BOQ item number): what was added, removed or changed in quantity, cost rate, markup and selling rate, and the totals.
const sign = (v) => (v == null ? '—' : Number(v) > 0 ? `+${v}` : String(v));
export default function ComparePage() {
  const t = useT('est');
  usePageTitle(t('cmp.title'));
  const s = useSearch();
  const [from, setFrom] = useState(Number(s.get('id')) || null); const [to, setTo] = useState(Number(s.get('with')) || null); const [only, setOnly] = useState(true);
  const lq = useQuery({ queryKey: ['est', 'all'], queryFn: () => est.list({ pageSize: 100 }), retry: false });
  const cq = useQuery({ queryKey: ['est', 'compare', from, to], queryFn: () => est.compare(from, to), enabled: Boolean(from && to), retry: false });
  const all = lq.data?.data ?? []; const doc = all.find((r) => r.id === from)?.docNo;
  const c = cq.data;
  return (
    <section aria-labelledby="cmp-h" data-testid="compare">
      <PageHeader id="cmp-h" title={t('cmp.title')} />
      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label={t('cmp.params')}>
        <EstimatePicker id="cmp-from" value={from} onChange={setFrom} rows={all} label={t('cmp.from')} />
        <EstimatePicker id="cmp-to" value={to} onChange={setTo} rows={doc ? all.filter((r) => r.docNo === doc && r.id !== from) : all} label={t('cmp.to')} />
        <label><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} data-testid="cmp-only" /> {t('cmp.onlyChanges')}</label>
      </form>
      {!from || !to ? <p className="muted">{t('cmp.choose')}</p> : cq.isPending ? <Skeleton label={t('cmp.title')} rows={5} /> : cq.isError ? <ErrorState error={cq.error} onRetry={cq.refetch} /> : (<>
        <dl className="op-figures" data-testid="cmp-totals">
          <div><dt>{t('fig.selling')}</dt><dd>{inr(c.totals.from.selling)} → {inr(c.totals.to.selling)} <strong data-testid="cmp-delta-selling">({sign(c.totals.delta.selling)})</strong></dd></div>
          {c.costsVisible && <div><dt>{t('fig.cost')}</dt><dd>{inr(c.totals.from.cost)} → {inr(c.totals.to.cost)} ({sign(c.totals.delta.cost)})</dd></div>}
          {c.costsVisible && <div><dt>{t('fig.margin')}</dt><dd data-testid="cmp-delta-margin">{c.totals.from.marginPct}% → {c.totals.to.marginPct}% ({sign(c.totals.delta.marginPct)})</dd></div>}
          <div><dt>{t('cmp.counts')}</dt><dd data-testid="cmp-counts">{t('cmp.countText', c.counts)}</dd></div>
        </dl>
        <div className="table-wrap"><table className="data-table" data-testid="cmp-table">
          <thead><tr><th scope="col">{t('items.no')}</th><th scope="col">{t('items.description')}</th><th scope="col">{t('cmp.change')}</th><th scope="col">{t('items.qty')}</th>{c.costsVisible && <th scope="col">{t('items.costRate')}</th>}{c.costsVisible && <th scope="col">{t('items.markup')}</th>}<th scope="col">{t('items.rate')}</th><th scope="col">{t('cmp.deltaAmount')}</th></tr></thead>
          <tbody>{c.rows.filter((r) => !only || r.change !== 'SAME').map((r) => (
            <tr key={r.itemNo} data-testid={`cmp-row-${r.itemNo}`} data-change={r.change} className={r.change === 'SAME' ? '' : 'row-highlight'}>
              <th scope="row" data-label={t('items.no')}>{r.itemNo}</th><td data-label={t('items.description')}>{r.description}</td><td data-label={t('cmp.change')}>{t(`chg.${r.change}`)}</td>
              <td data-label={t('items.qty')}>{qty(r.from?.qty)} → {qty(r.to?.qty)}{r.delta.qty && r.delta.qty !== '0' ? ` (${sign(r.delta.qty)})` : ''}</td>
              {c.costsVisible && <td data-label={t('items.costRate')}>{r.from?.costRate ?? '—'} → {r.to?.costRate ?? '—'}</td>}
              {c.costsVisible && <td data-label={t('items.markup')}>{r.from?.markupPct ?? '—'} → {r.to?.markupPct ?? '—'}</td>}
              <td data-label={t('items.rate')}>{inr(r.from?.sellingRate)} → {inr(r.to?.sellingRate)}</td>
              <td data-label={t('cmp.deltaAmount')} data-testid={`cmp-amount-${r.itemNo}`}>{sign(r.delta.amount)}</td>
            </tr>))}</tbody>
        </table></div>
        <p className="small"><Link to={`/est/estimate?id=${c.from.id}`}>{c.from.ref}</Link> · <Link to={`/est/estimate?id=${c.to.id}`}>{c.to.ref}</Link></p>
      </>)}
    </section>
  );
}
