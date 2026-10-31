import { useState } from 'react';
import { formatDate, formatDateTime } from '../../../platform/format.js';
import { Field, FormDialog, Link, QueryState, errorInfo } from '../../core/pages/ui.jsx';
import { useOrgAssign, useOrgCancelAssignment, useOrgHistory, useOrgRequests, useOrgUsers } from '../api/org.js';

const ROLE = { HEAD: 'Head', PROJECT_MANAGER: 'Project manager', IN_CHARGE: 'Site in-charge' };
const REQUEST_STATUS = { SUBMITTED: 'Waiting', APPROVED: 'Approved', REJECTED: 'Rejected', RETURNED: 'Returned', CANCELLED: 'Withdrawn' };
const REQUEST_CHIP = { SUBMITTED: 'chip-not_applicable', APPROVED: 'chip-pass', REJECTED: 'chip-fail', RETURNED: 'chip-fail', CANCELLED: 'chip-never' };
const today = () => new Date(Date.now() + 19_800_000).toISOString().slice(0, 10);

/** The approval requests raised for one record, with each step and who decided it. */
export function RequestsPanel({ entity, id }) {
  const q = useOrgRequests(entity, id);
  const rows = q.data ?? [];
  return (
    <>
      <QueryState query={q} what="approval requests" permission="org.view" />
      {q.data && rows.length === 0 && <div className="state"><h2>No approval requests</h2><p>Requests to activate this record or change its geofence appear here with their approval history.</p></div>}
      {rows.map((r) => (
        <article key={r.id} className="card" data-testid={`request-${r.id}`}>
          <h3>{r.title} <span className={`chip ${REQUEST_CHIP[r.status]}`}>{REQUEST_STATUS[r.status] ?? r.status}</span></h3>
          <p className="muted">Raised by {r.requestedBy} on {formatDateTime(r.requestedAt)}. Reason: {r.reason}</p>
          <ol className="steps">
            {r.chain.map((role, i) => {
              const s = r.steps.find((x) => x.stepNo === i + 1);
              return <li key={role}>{role}: {s ? `${s.decision.toLowerCase()} by ${s.decidedBy}${s.comment ? ` (${s.comment})` : ''}` : r.status === 'SUBMITTED' && r.currentStep === i + 1 ? 'waiting for a decision' : 'not reached'}</li>;
            })}
          </ol>
        </article>
      ))}
      <p className="muted small">Approvers decide on the <Link to="/admin/approvals">Approvals</Link> page.</p>
    </>
  );
}

const describe = (a) => {
  const keys = { create: 'Created', update: 'Changed', deactivate: 'Deactivated', activate: 'Activated', activated: 'Activated after approval', status_change: 'Status changed', geofence_change_approved: 'Geofence changed after approval', assignment_scheduled: 'Change scheduled', assignment_applied: 'Change took effect', assignment_cancelled: 'Scheduled change cancelled' };
  return keys[a.action] ?? a.action.replace(/_/g, ' ');
};

/** Who held a role and when (effective-dated), and the audit trail of the record. */
export function HistoryPanel({ entity, id, canManage }) {
  const q = useOrgHistory(entity, id);
  const cancel = useOrgCancelAssignment(entity);
  const [error, setError] = useState('');
  const h = q.data;
  return (
    <>
      <QueryState query={q} what="the history" permission="org.view" />
      {h && (
        <>
          {h.assignments.length > 0 && (
            <>
              <h3>Assignments</h3>
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Effective-dated assignments</caption>
                  <thead><tr><th>Role</th><th>Person</th><th>From</th><th>To</th><th>Why</th><th /></tr></thead>
                  <tbody>
                    {h.assignments.map((a) => (
                      <tr key={a.id} data-testid={`assignment-${a.id}`}>
                        <td data-label="Role">{ROLE[a.role]}</td>
                        <td data-label="Person">{a.userName ?? a.user ?? 'Vacant'}</td>
                        <td data-label="From">{formatDate(a.effectiveFrom)}{a.pending && <> <span className="chip chip-not_applicable">Scheduled</span></>}</td>
                        <td data-label="To">{a.effectiveTo ? formatDate(a.effectiveTo) : a.pending ? '' : 'Current'}</td>
                        <td data-label="Why">{a.reason}</td>
                        <td>{a.pending && canManage && <button type="button" className="btn btn-small" onClick={() => cancel.mutateAsync({ id, assignmentId: a.id }).catch((e) => setError(e.message))}>Cancel</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {error && <p className="field-error" role="alert">{error}</p>}
            </>
          )}
          <h3>Audit trail</h3>
          {h.audit.length === 0 ? <p className="muted">Nothing recorded yet.</p> : (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Audit trail</caption>
                <thead><tr><th>When (IST)</th><th>What</th><th>By</th><th>Reason</th></tr></thead>
                <tbody>
                  {h.audit.map((a, i) => (
                    <tr key={i}><td data-label="When">{formatDateTime(a.at)}</td><td data-label="What">{describe(a)}</td><td data-label="By">{a.actor}</td><td data-label="Reason">{a.reason ?? ''}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

/** Change who holds a role from a date; a later date waits until it comes. */
export function AssignDialog({ dialogRef, entity, row, role, onDone }) {
  const users = useOrgUsers('');
  const assign = useOrgAssign(entity);
  const [error, setError] = useState(null);
  return (
    <FormDialog
      dialogRef={dialogRef}
      title={`Change ${ROLE[role].toLowerCase()} of ${row?.code ?? ''}`}
      error={error}
      busy={assign.isPending}
      onSubmit={async (f) => {
        setError(null);
        try {
          const userId = String(f.get('userId'));
          const out = await assign.mutateAsync({ id: row.id, userId: userId ? Number(userId) : null, effectiveFrom: String(f.get('effectiveFrom')), reason: String(f.get('reason')) });
          dialogRef.current?.close();
          onDone?.(out.applied ? 'The change took effect.' : `The change is scheduled for ${formatDate(out.effectiveFrom)}.`);
        } catch (err) {
          setError(errorInfo(err));
        }
      }}
    >
      <Field label={ROLE[role]} name="userId" error={error}>
        <select name="userId" defaultValue="">
          <option value="">Vacant</option>
          {(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.displayName} ({u.username})</option>)}
        </select>
      </Field>
      <Field label="Effective from" name="effectiveFrom" error={error} hint="Today or earlier takes effect now; a later date waits for that day.">
        <input type="date" name="effectiveFrom" required defaultValue={today()} />
      </Field>
    </FormDialog>
  );
}

/** A dialog that asks only for a reason (and shows a short explanation) before running an action. */
export function ReasonDialog({ dialogRef, title, submitLabel, onRun, children, onDone }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  return (
    <FormDialog
      dialogRef={dialogRef}
      title={title}
      submitLabel={submitLabel}
      error={error}
      busy={busy}
      onSubmit={async (f) => {
        setError(null);
        setBusy(true);
        try {
          const out = await onRun(String(f.get('reason')), f);
          dialogRef.current?.close();
          onDone?.(out);
        } catch (err) {
          setError({ ...errorInfo(err), blockers: (err.details ?? []).filter((d) => d.field === 'blockers') });
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      {error?.blockers?.length > 0 && (
        <div className="state state-error" role="alert" data-testid="blockers"><h3>Blocked by open records</h3><ul>{error.blockers.map((b, i) => <li key={i}>{b.message}</li>)}</ul></div>
      )}
    </FormDialog>
  );
}
