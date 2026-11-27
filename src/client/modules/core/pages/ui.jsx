import { KpiTile } from '../../../platform/design/Kpi.jsx';
import { cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../../../platform/api/index.js';
import { logExport } from '../../../platform/audit/index.js';
import { confirmLeave } from '../../../platform/forms/guard.js';
import { QueryError } from '../../../platform/feedback/states.jsx';
import { useT } from '../../../platform/i18n/index.js';

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
    <div className="skeleton" role="status" aria-busy="true" aria-label={label}>
      {[0, 1, 2].map((i) => <div key={i} className="skeleton-row" />)}
    </div>
  );
}

/** Forbidden, error or nothing at all for a failed query; null while it is fine. Draws the standard states (part 03.04). */
export function QueryState({ query, what, permission }) {
  if (query.isPending) return <Loading label={`Loading ${what}`} />;
  if (!query.isError) return null;
  return <QueryError error={query.error} what={what} permission={permission} onRetry={() => query.refetch()} />;
}

export function FieldError({ error, name, id }) {
  return error?.fields?.[name] ? <span className="field-error" id={id ?? `err-${name}`}>{error.fields[name]}</span> : null;
}

const NATIVE = new Set(['input', 'select', 'textarea']);

/**
 * A labelled field of a hand-built form (used by most module pages). Part 09: when its control is one native input, select or textarea,
 * the field marks it as required with the same visible star as the platform fields (the browser already tells assistive technology),
 * and ties its hint and the server's message for it to the control (aria-describedby), marking it invalid while that message shows.
 * Anything the page set itself on the control is kept.
 */
export function Field({ label, name, error, children, hint }) {
  const uid = useId();
  const hintId = hint ? `${uid}-hint` : undefined;
  const message = error?.fields?.[name];
  const errId = message ? `${uid}-err` : undefined;
  const one = isValidElement(children) && typeof children.type === 'string' && NATIVE.has(children.type) ? children : null;
  // no second mark where the page already wrote one into the label ('Site *') or says it in words
  const required = Boolean(one?.props.required) && !(typeof label === 'string' && (/required/i.test(label) || /\*\s*$/.test(label)));
  // PACK-W0-01: with the star inside the <label>, the label's text became "Reason *" and every lookup of the control by its exact
  // label failed (17 E2E specs on main, runs #159/#160). The control is now named by the label text alone (aria-labelledby), which
  // is also what assistive technology already announced; a name the page set itself is kept.
  const labelId = required && !one.props['aria-label'] && !one.props['aria-labelledby'] ? `${uid}-label` : undefined;
  const control = one
    ? cloneElement(one, {
      'aria-describedby': one.props['aria-describedby'] ?? ([hintId, errId].filter(Boolean).join(' ') || undefined),
      'aria-invalid': one.props['aria-invalid'] ?? (message ? true : undefined),
      ...(labelId ? { 'aria-labelledby': labelId } : {}),
    })
    : children;
  return (
    <label className="field">
      <span>{labelId ? <span id={labelId}>{label}</span> : label}{required && <span className="ff-req" aria-hidden="true"> *</span>}</span>
      {control}
      {hint && <span className="muted small" id={hintId}>{hint}</span>}
      <FieldError error={error} name={name} id={errId} />
    </label>
  );
}

/** A modal form. `onSubmit` receives FormData; `error` is the result of errorInfo(). */
/** Whether a form's fields differ from how they were drawn (their default values): something was typed or chosen. */
export function formChanged(form) {
  if (!form) return false;
  for (const el of form.elements) {
    if (el.disabled || el.type === 'hidden' || el.type === 'button' || el.type === 'submit') continue;
    if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked !== el.defaultChecked) return true; } else if (el.tagName === 'SELECT') { if ([...el.options].some((o) => o.selected !== o.defaultSelected)) return true; } else if (el.type === 'file') { if (el.files?.length) return true; } else if ('defaultValue' in el && el.value !== el.defaultValue) return true;
  }
  return false;
}

/**
 * A modal form. `onSubmit` receives FormData; `error` is the result of errorInfo().
 * Part 11: whenever it closes (Cancel, Escape, saved) the form goes back to how it was drawn, so what was typed and not saved is really
 * cancelled and never shows up the next time it opens, for this or another record. Escape with something typed asks first, inside the dialog.
 */
export function FormDialog({ dialogRef, title, children, onSubmit, error, busy, submitLabel = 'Save', reason = true }) {
  const titleId = useId();
  const formRef = useRef(null);
  const keepRef = useRef(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return undefined;
    // PACK-W0-01: called through the prototype, because a field named "reset" (the replay dialog's "Empty the consumer") replaces
    // form.reset with that input ("reset is not a function" on closing it, e2e/operations.spec.js)
    const onClose = () => { if (formRef.current) HTMLFormElement.prototype.reset.call(formRef.current); setAsking(false); };
    const onCancel = (e) => { if (formChanged(formRef.current)) { e.preventDefault(); setAsking(true); } };
    d.addEventListener('close', onClose);
    d.addEventListener('cancel', onCancel);
    return () => { d.removeEventListener('close', onClose); d.removeEventListener('cancel', onCancel); };
  }, [dialogRef]);
  useEffect(() => { if (asking) keepRef.current?.focus(); }, [asking]);
  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby={titleId}>
      <form
        ref={formRef}
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
        {asking && (
          <div className="state state-warning dialog-discard" role="alert" data-testid="discard-ask">
            <span>You have typed something that is not saved. Close and lose it?</span>
            <div className="actions">
              <button type="button" className="btn" ref={keepRef} onClick={() => setAsking(false)}>Keep editing</button>
              <button type="button" className="btn btn-danger" onClick={() => dialogRef.current?.close()}>Discard changes</button>
            </div>
          </div>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving...' : submitLabel}</button>
        </div>
      </form>
    </dialog>
  );
}

/**
 * One save at a time (a page with "Save draft" and "Save and send"): the wrapped action is ignored while an earlier one is still running, so
 * the second click of a double click, which can land on the other button once the page moves, does not send a second write. Call it at the top
 * of the component (it is a hook) and wrap the page's action: `const once = useOneAtATime(); const run = once(async (...) => { ... });`
 */
export function useOneAtATime() {
  const running = useRef(false);
  return useCallback((fn) => async (...args) => {
    if (running.current) return null;
    running.current = true;
    try { return await fn(...args); } finally { running.current = false; }
  }, []);
}

export const can = (session, permission) => Boolean(session?.permissions?.includes(permission));

/** Move to another page of the shell without a reload (the shell listens for popstate). A form with unsaved changes asks first,
 * unless the move is the form's own (`force`, for example after it saved). Returns false when the person chose to stay. */
export function navigateTo(path, { force = false } = {}) {
  if (!force && !confirmLeave()) return false;
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  return true;
}

export const Link = ({ to, children }) => (
  <a href={to} onClick={(e) => { e.preventDefault(); navigateTo(to); }}>{children}</a>
);

/** A KPI tile: value, caption and a status colour; becomes a link when `to` is given (drill-down). Since part 166.2 it is the shared KpiTile
 * (platform/design/Kpi.jsx), so the older pages get the UI v3 tile with no change of their own; `kind` and `icon` pick the icon. */
export function Tile({ label, value, status = 'neutral', to, hint, testId, kind, icon, unit }) {
  return <KpiTile label={label} value={value} tone={status} to={to} valueTestid={testId} kind={kind} icon={icon} unit={unit}>{hint && <span className="muted small">{hint}</span>}</KpiTile>;
}

export function downloadCsv(filename, text, type = 'text/csv;charset=utf-8') {
  // the server keeps a record of who exported what, from which page and how many rows (part 02.06)
  logExport({ report: filename, format: 'csv', rows: Math.max(0, String(text).split('\n').length - 2), filters: Object.fromEntries(new URLSearchParams(window.location.search)), sensitive: window.location.pathname.startsWith('/admin') });
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export function Pager({ meta, page, setPage, noun }) {
  const t = useT('common');
  if (!meta) return null;
  return (
    <div className="pager">
      <span>{t('pager.summary', { total: meta.total, noun, page: meta.page, pages: meta.totalPages })}</span>
      <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('previous')}</button>
      <button type="button" className="btn" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>{t('next')}</button>
    </div>
  );
}
