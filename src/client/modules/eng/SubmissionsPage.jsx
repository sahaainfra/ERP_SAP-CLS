import { useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime, formatINR } from '../../platform/format.js';
import { useInstanceAction, useSubmissions } from '../../platform/workflow/api.js';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { INST_STATUS } from './common.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// My Submissions & Watch List (part 04.03, section 7.4, FR-07): the documents I raised and the ones I follow, with where each stands and who it waits for.
const PAGE = 25;
export default function SubmissionsPage() {
  usePageTitle('My Submissions & Watch List');
  const [kind, setKind] = useState('submitted');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const list = useSubmissions({ kind, status, q, limit: PAGE, offset: (page - 1) * PAGE });
  const action = useInstanceAction();
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  const tab = (k, l) => <button type="button" role="tab" aria-selected={kind === k} className={`btn${kind === k ? ' btn-primary' : ''}`} onClick={() => { setKind(k); setPage(1); }}>{l}</button>;
  return (
    <section aria-labelledby="sb-title" data-testid="submissions">
      <PageHeader id="sb-title" title={"My Submissions & Watch List"} subtitle={"The documents you sent for approval, and the ones you follow, with the step each is at and who it is waiting for."} />
      <div role="tablist" aria-label="Which documents" className="wf-tabs">{tab('submitted', 'I submitted')}{tab('watching', 'I follow')}</div>
      <form className="srch-form" role="search" aria-label="Filter the documents" onSubmit={(e) => e.preventDefault()}>
        <label className="field"><span>Status</span><select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Any status</option>{Object.entries(INST_STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Words</span><input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
      </form>
      {list.isPending && <Skeleton label="Loading the documents" rows={3} />}
      {list.isError && <ErrorState title="The documents could not be loaded" error={list.error} onRetry={() => list.refetch()} />}
      {data && (data.rows.length === 0 ? <EmptyState title={kind === 'submitted' ? 'You have not submitted a document' : 'You follow no document'} message={kind === 'submitted' ? 'Documents you send for approval appear here.' : 'Follow a document from its approval page to see it here.'} /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Documents">
          <table className="grid">
            <thead><tr><th>Document</th><th className="num">Amount</th><th>Status</th><th>Waiting for</th><th>Sent</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{data.rows.map((r) => (
              <tr key={r.instanceId} data-testid={`sb-row-${r.instanceId}`}>
                <th scope="row" data-label="Document"><Link to={`/workflow/instance?id=${r.instanceId}`}>{r.docRef ?? r.title}</Link><br /><span className="muted small">{r.docLabel}: {r.title}{r.cycle > 1 ? ` · round ${r.cycle}` : ''}</span></th>
                <td className="num" data-label="Amount">{r.amount == null ? '' : formatINR(r.amount)}</td>
                <td data-label="Status"><StatusBadge status={INST_STATUS[r.status][0]} label={INST_STATUS[r.status][1]} /></td>
                <td data-label="Waiting for">{r.status === 'RUNNING' ? (r.waitingFor.join(', ') || 'no one') : r.status === 'RETURNED' ? 'You: it was returned' : ''}{r.needsAdmin ? ' (an administrator must assign it)' : ''}</td>
                <td data-label="Sent">{formatDateTime(r.submittedAt)}</td>
                <td>{kind === 'watching' && r.submittedBy !== undefined && <button type="button" className="btn btn-small" disabled={action.isPending} onClick={() => action.mutate({ id: r.instanceId, action: 'unwatch' })}>Stop following<span className="sr-only"> {r.docRef}</span></button>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      ))}
      <div className="pager"><span>{data?.total ?? 0} document(s), page {page} of {pages}</span>
        <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
    </section>
  );
}
