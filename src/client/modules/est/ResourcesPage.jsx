import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { COMPONENT_TYPES, est, inr, qty } from './api.js';
import { EstimatePicker, useSearch } from './parts.jsx';

// Resource Summary (part 09.01, FR-06): the cement, steel, aggregates, labour man-days and plant hours of an estimate: every item's quantity times the resources of its rate analysis (with wastage) or of its build-up.
// The amounts are shown only to those allowed to see costs. The approved estimate sends these quantities to the material take-off (09.02).
export default function ResourcesPage() {
  const t = useT('est');
  usePageTitle(t('res.title'));
  const [id, setId] = useState(Number(useSearch().get('id')) || null); const [type, setType] = useState('');
  const lq = useQuery({ queryKey: ['est', 'all'], queryFn: () => est.list({ pageSize: 100 }), retry: false });
  const rq = useQuery({ queryKey: ['est', 'resources', id, type], queryFn: () => est.resources(id, type), enabled: Boolean(id), retry: false });
  const r = rq.data;
  const chart = r && r.byType.length > 0 && r.costsVisible && { categories: r.byType.map((x) => x.label), series: [{ name: t('res.amount'), values: r.byType.map((x) => Number(x.amount)) }] };
  return (
    <section aria-labelledby="res-h" data-testid="resources">
      <h1 id="res-h">{t('res.title')}</h1>
      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label={t('cmp.params')}>
        <EstimatePicker id="res-estimate" value={id} onChange={setId} rows={lq.data?.data ?? []} label={t('imp.estimate')} />
        <label htmlFor="res-type">{t('res.type')} <select id="res-type" value={type} onChange={(e) => setType(e.target.value)} data-testid="res-type"><option value="">{t('res.all')}</option>{COMPONENT_TYPES.map((k) => <option key={k} value={k}>{t(`ctype.${k}`)}</option>)}</select></label>
      </form>
      {!id ? <p className="muted">{t('res.choose')}</p> : rq.isPending ? <Skeleton label={t('res.title')} rows={5} /> : rq.isError ? <ErrorState error={rq.error} onRetry={rq.refetch} /> : (<>
        <dl className="op-figures" data-testid="res-headline">
          <div><dt>{t('res.cement')}</dt><dd data-testid="res-cement">{qty(r.headline.cementMt)} MT</dd></div>
          <div><dt>{t('res.steel')}</dt><dd data-testid="res-steel">{qty(r.headline.steelMt)} MT</dd></div>
          <div><dt>{t('res.labour')}</dt><dd data-testid="res-labour">{qty(r.headline.labourManDays)}</dd></div>
          <div><dt>{t('res.plant')}</dt><dd data-testid="res-plant">{qty(r.headline.plantHours)} h · {qty(r.headline.plantDays)} d</dd></div>
        </dl>
        {chart && <Chart type="bar" data={chart} title={t('res.chart')} exportName="estimate-resources" />}
        {r.rows.length === 0 ? <p className="muted">{t('res.none')}</p> : (
          <div className="table-wrap"><table className="data-table" data-testid="res-table">
            <thead><tr><th scope="col">{t('res.type')}</th><th scope="col">{t('comp.item')}</th><th scope="col">{t('comp.description')}</th><th scope="col">{t('items.uom')}</th><th scope="col">{t('res.qty')}</th><th scope="col">{t('res.items')}</th>{r.costsVisible && <th scope="col">{t('res.amount')}</th>}</tr></thead>
            <tbody>{r.rows.map((x, i) => <tr key={i} data-testid="res-row"><td data-label={t('res.type')}>{t(`ctype.${x.type}`)}</td><td data-label={t('comp.item')}>{x.itemCode ?? '—'}</td><td data-label={t('comp.description')}>{x.description}</td><td data-label={t('items.uom')}>{x.uom}</td><td data-label={t('res.qty')}>{qty(x.qty)}</td><td data-label={t('res.items')}>{x.items}</td>{r.costsVisible && <td data-label={t('res.amount')}>{inr(x.amount)}</td>}</tr>)}</tbody>
          </table></div>)}
        <p className="small"><Link to={`/est/estimate?id=${id}`}>{r.estimate.ref}</Link></p>
      </>)}
    </section>
  );
}
