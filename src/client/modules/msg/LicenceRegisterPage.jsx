import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate } from '../../platform/format.js';
import { authHeaders } from '../../platform/api/index.js';
import { secApi } from '../../platform/secure/engine.js';
import { Field, errorInfo, usePageTitle } from '../core/pages/ui.jsx';

// Open-Source Licence Register (Administration, part 05.03, FR-01): every component, its licence and its obligations, the decisions of the licence review, and the gate: secure messaging stays off until the review of the
// end-to-end library is approved by the IT administrator and then the director.
const STATUS = { TO_REVIEW: ['DRAFT', 'To review'], IN_REVIEW: ['IN_REVIEW', 'In review'], APPROVED: ['COMPLETED', 'Approved'], REJECTED: ['REJECTED', 'Not allowed'], NOT_USED: ['DRAFT', 'Not used'] };
const RV = { PENDING: ['IN_REVIEW', 'Waiting for approval'], APPROVED: ['COMPLETED', 'Approved'], REJECTED: ['REJECTED', 'Rejected'] };

export default function LicenceRegisterPage() {
  usePageTitle('Open-Source Licence Register');
  const qc = useQueryClient();
  const [f, setF] = useState({ q: '', status: '', licence: '' });
  const q = useQuery({ queryKey: ['sec', 'licences', f], queryFn: () => secApi.licences(f), retry: false, placeholderData: (p) => p });
  const [form, setForm] = useState(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  if (q.error?.status === 403) return <NoPermission what="the licence register" permission="sec.licence.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the register" rows={4} />;
  const d = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['sec', 'licences'] });
  const run = async (fn, ok) => { setError(null); setNotice(''); try { const r = await fn(); setNotice(ok(r)); refresh(); } catch (e) { setError(errorInfo(e)); } };
  const exportCsv = async () => { const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString(); const res = await fetch(`/api/v1/sec/licences/export?${qs}`, { headers: authHeaders() }); const url = URL.createObjectURL(await res.blob()); Object.assign(document.createElement('a'), { href: url, download: 'open-source-licence-register.csv' }).click(); URL.revokeObjectURL(url); };
  const save = (e) => { e.preventDefault(); run(() => secApi.saveLicence(form), () => { setForm(null); return 'The component was saved. Its status changes only through an approved review.'; }); };
  const counts = d.counts;
  return (
    <section aria-labelledby="lr-title" data-testid="licence-register">
      <h1 id="lr-title">Open-Source Licence Register</h1>
      <p className={d.approved ? 'notice' : 'notice is-warning'} role="status" data-testid="licence-gate">{d.approved ? 'The licence review is approved: the end-to-end library may be used.' : 'The licence review is not approved yet. Secure messaging cannot be switched on until the IT administrator and then the director approve it.'}</p>
      <p className="muted small">libsignal and the Signal server are AGPL-3.0 and are not used; the secure conversations use the platform's audited WebCrypto API (see <code>docs/erp/LICENCE_REVIEW_05.03.md</code>).</p>
      {notice && <p role="status" className="notice" data-testid="lr-notice">{notice}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="lr-error">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}</p>}
      <form className="srch-form" role="search" aria-label="Filter the register" onSubmit={(e) => e.preventDefault()}>
        <Field label="Search" name="q" error={null}><input type="search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} data-testid="lr-q" /></Field>
        <Field label="Status" name="status" error={null}><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} data-testid="lr-status"><option value="">All ({Object.values(counts).reduce((a, b) => a + b, 0)})</option>{Object.entries(STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l} ({counts[k] ?? 0})</option>)}</select></Field>
        <Field label="Licence kind" name="licence" error={null}><select value={f.licence} onChange={(e) => setF({ ...f, licence: e.target.value })}><option value="">All</option><option value="copyleft">Copyleft</option><option value="permissive">Permissive</option></select></Field>
        <button type="button" className="btn" onClick={exportCsv} data-testid="lr-export">Export CSV</button>
      </form>
      {d.rows.length === 0 ? <EmptyState compact title="Nothing matches" message="Change the filters, or refresh the register from the project." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Components"><table className="grid"><thead><tr><th>Component</th><th>Version</th><th>Licence</th><th>Usage</th><th>Obligations</th><th>Status</th><th>Reviewed</th>{d.canEdit && <th><span className="sr-only">Actions</span></th>}</tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.id} data-testid="lr-row"><th scope="row" data-label="Component">{r.component}</th><td data-label="Version">{r.version || '—'}</td><td data-label="Licence">{r.licence}{r.copyleft && <span className="muted small"> · copyleft</span>}</td><td data-label="Usage">{r.usage}</td><td data-label="Obligations">{r.obligations}</td><td data-label="Status"><StatusBadge status={STATUS[r.status][0]} label={STATUS[r.status][1]} /></td><td data-label="Reviewed">{r.reviewedBy ? `${r.reviewedBy}, ${formatDate(r.reviewedAt)}` : '—'}</td>{d.canEdit && <td><button type="button" className="btn btn-small" onClick={() => setForm({ component: r.component, version: r.version, licence: r.licence, usage: r.usage, obligations: r.obligations, reason: '' })}>Edit</button></td>}</tr>)}</tbody></table></div>
      )}
      {d.canEdit && (
        <div className="actions">
          <button type="button" className="btn" onClick={() => setForm({ component: '', version: '', licence: '', usage: '', obligations: '', reason: '' })} data-testid="lr-add">Add a component</button>
          <button type="button" className="btn" onClick={() => run(secApi.scan, (r) => `Read the project: ${r.added} new component(s), ${r.updated} updated, ${r.total} in the register.`)} data-testid="lr-scan">Refresh from the project</button>
        </div>
      )}
      {form && (
        <form className="card form-grid" onSubmit={save} noValidate aria-label="Component" data-testid="lr-form">
          <Field label="Component *" name="component" error={error}><input value={form.component} onChange={(e) => setForm({ ...form, component: e.target.value })} data-testid="lr-component" /></Field>
          <Field label="Version" name="version" error={error}><input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} /></Field>
          <Field label="Licence (for example MIT, Apache-2.0) *" name="licence" error={error}><input value={form.licence} onChange={(e) => setForm({ ...form, licence: e.target.value })} data-testid="lr-licence" /></Field>
          <Field label="How it is used" name="usage" error={error}><input value={form.usage} onChange={(e) => setForm({ ...form, usage: e.target.value })} /></Field>
          <Field label="Obligations" name="obligations" error={error}><textarea rows="2" value={form.obligations} onChange={(e) => setForm({ ...form, obligations: e.target.value })} /></Field>
          <Field label="Reason for this change *" name="reason" error={error}><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} data-testid="lr-reason" /></Field>
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={!form.component || !form.licence || form.reason.trim().length < 5} data-testid="lr-save">Save</button><button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button></div>
        </form>
      )}
      <h2>Licence review</h2>
      {d.pendingReview && <p role="status" className="notice" data-testid="lr-pending">Review {d.pendingReview.version} waits for approval (sent by {d.pendingReview.by}): the IT administrator, then the director.</p>}
      {d.canEdit && !d.pendingReview && !d.approved && (
        <form className="card form-grid" onSubmit={(e) => { e.preventDefault(); run(() => secApi.review(comment), () => { setComment(''); return 'The review was sent for approval to the IT administrator and then the director.'; }); }} noValidate aria-label="Send the licence review" data-testid="lr-review-form">
          <Field label="What the approvers should know *" name="comment" error={error}><textarea rows="2" value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} data-testid="lr-comment" /></Field>
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={comment.trim().length < 5} data-testid="lr-review-send">Send the review for approval</button></div>
        </form>
      )}
      {d.reviews.length === 0 ? <p className="muted">No review has been sent yet.</p> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Reviews"><table className="grid"><thead><tr><th>Review</th><th>Subject</th><th>Status</th><th>Sent by</th><th>Decided</th></tr></thead>
          <tbody>{d.reviews.map((r) => <tr key={r.id} data-testid="lr-review-row"><th scope="row" data-label="Review">{r.version}</th><td data-label="Subject">{r.subject}</td><td data-label="Status"><StatusBadge status={RV[r.status][0]} label={RV[r.status][1]} /></td><td data-label="Sent by">{r.by}</td><td data-label="Decided">{r.decidedAt ? formatDate(r.decidedAt) : '—'}</td></tr>)}</tbody></table></div>
      )}
    </section>
  );
}
