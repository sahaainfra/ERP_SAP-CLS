import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';

// Bid / No-Bid decisions (business development, part 08.02): the decisions in the person's scope with the tender, the score, the recommendation, the decision and the approval status. A decision is made from a registered tender.
export default function BidDecisionsPage() {
  const t = useT('bd');
  usePageTitle(t('bids.title'));
  const session = useSession();
  return (
    <section aria-labelledby="bl-title" data-testid="bid-decisions">
      <h1 id="bl-title" className="sr-only">{t('bids.title')}</h1>
      <ListReport listCode="bd.bid_decisions" endpoint="/bd/bid-decisions" title={t('bids.title')} session={session.data} rowHref={(r) => `/bd/bid-decision?id=${r.id}`} onOpen={(r) => navigateTo(`/bd/bid-decision?id=${r.id}`)} cardFields={['tender', 'nameOfWork', 'score', 'decision']} statusKey="status" empty={{ title: t('bids.emptyTitle'), text: t('bids.emptyText') }} />
      <p className="small"><Link to="/bd/tenders">{t('tenders.title')}</Link></p>
    </section>
  );
}
