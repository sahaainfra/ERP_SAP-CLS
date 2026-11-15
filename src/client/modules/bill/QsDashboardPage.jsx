import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../site/parts.jsx';
import { bill, qs } from './api.js';
import { big } from './BillParts.jsx';

// QS Management Dashboard (part 22.08): the chain from work done to money collected, the variations and claims in progress, the queues of work to do, the margin of the subcontract bills against the client's certification and the indicators of value leaking away. Every tile and queue opens the records behind it.
const mf = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); const money = (v) => (v == null ? '—' : `₹ ${mf.format(v)}`);
const TONE = { green: 'APPROVED', amber: 'RETURNED', red: 'REJECTED', neutral: 'DRAFT' };
const QUEUES = ['mbPending', 'billsToPrepare', 'certAwaited', 'deviationDue'];

function DrillPanel({ kind, projectId, onClose }) {
  const t = useT('bill'); const q = useQuery({ queryKey: ['bill', 'qs-drill', kind, projectId], queryFn: () => bill.get(`/qs-dashboard/drill${qs({ kind, projectId })}`), retry: false });
  return (
    <div className="mdm-panel" data-testid="bill-qd-drill" data-kind={kind}><h2>{t(`qd.k.${kind}`)}</h2>
      {q.isPending ? <Skeleton label={t(`qd.k.${kind}`)} rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.data.rows.length === 0 ? <p className="muted">{t('qd.drillEmpty')}</p> : (
        <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('project')}</th><th>{t('rt.ref')}</th><th>{t('qd.what')}</th><th className="num">{t('qd.value')}</th><th className="num">{t('qd.age')}</th></tr></thead>
          <tbody>{q.data.rows.map((r, i) => <tr key={`${r.ref}-${i}`} data-testid="bill-qd-drill-row"><td>{r.project}</td><td><button type="button" className="btn" onClick={() => navigateTo(r.link)}>{r.ref}</button></td><td>{r.description ?? r.state ?? '—'}</td><td className="num">{r.value == null ? '—' : money(r.value)}</td><td className="num">{r.ageDays ?? '—'}</td></tr>)}</tbody></table></div>)}
      <div className="actions-row no-print"><button type="button" className="btn" onClick={onClose}>{t('rc.close')}</button></div></div>
  );
}

export default function QsDashboardPage() {
  const t = useT('bill'); usePageTitle(t('qd.title')); const sp = useSearch(); const [projectId, setProjectId] = useState(sp.get('projectId') ?? ''); const [drill, setDrill] = useState(null);
  const o = useQuery({ queryKey: ['bill', 'qs-options'], queryFn: () => bill.get('/qs-dashboard/options'), retry: false });
  const q = useQuery({ queryKey: ['bill', 'qs-dashboard', projectId], queryFn: () => bill.get(`/qs-dashboard${qs({ projectId })}`), retry: false, placeholderData: (p) => p });
  if (q.error?.status === 403) return <NoPermission what={t('qd.title')} permission="bill.qs_dashboard.view" />; if (q.isPending) return <Skeleton label={t('qd.title')} rows={6} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const b = d.backToBack;
  return (
    <section aria-labelledby="qd-h" data-testid="bill-qs-dashboard"><h1 id="qd-h">{t('qd.title')}</h1><p className="muted">{t('qd.intro', { date: d.asOf })}</p>
      <div className="mdm-panel no-print"><div className="form-grid"><Field label={t('project')} name="projectId" error={null}><select value={projectId} onChange={(e) => { setProjectId(e.target.value); setDrill(null); }} style={big} data-testid="bill-qd-project"><option value="">{t('qd.portfolio')}</option>{(o.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field></div>
        <div className="actions-row"><button type="button" className="btn" onClick={() => bill.exportFile(`/qs-dashboard/export${qs({ projectId })}`, 'qs-dashboard.csv')} data-testid="bill-qd-export">{t('rc.export')}</button> · <Link to="/bill/qty-recon">{t('qd.recon')}</Link> · <Link to="/bill/invoice-hub">{t('hub.title')}</Link> · <Link to="/bill/retention">{t('rt.title')}</Link></div></div>
      {d.empty ? <div className="empty-state"><h2>{t('qd.emptyTitle')}</h2><p>{t('qd.emptyBody')}</p></div> : (<>
        <div className="form-grid" data-testid="bill-qd-tiles">{d.kpis.map((k) => (
          <div className="mdm-panel" key={k.key} data-testid={`bill-qd-kpi-${k.key}`} data-status={k.status}><div className="muted">{t(`qd.k.${k.key}`)}</div>
            <strong style={{ fontSize: '1.5rem' }} data-testid={`bill-qd-kpi-${k.key}-value`}>{k.unit === 'Rs' ? money(k.value) : k.value}</strong>
            <div><StatusBadge status={TONE[k.status]} label={t(`qd.s.${k.status}`)} /></div>
            {k.note && <div className="muted">{k.note}</div>}
            <div className="actions-row no-print"><button type="button" className="btn" onClick={() => setDrill(k.key)} data-testid={`bill-qd-open-${k.key}`}>{t('qd.records')}</button> <button type="button" className="btn" onClick={() => navigateTo(k.drill)}>{t('qd.list')}</button></div></div>))}</div>
        {drill && <DrillPanel kind={drill} projectId={projectId} onClose={() => setDrill(null)} />}
        <h2>{t('qd.queues')}</h2>
        <div className="form-grid" data-testid="bill-qd-queues">{QUEUES.map((k) => { const x = d.queues[k]; return (
          <div className="mdm-panel" key={k} data-testid={`bill-qd-queue-${k}`} data-count={x.count}><div className="muted">{t(`qd.k.${k}`)}</div><strong style={{ fontSize: '1.5rem' }}>{x.count}</strong>{x.late > 0 && <div><StatusBadge status="REJECTED" label={t('qd.late', { n: x.late })} /></div>}
            {x.rows.length === 0 ? <p className="muted">{t('qd.queueEmpty')}</p> : <ul>{x.rows.slice(0, 5).map((r, i) => <li key={`${r.ref}-${i}`}><button type="button" className="btn" onClick={() => navigateTo(r.link)} data-testid={`bill-qd-queue-${k}-row`}>{r.ref}</button> {r.project}{r.amount != null ? ` · ${money(r.amount)}` : ''}{r.ageDays != null ? ` · ${t('qd.days', { n: r.ageDays })}` : ''}</li>)}</ul>}
            <div className="no-print"><button type="button" className="btn" onClick={() => setDrill(k)} data-testid={`bill-qd-open-${k}`}>{t('qd.records')}</button></div></div>); })}</div>
        <h2>{t('qd.b2b')}</h2>
        <div className="table-scroll"><table className="data-table" data-testid="bill-qd-b2b"><thead><tr><th>{t('project')}</th><th className="num">{t('qd.certified')}</th><th className="num">{t('qd.subBilled')}</th><th className="num">{t('qd.margin')}</th></tr></thead>
          <tbody>{b.rows.length === 0 ? <tr><td colSpan={4} className="muted">{t('qd.noB2b')}</td></tr> : b.rows.map((r) => <tr key={r.projectId}><td>{r.project}</td><td className="num">{money(r.certified)}</td><td className="num">{money(r.subBilled)}</td><td className="num">{b.masked ? t('qd.masked') : money(r.margin)}</td></tr>)}
            <tr data-testid="bill-qd-b2b-total"><th>{t('qd.total')}</th><th className="num">{money(b.certified)}</th><th className="num">{money(b.subBilled)}</th><th className="num" data-testid="bill-qd-margin">{b.masked ? t('qd.masked') : `${money(b.margin)}${b.marginPct != null ? ` (${b.marginPct}%)` : ''}`}</th></tr></tbody></table></div>
        <h2>{t('qd.leakage')}</h2>
        <ul data-testid="bill-qd-leakage">{d.leakage.map((l) => <li key={l.key} data-status={l.status}><StatusBadge status={TONE[l.status]} label={t(`qd.s.${l.status}`)} /> <Link to={l.drill}>{t(`qd.l.${l.key}`)}</Link>: <strong>{money(l.value)}</strong></li>)}</ul>
        <p data-testid="bill-qd-pending">{t('qd.pending', { n: d.pending })} <Link to="/approvals">{t('dash.approvals')}</Link></p>
        {!projectId && d.portfolio.length > 0 && (<><h2>{t('qd.portfolio')}</h2>
          <div className="table-scroll"><table className="data-table" data-testid="bill-qd-portfolio"><thead><tr><th>{t('project')}</th><th className="num">{t('qd.k.workNotMeasured')}</th><th className="num">{t('qd.k.measuredNotCertified')}</th><th className="num">{t('qd.k.certifiedNotBilled')}</th><th className="num">{t('qd.k.billedNotCollected')}</th><th className="num">{t('qd.k.unbilledWip')}</th></tr></thead>
            <tbody>{d.portfolio.map((p) => <tr key={p.projectId} data-testid="bill-qd-portfolio-row"><td><button type="button" className="btn" onClick={() => setProjectId(String(p.projectId))}>{p.project}</button> {p.name}</td><td className="num">{money(p.workNotMeasured)}</td><td className="num">{money(p.measuredNotCertified)}</td><td className="num">{money(p.certifiedNotBilled)}</td><td className="num">{money(p.billedNotCollected)}</td><td className="num">{money(p.unbilledWip)}</td></tr>)}</tbody></table></div></>)}
      </>)}
    </section>
  );
}
