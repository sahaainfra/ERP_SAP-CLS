import { useEffect, useId, useRef, useState } from 'react';
import { AttachmentList, FileUploader } from '../../modules/core/components/Attachments.jsx';
import { Field, errorInfo } from '../../modules/core/pages/ui.jsx';
import { useCreateException, useReasonCodes, useSubmitException } from './api.js';

/**
 * The dialog opened from any action a control point stopped (part 04.04, section 7.2): a reason from the list, a justification, evidence where the control asks for it,
 * and an emergency way where the control allows it. The exception is saved first (so files can be attached to it), then submitted into approval. `blocked` is what
 * exceptionFromError() returned for the failed action; `entityRef` is the number of the record for the people who read the request.
 */
export default function RaiseExceptionDialog({ blocked, entityRef, canEmergency = false, onClose, onDone }) {
  const ref = useRef(null);
  const titleId = useId();
  const reasons = useReasonCodes();
  const create = useCreateException();
  const submit = useSubmitException();
  const [exception, setException] = useState(null);
  const [error, setError] = useState(null);
  const [uploaded, setUploaded] = useState(0);
  useEffect(() => {
    const d = ref.current;
    if (blocked && d && !d.open) { setException(null); setError(null); setUploaded(0); d.showModal(); }
    if (!blocked && d?.open) d.close();
  }, [blocked]);
  const list = (reasons.data ?? []).filter((r) => r.actionType === 'override' || r.actionType === 'deviate');
  const save = (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    create.mutate({ controlCode: blocked.code, entity: blocked.entity, entityId: blocked.entityId, entityRef, reasonCode: String(f.get('reasonCode')), justification: String(f.get('justification')), emergency: f.get('emergency') === 'on' },
      { onSuccess: (x) => setException(x), onError: (er) => setError(errorInfo(er)) });
  };
  const send = () => {
    setError(null);
    submit.mutate({ id: exception.id }, { onSuccess: (x) => { onDone?.(x); }, onError: (er) => setError(errorInfo(er)) });
  };
  const needsEvidence = blocked?.evidenceRequired || list.find((r) => r.code === exception?.reasonCode)?.requiresEvidence;
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onClose(); }} onClose={() => blocked && onClose()} data-testid="raise-exception">
      <h2 id={titleId}>Raise an exception</h2>
      {blocked && (
        <>
          <p data-testid="rx-why"><strong>{blocked.code}</strong> stopped this: {blocked.message}</p>
          {!exception ? (
            <form className="form-grid" onSubmit={save} aria-label="Exception request">
              <Field label="Reason" name="reasonCode" error={error}>
                <select name="reasonCode" required defaultValue=""><option value="" disabled>Choose a reason...</option>{list.map((r) => <option key={`${r.actionType}-${r.code}`} value={r.code}>{r.label}{r.requiresEvidence ? ' (evidence needed)' : ''}</option>)}</select>
              </Field>
              <Field label="Justification" name="justification" error={error} hint="What happened, why it cannot wait, and what you will do to put it right. At least 20 characters; the approvers read it."><textarea name="justification" rows="4" required minLength={20} maxLength={2000} /></Field>
              {blocked.emergencyAllowed && canEmergency && (
                <label className="check"><input type="checkbox" name="emergency" /> Emergency: let it go ahead now, and get it approved within the time allowed (otherwise it climbs to the next level)</label>
              )}
              {error && <p role="alert" className="error">{error.form}{error.correlationId && <> (<code>{error.correlationId}</code>)</>}</p>}
              <div className="actions"><button type="submit" className="btn btn-primary" disabled={create.isPending}>Save and add evidence</button><button type="button" className="btn" onClick={onClose}>Cancel</button></div>
            </form>
          ) : (
            <div>
              <p role="status" data-testid="rx-saved">Saved as {exception.no}. {needsEvidence ? 'Attach at least one file as evidence (a photo, a letter or a signed note), then send it for approval.' : 'You may attach evidence; then send it for approval.'}</p>
              <FileUploader entity="pcs_exception" entityId={exception.id} onDone={() => setUploaded((n) => n + 1)} />
              <AttachmentList key={uploaded} entity="pcs_exception" entityId={exception.id} canEdit onReplace={() => {}} />
              {error && <p role="alert" className="error" data-testid="rx-error">{error.fields?.evidence ?? error.form}{error.correlationId && <> (<code>{error.correlationId}</code>)</>}</p>}
              <div className="actions"><button type="button" className="btn btn-primary" disabled={submit.isPending} onClick={send}>Send for approval</button><button type="button" className="btn" onClick={onClose}>Keep as a draft</button></div>
            </div>
          )}
        </>
      )}
    </dialog>
  );
}
