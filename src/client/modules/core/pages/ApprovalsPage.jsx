import { useState } from 'react';
import { useActOnRequest, usePendingRequests } from '../api/index.js';
import { formatDateTime } from '../../../platform/format.js';
import { QueryState, errorInfo, usePageTitle } from './ui.jsx';

const KIND = {
  period_reopen: 'Reopen a closed period',
  number_series_change: 'Change a numbering series',
  connector_change: 'Create or change a connector',
  schedule_change: 'Change a schedule',
  file_settings_change: 'Change file storage settings',
  formula_activation: 'Activate a formula version',
};

/** What a reviewer needs to see to decide, by kind of request. */
function Summary({ r }) {
  const p = r.payload;
  if (r.type === 'formula_activation') {
    return (
      <div>
        <div className="muted small">{p.ownerModule} formula{p.financial ? ' (financial)' : ''}, effective {p.effectiveFrom}; {p.tests} passing test case(s); shadow run: {p.shadow.runs} compared, {p.shadow.differing} different.</div>
        <details><summary>Show the formula</summary><pre className="payload">{p.expression}</pre></details>
      </div>
    );
  }
  return <details><summary>Show the details</summary><pre className="payload">{JSON.stringify(p, null, 2)}</pre></details>;
}

/**
 * A stand-in approvals inbox (the workflow engine of part 04.01 will replace it): every request waiting for a decision, and
 * Approve and Reject for the one whose turn it is for you. Nobody can decide their own request.
 */
export default function ApprovalsPage({ session }) {
  usePageTitle('Approvals');
  const pending = usePendingRequests();
  const act = useActOnRequest();
  const [message, setMessage] = useState('');
  const [comment, setComment] = useState({});
  const roles = [session?.roles ?? []].flat().join(',').split(',');
  const rows = pending.data?.data ?? [];

  const decide = async (r, action) => {
    setMessage('');
    try {
      await act.mutateAsync({ id: r.id, action, comment: comment[r.id] || (action === 'reject' ? 'Not approved' : 'Approved'), version: r.version });
      setMessage(`${r.title}: ${action === 'approve' ? (r.currentStep < r.chain.length ? 'approved, waiting for the next approver' : 'approved and applied') : 'rejected'}.`);
    } catch (err) {
      setMessage(errorInfo(err).form);
    }
  };

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Approvals</nav>
      <h1 id="page-title">Approvals</h1>
      <p className="muted">Changes that need a second person's agreement before they take effect. You can decide a request when it is your role's turn and you did not raise it.</p>
      <p role="status" className="notice">{message}</p>
      <QueryState query={pending} what="the approvals" permission="core.requests.view" />
      {pending.data && rows.length === 0 && <div className="state"><h2>Nothing is waiting</h2><p>Requests for approval appear here as soon as someone raises one.</p></div>}
      {rows.length > 0 && (
        <ul className="plain" aria-label="Requests waiting for a decision">
          {rows.map((r) => {
            const step = r.chain[r.currentStep - 1];
            const mine = roles.includes(step) && r.requestedBy !== session?.user;
            return (
              <li key={r.id} className="card" data-testid={`request-${r.id}`}>
                <div className="page-head">
                  <strong>{r.title}</strong>
                  <span className="chip chip-status-soft-closed">{KIND[r.type] ?? r.type}</span>
                </div>
                <p>{r.reason}</p>
                <Summary r={r} />
                <p className="muted small">
                  Raised by {r.requestedBy}, {formatDateTime(r.requestedAt)}. Chain: {r.chain.map((c, i) => <span key={c + i} className={`chip ${i + 1 < r.currentStep ? 'chip-on' : i + 1 === r.currentStep ? 'chip-status-open' : 'chip-off'}`}>{c}</span>)}{' '}
                  Waiting for <strong>{step}</strong>.
                </p>
                {mine ? (
                  <div className="row">
                    <label className="field"><span>Comment (required to reject)</span><input value={comment[r.id] ?? ''} onChange={(e) => setComment({ ...comment, [r.id]: e.target.value })} /></label>
                    <button type="button" className="btn btn-primary" disabled={act.isPending} onClick={() => decide(r, 'approve')} aria-label={`Approve ${r.title}`}>Approve</button>
                    <button type="button" className="btn" disabled={act.isPending} onClick={() => decide(r, 'reject')} aria-label={`Reject ${r.title}`}>Reject</button>
                  </div>
                ) : (
                  <p className="muted small">{r.requestedBy === session?.user ? 'You raised this request, so someone else must decide it.' : `It is not your turn: it needs the ${step} role.`}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
