import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';

// Work Packages (part 10.03, FR-03): the groupings of WBS nodes for subcontracting, procurement or self-execution, with their owner and status.
export default function WorkPackagesPage() {
  const t = useT('proj');
  usePageTitle(t('wp.title'));
  const session = useSession();
  const can = (session.data?.permissions ?? []).includes('proj.wbs.manage');
  return (
    <section aria-labelledby="wp-list-h" data-testid="work-packages">
      <h1 id="wp-list-h" className="sr-only">{t('wp.title')}</h1>
      <ListReport listCode="proj.work_packages" endpoint="/proj/work-packages" title={t('wp.title')} session={session.data} rowHref={(r) => `/proj/work-package?id=${r.id}`} onOpen={(r) => navigateTo(`/proj/work-package?id=${r.id}`)} cardFields={['code', 'name', 'type', 'status']}
        newAction={can ? { label: t('wp.new'), onClick: () => navigateTo('/proj/work-package') } : undefined} empty={{ title: t('wp.emptyTitle'), text: t('wp.emptyText') }} />
    </section>
  );
}
