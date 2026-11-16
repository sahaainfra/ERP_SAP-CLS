import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

// The files of the built client (part 166.4, FR-02 and P-01). The build writes a Brotli (.br) and a gzip (.gz) copy of each script and style
// (vite.config.js); a browser that accepts one gets it, with the same content type, so a phone downloads about a quarter of the bytes. Files under
// /assets/ carry their content hash in the name: they never change, so the browser keeps them for a year without asking again. index.html, sw.js
// and the manifest are always asked for again (a new version is noticed). Nothing here applies to /api.

const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Which pre-compressed copy to send for an Accept-Encoding header: 'br', 'gzip' or null (q=0 refuses one). */
export function pickEncoding(acceptEncoding) {
  const offered = new Map(String(acceptEncoding ?? '').split(',').map((p) => {
    const [name, ...params] = p.trim().toLowerCase().split(';');
    const q = params.map((x) => x.trim()).find((x) => x.startsWith('q='));
    return [name, q ? Number(q.slice(2)) : 1];
  }).filter(([n]) => n));
  const ok = (n) => (offered.get(n) ?? (offered.has('*') ? offered.get('*') : 0)) > 0;
  if (ok('br')) return 'br';
  if (ok('gzip')) return 'gzip';
  return null;
}

/** Express middleware: answers GET/HEAD of a built file that has a compressed copy; sets the cache header of every hashed asset. */
export function staticAssets(dist) {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const path = decodeURIComponent(req.path);
    if (!path.startsWith('/assets/')) return next();
    res.setHeader('Cache-Control', IMMUTABLE); // also for the files express.static sends after us (fonts, images)
    const type = TYPES[extname(path)];
    if (!type) return next();
    const file = normalize(join(dist, path));
    if (!file.startsWith(normalize(dist) + sep)) return next();
    const enc = pickEncoding(req.headers['accept-encoding']);
    const copy = enc === 'br' ? `${file}.br` : enc === 'gzip' ? `${file}.gz` : null;
    res.vary('Accept-Encoding'); // added to the Vary: Origin of the CORS layer, not in its place
    if (!copy || !existsSync(copy) || !existsSync(file)) return next();
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Encoding', enc);
    if (req.method === 'HEAD') { res.setHeader('Content-Length', String(statSync(copy).size)); return res.end(); }
    return res.sendFile(copy, { headers: { 'Content-Type': type, 'Content-Encoding': enc, 'Cache-Control': IMMUTABLE }, lastModified: true, cacheControl: false }, (err) => { if (err) next(err); });
  };
}
