// Observe requests from before navigation so slow data and lazy bundles can finish before a page-wide check.
export function trackPageRequests(page, { dataOnly = false } = {}) {
  const pending = new Set();
  let lastChange = Date.now();
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    pending.clear();
    lastChange = Date.now();
  });
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    // Socket polling, telemetry and message notifications continue after the page has rendered.
    if (path === '/socket.io/' || path === '/api/v1/core/ops/client-events' || path === '/api/v1/msg/calls/ringing') return;
    if (path === '/api/v1/msg/presence' && request.method() === 'POST') return;
    if (dataOnly && !['fetch', 'xhr'].includes(request.resourceType())) return;
    pending.add(request);
    lastChange = Date.now();
  });
  const finish = (request) => {
    if (pending.delete(request)) lastChange = Date.now();
  };
  page.on('requestfinished', finish);
  page.on('requestfailed', finish);
  return () => {
    if (pending.size) return [...pending].map((request) => new URL(request.url()).pathname);
    return Date.now() - lastChange < 750 ? ['Recent page activity'] : [];
  };
}
