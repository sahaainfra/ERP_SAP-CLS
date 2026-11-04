import { useEffect, useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { formatDateTime } from '../../platform/format.js';
import { verifyCode, verifyFile } from '../../platform/signatures/api.js';

// The public verification page (part 04.12, section 7.1): outside the application shell and before anybody is signed in. The QR code of a document leads here (/verify/<code>). It shows only what the company
// chose to make public; the person can also drop the file they hold to see whether it is exactly what was issued.
const TONE = { VALID: ['approved', 'Genuine and current'], SUPERSEDED: ['returned', 'Superseded'], CANCELLED: ['rejected', 'Cancelled'], INVALID: ['rejected', 'Do not rely on this'], UNKNOWN: ['rejected', 'Not found'] };
const codeFromPath = () => decodeURIComponent((window.location.pathname.split('/')[2] ?? '').trim());

export default function VerifyPage() {
  const [code, setCode] = useState(codeFromPath());
  const [state, setState] = useState({ busy: false, result: null, error: null });
  const [fileState, setFileState] = useState({ busy: false, result: null, error: null });
  useEffect(() => { document.title = 'Verify a document - ERP'; }, []);
  const run = async (c) => {
    const value = c.trim().toUpperCase();
    setFileState({ busy: false, result: null, error: null });
    if (!/^[A-Z0-9]{8,24}$/.test(value)) { setState({ busy: false, result: null, error: { message: 'A code is 8 to 24 letters and digits, printed under the QR code.' } }); return; }
    setState({ busy: true, result: null, error: null });
    try { setState({ busy: false, result: await verifyCode(value), error: null }); } catch (e) { setState({ busy: false, result: null, error: e }); }
  };
  useEffect(() => { if (codeFromPath()) run(codeFromPath()); }, []);
  const compare = async (file) => {
    if (!file) return;
    setFileState({ busy: true, result: null, error: null });
    try { setFileState({ busy: false, result: (await verifyFile(code.trim().toUpperCase(), file)).file, error: null }); } catch (e) { setFileState({ busy: false, result: null, error: e }); }
  };
  const r = state.result;
  const tone = r ? TONE[r.status] ?? TONE.UNKNOWN : null;
  return (
    <main id="main" className="verify-page" data-testid="verify-page">
      <h1>Verify a document</h1>
      <p lang="hi" className="muted">दस्तावेज़ की जाँच करें</p>
      <p className="muted">Scan the QR code on the document, or type the code printed under it. Nothing here needs a sign-in.</p>
      <form className="srch-form" onSubmit={(e) => { e.preventDefault(); run(code); }} aria-label="Check a code">
        <label className="field"><span>Code on the document</span><input value={code} maxLength={24} autoComplete="off" spellCheck="false" onChange={(e) => setCode(e.target.value.toUpperCase())} data-testid="verify-code" /></label>
        <button type="submit" className="btn btn-primary" disabled={state.busy || !code.trim()} data-testid="verify-go">Check</button>
      </form>
      {state.busy && <p role="status" aria-busy="true">Checking…</p>}
      {state.error && <p role="alert" className="error" data-testid="verify-error">{state.error.message}{state.error.correlationId ? ` (reference ${state.error.correlationId})` : ''}</p>}
      {r && (
        <section className="card" aria-labelledby="vr-title" data-testid="verify-result" data-status={r.status}>
          <h2 id="vr-title"><StatusBadge status={tone[0]} label={tone[1]} /></h2>
          <p data-testid="verify-message">{r.message}</p>
          {r.found && (
            <dl className="verify-facts">
              {r.type !== undefined && <><dt>Document</dt><dd>{r.type}</dd></>}
              {r.docNo !== undefined && <><dt>Number</dt><dd data-testid="verify-docno">{r.docNo}</dd></>}
              {r.version !== undefined && <><dt>Version</dt><dd>{r.version}</dd></>}
              {r.issuer !== undefined && <><dt>Issued by</dt><dd>{r.issuer}</dd></>}
              {r.issuedAt !== undefined && <><dt>Issued on</dt><dd>{formatDateTime(r.issuedAt)}</dd></>}
              {r.project !== undefined && <><dt>Project</dt><dd>{r.project}</dd></>}
              {r.amount !== undefined && <><dt>Amount</dt><dd>{r.amount}</dd></>}
            </dl>)}
          {r.signers && (r.signers.length === 0 ? <p className="muted">Nobody has signed this document yet.</p> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Signatures"><table className="grid" data-testid="verify-signers"><thead><tr><th>Signed by</th><th>How</th><th>When</th><th>Status</th></tr></thead>
              <tbody>{r.signers.map((s, i) => <tr key={i}><th scope="row" data-label="Signed by">{s.name}</th><td data-label="How">{s.method}</td><td data-label="When">{formatDateTime(s.at)}</td><td data-label="Status">{s.status}</td></tr>)}</tbody></table></div>))}
          {r.found && (
            <div className="verify-file">
              <h3>Compare the file you hold</h3>
              <p className="muted small">Choose the PDF you received. It is compared with the fingerprint of the document that was issued; it is not stored.</p>
              <label className="field"><span>Your file (PDF)</span><input type="file" accept="application/pdf,.pdf" onChange={(e) => compare(e.target.files?.[0])} data-testid="verify-file" /></label>
              {fileState.busy && <p role="status" aria-busy="true">Comparing…</p>}
              {fileState.error && <p role="alert" className="error">{fileState.error.message}</p>}
              {fileState.result && <p role="status" className={fileState.result.match ? 'notice' : 'error'} data-testid="verify-file-result" data-match={String(fileState.result.match)}>{fileState.result.message} <span className="muted small">Fingerprint {fileState.result.fingerprint}.</span></p>}
            </div>)}
        </section>)}
    </main>
  );
}
