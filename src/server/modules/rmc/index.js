import { authzOf } from '../../platform/authz/index.js';
import { eventTypes } from '../../platform/events/index.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports } from '../../platform/list/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { workflowTypes } from '../../platform/workflow/index.js';
import { createFlagService } from '../core/api.js';
import { createBase } from '../proc/base.js';
import { STATUS } from '../qa/flow.js';
import { createPlantService } from './plants.js';
import { createMixService } from './mix.js';
import { createProductionService } from './production.js';
import { productionRoutes } from './production-routes.js';
import { createCostingService } from './costing.js';
import { costingRoutes } from './costing-routes.js';
import { widgetRegistry } from '../../platform/widgets/index.js';
import { rmcRoutes } from './routes.js';

// Batching plant and ready-mix concrete (module M20): the plant master and mix designs (20.01), production, dispatch and delivery tickets (20.02), costing (20.03).
const services = new WeakMap();
export const rmcOf = (db) => services.get(db) ?? null;
export const RMC_DOCS = { plant: 'RMC_PLANT', mix: 'RMC_MIX', requisition: 'RMC_REQUISITION', ticket: 'RMC_TICKET', rate: 'RMC_RATE' };

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['rmc.plant.approved', 'A batching plant (or a new version of it) was approved (part 20.01): data { plantId, rootId, code, name, projectId, siteId, projectIds, capacityM3h, costCentre, budgetHead, versionNo }. Production (20.02) and costing (20.03) read it.'],
  ['rmc.plant.reassigned', 'An approved plant was moved to another project, site, cost centre or budget head (part 20.01 FR-02): same data as rmc.plant.approved. Costing charges the new cost centre from the effective date.'],
  ['rmc.silo.adjusted', 'The level of a silo or bin was set from a dip reading or a delivery, with a reason (part 20.01): data { siloId, plantId, itemId, from, to, reason, projectId, siteId }.'],
  ['rmc.scale.calibrated', 'The calibration of a weighing scale was recorded (part 20.01): data { scaleId, plantId, type, calibratedOn, calibrationDue, projectId, siteId }.'],
  ['rmc.mix_design.approved', 'A mix design version was approved (part 20.01): data { mixDesignId, docNo, code, plantId, grade, versionNo, effectiveFrom, effectiveTo, projectId, siteId, wcRatio, lines [{ component, itemId, kgPerM3 }] }. Production (20.02) may use it from its effective date (BR-01).'],
  ['rmc.requisition.approved', 'A concrete requisition was approved by the construction manager (part 20.02): data { requisitionId, docNo, projectId, siteId, pourCardId, grade, qty, requiredAt, pumpRequired }. The plant in-charge schedules it.'],
  ['rmc.requisition.scheduled', 'A requisition was put on a plant with a mix design in force, or given to an external supplier (part 20.02): same data as rmc.requisition.approved plus plantId, mixDesignId, supplierId, slotFrom, slotTo.'],
  ['rmc.batch.recorded', 'A batch was recorded with the actual weights (part 20.02): data { batchId, docNo, plantId, requisitionId, mixDesignId, grade, qty, batchTime, projectId, siteId, origin, flagged, materials [{ component, itemId, kg }], untracked }. The materials have left the silos; stores (16.04) books the issue from materials.'],
  ['rmc.batch.cancelled', 'A batch was cancelled and its materials put back into the silos (part 20.02): data { batchId, docNo, plantId, reason }.'],
  ['rmc.consumption.variance', 'A batch used a material beyond the tolerance of the mix design (part 20.02 BR-01): same data as rmc.batch.recorded plus maxVariancePct and tolerancePct.'],
  ['rmc.ticket.dispatched', 'A truck left with concrete on a delivery ticket (part 20.02): data { ticketId, ticketNo, requisitionId, plantId, supplierId, batchId, mixDesignId, grade, qty, truckNo, projectId, siteId }.'],
  ['rmc.ticket.received', 'The site engineer received a truck (part 20.02): data { ticketId, ticketNo, requisitionId, pourCardId, pourLinked, plantId, supplierId, batchId, mixDesignId, grade, qty, returned, wasted, net, slumpMm, unloadEnd, receivedBy, projectId, siteId }. The net quantity is on the pour card (18.05); cube samples are cast from the ticket.'],
  ['rmc.ticket.rejected', 'The site rejected a whole truck (part 20.02): same data as rmc.ticket.received plus reason.'],
  ['rmc.ticket.slump_out', 'The slump measured at site is outside the tolerance of the mix design (part 20.02): data { ticketId, ticketNo, slumpMm, targetMm }.'],
  ['rmc.concrete.returned', 'Concrete came back or was wasted (part 20.02): data { ticketId, ticketNo, plantId, grade, returned, wasted, reason }. Costing (20.03) counts it as wastage.'],
  ['rmc.transfer_rate.approved', 'An internal transfer rate for a grade at a plant was approved by the plant in-charge and the CFO (part 20.03): data { rateId, docNo, plantId, grade, rate (rupees per m3), previous, effectiveFrom }.'],
  ['rmc.cost.period_closed', 'A month of plant costing was closed (part 20.03 BR-01): data { periodId, docNo, plantId, period, total, volume, perM3, revenue, profit (rupees), costCentre }. Finance (23.02) reads it.'],
  ['rmc.charge.posted', 'The plant charged a project for the concrete put in place in a month at the internal transfer rate (part 20.03 FR-05): data { chargeId, periodId, period, plantId, plantCode, projectId, grade, volume, rate, amount, costAllocated, variance (rupees), costCentre, budgetHead }. Project costs (14.07) and finance (23.02) book it.'],
  ['rmc.charge.reversed', 'A closed month was reopened and its charge to a project is withdrawn (part 20.03): data { chargeId, periodId, period, plantId, projectId, grade, amount, reason }.'],
  ['rmc.ticket.approved', 'A delivery ticket was approved by the plant in-charge (part 20.02): same data as rmc.ticket.received. Costing (20.03) charges the project from approved tickets.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'rmc', description });

integrityRegistry.register({
  statuses: { bp_plants: Object.keys(STATUS), bp_mix_designs: Object.keys(STATUS), bp_requisitions: Object.keys(STATUS), bp_delivery_tickets: Object.keys(STATUS), bp_batches: ['ACTIVE', 'CANCELLED'], bp_transfer_rates: Object.keys(STATUS), bp_cost_periods: ['OPEN', 'CLOSED'], bp_silos: ['ACTIVE', 'INACTIVE'], bp_scales: ['ACTIVE', 'INACTIVE'] },
  uniqueKeys: [{ table: 'bp_plants', columns: ['company_id', 'doc_no'] }, { table: 'bp_mix_designs', columns: ['company_id', 'doc_no'] }, { table: 'bp_requisitions', columns: ['company_id', 'doc_no'] }, { table: 'bp_delivery_tickets', columns: ['company_id', 'ticket_no'] }, { table: 'bp_batches', columns: ['company_id', 'doc_no'] }, { table: 'bp_transfer_rates', columns: ['company_id', 'doc_no'] }, { table: 'bp_cost_periods', columns: ['company_id', 'doc_no'] }, { table: 'bp_cost_periods', columns: ['plant_id', 'period'] }, { table: 'bp_silos', columns: ['plant_id', 'code'] }, { table: 'bp_scales', columns: ['plant_id', 'code'] }],
});

export const rmc = {
  code: 'rmc',
  name: 'Batching Plant and RMC',
  routePrefix: '/api/v1/rmc',
  ownerPart: '20.01',
  status: 'Batching plants with silos, scales and calibration; mix designs with proportions, water-binder ratio, trials and versions; production, dispatch and delivery tickets; plant costing.',
  tables: ['bp_plants', 'bp_silos', 'bp_scales', 'bp_mix_designs', 'bp_requisitions', 'bp_batches', 'bp_delivery_tickets', 'bp_silo_moves', 'bp_cost_periods', 'bp_cost_lines', 'bp_cost_grades', 'bp_transfer_rates', 'bp_charges', 'bp_budgets'],
  resources: ['plants', 'silos', 'scales', 'mix-designs', 'requisitions', 'batches', 'delivery-tickets', 'consumption', 'production', 'transfer-rates', 'cost-periods', 'costing', 'cost-report', 'budgets'],
  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bp_plants'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment }); const base = createBase({ db });
    const pl = createPlantService({ db, base, flags }); const mx = createMixService({ db, base, flags, plants: pl });
    const pr = createProductionService({ db, base, flags, plants: pl, mixes: mx }); const co = createCostingService({ db, base, flags, plants: pl });
    const deciders = { [RMC_DOCS.plant]: pl.decide, [RMC_DOCS.mix]: mx.decide, [RMC_DOCS.requisition]: pr.requisitions.decide, [RMC_DOCS.ticket]: pr.tickets.decide, [RMC_DOCS.rate]: co.rates.decide };
    const svc = { plants: pl, mixes: mx, plantSweep: pl.sweep, ...pr, ...co };
    const ctx = { svc, base, flags, deciders, parts: { production: (r, h) => productionRoutes(r, svc, h), costing: (r, h) => costingRoutes(r, svc, h) } };
    services.set(db, ctx);
    listExports.register('rmc.plants', { source: (actor, req) => { base.need(actor, 'rmc.plant.export', 'export plants'); return pl.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('rmc.mix_designs', { source: (actor, req) => { base.need(actor, 'rmc.mix_design.export', 'export mix designs'); return mx.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    const runtime = runtimeOf(db);
    runtime?.jobs?.register('rmc.scale_sweep', (jctx) => { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) n += pl.sweep(c.id).told; jctx.log(`${n} calibration reminder(s)`); return { n }; }, { maxAttempts: 2, description: 'Weighing scales whose calibration is due or overdue, told to the plant team' });
    runtime?.scheduler?.define({ code: 'rmc.scale_sweep_morning', cron: '15 1 * * *', jobType: 'rmc.scale_sweep', description: 'Every morning 06:45 India time: scale calibration reminders' });
    listExports.register('rmc.requisitions', { source: (actor, req) => { base.need(actor, 'rmc.requisition.export', 'export requisitions'); return pr.requisitions.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('rmc.delivery_tickets', { source: (actor, req) => { base.need(actor, 'rmc.delivery_ticket.export', 'export delivery tickets'); return pr.tickets.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    runtime?.jobs?.register('rmc.production_sweep', (jctx) => { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) n += pr.productionSweep(c.id).told; jctx.log(`${n} unscheduled requisition(s) reported`); return { n }; }, { maxAttempts: 1, description: 'Approved requisitions wanted within four hours and not yet scheduled, told to the plant in-charge' });
    runtime?.scheduler?.define({ code: 'rmc.production_sweep_quarter', cron: '*/15 * * * *', jobType: 'rmc.production_sweep', description: 'Every 15 minutes: requisitions that are close and not scheduled' });
    listExports.register('rmc.transfer_rates', { source: (actor, req) => { base.need(actor, 'rmc.transfer_rate.export', 'export transfer rates'); return co.rates.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    runtime?.jobs?.register('rmc.cost_sweep', (jctx) => { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) n += co.costSweep(c.id).told; jctx.log(`${n} open cost period(s) reported`); return { n }; }, { maxAttempts: 2, description: 'Plant cost periods of months that have ended and are still open, told to the plant in-charge and accounts' });
    runtime?.scheduler?.define({ code: 'rmc.cost_sweep_monthly', cron: '30 3 2 * *', jobType: 'rmc.cost_sweep', description: 'The 2nd of each month 09:00 India time: open cost periods of the month that ended' });
    api.use('/rmc', rmcRoutes(svc, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags, parts: ctx.parts }));
  },
};

const rmcObject = (table, perm, route, label, { codeCol = 'doc_no' } = {}) => objectTypes.register({
  type: table, label, permission: `${perm}.view`, route: (id) => `${route}${id}`, attachmentEntity: table, approvalTarget: table,
  access(db, actor, id) { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(Number(id), actor.companyId); if (!r || !authzOf(db).check(actor, `${perm}.view`, { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined }).allowed) return null; return { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined }; },
  auditEntities: (id) => [{ entity: table, id }],
  summary(db, actor, id) { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ?`).get(Number(id), actor.companyId); return r ? { label: `${r[codeCol]} ${r.name ?? r.code ?? ''}`.trim(), status: r.status ?? 'ACTIVE' } : null; },
  related: () => [],
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, `${perm}.view`).allowed) return []; return db.prepare(`SELECT id FROM ${table} WHERE company_id = ? AND deleted_at IS NULL AND (${codeCol} LIKE ? OR code LIKE ?) ORDER BY id DESC LIMIT ?`).all(actor.companyId, `%${q}%`, `%${q}%`, limit).map((x) => x.id); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare(`SELECT id FROM ${table} WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?`).all(companyId, projectId, limit).map((x) => x.id); },
});
rmcObject('bp_plants', 'rmc.plant', '/rmc/plants?id=', 'Batching plant');
rmcObject('bp_mix_designs', 'rmc.mix_design', '/rmc/mix-designs?id=', 'Mix design');
rmcObject('bp_requisitions', 'rmc.requisition', '/rmc/requisitions?id=', 'Concrete requisition');
rmcObject('bp_delivery_tickets', 'rmc.delivery_ticket', '/rmc/delivery-tickets?id=', 'Delivery ticket', { codeCol: 'ticket_no' });
rmcObject('bp_batches', 'rmc.batch', '/rmc/batches?id=', 'Batch record');
rmcObject('bp_transfer_rates', 'rmc.transfer_rate', '/rmc/transfer-rates?id=', 'Internal transfer rate');

const approver = (code, name, role, slaHours, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours, requireAttachment: false, checklist: [], when, notify: [], action: null });
const decideHook = (docType) => ({ onApproved: (db, { instance, actor, comment }) => rmcOf(db)?.deciders[docType](instance, actor, 'APPROVED', comment), onRejected: (db, { instance, actor, comment }) => rmcOf(db)?.deciders[docType](instance, actor, 'REJECTED', comment), onReturned: (db, { instance, actor, comment }) => rmcOf(db)?.deciders[docType](instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => rmcOf(db)?.deciders[docType](instance, actor, 'CANCELLED', comment) });
/** Registers the workflow type of an approval document of the module. */
/** @param {any} o */
export function registerRmcWorkflow({ docType, label, table, route, name, steps, title, fields, owner = 'PLANTMGR' }) {
  workflowTypes.register({
    docType, label, processOwner: owner, route: (id) => `${route}${id}`,
    describe(db, companyId, id) { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no ?? r.code, title: `${r.doc_no ?? r.code} ${title(r)}`.slice(0, 300), originator: r.requested_by, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined } : null; },
    summarise(db, _actor, id) { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id)); return r ? { fields: fields(r) } : null; },
    defaultDefinition: { name, settings: { resubmit: 'first', distinctApprovers: true }, steps },
    hooks: decideHook(docType),
  });
}
registerRmcWorkflow({ docType: RMC_DOCS.plant, label: 'Batching plant', table: 'bp_plants', route: '/rmc/plants?id=', name: 'Batching plant: the project manager (a move to another project, site or cost centre is approved again)', steps: [approver('PM', 'Project manager', 'PM', 48)], title: (r) => `${r.code} ${r.name}`, fields: (r) => [{ label: 'Plant', value: `${r.code} ${r.name} version ${r.version_no}` }, { label: 'Cost centre', value: r.cc_code ?? '-' }, { label: 'Capacity', value: `${(r.capacity_m3h_milli ?? 0) / 1000} m3/hr` }] });
registerRmcWorkflow({ docType: RMC_DOCS.mix, label: 'Mix design', table: 'bp_mix_designs', route: '/rmc/mix-designs?id=', name: 'Mix design: the plant quality engineer, the quality control manager, the consultant when required', owner: 'QCMGR',
  steps: [approver('QCE', 'Plant quality engineer', 'QCE', 48), approver('QCMGR', 'Quality control manager', 'QCMGR', 48), approver('XCON', 'Consultant (portal)', 'X-CON', 72, { field: 'consultant', op: 'eq', value: 'yes' })], title: (r) => `${r.code} version ${r.version_no} ${r.grade}`, fields: (r) => [{ label: 'Mix design', value: `${r.code} version ${r.version_no}` }, { label: 'Grade', value: r.grade }, { label: 'Water-binder ratio', value: String((r.wc_ratio_milli ?? 0) / 1000) }] });
registerRmcWorkflow({ docType: RMC_DOCS.requisition, label: 'Concrete requisition', table: 'bp_requisitions', route: '/rmc/requisitions?id=', name: 'Concrete requisition: the site engineer asks, the construction manager approves', steps: [approver('CM', 'Construction manager', 'CM', 24)], title: (r) => `${r.grade} ${(r.qty_milli ?? 0) / 1000} m3`, fields: (r) => [{ label: 'Requisition', value: r.doc_no }, { label: 'Grade / quantity', value: `${r.grade} / ${(r.qty_milli ?? 0) / 1000} m3` }, { label: 'Wanted at', value: String(r.required_at).replace('T', ' ') }] });
registerRmcWorkflow({ docType: RMC_DOCS.ticket, label: 'Delivery ticket', table: 'bp_delivery_tickets', route: '/rmc/delivery-tickets?id=', name: 'Delivery ticket: the plant in-charge confirms the load that was received', steps: [approver('PLANTMGR', 'Plant in-charge', 'PLANTMGR', 48)], title: (r) => `${r.ticket_no} ${r.grade} ${(r.qty_milli ?? 0) / 1000} m3`, fields: (r) => [{ label: 'Ticket', value: r.ticket_no }, { label: 'Truck', value: r.truck_no }, { label: 'Quantity', value: `${(r.qty_milli ?? 0) / 1000} m3` }] });
registerRmcWorkflow({ docType: RMC_DOCS.rate, label: 'Internal transfer rate', table: 'bp_transfer_rates', route: '/rmc/transfer-rates?id=', name: 'Internal transfer rate: the plant in-charge, then the CFO', owner: 'CFO', steps: [approver('PLANTMGR', 'Plant in-charge', 'PLANTMGR', 48), approver('CFO', 'CFO', 'CFO', 72)], title: (r) => `${r.grade} ${(r.rate_paise ?? 0) / 100} from ${r.effective_from}`, fields: (r) => [{ label: 'Rate', value: r.doc_no }, { label: 'Grade', value: r.grade }, { label: 'Rate per m3', value: String((r.rate_paise ?? 0) / 100) }, { label: 'Effective from', value: r.effective_from }] });
widgetRegistry.register({ code: 'rmc.cost_per_m3', provider: (ctx) => rmcOf(ctx.db)?.svc.costWidget(ctx.actor) ?? { value: 0, unit: '', previous: null, trendPct: null, target: null, status: 'neutral', note: 'Plant costing is not available.' } });
