import { useEffect } from 'react';
import { findRoute } from './registry.js';
import { preloadRoutes } from './lazyPage.js';

// Part 166.4, FR-01: once the home page is drawn and the browser is idle, fetch the code of the pages behind the person's bottom bar, so the next
// tap opens at once (and, through the service worker, also offline). Only with ff.perf.p16604 ON; never when the browser asks to save data.

const HOMES = ['/home', '/field'];

/** The routes of the bottom bar's pages as the navigation names them (the person's registry row, else Home, My Work, Scan, Messages). */
export function bottomBarPaths(nav) {
  if (!nav) return [];
  const first = (code) => nav.groups?.find((g) => g.code === code)?.pages?.[0]?.route;
  const named = nav.bottomBar?.length ? nav.bottomBar.map((b) => b.route).filter(Boolean) : [];
  const built = [...HOMES, '/field/scan', first('g-mywork'), first('g-messages')].filter(Boolean);
  return [...new Set([...named, ...built].map((p) => String(p).split('?')[0]))];
}

const saveData = () => Boolean(globalThis.navigator?.connection?.saveData);
const whenIdle = (fn) => {
  if (typeof globalThis.requestIdleCallback === 'function') { const id = globalThis.requestIdleCallback(fn, { timeout: 3000 }); return () => globalThis.cancelIdleCallback?.(id); }
  const id = setTimeout(fn, 1500);
  return () => clearTimeout(id);
};

/** usePrefetchBottomBar(nav, path, on): preloads once per page view of a home page. */
export function usePrefetchBottomBar(nav, path, on) {
  const atHome = HOMES.includes(String(path ?? '').split('?')[0]);
  useEffect(() => {
    if (!on || !nav || !atHome || saveData()) return undefined;
    return whenIdle(() => preloadRoutes(bottomBarPaths(nav).map(findRoute).filter(Boolean)));
  }, [on, nav, atHome]);
}
