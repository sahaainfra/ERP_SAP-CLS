import { useEffect, useId } from 'react';
import { ApiError } from '../../../platform/api/index.js';

// Small pieces the configuration pages share: page title, load states, field errors and a modal form.

export const usePageTitle = (title) =>
  useEffect(() => {
    document.title = `${title} - Administration - ERP`;
  }, [title]);

/** { field: message } plus a form-level message and the correlation ID, from any thrown error. */
export function errorInfo(err) {
  if (!(err instanceof ApiError)) return { form: 'Something went wrong. Try again.', fields: {} };
  const fields = {};
  for (const d of err.details ?? []) if (d.field && !fields[d.field]) fields[d.field] = d.message;
  const onlyFieldErrors = (err.details?.length ?? 0) > 0 && err.details.every((d) => d.field);
  return { form: onlyFieldErrors ? 'Please correct the highlighted fields.' : err.message, fields, correlationId: err.correlationId };
}

export function Loading({ label }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label={label}>
      {[0, 1, 2].map((i) => <div key={i} className="skeleton-row" />)}
    </div>
  );
}

/** Forbidden, error or nothing at all for a failed query; null while it is fine. */
export function QueryState({ query, what, permission }) {
  if (query.isPending) return <Loading label={`Loading ${what}`} />;
  if (!query.isError) return null;
  if (query.error.status === 403) {
    return (
      <div className="state" role="alert">
        <h2>You do not have access to {what}</h2>
        <p>This needs the {permission} permission. Ask a system administrator to grant it.</p>
      </div>
    );
  }
  return (
    <div className="state state-error" role="alert">
      <h2>Could not load {what}</h2>
      <p>{query.error.message}</p>
      {query.error.correlationId && <p className="muted">Correlation ID: <code>{query.error.correlationId}</code></p>}
      <button type="button" className="btn" onClick={() => query.refetch()}>Try again</button>
    </div>
  );
}

export function FieldError({ error, name }) {
  return error?.fields?.[name] ? <span className="field-error" id={`err-${name}`}>{error.fields[name]}</span> : null;
}

export const Field = ({ label, name, error, children, hint }) => (
  <label className="field">
    <span>{label}</span>
    {children}
    {hint && <span className="muted small">{hint}</span>}
    <FieldError error={error} name={name} />
  </label>
);

/** A modal form. `onSubmit` receives FormData; `error` is the result of errorInfo(). */
export function FormDialog({ dialogRef, title, children, onSubmit, error, busy, submitLabel = 'Save', reason = true }) {
  const titleId = useId();
  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby={titleId}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(new FormData(e.currentTarget));
        }}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
        {reason && (
          <Field label="Reason (required, min 5 characters)" name="reason" error={error}>
            <textarea name="reason" rows="2" required minLength={5} maxLength={500} aria-invalid={Boolean(error?.fields?.reason)} />
          </Field>
        )}
        {error?.form && (
          <p className="field-error" role="alert">
            {error.form}
            {error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving...' : submitLabel}</button>
        </div>
      </form>
    </dialog>
  );
}

export const can = (session, permission) => Boolean(session?.permissions?.includes(permission));
