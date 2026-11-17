// The browser side of sign-in (part 02.01). The access token lives in memory only (a script cannot read the refresh token,
// which is an HttpOnly cookie); a reload signs in again silently through that cookie. No React in this file.
import { createApiClient } from './client.js';

const store = { mode: 'dev-headers', access: null, user: null };
const listeners = new Set();
const emit = () => listeners.forEach((f) => f());

export const authMode = () => store.mode;
export const accessToken = () => store.access;
export const signedInUser = () => store.user;
export const onAuthChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Calls that need no token: they create one. `retries: 0` because a sign-in must never be repeated by itself. */
export const publicApi = createApiClient({ baseUrl: '/api/v1/iam', retries: 0 });

export function setSession(result) {
  store.access = result.accessToken;
  store.user = result.user;
  emit();
}
export function clearSession() {
  store.access = null;
  store.user = null;
  emit();
}

const lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage unavailable: the device is simply not remembered */
  }
};

/** This browser's identity for the server: a random ID kept on the device, a readable name, and the remembered-device token. */
export function deviceInfo() {
  let id = lsGet('erp.device.id');
  if (!id) {
    id = globalThis.crypto.randomUUID();
    lsSet('erp.device.id', id);
  }
  const ua = globalThis.navigator?.userAgent ?? '';
  const platform = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Browser';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return { deviceId: id, deviceName: `${browser} on ${platform}`, platform, deviceToken: lsGet('erp.device.token') ?? undefined };
}
export const rememberedDevice = () => ({ token: lsGet('erp.device.token'), user: lsGet('erp.device.user') });
export function rememberDevice(token, username) {
  lsSet('erp.device.token', token ?? null);
  lsSet('erp.device.user', token ? username : null);
}

export async function loadAuthConfig() {
  // a busy server (429) or a passing failure is asked again a few times before the default is taken; an answer without data is never returned
  // as the configuration (it stopped the first screen, part 166.4)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch('/api/v1/iam/auth/config');
      const body = await res.json().catch(() => null);
      if (res.ok && body?.data?.mode) {
        store.mode = body.data.mode;
        return body.data;
      }
      if (res.status !== 429 && res.status < 500) break;
    } catch { /* dropped: try again, unless the device is offline (the worker's kept copy answers when there is one) */ }
    if (globalThis.navigator?.onLine === false) break;
    await new Promise((resolve) => { setTimeout(resolve, 300 * 2 ** attempt); });
  }
  return { mode: store.mode ?? 'dev-headers' };
}

let inflight = null;
/** Get a new access token with the refresh cookie. One at a time in this tab, and one at a time across tabs, because each use replaces the cookie. */
export function refreshSession() {
  inflight ??= (async () => {
    const run = async () => {
      try {
        const out = await publicApi.post('/auth/refresh', {}, { headers: { 'x-erp-csrf': '1' } });
        setSession(out.data);
        return true;
      } catch {
        clearSession();
        return false;
      }
    };
    return globalThis.navigator?.locks ? globalThis.navigator.locks.request('erp-refresh', run) : run();
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Start the app: find out the mode, and in sign-in mode try to resume a session from the cookie (nobody signed in is a normal answer). */
export async function initAuth() {
  const config = await loadAuthConfig();
  if (config.mode === 'iam') {
    try {
      const out = await publicApi.post('/auth/resume', {}, { headers: { 'x-erp-csrf': '1' } });
      if (out.data.status === 'ok') setSession(out.data);
    } catch {
      clearSession();
    }
  }
  return config;
}

export async function signOut() {
  try {
    await publicApi.post('/auth/logout', {}, { headers: { 'x-erp-csrf': '1', ...(store.access ? { authorization: `Bearer ${store.access}` } : {}) } });
  } finally {
    clearSession();
  }
}
