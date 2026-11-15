import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { mto, qty } from './api.js';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Revision Delta Report (part 09.02, FR-05, BR-02, T-02): a revision of a take-off (by BOQ item) or of a bar bending schedule (by bar mark, and the weight by diameter) against the previous released revision: added, removed
// and changed quantities.
const sign = (v) => (v == null ? '—' : Number(v) > 0 ? `+${qty(v)}` : qty(v));
export default function MtoDeltaPage() {
  const t = useT('est');
  usePageTitle(t('delta.title'));
  const sp = useSearch(); const kind = sp.get('kind') === 'bbs' ? 'bbs' : 'takeoff'; const id = Number(sp.get('id')) || null; const withId = Number(sp.get('with')) || null;
  const q = useQuery({ queryKey: ['est', 'delta', kind, id, withId], queryFn: () => mto.delta(kind, id, withId), enabled: Boolean(id), retry: false });
  const d = q.data;
  const chart = d && kind === 'bbs' && d.byDia.length > 0 && { categories: d.byDia.map((x) => `${x.dia} mm`), series: [{ name: t('delta.change'), values: d.byDia.map((x) => Number(x.delta)) }] };
  return (
    <section aria-labelledby="delta-h" data-testid="mto-delta">
      <PageHeader id="delta-h" title={t('delta.title')} />
      {!id ? <p className="muted">{t('delta.choose')} <Link to="/est/takeoffs">{t('to.list')}</Link> · <Link to="/est/bbs">{t('bbs.list')}</Link></p> : q.isPending ? <Skeleton label={t('delta.title')} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (<>
        <p data-testid="delta-head"><Link to={kind === 'bbs' ? `/est/bbs/sheet?id=${d.current.id}` : `/est/takeoff?id=${d.current.id}`}>{d.current.ref}</Link> ({d.current.drawingRev ?? '–'}) {d.base ? <>{t('delta.against')} <Link to={kind === 'bbs' ? `/est/bbs/sheet?id=${d.base.id}` : `/est/takeoff?id=${d.base.id}`}>{d.base.ref}</Link> ({d.base.drawingRev ?? '–'})</> : t('delta.first')}</p>
        <dl className="op-figures" data-testid="delta-counts">{['added', 'removed', 'changed', 'same'].map((k) => <div key={k}><dt>{t(`chg.${k.toUpperCase()}`)}</dt><dd data-testid={`delta-${k}`}>{d.counts[k]}</dd></div>)}</dl>
        {chart && <Chart type="bar" data={chart} title={t('delta.byDia')} exportName="bbs-delta" />}
        <div className="table-wrap"><table className="data-table" data-testid="delta-table"><thead><tr><th scope="col">{kind === 'bbs' ? t('bbs.mark') : t('to.boqRef')}</th><th scope="col">{t('items.description')}</th><th scope="col">{t('cmp.change')}</th><th scope="col">{t('delta.before')}</th><th scope="col">{t('delta.now')}</th><th scope="col">{t('delta.change')}</th><th scope="col">{t('items.uom')}</th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={`${r.ref}|${r.uom}|${r.description}`} data-change={r.change} data-testid={`delta-row-${r.ref ?? r.description}`} className={r.change === 'SAME' ? '' : 'row-highlight'}><th scope="row" data-label={kind === 'bbs' ? t('bbs.mark') : t('to.boqRef')}>{r.ref ?? '—'}</th><td data-label={t('items.description')}>{r.description}</td><td data-label={t('cmp.change')}>{t(`chg.${r.change}`)}</td><td data-label={t('delta.before')}>{r.from == null ? '—' : qty(r.from)}</td><td data-label={t('delta.now')}>{r.to == null ? '—' : qty(r.to)}</td><td data-label={t('delta.change')} data-testid={`delta-d-${r.ref ?? r.description}`}>{sign(r.delta)}</td><td data-label={t('items.uom')}>{r.uom}</td></tr>)}</tbody></table></div>
        {kind === 'bbs' && <div className="table-wrap"><table className="data-table" data-testid="delta-dia"><caption>{t('delta.byDia')}</caption><thead><tr><th scope="col">{t('bbs.dia')}</th><th scope="col">{t('delta.before')}</th><th scope="col">{t('delta.now')}</th><th scope="col">{t('delta.change')}</th></tr></thead><tbody>{d.byDia.map((x) => <tr key={x.dia}><th scope="row" data-label={t('bbs.dia')}>{x.dia} mm</th><td data-label={t('delta.before')}>{qty(x.from)}</td><td data-label={t('delta.now')}>{qty(x.to)}</td><td data-label={t('delta.change')}>{sign(x.delta)}</td></tr>)}</tbody></table></div>}
      </>)}
    </section>
  );
}
