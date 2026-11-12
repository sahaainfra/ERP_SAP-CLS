import { Router } from 'express';
import { authzOf } from '../../platform/authz/index.js';
import { eventTypes } from '../../platform/events/index.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports } from '../../platform/list/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { workflowTypes } from '../../platform/workflow/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { createFlagService } from '../core/api.js';
import { createBase } from '../proc/base.js';
import { ADJ_STATUS, INV_ADJ_DOC, INV_CHG_DOC, INV_STORE_DOC, STORE_STATUS, createInvService } from './service.js';
import { invRoutes, gateRoutes, grnRoutes, issueRoutes, transferRoutes, countRoutes } from './routes.js';
import { COUNT_STATUS, DISPOSAL_STATUS, ENTRY_STATUS, INV_COUNT_DOC, INV_SCRAP_DOC, createCountService } from './count.js';
import { DISC_STATUS, INV_TRANSFER_DOC, INV_TRDISC_DOC, TRANSFER_STATUS, createTransferService } from './transfer.js';
import { INV_ISSUE_DOC, INV_RETURN_DOC, ISSUE_STATUS, RETURN_STATUS, createIssueService } from './issue.js';
import { GRN_STATUS, INV_GRN_DOC, INV_RTV_DOC, RTV_STATUS, createGrnService } from './grn.js';
import { APPT_STATUS, INV_INWARD_DOC, INV_PASS_DOC, INWARD_STATUS, PASS_STATUS, PASS_TYPES, createGateService } from './gate.js';

const services = new WeakMap();
export const invOf = (db) => services.get(db) ?? null;

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['inv.stock.moved', 'Stock moved in a store (part 16.01): data { ledgerId, storeId, storeCode, storeName, storeType, siteId, itemId, txnType, qty (signed, base unit), value (signed, paise), rate, batchNo, serialNo, ownerProjectId, sourceType, sourceId, freeQty, onHand, date }. For finance posting (23.02), project cost (14.07) and the stock the requisition sees (15.01).'],
  ['inv.stock.transferred', 'Stock changed owner between projects in a transfer (part 16.01, FR-07): data { itemId, qty, value, fromStoreId, toStoreId, fromProjectId, toProjectId, outIds, inIds, reason }. The financial transfer between the projects.'],
  ['inv.stock.reserved', 'Stock was reserved or a reservation was released (part 16.01): data { reservationId, storeId, itemId, qty, sourceType, sourceId, freeQty }.'],
  ['inv.store.activated', 'A store was approved and is active (part 16.01): data { storeId, code, type, projectId, siteId }.'],
  ['inv.gate.entered', 'A vehicle was recorded at the gate (part 16.02): data { inwardId, docNo, vehicleNo, siteId, poId, vendorId, shipmentId, challanNo, timeIn, unexpected }.'],
  ['inv.gate.flagged', 'A delivery came to the gate that is not expected, and waits for the store manager (part 16.02): data { inwardId, docNo, vehicleNo, poId, vendorId, flags }.'],
  ['inv.gate.handed_over', 'An unloaded vehicle was handed over to stores for the goods receipt (part 16.02, to 16.03): data { inwardId, docNo, storeId, storeCode, vehicleNo, poId, vendorId, shipmentId, challanNo, challanKg, netKg, materialDesc, unexpected }.'],
  ['inv.gate.exited', 'A delivery vehicle left the site (part 16.02): data { inwardId, docNo, vehicleNo, timeIn, timeOut, turnaroundMin }.'],
  ['inv.weighment.recorded', 'A vehicle was weighed, gross and tare (part 16.02, FR-03): data { inwardId, docNo, grossKg, tareKg, netKg, challanKg, variancePct, flagged, poId }.'],
  ['inv.weighment.variance', 'The weighed quantity differs from the challan beyond the tolerance (part 16.02, BR-02): data { inwardId, docNo, vendorId, poId, netKg, challanKg, variancePct, tolerancePct }.'],
  ['inv.gatepass.approved', 'An outbound gate pass was approved (part 16.02): data { passId, docNo, type, siteId, vehicleNo }.'],
  ['inv.gatepass.out', 'A gate pass was verified at the gate and the material left the site (part 16.02, to 19.06): data { passId, docNo, type, returnable, expectedReturn, siteId, vehicleNo, timeOut, items }.'],
  ['inv.gatepass.returned', 'Returnable material came back (part 16.02): data { passId, docNo, returnedOn, late }.'],
  ['inv.gatepass.overdue', 'A returnable gate pass is past its return date (part 16.02, FR-06): data { passId, docNo, expectedReturn, daysOverdue }.'],
  ['inv.grn.posted', 'A goods receipt was approved and posted (part 16.03): data { grnId, docNo, receivedOn, storeId, storeCode, poId, vendorId, gateInwardId, challanNo, invoiceNo, emergency, totalValue, lines [{ lineId, poLineId, itemId, uom, receivedQty, acceptedQty, rejectedQty, rate, value, inspectionRequired, directCharge, wbsId, costCodeId, ledgerNo }] }. Stock (16.01) is posted in the same transaction; the purchase order (15.05), the accrual (23.02), inspection (18.03), the vendor scorecard (15.08) and invoice matching (22.06) consume it.'],
  ['inv.grn.inspected', 'Quality control passed or failed part of a goods receipt (part 16.03): data { grnId, docNo, poId, vendorId, lines [{ lineId, itemId, passedQty, failedQty, status }] }.'],
  ['inv.grn.amended', 'The documents of a posted goods receipt were corrected (part 16.03): data { grnId, docNo, challanNo, invoiceNo, amendmentNo }.'],
  ['inv.rtv.posted', 'Material was returned to a vendor and left the stock (part 16.03, FR-05): data { rtvId, docNo, grnId, grnNo, poId, vendorId, storeId, reason, totalValue, gatePassId, debitNote, lines }. The debit note (23.03) is triggered by it.'],
  ['inv.issue.posted', 'Material was issued and left the stock (part 16.04): data { issueId, docNo, type, storeId, projectId, waId, mrId, activityId, wbsId, costCodeId, issuedTo, subcontractorId, freeIssue, chargeable, totalValue, recoverableValue, withException, lines [{ lineId, itemId, qty, rate, value, chargeRate, mrLineId }] }. The cost is charged to the WBS and cost code (12.03, 14.07, 23.02); the DPR (14.02), the reconciliation (16.10) and the subcontractor recovery (22.05) read it.'],
  ['inv.site_return.posted', 'Unused material came back from site (part 16.04): data { returnId, docNo, issueId, condition, storeId, projectId, wbsId, costCodeId, subcontractorId, freeIssue, totalValue, backToStock, lines }. The cost charged at issue is credited at the issue rate.'],
  ['inv.free_issue.excess', 'A subcontractor was given more free-issue material than the norms entitle it to (part 16.04, FR-06): data { projectId, subcontractorId, itemId, period, issuedQty, returnedQty, entitledQty, excessQty, recoveryRate, recoveryAmount }. The recovery goes to the subcontractor bill (22.05).'],
  ['inv.transfer.dispatched', 'A stock transfer left its source store and is in transit (part 16.05): data { transferId, docNo, fromStoreId, toStoreId, fromProjectId, toProjectId, interProject, interState, documentType, vehicleNo, ewayBillNo, gatePassId, totalValue, lines }.'],
  ['inv.transfer.received', 'Stock arrived at the destination store (part 16.05; one event for each receipt): data { transferId, docNo, fromStoreId, toStoreId, fromProjectId, toProjectId, interProject, receivedOn, final, receivedValue, costTransfer { fromProjectId, toProjectId, value }, lines }. Between projects the cost moves at the book rate (14.07, 23.02).'],
  ['inv.transfer.written_off', 'A transfer discrepancy was written off after approval (part 16.05): data { transferId, docNo, itemId, qty, kind, value, fromProjectId, toProjectId, reason }. The loss is booked by finance (23.02).'],
  ['inv.count.closed', 'A physical count was closed (part 16.06): data { planId, docNo, storeId, lines, gainValue, lossValue }. The variance goes to the adjustment.'],
  ['inv.scrap.recorded', 'Scrap was entered in the register (part 16.06): data { entryId, docNo, storeId, source, fromStock, itemId, qty, weightKg, bookValue }.'],
  ['inv.scrap.disposed', 'Scrap was disposed of by sale, auction or write-off after approval (part 16.06): data { disposalId, docNo, storeId, method, buyerPartnerId, invoiceNo, amount, bookValue, gainLoss, weightKg, gatePassId, lines }. Finance (23.02) books the gain or the loss.'],
  ['inv.scrap.sold', 'Scrap was sold or auctioned (part 16.06, FR-05): data { disposalId, docNo, buyerPartnerId, invoiceNo, amount, weightKg }. Receivables (23.05) raises the receipt.'],
  ['inv.integrity.failed', 'The nightly check found the stock balances different from the ledger (part 16.01): data { problems, kinds }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'inv', description });

integrityRegistry.register({
  statuses: { inv_stores: Object.keys(STORE_STATUS), inv_adjustments: Object.keys(ADJ_STATUS), inv_gate_inward: Object.keys(INWARD_STATUS), inv_gate_passes: Object.keys(PASS_STATUS), inv_grns: Object.keys(GRN_STATUS), inv_rtvs: Object.keys(RTV_STATUS), inv_issues: Object.keys(ISSUE_STATUS), inv_site_returns: Object.keys(RETURN_STATUS), inv_transfers: Object.keys(TRANSFER_STATUS), inv_transfer_discrepancies: Object.keys(DISC_STATUS), inv_count_plans: Object.keys(COUNT_STATUS), inv_scrap_disposals: Object.keys(DISPOSAL_STATUS), inv_scrap_entries: Object.keys(ENTRY_STATUS), inv_gate_appointments: Object.keys(APPT_STATUS) },
  uniqueKeys: [{ table: 'inv_count_plans', columns: ['company_id', 'doc_no'] }, { table: 'inv_scrap_disposals', columns: ['company_id', 'doc_no'] }, { table: 'inv_scrap_entries', columns: ['company_id', 'doc_no'] }, { table: 'inv_transfers', columns: ['company_id', 'doc_no'] }, { table: 'inv_issues', columns: ['company_id', 'doc_no'] }, { table: 'inv_site_returns', columns: ['company_id', 'doc_no'] }, { table: 'inv_grns', columns: ['company_id', 'doc_no'] }, { table: 'inv_rtvs', columns: ['company_id', 'doc_no'] }, { table: 'inv_gate_inward', columns: ['company_id', 'doc_no'] }, { table: 'inv_gate_passes', columns: ['company_id', 'doc_no'] }, { table: 'inv_gate_appointments', columns: ['company_id', 'doc_no'] }, { table: 'inv_stores', columns: ['company_id', 'code'] }, { table: 'inv_stock_ledger', columns: ['company_id', 'doc_no'] }, { table: 'inv_adjustments', columns: ['company_id', 'doc_no'] }, { table: 'inv_reservations', columns: ['company_id', 'doc_no'] }, { table: 'inv_store_changes', columns: ['company_id', 'doc_no'] }],
});

/** Module "inv": stores, inventory and site logistics (M16). Part 16.01 holds the stores, bins, the append-only stock ledger, balances, valuation, reservations and adjustments. The tables are `inv_*`. */
export const inv = {
  code: 'inv',
  name: 'Stores & Inventory',
  routePrefix: '/api/v1/inv',
  ownerPart: '16.01',
  status: 'Stores and warehouses with bins, an append-only stock ledger, balances by item, store, bin, batch and owner, moving weighted average or FIFO valuation, reservations, project ownership with inter-project transfers, approved adjustments and revaluation, opening stock import and a nightly check that balances equal the ledger.',
  tables: ['inv_stores', 'inv_store_changes', 'inv_bins', 'inv_stock_ledger', 'inv_balances', 'inv_valuation', 'inv_fifo_layers', 'inv_reservations', 'inv_adjustments', 'inv_gate_appointments', 'inv_gate_inward', 'inv_gate_weighments', 'inv_gate_passes', 'inv_grns', 'inv_grn_lines', 'inv_rtvs', 'inv_issues', 'inv_issue_lines', 'inv_site_returns', 'inv_sub_certified', 'inv_free_issue_ledger', 'inv_transfers', 'inv_transfer_lines', 'inv_transfer_discrepancies', 'inv_count_plans', 'inv_count_lines', 'inv_scrap_entries', 'inv_scrap_disposals'],
  resources: ['stores', 'bins', 'balances', 'ledger', 'valuation', 'movements', 'transfers', 'inspection', 'opening-stock', 'reservations', 'adjustments', 'dashboard', 'integrity', 'gate', 'inward', 'passes', 'appointments', 'grns', 'rtvs', 'issues', 'site-returns', 'free-issue', 'transfers', 'in-transit', 'count-plans', 'count-variance', 'scrap-entries', 'scrap-disposals', 'expiry'],

  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'inv_stores'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment }); const base = createBase({ db }); const invSvc = createInvService({ db, base });
    const gateSvc = createGateService({ db, base, invSvc }); const grnSvc = createGrnService({ db, base, invSvc, gate: gateSvc }); const issueSvc = createIssueService({ db, base, invSvc }); const trfSvc = createTransferService({ db, base, invSvc, gate: gateSvc }); const cntSvc = createCountService({ db, base, invSvc, gate: gateSvc }); const svc = { flags, base, invSvc, gate: gateSvc, grn: grnSvc, issue: issueSvc, count: cntSvc, countDecide: cntSvc.plans.decide, scrapDecide: cntSvc.disposals.decide, transfer: trfSvc, transferDecide: trfSvc.transfers.decide, discDecide: trfSvc.transfers.decideWriteOff, issueDecide: issueSvc.issues.decide, returnDecide: issueSvc.siteReturns.decide, grnDecide: grnSvc.grns.decide, rtvDecide: grnSvc.rtvs.decide, inwardDecide: gateSvc.inward.decide, passDecide: gateSvc.passes.decide, storeDecide: invSvc.stores.decide, changeDecide: invSvc.stores.changeDecide, adjDecide: invSvc.adjustments.decide }; services.set(db, svc);
    listExports.register('inv.stores', { source: (actor, req) => invSvc.stores.exportSource(actor, req), hidden: () => [] });
    listExports.register('inv.balances', { source: (actor, req) => invSvc.balances.exportSource(actor, req), hidden: () => [] });
    listExports.register('inv.gate_inward', { source: (actor, req) => { base.need(actor, 'inv.inward.export', 'export the gate register'); return gateSvc.inward.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('inv.gate_passes', { source: (actor, req) => { base.need(actor, 'inv.pass.export', 'export gate passes'); return gateSvc.passes.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('inv.grns', { source: (actor, req) => { base.need(actor, 'inv.grn.export', 'export goods receipts'); return grnSvc.grns.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('inv.rtvs', { source: (actor, req) => { base.need(actor, 'inv.rtv.export', 'export returns to vendor'); return grnSvc.rtvs.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('inv.issues', { source: (actor, req) => { base.need(actor, 'inv.issue.export', 'export issue slips'); return issueSvc.issues.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('inv.site_returns', { source: (actor, req) => { base.need(actor, 'inv.site_return.export', 'export site returns'); return issueSvc.siteReturns.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('inv.transfers', { source: (actor, req) => { base.need(actor, 'inv.transfer.export', 'export transfers'); return trfSvc.transfers.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('inv.count_plans', { source: (actor, req) => { base.need(actor, 'inv.count_plan.export', 'export count plans'); return cntSvc.plans.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('inv.scrap_disposals', { source: (actor, req) => { base.need(actor, 'inv.scrap_disposal.export', 'export scrap disposals'); return cntSvc.disposals.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    const runtime = runtimeOf(db);
    // 16.06: every morning the counts that are due and the shelf-life stock that is expiring or expired are told to the store managers
    runtime?.jobs?.register('inv.count_expiry_daily', (ctx) => { let due = 0; let exp = 0; if (db.prepare('SELECT id FROM org_companies').all().some((c) => flags.isOn({ companyId: c.id }, 'ff.inv.p1606'))) { due = cntSvc.plans.dueSweep(); exp = cntSvc.expiry.sweep(); } ctx.log(`Told about ${due} count(s) due and ${exp} expiry alert(s)`); return { due, expiry: exp }; }, { maxAttempts: 2, description: 'Cycle counts that are due and shelf-life stock about to expire' });
    runtime?.scheduler?.define({ code: 'inv.count_expiry_morning', cron: '15 3 * * *', jobType: 'inv.count_expiry_daily', description: 'Every morning 08:45 India time: cycle counts that are due and shelf-life stock about to expire are told to the store managers' });
    // 16.05: every morning the stock that has been in transit too long is told to the store managers
    runtime?.jobs?.register('inv.transfer_aged', (ctx) => { let n = 0; if (db.prepare('SELECT id FROM org_companies').all().some((c) => flags.isOn({ companyId: c.id }, 'ff.inv.p1605'))) n = trfSvc.inTransit.sweepAged(); ctx.log(`Told about ${n} transfer(s) in transit too long`); return { aged: n }; }, { maxAttempts: 2, description: 'Stock transfers in transit for more than the alert days' });
    runtime?.scheduler?.define({ code: 'inv.transfer_aged_morning', cron: '45 2 * * *', jobType: 'inv.transfer_aged', description: 'Every morning 08:15 India time: transfers still in transit after the alert days are told to the store managers' });
    // 16.02: a dispatched shipment (15.07) is an expected delivery at the site; every morning the late returnables are told and missed appointments marked
    runtime?.bus?.subscribe(['proc.shipment.dispatched'], (e) => { if (flags.isOn({ companyId: Number(e.companyId ?? e.company_id) }, 'ff.inv.p1602')) gateSvc.appointments.onShipment(e); }, { consumer: 'inv.gate_appointments' });
    runtime?.jobs?.register('inv.gate_daily', (ctx) => { let late = 0; let missed = 0; if (db.prepare('SELECT 1 FROM org_companies').all().some((c) => flags.isOn({ companyId: c.id }, 'ff.inv.p1602'))) { late = gateSvc.passes.sweepOverdue(); missed = gateSvc.appointments.markMissed(); } ctx.log(`Told about ${late} overdue returnable pass(es); ${missed} appointment(s) missed`); return { late, missed }; }, { maxAttempts: 2, description: 'Overdue returnable gate passes and missed delivery appointments' });
    runtime?.scheduler?.define({ code: 'inv.gate_daily_morning', cron: '30 2 * * *', jobType: 'inv.gate_daily', description: 'Every morning 08:00 India time: returnable gate passes past their return date are told; delivery appointments that did not arrive are marked missed' });
    // BR-03: every night at 02:30 India time the balances are checked against the ledger
    runtime?.jobs?.register('inv.integrity_check', (ctx) => { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) { if (!flags.isOn({ companyId: c.id }, 'ff.inv.p1601')) continue; n = invSvc.nightly(); break; } ctx.log(`Stock books checked: ${n} company(ies) with differences`); return { withDifferences: n }; }, { maxAttempts: 2, description: 'Checks that the stock balances and valuations equal the sum of the stock ledger and tells the store managers of any difference.' });
    runtime?.scheduler?.define({ code: 'inv.integrity_check_nightly', cron: '0 21 * * *', jobType: 'inv.integrity_check', description: 'Every night 02:30 India time: the stock balances are checked against the ledger' });
    const gateRouter = gateRoutes(svc, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags });
    api.use('/inv', gateRouter);
    api.use('/inv', countRoutes(svc, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags }));
    api.use('/inv', transferRoutes(svc, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags }));
    api.use('/inv', issueRoutes(svc, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags }));
    api.use('/inv', grnRoutes(svc, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags }));
    const router = Router();
    router.use((req, _res, next) => (flags.isOn(req.actor, 'ff.inv.p1601') ? next() : next(notFound('Stores and stock are not enabled for your company yet (feature flag ff.inv.p1601 is OFF).'))));
    router.use(invRoutes(svc, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
    api.use('/inv', router);
  },
};

const approver = (code, name, role, slaHours, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours, requireAttachment: false, checklist: [], when, notify: [], action: null });
const hooks = (fn) => ({ onApproved: (db, { instance, actor }) => invOf(db)?.[fn](instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => invOf(db)?.[fn](instance, actor, 'REJECTED', comment), onReturned: (db, { instance, actor, comment }) => invOf(db)?.[fn](instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => invOf(db)?.[fn](instance, actor, 'CANCELLED', comment) });
const storeLine = (db, id) => db.prepare('SELECT s.*, p.code AS pcode FROM inv_stores s LEFT JOIN org_projects p ON p.id = s.org_project_id WHERE s.id = ?').get(id);
workflowTypes.register({
  docType: INV_STORE_DOC, label: 'Store', processOwner: 'STOREMGR', route: (id) => `/inv/stores?id=${id}`,
  describe(db, companyId, id) { const s = storeLine(db, Number(id)); return s && s.company_id === companyId ? { ref: s.code, title: `${s.code} ${s.name}`, originator: s.requested_by, projectId: s.org_project_id ?? undefined } : null; },
  summarise(db, _actor, id) { const s = storeLine(db, Number(id)); if (!s) return null; return { fields: [{ label: 'Store', value: `${s.code} ${s.name}` }, { label: 'Type', value: s.store_type.toLowerCase().replaceAll('_', ' ') }, { label: 'Project', value: s.pcode ?? 'company pool' }, { label: 'Valuation', value: s.valuation_method === 'FIFO' ? 'first in, first out' : 'weighted average' }, { label: 'Negative stock', value: s.allow_negative ? 'allowed' : 'blocked' }, { label: 'Keepers', value: JSON.parse(s.keeper_ids_json ?? '[]').join(', ') || 'none' }] }; },
  defaultDefinition: { name: 'Store: the store manager approves', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('STOREMGR', 'Store manager', 'STOREMGR', 24)] }, hooks: hooks('storeDecide'),
});
const chgLine = (db, id) => db.prepare('SELECT c.*, s.code, s.name FROM inv_store_changes c JOIN inv_stores s ON s.id = c.store_id WHERE c.id = ?').get(id);
workflowTypes.register({
  docType: INV_CHG_DOC, label: 'Store settings change', processOwner: 'STOREMGR', route: () => '/inv/stores',
  describe(db, companyId, id) { const c = chgLine(db, Number(id)); return c && c.company_id === companyId ? { ref: c.doc_no, title: `${c.doc_no}: ${c.code} ${c.name}`, originator: c.requested_by } : null; },
  summarise(db, _actor, id) { const c = chgLine(db, Number(id)); if (!c) return null; return { fields: [{ label: 'Store', value: `${c.code} ${c.name}` }, { label: 'Change', value: Object.entries(JSON.parse(c.changes_json ?? '{}')).map(([k, v]) => `${k}: ${v}`).join('; ') }, { label: 'Reason', value: c.reason }] }; },
  defaultDefinition: { name: 'Store settings change: the store manager, then the accounts manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('STOREMGR', 'Store manager', 'STOREMGR', 24), approver('ACCMGR', 'Accounts manager (valuation and negative stock)', 'ACCMGR', 48)] }, hooks: hooks('changeDecide'),
});
const adjLine = (db, id) => db.prepare('SELECT a.*, s.code AS scode FROM inv_adjustments a JOIN inv_stores s ON s.id = a.store_id WHERE a.id = ?').get(id);
workflowTypes.register({
  docType: INV_ADJ_DOC, label: 'Stock adjustment', processOwner: 'STOREMGR', route: (id) => `/inv/adjustments?id=${id}`,
  describe(db, companyId, id) { const a = adjLine(db, Number(id)); return a && a.company_id === companyId ? { ref: a.doc_no, title: `${a.doc_no} ${a.scode}: ${a.reason}`, originator: a.requested_by, amount: Math.abs(a.value_delta) / 100 } : null; },
  summarise(db, _actor, id) { const a = adjLine(db, Number(id)); if (!a) return null; const ls = JSON.parse(a.lines_json ?? '[]'); return { fields: [{ label: 'Store', value: a.scode }, { label: 'Type', value: a.adj_type === 'REVALUATION' ? 'revaluation' : 'quantity' }, { label: 'Value effect', value: String(a.value_delta / 100) }, { label: 'Reason', value: a.reason }, { label: 'Lines', value: ls.map((l) => `${l.code}: ${a.adj_type === 'REVALUATION' ? `rate ${l.oldRate / 100} to ${l.newRate / 100}` : `${l.qtyDelta / 1000}`}`).join('; ') }] }; },
  defaultDefinition: { name: 'Stock adjustment: the store manager; the accounts manager for a revaluation or a large value', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('STOREMGR', 'Store manager', 'STOREMGR', 24), approver('ACCMGR', 'Accounts manager (revaluation or ₹ 1 lakh and above)', 'ACCMGR', 48, { field: 'needAcc', op: 'eq', value: 'yes' })] }, hooks: hooks('adjDecide'),
});

const inLine = (db, id) => db.prepare('SELECT x.*, t.name AS sname FROM inv_gate_inward x JOIN org_sites t ON t.id = x.org_site_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: INV_INWARD_DOC, label: 'Unexpected delivery at the gate', processOwner: 'STOREMGR', route: (id) => `/inv/gate-entry?id=${id}`,
  describe(db, companyId, id) { const r = inLine(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.doc_no} ${r.vehicle_no}: ${r.material_desc}`, originator: r.requested_by, projectId: r.org_project_id } : null; },
  summarise(db, _actor, id) { const r = inLine(db, Number(id)); if (!r) return null; return { fields: [{ label: 'Vehicle', value: `${r.vehicle_no} (${r.driver_name})` }, { label: 'Site', value: r.sname }, { label: 'Material', value: r.material_desc }, { label: 'Challan', value: r.challan_no ?? 'none' }, { label: 'Why it is not expected', value: JSON.parse(r.flags_json ?? '[]').map((f) => f.message).join(' ') }] }; },
  defaultDefinition: { name: 'Unexpected delivery: the store manager accepts or refuses it', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('STOREMGR', 'Store manager', 'STOREMGR', 4)] }, hooks: hooks('inwardDecide'),
});
const pLine = (db, id) => db.prepare('SELECT x.*, t.name AS sname FROM inv_gate_passes x JOIN org_sites t ON t.id = x.org_site_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: INV_PASS_DOC, label: 'Outbound gate pass', processOwner: 'CM', route: (id) => `/inv/gate-pass?id=${id}`,
  describe(db, companyId, id) { const r = pLine(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.doc_no} ${PASS_TYPES[r.pass_type]} to ${r.destination}`, originator: r.requested_by, projectId: r.org_project_id } : null; },
  summarise(db, _actor, id) { const r = pLine(db, Number(id)); if (!r) return null; return { fields: [{ label: 'Type', value: PASS_TYPES[r.pass_type] }, { label: 'From', value: r.sname }, { label: 'To', value: r.destination }, { label: 'Purpose', value: r.purpose }, { label: 'Back by', value: r.expected_return ?? 'not returnable' }, { label: 'Items', value: JSON.parse(r.items_json ?? '[]').map((l) => `${l.description} ${l.qty / 1000} ${l.uom}`).join('; ') }] }; },
  defaultDefinition: { name: 'Gate pass: the construction manager; the project manager for non-returnable material and scrap', settings: { resubmit: 'first', distinctApprovers: true }, steps: [
    { ...approver('CM', 'Construction manager or store manager', 'CM', 8), approvers: [{ kind: 'role', role: 'CM' }, { kind: 'role', role: 'STOREMGR' }] }, approver('PM', 'Project manager (non-returnable material or scrap)', 'PM', 24, { field: 'needPm', op: 'eq', value: 'yes' })] }, hooks: hooks('passDecide'),
});

const gLine = (db, id) => db.prepare('SELECT g.*, s.code AS scode, v.legal_name AS vname FROM inv_grns g JOIN inv_stores s ON s.id = g.store_id JOIN mdm_partners v ON v.id = g.vendor_id WHERE g.id = ?').get(id);
workflowTypes.register({
  docType: INV_GRN_DOC, label: 'Goods receipt', processOwner: 'STOREMGR', route: (id) => `/inv/grns?id=${id}`,
  describe(db, companyId, id) { const g = gLine(db, Number(id)); return g && g.company_id === companyId ? { ref: g.doc_no, title: `${g.doc_no} ${g.vname} into ${g.scode}`, originator: g.requested_by, projectId: g.org_project_id } : null; },
  summarise(db, _actor, id) { const g = gLine(db, Number(id)); if (!g) return null; const ls = db.prepare('SELECT l.*, i.code FROM inv_grn_lines l JOIN mdm_items i ON i.id = l.item_id WHERE l.grn_id = ? AND l.deleted_at IS NULL ORDER BY l.line_no').all(g.id); return { fields: [{ label: 'Vendor', value: g.vname }, { label: 'Store', value: g.scode }, { label: 'Challan', value: g.challan_no ?? 'none' }, { label: 'Order', value: g.po_id ? db.prepare('SELECT doc_no FROM proc_purchase_orders WHERE id = ?').get(g.po_id)?.doc_no : `none (emergency: ${g.emergency_why})` }, { label: 'Excess over the order', value: g.excess ? 'yes' : 'no' }, { label: 'Lines', value: ls.map((l) => `${l.code}: received ${l.received_qty / 1000}, accepted ${l.accepted_qty / 1000}`).join('; ') }] }; },
  defaultDefinition: { name: 'Goods receipt: the store manager or construction manager; the procurement manager for an excess or a receipt without an order', settings: { resubmit: 'first', distinctApprovers: true }, steps: [
    { ...approver('STOREMGR', 'Store manager or construction manager', 'STOREMGR', 12), approvers: [{ kind: 'role', role: 'STOREMGR' }, { kind: 'role', role: 'CM' }] }, approver('PROCMGR', 'Procurement manager (excess or no order)', 'PROCMGR', 24, { field: 'needProc', op: 'eq', value: 'yes' })] }, hooks: hooks('grnDecide'),
});
const rLine = (db, id) => db.prepare('SELECT r.*, v.legal_name AS vname, g.doc_no AS gno FROM inv_rtvs r JOIN mdm_partners v ON v.id = r.vendor_id JOIN inv_grns g ON g.id = r.grn_id WHERE r.id = ?').get(id);
workflowTypes.register({
  docType: INV_RTV_DOC, label: 'Return to vendor', processOwner: 'PROCMGR', route: (id) => `/inv/rtvs?id=${id}`,
  describe(db, companyId, id) { const r = rLine(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.doc_no} ${r.vname}: ${r.reason}`, originator: r.requested_by, projectId: r.org_project_id, amount: r.total_value } : null; },
  summarise(db, _actor, id) { const r = rLine(db, Number(id)); if (!r) return null; return { fields: [{ label: 'Vendor', value: r.vname }, { label: 'Receipt', value: r.gno }, { label: 'Reason', value: r.reason }, { label: 'Value', value: String(r.total_value / 100) }, { label: 'Lines', value: JSON.parse(r.lines_json ?? '[]').map((l) => `${l.qty / 1000} ${l.uom}`).join('; ') }] }; },
  defaultDefinition: { name: 'Return to vendor: the procurement manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('PROCMGR', 'Procurement manager', 'PROCMGR', 24)] }, hooks: hooks('rtvDecide'),
});

const isLine = (db, id) => db.prepare('SELECT i.*, s.code AS scode FROM inv_issues i JOIN inv_stores s ON s.id = i.store_id WHERE i.id = ?').get(id);
workflowTypes.register({
  docType: INV_ISSUE_DOC, label: 'Chargeable issue to a subcontractor', processOwner: 'QS', route: (id) => `/inv/issues?id=${id}`,
  describe(db, companyId, id) { const r = isLine(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.doc_no} to ${r.issued_to_name} from ${r.scode}`, originator: r.requested_by, projectId: r.org_project_id } : null; },
  summarise(db, _actor, id) { const r = isLine(db, Number(id)); if (!r) return null; const ls = db.prepare('SELECT l.*, i.code FROM inv_issue_lines l JOIN mdm_items i ON i.id = l.item_id WHERE l.issue_id = ? AND l.deleted_at IS NULL ORDER BY l.line_no').all(r.id); return { fields: [{ label: 'Subcontractor', value: r.issued_to_name }, { label: 'Store', value: r.scode }, { label: 'Lines', value: ls.map((l) => `${l.code}: ${l.qty / 1000} ${l.uom} at ${l.charge_rate == null ? '-' : l.charge_rate / 100}`).join('; ') }] }; },
  defaultDefinition: { name: 'Chargeable issue: the subcontractor, then the quantity surveyor for the rate', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('SUBCO', 'Subcontractor acknowledges', 'SUBCO', 24), approver('QS', 'Quantity surveyor (the rate)', 'QS', 24)] }, hooks: hooks('issueDecide'),
});
const srLine = (db, id) => db.prepare('SELECT r.*, i.doc_no AS ino FROM inv_site_returns r JOIN inv_issues i ON i.id = r.issue_id WHERE r.id = ?').get(id);
workflowTypes.register({
  docType: INV_RETURN_DOC, label: 'Site return', processOwner: 'STOREMGR', route: (id) => `/inv/site-returns?id=${id}`,
  describe(db, companyId, id) { const r = srLine(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.doc_no} against ${r.ino}: ${r.condition.toLowerCase()}`, originator: r.requested_by, projectId: r.org_project_id } : null; },
  summarise(db, _actor, id) { const r = srLine(db, Number(id)); if (!r) return null; return { fields: [{ label: 'Issue slip', value: r.ino }, { label: 'Returned by', value: r.from_name }, { label: 'Condition', value: r.condition }, { label: 'Reason', value: r.reason }, { label: 'Lines', value: JSON.parse(r.lines_json ?? '[]').map((l) => `${l.qty / 1000} ${l.uom}`).join('; ') }] }; },
  defaultDefinition: { name: 'Site return: the store manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('STOREMGR', 'Store manager', 'STOREMGR', 12)] }, hooks: hooks('returnDecide'),
});

const tLine = (db, id) => db.prepare('SELECT t.*, f.code AS fcode, o.code AS tcode FROM inv_transfers t JOIN inv_stores f ON f.id = t.from_store_id JOIN inv_stores o ON o.id = t.to_store_id WHERE t.id = ?').get(id);
workflowTypes.register({
  docType: INV_TRANSFER_DOC, label: 'Stock transfer', processOwner: 'STOREMGR', route: (id) => `/inv/transfers?id=${id}`,
  describe(db, companyId, id) { const t = tLine(db, Number(id)); return t && t.company_id === companyId ? { ref: t.doc_no, title: `${t.doc_no} ${t.fcode} to ${t.tcode}${t.inter_project ? ' (between projects)' : ''}`, originator: t.requested_by, projectId: t.from_project_id ?? t.to_project_id ?? undefined } : null; },
  summarise(db, _actor, id) { const t = tLine(db, Number(id)); if (!t) return null; const ls = db.prepare('SELECT l.*, i.code FROM inv_transfer_lines l JOIN mdm_items i ON i.id = l.item_id WHERE l.transfer_id = ? AND l.deleted_at IS NULL ORDER BY l.line_no').all(t.id); return { fields: [{ label: 'From', value: t.fcode }, { label: 'To', value: t.tcode }, { label: 'Between projects', value: t.inter_project ? 'yes' : 'no' }, { label: 'Between states', value: t.inter_state ? 'yes' : 'no' }, { label: 'Required by', value: t.required_by ?? '-' }, { label: 'Lines', value: ls.map((l) => `${l.code}: ${l.qty_requested / 1000} ${l.uom}`).join('; ') }] }; },
  defaultDefinition: { name: 'Transfer: the construction manager or store manager of the source; between projects the project managers of both', settings: { resubmit: 'first', distinctApprovers: true }, steps: [
    { ...approver('CM', 'Construction manager or store manager of the source', 'CM', 12), approvers: [{ kind: 'role', role: 'CM' }, { kind: 'role', role: 'STOREMGR' }] }, approver('PM_FROM', 'Project manager (between projects)', 'PM', 24, { field: 'needPm', op: 'eq', value: 'yes' }), approver('PM_TO', 'Second project manager (between projects)', 'PM', 24, { field: 'needPm', op: 'eq', value: 'yes' })] }, hooks: hooks('transferDecide'),
});
const dLine = (db, id) => db.prepare('SELECT d.*, t.doc_no, t.company_id AS cid FROM inv_transfer_discrepancies d JOIN inv_transfers t ON t.id = d.transfer_id WHERE d.id = ?').get(id);
workflowTypes.register({
  docType: INV_TRDISC_DOC, label: 'Transfer discrepancy write-off', processOwner: 'STOREMGR', route: () => '/inv/transfers',
  describe(db, companyId, id) { const d = dLine(db, Number(id)); return d && d.cid === companyId ? { ref: d.doc_no, title: `${d.doc_no}: write off ${(d.shortage_qty || d.damaged_qty) / 1000} ${d.shortage_qty ? 'short' : 'damaged'}`, originator: d.resolved_by ?? d.raised_by, amount: d.value } : null; },
  summarise(db, _actor, id) { const d = dLine(db, Number(id)); if (!d) return null; return { fields: [{ label: 'Transfer', value: d.doc_no }, { label: 'Kind', value: d.shortage_qty ? 'shortage' : 'damaged' }, { label: 'Quantity', value: String((d.shortage_qty || d.damaged_qty) / 1000) }, { label: 'Value', value: String(d.value / 100) }, { label: 'Why', value: d.resolution_note ?? '' }] }; },
  defaultDefinition: { name: 'Discrepancy write-off: the store manager, then the procurement manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('STOREMGR', 'Store manager', 'STOREMGR', 24), approver('PROCMGR', 'Procurement manager', 'PROCMGR', 48)] }, hooks: hooks('discDecide'),
});

const cpLine = (db, id) => db.prepare('SELECT p.*, s.code AS scode FROM inv_count_plans p JOIN inv_stores s ON s.id = p.store_id WHERE p.id = ?').get(id);
workflowTypes.register({
  docType: INV_COUNT_DOC, label: 'Count plan', processOwner: 'STOREMGR', route: (id) => `/inv/count-plans?id=${id}`,
  describe(db, companyId, id) { const p = cpLine(db, Number(id)); return p && p.company_id === companyId ? { ref: p.doc_no, title: `${p.doc_no} ${p.plan_type === 'FULL' ? 'full count' : `class ${p.abc_class} count`} of ${p.scode}`, originator: p.requested_by, projectId: p.org_project_id ?? undefined } : null; },
  summarise(db, _actor, id) { const p = cpLine(db, Number(id)); if (!p) return null; return { fields: [{ label: 'Store', value: p.scode }, { label: 'Type', value: p.plan_type === 'FULL' ? 'full count' : `cycle count, class ${p.abc_class}` }, { label: 'Scheduled', value: p.scheduled_date }, { label: 'Stock frozen while counting', value: p.freeze ? 'yes' : 'no' }] }; },
  defaultDefinition: { name: 'Count plan: the store manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('STOREMGR', 'Store manager', 'STOREMGR', 24)] }, hooks: hooks('countDecide'),
});
workflowTypes.register({
  docType: 'INV_ADJ_BAND', label: 'Stock adjustment from a count', processOwner: 'STOREMGR', route: (id) => `/inv/adjustments?id=${id}`,
  describe(db, companyId, id) { const a = adjLine(db, Number(id)); return a && a.company_id === companyId ? { ref: a.doc_no, title: `${a.doc_no} ${a.scode}: ${a.reason}`.slice(0, 200), originator: a.requested_by, amount: Math.abs(a.value_delta), projectId: undefined } : null; },
  summarise(db, _actor, id) { const a = adjLine(db, Number(id)); if (!a) return null; const ls = JSON.parse(a.lines_json ?? '[]'); return { fields: [{ label: 'Store', value: a.scode }, { label: 'Source', value: `physical count ${a.source_id}` }, { label: 'Value effect', value: String(a.value_delta / 100) }, { label: 'Reason', value: a.reason }, { label: 'Lines', value: ls.map((l) => `${l.code}: ${l.qtyDelta / 1000}`).join('; ') }] }; },
  defaultDefinition: { name: 'Adjustment from a count: the store manager; the procurement manager above ₹ 50,000; the CFO above ₹ 5 lakh', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('STOREMGR', 'Store manager', 'STOREMGR', 24), approver('PROCMGR', 'Procurement manager (above ₹ 50,000)', 'PROCMGR', 48, { field: 'needProc', op: 'eq', value: 'yes' }), approver('CFO', 'CFO (above ₹ 5 lakh)', 'CFO', 72, { field: 'needCfo', op: 'eq', value: 'yes' })] }, hooks: hooks('adjDecide'),
});
const sdLine = (db, id) => db.prepare('SELECT d.*, s.code AS scode FROM inv_scrap_disposals d JOIN inv_stores s ON s.id = d.store_id WHERE d.id = ?').get(id);
workflowTypes.register({
  docType: INV_SCRAP_DOC, label: 'Scrap disposal', processOwner: 'STOREMGR', route: (id) => `/inv/scrap?id=${id}`,
  describe(db, companyId, id) { const d = sdLine(db, Number(id)); return d && d.company_id === companyId ? { ref: d.doc_no, title: `${d.doc_no} ${d.method.toLowerCase().replace('_', '-')} from ${d.scode}`, originator: d.requested_by, amount: d.method === 'WRITE_OFF' ? d.book_value : d.amount, projectId: d.org_project_id ?? undefined } : null; },
  summarise(db, _actor, id) { const d = sdLine(db, Number(id)); if (!d) return null; return { fields: [{ label: 'Method', value: d.method }, { label: 'Store', value: d.scode }, { label: 'Buyer', value: d.buyer_partner_id ? db.prepare('SELECT legal_name FROM mdm_partners WHERE id = ?').get(d.buyer_partner_id)?.legal_name : '-' }, { label: 'Invoice', value: d.invoice_no ?? '-' }, { label: 'Weight (kg)', value: String(d.weight_kg / 1000) }, { label: 'Book value', value: String(d.book_value / 100) }, { label: 'Sale amount', value: String(d.amount / 100) }] }; },
  defaultDefinition: { name: 'Scrap disposal: the store manager, the procurement manager and the CFO (a write-off by the value band)', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('STOREMGR', 'Store manager', 'STOREMGR', 24), approver('PROCMGR', 'Procurement manager', 'PROCMGR', 48, { field: 'needProc', op: 'eq', value: 'yes' }), approver('CFO', 'CFO', 'CFO', 72, { field: 'needCfo', op: 'eq', value: 'yes' })] }, hooks: hooks('scrapDecide'),
});

/** @type {any[][]} */
const invObjects = [
  ['inv_store', 'Store', 'inv.store.view', 'inv_stores', (s, a, id) => s.invSvc.stores.get(a, id), (r) => ({ projectId: r.projectId ?? undefined, status: r.status }), (r) => ({ label: `${r.code} ${r.name}`, status: r.status }), '/inv/stores', 'code'],
  ['inv_count_plan', 'Count plan', 'inv.count_plan.view', 'inv_count_plans', (s, a, id) => s.count.plans.get(a, id), (r) => ({ projectId: r.projectId ?? undefined, status: r.status }), (r) => ({ label: `${r.docNo} ${r.store}`, status: r.status }), '/inv/count-plans', 'doc_no'],
  ['inv_scrap_disposal', 'Scrap disposal', 'inv.scrap_disposal.view', 'inv_scrap_disposals', (s, a, id) => s.count.disposals.get(a, id), (r) => ({ status: r.status }), (r) => ({ label: `${r.docNo} ${r.methodLabel}`, status: r.status }), '/inv/scrap', 'doc_no'],
  ['inv_transfer', 'Stock transfer', 'inv.transfer.view', 'inv_transfers', (s, a, id) => s.transfer.transfers.get(a, id), (r) => ({ projectId: r.fromProjectId ?? r.toProjectId ?? undefined, status: r.status }), (r) => ({ label: `${r.docNo} ${r.from} to ${r.to}`, status: r.status }), '/inv/transfers', 'doc_no'],
  ['inv_issue', 'Issue slip', 'inv.issue.view', 'inv_issues', (s, a, id) => s.issue.issues.get(a, id), (r) => ({ projectId: r.projectId ?? undefined, status: r.status }), (r) => ({ label: `${r.docNo} ${r.issuedTo}`, status: r.status }), '/inv/issues', 'doc_no'],
  ['inv_site_return', 'Site return', 'inv.site_return.view', 'inv_site_returns', (s, a, id) => s.issue.siteReturns.get(a, id), (r) => ({ projectId: r.projectId ?? undefined, status: r.status }), (r) => ({ label: `${r.docNo} ${r.fromName}`, status: r.status }), '/inv/site-returns', 'doc_no'],
  ['inv_grn', 'Goods receipt', 'inv.grn.view', 'inv_grns', (s, a, id) => s.grn.grns.get(a, id), (r) => ({ projectId: r.projectId ?? undefined, status: r.status }), (r) => ({ label: `${r.docNo} ${r.vendor}`, status: r.status }), '/inv/grns', 'doc_no'],
  ['inv_rtv', 'Return to vendor', 'inv.rtv.view', 'inv_rtvs', (s, a, id) => s.grn.rtvs.get(a, id), (r) => ({ projectId: r.projectId ?? undefined, status: r.status }), (r) => ({ label: `${r.docNo} ${r.vendor}`, status: r.status }), '/inv/rtvs', 'doc_no'],
  ['inv_gate_inward', 'Gate entry', 'inv.inward.view', 'inv_gate_inward', (s, a, id) => s.gate.inward.get(a, id), (r) => ({ projectId: r.projectId ?? undefined, status: r.status }), (r) => ({ label: `${r.docNo} ${r.vehicleNo}`, status: r.status }), '/inv/gate-entry', 'doc_no'],
  ['inv_gate_pass', 'Gate pass', 'inv.pass.view', 'inv_gate_passes', (s, a, id) => s.gate.passes.get(a, id), (r) => ({ projectId: r.projectId ?? undefined, status: r.status }), (r) => ({ label: `${r.docNo} ${r.destination}`, status: r.status }), '/inv/gate-pass', 'doc_no'],
  ['inv_adjustment', 'Stock adjustment', 'inv.adjustment.view', 'inv_adjustments', (s, a, id) => s.invSvc.adjustments.get(a, id), (r) => ({ status: r.status }), (r) => ({ label: `${r.docNo} ${r.store}`, status: r.status }), '/inv/adjustments', 'doc_no'],
];
for (const [type, label, perm, table, get, acc, sum, route, searchCol] of invObjects) {
  objectTypes.register({
    type, label, permission: perm, route: (id) => `${route}?id=${id}`, attachmentEntity: type, approvalTarget: type,
    access(db, actor, id) { const s = invOf(db); if (!s) return null; try { return { companyId: actor.companyId, ...acc(get(s, actor, Number(id))) }; } catch { return null; } },
    auditEntities: (id) => [{ entity: table, id }],
    summary(db, actor, id) { const s = invOf(db); if (!s) return null; try { return sum(get(s, actor, Number(id))); } catch { return null; } },
    related: () => [], projectRecords(db, companyId, projectId, limit) { const col = table === 'inv_stores' ? 'org_project_id' : 'project_id'; return db.prepare(`SELECT id FROM ${table} WHERE company_id = ? AND ${col} = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?`).all(companyId, projectId, limit).map((x) => x.id); },
    search(db, actor, q, limit) { if (!authzOf(db).check(actor, perm).allowed) return []; return db.prepare(`SELECT id FROM ${table} WHERE company_id = ? AND deleted_at IS NULL AND ${searchCol} LIKE ? ORDER BY id DESC LIMIT ?`).all(actor.companyId, `%${q}%`, limit).map((x) => x.id); },
  });
}
