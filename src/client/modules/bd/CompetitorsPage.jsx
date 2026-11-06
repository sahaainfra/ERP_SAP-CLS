import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { REGIONS, SECTORS, aw, inr } from './api.js';

// Competitor Analysis (business development, part 08.03, FR-05): what the openings say about each competitor (bids, times L1, how far from L1 and from us) and about us by sector, region and month.
const pct = (n) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n}%`);
export default function CompetitorsPage() {
  const t = useT('bd');
  usePageTitle(t('comp.title'));
  const [f, setF] = useState({ sector: '', region: '', from: '', to: '' }); const [open, setOpen] = useState(null);
  const q = useQuery({ queryKey: ['bd', 'analysis', f], queryFn: () => aw.analysis(f), retry: false });
  const c = useQuery({ queryKey: ['bd', 'competitor', open], queryFn: () => aw.competitor(open), enabled: Boolean(open), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('comp.title')} permission="bd.competitor.view" />;
  const group = (title, rows, label, testid) => (
    <div className="mdm-panel" data-testid={testid}>
      <h2>{title}</h2>
      {rows.length === 0 ? <p className="muted">{t('comp.none')}</p> : (
        <div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">{title}</th><th scope="col">{t('comp.tenders')}</th><th scope="col">{t('comp.ourL1')}</th><th scope="col">{t('comp.winRate')}</th><th scope="col">{t('comp.ourDiff')}</th><th scope="col">{t('comp.rivals')}</th></tr></thead>
          <tbody>{rows.map((x) => <tr key={x.key}><th scope="row">{label(x)}</th><td data-label={t('comp.tenders')}>{x.tenders}</td><td data-label={t('comp.ourL1')}>{x.ourL1}</td><td data-label={t('comp.winRate')}>{x.ourWinRate}%</td><td data-label={t('comp.ourDiff')}>{pct(x.ourAvgDiffPct)}</td><td data-label={t('comp.rivals')}>{x.avgRivals}</td></tr>)}</tbody></table></div>)}
    </div>);
  return (
    <section aria-labelledby="comp-title" data-testid="competitors">
      <h1 id="comp-title">{t('comp.title')}</h1>
      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label={t('comp.filters')}>
        <label>{t('lead.sector')} <select value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value })} data-testid="comp-sector"><option value="">{t('comp.all')}</option>{SECTORS.map((k) => <option key={k} value={k}>{t(`sector.${k}`)}</option>)}</select></label>
        <label>{t('td.region')} <select value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} data-testid="comp-region"><option value="">{t('comp.all')}</option>{REGIONS.map((k) => <option key={k} value={k}>{t(`region.${k}`)}</option>)}</select></label>
        <label>{t('comp.from')} <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label>{t('comp.to')} <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
      </form>
      {q.isPending ? <Skeleton label={t('comp.title')} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (<>
        <div className="mdm-panel" data-testid="comp-table">
          <h2>{t('comp.competitors')}</h2>
          {q.data.competitors.length === 0 ? <p className="muted">{t('comp.none')}</p> : (
            <div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">{t('comp.name')}</th><th scope="col">{t('comp.bids')}</th><th scope="col">{t('comp.l1')}</th><th scope="col">{t('comp.winRate')}</th><th scope="col">{t('comp.avgDiff')}</th><th scope="col">{t('comp.vsUs')}</th><th scope="col">{t('comp.sectors')}</th></tr></thead>
              <tbody>{q.data.competitors.map((x) => <tr key={x.id} data-testid="comp-row"><th scope="row"><button type="button" className="link-button" onClick={() => setOpen(x.id)} data-testid={`comp-open-${x.id}`}>{x.name}</button></th><td data-label={t('comp.bids')}>{x.bids}</td><td data-label={t('comp.l1')} data-testid="comp-l1">{x.l1}</td><td data-label={t('comp.winRate')}>{x.winRate}%</td><td data-label={t('comp.avgDiff')}>{pct(x.avgDiffPct)}</td><td data-label={t('comp.vsUs')}>{pct(x.vsUsPct)}</td><td data-label={t('comp.sectors')}>{x.sectors.map((s) => t(`sector.${s}`)).join(', ')}</td></tr>)}</tbody></table></div>)}
        </div>
        {open && (c.isPending ? <Skeleton label={t('comp.title')} rows={2} /> : c.isError ? <ErrorState error={c.error} onRetry={c.refetch} /> : (
          <div className="mdm-panel" data-testid="comp-detail">
            <h2>{c.data.name} · {t('comp.wins', { n: c.data.wins, of: c.data.bids.length })}</h2>
            <ul className="mdm-list">{c.data.bids.map((b) => <li key={b.tenderId}><Link to={`/bd/tender?id=${b.tenderId}`}>{b.tenderNo}</Link> · {b.openedOn} · {b.rank ? `L${b.rank}` : t('res.disqualified')} · {inr(b.quoted)} · {t('comp.vsUsShort', { pct: pct(b.vsUsPct) })}</li>)}</ul>
            <div className="actions"><button type="button" className="btn" onClick={() => setOpen(null)}>{t('act.close')}</button></div>
          </div>))}
        {group(t('lead.sector'), q.data.bySector, (x) => x.label, 'comp-sector-table')}
        {group(t('td.region'), q.data.byRegion, (x) => (x.key === 'UNSET' ? '—' : t(`region.${x.key}`)), 'comp-region-table')}
        {group(t('comp.month'), q.data.byMonth, (x) => x.key, 'comp-month-table')}
      </>)}
    </section>
  );
}
