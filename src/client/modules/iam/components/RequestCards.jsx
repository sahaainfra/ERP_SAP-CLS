import { formatDateTime } from '../../../platform/format.js';
import { Link } from '../../core/pages/ui.jsx';

const STATUS = { SUBMITTED: ['Waiting', 'chip-not_applicable'], APPROVED: ['Approved', 'chip-pass'], REJECTED: ['Rejected', 'chip-fail'], RETURNED: ['Returned', 'chip-fail'], CANCELLED: ['Withdrawn', 'chip-never'] };

/** Approval requests with each step and who decided it. A step written 'ITADM|DIR' is decided by either role. */
export default function RequestCards({ requests, emptyTitle = 'No approval requests', emptyText = 'A request appears here with each approver\'s decision.' }) {
  return (
    <div>
      {requests.length === 0 && <div className="state"><h2>{emptyTitle}</h2><p>{emptyText}</p></div>}
      {requests.map((r) => {
        const [label, cls] = STATUS[r.status] ?? [r.status, 'chip-not_applicable'];
        return (
          <article key={r.id} className="card" data-testid={`request-${r.id}`}>
            <h3>{r.title} <span className={`chip ${cls}`}>{label}</span></h3>
            <p className="muted">Raised by {r.requestedBy} on {formatDateTime(r.requestedAt)}. Reason: {r.reason}</p>
            <ol className="steps">
              {r.chain.map((role, i) => {
                const s = r.steps.find((x) => x.stepNo === i + 1);
                return <li key={`${role}-${i}`}>{role.replace('|', ' or ')}: {s ? `${s.decision.toLowerCase()} by ${s.decidedBy}${s.comment ? ` (${s.comment})` : ''}` : r.status === 'SUBMITTED' && r.currentStep === i + 1 ? 'waiting for a decision' : 'not reached'}</li>;
              })}
            </ol>
          </article>
        );
      })}
      <p className="muted small">Approvers decide on the <Link to="/admin/approvals">Approvals</Link> page.</p>
    </div>
  );
}
