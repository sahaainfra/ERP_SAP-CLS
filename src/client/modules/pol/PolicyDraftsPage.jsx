import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate } from '../../platform/format.js';
import { Field, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { pol } from './api.js';

// Policy-to-Protocol Drafts (Administration, part 05.05, section 7.4): a worklist of what company policies asked the system to enforce: draft control points, approval rules and alert rules made from tagged requirements.
// Oldest first, coloured by how long they have waited. Every draft is inactive; it is reviewed and activated on the screen of the engine that owns it (and through that engine's own approval): the button opens it there.
const STATE = { DRAFT: ['DRAFT', 'Draft: inactive'], PENDING: ['IN_REVIEW', 'Waiting for approval'], ACTIVE: ['COMPLETED', 'Activated'], GONE: ['REJECTED', 'Gone or replaced'] };
export default function PolicyDraftsPage() {
  usePageTitle('Policy-to-Protocol Drafts');
  const qc = useQueryClient();
  const [f, setF] = useState({ type: '', state: '', q: '' });
  const q = useQuery({ queryKey: ['pol', 'drafts', f], queryFn: () => pol.drafts(f), retry: false, placeholderData: (p) => p });
  const [error, setError] = useState(null);
  if (q.error?.status === 403) return <NoPermission what="the drafts made from policies" permission="pol.draft.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the drafts" rows={3} />;
  const d = q.data;
  const set = (p) => setF({ ...f, ...p });
  const dismiss = async (r) => { const why = window.prompt('Why is this draft not needed?') ?? ''; if (why.trim().length < 5) return; setError(null); try { await pol.dismiss(r.id, why.trim()); qc.invalidateQueries({ queryKey: ['pol'] }); } catch (e) { setError(errorInfo(e)); } };
  return (
    <section aria-labelledby="pdr-title" data-testid="policy-drafts">
      <h1 id="pdr-title">Policy-to-Protocol Drafts</h1>
      <p className="muted">Nothing here is switched on. Review each draft on the screen of its engine: a control point is put in observe mode there, an approval matrix is submitted for approval there, an alert rule is switched on there.</p>
      <div className="cc-tiles" role="group" aria-label="Totals">{[['Draft: inactive', d.counts.DRAFT ?? 0], ['Waiting for approval', d.counts.PENDING ?? 0], ['Activated', d.counts.ACTIVE ?? 0], ['Dismissed', d.counts.DISMISSED ?? 0]].map(([l, v]) => <div key={l} className="cc-tile" data-testid={`pdr-sum-${l.split(' ')[0].toLowerCase().replace(/\W/g, '')}`}><span className="cc-value num">{v}</span><span className="cc-label">{l}</span></div>)}</div>
      <form className="srch-form" role="search" aria-label="Filter the drafts" onSubmit={(e) => e.preventDefault()}>
        <Field label="Search" name="q" error={null}><input type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} data-testid="pdr-q" /></Field>
        <Field label="Kind" name="type" error={null}><select value={f.type} onChange={(e) => set({ type: e.target.value })} data-testid="pdr-type"><option value="">All</option><option value="CONTROL_POINT">Control point</option><option value="APPROVAL_RULE">Approval rule</option><option value="ALERT_RULE">Alert rule</option></select></Field>
        <Field label="State" name="state" error={null}><select value={f.state} onChange={(e) => set({ state: e.target.value })}><option value="">All</option>{Object.entries(STATE).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      </form>
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      {d.rows.length === 0 ? <EmptyState title="No draft yet" message="When a policy owner turns a requirement of an approved policy into a draft, it appears here for review." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Drafts"><table className="grid"><thead><tr><th>Policy</th><th>Clause</th><th>Requirement</th><th>Kind</th><th>Draft</th><th>State</th><th>Waiting</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={r.id} className={r.status === 'DRAFTED' && r.artifact?.state !== 'ACTIVE' ? (r.ageDays >= 14 ? 'is-overdue' : r.ageDays >= 7 ? 'is-soon' : '') : ''} data-testid="pdr-row">
              <th scope="row" data-label="Policy">{r.policyNo} · {r.policyTitle}<div className="muted small">by {r.owner.name}</div></th><td data-label="Clause">{r.clauseRef}</td><td data-label="Requirement">{r.requirementText}</td><td data-label="Kind">{r.artifactLabel} <span className="muted small">(part {r.engine?.part})</span></td>
              <td data-label="Draft">{r.artifact?.label ?? '—'}</td>
              <td data-label="State">{r.status === 'DISMISSED' ? <>Dismissed<div className="muted small">{r.dismissReason}</div></> : <StatusBadge status={STATE[r.artifact?.state ?? 'DRAFT'][0]} label={r.artifact?.stateLabel ?? STATE.DRAFT[1]} />}</td>
              <td data-label="Waiting">{r.convertedAt ? `${r.ageDays} day(s) · since ${formatDate(r.convertedAt)}` : '—'}</td>
              <td>{r.status === 'DRAFTED' && r.artifact?.route && <button type="button" className="btn btn-small btn-primary" disabled={!r.canReview} title={r.canReview ? '' : `You need ${r.engine?.permission} to review it there`} onClick={() => navigateTo(r.artifact.route)} data-testid="pdr-open">Review in {r.artifactLabel.toLowerCase()} screen</button>}{r.status === 'DRAFTED' && r.canReview && <button type="button" className="btn btn-small" onClick={() => dismiss(r)} data-testid="pdr-dismiss">Dismiss</button>}</td>
            </tr>))}</tbody></table></div>
      )}
    </section>
  );
}
