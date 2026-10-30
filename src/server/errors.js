import { randomUUID } from 'node:crypto';

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

export function correlationMiddleware(req, res, next) {
  const incoming = req.get('x-correlation-id');
  req.correlationId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.set('x-correlation-id', req.correlationId);
  next();
}

/** Standard error envelope: { error: { code, message, details, correlationId } }. No stack traces or SQL. */
export function errorHandler(log = console.error) {
  return (err, req, res, _next) => {
    const known = err instanceof HttpError;
    if (!known) log(`[${req.correlationId}]`, err);
    res.status(known ? err.status : 500).json({
      error: {
        code: known ? err.code : 'INTERNAL_ERROR',
        message: known ? err.message : 'Something went wrong on the server. Try again, and quote the correlation ID if it continues.',
        details: known ? err.details : [],
        correlationId: req.correlationId,
      },
    });
  };
}
