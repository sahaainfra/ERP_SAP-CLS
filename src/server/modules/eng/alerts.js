import { inTransaction as transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { ROLE_TEMPLATES, authzOf } from '../../platform/authz/index.js';
import { eventTypes, publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { ACTION_TYPES, OPS, alertDatasets, alertsOf, checkRule, isExternal } from '../../platform/alerts/index.js';
import { workflowTypes } from '../../platform/workflow/index.js';

// The module side of the alert rules (part 04.09): the datasets the modules of today offer, who may see and change rules and alerts, the approval of a rule that sends something outside, the Alert
// Centre's lists and the acknowledging and resolving. The evaluation itself is platform/alerts.
export const RULE_DOC = 'ALR_RULE';
const ROLE_CODES = new Set(ROLE_TEMPLATES.map((r) => r.code));
const iso = () => new Date().toISOString();
const days = (from, to) => Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000);
const step = (code, name, role) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null });

// ---- what the modules of today offer to rules ----
alertDatasets.register({
  code: 'tsk.task', label: 'Tasks (open)', ownerModule: 'tasks', entity: 'task',
  fields: [{ key: 'taskNo', label: 'Task number', type: 'text' }, { key: 'title', label: 'Title', type: 'text' }, { key: 'status', label: 'Status', type: 'enum' }, { key: 'priority', label: 'Priority', type: 'enum' }, { key: 'dueDate', label: 'Due date', type: 'date' },
    { key: 'daysLate', label: 'Days late', type: 'number' }, { key: 'daysToDue', label: 'Days to the due date', type: 'number' }, { key: 'escalationLevel', label: 'Escalation level', type: 'number' }, { key: 'assignees', label: 'Given to', type: 'text' }, { key: 'assigner', label: 'Given by', type: 'text' }],
  query(db, { companyId, today }) {
    return db.prepare("SELECT t.*, (SELECT group_concat(a.user_ref, ', ') FROM tsk_assignees a WHERE a.task_id = t.id AND a.role = 'ASSIGNEE' AND a.is_active = 1) AS people FROM tsk_tasks t WHERE t.company_id = ? AND t.is_active = 1 AND t.status NOT IN ('DONE', 'VERIFIED', 'CLOSED', 'CANCELLED') AND t.due_date IS NOT NULL").all(companyId).map((t) => ({
      id: String(t.id), label: `${t.task_no} ${t.title}`, route: `/tasks/task?id=${t.id}`, projectId: t.project_id, siteId: t.site_id, owners: (t.people ?? '').split(', ').filter(Boolean),
      fields: { taskNo: t.task_no, title: t.title, status: t.status, priority: t.priority, dueDate: t.due_date, daysLate: Math.max(0, days(t.due_date, today)), daysToDue: days(today, t.due_date), escalationLevel: t.escalation_level, assignees: t.people ?? '', assigner: t.assigner },
    }));
  },
});
alertDatasets.register({
  code: 'wf.task', label: 'Approval tasks (open)', ownerModule: 'workflow', entity: 'workflow_task',
  fields: [{ key: 'docRef', label: 'Document', type: 'text' }, { key: 'docType', label: 'Document type', type: 'text' }, { key: 'step', label: 'Step', type: 'text' }, { key: 'role', label: 'Approver role', type: 'text' }, { key: 'dueAt', label: 'Due at', type: 'date' },
    { key: 'hoursLate', label: 'Hours past the due time', type: 'number' }, { key: 'assignees', label: 'Waiting for', type: 'text' }],
  query(db, { companyId, now }) {
    return db.prepare("SELECT t.*, i.doc_type, i.doc_ref, i.doc_id, i.title FROM wf_tasks t JOIN wf_instances i ON i.id = t.instance_id WHERE t.company_id = ? AND t.status = 'OPEN' AND t.superseded = 0 AND t.due_at IS NOT NULL AND t.is_active = 1").all(companyId).map((t) => ({
      id: String(t.id), label: `${t.doc_ref ?? t.doc_id}: ${t.step_code}`, route: `/approvals/task?id=${t.id}`, projectId: t.project_id, siteId: t.site_id, owners: t.assignee_user_id ? [t.assignee_user_id] : [],
      fields: { docRef: t.doc_ref ?? String(t.doc_id), docType: t.doc_type, step: t.step_code, role: t.assignee_role ?? '', dueAt: t.due_at, hoursLate: Math.max(0, Math.floor((now.getTime() - Date.parse(t.due_at)) / 3_600_000)), assignees: t.assignee_user_id ?? t.assignee_role ?? '' },
    }));
  },
});
alertDatasets.register({
  code: 'pcs.exception', label: 'Emergency exceptions to regularise', ownerModule: 'controls', entity: 'pcs_exception',
  fields: [{ key: 'exceptionNo', label: 'Exception', type: 'text' }, { key: 'control', label: 'Control', type: 'text' }, { key: 'regulariseBy', label: 'To be regularised by', type: 'date' }, { key: 'daysLate', label: 'Days past that date', type: 'number' }, { key: 'raisedBy', label: 'Raised by', type: 'text' }],
  query(db, { companyId, today }) {
    return db.prepare("SELECT * FROM pcs_exceptions WHERE company_id = ? AND emergency = 1 AND regularised_at IS NULL AND regularise_by IS NOT NULL AND status IN ('PENDING', 'APPROVED', 'USED') AND is_active = 1").all(companyId).map((e) => ({
      id: String(e.id), label: e.exception_no, route: `/controls/exceptions`, projectId: e.project_id, siteId: null, owners: [e.raised_by],
      fields: { exceptionNo: e.exception_no, control: e.control_code, regulariseBy: String(e.regularise_by).slice(0, 10), daysLate: Math.max(0, days(String(e.regularise_by).slice(0, 10), today)), raisedBy: e.raised_by },
    }));
  },
});

// ---- the approval of a rule that sends something outside ----
function activate(db, id, actor) {
  const r = db.prepare("SELECT * FROM alr_rules WHERE id = ? AND status = 'PENDING'").get(id);
  if (!r) return;
  db.prepare("UPDATE alr_rules SET status = 'RETIRED', enabled = 0, updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND code = ? AND status = 'ACTIVE'").run(actor.user, iso(), r.company_id, r.code);
  db.prepare("UPDATE alr_rules SET status = 'ACTIVE', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), id);
  writeAudit(db, { entity: 'alr_rules', entityId: r.code, action: 'activate', newValues: { version: r.rule_version, enabled: r.enabled === 1 }, actor: actor.user, companyId: r.company_id });
  publishEvent(db, { type: 'alr.rule.changed', entity: 'alert_rule', entityId: r.code, actorId: actor.user, companyId: r.company_id, data: { code: r.code, version: r.rule_version } });
}
const reject = (db, id, actor) => db.prepare("UPDATE alr_rules SET status = 'REJECTED', enabled = 0, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'PENDING'").run(actor.user, iso(), id);
workflowTypes.register({
  docType: RULE_DOC,
  label: 'Alert rule that sends messages outside',
  processOwner: 'SYSADM',
  route: () => '/admin/alert-rules',
  describe(db, companyId, id) {
    const r = db.prepare('SELECT * FROM alr_rules WHERE id = ? AND company_id = ?').get(Number(id), companyId);
    return r ? { ref: `${r.code} v${r.rule_version}`, title: r.name, originator: r.created_by } : null;
  },
  summarise(db, actor, id) {
    const r = db.prepare('SELECT * FROM alr_rules WHERE id = ?').get(Number(id));
    if (!r) return null;
    const actions = JSON.parse(r.actions_json);
    return {
      fields: [{ label: 'Rule', value: `${r.code} (version ${r.rule_version})` }, { label: 'Looks at', value: r.trigger_type === 'EVENT' ? `the event ${r.event_type}` : `${r.dataset}, ${r.schedule}` }, { label: 'Severity', value: r.severity }, { label: 'Repeats at most every', value: `${r.throttle_minutes} minutes` }, { label: 'Reason', value: r.reason ?? '' }],
      lines: { columns: [{ key: 'action', label: 'Action' }, { key: 'detail', label: 'What it does' }], rows: actions.map((a) => ({ action: a.type, detail: a.type === 'webhook' ? `${a.method ?? 'POST'} ${a.connector} ${a.path}` : a.type === 'notify' ? `tell ${a.to.join(', ')}${a.channels?.length ? ` by ${a.channels.join(', ')}` : ''}` : a.type === 'task' ? `make a task: ${a.title}` : a.type === 'escalate' ? `escalate to ${a.role}` : `set the flag ${a.flag}` })) },
    };
  },
  defaultDefinition: { name: 'Alert rule approval', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('OWNER', 'Process owner', 'DIR|PD|PM|CFO|PROCMGR|COMMGR|HRMGR'), step('SYSADM', 'System administrator', 'SYSADM')] },
  hooks: {
    onApproved: (db, { instance, actor }) => activate(db, Number(instance.docId), actor),
    onRejected: (db, { instance, actor }) => reject(db, Number(instance.docId), actor),
    onReturned: (db, { instance, actor }) => reject(db, Number(instance.docId), actor),
    onCancelled: (db, { instance, actor }) => reject(db, Number(instance.docId), actor),
  },
});

export function createAlertService({ db, engine }) {
  const authz = authzOf(db);
  const core = alertsOf(db);
  const may = (actor, key, scope) => authz.check(actor, key, scope ?? { companyId: actor.companyId }).allowed;
  const need = (actor, key, what, scope) => { if (!may(actor, key, scope)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const dsView = (d) => ({ code: d.code, label: d.label, ownerModule: d.ownerModule, entity: d.entity, fields: d.fields });
  const present = (r) => {
    const rule = core.ruleOf(r);
    const ds = rule.triggerType === 'SCHEDULE' ? alertDatasets.get(rule.dataset) : null;
    return { ...rule, id: r.id, ready: rule.triggerType === 'EVENT' || Boolean(ds), awaiting: rule.triggerType === 'SCHEDULE' && !ds ? rule.ownerModule : null, instanceId: r.instance_id, reason: r.reason, createdBy: r.created_by, updatedAt: r.updated_at ?? r.created_at };
  };
  const latest = (companyId, code) => db.prepare("SELECT * FROM alr_rules WHERE company_id = ? AND code = ? AND status IN ('ACTIVE', 'PENDING') AND is_active = 1 ORDER BY rule_version DESC, id DESC").all(companyId, code);

  const rules = {
    list(actor) {
      need(actor, 'alr.rule.view', 'see the alert rules');
      const own = db.prepare("SELECT r.*, (SELECT COUNT(*) FROM alr_alerts a WHERE a.company_id = r.company_id AND a.rule_code = r.code AND a.status != 'RESOLVED') AS open_alerts, (SELECT COUNT(*) FROM alr_alerts a WHERE a.company_id = r.company_id AND a.rule_code = r.code) AS total_alerts FROM alr_rules r WHERE r.company_id = ? AND r.is_active = 1 AND r.status IN ('ACTIVE', 'PENDING') AND r.id = (SELECT MAX(r2.id) FROM alr_rules r2 WHERE r2.company_id = r.company_id AND r2.code = r.code AND r2.status IN ('ACTIVE', 'PENDING') AND r2.is_active = 1) ORDER BY r.code").all(actor.companyId)
        .map((r) => ({ ...present(r), openAlerts: r.open_alerts, totalAlerts: r.total_alerts, lastRun: db.prepare('SELECT trigger, started_at, matched, created, throttled, errors FROM alr_rule_runs WHERE company_id = ? AND rule_code = ? ORDER BY id DESC LIMIT 1').get(actor.companyId, r.code) ?? null }));
      const adopted = new Set(own.map((r) => r.code));
      const library = db.prepare("SELECT * FROM alr_rules WHERE company_id IS NULL AND status = 'LIBRARY' ORDER BY owner_module, code").all().map((r) => ({ ...present(r), adopted: adopted.has(r.code) }));
      return { rows: own, library, canEdit: may(actor, 'alr.rule.edit') };
    },
    get(actor, code) {
      need(actor, 'alr.rule.view', 'see the alert rules');
      const rows = latest(actor.companyId, code);
      if (!rows.length) throw notFound('That rule does not exist.');
      const active = rows.find((r) => r.status === 'ACTIVE');
      const pending = rows.find((r) => r.status === 'PENDING');
      return {
        active: active ? present(active) : null, pending: pending ? present(pending) : null,
        runs: db.prepare('SELECT * FROM alr_rule_runs WHERE company_id = ? AND rule_code = ? ORDER BY id DESC LIMIT 20').all(actor.companyId, code).map(runRow),
        versions: db.prepare('SELECT rule_version, status, created_by, created_at, reason FROM alr_rules WHERE company_id = ? AND code = ? ORDER BY rule_version DESC').all(actor.companyId, code).map((v) => ({ version: v.rule_version, status: v.status, by: v.created_by, at: v.created_at, reason: v.reason })),
      };
    },
    builder(actor) {
      need(actor, 'alr.rule.view', 'see the alert rules');
      const events = eventTypes.list().map((e) => ({ type: e.type, description: e.description, owner: e.owner }));
      return { datasets: alertDatasets.list().map(dsView), events, ops: OPS, actions: ACTION_TYPES, roles: [...ROLE_CODES].sort(), canEdit: may(actor, 'alr.rule.edit'),
        connectors: db.prepare("SELECT code, name, type FROM core_connectors WHERE company_id = ? AND is_active = 1 AND deleted_at IS NULL ORDER BY code").all(actor.companyId) };
    },
    /** A new rule or a new version of a rule. One that sends something outside waits for the process owner and the system administrator. */
    propose(actor, b) {
      need(actor, 'alr.rule.edit', 'change the alert rules');
      const input = { ...b, ownerRole: b.ownerRole ?? 'SYSADM' };
      const ds = input.triggerType === 'SCHEDULE' ? alertDatasets.get(input.dataset) : null;
      const problems = checkRule(input, { knownFields: ds ? ds.fields.map((f) => f.key) : null, roles: ROLE_CODES });
      if (!ROLE_CODES.has(input.ownerRole)) problems.push({ field: 'ownerRole', message: `${input.ownerRole} is not a role of the catalogue.` });
      for (const [i, a] of input.actions.entries()) if (a.type === 'webhook' && !db.prepare("SELECT 1 FROM core_connectors WHERE company_id = ? AND code = ? AND is_active = 1 AND deleted_at IS NULL").get(actor.companyId, a.connector)) problems.push({ field: `actions.${i}.connector`, message: `There is no connector "${a.connector}". Set it up under Connectors first.` });
      if (problems.length) throw badRequest('The rule is not valid.', problems);
      if (input.enabled) core.requireDataset(input);
      const external = isExternal(input.actions);
      return transaction(db, () => {
        const old = latest(actor.companyId, input.code);
        if (old.some((r) => r.status === 'PENDING')) throw conflict('A change of this rule is already waiting for approval. It must be decided first.');
        const current = old.find((r) => r.status === 'ACTIVE');
        if (b.version !== undefined && current && b.version !== current.rule_version) throw conflict('The rule was changed by someone else. Refresh it and try again.');
        const version = (db.prepare('SELECT MAX(rule_version) AS v FROM alr_rules WHERE company_id = ? AND code = ?').get(actor.companyId, input.code).v ?? 0) + 1;
        const res = db.prepare(`INSERT INTO alr_rules (company_id, code, name, description, trigger_type, event_type, schedule, dataset, condition_json, actions_json, message_template, throttle_minutes, severity, owner_module, owner_role, external, enabled, rule_version, status, reason, created_by, source_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rule_builder')`)
          .run(actor.companyId, input.code, input.name, input.description ?? null, input.triggerType, input.eventType ?? null, input.schedule ?? null, input.dataset ?? null, JSON.stringify(input.condition ?? {}), JSON.stringify(input.actions), input.messageTemplate, input.throttleMinutes, input.severity, input.ownerModule, input.ownerRole, external ? 1 : 0, input.enabled ? 1 : 0, version, external ? 'PENDING' : 'ACTIVE', input.reason, actor.user);
        const id = Number(res.lastInsertRowid);
        writeAudit(db, { entity: 'alr_rules', entityId: input.code, action: external ? 'propose' : 'create', oldValues: current ? { version: current.rule_version } : undefined, newValues: { version, trigger: input.triggerType, severity: input.severity, enabled: input.enabled, external }, actor: actor.user, companyId: actor.companyId, reason: input.reason });
        if (!external) {
          if (current) db.prepare("UPDATE alr_rules SET status = 'RETIRED', enabled = 0, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), current.id);
          publishEvent(db, { type: 'alr.rule.changed', entity: 'alert_rule', entityId: input.code, actorId: actor.user, companyId: actor.companyId, data: { code: input.code, version } });
          return { code: input.code, version, status: 'ACTIVE', workflow: null };
        }
        const instance = engine.submit(actor, { docType: RULE_DOC, docId: id, comment: input.reason, context: {} });
        db.prepare('UPDATE alr_rules SET instance_id = ? WHERE id = ?').run(instance.id, id);
        return { code: input.code, version, status: 'PENDING', workflow: instance };
      });
    },
    /** Take a rule of the library into the company. */
    adopt(actor, code, { enabled = true, reason }) {
      need(actor, 'alr.rule.edit', 'change the alert rules');
      const lib = db.prepare("SELECT * FROM alr_rules WHERE company_id IS NULL AND code = ? AND status = 'LIBRARY'").get(code);
      if (!lib) throw notFound('That rule is not in the library.');
      if (latest(actor.companyId, code).length) throw conflict('This company already has that rule.');
      const r = core.ruleOf(lib);
      return rules.propose(actor, { code, name: r.name, description: r.description, triggerType: r.triggerType, eventType: r.eventType, schedule: r.schedule, dataset: r.dataset, condition: r.condition, actions: r.actions, messageTemplate: r.messageTemplate, throttleMinutes: r.throttleMinutes, severity: r.severity, ownerModule: r.ownerModule, ownerRole: r.ownerRole, enabled: enabled && (r.triggerType === 'EVENT' || Boolean(alertDatasets.get(r.dataset))), reason });
    },
    setEnabled(actor, code, enabled, reason) {
      need(actor, 'alr.rule.edit', 'change the alert rules');
      const r = db.prepare("SELECT * FROM alr_rules WHERE company_id = ? AND code = ? AND status = 'ACTIVE' AND is_active = 1").get(actor.companyId, code);
      if (!r) throw notFound('That rule is not in force. A rule waiting for approval cannot be switched on or off.');
      if (enabled) core.requireDataset(core.ruleOf(r));
      return transaction(db, () => {
        db.prepare('UPDATE alr_rules SET enabled = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(enabled ? 1 : 0, actor.user, iso(), r.id);
        writeAudit(db, { entity: 'alr_rules', entityId: code, action: enabled ? 'enable' : 'disable', oldValues: { enabled: r.enabled === 1 }, newValues: { enabled }, reason, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'alr.rule.changed', entity: 'alert_rule', entityId: code, actorId: actor.user, companyId: actor.companyId, data: { code, enabled } }); // BR-02: the alerts it raised stay
        return rules.get(actor, code);
      });
    },
    dryRun(actor, code, draft = null) {
      need(actor, 'alr.rule.view', 'see the alert rules');
      let rule;
      if (draft) {
        const ds = draft.triggerType === 'SCHEDULE' ? alertDatasets.get(draft.dataset) : null;
        const problems = checkRule(draft, { knownFields: ds ? ds.fields.map((f) => f.key) : null, roles: ROLE_CODES });
        if (problems.length) throw badRequest('The rule is not valid.', problems);
        rule = { ...draft, companyId: actor.companyId, id: 0, version: 0, ownerRole: draft.ownerRole ?? 'SYSADM', ownerModule: draft.ownerModule ?? 'custom', condition: draft.condition ?? {} };
      } else {
        const r = latest(actor.companyId, code)[0];
        if (!r) throw notFound('That rule does not exist.');
        rule = core.ruleOf(r);
      }
      const out = core.dryRun(rule);
      writeAudit(db, { entity: 'alr_rules', entityId: rule.code ?? 'draft', action: 'dry_run', newValues: { matched: out.matched, wouldCreate: out.wouldCreate }, actor: actor.user, companyId: actor.companyId });
      return out;
    },
    run(actor, code) {
      need(actor, 'alr.rule.edit', 'run an alert rule');
      const r = db.prepare("SELECT * FROM alr_rules WHERE company_id = ? AND code = ? AND status = 'ACTIVE' AND is_active = 1").get(actor.companyId, code);
      if (!r) throw notFound('That rule is not in force.');
      const rule = core.ruleOf(r);
      if (!rule.enabled) throw unprocessable('This rule is switched off. Switch it on to run it.');
      core.requireDataset(rule);
      const out = core.run(rule, 'manual');
      writeAudit(db, { entity: 'alr_rules', entityId: code, action: 'run', newValues: { matched: out.matched, created: out.created }, actor: actor.user, companyId: actor.companyId });
      return { matched: out.matched, created: out.created, repeated: out.repeated, throttled: out.throttled, actions: out.actions, errors: out.errors, error: out.errorText };
    },
    runs(actor, q = {}) {
      need(actor, 'alr.rule.view', 'see the alert rules');
      const where = ['company_id = :c', 'is_active = 1'];
      const p = { c: actor.companyId, limit: q.limit ?? 25, offset: q.offset ?? 0 };
      if (q.code) { where.push('rule_code = :code'); p.code = q.code; }
      if (q.onlyErrors) where.push('errors > 0');
      const total = db.prepare(`SELECT COUNT(*) AS n FROM alr_rule_runs WHERE ${where.join(' AND ')}`).get(Object.fromEntries(Object.entries(p).filter(([k]) => !['limit', 'offset'].includes(k)))).n;
      return { rows: db.prepare(`SELECT * FROM alr_rule_runs WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT :limit OFFSET :offset`).all(p).map(runRow), total };
    },
  };
  const runRow = (r) => ({ id: r.id, code: r.rule_code, version: r.rule_version, trigger: r.trigger, startedAt: r.started_at, matched: r.matched, created: r.created, throttled: r.throttled, actions: r.actions_done, errors: r.errors, error: r.error_text, durationMs: r.duration_ms });

  // ---- the alerts ----
  const mineSql = "(a.owner_user_ref = :me OR EXISTS (SELECT 1 FROM json_each(a.recipients_json) j WHERE j.value = :me))";
  const projectSql = (actor) => authz.scopeFilter(actor, 'alr.alert.view', { project: 'a.project_id', site: 'a.site_id' }).sql;
  const visible = (actor, p) => { p.me = actor.user; return `(${mineSql} OR ${projectSql(actor)})`; };
  const alertRow = (a) => ({ id: a.id, ruleCode: a.rule_code, entity: a.entity, entityId: a.entity_id, label: a.entity_label, route: a.route, severity: a.severity, message: a.message, status: a.status, owner: a.owner_user_ref, occurrences: a.occurrences, firstSeenAt: a.first_seen_at, lastSeenAt: a.last_seen_at, acknowledgedAt: a.acknowledged_at, acknowledgedBy: a.acknowledged_by, resolvedAt: a.resolved_at, resolvedBy: a.resolved_by, resolution: a.resolution, escalatedAt: a.escalated_at, projectId: a.project_id, version: a.version, deliveries: JSON.parse(a.deliveries_json || '[]') });
  const load = (actor, id) => {
    const p = {};
    const a = db.prepare(`SELECT a.* FROM alr_alerts a WHERE a.id = :id AND a.company_id = :c AND ${visible(actor, p)}`).get({ id, c: actor.companyId, ...p });
    if (!a) throw notFound('That alert does not exist.');
    return a;
  };
  const mayAct = (actor, a) => a.owner_user_ref === actor.user || JSON.parse(a.recipients_json || '[]').includes(actor.user) || may(actor, 'alr.alert.manage', { companyId: actor.companyId, projectId: a.project_id, siteId: a.site_id });
  const alerts = {
    list(actor, q = {}) {
      const p = {};
      const where = ['a.company_id = :c', 'a.is_active = 1', visible(actor, p)];
      p.c = actor.companyId;
      if (q.view === 'mine') where.push(mineSql);
      else if (q.view === 'project') { if (!may(actor, 'alr.alert.view')) throw forbidden('You may not see the alerts of your projects (permission alr.alert.view).'); where.push(projectSql(actor)); }
      if (q.status === 'open') where.push("a.status != 'RESOLVED'");
      else if (q.status) { where.push('a.status = :status'); p.status = q.status; }
      for (const [k, col] of [['severity', 'severity'], ['rule', 'rule_code'], ['projectId', 'project_id'], ['entity', 'entity'], ['entityId', 'entity_id']]) if (q[k] !== undefined && q[k] !== '') { where.push(`a.${col} = :${k}`); p[k] = q[k]; }
      if (q.q) { where.push('(a.message LIKE :q OR a.entity_label LIKE :q OR a.rule_code LIKE :q)'); p.q = `%${q.q}%`; }
      const order = "CASE a.severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END, CASE a.status WHEN 'OPEN' THEN 0 WHEN 'ACKNOWLEDGED' THEN 1 ELSE 2 END, a.first_seen_at";
      const total = db.prepare(`SELECT COUNT(*) AS n FROM alr_alerts a WHERE ${where.join(' AND ')}`).get(p).n;
      const rows = db.prepare(`SELECT a.* FROM alr_alerts a WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT :limit OFFSET :offset`).all({ ...p, limit: q.limit ?? 25, offset: q.offset ?? 0 }).map((a) => ({ ...alertRow(a), canAct: mayAct(actor, a) }));
      return { rows, total };
    },
    summary(actor) {
      const p = { me: actor.user, c: actor.companyId };
      const n = (extra) => db.prepare(`SELECT COUNT(*) AS n FROM alr_alerts a WHERE a.company_id = :c AND a.is_active = 1 AND a.status != 'RESOLVED' AND ${mineSql} ${extra}`).get(p).n;
      return { mine: n(''), mineCritical: n("AND a.severity = 'CRITICAL'"), mineNew: n("AND a.status = 'OPEN'"), canViewProject: may(actor, 'alr.alert.view') };
    },
    get(actor, id) { const a = load(actor, id); return { ...alertRow(a), canAct: mayAct(actor, a), rule: db.prepare("SELECT code, name, severity, throttle_minutes FROM alr_rules WHERE company_id = ? AND code = ? ORDER BY rule_version DESC LIMIT 1").get(actor.companyId, a.rule_code) ?? null }; },
    act(actor, id, action, note) {
      return transaction(db, () => {
        const a = load(actor, id);
        if (!mayAct(actor, a)) throw forbidden('Only the owner of the alert, those it was sent to, or someone who manages the alerts of the project may do that.');
        if (a.status === 'RESOLVED') throw conflict('This alert is already resolved.');
        const stamp = iso();
        if (action === 'ack') {
          if (a.status === 'ACKNOWLEDGED') throw conflict('This alert is already acknowledged.');
          db.prepare("UPDATE alr_alerts SET status = 'ACKNOWLEDGED', acknowledged_at = ?, acknowledged_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(stamp, actor.user, actor.user, stamp, id);
        } else {
          if (!note || note.trim().length < 3) throw badRequest('Say what was done about it.', [{ field: 'resolution', message: 'Write the resolution (at least 3 characters).' }]);
          db.prepare("UPDATE alr_alerts SET status = 'RESOLVED', resolved_at = ?, resolved_by = ?, resolution = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(stamp, actor.user, note.trim(), actor.user, stamp, id);
        }
        writeAudit(db, { entity: 'alr_alerts', entityId: id, action: action === 'ack' ? 'acknowledge' : 'resolve', oldValues: { status: a.status }, newValues: { status: action === 'ack' ? 'ACKNOWLEDGED' : 'RESOLVED' }, reason: note ?? undefined, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: action === 'ack' ? 'alr.alert.acknowledged' : 'alr.alert.resolved', entity: 'alert', entityId: String(id), actorId: actor.user, companyId: actor.companyId, projectId: a.project_id, data: { rule: a.rule_code } });
        return alerts.get(actor, id);
      });
    },
    bulk(actor, { ids, action, note }) {
      const out = { done: [], failed: [] };
      for (const id of ids) {
        try { alerts.act(actor, id, action, note); out.done.push(id); } catch (e) { out.failed.push({ id, message: e.message }); }
      }
      return out;
    },
  };
  return { rules, alerts, core };
}
