import { useQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, Tile, usePageTitle } from '../core/pages/ui.jsx';
import { CHANGE, mdm, scoreTone } from './api.js';

// Master Data Governance (Administration, part 06.01, FR-08): one card per governed master with its records, the changes waiting, the possible duplicates and the quality score against the target, the changes waiting for me
// as a steward, and the exceptions (old requests, duplicates, low scores, a master without a steward). Every number opens the list behind it.
export default function MasterDataGovernancePage() {
  usePageTitle('Master Data Governance');
  const q = useQuery({ queryKey: ['mdm', 'dashboard'], queryFn: mdm.dashboard, retry: false });
  if (q.error?.status === 403) return <NoPermission what="the master data dashboard" permission="mdm.governance.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the master data dashboard" rows={4} />;
  const d = q.data;
  return (
    <section aria-labelledby="mdg-title" data-testid="mdm-dashboard">
      <h1 id="mdg-title">Master Data Governance</h1>
      <p className="muted">Every change of a governed master is approved by its steward (and by the accounts manager for vendors and clients). Target quality score: {d.target}.</p>
      {d.masters.map((m) => (
        <article key={m.type} className="mdm-card" aria-labelledby={`mdg-${m.type}`} data-testid={`mdm-master-${m.type}`}>
          <h2 id={`mdg-${m.type}`}>{m.label}</h2>
          <p className="muted small">Stewards: {m.stewards.length ? m.stewards.join(', ') : 'none named'}</p>
          <div className="tiles">
            <Tile label="Active records" value={m.active} to={`/admin/master-data/records?type=${m.type}&status=ACTIVE`} testId={`mdm-active-${m.type}`} />
            <Tile label="Inactive" value={m.inactive} status="neutral" to={`/admin/master-data/records?type=${m.type}&status=INACTIVE`} />
            <Tile label="Changes waiting" value={m.pending} status={m.oldestPendingHours > 48 ? 'warning' : 'neutral'} hint={m.oldestPendingHours != null ? `oldest ${Math.floor(m.oldestPendingHours / 24)} day(s)` : null} to={`/admin/master-data/change-requests?view=all&type=${m.type}`} testId={`mdm-pending-${m.type}`} />
            <Tile label="Possible duplicates" value={m.duplicates} status={m.duplicates ? 'warning' : 'success'} to={`/admin/master-data/duplicates?type=${m.type}`} testId={`mdm-dups-${m.type}`} />
            <Tile label="Quality score" value={m.score ?? '—'} status={scoreTone(m.score)} hint={`${m.below70} below 70 · ${m.stale} not reviewed for a year`} to="/admin/master-data/quality" testId={`mdm-score-${m.type}`} />
            <Tile label="Changes in 30 days" value={m.changes30d} />
          </div>
        </article>
      ))}
      <div className="mdm-two">
        <section aria-labelledby="mdg-mine">
          <h2 id="mdg-mine">Waiting for me</h2>
          {d.myPending.length === 0 ? <EmptyState compact title="Nothing to approve" message="Changes of the masters you are steward of appear here." /> : (
            <ul className="mdm-list">{d.myPending.map((r) => <li key={r.id} data-testid="mdm-mine-row"><Link to={`/admin/master-data/change-requests?view=review&open=${r.id}`}>{CHANGE[r.changeType]}: {r.record?.code ?? ''} {r.record?.name ?? ''}</Link><span className="muted small"> · {r.requestedBy.name} · {r.ageHours} h</span></li>)}</ul>
          )}
        </section>
        <section aria-labelledby="mdg-exc">
          <h2 id="mdg-exc">Exceptions</h2>
          {d.exceptions.length === 0 ? <EmptyState compact title="No exception" message="No old request, duplicate, low score or master without a steward." /> : (
            <ul className="mdm-list" data-testid="mdm-exceptions">{d.exceptions.map((x) => <li key={x.text} className={`mdm-exc mdm-exc-${x.kind.toLowerCase()}`}><Link to={x.link}>{x.text}</Link></li>)}</ul>
          )}
        </section>
      </div>
    </section>
  );
}
