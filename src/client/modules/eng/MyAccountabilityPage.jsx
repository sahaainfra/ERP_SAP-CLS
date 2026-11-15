import { useState } from 'react';
import { EmptyState, ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { useMe } from '../../platform/accountability/api.js';
import { Link, Tile, usePageTitle } from '../core/pages/ui.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow } from '../../platform/design/Kpi.jsx';

// My Accountability (part 04.05, section 7.2): what I answer for, what of mine is past its time, what I did lately, and my own figures. It needs no permission: it is only
// about the person who opens it. The figures are an input to a review by a person, never a penalty on their own.
export const ACTION = { created: 'Created', submitted: 'Submitted', verified: 'Verified', approved: 'Approved', rejected: 'Rejected', modified: 'Modified', executed: 'Executed', recorded: 'Recorded', reconciled: 'Reconciled', cancelled: 'Cancelled', reversed: 'Reversed', closed: 'Closed' };
const RACI = { R: 'Responsible', A: 'Accountable', C: 'Consulted', I: 'Informed' };

export default function MyAccountabilityPage() {
  usePageTitle('My Accountability');
  const [filters, setFilters] = useState({ projectId: '', days: '90' });
  const from = new Date(Date.now() - Number(filters.days) * 86_400_000).toISOString().slice(0, 10);
  const q = useMe({ projectId: filters.projectId, from });
  const d = q.data;
  return (
    <section aria-labelledby="ma-title" data-testid="my-accountability">
      <PageHeader id="ma-title" title={"My Accountability"} />
      <form className="srch-form" role="search" aria-label="Filter" onSubmit={(e) => e.preventDefault()}>
        <label className="field"><span>Project</span><select value={filters.projectId} onChange={(e) => setFilters({ ...filters, projectId: e.target.value })}><option value="">All projects</option>{(d?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></label>
        <label className="field"><span>Period</span><select value={filters.days} onChange={(e) => setFilters({ ...filters, days: e.target.value })}><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="180">Last 180 days</option><option value="365">Last year</option></select></label>
      </form>
      {q.isPending && <Skeleton label="Loading your accountability" rows={4} />}
      {q.isError && <ErrorState title="Your accountability could not be loaded" error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <>
          <KpiRow data-testid="ma-tiles">
            <Tile label="Processes I am accountable for" value={d.counts.accountable} testId="ma-accountable" />
            <Tile label="Processes I am responsible for" value={d.counts.responsible} testId="ma-responsible" />
            <Tile label="Of mine, past their time" value={d.overdue.length} status={d.overdue.length ? 'bad' : 'ok'} to="/approvals" testId="ma-overdue" />
            <Tile label="On time" value={d.score.onTimePct == null ? 'No timed action yet' : `${d.score.onTimePct} %`} status={d.score.onTimePct == null ? 'neutral' : d.score.onTimePct >= 90 ? 'ok' : 'warn'} testId="ma-ontime" />
            <Tile label="My figure (for a review)" value={d.score.score} hint={`${d.score.actions} action(s); ${d.score.returnsReceived} returned, ${d.score.rejectsReceived} rejected`} testId="ma-score" />
          </KpiRow>
          <p className="muted small" data-testid="ma-note">{d.note}</p>
          <h2>What I answer for</h2>
          {d.responsibilities.length === 0 ? <EmptyState title="Nothing is assigned to you yet" message="When you are named, or your role is named, for a process in the RACI of a project, site or department, it appears here." action={undefined} /> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Responsibilities">
              <table className="grid"><thead><tr><th>Process</th><th>I am</th><th>Where</th><th>Because</th><th>From</th></tr></thead>
                <tbody>{d.responsibilities.map((r, i) => <tr key={i}><th scope="row" data-label="Process">{r.process}</th><td data-label="I am">{RACI[r.raci]}</td><td data-label="Where">{r.scope}</td><td data-label="Because">{r.via}</td><td data-label="From">{r.from}</td></tr>)}</tbody></table>
            </div>
          )}
          <h2>Mine, past their time</h2>
          {d.overdue.length === 0 ? <p className="muted" data-testid="ma-none-overdue">Nothing of yours is past its time.</p> : (
            <ul className="lp-list" data-testid="ma-overdue-list">{d.overdue.map((o) => <li key={o.taskId}><Link to={`/approvals/task?id=${o.taskId}`}>{o.title}</Link>: due {formatDateTime(o.dueAt)}, {o.hoursOverdue} hour(s) late</li>)}</ul>
          )}
          <h2>What I did lately</h2>
          {d.recent.length === 0 ? <EmptyState title="No action recorded yet" message="Your actions on documents (creating, submitting, approving, returning) are recorded here as you do them." /> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="My recent actions">
              <table className="grid"><thead><tr><th>When</th><th>Action</th><th>On</th><th>Result</th><th>Time</th></tr></thead>
                <tbody>{d.recent.map((e) => <tr key={e.id}><td data-label="When">{formatDateTime(e.at)}</td><td data-label="Action">{ACTION[e.action]}</td><th scope="row" data-label="On">{e.entityRef ?? `${e.entity} ${e.entityId}`}</th><td data-label="Result">{e.outcome.replaceAll('_', ' ').toLowerCase()}</td><td data-label="Time">{e.onTime == null ? '' : e.onTime ? 'On time' : 'Late'}</td></tr>)}</tbody></table>
            </div>
          )}
          <p className="muted small"><Link to="/admin/raci">RACI Matrix</Link> · <Link to="/reports/accountability">Accountability Report</Link></p>
        </>
      )}
    </section>
  );
}
