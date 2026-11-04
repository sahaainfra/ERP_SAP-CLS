import { useMemo, useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate, formatDateTime } from '../../platform/format.js';
import { authHeaders, generatedUrl, openGenerated, useBulkJob, useDeliver, useGenerate, useGenerateBulk, useGenerated, useGeneratedDoc, useTplRecords } from '../../platform/templates/api.js';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import SignaturePanel from './SignaturePanel.jsx';
import { CHANNEL, DELIVERY_STATUS, PURPOSE, generatedLink, showBlob } from './templates-common.js';

// Generated Documents Log (part 04.11, section 7.3): every official document made from approved data, with its version, its verification code, who made it and where it was sent. A filter panel, the count by
// document type, the table (drill down to the document, its earlier versions and its deliveries), generating a document or many as a background job, delivery, and the export of what is listed.
const EMPTY = { docType: '', purpose: '', current: '', from: '', to: '', q: '', sort: 'newest' };
const PAGES = [25, 50, 100];
const params = () => new URLSearchParams(globalThis.location?.search ?? '');

function Detail({ id, onClose }) {
  const q = useGeneratedDoc(id);
  const deliver = useDeliver();
  const generate = useGenerate();
  const [form, setForm] = useState({ channel: 'EMAIL', recipients: '', message: '' });
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  if (q.isPending) return <Skeleton label="Loading the document" rows={3} />;
  if (q.isError) return <ErrorState title="The document could not be loaded" error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const open = async (download) => { setError(null); try { const out = await openGenerated(d.id, download); showBlob(out.blob, out.name, download); q.refetch(); } catch (e) { setError({ form: e.message }); } };
  const send = (e) => {
    e.preventDefault(); setError(null); setNotice('');
    deliver.mutate({ id: d.id, channel: form.channel, recipients: form.recipients.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean), message: form.message || undefined }, { onSuccess: (r) => { setNotice(`${r.deliveries.length} delivery(ies) recorded.`); setForm({ ...form, recipients: '', message: '' }); }, onError: (er) => setError(errorInfo(er)) });
  };
  const again = () => { setError(null); generate.mutate({ docType: d.docType, entityId: d.entityId, reason, purpose: d.purpose === 'ARCHIVAL' ? 'ARCHIVAL' : undefined }, { onSuccess: (r) => { setReason(''); navigateTo(generatedLink(r.id)); }, onError: (er) => setError(errorInfo(er)) }); };
  return (
    <section className="card" aria-labelledby="gd-title" data-testid="generated-detail">
      <div className="wf-inline"><h2 id="gd-title">{d.docNo} <span className="muted">version {d.version}</span></h2><button type="button" className="btn btn-small" onClick={onClose}>Close</button></div>
      <p>{d.typeLabel}. {d.current ? <StatusBadge status="approved" label="Current" /> : <StatusBadge status="cancelled" label="Replaced by a newer version" />} Generated {formatDateTime(d.generatedAt)} by {d.generatedBy} from {d.templateCode} version {d.templateVersion}. {d.pages} page(s). Purpose: {PURPOSE[d.purpose]}.</p>
      <p className="small">Verification code <strong data-testid="verify-code">{d.verifyCode}</strong>. Fingerprint <code>{d.hash.slice(0, 16)}</code>.{d.reason ? ` Reason: ${d.reason}` : ''}</p>
      {notice && <p role="status" className="notice" data-testid="gd-notice">{notice}</p>}
      {error?.form && <p role="alert" className="error" data-testid="gd-error">{error.form}{error.correlationId ? ` (reference ${error.correlationId})` : ''}</p>}
      <div className="actions"><button type="button" className="btn btn-primary" onClick={() => open(false)} data-testid="open-pdf">Open the PDF</button><button type="button" className="btn" onClick={() => open(true)}>Download</button></div>
      <SignaturePanel docId={d.id} />
      <h3>Versions</h3>
      <ul>{d.versions.map((v) => <li key={v.id}>{v.id === d.id ? <strong>Version {v.version}</strong> : <Link to={generatedLink(v.id)}>Version {v.version}</Link>} {v.current ? '(current) ' : ''}{formatDateTime(v.generatedAt)} by {v.generatedBy}{v.reason ? `: ${v.reason}` : ''}</li>)}</ul>
      {d.canDeliver && d.current && (
        <form className="form-grid" onSubmit={send} aria-label="Send the document">
          <h3>Send it</h3>
          <Field label="How" name="channel" error={error}><select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>{['EMAIL', 'WHATSAPP', 'MESSAGE', 'PORTAL'].map((c) => <option key={c} value={c}>{CHANNEL[c]}</option>)}</select></Field>
          <Field label={form.channel === 'EMAIL' ? 'To (e-mail addresses, one on each line)' : form.channel === 'WHATSAPP' ? 'To (mobile numbers with country code)' : 'To (a conversation or a portal account)'} name="recipients" error={error}><textarea rows="2" required value={form.recipients} onChange={(e) => setForm({ ...form, recipients: e.target.value })} data-testid="deliver-to" /></Field>
          <Field label="Message" name="message" error={error}><input value={form.message} maxLength={1000} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
          <div className="actions"><button type="submit" className="btn" disabled={deliver.isPending || !form.recipients.trim()} data-testid="deliver-send">Send</button></div>
        </form>)}
      {d.canDeliver && d.current && (
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); again(); }} aria-label="Generate a new version">
          <h3>Generate a new version</h3>
          <p className="muted small">The earlier version is kept. A reason is needed.</p>
          <Field label="Reason (at least 5 characters)" name="reason" error={error}><input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="regen-reason" /></Field>
          <div className="actions"><button type="submit" className="btn" disabled={generate.isPending || reason.trim().length < 5}>Generate a new version</button></div>
        </form>)}
      <h3>Where it was sent</h3>
      {d.deliveries.length === 0 ? <p className="muted">Nothing yet.</p> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Deliveries"><table className="grid" data-testid="delivery-table"><thead><tr><th>When</th><th>How</th><th>To</th><th>Status</th></tr></thead>
          <tbody>{d.deliveries.map((x) => <tr key={x.id}><td data-label="When">{formatDateTime(x.createdAt)}</td><td data-label="How">{CHANNEL[x.channel]}</td><td data-label="To">{x.recipient}</td><td data-label="Status"><StatusBadge status={DELIVERY_STATUS[x.status][0]} label={DELIVERY_STATUS[x.status][1]} />{x.error ? <span className="muted small"> {x.error}</span> : ''}</td></tr>)}</tbody></table></div>)}
    </section>
  );
}

function GeneratePanel({ docTypes }) {
  const [docType, setDocType] = useState('');
  const [picked, setPicked] = useState([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [bulkId, setBulkId] = useState(null);
  const recs = useTplRecords({ docType, approved: '1', limit: 100 });
  const gen = useGenerate();
  const bulk = useGenerateBulk();
  const job = useBulkJob(bulkId);
  const rows = (recs.data?.rows ?? []).filter((r) => !r.sample);
  const one = () => { setError(null); gen.mutate({ docType, entityId: rows.find((r) => r.id === picked[0]).entityId, reason: reason || undefined }, { onSuccess: (r) => navigateTo(generatedLink(r.id)), onError: (er) => setError(errorInfo(er)) }); };
  const many = () => { setError(null); bulk.mutate({ docType, entityIds: picked.map((id) => rows.find((r) => r.id === id).entityId), reason: reason || undefined }, { onSuccess: (r) => setBulkId(r.id), onError: (er) => setError(errorInfo(er)) }); };
  return (
    <section className="card" aria-labelledby="gen-title" data-testid="generate-panel">
      <h2 id="gen-title">Generate documents</h2>
      <p className="muted">An official document is made from approved data and the approved template. Choose several to make them as a background job.</p>
      <div className="srch-form">
        <label className="field"><span>Document</span><select value={docType} onChange={(e) => { setDocType(e.target.value); setPicked([]); }} data-testid="gen-type"><option value="">Choose the document</option>{docTypes.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</select></label>
        <label className="field"><span>Reason (to make a new version of one that exists)</span><input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></label>
      </div>
      {docType && recs.isPending && <Skeleton label="Loading the records" rows={2} />}
      {docType && recs.isError && <ErrorState title="The records could not be loaded" error={recs.error} onRetry={() => recs.refetch()} />}
      {docType && recs.data && (rows.length === 0 ? <EmptyState compact title="No approved record" message="A module hands its approved data to the generator; nothing is waiting for this document." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Approved records">
          <table className="grid"><thead><tr><th><span className="sr-only">Choose</span></th><th>Number</th><th>Last changed</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id}><td data-label="Choose"><input type="checkbox" aria-label={`Choose ${r.docNo}`} checked={picked.includes(r.id)} onChange={() => setPicked(picked.includes(r.id) ? picked.filter((x) => x !== r.id) : [...picked, r.id])} /></td><th scope="row" data-label="Number">{r.docNo}</th><td data-label="Last changed">{formatDate(r.updatedAt)}</td></tr>)}</tbody></table>
        </div>))}
      {error?.form && <p role="alert" className="error" data-testid="gen-error">{error.form}{error.correlationId ? ` (reference ${error.correlationId})` : ''}</p>}
      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={picked.length !== 1 || gen.isPending} onClick={one} data-testid="gen-one">Generate the chosen document</button>
        <button type="button" className="btn" disabled={picked.length < 2 || bulk.isPending} onClick={many} data-testid="gen-many">Generate {picked.length > 1 ? picked.length : 'several'} as a background job</button>
      </div>
      {bulkId && job.data && (
        <p role="status" data-testid="bulk-status">{job.data.status === 'DONE' || job.data.status === 'FAILED' ? `Finished: ${job.data.done} generated, ${job.data.failed} failed.` : `Working: ${job.data.done + job.data.failed} of ${job.data.total}.`} <Link to={`/documents/generated?bulk=${bulkId}`}>See them</Link></p>)}
    </section>
  );
}

export default function GeneratedDocumentsPage() {
  usePageTitle('Generated Documents');
  const [filters, setFilters] = useState(EMPTY);
  const [limit, setLimit] = useState(25);
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const sel = Number(params().get('id')) || null;
  const bulkJob = Number(params().get('bulk')) || '';
  const query = useMemo(() => ({ ...filters, bulkJobId: bulkJob, limit, offset: (page - 1) * limit }), [filters, bulkJob, limit, page]);
  const list = useGenerated(query);
  if (list.error?.status === 403) return <NoPermission what="the generated documents" permission="tpl.document.view" />;
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / limit)) : 1;
  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const download = async (format) => {
    const res = await fetch(generatedUrl(format, { ...filters, sort: undefined }), { headers: { ...authHeaders(), 'x-correlation-id': globalThis.crypto.randomUUID() } });
    if (!res.ok) { setNotice('The export could not be prepared.'); return; }
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `generated-documents.${format}` }).click();
    URL.revokeObjectURL(url);
  };
  const max = Math.max(1, ...(d?.summary.byType ?? []).map((x) => x.n));
  return (
    <section aria-labelledby="gl-title" data-testid="generated-log">
      <h1 id="gl-title">Generated Documents</h1>
      <p className="muted">Every official document made by the system, with its version, verification code and deliveries. You see the documents of your projects{bulkJob ? `; this list is the documents of background job ${bulkJob}` : ''}.</p>
      {notice && <p role="status" className="notice" data-testid="gl-notice">{notice}</p>}
      <div className="srch-tools">
        <button type="button" className="btn" onClick={() => download('xlsx')}>Export XLSX</button>
        <button type="button" className="btn" onClick={() => download('csv')}>Export CSV</button>
        <button type="button" className="btn" onClick={() => download('pdf')}>Export PDF</button>
        {bulkJob && <button type="button" className="btn" onClick={() => navigateTo('/documents/generated')}>Show all documents</button>}
      </div>
      <form className="srch-form" role="search" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
        <label className="field"><span>Document</span><select value={filters.docType} onChange={(e) => set({ docType: e.target.value })}><option value="">Any document</option>{(d?.docTypes ?? []).map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</select></label>
        <label className="field"><span>Purpose</span><select value={filters.purpose} onChange={(e) => set({ purpose: e.target.value })}><option value="">Any</option>{Object.entries(PURPOSE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Versions</span><select value={filters.current} onChange={(e) => set({ current: e.target.value })}><option value="">All versions</option><option value="1">Current only</option></select></label>
        <label className="field"><span>From</span><input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} /></label>
        <label className="field"><span>To</span><input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} /></label>
        <label className="field"><span>Number, code or person</span><input type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} /></label>
        <label className="field"><span>Order</span><select value={filters.sort} onChange={(e) => set({ sort: e.target.value })}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="number">Number</option><option value="type">Document</option></select></label>
        {JSON.stringify(filters) !== JSON.stringify(EMPTY) && <button type="button" className="btn" onClick={() => set(EMPTY)}>Clear filters</button>}
      </form>
      {d && d.summary.total > 0 && (
        <section className="card" aria-label="Count by document" data-testid="gl-summary">
          <p><strong>{d.summary.total}</strong> document(s), <strong>{d.summary.delivered}</strong> delivery(ies) sent.</p>
          <ul className="tpl-bars">{d.summary.byType.map((x) => <li key={x.docType}><button type="button" className="btn btn-small" onClick={() => set({ docType: x.docType })} title={`Show only ${x.label}`}>{x.label}</button><span className="tpl-bar" style={{ width: `${(x.n / max) * 100}%` }} aria-hidden="true" /> <span>{x.n}</span></li>)}</ul>
        </section>)}
      {d?.canGenerate && <GeneratePanel docTypes={d.docTypes} />}
      {sel && <Detail id={sel} onClose={() => navigateTo('/documents/generated')} />}
      {list.isPending && <Skeleton label="Loading the documents" rows={4} />}
      {list.isError && list.error?.status !== 403 && <ErrorState title="The documents could not be loaded" error={list.error} onRetry={() => list.refetch()} />}
      {d && (d.rows.length === 0 ? <EmptyState title="No generated document" message="Documents appear here when they are generated from approved data. Change the filters, or generate one." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Generated documents">
          <table className="grid" data-testid="generated-table">
            <thead><tr><th>Number</th><th>Document</th><th>Version</th><th>Purpose</th><th>Project</th><th>Generated</th><th>Sent</th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.id} data-testid={`gen-${r.id}`}>
                <th scope="row" data-label="Number"><Link to={generatedLink(r.id)}>{r.docNo}</Link></th><td data-label="Document">{r.typeLabel}</td>
                <td data-label="Version">{r.version} {r.current ? <StatusBadge status="approved" label="Current" /> : <StatusBadge status="cancelled" label="Replaced" />}</td><td data-label="Purpose">{PURPOSE[r.purpose]}</td><td data-label="Project">{r.projectName ?? ''}</td>
                <td data-label="Generated">{formatDateTime(r.generatedAt)}<br /><span className="muted small">{r.generatedBy}</span></td><td data-label="Sent">{r.deliveries}</td>
              </tr>))}</tbody>
          </table>
        </div>))}
      <div className="pager"><span>{d?.total ?? 0} document(s), page {page} of {pages}</span>
        <select aria-label="Rows on a page" value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}>{PAGES.map((n) => <option key={n} value={n}>{n} a page</option>)}</select>
        <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
    </section>
  );
}
