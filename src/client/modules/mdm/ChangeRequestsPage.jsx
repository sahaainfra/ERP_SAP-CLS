import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate, formatDateTime } from '../../platform/format.js';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { CHANGE, REQUEST_STATUS, mdm } from './api.js';

// Master Change Requests (Administration, part 06.01, FR-05): a worklist of the changes of governed masters. "Mine" are the requests I made (withdraw one that waits, correct and send again one that was returned);
// "To review" are the requests of the masters I am steward of, oldest first, coloured by how long they have waited; "All" is for the people who govern master data. A request shows what changes, field by field (sensitive
// values masked unless I may see them), its justification, the date it applies from and the possible duplicates found when it was made. The decision itself is taken in the approval inbox.
const sp = () => new URLSearchParams(window.location.search);
export default function ChangeRequestsPage() {
  usePageTitle('Master Change Requests');
  const qc = useQueryClient();
  const [f, setF] = useState(() => ({ view: sp().get('view') ?? 'mine', status: sp().get('status') ?? '', type: sp().get('type') ?? '' }));
  const [openId, setOpenId] = useState(() => Number(sp().get('open')) || null);
  const q = useQuery({ queryKey: ['mdm', 'requests', f], queryFn: () => mdm.requests(f), retry: false, placeholderData: (p) => p });
  const one = useQuery({ queryKey: ['mdm', 'request', openId], queryFn: () => mdm.request(openId), enabled: Boolean(openId), retry: false });
  const [error, setError] = useState(null);
  const [fix, setFix] = useState('');
  if (q.error?.status === 403) return <NoPermission what="these change requests" permission={f.view === 'all' ? 'mdm.governance.view' : 'mdm.record.view'} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the change requests" rows={4} />;
  const set = (p) => setF({ ...f, ...p });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['mdm'] }); };
  const withdraw = async (r) => { const why = window.prompt('Why do you withdraw this request?') ?? ''; if (why.trim().length < 5) return; setError(null); try { await mdm.cancel(r.id, why.trim()); refresh(); } catch (e) { setError(errorInfo(e)); } };
  const resend = async (r) => { setError(null); try { await mdm.resubmit(r.id, fix.trim().length >= 10 ? { justification: fix.trim() } : {}); setFix(''); refresh(); } catch (e) { setError(errorInfo(e)); } };
  const d = q.data;
  const c = one.data;
  return (
    <section aria-labelledby="mcr-title" data-testid="mdm-requests">
      <h1 id="mcr-title">Master Change Requests</h1>
      <div className="seg" role="tablist" aria-label="Which requests">{[['mine', 'My requests'], ['review', 'To review'], ['all', 'All']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={f.view === k} className={`btn btn-small ${f.view === k ? 'btn-primary' : ''}`} onClick={() => set({ view: k })} data-testid={`mcr-view-${k}`}>{l}</button>)}</div>
      <form className="srch-form" aria-label="Filter the requests" onSubmit={(e) => e.preventDefault()}>
        <Field label="Status" name="status" error={null}><select value={f.status} onChange={(e) => set({ status: e.target.value })} data-testid="mcr-status"><option value="">All</option>{Object.entries(REQUEST_STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      </form>
      <div className="cc-tiles" role="group" aria-label="Totals">{Object.entries(REQUEST_STATUS).filter(([k]) => d.counts[k]).map(([k, [, l]]) => <div key={k} className="cc-tile"><span className="cc-value num" data-testid={`mcr-count-${k}`}>{d.counts[k]}</span><span className="cc-label">{l}</span></div>)}</div>
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      {d.rows.length === 0 ? <EmptyState title="No request" message={f.view === 'review' ? 'Nothing waits for you.' : 'Requests appear here when a record is created, changed, made inactive or merged.'} /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Change requests"><table className="grid"><thead><tr><th>Request</th><th>Record</th><th>Change</th><th>Justification</th><th>From</th><th>By</th><th>Status</th><th>Waiting</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={r.id} className={['PENDING', 'RETURNED'].includes(r.status) ? (r.ageHours >= 96 ? 'is-overdue' : r.ageHours >= 48 ? 'is-soon' : '') : ''} data-testid="mcr-row">
              <th scope="row" data-label="Request"><a href={`?open=${r.id}`} onClick={(e) => { e.preventDefault(); setOpenId(r.id); }}>#{r.id}</a><div className="muted small">{r.masterLabel}</div></th>
              <td data-label="Record">{r.record ? `${r.record.code} ${r.record.name}` : '—'}{r.target && <div className="muted small">into {r.target.code} {r.target.name}</div>}</td>
              <td data-label="Change">{CHANGE[r.changeType]}{r.sensitive && <span className="muted small"> · sensitive</span>}</td>
              <td data-label="Justification">{r.justification}</td>
              <td data-label="From">{r.effectiveFrom ? formatDate(r.effectiveFrom) : '—'}</td>
              <td data-label="By">{r.requestedBy.name}</td>
              <td data-label="Status"><StatusBadge status={REQUEST_STATUS[r.status][0]} label={REQUEST_STATUS[r.status][1]} /></td>
              <td data-label="Waiting">{['PENDING', 'RETURNED'].includes(r.status) ? `${Math.floor(r.ageHours / 24)} d ${r.ageHours % 24} h` : formatDate(r.decidedAt ?? r.createdAt)}</td>
              <td>{r.mine && r.status === 'PENDING' && <button type="button" className="btn btn-small" onClick={() => withdraw(r)} data-testid="mcr-withdraw">Withdraw</button>}{r.canReview && r.status === 'PENDING' && !r.mine && r.instanceId && <button type="button" className="btn btn-small btn-primary" onClick={() => navigateTo('/approvals')} data-testid="mcr-decide">Decide</button>}</td>
            </tr>))}</tbody></table></div>
      )}
      {openId && (
        <aside className="mdm-panel" aria-labelledby="mcr-one" data-testid="mcr-detail">
          {one.isPending ? <Skeleton label="Loading the request" rows={3} /> : one.isError ? <ErrorState error={one.error} onRetry={one.refetch} /> : <>
            <div className="page-head"><h2 id="mcr-one">Request #{c.id}: {CHANGE[c.changeType]}</h2><StatusBadge status={REQUEST_STATUS[c.status][0]} label={REQUEST_STATUS[c.status][1]} /><button type="button" className="btn btn-small" onClick={() => setOpenId(null)}>Close</button></div>
            <dl className="kv-list"><div className="kv"><dt>Record</dt><dd>{c.record ? <Link to={`/admin/master-data/records?type=${c.masterType}&id=${c.recordId}`}>{c.record.code} {c.record.name}</Link> : '—'}</dd></div>
              <div className="kv"><dt>Justification</dt><dd>{c.justification}</dd></div><div className="kv"><dt>Applies from</dt><dd>{c.effectiveFrom ? formatDate(c.effectiveFrom) : '—'}</dd></div>
              <div className="kv"><dt>Asked by</dt><dd>{c.requestedBy.name} · {formatDateTime(c.createdAt)}</dd></div>{c.decidedBy && <div className="kv"><dt>Decided by</dt><dd>{c.decidedBy} · {formatDateTime(c.decidedAt)}</dd></div>}</dl>
            {c.fields.length > 0 && <div className="table-wrap" tabIndex={0} role="region" aria-label="What changes"><table className="grid"><thead><tr><th>Field</th><th>Now</th><th>Asked for</th></tr></thead><tbody>{c.fields.map((x) => <tr key={x.key} data-testid="mcr-field"><th scope="row" data-label="Field">{x.label}{x.sensitive && <span className="muted small"> · sensitive</span>}</th><td data-label="Now">{x.before ?? '—'}</td><td data-label="Asked for"><strong>{x.after ?? '—'}</strong></td></tr>)}</tbody></table></div>}
            {c.duplicates?.length > 0 && <p className="mdm-banner" role="note">Possible duplicates when it was asked: {c.duplicates.map((x) => `${x.code} ${x.name} (${(x.rules ?? []).join(', ')})`).join('; ')}</p>}
            {c.mine && c.status === 'RETURNED' && <div className="mdm-fix"><Field label="Corrected justification (optional)" name="fix" error={error}><textarea rows="2" value={fix} onChange={(e) => setFix(e.target.value)} maxLength={500} data-testid="mcr-fix" /></Field><button type="button" className="btn btn-primary" onClick={() => resend(c)} data-testid="mcr-resend">Send again</button>{' '}<button type="button" className="btn" onClick={() => withdraw(c)}>Withdraw</button></div>}
          </>}
        </aside>
      )}
    </section>
  );
}
