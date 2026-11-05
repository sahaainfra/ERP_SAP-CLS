import { useSession } from '../core/api/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';

// Deployments (HR, part 07.03): the List Report of deployments (search, filters, sort, saved views, 25/50/100 a page, export). A person is on one primary deployment at a time; "Now" tells what is in force today.
// Each user sees the deployments of the projects and sites their role reaches. New deployment opens the form (single or bulk by Excel).
export default function DeploymentsPage() {
  usePageTitle('Deployments');
  const session = useSession();
  const perms = session.data?.permissions ?? [];
  const canNew = perms.includes('hr.deployment.create');
  return (
    <section aria-labelledby="dl-title" data-testid="deployments">
      <h1 id="dl-title" className="sr-only">Deployments</h1>
      <ListReport listCode="hr.deployments" endpoint="/hr/deployments" title="Deployments" session={session.data}
        rowHref={(r) => `/hr/deployments/deployment?id=${r.id}`} onOpen={(r) => navigateTo(`/hr/deployments/deployment?id=${r.id}`)}
        cardFields={['docNo', 'person', 'site', 'fromDate', 'status']} statusKey="status" dateKey="updatedAt"
        newAction={canNew ? { label: 'New deployment', onClick: () => navigateTo('/hr/deployments/new') } : undefined}
        empty={{ title: 'No deployment here', text: canNew ? 'Deploy the first person with New deployment.' : 'Deployments appear here once a person is posted to a project or site.' }} />
      <p className="small"><Link to="/hr/deployment-board">Deployment Board</Link>{perms.includes('hr.crew.view') && <> · <Link to="/hr/crews">Crews &amp; Gangs</Link></>}{perms.includes('hr.transfer.view') && <> · <Link to="/hr/transfers">Transfers</Link></>}</p>
    </section>
  );
}
