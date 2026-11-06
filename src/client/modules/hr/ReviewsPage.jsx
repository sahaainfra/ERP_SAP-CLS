import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { perf } from './api.js';

// Appraisal Reviews (HR, part 07.11): the List Report of reviews for the person (their own), the manager (their team) and HR (everybody): stage, status, KPI score. HR opens a cycle's reviews with "Make the reviews" once the cycle is open.
export default function ReviewsPage() {
  const t = useT('prf');
  usePageTitle(t('rvl.title'));
  const qc = useQueryClient();
  const session = useSession();
  const perms = session.data?.permissions ?? [];
  const cycles = useQuery({ queryKey: ['perf', 'cycles'], queryFn: perf.cycles, retry: false });
  const [note, setNote] = useState(null); const [error, setError] = useState(null);
  const open = (cycles.data ?? []).filter((c) => c.status === 'OPEN');
  const launch = async (c) => { setError(null); setNote(null); try { const r = await perf.launch(c.id); setNote(t('rvl.made', { n: r.made, name: c.name })); qc.invalidateQueries({ queryKey: ['ui', 'list'] }); qc.invalidateQueries({ queryKey: ['perf'] }); } catch (e) { setError(errorInfo(e)); } };
  return (
    <section aria-labelledby="rl-title" data-testid="reviews">
      <h1 id="rl-title" className="sr-only">{t('rvl.title')}</h1>
      {error?.form && <p className="field-error" role="alert" data-testid="rl-error">{error.form}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="rl-note">{note}</p>}
      {perms.includes('hr.review.create') && open.length > 0 && <div className="actions-row no-print">{open.map((c) => <button key={c.id} type="button" className="btn btn-primary" onClick={() => launch(c)} data-testid="rl-launch">{t('rvl.launch', { name: c.name })}</button>)}</div>}
      <ListReport listCode="hr.reviews" endpoint="/hr/reviews" title={t('rvl.title')} session={session.data}
        rowHref={(r) => `/performance/review?id=${r.id}`} onOpen={(r) => navigateTo(`/performance/review?id=${r.id}`)} cardFields={['employee', 'cycle', 'stage', 'status']} statusKey="status"
        empty={{ title: t('rvl.emptyTitle'), text: t('rvl.emptyText') }} />
      <p className="small"><Link to="/performance/team">{t('team.title')}</Link> · <Link to="/performance/kpis">{t('kpi.title')}</Link></p>
    </section>
  );
}
