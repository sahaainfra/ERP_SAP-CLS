import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Opportunities (business development, part 08.01): the list of opportunities in the person's scope with client, stage, value, probability, weighted value, expected award and the go-ahead status; the pipeline board shows the same by stage.
export default function OpportunitiesPage() {
  const t = useT('bd');
  usePageTitle(t('opps.title'));
  const session = useSession();
  const perms = session.data?.permissions ?? [];
  return (
    <section aria-labelledby="os-title" data-testid="opportunities">
      <PageHeader id="os-title" srOnly title={t('opps.title')} />
      <ListReport listCode="bd.opportunities" endpoint="/bd/opportunities" title={t('opps.title')} session={session.data} rowHref={(r) => `/bd/opportunity?id=${r.id}`} onOpen={(r) => navigateTo(`/bd/opportunity?id=${r.id}`)} cardFields={['name', 'client', 'stage', 'estValue']} statusKey="status"
        newAction={perms.includes('bd.opportunity.create') ? { label: t('opp.new'), onClick: () => navigateTo('/bd/opportunity/new') } : undefined} empty={{ title: t('opps.emptyTitle'), text: t('opps.emptyText') }} />
      <p className="small"><Link to="/bd/pipeline">{t('pipe.title')}</Link>{perms.includes('bd.opportunity.import') && <> · <Link to="/import">{t('act.import')}</Link></>}</p>
    </section>
  );
}
