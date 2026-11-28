import { createHash, randomBytes } from 'node:crypto';
import { transaction } from '../../platform/db/index.js';
import { taxEngineOf } from '../../platform/tax/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { HttpError, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { toPdf } from '../../platform/export/index.js';
import { commOf } from '../../platform/comm/index.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { controlRegistry, protocolOf } from '../../platform/protocol/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { budOf } from '../bud/budgets.js';
import { isEnabled } from '../core/feature-flags/service.js';
import { d3, json, nowIso, q3, rid, rs, same } from './base.js';
import { rateBenchmarks } from './pr.js';

// Purchase orders (part 15.05). An order is made from an approved comparative statement (the rates are the quoted ones) or directly with a reason; it carries its terms, lines (GST split by the place of supply, BR-03) and a delivery schedule, and is
// approved by value (procurement manager, project manager above ₹ 5 lakh, project director above ₹ 25 lakh, the direction above ₹ 1 crore). On approval the commitment is posted to the budget ledger (12.03), the order is sent to the vendor with a link to
// acknowledge it and to tell the dispatch, and the requisition balance falls. An amendment is a new version with the before and after, approved by the size of the change; short-close releases what is not delivered, cancel is refused once anything is received
// (BR-02). Goods received arrive through `receipts/ingest` until the stock module (16.x) posts them; they drive the delivery status, the overdue alerts and the vendor performance.
export const PO_DOC = 'PROC_PO'; export const AMEND_DOC = 'PROC_PO_AMEND'; export const CLOSE_DOC = 'PROC_PO_CLOSE'; export const ADV_DOC = 'PROC_PO_ADVANCE';
export const PO_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', RETURNED: 'Returned for correction', APPROVED: 'Approved and sent', REJECTED: 'Rejected', CLOSED: 'Closed', CANCELLED: 'Cancelled' };
export const AMEND_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', RETURNED: 'Returned for correction', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
export const BASES = { EX_WORKS: 'Ex-works', FOR_SITE: 'FOR site', FOR_DESTINATION: 'FOR destination' };
const EDITABLE = ['DRAFT', 'RETURNED'];

controlRegistry.define({
  code: 'CP-PROC-05', module: 'proc', stage: 'VERIFY', description: 'A purchase order rate above the rate approved in the comparative statement needs an approved exception', enforcement: 'EXCEPTION', evidenceRequired: true, escalationLevel: 1, ownerRole: 'PROCMGR', mode: 'ENFORCE',
  evaluate: ({ context }) => ({ pass: false, message: context.message ?? 'Rate above the approved rate', details: { ref: context.ref ?? null, items: context.items ?? null } }),
});
for (const [key, dataType, def, description, extra] of [
  ['proc.po.band_pm_minor', 'integer', 50_000_000, 'Section 9: an order above this value, in paise (₹ 5 lakh), is also approved by the project manager.', { min: 0, max: 100_000_000_000 }],
  ['proc.po.band_pd_minor', 'integer', 250_000_000, 'Section 9: an order above this value, in paise (₹ 25 lakh), is also approved by the project director.', { min: 0, max: 100_000_000_000 }],
  ['proc.po.band_dir_minor', 'integer', 1_000_000_000, 'Section 9: an order above this value, in paise (₹ 1 crore), is also approved by the direction.', { min: 0, max: 100_000_000_000 }],
  ['proc.po.qty_tolerance_pct', 'integer', 5, 'BR-01: percent of the requisition line quantity an order may exceed the balance to order by.', { min: 0, max: 50 }],
  ['proc.po.variance_pct', 'integer', 10, 'BR-01: an order rate this many percent above the benchmark (the last purchase rate) needs the project manager.', { min: 0, max: 100 }],
  ['proc.po.ack_days', 'integer', 180, 'FR-04: the days the vendor link works (to acknowledge the order and tell the dispatch).', { min: 1, max: 730 }],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });

/** BR-03: CGST and SGST when the vendor and the place of supply are in the same state, IGST when they are not; NONE for a vendor with no GSTIN. */
export const supplyOf = (vendorState, deliveryState) => (!vendorState || !deliveryState ? 'NONE' : String(vendorState) === String(deliveryState) ? 'INTRA' : 'INTER');
/** One line: quantity in thousandths, rate in paise, percentages x10000. The GST is on the basic amount; intra-state it is halved to CGST and SGST (equal, so the pair always balances). */
export function computeLine({ qty, rate, discountPct = 0, gstPct = 0, supply = 'INTRA', freight = 0 }) {
  const basic = Math.round((qty * rate * (1 - discountPct / 1_000_000)) / 1000); const full = (basic * gstPct) / 1_000_000; let cgst = 0; let sgst = 0; let igst = 0;
  if (supply === 'INTRA') { cgst = Math.round(full / 2); sgst = cgst; } else if (supply === 'INTER') igst = Math.round(full);
  const tax = cgst + sgst + igst; return { basic, freight, cgst, sgst, igst, tax, line: basic + freight + tax };
}

const dl = (sql) => sql;
export const poList = defineList({
  code: 'proc.purchase_orders', label: 'Purchase orders', permission: 'proc.purchase_order.view', from: 'proc_purchase_orders x JOIN org_projects p ON p.id = x.org_project_id JOIN mdm_partners v ON v.id = x.vendor_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'v.legal_name', 'v.trade_name', 'p.code'], defaultSort: '-date',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Order' }, date: { sql: 'x.doc_date', type: 'date', label: 'Date' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, vendor: { sql: 'COALESCE(v.trade_name, v.legal_name)', type: 'text', label: 'Vendor' },
    amount: { sql: 'x.total_amount', type: 'text', label: 'Value', sortable: false }, amendment: { sql: 'x.amendment_no', type: 'number', label: 'Amendment' },
    delivery: { sql: dl("CASE WHEN x.status NOT IN ('APPROVED', 'CLOSED') THEN '' WHEN (SELECT COALESCE(SUM(l.received_qty), 0) FROM proc_po_lines l WHERE l.po_id = x.id AND l.deleted_at IS NULL) = 0 THEN 'NOT_DELIVERED' WHEN (SELECT COALESCE(SUM(l.balance_qty), 0) FROM proc_po_lines l WHERE l.po_id = x.id AND l.deleted_at IS NULL) = 0 THEN 'DELIVERED' ELSE 'PARTIAL' END"), type: 'enum', label: 'Delivery', options: [['NOT_DELIVERED', 'Not delivered'], ['PARTIAL', 'Partly delivered'], ['DELIVERED', 'Delivered']] },
    status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(PO_STATUS) },
  },
});

export function createPoService({ db, base, baseUrl = () => '', rc = null }) {
  const { authz, param, may, need, fail, audit, notify, number, itemOf } = base;
  const sysActor = (companyId, user = 'system') => ({ user, companyId, roles: ['SYSTEM'] });
  const rcOf = (r) => (r ? db.prepare('SELECT rc_id FROM proc_po_rc WHERE po_id = ?').get(r.id)?.rc_id ?? null : null);
  const lineRc = (lineId) => db.prepare('SELECT rc_line_id FROM proc_po_line_rc WHERE po_line_id = ?').get(lineId)?.rc_line_id ?? null;
  const rcTouch = (r) => { const id = rcOf(r); if (id) rc?.recalc(id); };
  const evt = (type, actor, r, data) => publishEvent(db, { type, entity: 'proc_purchase_order', entityId: r.id, actorId: actor?.user ?? 'system', companyId: r.company_id, projectId: r.org_project_id, siteId: r.po_site_id ?? undefined, data: { poId: r.id, docNo: r.doc_no, projectId: r.org_project_id, vendorId: r.vendor_id, ...data } });
  const vname = (id) => { const v = db.prepare('SELECT code, trade_name, legal_name FROM mdm_partners WHERE id = ?').get(id); return v ? { code: v.code, name: v.trade_name ?? v.legal_name } : { code: '', name: '' }; };
  const hash = (t) => createHash('sha256').update(t).digest('hex'); const gone = (m) => new HttpError(410, 'LINK_EXPIRED', m);
  const linesOf = (id) => db.prepare('SELECT * FROM proc_po_lines WHERE po_id = ? AND deleted_at IS NULL ORDER BY line_no').all(id);
  const schedOf = (lineId) => db.prepare('SELECT * FROM proc_po_schedules WHERE po_line_id = ? AND deleted_at IS NULL ORDER BY due_date, id').all(lineId);
  const row = (actor, id, key = 'proc.purchase_order.view') => {
    const r = db.prepare('SELECT * FROM proc_purchase_orders WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r || !may(actor, 'proc.purchase_order.view', r.org_project_id, r.po_site_id)) throw notFound('That purchase order does not exist.'); if (key !== 'proc.purchase_order.view') need(actor, key, 'do that with a purchase order', r.org_project_id, r.po_site_id); return r;
  };
  const scope = (actor) => { const f = authz.scopeFilter(actor, 'proc.purchase_order.view', { project: 'x.org_project_id', site: 'x.po_site_id' }); return { sql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  const levelOf = (cid, amount) => { const pm = Number(param(cid, 'proc.po.band_pm_minor') ?? 50_000_000); const pd = Number(param(cid, 'proc.po.band_pd_minor') ?? 250_000_000); const dir = Number(param(cid, 'proc.po.band_dir_minor') ?? 1_000_000_000); return amount > dir ? 3 : amount > pd ? 2 : amount > pm ? 1 : 0; };
  const link = (token) => `${String(baseUrl() ?? '').replace(/\/$/, '')}/vendor-po?token=${token}`;
  // the rate of a GST code on the order date: the tax engine of 23.07 (the dated masters of 06.02, the company's own row first); before it is mounted, the master directly
  const gstOf = (companyId, code, date) => { if (!code) return null; const te = taxEngineOf(db); if (te) { try { return te.rateOn(companyId, { code }, date).igst; } catch { return null; } } const g = db.prepare("SELECT igst_pct FROM mdm_gst_rates WHERE code = ? AND (company_id = ? OR company_id IS NULL) AND row_status = 'ACTIVE' AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) AND deleted_at IS NULL ORDER BY effective_from DESC LIMIT 1").get(code, companyId, date, date); return g ? g.igst_pct : null; };
  const vendorGstin = (companyId, vendorId, gstinId = null) => (gstinId ? db.prepare("SELECT * FROM mdm_partner_gstins WHERE id = ? AND partner_id = ? AND gstin_status = 'ACTIVE' AND deleted_at IS NULL").get(gstinId, vendorId) : db.prepare("SELECT * FROM mdm_partner_gstins WHERE partner_id = ? AND gstin_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY id LIMIT 1").get(vendorId)) ?? null;

  // ---- the view -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  function deliveryOf(r, ls) {
    if (!['APPROVED', 'CLOSED'].includes(r.status)) return { status: null, overdue: false }; const got = ls.reduce((n, l) => n + l.received_qty, 0); const bal = ls.reduce((n, l) => n + l.balance_qty, 0);
    const overdue = r.status === 'APPROVED' && ls.some((l) => schedOf(l.id).some((s) => s.due_date < todayIST() && s.received_qty < s.qty) && l.balance_qty > 0);
    return { status: got === 0 ? 'NOT_DELIVERED' : bal === 0 ? 'DELIVERED' : 'PARTIAL', overdue };
  }
  const view = (actor, r, { detail = false } = {}) => {
    const p = db.prepare('SELECT code, name FROM org_projects WHERE id = ?').get(r.org_project_id); const can = (k) => may(actor, k, r.org_project_id, r.po_site_id); const own = same(r.requested_by, actor.user); const rates = can('proc.purchase_order.rates'); const m = (n) => (rates ? rs(n) : null);
    const ls = linesOf(r.id); const dv = deliveryOf(r, ls); const cs = r.cs_id ? db.prepare('SELECT doc_no FROM proc_comparative_statements WHERE id = ?').get(r.cs_id) : null; const openAm = db.prepare("SELECT id, kind, status FROM proc_po_amendments WHERE po_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(r.id);
    const o = { id: r.id, docNo: r.doc_no, date: r.doc_date, projectId: r.org_project_id, projectCode: p?.code, projectName: p?.name, siteId: r.po_site_id, vendorId: r.vendor_id, vendorCode: vname(r.vendor_id).code, vendor: vname(r.vendor_id).name, source: rcOf(r) ? 'RATE_CONTRACT' : r.po_source, rcId: rcOf(r), rcNo: rcOf(r) ? db.prepare('SELECT doc_no FROM proc_rate_contracts WHERE id = ?').get(rcOf(r))?.doc_no : null, csId: r.cs_id, csNo: cs?.doc_no ?? null, directReason: r.direct_reason, isEmergency: Boolean(r.is_emergency),
      terms: { deliveryAddress: r.delivery_address, deliveryStateCode: r.delivery_state, vendorStateCode: r.vendor_state, vendorGstin: r.vendor_gstin, supplyType: r.supply_type, paymentTerms: r.payment_terms, advancePct: r.advance_pct / 10000, creditDays: r.credit_days, milestoneTerms: r.milestone_terms, priceBasis: r.delivery_basis, priceBasisLabel: BASES[r.delivery_basis], freightTerms: r.freight_terms, insuranceTerms: r.insurance_terms, warrantyTerms: r.warranty_terms, ldTerms: r.ld_terms, ldPctPerWeek: r.ld_pct_per_week / 10000, ldCapPct: r.ld_cap_pct / 10000, tcText: r.tc_text, documentsRequired: r.documents_required, approvedMakes: r.approved_makes },
      totalBasic: m(r.total_basic), totalFreight: m(r.total_freight), totalTax: m(r.total_tax), totalAmount: m(r.total_amount), canSeeRates: rates, varianceFlag: Boolean(r.variance_flag), approvalLevel: levelOf(r.company_id, r.total_amount), status: r.status, statusLabel: PO_STATUS[r.status], amendmentNo: r.amendment_no, requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at,
      sentAt: r.sent_at, sentStatus: r.sent_status, sentNote: r.sent_note, acknowledgedAt: r.acknowledged_at, acknowledgedBy: r.acknowledged_by, closeReason: r.close_reason, cancelReason: r.cancel_reason, deliveryStatus: dv.status, overdue: dv.overdue, workflowInstanceId: r.workflow_instance_id, openAmendment: openAm ?? null, rowVersion: r.version,
      can: { edit: can('proc.purchase_order.edit') && EDITABLE.includes(r.status), submit: can('proc.purchase_order.submit') && EDITABLE.includes(r.status), withdraw: r.status === 'SUBMITTED' && own, delete: can('proc.purchase_order.delete') && r.status === 'DRAFT' && !r.workflow_instance_id, approve: can('proc.purchase_order.approve') && r.status === 'SUBMITTED' && !own,
        amend: can('proc.purchase_order.amend') && r.status === 'APPROVED' && !openAm, cancel: can('proc.purchase_order.cancel') && r.status === 'APPROVED' && !openAm && ls.every((l) => l.received_qty === 0), shortClose: can('proc.purchase_order.cancel') && r.status === 'APPROVED' && !openAm && ls.some((l) => l.balance_qty > 0),
        resend: can('proc.purchase_order.release') && r.status === 'APPROVED', dispatch: can('proc.purchase_order.dispatch') && r.status === 'APPROVED', advance: can('proc.purchase_order.advance') && r.status === 'APPROVED' && r.advance_pct > 0, print: can('proc.purchase_order.print') } };
    if (detail) {
      o.lines = ls.map((l) => { const it = l.item_id ? itemOf(r.company_id, l.item_id) : null; const pr = l.pr_line_id ? db.prepare('SELECT l.line_no, r.doc_no, r.id AS pr_id FROM proc_pr_lines l JOIN proc_requisitions r ON r.id = l.pr_id WHERE l.id = ?').get(l.pr_line_id) : null;
        return { id: l.id, lineNo: l.line_no, itemId: l.item_id, itemCode: it?.code ?? null, description: l.description, qty: d3(l.qty), uom: l.uom, rate: m(l.rate), discountPct: l.discount_pct / 10000, taxCode: l.tax_code, gstPct: l.gst_pct / 10000, basic: m(l.basic_amount), freight: m(l.freight_amount), cgst: m(l.cgst_amount), sgst: m(l.sgst_amount), igst: m(l.igst_amount), tax: m(l.tax_amount), amount: m(l.line_amount), csRate: m(l.cs_rate ?? 0), benchmarkRate: m(l.benchmark_rate ?? 0), rateAboveCs: rates && l.cs_rate != null && l.rate > l.cs_rate,
          wbsId: l.wbs_id, costCodeId: l.cost_code_id, deliverySiteId: l.delivery_site_id, prLineId: l.pr_line_id, prId: pr?.pr_id ?? null, prNo: pr?.doc_no ?? null, prLineNo: pr?.line_no ?? null, receivedQty: d3(l.received_qty), acceptedQty: d3(l.accepted_qty), invoicedQty: d3(l.invoiced_qty), shortClosedQty: d3(l.short_closed_qty), balanceQty: d3(l.balance_qty),
          schedule: schedOf(l.id).map((s) => ({ id: s.id, dueDate: s.due_date, qty: d3(s.qty), receivedQty: d3(s.received_qty), overdue: s.due_date < todayIST() && s.received_qty < s.qty && r.status === 'APPROVED' })) }; });
      o.amendments = db.prepare('SELECT * FROM proc_po_amendments WHERE po_id = ? AND deleted_at IS NULL ORDER BY id').all(r.id).map((a) => amendView(actor, a));
      o.dispatches = db.prepare(`SELECT d.*, i.file_id AS invoice_file_id FROM proc_dispatches d
        LEFT JOIN ptl_asn_invoices i ON i.dispatch_id = d.id
        WHERE d.po_id = ? AND d.deleted_at IS NULL ORDER BY d.id`).all(r.id).map((x) => ({ id: x.id, asnNo: x.asn_no, vendorInvoiceNo: x.vendor_invoice_no, lrNo: x.lr_no, vehicleNo: x.vehicle_no, ewayBillNo: x.eway_bill_no, dispatchDate: x.dispatch_date, expectedArrival: x.expected_arrival, enteredVia: x.entered_via, status: x.status, lines: json(x.lines_json, []), ...(x.invoice_file_id ? { invoiceFileId: x.invoice_file_id } : {}) }));
      o.receipts = db.prepare('SELECT t.*, l.line_no FROM proc_po_receipts t JOIN proc_po_lines l ON l.id = t.po_line_id WHERE t.po_id = ? AND t.deleted_at IS NULL ORDER BY t.received_on, t.id').all(r.id).map((x) => ({ id: x.id, grnRef: x.grn_ref, lineNo: x.line_no, receivedOn: x.received_on, qty: d3(x.qty), acceptedQty: d3(x.accepted_qty), onTime: Boolean(x.on_time) }));
      o.advances = db.prepare('SELECT * FROM proc_po_advances WHERE po_id = ? AND deleted_at IS NULL ORDER BY id').all(r.id).map((a) => ({ id: a.id, docNo: a.doc_no, amount: m(a.advance_amount), neededBy: a.needed_by, reason: a.reason, status: a.status, requestedBy: a.requested_by, approvedBy: a.approved_by }));
      o.warnings = []; if (r.supply_type === 'NONE') o.warnings.push({ code: 'NO_GSTIN', message: 'The vendor has no active GSTIN: no GST is charged on this order.' }); if (r.variance_flag) o.warnings.push({ code: 'VARIANCE', message: 'A rate is above the benchmark: the project manager approves this order.' });
    }
    return o;
  };
  const amendView = (actor, a) => { const po = db.prepare('SELECT org_project_id, po_site_id FROM proc_purchase_orders WHERE id = ?').get(a.po_id); const rt = may(actor, 'proc.purchase_order.rates', po?.org_project_id, po?.po_site_id);
    const own = same(a.requested_by, actor.user); return { id: a.id, kind: a.kind, amendmentNo: a.amendment_no, reason: a.reason, status: a.status, statusLabel: AMEND_STATUS[a.status], deltaAmount: rt ? rs(a.delta_amount) : null, newTotal: rt ? rs(a.new_total) : null, rateIncrease: Boolean(a.rate_increase), requestedBy: a.requested_by, approvedBy: a.approved_by, workflowInstanceId: a.workflow_instance_id, own, canSeeRates: rt, changes: rt ? json(a.changes_json, []) : json(a.changes_json, []).map((c) => ({ ...c, before: c.field.includes('rate') || c.field.includes('amount') ? null : c.before, after: c.field.includes('rate') || c.field.includes('amount') ? null : c.after })), rowVersion: a.version }; };

  // ---- the lines: rates from the statement or direct, GST by the place of supply (BR-03), quantities within the requisition balance (BR-01) -------------------------------------------------------------------------
  function csAvailable(csLineId, exceptPoId = 0) { const c = db.prepare('SELECT selected_qty FROM proc_cs_lines WHERE id = ?').get(csLineId); const used = db.prepare("SELECT COALESCE(SUM(l.qty), 0) AS n FROM proc_po_lines l JOIN proc_purchase_orders p ON p.id = l.po_id WHERE l.cs_line_id = ? AND l.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status NOT IN ('CANCELLED', 'REJECTED') AND p.id <> ?").get(csLineId, exceptPoId).n; return (c?.selected_qty ?? 0) - used; }
  function csLines(cs, vendorId) {
    return db.prepare('SELECT c.*, l.item_id, l.service_desc, l.uom, l.pr_line_id, l.delivery_site_id, l.required_by, l.spec, q.gst_inclusive, ql.rate AS qrate, ql.discount_pct, ql.gst_rate, ql.freight, ql.loading, ql.other_charges, ql.offered_qty AS qoffered, pl.wbs_id, pl.cost_code_id FROM proc_cs_lines c JOIN proc_rfq_lines l ON l.id = c.rfq_line_id JOIN proc_quotation_lines ql ON ql.id = c.quotation_line_id JOIN proc_quotations q ON q.id = c.quotation_id LEFT JOIN proc_pr_lines pl ON pl.id = l.pr_line_id WHERE c.cs_id = ? AND c.vendor_id = ? AND c.selected_qty > 0 AND c.deleted_at IS NULL ORDER BY l.line_no').all(cs.id, vendorId);
  }
  /** Builds the calculated lines from the body. A statement line brings its quoted rate, discount, GST and charges; a direct line brings what the buyer typed. */
  function buildLines(actor, ctx, inputs) {
    const problems = []; const out = []; const tol = Number(param(actor.companyId, 'proc.po.qty_tolerance_pct') ?? 5); const vpct = Number(param(actor.companyId, 'proc.po.variance_pct') ?? 10); let variance = false; const takenHere = new Map(); // requisition quantity taken by the earlier lines of this order
    inputs.forEach((x, i) => {
      let item = x.itemId ? itemOf(actor.companyId, x.itemId) : null; if (x.itemId && !item) problems.push({ field: `lines.${i}.itemId`, message: 'Not an item of this company' });
      const rl = x.rcLineId ? ctx.rc?.lines.find((c) => c.id === x.rcLineId) : null; if (x.rcLineId && !rl) problems.push({ field: `lines.${i}.rcLineId`, message: 'Not a line of this rate contract' }); if (rl && !x.itemId && rl.item_id) item = itemOf(actor.companyId, rl.item_id);
      const cl = x.csLineId ? ctx.cs?.lines.find((c) => c.id === x.csLineId) : null; if (x.csLineId && !cl) problems.push({ field: `lines.${i}.csLineId`, message: 'Not a selected line of this vendor in the statement' });
      if (cl && !item && cl.item_id) item = itemOf(actor.companyId, cl.item_id);
      const qty = q3(x.qty); const uom = rl?.uom ?? x.uom ?? cl?.uom ?? item?.base_uom; const prLineId = x.prLineId ?? cl?.pr_line_id ?? null; const pl = prLineId ? db.prepare('SELECT l.*, r.org_project_id, r.status AS pr_status FROM proc_pr_lines l JOIN proc_requisitions r ON r.id = l.pr_id WHERE l.id = ? AND r.company_id = ? AND l.deleted_at IS NULL').get(prLineId, actor.companyId) : null;
      if (prLineId && (!pl || pl.org_project_id !== ctx.projectId)) problems.push({ field: `lines.${i}.prLineId`, message: 'Not a requisition line of this project' });
      else if (pl && pl.pr_status !== 'APPROVED') problems.push({ field: `lines.${i}.prLineId`, message: 'The requisition is not approved' });
      else if (pl) { const others = db.prepare("SELECT COALESCE(SUM(l.qty), 0) AS n FROM proc_po_lines l JOIN proc_purchase_orders p ON p.id = l.po_id WHERE l.pr_line_id = ? AND l.deleted_at IS NULL AND p.status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND p.id <> ?").get(prLineId, ctx.poId ?? 0).n; const allowed = pl.balance_qty + Math.round((pl.qty * tol) / 100);
        // other open orders on the line (draft, submitted, returned) and earlier lines of this one hold part of the balance
        const held = others + (takenHere.get(prLineId) ?? 0); takenHere.set(prLineId, (takenHere.get(prLineId) ?? 0) + qty);
        if (qty + held > allowed) problems.push({ field: `lines.${i}.qty`, message: held ? `More than the balance to order of the requisition line (${d3(pl.balance_qty)}, tolerance ${tol}%): ${d3(held)} is already on other open orders or lines` : `More than the balance to order of the requisition line (${d3(pl.balance_qty)}, tolerance ${tol}%)` }); }
      if (cl) { const avail = csAvailable(cl.id, ctx.poId ?? 0); if (qty > avail) problems.push({ field: `lines.${i}.qty`, message: `Only ${d3(avail)} of this line is left to order from the statement` }); }
      let rate = x.rate != null ? Math.round(x.rate * 100) : null; let discount = x.discountPct != null ? Math.round(x.discountPct * 10000) : null; let gst = null; let freight = 0; let csRate = null; const description = x.description ?? rl?.description ?? (item ? item.name : cl?.service_desc);
      if (rl) { rate = rl.rate; discount = 0; csRate = rl.rate; }
      if (cl) { const g = cl.gst_rate; const rq = cl.gst_inclusive ? Math.round(cl.qrate / (1 + g / 1_000_000)) : cl.qrate; csRate = rq; rate ??= rq; discount ??= cl.discount_pct; gst = g; freight = Math.round(((cl.freight + cl.loading + cl.other_charges) * qty) / Math.max(cl.qoffered, 1)); }
      if (rate == null) problems.push({ field: `lines.${i}.rate`, message: 'Give the rate' }); if (!uom) problems.push({ field: `lines.${i}.uom`, message: 'Give the unit' }); if (!description) problems.push({ field: `lines.${i}.description`, message: 'Describe the item' });
      if (item && uom && !base.uomOk(item, uom)) problems.push({ field: `lines.${i}.uom`, message: `${uom} is not a unit of ${item.code}` });
      const taxCode = x.taxCode ?? rl?.tax_code ?? item?.gst_code ?? null; const byCode = gstOf(actor.companyId, taxCode, ctx.date); if (x.taxCode && byCode == null) problems.push({ field: `lines.${i}.taxCode`, message: 'Not an active GST rate code' }); if (byCode != null) gst = byCode; gst ??= 0;
      const mk = item && uom && String(uom).toLowerCase() === String(item.base_uom).toLowerCase() ? rateBenchmarks.lookup(db, { companyId: actor.companyId, itemId: item.id, region: ctx.deliveryState ?? null, date: ctx.date }) : null; const bench = mk?.rate ?? (item?.last_purchase_amount > 0 ? item.last_purchase_amount : null); if (!rl && bench && rate != null && rate > Math.round(bench * (1 + vpct / 100))) variance = true;
      const calc = computeLine({ qty, rate: rate ?? 0, discountPct: discount ?? 0, gstPct: gst, supply: ctx.supply, freight });
      const sched = (x.schedule?.length ? x.schedule : [{ dueDate: x.requiredBy ?? cl?.required_by ?? ctx.defaultDue, qty: x.qty }]).map((s) => ({ dueDate: s.dueDate, qty: q3(s.qty) }));
      if (sched.reduce((n, s) => n + s.qty, 0) !== qty) problems.push({ field: `lines.${i}.schedule`, message: 'The scheduled quantities add up to the quantity of the line' }); if (sched.some((s) => !s.dueDate || s.dueDate < ctx.date)) problems.push({ field: `lines.${i}.schedule`, message: 'A delivery date is not in the past' });
      out.push({ rcLineId: rl?.id ?? null, csLineId: cl?.id ?? null, prLineId, itemId: item?.id ?? null, description, qty, uom, rate: rate ?? 0, discountPct: discount ?? 0, taxCode, gstPct: gst, csRate, benchmark: bench, wbsId: x.wbsId ?? cl?.wbs_id ?? pl?.wbs_id ?? null, costCodeId: x.costCodeId ?? cl?.cost_code_id ?? pl?.cost_code_id ?? null, deliverySiteId: x.deliverySiteId ?? cl?.delivery_site_id ?? pl?.delivery_site_id ?? null, ...calc, schedule: sched });
    });
    fail(problems); if (ctx.rcId) rc.check(actor, ctx.rcId, ctx.projectId, out.filter((l) => l.rcLineId).map((l) => ({ rcLineId: l.rcLineId, qty: l.qty, basic: l.basic })), { excludePoId: ctx.poId ?? 0 }); return { lines: out, variance };
  }
  const saveLines = (r, lines, actor) => {
    const now = nowIso(); db.prepare('UPDATE proc_po_schedules SET deleted_at = ?, is_active = 0 WHERE po_id = ? AND deleted_at IS NULL').run(now, r.id); db.prepare('UPDATE proc_po_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE po_id = ? AND deleted_at IS NULL').run(now, actor.user, r.id);
    lines.forEach((l, i) => { const id = Number(db.prepare("INSERT INTO proc_po_lines (company_id, po_id, line_no, pr_line_id, cs_line_id, item_id, description, qty, uom, rate, discount_pct, tax_code, gst_pct, basic_amount, freight_amount, cgst_amount, sgst_amount, igst_amount, tax_amount, line_amount, cs_rate, benchmark_rate, wbs_id, cost_code_id, delivery_site_id, balance_qty, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(r.company_id, r.id, i + 1, l.prLineId, l.csLineId, l.itemId, l.description, l.qty, l.uom, l.rate, l.discountPct, l.taxCode, l.gstPct, l.basic, l.freight, l.cgst, l.sgst, l.igst, l.tax, l.line, l.csRate, l.benchmark, l.wbsId, l.costCodeId, l.deliverySiteId, l.qty, r.org_project_id, actor.user).lastInsertRowid); if (l.rcLineId) db.prepare("INSERT INTO proc_po_line_rc (company_id, po_line_id, rc_line_id, created_by, source_type) VALUES (?, ?, ?, ?, 'api')").run(r.company_id, id, l.rcLineId, actor.user);
      for (const s of l.schedule) db.prepare("INSERT INTO proc_po_schedules (company_id, po_id, po_line_id, due_date, qty, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'api')").run(r.company_id, r.id, id, s.dueDate, s.qty, r.org_project_id, actor.user); });
    const t = lines.reduce((a, l) => ({ basic: a.basic + l.basic, freight: a.freight + l.freight, tax: a.tax + l.tax }), { basic: 0, freight: 0, tax: 0 }); return t;
  };
  const headerTerms = (t = {}) => ({ delivery_address: t.deliveryAddress ?? null, payment_terms: t.paymentTerms ?? null, advance_pct: Math.round((t.advancePct ?? 0) * 10000), credit_days: t.creditDays ?? 0, milestone_terms: t.milestoneTerms ?? null, delivery_basis: t.priceBasis ?? 'FOR_SITE', freight_terms: t.freightTerms ?? null, insurance_terms: t.insuranceTerms ?? null, warranty_terms: t.warrantyTerms ?? null, ld_terms: t.ldTerms ?? null, ld_pct_per_week: Math.round((t.ldPctPerWeek ?? 0) * 10000), ld_cap_pct: Math.round((t.ldCapPct ?? 0) * 10000), tc_text: t.tcText ?? null, documents_required: t.documentsRequired ?? null, approved_makes: t.approvedMakes ?? null });
  function context(actor, b, existing = null) {
    const projectId = existing?.org_project_id ?? b.projectId; const p = base.project(actor, projectId, 'proc.purchase_order.view', existing ? 'proc.purchase_order.view' : 'proc.purchase_order.create'); let vendorId = existing?.vendor_id ?? b.vendorId; if (!existing && b.source === 'RATE_CONTRACT' && b.rcId) { const x = db.prepare('SELECT vendor_id FROM proc_rate_contracts WHERE id = ?').get(b.rcId); if (x) vendorId = x.vendor_id; }
    const rcId = (existing ? rcOf(existing) : null) ?? (b.source === 'RATE_CONTRACT' ? b.rcId : null); const rcRow = rcId ? db.prepare('SELECT * FROM proc_rate_contracts WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rcId, actor.companyId) : null; if (rcId && !rcRow) fail([{ field: 'rcId', message: 'No such rate contract' }]);
    const v = db.prepare("SELECT id, partner_status FROM mdm_partners WHERE id = ? AND company_id = ? AND deleted_at IS NULL").get(rcRow ? rcRow.vendor_id : vendorId, actor.companyId); if (!v) fail([{ field: 'vendorId', message: 'Not a business partner of this company' }]); if (v.partner_status !== 'ACTIVE') fail([{ field: 'vendorId', message: `The vendor is ${v.partner_status.toLowerCase().replace('_', ' ')}: it is not given an order` }]);
    let cs = null; const csId = existing?.cs_id ?? b.csId; if ((existing?.po_source ?? b.source) === 'CS') { const c = db.prepare('SELECT * FROM proc_comparative_statements WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(csId, actor.companyId); if (!c || c.org_project_id !== p.id) fail([{ field: 'csId', message: 'Not a comparative statement of this project' }]); if (c.status !== 'APPROVED') fail([{ field: 'csId', message: 'The comparative statement is not approved' }]); cs = { ...c, lines: csLines(c, vendorId) }; if (!cs.lines.length) fail([{ field: 'vendorId', message: 'This vendor was not selected in the statement' }]); }
    const t = b.terms ?? {}; const g = vendorGstin(actor.companyId, vendorId, b.vendorGstinId ?? null); const deliveryState = t.deliveryStateCode ?? existing?.delivery_state ?? null; const supply = supplyOf(g?.state_code ?? null, deliveryState);
    if (!deliveryState && !existing) fail([{ field: 'terms.deliveryStateCode', message: 'Give the state of the place of supply (GST state code), it decides CGST and SGST or IGST' }]);
    return { projectId: p.id, project: p, vendorId, cs, rcId, rc: rcRow ? { ...rcRow, lines: db.prepare('SELECT * FROM proc_rc_lines WHERE rc_id = ? AND deleted_at IS NULL ORDER BY line_no').all(rcRow.id) } : null, gstin: g, supply, deliveryState, date: todayIST(), defaultDue: b.deliveryDate ?? existing?.doc_date ?? todayIST(), poId: existing?.id ?? 0 };
  }

  const pos = {
    list(actor, query) {
      if (!authz.check(actor, 'proc.purchase_order.view').allowed) throw forbidden('You may not see purchase orders (permission proc.purchase_order.view).'); const sc = scope(actor);
      return runList(db, poList, parseListRequest(poList, query), { select: 'x.*, p.code AS pcode', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (x) => { const ls = linesOf(x.id); const dv = deliveryOf(x, ls); return { id: x.id, docNo: x.doc_no, date: x.doc_date, project: x.pcode, projectId: x.org_project_id, vendor: vname(x.vendor_id).name, amount: may(actor, 'proc.purchase_order.rates', x.org_project_id, x.po_site_id) ? String(rs(x.total_amount)) : '', amendment: x.amendment_no, delivery: dv.status ?? '', overdue: dv.overdue, status: x.status, statusLabel: PO_STATUS[x.status] }; } });
    },
    exportSource(actor, req) { return pos.list(actor, { ...req, page: 1, pageSize: 100 }); },
    get: (actor, id) => { const v = view(actor, row(actor, id), { detail: true }); if (v.can.approve && v.workflowInstanceId) v.taskId = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === v.workflowInstanceId)?.id ?? null; return v; },
    /** The form: approved statements with something left to order, the vendors of each, GST rates, the place of supply default. */
    options(actor, projectId) {
      const p = base.project(actor, projectId, 'proc.purchase_order.view', 'proc.purchase_order.create'); const css = db.prepare("SELECT s.id, s.doc_no, s.rfq_id FROM proc_comparative_statements s WHERE s.company_id = ? AND s.org_project_id = ? AND s.status = 'APPROVED' AND s.deleted_at IS NULL ORDER BY s.id DESC LIMIT 100").all(actor.companyId, p.id);
      const statements = css.map((s) => { const vs = db.prepare('SELECT DISTINCT vendor_id FROM proc_cs_lines WHERE cs_id = ? AND selected_qty > 0 AND deleted_at IS NULL').all(s.id).map((x) => x.vendor_id); return { id: s.id, docNo: s.doc_no, vendors: vs.map((v) => ({ vendorId: v, name: vname(v).name, left: db.prepare('SELECT c.id FROM proc_cs_lines c WHERE c.cs_id = ? AND c.vendor_id = ? AND c.selected_qty > 0 AND c.deleted_at IS NULL').all(s.id, v).reduce((n, c) => n + Math.max(0, csAvailable(c.id)), 0) > 0, gstins: db.prepare("SELECT id, gstin, state_code FROM mdm_partner_gstins WHERE partner_id = ? AND gstin_status = 'ACTIVE' AND deleted_at IS NULL").all(v) })) }; }).filter((s) => s.vendors.some((v) => v.left));
      const br = db.prepare("SELECT state_code FROM org_branches WHERE company_id = ? AND state_code IS NOT NULL AND status = 'ACTIVE' AND deleted_at IS NULL ORDER BY id LIMIT 1").get(actor.companyId);
      const rates = may(actor, 'proc.purchase_order.rates', p.id); const today = todayIST(); const rateContracts = rc ? db.prepare("SELECT * FROM proc_rate_contracts WHERE company_id = ? AND status = 'APPROVED' AND valid_from <= ? AND valid_to >= ? AND deleted_at IS NULL ORDER BY doc_no").all(actor.companyId, today, today).filter((c) => { const pj = json(c.projects_json, []); return !pj.length || pj.includes(p.id); }).map((c) => ({ id: c.id, docNo: c.doc_no, title: c.title, vendorId: c.vendor_id, vendor: vname(c.vendor_id).name, validTo: c.valid_to, lines: db.prepare('SELECT * FROM proc_rc_lines WHERE rc_id = ? AND deleted_at IS NULL ORDER BY line_no').all(c.id).map((l) => ({ id: l.id, lineNo: l.line_no, description: l.description, uom: l.uom, rate: rates ? rs(l.rate) : null, remainingQty: l.ceiling_qty > 0 ? d3(Math.max(0, l.ceiling_qty - l.consumed_qty)) : null })) })) : [];
      return { rateContracts, project: { id: p.id, code: p.code, name: p.name }, statements, sites: db.prepare("SELECT id, code, name FROM org_sites WHERE org_project_id = ? AND deleted_at IS NULL ORDER BY code").all(p.id), defaultStateCode: br?.state_code ?? null, gstRates: db.prepare("SELECT code, description, igst_pct FROM mdm_gst_rates WHERE row_status = 'ACTIVE' AND (company_id = ? OR company_id IS NULL) AND deleted_at IS NULL ORDER BY igst_pct, code").all(actor.companyId),
        vendors: db.prepare("SELECT p.id, p.code, COALESCE(p.trade_name, p.legal_name) AS name FROM mdm_partners p WHERE p.company_id = ? AND p.partner_status = 'ACTIVE' AND p.deleted_at IS NULL ORDER BY p.legal_name LIMIT 300").all(actor.companyId), tolerancePct: Number(param(actor.companyId, 'proc.po.qty_tolerance_pct') ?? 5), bases: BASES };
    },
    create(actor, b) {
      const ctx = context(actor, b); if (b.source === 'RATE_CONTRACT') { if (!b.rcId) fail([{ field: 'rcId', message: 'Choose the rate contract' }]); if (!b.lines?.length) fail([{ field: 'lines', message: 'Add at least one line' }]); } if (b.source === 'DIRECT') { if (!b.directReason || b.directReason.trim().length < 10) fail([{ field: 'directReason', message: 'An order without a comparative statement needs a reason (at least 10 characters)' }]); if (!b.lines?.length) fail([{ field: 'lines', message: 'Add at least one line' }]); }
      const inputs = b.source === 'RATE_CONTRACT' ? b.lines : b.source === 'CS' ? (b.lines?.length ? b.lines : ctx.cs.lines.map((c) => ({ csLineId: c.id, qty: d3(Math.max(0, csAvailable(c.id))) }))).filter((x) => x.qty > 0) : b.lines; if (!inputs.length) fail([{ field: 'lines', message: 'Nothing is left to order from this statement for this vendor' }]);
      const { lines, variance } = buildLines(actor, ctx, inputs); const t = headerTerms(b.terms);
      return transaction(db, () => {
        const no = number(actor.companyId, actor.user, 'PROC_PO', 'proc_purchase_orders', 'PO'); const cols = Object.keys(t);
        const id = Number(db.prepare(`INSERT INTO proc_purchase_orders (company_id, doc_no, doc_date, org_project_id, po_site_id, vendor_id, po_source, cs_id, direct_reason, is_emergency, delivery_state, vendor_state, vendor_gstin, supply_type, ${cols.join(', ')}, variance_flag, status, requested_by, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${cols.map(() => '?').join(', ')}, ?, 'DRAFT', ?, ?, ?, ?, ?)`)
          .run(actor.companyId, no, todayIST(), ctx.projectId, b.siteId ?? null, ctx.vendorId, b.source === 'CS' ? 'CS' : 'DIRECT', b.source === 'CS' ? ctx.cs.id : null, b.source === 'RATE_CONTRACT' ? `Call-off from rate contract ${ctx.rc.doc_no}` : (b.directReason ?? null), b.isEmergency ? 1 : 0, ctx.deliveryState, ctx.gstin?.state_code ?? null, ctx.gstin?.gstin ?? null, ctx.supply, ...cols.map((c) => t[c]), variance ? 1 : 0, actor.user, ctx.projectId, actor.user, b.source === 'CS' ? 'proc_comparative_statement' : b.source === 'RATE_CONTRACT' ? 'proc_rate_contract' : 'api', b.source === 'CS' ? String(ctx.cs.id) : b.source === 'RATE_CONTRACT' ? String(ctx.rcId) : null).lastInsertRowid);
        const r = db.prepare('SELECT * FROM proc_purchase_orders WHERE id = ?').get(id); if (b.source === 'RATE_CONTRACT') db.prepare("INSERT INTO proc_po_rc (company_id, po_id, rc_id, created_by, source_type) VALUES (?, ?, ?, ?, 'api')").run(actor.companyId, id, ctx.rcId, actor.user); const tot = saveLines(r, lines, actor); db.prepare('UPDATE proc_purchase_orders SET total_basic = ?, total_freight = ?, total_tax = ?, total_amount = ? WHERE id = ?').run(tot.basic, tot.freight, tot.tax, tot.basic + tot.freight + tot.tax, id);
        audit(actor, 'proc_purchase_orders', id, 'create', actor.companyId, { newValues: { docNo: no, source: b.source, total: rs(tot.basic + tot.freight + tot.tax) } }); return pos.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'proc.purchase_order.edit'); if (!EDITABLE.includes(r.status)) throw conflict(`${PO_STATUS[r.status]}: the order is not changed now. Amend an approved order.`); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this order; reload it.');
      const ctx = context(actor, { ...b, projectId: r.org_project_id, vendorId: r.vendor_id, csId: r.cs_id, source: r.po_source }, r); const ls = b.lines ?? linesOf(r.id).map((l) => ({ rcLineId: lineRc(l.id), csLineId: l.cs_line_id, prLineId: l.pr_line_id, itemId: l.item_id, description: l.description, qty: d3(l.qty), uom: l.uom, rate: rs(l.rate), discountPct: l.discount_pct / 10000, taxCode: l.tax_code, wbsId: l.wbs_id, costCodeId: l.cost_code_id, deliverySiteId: l.delivery_site_id, schedule: schedOf(l.id).map((s) => ({ dueDate: s.due_date, qty: d3(s.qty) })) }));
      const { lines, variance } = buildLines(actor, ctx, ls); const t = b.terms ? headerTerms({ ...currentTerms(r), ...b.terms }) : null;
      return transaction(db, () => { const tot = saveLines(r, lines, actor); const sets = [...(t ? Object.keys(t).map((c) => `${c} = ?`) : []), 'delivery_state = ?', 'vendor_state = ?', 'vendor_gstin = ?', 'supply_type = ?', 'direct_reason = ?', 'is_emergency = ?', 'po_site_id = ?'];
        db.prepare(`UPDATE proc_purchase_orders SET ${sets.join(', ')}, total_basic = ?, total_freight = ?, total_tax = ?, total_amount = ?, variance_flag = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...(t ? Object.values(t) : []), ctx.deliveryState, ctx.gstin?.state_code ?? r.vendor_state, ctx.gstin?.gstin ?? r.vendor_gstin, ctx.supply, 'directReason' in b ? b.directReason : r.direct_reason, 'isEmergency' in b ? (b.isEmergency ? 1 : 0) : r.is_emergency, 'siteId' in b ? b.siteId : r.po_site_id, tot.basic, tot.freight, tot.tax, tot.basic + tot.freight + tot.tax, variance ? 1 : 0, actor.user, nowIso(), r.id);
        audit(actor, 'proc_purchase_orders', r.id, 'update', r.company_id); return pos.get(actor, r.id); });
    },
    /** Lines keyed as rows (item code, quantity, rate) are added to a draft direct order. */
    importLines(actor, id, { rows }) {
      const r = row(actor, id, 'proc.purchase_order.edit'); if (!EDITABLE.includes(r.status)) throw conflict('Lines are added to a draft or a returned order.'); if (r.po_source !== 'DIRECT') throw conflict('Lines of an order from a comparative statement come from the statement.'); const problems = [];
      const add = rows.map((x, i) => { const it = db.prepare("SELECT id FROM mdm_items WHERE company_id = ? AND code = ? COLLATE NOCASE AND item_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1").get(actor.companyId, x.itemCode); if (!it) problems.push({ field: `rows.${i}.itemCode`, message: `No active item with the code ${x.itemCode}` }); return { itemId: it?.id ?? null, qty: x.qty, rate: x.rate, uom: x.uom ?? undefined, schedule: [{ dueDate: x.dueDate ?? todayIST(), qty: x.qty }] }; }); fail(problems);
      const cur = linesOf(r.id).map((l) => ({ prLineId: l.pr_line_id, itemId: l.item_id, description: l.description, qty: d3(l.qty), uom: l.uom, rate: rs(l.rate), discountPct: l.discount_pct / 10000, taxCode: l.tax_code, wbsId: l.wbs_id, costCodeId: l.cost_code_id, deliverySiteId: l.delivery_site_id, schedule: schedOf(l.id).map((s) => ({ dueDate: s.due_date, qty: d3(s.qty) })) }));
      return pos.update(actor, id, { lines: [...cur, ...add] });
    },
    remove(actor, id) { const r = row(actor, id, 'proc.purchase_order.delete'); if (r.status !== 'DRAFT' || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted. Cancel an approved order instead.'); const now = nowIso(); db.prepare('UPDATE proc_po_schedules SET deleted_at = ?, is_active = 0 WHERE po_id = ? AND deleted_at IS NULL').run(now, r.id); db.prepare('UPDATE proc_po_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE po_id = ? AND deleted_at IS NULL').run(now, actor.user, r.id); db.prepare('UPDATE proc_purchase_orders SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, actor.user, r.id); audit(actor, 'proc_purchase_orders', r.id, 'delete', r.company_id); return { id: r.id, deleted: true }; },
    submit(actor, id) {
      const r = row(actor, id, 'proc.purchase_order.submit'); if (!EDITABLE.includes(r.status)) throw unprocessable('Only a draft or a returned order is sent for approval.'); const ls = linesOf(r.id); if (!ls.length) throw unprocessable('The order has no lines.');
      const above = ls.filter((l) => l.cs_rate != null && l.rate > l.cs_rate);
      budgetAtSubmit(actor, r, ls); // outside the transaction: the stop it registers with the control engine stays, so the exception can be raised from it
      return transaction(db, () => {
        if (above.length) protocolOf(db).enforce(actor, 'CP-PROC-05', { entity: 'proc_po', entityId: String(r.id), amount: Number(rs(r.total_amount)), valueAtRisk: Number(rs(above.reduce((n, l) => n + Math.round(((l.rate - l.cs_rate) * l.qty) / 1000), 0))), ref: r.doc_no, items: above.map((l) => l.description).join(', '), message: `${r.doc_no}: the rate of ${above.map((l) => `line ${l.line_no}`).join(', ')} is above the rate approved in the comparative statement.` });
        let level = levelOf(r.company_id, r.total_amount); if (rcOf(r)) { rc.check(actor, rcOf(r), r.org_project_id, ls.filter((l) => lineRc(l.id)).map((l) => ({ rcLineId: lineRc(l.id), qty: l.qty, basic: l.basic_amount })), { excludePoId: r.id }); level = r.total_amount > Number(param(r.company_id, 'proc.rc.calloff_pm_minor') ?? 250_000_000) ? 1 : 0; } if (r.variance_flag || r.is_emergency) level = Math.max(level, 1);
        const ctx = { projectId: r.org_project_id, siteId: r.po_site_id ?? undefined, amount: Number(rs(r.total_amount)), needPm: level >= 1 ? 'yes' : 'no', needPd: level >= 2 ? 'yes' : 'no', needDir: level >= 3 ? 'yes' : 'no', variance: r.variance_flag ? 'yes' : 'no' };
        if (r.status === 'RETURNED' && r.workflow_instance_id) workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: PO_DOC, docId: String(r.id), comment: `${r.doc_no}: ${vname(r.vendor_id).name} ${rs(r.total_amount)}`.slice(0, 300), context: ctx }); db.prepare('UPDATE proc_purchase_orders SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE proc_purchase_orders SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id); audit(actor, 'proc_purchase_orders', r.id, 'submit', r.company_id, { newValues: { total: rs(r.total_amount), level } }); rcTouch(r); return pos.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = row(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only an order waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return pos.get(actor, r.id); },
    history(actor, id) { const r = row(actor, id); const am = db.prepare('SELECT workflow_instance_id FROM proc_po_amendments WHERE po_id = ? AND workflow_instance_id IS NOT NULL').all(r.id).map((a) => a.workflow_instance_id); const insts = [r.workflow_instance_id, ...am].filter(Boolean); return { approvals: insts.length ? db.prepare(`SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id IN (${insts.map(() => '?').join(',')}) ORDER BY id`).all(...insts) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity IN ('proc_purchase_orders', 'proc_po_amendments', 'proc_dispatches', 'proc_po_advances') AND (entity_id = ? OR entity_id IN (SELECT CAST(id AS TEXT) FROM proc_po_amendments WHERE po_id = ?)) ORDER BY id").all(String(r.id), r.id) }; },
    print(actor, id) {
      const r = row(actor, id, 'proc.purchase_order.print'); const v = view(actor, r, { detail: true }); audit(actor, 'proc_purchase_orders', r.id, 'print', r.company_id); const cols = [['lineNo', '#'], ['item', 'Item'], ['qty', 'Quantity'], ['uom', 'Unit']]; if (v.canSeeRates) cols.push(['rate', 'Rate'], ['disc', 'Disc %'], ['gst', 'GST %'], ['amount', 'Amount']); cols.push(['due', 'Delivery']);
      const rows = v.lines.map((l) => ({ lineNo: String(l.lineNo), item: `${l.itemCode ? `${l.itemCode} ` : ''}${l.description}`, qty: String(l.qty), uom: l.uom, rate: String(l.rate ?? ''), disc: String(l.discountPct), gst: String(l.gstPct), amount: String(l.amount ?? ''), due: l.schedule.map((s) => `${s.dueDate}: ${s.qty}`).join('; ') })); const t = v.terms;
      const footer = [`${v.docNo}${v.amendmentNo ? ` (amendment ${v.amendmentNo})` : ''}: ${v.vendor}. ${v.projectCode}. Date ${v.date}`, v.canSeeRates ? `Basic ${v.totalBasic}; freight ${v.totalFreight}; ${t.supplyType === 'INTRA' ? 'CGST and SGST' : t.supplyType === 'INTER' ? 'IGST' : 'GST'} ${v.totalTax}; total ${v.totalAmount}` : '', `Deliver to: ${t.deliveryAddress ?? ''}. ${t.priceBasisLabel}`, `Payment: ${t.paymentTerms ?? ''}${t.advancePct ? `, advance ${t.advancePct}%` : ''}${t.creditDays ? `, credit ${t.creditDays} days` : ''}`, t.ldTerms ? `Late delivery: ${t.ldTerms}` : '', t.warrantyTerms ? `Warranty: ${t.warrantyTerms}` : '', t.documentsRequired ? `Documents required: ${t.documentsRequired}` : '', t.tcText ?? ''].filter(Boolean);
      return { buffer: toPdf({ columns: cols.map(([key, label]) => ({ key, label, type: 'text' })), rows, footer, title: `Purchase order ${v.docNo}` }), contentType: 'application/pdf', fileName: `${v.docNo.replaceAll('/', '-')}.pdf`, rows: rows.length };
    },
  };
  const currentTerms = (r) => ({ deliveryAddress: r.delivery_address, paymentTerms: r.payment_terms, advancePct: r.advance_pct / 10000, creditDays: r.credit_days, milestoneTerms: r.milestone_terms, priceBasis: r.delivery_basis, freightTerms: r.freight_terms, insuranceTerms: r.insurance_terms, warrantyTerms: r.warranty_terms, ldTerms: r.ld_terms, ldPctPerWeek: r.ld_pct_per_week / 10000, ldCapPct: r.ld_cap_pct / 10000, tcText: r.tc_text, documentsRequired: r.documents_required, approvedMakes: r.approved_makes });

  // ---- commitment, release and the requisition balance -------------------------------------------------------------------------------------------------------------------------------------------------
  const RES = { MATERIAL: 'MATERIAL', CONSUMABLE: 'MATERIAL', SPARE: 'MATERIAL', TOOL: 'MATERIAL', RETURNABLE: 'MATERIAL', EQUIPMENT: 'EQUIPMENT', LABOUR: 'LABOUR', SERVICE: 'SUBCONTRACT', SUBCONTRACT: 'SUBCONTRACT' };
  function commitLedger(actor, r, lines) {
    const bud = budOf(db)?.ledger; if (!bud || !lines.length || !db.prepare('SELECT 1 FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(r.org_project_id)) return null;
    return bud.commitments.commit(sysActor(r.company_id, actor.user), { projectId: r.org_project_id, stage: 'PO', sourceType: 'proc_po', sourceId: String(r.id), docRef: r.doc_no, vendorRef: vname(r.vendor_id).code, vendorName: vname(r.vendor_id).name, lines: ledgerLines(r, lines) });
  }
  const ledgerLines = (r, lines) => lines.map((l) => ({ lineId: String(l.line_no), wbsId: l.wbs_id ?? undefined, costCodeId: l.cost_code_id ?? undefined, resourceType: RES[itemOf(r.company_id, l.item_id)?.item_type] ?? 'OTHER', qty: d3(l.qty - l.short_closed_qty), amount: (l.qty > 0 ? Math.round((l.basic_amount * (l.qty - l.short_closed_qty)) / l.qty) : 0) / 100, description: l.description }));
  /** PACK-22 (ff.proc.pack22): the budget check of the order before it is sent for approval; a block needs the approved exception first (the same one the commitment asks for). */
  function budgetAtSubmit(actor, r, lines) {
    const bud = budOf(db)?.ledger; if (!bud || !lines.length || !isEnabled(db, 'ff.proc.pack22', { companyId: r.company_id }) || !db.prepare('SELECT 1 FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(r.org_project_id)) return null;
    // as the requisition does (pr.js): the person's own check, or the check as the system when the person may not use the check API
    const body = { projectId: r.org_project_id, stage: 'PO', lines: ledgerLines(r, lines).map((l) => ({ ...l, sourceType: 'proc_po', sourceId: String(r.id) })) };
    const c = (() => { try { return bud.check(actor, body); } catch { return bud.check({ user: actor.user, companyId: r.company_id, roles: ['SYSADM'] }, body); } })();
    if (c.result === 'BLOCK' && c.exception?.required && !c.exception.excepted) throw Object.assign(unprocessable(`${r.doc_no} is over the budget of a cost head that blocks: raise an exception for it and have it approved before sending the order for approval.`), { details: c.lines.filter((x) => x.result === 'BLOCK').map((x) => ({ field: `lines.${x.lineId ?? ''}`, message: x.message })) });
    return c;
  }
  const releaseLedger = (actor, r, cancel, reason) => budOf(db)?.ledger?.commitments?.release(sysActor(r.company_id, actor.user), { sourceType: 'proc_po', sourceId: String(r.id), cancel, reason, quiet: true });
  const prDeltas = (lines, sign = 1) => lines.filter((l) => l.pr_line_id).map((l) => ({ prLineId: l.pr_line_id, qty: sign * d3(l.qty) }));

  // ---- sending to the vendor and the vendor's page (acknowledge, tell the dispatch) -------------------------------------------------------------------------------------------------------------------
  function sendToVendor(actor, r, kind = 'new') {
    const token = randomBytes(24).toString('base64url'); const url = link(token); const ls = linesOf(r.id); const co = db.prepare('SELECT short_name FROM org_companies WHERE id = ?').get(r.company_id)?.short_name ?? '';
    const c = db.prepare('SELECT email, mobile FROM mdm_partner_contacts WHERE partner_id = ? AND deleted_at IS NULL ORDER BY is_primary DESC, id LIMIT 1').get(r.vendor_id); let status = 'NO_ADDRESS'; let note = 'The vendor has no e-mail address in the partner master: give it the link yourself.';
    if (c?.email) { try { const res = commOf(db).send({ companyId: r.company_id, channel: 'EMAIL', to: c.email, subject: `${kind === 'amended' ? 'Amended purchase order' : 'Purchase order'} ${r.doc_no}`, body: `${co} has placed ${kind === 'amended' ? 'an amended ' : 'a '}purchase order ${r.doc_no}${r.amendment_no ? ` (amendment ${r.amendment_no})` : ''} with you for ${ls.length} line(s).\n\nPlease acknowledge it and tell us when you dispatch: ${url}\nThe link is for you only.`, purpose: 'TRANSACTIONAL', related: { entity: 'proc_purchase_order', id: String(r.id) }, actor: actor?.user ?? 'system' }); status = res.status === 'BLOCKED' ? 'BLOCKED' : 'QUEUED'; note = status === 'BLOCKED' ? (res.message ?? res.blockReason) : null; } catch (x) { status = 'BLOCKED'; note = String(x?.message ?? x).slice(0, 200); } }
    const days = Number(param(r.company_id, 'proc.po.ack_days') ?? 180); const exp = new Date(Date.now() + days * 86_400_000).toISOString();
    db.prepare('UPDATE proc_purchase_orders SET ack_token_hash = ?, ack_expires = ?, sent_at = ?, sent_status = ?, sent_note = ?, version = version + 1 WHERE id = ?').run(hash(token), exp, status === 'QUEUED' ? nowIso() : r.sent_at, status, note, r.id); return { url, sendStatus: status, note };
  }
  const byToken = (token) => {
    const r = db.prepare('SELECT * FROM proc_purchase_orders WHERE ack_token_hash = ? AND deleted_at IS NULL').get(hash(String(token))); if (!r) throw notFound('This link is not valid.');
    if (!['APPROVED', 'CLOSED'].includes(r.status)) throw gone('This purchase order is no longer open.'); if (r.ack_expires && Date.parse(r.ack_expires) < Date.now()) throw gone('This link has expired. Ask the buyer to send you a new one.'); return r;
  };
  const vendorInfo = (r) => {
    const co = db.prepare('SELECT short_name FROM org_companies WHERE id = ?').get(r.company_id)?.short_name ?? ''; const t = currentTerms(r);
    return { company: co, docNo: r.doc_no, date: r.doc_date, amendmentNo: r.amendment_no, vendor: vname(r.vendor_id).name, status: r.status, acknowledgedAt: r.acknowledged_at, terms: { ...t, deliveryStateCode: r.delivery_state }, totalAmount: rs(r.total_amount), totalTax: rs(r.total_tax), supplyType: r.supply_type,
      lines: linesOf(r.id).map((l) => ({ id: l.id, lineNo: l.line_no, description: l.description, qty: d3(l.qty), uom: l.uom, rate: rs(l.rate), discountPct: l.discount_pct / 10000, gstPct: l.gst_pct / 10000, amount: rs(l.line_amount), receivedQty: d3(l.received_qty), balanceQty: d3(l.balance_qty), schedule: schedOf(l.id).map((s) => ({ dueDate: s.due_date, qty: d3(s.qty) })) })),
      dispatches: db.prepare('SELECT asn_no, dispatch_date, expected_arrival, status FROM proc_dispatches WHERE po_id = ? AND deleted_at IS NULL ORDER BY id').all(r.id) };
  };
  const acknowledgeVendorOrder = (r, user, note) => {
    if (r.acknowledged_at) return { message: 'You have acknowledged this order already. Thank you.', acknowledgedAt: r.acknowledged_at };
    const now = nowIso(); db.prepare('UPDATE proc_purchase_orders SET acknowledged_at = ?, acknowledged_by = ?, remarks = COALESCE(?, remarks), version = version + 1 WHERE id = ?').run(now, user, note ?? null, r.id); audit({ user, companyId: r.company_id }, 'proc_purchase_orders', r.id, 'acknowledge', r.company_id, { reason: note });
    evt('proc.po.acknowledged', { user }, r, { acknowledgedBy: user }); notify(r.company_id, 'proc.po.acknowledged', [`user:${r.requested_by}`], r.doc_no, r.doc_no, `${vname(r.vendor_id).name} acknowledged ${r.doc_no}${note ? `: ${note}` : ''}.`, `/proc/purchase-orders?id=${r.id}`, r.id, { projectId: r.org_project_id }); return { message: 'Thank you. The order is acknowledged.', acknowledgedAt: now };
  };
  const supplierRows = (scope, { id = null, before = null } = {}) => db.prepare(`
    SELECT p.* FROM proc_purchase_orders p
    WHERE p.company_id = :companyId AND p.vendor_id = :partnerId AND p.deleted_at IS NULL AND p.is_active = 1
      AND p.status IN ('APPROVED', 'CLOSED')
      AND (:projectId IS NULL OR p.org_project_id = :projectId)
      AND (:siteId IS NULL OR (p.po_site_id = :siteId
        AND NOT EXISTS (SELECT 1 FROM proc_po_lines l WHERE l.po_id = p.id AND l.deleted_at IS NULL
          AND COALESCE(l.delivery_site_id, p.po_site_id) IS NOT :siteId)))
      AND (:id IS NULL OR p.id = :id) AND (:before IS NULL OR p.id < :before)
    ORDER BY p.id DESC LIMIT 51`).all({
    companyId: scope.companyId, partnerId: scope.partnerId, projectId: scope.projectId, siteId: scope.siteId, id, before,
  });
  const supplierOrder = (scope, id) => {
    const r = supplierRows(scope, { id })[0];
    if (!r) throw notFound('That purchase order does not exist.');
    return r;
  };
  const supplierActor = (scope) => ({ user: `portal-supplier:${scope.accountId}`, companyId: scope.companyId });
  const requireCurrentOrder = (r, version) => {
    if (r.status !== 'APPROVED') throw conflict('That purchase order is closed.');
    if (version !== r.version) throw conflict('The purchase order has changed. Reload it before trying again.');
  };
  const supplier = {
    list(scope, before) {
      const rows = supplierRows(scope, { before });
      audit(supplierActor(scope), 'proc_purchase_orders', 0, 'supplier_list', scope.companyId);
      return { items: rows.slice(0, 50).map((r) => ({
        id: r.id, docNo: r.doc_no, date: r.doc_date, status: r.status, acknowledgedAt: r.acknowledged_at,
      })), nextBefore: rows.length > 50 ? rows[49].id : null };
    },
    order: supplierOrder,
    info(scope, id) {
      const r = supplierOrder(scope, id);
      const receipts = db.prepare(`SELECT t.grn_ref, t.received_on, t.qty, t.accepted_qty, l.line_no,
          SUM(i.rejected_qty) AS rejected_qty, SUM(i.released_qty) AS released_qty, SUM(i.qc_rejected_qty) AS qc_rejected_qty,
          CASE WHEN COUNT(i.id) = 0 THEN NULL
            WHEN MAX(i.inspection_status = 'PENDING') = 1 THEN 'PENDING'
            WHEN MIN(i.inspection_status) = MAX(i.inspection_status) THEN MAX(i.inspection_status)
            ELSE 'PARTIAL' END AS inspection_status
        FROM proc_po_receipts t JOIN proc_po_lines l ON l.id = t.po_line_id AND l.po_id = t.po_id AND l.company_id = t.company_id
        LEFT JOIN inv_grns g ON g.company_id = t.company_id AND g.po_id = t.po_id AND g.doc_no = t.grn_ref
          AND g.vendor_id = ? AND g.status = 'APPROVED' AND g.deleted_at IS NULL
          AND (? IS NULL OR g.org_site_id = ?)
        LEFT JOIN inv_grn_lines i ON i.grn_id = g.id AND i.company_id = g.company_id AND i.po_line_id = l.id AND i.deleted_at IS NULL
        WHERE t.company_id = ? AND t.po_id = ? AND t.deleted_at IS NULL GROUP BY t.id ORDER BY t.received_on, t.id`)
        .all(scope.partnerId, scope.siteId, scope.siteId, r.company_id, r.id)
        .map((x) => ({ grnRef: x.grn_ref, receivedOn: x.received_on, lineNo: x.line_no, qty: d3(x.qty), acceptedQty: d3(x.accepted_qty),
          rejectedQty: x.rejected_qty == null ? null : d3(x.rejected_qty), inspection: x.inspection_status,
          releasedQty: x.released_qty == null ? null : d3(x.released_qty),
          qcRejectedQty: x.qc_rejected_qty == null ? null : d3(x.qc_rejected_qty) }));
      audit(supplierActor(scope), 'proc_purchase_orders', r.id, 'supplier_view', scope.companyId);
      return { ...vendorInfo(r), id: r.id, version: r.version, receipts };
    },
    acknowledge(scope, id, version, { note }) {
      return transaction(db, () => {
        const r = supplierOrder(scope, id);
        requireCurrentOrder(r, version);
        return acknowledgeVendorOrder(r, supplierActor(scope).user, note);
      });
    },
    dispatch(scope, id, version, b, attach) {
      return transaction(db, () => {
        const r = supplierOrder(scope, id);
        requireCurrentOrder(r, version);
        const result = dispatchPo(supplierActor(scope).user, r, b, 'VENDOR');
        if (attach) {
          const [fileId] = attach({ entity: 'proc_purchase_order', id: r.id, projectId: r.org_project_id, siteId: r.po_site_id });
          db.prepare('INSERT INTO ptl_asn_invoices (dispatch_id, file_id) VALUES (?, ?)').run(result.id, fileId);
        }
        db.prepare('UPDATE proc_purchase_orders SET version = version + 1 WHERE id = ?').run(r.id);
        return result;
      });
    },
  };
  const portal = {
    info(token) {
      return vendorInfo(byToken(token));
    },
    acknowledge(token, { note }) {
      const r = byToken(token);
      return acknowledgeVendorOrder(r, `vendor:${vname(r.vendor_id).code}`, note);
    },
    dispatch(token, b) { const r = byToken(token); if (r.status !== 'APPROVED') throw gone('This order is closed: no dispatch is taken.'); return dispatchPo(`vendor:${vname(r.vendor_id).code}`, r, b, 'VENDOR'); },
  };

  // ---- dispatch / ASN (FR-06) -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  function dispatchPo(user, r, b, via) {
    const ls = new Map(linesOf(r.id).map((l) => [l.id, l])); const problems = []; const per = new Map(); b.lines.forEach((x, i) => { const l = ls.get(x.poLineId); if (!l) { problems.push({ field: `lines.${i}.poLineId`, message: 'Not a line of this order' }); return; } const q = q3(x.qty); const open = db.prepare("SELECT lines_json FROM proc_dispatches WHERE po_id = ? AND status = 'DISPATCHED' AND deleted_at IS NULL").all(r.id).reduce((n, d) => n + json(d.lines_json, []).filter((y) => y.poLineId === l.id).reduce((m, y) => m + q3(y.qty), 0), 0); per.set(l.id, (per.get(l.id) ?? 0) + q); if (per.get(l.id) + open > l.balance_qty) problems.push({ field: `lines.${i}.qty`, message: `More than the balance of line ${l.line_no} (${d3(l.balance_qty)}) is on the way` }); });
    fail(problems);
    return transaction(db, () => { let k = db.prepare('SELECT COUNT(*) AS n FROM proc_dispatches WHERE company_id = ?').get(r.company_id).n + 1; let no = `ASN/${String(k).padStart(6, '0')}`; while (db.prepare('SELECT 1 FROM proc_dispatches WHERE company_id = ? AND asn_no = ?').get(r.company_id, no)) { k += 1; no = `ASN/${String(k).padStart(6, '0')}`; } const id = Number(db.prepare("INSERT INTO proc_dispatches (company_id, po_id, asn_no, vendor_invoice_no, lr_no, vehicle_no, eway_bill_no, dispatch_date, expected_arrival, lines_json, entered_via, entered_by, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(r.company_id, r.id, no, b.vendorInvoiceNo ?? null, b.lrNo ?? null, b.vehicleNo ?? null, b.ewayBillNo ?? null, b.dispatchDate, b.expectedArrival ?? null, JSON.stringify(b.lines.map((x) => ({ poLineId: x.poLineId, lineNo: ls.get(x.poLineId).line_no, qty: x.qty }))), via, user, r.org_project_id, user).lastInsertRowid);
      audit({ user, companyId: r.company_id }, 'proc_dispatches', id, 'create', r.company_id, { newValues: { asnNo: no, via } }); evt('proc.po.dispatched', { user }, r, { dispatchId: id, asnNo: no, expectedArrival: b.expectedArrival ?? null, ewayBillNo: b.ewayBillNo ?? null, lines: b.lines.map((x) => ({ poLineId: x.poLineId, qty: x.qty })) });
      notify(r.company_id, 'proc.po.acknowledged', [`user:${r.requested_by}`], r.doc_no, r.doc_no, `${vname(r.vendor_id).name} dispatched against ${r.doc_no} (${no})${b.expectedArrival ? `, expected ${b.expectedArrival}` : ''}.`, `/proc/purchase-orders?id=${r.id}`, `${id}.d`, { projectId: r.org_project_id }); return { id, asnNo: no, message: 'The dispatch is recorded. Thank you.' }; });
  }

  // ---- decisions of the approvals ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  pos.decide = function decide(instance, actor, outcome, comment) {
    const r = db.prepare('SELECT * FROM proc_purchase_orders WHERE id = ?').get(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return; const now = nowIso();
    if (outcome === 'APPROVED') {
      const ls = linesOf(r.id); if (rcOf(r)) rc.check(sysActor(r.company_id, actor.user), rcOf(r), r.org_project_id, ls.filter((l) => lineRc(l.id)).map((l) => ({ rcLineId: lineRc(l.id), qty: l.qty, basic: l.basic_amount })), { excludePoId: r.id }); const commit = commitLedger(actor, r, ls);
      db.prepare("UPDATE proc_purchase_orders SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, r.id); audit(actor, 'proc_purchase_orders', r.id, 'approve', r.company_id, { newValues: { commitment: commit?.result ?? null } });
      const fresh = db.prepare('SELECT * FROM proc_purchase_orders WHERE id = ?').get(r.id); const sent = sendToVendor(actor, fresh);
      rcTouch(fresh); evt('proc.po.approved', actor, fresh, { rcId: rcOf(r), totalAmount: rs(r.total_amount), totalBasic: rs(r.total_basic), supplyType: r.supply_type, csId: r.cs_id, commitment: commit?.result ?? null, lines: ls.map((l) => ({ lineId: l.id, lineNo: l.line_no, prLineId: l.pr_line_id, itemId: l.item_id, qty: d3(l.qty), uom: l.uom, rate: rs(l.rate), discountPct: l.discount_pct / 10000, gstPct: l.gst_pct / 10000, amount: rs(l.line_amount), deliverySiteId: l.delivery_site_id, wbsId: l.wbs_id, costCodeId: l.cost_code_id, schedule: schedOf(l.id).map((s) => ({ dueDate: s.due_date, qty: d3(s.qty) })) })) });
      notify(r.company_id, 'proc.po.approved', [`user:${r.requested_by}`], r.doc_no, r.doc_no, `${r.doc_no} is approved${sent.sendStatus === 'QUEUED' ? ' and sent to the vendor' : `; it could not be sent (${sent.sendStatus}): resend it or give the vendor the link`}.`, `/proc/purchase-orders?id=${r.id}`, r.id, { projectId: r.org_project_id }); return;
    }
    const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
    db.prepare('UPDATE proc_purchase_orders SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, now, r.id); audit(actor, 'proc_purchase_orders', r.id, outcome.toLowerCase(), r.company_id, { reason: comment }); rcTouch(r);
    if (outcome === 'REJECTED') notify(r.company_id, 'proc.po.rejected', [`user:${r.requested_by}`], r.doc_no, r.doc_no, `${r.doc_no} was not approved${comment ? `: ${comment}` : ''}.`, `/proc/purchase-orders?id=${r.id}`, r.id, { projectId: r.org_project_id });
  };

  // ---- amendments (FR-07) and the requests to short-close or cancel (FR-08) -----------------------------------------------------------------------------------------------------------------------------
  const snap = (r) => ({ terms: currentTerms(r), lines: linesOf(r.id).map((l) => ({ id: l.id, lineNo: l.line_no, description: l.description, qty: d3(l.qty), rate: rs(l.rate), discountPct: l.discount_pct / 10000, amount: rs(l.line_amount), basic: rs(l.basic_amount), schedule: schedOf(l.id).map((s) => ({ dueDate: s.due_date, qty: d3(s.qty) })) })), total: r.total_amount });
  const amRow = (actor, r, aid) => { const a = db.prepare('SELECT * FROM proc_po_amendments WHERE id = ? AND po_id = ? AND deleted_at IS NULL').get(rid(aid), r.id); if (!a) throw notFound('That amendment does not exist.'); return a; };
  const amendments = {
    /** A draft amendment: the changes are applied in memory to a copy, the lines recomputed, and the before and after kept for the comparison. */
    create(actor, id, b) {
      const r = row(actor, id, 'proc.purchase_order.amend'); if (r.status !== 'APPROVED') throw unprocessable('Only an approved order is amended.'); if (db.prepare("SELECT 1 FROM proc_po_amendments WHERE po_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.id)) throw conflict('An amendment or request on this order is open already: finish it first.');
      const before = snap(r); const ls = linesOf(r.id); const changes = []; const problems = []; const supply = r.supply_type; const tol = Number(param(r.company_id, 'proc.po.qty_tolerance_pct') ?? 5);
      const next = ls.map((l) => ({ ...l, schedule: schedOf(l.id).map((s) => ({ dueDate: s.due_date, qty: s.qty, received: s.received_qty })) }));
      for (const [i, c] of (b.lines ?? []).entries()) {
        const l = next.find((x) => x.id === c.lineId); if (!l) { problems.push({ field: `lines.${i}.lineId`, message: 'Not a line of this order' }); continue; }
        if (c.qty != null) { const q = q3(c.qty); if (q < l.received_qty + l.short_closed_qty) problems.push({ field: `lines.${i}.qty`, message: `Not below what is received (${d3(l.received_qty)})` }); if (l.pr_line_id && q > l.qty) { const pl = db.prepare('SELECT balance_qty, qty FROM proc_pr_lines WHERE id = ?').get(l.pr_line_id); if (q - l.qty > pl.balance_qty + Math.round((pl.qty * tol) / 100)) problems.push({ field: `lines.${i}.qty`, message: 'The increase is more than the balance to order of the requisition line' }); }
          if (l.cs_line_id && q > l.qty && q > csAvailable(l.cs_line_id, r.id)) problems.push({ field: `lines.${i}.qty`, message: 'More than the statement allows' }); if (q !== l.qty) changes.push({ lineNo: l.line_no, field: 'qty', before: d3(l.qty), after: d3(q) }); l.qty = q; }
        if (c.rate != null) { const rt = Math.round(c.rate * 100); if (rt !== l.rate) changes.push({ lineNo: l.line_no, field: 'rate', before: rs(l.rate), after: rs(rt) }); l.rate = rt; }
        if (c.discountPct != null) { const d = Math.round(c.discountPct * 10000); if (d !== l.discount_pct) changes.push({ lineNo: l.line_no, field: 'discount', before: l.discount_pct / 10000, after: d / 10000 }); l.discount_pct = d; }
        if (c.schedule) { const sc = c.schedule.map((s) => ({ dueDate: s.dueDate, qty: q3(s.qty), received: 0 })); if (JSON.stringify(sc.map((s) => [s.dueDate, s.qty])) !== JSON.stringify(l.schedule.map((s) => [s.dueDate, s.qty]))) changes.push({ lineNo: l.line_no, field: 'delivery dates', before: l.schedule.map((s) => `${s.dueDate}: ${d3(s.qty)}`).join('; '), after: sc.map((s) => `${s.dueDate}: ${d3(s.qty)}`).join('; ') }); l.schedule = sc; }
      }
      for (const l of next) if (l.schedule.reduce((n, s) => n + s.qty, 0) !== l.qty) { if ((b.lines ?? []).find((c) => c.lineId === l.id)?.schedule == null && l.schedule.length === 1) { l.schedule[0].qty = l.qty; } else problems.push({ field: 'lines', message: `The scheduled quantities of line ${l.line_no} add up to its quantity` }); }
      const cur = currentTerms(r); const newTerms = { ...cur, ...(b.terms ?? {}) }; for (const k of Object.keys(b.terms ?? {})) if (JSON.stringify(cur[k]) !== JSON.stringify(newTerms[k])) changes.push({ lineNo: null, field: k, before: cur[k], after: newTerms[k] });
      fail(problems); if (!changes.length) throw unprocessable('Nothing is changed.');
      let total = 0; let rateUp = false; const calc = next.map((l) => { const c = computeLine({ qty: l.qty, rate: l.rate, discountPct: l.discount_pct, gstPct: l.gst_pct, supply, freight: l.cs_line_id ? Math.round((l.freight_amount * l.qty) / Math.max(ls.find((x) => x.id === l.id).qty, 1)) : l.freight_amount }); total += c.line; if (l.rate > ls.find((x) => x.id === l.id).rate) rateUp = true; return { ...l, calc: c }; });
      const after = { terms: newTerms, lines: calc.map((l) => ({ id: l.id, lineNo: l.line_no, description: l.description, qty: d3(l.qty), rate: rs(l.rate), discountPct: l.discount_pct / 10000, amount: rs(l.calc.line), basic: rs(l.calc.basic), schedule: l.schedule.map((s) => ({ dueDate: s.dueDate, qty: d3(s.qty) })) })), total, calc: calc.map((l) => ({ id: l.id, qty: l.qty, rate: l.rate, discountPct: l.discount_pct, ...l.calc, schedule: l.schedule.map((s) => ({ dueDate: s.dueDate, qty: s.qty })) })) };
      return transaction(db, () => { const aid = Number(db.prepare("INSERT INTO proc_po_amendments (company_id, po_id, kind, amendment_no, reason, changes_json, before_json, after_json, delta_amount, new_total, rate_increase, status, requested_by, project_id, created_by, source_type) VALUES (?, ?, 'AMEND', ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 'api')").run(r.company_id, r.id, r.amendment_no + 1, b.reason, JSON.stringify(changes), JSON.stringify(before), JSON.stringify(after), total - r.total_amount, total, rateUp ? 1 : 0, actor.user, r.org_project_id, actor.user).lastInsertRowid);
        audit(actor, 'proc_po_amendments', aid, 'create', r.company_id, { reason: b.reason, newValues: { delta: rs(total - r.total_amount), changes: changes.length } }); return amendments.get(actor, r.id, aid); });
    },
    get(actor, id, aid) { const r = row(actor, id); const a = amRow(actor, r, aid); const o = amendView(actor, a); const rt = may(actor, 'proc.purchase_order.rates', r.org_project_id, r.po_site_id); o.before = rt ? json(a.before_json, null) : null; o.after = rt ? (() => { const x = json(a.after_json, null); if (x) delete x.calc; return x; })() : null; o.can = { submit: ['DRAFT', 'RETURNED'].includes(a.status) && may(actor, 'proc.purchase_order.amend', r.org_project_id, r.po_site_id), discard: ['DRAFT', 'RETURNED'].includes(a.status) && may(actor, 'proc.purchase_order.amend', r.org_project_id, r.po_site_id), withdraw: a.status === 'SUBMITTED' && same(a.requested_by, actor.user), approve: a.status === 'SUBMITTED' && !same(a.requested_by, actor.user) && may(actor, 'proc.purchase_order.approve', r.org_project_id, r.po_site_id) }; o.poId = r.id; o.poNo = r.doc_no;
      if (o.can.approve && a.workflow_instance_id) o.taskId = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === a.workflow_instance_id)?.id ?? null; return o; },
    submit(actor, id, aid) {
      const r = row(actor, id, 'proc.purchase_order.amend'); const a = amRow(actor, r, aid); if (a.kind !== 'AMEND' || !['DRAFT', 'RETURNED'].includes(a.status)) throw unprocessable('Only a draft amendment is sent for approval.'); if (r.status !== 'APPROVED') throw conflict('The order is no longer open.');
      const after = json(a.after_json, null); if (rcOf(r)) { const cur = linesOf(r.id); rc.check(actor, rcOf(r), r.org_project_id, after.calc.map((c) => { const old = cur.find((l) => l.id === c.id); return { rcLineId: lineRc(old.id), qty: Math.max(0, c.qty - old.qty), basic: Math.max(0, c.basic - old.basic_amount) }; }).filter((x) => x.rcLineId && x.qty > 0)); } const up = after.calc.filter((c) => { const l = db.prepare('SELECT cs_rate FROM proc_po_lines WHERE id = ?').get(c.id); return l.cs_rate != null && c.rate > l.cs_rate; });
      return transaction(db, () => {
        if (up.length) protocolOf(db).enforce(actor, 'CP-PROC-05', { entity: 'proc_po', entityId: String(r.id), amount: Number(rs(a.new_total)), valueAtRisk: Number(rs(Math.abs(a.delta_amount))), ref: r.doc_no, items: `${up.length} line(s)`, message: `${r.doc_no}: an amended rate is above the rate approved in the comparative statement.` });
        const delta = Math.abs(a.delta_amount); let level = levelOf(r.company_id, delta); if (a.rate_increase) level = Math.max(level, 1); const ctx = { projectId: r.org_project_id, amount: Number(rs(delta)), needPm: level >= 1 ? 'yes' : 'no', needPd: level >= 2 ? 'yes' : 'no', needDir: level >= 3 ? 'yes' : 'no', rateIncrease: a.rate_increase ? 'yes' : 'no' };
        if (a.status === 'RETURNED' && a.workflow_instance_id) workflowOf(db).resubmit(actor, a.workflow_instance_id, { comment: 'Corrected', context: ctx }); else { const inst = workflowOf(db).submit(actor, { docType: AMEND_DOC, docId: String(a.id), comment: `${r.doc_no} amendment ${a.amendment_no}: ${rs(a.delta_amount)}`.slice(0, 300), context: ctx }); db.prepare('UPDATE proc_po_amendments SET workflow_instance_id = ? WHERE id = ?').run(inst.id, a.id); }
        db.prepare("UPDATE proc_po_amendments SET status = 'SUBMITTED', requested_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), a.id); audit(actor, 'proc_po_amendments', a.id, 'submit', r.company_id, { newValues: { delta: rs(a.delta_amount), level } }); return amendments.get(actor, r.id, a.id);
      });
    },
    discard(actor, id, aid, { reason }) { const r = row(actor, id, 'proc.purchase_order.amend'); const a = amRow(actor, r, aid); if (!['DRAFT', 'RETURNED'].includes(a.status)) throw unprocessable('Only a draft amendment is discarded.'); db.prepare("UPDATE proc_po_amendments SET status = 'CANCELLED', updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), a.id); audit(actor, 'proc_po_amendments', a.id, 'discard', r.company_id, { reason }); return amendments.get(actor, r.id, a.id); },
    withdraw(actor, id, aid, { reason }) { const r = row(actor, id); const a = amRow(actor, r, aid); if (a.status !== 'SUBMITTED') throw unprocessable('Only a request waiting for approval is withdrawn.'); if (!same(a.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, a.workflow_instance_id, { comment: reason }); return amendments.get(actor, r.id, a.id); },
    /** Short-close (the rest is not wanted) or cancel (only with nothing received, BR-02): asked with a reason and approved by the procurement manager and the project manager. */
    close(actor, id, kind, { reason }) {
      const r = row(actor, id, 'proc.purchase_order.cancel'); if (r.status !== 'APPROVED') throw unprocessable('Only an approved order is short-closed or cancelled.'); if (db.prepare("SELECT 1 FROM proc_po_amendments WHERE po_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.id)) throw conflict('An amendment or request on this order is open already: finish it first.');
      const ls = linesOf(r.id); if (kind === 'CANCEL' && ls.some((l) => l.received_qty > 0)) throw conflict('Goods are received against this order: it cannot be cancelled. Short-close it instead.'); if (kind === 'SHORT_CLOSE' && !ls.some((l) => l.balance_qty > 0)) throw unprocessable('Everything is delivered already.');
      return transaction(db, () => { const aid = Number(db.prepare("INSERT INTO proc_po_amendments (company_id, po_id, kind, amendment_no, reason, status, requested_by, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 'api')").run(r.company_id, r.id, kind, r.amendment_no, reason, actor.user, r.org_project_id, actor.user).lastInsertRowid);
        const inst = workflowOf(db).submit(actor, { docType: CLOSE_DOC, docId: String(aid), comment: `${r.doc_no} ${kind === 'CANCEL' ? 'cancel' : 'short-close'}: ${reason}`.slice(0, 300), context: { projectId: r.org_project_id, amount: Number(rs(ls.reduce((n, l) => n + Math.round((l.basic_amount * l.balance_qty) / l.qty), 0))), kind } });
        db.prepare("UPDATE proc_po_amendments SET status = 'SUBMITTED', workflow_instance_id = ? WHERE id = ?").run(inst.id, aid); audit(actor, 'proc_po_amendments', aid, 'submit', r.company_id, { reason, newValues: { kind } }); return amendments.get(actor, r.id, aid); });
    },
    decide(instance, actor, outcome, comment) {
      const a = db.prepare('SELECT * FROM proc_po_amendments WHERE id = ?').get(rid(instance.docId)); if (!a || a.status !== 'SUBMITTED') return; const r = db.prepare('SELECT * FROM proc_purchase_orders WHERE id = ?').get(a.po_id); const now = nowIso();
      if (outcome !== 'APPROVED') { const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED'; db.prepare('UPDATE proc_po_amendments SET status = ?, workflow_instance_id = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : a.workflow_instance_id, now, a.id); audit(actor, 'proc_po_amendments', a.id, outcome.toLowerCase(), r.company_id, { reason: comment }); return; }
      const ls = linesOf(r.id);
      if (a.kind === 'AMEND') {
        const after = json(a.after_json, null); const delta = [];
        for (const c of after.calc) { const old = ls.find((l) => l.id === c.id); db.prepare('UPDATE proc_po_lines SET qty = ?, rate = ?, discount_pct = ?, basic_amount = ?, freight_amount = ?, cgst_amount = ?, sgst_amount = ?, igst_amount = ?, tax_amount = ?, line_amount = ?, balance_qty = ? , updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(c.qty, c.rate, c.discountPct, c.basic, c.freight, c.cgst, c.sgst, c.igst, c.tax, c.line, Math.max(0, c.qty - old.received_qty - old.short_closed_qty), actor.user, now, c.id);
          db.prepare('UPDATE proc_po_schedules SET deleted_at = ?, is_active = 0 WHERE po_line_id = ? AND deleted_at IS NULL').run(now, c.id); for (const s of c.schedule) db.prepare("INSERT INTO proc_po_schedules (company_id, po_id, po_line_id, due_date, qty, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'amendment')").run(r.company_id, r.id, c.id, s.dueDate, s.qty, r.org_project_id, actor.user);
          if (old.pr_line_id && c.qty !== old.qty) delta.push({ prLineId: old.pr_line_id, qty: d3(c.qty - old.qty) }); }
        // received quantities are laid on the new schedule again, oldest first
        for (const c of after.calc) allocateReceipts(c.id);
        const t = headerTerms(after.terms); const tot = after.calc.reduce((n, c) => ({ basic: n.basic + c.basic, freight: n.freight + c.freight, tax: n.tax + c.tax }), { basic: 0, freight: 0, tax: 0 });
        db.prepare(`UPDATE proc_purchase_orders SET ${Object.keys(t).map((k) => `${k} = ?`).join(', ')}, total_basic = ?, total_freight = ?, total_tax = ?, total_amount = ?, amendment_no = ?, acknowledged_at = NULL, acknowledged_by = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...Object.values(t), tot.basic, tot.freight, tot.tax, tot.basic + tot.freight + tot.tax, a.amendment_no, actor.user, now, r.id);
        db.prepare("UPDATE proc_po_amendments SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, now, a.id);
        const fresh = db.prepare('SELECT * FROM proc_purchase_orders WHERE id = ?').get(r.id); const commit = commitLedger(actor, fresh, linesOf(r.id)); audit(actor, 'proc_po_amendments', a.id, 'approve', r.company_id, { newValues: { delta: rs(a.delta_amount), commitment: commit?.result ?? null } }); sendToVendor(actor, fresh, 'amended'); rcTouch(fresh);
        evt('proc.po.amended', actor, fresh, { amendmentNo: a.amendment_no, deltaAmount: rs(a.delta_amount), totalAmount: rs(fresh.total_amount), reason: a.reason, lines: delta }); notify(r.company_id, 'proc.po.approved', [`user:${a.requested_by}`], r.doc_no, r.doc_no, `Amendment ${a.amendment_no} of ${r.doc_no} is approved and sent to the vendor.`, `/proc/purchase-orders?id=${r.id}`, `${a.id}.a`, { projectId: r.org_project_id }); return;
      }
      if (a.kind === 'CANCEL' && ls.some((l) => l.received_qty > 0)) { db.prepare("UPDATE proc_po_amendments SET status = 'REJECTED', updated_at = ?, version = version + 1 WHERE id = ?").run(now, a.id); audit(actor, 'proc_po_amendments', a.id, 'rejected', r.company_id, { reason: 'Goods were received meanwhile' }); return; }
      if (a.kind === 'SHORT_CLOSE') {
        for (const l of ls) db.prepare('UPDATE proc_po_lines SET short_closed_qty = short_closed_qty + balance_qty, balance_qty = 0, updated_at = ?, version = version + 1 WHERE id = ?').run(now, l.id);
        db.prepare("UPDATE proc_purchase_orders SET status = 'CLOSED', close_reason = ?, closed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(a.reason, now, actor.user, now, r.id); releaseLedger(actor, r, false, `${r.doc_no} short-closed: ${a.reason}`);
        evt('proc.po.closed', actor, r, { reason: a.reason, shortClosed: ls.map((l) => ({ lineId: l.id, qty: d3(l.balance_qty) })) }); rcTouch(r);
      } else {
        db.prepare('UPDATE proc_po_lines SET balance_qty = 0, updated_at = ?, version = version + 1 WHERE po_id = ? AND deleted_at IS NULL').run(now, r.id); db.prepare("UPDATE proc_purchase_orders SET status = 'CANCELLED', cancel_reason = ?, ack_expires = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(a.reason, now, actor.user, now, r.id); releaseLedger(actor, r, true, `${r.doc_no} cancelled: ${a.reason}`);
        evt('proc.po.cancelled', actor, r, { reason: a.reason, lines: prDeltas(ls, -1) }); rcTouch(r);
      }
      db.prepare("UPDATE proc_po_amendments SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, now, a.id); audit(actor, 'proc_po_amendments', a.id, 'approve', r.company_id, { reason: a.reason });
      notify(r.company_id, 'proc.po.approved', [`user:${a.requested_by}`], r.doc_no, r.doc_no, `${r.doc_no} is ${a.kind === 'CANCEL' ? 'cancelled' : 'short-closed'}: the commitment is released.`, `/proc/purchase-orders?id=${r.id}`, `${a.id}.c`, { projectId: r.org_project_id });
    },
  };

  // ---- goods received (until the stock module posts them): delivery status, schedule, performance (FR-09) ---------------------------------------------------------------------------------------------------------
  function allocateReceipts(lineId) {
    const l = db.prepare('SELECT received_qty FROM proc_po_lines WHERE id = ?').get(lineId); let left = l.received_qty; for (const s of schedOf(lineId)) { const q = Math.min(left, s.qty); db.prepare('UPDATE proc_po_schedules SET received_qty = ? WHERE id = ?').run(q, s.id); left -= q; }
  }
  const receipts = {
    ingest(actor, { receipts: rows }, { system = false } = {}) {
      if (!system) need(actor, 'proc.purchase_order.receipts', 'post receipts'); const problems = []; const out = { posted: 0, duplicates: 0 };
      rows.forEach((x, i) => { const l = db.prepare('SELECT l.*, p.status AS pstatus, p.company_id AS cid FROM proc_po_lines l JOIN proc_purchase_orders p ON p.id = l.po_id WHERE l.id = ? AND l.deleted_at IS NULL').get(x.poLineId); if (!l || l.cid !== actor.companyId) { problems.push({ field: `receipts.${i}.poLineId`, message: 'Not a line of an order of this company' }); return; } if (l.pstatus !== 'APPROVED') problems.push({ field: `receipts.${i}.poLineId`, message: 'The order is not open' }); const tol = Number(param(actor.companyId, 'proc.po.qty_tolerance_pct') ?? 5); if (l.received_qty + q3(x.qty) > l.qty + Math.round((l.qty * tol) / 100)) problems.push({ field: `receipts.${i}.qty`, message: 'More than the order quantity and tolerance' }); if (x.acceptedQty > x.qty) problems.push({ field: `receipts.${i}.acceptedQty`, message: 'Accepted is not more than received' }); });
      fail(problems);
      return transaction(db, () => { const touched = new Set();
        for (const x of rows) { const l = db.prepare('SELECT * FROM proc_po_lines WHERE id = ?').get(x.poLineId); if (db.prepare('SELECT 1 FROM proc_po_receipts WHERE company_id = ? AND grn_ref = ? AND po_line_id = ? AND deleted_at IS NULL').get(actor.companyId, x.grnRef, l.id)) { out.duplicates += 1; continue; }
          const first = schedOf(l.id).find((s) => s.received_qty < s.qty); const onTime = !first || x.receivedOn <= first.due_date ? 1 : 0; const q = q3(x.qty); const acc = x.acceptedQty == null ? q : q3(x.acceptedQty);
          db.prepare("INSERT INTO proc_po_receipts (company_id, po_id, po_line_id, grn_ref, received_on, qty, accepted_qty, on_time, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ingest')").run(actor.companyId, l.po_id, l.id, x.grnRef, x.receivedOn, q, acc, onTime, null, actor.user);
          db.prepare('UPDATE proc_po_lines SET received_qty = received_qty + ?, accepted_qty = accepted_qty + ?, balance_qty = MAX(0, qty - short_closed_qty - received_qty - ?), updated_at = ?, version = version + 1 WHERE id = ?').run(q, acc, q, nowIso(), l.id); allocateReceipts(l.id); touched.add(l.po_id); out.posted += 1; }
        for (const pid of touched) { const r = db.prepare('SELECT * FROM proc_purchase_orders WHERE id = ?').get(pid); const ls = linesOf(pid);
          for (const d of db.prepare("SELECT * FROM proc_dispatches WHERE po_id = ? AND status = 'DISPATCHED' AND deleted_at IS NULL").all(pid)) if (json(d.lines_json, []).every((y) => { const l = ls.find((z) => z.id === y.poLineId); return l && l.received_qty >= q3(y.qty); })) db.prepare("UPDATE proc_dispatches SET status = 'RECEIVED', updated_at = ? WHERE id = ?").run(nowIso(), d.id);
          evt('proc.po.received', actor, r, { lines: ls.map((l) => ({ lineId: l.id, receivedQty: d3(l.received_qty), acceptedQty: d3(l.accepted_qty), balanceQty: d3(l.balance_qty) })) });
          if (ls.every((l) => l.balance_qty === 0)) { const now = nowIso(); db.prepare("UPDATE proc_purchase_orders SET status = 'CLOSED', close_reason = 'Delivered in full', closed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(now, now, pid); releaseLedger(actor, r, false, `${r.doc_no} delivered in full`); evt('proc.po.closed', actor, r, { reason: 'Delivered in full' }); rcTouch(r); } }
        audit(actor, 'proc_po_receipts', 0, 'ingest', actor.companyId, { newValues: out }); return out; });
    },
    /** FR-09: for each vendor, the share of receipts on time, of the ordered quantity delivered, and of the received quantity accepted. */
    performance(actor, query = {}) {
      if (!authz.check(actor, 'proc.purchase_order.view').allowed) throw forbidden('You may not see purchase orders (permission proc.purchase_order.view).'); const sc = scope(actor);
      const rows = db.prepare(`SELECT x.vendor_id, COUNT(DISTINCT x.id) AS orders, SUM(t.on_time) AS on_time, COUNT(t.id) AS grns, SUM(t.qty) AS received, SUM(t.accepted_qty) AS accepted FROM proc_purchase_orders x JOIN proc_po_receipts t ON t.po_id = x.id AND t.deleted_at IS NULL WHERE ${sc.sql} AND x.deleted_at IS NULL ${query.vendorId ? 'AND x.vendor_id = :v' : ''} GROUP BY x.vendor_id ORDER BY x.vendor_id`).all({ ...sc.params, ...(query.vendorId ? { v: query.vendorId } : {}) });
      return rows.map((v) => { const ord = db.prepare(`SELECT COALESCE(SUM(l.qty - l.short_closed_qty), 0) AS q FROM proc_po_lines l JOIN proc_purchase_orders x ON x.id = l.po_id WHERE ${sc.sql} AND x.vendor_id = :v AND x.status IN ('APPROVED', 'CLOSED') AND l.deleted_at IS NULL`).get({ ...sc.params, v: v.vendor_id }).q; const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null); return { vendorId: v.vendor_id, ...vname(v.vendor_id), orders: v.orders, receipts: v.grns, onTimePct: pct(v.on_time, v.grns), quantityPct: pct(Math.min(v.received, ord), ord), qualityPct: pct(v.accepted, v.received) }; });
    },
  };

  // ---- sending again, the tracker, the sweep, advances ------------------------------------------------------------------------------------------------------------------------------------------------------
  const extra = {
    resend(actor, id) { const r = row(actor, id, 'proc.purchase_order.release'); if (r.status !== 'APPROVED') throw unprocessable('Only an approved order is sent to the vendor.'); const out = sendToVendor(actor, r, r.amendment_no ? 'amended' : 'new'); audit(actor, 'proc_purchase_orders', r.id, 'resend', r.company_id, { newValues: { status: out.sendStatus } }); return { ...out, po: pos.get(actor, r.id) }; },
    dispatch(actor, id, b) { const r = row(actor, id, 'proc.purchase_order.dispatch'); if (r.status !== 'APPROVED') throw unprocessable('Dispatches are recorded against an approved order.'); return { ...dispatchPo(actor.user, r, b, 'BUYER'), po: pos.get(actor, r.id) }; },
    /** FR-06: the open schedule lines by due date with the days overdue. */
    tracker(actor, q = {}) {
      if (!authz.check(actor, 'proc.purchase_order.view').allowed) throw forbidden('You may not see purchase orders (permission proc.purchase_order.view).'); const sc = scope(actor); const today = todayIST();
      const rows = db.prepare(`SELECT x.id AS po_id, x.doc_no, x.org_project_id, x.po_site_id, x.vendor_id, p.code AS pcode, l.id AS line_id, l.line_no, l.description, l.uom, s.due_date, s.qty, s.received_qty, x.acknowledged_at FROM proc_po_schedules s JOIN proc_po_lines l ON l.id = s.po_line_id JOIN proc_purchase_orders x ON x.id = s.po_id JOIN org_projects p ON p.id = x.org_project_id WHERE ${sc.sql} AND x.status = 'APPROVED' AND x.deleted_at IS NULL AND l.deleted_at IS NULL AND s.deleted_at IS NULL AND s.received_qty < s.qty ${q.projectId ? 'AND x.org_project_id = :p' : ''} ${q.vendorId ? 'AND x.vendor_id = :v' : ''} ORDER BY s.due_date, x.id, l.line_no LIMIT 1000`).all({ ...sc.params, ...(q.projectId ? { p: q.projectId } : {}), ...(q.vendorId ? { v: q.vendorId } : {}) });
      const data = rows.map((x) => { const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${x.due_date}T00:00:00Z`)) / 86_400_000); return { poId: x.po_id, docNo: x.doc_no, project: x.pcode, projectId: x.org_project_id, vendor: vname(x.vendor_id).name, vendorId: x.vendor_id, lineNo: x.line_no, description: x.description, uom: x.uom, dueDate: x.due_date, qty: d3(x.qty), receivedQty: d3(x.received_qty), balanceQty: d3(x.qty - x.received_qty), daysOverdue: Math.max(0, days), overdue: days > 0, acknowledged: Boolean(x.acknowledged_at) }; }).filter((x) => !q.overdueOnly || x.overdue);
      return { rows: data, summary: { open: data.length, overdue: data.filter((x) => x.overdue).length, orders: new Set(data.map((x) => x.poId)).size, unacknowledged: new Set(data.filter((x) => !x.acknowledged).map((x) => x.poId)).size } };
    },
    /** FR-06: the buyer is told, once a day, of an order that has a delivery past its date. */
    sweep() {
      let n = 0; const today = todayIST();
      for (const r of db.prepare("SELECT * FROM proc_purchase_orders WHERE status = 'APPROVED' AND deleted_at IS NULL AND COALESCE(overdue_notified_on, '') <> ?").all(today)) {
        const late = db.prepare('SELECT s.due_date, s.qty - s.received_qty AS bal, l.line_no FROM proc_po_schedules s JOIN proc_po_lines l ON l.id = s.po_line_id WHERE s.po_id = ? AND s.deleted_at IS NULL AND l.deleted_at IS NULL AND s.due_date < ? AND s.received_qty < s.qty').all(r.id, today); if (!late.length) continue;
        db.prepare('UPDATE proc_purchase_orders SET overdue_notified_on = ? WHERE id = ?').run(today, r.id); evt('proc.po.overdue', null, r, { lines: late.map((x) => ({ lineNo: x.line_no, dueDate: x.due_date, balanceQty: d3(x.bal) })) });
        notify(r.company_id, 'proc.po.overdue', [`user:${r.requested_by}`], r.doc_no, vname(r.vendor_id).name, `${late.length} delivery(ies) of ${r.doc_no} are past their date (the oldest ${late.map((x) => x.due_date).sort()[0]}).`, '/proc/po-tracker', `${r.id}.${today}`, { projectId: r.org_project_id }); n += 1;
      }
      return n;
    },
    advanceRequest(actor, id, b) {
      const r = row(actor, id, 'proc.purchase_order.advance'); if (r.status !== 'APPROVED') throw unprocessable('An advance is asked against an approved order.'); if (r.advance_pct <= 0) throw unprocessable('The terms of this order have no advance: amend the payment terms first.');
      const cap = Math.round((r.total_amount * r.advance_pct) / 1_000_000); const asked = db.prepare("SELECT COALESCE(SUM(advance_amount), 0) AS n FROM proc_po_advances WHERE po_id = ? AND status IN ('SUBMITTED', 'APPROVED') AND deleted_at IS NULL").get(r.id).n; const amount = Math.round(b.amount * 100);
      if (asked + amount > cap) fail([{ field: 'amount', message: `More than the advance of the terms (${r.advance_pct / 10000}% = ${rs(cap)}; ${rs(asked)} already asked)` }]);
      return transaction(db, () => { const no = number(r.company_id, actor.user, 'PROC_ADVANCE', 'proc_po_advances', 'ADV'); const aid = Number(db.prepare("INSERT INTO proc_po_advances (company_id, po_id, doc_no, advance_amount, needed_by, reason, status, requested_by, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 'api')").run(r.company_id, r.id, no, amount, b.neededBy ?? null, b.reason, actor.user, r.org_project_id, actor.user).lastInsertRowid);
        const inst = workflowOf(db).submit(actor, { docType: ADV_DOC, docId: String(aid), comment: `${no} against ${r.doc_no}: ${rs(amount)}`.slice(0, 300), context: { projectId: r.org_project_id, amount: Number(rs(amount)) } }); db.prepare("UPDATE proc_po_advances SET status = 'SUBMITTED', workflow_instance_id = ? WHERE id = ?").run(inst.id, aid); audit(actor, 'proc_po_advances', aid, 'submit', r.company_id, { newValues: { amount: rs(amount) } }); return pos.get(actor, r.id); });
    },
    advanceDecide(instance, actor, outcome, comment) {
      const a = db.prepare('SELECT * FROM proc_po_advances WHERE id = ?').get(rid(instance.docId)); if (!a || a.status !== 'SUBMITTED') return; const r = db.prepare('SELECT * FROM proc_purchase_orders WHERE id = ?').get(a.po_id); const now = nowIso(); const to = outcome === 'APPROVED' ? 'APPROVED' : outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : 'CANCELLED';
      db.prepare('UPDATE proc_po_advances SET status = ?, approved_by = ?, approved_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, outcome === 'APPROVED' ? actor.user : null, outcome === 'APPROVED' ? now : null, now, a.id); audit(actor, 'proc_po_advances', a.id, outcome.toLowerCase(), r.company_id, { reason: comment });
      if (outcome === 'APPROVED') evt('proc.po.advance_approved', actor, r, { advanceId: a.id, advanceNo: a.doc_no, amount: rs(a.advance_amount), neededBy: a.needed_by, vendorName: vname(r.vendor_id).name });
      notify(r.company_id, 'proc.po.advance_decided', [`user:${a.requested_by}`], a.doc_no, r.doc_no, `The advance ${a.doc_no} against ${r.doc_no} is ${to.toLowerCase()}${comment ? `: ${comment}` : ''}.`, `/proc/purchase-orders?id=${r.id}`, a.id, { projectId: r.org_project_id });
    },
  };
  /** The adapter for the vendor invoices (22.06): the quantity invoiced against a line of the order only goes up (an invoice approved) or down (an invoice cancelled after approval) and never beyond the quantity accepted. */
  const invoicing = {
    record(companyId, { poLineId, deltaTh }) {
      const l = db.prepare('SELECT l.*, p.company_id AS cid FROM proc_po_lines l JOIN proc_purchase_orders p ON p.id = l.po_id WHERE l.id = ? AND l.deleted_at IS NULL').get(Number(poLineId)); if (!l || l.cid !== companyId) throw notFound('That order line does not exist.');
      const next = l.invoiced_qty + deltaTh; if (next < 0) throw unprocessable(`Line ${l.line_no}: the invoiced quantity cannot go below zero.`); if (next > l.qty) throw unprocessable(`Line ${l.line_no}: the invoiced quantity ${next / 1000} is beyond the ordered ${l.qty / 1000}.`);
      db.prepare('UPDATE proc_po_lines SET invoiced_qty = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(next, new Date().toISOString(), l.id); return { lineId: l.id, invoicedQty: next };
    },
  };
  return { pos, amendments, invoicing, receipts, portal, supplier, extra, decide: pos.decide, amendDecide: amendments.decide, advanceDecide: extra.advanceDecide, computeLine };
}
