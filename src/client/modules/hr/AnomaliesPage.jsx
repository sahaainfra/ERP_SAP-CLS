import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { SEVERITY, attp } from './api.js';

// Attendance Anomalies (HR, part 07.05, FR-08): the worklist of punches that look wrong, the most serious and the oldest first, each with a colour for its age against the service time (green, amber, red). A reviewer accepts or
// rejects with a note, one at a time or for the rows ticked. Accepting an outside-fence punch makes it count; for a person for whom that was accepted several times lately it also goes to the HR manager (it then shows as waiting).
// Nobody reviews their own punch. The selfie, where there is one, opens for those who review.
const TYPES = [['', 'All kinds'], ['OUTSIDE_FENCE', 'Outside the fence'], ['IMPOSSIBLE_TRAVEL', 'Impossible travel'], ['MOCK_LOCATION', 'Mock location'], ['SHARED_DEVICE', 'Phone used by several people'], ['LOW_ACCURACY', 'Low accuracy'], ['REPEATED_LOW_ACCURACY', 'Repeated low accuracy'], ['NEW_DEVICE', 'New phone'], ['CLOCK_SKEW', 'Clock difference'], ['LATE_SYNC', 'Late sync'], ['NO_PRIOR_IN', 'Out without an in'], ['SELFIE_MISMATCH', 'Selfie does not match']];
const STATUS = [['OPEN', 'Waiting for review'], ['PENDING_APPROVAL', 'Waiting for the HR manager'], ['ACCEPTED', 'Accepted'], ['REJECTED', 'Rejected'], ['ALL', 'All']];
export default function AnomaliesPage() {
  usePageTitle('Attendance Anomalies');
  const qc = useQueryClient();
  const [status, setStatus] = useState('OPEN');
  const [type, setType] = useState('');
  const [picked, setPicked] = useState([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const q = useQuery({ queryKey: ['att', 'anomalies', status, type], queryFn: () => attp.anomalies({ status, type: type || undefined, limit: 200 }), retry: false });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['att'] }); setPicked([]); };
  if (q.error?.status === 403) return <NoPermission what="attendance anomalies" permission="att.anomaly.view" />;
  const rows = q.data?.data ?? [];
  const open = rows.filter((r) => r.status === 'OPEN');
  const decide = async (ids, decision) => {
    setError(null); setDone(null);
    if (note.trim().length < 5) { setError({ form: 'Write the reason in the note first (at least 5 characters).' }); return; }
    try {
      if (ids.length === 1) { const r = await attp.review(ids[0], { decision, note: note.trim() }); setDone(r.status === 'PENDING_APPROVAL' ? 'Sent on to the HR manager: this person has had several outside-fence punches accepted lately.' : decision === 'ACCEPT' ? 'Accepted.' : 'Rejected.'); }
      else { const r = await attp.bulk({ ids, decision, note: note.trim() }); setDone(`${r.done} done${r.failed ? `, ${r.failed} not done (${r.results.filter((x) => !x.ok).map((x) => x.error).join('; ')})` : ''}.`); }
      refresh();
    } catch (e) { setError(errorInfo(e)); }
  };
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <section aria-labelledby="an-title" data-testid="anomalies">
      <h1 id="an-title">Attendance Anomalies</h1>
      <form className="srch-form" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
        <Field label="Show" name="status" error={null}><select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="an-status">{STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Kind" name="type" error={null}><select value={type} onChange={(e) => setType(e.target.value)} data-testid="an-type">{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Note for the decision (required)" name="note" error={null}><input value={note} onChange={(e) => setNote(e.target.value)} data-testid="an-note" /></Field>
      </form>
      <p className="muted small" data-testid="an-legend"><span className="att-dot att-green" /> within half the service time · <span className="att-dot att-amber" /> past half · <span className="att-dot att-red" /> past the service time · most serious first, then oldest.</p>
      {error?.form && <p className="field-error" role="alert" data-testid="an-error">{error.form}</p>}
      {done && <p className="mdm-banner" role="status" data-testid="an-done">{done}</p>}
      {status === 'OPEN' && open.length > 0 && (
        <div className="actions-row" data-testid="an-bulk"><button type="button" className="btn" disabled={!picked.length} onClick={() => decide(picked, 'ACCEPT')} data-testid="an-bulk-accept">Accept {picked.length || ''} ticked</button><button type="button" className="btn" disabled={!picked.length} onClick={() => decide(picked, 'REJECT')} data-testid="an-bulk-reject">Reject {picked.length || ''} ticked</button></div>
      )}
      {q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.isPending ? <Skeleton label="Loading the anomalies" rows={4} /> : rows.length === 0 ? <EmptyState title="Nothing to review" message="Punches that look wrong appear here: outside the fence, a fake location, travel that cannot be, a phone used by two people." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Anomalies">
          <table className="grid" data-testid="an-table"><thead><tr><th><span className="sr-only">Pick</span></th><th>Priority</th><th>Age</th><th>Person</th><th>What</th><th>Site</th><th>Punch</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{rows.map((a) => (
              <tr key={a.id} data-testid="an-row" data-type={a.type}>
                <td data-label="Pick">{a.status === 'OPEN' && <input type="checkbox" checked={picked.includes(a.id)} onChange={() => toggle(a.id)} aria-label={`Pick ${a.person}, ${a.typeLabel}`} data-testid="an-pick" />}</td>
                <td data-label="Priority"><StatusBadge status={SEVERITY[a.severity][0]} label={SEVERITY[a.severity][1]} /></td>
                <td data-label="Age"><span className={`att-dot att-${a.colour}`} aria-hidden="true" /> {a.ageHours} h<span className="sr-only"> ({a.colour})</span></td>
                <td data-label="Person">{a.person} <span className="muted small">{a.code}</span></td>
                <td data-label="What">{a.typeLabel}<span className="muted small"> {a.detail ?? ''}</span></td>
                <td data-label="Site">{a.site}</td>
                <td data-label="Punch">{a.punchType === 'IN' ? 'In' : 'Out'} {formatDateTime(a.effectiveTime)} · {a.result.toLowerCase()}{a.hasSelfie && <> · <a href={`/api/v1/att/punches/${a.punchId}/selfie`} target="_blank" rel="noreferrer">selfie</a></>}</td>
                <td data-label="Status">{STATUS.find(([k]) => k === a.status)?.[1] ?? a.status}{a.reviewNote ? ` · ${a.reviewNote}` : ''}</td>
                <td data-label="Actions">{a.status === 'OPEN' && <><button type="button" className="btn btn-small" onClick={() => decide([a.id], 'ACCEPT')} data-testid="an-accept">Accept</button> <button type="button" className="btn btn-small" onClick={() => decide([a.id], 'REJECT')} data-testid="an-reject">Reject</button></>}</td>
              </tr>))}</tbody></table>
        </div>
      )}
      <p className="small"><Link to="/att/today">Today's attendance</Link></p>
    </section>
  );
}
