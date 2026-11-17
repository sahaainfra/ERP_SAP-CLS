import { useState } from 'react';
import ListReport from '../../platform/list/ListReport.jsx';
import { useSession } from '../core/api/index.js';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { PARTNER_ROLES } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Business Partners (Administration, part 06.04): the List Report of partners (search, filters by status and the other columns, sort, saved views, column chooser, 25/50/100 a page, export XLSX/CSV/PDF with the PAN
// hidden from roles outside finance) with quick filters for a role, a category and the compliance documents that expire within 30 days. "New partner" opens the registration wizard.
const in30 = () => new Date(Date.now() + 5.5 * 3_600_000 + 30 * 86_400_000).toISOString().slice(0, 10);
export default function BusinessPartnersPage() {
  usePageTitle('Business Partners');
  const session = useSession();
  const [role, setRole] = useState(() => new URLSearchParams(window.location.search).get('role') ?? '');
  const [category, setCategory] = useState('');
  const [expiring, setExpiring] = useState(() => new URLSearchParams(window.location.search).get('expiring') === '1');
  const ctx = [...(role ? [{ key: 'roles', op: 'contains', value: role }] : []), ...(category ? [{ key: 'categories', op: 'contains', value: category.toUpperCase() }] : []), ...(expiring ? [{ key: 'nextExpiry', op: 'lte', value: in30() }] : [])];
  const canNew = session.data?.permissions?.includes('mdm.partner.edit');
  return (
    <section aria-labelledby="bp-title" data-testid="business-partners">
      <PageHeader id="bp-title" srOnly title={"Business Partners"} />
      <form className="srch-form" aria-label="Quick filters" onSubmit={(e) => e.preventDefault()}>
        <Field label="Role" name="role" error={null}><select value={role} onChange={(e) => setRole(e.target.value)} data-testid="bp-role"><option value="">All roles</option>{PARTNER_ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Category" name="category" error={null}><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="For example STEEL" data-testid="bp-category" /></Field>
        <label className="check"><input type="checkbox" checked={expiring} onChange={(e) => setExpiring(e.target.checked)} data-testid="bp-expiring" /> Documents expiring within 30 days or expired</label>
      </form>
      <ListReport listCode="mdm.partners" endpoint="/mdm/partners/register" title="Business Partners" session={session.data}
        rowHref={(r) => `/admin/partners/partner?id=${r.id}`} onOpen={(r) => navigateTo(`/admin/partners/partner?id=${r.id}`)}
        cardFields={['code', 'legalName', 'roles', 'status', 'nextExpiry']} statusKey="status" dateKey="updatedAt" contextFilters={ctx}
        newAction={canNew ? { label: 'New partner', onClick: () => navigateTo('/admin/partners/new') } : undefined}
        empty={{ title: 'No partner here', text: canNew ? 'Register the first one with New partner, or import a list through the Import Center.' : 'Partners appear here once registered by procurement or the commercial team.' }} />
      <p className="small"><Link to="/admin/partners/approvals">Partner approvals and bank changes</Link> · <Link to="/import">Import or export</Link></p>
    </section>
  );
}
