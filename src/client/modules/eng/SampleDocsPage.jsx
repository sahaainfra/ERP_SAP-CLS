import { useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { useAmendSampleDoc, useCreateSampleDoc, useSampleDoc, useSampleDocs, useSubmitSampleDoc, useUpdateSampleDoc } from '../../platform/workflow/api.js';
import ControlCycle from '../../platform/protocol/ControlCycle.jsx';
import RaiseExceptionDialog from '../../platform/protocol/RaiseExceptionDialog.jsx';
import { exceptionFromError } from '../../platform/protocol/api.js';
import { Field, Link, can, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { INST_STATUS, useSearch } from './common.js';

// Sample Documents (part 04.01): the reference document type of the workflow engine. A small request for money: drafted, submitted into approval, locked when
// approved, amended by a linked new document. It shows how a module uses the engine; its status is set only by the engine's callbacks.
const STATUS = { DRAFT: ['draft', 'Draft'], IN_APPROVAL: ['submitted', 'In approval'], APPROVED: ['approved', 'Approved'], REJECTED: ['rejected', 'Rejected'], RETURNED: ['returned', 'Returned'], CANCELLED: ['cancelled', 'Cancelled'] };
const PAGE = 25;

function DocForm({ doc, onSaved, onCancel }) {
  const create = useCreateSampleDoc();
  const update = useUpdateSampleDoc();
  const [error, setError] = useState(null);
  const submit = (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { title: String(f.get('title')), amount: String(f.get('amount')) };
    const m = doc ? update : create;
    m.mutate(doc ? { id: doc.id, ...body, version: doc.version } : body, { onSuccess: (d) => onSaved(d), onError: (er) => setError(errorInfo(er)) });
  };
  return (
    <form className="form-grid" onSubmit={submit} aria-label={doc ? 'Change the sample document' : 'New sample document'}>
      <Field label="Title" name="title" error={error}><input name="title" required minLength={3} maxLength={120} defaultValue={doc?.title ?? ''} /></Field>
      <Field label="Amount (₹)" name="amount" error={error} hint="For example 250000.00. From ₹10,00,000 the chief financial officer also approves."><input name="amount" required inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" defaultValue={doc?.amount ?? ''} /></Field>
      {error && <p role="alert" className="error">{error.form}{error.correlationId && <> (<code>{error.correlationId}</code>)</>}</p>}
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={create.isPending || update.isPending}>{doc ? 'Save changes' : 'Save as draft'}</button><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

function Detail({ id, session, onClose, setNotice }) {
  const query = useSampleDoc(id);
  const submit = useSubmitSampleDoc();
  const amend = useAmendSampleDoc();
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState('');
  const [error, setError] = useState(null);
  const [blocked, setBlocked] = useState(null);
  const [dialog, setDialog] = useState(false);
  const d = query.data;
  if (query.isPending) return <Skeleton label="Loading the document" rows={3} />;
  if (query.isError) return <ErrorState title="The document could not be loaded" error={query.error} onRetry={() => query.refetch()} />;
  const mine = d.requestedBy === session?.user;
  const w = d.workflow;
  return (
    <article className="card" aria-label={`Sample document ${d.docNo}`} data-testid="sd-detail">
      <h2>{d.docNo}: {d.title}</h2>
      <p><StatusBadge status={STATUS[d.status][0]} label={STATUS[d.status][1]} />{d.locked && <> · locked</>}</p>
      <ul className="srch-meta"><li>Amount <strong data-testid="sd-amount">{d.amountText}</strong></li><li>Raised by <strong>{d.requestedBy}</strong></li>{d.amendsId && <li>Amends document {d.amendsId}</li>}</ul>
      {editing ? <DocForm doc={d} onSaved={() => { setEditing(false); setNotice('Saved.'); }} onCancel={() => setEditing(false)} /> : (
        <div className="actions">
          {mine && ['DRAFT', 'RETURNED'].includes(d.status) && <button type="button" className="btn" onClick={() => setEditing(true)}>Edit</button>}
          {mine && ['DRAFT', 'RETURNED', 'REJECTED', 'CANCELLED'].includes(d.status) && (
            <>
              <label className="field"><span>Comment for the approvers (optional)</span><input value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} /></label>
              <button type="button" className="btn btn-primary" disabled={submit.isPending} onClick={() => submit.mutate({ id: d.id, comment: comment || undefined }, { onSuccess: (r) => { setNotice(r.controlWarnings?.length ? `Submitted into approval. Warning: ${r.controlWarnings.map((w) => w.message).join('; ')}.` : `Submitted into approval.`); setError(null); setComment(''); if (r.workflow) navigateTo(`/workflow/instance?id=${r.workflow.id}`, { force: true }); }, onError: (e) => { const x = exceptionFromError(e); if (x) { setBlocked(x); setDialog(true); } setError(errorInfo(e)); } })}>{d.status === 'RETURNED' ? 'Resubmit for approval' : 'Submit for approval'}</button>
            </>
          )}
          {mine && d.status === 'APPROVED' && <button type="button" className="btn" disabled={amend.isPending} onClick={() => amend.mutate(d.id, { onSuccess: (n) => { setNotice(`Amendment ${n.docNo} made. Change it and submit it for approval.`); navigateTo(`/engine/sample-docs?open=${n.id}`, { force: true }); }, onError: (e) => setError(errorInfo(e)) })}>Amend (make a linked new document)</button>}
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      )}
      {error && <p role="alert" className="error">{error.form}{error.correlationId && <> (<code>{error.correlationId}</code>)</>}</p>}
      {blocked && <p role="alert" className="notice" data-testid="sd-blocked">A control stopped this. <button type="button" className="btn btn-small" onClick={() => setDialog(true)} data-testid="sd-raise">Raise an exception</button></p>}
      <ControlCycle entity="sample_doc" id={d.id} />
      <RaiseExceptionDialog blocked={dialog ? blocked : null} entityRef={d.docNo} canEmergency={can(session, 'eng.pcs.emergency')} onClose={() => setDialog(false)}
        onDone={(x) => { setBlocked(null); setDialog(false); setNotice(`${x.no} sent for approval. Submit the document again once it is approved.`); }} />
      <h3>Approvals</h3>
      {w ? (
        <p data-testid="sd-approval">The approval is <strong>{INST_STATUS[w.status][1].toLowerCase()}</strong>{w.status === 'RUNNING' ? `, at step ${w.steps.find((s) => s.code === w.currentStep)?.name ?? w.currentStep}` : w.completedAt ? ` (${formatDateTime(w.completedAt)})` : ''}. <Link to={`/workflow/instance?id=${w.id}`}>Open the approval</Link></p>
      ) : <p className="muted">This document has not been submitted into approval.</p>}
    </article>
  );
}

export default function SampleDocsPage({ session }) {
  usePageTitle('Sample Documents');
  const open = Number(useSearch().get('open')) || null;
  const [filters, setFilters] = useState({ status: '', q: '' });
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const list = useSampleDocs({ ...filters, limit: PAGE, offset: (page - 1) * PAGE });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  if (list.error?.status === 403) return <NoPermission what="the sample documents" permission="eng.sample.use" />;
  return (
    <section aria-labelledby="sd-title" data-testid="sample-docs">
      <h1 id="sd-title">Sample Documents</h1>
      <p className="muted">The reference document type of the workflow engine: a request for money that goes through approval, is locked when approved and is amended by a linked new document.</p>
      {notice && <p role="status" className="notice" data-testid="sd-notice">{notice}</p>}
      {open && <Detail key={open} id={open} session={session} setNotice={setNotice} onClose={() => navigateTo('/engine/sample-docs', { force: true })} />}
      <div className="srch-tools">{!creating && <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>New sample document</button>}</div>
      {creating && <DocForm onCancel={() => setCreating(false)} onSaved={(d) => { setCreating(false); setNotice(`${d.docNo} saved as a draft.`); navigateTo(`/engine/sample-docs?open=${d.id}`, { force: true }); }} />}
      <form className="srch-form" role="search" aria-label="Filter the documents" onSubmit={(e) => e.preventDefault()}>
        <label className="field"><span>Status</span><select value={filters.status} onChange={(e) => { setFilters({ ...filters, status: e.target.value }); setPage(1); }}><option value="">Any status</option>{Object.entries(STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Number or title</span><input type="search" value={filters.q} onChange={(e) => { setFilters({ ...filters, q: e.target.value }); setPage(1); }} /></label>
      </form>
      {list.isPending && <Skeleton label="Loading the documents" rows={3} />}
      {list.isError && list.error?.status !== 403 && <ErrorState title="The documents could not be loaded" error={list.error} onRetry={() => list.refetch()} />}
      {data && (data.rows.length === 0 ? <EmptyState title="No sample document" message="Make one, submit it, and follow it through its approval." action={{ label: 'New sample document', onClick: () => setCreating(true) }} /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Sample documents">
          <table className="grid">
            <thead><tr><th>Number</th><th>Title</th><th className="num">Amount (₹)</th><th>Status</th><th>Raised by</th></tr></thead>
            <tbody>{data.rows.map((r) => (
              <tr key={r.id} data-testid={`sd-row-${r.id}`}>
                <th scope="row" data-label="Number"><Link to={`/engine/sample-docs?open=${r.id}`}>{r.docNo}</Link></th><td data-label="Title">{r.title}</td><td className="num" data-label="Amount (₹)">{r.amountText}</td>
                <td data-label="Status"><StatusBadge status={STATUS[r.status][0]} label={STATUS[r.status][1]} /></td><td data-label="Raised by">{r.requestedBy}</td>
              </tr>))}</tbody>
          </table>
        </div>
      ))}
      <div className="pager"><span>{data?.total ?? 0} document(s), page {page} of {pages}</span>
        <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
    </section>
  );
}
