import { useSyncExternalStore } from 'react';
import { api } from '../api/index.js';
import { compressImage, limitsFor } from '../device/camera.js';
import { DEFAULT_DEVICE_SETTINGS } from '../device/api.js';
import { syncQueue } from '../device/syncQueue.js';
import { destroyAll, openSecureStore, secureStoreSupported } from './secureStore.js';

// The offline engine of the browser (part 04.15). It keeps, in the encrypted store, the cached masters and form rules (FR-02, FR-04), the queue of commands made while offline (FR-03) and the photos
// that belong to them (FR-05); it sends them in order when a connection comes back, resumes interrupted photo uploads, and shows what became of each (FR-07). A revoked device wipes itself (BR-03).
const CHUNK = 256 * 1024;
const BATCH = 50;
const PLATFORM = typeof navigator === 'undefined' ? '' : (navigator.userAgent ?? '').slice(0, 80);
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* kept for this page view */ } };
const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');
const deviceId = () => { let d = lsGet('erp.offline.device'); if (!d) { d = `dev-${uid()}`; lsSet('erp.offline.device', d); } return d; };

/** @type {any} */
let state = {
  ready: false, supported: secureStoreSupported(), user: null, online: typeof navigator === 'undefined' ? true : navigator.onLine, syncing: false, queue: [], lastSync: null, lastAttempt: null, lastError: null,
  driftMs: 0, driftWarning: null, device: null, revoked: false, wiped: false, forms: [], masters: {}, mastersAt: null, expiresAt: null, locked: false, settings: { maxAgeDays: 7 },
};
const listeners = new Set();
const set = (patch) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
let store = null;
let timer = null;
let running = null;

export const offlineState = () => state;
export const subscribeOffline = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const useOffline = () => useSyncExternalStore(subscribeOffline, offlineState);

/** Still to reach the server: a record not yet accepted, or an accepted one with a photo still to send (a refused photo is only shown). */
export const isUnsent = (c) => c.status !== 'APPLIED' || (c.files ?? []).some((f) => !f.error);
/** Waiting to be sent: what the next sync sends by itself (new and deferred records, and the photos of accepted ones). A refused record, a
 *  conflict or one waiting for a supervisor waits for a person instead. */
export const isWaiting = (c) => c.status === 'PENDING' || c.status === 'DEFERRED' || (c.status === 'APPLIED' && isUnsent(c));
// the device queue (Field home) shows what has not reached the server: not an accepted record whose only photo left was refused
const mirror = (queue) => { const unsent = queue.filter(isUnsent); for (const q of syncQueue.list().filter((x) => x.source === 'offline')) if (!unsent.some((c) => c.id === q.id)) syncQueue.dequeue(q.id); for (const c of unsent) syncQueue.enqueue({ id: c.id, label: c.label ?? c.type, source: 'offline' }); };
const persistQueue = async (queue) => { set({ queue }); mirror(queue); if (store) await store.put('meta', 'queue', queue); };
const errorOf = (e) => ({ status: e?.status ?? 0, code: e?.code ?? (e?.status ? 'ERROR' : 'NETWORK'), message: e?.message ?? 'The server could not be reached.' });

// ---- offline validation with the cached rules (FR-04); the server checks again ----
const MONEY = /^\d{1,13}(\.\d{1,2})?$/;
export function validateForm(form, values) {
  const errors = [];
  const rules = form?.rules ?? {};
  for (const f of form?.fields ?? []) {
    const v = values[f.key];
    const empty = v === undefined || v === null || String(v).trim() === '';
    if (f.required && empty) { errors.push({ field: f.key, message: `${f.label}: this is required.` }); continue; }
    if (empty) continue;
    const min = rules[`${f.key}Min`]; const max = rules[`${f.key}Max`] ?? f.max;
    if (f.type === 'text' && ((typeof min === 'number' && String(v).trim().length < min) || (max && String(v).length > max))) errors.push({ field: f.key, message: `${f.label}: give ${min ?? 1} to ${max ?? 200} characters.` });
    if (f.type === 'money' && (!MONEY.test(String(v)) || Number(v) <= 0)) errors.push({ field: f.key, message: `${f.label}: write a number above zero with at most two decimals.` });
  }
  return errors;
}

// ---- masters and rules (FR-02) ----
async function loadLocal() {
  const [queue, meta, masters, forms] = await Promise.all([store.get('meta', 'queue'), store.get('meta', 'state'), store.get('meta', 'masters'), store.get('meta', 'forms')]);
  const expired = meta?.expiresAt && Date.parse(meta.expiresAt) < Date.now();
  set({ queue: queue ?? [], lastSync: meta?.lastSync ?? null, mastersAt: meta?.mastersAt ?? null, expiresAt: meta?.expiresAt ?? null, settings: meta?.settings ?? state.settings,
    masters: expired ? {} : (masters ?? {}), forms: expired ? [] : (forms ?? []), locked: Boolean(expired) });
  mirror(queue ?? []);
}
const saveMeta = (extra = {}) => store.put('meta', 'state', { lastSync: state.lastSync, mastersAt: state.mastersAt, expiresAt: state.expiresAt, settings: state.settings, ...extra });

export async function refreshMasters() {
  if (!store || !state.online || state.revoked) return false;
  try {
    const full = !state.mastersAt || state.locked;
    const r = (await api.get(`/off/masters${full ? '' : `?since=${encodeURIComponent(state.mastersAt)}`}`)).data;
    const merged = full ? {} : { ...state.masters };
    for (const [code, m] of Object.entries(r.masters)) {
      const byId = new Map((full ? [] : (merged[code] ?? [])).map((x) => [String(x.id), x]));
      for (const id of m.removed ?? []) byId.delete(String(id));
      for (const row of m.rows) byId.set(String(row.id), row);
      merged[code] = [...byId.values()];
    }
    await store.put('meta', 'masters', merged);
    await store.put('meta', 'forms', r.forms);
    set({ masters: merged, forms: r.forms, mastersAt: r.serverTime, expiresAt: r.expiresAt, settings: r.settings ?? state.settings, locked: false });
    await saveMeta();
    return true;
  } catch (e) {
    return handleFailure(e);
  }
}

// ---- the device ----
async function registerDevice() {
  if (state.device || !state.online || state.revoked) return;
  try {
    const d = (await api.post('/off/devices', { deviceId: deviceId(), name: (PLATFORM.includes('Mobile') ? 'Phone' : 'Computer'), platform: PLATFORM }, { headers: { 'idempotency-key': uid() } })).data;
    set({ device: d });
  } catch (e) { await handleFailure(e); }
}

/** BR-03: the server says this device was revoked. Everything local is removed and the engine stops. */
export async function wipe(reason = 'revoked') {
  try { await store?.destroy(); } catch { /* the database is deleted below anyway */ }
  await destroyAll();
  store = null;
  clearInterval(timer);
  for (const q of syncQueue.list().filter((x) => x.source === 'offline')) syncQueue.dequeue(q.id);
  set({ ready: false, queue: [], masters: {}, forms: [], mastersAt: null, expiresAt: null, lastSync: null, device: null, revoked: reason === 'revoked', wiped: true, user: null, locked: false });
  if (reason === 'revoked') {
    try { await api.post('/off/devices/wiped', { deviceId: deviceId() }, { headers: { 'idempotency-key': uid() } }); } catch { /* told at the next contact */ }
  }
}
async function handleFailure(e) {
  const err = errorOf(e);
  const wipeNow = e?.details?.some?.((d) => d.wipe) || err.code === 'DEVICE_REVOKED';
  if (wipeNow) { await wipe('revoked'); return false; }
  if (err.code === 'DEVICE_UNKNOWN') { set({ device: null }); await registerDevice(); }
  set({ lastError: err });
  return false;
}

// ---- the queue (FR-03) ----
/**
 * Queue a command. `values` are checked with the cached rules first; the photos are made smaller and kept encrypted until they are sent.
 * Returns the stored command. Throws { errors } when the rules refuse it.
 */
export async function enqueue({ type, op = 'create', values, ref, entityId, baseVersion, baseValues, label, photos = [] }) {
  if (!store) throw new Error('The offline store is not ready.');
  const form = state.forms.find((f) => f.code === type);
  if (state.locked) throw Object.assign(new Error('The offline copy has expired. Connect once to refresh it.'), { errors: [] });
  if (!form || form.available === false) throw Object.assign(new Error('This form is not available to you.'), { errors: [] });
  const errors = validateForm(form, values);
  if (errors.length) throw Object.assign(new Error(errors.map((e) => e.message).join(' ')), { errors });
  const id = uid();
  const seq = (await store.get('meta', 'seq') ?? 0) + 1;
  await store.put('meta', 'seq', seq);
  let gps = null;
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' });
    if (perm?.state === 'granted') {
      gps = await new Promise((resolve) => navigator.geolocation.getCurrentPosition((p) => resolve({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)), accuracy: Math.round(p.coords.accuracy) }), () => resolve(null), { timeout: 4000, maximumAge: 60_000 }));
    }
  } catch { gps = null; }
  const files = [];
  for (const [i, file] of photos.entries()) {
    const small = await compressImage(file, limitsFor(DEFAULT_DEVICE_SETTINGS, false)).catch(() => ({ blob: file, name: file.name }));
    await store.putBytes('media', `${id}:${i}`, new Uint8Array(await small.blob.arrayBuffer()));
    files.push({ index: i, name: small.name ?? file.name, size: small.blob.size, mime: small.blob.type });
  }
  const cmd = { id, seq, type, op, values, ref: op === 'update' ? ref : undefined, clientRef: op === 'create' ? (ref ?? `ref-${id}`) : undefined, entityId, baseVersion, baseValues, label: label ?? type,
    createdAt: new Date().toISOString(), gps: gps ?? undefined, files, status: 'PENDING', attempts: 0, error: null };
  await persistQueue([...state.queue, cmd]);
  if (state.online) sync().catch(() => {});
  return cmd;
}
export async function discard(id) {
  const c = state.queue.find((x) => x.id === id);
  if (!c) return;
  for (const f of c.files ?? []) await store.remove('media', `${id}:${f.index}`);
  await persistQueue(state.queue.filter((x) => x.id !== id));
}
export async function retry(id) {
  // a record the server already accepted (APPLIED) is never sent again; only its waiting photos are, by the sync itself
  await persistQueue(state.queue.map((c) => (c.id === id && c.status !== 'APPLIED' ? { ...c, status: 'PENDING', error: null } : c)));
  // a run already under way took its copy before this tap: let it finish, then send again. The record is PENDING now, so a plain sync
  // sends it (and not every other refused record on the device)
  if (running) await running.catch(() => {});
  return sync();
}

// ---- sending (FR-03, FR-05, FR-07) ----
async function sendPhotos(cmd) {
  const left = [];
  for (const f of cmd.files ?? []) {
    const bytes = await store.getBytes('media', `${cmd.id}:${f.index}`);
    // a photo the server refused has no bytes left: it stays on the record with its error until the person dismisses it
    if (!bytes) { if (f.error) left.push(f); continue; }
    try {
      let up = (await api.post('/off/uploads', { deviceId: deviceId(), commandId: cmd.id, fileName: f.name, totalSize: bytes.length, chunkSize: CHUNK }, { headers: { 'idempotency-key': uid() } })).data;
      if (up.status !== 'COMPLETE') {
        for (let i = 0; i < up.totalChunks; i += 1) {
          if (up.received.includes(i)) continue;
          const part = bytes.subarray(i * CHUNK, Math.min(bytes.length, (i + 1) * CHUNK));
          up = (await api.request('PUT', `/off/uploads/${up.uploadId}/chunks/${i}`, part, { headers: { 'content-type': 'application/octet-stream', 'idempotency-key': uid() }, raw: true })).data;
        }
        up = (await api.post(`/off/uploads/${up.uploadId}/complete`, {}, { headers: { 'idempotency-key': uid() } })).data;
      }
      await store.remove('media', `${cmd.id}:${f.index}`);
    } catch (e) {
      const err = errorOf(e);
      if (err.code === 'DEVICE_REVOKED' || e?.details?.some?.((d) => d.wipe)) { await handleFailure(e); return null; }
      if (err.status >= 400 && err.status < 500 && err.status !== 409 && err.status !== 429) { left.push({ ...f, error: err.message }); await store.remove('media', `${cmd.id}:${f.index}`); } else left.push(f);
      set({ lastError: err });
    }
  }
  return left;
}

/** Send what is waiting. Safe to call at any time; one run at a time. */
export function sync({ force = false } = {}) {
  if (running) return running;
  running = (async () => {
    if (!store || !state.online || state.revoked) return { sent: 0 };
    set({ syncing: true, lastAttempt: new Date().toISOString() });
    try {
      await registerDevice();
      if (state.revoked || !store) return { sent: 0 };
      let queue = [...state.queue];
      const taken = new Map(queue.map((c) => [c.id, c])); // the commands this run works on; anything queued or discarded meanwhile is left as it is
      const waiting = queue.filter((c) => c.status === 'PENDING' || c.status === 'DEFERRED' || (force && c.status === 'ERROR'));
      const tried = new Set(waiting.map((c) => c.id));
      const photosTried = new Set(); // commands whose photos this run has already sent (or tried to)
      let sent = 0;
      let failed = false;
      for (let i = 0; i < waiting.length; i += BATCH) {
        const batch = waiting.slice(i, i + BATCH);
        const body = { deviceId: deviceId(), deviceTime: new Date().toISOString(), commands: batch.map(({ id, seq, type, op, ref, clientRef, entityId, values, baseVersion, baseValues, createdAt, gps, label }) => ({ id, seq, type, op, ref, clientRef, entityId, values, baseVersion, baseValues, createdAt, gps, label })) };
        let res;
        try { res = (await api.post('/off/sync', body)).data; } catch (e) { await handleFailure(e); if (!store) return { sent }; failed = true; queue = queue.map((c) => (batch.some((b) => b.id === c.id) ? { ...c, attempts: c.attempts + 1 } : c)); break; }
        for (const r of res.results) {
          const c = queue.find((x) => x.id === r.commandId);
          if (!c) continue;
          const next = { ...c, attempts: c.attempts + 1, logId: r.logId, entityId: r.entityId ?? c.entityId, error: r.error ?? null };
          if (r.status === 'APPLIED' || r.status === 'RESOLVED') {
            sent += 1;
            photosTried.add(c.id);
            const left = await sendPhotos(next);
            if (left === null) return { sent };
            queue = left.length ? queue.map((x) => (x.id === c.id ? { ...next, status: 'APPLIED', files: left } : x)) : queue.filter((x) => x.id !== c.id);
          } else queue = queue.map((x) => (x.id === c.id ? { ...next, status: r.status === 'REJECTED' ? 'ERROR' : r.status } : x));
        }
        set({ driftMs: res.driftMs, driftWarning: res.driftWarning });
      }
      // photos of records that were saved earlier but whose photos did not all get through
      // (not those this run has just tried: a second try at once would drop the error a refused photo carries)
      for (const c of queue.filter((x) => x.status === 'APPLIED' && x.files?.length && !photosTried.has(x.id))) {
        const left = await sendPhotos(c);
        if (left === null) return { sent };
        queue = left.length ? queue.map((x) => (x.id === c.id ? { ...c, files: left } : x)) : queue.filter((x) => x.id !== c.id);
      }
      // merge into the queue as it is now: a command queued while this run was sending stays, one discarded meanwhile does not come back,
      // and one this run did not send but that changed meanwhile (a Try again) keeps its new state
      const outcome = new Map(queue.map((c) => [c.id, c]));
      const changedMeanwhile = (c) => taken.get(c.id) !== c && !tried.has(c.id);
      await persistQueue(state.queue.filter((c) => !taken.has(c.id) || outcome.has(c.id) || changedMeanwhile(c)).map((c) => (changedMeanwhile(c) ? c : (outcome.get(c.id) ?? c))));
      // a failed send is not a sync: the error handleFailure recorded stays on screen
      if (!failed) set({ lastSync: new Date().toISOString(), lastError: null });
      await saveMeta();
      return { sent };
    } finally {
      set({ syncing: false });
      running = null;
    }
  })();
  return running;
}

// ---- starting and stopping ----
const onOnline = () => { set({ online: true }); sync().catch(() => {}); refreshMasters().catch(() => {}); };
const onOffline = () => set({ online: false });
let wired = false;
/** Start the engine for a signed-in person. Without IndexedDB and WebCrypto it stays off and says so. */
export async function startOffline(user) {
  if (!user || !secureStoreSupported()) { set({ supported: secureStoreSupported() }); return; }
  if (state.user === user && store) return;
  if (store && state.user !== user) { store = null; }
  store = await openSecureStore(user);
  set({ user, ready: true, revoked: false, wiped: false, online: navigator.onLine });
  await loadLocal();
  if (!wired) { window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline); wired = true; }
  clearInterval(timer);
  timer = setInterval(() => { if (state.online && state.queue.some(isWaiting)) sync().catch(() => {}); }, 30_000);
  if (state.online) { await registerDevice(); await refreshMasters(); await sync().catch(() => {}); }
}
/** Sign-out: the local copy goes with the session. Called by the sign-out action after the person has seen how much is unsent. */
export const wipeOnSignOut = () => wipe('sign-out');
export const unsentCount = () => state.queue.filter(isUnsent).length;
export const deviceKey = deviceId;

/** A command that was settled on the server (a conflict resolved, an old command confirmed) leaves the local queue. */
export async function settle(commandId) {
  if (!store) return;
  const c = state.queue.find((x) => x.id === commandId);
  if (c) await discard(commandId);
}
