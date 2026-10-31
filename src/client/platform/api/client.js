// The one API client every module uses (FR-07): auth headers, a correlation ID per call, error
// normalisation into ApiError, and retry of idempotent GETs only. No React in this file, so it is unit-tested in Node.

const RETRYABLE_STATUS = new Set([502, 503, 504]);

export class ApiError extends Error {
  constructor({ status, code, message, details = [], correlationId = null, attempts = 1 }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.correlationId = correlationId;
    this.attempts = attempts;
  }

  /** { field: message } for showing errors next to inputs. */
  get fieldErrors() {
    return Object.fromEntries(this.details.map((d) => [d.field, d.message]));
  }
}

const defaultId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `c-${Date.now()}-${Math.random().toString(16).slice(2)}`);

/**
 * createApiClient({ getAuthHeaders }) -> { get, post, patch, put, delete, request }.
 * `retries` extra attempts for GET on a network error or a 502/503/504, waiting backoffMs, 2x, 4x...
 * Writes are never retried: a retry could apply them twice. Pass `{ headers: { 'idempotency-key': id } }` on an
 * action so the server can recognise a repeat (see docs/erp/ARCHITECTURE.md).
 */
export function createApiClient({
  getAuthHeaders = () => ({}),
  baseUrl = '/api/v1',
  fetchImpl = (...a) => globalThis.fetch(...a),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  newId = defaultId,
  retries = 2,
  backoffMs = 200,
  onFailure = () => {},
  onUnauthorized = null,
} = {}) {
  const fail = (err, path) => {
    try {
      onFailure(err, path);
    } catch {
      /* a broken observer must not change the outcome of the call */
    }
    return err;
  };
  async function request(method, path, body, { signal, headers = {} } = {}) {
    const correlationId = newId();
    const canRetry = method === 'GET' || method === 'HEAD';
    const maxAttempts = canRetry ? retries + 1 : 1;
    let lastError;
    let reauthed = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let res;
      try {
        res = await fetchImpl(`${baseUrl}${path}`, {
          method,
          signal,
          headers: { 'content-type': 'application/json', ...getAuthHeaders(), ...headers, 'x-correlation-id': correlationId },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        lastError = new ApiError({
          status: 0,
          code: 'NETWORK',
          message: 'Cannot reach the server. Check your connection and try again.',
          correlationId,
          attempts: attempt,
        });
        if (attempt < maxAttempts) {
          await sleep(backoffMs * 2 ** (attempt - 1));
          continue;
        }
        throw fail(lastError, path);
      }
      const text = await res.text();
      let json;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* not JSON (for example an HTML error page from a proxy): json stays undefined */
      }
      if (res.ok) return json;
      // A 401 on a signed-in call: the access token may just have expired. Get a new one once and send the same call again.
      if (res.status === 401 && onUnauthorized && !reauthed && !path.startsWith('/iam/auth/')) {
        reauthed = true;
        if (await onUnauthorized()) {
          attempt -= 1;
          continue;
        }
      }
      lastError = normaliseError(res, json, correlationId, attempt);
      if (RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts) {
        await sleep(backoffMs * 2 ** (attempt - 1));
        continue;
      }
      throw fail(lastError, path);
    }
    throw lastError;
  }

  return {
    request,
    get: (path, opts) => request('GET', path, undefined, opts),
    post: (path, body, opts) => request('POST', path, body, opts),
    patch: (path, body, opts) => request('PATCH', path, body, opts),
    put: (path, body, opts) => request('PUT', path, body, opts),
    delete: (path, opts, body) => request('DELETE', path, body, opts),
  };
}

/** Turn any failed response into an ApiError, whether or not the body is the standard envelope. */
function normaliseError(res, json, sentCorrelationId, attempts) {
  const e = json?.error;
  if (e && typeof e.code === 'string') {
    return new ApiError({
      status: res.status,
      code: e.code,
      message: e.message,
      details: Array.isArray(e.details) ? e.details : [],
      correlationId: e.correlationId ?? res.headers?.get?.('x-correlation-id') ?? sentCorrelationId,
      attempts,
    });
  }
  return new ApiError({
    status: res.status,
    code: res.status >= 500 ? 'SERVICE_UNAVAILABLE' : 'UNEXPECTED_RESPONSE',
    message: `The server returned an unexpected response (HTTP ${res.status}). Try again, and quote the correlation ID if it continues.`,
    correlationId: res.headers?.get?.('x-correlation-id') ?? sentCorrelationId,
    attempts,
  });
}
