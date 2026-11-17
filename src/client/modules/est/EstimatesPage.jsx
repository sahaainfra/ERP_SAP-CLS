import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Estimates (part 09.01): every version of every estimate, of a tender or a project, with its status, the selling total and (for estimation and management) the cost and the margin.
export default function EstimatesPage() {
  const t = useT('est');
  usePageTitle(t('list.title'));
  const session = useSession();
  const can = (session.data?.permissions ?? []).includes('est.estimate.create');
  return (
    <section aria-labelledby="est-list-h" data-testid="estimates">
      <PageHeader id="est-list-h" srOnly title={t('list.title')} />
      <ListReport listCode="est.estimates" endpoint="/est/estimates" title={t('list.title')} session={session.data} rowHref={(r) => `/est/estimate?id=${r.id}`} onOpen={(r) => navigateTo(`/est/estimate?id=${r.id}`)} cardFields={['docNo', 'title', 'status', 'totalSelling']} statusKey="status"
        newAction={can ? { label: t('list.new'), onClick: () => navigateTo('/est/estimate/new') } : undefined} empty={{ title: t('list.emptyTitle'), text: t('list.emptyText') }} />
    </section>
  );
}
