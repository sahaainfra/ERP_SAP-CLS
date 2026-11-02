import StatusBadge from '../design/StatusBadge.jsx';

// The read-only diagram of a workflow definition or of an instance (part 04.01, FR-08): the steps left to right (top to bottom on a narrow screen),
// each with its kind, who decides, the time allowed and, for an instance, where it stands. It is a list underneath, so a screen reader reads it in order.
const MODE = { single: 'one approver', parallel_all: 'all must approve', parallel_any: 'any one approves' };
const TYPE = { approval: 'Approval', review: 'Review', notification: 'Notification', system: 'System action' };
const STATE = { ACTIVE: ['submitted', 'Waiting'], DONE: ['approved', 'Done'], SKIPPED: ['cancelled', 'Skipped'], REJECTED: ['rejected', 'Rejected'], PENDING: ['draft', 'Not reached'] };
const OPS = { eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', in: 'is one of' };

export const who = (a) => (a.kind === 'role' ? a.role.replace(/\|/g, ' or ') : a.kind === 'user' ? a.user : a.kind === 'manager' ? 'reporting manager' : `resolved by ${a.resolver}`);

export default function StepDiagram({ steps, label = 'Workflow steps' }) {
  return (
    <ol className="wf-diagram" aria-label={label} data-testid="wf-diagram">
      {steps.map((s, i) => (
        <li key={s.code} className={`wf-step wf-step-${(s.state ?? 'PENDING').toLowerCase()}`} data-testid={`wf-step-${s.code}`}>
          <span className="wf-step-no" aria-hidden="true">{i + 1}</span>
          <strong>{s.name}</strong>
          <span className="muted small">{TYPE[s.type]}{s.type === 'approval' || s.type === 'review' ? `, ${MODE[s.mode]}` : ''}</span>
          <span className="small">{(s.type === 'notification' ? s.notify : s.approvers).map(who).join(s.mode === 'parallel_all' ? ' and ' : ' / ') || (s.type === 'system' ? s.action : '')}</span>
          {s.slaHours && <span className="muted small">{s.slaHours} h allowed</span>}
          {s.when && <span className="muted small">only when {s.when.field} {OPS[s.when.op]} {Array.isArray(s.when.value) ? s.when.value.join(', ') : String(s.when.value)}</span>}
          {(s.requireAttachment || s.checklist?.length > 0) && <span className="muted small">{s.requireAttachment ? 'needs an attachment' : ''}{s.requireAttachment && s.checklist?.length ? ', ' : ''}{s.checklist?.length ? `${s.checklist.length} check(s)` : ''}</span>}
          {s.state && <StatusBadge status={STATE[s.state][0]} label={STATE[s.state][1]} />}
        </li>
      ))}
    </ol>
  );
}
