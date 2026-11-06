import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { mto, qty } from './api.js';
import { useSearch } from './parts.jsx';

// Material Requirement Explosion (part 09.02, FR-04, FR-06): the materials a take-off revision needs: each BOQ quantity times the components of its work item's bill of resources (06.03) with their wastage, or the material
// item of an engineering MTO line as given; the steel of a bar bending schedule by diameter. A released revision shows the requirements stored for estimation and MRP; a draft shows them worked out live.
export default function MtoExplosionPage() {
  const t = useT('est');
  usePageTitle(t('exp.title'));
  const sp = useSearch(); const kind = sp.get('kind') === 'bbs' ? 'bbs' : 'takeoff'; const id = Number(sp.get('id')) || null;
  const q = useQuery({ queryKey: ['est', 'explosion', kind, id], queryFn: () => mto.explosion(kind, id), enabled: Boolean(id), retry: false });
  const r = q.data;
  const chart = r && r.rows.length > 0 && r.rows.length <= 30 && { categories: r.rows.map((x) => x.itemCode ?? x.description), series: [{ name: t('exp.net'), values: r.rows.map((x) => Number(x.net)) }, { name: t('exp.wastage'), values: r.rows.map((x) => Math.round((Number(x.qty) - Number(x.net)) * 1000) / 1000) }] };
  return (
    <section aria-labelledby="exp-h" data-testid="mto-explosion">
      <h1 id="exp-h">{t('exp.title')}</h1>
      {!id ? <p className="muted">{t('delta.choose')} <Link to="/est/takeoffs">{t('to.list')}</Link></p> : q.isPending ? <Skeleton label={t('exp.title')} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (<>
        <p data-testid="exp-head"><Link to={kind === 'bbs' ? `/est/bbs/sheet?id=${r.source.id}` : `/est/takeoff?id=${r.source.id}`}>{r.source.ref}</Link> · {r.stored ? t('exp.stored') : t('exp.live')}</p>
        {chart && <Chart type="stacked" data={chart} title={t('exp.chart')} exportName="material-requirements" />}
        {r.rows.length === 0 ? <p className="muted">{t('exp.none')}</p> : (
          <div className="table-wrap"><table className="data-table" data-testid="exp-table"><thead><tr><th scope="col">{t('comp.item')}</th><th scope="col">{t('comp.description')}</th><th scope="col">{t('exp.net')}</th><th scope="col">{t('exp.wastagePct')}</th><th scope="col">{t('exp.qty')}</th><th scope="col">{t('items.uom')}</th><th scope="col">{t('exp.from')}</th></tr></thead>
            <tbody>{r.rows.map((x, i) => <tr key={i} data-testid={`exp-row-${x.itemCode ?? x.description}`}><td data-label={t('comp.item')}>{x.itemCode ?? '—'}</td><td data-label={t('comp.description')}>{x.description}</td><td data-label={t('exp.net')}>{qty(x.net)}</td><td data-label={t('exp.wastagePct')}>{x.wastagePct}%</td><td data-label={t('exp.qty')} data-testid={`exp-qty-${x.itemCode ?? x.description}`}>{qty(x.qty)}</td><td data-label={t('items.uom')}>{x.uom}</td><td data-label={t('exp.from')}>{x.from}</td></tr>)}</tbody></table></div>)}
        {r.unexploded.length > 0 && <div className="mdm-panel" data-testid="exp-unexploded"><h2>{t('exp.unexploded')}</h2><ul className="mdm-list">{r.unexploded.map((u, i) => <li key={i}>{u.ref ?? u.description}: {qty(u.qty)} {u.uom} · {u.reason}</li>)}</ul></div>}
      </>)}
    </section>
  );
}
