import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { FORMATS, toCsv, toXlsx, writeExport } from '../../platform/export/index.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { workSources } from '../../platform/widgets/index.js';
import { createDefinitionService, createLegacyAdapter, workflowOf } from '../../platform/workflow/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { createFlagService } from '../core/api.js';
import { createSampleDocService } from './sample-docs.js';
import { accountabilityRoutes, approvalLinkRoutes, protocolRoutes, sampleDocRoutes, workflowRoutes } from './routes.js';
import { createProtocolService } from './protocol.js';
import { createAccountabilityService } from './accountability.js';
import { createDelegationService, createLimitService, createPathService, createSlaService } from './controls.js';
import { createMatrixService } from './matrix.js';
import { createInboxService } from './inbox.js';
import { defineList } from '../../platform/list/index.js';
import { widgetRegistry } from '../../platform/widgets/index.js';
import './changes.js';

// Part 04.01: the events of the workflow engine. A module that submits a document hears the outcome from its hooks (same transaction) and the rest of
// the system from these.
/** @type {any} */
const instanceSchema = { type: 'object', properties: { instanceId: { type: 'integer' }, docType: { type: 'string' }, docId: { type: 'string' } }, required: ['instanceId', 'docType', 'docId'] };
/** @type {any} */
const taskSchema = { type: 'object', properties: { instanceId: { type: 'integer' }, docType: { type: 'string' }, docId: { type: 'string' }, taskId: { type: 'integer' } }, required: ['instanceId', 'docType', 'docId', 'taskId'] };
/** @type {any} */
const notifySchema = { type: 'object', properties: { instanceId: { type: 'integer' }, docType: { type: 'string' }, docId: { type: 'string' }, template: { type: 'string' }, recipients: { type: 'array', items: { type: 'string' } } }, required: ['instanceId', 'template', 'recipients'] };
for (const [verb, description] of [
  ['submitted', 'A document was submitted into approval; the instance runs the definition version it started with.'],
  ['approved', 'A document was approved at its last step; the module that owns it sets its status and locks it.'],
  ['rejected', 'A document was rejected, with a reason.'],
  ['returned', 'A document was returned to its originator or to an earlier step, with a reason.'],
  ['resubmitted', 'A returned document went back into approval; the earlier decisions stay in its history.'],
  ['cancelled', 'An approval was cancelled by an authorised role, with a reason.'],
  ['withdrawn', 'The originator withdrew a document before anyone acted on it.'],
]) eventTypes.define({ type: `workflow.instance.${verb}`, version: 1, schema: instanceSchema, owner: 'eng', description });
for (const [verb, description] of [
  ['created', 'A task was made for an approver (a person or a role).'],
  ['completed', 'An approver approved, rejected or returned a task.'],
  ['delegated', 'An approver handed a task to someone else.'],
  ['unassigned', 'No eligible approver was found for a step; the task waits in the workflow administrators\' queue (it is never approved on its own).'],
  ['clarification_requested', 'An approver asked the originator a question; the task stays open.'],
  ['clarification_answered', 'The originator answered the question on a task.'],
  ['reminder', 'A task passed its due time.'],
  ['escalated', 'A task stayed open long after its due time and was escalated to the workflow administrators.'],
]) eventTypes.define({ type: `workflow.task.${verb}`, version: 1, schema: taskSchema, owner: 'eng', description });
eventTypes.define({ type: 'workflow.notification.requested', version: 1, schema: notifySchema, owner: 'eng', description: 'The workflow asks for people or roles to be told something; the notification service (04.06) delivers it.' });
/** @type {any} */
const definitionSchema = { type: 'object', properties: { docType: { type: 'string' }, version: { type: 'integer' } }, required: ['docType', 'version'] };
eventTypes.define({ type: 'workflow.definition.activated', version: 1, schema: definitionSchema, owner: 'eng', description: 'A new version of a workflow definition became the active one after its approval chain approved it.' });
/** @type {any} */
const sampleSchema = { type: 'object', properties: { docNo: { type: 'string' }, status: { type: 'string' } }, required: ['docNo', 'status'] };
for (const [verb, description] of [['created', 'A sample document was saved as a draft.'], ['approved', 'A sample document was approved and locked.'], ['rejected', 'A sample document was rejected.'], ['returned', 'A sample document was returned to its originator.'], ['cancelled', 'A sample document\'s approval was cancelled.']]) {
  eventTypes.define({ type: `eng.sample_doc.${verb}`, version: 1, schema: sampleSchema, owner: 'eng', description });
}
parameterRegistry.define({ key: 'eng.workflow.default_sla_hours', dataType: 'integer', default: 48, min: 1, max: 2160, scopes: ['system', 'company'], description: 'Hours an approver has for a step whose definition gives no time of its own, before the task shows as overdue and a reminder goes out.' });
parameterRegistry.define({ key: 'eng.workflow.escalation_hours', dataType: 'integer', default: 24, min: 1, max: 720, scopes: ['system', 'company'], description: 'Hours after a task is overdue before it is escalated to the workflow administrators.' });
integrityRegistry.register({
  uniqueKeys: [{ table: 'eng_sample_docs', columns: ['company_id', 'doc_no'] }, { table: 'wf_definitions', columns: ['company_id', 'doc_type', 'version'] }, { table: 'wf_watchers', columns: ['instance_id', 'user_ref'] }],
  statuses: {
    wf_definitions: ['DRAFT', 'PENDING', 'ACTIVE', 'RETIRED', 'REJECTED'],
    wf_instances: ['RUNNING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED', 'WITHDRAWN'],
    wf_tasks: ['OPEN', 'DONE', 'SKIPPED', 'CANCELLED', 'ADMIN_QUEUE'],
    eng_sample_docs: ['DRAFT', 'IN_APPROVAL', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED'],
  },
});

// "My work": the tasks of the engine join the ones of every other part (part 03.07).
workSources.register({
  code: 'workflow.tasks',
  kind: 'task',
  label: 'Approvals',
  list: (db, actor) => {
    const engine = workflowOf(db);
    if (!actor.companyId) return [];
    return engine.listTasks(actor, { mine: 'assigned', limit: 50 }).rows.map((t) => ({
      id: `wf-${t.id}`, title: `${t.instance.docLabel} ${t.instance.docRef ?? t.instance.docId}: ${t.step}`, due: t.dueAt, route: `/workflow/instance?id=${t.instance.id}`,
    }));
  },
});

// the files an approver adds to a task (a note, a site photo, a signed copy) go through the file service like every other attachment
fileEntities.register({ entity: 'wf_task', label: 'Workflow task', resolve: (db, actor, id) => workflowOf(db).taskAccess(actor, id) });

// Part 04.02: the events of the matrix, limits, settings and delegations, and the parameters of the calendar and of long delegations.
/** @type {any} */
const changeSchema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['workflow.matrix.activated', 'A version of the approval matrix was approved and will route documents from its effective date.'],
  ['workflow.authority_limits.changed', 'A set of authority limits was approved and takes effect from its date.'],
  ['workflow.settings.changed', 'The escalation hierarchy or the SLA settings were changed after their approval chain approved them.'],
  ['workflow.delegation.activated', 'A delegation of more than the allowed days was approved by the delegator\'s manager.'],
  ['workflow.delegation.created', 'A person delegated their approvals to another for a period.'],
  ['workflow.delegation.revoked', 'A delegation was ended before its time.'],
]) eventTypes.define({ type, version: 1, schema: changeSchema, owner: 'eng', description });
for (const [key, def, min, max, description] of [
  ['eng.workflow.working_day_start_hour', 9, 0, 23, 'The hour (IST) the working day of approvals starts; the time allowed for an approval counts only working hours.'],
  ['eng.workflow.working_day_end_hour', 18, 1, 24, 'The hour (IST) the working day of approvals ends.'],
  ['eng.delegation.approval_days', 15, 1, 365, 'A delegation longer than this many days needs the approval of the delegator\'s manager.'],
]) parameterRegistry.define({ key, dataType: 'integer', default: def, min, max, scopes: ['system', 'company'], description });
integrityRegistry.register({
  uniqueKeys: [{ table: 'wf_matrix', columns: ['company_id', 'doc_type', 'scope_type', 'scope_id', 'matrix_version'] }],
  statuses: { wf_matrix: ['DRAFT', 'PENDING', 'ACTIVE', 'RETIRED', 'REJECTED'], wf_authority_limits: ['PENDING', 'ACTIVE', 'RETIRED', 'REJECTED'], wf_delegations: ['PENDING', 'ACTIVE', 'REVOKED', 'REJECTED'], wf_escalation_paths: ['PENDING', 'ACTIVE', 'RETIRED', 'REJECTED'], wf_sla_settings: ['PENDING', 'ACTIVE', 'RETIRED', 'REJECTED'] },
});

// Part 04.03: the inbox's events and the list its saved views belong to.
for (const [type, description] of [
  ['workflow.bulk.approved', 'An approver approved several documents at once from the inbox; each was checked on its own.'],
  ['workflow.link.issued', 'A secure approval link was made for an approver\'s task (the token itself is never in the event).'],
  ['workflow.link.used', 'A task was decided from a secure link.'],
]) eventTypes.define({ type, version: 1, schema: changeSchema, owner: 'eng', description });
integrityRegistry.register({ statuses: { wf_approval_policies: ['PENDING', 'ACTIVE', 'RETIRED', 'REJECTED'], wf_link_tokens: ['ISSUED', 'USED', 'EXPIRED', 'REVOKED'] } });
// the inbox is served by its own query (what a person may decide depends on roles and delegations); this list gives it saved views, shared and personal
defineList({
  code: 'workflow.inbox', label: 'My Approvals', from: 'wf_tasks t', defaultSort: 'urgency',
  columns: {
    docType: { sql: 't.step_code', type: 'text', label: 'Document type' }, projectId: { sql: 't.project_id', type: 'id', label: 'Project' }, sla: { sql: 't.status', type: 'enum', label: 'Time' },
    bulk: { sql: 't.kind', type: 'enum', label: 'Bulk approval' }, sort: { sql: 't.id', type: 'text', label: 'Order' },
  },
});

// Part 04.04: the Protocol & Control Engine's events, parameters and its place in the integrity checks.
for (const [type, description] of [
  ['pcs.exception.raised', 'An exception was sent into approval for an action a control point stopped.'],
  ['pcs.exception.approved', 'An exception was approved (or an emergency exception was regularised).'],
  ['pcs.exception.rejected', 'An exception was rejected; for an emergency exception that was already used, the action must be reversed or corrected.'],
  ['pcs.exception.escalated', 'An emergency exception was not regularised in time and climbed to the next level.'],
  ['pcs.control.changed', 'The mode or settings of a control point changed (for a control in ENFORCE, after its approval).'],
  ['pcs.control.created', 'A control point was defined.'],
  ['pcs.reason_code.changed', 'A reason code was added, changed or switched off for a company.'],
]) eventTypes.define({ type, version: 1, schema: changeSchema, owner: 'eng', description });
for (const [key, def, min, max, description] of [
  ['eng.pcs.observe_days', 14, 0, 365, 'BR-01: the days a control point must have been observed (mode OBSERVE) before it may be put into ENFORCE.'],
  ['eng.pcs.regularise_hours', 72, 1, 720, 'BR-02: the hours an emergency exception has to be approved (regularised) before it climbs to the next level.'],
  ['eng.pcs.pass_sample_percent', 10, 0, 100, 'The share of passing checks written to the check log (blocks, warnings and exceptions are always written).'],
  ['eng.pcs.exception_valid_days', 30, 1, 365, 'The days an approved exception can be used for its action before it lapses.'],
]) parameterRegistry.define({ key, dataType: 'integer', default: def, min, max, scopes: ['system', 'company'], description });
integrityRegistry.register({
  companyOptional: ['pcs_reason_codes'],
  uniqueKeys: [{ table: 'pcs_control_points', columns: ['company_id', 'code'] }, { table: 'pcs_exceptions', columns: ['company_id', 'exception_no'] }],
  statuses: { pcs_exceptions: ['DRAFT', 'PENDING', 'APPROVED', 'USED', 'REJECTED', 'RETURNED', 'CANCELLED'], pcs_control_changes: ['PENDING', 'ACTIVE', 'REJECTED'] },
});
defineList({
  code: 'pcs.exceptions', label: 'Exceptions Register', from: 'pcs_exceptions e', defaultSort: 'newest',
  columns: { status: { sql: 'e.status', type: 'enum', label: 'Status' }, control: { sql: 'e.control_code', type: 'text', label: 'Control' }, projectId: { sql: 'e.project_id', type: 'id', label: 'Project' }, minValue: { sql: 'e.value_at_risk', type: 'text', label: 'Value at least' }, sort: { sql: 'e.id', type: 'text', label: 'Order' } },
});

// Part 04.05: accountability and the action ledger.
for (const [type, description] of [
  ['acc.raci.proposed', 'A change of the RACI of a live project was sent for the approval of its project manager and project director.'],
  ['acc.raci.changed', 'A RACI change took effect (at once, or after its approval); the responsibility of the processes it names changed from its date.'],
]) eventTypes.define({ type, version: 1, schema: changeSchema, owner: 'eng', description });
integrityRegistry.register({
  technicalTables: ['acc_ledger_cursors'], companyOptional: ['acc_raci_templates'],
  statuses: { acc_raci_assignments: ['PENDING', 'ACTIVE', 'RETIRED', 'REJECTED'] },
});
defineList({
  code: 'acc.ledger', label: 'Action ledger', from: 'acc_action_ledger l', defaultSort: 'newest',
  columns: { action: { sql: 'l.action', type: 'enum', label: 'Action' }, entity: { sql: 'l.entity', type: 'text', label: 'Object' }, projectId: { sql: 'l.project_id', type: 'id', label: 'Project' }, sort: { sql: 'l.id', type: 'text', label: 'Order' } },
});

const todayIST = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** Module "eng": the shared business engines. Part 04.01 is the workflow engine. */
export const eng = {
  code: 'eng',
  name: 'Shared Business Engines',
  routePrefix: '/api/v1/workflow',
  ownerPart: '04.x',
  status: 'Workflow engine core: definitions, instances, states and tasks (04.01)',
  tables: ['acc_raci_templates', 'acc_raci_assignments', 'acc_action_ledger', 'pcs_control_points', 'pcs_check_results', 'pcs_exceptions', 'pcs_reason_codes', 'pcs_control_changes', 'pcs_cycle_stages', 'wf_approval_policies', 'wf_link_tokens', 'wf_matrix', 'wf_matrix_rules', 'wf_authority_limits', 'wf_delegations', 'wf_escalation_paths', 'wf_sla_settings', 'wf_definitions', 'wf_instances', 'wf_tasks', 'wf_task_attachments', 'wf_history', 'wf_watchers', 'eng_sample_docs'],
  companyOptional: ['pcs_reason_codes', 'acc_raci_templates'],
  resources: ['submit', 'tasks', 'instances', 'documents', 'monitor', 'definitions', 'doc-types', 'sample-docs'],

  mount(api, { db, config, publicApi }) {
    // a database that has not been migrated this far (the contract recording of part 01.x) has no engine to mount
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'wf_definitions'").get()) return;
    const flags = createFlagService({ db, environment: config.environment });
    const gate = (key, what) => (req, _res, next) => (flags.isOn(req.actor, key) ? next() : next(notFound(`${what} not enabled for your company yet (feature flag ${key} is OFF).`)));
    const engine = workflowOf(db);
    createLegacyAdapter({ db, engine, flags });
    const definitions = createDefinitionService({ db, engine });
    // part 04.02: what routes a document, how long a task has, who stands in and who a late task climbs to
    const limits = createLimitService({ db, engine });
    const paths = createPathService({ db, engine });
    const sla = createSlaService({ db, engine });
    const delegations = createDelegationService({ db, engine, limits });
    const matrix = createMatrixService({ db, engine, limits, paths });
    const inbox = createInboxService({ db, engine, limits, matrixOptions: () => matrix.docTypes() });
    const on = (companyId) => flags.isOn({ companyId }, 'ff.eng.p0402');
    engine.configure({
      chain: (c) => (on(c.companyId) ? matrix.resolve(c) : null),
      sla: (c) => (on(c.companyId) ? sla.forTask(c) : null),
      delegation: { activeFor: (c) => (on(c.companyId) ? delegations.activeFor(c) : []), forUser: (c) => (on(c.companyId) ? delegations.forUser(c) : null) },
      escalation: { next: (c) => (on(c.companyId) ? paths.next(c) : null) },
    });
    const controlsOn = (companyId) => flags.isOn({ companyId }, 'ff.eng.p0404');
    const docs = createSampleDocService({ db, engine, controlsOn });
    const protocolService = createProtocolService({ db, engine });
    const runtime = runtimeOf(db);
    runtime.jobs.register('eng.workflow_sla', (ctx) => { const r = engine.sweepSla(); ctx.log(`Reminded ${r.reminded}, escalated ${r.escalated}`); return r; }, { maxAttempts: 1, description: 'Sends reminders for tasks past their due time and escalates the ones long overdue.' });
    runtime.scheduler.define({ code: 'eng.workflow_sla_15min', cron: '*/15 * * * *', jobType: 'eng.workflow_sla', description: 'Every 15 minutes: reminders and escalations of overdue workflow tasks' });

    runtime.jobs.register('eng.pcs_emergency', (ctx) => { const r = protocolService.exceptions.sweepEmergencies(); ctx.log(`Escalated ${r.escalated} emergency exception(s)`); return r; }, { maxAttempts: 1, description: 'Escalates emergency exceptions that were not regularised within their window.' });
    runtime.scheduler.define({ code: 'eng.pcs_emergency_15min', cron: '*/15 * * * *', jobType: 'eng.pcs_emergency', description: 'Every 15 minutes: emergency exceptions past their time to be regularised climb to the next level' });
    const exceptionsFile = (actor, q) => {
      const list = protocolService.exceptions.list(actor, { ...q, limit: 100, offset: 0, sort: 'newest' });
      const rows = list.rows.map((e) => ({ no: e.no, control: e.control, entity: e.entityRef ?? `${e.entity} ${e.entityId}`, reason: e.reasonCode, value: Number(e.valueAtRisk), status: e.status, emergency: e.emergency ? 'Yes' : 'No', raisedBy: e.raisedBy, raised: e.createdAt.slice(0, 10), ageDays: e.ageDays }));
      const columns = [['no', 'Exception'], ['control', 'Control'], ['entity', 'For'], ['reason', 'Reason'], ['value', 'Value at risk (INR)'], ['status', 'Status'], ['emergency', 'Emergency'], ['raisedBy', 'Raised by'], ['raised', 'Raised on'], ['ageDays', 'Age (days)']].map(([key, label]) => ({ key, label }));
      writeAudit(db, { entity: 'pcs_exceptions', entityId: 'register', action: 'export', newValues: { rows: rows.length, format: q.format }, actor: actor.user, companyId: actor.companyId });
      const footer = [`Exceptions register. Generated by ${actor.user} on ${todayIST()}.${q.status || q.control ? ` Filters: ${[q.status, q.control].filter(Boolean).join(', ')}.` : ''}`];
      const out = writeExport(q.format, { columns, rows, footer, sheetName: 'Exceptions', title: 'Exceptions register' });
      return { buffer: out, type: FORMATS[q.format], fileName: `exceptions-${todayIST()}.${q.format}` };
    };
    const accService = createAccountabilityService({ db, engine });
    runtime.jobs.register('eng.ledger_sync', (ctx) => { const n = accService.sync(); ctx.log(`Wrote ${n} ledger entr${n === 1 ? 'y' : 'ies'}`); return { written: n }; }, { maxAttempts: 2, description: 'Reads the events and the audit trail from where the ledger stopped and writes the action ledger.' });
    runtime.scheduler.define({ code: 'eng.ledger_sync_5min', cron: '*/5 * * * *', jobType: 'eng.ledger_sync', description: 'Every 5 minutes: the action ledger catches up with the workflow, the modules and the audit trail' });
    const scoresFile = (actor, q) => {
      const out = accService.scores.list(actor, q);
      const rows = out.rows.map((r) => ({ who: r.label, actions: r.actions, onTime: r.onTime, late: r.late, onTimePct: r.onTimePct ?? '', exceptions: r.exceptionsRaised, returns: r.returnsReceived, rejects: r.rejectsReceived, overdue: r.overdueOpen, score: r.score }));
      const columns = [['who', { person: 'Person', role: 'Role', project: 'Project' }[q.by]], ['actions', 'Actions'], ['onTime', 'On time'], ['late', 'Late'], ['onTimePct', 'On time %'], ['exceptions', 'Exceptions raised'], ['returns', 'Returns received'], ['rejects', 'Rejections received'], ['overdue', 'Open and overdue'], ['score', 'Score']].map(([key, label]) => ({ key, label }));
      writeAudit(db, { entity: 'acc_action_ledger', entityId: 'scores', action: 'export', newValues: { rows: rows.length, by: q.by, format: q.format }, actor: actor.user, companyId: actor.companyId });
      const footer = [`Accountability report by ${q.by}. Generated by ${actor.user} on ${todayIST()}. ${out.note}`];
      return { buffer: writeExport(q.format, { columns, rows, footer, sheetName: 'Accountability', title: 'Accountability report' }), type: FORMATS[q.format], fileName: `accountability-${q.by}-${todayIST()}.${q.format}` };
    };
    const monitorFile = (actor, q) => {
      const m = engine.monitor(actor, q);
      const rows = m.byType.map((r) => ({ type: r.label, running: r.running, stuck: r.stuck, overdue: r.overdue, approved: r.approved, rejected: r.rejected, returned: r.returned, cancelled: r.cancelled, avg: r.avgCycleHours ?? '' }));
      const columns = [['type', 'Document type'], ['running', 'Running'], ['stuck', 'Waiting for an administrator'], ['overdue', 'Overdue'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['returned', 'Returned'], ['cancelled', 'Cancelled or withdrawn'], ['avg', 'Average hours to approve']].map(([key, label]) => ({ key, label }));
      writeAudit(db, { entity: 'wf_instances', entityId: 'monitor', action: 'export', newValues: { rows: rows.length, format: q.format }, actor: actor.user, companyId: actor.companyId });
      const footer = [`Workflow monitor. Generated by ${actor.user} on ${todayIST()}.`];
      return q.format === 'csv' ? { buffer: toCsv({ columns, rows, footer }), type: 'text/csv; charset=utf-8', fileName: `workflow-monitor-${todayIST()}.csv` }
        : { buffer: toXlsx({ columns, rows, footer, sheetName: 'Monitor' }), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: `workflow-monitor-${todayIST()}.xlsx` };
    };
    const idem = { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) };
    const wf = Router();
    wf.use(gate('ff.eng.p0401', 'The workflow engine is'));
    wf.use(['/matrix', '/authority-limits', '/delegations', '/escalation-paths', '/sla-settings'], gate('ff.eng.p0402', 'The approval matrix is'));
    wf.use(['/inbox', '/approval-policies', '/links'], gate('ff.eng.p0403', 'The approval inbox is'));
    wf.use(workflowRoutes({ engine, definitions, monitorFile, matrix, limits, delegations, paths, sla, inbox }, idem));
    const acc = Router();
    acc.use(gate('ff.eng.p0405', 'Accountability is'));
    acc.use(accountabilityRoutes({ service: accService, exportFile: scoresFile }, idem));
    api.use('/acc', acc);
    try {
      widgetRegistry.register({ code: 'accountability.mine', provider: (ctx) => { const m = accService.me(ctx.actor); const n = m.overdue.length; return { value: n, unit: n === 1 ? 'item overdue' : 'items overdue', previous: null, trendPct: null, target: null, status: n > 0 ? 'red' : 'green', note: `Accountable for ${m.counts.accountable} process(es)${m.score.onTimePct == null ? '' : `; ${m.score.onTimePct} % on time`}.`, drill: '/accountability' }; } });
    } catch { /* registered once per process */ }
    const pcs = Router();
    pcs.use(gate('ff.eng.p0404', 'The Protocol & Control Engine is'));
    pcs.use(protocolRoutes({ service: protocolService, exportFile: exceptionsFile }, idem));
    api.use('/pcs', pcs);
    try {
      widgetRegistry.register({ code: 'controls.exceptions', provider: (ctx) => { const w = protocolService.widget(ctx.actor); return { value: w.value, unit: w.value === 1 ? 'exception' : 'exceptions', previous: null, trendPct: null, target: null, status: w.overdue > 0 ? 'red' : w.value > 0 ? 'amber' : 'green', note: w.overdue > 0 ? `${w.overdue} emergency exception(s) past the time to regularise.` : `${w.valueAtRisk} at risk.`, drill: '/controls/dashboard' }; } });
    } catch { /* registered once per process */ }
    publicApi.use(approvalLinkRoutes({ inbox, isOn: (companyId) => flags.isOn({ companyId }, 'ff.eng.p0403'), companyOfToken: (t) => inbox.companyOfToken(t) }));
    // the widget of the approvals waiting in the workflow engine (part 03.07 framework)
    try {
      widgetRegistry.register({ code: 'workflow.inbox', provider: (ctx) => { const c = inbox.counts(ctx.actor); return { value: c.pending, unit: c.pending === 1 ? 'document' : 'documents', previous: null, trendPct: null, target: null, status: c.pending === 0 ? 'green' : c.overdue > 0 ? 'red' : 'amber', note: c.overdue > 0 ? `${c.overdue} past their time.` : null, drill: '/approvals' }; } });
    } catch { /* registered once per process */ }
    api.use('/workflow', wf);
    const sample = Router();
    sample.use(gate('ff.eng.p0401', 'The workflow engine is'));
    sample.use(sampleDocRoutes({ docs }, idem));
    api.use('/eng', sample);
  },
};
