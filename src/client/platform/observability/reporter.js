// Browser error and performance reporting (FR-04): JavaScript errors, failed API calls and the page-load time go to the server with
// the correlation ID of the request involved, so a support call quoting the ID finds the browser side and the server side together.
// No React here, so it is unit-tested in Node. Reports are batched, de-duplicated and capped so a loop cannot flood the server.

const MAX_BATCH = 20;
const MAX_PER_SESSION = 100;

/**
 * createReporter({ send, flushMs, setTimer, clearTimer }) -> { report, flush, count }.
 * `send(events)` posts one batch and may reject; a failed batch is dropped, never retried (the report must not cause more errors).
 */
export function createReporter({ send, flushMs = 3000, setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (t) => clearTimeout(t) } = {}) {
  let queue = [];
  let timer = null;
  let sent = 0;
  const seen = new Set();

  const flush = async () => {
    if (timer) clearTimer(timer);
    timer = null;
    while (queue.length) {
      const batch = queue.splice(0, MAX_BATCH);
      try {
        await send(batch);
      } catch {
        /* reporting is best effort */
      }
    }
  };

  const report = (event) => {
    if (sent >= MAX_PER_SESSION) return false;
    const path = event.path ? event.path.split('?')[0].split('#')[0] : undefined;
    const signature = `${event.type}|${event.status ?? ''}|${path ?? ''}|${event.message ?? ''}`;
    if (event.type !== 'page_load') {
      if (seen.has(signature)) return false;
      seen.add(signature);
    }
    sent += 1;
    queue.push({ ...event, path });
    if (queue.length >= MAX_BATCH) void flush();
    else if (!timer) timer = setTimer(() => void flush(), flushMs);
    return true;
  };

  return { report, flush, count: () => sent };
}

/** The reporter of this page: posts with the signed-in identity straight through fetch (not the API client, so a failure of the report cannot report itself). */
export function installReporter({ authHeaders, win = globalThis.window, fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
  if (!win) return null;
  const reporter = createReporter({
    send: (events) => fetchImpl('/api/v1/core/ops/client-events', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ events }) }),
  });
  const here = () => win.location?.pathname;
  win.addEventListener('error', (e) => reporter.report({ type: 'js_error', message: String(e.message ?? 'Script error').slice(0, 500), path: here() }));
  win.addEventListener('unhandledrejection', (e) => reporter.report({ type: 'js_error', message: `Unhandled rejection: ${String(e.reason?.message ?? e.reason ?? 'unknown').slice(0, 450)}`, path: here() }));
  win.addEventListener('pagehide', () => void reporter.flush());
  win.addEventListener('load', () => {
    win.setTimeout(() => {
      const nav = win.performance?.getEntriesByType?.('navigation')?.[0];
      if (nav?.loadEventEnd > 0) reporter.report({ type: 'page_load', path: here(), durationMs: Math.round(nav.loadEventEnd) });
    }, 0);
  });
  return reporter;
}

/** A failed API call (network error or a 5xx answer). Client mistakes such as 403 or 422 are expected outcomes, not failures. */
export const isReportableFailure = (err) => err?.status === 0 || err?.status >= 500;
export const failureEvent = (err, path) => ({ type: 'api_failure', status: err.status, message: err.code, path, correlationId: err.correlationId ?? undefined });
