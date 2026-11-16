import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { Bars } from '../proc/AnaParts.jsx';
import { fmtDate, fmtQty, fmtRs, fl } from './api.js';
import { FilterPanel } from './PlantParts.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Fleet control tower (part 17.07): availability, utilisation, MTBF, MTTR, cost an hour, idle cost, the machines by position (telematics), the alerts and the replacement candidates. Every tile opens the records behind it.
function PositionMap({ rows }) {
  const t = useT('plant'); if (!rows.length) return <p className="muted" data-testid="ft-map-empty">{t('t.noPositions')}</p>;
  const lats = rows.map((r) => r.lat); const lngs = rows.map((r) => r.lng); const lo = (a) => Math.min(...a) - 0.01; const hi = (a) => Math.max(...a) + 0.01; const w = 320; const h = 180; const x = (v) => ((v - lo(lngs)) / (hi(lngs) - lo(lngs))) * (w - 40) + 20; const y = (v) => h - 20 - ((v - lo(lats)) / (hi(lats) - lo(lats))) * (h - 40);
  return <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={t('t.mapLabel')} style={{ width: '100%', maxWidth: 520, background: 'var(--surface-2, transparent)', border: '1px solid currentColor' }} data-testid="ft-map">{rows.map((r) => <g key={r.equipmentId} data-testid="ft-map-point"><circle cx={x(r.lng)} cy={y(r.lat)} r="5" fill="currentColor" opacity={r.ignition ? 1 : 0.4} /><text x={x(r.lng) + 8} y={y(r.lat) + 4} fontSize="10" fill="currentColor">{r.assetCode}</text></g>)}</svg>;
}
export default function FleetTowerPage() {
  const t = useT('plant'); usePageTitle(t('t.towerTitle')); const [f, setF] = useState({ projectId: '', siteId: '' }); const q = useQuery({ queryKey: ['plant', 'fleet-tower', f.projectId], queryFn: () => fl.tower({ projectId: f.projectId || undefined }), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('t.towerTitle')} permission="plant.fleet.view" />; if (q.isPending) return <Skeleton label={t('t.towerTitle')} rows={5} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const x = d.figures; const pc = (v) => (v == null ? null : `${v}%`); const tile = (key, value, to, tone) => <KpiTile key={key} label={t(`t.tile.${key}`)} value={value ?? '—'} to={to} tone={tone ? 'error' : 'neutral'} testid={`ft-tile-${key}`} />;
  return (
    <section aria-labelledby="ft-h" data-testid="plant-fleet-tower"><PageHeader id="ft-h" title={t('t.towerTitle')} subtitle={t('t.towerIntro', { from: fmtDate(d.from), to: fmtDate(d.to) })} />
      <FilterPanel value={f} onChange={setF} />
      <div className="actions-row no-print"><Link to="/plant/owning-cost">{t('t.costTitle')}</Link><Link to="/plant/replacement">{t('t.replacementTitle')}</Link><Link to="/plant/maintenance">{t('m.dashTitle')}</Link><Link to="/plant/utilisation">{t('l.utilTitle')}</Link></div>
      <KpiRow testid="ft-tiles">{tile('fleet', x.fleet, '/plant/equipment')}{tile('deployed', x.deployed, '/plant/equipment')}{tile('breakdown', x.breakdown, '/plant/logs?tab=breakdowns', x.breakdown ? 'field-error' : '')}{tile('availability', pc(x.availabilityPct), '/plant/utilisation')}{tile('utilisation', pc(x.utilisationPct), '/plant/utilisation')}{tile('mtbf', x.mtbf == null ? null : `${fmtQty(x.mtbf)} h`, '/plant/maintenance')}{tile('mttr', x.mttr == null ? null : `${fmtQty(x.mttr)} h`, '/plant/maintenance')}{tile('fuelPerHour', x.fuelPerHour == null ? null : `${fmtQty(x.fuelPerHour)} l/h`, '/plant/fuel-reports')}{d.canCosts && tile('costPerHour', x.costPerHour == null ? null : fmtRs(x.costPerHour), '/plant/owning-cost')}{d.canCosts && tile('idleCost', x.idleCost == null ? null : fmtRs(x.idleCost), '/plant/owning-cost')}{tile('candidates', x.candidates, '/plant/replacement')}{tile('alerts', x.alerts, '#alerts', x.alerts ? 'field-error' : '')}</KpiRow>
      {d.canCosts && <div className="mdm-panel"><h2>{t('t.rankCost')}</h2>{d.ranking.length ? <Bars rows={d.ranking} format={(n) => fmtRs(n)} testId="ft-bars-cost" label={t('t.rankCost')} /> : <p className="muted" data-testid="ft-rank-empty">{t('t.noCost')}</p>}</div>}
      {d.canCosts && d.idle.length > 0 && <div className="mdm-panel"><h2>{t('t.rankIdle')}</h2><Bars rows={d.idle} format={(n) => fmtRs(n)} testId="ft-bars-idle" label={t('t.rankIdle')} /></div>}
      <div className="mdm-panel"><h2>{t('t.mapTitle')}</h2><PositionMap rows={d.positions} />{d.positions.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="ft-positions"><thead><tr><th>{t('assetCode')}</th><th>{t('t.at')}</th><th>{t('t.ignition')}</th><th className="num">{t('t.engineHours')}</th><th className="num">{t('t.fuelLevel')}</th></tr></thead><tbody>{d.positions.map((p) => <tr key={p.equipmentId}><td><Link to={`/plant/equipment?id=${p.equipmentId}`}>{p.assetCode}</Link></td><td>{p.at.replace('T', ' ').slice(0, 16)}</td><td>{p.ignition == null ? '—' : p.ignition ? t('yes') : t('no')}</td><td className="num">{p.engineHours == null ? '—' : fmtQty(p.engineHours)}</td><td className="num">{p.fuelLevel == null ? '—' : fmtQty(p.fuelLevel)}</td></tr>)}</tbody></table></div>}</div>
      <div className="mdm-panel" id="alerts"><h2>{t('t.alertsTitle')}</h2>{d.alerts.length === 0 ? <p className="muted" data-testid="ft-alerts-empty">{t('t.noAlerts')}</p> : <div className="table-scroll"><table className="data-table" data-testid="ft-alerts"><thead><tr><th>{t('assetCode')}</th><th>{t('date')}</th><th>{t('t.alert')}</th><th>{t('t.detail')}</th></tr></thead><tbody>{d.alerts.map((a, i) => <tr key={i} data-testid="ft-alert-row" data-kind={a.kind}><td>{a.assetCode}</td><td>{fmtDate(a.date)}</td><td>{t(`t.ak.${a.kind}`)}</td><td>{a.kind === 'HOURS_MISMATCH' ? t('t.mismatch', { a: fmtQty(a.telematicsHrs), b: fmtQty(a.loggedHrs) }) : t('t.readings', { n: a.readings })}</td></tr>)}</tbody></table></div>}</div>
      {d.candidates.length > 0 && <div className="mdm-panel"><h2>{t('t.replacementTitle')}</h2><div className="table-scroll"><table className="data-table" data-testid="ft-candidates"><thead><tr><th>{t('assetCode')}</th><th>{t('t.flags')}</th></tr></thead><tbody>{d.candidates.map((c) => <tr key={c.equipmentId}><td>{c.assetCode}</td><td>{c.flags.map((k) => t(`t.fl.${k}`)).join(', ')}</td></tr>)}</tbody></table></div><Link to="/plant/replacement">{t('t.replacementTitle')}</Link></div>}
    </section>
  );
}
