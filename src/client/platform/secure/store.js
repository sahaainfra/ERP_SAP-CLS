// The device's own store for secure messaging (part 05.03): its private keys (non-extractable CryptoKeys), what it trusts about other people's keys, and the decrypted messages. It lives in the browser's IndexedDB and
// never leaves the device; the server keeps none of it. Without IndexedDB (a private window) it falls back to memory for the session, and the keys are then gone when the tab closes.
const NAME = 'erp-secure-v1';
const STORES = { keys: 'scope', trust: 'k', msgs: 'k' };
const memory = { keys: new Map(), trust: new Map(), msgs: new Map() };
let opening = null;

function open() {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    if (!globalThis.indexedDB) { resolve(null); return; }
    let req;
    try { req = globalThis.indexedDB.open(NAME, 1); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) if (!db.objectStoreNames.contains(name)) { const s = db.createObjectStore(name, { keyPath }); if (name === 'msgs') s.createIndex('conv', 'convKey'); }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return opening;
}
const wrap = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

export const store = {
  async get(name, key) { const db = await open(); if (!db) return memory[name].get(key); return wrap(db.transaction(name).objectStore(name).get(key)); },
  async put(name, value) { const db = await open(); if (!db) { memory[name].set(value[STORES[name]], value); return; } await wrap(db.transaction(name, 'readwrite').objectStore(name).put(value)); },
  async del(name, key) { const db = await open(); if (!db) { memory[name].delete(key); return; } await wrap(db.transaction(name, 'readwrite').objectStore(name).delete(key)); },
  async conversation(convKey) {
    const db = await open();
    if (!db) return [...memory.msgs.values()].filter((m) => m.convKey === convKey);
    return wrap(db.transaction('msgs').objectStore('msgs').index('conv').getAll(convKey));
  },
  async all(name) { const db = await open(); if (!db) return [...memory[name].values()]; return wrap(db.transaction(name).objectStore(name).getAll()); },
  /** Forgets everything of this person on this device (sign-out of secure messaging, or a device that was revoked). */
  async wipe(scope) {
    for (const name of Object.keys(STORES)) for (const v of await store.all(name)) if (String(v[STORES[name]]).startsWith(scope)) await store.del(name, v[STORES[name]]);
  },
};
