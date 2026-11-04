import express, { Router } from 'express';
import { join } from 'node:path';
import { createParameterStore } from '../../platform/parameters/index.js';
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
import { SAMPLE_DOC_TYPE, createSampleDocService } from './sample-docs.js';
import { excelRoutes, signatureRoutes, verifyPublicRoutes, documentRoutes, templateRoutes, templatePublicRoutes, alertRoutes, taskRoutes, communicationRoutes, notificationRoutes, accountabilityRoutes, approvalLinkRoutes, protocolRoutes, sampleDocRoutes, workflowRoutes } from './routes.js';
import { createProtocolService } from './protocol.js';
import { createAccountabilityService } from './accountability.js';
import { REALTIME_PATTERNS, createNotificationService, realtimeConsumer, registerRealtimeRecords, workflowNotificationConsumer } from './notifications.js';
import { createPushSender, registerDefaultGateways } from './notify-gateways.js';
import { createCommunicationService, deliveryReceiptConsumer, webhookConsumer } from './communication.js';
import { commOf } from '../../platform/comm/index.js';
import { tasksOf } from '../../platform/tasks/index.js';
import { createTaskService } from './tasks.js';
import { createAlertService } from './alerts.js';
import { bind as bindDocuments, createDocumentService } from './documents.js';
import { createDocumentOps } from './documents-ops.js';
import { createDocumentConfig } from './documents-config.js';
import { bind as bindExcel, createExcelService } from './excel.js';
import { bindAdapters } from './xl-adapters.js';
import { bind as bindSignatures, createSignatureService } from './signatures.js';
import { bind as bindTemplates, createTemplateService } from './templates.js';
import { createLocalStorage } from '../../platform/files/storage.js';
import { alertsOf } from '../../platform/alerts/index.js';
import { registerCommProviders } from '../../platform/comm/providers.js';
import { integrationsOf } from '../../platform/integrations/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { realtimeOf } from '../../platform/realtime/index.js';
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

// Part 04.06: notifications and the real-time layer.
eventTypes.define({ type: 'ntf.template.changed', version: 1, schema: changeSchema, owner: 'eng', description: 'A new version of the words of a notification template was approved and is now in force.' });
for (const [key, def, min, max, description] of [
  ['ntf.digest.daily_hour', 8, 0, 23, 'The hour (IST) at which a person who chose a daily digest gets it.'],
  ['ntf.delivery.max_attempts', 5, 1, 10, 'The attempts made to send a message on a channel before the delivery is marked as failed.'],
  ['ntf.realtime.retention_hours', 24, 1, 720, 'The hours the log of real-time events is kept for a screen that lost its connection to catch up from.'],
]) parameterRegistry.define({ key, dataType: 'integer', default: def, min, max, scopes: ['system', 'company'], description });
integrityRegistry.register({
  companyOptional: ['ntf_templates'],
  statuses: { ntf_templates: ['PENDING', 'ACTIVE', 'RETIRED', 'REJECTED'], ntf_deliveries: ['PENDING', 'DEFERRED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED'] },
});
defineList({
  code: 'ntf.notifications', label: 'Notifications', from: 'ntf_notifications n', defaultSort: 'newest',
  columns: { category: { sql: 'n.category', type: 'enum', label: 'Category' }, state: { sql: 'n.read_at', type: 'text', label: 'State' }, sort: { sql: 'n.id', type: 'text', label: 'Order' } },
});

// Part 04.07: the communication gateway.
for (const [type, description] of [
  ['comm.message.sent', 'The communication gateway handed a message to a provider (after the failover, if the first connector failed).'],
  ['comm.message.delivered', 'A provider reported a message delivered to the person\'s device or mailbox.'],
  ['comm.message.read', 'A provider reported a message read (WhatsApp).'],
  ['comm.message.failed', 'A message could not be sent or the provider reported that it failed.'],
  ['comm.message.received', 'A person replied by WhatsApp, text message or e-mail; the reply is linked to the record the conversation is about.'],
  ['comm.consent.changed', 'A person opted in or out of a channel (by a form, an administrator, an import or the STOP keyword).'],
  ['comm.channel.changed', 'The channel settings (connectors, failover, sender identity, DLT templates) were changed after their approval.'],
]) eventTypes.define({ type, version: 1, schema: changeSchema, owner: 'eng', description });
for (const [key, def, min, max, description] of [
  ['comm.max_attempts', 5, 1, 10, 'The rounds of sending a message (each round tries every connector of the channel) before it is marked failed.'],
  ['comm.otp.resend_seconds', 30, 0, 600, 'The seconds a person must wait before another one-time code is sent for the same purpose and address.'],
  ['comm.otp.max_per_hour', 5, 1, 100, 'The one-time codes sent to one address for one purpose in an hour.'],
  ['comm.otp.max_attempts', 5, 1, 10, 'BR-02: the wrong tries allowed on one code before it is locked.'],
  ['comm.retention_days', 365, 30, 3650, 'The days a message and its status are kept in the communication log (DPDP Act: no longer than the purpose needs).'],
]) parameterRegistry.define({ key, dataType: 'integer', default: def, min, max, scopes: ['system', 'company'], description });
integrityRegistry.register({
  uniqueKeys: [{ table: 'comm_consents', columns: ['company_id', 'address', 'channel'] }],
  statuses: { comm_consents: ['OPT_IN', 'OPT_OUT'], comm_messages: ['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'BLOCKED', 'RECEIVED', 'CANCELLED'], comm_channels: ['PENDING', 'ACTIVE', 'RETIRED', 'REJECTED'], comm_dlt_templates: ['PENDING', 'ACTIVE', 'RETIRED', 'REJECTED'], comm_otps: ['PENDING', 'VERIFIED', 'EXPIRED', 'LOCKED', 'REPLACED', 'UNDELIVERED'] },
});
defineList({
  code: 'comm.messages', label: 'Communication log', from: 'comm_messages m', defaultSort: 'newest',
  columns: { channel: { sql: 'm.channel', type: 'enum', label: 'Channel' }, status: { sql: 'm.status', type: 'enum', label: 'Status' }, entity: { sql: 'm.related_entity', type: 'text', label: 'Record' }, sort: { sql: 'm.id', type: 'text', label: 'Order' } },
});
defineList({
  code: 'comm.consents', label: 'Consent register', from: 'comm_consents c', defaultSort: 'newest',
  columns: { channel: { sql: 'c.channel', type: 'enum', label: 'Channel' }, status: { sql: 'c.status', type: 'enum', label: 'Status' }, sort: { sql: 'c.id', type: 'text', label: 'Order' } },
});

// Part 04.08: task management.
for (const [type, description] of [
  ['tsk.task.created', 'A task was made (by a person, a senior\'s instruction or another module).'],
  ['tsk.task.accepted', 'The person given a task accepted it.'],
  ['tsk.task.started', 'Work on a task began.'],
  ['tsk.task.blocked', 'A task was marked blocked, with the reason.'],
  ['tsk.task.completed', 'A task was finished by the person who did it (it may still need verification).'],
  ['tsk.task.verified', 'The person who gave a task checked and verified it.'],
  ['tsk.task.closed', 'A task was closed.'],
  ['tsk.task.reopened', 'A finished task was sent back with a reason.'],
  ['tsk.task.cancelled', 'A task was cancelled, with the reason.'],
  ['tsk.task.escalated', 'A late task climbed a level of the escalation path (it is an input to the performance review).'],
]) eventTypes.define({ type, version: 1, schema: changeSchema, owner: 'eng', description });
for (const [key, def, min, max, description] of [
  ['tsk.dependency_block', 1, 0, 1, 'BR-02: 1 stops a task from starting or completing before the tasks it depends on are done; 0 only warns.'],
  ['tsk.escalate_level1_days', 1, 1, 30, 'The days a task is overdue before it climbs to the next level of the escalation path.'],
  ['tsk.escalate_level2_days', 3, 1, 60, 'The days a task is overdue before it climbs to the top of the escalation path.'],
]) parameterRegistry.define({ key, dataType: 'integer', default: def, min, max, scopes: ['system', 'company'], description });
integrityRegistry.register({
  uniqueKeys: [{ table: 'tsk_tasks', columns: ['company_id', 'task_no'] }, { table: 'tsk_assignees', columns: ['task_id', 'user_ref', 'role'] }],
  statuses: { tsk_tasks: ['OPEN', 'ACCEPTED', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'VERIFIED', 'CLOSED', 'CANCELLED'], tsk_routing_matrix: ['PENDING', 'ACTIVE', 'RETIRED', 'REJECTED'] },
});
defineList({
  code: 'tsk.tasks', label: 'Tasks', from: 'tsk_tasks t', defaultSort: 'newest',
  columns: { status: { sql: 't.status', type: 'enum', label: 'Status' }, priority: { sql: 't.priority', type: 'enum', label: 'Priority' }, entity: { sql: 't.entity', type: 'text', label: 'Record' }, sort: { sql: 't.id', type: 'text', label: 'Order' } },
});
// "My work": the open tasks of a person join the approvals (part 03.07).
workSources.register({
  code: 'tsk.tasks',
  kind: 'task',
  label: 'Tasks',
  list: (db, actor) => {
    if (!actor.companyId) return [];
    return db.prepare("SELECT t.id, t.task_no, t.title, t.due_date FROM tsk_tasks t JOIN tsk_assignees a ON a.task_id = t.id AND a.role = 'ASSIGNEE' AND a.is_active = 1 WHERE t.company_id = ? AND a.user_ref = ? AND t.is_active = 1 AND t.status NOT IN ('DONE', 'VERIFIED', 'CLOSED', 'CANCELLED') ORDER BY t.due_date IS NULL, t.due_date, t.id LIMIT 50").all(actor.companyId, actor.user)
      .map((t) => ({ id: `tsk-${t.id}`, title: `${t.task_no} ${t.title}`, due: t.due_date, route: `/tasks/task?id=${t.id}` }));
  },
});

// Part 04.09: the automation and alert rules engine.
for (const [type, description] of [
  ['alr.alert.raised', 'A rule raised an alert for a record (not repeated within the rule\'s throttle window).'],
  ['alr.alert.acknowledged', 'A person acknowledged an alert.'],
  ['alr.alert.resolved', 'A person resolved an alert and wrote what was done.'],
  ['alr.rule.changed', 'An alert rule was created, changed (after its approval, if it sends messages outside), switched on or off.'],
  ['alr.flag.set', 'A rule flagged a record (the flag is for the module that owns the record to act on).'],
]) eventTypes.define({ type, version: 1, schema: changeSchema, owner: 'eng', description });
integrityRegistry.register({
  uniqueKeys: [], companyOptional: ['alr_rules'],
  statuses: { alr_rules: ['LIBRARY', 'PENDING', 'ACTIVE', 'RETIRED', 'REJECTED'], alr_alerts: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] },
});
defineList({
  code: 'alr.alerts', label: 'Alerts', from: 'alr_alerts a', defaultSort: 'newest',
  columns: { status: { sql: 'a.status', type: 'enum', label: 'Status' }, severity: { sql: 'a.severity', type: 'enum', label: 'Severity' }, rule: { sql: 'a.rule_code', type: 'text', label: 'Rule' }, sort: { sql: 'a.id', type: 'text', label: 'Order' } },
});
// "My work": the open alerts of a person join the tasks and approvals (part 03.07).
workSources.register({
  code: 'alr.alerts',
  kind: 'task',
  label: 'Alerts',
  list: (db, actor) => {
    if (!actor.companyId) return [];
    return db.prepare("SELECT a.id, a.message, a.route FROM alr_alerts a WHERE a.company_id = ? AND a.status = 'OPEN' AND a.is_active = 1 AND (a.owner_user_ref = ? OR EXISTS (SELECT 1 FROM json_each(a.recipients_json) j WHERE j.value = ?)) ORDER BY CASE a.severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END, a.id DESC LIMIT 20").all(actor.companyId, actor.user, actor.user)
      .map((a) => ({ id: `alr-${a.id}`, title: a.message.slice(0, 120), due: null, route: '/alerts' }));
  },
});

// Part 04.10: the document management service.
for (const [type, description] of [
  ['doc.document.created', 'A controlled document was registered (with a number and a first draft revision).'],
  ['doc.document.updated', 'The details of a document (title, type, discipline, confidentiality, validity ...) were changed.'],
  ['doc.document.checked_out', 'Someone checked a document out to work on it; nobody else may revise it meanwhile.'],
  ['doc.document.checked_in', 'A document was checked in (by the person, or by the document controller who forced it, with a reason).'],
  ['doc.document.revision_started', 'A new revision of an issued document was started.'],
  ['doc.document.issued', 'A revision was approved and is now the current one; the earlier revision is superseded.'],
  ['doc.document.superseded', 'A revision was replaced by a newer approved one; it stays readable with a watermark.'],
  ['doc.document.shared', 'A document was shared with a person, a role or an outside party.'],
  ['doc.document.distributed', 'A document was sent to people who must acknowledge it.'],
  ['doc.document.acknowledged', 'A recipient acknowledged a distributed revision.'],
  ['doc.document.archived', 'A document was archived and is read-only.'],
  ['doc.document.cancelled', 'A document that was never issued was cancelled.'],
  ['doc.document.expiring', 'A document with a validity date is within 30 days of its end.'],
  ['doc.document.expired', 'A document with a validity date has passed it.'],
  ['doc.config.changed', 'The document types or folder templates were changed after their approval.'],
]) eventTypes.define({ type, version: 1, schema: changeSchema, owner: 'eng', description });
integrityRegistry.register({
  uniqueKeys: [{ table: 'doc_documents', columns: ['company_id', 'doc_no'] }, { table: 'doc_versions', columns: ['document_id', 'revision_no'] }],
  companyOptional: ['tpl_templates', 'doc_types', 'doc_folder_templates'],
  statuses: { doc_documents: ['DRAFT', 'IN_REVIEW', 'ISSUED', 'ARCHIVED', 'CANCELLED'], doc_versions: ['DRAFT', 'IN_REVIEW', 'RETURNED', 'ISSUED', 'SUPERSEDED', 'REJECTED'], doc_types: ['PENDING', 'ACTIVE', 'RETIRED', 'REJECTED'], doc_folder_templates: ['PENDING', 'ACTIVE', 'RETIRED', 'REJECTED'] },
});
defineList({
  code: 'doc.documents', label: 'Documents', from: 'doc_documents d', defaultSort: 'newest',
  columns: { status: { sql: 'd.status', type: 'enum', label: 'Status' }, type: { sql: 'd.doc_type', type: 'enum', label: 'Type' }, confidentiality: { sql: 'd.confidentiality', type: 'enum', label: 'Confidentiality' }, sort: { sql: 'd.id', type: 'text', label: 'Order' } },
});
workSources.register({
  code: 'doc.acknowledge',
  kind: 'task',
  label: 'Documents to acknowledge',
  list: (db, actor) => {
    if (!actor.companyId) return [];
    return db.prepare("SELECT x.id, x.document_id, x.due_at, d.doc_no, d.title, v.revision FROM doc_distributions x JOIN doc_documents d ON d.id = x.document_id JOIN doc_versions v ON v.id = x.version_id WHERE x.company_id = ? AND x.recipient_type = 'USER' AND x.recipient_id = ? AND x.acknowledged_at IS NULL AND x.is_active = 1 ORDER BY x.due_at IS NULL, x.due_at LIMIT 20").all(actor.companyId, actor.user)
      .map((x) => ({ id: `doc-${x.id}`, title: `Acknowledge ${x.doc_no} rev ${x.revision}: ${x.title}`, due: x.due_at ? x.due_at.slice(0, 10) : null, route: `/documents/document?id=${x.document_id}` }));
  },
});

// Part 04.11: document templates, PDF generation, print and delivery.
for (const [type, description] of [
  ['tpl.template.activated', 'A document template version was approved by the process owner and is now the one used for official documents.'],
  ['tpl.record.published', 'The approved data of a document was handed to the generator.'],
  ['tpl.document.generated', 'An official document (PDF with a verification code) was generated; a new generation is a new version.'],
  ['tpl.document.delivered', 'A generated document was sent by e-mail, WhatsApp, message or portal.'],
  ['tpl.document.delivery_requested', 'A generated document was asked to be delivered by message or portal; the owning module takes it from here.'],
  ['tpl.bulk.completed', 'A bulk generation of documents finished.'],
]) eventTypes.define({ type, version: 1, schema: changeSchema, owner: 'eng', description });
integrityRegistry.register({
  uniqueKeys: [{ table: 'tpl_generated_docs', columns: ['company_id', 'doc_type', 'entity_id', 'version_no'] }, { table: 'tpl_records', columns: ['company_id', 'doc_no'] }],
  companyOptional: ['tpl_templates'],
  statuses: { tpl_templates: ['DRAFT', 'IN_REVIEW', 'ACTIVE', 'RETIRED', 'REJECTED'], tpl_deliveries: ['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'BLOCKED', 'PUBLISHED', 'DOWNLOADED'], tpl_bulk_jobs: ['QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED'] },
});
defineList({
  code: 'tpl.templates', label: 'Templates', from: 'tpl_templates t', defaultSort: 'newest',
  columns: { status: { sql: 't.status', type: 'enum', label: 'Status' }, type: { sql: 't.doc_type', type: 'enum', label: 'Document type' }, sort: { sql: 't.id', type: 'text', label: 'Order' } },
});
defineList({
  code: 'tpl.generated', label: 'Generated documents', from: 'tpl_generated_docs g', defaultSort: 'newest',
  columns: { type: { sql: 'g.doc_type', type: 'enum', label: 'Document type' }, purpose: { sql: 'g.purpose', type: 'enum', label: 'Purpose' }, sort: { sql: 'g.id', type: 'text', label: 'Order' } },
});

// Part 04.12: digital signature and QR verification.
for (const [type, description] of [
  ['sig.document.signed', 'A generated document was signed (electronic approval, signature image, eSign or DSC).'],
  ['sig.signature.revoked', 'A signature of a generated document was revoked; verification shows it.'],
  ['sig.document.cancelled', 'A generated document was cancelled; verification says so.'],
  ['sig.verification.failed', 'A file that was checked against a document by its QR code did not match: it is not what was issued.'],
]) eventTypes.define({ type, version: 1, schema: changeSchema, owner: 'eng', description });
integrityRegistry.register({
  uniqueKeys: [{ table: 'sig_verifications', columns: ['code'] }],
  statuses: { sig_signatures: ['SIGNED', 'REVOKED'], sig_verifications: ['ACTIVE', 'CANCELLED'], sig_config: ['PENDING', 'ACTIVE', 'RETIRED', 'REJECTED'] },
});
defineList({
  code: 'sig.signatures', label: 'Signatures', from: 'sig_signatures s', defaultSort: 'newest',
  columns: { method: { sql: 's.method', type: 'enum', label: 'Method' }, status: { sql: 's.status', type: 'enum', label: 'Status' }, sort: { sql: 's.id', type: 'text', label: 'Order' } },
});

// Part 04.13: the Excel import and export engine.
for (const [type, description] of [
  ['xl.job.uploaded', 'A filled import template was uploaded and queued for its check.'],
  ['xl.job.validated', 'An import file was checked; the preview and the row errors are ready.'],
  ['xl.job.committed', 'An import was committed: its records were created or updated through the module that owns them.'],
  ['xl.job.failed', 'A commit stopped on a row; nothing was saved (or, in chunked mode, the chunks before it were).'],
  ['xl.job.cancelled', 'An import job was cancelled before it was committed.'],
  ['xl.template.changed', 'An import template was changed after its approval.'],
]) eventTypes.define({ type, version: 1, schema: changeSchema, owner: 'eng', description });
integrityRegistry.register({
  companyOptional: [],
  statuses: { xl_jobs: ['UPLOADED', 'VALIDATING', 'FAILED', 'PREVIEW', 'COMMITTING', 'COMMITTED', 'PARTIAL', 'CANCELLED'], xl_templates: ['PENDING', 'ACTIVE', 'RETIRED', 'REJECTED'] },
});
defineList({
  code: 'xl.jobs', label: 'Import jobs', from: 'xl_jobs j', defaultSort: 'newest',
  columns: { status: { sql: 'j.status', type: 'enum', label: 'Status' }, type: { sql: 'j.import_type', type: 'enum', label: 'Import' }, sort: { sql: 'j.id', type: 'text', label: 'Order' } },
});

const todayIST = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** Module "eng": the shared business engines. Part 04.01 is the workflow engine. */
export const eng = {
  code: 'eng',
  name: 'Shared Business Engines',
  routePrefix: '/api/v1/workflow',
  ownerPart: '04.x',
  status: 'Workflow engine core: definitions, instances, states and tasks (04.01)',
  tables: ['xl_templates', 'xl_jobs', 'xl_job_errors', 'sig_signatures', 'sig_copies', 'sig_verifications', 'sig_profiles', 'sig_config', 'tpl_templates', 'tpl_records', 'tpl_generated_docs', 'tpl_deliveries', 'tpl_bulk_jobs', 'tpl_auto_rules', 'doc_types', 'doc_folder_templates', 'doc_folders', 'doc_documents', 'doc_versions', 'doc_shares', 'doc_distributions', 'doc_annotations', 'doc_links', 'alr_rules', 'alr_alerts', 'alr_rule_runs', 'tsk_tasks', 'tsk_assignees', 'tsk_checklist_items', 'tsk_dependencies', 'tsk_comments', 'tsk_escalations', 'tsk_routing_matrix', 'comm_messages', 'comm_consents', 'comm_otps', 'comm_channels', 'comm_dlt_templates', 'comm_wa_templates', 'ntf_templates', 'ntf_notifications', 'ntf_preferences', 'ntf_deliveries', 'ntf_realtime_events', 'acc_raci_templates', 'acc_raci_assignments', 'acc_action_ledger', 'pcs_control_points', 'pcs_check_results', 'pcs_exceptions', 'pcs_reason_codes', 'pcs_control_changes', 'pcs_cycle_stages', 'wf_approval_policies', 'wf_link_tokens', 'wf_matrix', 'wf_matrix_rules', 'wf_authority_limits', 'wf_delegations', 'wf_escalation_paths', 'wf_sla_settings', 'wf_definitions', 'wf_instances', 'wf_tasks', 'wf_task_attachments', 'wf_history', 'wf_watchers', 'eng_sample_docs'],
  companyOptional: ['doc_types', 'doc_folder_templates', 'alr_rules', 'pcs_reason_codes', 'acc_raci_templates', 'ntf_templates'],
  resources: ['submit', 'tasks', 'instances', 'documents', 'monitor', 'definitions', 'doc-types', 'sample-docs'],

  mount(api, { db, config, publicApi, storagePath }) {
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
    // part 04.06: the notification engine, the real-time layer and the people who follow what the modules say
    registerRealtimeRecords(db);
    registerCommProviders(integrationsOf(db, { vaultKey: config.vaultKey ?? undefined }).providers);
    const gateway = commOf(db);
    gateway.setPepper(config.authSecret ?? 'dev-otp-pepper');
    gateway.setPushSender(createPushSender({ db, config }));
    registerDefaultGateways({ db, config, commOn: (companyId) => flags.isOn({ companyId }, 'ff.eng.p0407') });
    const commService = createCommunicationService({ db, engine });
    runtime.bus.subscribe('core.webhook.received', webhookConsumer(db), { consumer: 'comm.webhook' });
    runtime.bus.subscribe(['comm.message.delivered', 'comm.message.failed'], deliveryReceiptConsumer(db), { consumer: 'ntf.receipts' });
    runtime.jobs.register('comm.dispatch', async (ctx) => { const r = await gateway.process(100); ctx.log(`Sent ${r.sent}, retrying ${r.retrying}, failed ${r.failed}, held for pace ${r.deferred}`); return r; }, { maxAttempts: 1, description: 'Sends the queued messages in order of priority through the connectors of their channel, with failover.' });
    runtime.scheduler.define({ code: 'comm.dispatch_minute', cron: '* * * * *', jobType: 'comm.dispatch', description: 'Every minute: send the queued messages on e-mail, text message, WhatsApp and push' });
    runtime.jobs.register('comm.purge', (ctx) => {
      const days = Number(createParameterStore(db).get('comm.retention_days', { date: todayIST() }));
      const cut = new Date(Date.now() - days * 86_400_000).toISOString();
      const m = db.prepare("DELETE FROM comm_messages WHERE created_at < ? AND status NOT IN ('QUEUED', 'SENDING')").run(cut).changes;
      const o = db.prepare("DELETE FROM comm_otps WHERE created_at < ? AND status != 'PENDING'").run(new Date(Date.now() - 30 * 86_400_000).toISOString()).changes;
      ctx.log(`Removed ${m} message(s) and ${o} old code record(s)`);
      return { messages: Number(m), otps: Number(o) };
    }, { maxAttempts: 1, description: 'Removes messages older than the retention period and spent one-time code records.' });
    runtime.scheduler.define({ code: 'comm.purge_daily', cron: '10 2 * * *', jobType: 'comm.purge', description: 'Daily 02:10: remove old messages and spent code records' });
    const messagesFile = (actor, q) => {
      const list = commService.messages.list(actor, { ...q, limit: 100, offset: 0 });
      const rows = list.rows.map((m) => ({ at: m.at.slice(0, 19).replace('T', ' '), channel: m.channel, direction: m.direction, to: m.to ?? '', template: m.template ?? '', status: m.status, record: m.relatedEntity ? `${m.relatedEntity} ${m.relatedId}` : '', connector: m.connector ?? '', error: m.blockReason ?? m.error ?? '' }));
      const columns = [['at', 'When (UTC)'], ['channel', 'Channel'], ['direction', 'Direction'], ['to', 'Address'], ['template', 'Template'], ['status', 'Status'], ['record', 'Record'], ['connector', 'Connector'], ['error', 'Reason']].map(([key, label]) => ({ key, label }));
      writeAudit(db, { entity: 'comm_messages', entityId: 'log', action: 'export', newValues: { rows: rows.length, format: q.format }, actor: actor.user, companyId: actor.companyId });
      return { buffer: writeExport(q.format, { columns, rows, footer: [`Communication log. Generated by ${actor.user} on ${todayIST()}. Addresses are partly hidden.`], sheetName: 'Messages', title: 'Communication log' }), type: FORMATS[q.format], fileName: `communication-${todayIST()}.${q.format}` };
    };
    const ntfService = createNotificationService({ db, engine });
    runtime.bus.subscribe(['workflow.notification.requested', 'workflow.instance.approved', 'workflow.instance.rejected'], workflowNotificationConsumer(db), { consumer: 'ntf.notify' });
    runtime.bus.subscribe(REALTIME_PATTERNS, realtimeConsumer(db), { consumer: 'ntf.realtime' });
    runtime.jobs.register('ntf.dispatch', async (ctx) => { const r = await notificationsOf(db).dispatchDue(); ctx.log(`Sent ${r.sent}, retrying ${r.retrying}, failed ${r.failed}, skipped ${r.skipped}`); return r; }, { maxAttempts: 1, description: 'Sends the notifications that are due on their channels and retries the ones that failed.' });
    runtime.scheduler.define({ code: 'ntf.dispatch_minute', cron: '* * * * *', jobType: 'ntf.dispatch', description: 'Every minute: send what is due on e-mail, text message, WhatsApp and push' });
    runtime.jobs.register('ntf.digest', (ctx) => { const r = notificationsOf(db).buildDigests(); ctx.log(`Built ${r.digests} digest(s) from ${r.held} held message(s)`); return r; }, { maxAttempts: 1, description: 'Sends one message for what was held back by quiet hours or a digest choice, once its time has come.' });
    runtime.scheduler.define({ code: 'ntf.digest_15min', cron: '*/15 * * * *', jobType: 'ntf.digest', description: 'Every 15 minutes: the digests that are due' });
    runtime.jobs.register('ntf.maintenance', (ctx) => { const r = realtimeOf(db).purge(Number(createParameterStore(db).get('ntf.realtime.retention_hours', { date: todayIST() }))); ctx.log(`Removed ${r.removed} old real-time event(s)`); return r; }, { maxAttempts: 1, description: 'Forgets the real-time events older than the hours kept.' });
    runtime.scheduler.define({ code: 'ntf.maintenance_hourly', cron: '17 * * * *', jobType: 'ntf.maintenance', description: 'Hourly: forget old real-time events' });
    const deliveriesFile = (actor, q) => {
      const list = ntfService.deliveries.list(actor, { ...q, limit: 100, offset: 0 });
      const rows = list.rows.map((d) => ({ at: d.at.slice(0, 19).replace('T', ' '), user: d.user, channel: d.channel, template: d.template, title: d.title, status: d.status, attempts: d.attempts, error: d.lastError ?? '' }));
      const columns = [['at', 'Created (UTC)'], ['user', 'Person'], ['channel', 'Channel'], ['template', 'Template'], ['title', 'Title'], ['status', 'Status'], ['attempts', 'Attempts'], ['error', 'Last error']].map(([key, label]) => ({ key, label }));
      writeAudit(db, { entity: 'ntf_deliveries', entityId: 'log', action: 'export', newValues: { rows: rows.length, format: q.format }, actor: actor.user, companyId: actor.companyId });
      return { buffer: writeExport(q.format, { columns, rows, footer: [`Delivery log. Generated by ${actor.user} on ${todayIST()}.`], sheetName: 'Deliveries', title: 'Delivery log' }), type: FORMATS[q.format], fileName: `deliveries-${todayIST()}.${q.format}` };
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
    const comms = Router();
    comms.use(gate('ff.eng.p0407', 'The communication gateway is'));
    comms.use(communicationRoutes({ service: commService, messagesFile }, idem));
    api.use('/comm', comms);

    // part 04.08: tasks, the instructions of seniors and the department responsibility matrix
    const taskService = createTaskService({ db, engine });
    runtime.jobs.register('tsk.sweep', (ctx) => { const r = taskService.sweep(); ctx.log(`Repeated ${r.repeated}, reminded ${r.reminded}, escalated ${r.escalated}`); return r; }, { maxAttempts: 1, description: 'Makes the next occurrence of recurring tasks, reminds people of tasks due, and escalates overdue tasks along the escalation path.' });
    runtime.scheduler.define({ code: 'tsk.sweep_hourly', cron: '5 * * * *', jobType: 'tsk.sweep', description: 'Hourly at :05: recurring tasks, reminders and escalation of overdue tasks' });
    // a document of the sample module that is sent back or rejected leaves a task for the person who wrote it (FR-02)
    runtime.bus.subscribe(['workflow.instance.rejected', 'workflow.instance.returned'], (event) => {
      const inst = db.prepare('SELECT * FROM wf_instances WHERE id = ?').get(Number(event.data.instanceId));
      if (!inst || inst.doc_type !== SAMPLE_DOC_TYPE || !flags.isOn({ companyId: inst.company_id }, 'ff.eng.p0408')) return;
      const returned = event.type.endsWith('returned');
      const author = db.prepare("SELECT 1 FROM iam_users WHERE company_id = ? AND username = ? AND is_active = 1").get(inst.company_id, inst.submitted_by);
      if (!author) return;
      tasksOf(db).create({ companyId: inst.company_id, title: `${returned ? 'Correct and resubmit' : 'Review the rejection of'} ${inst.doc_ref ?? inst.doc_id}`, description: `${inst.title ?? ''} was ${returned ? 'returned' : 'rejected'}. Read the reason in its approval history.`, entity: 'workflow_instance', entityId: inst.id, entityLabel: `${inst.doc_ref ?? inst.doc_id}`, projectId: inst.project_id, siteId: inst.site_id, priority: 'MEDIUM', dueDate: new Date(Date.parse(tasksOf(db).today()) + 3 * 86_400_000).toISOString().slice(0, 10), assignees: [inst.submitted_by], origin: 'auto', assigner: 'system', actor: 'system', notify: false, source: { type: 'workflow_instance', id: `${inst.id}:${event.type}` } });
    }, { consumer: 'tsk.auto' });
    const tasksFile = (actor, q) => {
      const list = taskService.tasks.list(actor, { view: q.view, status: q.status, limit: 200, offset: 0, sort: 'due' });
      const rows = list.rows.map((t) => ({ taskNo: t.taskNo, title: t.title, status: t.status, priority: t.priority, due: t.dueDate ?? '', assignees: t.assignees.map((a) => a.user).join(', '), assigner: t.assigner, record: t.entityLabel ?? '', overdue: t.overdue ? `${t.daysLate} day(s)` : '' }));
      const columns = [['taskNo', 'Task'], ['title', 'Title'], ['status', 'Status'], ['priority', 'Priority'], ['due', 'Due'], ['assignees', 'Assigned to'], ['assigner', 'Given by'], ['record', 'Record'], ['overdue', 'Overdue']].map(([key, label]) => ({ key, label }));
      writeAudit(db, { entity: 'tsk_tasks', entityId: 'list', action: 'export', newValues: { rows: rows.length, format: q.format, view: q.view }, actor: actor.user, companyId: actor.companyId });
      return { buffer: writeExport(q.format, { columns, rows, footer: [`Tasks. Generated by ${actor.user} on ${todayIST()}.`], sheetName: 'Tasks', title: 'Tasks' }), type: FORMATS[q.format], fileName: `tasks-${todayIST()}.${q.format}` };
    };
    const tsks = Router();
    tsks.use(gate('ff.eng.p0408', 'Task management is'));
    tsks.use(taskRoutes({ service: taskService, tasksFile }, idem));
    api.use('/tsk', tsks);

    // part 04.09: the alert rules; event rules listen through the bus (a consumer takes the types of the rules in force), schedule rules run from a job every 15 minutes
    const alertService = createAlertService({ db, engine });
    const alertCore = alertsOf(db);
    const listenTo = () => { for (const r of db.prepare("SELECT DISTINCT event_type FROM alr_rules WHERE trigger_type = 'EVENT' AND status IN ('ACTIVE', 'PENDING') AND event_type IS NOT NULL").all()) runtime.bus.subscribe(r.event_type, (event) => { alertCore.handleEvent(event); }, { consumer: 'alr.events' }); };
    listenTo();
    runtime.bus.subscribe('alr.rule.changed', () => { listenTo(); }, { consumer: 'alr.listen' });
    runtime.jobs.register('alr.run', (ctx) => { const n = alertCore.runDue(); ctx.log(`Ran ${n} schedule rule(s)`); return { ran: n }; }, { maxAttempts: 1, description: 'Runs the alert rules whose schedule has come: hourly, daily at an hour or weekly on a day.' });
    runtime.scheduler.define({ code: 'alr.run_quarter_hour', cron: '*/15 * * * *', jobType: 'alr.run', description: 'Every 15 minutes: run the alert rules that are due' });
    runtime.jobs.register('alr.webhook', async (ctx) => {
      const p = ctx.params;
      const out = await integrationsOf(db).hub.call(p.connector, 'request', { method: p.method, path: p.path, body: p.body }, { companyId: p.companyId, actor: { user: 'system' }, idempotencyKey: `alr-${p.alertId}-${p.connector}-${p.path}` });
      ctx.log(`Called ${p.connector} for alert ${p.alertId}`);
      return { logId: out?.logId ?? null };
    }, { maxAttempts: 4, description: 'Calls the webhook an alert rule asked for.' });
    const alertsFile = (actor, q) => {
      const list = alertService.alerts.list(actor, { view: q.view, status: q.status, limit: 100, offset: 0 });
      const rows = list.rows.map((a) => ({ id: a.id, severity: a.severity, status: a.status, rule: a.ruleCode, message: a.message, record: a.label ?? '', since: a.firstSeenAt.slice(0, 19).replace('T', ' '), times: a.occurrences, owner: a.owner ?? '' }));
      const columns = [['id', 'Alert'], ['severity', 'Severity'], ['status', 'Status'], ['rule', 'Rule'], ['message', 'Message'], ['record', 'Record'], ['since', 'Since (UTC)'], ['times', 'Times'], ['owner', 'Owner']].map(([key, label]) => ({ key, label }));
      writeAudit(db, { entity: 'alr_alerts', entityId: 'list', action: 'export', newValues: { rows: rows.length, format: q.format }, actor: actor.user, companyId: actor.companyId });
      return { buffer: writeExport(q.format, { columns, rows, footer: [`Alerts. Generated by ${actor.user} on ${todayIST()}.`], sheetName: 'Alerts', title: 'Alerts' }), type: FORMATS[q.format], fileName: `alerts-${todayIST()}.${q.format}` };
    };
    const alrs = Router();
    alrs.use(gate('ff.eng.p0409', 'Alert rules are'));
    alrs.use(alertRoutes({ service: alertService, alertsFile }, idem));
    api.use('/alr', alrs);

    // part 04.10: the document register, its revisions, folders, sharing, distribution, markups and expiry
    const docService = createDocumentService({ db, engine });
    bindDocuments(db, docService);
    const docStorage = createLocalStorage({ root: join(storagePath ?? join(process.cwd(), 'data'), 'files') });
    const docOps = createDocumentOps({ db, service: docService, storage: docStorage });
    const docConfig = createDocumentConfig({ db, engine, service: docService });
    runtime.jobs.register('doc.sweep', (ctx) => { const expiring = docService.expirySweep(); const reminded = docService.distribution.remind(); ctx.log(`Told ${expiring} owner(s) of expiring documents, reminded ${reminded} recipient(s)`); return { expiring, reminded }; }, { maxAttempts: 1, description: 'Tells the owners of documents that are about to expire and reminds the recipients who have not yet acknowledged a distributed document.' });
    runtime.scheduler.define({ code: 'doc.sweep_daily', cron: '15 6 * * *', jobType: 'doc.sweep', description: 'Daily 06:15: document expiry and acknowledgement reminders' });
    const documentsFile = (actor, q) => {
      const list = docService.documents.list(actor, { projectId: q.projectId, folderId: q.folderId, docType: q.docType, status: q.status, q: q.q, limit: 100, offset: 0, sort: 'number' });
      const rows = list.rows.map((x) => ({ docNo: x.docNo, title: x.title, type: x.typeName, revision: x.revision ?? '', status: x.status, confidentiality: x.confidentiality, discipline: x.discipline ?? '', owner: x.owner, validUntil: x.validUntil ?? '', checkedOutBy: x.checkedOutBy ?? '' }));
      const columns = [['docNo', 'Number'], ['title', 'Title'], ['type', 'Type'], ['revision', 'Revision'], ['status', 'Status'], ['confidentiality', 'Confidentiality'], ['discipline', 'Discipline'], ['owner', 'Owner'], ['validUntil', 'Valid until'], ['checkedOutBy', 'Checked out by']].map(([key, label]) => ({ key, label }));
      writeAudit(db, { entity: 'doc_documents', entityId: 'list', action: 'export', newValues: { rows: rows.length, format: q.format }, actor: actor.user, companyId: actor.companyId });
      return { buffer: writeExport(q.format, { columns, rows, footer: [`Document register. Generated by ${actor.user} on ${todayIST()}. Only the documents you may see are listed.`], sheetName: 'Documents', title: 'Document register' }), type: FORMATS[q.format], fileName: `documents-${todayIST()}.${q.format}` };
    };
    const docsRouter = Router();
    docsRouter.use(gate('ff.eng.p0410', 'The document service is'));
    docsRouter.use(documentRoutes({ service: docService, ops: docOps, config: docConfig, documentsFile, bulkBody: express.raw({ type: ['application/octet-stream', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], limit: '10mb' }) }, idem));
    api.use('/doc', docsRouter);

    // part 04.11: templates, PDF generation, print and delivery
    const tplService = createTemplateService({ db, engine, storage: docStorage, jobs: runtime.jobs, secret: config.fileUrlSecret, publicUrl: config.publicUrl });
    bindTemplates(db, tplService);
    tplService.seedLibrary();
    runtime.jobs.register('tpl.bulk', (ctx) => tplService.bulk.run(ctx), { maxAttempts: 1, description: 'Generates many documents (PDF with a verification code) one by one, with progress, and tells the person who asked when it is done.' });
    runtime.jobs.register('tpl.milestone', (ctx) => tplService.rules.runMilestone(ctx), { maxAttempts: 3, description: 'Generates the document that a workflow approval milestone asks for.' });
    runtime.bus.subscribe(['workflow.instance.approved'], (e) => tplService.rules.onApproved(e), { consumer: 'tpl.milestones' });
    runtime.bus.subscribe(['comm.message.sent', 'comm.message.delivered', 'comm.message.read', 'comm.message.failed'], (e) => tplService.delivery.onMessage(e), { consumer: 'tpl.delivery_status' });
    const generatedFile = (actor, q) => {
      const list = tplService.generated.list(actor, { ...q, limit: 100, offset: 0, sort: 'newest' });
      const rows = list.rows.map((x) => ({ docNo: x.docNo, type: x.typeLabel, version: x.version, current: x.current ? 'Yes' : 'No', purpose: x.purpose, project: x.projectName ?? '', generatedBy: x.generatedBy, generatedAt: x.generatedAt, pages: x.pages, deliveries: x.deliveries, verifyCode: x.verifyCode }));
      const columns = [['docNo', 'Number'], ['type', 'Document'], ['version', 'Version'], ['current', 'Current'], ['purpose', 'Purpose'], ['project', 'Project'], ['generatedBy', 'Generated by'], ['generatedAt', 'Generated at'], ['pages', 'Pages'], ['deliveries', 'Deliveries'], ['verifyCode', 'Verification code']].map(([key, label]) => ({ key, label }));
      writeAudit(db, { entity: 'tpl_generated_docs', entityId: 'list', action: 'export', newValues: { rows: rows.length, format: q.format }, actor: actor.user, companyId: actor.companyId });
      return { buffer: writeExport(q.format, { columns, rows, footer: [`Generated documents. Exported by ${actor.user} on ${todayIST()}. Only the documents you may see are listed.`], sheetName: 'Generated documents', title: 'Generated documents' }), type: FORMATS[q.format], fileName: `generated-documents-${todayIST()}.${q.format}` };
    };
    const tplRouter = Router();
    tplRouter.use(gate('ff.eng.p0411', 'Document templates are'));
    tplRouter.use(templateRoutes({ service: tplService, generatedFile }, idem));
    api.use('/tpl', tplRouter);
    publicApi.use(templatePublicRoutes({ service: tplService }));

    // part 04.12: signatures, the stamped copy, the register and the public verification
    const sigService = createSignatureService({ db, engine, storage: docStorage, jobs: runtime.jobs, publicUrl: config.publicUrl });
    bindSignatures(db, sigService);
    runtime.jobs.register('sig.stamp', (ctx) => sigService.signer.stamp(ctx.params.id), { maxAttempts: 3, description: 'Draws the signatures of a generated document on a copy of it (the original is never changed).' });
    runtime.bus.subscribe(['workflow.instance.approved'], (e) => sigService.signer.onApproved(e), { consumer: 'sig.approvals' });
    runtime.bus.subscribe(['tpl.document.generated'], (e) => sigService.signer.onGenerated(e), { consumer: 'sig.generated' });
    const registerFile = (actor, q) => {
      const list = sigService.register.list(actor, { ...q, limit: 100, offset: 0, sort: 'newest' });
      const rows = list.rows.map((x) => ({ docNo: x.docNo, type: x.typeLabel, version: x.version, signer: x.name, method: x.methodLabel, status: x.status, signedAt: x.signedAt, documentStatus: x.documentStatus, checks: x.verifications, reference: x.digest.slice(0, 12) }));
      const columns = [['docNo', 'Number'], ['type', 'Document'], ['version', 'Version'], ['signer', 'Signer'], ['method', 'Method'], ['status', 'Status'], ['signedAt', 'Signed at'], ['documentStatus', 'Document'], ['checks', 'Checks'], ['reference', 'Reference']].map(([key, label]) => ({ key, label }));
      writeAudit(db, { entity: 'sig_signatures', entityId: 'list', action: 'export', newValues: { rows: rows.length, format: q.format }, actor: actor.user, companyId: actor.companyId });
      return { buffer: writeExport(q.format, { columns, rows, footer: [`Signature register. Exported by ${actor.user} on ${todayIST()}. Only the signatures you may see are listed.`], sheetName: 'Signatures', title: 'Signature register' }), type: FORMATS[q.format], fileName: `signatures-${todayIST()}.${q.format}` };
    };
    const sigRouter = Router();
    sigRouter.use(gate('ff.eng.p0412', 'Signatures are'));
    sigRouter.use(signatureRoutes({ service: sigService, registerFile }, idem));
    api.use('/sig', sigRouter);
    publicApi.use(verifyPublicRoutes({ service: sigService, fileBody: express.raw({ type: () => true, limit: '25mb' }), isOn: (companyId) => companyId === null || flags.isOn({ companyId }, 'ff.eng.p0412') }));

    // part 04.13: the Excel import and export engine
    const excelService = createExcelService({ db, engine, storage: docStorage, jobs: runtime.jobs });
    bindExcel(db, excelService);
    bindAdapters(db, { sampleDocs: docs });
    runtime.jobs.register('xl.validate', (ctx) => excelService.job.validate(ctx), { maxAttempts: 2, description: 'Checks an uploaded import file row by row and prepares the preview and the error list.' });
    runtime.jobs.register('xl.commit', (ctx) => excelService.job.runCommit(ctx), { maxAttempts: 1, description: 'Commits a checked import: creates or updates the records through the module that owns them, all or nothing or in chunks.' });
    const xlRouter = Router();
    xlRouter.use(gate('ff.eng.p0413', 'The Excel engine is'));
    xlRouter.use(excelRoutes({ service: excelService, fileBody: express.raw({ type: () => true, limit: '12mb' }) }, idem));
    api.use('/xl', xlRouter);
    const ntf = Router();
    ntf.use(gate('ff.eng.p0406', 'Notifications are'));
    ntf.use(notificationRoutes({ service: ntfService, deliveriesFile }, idem));
    api.use('/ntf', ntf);
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
