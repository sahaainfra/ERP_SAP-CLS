import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { SUB_TYPES, sb } from './api.js';
import { ProjectSelect } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Submittal Schedule vs Required Dates (part 11.03, FR-06): required-by against submitted and responded, the overdue report and the count by type.
export default function SubmittalSchedulePage() {
  const t = useT('engg');
  usePageTitle(t('sub.scheduleTitle'));
  const [projectId, setProjectId] = useState('');
  const q = useQuery({ queryKey: ['engg', 'submittal-schedule', projectId], queryFn: () => sb.schedule(projectId), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('sub.scheduleTitle')} permission="engg.submittal.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return (
    <section aria-labelledby="ss-h" data-testid="sub-schedule">
      <PageHeader id="ss-h" title={t('sub.scheduleTitle')} />
      <ProjectSelect value={projectId} onChange={setProjectId} allowAll testId="ss-project" />
      {q.isPending ? <Skeleton label={t('sub.scheduleTitle')} rows={4} /> : (
        <>
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(9rem, 1fr))', gap: '0.75rem' }} data-testid="ss-counts">
            {[['total', d.counts.total], ['onTime', d.counts.onTime], ['late', d.counts.late], ['overdue', d.counts.overdue], ['pending', d.counts.pending], ['rejected', d.counts.rejected]].map(([k, v]) => <li key={k} className="mdm-panel" data-testid={`ss-count-${k}`} data-value={v}><strong style={{ fontSize: '1.5rem' }}>{v}</strong><br /><span className="muted">{t(`sched.${k}`)}</span></li>)}
          </ul>
          <div className="mdm-panel" data-testid="ss-bytype"><h2>{t('sched.byType')}</h2>
            <table><thead><tr><th>{t('sub.type')}</th><th>{t('sched.total')}</th><th>{t('sched.approved')}</th><th>{t('sched.overdue')}</th></tr></thead>
              <tbody>{SUB_TYPES.filter((k) => d.byType[k]).map((k) => <tr key={k}><td>{t(`stype.${k}`)}</td><td>{d.byType[k].total}</td><td>{d.byType[k].approved}</td><td>{d.byType[k].overdue}</td></tr>)}</tbody></table></div>
          <div className="mdm-panel" data-testid="ss-rows"><h2>{t('sched.schedule')}</h2>
            {d.rows.length === 0 ? <p className="muted">{t('sched.none')}</p> : (
              <div className="table-scroll"><table><thead><tr><th>{t('col.docNo')}</th><th>{t('col.title')}</th><th>{t('sub.type')}</th><th>{t('rfi.requiredBy')}</th><th>{t('sub.submittedOn')}</th><th>{t('sub.responseOn')}</th><th>{t('col.status')}</th><th>{t('dash.late')}</th></tr></thead>
                <tbody>{d.rows.map((r) => <tr key={r.id} data-testid={`ss-row-${r.submittalNo}`} data-state={r.state}><td><Link to={`/engg/submittal?id=${r.id}`}>{r.submittalNo}</Link></td><td>{r.title}</td><td>{t(`stype.${r.type}`)}</td><td>{r.requiredBy}</td><td>{r.submittedOn ?? '—'}</td><td>{r.responseOn ?? '—'}</td><td>{t(`sched.state.${r.state}`)}</td><td>{r.varianceDays}</td></tr>)}</tbody></table></div>
            )}</div>
          <p className="actions-row"><Link to="/engg/submittals">{t('nav.submittals')}</Link></p>
        </>
      )}
    </section>
  );
}
