import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { partners } from './api.js';

// Partner Approvals & Bank Change Requests (Administration, part 06.04): one worklist of what waits on partners: registrations to approve, bank changes (waiting for the partner's confirmation or for approval),
// blacklisting requests, and compliance documents that expire within 30 days or have expired. What waits for me comes first, then the oldest; the colour shows the age against a 48-hour SLA (amber after 48 hours,
// red after 96 or for an expired document). Each row opens the partner; an approval is decided in My Approvals (also on a phone).
const KINDS = [['', 'Everything'], ['REGISTRATION', 'Registrations'], ['BANK', 'Bank changes'], ['STATUS', 'Blacklisting'], ['DOCUMENT', 'Expiring documents']];
const LABEL = { REGISTRATION: 'Registration', BANK: 'Bank change', STATUS: 'Blacklisting', DOCUMENT: 'Document' };
export default function PartnerApprovalsPage() {
  usePageTitle('Partner Approvals & Bank Changes');
  const [kind, setKind] = useState(() => new URLSearchParams(window.location.search).get('kind') ?? '');
  const q = useQuery({ queryKey: ['mdm', 'partners', 'queue', kind], queryFn: () => partners.queue(kind || undefined), retry: false, refetchInterval: 60_000 });
  if (q.error?.status === 403) return <NoPermission what="the partner worklist" permission="mdm.partner.queue" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the worklist" rows={4} />;
  const d = q.data;
  return (
    <section aria-labelledby="pa-title" data-testid="partner-approvals">
      <h1 id="pa-title">Partner Approvals &amp; Bank Changes</h1>
      <div className="seg" role="tablist" aria-label="What to show">{KINDS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={kind === k} className={`btn btn-small ${kind === k ? 'btn-primary' : ''}`} onClick={() => setKind(k)} data-testid={`pa-kind-${k || 'all'}`}>{l}{k && d.counts[k] ? ` (${d.counts[k]})` : ''}</button>)}</div>
      {d.rows.length === 0 ? <EmptyState title="Nothing waits" message="Registrations, bank changes, blacklisting requests and expiring documents of partners appear here." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Worklist"><table className="grid"><thead><tr><th>Partner</th><th>What</th><th>Kind</th><th>From</th><th>Waiting</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={`${r.kind}${r.id}`} className={r.tone === 'error' ? 'is-overdue' : r.tone === 'warning' ? 'is-soon' : ''} data-testid="pa-row">
              <th scope="row" data-label="Partner"><Link to={`/admin/partners/partner?id=${r.partnerId}${r.kind === 'DOCUMENT' ? '&tab=documents' : r.kind === 'BANK' ? '&tab=banks' : ''}`}>{r.code}</Link> {r.name}{r.mine && <div className="small"><strong>Waits for you</strong></div>}</th>
              <td data-label="What">{r.what}{r.returned ? <div className="muted small">returned for correction</div> : null}</td><td data-label="Kind">{LABEL[r.kind]}</td><td data-label="From">{r.by}</td>
              <td data-label="Waiting">{r.kind === 'DOCUMENT' ? (r.expired ? 'expired' : 'expires soon') : `${Math.floor(r.ageHours / 24)} d ${r.ageHours % 24} h`}<div className="muted small">{r.kind === 'DOCUMENT' ? r.since : formatDateTime(r.since)}</div></td>
              <td>{r.mine ? <button type="button" className="btn btn-small btn-primary" onClick={() => navigateTo('/approvals')} data-testid="pa-decide">Decide</button> : r.kind === 'BANK' && r.stage === 'PENDING_CONFIRMATION' ? <button type="button" className="btn btn-small" onClick={() => navigateTo(`/admin/partners/partner?id=${r.partnerId}&tab=banks`)}>Enter the confirmation</button> : <button type="button" className="btn btn-small" onClick={() => navigateTo(`/admin/partners/partner?id=${r.partnerId}`)}>Open</button>}</td>
            </tr>))}</tbody></table></div>
      )}
    </section>
  );
}
