import { useState } from 'react';
import ListReport from '../../platform/list/ListReport.jsx';
import { useSession } from '../core/api/index.js';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { EMPLOYMENT_STATUS, EMPLOYMENT_TYPES } from './api.js';

// Employee Directory (HR, part 07.01): the List Report of employees (search, filters by department, site, designation, status and type, sort, saved views, column chooser, 25/50/100 a page, export XLSX/CSV/PDF with the PAN
// masked for people who may not see it). HR and payroll see the company; a manager sees the people in the reporting line and the staff deployed to their projects and sites (basic data). "New employee" opens the wizard.
export default function EmployeeDirectoryPage() {
  usePageTitle('Employee Directory');
  const session = useSession();
  const sp = new URLSearchParams(window.location.search);
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [type, setType] = useState(sp.get('type') ?? '');
  const [location, setLocation] = useState(sp.get('location') ?? '');
  const ctx = [...(status ? [{ key: 'status', op: 'eq', value: status }] : []), ...(type ? [{ key: 'employmentType', op: 'eq', value: type }] : []), ...(location ? [{ key: 'locationType', op: 'eq', value: location }] : [])];
  const perms = session.data?.permissions ?? [];
  const canNew = perms.includes('hr.employee.create');
  return (
    <section aria-labelledby="ed-title" data-testid="employee-directory">
      <h1 id="ed-title" className="sr-only">Employee Directory</h1>
      <form className="srch-form" aria-label="Quick filters" onSubmit={(e) => e.preventDefault()}>
        <Field label="Status" name="status" error={null}><select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="ed-status"><option value="">All</option>{Object.entries(EMPLOYMENT_STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Type" name="type" error={null}><select value={type} onChange={(e) => setType(e.target.value)} data-testid="ed-type"><option value="">All</option>{EMPLOYMENT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Work location" name="location" error={null}><select value={location} onChange={(e) => setLocation(e.target.value)} data-testid="ed-location"><option value="">All</option><option value="HO">Head office</option><option value="SITE">Site</option></select></Field>
      </form>
      <ListReport listCode="hr.employees" endpoint="/hr/employees" title="Employee Directory" session={session.data}
        rowHref={(r) => `/hr/employees/employee?id=${r.id}`} onOpen={(r) => navigateTo(`/hr/employees/employee?id=${r.id}`)}
        cardFields={['code', 'name', 'designation', 'department', 'status']} statusKey="status" dateKey="updatedAt" contextFilters={ctx}
        newAction={canNew ? { label: 'New employee', onClick: () => navigateTo('/hr/employees/new') } : undefined}
        empty={{ title: 'No employee here', text: canNew ? 'Add the first one with New employee, or import a list through the Import Center.' : 'Employees appear here once HR has entered and approved them.' }} />
      <p className="small"><Link to="/hr">HR Overview</Link>{perms.includes('hr.employee.import') && <> · <Link to="/import">Import or export</Link></>}</p>
    </section>
  );
}
