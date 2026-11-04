import { useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { PRIORITY, comm, usePending, useRefreshComm } from '../../platform/messages/Comm.jsx';
import { errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';

// Pending Acknowledgements (part 05.04, section 7.2): a worklist of the instructions the person has to acknowledge, overdue and urgent first, with a colour for how late they are, a quick acknowledge (with an optional
// answer) and a bulk acknowledge for the ones the policy allows (not high or urgent: those are acknowledged one by one).
export default function PendingAcknowledgementsPage({ session }) {
  usePageTitle('Pending Acknowledgements');
  const q = usePending(session);
  const refresh = useRefreshComm();
  const [picked, setPicked] = useState([]);
  const [reply, setReply] = useState({});
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading your pending acknowledgements" rows={3} />;
  const rows = q.data.rows;
  const bulkOk = picked.length > 0 && picked.every((id) => !['HIGH', 'URGENT'].includes(rows.find((r) => r.id === id)?.priority));
  const run = async (fn, msg) => { setError(null); setNotice(''); try { await fn(); setNotice(msg); setPicked([]); refresh(); } catch (e) { setError(errorInfo(e)); } };
  const tone = (r) => (r.overdue ? 'is-overdue' : r.dueSoon ? 'is-soon' : '');
  return (
    <section aria-labelledby="pa-title" data-testid="pending-acks">
      <h1 id="pa-title">Pending Acknowledgements</h1>
      <p className="muted">{q.data.counts.pending} waiting, {q.data.counts.overdue} overdue, {q.data.counts.urgent} urgent. Overdue and urgent first.</p>
      {notice && <p role="status" className="notice" data-testid="pa-notice">{notice}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="pa-error">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}</p>}
      {rows.length === 0 ? <EmptyState title="Nothing to acknowledge" message="When someone sends you an instruction that needs your acknowledgement, it appears here." action={<button type="button" className="btn btn-primary" onClick={() => navigateTo('/collab/messages')}>Open Messages</button>} /> : (
        <>
          <div className="actions"><button type="button" className="btn" disabled={!bulkOk} onClick={() => run(() => comm.bulkAck(picked), `${picked.length} acknowledged.`)} data-testid="pa-bulk">Acknowledge the selected ({picked.length})</button>
            {picked.length > 0 && !bulkOk && <span className="muted small" role="status">High and urgent instructions are acknowledged one by one.</span>}</div>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Instructions to acknowledge"><table className="grid"><thead><tr><th><span className="sr-only">Select</span></th><th>Priority</th><th>Instruction</th><th>From</th><th>Due</th><th>Waiting</th><th>Acknowledge</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className={tone(r)} data-testid="pa-row">
                <td data-label="Select"><input type="checkbox" aria-label={`Select ${r.title}`} checked={picked.includes(r.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.id] : picked.filter((x) => x !== r.id))} /></td>
                <td data-label="Priority"><StatusBadge status={PRIORITY[r.priority][0]} label={PRIORITY[r.priority][1]} /></td>
                <th scope="row" data-label="Instruction"><button type="button" className="link-button" onClick={() => navigateTo(`/collab/messages?c=${r.conversationId}&m=${r.messageId}`)}>{r.title}</button><div className="muted small">{r.conversation}</div></th>
                <td data-label="From">{r.sender.name}</td>
                <td data-label="Due">{r.dueAt ? formatDateTime(r.dueAt) : '—'}{r.overdue ? ' · overdue' : r.dueSoon ? ' · due soon' : ''}</td>
                <td data-label="Waiting">{r.ageHours < 24 ? `${r.ageHours} h` : `${Math.round(r.ageHours / 24)} d`}</td>
                <td data-label="Acknowledge"><label className="sr-only" htmlFor={`pa-r-${r.id}`}>Answer (optional)</label><input id={`pa-r-${r.id}`} placeholder="Answer (optional)" value={reply[r.id] ?? ''} maxLength={500} onChange={(e) => setReply({ ...reply, [r.id]: e.target.value })} /> <button type="button" className="btn btn-primary btn-small" onClick={() => run(() => comm.ack(r.id, reply[r.id]?.trim()), `"${r.title}" acknowledged.`)} data-testid="pa-ack">Acknowledge</button></td>
              </tr>))}</tbody></table></div>
        </>
      )}
    </section>
  );
}
