import { recordSecurityEvent } from '../audit/index.js';
import { authzOf } from '../authz/index.js';
import { securityOf } from '../security/index.js';

/**
 * The real-time layer (part 04.06). Rooms are named `user:<name>`, `project:<id>`, `site:<id>`, `dept:<id>`, `conv:<id>` and `record:<entity>:<id>`. A person joins a room only if they may
 * see what it carries (checked on joining and again for every event sent), and an event carries only the ids of what changed: the screen asks the permission-checked API for the rest
 * (BR-02). Every event is kept in a log with a number; a screen that lost its connection asks for what it missed since the last number it saw.
 *
 *   realtimeRecords.register('sample_doc', { resolve: (db, id) => ({ companyId, projectId, siteId }) | null, check: (db, actor, id) => boolean })
 */
const records = new Map();
export const realtimeRecords = { register(entity, def) { records.set(entity, def); }, get: (entity) => records.get(entity) ?? null, entities: () => [...records.keys()] };

/**
 * Conversation rooms (`conv:<id>`, part 05.01): only a member may join, and the module that owns conversations says who is a member.
 *   realtimeConversations.set({ resolve: (db, id) => ({ companyId }) | null, check: (db, actor, id) => boolean })
 */
let conversations = null;
export const realtimeConversations = { set(def) { conversations = def; }, get: () => conversations };

const hubs = new WeakMap();
export function realtimeOf(db) {
  let h = hubs.get(db);
  if (!h) { h = createHub(db); hubs.set(db, h); }
  return h;
}

const ROOM = /^(user|project|site|dept|conv|record):([A-Za-z0-9_.@:-]{1,100})$/;
export function parseRoom(room) {
  const m = ROOM.exec(String(room ?? ''));
  if (!m) return null;
  if (m[1] === 'record') { const i = m[2].indexOf(':'); return i > 0 ? { kind: 'record', entity: m[2].slice(0, i), id: m[2].slice(i + 1) } : null; }
  return { kind: m[1], id: m[2] };
}

function createHub(db) {
  const authz = authzOf(db);
  const guard = securityOf(db).rooms;
  let emitter = null;
  // the shared guard (02.07) holds the rooms of places: a project, a site, a department
  const place = (table, permission) => ({ permission, resolve: (d, id) => { const r = d.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id)); return r ? { companyId: r.company_id, projectId: table === 'org_projects' ? r.id : table === 'org_sites' ? r.org_project_id : null, siteId: table === 'org_sites' ? r.id : null } : null; } });
  if (!guard.kinds().includes('project')) guard.register('project', place('org_projects', 'org.view'));
  if (!guard.kinds().includes('site')) guard.register('site', place('org_sites', 'org.view'));
  if (!guard.kinds().includes('dept')) guard.register('dept', place('org_departments', 'org.view'));
  if (!guard.kinds().includes('conv')) guard.register('conv', { permission: 'org.view', resolve: () => null }); // conversations arrive with the collaboration part; until then no one may join one

  const refuse = (actor, room, why) => {
    try { recordSecurityEvent(db, { companyId: actor.companyId, userId: actor.userId ?? null, username: actor.user, type: 'socket.denied', severity: 'WARNING', details: { room, why } }); } catch { /* the log must never break a socket */ }
    return { allowed: false, reason: why };
  };
  /** May this person be in this room now? Never throws; a refusal is a security event. */
  function canJoin(actor, room) {
    const p = parseRoom(room);
    if (!p) return refuse(actor, room, 'That room does not exist.');
    if (p.kind === 'user') return p.id === actor.user ? { allowed: true } : refuse(actor, room, 'A personal room belongs to one person.');
    if (p.kind === 'record') {
      const def = records.get(p.entity);
      if (!def) return refuse(actor, room, 'There is no room for that kind of record.');
      const scope = def.resolve(db, p.id);
      if (!scope || scope.companyId !== actor.companyId) return refuse(actor, room, 'That record does not exist or is outside your scope.');
      return def.check(db, actor, p.id) ? { allowed: true } : refuse(actor, room, 'You may not see that record.');
    }
    if (p.kind === 'conv') {
      const scope = conversations?.resolve(db, p.id);
      if (!scope || scope.companyId !== actor.companyId) return refuse(actor, room, 'That conversation does not exist or you are not a member of it.');
      return conversations.check(db, actor, p.id) ? { allowed: true } : refuse(actor, room, 'You are not a member of that conversation.');
    }
    try { guard.join(actor, `${p.kind}:${p.id}`); return { allowed: true }; } catch (e) { return { allowed: false, reason: e.message }; }
  }
  /** The silent form of canJoin, for the check at each event. */
  function mayStay(actor, room) {
    const p = parseRoom(room);
    if (!p) return false;
    if (p.kind === 'user') return p.id === actor.user;
    if (p.kind === 'record') { const def = records.get(p.entity); const scope = def?.resolve(db, p.id); return Boolean(def && scope && scope.companyId === actor.companyId && def.check(db, actor, p.id)); }
    if (p.kind === 'conv') { const scope = conversations?.resolve(db, p.id); return Boolean(scope && scope.companyId === actor.companyId && conversations.check(db, actor, p.id)); }
    const def = ({ project: 'org_projects', site: 'org_sites', dept: 'org_departments' })[p.kind];
    if (!def) return false;
    const r = db.prepare(`SELECT * FROM ${def} WHERE id = ?`).get(Number(p.id));
    if (!r || r.company_id !== actor.companyId) return false;
    return authz.check(actor, 'org.view', { companyId: r.company_id, projectId: def === 'org_projects' ? r.id : def === 'org_sites' ? r.org_project_id : null, siteId: def === 'org_sites' ? r.id : null }).allowed;
  }

  const eventOf = (row) => ({ id: row.id, room: row.room, type: row.event_type, entity: row.entity, entityId: row.entity_id, data: JSON.parse(row.data_json || '{}'), at: row.occurred_at });
  /** Log an event for each room and send it to whoever is in the room. Returns the ids of the log rows. */
  function publish({ companyId, rooms, type, entity = null, entityId = null, data = {}, projectId = null, siteId = null }) {
    const ids = [];
    for (const room of rooms) {
      const id = Number(db.prepare('INSERT INTO ntf_realtime_events (company_id, room, event_type, entity, entity_id, data_json, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(companyId, room, type, entity, entityId == null ? null : String(entityId), JSON.stringify(data), projectId, siteId, 'system', 'realtime').lastInsertRowid);
      ids.push(id);
      const ev = eventOf({ id, room, event_type: type, entity, entity_id: entityId == null ? null : String(entityId), data_json: JSON.stringify(data), occurred_at: new Date().toISOString() });
      // sent after the transaction that made it has ended, so a rolled-back change is never announced
      if (emitter) queueMicrotask(() => { Promise.resolve(emitter({ companyId, room, event: ev })).catch(() => {}); });
    }
    return ids;
  }
  /** Send an event that is not kept in the log (typing, call signals): it reaches whoever is in the room now and is never replayed. */
  function emitTransient({ companyId, rooms, type, entity = null, entityId = null, data = {} }) {
    if (!emitter) return;
    for (const room of rooms) {
      const ev = { id: 0, room, type, entity, entityId: entityId == null ? null : String(entityId), data, at: new Date().toISOString(), transient: true };
      queueMicrotask(() => { Promise.resolve(emitter({ companyId, room, event: ev })).catch(() => {}); });
    }
  }
  /** What a person missed in a room since the last event number they saw (they may see it now). { events, gap, latest } */
  function replay(actor, room, since, limit = 500) {
    if (!mayStay(actor, room)) return { events: [], gap: false, latest: since };
    const rows = db.prepare('SELECT * FROM ntf_realtime_events WHERE company_id = ? AND room = ? AND id > ? ORDER BY id LIMIT ?').all(actor.companyId, room, since, limit + 1);
    const purged = db.prepare("SELECT MAX(CAST(json_extract(data_json, '$.upTo') AS INTEGER)) AS m FROM ntf_realtime_events WHERE room = '*purge'").get().m ?? 0;
    const latest = db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM ntf_realtime_events').get().m;
    return { events: rows.slice(0, limit).map(eventOf), gap: since < purged || rows.length > limit, latest };
  }
  /** Forget what is older than the hours kept; remember how far, so a screen that was away longer is told to load afresh. */
  function purge(hours) {
    const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();
    const top = db.prepare("SELECT MAX(id) AS m FROM ntf_realtime_events WHERE occurred_at < ? AND room != '*purge'").get(cutoff).m;
    if (!top) return { removed: 0 };
    const removed = Number(db.prepare("DELETE FROM ntf_realtime_events WHERE id <= ? AND room != '*purge'").run(top).changes);
    db.prepare("INSERT INTO ntf_realtime_events (company_id, room, event_type, data_json, created_by, source_type) VALUES ((SELECT COALESCE(MIN(id), 1) FROM org_companies), '*purge', 'purge', ?, 'system', 'realtime')").run(JSON.stringify({ upTo: top }));
    return { removed };
  }
  return { canJoin, mayStay, publish, emitTransient, replay, purge, parseRoom, setEmitter(fn) { emitter = fn; }, attached: () => Boolean(emitter) };
}
