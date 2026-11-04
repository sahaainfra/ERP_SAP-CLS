import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { createFlagService } from '../core/api.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { bindGovernance, createGovernanceService } from './governance.js';
import { secureRoutes } from './routes.js';
import { bindSecure, createSecureService } from './service.js';

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['sec.device.registered', 'A device of a person registered its public keys for secure messaging.'],
  ['sec.device.revoked', 'A device was revoked: it is removed from every future secure session.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'sec', description });

/** Module "sec": secure end-to-end messaging and the open-source licence register (part 05.03). It builds on the msg module (the conversation index) and never reads or stores plaintext. */
export const sec = {
  code: 'sec',
  name: 'Secure Messaging & Licence Compliance',
  routePrefix: '/api/v1/sec',
  ownerPart: '05.03',
  status: 'End-to-end encrypted conversations with device keys, safety numbers, an approved policy and the open-source licence register (05.03)',
  tables: ['sec_devices', 'sec_prekeys', 'sec_conversations', 'sec_envelopes', 'sec_policy', 'sec_licence_reviews', 'oss_register'],
  companyOptional: [],
  resources: ['devices', 'prekeys', 'conversations', 'envelopes', 'policy', 'licences'],

  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sec_devices'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment });
    const gate = (key, what) => (req, _res, next) => (flags.isOn(req.actor, key) ? next() : next(notFound(`${what} not enabled for your company yet (feature flag ${key} is OFF).`)));
    const service = createSecureService({ db });
    bindSecure(db, service);
    const gov = createGovernanceService({ db, engine: workflowOf(db) });
    bindGovernance(db, gov);
    const runtime = runtimeOf(db);
    const companies = () => db.prepare('SELECT id FROM org_companies').all().map((r) => r.id);
    runtime.jobs.register('sec.purge', () => { const out = { expired: 0, metadata: 0, undelivered: 0 }; for (const c of companies()) { const r = service.purge(c); for (const k of Object.keys(out)) out[k] += r[k]; } return out; });
    const router = Router();
    router.use(gate('ff.msg.p0503', 'Secure messaging is'));
    router.use(secureRoutes({ service, gov }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
    api.use('/sec', router);
  },
};
