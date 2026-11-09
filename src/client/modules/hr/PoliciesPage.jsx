import { useSession } from '../core/api/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';

// Attendance Policies (HR, part 07.04): the List Report of policy versions with their effective date and whether they touch pay. A change is a new version; it goes to the HR manager and, when it touches pay, the director.
export default function PoliciesPage() {
  usePageTitle('Attendance Policies');
  const session = useSession();
  const perms = session.data?.permissions ?? [];
  const canNew = perms.includes('att.policy.create');
  return (
    <section aria-labelledby="po-title" data-testid="policies">
      <h1 id="po-title" className="sr-only">Attendance Policies</h1>
      <ListReport listCode="att.policies" endpoint="/hr/att/policies" title="Attendance Policies" session={session.data}
        rowHref={(r) => `/hr/attendance/policies/policy?id=${r.id}`} onOpen={(r) => navigateTo(`/hr/attendance/policies/policy?id=${r.id}`)}
        cardFields={['code', 'name', 'version', 'effectiveFrom', 'status']} statusKey="status" dateKey="updatedAt"
        newAction={canNew ? { label: 'New policy', onClick: () => navigateTo('/hr/attendance/policies/policy') } : undefined}
        empty={{ title: 'No policy here', text: canNew ? 'Make the first policy with New policy.' : 'Policies appear here once HR has made them.' }} />
      <p className="small"><Link to="/hr/attendance/shifts">Shifts</Link> · <Link to="/hr/attendance/assignment">Policy Assignment</Link></p>
    </section>
  );
}
