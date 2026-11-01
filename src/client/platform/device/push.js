import { api } from '../api/index.js';

// Web Push from the browser's side (part 03.06, FR-04): ask permission, subscribe through the service worker, tell the server. What to send and to
// whom is the notification service (04.06); here a person turns notifications on or off for this device and can send themselves a test.
const unwrap = async (p) => (await p).data;

/** base64url (the server's public key) to the bytes the push manager wants. */
export function keyBytes(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** iOS only allows push for an app that was added to the home screen. */
export const needsInstallForPush = () => /iPhone|iPad|iPod/.test(globalThis.navigator?.userAgent ?? '') && !globalThis.matchMedia?.('(display-mode: standalone)')?.matches && !globalThis.navigator?.standalone;

/** { supported, permission, subscribed } for this browser. */
export async function pushStatus() {
  if (!pushSupported()) return { supported: false, permission: 'unsupported', subscribed: false };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return { supported: true, permission: Notification.permission, subscribed: Boolean(sub) };
}

/** Turn notifications on for this device. Resolves the subscription the server stored; rejects with a message for the person. */
export async function subscribePush({ deviceLabel } = {}) {
  if (!pushSupported()) throw new Error('This browser cannot receive push notifications.');
  if (needsInstallForPush()) throw new Error('On an iPhone or iPad, add this app to the Home Screen first (Share, then Add to Home Screen), then turn notifications on from the app.');
  const settings = await unwrap(api.get('/ui/device-settings'));
  if (!settings.push.available) throw new Error('Notifications are not set up on this installation yet. Ask a system administrator.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications were not allowed. Allow them for this site in the browser settings.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(settings.push.publicKey) }));
  const json = sub.toJSON();
  return unwrap(api.post('/ui/push-subscriptions', { endpoint: json.endpoint, keys: json.keys, expirationTime: json.expirationTime ?? null, deviceLabel }, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } }));
}

/** Turn notifications off for this device. */
export async function unsubscribePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await api.delete('/ui/push-subscriptions', {}, { endpoint }).catch(() => null);
}

export const sendTestPush = () => unwrap(api.post('/ui/push/test', {}, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } }));
