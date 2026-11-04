import { Server } from 'socket.io';
import { log } from '../http/logger.js';
import { realtimeOf } from './index.js';

/**
 * The Socket.IO server (part 04.06, FR-01), attached to the HTTP server of the application. The handshake is authenticated like any request (the same session or token: the dev
 * headers, or a Bearer token in the headers or in `auth.token`); a person is put in their own room; they join other rooms by asking, and the hub checks each join and each event.
 * `since` on a join replays what the person missed in that room. With REDIS_URL the Redis adapter lets several servers share the rooms.
 *
 * client -> server: 'join' { room, since? } (ack { ok, replayed, gap, latest } or { ok: false, error }), 'leave' { room }
 * server -> client: 'event' { id, room, type, entity, entityId, data, at, replayed? }
 */
export function attachSocketServer({ server, db, config, authenticate, isOn }) {
  const hub = realtimeOf(db);
  const io = new Server(server, { serveClient: false, maxHttpBufferSize: 100_000, pingInterval: 25_000, pingTimeout: 20_000, transports: ['polling', 'websocket'] });
  io.use((socket, next) => {
    /** @type {any} */
    const req = socket.request;
    req.get = (h) => req.headers[String(h).toLowerCase()];
    const token = socket.handshake.auth?.token;
    if (token && !req.headers.authorization) req.headers.authorization = `Bearer ${token}`;
    authenticate(req, {}, (err) => {
      if (err) return next(new Error(err.message ?? 'Sign in first'));
      if (!req.actor?.companyId) return next(new Error('Choose a company first'));
      if (!isOn(req.actor)) return next(new Error('Real-time updates are not enabled for your company yet (feature flag ff.eng.p0406 is OFF).'));
      socket.data.actor = req.actor;
      next();
    });
  });
  io.on('connection', (socket) => {
    const actor = socket.data.actor;
    socket.join(`user:${actor.user}`);
    let joins = 0;
    const window = setInterval(() => { joins = 0; }, 60_000);
    window.unref?.();
    socket.on('disconnect', () => clearInterval(window));
    socket.on('join', (msg, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        joins += 1;
        if (joins > 120) return reply({ ok: false, error: 'Too many joins; slow down.' });
        const room = String(msg?.room ?? '');
        const verdict = hub.canJoin(actor, room);
        if (!verdict.allowed) return reply({ ok: false, error: verdict.reason ?? 'You may not join that room.' });
        socket.join(room);
        let replayed = 0;
        let gap = false;
        let latest = 0;
        if (Number.isInteger(msg?.since) && msg.since >= 0) {
          const r = hub.replay(actor, room, msg.since);
          for (const ev of r.events) { socket.emit('event', { ...ev, replayed: true }); replayed += 1; }
          gap = r.gap;
          latest = r.latest;
        }
        return reply({ ok: true, room, replayed, gap, latest });
      } catch (err) {
        log.warn({ msg: 'socket join failed', error: String(err?.message ?? err) });
        return reply({ ok: false, error: 'The room could not be joined.' });
      }
    });
    socket.on('leave', (msg, ack) => { socket.leave(String(msg?.room ?? '')); if (typeof ack === 'function') ack({ ok: true }); });
  });
  hub.setEmitter(async ({ companyId, room, event }) => {
    const sockets = await io.in(room).fetchSockets();
    for (const s of sockets) {
      const a = s.data?.actor;
      if (!a || a.companyId !== companyId) continue;
      if (!hub.mayStay(a, room)) { s.leave(room); continue; } // the person lost access: the stream stops at this event
      s.emit('event', event);
    }
  });
  const redisUrl = config.redisUrl ?? process.env.REDIS_URL;
  if (redisUrl) {
    (async () => {
      try {
        const { createClient } = await import('redis');
        const { createAdapter } = await import('@socket.io/redis-adapter');
        const pub = createClient({ url: redisUrl });
        const sub = pub.duplicate();
        await Promise.all([pub.connect(), sub.connect()]);
        io.adapter(createAdapter(pub, sub));
        log.info({ msg: 'real-time layer: Redis adapter in use' });
      } catch (err) { log.error({ msg: 'real-time layer: Redis adapter could not start; this server works alone', error: String(err?.message ?? err) }); }
    })();
  }
  const origClose = server.close.bind(server);
  // closing the server first ends the sockets, or the open connections would keep it from closing
  server.close = (cb) => { io.disconnectSockets(true); io.engine?.close(); return origClose(cb); };
  return io;
}
