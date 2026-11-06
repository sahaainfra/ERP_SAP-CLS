import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { lv } from './api.js';

// Leave Approvals (HR, part 07.07, FR-04): the leave applications waiting for the person (the reporting manager, and the HR manager for more than 10 days or a special type), each with the people of the team away on the same days. Tick
// several and approve them together, or return or reject with a reason; each is decided on its own. A person never decides their own leave.
export default function LeaveApprovalsPage() {
  usePageTitle('Leave Approvals');
  const qc = useQueryClient();
  const [picked, setPicked] = useState([]);
  const [comment, setComment] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const q = useQuery({ queryKey: ['lv', 'approvals'], queryFn: lv.approvals, retry: false });
  if (q.error?.status === 403) return <NoPermission what="leave approvals" permission="hr.application.approve" />;
  const rows = q.data ?? [];
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const decide = async (decision) => {
    setError(null); setDone(null);
    if (decision !== 'APPROVE' && comment.trim().length < 5) { setError({ form: 'Write the reason first (at least 5 characters).' }); return; }
    try { const r = await lv.bulk({ taskIds: picked, decision, comment: comment.trim() || undefined }); setDone(`${r.done} done${r.failed ? `, ${r.failed} not done (${r.results.filter((x) => !x.ok).map((x) => x.error).join('; ')})` : ''}.`); setPicked([]); qc.invalidateQueries({ queryKey: ['lv'] }); } catch (e) { setError(errorInfo(e)); }
  };
  return (
    <section aria-labelledby="la-title" data-testid="leave-approvals">
      <h1 id="la-title">Leave Approvals</h1>
      <Field label="Note for the decision (needed to reject or return)" name="comment" error={null}><input value={comment} onChange={(e) => setComment(e.target.value)} data-testid="la-comment" /></Field>
      {error?.form && <p className="field-error" role="alert" data-testid="la-error">{error.form}</p>}
      {done && <p className="mdm-banner" role="status" data-testid="la-done">{done}</p>}
      {rows.length > 0 && (
        <div className="actions-row" data-testid="la-bulk">
          <button type="button" className="btn" onClick={() => setPicked(picked.length === rows.length ? [] : rows.map((r) => r.taskId))} data-testid="la-all">{picked.length === rows.length ? 'Clear' : 'Pick all'}</button>
          <button type="button" className="btn btn-primary" disabled={!picked.length} onClick={() => decide('APPROVE')} data-testid="la-approve">Approve {picked.length || ''} ticked</button>
          <button type="button" className="btn" disabled={!picked.length} onClick={() => decide('RETURN')} data-testid="la-return">Return</button>
          <button type="button" className="btn" disabled={!picked.length} onClick={() => decide('REJECT')} data-testid="la-reject">Reject</button>
        </div>
      )}
      {q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.isPending ? <Skeleton label="Loading the approvals" rows={4} /> : rows.length === 0 ? <EmptyState title="Nothing waits for you" message="Leave applications that need your decision appear here." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Waiting for approval">
          <table className="grid" data-testid="la-table"><thead><tr><th><span className="sr-only">Pick</span></th><th>Application</th><th>Employee</th><th>Type</th><th>From</th><th>To</th><th className="num">Days</th><th>Reason</th><th>Team away</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.taskId} data-testid="la-row">
                <td data-label="Pick"><input type="checkbox" checked={picked.includes(r.taskId)} onChange={() => toggle(r.taskId)} aria-label={`Pick ${r.docNo}, ${r.employee}`} data-testid="la-pick" /></td>
                <td data-label="Application">{r.docNo}{r.band === 'EXTENDED' ? ' · HR manager too' : ''}</td><td data-label="Employee">{r.employee} <span className="muted small">{r.employeeCode}</span></td><td data-label="Type">{r.leaveType}</td>
                <td data-label="From">{r.fromDate}</td><td data-label="To">{r.toDate}</td><td className="num" data-label="Days">{r.days}</td><td data-label="Reason">{r.reason}</td>
                <td data-label="Team away">{r.clashes.length ? r.clashes.map((c) => c.name).join(', ') : 'No one'}</td>
              </tr>))}</tbody></table>
        </div>
      )}
      <p className="small"><Link to="/leave/calendar">Team Leave Calendar</Link> · <Link to="/leave/my">My Leave</Link></p>
    </section>
  );
}
