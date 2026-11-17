import { useSession } from '../core/api/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Daily Attendance (HR, part 07.06, FR-01 and FR-09): the List Report of the register by person and day, with the exceptions filter (missing punches, absences, late and early going, overtime not paid in full). Search, filters, sort, saved views and the
// export (the daily attendance register) come with the list. Each user sees the sites their role reaches.
export default function DailyAttendancePage() {
  usePageTitle('Daily Attendance');
  const session = useSession();
  const perms = session.data?.permissions ?? [];
  return (
    <section aria-labelledby="da-title" data-testid="daily">
      <PageHeader id="da-title" srOnly title={"Daily Attendance"} />
      <ListReport listCode="att.daily" endpoint="/att/daily" title="Daily Attendance" session={session.data}
        rowHref={(r) => `/att/register?period=${r.workDate}`} onOpen={(r) => navigateTo(`/att/register?period=${r.workDate}`)}
        cardFields={['workDate', 'employee', 'status', 'inTime', 'outTime']} statusKey="status" dateKey="workDate"
        empty={{ title: 'No attendance yet', text: 'Rows appear once people punch or are marked present, absent or on leave.' }} />
      <p className="small"><Link to="/att/register">Monthly Attendance Register</Link>{perms.includes('hr.regularisation.view') && <> · <Link to="/att/regularisation">Regularisation Request</Link></>}</p>
    </section>
  );
}
