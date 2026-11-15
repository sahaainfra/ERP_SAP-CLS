import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Take-off Sheets (part 09.02, FR-01, FR-03): every revision of every take-off sheet and engineering MTO, with its drawing, discipline and status.
export default function TakeoffsPage() {
  const t = useT('est');
  usePageTitle(t('to.list'));
  const session = useSession();
  const can = (session.data?.permissions ?? []).includes('est.takeoff.create');
  return (
    <section aria-labelledby="to-list-h" data-testid="takeoffs">
      <PageHeader id="to-list-h" srOnly title={t('to.list')} />
      <ListReport listCode="est.takeoffs" endpoint="/est/takeoffs" title={t('to.list')} session={session.data} rowHref={(r) => `/est/takeoff?id=${r.id}`} onOpen={(r) => navigateTo(`/est/takeoff?id=${r.id}`)} cardFields={['docNo', 'title', 'drawingRef', 'status']} statusKey="status"
        newAction={can ? { label: t('to.new'), onClick: () => navigateTo('/est/takeoff?new=1') } : undefined} empty={{ title: t('to.emptyTitle'), text: t('to.emptyText') }} />
    </section>
  );
}
