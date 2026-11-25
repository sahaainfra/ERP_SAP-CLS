// Part 30.08: the switching proxy of the blue-green rehearsal (production uses nginx with the same include, infra/nginx/erp.conf). Every
// request goes to the active slot named in the environment's bluegreen.json; the switch is the next request, so nothing is refused while a
// deploy or a rollback happens. Each request opens its own connection upstream, so a slot being drained gets no new work.
import http from 'node:http';
import { readFileSync, statSync } from 'node:fs';

export function createSwitchProxy({ stateFile, listenPort = 0 }) {
  let cache = { mtime: 0, port: null };
  const activePort = () => {
    try {
      const m = statSync(stateFile).mtimeMs;
      if (m !== cache.mtime) { const s = JSON.parse(readFileSync(stateFile, 'utf8')); cache = { mtime: m, port: s.active ? s.slots[s.active].port : null }; }
    } catch { /* keep the last port while the file is being replaced */ }
    return cache.port;
  };
  const counts = { requests: 0, upstreamErrors: 0, byPort: {} };
  const server = http.createServer((req, res) => {
    const port = activePort();
    counts.requests += 1;
    if (!port) { res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":{"code":"SERVICE_UNAVAILABLE","message":"No active slot"}}'); return; }
    counts.byPort[port] = (counts.byPort[port] ?? 0) + 1;
    const up = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers: { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress }, agent: false }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { counts.upstreamErrors += 1; if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' }); res.end('{"error":{"code":"BAD_GATEWAY"}}'); });
    req.pipe(up);
  });
  return {
    counts,
    listen: () => new Promise((resolve) => server.listen(listenPort, '127.0.0.1', () => resolve(/** @type {import('node:net').AddressInfo} */ (server.address()).port))),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
