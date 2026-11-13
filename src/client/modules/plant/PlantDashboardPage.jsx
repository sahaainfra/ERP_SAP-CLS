import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, Tile, usePageTitle } from '../core/pages/ui.jsx';
import { Bars } from '../proc/AnaParts.jsx';
import { fmtDate, pl } from './api.js';
import { ExportButton, FilterPanel, RecordTable } from './PlantParts.jsx';

// Plant dashboard (part 17.01): the fleet by status, utilisation, breakdowns, certificates that have expired or expire soon, the machines that cannot be put to work, and what waits for approval.
// Every tile and chart opens the machines or certificates behind it; the server works every figure out from the register inside the data scope of the person.
export default function PlantDashboardPage() {
  const t = useT('plant'); usePageTitle(t('dashTitle')); const [f, setF] = useState({ projectId: '', siteId: '' }); const [open, setOpen] = useState(null);
  const q = useQuery({ queryKey: ['plant', 'dash', f], queryFn: () => pl.dashboard(f), retry: false }); const tq = useQuery({ queryKey: ['plant', 'tasks'], queryFn: pl.myTasks, retry: false });
  const dq = useQuery({ queryKey: ['plant', 'drill', f, open], queryFn: () => pl.drill({ ...f, kind: open }), enabled: Boolean(open), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('dashTitle')} permission="plant.equipment.view" />;
  if (q.isPending) return <Skeleton label={t('dashTitle')} rows={5} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const k = d.kpis;
  const tiles = [
    ['fleet', t('tileFleet'), k.fleet.count, 'neutral', t('fleetHint', { o: k.fleet.owned, h: k.fleet.hired, s: k.fleet.subcontractor }), 'fleet'],
    ['util', t('tileUtil'), k.utilisation.pct == null ? '—' : `${k.utilisation.pct}%`, k.utilisation.status, t('utilHint', { d: k.utilisation.deployed, w: k.utilisation.working, t: k.utilisation.target }), 'DEPLOYED'],
    ['available', t('tileAvailable'), k.available.count, 'neutral', '', 'AVAILABLE'], ['breakdown', t('tileBreakdown'), k.breakdown.count, k.breakdown.status, '', 'BREAKDOWN'], ['maintenance', t('tileMaintenance'), k.maintenance.count, 'neutral', '', 'UNDER_MAINTENANCE'],
    ['expired', t('tileExpired'), k.expired.count, k.expired.status, k.nonCompliant.blocks ? t('blocksHint') : t('warnsHint'), 'expired'], ['expiring', t('tileExpiring'), k.expiring.count, k.expiring.status === 'warn' ? 'neutral' : k.expiring.status, t('withinDays', { n: k.expiring.days }), 'expiring'],
    ['noncompliant', t('tileNonCompliant'), k.nonCompliant.count, k.nonCompliant.status, t('missingHint', { n: k.nonCompliant.missing }), 'nonCompliant'], ['pending', t('tilePending'), k.pendingApprovals.count, 'neutral', '', 'pending'],
  ];
  const queues = Object.values(d.queues);
  return (
    <section aria-labelledby="pd-h" data-testid="plant-pd"><h1 id="pd-h">{t('dashTitle')}{d.project ? ` · ${d.project.code}` : ''}</h1><p className="muted">{t('dashIntro')} {fmtDate(d.today)}</p>
      <FilterPanel value={f} onChange={(v) => { setF(v); setOpen(null); }} />
      <div className="actions-row no-print"><Link to="/approvals">{t('myActions')}{tq.data != null ? ` (${tq.data})` : ''}</Link><Link to="/plant/equipment">{t('registerTitle')}</Link><Link to="/plant/equipment/new">{t('newTitle')}</Link>{d.canExport && <ExportButton query={{ ...f, kind: 'register' }} name="equipment-register.csv" />}</div>
      <div className="tiles" data-testid="pd-tiles">{tiles.map(([id, label, value, status, hint, kind]) => <div key={id} className="tile-wrap"><Tile label={label} value={value} status={status} hint={hint} testId={`pd-${id}`} /><button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setOpen(open === kind ? null : kind)} aria-expanded={open === kind} data-testid={`pd-open-${id}`}>{t('records')}</button></div>)}</div>
      {open && <div className="mdm-panel" data-testid="pd-drill"><h2>{dq.data?.title ?? t('records')}</h2>{dq.isPending ? <Skeleton label={t('records')} rows={3} /> : dq.isError ? <ErrorState error={dq.error} onRetry={dq.refetch} /> : <><p className="muted small">{t('shown', { n: dq.data.rows.length, total: dq.data.total })}</p><RecordTable rows={dq.data.rows} />{d.canExport && <ExportButton query={{ ...f, kind: open }} name={`plant-${open}.csv`} testId="pd-export-drill" />}</>}</div>}
      <div className="mdm-panel" data-testid="pd-alerts"><h2>{t('alerts')}</h2>{d.alerts.length === 0 ? <p className="muted" data-testid="pd-alerts-empty">{t('noAlerts')}</p> : <ul>{d.alerts.map((a) => <li key={a.code} data-testid="pd-alert" className={a.level === 'bad' ? 'field-error' : ''}><button type="button" className="link-button" onClick={() => setOpen(a.drill)}>{a.text}</button></li>)}</ul>}</div>
      <h2>{t('queues')}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }} data-testid="pd-queues">{queues.map((qq) => <div key={qq.label} className="mdm-panel" data-testid="pd-queue"><h3>{qq.label} <strong>{qq.count}</strong></h3>
        {qq.records.length === 0 ? <p className="muted">{t('queueEmpty')}</p> : <ul>{qq.records.map((r, i) => <li key={`${r.id}-${i}`}><Link to={r.link}>{r.docNo}</Link> {r.label}{r.note ? <span className="muted small"> · {r.note}</span> : null}{r.ageDays != null ? <span className="muted small"> · {r.ageDays} {t('days')}</span> : null}</li>)}</ul>}
        <div className="actions-row no-print"><button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setOpen(qq.drill)}>{t('records')}</button></div></div>)}</div>
      {k.fleet.count === 0 ? <div className="mdm-panel" data-testid="pd-empty"><h2>{t('emptyTitle')}</h2><p className="muted">{t('emptyBody')}</p><Link to="/plant/equipment/new">{t('newTitle')}</Link></div>
        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          <div className="mdm-panel"><h2>{t('byState')}</h2><Bars rows={d.charts.byState} format={(n) => String(n)} testId="pd-bars-state" label={t('byState')} /></div>
          <div className="mdm-panel"><h2>{t('byOwnership')}</h2><Bars rows={d.charts.byOwnership} format={(n) => String(n)} testId="pd-bars-own" label={t('byOwnership')} /></div>
          <div className="mdm-panel"><h2>{t('byClass')}</h2><Bars rows={d.charts.byClass} format={(n) => String(n)} testId="pd-bars-class" label={t('byClass')} /></div>
          <div className="mdm-panel"><h2>{t('expiryByMonth')}</h2><Bars rows={d.charts.expiryByMonth} format={(n) => String(n)} testId="pd-bars-expiry" label={t('expiryByMonth')} /></div></div>}
    </section>
  );
}
