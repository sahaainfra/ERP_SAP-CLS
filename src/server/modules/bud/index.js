import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports, listExportsOf } from '../../platform/list/index.js';
import { createFlagService } from '../core/api.js';
import { bindBud, createBudgetService } from './budgets.js';
import { budRoutes } from './routes.js';

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['bud.budget.generated', 'A budget was generated from the signed-off baseline pack and the BOQ norms: data { projectId, budgetId, docNo, versionNo, lines, total, baselinePackId, boqVersionId }.'],
  ['bud.budget.approved', 'A budget was approved (project control manager, project manager, project director and, above ₹ 50 crore, the director) and locked: data { projectId, budgetId, docNo, versionNo, vtype, total, direct, overhead, contingency, reserve, contractValue, marginPct, marginWarning, supersedes, byCostHead }. The budget check (12.03), the project control engine (14.07) and the estimate at completion (23.11) read it.'],
  ['bud.budget.revised', 'A revision of an approved budget was started: data { projectId, budgetId, parentBudgetId, versionNo, reason }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'bud', description });

integrityRegistry.register({
  allowNegative: [], companyOptional: [],
  statuses: { bud_budgets: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'] },
  uniqueKeys: [{ table: 'bud_budgets', columns: ['company_id', 'doc_no'] }, { table: 'bud_phasing', columns: ['line_id', 'period'] }],
});

/** Module "bud": project budgets (M12). Part 12.01 holds the budget prepared from the baseline pack and the BOQ norms, its lines, views, phasing, margin against the contract value, versions and approval. The tables are `bud_*`. */
export const bud = {
  code: 'bud',
  name: 'Project Budget',
  routePrefix: '/api/v1/bud',
  ownerPart: '12.01',
  status: 'The budget of a project generated from the signed-off baseline pack and the BOQ norms (a line per WBS node, cost code and resource with quantity, rate and amount; the generated values kept beside every adjustment and its reason), overhead, contingency and management reserve lines, views by WBS, cost head, resource, work package and control account, time phasing by hand or on an S-curve profile, the margin against the contract value with a warning, versions (an approved budget is locked and revised only by a new version) and the approval by the project control manager, the project manager, the project director and, above ₹ 50 crore, the director. Phasing from the schedule waits for 13.02.',
  tables: ['bud_budgets', 'bud_lines', 'bud_phasing'],
  companyOptional: [],
  resources: ['budgets', 'lines', 'generate', 'project-options'],

  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bud_budgets'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment });
    const gate = (req, _res, next) => (flags.isOn(req.actor, 'ff.bud.p1201') ? next() : next(notFound('The project budget is not enabled for your company yet (feature flag ff.bud.p1201 is OFF).')));
    const svc = createBudgetService({ db });
    bindBud(db, svc);
    listExports.register('bud.budgets', { source: (actor, req) => svc.budgets.exportSource(actor, req), hidden: () => [] });
    const router = Router();
    router.use(gate);
    router.use(budRoutes(svc, { exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
    api.use('/bud', router);
  },
};
