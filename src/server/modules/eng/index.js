import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { toCsv, toXlsx } from '../../platform/export/index.js';
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
import { sampleDocRoutes, workflowRoutes } from './routes.js';
import { createDelegationService, createLimitService, createPathService, createSlaService } from './controls.js';
import { createMatrixService } from './matrix.js';
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

const todayIST = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** Module "eng": the shared business engines. Part 04.01 is the workflow engine. */
export const eng = {
  code: 'eng',
  name: 'Shared Business Engines',
  routePrefix: '/api/v1/workflow',
  ownerPart: '04.x',
  status: 'Workflow engine core: definitions, instances, states and tasks (04.01)',
  tables: ['wf_matrix', 'wf_matrix_rules', 'wf_authority_limits', 'wf_delegations', 'wf_escalation_paths', 'wf_sla_settings', 'wf_definitions', 'wf_instances', 'wf_tasks', 'wf_task_attachments', 'wf_history', 'wf_watchers', 'eng_sample_docs'],
  resources: ['submit', 'tasks', 'instances', 'documents', 'monitor', 'definitions', 'doc-types', 'sample-docs'],

  mount(api, { db, config }) {
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
    const sla = createSlaService({ db, engine, paths });
    const delegations = createDelegationService({ db, engine, limits });
    const matrix = createMatrixService({ db, engine, limits, paths });
    const on = (companyId) => flags.isOn({ companyId }, 'ff.eng.p0402');
    engine.configure({
      chain: (c) => (on(c.companyId) ? matrix.resolve(c) : null),
      sla: (c) => (on(c.companyId) ? sla.forTask(c) : null),
      delegation: { activeFor: (c) => (on(c.companyId) ? delegations.activeFor(c) : []), forUser: (c) => (on(c.companyId) ? delegations.forUser(c) : null) },
      escalation: { next: (c) => (on(c.companyId) ? paths.next(c) : null) },
    });
    const docs = createSampleDocService({ db, engine });
    const runtime = runtimeOf(db);
    runtime.jobs.register('eng.workflow_sla', (ctx) => { const r = engine.sweepSla(); ctx.log(`Reminded ${r.reminded}, escalated ${r.escalated}`); return r; }, { maxAttempts: 1, description: 'Sends reminders for tasks past their due time and escalates the ones long overdue.' });
    runtime.scheduler.define({ code: 'eng.workflow_sla_15min', cron: '*/15 * * * *', jobType: 'eng.workflow_sla', description: 'Every 15 minutes: reminders and escalations of overdue workflow tasks' });

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
    wf.use(workflowRoutes({ engine, definitions, monitorFile, matrix, limits, delegations, paths, sla }, idem));
    api.use('/workflow', wf);
    const sample = Router();
    sample.use(gate('ff.eng.p0401', 'The workflow engine is'));
    sample.use(sampleDocRoutes({ docs }, idem));
    api.use('/eng', sample);
  },
};
