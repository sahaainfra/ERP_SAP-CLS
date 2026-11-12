import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { gt } from './api.js';

// Gate Register (part 16.02, FR-07): every vehicle in and every gate pass out, with the figures of the day and the turnaround time of the delivery vehicles. Each figure opens the records behind it.
export default function GateRegisterPage() {
  const t = useT('inv'); usePageTitle(t('g.registerTitle')); const session = useSession(); const perms = session.data?.permissions ?? []; const [tab, setTab] = useState('in');
  const dq = useQuery({ queryKey: ['inv', 'gate-dashboard'], queryFn: () => gt.dashboard({}), retry: false });
  if (dq.error?.status === 403) return <NoPermission what={t('g.registerTitle')} permission="inv.inward.view" />;
  const d = dq.data; const tiles = d ? [['inToday', d.inToday, 'in'], ['inYard', d.inYard, 'in'], ['awaiting', d.awaitingAcceptance, 'in'], ['unexpected', d.unexpected30, 'in'], ['weightFlags', d.weightFlags30, 'in'], ['turnaround', d.turnaround.avgMin == null ? '—' : `${d.turnaround.avgMin} ${t('g.min')}`, 'in'], ...(d.passesAwaitingApproval != null ? [['passesWaiting', d.passesAwaitingApproval, 'out'], ['outToday', d.outToday, 'out'], ['returnablesOut', d.returnablesOut, 'out'], ['overdue', d.returnablesOverdue, 'out']] : [])] : [];
  return (
    <section aria-labelledby="gr-h" data-testid="gate-register"><h1 id="gr-h">{t('g.registerTitle')}</h1><p className="muted">{t('g.registerIntro')}</p>
      <div className="actions-row no-print">{perms.includes('inv.inward.create') && <Link to="/inv/gate-entry">{t('g.entryTitle')}</Link>} {perms.includes('inv.pass.verify') && <Link to="/inv/gate-exit">{t('g.exitTitle')}</Link>} {perms.includes('inv.pass.create') && <Link to="/inv/gate-pass">{t('g.newPass')}</Link>} <Link to="/inv/gate-passes">{t('g.returnables')}</Link></div>
      {dq.isPending ? <Skeleton label={t('g.registerTitle')} rows={2} /> : dq.isError ? <ErrorState error={dq.error} onRetry={dq.refetch} /> : (
        <div className="kpi-row" data-testid="gr-kpis" role="list">{tiles.map(([k, v, to]) => <button key={k} type="button" role="listitem" className="kpi-tile" style={{ minHeight: 64 }} onClick={() => setTab(to)} data-testid={`gr-kpi-${k}`}><span className="kpi-value">{v}</span><span className="kpi-label">{t(`g.kpi.${k}`)}</span></button>)}</div>)}
      <div role="tablist" aria-label={t('g.registerTitle')} className="actions-row"><button type="button" role="tab" aria-selected={tab === 'in'} className={`btn ${tab === 'in' ? 'btn-primary' : ''}`} onClick={() => setTab('in')} data-testid="gr-tab-in">{t('g.tabIn')}</button><button type="button" role="tab" aria-selected={tab === 'out'} className={`btn ${tab === 'out' ? 'btn-primary' : ''}`} onClick={() => setTab('out')} data-testid="gr-tab-out">{t('g.tabOut')}</button></div>
      {tab === 'in' ? <ListReport key="in" listCode="inv.gate_inward" endpoint="/inv/inward" title={t('g.tabIn')} session={session.data} rowHref={(r) => `/inv/gate-entry?id=${r.id}`} onOpen={(r) => navigateTo(`/inv/gate-entry?id=${r.id}`)} cardFields={['docNo', 'vehicle', 'vendor', 'status']} statusKey="status" dateKey="date" empty={{ title: t('g.inEmptyTitle'), text: t('g.inEmptyBody') }} />
        : <ListReport key="out" listCode="inv.gate_passes" endpoint="/inv/passes" title={t('g.tabOut')} session={session.data} rowHref={(r) => `/inv/gate-pass?id=${r.id}`} onOpen={(r) => navigateTo(`/inv/gate-pass?id=${r.id}`)} cardFields={['docNo', 'type', 'destination', 'status']} statusKey="status" dateKey="date" empty={{ title: t('g.outEmptyTitle'), text: t('g.outEmptyBody') }} />}
    </section>
  );
}
