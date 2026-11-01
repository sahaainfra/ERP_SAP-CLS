import { useSyncExternalStore } from 'react';

// The queue of things done on this device that have not reached the server yet (part 03.06, Field Home). The offline engine (04.15) fills and
// drains it when it exists; until then nothing queues and the count is honestly zero. Kept in this browser, so it survives a reload.
const KEY = 'erp.sync.queue';
const listeners = new Set();

const read = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
let cache = read();
const write = (items) => {
  cache = items;
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* the queue lasts for this page view */ }
  listeners.forEach((l) => l());
};

export const syncQueue = {
  list: () => cache,
  count: () => cache.length,
  /** Add an item: { id, label, at } (the offline engine decides what an item holds). */
  enqueue(item) {
    if (!item?.id || cache.some((x) => x.id === item.id)) return;
    write([...cache, { at: new Date().toISOString(), ...item }]);
  },
  dequeue: (id) => write(cache.filter((x) => x.id !== id)),
  clear: () => write([]),
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  /** Re-read the browser's copy (another tab may have changed it). */
  refresh() { write(read()); },
};

if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === KEY) syncQueue.refresh(); });

export const useSyncQueue = () => useSyncExternalStore(syncQueue.subscribe, syncQueue.list);
