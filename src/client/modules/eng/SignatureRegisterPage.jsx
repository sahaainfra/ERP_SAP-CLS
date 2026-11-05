import { useMemo, useRef, useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { authHeaders, registerUrl, useProposeSigConfig, useRemoveProfile, useRevoke, useSaveProfile, useSigConfig, useSigProfile, useSigRegister } from '../../platform/signatures/api.js';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { generatedLink } from './templates-common.js';

// Signature Register (part 04.12, section 7.2): every signature with its document, signer, method, time and the number of times the document was checked; filters, count by method, drill-down to the document,
// revoking (the system administrator), export, my own signature picture, and the settings (which fields the public check shows, where the stamps go), changed by an approved change.
const EMPTY = { method: '', status: '', docType: '', signer: '', from: '', to: '', q: '', sort: 'newest' };
const PAGES = [25, 50, 100];

function Profile() {
  const q = useSigProfile();
  const save = useSaveProfile();
  const remove = useRemoveProfile();
  const [error, setError] = useState(null);
  const ref = useRef(null);
  if (q.isPending || q.isError) return null; // a person who cannot sign has no picture
  const pick = (file) => {
    if (!file) return;
    setError(null);
    if (!/^image\/(png|jpeg)$/.test(file.type) || file.size > 150_000) { setError({ form: 'The picture must be a PNG or JPEG of at most 150 KB.' }); return; }
    const r = new FileReader();
    r.onload = () => save.mutate(String(r.result), { onError: (e) => setError(errorInfo(e)) });
    r.readAsDataURL(file);
    if (ref.current) ref.current.value = '';
  };
  return (
    <section className="card" aria-labelledby="sig-profile" data-testid="sig-profile">
      <h2 id="sig-profile">My signature picture</h2>
      <p className="muted">Used when you sign a document by picture: it is drawn on the signed copy with your name and the time. Only you can change it.</p>
      {q.data.has ? <img className="sig-preview" src={q.data.image} alt="Your signature picture" data-testid="sig-image" /> : <p className="muted" data-testid="sig-none">You have not added a picture yet.</p>}
      {error?.form && <p role="alert" className="error">{error.form}</p>}
      <div className="actions">
        <label className="field"><span>PNG or JPEG, at most 150 KB</span><input ref={ref} type="file" accept="image/png,image/jpeg" onChange={(e) => pick(e.target.files?.[0])} data-testid="sig-file" /></label>
        {q.data.has && <button type="button" className="btn" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove the picture</button>}
      </div>
    </section>
  );
}

function Settings() {
  const q = useSigConfig();
  const propose = useProposeSigConfig();
  const [fields, setFields] = useState(null);
  const [auto, setAuto] = useState(true);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  if (q.isPending || q.isError) return null;
  const c = q.data;
  const cur = fields ?? c.config.publicFields;
  const send = (e) => {
    e.preventDefault(); setError(null);
    propose.mutate({ publicFields: cur, signApprovals: fields === null ? c.config.signApprovals : auto, placements: Object.fromEntries(Object.entries(c.config.placements).filter(([k]) => k !== 'DEFAULT')), reason }, { onSuccess: () => { setSent(true); setReason(''); }, onError: (er) => setError(errorInfo(er)) });
  };
  return (
    <section className="card" aria-labelledby="sig-settings" data-testid="sig-settings">
      <h2 id="sig-settings">Settings</h2>
      {c.pending && <p role="status" className="notice" data-testid="sig-pending">A change is waiting for approval (proposed by {c.pending.by}: {c.pending.reason}).{c.pending.instanceId ? <> <Link to={`/workflow/instance?id=${c.pending.instanceId}`}>Open the approval</Link></> : ''}</p>}
      {sent && <p role="status" className="notice" data-testid="sig-sent">Sent for approval. The change takes effect when it is approved.</p>}
      <form className="form-grid" onSubmit={send} aria-label="Change the signature settings">
        <fieldset disabled={!c.canEdit} className="form-section">
          <legend>What anybody who scans the QR code sees</legend>
          <p className="muted small">The result is always shown as genuine, superseded or cancelled. Choose the facts that come with it; an amount is never shown for a payslip or an offer letter.</p>
          {c.choices.map((f) => <label key={f} className="field"><span><input type="checkbox" checked={cur.includes(f)} onChange={(e) => setFields(e.target.checked ? [...cur, f] : cur.filter((x) => x !== f))} /> {f}</span></label>)}
          <label className="field"><span><input type="checkbox" checked={fields === null ? c.config.signApprovals : auto} onChange={(e) => { if (fields === null) setFields(cur); setAuto(e.target.checked); }} /> Sign a document with the approvals of its workflow</span></label>
        </fieldset>
        {c.canEdit && <>
          <Field label="Reason for the change (at least 5 characters)" name="reason" error={error}><input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="sig-reason" /></Field>
          {error?.form && <p role="alert" className="error">{error.form}</p>}
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={propose.isPending || reason.trim().length < 5 || Boolean(c.pending)}>Send for approval</button></div>
        </>}
      </form>
    </section>
  );
}

export default function SignatureRegisterPage() {
  usePageTitle('Signature Register');
  const [filters, setFilters] = useState(EMPTY);
  const [limit, setLimit] = useState(25);
  const [page, setPage] = useState(1);
  const [revoking, setRevoking] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const revoke = useRevoke();
  const query = useMemo(() => ({ ...filters, limit, offset: (page - 1) * limit }), [filters, limit, page]);
  const list = useSigRegister(query);
  if (list.error?.status === 403) return <section><h1>Signature Register</h1><NoPermission what="the signature register" permission="sig.register.view" /><Profile /></section>;
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / limit)) : 1;
  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const download = async (format) => {
    const res = await fetch(registerUrl(format, { ...filters, sort: undefined }), { headers: { ...authHeaders(), 'x-correlation-id': globalThis.crypto.randomUUID() } });
    if (!res.ok) { setNotice('The export could not be prepared.'); return; }
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `signatures.${format}` }).click();
    URL.revokeObjectURL(url);
  };
  const doRevoke = (e) => { e.preventDefault(); setError(null); revoke.mutate({ id: revoking, reason }, { onSuccess: () => { setRevoking(null); setReason(''); setNotice('The signature is revoked. The public check shows it.'); }, onError: (er) => setError(errorInfo(er)) }); };
  const max = Math.max(1, ...(d?.summary.byMethod ?? []).map((x) => x.n));
  return (
    <section aria-labelledby="sr-title" data-testid="signature-register">
      <h1 id="sr-title">Signature Register</h1>
      <p className="muted">Every signature on a generated document: who signed, how and when, and how often the document was checked by its QR code. You see the signatures of your projects.</p>
      {notice && <p role="status" className="notice" data-testid="sr-notice">{notice}</p>}
      <div className="srch-tools"><button type="button" className="btn" onClick={() => download('xlsx')}>Export XLSX</button><button type="button" className="btn" onClick={() => download('csv')}>Export CSV</button><button type="button" className="btn" onClick={() => download('pdf')}>Export PDF</button></div>
      <form className="srch-form" role="search" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
        <label className="field"><span>Method</span><select value={filters.method} onChange={(e) => set({ method: e.target.value })}><option value="">Any method</option>{(d?.methods ?? []).map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}</select></label>
        <label className="field"><span>Status</span><select value={filters.status} onChange={(e) => set({ status: e.target.value })}><option value="">Any</option><option value="SIGNED">Signed</option><option value="REVOKED">Revoked</option></select></label>
        <label className="field"><span>Signer</span><input type="search" value={filters.signer} onChange={(e) => set({ signer: e.target.value })} /></label>
        <label className="field"><span>From</span><input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} /></label>
        <label className="field"><span>To</span><input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} /></label>
        <label className="field"><span>Number or code</span><input type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} /></label>
        <label className="field"><span>Order</span><select value={filters.sort} onChange={(e) => set({ sort: e.target.value })}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="number">Document number</option><option value="signer">Signer</option></select></label>
        {JSON.stringify(filters) !== JSON.stringify(EMPTY) && <button type="button" className="btn" onClick={() => set(EMPTY)}>Clear filters</button>}
      </form>
      {d && d.summary.total > 0 && (
        <section className="card" aria-label="Count by method" data-testid="sr-summary">
          <p><strong>{d.summary.total}</strong> signature(s); the documents were checked <strong>{d.summary.checks}</strong> time(s), <strong>{d.summary.mismatches}</strong> with a file that did not match.</p>
          <ul className="tpl-bars">{d.summary.byMethod.map((x) => <li key={x.method}><button type="button" className="btn btn-small" onClick={() => set({ method: x.method })} title={`Show only ${x.label}`}>{x.label}</button><span className="tpl-bar" style={{ width: `${(x.n / max) * 100}%` }} aria-hidden="true" /> <span>{x.n}</span></li>)}</ul>
        </section>)}
      {list.isPending && <Skeleton label="Loading the signatures" rows={4} />}
      {list.isError && list.error?.status !== 403 && <ErrorState title="The signatures could not be loaded" error={list.error} onRetry={() => list.refetch()} />}
      {d && (d.rows.length === 0 ? <EmptyState title="No signature" message="Signatures appear here when documents are signed or approved. Change the filters, or open a generated document to sign it." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Signatures">
          <table className="grid" data-testid="signature-register-table">
            <thead><tr><th>Document</th><th>Signer</th><th>Method</th><th>Signed</th><th>Status</th><th>Checked</th>{d.canRevoke && <th><span className="sr-only">Action</span></th>}</tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.id} data-testid={`sig-${r.id}`}>
                <th scope="row" data-label="Document"><Link to={generatedLink(r.documentId)}>{r.docNo}</Link> <span className="muted small">version {r.version}</span><br /><span className="muted small">{r.typeLabel}{r.documentStatus === 'CANCELLED' ? ', cancelled' : r.current ? '' : ', superseded'}</span></th>
                <td data-label="Signer">{r.name}</td><td data-label="Method">{r.methodLabel}</td><td data-label="Signed">{formatDateTime(r.signedAt)}</td>
                <td data-label="Status"><StatusBadge status={r.status === 'REVOKED' ? 'rejected' : 'approved'} label={r.status === 'REVOKED' ? 'Revoked' : 'Signed'} /></td><td data-label="Checked">{r.verifications}</td>
                {d.canRevoke && <td data-label="Action">{r.status === 'SIGNED' && <button type="button" className="btn btn-small" onClick={() => { setRevoking(r.id); setError(null); }}>Revoke</button>}</td>}
              </tr>))}</tbody>
          </table>
        </div>))}
      {revoking && (
        <form className="card form-grid" onSubmit={doRevoke} aria-label="Revoke a signature" data-testid="revoke-form">
          <h2>Revoke signature {revoking}</h2>
          <Field label="Reason (at least 5 characters)" name="reason" error={error}><input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="revoke-reason" /></Field>
          {error?.form && <p role="alert" className="error">{error.form}</p>}
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={revoke.isPending || reason.trim().length < 5} data-testid="revoke-go">Revoke</button><button type="button" className="btn" onClick={() => setRevoking(null)}>Cancel</button></div>
        </form>)}
      <div className="pager"><span>{d?.total ?? 0} signature(s), page {page} of {pages}</span>
        <select aria-label="Rows on a page" value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}>{PAGES.map((n) => <option key={n} value={n}>{n} a page</option>)}</select>
        <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
      <Profile />
      <Settings />
    </section>
  );
}
