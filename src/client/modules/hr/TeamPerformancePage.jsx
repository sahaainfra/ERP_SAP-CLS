import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { perf } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Team Performance (HR, part 07.11, manager): the people who report to the manager, directly or through others: KPI score with its colour, goals agreed and waiting, the review stage, open disputes. A row opens that person's KPIs, goals and review.
// The manager can compute the KPIs of the team again. HR sees everybody.
const TONE = { GREEN: 'COMPLETED', AMBER: 'AT_RISK', RED: 'OVERDUE', NONE: 'DRAFT' };
export default function TeamPerformancePage() {
  const t = useT('prf');
  usePageTitle(t('team.title'));
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['perf', 'team'], queryFn: () => perf.team(), retry: false });
  const [note, setNote] = useState(null); const [error, setError] = useState(null);
  if (q.error?.status === 403) return <NoPermission what={t('team.title')} permission="hr.perf.team" />;
  const d = q.data;
  const refresh = async () => { setError(null); setNote(null); try { for (const p of d.people) await perf.compute({ employeeId: p.id }); setNote(t('my.refreshed')); qc.invalidateQueries({ queryKey: ['perf'] }); } catch (e) { setError(errorInfo(e)); } };
  return (
    <section aria-labelledby="tp-title" data-testid="team-performance">
      <PageHeader id="tp-title" title={t('team.title')} />
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="tp-note">{note}</p>}
      {q.isPending ? <Skeleton label={t('team.title')} rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : d.people.length === 0 ? <EmptyState title={t('team.none')} message={t('team.noneHint')} /> : (
        <>
          <p className="muted">{d.cycle ? d.cycle.name : t('my.noCycle')}</p>
          <dl className="op-figures" data-testid="tp-summary">
            <div><dt>{t('team.people')}</dt><dd data-testid="tp-people">{d.summary.people}</dd></div><div><dt>{t('team.avg')}</dt><dd>{d.summary.avgScore ?? '—'}</dd></div>
            <div><dt>{t('team.green')}</dt><dd>{d.summary.green}</dd></div><div><dt>{t('team.amber')}</dt><dd>{d.summary.amber}</dd></div><div><dt>{t('team.red')}</dt><dd>{d.summary.red}</dd></div>
            <div><dt>{t('team.goalsWaiting')}</dt><dd data-testid="tp-goals">{d.summary.goalsWaiting}</dd></div><div><dt>{t('team.reviewsWaiting')}</dt><dd data-testid="tp-reviews">{d.summary.reviewsWaiting}</dd></div><div><dt>{t('my.disputes')}</dt><dd>{d.summary.openDisputes}</dd></div>
          </dl>
          <div className="actions-row no-print"><button type="button" className="btn" onClick={refresh} data-testid="tp-refresh">{t('my.refresh')}</button></div>
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t('team.title')}>
            <table className="grid" data-testid="tp-table"><thead><tr><th>{t('team.person')}</th><th>{t('my.kpiScore')}</th><th>{t('team.goals')}</th><th>{t('my.review')}</th><th>{t('my.disputes')}</th></tr></thead>
              <tbody>{d.people.map((p) => (
                <tr key={p.id} data-testid="tp-row" data-code={p.code}>
                  <th scope="row" data-label={t('team.person')}>{p.name} <span className="muted small">{p.code}{p.direct ? '' : ` · ${t('team.indirect')}`}</span></th>
                  <td data-label={t('my.kpiScore')}><StatusBadge status={TONE[p.tone]} label={p.kpiScore == null ? '—' : String(p.kpiScore)} /></td>
                  <td data-label={t('team.goals')}>{p.goalsAgreed} {t('goal.agreed')}{p.goalsWaiting ? ` · ${p.goalsWaiting} ${t('team.waiting')}` : ''}</td>
                  <td data-label={t('my.review')}>{p.review ? <Link to={`/performance/review?id=${p.review.id}`}>{t(`stage.${p.review.stage}`)}</Link> : '—'}</td>
                  <td data-label={t('my.disputes')}>{p.openDisputes}</td>
                </tr>))}</tbody></table>
          </div>
        </>
      )}
      <p className="small"><Link to="/performance/goals">{t('goal.title')}</Link> · <Link to="/performance/reviews">{t('rvl.title')}</Link> · <Link to="/performance">{t('my.title')}</Link></p>
    </section>
  );
}
