import { useSession } from '../core/api/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';

// Shifts (HR, part 07.04): the List Report of shifts (search, filters, sort, saved views, export). A shift that crosses midnight is a night shift. A shift in use keeps its times, so a change of times is a new shift.
export default function ShiftsPage() {
  usePageTitle('Shifts');
  const session = useSession();
  const perms = session.data?.permissions ?? [];
  const canNew = perms.includes('att.shift.edit');
  return (
    <section aria-labelledby="sh-title" data-testid="shifts">
      <h1 id="sh-title" className="sr-only">Shifts</h1>
      <ListReport listCode="att.shifts" endpoint="/hr/att/shifts" title="Shifts" session={session.data}
        rowHref={(r) => `/hr/attendance/shifts/shift?id=${r.id}`} onOpen={(r) => navigateTo(`/hr/attendance/shifts/shift?id=${r.id}`)}
        cardFields={['code', 'name', 'startTime', 'endTime', 'status']} statusKey="status" dateKey="updatedAt"
        newAction={canNew ? { label: 'New shift', onClick: () => navigateTo('/hr/attendance/shifts/shift') } : undefined}
        empty={{ title: 'No shift here', text: canNew ? 'Make the first shift with New shift.' : 'Shifts appear here once HR has made them.' }} />
      <p className="small"><Link to="/hr/attendance/roster">Roster Planner</Link> · <Link to="/hr/attendance/policies">Attendance Policies</Link> · <Link to="/hr/attendance/assignment">Policy Assignment</Link></p>
    </section>
  );
}
