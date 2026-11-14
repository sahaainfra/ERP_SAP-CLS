import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { qa } from './api.js';
import { sel } from './QaParts.jsx';

// Quality Ratings (part 18.07, FR-03): sites, subcontractors and suppliers scored out of 100, worst first, with the points taken off and the counts behind the score; each row opens its records.
const BAND = { A: 'APPROVED', B: 'APPROVED', C: 'RETURNED', D: 'REJECTED' };
export default function RatingsPage() {
  const t = useT('qa'); usePageTitle(t('rt.title')); const [by, setBy] = useState('subcontractor'); const [projectId, setProjectId] = useState(''); const oq = useQuery({ queryKey: ['qa', 'projects'], queryFn: () => qa.get('/projects').then((p) => ({ projects: p })), retry: false });
  const qs = `by=${by}${projectId ? `&projectId=${projectId}` : ''}`; const q = useQuery({ queryKey: ['qa', 'ratings', qs], queryFn: () => qa.get(`/ratings?${qs}`), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('rt.title')} permission="qa.dashboard.view" />; if (q.isPending) return <Skeleton label={t('rt.title')} rows={5} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return (
    <section aria-labelledby="rt-h" data-testid="qa-ratings"><h1 id="rt-h">{t('rt.title')}</h1><p className="muted"><Link to="/qa/dashboard">{t('dash.title')}</Link> · {t('rt.intro')}</p>
      <div className="mdm-panel no-print"><div className="actions-row" role="group" aria-label={t('rt.by')}>{['subcontractor', 'supplier', 'site'].map((k) => <button key={k} type="button" className={by === k ? 'btn btn-primary' : 'btn'} style={{ minHeight: 44 }} aria-pressed={by === k} onClick={() => setBy(k)} data-testid={`rt-by-${k}`}>{t(`rt.${k}`)}</button>)}</div>
        <label>{t('project')}<select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={sel} data-testid="rt-project"><option value="">{t('allProjects')}</option>{(oq.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></label>
        <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => qa.exportFile(`/dashboard/export?kind=ratings&${qs}`, `ratings-${by}.csv`).catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="rt-export">{t('export')}</button></div>
      {d.rows.length === 0 ? <EmptyState title={t('rt.emptyTitle')} message={t('rt.emptyBody')} /> : (
        <div className="table-scroll"><table className="data-table" data-testid="rt-table"><caption>{t(`rt.${by}`)}</caption><thead><tr><th>{t('name')}</th><th className="num">{t('rt.score')}</th><th>{t('rt.band')}</th><th>{t('rt.counts')}</th><th>{t('rt.points')}</th><th /></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.id} data-testid="rt-row" data-score={r.score}><td>{r.name}</td><td className="num">{r.score}</td><td><StatusBadge status={BAND[r.band]} label={r.band} /></td><td>{Object.entries(r.counts).map(([k, v]) => `${t(`rtc.${k}`)} ${v}`).join(' · ')}</td><td>{Object.entries(r.points).filter(([, v]) => v).map(([k, v]) => `${t(`rtp.${k}`)} −${v}`).join(' · ') || '—'}</td><td><Link to={r.drill}>{t('ira.open')}</Link></td></tr>)}</tbody></table></div>)}
    </section>
  );
}
