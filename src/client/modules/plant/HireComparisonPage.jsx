import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { Bars } from '../proc/AnaParts.jsx';
import { fmtQty, fmtRs, hr } from './api.js';
import { ExportButton } from './PlantParts.jsx';

// Hire cost against owned cost (part 17.06, FR-05): per equipment class, what hired machines cost an hour (certified hire-in bills) against what owned machines cost an hour (purchase value over a working life, plus fuel and maintenance).
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); const back = (n) => new Date(Date.parse(`${today()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
export default function HireComparisonPage() {
  const t = useT('plant'); usePageTitle(t('h.comparisonTitle')); const [f, setF] = useState({ from: back(179), to: today() }); const q = useQuery({ queryKey: ['plant', 'hire-cmp', f.from, f.to], queryFn: () => hr.comparison(f), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('h.comparisonTitle')} permission="plant.hire.report" />; if (q.isPending) return <Skeleton label={t('h.comparisonTitle')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const rs = (v) => (v == null ? '—' : fmtRs(v));
  return (
    <section aria-labelledby="hp-h" data-testid="plant-hire-comparison"><h1 id="hp-h">{t('h.comparisonTitle')}</h1><p className="muted">{t('h.comparisonIntro', { n: fmtQty(d.lifeHours) })} <Link to="/plant/hire-agreements">{t('h.agreementsTitle')}</Link></p>
      <div className="mdm-panel no-print" data-testid="hp-params"><div className="form-grid"><label>{t('h.from')}<input type="date" value={f.from} max={f.to} onChange={(ev) => setF({ ...f, from: ev.target.value })} style={{ minHeight: 44 }} data-testid="hp-from" /></label><label>{t('h.to')}<input type="date" value={f.to} max={today()} onChange={(ev) => setF({ ...f, to: ev.target.value })} style={{ minHeight: 44 }} data-testid="hp-to" /></label></div><ExportButton query={{ kind: 'comparison', from: f.from, to: f.to }} name="hire-vs-owned.csv" path="/hire/export" testId="hp-export" /></div>
      {d.rows.length === 0 ? <div className="mdm-panel" data-testid="hp-empty"><h2>{t('h.cmpEmptyTitle')}</h2><p className="muted">{t('h.cmpEmptyBody')}</p></div> : <>
        {d.chart.length > 0 && <div className="mdm-panel"><h2>{t('h.hirePerHour')}</h2><Bars rows={d.chart} format={(n) => fmtRs(n)} testId="hp-bars" label={t('h.hirePerHour')} /></div>}
        <div className="table-scroll"><table className="data-table" data-testid="hp-table"><thead><tr><th>{t('h.class')}</th><th className="num">{t('h.hireHours')}</th><th className="num">{t('h.hirePerHour')}</th><th className="num">{t('h.ownedHours')}</th><th className="num">{t('h.ownedPerHour')}</th><th>{t('h.verdict')}</th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.classItemId} data-testid="hp-row" data-verdict={r.verdict}><td>{r.class}</td><td className="num">{fmtQty(r.hireHours)}</td><td className="num">{rs(r.hirePerHour)}</td><td className="num">{fmtQty(r.ownedHours)}</td><td className="num">{rs(r.ownedPerHour)}</td><td className={r.verdict === 'HIRE_DEARER' ? 'field-error' : ''}>{t(`h.vd.${r.verdict}`)}</td></tr>)}</tbody></table></div></>}
    </section>
  );
}
