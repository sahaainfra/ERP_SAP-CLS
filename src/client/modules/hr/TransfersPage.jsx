import { useSession } from '../core/api/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';

// Transfers (HR, part 07.03): the List Report of transfers and secondments (search, filters, sort, saved views, export). Each user sees the transfers that leave or join the projects and sites their role reaches.
export default function TransfersPage() {
  usePageTitle('Transfers');
  const session = useSession();
  const perms = session.data?.permissions ?? [];
  const canNew = perms.includes('hr.transfer.create');
  return (
    <section aria-labelledby="tl-title" data-testid="transfers">
      <h1 id="tl-title" className="sr-only">Transfers</h1>
      <ListReport listCode="hr.transfers" endpoint="/hr/transfers" title="Transfers" session={session.data}
        rowHref={(r) => `/hr/transfers/transfer?id=${r.id}`} onOpen={(r) => navigateTo(`/hr/transfers/transfer?id=${r.id}`)}
        cardFields={['docNo', 'employee', 'toSite', 'joinDate', 'status']} statusKey="status" dateKey="updatedAt"
        newAction={canNew ? { label: 'Transfer request', onClick: () => navigateTo('/hr/transfers/new') } : undefined}
        empty={{ title: 'No transfer here', text: canNew ? 'Move a person with Transfer request.' : 'Transfers appear here once a person is moved to another site or project.' }} />
      <p className="small"><Link to="/hr/deployment-board">Deployment Board</Link>{perms.includes('hr.deployment.view') && <> · <Link to="/hr/deployments">Deployments</Link></>}</p>
    </section>
  );
}
