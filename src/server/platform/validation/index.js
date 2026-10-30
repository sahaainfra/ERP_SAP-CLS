import { badRequest } from '../http/errors.js';

/** Convert Zod issues into the envelope's field-level details. */
export const zodDetails = (err) => err.issues.map((i) => ({ field: i.path.join('.') || 'body', message: i.message }));

/** Validate a value against a Zod schema; throws a 400 with field-level details (FR-03). */
export function parse(schema, value, message = 'Some fields are invalid. Fix them and try again.') {
  const r = schema.safeParse(value);
  if (!r.success) throw badRequest(message, zodDetails(r.error));
  return r.data;
}
