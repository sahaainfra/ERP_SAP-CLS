import { useEffect, useState } from 'react';
import { BREAKPOINTS, layoutFor } from '../../../shared/device/breakpoints.js';

/** 'phone' (under 768 px), 'tablet' (768 to 1023) or 'desktop' (1024 and up), following the window as it is resized or turned. */
export function useLayout() {
  const [layout, setLayout] = useState(() => (typeof window === 'undefined' ? 'desktop' : layoutFor(window.innerWidth)));
  useEffect(() => {
    const queries = [window.matchMedia(`(max-width: ${BREAKPOINTS.tablet - 1}px)`), window.matchMedia(`(max-width: ${BREAKPOINTS.laptop - 1}px)`)];
    const read = () => setLayout(layoutFor(window.innerWidth));
    read();
    queries.forEach((q) => q.addEventListener('change', read));
    return () => queries.forEach((q) => q.removeEventListener('change', read));
  }, []);
  return layout;
}

/** Whether the browser is online, following the browser's own online and offline events. */
export function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}
