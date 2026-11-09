import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';

// Awards and Losses (business development, part 08.03, FR-06): every tender's recorded outcome, with the letter of acceptance and value of a win or the reason of a loss, and its approval.
export default function AwardsPage() {
  const t = useT('bd');
  usePageTitle(t('aw.list'));
  const session = useSession();
  return (
    <section aria-labelledby="aws-title" data-testid="awards">
      <h1 id="aws-title" className="sr-only">{t('aw.list')}</h1>
      <ListReport listCode="bd.awards" endpoint="/bd/awards" title={t('aw.list')} session={session.data} rowHref={(r) => `/bd/award?id=${r.id}`} onOpen={(r) => navigateTo(`/bd/award?id=${r.id}`)} cardFields={['docNo', 'nameOfWork', 'outcome', 'value']} empty={{ title: t('aw.emptyTitle'), text: t('aw.emptyText') }} />
    </section>
  );
}
