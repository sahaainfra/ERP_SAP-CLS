import { useEffect, useRef } from 'react';
import { findRoute } from '../shell/registry.js';
import { fetchRedirects } from './api.js';

// Old addresses (part 03.10, FR-04): a bookmark, a link in an e-mail or a printed QR code that names an address which is no page of the application any
// more is sent to the page that replaced it (the tracker's "old address"), keeping the query string and the part after #. The address the browser
// arrived at is read once, when the script loads, before the shell replaces an unknown address by Home.
const arrival = typeof window === 'undefined' ? null : { path: window.location.pathname.replace(/(.)\/+$/, '$1'), search: window.location.search, hash: window.location.hash };
const stray = () => Boolean(arrival && arrival.path !== '/' && !findRoute(arrival.path) && arrival.path !== '/accept-invite');

/** The address to go to for an old one, or null. `list` is [{ from, to }]. */
export const redirectFor = (list, at) => {
  const hit = list.find((r) => r.from === at.path);
  return hit ? `${hit.to}${at.search}${at.hash}` : null;
};

/** Once the person is known and the tracker is on, follow the redirect of the address they arrived at; `go` takes the new address. */
export function useLegacyRedirect({ ready, go }) {
  const pending = useRef(stray() ? arrival : null);
  useEffect(() => {
    if (!ready || !pending.current) return;
    const at = pending.current;
    pending.current = null;
    fetchRedirects().then((list) => { const to = redirectFor(list, at); if (to) go(to); }).catch(() => {});
  }, [ready, go]);
}
