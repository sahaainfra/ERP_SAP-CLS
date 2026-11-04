// The encrypted local store of the offline engine (part 04.15, FR-01). IndexedDB holds records encrypted with AES-GCM (WebCrypto). The key is made on this browser for one person, is not extractable
// (a script can use it but never read it), and is kept beside the data it protects, so the data is useless once the key is gone: signing out, a remote revoke or `destroy()` delete the whole database.
// Another person who signs in on the same browser has a key of their own and cannot read these records. Nothing here needs React.
const DB_NAME = 'erp-offline';
const DB_VERSION = 1;
const enc = new TextEncoder();
const dec = new TextDecoder();

const request = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('keys', { keyPath: 'scope' });
        r.result.createObjectStore('records', { keyPath: 'id' });
      };
      r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); dbPromise = null; }; resolve(r.result); };
      r.onerror = () => { dbPromise = null; reject(r.error); };
    });
  }
  return dbPromise;
}

export const secureStoreSupported = () => typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && Boolean(crypto.subtle);

/** Delete the whole local database (sign-out, revoke). Resolves when it is gone. */
export async function destroyAll() {
  try { (await dbPromise)?.close(); } catch { /* not open */ }
  dbPromise = null;
  await new Promise((resolve) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = () => resolve();
    r.onerror = () => resolve();
    r.onblocked = () => resolve();
  });
}

/** The store of one person. `scope` is their username (the data is namespaced by it and encrypted with a key of its own). */
export async function openSecureStore(scope) {
  const db = await openDb();
  const tx = (stores, mode) => db.transaction(stores, mode);
  let key = (await request(tx('keys', 'readonly').objectStore('keys').get(scope)))?.key;
  if (!key) {
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await request(tx('keys', 'readwrite').objectStore('keys').put({ scope, key, createdAt: new Date().toISOString() }));
  }
  const idOf = (store, k) => `${scope}|${store}|${k}`;
  const seal = async (bytes) => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return { iv, data: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes) };
  };
  const open = async (rec) => new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, key, rec.data));
  const api = {
    scope,
    async putBytes(store, k, bytes, meta = {}) {
      const sealed = await seal(bytes);
      await request(tx('records', 'readwrite').objectStore('records').put({ id: idOf(store, k), scope, store, key: k, ...sealed, meta, at: Date.now() }));
    },
    async getBytes(store, k) {
      const rec = await request(tx('records', 'readonly').objectStore('records').get(idOf(store, k)));
      return rec ? open(rec) : null;
    },
    async put(store, k, value) { await api.putBytes(store, k, enc.encode(JSON.stringify(value))); },
    async get(store, k) {
      const bytes = await api.getBytes(store, k);
      return bytes ? JSON.parse(dec.decode(bytes)) : null;
    },
    async all(store) {
      const recs = await request(tx('records', 'readonly').objectStore('records').getAll());
      const mine = recs.filter((r) => r.scope === scope && r.store === store).sort((a, b) => a.at - b.at);
      return Promise.all(mine.map(async (r) => ({ key: r.key, value: JSON.parse(dec.decode(await open(r))) })));
    },
    async remove(store, k) { await request(tx('records', 'readwrite').objectStore('records').delete(idOf(store, k))); },
    /** Everything of this person, and their key. */
    async destroy() {
      const recs = await request(tx('records', 'readonly').objectStore('records').getAll());
      const t = tx(['records', 'keys'], 'readwrite');
      for (const r of recs.filter((x) => x.scope === scope)) t.objectStore('records').delete(r.id);
      t.objectStore('keys').delete(scope);
      await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); });
    },
    /** Raw view for tests and diagnostics: how many records exist and whether any holds readable text. */
    async rawCount() { return (await request(tx('records', 'readonly').objectStore('records').count())); },
  };
  return api;
}
