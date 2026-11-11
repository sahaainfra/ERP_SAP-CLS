import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, Tile, usePageTitle } from '../core/pages/ui.jsx';
import { fmtDate, px } from './api.js';

// Expediting dashboard (part 15.07, FR-05): long-lead items, milestones past their date, orders expected after the date required on site (with the activities that wait for them), inspections called, shipments on their way and dispatches blocked for want of a release note.
export default function ExpeditingDashboardPage() {
  const t = useT('proc'); usePageTitle(t('x.dashTitle')); const [projectId, setProjectId] = useState('');
  const pq = useQuery({ queryKey: ['proc', 'projects'], queryFn: px.projects, retry: false }); const q = useQuery({ queryKey: ['proc', 'xpd-dash', projectId], queryFn: () => px.dashboard(projectId), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('x.dashTitle')} permission="proc.expediting_plan.view" />;
  if (q.isPending) return <Skeleton label={t('x.dashTitle')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const k = d.tiles; const none = (n) => (n === 0 ? 'ok' : 'bad');
  const tbl = (id, caption, head, rows) => rows.length > 0 && <div className="table-scroll"><table className="data-table" data-testid={id}><caption>{caption}</caption><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows}</tbody></table></div>;
  return (
    <section aria-labelledby="xd-h" data-testid="proc-xd"><h1 id="xd-h">{t('x.dashTitle')}</h1><p className="muted">{t('x.dashIntro')}</p>
      <div className="actions-row no-print"><label>{t('x.project')} <select value={projectId} onChange={(ev) => setProjectId(ev.target.value)} style={{ minHeight: 44 }} data-testid="xd-project"><option value="">{t('x.allProjects')}</option>{(pq.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></label>
        <Link to="/proc/expediting-plans">{t('x.plansTitle')}</Link> <Link to="/proc/inspections">{t('x.inspTitle')}</Link> <Link to="/proc/shipments">{t('x.shipTitle')}</Link></div>
      <div className="tiles" data-testid="xd-tiles"><Tile label={t('x.tilePlans')} value={k.activePlans} testId="xd-plans" /><Tile label={t('x.tileLongLead')} value={k.longLead} testId="xd-longlead" /><Tile label={t('x.tileAtRisk')} value={k.atRisk} status={none(k.atRisk)} testId="xd-atrisk" /><Tile label={t('x.tileDelayed')} value={k.delayedMilestones} status={none(k.delayedMilestones)} testId="xd-delayed" />
        <Tile label={t('x.tileInsp')} value={k.inspectionsDue} testId="xd-insp" /><Tile label={t('x.tileTransit')} value={k.inTransit} testId="xd-transit" /><Tile label={t('x.tileBlocked')} value={k.blocked} status={none(k.blocked)} testId="xd-blocked" /></div>
      {tbl('xd-risk-table', t('x.atRiskTitle'), [t('x.plan'), t('x.order'), t('x.vendor'), t('x.requiredOnSite'), t('x.eta'), t('x.daysLate'), t('x.activities')], d.atRisk.map((x) => <tr key={x.planId} data-testid="xd-risk-row"><td><Link to={`/proc/expediting-plans?id=${x.planId}`}>{x.docNo}</Link></td><td>{x.poNo}</td><td>{x.vendor}</td><td>{fmtDate(x.requiredOnSite)}</td><td>{fmtDate(x.eta)}</td><td className="num">{x.daysLate}</td><td>{x.activities.map((a) => a.code).join(', ') || '—'}</td></tr>))}
      {tbl('xd-delayed-table', t('x.delayedTitle'), [t('x.plan'), t('x.order'), t('x.milestone'), t('x.planned'), t('x.daysLate')], d.delayed.map((x) => <tr key={x.milestoneId} data-testid="xd-delayed-row"><td><Link to={`/proc/expediting-plans?id=${x.planId}`}>{x.docNo}</Link></td><td>{x.poNo}</td><td>{x.name}</td><td>{fmtDate(x.plannedDate)}</td><td className="num">{x.daysLate}</td></tr>))}
      {tbl('xd-insp-table', t('x.inspDueTitle'), [t('x.inspection'), t('x.order'), t('x.type'), t('x.callDate')], d.inspections.map((x) => <tr key={x.id}><td><Link to={`/proc/inspections?id=${x.id}`}>{x.docNo}</Link></td><td>{x.poNo}</td><td>{t(`x.t.${x.itype}`)}</td><td>{fmtDate(x.callDate)}{x.overdue && <span className="field-error"> {t('x.overdue')}</span>}</td></tr>))}
      {tbl('xd-transit-table', t('x.transitTitle'), [t('x.shipment'), t('x.order'), t('x.vendor'), t('x.eta')], d.shipments.map((x) => <tr key={x.id}><td><Link to={`/proc/shipments?id=${x.id}`}>{x.docNo}</Link>{x.isOdc ? ` · ${t('x.odc')}` : ''}</td><td>{x.poNo}</td><td>{x.vendor}</td><td>{fmtDate(x.eta)}</td></tr>))}
      {tbl('xd-blocked-table', t('x.blockedTitle'), [t('x.shipment'), t('x.order')], d.blocked.map((x) => <tr key={x.id} data-testid="xd-blocked-row"><td><Link to={`/proc/shipments?id=${x.id}`}>{x.docNo}</Link></td><td>{x.poNo}</td></tr>))}
    </section>
  );
}
