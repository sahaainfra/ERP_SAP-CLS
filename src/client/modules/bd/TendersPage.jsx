import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Tender Register (business development, part 08.02, FR-01): the tenders in the person's scope with reference, authority, estimated cost, submission date, stage and registration status; the estimation manager sees all.
export default function TendersPage() {
  const t = useT('bd');
  usePageTitle(t('tenders.title'));
  const session = useSession();
  const perms = session.data?.permissions ?? [];
  return (
    <section aria-labelledby="tl-title" data-testid="tenders">
      <PageHeader id="tl-title" srOnly title={t('tenders.title')} />
      <ListReport listCode="bd.tenders" endpoint="/bd/tenders" title={t('tenders.title')} session={session.data} rowHref={(r) => `/bd/tender?id=${r.id}`} onOpen={(r) => navigateTo(`/bd/tender?id=${r.id}`)} cardFields={['nameOfWork', 'client', 'submission', 'stage']} statusKey="stage"
        newAction={perms.includes('bd.tender.create') ? { label: t('td.new'), onClick: () => navigateTo('/bd/tender/new') } : undefined} empty={{ title: t('tenders.emptyTitle'), text: t('tenders.emptyText') }} />
      <p className="small"><Link to="/bd/tender-dashboard">{t('tdash.title')}</Link> · <Link to="/bd/tender-calendar">{t('cal.title')}</Link> · <Link to="/bd/bid-decisions">{t('bids.title')}</Link>{perms.includes('bd.tender.import') && <> · <Link to="/import">{t('act.import')}</Link></>}</p>
    </section>
  );
}
