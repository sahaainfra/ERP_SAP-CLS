import { createHash } from 'node:crypto';
import { Router } from 'express';
import { authzOf } from '../../platform/authz/index.js';
import { eventTypes } from '../../platform/events/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports } from '../../platform/list/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { evidenceProviders, workflowTypes } from '../../platform/workflow/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { createFlagService } from '../core/api.js';
import { createBase } from './base.js';
import { createStockService } from './stock.js';
import { MR_DOC, MR_STATUS, createMrService } from './mr.js';
import { PR_DOC, PR_STATUS, createPrService } from './pr.js';
import { RUN_STATUS, createMrpService } from './mrp.js';
import { PARAM_DOC, PARAM_STATUS, createItemParamService } from './item-params.js';
import { RFQ_DOC, RFQ_STATUS, QUOTE_STATUS, createRfqService } from './rfq.js';
import { CS_DOC, CS_STATUS, createCsService } from './cs.js';
import { PO_DOC, AMEND_DOC, CLOSE_DOC, ADV_DOC, PO_STATUS, createPoService } from './po.js';
import { RC_DOC, PV_DOC, RC_STATUS, PV_STATUS, createRcService } from './rc.js';
import { SO_DOC, SES_DOC, SO_STATUS, SES_STATUS, createSoService } from './so.js';
import { XPD_DOC, IRN_DOC, XPD_STATUS, INSP_STATUS, SHIP_STATUS, createXpdService } from './xpd.js';
import { PREQ_DOC, SUSP_DOC, APPROVAL_STATUS, createVndService } from './vnd.js';
import { createRtiService } from './rti.js';
import { createAnaService } from './ana.js';
import { registerProject360Widget } from '../proj/p360.js';
import { procRoutes, vendorQuoteRoutes } from './routes.js';

const services = new WeakMap();
export const procOf = (db) => services.get(db) ?? null;
// the procurement slot of Project 360 (10.08, FR of 15.10): the figures of the project from the analytics service, only for a person who may see procurement analytics and where the part is on
registerProject360Widget('procurement', (ctx) => {
  const s = procOf(ctx.db); const pid = ctx.project.project_id;
  if (!s || !s.flags.isOn(ctx.actor, 'ff.proc.p1510')) return { figures: [], rows: [], note: 'The procurement dashboard is not enabled for your company yet.' };
  if (!s.base.may(ctx.actor, 'proc.analytics.view', pid)) return { figures: [], rows: [], note: 'You have no right to see procurement analytics for this project.' };
  return s.anaSvc.projectWidget(ctx.actor, pid);
});

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['proc.mr.approved', 'A material request (site indent) was approved by the construction manager (part 15.01): data { mrId, docNo, projectId, siteId, requiredBy, priority, waId, activityId, supersedes, lines: [{ lineId, lineNo, itemId, qty, uom, wbsId, costCodeId }] }.'],
  ['proc.mr.cancelled', 'A material request was cancelled (part 15.01): data { mrId, docNo, projectId, siteId, reason }.'],
  ['proc.mr.issue_requested', 'The procurement officer asked for a line of an approved material request to be issued from the stock of the site (part 15.01): data { mrId, lineId, lineNo, itemId, qty, uom, fromStore, toSiteId }. For the stock module (16.04).'],
  ['proc.mr.transfer_requested', 'A line of an approved material request is to be transferred from another store (part 15.01): data { mrId, lineId, lineNo, itemId, qty, uom, fromStore, fromStoreKind, toSiteId }. For the stock module (16.05).'],
  ['proc.pr.approved', 'A purchase requisition was approved (by value: the project manager, the project director, the procurement manager) or an emergency one was regularised (part 15.01): data { prId, docNo, projectId, siteId, requiredBy, priority, emergency, amount, supersedes, source, commitment, lines: [{ lineId, lineNo, itemId, serviceDesc, qty, uom, estRate, requiredBy, deliverySiteId, wbsId, costCodeId, preferredVendorId, spec, mrLines: [{ mrId, mrLineId, qty }] }] }. For the enquiry (15.03); its soft commitment is in the ledger of 12.03.'],
  ['proc.pr.cancelled', 'A purchase requisition was cancelled and its commitment released (part 15.01): data { prId, docNo, projectId, reason }.'],
  ['proc.pr.closed', 'A purchase requisition was short-closed: what is not ordered is given up (part 15.01): data { prId, docNo, projectId, reason }.'],
  ['proc.pr.emergency_raised', 'An emergency purchase was sent; the project manager regularises it by approving it (control CP-PROC-06, part 15.01): data { prId, docNo, projectId, regulariseBy, reason, amount }.'],
  ['proc.pr.regularisation_overdue', 'An emergency purchase was not regularised within the hours set (part 15.01): data { prId, docNo, projectId, regulariseBy, reason }.'],
  ['proc.mrp.run_completed', 'An MRP run of a project was made (part 15.02): data { runId, docNo, projectId, items, shortages, proposals, late }. The proposals wait for the planner; the lines are at GET /proc/runs/:id.'],
  ['proc.mrp.shortages_found', 'An MRP run found weeks in which the stock, orders and requisitions do not cover the requirement (part 15.02): data { runId, docNo, projectId, shortages: [{ itemId, weekStart, shortQty, requiredBy, orderBy, late }] }. For the look-ahead constraints of the schedule (13.04).'],
  ['proc.mrp.proposals_accepted', 'A planner accepted MRP proposals and a draft purchase requisition was made (part 15.02): data { runId, docNo, projectId, prId, prNo, proposals: [id] }. The requisition is not approved: it follows the approval by value of 15.01.'],
  ['proc.rfq.issued', 'An RFQ was issued to vendors (part 15.03): data { rfqId, docNo, projectId, title, dueDate, vendors: [vendorId], lines: [{ lineId, lineNo, prLineId, itemId, qty, uom }] }.'],
  ['proc.rfq.amended', 'The due date or terms of an issued RFQ were changed (part 15.03): data { rfqId, docNo, projectId, dueDate, reason }.'],
  ['proc.rfq.closed', 'An RFQ was closed to further quotations (part 15.03): data { rfqId, docNo, projectId, quotations, reason, shortOfMinimum }. The quotations are at GET /proc/rfqs/:id/comparison, for the comparative statement (15.04).'],
  ['proc.rfq.cancelled', 'An RFQ was cancelled (part 15.03): data { rfqId, docNo, projectId, reason, wasIssued }.'],
  ['proc.quotation.received', 'A vendor quotation was recorded as received, keyed in by procurement or entered by the vendor (part 15.03): data { rfqId, quotationId, quotationNo, rfqNo, projectId, vendorId, versionNo, validUntil, totalLanded, via }. For the comparative statement (15.04).'],
  ['proc.quotation.withdrawn', 'A received quotation was withdrawn (part 15.03): data { rfqId, quotationId, vendorId, reason }.'],
  ['proc.rate.observed', 'A rate quoted by a vendor for an item, with its landed rate (part 15.03): data { quotationId, vendorId, itemId, uom, rate, discountPct, landedRate, gstRate, gstInclusive, observedOn, validUntil, source }. Rates in paise. For the rate intelligence (15.09).'],
  ['proc.cs.generated', 'A comparative statement was generated from the quotations of an RFQ (part 15.04): data { csId, docNo, rfqId, projectId, type }.'],
  ['proc.cs.approved', 'A comparative statement was approved: the vendor selection is final (part 15.04): data { csId, docNo, rfqId, projectId, totalValue, nonL1, supersedes, awards: [{ rfqLineId, prLineId, itemId, serviceDesc, vendorId, quotationId, qty, uom, rate, landedRate, gstRate, make, requiredBy, deliverySiteId }] }. Rates in paise, quantities in thousandths. For the purchase order (15.05).'],
  ['proc.cs.rejected', 'A comparative statement was not approved (part 15.04): data { csId, docNo, rfqId, projectId, reason }.'],
  ['proc.cs.cancelled', 'A comparative statement was cancelled; an approved one may no longer be ordered from (part 15.04): data { csId, docNo, rfqId, projectId, reason, wasApproved }.'],
  ['proc.po.approved', 'A purchase order was approved and sent to the vendor; the commitment is in the ledger (part 15.05): data { poId, docNo, projectId, vendorId, totalAmount, totalBasic, supplyType, csId, lines: [{ lineId, lineNo, prLineId, itemId, qty, uom, rate, discountPct, gstPct, amount, deliverySiteId, wbsId, costCodeId, schedule: [{ dueDate, qty }] }] }. For the goods receipt (16.02/16.03), expediting (15.07), invoice matching (22.06), the supplier portal (25.02).'],
  ['proc.po.amended', 'An amendment of a purchase order was approved (part 15.05): data { poId, docNo, amendmentNo, deltaAmount, totalAmount, reason, lines: [{ prLineId, qty }] } where qty is the change.'],
  ['proc.po.closed', 'A purchase order was short-closed or delivered in full (part 15.05): data { poId, docNo, reason, shortClosed }.'],
  ['proc.po.cancelled', 'A purchase order was cancelled; nothing was received (part 15.05): data { poId, docNo, reason, lines: [{ prLineId, qty }] } with negative quantities that return the balance to the requisition.'],
  ['proc.po.acknowledged', 'The vendor acknowledged a purchase order (part 15.05): data { poId, docNo, acknowledgedBy }.'],
  ['proc.po.dispatched', 'A dispatch (advance shipping notice) was recorded against a purchase order (part 15.05): data { poId, docNo, dispatchId, asnNo, expectedArrival, ewayBillNo, lines: [{ poLineId, qty }] }.'],
  ['proc.po.received', 'Goods were received against a purchase order (part 15.05): data { poId, docNo, lines: [{ lineId, receivedQty, acceptedQty, balanceQty }] }.'],
  ['proc.po.overdue', 'A delivery of a purchase order is past its date (part 15.05): data { poId, docNo, lines: [{ lineNo, dueDate, balanceQty }] }.'],
  ['proc.po.advance_approved', 'An advance payment against a purchase order was approved (part 15.05): data { poId, docNo, advanceId, advanceNo, amount, neededBy, vendorName }. For the payment request (23.04).'],
  ['proc.rc.approved', 'A rate contract came into force (part 15.06): data { rcId, docNo, vendorId, validFrom, validTo, ceilingValue, supersedes, lines: [{ lineId, itemId, rate, uom, ceilingQty }] }. Rates in rupees. For call-off orders and the rate lookup of requisitions.'],
  ['proc.rc.pv_applied', 'A price-variation revision of a rate contract was approved and the rates changed (part 15.06): data { rcId, docNo, revisionId, indexCode, period, indexValue, effectiveFrom, lines: [{ rcLineId, oldRate, newRate }] }.'],
  ['proc.rc.cancelled', 'A rate contract was cancelled (part 15.06): data { rcId, docNo, reason, wasInForce }.'],
  ['proc.rc.closed', 'A rate contract in force was closed (part 15.06): data { rcId, docNo, reason }.'],
  ['proc.rc.ceiling_reached', 'The ceiling of a rate contract is used (part 15.06): data { rcId, docNo, usedPct }.'],
  ['proc.rc.expiring', 'A rate contract ends within the days set or has ended (part 15.06): data { rcId, docNo, validTo, daysLeft }.'],
  ['proc.so.approved', 'A service order was approved; its commitment is in the ledger (part 15.06): data { soId, docNo, projectId, vendorId, totalValue, supersedes, startDate, endDate, lines: [{ lineId, lineNo, description, qty, rate, amount }] }.'],
  ['proc.so.closed', 'A service order was closed and its commitment released (part 15.06): data { soId, docNo, reason, certifiedValue }.'],
  ['proc.so.cancelled', 'A service order was cancelled (part 15.06): data { soId, docNo, reason }.'],
  ['proc.service_entry.approved', 'A service entry sheet was certified (part 15.06): data { sesId, docNo, soId, soNo, vendorId, periodFrom, periodTo, amount, supersedes, lines: [{ soLineId, qty, rate, amount }] }. For invoice matching (22.06).'],
  ['proc.service_entry.reversed', 'A certified service entry sheet was cancelled and its certification undone (part 15.06): data { sesId, docNo, soId, reason, amount }.'],
  ['proc.expediting.plan_approved', 'An expediting plan was approved (part 15.07): data { planId, docNo, poId, requiredOnSite, eta, supersedes }.'],
  ['proc.expediting.milestone_updated', 'A milestone of an expediting plan was updated by the buyer or the vendor (part 15.07): data { planId, docNo, milestoneId, name, forecastDate, actualDate, status, via }.'],
  ['proc.expediting.eta_updated', 'The date an ordered item will reach the site changed (part 15.07): data { planId, docNo, poId, poNo, eta, requiredOnSite, daysLate, items: [{ itemId, qty, uom }] }. For the look-ahead constraints (13.04).'],
  ['proc.expediting.delay_detected', 'An ordered item is expected after the date required on site (part 15.07): data { planId, docNo, poId, poNo, eta, requiredOnSite, daysLate, milestones, activities: [{ activityId, code, name, start, finish, daysBeforeArrival }] }.'],
  ['proc.inspection.irn_issued', 'An inspection release note was issued (part 15.07): data { inspectionId, docNo, irnNo, poId, type, result, supersedes }.'],
  ['proc.inspection.failed', 'An inspection at the vendor works failed (part 15.07): data { inspectionId, docNo, poId, type }.'],
  ['proc.shipment.dispatched', 'A shipment left the vendor (part 15.07): data { shipmentId, shipmentNo, poId, poNo, vendorId, transporter, vehicleNo, lrNo, ewayBillNo, eta, isOdc, clearance, lines: [{ poLineId, lineNo, qty, uom }] }. For the gate entry (16.02).'],
  ['proc.shipment.delivered', 'A shipment was delivered at site (part 15.07): data { shipmentId, shipmentNo, poId, deliveredOn, lines }.'],
  ['proc.vendor.avl_updated', 'A prequalification was approved and the vendor is on the approved vendor list (part 15.08): data { prequalId, docNo, partnerId, status, validUntil, entries: [{ categoryId, region }] }. RFQ eligibility (15.03) reads it.'],
  ['proc.vendor.suspended', 'A vendor was suspended on the approved vendor list (part 15.08): data { suspensionId, docNo, partnerId, avlIds, reason }.'],
  ['proc.vendor.scorecard_computed', 'A vendor scorecard was worked out for a period (part 15.08): data { scorecardId, partnerId, period, total, rating }. For the decision evidence panel (04.03) and AI forecasting (28.03).'],
  ['proc.rate.surveyed', 'A market survey rate was entered in the rate history (part 15.09): data { observationId, itemId, region, source, rate, uom, outlier }.'],
  ['proc.stock.levels_loaded', 'Free stock levels of items in stores were loaded for the stock check (part 15.01): data { levels, changed }. Until the stock module (16.01) keeps them.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'proc', description });

integrityRegistry.register({
  statuses: { proc_material_requests: Object.keys(MR_STATUS), proc_requisitions: Object.keys(PR_STATUS), proc_mrp_runs: Object.keys(RUN_STATUS), proc_item_params: Object.keys(PARAM_STATUS), proc_rfqs: Object.keys(RFQ_STATUS), proc_quotations: Object.keys(QUOTE_STATUS), proc_comparative_statements: Object.keys(CS_STATUS), proc_purchase_orders: Object.keys(PO_STATUS), proc_rate_contracts: Object.keys(RC_STATUS), proc_rc_revisions: Object.keys(PV_STATUS), proc_service_orders: Object.keys(SO_STATUS), proc_service_entries: Object.keys(SES_STATUS), vnd_prequalifications: Object.keys(APPROVAL_STATUS), vnd_suspensions: Object.keys(APPROVAL_STATUS), xpd_expediting_plans: Object.keys(XPD_STATUS), xpd_inspections: Object.keys(INSP_STATUS), xpd_shipments: Object.keys(SHIP_STATUS), proc_po_amendments: ['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED'], proc_po_advances: ['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED'], proc_dispatches: ['DISPATCHED', 'RECEIVED', 'CANCELLED'] },
  uniqueKeys: [{ table: 'proc_material_requests', columns: ['company_id', 'doc_no'] }, { table: 'proc_requisitions', columns: ['company_id', 'doc_no'] }, { table: 'proc_mrp_runs', columns: ['company_id', 'doc_no'] }, { table: 'proc_rfqs', columns: ['company_id', 'doc_no'] }, { table: 'proc_quotations', columns: ['company_id', 'doc_no'] }, { table: 'proc_comparative_statements', columns: ['company_id', 'doc_no'] }, { table: 'proc_purchase_orders', columns: ['company_id', 'doc_no'] }, { table: 'proc_po_advances', columns: ['company_id', 'doc_no'] }, { table: 'proc_dispatches', columns: ['company_id', 'asn_no'] }, { table: 'proc_rate_contracts', columns: ['company_id', 'doc_no'] }, { table: 'proc_service_orders', columns: ['company_id', 'doc_no'] }, { table: 'proc_service_entries', columns: ['company_id', 'doc_no'] }, { table: 'vnd_prequalifications', columns: ['company_id', 'doc_no'] }, { table: 'vnd_suspensions', columns: ['company_id', 'doc_no'] }, { table: 'vnd_actions', columns: ['company_id', 'doc_no'] }, { table: 'xpd_expediting_plans', columns: ['company_id', 'doc_no'] }, { table: 'xpd_inspections', columns: ['company_id', 'doc_no'] }, { table: 'xpd_shipments', columns: ['company_id', 'doc_no'] }],
});

/** Module "proc": procurement (M15). Part 15.01 holds the material requests (site indents) and the purchase requisitions. The tables are `proc_*`. */
export const proc = {
  code: 'proc',
  name: 'Procurement',
  routePrefix: '/api/v1/proc',
  ownerPart: '15.01',
  status: 'Material requests (site indents) against work authorisations with the stock of the site, nearby stores and the central warehouse; fulfilment by issue, transfer or purchase; purchase requisitions from consolidated requests or direct, with stock, budget and duplicate checks, approval by value and an emergency path.',
  tables: ['proc_material_requests', 'proc_mr_lines', 'proc_requisitions', 'proc_pr_lines', 'proc_pr_sources', 'proc_stock_levels', 'proc_mrp_runs', 'proc_mrp_lines', 'proc_mrp_proposals', 'proc_item_params', 'proc_open_supply', 'proc_rfqs', 'proc_rfq_lines', 'proc_rfq_vendors', 'proc_quotations', 'proc_quotation_lines', 'proc_rfq_clarifications', 'proc_comparative_statements', 'proc_cs_lines', 'proc_cs_negotiations', 'proc_purchase_orders', 'proc_po_lines', 'proc_po_schedules', 'proc_po_amendments', 'proc_dispatches', 'proc_po_receipts', 'proc_po_advances', 'proc_price_indices', 'proc_rate_contracts', 'proc_rc_lines', 'proc_rc_revisions', 'proc_service_orders', 'proc_so_lines', 'proc_service_entries', 'proc_se_lines', 'rti_observations', 'rti_indices', 'vnd_prequalifications', 'vnd_avl', 'vnd_scorecards', 'vnd_score_inputs', 'vnd_suspensions', 'vnd_actions', 'xpd_expediting_plans', 'xpd_milestones', 'xpd_inspections', 'xpd_shipments', 'xpd_shipment_events'],
  resources: ['material-requests', 'requisitions', 'stock', 'runs', 'proposals', 'item-params', 'supply', 'mrp', 'rfqs', 'quotations', 'comparative-statements', 'purchase-orders', 'rate-contracts', 'service-orders', 'service-entries', 'expediting-plans', 'inspections', 'shipments', 'expediting', 'prequalifications', 'avl', 'avl-suspensions', 'vendor-scorecards', 'vendor-ranking', 'vendor-actions', 'rate-intelligence', 'rate-exposure', 'rate-observations', 'rate-indices', 'analytics'],

  mount(api, { db, config: appConfig, publicApi }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'proc_requisitions'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment });
    const base = createBase({ db }); const stockSvc = createStockService({ db, base }); const mrSvc = createMrService({ db, base, stock: stockSvc }); const prSvc = createPrService({ db, base, stock: stockSvc, mr: mrSvc });
    const mrpSvc = createMrpService({ db, base, stock: stockSvc, pr: prSvc }); const paramSvc = createItemParamService({ db, base });
    const rfqSvc = createRfqService({ db, base, baseUrl: () => appConfig.publicUrl ?? appConfig.appUrl ?? '' });
    const csSvc = createCsService({ db, base }); const rcSvc = createRcService({ db, base }); const soSvc = createSoService({ db, base }); const poSvc = createPoService({ db, base, baseUrl: () => appConfig.publicUrl ?? appConfig.appUrl ?? '', rc: rcSvc });
    const xpdSvc = createXpdService({ db, base }); const vndSvc = createVndService({ db, base }); const rtiSvc = createRtiService({ db, base }); const anaSvc = createAnaService({ db, base }); const svc = { flags, anaSvc, rtiSvc, vndSvc, preqDecide: vndSvc.decide, suspDecide: vndSvc.suspDecide, xpdSvc, xpdDecide: xpdSvc.decide, irnDecide: xpdSvc.irnDecide, rcSvc, soSvc, rcDecide: rcSvc.decide, pvDecide: rcSvc.pvDecide, soDecide: soSvc.decide, sesDecide: soSvc.sesDecide, poSvc, poDecide: poSvc.decide, amendDecide: poSvc.amendDecide, advanceDecide: poSvc.advanceDecide, csSvc, csDecide: csSvc.decide, base, stockSvc, mrSvc, prSvc, mrpSvc, paramSvc, rfqSvc, rfqDecide: rfqSvc.decide, mrDecide: mrSvc.decide, prDecide: prSvc.decide, paramDecide: paramSvc.decide }; services.set(db, svc);
    listExports.register('proc.mrp_runs', { source: (actor, req) => mrpSvc.mrp.exportSource(actor, req), hidden: () => [] });
    listExports.register('proc.material_requests', { source: (actor, req) => mrSvc.mrs.exportSource(actor, req), hidden: () => [] });
    listExports.register('proc.requisitions', { source: (actor, req) => prSvc.prs.exportSource(actor, req), hidden: () => [] });
    listExports.register('proc.rfqs', { source: (actor, req) => rfqSvc.rfqs.exportSource(actor, req), hidden: () => [] });
    listExports.register('proc.quotations', { source: (actor, req) => rfqSvc.quotes.exportSource(actor, req), hidden: () => [] });
    listExports.register('proc.comparative_statements', { source: (actor, req) => csSvc.css.exportSource(actor, req), hidden: () => [] });
    listExports.register('proc.purchase_orders', { source: (actor, req) => poSvc.pos.exportSource(actor, req), hidden: () => [] });
    listExports.register('proc.rate_contracts', { source: (actor, req) => rcSvc.rcs.exportSource(actor, req), hidden: () => [] });
    listExports.register('proc.service_orders', { source: (actor, req) => soSvc.sos.exportSource(actor, req), hidden: () => [] });
    listExports.register('proc.service_entries', { source: (actor, req) => soSvc.ses.exportSource(actor, req), hidden: () => [] });
    listExports.register('proc.expediting_plans', { source: (actor, req) => xpdSvc.plans.exportSource(actor, req), hidden: () => [] });
    listExports.register('proc.inspections', { source: (actor, req) => xpdSvc.insps.exportSource(actor, req), hidden: () => [] });
    listExports.register('proc.shipments', { source: (actor, req) => xpdSvc.ships.exportSource(actor, req), hidden: () => [] });
    listExports.register('proc.prequalifications', { source: (actor, req) => vndSvc.preqs.exportSource(actor, req), hidden: () => [] });
    listExports.register('proc.avl', { source: (actor, req) => vndSvc.avl.exportSource(actor, req), hidden: () => [] });
    listExports.register('proc.vendor_scorecards', { source: (actor, req) => vndSvc.scores.exportSource(actor, req), hidden: () => [] });
    listExports.register('proc.rate_observations', { source: (actor, req) => rtiSvc.observations.exportSource(actor, req), hidden: () => [] });
    const runtime = runtimeOf(db);
    // FR-01 (15.09): the rate history takes in the approved quotations, awards, orders and contracts as they happen and again every night as a catch-up
    runtime?.bus?.subscribe(['proc.quotation.received', 'proc.cs.approved', 'proc.po.approved', 'proc.rc.approved'], (e) => { const cid = Number(e.companyId ?? e.company_id); if (flags.isOn({ companyId: cid }, 'ff.proc.p1509')) rtiSvc.harvest(cid); }, { consumer: 'proc.rate_history' });
    runtime?.jobs?.register('proc.rti_harvest', (ctx) => { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) { if (!flags.isOn({ companyId: c.id }, 'ff.proc.p1509')) continue; const r = rtiSvc.harvest(c.id); n += r.QUOTATION + r.CS + r.PO + r.RATE_CONTRACT; } ctx.log(`Added ${n} observation(s) to the rate history`); return { added: n }; }, { maxAttempts: 2, description: 'Adds the rates of approved quotations, awards, purchase orders and rate contracts that are not yet in the rate history.' });
    runtime?.scheduler?.define({ code: 'proc.rti_harvest_daily', cron: '45 20 * * *', jobType: 'proc.rti_harvest', description: 'Every night 02:15 India time: the rate history catches up with procurement' });
    // FR-05 (15.08): every morning at 08:45 India time the entries of the approved vendor list that end soon are told and last quarter's scorecards are worked out
    runtime?.jobs?.register('proc.vnd_reeval', (ctx) => { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) { if (!flags.isOn({ companyId: c.id }, 'ff.proc.p1508')) continue; n += vndSvc.sweep(); break; } ctx.log(`Told ${n} re-evaluation alert(s) or scorecard(s)`); return { items: n }; }, { maxAttempts: 2, description: 'Reminds procurement of approved vendor list entries that end soon and works out last quarter\'s vendor scorecards, suggesting a suspension where a score is below the threshold.' });
    runtime?.scheduler?.define({ code: 'proc.vnd_reeval_daily', cron: '15 3 * * *', jobType: 'proc.vnd_reeval', description: 'Every day 08:45 India time: vendor re-evaluation reminders and scorecards' });
    // FR-05 (15.07): every morning at 08:30 India time milestones past their date are told and the plans at risk are worked out again
    runtime?.jobs?.register('proc.xpd_sweep', (ctx) => { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) { if (!flags.isOn({ companyId: c.id }, 'ff.proc.p1507')) continue; n += xpdSvc.sweep(); break; } ctx.log(`Told ${n} expediting alert(s)`); return { alerts: n }; }, { maxAttempts: 2, description: 'Marks milestones past their date as delayed, works out the date each ordered item reaches the site and tells procurement, the project manager and the planner of items expected after the date required.' });
    runtime?.scheduler?.define({ code: 'proc.xpd_sweep_daily', cron: '0 3 * * *', jobType: 'proc.xpd_sweep', description: 'Every day 08:30 India time: expediting delay alerts' });
    // FR-06 (15.05): every morning at 09:00 India time the buyer is told of orders with a delivery past its date
    runtime?.jobs?.register('proc.po_overdue', (ctx) => { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) { if (!flags.isOn({ companyId: c.id }, 'ff.proc.p1505')) continue; n += poSvc.extra.sweep(); break; } ctx.log(`Told the buyers of ${n} order(s) with a delivery past its date`); return { orders: n }; }, { maxAttempts: 2, description: 'Tells the buyer of each approved purchase order that has a delivery past its date.' });
    runtime?.scheduler?.define({ code: 'proc.po_overdue_daily', cron: '30 3 * * *', jobType: 'proc.po_overdue', description: 'Every day 09:00 India time: purchase orders with overdue deliveries are told to the buyer' });
    // FR-03 (15.06): every morning at 09:30 India time contracts near their ceiling or end are told, and a new index value without a revision
    runtime?.jobs?.register('proc.rc_alerts', (ctx) => { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) { if (!flags.isOn({ companyId: c.id }, 'ff.proc.p1506')) continue; n += rcSvc.sweep(); break; } ctx.log(`Told ${n} alert(s) on rate contracts`); return { alerts: n }; }, { maxAttempts: 2, description: 'Tells procurement of rate contracts that reached 80 or 100 percent of their ceiling, end soon, or have a new index value waiting for a price-variation revision.' });
    runtime?.scheduler?.define({ code: 'proc.rc_alerts_daily', cron: '0 4 * * *', jobType: 'proc.rc_alerts', description: 'Every day 09:30 India time: rate contract ceiling, expiry and price-variation alerts' });
    // FR-07: every morning at 08:00 India time vendors who have not answered are reminded and the issuer is told what is due
    runtime?.jobs?.register('proc.rfq_reminders', (ctx) => { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) { if (!flags.isOn({ companyId: c.id }, 'ff.proc.p1503')) continue; n += rfqSvc.rfqs.sweep(); break; } ctx.log(`Told the issuers of ${n} RFQ(s) that are due with vendors who have not answered`); return { rfqs: n }; }, { maxAttempts: 2, description: 'Reminds the vendors who have not answered an RFQ that closes soon and tells the buyer what is due.' });
    runtime?.scheduler?.define({ code: 'proc.rfq_reminders_daily', cron: '30 2 * * *', jobType: 'proc.rfq_reminders', description: 'Every day 08:00 India time: reminders to vendors of RFQs that close soon' });
    // the orders of 15.04 tell the balance to order
    runtime?.bus?.subscribe(['proc.po.approved', 'proc.po.cancelled', 'proc.po.amended'], (e) => { if (flags.isOn({ companyId: Number(e.companyId ?? e.company_id) }, 'ff.proc.p1501')) prSvc.onPoEvent(e); }, { consumer: 'proc.pr_balance' });
    // 16.01: the stock module reports the free stock of an item in a store after every movement; the requisition sees it through the levels (15.01)
    runtime?.bus?.subscribe(['inv.stock.moved'], (e) => { const d = e.data ?? {}; const cid = Number(e.companyId ?? e.company_id); if (!cid || d.itemId == null || !d.storeCode) return; try { stockSvc.apply(cid, [{ itemId: d.itemId, storeCode: d.storeCode, storeName: d.storeName ?? d.storeCode, kind: d.storeType === 'CENTRAL_WAREHOUSE' ? 'CENTRAL' : 'SITE', siteId: d.siteId ?? undefined, freeQty: Math.max(0, d.freeQty ?? 0) }]); } catch { /* the movement stands; the level is caught up by the next one */ } }, { consumer: 'proc.stock_levels' });
    // FR-06: an emergency purchase not regularised in time is told, once
    runtime?.jobs?.register('proc.emergency_regularisation', (ctx) => { const n = prSvc.sweepEmergencies(); ctx.log(`Told about ${n} emergency purchase(s) not regularised in time`); return { overdue: n }; }, { maxAttempts: 2, description: 'Tells the project manager, the project director and the procurement manager of emergency purchases (CP-PROC-06) that were not regularised within the hours the company allows.' });
    runtime?.scheduler?.define({ code: 'proc.emergency_regularisation_hourly', cron: '10 * * * *', jobType: 'proc.emergency_regularisation', description: 'Hourly: emergency purchases past their regularisation time are told to the project manager and the procurement manager' });
    // FR-01: every Monday at 01:00 India time a run for each active project that has an approved schedule
    runtime?.jobs?.register('proc.mrp_weekly', (ctx) => { const out = { runs: 0, skipped: 0 }; for (const c of db.prepare('SELECT id FROM org_companies').all()) { if (!flags.isOn({ companyId: c.id }, 'ff.proc.p1502')) continue; const r = mrpSvc.mrp.weekly(c.id); out.runs += r.runs; out.skipped += r.skipped; } ctx.log(`Made ${out.runs} MRP run(s), skipped ${out.skipped} project(s) with no approved schedule`); return out; }, { maxAttempts: 2, description: 'Makes the weekly MRP run of every active project that has an approved schedule and tells the planners how many proposals wait for them.' });
    runtime?.scheduler?.define({ code: 'proc.mrp_weekly_monday', cron: '30 19 * * 0', jobType: 'proc.mrp_weekly', description: 'Every Monday 01:00 India time: the weekly MRP run of each project with an approved schedule' });
    const router = Router();
    router.use((req, _res, next) => (flags.isOn(req.actor, 'ff.proc.p1501') ? next() : next(notFound('Material requests and purchase requisitions are not enabled for your company yet (feature flag ff.proc.p1501 is OFF).'))));
    router.use(/^\/(runs|proposals|item-params|supply|mrp)(\/|$)/, (req, _res, next) => (flags.isOn(req.actor, 'ff.proc.p1502') ? next() : next(notFound('Material demand planning (MRP) is not enabled for your company yet (feature flag ff.proc.p1502 is OFF).'))));
    router.use(/^\/(rfqs|quotations)(\/|$)/, (req, _res, next) => (flags.isOn(req.actor, 'ff.proc.p1503') ? next() : next(notFound('RFQs and vendor quotations are not enabled for your company yet (feature flag ff.proc.p1503 is OFF).'))));
    router.use(/^\/(rate-contracts|service-orders|service-entries)(\/|$)/, (req, _res, next) => (flags.isOn(req.actor, 'ff.proc.p1506') ? next() : next(notFound('Rate contracts and service orders are not enabled for your company yet (feature flag ff.proc.p1506 is OFF).'))));
    router.use(/^\/analytics(?=\/|$)/, (req, _res, next) => (flags.isOn(req.actor, 'ff.proc.p1510') ? next() : next(notFound('The procurement dashboard is not enabled for your company yet (feature flag ff.proc.p1510 is OFF).'))));
    router.use(/^\/(rate-intelligence|rate-exposure|rate-observations|rate-indices)(?=\/|$)/, (req, _res, next) => (flags.isOn(req.actor, 'ff.proc.p1509') ? next() : next(notFound('Material rate intelligence is not enabled for your company yet (feature flag ff.proc.p1509 is OFF).'))));
    router.use(/^\/(prequalifications|avl|avl-suspensions|vendor-scorecards|vendor-ranking|vendor-actions)(?=\/|$)/, (req, _res, next) => (flags.isOn(req.actor, 'ff.proc.p1508') ? next() : next(notFound('Vendor prequalification, the approved vendor list and scorecards are not enabled for your company yet (feature flag ff.proc.p1508 is OFF).'))));
    router.use(/^\/(expediting-plans|inspections|shipments|expediting)(?=\/|$)/, (req, _res, next) => (flags.isOn(req.actor, 'ff.proc.p1507') ? next() : next(notFound('Expediting, vendor inspection and shipments are not enabled for your company yet (feature flag ff.proc.p1507 is OFF).'))));
    router.use(/^\/purchase-orders(\/|$)/, (req, _res, next) => (flags.isOn(req.actor, 'ff.proc.p1505') ? next() : next(notFound('Purchase orders are not enabled for your company yet (feature flag ff.proc.p1505 is OFF).'))));
    router.use(/^\/comparative-statements(\/|$)/, (req, _res, next) => (flags.isOn(req.actor, 'ff.proc.p1504') ? next() : next(notFound('Comparative statements are not enabled for your company yet (feature flag ff.proc.p1504 is OFF).'))));
    router.use(procRoutes(svc, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
    api.use('/proc', router);
    // the vendor's page: no sign-in, the link is the proof; switched off with the flag of the company that issued it
    publicApi.use('/proc', (req, res, next) => { const t = String(req.path).match(/^\/vendor-quote\/([A-Za-z0-9_-]+)/)?.[1]; if (!t) return next(); const v = db.prepare('SELECT company_id FROM proc_rfq_vendors WHERE token_hash = ?').get(createHash('sha256').update(t).digest('hex')); return v && flags.isOn({ companyId: v.company_id }, 'ff.proc.p1503') ? next() : next(notFound('This link is not valid.')); }, vendorQuoteRoutes({ portal: rfqSvc.portal, po: poSvc, xpd: xpdSvc }));
    publicApi.use('/proc', (req, res, next) => { const tk = String(req.path).match(/^\/vendor-po\/([A-Za-z0-9_-]+)/)?.[1]; if (!tk) return next(); const v = db.prepare('SELECT company_id FROM proc_purchase_orders WHERE ack_token_hash = ?').get(createHash('sha256').update(tk).digest('hex')); return v && flags.isOn({ companyId: v.company_id }, /\/milestones/.test(req.path) ? 'ff.proc.p1507' : 'ff.proc.p1505') ? next() : next(notFound('This link is not valid.')); });
  },
};

const approver = (code, name, role, slaHours, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours, requireAttachment: false, checklist: [], when, notify: [], action: null });
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };

// ---- the approval of a material request: the construction manager (the site engineer, storekeeper or planner raised it) ------------------------------------------------------------------------------
const mline = (db, id) => db.prepare('SELECT x.*, p.code, s.code AS scode FROM proc_material_requests x JOIN org_projects p ON p.id = x.org_project_id JOIN org_sites s ON s.id = x.mr_site_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: MR_DOC, label: 'Material request', processOwner: 'CM', route: (id) => `/proc/material-requests?id=${id}`,
  describe(db, companyId, id) { const r = mline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.code}/${r.scode}: ${r.doc_no}, required by ${r.required_by}`, originator: r.requested_by, projectId: r.org_project_id, siteId: r.mr_site_id } : null; },
  summarise(db, _actor, id) {
    const r = mline(db, Number(id)); if (!r) return null; const ls = db.prepare('SELECT l.qty, l.uom, i.code, i.name FROM proc_mr_lines l JOIN mdm_items i ON i.id = l.item_id WHERE l.mr_id = ? AND l.deleted_at IS NULL ORDER BY l.line_no').all(r.id);
    return { fields: [{ label: 'Site', value: `${r.code} / ${r.scode}` }, { label: 'Required by', value: r.required_by }, { label: 'Priority', value: r.priority.toLowerCase() }, { label: 'Requested by', value: r.requested_by }, { label: 'Lines', value: ls.map((l) => `${l.code} ${l.name}: ${l.qty / 1000} ${l.uom}`).join('; ') }, { label: 'Purpose', value: r.purpose ?? '' }] };
  },
  defaultDefinition: { name: 'Material request: the construction manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('CM', 'Construction manager', 'CM', 8)] },
  hooks: {
    onApproved: (db, { instance, actor }) => procOf(db)?.mrDecide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => procOf(db)?.mrDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => procOf(db)?.mrDecide(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => procOf(db)?.mrDecide(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(MR_DOC, ({ db, instance }) => {
  const r = mline(db, Number(instance.docId)); if (!r) return { sections: [] }; const wa = r.wa_id ? db.prepare('SELECT wa_no FROM site_work_authorisations WHERE id = ?').get(r.wa_id) : null; const ls = db.prepare('SELECT l.id, l.item_id, l.qty, l.uom, i.code, i.name FROM proc_mr_lines l JOIN mdm_items i ON i.id = l.item_id WHERE l.mr_id = ? AND l.deleted_at IS NULL ORDER BY l.line_no').all(r.id);
  const free = (itemId) => db.prepare("SELECT COALESCE(SUM(free_qty), 0) AS n FROM proc_stock_levels WHERE item_id = ? AND (store_site_id = ? OR store_kind = 'NEARBY') AND deleted_at IS NULL").get(itemId, r.mr_site_id).n;
  return { sections: [{ code: 'proc-mr-checks', title: 'Before you approve the request', kind: 'metrics', items: [{ label: 'Work authorisation', value: wa?.wa_no ?? 'none named', format: 'text', tone: wa ? undefined : 'warn' }, { label: 'Required by', value: r.required_by, format: 'text' }, ...ls.map((l) => ({ label: `${l.code} ${l.name}`, value: `${l.qty / 1000} ${l.uom} asked; ${free(l.item_id) / 1000} free at the site and nearby stores`, format: 'text', tone: free(l.item_id) >= l.qty ? 'warn' : undefined }))] }] };
});
objectTypes.register({
  type: 'proc_material_request', label: 'Material request', permission: 'proc.material_request.view', route: (id) => `/proc/material-requests?id=${id}`, attachmentEntity: 'proc_material_request', approvalTarget: 'proc_material_request',
  access(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.mrSvc.mrs.get(actor, Number(id)); return { companyId: actor.companyId, projectId: r.projectId, siteId: r.siteId, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'proc_material_requests', id }],
  summary(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.mrSvc.mrs.get(actor, Number(id)); return { label: `${r.docNo} ${r.siteCode}`, status: r.status }; } catch { return null; } },
  related(db, actor, id) { const s = procOf(db); if (!s) return []; try { const r = s.mrSvc.mrs.get(actor, Number(id)); return [...(r.waNo ? [{ kind: 'work authorisation', label: r.waNo, route: `/site/work-authorisations?id=${r.waId}` }] : []), ...r.lines.flatMap((l) => l.requisitions.map((x) => ({ kind: 'purchase requisition', label: `${x.docNo} (line ${l.lineNo})`, route: `/proc/requisitions?id=${x.id}` })))]; } catch { return []; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'proc.material_request.view').allowed) return []; return db.prepare('SELECT id, org_project_id, mr_site_id FROM proc_material_requests WHERE company_id = ? AND deleted_at IS NULL AND (doc_no LIKE ? OR purpose LIKE ?) ORDER BY id DESC LIMIT ?').all(actor.companyId, `%${q}%`, `%${q}%`, limit).filter((x) => authzOf(db).check(actor, 'proc.material_request.view', { companyId: actor.companyId, projectId: x.org_project_id, siteId: x.mr_site_id }).allowed).map((x) => x.id); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare('SELECT id FROM proc_material_requests WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((x) => x.id); },
});
fileEntities.register({
  entity: 'proc_material_request', label: 'Material request (specifications, drawings, photographs)',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT company_id, org_project_id, mr_site_id, status FROM proc_material_requests WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null;
    const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id, siteId: r.mr_site_id }).allowed; if (!at('proc.material_request.view')) return null;
    return { companyId: r.company_id, projectId: r.org_project_id, siteId: r.mr_site_id, canView: true, canEdit: at('proc.material_request.edit') && ['DRAFT', 'RETURNED'].includes(r.status), locked: !['DRAFT', 'RETURNED'].includes(r.status) };
  },
});

// ---- the approval of a purchase requisition by value (section 9): the project manager always, the project director above the first band, the procurement manager above the second; an emergency one the project manager alone --------------------
const pline = (db, id) => db.prepare('SELECT x.*, p.code, s.code AS scode FROM proc_requisitions x JOIN org_projects p ON p.id = x.org_project_id LEFT JOIN org_sites s ON s.id = x.pr_site_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: PR_DOC, label: 'Purchase requisition', processOwner: 'PM', route: (id) => `/proc/requisitions?id=${id}`,
  describe(db, companyId, id) { const r = pline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.code}${r.scode ? `/${r.scode}` : ''}: ${r.doc_no} ${r.total_amount / 100}${r.is_emergency ? ' (emergency)' : ''}`, originator: r.requested_by, projectId: r.org_project_id, siteId: r.pr_site_id ?? undefined, amount: r.total_amount / 100 } : null; },
  summarise(db, _actor, id) {
    const r = pline(db, Number(id)); if (!r) return null; const ls = db.prepare('SELECT l.qty, l.uom, l.est_amount, l.service_desc, i.code, i.name FROM proc_pr_lines l LEFT JOIN mdm_items i ON i.id = l.item_id WHERE l.pr_id = ? AND l.deleted_at IS NULL ORDER BY l.line_no').all(r.id);
    return { fields: [{ label: 'Project', value: r.code }, { label: 'Source', value: r.pr_source === 'MR' ? 'Material requests' : r.pr_source === 'MRP' ? 'MRP proposal' : `Direct: ${r.direct_reason ?? ''}` }, { label: 'Estimated value', value: String(r.total_amount / 100) }, { label: 'Required by', value: r.required_by }, { label: 'Budget check', value: r.budget_check_status.toLowerCase().replace('_', ' ') }, ...(r.is_emergency ? [{ label: 'Emergency', value: r.emergency_reason ?? '' }] : []), { label: 'Lines', value: ls.map((l) => `${l.code ? `${l.code} ${l.name}` : l.service_desc}: ${l.qty / 1000} ${l.uom} (${l.est_amount / 100})`).join('; ') }] };
  },
  defaultDefinition: { name: 'Purchase requisition: the project manager; the project director above ₹ 5 lakh; the procurement manager above ₹ 25 lakh; an emergency one the project manager alone', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('PM', 'Project manager', 'PM', 24), approver('PD', 'Project director (above ₹ 5 lakh)', 'PD', 24, { field: 'bandPd', op: 'eq', value: 'yes' }), approver('PROCMGR', 'Procurement manager (above ₹ 25 lakh)', 'PROCMGR', 24, { field: 'bandProc', op: 'eq', value: 'yes' })] },
  hooks: {
    onApproved: (db, { instance, actor }) => procOf(db)?.prDecide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => procOf(db)?.prDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => procOf(db)?.prDecide(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => procOf(db)?.prDecide(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(PR_DOC, ({ db, instance }) => {
  const r = pline(db, Number(instance.docId)); if (!r) return { sections: [] }; const c = json(r.checks_json, null); const tone = { BLOCK: 'bad', WARNING: 'warn', COVERED: 'bad', PARTIAL: 'warn' };
  return { sections: [{ code: 'proc-pr-checks', title: 'Checks before you approve the requisition', kind: 'metrics', items: [
    { label: 'Estimated value', value: String(r.total_amount / 100), format: 'text' }, { label: 'Budget', value: c ? `${c.summary.budget.toLowerCase()}${c.summary.exception?.required ? ' (an approved exception is needed)' : ''}` : 'not checked', format: 'text', tone: tone[c?.summary.budget] },
    { label: 'Stock at the site and nearby', value: c ? c.summary.stock.toLowerCase() : 'not checked', format: 'text', tone: tone[c?.summary.stock] }, { label: 'Possible duplicates', value: c ? String(c.summary.duplicates) : '0', format: 'text', tone: (c?.summary.duplicates ?? 0) > 0 ? 'warn' : undefined },
    { label: 'Lines beyond the budget quantity', value: c ? String(c.summary.beyondQty) : '0', format: 'text', tone: (c?.summary.beyondQty ?? 0) > 0 ? 'bad' : undefined }, ...(r.is_emergency ? [{ label: 'Emergency, to be regularised by', value: `${String(r.regularise_by).slice(0, 16).replace('T', ' ')}: ${r.emergency_reason}`, format: 'text', tone: 'warn' }] : [])] }] };
});
objectTypes.register({
  type: 'proc_requisition', label: 'Purchase requisition', permission: 'proc.requisition.view', route: (id) => `/proc/requisitions?id=${id}`, attachmentEntity: 'proc_requisition', approvalTarget: 'proc_requisition',
  access(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.prSvc.prs.get(actor, Number(id)); return { companyId: actor.companyId, projectId: r.projectId, siteId: r.siteId ?? undefined, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'proc_requisitions', id }],
  summary(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.prSvc.prs.get(actor, Number(id)); return { label: `${r.docNo} ${r.projectCode}`, status: r.status }; } catch { return null; } },
  related(db, actor, id) { const s = procOf(db); if (!s) return []; try { const r = s.prSvc.prs.get(actor, Number(id)); const seen = new Map(); for (const l of r.lines) for (const x of l.sources) seen.set(x.mrId, x.mrNo); return [...seen.entries()].map(([mrId, mrNo]) => ({ kind: 'material request', label: mrNo, route: `/proc/material-requests?id=${mrId}` })); } catch { return []; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'proc.requisition.view').allowed) return []; return db.prepare('SELECT id, org_project_id, pr_site_id FROM proc_requisitions WHERE company_id = ? AND deleted_at IS NULL AND (doc_no LIKE ? OR purpose LIKE ?) ORDER BY id DESC LIMIT ?').all(actor.companyId, `%${q}%`, `%${q}%`, limit).filter((x) => authzOf(db).check(actor, 'proc.requisition.view', { companyId: actor.companyId, projectId: x.org_project_id, siteId: x.pr_site_id }).allowed).map((x) => x.id); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare('SELECT id FROM proc_requisitions WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((x) => x.id); },
});
fileEntities.register({
  entity: 'proc_requisition', label: 'Purchase requisition (specifications, quotations, justification)',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT company_id, org_project_id, pr_site_id, status FROM proc_requisitions WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null;
    const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id, siteId: r.pr_site_id }).allowed; if (!at('proc.requisition.view')) return null;
    return { companyId: r.company_id, projectId: r.org_project_id, siteId: r.pr_site_id ?? undefined, canView: true, canEdit: at('proc.requisition.edit') && ['DRAFT', 'RETURNED'].includes(r.status), locked: !['DRAFT', 'RETURNED'].includes(r.status) };
  },
});

// ---- the approval of an item's planning parameters (part 15.02, section 9): maker-checker; the planner or the procurement officer proposes, the procurement manager approves; the one who proposed never decides it --------------------------
const iline = (db, id) => db.prepare('SELECT x.*, i.code, i.name FROM proc_item_params x JOIN mdm_items i ON i.id = x.item_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: PARAM_DOC, label: 'Item planning parameters', processOwner: 'PROCMGR', route: (id) => `/proc/item-params?id=${id}`,
  describe(db, companyId, id) { const r = iline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.code, title: `${r.code}: lead time ${r.lead_time_days} days from ${r.effective_from}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = iline(db, Number(id)); if (!r) return null; const cur = db.prepare("SELECT lead_time_days, moq, safety_stock FROM proc_item_params WHERE company_id = ? AND item_id = ? AND COALESCE(vendor_id, 0) = ? AND status = 'APPROVED' AND effective_from <= ? AND deleted_at IS NULL ORDER BY effective_from DESC LIMIT 1").get(r.company_id, r.item_id, r.vendor_id ?? 0, r.effective_from); return { fields: [{ label: 'Item', value: `${r.code} ${r.name}` }, { label: 'Lead time', value: `${r.lead_time_days} days${cur ? ` (now ${cur.lead_time_days})` : ''}` }, { label: 'Minimum order / pack', value: `${r.moq / 1000} / ${r.pack_size / 1000}` }, { label: 'Safety stock', value: `${r.safety_stock / 1000}${cur ? ` (now ${cur.safety_stock / 1000})` : ''}` }, { label: 'Long lead', value: r.long_lead ? 'yes' : 'no' }, { label: 'Effective from', value: r.effective_from }, { label: 'Supplier capacity', value: r.capacity_note ?? '' }] }; },
  defaultDefinition: { name: 'Item planning parameters: the procurement manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('PROCMGR', 'Procurement manager', 'PROCMGR', 24)] },
  hooks: {
    onApproved: (db, { instance, actor }) => procOf(db)?.paramDecide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => procOf(db)?.paramDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => procOf(db)?.paramDecide(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => procOf(db)?.paramDecide(instance, actor, 'CANCELLED', comment),
  },
});
objectTypes.register({
  type: 'proc_item_param', label: 'Item planning parameters', permission: 'proc.item_param.view', route: (id) => `/proc/item-params?id=${id}`, attachmentEntity: 'proc_item_param', approvalTarget: 'proc_item_param',
  access(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.paramSvc.params.get(actor, Number(id)); return { companyId: actor.companyId, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'proc_item_params', id }],
  summary(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.paramSvc.params.get(actor, Number(id)); return { label: `${r.itemCode} planning parameters`, status: r.status }; } catch { return null; } },
  related: () => [], search() { return []; }, projectRecords() { return []; },
});
objectTypes.register({
  type: 'proc_mrp_run', label: 'MRP run', permission: 'proc.run.view', route: (id) => `/proc/mrp?id=${id}`, attachmentEntity: 'proc_mrp_run', approvalTarget: 'proc_mrp_run',
  access(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.mrpSvc.mrp.get(actor, Number(id)); return { companyId: actor.companyId, projectId: r.projectId, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'proc_mrp_runs', id }],
  summary(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.mrpSvc.mrp.get(actor, Number(id)); return { label: `${r.docNo} ${r.projectCode}`, status: r.status }; } catch { return null; } },
  related(db, actor, id) { const s = procOf(db); if (!s) return []; try { const rows = db.prepare('SELECT DISTINCT pr_id FROM proc_mrp_proposals WHERE run_id = ? AND pr_id IS NOT NULL').all(Number(id)); return rows.map((x) => { const pr = s.prSvc.prs.get(actor, x.pr_id); return { kind: 'purchase requisition', label: pr.docNo, route: `/proc/requisitions?id=${pr.id}` }; }); } catch { return []; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'proc.run.view').allowed) return []; return db.prepare('SELECT id, org_project_id FROM proc_mrp_runs WHERE company_id = ? AND deleted_at IS NULL AND doc_no LIKE ? ORDER BY id DESC LIMIT ?').all(actor.companyId, `%${q}%`, limit).filter((x) => authzOf(db).check(actor, 'proc.run.view', { companyId: actor.companyId, projectId: x.org_project_id }).allowed).map((x) => x.id); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare('SELECT id FROM proc_mrp_runs WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((x) => x.id); },
});

// ---- the approval of a single-source RFQ justification (part 15.03, BR-01): fewer vendors than the minimum on a value above the threshold; the procurement manager, then the project director ----------------------------------
const fline = (db, id) => db.prepare('SELECT x.*, p.code FROM proc_rfqs x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: RFQ_DOC, label: 'Single-source RFQ justification', processOwner: 'PROCMGR', route: (id) => `/proc/rfqs?id=${id}`,
  describe(db, companyId, id) { const r = fline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.code}: ${r.doc_no} ${r.title}`, originator: r.requested_by, projectId: r.org_project_id, amount: r.est_total / 100 } : null; },
  summarise(db, _actor, id) {
    const r = fline(db, Number(id)); if (!r) return null; const vs = db.prepare('SELECT vendor_id FROM proc_rfq_vendors WHERE rfq_id = ? AND deleted_at IS NULL').all(r.id).map((v) => db.prepare('SELECT COALESCE(trade_name, legal_name) AS n FROM mdm_partners WHERE id = ?').get(v.vendor_id)?.n);
    return { fields: [{ label: 'Project', value: r.code }, { label: 'RFQ', value: `${r.doc_no}: ${r.title}` }, { label: 'Estimated value', value: String(r.est_total / 100) }, { label: 'Vendors invited', value: vs.join(', ') || 'none' }, { label: 'Due', value: r.due_date }, { label: 'Why fewer vendors', value: r.justification ?? '' }] };
  },
  defaultDefinition: { name: 'Single-source RFQ justification: the procurement manager, then the project director', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('PROCMGR', 'Procurement manager', 'PROCMGR', 24), approver('PD', 'Project director', 'PD', 24)] },
  hooks: {
    onApproved: (db, { instance, actor }) => procOf(db)?.rfqDecide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => procOf(db)?.rfqDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => procOf(db)?.rfqDecide(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => procOf(db)?.rfqDecide(instance, actor, 'CANCELLED', comment),
  },
});
objectTypes.register({
  type: 'proc_rfq', label: 'Request for quotation', permission: 'proc.rfq.view', route: (id) => `/proc/rfqs?id=${id}`, attachmentEntity: 'proc_rfq', approvalTarget: 'proc_rfq',
  access(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.rfqSvc.rfqs.get(actor, Number(id)); return { companyId: actor.companyId, projectId: r.projectId, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'proc_rfqs', id }],
  summary(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.rfqSvc.rfqs.get(actor, Number(id)); return { label: `${r.docNo} ${r.title}`, status: r.status }; } catch { return null; } },
  related(db, actor, id) { const s = procOf(db); if (!s) return []; try { const r = s.rfqSvc.rfqs.get(actor, Number(id)); const prs = new Map(r.lines.map((l) => [l.prId, l.prNo])); return [...[...prs.entries()].map(([prId, prNo]) => ({ kind: 'purchase requisition', label: prNo, route: `/proc/requisitions?id=${prId}` })), ...r.quotations.map((q) => ({ kind: 'quotation', label: `${q.docNo} (${q.vendor})`, route: `/proc/quotation-entry?id=${q.id}` }))]; } catch { return []; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'proc.rfq.view').allowed) return []; return db.prepare('SELECT id, org_project_id FROM proc_rfqs WHERE company_id = ? AND deleted_at IS NULL AND (doc_no LIKE ? OR title LIKE ?) ORDER BY id DESC LIMIT ?').all(actor.companyId, `%${q}%`, `%${q}%`, limit).filter((x) => authzOf(db).check(actor, 'proc.rfq.view', { companyId: actor.companyId, projectId: x.org_project_id }).allowed).map((x) => x.id); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare('SELECT id FROM proc_rfqs WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((x) => x.id); },
});
objectTypes.register({
  type: 'proc_quotation', label: 'Vendor quotation', permission: 'proc.quotation.view', route: (id) => `/proc/quotation-entry?id=${id}`, attachmentEntity: 'proc_quotation', approvalTarget: 'proc_quotation',
  access(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.rfqSvc.quotes.get(actor, Number(id)); return { companyId: actor.companyId, projectId: r.projectId, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'proc_quotations', id }],
  summary(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.rfqSvc.quotes.get(actor, Number(id)); return { label: `${r.docNo} ${r.vendor}`, status: r.status }; } catch { return null; } },
  related(db, actor, id) { const s = procOf(db); if (!s) return []; try { const r = s.rfqSvc.quotes.get(actor, Number(id)); return [{ kind: 'request for quotation', label: r.rfqNo, route: `/proc/rfqs?id=${r.rfqId}` }]; } catch { return []; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'proc.quotation.view').allowed) return []; return db.prepare('SELECT id, org_project_id FROM proc_quotations WHERE company_id = ? AND deleted_at IS NULL AND (doc_no LIKE ? OR quote_ref LIKE ?) ORDER BY id DESC LIMIT ?').all(actor.companyId, `%${q}%`, `%${q}%`, limit).filter((x) => authzOf(db).check(actor, 'proc.quotation.view', { companyId: actor.companyId, projectId: x.org_project_id }).allowed).map((x) => x.id); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare('SELECT id FROM proc_quotations WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((x) => x.id); },
});
for (const [entity, table, view, edit, label] of [['proc_rfq', 'proc_rfqs', 'proc.rfq.view', 'proc.rfq.edit', 'RFQ (specifications, drawings, terms)'], ['proc_quotation', 'proc_quotations', 'proc.quotation.view', 'proc.quotation.edit', 'Vendor quotation (the quotation, catalogues, test certificates)']]) {
  fileEntities.register({
    entity, label,
    resolve(db, actor, id) {
      const r = db.prepare(`SELECT company_id, org_project_id, status FROM ${table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(Number(id), actor.companyId); if (!r) return null;
      const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id }).allowed; if (!at(view)) return null; const open = ['DRAFT', 'RETURNED', 'PLANNED'].includes(r.status);
      return { companyId: r.company_id, projectId: r.org_project_id, canView: true, canEdit: at(edit) && (open || (entity === 'proc_rfq' && r.status === 'ISSUED')), locked: !open && r.status !== 'ISSUED' };
    },
  });
}

// ---- the approval of a comparative statement (part 15.04, section 9): the procurement manager, the project manager, the project director above the first band, the direction above the second; one level higher when the vendor is not the L1 -------------
const csline = (db, id) => db.prepare('SELECT x.*, p.code, f.doc_no AS rfq_no, f.title FROM proc_comparative_statements x JOIN org_projects p ON p.id = x.org_project_id JOIN proc_rfqs f ON f.id = x.rfq_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: CS_DOC, label: 'Comparative statement', processOwner: 'PROCMGR', route: (id) => `/proc/comparative-statements?id=${id}`,
  describe(db, companyId, id) { const r = csline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.code}: ${r.doc_no} for ${r.rfq_no} ${r.total_value / 100}${r.non_l1 ? ' (not L1)' : ''}`, originator: r.requested_by, projectId: r.org_project_id, amount: r.total_value / 100 } : null; },
  summarise(db, _actor, id) {
    const r = csline(db, Number(id)); if (!r) return null; const vs = db.prepare('SELECT DISTINCT vendor_id FROM proc_cs_lines WHERE cs_id = ? AND selected_qty > 0 AND deleted_at IS NULL').all(r.id).map((v) => db.prepare('SELECT COALESCE(trade_name, legal_name) AS n FROM mdm_partners WHERE id = ?').get(v.vendor_id)?.n);
    return { fields: [{ label: 'Project', value: r.code }, { label: 'RFQ', value: `${r.rfq_no}: ${r.title}` }, { label: 'Recommendation', value: r.recommendation_type }, { label: 'Selected vendors', value: vs.join(', ') }, { label: 'Value', value: String(r.total_value / 100) }, { label: 'Against the estimate', value: String(r.savings_vs_budget / 100) }, ...(r.non_l1 ? [{ label: 'Not the L1', value: `${r.reason_code}: ${r.justification}` }] : [])] };
  },
  defaultDefinition: { name: 'Comparative statement: the procurement manager, the project manager, the project director above ₹ 5 lakh, the direction above ₹ 50 lakh; one level higher when the vendor is not the L1', settings: { resubmit: 'first', distinctApprovers: true },
    steps: [approver('PROCMGR', 'Procurement manager', 'PROCMGR', 24), approver('PM', 'Project manager', 'PM', 24), approver('PD', 'Project director (value above the first band, or not L1)', 'PD', 24, { field: 'needPd', op: 'eq', value: 'yes' }), approver('DIR', 'Direction (value above the second band, or not L1)', 'DIR', 48, { field: 'needDir', op: 'eq', value: 'yes' })] },
  hooks: {
    onApproved: (db, { instance, actor }) => procOf(db)?.csDecide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => procOf(db)?.csDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => procOf(db)?.csDecide(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => procOf(db)?.csDecide(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(CS_DOC, ({ db, instance }) => {
  const r = csline(db, Number(instance.docId)); if (!r) return { sections: [] }; const l1 = db.prepare('SELECT COALESCE(SUM(ROUND(l.qty * c.landed_rate / 1000.0)), 0) AS v FROM proc_cs_lines c JOIN proc_rfq_lines l ON l.id = c.rfq_line_id WHERE c.cs_id = ? AND c.is_l1 = 1 AND c.selected_qty > 0 AND c.deleted_at IS NULL').get(r.id);
  return { sections: [{ code: 'proc-cs-evidence', title: 'Before you approve the vendor selection', kind: 'metrics', items: [{ label: 'Selected value', value: String(r.total_value / 100), format: 'text' }, { label: 'Against the estimate on the requisitions', value: String(r.savings_vs_budget / 100), format: 'text', tone: r.savings_vs_budget < 0 ? 'bad' : undefined }, { label: 'Recommendation', value: r.recommendation_type.toLowerCase().replace('_', ' '), format: 'text' }, { label: 'Not the L1', value: r.non_l1 ? `yes: ${r.reason_code}: ${r.justification}` : 'no', format: 'text', tone: r.non_l1 ? 'warn' : undefined }, { label: 'Negotiation rounds', value: String(r.round_no), format: 'text' }, { label: 'L1 lines selected', value: l1.v ? 'yes' : 'no', format: 'text' }] }] };
});
objectTypes.register({
  type: 'proc_comparative_statement', label: 'Comparative statement', permission: 'proc.comparative_statement.view', route: (id) => `/proc/comparative-statements?id=${id}`, attachmentEntity: 'proc_comparative_statement', approvalTarget: 'proc_comparative_statement',
  access(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.csSvc.css.get(actor, Number(id)); return { companyId: actor.companyId, projectId: r.projectId, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'proc_comparative_statements', id }],
  summary(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.csSvc.css.get(actor, Number(id)); return { label: `${r.docNo} ${r.rfqNo}`, status: r.status }; } catch { return null; } },
  related(db, actor, id) { const s = procOf(db); if (!s) return []; try { const r = s.csSvc.css.get(actor, Number(id)); return [{ kind: 'request for quotation', label: r.rfqNo, route: `/proc/rfqs?id=${r.rfqId}` }, ...r.vendors.map((v) => ({ kind: 'quotation', label: `${v.quotationNo} (${v.name})`, route: `/proc/quotation-entry?id=${v.quotationId}` }))]; } catch { return []; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'proc.comparative_statement.view').allowed) return []; return db.prepare('SELECT id, org_project_id FROM proc_comparative_statements WHERE company_id = ? AND deleted_at IS NULL AND doc_no LIKE ? ORDER BY id DESC LIMIT ?').all(actor.companyId, `%${q}%`, limit).filter((x) => authzOf(db).check(actor, 'proc.comparative_statement.view', { companyId: actor.companyId, projectId: x.org_project_id }).allowed).map((x) => x.id); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare('SELECT id FROM proc_comparative_statements WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((x) => x.id); },
});
fileEntities.register({
  entity: 'proc_comparative_statement', label: 'Comparative statement (negotiation minutes, technical evaluation, justification)',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT company_id, org_project_id, status FROM proc_comparative_statements WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null;
    const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id }).allowed; if (!at('proc.comparative_statement.view')) return null; const open = ['DRAFT', 'RETURNED', 'PLANNED'].includes(r.status);
    return { companyId: r.company_id, projectId: r.org_project_id, canView: true, canEdit: at('proc.comparative_statement.edit') && open, locked: !open };
  },
});

// ---- purchase orders (part 15.05, section 9): the procurement manager; the project manager above ₹ 5 lakh (or a rate above the benchmark, or an emergency); the project director above ₹ 25 lakh; the direction above ₹ 1 crore ------------------------
const poline = (db, id) => db.prepare('SELECT x.*, p.code, COALESCE(v.trade_name, v.legal_name) AS vname FROM proc_purchase_orders x JOIN org_projects p ON p.id = x.org_project_id JOIN mdm_partners v ON v.id = x.vendor_id WHERE x.id = ?').get(id);
const banded = (name) => [approver('PROCMGR', 'Procurement manager', 'PROCMGR', 24), approver('PM', 'Project manager (above ₹ 5 lakh, a rate above the benchmark, or an emergency)', 'PM', 24, { field: 'needPm', op: 'eq', value: 'yes' }), approver('PD', 'Project director (above ₹ 25 lakh)', 'PD', 24, { field: 'needPd', op: 'eq', value: 'yes' }), approver('DIR', 'Direction (above ₹ 1 crore)', 'DIR', 48, { field: 'needDir', op: 'eq', value: 'yes' })].map((s) => ({ ...s, name: `${s.name}${name ? ` — ${name}` : ''}` }));
workflowTypes.register({
  docType: PO_DOC, label: 'Purchase order', processOwner: 'PROCMGR', route: (id) => `/proc/purchase-orders?id=${id}`,
  describe(db, companyId, id) { const r = poline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.code}: ${r.doc_no} to ${r.vname} ${r.total_amount / 100}`, originator: r.requested_by, projectId: r.org_project_id, siteId: r.po_site_id ?? undefined, amount: r.total_amount / 100 } : null; },
  summarise(db, _actor, id) {
    const r = poline(db, Number(id)); if (!r) return null; const ls = db.prepare('SELECT description, qty, uom, rate, cs_rate FROM proc_po_lines WHERE po_id = ? AND deleted_at IS NULL ORDER BY line_no').all(r.id);
    return { fields: [{ label: 'Project', value: r.code }, { label: 'Vendor', value: r.vname }, { label: 'Source', value: r.po_source === 'CS' ? 'Comparative statement' : `Direct: ${r.direct_reason ?? ''}` }, { label: 'Basic', value: String(r.total_basic / 100) }, { label: 'GST', value: `${r.total_tax / 100} (${r.supply_type})` }, { label: 'Total', value: String(r.total_amount / 100) }, { label: 'Payment', value: `${r.payment_terms ?? ''}${r.advance_pct ? `, advance ${r.advance_pct / 10000}%` : ''}` }, { label: 'Lines', value: ls.map((l) => `${l.description}: ${l.qty / 1000} ${l.uom} at ${l.rate / 100}${l.cs_rate != null && l.rate > l.cs_rate ? ' (above the statement)' : ''}`).join('; ') }] };
  },
  defaultDefinition: { name: 'Purchase order: the procurement manager; the project manager above ₹ 5 lakh; the project director above ₹ 25 lakh; the direction above ₹ 1 crore', settings: { resubmit: 'first', distinctApprovers: true }, steps: banded('') },
  hooks: {
    onApproved: (db, { instance, actor }) => procOf(db)?.poDecide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => procOf(db)?.poDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => procOf(db)?.poDecide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => procOf(db)?.poDecide(instance, actor, 'CANCELLED', comment),
  },
});
const aline = (db, id) => db.prepare('SELECT a.*, x.doc_no, x.company_id AS cid, x.org_project_id, x.total_amount AS po_total FROM proc_po_amendments a JOIN proc_purchase_orders x ON x.id = a.po_id WHERE a.id = ?').get(id);
workflowTypes.register({
  docType: AMEND_DOC, label: 'Purchase order amendment', processOwner: 'PROCMGR', route: () => '/proc/purchase-orders',
  describe(db, companyId, id) { const a = aline(db, Number(id)); return a && a.cid === companyId ? { ref: `${a.doc_no}/A${a.amendment_no}`, title: `${a.doc_no} amendment ${a.amendment_no}: ${a.delta_amount / 100}`, originator: a.requested_by, projectId: a.org_project_id, amount: Math.abs(a.delta_amount) / 100 } : null; },
  summarise(db, _actor, id) { const a = aline(db, Number(id)); if (!a) return null; const ch = JSON.parse(a.changes_json ?? '[]'); return { fields: [{ label: 'Order', value: a.doc_no }, { label: 'Reason', value: a.reason }, { label: 'Change in value', value: String(a.delta_amount / 100) }, { label: 'New total', value: String(a.new_total / 100) }, { label: 'Rate increase', value: a.rate_increase ? 'yes' : 'no' }, { label: 'Changes', value: ch.map((c) => `${c.lineNo ? `line ${c.lineNo} ` : ''}${c.field}: ${c.before} to ${c.after}`).join('; ') }] }; },
  defaultDefinition: { name: 'Purchase order amendment: by the size of the change; a rate increase always with the project manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: banded('') },
  hooks: {
    onApproved: (db, { instance, actor }) => procOf(db)?.amendDecide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => procOf(db)?.amendDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => procOf(db)?.amendDecide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => procOf(db)?.amendDecide(instance, actor, 'CANCELLED', comment),
  },
});
workflowTypes.register({
  docType: CLOSE_DOC, label: 'Purchase order short-close or cancel', processOwner: 'PROCMGR', route: () => '/proc/purchase-orders',
  describe(db, companyId, id) { const a = aline(db, Number(id)); return a && a.cid === companyId ? { ref: `${a.doc_no}/${a.kind}`, title: `${a.doc_no} ${a.kind === 'CANCEL' ? 'cancel' : 'short-close'}: ${a.reason}`, originator: a.requested_by, projectId: a.org_project_id } : null; },
  summarise(db, _actor, id) { const a = aline(db, Number(id)); if (!a) return null; const ls = db.prepare('SELECT description, qty, received_qty, balance_qty, uom FROM proc_po_lines WHERE po_id = ? AND deleted_at IS NULL ORDER BY line_no').all(a.po_id); return { fields: [{ label: 'Order', value: a.doc_no }, { label: 'Request', value: a.kind === 'CANCEL' ? 'Cancel (nothing is received)' : 'Short-close (the rest is given up and the commitment released)' }, { label: 'Reason', value: a.reason }, { label: 'Lines', value: ls.map((l) => `${l.description}: ordered ${l.qty / 1000}, received ${l.received_qty / 1000}, left ${l.balance_qty / 1000} ${l.uom}`).join('; ') }] }; },
  defaultDefinition: { name: 'Purchase order short-close or cancel: the procurement manager, the project manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('PROCMGR', 'Procurement manager', 'PROCMGR', 24), approver('PM', 'Project manager', 'PM', 24)] },
  hooks: {
    onApproved: (db, { instance, actor }) => procOf(db)?.amendDecide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => procOf(db)?.amendDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => procOf(db)?.amendDecide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => procOf(db)?.amendDecide(instance, actor, 'CANCELLED', comment),
  },
});
const advline = (db, id) => db.prepare('SELECT a.*, x.doc_no AS po_no, x.company_id AS cid, x.org_project_id, x.vendor_id FROM proc_po_advances a JOIN proc_purchase_orders x ON x.id = a.po_id WHERE a.id = ?').get(id);
workflowTypes.register({
  docType: ADV_DOC, label: 'Advance payment against a purchase order', processOwner: 'PROCMGR', route: () => '/proc/purchase-orders',
  describe(db, companyId, id) { const a = advline(db, Number(id)); return a && a.cid === companyId ? { ref: a.doc_no, title: `${a.doc_no} against ${a.po_no}: ${a.advance_amount / 100}`, originator: a.requested_by, projectId: a.org_project_id, amount: a.advance_amount / 100 } : null; },
  summarise(db, _actor, id) { const a = advline(db, Number(id)); if (!a) return null; return { fields: [{ label: 'Order', value: a.po_no }, { label: 'Vendor', value: db.prepare('SELECT COALESCE(trade_name, legal_name) AS n FROM mdm_partners WHERE id = ?').get(a.vendor_id)?.n }, { label: 'Advance', value: String(a.advance_amount / 100) }, { label: 'Needed by', value: a.needed_by ?? '' }, { label: 'Reason', value: a.reason }] }; },
  defaultDefinition: { name: 'Advance against a purchase order: the procurement manager, the commercial manager, the CFO', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('PROCMGR', 'Procurement manager', 'PROCMGR', 24), approver('COMMGR', 'Commercial manager', 'COMMGR', 24), approver('CFO', 'CFO', 'CFO', 48)] },
  hooks: {
    onApproved: (db, { instance, actor }) => procOf(db)?.advanceDecide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => procOf(db)?.advanceDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => procOf(db)?.advanceDecide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => procOf(db)?.advanceDecide(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(PO_DOC, ({ db, instance }) => {
  const r = poline(db, Number(instance.docId)); if (!r) return { sections: [] }; const ls = db.prepare('SELECT description, rate, cs_rate, benchmark_rate FROM proc_po_lines WHERE po_id = ? AND deleted_at IS NULL').all(r.id); const above = ls.filter((l) => l.cs_rate != null && l.rate > l.cs_rate); const hi = ls.filter((l) => l.benchmark_rate && l.rate > l.benchmark_rate);
  return { sections: [{ code: 'proc-po-evidence', title: 'Before you approve the order', kind: 'metrics', items: [{ label: 'Value (basic / GST / total)', value: `${r.total_basic / 100} / ${r.total_tax / 100} / ${r.total_amount / 100}`, format: 'text' }, { label: 'GST', value: r.supply_type === 'INTRA' ? 'CGST and SGST (same state)' : r.supply_type === 'INTER' ? 'IGST (another state)' : 'none: the vendor has no GSTIN', format: 'text', tone: r.supply_type === 'NONE' ? 'warn' : undefined }, { label: 'Source', value: r.po_source === 'CS' ? 'approved comparative statement' : `direct: ${r.direct_reason ?? ''}`, format: 'text' }, { label: 'Lines above the statement rate', value: String(above.length), format: 'text', tone: above.length ? 'bad' : undefined }, { label: 'Lines above the benchmark', value: String(hi.length), format: 'text', tone: hi.length ? 'warn' : undefined }, { label: 'Payment terms', value: `${r.payment_terms ?? 'not stated'}${r.advance_pct ? `, advance ${r.advance_pct / 10000}%` : ''}`, format: 'text' }] }] };
});
objectTypes.register({
  type: 'proc_purchase_order', label: 'Purchase order', permission: 'proc.purchase_order.view', route: (id) => `/proc/purchase-orders?id=${id}`, attachmentEntity: 'proc_purchase_order', approvalTarget: 'proc_purchase_order',
  access(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.poSvc.pos.get(actor, Number(id)); return { companyId: actor.companyId, projectId: r.projectId, siteId: r.siteId ?? undefined, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'proc_purchase_orders', id }],
  summary(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.poSvc.pos.get(actor, Number(id)); return { label: `${r.docNo} ${r.vendor}`, status: r.status }; } catch { return null; } },
  related(db, actor, id) { const s = procOf(db); if (!s) return []; try { const r = s.poSvc.pos.get(actor, Number(id)); const prs = new Map(r.lines.filter((l) => l.prId).map((l) => [l.prId, l.prNo])); return [...(r.csId ? [{ kind: 'comparative statement', label: r.csNo, route: `/proc/comparative-statements?id=${r.csId}` }] : []), ...[...prs.entries()].map(([prId, prNo]) => ({ kind: 'purchase requisition', label: prNo, route: `/proc/requisitions?id=${prId}` }))]; } catch { return []; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'proc.purchase_order.view').allowed) return []; return db.prepare('SELECT id, org_project_id, po_site_id FROM proc_purchase_orders WHERE company_id = ? AND deleted_at IS NULL AND doc_no LIKE ? ORDER BY id DESC LIMIT ?').all(actor.companyId, `%${q}%`, limit).filter((x) => authzOf(db).check(actor, 'proc.purchase_order.view', { companyId: actor.companyId, projectId: x.org_project_id, siteId: x.po_site_id }).allowed).map((x) => x.id); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare('SELECT id FROM proc_purchase_orders WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((x) => x.id); },
});
fileEntities.register({
  entity: 'proc_purchase_order', label: 'Purchase order (drawings, specifications, test certificates, signed copy)',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT company_id, org_project_id, po_site_id, status FROM proc_purchase_orders WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null;
    const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id, siteId: r.po_site_id }).allowed; if (!at('proc.purchase_order.view')) return null; const open = ['DRAFT', 'RETURNED', 'PLANNED'].includes(r.status);
    return { companyId: r.company_id, projectId: r.org_project_id, siteId: r.po_site_id ?? undefined, canView: true, canEdit: at('proc.purchase_order.edit') && (open || r.status === 'APPROVED'), locked: !open && r.status !== 'APPROVED' };
  },
});

// ---- rate contracts (part 15.06, section 9): procurement manager, commercial manager, the direction above a ceiling of ₹ 1 crore; a price-variation revision: procurement manager, commercial manager ----------------------------------------
const rline = (db, id) => db.prepare('SELECT x.*, COALESCE(v.trade_name, v.legal_name) AS vname FROM proc_rate_contracts x JOIN mdm_partners v ON v.id = x.vendor_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: RC_DOC, label: 'Rate contract', processOwner: 'PROCMGR', route: () => '/proc/rate-contracts',
  describe(db, companyId, id) { const r = rline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.doc_no} ${r.title} with ${r.vname}`, originator: r.requested_by, amount: (r.ceiling_value || 0) / 100 } : null; },
  summarise(db, _actor, id) { const r = rline(db, Number(id)); if (!r) return null; const ls = db.prepare('SELECT description, uom, rate, ceiling_qty FROM proc_rc_lines WHERE rc_id = ? AND deleted_at IS NULL ORDER BY line_no').all(r.id); return { fields: [{ label: 'Vendor', value: r.vname }, { label: 'Valid', value: `${r.valid_from} to ${r.valid_to}` }, { label: 'Ceiling value', value: r.ceiling_value ? String(r.ceiling_value / 100) : 'none' }, { label: 'Price variation', value: r.pv_json ? 'yes' : 'no' }, { label: 'Lines', value: ls.map((l) => `${l.description}: ${l.rate / 100} per ${l.uom}${l.ceiling_qty ? `, up to ${l.ceiling_qty / 1000}` : ''}`).join('; ') }] }; },
  defaultDefinition: { name: 'Rate contract: the procurement manager, the commercial manager, the direction above a ceiling of ₹ 1 crore', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('PROCMGR', 'Procurement manager', 'PROCMGR', 24), approver('COMMGR', 'Commercial manager', 'COMMGR', 24), approver('DIR', 'Direction (ceiling above ₹ 1 crore)', 'DIR', 48, { field: 'needDir', op: 'eq', value: 'yes' })] },
  hooks: {
    onApproved: (db, { instance, actor }) => procOf(db)?.rcDecide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => procOf(db)?.rcDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => procOf(db)?.rcDecide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => procOf(db)?.rcDecide(instance, actor, 'CANCELLED', comment),
  },
});
const pvline = (db, id) => db.prepare('SELECT v.*, x.doc_no, x.company_id AS cid FROM proc_rc_revisions v JOIN proc_rate_contracts x ON x.id = v.rc_id WHERE v.id = ?').get(id);
workflowTypes.register({
  docType: PV_DOC, label: 'Price-variation revision', processOwner: 'PROCMGR', route: () => '/proc/rate-contracts',
  describe(db, companyId, id) { const v = pvline(db, Number(id)); return v && v.cid === companyId ? { ref: `${v.doc_no}/PV${v.revision_no}`, title: `${v.doc_no} price variation ${v.index_code} ${v.period}`, originator: v.requested_by } : null; },
  summarise(db, _actor, id) { const v = pvline(db, Number(id)); if (!v) return null; const ch = JSON.parse(v.changes_json ?? '[]'); return { fields: [{ label: 'Contract', value: v.doc_no }, { label: 'Index', value: `${v.index_code} ${v.period}: ${v.index_value / 10000} against a base of ${v.base_index / 10000}` }, { label: 'Effective from', value: v.effective_from }, { label: 'Rates', value: ch.map((c) => `${c.description}: ${c.oldRate / 100} to ${c.newRate / 100} (${c.changePct}%)`).join('; ') }] }; },
  defaultDefinition: { name: 'Price-variation revision: the procurement manager, the commercial manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('PROCMGR', 'Procurement manager', 'PROCMGR', 24), approver('COMMGR', 'Commercial manager', 'COMMGR', 24)] },
  hooks: {
    onApproved: (db, { instance, actor }) => procOf(db)?.pvDecide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => procOf(db)?.pvDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => procOf(db)?.pvDecide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => procOf(db)?.pvDecide(instance, actor, 'CANCELLED', comment),
  },
});
const soline = (db, id) => db.prepare('SELECT x.*, p.code, COALESCE(v.trade_name, v.legal_name) AS vname FROM proc_service_orders x JOIN org_projects p ON p.id = x.org_project_id JOIN mdm_partners v ON v.id = x.vendor_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: SO_DOC, label: 'Service order', processOwner: 'PROCMGR', route: (id) => `/proc/service-orders?id=${id}`,
  describe(db, companyId, id) { const r = soline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.code}: ${r.doc_no} ${r.title} with ${r.vname} ${r.total_value / 100}`, originator: r.requested_by, projectId: r.org_project_id, siteId: r.so_site_id ?? undefined, amount: r.total_value / 100 } : null; },
  summarise(db, _actor, id) { const r = soline(db, Number(id)); if (!r) return null; const ls = db.prepare('SELECT description, pricing_kind, qty, uom, rate FROM proc_so_lines WHERE so_id = ? AND deleted_at IS NULL ORDER BY line_no').all(r.id); return { fields: [{ label: 'Project', value: r.code }, { label: 'Vendor', value: r.vname }, { label: 'Period', value: `${r.start_date} to ${r.end_date}` }, { label: 'Scope', value: r.scope }, { label: 'Value', value: String(r.total_value / 100) }, { label: 'Lines', value: ls.map((l) => `${l.description}: ${l.qty / 1000} ${l.uom} at ${l.rate / 100} (${l.pricing_kind.toLowerCase().replace('_', ' ')})`).join('; ') }] }; },
  defaultDefinition: { name: 'Service order: as purchase orders, by value', settings: { resubmit: 'first', distinctApprovers: true }, steps: banded('') },
  hooks: {
    onApproved: (db, { instance, actor }) => procOf(db)?.soDecide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => procOf(db)?.soDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => procOf(db)?.soDecide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => procOf(db)?.soDecide(instance, actor, 'CANCELLED', comment),
  },
});
const seline = (db, id) => db.prepare('SELECT e.*, o.doc_no AS so_no, o.title FROM proc_service_entries e JOIN proc_service_orders o ON o.id = e.so_id WHERE e.id = ?').get(id);
workflowTypes.register({
  docType: SES_DOC, label: 'Service entry sheet', processOwner: 'PM', route: (id) => `/proc/service-entries?id=${id}`,
  describe(db, companyId, id) { const e = seline(db, Number(id)); return e && e.company_id === companyId ? { ref: e.doc_no, title: `${e.doc_no} for ${e.so_no}: ${e.entry_amount / 100}`, originator: e.requested_by, projectId: e.org_project_id, amount: e.entry_amount / 100 } : null; },
  summarise(db, _actor, id) { const e = seline(db, Number(id)); if (!e) return null; const ls = db.prepare('SELECT l.qty, l.rate, o.description, o.uom FROM proc_se_lines l JOIN proc_so_lines o ON o.id = l.so_line_id WHERE l.se_id = ? AND l.deleted_at IS NULL').all(e.id); return { fields: [{ label: 'Order', value: `${e.so_no} ${e.title}` }, { label: 'Period', value: `${e.period_from} to ${e.period_to}` }, { label: 'Amount', value: String(e.entry_amount / 100) }, { label: 'Services', value: ls.map((l) => `${l.description}: ${l.qty / 1000} ${l.uom}`).join('; ') }] }; },
  defaultDefinition: { name: 'Service entry sheet: a site engineer certifies, then the project manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('SE', 'Site engineer (certifies the work)', 'SE', 24), approver('PM', 'Project manager', 'PM', 24)] },
  hooks: {
    onApproved: (db, { instance, actor }) => procOf(db)?.sesDecide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => procOf(db)?.sesDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => procOf(db)?.sesDecide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => procOf(db)?.sesDecide(instance, actor, 'CANCELLED', comment),
  },
});
// ---- expediting plan (15.07) and the inspection release note ------------------------------------------------------------------------------------------------------------------------------------
const xline = (db, id) => db.prepare('SELECT x.*, o.doc_no AS ono, p.code AS pcode, COALESCE(v.trade_name, v.legal_name) AS vname FROM xpd_expediting_plans x JOIN proc_purchase_orders o ON o.id = x.po_id JOIN org_projects p ON p.id = x.org_project_id JOIN mdm_partners v ON v.id = o.vendor_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: XPD_DOC, label: 'Expediting plan', processOwner: 'PROCMGR', route: (id) => `/proc/expediting-plans?id=${id}`,
  describe(db, companyId, id) { const r = xline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.pcode}: ${r.doc_no} for ${r.ono} with ${r.vname}`, originator: r.requested_by, projectId: r.org_project_id } : null; },
  summarise(db, _actor, id) { const r = xline(db, Number(id)); if (!r) return null; const ms = db.prepare('SELECT name, planned_date FROM xpd_milestones WHERE plan_id = ? AND deleted_at IS NULL ORDER BY seq_no').all(r.id); return { fields: [{ label: 'Order', value: `${r.ono} ${r.vname}` }, { label: 'Required on site', value: r.required_on_site }, { label: 'Long lead', value: r.long_lead ? 'yes' : 'no' }, { label: 'Inspection before dispatch', value: r.inspection_required ? 'required' : 'not required' }, { label: 'Milestones', value: ms.map((m) => `${m.name} ${m.planned_date}`).join('; ') }] }; },
  defaultDefinition: { name: 'Expediting plan: the procurement manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('PROCMGR', 'Procurement manager', 'PROCMGR', 24)] },
  hooks: {
    onApproved: (db, { instance, actor }) => procOf(db)?.xpdDecide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => procOf(db)?.xpdDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => procOf(db)?.xpdDecide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => procOf(db)?.xpdDecide(instance, actor, 'CANCELLED', comment),
  },
});
const irnline = (db, id) => db.prepare('SELECT x.*, o.doc_no AS ono, p.code AS pcode, COALESCE(v.trade_name, v.legal_name) AS vname FROM xpd_inspections x JOIN proc_purchase_orders o ON o.id = x.po_id JOIN org_projects p ON p.id = x.org_project_id JOIN mdm_partners v ON v.id = o.vendor_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: IRN_DOC, label: 'Inspection release note', processOwner: 'QCMGR', route: (id) => `/proc/inspections?id=${id}`,
  describe(db, companyId, id) { const r = irnline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.pcode}: ${r.doc_no} on ${r.ono} with ${r.vname}`, originator: r.requested_by, projectId: r.org_project_id } : null; },
  summarise(db, _actor, id) { const r = irnline(db, Number(id)); if (!r) return null; const pp = JSON.parse(r.punch_points_json ?? '[]'); return { fields: [{ label: 'Order', value: `${r.ono} ${r.vname}` }, { label: 'Type', value: r.itype.toLowerCase() }, { label: 'Inspected', value: `${r.inspection_date ?? ''} by ${r.inspector ?? ''}${r.agency ? ` (${r.agency})` : ''}` }, { label: 'Result', value: r.result.toLowerCase().replaceAll('_', ' ') }, { label: 'Punch points', value: pp.map((x) => `${x.point} (${x.severity.toLowerCase()})`).join('; ') || 'none' }] }; },
  defaultDefinition: { name: 'Inspection release note: a quality engineer reviews, the quality manager releases', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('QCE', 'Quality engineer (reviews the inspection)', 'QCE', 24), approver('QCMGR', 'Quality manager (releases)', 'QCMGR', 24)] },
  hooks: {
    onApproved: (db, { instance, actor }) => procOf(db)?.irnDecide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => procOf(db)?.irnDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => procOf(db)?.irnDecide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => procOf(db)?.irnDecide(instance, actor, 'CANCELLED', comment),
  },
});
// ---- vendor prequalification and suspension from the approved vendor list (15.08) ---------------------------------------------------------------------------------------------------------------------
const pqline = (db, id) => db.prepare('SELECT x.*, COALESCE(v.trade_name, v.legal_name) AS vname FROM vnd_prequalifications x JOIN mdm_partners v ON v.id = x.partner_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: PREQ_DOC, label: 'Vendor prequalification', processOwner: 'PROCMGR', route: (id) => `/proc/prequalifications?id=${id}`,
  describe(db, companyId, id) { const r = pqline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.doc_no} ${r.vname}: ${(r.score / 10000).toFixed(1)}%`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = pqline(db, Number(id)); if (!r) return null; const cats = JSON.parse(r.category_ids_json ?? '[]').map((c) => db.prepare('SELECT name FROM mdm_item_categories WHERE id = ?').get(c)?.name).filter(Boolean); return { fields: [{ label: 'Vendor', value: r.vname }, { label: 'Categories', value: cats.join(', ') }, { label: 'Score', value: `${(r.score / 10000).toFixed(1)}% (${r.result.toLowerCase().replaceAll('_', ' ')})` }, { label: 'Visit', value: r.visit_date ? `${r.visit_date}: ${r.visit_notes ?? ''}` : 'none' }, { label: 'Valid until', value: r.valid_until ?? '' }, { label: 'Strategic category', value: r.strategic ? 'yes' : 'no' }] }; },
  defaultDefinition: { name: 'Vendor prequalification: procurement manager, quality manager (technical), the direction for strategic categories', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('PROCMGR', 'Procurement manager', 'PROCMGR', 48), approver('QCMGR', 'Quality manager (technical)', 'QCMGR', 48), approver('DIR', 'Direction (strategic category)', 'DIR', 72, { field: 'needDir', op: 'eq', value: 'yes' })] },
  hooks: {
    onApproved: (db, { instance, actor }) => procOf(db)?.preqDecide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => procOf(db)?.preqDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => procOf(db)?.preqDecide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => procOf(db)?.preqDecide(instance, actor, 'CANCELLED', comment),
  },
});
const suline = (db, id) => db.prepare('SELECT x.*, COALESCE(v.trade_name, v.legal_name) AS vname FROM vnd_suspensions x JOIN mdm_partners v ON v.id = x.partner_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: SUSP_DOC, label: 'Suspension from the approved vendor list', processOwner: 'PROCMGR', route: (id) => `/proc/avl?suspension=${id}`,
  describe(db, companyId, id) { const r = suline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.doc_no} suspend ${r.vname}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = suline(db, Number(id)); if (!r) return null; return { fields: [{ label: 'Vendor', value: r.vname }, { label: 'Reason', value: r.reason }, { label: 'Suggested by the system', value: r.auto_suggested ? 'yes' : 'no' }, { label: 'Entries', value: String(JSON.parse(r.avl_ids_json ?? '[]').length) }] }; },
  defaultDefinition: { name: 'Suspension from the approved vendor list: procurement manager, then the direction', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('PROCMGR', 'Procurement manager', 'PROCMGR', 24), approver('DIR', 'Direction', 'DIR', 48)] },
  hooks: {
    onApproved: (db, { instance, actor }) => procOf(db)?.suspDecide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => procOf(db)?.suspDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => procOf(db)?.suspDecide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => procOf(db)?.suspDecide(instance, actor, 'CANCELLED', comment),
  },
});
/** @type {any[][]} */
const reg3 = [
  ['vnd_prequalification', 'Vendor prequalification', 'proc.prequalification.view', 'vnd_prequalifications', 'vndSvc', (s, a, id) => s.vndSvc.preqs.get(a, id), (r) => ({ status: r.status }), (r) => ({ label: `${r.docNo} ${r.vendor}`, status: r.status }), '/proc/prequalifications'],
  ['vnd_suspension', 'AVL suspension', 'proc.avl.view', 'vnd_suspensions', 'vndSvc', (s, a, id) => s.vndSvc.suspensions.get(a, id), (r) => ({ status: r.status }), (r) => ({ label: `${r.docNo} ${r.vendor}`, status: r.status }), '/proc/avl'],
  ['xpd_expediting_plan', 'Expediting plan', 'proc.expediting_plan.view', 'xpd_expediting_plans', 'xpdSvc', (s, a, id) => s.xpdSvc.plans.get(a, id), (r) => ({ projectId: r.projectId, status: r.status }), (r) => ({ label: `${r.docNo} ${r.poNo}`, status: r.status }), '/proc/expediting-plans'],
  ['xpd_inspection', 'Vendor inspection', 'proc.inspection.view', 'xpd_inspections', 'xpdSvc', (s, a, id) => s.xpdSvc.insps.get(a, id), (r) => ({ projectId: r.projectId, status: r.status }), (r) => ({ label: `${r.docNo} ${r.poNo}`, status: r.status }), '/proc/inspections'],
  ['xpd_shipment', 'Shipment', 'proc.shipment.view', 'xpd_shipments', 'xpdSvc', (s, a, id) => s.xpdSvc.ships.get(a, id), (r) => ({ projectId: r.projectId, status: r.status }), (r) => ({ label: `${r.docNo} ${r.poNo}`, status: r.status }), '/proc/shipments'],
  ['proc_rate_contract', 'Rate contract', 'proc.rate_contract.view', 'proc_rate_contracts', 'rcSvc', (s, a, id) => s.rcSvc.rcs.get(a, id), (r) => ({ companyId: null, status: r.status }), (r) => ({ label: `${r.docNo} ${r.vendor}`, status: r.status }), '/proc/rate-contracts'],
  ['proc_service_order', 'Service order', 'proc.service_order.view', 'proc_service_orders', 'soSvc', (s, a, id) => s.soSvc.sos.get(a, id), (r) => ({ projectId: r.projectId, siteId: r.siteId ?? undefined, status: r.status }), (r) => ({ label: `${r.docNo} ${r.vendor}`, status: r.status }), '/proc/service-orders'],
  ['proc_service_entry', 'Service entry sheet', 'proc.service_entry.view', 'proc_service_entries', 'soSvc', (s, a, id) => s.soSvc.ses.get(a, id), (r) => ({ projectId: r.projectId, status: r.status }), (r) => ({ label: `${r.docNo} ${r.soNo}`, status: r.status }), '/proc/service-entries'],
];
for (const [type, label, perm, table, , get, acc, sum, route] of reg3) {
  objectTypes.register({
    type, label, permission: perm, route: (id) => `${route}?id=${id}`, attachmentEntity: type, approvalTarget: type,
    access(db, actor, id) { const s = procOf(db); if (!s) return null; try { return { companyId: actor.companyId, ...acc(get(s, actor, Number(id))) }; } catch { return null; } },
    auditEntities: (id) => [{ entity: table, id }],
    summary(db, actor, id) { const s = procOf(db); if (!s) return null; try { return sum(get(s, actor, Number(id))); } catch { return null; } },
    related: () => [], projectRecords(db, companyId, projectId, limit) { const col = ['proc_rate_contracts', 'vnd_prequalifications', 'vnd_suspensions'].includes(table) ? null : 'org_project_id'; if (!col) return []; return db.prepare(`SELECT id FROM ${table} WHERE company_id = ? AND ${col} = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?`).all(companyId, projectId, limit).map((x) => x.id); },
    search(db, actor, q, limit) { if (!authzOf(db).check(actor, perm).allowed) return []; return db.prepare(`SELECT id FROM ${table} WHERE company_id = ? AND deleted_at IS NULL AND doc_no LIKE ? ORDER BY id DESC LIMIT ?`).all(actor.companyId, `%${q}%`, limit).map((x) => x.id); },
  });
  fileEntities.register({
    entity: type, label: `${label} (documents, scans, certificates)`,
    resolve(db, actor, id) {
      const r = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(Number(id), actor.companyId); if (!r) return null; const a = authzOf(db); const pj = r.org_project_id ?? undefined; const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: pj }).allowed; if (!at(perm)) return null; const open = ['DRAFT', 'RETURNED', 'PLANNED'].includes(r.status);
      return { companyId: r.company_id, projectId: pj, canView: true, canEdit: at(String(perm).replace('.view', '.edit')) && (open || r.status === 'APPROVED'), locked: !open && r.status !== 'APPROVED' };
    },
  });
}
