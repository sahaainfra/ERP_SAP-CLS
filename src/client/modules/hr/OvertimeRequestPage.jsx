import { Link, usePageTitle } from '../core/pages/ui.jsx';
import RequestForm from './RequestForm.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Overtime Request (HR, part 07.06, FR-04): approval before the work or a claim after it. The register pays the overtime the punches show, up to the hours approved. Beyond 4 hours in a day or 50 hours in a month the project manager also approves;
// outside the policy the HR manager does too. Works on a phone: one column, large fields.
export default function OvertimeRequestPage() {
  usePageTitle('Overtime Request');
  return (
    <section aria-labelledby="ot-title" data-testid="overtime">
      <PageHeader id="ot-title" title={"Overtime Request"} subtitle={"Ask before the work, or claim after it. Overtime is paid for the hours the punches show, up to the hours approved."} />
      <RequestForm kind="overtime" testid="ot-form" />
      <p className="small"><Link to="/att/register">Monthly Attendance Register</Link> · <Link to="/att/regularisation">Regularisation Request</Link></p>
    </section>
  );
}
