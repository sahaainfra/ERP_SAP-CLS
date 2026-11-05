import { useSession } from '../core/api/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';

// Manpower Requisitions (HR, part 07.02): the List Report of requisitions (search, filters, sort, saved views, 25/50/100 a page, export). HR, the director and the auditor see every requisition; a hiring manager their own.
// The budgeted CTC range is shown to HR and to the person who raised it. "New requisition" opens the form.
export default function RequisitionsPage() {
  usePageTitle('Manpower Requisitions');
  const session = useSession();
  const perms = session.data?.permissions ?? [];
  const canNew = perms.includes('hr.requisition.create');
  return (
    <section aria-labelledby="rq-title" data-testid="requisitions">
      <h1 id="rq-title" className="sr-only">Manpower Requisitions</h1>
      <ListReport listCode="hr.requisitions" endpoint="/hr/requisitions" title="Manpower Requisitions" session={session.data}
        rowHref={(r) => `/hr/requisitions/requisition?id=${r.id}`} onOpen={(r) => navigateTo(`/hr/requisitions/requisition?id=${r.id}`)}
        cardFields={['docNo', 'designation', 'department', 'positions', 'status']} statusKey="status" dateKey="updatedAt"
        newAction={canNew ? { label: 'New requisition', onClick: () => navigateTo('/hr/requisitions/new') } : undefined}
        empty={{ title: 'No requisition here', text: canNew ? 'Raise the first one with New requisition.' : 'Requisitions appear here once a hiring manager raises them.' }} />
      <p className="small">{perms.includes('hr.candidate.view') && <><Link to="/hr/recruitment">Candidate Pipeline</Link> · </>}{perms.includes('hr.offer.view') && <><Link to="/hr/offers">Offers</Link> · </>}<Link to="/hr/employees">Employee Directory</Link></p>
    </section>
  );
}
