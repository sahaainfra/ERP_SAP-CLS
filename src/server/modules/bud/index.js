import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports, listExportsOf } from '../../platform/list/index.js';
import { createFlagService } from '../core/api.js';
import { bindBud, createBudgetService } from './budgets.js';
import { createChangeService } from './changes.js';
import { createLedgerService } from './ledger.js';
import { createDeptService } from './dept.js';
import './dept-import.js';
import { ACTUAL_EVENTS, COMMIT_EVENTS, GL_EVENT_FAMILY } from './constants.js';
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
  ['bud.commitment.changed', 'The commitment ledger of a project changed (a PR, PO, WO, hire or service order was committed, amended, short-closed or cancelled): data { projectId, sourceType, sourceId, stage, lines, result, exceptionNo, availableAfter, released }. The project control engine (14.07) reads it.'],
  ['bud.actual.posted', 'An actual cost was recorded (or reversed) against the budget: data { projectId, sourceType, sourceId, lines, amount, reversed }. The project control engine (14.07) reads it.'],
  ['bud.dept_budget.approved', 'A department (head-office) budget of a cost centre for a financial year was approved by the department head, the CFO and the director and locked: data { budgetId, docNo, fyId, costCentreId, departmentId, versionNo, vtype, total, previousBudgetId, previousTotal, months }. Budget against actual and the overhead allocation (23.10) read it.'],
  ['bud.dept_budget.revision_started', 'A new version of an approved department budget was started as a draft: data { budgetId, parentBudgetId, fyId, costCentreId, versionNo, reason }.'],
  ['bud.alloc.rule_changed', 'An overhead allocation rule was put in force or withdrawn: data { ruleId, docNo, fyId, basis, status }.'],
  ['bud.overhead.allocated', 'An overhead pool was allocated to projects and the shares add up to the pool exactly: data { runId, docNo, fyId, ruleId, basis, poolSource, fromPeriod, toPeriod, fromDate, toDate, pool, allocations: [{ projectId, amount, share }] }. Project accounting (23.10) takes each allocation as the overhead pool of the project for the months.'],
  ['bud.overhead.allocation_reversed', 'A posted overhead allocation was reversed: data { runId, docNo, fyId, ruleId, pool, reason }. Project accounting (23.10) removes the allocation.'],
  ['bud.check.config_changed', 'A budget check setting was approved and is in force from its date: data { configId, docNo, costHeadId, stage, mode, tolerancePct, effectiveFrom }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'bud', description });

integrityRegistry.register({
  allowNegative: ['bud_dept_actuals.amount', 'bud_alloc_runs.pool_amount', 'bud_alloc_lines.residual', 'bud_changes.total_delta', 'bud_commitment_log.amount_delta', 'bud_commitment_log.qty_delta', 'bud_changes.margin_before', 'bud_changes.margin_after', 'bud_change_lines.qty_delta', 'bud_change_lines.amount_delta'], companyOptional: [],
  statuses: { bud_budgets: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'], bud_changes: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED'], bud_commitments: ['OPEN', 'PARTIAL', 'CLOSED', 'CANCELLED'], bud_actuals: ['POSTED', 'REVERSED'], bud_check_config: ['PENDING', 'ACTIVE', 'SUPERSEDED', 'REJECTED', 'CANCELLED'], bud_dept_budgets: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'], bud_dept_actuals: ['POSTED', 'REVERSED'], bud_alloc_rules: ['DRAFT', 'ACTIVE', 'SUPERSEDED', 'CANCELLED'], bud_alloc_runs: ['POSTED', 'REVERSED'] },
  uniqueKeys: [{ table: 'bud_dept_budgets', columns: ['company_id', 'doc_no'] }, { table: 'bud_dept_actuals', columns: ['company_id', 'src_type', 'src_id', 'src_line_id'] }, { table: 'bud_alloc_rules', columns: ['company_id', 'doc_no'] }, { table: 'bud_alloc_runs', columns: ['company_id', 'doc_no'] }, { table: 'bud_check_config', columns: ['company_id', 'doc_no'] }, { table: 'bud_commitments', columns: ['company_id', 'src_type', 'src_id', 'src_line_id'] }, { table: 'bud_actuals', columns: ['company_id', 'src_type', 'src_id', 'src_line_id'] }, { table: 'bud_changes', columns: ['company_id', 'doc_no'] }, { table: 'bud_budgets', columns: ['company_id', 'doc_no'] }, { table: 'bud_phasing', columns: ['line_id', 'period'] }],
});

/** Module "bud": project budgets (M12). Part 12.01 holds the budget prepared from the baseline pack and the BOQ norms, its lines, views, phasing, margin against the contract value, versions and approval. The tables are `bud_*`. */
export const bud = {
  code: 'bud',
  name: 'Project Budget',
  routePrefix: '/api/v1/bud',
  ownerPart: '12.01',
  status: 'The budget of a project generated from the signed-off baseline pack and the BOQ norms (a line per WBS node, cost code and resource with quantity, rate and amount; the generated values kept beside every adjustment and its reason), overhead, contingency and management reserve lines, views by WBS, cost head, resource, work package and control account, time phasing by hand or on an S-curve profile, the margin against the contract value with a warning, versions (an approved budget is locked and revised only by a new version) and the approval by the project control manager, the project manager, the project director and, above ₹ 50 crore, the director. Phasing from the schedule waits for 13.02.',
  tables: ['bud_budgets', 'bud_lines', 'bud_phasing', 'bud_changes', 'bud_change_lines', 'bud_check_config', 'bud_commitments', 'bud_commitment_log', 'bud_actuals', 'bud_dept_budgets', 'bud_dept_lines', 'bud_dept_actuals', 'bud_alloc_rules', 'bud_alloc_runs', 'bud_alloc_lines'],
  companyOptional: [],
  resources: ['budgets', 'lines', 'generate', 'project-options', 'changes', 'change-options', 'compare', 'check', 'availability', 'ledger', 'check-config', 'ingest', 'commitments', 'dept-options', 'dept-budgets', 'dept-report', 'dept-actuals', 'alloc-rules', 'alloc'],

  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bud_budgets'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment });
    const gate = (req, _res, next) => (flags.isOn(req.actor, 'ff.bud.p1201') ? next() : next(notFound('The project budget is not enabled for your company yet (feature flag ff.bud.p1201 is OFF).')));
    const b = createBudgetService({ db });
    const has = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
    const svc = { ...b, ...(has('bud_changes') ? createChangeService({ db, base: b.budgetBase }) : {}), ...(has('bud_commitments') ? createLedgerService({ db, base: b.budgetBase }) : {}), ...(has('bud_dept_budgets') ? createDeptService({ db, base: b.budgetBase }) : {}) };
    bindBud(db, svc);
    if (svc.ledger) {
      const types = [...Object.keys(COMMIT_EVENTS).flatMap((k) => ['approved', 'amended', 'closed', 'short_closed', 'cancelled'].map((v) => `${k}.${v}`)), ...ACTUAL_EVENTS.flatMap((k) => ['posted', 'reversed'].map((v) => `${k}.${v}`))];
      runtimeOf(db)?.bus?.subscribe(types, (e) => { svc.ledger.onEvent(e); }, { consumer: 'bud.ledger' });
      listExports.register('bud.ledger', { source: () => { throw new Error('The ledger report is exported from its own page'); }, hidden: () => [] });
    }
    if (svc.dept) {
      runtimeOf(db)?.bus?.subscribe([`${GL_EVENT_FAMILY}.posted`, `${GL_EVENT_FAMILY}.reversed`], (e) => { svc.dept.actuals.onEvent(e); }, { consumer: 'bud.dept_actuals' });
      listExports.register('bud.dept_budgets', { source: (actor, req) => svc.dept.budgets.exportSource(actor, req), hidden: () => [] });
    }
    if (svc.changes) {
      listExports.register('bud.changes', { source: (actor, req) => svc.changes.exportSource(actor, req), hidden: () => [] });
      runtimeOf(db)?.bus?.subscribe('ctr.variation.approved', (e) => { svc.changes.fromVariation(e); }, { consumer: 'bud.variation' });
    }
    listExports.register('bud.budgets', { source: (actor, req) => svc.budgets.exportSource(actor, req), hidden: () => [] });
    const router = Router();
    router.use(gate);
    router.use((req, res, next) => (/^\/(changes|change-options|compare)(\/|$)/.test(req.path) ? (flags.isOn(req.actor, 'ff.bud.p1202') ? next() : next(notFound('Budget changes are not enabled for your company yet (feature flag ff.bud.p1202 is OFF).'))) : /^\/(check|availability|ledger|commitments|ingest|check-config)(\/|$)/.test(req.path) ? (flags.isOn(req.actor, 'ff.bud.p1203') ? next() : next(notFound('The budget check is not enabled for your company yet (feature flag ff.bud.p1203 is OFF).'))) : next()));
    router.use((req, res, next) => (/^\/(dept-options|dept-budgets|dept-report|dept-actuals|alloc-rules|alloc)(\/|$)/.test(req.path) ? (flags.isOn(req.actor, 'ff.bud.p1204') ? next() : next(notFound('Department budgets are not enabled for your company yet (feature flag ff.bud.p1204 is OFF).'))) : next()));
    router.use(budRoutes(svc, { exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
    api.use('/bud', router);
  },
};
