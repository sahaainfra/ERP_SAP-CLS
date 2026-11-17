import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Clients (business development, part 08.01, FR-02): the clients and prospects of the partner master with the pipeline the person may see. A new client is registered as a prospect in the partner master.
export default function ClientsPage() {
  const t = useT('bd');
  usePageTitle(t('clients.title'));
  const session = useSession();
  return (
    <section aria-labelledby="cl-title" data-testid="clients">
      <PageHeader id="cl-title" srOnly title={t('clients.title')} />
      <ListReport listCode="bd.clients" endpoint="/bd/clients" title={t('clients.title')} session={session.data} rowHref={(r) => `/bd/client?id=${r.id}`} onOpen={(r) => navigateTo(`/bd/client?id=${r.id}`)} cardFields={['name', 'code', 'status']} statusKey="status" empty={{ title: t('clients.emptyTitle'), text: t('clients.emptyText') }} />
      <p className="small">{t('clients.registerHint')} <Link to="/mdm/partners">{t('clients.partners')}</Link></p>
    </section>
  );
}
