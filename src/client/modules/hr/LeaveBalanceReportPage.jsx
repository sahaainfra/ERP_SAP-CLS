import { useSession } from '../core/api/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Leave Balance Report (HR, part 07.07, FR-05): every person's opening balance, accrual, adjustments, leave taken, lapsed, encashed and what is left, by type and year, with totals over the whole filtered set, filters, saved views and
// the export. Each user sees the people of the sites their role reaches. A person's ledger (each movement and why) is behind their balance.
export default function LeaveBalanceReportPage() {
  usePageTitle('Leave Balance Report');
  const session = useSession();
  const perms = session.data?.permissions ?? [];
  return (
    <section aria-labelledby="lb-title" data-testid="leave-balances">
      <PageHeader id="lb-title" srOnly title={"Leave Balance Report"} />
      <ListReport listCode="lv.balances" endpoint="/hr/leave/balances" title="Leave Balance Report" session={session.data}
        cardFields={['employee', 'type', 'year', 'remaining']}
        empty={{ title: 'No balance yet', text: 'Balances appear after the monthly accrual has run.' }} />
      <p className="small"><Link to="/leave/calendar">Team Leave Calendar</Link>{perms.includes('lv.yearend.run') && <> · <Link to="/leave/year-end">Year-End Processing</Link></>}{perms.includes('lv.type.view') && <> · <Link to="/leave/types">Leave Types & Rules</Link></>}</p>
    </section>
  );
}
