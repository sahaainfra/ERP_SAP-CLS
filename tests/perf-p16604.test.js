import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { isChunkError, lazyPage, preloadRoutes } from '../src/client/platform/shell/lazyPage.js';
import { allRoutes } from '../src/client/platform/shell/registry.js';
import { bottomBarPaths } from '../src/client/platform/shell/prefetch.js';
import { BUDGET, check, initialScripts } from '../scripts/bundle_budget.mjs';
import { lowBandwidthSaves, setLowBandwidthExtras } from '../src/client/platform/device/lowBandwidth.js';

// Part 166.4: phone performance. The pages are split from the first download, the budget script, the prefetch of the bottom bar, the service
// worker's timeout and stale-while-revalidate menu, and the low-bandwidth extras.

const MODULES = readdirSync('src/client/modules');

test('P-02 FR-01 every page of every module is loaded when it is opened; the routes themselves stay in the first download', async () => {
  for (const m of MODULES) await import(`../src/client/modules/${m}/index.js`); // in Node: the registries load without any page
  const routes = allRoutes();
  assert.ok(routes.length > 600, `${routes.length} routes registered`);
  const eager = routes.filter((r) => r.Page?.lazyPage !== true).map((r) => r.path);
  assert.deepEqual(eager, [], 'every route names a lazy page');
  for (const r of routes) assert.ok(r.label && r.path.startsWith('/'), 'the metadata of the route is there without its page');
  // no module registry imports a page file statically
  for (const m of MODULES) {
    const src = readFileSync(`src/client/modules/${m}/index.js`, 'utf8');
    assert.doesNotMatch(src, /^import [^;]+ from '[^']+\.jsx';$/m, `${m}/index.js imports a page file statically`);
  }
  // nor does the entry or the application: the pages reached by a link and the chat dock are lazy too
  // (the sign-in page stays: it is the first screen of a person who is not signed in)
  for (const f of ['src/client/main.jsx', 'src/client/App.jsx']) {
    const eagerPages = [...readFileSync(f, 'utf8').matchAll(/^import (\w+) from '\.\/modules\/[^']+(?:Page|ChatDock)\.jsx';$/gm)].map((m) => m[1]);
    assert.deepEqual(eagerPages.filter((n) => n !== 'LoginPage'), [], f);
  }
});

test('FR-01 lazyPage fetches once, picks a named export, forgets a failed fetch so the next try fetches again, and preloads quietly', async () => {
  let calls = 0;
  const A = lazyPage(async () => { calls += 1; return { default: 'pageA', Other: 'pageB' }; });
  assert.equal(A.lazyPage, true);
  assert.deepEqual(await A.preload(), { default: 'pageA' });
  await A.preload();
  assert.equal(calls, 1, 'one fetch');
  const B = lazyPage(async () => ({ Other: 'pageB' }), 'Other');
  assert.deepEqual(await B.preload(), { default: 'pageB' });
  await assert.rejects(lazyPage(async () => ({}), 'Missing').preload(), /not exported/);
  let tries = 0;
  const C = lazyPage(async () => { tries += 1; if (tries === 1) throw new TypeError('Failed to fetch dynamically imported module: /assets/X.js'); return { default: 'ok' }; });
  await assert.rejects(C.preload());
  assert.deepEqual(await C.preload(), { default: 'ok' }, 'the second try fetches again');
  // preloadRoutes ignores routes without a lazy page and swallows a failure
  let bad = 0;
  preloadRoutes([{ Page: lazyPage(async () => { bad += 1; throw new Error('offline'); }) }, { Page: () => null }, null]);
  await new Promise((r) => { setTimeout(r, 5); });
  assert.equal(bad, 1);
  // the errors of a script that could not be fetched, in the words of each browser
  for (const m of ['Failed to fetch dynamically imported module: x', 'Importing a module script failed.', 'error loading dynamically imported module', 'Unable to preload CSS for /x.css']) assert.equal(isChunkError(new Error(m)), true, m);
  assert.equal(isChunkError(new Error('Cannot read properties of undefined')), false);
});

test('FR-01 the bottom bar\'s pages: the person\'s registry row, else Home, My Work, Scan and Messages; queries are dropped', () => {
  const nav = { groups: [{ code: 'g-mywork', pages: [{ route: '/my-work' }] }, { code: 'g-messages', pages: [{ route: '/messages' }] }], bottomBar: [{ item: 'page', route: '/field/approvals?x=1' }, { item: 'scan', route: null }] };
  const paths = bottomBarPaths(nav);
  for (const p of ['/field/approvals', '/home', '/field', '/field/scan', '/my-work', '/messages']) assert.ok(paths.includes(p), p);
  assert.equal(new Set(paths).size, paths.length);
  assert.deepEqual(bottomBarPaths(null), []);
});

test('P-04 T-01 the budget: first download at most 350 KB gzip, each other chunk at most 250 KB (the PDF viewer 400 KB); scripts read from index.html', () => {
  const html = '<script type="module" crossorigin src="/assets/index-A.js"></script><link rel="modulepreload" crossorigin href="/assets/vendor-react-B.js"><link rel="stylesheet" href="/assets/index.css">';
  assert.deepEqual(initialScripts(html), ['assets/index-A.js', 'assets/vendor-react-B.js']);
  assert.deepEqual(BUDGET, { initialGzip: 350 * 1024, chunkGzip: 250 * 1024, libraryGzip: { 'pdf.min': 400 * 1024 } });
  const KB = 1024;
  const ok = check([{ file: 'assets/index-A.js', gzip: 200 * KB }, { file: 'assets/vendor-react-B.js', gzip: 100 * KB }, { file: 'assets/Page-C.js', gzip: 240 * KB }, { file: 'assets/pdf.min-D.js', gzip: 380 * KB }], ['assets/index-A.js', 'assets/vendor-react-B.js']);
  assert.equal(ok.ok, true);
  assert.equal(ok.initialGzip, 300 * KB);
  const before = check([{ file: 'assets/index-X.js', gzip: 1652 * KB }], ['assets/index-X.js']); // the one file of main before this part
  assert.equal(before.ok, false);
  assert.match(before.problems[0], /first download 1652\.0 KB gzip is above 350\.0 KB/);
  const big = check([{ file: 'assets/index-A.js', gzip: 10 * KB }, { file: 'assets/Huge-E.js', gzip: 251 * KB }], ['assets/index-A.js']);
  assert.deepEqual(big.problems, ['assets/Huge-E.js 251.0 KB gzip is above 250.0 KB']);
});

test('FR-03 the low-bandwidth extras apply only with the flag ON and the mode on', () => {
  const store = new Map();
  globalThis.window = globalThis.window ?? globalThis;
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  try {
    setLowBandwidthExtras(false);
    store.set('erp.lowbw', 'on');
    assert.equal(lowBandwidthSaves(), false, 'the flag is OFF');
    setLowBandwidthExtras(true);
    assert.equal(lowBandwidthSaves(), true);
    store.set('erp.lowbw', 'off');
    assert.equal(lowBandwidthSaves(), false, 'the mode is off');
  } finally {
    setLowBandwidthExtras(false);
    delete globalThis.localStorage;
  }
});

// ---- the service worker, run in a small imitation of a worker: caches, fetch, clients, timers ----
function worker({ network }) {
  const handlers = {};
  const stores = new Map();
  const cacheOf = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return { put: async (req, res) => { m.set(typeof req === 'string' ? req : req.url, res); }, match: async (req) => m.get(typeof req === 'string' ? req : req.url)?.clone(), addAll: async () => {} };
  };
  const posted = [];
  const self = {
    location: { origin: 'https://erp.test' },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    clients: { matchAll: async () => [{ postMessage: (m) => posted.push(m) }], claim: async () => {} },
    skipWaiting: () => {},
  };
  const sandbox = { self, caches: { open: async (n) => cacheOf(n), keys: async () => [...stores.keys()], delete: async (n) => stores.delete(n), match: async () => undefined }, fetch: network, Request, Response, URL, setTimeout, clearTimeout, Promise, console };
  const src = readFileSync('src/client/sw.js', 'utf8').replace("'__BUILD_ID__'", '"t1"').replace("'__PRECACHE__'", '[]');
  vm.runInNewContext(src, sandbox);
  const ask = (path, headers = {}) => new Promise((resolve) => {
    const request = new Request(`https://erp.test${path}`, { headers: { 'x-erp-cache-scope': 'se1', ...headers } });
    let answered = false;
    const waits = [];
    handlers.fetch({ request, respondWith: (p) => { answered = true; resolve(p); }, waitUntil: (p) => waits.push(p) });
    if (!answered) resolve(null); // not handled by the worker: the browser fetches it
  });
  return { ask, posted };
}

const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

test('FR-02 with the 166.4 mark, a call kept for offline use waits at most 3 s for the network, then the kept copy is answered', async () => {
  let slow = false;
  let served = 0;
  const w = worker({ network: async () => { served += 1; if (slow) await wait(4500); return json({ data: { n: served } }); } });
  const mark = { 'x-erp-sw': 'p16604' };
  const first = await w.ask('/api/v1/ui/field/today', mark);
  assert.deepEqual(await first.json(), { data: { n: 1 } }, 'online: the network, and a copy is kept');
  await wait(20);
  slow = true;
  const started = Date.now();
  const second = await w.ask('/api/v1/ui/field/today', mark);
  const took = Date.now() - started;
  assert.deepEqual(await second.json(), { data: { n: 1 } }, 'a slow network: the kept copy');
  assert.ok(took >= 2900 && took < 4200, `answered after ${took} ms`);
  // without the mark (flag OFF) the field home's call is not handled by the worker at all, and a shell call waits for the network as before
  assert.equal(await w.ask('/api/v1/ui/field/today'), null);
  slow = false;
  await w.ask('/api/v1/ui/launchpad');
  slow = true;
  const t0 = Date.now();
  const unmarked = await w.ask('/api/v1/ui/launchpad');
  assert.ok(Date.now() - t0 >= 4400, 'no timeout without the mark');
  assert.equal(unmarked.status, 200);
  // business data is never handled
  assert.equal(await w.ask('/api/v1/site/dprs', mark), null);
});

test('FR-02 the menu is stale-while-revalidate: the kept copy at once, the fresh one behind it, and the page is told when it changed', async () => {
  let version = 1;
  const w = worker({ network: async () => { await wait(50); return json({ data: { v: version } }); } });
  const mark = { 'x-erp-sw': 'p16604' };
  const first = await w.ask('/api/v1/ui/navigation', mark);
  assert.deepEqual(await first.json(), { data: { v: 1 } }, 'nothing kept yet: the network');
  await wait(80);
  version = 2;
  const t0 = Date.now();
  const second = await w.ask('/api/v1/ui/navigation', mark);
  assert.ok(Date.now() - t0 < 40, 'the kept copy at once');
  assert.deepEqual(await second.json(), { data: { v: 1 } });
  await wait(120);
  assert.deepEqual(JSON.parse(JSON.stringify(w.posted)), [{ type: 'API_UPDATED', path: '/api/v1/ui/navigation' }], 'the page is told the menu changed'); // (made in the worker's own realm)
  const third = await w.ask('/api/v1/ui/navigation', mark);
  assert.deepEqual(await third.json(), { data: { v: 2 } }, 'the fresh copy is kept');
  await wait(120);
  assert.equal(w.posted.length, 1, 'no message when nothing changed');
  // another person on the device has no copy of this one's menu
  const other = await w.ask('/api/v1/ui/navigation', { ...mark, 'x-erp-cache-scope': 'pm1' });
  assert.equal(other.status, 200);
});

test('FR-02 the precache keeps the shell and the field pages, not every page (vite.config.js)', () => {
  const cfg = readFileSync('vite.config.js', 'utf8');
  const pages = /const OFFLINE_PAGES = (\/.*\/);/.exec(cfg)[1];
  for (const p of ['LaunchpadPage', 'FieldHomePage', 'ScannerPage', 'MobileApprovalsPage', 'FieldFormsPage', 'SyncStatusPage', 'ConflictPage', 'DprEntryPage']) {
    assert.ok(pages.includes(p), p);
    assert.ok(MODULES.some((m) => { try { return readFileSync(join('src/client/modules', m, `${p}.jsx`)) && pages.includes(`${m}\\/`); } catch { return false; } }), `${p} exists where the pattern looks`);
  }
});

test('P-01 FR-02 the server sends the Brotli or gzip copy of a built script, and keeps hashed files for a year; other paths are untouched', async () => {
  const { pickEncoding, staticAssets, IMMUTABLE } = await import('../src/server/platform/http/staticAssets.js');
  assert.equal(pickEncoding('gzip, deflate, br, zstd'), 'br');
  assert.equal(pickEncoding('gzip, deflate'), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip;q=0.5'), 'gzip');
  assert.equal(pickEncoding('identity'), null);
  assert.equal(pickEncoding(undefined), null);
  assert.equal(pickEncoding('*'), 'br');
  const { mkdtempSync, writeFileSync: write, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { brotliCompressSync, gzipSync, brotliDecompressSync } = await import('node:zlib');
  const express = (await import('express')).default;
  const dist = mkdtempSync(join(tmpdir(), 'erp-dist-'));
  mkdirSync(join(dist, 'assets'));
  const body = Buffer.from(`console.log(${JSON.stringify('x'.repeat(5000))});`);
  write(join(dist, 'assets', 'index-abc.js'), body);
  write(join(dist, 'assets', 'index-abc.js.br'), brotliCompressSync(body));
  write(join(dist, 'assets', 'index-abc.js.gz'), gzipSync(body));
  write(join(dist, 'assets', 'font-x.woff2'), Buffer.from('wOF2'));
  const app = express();
  app.use(staticAssets(dist));
  app.use(express.static(dist));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const http = await import('node:http');
  const get = (path, enc) => new Promise((resolve, reject) => {
    http.get(`${base}${path}`, { headers: enc ? { 'accept-encoding': enc } : {} }, (res) => { const parts = []; res.on('data', (d) => parts.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) })); }).on('error', reject);
  });
  try {
    const br = await get('/assets/index-abc.js', 'gzip, br');
    assert.equal(br.status, 200);
    assert.equal(br.headers['content-encoding'], 'br');
    assert.match(br.headers['content-type'], /^text\/javascript/);
    assert.equal(br.headers['cache-control'], IMMUTABLE);
    assert.match(br.headers.vary, /Accept-Encoding/);
    assert.ok(br.body.length < body.length / 10, `${br.body.length} bytes sent for ${body.length}`);
    assert.deepEqual(brotliDecompressSync(br.body), body);
    const gz = await get('/assets/index-abc.js', 'gzip');
    assert.equal(gz.headers['content-encoding'], 'gzip');
    const plain = await get('/assets/index-abc.js', null);
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.deepEqual(plain.body, body);
    assert.equal(plain.headers['cache-control'], IMMUTABLE, 'the hashed file is kept a year also without compression');
    const font = await get('/assets/font-x.woff2', 'br');
    assert.equal(font.headers['content-encoding'], undefined, 'a font has no copy');
    assert.equal(font.headers['cache-control'], IMMUTABLE);
    assert.equal((await get('/assets/../../etc/passwd', 'br')).status, 404);
  } finally {
    server.close();
  }
});

test('P-05 JSON answers of the API are compressed for a browser that accepts it; the text needs only the company\'s own wording', async () => {
  const { startApi } = await import('./helpers.js');
  const { brotliDecompressSync, gunzipSync } = await import('node:zlib');
  const http = await import('node:http');
  const api = await startApi();
  try {
    const port = Number(new URL(api.base).port);
    const raw = (path, enc) => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path, headers: { 'x-erp-user': 'perf-admin', 'x-erp-roles': 'SYSADM', 'x-erp-company': '1', ...(enc ? { 'accept-encoding': enc } : {}) } }, (res) => {
        const parts = []; res.on('data', (d) => parts.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
      }).on('error', reject);
    });
    const plain = await raw('/api/v1/ui/translations/en/all', null);
    assert.equal(plain.status, 200);
    assert.equal(plain.headers['content-encoding'], undefined);
    const full = JSON.parse(plain.body.toString());
    const br = await raw('/api/v1/ui/translations/en/all', 'gzip, deflate, br');
    assert.equal(br.headers['content-encoding'], 'br');
    assert.match(br.headers['content-type'], /application\/json/);
    assert.deepEqual(JSON.parse(brotliDecompressSync(br.body).toString()), full);
    assert.ok(br.body.length < plain.body.length / 3, `${br.body.length} bytes for ${plain.body.length}`);
    const gz = await raw('/api/v1/ui/translations/en/all', 'gzip');
    assert.deepEqual(JSON.parse(gunzipSync(gz.body).toString()), full);
    // a small answer is sent as it is
    const small = await raw('/api/health', 'br');
    assert.equal(small.headers['content-encoding'], undefined);
    // the company's own wording only: nothing when it has changed nothing, and the same keys the browser kept before
    const only = JSON.parse((await raw('/api/v1/ui/translations/en/all?only=overrides', null)).body.toString()).data;
    assert.equal(Object.values(only.namespaces).reduce((n, o) => n + Object.keys(o).length, 0), 0);
    assert.ok(Object.keys(full.data.namespaces.shell).length > 50);
  } finally {
    await api.close();
  }
});

test('P-05 a compressed JSON answer is kept by the idempotency layer: a replay with the same key gives the same answer and does not run twice', async () => {
  const { default: express } = await import('express');
  const { memoryDb } = await import('./helpers.js');
  const { compressJson } = await import('../src/server/platform/http/compressJson.js');
  const { idempotency } = await import('../src/server/platform/http/idempotency.js');
  const { brotliDecompressSync } = await import('node:zlib');
  const http = await import('node:http');
  const db = memoryDb();
  let runs = 0;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.actor = { user: 'perf-idem', companyId: 1 }; next(); });
  app.use(compressJson());
  app.post('/act', idempotency(db), (_req, res) => { runs += 1; res.json({ data: { run: runs, lines: Array.from({ length: 200 }, (_, i) => ({ i, text: `line ${i} of the answer` })) } }); });
  const server = app.listen(0);
  const port = server.address().port;
  const post = (enc) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: '/act', method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'perf-key-0001', ...(enc ? { 'accept-encoding': enc } : {}) } }, (res) => {
      const parts = []; res.on('data', (d) => parts.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
    });
    r.on('error', reject); r.end('{"x":1}');
  });
  try {
    const first = await post('br');
    assert.equal(first.status, 200);
    assert.equal(first.headers['content-encoding'], 'br', 'the first answer is compressed');
    const firstJson = JSON.parse(brotliDecompressSync(first.body).toString());
    const again = await post('br');
    assert.equal(again.headers['idempotency-replayed'], 'true');
    const againJson = JSON.parse(again.headers['content-encoding'] === 'br' ? brotliDecompressSync(again.body).toString() : again.body.toString());
    assert.deepEqual(againJson, firstJson);
    assert.equal(runs, 1, 'the action ran once');
  } finally {
    server.close();
  }
});
