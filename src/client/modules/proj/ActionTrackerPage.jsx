import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { tm } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Action Item Tracker (part 10.05, FR-05): the actions of all issued minutes with the live status of their tasks, overdue ones marked; the figures above are the same data.
export default function ActionTrackerPage() {
  const t = useT('proj');
  usePageTitle(t('trk.title'));
  const session = useSession();
  const sq = useQuery({ queryKey: ['proj', 'action-summary'], queryFn: () => tm.actionSummary(null), retry: false });
  const s = sq.data;
  return (
    <section aria-labelledby="trk-h" data-testid="action-tracker">
      <PageHeader id="trk-h" srOnly title={t('trk.title')} />
      {s && (
        <dl className="op-figures" data-testid="trk-figures">
          <div><dt>{t('trk.total')}</dt><dd data-testid="trk-total">{s.total}</dd></div><div><dt>{t('trk.open')}</dt><dd data-testid="trk-open">{s.open}</dd></div><div><dt>{t('trk.inProgress')}</dt><dd>{s.inProgress}</dd></div>
          <div><dt>{t('trk.blocked')}</dt><dd>{s.blocked}</dd></div><div><dt>{t('trk.done')}</dt><dd data-testid="trk-done">{s.done}</dd></div><div><dt>{t('trk.overdue')}</dt><dd data-testid="trk-overdue">{s.overdue}</dd></div>
        </dl>
      )}
      <ListReport listCode="proj.meeting_actions" endpoint="/proj/meeting-actions" title={t('trk.title')} session={session.data} rowHref={(r) => `/proj/meeting?id=${r.meetingId}`} onOpen={(r) => navigateTo(`/proj/meeting?id=${r.meetingId}`)} cardFields={['meeting', 'description', 'owner', 'dueDate', 'statusLabel']} empty={{ title: t('trk.emptyTitle'), text: t('trk.emptyText') }} />
      <p className="small"><Link to="/proj/meetings">{t('mtg.listTitle')}</Link></p>
    </section>
  );
}
