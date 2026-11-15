import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { fmtDate, fmtQty, cp } from './api.js';
import { ExportButton } from './PlantParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Shortage and surplus (part 17.08, FR-03): each shortage with where the same resource is in surplus in that week (other projects, then the free pool), so a move can be planned.
export default function ShortagePage() {
  const t = useT('plant'); usePageTitle(t('r.shortageTitle')); const [f, setF] = useState({ type: 'LABOUR', weeks: 8 }); const q = useQuery({ queryKey: ['plant', 'gaps', f.type, f.weeks], queryFn: () => cp.gaps(f), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('r.shortageTitle')} permission="plant.capacity.view" />; if (q.isPending) return <Skeleton label={t('r.shortageTitle')} rows={5} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return (
    <section aria-labelledby="sh-h" data-testid="plant-shortage"><PageHeader id="sh-h" title={t('r.shortageTitle')} subtitle={<>{t('r.shortageIntro')} <Link to="/plant/capacity">{t('r.capacityTitle')}</Link></>} />
      <div className="mdm-panel no-print"><div className="form-grid"><label>{t('r.type')}<select value={f.type} onChange={(ev) => setF({ ...f, type: ev.target.value })} style={{ minHeight: 44 }} data-testid="sh-type"><option value="LABOUR">{t('r.rt.LABOUR')}</option><option value="PLANT">{t('r.rt.PLANT')}</option></select></label><label>{t('r.weeks')}<select value={f.weeks} onChange={(ev) => setF({ ...f, weeks: Number(ev.target.value) })} style={{ minHeight: 44 }}>{[4, 8, 12, 26].map((n) => <option key={n} value={n}>{n}</option>)}</select></label></div><ExportButton query={{ type: f.type, weeks: f.weeks }} name="shortages.csv" path="/capacity/export" testId="sh-export" /></div>
      <h2>{t('r.shortage')}</h2>{d.shortages.length === 0 ? <p className="muted" data-testid="sh-empty">{t('r.noShortage')}</p> : <div className="table-scroll"><table className="data-table" data-testid="sh-table"><thead><tr><th>{t('project')}</th><th>{t('r.resource')}</th><th>{t('r.week')}</th><th className="num">{t('r.demand')}</th><th className="num">{t('r.supply')}</th><th className="num">{t('r.shortage')}</th><th>{t('r.surplusAt')}</th></tr></thead>
        <tbody>{d.shortages.map((s, i) => <tr key={i} data-testid="sh-row"><td>{s.project}</td><td>{s.label}</td><td>{fmtDate(s.week)}</td><td className="num">{fmtQty(s.demand)}</td><td className="num">{fmtQty(s.supply)}</td><td className="num field-error">{fmtQty(s.shortage)}</td><td>{s.sources.length ? s.sources.map((x) => `${x.project} ${fmtQty(x.qty)}`).join(', ') : t('r.nowhere')}</td></tr>)}</tbody></table></div>}
      <h2>{t('r.surplus')}</h2>{d.surplus.length === 0 ? <p className="muted">{t('r.noSurplus')}</p> : <div className="table-scroll"><table className="data-table" data-testid="sh-surplus"><thead><tr><th>{t('project')}</th><th>{t('r.resource')}</th><th>{t('r.week')}</th><th className="num">{t('r.surplus')}</th></tr></thead><tbody>{d.surplus.slice(0, 100).map((s, i) => <tr key={i}><td>{s.project}</td><td>{s.label}</td><td>{fmtDate(s.week)}</td><td className="num">{fmtQty(s.surplus)}</td></tr>)}</tbody></table></div>}
      <div className="actions-row no-print"><Link to="/plant/resource-plans?new=1">{t('r.newPlan')}</Link></div>
    </section>
  );
}
