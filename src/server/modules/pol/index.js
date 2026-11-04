import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { createFlagService } from '../core/api.js';
import { policyRoutes } from './routes.js';
import { bindPolicies, createPolicyService } from './service.js';

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['pol.policy.published', 'A policy version was approved and published: the people it applies to were told.'],
  ['pol.policy.superseded', 'A policy version was replaced by a newer one (it stays, read-only).'],
  ['pol.policy.archived', 'A policy was archived.'],
  ['pol.acknowledgement.recorded', 'A person acknowledged a policy (feeds HR and performance): data { policyNo, version, user, onTime, quizScore }.'],
  ['pol.acknowledgement.overdue', 'People did not acknowledge a policy by its due date and their managers were told.'],
  ['pol.requirement.converted', 'A requirement of a policy was turned into a draft control point, approval rule or alert rule (inactive until an administrator activates it).'],
]) eventTypes.define({ type, version: 1, schema, owner: 'pol', description });
void parameterRegistry;

/** Module "pol": company policies (part 05.05). The tables are `pol_*`; the drafts it makes are written by the engines that own them (registered in `policyDrafts`). */
export const pol = {
  code: 'pol',
  name: 'Company Policies',
  routePrefix: '/api/v1/pol',
  ownerPart: '05.05',
  status: 'Policy register, versions with approval, acknowledgements with a knowledge check, reminders, and policy-to-protocol drafts (05.05)',
  tables: ['pol_policies', 'pol_versions', 'pol_acknowledgements', 'pol_requirements'],
  companyOptional: [],
  resources: ['policies', 'versions', 'acknowledgements', 'requirements'],

  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pol_policies'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment });
    const gate = (key, what) => (req, _res, next) => (flags.isOn(req.actor, key) ? next() : next(notFound(`${what} not enabled for your company yet (feature flag ${key} is OFF).`)));
    const service = createPolicyService({ db });
    bindPolicies(db, service);
    const runtime = runtimeOf(db);
    const companies = () => db.prepare('SELECT id FROM org_companies').all().map((r) => r.id);
    runtime.jobs.register('pol.cycle', () => { const out = { activated: 0, added: 0, reminded: 0, escalated: 0, reviewNotices: 0 }; for (const c of companies()) { const r = service.cycle(c); for (const k of Object.keys(out)) out[k] += r[k]; } return out; });
    runtime.scheduler.define({ code: 'pol.cycle_hourly', cron: '5 * * * *', jobType: 'pol.cycle', description: 'Hourly: policies that reach their effective date become the one in force, new people get the policies that apply to them, acknowledgement reminders and escalation, review reminders' });
    const router = Router();
    router.use(gate('ff.msg.p0505', 'Company policies are'));
    router.use(policyRoutes({ service }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
    api.use('/pol', router);
  },
};
