import { inTransaction as transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { ROLE_TEMPLATES, authzOf } from '../../platform/authz/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { forbidden, badRequest, conflict, notFound, unprocessable } from '../../platform/http/errors.js';
import { workflowTypes } from '../../platform/workflow/index.js';
import { ENDED, FINISHED, tasksOf } from '../../platform/tasks/index.js';
import { createPathService } from './controls.js';

// The module side of task management (part 04.08): who may see and do what with a task, the lists and the team dashboard, instructions from seniors, the department responsibility matrix (a change is
// approved by someone else), the sweep that reminds, escalates and repeats. The state rules and the routing are platform/tasks.
export const ROUTING_DOC = 'TSK_ROUTING';
const ROLE_CODES = new Set(ROLE_TEMPLATES.map((r) => r.code));
const iso = () => new Date().toISOString();
const step = { code: 'CHECK', name: 'System administrator or director', type: 'approval', mode: 'single', approvers: [{ kind: 'role', role: 'SYSADM|DIR' }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null };
const OPEN_SQL = "t.status NOT IN ('DONE', 'VERIFIED', 'CLOSED', 'CANCELLED')";
const PRIORITY_ORDER = "CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END";

// ---- the approval of a change of the responsibility matrix ----
function activate(db, batch, actor) {
  const rows = db.prepare("SELECT * FROM tsk_routing_matrix WHERE batch_id = ? AND status = 'PENDING'").all(batch);
  for (const r of rows) {
    db.prepare("UPDATE tsk_routing_matrix SET status = 'RETIRED', effective_to = CASE WHEN effective_to IS NULL OR effective_to >= ? THEN ? ELSE effective_to END, updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND topic_code = ? AND status = 'ACTIVE'").run(r.effective_from, r.effective_from, actor.user, iso(), r.company_id, r.topic_code);
    db.prepare("UPDATE tsk_routing_matrix SET status = 'ACTIVE', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), r.id);
  }
  if (rows[0]) writeAudit(db, { entity: 'tsk_routing_matrix', entityId: batch, action: 'activate', newValues: { topics: rows.map((r) => r.topic_code) }, actor: actor.user, companyId: rows[0].company_id });
}
const reject = (db, batch, actor) => db.prepare("UPDATE tsk_routing_matrix SET status = 'REJECTED', updated_by = ?, updated_at = ?, version = version + 1 WHERE batch_id = ? AND status = 'PENDING'").run(actor.user, iso(), batch);
workflowTypes.register({
  docType: ROUTING_DOC,
  label: 'Department responsibility matrix change',
  processOwner: 'SYSADM',
  route: () => '/admin/task-routing',
  describe(db, companyId, id) {
    const r = db.prepare('SELECT * FROM tsk_routing_matrix WHERE batch_id = ? AND company_id = ? LIMIT 1').get(Number(id), companyId);
    return r ? { ref: `Responsibility matrix #${id}`, title: 'Change of the department responsibility matrix', originator: r.created_by } : null;
  },
  summarise(db, actor, id) {
    const rows = db.prepare('SELECT m.*, d.name AS department FROM tsk_routing_matrix m JOIN org_departments d ON d.id = m.department_id WHERE m.batch_id = ? ORDER BY m.topic_code').all(Number(id));
    if (!rows.length) return null;
    return {
      fields: [{ label: 'Topics changed', value: rows.length }, { label: 'Reason', value: rows[0].reason ?? '' }],
      lines: { columns: [{ key: 'topic', label: 'Topic' }, { key: 'department', label: 'Department' }, { key: 'role', label: 'Role' }, { key: 'from', label: 'From' }], rows: rows.map((r) => ({ topic: `${r.topic_code} ${r.topic_name}`, department: r.department, role: r.role_code, from: r.effective_from })) },
    };
  },
  defaultDefinition: { name: 'Responsibility matrix approval', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step] },
  hooks: {
    onApproved: (db, { instance, actor }) => activate(db, Number(instance.docId), actor),
    onRejected: (db, { instance, actor }) => reject(db, Number(instance.docId), actor),
    onReturned: (db, { instance, actor }) => reject(db, Number(instance.docId), actor),
    onCancelled: (db, { instance, actor }) => reject(db, Number(instance.docId), actor),
  },
});

/** Named parameters the statement does not use are an error in node:sqlite; this passes only the ones it names. */
const only = (sql, p) => Object.fromEntries(Object.entries(p).filter(([k]) => new RegExp(`:${k}\\b`).test(sql)));
export function createTaskService({ db, engine }) {
  const authz = authzOf(db);
  const core = tasksOf(db);
  const paths = createPathService({ db, engine });
  const may = (actor, key, scope) => authz.check(actor, key, scope ?? { companyId: actor.companyId }).allowed;
  const need = (actor, key, what, scope) => { if (!may(actor, key, scope)) throw forbidden(`You may not ${what} (permission ${key}).`); };

  // ---- seeing a task ----
  const teamSql = (actor) => authz.scopeFilter(actor, 'tsk.team.view', { project: 't.project_id', site: 't.site_id' }).sql;
  const visibleSql = (actor, p) => {
    p.me = actor.user;
    return `(t.assigner = :me OR t.created_by = :me OR EXISTS (SELECT 1 FROM tsk_assignees a WHERE a.task_id = t.id AND a.user_ref = :me AND a.is_active = 1) OR ${teamSql(actor)})`;
  };
  const load = (actor, id) => {
    const p = {};
    const t = db.prepare(`SELECT t.* FROM tsk_tasks t WHERE t.id = :id AND t.company_id = :c AND t.is_active = 1 AND ${visibleSql(actor, p)}`).get({ id, c: actor.companyId, ...p });
    if (!t) throw notFound('That task does not exist.');
    return t;
  };
  const delegatedBy = (t, actor) => Boolean(db.prepare("SELECT 1 FROM wf_delegations WHERE company_id = ? AND delegator = ? AND delegate = ? AND status = 'ACTIVE' AND from_date <= ? AND to_date >= ?").get(t.company_id, t.assigner, actor.user, core.today(), core.today()));
  const rel = (t, actor) => {
    const people = core.assigneesOf(t.id);
    return {
      assignee: people.some((a) => a.user_ref === actor.user),
      watcher: core.assigneesOf(t.id, 'WATCHER').some((a) => a.user_ref === actor.user),
      assigner: t.assigner === actor.user,
      delegate: t.assigner !== actor.user && delegatedBy(t, actor),
      team: may(actor, 'tsk.team.view', { companyId: actor.companyId, projectId: t.project_id, siteId: t.site_id }),
      manager: may(actor, 'tsk.task.assign', { companyId: actor.companyId, projectId: t.project_id, siteId: t.site_id }),
    };
  };
  const todayStr = () => core.today();
  const present = (t, actor, full = false) => {
    const r = rel(t, actor);
    const people = core.assigneesOf(t.id);
    const watchers = core.assigneesOf(t.id, 'WATCHER');
    const done = FINISHED.includes(t.status) || ENDED.includes(t.status);
    const overdue = !done && t.due_date && t.due_date < todayStr();
    const out = {
      id: t.id, taskNo: t.task_no, title: t.title, status: t.status, priority: t.priority, dueDate: t.due_date, startDate: t.start_date, overdue: Boolean(overdue),
      daysLate: overdue ? Math.round((Date.parse(todayStr()) - Date.parse(t.due_date)) / 86_400_000) : 0,
      entity: t.entity, entityId: t.entity_id, entityLabel: t.entity_label, projectId: t.project_id, siteId: t.site_id, departmentId: t.department_id, topicCode: t.topic_code, origin: t.origin,
      assigner: t.assigner, assignees: people.map((a) => ({ user: a.user_ref, acceptedAt: a.accepted_at })), watchers: watchers.map((a) => a.user_ref),
      requiresAcceptance: t.requires_acceptance === 1, requiresEvidence: t.requires_evidence === 1, requiresVerification: t.requires_verification === 1,
      escalationLevel: t.escalation_level, blockedReason: t.blocked_reason, recurrence: t.recurrence_rule ? JSON.parse(t.recurrence_rule) : null, seriesId: t.series_id,
      createdAt: t.created_at, version: t.version, completedAt: t.completed_at, verifiedBy: t.verified_by, verifiedAt: t.verified_at, closedAt: t.closed_at,
      checklist: db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(done), 0) AS done FROM tsk_checklist_items WHERE task_id = ? AND is_active = 1').get(t.id),
    };
    if (!full) return out;
    const evidenceIds = db.prepare("SELECT id FROM core_files WHERE linked_entity = 'tsk_task' AND linked_id = ? AND is_active = 1 AND deleted_at IS NULL AND scan_status != 'INFECTED' ORDER BY id").all(String(t.id)).map((x) => x.id);
    const cant = (action) => {
      const s = t.status;
      const doer = r.assignee || r.assigner || r.delegate;
      switch (action) {
        case 'accept': return s === 'OPEN' && r.assignee;
        case 'start': return ['OPEN', 'ACCEPTED'].includes(s) && doer && !(s === 'OPEN' && t.requires_acceptance);
        case 'block': return ['OPEN', 'ACCEPTED', 'IN_PROGRESS'].includes(s) && doer;
        case 'unblock': return s === 'BLOCKED' && doer;
        case 'complete': return ['OPEN', 'ACCEPTED', 'IN_PROGRESS', 'BLOCKED'].includes(s) && doer && !(s === 'OPEN' && t.requires_acceptance);
        case 'verify': return s === 'DONE' && t.requires_verification === 1 && (r.assigner || r.delegate) && !r.assignee;
        case 'close': return ((s === 'DONE' && !t.requires_verification) || s === 'VERIFIED') && (r.assigner || r.delegate || r.assignee);
        case 'reopen': return ['DONE', 'VERIFIED', 'CLOSED'].includes(s) && (r.assigner || r.delegate);
        case 'cancel': return !ENDED.includes(s) && !FINISHED.includes(s) && (r.assigner || r.delegate);
        default: return false;
      }
    };
    return {
      ...out, description: t.description, routing: t.routing_json ? JSON.parse(t.routing_json) : null, evidenceFileIds: evidenceIds,
      checklistItems: db.prepare('SELECT id, text, done, done_by, done_at, position FROM tsk_checklist_items WHERE task_id = ? AND is_active = 1 ORDER BY position, id').all(t.id).map((c) => ({ id: c.id, text: c.text, done: c.done === 1, doneBy: c.done_by, doneAt: c.done_at })),
      dependencies: core.dependencyState(t.id).map((d) => ({ id: d.id, taskNo: d.task_no, title: d.title, status: d.status })),
      dependents: db.prepare("SELECT t2.id, t2.task_no, t2.title, t2.status FROM tsk_dependencies d JOIN tsk_tasks t2 ON t2.id = d.task_id WHERE d.depends_on_task_id = ? AND d.is_active = 1 AND t2.is_active = 1").all(t.id).map((d) => ({ id: d.id, taskNo: d.task_no, title: d.title, status: d.status })),
      comments: db.prepare('SELECT id, body, author_ref, created_at FROM tsk_comments WHERE task_id = ? AND is_active = 1 ORDER BY id').all(t.id).map((c) => ({ id: c.id, body: c.body, by: c.author_ref, at: c.created_at })),
      escalations: db.prepare('SELECT level, to_role, to_user, days_late, at FROM tsk_escalations WHERE task_id = ? ORDER BY id').all(t.id).map((e) => ({ level: e.level, toRole: e.to_role, toUser: e.to_user, daysLate: e.days_late, at: e.at })),
      history: db.prepare("SELECT action, old_values, new_values, reason, actor, created_at FROM core_audit_log WHERE entity = 'tsk_tasks' AND entity_id = ? ORDER BY id").all(String(t.id)).map((h) => ({ action: h.action, from: h.old_values ? JSON.parse(h.old_values) : null, to: h.new_values ? JSON.parse(h.new_values) : null, reason: h.reason, by: h.actor, at: h.created_at })),
      relation: { assignee: r.assignee, assigner: r.assigner, delegate: r.delegate, watcher: r.watcher, team: r.team },
      allowed: Object.fromEntries(['accept', 'start', 'block', 'unblock', 'complete', 'verify', 'close', 'reopen', 'cancel'].map((a) => [a, Boolean(cant(a))])),
      canEdit: (r.assigner || r.manager) && !ENDED.includes(t.status) && !FINISHED.includes(t.status), canComment: true,
      warnings: ['OPEN', 'ACCEPTED'].includes(t.status) ? core.unmet(t.id).map((d) => `${d.task_no} is not done yet.`) : [],
    };
  };

  // ---- the lists ----
  const filters = (actor, q, p) => {
    const where = ['t.company_id = :c', 't.is_active = 1', visibleSql(actor, p)];
    p.c = actor.companyId;
    const view = q.view ?? 'assigned';
    if (view === 'assigned') where.push("EXISTS (SELECT 1 FROM tsk_assignees a WHERE a.task_id = t.id AND a.user_ref = :me AND a.role = 'ASSIGNEE' AND a.is_active = 1)");
    else if (view === 'watching') where.push("EXISTS (SELECT 1 FROM tsk_assignees a WHERE a.task_id = t.id AND a.user_ref = :me AND a.role = 'WATCHER' AND a.is_active = 1)");
    else if (view === 'created') where.push('t.assigner = :me');
    else if (view === 'team') { if (!may(actor, 'tsk.team.view')) throw forbidden('You may not see the tasks of your team (permission tsk.team.view).'); where.push(teamSql(actor)); }
    if (q.status === 'open') where.push(OPEN_SQL);
    else if (q.status === 'finished') where.push("t.status IN ('DONE', 'VERIFIED', 'CLOSED')");
    else if (q.status) { where.push('t.status = :status'); p.status = q.status; }
    for (const [k, col] of [['priority', 'priority'], ['projectId', 'project_id'], ['departmentId', 'department_id'], ['entity', 'entity'], ['entityId', 'entity_id'], ['origin', 'origin'], ['topicCode', 'topic_code']]) if (q[k] !== undefined && q[k] !== '') { where.push(`t.${col} = :${k}`); p[k] = q[k]; }
    if (q.assignee) { where.push("EXISTS (SELECT 1 FROM tsk_assignees a2 WHERE a2.task_id = t.id AND a2.user_ref = :assignee AND a2.role = 'ASSIGNEE' AND a2.is_active = 1)"); p.assignee = q.assignee; }
    if (q.overdue) { where.push(`${OPEN_SQL} AND t.due_date < :today`); p.today = todayStr(); }
    if (q.from) { where.push('t.due_date >= :from'); p.from = q.from; }
    if (q.to) { where.push('t.due_date <= :to'); p.to = q.to; }
    if (q.q) { where.push('(t.title LIKE :q OR t.task_no LIKE :q OR t.entity_label LIKE :q OR t.description LIKE :q)'); p.q = `%${q.q}%`; }
    return where.join(' AND ');
  };
  const tasks = {
    list(actor, q = {}) {
      const p = {};
      const where = filters(actor, q, p);
      const order = q.sort === 'newest' ? 't.id DESC' : q.sort === 'priority' ? `${PRIORITY_ORDER}, t.due_date IS NULL, t.due_date, t.id` : 't.due_date IS NULL, t.due_date, t.id';
      const total = db.prepare(`SELECT COUNT(*) AS n FROM tsk_tasks t WHERE ${where}`).get(p).n;
      const rows = db.prepare(`SELECT t.* FROM tsk_tasks t WHERE ${where} ORDER BY ${order} LIMIT :limit OFFSET :offset`).all({ ...p, limit: q.limit ?? 25, offset: q.offset ?? 0 }).map((t) => present(t, actor));
      return { rows, total };
    },
    counts(actor) {
      const p = {};
      const mine = `t.company_id = :c AND t.is_active = 1 AND EXISTS (SELECT 1 FROM tsk_assignees a WHERE a.task_id = t.id AND a.user_ref = :me AND a.role = 'ASSIGNEE' AND a.is_active = 1) AND ${OPEN_SQL}`;
      p.c = actor.companyId; p.me = actor.user; p.today = todayStr();
      const n = (extra = '') => { const sql = `SELECT COUNT(*) AS n FROM tsk_tasks t WHERE ${mine} ${extra}`; return db.prepare(sql).get(only(sql, p)).n; };
      return { open: n(), overdue: n('AND t.due_date < :today'), dueToday: n('AND t.due_date = :today'), toAccept: n("AND t.status = 'OPEN' AND t.requires_acceptance = 1"), toVerify: db.prepare("SELECT COUNT(*) AS n FROM tsk_tasks t WHERE t.company_id = :c AND t.is_active = 1 AND t.status = 'DONE' AND t.requires_verification = 1 AND t.assigner = :me").get({ c: p.c, me: p.me }).n };
    },
    get(actor, id) { return present(load(actor, id), actor, true); },
    create(actor, b) {
      const assigneesOther = (b.assignees ?? []).some((u) => u !== actor.user);
      if (assigneesOther) need(actor, 'tsk.task.assign', 'give a task to someone else', { companyId: actor.companyId, projectId: b.projectId ?? null });
      if (b.projectId && !may(actor, 'org.view', { companyId: actor.companyId, projectId: b.projectId })) throw forbidden('You have no access to that project.');
      const assignees = b.assignees?.length ? b.assignees : [actor.user];
      const r = core.create({ companyId: actor.companyId, ...b, assignees, origin: 'manual', assigner: actor.user, actor: actor.user, trusted: [actor.user], requiresAcceptance: assigneesOther && b.requiresAcceptance });
      return tasks.get(actor, r.id);
    },
    /** FR-03: a senior raises an instruction by topic; the matrix gives the department, role and person; acceptance is required. */
    instruct(actor, b) {
      need(actor, 'tsk.instruction.create', 'raise an instruction', { companyId: actor.companyId, projectId: b.projectId ?? null });
      const rt = core.route({ companyId: actor.companyId, topicCode: b.topicCode, projectId: b.projectId ?? null, siteId: b.siteId ?? null, departmentId: b.departmentId ?? null });
      if (!rt.employee) throw unprocessable(`${rt.failed ?? 'Nobody could be found to give the instruction to.'} Ask the head of the department or an administrator to complete the responsibility matrix, or give the task to a person by name.`);
      const topic = rt.topic;
      return transaction(db, () => {
        const due = b.dueDate ?? (topic ? new Date(Date.parse(todayStr()) + topic.defaultDueDays * 86_400_000).toISOString().slice(0, 10) : null);
        const r = core.create({
          companyId: actor.companyId, title: b.title, description: b.description, entity: b.entity, entityId: b.entityId, entityLabel: b.entityLabel, projectId: b.projectId, siteId: b.siteId, departmentId: rt.department?.id ?? b.departmentId, topicCode: b.topicCode,
          priority: b.priority ?? topic?.defaultPriority ?? 'MEDIUM', startDate: b.startDate, dueDate: due, assignees: [rt.employee], watchers: b.watchers ?? [], checklist: b.checklist, dependsOn: b.dependsOn,
          requiresEvidence: b.requiresEvidence ?? topic?.requiresEvidence, requiresVerification: b.requiresVerification ?? topic?.requiresVerification, requiresAcceptance: true, origin: 'instruction', assigner: actor.user, actor: actor.user, trusted: [actor.user],
          routing: { via: rt.via, department: rt.department?.name ?? null, role: rt.role, employee: rt.employee, failed: rt.failed, trail: rt.trail }, source: { type: 'instruction', id: b.topicCode ?? 'free' },
        });
        if (rt.failed) writeAudit(db, { entity: 'tsk_tasks', entityId: r.id, action: 'routing_failed', newValues: { reason: rt.failed, sentTo: rt.employee, via: rt.via }, actor: actor.user, companyId: actor.companyId });
        return tasks.get(actor, r.id);
      });
    },
    routePreview(actor, q) {
      need(actor, 'tsk.instruction.create', 'raise an instruction', { companyId: actor.companyId });
      const rt = core.route({ companyId: actor.companyId, topicCode: q.topicCode, projectId: q.projectId ?? null, siteId: q.siteId ?? null, departmentId: q.departmentId ?? null });
      return { ...rt, employeeName: rt.employee ? core.userRow(actor.companyId, rt.employee)?.display_name ?? rt.employee : null };
    },
    update(actor, id, b) {
      const t = load(actor, id);
      const r = rel(t, actor);
      if (!(r.assigner || r.manager) || ENDED.includes(t.status) || FINISHED.includes(t.status)) throw forbidden('Only the person who gave the task (or a manager) changes it, and not once it is finished.');
      if (b.version !== undefined && b.version !== t.version) throw conflict('The task was changed by someone else. Refresh it and try again.');
      const problems = [];
      if (b.dueDate && b.startDate && b.dueDate < b.startDate) problems.push({ field: 'dueDate', message: 'The due date is before the start date.' });
      if (problems.length) throw badRequest('The task is not valid.', problems);
      return transaction(db, () => {
        const sets = [];
        const args = [];
        const old = {};
        for (const [k, col] of [['title', 'title'], ['description', 'description'], ['priority', 'priority'], ['dueDate', 'due_date'], ['startDate', 'start_date']]) if (b[k] !== undefined) { sets.push(`${col} = ?`); args.push(b[k]); old[k] = t[col]; }
        for (const [k, col] of [['requiresEvidence', 'requires_evidence'], ['requiresVerification', 'requires_verification']]) if (b[k] !== undefined) { sets.push(`${col} = ?`); args.push(b[k] ? 1 : 0); old[k] = t[col] === 1; }
        if (b.dueDate && b.dueDate >= todayStr()) { sets.push('escalation_level = 0'); }
        if (sets.length) {
          db.prepare(`UPDATE tsk_tasks SET ${sets.join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...args, actor.user, iso(), id);
          writeAudit(db, { entity: 'tsk_tasks', entityId: id, action: 'update', oldValues: old, newValues: Object.fromEntries(Object.keys(old).map((k) => [k, b[k]])), actor: actor.user, companyId: actor.companyId });
        }
        return tasks.get(actor, id);
      });
    },
    act(actor, id, action, { reason = null } = {}) {
      const t = load(actor, id);
      const r = rel(t, actor);
      const doer = r.assignee || r.assigner || r.delegate;
      const allowed = { accept: r.assignee, start: doer, block: doer, unblock: doer, complete: doer, verify: r.assigner || r.delegate, close: r.assigner || r.delegate || r.assignee, reopen: r.assigner || r.delegate, cancel: r.assigner || r.delegate }[action];
      if (!allowed) throw forbidden(action === 'verify' ? 'Only the person who gave the task, or someone they delegated to, verifies it.' : `You may not ${action} this task.`);
      const out = core.act(actor.user, id, action, { reason, by: { assigner: r.assigner || r.delegate, assignee: r.assignee } });
      return { ...tasks.get(actor, id), warnings: out.warnings };
    },
    comment(actor, id, body) {
      const t = load(actor, id);
      return transaction(db, () => {
        const res = db.prepare("INSERT INTO tsk_comments (company_id, task_id, body, author_ref, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'task')").run(actor.companyId, id, body.trim(), actor.user, actor.user);
        writeAudit(db, { entity: 'tsk_tasks', entityId: id, action: 'comment', newValues: { comment: Number(res.lastInsertRowid) }, actor: actor.user, companyId: actor.companyId });
        const others = [...core.assigneesOf(id), ...core.assigneesOf(id, 'WATCHER')].map((a) => a.user_ref).concat(t.assigner).filter((u) => u !== actor.user);
        core.tell(t, 'tsk.task.reopened', others, { actor: actor.user, reason: `commented: ${body.trim().slice(0, 120)}` }, `task:${id}:comment:${Number(res.lastInsertRowid)}`);
        return tasks.get(actor, id);
      });
    },
    checklist(actor, id, b) {
      const t = load(actor, id);
      const r = rel(t, actor);
      if (!(r.assignee || r.assigner || r.delegate || r.manager)) throw forbidden('Only the people on the task change its checklist.');
      if (ENDED.includes(t.status)) throw conflict('A cancelled or closed task cannot be changed.');
      return transaction(db, () => {
        if (b.add) db.prepare('INSERT INTO tsk_checklist_items (company_id, task_id, position, text, created_by, source_type) VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM tsk_checklist_items WHERE task_id = ?), ?, ?, \'task\')').run(actor.companyId, id, id, b.add.trim(), actor.user);
        if (b.toggle !== undefined) {
          const item = db.prepare('SELECT * FROM tsk_checklist_items WHERE id = ? AND task_id = ? AND is_active = 1').get(b.toggle.id, id);
          if (!item) throw notFound('That checklist item does not exist.');
          db.prepare('UPDATE tsk_checklist_items SET done = ?, done_by = ?, done_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.toggle.done ? 1 : 0, b.toggle.done ? actor.user : null, b.toggle.done ? iso() : null, actor.user, iso(), item.id);
        }
        if (b.remove !== undefined) db.prepare('UPDATE tsk_checklist_items SET is_active = 0, deleted_at = ?, deleted_by = ? WHERE id = ? AND task_id = ?').run(iso(), actor.user, b.remove, id);
        writeAudit(db, { entity: 'tsk_tasks', entityId: id, action: 'checklist', newValues: b, actor: actor.user, companyId: actor.companyId });
        return tasks.get(actor, id);
      });
    },
    depend(actor, id, b) {
      const t = load(actor, id);
      const r = rel(t, actor);
      if (!(r.assigner || r.manager)) throw forbidden('Only the person who gave the task (or a manager) changes its dependencies.');
      if (b.add !== undefined) { load(actor, b.add); core.addDependency(actor.user, id, b.add); }
      if (b.remove !== undefined) core.removeDependency(actor.user, id, b.remove);
      return tasks.get(actor, id);
    },
    people(actor, id, b) {
      const t = load(actor, id);
      const r = rel(t, actor);
      if (!(r.assigner || r.manager || r.delegate)) throw forbidden('Only the person who gave the task (or a manager) changes who does it.');
      if (ENDED.includes(t.status) || FINISHED.includes(t.status)) throw conflict('A finished task cannot be given to someone else.');
      const problems = [];
      for (const u of [...(b.assignees ?? []), ...(b.watchers ?? [])]) if (!core.userRow(actor.companyId, u)) problems.push({ field: 'assignees', message: `${u} is not an active person of this company.` });
      if (problems.length) throw badRequest('The people are not valid.', problems);
      if ((b.assignees ?? []).some((u) => u !== actor.user)) need(actor, 'tsk.task.assign', 'give a task to someone else', { companyId: actor.companyId, projectId: t.project_id });
      return transaction(db, () => {
        const stamp = iso();
        const sync = (role, list) => {
          const now = core.assigneesOf(id, role).map((a) => a.user_ref);
          for (const u of now.filter((x) => !list.includes(x))) db.prepare('UPDATE tsk_assignees SET is_active = 0, deleted_at = ?, deleted_by = ? WHERE task_id = ? AND user_ref = ? AND role = ? AND is_active = 1').run(stamp, actor.user, id, u, role);
          const added = list.filter((x) => !now.includes(x));
          for (const u of added) {
            const old = db.prepare('SELECT id FROM tsk_assignees WHERE task_id = ? AND user_ref = ? AND role = ?').get(id, u, role);
            if (old) db.prepare('UPDATE tsk_assignees SET is_active = 1, deleted_at = NULL, accepted_at = NULL WHERE id = ?').run(old.id);
            else db.prepare("INSERT INTO tsk_assignees (company_id, task_id, user_ref, role, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'task')").run(actor.companyId, id, u, role, actor.user);
          }
          return added;
        };
        const added = b.assignees ? sync('ASSIGNEE', [...new Set(b.assignees)]) : [];
        if (b.watchers) sync('WATCHER', [...new Set(b.watchers)].filter((u) => !(b.assignees ?? core.assigneesOf(id).map((a) => a.user_ref)).includes(u)));
        if (added.length && t.status !== 'OPEN') db.prepare("UPDATE tsk_tasks SET status = 'OPEN', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status IN ('ACCEPTED')").run(actor.user, stamp, id);
        writeAudit(db, { entity: 'tsk_tasks', entityId: id, action: 'reassign', newValues: { assignees: b.assignees, watchers: b.watchers }, actor: actor.user, companyId: actor.companyId });
        core.tell(t, 'tsk.task.assigned', added.filter((u) => u !== actor.user), { actor: actor.user }, `task:${id}:assigned:${added.join(',')}:${stamp}`);
        return tasks.get(actor, id);
      });
    },
  };

  // ---- the team dashboard (FR-06) ----
  const dashboard = (actor, q = {}) => {
    need(actor, 'tsk.team.view', 'see the tasks of your team');
    const p = { c: actor.companyId, today: todayStr(), me: actor.user };
    const team = teamSql(actor);
    const scope = `t.company_id = :c AND t.is_active = 1 AND ${team}${q.projectId ? ' AND t.project_id = :project' : ''}${q.departmentId ? ' AND t.department_id = :dept' : ''}`;
    if (q.projectId) p.project = q.projectId;
    if (q.departmentId) p.dept = q.departmentId;
    const one = (sql) => db.prepare(sql).get(only(sql, p)).n;
    const tiles = {
      open: one(`SELECT COUNT(*) AS n FROM tsk_tasks t WHERE ${scope} AND ${OPEN_SQL}`),
      overdue: one(`SELECT COUNT(*) AS n FROM tsk_tasks t WHERE ${scope} AND ${OPEN_SQL} AND t.due_date < :today`),
      blocked: one(`SELECT COUNT(*) AS n FROM tsk_tasks t WHERE ${scope} AND t.status = 'BLOCKED'`),
      escalated: one(`SELECT COUNT(*) AS n FROM tsk_tasks t WHERE ${scope} AND ${OPEN_SQL} AND t.escalation_level > 0`),
      toVerify: one(`SELECT COUNT(*) AS n FROM tsk_tasks t WHERE ${scope} AND t.status = 'DONE' AND t.requires_verification = 1`),
      closed30: one(`SELECT COUNT(*) AS n FROM tsk_tasks t WHERE ${scope} AND t.status = 'CLOSED' AND t.closed_at >= '${new Date(Date.parse(todayStr()) - 30 * 86_400_000).toISOString()}'`),
    };
    const peopleSql = `SELECT a.user_ref AS user, COUNT(*) AS open, SUM(CASE WHEN t.due_date < :today THEN 1 ELSE 0 END) AS overdue, SUM(CASE WHEN t.priority IN ('HIGH', 'URGENT') THEN 1 ELSE 0 END) AS high
      FROM tsk_tasks t JOIN tsk_assignees a ON a.task_id = t.id AND a.role = 'ASSIGNEE' AND a.is_active = 1 WHERE ${scope} AND ${OPEN_SQL} GROUP BY a.user_ref ORDER BY overdue DESC, open DESC, a.user_ref LIMIT 50`;
    const people = db.prepare(peopleSql).all(only(peopleSql, p))
      .map((r) => ({ user: r.user, name: core.userRow(actor.companyId, r.user)?.display_name ?? r.user, open: r.open, overdue: r.overdue, high: r.high }));
    const countIn = (col, w) => { const sql = `SELECT COUNT(*) AS n FROM tsk_tasks t WHERE ${scope} AND t.${col} >= :f AND t.${col} < :t`; return db.prepare(sql).get(only(sql, { ...p, f: w.f, t: w.to })).n; };
    const weeks = [];
    for (let i = 7; i >= 0; i -= 1) {
      const to = new Date(Date.parse(todayStr()) - i * 7 * 86_400_000 + 86_400_000);
      const from = new Date(to.getTime() - 7 * 86_400_000);
      const w = { from: from.toISOString().slice(0, 10), to: to.toISOString(), f: from.toISOString() };
      weeks.push({ week: w.from, created: countIn('created_at', w), closed: countIn('closed_at', w) });
    }
    const lateSql = `SELECT t.* FROM tsk_tasks t WHERE ${scope} AND ${OPEN_SQL} AND t.due_date < :today ORDER BY t.due_date, t.id LIMIT 10`;
    const late = db.prepare(lateSql).all(only(lateSql, p)).map((t) => present(t, actor));
    return { tiles, people, trend: weeks, overdueList: late };
  };

  // ---- the responsibility matrix (FR-03) ----
  const presentRow = (r) => ({ id: r.id, topicCode: r.topic_code, topicName: r.topic_name, departmentId: r.department_id, department: r.department, role: r.role_code, fallbackUser: r.fallback_user_ref, raciProcess: r.raci_process_code, defaultPriority: r.default_priority, defaultDueDays: r.default_due_days, requiresEvidence: r.requires_evidence === 1, requiresVerification: r.requires_verification === 1, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, version: r.matrix_version, status: r.status, batchId: r.batch_id, instanceId: r.instance_id, by: r.created_by, reason: r.reason });
  const routing = {
    list(actor) {
      need(actor, 'tsk.routing.view', 'see the responsibility matrix');
      const rows = db.prepare("SELECT m.*, d.name AS department FROM tsk_routing_matrix m JOIN org_departments d ON d.id = m.department_id WHERE m.company_id = ? AND m.is_active = 1 AND m.status IN ('ACTIVE', 'PENDING') ORDER BY m.topic_code, m.status, m.id").all(actor.companyId).map(presentRow);
      return {
        rows,
        departments: db.prepare("SELECT d.id, d.name, u.username AS head FROM org_departments d LEFT JOIN iam_users u ON u.id = d.head_user_id WHERE d.company_id = ? AND d.status = 'ACTIVE' ORDER BY d.name").all(actor.companyId),
        processes: db.prepare('SELECT process_code AS code, name FROM acc_raci_templates WHERE company_id IS NULL OR company_id = ? ORDER BY name').all(actor.companyId),
        pendingBatch: rows.find((r) => r.status === 'PENDING')?.batchId ?? null, canEdit: may(actor, 'tsk.routing.edit'),
      };
    },
    propose(actor, b) {
      need(actor, 'tsk.routing.edit', 'change the responsibility matrix');
      const problems = [];
      const seen = new Set();
      b.rows.forEach((r, i) => {
        if (seen.has(r.topicCode)) problems.push({ field: `rows.${i}.topicCode`, message: `${r.topicCode} is given twice.` });
        seen.add(r.topicCode);
        if (!db.prepare('SELECT 1 FROM org_departments WHERE id = ? AND company_id = ? AND status = \'ACTIVE\'').get(r.departmentId, actor.companyId)) problems.push({ field: `rows.${i}.departmentId`, message: 'There is no such department.' });
        if (!ROLE_CODES.has(r.role)) problems.push({ field: `rows.${i}.role`, message: `${r.role} is not a role of the catalogue.` });
        if (r.fallbackUser && !core.userRow(actor.companyId, r.fallbackUser)) problems.push({ field: `rows.${i}.fallbackUser`, message: `${r.fallbackUser} is not an active person of this company.` });
        if (r.effectiveFrom < todayStr()) problems.push({ field: `rows.${i}.effectiveFrom`, message: 'A change takes effect from today or a later date.' });
      });
      if (problems.length) throw badRequest('The responsibility matrix is not valid.', problems);
      return transaction(db, () => {
        if (db.prepare("SELECT 1 FROM tsk_routing_matrix WHERE company_id = ? AND status = 'PENDING'").get(actor.companyId)) throw conflict('A change of the responsibility matrix is already waiting for approval. It must be decided first.');
        const batch = Number(db.prepare('SELECT COALESCE(MAX(batch_id), 0) + 1 AS n FROM tsk_routing_matrix').get().n);
        for (const r of b.rows) {
          const v = (db.prepare('SELECT MAX(matrix_version) AS v FROM tsk_routing_matrix WHERE company_id = ? AND topic_code = ?').get(actor.companyId, r.topicCode).v ?? 0) + 1;
          db.prepare(`INSERT INTO tsk_routing_matrix (company_id, topic_code, topic_name, department_id, role_code, fallback_user_ref, raci_process_code, default_priority, default_due_days, requires_evidence, requires_verification, effective_from, matrix_version, status, batch_id, reason, created_by, source_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, 'routing_change')`).run(actor.companyId, r.topicCode, r.topicName, r.departmentId, r.role, r.fallbackUser ?? null, r.raciProcess ?? null, r.defaultPriority, r.defaultDueDays, r.requiresEvidence ? 1 : 0, r.requiresVerification ? 1 : 0, r.effectiveFrom, v, batch, b.reason, actor.user);
        }
        writeAudit(db, { entity: 'tsk_routing_matrix', entityId: batch, action: 'propose', newValues: { topics: b.rows.map((r) => r.topicCode) }, actor: actor.user, companyId: actor.companyId, reason: b.reason });
        const instance = engine.submit(actor, { docType: ROUTING_DOC, docId: batch, comment: b.reason, context: {} });
        db.prepare('UPDATE tsk_routing_matrix SET instance_id = ? WHERE batch_id = ?').run(instance.id, batch);
        return { batch, workflow: instance };
      });
    },
  };

  // ---- the sweep: repeat, remind, escalate (FR-05, FR-07) ----
  const sweep = () => {
    const out = { repeated: core.recur(), reminded: 0, escalated: 0 };
    const day = todayStr();
    const tomorrow = new Date(Date.parse(day) + 86_400_000).toISOString().slice(0, 10);
    for (const t of db.prepare(`SELECT t.* FROM tsk_tasks t WHERE t.is_active = 1 AND ${OPEN_SQL} AND t.due_date IS NOT NULL AND t.due_date >= ? AND t.due_date <= ? AND (t.last_reminded_at IS NULL OR substr(t.last_reminded_at, 1, 10) < ?)`).all(day, tomorrow, day)) {
      const people = core.assigneesOf(t.id).map((a) => a.user_ref);
      core.tell(t, 'tsk.task.reminder', people, {}, `task:${t.id}:reminder:${day}`);
      db.prepare('UPDATE tsk_tasks SET last_reminded_at = ? WHERE id = ?').run(core.nowIso(), t.id);
      out.reminded += 1;
    }
    for (const t of db.prepare(`SELECT t.* FROM tsk_tasks t WHERE t.is_active = 1 AND ${OPEN_SQL} AND t.due_date IS NOT NULL AND t.due_date < ?`).all(day)) {
      const late = Math.round((Date.parse(day) - Date.parse(t.due_date)) / 86_400_000);
      const l1 = Number(core.param('tsk.escalate_level1_days', t.company_id));
      const l2 = Number(core.param('tsk.escalate_level2_days', t.company_id));
      const level = late >= l2 ? 2 : late >= l1 ? 1 : 0;
      if (level <= t.escalation_level) continue;
      transaction(db, () => {
        const people = core.assigneesOf(t.id).map((a) => a.user_ref);
        const roles = people.flatMap((u) => JSON.parse(db.prepare('SELECT roles_json FROM iam_users WHERE company_id = ? AND username = ?').get(t.company_id, u)?.roles_json ?? '[]'));
        const fromRole = roles[0] ?? null;
        const next = paths.next({ companyId: t.company_id, projectId: t.project_id, fromRole, level });
        const target = next ? core.holders(t.company_id, [next.role]).filter((u) => !people.includes(u)) : [];
        const dept = core.departmentHead(t.company_id, t.department_id);
        const toUsers = target.length ? target.slice(0, 3) : [dept?.head].filter((u) => u && !people.includes(u));
        db.prepare('UPDATE tsk_tasks SET escalation_level = ?, last_escalated_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(level, core.nowIso(), 'system', iso(), t.id);
        db.prepare("INSERT INTO tsk_escalations (company_id, task_id, level, to_role, to_user, days_late, at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'system', 'sweep')").run(t.company_id, t.id, level, next?.role ?? null, toUsers[0] ?? null, late, core.nowIso());
        for (const u of toUsers) if (!db.prepare('SELECT 1 FROM tsk_assignees WHERE task_id = ? AND user_ref = ? AND is_active = 1').get(t.id, u)) db.prepare("INSERT OR IGNORE INTO tsk_assignees (company_id, task_id, user_ref, role, created_by, source_type) VALUES (?, ?, ?, 'WATCHER', 'system', 'escalation')").run(t.company_id, t.id, u);
        writeAudit(db, { entity: 'tsk_tasks', entityId: t.id, action: 'escalate', newValues: { level, toRole: next?.role ?? null, toUsers, daysLate: late }, actor: 'system', companyId: t.company_id });
        core.event('tsk.task.escalated', t, 'system', { level, toRole: next?.role ?? null, toUsers, daysLate: late });
        core.tell(t, 'tsk.task.escalated', [...toUsers, t.assigner], { assignee: people.join(', ') || 'nobody', level: String(level) }, `task:${t.id}:escalated:${level}`);
      });
      out.escalated += 1;
    }
    return out;
  };

  return { tasks, dashboard, routing, sweep, core, may };
}

// the evidence of a task (a photo, a signed copy) goes through the file service like every other attachment
fileEntities.register({
  entity: 'tsk_task', label: 'Task',
  resolve(db, actor, id) {
    const t = db.prepare('SELECT * FROM tsk_tasks WHERE id = ? AND company_id = ? AND is_active = 1').get(Number(id), actor.companyId);
    if (!t) return null;
    const authz = authzOf(db);
    const mine = db.prepare('SELECT 1 FROM tsk_assignees WHERE task_id = ? AND user_ref = ? AND is_active = 1').get(t.id, actor.user);
    const view = mine || t.assigner === actor.user || authz.check(actor, 'tsk.team.view', { companyId: t.company_id, projectId: t.project_id, siteId: t.site_id }).allowed;
    return { companyId: t.company_id, projectId: t.project_id, siteId: t.site_id, canView: Boolean(view), canEdit: Boolean(mine || t.assigner === actor.user) && !['CLOSED', 'CANCELLED'].includes(t.status), locked: ['CLOSED', 'CANCELLED'].includes(t.status) };
  },
});
