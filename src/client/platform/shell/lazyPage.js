import { lazy } from 'react';

// Route-level code splitting (part 166.4, FR-01). A module's registry keeps its routes (path, label, permission, flag, icon) in the first download and
// names each page with lazyPage(() => import('./XPage.jsx')): the page's code is fetched the first time the page is drawn, or earlier by preload()
// (the shell preloads the pages of the person's bottom bar once the home page is idle). The shell draws a skeleton while the code arrives (RoutePage).

/** Errors of a script that could not be fetched: after a release the old file is gone, or the network dropped. */
export const isChunkError = (err) => /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch|ChunkLoadError|Unable to preload/i.test(String(err?.message ?? err));

/**
 * lazyPage(load, name = 'default') -> a component that loads its code on first use, with .preload() and .lazyPage = true.
 * `name` picks a named export when one file holds several pages. A failed fetch is not remembered, so a second try fetches again.
 */
export function lazyPage(load, name = 'default') {
  let pending = null;
  const preload = () => {
    pending ??= load().then((m) => {
      if (!m || !(name in m)) throw new Error(`The page "${name}" is not exported by its file`);
      return { default: m[name] };
    }).catch((err) => { pending = null; throw err; });
    return pending;
  };
  const Page = lazy(preload);
  Object.assign(Page, { preload, lazyPage: true, displayName: `Lazy(${name})` });
  return Page;
}

/** Fetch the code of these routes' pages in the background; a failure is ignored (the page fetches again when it is opened). */
export function preloadRoutes(routes) {
  for (const r of routes) if (typeof r?.Page?.preload === 'function') r.Page.preload().catch(() => null);
}
