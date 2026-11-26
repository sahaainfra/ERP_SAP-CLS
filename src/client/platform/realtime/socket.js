import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authHeaders } from '../api/index.js';

// The real-time connection of the browser (part 04.06, FR-01, FR-07): one socket per tab, rooms joined by the screens that need them, and, after a lost connection, a join that asks for
// what was missed since the last event number seen in that room. Events carry ids only; a screen refreshes its data through the API.
let socket = null;
let identityKey = '';
const rooms = new Map(); // room -> { count, since }
const handlers = new Set(); // (event) => void
const states = new Set();
let state = 'idle';
const setState = (s) => { state = s; for (const f of states) f(s); };

function join(room) {
  const r = rooms.get(room);
  if (!socket?.connected || !r) return;
  socket.emit('join', { room, ...(r.since == null ? {} : { since: r.since }) }, (ack) => {
    if (!ack?.ok) return;
    if (r.since == null || ack.gap) r.since = ack.latest ?? r.since ?? 0;
    // too much was missed (or the log no longer reaches back): the screens refetch everything they show
    if (ack.gap) for (const h of handlers) h({ type: 'gap', room });
  });
}

// The socket.io client is fetched with the first room a screen follows, not with the first download (part 166.4).
let ioLoad = null;
const loadIo = () => { ioLoad ??= import('socket.io-client').then((m) => m.io).catch((err) => { ioLoad = null; throw err; }); return ioLoad; };

function open(key) {
  loadIo().then((io) => {
    if (identityKey !== key || socket) return; // signed out or switched while the client was on its way
    socket = io({ transports: ['polling', 'websocket'], extraHeaders: authHeaders(), reconnectionAttempts: 8, reconnectionDelay: 1000, reconnectionDelayMax: 10_000 });
    // the access token is replaced every few minutes: a reconnection after a lost connection carries the current one, not the one of the first handshake
    socket.io.on('reconnect_attempt', () => { socket.io.opts.extraHeaders = authHeaders(); });
    socket.on('connect', () => { setState('online'); for (const room of rooms.keys()) join(room); });
    socket.on('disconnect', () => setState('offline'));
    socket.on('connect_error', () => setState('offline'));
    socket.on('event', (ev) => {
      const r = rooms.get(ev.room);
      if (r && (r.since == null || ev.id > r.since)) r.since = ev.id;
      for (const h of handlers) h(ev);
    });
  }, () => { if (identityKey === key) { identityKey = ''; setState('offline'); } });
}

/** Connect once the person is known; a different identity (a switch of the development user, a sign-out) makes a new connection. */
// who the connection is for: the headers without the access token (renewed every few minutes for the same person) and the caching mark
const identityOf = () => { const who = { ...authHeaders() }; const signedIn = Boolean(who.authorization); delete who.authorization; delete who['x-erp-sw']; return JSON.stringify({ ...who, signedIn }); };

export function ensureSocket() {
  const key = identityOf();
  if (key === identityKey) return;
  if (socket) { socket.close(); socket = null; }
  identityKey = key;
  setState('connecting');
  open(key);
}

export function closeSocket() { socket?.close(); socket = null; identityKey = ''; rooms.clear(); setState('idle'); }

/** Follow a room until the returned function is called. */
export function follow(room, handler) {
  ensureSocket();
  const r = rooms.get(room) ?? { count: 0, since: null };
  r.count += 1;
  rooms.set(room, r);
  handlers.add(handler);
  if (r.count === 1) join(room);
  return () => {
    handlers.delete(handler);
    const x = rooms.get(room);
    if (!x) return;
    x.count -= 1;
    if (x.count <= 0) { rooms.delete(room); if (socket?.connected && !room.startsWith('user:')) socket.emit('leave', { room }); }
  };
}

export const connectionState = () => state;
export function onConnectionState(fn) { states.add(fn); return () => states.delete(fn); }

/**
 * Keep what a screen shows in step: when something happens in one of the rooms, the data of the screen is fetched again (the affected rows change, nothing else flickers).
 * `rooms` is a list of room names; `keys` the query keys to refresh; changes within 400 ms become one refresh.
 */
export function useLiveRefresh(roomList, keys) {
  const qc = useQueryClient();
  const keyOf = JSON.stringify(roomList);
  const keysRef = useRef(keys);
  keysRef.current = keys;
  useEffect(() => {
    const mine = new Set(JSON.parse(keyOf));
    if (mine.size === 0) return undefined;
    let timer = null;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => { for (const k of keysRef.current) qc.invalidateQueries({ queryKey: k }); }, 400); };
    const handler = (ev) => { if (ev.type === 'gap' ? mine.has(ev.room) : mine.has(ev.room)) refresh(); };
    const offs = [...mine].map((room) => follow(room, handler));
    return () => { clearTimeout(timer); for (const off of offs) off(); };
  }, [keyOf, qc]);
}
