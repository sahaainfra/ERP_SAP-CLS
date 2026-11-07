import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { writeExport, FORMATS } from '../../platform/export/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { tasksOf } from '../../platform/tasks/index.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { issueNumber } from '../core/numbering/service.js';
import { ACTION_STATUS, MEETING_DOC, MEETING_STATUS, MTYPES, esc, json, nowIso, rid, same } from './constants.js';

// Meetings, minutes and action items (part 10.05). A meeting has a type, a date, a chair and a minute-taker, attendees (people of the company and external stakeholders), an agenda, minutes, decisions and actions. The minute-taker sends the minutes
// and the chair approves them: the minutes are then issued (locked), every action becomes a task of its owner with its due date (04.08), the attendees and the owners are told (04.06) and the minutes can be printed as a PDF to be sent to the external
// attendees. A correction is a revision: a new draft with the same number and the next revision number; when it is issued the earlier one is superseded and the tasks of the actions that changed follow. The action tracker lists the actions of
// all issued meetings with the live status of their tasks. An owner updates their own action; the status moves the task.
const TASK_STATUS = { OPEN: 'OPEN', ACCEPTED: 'OPEN', IN_PROGRESS: 'IN_PROGRESS', BLOCKED: 'BLOCKED', DONE: 'DONE', VERIFIED: 'DONE', CLOSED: 'DONE', CANCELLED: 'CANCELLED' };
const STATUS_SQL = "(CASE WHEN a.deleted_at IS NOT NULL THEN 'CANCELLED' WHEN k.status IN ('DONE', 'VERIFIED', 'CLOSED') THEN 'DONE' WHEN k.status = 'CANCELLED' THEN 'CANCELLED' WHEN k.status = 'BLOCKED' THEN 'BLOCKED' WHEN k.status = 'IN_PROGRESS' THEN 'IN_PROGRESS' ELSE 'OPEN' END)";
export const meetingList = defineList({
  code: 'proj.meetings', label: 'Meetings', permission: 'proj.meeting.view',
  from: 'proj_meetings x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.title', 'p.code', 'x.chair_user', 'x.location'], defaultSort: '-meetingDate',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Meeting' }, rev: { sql: 'x.rev_no', type: 'number', label: 'Rev.' }, title: { sql: 'x.title', type: 'text', label: 'Title' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' },
    type: { sql: 'x.mtype', type: 'enum', label: 'Type', options: Object.entries(MTYPES) }, meetingDate: { sql: 'x.meeting_date', type: 'date', label: 'Date' }, chair: { sql: 'x.chair_user', type: 'text', label: 'Chair' }, minuteTaker: { sql: 'x.minute_taker', type: 'text', label: 'Minute-taker' },
    status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(MEETING_STATUS) },
  },
});
export const actionList = defineList({
  code: 'proj.meeting_actions', label: 'Action items', permission: 'proj.meeting.view',
  from: `proj_meeting_actions a JOIN proj_meetings x ON x.id = a.meeting_id JOIN org_projects p ON p.id = a.org_project_id LEFT JOIN tsk_tasks k ON k.id = a.task_id`, where: "a.deleted_at IS NULL AND x.deleted_at IS NULL AND x.status = 'APPROVED'", searchable: ['a.description', 'a.owner_user', 'x.doc_no', 'x.title', 'p.code'], defaultSort: 'dueDate',
  columns: {
    meeting: { sql: 'x.doc_no', type: 'text', label: 'Meeting' }, title: { sql: 'x.title', type: 'text', label: 'Meeting title' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'a.org_project_id', type: 'number', label: 'Project id' }, actionNo: { sql: 'a.action_no', type: 'number', label: 'No.' },
    description: { sql: 'a.description', type: 'text', label: 'Action' }, owner: { sql: 'a.owner_user', type: 'text', label: 'Owner' }, dueDate: { sql: 'a.due_date', type: 'date', label: 'Due' }, priority: { sql: 'a.priority', type: 'enum', label: 'Priority', options: [['LOW', 'Low'], ['MEDIUM', 'Medium'], ['HIGH', 'High'], ['URGENT', 'Urgent']] },
    status: { sql: STATUS_SQL, type: 'enum', label: 'Status', options: Object.entries(ACTION_STATUS) },
    overdue: { sql: `(CASE WHEN a.due_date < date('now', '+330 minutes') AND ${STATUS_SQL} IN ('OPEN', 'IN_PROGRESS', 'BLOCKED') THEN 1 ELSE 0 END)`, type: 'number', label: 'Overdue' },
  },
});

export function createMeetingService({ db }) {
  const authz = authzOf(db);
  const may = (actor, key, pid = null) => (pid == null ? authz.check(actor, key).allowed : authz.check(actor, key, { companyId: actor.companyId, projectId: pid }).allowed);
  const need = (actor, key, what, pid = null) => { if (!may(actor, key, pid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p); };
  const event = (type, actor, entity, id, companyId, projectId, data) => publishEvent(db, { type, entity, entityId: id, actorId: actor.user, companyId, projectId, data });
  const orgOf = (id) => db.prepare('SELECT * FROM org_projects WHERE id = ?').get(id);
  const userOf = (companyId, u) => db.prepare('SELECT username, display_name FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND is_active = 1').get(companyId, u);
  const scopeSql = (actor, alias = 'x', col = 'x.org_project_id') => { const f = authz.scopeFilter(actor, 'proj.meeting.view', { project: col }); return { sql: `${alias}.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  function project(actor, projectId, key = 'proj.meeting.view') {
    const o = orgOf(Number(projectId));
    if (!o || o.company_id !== actor.companyId || !db.prepare('SELECT 1 FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(o.id) || !may(actor, 'proj.meeting.view', o.id)) throw notFound('That project does not exist.');
    if (key !== 'proj.meeting.view') need(actor, key, 'do that with meetings', o.id);
    return o;
  }
  const mrow = (actor, id, key = 'proj.meeting.view') => {
    const m = db.prepare('SELECT * FROM proj_meetings WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!m || !may(actor, 'proj.meeting.view', m.org_project_id)) throw notFound('That meeting does not exist.');
    if (key !== 'proj.meeting.view') need(actor, key, 'do that with meetings', m.org_project_id);
    return m;
  };
  const fresh = (id) => db.prepare('SELECT * FROM proj_meetings WHERE id = ?').get(id);
  const editable = (m) => ['DRAFT', 'RETURNED'].includes(m.status);
  const lockedMsg = (m) => new HttpError(409, m.status === 'APPROVED' ? 'MINUTES_ISSUED' : 'MINUTES_LOCKED', m.status === 'APPROVED' ? `${m.doc_no} rev ${m.rev_no} is issued: it is corrected by a revision.` : `${m.doc_no} is ${MEETING_STATUS[m.status].toLowerCase()}.`);
  const nextNo = (actor) => {
    try { return issueNumber(db, { companyId: actor.companyId, docType: 'PROJ_MEETING', actor: actor.user, refType: 'proj_meetings' }).number; } catch (x) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(x?.code)) throw x; }
    let k = db.prepare('SELECT COUNT(DISTINCT doc_no) AS n FROM proj_meetings WHERE company_id = ?').get(actor.companyId).n + 1; let no = `MTG-${String(k).padStart(5, '0')}`;
    while (db.prepare('SELECT 1 FROM proj_meetings WHERE company_id = ? AND doc_no = ?').get(actor.companyId, no)) { k += 1; no = `MTG-${String(k).padStart(5, '0')}`; }
    return no;
  };
  const actionsOf = (meetingId) => db.prepare(`SELECT a.*, k.status AS task_status, k.task_no FROM proj_meeting_actions a LEFT JOIN tsk_tasks k ON k.id = a.task_id WHERE a.meeting_id = ? AND a.deleted_at IS NULL ORDER BY a.action_no, a.id`).all(meetingId);
  const aview = (a, actor) => { const st = a.task_status ? TASK_STATUS[a.task_status] : 'OPEN'; return { id: a.id, meetingId: a.meeting_id, no: a.action_no, description: a.description, ownerUser: a.owner_user, dueDate: a.due_date, priority: a.priority, taskId: a.task_id, taskNo: a.task_no ?? null, status: st, statusLabel: ACTION_STATUS[st], overdue: a.due_date < todayIST() && ['OPEN', 'IN_PROGRESS', 'BLOCKED'].includes(st), mine: same(a.owner_user, actor.user) }; };

  // ---- the meeting ----------------------------------------------------------------------------------------------------------------------------------------
  function problems(actor, o, b, m = null) {
    const p = []; const date = b.meetingDate ?? m?.meeting_date;
    if (!userOf(actor.companyId, b.chairUser ?? m?.chair_user)) p.push({ field: 'chairUser', message: 'The chair is an active user of your company' });
    if (!userOf(actor.companyId, b.minuteTaker ?? m?.minute_taker)) p.push({ field: 'minuteTaker', message: 'The minute-taker is an active user of your company' });
    if (same(b.chairUser ?? m?.chair_user, b.minuteTaker ?? m?.minute_taker)) p.push({ field: 'minuteTaker', message: 'The minute-taker and the chair are two people: the chair approves the minutes' });
    (b.attendees ?? []).forEach((a, i) => {
      if (a.kind === 'INTERNAL' && !(a.user && userOf(actor.companyId, a.user))) p.push({ field: `attendees.${i}.user`, message: 'An internal attendee is a user of your company' });
      if (a.kind === 'EXTERNAL' && a.stakeholderId && !db.prepare('SELECT 1 FROM proj_stakeholders WHERE id = ? AND org_project_id = ? AND deleted_at IS NULL').get(a.stakeholderId, o.id)) p.push({ field: `attendees.${i}.stakeholderId`, message: 'Choose a stakeholder of this project' });
    });
    (b.actions ?? []).forEach((a, i) => { if (!userOf(actor.companyId, a.ownerUser)) p.push({ field: `actions.${i}.ownerUser`, message: `${a.ownerUser} is not a user of your company` }); if (date && a.dueDate < date) p.push({ field: `actions.${i}.dueDate`, message: 'An action is due on or after the day of the meeting' }); });
    return p;
  }
  function writeActions(actor, m, actions, previous = []) {
    const keep = new Set();
    const old = previous.length ? previous : db.prepare('SELECT * FROM proj_meeting_actions WHERE meeting_id = ? AND deleted_at IS NULL').all(m.id);
    db.prepare('UPDATE proj_meeting_actions SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE meeting_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, m.id);
    actions.forEach((a, i) => {
      const prev = old.find((o) => !keep.has(o.id) && o.description === a.description.trim() && same(o.owner_user, a.ownerUser) && o.due_date === a.dueDate && o.task_id); if (prev) keep.add(prev.id);
      db.prepare("INSERT INTO proj_meeting_actions (company_id, meeting_id, org_project_id, action_no, description, owner_user, due_date, priority, task_id, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proj_meetings', ?)").run(m.company_id, m.id, m.org_project_id, i + 1, a.description.trim(), a.ownerUser, a.dueDate, a.priority ?? 'MEDIUM', prev?.task_id ?? null, m.org_project_id, actor.user, String(m.id));
    });
  }
  function view(actor, m, { detail = false } = {}) {
    const o = orgOf(m.org_project_id); const can = (k) => may(actor, k, m.org_project_id); const acts = detail ? actionsOf(m.id).map((a) => aview(a, actor)) : null;
    const open = db.prepare("SELECT id FROM proj_meetings WHERE supersedes_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(m.id);
    const out = {
      id: m.id, docNo: m.doc_no, revNo: m.rev_no, ref: `${m.doc_no}${m.rev_no ? ` rev ${m.rev_no}` : ''}`, supersedesId: m.supersedes_id, projectId: m.org_project_id, projectCode: o?.code, projectName: o?.name, type: m.mtype, typeLabel: MTYPES[m.mtype], title: m.title, meetingDate: m.meeting_date, startTime: m.start_time, location: m.location, chairUser: m.chair_user, minuteTaker: m.minute_taker,
      status: m.status, statusLabel: MEETING_STATUS[m.status], issuedAt: m.issued_at, issuedBy: m.issued_by, revisionReason: m.revision_reason, requestedBy: m.requested_by, createdBy: m.created_by, rowVersion: m.version, workflowInstanceId: m.workflow_instance_id, openRevisionId: open?.id ?? null, actionCount: db.prepare('SELECT COUNT(*) AS n FROM proj_meeting_actions WHERE meeting_id = ? AND deleted_at IS NULL').get(m.id).n,
      can: {
        edit: can('proj.meeting.edit') && editable(m), submit: can('proj.meeting.submit') && editable(m) && same(m.minute_taker, actor.user), withdraw: m.status === 'SUBMITTED' && same(m.requested_by, actor.user), cancel: can('proj.meeting.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(m.status),
        delete: can('proj.meeting.delete') && m.status === 'DRAFT' && !m.workflow_instance_id && !m.supersedes_id, amend: can('proj.meeting.amend') && m.status === 'APPROVED' && !open, print: can('proj.meeting.print'), export: can('proj.meeting.export'),
      },
    };
    if (detail) { out.attendees = json(m.attendees_json, []); out.agenda = json(m.agenda_json, []); out.minutes = m.minutes; out.decisions = json(m.decisions_json, []); out.actions = acts; out.distribution = json(m.distribution_json, null); }
    return out;
  }
  const meetings = {
    list(actor, query) { need(actor, 'proj.meeting.view', 'see meetings'); const s = scopeSql(actor); return runList(db, meetingList, parseListRequest(meetingList, query), { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id', map: (x) => { const v = view(actor, x); return { id: v.id, docNo: v.docNo, rev: v.revNo, ref: v.ref, title: v.title, projectId: v.projectId, project: v.projectCode, type: v.type, typeLabel: v.typeLabel, meetingDate: v.meetingDate, chair: v.chairUser, status: v.status, statusLabel: v.statusLabel, actions: v.actionCount }; } }); },
    exportSource(actor, req) {
      need(actor, 'proj.meeting.export', 'export meetings'); const s = scopeSql(actor); const opts = { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id' };
      return { title: meetingList.label, permission: 'proj.meeting.export', personal: false, columns: [{ key: 'ref', label: 'Meeting', type: 'text' }, { key: 'title', label: 'Title', type: 'text' }, { key: 'project', label: 'Project', type: 'text' }, { key: 'type', label: 'Type', type: 'text' }, { key: 'meetingDate', label: 'Date', type: 'text' }, { key: 'chair', label: 'Chair', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }], count: () => countList(db, meetingList, req, opts),
        rows: () => runList(db, meetingList, req, { ...opts, limit: null, map: (x) => { const v = view(actor, x); return { ref: v.ref, title: v.title, project: v.projectCode, type: v.typeLabel, meetingDate: v.meetingDate, chair: v.chairUser, status: v.statusLabel }; } }).data, describe: (r) => [r.q ? `search "${r.q}"` : ''].filter(Boolean) };
    },
    get(actor, id) { return view(actor, mrow(actor, id), { detail: true }); },
    create(actor, b) {
      const o = project(actor, b.projectId, 'proj.meeting.create'); fail(problems(actor, o, b));
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO proj_meetings (company_id, doc_no, org_project_id, mtype, title, meeting_date, start_time, location, chair_user, minute_taker, attendees_json, agenda_json, minutes, decisions_json, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proj_project', ?)").run(actor.companyId, nextNo(actor), o.id, b.mtype, b.title.trim(), b.meetingDate, b.startTime, b.location, userOf(actor.companyId, b.chairUser).username, userOf(actor.companyId, b.minuteTaker).username, JSON.stringify(b.attendees), JSON.stringify(b.agenda), b.minutes, JSON.stringify(b.decisions), o.id, actor.user, String(o.id)).lastInsertRowid);
        writeActions(actor, fresh(id), b.actions, []);
        writeAudit(db, { entity: 'proj_meetings', entityId: id, action: 'create', newValues: { title: b.title, type: b.mtype }, actor: actor.user, companyId: actor.companyId });
        return meetings.get(actor, id);
      });
    },
    update(actor, id, b) {
      const m = mrow(actor, id, 'proj.meeting.edit'); if (!editable(m)) throw lockedMsg(m);
      if (b.version != null && b.version !== m.version) throw conflict(`${m.doc_no} was changed by someone else (version ${m.version}, you had ${b.version}); reload it.`);
      const o = orgOf(m.org_project_id); fail(problems(actor, o, b, m));
      return transaction(db, () => {
        const u = (k, cur) => (b[k] === undefined ? cur : b[k]);
        db.prepare('UPDATE proj_meetings SET mtype = ?, title = ?, meeting_date = ?, start_time = ?, location = ?, chair_user = ?, minute_taker = ?, attendees_json = ?, agenda_json = ?, minutes = ?, decisions_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(u('mtype', m.mtype), String(u('title', m.title)).trim(), u('meetingDate', m.meeting_date), u('startTime', m.start_time), u('location', m.location), b.chairUser ? userOf(actor.companyId, b.chairUser).username : m.chair_user, b.minuteTaker ? userOf(actor.companyId, b.minuteTaker).username : m.minute_taker, b.attendees ? JSON.stringify(b.attendees) : m.attendees_json, b.agenda ? JSON.stringify(b.agenda) : m.agenda_json, u('minutes', m.minutes), b.decisions ? JSON.stringify(b.decisions) : m.decisions_json, actor.user, nowIso(), m.id);
        if (b.actions) writeActions(actor, m, b.actions);
        writeAudit(db, { entity: 'proj_meetings', entityId: m.id, action: 'update', actor: actor.user, companyId: m.company_id });
        return meetings.get(actor, m.id);
      });
    },
    remove(actor, id) {
      const m = mrow(actor, id, 'proj.meeting.delete'); if (m.status !== 'DRAFT' || m.workflow_instance_id || m.supersedes_id) throw unprocessable('Only a draft that was never sent is deleted; cancel any other.');
      return transaction(db, () => { const now = nowIso(); db.prepare('UPDATE proj_meeting_actions SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE meeting_id = ? AND deleted_at IS NULL').run(now, actor.user, m.id); db.prepare('UPDATE proj_meetings SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, actor.user, m.id); writeAudit(db, { entity: 'proj_meetings', entityId: m.id, action: 'delete', actor: actor.user, companyId: m.company_id }); return { id: m.id, deleted: true }; });
    },
    /** BR-02: the minute-taker sends the minutes; the chair approves and the minutes are issued. */
    submit(actor, id) {
      const m = mrow(actor, id, 'proj.meeting.submit'); if (!editable(m)) throw lockedMsg(m);
      if (!same(m.minute_taker, actor.user)) throw forbidden('Only the minute-taker sends the minutes to the chair.');
      const p = []; const att = json(m.attendees_json, []).filter((a) => a.present !== false); if (!att.length) p.push({ field: 'attendees', message: 'Record who attended' });
      if (!String(m.minutes ?? '').trim() || m.minutes.trim().length < 10) p.push({ field: 'minutes', message: 'Write the minutes' });
      fail(p);
      return transaction(db, () => {
        const ctx = { projectId: m.org_project_id };
        if (m.status === 'RETURNED') workflowOf(db).resubmit(actor, m.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: MEETING_DOC, docId: String(m.id), comment: `${orgOf(m.org_project_id).code} ${m.title}`, context: ctx }); db.prepare('UPDATE proj_meetings SET workflow_instance_id = ? WHERE id = ?').run(inst.id, m.id); }
        db.prepare("UPDATE proj_meetings SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), m.id);
        writeAudit(db, { entity: 'proj_meetings', entityId: m.id, action: 'submit', actor: actor.user, companyId: m.company_id });
        return meetings.get(actor, m.id);
      });
    },
    withdraw(actor, id, { reason }) { const m = mrow(actor, id); if (m.status !== 'SUBMITTED') throw unprocessable('Only minutes waiting for the chair are withdrawn.'); if (!same(m.requested_by, actor.user)) throw forbidden('Only the person who sent them withdraws them.'); workflowOf(db).withdraw(actor, m.workflow_instance_id, { comment: reason }); return meetings.get(actor, m.id); },
    cancel(actor, id, { reason }) {
      const m = mrow(actor, id, 'proj.meeting.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(m.status)) throw unprocessable('Only a meeting whose minutes are not issued is cancelled.');
      return transaction(db, () => { if (m.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, m.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE proj_meetings SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), m.id); writeAudit(db, { entity: 'proj_meetings', entityId: m.id, action: 'cancel', reason, actor: actor.user, companyId: m.company_id }); return meetings.get(actor, m.id); });
    },
    /** BR-02: issued minutes are corrected by a revision: a new draft with the same number, the next revision and the content and actions of the issued one. */
    revise(actor, id, { reason }) {
      const m = mrow(actor, id, 'proj.meeting.amend'); if (m.status !== 'APPROVED') throw unprocessable('Only issued minutes are revised.');
      if (db.prepare("SELECT 1 FROM proj_meetings WHERE supersedes_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(m.id)) throw conflict('A revision of these minutes is open already.');
      return transaction(db, () => {
        const nid = Number(db.prepare("INSERT INTO proj_meetings (company_id, doc_no, rev_no, supersedes_id, org_project_id, mtype, title, meeting_date, start_time, location, chair_user, minute_taker, attendees_json, agenda_json, minutes, decisions_json, revision_reason, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proj_meetings', ?)").run(m.company_id, m.doc_no, m.rev_no + 1, m.id, m.org_project_id, m.mtype, m.title, m.meeting_date, m.start_time, m.location, m.chair_user, m.minute_taker, m.attendees_json, m.agenda_json, m.minutes, m.decisions_json, reason, m.org_project_id, actor.user, String(m.id)).lastInsertRowid);
        for (const a of db.prepare('SELECT * FROM proj_meeting_actions WHERE meeting_id = ? AND deleted_at IS NULL ORDER BY action_no').all(m.id)) db.prepare("INSERT INTO proj_meeting_actions (company_id, meeting_id, org_project_id, action_no, description, owner_user, due_date, priority, task_id, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proj_meeting_actions', ?)").run(a.company_id, nid, a.org_project_id, a.action_no, a.description, a.owner_user, a.due_date, a.priority, a.task_id, a.org_project_id, actor.user, String(a.id));
        writeAudit(db, { entity: 'proj_meetings', entityId: nid, action: 'revise', reason, newValues: { from: m.id }, actor: actor.user, companyId: m.company_id });
        return meetings.get(actor, nid);
      });
    },
    history(actor, id) {
      const m = mrow(actor, id);
      return { approvals: m.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(m.workflow_instance_id) : [], audit: db.prepare('SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = ? AND entity_id = ? ORDER BY id').all('proj_meetings', String(m.id)),
        revisions: db.prepare('SELECT id, rev_no, status, issued_at, revision_reason FROM proj_meetings WHERE company_id = ? AND doc_no = ? AND deleted_at IS NULL ORDER BY rev_no').all(m.company_id, m.doc_no).map((r) => ({ id: r.id, revNo: r.rev_no, status: r.status, statusLabel: MEETING_STATUS[r.status], issuedAt: r.issued_at, reason: r.revision_reason })) };
    },
    /** The minutes as a document: the details, the attendees, the agenda, the minutes, the decisions and the actions. */
    document(actor, id, format = 'html') {
      const m = mrow(actor, id, ['xlsx', 'csv'].includes(format) ? 'proj.meeting.export' : 'proj.meeting.print'); const v = view(actor, m, { detail: true });
      writeAudit(db, { entity: 'proj_meetings', entityId: m.id, action: ['xlsx', 'csv'].includes(format) ? 'export' : 'print', newValues: { format }, actor: actor.user, companyId: m.company_id });
      const rows = [
        { section: 'Meeting', item: v.title, detail: `${v.typeLabel} · ${v.meetingDate}${v.startTime ? ` ${v.startTime}` : ''}${v.location ? ` · ${v.location}` : ''}` }, { section: 'Meeting', item: 'Chair', detail: v.chairUser }, { section: 'Meeting', item: 'Minute-taker', detail: v.minuteTaker },
        ...v.attendees.map((a) => ({ section: 'Attendees', item: a.name, detail: `${a.kind === 'INTERNAL' ? 'Internal' : 'External'}${a.organisation ? ` · ${a.organisation}` : ''} · ${a.present === false ? 'absent' : 'present'}` })),
        ...v.agenda.map((a, i) => ({ section: 'Agenda', item: `${i + 1}. ${a.title}`, detail: a.notes ?? '' })), { section: 'Minutes', item: '', detail: v.minutes ?? '' },
        ...v.decisions.map((d, i) => ({ section: 'Decisions', item: `D${i + 1}`, detail: d.text })), ...v.actions.map((a) => ({ section: 'Actions', item: `A${a.no} · ${a.ownerUser} · due ${a.dueDate}`, detail: `${a.description} [${a.statusLabel}]` })),
      ];
      const title = `Minutes of meeting ${v.ref} · ${v.projectCode} · ${v.statusLabel}${v.issuedAt ? ` (${v.issuedAt.slice(0, 10)})` : ' (draft)'}`;
      if (format === 'html') { const sections = [...new Set(rows.map((r) => r.section))]; return { kind: 'html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.ref)}</title><style>body{font:13px sans-serif;margin:24px}td,th{border:1px solid #888;padding:4px 6px;text-align:left;vertical-align:top}table{border-collapse:collapse;width:100%;margin-bottom:12px}</style></head><body><h1>${esc(title)}</h1>${sections.map((s) => `<h2>${esc(s)}</h2><table>${rows.filter((r) => r.section === s).map((r) => `<tr><th style="width:30%">${esc(r.item)}</th><td>${esc(r.detail)}</td></tr>`).join('')}</table>`).join('')}</body></html>` }; }
      return { kind: 'file', buffer: writeExport(format, { columns: [{ key: 'section', label: 'Section', type: 'text' }, { key: 'item', label: 'Item', type: 'text' }, { key: 'detail', label: 'Detail', type: 'text' }], rows, footer: [v.status === 'APPROVED' ? `Issued ${v.issuedAt?.slice(0, 10)} by ${v.issuedBy}` : 'Not issued'], title, sheetName: 'Minutes' }), contentType: FORMATS[format], fileName: `minutes-${v.docNo}-rev${v.revNo}.${format}` };
    },
    /** BR-02: the chair's approval issues the minutes: they are locked, the earlier revision is superseded, the actions become tasks and the attendees are told. */
    decide(instance, actor, outcome, comment) {
      const m = fresh(rid(instance.docId)); if (!m || m.status !== 'SUBMITTED') return;
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
      const to = outcome === 'APPROVED' ? 'APPROVED' : outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE proj_meetings SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, actor.user, nowIso(), m.id);
      if (withdrawn) db.prepare('UPDATE proj_meetings SET workflow_instance_id = NULL WHERE id = ?').run(m.id);
      writeAudit(db, { entity: 'proj_meetings', entityId: m.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: m.company_id });
      if (to !== 'APPROVED') return;
      const now = nowIso(); const o = orgOf(m.org_project_id); const acts = db.prepare('SELECT * FROM proj_meeting_actions WHERE meeting_id = ? AND deleted_at IS NULL ORDER BY action_no').all(m.id);
      // the actions of the revision that were removed or changed: their tasks are cancelled
      if (m.supersedes_id) { const keep = new Set(acts.map((a) => a.task_id).filter(Boolean)); for (const a of db.prepare('SELECT * FROM proj_meeting_actions WHERE meeting_id = ?').all(m.supersedes_id)) if (a.task_id && !keep.has(a.task_id)) { try { tasksOf(db).act(actor.user, a.task_id, 'cancel', { reason: `Minutes ${m.doc_no} were revised` }); } catch { /* a task closed elsewhere stays as it is */ } } db.prepare("UPDATE proj_meetings SET status = 'SUPERSEDED', updated_at = ?, version = version + 1 WHERE id = ?").run(now, m.supersedes_id); }
      let made = 0;
      for (const a of acts) {
        if (a.task_id) continue;
        const task = tasksOf(db).create({ companyId: m.company_id, title: `${m.doc_no}: ${a.description}`.slice(0, 160), description: `Action ${a.action_no} of the meeting "${m.title}" of ${m.meeting_date} (${o.code}).`, entity: 'proj_meeting', entityId: m.id, entityLabel: m.doc_no, projectId: m.org_project_id, priority: a.priority, dueDate: a.due_date, assignees: [a.owner_user], origin: 'auto', assigner: m.chair_user, actor: actor.user, source: { type: 'proj_meeting_action', id: `${m.id}:${a.id}` } });
        db.prepare('UPDATE proj_meeting_actions SET task_id = ? WHERE id = ?').run(task?.id ?? null, a.id); made += 1;
      }
      const att = json(m.attendees_json, []); const internal = [...new Set([...att.filter((a) => a.kind === 'INTERNAL' && a.user && a.present !== false).map((a) => a.user), m.chair_user, m.minute_taker, ...acts.map((a) => a.owner_user)])];
      const external = att.filter((a) => a.kind === 'EXTERNAL').map((a) => { const s = a.stakeholderId ? db.prepare('SELECT email FROM proj_stakeholders WHERE id = ?').get(a.stakeholderId) : null; return { name: a.name, organisation: a.organisation ?? null, email: s?.email ?? null }; });
      db.prepare('UPDATE proj_meetings SET issued_at = ?, issued_by = ?, distribution_json = ? WHERE id = ?').run(now, actor.user, JSON.stringify({ internal, external, sentAt: now }), m.id);
      try { notificationsOf(db).notify({ companyId: m.company_id, templateCode: 'proj.mom.issued', recipients: internal.map((u) => `user:${u}`), data: { docRef: `${m.doc_no}${m.rev_no ? ` rev ${m.rev_no}` : ''}`, title: m.title, date: m.meeting_date, actor: actor.user, actions: String(acts.length), link: `/proj/meeting?id=${m.id}` }, link: `/proj/meeting?id=${m.id}`, sourceType: 'proj_meeting', sourceId: m.id }); } catch { /* the minutes stay issued; the notice is a convenience */ }
      event('proj.meeting.issued', actor, 'meeting', m.id, m.company_id, m.org_project_id, { projectId: m.org_project_id, code: o.code, meetingId: m.id, docNo: m.doc_no, revNo: m.rev_no, title: m.title, meetingDate: m.meeting_date, decisions: json(m.decisions_json, []).length, actions: acts.length, tasksMade: made, attendees: internal, external: external.length });
    },
  };

  // ---- the action items (FR-05) -----------------------------------------------------------------------------------------------------------------------------
  const arow = (actor, id) => { const a = db.prepare('SELECT * FROM proj_meeting_actions WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!a || !may(actor, 'proj.meeting.view', a.org_project_id)) throw notFound('That action does not exist.'); return a; };
  const actions = {
    list(actor, query) { need(actor, 'proj.meeting.view', 'see actions'); const s = scopeSql(actor, 'a', 'a.org_project_id'); return runList(db, actionList, parseListRequest(actionList, query), { select: 'a.*, x.doc_no, x.title AS meeting_title, k.status AS task_status, k.task_no', scopeSql: s.sql, params: s.params, tieBreaker: 'a.id', map: (a) => { const v = aview(a, actor); return { ...v, actionNo: v.no, owner: v.ownerUser, overdue: v.overdue ? 1 : 0, meeting: a.doc_no, title: a.meeting_title, projectId: a.org_project_id, project: orgOf(a.org_project_id)?.code }; } }); },
    /** The tracker's figures: open, in progress, blocked, done and overdue actions of a project (or of all the person may see). */
    summary(actor, { projectId, mine = false } = /** @type {any} */ ({})) {
      need(actor, 'proj.meeting.view', 'see actions'); const s = scopeSql(actor, 'a', 'a.org_project_id'); const w = [s.sql, "a.deleted_at IS NULL AND x.deleted_at IS NULL AND x.status = 'APPROVED'"]; const params = { ...s.params };
      if (projectId) { w.push('a.org_project_id = :p'); params.p = projectId; } if (mine) { w.push('lower(a.owner_user) = lower(:u)'); params.u = actor.user; }
      const rows = db.prepare(`SELECT ${STATUS_SQL} AS st, a.due_date AS due FROM proj_meeting_actions a JOIN proj_meetings x ON x.id = a.meeting_id LEFT JOIN tsk_tasks k ON k.id = a.task_id WHERE ${w.join(' AND ')}`).all(params); const today = todayIST();
      return { total: rows.length, open: rows.filter((r) => r.st === 'OPEN').length, inProgress: rows.filter((r) => r.st === 'IN_PROGRESS').length, blocked: rows.filter((r) => r.st === 'BLOCKED').length, done: rows.filter((r) => r.st === 'DONE').length, overdue: rows.filter((r) => ['OPEN', 'IN_PROGRESS', 'BLOCKED'].includes(r.st) && r.due < today).length };
    },
    /** An owner updates their own action (the manager of meetings any): the status moves the task of the task service. */
    update(actor, id, { status, note }) {
      const a = arow(actor, id); const x = fresh(a.meeting_id); if (x.status !== 'APPROVED' || !a.task_id) throw unprocessable('The action is tracked once the minutes are issued.');
      if (same(a.owner_user, actor.user)) need(actor, 'proj.action.update', 'update your actions', a.org_project_id); else need(actor, 'proj.meeting.approve', 'update the actions of others', a.org_project_id);
      return transaction(db, () => {
        const t = db.prepare('SELECT status FROM tsk_tasks WHERE id = ?').get(a.task_id); const tasks = tasksOf(db); const who = actor.user;
        if (['DONE', 'VERIFIED', 'CLOSED', 'CANCELLED'].includes(t.status)) throw new HttpError(409, 'ACTION_CLOSED', 'This action is done or cancelled.');
        if (status === 'IN_PROGRESS') { if (t.status === 'BLOCKED') tasks.act(who, a.task_id, 'unblock'); else if (['OPEN', 'ACCEPTED'].includes(t.status)) tasks.act(who, a.task_id, 'start'); }
        else if (status === 'BLOCKED') tasks.act(who, a.task_id, 'block', { reason: note ?? '' });
        else if (status === 'DONE') { if (t.status === 'OPEN') tasks.act(who, a.task_id, 'start'); tasks.act(who, a.task_id, 'complete'); }
        db.prepare('UPDATE proj_meeting_actions SET action_status = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(status, actor.user, nowIso(), a.id);
        writeAudit(db, { entity: 'proj_meeting_actions', entityId: a.id, action: 'status', newValues: { status }, reason: note ?? undefined, actor: actor.user, companyId: a.company_id });
        event('proj.action.updated', actor, 'meeting_action', a.id, a.company_id, a.org_project_id, { projectId: a.org_project_id, meetingId: a.meeting_id, actionId: a.id, owner: a.owner_user, status });
        return aview({ ...db.prepare('SELECT * FROM proj_meeting_actions WHERE id = ?').get(a.id), ...db.prepare('SELECT status AS task_status, task_no FROM tsk_tasks WHERE id = ?').get(a.task_id) }, actor);
      });
    },
  };
  return { meetings, actions, decide: meetings.decide };
}

const services = new WeakMap();
export const bindMeetings = (db, s) => services.set(db, s);
export const meetingsOf = (db) => services.get(db) ?? null;

/** The chair approves the minutes (the project manager when the chair is also the sender). */
if (!workflowResolvers.get('proj.chair')) workflowResolvers.register('proj.chair', ({ db, instance }) => {
  const m = db.prepare('SELECT chair_user FROM proj_meetings WHERE id = ?').get(rid(instance.docId));
  return m && !same(m.chair_user, instance.submittedBy) ? [{ user: m.chair_user }] : [{ role: 'PM' }];
});
const mline = (db, id) => db.prepare('SELECT x.*, p.code, p.name AS pname FROM proj_meetings x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: MEETING_DOC, label: 'Minutes of meeting issue', processOwner: 'PM', route: (id) => `/proj/meeting?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT x.doc_no, x.rev_no, x.title, x.requested_by, p.code FROM proj_meetings x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ? AND x.company_id = ?').get(rid(id), companyId); return r ? { ref: `${r.doc_no}${r.rev_no ? ` rev ${r.rev_no}` : ''}`, title: `${r.code} ${r.title}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = mline(db, rid(id)); if (!r) return null; return { fields: [{ label: 'Project', value: `${r.code} ${r.pname}` }, { label: 'Meeting', value: `${r.title} · ${MTYPES[r.mtype]} · ${r.meeting_date}` }, { label: 'Chair', value: r.chair_user }, { label: 'Minute-taker', value: r.minute_taker }, ...(r.revision_reason ? [{ label: 'Why revised', value: r.revision_reason }] : [])] }; },
  defaultDefinition: { name: 'Minutes issue: the chair approves the minute-taker\'s minutes', settings: { resubmit: 'first', distinctApprovers: true }, steps: [{ code: 'CHAIR', name: 'Chair of the meeting', type: 'approval', mode: 'single', approvers: [{ kind: 'resolver', resolver: 'proj.chair' }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null }] },
  hooks: { onApproved: (db, { instance, actor }) => meetingsOf(db)?.decide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => meetingsOf(db)?.decide(instance, actor, 'REJECTED', comment), onReturned: (db, { instance, actor, comment }) => meetingsOf(db)?.decide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => meetingsOf(db)?.decide(instance, actor, 'CANCELLED', comment) },
});
evidenceProviders.register(MEETING_DOC, ({ db, instance }) => {
  const m = mline(db, rid(instance.docId)); if (!m) return { sections: [] };
  const att = json(m.attendees_json, []); const n = db.prepare('SELECT COUNT(*) AS n FROM proj_meeting_actions WHERE meeting_id = ? AND deleted_at IS NULL').get(m.id).n;
  return { sections: [{ code: 'proj-meeting', title: 'Before issuing the minutes', kind: 'metrics', items: [{ label: 'Meeting', value: `${m.title} (${m.meeting_date})`, format: 'text' }, { label: 'Attendees present', value: String(att.filter((a) => a.present !== false).length), format: 'text' }, { label: 'Decisions', value: String(json(m.decisions_json, []).length), format: 'text' }, { label: 'Actions that become tasks', value: String(n), format: 'text' }, { label: 'Revision', value: String(m.rev_no), format: 'text' }] }] };
});
