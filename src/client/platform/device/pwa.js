import { useSyncExternalStore } from 'react';
import { flushDrafts } from '../forms/useDraft.js';

// The installable app (part 03.06, FR-03): registering the service worker, noticing that a newer version of the app is waiting, offering the
// browser's install prompt (Chrome and Edge), and telling iPhone users how to add the app to the Home Screen (Safari has no prompt).
const DISMISSED_KEY = 'erp.pwa.install-dismissed';
export const API_UPDATED_EVENT = 'erp:api-updated';
const DISMISS_DAYS = 14;

let state = { installEvent: null, updateReady: false, applying: false, saveDraftsFirst: false, registered: false, standalone: false, ios: false, dismissed: false };
const listeners = new Set();
const set = (patch) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
let registration = null;
let reloading = false;

const isStandalone = () => Boolean(globalThis.matchMedia?.('(display-mode: standalone)')?.matches || globalThis.navigator?.standalone);
// an iPad can present itself as a Mac, with a touch screen
const isIos = () => /iPhone|iPad|iPod/.test(globalThis.navigator?.userAgent ?? '') || (globalThis.navigator?.platform === 'MacIntel' && (globalThis.navigator?.maxTouchPoints ?? 0) > 1);

export function installDismissed(now = Date.now()) {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY));
    return Boolean(at) && now - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

export const pwa = {
  state: () => state,
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /** Register the worker (only where it can run: a secure address and a browser with service workers). Safe to call more than once. */
  async register({ url = '/sw.js' } = {}) {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || state.registered) return null;
    set({ standalone: isStandalone(), ios: isIos(), dismissed: installDismissed() });
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); set({ installEvent: e }); });
    window.addEventListener('appinstalled', () => set({ installEvent: null, standalone: true }));
    // a notification that was touched while the app is open asks the page to go where the notification points
    navigator.serviceWorker.addEventListener('message', (e) => {
      // part 166.4: a call answered from the kept copy has a fresher answer now (the menu); the shell fetches it again
      if (e.data?.type === 'API_UPDATED' && typeof e.data.path === 'string') window.dispatchEvent(new CustomEvent(API_UPDATED_EVENT, { detail: { path: e.data.path } }));
      if (e.data?.type === 'NAVIGATE' && typeof e.data.url === 'string' && e.data.url.startsWith('/') && !e.data.url.startsWith('//')) {
        window.history.pushState(null, '', e.data.url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading && (state.updateReady || state.applying)) { reloading = true; window.location.reload(); } });
    try {
      registration = await navigator.serviceWorker.register(url);
    } catch {
      return null;
    }
    // a browser or policy that blocks service workers may resolve without a registration: the application then runs without offline support, without an error
    if (!registration) return null;
    set({ registered: true });
    const watch = (reg) => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) set({ updateReady: true }); });
    };
    if (registration.waiting && navigator.serviceWorker.controller) set({ updateReady: true });
    registration.addEventListener('updatefound', () => watch(registration));
    const check = () => registration.update().catch(() => null);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 60 * 60 * 1000);
    return registration;
  },

  /** Check for a newer version now. */
  update: () => registration?.update().catch(() => null),

  /** ff.perf.p16604 (part 166.4, FR-04): save the open drafts before reloading into a new version. The shell sets it from the flag. */
  configure({ saveDraftsFirst }) { if (Boolean(saveDraftsFirst) !== state.saveDraftsFirst) set({ saveDraftsFirst: Boolean(saveDraftsFirst) }); },

  /** Switch to the waiting version; the page reloads by itself once it has taken over. With the flag, the open drafts are saved first. */
  async applyUpdate() {
    if (state.applying) return;
    set({ applying: true });
    if (state.saveDraftsFirst) await flushDrafts();
    const waiting = registration?.waiting;
    if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
    else window.location.reload();
  },

  /** Show the browser's install prompt. Resolves 'accepted', 'dismissed' or 'unavailable'. */
  async install() {
    const e = state.installEvent;
    if (!e) return 'unavailable';
    e.prompt();
    const choice = await e.userChoice;
    set({ installEvent: null });
    return choice.outcome;
  },

  /** Not now: do not ask again for a while. */
  dismissInstall() {
    try { localStorage.setItem(DISMISSED_KEY, String(Date.now())); } catch { /* asked again next time */ }
    set({ dismissed: true });
  },

  /** Forget the copies of data the worker kept for offline use (on sign-out or when another person takes over the device). */
  clearApiCache() {
    navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_API' });
  },
};

export const usePwa = () => useSyncExternalStore(pwa.subscribe, pwa.state);
