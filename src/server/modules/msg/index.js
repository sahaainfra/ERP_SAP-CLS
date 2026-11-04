import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { createFlagService } from '../core/api.js';
import { bind, createMessageService } from './messages.js';
import { messageRoutes } from './routes.js';

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['msg.conversation.created', 'A conversation was made (direct, group, project, site, department, team or record-linked).'],
  ['msg.message.created', 'A message was sent in a conversation.'],
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
  tables: ['msg_conversations', 'msg_members', 'msg_messages', 'msg_reactions'],
  companyOptional: [],
  resources: ['conversations', 'messages', 'people', 'unread', 'verify'],

  mount(api, { db, config }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'msg_conversations'").get()) return;
    const flags = createFlagService({ db, environment: config.environment });
    const gate = (key, what) => (req, _res, next) => (flags.isOn(req.actor, key) ? next() : next(notFound(`${what} not enabled for your company yet (feature flag ${key} is OFF).`)));
    const service = createMessageService({ db });
    bind(db, service);
    const runtime = runtimeOf(db);
    runtime.jobs.register('msg.purge', () => { let purged = 0; for (const c of todayCompanies(db)) purged += service.admin.purge(c).purged; return { purged }; }, { maxAttempts: 1, description: 'Blanks the text of deleted messages that are older than the retention period.' });
    const router = Router();
    router.use(gate('ff.msg.p0501', 'The Messages app is'));
    router.use(messageRoutes({ service }, { idempotent: idempotency(db) }));
    api.use('/msg', router);
  },
};
