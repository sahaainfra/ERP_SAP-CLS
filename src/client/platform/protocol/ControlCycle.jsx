import StatusBadge from '../design/StatusBadge.jsx';
import { useCycle } from './api.js';

const LABEL = { PLAN: 'Plan', VERIFY: 'Verify', APPROVE: 'Approve', EXECUTE: 'Execute', RECORD: 'Record', MONITOR: 'Monitor', RECONCILE: 'Reconcile', CLOSE: 'Close' };
const RESULT = { PASS: 'Passed', WARN: 'Warned', BLOCK: 'Blocked', EXCEPTION_REQUIRED: 'Needs an exception', EXCEPTED: 'Excepted', MONITORED: 'Noted', WOULD_WARN: 'Would warn', WOULD_BLOCK: 'Would block', WOULD_REQUIRE_EXCEPTION: 'Would need an exception' };

/** The control cycle of a business object (part 04.04, FR-05): which of Plan, Verify, Approve, Execute, Record, Monitor, Reconcile and Close it has passed, and what the controls said. */
export default function ControlCycle({ entity, id }) {
  const q = useCycle(entity, id);
  if (q.isPending) return <p className="muted" role="status">Loading the control cycle...</p>;
  if (q.isError) return null;
  return (
    <section aria-label="Control cycle" className="card" data-testid="control-cycle">
      <h3>Control cycle</h3>
      <ol className="wf-diagram" aria-label="Stages of the control cycle">
        {q.data.map((s, i) => (
          <li key={s.stage} className={`wf-step ${s.done ? 'wf-step-done' : 'wf-step-pending'}`} data-testid={`cycle-${s.stage}`}>
            <span className="wf-step-no" aria-hidden="true">{i + 1}</span>
            <strong>{LABEL[s.stage]}</strong>
            <span className="muted small">{s.done ? 'Done' : 'Pending'}</span>
            {s.controls.map((c) => <span key={c.code} className="small"><code>{c.code}</code> {RESULT[c.result] ?? c.result}</span>)}
          </li>
        ))}
      </ol>
      <p className="muted small"><StatusBadge status="approved" label="Done" /> stages are recorded by the checks and the approval; the rest wait for the modules that own them.</p>
    </section>
  );
}
