import { useSession } from '../core/api/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Offers (HR, part 07.02): the List Report of offers with the candidate, designation, CTC, joining date, who approves (the HR manager, and the director above the requisition's range or for a senior grade),
// the status and the candidate's answer. Pay is shown to HR, the director and the auditor only.
export default function OffersPage() {
  usePageTitle('Offers');
  const session = useSession();
  return (
    <section aria-labelledby="of-title" data-testid="offers">
      <PageHeader id="of-title" srOnly title={"Offers"} />
      <ListReport listCode="hr.offers" endpoint="/hr/offers" title="Offers" session={session.data} rowHref={(r) => `/hr/offers/offer?id=${r.id}`} onOpen={(r) => navigateTo(`/hr/offers/offer?id=${r.id}`)}
        cardFields={['docNo', 'candidate', 'designation', 'status', 'response']} statusKey="status" dateKey="updatedAt"
        empty={{ title: 'No offer yet', text: 'An offer is made to a selected candidate from the Candidate Pipeline.' }} />
      <p className="small"><Link to="/hr/recruitment">Candidate Pipeline</Link></p>
    </section>
  );
}
