import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, Tile, usePageTitle } from '../core/pages/ui.jsx';
import { Bars } from '../proc/AnaParts.jsx';
import { fmtDate } from './api.js';
import { mm } from './api.js';
import { ExportButton, FilterPanel, RecordTable, rs } from './MmdParts.jsx';

// Materials management dashboard (part 16.11, FR-01 to FR-04): inventory value, stock turns, items below reorder, receipts waiting for inspection, open material requests, issues today, transfers in transit, non-moving value, wastage against the allowed
// and the reconciliation status; the work queues; the alerts. Company, project and store views are the same page with different filters. Every tile opens the records it counts; the server works every figure out from the ledgers.
const pctText = (p) => (p == null ? '—' : `${p}%`);
export default function MaterialsDashboardPage() {
  const t = useT('inv'); usePageTitle(t('md.title')); const [f, setF] = useState({ projectId: '', storeId: '', from: '', to: '' }); const [open, setOpen] = useState(null);
  const q = useQuery({ queryKey: ['inv', 'mm-dash', f], queryFn: () => mm.dashboard(f), retry: false }); const tq = useQuery({ queryKey: ['inv', 'mm-tasks'], queryFn: mm.myTasks, retry: false });
  const dq = useQuery({ queryKey: ['inv', 'mm-drill', f, open], queryFn: () => mm.drill({ ...f, kind: open }), enabled: Boolean(open), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('md.title')} permission="inv.dashboard.view" />;
  if (q.isPending) return <Skeleton label={t('md.title')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const k = d.kpis; const rc = k.reconciliation;
  const tiles = [
    ['value', t('md.tileValue'), d.canValues ? rs(k.inventoryValue.value) : '—', k.inventoryValue.status, k.inventoryValue.reconciled ? t('md.ledgerAgrees', { n: k.inventoryValue.items }) : t('md.ledgerDiffers', { v: rs(k.inventoryValue.difference) }), 'inventory', k.inventoryValue.changePct == null ? null : `${k.inventoryValue.changePct > 0 ? '▲' : '▼'} ${Math.abs(k.inventoryValue.changePct)}% ${t('md.vsMonthEnd')}`],
    ['turns', t('md.tileTurns'), k.stockTurns.turns == null ? '—' : k.stockTurns.turns, k.stockTurns.status, t('md.targetAtLeast', { n: k.stockTurns.target }), 'inventory'],
    ['reorder', t('md.tileReorder'), k.belowReorder.count, k.belowReorder.status, t('md.outOfStock', { n: k.belowReorder.out }), 'belowReorder'],
    ['inspection', t('md.tileInspection'), k.pendingGrnInspections.count, k.pendingGrnInspections.status, t('md.lateOldest', { late: k.pendingGrnInspections.late, n: k.pendingGrnInspections.oldestDays }), 'pendingGrn'],
    ['mrs', t('md.tileMrs'), k.openMrs.count, k.openMrs.status, t('md.awaitingLate', { a: k.openMrs.awaiting, l: k.openMrs.late }), 'openMrs'],
    ['issues', t('md.tileIssues'), k.issuesToday.count, 'neutral', d.canValues ? rs(k.issuesToday.value) : '', 'issuesToday'],
    ['transit', t('md.tileTransit'), k.transfersInTransit.count, k.transfersInTransit.status, t('md.late', { n: k.transfersInTransit.late }), 'inTransit'],
    ['nonmoving', t('md.tileNonMoving'), d.canValues ? rs(k.nonMoving.value) : '—', k.nonMoving.status, t('md.nonMovingHint', { p: pctText(k.nonMoving.pct), t: k.nonMoving.target, d: k.nonMoving.days }), 'nonMoving'],
    ['wastage', t('md.tileWastage'), k.wastage.available ? pctText(k.wastage.pct) : '—', k.wastage.status, k.wastage.available ? t('md.wastageHint', { a: pctText(k.wastage.allowedPct), n: k.wastage.overAllowed }) : t('md.unavailable'), 'wastage'],
    ['recon', t('md.tileRecon'), rc.available ? `${rc.approved}/${rc.sites}` : '—', rc.available ? rc.status : 'neutral', rc.available ? t('md.reconHint', { p: rc.period, m: rc.missing }) : t('md.unavailable'), null],
  ];
  const queues = Object.values(d.queues); const fq = { projectId: f.projectId, storeId: f.storeId, from: f.from, to: f.to };
  return (
    <section aria-labelledby="md-h" data-testid="inv-md"><h1 id="md-h">{t('md.title')} · {d.view === 'store' ? `${t('md.viewStore')} ${d.store.code}` : d.view === 'project' ? `${t('md.viewProject')} ${d.project.code}` : t('md.viewCompany')}</h1><p className="muted">{t('md.intro')} {fmtDate(d.period.from)} – {fmtDate(d.period.to)}</p>
      <FilterPanel value={f} onChange={(v) => { setF(v); setOpen(null); }} />
      <div className="actions-row no-print"><Link to="/approvals">{t('md.myActions')}{tq.data != null ? ` (${tq.data})` : ''}</Link><Link to="/inv/material-funnel">{t('md.funnelTitle')}</Link><Link to="/inv/dashboard">{t('dashTitle')}</Link>{d.procurement && <Link to={d.procurement.route}>{t('md.procurement', { a: d.procurement.openPrs, b: d.procurement.ordersAwaitingApproval, c: d.procurement.overdueDeliveries })}</Link>}{d.canExport && <ExportButton query={{ ...fq, kind: 'kpis' }} name="materials-dashboard.csv" />}</div>
      <div className="tiles" data-testid="md-tiles">{tiles.map(([id, label, value, status, hint, kind, extra]) => <div key={id} className="tile-wrap"><Tile label={label} value={value} status={status === 'warn' ? 'neutral' : status} hint={hint} testId={`md-${id}`} />{extra && <span className="muted small" data-testid="md-trend"> {extra}</span>}
        {kind ? <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setOpen(open === kind ? null : kind)} aria-expanded={open === kind} data-testid={`md-open-${id}`}>{t('md.records')}</button> : <Link to="/inv/reconciliations">{t('md.openList')}</Link>}</div>)}</div>
      {open && <div className="mdm-panel" data-testid="md-drill"><h2>{dq.data?.title ?? t('md.records')}</h2>{dq.isPending ? <Skeleton label={t('md.records')} rows={3} /> : dq.isError ? <ErrorState error={dq.error} onRetry={dq.refetch} /> : <><p className="muted small">{t('md.shown', { n: dq.data.rows.length, total: dq.data.total })}</p><RecordTable rows={dq.data.rows} />{d.canExport && <ExportButton query={{ ...fq, kind: open }} name={`materials-${open}.csv`} testId="md-export-drill" />}</>}</div>}
      <div className="mdm-panel" data-testid="md-alerts"><h2>{t('md.alerts')}</h2>{d.alerts.length === 0 ? <p className="muted" data-testid="md-alerts-empty">{t('md.noAlerts')}</p> : <ul>{d.alerts.map((a) => <li key={a.code} data-testid="md-alert" className={a.level === 'bad' ? 'field-error' : ''}>{a.drill ? <button type="button" className="link-button" onClick={() => setOpen(a.drill)}>{a.text}</button> : <Link to={a.link}>{a.text}</Link>}</li>)}</ul>}</div>
      <h2>{t('md.queues')}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }} data-testid="md-queues">{queues.map((qq) => <div key={qq.label} className="mdm-panel" data-testid="md-queue"><h3>{qq.label} <strong data-testid="md-queue-count">{qq.count}</strong></h3>
        {qq.records.length === 0 ? <p className="muted">{t('md.queueEmpty')}</p> : <ul>{qq.records.map((r) => <li key={r.id}><Link to={r.link}>{r.docNo}</Link> {r.label}{r.ageDays != null ? <span className="muted small"> · {r.ageDays} {t('md.days')}</span> : null}{r.late ? <span className="field-error small"> · {t('md.lateTag')}</span> : null}</li>)}</ul>}
        <div className="actions-row no-print"><button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setOpen(qq.drill)} data-testid={`md-queue-open-${qq.drill}`}>{t('md.records')}</button><Link to={qq.route}>{t('md.openList')}</Link></div></div>)}</div>
      {d.canValues && d.charts.valueByStore.length > 0 ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}><div className="mdm-panel"><h2>{t('md.valueByStore')}</h2><Bars rows={d.charts.valueByStore.map((s) => ({ key: s.id, label: `${s.code} ${s.name}`, value: s.value, link: s.link }))} format={rs} testId="md-bars-store" label={t('md.valueByStore')} /></div>
        <div className="mdm-panel"><h2>{t('md.valueByProject')}</h2><Bars rows={d.charts.valueByProject.map((p) => ({ key: p.key, label: p.label, value: p.value }))} format={rs} testId="md-bars-project" label={t('md.valueByProject')} /></div></div>
        : <div className="mdm-panel" data-testid="md-empty"><h2>{t('md.emptyTitle')}</h2><p className="muted">{t('md.emptyBody')}</p><Link to="/inv/stores?new=1">{t('newStore')}</Link></div>}
      {d.canValues && d.charts.valueTrend.length > 0 && <div className="mdm-panel"><h2>{t('md.trend')}</h2><Bars rows={d.charts.valueTrend.map((m) => ({ key: m.month, label: m.month, value: Math.max(0, m.value) }))} format={rs} testId="md-bars-trend" label={t('md.trend')} /></div>}
    </section>
  );
}
