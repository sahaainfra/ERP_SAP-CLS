import { forbidden, notFound } from '../http/errors.js';
import { recordSecurityEvent } from '../audit/index.js';

/**
 * Real-time rooms (part 02.07, BR-02, FR-02). A socket may join a room only if its person may see what the room carries, and
 * every event sent into a room is checked again for each member, so a role taken away or a record moved out of scope stops the
 * stream at the next event, not at the next sign-in. The real-time server of part 04.06 uses this guard; until it exists the guard
 * is exercised with in-process members.
 *
 * A room is named "<kind>:<id>" (for example "project:12"). `register(kind, { permission, resolve })`: the permission needed and an
 * optional resolver that turns the id into the record's scope (company, project, site) for the permission engine.
 */
export function createRoomGuard({ db, authz }) {
  const kinds = new Map();
  const parse = (room) => {
    const m = /^([a-z_]+):([A-Za-z0-9_-]+)$/.exec(room ?? '');
    if (!m) throw notFound('That room does not exist.');
    return { kind: m[1], id: m[2] };
  };
  const refuse = (actor, room, why) => {
    try { recordSecurityEvent(db, { companyId: actor.companyId, userId: actor.userId ?? null, username: actor.user, type: 'socket.denied', severity: 'WARNING', details: { room, why } }); } catch { /* never stops the refusal */ }
    return forbidden(why);
  };
  /** May this person be in this room now? Returns { allowed, reason }. */
  function check(actor, room) {
    const { kind, id } = parse(room);
    const def = kinds.get(kind);
    if (!def) return { allowed: false, reason: `There is no room of kind ${kind}.` };
    const record = def.resolve ? def.resolve(db, id) : { companyId: actor.companyId };
    if (!record) return { allowed: false, reason: 'That room does not exist or is outside your scope.' };
    const r = authz.check(actor, def.permission, record);
    return r.allowed ? { allowed: true } : { allowed: false, reason: r.reason ?? `Your role does not include ${def.permission} for this room.` };
  }
  return {
    register(kind, def) { kinds.set(kind, def); },
    kinds: () => [...kinds.keys()],
    /** Join: the permission is checked now. Throws 403 (and logs a security event) when refused. */
    join(actor, room) {
      const r = check(actor, room);
      if (!r.allowed) throw refuse(actor, room, r.reason);
      return { joined: room };
    },
    /** Deliver an event to a room's members: each member's access is checked again, and a member who lost it is dropped. */
    deliver(room, event, members) {
      const delivered = [];
      const dropped = [];
      for (const m of members) {
        const r = check(m.actor, room);
        if (r.allowed) { m.send(event); delivered.push(m.actor.user); } else { dropped.push(m.actor.user); try { m.leave?.(room); } catch { /* the member is gone anyway */ } }
      }
      return { delivered, dropped };
    },
  };
}
