import { Router } from 'express';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { createFlagService } from '../core/api.js';
import './integrations.js';
import { finRoutes } from './routes.js';
import { bindFin, createFinService } from './service.js';

const TABLES = ['fin_account_groups', 'fin_accounts', 'fin_cost_heads', 'fin_cost_codes', 'fin_dimension_rules', 'fin_category_mappings', 'fin_master_changes'];
const TEMPLATE = ['fin_account_groups', 'fin_accounts', 'fin_cost_heads', 'fin_cost_codes', 'fin_dimension_rules'];
// the integrity checks (01.02): a row without a company is the template every company copies (the seed of migration 105)
integrityRegistry.register({ allowNegative: [], companyOptional: TEMPLATE, statuses: {} });
/** Module "fin": the finance masters (part 06.05): chart of accounts, cost heads and cost codes, financial dimensions and the item category mapping. The tables are `fin_*`. */
export const fin = {
  code: 'fin',
  name: 'Finance masters',
  routePrefix: '/api/v1/fin',
  ownerPart: '06.05',
  status: 'Chart of accounts with Schedule III mapping and control accounts, cost heads and cost codes, dimension rules and the posting check, item category mapping, import from Tally; every change approved by the CFO',
  tables: TABLES,
  companyOptional: TEMPLATE,
  resources: ['accounts', 'account-groups', 'cost-heads', 'cost-codes', 'dimension-rules', 'category-mappings', 'schedule-iii', 'postings', 'changes', 'import', 'lookups'],

  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fin_accounts'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment });
    const fin = createFinService({ db });
    bindFin(db, fin);
    const router = Router();
    router.use((req, _res, next) => (flags.isOn(req.actor, 'ff.mdm.p0605') ? next() : next(notFound('The chart of accounts and cost codes are not enabled for your company yet (feature flag ff.mdm.p0605 is OFF).'))));
    router.use(finRoutes({ fin }, { idempotent: idempotency(db) }));
    api.use('/fin', router);
  },
};
