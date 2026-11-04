import { createHmac, randomBytes } from 'node:crypto';
import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { realtimeOf } from '../../platform/realtime/index.js';
import { activeConfig } from './config.js';

// The features of a conversation that go beyond writing (part 05.02): presence and typing, delivery and read receipts, search, stars and pins, delete for me, the media gallery, legal hold, and voice and video calls.
// Everything starts from the conversation service of 05.01 (`base.internals.must`): a person who is not a member gets nothing, and what was said while they were out of a conversation is never shown to them.
export const PRESENCE_ONLINE_SECONDS = 60;
export const PRESENCE_AWAY_SECONDS = 300;
export const RING_SECONDS = 45;
export const MAX_SIGNAL_BYTES = 32 * 1024;
const nowIso = () => new Date().toISOString();
const excerpt = (s, n = 140) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const escLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const URL_RE = /https?:\/\/[^\s<>"']+/g;

export function createFeatureService({ db, base }) {
  const notif = notificationsOf(db);
  const hub = realtimeOf(db);
  const { must, convRow, mayManage, nameOf, person, anywhere, gapsOf, systemMessage, touchUsers } = base.internals;
  const userSettings = (companyId, user) => {
    const r = db.prepare('SELECT * FROM msg_user_settings WHERE company_id = ? AND user_ref = ?').get(companyId, user);
    return { showLastSeen: (r?.show_last_seen ?? 1) === 1, shareReadReceipts: (r?.share_read_receipts ?? 1) === 1, showOnline: (r?.show_online ?? 1) === 1 };
  };

  // ---- a person's privacy and presence (FR-01, BR-01) ----
  const me = {
    get: (actor) => ({ ...userSettings(actor.companyId, actor.user), enforcedReceipts: activeConfig(db, actor.companyId).enforceReadReceipts }),
    set(actor, b) {
      const cur = userSettings(actor.companyId, actor.user);
      const next = { ...cur, ...b };
      db.prepare(`INSERT INTO msg_user_settings (company_id, user_ref, show_last_seen, share_read_receipts, show_online, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'msg_settings')
        ON CONFLICT (company_id, user_ref) DO UPDATE SET show_last_seen = excluded.show_last_seen, share_read_receipts = excluded.share_read_receipts, show_online = excluded.show_online, updated_at = ?, version = version + 1`)
        .run(actor.companyId, actor.user, next.showLastSeen ? 1 : 0, next.shareReadReceipts ? 1 : 0, next.showOnline ? 1 : 0, actor.user, nowIso());
      writeAudit(db, { entity: 'msg_user_settings', entityId: actor.user, action: 'update', oldValues: cur, newValues: next, actor: actor.user, companyId: actor.companyId });
      return me.get(actor);
    },
  };
  const presence = {
    heartbeat(actor, { status = 'ONLINE' } = {}) {
      db.prepare(`INSERT INTO msg_presence (company_id, user_ref, status, last_seen_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'msg_presence')
        ON CONFLICT (company_id, user_ref) DO UPDATE SET status = excluded.status, last_seen_at = excluded.last_seen_at`).run(actor.companyId, actor.user, status, nowIso(), actor.user);
      return { status };
    },
    /** Presence of people the asker shares a conversation with; what a person hides stays hidden. */
    get(actor, users) {
      const out = [];
      for (const u of [...new Set(users)].slice(0, 60)) {
        const shares = db.prepare('SELECT 1 FROM msg_members a JOIN msg_members b ON b.conversation_id = a.conversation_id AND b.left_at IS NULL WHERE a.user_ref = ? AND a.left_at IS NULL AND b.user_ref = ? AND a.company_id = ? LIMIT 1').get(actor.user, u, actor.companyId);
        if (!shares && u !== actor.user) continue;
        const p = db.prepare('SELECT status, last_seen_at FROM msg_presence WHERE company_id = ? AND user_ref = ?').get(actor.companyId, u);
        const s = userSettings(actor.companyId, u);
        const age = p ? (Date.now() - Date.parse(p.last_seen_at)) / 1000 : Infinity;
        let state = !p || age > PRESENCE_AWAY_SECONDS ? 'OFFLINE' : age > PRESENCE_ONLINE_SECONDS || p.status === 'AWAY' ? 'AWAY' : 'ONLINE';
        if (!s.showOnline && u !== actor.user) state = 'OFFLINE';
        out.push({ ...person(actor.companyId, u), state, lastSeen: p && s.showLastSeen && state === 'OFFLINE' ? p.last_seen_at : null, lastSeenHidden: Boolean(p) && !s.showLastSeen && state === 'OFFLINE' });
      }
      return out;
    },
  };
  function typing(actor, id) {
    const c = must(actor, id);
    if (c.conv_type === 'EXTERNAL') throw unprocessable('Nobody types in a gateway thread.');
    hub.emitTransient({ companyId: actor.companyId, rooms: [`conv:${c.id}`], type: 'msg.typing', entity: 'msg_conversation', entityId: c.id, data: { conversationId: c.id, user: actor.user, name: nameOf(actor.companyId, actor.user) } });
    return { ok: true };
  }

  // ---- receipts (FR-02, BR-01) ----
  const receipts = {
    /** The recipient's phone has the messages up to this one: the sender sees "delivered". */
    delivered(actor, id, { upTo }) {
      const c = must(actor, id);
      if (c.conv_type === 'EXTERNAL') return { upTo: 0 };
      const top = upTo ?? c.last_message_id ?? 0;
      const at = nowIso();
      const r = db.prepare(`INSERT OR IGNORE INTO msg_receipts (company_id, message_id, user_ref, delivered_at, created_by, source_type)
        SELECT company_id, id, ?, ?, ?, 'msg_receipt' FROM msg_messages WHERE conversation_id = ? AND id <= ? AND sender_ref != ? AND kind != 'SYSTEM' AND status = 'ACTIVE'
          AND id > COALESCE((SELECT MAX(rc.message_id) FROM msg_receipts rc JOIN msg_messages mm ON mm.id = rc.message_id WHERE rc.user_ref = ? AND mm.conversation_id = ?), 0)`).run(actor.user, at, actor.user, c.id, top, actor.user, actor.user, c.id);
      if (Number(r.changes) > 0) hub.publish({ companyId: actor.companyId, rooms: [`conv:${c.id}`], type: 'msg.receipt.updated', entity: 'msg_conversation', entityId: c.id, data: { conversationId: c.id, user: actor.user, upTo: top, state: 'delivered' } });
      return { upTo: top, marked: Number(r.changes) };
    },
    /** Who has had this message and who has read it, and when (the sender, or an administrator of the conversation). */
    of(actor, messageId) {
      const m = db.prepare('SELECT * FROM msg_messages WHERE id = ? AND company_id = ? AND is_active = 1').get(messageId, actor.companyId);
      const c = m && convRow(m.conversation_id);
      if (!m) throw notFound('That message does not exist.');
      must(actor, c.id);
      if (m.sender_ref !== actor.user && !mayManage(actor, c)) throw forbidden('Only the sender, or an administrator of the conversation, sees who read a message.');
      const cfg = activeConfig(db, actor.companyId);
      const iShare = cfg.enforceReadReceipts || userSettings(actor.companyId, actor.user).shareReadReceipts;
      const rows = db.prepare('SELECT user_ref FROM msg_members WHERE conversation_id = ? AND left_at IS NULL AND is_active = 1 AND user_ref != ? ORDER BY user_ref').all(c.id, m.sender_ref).map((r) => {
        const rc = db.prepare('SELECT delivered_at, read_at FROM msg_receipts WHERE message_id = ? AND user_ref = ?').get(m.id, r.user_ref);
        const theyShare = cfg.enforceReadReceipts || userSettings(actor.companyId, r.user_ref).shareReadReceipts;
        return { ...person(actor.companyId, r.user_ref), deliveredAt: rc?.delivered_at ?? null, readAt: rc?.read_at && iShare && theyShare ? rc.read_at : null, readHidden: Boolean(rc?.read_at) && !(iShare && theyShare) };
      });
      return { messageId: m.id, recipients: rows, delivered: rows.filter((r) => r.deliveredAt).length, read: rows.filter((r) => r.readAt).length, total: rows.length, enforced: cfg.enforceReadReceipts };
    },
  };

  // ---- search (FR-03, T-02) ----
  const search = {
    run(actor, q) {
      const mine = db.prepare("SELECT c.id, c.title, c.conv_type, c.direct_key FROM msg_members m JOIN msg_conversations c ON c.id = m.conversation_id WHERE m.company_id = ? AND m.user_ref = ? AND m.left_at IS NULL AND m.is_active = 1 AND c.is_active = 1 AND c.conv_type != 'EXTERNAL'").all(actor.companyId, actor.user);
      const ids = q.conversationId ? mine.filter((c) => c.id === q.conversationId).map((c) => c.id) : mine.map((c) => c.id);
      if (!ids.length) return { rows: [], total: 0 };
      const where = [`m.conversation_id IN (${ids.map(() => '?').join(',')})`, "m.status = 'ACTIVE'", "m.kind != 'SYSTEM'", 'm.is_active = 1', 'NOT EXISTS (SELECT 1 FROM msg_hidden h WHERE h.message_id = m.id AND h.user_ref = ? AND h.is_active = 1)'];
      const args = [...ids, actor.user];
      if (q.q) { where.push("m.body LIKE ? ESCAPE '\\'"); args.push(`%${escLike(q.q)}%`); }
      if (q.sender) { where.push('lower(m.sender_ref) = lower(?)'); args.push(q.sender); }
      if (q.from) { where.push('m.created_at >= ?'); args.push(`${q.from}T00:00:00.000Z`); }
      if (q.to) { where.push('m.created_at <= ?'); args.push(`${q.to}T23:59:59.999Z`); }
      if (q.kind === 'images') where.push("EXISTS (SELECT 1 FROM json_each(m.attachments_json) j JOIN core_files f ON f.id = j.value WHERE f.category = 'image')");
      else if (q.kind === 'files') where.push("m.attachments_json != '[]'");
      else if (q.kind === 'voice') where.push("m.kind = 'VOICE'");
      else if (q.kind === 'links') where.push("(m.body LIKE '%http://%' OR m.body LIKE '%https://%' OR m.record_links_json != '[]')");
      if (!q.q && !q.kind && !q.sender && !q.from && !q.to) throw unprocessable('Write what to look for, or choose a sender, a date or a kind of message.', [{ field: 'q', message: 'is empty' }]);
      const gaps = new Map(ids.map((id) => [id, gapsOf(id, actor.user)]));
      const out = [];
      let skipped = 0;
      for (const m of db.prepare(`SELECT m.* FROM msg_messages m WHERE ${where.join(' AND ')} ORDER BY m.id DESC LIMIT 600`).all(...args)) {
        if ((gaps.get(m.conversation_id) ?? []).some(([a, b]) => m.created_at >= a && m.created_at < b)) continue; // said while they were out
        if (skipped < q.offset) { skipped += 1; continue; }
        const conv = mine.find((c) => c.id === m.conversation_id);
        out.push({ messageId: m.id, conversationId: m.conversation_id, conversation: conv.conv_type === 'DIRECT' ? nameOf(actor.companyId, conv.direct_key.split('|').find((u) => u !== actor.user) ?? actor.user) : conv.title,
          sender: person(actor.companyId, m.sender_ref), at: m.created_at, kind: m.kind, snippet: snippetOf(m.body, q.q), files: JSON.parse(m.attachments_json).length, links: JSON.parse(m.record_links_json).length });
        if (out.length >= q.limit) break;
      }
      return { rows: out, total: out.length };
    },
  };
  const snippetOf = (body, q) => {
    const t = String(body ?? '').replace(/\s+/g, ' ');
    if (!q) return excerpt(t, 140);
    const i = t.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return excerpt(t, 140);
    const a = Math.max(0, i - 40);
    return `${a > 0 ? '…' : ''}${t.slice(a, i + q.length + 80)}${i + q.length + 80 < t.length ? '…' : ''}`;
  };

  // ---- stars, pins, delete for me (FR-04, FR-05) ----
  const messageOf = (actor, id) => {
    const m = db.prepare('SELECT * FROM msg_messages WHERE id = ? AND company_id = ? AND is_active = 1').get(id, actor.companyId);
    const c = m && convRow(m.conversation_id);
    if (!m) throw notFound('That message does not exist.');
    must(actor, c.id);
    if (gapsOf(c.id, actor.user).some(([a, b]) => m.created_at >= a && m.created_at < b)) throw notFound('That message does not exist.');
    return { m, c };
  };
  const marks = {
    star(actor, id, { on }) {
      const { m } = messageOf(actor, id);
      if (m.status === 'DELETED') throw unprocessable('A deleted message cannot be starred.');
      if (on) db.prepare("INSERT OR IGNORE INTO msg_stars (company_id, message_id, user_ref, created_by, source_type) VALUES (?, ?, ?, ?, 'msg_star')").run(actor.companyId, m.id, actor.user, actor.user);
      else db.prepare('DELETE FROM msg_stars WHERE message_id = ? AND user_ref = ?').run(m.id, actor.user);
      return { id: m.id, starred: Boolean(on) };
    },
    starred(actor, { limit = 50, offset = 0 }) {
      const rows = db.prepare(`SELECT m.*, s.starred_at FROM msg_stars s JOIN msg_messages m ON m.id = s.message_id JOIN msg_members mem ON mem.conversation_id = m.conversation_id AND mem.user_ref = s.user_ref AND mem.left_at IS NULL
        WHERE s.user_ref = ? AND s.company_id = ? AND s.is_active = 1 AND m.status = 'ACTIVE' ORDER BY s.id DESC LIMIT 300`).all(actor.user, actor.companyId);
      const vis = rows.filter((m) => !gapsOf(m.conversation_id, actor.user).some(([a, b]) => m.created_at >= a && m.created_at < b));
      return { rows: vis.slice(offset, offset + limit).map((m) => { const c = convRow(m.conversation_id); return { messageId: m.id, conversationId: m.conversation_id, conversation: c.conv_type === 'DIRECT' ? nameOf(actor.companyId, c.direct_key.split('|').find((u) => u !== actor.user) ?? actor.user) : c.title, sender: person(actor.companyId, m.sender_ref), at: m.created_at, starredAt: m.starred_at, snippet: excerpt(m.body, 160), files: JSON.parse(m.attachments_json).length }; }), total: vis.length };
    },
    pin(actor, id, { on }) {
      const { m, c } = messageOf(actor, id);
      if (c.conv_type === 'EXTERNAL') throw unprocessable('Messages of a gateway thread cannot be pinned.');
      if (c.conv_type !== 'DIRECT' && !mayManage(actor, c)) throw forbidden('Only an administrator of the conversation can pin a message.');
      if (m.status === 'DELETED') throw unprocessable('A deleted message cannot be pinned.');
      if (on) {
        if (db.prepare('SELECT COUNT(*) AS n FROM msg_pins WHERE conversation_id = ? AND is_active = 1').get(c.id).n >= 5 && !db.prepare('SELECT 1 FROM msg_pins WHERE message_id = ?').get(m.id)) throw unprocessable('At most 5 messages can be pinned in a conversation. Unpin one first.');
        db.prepare("INSERT OR IGNORE INTO msg_pins (company_id, conversation_id, message_id, pinned_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'msg_pin')").run(actor.companyId, c.id, m.id, actor.user, actor.user);
      } else db.prepare('DELETE FROM msg_pins WHERE conversation_id = ? AND message_id = ?').run(c.id, m.id);
      writeAudit(db, { entity: 'msg_pins', entityId: m.id, action: on ? 'pin' : 'unpin', newValues: { conversation: c.id }, actor: actor.user, companyId: actor.companyId });
      hub.publish({ companyId: actor.companyId, rooms: [`conv:${c.id}`], type: 'msg.message.updated', entity: 'msg_message', entityId: m.id, data: { conversationId: c.id, messageId: m.id } });
      return { id: m.id, pinned: Boolean(on) };
    },
    pins(actor, id) {
      const c = must(actor, id);
      const rows = db.prepare("SELECT m.* FROM msg_pins p JOIN msg_messages m ON m.id = p.message_id WHERE p.conversation_id = ? AND p.is_active = 1 AND m.status = 'ACTIVE' ORDER BY p.id DESC").all(c.id);
      return { rows: rows.map((m) => ({ messageId: m.id, sender: person(actor.companyId, m.sender_ref), at: m.created_at, text: excerpt(m.body, 160), files: JSON.parse(m.attachments_json).length })) };
    },
    /** "Delete for me": the message stays for everybody else. */
    hide(actor, id) {
      const { m } = messageOf(actor, id);
      db.prepare("INSERT OR IGNORE INTO msg_hidden (company_id, message_id, user_ref, created_by, source_type) VALUES (?, ?, ?, ?, 'msg_hidden')").run(actor.companyId, m.id, actor.user, actor.user);
      db.prepare('DELETE FROM msg_stars WHERE message_id = ? AND user_ref = ?').run(m.id, actor.user);
      return { id: m.id, hidden: true };
    },
  };

  // ---- the media gallery (FR-06) ----
  const gallery = {
    media(actor, id, { kind = 'photos', limit = 60, offset = 0 }) {
      const c = must(actor, id);
      if (c.conv_type === 'EXTERNAL') return { rows: [], total: 0 };
      const gaps = gapsOf(c.id, actor.user);
      const rows = db.prepare("SELECT * FROM msg_messages WHERE conversation_id = ? AND status = 'ACTIVE' AND kind != 'SYSTEM' AND is_active = 1 AND id NOT IN (SELECT message_id FROM msg_hidden WHERE user_ref = ? AND is_active = 1) ORDER BY id DESC LIMIT 800").all(c.id, actor.user)
        .filter((m) => !gaps.some(([a, b]) => m.created_at >= a && m.created_at < b));
      const files = new Map();
      const fileIds = [...new Set(rows.flatMap((m) => JSON.parse(m.attachments_json)))];
      if (fileIds.length) for (const f of db.prepare(`SELECT id, original_name, size_bytes, mime, category, scan_status FROM core_files WHERE id IN (${fileIds.map(() => '?').join(',')}) AND company_id = ? AND is_active = 1`).all(...fileIds, actor.companyId)) files.set(f.id, f);
      const items = [];
      for (const m of rows) {
        const base2 = { messageId: m.id, sender: person(actor.companyId, m.sender_ref), at: m.created_at };
        if (kind === 'links') {
          for (const u of m.body.match(URL_RE) ?? []) items.push({ ...base2, url: u.replace(/[.,;)]+$/, '') });
        } else {
          for (const fid of JSON.parse(m.attachments_json)) {
            const f = files.get(fid);
            if (!f) continue;
            const photo = f.category === 'image' || f.category === 'video';
            if ((kind === 'photos') === photo) items.push({ ...base2, file: { id: f.id, name: f.original_name, size: f.size_bytes, mime: f.mime, category: f.category, scan: f.scan_status } });
          }
        }
      }
      return { rows: items.slice(offset, offset + limit), total: items.length, kind };
    },
  };

  // ---- legal hold (FR-09) ----
  const holds = {
    place(actor, id, { reason }) {
      if (!anywhere(actor, 'msg.legal_hold.manage')) throw forbidden('You may not place a legal hold (permission msg.legal_hold.manage).');
      const c = convRow(Number(id));
      if (!c || c.company_id !== actor.companyId) throw notFound('That conversation does not exist.');
      if (db.prepare('SELECT 1 FROM msg_holds WHERE conversation_id = ? AND released_at IS NULL AND is_active = 1').get(c.id)) throw conflict('This conversation is already under legal hold.');
      const hid = Number(db.prepare("INSERT INTO msg_holds (company_id, conversation_id, reason, created_by, source_type) VALUES (?, ?, ?, ?, 'msg_hold')").run(actor.companyId, c.id, reason, actor.user).lastInsertRowid);
      writeAudit(db, { entity: 'msg_holds', entityId: hid, action: 'place', newValues: { conversation: c.id }, reason, actor: actor.user, companyId: actor.companyId });
      publishEvent(db, { type: 'msg.hold.placed', entity: 'msg_conversation', entityId: c.id, actorId: actor.user, companyId: actor.companyId, data: { holdId: hid } });
      return holds.list(actor, { conversationId: c.id }).rows[0];
    },
    release(actor, id, { reason }) {
      if (!anywhere(actor, 'msg.legal_hold.manage')) throw forbidden('You may not release a legal hold (permission msg.legal_hold.manage).');
      const h = db.prepare('SELECT * FROM msg_holds WHERE id = ? AND company_id = ? AND is_active = 1').get(Number(id), actor.companyId);
      if (!h) throw notFound('That hold does not exist.');
      if (h.released_at) throw conflict('This hold was already released.');
      if (h.created_by === actor.user) throw forbidden('A hold is released by someone other than the person who placed it.');
      db.prepare('UPDATE msg_holds SET released_at = ?, released_by = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, nowIso(), actor.user, h.id);
      writeAudit(db, { entity: 'msg_holds', entityId: h.id, action: 'release', reason, actor: actor.user, companyId: actor.companyId });
      return { id: h.id, released: true };
    },
    /** @param {any} actor @param {{ conversationId?: number }} [o] */
    list(actor, { conversationId } = {}) {
      if (!anywhere(actor, 'msg.legal_hold.manage') && !anywhere(actor, 'msg.settings.view')) throw forbidden('You may not see legal holds (permission msg.legal_hold.manage).');
      const rows = db.prepare(`SELECT h.*, c.title, c.conv_type FROM msg_holds h JOIN msg_conversations c ON c.id = h.conversation_id WHERE h.company_id = ? AND h.is_active = 1 ${conversationId ? 'AND h.conversation_id = ?' : ''} ORDER BY h.id DESC LIMIT 200`).all(...[actor.companyId, ...(conversationId ? [conversationId] : [])]);
      return { rows: rows.map((h) => ({ id: h.id, conversationId: h.conversation_id, title: h.title || h.conv_type, reason: h.reason, placedBy: h.created_by, placedAt: h.created_at, releasedAt: h.released_at, releasedBy: h.released_by, active: !h.released_at })) };
    },
  };

  // ---- calls (FR-08, BR-02) ----
  const callView = (c, actor) => ({
    id: c.id, conversationId: c.conversation_id, type: c.call_type, status: c.status, startedBy: person(actor.companyId, c.initiated_by), startedAt: c.started_at, answeredAt: c.answered_at, endedAt: c.ended_at,
    durationSeconds: c.answered_at && c.ended_at ? Math.round((Date.parse(c.ended_at) - Date.parse(c.answered_at)) / 1000) : null, provider: c.provider,
    participants: JSON.parse(c.participants_json).map((u) => person(actor.companyId, u)), invited: JSON.parse(c.invited_json).map((u) => person(actor.companyId, u)),
  });
  const callRow = (actor, id) => {
    const c = db.prepare('SELECT * FROM msg_calls WHERE id = ? AND company_id = ? AND is_active = 1').get(Number(id), actor.companyId);
    if (!c) throw notFound('That call does not exist.');
    return c;
  };
  const kindName = (t) => (t === 'VIDEO' ? 'video' : 'voice');
  function expireRinging(companyId) {
    const cutoff = new Date(Date.now() - RING_SECONDS * 1000).toISOString();
    for (const c of db.prepare("SELECT * FROM msg_calls WHERE company_id = ? AND status = 'RINGING' AND started_at < ? AND is_active = 1").all(companyId, cutoff)) {
      db.prepare("UPDATE msg_calls SET status = 'MISSED', ended_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), nowIso(), c.id);
      const conv = convRow(c.conversation_id);
      if (conv) {
        systemMessage(conv, { user: c.initiated_by, companyId }, `Missed ${kindName(c.call_type)} call from ${nameOf(companyId, c.initiated_by)}`);
        for (const u of JSON.parse(c.invited_json).filter((x) => !JSON.parse(c.participants_json).includes(x))) {
          notif.notify({ companyId, templateCode: 'msg.call.missed', recipients: [`user:${u}`], data: { caller: nameOf(companyId, c.initiated_by), conversation: conv.title || 'a conversation', type: kindName(c.call_type) }, link: `/collab/messages?c=${conv.id}`, sourceType: 'msg_call', sourceId: String(c.id), eventKey: `call:${c.id}:missed:${u}` });
        }
        hub.emitTransient({ companyId, rooms: [`conv:${conv.id}`, ...JSON.parse(c.invited_json).map((u) => `user:${u}`)], type: 'msg.call.state', entity: 'msg_call', entityId: c.id, data: { callId: c.id, status: 'MISSED' } });
      }
    }
  }
  /** The servers a browser uses to connect a call: the company's STUN servers, and TURN with a password that works for an hour (the scheme of coturn's REST API). */
  function iceServers(actor) {
    const cfg = activeConfig(db, actor.companyId);
    const list = [];
    if (cfg.stunUrls.length) list.push({ urls: cfg.stunUrls });
    if (cfg.turnUrls.length && cfg.turnSecret) {
      const username = `${Math.floor(Date.now() / 1000) + cfg.turnTtlSeconds}:${actor.user}`;
      list.push({ urls: cfg.turnUrls, username, credential: createHmac('sha1', cfg.turnSecret).update(username).digest('base64') });
    }
    return list;
  }
  const calls = {
    start(actor, id, { type }) {
      const c = must(actor, id);
      const cfg = activeConfig(db, actor.companyId);
      if (!cfg.callsEnabled) throw unprocessable('Calls are switched off for your company.');
      if (c.conv_type === 'EXTERNAL') throw unprocessable('Calls cannot be started in a gateway thread.');
      if (c.is_archived) throw unprocessable('This conversation is archived.');
      expireRinging(actor.companyId);
      if (db.prepare("SELECT 1 FROM msg_calls WHERE conversation_id = ? AND status IN ('RINGING', 'ACTIVE') AND is_active = 1").get(c.id)) throw conflict('There is a call going on in this conversation. Join it instead.');
      const members = db.prepare('SELECT user_ref FROM msg_members WHERE conversation_id = ? AND left_at IS NULL AND is_active = 1').all(c.id).map((r) => r.user_ref);
      if (members.length > 12) throw unprocessable('Calls are for conversations of up to 12 people. Make a smaller group for the call.');
      if (members.length < 2) throw unprocessable('There is nobody else in this conversation to call.');
      return transaction(db, () => {
        const room = randomBytes(9).toString('hex');
        const invited = members.filter((u) => u !== actor.user);
        const id2 = Number(db.prepare("INSERT INTO msg_calls (company_id, conversation_id, initiated_by, call_type, provider, provider_room_id, participants_json, invited_json, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'msg_call')")
          .run(actor.companyId, c.id, actor.user, type, cfg.callProvider, room, JSON.stringify([actor.user]), JSON.stringify(invited), c.project_id, c.site_id, actor.user).lastInsertRowid);
        systemMessage(c, actor, `${nameOf(actor.companyId, actor.user)} started a ${kindName(type)} call`);
        writeAudit(db, { entity: 'msg_calls', entityId: id2, action: 'start', newValues: { conversation: c.id, type, provider: cfg.callProvider }, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'msg.call.started', entity: 'msg_call', entityId: id2, actorId: actor.user, companyId: actor.companyId, projectId: c.project_id ?? undefined, data: { conversationId: c.id, type } });
        hub.emitTransient({ companyId: actor.companyId, rooms: invited.map((u) => `user:${u}`), type: 'msg.call.ringing', entity: 'msg_call', entityId: id2, data: { callId: id2, conversationId: c.id, type, from: actor.user, name: nameOf(actor.companyId, actor.user) } });
        for (const u of invited) notif.notify({ companyId: actor.companyId, templateCode: 'msg.call', recipients: [`user:${u}`], data: { caller: nameOf(actor.companyId, actor.user), conversation: c.title || nameOf(actor.companyId, actor.user), type: kindName(type) }, link: `/collab/call?call=${id2}`, priority: 'HIGH', sourceType: 'msg_call', sourceId: String(id2), eventKey: `call:${id2}:ring:${u}`, actor: actor.user });
        return calls.join(actor, id2);
      });
    },
    /** Take part in a call (the person who started it, or anyone invited). Returns what the browser needs to connect. */
    join(actor, callId) {
      expireRinging(actor.companyId);
      const c = callRow(actor, callId);
      if (['ENDED', 'MISSED', 'DECLINED'].includes(c.status)) throw unprocessable(`This call is ${c.status === 'ENDED' ? 'over' : c.status.toLowerCase()}.`);
      const conv = must(actor, c.conversation_id);
      const parts = JSON.parse(c.participants_json);
      const cfg = activeConfig(db, actor.companyId);
      if (!parts.includes(actor.user)) {
        if (!JSON.parse(c.invited_json).includes(actor.user)) throw forbidden('You were not invited to this call.');
        if (parts.length >= cfg.maxCallParticipants) throw unprocessable(`A call can have at most ${cfg.maxCallParticipants} people at once.`);
        parts.push(actor.user);
        db.prepare("UPDATE msg_calls SET participants_json = ?, status = 'ACTIVE', answered_at = COALESCE(answered_at, ?), updated_at = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(parts), nowIso(), nowIso(), c.id);
        writeAudit(db, { entity: 'msg_calls', entityId: c.id, action: 'join', actor: actor.user, companyId: actor.companyId });
        hub.emitTransient({ companyId: actor.companyId, rooms: [`conv:${conv.id}`, ...parts.map((u) => `user:${u}`)], type: 'msg.call.state', entity: 'msg_call', entityId: c.id, data: { callId: c.id, status: 'ACTIVE', participants: parts, joined: actor.user } });
      }
      const fresh = callRow(actor, c.id);
      return { call: callView(fresh, actor), peers: parts.filter((u) => u !== actor.user), iceServers: fresh.provider === 'WEBRTC' ? iceServers(actor) : [], joinUrl: fresh.provider === 'EXTERNAL' ? `${cfg.providerBaseUrl.replace(/\/$/, '')}/erp-${fresh.provider_room_id}` : null, recording: 'OFF', maxParticipants: cfg.maxCallParticipants };
    },
    decline(actor, callId) {
      const c = callRow(actor, callId);
      must(actor, c.conversation_id);
      if (!JSON.parse(c.invited_json).includes(actor.user)) throw forbidden('You were not invited to this call.');
      if (c.status !== 'RINGING') return calls.get(actor, c.id);
      const invited = JSON.parse(c.invited_json);
      const still = invited.filter((u) => u !== actor.user);
      if (invited.length === 1) {
        db.prepare("UPDATE msg_calls SET status = 'DECLINED', ended_at = ?, invited_json = '[]', updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), nowIso(), c.id);
        systemMessage(convRow(c.conversation_id), { user: actor.user, companyId: actor.companyId }, `${nameOf(actor.companyId, actor.user)} declined the call`);
      } else db.prepare('UPDATE msg_calls SET invited_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(still), nowIso(), c.id);
      hub.emitTransient({ companyId: actor.companyId, rooms: [`user:${c.initiated_by}`, `conv:${c.conversation_id}`], type: 'msg.call.state', entity: 'msg_call', entityId: c.id, data: { callId: c.id, status: invited.length === 1 ? 'DECLINED' : 'RINGING', declined: actor.user } });
      return calls.get(actor, c.id);
    },
    /** Leave the call; the last person out ends it, and the conversation records how long it lasted. */
    end(actor, callId) {
      const c = callRow(actor, callId);
      must(actor, c.conversation_id);
      const parts = JSON.parse(c.participants_json);
      if (!parts.includes(actor.user)) throw forbidden('You are not in this call.');
      if (['ENDED', 'MISSED', 'DECLINED'].includes(c.status)) return calls.get(actor, c.id);
      const left = parts.filter((u) => u !== actor.user);
      const conv = convRow(c.conversation_id);
      const over = c.status === 'RINGING' || left.length <= 1; // the last two people: when one leaves the call is over
      if (!over) db.prepare('UPDATE msg_calls SET participants_json = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(left), nowIso(), c.id);
      if (over) {
        db.prepare("UPDATE msg_calls SET status = ?, ended_at = ?, participants_json = ? WHERE id = ?").run(c.answered_at ? 'ENDED' : 'MISSED', nowIso(), JSON.stringify(parts), c.id);
        const secs = c.answered_at ? Math.round((Date.now() - Date.parse(c.answered_at)) / 1000) : 0;
        systemMessage(conv, actor, c.answered_at ? `${kindName(c.call_type)[0].toUpperCase()}${kindName(c.call_type).slice(1)} call ended, ${Math.floor(secs / 60)} min ${secs % 60} s` : `Missed ${kindName(c.call_type)} call from ${nameOf(actor.companyId, c.initiated_by)}`);
        writeAudit(db, { entity: 'msg_calls', entityId: c.id, action: 'end', newValues: { seconds: secs }, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'msg.call.ended', entity: 'msg_call', entityId: c.id, actorId: actor.user, companyId: actor.companyId, data: { conversationId: c.conversation_id, seconds: secs } });
      }
      hub.emitTransient({ companyId: actor.companyId, rooms: [`conv:${c.conversation_id}`, ...parts.map((u) => `user:${u}`)], type: 'msg.call.state', entity: 'msg_call', entityId: c.id, data: { callId: c.id, status: over ? 'ENDED' : 'ACTIVE', participants: left, left: actor.user } });
      touchUsers(conv.company_id, conv.id, 'call');
      return calls.get(actor, c.id);
    },
    /** One browser tells another what it needs to set up the connection (offer, answer, network candidates). Never kept. */
    signal(actor, callId, { to, kind, data }) {
      const c = callRow(actor, callId);
      must(actor, c.conversation_id);
      const parts = JSON.parse(c.participants_json);
      if (!parts.includes(actor.user)) throw forbidden('You are not in this call.');
      if (!parts.includes(to) || to === actor.user) throw unprocessable('That person is not in this call.');
      if (['ENDED', 'MISSED', 'DECLINED'].includes(c.status)) throw unprocessable('This call is over.');
      if (Buffer.byteLength(JSON.stringify(data ?? {})) > MAX_SIGNAL_BYTES) throw badRequest('That message is too large.');
      hub.emitTransient({ companyId: actor.companyId, rooms: [`user:${to}`], type: 'msg.call.signal', entity: 'msg_call', entityId: c.id, data: { callId: c.id, from: actor.user, kind, data } });
      return { ok: true };
    },
    get(actor, callId) { expireRinging(actor.companyId); const c = callRow(actor, callId); must(actor, c.conversation_id); return callView(c, actor); },
    list(actor, id) {
      const c = must(actor, id);
      expireRinging(actor.companyId);
      return { rows: db.prepare('SELECT * FROM msg_calls WHERE conversation_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 50').all(c.id).map((r) => callView(r, actor)), active: db.prepare("SELECT id FROM msg_calls WHERE conversation_id = ? AND status IN ('RINGING', 'ACTIVE') AND is_active = 1").get(c.id)?.id ?? null };
    },
    /** Calls that are ringing for this person now. */
    ringing(actor) {
      expireRinging(actor.companyId);
      return { rows: db.prepare("SELECT * FROM msg_calls WHERE company_id = ? AND status = 'RINGING' AND is_active = 1 ORDER BY id DESC LIMIT 20").all(actor.companyId).filter((r) => JSON.parse(r.invited_json).includes(actor.user) && !JSON.parse(r.participants_json).includes(actor.user)).map((r) => callView(r, actor)) };
    },
    expireRinging,
  };

  return { me, presence, typing, receipts, search, marks, gallery, holds, calls };
}

const services = new WeakMap();
export const bindFeatures = (db, s) => services.set(db, s);
export const featuresOf = (db) => services.get(db);
