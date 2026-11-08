import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports, listExportsOf } from '../../platform/list/index.js';
import { createFlagService } from '../core/api.js';
import { bindBud, createBudgetService } from './budgets.js';
import { createChangeService } from './changes.js';
import { budRoutes } from './routes.js';
import { runtimeOf } from '../../platform/runtime/index.js';

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['bud.budget.generated', 'A budget was generated from the signed-off baseline pack and the BOQ norms: data { projectId, budgetId, docNo, versionNo, lines, total, baselinePackId, boqVersionId }.'],
  ['bud.budget.approved', 'A budget was approved (project control manager, project manager, project director and, above ₹ 50 crore, the director) and locked: data { projectId, budgetId, docNo, versionNo, vtype, total, direct, overhead, contingency, reserve, contractValue, marginPct, marginWarning, supersedes, byCostHead }. The budget check (12.03), the project control engine (14.07) and the estimate at completion (23.11) read it.'],
  ['bud.budget.revision_started', 'A revision of an approved budget was started as a draft version: data { projectId, budgetId, parentBudgetId, versionNo, reason }.'],
  ['bud.budget.revised', 'A new version of the budget became the approved one in force (a revision of 12.01 or an approved budget change of 12.02): data { projectId, budgetId, previousBudgetId, versionNo, total, totalBefore, delta, source, changeId, changeType, reason }. The budget check (12.03) and the EAC (23.11) read it.'],
  ['bud.change.approved', 'A budget change (revision, transfer, contingency drawdown or a revision from a variation) was approved and applied as a new version of the budget: data { projectId, changeId, docNo, changeType, reasonCode, riskId, variationId, totalDelta, moved, pct, budgetId }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'bud', description });

integrityRegistry.register({
  allowNegative: ['bud_changes.total_delta', 'bud_changes.margin_before', 'bud_changes.margin_after', 'bud_change_lines.qty_delta', 'bud_change_lines.amount_delta'], companyOptional: [],
  statuses: { bud_budgets: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'], bud_changes: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED'] },
  uniqueKeys: [{ table: 'bud_changes', columns: ['company_id', 'doc_no'] }, { table: 'bud_budgets', columns: ['company_id', 'doc_no'] }, { table: 'bud_phasing', columns: ['line_id', 'period'] }],
});

/** Module "bud": project budgets (M12). Part 12.01 holds the budget prepared from the baseline pack and the BOQ norms, its lines, views, phasing, margin against the contract value, versions and approval. The tables are `bud_*`. */
export const bud = {
  code: 'bud',
  name: 'Project Budget',
  routePrefix: '/api/v1/bud',
  ownerPart: '12.01',
  status: 'The budget of a project generated from the signed-off baseline pack and the BOQ norms (a line per WBS node, cost code and resource with quantity, rate and amount; the generated values kept beside every adjustment and its reason), overhead, contingency and management reserve lines, views by WBS, cost head, resource, work package and control account, time phasing by hand or on an S-curve profile, the margin against the contract value with a warning, versions (an approved budget is locked and revised only by a new version) and the approval by the project control manager, the project manager, the project director and, above ₹ 50 crore, the director. Phasing from the schedule waits for 13.02.',
  tables: ['bud_budgets', 'bud_lines', 'bud_phasing', 'bud_changes', 'bud_change_lines'],
  companyOptional: [],
  resources: ['budgets', 'lines', 'generate', 'project-options', 'changes', 'change-options', 'compare'],

  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bud_budgets'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment });
    const gate = (req, _res, next) => (flags.isOn(req.actor, 'ff.bud.p1201') ? next() : next(notFound('The project budget is not enabled for your company yet (feature flag ff.bud.p1201 is OFF).')));
    const b = createBudgetService({ db });
    const svc = { ...b, ...(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bud_changes'").get() ? createChangeService({ db, base: b.budgetBase }) : {}) };
    bindBud(db, svc);
    if (svc.changes) {
      listExports.register('bud.changes', { source: (actor, req) => svc.changes.exportSource(actor, req), hidden: () => [] });
      runtimeOf(db)?.bus?.subscribe('ctr.variation.approved', (e) => { svc.changes.fromVariation(e); }, { consumer: 'bud.variation' });
    }
    listExports.register('bud.budgets', { source: (actor, req) => svc.budgets.exportSource(actor, req), hidden: () => [] });
    const router = Router();
    router.use(gate);
    router.use((req, res, next) => (/^\/(changes|change-options|compare)(\/|$)/.test(req.path) ? (flags.isOn(req.actor, 'ff.bud.p1202') ? next() : next(notFound('Budget changes are not enabled for your company yet (feature flag ff.bud.p1202 is OFF).'))) : next()));
    router.use(budRoutes(svc, { exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
    api.use('/bud', router);
  },
};
