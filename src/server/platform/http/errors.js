import { createLogger } from './logger.js';

export class HttpError extends Error {
  constructor(status, code, message, details = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, 'VALIDATION_ERROR', message, details);
export const unauthorized = (message) => new HttpError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message) => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message) => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message, details) => new HttpError(409, 'VERSION_CONFLICT', message, details);
/** A business rule refused the action (422): say what happened, why and what the user can do. */
export const unprocessable = (message, details) => new HttpError(422, 'BUSINESS_RULE', message, details);

/**
 * Every error code the API can return. This single list feeds the error handler, the architecture guide
 * page and the OpenAPI document, so a code cannot exist in one place and be missing from another.
 */
export const ERROR_CODES = [
  { code: 'VALIDATION_ERROR', status: 400, meaning: 'An input failed server-side validation; details name each field.', action: 'Fix the named fields and send again.' },
  { code: 'BAD_JSON', status: 400, meaning: 'The request body is not valid JSON.', action: 'Send a well-formed JSON body.' },
  { code: 'UNAUTHENTICATED', status: 401, meaning: 'No valid identity was supplied.', action: 'Sign in and try again.' },
  { code: 'FORBIDDEN', status: 403, meaning: 'The signed-in user lacks the permission or the data scope.', action: 'Ask an administrator for the permission named in the message.' },
  { code: 'NOT_FOUND', status: 404, meaning: 'The record or route does not exist, or is outside the caller\'s scope.', action: 'Check the identifier; refresh the list.' },
  { code: 'VERSION_CONFLICT', status: 409, meaning: 'The record changed since it was read (optimistic locking) or its state does not allow the action.', action: 'Refresh the record and apply the change again.' },
  { code: 'PAYLOAD_TOO_LARGE', status: 413, meaning: 'The request body is over the size limit.', action: 'Send less data, or use the document service for files.' },
  { code: 'BUSINESS_RULE', status: 422, meaning: 'A business rule refused the action (for example a closed period).', action: 'Follow the explanation in the message.' },
  { code: 'RATE_LIMITED', status: 429, meaning: 'Too many requests in a short time.', action: 'Wait and retry with back-off.' },
  { code: 'INTERNAL_ERROR', status: 500, meaning: 'An unexpected server error; details are in the server log under the correlation ID.', action: 'Retry once, then report the correlation ID.' },
  { code: 'SERVICE_UNAVAILABLE', status: 503, meaning: 'A dependency (database, queue or storage) is down.', action: 'Retry later; administrators see which dependency failed on the readiness check.' },
  { code: 'DUPLICATE_FILE', status: 409, meaning: 'A file with identical content is already attached to this record.', action: 'Use the existing file, or upload a changed version.' },
  { code: 'LINK_EXPIRED', status: 410, meaning: 'A signed download link has expired.', action: 'Open the file again from its record to get a fresh link.' },
  { code: 'FILE_REJECTED', status: 422, meaning: 'The file type, content or size is not allowed.', action: 'Check the allowed types and size limits on the File Storage Settings page and upload a permitted file.' },
  { code: 'ONBOARDING_RESTRICTED', status: 403, meaning: 'The account is known but holds no approved role yet, so only the profile is available.', action: 'Ask an administrator to request a role for you; it takes effect when the request is approved.' },
  { code: 'DUPLICATE_USER', status: 409, meaning: 'A person with the same email, mobile number, username or employee link already has an account.', action: 'Use the existing account (reactivate it if it was deactivated) instead of creating another.' },
  { code: 'INVITATION_EXPIRED', status: 410, meaning: 'An invitation link has expired, was replaced by a newer one or was already used.', action: 'Ask an administrator to send a new invitation.' },
  { code: 'FILE_NOT_AVAILABLE', status: 409, meaning: 'The file has not passed the virus scan (still scanning, quarantined or scan failed), so it cannot be opened.', action: 'Wait for the scan to finish; ask an administrator if it stays unavailable.' },
];

/** Map errors raised by body parsing (not HttpError) to the standard envelope. */
function describe(err) {
  if (err instanceof HttpError) return { status: err.status, code: err.code, message: err.message, details: err.details, known: true };
  if (err?.type === 'entity.parse.failed') {
    return { status: 400, code: 'BAD_JSON', message: 'The request body is not valid JSON. Send a well-formed JSON body.', details: [], known: true };
  }
  if (err?.type === 'entity.too.large') {
    return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large. Send less data.', details: [], known: true };
  }
  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong on the server. Try again, and quote the correlation ID if it continues.',
    details: [],
    known: false,
  };
}

/** Standard error envelope: { error: { code, message, details, correlationId } }. No stack traces or SQL. */
export function errorHandler(logger = createLogger()) {
  return (err, req, res, _next) => {
    const d = describe(err);
    if (!d.known) logger.error({ msg: 'unhandled error', correlationId: req.correlationId, traceId: req.span?.traceId ?? null, route: req.route?.path ?? null, error: String(err?.message ?? err), stack: err?.stack });
    res.status(d.status).json({ error: { code: d.code, message: d.message, details: d.details, correlationId: req.correlationId } });
  };
}
