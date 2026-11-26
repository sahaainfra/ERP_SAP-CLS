import { transaction } from '../../platform/db/index.js';
import { toPdf } from '../../platform/export/index.js';
import { conflict, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { daysBetween, todayIST } from '../../../shared/dates.js';
import { nowIso, rid } from '../proc/base.js';
import { procOf } from '../proc/index.js';
import { qaHelpers } from '../qa/common.js';
import { STATUS, createFlow } from '../qa/flow.js';
import { fyOf } from './invoice.js';
import { statutoryResolver } from '../mdm/statutory.js';

// Vendor invoices and the match (part 22.06): an invoice is registered against a purchase order (three-way: order, goods received, invoice), a service entry of a service order or a hire bill (two-way); a duplicate (vendor, invoice number, financial year) is refused; the quantity (invoice <= accepted by the stores less returned less already invoiced), the rate (invoice <= order rate within the tolerance), the tax (expected against invoiced) and the total are checked on the server at save and at submit; an exception blocks payment until it is resolved (debit note, order amendment, rejection) or overridden through the approval chain.
// Quantities x1000, rates and money in paise, percentages x10000.
for (const [key, type, def, description, min, max] of [
  ['bill.vinv.qty_tol_pct', 'decimal', 2, 'How far (in percent) an invoice quantity may exceed the quantity accepted and not yet invoiced before it is an exception (part 22.06 BR-01).', 0, 100],
  ['bill.vinv.rate_tol_pct', 'decimal', 1, 'How far (in percent) an invoice rate may exceed the rate of the order before it is an exception (part 22.06 BR-01).', 0, 100],
  ['bill.vinv.abs_tol_paise', 'integer', 100, 'The absolute tolerance, in paise, for the tax and the total of an invoice (part 22.06 BR-01).', 0, 100_000_000],
  ['bill.vinv.cfo_threshold_paise', 'integer', 10_000_000, 'A variance above this amount, in paise (₹ 1 lakh), is also approved by the CFO (part 22.06 workflow).', 0, 100_000_000_000]]) {
  if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType: type, default: def, scopes: ['system', 'company'], description, min, max });
}
export const MATCH = { NOT_MATCHED: 'Not matched', MATCHED: 'Matched', EXCEPTION: 'Exception', RESOLVED: 'Exception resolved', OVERRIDDEN: 'Approved over an exception' };
export const KIND = { PO: 'Purchase order invoice', SERVICE: 'Service invoice', HIRE: 'Hire invoice' };
export const EXCEPTION = { NO_GRN: 'No goods received', GST_RATE_OF_DATE: 'GST rate not in force on the invoice date', QTY_OVER: 'Quantity beyond the goods received', RATE_OVER: 'Rate beyond the order', TAX_MISMATCH: 'Tax differs', TOTAL_MISMATCH: 'Total differs', AMOUNT_OVER: 'Amount beyond the service entry or hire bill', GSTIN_MISMATCH: 'GSTIN differs' };
const rs = (p) => (p == null ? null : p / 100); const paise = (r) => Math.round(Number(r) * 100); const d3 = (t) => (t == null ? null : t / 1000); const q3 = (x) => Math.round(Number(x) * 1000);
const lineAmounts = (qtyTh, rate, bp) => { const taxable = Math.round((qtyTh * rate) / 1000); const tax = Math.round((taxable * bp) / 10000); return { taxable, tax, amount: taxable + tax }; };
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const ACTIVE = "('SUBMITTED', 'APPROVED')";

export const viList = defineList({ code: 'bill.vendor_invoices', label: 'Vendor invoices', permission: 'bill.vendor_invoice.view', from: 'bill_vendor_invoices x JOIN org_projects p ON p.id = x.org_project_id JOIN mdm_partners v ON v.id = x.vendor_id', where: "x.deleted_at IS NULL AND x.status <> 'CANCELLED'", searchable: ['x.doc_no', 'x.invoice_no', 'v.legal_name', 'p.code', 'x.vendor_gstin'], defaultSort: '-created',
  columns: { created: { sql: 'x.id', type: 'number', label: 'Entered' }, docNo: { sql: 'x.doc_no', type: 'text', label: 'Document' }, invoiceNo: { sql: 'x.invoice_no', type: 'text', label: 'Invoice' }, vendor: { sql: 'v.legal_name', type: 'text', label: 'Vendor' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, kind: { sql: 'x.invoice_kind', type: 'enum', label: 'Kind', options: Object.entries(KIND) }, invoiceDate: { sql: 'x.invoice_date', type: 'date', label: 'Date' }, total: { sql: '(x.total_paise / 100.0)', type: 'number', label: 'Total' }, match: { sql: 'x.match_status', type: 'enum', label: 'Match', options: Object.entries(MATCH) }, blocked: { sql: 'x.blocked', type: 'number', label: 'Blocked' }, status: { sql: 'x.status', type: 'enum', label: 'Approval', options: Object.entries(STATUS) } } });

export function createVinvService({ db, base, flags = null }) {
  const { audit, fail, may, param } = base; const { evt, gate, scopeOf, pcode, projectOk } = qaHelpers({ db, base }); const today = () => todayIST(); const num = (c, k) => Number(param(c, k) ?? 0); const po = () => procOf(db)?.poSvc;
  const vendorName = (id) => db.prepare('SELECT legal_name FROM mdm_partners WHERE id = ?').get(id)?.legal_name ?? null;
  /** The source document of the invoice, checked to be of this vendor and company. */
  function sourceOf(companyId, b) {
    if (b.invoiceKind === 'PO') { const p = db.prepare('SELECT * FROM proc_purchase_orders WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(b.poId ?? 0), companyId); if (!p) fail([{ field: 'poId', message: 'Choose a purchase order' }]); if (p.vendor_id !== b.vendorId) fail([{ field: 'poId', message: 'Not a purchase order of this vendor' }]); if (!['APPROVED', 'CLOSED'].includes(p.status)) fail([{ field: 'poId', message: 'The purchase order is not approved' }]); return { po: p, projectId: p.org_project_id }; }
    if (b.invoiceKind === 'SERVICE') { const se = db.prepare("SELECT e.*, o.vendor_id AS vid FROM proc_service_entries e JOIN proc_service_orders o ON o.id = e.so_id WHERE e.id = ? AND e.company_id = ? AND e.deleted_at IS NULL").get(rid(b.serviceEntryId ?? 0), companyId); if (!se) fail([{ field: 'serviceEntryId', message: 'Choose a service entry' }]); if (se.vid !== b.vendorId) fail([{ field: 'serviceEntryId', message: 'Not a service entry of this vendor' }]); if (se.status !== 'APPROVED') fail([{ field: 'serviceEntryId', message: 'The service entry is not approved' }]); return { se, projectId: se.org_project_id }; }
    const hb = db.prepare('SELECT h.*, a.partner_id AS pid, a.org_project_id AS apid FROM plt_hire_bills h JOIN plt_hire_agreements a ON a.id = h.agreement_id WHERE h.id = ? AND h.company_id = ? AND h.deleted_at IS NULL').get(rid(b.hireBillId ?? 0), companyId); if (!hb) fail([{ field: 'hireBillId', message: 'Choose a hire bill' }]); if (hb.pid !== b.vendorId) fail([{ field: 'hireBillId', message: 'Not a hire bill of this vendor' }]); if (hb.status !== 'APPROVED') fail([{ field: 'hireBillId', message: 'The hire bill is not approved' }]); return { hb, projectId: hb.apid ?? null };
  }
  const grnQty = (poLineId) => db.prepare("SELECT COALESCE(SUM(l.accepted_qty - l.returned_qty), 0) AS s FROM inv_grn_lines l JOIN inv_grns g ON g.id = l.grn_id WHERE l.po_line_id = ? AND g.status = 'APPROVED' AND g.deleted_at IS NULL AND l.deleted_at IS NULL").get(poLineId).s;
  const invoicedBefore = (poLineId, exceptId) => db.prepare(`SELECT COALESCE(SUM(l.qty_th), 0) AS s FROM bill_vendor_invoice_lines l JOIN bill_vendor_invoices i ON i.id = l.invoice_id WHERE l.po_line_id = ? AND i.id <> ? AND i.deleted_at IS NULL AND i.status IN ${ACTIVE}`).get(poLineId, exceptId).s;
  /** The lines, worked out on the server, and the whole match against the order and the goods received (or the service entry or hire bill). */
  function evaluate({ companyId, header, lines, invoiceId = 0 }) {
    const qtyTol = num(companyId, 'bill.vinv.qty_tol_pct'); const rateTol = num(companyId, 'bill.vinv.rate_tol_pct'); const abs = num(companyId, 'bill.vinv.abs_tol_paise'); const exceptions = []; const out = []; let variance = 0; let price = false; const add = (code, message, lineNo = null) => exceptions.push({ code, message, lineNo });
    const src = sourceOf(companyId, header); const takenHere = new Map(); // quantity of each order line taken by the earlier lines of this invoice
    for (const [i, l] of lines.entries()) {
      const a = lineAmounts(q3(l.qty), paise(l.rate), Math.round(l.gstPct * 100)); const r = { line_no: i + 1, po_line_id: l.poLineId ?? null, item_id: null, description: l.description ?? '', uom: l.uom ?? null, hsn: l.hsn ?? null, qty_th: q3(l.qty), rate_paise: paise(l.rate), gst_pct_bp: Math.round(l.gstPct * 100), taxable_paise: a.taxable, tax_paise: a.tax, amount_paise: a.amount, grn_qty_th: null, invoiced_before_th: null, po_rate_paise: null, match_result: 'OK', notes: [] };
      if (header.invoiceKind === 'PO') {
        const pl = db.prepare('SELECT * FROM proc_po_lines WHERE id = ? AND po_id = ? AND deleted_at IS NULL').get(rid(l.poLineId ?? 0), src.po.id); if (!pl) fail([{ field: `lines.${i}.poLineId`, message: 'Not a line of this purchase order' }]);
        r.item_id = pl.item_id; r.description = r.description || `Line ${pl.line_no}`; r.uom = r.uom ?? pl.uom; const grn = grnQty(pl.id); const before = invoicedBefore(pl.id, invoiceId) + (takenHere.get(pl.id) ?? 0); const allowed = Math.max(0, grn - before); takenHere.set(pl.id, (takenHere.get(pl.id) ?? 0) + r.qty_th); const poRate = Math.round(pl.rate * (1 - (pl.discount_pct ?? 0) / 1_000_000)); r.grn_qty_th = grn; r.invoiced_before_th = before; r.po_rate_paise = poRate;
        if (grn === 0) { add('NO_GRN', `Line ${pl.line_no}: no goods are received and accepted against it`, r.line_no); r.notes.push('NO_GRN'); variance += a.amount; }
        else if (r.qty_th > allowed + Math.floor((allowed * qtyTol) / 100)) { const over = r.qty_th - allowed; add('QTY_OVER', `Line ${pl.line_no}: invoiced ${d3(r.qty_th)} but only ${d3(allowed)} is accepted and not yet invoiced`, r.line_no); r.notes.push('QTY_OVER'); variance += Math.round((over * Math.min(r.rate_paise, poRate)) / 1000); }
        if (r.rate_paise > poRate + Math.floor((poRate * rateTol) / 100)) { add('RATE_OVER', `Line ${pl.line_no}: rate ${rs(r.rate_paise)} is beyond the order rate ${rs(poRate)}${pl.discount_pct ? ` (after its ${pl.discount_pct / 10000}% discount)` : ''}`, r.line_no); r.notes.push('RATE_OVER'); price = true; variance += Math.round(((r.rate_paise - poRate) * Math.min(r.qty_th, Math.max(allowed, 0))) / 1000); }
        const expected = Math.round((a.taxable * pl.gst_pct) / 1_000_000); if (Math.abs(a.tax - expected) > abs) { add('TAX_MISMATCH', `Line ${pl.line_no}: tax ${rs(a.tax)} against the expected ${rs(expected)} (${pl.gst_pct / 10000}%)`, r.line_no); r.notes.push('TAX_MISMATCH'); price = true; variance += Math.abs(a.tax - expected); }
      }
      if (flags?.isOn({ companyId }, 'ff.mdm.p16608')) { // part 166.8 (T-01): the GST rate of the line's HSN/SAC on the invoice date (time of supply), from the master
        const hsn = r.hsn ?? (r.item_id ? db.prepare('SELECT hsn_sac_code FROM mdm_items WHERE id = ?').get(r.item_id)?.hsn_sac_code : null);
        const g = hsn ? statutoryResolver(db).gst(companyId, { hsn, date: header.invoiceDate }) : null;
        if (g && Math.round(g.pct * 100) !== r.gst_pct_bp) { add('GST_RATE_OF_DATE', `Line ${r.line_no}: GST ${r.gst_pct_bp / 100}% but HSN ${hsn} is at ${g.pct}% on ${header.invoiceDate} (${g.rateCode} from ${g.hsnFrom})`, r.line_no); r.notes.push('GST_RATE_OF_DATE'); price = true; }
      }
      if (r.notes.length) r.match_result = 'EXCEPTION'; out.push(r);
    }
    const taxable = out.reduce((n, x) => n + x.taxable_paise, 0); const tax = out.reduce((n, x) => n + x.tax_paise, 0); const total = taxable + tax; let dueBase = header.invoiceDate; let credit = 0;
    if (header.invoiceKind === 'PO') { credit = src.po.credit_days ?? 0; const gs = src.po.vendor_gstin; if (gs && header.vendorGstin && gs !== header.vendorGstin) add('GSTIN_MISMATCH', `The GSTIN ${header.vendorGstin} is not the ${gs} of the order`); }
    else if (header.invoiceKind === 'SERVICE') { const before = db.prepare(`SELECT COALESCE(SUM(taxable_paise), 0) AS s FROM bill_vendor_invoices WHERE service_entry_id = ? AND id <> ? AND deleted_at IS NULL AND status IN ${ACTIVE}`).get(src.se.id, invoiceId).s; const allowed = src.se.entry_amount - before; if (taxable > allowed + Math.floor((allowed * rateTol) / 100) + abs) { add('AMOUNT_OVER', `Invoiced ${rs(taxable)} but the service entry allows ${rs(Math.max(0, allowed))}`); variance += taxable - Math.max(0, allowed); price = true; } }
    else { const before = db.prepare(`SELECT COALESCE(SUM(taxable_paise), 0) AS s FROM bill_vendor_invoices WHERE hire_bill_id = ? AND id <> ? AND deleted_at IS NULL AND status IN ${ACTIVE}`).get(src.hb.id, invoiceId).s; const allowed = src.hb.hire_amount + src.hb.mob_amount - before; if (taxable > allowed + Math.floor((allowed * rateTol) / 100) + abs) { add('AMOUNT_OVER', `Invoiced ${rs(taxable)} but the hire bill allows ${rs(Math.max(0, allowed))}`); variance += taxable - Math.max(0, allowed); price = true; } if (Math.abs(tax - src.hb.gst_amount) > abs) { add('TAX_MISMATCH', `Tax ${rs(tax)} against the ${rs(src.hb.gst_amount)} of the hire bill`); price = true; variance += Math.abs(tax - src.hb.gst_amount); } }
    if (header.vendorGstin) { const have = db.prepare("SELECT gstin FROM mdm_partner_gstins WHERE partner_id = ? AND gstin_status = 'ACTIVE' AND deleted_at IS NULL").all(header.vendorId).map((g) => g.gstin); if (have.length && !have.includes(header.vendorGstin) && !exceptions.some((e) => e.code === 'GSTIN_MISMATCH')) add('GSTIN_MISMATCH', `The GSTIN ${header.vendorGstin} is not one of the vendor's GSTINs`); }
    if (header.declaredTotal != null && Math.abs(paise(header.declaredTotal) - total) > abs) { add('TOTAL_MISMATCH', `The total on the invoice ${header.declaredTotal} differs from the lines ${rs(total)}`); variance += Math.abs(paise(header.declaredTotal) - total); }
    return { lines: out, taxable, tax, total, exceptions, variance, price, projectId: src.projectId, dueDate: addDays(dueBase, credit), match: exceptions.length ? 'EXCEPTION' : 'MATCHED' };
  }
  const headerOf = (r) => ({ invoiceKind: r.invoice_kind, vendorId: r.vendor_id, poId: r.po_id, serviceEntryId: r.service_entry_id, hireBillId: r.hire_bill_id, vendorGstin: r.vendor_gstin, invoiceDate: r.invoice_date, declaredTotal: r.declared_total_paise == null ? null : rs(r.declared_total_paise) });
  const linesOf = (id) => db.prepare('SELECT * FROM bill_vendor_invoice_lines WHERE invoice_id = ? AND deleted_at IS NULL ORDER BY line_no').all(id).map((l) => ({ poLineId: l.po_line_id, description: l.description, uom: l.uom, hsn: l.hsn, qty: d3(l.qty_th), rate: rs(l.rate_paise), gstPct: l.gst_pct_bp / 100 }));
  const dupOf = (companyId, vendorId, invoiceNo, fy, exceptId) => db.prepare("SELECT doc_no FROM bill_vendor_invoices WHERE company_id = ? AND vendor_id = ? AND invoice_no = ? COLLATE NOCASE AND fy = ? AND id <> ? AND deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED')").get(companyId, vendorId, invoiceNo, fy, exceptId);
  function save(invoiceId, m, actorUser) {
    db.prepare('DELETE FROM bill_vendor_invoice_lines WHERE invoice_id = ?').run(invoiceId);
    for (const l of m.lines) db.prepare('INSERT INTO bill_vendor_invoice_lines (company_id, invoice_id, line_no, po_line_id, item_id, description, uom, hsn, qty_th, rate_paise, gst_pct_bp, taxable_paise, tax_paise, amount_paise, grn_qty_th, invoiced_before_th, po_rate_paise, match_result, match_json, created_by, source_type) VALUES ((SELECT company_id FROM bill_vendor_invoices WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(invoiceId, invoiceId, l.line_no, l.po_line_id, l.item_id, l.description, l.uom, l.hsn, l.qty_th, l.rate_paise, l.gst_pct_bp, l.taxable_paise, l.tax_paise, l.amount_paise, l.grn_qty_th, l.invoiced_before_th, l.po_rate_paise, l.match_result, JSON.stringify(l.notes), actorUser, 'manual');
  }
  const view = (actor, r, detail = false) => {
    const c0 = flow.can(actor, r); const ex = JSON.parse(r.exceptions_json); const w = { pid: r.org_project_id, sid: r.org_site_id }; const ageDays = Math.max(0, daysBetween(today(), r.created_at));
    const o = { id: r.id, docNo: r.doc_no, projectId: r.org_project_id, project: pcode(r.org_project_id), vendorId: r.vendor_id, vendor: vendorName(r.vendor_id), invoiceKind: r.invoice_kind, kindLabel: KIND[r.invoice_kind], poId: r.po_id, soId: r.so_id, serviceEntryId: r.service_entry_id, hireBillId: r.hire_bill_id, vendorGstin: r.vendor_gstin, invoiceNo: r.invoice_no, invoiceDate: r.invoice_date, fy: r.fy, source: r.source, taxable: rs(r.taxable_paise), tax: rs(r.tax_paise), total: rs(r.total_paise), declaredTotal: rs(r.declared_total_paise), debit: rs(r.debit_paise), payable: rs(r.payable_paise), irn: r.irn, irnChecked: r.irn_checked === 1, dueDate: r.due_date,
      matchStatus: r.match_status, matchLabel: MATCH[r.match_status], exceptionCount: ex.length, blocked: r.blocked === 1, priceException: r.price_exception === 1, variance: rs(r.variance_paise), overrideReason: r.override_reason, apState: r.ap_state, apRef: r.ap_ref, paymentAllowed: r.status === 'APPROVED' && r.blocked === 0 && ['MATCHED', 'RESOLVED', 'OVERRIDDEN'].includes(r.match_status), ageDays, status: r.status, statusLabel: STATUS[r.status], version: r.version, requestedBy: r.requested_by,
      can: { ...c0, amend: false, resolve: ['DRAFT', 'RETURNED'].includes(r.status) && r.match_status === 'EXCEPTION' && may(actor, 'bill.vendor_invoice.resolve', w.pid, w.sid) } };
    if (detail) {
      const po2 = r.po_id ? db.prepare('SELECT doc_no, vendor_gstin, credit_days FROM proc_purchase_orders WHERE id = ?').get(r.po_id) : null; Object.assign(o, flow.approveInfo(actor, r), { exceptions: ex, resolution: JSON.parse(r.resolution_json || '{}'), po: po2 ? { docNo: po2.doc_no, gstin: po2.vendor_gstin, creditDays: po2.credit_days } : null,
        lines: db.prepare('SELECT l.*, p.line_no AS po_line_no, p.qty AS po_qty, p.gst_pct AS po_gst FROM bill_vendor_invoice_lines l LEFT JOIN proc_po_lines p ON p.id = l.po_line_id WHERE l.invoice_id = ? AND l.deleted_at IS NULL ORDER BY l.line_no').all(r.id).map((l) => ({ lineNo: l.line_no, poLineId: l.po_line_id, poLineNo: l.po_line_no, description: l.description, uom: l.uom, hsn: l.hsn, qty: d3(l.qty_th), rate: rs(l.rate_paise), gstPct: l.gst_pct_bp / 100, taxable: rs(l.taxable_paise), tax: rs(l.tax_paise), amount: rs(l.amount_paise), poQty: d3(l.po_qty), poRate: rs(l.po_rate_paise), poGstPct: l.po_gst == null ? null : l.po_gst / 10000, grnQty: d3(l.grn_qty_th), invoicedBefore: d3(l.invoiced_before_th), result: l.match_result, notes: JSON.parse(l.match_json) })), cancelReason: r.cancel_reason });
    }
    return o;
  };
  const ctxOf = (r) => ({ priceExc: r.price_exception, overThreshold: r.variance_paise > num(r.company_id, 'bill.vinv.cfo_threshold_paise') ? 1 : 0, exception: r.match_status === 'EXCEPTION' ? 1 : 0, total: rs(r.total_paise) });
  const apply = (id, header, lines, extra, actorUser) => {
    const r0 = db.prepare('SELECT * FROM bill_vendor_invoices WHERE id = ?').get(id); const m = evaluate({ companyId: r0.company_id, header, lines, invoiceId: id }); save(id, m, actorUser); const prevRes = JSON.parse(r0.resolution_json || '{}');
    const status = prevRes.kind === 'DEBIT_NOTE' && m.exceptions.length ? 'RESOLVED' : m.match; const debit = status === 'RESOLVED' ? prevRes.debit ?? 0 : 0;
    const c = { taxable_paise: m.taxable, tax_paise: m.tax, total_paise: m.total, debit_paise: debit, payable_paise: Math.max(0, m.total - debit), exceptions_json: JSON.stringify(m.exceptions), match_status: status, blocked: status === 'EXCEPTION' ? 1 : 0, price_exception: m.price ? 1 : 0, variance_paise: m.variance, due_date: m.dueDate, matched_at: nowIso(), org_project_id: m.projectId ?? r0.org_project_id, resolution_json: status === 'RESOLVED' ? r0.resolution_json : (prevRes.kind === 'PO_AMENDMENT' ? r0.resolution_json : '{}'), ...extra };
    db.prepare(`UPDATE bill_vendor_invoices SET ${Object.keys(c).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(c), id); return m;
  };
  const flow = createFlow({ db, base, docType: 'BILL_VENDOR_INVOICE', table: 'bill_vendor_invoices', perm: 'bill.vendor_invoice', label: 'vendor invoice', route: '/bill/vendor-invoices?id=', ctx: ctxOf, title: (r) => `${r.invoice_no} ${vendorName(r.vendor_id) ?? ''}`.trim(), notifyCode: 'bill.vendor_invoice.decided', numberKey: 'BILL_VENDOR_INVOICE', prefix: 'VIN',
    beforeSubmit: (actor, r) => {
      const dup = dupOf(r.company_id, r.vendor_id, r.invoice_no, r.fy, r.id); if (dup) throw conflict(`This vendor invoice is registered already as ${dup.doc_no}.`);
      const m = apply(r.id, headerOf(r), linesOf(r.id), {}, actor.user); const cur = db.prepare('SELECT * FROM bill_vendor_invoices WHERE id = ?').get(r.id); Object.assign(r, cur);
      if (m.exceptions.length && cur.match_status === 'EXCEPTION' && (cur.override_reason ?? '').trim().length < 5) fail(m.exceptions.map((e) => ({ field: e.code, message: e.message })).concat([{ field: 'overrideReason', message: 'Resolve the exceptions (debit note, order amendment, rejection) or give the reason to approve over them' }]));
    },
    onApproved: (actor, r) => {
      // BR-02 (SoD-04): whoever recorded the goods receipt of the order does not approve its invoice
      if (r.po_id) { const grn = db.prepare("SELECT doc_no FROM inv_grns WHERE po_id = ? AND requested_by = ? AND deleted_at IS NULL AND status <> 'CANCELLED' LIMIT 1").get(r.po_id, actor.user); if (grn) throw conflict(`You recorded the goods receipt ${grn.doc_no} for this order: someone else approves its invoice (SoD-04).`); }
      const f = db.prepare('SELECT * FROM bill_vendor_invoices WHERE id = ?').get(r.id); const over = f.match_status === 'EXCEPTION'; db.prepare("UPDATE bill_vendor_invoices SET match_status = ?, blocked = 0, ap_state = 'HANDED' WHERE id = ?").run(over ? 'OVERRIDDEN' : f.match_status, r.id);
      if (f.invoice_kind === 'PO') for (const l of db.prepare('SELECT po_line_id, qty_th FROM bill_vendor_invoice_lines WHERE invoice_id = ? AND po_line_id IS NOT NULL').all(r.id)) { const pl = db.prepare('SELECT qty, invoiced_qty FROM proc_po_lines WHERE id = ?').get(l.po_line_id); const delta = Math.min(l.qty_th, Math.max(0, pl.qty - pl.invoiced_qty)); if (delta > 0) po()?.invoicing?.record?.(r.company_id, { poLineId: l.po_line_id, deltaTh: delta }); }
      const g = db.prepare('SELECT * FROM bill_vendor_invoices WHERE id = ?').get(r.id); const lines = db.prepare('SELECT * FROM bill_vendor_invoice_lines WHERE invoice_id = ?').all(r.id);
      evt('ap.invoice.matched', actor, g.company_id, 'bill_vendor_invoices', g.id, { invoiceId: g.id, docNo: g.doc_no, invoiceNo: g.invoice_no, invoiceDate: g.invoice_date, fy: g.fy, kind: g.invoice_kind, projectId: g.org_project_id, vendorId: g.vendor_id, vendorGstin: g.vendor_gstin, poId: g.po_id, serviceEntryId: g.service_entry_id, hireBillId: g.hire_bill_id, taxable: rs(g.taxable_paise), tax: rs(g.tax_paise), total: rs(g.total_paise), debit: rs(g.debit_paise), payable: rs(g.payable_paise), dueDate: g.due_date, irn: g.irn, matchStatus: g.match_status, overrideReason: g.override_reason, itc: lines.map((l) => ({ hsn: l.hsn, gstPct: l.gst_pct_bp / 100, taxable: rs(l.taxable_paise), tax: rs(l.tax_paise) })) }, g.org_project_id);
    } });
  function supplierInvoiceStatus(scope, order) {
    const companyId = scope.companyId;
    audit({ user: `portal-supplier:${scope.accountId}` }, 'proc_purchase_orders', order.id, 'supplier_invoice_status', companyId);
    const rows = db.prepare(`SELECT id, doc_no, invoice_no, invoice_date, due_date, total_paise, match_status, status
      FROM bill_vendor_invoices
      WHERE company_id = ? AND vendor_id = ? AND po_id = ? AND org_project_id = ? AND invoice_kind = 'PO'
        AND (? IS NULL OR org_site_id IS NULL OR org_site_id = ?)
        AND status NOT IN ('DRAFT', 'SUPERSEDED') AND deleted_at IS NULL AND is_active = 1
      ORDER BY id DESC LIMIT 50`).all(companyId, scope.partnerId, order.id, order.org_project_id, scope.siteId, scope.siteId);
    return rows.map((r) => {
      const ap = r.status === 'APPROVED' && flags?.isOn({ companyId }, 'ff.fin.p2303') ? db.prepare(`SELECT id, due_date, net_payable_paise,
        adjusted_paise, paid_paise FROM ap_bills WHERE company_id = ? AND partner_id = ?
        AND bill_source = 'VENDOR_INVOICE' AND source_ref = ? AND status = 'APPROVED' AND deleted_at IS NULL
        AND (org_project_id IS NULL OR org_project_id = ?) AND (? IS NULL OR org_site_id IS NULL OR org_site_id = ?)`)
        .get(companyId, scope.partnerId, String(r.id), order.org_project_id, scope.siteId, scope.siteId) : null;
      const payments = ap && flags?.isOn({ companyId }, 'ff.fin.p2304') ? db.prepare(`
        SELECT p.id, p.doc_no, p.paid_on, p.amount_paise, p.utr
        FROM pmt_payments p JOIN pmt_proposal_lines l
          ON l.id = p.line_id AND l.company_id = p.company_id AND l.proposal_id = p.proposal_id
        WHERE p.company_id = ? AND p.partner_id = ? AND l.partner_id = p.partner_id AND l.ap_bill_id = ?
          AND p.pay_status = 'PAID' AND p.deleted_at IS NULL AND l.deleted_at IS NULL
        ORDER BY p.paid_on DESC, p.id DESC`).all(companyId, scope.partnerId, ap.id).map((payment) => ({
        id: payment.id, docNo: payment.doc_no, paidOn: payment.paid_on, amount: rs(payment.amount_paise),
        utr: payment.utr,
      })) : [];
      return { docNo: r.doc_no, invoiceNo: r.invoice_no, invoiceDate: r.invoice_date, status: r.status,
        matchStatus: r.match_status, total: rs(r.total_paise), dueDate: ap?.due_date ?? r.due_date,
        paid: ap ? rs(ap.paid_paise) : null, amountDue: ap ? rs(Math.max(0, ap.net_payable_paise - ap.adjusted_paise - ap.paid_paise)) : null,
        payments };
    });
  }
  function storeDraft(actor, b, src, projectId) {
    const fy = fyOf(b.invoiceDate);
    const dup = dupOf(actor.companyId, b.vendorId, b.invoiceNo, fy, 0);
    if (dup) throw conflict(`This vendor invoice is registered already as ${dup.doc_no}.`);
    const no = flow.next(actor);
    const id = Number(db.prepare('INSERT INTO bill_vendor_invoices (company_id, doc_no, org_project_id, org_site_id, vendor_id, invoice_kind, po_id, so_id, service_entry_id, hire_bill_id, vendor_gstin, invoice_no, invoice_date, fy, source, declared_total_paise, irn, irn_checked, override_reason, notes, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, no, projectId, b.siteId ?? null, b.vendorId, b.invoiceKind, b.invoiceKind === 'PO' ? src.po.id : null, b.invoiceKind === 'SERVICE' ? src.se.so_id : null, b.invoiceKind === 'SERVICE' ? src.se.id : null, b.invoiceKind === 'HIRE' ? src.hb.id : null, b.vendorGstin ?? null, b.invoiceNo, b.invoiceDate, fy, b.source, b.declaredTotal == null ? null : paise(b.declaredTotal), b.irn ?? null, b.irn ? 1 : 0, b.overrideReason ?? null, b.notes ?? null, actor.user, actor.user, b.source === 'MANUAL' ? 'manual' : b.source.toLowerCase()).lastInsertRowid);
    apply(id, b, b.lines, {}, actor.user);
    audit(actor, 'bill_vendor_invoices', id, 'create', actor.companyId);
    return db.prepare('SELECT * FROM bill_vendor_invoices WHERE id = ?').get(id);
  }
  const invoices = {
    ...flow,
    supplierStatus: supplierInvoiceStatus,
    list(actor, query) { return runList(db, viList, parseListRequest(viList, query), { select: 'x.*', scopeSql: scopeOf(actor, 'bill.vendor_invoice.view'), params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => view(actor, r) }); },
    get: (actor, id) => view(actor, flow.row(actor, id), true),
    options(actor) {
      gate(actor, 'bill.vendor_invoice.create', 'register vendor invoices'); const pj = db.prepare("SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code").all(actor.companyId).filter((p) => may(actor, 'bill.vendor_invoice.create', p.id));
      return { projects: pj, vendors: db.prepare("SELECT id, legal_name AS name FROM mdm_partners WHERE company_id = ? AND deleted_at IS NULL AND partner_status = 'ACTIVE' ORDER BY legal_name LIMIT 1000").all(actor.companyId),
        purchaseOrders: db.prepare("SELECT id, doc_no AS docNo, vendor_id AS vendorId FROM proc_purchase_orders WHERE company_id = ? AND deleted_at IS NULL AND status IN ('APPROVED', 'CLOSED') ORDER BY id DESC LIMIT 500").all(actor.companyId).map((p) => ({ ...p, lines: db.prepare('SELECT l.id, l.line_no AS lineNo, l.uom, l.qty, l.rate, l.gst_pct AS gstPct, l.invoiced_qty AS invoiced, i.name AS item FROM proc_po_lines l LEFT JOIN mdm_items i ON i.id = l.item_id WHERE l.po_id = ? AND l.deleted_at IS NULL ORDER BY l.line_no').all(p.id).map((l) => ({ id: l.id, lineNo: l.lineNo, item: l.item, uom: l.uom, qty: d3(l.qty), rate: rs(l.rate), gstPct: l.gstPct / 10000, invoiced: d3(l.invoiced), accepted: d3(grnQty(l.id)) })) })),
        serviceEntries: db.prepare("SELECT e.id, e.doc_no AS docNo, o.vendor_id AS vendorId, e.entry_amount FROM proc_service_entries e JOIN proc_service_orders o ON o.id = e.so_id WHERE e.company_id = ? AND e.deleted_at IS NULL AND e.status = 'APPROVED' ORDER BY e.id DESC LIMIT 300").all(actor.companyId).map((e) => ({ id: e.id, docNo: e.docNo, vendorId: e.vendorId, amount: rs(e.entry_amount) })),
        hireBills: db.prepare("SELECT h.id, h.doc_no AS docNo, a.partner_id AS vendorId, h.hire_amount + h.mob_amount AS amount FROM plt_hire_bills h JOIN plt_hire_agreements a ON a.id = h.agreement_id WHERE h.company_id = ? AND h.deleted_at IS NULL AND h.status = 'APPROVED' ORDER BY h.id DESC LIMIT 300").all(actor.companyId).map((h) => ({ id: h.id, docNo: h.docNo, vendorId: h.vendorId, amount: rs(h.amount) })), tolerance: { qtyPct: num(actor.companyId, 'bill.vinv.qty_tol_pct'), ratePct: num(actor.companyId, 'bill.vinv.rate_tol_pct'), absolute: rs(num(actor.companyId, 'bill.vinv.abs_tol_paise')) } };
    },
    /** The match as it would be, without saving. */
    preview(actor, b) { const src = sourceOf(actor.companyId, b); projectOk(actor, src.projectId ?? b.projectId, 'bill.vendor_invoice.create'); const fy = fyOf(b.invoiceDate); const dup = dupOf(actor.companyId, b.vendorId, b.invoiceNo, fy, 0); const m = evaluate({ companyId: actor.companyId, header: b, lines: b.lines }); return { duplicateOf: dup?.doc_no ?? null, taxable: rs(m.taxable), tax: rs(m.tax), total: rs(m.total), matchStatus: m.match, exceptions: m.exceptions, variance: rs(m.variance), lines: m.lines.map((l) => ({ lineNo: l.line_no, poLineId: l.po_line_id, description: l.description, qty: d3(l.qty_th), rate: rs(l.rate_paise), taxable: rs(l.taxable_paise), tax: rs(l.tax_paise), grnQty: d3(l.grn_qty_th), invoicedBefore: d3(l.invoiced_before_th), poRate: rs(l.po_rate_paise), result: l.match_result, notes: l.notes })) }; },
    create(actor, b) {
      const src = sourceOf(actor.companyId, b);
      const projectId = src.projectId ?? b.projectId;
      if (!projectId) fail([{ field: 'projectId', message: 'Choose the project' }]);
      const pj = projectOk(actor, projectId, 'bill.vendor_invoice.create');
      return transaction(db, () => invoices.get(actor, storeDraft(actor, b, src, pj.id).id));
    },
    supplierSubmit(scope, orderId, b, attach) {
      return transaction(db, () => {
        const order = po()?.supplier.order(scope, orderId);
        if (!order) throw notFound('That purchase order does not exist.');
        const actor = { user: `portal-supplier:${scope.accountId}`, companyId: scope.companyId, roles: [] };
        const input = { ...b, vendorId: scope.partnerId, invoiceKind: 'PO', poId: order.id, siteId: order.po_site_id, source: 'PORTAL' };
        if (b.invoiceDate > today() || !Number.isFinite(Date.parse(b.invoiceDate)) || addDays(b.invoiceDate, 0) !== b.invoiceDate) {
          fail([{ field: 'invoiceDate', message: 'Use a valid invoice date on or before today.' }]);
        }
        if ((order.vendor_gstin && b.vendorGstin !== order.vendor_gstin) || (b.lines.some((l) => l.gstPct > 0) && !b.vendorGstin)) {
          fail([{ field: 'vendorGstin', message: 'Enter the GSTIN for this order.' }]);
        }
        if (b.vendorGstin && !db.prepare(`SELECT 1 FROM mdm_partner_gstins WHERE company_id = ? AND partner_id = ?
          AND gstin = ? AND gstin_status = 'ACTIVE' AND deleted_at IS NULL`).get(scope.companyId, scope.partnerId, b.vendorGstin)) {
          fail([{ field: 'vendorGstin', message: 'Enter an active GSTIN registered for the supplier.' }]);
        }
        if (new Set(b.lines.map((l) => l.poLineId)).size !== b.lines.length) {
          fail([{ field: 'lines', message: 'List each PO line once.' }]);
        }
        const r = storeDraft(actor, input, { po: order }, order.org_project_id);
        attach({ entity: 'bill_vendor_invoices', id: r.id, projectId: order.org_project_id, siteId: order.po_site_id });
        const result = flow.submitOwnedDraft(actor, r);
        return { docNo: result.doc_no, status: result.status, matchStatus: result.match_status };
      });
    },
    update(actor, id, b) {
      const r = flow.row(actor, id, 'bill.vendor_invoice.edit'); if (!flow.EDITABLE.includes(r.status)) throw conflict('An approved invoice is locked.'); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this; reload it.');
      const header = { ...headerOf(r), ...(b.vendorGstin !== undefined ? { vendorGstin: b.vendorGstin } : {}), ...(b.invoiceDate ? { invoiceDate: b.invoiceDate } : {}), ...(b.declaredTotal !== undefined ? { declaredTotal: b.declaredTotal } : {}) }; const invoiceNo = b.invoiceNo ?? r.invoice_no; const fy = fyOf(header.invoiceDate); const dup = dupOf(r.company_id, r.vendor_id, invoiceNo, fy, r.id); if (dup) throw conflict(`This vendor invoice is registered already as ${dup.doc_no}.`);
      return transaction(db, () => { db.prepare('UPDATE bill_vendor_invoices SET invoice_no = ?, invoice_date = ?, fy = ?, vendor_gstin = ?, declared_total_paise = ?, irn = ?, irn_checked = ?, override_reason = ?, notes = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(invoiceNo, header.invoiceDate, fy, header.vendorGstin ?? null, header.declaredTotal == null ? null : paise(header.declaredTotal), 'irn' in b ? b.irn : r.irn, ('irn' in b ? b.irn : r.irn) ? 1 : 0, 'overrideReason' in b ? b.overrideReason : r.override_reason, 'notes' in b ? b.notes : r.notes, actor.user, nowIso(), r.id);
        apply(r.id, header, b.lines ?? linesOf(r.id), {}, actor.user); audit(actor, 'bill_vendor_invoices', r.id, 'update', r.company_id); return invoices.get(actor, r.id); });
    },
    remove: (actor, id) => flow.remove(actor, id), submit(actor, id) { flow.submit(actor, id); return invoices.get(actor, id); }, withdraw: (actor, id, b) => { flow.withdraw(actor, id, b); return invoices.get(actor, id); }, cancel: (actor, id, b) => { flow.cancel(actor, id, b); return invoices.get(actor, id); }, history: (actor, id) => flow.history(actor, id),
    amend(actor, id) { flow.row(actor, id, 'bill.vendor_invoice.amend'); throw unprocessable('An approved invoice is locked and has gone to the payables. A correction is a debit note or a credit note from the vendor.'); },
    /** FR-03: how an exception is dealt with: a debit note for the excess, an amendment of the order (then it is matched again), or rejection of the invoice. */
    resolve(actor, id, b) {
      const r = flow.row(actor, id, 'bill.vendor_invoice.resolve'); if (!['DRAFT', 'RETURNED'].includes(r.status) || r.match_status !== 'EXCEPTION') throw unprocessable('Only an invoice with an open exception is resolved.');
      return transaction(db, () => {
        const res = { kind: b.kind, note: b.note, ref: b.ref ?? null, by: actor.user, at: nowIso() };
        if (b.kind === 'REJECT') { db.prepare("UPDATE bill_vendor_invoices SET status = 'CANCELLED', cancel_reason = ?, resolution_json = ?, blocked = 0, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(b.note, JSON.stringify(res), actor.user, nowIso(), r.id); audit(actor, 'bill_vendor_invoices', r.id, 'reject', r.company_id, { reason: b.note }); return invoices.get(actor, r.id); }
        if (b.kind === 'PO_AMENDMENT') { if (!b.ref) fail([{ field: 'ref', message: 'Give the reference of the order amendment' }]); db.prepare('UPDATE bill_vendor_invoices SET resolution_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(res), actor.user, nowIso(), r.id); apply(r.id, headerOf(r), linesOf(r.id), {}, actor.user); audit(actor, 'bill_vendor_invoices', r.id, 'resolve', r.company_id, { newValues: res }); return invoices.get(actor, r.id); }
        const excess = r.variance_paise; if (excess <= 0) throw unprocessable('There is no excess to debit.'); db.prepare("UPDATE bill_vendor_invoices SET resolution_json = ?, debit_paise = ?, payable_paise = MAX(0, total_paise - ?), match_status = 'RESOLVED', blocked = 0, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(JSON.stringify({ ...res, debit: excess }), excess, excess, actor.user, nowIso(), r.id);
        audit(actor, 'bill_vendor_invoices', r.id, 'resolve', r.company_id, { newValues: { ...res, debit: rs(excess) } }); evt('bill.vendor_invoice.resolved', actor, r.company_id, 'bill_vendor_invoices', r.id, { invoiceId: r.id, invoiceNo: r.invoice_no, vendorId: r.vendor_id, kind: b.kind, debitNote: rs(excess), ref: b.ref ?? null }, r.org_project_id); return invoices.get(actor, r.id);
      });
    },
    /** For the payables (23.03): an approved, matched invoice becomes a bill, once; a blocked or unmatched invoice is refused (BR-01). */
    linkPayable(companyId, { invoiceId, apRef }) {
      const r = db.prepare('SELECT * FROM bill_vendor_invoices WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(invoiceId), companyId); if (!r) throw unprocessable('That invoice does not exist.'); if (r.status !== 'APPROVED' || r.blocked === 1 || !['MATCHED', 'RESOLVED', 'OVERRIDDEN'].includes(r.match_status)) throw unprocessable('An invoice that is not approved and matched is not paid.'); if (r.ap_state === 'LINKED' && r.ap_ref !== apRef) throw conflict('The invoice has another payable.');
      db.prepare("UPDATE bill_vendor_invoices SET ap_state = 'LINKED', ap_ref = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(apRef, nowIso(), r.id); return { replay: r.ap_state === 'LINKED' };
    },
    /** BR-01: may the invoice be paid? */
    paymentAllowed(companyId, invoiceId) { const r = db.prepare('SELECT * FROM bill_vendor_invoices WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(invoiceId), companyId); return Boolean(r && r.status === 'APPROVED' && r.blocked === 0 && ['MATCHED', 'RESOLVED', 'OVERRIDDEN'].includes(r.match_status)); },
    exportCsv(actor) { gate(actor, 'bill.vendor_invoice.export', 'export vendor invoices'); const l = invoices.list(actor, { page: 1, pageSize: 100 }); const headers = ['Document', 'Invoice', 'Date', 'Vendor', 'Project', 'Kind', 'Taxable', 'Tax', 'Total', 'Payable', 'Match', 'Blocked', 'Approval']; const rows = l.data.map((x) => [x.docNo, x.invoiceNo, x.invoiceDate, x.vendor, x.project, x.kindLabel, x.taxable, x.tax, x.total, x.payable, x.matchLabel, x.blocked ? 'Yes' : 'No', x.statusLabel]); audit(actor, 'bill_vendor_invoices', 0, 'export', actor.companyId, { reason: `${rows.length} row(s)` }); return { contentType: 'text/csv; charset=utf-8', fileName: `vendor-invoices-${today()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(headers, rows)}`, 'utf8') }; },
    importRows(actor, { rows }) {
      gate(actor, 'bill.vendor_invoice.create', 'import vendor invoices'); const out = []; for (const [i, x] of rows.entries()) { try { const p = db.prepare('SELECT * FROM proc_purchase_orders WHERE company_id = ? AND doc_no = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, x.poNo ?? ''); if (!p) throw new Error('Purchase order not found'); const pl = db.prepare('SELECT * FROM proc_po_lines WHERE po_id = ? AND line_no = ? AND deleted_at IS NULL').get(p.id, Number(x.lineNo ?? 1)); if (!pl) throw new Error('Order line not found'); const d = invoices.create(actor, { invoiceKind: 'PO', vendorId: p.vendor_id, poId: p.id, serviceEntryId: null, hireBillId: null, projectId: null, siteId: null, vendorGstin: x.gstin ?? null, invoiceNo: x.invoiceNo, invoiceDate: x.invoiceDate, source: 'EMAIL', declaredTotal: null, irn: null, overrideReason: null, notes: null, lines: [{ poLineId: pl.id, description: null, uom: null, hsn: x.hsn ?? null, qty: Number(x.qty), rate: Number(x.rate ?? pl.rate / 100), gstPct: Number(x.gstPct ?? pl.gst_pct / 100) }] }); out.push({ row: i + 1, docNo: d.docNo, match: d.matchStatus }); } catch (e) { out.push({ row: i + 1, error: e.message }); } } return out;
    },
    print(actor, id) {
      const r = flow.row(actor, id, 'bill.vendor_invoice.print'); const v = invoices.get(actor, id); audit(actor, 'bill_vendor_invoices', r.id, 'print', r.company_id); const m = (x) => (x == null ? '' : x.toFixed(2));
      const rows = v.lines.map((l) => ({ line: String(l.lineNo), description: l.description, qty: String(l.qty), grn: l.grnQty == null ? '' : String(l.grnQty), rate: m(l.rate), poRate: m(l.poRate), taxable: m(l.taxable), tax: m(l.tax), result: l.result })); rows.push({ line: '', description: 'Total', qty: '', grn: '', rate: '', poRate: '', taxable: m(v.taxable), tax: m(v.tax), result: MATCH[r.match_status] }); for (const e of v.exceptions) rows.push({ line: e.lineNo ? String(e.lineNo) : '', description: EXCEPTION[e.code], qty: '', grn: '', rate: '', poRate: '', taxable: '', tax: '', result: e.message });
      return { buffer: toPdf({ columns: [{ key: 'line', label: 'Line', type: 'text' }, { key: 'description', label: 'Description', type: 'text' }, { key: 'qty', label: 'Invoice qty', type: 'number' }, { key: 'grn', label: 'Accepted qty', type: 'number' }, { key: 'rate', label: 'Invoice rate', type: 'number' }, { key: 'poRate', label: 'Order rate', type: 'number' }, { key: 'taxable', label: 'Taxable', type: 'number' }, { key: 'tax', label: 'Tax', type: 'number' }, { key: 'result', label: 'Match', type: 'text' }], rows, footer: [`${v.docNo} · ${v.vendor} · invoice ${v.invoiceNo} (${v.invoiceDate}) · payable ${m(v.payable)}`], title: `Vendor invoice ${v.invoiceNo}` }), contentType: 'application/pdf', fileName: `${v.docNo.replaceAll('/', '-')}.pdf`, rows: rows.length };
    },
  };
  return { vendorInvoices: invoices };
}
