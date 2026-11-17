import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { BAND_TEXT, regs } from './api.js';
import RequestForm from './RequestForm.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Attendance Approvals (HR, part 07.06, FR-03 to FR-05): the regularisations, overtime requests and manual entries waiting for the person, in one worklist. Tick several and approve them together, or reject or return them with a reason; each is decided
// on its own, so one that cannot be decided does not stop the others. A person never decides what they raised. HR also enters attendance by hand here (a second person approves it).
const KIND_LABEL = { regularisation: 'Regularisation', overtime: 'Overtime', manual: 'Manual entry' };
export default function AttendanceApprovalsPage() {
  usePageTitle('Attendance Approvals');
  const qc = useQueryClient();
  const session = useSession();
  const [picked, setPicked] = useState([]);
  const [comment, setComment] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [manual, setManual] = useState(false);
  const q = useQuery({ queryKey: ['att', 'approvals'], queryFn: regs.approvals, retry: false });
  if (q.error?.status === 403) return <NoPermission what="attendance approvals" permission="att.register.view" />;
  const rows = q.data ?? [];
  const canManual = (session.data?.permissions ?? []).includes('att.manual.create');
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const decide = async (decision, ids = picked) => {
    setError(null); setDone(null);
    if (decision !== 'APPROVE' && comment.trim().length < 5) { setError({ form: 'Write the reason first (at least 5 characters).' }); return; }
    try {
      const r = await regs.bulk({ taskIds: ids, decision, comment: comment.trim() || undefined });
      setDone(`${r.done} done${r.failed ? `, ${r.failed} not done (${r.results.filter((x) => !x.ok).map((x) => x.error).join('; ')})` : ''}.`);
      setPicked([]); qc.invalidateQueries({ queryKey: ['att'] });
    } catch (e) { setError(errorInfo(e)); }
  };
  return (
    <section aria-labelledby="ap-title" data-testid="approvals">
      <PageHeader id="ap-title" title={"Attendance Approvals"} />
      <Field label="Note for the decision (needed to reject or return)" name="comment" error={null}><input value={comment} onChange={(e) => setComment(e.target.value)} data-testid="ap-comment" /></Field>
      {error?.form && <p className="field-error" role="alert" data-testid="ap-error">{error.form}</p>}
      {done && <p className="mdm-banner" role="status" data-testid="ap-done">{done}</p>}
      {rows.length > 0 && (
        <div className="actions-row" data-testid="ap-bulk">
          <button type="button" className="btn" onClick={() => setPicked(picked.length === rows.length ? [] : rows.map((r) => r.taskId))} data-testid="ap-all">{picked.length === rows.length ? 'Clear' : 'Pick all'}</button>
          <button type="button" className="btn btn-primary" disabled={!picked.length} onClick={() => decide('APPROVE')} data-testid="ap-approve">Approve {picked.length || ''} ticked</button>
          <button type="button" className="btn" disabled={!picked.length} onClick={() => decide('RETURN')} data-testid="ap-return">Return</button>
          <button type="button" className="btn" disabled={!picked.length} onClick={() => decide('REJECT')} data-testid="ap-reject">Reject</button>
        </div>
      )}
      {q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.isPending ? <Skeleton label="Loading the approvals" rows={4} /> : rows.length === 0 ? <EmptyState title="Nothing waits for you" message="Regularisations, overtime and manual entries that need your decision appear here." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Waiting for approval">
          <table className="grid" data-testid="ap-table"><thead><tr><th><span className="sr-only">Pick</span></th><th>Kind</th><th>Request</th><th>Employee</th><th>Day</th><th>Reason</th><th>Goes to</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.taskId} data-testid="ap-row" data-kind={r.kind}>
                <td data-label="Pick"><input type="checkbox" checked={picked.includes(r.taskId)} onChange={() => toggle(r.taskId)} aria-label={`Pick ${r.docNo}, ${r.employee}`} data-testid="ap-pick" /></td>
                <td data-label="Kind">{KIND_LABEL[r.kind]}</td><td data-label="Request">{r.docNo}{r.arrears ? ' · arrears' : ''}</td><td data-label="Employee">{r.employee} <span className="muted small">{r.employeeCode}</span></td>
                <td data-label="Day">{r.workDate}</td><td data-label="Reason">{r.reason}</td><td data-label="Goes to">{BAND_TEXT[r.band]}</td>
              </tr>))}</tbody></table>
        </div>
      )}
      {canManual && (
        <>
          <h2>Manual attendance entry</h2>
          {manual ? <RequestForm kind="manual" testid="ap-manual" /> : <button type="button" className="btn" onClick={() => setManual(true)} data-testid="ap-manual-open">Enter attendance by hand</button>}
        </>
      )}
      <p className="small"><Link to="/att/register">Monthly Attendance Register</Link> · <Link to="/att/anomalies">Attendance Anomalies</Link></p>
    </section>
  );
}
