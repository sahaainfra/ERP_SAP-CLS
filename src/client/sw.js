// The service worker (part 03.06, FR-03). `vite build` fills in the build id and the list of files of this version (scripts/ vite.config.js).
//
// - The app shell (page, scripts, styles, fonts, icons) is cached when this version installs, so the app opens with no connection.
// - Pages are network-first: a fresh page when online, the cached shell when not. Scripts and styles carry their content hash, so they are cache-first.
// - API calls are network-first. Only a short list of GET calls that draw the shell (session, menu, launchpad, settings) keep a copy for offline
//   use, keyed by the person (header x-erp-cache-scope), so a shared device never shows one person's data to another; the copies are dropped on
//   sign-out. Nothing else is stored: business data is not kept in the browser's cache, and nothing but a GET is ever answered from it.
// - A new version waits until the person agrees (the page shows "A new version is ready") and then takes over.
// - A push message is shown as a notification; touching it opens the page it names.

const BUILD_ID = '__BUILD_ID__';
const PRECACHE = '__PRECACHE__';
const SHELL = `erp-shell-${BUILD_ID}`;
const API = 'erp-api-v1';
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

async function apiNetworkFirst(event, request, url) {
  const key = scoped(request, url);
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone(); // taken before the page starts reading the body
      event.waitUntil(caches.open(API).then((cache) => cache.put(key, copy)));
    }
    return response;
  } catch (err) {
    const copy = await (await caches.open(API)).match(key, { ignoreVary: true });
    if (copy) return copy;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (OFFLINE_OK.some((re) => re.test(url.pathname))) event.respondWith(apiNetworkFirst(event, request, url));
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
