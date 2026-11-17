import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Bar Bending Schedules (part 09.02, FR-02): every revision of every bar bending schedule, with its member, drawing, weight and status.
export default function BbsListPage() {
  const t = useT('est');
  usePageTitle(t('bbs.list'));
  const session = useSession();
  const can = (session.data?.permissions ?? []).includes('est.bb.create');
  return (
    <section aria-labelledby="bbs-list-h" data-testid="bbs-list">
      <PageHeader id="bbs-list-h" srOnly title={t('bbs.list')} />
      <ListReport listCode="est.bbs" endpoint="/est/bbs" title={t('bbs.list')} session={session.data} rowHref={(r) => `/est/bbs/sheet?id=${r.id}`} onOpen={(r) => navigateTo(`/est/bbs/sheet?id=${r.id}`)} cardFields={['docNo', 'member', 'weightKg', 'status']} statusKey="status"
        newAction={can ? { label: t('bbs.new'), onClick: () => navigateTo('/est/bbs/sheet?new=1') } : undefined} empty={{ title: t('bbs.emptyTitle'), text: t('bbs.emptyText') }} />
    </section>
  );
}
