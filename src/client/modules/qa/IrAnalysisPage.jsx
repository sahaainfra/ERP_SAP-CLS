import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { qa } from './api.js';
import { sel } from './QaParts.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// IR Rejection Analysis (part 18.02): how many requests are open and how old, the first-time approval rate, why requests are rejected and which are waiting for a re-inspection. Every figure opens the requests behind it.
export default function IrAnalysisPage() {
  const t = useT('qa'); usePageTitle(t('ira.title')); const [projectId, setProjectId] = useState(''); const oq = useQuery({ queryKey: ['qa', 'projects'], queryFn: () => qa.get('/projects').then((p) => ({ projects: p })), retry: false });
  const q = useQuery({ queryKey: ['qa', 'ir-analysis', projectId], queryFn: () => qa.get(`/ir-analysis${projectId ? `?projectId=${projectId}` : ''}`), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('ira.title')} permission="qa.inspection_request.view" />; if (q.isPending) return <Skeleton label={t('ira.title')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const a = q.data; const tile = (k, v, to) => <KpiTile key={k} label={t(`ira.${k}`)} value={v} to={to} testid={`ira-${k}`} />;
  return (
    <section aria-labelledby="ira-h" data-testid="qa-ir-analysis"><PageHeader id="ira-h" title={t('ira.title')} subtitle={<Link to="/qa/inspection-requests">{t('ir.title')}</Link>} />
      <div className="mdm-panel no-print"><label>{t('project')}<select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={sel} data-testid="ira-project"><option value="">{t('allProjects')}</option>{(oq.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></label></div>
      <KpiRow>{tile('total', a.total, '/qa/inspection-requests')}{tile('open', a.open, '/qa/inspection-requests?filter[status]=SUBMITTED')}{tile('overdue', a.overdue)}{tile('firstTime', a.firstTimeApprovalPct == null ? '—' : `${a.firstTimeApprovalPct} %`)}{tile('rejected', a.rejected, '/qa/inspection-requests?filter[status]=REJECTED')}{tile('pending', a.pendingReinspection)}</KpiRow>
      <div className="table-scroll"><table className="data-table" data-testid="ira-ageing"><caption>{t('ira.ageing')}</caption><thead><tr><th>{t('ira.days')}</th><th className="num">{t('ira.count')}</th></tr></thead><tbody>{a.ageing.map((b) => <tr key={b.label}><td>{b.label}</td><td className="num">{b.count}</td></tr>)}</tbody></table></div>
      <div className="table-scroll"><table className="data-table" data-testid="ira-reasons"><caption>{t('ira.byReason')}</caption><thead><tr><th>{t('ir.reason')}</th><th className="num">{t('ira.count')}</th></tr></thead><tbody>{a.byReason.length === 0 ? <tr><td colSpan={2}>{t('ira.noRejections')}</td></tr> : a.byReason.map((b) => <tr key={b.code} data-testid="ira-reason-row"><td>{b.label}</td><td className="num">{b.count}</td></tr>)}</tbody></table></div>
      <div className="table-scroll"><table className="data-table"><caption>{t('ira.byPoint')}</caption><thead><tr><th>{t('itp.point')}</th><th className="num">{t('ira.count')}</th></tr></thead><tbody>{a.byPoint.map((b) => <tr key={b.code}><td>{t(`pt.${b.code}`)}</td><td className="num">{b.count}</td></tr>)}</tbody></table></div>
    </section>
  );
}
