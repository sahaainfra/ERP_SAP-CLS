import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { bindMdm } from '../../platform/mdm/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { createFlagService } from '../core/api.js';
import './masters.js';
import './integrations.js';
import { mdmRoutes } from './routes.js';
import { bindService, createMdmService } from './service.js';

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['mdm.change.requested', 'A change of a governed master record was asked for (new record, change from a date, inactivation, reactivation or merge): data { masterType, changeType }.'],
  ['mdm.record.changed', 'A version of a master record came into force (approved, or its date came): data { masterType, code, version, status }.'],
  ['mdm.record.merged', 'A duplicate master record was merged into another; it is kept and its references resolve to the survivor through the merge map: data { masterType, from, to }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'mdm', description });

/** Module "mdm": master data governance (part 06.01). The tables are `mdm_*`; the masters plug in through `masterTypes` (platform/mdm). */
export const mdm = {
  code: 'mdm',
  name: 'Master Data Governance',
  routePrefix: '/api/v1/mdm',
  ownerPart: '06.01',
  status: 'Governed masters: change requests with steward approval, duplicate detection and merge map, effective-dated versions with "as of", data quality rules and score, stewards, dashboard (06.01); first master: business partner',
  tables: ['mdm_records', 'mdm_record_versions', 'mdm_change_requests', 'mdm_duplicates', 'mdm_merge_map', 'mdm_quality_rules', 'mdm_stewards'],
  companyOptional: [],
  resources: ['masters', 'records', 'change-requests', 'duplicates', 'merge', 'quality', 'config'],

  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'mdm_records'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment });
    const gate = (key, what) => (req, _res, next) => (flags.isOn(req.actor, key) ? next() : next(notFound(`${what} not enabled for your company yet (feature flag ${key} is OFF).`)));
    const service = createMdmService({ db });
    bindService(db, service);
    bindMdm(db, service);
    const runtime = runtimeOf(db);
    const companies = () => db.prepare('SELECT id FROM org_companies').all().map((r) => r.id);
    runtime.jobs.register('mdm.cycle', () => { const out = { activated: 0, duplicates: 0 }; for (const c of companies()) { const r = service.cycle(c); out.activated += r.activated; out.duplicates += r.duplicates; } return out; });
    runtime.scheduler.define({ code: 'mdm.cycle_hourly', cron: '10 * * * *', jobType: 'mdm.cycle', description: 'Hourly: master record versions whose date has come come into force; duplicates are scanned for' });
    const router = Router();
    router.use(gate('ff.mdm.p0601', 'Master data governance is'));
    router.use(mdmRoutes({ service }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
    api.use('/mdm', router);
  },
};
