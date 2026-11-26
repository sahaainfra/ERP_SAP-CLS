import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { toPdf } from '../../platform/export/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { json, nowIso, rid, same } from '../proc/base.js';

// Goods receipt (part 16.03): the GRN counts what came against a PO and a gate entry, stock rises when it is approved (the accepted quantity; inspection items wait in the inspection stock until QC releases them), the PO sees the receipt through
// an event, and what is rejected goes back to the vendor on a return with a gate pass. Quantities are thousandths of a unit, rates and values paise, percentages x10000.
export const INV_GRN_DOC = 'INV_GRN'; export const INV_RTV_DOC = 'INV_RTV';
export const GRN_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', RETURNED: 'Returned for correction', APPROVED: 'Approved and posted', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
export const RTV_STATUS = GRN_STATUS;
export const INSP_STATUS = { NA: 'Not required', PENDING: 'Under inspection', PASSED: 'Passed', PARTIAL: 'Partly passed', FAILED: 'Failed' };
const EDITABLE = ['DRAFT', 'RETURNED'];

if (!parameterRegistry.get('inv.grn.excess_tolerance_pct')) parameterRegistry.define({ key: 'inv.grn.excess_tolerance_pct', dataType: 'integer', default: 50000, scopes: ['system', 'company'], description: 'FR-03, BR-01: how much more than the order balance may be received. Percent x10000 (5% is 50000). More than this is not received: it goes back at the gate. Any excess within it needs the procurement manager.', min: 0, max: 1000000 });

export const grnList = defineList({
  code: 'inv.grns', label: 'Goods receipts', permission: 'inv.grn.view', from: 'inv_grns x JOIN inv_stores s ON s.id = x.store_id JOIN mdm_partners v ON v.id = x.vendor_id LEFT JOIN proc_purchase_orders po ON po.id = x.po_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.challan_no', 'v.legal_name', 'po.doc_no', 's.code'], defaultSort: '-date',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'GRN' }, date: { sql: 'x.received_date', type: 'date', label: 'Received' }, store: { sql: 's.code', type: 'text', label: 'Store' }, vendor: { sql: 'v.legal_name', type: 'text', label: 'Vendor' }, po: { sql: "COALESCE(po.doc_no, '')", type: 'text', label: 'PO' }, challan: { sql: "COALESCE(x.challan_no, '')", type: 'text', label: 'Challan' },
    inspection: { sql: "CASE WHEN EXISTS (SELECT 1 FROM inv_grn_lines l WHERE l.grn_id = x.id AND l.inspection_status = 'PENDING' AND l.deleted_at IS NULL) THEN 'PENDING' WHEN EXISTS (SELECT 1 FROM inv_grn_lines l WHERE l.grn_id = x.id AND l.inspection_required = 1 AND l.deleted_at IS NULL) THEN 'DONE' ELSE 'NA' END", type: 'enum', label: 'Inspection', options: [['PENDING', 'Under inspection'], ['DONE', 'Inspected'], ['NA', 'Not required']] },
    emergency: { sql: "CASE WHEN x.emergency = 1 THEN 'Y' ELSE 'N' END", type: 'enum', label: 'Without PO', options: [['Y', 'Without PO'], ['N', 'Against a PO']] }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(GRN_STATUS) },
  },
});
export const rtvList = defineList({
  code: 'inv.rtvs', label: 'Returns to vendor', permission: 'inv.rtv.view', from: 'inv_rtvs x JOIN inv_grns g ON g.id = x.grn_id JOIN mdm_partners v ON v.id = x.vendor_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'g.doc_no', 'v.legal_name'], defaultSort: '-date',
  columns: { docNo: { sql: 'x.doc_no', type: 'text', label: 'Return' }, date: { sql: 'x.rtv_date', type: 'date', label: 'Date' }, grn: { sql: 'g.doc_no', type: 'text', label: 'GRN' }, vendor: { sql: 'v.legal_name', type: 'text', label: 'Vendor' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(RTV_STATUS) } },
});

const d3 = (n) => (n == null ? null : n / 1000); const t3 = (n) => Math.round(Number(n) * 1000); const valueOf = (qty, rate) => Math.round((qty * rate) / 1000);

export function createGrnService({ db, base, invSvc, gate }) {
  const { authz, may, need, fail, audit, notify, number, param } = base; const stock = invSvc.stock;
  const evt = (type, actor, companyId, entity, entityId, data, projectId) => publishEvent(db, { type, entity, entityId, actorId: actor?.user ?? 'system', companyId, projectId: projectId ?? undefined, data });
  const canValues = (actor, pid) => may(actor, 'inv.stock.values', pid); const mask = (v, actor, pid) => (canValues(actor, pid) ? v : null);
  const scope = (actor, key, alias = 'x', withSite = true) => { need(actor, key, 'see the goods receipts'); const f = authz.scopeFilter(actor, key, { project: `${alias}.org_project_id`, ...(withSite ? { site: `${alias}.org_site_id` } : {}) }); return { sql: `${alias}.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  const taskOf = (actor, instanceId) => workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === instanceId)?.id ?? null;
  const partner = (id) => (id == null ? null : db.prepare('SELECT id, code, legal_name AS name FROM mdm_partners WHERE id = ?').get(id));
  const tol = (companyId) => Number(param(companyId, 'inv.grn.excess_tolerance_pct') ?? 50000);
  const fileOk = (actor, fileId, entity, entityId) => { const f = db.prepare('SELECT id, original_name FROM core_files WHERE id = ? AND company_id = ? AND linked_entity = ? AND linked_id = ?').get(rid(fileId), actor.companyId, entity, entityId); if (!f) throw unprocessable('That file is not attached to this record. Upload it to the record first.'); return f; };
  const mandatoryInspection = (poId) => Boolean(poId && db.prepare("SELECT 1 FROM xpd_inspections WHERE po_id = ? AND mandatory = 1 AND status NOT IN ('CANCELLED', 'SUPERSEDED', 'REJECTED') AND deleted_at IS NULL").get(poId));

  // ---- the order the receipt is against -----------------------------------------------------------------------------------------------------------------------------------------------------------
  const poBalances = (poId) => db.prepare('SELECT l.*, i.code AS icode, i.name AS iname, i.stock_tracked, i.batch_tracked, i.serial_tracked FROM proc_po_lines l LEFT JOIN mdm_items i ON i.id = l.item_id WHERE l.po_id = ? AND l.deleted_at IS NULL ORDER BY l.line_no').all(poId);
  const prefillLines = (po, actor) => poBalances(po.id).filter((l) => l.item_id && l.balance_qty > 0).map((l) => ({ poLineId: l.id, lineNo: l.line_no, itemId: l.item_id, item: `${l.icode} ${l.iname}`, uom: l.uom, orderedQty: d3(l.qty), balanceQty: d3(l.balance_qty), rate: mask(l.rate, actor, po.org_project_id), stockTracked: Boolean(l.stock_tracked), batchTracked: Boolean(l.batch_tracked), serialTracked: Boolean(l.serial_tracked), inspectionRequired: mandatoryInspection(po.id), wbsId: l.wbs_id, costCodeId: l.cost_code_id }));
  const prefill = (actor, q) => {
    need(actor, 'inv.grn.create', 'make a goods receipt'); let entry = null; let po = null;
    if (q.gateInwardId) { entry = db.prepare('SELECT * FROM inv_gate_inward WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(q.gateInwardId), actor.companyId); if (!entry || !may(actor, 'inv.inward.view', entry.org_project_id, entry.org_site_id)) throw notFound('That gate entry does not exist.'); po = entry.po_id ? db.prepare('SELECT * FROM proc_purchase_orders WHERE id = ?').get(entry.po_id) : null; }
    else if (q.poId) { po = db.prepare('SELECT * FROM proc_purchase_orders WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(q.poId), actor.companyId); if (!po || !may(actor, 'inv.grn.create', po.org_project_id)) throw notFound('That purchase order does not exist.'); }
    return { gateInwardId: entry?.id ?? null, gateNo: entry?.doc_no ?? null, poId: po?.id ?? null, poNo: po?.doc_no ?? null, poOpen: po ? po.status === 'APPROVED' : null, vendorId: entry?.vendor_id ?? po?.vendor_id ?? null, vendor: partner(entry?.vendor_id ?? po?.vendor_id)?.name ?? null, storeId: entry?.unloading_store_id ?? null, challanNo: entry?.challan_no ?? null, challanDate: entry?.challan_date ?? null, netKg: (() => { const w = entry ? db.prepare('SELECT net_kg FROM inv_gate_weighments WHERE inward_id = ? AND superseded = 0 AND deleted_at IS NULL ORDER BY id DESC LIMIT 1').get(entry.id) : null; return d3(w?.net_kg); })(), challanKg: d3(entry?.challan_kg), materialDesc: entry?.material_desc ?? null, lines: po ? prefillLines(po, actor) : [] };
  };
  const ready = (actor) => {
    const sc = scope(actor, 'inv.grn.create', 'e'); return db.prepare(`SELECT e.id, e.doc_no, e.vehicle_no, e.material_desc, e.time_in, e.po_id, e.unloading_store_id FROM inv_gate_inward e WHERE ${sc.sql} AND e.deleted_at IS NULL AND e.status IN ('UNLOADING', 'HANDED_OVER', 'EXITED') AND e.unloading_store_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM inv_grns g WHERE g.gate_inward_id = e.id AND g.status NOT IN ('CANCELLED', 'REJECTED') AND g.deleted_at IS NULL) ORDER BY e.id DESC LIMIT 50`).all(sc.params)
      .map((e) => ({ id: e.id, docNo: e.doc_no, vehicleNo: e.vehicle_no, material: e.material_desc, timeIn: e.time_in, poNo: e.po_id ? db.prepare('SELECT doc_no FROM proc_purchase_orders WHERE id = ?').get(e.po_id)?.doc_no : null, store: db.prepare('SELECT code FROM inv_stores WHERE id = ?').get(e.unloading_store_id)?.code }));
  };

  // ---- lines: every rule is worked out here (BR-01, FR-03, FR-04) -----------------------------------------------------------------------------------------------------------------------------------
  function buildLines(actor, h, inputLines, { poId, emergency }) {
    const problems = []; const out = []; const used = new Map(); const t = tol(actor.companyId);
    inputLines.forEach((x, i) => {
      const f = (k) => `lines.${i}.${k}`; let pl = null; let item; let rate; let uom = x.uom; let ordered = 0; let balance = 0;
      if (x.poLineId) { pl = db.prepare('SELECT * FROM proc_po_lines WHERE id = ? AND deleted_at IS NULL').get(rid(x.poLineId)); if (!pl || pl.po_id !== poId) { problems.push({ field: f('poLineId'), message: 'Not a line of this purchase order' }); return; } item = stock.itemOf(actor.companyId, pl.item_id); rate = pl.rate; uom = pl.uom; ordered = pl.qty; balance = pl.balance_qty; }
      else if (poId) { problems.push({ field: f('poLineId'), message: 'Name the order line' }); return; }
      else { item = x.itemId ? stock.itemOf(actor.companyId, x.itemId) : null; if (!item) { problems.push({ field: f('itemId'), message: 'Choose the item' }); return; } if (x.rate == null) { problems.push({ field: f('rate'), message: 'Give the rate (a receipt without an order has no order rate)' }); return; } rate = Math.round(x.rate * 100); uom = uom ?? item.base_uom; }
      if (!item) { problems.push({ field: f('itemId'), message: 'The order line has no item' }); return; }
      if (item.serial_tracked) { problems.push({ field: f('itemId'), message: `${item.code} is kept by serial number: it is not received on a GRN yet` }); return; }
      const received = t3(x.receivedQty); const accepted = x.acceptedQty == null ? received : t3(x.acceptedQty);
      if (accepted > received) { problems.push({ field: f('acceptedQty'), message: 'Accepted cannot be more than received' }); return; }
      // the order balance learns of a receipt only when it is approved: what other receipts not yet approved hold against the line is not free to receive again
      let open = balance; if (pl) open = Math.max(0, balance - db.prepare("SELECT COALESCE(SUM(l.received_qty), 0) AS q FROM inv_grn_lines l JOIN inv_grns g ON g.id = l.grn_id WHERE l.po_line_id = ? AND l.deleted_at IS NULL AND g.deleted_at IS NULL AND g.status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND g.id <> ?").get(pl.id, h.id ?? 0).q);
      if (pl) { const sofar = (used.get(pl.id) ?? 0) + received; used.set(pl.id, sofar); const cap = Math.floor((open * (1_000_000 + t)) / 1_000_000); if (sofar > cap) { problems.push({ field: f('receivedQty'), message: `More than the order allows: the balance is ${d3(balance)}${open < balance ? ` (${d3(balance - open)} of it on receipts not yet approved)` : ''} and the tolerance ${t / 10000}% allows ${d3(cap)}. Send the excess back at the gate; do not receive it.` }); return; } }
      // the excess of this line alone: what the receipt goes over the balance by, less what the earlier lines of the same order line already went over
      const excess = pl ? Math.max(0, used.get(pl.id) - open) - Math.max(0, used.get(pl.id) - received - open) : 0;
      const wbsId = x.wbsId ?? pl?.wbs_id ?? null; const costCodeId = x.costCodeId ?? pl?.cost_code_id ?? null; const direct = !item.stock_tracked; if (direct && !wbsId && !costCodeId) { problems.push({ field: f('wbsId'), message: `${item.code} is not kept in stock: give the WBS or the cost code it is charged to` }); return; }
      if (item.batch_tracked && !direct && !(x.batchNo ?? '').trim()) { problems.push({ field: f('batchNo'), message: `${item.code} is kept by batch: give the batch number` }); return; }
      if (x.mfgDate && x.mfgDate > todayIST()) { problems.push({ field: f('mfgDate'), message: 'The manufacturing date is not in the future' }); return; }
      if (wbsId && !db.prepare('SELECT 1 FROM proj_wbs WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(rid(wbsId), h.org_project_id)) { problems.push({ field: f('wbsId'), message: 'Not a WBS of this project' }); return; }
      if (costCodeId && !db.prepare('SELECT 1 FROM fin_cost_codes WHERE id = ? AND (company_id = ? OR company_id IS NULL) AND deleted_at IS NULL').get(rid(costCodeId), actor.companyId)) { problems.push({ field: f('costCodeId'), message: 'Not a cost code' }); return; }
      if (x.certFileId) fileOk(actor, x.certFileId, 'inv_grn', h.id ?? -1);
      const insp = !direct && (x.inspectionRequired ?? mandatoryInspection(poId)) ? 1 : 0;
      out.push({ line_no: out.length + 1, po_line_id: pl?.id ?? null, item_id: item.id, uom, ordered_qty: ordered, balance_qty: balance, challan_qty: x.challanQty == null ? received : t3(x.challanQty), received_qty: received, accepted_qty: accepted, rejected_qty: received - accepted, rate, line_value: valueOf(accepted, rate), batch_no: (x.batchNo ?? '').trim() || null, heat_no: x.heatNo ?? null, mfg_date: x.mfgDate ?? null, cert_file_id: x.certFileId ?? null, inspection_required: insp, inspection_status: insp && accepted > 0 ? 'PENDING' : 'NA', wbs_id: wbsId, cost_code_id: costCodeId, direct_charge: direct ? 1 : 0, excess_qty: excess });
    });
    fail(problems); if (!out.length) fail([{ field: 'lines', message: 'Add at least one line' }]); void emergency; return out;
  }
  const lineRows = (grnId) => db.prepare('SELECT l.*, i.code AS icode, i.name AS iname, i.base_uom FROM inv_grn_lines l JOIN mdm_items i ON i.id = l.item_id WHERE l.grn_id = ? AND l.deleted_at IS NULL ORDER BY l.line_no').all(grnId);
  const saveLines = (actor, h, lines) => {
    const cols = ['po_line_id', 'item_id', 'uom', 'ordered_qty', 'balance_qty', 'challan_qty', 'received_qty', 'accepted_qty', 'rejected_qty', 'rate', 'line_value', 'batch_no', 'heat_no', 'mfg_date', 'cert_file_id', 'inspection_required', 'inspection_status', 'wbs_id', 'cost_code_id', 'direct_charge', 'excess_qty'];
    for (const l of lines) { const have = db.prepare('SELECT id FROM inv_grn_lines WHERE grn_id = ? AND line_no = ?').get(h.id, l.line_no);
      if (have) db.prepare(`UPDATE inv_grn_lines SET ${cols.map((c) => `${c} = ?`).join(', ')}, deleted_at = NULL, is_active = 1, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...cols.map((c) => l[c]), actor.user, nowIso(), have.id);
      else db.prepare(`INSERT INTO inv_grn_lines (company_id, grn_id, line_no, ${cols.join(', ')}, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ${cols.map(() => '?').join(', ')}, ?, ?, ?, 'api')`).run(actor.companyId, h.id, l.line_no, ...cols.map((c) => l[c]), h.org_project_id, h.org_site_id, actor.user); }
    db.prepare('DELETE FROM inv_grn_lines WHERE grn_id = ? AND line_no > ?').run(h.id, lines.length);
  };

  // ---- GRN ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const grnView = (actor, g, { detail = false } = {}) => {
    const can = (k) => may(actor, k, g.org_project_id, g.org_site_id); const own = same(g.requested_by, actor.user); const store = db.prepare('SELECT code, name FROM inv_stores WHERE id = ?').get(g.store_id); const po = g.po_id ? db.prepare('SELECT doc_no FROM proc_purchase_orders WHERE id = ?').get(g.po_id) : null; const gate = g.gate_inward_id ? db.prepare('SELECT doc_no FROM inv_gate_inward WHERE id = ?').get(g.gate_inward_id) : null;
    const ls = lineRows(g.id); const pending = ls.some((l) => l.inspection_status === 'PENDING');
    const o = { id: g.id, docNo: g.doc_no, date: g.received_date, projectId: g.org_project_id, storeId: g.store_id, store: store?.code, storeName: store?.name, poId: g.po_id, poNo: po?.doc_no ?? null, gateInwardId: g.gate_inward_id, gateNo: gate?.doc_no ?? null, vendorId: g.vendor_id, vendor: partner(g.vendor_id)?.name, challanNo: g.challan_no, challanDate: g.challan_date, invoiceNo: g.invoice_no, emergency: Boolean(g.emergency), emergencyWhy: g.emergency_why, excess: Boolean(g.excess), totalValue: mask(g.total_value, actor, g.org_project_id),
      inspection: pending ? 'PENDING' : ls.some((l) => l.inspection_required) ? 'DONE' : 'NA', status: g.status, statusLabel: GRN_STATUS[g.status], requestedBy: g.requested_by, approvedBy: g.approved_by, postedAt: g.posted_at, workflowInstanceId: g.workflow_instance_id, amendmentNo: g.amendment_no, cancelReason: g.cancel_reason, rowVersion: g.version, lineCount: ls.length,
      can: { edit: can('inv.grn.edit') && EDITABLE.includes(g.status), delete: can('inv.grn.delete') && g.status === 'DRAFT', submit: can('inv.grn.submit') && EDITABLE.includes(g.status), withdraw: g.status === 'SUBMITTED' && own, cancel: can('inv.grn.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(g.status), amend: can('inv.grn.amend') && g.status === 'APPROVED', inspect: can('inv.grn.inspect') && g.status === 'APPROVED' && pending, returnToVendor: can('inv.rtv.create') && g.status === 'APPROVED' && ls.some((l) => returnable(l) > 0), print: can('inv.grn.print'), photo: can('inv.grn.create') || can('inv.grn.edit') } };
    if (detail) {
      o.approve = g.status === 'SUBMITTED' && !own && can('inv.grn.approve'); if (o.approve && g.workflow_instance_id) o.taskId = taskOf(actor, g.workflow_instance_id);
      o.photos = json(g.photos_json, []).map((p) => ({ ...p, name: db.prepare('SELECT original_name FROM core_files WHERE id = ?').get(p.fileId)?.original_name ?? null }));
      o.lines = ls.map((l) => ({ id: l.id, lineNo: l.line_no, poLineId: l.po_line_id, itemId: l.item_id, item: `${l.icode} ${l.iname}`, uom: l.uom, orderedQty: d3(l.ordered_qty), balanceQty: d3(l.balance_qty), challanQty: d3(l.challan_qty), receivedQty: d3(l.received_qty), acceptedQty: d3(l.accepted_qty), rejectedQty: d3(l.rejected_qty), rate: mask(l.rate, actor, g.org_project_id), lineValue: mask(l.line_value, actor, g.org_project_id), batchNo: l.batch_no, heatNo: l.heat_no, mfgDate: l.mfg_date, certFileId: l.cert_file_id, certName: l.cert_file_id ? db.prepare('SELECT original_name FROM core_files WHERE id = ?').get(l.cert_file_id)?.original_name : null,
        inspectionRequired: Boolean(l.inspection_required), inspectionStatus: l.inspection_status, inspectionLabel: INSP_STATUS[l.inspection_status], releasedQty: d3(l.released_qty), qcRejectedQty: d3(l.qc_rejected_qty), awaitingQc: d3(l.accepted_qty - l.released_qty - l.qc_rejected_qty), returnedQty: d3(l.returned_qty), returnableQty: d3(returnable(l)), directCharge: Boolean(l.direct_charge), wbsId: l.wbs_id, costCodeId: l.cost_code_id, excessQty: d3(l.excess_qty) }));
      o.postings = db.prepare("SELECT l.doc_no, l.txn_type, l.txn_date, l.qty_in, l.qty_out, l.value, g.line_no FROM inv_stock_ledger l JOIN inv_grn_lines g ON g.id = CAST(l.source_id AS INTEGER) WHERE l.source_type = 'inv_grn_line' AND g.grn_id = ? ORDER BY l.id").all(g.id).map((p) => ({ docNo: p.doc_no, type: p.txn_type, date: p.txn_date, qty: d3(p.qty_in || p.qty_out), lineNo: p.line_no, value: mask(p.value, actor, g.org_project_id) }));
      o.returns = db.prepare('SELECT id, doc_no, status, total_value FROM inv_rtvs WHERE grn_id = ? AND deleted_at IS NULL ORDER BY id').all(g.id).map((r) => ({ id: r.id, docNo: r.doc_no, status: r.status, totalValue: mask(r.total_value, actor, g.org_project_id) }));
    }
    return o;
  };
  /** What may still go back to the vendor on a line: rejected at the store and failed by QC, less what was returned. */
  const returnable = (l) => Math.max(0, l.rejected_qty + l.qc_rejected_qty - l.returned_qty);
  const gRow = (actor, id, key = 'inv.grn.view') => {
    const g = db.prepare('SELECT * FROM inv_grns WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!g || !may(actor, 'inv.grn.view', g.org_project_id, g.org_site_id)) throw notFound('That goods receipt does not exist.'); if (key !== 'inv.grn.view') need(actor, key, 'do that to this goods receipt', g.org_project_id, g.org_site_id); return g;
  };
  function header(actor, b) {
    let entry = null; let po = null; let poId = b.poId ?? null; let vendorId = b.vendorId ?? null; let storeId = b.storeId ?? null; let challanNo = b.challanNo ?? null; let challanDate = b.challanDate ?? null;
    if (b.gateInwardId) {
      entry = db.prepare('SELECT * FROM inv_gate_inward WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(b.gateInwardId), actor.companyId); if (!entry || !may(actor, 'inv.inward.view', entry.org_project_id, entry.org_site_id)) throw notFound('That gate entry does not exist.');
      if (!['UNLOADING', 'HANDED_OVER', 'EXITED'].includes(entry.status)) throw unprocessable('A goods receipt is made once the vehicle is unloaded: assign the unloading store at the gate first.');
      poId = poId ?? entry.po_id; vendorId = vendorId ?? entry.vendor_id; storeId = storeId ?? entry.unloading_store_id; challanNo = challanNo ?? entry.challan_no; challanDate = challanDate ?? entry.challan_date;
    }
    if (!storeId) fail([{ field: 'storeId', message: 'Choose the store that receives the material' }]); const store = invSvc.storeFor(actor, storeId, 'inv.store.view'); if (store.store_status !== 'ACTIVE') throw unprocessable(`The store ${store.code} is not active.`);
    if (poId) { po = db.prepare('SELECT * FROM proc_purchase_orders WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(poId), actor.companyId); if (!po) fail([{ field: 'poId', message: 'No such purchase order' }]); if (po.status !== 'APPROVED') throw unprocessable(`${po.doc_no} is not open for receipt.`); vendorId = vendorId ?? po.vendor_id; if (po.vendor_id !== rid(vendorId)) fail([{ field: 'vendorId', message: 'The vendor is not the vendor of the order' }]); }
    else { if (!b.emergency) fail([{ field: 'poId', message: 'A goods receipt is made against a purchase order. Without one it is an emergency receipt: say why.' }]); if (!may(actor, 'inv.grn.emergency', store.org_project_id)) throw forbidden('You may not receive without an order (permission inv.grn.emergency).'); if (!vendorId) fail([{ field: 'vendorId', message: 'Choose the vendor' }]); if (!b.emergencyWhy || b.emergencyWhy.trim().length < 10) fail([{ field: 'emergencyWhy', message: 'Say why the material is received without an order (at least 10 characters)' }]); }
    const pid = po?.org_project_id ?? entry?.org_project_id ?? store.org_project_id; if (!pid) fail([{ field: 'storeId', message: 'The store has no project: receive against an order or a gate entry' }]);
    if (!partner(rid(vendorId))) fail([{ field: 'vendorId', message: 'No such vendor' }]);
    return { entry, po, poId: po?.id ?? null, vendorId: rid(vendorId), store, pid, siteId: entry?.org_site_id ?? store.org_site_id ?? null, challanNo, challanDate };
  }
  const grns = {
    list(actor, query) { const sc = scope(actor, 'inv.grn.view'); return runList(db, grnList, parseListRequest(grnList, query), { select: 'x.*', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (g) => grnView(actor, g) }); },
    get: (actor, id) => grnView(actor, gRow(actor, id), { detail: true }),
    prefill, ready,
    summary(actor) { const sc = scope(actor, 'inv.grn.view'); const n = (sql) => db.prepare(sql).get(sc.params).n; return { awaitingApproval: n(`SELECT COUNT(*) AS n FROM inv_grns x WHERE ${sc.sql} AND x.status = 'SUBMITTED' AND x.deleted_at IS NULL`), inspectionPending: n(`SELECT COUNT(*) AS n FROM inv_grn_lines l JOIN inv_grns x ON x.id = l.grn_id WHERE ${sc.sql} AND l.inspection_status = 'PENDING' AND l.deleted_at IS NULL AND x.deleted_at IS NULL`), awaitingGrn: ready(actor).length, openReturns: may(actor, 'inv.rtv.view') ? (() => { const rs = scope(actor, 'inv.rtv.view', 'x', false); return db.prepare(`SELECT COUNT(*) AS n FROM inv_rtvs x WHERE ${rs.sql} AND x.status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND x.deleted_at IS NULL`).get(rs.params).n; })(): 0 }; },
    create(actor, b) {
      const h = header(actor, b); if (h.entry && db.prepare("SELECT 1 FROM inv_grns WHERE gate_inward_id = ? AND status NOT IN ('CANCELLED', 'REJECTED') AND deleted_at IS NULL").get(h.entry.id)) throw conflict('A goods receipt was already made for this gate entry.');
      return transaction(db, () => {
        const no = number(actor.companyId, actor.user, 'INV_GRN', 'inv_grns', 'GRN'); const tmp = { id: null, org_project_id: h.pid }; const lines = buildLines(actor, tmp, b.lines, { poId: h.poId, emergency: Boolean(b.emergency) });
        const id = Number(db.prepare("INSERT INTO inv_grns (company_id, doc_no, received_date, org_project_id, org_site_id, store_id, po_id, gate_inward_id, vendor_id, challan_no, challan_date, invoice_no, emergency, emergency_why, excess, total_value, status, requested_by, project_id, site_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)")
          .run(actor.companyId, no, b.receivedDate ?? todayIST(), h.pid, h.siteId, h.store.id, h.poId, h.entry?.id ?? null, h.vendorId, h.challanNo, h.challanDate, b.invoiceNo ?? null, b.emergency && !h.poId ? 1 : 0, b.emergency && !h.poId ? b.emergencyWhy : null, lines.some((l) => l.excess_qty > 0) ? 1 : 0, lines.reduce((n, l) => n + l.line_value, 0), actor.user, h.pid, h.siteId, actor.user, h.entry ? 'inv_gate_inward' : h.po ? 'proc_purchase_order' : 'api', h.entry ? String(h.entry.id) : h.po ? String(h.po.id) : null).lastInsertRowid);
        saveLines(actor, { id, org_project_id: h.pid, org_site_id: h.siteId }, lines); audit(actor, 'inv_grns', id, 'create', actor.companyId); return grns.get(actor, id);
      });
    },
    update(actor, id, b) {
      const g = gRow(actor, id, 'inv.grn.edit'); if (!EDITABLE.includes(g.status)) throw conflict('Only a draft or a returned receipt is changed.'); if (b.rowVersion && b.rowVersion !== g.version) throw conflict('Someone changed this receipt; reload it.');
      return transaction(db, () => {
        let lines = null; if (b.lines) lines = buildLines(actor, g, b.lines, { poId: g.po_id, emergency: Boolean(g.emergency) });
        db.prepare('UPDATE inv_grns SET challan_no = ?, challan_date = ?, invoice_no = ?, received_date = ?, excess = ?, total_value = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.challanNo !== undefined ? b.challanNo : g.challan_no, b.challanDate !== undefined ? b.challanDate : g.challan_date, b.invoiceNo !== undefined ? b.invoiceNo : g.invoice_no, b.receivedDate ?? g.received_date, lines ? (lines.some((l) => l.excess_qty > 0) ? 1 : 0) : g.excess, lines ? lines.reduce((n, l) => n + l.line_value, 0) : g.total_value, actor.user, nowIso(), g.id);
        if (lines) saveLines(actor, g, lines); audit(actor, 'inv_grns', g.id, 'update', g.company_id); return grns.get(actor, g.id);
      });
    },
    remove(actor, id) { const g = gRow(actor, id, 'inv.grn.delete'); if (g.status !== 'DRAFT') throw conflict('Only a draft is deleted.'); db.prepare('UPDATE inv_grns SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, g.id); audit(actor, 'inv_grns', g.id, 'delete', g.company_id); return { id: g.id, deleted: true }; },
    submit(actor, id) {
      const g = gRow(actor, id, 'inv.grn.submit'); if (!EDITABLE.includes(g.status)) throw unprocessable('Only a draft or a returned receipt is sent for approval.');
      return transaction(db, () => {
        const old = lineRows(g.id); const lines = buildLines(actor, g, old.map((l) => ({ poLineId: l.po_line_id, itemId: l.item_id, uom: l.uom, rate: l.rate / 100, challanQty: d3(l.challan_qty), receivedQty: d3(l.received_qty), acceptedQty: d3(l.accepted_qty), batchNo: l.batch_no, heatNo: l.heat_no, mfgDate: l.mfg_date, certFileId: l.cert_file_id, inspectionRequired: Boolean(l.inspection_required), wbsId: l.wbs_id, costCodeId: l.cost_code_id })), { poId: g.po_id, emergency: Boolean(g.emergency) });
        saveLines(actor, g, lines); const excess = lines.some((l) => l.excess_qty > 0); db.prepare('UPDATE inv_grns SET excess = ?, total_value = ? WHERE id = ?').run(excess ? 1 : 0, lines.reduce((n, l) => n + l.line_value, 0), g.id);
        const ctx = { projectId: g.org_project_id, needProc: excess || g.emergency ? 'yes' : 'no' };
        if (g.status === 'RETURNED' && g.workflow_instance_id) workflowOf(db).resubmit(actor, g.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: INV_GRN_DOC, docId: String(g.id), comment: `${g.doc_no}${excess ? ' (excess receipt)' : ''}${g.emergency ? ' (without an order)' : ''}`.slice(0, 300), context: ctx }); db.prepare('UPDATE inv_grns SET workflow_instance_id = ? WHERE id = ?').run(inst.id, g.id); }
        db.prepare("UPDATE inv_grns SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), g.id); audit(actor, 'inv_grns', g.id, 'submit', g.company_id); return grns.get(actor, g.id);
      });
    },
    withdraw(actor, id, { reason }) { const g = gRow(actor, id); if (g.status !== 'SUBMITTED') throw unprocessable('Only a receipt waiting for approval is withdrawn.'); if (!same(g.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, g.workflow_instance_id, { comment: reason }); return grns.get(actor, g.id); },
    cancel(actor, id, { reason }) { const g = gRow(actor, id, 'inv.grn.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(g.status)) throw unprocessable('Only a receipt not yet approved is cancelled; after posting the material goes back on a return to vendor.'); return transaction(db, () => { if (g.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, g.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE inv_grns SET status = 'CANCELLED', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), g.id); audit(actor, 'inv_grns', g.id, 'cancel', g.company_id, { reason }); return grns.get(actor, g.id); }); },
    /** A posted receipt is locked: the quantities do not change. Its documents (challan, invoice number, date) are corrected with the old values kept in the audit trail; the quantities are corrected by a return to vendor or a stock adjustment. */
    amend(actor, id, b) {
      const g = gRow(actor, id, 'inv.grn.amend'); if (g.status !== 'APPROVED') throw unprocessable('Only an approved receipt is amended.');
      const next = { challan_no: b.challanNo !== undefined ? b.challanNo : g.challan_no, challan_date: b.challanDate !== undefined ? b.challanDate : g.challan_date, invoice_no: b.invoiceNo !== undefined ? b.invoiceNo : g.invoice_no };
      db.prepare('UPDATE inv_grns SET challan_no = ?, challan_date = ?, invoice_no = ?, amendment_no = amendment_no + 1, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(next.challan_no, next.challan_date, next.invoice_no, actor.user, nowIso(), g.id);
      audit(actor, 'inv_grns', g.id, 'amend', g.company_id, { reason: b.reason, oldValues: { challanNo: g.challan_no, challanDate: g.challan_date, invoiceNo: g.invoice_no }, newValues: { challanNo: next.challan_no, challanDate: next.challan_date, invoiceNo: next.invoice_no } }); evt('inv.grn.amended', actor, g.company_id, 'inv_grns', g.id, { grnId: g.id, docNo: g.doc_no, challanNo: next.challan_no, invoiceNo: next.invoice_no, amendmentNo: g.amendment_no + 1 }, g.org_project_id); return grns.get(actor, g.id);
    },
    history(actor, id) { const g = gRow(actor, id); return { approvals: db.prepare('SELECT h.event, h.actor, h.comment, h.at, h.step_code FROM wf_history h JOIN wf_instances i ON i.id = h.instance_id WHERE i.doc_type = ? AND i.doc_id = ? AND i.company_id = ? ORDER BY h.id').all(INV_GRN_DOC, String(g.id), g.company_id), audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'inv_grns' AND entity_id = ? ORDER BY id").all(String(g.id)) }; },
    photo(actor, id, { fileId, kind }) {
      const g = gRow(actor, id); if (!['inv.grn.create', 'inv.grn.edit'].some((k) => may(actor, k, g.org_project_id, g.org_site_id))) throw forbidden('You may not add photos to this receipt (permission inv.grn.create).'); if (['CANCELLED', 'REJECTED'].includes(g.status)) throw conflict('This receipt is closed.');
      const f = fileOk(actor, fileId, 'inv_grn', g.id); const list = json(g.photos_json, []).filter((p) => p.fileId !== f.id); list.push({ fileId: f.id, kind, by: actor.user, at: nowIso() }); db.prepare('UPDATE inv_grns SET photos_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(list), actor.user, nowIso(), g.id); audit(actor, 'inv_grns', g.id, 'photo', g.company_id); return grns.get(actor, g.id);
    },
    certificate(actor, id, { lineId, fileId }) {
      const g = gRow(actor, id); if (!['inv.grn.create', 'inv.grn.edit', 'inv.grn.inspect'].some((k) => may(actor, k, g.org_project_id, g.org_site_id))) throw forbidden('You may not add certificates to this receipt.'); const l = db.prepare('SELECT * FROM inv_grn_lines WHERE id = ? AND grn_id = ? AND deleted_at IS NULL').get(rid(lineId), g.id); if (!l) throw notFound('That line does not exist.'); fileOk(actor, fileId, 'inv_grn', g.id);
      db.prepare('UPDATE inv_grn_lines SET cert_file_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(rid(fileId), actor.user, nowIso(), l.id); audit(actor, 'inv_grns', g.id, 'certificate', g.company_id); return grns.get(actor, g.id);
    },
    /** BR-02: approval posts the accepted quantity. Items that need inspection are held in the inspection stock; the order learns of the receipt by the event; a non-stock item is only charged to its WBS or cost code. */
    decide(instance, actor, outcome, comment) {
      const g = db.prepare('SELECT * FROM inv_grns WHERE id = ?').get(rid(instance.docId)); if (!g || g.status !== 'SUBMITTED') return; const now = nowIso(); const store = db.prepare('SELECT * FROM inv_stores WHERE id = ?').get(g.store_id);
      if (outcome === 'APPROVED') {
        const posted = [];
        for (const l of lineRows(g.id)) {
          const item = stock.itemOf(g.company_id, l.item_id); let ledgerNo = null;
          if (item.stock_tracked && l.accepted_qty > 0) {
            const bq = stock.toBase(item, l.uom, l.accepted_qty, l.rate); const e = stock.postOne(actor, { store, itemId: item.id, batchNo: l.batch_no ?? '', type: 'RECEIPT', qty: bq.qty, rate: bq.rate, date: g.received_date, sourceType: 'inv_grn_line', sourceId: String(l.id), reason: `Goods receipt ${g.doc_no}` }); ledgerNo = e.doc_no;
            if (l.inspection_required) { const bal = stock.balRow(g.company_id, store, e.bin_id, item.id, e.batch_no ?? '', '', e.project_id ?? null); db.prepare('UPDATE inv_balances SET qty_inspection = qty_inspection + ?, updated_at = ?, version = version + 1 WHERE id = ?').run(bq.qty, now, bal.id); }
          }
          posted.push({ lineId: l.id, poLineId: l.po_line_id, itemId: l.item_id, uom: l.uom, receivedQty: d3(l.received_qty), acceptedQty: d3(l.accepted_qty), rejectedQty: d3(l.rejected_qty), rate: l.rate, value: l.line_value, inspectionRequired: Boolean(l.inspection_required), directCharge: Boolean(l.direct_charge), wbsId: l.wbs_id, costCodeId: l.cost_code_id, ledgerNo });
        }
        db.prepare("UPDATE inv_grns SET status = 'APPROVED', approved_by = ?, approved_at = ?, posted_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, now, actor.user, now, g.id); audit(actor, 'inv_grns', g.id, 'approve', g.company_id);
        evt('inv.grn.posted', actor, g.company_id, 'inv_grns', g.id, { grnId: g.id, docNo: g.doc_no, receivedOn: g.received_date, storeId: store.id, storeCode: store.code, poId: g.po_id, vendorId: g.vendor_id, gateInwardId: g.gate_inward_id, challanNo: g.challan_no, invoiceNo: g.invoice_no, emergency: Boolean(g.emergency), totalValue: g.total_value, lines: posted }, g.org_project_id);
        notify(g.company_id, 'inv.grn.decided', [`user:${g.requested_by}`], g.doc_no, 'approved', `${g.doc_no} is approved and posted to the stock ledger.`, `/inv/grns?id=${g.id}`, g.id, { projectId: g.org_project_id });
        if (posted.some((p) => p.inspectionRequired && p.acceptedQty > 0)) notify(g.company_id, 'inv.grn.inspection', ['role:QCE'], g.doc_no, 'material waits for inspection', `${g.doc_no}: material is held in the inspection stock until quality control releases it.`, `/inv/grns?id=${g.id}`, `${g.id}.hold`, { projectId: g.org_project_id });
        return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE inv_grns SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : g.workflow_instance_id, actor.user, now, g.id); audit(actor, 'inv_grns', g.id, outcome.toLowerCase(), g.company_id, { reason: comment });
      notify(g.company_id, 'inv.grn.decided', [`user:${g.requested_by}`], g.doc_no, outcome.toLowerCase(), `${g.doc_no} is ${outcome === 'RETURNED' ? 'returned to you for correction' : outcome === 'REJECTED' ? 'rejected' : 'closed'}${comment ? `: ${comment}` : ''}.`, `/inv/grns?id=${g.id}`, g.id, { projectId: g.org_project_id });
    },
    /** FR-02: quality control passes (released into free stock) or fails (stays held until it goes back to the vendor) what the store accepted. Partial results are kept; the rest stays under inspection. */
    inspect(actor, id, { results }) {
      const g = gRow(actor, id, 'inv.grn.inspect'); if (g.status !== 'APPROVED') throw unprocessable('Only a posted receipt is inspected.'); const store = db.prepare('SELECT * FROM inv_stores WHERE id = ?').get(g.store_id); const problems = [];
      const work = results.map((r, i) => { const l = db.prepare('SELECT * FROM inv_grn_lines WHERE id = ? AND grn_id = ? AND deleted_at IS NULL').get(rid(r.lineId), g.id); if (!l || !l.inspection_required) { problems.push({ field: `results.${i}.lineId`, message: 'This line is not under inspection' }); return null; } const pass = t3(r.passedQty ?? 0); const failQ = t3(r.failedQty ?? 0); const open = l.accepted_qty - l.released_qty - l.qc_rejected_qty; if (pass + failQ <= 0) { problems.push({ field: `results.${i}.passedQty`, message: 'Give a passed or a failed quantity' }); return null; } if (pass + failQ > open) { problems.push({ field: `results.${i}.passedQty`, message: `Only ${d3(open)} is still under inspection` }); return null; } return { l, pass, failQ, note: r.note ?? null }; }).filter(Boolean);
      fail(problems);
      return transaction(db, () => {
        const decided = [];
        for (const w of work) {
          const { l } = w; const item = stock.itemOf(g.company_id, l.item_id); const ledger = db.prepare("SELECT bin_id, batch_no, project_id FROM inv_stock_ledger WHERE source_type = 'inv_grn_line' AND source_id = ? AND txn_type = 'RECEIPT' ORDER BY id LIMIT 1").get(String(l.id)); const bal = stock.balRow(g.company_id, store, ledger.bin_id, item.id, ledger.batch_no ?? '', '', ledger.project_id ?? null);
          const baseOf = (q) => stock.toBase(item, l.uom, q, l.rate).qty; if (w.pass > 0) db.prepare('UPDATE inv_balances SET qty_inspection = MAX(0, qty_inspection - ?), updated_at = ?, version = version + 1 WHERE id = ?').run(baseOf(w.pass), nowIso(), bal.id);
          const released = l.released_qty + w.pass; const failed = l.qc_rejected_qty + w.failQ; const open = l.accepted_qty - released - failed; const status = open > 0 ? 'PENDING' : failed === 0 ? 'PASSED' : released === 0 ? 'FAILED' : 'PARTIAL';
          db.prepare('UPDATE inv_grn_lines SET released_qty = ?, qc_rejected_qty = ?, inspection_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(released, failed, status, actor.user, nowIso(), l.id);
          decided.push({ lineId: l.id, itemId: l.item_id, passedQty: d3(w.pass), failedQty: d3(w.failQ), status, note: w.note });
          evt('inv.stock.moved', actor, g.company_id, 'inv_balances', bal.id, { ledgerId: null, storeId: store.id, storeCode: store.code, storeName: store.name, storeType: store.store_type, siteId: store.org_site_id ?? null, itemId: item.id, txnType: 'INSPECTION_RELEASE', qty: 0, value: 0, freeQty: stock.freeQty(g.company_id, store.id, item.id) / 1000 }, g.org_project_id);
        }
        audit(actor, 'inv_grns', g.id, 'inspect', g.company_id, { newValues: decided }); evt('inv.grn.inspected', actor, g.company_id, 'inv_grns', g.id, { grnId: g.id, docNo: g.doc_no, poId: g.po_id, vendorId: g.vendor_id, lines: decided }, g.org_project_id);
        if (decided.some((d) => d.failedQty > 0)) notify(g.company_id, 'inv.grn.inspection', ['role:STOREMGR|PROCMGR'], g.doc_no, 'material failed inspection', `${g.doc_no}: ${decided.filter((d) => d.failedQty > 0).length} line(s) failed inspection. The failed quantity is held until it is returned to the vendor.`, `/inv/grns?id=${g.id}`, `${g.id}.fail.${Date.now()}`, { projectId: g.org_project_id });
        return grns.get(actor, g.id);
      });
    },
    print(actor, id) {
      const g = gRow(actor, id, 'inv.grn.print'); const v = grnView(actor, g, { detail: true }); audit(actor, 'inv_grns', g.id, 'print', g.company_id);
      const columns = [['n', '#'], ['i', 'Item'], ['c', 'Challan'], ['r', 'Received'], ['a', 'Accepted'], ['x', 'Rejected'], ['b', 'Batch'], ['q', 'Inspection']].map(([key, label]) => ({ key, label, type: 'text' })); const rows = v.lines.map((l) => ({ n: String(l.lineNo), i: l.item, c: String(l.challanQty), r: String(l.receivedQty), a: String(l.acceptedQty), x: String(l.rejectedQty), b: l.batchNo ?? '', q: l.inspectionLabel }));
      return { buffer: toPdf({ columns, rows, footer: [`${v.docNo}: ${v.store}, ${v.vendor}${v.poNo ? `, order ${v.poNo}` : ', without an order'}${v.gateNo ? `, gate entry ${v.gateNo}` : ''}`, `Challan ${v.challanNo ?? '-'} ${v.challanDate ?? ''}; invoice ${v.invoiceNo ?? '-'}`, `Received ${v.date}; entered by ${v.requestedBy}${v.approvedBy ? `; approved by ${v.approvedBy}` : ''}`], title: `Goods receipt ${v.docNo}` }), contentType: 'application/pdf', fileName: `${v.docNo.replaceAll('/', '-')}.pdf`, rows: rows.length };
    },
    importRows(actor, { rows }) {
      need(actor, 'inv.grn.import', 'import goods receipts'); const problems = []; const groups = new Map();
      rows.forEach((x, i) => { const store = db.prepare('SELECT id FROM inv_stores WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, x.storeCode); const po = db.prepare('SELECT id FROM proc_purchase_orders WHERE company_id = ? AND doc_no = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, x.poNo); if (!store) { problems.push({ field: `rows.${i}.storeCode`, message: 'No such store' }); return; } if (!po) { problems.push({ field: `rows.${i}.poNo`, message: 'No such purchase order' }); return; }
        const pl = db.prepare('SELECT l.id FROM proc_po_lines l JOIN mdm_items it ON it.id = l.item_id WHERE l.po_id = ? AND it.code = ? COLLATE NOCASE AND l.deleted_at IS NULL').get(po.id, x.itemCode); if (!pl) { problems.push({ field: `rows.${i}.itemCode`, message: 'Not an item of that order' }); return; }
        const k = `${store.id}|${po.id}|${x.challanNo ?? ''}`; const g = groups.get(k) ?? { storeId: store.id, poId: po.id, challanNo: x.challanNo, lines: [] }; g.lines.push({ poLineId: pl.id, receivedQty: x.receivedQty, acceptedQty: x.acceptedQty, batchNo: x.batchNo }); groups.set(k, g); });
      fail(problems); return transaction(db, () => ({ created: [...groups.values()].map((g) => grns.create(actor, g).docNo) }));
    },
  };

  // ---- returns to vendor (FR-05) ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const rtvOpenQty = (grnLineId, exceptId = null) => db.prepare("SELECT lines_json FROM inv_rtvs WHERE grn_id = (SELECT grn_id FROM inv_grn_lines WHERE id = ?) AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL AND id <> ?").all(grnLineId, exceptId ?? 0).reduce((n, r) => n + json(r.lines_json, []).filter((l) => l.grnLineId === grnLineId).reduce((m, l) => m + l.qty, 0), 0);
  function rtvLines(actor, g, input, exceptId = null) {
    const problems = []; const out = []; const per = new Map();
    input.forEach((x, i) => { const l = db.prepare('SELECT * FROM inv_grn_lines WHERE id = ? AND grn_id = ? AND deleted_at IS NULL').get(rid(x.grnLineId), g.id); if (!l) { problems.push({ field: `lines.${i}.grnLineId`, message: 'Not a line of this receipt' }); return; } const q = t3(x.qty); const used = (per.get(l.id) ?? 0) + q; per.set(l.id, used); const room = returnable(l) - rtvOpenQty(l.id, exceptId);
      if (used > room) { problems.push({ field: `lines.${i}.qty`, message: room > 0 ? `At most ${d3(room)} of this line can still be returned` : 'Nothing of this line can be returned: the rejected quantity is already on a return' }); return; }
      const fromStore = Math.min(q, Math.max(0, l.rejected_qty - l.returned_qty)); out.push({ grnLineId: l.id, itemId: l.item_id, qty: q, uom: l.uom, rate: l.rate, value: valueOf(q, l.rate), fromStock: q - fromStore, batchNo: l.batch_no, reasonNote: x.note ?? null }); });
    fail(problems); if (!out.length) fail([{ field: 'lines', message: 'Choose what goes back' }]); return out;
  }
  const rtvView = (actor, r, { detail = false } = {}) => {
    const can = (k) => may(actor, k, r.org_project_id); const own = same(r.requested_by, actor.user); const g = db.prepare('SELECT doc_no FROM inv_grns WHERE id = ?').get(r.grn_id); const pass = r.gate_pass_id ? db.prepare('SELECT doc_no, status FROM inv_gate_passes WHERE id = ?').get(r.gate_pass_id) : null;
    const o = { id: r.id, docNo: r.doc_no, date: r.rtv_date, projectId: r.org_project_id, grnId: r.grn_id, grnNo: g?.doc_no, vendorId: r.vendor_id, vendor: partner(r.vendor_id)?.name, storeId: r.store_id, reason: r.reason, totalValue: mask(r.total_value, actor, r.org_project_id), gatePassId: r.gate_pass_id, gatePassNo: pass?.doc_no ?? null, gatePassStatus: pass?.status ?? null, debitNote: r.debit_note_trigger, status: r.status, statusLabel: RTV_STATUS[r.status], requestedBy: r.requested_by, approvedBy: r.approved_by, workflowInstanceId: r.workflow_instance_id, cancelReason: r.cancel_reason, rowVersion: r.version, lineCount: json(r.lines_json, []).length,
      can: { edit: can('inv.rtv.edit') && EDITABLE.includes(r.status), delete: can('inv.rtv.delete') && r.status === 'DRAFT', submit: can('inv.rtv.submit') && EDITABLE.includes(r.status), withdraw: r.status === 'SUBMITTED' && own, cancel: can('inv.rtv.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status), print: can('inv.rtv.print') } };
    if (detail) { o.approve = r.status === 'SUBMITTED' && !own && can('inv.rtv.approve'); if (o.approve && r.workflow_instance_id) o.taskId = taskOf(actor, r.workflow_instance_id); o.lines = json(r.lines_json, []).map((l) => ({ ...l, qty: d3(l.qty), fromStock: d3(l.fromStock), item: (() => { const it = db.prepare('SELECT code, name FROM mdm_items WHERE id = ?').get(l.itemId); return `${it?.code} ${it?.name}`; })(), rate: mask(l.rate, actor, r.org_project_id), value: mask(l.value, actor, r.org_project_id) })); }
    return o;
  };
  const rRow = (actor, id, key = 'inv.rtv.view') => { const r = db.prepare('SELECT * FROM inv_rtvs WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r || !may(actor, 'inv.rtv.view', r.org_project_id)) throw notFound('That return does not exist.'); if (key !== 'inv.rtv.view') need(actor, key, 'do that to this return', r.org_project_id); return r; };
  const rtvs = {
    list(actor, query) { const sc = scope(actor, 'inv.rtv.view', 'x', false); return runList(db, rtvList, parseListRequest(rtvList, query), { select: 'x.*', scopeSql: sc.sql, params: { ...sc.params }, tieBreaker: 'x.id', map: (r) => rtvView(actor, r) }); },
    get: (actor, id) => rtvView(actor, rRow(actor, id), { detail: true }),
    create(actor, b) {
      const g = db.prepare('SELECT * FROM inv_grns WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(b.grnId), actor.companyId); if (!g || !may(actor, 'inv.grn.view', g.org_project_id, g.org_site_id)) throw notFound('That goods receipt does not exist.'); need(actor, 'inv.rtv.create', 'return material to a vendor', g.org_project_id); if (g.status !== 'APPROVED') throw unprocessable('Only a posted receipt is returned.');
      const lines = rtvLines(actor, g, b.lines);
      return transaction(db, () => { const no = number(actor.companyId, actor.user, 'INV_RTV', 'inv_rtvs', 'RTV'); const id = Number(db.prepare("INSERT INTO inv_rtvs (company_id, doc_no, rtv_date, org_project_id, grn_id, vendor_id, store_id, reason, lines_json, total_value, status, requested_by, project_id, site_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, 'inv_grn', ?)").run(actor.companyId, no, todayIST(), g.org_project_id, g.id, g.vendor_id, g.store_id, b.reason, JSON.stringify(lines), lines.reduce((n, l) => n + l.value, 0), actor.user, g.org_project_id, g.org_site_id, actor.user, String(g.id)).lastInsertRowid); audit(actor, 'inv_rtvs', id, 'create', actor.companyId); return rtvs.get(actor, id); });
    },
    update(actor, id, b) {
      const r = rRow(actor, id, 'inv.rtv.edit'); if (!EDITABLE.includes(r.status)) throw conflict('Only a draft or a returned return is changed.'); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this return; reload it.'); const g = db.prepare('SELECT * FROM inv_grns WHERE id = ?').get(r.grn_id); const lines = b.lines ? rtvLines(actor, g, b.lines, r.id) : json(r.lines_json, []);
      db.prepare('UPDATE inv_rtvs SET reason = ?, lines_json = ?, total_value = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.reason ?? r.reason, JSON.stringify(lines), lines.reduce((n, l) => n + l.value, 0), actor.user, nowIso(), r.id); audit(actor, 'inv_rtvs', r.id, 'update', r.company_id); return rtvs.get(actor, r.id);
    },
    remove(actor, id) { const r = rRow(actor, id, 'inv.rtv.delete'); if (r.status !== 'DRAFT') throw conflict('Only a draft is deleted.'); db.prepare('UPDATE inv_rtvs SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); audit(actor, 'inv_rtvs', r.id, 'delete', r.company_id); return { id: r.id, deleted: true }; },
    submit(actor, id) {
      const r = rRow(actor, id, 'inv.rtv.submit'); if (!EDITABLE.includes(r.status)) throw unprocessable('Only a draft or a returned return is sent for approval.'); const g = db.prepare('SELECT * FROM inv_grns WHERE id = ?').get(r.grn_id); const lines = rtvLines(actor, g, json(r.lines_json, []).map((l) => ({ grnLineId: l.grnLineId, qty: d3(l.qty), note: l.reasonNote })), r.id);
      return transaction(db, () => { db.prepare('UPDATE inv_rtvs SET lines_json = ?, total_value = ? WHERE id = ?').run(JSON.stringify(lines), lines.reduce((n, l) => n + l.value, 0), r.id); const ctx = { projectId: r.org_project_id };
        if (r.status === 'RETURNED' && r.workflow_instance_id) workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx }); else { const inst = workflowOf(db).submit(actor, { docType: INV_RTV_DOC, docId: String(r.id), comment: `${r.doc_no} to ${partner(r.vendor_id).name}: ${r.reason}`.slice(0, 300), context: ctx }); db.prepare('UPDATE inv_rtvs SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE inv_rtvs SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id); audit(actor, 'inv_rtvs', r.id, 'submit', r.company_id); return rtvs.get(actor, r.id); });
    },
    withdraw(actor, id, { reason }) { const r = rRow(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only a return waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return rtvs.get(actor, r.id); },
    cancel(actor, id, { reason }) { const r = rRow(actor, id, 'inv.rtv.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status)) throw unprocessable('Only a return not yet approved is cancelled.'); return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE inv_rtvs SET status = 'CANCELLED', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'inv_rtvs', r.id, 'cancel', r.company_id, { reason }); return rtvs.get(actor, r.id); }); },
    amend(actor, id) { const r = rRow(actor, id, 'inv.rtv.amend'); void r; throw unprocessable('An approved return has taken the material out of stock and started a debit note; it is not changed. Cancel what is not approved and make a new return.'); },
    history(actor, id) { const r = rRow(actor, id); return { approvals: db.prepare('SELECT h.event, h.actor, h.comment, h.at, h.step_code FROM wf_history h JOIN wf_instances i ON i.id = h.instance_id WHERE i.doc_type = ? AND i.doc_id = ? AND i.company_id = ? ORDER BY h.id').all(INV_RTV_DOC, String(r.id), r.company_id), audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'inv_rtvs' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    /** The approval takes the failed material out of the inspection stock and the stock, raises the vendor-return gate pass (a draft for the storekeeper to send) and triggers the debit note (23.03). */
    decide(instance, actor, outcome, comment) {
      const r = db.prepare('SELECT * FROM inv_rtvs WHERE id = ?').get(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return; const now = nowIso(); const g = db.prepare('SELECT * FROM inv_grns WHERE id = ?').get(r.grn_id); const store = db.prepare('SELECT * FROM inv_stores WHERE id = ?').get(r.store_id);
      if (outcome === 'APPROVED') {
        const lines = json(r.lines_json, []);
        for (const x of lines) {
          const l = db.prepare('SELECT * FROM inv_grn_lines WHERE id = ?').get(x.grnLineId); const item = stock.itemOf(g.company_id, l.item_id);
          const storeLeft = Math.max(0, l.rejected_qty - l.returned_qty); x.fromStock = x.qty - Math.min(x.qty, storeLeft);
          if (x.fromStock > 0 && item.stock_tracked) {
            const ledger = db.prepare("SELECT bin_id, batch_no, project_id FROM inv_stock_ledger WHERE source_type = 'inv_grn_line' AND source_id = ? AND txn_type = 'RECEIPT' ORDER BY id LIMIT 1").get(String(l.id)); const bq = stock.toBase(item, l.uom, x.fromStock, l.rate); const bal = stock.balRow(g.company_id, store, ledger.bin_id, item.id, ledger.batch_no ?? '', '', ledger.project_id ?? null);
            db.prepare('UPDATE inv_balances SET qty_inspection = MAX(0, qty_inspection - ?), updated_at = ?, version = version + 1 WHERE id = ?').run(bq.qty, now, bal.id);
            stock.postOne(actor, { store, itemId: item.id, binId: ledger.bin_id, batchNo: ledger.batch_no ?? '', type: 'ISSUE', qty: bq.qty, ownerProjectId: ledger.project_id ?? undefined, date: todayIST(), sourceType: 'inv_rtv', sourceId: String(r.id), reason: `Return to vendor ${r.doc_no}` });
          }
          db.prepare('UPDATE inv_grn_lines SET returned_qty = returned_qty + ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(x.qty, actor.user, now, l.id);
        }
        const passId = gate.passes.createForReturn(actor, { companyId: r.company_id, projectId: r.org_project_id, siteId: g.org_site_id, vendorId: r.vendor_id, rtv: r, lines: lines.map((x) => ({ description: `${db.prepare('SELECT code FROM mdm_items WHERE id = ?').get(x.itemId)?.code} returned to vendor`, qty: x.qty, uom: x.uom })) });
        db.prepare("UPDATE inv_rtvs SET status = 'APPROVED', lines_json = ?, approved_by = ?, approved_at = ?, posted_at = ?, gate_pass_id = ?, debit_note_trigger = 'TRIGGERED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(lines), actor.user, now, now, passId, actor.user, now, r.id); audit(actor, 'inv_rtvs', r.id, 'approve', r.company_id);
        evt('inv.rtv.posted', actor, r.company_id, 'inv_rtvs', r.id, { rtvId: r.id, docNo: r.doc_no, grnId: g.id, grnNo: g.doc_no, poId: g.po_id, vendorId: r.vendor_id, storeId: r.store_id, reason: r.reason, totalValue: r.total_value, gatePassId: passId, debitNote: true, lines: lines.map((x) => ({ grnLineId: x.grnLineId, itemId: x.itemId, qty: d3(x.qty), rate: x.rate, value: x.value })) }, r.org_project_id);
        notify(r.company_id, 'inv.rtv.decided', [`user:${r.requested_by}`], r.doc_no, 'approved', `${r.doc_no} is approved: the material is out of stock and a vendor-return gate pass is ready to send. The debit note is triggered.`, `/inv/rtvs?id=${r.id}`, r.id, { projectId: r.org_project_id }); return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE inv_rtvs SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, now, r.id); audit(actor, 'inv_rtvs', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
      notify(r.company_id, 'inv.rtv.decided', [`user:${r.requested_by}`], r.doc_no, outcome.toLowerCase(), `${r.doc_no} is ${outcome === 'RETURNED' ? 'returned to you for correction' : outcome === 'REJECTED' ? 'rejected' : 'closed'}${comment ? `: ${comment}` : ''}.`, `/inv/rtvs?id=${r.id}`, r.id, { projectId: r.org_project_id });
    },
    print(actor, id) {
      const r = rRow(actor, id, 'inv.rtv.print'); const v = rtvView(actor, r, { detail: true }); audit(actor, 'inv_rtvs', r.id, 'print', r.company_id); const columns = [['i', 'Item'], ['q', 'Quantity'], ['u', 'Unit'], ['b', 'Batch']].map(([key, label]) => ({ key, label, type: 'text' })); const rows = v.lines.map((l) => ({ i: l.item, q: String(l.qty), u: l.uom, b: l.batchNo ?? '' }));
      return { buffer: toPdf({ columns, rows, footer: [`${v.docNo}: return of ${v.grnNo} to ${v.vendor}`, `Reason: ${v.reason}`, `Requested by ${v.requestedBy}${v.approvedBy ? `; approved by ${v.approvedBy}` : ''}${v.gatePassNo ? `; gate pass ${v.gatePassNo}` : ''}`], title: `Return to vendor ${v.docNo}` }), contentType: 'application/pdf', fileName: `${v.docNo.replaceAll('/', '-')}.pdf`, rows: rows.length };
    },
    importRows(actor, { rows }) {
      need(actor, 'inv.rtv.import', 'import returns'); const problems = []; const groups = new Map();
      rows.forEach((x, i) => { const g = db.prepare('SELECT id FROM inv_grns WHERE company_id = ? AND doc_no = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, x.grnNo); if (!g) { problems.push({ field: `rows.${i}.grnNo`, message: 'No such goods receipt' }); return; } const l = db.prepare('SELECT l.id FROM inv_grn_lines l JOIN mdm_items it ON it.id = l.item_id WHERE l.grn_id = ? AND it.code = ? COLLATE NOCASE AND l.deleted_at IS NULL').get(g.id, x.itemCode); if (!l) { problems.push({ field: `rows.${i}.itemCode`, message: 'Not an item of that receipt' }); return; }
        const k = `${g.id}|${x.reason}`; const e = groups.get(k) ?? { grnId: g.id, reason: x.reason, lines: [] }; e.lines.push({ grnLineId: l.id, qty: x.qty }); groups.set(k, e); });
      fail(problems); return transaction(db, () => ({ created: [...groups.values()].map((g) => rtvs.create(actor, g).docNo) }));
    },
  };
  return { grns, rtvs };
}
