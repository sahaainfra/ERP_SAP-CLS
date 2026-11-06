import { useSession } from '../core/api/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';

// Workers Register (HR, part 07.08): the List Report of contract workers: search, filters by contractor, trade, skill, induction, medical and status, saved views, totals and the export (masked: the ID shows its last four digits,
// the mobile number only to those who may see it). Each user sees the workers they registered or those deployed to sites their role reaches; HR and safety see all.
export default function WorkersPage() {
  usePageTitle('Workers Register');
  const session = useSession();
  const perms = session.data?.permissions ?? [];
  const canNew = perms.includes('hr.worker.create');
  return (
    <section aria-labelledby="wk-title" data-testid="workers">
      <h1 id="wk-title" className="sr-only">Workers Register</h1>
      <ListReport listCode="hr.workers" endpoint="/hr/workers" title="Workers Register" session={session.data}
        rowHref={(r) => `/labour/workers/worker?id=${r.id}`} onOpen={(r) => navigateTo(`/labour/workers/worker?id=${r.id}`)}
        cardFields={['workerCode', 'name', 'trade', 'contractor', 'status']} statusKey="status"
        newAction={canNew ? { label: 'Register worker', onClick: () => navigateTo('/labour/workers/new') } : undefined}
        empty={{ title: 'No worker registered', text: canNew ? 'Register the first worker with Register worker.' : 'Workers appear here once a supervisor registers them.' }} />
      <p className="small"><Link to="/labour/contractors">Labour Contractors</Link>{perms.includes('hr.worker.print') && <> · <Link to="/labour/cards">Print Labour ID Cards</Link></>} · <Link to="/labour/wages">Wage Rates & Minimum Wages</Link></p>
    </section>
  );
}
