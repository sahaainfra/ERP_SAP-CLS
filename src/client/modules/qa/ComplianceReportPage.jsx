import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { fmtQty, qa } from './api.js';
import { sel } from './QaParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Test Frequency Compliance (part 18.03, FR-05): for every test with a frequency rule, what was received, how many tests that needs, how many were requested; a shortfall is overdue and opens the tests behind it.
export default function ComplianceReportPage() {
  const t = useT('qa'); usePageTitle(t('tc.title')); const [projectId, setProjectId] = useState(''); const oq = useQuery({ queryKey: ['qa', 'projects'], queryFn: () => qa.get('/projects').then((p) => ({ projects: p })), retry: false });
  const q = useQuery({ queryKey: ['qa', 'compliance', projectId], queryFn: () => qa.get(`/test-compliance${projectId ? `?projectId=${projectId}` : ''}`), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('tc.title')} permission="qa.test_request.view" />; if (q.isPending) return <Skeleton label={t('tc.title')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return (
    <section aria-labelledby="tc-h" data-testid="qa-compliance"><PageHeader id="tc-h" title={t('tc.title')} subtitle={<><Link to="/qa/test-requests">{t('tr.title')}</Link> · {t('tc.overdueCount', { n: d.overdue })}</>} />
      <div className="mdm-panel no-print"><label>{t('project')}<select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={sel} data-testid="tc-project"><option value="">{t('allProjects')}</option>{(oq.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></label>
        <button type="button" className="btn" style={{ minHeight: 'var(--erp-target-min)' }} onClick={() => qa.exportFile(`/test-compliance/export${projectId ? `?projectId=${projectId}` : ''}`, 'test-compliance.csv').catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="tc-export">{t('export')}</button></div>
      {d.rows.length === 0 ? <EmptyState title={t('tc.emptyTitle')} message={t('tc.emptyBody')} /> : (
        <div className="table-scroll"><table className="data-table" data-testid="tc-table"><thead><tr><th>{t('project')}</th><th>{t('tr.test')}</th><th>{t('tc.rule')}</th><th className="num">{t('tc.received')}</th><th className="num">{t('tc.needed')}</th><th className="num">{t('tc.done')}</th><th className="num">{t('tc.shortfall')}</th><th>{t('tc.status')}</th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={`${r.projectId}-${r.testId}`} data-testid="tc-row" data-status={r.status}><td>{r.project}</td><td>{r.test}</td><td>{r.rule}</td><td className="num">{fmtQty(r.received)} {r.uom ?? ''}</td><td className="num">{r.required}</td><td className="num"><Link to={`/qa/test-requests?filter[project]=${r.project}`}>{r.done}</Link></td><td className="num">{r.shortfall}</td><td><StatusBadge status={r.status === 'OK' ? 'APPROVED' : 'REJECTED'} label={t(`tc.${r.status}`)} /></td></tr>)}</tbody></table></div>)}
    </section>
  );
}
