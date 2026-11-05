import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports, listExportsOf } from '../../platform/list/index.js';
import { bindMdm } from '../../platform/mdm/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { createFlagService } from '../core/api.js';
import './masters.js';
import './integrations.js';
import './common-integrations.js';
import { bindCommon, createCommonService, syncCoreUom } from './common.js';
import { setCommonFlag } from './common-integrations.js';
import { bindItems, createItemService } from './items.js';
import './item-integrations.js';
import { commonRoutes, itemRoutes, mdmRoutes } from './routes.js';
import { bindService, createMdmService } from './service.js';

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['mdm.change.requested', 'A change of a governed master record was asked for (new record, change from a date, inactivation, reactivation or merge): data { masterType, changeType }.'],
  ['mdm.record.changed', 'A version of a master record came into force (approved, or its date came): data { masterType, code, version, status }.'],
  ['mdm.record.merged', 'A duplicate master record was merged into another; it is kept and its references resolve to the survivor through the merge map: data { masterType, from, to }.'],
  ['mdm.item.requested', 'A new item or a new version of an item was requested and sent to the steward of its category: data { code, type }.'],
  ['mdm.item.approved', 'An item (or a new version of it) was approved and is in force; the version it replaces is superseded: data { code, version, type }.'],
  ['mdm.item.changed', 'An item in force was changed by a steward (fields, units, bill of resources, status): data { code, fields?, status? }. Consumers drop their cached copy.'],
  ['mdm.item_category.changed', 'An item category or its attribute template was added or changed: data { code }.'],
  ['mdm.common.changed', 'A row of a common master (unit, GST rate, HSN/SAC, TDS section, state, currency or rate, bank, payment term, lookup value) was added, changed, ended or, for a statutory master, approved: data { master, key, action, effectiveFrom? }. Consumers drop their cached copy.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'mdm', description });

const ITEM_TABLES = ['mdm_item_categories', 'mdm_items', 'mdm_item_uoms', 'mdm_item_resources', 'mdm_item_makes', 'mdm_item_alternates', 'mdm_item_code_counters', 'mdm_item_user_marks', 'mdm_item_legacy_map'];
const COMMON_TABLES = ['mdm_uoms', 'mdm_gst_rates', 'mdm_hsn_sac', 'mdm_tds_sections', 'mdm_states', 'mdm_districts', 'mdm_currencies', 'mdm_exchange_rates', 'mdm_banks', 'mdm_payment_terms', 'mdm_lookup_lists', 'mdm_lookups'];
// the integrity checks (01.02): a common master row without a company is a system row every company sees (06.02); the status lists of the governed records (06.01)
integrityRegistry.register({ companyOptional: [...COMMON_TABLES, 'mdm_item_categories'], statuses: Object.fromEntries(COMMON_TABLES.map((t) => [t, ['PENDING', 'ACTIVE', 'RETIRED', 'REJECTED']])) });
/** Module "mdm": master data governance (part 06.01). The tables are `mdm_*`; the masters plug in through `masterTypes` (platform/mdm). */
export const mdm = {
  code: 'mdm',
  name: 'Master Data Governance',
  routePrefix: '/api/v1/mdm',
  ownerPart: '06.01, 06.02, 06.03',
  status: 'Governed masters: change requests with steward approval, duplicate detection and merge map, effective-dated versions with "as of", data quality rules and score, stewards, dashboard (06.01); first master: business partner',
  tables: ['mdm_records', 'mdm_record_versions', 'mdm_change_requests', 'mdm_duplicates', 'mdm_merge_map', 'mdm_quality_rules', 'mdm_stewards', ...COMMON_TABLES, ...ITEM_TABLES],
  companyOptional: [...COMMON_TABLES, 'mdm_item_categories'], // a row without a company is the system row every company sees (06.02)
  resources: ['masters', 'records', 'change-requests', 'duplicates', 'merge', 'quality', 'config', 'common', 'tax', 'exchange-rate', 'uoms', 'lookup-lists', 'lookups', 'items', 'item-categories'],

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
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'mdm_uoms'").get()) {
      const common = createCommonService({ db });
      bindCommon(db, common);
      setCommonFlag((actor) => flags.isOn(actor, 'ff.mdm.p0602'));
      // the calculation engine's unit tables follow the master (D-042): the system units are written into them once, idempotently
      for (const u of db.prepare("SELECT * FROM mdm_uoms WHERE company_id IS NULL AND row_status = 'ACTIVE' AND deleted_at IS NULL").all()) syncCoreUom(db, u);
      const c = Router();
      c.use(gate('ff.mdm.p0602', 'The common masters are'));
      c.use(commonRoutes({ common }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
      api.use('/mdm', c);
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'mdm_items'").get()) {
        const items = createItemService({ db });
        bindItems(db, items);
        listExports.register('mdm.items', { source: (actor, req) => items.register.exportSource(actor, req), hidden: (actor) => (items.seesRates(actor) ? [] : ['standardRate']) });
        const i = Router();
        i.use(gate('ff.mdm.p0603', 'The item master is'));
        i.use(itemRoutes({ items, exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
        api.use('/mdm', i);
      }
    }
  },
};
