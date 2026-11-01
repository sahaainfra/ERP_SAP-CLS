import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/index.js';

// Dialogs (part 03.04, FR-07, BR-02): the confirmation dialog, with a reason code and words where the action needs them, and the progress
// dialog for work that takes a while. Both are native <dialog> elements (focus is held inside, Escape closes, the page behind is inert).

/** The reason codes the server holds for an action ('cancel', 'reject', 'return'), as a picker with a text box for the explanation. */
export function ReasonCodePicker({ forAction, code, text, onCode, onText, error, textLabel = 'Explain in a few words' }) {
  const id = useId();
  const codes = useQuery({ queryKey: ['ui', 'reason-codes', forAction], queryFn: async () => (await api.get(`/ui/reason-codes?for=${forAction}`)).data, staleTime: 10 * 60_000, retry: false });
  const chosen = (codes.data ?? []).find((c) => c.code === code);
  return (
    <div className="fb-reason" data-testid="reason-picker">
      <label className="field" htmlFor={`${id}-code`}><span>Reason</span>
        <select id={`${id}-code`} value={code} onChange={(e) => onCode(e.target.value)} aria-invalid={error?.fields?.reasonCode ? true : undefined} disabled={codes.isPending}>
          <option value="">{codes.isPending ? 'Loading...' : 'Choose a reason...'}</option>
          {(codes.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
        </select>
        {error?.fields?.reasonCode && <span className="field-error">{error.fields.reasonCode}</span>}
      </label>
      {codes.isError && <p className="field-error" role="alert">The reasons could not be loaded: {codes.error.message}</p>}
      <label className="field" htmlFor={`${id}-text`}><span>{textLabel}{chosen?.needsText ? ' (required)' : ''}</span>
        <textarea id={`${id}-text`} rows="3" value={text} maxLength={500} onChange={(e) => onText(e.target.value)} aria-invalid={error?.fields?.reason || error?.fields?.comment ? true : undefined} />
        {(error?.fields?.reason || error?.fields?.comment) && <span className="field-error">{error.fields.reason ?? error.fields.comment}</span>}
      </label>
    </div>
  );
}

/**
 * ConfirmDialog: asks before an action that cannot be undone. `reasonFor` ('cancel' | 'reject' | 'return') adds the reason-code picker and
 * makes code and words required; `commentOptional` adds an optional comment. onConfirm({ reasonCode, reason }) returns a promise; a failure is
 * shown inside the dialog with its correlation ID and the dialog stays open.
 */
export function ConfirmDialog({ open, title, text, confirmLabel = 'Confirm', danger = false, reasonFor = null, commentOptional = false, onConfirm, onCancel }) {
  const ref = useRef(null);
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { setCode(''); setReason(''); setError(null); setBusy(false); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open]);
  const submit = async (e) => {
    e.preventDefault();
    const fields = {};
    if (reasonFor && !code) fields.reasonCode = 'Choose a reason.';
    if (reasonFor && reason.trim().length < 5) fields.reason = 'Explain in at least 5 characters.';
    if (Object.keys(fields).length) { setError({ fields, form: 'Please correct the fields below.' }); return; }
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ reasonCode: code || undefined, reason: reason.trim() || undefined });
    } catch (err) {
      const fields2 = {};
      for (const d of err.details ?? []) if (d.field) fields2[d.field === 'comment' ? 'reason' : d.field] = d.message;
      setError({ fields: fields2, form: err.status === 409 ? `${err.message} Close this and reload the record.` : err.message, correlationId: err.correlationId });
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onClose={() => open && onCancel()} onCancel={(e) => { e.preventDefault(); onCancel(); }} data-testid="confirm-dialog">
      <form onSubmit={submit} noValidate>
        <h2 id={titleId}>{title}</h2>
        {text && <p>{text}</p>}
        {reasonFor && <ReasonCodePicker forAction={reasonFor} code={code} text={reason} onCode={setCode} onText={setReason} error={error} />}
        {!reasonFor && commentOptional && (
          <label className="field"><span>Comment (optional)</span><textarea rows="2" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        )}
        {error?.form && <p className="field-error" role="alert" data-testid="confirm-error">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Keep as it is</button>
          <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy}>{busy ? 'Working...' : confirmLabel}</button>
        </div>
      </form>
    </dialog>
  );
}

/** A progress dialog for work that takes a while: a bar (a value from 0 to 1, or none while the length is unknown) and what is happening. */
export function ProgressDialog({ open, title, message, value = null, onCancel = null }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const pct = value === null ? null : Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onCancel?.(); }} data-testid="progress-dialog">
      <h2 id={titleId}>{title}</h2>
      <p aria-live="polite">{message}</p>
      <div className="fb-progress" role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-busy={pct === null}>
        <div className={`fb-progress-bar${pct === null ? ' is-indeterminate' : ''}`} style={pct === null ? undefined : { width: `${pct}%` }} />
      </div>
      {pct !== null && <p className="muted small">{pct}%</p>}
      {onCancel && <div className="actions"><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>}
    </dialog>
  );
}
