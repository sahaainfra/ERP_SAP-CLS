import { inTransaction } from '../db/index.js';
import { writeAudit } from '../audit/index.js';
import { accountabilityOf } from '../accountability/index.js';
import { publishEvent } from '../events/index.js';
import { badRequest, conflict, notFound, unprocessable } from '../http/errors.js';
import { notificationsOf } from '../notify/index.js';
import { createParameterStore } from '../parameters/index.js';
import { workflowOf } from '../workflow/index.js';

/**
 * Tasks (part 04.08): the one place a task is made, routed, moved and closed.
 *
 *   tasksOf(db).create({ companyId, title, assignees: ['anil'], dueDate, entity, entityId, projectId, origin: 'auto', source: { type, id }, actor: 'system' })   // any module
 *   tasksOf(db).route({ companyId, topicCode, projectId, siteId })                                                                                 // topic -> department -> role -> employee
 *   tasksOf(db).act(actor, id, 'complete', { reason })                                                                                              // accept, start, block, unblock, complete, verify, close, reopen, cancel
 *
 * A task is linked to any record by entity and entity_id. BR-01: a task that needs verification is not closed before the assigner (or a delegate) has verified it. BR-02: a task does not start
 * before the tasks it depends on are done (the setting `tsk.dependency_block` says whether that blocks or only warns). FR-04: a task that needs evidence is not done without a file.
 * The module side (modules/eng/tasks.js) adds who may do what, the lists and the dashboards; the escalation of late tasks follows the path of part 04.02 and lives there too.
 */
export const STATUSES = Object.freeze(['OPEN', 'ACCEPTED', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'VERIFIED', 'CLOSED', 'CANCELLED']);
export const PRIORITIES = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export const ACTIONS = Object.freeze(['accept', 'start', 'block', 'unblock', 'complete', 'verify', 'close', 'reopen', 'cancel']);
export const FINISHED = Object.freeze(['DONE', 'VERIFIED', 'CLOSED']);
export const ENDED = Object.freeze(['CLOSED', 'CANCELLED']);
const NOTIFY_PRIORITY = { LOW: 'LOW', MEDIUM: 'NORMAL', HIGH: 'HIGH', URGENT: 'URGENT' };
const FREQS = ['DAILY', 'WEEKLY', 'MONTHLY'];
const instances = new WeakMap();

export const tasksOf = (db) => {
  if (!instances.has(db)) instances.set(db, createTasks(db));
  return instances.get(db);
};

/** The next date of a recurrence rule after `from` (YYYY-MM-DD). */
export function nextDate(rule, from) {
  const d = new Date(`${from}T00:00:00.000Z`);
  const n = Number(rule.interval ?? 1);
  if (rule.freq === 'DAILY') d.setUTCDate(d.getUTCDate() + n);
  else if (rule.freq === 'WEEKLY') d.setUTCDate(d.getUTCDate() + 7 * n);
  else {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return d.toISOString().slice(0, 10);
}
export function checkRecurrence(rule) {
  if (rule == null) return [];
  const problems = [];
  if (!FREQS.includes(rule.freq)) problems.push({ field: 'recurrence.freq', message: 'Choose daily, weekly or monthly.' });
  if (!Number.isInteger(rule.interval ?? 1) || (rule.interval ?? 1) < 1 || (rule.interval ?? 1) > 52) problems.push({ field: 'recurrence.interval', message: 'Repeat every 1 to 52 periods.' });
  if (rule.until && !/^\d{4}-\d{2}-\d{2}$/.test(rule.until)) problems.push({ field: 'recurrence.until', message: 'Give the last date as YYYY-MM-DD.' });
  return problems;
}

function createTasks(db) {
  const engine = workflowOf(db);
  const params = createParameterStore(db);
  const notif = notificationsOf(db);
  const acc = accountabilityOf(db);
  const clock = () => engine.clock();
  const nowIso = () => clock().toISOString();
  const today = () => new Date(clock().getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const param = (key, companyId) => params.get(key, { companyId, date: today() });
  const link = (id) => `/tasks/task?id=${id}`;

  const userRow = (companyId, name) => db.prepare("SELECT username, display_name FROM iam_users WHERE company_id = ? AND username = ? AND is_active = 1 AND status = 'ACTIVE'").get(companyId, name);
  const holders = (companyId, roles) => db.prepare("SELECT u.username FROM iam_users u WHERE u.company_id = ? AND u.is_active = 1 AND u.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value IN (SELECT value FROM json_each(?))) ORDER BY u.username").all(companyId, JSON.stringify(roles)).map((r) => r.username);
  const openLoad = (companyId, user) => db.prepare("SELECT COUNT(*) AS n FROM tsk_tasks t JOIN tsk_assignees a ON a.task_id = t.id AND a.role = 'ASSIGNEE' AND a.is_active = 1 WHERE t.company_id = ? AND a.user_ref = ? AND t.status NOT IN ('DONE', 'VERIFIED', 'CLOSED', 'CANCELLED') AND t.is_active = 1").get(companyId, user).n;
  const departmentHead = (companyId, departmentId) => {
    if (!departmentId) return null;
    const d = db.prepare('SELECT d.id, d.name, u.username AS head FROM org_departments d LEFT JOIN iam_users u ON u.id = d.head_user_id AND u.is_active = 1 AND u.status = \'ACTIVE\' WHERE d.id = ? AND d.company_id = ?').get(departmentId, companyId);
    return d ?? null;
  };
  const assigneesOf = (taskId, role = 'ASSIGNEE') => db.prepare('SELECT user_ref, accepted_at FROM tsk_assignees WHERE task_id = ? AND role = ? AND is_active = 1 ORDER BY id').all(taskId, role);
  const evidenceCount = (taskId) => db.prepare("SELECT COUNT(*) AS n FROM core_files WHERE linked_entity = 'tsk_task' AND linked_id = ? AND is_active = 1 AND deleted_at IS NULL AND scan_status != 'INFECTED'").get(String(taskId)).n;

  /**
   * FR-03: the topic of an instruction gives the concerned department, the responsible role and the responsible employee. The employee is, in order: the person the RACI of the topic's process
   * names as responsible (04.05), the holder of the role with the fewest open tasks, the fallback person of the row, the head of the department. When no row or no person is found the
   * instruction goes to the head of the department (the one on the row, or the one the sender named). Returns { ok, topic, department, role, employee, via, trail, failed }.
   */
  function route({ companyId, topicCode, projectId = null, siteId = null, departmentId = null, date = today() }) {
    const trail = [];
    const row = topicCode ? db.prepare("SELECT * FROM tsk_routing_matrix WHERE company_id = ? AND topic_code = ? AND status IN ('ACTIVE', 'RETIRED') AND is_active = 1 AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) ORDER BY matrix_version DESC, id DESC LIMIT 1").get(companyId, topicCode, date, date) : null;
    const out = { ok: false, topic: row ? { code: row.topic_code, name: row.topic_name, defaultPriority: row.default_priority, defaultDueDays: row.default_due_days, requiresEvidence: row.requires_evidence === 1, requiresVerification: row.requires_verification === 1 } : null, department: null, role: row?.role_code ?? null, employee: null, via: null, trail, failed: null };
    const dept = departmentHead(companyId, row?.department_id ?? departmentId);
    out.department = dept ? { id: dept.id, name: dept.name, head: dept.head ?? null } : null;
    const take = (user, via, text) => { out.employee = user; out.via = via; out.ok = true; trail.push(text); };
    if (row) {
      trail.push(`The matrix names ${dept?.name ?? 'a department'} and the role ${row.role_code} for ${row.topic_name}.`);
      if (row.raci_process_code) {
        const r = acc.resolve({ companyId, processCode: row.raci_process_code, projectId, siteId, departmentId: row.department_id, date });
        const named = r?.responsible.find((x) => x.user && userRow(companyId, x.user))?.user;
        if (named) take(named, 'raci', `The accountability matrix names ${named} as responsible for ${row.raci_process_code}.`);
        else if (r?.accountable && userRow(companyId, r.accountable)) take(r.accountable, 'raci', `The accountability matrix names ${r.accountable} as accountable for ${row.raci_process_code}; nobody is named as responsible.`);
        else trail.push(`The accountability matrix names nobody for ${row.raci_process_code}.`);
      }
      if (!out.ok) {
        const who = holders(companyId, [row.role_code]).map((u) => ({ u, n: openLoad(companyId, u) })).sort((a, b) => a.n - b.n || a.u.localeCompare(b.u));
        if (who.length) take(who[0].u, 'role_holder', `${who[0].u} holds ${row.role_code} and has the fewest open tasks (${who[0].n}).`);
        else trail.push(`Nobody holds the role ${row.role_code}.`);
      }
      if (!out.ok && row.fallback_user_ref && userRow(companyId, row.fallback_user_ref)) take(row.fallback_user_ref, 'fallback', `The matrix names ${row.fallback_user_ref} as the fallback.`);
    } else {
      out.failed = topicCode ? `No row of the responsibility matrix covers the topic ${topicCode}.` : 'No topic was given.';
      trail.push(out.failed);
    }
    if (!out.ok) {
      out.failed ??= `No responsible employee could be found for ${row?.topic_name ?? topicCode}.`;
      if (dept?.head) take(dept.head, 'department_head', `The instruction goes to the head of ${dept.name}, ${dept.head}, to place it.`);
      else trail.push(dept ? `${dept.name} has no head set.` : 'There is no department to fall back to.');
    }
    return out;
  }

  const dependencyState = (taskId) => db.prepare("SELECT t.id, t.task_no, t.title, t.status FROM tsk_dependencies d JOIN tsk_tasks t ON t.id = d.depends_on_task_id WHERE d.task_id = ? AND d.is_active = 1 AND t.is_active = 1 ORDER BY t.id").all(taskId);
  const unmet = (taskId) => dependencyState(taskId).filter((t) => !['DONE', 'VERIFIED', 'CLOSED', 'CANCELLED'].includes(t.status));
  const reaches = (from, target, seen = new Set()) => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return db.prepare('SELECT depends_on_task_id AS d FROM tsk_dependencies WHERE task_id = ? AND is_active = 1').all(from).some((r) => reaches(r.d, target, seen));
  };
  const nextNo = (companyId) => `TSK-${String(Number(db.prepare("SELECT COALESCE(MAX(CAST(substr(task_no, 5) AS INTEGER)), 0) + 1 AS n FROM tsk_tasks WHERE company_id = ?").get(companyId).n)).padStart(5, '0')}`;
  const event = (type, t, actor, extra = {}) => publishEvent(db, { type, entity: 'task', entityId: t.id, actorId: actor, companyId: t.company_id, projectId: t.project_id ?? null, siteId: t.site_id ?? null, data: { taskNo: t.task_no, status: t.status, entity: t.entity, entityId: t.entity_id, origin: t.origin, ...extra } });
  const tell = (t, templateCode, recipients, data, key) => {
    const users = [...new Set(recipients)].filter(Boolean);
    if (!users.length) return;
    notif.notify({ companyId: t.company_id, templateCode, recipients: users.map((u) => `user:${u}`), data: { taskNo: t.task_no, title: t.title, dueDate: t.due_date ?? 'no date', priority: t.priority.toLowerCase(), ...data }, priority: NOTIFY_PRIORITY[t.priority], link: link(t.id), category: 'tasks', projectId: t.project_id, siteId: t.site_id, sourceType: 'task', sourceId: t.id, eventKey: key ?? `task:${t.id}:${templateCode}:${nowIso()}` });
  };

  /** Make a task. Returns { id, existing } (an automatic task with the same source is made once). */
  function create(input) {
    const o = { priority: 'MEDIUM', origin: 'manual', assignees: [], watchers: [], checklist: [], dependsOn: [], notify: true, ...input };
    const problems = [];
    if (!o.companyId) problems.push({ field: 'companyId', message: 'is required' });
    if (!o.title || !String(o.title).trim()) problems.push({ field: 'title', message: 'Give the task a title.' });
    if (!PRIORITIES.includes(o.priority)) problems.push({ field: 'priority', message: 'Choose low, medium, high or urgent.' });
    if (o.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(o.dueDate)) problems.push({ field: 'dueDate', message: 'Give the date as YYYY-MM-DD.' });
    if (o.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(o.startDate)) problems.push({ field: 'startDate', message: 'Give the date as YYYY-MM-DD.' });
    if (o.startDate && o.dueDate && o.dueDate < o.startDate) problems.push({ field: 'dueDate', message: 'The due date is before the start date.' });
    problems.push(...checkRecurrence(o.recurrence));
    if (o.recurrence && !o.dueDate) problems.push({ field: 'dueDate', message: 'A recurring task needs the date of its first occurrence.' });
    for (const [i, u] of o.assignees.entries()) if (!userRow(o.companyId, u)) problems.push({ field: `assignees.${i}`, message: `${u} is not an active person of this company.` });
    for (const [i, u] of o.watchers.entries()) if (!userRow(o.companyId, u)) problems.push({ field: `watchers.${i}`, message: `${u} is not an active person of this company.` });
    if (o.departmentId && !db.prepare('SELECT 1 FROM org_departments WHERE id = ? AND company_id = ?').get(o.departmentId, o.companyId)) problems.push({ field: 'departmentId', message: 'There is no such department.' });
    if (o.projectId && !db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ?').get(o.projectId, o.companyId)) problems.push({ field: 'projectId', message: 'There is no such project.' });
    for (const [i, id] of o.dependsOn.entries()) if (!db.prepare('SELECT 1 FROM tsk_tasks WHERE id = ? AND company_id = ? AND is_active = 1').get(id, o.companyId)) problems.push({ field: `dependsOn.${i}`, message: 'That task does not exist.' });
    if (problems.length) throw badRequest('The task is not valid.', problems);
    if (o.source?.type && o.source?.id != null && o.origin === 'auto') {
      const old = db.prepare("SELECT id FROM tsk_tasks WHERE company_id = ? AND source_type = ? AND source_id = ? AND is_active = 1").get(o.companyId, o.source.type, String(o.source.id));
      if (old) return { id: old.id, existing: true };
    }
    const actor = o.actor ?? o.assigner ?? 'system';
    return inTransaction(db, () => {
      const no = nextNo(o.companyId);
      const res = db.prepare(`INSERT INTO tsk_tasks (company_id, task_no, title, description, entity, entity_id, entity_label, project_id, site_id, department_id, topic_code, priority, start_date, due_date, status, recurrence_rule, requires_acceptance, requires_evidence, requires_verification, origin, assigner, routing_json, created_by, source_type, source_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(o.companyId, no, String(o.title).trim(), o.description ?? null, o.entity ?? null, o.entityId != null ? String(o.entityId) : null, o.entityLabel ?? null, o.projectId ?? null, o.siteId ?? null, o.departmentId ?? null, o.topicCode ?? null, o.priority, o.startDate ?? null, o.dueDate ?? null,
          o.recurrence ? JSON.stringify({ freq: o.recurrence.freq, interval: o.recurrence.interval ?? 1, ...(o.recurrence.until ? { until: o.recurrence.until } : {}) }) : null, o.requiresAcceptance ? 1 : 0, o.requiresEvidence ? 1 : 0, o.requiresVerification ? 1 : 0, o.origin, o.assigner ?? actor, o.routing ? JSON.stringify(o.routing) : null, actor, o.source?.type ?? (o.origin === 'manual' ? 'task_form' : o.origin), o.source?.id != null ? String(o.source.id) : null);
      const id = Number(res.lastInsertRowid);
      if (o.recurrence) db.prepare('UPDATE tsk_tasks SET series_id = ? WHERE id = ?').run(id, id);
      if (o.seriesId) db.prepare('UPDATE tsk_tasks SET series_id = ? WHERE id = ?').run(o.seriesId, id);
      const addPerson = db.prepare('INSERT INTO tsk_assignees (company_id, task_id, user_ref, role, created_by, source_type) VALUES (?, ?, ?, ?, ?, \'task\')');
      for (const u of new Set(o.assignees)) addPerson.run(o.companyId, id, u, 'ASSIGNEE', actor);
      for (const u of new Set(o.watchers)) if (!o.assignees.includes(u)) addPerson.run(o.companyId, id, u, 'WATCHER', actor);
      o.checklist.forEach((text, i) => db.prepare('INSERT INTO tsk_checklist_items (company_id, task_id, position, text, created_by, source_type) VALUES (?, ?, ?, ?, ?, \'task\')').run(o.companyId, id, i, String(text).trim().slice(0, 300), actor));
      for (const d of new Set(o.dependsOn)) db.prepare('INSERT INTO tsk_dependencies (company_id, task_id, depends_on_task_id, created_by, source_type) VALUES (?, ?, ?, ?, \'task\')').run(o.companyId, id, d, actor);
      const t = get(id);
      writeAudit(db, { entity: 'tsk_tasks', entityId: id, action: 'create', newValues: { taskNo: no, title: t.title, origin: o.origin, assignees: o.assignees, dueDate: t.due_date, entity: t.entity, entityId: t.entity_id }, actor, companyId: o.companyId });
      event('tsk.task.created', t, actor, { assignees: o.assignees });
      if (o.notify) tell(t, 'tsk.task.assigned', o.assignees.filter((u) => u !== actor), { actor: userRow(o.companyId, actor)?.display_name ?? actor }, `task:${id}:assigned`);
      return { id, existing: false };
    });
  }

  function get(id) {
    return db.prepare('SELECT * FROM tsk_tasks WHERE id = ? AND is_active = 1').get(id);
  }

  /** Add a dependency to an existing task (no loops). */
  function addDependency(actor, taskId, dependsOn) {
    return inTransaction(db, () => {
      const t = get(taskId);
      const d = get(dependsOn);
      if (!t || !d || t.company_id !== d.company_id) throw notFound('That task does not exist.');
      if (taskId === dependsOn) throw unprocessable('A task cannot depend on itself.');
      if (reaches(dependsOn, taskId)) throw unprocessable(`${d.task_no} already depends on ${t.task_no}, directly or through other tasks; this would make a loop.`);
      if (ENDED.includes(t.status) || FINISHED.includes(t.status)) throw conflict('A finished task cannot be given new dependencies.');
      const old = db.prepare('SELECT id, is_active FROM tsk_dependencies WHERE task_id = ? AND depends_on_task_id = ?').get(taskId, dependsOn);
      if (old?.is_active === 1) return { added: false };
      if (old) db.prepare('UPDATE tsk_dependencies SET is_active = 1, deleted_at = NULL, updated_by = ?, updated_at = ? WHERE id = ?').run(actor, nowIso(), old.id);
      else db.prepare('INSERT INTO tsk_dependencies (company_id, task_id, depends_on_task_id, created_by, source_type) VALUES (?, ?, ?, ?, \'task\')').run(t.company_id, taskId, dependsOn, actor);
      writeAudit(db, { entity: 'tsk_tasks', entityId: taskId, action: 'depend', newValues: { dependsOn: d.task_no }, actor, companyId: t.company_id });
      return { added: true };
    });
  }
  function removeDependency(actor, taskId, dependsOn) {
    const t = get(taskId);
    if (!t) throw notFound('That task does not exist.');
    const r = db.prepare('UPDATE tsk_dependencies SET is_active = 0, deleted_at = ?, deleted_by = ? WHERE task_id = ? AND depends_on_task_id = ? AND is_active = 1').run(nowIso(), actor, taskId, dependsOn);
    if (Number(r.changes)) writeAudit(db, { entity: 'tsk_tasks', entityId: taskId, action: 'undepend', newValues: { dependsOn }, actor, companyId: t.company_id });
    return { removed: Number(r.changes) > 0 };
  }

  const closeNow = (t, actor, stamp) => {
    db.prepare("UPDATE tsk_tasks SET status = 'CLOSED', closed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(stamp, actor, stamp, t.id);
    writeAudit(db, { entity: 'tsk_tasks', entityId: t.id, action: 'close', oldValues: { status: t.status }, newValues: { status: 'CLOSED' }, actor, companyId: t.company_id });
  };

  /**
   * Move a task. The state rules are here; who may move it is decided by the caller. Returns { task, warnings }.
   * `actor` is a username; `by` says what the person is to the task (assigner, assignee) for the rules that depend on it.
   */
  function act(actor, id, action, { reason = null, by = /** @type {{ assigner?: boolean, assignee?: boolean }} */ ({}) } = {}) {
    if (!ACTIONS.includes(action)) throw badRequest('That is not something a task can do.', [{ field: 'action', message: `Use one of ${ACTIONS.join(', ')}.` }]);
    return inTransaction(db, () => {
      const t = get(id);
      if (!t) throw notFound('That task does not exist.');
      const stamp = nowIso();
      const from = t.status;
      const warnings = [];
      const bad = (msg) => { throw conflict(msg); };
      const move = (status, extra = '', args = []) => {
        db.prepare(`UPDATE tsk_tasks SET status = ?, ${extra}${extra ? ', ' : ''}updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(status, ...args, actor, stamp, id);
        writeAudit(db, { entity: 'tsk_tasks', entityId: id, action, oldValues: { status: from }, newValues: { status }, reason: reason ?? undefined, actor, companyId: t.company_id });
      };
      const checkDependencies = (what) => {
        const open = unmet(id);
        if (!open.length) return;
        const list = open.map((d) => `${d.task_no} (${d.status.toLowerCase().replace('_', ' ')})`).join(', ');
        if (Number(param('tsk.dependency_block', t.company_id)) === 1) throw unprocessable(`${what} before ${list} ${open.length === 1 ? 'is' : 'are'} done. Finish ${open.length === 1 ? 'that task' : 'those tasks'} first.`);
        warnings.push(`${list} ${open.length === 1 ? 'is' : 'are'} not done yet.`);
      };
      if (action === 'accept') {
        if (t.status !== 'OPEN') bad(`This task is ${t.status.toLowerCase().replace('_', ' ')}; only an open task is accepted.`);
        db.prepare('UPDATE tsk_assignees SET accepted_at = ? WHERE task_id = ? AND user_ref = ? AND role = \'ASSIGNEE\' AND is_active = 1').run(stamp, id, actor);
        move('ACCEPTED');
        event('tsk.task.accepted', { ...t, status: 'ACCEPTED' }, actor);
      } else if (action === 'start') {
        if (t.status === 'OPEN' && t.requires_acceptance) bad('This task must be accepted before it is started.');
        if (!['OPEN', 'ACCEPTED'].includes(t.status)) bad(`This task is ${t.status.toLowerCase().replace('_', ' ')}; only an open or accepted task is started.`);
        checkDependencies('This task cannot start');
        move('IN_PROGRESS', 'blocked_reason = NULL');
        event('tsk.task.started', { ...t, status: 'IN_PROGRESS' }, actor);
      } else if (action === 'block') {
        if (!['OPEN', 'ACCEPTED', 'IN_PROGRESS'].includes(t.status)) bad(`This task is ${t.status.toLowerCase().replace('_', ' ')} and cannot be marked blocked.`);
        if (!reason || reason.trim().length < 3) throw badRequest('Say what blocks the task.', [{ field: 'reason', message: 'Give the reason (at least 3 characters).' }]);
        move('BLOCKED', 'blocked_reason = ?', [reason.trim()]);
        event('tsk.task.blocked', { ...t, status: 'BLOCKED' }, actor, { reason });
        tell({ ...t, status: 'BLOCKED' }, 'tsk.task.reopened', [t.assigner].filter((u) => u !== actor), { actor, reason: `blocked: ${reason}` });
      } else if (action === 'unblock') {
        if (t.status !== 'BLOCKED') bad('Only a blocked task is unblocked.');
        move('IN_PROGRESS', 'blocked_reason = NULL');
      } else if (action === 'complete') {
        if (!['OPEN', 'ACCEPTED', 'IN_PROGRESS', 'BLOCKED'].includes(t.status)) bad(`This task is ${t.status.toLowerCase().replace('_', ' ')}; it cannot be completed again.`);
        if (t.status === 'OPEN' && t.requires_acceptance) bad('This task must be accepted before it is completed.');
        checkDependencies('This task cannot be completed');
        if (t.requires_evidence && evidenceCount(id) === 0) throw unprocessable('This task needs evidence (a photo or a document) before it can be completed. Attach a file to the task first.');
        move('DONE', 'completed_by = ?, completed_at = ?, blocked_reason = NULL', [actor, stamp]);
        const done = { ...t, status: 'DONE' };
        event('tsk.task.completed', done, actor);
        if (t.requires_verification) tell(done, 'tsk.task.verify', [t.assigner].filter((u) => u !== actor), { actor: userRow(t.company_id, actor)?.display_name ?? actor }, `task:${id}:verify:${stamp}`);
        else closeNow(done, actor, stamp);
      } else if (action === 'verify') {
        if (t.status !== 'DONE') bad('Only a task that is done is verified.');
        if (!t.requires_verification) bad('This task does not need verification.');
        if (!by.assigner) throw unprocessable('Only the person who gave the task (or someone they delegated to) verifies it.');
        if (by.assignee) throw unprocessable('The person who did the task cannot verify it.');
        move('VERIFIED', 'verified_by = ?, verified_at = ?', [actor, stamp]);
        event('tsk.task.verified', { ...t, status: 'VERIFIED' }, actor);
        closeNow({ ...t, status: 'VERIFIED' }, actor, stamp);
      } else if (action === 'close') {
        if (t.status === 'CLOSED') bad('This task is already closed.');
        if (t.requires_verification && t.status !== 'VERIFIED') throw unprocessable('This task needs verification by the person who gave it before it can be closed.');
        if (!['DONE', 'VERIFIED'].includes(t.status)) bad(`This task is ${t.status.toLowerCase().replace('_', ' ')}; only a done task is closed.`);
        closeNow(t, actor, stamp);
        event('tsk.task.closed', { ...t, status: 'CLOSED' }, actor);
      } else if (action === 'reopen') {
        if (!['DONE', 'VERIFIED', 'CLOSED'].includes(t.status)) bad('Only a finished task is sent back.');
        if (!reason || reason.trim().length < 3) throw badRequest('Say why the task is sent back.', [{ field: 'reason', message: 'Give the reason (at least 3 characters).' }]);
        move('IN_PROGRESS', 'verified_by = NULL, verified_at = NULL, completed_at = NULL, completed_by = NULL, closed_at = NULL');
        event('tsk.task.reopened', { ...t, status: 'IN_PROGRESS' }, actor, { reason });
        tell({ ...t, status: 'IN_PROGRESS' }, 'tsk.task.reopened', assigneesOf(id).map((a) => a.user_ref).filter((u) => u !== actor), { actor: userRow(t.company_id, actor)?.display_name ?? actor, reason });
      } else if (action === 'cancel') {
        if (ENDED.includes(t.status) || FINISHED.includes(t.status)) bad(`This task is ${t.status.toLowerCase()}; it cannot be cancelled.`);
        if (!reason || reason.trim().length < 3) throw badRequest('Say why the task is cancelled.', [{ field: 'reason', message: 'Give the reason (at least 3 characters).' }]);
        move('CANCELLED', 'blocked_reason = NULL');
        event('tsk.task.cancelled', { ...t, status: 'CANCELLED' }, actor, { reason });
      }
      return { task: get(id), warnings };
    });
  }

  /** FR-07: the next occurrence of each recurring task whose period has come. Returns the number made. */
  function recur() {
    const day = today();
    const heads = db.prepare("SELECT * FROM tsk_tasks WHERE recurrence_rule IS NOT NULL AND is_active = 1 AND id = (SELECT MAX(s.id) FROM tsk_tasks s WHERE s.series_id = tsk_tasks.series_id AND s.is_active = 1) AND status != 'CANCELLED'").all();
    let made = 0;
    for (const t of heads) {
      const rule = JSON.parse(t.recurrence_rule);
      if (!t.due_date || t.due_date > day) continue;
      let due = nextDate(rule, t.due_date);
      while (due <= day && due < '2100-01-01') due = nextDate(rule, due); // a long-stopped series catches up to the next date that is still ahead
      if (rule.until && due > rule.until) continue;
      const people = assigneesOf(t.id).map((a) => a.user_ref);
      const watchers = assigneesOf(t.id, 'WATCHER').map((a) => a.user_ref);
      const checklist = db.prepare('SELECT text FROM tsk_checklist_items WHERE task_id = ? AND is_active = 1 ORDER BY position').all(t.id).map((r) => r.text);
      create({ companyId: t.company_id, title: t.title, description: t.description, entity: t.entity, entityId: t.entity_id, entityLabel: t.entity_label, projectId: t.project_id, siteId: t.site_id, departmentId: t.department_id, topicCode: t.topic_code, priority: t.priority, dueDate: due, assignees: people.filter((u) => userRow(t.company_id, u)), watchers: watchers.filter((u) => userRow(t.company_id, u)), checklist, recurrence: rule, requiresEvidence: t.requires_evidence === 1, requiresVerification: t.requires_verification === 1, requiresAcceptance: t.requires_acceptance === 1, origin: 'auto', assigner: t.assigner, actor: 'system', source: { type: 'recurrence', id: `${t.series_id}:${due}` }, seriesId: t.series_id });
      made += 1;
    }
    return made;
  }

  return { create, get, route, act, addDependency, removeDependency, recur, dependencyState, unmet, evidenceCount, assigneesOf, today, nowIso, userRow, holders, departmentHead, tell, event, link, param };
}
