import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApprovalEngine } from '../../platform/approvals/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { hasPermissionAnywhere } from '../../platform/auth/index.js';
import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';

/**
 * Part 29.08 — help desk, knowledge base and in-app help.
 *
 * Anyone raises a ticket from any page: the page, the record, the correlation ID of the last failed call, the browser and a screenshot are
 * captured. The category routes it to a support team, the priority sets its SLA (parameters), the team picks it up, and every change is a
 * timeline entry and an update to the person in the app and by e-mail or WhatsApp where they chose. A job escalates a ticket past its SLA
 * (to the team lead, then ITADM) and the person rates the resolution.
 *
 * A data correction is never a direct database edit (BR-01): it is a request with the record and the fields asked, approved by the module's
 * owner (and the auditor for financial data); the owner then makes the change through the module's own transaction (a reversal, an
 * amendment, a change request) and records its reference, which resolves the ticket.
 *
 * Knowledge articles are linked to page routes, so the "?" of a page lists its articles; tours are step lists for roles; announcements show
 * between two dates; the release notes are the files written by the release tool (00.03). The dashboard counts open tickets by status,
 * priority and team, SLA breaches, resolution time and satisfaction.
 */
export const HELP_FLAG = 'ff.admin.p2908';
export const CORRECTION_TYPE = 'hd_data_correction';
export const CATEGORIES = Object.freeze({ HOW_TO: 'APP_SUPPORT', BUG: 'APP_SUPPORT', ACCESS: 'IT_SUPPORT', DEVICE: 'IT_SUPPORT', DATA_CORRECTION: 'DATA_SUPPORT', REQUEST: 'APP_SUPPORT', OTHER: 'APP_SUPPORT' });
export const TEAMS = Object.freeze({ APP_SUPPORT: { label: 'Application support', lead: 'ITADM' }, IT_SUPPORT: { label: 'IT and access', lead: 'ITADM' }, DATA_SUPPORT: { label: 'Data corrections', lead: 'ITADM' } });
export const PRIORITIES = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const OPEN = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_USER'];
/** The owner of each module's data, who approves a correction; financial modules add the auditor. */
const OWNER = { fin: 'ACCMGR', bill: 'QS', pay: 'ACCMGR', proc: 'PROCMGR', inv: 'STOREMGR', hr: 'HRMGR', att: 'HRMGR', site: 'PM', plant: 'PLANTMGR', proj: 'PD', mdm: 'PROCMGR', qa: 'QCMGR', hse: 'HSEE', ctr: 'COMMGR', bud: 'CFO', est: 'EST', bd: 'BD' };
const FINANCIAL = new Set(['fin', 'bill', 'pay', 'bud']);
for (const [p, h] of /** @type {[string, number][]} */ ([['URGENT', 4], ['HIGH', 8], ['MEDIUM', 24], ['LOW', 72]])) {
  const key = `hd.sla.${p.toLowerCase()}_hours`;
  if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType: 'integer', default: h, min: 1, max: 720, scopes: ['system', 'company'], description: `Part 29.08 FR-01: hours to resolve a ${p.toLowerCase()} priority ticket before it is escalated.` });
}
const iso = (d = new Date()) => d.toISOString();

const services = new WeakMap();
export const helpdeskOf = (db) => services.get(db) ?? null;

/** @param {any} context @param {{ jobs?: any, scheduler?: any, releaseDir?: string }} deps */
export function createHelpdesk(context, { jobs, scheduler, releaseDir } = {}) {
  const { db } = context;
  const guard = (actor, key) => {
    if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, HELP_FLAG)) throw notFound('The help desk is not enabled for this company.');
    if (key && !hasPermissionAnywhere(actor, key)) throw forbidden(`You may not do this (permission ${key}).`);
  };
  const support = (actor) => hasPermissionAnywhere(actor, 'hd.ticket.work');
  const slaHours = (companyId, priority) => Number(createParameterStore(db).get(`hd.sla.${priority.toLowerCase()}_hours`, { companyId, date: iso().slice(0, 10) }));
  const tell = (t, code, data, recipients = [`user:${t.raised_by}`]) => {
    const channels = ['IN_APP', ...JSON.parse(t.channels_json ?? '[]').filter((c) => ['EMAIL', 'WHATSAPP'].includes(c))];
    try { notificationsOf(db).notify({ companyId: t.company_id, templateCode: code, recipients, channels, data: { ticket: t.ticket_no, subject: t.subject, ...data }, link: `/help/tickets?ticket=${t.id}`, sourceType: 'hd_tickets', sourceId: t.id }); } catch { /* the ticket is still saved */ }
  };
  const note = (t, actor, kind, text, internal = false) => db.prepare("INSERT INTO hd_ticket_notes (company_id, ticket_id, kind, body, internal, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'ticket')").run(t.company_id, t.id, kind, text, internal ? 1 : 0, actor.user);
  const row = (actor, id) => {
    const t = db.prepare('SELECT * FROM hd_tickets WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
    if (!t || (t.raised_by !== actor.user && !support(actor) && !hasPermissionAnywhere(actor, 'hd.ticket.view_all'))) throw notFound('That ticket does not exist.');
    return t;
  };
  const view = (t, actor) => ({ id: t.id, ticketNo: t.ticket_no, subject: t.subject, description: t.description, category: t.category, priority: t.priority, team: t.team, teamLabel: TEAMS[t.team]?.label, status: t.status, assignedTo: t.assigned_to, slaDue: t.sla_due,
    breached: OPEN.includes(t.status) && t.sla_due < iso(), escalationLevel: t.escalation_level, pageRef: t.page_ref, pageTitle: t.page_title, entity: t.entity, entityId: t.entity_id, correlationId: support(actor) ? t.correlation_id : t.correlation_id ? '•••' + t.correlation_id.slice(-6) : null,
    failedCall: support(actor) && t.failed_call_json ? JSON.parse(t.failed_call_json) : null, userAgent: support(actor) ? t.user_agent : null, screenshotFileId: t.screenshot_file_id, channels: JSON.parse(t.channels_json ?? '[]'), resolution: t.resolution, resolvedAt: t.resolved_at, rating: t.rating, ratingComment: t.rating_comment,
    raisedBy: t.raised_by, createdAt: t.created_at, mine: t.raised_by === actor.user, canWork: support(actor), canRate: t.raised_by === actor.user && t.status === 'RESOLVED' && !t.rating });

  // ---------------------------------------------------------------- tickets (FR-01, FR-05)
  const nextNo = (companyId) => `HD-${String((db.prepare('SELECT COUNT(*) AS n FROM hd_tickets WHERE company_id = ?').get(companyId).n ?? 0) + 1).padStart(6, '0')}`;
  const tickets = {
    raise(actor, b) {
      guard(actor, 'hd.ticket.raise');
      const team = CATEGORIES[b.category]; const due = iso(new Date(Date.now() + slaHours(actor.companyId, b.priority) * 3_600_000));
      return transaction(db, () => {
        const id = Number(db.prepare(`INSERT INTO hd_tickets (company_id, ticket_no, subject, description, category, priority, team, status, sla_due, page_ref, page_title, entity, entity_id, correlation_id, failed_call_json, user_agent, channels_json, raised_by, created_by, source_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ticket')`).run(actor.companyId, nextNo(actor.companyId), b.subject, b.description, b.category, b.priority, team, due, b.pageRef ?? null, b.pageTitle ?? null, b.entity ?? null, b.entityId ?? null, b.correlationId ?? null,
          b.failedCall ? JSON.stringify(b.failedCall) : null, b.userAgent ?? null, JSON.stringify(b.channels ?? []), actor.user, actor.user).lastInsertRowid);
        const t = db.prepare('SELECT * FROM hd_tickets WHERE id = ?').get(id);
        note(t, actor, 'CREATED', `Raised from ${b.pageRef ?? 'the help desk'}${b.correlationId ? ` (correlation ${b.correlationId})` : ''}.`);
        writeAudit(db, { companyId: actor.companyId, entity: 'hd_tickets', entityId: String(id), action: 'raise', actor: actor.user, newValues: { category: b.category, priority: b.priority, pageRef: b.pageRef, correlationId: b.correlationId } });
        publishEvent(db, { type: 'admin.ticket.raised', entity: 'hd_tickets', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { ticketNo: t.ticket_no, category: b.category, priority: b.priority, team } });
        tell(t, 'hd.ticket.updated', { status: 'NEW', message: `Received. We aim to resolve it by ${due.slice(0, 16).replace('T', ' ')} UTC.` });
        return view(t, actor);
      });
    },
    list(actor, { scope = 'mine', status = null, team = null, breached = false, page = 1, pageSize = 25 } = {}) {
      guard(actor, 'hd.ticket.raise');
      const where = ['company_id = ?', 'deleted_at IS NULL']; const p = [actor.companyId];
      if (scope === 'queue' && (support(actor) || hasPermissionAnywhere(actor, 'hd.ticket.view_all'))) { if (status) { where.push('status = ?'); p.push(status); } else where.push(`status IN (${OPEN.map(() => '?').join(',')})`), p.push(...OPEN); }
      else if (scope === 'assigned') { where.push('assigned_to = ?'); p.push(actor.user); if (status) { where.push('status = ?'); p.push(status); } }
      else { where.push('raised_by = ?'); p.push(actor.user); if (status) { where.push('status = ?'); p.push(status); } }
      if (team) { where.push('team = ?'); p.push(team); }
      if (breached) { where.push('sla_due < ?'); p.push(iso()); }
      const sql = where.join(' AND ');
      return { rows: db.prepare(`SELECT * FROM hd_tickets WHERE ${sql} ORDER BY CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, sla_due, id DESC LIMIT ? OFFSET ?`).all(...p, pageSize, (page - 1) * pageSize).map((t) => view(t, actor)),
        total: db.prepare(`SELECT COUNT(*) AS n FROM hd_tickets WHERE ${sql}`).get(...p).n, page, pageSize, canWork: support(actor) };
    },
    get(actor, id) {
      guard(actor, 'hd.ticket.raise'); const t = row(actor, id);
      return { ...view(t, actor), notes: db.prepare('SELECT * FROM hd_ticket_notes WHERE ticket_id = ? ORDER BY id').all(t.id).filter((n) => !n.internal || support(actor)).map((n) => ({ id: n.id, kind: n.kind, body: n.body, internal: Boolean(n.internal), by: n.created_by, at: n.created_at })),
        corrections: db.prepare('SELECT * FROM hd_corrections WHERE ticket_id = ? ORDER BY id').all(t.id).map((c) => corrView(c, actor)) };
    },
    /** The support team works the ticket: assign, start, ask the person, resolve (with the resolution), close, cancel; notes and updates. */
    act(actor, id, { action, assignee = null, note: text = null, resolution = null, internal = false }) {
      guard(actor); const t = row(actor, id);
      const mine = t.raised_by === actor.user;
      if (action === 'comment') { if (!text) throw unprocessable('Write the note.'); note(t, actor, 'NOTE', text, internal && support(actor)); if (!internal && support(actor)) tell(t, 'hd.ticket.updated', { status: t.status, message: text }); if (mine && t.status === 'WAITING_USER') db.prepare("UPDATE hd_tickets SET status = 'IN_PROGRESS', updated_at = ? WHERE id = ?").run(iso(), t.id); return tickets.get(actor, t.id); }
      if (action === 'cancel' && mine && OPEN.includes(t.status)) { db.prepare("UPDATE hd_tickets SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), t.id); note(t, actor, 'STATUS', 'Cancelled by the person who raised it.'); return tickets.get(actor, t.id); }
      if (action === 'reopen' && mine && t.status === 'RESOLVED') { db.prepare("UPDATE hd_tickets SET status = 'IN_PROGRESS', resolved_at = NULL, updated_at = ?, version = version + 1 WHERE id = ?").run(iso(), t.id); note(t, actor, 'STATUS', text ? `Reopened: ${text}` : 'Reopened.'); return tickets.get(actor, t.id); }
      if (!support(actor)) throw forbidden('Only the support team works tickets (permission hd.ticket.work).');
      const next = { assign: 'ASSIGNED', start: 'IN_PROGRESS', wait: 'WAITING_USER', resolve: 'RESOLVED', close: 'CLOSED' }[action];
      if (!next) throw unprocessable('Unknown action.');
      if (!OPEN.includes(t.status) && !(action === 'close' && t.status === 'RESOLVED')) throw conflict(`The ticket is ${t.status.toLowerCase()}.`);
      if (action === 'resolve' && (!resolution || resolution.trim().length < 5)) throw unprocessable('Write the resolution.');
      if (action === 'resolve' && db.prepare("SELECT 1 FROM hd_corrections WHERE ticket_id = ? AND status IN ('SUBMITTED', 'APPROVED')").get(t.id)) throw conflict('A data correction of this ticket is still open: it resolves the ticket when the owner records the module transaction.');
      const to = action === 'assign' ? (assignee ?? actor.user) : t.assigned_to ?? actor.user;
      db.prepare('UPDATE hd_tickets SET status = ?, assigned_to = ?, resolution = COALESCE(?, resolution), resolved_at = CASE WHEN ? THEN ? ELSE resolved_at END, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(next, to, resolution, action === 'resolve' ? 1 : 0, iso(), actor.user, iso(), t.id);
      note(t, actor, 'STATUS', { assign: `Assigned to ${to}.`, start: 'Work started.', wait: `Waiting for you: ${text ?? 'more information is needed'}.`, resolve: `Resolved: ${resolution}`, close: 'Closed.' }[action]);
      writeAudit(db, { companyId: actor.companyId, entity: 'hd_tickets', entityId: String(t.id), action, actor: actor.user, newValues: { status: next, assignedTo: to } });
      tell(db.prepare('SELECT * FROM hd_tickets WHERE id = ?').get(t.id), 'hd.ticket.updated', { status: next, message: action === 'resolve' ? resolution : action === 'wait' ? (text ?? 'More information is needed.') : `Status: ${next.toLowerCase().replace('_', ' ')}.` });
      return tickets.get(actor, t.id);
    },
    /** FR-05 the person rates a resolved ticket (1 to 5) and it closes. */
    rate(actor, id, { rating, comment = null }) {
      guard(actor, 'hd.ticket.raise'); const t = row(actor, id);
      if (t.raised_by !== actor.user) throw forbidden('Only the person who raised the ticket rates it.');
      if (t.status !== 'RESOLVED' || t.rating) throw conflict('Only a resolved ticket is rated, once.');
      db.prepare("UPDATE hd_tickets SET rating = ?, rating_comment = ?, status = 'CLOSED', updated_at = ?, version = version + 1 WHERE id = ?").run(rating, comment, iso(), t.id);
      note(t, actor, 'RATING', `Rated ${rating} of 5${comment ? `: ${comment}` : ''}.`);
      return tickets.get(actor, t.id);
    },
    screenshot(actor, id, fileId) {
      guard(actor, 'hd.ticket.raise'); const t = row(actor, id);
      if (!db.prepare("SELECT 1 FROM core_files WHERE id = ? AND linked_entity = 'hd_tickets' AND linked_id = ? AND deleted_at IS NULL").get(fileId, t.id)) throw unprocessable('That file is not attached to this ticket.');
      db.prepare('UPDATE hd_tickets SET screenshot_file_id = ?, updated_at = ? WHERE id = ?').run(fileId, iso(), t.id);
      return tickets.get(actor, t.id);
    },
  };
  /** T-01 SLA escalation: a ticket past its due time goes to the team lead (level 1), then to ITADM (level 2), each with a new due time. */
  function escalate() {
    let n = 0;
    for (const t of db.prepare(`SELECT * FROM hd_tickets WHERE status IN (${OPEN.map(() => '?').join(',')}) AND sla_due < ? AND escalation_level < 2 AND deleted_at IS NULL`).all(...OPEN, iso())) {
      const level = t.escalation_level + 1; const due = iso(new Date(Date.now() + slaHours(t.company_id, t.priority) * 3_600_000 / 2));
      const bump = level === 1 && t.priority !== 'URGENT' ? PRIORITIES[PRIORITIES.indexOf(t.priority) + 1] : t.priority;
      db.prepare('UPDATE hd_tickets SET escalation_level = ?, escalated_at = ?, priority = ?, sla_due = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(level, iso(), bump, due, iso(), t.id);
      note(t, { user: 'system' }, 'ESCALATED', `Past its SLA: escalated to ${level === 1 ? `the ${TEAMS[t.team].label} lead` : 'ITADM'}${bump !== t.priority ? `, priority raised to ${bump.toLowerCase()}` : ''}.`, true);
      tell(t, 'hd.ticket.escalated', { level: String(level), message: `Ticket ${t.ticket_no} is past its SLA.` }, [`role:${level === 1 ? TEAMS[t.team].lead : 'ITADM'}`, ...(t.assigned_to ? [`user:${t.assigned_to}`] : [])]);
      publishEvent(db, { type: 'admin.ticket.escalated', entity: 'hd_tickets', entityId: t.id, actorId: 'system', companyId: t.company_id, data: { ticketNo: t.ticket_no, level } });
      n += 1;
    }
    return { escalated: n };
  }

  // ---------------------------------------------------------------- data corrections (FR-02, BR-01)
  const corrView = (c, actor, mine = null) => ({ id: c.id, ticketId: c.ticket_id, module: c.module, entity: c.entity, entityId: c.entity_id, recordRef: c.record_ref, changes: JSON.parse(c.changes_json), reason: c.reason, owner: c.owner_role, financial: Boolean(c.financial), status: c.status,
    requestId: c.request_id, canApprove: mine ? mine.has(c.request_id) : false, canImplement: c.status === 'APPROVED' && hasPermissionAnywhere(actor, 'hd.correction.implement') && (actor.roles ?? []).includes(c.owner_role), transactionRef: c.transaction_ref, implementedBy: c.implemented_by, implementedAt: c.implemented_at, by: c.created_by, createdAt: c.created_at });
  const engine = createApprovalEngine({ db, handlers: { [CORRECTION_TYPE]: {
    authorize(_db, actor, r) { if (actor.companyId !== r.company_id) throw forbidden('Another company\'s request.'); },
    apply(_db, request, actor) {
      const c = db.prepare('SELECT * FROM hd_corrections WHERE id = ?').get(request.payload.correctionId);
      db.prepare("UPDATE hd_corrections SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), iso(), c.id);
      const t = db.prepare('SELECT * FROM hd_tickets WHERE id = ?').get(c.ticket_id);
      note(t, actor, 'CORRECTION', `Correction approved by ${actor.user}; the ${c.owner_role} makes it through the module's own transaction.`);
      publishEvent(db, { type: 'admin.correction.approved', entity: 'hd_corrections', entityId: c.id, actorId: actor.user, companyId: c.company_id, data: { module: c.module, entity: c.entity, entityId: c.entity_id } });
    },
  } } });
  const corrections = {
    list(actor, { status = null } = {}) {
      guard(actor, 'hd.ticket.raise');
      const mine = new Set(engine.awaiting(actor).map((x) => x.id));
      const rows = db.prepare(`SELECT * FROM hd_corrections WHERE company_id = ? ${status ? 'AND status = ?' : ''} ORDER BY id DESC LIMIT 200`).all(...[actor.companyId, ...(status ? [status] : [])])
        .filter((c) => support(actor) || mine.has(c.request_id) || c.created_by === actor.user || (actor.roles ?? []).includes(c.owner_role) || hasPermissionAnywhere(actor, 'hd.ticket.view_all'));
      return { rows: rows.map((c) => corrView(c, actor, mine)), owners: OWNER };
    },
    /** Raised by support on a ticket: the record and the fields asked (current → proposed); owner, then AUD for financial modules. */
    request(actor, ticketId, { module, entity, entityId, recordRef, changes, reason }) {
      guard(actor, 'hd.ticket.work'); const t = row(actor, ticketId);
      const owner = OWNER[module]; if (!owner) throw unprocessable(`No owner is set for module ${module}.`);
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO hd_corrections (company_id, ticket_id, module, entity, entity_id, record_ref, changes_json, reason, owner_role, financial, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, 'correction')")
          .run(actor.companyId, t.id, module, entity, entityId, recordRef, JSON.stringify(changes), reason, owner, FINANCIAL.has(module) ? 1 : 0, actor.user).lastInsertRowid);
        const req = engine.submit(actor, { type: CORRECTION_TYPE, title: `Data correction ${t.ticket_no}: ${recordRef}`, targetType: 'hd_corrections', targetId: String(id), payload: { correctionId: id, module, entity, entityId }, reason, chain: FINANCIAL.has(module) ? [owner, 'AUD'] : [owner] });
        db.prepare('UPDATE hd_corrections SET request_id = ? WHERE id = ?').run(req.id, id);
        db.prepare("UPDATE hd_tickets SET status = 'IN_PROGRESS', assigned_to = COALESCE(assigned_to, ?), updated_at = ? WHERE id = ?").run(actor.user, iso(), t.id);
        note(t, actor, 'CORRECTION', `Correction requested on ${recordRef}: ${changes.map((x) => `${x.field} ${x.current ?? ''} → ${x.proposed}`).join('; ')}. Approval: ${FINANCIAL.has(module) ? `${owner}, then AUD` : owner}.`);
        writeAudit(db, { companyId: actor.companyId, entity: 'hd_corrections', entityId: String(id), action: 'request', actor: actor.user, newValues: { module, entity, entityId, changes } });
        return corrView(db.prepare('SELECT * FROM hd_corrections WHERE id = ?').get(id), actor);
      });
    },
    decide(actor, id, body) {
      guard(actor, 'hd.ticket.raise');
      const c = db.prepare('SELECT * FROM hd_corrections WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); if (!c || c.status !== 'SUBMITTED') throw conflict('The correction is not waiting for approval.');
      const out = engine.act(actor, c.request_id, body);
      if (out.status === 'REJECTED' || out.status === 'RETURNED') { db.prepare("UPDATE hd_corrections SET status = 'REJECTED', updated_at = ? WHERE id = ?").run(iso(), c.id); note(db.prepare('SELECT * FROM hd_tickets WHERE id = ?').get(c.ticket_id), actor, 'CORRECTION', `Correction rejected by ${actor.user}${body.comment ? `: ${body.comment}` : ''}.`); }
      return corrView(db.prepare('SELECT * FROM hd_corrections WHERE id = ?').get(c.id), actor, new Set(engine.awaiting(actor).map((x) => x.id)));
    },
    /** BR-01 the owner records the module transaction that made the change; the ticket is resolved with it. */
    implement(actor, id, { transactionRef, note: text = null }) {
      guard(actor, 'hd.correction.implement');
      const c = db.prepare('SELECT * FROM hd_corrections WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); if (!c) throw notFound('That correction does not exist.');
      if (c.status !== 'APPROVED') throw conflict('Only an approved correction is implemented.');
      if (!(actor.roles ?? []).includes(c.owner_role)) throw forbidden(`The ${c.owner_role} makes this correction through the module.`);
      return transaction(db, () => {
        db.prepare("UPDATE hd_corrections SET status = 'IMPLEMENTED', transaction_ref = ?, implemented_by = ?, implemented_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(transactionRef, actor.user, iso(), iso(), c.id);
        const t = db.prepare('SELECT * FROM hd_tickets WHERE id = ?').get(c.ticket_id);
        const resolution = `Corrected through ${transactionRef}${text ? `: ${text}` : ''}.`;
        db.prepare("UPDATE hd_tickets SET status = 'RESOLVED', resolution = ?, resolved_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(resolution, iso(), iso(), t.id);
        note(t, actor, 'CORRECTION', `Implemented by ${actor.user} through ${transactionRef}.`);
        writeAudit(db, { companyId: actor.companyId, entity: 'hd_corrections', entityId: String(c.id), action: 'implement', actor: actor.user, newValues: { transactionRef } });
        tell(t, 'hd.ticket.updated', { status: 'RESOLVED', message: resolution });
        return corrView(db.prepare('SELECT * FROM hd_corrections WHERE id = ?').get(c.id), actor);
      });
    },
  };

  // ---------------------------------------------------------------- knowledge, tours, announcements, release notes (FR-03, FR-04)
  const artView = (a) => ({ id: a.id, kind: a.kind, title: a.title, body: a.body, module: a.module, routes: JSON.parse(a.page_codes_json ?? '[]'), roles: JSON.parse(a.roles_json ?? '[]'), steps: a.steps_json ? JSON.parse(a.steps_json) : [], version: a.article_version, status: a.status, validFrom: a.valid_from, validTo: a.valid_to, by: a.created_by, updatedAt: a.updated_at ?? a.created_at });
  const articles = {
    list(actor, { kind = null, q = null, route = null, all = false } = {}) {
      guard(actor, 'hd.ticket.raise');
      const where = ['company_id = ?', 'deleted_at IS NULL']; const p = [actor.companyId];
      if (!(all && hasPermissionAnywhere(actor, 'hd.article.manage'))) where.push("status = 'PUBLISHED'");
      if (kind) { where.push('kind = ?'); p.push(kind); }
      if (q) { where.push("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')"); const s = `%${String(q).replace(/[\\%_]/g, '\\$&')}%`; p.push(s, s); }
      let rows = db.prepare(`SELECT * FROM hd_articles WHERE ${where.join(' AND ')} ORDER BY kind, title LIMIT 500`).all(...p).map(artView);
      if (route) rows = rows.filter((a) => a.routes.some((r) => route === r || route.startsWith(`${r}/`) || route.startsWith(`${r}?`)));
      return { rows, canManage: hasPermissionAnywhere(actor, 'hd.article.manage') };
    },
    get(actor, id) { guard(actor, 'hd.ticket.raise'); const a = db.prepare('SELECT * FROM hd_articles WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!a || (a.status !== 'PUBLISHED' && !hasPermissionAnywhere(actor, 'hd.article.manage'))) throw notFound('That article does not exist.'); return artView(a); },
    save(actor, b) {
      guard(actor, 'hd.article.manage');
      if (b.kind === 'TOUR' && !b.steps?.length) throw unprocessable('A tour has at least one step.');
      if (b.kind === 'ANNOUNCEMENT' && !(b.validTo > b.validFrom)) throw unprocessable('An announcement ends after it starts.');
      return transaction(db, () => {
        let id = b.id ?? null;
        if (id) {
          const a = db.prepare('SELECT * FROM hd_articles WHERE id = ? AND company_id = ?').get(id, actor.companyId); if (!a) throw notFound('That article does not exist.');
          db.prepare('UPDATE hd_articles SET kind = ?, title = ?, body = ?, module = ?, page_codes_json = ?, roles_json = ?, steps_json = ?, valid_from = ?, valid_to = ?, status = ?, article_version = article_version + 1, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
            .run(b.kind, b.title, b.body, b.module ?? null, JSON.stringify(b.routes ?? []), JSON.stringify(b.roles ?? []), b.steps ? JSON.stringify(b.steps) : null, b.validFrom ?? null, b.validTo ?? null, b.status, actor.user, iso(), id);
        } else {
          id = Number(db.prepare("INSERT INTO hd_articles (company_id, kind, title, body, module, page_codes_json, roles_json, steps_json, valid_from, valid_to, status, article_version, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'article')")
            .run(actor.companyId, b.kind, b.title, b.body, b.module ?? null, JSON.stringify(b.routes ?? []), JSON.stringify(b.roles ?? []), b.steps ? JSON.stringify(b.steps) : null, b.validFrom ?? null, b.validTo ?? null, b.status, actor.user).lastInsertRowid);
        }
        writeAudit(db, { companyId: actor.companyId, entity: 'hd_articles', entityId: String(id), action: b.id ? 'update' : 'create', actor: actor.user, newValues: { kind: b.kind, title: b.title, status: b.status } });
        return artView(db.prepare('SELECT * FROM hd_articles WHERE id = ?').get(id));
      });
    },
  };
  /** FR-03 the "?" of a page: its articles, the tour for the person's roles, current announcements, the latest release notes. */
  function contextual(actor, route) {
    // every page asks: where the help desk is off, or the person may not raise tickets, the answer is "not enabled", not an error
    if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, HELP_FLAG) || !hasPermissionAnywhere(actor, 'hd.ticket.raise')) return { enabled: false, route };
    const now = iso(); const roles = new Set(actor.roles ?? []);
    const pub = db.prepare("SELECT * FROM hd_articles WHERE company_id = ? AND status = 'PUBLISHED' AND deleted_at IS NULL").all(actor.companyId).map(artView);
    const onPage = (a) => a.routes.some((r) => route === r || route.startsWith(`${r}/`));
    const seen = new Set(db.prepare('SELECT article_id FROM hd_tour_views WHERE company_id = ? AND user_name = ?').all(actor.companyId, actor.user).map((r) => r.article_id));
    const tour = pub.find((a) => a.kind === 'TOUR' && onPage(a) && (!a.roles.length || a.roles.some((r) => roles.has(r))));
    return { enabled: true, route, articles: pub.filter((a) => a.kind === 'ARTICLE' && onPage(a)).map(({ body: _b, ...a }) => a), tour: tour ?? null, tourSeen: tour ? seen.has(tour.id) : false,
      announcements: pub.filter((a) => a.kind === 'ANNOUNCEMENT' && a.validFrom <= now && a.validTo >= now && (!a.roles.length || a.roles.some((r) => roles.has(r)))), release: releaseNotes(actor, 1).rows[0] ?? null };
  }
  function tourSeen(actor, articleId) { guard(actor, 'hd.ticket.raise'); db.prepare("INSERT OR IGNORE INTO hd_tour_views (company_id, article_id, user_name, created_by, source_type) VALUES (?, ?, ?, ?, 'tour')").run(actor.companyId, Number(articleId), actor.user, actor.user); return { ok: true }; }
  /** FR-04 the release notes written by the release tool (00.03) in docs/erp/releases, newest first. */
  function releaseNotes(actor, limit = 20) {
    guard(actor, 'hd.ticket.raise');
    const dir = releaseDir; if (!dir || !existsSync(dir)) return { rows: [] };
    const files = readdirSync(dir).filter((f) => /^v\d+\.\d+\.\d+\.md$/.test(f)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).slice(0, limit);
    return { rows: files.map((f) => ({ version: f.replace(/^v|\.md$/g, ''), body: readFileSync(join(dir, f), 'utf8').slice(0, 20_000) })) };
  }

  // ---------------------------------------------------------------- dashboard (FR-05)
  function dashboard(actor) {
    guard(actor, 'hd.ticket.work');
    const c = actor.companyId; const now = iso(); const since = iso(new Date(Date.now() - 30 * 86_400_000));
    const one = (sql, ...p) => db.prepare(sql).get(c, ...p);
    const open = one(`SELECT COUNT(*) AS n FROM hd_tickets WHERE company_id = ? AND status IN ('NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_USER')`).n;
    const breached = one(`SELECT COUNT(*) AS n FROM hd_tickets WHERE company_id = ? AND status IN ('NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_USER') AND sla_due < ?`, now).n;
    const res = one('SELECT COUNT(*) AS n, AVG((julianday(resolved_at) - julianday(created_at)) * 24) AS h FROM hd_tickets WHERE company_id = ? AND resolved_at >= ?', since);
    const csat = one('SELECT COUNT(rating) AS n, AVG(rating) AS a FROM hd_tickets WHERE company_id = ? AND rating IS NOT NULL AND updated_at >= ?', since);
    const group = (col) => db.prepare(`SELECT ${col} AS k, COUNT(*) AS n FROM hd_tickets WHERE company_id = ? AND status IN ('NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_USER') GROUP BY ${col} ORDER BY n DESC`).all(c).map((r) => ({ key: r.k, n: r.n }));
    return { open, breached, resolved30: res.n, avgResolutionHours: res.h == null ? null : String(Number(res.h).toFixed(1)), ratings30: csat.n, avgRating: csat.a == null ? null : String(Number(csat.a).toFixed(1)),
      byStatus: group('status'), byPriority: group('priority'), byTeam: group('team').map((r) => ({ ...r, label: TEAMS[r.key]?.label ?? r.key })), byCategory: group('category'),
      corrections: db.prepare("SELECT status, COUNT(*) AS n FROM hd_corrections WHERE company_id = ? GROUP BY status").all(c).map((r) => ({ key: r.status, n: r.n })) };
  }

  const svc = { tickets, escalate, corrections, articles, contextual, tourSeen, releaseNotes, dashboard, engine, options: () => ({ categories: Object.keys(CATEGORIES), priorities: PRIORITIES, teams: Object.entries(TEAMS).map(([code, t]) => ({ code, label: t.label })), owners: OWNER }) };
  services.set(db, svc);
  if (jobs) {
    jobs.register('admin.helpdesk.escalate', async () => escalate(), { description: 'Escalates help desk tickets past their SLA (part 29.08).' });
    scheduler?.define({ code: 'admin.helpdesk.escalate', cron: '*/15 * * * *', jobType: 'admin.helpdesk.escalate', description: 'Every 15 minutes: tickets past their SLA are escalated.' });
  }
  return svc;
}

// screenshots are files of the ticket: the person who raised it and the support team may attach and see them
if (!fileEntities.get('hd_tickets')) {
  fileEntities.register({ entity: 'hd_tickets', label: 'Help desk ticket', resolve(db, actor, id) {
    const t = db.prepare('SELECT company_id, raised_by, status FROM hd_tickets WHERE id = ? AND deleted_at IS NULL').get(Number(id)); if (!t || t.company_id !== actor.companyId) return null;
    const team = hasPermissionAnywhere(actor, 'hd.ticket.work'); const own = t.raised_by === actor.user;
    return { companyId: t.company_id, projectId: null, siteId: null, canView: own || team, canEdit: (own || team) && !['CLOSED', 'CANCELLED'].includes(t.status), locked: false };
  } });
}
