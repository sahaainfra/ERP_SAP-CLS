import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { qa } from './api.js';
import { sel } from './QaParts.jsx';

// NCR Analysis (part 18.04, FR-05): open and closed, ageing, closure time, by type and by responsible party, the repeats, and the cost where the person may see it.
const Table = ({ rows, label, testId, t }) => <div className="table-scroll"><table className="data-table" data-testid={testId}><caption>{label}</caption><thead><tr><th>{t('nca.group')}</th><th className="num">{t('nca.count')}</th><th className="num">{t('nca.open')}</th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={3}>{t('nca.none')}</td></tr> : rows.map((b) => <tr key={b.code} data-testid={`${testId}-row`}><td>{b.label}</td><td className="num">{b.count}</td><td className="num">{b.open}</td></tr>)}</tbody></table></div>;
export default function NcrAnalysisPage() {
  const t = useT('qa'); usePageTitle(t('nca.title')); const [projectId, setProjectId] = useState(''); const oq = useQuery({ queryKey: ['qa', 'ir-options-a'], queryFn: () => qa.get('/inspection-requests/options'), retry: false });
  const q = useQuery({ queryKey: ['qa', 'ncr-analysis', projectId], queryFn: () => qa.get(`/ncr-analysis${projectId ? `?projectId=${projectId}` : ''}`), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('nca.title')} permission="qa.ncr.view" />; if (q.isPending) return <Skeleton label={t('nca.title')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const a = q.data; const tile = (k, v, to) => <div key={k} className="mdm-panel" data-testid={`nca-${k}`}><div className="muted">{t(`nca.${k}`)}</div><strong style={{ fontSize: '1.6rem' }}>{v}</strong>{to && <div><Link to={to}>{t('ira.open')}</Link></div>}</div>;
  return (
    <section aria-labelledby="nca-h" data-testid="qa-ncr-analysis"><h1 id="nca-h">{t('nca.title')}</h1><p className="muted"><Link to="/qa/ncrs">{t('ncr.title')}</Link></p>
      <div className="mdm-panel no-print"><label>{t('project')}<select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={sel} data-testid="nca-project"><option value="">{t('allProjects')}</option>{(oq.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></label></div>
      <div className="form-grid">{tile('total', a.total, '/qa/ncrs')}{tile('openNcr', a.open, '/qa/ncrs?filter[status]=OPEN')}{tile('closed', a.closed, '/qa/ncrs?filter[status]=CLOSED')}{tile('critical', a.criticalOpen, '/qa/ncrs?filter[severity]=CRITICAL')}{tile('avgDays', a.avgClosureDays ?? '—')}{a.rectificationCost != null && tile('cost', a.rectificationCost)}{a.backcharge != null && tile('backcharge', a.backcharge)}</div>
      <div className="table-scroll"><table className="data-table" data-testid="nca-ageing"><caption>{t('nca.ageing')}</caption><thead><tr><th>{t('ira.days')}</th><th className="num">{t('ira.count')}</th></tr></thead><tbody>{a.ageing.map((b) => <tr key={b.label}><td>{b.label}</td><td className="num">{b.count}</td></tr>)}</tbody></table></div>
      <Table rows={a.bySeverity} label={t('nca.bySeverity')} testId="nca-severity" t={t} /><Table rows={a.byType} label={t('nca.byType')} testId="nca-type" t={t} /><Table rows={a.byResponsible} label={t('nca.byParty')} testId="nca-party" t={t} /><Table rows={a.repeats} label={t('nca.repeats')} testId="nca-repeats" t={t} />
    </section>
  );
}
