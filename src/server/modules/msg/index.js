import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { createFlagService } from '../core/api.js';
import { authzOf } from '../../platform/authz/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { bindConfig, createMsgConfigService } from './config.js';
import { bindFeatures, createFeatureService } from './features.js';
import { bindAutoGroups, createAutoGroupService } from './autogroups.js';
import { createCommService } from './comcenter.js';
import { bind, createMessageService } from './messages.js';
import { messageRoutes } from './routes.js';

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['msg.conversation.created', 'A conversation was made (direct, group, project, site, department, team or record-linked).'],
  ['msg.message.created', 'A message was sent in a conversation.'],
  ['msg.call.started', 'A voice or video call was started in a conversation.'],
  ['msg.call.ended', 'A call ended; the conversation shows how long it lasted.'],
  ['msg.hold.placed', 'A legal hold was placed on a conversation: nothing in it is removed by retention.'],
  ['msg.instruction.created', 'A message was marked as an instruction that people have to acknowledge.'],
  ['msg.instruction.acknowledged', 'A person acknowledged an instruction (feeds the performance record of 07.11): data { user, priority, dueAt, late }.'],
  ['msg.instruction.completed', 'Everyone acknowledged an instruction.'],
  ['msg.instruction.escalated', 'An instruction was not acknowledged by its due time and was escalated to the managers of those who did not.'],
  ['msg.announcement.published', 'An announcement was published to its audience.'],
  ['msg.escalation.raised', 'A person flagged a conversation as unresolved.'],
  ['msg.escalation.escalated', 'A flagged conversation was not resolved in time and went to managers.'],
  ['msg.action.created', 'A message was turned into a record (task, RFI, NCR, site instruction, material request or HSE observation).'],
]) eventTypes.define({ type, version: 1, schema, owner: 'msg', description });
for (const [key, dataType, def, min, max, description] of [
  ['msg.edit_window_minutes', 'integer', 15, 0, 1440, 'Minutes after sending during which a message can be edited or deleted for everyone by its sender (0 switches both off).'],
  ['msg.deleted_content_retention_days', 'integer', 30, 0, 3650, 'Days the text of a deleted message is kept (for the audit trail) before it is blanked.'],
  ['msg.group_max_members', 'integer', 250, 2, 2000, 'The most members a conversation can have.'],
]) parameterRegistry.define({ key, dataType, default: def, min, max, scopes: ['system', 'company'], description });
integrityRegistry.register({ companyOptional: [], statuses: { msg_messages: ['ACTIVE', 'DELETED'] } });

const todayCompanies = (db) => db.prepare('SELECT id FROM org_companies').all().map((r) => r.id);

/** Module "msg": the unified Messages app (part 05.01); later parts add presence, receipts and calls (05.02), secure messaging (05.03) and the communication centre (05.04). */
export const msg = {
  code: 'msg',
  name: 'Collaboration & Messaging',
  routePrefix: '/api/v1/msg',
  ownerPart: '05.x',
  status: 'Unified Messages app: direct, group, project, site, department and record conversations, external threads in one index (05.01)',
  tables: ['msg_conversations', 'msg_members', 'msg_messages', 'msg_reactions', 'msg_receipts', 'msg_stars', 'msg_pins', 'msg_hidden', 'msg_voice', 'msg_user_settings', 'msg_presence', 'msg_holds', 'msg_member_periods', 'msg_auto_group_rules', 'msg_auto_group_links', 'msg_instructions', 'msg_acknowledgements', 'msg_announcements', 'msg_announcement_reads', 'msg_escalations', 'msg_actions', 'msg_calls', 'msg_config'],
  companyOptional: [],
  resources: ['conversations', 'messages', 'people', 'unread', 'verify'],

  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'msg_conversations'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment });
    const gate = (key, what) => (req, _res, next) => (flags.isOn(req.actor, key) ? next() : next(notFound(`${what} not enabled for your company yet (feature flag ${key} is OFF).`)));
    const service = createMessageService({ db });
    bind(db, service);
    const features = createFeatureService({ db, base: service });
    bindFeatures(db, features);
    const config = createMsgConfigService({ db, engine: workflowOf(db) });
    bindConfig(db, config);
    const runtime = runtimeOf(db);
    const comm = createCommService({ db, base: service });
    const groups = createAutoGroupService({ db, engine: workflowOf(db), base: service });
    bindAutoGroups(db, groups);
    // part 05.04: the groups follow the assignments within a minute: at once on the event, and a job every minute for the rest
    for (const type of ['proj.project.activated', 'iam.assignment.created', 'iam.assignment.ended', 'hr.deployment.changed', 'iam.user.suspended', 'iam.user.deactivated']) runtime.bus.subscribe(type, (event) => { if (event.companyId) groups.sync(event.companyId); }, { consumer: `msg.autogroups.${type}` });
    runtime.jobs.register('msg.comcenter', () => { const out = { groups: 0, instructions: 0, conversations: 0, published: 0 }; for (const c of todayCompanies(db)) { const g = groups.sync(c); out.groups += g.added + g.removed; const r = comm.cycle(c); out.instructions += r.instructionsEscalated; out.conversations += r.conversationsEscalated; out.published += r.announcements.published; } return out; });
    runtime.scheduler.define({ code: 'msg.comcenter_minute', cron: '* * * * *', jobType: 'msg.comcenter', description: 'Every minute: keep the auto groups in step with assignments, publish due announcements, escalate instructions and flagged conversations that are past their time' });
    runtime.jobs.register('msg.purge', () => { let purged = 0; let expired = 0; for (const c of todayCompanies(db)) { const r = service.admin.purge(c); purged += r.purged; expired += r.expired; } return { purged, expired }; }, { maxAttempts: 1, description: 'Blanks the text of deleted messages that are older than the retention period.' });
    const router = Router();
    router.use(gate('ff.msg.p0501', 'The Messages app is'));
    router.use(['/me', '/presence', '/search', '/starred', '/holds', '/calls', '/config', /\/(typing|delivered|pins|media|hold|calls)$/, /\/messages\/\d+\/(receipts|star|pin|hide)$/], gate('ff.msg.p0502', 'The messaging features are'));
    router.use(['/center', '/instructions', '/acknowledgements', '/announcements', '/escalations', '/action-types', '/auto-group-rules', /\/messages\/\d+\/(instruction|action-draft|to-action)$/, /\/conversations\/\d+\/escalate$/], gate('ff.msg.p0504', 'The Communication Center is'));
    router.use(messageRoutes({ service, features, config, comm, groups: { ...groups, can: (a) => authzOf(db).check(a, 'msg.autogroup.edit', { companyId: a.companyId }).allowed } }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
    api.use('/msg', router);
  },
};
