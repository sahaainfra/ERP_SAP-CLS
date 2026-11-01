import { useCallback, useMemo, useState } from 'react';
import { ApiError } from '../api/index.js';

// Form state for the data-entry framework (part 03.02, FR-03): values addressed by path ('title', 'lines.3.quantity'), errors by
// the same path whether they come from the shared Zod schema in the browser or from the server's 400/422 details, a form-level
// message with the correlation ID, and whether anything changed since the last save (for the guard and the drafts).

/** The id of a field's input for a path, so an error summary can link to it ('lines.3.quantity' -> 'f-lines-3-quantity'). */
export const fieldId = (path) => `f-${String(path).replace(/[^A-Za-z0-9_-]+/g, '-')}`;

export function getPath(obj, path) {
  return String(path).split('.').reduce((acc, k) => (acc === undefined || acc === null ? undefined : acc[k]), obj);
}

export function setPath(obj, path, value) {
  const [head, ...rest] = String(path).split('.');
  const copy = Array.isArray(obj) ? obj.slice() : { ...(obj ?? {}) };
  copy[head] = rest.length ? setPath(copy[head] ?? (/^\d+$/.test(rest[0]) ? [] : {}), rest.join('.'), value) : value;
  return copy;
}

/** { path: message } from Zod issues (the first message per path). */
export function zodErrors(issues) {
  const out = {};
  for (const i of issues) {
    const p = i.path.join('.') || 'form';
    if (!out[p]) out[p] = i.message;
  }
  return out;
}

/** { fields: { path: message }, form, correlationId } from anything a save can throw. */
export function serverErrors(err) {
  if (!(err instanceof ApiError)) return { fields: {}, form: 'Something went wrong. Try again.', correlationId: null };
  const fields = {};
  for (const d of err.details ?? []) if (d.field && d.field !== 'body' && !fields[d.field]) fields[d.field] = d.message;
  const onlyFields = Object.keys(fields).length > 0 && (err.details ?? []).every((d) => d.field && d.field !== 'body');
  return { fields, form: onlyFields ? `${err.message} The fields are marked below.` : err.message, correlationId: err.correlationId, status: err.status };
}

export function useForm({ initial, schema = null }) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const [submitted, setSubmitted] = useState(false);
  const dirty = useMemo(() => JSON.stringify(values) !== baseline, [values, baseline]);

  const set = useCallback((path, value) => {
    setValues((v) => setPath(v, path, value));
    setErrors((e) => {
      if (!e[path]) return e;
      const rest = { ...e };
      delete rest[path];
      return rest;
    });
  }, []);
  const update = useCallback((fn) => setValues((v) => fn(v)), []);

  /** Check with the shared schema; shows every problem and returns { ok, data }. */
  const validate = useCallback((current = values) => {
    setSubmitted(true);
    if (!schema) return { ok: true, data: current };
    const r = schema.safeParse(current);
    if (r.success) {
      setErrors({});
      setFormError(null);
      return { ok: true, data: r.data };
    }
    const errs = zodErrors(r.error.issues);
    setErrors(errs);
    setFormError({ form: `Please correct ${Object.keys(errs).length === 1 ? 'the field' : `the ${Object.keys(errs).length} fields`} marked below.`, correlationId: null });
    return { ok: false, errors: errs };
  }, [schema, values]);

  /** Show what the server refused, each message on its field. */
  const showServerError = useCallback((err) => {
    const s = serverErrors(err);
    setErrors(s.fields);
    setFormError({ form: s.form, correlationId: s.correlationId, status: s.status });
    return s;
  }, []);

  /** Start again from these values (a loaded record, a resumed draft, a create-from prefill). */
  const reset = useCallback((next, { asSaved = true } = {}) => {
    setValues(next);
    if (asSaved) setBaseline(JSON.stringify(next));
    setErrors({});
    setFormError(null);
    setSubmitted(false);
  }, []);
  const markSaved = useCallback((next) => setBaseline(JSON.stringify(next ?? values)), [values]);

  return { values, set, update, errors, setErrors, formError, setFormError, validate, showServerError, reset, markSaved, dirty, submitted };
}
