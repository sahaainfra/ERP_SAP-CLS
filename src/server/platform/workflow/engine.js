import { inTransaction } from '../db/index.js';
import { writeAudit } from '../audit/index.js';
import { authzOf } from '../authz/index.js';
import { publishEvent } from '../events/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../http/errors.js';
import { createParameterStore } from '../parameters/index.js';
import { sodOf } from '../sod/index.js';
import { meets, packSteps, unpackSteps } from './definition.js';
import { systemActions, workflowResolvers, workflowTypes } from './registry.js';

/**
 * The workflow engine (part 04.01): one engine for every approval-controlled document. A module registers its document type (registry.js) and calls
 * submit(); the engine resolves who must decide, makes the tasks, takes the decisions, and tells the module the outcome through its hooks and through
 * `workflow.instance.*` events, in the same transaction. It never decides for anyone: a step nobody can be found for goes to the workflow
 * administrators' queue and waits there (BR-02). The originator never decides on their own document (BR-01).
 */
const HOUR = 3_600_000;
const ADMIN_ROLE_PERMISSION = 'eng.workflow.admin';
const SOD = (message) => new HttpError(403, 'SEGREGATION_OF_DUTIES', message);
const needsComment = (comment, what) => { if (!comment || comment.trim().length < 5) throw badRequest(`Give a comment of at least 5 characters when you ${what}.`, [{ field: 'comment', message: 'is required' }]); };

export function createWorkflowEngine({ db, now = () => new Date() }) {
  const authz = authzOf(db);
  const iso = () => now().toISOString();
  const has = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
  const iamCache = new Map();
  /** In a company that has people in the identity tables the holders of a role can be listed; in development-header mode they cannot. */
  const iamMode = (companyId) => {
    if (!has('iam_users')) return false;
    if (!iamCache.has(companyId)) iamCache.set(companyId, Boolean(db.prepare('SELECT 1 FROM iam_users WHERE company_id = ? LIMIT 1').get(companyId)));
    return iamCache.get(companyId);
  };
  const today = () => iso().slice(0, 10);

  /** The people who hold a role in a part of the company now: by an assignment that covers it, or by the roles recorded on their account (the whole company). */
  function holders(companyId, role, scope = {}) {
    const rows = db.prepare(`SELECT DISTINCT u.username, a.scope_type, a.scope_ids_json FROM iam_assignments a JOIN iam_users u ON u.id = a.user_id JOIN iam_roles r ON r.id = a.role_id
      WHERE a.company_id = ? AND r.code = ? AND a.status = 'ACTIVE' AND a.is_active = 1 AND u.status = 'ACTIVE' AND u.is_active = 1 AND (a.effective_from IS NULL OR a.effective_from <= ?) AND (a.effective_to IS NULL OR a.effective_to >= ?)`).all(companyId, role, today(), today());
    const byAssignment = rows.filter((a) => {
      const ids = JSON.parse(a.scope_ids_json || '[]').map(Number);
      if (a.scope_type === 'COMPANY') return true;
      if (a.scope_type === 'PROJECT') return scope.projectId ? ids.includes(Number(scope.projectId)) : false;
      if (a.scope_type === 'SITE') return scope.siteId ? ids.includes(Number(scope.siteId)) : false;
      return !scope.projectId && !scope.siteId;
    }).map((a) => a.username);
    const byAccount = db.prepare("SELECT u.username FROM iam_users u WHERE u.company_id = ? AND u.status = 'ACTIVE' AND u.is_active = 1 AND EXISTS (SELECT 1 FROM json_each(u.roles_json) j WHERE j.value = ?)").all(companyId, role).map((u) => u.username);
    return [...new Set([...byAssignment, ...byAccount])];
  }

  /** The roles a person holds for any part of the company: those on their account or session and those of their assignments. */
  function heldRoles(actor) {
    const set = new Set(actor.roles ?? []);
    if (actor.userId && iamMode(actor.companyId)) {
      for (const r of db.prepare("SELECT DISTINCT r.code FROM iam_assignments a JOIN iam_roles r ON r.id = a.role_id WHERE a.user_id = ? AND a.company_id = ? AND a.status = 'ACTIVE' AND a.is_active = 1 AND (a.effective_from IS NULL OR a.effective_from <= ?) AND (a.effective_to IS NULL OR a.effective_to >= ?)").all(actor.userId, actor.companyId, today(), today())) set.add(r.code);
    }
    return [...set];
  }

  // ---- loading ----
  const loadInstance = (id, companyId) => {
    const i = db.prepare('SELECT * FROM wf_instances WHERE id = ? AND is_active = 1').get(id);
    if (!i || i.company_id !== companyId) throw notFound('That workflow instance does not exist.');
    return i;
  };
  const loadTask = (id, companyId) => {
    const t = db.prepare('SELECT * FROM wf_tasks WHERE id = ? AND is_active = 1').get(id);
    if (!t || t.company_id !== companyId) throw notFound('That task does not exist.');
    return t;
  };
  const defOf = (inst) => unpackSteps(inst.steps_json);
  const stepsOf = (inst) => defOf(inst).steps;
  const typeOf = (docType) => {
    const t = workflowTypes.get(docType);
    if (!t) throw unprocessable(`The document type ${docType} is not known to the workflow engine, so it cannot be submitted.`);
    return t;
  };

  // ---- history, audit, events ----
  function hist(inst, { event, actor, task = null, comment = null, data = {}, step = undefined }) {
    db.prepare('INSERT INTO wf_history (company_id, instance_id, task_id, cycle, step_code, event, actor, comment, data_json, at, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(inst.company_id, inst.id, task?.id ?? null, inst.cycle, step === undefined ? (task?.step_code ?? inst.current_step) : step, event, actor, comment, JSON.stringify(data), iso(), inst.project_id, inst.site_id, actor, 'workflow');
  }
  const audit = (inst, action, actor, { reason = null, oldValues, newValues } = {}) => writeAudit(db, { entity: 'wf_instances', entityId: inst.id, action, oldValues, newValues: { docType: inst.doc_type, docId: inst.doc_id, ...(newValues ?? {}) }, reason, actor });
  const emit = (inst, type, actor, data = {}) => publishEvent(db, { type, entity: 'workflow_instance', entityId: inst.id, actorId: actor, companyId: inst.company_id, projectId: inst.project_id, siteId: inst.site_id, data: { instanceId: inst.id, docType: inst.doc_type, docId: inst.doc_id, ...data } });
  const notify = (inst, actor, template, recipients, extra = {}) => {
    if (recipients.length) emit(inst, 'workflow.notification.requested', actor, { template, recipients, ...extra });
  };
  const refresh = (id) => db.prepare('SELECT * FROM wf_instances WHERE id = ?').get(id);
  const bump = (inst, patch) => {
    const cols = Object.keys(patch);
    db.prepare(`UPDATE wf_instances SET ${cols.map((c) => `${c} = :${c}`).join(', ')}, updated_at = :now, version = version + 1 WHERE id = :id`).run({ ...patch, now: iso(), id: inst.id });
    return refresh(inst.id);
  };

  // ---- definitions as the engine needs them ----
  /** The active definition of a document type; a company that has none yet starts with the default of the module that owns the type. */
  function activeDefinition(companyId, docType) {
    const hit = db.prepare("SELECT * FROM wf_definitions WHERE company_id = ? AND doc_type = ? AND status = 'ACTIVE' AND is_active = 1").get(companyId, docType);
    if (hit) return hit;
    const t = typeOf(docType);
    const next = (db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM wf_definitions WHERE company_id = ? AND doc_type = ?').get(companyId, docType).v) + 1;
    const body = { settings: { resubmit: 'first', distinctApprovers: true, ...(t.defaultDefinition.settings ?? {}) }, steps: t.defaultDefinition.steps };
    const res = db.prepare("INSERT INTO wf_definitions (company_id, doc_type, version, name, status, steps_json, activated_at, activated_by, created_by, source_type) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, 'system', 'system', 'default_definition')")
      .run(companyId, docType, next, t.defaultDefinition.name ?? `${t.label ?? docType} approval`, packSteps(body), iso());
    return db.prepare('SELECT * FROM wf_definitions WHERE id = ?').get(Number(res.lastInsertRowid));
  }

  // ---- who must decide ----
  /** The tasks a step needs: one for each approver, or an empty slot for one nobody could be found for. */
  function resolveStep(inst, step) {
    const context = JSON.parse(inst.context_json);
    const scope = { projectId: inst.project_id ?? undefined, siteId: inst.site_id ?? undefined };
    const slots = [];
    const addUser = (user, note) => {
      if (!user) return;
      if (user === inst.submitted_by) { slots.push({ empty: true, why: `${user} raised this document and cannot approve it` }); return; }
      slots.push({ user, note });
    };
    const addRole = (role, note) => {
      const roles = role.split('|');
      if (iamMode(inst.company_id)) {
        const people = [...new Set(roles.flatMap((r) => holders(inst.company_id, r, scope)))].filter((u) => u !== inst.submitted_by);
        if (!people.length) { slots.push({ empty: true, why: `nobody holds ${roles.join(' or ')} for this part of the company (other than the person who raised it)` }); return; }
      }
      slots.push({ role, scope, note });
    };
    for (const a of step.approvers) {
      if (a.kind === 'user') addUser(a.user);
      else if (a.kind === 'role') addRole(a.role);
      else {
        const name = a.kind === 'manager' ? 'manager' : a.resolver;
        const fn = workflowResolvers.get(name);
        const found = fn ? fn({ db, companyId: inst.company_id, instance: { docType: inst.doc_type, docId: inst.doc_id, submittedBy: inst.submitted_by, context, projectId: inst.project_id, siteId: inst.site_id }, step }) : [];
        const list = (found ?? []).map((f) => (typeof f === 'string' ? { user: f } : f));
        if (!list.length) slots.push({ empty: true, why: `no one was found by "${name}"` });
        for (const f of list) f.role ? addRole(f.role) : addUser(f.user);
      }
    }
    return slots;
  }

  const slaHoursOf = (inst, step) => {
    if (step.slaHours) return step.slaHours;
    try { return Number(createParameterStore(db).get('eng.workflow.default_sla_hours', { companyId: inst.company_id, date: today() })); } catch { return 48; }
  };

  function makeTask(inst, step, stepNo, slot, kind, actor) {
    const due = new Date(now().getTime() + slaHoursOf(inst, step) * HOUR).toISOString();
    const empty = Boolean(slot.empty);
    const res = db.prepare(`INSERT INTO wf_tasks (company_id, instance_id, step_code, step_no, cycle, kind, assignee_user_id, assignee_role, scope_json, status, due_at, project_id, site_id, created_by, source_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'workflow')`)
      .run(inst.company_id, inst.id, step.code, stepNo, inst.cycle, kind, slot.user ?? null, slot.role ?? null, JSON.stringify(slot.scope ?? {}), empty ? 'ADMIN_QUEUE' : 'OPEN', due, inst.project_id, inst.site_id, actor);
    const task = db.prepare('SELECT * FROM wf_tasks WHERE id = ?').get(Number(res.lastInsertRowid));
    hist(inst, { event: empty ? 'ADMIN_QUEUE' : 'TASK_CREATED', actor, task, comment: empty ? slot.why : null, data: { assignee: slot.user ?? slot.role ?? null } });
    if (empty) {
      emit(inst, 'workflow.task.unassigned', actor, { taskId: task.id, step: step.code, why: slot.why });
      notify(inst, actor, 'workflow.task.unassigned', ['permission:eng.workflow.admin'], { taskId: task.id, step: step.code, why: slot.why });
      audit(inst, 'admin_queue', actor, { reason: slot.why, newValues: { taskId: task.id, step: step.code } });
    } else {
      emit(inst, 'workflow.task.created', actor, { taskId: task.id, step: step.code, assignee: slot.user ?? slot.role });
      notify(inst, actor, 'workflow.task.assigned', [slot.user ? `user:${slot.user}` : `role:${slot.role}`], { taskId: task.id, step: step.code });
    }
    return task;
  }

  /**
   * Make the instance reach the step at `from` or the first one after it that needs a person: steps whose condition is not met are skipped,
   * notifications are sent and system actions run on the way. Past the last step the document is approved.
   */
  function advance(instIn, from, actor) {
    let inst = instIn;
    const steps = stepsOf(inst);
    const context = JSON.parse(inst.context_json);
    for (let idx = from; idx < steps.length; idx += 1) {
      const step = steps[idx];
      if (!meets(step.when, context)) { hist(inst, { event: 'STEP_SKIPPED', actor, step: step.code, comment: 'the step does not apply to this document' }); continue; }
      if (step.type === 'notification') {
        const people = [];
        for (const a of step.notify) {
          if (a.kind === 'role') people.push(`role:${a.role}`);
          else if (a.kind === 'user') people.push(`user:${a.user}`);
          else for (const f of (workflowResolvers.get(a.kind === 'manager' ? 'manager' : a.resolver)?.({ db, companyId: inst.company_id, instance: { docType: inst.doc_type, docId: inst.doc_id, submittedBy: inst.submitted_by, context }, step }) ?? [])) people.push(typeof f === 'string' ? `user:${f}` : f.role ? `role:${f.role}` : `user:${f.user}`);
        }
        notify(inst, actor, 'workflow.step.notified', people, { step: step.code });
        hist(inst, { event: 'NOTIFIED', actor, step: step.code, data: { recipients: people } });
        continue;
      }
      if (step.type === 'system') {
        systemActions.get(step.action)(db, { instance: inst, step, actor });
        hist(inst, { event: 'SYSTEM_ACTION', actor, step: step.code, data: { action: step.action } });
        continue;
      }
      inst = bump(inst, { current_step: step.code });
      const slots = resolveStep(inst, step);
      for (const slot of slots) makeTask(inst, step, idx + 1, slot, step.type === 'review' ? 'REVIEW' : 'APPROVAL', actor);
      const adminOnly = slots.every((s) => s.empty);
      inst = bump(inst, { needs_admin: slots.some((s) => s.empty) ? 1 : 0 });
      hist(inst, { event: 'STEP_STARTED', actor, step: step.code, data: { mode: step.mode, tasks: slots.length, waitingForAdministrator: adminOnly } });
      return inst;
    }
    return finish(inst, 'APPROVED', actor, null);
  }

  /** Close an instance with an outcome, tell the module (its hook runs in this transaction) and everyone else (the event). */
  function finish(inst, status, actor, comment, { hook = true, event } = {}) {
    db.prepare("UPDATE wf_tasks SET status = 'CANCELLED', updated_at = ?, version = version + 1 WHERE instance_id = ? AND status IN ('OPEN', 'ADMIN_QUEUE')").run(iso(), inst.id);
    const out = bump(inst, { status, completed_at: iso(), completed_reason: comment, needs_admin: 0 });
    const verb = event ?? status.toLowerCase();
    hist(out, { event: status === 'APPROVED' ? 'COMPLETED' : verb.toUpperCase(), actor, comment, step: null });
    audit(out, verb, actor, { reason: comment, newValues: { status } });
    const t = workflowTypes.get(inst.doc_type);
    const hookName = { APPROVED: 'onApproved', REJECTED: 'onRejected', CANCELLED: 'onCancelled', WITHDRAWN: 'onCancelled' }[status];
    if (hook && hookName) t?.hooks?.[hookName]?.(db, { instance: present(out), actor: { user: actor }, comment });
    emit(out, `workflow.instance.${verb}`, actor, { status, comment: comment ?? undefined });
    notify(out, actor, `workflow.instance.${verb}`, [`user:${out.submitted_by}`, ...watchers(out.id).map((w) => `user:${w}`)], { status });
    return out;
  }

  const watchers = (id) => db.prepare('SELECT user_ref FROM wf_watchers WHERE instance_id = ? AND is_active = 1').all(id).map((w) => w.user_ref);
  const addWatcher = (inst, user, actor) => db.prepare('INSERT OR IGNORE INTO wf_watchers (company_id, instance_id, user_ref, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?)').run(inst.company_id, inst.id, user, inst.project_id, inst.site_id, actor, 'workflow');

  // ---- who may act on a task ----
  function isAssignee(actor, task) {
    if (task.assignee_user_id) return task.assignee_user_id === actor.user;
    const roles = String(task.assignee_role ?? '').split('|').filter(Boolean);
    const held = heldRoles(actor);
    if (!roles.some((r) => held.includes(r))) return false;
    const scope = JSON.parse(task.scope_json || '{}');
    if (!iamMode(task.company_id) || !(scope.projectId || scope.siteId)) return true;
    return roles.some((r) => holders(task.company_id, r, scope).includes(actor.user));
  }
  /** Why this person may not decide this task, or null when they may. */
  function whyNot(actor, task, inst) {
    if (task.status !== 'OPEN') return task.status === 'ADMIN_QUEUE' ? 'Nobody has been assigned to this task yet; a workflow administrator must assign it.' : `This task is already ${task.status.toLowerCase()}.`;
    if (inst.status !== 'RUNNING') return `The document is ${inst.status.toLowerCase()}, so its tasks are closed.`;
    if (actor.user === inst.submitted_by) return 'You raised this document, so someone else must decide on it.';
    if (!isAssignee(actor, task)) return task.assignee_user_id ? `This task is for ${task.assignee_user_id}.` : `This task needs the ${String(task.assignee_role).replace(/\|/g, ' or ')} role${JSON.parse(task.scope_json || '{}').projectId ? ' for this project' : ''}. You do not hold it.`;
    return null;
  }
  const actedBefore = (inst, actor, task) => Boolean(db.prepare("SELECT 1 FROM wf_tasks WHERE instance_id = ? AND superseded = 0 AND status = 'DONE' AND action = 'approve' AND id != ? AND updated_by = ?").get(inst.id, task.id, actor.user));

  // ---- submit ----
  function submit(actor, { docType, docId, context = {}, amendsDocId = null, comment = null, startAt = 0 }) {
    const t = typeOf(docType);
    docId = String(docId);
    return inTransaction(db, () => {
      const doc = t.describe(db, actor.companyId, docId);
      if (!doc) throw notFound(`The ${t.label ?? docType} ${docId} does not exist.`);
      if (doc.originator && doc.originator !== actor.user) throw forbidden(`Only ${doc.originator}, who raised this ${t.label ?? 'document'}, can submit it.`);
      const last = db.prepare('SELECT * FROM wf_instances WHERE company_id = ? AND doc_type = ? AND doc_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1').get(actor.companyId, docType, docId);
      if (last?.status === 'RUNNING') throw conflict('This document is already in approval.');
      if (last?.status === 'APPROVED') throw unprocessable('This document is approved and locked. Amend it to start a new approval linked to this one.');
      if (last?.status === 'RETURNED') return resubmit(actor, last.id, { comment, context });
      let previous = null;
      if (amendsDocId != null) {
        previous = db.prepare("SELECT * FROM wf_instances WHERE company_id = ? AND doc_type = ? AND doc_id = ? AND status = 'APPROVED' ORDER BY id DESC LIMIT 1").get(actor.companyId, docType, String(amendsDocId));
        if (!previous) throw unprocessable(`Only an approved document can be amended; ${docType} ${amendsDocId} has no approval.`);
      }
      const def = activeDefinition(actor.companyId, docType);
      const merged = { ...context };
      const res = db.prepare(`INSERT INTO wf_instances (company_id, doc_type, doc_id, doc_ref, title, definition_id, definition_version, steps_json, status, context_json, previous_instance_id, submitted_by, submitted_at, project_id, site_id, created_by, source_type, source_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING', ?, ?, ?, ?, ?, ?, ?, 'workflow', ?)`)
        .run(actor.companyId, docType, docId, doc.ref ?? null, doc.title ?? null, def.id, def.version, def.steps_json, JSON.stringify(merged), previous?.id ?? null, actor.user, iso(), doc.projectId ?? null, doc.siteId ?? null, actor.user, String(def.id));
      let inst = refresh(Number(res.lastInsertRowid));
      addWatcher(inst, actor.user, actor.user);
      hist(inst, { event: 'SUBMITTED', actor: actor.user, comment, step: null, data: { definitionVersion: def.version, amends: previous?.id ?? null } });
      audit(inst, 'submit', actor.user, { reason: comment, newValues: { definitionVersion: def.version } });
      emit(inst, 'workflow.instance.submitted', actor.user, { definitionVersion: def.version });
      t.hooks.onSubmitted?.(db, { instance: present(inst), actor, comment });
      inst = advance(inst, startAt, actor.user);
      return get(actor, inst.id, { trusted: true });
    });
  }

  /** The originator takes a returned document back into approval: from the first step, or from the step that returned it. */
  function resubmit(actor, instanceId, { comment = null, context } = {}) {
    return inTransaction(db, () => {
      const inst = loadInstance(instanceId, actor.companyId);
      if (inst.submitted_by !== actor.user) throw forbidden('Only the person who raised this document can resubmit it.');
      if (inst.status !== 'RETURNED') throw unprocessable('Only a returned document can be resubmitted.');
      const def = defOf(inst);
      const lastReturn = db.prepare("SELECT step_code FROM wf_history WHERE instance_id = ? AND event = 'RETURNED' ORDER BY id DESC LIMIT 1").get(inst.id);
      let from = def.settings.resubmit === 'returning_step' && lastReturn?.step_code ? def.steps.findIndex((s) => s.code === lastReturn.step_code) : 0;
      if (from < 0) from = 0;
      db.prepare('UPDATE wf_tasks SET superseded = 1 WHERE instance_id = ? AND step_no > ?').run(inst.id, from);
      let next = bump(inst, { status: 'RUNNING', cycle: inst.cycle + 1, completed_at: null, completed_reason: null, ...(context ? { context_json: JSON.stringify({ ...JSON.parse(inst.context_json), ...context }) } : {}) });
      hist(next, { event: 'RESUBMITTED', actor: actor.user, comment, step: null, data: { from: def.steps[from]?.code } });
      audit(next, 'resubmit', actor.user, { reason: comment, newValues: { cycle: next.cycle, from: def.steps[from]?.code } });
      emit(next, 'workflow.instance.resubmitted', actor.user, { cycle: next.cycle });
      workflowTypes.get(inst.doc_type)?.hooks?.onResubmitted?.(db, { instance: present(next), actor, comment });
      next = advance(next, from, actor.user);
      return get(actor, next.id, { trusted: true });
    });
  }

  // ---- act ----
  function act(actor, taskId, input) {
    // a refusal on segregation-of-duties grounds is kept as a record even though the decision is rolled back
    return sodOf(db).attempt(() => inTransaction(db, () => {
      const { action, comment, version } = input;
      let task = loadTask(taskId, actor.companyId);
      let inst = loadInstance(task.instance_id, actor.companyId);
      if (action === 'answer') return answer(actor, task, inst, comment);
      if (version !== undefined && version !== task.version) throw conflict('This task was changed by someone else. Refresh it and decide again.');
      if (actor.user === inst.submitted_by && inst.status === 'RUNNING' && task.status === 'OPEN') throw SOD('You raised this document, so someone else must decide on it.');
      const why = whyNot(actor, task, inst);
      if (why) throw (task.status !== 'OPEN' || inst.status !== 'RUNNING' ? conflict(why) : forbidden(why));
      const steps = stepsOf(inst);
      const step = steps.find((s) => s.code === task.step_code);
      if (defOf(inst).settings.distinctApprovers !== false && actedBefore(inst, actor, task)) throw SOD('You already approved an earlier step of this document; a different person must decide on this step.');
      const asked = task.clarification === 'ASKED';

      if (action === 'clarify') {
        needsComment(comment, 'ask a question');
        if (asked) throw unprocessable('A question is already waiting for an answer on this task.');
        db.prepare("UPDATE wf_tasks SET clarification = 'ASKED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), task.id);
        hist(inst, { event: 'CLARIFICATION_ASKED', actor: actor.user, task, comment });
        audit(inst, 'clarify', actor.user, { reason: comment, newValues: { taskId: task.id } });
        emit(inst, 'workflow.task.clarification_requested', actor.user, { taskId: task.id, step: task.step_code });
        notify(inst, actor.user, 'workflow.task.clarification_requested', [`user:${inst.submitted_by}`], { taskId: task.id });
        return get(actor, inst.id, { trusted: true });
      }
      if (action === 'delegate') {
        const to = String(input.delegateTo ?? '').trim();
        if (!to) throw badRequest('Choose the person to delegate this task to.', [{ field: 'delegateTo', message: 'is required' }]);
        if (to === actor.user) throw unprocessable('You cannot delegate a task to yourself.');
        if (to === inst.submitted_by) throw SOD('The person who raised this document cannot be given a task to decide on it.');
        if (iamMode(actor.companyId) && !db.prepare("SELECT 1 FROM iam_users WHERE company_id = ? AND username = ? AND status = 'ACTIVE'").get(actor.companyId, to)) throw unprocessable(`${to} is not an active person of this company.`);
        db.prepare('UPDATE wf_tasks SET assignee_user_id = ?, assignee_role = NULL, delegated_from = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, task.assignee_user_id ?? actor.user, actor.user, iso(), task.id);
        hist(inst, { event: 'DELEGATED', actor: actor.user, task, comment, data: { to } });
        audit(inst, 'delegate', actor.user, { reason: comment, newValues: { taskId: task.id, to } });
        emit(inst, 'workflow.task.delegated', actor.user, { taskId: task.id, to, from: actor.user });
        notify(inst, actor.user, 'workflow.task.assigned', [`user:${to}`], { taskId: task.id });
        return get(actor, inst.id, { trusted: true });
      }
      if (!['approve', 'reject', 'return'].includes(action)) throw badRequest('The action must be approve, reject, return, clarify, answer or delegate.', [{ field: 'action', message: 'is not valid' }]);
      if (action !== 'approve') needsComment(comment, action === 'reject' ? 'reject a document' : 'return a document');
      if (action === 'approve' && asked) throw unprocessable('A question on this task is still waiting for an answer from the person who raised the document.');
      if (action === 'approve') {
        // the files the approver uploaded to the task (they are linked to it by the file service) count as attached as soon as they are clean
        const uploaded = db.prepare("SELECT id FROM core_files WHERE company_id = ? AND linked_entity = 'wf_task' AND linked_id = ? AND scan_status = 'CLEAN' AND deleted_at IS NULL").all(actor.companyId, task.id).map((f) => f.id);
        const attached = [...new Set([...(input.attachments ?? []).map(Number), ...uploaded])];
        for (const fileId of attached) if (!db.prepare("SELECT 1 FROM core_files WHERE id = ? AND company_id = ? AND scan_status = 'CLEAN' AND deleted_at IS NULL").get(fileId, actor.companyId)) throw unprocessable(`The file ${fileId} was not found or has not passed the virus scan, so it cannot be attached.`);
        const total = db.prepare('SELECT COUNT(*) AS n FROM wf_task_attachments WHERE task_id = ? AND is_active = 1').get(task.id).n + attached.filter((f) => !db.prepare('SELECT 1 FROM wf_task_attachments WHERE task_id = ? AND file_id = ?').get(task.id, f)).length;
        if (step.requireAttachment && total === 0) throw unprocessable('This step needs an attachment (a note, a report, a signed copy) before you approve. Attach it and approve again.');
        const missing = step.checklist.filter((c) => !(input.checked ?? []).includes(c));
        if (missing.length) throw unprocessable(`Tick every item of the checklist before you approve: ${missing.join('; ')}.`);
        for (const fileId of attached) db.prepare('INSERT OR IGNORE INTO wf_task_attachments (company_id, task_id, file_id, created_by, source_type) VALUES (?, ?, ?, ?, ?)').run(actor.companyId, task.id, fileId, actor.user, 'workflow');
      }
      const onBehalf = task.delegated_from && task.assignee_user_id === actor.user ? task.delegated_from : null;
      db.prepare("UPDATE wf_tasks SET status = 'DONE', action = ?, comment = ?, acted_at = ?, on_behalf_of = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?")
        .run(action, comment ?? null, iso(), onBehalf, actor.user, iso(), task.id);
      task = db.prepare('SELECT * FROM wf_tasks WHERE id = ?').get(task.id);
      const event = { approve: 'APPROVED', reject: 'REJECTED', return: 'RETURNED' }[action];
      hist(inst, { event, actor: actor.user, task, comment, data: { onBehalfOf: onBehalf, attachments: input.attachments ?? [] } });
      audit(inst, event.toLowerCase(), actor.user, { reason: comment, newValues: { taskId: task.id, step: task.step_code, onBehalfOf: onBehalf } });
      emit(inst, 'workflow.task.completed', actor.user, { taskId: task.id, step: task.step_code, action });
      sodOf(db).record({ companyId: actor.companyId, actor, action: `workflow.${action}`, subject: { type: 'workflow_instance', id: inst.id } });

      if (action === 'reject') { finish(inst, 'REJECTED', actor.user, comment); return get(actor, inst.id, { trusted: true }); }
      if (action === 'return') { returnDocument(inst, task, step, actor, comment, input.returnToStep); return get(actor, inst.id, { trusted: true }); }
      // approve: does the step have what it needs?
      const siblings = db.prepare("SELECT * FROM wf_tasks WHERE instance_id = ? AND step_code = ? AND superseded = 0 AND status != 'CANCELLED'").all(inst.id, task.step_code);
      const stepDone = step.mode === 'parallel_all' ? siblings.every((s) => s.status === 'DONE' && s.action === 'approve') : true;
      if (!stepDone) { hist(inst, { event: 'WAITING', actor: actor.user, task, data: { waitingFor: siblings.filter((s) => s.status !== 'DONE').length } }); return get(actor, inst.id, { trusted: true }); }
      if (step.mode !== 'parallel_all') db.prepare("UPDATE wf_tasks SET status = 'SKIPPED', updated_at = ?, version = version + 1 WHERE instance_id = ? AND step_code = ? AND superseded = 0 AND id != ? AND status IN ('OPEN', 'ADMIN_QUEUE')").run(iso(), inst.id, task.step_code, task.id);
      inst = bump(inst, { needs_admin: db.prepare("SELECT 1 FROM wf_tasks WHERE instance_id = ? AND status = 'ADMIN_QUEUE'").get(inst.id) ? 1 : 0 });
      advance(inst, steps.findIndex((s) => s.code === task.step_code) + 1, actor.user);
      return get(actor, inst.id, { trusted: true });
    }));
  }

  function answer(actor, task, inst, comment) {
    if (actor.user !== inst.submitted_by) throw forbidden('Only the person who raised this document can answer the question.');
    if (task.clarification !== 'ASKED') throw unprocessable('There is no question waiting on this task.');
    needsComment(comment, 'answer');
    db.prepare("UPDATE wf_tasks SET clarification = 'NONE', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), task.id);
    hist(inst, { event: 'CLARIFICATION_ANSWERED', actor: actor.user, task, comment });
    audit(inst, 'answer', actor.user, { reason: comment, newValues: { taskId: task.id } });
    emit(inst, 'workflow.task.clarification_answered', actor.user, { taskId: task.id, step: task.step_code });
    notify(inst, actor.user, 'workflow.task.clarification_answered', [task.assignee_user_id ? `user:${task.assignee_user_id}` : `role:${task.assignee_role}`], { taskId: task.id });
    return get(actor, inst.id, { trusted: true });
  }

  function returnDocument(inst, task, step, actor, comment, returnToStep) {
    const steps = stepsOf(inst);
    const here = steps.findIndex((s) => s.code === task.step_code);
    const target = returnToStep && returnToStep !== 'originator' ? steps.findIndex((s) => s.code === returnToStep) : -1;
    if (returnToStep && returnToStep !== 'originator' && (target < 0 || target >= here)) throw unprocessable(`You can return a document to its originator or to an earlier step, not to ${returnToStep}.`);
    if (target >= 0) {
      // back to an earlier step: its approvers decide again; the decisions after it stay in the history but no longer count
      db.prepare("UPDATE wf_tasks SET status = 'CANCELLED', updated_at = ?, version = version + 1 WHERE instance_id = ? AND status IN ('OPEN', 'ADMIN_QUEUE')").run(iso(), inst.id);
      db.prepare('UPDATE wf_tasks SET superseded = 1 WHERE instance_id = ? AND step_no > ?').run(inst.id, target);
      hist(inst, { event: 'RETURNED_TO_STEP', actor: actor.user, task, comment, data: { to: steps[target].code } });
      emit(inst, 'workflow.instance.returned', actor.user, { to: steps[target].code, comment });
      notify(inst, actor.user, 'workflow.instance.returned', [`user:${inst.submitted_by}`], { to: steps[target].code });
      advance(refresh(inst.id), target, actor.user);
      return;
    }
    db.prepare("UPDATE wf_tasks SET status = 'CANCELLED', updated_at = ?, version = version + 1 WHERE instance_id = ? AND status IN ('OPEN', 'ADMIN_QUEUE')").run(iso(), inst.id);
    const out = bump(inst, { status: 'RETURNED', completed_at: iso(), completed_reason: comment, needs_admin: 0 });
    audit(out, 'return', actor.user, { reason: comment, newValues: { status: 'RETURNED', step: task.step_code } });
    workflowTypes.get(inst.doc_type)?.hooks?.onReturned?.(db, { instance: present(out), actor, comment });
    emit(out, 'workflow.instance.returned', actor.user, { to: 'originator', comment });
    notify(out, actor.user, 'workflow.instance.returned', [`user:${out.submitted_by}`], { to: 'originator' });
  }

  // ---- withdraw, cancel ----
  function withdraw(actor, instanceId, { comment = null } = {}) {
    return inTransaction(db, () => {
      const inst = loadInstance(instanceId, actor.companyId);
      if (inst.submitted_by !== actor.user) throw forbidden('Only the person who raised this document can withdraw it.');
      if (inst.status !== 'RUNNING') throw unprocessable(`This document is ${inst.status.toLowerCase()} and cannot be withdrawn.`);
      const acted = db.prepare("SELECT 1 FROM wf_tasks WHERE instance_id = ? AND superseded = 0 AND (status = 'DONE' OR clarification = 'ASKED')").get(inst.id) || db.prepare("SELECT 1 FROM wf_history WHERE instance_id = ? AND event IN ('APPROVED', 'RETURNED', 'CLARIFICATION_ASKED', 'DELEGATED')").get(inst.id);
      if (acted) throw unprocessable('An approver has already acted on this document, so you can no longer withdraw it. Ask a person who may cancel it to do so, with a reason.');
      finish(inst, 'WITHDRAWN', actor.user, comment, { event: 'withdrawn' });
      return get(actor, inst.id, { trusted: true });
    });
  }

  function cancel(actor, instanceId, { reason }) {
    return inTransaction(db, () => {
      const inst = loadInstance(instanceId, actor.companyId);
      if (!authz.check(actor, 'eng.workflow.cancel', { companyId: inst.company_id, projectId: inst.project_id, siteId: inst.site_id }).allowed) throw forbidden('Only an authorised role (eng.workflow.cancel) can cancel an approval.');
      needsComment(reason, 'cancel an approval');
      if (inst.status !== 'RUNNING' && inst.status !== 'RETURNED') throw unprocessable(`This document is ${inst.status.toLowerCase()} and cannot be cancelled.`);
      finish(inst, 'CANCELLED', actor.user, reason);
      return get(actor, inst.id, { trusted: true });
    });
  }

  /** The legacy adapter's door: end an instance without the rules a person acting would meet (the legacy engine has its own). */
  function abandon(companyId, instanceId, actor, status, comment) {
    return inTransaction(db, () => {
      const inst = loadInstance(instanceId, companyId);
      if (inst.status !== 'RUNNING' && inst.status !== 'RETURNED') return inst;
      return finish(inst, status, actor, comment, { hook: false, event: status === 'WITHDRAWN' ? 'withdrawn' : undefined });
    });
  }

  // ---- the administrators' queue ----
  function assign(actor, taskId, { user, role, comment = null }) {
    return inTransaction(db, () => {
      const task = loadTask(taskId, actor.companyId);
      const inst = loadInstance(task.instance_id, actor.companyId);
      if (!authz.check(actor, ADMIN_ROLE_PERMISSION, { companyId: inst.company_id, projectId: inst.project_id, siteId: inst.site_id }).allowed) throw forbidden('Only a workflow administrator (eng.workflow.admin) can assign a task.');
      if (task.status !== 'ADMIN_QUEUE') throw conflict('This task is not waiting in the administrators\' queue.');
      if (!user && !role) throw badRequest('Choose a person or a role for this task.', [{ field: 'user', message: 'is required' }]);
      if (user && user === inst.submitted_by) throw SOD('The person who raised this document cannot be given a task to decide on it.');
      if (user && iamMode(actor.companyId) && !db.prepare("SELECT 1 FROM iam_users WHERE company_id = ? AND username = ? AND status = 'ACTIVE'").get(actor.companyId, user)) throw unprocessable(`${user} is not an active person of this company.`);
      db.prepare("UPDATE wf_tasks SET status = 'OPEN', assignee_user_id = ?, assignee_role = ?, scope_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?")
        .run(user ?? null, user ? null : role, JSON.stringify({ projectId: inst.project_id ?? undefined, siteId: inst.site_id ?? undefined }), actor.user, iso(), task.id);
      hist(inst, { event: 'ASSIGNED', actor: actor.user, task, comment, data: { to: user ?? role } });
      audit(inst, 'assign', actor.user, { reason: comment, newValues: { taskId: task.id, to: user ?? role } });
      emit(inst, 'workflow.task.created', actor.user, { taskId: task.id, step: task.step_code, assignee: user ?? role });
      notify(inst, actor.user, 'workflow.task.assigned', [user ? `user:${user}` : `role:${role}`], { taskId: task.id });
      bump(inst, { needs_admin: db.prepare("SELECT 1 FROM wf_tasks WHERE instance_id = ? AND status = 'ADMIN_QUEUE'").get(inst.id) ? 1 : 0 });
      return get(actor, inst.id, { trusted: true });
    });
  }

  function watch(actor, instanceId, on) {
    return inTransaction(db, () => {
      const inst = loadInstance(instanceId, actor.companyId);
      assertCanSee(actor, inst);
      if (on) addWatcher(inst, actor.user, actor.user);
      else db.prepare('DELETE FROM wf_watchers WHERE instance_id = ? AND user_ref = ?').run(inst.id, actor.user);
      return get(actor, inst.id, { trusted: true });
    });
  }

  // ---- reading ----
  const takesPart = (actor, inst) => inst.submitted_by === actor.user
    || Boolean(db.prepare("SELECT 1 FROM wf_tasks WHERE instance_id = ? AND (assignee_user_id = ? OR delegated_from = ? OR updated_by = ?) LIMIT 1").get(inst.id, actor.user, actor.user, actor.user))
    || Boolean(db.prepare('SELECT 1 FROM wf_watchers WHERE instance_id = ? AND user_ref = ?').get(inst.id, actor.user))
    || db.prepare('SELECT * FROM wf_tasks WHERE instance_id = ? AND assignee_role IS NOT NULL AND assignee_user_id IS NULL').all(inst.id).some((t) => isAssignee(actor, t));
  const mayView = (actor, inst) => authz.check(actor, 'eng.workflow.view', { companyId: inst.company_id, projectId: inst.project_id, siteId: inst.site_id }).allowed;
  function assertCanSee(actor, inst) {
    if (inst.company_id !== actor.companyId || !(takesPart(actor, inst) || mayView(actor, inst))) throw notFound('That workflow instance does not exist.');
  }

  function presentTask(t, inst, actor) {
    const why = actor ? whyNot(actor, t, inst) : null;
    return {
      id: t.id, step: t.step_code, stepNo: t.step_no, kind: t.kind, assigneeUser: t.assignee_user_id, assigneeRole: t.assignee_role, status: t.status, dueAt: t.due_at, overdue: t.status === 'OPEN' && t.due_at < iso(),
      actedAt: t.acted_at, action: t.action, comment: t.comment, onBehalfOf: t.on_behalf_of, delegatedFrom: t.delegated_from, clarification: t.clarification, escalatedAt: t.escalated_at, superseded: t.superseded === 1, version: t.version,
      attachments: db.prepare('SELECT file_id FROM wf_task_attachments WHERE task_id = ? AND is_active = 1').all(t.id).map((a) => a.file_id),
      canAct: actor ? !why : undefined, whyNot: actor && why ? why : undefined,
      canAnswer: actor ? t.clarification === 'ASKED' && inst.submitted_by === actor.user : undefined,
    };
  }
  function present(i) {
    const t = workflowTypes.get(i.doc_type);
    return {
      id: i.id, docType: i.doc_type, docLabel: t?.label ?? i.doc_type, docId: i.doc_id, docRef: i.doc_ref, title: i.title, route: t?.route?.(i.doc_id) ?? null, status: i.status, currentStep: i.current_step, cycle: i.cycle,
      definitionId: i.definition_id, definitionVersion: i.definition_version, submittedBy: i.submitted_by, submittedAt: i.submitted_at, completedAt: i.completed_at, completedReason: i.completed_reason,
      needsAdmin: i.needs_admin === 1, previousInstanceId: i.previous_instance_id, projectId: i.project_id, siteId: i.site_id, context: JSON.parse(i.context_json), version: i.version,
    };
  }
  function stepStates(inst, tasks) {
    const def = defOf(inst);
    const skipped = new Set(db.prepare("SELECT step_code FROM wf_history WHERE instance_id = ? AND event = 'STEP_SKIPPED' AND cycle = ?").all(inst.id, inst.cycle).map((h) => h.step_code));
    const curIdx = def.steps.findIndex((s) => s.code === inst.current_step);
    return def.steps.map((s, idx) => {
      const mine = tasks.filter((t) => t.step === s.code && !t.superseded && t.status !== 'CANCELLED');
      let state = 'PENDING';
      if (skipped.has(s.code) && !mine.length) state = 'SKIPPED';
      else if (mine.some((t) => t.status === 'OPEN' || t.status === 'ADMIN_QUEUE')) state = 'ACTIVE';
      else if (mine.some((t) => t.action === 'approve')) state = 'DONE';
      else if (mine.some((t) => t.action === 'reject')) state = 'REJECTED';
      else if (!mine.length && (inst.status === 'APPROVED' || (curIdx >= 0 && idx < curIdx))) state = ['notification', 'system'].includes(s.type) ? 'DONE' : 'SKIPPED';
      return { ...s, state };
    });
  }
  function get(actor, id, { trusted = false } = {}) {
    const inst = loadInstance(id, actor.companyId);
    if (!trusted) assertCanSee(actor, inst);
    const tasks = db.prepare('SELECT * FROM wf_tasks WHERE instance_id = ? ORDER BY id').all(id).map((t) => presentTask(t, inst, actor));
    const history = db.prepare('SELECT id, cycle, step_code, event, actor, comment, data_json, at, task_id FROM wf_history WHERE instance_id = ? ORDER BY id').all(id).map((h) => ({ id: h.id, cycle: h.cycle, step: h.step_code, event: h.event, actor: h.actor, comment: h.comment, data: JSON.parse(h.data_json), at: h.at, taskId: h.task_id }));
    const prev = inst.previous_instance_id ? db.prepare('SELECT id, doc_id, doc_ref, status FROM wf_instances WHERE id = ?').get(inst.previous_instance_id) : null;
    const next = db.prepare('SELECT id, doc_id, doc_ref, status FROM wf_instances WHERE previous_instance_id = ?').all(id);
    const canCancel = ['RUNNING', 'RETURNED'].includes(inst.status) && authz.check(actor, 'eng.workflow.cancel', { companyId: inst.company_id, projectId: inst.project_id, siteId: inst.site_id }).allowed;
    const acted = Boolean(db.prepare("SELECT 1 FROM wf_history WHERE instance_id = ? AND event IN ('APPROVED', 'RETURNED', 'CLARIFICATION_ASKED', 'DELEGATED')").get(id));
    return {
      ...present(inst), steps: stepStates(inst, tasks), settings: defOf(inst).settings, tasks, history, watchers: watchers(id), watching: watchers(id).includes(actor.user),
      previous: prev ? { id: prev.id, docId: prev.doc_id, docRef: prev.doc_ref, status: prev.status } : null, amendments: next.map((n) => ({ id: n.id, docId: n.doc_id, docRef: n.doc_ref, status: n.status })),
      actions: {
        withdraw: inst.status === 'RUNNING' && inst.submitted_by === actor.user && !acted, resubmit: inst.status === 'RETURNED' && inst.submitted_by === actor.user,
        cancel: canCancel, assign: tasks.some((t) => t.status === 'ADMIN_QUEUE') && authz.check(actor, ADMIN_ROLE_PERMISSION, { companyId: inst.company_id, projectId: inst.project_id, siteId: inst.site_id }).allowed,
      },
    };
  }
  function forDocument(actor, docType, docId) {
    const inst = db.prepare('SELECT id FROM wf_instances WHERE company_id = ? AND doc_type = ? AND doc_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1').get(actor.companyId, docType, String(docId));
    return inst ? get(actor, inst.id) : null;
  }
  const history = (actor, docType, docId) => {
    const rows = db.prepare('SELECT id FROM wf_instances WHERE company_id = ? AND doc_type = ? AND doc_id = ? AND is_active = 1 ORDER BY id').all(actor.companyId, docType, String(docId));
    return rows.map((r) => get(actor, r.id));
  };

  /** Tasks for the inbox of part 04.03 (FR-05): mine = assigned | delegated | watching | started | admin. */
  function listTasks(actor, { mine = 'assigned', status, limit = 25, offset = 0 } = {}) {
    const open = status ?? 'OPEN';
    let rows;
    if (mine === 'assigned') {
      // tasks for me by name or by a role I hold, narrowed in SQL. In a company with people in the identity tables a role may be held for part of the
      // company only, so the scope of each task is checked as well and the page and the total count only what I may decide.
      const roles = heldRoles(actor);
      const p = { c: actor.companyId, s: open, u: actor.user };
      roles.forEach((r, i) => { p[`r${i}`] = r; });
      const named = roles.map((_, i) => `:r${i}`).join(', ');
      const alternatives = roles.map((_, i) => `instr('|' || t.assignee_role || '|', '|' || :r${i} || '|') > 0`).join(' OR ');
      const mineSql = `(t.assignee_user_id = :u OR (t.assignee_user_id IS NULL AND (${named ? `t.assignee_role IN (${named}) OR (t.assignee_role LIKE '%|%' AND (${alternatives}))` : '0'})))`;
      const from = `FROM wf_tasks t JOIN wf_instances i ON i.id = t.instance_id WHERE t.company_id = :c AND t.status = :s AND t.superseded = 0 AND i.status = 'RUNNING' AND i.submitted_by != :u AND ${mineSql}`;
      if (!iamMode(actor.companyId)) {
        const total = db.prepare(`SELECT COUNT(*) AS n ${from}`).get(p).n;
        rows = db.prepare(`SELECT t.* ${from} ORDER BY t.due_at, t.id LIMIT :limit OFFSET :offset`).all({ ...p, limit, offset });
        return { rows: rows.map((t) => { const i = loadInstance(t.instance_id, actor.companyId); return { ...presentTask(t, i, actor), instance: present(i) }; }), total };
      }
      rows = db.prepare(`SELECT t.* ${from} ORDER BY t.due_at, t.id`).all(p).filter((t) => isAssignee(actor, t));
    } else if (mine === 'delegated') {
      rows = db.prepare("SELECT t.* FROM wf_tasks t WHERE t.company_id = ? AND t.delegated_from IS NOT NULL AND (t.assignee_user_id = ? OR t.delegated_from = ?) ORDER BY t.id DESC").all(actor.companyId, actor.user, actor.user);
    } else if (mine === 'admin') {
      if (!authz.check(actor, ADMIN_ROLE_PERMISSION).allowed) throw forbidden('Only a workflow administrator (eng.workflow.admin) can see the administrators\' queue.');
      rows = db.prepare("SELECT t.* FROM wf_tasks t WHERE t.company_id = ? AND t.status = 'ADMIN_QUEUE' AND t.superseded = 0 ORDER BY t.id").all(actor.companyId);
    } else {
      const ids = mine === 'watching'
        ? db.prepare('SELECT w.instance_id AS id FROM wf_watchers w JOIN wf_instances i ON i.id = w.instance_id WHERE w.company_id = ? AND w.user_ref = ? ORDER BY i.id DESC').all(actor.companyId, actor.user)
        : db.prepare('SELECT id FROM wf_instances WHERE company_id = ? AND submitted_by = ? AND is_active = 1 ORDER BY id DESC').all(actor.companyId, actor.user);
      const total = ids.length;
      return { rows: ids.slice(offset, offset + limit).map((r) => { const i = loadInstance(r.id, actor.companyId); return { ...present(i), tasks: db.prepare("SELECT * FROM wf_tasks WHERE instance_id = ? AND status IN ('OPEN', 'ADMIN_QUEUE') AND superseded = 0").all(i.id).map((t) => presentTask(t, i, actor)) }; }), total };
    }
    const total = rows.length;
    return {
      rows: rows.slice(offset, offset + limit).map((t) => {
        const i = loadInstance(t.instance_id, actor.companyId);
        return { ...presentTask(t, i, actor), direction: mine === 'delegated' ? (t.delegated_from === actor.user && t.assignee_user_id !== actor.user ? 'by_me' : 'to_me') : undefined, instance: present(i) };
      }),
      total,
    };
  }
  const openCount = (actor) => listTasks(actor, { limit: 1 }).total;

  function listInstances(actor, { docType, status, q, running, limit = 25, offset = 0, sort = 'recent' } = {}) {
    const where = ['i.company_id = :c', 'i.is_active = 1', authz.scopeFilter(actor, 'eng.workflow.view', { project: 'i.project_id', site: 'i.site_id' }).sql];
    const p = { c: actor.companyId, limit, offset };
    if (docType) { where.push('i.doc_type = :t'); p.t = docType; }
    if (status) { where.push('i.status = :s'); p.s = status; }
    if (running) where.push("i.status = 'RUNNING'");
    if (q) { where.push("(i.doc_ref LIKE :q OR i.title LIKE :q OR i.submitted_by LIKE :q OR i.doc_id = :qe)"); p.q = `%${q}%`; p.qe = q; }
    const order = sort === 'oldest' ? 'i.id ASC' : 'i.id DESC';
    const pc = { ...p };
    delete pc.limit;
    delete pc.offset;
    const total = db.prepare(`SELECT COUNT(*) AS n FROM wf_instances i WHERE ${where.join(' AND ')}`).get(pc).n;
    const rows = db.prepare(`SELECT i.* FROM wf_instances i WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT :limit OFFSET :offset`).all(p);
    return { rows: rows.map((i) => ({ ...present(i), openTasks: db.prepare("SELECT COUNT(*) AS n FROM wf_tasks WHERE instance_id = ? AND status IN ('OPEN', 'ADMIN_QUEUE') AND superseded = 0").get(i.id).n })), total };
  }

  /** The monitor report: running instances by type, stuck and overdue ones, the time approvals take. */
  function monitor(actor, { docType, from, to } = {}) {
    const scope = authz.scopeFilter(actor, 'eng.workflow.view', { project: 'i.project_id', site: 'i.site_id' }).sql;
    const p = { c: actor.companyId, now: iso(), from: from ?? '0000', to: to ?? '9999' };
    const t = docType ? ' AND i.doc_type = :t' : '';
    if (docType) p.t = docType;
    const base = `i.company_id = :c AND i.is_active = 1 AND ${scope} AND i.submitted_at >= :from AND i.submitted_at <= :to${t}`;
    const byType = db.prepare(`SELECT i.doc_type AS docType,
        SUM(i.status = 'RUNNING') AS running, SUM(i.status = 'APPROVED') AS approved, SUM(i.status = 'REJECTED') AS rejected, SUM(i.status = 'RETURNED') AS returned, SUM(i.status IN ('CANCELLED', 'WITHDRAWN')) AS cancelled,
        SUM(i.status = 'RUNNING' AND i.needs_admin = 1) AS stuck,
        SUM(i.status = 'RUNNING' AND EXISTS (SELECT 1 FROM wf_tasks t WHERE t.instance_id = i.id AND t.status = 'OPEN' AND t.superseded = 0 AND t.due_at < :now)) AS overdue,
        ROUND(AVG(CASE WHEN i.status = 'APPROVED' THEN (julianday(i.completed_at) - julianday(i.submitted_at)) * 24 END), 2) AS avgCycleHours
      FROM wf_instances i WHERE ${base} GROUP BY i.doc_type ORDER BY i.doc_type`).all(p).map((r) => ({ ...r, label: workflowTypes.get(r.docType)?.label ?? r.docType }));
    const attention = db.prepare(`SELECT i.id, i.doc_type AS docType, i.doc_ref AS docRef, i.title, i.submitted_by AS submittedBy, i.submitted_at AS submittedAt, i.current_step AS currentStep, i.needs_admin AS needsAdmin,
        (SELECT MIN(t.due_at) FROM wf_tasks t WHERE t.instance_id = i.id AND t.status = 'OPEN' AND t.superseded = 0) AS dueAt
      FROM wf_instances i WHERE ${base} AND i.status = 'RUNNING' AND (i.needs_admin = 1 OR EXISTS (SELECT 1 FROM wf_tasks t WHERE t.instance_id = i.id AND t.status = 'OPEN' AND t.superseded = 0 AND t.due_at < :now))
      ORDER BY i.needs_admin DESC, dueAt LIMIT 100`).all(p).map((r) => ({ ...r, needsAdmin: r.needsAdmin === 1, reason: r.needsAdmin === 1 ? 'Waiting for a workflow administrator to assign a task' : 'A task is past its due time' }));
    const sum = (k) => byType.reduce((n, r) => n + (r[k] ?? 0), 0);
    const pn = { ...p };
    delete pn.now;
    const completed = db.prepare(`SELECT ROUND(AVG((julianday(i.completed_at) - julianday(i.submitted_at)) * 24), 2) AS h FROM wf_instances i WHERE ${base} AND i.status = 'APPROVED'`).get(pn).h;
    return { totals: { running: sum('running'), stuck: sum('stuck'), overdue: sum('overdue'), approved: sum('approved'), rejected: sum('rejected'), returned: sum('returned'), cancelled: sum('cancelled'), avgCycleHours: completed }, byType, attention };
  }

  /** Reminders and escalations for tasks past their time (a scheduled job). */
  function sweepSla() {
    return inTransaction(db, () => {
      const at = iso();
      let reminded = 0;
      let escalated = 0;
      const graceHours = (companyId) => { try { return Number(createParameterStore(db).get('eng.workflow.escalation_hours', { companyId, date: today() })); } catch { return 24; } };
      for (const t of db.prepare("SELECT t.* FROM wf_tasks t JOIN wf_instances i ON i.id = t.instance_id WHERE t.status = 'OPEN' AND t.superseded = 0 AND i.status = 'RUNNING' AND t.due_at IS NOT NULL AND t.due_at <= ?").all(at)) {
        const inst = refresh(t.instance_id);
        if (!t.reminded_at) {
          db.prepare('UPDATE wf_tasks SET reminded_at = ?, version = version + 1 WHERE id = ?').run(at, t.id);
          hist(inst, { event: 'REMINDER', actor: 'system', task: t });
          emit(inst, 'workflow.task.reminder', 'system', { taskId: t.id, step: t.step_code });
          notify(inst, 'system', 'workflow.task.reminder', [t.assignee_user_id ? `user:${t.assignee_user_id}` : `role:${t.assignee_role}`], { taskId: t.id });
          reminded += 1;
        } else if (!t.escalated_at && new Date(t.due_at).getTime() + graceHours(t.company_id) * HOUR <= now().getTime()) {
          db.prepare('UPDATE wf_tasks SET escalated_at = ?, version = version + 1 WHERE id = ?').run(at, t.id);
          hist(inst, { event: 'ESCALATED', actor: 'system', task: t, comment: 'the task is long overdue' });
          audit(inst, 'escalate', 'system', { newValues: { taskId: t.id } });
          emit(inst, 'workflow.task.escalated', 'system', { taskId: t.id, step: t.step_code });
          notify(inst, 'system', 'workflow.task.escalated', ['permission:eng.workflow.admin', `user:${inst.submitted_by}`], { taskId: t.id });
          escalated += 1;
        }
      }
      return { reminded, escalated };
    });
  }

  /** What the file service needs to know about a task a file is being attached to: who may see it and who may add to it (the person who must decide on it). */
  function taskAccess(actor, taskId) {
    const t = db.prepare('SELECT * FROM wf_tasks WHERE id = ?').get(Number(taskId));
    if (!t || t.company_id !== actor.companyId) return null;
    const inst = refresh(t.instance_id);
    return { companyId: t.company_id, projectId: inst.project_id, siteId: inst.site_id, canView: takesPart(actor, inst) || mayView(actor, inst), canEdit: !whyNot(actor, t, inst), locked: t.status === 'DONE' };
  }

  /** BR-03: is the document inside an approval or approved, so that it must not be changed? */
  const isLocked = (companyId, docType, docId) => Boolean(db.prepare("SELECT 1 FROM wf_instances WHERE company_id = ? AND doc_type = ? AND doc_id = ? AND status IN ('RUNNING', 'APPROVED') AND is_active = 1").get(companyId, docType, String(docId)));
  /** The legacy adapter keeps the originator in step when a person is replaced. */
  const reassignOriginator = (companyId, docType, docId, to) => db.prepare("UPDATE wf_instances SET submitted_by = ? WHERE company_id = ? AND doc_type = ? AND doc_id = ? AND status IN ('RUNNING', 'RETURNED')").run(to, companyId, docType, String(docId));

  return { taskAccess, submit, resubmit, act, withdraw, cancel, assign, watch, get, forDocument, history, listTasks, openCount, listInstances, monitor, sweepSla, isLocked, abandon, reassignOriginator, activeDefinition, present, loadInstance, iamMode, holders };
}
