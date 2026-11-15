import { Link, usePageTitle } from '../core/pages/ui.jsx';
import RequestForm from './RequestForm.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Regularisation Request (HR, part 07.06, FR-03): a person, or their supervisor for them, corrects the punches of a day (a missing in or out) and gives the reason. It goes to the supervisor or project manager, and to the HR manager when it is the
// fourth of the month. When it is approved the day is worked out again from the corrected times. Works on a phone: one column, large fields.
export default function RegularisationRequestPage() {
  usePageTitle('Regularisation Request');
  return (
    <section aria-labelledby="rg-title" data-testid="regularisation">
      <PageHeader id="rg-title" title={"Regularisation Request"} subtitle={"Forgot to punch, or the device did not read? Give the times and the reason. A request goes to the supervisor; the fourth in a month also goes to the HR manager."} />
      <RequestForm kind="regularisation" testid="rg-form" />
      <p className="small"><Link to="/att/register">Monthly Attendance Register</Link> · <Link to="/att/overtime">Overtime Request</Link></p>
    </section>
  );
}
