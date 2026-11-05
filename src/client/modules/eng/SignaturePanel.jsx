import { useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { formatDateTime } from '../../platform/format.js';
import { fetchSigned, useCancelDoc, useSigDoc, useSign } from '../../platform/signatures/api.js';
import { Field, Link, errorInfo } from '../core/pages/ui.jsx';
import { showBlob } from './templates-common.js';

// Signatures of one generated document (part 04.12): who signed and how, sign it, open the signed copy, cancel it, and the address of the public check. Shown on the Generated Documents page.
const DOC_TONE = { VALID: ['approved', 'Genuine and current'], SUPERSEDED: ['returned', 'Superseded'], CANCELLED: ['rejected', 'Cancelled'], INVALID: ['rejected', 'Stored file does not match'] };
export default function SignaturePanel({ docId }) {
  const q = useSigDoc(docId);
  const sign = useSign();
  const cancel = useCancelDoc();
  const [method, setMethod] = useState('APPROVAL');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  if (q.isPending || q.isError) return null; // not enabled for the company, or the person has no right to see signatures
  const d = q.data;
  const tone = DOC_TONE[d.status] ?? DOC_TONE.VALID;
  const go = () => { setError(null); setNotice(''); sign.mutate({ id: d.documentId, method }, { onSuccess: () => setNotice('Signed.'), onError: (e) => setError(errorInfo(e)) }); };
  const open = async () => { setError(null); try { const out = await fetchSigned(d.documentId); showBlob(out.blob, out.name); } catch (e) { setError({ form: e.message }); } };
  const stop = (e) => { e.preventDefault(); setError(null); cancel.mutate({ id: d.documentId, reason }, { onSuccess: () => { setReason(''); setNotice('The document is cancelled.'); }, onError: (er) => setError(errorInfo(er)) }); };
  return (
    <section aria-labelledby="sp-title" data-testid="signature-panel">
      <h3 id="sp-title">Signatures</h3>
      <p><StatusBadge status={tone[0]} label={tone[1]} /> Checked {d.verifications.count} time(s){d.verifications.mismatches ? `, ${d.verifications.mismatches} with a file that did not match` : ''}. <a href={d.verifyUrl} target="_blank" rel="noopener noreferrer">Public check</a>{!d.chainIntact && <span className="error"> The record of the signatures was changed.</span>}</p>
      {d.cancelled && <p className="error" data-testid="sp-cancelled">Cancelled by {d.cancelled.by} on {formatDateTime(d.cancelled.at)}: {d.cancelled.reason}</p>}
      {notice && <p role="status" className="notice" data-testid="sp-notice">{notice}</p>}
      {error?.form && <p role="alert" className="error" data-testid="sp-error">{error.form}{error.correlationId ? ` (reference ${error.correlationId})` : ''}</p>}
      {d.signatures.length === 0 ? <p className="muted">Nobody has signed this document yet.</p> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Signatures of the document"><table className="grid" data-testid="signature-table"><thead><tr><th>Signed by</th><th>How</th><th>When</th><th>Status</th></tr></thead>
          <tbody>{d.signatures.map((s) => <tr key={s.id}><th scope="row" data-label="Signed by">{s.name}</th><td data-label="How">{s.methodLabel}{s.label ? ` (${s.label})` : ''}</td><td data-label="When">{formatDateTime(s.signedAt)}</td><td data-label="Status">{s.status === 'REVOKED' ? `Revoked by ${s.revokedBy}: ${s.revokeReason}` : 'Signed'}</td></tr>)}</tbody></table></div>)}
      <div className="actions"><button type="button" className="btn" onClick={open} data-testid="open-signed">Open the signed copy</button><Link to="/admin/signatures">Signature register</Link></div>
      {d.canSign && (
        <form className="srch-form" aria-label="Sign this document" onSubmit={(e) => { e.preventDefault(); go(); }}>
          <label className="field"><span>Sign by</span><select value={method} onChange={(e) => setMethod(e.target.value)} data-testid="sign-method"><option value="APPROVAL">Electronic approval (my sign-in)</option><option value="IMAGE" disabled={!d.hasProfile}>My signature picture{d.hasProfile ? '' : ' (add it on the register)'}</option><option value="ESIGN" disabled={!d.providers.ESIGN}>Aadhaar eSign{d.providers.ESIGN ? '' : ' (no provider)'}</option><option value="DSC" disabled={!d.providers.DSC}>Digital signature certificate{d.providers.DSC ? '' : ' (no provider)'}</option></select></label>
          <button type="submit" className="btn btn-primary" disabled={sign.isPending} data-testid="sign-go">Sign</button>
        </form>)}
      {d.canCancel && (
        <form className="form-grid" onSubmit={stop} aria-label="Cancel the document">
          <Field label="Cancel this document: the reason (at least 5 characters)" name="reason" error={error}><input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="cancel-reason" /></Field>
          <div className="actions"><button type="submit" className="btn" disabled={cancel.isPending || reason.trim().length < 5} data-testid="cancel-go">Cancel the document</button></div>
        </form>)}
    </section>
  );
}
