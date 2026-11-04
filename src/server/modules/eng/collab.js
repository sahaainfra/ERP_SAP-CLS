import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { assertPermissionAnywhere } from '../../platform/auth/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { createParameterStore } from '../../platform/parameters/index.js';
import { todayIST } from '../../../shared/dates.js';

// Collaboration on any record (part 04.14): threaded comments with @mentions, a timeline that merges everything that happened to a record, and trace links between records (source to derived).
// The record itself is reached only through the object type registry (03.04): whoever may see the record may read and write its discussion, timeline and trace, nobody else (BR-01 also applies to a mention).
// Trace links are written by services (`trace.add`, or the event `col.trace.requested`); a person may add one by hand only with a reason (BR-02).
export const REACTIONS = ['like', 'ack', 'eyes', 'thanks'];
export const RELATIONS = ['DERIVED', 'AMENDS', 'FULFILS', 'SETTLES', 'REFERS'];
export const TIMELINE_KINDS = ['audit', 'approval', 'workflow', 'comment', 'document', 'task', 'message'];
export const COMMENT_FILE_ENTITY = 'col_comment';
const MENTION_RE = /(?:^|[^\w@])@([A-Za-z0-9._-]{2,40})/g;
const MAX_NODES = 200;
const MAX_SOURCE_ROWS = 600;

const nowIso = () => new Date().toISOString();
/** A time as milliseconds, whether it was stored as an ISO string or in the SQLite style. */
export const toMs = (t) => {
  if (!t) return 0;
  const s = String(t);
  const v = Date.parse(/^\d{4}-\d\d-\d\d \d/.test(s) ? `${s.replace(' ', 'T')}Z` : s);
  return Number.isNaN(v) ? 0 : v;
};
const keyId = (id) => (/^\d+$/.test(String(id)) ? Number(id) : String(id));
const excerpt = (s, n = 140) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
/** The usernames named with @ in a text, in order, without repeats. */
export function mentionsOf(text) {
  const out = [];
  for (const m of String(text).matchAll(MENTION_RE)) {
    const name = m[1].replace(/[._-]+$/, '');
    if (name.length >= 2 && !out.some((x) => x.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}

export function createCollabService({ db }) {
  const authz = authzOf(db);
  const notif = notificationsOf(db);
  const params = (actor) => {
    const store = createParameterStore(db);
    const ctx = { companyId: actor.companyId, date: todayIST() };
    return {
      editWindowMinutes: Number(store.get('col.comment.edit_window_minutes', ctx)),
      maxLength: Number(store.get('col.comment.max_length', ctx)),
      reactionsEnabled: store.get('col.reactions.enabled', ctx) === true,
    };
  };
  const names = new Map();
  const displayName = (companyId, username) => {
    const k = `${companyId}:${username}`;
    if (!names.has(k)) names.set(k, db.prepare('SELECT display_name FROM iam_users WHERE company_id = ? AND username = ?').get(companyId, username)?.display_name ?? username);
    return names.get(k);
  };
  const person = (companyId, username) => ({ username, name: username ? displayName(companyId, username) : null });

  // ---- the record: found through the object type registry, with the person's own scope ----
  function record(actor, type, id) {
    const def = objectTypes.get(type);
    if (!def) throw notFound(`There is no record type called ${type}.`);
    assertPermissionAnywhere(actor, def.permission);
    const access = def.access(db, actor, keyId(id));
    if (!access) throw notFound('That record does not exist.');
    return { def, access, id: String(id) };
  }
  /** Whether someone else (a named person) could open the record: their grants, their scope. */
  function userCanView(companyId, username, type, id) {
    const def = objectTypes.get(type);
    const u = db.prepare("SELECT id, username, roles_json FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND status = 'ACTIVE' AND is_active = 1").get(companyId, username);
    if (!def || !u) return null;
    let a;
    try { a = authz.enrich({ user: u.username, userId: u.id, companyId, roles: JSON.parse(u.roles_json || '[]') }); } catch { return { username: u.username, can: false }; }
    let can;
    try { can = authz.check(a, def.permission).allowed && Boolean(def.access(db, a, keyId(id))); } catch { can = false; }
    return { username: u.username, can };
  }
  /** The label shown for a record: the type's own summary if it has one, else its label and number. */
  function describe(actor, type, id) {
    const def = objectTypes.get(type);
    if (!def) return null;
    let access;
    try { access = authz.check(actor, def.permission).allowed ? def.access(db, actor, keyId(id)) : null; } catch { access = null; }
    if (!access) return null;
    const s = def.summary ? def.summary(db, actor, keyId(id)) : null;
    return { type, id: String(id), typeLabel: def.label, label: s?.label ?? `${def.label} ${id}`, status: s?.status ?? access.status ?? null, amount: s?.amount ?? null, route: s?.route ?? (def.route ? def.route(keyId(id)) : null), projectId: access.projectId ?? null };
  }
  const isModerator = (actor, access) => authz.check(actor, 'col.comment.moderate', { companyId: actor.companyId, projectId: access.projectId ?? undefined, siteId: access.siteId ?? undefined }).allowed;
  const windowOpen = (c, p) => p.editWindowMinutes > 0 && Date.now() - toMs(c.created_at) <= p.editWindowMinutes * 60_000;

  // ---- comments ----
  function presentComment(actor, c, access, p, mods) {
    const deleted = c.status === 'DELETED';
    const mine = c.created_by === actor.user;
    const reactions = Object.fromEntries(REACTIONS.map((r) => [r, { count: 0, mine: false }]));
    for (const r of mods.reactions.get(c.id) ?? []) { reactions[r.reaction].count += 1; if (r.reacted_by === actor.user) reactions[r.reaction].mine = true; }
    return {
      id: c.id, parentId: c.parent_id, author: person(actor.companyId, c.created_by), status: c.status,
      body: deleted && !mods.moderator ? '' : c.body, deletedReason: deleted && mods.moderator ? c.delete_reason : null,
      createdAt: c.created_at, editedAt: c.edited_at, editCount: c.edit_count, version: c.version,
      mentions: deleted ? [] : (mods.mentions.get(c.id) ?? []), reactions, files: deleted ? [] : (mods.files.get(c.id) ?? []),
      canEdit: !deleted && mine && windowOpen(c, p), canDelete: !deleted && (mine || mods.moderator),
      replies: [],
    };
  }
  const comments = {
    list(actor, { entity, id }) {
      const { access } = record(actor, entity, id);
      const p = params(actor);
      const rows = db.prepare("SELECT * FROM col_comments WHERE company_id = ? AND entity = ? AND entity_id = ? AND is_active = 1 ORDER BY id").all(actor.companyId, entity, String(id));
      const ids = rows.map((r) => r.id);
      const mods = { moderator: isModerator(actor, access), reactions: new Map(), mentions: new Map(), files: new Map() };
      if (ids.length) {
        const q = ids.map(() => '?').join(',');
        for (const r of db.prepare(`SELECT comment_id, reaction, reacted_by FROM col_reactions WHERE comment_id IN (${q}) AND is_active = 1`).all(...ids)) { if (!mods.reactions.has(r.comment_id)) mods.reactions.set(r.comment_id, []); mods.reactions.get(r.comment_id).push(r); }
        for (const m of db.prepare(`SELECT comment_id, mentioned_user FROM col_mentions WHERE comment_id IN (${q}) AND is_active = 1 ORDER BY id`).all(...ids)) { if (!mods.mentions.has(m.comment_id)) mods.mentions.set(m.comment_id, []); mods.mentions.get(m.comment_id).push(person(actor.companyId, m.mentioned_user)); }
        for (const f of db.prepare(`SELECT id, linked_id, original_name, size_bytes, scan_status, mime FROM core_files WHERE linked_entity = ? AND linked_id IN (${q}) AND company_id = ? AND is_active = 1 AND deleted_at IS NULL ORDER BY id`).all(COMMENT_FILE_ENTITY, ...ids, actor.companyId)) { if (!mods.files.has(f.linked_id)) mods.files.set(f.linked_id, []); mods.files.get(f.linked_id).push({ id: f.id, name: f.original_name, size: f.size_bytes, mime: f.mime, scan: f.scan_status }); }
      }
      const byId = new Map(rows.map((r) => [r.id, presentComment(actor, r, access, p, mods)]));
      const top = [];
      for (const c of byId.values()) { const parent = c.parentId ? byId.get(c.parentId) : null; if (parent) parent.replies.push(c); else top.push(c); }
      const legacy = db.prepare('SELECT id, author_ref, body, created_at FROM ui_record_comments WHERE company_id = ? AND entity_type = ? AND entity_id = ? AND deleted_at IS NULL ORDER BY id').all(actor.companyId, entity, keyId(id))
        .map((c) => ({ id: `legacy-${c.id}`, author: person(actor.companyId, c.author_ref), body: c.body, createdAt: c.created_at, legacy: true }));
      return { comments: top, legacy, total: rows.filter((r) => r.status === 'ACTIVE').length, settings: { ...p, reactions: REACTIONS }, canModerate: mods.moderator };
    },

    create(actor, { entity, id, body, parentId = null }) {
      const { def, access } = record(actor, entity, id);
      const p = params(actor);
      if (body.length > p.maxLength) throw unprocessable(`A comment can have at most ${p.maxLength} characters; this one has ${body.length}.`, [{ field: 'body', message: `At most ${p.maxLength} characters` }]);
      let parent = null;
      if (parentId) {
        parent = db.prepare('SELECT * FROM col_comments WHERE id = ? AND company_id = ? AND entity = ? AND entity_id = ? AND is_active = 1').get(parentId, actor.companyId, entity, String(id));
        if (!parent) throw notFound('The comment you are replying to does not exist on this record.');
      }
      // BR-01: a person who cannot see the record is never mentioned; the whole comment waits until the mention is removed
      const named = mentionsOf(body);
      const found = []; const unknown = []; const blocked = [];
      for (const n of named) {
        const r = userCanView(actor.companyId, n, entity, id);
        if (!r) unknown.push(n); else if (!r.can) blocked.push(r.username); else found.push(r.username);
      }
      if (blocked.length) throw unprocessable(`${blocked.map((b) => `@${b}`).join(', ')} cannot see this record, so the comment was not posted. Remove the mention, or ask someone with access to share it.`, blocked.map((b) => ({ field: 'body', message: `@${b} has no access to this record` })));
      const label = describe(actor, entity, id)?.label ?? `${def.label} ${id}`;
      return transaction(db, () => {
        const cid = Number(db.prepare("INSERT INTO col_comments (company_id, entity, entity_id, entity_label, parent_id, body, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'col_comment')")
          .run(actor.companyId, entity, String(id), label, parent?.id ?? null, body, access.projectId ?? null, access.siteId ?? null, actor.user).lastInsertRowid);
        const mentioned = found.filter((u) => u.toLowerCase() !== actor.user.toLowerCase());
        for (const u of found) db.prepare("INSERT INTO col_mentions (company_id, comment_id, mentioned_user, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'col_comment')").run(actor.companyId, cid, u, access.projectId ?? null, access.siteId ?? null, actor.user);
        writeAudit(db, { entity: 'col_comments', entityId: cid, action: 'create', newValues: { record: `${entity}:${id}`, parent: parent?.id ?? null, mentions: found, excerpt: excerpt(body, 80) }, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'col.comment.created', entity: 'col_comment', entityId: cid, actorId: actor.user, companyId: actor.companyId, projectId: access.projectId ?? undefined, siteId: access.siteId ?? undefined, data: { record: `${entity}:${id}`, mentions: found, reply: Boolean(parent) } });
        const link = (def.route ? def.route(keyId(id)) : '/notifications');
        const data = { author: displayName(actor.companyId, actor.user), record: label, excerpt: excerpt(body) };
        for (const u of mentioned) notify(actor, 'col.mention', u, data, link, `col:${cid}:m:${u}`, access);
        if (parent && parent.created_by && parent.created_by !== actor.user && !mentioned.some((u) => u.toLowerCase() === parent.created_by.toLowerCase()) && userCanView(actor.companyId, parent.created_by, entity, id)?.can) notify(actor, 'col.reply', parent.created_by, data, link, `col:${cid}:r`, access);
        return { id: cid, mentions: found, ignored: unknown };
      });
    },

    edit(actor, commentId, { body, version }) {
      const c = ownComment(actor, commentId);
      const { access, def } = record(actor, c.entity, c.entity_id);
      const p = params(actor);
      if (c.status !== 'ACTIVE') throw unprocessable('A deleted comment cannot be edited.');
      if (c.created_by !== actor.user) throw forbidden('Only the author can edit a comment.');
      if (!windowOpen(c, p)) throw unprocessable(`A comment can be edited for ${p.editWindowMinutes} minute(s) after it was posted; that time is over. Write a new comment instead.`);
      if (body.length > p.maxLength) throw unprocessable(`A comment can have at most ${p.maxLength} characters.`);
      if (version !== undefined && version !== c.version) throw conflict('Someone changed this comment since you opened it. Reload and try again.');
      const named = mentionsOf(body); const found = []; const blocked = [];
      for (const n of named) { const r = userCanView(actor.companyId, n, c.entity, c.entity_id); if (r && !r.can) blocked.push(r.username); else if (r) found.push(r.username); }
      if (blocked.length) throw unprocessable(`${blocked.map((b) => `@${b}`).join(', ')} cannot see this record, so the comment was not changed. Remove the mention first.`);
      return transaction(db, () => {
        const before = db.prepare("SELECT mentioned_user FROM col_mentions WHERE comment_id = ? AND is_active = 1").all(c.id).map((m) => m.mentioned_user);
        db.prepare('UPDATE col_comments SET body = ?, edited_at = ?, edit_count = edit_count + 1, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(body, nowIso(), actor.user, nowIso(), c.id);
        db.prepare('DELETE FROM col_mentions WHERE comment_id = ? AND mentioned_user NOT IN (SELECT value FROM json_each(?))').run(c.id, JSON.stringify(found));
        const added = found.filter((u) => !before.some((b) => b.toLowerCase() === u.toLowerCase()));
        for (const u of added) db.prepare("INSERT INTO col_mentions (company_id, comment_id, mentioned_user, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'col_comment')").run(actor.companyId, c.id, u, c.project_id, c.site_id, actor.user);
        writeAudit(db, { entity: 'col_comments', entityId: c.id, action: 'update', oldValues: { body: c.body }, newValues: { body }, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'col.comment.edited', entity: 'col_comment', entityId: c.id, actorId: actor.user, companyId: actor.companyId, projectId: c.project_id ?? undefined, data: { record: `${c.entity}:${c.entity_id}`, mentions: found } });
        const data = { author: displayName(actor.companyId, actor.user), record: c.entity_label ?? def.label, excerpt: excerpt(body) };
        for (const u of added.filter((x) => x.toLowerCase() !== actor.user.toLowerCase())) notify(actor, 'col.mention', u, data, def.route ? def.route(keyId(c.entity_id)) : '/notifications', `col:${c.id}:m:${u}`, access);
        return { id: c.id, mentions: found, editedAt: nowIso() };
      });
    },

    remove(actor, commentId, { reason }) {
      const c = ownComment(actor, commentId);
      const { access } = record(actor, c.entity, c.entity_id);
      if (c.status === 'DELETED') throw unprocessable('This comment is already deleted.');
      const mine = c.created_by === actor.user;
      if (!mine && !isModerator(actor, access)) throw forbidden('Only the author or a moderator (permission col.comment.moderate) can delete a comment.');
      if (!mine && !reason) throw unprocessable('Say why you are deleting a comment written by someone else.', [{ field: 'reason', message: 'Required for another person\'s comment' }]);
      return transaction(db, () => {
        db.prepare("UPDATE col_comments SET status = 'DELETED', delete_reason = ?, deleted_at = ?, deleted_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason ?? 'Deleted by the author', nowIso(), actor.user, actor.user, nowIso(), c.id);
        db.prepare('DELETE FROM col_mentions WHERE comment_id = ?').run(c.id);
        writeAudit(db, { entity: 'col_comments', entityId: c.id, action: 'delete', oldValues: { body: c.body }, newValues: { status: 'DELETED' }, reason: reason ?? null, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'col.comment.deleted', entity: 'col_comment', entityId: c.id, actorId: actor.user, companyId: actor.companyId, projectId: c.project_id ?? undefined, data: { record: `${c.entity}:${c.entity_id}`, moderated: !mine } });
        return { id: c.id, status: 'DELETED' };
      });
    },

    react(actor, commentId, { reaction, on }) {
      const c = ownComment(actor, commentId);
      record(actor, c.entity, c.entity_id);
      if (!params(actor).reactionsEnabled) throw unprocessable('Reactions are switched off for this company.');
      if (c.status !== 'ACTIVE') throw unprocessable('You cannot react to a deleted comment.');
      if (on) db.prepare("INSERT OR IGNORE INTO col_reactions (company_id, comment_id, reaction, reacted_by, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'col_comment')").run(actor.companyId, c.id, reaction, actor.user, c.project_id, c.site_id, actor.user);
      else db.prepare('DELETE FROM col_reactions WHERE comment_id = ? AND reacted_by = ? AND reaction = ?').run(c.id, actor.user, reaction);
      const count = db.prepare('SELECT COUNT(*) AS n FROM col_reactions WHERE comment_id = ? AND reaction = ?').get(c.id, reaction).n;
      return { id: c.id, reaction, count, mine: Boolean(on) };
    },
  };
  function ownComment(actor, id) {
    const c = db.prepare('SELECT * FROM col_comments WHERE id = ? AND company_id = ? AND is_active = 1').get(id, actor.companyId);
    if (!c) throw notFound('That comment does not exist.');
    return c;
  }
  function notify(actor, code, username, data, link, eventKey, access) {
    notif.notify({ companyId: actor.companyId, templateCode: code, recipients: [`user:${username}`], data, link, sourceType: 'col_comment', sourceId: eventKey, eventKey, projectId: access?.projectId ?? undefined, siteId: access?.siteId ?? undefined, actor: actor.user });
  }

  // ---- the mentions inbox (FR-05): only mentions of records the person can still open ----
  const mentions = {
    list(actor, { unread = false, limit = 30, offset = 0 } = {}) {
      const rows = db.prepare(`SELECT m.id AS mention_id, m.read_at, c.* FROM col_mentions m JOIN col_comments c ON c.id = m.comment_id
        WHERE m.company_id = ? AND m.mentioned_user = ? AND m.is_active = 1 AND c.status = 'ACTIVE' AND c.is_active = 1 ${unread ? 'AND m.read_at IS NULL' : ''} ORDER BY m.id DESC LIMIT 500`).all(actor.companyId, actor.user);
      const out = [];
      for (const r of rows) {
        const d = describe(actor, r.entity, r.entity_id);
        if (!d) continue; // the record is no longer open to this person
        out.push({ id: r.mention_id, commentId: r.id, author: person(actor.companyId, r.created_by), excerpt: excerpt(r.body, 220), at: r.created_at, read: Boolean(r.read_at), record: { type: r.entity, id: r.entity_id, label: d.label, typeLabel: d.typeLabel, route: d.route } });
      }
      return { rows: out.slice(offset, offset + limit), total: out.length, unread: out.filter((x) => !x.read).length };
    },
    unreadCount(actor) { return this.list(actor, { unread: true, limit: 1 }).total; },
    markRead(actor, { ids, all }) {
      const now = nowIso();
      const r = all
        ? db.prepare('UPDATE col_mentions SET read_at = ? WHERE company_id = ? AND mentioned_user = ? AND read_at IS NULL').run(now, actor.companyId, actor.user)
        : db.prepare(`UPDATE col_mentions SET read_at = ? WHERE company_id = ? AND mentioned_user = ? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',') || 'NULL'})`).run(now, actor.companyId, actor.user, ...ids);
      return { marked: Number(r.changes) };
    },
  };

  // ---- the timeline (FR-02): every source, one list, newest first ----
  const diff = (a, b) => {
    const out = {};
    for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) out[k] = { old: a?.[k], new: b?.[k] };
    return out;
  };
  const jsonOf = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
  const mayAny = (actor, key) => authz.check(actor, key).allowed;
  const sourcesForRecord = (actor, def, type, id) => {
    const names = new Set([type, def.attachmentEntity, def.documentType, def.approvalTarget, ...(def.auditEntities ? def.auditEntities(keyId(id)).map((e) => e.entity) : [])].filter(Boolean));
    return { names: [...names], docType: def.documentType };
  };

  function recordEvents(actor, type, id, def, kinds) {
    const out = [];
    const want = (k) => !kinds || kinds.includes(k);
    const { names, docType } = sourcesForRecord(actor, def, type, id);
    const mask = (v) => (def.maskEntries ? def.maskEntries(db, actor, v) : v);
    if (want('audit') && def.auditEntities) {
      for (const { entity, id: eid } of def.auditEntities(keyId(id))) {
        for (const a of db.prepare('SELECT id, action, old_values, new_values, reason, actor, created_at FROM core_audit_log WHERE entity = ? AND entity_id = ? ORDER BY id DESC LIMIT ?').all(entity, String(eid), MAX_SOURCE_ROWS)) {
          if (a.action === 'comment') continue;
          const o = mask(jsonOf(a.old_values)); const n = mask(jsonOf(a.new_values));
          out.push({ key: `audit-${a.id}`, kind: 'audit', at: a.created_at, actor: a.actor, action: a.action, summary: `${a.action}`, reason: a.reason, changes: a.action === 'create' ? diff({}, n) : diff(o, n) });
        }
      }
    }
    if (want('approval') && def.approvalTarget && Number.isInteger(keyId(id))) {
      for (const r of db.prepare('SELECT id, title, status, reason, requested_by, created_at FROM core_change_requests WHERE company_id = ? AND target_type = ? AND target_id = ? AND is_active = 1').all(actor.companyId, def.approvalTarget, keyId(id))) {
        out.push({ key: `approval-${r.id}`, kind: 'approval', at: r.created_at, actor: r.requested_by, action: 'sent for approval', summary: r.title, reason: r.reason, changes: {} });
        for (const s of db.prepare('SELECT id, step_no, role_code, decision, decided_by, decided_at, comment FROM core_change_request_steps WHERE request_id = ?').all(r.id)) out.push({ key: `approval-${r.id}-${s.id}`, kind: 'approval', at: s.decided_at, actor: s.decided_by, action: s.decision.toLowerCase(), summary: `Step ${s.step_no}, ${s.role_code.replace('|', ' or ')}`, reason: s.comment, changes: {} });
      }
    }
    if (want('workflow') && docType) {
      for (const h of db.prepare(`SELECT h.id, h.event, h.actor, h.comment, h.step_code, h.at, i.doc_ref FROM wf_history h JOIN wf_instances i ON i.id = h.instance_id WHERE i.company_id = ? AND i.doc_type = ? AND i.doc_id = ? ORDER BY h.id DESC LIMIT ?`).all(actor.companyId, docType, String(id), MAX_SOURCE_ROWS)) {
        out.push({ key: `workflow-${h.id}`, kind: 'workflow', at: h.at, actor: h.actor, action: h.event.toLowerCase().replace(/_/g, ' '), summary: h.step_code ? `Step ${h.step_code}` : 'Approval workflow', reason: h.comment, changes: {} });
      }
    }
    if (want('comment')) {
      for (const c of db.prepare("SELECT id, body, created_by, created_at, parent_id FROM col_comments WHERE company_id = ? AND entity = ? AND entity_id = ? AND is_active = 1 AND status = 'ACTIVE' ORDER BY id DESC LIMIT ?").all(actor.companyId, type, String(id), MAX_SOURCE_ROWS)) out.push({ key: `comment-${c.id}`, kind: 'comment', at: c.created_at, actor: c.created_by, action: c.parent_id ? 'replied' : 'commented', summary: excerpt(c.body, 200), reason: null, changes: {}, ref: { commentId: c.id } });
      for (const c of db.prepare('SELECT id, body, author_ref, created_at FROM ui_record_comments WHERE company_id = ? AND entity_type = ? AND entity_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(actor.companyId, type, keyId(id), MAX_SOURCE_ROWS)) out.push({ key: `comment-legacy-${c.id}`, kind: 'comment', at: c.created_at, actor: c.author_ref, action: 'commented', summary: excerpt(c.body, 200), reason: null, changes: {} });
    }
    if (want('document') && mayAny(actor, 'doc.document.view')) {
      const levels = ['PUBLIC', 'INTERNAL', ...(mayAny(actor, 'doc.document.view_confidential') ? ['CONFIDENTIAL'] : []), ...(mayAny(actor, 'doc.document.view_restricted') ? ['RESTRICTED'] : [])];
      const q = names.map(() => '?').join(',');
      for (const v of db.prepare(`SELECT v.id, v.revision, v.change_note, v.status, v.created_by, v.created_at, d.doc_no, d.title FROM doc_links l JOIN doc_documents d ON d.id = l.document_id JOIN doc_versions v ON v.document_id = d.id
        WHERE l.company_id = ? AND l.entity IN (${q}) AND l.entity_id = ? AND l.is_active = 1 AND d.is_active = 1 AND d.confidentiality IN (${levels.map(() => '?').join(',')}) ORDER BY v.id DESC LIMIT ?`).all(actor.companyId, ...names, String(id), ...levels, MAX_SOURCE_ROWS)) {
        out.push({ key: `document-${v.id}`, kind: 'document', at: v.created_at, actor: v.created_by, action: `revision ${v.revision} ${String(v.status).toLowerCase().replace('_', ' ')}`, summary: `${v.doc_no}: ${v.title}`, reason: v.change_note, changes: {} });
      }
    }
    if (want('task')) {
      const q = names.map(() => '?').join(',');
      for (const t of db.prepare(`SELECT id, title, status, assigner, created_at FROM tsk_tasks WHERE company_id = ? AND entity IN (${q}) AND entity_id = ? AND is_active = 1 ORDER BY id DESC LIMIT ?`).all(actor.companyId, ...names, String(id), MAX_SOURCE_ROWS)) out.push({ key: `task-${t.id}`, kind: 'task', at: t.created_at, actor: t.assigner, action: `task ${String(t.status).toLowerCase().replace('_', ' ')}`, summary: t.title, reason: null, changes: {} });
    }
    if (want('message') && mayAny(actor, 'comm.log.view')) {
      const q = names.map(() => '?').join(',');
      for (const m of db.prepare(`SELECT id, channel, subject, status, created_by, created_at FROM comm_messages WHERE company_id = ? AND related_entity IN (${q}) AND related_id = ? ORDER BY id DESC LIMIT ?`).all(actor.companyId, ...names, String(id), MAX_SOURCE_ROWS)) out.push({ key: `message-${m.id}`, kind: 'message', at: m.created_at, actor: m.created_by, action: `${m.channel.toLowerCase()} message ${String(m.status).toLowerCase()}`, summary: m.subject ?? '(no subject)', reason: null, changes: {} });
    }
    return out;
  }
  const finish = (events, { from, to, q, limit, offset }, companyId) => {
    const f = from ? toMs(from) : null; const t = to ? toMs(`${to}${to.length === 10 ? 'T23:59:59.999Z' : ''}`) : null;
    const needle = q ? q.toLowerCase() : null;
    const rows = events.map((e) => ({ ...e, ms: toMs(e.at) }))
      .filter((e) => (f === null || e.ms >= (from.length === 10 ? toMs(`${from}T00:00:00.000Z`) : f)) && (t === null || e.ms <= t))
      .filter((e) => !needle || `${e.actor ?? ''} ${e.action} ${e.summary ?? ''} ${e.reason ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => b.ms - a.ms || (a.key < b.key ? 1 : -1));
    const counts = Object.fromEntries(TIMELINE_KINDS.map((k) => [k, 0]));
    for (const e of rows) counts[e.kind] += 1;
    return { total: rows.length, counts, rows: rows.slice(offset, offset + limit).map(({ ms: _ms, ...e }) => ({ ...e, actorName: e.actor ? displayName(companyId, e.actor) : null })) };
  };
  const timeline = {
    record(actor, { entity, id, kinds, from, to, q, limit = 50, offset = 0 }) {
      const { def } = record(actor, entity, id);
      const res = finish(recordEvents(actor, entity, id, def, kinds), { from, to, q, limit, offset }, actor.companyId);
      return { ...res, kinds: TIMELINE_KINDS };
    },
    /** The project activity feed (FR-04): what happened across the project's records, comments, workflow, documents and tasks. */
    project(actor, { projectId, kinds, from, to, q, limit = 50, offset = 0 }) {
      const projects = db.prepare(`SELECT p.id, p.code, p.name FROM org_projects p WHERE p.company_id = ? AND p.is_active = 1 AND ${authz.scopeFilter(actor, 'col.activity.view', { project: 'p.id' }).sql} ORDER BY p.code`).all(actor.companyId);
      if (!projectId) return { projects, rows: [], total: 0, counts: Object.fromEntries(TIMELINE_KINDS.map((k) => [k, 0])), kinds: TIMELINE_KINDS, projectId: null };
      if (!authz.check(actor, 'col.activity.view', { companyId: actor.companyId, projectId }).allowed) throw forbidden('You may not see the activity of this project (permission col.activity.view).');
      const want = (k) => !kinds || kinds.includes(k);
      const events = [];
      const cache = new Map();
      const seen = (type, id) => { const k = `${type}:${id}`; if (!cache.has(k)) cache.set(k, describe(actor, type, id)); return cache.get(k); };
      const tag = (e, d) => ({ ...e, record: d ? { type: d.type, id: d.id, label: d.label, typeLabel: d.typeLabel, route: d.route } : null });
      if (want('comment')) {
        for (const c of db.prepare("SELECT id, entity, entity_id, entity_label, body, created_by, created_at, parent_id FROM col_comments WHERE company_id = ? AND project_id = ? AND is_active = 1 AND status = 'ACTIVE' ORDER BY id DESC LIMIT ?").all(actor.companyId, projectId, MAX_SOURCE_ROWS)) {
          const d = seen(c.entity, c.entity_id);
          if (d) events.push(tag({ key: `comment-${c.id}`, kind: 'comment', at: c.created_at, actor: c.created_by, action: c.parent_id ? 'replied' : 'commented', summary: excerpt(c.body, 200), reason: null, changes: {} }, d));
        }
      }
      for (const def of typeDefs()) {
        const ids = def.projectRecords ? def.projectRecords(db, actor.companyId, projectId, 200) : [];
        for (const rid of ids) {
          const d = seen(def.type, rid);
          if (!d) continue;
          for (const e of recordEvents(actor, def.type, rid, def, (kinds ?? TIMELINE_KINDS).filter((k) => k !== 'comment' && k !== 'task' && k !== 'message' && k !== 'document'))) events.push(tag({ ...e, key: `${def.type}-${rid}-${e.key}` }, d));
        }
      }
      if (want('task')) {
        for (const t of db.prepare('SELECT id, title, status, assigner, entity, entity_id, created_at FROM tsk_tasks WHERE company_id = ? AND project_id = ? AND is_active = 1 ORDER BY id DESC LIMIT ?').all(actor.companyId, projectId, MAX_SOURCE_ROWS)) {
          const d = t.entity && objectTypes.get(t.entity) ? seen(t.entity, t.entity_id) : null;
          if (t.entity && objectTypes.get(t.entity) && !d) continue;
          events.push(tag({ key: `task-${t.id}`, kind: 'task', at: t.created_at, actor: t.assigner, action: `task ${String(t.status).toLowerCase().replace('_', ' ')}`, summary: t.title, reason: null, changes: {} }, d));
        }
      }
      if (want('document') && mayAny(actor, 'doc.document.view')) {
        const levels = ['PUBLIC', 'INTERNAL', ...(mayAny(actor, 'doc.document.view_confidential') ? ['CONFIDENTIAL'] : []), ...(mayAny(actor, 'doc.document.view_restricted') ? ['RESTRICTED'] : [])];
        for (const v of db.prepare(`SELECT v.id, v.revision, v.change_note, v.status, v.created_by, v.created_at, d.doc_no, d.title FROM doc_versions v JOIN doc_documents d ON d.id = v.document_id WHERE v.company_id = ? AND d.project_id = ? AND d.is_active = 1 AND d.confidentiality IN (${levels.map(() => '?').join(',')}) ORDER BY v.id DESC LIMIT ?`).all(actor.companyId, projectId, ...levels, MAX_SOURCE_ROWS)) events.push({ key: `document-${v.id}`, kind: 'document', at: v.created_at, actor: v.created_by, action: `revision ${v.revision} ${String(v.status).toLowerCase().replace('_', ' ')}`, summary: `${v.doc_no}: ${v.title}`, reason: v.change_note, changes: {}, record: null });
      }
      const res = finish(events, { from, to, q, limit, offset }, actor.companyId);
      return { ...res, kinds: TIMELINE_KINDS, projectId, projects };
    },
  };
  const typeDefs = () => objectTypes.list().map((t) => objectTypes.get(t.type));

  // ---- trace links (FR-03) ----
  const norm = (n) => ({ entity: n.entity, id: String(n.id) });
  const trace = {
    /** Written by services. Safe to call twice for the same pair. */
    add(actorName, { companyId, from, to, relation = 'DERIVED', projectId = null, siteId = null, sourceType = null }) {
      if (!RELATIONS.includes(relation)) throw badRequest(`Unknown relation ${relation}.`);
      const a = norm(from); const b = norm(to);
      if (a.entity === b.entity && a.id === b.id) throw unprocessable('A record cannot be linked to itself.');
      const dup = db.prepare('SELECT id FROM col_trace_links WHERE company_id = ? AND from_entity = ? AND from_id = ? AND to_entity = ? AND to_id = ? AND relation = ? AND is_active = 1').get(companyId, a.entity, a.id, b.entity, b.id, relation);
      if (dup) return { id: dup.id, created: false };
      const id = Number(db.prepare("INSERT INTO col_trace_links (company_id, from_entity, from_id, to_entity, to_id, relation, link_kind, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'SERVICE', ?, ?, ?, ?)").run(companyId, a.entity, a.id, b.entity, b.id, relation, projectId, siteId, actorName ?? 'system', sourceType ?? 'service').lastInsertRowid);
      writeAudit(db, { entity: 'col_trace_links', entityId: id, action: 'create', newValues: { from: `${a.entity}:${a.id}`, to: `${b.entity}:${b.id}`, relation, kind: 'SERVICE' }, actor: actorName ?? 'system', companyId });
      return { id, created: true };
    },
    /** By hand, with a documented reason (BR-02), between two records the person can open. */
    addManual(actor, { from, to, relation, reason }) {
      const a = record(actor, from.entity, from.id); const b = record(actor, to.entity, to.id);
      return transaction(db, () => {
        const res = trace.add(actor.user, { companyId: actor.companyId, from, to, relation, projectId: a.access.projectId ?? b.access.projectId ?? null, siteId: a.access.siteId ?? null, sourceType: 'manual' });
        if (!res.created) throw conflict('These two records are already linked in this way.');
        db.prepare("UPDATE col_trace_links SET link_kind = 'MANUAL', reason = ? WHERE id = ?").run(reason, res.id);
        writeAudit(db, { entity: 'col_trace_links', entityId: res.id, action: 'link', newValues: { from: `${from.entity}:${from.id}`, to: `${to.entity}:${to.id}`, relation, kind: 'MANUAL' }, reason, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'col.trace.linked', entity: 'col_trace_link', entityId: res.id, actorId: actor.user, companyId: actor.companyId, data: { from: `${from.entity}:${from.id}`, to: `${to.entity}:${to.id}`, relation, manual: true } });
        return { id: res.id };
      });
    },
    /** Only a link made by hand can be removed by hand; a link a service wrote stays as the record of what happened. */
    removeManual(actor, linkId, { reason }) {
      const l = db.prepare('SELECT * FROM col_trace_links WHERE id = ? AND company_id = ? AND is_active = 1').get(linkId, actor.companyId);
      if (!l) throw notFound('That link does not exist.');
      if (l.link_kind !== 'MANUAL') throw unprocessable('This link was made by the system and is part of the record; it cannot be removed.');
      record(actor, l.from_entity, l.from_id);
      db.prepare('UPDATE col_trace_links SET is_active = 0, deleted_at = ?, deleted_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, actor.user, nowIso(), l.id);
      writeAudit(db, { entity: 'col_trace_links', entityId: l.id, action: 'unlink', oldValues: { from: `${l.from_entity}:${l.from_id}`, to: `${l.to_entity}:${l.to_id}` }, reason, actor: actor.user, companyId: actor.companyId });
      return { id: l.id, removed: true };
    },
    /** The chain around a record: what it came from (upstream) and what came from it (downstream), to a depth. A record the person cannot open is shown as restricted, never named. */
    graph(actor, { entity, id, depth = 3 }) {
      const root = record(actor, entity, id);
      const levels = Math.min(Math.max(depth, 1), 8);
      const nodeOf = (type, rid, level, via) => {
        const d = describe(actor, type, rid);
        return d ? { ...d, level, relation: via.relation, manual: via.link_kind === 'MANUAL', linkId: via.id, restricted: false }
          : { type, id: null, typeLabel: objectTypes.get(type)?.label ?? type, label: 'Restricted record', status: null, amount: null, route: null, level, relation: via.relation, manual: via.link_kind === 'MANUAL', linkId: via.id, restricted: true };
      };
      let truncated = false;
      const walk = (direction) => {
        const visited = new Set([`${entity}:${id}`]);
        const out = []; let frontier = [{ type: entity, id: String(id) }];
        for (let level = 1; level <= levels && frontier.length; level += 1) {
          const next = [];
          for (const cur of frontier) {
            const rows = direction === 'up'
              ? db.prepare('SELECT * FROM col_trace_links WHERE company_id = ? AND to_entity = ? AND to_id = ? AND is_active = 1 ORDER BY id').all(actor.companyId, cur.type, cur.id)
              : db.prepare('SELECT * FROM col_trace_links WHERE company_id = ? AND from_entity = ? AND from_id = ? AND is_active = 1 ORDER BY id').all(actor.companyId, cur.type, cur.id);
            for (const r of rows) {
              const t = direction === 'up' ? r.from_entity : r.to_entity; const rid = direction === 'up' ? r.from_id : r.to_id;
              const k = `${t}:${rid}`;
              if (visited.has(k)) continue;
              if (out.length >= MAX_NODES) { truncated = true; return out; }
              visited.add(k);
              const n = { ...nodeOf(t, rid, level, r), parent: `${cur.type}:${cur.id}` };
              out.push(n);
              if (!n.restricted) next.push({ type: t, id: rid });
            }
          }
          frontier = next;
        }
        return out;
      };
      const upstream = walk('up'); const downstream = walk('down');
      const self = describe(actor, entity, id);
      const sum = (list) => { let total = 0; let any = false; for (const n of list) if (n.amount !== null && n.amount !== undefined && !Number.isNaN(Number(n.amount))) { any = true; total += Number(n.amount); } return any ? total.toFixed(2) : null; };
      return { root: { ...self, projectId: root.access.projectId ?? null }, upstream, downstream, depth: levels, truncated, totals: { upstream: sum(upstream), downstream: sum(downstream) }, canLink: authz.check(actor, 'col.trace.link', { companyId: actor.companyId, projectId: root.access.projectId ?? undefined }).allowed };
    },
  };

  return { comments, mentions, timeline, trace, record, describe, params };
}

// ---- the file entity: attachments of a comment follow the comment's record; the author may add files while the edit window is open ----
fileEntities.register({
  entity: COMMENT_FILE_ENTITY, label: 'Comment',
  resolve(db, actor, id) {
    const c = db.prepare("SELECT * FROM col_comments WHERE id = ? AND company_id = ? AND is_active = 1").get(Number(id), actor.companyId);
    if (!c || c.status !== 'ACTIVE') return null;
    const def = objectTypes.get(c.entity);
    if (!def) return null;
    let access;
    try { access = authzOf(db).check(actor, def.permission).allowed ? def.access(db, actor, keyId(c.entity_id)) : null; } catch { access = null; }
    if (!access) return null;
    const store = createParameterStore(db);
    const win = Number(store.get('col.comment.edit_window_minutes', { companyId: actor.companyId, date: todayIST() }));
    const open = win > 0 && Date.now() - toMs(c.created_at) <= win * 60_000;
    return { companyId: c.company_id, projectId: c.project_id ?? null, siteId: c.site_id ?? null, canView: true, canEdit: c.created_by === actor.user && open, locked: false };
  },
});

const services = new WeakMap();
export const bind = (db, s) => services.set(db, s);
/** The collaboration service of a database, for modules that write trace links. */
export const collabOf = (db) => services.get(db);
