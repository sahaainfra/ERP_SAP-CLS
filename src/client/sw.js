// The service worker (part 03.06, FR-03). `vite build` fills in the build id and the list of files of this version (scripts/ vite.config.js).
//
// - The app shell (page, scripts, styles, fonts, icons) is cached when this version installs, so the app opens with no connection.
// - Pages are network-first: a fresh page when online, the cached shell when not. Scripts and styles carry their content hash, so they are cache-first.
// - API calls are network-first. Only a short list of GET calls that draw the shell (session, menu, launchpad, settings) keep a copy for offline
//   use, keyed by the person (header x-erp-cache-scope), so a shared device never shows one person's data to another; the copies are dropped on
//   sign-out. Nothing else is stored: business data is not kept in the browser's cache, and nothing but a GET is ever answered from it.
// - A new version waits until the person agrees (the page shows "A new version is ready") and then takes over.
// - A push message is shown as a notification; touching it opens the page it names.
// - Part 166.4 (FR-02), for a request marked `x-erp-sw: p16604` (the page sets it while ff.perf.p16604 is ON): the calls kept for offline use, and the
//   field home's counts and the person's own queued commands, wait at most 3 s for the network before the kept copy is shown; the menu is
//   stale-while-revalidate (the kept copy at once, the fresh one fetched behind it; the page is told when it changed and draws it). Since the pages
//   are split (FR-01), only the shell, the home pages and the field pages are kept at install; any other page is kept the first time it is opened.

const BUILD_ID = '__BUILD_ID__';
const PRECACHE = '__PRECACHE__';
const SHELL = `erp-shell-${BUILD_ID}`;
const API = 'erp-api-v1';
const TIMEOUT_MS = 3000;
// with the 166.4 mark only: what the field home and the sync screen show (the person's own counts and commands)
const FIELD_OK = [/^\/api\/v1\/ui\/field\/today$/, /^\/api\/v1\/off\/commands$/];
const SWR = [/^\/api\/v1\/ui\/navigation$/];
const OFFLINE_OK = [/^\/api\/v1\/iam\/auth\/config$/, /^\/api\/v1\/core\/session$/, /^\/api\/v1\/ui\/(navigation|launchpad|device-settings|context-options|favourites|recent|bell)$/, /^\/api\/v1\/core\/feature-flags\/evaluate$/, /^\/api\/v1\/ui\/preferences$/];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('erp-shell-') && n !== SHELL).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_API') event.waitUntil(caches.delete(API));
});

const scoped = (request, url) => new Request(`${url.origin}${url.pathname}${url.search}${url.search ? '&' : '?'}__scope=${request.headers.get('x-erp-cache-scope') ?? ''}`);

const keep = (key, response) => caches.open(API).then((cache) => cache.put(key, response));
const keptCopy = (key) => caches.open(API).then((cache) => cache.match(key, { ignoreVary: true }));

/** Network first; with `timeoutMs` the kept copy is answered once the network has taken that long (the network's answer still refreshes the copy). */
function apiNetworkFirst(event, request, url, timeoutMs = 0) {
  const key = scoped(request, url);
  const network = fetch(request).then((response) => {
    if (response.ok) { const copy = response.clone(); return keep(key, copy).then(() => response, () => response); } // the copy is taken before the page reads the body
    return response;
  });
  event.waitUntil(network.catch(() => null)); // the copy is written even when the kept one was answered first
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    const timer = timeoutMs ? setTimeout(() => { keptCopy(key).then((copy) => { if (copy) finish(copy); }); }, timeoutMs) : null;
    network.then((r) => { clearTimeout(timer); finish(r); }, async (err) => {
      clearTimeout(timer);
      if (done) return;
      const copy = await keptCopy(key);
      if (copy) finish(copy); else { done = true; reject(err); }
    });
  });
}

/** The kept copy at once, the network behind it; when the fresh answer differs, the open pages are told so they draw it. */
async function apiStaleWhileRevalidate(event, request, url) {
  const key = scoped(request, url);
  const hit = await keptCopy(key);
  const before = hit ? hit.clone().text() : Promise.resolve(null); // read before the page reads the copy it is given
  const network = fetch(request).then(async (response) => {
    if (!response.ok) return response;
    const forCache = response.clone();
    const forCompare = response.clone();
    const [fresh, old] = await Promise.all([forCompare.text(), before]);
    await keep(key, forCache);
    if (hit && fresh !== old) {
      for (const client of await self.clients.matchAll({ type: 'window' })) client.postMessage({ type: 'API_UPDATED', path: url.pathname });
    }
    return response;
  });
  event.waitUntil(network.catch(() => null));
  if (hit) return hit;
  return network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    const marked = request.headers.get('x-erp-sw') === 'p16604';
    if (marked && SWR.some((re) => re.test(url.pathname))) event.respondWith(apiStaleWhileRevalidate(event, request, url));
    else if (OFFLINE_OK.some((re) => re.test(url.pathname))) event.respondWith(apiNetworkFirst(event, request, url, marked ? TIMEOUT_MS : 0));
    else if (marked && FIELD_OK.some((re) => re.test(url.pathname))) event.respondWith(apiNetworkFirst(event, request, url, TIMEOUT_MS));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.match('/index.html', { ignoreVary: true })) ?? Response.error()));
    return;
  }
  if (url.pathname === '/sw.js') return;
  // ignoreVary: the server varies on Origin, which a script tag sends and the precache request did not
  event.respondWith(caches.match(request, { ignoreVary: true }).then((hit) => hit ?? fetch(request).then((response) => {
    if (response.ok && /^\/(assets|icons)\//.test(url.pathname)) {
      const copy = response.clone();
      event.waitUntil(caches.open(SHELL).then((cache) => cache.put(request, copy)));
    }
    return response;
  })));
});

self.addEventListener('push', (event) => {
  let data;
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title ?? 'Construction ERP', {
    body: data.body ?? '', tag: data.tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/home' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? '/home';
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = open.find((c) => new URL(c.url).origin === self.location.origin);
    if (same) { await same.focus(); same.postMessage({ type: 'NAVIGATE', url: target }); return; }
    await self.clients.openWindow(target);
  })());
});
