import { authzOf } from '../../platform/authz/index.js';
import { eventTypes } from '../../platform/events/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports } from '../../platform/list/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { workflowTypes } from '../../platform/workflow/index.js';
import { createFlagService } from '../core/api.js';
import { createBase } from '../proc/base.js';
import { STATUS } from '../qa/flow.js';
import { createLedgerService } from './ledger.js';
import { createVinvService } from './vinv.js';
import { createHubService } from './hub.js';
import { createSubService } from './sub.js';
import { createCertService } from './cert.js';
import { createClientBillService } from './clientbill.js';
import { createDeviationService } from './deviation.js';
import { createInvoiceService } from './invoice.js';
import { createMbService } from './mb.js';
import { createReconService } from './recon.js';
import { billRoutes } from './routes.js';

// Measurement and billing (module M22): the measurement book and check measurement (22.01); later quantity reconciliation, the client RA bill, subcontractor measurements and bills.
const services = new WeakMap();
export const billOf = (db) => services.get(db) ?? null;
export const BILL_DOCS = { mb: 'BILL_MB_ENTRY', deviation: 'BILL_DEVIATION', clientBill: 'BILL_CLIENT_BILL', certification: 'BILL_CERTIFICATION', taxInvoice: 'BILL_TAX_INVOICE', subBill: 'BILL_SUB_BILL', vendorInvoice: 'BILL_VENDOR_INVOICE', advance: 'BILL_ADVANCE', release: 'BILL_RELEASE' };

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['bill.mb.certified', 'A measurement was certified and locked (part 22.01 FR-05): data { mbId, docNo, projectId, boqLineId, boqCode, description, locationId, waId, activityId, irId, uom, measuredQty, certifiedQty, checkedQty, checkStatus, measuredBy, measuredOn, certifiedOn, period, book, page, line }. The client RA bill (22.03), the quantity reconciliation (22.02) and the financial progress (14.05) read it.'],
  ['bill.advance.approved', 'An advance received or given was approved (part 22.07): data { advanceId, docNo, refNo, projectId, direction, partyType, partyId, contractId, woId, type, amount, advanceDate, rule, interestPct }.'],
  ['bill.release.approved', 'A release of retention or security deposit was approved and posted to the ledger (part 22.07, for the payables 23.03, the receivables 23.05 and the cash forecast 23.13): data { releaseId, docNo, projectId, kind, partyType, partyId, contractId, woId, basis, amount, balanceAfter, direction, waived }.'],
  ['ap.invoice.matched', 'A vendor invoice was approved after its match (part 22.06, for the accounts payable 23.03 and the GST reconciliation 23.08): data { invoiceId, invoiceNo, invoiceDate, fy, kind, projectId, vendorId, vendorGstin, poId, serviceEntryId, hireBillId, taxable, tax, total, debit, payable, dueDate, irn, matchStatus, overrideReason, itc[{ hsn, gstPct, taxable, tax }] }.'],
  ['bill.vendor_invoice.resolved', 'An exception of a vendor invoice was resolved by a debit note (part 22.06 FR-03): data { invoiceId, invoiceNo, vendorId, kind, debitNote, ref }.'],
  ['bill.sub.measured', 'A subcontractor measurement was signed and verified (part 22.05 FR-01): data { measurementId, docNo, projectId, woId, woItemId, subcontractorId, qty, measuredBy, signedBy, verifiedBy }.'],
  ['bill.sub.approved', 'A subcontractor bill was approved (part 22.05, for the payables 23.03, the commitments 12.03 and the retention ledger 22.07): data { billId, billNo, seqNo, billType, projectId, woId, subcontractorId, periodFrom, periodTo, gross, cumGross, gst, rcm, tds, retention, securityDeposit, advanceRecovery, deductions, net, dueDate, gstMode }.'],
  ['bill.client.certified', 'The client certified a bill (part 22.04, for the receivables 23.05, the retention and advance ledgers 22.07, revenue 23.10, CVR 22.09 and the e-invoice 23.07): data { certId, certNo, certDate, billId, billNo, projectId, contractId, submittedGross, submittedNet, certifiedGross, escalation, taxable, gst, deductions, certifiedNet, retention, advanceRecovery, differencePct, disputed, dueDate }.'],
  ['bill.invoice.issued', 'A GST tax invoice was issued with its gapless number (part 22.04, for the receivables 23.05 and the e-invoice 23.07): data { invoiceId, invoiceNo, invoiceDate, fy, billId, billNo, certificationId, projectId, contractId, gstinFrom, gstinTo, placeOfSupply, supply, sacCode, taxable, cgst, sgst, igst, total, dueDate, irnRequired }.'],
  ['bill.invoice.irn_recorded', 'The IRN of a tax invoice was recorded (part 22.04): data { invoiceId, invoiceNo, irn, ackNo, ackDate }.'],
  ['bill.invoice.cancelled', 'An issued tax invoice was cancelled before its IRN (part 22.04 BR-01): data { invoiceId, invoiceNo, billId, projectId, total, reason }.'],
  ['bill.client.approved', 'A client bill was approved inside (part 22.03): data { billId, billNo, projectId, contractId, billType, gross, net }.'],
  ['bill.client.submitted', 'A client bill was sent to the client (part 22.03 FR-05, for the certification of 22.04 and the cash forecast of 23.13): data { billId, docNo, billNo, seqNo, billType, projectId, contractId, periodFrom, periodTo, gross, cumGross, escalation, taxable, gst, deductions, net, sentOn, clientRef }.'],
  ['bill.qty.forecast', 'The forecast quantity of a BOQ item was set (part 22.02 FR-01, for the estimate at completion 23.11): data { projectId, boqCode, boqLineId, forecastQty, previous, revisedQty, uom, basis }.'],
  ['bill.deviation.approved', 'A deviation statement was approved inside (part 22.02 FR-02): data { dsId, docNo, dsNo, projectId, period, items, netEffect }.'],
  ['bill.deviation.responded', 'The client answered a deviation statement (part 22.02 FR-02, to the variations of 21.05): data { dsId, dsNo, projectId, decision, outcome, changeRequestId, items[{ boqCode, boqLineId, contractQty, projectedQty, deviationPct }] }.'],
  ['bill.extra_item.decided', 'The client decided an extra or substituted item (part 22.02 FR-03): data { extraItemId, docNo, projectId, kind, decision, qty, uom, changeRequestId }.'],
  ['bill.mb.checked', 'The check measurement of an entry was recorded (part 22.01 FR-04): data { mbId, docNo, projectId, measuredQty, checkedQty, difference, checkedBy, checkPct }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'bill', description });

integrityRegistry.register({
  statuses: { bill_mb_entries: Object.keys(STATUS), bill_deviation_statements: Object.keys(STATUS), bill_client_bills: Object.keys(STATUS), bill_certifications: Object.keys(STATUS), bill_tax_invoices: Object.keys(STATUS), bill_sub_bills: Object.keys(STATUS), bill_vendor_invoices: Object.keys(STATUS), bill_advances: Object.keys(STATUS), bill_releases: Object.keys(STATUS) },
  uniqueKeys: [{ table: 'bill_mb_entries', columns: ['company_id', 'doc_no'] }, { table: 'bill_deviation_statements', columns: ['company_id', 'doc_no'] }, { table: 'bill_extra_items', columns: ['company_id', 'doc_no'] }, { table: 'bill_client_bills', columns: ['company_id', 'doc_no'] }, { table: 'bill_client_bills', columns: ['company_id', 'bill_no'] }, { table: 'bill_certifications', columns: ['company_id', 'doc_no'] }, { table: 'bill_tax_invoices', columns: ['company_id', 'doc_no'] }, { table: 'bill_sub_bills', columns: ['company_id', 'doc_no'] }, { table: 'bill_sub_measurements', columns: ['company_id', 'doc_no'] }, { table: 'bill_vendor_invoices', columns: ['company_id', 'doc_no'] }, { table: 'bill_advances', columns: ['company_id', 'doc_no'] }, { table: 'bill_releases', columns: ['company_id', 'doc_no'] }],
});

export const bill = {
  code: 'bill',
  name: 'Measurement and Billing',
  routePrefix: '/api/v1/bill',
  ownerPart: '22.07',
  status: 'Measurement book (22.01); quantity reconciliation, forecast quantities, deviation statements and the register of extra items (22.02); the client RA bill (22.03); the client certification and the GST tax invoice (22.04); the subcontractor measurement and bills (22.05); vendor invoices, the match and the invoice hub (22.06); the retention, deposit and advance ledgers (22.07).',
  tables: ['bill_mb_entries', 'bill_deviation_statements', 'bill_qty_forecasts', 'bill_extra_items', 'bill_client_bills', 'bill_client_bill_items', 'bill_certifications', 'bill_tax_invoices', 'bill_invoice_counters', 'bill_sub_measurements', 'bill_sub_bills', 'bill_sub_bill_items', 'bill_sub_claims', 'bill_vendor_invoices', 'bill_vendor_invoice_lines', 'bill_retention_ledger', 'bill_advances', 'bill_advance_recoveries', 'bill_releases'],
  resources: ['mb-entries', 'mb-abstract', 'mb-book', 'qty-recon', 'qty-limits', 'qty-forecasts', 'deviation-statements', 'extra-items', 'client-bills', 'certifications', 'tax-invoices', 'cert-analysis', 'sub-measurements', 'sub-bills', 'vendor-invoices', 'invoice-hub', 'retention', 'advances', 'releases'],
  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bill_mb_entries'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment }); const base = createBase({ db });
    const m = createMbService({ db, base, flags }); const rc = createReconService({ db, base }); const dv = createDeviationService({ db, base, recon: rc.recon }); const cb = createClientBillService({ db, base, mb: m.mb }); const ce = createCertService({ db, base }); const iv = createInvoiceService({ db, base }); const sb = createSubService({ db, base, mb: m.mb }); const vi = createVinvService({ db, base }); const hb = createHubService({ db, base }); const lg = createLedgerService({ db, base }); const deciders = { [BILL_DOCS.mb]: m.mb.decide, [BILL_DOCS.deviation]: dv.deviations.decide, [BILL_DOCS.clientBill]: cb.clientBills.decide, [BILL_DOCS.certification]: ce.certifications.decide, [BILL_DOCS.taxInvoice]: iv.taxInvoices.decide, [BILL_DOCS.subBill]: sb.subBills.decide, [BILL_DOCS.vendorInvoice]: vi.vendorInvoices.decide, [BILL_DOCS.advance]: lg.advances.decide, [BILL_DOCS.release]: lg.releases.decide }; const svc = { ...m, ...rc, ...dv, ...cb, ...ce, ...iv, ...sb, ...vi, ...hb, ...lg };
    services.set(db, { svc, base, flags, deciders });
    listExports.register('bill.mb_entries', { source: (actor, req) => { base.need(actor, 'bill.mb_entry.export', 'export measurements'); return m.mb.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('bill.deviation_statements', { source: (actor, req) => { base.need(actor, 'bill.deviation_statement.export', 'export deviation statements'); return dv.deviations.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('bill.extra_items', { source: (actor, req) => { base.need(actor, 'bill.extra_item.export', 'export extra items'); return dv.extras.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('bill.client_bills', { source: (actor, req) => { base.need(actor, 'bill.client_bill.export', 'export client bills'); return cb.clientBills.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('bill.certifications', { source: (actor, req) => { base.need(actor, 'bill.certification.export', 'export certifications'); return ce.certifications.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('bill.tax_invoices', { source: (actor, req) => { base.need(actor, 'bill.tax_invoice.export', 'export tax invoices'); return iv.taxInvoices.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('bill.sub_bills', { source: (actor, req) => { base.need(actor, 'bill.sub_bill.export', 'export subcontractor bills'); return sb.subBills.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('bill.sub_measurements', { source: (actor, req) => { base.need(actor, 'bill.sub_measure.export', 'export measurements'); return sb.subMeasures.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('bill.vendor_invoices', { source: (actor, req) => { base.need(actor, 'bill.vendor_invoice.export', 'export vendor invoices'); return vi.vendorInvoices.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('bill.advances', { source: (actor, req) => { base.need(actor, 'bill.advance.export', 'export advances'); return lg.advances.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('bill.releases', { source: (actor, req) => { base.need(actor, 'bill.release.export', 'export releases'); return lg.releases.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    const runtime = runtimeOf(db);
    runtime?.bus?.subscribe('bill.client.certified', (event) => lg.ledger.onClientCertified(event), { consumer: 'bill.ledger_client' });
    runtime?.bus?.subscribe('bill.sub.approved', (event) => lg.ledger.onSubApproved(event), { consumer: 'bill.ledger_sub' });
    runtime?.jobs?.register('bill.qty_sweep', (jctx) => { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) n += rc.recon.sweep(c.id).told; jctx.log(`${n} quantity limit alert(s)`); return { n }; }, { maxAttempts: 2, description: 'Tells the QS and the project manager of BOQ items beyond, approaching or forecast beyond their quantity.' });
    runtime?.scheduler?.define({ code: 'bill.qty_sweep_morning', cron: '15 3 * * *', jobType: 'bill.qty_sweep', description: 'Every morning 08:45 India time: BOQ items approaching their quantity' });
    api.use('/bill', billRoutes(svc, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags }));
  },
};

const billObject = (table, perm, route, label, codeCol = 'doc_no') => objectTypes.register({
  type: table, label, permission: `${perm}.view`, route: (id) => `${route}${id}`, attachmentEntity: table, approvalTarget: table,
  access(db, actor, id) { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(Number(id), actor.companyId); if (!r || !authzOf(db).check(actor, `${perm}.view`, { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined }).allowed) return null; return { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined }; },
  auditEntities: (id) => [{ entity: table, id }],
  summary(db, actor, id) { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ?`).get(Number(id), actor.companyId); return r ? { label: `${r[codeCol]} ${r.title ?? r.description ?? ''}`.trim().slice(0, 200), status: r.status ?? 'ACTIVE' } : null; },
  related: () => [],
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, `${perm}.view`).allowed) return []; return db.prepare(`SELECT id FROM ${table} WHERE company_id = ? AND deleted_at IS NULL AND ${codeCol} LIKE ? ORDER BY id DESC LIMIT ?`).all(actor.companyId, `%${q}%`, limit).map((x) => x.id); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare(`SELECT id FROM ${table} WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?`).all(companyId, projectId, limit).map((x) => x.id); },
});

billObject('bill_mb_entries', 'bill.mb_entry', '/bill/mb-entries?id=', 'Measurement', 'doc_no');
billObject('bill_deviation_statements', 'bill.deviation_statement', '/bill/deviations?id=', 'Deviation statement', 'ds_no');
billObject('bill_client_bills', 'bill.client_bill', '/bill/client-bills?id=', 'Client bill', 'bill_no');
billObject('bill_certifications', 'bill.certification', '/bill/certifications?id=', 'Certification', 'cert_no');
billObject('bill_tax_invoices', 'bill.tax_invoice', '/bill/tax-invoices?id=', 'Tax invoice', 'doc_no');
billObject('bill_sub_bills', 'bill.sub_bill', '/bill/sub-bills?id=', 'Subcontractor bill', 'bill_no');
billObject('bill_vendor_invoices', 'bill.vendor_invoice', '/bill/vendor-invoices?id=', 'Vendor invoice', 'doc_no');
billObject('bill_advances', 'bill.advance', '/bill/advances?id=', 'Advance', 'doc_no');
billObject('bill_releases', 'bill.release', '/bill/releases?id=', 'Release request', 'doc_no');
billObject('bill_extra_items', 'bill.extra_item', '/bill/deviations?extra=', 'Extra item', 'doc_no');

fileEntities.register({ entity: 'bill_mb_entries', label: 'Measurement (sketch, photographs, drawing marks)', resolve: (db, actor, id) => {
  const r = db.prepare('SELECT * FROM bill_mb_entries WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null; const a = authzOf(db); const scope = { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined }; const at = (k) => a.check(actor, k, scope).allowed; if (!at('bill.mb_entry.view')) return null;
  return { ...scope, canView: true, canEdit: (at('bill.mb_entry.edit') || at('bill.mb_entry.check')) && r.status !== 'APPROVED', locked: r.status === 'APPROVED' };
} });

const approver = (code, name, role, slaHours, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours, requireAttachment: false, checklist: [], when, notify: [], action: null });
const decideHook = (docType) => ({ onApproved: (db, { instance, actor, comment }) => billOf(db)?.deciders[docType](instance, actor, 'APPROVED', comment), onRejected: (db, { instance, actor, comment }) => billOf(db)?.deciders[docType](instance, actor, 'REJECTED', comment), onReturned: (db, { instance, actor, comment }) => billOf(db)?.deciders[docType](instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => billOf(db)?.deciders[docType](instance, actor, 'CANCELLED', comment) });
workflowTypes.register({
  docType: BILL_DOCS.mb, label: 'Measurement certification', processOwner: 'QS', route: (id) => `/bill/mb-entries?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM bill_mb_entries WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.doc_no} ${r.description}`.slice(0, 300), originator: r.requested_by, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM bill_mb_entries WHERE id = ?').get(Number(id)); return r ? { fields: [{ label: 'Entry', value: r.doc_no }, { label: 'Description', value: r.description }, { label: 'Quantity', value: String(r.qty_th / 1000) }, { label: 'Checked', value: r.checked_qty_th == null ? 'No' : String(r.checked_qty_th / 1000) }] } : null; },
  defaultDefinition: { name: 'Measurement: the QS checks, the project manager certifies', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('QS', 'QS (check)', 'QS', 24), approver('PM', 'Project manager (certify)', 'PM', 48)] },
  hooks: decideHook(BILL_DOCS.mb),
});

fileEntities.register({ entity: 'bill_deviation_statements', label: 'Deviation statement (reasons, client letter, calculations)', resolve: (db, actor, id) => {
  const r = db.prepare('SELECT * FROM bill_deviation_statements WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null; const a = authzOf(db); const scope = { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined }; const at = (k) => a.check(actor, k, scope).allowed; if (!at('bill.deviation_statement.view')) return null;
  return { ...scope, canView: true, canEdit: (at('bill.deviation_statement.edit') && ['DRAFT', 'RETURNED'].includes(r.status)) || at('bill.deviation_statement.client'), locked: false };
} });
fileEntities.register({ entity: 'bill_extra_items', label: 'Extra item (instruction, drawings, quotation)', resolve: (db, actor, id) => {
  const r = db.prepare('SELECT * FROM bill_extra_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null; const a = authzOf(db); const scope = { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined }; const at = (k) => a.check(actor, k, scope).allowed; if (!at('bill.extra_item.view')) return null;
  return { ...scope, canView: true, canEdit: at('bill.extra_item.edit') && r.decision_state === 'PENDING', locked: r.decision_state !== 'PENDING' };
} });

workflowTypes.register({
  docType: BILL_DOCS.deviation, label: 'Deviation statement', processOwner: 'QS', route: (id) => `/bill/deviations?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM bill_deviation_statements WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.ds_no, title: `Deviation statement ${r.ds_no} (${r.period}), ${r.item_count} item(s)`.slice(0, 300), originator: r.requested_by, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM bill_deviation_statements WHERE id = ?').get(Number(id)); return r ? { fields: [{ label: 'Statement', value: r.ds_no }, { label: 'Period', value: r.period }, { label: 'Items', value: `${r.item_count} (${r.over_count} over, ${r.under_count} under)` }, { label: 'Net effect (INR)', value: String(r.net_effect_paise / 100) }] } : null; },
  defaultDefinition: { name: 'Deviation statement: the QS prepares, the commercial manager and the project manager approve', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('COMMGR', 'Commercial manager', 'COMMGR', 48), approver('PM', 'Project manager', 'PM', 48)] },
  hooks: decideHook(BILL_DOCS.deviation),
});

fileEntities.register({ entity: 'bill_client_bills', label: 'Client bill (test reports, photographs, supporting documents)', resolve: (db, actor, id) => {
  const r = db.prepare('SELECT * FROM bill_client_bills WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null; const a = authzOf(db); const scope = { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined }; const at = (k) => a.check(actor, k, scope).allowed; if (!at('bill.client_bill.view')) return null;
  return { ...scope, canView: true, canEdit: (at('bill.client_bill.edit') && ['DRAFT', 'RETURNED'].includes(r.status)) || at('bill.client_bill.send'), locked: false };
} });

workflowTypes.register({
  docType: BILL_DOCS.clientBill, label: 'Client RA bill', processOwner: 'QS', route: (id) => `/bill/client-bills?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM bill_client_bills WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.bill_no, title: `Client bill ${r.bill_no} (${r.period_from} to ${r.period_to})`.slice(0, 300), originator: r.requested_by, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM bill_client_bills WHERE id = ?').get(Number(id)); return r ? { fields: [{ label: 'Bill', value: r.bill_no }, { label: 'Period', value: `${r.period_from} to ${r.period_to}` }, { label: 'Value of work (INR)', value: String(r.gross_paise / 100) }, { label: 'GST (INR)', value: String(r.gst_paise / 100) }, { label: 'Deductions (INR)', value: String(r.deductions_paise / 100) }, { label: 'Net payable (INR)', value: String(r.net_paise / 100) }] } : null; },
  defaultDefinition: { name: 'Client bill: the QS checks, the project manager and the commercial manager approve', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('QS', 'QS (check)', 'QS', 24), approver('PM', 'Project manager', 'PM', 48), approver('COMMGR', 'Commercial manager', 'COMMGR', 48)] },
  hooks: decideHook(BILL_DOCS.clientBill),
});

for (const [entity, perm, label, table] of [['bill_advances', 'bill.advance', 'Advance (agreement, guarantee, receipt)', 'bill_advances'], ['bill_releases', 'bill.release', 'Release request (completion certificate, no-defects note, guarantee)', 'bill_releases'], ['bill_vendor_invoices', 'bill.vendor_invoice', 'Vendor invoice (invoice copy, e-way bill, test certificates)', 'bill_vendor_invoices'], ['bill_sub_bills', 'bill.sub_bill', 'Subcontractor bill (test reports, photographs, supporting documents)', 'bill_sub_bills'], ['bill_certifications', 'bill.certification', 'Certification (certificate, correspondence, joint measurement)', 'bill_certifications'], ['bill_tax_invoices', 'bill.tax_invoice', 'Tax invoice (supporting documents)', 'bill_tax_invoices']]) {
  fileEntities.register({ entity, label, resolve: (db, actor, id) => {
    const r = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(Number(id), actor.companyId); if (!r) return null; const a = authzOf(db); const scope = { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined }; const at = (k) => a.check(actor, k, scope).allowed; if (!at(`${perm}.view`)) return null;
    return { ...scope, canView: true, canEdit: at(`${perm}.edit`) && ['DRAFT', 'RETURNED'].includes(r.status), locked: r.status === 'APPROVED' };
  } });
}

workflowTypes.register({
  docType: BILL_DOCS.certification, label: 'Client certification', processOwner: 'QS', route: (id) => `/bill/certifications?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM bill_certifications WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.cert_no, title: `Certification ${r.cert_no} of bill ${r.bill_id}`.slice(0, 300), originator: r.requested_by, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM bill_certifications WHERE id = ?').get(Number(id)); return r ? { fields: [{ label: 'Certificate', value: r.cert_no }, { label: 'Submitted (INR)', value: String(r.submitted_gross_paise / 100) }, { label: 'Certified (INR)', value: String(r.certified_gross_paise / 100) }, { label: 'Difference', value: `${r.diff_pct_bp / 100}%` }, { label: 'Certified net (INR)', value: String(r.certified_net_paise / 100) }] } : null; },
  defaultDefinition: { name: 'Certification: the QS checks; the commercial manager as well when the difference is beyond the allowance', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('QS', 'QS (check)', 'QS', 24), approver('COMMGR', 'Commercial manager (difference beyond the allowance)', 'COMMGR', 48, { field: 'bigDiff', op: 'eq', value: 1 })] },
  hooks: decideHook(BILL_DOCS.certification),
});
workflowTypes.register({
  docType: BILL_DOCS.taxInvoice, label: 'Tax invoice', processOwner: 'ACCMGR', route: (id) => `/bill/tax-invoices?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM bill_tax_invoices WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `Tax invoice ${r.doc_no} for bill ${r.bill_id}`.slice(0, 300), originator: r.requested_by, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM bill_tax_invoices WHERE id = ?').get(Number(id)); return r ? { fields: [{ label: 'Supplier GSTIN', value: r.gstin_from }, { label: 'Recipient GSTIN', value: r.gstin_to }, { label: 'Taxable value (INR)', value: String(r.taxable_paise / 100) }, { label: 'Invoice value (INR)', value: String(r.total_paise / 100) }] } : null; },
  defaultDefinition: { name: 'Tax invoice: the billing engineer prepares, the accounts manager issues', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('ACCMGR', 'Accounts manager', 'ACCMGR', 24)] },
  hooks: decideHook(BILL_DOCS.taxInvoice),
});

workflowTypes.register({
  docType: BILL_DOCS.subBill, label: 'Subcontractor bill', processOwner: 'QS', route: (id) => `/bill/sub-bills?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM bill_sub_bills WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.bill_no, title: `Subcontractor bill ${r.bill_no} (${r.period_from} to ${r.period_to})`.slice(0, 300), originator: r.requested_by, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM bill_sub_bills WHERE id = ?').get(Number(id)); return r ? { fields: [{ label: 'Bill', value: r.bill_no }, { label: 'Value of work (INR)', value: String(r.gross_paise / 100) }, { label: 'Deductions (INR)', value: String(r.deductions_paise / 100) }, { label: 'Net payable (INR)', value: String(r.net_paise / 100) }, { label: 'Compliance', value: r.compliance_ok === 1 ? 'OK' : 'On hold' }] } : null; },
  defaultDefinition: { name: 'Subcontractor bill: the site engineer verifies, the QS checks, the project manager, the commercial manager above 10 lakh and the CFO above 50 lakh approve', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('SE', 'Site engineer (verify)', 'SE', 24), approver('QS', 'QS (check)', 'QS', 24), approver('PM', 'Project manager', 'PM', 48), approver('COMMGR', 'Commercial manager (above 10 lakh)', 'COMMGR', 48, { field: 'overPm', op: 'eq', value: 1 }), approver('CFO', 'CFO (above 50 lakh)', 'CFO', 72, { field: 'overCommgr', op: 'eq', value: 1 })] },
  hooks: decideHook(BILL_DOCS.subBill),
});

workflowTypes.register({
  docType: BILL_DOCS.vendorInvoice, label: 'Vendor invoice', processOwner: 'ACCMGR', route: (id) => `/bill/vendor-invoices?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM bill_vendor_invoices WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.invoice_no, title: `Vendor invoice ${r.invoice_no} (${r.doc_no})`.slice(0, 300), originator: r.requested_by, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM bill_vendor_invoices WHERE id = ?').get(Number(id)); return r ? { fields: [{ label: 'Invoice', value: r.invoice_no }, { label: 'Total (INR)', value: String(r.total_paise / 100) }, { label: 'Payable (INR)', value: String(r.payable_paise / 100) }, { label: 'Match', value: r.match_status }, { label: 'Variance (INR)', value: String(r.variance_paise / 100) }, { label: 'Override reason', value: r.override_reason ?? '' }] } : null; },
  defaultDefinition: { name: 'Vendor invoice: the accounts manager approves; the procurement manager when a price is in exception; the CFO above the variance threshold', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('ACCMGR', 'Accounts manager', 'ACCMGR', 24), approver('PROCMGR', 'Procurement manager (price exception)', 'PROCMGR', 48, { field: 'priceExc', op: 'eq', value: 1 }), approver('CFO', 'CFO (variance above the threshold)', 'CFO', 72, { field: 'overThreshold', op: 'eq', value: 1 })] },
  hooks: decideHook(BILL_DOCS.vendorInvoice),
});

const apr = (code, name, role, slaHours, when = null) => approver(code, name, role, slaHours, when);
workflowTypes.register({
  docType: BILL_DOCS.advance, label: 'Advance', processOwner: 'COMMGR', route: (id) => `/bill/advances?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM bill_advances WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.ref_no, title: `Advance ${r.ref_no} (${r.direction === 'GIVEN' ? 'given' : 'received'})`.slice(0, 300), originator: r.requested_by, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM bill_advances WHERE id = ?').get(Number(id)); return r ? { fields: [{ label: 'Reference', value: r.ref_no }, { label: 'Direction', value: r.direction }, { label: 'Amount (INR)', value: String(r.amount_paise / 100) }, { label: 'Recovery', value: r.rule_mode === 'FIXED' ? `${r.rule_fixed_paise / 100} per bill` : `${r.rule_pct_bp / 100}% of each bill` }] } : null; },
  defaultDefinition: { name: 'Advance: the project manager for an advance given, the commercial manager, the CFO, the direction above 25 lakh', settings: { resubmit: 'first', distinctApprovers: true }, steps: [apr('PM', 'Project manager (advance given)', 'PM', 48, { field: 'given', op: 'eq', value: 1 }), apr('COMMGR', 'Commercial manager', 'COMMGR', 48), apr('CFO', 'CFO', 'CFO', 72), apr('DIR', 'Direction (above 25 lakh)', 'DIR', 72, { field: 'overDir', op: 'eq', value: 1 })] },
  hooks: decideHook(BILL_DOCS.advance),
});
workflowTypes.register({
  docType: BILL_DOCS.release, label: 'Retention or deposit release', processOwner: 'COMMGR', route: (id) => `/bill/releases?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM bill_releases WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.release_type === 'SD' ? 'Security deposit' : 'Retention'} release ${r.doc_no}`.slice(0, 300), originator: r.requested_by, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM bill_releases WHERE id = ?').get(Number(id)); return r ? { fields: [{ label: 'Release', value: r.doc_no }, { label: 'Party', value: r.party_type }, { label: 'Basis', value: r.release_basis }, { label: 'Amount (INR)', value: String(r.amount_paise / 100) }, { label: 'Balance before (INR)', value: String(r.balance_before_paise / 100) }, { label: 'Released regardless', value: r.waiver_reason ?? '' }] } : null; },
  defaultDefinition: { name: 'Release: the commercial manager, the project manager and the CFO', settings: { resubmit: 'first', distinctApprovers: true }, steps: [apr('COMMGR', 'Commercial manager', 'COMMGR', 48), apr('PM', 'Project manager', 'PM', 48), apr('CFO', 'CFO', 'CFO', 72)] },
  hooks: decideHook(BILL_DOCS.release),
});
