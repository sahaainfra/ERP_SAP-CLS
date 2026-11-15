import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Leads (business development, part 08.01): the leads in the person's scope (their own; the director, estimation and commercial managers see all) with their source, client, qualification score, owner and status. Export and import through the Excel engine.
export default function LeadsPage() {
  const t = useT('bd');
  usePageTitle(t('leads.title'));
  const session = useSession();
  const perms = session.data?.permissions ?? [];
  return (
    <section aria-labelledby="ls-title" data-testid="leads">
      <PageHeader id="ls-title" srOnly title={t('leads.title')} />
      <ListReport listCode="bd.leads" endpoint="/bd/leads" title={t('leads.title')} session={session.data} rowHref={(r) => `/bd/lead?id=${r.id}`} onOpen={(r) => navigateTo(`/bd/lead?id=${r.id}`)} cardFields={['title', 'client', 'estValue', 'status']} statusKey="status"
        newAction={perms.includes('bd.lead.create') ? { label: t('lead.new'), onClick: () => navigateTo('/bd/lead/new') } : undefined} empty={{ title: t('leads.emptyTitle'), text: t('leads.emptyText') }} />
      <p className="small"><Link to="/bd/pipeline">{t('pipe.title')}</Link>{perms.includes('bd.lead.import') && <> · <Link to="/import">{t('act.import')}</Link></>}</p>
    </section>
  );
}
