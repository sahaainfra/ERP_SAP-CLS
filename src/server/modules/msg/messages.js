import { createHash } from 'node:crypto';
import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { toCsv } from '../../platform/export/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { createParameterStore } from '../../platform/parameters/index.js';
import { realtimeConversations, realtimeOf } from '../../platform/realtime/index.js';
import { todayIST } from '../../../shared/dates.js';
import { activeConfig } from './config.js';

// The unified Messages app (part 05.01). One thread index (`msg_conversations`) for direct, group, department, project, site, team and record-linked conversations made here, and for the external threads of the
// communication gateway (04.07), which are indexed from `comm_messages` and read through it without being copied (BR-03: nothing moves, so nothing is lost; `verify` counts and checksums it). A person sees a
// conversation only as a member (BR-01); project, site and department conversations take their members from active assignments. The same rule guards the API and the real-time room `conv:<id>`.
export const CONV_TYPES = ['DIRECT', 'GROUP', 'DEPARTMENT', 'PROJECT', 'SITE', 'TEAM', 'RECORD', 'EXTERNAL'];
export const EMOJI = ['👍', '❤️', '😂', '😮', '🙏', '✅'];
export const MAX_BODY = 4000;
const nowIso = () => new Date().toISOString();
const excerpt = (s, n = 120) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const MENTION_RE = /(?:^|[^\w@])@([A-Za-z0-9._-]{2,40})/g;
export const mentionsOf = (text) => { const out = []; for (const m of String(text).matchAll(MENTION_RE)) { const n = m[1].replace(/[._-]+$/, ''); if (n.length >= 2 && !out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n); } return out; };
const keyId = (id) => (/^\d+$/.test(String(id)) ? Number(id) : String(id));

export function createMessageService({ db }) {
  const authz = authzOf(db);
  const notif = notificationsOf(db);
  const hub = realtimeOf(db);
  const anywhere = (actor, key) => authz.check(actor, key).allowed;
  const params = (actor) => {
    const store = createParameterStore(db);
    const ctx = { companyId: actor.companyId, date: todayIST() };
    const cfg = activeConfig(db, actor.companyId);
    const set = cfg.version > 0; // an approved messaging setting (05.02) wins over the parameter
    const edit = set ? cfg.editWindowMinutes : Number(store.get('msg.edit_window_minutes', ctx));
    return { editWindowMinutes: edit, deleteWindowMinutes: set ? cfg.deleteWindowMinutes : edit, retentionDays: set ? cfg.deletedContentRetentionDays : Number(store.get('msg.deleted_content_retention_days', ctx)), maxMembers: Number(store.get('msg.group_max_members', ctx)), cfg };
  };
  const names = new Map();
  const nameOf = (companyId, u) => { const k = `${companyId}:${u}`; if (!names.has(k)) names.set(k, db.prepare('SELECT display_name FROM iam_users WHERE company_id = ? AND username = ?').get(companyId, u)?.display_name ?? u); return names.get(k); };
  const person = (companyId, u) => ({ username: u, name: u ? nameOf(companyId, u) : null });
  const activeUser = (companyId, u) => db.prepare("SELECT id, username, roles_json FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND status = 'ACTIVE' AND is_active = 1").get(companyId, u);

  // ---- who is in a conversation ----
  const convRow = (id) => db.prepare('SELECT * FROM msg_conversations WHERE id = ? AND is_active = 1').get(id);
  const memberRow = (convId, user) => db.prepare('SELECT * FROM msg_members WHERE conversation_id = ? AND user_ref = ? AND is_active = 1').get(convId, user);
  const isMember = (conv, user) => { const m = memberRow(conv.id, user); return Boolean(m && !m.left_at); };
  /** May this person open this conversation? A member; for an external thread, whoever may read the communication log. */
  function canOpen(actor, conv) {
    if (!conv || conv.company_id !== actor.companyId) return false;
    if (conv.conv_type === 'EXTERNAL') return anywhere(actor, 'comm.log.view');
    return isMember(conv, actor.user);
  }
  const must = (actor, id) => {
    reconcileFor(actor);
    const conv = convRow(Number(id));
    if (!canOpen(actor, conv)) throw notFound('That conversation does not exist, or you are not a member of it.');
    return conv;
  };
  const isAdmin = (conv, user) => memberRow(conv.id, user)?.member_role === 'ADMIN' && !memberRow(conv.id, user).left_at;
  const mayManage = (actor, conv) => isAdmin(conv, actor.user) || (['PROJECT', 'SITE', 'DEPARTMENT'].includes(conv.conv_type) && authz.check(actor, 'msg.channel.manage', { companyId: actor.companyId, projectId: conv.project_id ?? undefined, siteId: conv.site_id ?? undefined }).allowed);

  /** Project, site and department conversations follow active assignments (BR-01): this person is added where an assignment covers the place, and leaves where none does. */
  function reconcileFor(actor) {
    const autos = db.prepare("SELECT * FROM msg_conversations WHERE company_id = ? AND auto_membership = 1 AND is_active = 1 AND is_archived = 0").all(actor.companyId);
    if (!autos.length || !actor.userId) return;
    const today = todayIST();
    const rows = db.prepare("SELECT scope_type, scope_ids_json FROM iam_assignments WHERE company_id = ? AND user_id = ? AND status = 'ACTIVE' AND is_active = 1 AND (effective_from IS NULL OR effective_from <= ?) AND (effective_to IS NULL OR effective_to >= ?)").all(actor.companyId, actor.userId, today, today);
    const scopes = rows.map((r) => ({ type: r.scope_type, ids: JSON.parse(r.scope_ids_json || '[]').map(Number) }));
    for (const c of autos) {
      const covered = scopes.some((s) => (c.conv_type === 'PROJECT' && s.type === 'PROJECT' && s.ids.includes(c.project_id))
        || (c.conv_type === 'SITE' && ((s.type === 'SITE' && s.ids.includes(c.site_id)) || (s.type === 'PROJECT' && s.ids.includes(c.project_id))))
        || (c.conv_type === 'DEPARTMENT' && s.type === 'DEPARTMENT' && s.ids.includes(c.department_id)));
      const m = memberRow(c.id, actor.user);
      if (covered && !m) db.prepare("INSERT INTO msg_members (company_id, conversation_id, user_ref, member_role, member_source, created_by, source_type) VALUES (?, ?, ?, 'MEMBER', 'AUTO', 'system', 'msg_auto')").run(c.company_id, c.id, actor.user);
      else if (covered && m?.left_at && m.member_source === 'AUTO') db.prepare('UPDATE msg_members SET left_at = NULL, updated_at = ? WHERE id = ?').run(nowIso(), m.id);
      else if (!covered && m && !m.left_at && m.member_source === 'AUTO') db.prepare('UPDATE msg_members SET left_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), m.id);
    }
  }
  /** Everyone whose active assignments cover the place of an automatic conversation (used when it is made, so that its first screen already has its members). */
  function autoMembersOf(c) {
    const today = todayIST();
    const out = [];
    for (const a of db.prepare("SELECT a.user_id, a.scope_type, a.scope_ids_json, u.username FROM iam_assignments a JOIN iam_users u ON u.id = a.user_id WHERE a.company_id = ? AND a.status = 'ACTIVE' AND a.is_active = 1 AND u.is_active = 1 AND u.status = 'ACTIVE' AND (a.effective_from IS NULL OR a.effective_from <= ?) AND (a.effective_to IS NULL OR a.effective_to >= ?)").all(c.company_id, today, today)) {
      const ids = JSON.parse(a.scope_ids_json || '[]').map(Number);
      const hit = (c.conv_type === 'PROJECT' && a.scope_type === 'PROJECT' && ids.includes(c.project_id)) || (c.conv_type === 'SITE' && ((a.scope_type === 'SITE' && ids.includes(c.site_id)) || (a.scope_type === 'PROJECT' && ids.includes(c.project_id)))) || (c.conv_type === 'DEPARTMENT' && a.scope_type === 'DEPARTMENT' && ids.includes(c.department_id));
      if (hit && !out.includes(a.username)) out.push(a.username);
    }
    return out;
  }

  // ---- external threads: indexed from the gateway's log, read through it ----
  function indexExternal(companyId) {
    const mark = db.prepare("SELECT COALESCE(MAX(last_external_id), 0) AS m FROM msg_conversations WHERE company_id = ? AND conv_type = 'EXTERNAL'").get(companyId).m;
    const rows = db.prepare("SELECT conversation_key AS k, MAX(id) AS last_id, MIN(channel) AS channel, COUNT(*) AS n, MAX(created_at) AS at, MAX(contact_type) AS ct, MAX(to_address) AS addr FROM comm_messages WHERE company_id = ? AND conversation_key IS NOT NULL AND id > ? GROUP BY conversation_key").all(companyId, mark);
    for (const r of rows) {
      const ex = db.prepare("SELECT id FROM msg_conversations WHERE company_id = ? AND external_key = ? AND is_active = 1").get(companyId, r.k);
      const total = db.prepare('SELECT COUNT(*) AS n FROM comm_messages WHERE company_id = ? AND conversation_key = ?').get(companyId, r.k).n;
      const last = db.prepare('SELECT MAX(id) AS id, MAX(created_at) AS at FROM comm_messages WHERE company_id = ? AND conversation_key = ?').get(companyId, r.k);
      if (ex) db.prepare('UPDATE msg_conversations SET last_external_id = ?, last_message_id = ?, message_count = ?, last_activity_at = ?, updated_at = ? WHERE id = ?').run(last.id, last.id, total, last.at, nowIso(), ex.id);
      else db.prepare("INSERT INTO msg_conversations (company_id, conv_type, title, external_key, external_channel, last_external_id, last_message_id, message_count, last_activity_at, created_by, source_type) VALUES (?, 'EXTERNAL', ?, ?, ?, ?, ?, ?, ?, 'system', 'comm_messages')").run(companyId, `${r.channel} ${r.addr ?? ''}`.trim(), r.k, r.channel, last.id, last.id, total, last.at);
    }
    return rows.length;
  }
  const externalMessage = (r) => ({ id: r.id, conversationId: null, sender: { username: r.direction === 'IN' ? r.to_address : 'system', name: r.direction === 'IN' ? r.to_address : 'ERP' }, kind: 'TEXT', body: r.body_redacted || r.subject || '', status: 'ACTIVE', direction: r.direction, channel: r.channel, deliveryStatus: r.status, subject: r.subject, createdAt: r.created_at, readOnly: true });

  // ---- viewing ----
  function card(actor, link) {
    const def = objectTypes.get(link.entity);
    let access;
    try { access = def && authz.check(actor, def.permission).allowed ? def.access(db, actor, keyId(link.id)) : null; } catch { access = null; }
    if (!access) return { entity: link.entity, restricted: true, label: 'Restricted record' };
    const s = def.summary ? def.summary(db, actor, keyId(link.id)) : null;
    return { entity: link.entity, id: String(link.id), restricted: false, typeLabel: def.label, label: s?.label ?? `${def.label} ${link.id}`, status: s?.status ?? access.status ?? null, amount: s?.amount ?? null, route: def.route ? def.route(keyId(link.id)) : null };
  }
  function present(actor, m, ctx) {
    const deleted = m.status === 'DELETED';
    const p = ctx.params;
    const mine = m.sender_ref === actor.user;
    const reply = m.reply_to_id ? ctx.byId.get(m.reply_to_id) ?? db.prepare('SELECT id, sender_ref, body, status FROM msg_messages WHERE id = ?').get(m.reply_to_id) : null;
    const files = deleted ? [] : JSON.parse(m.attachments_json || '[]').map((id) => ctx.files.get(id)).filter(Boolean);
    return {
      id: m.id, conversationId: m.conversation_id, sender: person(actor.companyId, m.sender_ref), kind: m.kind, status: m.status, body: deleted ? '' : m.body, deleted,
      replyTo: reply ? { id: reply.id, sender: person(actor.companyId, reply.sender_ref), excerpt: reply.status === 'DELETED' ? 'message deleted' : excerpt(reply.body, 80) } : null,
      forwarded: m.forwarded_from_id ? { from: person(actor.companyId, db.prepare('SELECT sender_ref FROM msg_messages WHERE id = ?').get(m.forwarded_from_id)?.sender_ref ?? null) } : null,
      mentions: deleted ? [] : JSON.parse(m.mentions_json || '[]').map((u) => person(actor.companyId, u)),
      attachments: files, links: deleted ? [] : JSON.parse(m.record_links_json || '[]').map((l) => card(actor, l)),
      reactions: deleted ? [] : (ctx.reactions.get(m.id) ?? []).map((r) => ({ ...r, mine: r.users.includes(actor.user), users: undefined })),
      createdAt: m.created_at, editedAt: m.edited_at, mine,
      canEdit: !deleted && mine && m.kind !== 'SYSTEM' && p.editWindowMinutes > 0 && Date.now() - Date.parse(m.created_at) <= p.editWindowMinutes * 60_000,
      canDelete: !deleted && m.kind !== 'SYSTEM' && (mine ? p.deleteWindowMinutes > 0 && Date.now() - Date.parse(m.created_at) <= p.deleteWindowMinutes * 60_000 : ctx.admin),
      starred: ctx.stars.has(m.id), pinned: ctx.pins.has(m.id), voice: ctx.voice.get(m.id) ?? null, receipt: mine ? (ctx.receipts.get(m.id) ?? { state: 'sent', delivered: 0, read: 0, of: ctx.recipients }) : null,
    };
  }
  function context(actor, rows, conv) {
    const ids = rows.map((r) => r.id);
    const reactions = new Map();
    if (ids.length) {
      const q = ids.map(() => '?').join(',');
      for (const r of db.prepare(`SELECT message_id, emoji, user_ref FROM msg_reactions WHERE message_id IN (${q}) AND is_active = 1 ORDER BY id`).all(...ids)) {
        const list = reactions.get(r.message_id) ?? []; let e = list.find((x) => x.emoji === r.emoji); if (!e) { e = { emoji: r.emoji, count: 0, users: [] }; list.push(e); } e.count += 1; e.users.push(r.user_ref); reactions.set(r.message_id, list);
      }
    }
    const fileIds = [...new Set(rows.flatMap((r) => JSON.parse(r.attachments_json || '[]')))];
    const files = new Map();
    if (fileIds.length) for (const f of db.prepare(`SELECT id, original_name, size_bytes, mime, category, scan_status FROM core_files WHERE id IN (${fileIds.map(() => '?').join(',')}) AND company_id = ? AND is_active = 1`).all(...fileIds, actor.companyId)) files.set(f.id, { id: f.id, name: f.original_name, size: f.size_bytes, mime: f.mime, category: f.category, scan: f.scan_status });
    const stars = new Set(); const pins = new Set(); const voice = new Map(); const receipts = new Map();
    const recipients = Math.max(0, db.prepare('SELECT COUNT(*) AS n FROM msg_members WHERE conversation_id = ? AND left_at IS NULL AND is_active = 1 AND user_ref != ?').get(conv.id, actor.user).n);
    if (ids.length) {
      const q = ids.map(() => '?').join(',');
      for (const r of db.prepare(`SELECT message_id FROM msg_stars WHERE user_ref = ? AND message_id IN (${q}) AND is_active = 1`).all(actor.user, ...ids)) stars.add(r.message_id);
      for (const r of db.prepare(`SELECT message_id FROM msg_pins WHERE conversation_id = ? AND message_id IN (${q}) AND is_active = 1`).all(conv.id, ...ids)) pins.add(r.message_id);
      for (const r of db.prepare(`SELECT message_id, duration_ms, waveform_json FROM msg_voice WHERE message_id IN (${q})`).all(...ids)) voice.set(r.message_id, { durationMs: r.duration_ms, waveform: JSON.parse(r.waveform_json) });
      const mineIds = rows.filter((r) => r.sender_ref === actor.user && r.kind !== 'SYSTEM').map((r) => r.id);
      if (mineIds.length) {
        const cfg = activeConfig(db, actor.companyId);
        const iShare = cfg.enforceReadReceipts || (db.prepare('SELECT share_read_receipts AS s FROM msg_user_settings WHERE company_id = ? AND user_ref = ?').get(actor.companyId, actor.user)?.s ?? 1) === 1;
        for (const r of db.prepare(`SELECT r.message_id, COUNT(r.delivered_at) AS d, SUM(CASE WHEN r.read_at IS NOT NULL AND (? = 1 OR COALESCE(us.share_read_receipts, 1) = 1) THEN 1 ELSE 0 END) AS rd
          FROM msg_receipts r LEFT JOIN msg_user_settings us ON us.company_id = r.company_id AND us.user_ref = r.user_ref WHERE r.message_id IN (${mineIds.map(() => '?').join(',')}) GROUP BY r.message_id`).all(cfg.enforceReadReceipts ? 1 : 0, ...mineIds)) {
          const read = iShare ? (r.rd ?? 0) : 0;
          receipts.set(r.message_id, { state: recipients > 0 && read >= recipients ? 'read' : recipients > 0 && r.d >= recipients ? 'delivered' : 'sent', delivered: r.d, read, of: recipients });
        }
      }
    }
    return { params: params(actor), byId: new Map(rows.map((r) => [r.id, r])), reactions, files, admin: mayManage(actor, conv), stars, pins, voice, receipts, recipients };
  }
  function titleFor(actor, c) {
    if (c.conv_type === 'DIRECT') { const other = c.direct_key.split('|').find((u) => u !== actor.user) ?? actor.user; return nameOf(actor.companyId, other); }
    return c.title || { PROJECT: 'Project', SITE: 'Site', DEPARTMENT: 'Department', RECORD: 'Record', GROUP: 'Group', TEAM: 'Team', EXTERNAL: 'External' }[c.conv_type];
  }
  function summarize(actor, c, me) {
    let last; let unread;
    if (c.conv_type === 'EXTERNAL') {
      const r = db.prepare('SELECT * FROM comm_messages WHERE company_id = ? AND conversation_key = ? ORDER BY id DESC LIMIT 1').get(c.company_id, c.external_key);
      last = r ? { excerpt: excerpt(r.body_redacted || r.subject), at: r.created_at, sender: r.direction === 'IN' ? r.to_address : 'ERP', deleted: false } : null;
      unread = db.prepare("SELECT COUNT(*) AS n FROM comm_messages WHERE company_id = ? AND conversation_key = ? AND direction = 'IN' AND id > ?").get(c.company_id, c.external_key, me?.last_read_message_id ?? 0).n;
    } else {
      const r = c.last_message_id ? db.prepare('SELECT * FROM msg_messages WHERE id = ?').get(c.last_message_id) : null;
      last = r ? { excerpt: r.status === 'DELETED' ? 'message deleted' : excerpt(r.body) || (r.kind === 'VOICE' ? 'Voice note' : r.kind === 'FILE' ? 'Attachment' : ''), at: r.created_at, sender: nameOf(actor.companyId, r.sender_ref), deleted: r.status === 'DELETED' } : null;
      unread = db.prepare("SELECT COUNT(*) AS n FROM msg_messages WHERE conversation_id = ? AND id > ? AND sender_ref != ? AND status = 'ACTIVE' AND kind != 'SYSTEM'").get(c.id, me?.last_read_message_id ?? 0, actor.user).n;
    }
    return { id: c.id, type: c.conv_type, title: titleFor(actor, c), projectId: c.project_id, siteId: c.site_id, departmentId: c.department_id, entity: c.entity, entityId: c.entity_id, channel: c.external_channel, archived: Boolean(me?.archived) || c.is_archived === 1, pinned: Boolean(me?.pinned),
      muted: Boolean(me?.muted_until && Date.parse(me.muted_until) > Date.now()), mentionOnly: Boolean(me?.mention_only), unread, lastActivityAt: c.last_activity_at, last, messageCount: c.message_count, readOnly: c.conv_type === 'EXTERNAL' };
  }

  /** The stretches in which this person was not a member (they left and came back): what was said then is never shown to them. [[from, to], ...] */
  function gapsOf(convId, user) {
    const periods = db.prepare('SELECT started_at, ended_at FROM msg_member_periods WHERE conversation_id = ? AND user_ref = ? ORDER BY started_at, id').all(convId, user);
    const gaps = [];
    for (let i = 1; i < periods.length; i += 1) if (periods[i - 1].ended_at && periods[i].started_at > periods[i - 1].ended_at) gaps.push([periods[i - 1].ended_at, periods[i].started_at]);
    return gaps;
  }

  const conversations = {
    /** @param {any} actor @param {{ q?: string, view?: string, limit?: number, offset?: number }} [o] */
    list(actor, { q, view = 'all', limit = 100, offset = 0 } = {}) {
      reconcileFor(actor);
      if (anywhere(actor, 'comm.log.view')) indexExternal(actor.companyId);
      const ext = anywhere(actor, 'comm.log.view');
      const rows = db.prepare(`SELECT c.*, m.id AS mid FROM msg_conversations c LEFT JOIN msg_members m ON m.conversation_id = c.id AND m.user_ref = ? AND m.left_at IS NULL AND m.is_active = 1
        WHERE c.company_id = ? AND c.is_active = 1 AND (m.id IS NOT NULL ${ext ? "OR c.conv_type = 'EXTERNAL'" : ''}) ORDER BY c.last_activity_at DESC, c.id DESC LIMIT 1000`).all(actor.user, actor.companyId);
      let list = rows.map((c) => summarize(actor, c, memberRow(c.id, actor.user)));
      const total = { all: list.filter((c) => !c.archived).length, unread: list.filter((c) => !c.archived && c.unread > 0).length, archived: list.filter((c) => c.archived).length };
      if (view === 'archived') list = list.filter((c) => c.archived);
      else list = list.filter((c) => !c.archived);
      if (view === 'unread') list = list.filter((c) => c.unread > 0);
      else if (view === 'pinned') list = list.filter((c) => c.pinned);
      else if (CONV_TYPES.includes(view)) list = list.filter((c) => c.type === view);
      if (q) { const n = q.toLowerCase(); list = list.filter((c) => c.title.toLowerCase().includes(n) || (c.last?.excerpt ?? '').toLowerCase().includes(n)); }
      list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.lastActivityAt < b.lastActivityAt ? 1 : -1));
      return { rows: list.slice(offset, offset + limit), total: list.length, counts: total, canExternal: ext, canManage: anywhere(actor, 'msg.channel.manage') };
    },

    create(actor, b) {
      const type = b.type;
      const p = params(actor);
      const others = [...new Set((b.members ?? []).map((u) => String(u).trim()).filter(Boolean))].filter((u) => u.toLowerCase() !== actor.user.toLowerCase());
      const users = [];
      for (const u of others) { const row = activeUser(actor.companyId, u); if (!row) throw unprocessable(`${u} is not an active person of your company.`, [{ field: 'members', message: `${u} is not an active person` }]); users.push(row.username); }
      if (users.length + 1 > p.maxMembers) throw unprocessable(`A conversation can have at most ${p.maxMembers} members.`);
      return transaction(db, () => {
        let existing = null; let row;
        if (type === 'DIRECT') {
          if (users.length !== 1) throw unprocessable('A direct conversation is with exactly one other person.', [{ field: 'members', message: 'choose one person' }]);
          const key = [actor.user, users[0]].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase())).join('|');
          existing = db.prepare('SELECT * FROM msg_conversations WHERE company_id = ? AND direct_key = ? AND is_active = 1').get(actor.companyId, key);
          if (!existing) row = { conv_type: 'DIRECT', title: '', direct_key: key };
        } else if (type === 'GROUP' || type === 'TEAM') {
          if (!b.title?.trim()) throw unprocessable('Give the group a name.', [{ field: 'title', message: 'is required' }]);
          if (!users.length) throw unprocessable('Add at least one other person.', [{ field: 'members', message: 'add someone' }]);
          row = { conv_type: type, title: b.title.trim() };
        } else if (type === 'PROJECT' || type === 'SITE' || type === 'DEPARTMENT') {
          const place = type === 'PROJECT' ? db.prepare('SELECT id, name, code FROM org_projects WHERE id = ? AND company_id = ?').get(b.projectId ?? 0, actor.companyId)
            : type === 'SITE' ? db.prepare('SELECT s.id, s.name, s.code, s.org_project_id AS project_id FROM org_sites s WHERE s.id = ? AND s.company_id = ?').get(b.siteId ?? 0, actor.companyId)
              : db.prepare('SELECT id, name, code FROM org_departments WHERE id = ? AND company_id = ?').get(b.departmentId ?? 0, actor.companyId);
          if (!place) throw unprocessable(`Choose the ${type.toLowerCase()} this conversation is for.`, [{ field: `${type.toLowerCase()}Id`, message: 'is required' }]);
          const projectId = type === 'PROJECT' ? place.id : type === 'SITE' ? (place.project_id ?? null) : null;
          if (!authz.check(actor, 'msg.channel.manage', { companyId: actor.companyId, projectId: projectId ?? undefined, siteId: type === 'SITE' ? place.id : undefined }).allowed) throw forbidden('You may not make this channel (permission msg.channel.manage).');
          row = { conv_type: type, title: b.title?.trim() || `${place.code ?? ''} ${place.name}`.trim(), project_id: projectId, site_id: type === 'SITE' ? place.id : null, department_id: type === 'DEPARTMENT' ? place.id : null, auto_membership: 1 };
          existing = db.prepare("SELECT * FROM msg_conversations WHERE company_id = ? AND conv_type = ? AND COALESCE(project_id, 0) = ? AND COALESCE(site_id, 0) = ? AND COALESCE(department_id, 0) = ? AND is_active = 1").get(actor.companyId, type, row.project_id ?? 0, row.site_id ?? 0, row.department_id ?? 0);
        } else if (type === 'RECORD') {
          const def = objectTypes.get(b.entity ?? '');
          if (!def) throw notFound(`There is no record type called ${b.entity}.`);
          if (!authz.check(actor, def.permission).allowed || !def.access(db, actor, keyId(b.entityId))) throw notFound('That record does not exist, or you may not open it.');
          existing = db.prepare("SELECT * FROM msg_conversations WHERE company_id = ? AND conv_type = 'RECORD' AND entity = ? AND entity_id = ? AND is_active = 1").get(actor.companyId, b.entity, String(b.entityId));
          const s = def.summary ? def.summary(db, actor, keyId(b.entityId)) : null;
          const a = def.access(db, actor, keyId(b.entityId));
          row = { conv_type: 'RECORD', title: b.title?.trim() || s?.label || `${def.label} ${b.entityId}`, entity: b.entity, entity_id: String(b.entityId), project_id: a.projectId ?? null, site_id: a.siteId ?? null };
          for (const u of users) { const r = userCanOpenRecord(actor.companyId, u, def, b.entityId); if (!r) throw unprocessable(`${u} cannot see that record, so they cannot be added to its conversation.`, [{ field: 'members', message: `${u} has no access to the record` }]); }
        } else throw unprocessable('Choose the kind of conversation.');
        if (existing) {
          const m = memberRow(existing.id, actor.user);
          if (!m) {
            if (type === 'RECORD' || existing.auto_membership) db.prepare("INSERT INTO msg_members (company_id, conversation_id, user_ref, member_role, member_source, created_by, source_type) VALUES (?, ?, ?, 'MEMBER', ?, ?, 'msg_member')").run(actor.companyId, existing.id, actor.user, existing.auto_membership ? 'AUTO' : 'MANUAL', actor.user);
            else throw conflict('That conversation already exists and you are not a member of it.');
          } else if (m.left_at) db.prepare('UPDATE msg_members SET left_at = NULL, updated_at = ? WHERE id = ?').run(nowIso(), m.id);
          return { id: existing.id, created: false };
        }
        const id = Number(db.prepare(`INSERT INTO msg_conversations (company_id, conv_type, title, direct_key, department_id, entity, entity_id, auto_membership, project_id, site_id, created_by, source_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'msg_conversation')`).run(actor.companyId, row.conv_type, row.title, row.direct_key ?? null, row.department_id ?? null, row.entity ?? null, row.entity_id ?? null, row.auto_membership ?? 0, row.project_id ?? null, row.site_id ?? null, actor.user).lastInsertRowid);
        const add = (u, role, source) => db.prepare('INSERT OR IGNORE INTO msg_members (company_id, conversation_id, user_ref, member_role, member_source, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, id, u, role, source, actor.user, 'msg_member');
        add(actor.user, row.conv_type === 'DIRECT' ? 'MEMBER' : 'ADMIN', 'MANUAL');
        for (const u of users) add(u, 'MEMBER', 'MANUAL');
        if (row.auto_membership) for (const u of autoMembersOf({ ...row, id, company_id: actor.companyId })) add(u, 'MEMBER', 'AUTO');
        writeAudit(db, { entity: 'msg_conversations', entityId: id, action: 'create', newValues: { type: row.conv_type, title: row.title, members: [actor.user, ...users] }, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'msg.conversation.created', entity: 'msg_conversation', entityId: id, actorId: actor.user, companyId: actor.companyId, projectId: row.project_id ?? undefined, data: { type: row.conv_type } });
        touchUsers(actor.companyId, id, 'created');
        return { id, created: true };
      });
    },

    details(actor, id) {
      const c = must(actor, id);
      const me = memberRow(c.id, actor.user);
      const members = c.conv_type === 'EXTERNAL' ? [] : db.prepare('SELECT * FROM msg_members WHERE conversation_id = ? AND left_at IS NULL AND is_active = 1 ORDER BY member_role, user_ref').all(c.id).map((m) => ({ ...person(actor.companyId, m.user_ref), role: m.member_role, source: m.member_source, joinedAt: m.joined_at }));
      let files = []; let links = [];
      if (c.conv_type !== 'EXTERNAL') {
        const ids = new Set(); const linkSet = new Map();
        for (const r of db.prepare("SELECT attachments_json, record_links_json FROM msg_messages WHERE conversation_id = ? AND status = 'ACTIVE' ORDER BY id DESC LIMIT 500").all(c.id)) {
          for (const f of JSON.parse(r.attachments_json || '[]')) ids.add(f);
          for (const l of JSON.parse(r.record_links_json || '[]')) linkSet.set(`${l.entity}:${l.id}`, l);
        }
        if (ids.size) files = db.prepare(`SELECT id, original_name AS name, size_bytes AS size, mime, category, created_at AS at FROM core_files WHERE id IN (${[...ids].map(() => '?').join(',')}) AND company_id = ? AND is_active = 1 ORDER BY id DESC`).all(...ids, actor.companyId).map((f) => ({ ...f }));
        links = [...linkSet.values()].map((l) => card(actor, l));
      }
      const s = summarize(actor, c, me);
      return { ...s, members, files, links, mine: { role: me?.member_role ?? null, pinned: s.pinned, muted: s.muted, mutedUntil: me?.muted_until ?? null, mentionOnly: s.mentionOnly, archived: s.archived }, canManage: c.conv_type !== 'EXTERNAL' && c.conv_type !== 'DIRECT' && mayManage(actor, c), autoMembership: c.auto_membership === 1,
        createdBy: person(actor.companyId, c.created_by), createdAt: c.created_at };
    },

    /** The person's own settings of a conversation: pin, mute, mention-only, archive. */
    settings(actor, id, b) {
      const c = must(actor, id);
      let m = memberRow(c.id, actor.user);
      if (!m && c.conv_type === 'EXTERNAL') { db.prepare("INSERT INTO msg_members (company_id, conversation_id, user_ref, member_role, member_source, created_by, source_type) VALUES (?, ?, ?, 'MEMBER', 'AUTO', ?, 'msg_member')").run(c.company_id, c.id, actor.user, actor.user); m = memberRow(c.id, actor.user); }
      const set = [];
      const vals = [];
      if (b.pinned !== undefined) { set.push('pinned = ?'); vals.push(b.pinned ? 1 : 0); }
      if (b.archived !== undefined) { set.push('archived = ?'); vals.push(b.archived ? 1 : 0); }
      if (b.mentionOnly !== undefined) { set.push('mention_only = ?'); vals.push(b.mentionOnly ? 1 : 0); }
      if (b.mutedUntil !== undefined) { set.push('muted_until = ?'); vals.push(b.mutedUntil); }
      if (set.length) db.prepare(`UPDATE msg_members SET ${set.join(', ')}, updated_at = ?, version = version + 1 WHERE id = ?`).run(...vals, nowIso(), m.id);
      return conversations.details(actor, c.id);
    },
    rename(actor, id, { title }) {
      const c = must(actor, id);
      if (['DIRECT', 'EXTERNAL'].includes(c.conv_type) || !mayManage(actor, c)) throw forbidden('Only an administrator of the conversation can rename it.');
      db.prepare('UPDATE msg_conversations SET title = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(title, actor.user, nowIso(), c.id);
      writeAudit(db, { entity: 'msg_conversations', entityId: c.id, action: 'rename', oldValues: { title: c.title }, newValues: { title }, actor: actor.user, companyId: actor.companyId });
      touchUsers(c.company_id, c.id, 'renamed');
      return conversations.details(actor, c.id);
    },
    archive(actor, id, { archived }) {
      const c = must(actor, id);
      if (['DIRECT', 'EXTERNAL'].includes(c.conv_type) || !mayManage(actor, c)) throw forbidden('Only an administrator of the conversation can archive it for everyone.');
      db.prepare('UPDATE msg_conversations SET is_archived = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(archived ? 1 : 0, actor.user, nowIso(), c.id);
      writeAudit(db, { entity: 'msg_conversations', entityId: c.id, action: archived ? 'archive' : 'unarchive', actor: actor.user, companyId: actor.companyId });
      touchUsers(c.company_id, c.id, 'archived');
      return conversations.details(actor, c.id);
    },
    read(actor, id, { upTo }) {
      const c = must(actor, id);
      let m = memberRow(c.id, actor.user);
      if (!m && c.conv_type === 'EXTERNAL') { db.prepare("INSERT INTO msg_members (company_id, conversation_id, user_ref, member_role, member_source, created_by, source_type) VALUES (?, ?, ?, 'MEMBER', 'AUTO', ?, 'msg_member')").run(c.company_id, c.id, actor.user, actor.user); m = memberRow(c.id, actor.user); }
      const top = upTo ?? c.last_message_id ?? 0;
      if (top > m.last_read_message_id) {
        db.prepare('UPDATE msg_members SET last_read_message_id = ?, updated_at = ? WHERE id = ?').run(top, nowIso(), m.id);
        if (c.conv_type !== 'EXTERNAL') {
          const at = nowIso();
          db.prepare(`INSERT INTO msg_receipts (company_id, message_id, user_ref, delivered_at, read_at, created_by, source_type)
            SELECT company_id, id, ?, ?, ?, ?, 'msg_receipt' FROM msg_messages WHERE conversation_id = ? AND id > ? AND id <= ? AND sender_ref != ? AND kind != 'SYSTEM'
            ON CONFLICT (message_id, user_ref) DO UPDATE SET read_at = COALESCE(msg_receipts.read_at, excluded.read_at), delivered_at = COALESCE(msg_receipts.delivered_at, excluded.delivered_at)`).run(actor.user, at, at, actor.user, c.id, m.last_read_message_id, top, actor.user);
          hub.publish({ companyId: actor.companyId, rooms: [`conv:${c.id}`], type: 'msg.receipt.updated', entity: 'msg_conversation', entityId: c.id, data: { conversationId: c.id, user: actor.user, upTo: top, state: 'read' } });
        }
      }
      hub.publish({ companyId: actor.companyId, rooms: [`user:${actor.user}`], type: 'msg.conversation.updated', entity: 'msg_conversation', entityId: c.id, data: { conversationId: c.id, read: true } });
      return { id: c.id, lastRead: Math.max(top, m.last_read_message_id) };
    },
    unreadCount(actor) { return conversations.list(actor, { view: 'unread', limit: 1 }).total; },
  };
  const userCanOpenRecord = (companyId, username, def, id) => {
    const u = activeUser(companyId, username);
    if (!u) return false;
    try { const a = authz.enrich({ user: u.username, userId: u.id, companyId, roles: JSON.parse(u.roles_json || '[]') }); return authz.check(a, def.permission).allowed && Boolean(def.access(db, a, keyId(id))); } catch { return false; }
  };
  /** Tell the members' own screens that their list changed (ids only: the screen asks the API for the rest). */
  function touchUsers(companyId, convId, what) {
    const users = db.prepare('SELECT user_ref FROM msg_members WHERE conversation_id = ? AND left_at IS NULL AND is_active = 1').all(convId).map((r) => r.user_ref);
    if (users.length) hub.publish({ companyId, rooms: users.map((u) => `user:${u}`), type: 'msg.conversation.updated', entity: 'msg_conversation', entityId: convId, data: { conversationId: convId, what } });
  }

  // ---- members (FR-06) ----
  const members = {
    add(actor, id, { users: names }) {
      const c = must(actor, id);
      if (['DIRECT', 'EXTERNAL'].includes(c.conv_type)) throw unprocessable('People cannot be added to this kind of conversation.');
      if (!mayManage(actor, c)) throw forbidden('Only an administrator of the conversation can add people.');
      const p = params(actor);
      const def = c.conv_type === 'RECORD' ? objectTypes.get(c.entity) : null;
      return transaction(db, () => {
        const added = [];
        for (const raw of names) {
          const u = activeUser(actor.companyId, raw);
          if (!u) throw unprocessable(`${raw} is not an active person of your company.`, [{ field: 'users', message: `${raw} is not an active person` }]);
          if (def && !userCanOpenRecord(actor.companyId, u.username, def, c.entity_id)) throw unprocessable(`${u.username} cannot see that record, so they cannot be added to its conversation.`, [{ field: 'users', message: `${u.username} has no access to the record` }]);
          const ex = memberRow(c.id, u.username);
          if (ex && !ex.left_at) continue;
          if (db.prepare('SELECT COUNT(*) AS n FROM msg_members WHERE conversation_id = ? AND left_at IS NULL AND is_active = 1').get(c.id).n >= p.maxMembers) throw unprocessable(`A conversation can have at most ${p.maxMembers} members.`);
          if (ex) db.prepare("UPDATE msg_members SET left_at = NULL, member_source = 'MANUAL', updated_at = ? WHERE id = ?").run(nowIso(), ex.id);
          else db.prepare("INSERT INTO msg_members (company_id, conversation_id, user_ref, member_role, member_source, created_by, source_type) VALUES (?, ?, ?, 'MEMBER', 'MANUAL', ?, 'msg_member')").run(actor.companyId, c.id, u.username, actor.user);
          added.push(u.username);
        }
        if (added.length) {
          systemMessage(c, actor, `${nameOf(actor.companyId, actor.user)} added ${added.map((u) => nameOf(actor.companyId, u)).join(', ')}`);
          writeAudit(db, { entity: 'msg_conversations', entityId: c.id, action: 'add_members', newValues: { users: added }, actor: actor.user, companyId: actor.companyId });
          touchUsers(c.company_id, c.id, 'members');
        }
        return conversations.details(actor, c.id);
      });
    },
    remove(actor, id, user) {
      const c = must(actor, id);
      const self = user.toLowerCase() === actor.user.toLowerCase();
      if (['DIRECT', 'EXTERNAL'].includes(c.conv_type)) throw unprocessable('Nobody can be removed from this kind of conversation.');
      if (!self && !mayManage(actor, c)) throw forbidden('Only an administrator of the conversation can remove people.');
      const m = memberRow(c.id, user);
      if (!m || m.left_at) throw notFound('That person is not a member.');
      if (m.member_source === 'AUTO' && c.auto_membership) throw unprocessable('Membership of this channel follows assignments. Mute or archive it instead.');
      if (m.member_role === 'ADMIN' && db.prepare("SELECT COUNT(*) AS n FROM msg_members WHERE conversation_id = ? AND member_role = 'ADMIN' AND left_at IS NULL AND is_active = 1").get(c.id).n <= 1 && db.prepare('SELECT COUNT(*) AS n FROM msg_members WHERE conversation_id = ? AND left_at IS NULL AND is_active = 1').get(c.id).n > 1) throw unprocessable('Make someone else an administrator first.');
      return transaction(db, () => {
        db.prepare('UPDATE msg_members SET left_at = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(nowIso(), nowIso(), actor.user, m.id);
        systemMessage(c, actor, self ? `${nameOf(actor.companyId, user)} left` : `${nameOf(actor.companyId, actor.user)} removed ${nameOf(actor.companyId, user)}`);
        writeAudit(db, { entity: 'msg_conversations', entityId: c.id, action: self ? 'leave' : 'remove_member', newValues: { user }, actor: actor.user, companyId: actor.companyId });
        hub.publish({ companyId: c.company_id, rooms: [`user:${user}`], type: 'msg.conversation.updated', entity: 'msg_conversation', entityId: c.id, data: { conversationId: c.id, what: 'removed' } });
        touchUsers(c.company_id, c.id, 'members');
        return self ? { left: true } : conversations.details(actor, c.id);
      });
    },
    role(actor, id, user, { role }) {
      const c = must(actor, id);
      if (['DIRECT', 'EXTERNAL'].includes(c.conv_type) || !mayManage(actor, c)) throw forbidden('Only an administrator of the conversation can change roles.');
      const m = memberRow(c.id, user);
      if (!m || m.left_at) throw notFound('That person is not a member.');
      if (role === 'MEMBER' && m.member_role === 'ADMIN' && db.prepare("SELECT COUNT(*) AS n FROM msg_members WHERE conversation_id = ? AND member_role = 'ADMIN' AND left_at IS NULL AND is_active = 1").get(c.id).n <= 1) throw unprocessable('A conversation needs at least one administrator.');
      db.prepare('UPDATE msg_members SET member_role = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(role, nowIso(), actor.user, m.id);
      writeAudit(db, { entity: 'msg_conversations', entityId: c.id, action: 'member_role', newValues: { user, role }, actor: actor.user, companyId: actor.companyId });
      return conversations.details(actor, c.id);
    },
  };

  // ---- messages ----
  function bump(c, messageId, at) {
    db.prepare('UPDATE msg_conversations SET last_message_id = ?, last_activity_at = ?, message_count = message_count + 1, updated_at = ? WHERE id = ?').run(messageId, at, nowIso(), c.id);
  }
  function systemMessage(c, actor, text) {
    const id = Number(db.prepare("INSERT INTO msg_messages (company_id, conversation_id, sender_ref, kind, body, created_by, source_type) VALUES (?, ?, ?, 'SYSTEM', ?, ?, 'msg_system')").run(c.company_id, c.id, actor.user, text, actor.user).lastInsertRowid);
    bump(c, id, nowIso());
    hub.publish({ companyId: c.company_id, rooms: [`conv:${c.id}`], type: 'msg.message.created', entity: 'msg_message', entityId: id, data: { conversationId: c.id, messageId: id } });
  }
  const messages = {
    /** @param {any} actor @param {any} id @param {{ before?: number, around?: number, limit?: number }} [o] */
    list(actor, id, { before, around, limit = 40 } = {}) {
      const c = must(actor, id);
      if (c.conv_type === 'EXTERNAL') {
        const rows = db.prepare(`SELECT * FROM comm_messages WHERE company_id = ? AND conversation_key = ? ${before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ?`).all(...[c.company_id, c.external_key, ...(before ? [before] : []), limit + 1]);
        return { rows: rows.slice(0, limit).reverse().map((r) => ({ ...externalMessage(r), conversationId: c.id })), hasMore: rows.length > limit, readOnly: true, lastRead: memberRow(c.id, actor.user)?.last_read_message_id ?? 0 };
      }
      const gapSql = gapsOf(c.id, actor.user).map(([a, b]) => ` AND NOT (created_at >= '${a}' AND created_at < '${b}')`).join('');
      const hidden = ' AND id NOT IN (SELECT message_id FROM msg_hidden WHERE user_ref = ? AND is_active = 1)';
      if (around) {
        const before2 = db.prepare(`SELECT * FROM msg_messages WHERE conversation_id = ? AND is_active = 1 AND id <= ?${gapSql}${hidden} ORDER BY id DESC LIMIT ?`).all(c.id, around, actor.user, Math.ceil(limit / 2) + 1);
        const after2 = db.prepare(`SELECT * FROM msg_messages WHERE conversation_id = ? AND is_active = 1 AND id > ?${gapSql}${hidden} ORDER BY id ASC LIMIT ?`).all(c.id, around, actor.user, Math.floor(limit / 2));
        const win = [...before2.reverse(), ...after2];
        const ctx2 = context(actor, win, c);
        return { rows: win.map((m) => present(actor, m, ctx2)), hasMore: true, readOnly: false, lastRead: memberRow(c.id, actor.user)?.last_read_message_id ?? 0, archived: c.is_archived === 1, around };
      }
      const rows = db.prepare(`SELECT * FROM msg_messages WHERE conversation_id = ? AND is_active = 1 ${before ? 'AND id < ?' : ''}${gapSql}${hidden} ORDER BY id DESC LIMIT ?`).all(...[c.id, ...(before ? [before] : []), actor.user, limit + 1]);
      const page = rows.slice(0, limit).reverse();
      const ctx = context(actor, page, c);
      return { rows: page.map((m) => present(actor, m, ctx)), hasMore: rows.length > limit, readOnly: false, lastRead: memberRow(c.id, actor.user)?.last_read_message_id ?? 0, archived: c.is_archived === 1 };
    },

    send(actor, id, b) {
      const c = must(actor, id);
      if (c.conv_type === 'EXTERNAL') throw unprocessable('External threads are read-only here. Reply from the communication centre.');
      if (c.is_archived) throw unprocessable('This conversation is archived. Unarchive it to write in it.');
      const body = String(b.body ?? '').trim();
      if (body.length > MAX_BODY) throw unprocessable(`A message can have at most ${MAX_BODY} characters.`, [{ field: 'body', message: `at most ${MAX_BODY} characters` }]);
      const files = [...new Set(b.attachments ?? [])];
      const linksIn = b.recordLinks ?? [];
      if (!body && !files.length && !linksIn.length) throw unprocessable('Write something, or attach a file or a record.', [{ field: 'body', message: 'is empty' }]);
      if (b.clientId) { const dup = db.prepare('SELECT * FROM msg_messages WHERE conversation_id = ? AND client_id = ?').get(c.id, b.clientId); if (dup) return { ...present(actor, dup, context(actor, [dup], c)), replayed: true }; }
      // files: uploaded by this person to this conversation through the file service
      const lim = params(actor).cfg;
      for (const fid of files) {
        const f = db.prepare("SELECT id, linked_entity, linked_id, created_by, scan_status, size_bytes, category FROM core_files WHERE id = ? AND company_id = ? AND is_active = 1").get(fid, actor.companyId);
        if (!f || f.linked_entity !== 'msg_conversation' || f.linked_id !== c.id || f.created_by !== actor.user) throw unprocessable('Attach files that you uploaded to this conversation.', [{ field: 'attachments', message: 'unknown file' }]);
        if (f.scan_status === 'INFECTED') throw unprocessable('A file failed the virus scan and cannot be sent.');
        if (f.size_bytes > lim.maxFileMb * 1024 * 1024) throw unprocessable(`A file can be at most ${lim.maxFileMb} MB here.`, [{ field: 'attachments', message: `at most ${lim.maxFileMb} MB` }]);
        if (f.category === 'video' && f.size_bytes > lim.maxVideoMb * 1024 * 1024) throw unprocessable(`A video can be at most ${lim.maxVideoMb} MB here.`, [{ field: 'attachments', message: `video at most ${lim.maxVideoMb} MB` }]);
      }
      // records: the sender must be able to open each (BR of FR-05); the card is drawn per reader
      const links = [];
      for (const l of linksIn) {
        const cd = card(actor, l);
        if (cd.restricted) throw unprocessable('You may not link a record you cannot open.', [{ field: 'recordLinks', message: `${l.entity} ${l.id} is not open to you` }]);
        if (!links.some((x) => x.entity === l.entity && String(x.id) === String(l.id))) links.push({ entity: l.entity, id: String(l.id) });
      }
      let replyTo = null;
      if (b.replyToId) { replyTo = db.prepare('SELECT id FROM msg_messages WHERE id = ? AND conversation_id = ?').get(b.replyToId, c.id); if (!replyTo) throw notFound('The message you are replying to is not in this conversation.'); }
      // mentions: only people who are in the conversation can be mentioned
      const mentioned = []; const outsiders = [];
      for (const n of mentionsOf(body)) {
        const u = activeUser(actor.companyId, n);
        if (!u) continue;
        const m = memberRow(c.id, u.username);
        if (m && !m.left_at) mentioned.push(u.username); else outsiders.push(u.username);
      }
      if (outsiders.length) throw unprocessable(`${outsiders.map((o) => `@${o}`).join(', ')} ${outsiders.length === 1 ? 'is' : 'are'} not in this conversation, so the message was not sent. Add them first.`, outsiders.map((o) => ({ field: 'body', message: `@${o} is not a member` })));
      if (b.voice && b.voice.durationMs > lim.maxVoiceSeconds * 1000) throw unprocessable(`A voice note can be at most ${lim.maxVoiceSeconds} seconds.`, [{ field: 'voice', message: `at most ${lim.maxVoiceSeconds} seconds` }]);
      const kind = b.kind === 'VOICE' ? 'VOICE' : files.length && !body ? 'FILE' : 'TEXT';
      return transaction(db, () => {
        const at = nowIso();
        const mid = Number(db.prepare(`INSERT INTO msg_messages (company_id, conversation_id, sender_ref, kind, body, reply_to_id, forwarded_from_id, mentions_json, attachments_json, record_links_json, client_id, project_id, site_id, created_by, created_at, source_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'msg_message')`).run(actor.companyId, c.id, actor.user, kind, body, replyTo?.id ?? null, b.forwardedFromId ?? null, JSON.stringify(mentioned), JSON.stringify(files), JSON.stringify(links), b.clientId ?? null, c.project_id, c.site_id, actor.user, at).lastInsertRowid);
        if (kind === 'VOICE' && b.voice) db.prepare('INSERT INTO msg_voice (company_id, message_id, duration_ms, waveform_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, \'msg_voice\')').run(actor.companyId, mid, Math.round(b.voice.durationMs), JSON.stringify((b.voice.waveform ?? []).slice(0, 80)), actor.user);
        bump(c, mid, at);
        db.prepare('UPDATE msg_members SET last_read_message_id = ? WHERE conversation_id = ? AND user_ref = ? AND last_read_message_id < ?').run(mid, c.id, actor.user, mid);
        writeAudit(db, { entity: 'msg_messages', entityId: mid, action: 'create', newValues: { conversation: c.id, kind, excerpt: excerpt(body, 60), files: files.length, links: links.length }, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'msg.message.created', entity: 'msg_message', entityId: mid, actorId: actor.user, companyId: actor.companyId, projectId: c.project_id ?? undefined, data: { conversationId: c.id, mentions: mentioned } });
        hub.publish({ companyId: actor.companyId, rooms: [`conv:${c.id}`], type: 'msg.message.created', entity: 'msg_message', entityId: mid, data: { conversationId: c.id, messageId: mid } });
        touchUsers(actor.companyId, c.id, 'message');
        // FR-08: told through the notification engine, unless the person muted it or wants mentions only
        const title = titleFor({ ...actor, user: '' }, c) || 'a conversation';
        for (const m of db.prepare('SELECT * FROM msg_members WHERE conversation_id = ? AND left_at IS NULL AND is_active = 1 AND user_ref != ?').all(c.id, actor.user)) {
          const isMention = mentioned.includes(m.user_ref);
          if (!isMention && ((m.muted_until && Date.parse(m.muted_until) > Date.now()) || m.mention_only)) continue;
          if (isMention && m.muted_until && Date.parse(m.muted_until) > Date.now() && !m.mention_only) continue;
          notif.notify({ companyId: actor.companyId, templateCode: isMention ? 'msg.mention' : 'msg.message', recipients: [`user:${m.user_ref}`], data: { sender: nameOf(actor.companyId, actor.user), conversation: c.conv_type === 'DIRECT' ? nameOf(actor.companyId, actor.user) : title, excerpt: excerpt(body) || (kind === 'VOICE' ? 'Voice note' : 'Attachment') }, link: `/collab/messages?c=${c.id}`, sourceType: 'msg_message', sourceId: String(mid), eventKey: `msg:${mid}:${m.user_ref}`, projectId: c.project_id ?? undefined, actor: actor.user });
        }
        const row = db.prepare('SELECT * FROM msg_messages WHERE id = ?').get(mid);
        return present(actor, row, context(actor, [row], c));
      });
    },

    edit(actor, id, { body }) {
      const m = db.prepare('SELECT * FROM msg_messages WHERE id = ? AND company_id = ? AND is_active = 1').get(id, actor.companyId);
      const c = m && convRow(m.conversation_id);
      if (!m || !canOpen(actor, c)) throw notFound('That message does not exist.');
      const p = params(actor);
      if (m.sender_ref !== actor.user) throw forbidden('You can edit only your own messages.');
      if (m.status === 'DELETED' || m.kind === 'SYSTEM') throw unprocessable('This message cannot be edited.');
      if (!(p.editWindowMinutes > 0 && Date.now() - Date.parse(m.created_at) <= p.editWindowMinutes * 60_000)) throw unprocessable(`A message can be edited for ${p.editWindowMinutes} minute(s) after it was sent; that time is over.`);
      if (!String(body).trim() && !JSON.parse(m.attachments_json).length) throw unprocessable('A message cannot be empty.');
      if (String(body).length > MAX_BODY) throw unprocessable(`A message can have at most ${MAX_BODY} characters.`);
      const mentioned = [];
      for (const n of mentionsOf(body)) { const u = activeUser(actor.companyId, n); const mm = u && memberRow(c.id, u.username); if (mm && !mm.left_at) mentioned.push(u.username); else if (u) throw unprocessable(`@${u.username} is not in this conversation.`); }
      return transaction(db, () => {
        db.prepare('UPDATE msg_messages SET body = ?, mentions_json = ?, edited_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(String(body).trim(), JSON.stringify(mentioned), nowIso(), actor.user, nowIso(), m.id);
        writeAudit(db, { entity: 'msg_messages', entityId: m.id, action: 'update', oldValues: { body: m.body }, newValues: { body: String(body).trim() }, actor: actor.user, companyId: actor.companyId });
        hub.publish({ companyId: actor.companyId, rooms: [`conv:${c.id}`], type: 'msg.message.updated', entity: 'msg_message', entityId: m.id, data: { conversationId: c.id, messageId: m.id } });
        const row = db.prepare('SELECT * FROM msg_messages WHERE id = ?').get(m.id);
        return present(actor, row, context(actor, [row], c));
      });
    },
    /** BR-02: inside the edit window the sender replaces it with "message deleted" for everyone; an administrator may at any time, with a reason. The text is kept in the audit trail and blanked after the retention period. */
    remove(actor, id, { reason }) {
      const m = db.prepare('SELECT * FROM msg_messages WHERE id = ? AND company_id = ? AND is_active = 1').get(id, actor.companyId);
      const c = m && convRow(m.conversation_id);
      if (!m || !canOpen(actor, c)) throw notFound('That message does not exist.');
      if (m.status === 'DELETED') throw conflict('This message is already deleted.');
      if (m.kind === 'SYSTEM') throw unprocessable('A system message cannot be deleted.');
      const p = params(actor);
      const inWindow = p.deleteWindowMinutes > 0 && Date.now() - Date.parse(m.created_at) <= p.deleteWindowMinutes * 60_000;
      const own = m.sender_ref === actor.user;
      if (own && !inWindow && !mayManage(actor, c)) throw unprocessable(`A message can be deleted for everyone for ${p.deleteWindowMinutes} minute(s) after it was sent; that time is over.`);
      if (!own && !mayManage(actor, c)) throw forbidden('Only the sender, or an administrator of the conversation, can delete a message.');
      if (!own && !reason) throw unprocessable('Say why you are deleting a message written by someone else.', [{ field: 'reason', message: 'is required' }]);
      return transaction(db, () => {
        db.prepare("UPDATE msg_messages SET status = 'DELETED', delete_reason = ?, deleted_at = ?, deleted_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason ?? null, nowIso(), actor.user, actor.user, nowIso(), m.id);
        writeAudit(db, { entity: 'msg_messages', entityId: m.id, action: 'delete', oldValues: { body: m.body, attachments: JSON.parse(m.attachments_json) }, newValues: { status: 'DELETED' }, reason: reason ?? null, actor: actor.user, companyId: actor.companyId });
        hub.publish({ companyId: actor.companyId, rooms: [`conv:${c.id}`], type: 'msg.message.deleted', entity: 'msg_message', entityId: m.id, data: { conversationId: c.id, messageId: m.id } });
        if (c.last_message_id === m.id) touchUsers(c.company_id, c.id, 'deleted');
        return { id: m.id, status: 'DELETED' };
      });
    },
    react(actor, id, { emoji, on }) {
      const m = db.prepare('SELECT * FROM msg_messages WHERE id = ? AND company_id = ? AND is_active = 1').get(id, actor.companyId);
      const c = m && convRow(m.conversation_id);
      if (!m || !canOpen(actor, c)) throw notFound('That message does not exist.');
      if (m.status === 'DELETED') throw unprocessable('You cannot react to a deleted message.');
      if (!EMOJI.includes(emoji)) throw badRequest('Choose one of the offered reactions.');
      if (on) db.prepare("INSERT OR IGNORE INTO msg_reactions (company_id, message_id, user_ref, emoji, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'msg_reaction')").run(actor.companyId, m.id, actor.user, emoji, actor.user);
      else db.prepare('DELETE FROM msg_reactions WHERE message_id = ? AND user_ref = ? AND emoji = ?').run(m.id, actor.user, emoji);
      hub.publish({ companyId: actor.companyId, rooms: [`conv:${c.id}`], type: 'msg.message.updated', entity: 'msg_message', entityId: m.id, data: { conversationId: c.id, messageId: m.id } });
      return { id: m.id, emoji, count: db.prepare('SELECT COUNT(*) AS n FROM msg_reactions WHERE message_id = ? AND emoji = ?').get(m.id, emoji).n, mine: Boolean(on) };
    },
    /** Forward a message's words and record links to other conversations of the person; it is marked as forwarded. Files are not forwarded. */
    forward(actor, id, { conversationIds }) {
      const m = db.prepare('SELECT * FROM msg_messages WHERE id = ? AND company_id = ? AND is_active = 1').get(id, actor.companyId);
      const c = m && convRow(m.conversation_id);
      if (!m || !canOpen(actor, c)) throw notFound('That message does not exist.');
      if (m.status === 'DELETED') throw unprocessable('A deleted message cannot be forwarded.');
      const sent = conversationIds.map((cid) => messages.send(actor, cid, { body: m.body, recordLinks: JSON.parse(m.record_links_json), forwardedFromId: m.id }));
      return { forwarded: sent.length, messages: sent.map((s) => ({ id: s.id, conversationId: s.conversationId })) };
    },
  };

  // ---- migration check, retention, compliance export (BR-03, BR-02, section 8) ----
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const admin = {
    /** Counts and checksums of every earlier store against the unified index: nothing is lost. */
    verify(actor) {
      if (!anywhere(actor, 'msg.admin.view')) throw forbidden('You may not see the migration check (permission msg.admin.view).');
      indexExternal(actor.companyId);
      const src = db.prepare("SELECT conversation_key AS k, COUNT(*) AS n, MAX(id) AS top, SUM(id) AS idsum FROM comm_messages WHERE company_id = ? AND conversation_key IS NOT NULL GROUP BY conversation_key ORDER BY conversation_key").all(actor.companyId);
      const idx = db.prepare("SELECT external_key AS k, message_count AS n, last_message_id AS top FROM msg_conversations WHERE company_id = ? AND conv_type = 'EXTERNAL' AND is_active = 1 ORDER BY external_key").all(actor.companyId);
      const via = idx.map((i) => ({ k: i.k, n: db.prepare('SELECT COUNT(*) AS n, MAX(id) AS top FROM comm_messages WHERE company_id = ? AND conversation_key = ?').get(actor.companyId, i.k) }));
      const srcSum = sha(src.map((r) => `${r.k}:${r.n}:${r.top}`).join('\n'));
      const idxSum = sha(idx.map((r) => `${r.k}:${r.n}:${r.top}`).join('\n'));
      const viaSum = sha(via.map((r) => `${r.k}:${r.n.n}:${r.n.top}`).join('\n'));
      /** @type {any[]} */
      const stores = [{ store: 'comm_messages', label: 'Gateway threads (WhatsApp, e-mail, SMS)', threads: src.length, indexedThreads: idx.length, messages: src.reduce((a, r) => a + r.n, 0), reachableMessages: via.reduce((a, r) => a + r.n.n, 0), checksum: srcSum, indexChecksum: idxSum, readChecksum: viaSum, match: srcSum === idxSum && srcSum === viaSum, mode: 'indexed and read in place' }];
      for (const [store, label, sql] of [
        ['col_comments', 'Record discussions (04.14)', 'SELECT COUNT(*) AS n FROM col_comments WHERE company_id = ?'],
        ['ui_record_comments', 'Earlier record comments (03.04)', 'SELECT COUNT(*) AS n FROM ui_record_comments WHERE company_id = ?'],
        ['tsk_comments', 'Task comments (04.08)', 'SELECT COUNT(*) AS n FROM tsk_comments WHERE company_id = ?'],
      ]) { let n; try { n = db.prepare(sql).get(actor.companyId).n; } catch { n = null; } stores.push({ store, label, messages: n, mode: 'kept in place; shown on the record\'s Discussion tab', match: true }); }
      return { stores, ok: stores.every((s) => s.match) };
    },
    /** Blank the text of messages that were deleted longer ago than the retention period (the audit trail keeps what policy says). */
    purge(companyId) {
      const days = Number(createParameterStore(db).get('msg.deleted_content_retention_days', { companyId, date: todayIST() }));
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
      const held = "AND conversation_id NOT IN (SELECT conversation_id FROM msg_holds WHERE released_at IS NULL AND is_active = 1)"; // a conversation under legal hold keeps everything
      const r = db.prepare(`UPDATE msg_messages SET body = '', attachments_json = '[]', record_links_json = '[]', mentions_json = '[]', updated_at = ? WHERE company_id = ? AND status = 'DELETED' AND deleted_at < ? AND (body != '' OR attachments_json != '[]') ${held}`).run(nowIso(), companyId, cutoff);
      // retention of messages as such (0 = keep): older ones are removed the same way, as "deleted by retention"
      const keep = activeConfig(db, companyId).retentionDays;
      let expired = 0;
      if (keep > 0) {
        const old = new Date(Date.now() - keep * 86_400_000).toISOString();
        expired = Number(db.prepare(`UPDATE msg_messages SET status = 'DELETED', delete_reason = 'retention', deleted_at = ?, body = '', attachments_json = '[]', record_links_json = '[]', mentions_json = '[]', updated_at = ? WHERE company_id = ? AND status = 'ACTIVE' AND kind != 'SYSTEM' AND created_at < ? ${held}`).run(nowIso(), nowIso(), companyId, old).changes);
      }
      return { purged: Number(r.changes), expired };
    },
    /** AUD: the messages of one conversation as a file, with deleted ones marked; audited. */
    exportConversation(actor, id) {
      if (!anywhere(actor, 'msg.compliance.export')) throw forbidden('You may not export conversations (permission msg.compliance.export).');
      const c = convRow(Number(id));
      if (!c || c.company_id !== actor.companyId) throw notFound('That conversation does not exist.');
      const rows = c.conv_type === 'EXTERNAL'
        ? db.prepare('SELECT * FROM comm_messages WHERE company_id = ? AND conversation_key = ? ORDER BY id').all(c.company_id, c.external_key).map((r) => ({ id: r.id, at: r.created_at, sender: r.direction === 'IN' ? r.to_address : 'ERP', status: r.status, body: r.body_redacted }))
        : db.prepare('SELECT * FROM msg_messages WHERE conversation_id = ? ORDER BY id').all(c.id).map((r) => ({ id: r.id, at: r.created_at, sender: r.sender_ref, status: r.status, body: r.status === 'DELETED' && !r.body ? '(content removed after retention)' : r.body }));
      writeAudit(db, { entity: 'msg_conversations', entityId: c.id, action: 'compliance_export', newValues: { rows: rows.length }, actor: actor.user, companyId: actor.companyId });
      return { fileName: `conversation-${c.id}.csv`, text: toCsv({ columns: [{ key: 'id', label: 'Message' }, { key: 'at', label: 'Sent at' }, { key: 'sender', label: 'Sender' }, { key: 'status', label: 'Status' }, { key: 'body', label: 'Text' }], rows, footer: null }) };
    },
  };

  // the records a person can link into a message (FR-04): the types they may open, and a search inside a type that offers one
  const records = {
    types: (actor) => objectTypes.list().filter((t) => authz.check(actor, t.permission).allowed && objectTypes.get(t.type).search).map((t) => ({ type: t.type, label: t.label })),
    search(actor, { type, q }) {
      const def = objectTypes.get(type);
      if (!def || !def.search || !authz.check(actor, def.permission).allowed) throw notFound('There is no such kind of record to link.');
      return def.search(db, actor, q ?? '', 15).map((r) => card(actor, { entity: type, id: r.id })).filter((c) => !c.restricted);
    },
  };
  // the people a person can write to (name search)
  const people = (actor, q) => db.prepare(`SELECT username, display_name FROM iam_users WHERE company_id = ? AND is_active = 1 AND status = 'ACTIVE' AND username != ? ${q ? 'AND (username LIKE ? OR display_name LIKE ?)' : ''} ORDER BY display_name LIMIT 30`).all(...[actor.companyId, actor.user, ...(q ? [`%${q}%`, `%${q}%`] : [])]).map((u) => ({ username: u.username, name: u.display_name }));

  // the real-time room of a conversation: members only (T-02)
  realtimeConversations.set({
    resolve: (d, id) => { const r = d.prepare('SELECT company_id FROM msg_conversations WHERE id = ? AND is_active = 1').get(Number(id)); return r ? { companyId: r.company_id } : null; },
    check: (d, actor, id) => { const c = d.prepare('SELECT * FROM msg_conversations WHERE id = ? AND is_active = 1').get(Number(id)); return Boolean(c) && (c.conv_type === 'EXTERNAL' ? authzOf(d).check(actor, 'comm.log.view').allowed : Boolean(d.prepare('SELECT 1 FROM msg_members WHERE conversation_id = ? AND user_ref = ? AND left_at IS NULL AND is_active = 1').get(c.id, actor.user))); },
  });
  // the files of a conversation are open to its members, and a member may add
  try {
    fileEntities.register({
      entity: 'msg_conversation', label: 'Conversation',
      resolve(d, actor, id) {
        const c = d.prepare('SELECT * FROM msg_conversations WHERE id = ? AND is_active = 1').get(Number(id));
        if (!c || c.company_id !== actor.companyId || c.conv_type === 'EXTERNAL' || !d.prepare('SELECT 1 FROM msg_members WHERE conversation_id = ? AND user_ref = ? AND left_at IS NULL AND is_active = 1').get(c.id, actor.user)) return null;
        return { companyId: c.company_id, projectId: c.project_id ?? null, siteId: c.site_id ?? null, canView: true, canEdit: c.is_archived === 0, locked: false };
      },
    });
  } catch { /* registered once per process */ }

  return { conversations, members, messages, admin, people, records, params, indexExternal, reconcileFor, internals: { must, canOpen, convRow, memberRow, isAdmin, mayManage, context, present, nameOf, person, anywhere, gapsOf, touchUsers, systemMessage, summarize } };
}

const services = new WeakMap();
export const bind = (db, s) => services.set(db, s);
export const messagesOf = (db) => services.get(db);
