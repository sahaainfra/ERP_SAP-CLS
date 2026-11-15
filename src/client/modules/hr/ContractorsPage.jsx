import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { LICENCE_STATE, dayIST, lab } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Labour Contractors (HR, part 07.08, FR-01, FR-06 and FR-08): the labour contractors of the partner master with the state of the CLRA licence, the most workers allowed, the workers registered, deployed and punched in on the day,
// and a state that says which need attention (licence ended or ending, more workers than licensed). A row opens the compliance of the contractor.
export default function ContractorsPage() {
  usePageTitle('Labour Contractors');
  const [date, setDate] = useState(dayIST(0));
  const q = useQuery({ queryKey: ['lab', 'contractors', date], queryFn: () => lab.contractors({ date }), retry: false });
  if (q.error?.status === 403) return <NoPermission what="labour contractors" permission="hr.worker.view" />;
  const rows = q.data ?? [];
  return (
    <section aria-labelledby="lc-title" data-testid="contractors">
      <PageHeader id="lc-title" title={"Labour Contractors"} />
      <form className="srch-form" aria-label="Parameters" onSubmit={(e) => e.preventDefault()}><Field label="Strength on" name="date" error={null}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="lc-date" /></Field></form>
      {q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.isPending ? <Skeleton label="Loading the contractors" rows={4} /> : rows.length === 0 ? <EmptyState title="No labour contractor" message="Add a business partner with the role labour contractor in the partner master (06.04); it appears here." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Labour contractors">
          <table className="grid" data-testid="lc-table"><thead><tr><th>Contractor</th><th>Licence</th><th>Valid until</th><th className="num">Allowed</th><th className="num">Registered</th><th className="num">Deployed</th><th className="num">Present</th></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id} data-testid="lc-row" data-state={c.state}>
                <th scope="row" data-label="Contractor"><Link to={`/labour/contractors/contractor?id=${c.id}`}>{c.name}</Link> <span className="muted small">{c.code}</span></th>
                <td data-label="Licence"><StatusBadge status={LICENCE_STATE[c.state][0]} label={LICENCE_STATE[c.state][1]} /></td><td data-label="Valid until">{c.licenceValidUntil ?? '—'}</td>
                <td className="num" data-label="Allowed">{c.maxWorkers ?? '—'}</td><td className="num" data-label="Registered">{c.registered}</td><td className="num" data-label="Deployed">{c.deployed}</td><td className="num" data-label="Present">{c.present}</td>
              </tr>))}</tbody></table>
        </div>
      )}
      <p className="small"><Link to="/labour/workers">Workers Register</Link> · <Link to="/labour/wages">Wage Rates & Minimum Wages</Link></p>
    </section>
  );
}
