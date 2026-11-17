import { useState } from 'react';
import Icon from '../../platform/design/Icon.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ConfirmDialog } from '../../platform/feedback/Dialogs.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { authHeaders, exportUrl, useCancelException, useException, useExceptions, useSubmitException } from '../../platform/protocol/api.js';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from './common.js';
import Variants from './Variants.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Exceptions Register (part 04.04, section 7.3): every request to go ahead although a control point said no, with its reason, justification, evidence, value at risk and
// where it is in approval. A person sees what they raised; those who watch the business (permission eng.pcs.view) see the company's, inside their project scope. An
// exception is raised from the action a control stopped, not here, because the server only accepts one for an action that really was stopped.
export const STATUS = { DRAFT: ['draft', 'Draft'], PENDING: ['submitted', 'Waiting for approval'], APPROVED: ['approved', 'Approved, not yet used'], USED: ['approved', 'Used'], REJECTED: ['rejected', 'Rejected'], RETURNED: ['returned', 'Returned'], CANCELLED: ['cancelled', 'Cancelled'] };
const PAGE = 25;
const EMPTY = { status: '', control: '', projectId: '', minValue: '', emergency: '', q: '', sort: 'newest' };

function Detail({ id, session, onClose, setNotice }) {
  const query = useException(id);
  const submit = useSubmitException();
  const cancel = useCancelException();
  const [error, setError] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [uploaded, setUploaded] = useState(0);
  const e = query.data;
  if (query.isPending) return <Skeleton label="Loading the exception" rows={3} />;
  if (query.isError) return <ErrorState title="The exception could not be loaded" error={query.error} onRetry={() => query.refetch()} />;
  const mine = e.raisedBy === session?.user;
  const editable = mine && ['DRAFT', 'RETURNED'].includes(e.status);
  return (
    <article className="card" aria-label={`Exception ${e.no}`} data-testid="ex-detail">
      <h2>{e.no}: {e.control}</h2>
      <p><StatusBadge status={STATUS[e.status][0]} label={STATUS[e.status][1]} />{e.emergency && <> · <strong>Emergency</strong>{e.regularisedAt ? ' (regularised)' : e.overdue ? ' — overdue for approval, escalated' : `, to be approved by ${formatDateTime(e.regulariseBy)}`}</>}</p>
      <p>{e.controlDescription}</p>
      <ul className="srch-meta"><li>For <strong>{e.entityRef ?? `${e.entity} ${e.entityId}`}</strong></li><li>Value at risk <strong>{e.valueText}</strong></li><li>Raised by <strong>{e.raisedBy}</strong></li><li>Level <strong>{e.level}</strong></li>{e.usedAt && <li>Used {formatDateTime(e.usedAt)}</li>}</ul>
      <p><strong>Reason:</strong> {e.reason?.label ?? e.reasonCode}</p>
      <p><strong>Justification:</strong> {e.justification}</p>
      <h3>Evidence</h3>
      {editable && <FileUploader entity="pcs_exception" entityId={e.id} onDone={() => { setUploaded((n) => n + 1); query.refetch(); }} />}
      <AttachmentList key={uploaded} entity="pcs_exception" entityId={e.id} canEdit={editable} onReplace={() => {}} />
      <h3>What the control found</h3>
      <ul className="lp-list">{e.checks.map((c) => <li key={c.id}>{formatDateTime(c.at)}: {c.result.replaceAll('_', ' ').toLowerCase()} ({c.mode.toLowerCase()}, {c.user})</li>)}</ul>
      <h3>Approval</h3>
      {e.workflow ? <p data-testid="ex-approval">The approval is <strong>{e.workflow.status.toLowerCase()}</strong>. <Link to={`/workflow/instance?id=${e.workflow.id}`}>Open the approval</Link></p> : <p className="muted">It has not been sent for approval.</p>}
      {error && <p role="alert" className="error">{error.form}{error.correlationId && <> (<code>{error.correlationId}</code>)</>}</p>}
      <div className="actions">
        {editable && <button type="button" className="btn btn-primary" disabled={submit.isPending} onClick={() => submit.mutate({ id: e.id }, { onSuccess: () => { setNotice(`${e.no} sent for approval.`); setError(null); }, onError: (er) => setError(errorInfo(er)) })}>Send for approval</button>}
        {mine && ['DRAFT', 'PENDING', 'RETURNED', 'APPROVED'].includes(e.status) && !e.usedAt && <button type="button" className="btn" onClick={() => setCancelling(true)}>Cancel the exception</button>}
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
      <ConfirmDialog open={cancelling} title={`Cancel ${e.no}?`} text="The action it was for stays stopped by the control." confirmLabel="Cancel the exception" danger reasonFor="cancel"
        onConfirm={async ({ reason }) => { await cancel.mutateAsync({ id: e.id, reason }); setCancelling(false); setNotice(`${e.no} cancelled.`); }} onCancel={() => setCancelling(false)} />
    </article>
  );
}

export default function ExceptionsPage({ session }) {
  usePageTitle('Exceptions Register');
  const sp = useSearch();
  const open = Number(sp.get('open')) || null;
  const [filters, setFilters] = useState({ ...EMPTY, status: sp.get('status') ?? '', control: sp.get('control') ?? '', emergency: sp.get('emergency') ?? '' });
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const list = useExceptions({ ...filters, limit: PAGE, offset: (page - 1) * PAGE });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const download = async (format) => {
    const res = await fetch(exportUrl(format, { status: filters.status, control: filters.control, projectId: filters.projectId, q: filters.q }), { headers: { ...authHeaders(), 'x-correlation-id': globalThis.crypto.randomUUID() } });
    if (!res.ok) { setNotice('The export could not be prepared.'); return; }
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `exceptions.${format}` }).click();
    URL.revokeObjectURL(url);
    setNotice('');
  };
  if (list.error?.status === 403) return <NoPermission what="the exceptions" permission="eng.pcs.raise" />;
  const filtered = JSON.stringify(filters) !== JSON.stringify(EMPTY);
  return (
    <section aria-labelledby="ex-title" data-testid="exceptions">
      <PageHeader id="ex-title" title={"Exceptions Register"} subtitle={"Requests to go ahead although a control said no. Each has a reason, a justification and evidence, and is approved by the level the control names. Raise one from the action a control stopped."} />
      {notice && <p role="status" className="notice" data-testid="ex-notice">{notice}</p>}
      {open && <Detail key={open} id={open} session={session} setNotice={setNotice} onClose={() => navigateTo('/controls/exceptions', { force: true })} />}
      {data && <ul className="srch-meta" aria-label="Totals" data-testid="ex-totals"><li><strong>{data.total}</strong> exception(s)</li><li>Value at risk <strong>₹{Number(data.valueAtRisk).toLocaleString('en-IN')}</strong></li></ul>}
      <form className="srch-form" role="search" aria-label="Filter the exceptions" onSubmit={(e) => e.preventDefault()}>
        <label className="field"><span>Status</span><select value={filters.status} onChange={(e) => set({ status: e.target.value })}><option value="">Any status</option><option value="OPEN">Open (not decided or not used)</option>{Object.entries(STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Control</span><select value={filters.control} onChange={(e) => set({ control: e.target.value })}><option value="">All controls</option>{(data?.controls ?? []).map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label className="field"><span>Project</span><select value={filters.projectId} onChange={(e) => set({ projectId: e.target.value })}><option value="">All projects</option>{(data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></label>
        <label className="field"><span>Value at risk of at least (₹)</span><input inputMode="decimal" value={filters.minValue} onChange={(e) => set({ minValue: e.target.value.replace(/[^\d.]/g, '') })} /></label>
        <label className="field"><span>Emergency</span><select value={filters.emergency} onChange={(e) => set({ emergency: e.target.value })}><option value="">Any</option><option value="true">Emergency only</option><option value="false">Not emergency</option></select></label>
        <label className="field"><span>Order</span><select value={filters.sort} onChange={(e) => set({ sort: e.target.value })}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="value">Largest value first</option><option value="status">By status</option></select></label>
        <label className="field"><span>Words</span><input type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} /></label>
        {filtered && <button type="button" className="btn" onClick={() => set(EMPTY)}>Clear filters</button>}
      </form>
      <Variants list="pcs.exceptions" filters={filters} empty={EMPTY} apply={(f) => { setFilters(f); setPage(1); }} />
      <div className="srch-tools">
        <button type="button" className="btn" onClick={() => download('xlsx')}><Icon name="erp.action.export" size={16} /> Export XLSX</button>
        <button type="button" className="btn" onClick={() => download('csv')}>Export CSV</button>
        <button type="button" className="btn" onClick={() => download('pdf')}>Export PDF</button>
        <Link to="/controls/dashboard">Controls Dashboard</Link>
      </div>
      {list.isPending && <Skeleton label="Loading the exceptions" rows={4} />}
      {list.isError && list.error?.status !== 403 && <ErrorState title="The exceptions could not be loaded" error={list.error} onRetry={() => list.refetch()} />}
      {data && (data.rows.length === 0 ? (
        <EmptyState title={filtered ? 'No exception matches' : 'No exception yet'} message={filtered ? 'Change the filters above.' : 'When a control point stops an action that can go ahead with approval, you raise the exception from that action, and it appears here.'} action={filtered ? undefined : { label: 'Try the sample documents', onClick: () => navigateTo('/engine/sample-docs') }} />
      ) : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Exceptions">
          <table className="grid">
            <thead><tr><th>Exception</th><th>Control</th><th>For</th><th className="num">Value at risk</th><th>Status</th><th>Raised by</th><th className="num">Age (days)</th></tr></thead>
            <tbody>{data.rows.map((r) => (
              <tr key={r.id} data-testid={`ex-row-${r.id}`}>
                <th scope="row" data-label="Exception"><Link to={`/controls/exceptions?open=${r.id}`}>{r.no}</Link>{r.emergency && <><br /><span className="small">Emergency{r.overdue ? ', overdue' : ''}</span></>}</th>
                <td data-label="Control"><code>{r.control}</code></td><td data-label="For">{r.entityRef ?? `${r.entity} ${r.entityId}`}</td><td className="num" data-label="Value at risk">{r.valueText}</td>
                <td data-label="Status"><StatusBadge status={STATUS[r.status][0]} label={STATUS[r.status][1]} /></td><td data-label="Raised by">{r.raisedBy}</td><td className="num" data-label="Age (days)">{r.ageDays}</td>
              </tr>))}</tbody>
          </table>
        </div>
      ))}
      <div className="pager"><span>{data?.total ?? 0} exception(s), page {page} of {pages}</span>
        <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
    </section>
  );
}
