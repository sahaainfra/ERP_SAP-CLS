import { z } from 'zod';
import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { filesOf } from '../../platform/files/registry.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { realtimeOf } from '../../platform/realtime/index.js';
import { tasksOf } from '../../platform/tasks/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { parse } from '../../platform/validation/index.js';
import { createPathService } from '../eng/controls.js';

// The Communication Center (part 05.04): instructions that must be acknowledged, announcements with read tracking, the escalation of conversations people flag, and message-to-action. Auto groups are in
// autogroups.js. Everything here sits on the unified Messages service (05.01): membership of the conversation decides who may see a message, so an instruction can only go to the people of the conversation it is sent in.
const nowIso = () => new Date().toISOString();
const RANK = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
const excerpt = (s, n = 140) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const dueIso = (v) => (v ? (/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:29:59.000Z` : new Date(v).toISOString()) : null); // a plain date is the end of that day in India
const id = z.coerce.number().int().min(1);
const text = (max) => z.string().trim().max(max);
const dueText = z.string().trim().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isNaN(Date.parse(v)), 'Use a date such as 2026-11-30 or a date and time');
export const parseInstruction = (b) => parse(z.object({ priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'), dueAt: dueText.optional(), requiresAck: z.boolean().default(true), title: text(120).optional() }).strict(), b);
export const parseAck = (b) => parse(z.object({ response: text(500).optional() }).strict(), b ?? {});
export const parseBulkAck = (b) => parse(z.object({ ids: z.array(id).min(1).max(100), response: text(500).optional() }).strict(), b);
export const parseCancel = (b) => parse(z.object({ reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(300) }).strict(), b);
export const parseInstrList = (q) => parse(z.object({ view: z.enum(['sent', 'all']).default('sent'), status: z.enum(['OPEN', 'COMPLETED', 'ESCALATED', 'CANCELLED']).optional(), priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(), overdue: z.enum(['1']).optional(), q: text(80).optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).strict(), q);
const quizItem = z.object({ q: z.string().trim().min(3).max(200), options: z.array(z.string().trim().min(1).max(120)).min(2).max(5), correct: z.number().int().min(0).max(4) }).strict().refine((o) => o.correct < o.options.length, { message: 'The right answer must be one of the options', path: ['correct'] });
const audience = z.object({ all: z.boolean().default(false), roles: z.array(z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,19}$/)).max(30).default([]), projectIds: z.array(id).max(50).default([]), siteIds: z.array(id).max(100).default([]), departmentIds: z.array(id).max(50).default([]) }).strict()
  .refine((a) => a.all || a.roles.length || a.projectIds.length || a.siteIds.length || a.departmentIds.length, { message: 'Choose who the announcement is for', path: ['all'] });
const announcementBody = z.object({ title: z.string().trim().min(3, 'Give the announcement a title').max(120), body: z.string().trim().min(3, 'Write the announcement').max(4000), audience, requireConfirmation: z.boolean().default(false), quiz: z.array(quizItem).max(10).default([]),
  publishAt: dueText.optional(), expiresAt: dueText.optional() }).strict();
export const parseAnnouncement = (b) => parse(announcementBody, b);
export const parseAnnouncementUpdate = (b) => parse(announcementBody.extend({ version: z.number().int().min(1) }), b);
export const parseAnnouncementList = (q) => parse(z.object({ view: z.enum(['received', 'sent', 'all']).default('received'), status: z.enum(['DRAFT', 'SCHEDULED', 'PUBLISHED', 'EXPIRED', 'CANCELLED']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).strict(), q);
export const parseConfirm = (b) => parse(z.object({ answers: z.array(z.number().int().min(0).max(4)).max(10).default([]) }).strict(), b ?? {});
export const parseEscalate = (b) => parse(z.object({ reason: z.string().trim().min(5, 'Say what is unresolved (at least 5 characters)').max(500), messageId: id.optional(), afterHours: z.number().int().min(1).max(168).default(24) }).strict(), b);
export const parseResolve = (b) => parse(z.object({ resolution: z.string().trim().min(3, 'Say how it was resolved').max(500) }).strict(), b);
export const parseEscList = (q) => parse(z.object({ view: z.enum(['mine', 'received', 'all']).default('mine'), status: z.enum(['OPEN', 'ESCALATED', 'RESOLVED']).optional() }).strict(), q);
export const parseToAction = (b) => parse(z.object({ type: z.enum(['TASK', 'RFI', 'NCR', 'SITE_INSTRUCTION', 'MATERIAL_REQUEST', 'HSE_OBSERVATION']), title: text(200).optional(), description: text(4000).optional(), assignees: z.array(z.string().trim().min(2).max(60)).max(20).default([]), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'), projectId: id.optional(), siteId: id.optional(), includeAttachments: z.boolean().default(true) }).strict(), b);
export const parseDraftQuery = (q) => parse(z.object({ type: z.enum(['TASK', 'RFI', 'NCR', 'SITE_INSTRUCTION', 'MATERIAL_REQUEST', 'HSE_OBSERVATION']).default('TASK') }).strict(), q);

/**
 * The kinds of record a message can become. Each module registers its own when it is live; one that is not live yet is listed as not available, with the part that builds it, and refuses (409).
 *   messageActions.register({ type, label, part, permission, available, create(db, actor, draft) -> { entity, id, label, route } })
 */
const actionTypes = new Map();
export const messageActions = { register(def) { actionTypes.set(def.type, def); }, get: (t) => actionTypes.get(t) ?? null, list: () => [...actionTypes.values()] };
for (const [type, label, part] of [['RFI', 'Request for information', '11.02'], ['NCR', 'Non-conformance report', '18.04'], ['SITE_INSTRUCTION', 'Site instruction', '14.04'], ['MATERIAL_REQUEST', 'Material request', '15.01'], ['HSE_OBSERVATION', 'HSE observation', '19.04']]) {
  if (!actionTypes.has(type)) messageActions.register({ type, label, part, permission: null, available: false });
}

// The task is the one kind that is live (04.08). The record is made with the platform task core after the rules of the task module are applied here: giving a task to someone else needs tsk.task.assign, the project must be visible.
// It uses the database it is given, not one captured at start-up, so every application instance in a process works on its own.
messageActions.register({
  type: 'TASK', label: 'Task', part: '04.08', permission: null, available: true,
  async create(db, actor, draft) {
    const az = authzOf(db);
    const others = draft.assignees.some((u) => u.toLowerCase() !== actor.user.toLowerCase());
    if (others && !az.check(actor, 'tsk.task.assign', { companyId: actor.companyId, projectId: draft.projectId ?? undefined }).allowed) throw forbidden('You may not give a task to someone else (permission tsk.task.assign).');
    if (draft.projectId && !az.check(actor, 'org.view', { companyId: actor.companyId, projectId: draft.projectId }).allowed) throw forbidden('You have no access to that project.');
    const assignees = draft.assignees.length ? draft.assignees : [actor.user];
    const r = tasksOf(db).create({ companyId: actor.companyId, title: draft.title, description: draft.description, assignees, dueDate: draft.dueDate, priority: draft.priority, projectId: draft.projectId, siteId: draft.siteId, origin: 'manual', assigner: actor.user, actor: actor.user, trusted: [actor.user], requiresAcceptance: others, source: { type: 'msg_message', id: draft.messageId } });
    const t = db.prepare('SELECT task_no FROM tsk_tasks WHERE id = ?').get(r.id);
    return { entity: 'tsk_task', id: r.id, label: t?.task_no ?? `#${r.id}`, route: `/work/tasks/${r.id}` };
  },
});

export function createCommService({ db, base }) {
  const authz = authzOf(db);
  const notif = notificationsOf(db);
  const hub = realtimeOf(db);
  const x = base.internals;
  const core = tasksOf(db);
  const paths = createPathService({ db, engine: workflowOf(db) });
  const may = (actor, key, scope) => authz.check(actor, key, scope).allowed;
  const anywhere = (actor, key) => authz.check(actor, key).allowed;
  const name = (c, u) => (u ? x.nameOf(c, u) : '');
  const emit = (type, row, actor, data) => publishEvent(db, { type, entity: row.entity, entityId: row.id, actorId: actor, companyId: row.companyId, projectId: row.projectId ?? undefined, data });
  const userRow = (companyId, u) => db.prepare("SELECT id, username, display_name, roles_json FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND status = 'ACTIVE' AND is_active = 1").get(companyId, u);
  const firstRole = (companyId, u) => { try { return JSON.parse(userRow(companyId, u)?.roles_json ?? '[]')[0] ?? null; } catch { return null; } };
  const link = (conv) => `/collab/messages?c=${conv.id}`;
  /** The people above the given ones on the escalation path of the project (04.02), without those people themselves. */
  function managersOf(companyId, projectId, users, exclude = []) {
    const out = new Set();
    for (const u of users) {
      const next = paths.next({ companyId, projectId, fromRole: firstRole(companyId, u), level: 1 });
      if (next) for (const h of core.holders(companyId, [next.role])) if (![...exclude, ...users].some((e) => e.toLowerCase() === h.toLowerCase())) out.add(h);
    }
    return [...out];
  }

  // ================= instructions (FR-03) =================
  const instrRow = (iid, companyId) => db.prepare('SELECT * FROM msg_instructions WHERE id = ? AND company_id = ? AND is_active = 1').get(iid, companyId);
  const pending = (iid) => db.prepare('SELECT user_ref FROM msg_acknowledgements WHERE instruction_id = ? AND acknowledged_at IS NULL AND is_active = 1 ORDER BY user_ref').all(iid).map((r) => r.user_ref);
  const view = (actor, r) => {
    const conv = x.convRow(r.conversation_id);
    const total = db.prepare('SELECT COUNT(*) AS n FROM msg_acknowledgements WHERE instruction_id = ? AND is_active = 1').get(r.id).n;
    const done = db.prepare('SELECT COUNT(*) AS n FROM msg_acknowledgements WHERE instruction_id = ? AND is_active = 1 AND acknowledged_at IS NOT NULL').get(r.id).n;
    const open = !['COMPLETED', 'CANCELLED'].includes(r.instruction_status);
    return { id: r.id, messageId: r.message_id, conversationId: r.conversation_id, conversation: conv?.title ?? '', title: r.title, excerpt: excerpt(db.prepare('SELECT body FROM msg_messages WHERE id = ?').get(r.message_id)?.body), sender: { username: r.sender_ref, name: name(actor.companyId, r.sender_ref) }, priority: r.priority, dueAt: r.due_at, requiresAck: Boolean(r.requires_ack),
      status: r.instruction_status, escalatedAt: r.escalated_at, total, acknowledged: done, percent: total ? Math.round((done * 100) / total) : 100, overdue: Boolean(open && r.due_at && r.due_at < nowIso() && done < total), createdAt: r.created_at, completedAt: r.completed_at };
  };
  const instructions = {
    /** A message of the sender becomes an instruction to the other members of its conversation. */
    create(actor, messageId, b) {
      const m = db.prepare('SELECT * FROM msg_messages WHERE id = ? AND is_active = 1').get(messageId);
      if (!m) throw notFound('That message does not exist.');
      const c = x.must(actor, m.conversation_id);
      if (m.sender_ref !== actor.user) throw forbidden('Only the sender of a message can mark it as an instruction.');
      if (m.status !== 'ACTIVE' || m.kind === 'SYSTEM') throw unprocessable('Only a message that was sent and not deleted can be an instruction.');
      if (c.conv_type === 'EXTERNAL' || x.secureRow(c.id)) throw unprocessable('Instructions are not available in this kind of conversation.');
      const scope = c.project_id || c.site_id ? { companyId: actor.companyId, projectId: c.project_id ?? undefined, siteId: c.site_id ?? undefined } : null;
      if (!(scope ? may(actor, 'msg.instruction.send', scope) : anywhere(actor, 'msg.instruction.send'))) throw forbidden('You may not send instructions here (permission msg.instruction.send, within your project or site).');
      const due = dueIso(b.dueAt);
      if (due && due <= nowIso()) throw unprocessable('The due time is in the past.', [{ field: 'dueAt', message: 'choose a time that has not passed' }]);
      if (b.requiresAck && !due) throw unprocessable('An instruction that must be acknowledged needs a due time: without one it cannot escalate.', [{ field: 'dueAt', message: 'is required' }]);
      const members = db.prepare('SELECT user_ref FROM msg_members WHERE conversation_id = ? AND left_at IS NULL AND is_active = 1').all(c.id).map((r) => r.user_ref).filter((u) => u.toLowerCase() !== actor.user.toLowerCase());
      if (!members.length) throw unprocessable('There is nobody else in this conversation to give an instruction to.');
      return transaction(db, () => {
        if (db.prepare('SELECT 1 FROM msg_instructions WHERE message_id = ? AND is_active = 1').get(m.id)) throw conflict('This message is already an instruction.');
        const title = b.title?.trim() || excerpt(m.body, 80) || 'Instruction';
        const iid = Number(db.prepare("INSERT INTO msg_instructions (company_id, message_id, conversation_id, sender_ref, title, priority, due_at, requires_ack, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'msg_instruction')")
          .run(actor.companyId, m.id, c.id, actor.user, title, b.priority, due, b.requiresAck ? 1 : 0, c.project_id, c.site_id, actor.user).lastInsertRowid);
        for (const u of members) db.prepare("INSERT INTO msg_acknowledgements (company_id, instruction_id, user_ref, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'msg_instruction')").run(actor.companyId, iid, u, c.project_id, c.site_id, actor.user);
        writeAudit(db, { entity: 'msg_instructions', entityId: iid, action: 'create', newValues: { message: m.id, priority: b.priority, due, recipients: members.length }, actor: actor.user, companyId: actor.companyId });
        emit('msg.instruction.created', { entity: 'msg_instruction', id: iid, companyId: actor.companyId, projectId: c.project_id }, actor.user, { conversationId: c.id, priority: b.priority, recipients: members.length });
        for (const u of members) notif.notify({ companyId: actor.companyId, templateCode: 'msg.instruction', recipients: [`user:${u}`], data: { sender: name(actor.companyId, actor.user), title, priority: b.priority, due: due ? ` by ${due.slice(0, 10)}` : '' }, link: link(c), priority: b.priority === 'URGENT' ? 'HIGH' : undefined, sourceType: 'msg_instruction', sourceId: String(iid), eventKey: `msg.instruction:${iid}:${u}`, projectId: c.project_id ?? undefined });
        x.systemMessage(c, { user: 'system' }, `${name(actor.companyId, actor.user)} marked a message as an instruction (${b.priority.toLowerCase()}${due ? `, due ${due.slice(0, 10)}` : ''}): ${members.length} ${members.length === 1 ? 'person has' : 'people have'} to acknowledge it.`);
        hub.publish({ companyId: actor.companyId, rooms: [`conv:${c.id}`, ...members.map((u) => `user:${u}`)], type: 'msg.instruction.created', entity: 'msg_instruction', entityId: iid, data: { conversationId: c.id, instructionId: iid } });
        return view(actor, instrRow(iid, actor.companyId));
      });
    },
    ack(actor, iid, /** @type {{ response?: string }} */ { response } = {}) {
      const i = instrRow(iid, actor.companyId);
      const a = i && db.prepare('SELECT * FROM msg_acknowledgements WHERE instruction_id = ? AND lower(user_ref) = lower(?) AND is_active = 1').get(i.id, actor.user);
      if (!i || !a) throw notFound('That instruction does not exist, or it is not addressed to you.');
      if (i.instruction_status === 'CANCELLED') throw conflict('The sender cancelled this instruction.');
      if (a.acknowledged_at) return { ...view(actor, i), replay: true };
      return transaction(db, () => {
        db.prepare('UPDATE msg_acknowledgements SET acknowledged_at = ?, response = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(nowIso(), response ?? null, actor.user, nowIso(), a.id);
        writeAudit(db, { entity: 'msg_acknowledgements', entityId: a.id, action: 'acknowledge', newValues: { instruction: i.id, response: response ?? null }, actor: actor.user, companyId: actor.companyId });
        emit('msg.instruction.acknowledged', { entity: 'msg_instruction', id: i.id, companyId: actor.companyId, projectId: i.project_id }, actor.user, { user: actor.user, priority: i.priority, dueAt: i.due_at, late: Boolean(i.due_at && i.due_at < nowIso()) });
        const left = pending(i.id);
        if (!left.length) {
          db.prepare("UPDATE msg_instructions SET instruction_status = 'COMPLETED', completed_at = ?, updated_by = 'system', updated_at = ?, version = version + 1 WHERE id = ? AND instruction_status != 'CANCELLED'").run(nowIso(), nowIso(), i.id);
          emit('msg.instruction.completed', { entity: 'msg_instruction', id: i.id, companyId: actor.companyId, projectId: i.project_id }, actor.user, {});
          notif.notify({ companyId: actor.companyId, templateCode: 'msg.instruction.acknowledged', recipients: [`user:${i.sender_ref}`], data: { title: i.title }, link: link({ id: i.conversation_id }), sourceType: 'msg_instruction', sourceId: String(i.id), eventKey: `msg.instruction.done:${i.id}` });
          const c = x.convRow(i.conversation_id);
          if (c) x.systemMessage(c, { user: 'system' }, `Everyone acknowledged the instruction "${excerpt(i.title, 60)}".`);
        }
        hub.publish({ companyId: actor.companyId, rooms: [`user:${i.sender_ref}`, `user:${actor.user}`], type: 'msg.instruction.acknowledged', entity: 'msg_instruction', entityId: i.id, data: { instructionId: i.id } });
        return view(actor, instrRow(i.id, actor.companyId));
      });
    },
    /** Several at once, but never a high or urgent one: those have to be read and acknowledged one by one. */
    bulkAck(actor, { ids, response }) {
      const rows = ids.map((n) => instrRow(n, actor.companyId));
      const bad = rows.map((r, k) => ({ r, id: ids[k] })).filter((x2) => !x2.r || ['HIGH', 'URGENT'].includes(x2.r.priority));
      if (bad.length) throw unprocessable(`High and urgent instructions are acknowledged one by one (${bad.map((b) => `#${b.id}`).join(', ')}).`, bad.map((b) => ({ field: 'ids', message: `#${b.id} cannot be acknowledged in bulk` })));
      return { acknowledged: ids.map((n) => instructions.ack(actor, n, { response })).length };
    },
    cancel(actor, iid, { reason }) {
      const i = instrRow(iid, actor.companyId);
      if (!i || (i.sender_ref !== actor.user && !anywhere(actor, 'msg.comm.view_all'))) throw notFound('That instruction does not exist, or it is not yours.');
      if (['COMPLETED', 'CANCELLED'].includes(i.instruction_status)) throw conflict('That instruction is already finished.');
      db.prepare("UPDATE msg_instructions SET instruction_status = 'CANCELLED', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), i.id);
      writeAudit(db, { entity: 'msg_instructions', entityId: i.id, action: 'cancel', actor: actor.user, companyId: actor.companyId, reason });
      return view(actor, instrRow(i.id, actor.companyId));
    },
    /** The register (section 7.3): the instructions of the person, or all of them for those who may see all. */
    list(actor, f) {
      const all = f.view === 'all';
      if (all && !anywhere(actor, 'msg.comm.view_all')) throw forbidden('You may not see all instructions (permission msg.comm.view_all).');
      if (!all && !anywhere(actor, 'msg.instruction.send')) throw forbidden('You may not see the instruction register (permission msg.instruction.send).');
      const where = ['i.company_id = ?', 'i.is_active = 1']; const args = [actor.companyId];
      if (!all) { where.push('i.sender_ref = ?'); args.push(actor.user); }
      if (f.status) { where.push('i.instruction_status = ?'); args.push(f.status); }
      if (f.priority) { where.push('i.priority = ?'); args.push(f.priority); }
      if (f.q) { where.push('(i.title LIKE ? OR i.sender_ref LIKE ?)'); args.push(`%${f.q}%`, `%${f.q}%`); }
      if (f.from) { where.push('i.created_at >= ?'); args.push(`${f.from}T00:00:00.000Z`); }
      if (f.to) { where.push('i.created_at <= ?'); args.push(`${f.to}T23:59:59.999Z`); }
      let rows = db.prepare(`SELECT i.* FROM msg_instructions i WHERE ${where.join(' AND ')} ORDER BY i.id DESC LIMIT 2000`).all(...args)
        .filter((r) => all ? may(actor, 'msg.comm.view_all', { companyId: actor.companyId, projectId: r.project_id ?? undefined, siteId: r.site_id ?? undefined }) : true)
        .map((r) => view(actor, r));
      if (f.overdue) rows = rows.filter((r) => r.overdue);
      const sum = { total: rows.length, open: rows.filter((r) => r.status === 'OPEN').length, escalated: rows.filter((r) => r.status === 'ESCALATED').length, overdue: rows.filter((r) => r.overdue).length, completed: rows.filter((r) => r.status === 'COMPLETED').length,
        percent: rows.length ? Math.round(rows.reduce((n, r) => n + r.percent, 0) / rows.length) : 0 };
      return { rows: rows.slice(f.offset, f.offset + f.limit), total: rows.length, summary: sum, canAll: anywhere(actor, 'msg.comm.view_all') };
    },
    get(actor, iid) {
      const i = instrRow(iid, actor.companyId);
      const mine = i && db.prepare('SELECT * FROM msg_acknowledgements WHERE instruction_id = ? AND lower(user_ref) = lower(?) AND is_active = 1').get(i.id, actor.user);
      const seesAll = i && (i.sender_ref === actor.user || may(actor, 'msg.comm.view_all', { companyId: actor.companyId, projectId: i.project_id ?? undefined, siteId: i.site_id ?? undefined }));
      if (!i || (!mine && !seesAll)) throw notFound('That instruction does not exist, or you may not see it.');
      const recipients = seesAll ? db.prepare('SELECT user_ref, acknowledged_at, response FROM msg_acknowledgements WHERE instruction_id = ? AND is_active = 1 ORDER BY (acknowledged_at IS NULL) DESC, user_ref').all(i.id).map((r) => ({ username: r.user_ref, name: name(actor.companyId, r.user_ref), acknowledgedAt: r.acknowledged_at, response: r.response })) : undefined;
      return { ...view(actor, i), recipients, mine: mine ? { acknowledgedAt: mine.acknowledged_at, response: mine.response } : null, cancelReason: i.cancel_reason };
    },
    /** What the person has still to acknowledge, urgent and overdue first (the worklist). */
    pending(actor) {
      const rows = db.prepare("SELECT i.*, a.id AS ack_id FROM msg_acknowledgements a JOIN msg_instructions i ON i.id = a.instruction_id WHERE a.company_id = ? AND lower(a.user_ref) = lower(?) AND a.acknowledged_at IS NULL AND a.is_active = 1 AND i.is_active = 1 AND i.instruction_status IN ('OPEN', 'ESCALATED')").all(actor.companyId, actor.user)
        .map((r) => ({ ...view(actor, r), ageHours: Math.round((Date.now() - Date.parse(r.created_at)) / 3_600_000), dueSoon: Boolean(r.due_at && r.due_at > nowIso() && Date.parse(r.due_at) - Date.now() < 86_400_000) }))
        .sort((a, b) => (Number(b.overdue) - Number(a.overdue)) || (RANK[a.priority] - RANK[b.priority]) || String(a.dueAt ?? '9').localeCompare(String(b.dueAt ?? '9')));
      return { rows, counts: { pending: rows.length, overdue: rows.filter((r) => r.overdue).length, urgent: rows.filter((r) => r.priority === 'URGENT').length } };
    },
    exportRows(actor, f) { return instructions.list(actor, { ...f, limit: 2000, offset: 0 }).rows.map((r) => ({ id: r.id, title: r.title, conversation: r.conversation, sender: r.sender.name, priority: r.priority, due: r.dueAt ?? '', status: r.status, acknowledged: `${r.acknowledged} of ${r.total}`, percent: r.percent, overdue: r.overdue ? 'Yes' : 'No', escalated: r.escalatedAt ?? '', created: r.createdAt })); },
    /** At the due time: whoever has not acknowledged is escalated to their managers, the sender and the group are told (T-02). */
    escalate(companyId) {
      let n = 0;
      const due = db.prepare("SELECT * FROM msg_instructions WHERE company_id = ? AND instruction_status = 'OPEN' AND requires_ack = 1 AND due_at IS NOT NULL AND due_at <= ? AND is_active = 1").all(companyId, nowIso());
      for (const i of due) {
        const left = pending(i.id);
        if (!left.length) continue;
        const managers = managersOf(companyId, i.project_id, left, [i.sender_ref]);
        transaction(db, () => {
          db.prepare("UPDATE msg_instructions SET instruction_status = 'ESCALATED', escalated_at = ?, escalation_level = 1, updated_by = 'system', updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), nowIso(), i.id);
          writeAudit(db, { entity: 'msg_instructions', entityId: i.id, action: 'escalate', newValues: { pending: left, managers }, actor: 'system', companyId });
          emit('msg.instruction.escalated', { entity: 'msg_instruction', id: i.id, companyId, projectId: i.project_id }, 'system', { pending: left, managers });
          const names = left.map((u) => name(companyId, u)).join(', ');
          for (const u of [...new Set([i.sender_ref, ...managers])]) notif.notify({ companyId, templateCode: 'msg.instruction.escalated', recipients: [`user:${u}`], data: { title: i.title, pending: names, sender: name(companyId, i.sender_ref) }, link: link({ id: i.conversation_id }), priority: 'HIGH', sourceType: 'msg_instruction', sourceId: String(i.id), eventKey: `msg.instruction.escalated:${i.id}:${u}`, projectId: i.project_id ?? undefined });
          const c = x.convRow(i.conversation_id);
          if (c) x.systemMessage(c, { user: 'system' }, `Not acknowledged by the due time: ${names}. Escalated to ${managers.length ? managers.map((u) => name(companyId, u)).join(', ') : 'the sender'}.`);
        });
        n += 1;
      }
      return n;
    },
  };

  // ================= announcements (FR-04) =================
  const annRow = (aid, companyId) => db.prepare('SELECT * FROM msg_announcements WHERE id = ? AND company_id = ? AND is_active = 1').get(aid, companyId);
  /** The people an audience means (places narrow it; roles narrow it further; "everyone" is everyone). */
  function resolveAudience(companyId, a) {
    const users = db.prepare("SELECT id, username, roles_json FROM iam_users WHERE company_id = ? AND status = 'ACTIVE' AND is_active = 1").all(companyId);
    const byId = new Map(users.map((u) => [u.id, u]));
    let set = null;
    const places = a.projectIds.length || a.siteIds.length || a.departmentIds.length;
    if (!a.all && places) {
      set = new Set();
      const today = new Date().toISOString().slice(0, 10);
      const sitesOf = a.projectIds.length ? db.prepare(`SELECT id FROM org_sites WHERE company_id = ? AND org_project_id IN (${a.projectIds.map(() => '?').join(',')})`).all(companyId, ...a.projectIds).map((r) => r.id) : [];
      const projectsOfSites = a.siteIds.length ? db.prepare(`SELECT DISTINCT org_project_id AS p FROM org_sites WHERE company_id = ? AND id IN (${a.siteIds.map(() => '?').join(',')})`).all(companyId, ...a.siteIds).map((r) => r.p) : [];
      for (const r of db.prepare("SELECT user_id, scope_type, scope_ids_json FROM iam_assignments WHERE company_id = ? AND status = 'ACTIVE' AND is_active = 1 AND (effective_from IS NULL OR effective_from <= ?) AND (effective_to IS NULL OR effective_to >= ?)").all(companyId, today, today)) {
        const ids = JSON.parse(r.scope_ids_json || '[]').map(Number);
        const hit = (r.scope_type === 'PROJECT' && ids.some((i) => a.projectIds.includes(i) || projectsOfSites.includes(i))) || (r.scope_type === 'SITE' && ids.some((i) => a.siteIds.includes(i) || sitesOf.includes(i))) || (r.scope_type === 'DEPARTMENT' && ids.some((i) => a.departmentIds.includes(i)));
        if (hit && byId.has(r.user_id)) set.add(r.user_id);
      }
      if (a.departmentIds.length && db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'iam_user_profiles'").get()) {
        for (const r of db.prepare(`SELECT user_id FROM iam_user_profiles WHERE company_id = ? AND department_id IN (${a.departmentIds.map(() => '?').join(',')})`).all(companyId, ...a.departmentIds)) if (byId.has(r.user_id)) set.add(r.user_id);
      }
    }
    let list = users.filter((u) => (set ? set.has(u.id) : true));
    if (a.roles.length) {
      const held = new Set(db.prepare(`SELECT a.user_id FROM iam_assignments a JOIN iam_roles r ON r.id = a.role_id WHERE a.company_id = ? AND a.status = 'ACTIVE' AND a.is_active = 1 AND r.code IN (${a.roles.map(() => '?').join(',')})`).all(companyId, ...a.roles).map((r) => r.user_id));
      list = list.filter((u) => held.has(u.id) || JSON.parse(u.roles_json || '[]').some((r) => a.roles.includes(r)));
    }
    return list.map((u) => u.username);
  }
  function mayAnnounce(actor, a) {
    if (a.all || a.roles.length && !a.projectIds.length && !a.siteIds.length && !a.departmentIds.length) { if (!may(actor, 'msg.announcement.send', { companyId: actor.companyId })) throw forbidden('Only someone with company-wide rights may announce to everyone or to a role across the company.'); return; }
    for (const p of a.projectIds) if (!may(actor, 'msg.announcement.send', { companyId: actor.companyId, projectId: p })) throw forbidden(`You may not announce to project ${p} (permission msg.announcement.send within that project).`);
    for (const s of a.siteIds) if (!may(actor, 'msg.announcement.send', { companyId: actor.companyId, siteId: s })) throw forbidden(`You may not announce to site ${s} (permission msg.announcement.send within that site).`);
    if (a.departmentIds.length && !may(actor, 'msg.announcement.send', { companyId: actor.companyId })) throw forbidden('Announcing to a department needs company-wide rights.');
  }
  const annView = (actor, r, { forSender = false } = {}) => {
    const quiz = JSON.parse(r.quiz_json || '[]');
    const reads = db.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN read_at IS NOT NULL THEN 1 ELSE 0 END) AS read, SUM(CASE WHEN confirmed_at IS NOT NULL THEN 1 ELSE 0 END) AS confirmed FROM msg_announcement_reads WHERE announcement_id = ? AND is_active = 1').get(r.id);
    const mine = db.prepare('SELECT * FROM msg_announcement_reads WHERE announcement_id = ? AND lower(user_ref) = lower(?) AND is_active = 1').get(r.id, actor.user);
    return { id: r.id, title: r.title, body: r.body, sender: { username: r.sender_ref, name: name(actor.companyId, r.sender_ref) }, audience: JSON.parse(r.audience_json), requireConfirmation: Boolean(r.require_confirmation), hasQuiz: quiz.length > 0,
      quiz: quiz.map((q) => (forSender ? q : { q: q.q, options: q.options })), publishAt: r.publish_at, expiresAt: r.expires_at, status: r.announcement_status, publishedAt: r.published_at, version: r.version, createdAt: r.created_at,
      stats: { recipients: reads.total ?? 0, read: reads.read ?? 0, confirmed: reads.confirmed ?? 0, readPercent: reads.total ? Math.round(((reads.read ?? 0) * 100) / reads.total) : 0, confirmedPercent: reads.total ? Math.round(((reads.confirmed ?? 0) * 100) / reads.total) : 0 },
      mine: mine ? { readAt: mine.read_at, confirmedAt: mine.confirmed_at, score: mine.quiz_score, attempts: mine.attempts } : null };
  };
  const publishNow = (actor, r) => {
    const a = JSON.parse(r.audience_json);
    const recipients = resolveAudience(r.company_id, a);
    if (!recipients.length) throw unprocessable('Nobody matches this audience, so there is nobody to announce to.', [{ field: 'audience', message: 'matches nobody' }]);
    transaction(db, () => {
      for (const u of recipients) db.prepare("INSERT OR IGNORE INTO msg_announcement_reads (company_id, announcement_id, user_ref, created_by, source_type) VALUES (?, ?, ?, ?, 'msg_announcement')").run(r.company_id, r.id, u, actor.user);
      db.prepare("UPDATE msg_announcements SET announcement_status = 'PUBLISHED', published_at = ?, recipient_count = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), recipients.length, actor.user, nowIso(), r.id);
      writeAudit(db, { entity: 'msg_announcements', entityId: r.id, action: 'publish', newValues: { recipients: recipients.length }, actor: actor.user, companyId: r.company_id });
      emit('msg.announcement.published', { entity: 'msg_announcement', id: r.id, companyId: r.company_id, projectId: r.project_id }, actor.user, { recipients: recipients.length, requiresConfirmation: Boolean(r.require_confirmation) });
      for (const u of recipients) notif.notify({ companyId: r.company_id, templateCode: 'msg.announcement', recipients: [`user:${u}`], data: { title: r.title, sender: name(r.company_id, r.sender_ref), action: r.require_confirmation ? 'Please read and confirm it.' : 'Please read it.' }, link: `/collab/announcements?a=${r.id}`, sourceType: 'msg_announcement', sourceId: String(r.id), eventKey: `msg.announcement:${r.id}:${u}` });
    });
  };
  const announcements = {
    create(actor, b) {
      mayAnnounce(actor, b.audience);
      const publishAt = b.publishAt ? dueIso(b.publishAt) : null; const expires = b.expiresAt ? dueIso(b.expiresAt) : null;
      if (expires && publishAt && expires <= publishAt) throw unprocessable('It expires before it is published.', [{ field: 'expiresAt', message: 'must be after the publish time' }]);
      if (expires && expires <= nowIso()) throw unprocessable('The expiry time has passed.', [{ field: 'expiresAt', message: 'choose a later time' }]);
      const aid = Number(db.prepare("INSERT INTO msg_announcements (company_id, title, body, sender_ref, audience_json, require_confirmation, quiz_json, publish_at, expires_at, announcement_status, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 'msg_announcement')")
        .run(actor.companyId, b.title, b.body, actor.user, JSON.stringify(b.audience), b.requireConfirmation || b.quiz.length ? 1 : 0, JSON.stringify(b.quiz), publishAt, expires, b.audience.projectIds[0] ?? null, b.audience.siteIds[0] ?? null, actor.user).lastInsertRowid);
      writeAudit(db, { entity: 'msg_announcements', entityId: aid, action: 'create', newValues: { title: b.title, audience: b.audience }, actor: actor.user, companyId: actor.companyId });
      return annView(actor, annRow(aid, actor.companyId), { forSender: true });
    },
    update(actor, aid, b) {
      const r = annRow(aid, actor.companyId);
      if (!r || r.sender_ref !== actor.user) throw notFound('That announcement does not exist, or it is not yours.');
      if (r.announcement_status !== 'DRAFT') throw conflict('Only a draft can be changed. Cancel a published announcement and write a new one.');
      if (r.version !== b.version) throw conflict('The draft was changed elsewhere. Reload it.');
      mayAnnounce(actor, b.audience);
      const publishAt = b.publishAt ? dueIso(b.publishAt) : null; const expires = b.expiresAt ? dueIso(b.expiresAt) : null;
      db.prepare('UPDATE msg_announcements SET title = ?, body = ?, audience_json = ?, require_confirmation = ?, quiz_json = ?, publish_at = ?, expires_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.title, b.body, JSON.stringify(b.audience), b.requireConfirmation || b.quiz.length ? 1 : 0, JSON.stringify(b.quiz), publishAt, expires, actor.user, nowIso(), r.id);
      writeAudit(db, { entity: 'msg_announcements', entityId: r.id, action: 'update', oldValues: { title: r.title }, newValues: { title: b.title }, actor: actor.user, companyId: actor.companyId });
      return annView(actor, annRow(r.id, actor.companyId), { forSender: true });
    },
    /** Publishes now, or schedules it when its publish time is still to come. */
    publish(actor, aid) {
      const r = annRow(aid, actor.companyId);
      if (!r || r.sender_ref !== actor.user) throw notFound('That announcement does not exist, or it is not yours.');
      if (r.announcement_status !== 'DRAFT') throw conflict('This announcement was already published or cancelled.');
      mayAnnounce(actor, JSON.parse(r.audience_json));
      if (r.publish_at && r.publish_at > nowIso()) {
        db.prepare("UPDATE msg_announcements SET announcement_status = 'SCHEDULED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), r.id);
        writeAudit(db, { entity: 'msg_announcements', entityId: r.id, action: 'schedule', newValues: { publishAt: r.publish_at }, actor: actor.user, companyId: actor.companyId });
      } else publishNow(actor, r);
      return annView(actor, annRow(r.id, actor.companyId), { forSender: true });
    },
    cancel(actor, aid, { reason }) {
      const r = annRow(aid, actor.companyId);
      if (!r || r.sender_ref !== actor.user) throw notFound('That announcement does not exist, or it is not yours.');
      if (['CANCELLED', 'EXPIRED'].includes(r.announcement_status)) throw conflict('This announcement is already finished.');
      db.prepare("UPDATE msg_announcements SET announcement_status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id);
      writeAudit(db, { entity: 'msg_announcements', entityId: r.id, action: 'cancel', actor: actor.user, companyId: actor.companyId, reason });
      return annView(actor, annRow(r.id, actor.companyId), { forSender: true });
    },
    list(actor, /** @type {{ view: string, status?: string, limit: number, offset: number }} */ { view: v, status, limit, offset }) {
      let rows;
      const seesAll = anywhere(actor, 'msg.comm.view_all');
      if (v === 'sent') rows = db.prepare('SELECT * FROM msg_announcements WHERE company_id = ? AND sender_ref = ? AND is_active = 1 ORDER BY id DESC LIMIT 500').all(actor.companyId, actor.user);
      else if (v === 'all') { if (!seesAll) throw forbidden('You may not see all announcements (permission msg.comm.view_all).'); rows = db.prepare('SELECT * FROM msg_announcements WHERE company_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 500').all(actor.companyId); }
      else rows = db.prepare("SELECT a.* FROM msg_announcements a JOIN msg_announcement_reads r ON r.announcement_id = a.id WHERE a.company_id = ? AND lower(r.user_ref) = lower(?) AND r.is_active = 1 AND a.is_active = 1 AND a.announcement_status IN ('PUBLISHED', 'EXPIRED') ORDER BY a.id DESC LIMIT 500").all(actor.companyId, actor.user);
      if (status) rows = rows.filter((r) => r.announcement_status === status);
      const out = rows.map((r) => annView(actor, r, { forSender: r.sender_ref === actor.user }));
      return { rows: out.slice(offset, offset + limit).map((r) => ({ ...r, body: excerpt(r.body, 200), quiz: undefined })), total: out.length, unread: v === 'received' ? out.filter((r) => !r.mine?.readAt && r.status === 'PUBLISHED').length : undefined };
    },
    get(actor, aid) {
      const r = annRow(aid, actor.companyId);
      const mine = r && db.prepare('SELECT 1 FROM msg_announcement_reads WHERE announcement_id = ? AND lower(user_ref) = lower(?) AND is_active = 1').get(r.id, actor.user);
      const sender = r && r.sender_ref === actor.user;
      if (!r || (!mine && !sender && !anywhere(actor, 'msg.comm.view_all'))) throw notFound('That announcement does not exist, or you may not see it.');
      const out = annView(actor, r, { forSender: sender });
      if (sender || anywhere(actor, 'msg.comm.view_all')) out.recipients = db.prepare('SELECT user_ref, read_at, confirmed_at, quiz_score, attempts FROM msg_announcement_reads WHERE announcement_id = ? AND is_active = 1 ORDER BY (read_at IS NULL) DESC, user_ref').all(r.id).map((x2) => ({ username: x2.user_ref, name: name(actor.companyId, x2.user_ref), readAt: x2.read_at, confirmedAt: x2.confirmed_at, score: x2.quiz_score, attempts: x2.attempts }));
      return out;
    },
    /** Opening it is reading it: the first time is recorded. */
    markRead(actor, aid) {
      const r = annRow(aid, actor.companyId);
      const m = r && db.prepare('SELECT * FROM msg_announcement_reads WHERE announcement_id = ? AND lower(user_ref) = lower(?) AND is_active = 1').get(r.id, actor.user);
      if (!r || !m) throw notFound('That announcement does not exist, or it is not addressed to you.');
      if (!m.read_at) db.prepare('UPDATE msg_announcement_reads SET read_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, nowIso(), m.id);
      return annView(actor, r);
    },
    /** The confirmation, with the quiz when there is one: all answers must be right to confirm; wrong answers may be tried again. */
    confirm(actor, aid, { answers }) {
      const r = annRow(aid, actor.companyId);
      const m = r && db.prepare('SELECT * FROM msg_announcement_reads WHERE announcement_id = ? AND lower(user_ref) = lower(?) AND is_active = 1').get(r.id, actor.user);
      if (!r || !m) throw notFound('That announcement does not exist, or it is not addressed to you.');
      if (r.announcement_status !== 'PUBLISHED') throw conflict('This announcement is no longer open for confirmation.');
      if (m.confirmed_at) return { ...annView(actor, r), passed: true, replay: true };
      const quiz = JSON.parse(r.quiz_json || '[]');
      if (quiz.length && answers.length !== quiz.length) throw unprocessable(`Answer all ${quiz.length} questions.`, [{ field: 'answers', message: `answer all ${quiz.length} questions` }]);
      const score = quiz.reduce((n, q, k) => n + (answers[k] === q.correct ? 1 : 0), 0);
      const passed = score === quiz.length;
      transaction(db, () => {
        db.prepare('UPDATE msg_announcement_reads SET read_at = COALESCE(read_at, ?), confirmed_at = ?, quiz_score = ?, attempts = attempts + 1, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(nowIso(), passed ? nowIso() : null, quiz.length ? score : null, actor.user, nowIso(), m.id);
        writeAudit(db, { entity: 'msg_announcement_reads', entityId: m.id, action: passed ? 'confirm' : 'quiz_failed', newValues: { score, of: quiz.length }, actor: actor.user, companyId: actor.companyId });
      });
      return { ...annView(actor, annRow(r.id, actor.companyId)), passed, score, of: quiz.length };
    },
    /** Scheduled announcements go out and old ones expire (the minute job). */
    cycle(companyId) {
      let published = 0;
      for (const r of db.prepare("SELECT * FROM msg_announcements WHERE company_id = ? AND announcement_status = 'SCHEDULED' AND publish_at <= ? AND is_active = 1").all(companyId, nowIso())) {
        try { publishNow({ user: r.sender_ref, companyId }, r); published += 1; } catch { db.prepare("UPDATE msg_announcements SET announcement_status = 'CANCELLED', remarks = 'Nobody matched the audience when it was due', updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), r.id); }
      }
      const expired = db.prepare("UPDATE msg_announcements SET announcement_status = 'EXPIRED', updated_at = ?, version = version + 1 WHERE company_id = ? AND announcement_status = 'PUBLISHED' AND expires_at IS NOT NULL AND expires_at <= ?").run(nowIso(), companyId, nowIso()).changes;
      return { published, expired };
    },
    audienceSize(actor, a) { mayAnnounce(actor, a); return { recipients: resolveAudience(actor.companyId, a).length }; },
  };

  // ================= escalated conversations (FR-06) =================
  const escView = (actor, r) => { const c = x.convRow(r.conversation_id); return { id: r.id, conversationId: r.conversation_id, conversation: c?.title ?? '', messageId: r.message_id, raisedBy: { username: r.raised_by, name: name(actor.companyId, r.raised_by) }, reason: r.reason, status: r.escalation_status, escalateAt: r.escalate_at, escalatedAt: r.escalated_at,
    escalatedTo: JSON.parse(r.escalated_to_json || '[]').map((u) => ({ username: u, name: name(actor.companyId, u) })), resolvedBy: r.resolved_by, resolvedAt: r.resolved_at, resolution: r.resolution, createdAt: r.created_at }; };
  const escalations = {
    raise(actor, convId, b) {
      const c = x.must(actor, convId);
      if (c.conv_type === 'EXTERNAL') throw unprocessable('External threads cannot be flagged here.');
      if (b.messageId && !db.prepare('SELECT 1 FROM msg_messages WHERE id = ? AND conversation_id = ?').get(b.messageId, c.id)) throw notFound('That message is not in this conversation.');
      return transaction(db, () => {
        if (db.prepare("SELECT 1 FROM msg_escalations WHERE conversation_id = ? AND escalation_status IN ('OPEN', 'ESCALATED') AND is_active = 1").get(c.id)) throw conflict('This conversation is already flagged and not yet resolved.');
        const at = new Date(Date.now() + b.afterHours * 3_600_000).toISOString();
        const eid = Number(db.prepare("INSERT INTO msg_escalations (company_id, conversation_id, message_id, raised_by, reason, escalate_at, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'msg_escalation')").run(actor.companyId, c.id, b.messageId ?? null, actor.user, b.reason, at, c.project_id, c.site_id, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'msg_escalations', entityId: eid, action: 'raise', newValues: { conversation: c.id, afterHours: b.afterHours }, actor: actor.user, companyId: actor.companyId, reason: b.reason });
        emit('msg.escalation.raised', { entity: 'msg_escalation', id: eid, companyId: actor.companyId, projectId: c.project_id }, actor.user, { conversationId: c.id });
        x.systemMessage(c, { user: 'system' }, `${name(actor.companyId, actor.user)} flagged this conversation as unresolved: ${b.reason}. It goes to their managers in ${b.afterHours} hour${b.afterHours === 1 ? '' : 's'} unless someone resolves it.`);
        return escView(actor, db.prepare('SELECT * FROM msg_escalations WHERE id = ?').get(eid));
      });
    },
    resolve(actor, eid, { resolution }) {
      const r = db.prepare('SELECT * FROM msg_escalations WHERE id = ? AND company_id = ? AND is_active = 1').get(eid, actor.companyId);
      if (!r) throw notFound('That escalation does not exist.');
      const c = x.convRow(r.conversation_id);
      const toMe = JSON.parse(r.escalated_to_json || '[]').some((u) => u.toLowerCase() === actor.user.toLowerCase());
      const member = c && x.memberRow(c.id, actor.user) && !x.memberRow(c.id, actor.user).left_at;
      if (!(r.raised_by === actor.user || toMe || (member && x.isAdmin(actor, c)))) throw notFound('That escalation does not exist, or you may not resolve it.');
      if (r.escalation_status === 'RESOLVED') throw conflict('This was already resolved.');
      db.prepare("UPDATE msg_escalations SET escalation_status = 'RESOLVED', resolved_by = ?, resolved_at = ?, resolution = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), resolution, actor.user, nowIso(), r.id);
      writeAudit(db, { entity: 'msg_escalations', entityId: r.id, action: 'resolve', actor: actor.user, companyId: actor.companyId, reason: resolution });
      if (c) x.systemMessage(c, { user: 'system' }, `${name(actor.companyId, actor.user)} marked the flagged issue as resolved: ${resolution}`);
      return escView(actor, db.prepare('SELECT * FROM msg_escalations WHERE id = ?').get(r.id));
    },
    list(actor, /** @type {{ view: string, status?: string }} */ { view: v, status }) {
      let rows = db.prepare('SELECT * FROM msg_escalations WHERE company_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 500').all(actor.companyId);
      if (v === 'all') { if (!anywhere(actor, 'msg.comm.view_all')) throw forbidden('You may not see all escalations (permission msg.comm.view_all).'); rows = rows.filter((r) => may(actor, 'msg.comm.view_all', { companyId: actor.companyId, projectId: r.project_id ?? undefined })); }
      else if (v === 'received') rows = rows.filter((r) => JSON.parse(r.escalated_to_json || '[]').some((u) => u.toLowerCase() === actor.user.toLowerCase()));
      else rows = rows.filter((r) => r.raised_by === actor.user || (x.memberRow(r.conversation_id, actor.user) && !x.memberRow(r.conversation_id, actor.user).left_at));
      if (status) rows = rows.filter((r) => r.escalation_status === status);
      return { rows: rows.map((r) => escView(actor, r)) };
    },
    /** Unresolved at the time: the raiser's managers are told and, in a group, join it (a direct conversation is never opened to them). */
    cycle(companyId) {
      let n = 0;
      for (const r of db.prepare("SELECT * FROM msg_escalations WHERE company_id = ? AND escalation_status = 'OPEN' AND escalate_at <= ? AND is_active = 1").all(companyId, nowIso())) {
        const c = x.convRow(r.conversation_id);
        if (!c) continue;
        const managers = managersOf(companyId, c.project_id, [r.raised_by]);
        transaction(db, () => {
          db.prepare("UPDATE msg_escalations SET escalation_status = 'ESCALATED', escalated_at = ?, escalated_to_json = ?, updated_by = 'system', updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), JSON.stringify(managers), nowIso(), r.id);
          const open = c.conv_type !== 'DIRECT' && !x.secureRow(c.id);
          const joined = [];
          if (open) for (const u of managers) if (!x.memberRow(c.id, u)) { db.prepare("INSERT INTO msg_members (company_id, conversation_id, user_ref, member_role, member_source, created_by, source_type) VALUES (?, ?, ?, 'MEMBER', 'ESCALATION', 'system', 'msg_escalation')").run(companyId, c.id, u); joined.push(u); }
          writeAudit(db, { entity: 'msg_escalations', entityId: r.id, action: 'escalate', newValues: { managers, joined }, actor: 'system', companyId });
          emit('msg.escalation.escalated', { entity: 'msg_escalation', id: r.id, companyId, projectId: c.project_id }, 'system', { conversationId: c.id, managers });
          x.systemMessage(c, { user: 'system' }, `Not resolved in time: escalated to ${managers.length ? managers.map((u) => name(companyId, u)).join(', ') : 'nobody (no manager could be found on the escalation path)'}${joined.length ? '; they were added to this conversation' : open ? '' : '; this conversation stays private, they see only the reason'}.`);
          for (const u of managers) notif.notify({ companyId, templateCode: 'msg.escalation', recipients: [`user:${u}`], data: { conversation: c.title || 'a conversation', raised: name(companyId, r.raised_by), reason: r.reason }, link: open ? link(c) : '/collab/center', priority: 'HIGH', sourceType: 'msg_escalation', sourceId: String(r.id), eventKey: `msg.escalation:${r.id}:${u}`, projectId: c.project_id ?? undefined });
        });
        n += 1;
      }
      return n;
    },
  };

  // ================= message to action (FR-05) =================
  const actions = {
    types(actor) { return { rows: messageActions.list().map((t) => ({ type: t.type, label: t.label, part: t.part ?? null, available: Boolean(t.available), allowed: Boolean(t.available) && (!t.permission || anywhere(actor, t.permission)) })) }; },
    /** What the form is filled with: the words of the message, its attachments and where the conversation belongs. */
    draft(actor, messageId, type) {
      const m = db.prepare('SELECT * FROM msg_messages WHERE id = ? AND is_active = 1').get(messageId);
      if (!m) throw notFound('That message does not exist.');
      const c = x.must(actor, m.conversation_id);
      if (x.secureRow(c.id)) throw unprocessable('A message of a secure conversation is not readable here, so it cannot be turned into a record.');
      const files = JSON.parse(m.attachments_json || '[]');
      const attachments = files.length ? db.prepare(`SELECT id, original_name AS name, size_bytes AS size, scan_status FROM core_files WHERE id IN (${files.map(() => '?').join(',')}) AND company_id = ? AND is_active = 1`).all(...files, actor.companyId) : [];
      const others = db.prepare('SELECT user_ref FROM msg_members WHERE conversation_id = ? AND left_at IS NULL AND is_active = 1').all(c.id).map((r) => ({ username: r.user_ref, name: name(actor.companyId, r.user_ref) })).filter((u) => u.username !== actor.user);
      const def = messageActions.get(type);
      return { type, label: def?.label ?? type, available: Boolean(def?.available), part: def?.part ?? null, messageId: m.id, conversationId: c.id, conversation: c.title, title: excerpt(m.body, 120), description: `${m.body}\n\nFrom the conversation "${c.title || 'Messages'}", message ${m.id} of ${name(actor.companyId, m.sender_ref)}.`.slice(0, 4000), projectId: c.project_id, siteId: c.site_id, attachments, people: others };
    },
    async create(actor, messageId, b) {
      const def = messageActions.get(b.type);
      if (!def) throw badRequest('That kind of record is not known.');
      if (!def.available) throw conflict(`${def.label} is built in part ${def.part}, which is not live yet. Nothing was created.`);
      const d = actions.draft(actor, messageId, b.type);
      const draft = { title: b.title?.trim() || d.title, description: b.description ?? d.description, assignees: b.assignees, dueDate: b.dueDate, priority: b.priority, projectId: b.projectId ?? d.projectId ?? undefined, siteId: b.siteId ?? d.siteId ?? undefined };
      const made = await def.create(db, actor, { ...draft, messageId, conversationId: d.conversationId });
      db.prepare("INSERT INTO msg_actions (company_id, message_id, conversation_id, action_type, target_entity, target_id, target_label, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'msg_action')").run(actor.companyId, messageId, d.conversationId, b.type, made.entity, String(made.id), made.label ?? '', draft.projectId ?? null, draft.siteId ?? null, actor.user);
      let copied = 0; const failed = [];
      if (b.includeAttachments && made.entity === 'tsk_task') {
        for (const f of d.attachments) {
          try { await filesOf(db).copyTo(actor, { fileId: f.id, entity: 'tsk_task', entityId: made.id, projectId: draft.projectId ?? null, siteId: draft.siteId ?? null }); copied += 1; } catch (e) { failed.push({ name: f.name, why: e.message }); }
        }
      }
      writeAudit(db, { entity: 'msg_actions', entityId: messageId, action: 'to_action', newValues: { type: b.type, target: `${made.entity}:${made.id}`, attachments: copied }, actor: actor.user, companyId: actor.companyId });
      publishEvent(db, { type: 'col.trace.requested', entity: 'msg_message', entityId: messageId, actorId: actor.user, companyId: actor.companyId, projectId: draft.projectId ?? undefined, data: { from: { entity: 'msg_message', id: String(messageId) }, to: { entity: made.entity, id: String(made.id) }, relation: 'DERIVED' } });
      publishEvent(db, { type: 'msg.action.created', entity: 'msg_message', entityId: messageId, actorId: actor.user, companyId: actor.companyId, projectId: draft.projectId ?? undefined, data: { type: b.type, target: `${made.entity}:${made.id}` } });
      const c = x.convRow(d.conversationId);
      if (c) x.systemMessage(c, { user: 'system' }, `${name(actor.companyId, actor.user)} made ${def.label.toLowerCase()} ${made.label ?? made.id} from a message.`);
      return { ...made, type: b.type, attachmentsCopied: copied, attachmentsFailed: failed };
    },
  };

  // ================= the Communication Center (FR-02) =================
  function summary(actor) {
    const list = base.conversations.list(actor, { view: 'all', limit: 1000 }).rows;
    const by = (t) => list.filter((c) => c.type === t);
    const part = (rows) => ({ total: rows.length, unread: rows.filter((c) => c.unread > 0).length });
    const acks = instructions.pending(actor);
    const mineSent = db.prepare("SELECT * FROM msg_instructions WHERE company_id = ? AND sender_ref = ? AND instruction_status IN ('OPEN', 'ESCALATED') AND is_active = 1").all(actor.companyId, actor.user).map((r) => view(actor, r));
    const ann = announcements.list(actor, { view: 'received', limit: 1, offset: 0 });
    const esc = escalations.list(actor, { view: 'mine' }).rows.filter((r) => r.status !== 'RESOLVED');
    const received = escalations.list(actor, { view: 'received' }).rows.filter((r) => r.status === 'ESCALATED');
    return {
      tiles: { myChats: part(list.filter((c) => ['DIRECT', 'GROUP'].includes(c.type))), teams: part(by('TEAM')), projects: part(by('PROJECT')), sites: part(by('SITE')), departments: part(by('DEPARTMENT')), linked: part(by('RECORD')), unread: { total: list.filter((c) => c.unread > 0).length, messages: list.reduce((n, c) => n + c.unread, 0) },
        pendingAcknowledgements: acks.counts, importantInstructions: { open: acks.rows.filter((r) => ['HIGH', 'URGENT'].includes(r.priority)).length, sentOpen: mineSent.length, sentOverdue: mineSent.filter((r) => r.overdue).length }, announcements: { unread: ann.unread ?? 0 }, escalations: { raised: esc.length, received: received.length } },
      pending: acks.rows.slice(0, 5), exceptions: [...acks.rows.filter((r) => r.overdue).slice(0, 5).map((r) => ({ kind: 'OVERDUE_ACK', id: r.id, text: `${r.title} (due ${r.dueAt?.slice(0, 10)})`, link: '/collab/acknowledgements' })), ...received.slice(0, 5).map((r) => ({ kind: 'ESCALATION', id: r.id, text: `${r.conversation}: ${r.reason}`, link: `/collab/messages?c=${r.conversationId}` }))],
      can: { instruct: anywhere(actor, 'msg.instruction.send'), announce: anywhere(actor, 'msg.announcement.send'), seeAll: anywhere(actor, 'msg.comm.view_all'), autogroups: anywhere(actor, 'msg.autogroup.view') },
    };
  }

  /** The minute job for one company: scheduled announcements, instructions past their due time, flagged conversations past their time. */
  function cycle(companyId) { return { announcements: announcements.cycle(companyId), instructionsEscalated: instructions.escalate(companyId), conversationsEscalated: escalations.cycle(companyId) }; }
  return { instructions, announcements, escalations, actions, summary, cycle, resolveAudience };
}
