import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { toPdf } from '../../platform/export/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { json, nowIso, rid, same } from '../proc/base.js';

// Gate control (part 16.02): delivery appointments, inbound gate entries checked against the purchase order, the weighbridge, the handover of an unloaded vehicle to stores, and outbound gate passes that are approved before a vehicle may leave and verified at the gate by their QR code.
// Weights are kilograms in thousandths, percentages x10000. A rule is worked out here, never in the page.
export const INV_INWARD_DOC = 'INV_GATE_IN'; export const INV_PASS_DOC = 'INV_GATE_PASS';
export const INWARD_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for acceptance', RETURNED: 'Returned for correction', AT_GATE: 'At the gate', UNLOADING: 'Unloading', HANDED_OVER: 'Handed over to stores', EXITED: 'Left the site', REJECTED: 'Refused at the gate', CANCELLED: 'Cancelled' };
export const PASS_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', RETURNED: 'Returned for correction', APPROVED: 'Approved, not yet out', REJECTED: 'Rejected', CANCELLED: 'Cancelled', OUT: 'Out of the site', CLOSED: 'Closed' };
export const PASS_TYPES = { RETURNABLE: 'Returnable (tools or equipment)', NON_RETURNABLE: 'Non-returnable (transfer or sale)', SCRAP: 'Scrap', VENDOR_RETURN: 'Material returned to a vendor' };
export const APPT_STATUS = { SCHEDULED: 'Expected', ARRIVED: 'Arrived', MISSED: 'Missed', CANCELLED: 'Cancelled' };
export const FLAGS = { NO_PO: 'No purchase order is quoted for this delivery.', PO_NOT_OPEN: 'The purchase order is not open for delivery.', VENDOR_MISMATCH: 'The vendor is not the vendor of the purchase order.', SITE_MISMATCH: 'The purchase order is for another project or site.', PO_FULLY_RECEIVED: 'The purchase order is already fully received.', ITEM_NOT_ON_PO: 'An item is not on the purchase order or has no balance to receive.', DUPLICATE_CHALLAN: 'This vendor challan number was already entered.', WEIGHT_VARIANCE: 'The weighed quantity differs from the challan by more than the tolerance.' };
const EDITABLE = ['DRAFT', 'RETURNED'];
const NEEDS_PM = ['NON_RETURNABLE', 'SCRAP'];

for (const [key, def, description, min, max] of [
  ['inv.gate.weight_tolerance_pct', 20000, 'BR-02: the most the weighed net quantity may differ from the challan quantity before stores and procurement are told. Percent x10000 (2% is 20000).', 0, 1000000],
  ['inv.gate.pass_validity_days', 30, 'How many days an approved gate pass stays valid for a vehicle to leave before it must be amended.', 1, 365],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType: 'integer', default: def, scopes: ['system', 'company'], description, min, max });

const NOW_IST = "date('now', '+330 minutes')";
export const inwardList = defineList({
  code: 'inv.gate_inward', label: 'Gate register (inward)', permission: 'inv.inward.view',
  from: 'inv_gate_inward x JOIN org_sites t ON t.id = x.org_site_id LEFT JOIN mdm_partners v ON v.id = x.vendor_id LEFT JOIN proc_purchase_orders po ON po.id = x.po_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.vehicle_no', 'x.driver_name', 'x.challan_no', 'v.legal_name', 'po.doc_no'], defaultSort: '-date',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Entry' }, date: { sql: 'x.entry_date', type: 'date', label: 'Date' }, vehicle: { sql: 'x.vehicle_no', type: 'text', label: 'Vehicle' }, driver: { sql: 'x.driver_name', type: 'text', label: 'Driver' }, site: { sql: 't.name', type: 'text', label: 'Site' },
    vendor: { sql: "COALESCE(v.legal_name, '')", type: 'text', label: 'Vendor' }, po: { sql: "COALESCE(po.doc_no, '')", type: 'text', label: 'PO' }, challan: { sql: "COALESCE(x.challan_no, '')", type: 'text', label: 'Challan' }, timeIn: { sql: "COALESCE(x.time_in, '')", type: 'text', label: 'In' }, timeOut: { sql: "COALESCE(x.time_out, '')", type: 'text', label: 'Out' },
    unexpected: { sql: "CASE WHEN x.unexpected = 1 THEN 'Y' ELSE 'N' END", type: 'enum', label: 'Unexpected', options: [['Y', 'Unexpected'], ['N', 'Expected']] }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(INWARD_STATUS) },
  },
});
export const passList = defineList({
  code: 'inv.gate_passes', label: 'Gate passes', permission: 'inv.pass.view', from: 'inv_gate_passes x JOIN org_sites t ON t.id = x.org_site_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.destination', 'x.purpose', 'x.vehicle_no'], defaultSort: '-date',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Gate pass' }, date: { sql: 'x.pass_date', type: 'date', label: 'Date' }, site: { sql: 't.name', type: 'text', label: 'Site' }, type: { sql: 'x.pass_type', type: 'enum', label: 'Type', options: Object.entries(PASS_TYPES) }, destination: { sql: 'x.destination', type: 'text', label: 'Destination' },
    vehicle: { sql: "COALESCE(x.vehicle_no, '')", type: 'text', label: 'Vehicle' }, expectedReturn: { sql: "COALESCE(x.expected_return, '')", type: 'date', label: 'Expected back' }, timeOut: { sql: "COALESCE(x.time_out, '')", type: 'text', label: 'Out at' },
    overdue: { sql: `CASE WHEN x.returnable = 1 AND x.status = 'OUT' AND x.expected_return < ${NOW_IST} THEN 'Y' ELSE 'N' END`, type: 'enum', label: 'Overdue', options: [['Y', 'Overdue'], ['N', 'Not overdue']] },
    returnable: { sql: "CASE WHEN x.returnable = 1 THEN 'Y' ELSE 'N' END", type: 'enum', label: 'Returnable', options: [['Y', 'Returnable'], ['N', 'Not returnable']] }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(PASS_STATUS) },
  },
});
export const apptList = defineList({
  code: 'inv.gate_appointments', label: 'Delivery appointments', permission: 'inv.appointment.view', from: 'inv_gate_appointments x JOIN org_sites t ON t.id = x.org_site_id LEFT JOIN mdm_partners v ON v.id = x.vendor_id LEFT JOIN proc_purchase_orders po ON po.id = x.po_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.vehicle_no', 'v.legal_name', 'po.doc_no'], defaultSort: 'expected',
  columns: { docNo: { sql: 'x.doc_no', type: 'text', label: 'Appointment' }, expected: { sql: 'x.expected_on', type: 'date', label: 'Expected on' }, site: { sql: 't.name', type: 'text', label: 'Site' }, vendor: { sql: "COALESCE(v.legal_name, '')", type: 'text', label: 'Vendor' }, po: { sql: "COALESCE(po.doc_no, '')", type: 'text', label: 'PO' }, vehicle: { sql: "COALESCE(x.vehicle_no, '')", type: 'text', label: 'Vehicle' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(APPT_STATUS) } },
});

/** The QR code as a small SVG picture, drawn from the code's own matrix (no image file is made). */
const qrImage = (text) => { const m = QRCode.create(text, { errorCorrectionLevel: 'M' }).modules; const n = m.size; let d = ''; for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) if (m.get(x, y)) d += `M${x + 2} ${y + 2}h1v1h-1z`; const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`; return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`; };
const kg = (n) => (n == null ? null : n / 1000); const vno = (s) => String(s ?? '').toUpperCase().replace(/[\s-]+/g, '') || null; const t3 = (n) => Math.round(Number(n) * 1000);
const minutes = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60_000));

export function createGateService({ db, base, invSvc }) {
  const { authz, may, need, fail, audit, notify, number, param } = base;
  const evt = (type, actor, companyId, entity, entityId, data, projectId) => publishEvent(db, { type, entity, entityId, actorId: actor?.user ?? 'system', companyId, projectId: projectId ?? undefined, data });
  const scope = (actor, key, alias = 'x') => { need(actor, key, 'see the gate records'); const f = authz.scopeFilter(actor, key, { project: `${alias}.org_project_id`, site: `${alias}.org_site_id` }); return { sql: `${alias}.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  const siteOf = (actor, siteId, key) => {
    const s = db.prepare("SELECT t.id, t.code, t.name, t.org_project_id, p.code AS pcode FROM org_sites t JOIN org_projects p ON p.id = t.org_project_id WHERE t.id = ? AND t.company_id = ? AND t.deleted_at IS NULL AND t.status = 'ACTIVE'").get(rid(siteId), actor.companyId);
    if (!s || !may(actor, key, s.org_project_id, s.id)) throw notFound('That site does not exist, or you may not use it.'); return s;
  };
  const fileOf = (actor, fileId, entity, entityId) => { const f = db.prepare('SELECT id, original_name FROM core_files WHERE id = ? AND company_id = ? AND linked_entity = ? AND linked_id = ?').get(rid(fileId), actor.companyId, entity, entityId); if (!f) throw unprocessable('That file is not attached to this record. Upload it to the record first.'); return f; };
  const taskOf = (actor, instanceId) => workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === instanceId)?.id ?? null;
  const partner = (id) => (id ? db.prepare('SELECT id, code, legal_name AS name FROM mdm_partners WHERE id = ?').get(id) : null);

  // ---- the purchase order at the gate (FR-02) --------------------------------------------------------------------------------------------------------------------------------------------------------
  function poLines(poId) { return db.prepare('SELECT l.id, l.line_no, l.item_id, l.description, l.qty, l.received_qty, l.uom FROM proc_po_lines l WHERE l.po_id = ? AND l.deleted_at IS NULL ORDER BY l.line_no').all(poId).map((l) => ({ id: l.id, lineNo: l.line_no, itemId: l.item_id, description: l.description, uom: l.uom, qty: l.qty / 1000, received: l.received_qty / 1000, balance: Math.max(0, l.qty - l.received_qty) / 1000 })); }
  /** Checks a delivery against the order. Returns the flags (each a reason the delivery was not expected) and the order. */
  function checkPo(actor, b, site, selfId = null) {
    const flags = []; const problems = []; let po = null;
    if (!b.poId) flags.push('NO_PO');
    else {
      po = db.prepare('SELECT * FROM proc_purchase_orders WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(b.poId), actor.companyId);
      if (!po) problems.push({ field: 'poId', message: 'That purchase order does not exist.' });
      else {
        if (po.status !== 'APPROVED') flags.push('PO_NOT_OPEN');
        if (b.vendorId && po.vendor_id !== rid(b.vendorId)) flags.push('VENDOR_MISMATCH');
        if (po.org_project_id !== site.org_project_id || (po.po_site_id && po.po_site_id !== site.id)) flags.push('SITE_MISMATCH');
        const ls = db.prepare('SELECT item_id, qty, received_qty FROM proc_po_lines WHERE po_id = ? AND deleted_at IS NULL').all(po.id);
        if (po.status === 'APPROVED' && ls.length && ls.every((l) => l.received_qty >= l.qty)) flags.push('PO_FULLY_RECEIVED');
        if (b.itemIds?.length && b.itemIds.some((i) => !ls.some((l) => l.item_id === rid(i) && l.received_qty < l.qty))) flags.push('ITEM_NOT_ON_PO');
      }
    }
    fail(problems);
    const vendorId = b.vendorId ?? po?.vendor_id ?? null;
    if (b.challanNo && vendorId && db.prepare("SELECT 1 FROM inv_gate_inward WHERE company_id = ? AND vendor_id = ? AND challan_no = ? COLLATE NOCASE AND status NOT IN ('CANCELLED', 'REJECTED') AND deleted_at IS NULL AND id <> ?").get(actor.companyId, vendorId, b.challanNo, selfId ?? 0)) flags.push('DUPLICATE_CHALLAN');
    return { flags: [...new Set(flags)], po, vendorId };
  }
  const flagList = (codes) => codes.map((code) => ({ code, message: FLAGS[code] }));
  const lookupPo = (actor, q = {}) => {
    need(actor, 'inv.inward.create', 'look up purchase orders');
    const rows = db.prepare(`SELECT po.id, po.doc_no, po.vendor_id, po.org_project_id, po.po_site_id, v.legal_name AS vendor, p.code AS pcode FROM proc_purchase_orders po JOIN mdm_partners v ON v.id = po.vendor_id JOIN org_projects p ON p.id = po.org_project_id WHERE po.company_id = ? AND po.deleted_at IS NULL AND po.status = 'APPROVED' ${q.vendorId ? 'AND po.vendor_id = ?' : ''} AND (po.doc_no LIKE ? OR v.legal_name LIKE ?) ORDER BY po.id DESC LIMIT 25`).all(actor.companyId, ...(q.vendorId ? [rid(q.vendorId)] : []), `%${q.q ?? ''}%`, `%${q.q ?? ''}%`);
    return rows.filter((r) => may(actor, 'inv.inward.create', r.org_project_id)).map((r) => ({ id: r.id, docNo: r.doc_no, vendorId: r.vendor_id, vendor: r.vendor, project: r.pcode, siteId: r.po_site_id, lines: poLines(r.id) }));
  };

  // ---- inbound gate entries (FR-01) -------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const photosOf = (r) => json(r.photos_json, []).map((p) => ({ ...p, name: db.prepare('SELECT original_name FROM core_files WHERE id = ?').get(p.fileId)?.original_name ?? null }));
  const activeWeigh = (inwardId) => db.prepare('SELECT * FROM inv_gate_weighments WHERE inward_id = ? AND superseded = 0 AND deleted_at IS NULL ORDER BY id DESC LIMIT 1').get(inwardId);
  const weighView = (w) => (w ? { id: w.id, grossKg: kg(w.gross_kg), tareKg: kg(w.tare_kg), netKg: kg(w.net_kg), challanKg: kg(w.challan_kg), variancePct: w.variance_pct == null ? null : w.variance_pct / 10000, tolerancePct: w.tolerance_pct / 10000, flagged: Boolean(w.flagged), source: w.weigh_source, deviceRef: w.device_ref, slipFileId: w.slip_file_id, weighedBy: w.weighed_by, weighedAt: w.weighed_at, complete: w.net_kg != null } : null);
  const inwardView = (actor, r, { detail = false } = {}) => {
    const can = (k) => may(actor, k, r.org_project_id, r.org_site_id); const own = same(r.requested_by, actor.user); const w = activeWeigh(r.id);
    const site = db.prepare('SELECT code, name FROM org_sites WHERE id = ?').get(r.org_site_id); const v = partner(r.vendor_id); const po = r.po_id ? db.prepare('SELECT doc_no FROM proc_purchase_orders WHERE id = ?').get(r.po_id) : null;
    const o = { id: r.id, docNo: r.doc_no, date: r.entry_date, siteId: r.org_site_id, site: site?.name, projectId: r.org_project_id, vehicleNo: r.vehicle_no, driverName: r.driver_name, driverPhone: r.driver_phone, transporter: r.transporter, vendorId: r.vendor_id, vendor: v?.name ?? null, poId: r.po_id, poNo: po?.doc_no ?? null, shipmentId: r.shipment_id, appointmentId: r.appointment_id,
      challanNo: r.challan_no, challanDate: r.challan_date, challanKg: kg(r.challan_kg), ewayBillNo: r.eway_bill_no, materialDesc: r.material_desc, timeIn: r.time_in, timeOut: r.time_out, turnaroundMin: r.time_in && r.time_out ? minutes(r.time_in, r.time_out) : null, unloadingStoreId: r.unloading_store_id, unloadingNote: r.unloading_note,
      unexpected: Boolean(r.unexpected), unexpectedWhy: r.unexpected_why, flags: json(r.flags_json, []), status: r.status, statusLabel: INWARD_STATUS[r.status], requestedBy: r.requested_by, approvedBy: r.approved_by, handedOverBy: r.handed_over_by, handedOverAt: r.handed_over_at, workflowInstanceId: r.workflow_instance_id, amendmentNo: r.amendment_no, cancelReason: r.cancel_reason, rowVersion: r.version, weighment: weighView(w),
      can: { edit: can('inv.inward.edit') && EDITABLE.includes(r.status), delete: can('inv.inward.delete') && r.status === 'DRAFT', submit: can('inv.inward.submit') && EDITABLE.includes(r.status), withdraw: r.status === 'SUBMITTED' && own, cancel: can('inv.inward.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED', 'AT_GATE'].includes(r.status), amend: can('inv.inward.amend') && ['AT_GATE', 'UNLOADING'].includes(r.status),
        weigh: can('inv.inward.weigh') && ['AT_GATE', 'UNLOADING'].includes(r.status), unload: can('inv.inward.handover') && ['AT_GATE', 'UNLOADING'].includes(r.status), handover: can('inv.inward.handover') && r.status === 'UNLOADING', exit: can('inv.inward.exit') && r.status === 'HANDED_OVER', photo: can('inv.inward.edit') || can('inv.inward.weigh') || can('inv.inward.create') } };
    if (detail) {
      o.can.approve = r.status === 'SUBMITTED' && !own && can('inv.inward.approve'); if (o.can.approve && r.workflow_instance_id) o.taskId = taskOf(actor, r.workflow_instance_id);
      o.photos = photosOf(r); o.po = r.po_id ? { id: r.po_id, docNo: po?.doc_no, lines: poLines(r.po_id) } : null;
      o.unloadingStore = r.unloading_store_id ? db.prepare('SELECT id, code, name FROM inv_stores WHERE id = ?').get(r.unloading_store_id) : null; o.weighments = db.prepare('SELECT * FROM inv_gate_weighments WHERE inward_id = ? AND deleted_at IS NULL ORDER BY id').all(r.id).map((x) => ({ ...weighView(x), superseded: Boolean(x.superseded) }));
    }
    return o;
  };
  const inRow = (actor, id, key = 'inv.inward.view') => {
    const r = db.prepare('SELECT * FROM inv_gate_inward WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'inv.inward.view', r.org_project_id, r.org_site_id)) throw notFound('That gate entry does not exist.'); if (key !== 'inv.inward.view') need(actor, key, 'do that to this gate entry', r.org_project_id, r.org_site_id); return r;
  };
  const apptOf = (actor, id, site) => { if (!id) return null; const a = db.prepare('SELECT * FROM inv_gate_appointments WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!a || a.org_site_id !== site.id) throw unprocessable('That appointment is not for this site.'); return a; };
  const inwardFields = (actor, b) => ({ vehicle_no: vno(b.vehicleNo), driver_name: b.driverName, driver_phone: b.driverPhone ?? null, transporter: b.transporter ?? null, challan_no: b.challanNo ?? null, challan_date: b.challanDate ?? null, challan_kg: b.challanKg == null ? null : t3(b.challanKg), eway_bill_no: b.ewayBillNo ?? null, material_desc: b.materialDesc, po_id: b.poId ?? null, vendor_id: b.vendorId ?? null, shipment_id: b.shipmentId ?? null, appointment_id: b.appointmentId ?? null });
  const inward = {
    list(actor, query) { const sc = scope(actor, 'inv.inward.view'); return runList(db, inwardList, parseListRequest(inwardList, query), { select: 'x.*', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (r) => ({ id: r.id, docNo: r.doc_no, date: r.entry_date, vehicle: r.vehicle_no, driver: r.driver_name, site: db.prepare('SELECT name FROM org_sites WHERE id = ?').get(r.org_site_id)?.name, vendor: partner(r.vendor_id)?.name ?? null, po: r.po_id ? db.prepare('SELECT doc_no FROM proc_purchase_orders WHERE id = ?').get(r.po_id)?.doc_no : null, challan: r.challan_no, timeIn: r.time_in, timeOut: r.time_out, unexpected: Boolean(r.unexpected), status: r.status, statusLabel: INWARD_STATUS[r.status] }) }); },
    get: (actor, id) => inwardView(actor, inRow(actor, id), { detail: true }),
    check: (actor, b) => { const site = siteOf(actor, b.siteId, 'inv.inward.create'); const c = checkPo(actor, b, site); return { flags: flagList(c.flags), unexpected: c.flags.length > 0, vendorId: c.vendorId }; },
    lookupPo,
    create(actor, b) {
      const site = siteOf(actor, b.siteId, 'inv.inward.create'); apptOf(actor, b.appointmentId, site); const c = checkPo(actor, b, site); const f = inwardFields(actor, { ...b, vendorId: c.vendorId });
      return transaction(db, () => {
        const no = number(actor.companyId, actor.user, 'INV_GATE_INWARD', 'inv_gate_inward', 'GIN');
        const id = Number(db.prepare("INSERT INTO inv_gate_inward (company_id, doc_no, entry_date, org_project_id, org_site_id, appointment_id, vehicle_no, driver_name, driver_phone, transporter, vendor_id, po_id, shipment_id, challan_no, challan_date, challan_kg, eway_bill_no, material_desc, unexpected, flags_json, status, requested_by, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, 'api')")
          .run(actor.companyId, no, todayIST(), site.org_project_id, site.id, f.appointment_id, f.vehicle_no, f.driver_name, f.driver_phone, f.transporter, f.vendor_id, f.po_id, f.shipment_id, f.challan_no, f.challan_date, f.challan_kg, f.eway_bill_no, f.material_desc, c.flags.length ? 1 : 0, JSON.stringify(flagList(c.flags)), actor.user, site.org_project_id, site.id, actor.user).lastInsertRowid);
        audit(actor, 'inv_gate_inward', id, 'create', actor.companyId); return inward.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = inRow(actor, id, 'inv.inward.edit'); if (!EDITABLE.includes(r.status)) throw conflict('Only a draft or a returned entry is changed.'); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this entry; reload it.');
      const site = db.prepare('SELECT t.id, t.org_project_id FROM org_sites t WHERE t.id = ?').get(r.org_site_id); const merged = { vehicleNo: r.vehicle_no, driverName: r.driver_name, driverPhone: r.driver_phone, transporter: r.transporter, challanNo: r.challan_no, challanDate: r.challan_date, challanKg: kg(r.challan_kg), ewayBillNo: r.eway_bill_no, materialDesc: r.material_desc, poId: r.po_id, vendorId: r.vendor_id, shipmentId: r.shipment_id, appointmentId: r.appointment_id, ...b };
      const c = checkPo(actor, merged, site, r.id); const f = inwardFields(actor, { ...merged, vendorId: merged.vendorId ?? c.vendorId });
      db.prepare('UPDATE inv_gate_inward SET vehicle_no = ?, driver_name = ?, driver_phone = ?, transporter = ?, challan_no = ?, challan_date = ?, challan_kg = ?, eway_bill_no = ?, material_desc = ?, po_id = ?, vendor_id = ?, shipment_id = ?, appointment_id = ?, unexpected = ?, flags_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(f.vehicle_no, f.driver_name, f.driver_phone, f.transporter, f.challan_no, f.challan_date, f.challan_kg, f.eway_bill_no, f.material_desc, f.po_id, f.vendor_id, f.shipment_id, f.appointment_id, c.flags.length ? 1 : 0, JSON.stringify(flagList(c.flags)), actor.user, nowIso(), r.id);
      audit(actor, 'inv_gate_inward', r.id, 'update', r.company_id); return inward.get(actor, r.id);
    },
    remove(actor, id) { const r = inRow(actor, id, 'inv.inward.delete'); if (r.status !== 'DRAFT') throw conflict('Only a draft is deleted.'); db.prepare('UPDATE inv_gate_inward SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); audit(actor, 'inv_gate_inward', r.id, 'delete', r.company_id); return { id: r.id, deleted: true }; },
    /** Submitting records the vehicle at the gate. A delivery that is not expected (no open order for the vendor and item) is held for the store manager to accept. */
    submit(actor, id) {
      const r = inRow(actor, id, 'inv.inward.submit'); if (!EDITABLE.includes(r.status)) throw unprocessable('Only a draft or a returned entry is submitted.');
      const site = db.prepare('SELECT id, org_project_id FROM org_sites WHERE id = ?').get(r.org_site_id); const c = checkPo(actor, { poId: r.po_id, vendorId: r.vendor_id, challanNo: r.challan_no }, site, r.id); const flags = [...new Set([...c.flags, ...json(r.flags_json, []).map((x) => x.code).filter((x) => x === 'WEIGHT_VARIANCE')])];
      return transaction(db, () => {
        const now = nowIso(); db.prepare('UPDATE inv_gate_inward SET unexpected = ?, flags_json = ?, time_in = COALESCE(time_in, ?), requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(c.flags.length ? 1 : 0, JSON.stringify(flagList(flags)), now, actor.user, actor.user, now, r.id);
        if (c.flags.length) {
          const ctx = { projectId: r.org_project_id }; if (r.status === 'RETURNED' && r.workflow_instance_id) workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
          else { const inst = workflowOf(db).submit(actor, { docType: INV_INWARD_DOC, docId: String(r.id), comment: `${r.doc_no} ${r.vehicle_no}: ${c.flags.map((f) => FLAGS[f]).join(' ')}`.slice(0, 300), context: ctx }); db.prepare('UPDATE inv_gate_inward SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
          db.prepare("UPDATE inv_gate_inward SET status = 'SUBMITTED' WHERE id = ?").run(r.id);
          notify(r.company_id, 'inv.gate.flag', ['role:STOREMGR|PROCMGR'], r.doc_no, 'unexpected delivery', `Vehicle ${r.vehicle_no} is at the gate with a delivery that is not expected: ${c.flags.map((f) => FLAGS[f]).join(' ')}`, `/inv/gate-entry?id=${r.id}`, r.id, { projectId: r.org_project_id });
          evt('inv.gate.flagged', actor, r.company_id, 'inv_gate_inward', r.id, { inwardId: r.id, docNo: r.doc_no, vehicleNo: r.vehicle_no, poId: r.po_id, vendorId: c.vendorId, flags: c.flags }, r.org_project_id);
        } else { db.prepare("UPDATE inv_gate_inward SET status = 'AT_GATE' WHERE id = ?").run(r.id); inward.entered(actor, r.id); }
        audit(actor, 'inv_gate_inward', r.id, 'submit', r.company_id); return inward.get(actor, r.id);
      });
    },
    entered(actor, id) {
      const r = db.prepare('SELECT * FROM inv_gate_inward WHERE id = ?').get(id); if (r.appointment_id) db.prepare("UPDATE inv_gate_appointments SET status = 'ARRIVED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'SCHEDULED'").run(actor.user, nowIso(), r.appointment_id);
      evt('inv.gate.entered', actor, r.company_id, 'inv_gate_inward', r.id, { inwardId: r.id, docNo: r.doc_no, vehicleNo: r.vehicle_no, siteId: r.org_site_id, poId: r.po_id, vendorId: r.vendor_id, shipmentId: r.shipment_id, challanNo: r.challan_no, timeIn: r.time_in, unexpected: Boolean(r.unexpected) }, r.org_project_id);
    },
    withdraw(actor, id, { reason }) { const r = inRow(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only an entry waiting for acceptance is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return inward.get(actor, r.id); },
    cancel(actor, id, { reason }) {
      const r = inRow(actor, id, 'inv.inward.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED', 'AT_GATE'].includes(r.status)) throw unprocessable('Only an entry that has not started unloading is cancelled.');
      return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE inv_gate_inward SET status = 'CANCELLED', cancel_reason = ?, time_out = CASE WHEN time_in IS NOT NULL THEN ? ELSE time_out END, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, nowIso(), actor.user, nowIso(), r.id); audit(actor, 'inv_gate_inward', r.id, 'cancel', r.company_id, { reason }); return inward.get(actor, r.id); });
    },
    /** An entry that is at the gate or unloading, and has not been handed over, is reopened as a draft to be corrected and submitted again. */
    amend(actor, id, { reason }) {
      const r = inRow(actor, id, 'inv.inward.amend'); if (!['AT_GATE', 'UNLOADING'].includes(r.status)) throw unprocessable('Only an entry at the gate or unloading is amended; after the handover the stores correct the receipt.');
      db.prepare("UPDATE inv_gate_inward SET status = 'DRAFT', amendment_no = amendment_no + 1, workflow_instance_id = NULL, unloading_store_id = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), r.id); audit(actor, 'inv_gate_inward', r.id, 'amend', r.company_id, { reason }); return inward.get(actor, r.id);
    },
    history(actor, id) { const r = inRow(actor, id); return { approvals: db.prepare('SELECT h.event, h.actor, h.comment, h.at, h.step_code FROM wf_history h JOIN wf_instances i ON i.id = h.instance_id WHERE i.doc_type = ? AND i.doc_id = ? AND i.company_id = ? ORDER BY h.id').all(INV_INWARD_DOC, String(r.id), r.company_id), audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity IN ('inv_gate_inward') AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    /** The store manager accepts an unexpected delivery, refuses it, or returns it for correction. */
    decide(instance, actor, outcome, comment) {
      const r = db.prepare('SELECT * FROM inv_gate_inward WHERE id = ?').get(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return; const now = nowIso();
      if (outcome === 'APPROVED') { db.prepare("UPDATE inv_gate_inward SET status = 'AT_GATE', approved_by = ?, approved_at = ?, unexpected_why = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, comment ?? null, actor.user, now, r.id); audit(actor, 'inv_gate_inward', r.id, 'accept', r.company_id); inward.entered(actor, r.id); notify(r.company_id, 'inv.gate.decided', [`user:${r.requested_by}`], r.doc_no, 'accepted', `${r.doc_no}: the unexpected delivery of vehicle ${r.vehicle_no} is accepted. It may unload.`, `/inv/gate-entry?id=${r.id}`, r.id, { projectId: r.org_project_id }); return; }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE inv_gate_inward SET status = ?, workflow_instance_id = ?, time_out = CASE WHEN ? IN (\'REJECTED\', \'CANCELLED\') THEN ? ELSE time_out END, cancel_reason = CASE WHEN ? = \'REJECTED\' THEN ? ELSE cancel_reason END, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, to, now, to, comment ?? null, actor.user, now, r.id);
      audit(actor, 'inv_gate_inward', r.id, outcome.toLowerCase(), r.company_id, { reason: comment }); notify(r.company_id, 'inv.gate.decided', [`user:${r.requested_by}`], r.doc_no, outcome.toLowerCase(), `${r.doc_no}: ${outcome === 'REJECTED' ? 'the delivery is refused at the gate' : outcome === 'RETURNED' ? 'returned to you for correction' : 'closed'}${comment ? `: ${comment}` : ''}.`, `/inv/gate-entry?id=${r.id}`, r.id, { projectId: r.org_project_id });
    },
    // the weighbridge (FR-03, BR-02)
    weigh(actor, id, b) {
      const r = inRow(actor, id, 'inv.inward.weigh'); if (!['AT_GATE', 'UNLOADING'].includes(r.status)) throw unprocessable('A vehicle is weighed while it is at the gate or unloading.');
      return transaction(db, () => {
        const w = activeWeigh(r.id); const gross = b.grossKg != null ? t3(b.grossKg) : (w?.gross_kg ?? null); const tare = b.tareKg != null ? t3(b.tareKg) : (w?.tare_kg ?? null);
        if (gross == null && tare == null) fail([{ field: 'grossKg', message: 'Give the gross or the tare weight' }]); if (gross != null && tare != null && tare >= gross) fail([{ field: 'tareKg', message: 'The tare must be less than the gross weight' }]);
        const net = gross != null && tare != null ? gross - tare : null; const challan = r.challan_kg; const tol = Number(param(r.company_id, 'inv.gate.weight_tolerance_pct') ?? 20000);
        const variance = net != null && challan ? Math.round(((net - challan) * 1_000_000) / challan) : null; const flagged = variance != null && Math.abs(variance) > tol ? 1 : 0;
        const slip = b.slipFileId ? fileOf(actor, b.slipFileId, 'inv_gate_inward', r.id).id : (w?.slip_file_id ?? null); const now = nowIso();
        if (w) db.prepare('UPDATE inv_gate_weighments SET gross_kg = ?, tare_kg = ?, net_kg = ?, challan_kg = ?, variance_pct = ?, tolerance_pct = ?, flagged = ?, weigh_source = ?, device_ref = ?, slip_file_id = ?, weighed_by = ?, weighed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(gross, tare, net, challan, variance, tol, flagged, b.source ?? w.weigh_source, b.deviceRef ?? w.device_ref, slip, actor.user, now, actor.user, now, w.id);
        else db.prepare('INSERT INTO inv_gate_weighments (company_id, inward_id, gross_kg, tare_kg, net_kg, challan_kg, variance_pct, tolerance_pct, flagged, weigh_source, device_ref, slip_file_id, weighed_by, weighed_at, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(r.company_id, r.id, gross, tare, net, challan, variance, tol, flagged, b.source ?? 'MANUAL', b.deviceRef ?? null, slip, actor.user, now, r.org_project_id, r.org_site_id, actor.user, 'api');
        const flags = json(r.flags_json, []).filter((f) => f.code !== 'WEIGHT_VARIANCE'); if (flagged) flags.push({ code: 'WEIGHT_VARIANCE', message: FLAGS.WEIGHT_VARIANCE });
        db.prepare('UPDATE inv_gate_inward SET flags_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(flags), actor.user, now, r.id); audit(actor, 'inv_gate_inward', r.id, 'weigh', r.company_id);
        if (net != null) {
          evt('inv.weighment.recorded', actor, r.company_id, 'inv_gate_inward', r.id, { inwardId: r.id, docNo: r.doc_no, grossKg: kg(gross), tareKg: kg(tare), netKg: kg(net), challanKg: kg(challan), variancePct: variance == null ? null : variance / 10000, flagged: Boolean(flagged), poId: r.po_id }, r.org_project_id);
          if (flagged) { evt('inv.weighment.variance', actor, r.company_id, 'inv_gate_inward', r.id, { inwardId: r.id, docNo: r.doc_no, vendorId: r.vendor_id, poId: r.po_id, netKg: kg(net), challanKg: kg(challan), variancePct: variance / 10000, tolerancePct: tol / 10000 }, r.org_project_id); notify(r.company_id, 'inv.gate.flag', ['role:STOREMGR|PROCMGR'], r.doc_no, 'weight differs from challan', `${r.doc_no}: the weighed quantity ${kg(net)} kg differs from the challan ${kg(challan)} kg by ${(variance / 10000).toFixed(2)}% (tolerance ${(tol / 10000).toFixed(2)}%).`, `/inv/gate-entry?id=${r.id}`, `${r.id}.${net}`, { projectId: r.org_project_id }); }
        }
        return inward.get(actor, r.id);
      });
    },
    // unloading location and the handover to stores (FR-04)
    unload(actor, id, { storeId, note }) {
      const r = inRow(actor, id, 'inv.inward.handover'); if (!['AT_GATE', 'UNLOADING'].includes(r.status)) throw unprocessable('A store is assigned while the vehicle is at the gate or unloading.');
      const s = invSvc.storeFor(actor, storeId); if (s.store_status !== 'ACTIVE') throw unprocessable('Choose an active store.'); if (s.org_project_id && s.org_project_id !== r.org_project_id) throw unprocessable('That store belongs to another project.');
      db.prepare("UPDATE inv_gate_inward SET unloading_store_id = ?, unloading_note = ?, status = 'UNLOADING', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(s.id, note ?? null, actor.user, nowIso(), r.id); audit(actor, 'inv_gate_inward', r.id, 'unload', r.company_id); return inward.get(actor, r.id);
    },
    handover(actor, id) {
      const r = inRow(actor, id, 'inv.inward.handover'); if (r.status !== 'UNLOADING' || !r.unloading_store_id) throw unprocessable('Assign the unloading store first.'); const w = activeWeigh(r.id); if (w && w.net_kg == null) throw unprocessable('The weighing is not finished: give the tare weight (or the gross weight) first.');
      return transaction(db, () => {
        const now = nowIso(); db.prepare("UPDATE inv_gate_inward SET status = 'HANDED_OVER', handed_over_by = ?, handed_over_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, r.id); audit(actor, 'inv_gate_inward', r.id, 'handover', r.company_id);
        const s = db.prepare('SELECT id, code, name FROM inv_stores WHERE id = ?').get(r.unloading_store_id);
        evt('inv.gate.handed_over', actor, r.company_id, 'inv_gate_inward', r.id, { inwardId: r.id, docNo: r.doc_no, storeId: s.id, storeCode: s.code, vehicleNo: r.vehicle_no, poId: r.po_id, vendorId: r.vendor_id, shipmentId: r.shipment_id, challanNo: r.challan_no, challanKg: kg(r.challan_kg), netKg: kg(w?.net_kg), materialDesc: r.material_desc, unexpected: Boolean(r.unexpected) }, r.org_project_id);
        notify(r.company_id, 'inv.gate.decided', ['role:STOREMGR'], r.doc_no, 'handed over to stores', `${r.doc_no}: ${r.material_desc} from vehicle ${r.vehicle_no} is unloaded at ${s.code} and handed over for the goods receipt.`, `/inv/gate-entry?id=${r.id}`, `${r.id}.handover`, { projectId: r.org_project_id }); return inward.get(actor, r.id);
      });
    },
    exit(actor, id) {
      const r = inRow(actor, id, 'inv.inward.exit'); if (r.status !== 'HANDED_OVER') throw unprocessable('A vehicle leaves after the material is handed over to stores.'); const now = nowIso();
      db.prepare("UPDATE inv_gate_inward SET status = 'EXITED', time_out = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(now, actor.user, now, r.id); audit(actor, 'inv_gate_inward', r.id, 'exit', r.company_id);
      evt('inv.gate.exited', actor, r.company_id, 'inv_gate_inward', r.id, { inwardId: r.id, docNo: r.doc_no, vehicleNo: r.vehicle_no, timeIn: r.time_in, timeOut: now, turnaroundMin: r.time_in ? minutes(r.time_in, now) : null }, r.org_project_id); return inward.get(actor, r.id);
    },
    photo(actor, id, { fileId, kind }) {
      const r = inRow(actor, id); if (!['inv.inward.edit', 'inv.inward.weigh', 'inv.inward.create'].some((k) => may(actor, k, r.org_project_id, r.org_site_id))) throw forbidden('You may not add photos to this entry (permission inv.inward.create).'); if (['CANCELLED', 'REJECTED', 'EXITED'].includes(r.status)) throw conflict('This entry is closed.');
      const f = fileOf(actor, fileId, 'inv_gate_inward', r.id); const list = json(r.photos_json, []).filter((p) => p.fileId !== f.id); list.push({ fileId: f.id, kind, by: actor.user, at: nowIso() });
      db.prepare('UPDATE inv_gate_inward SET photos_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(list), actor.user, nowIso(), r.id); audit(actor, 'inv_gate_inward', r.id, 'photo', r.company_id); return inward.get(actor, r.id);
    },
    print(actor, id) {
      const r = inRow(actor, id, 'inv.inward.print'); const v = inwardView(actor, r, { detail: true }); audit(actor, 'inv_gate_inward', r.id, 'print', r.company_id);
      const columns = [['k', 'Detail'], ['v', 'Value']].map(([key, label]) => ({ key, label, type: 'text' })); const w = v.weighment;
      const rows = [['Vehicle', v.vehicleNo], ['Driver', `${v.driverName} ${v.driverPhone ?? ''}`.trim()], ['Transporter', v.transporter ?? ''], ['Vendor', v.vendor ?? ''], ['Purchase order', v.poNo ?? 'none'], ['Challan', `${v.challanNo ?? ''} ${v.challanKg != null ? `(${v.challanKg} kg)` : ''}`.trim()], ['E-way bill', v.ewayBillNo ?? ''], ['Material', v.materialDesc], ['In', v.timeIn ?? ''], ['Out', v.timeOut ?? ''], ['Weighment', w ? `gross ${w.grossKg ?? '-'} kg, tare ${w.tareKg ?? '-'} kg, net ${w.netKg ?? '-'} kg` : 'not weighed'], ['Unloading store', v.unloadingStore?.code ?? ''], ['Flags', v.flags.map((f) => f.message).join(' ')]].map(([k, val]) => ({ k, v: String(val ?? '') }));
      return { buffer: toPdf({ columns, rows, footer: [`${v.docNo}: ${v.site}, ${v.statusLabel}`, `Entered by ${v.requestedBy}`], title: `Gate entry ${v.docNo}` }), contentType: 'application/pdf', fileName: `${v.docNo.replaceAll('/', '-')}.pdf`, rows: rows.length };
    },
    importRows(actor, { rows }) {
      need(actor, 'inv.inward.import', 'import gate entries'); const problems = []; const made = [];
      rows.forEach((x, i) => { const site = db.prepare("SELECT t.id FROM org_sites t JOIN org_projects p ON p.id = t.org_project_id WHERE t.company_id = ? AND t.code = ? COLLATE NOCASE AND (? IS NULL OR p.code = ? COLLATE NOCASE) AND t.deleted_at IS NULL").get(actor.companyId, x.siteCode, x.projectCode ?? null, x.projectCode ?? null); if (!site) { problems.push({ field: `rows.${i}.siteCode`, message: 'No such site' }); return; }
        const po = x.poNo ? db.prepare('SELECT id, vendor_id FROM proc_purchase_orders WHERE company_id = ? AND doc_no = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, x.poNo) : null; if (x.poNo && !po) { problems.push({ field: `rows.${i}.poNo`, message: 'No such purchase order' }); return; }
        made.push({ siteId: site.id, vehicleNo: x.vehicleNo, driverName: x.driverName, driverPhone: x.driverPhone, transporter: x.transporter, materialDesc: x.materialDesc, challanNo: x.challanNo, ewayBillNo: x.ewayBillNo, poId: po?.id, vendorId: po?.vendor_id }); });
      fail(problems); return transaction(db, () => ({ created: made.map((b) => inward.create(actor, b).docNo) }));
    },
  };

  // ---- delivery appointments --------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const apptView = (actor, a) => ({ id: a.id, docNo: a.doc_no, expectedOn: a.expected_on, slot: a.expected_slot, siteId: a.org_site_id, site: db.prepare('SELECT name FROM org_sites WHERE id = ?').get(a.org_site_id)?.name, vendorId: a.vendor_id, vendor: partner(a.vendor_id)?.name ?? null, poId: a.po_id, poNo: a.po_id ? db.prepare('SELECT doc_no FROM proc_purchase_orders WHERE id = ?').get(a.po_id)?.doc_no : null, shipmentId: a.shipment_id, vehicleNo: a.vehicle_no, driverName: a.driver_name, driverPhone: a.driver_phone, materialDesc: a.material_desc, status: a.status, statusLabel: APPT_STATUS[a.status], rowVersion: a.version, can: { cancel: may(actor, 'inv.appointment.cancel', a.org_project_id, a.org_site_id) && a.status === 'SCHEDULED' } });
  const apRow = (actor, id) => { const a = db.prepare('SELECT * FROM inv_gate_appointments WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!a || !may(actor, 'inv.appointment.view', a.org_project_id, a.org_site_id)) throw notFound('That appointment does not exist.'); return a; };
  const appointments = {
    list(actor, query) { const sc = scope(actor, 'inv.appointment.view'); return runList(db, apptList, parseListRequest(apptList, query), { select: 'x.*', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (a) => apptView(actor, a) }); },
    create(actor, b) {
      const site = siteOf(actor, b.siteId, 'inv.appointment.create'); if (b.expectedOn < todayIST()) fail([{ field: 'expectedOn', message: 'The date is in the past' }]); let vendorId = b.vendorId ?? null;
      if (b.poId) { const po = db.prepare('SELECT vendor_id, org_project_id FROM proc_purchase_orders WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(b.poId), actor.companyId); if (!po || po.org_project_id !== site.org_project_id) fail([{ field: 'poId', message: 'That purchase order is not for this project' }]); vendorId = vendorId ?? po.vendor_id; }
      return transaction(db, () => { const no = number(actor.companyId, actor.user, 'INV_GATE_APPOINTMENT', 'inv_gate_appointments', 'GAP'); const id = Number(db.prepare("INSERT INTO inv_gate_appointments (company_id, doc_no, expected_on, expected_slot, org_project_id, org_site_id, vendor_id, po_id, vehicle_no, driver_name, driver_phone, material_desc, requested_by, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, no, b.expectedOn, b.slot ?? null, site.org_project_id, site.id, vendorId, b.poId ?? null, vno(b.vehicleNo), b.driverName ?? null, b.driverPhone ?? null, b.materialDesc ?? null, actor.user, site.org_project_id, site.id, actor.user).lastInsertRowid); audit(actor, 'inv_gate_appointments', id, 'create', actor.companyId); return apptView(actor, db.prepare('SELECT * FROM inv_gate_appointments WHERE id = ?').get(id)); });
    },
    cancel(actor, id, { reason }) { const a = apRow(actor, id); need(actor, 'inv.appointment.cancel', 'cancel appointments', a.org_project_id, a.org_site_id); if (a.status !== 'SCHEDULED') throw unprocessable('Only an expected delivery is cancelled.'); db.prepare("UPDATE inv_gate_appointments SET status = 'CANCELLED', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), a.id); audit(actor, 'inv_gate_appointments', a.id, 'cancel', a.company_id, { reason }); return apptView(actor, db.prepare('SELECT * FROM inv_gate_appointments WHERE id = ?').get(a.id)); },
    /** A dispatched shipment (15.07) is expected at the site on its ETA. */
    onShipment(e) {
      const d = e.data ?? {}; const cid = Number(e.companyId ?? e.company_id); if (!cid || !d.shipmentId || !d.poId) return null; if (db.prepare("SELECT 1 FROM inv_gate_appointments WHERE company_id = ? AND source_type = 'xpd_shipment' AND source_id = ?").get(cid, String(d.shipmentId))) return null;
      const po = db.prepare('SELECT * FROM proc_purchase_orders WHERE id = ? AND company_id = ?').get(d.poId, cid); if (!po?.po_site_id) return null; const no = number(cid, 'system', 'INV_GATE_APPOINTMENT', 'inv_gate_appointments', 'GAP');
      db.prepare("INSERT INTO inv_gate_appointments (company_id, doc_no, expected_on, org_project_id, org_site_id, vendor_id, po_id, shipment_id, vehicle_no, material_desc, requested_by, project_id, site_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', ?, ?, 'system', 'xpd_shipment', ?)").run(cid, no, d.eta ?? todayIST(), po.org_project_id, po.po_site_id, po.vendor_id, po.id, d.shipmentId, vno(d.vehicleNo), `Shipment ${d.shipmentNo ?? d.shipmentId} against ${d.poNo ?? po.doc_no}`, po.org_project_id, po.po_site_id, String(d.shipmentId)); return no;
    },
    markMissed() { return db.prepare(`UPDATE inv_gate_appointments SET status = 'MISSED', updated_by = 'system', updated_at = ? WHERE status = 'SCHEDULED' AND expected_on < ${NOW_IST} AND deleted_at IS NULL`).run(nowIso()).changes; },
  };

  // ---- outbound gate passes (FR-05, FR-06, BR-01) -----------------------------------------------------------------------------------------------------------------------------------------------
  const qrCode = () => `GP:${randomBytes(10).toString('hex').toUpperCase()}`;
  const overdueOf = (p) => p.returnable === 1 && p.status === 'OUT' && p.expected_return != null && p.expected_return < todayIST();
  const itemsOut = (items) => items.map((l) => ({ ...l, qty: l.qty / 1000 }));
  const passView = (actor, p, { detail = false } = {}) => {
    const can = (k) => may(actor, k, p.org_project_id, p.org_site_id); const own = same(p.requested_by, actor.user); const site = db.prepare('SELECT name FROM org_sites WHERE id = ?').get(p.org_site_id);
    const o = { id: p.id, docNo: p.doc_no, date: p.pass_date, siteId: p.org_site_id, site: site?.name, projectId: p.org_project_id, type: p.pass_type, typeLabel: PASS_TYPES[p.pass_type], returnable: Boolean(p.returnable), expectedReturn: p.expected_return, vendorId: p.vendor_id, vendor: partner(p.vendor_id)?.name ?? null, referenceType: p.reference_type, referenceId: p.reference_id, vehicleNo: p.vehicle_no, driverName: p.driver_name, destination: p.destination, purpose: p.purpose,
      timeOut: p.time_out, verifiedBy: p.verified_by, returnedOn: p.returned_on, returnedNote: p.returned_note, overdue: overdueOf(p), daysOverdue: overdueOf(p) ? Math.round((Date.parse(`${todayIST()}T00:00:00Z`) - Date.parse(`${p.expected_return}T00:00:00Z`)) / 86_400_000) : 0, status: p.status, statusLabel: PASS_STATUS[p.status], requestedBy: p.requested_by, approvedBy: p.approved_by, approvedAt: p.approved_at, workflowInstanceId: p.workflow_instance_id, amendmentNo: p.amendment_no, cancelReason: p.cancel_reason, rowVersion: p.version, itemCount: json(p.items_json, []).length,
      can: { edit: can('inv.pass.edit') && EDITABLE.includes(p.status), delete: can('inv.pass.delete') && p.status === 'DRAFT', submit: can('inv.pass.submit') && EDITABLE.includes(p.status), withdraw: p.status === 'SUBMITTED' && own, cancel: can('inv.pass.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED', 'APPROVED'].includes(p.status), amend: can('inv.pass.amend') && p.status === 'APPROVED', verify: can('inv.pass.verify') && p.status === 'APPROVED', markReturned: can('inv.pass.return') && p.status === 'OUT' && Boolean(p.returnable) } };
    if (detail) { o.can.approve = p.status === 'SUBMITTED' && !own && can('inv.pass.approve'); if (o.can.approve && p.workflow_instance_id) o.taskId = taskOf(actor, p.workflow_instance_id); o.items = itemsOut(json(p.items_json, [])); if (['APPROVED', 'OUT', 'CLOSED'].includes(p.status)) { o.qrCode = p.qr_code; o.qrImage = qrImage(p.qr_code); } }
    return o;
  };
  const pRow = (actor, id, key = 'inv.pass.view') => {
    const p = db.prepare('SELECT * FROM inv_gate_passes WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!p || !may(actor, 'inv.pass.view', p.org_project_id, p.org_site_id)) throw notFound('That gate pass does not exist.'); if (key !== 'inv.pass.view') need(actor, key, 'do that to this gate pass', p.org_project_id, p.org_site_id); return p;
  };
  const passFields = (b) => ({ items: b.items.map((l) => ({ description: l.description, qty: t3(l.qty), uom: l.uom, itemId: l.itemId ?? null, assetRef: l.assetRef ?? null, remarks: l.remarks ?? null })) });
  const passRules = (b, type) => { const problems = []; if (type === 'RETURNABLE' && !b.expectedReturn) problems.push({ field: 'expectedReturn', message: 'Say when the returnable material comes back' }); if (b.expectedReturn && b.expectedReturn < todayIST()) problems.push({ field: 'expectedReturn', message: 'The return date is in the past' }); if (type === 'VENDOR_RETURN' && !b.vendorId) problems.push({ field: 'vendorId', message: 'Choose the vendor the material goes back to' }); if (b.vendorId && !partner(rid(b.vendorId))) problems.push({ field: 'vendorId', message: 'No such vendor' }); fail(problems); };
  const passes = {
    list(actor, query) { const sc = scope(actor, 'inv.pass.view'); return runList(db, passList, parseListRequest(passList, query), { select: 'x.*', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (p) => ({ id: p.id, docNo: p.doc_no, date: p.pass_date, site: db.prepare('SELECT name FROM org_sites WHERE id = ?').get(p.org_site_id)?.name, type: p.pass_type, typeLabel: PASS_TYPES[p.pass_type], destination: p.destination, vehicle: p.vehicle_no, expectedReturn: p.expected_return, timeOut: p.time_out, overdue: overdueOf(p), returnable: Boolean(p.returnable), status: p.status, statusLabel: PASS_STATUS[p.status] }) }); },
    get: (actor, id) => passView(actor, pRow(actor, id), { detail: true }),
    create(actor, b) {
      const site = siteOf(actor, b.siteId, 'inv.pass.create'); passRules(b, b.type); const f = passFields(b);
      return transaction(db, () => { const no = number(actor.companyId, actor.user, 'INV_GATE_PASS', 'inv_gate_passes', 'GPS'); const id = Number(db.prepare("INSERT INTO inv_gate_passes (company_id, doc_no, pass_date, org_project_id, org_site_id, pass_type, returnable, expected_return, items_json, reference_type, reference_id, vendor_id, vehicle_no, driver_name, destination, purpose, qr_code, status, requested_by, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, 'api')")
        .run(actor.companyId, no, todayIST(), site.org_project_id, site.id, b.type, b.type === 'RETURNABLE' ? 1 : 0, b.type === 'RETURNABLE' ? b.expectedReturn : null, JSON.stringify(f.items), b.referenceType ?? null, b.referenceId ?? null, b.vendorId ?? null, vno(b.vehicleNo), b.driverName ?? null, b.destination, b.purpose, qrCode(), actor.user, site.org_project_id, site.id, actor.user).lastInsertRowid); audit(actor, 'inv_gate_passes', id, 'create', actor.companyId); return passes.get(actor, id); });
    },
    update(actor, id, b) {
      const p = pRow(actor, id, 'inv.pass.edit'); if (!EDITABLE.includes(p.status)) throw conflict('Only a draft or a returned pass is changed.'); if (b.rowVersion && b.rowVersion !== p.version) throw conflict('Someone changed this pass; reload it.');
      const type = b.type ?? p.pass_type; const m = { expectedReturn: p.expected_return, vendorId: p.vendor_id, ...b }; passRules(m, type); const items = b.items ? passFields(b).items : json(p.items_json, []);
      db.prepare('UPDATE inv_gate_passes SET pass_type = ?, returnable = ?, expected_return = ?, items_json = ?, reference_type = ?, reference_id = ?, vendor_id = ?, vehicle_no = ?, driver_name = ?, destination = ?, purpose = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(type, type === 'RETURNABLE' ? 1 : 0, type === 'RETURNABLE' ? m.expectedReturn : null, JSON.stringify(items), b.referenceType ?? p.reference_type, b.referenceId ?? p.reference_id, m.vendorId ?? null, b.vehicleNo !== undefined ? vno(b.vehicleNo) : p.vehicle_no, b.driverName ?? p.driver_name, b.destination ?? p.destination, b.purpose ?? p.purpose, actor.user, nowIso(), p.id); audit(actor, 'inv_gate_passes', p.id, 'update', p.company_id); return passes.get(actor, p.id);
    },
    remove(actor, id) { const p = pRow(actor, id, 'inv.pass.delete'); if (p.status !== 'DRAFT') throw conflict('Only a draft is deleted.'); db.prepare('UPDATE inv_gate_passes SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, p.id); audit(actor, 'inv_gate_passes', p.id, 'delete', p.company_id); return { id: p.id, deleted: true }; },
    submit(actor, id) {
      const p = pRow(actor, id, 'inv.pass.submit'); if (!EDITABLE.includes(p.status)) throw unprocessable('Only a draft or a returned pass is sent for approval.'); if (!json(p.items_json, []).length) fail([{ field: 'items', message: 'List what leaves the site' }]); passRules({ expectedReturn: p.expected_return, vendorId: p.vendor_id }, p.pass_type);
      return transaction(db, () => {
        const ctx = { projectId: p.org_project_id, needPm: NEEDS_PM.includes(p.pass_type) ? 'yes' : 'no' };
        if (p.status === 'RETURNED' && p.workflow_instance_id) workflowOf(db).resubmit(actor, p.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: INV_PASS_DOC, docId: String(p.id), comment: `${p.doc_no} ${PASS_TYPES[p.pass_type]} to ${p.destination}`.slice(0, 300), context: ctx }); db.prepare('UPDATE inv_gate_passes SET workflow_instance_id = ? WHERE id = ?').run(inst.id, p.id); }
        db.prepare("UPDATE inv_gate_passes SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), p.id); audit(actor, 'inv_gate_passes', p.id, 'submit', p.company_id); return passes.get(actor, p.id);
      });
    },
    withdraw(actor, id, { reason }) { const p = pRow(actor, id); if (p.status !== 'SUBMITTED') throw unprocessable('Only a pass waiting for approval is withdrawn.'); if (!same(p.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, p.workflow_instance_id, { comment: reason }); return passes.get(actor, p.id); },
    cancel(actor, id, { reason }) { const p = pRow(actor, id, 'inv.pass.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED', 'APPROVED'].includes(p.status)) throw unprocessable('Only a pass that has not gone out is cancelled.'); return transaction(db, () => { if (p.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, p.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE inv_gate_passes SET status = 'CANCELLED', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), p.id); audit(actor, 'inv_gate_passes', p.id, 'cancel', p.company_id, { reason }); return passes.get(actor, p.id); }); },
    /** An approved pass that has not gone out is reopened to be changed; it is approved again and gets a new QR code, so the old one no longer opens the gate. */
    amend(actor, id, { reason }) { const p = pRow(actor, id, 'inv.pass.amend'); if (p.status !== 'APPROVED') throw unprocessable('Only an approved pass that has not gone out is amended.'); db.prepare("UPDATE inv_gate_passes SET status = 'DRAFT', amendment_no = amendment_no + 1, workflow_instance_id = NULL, qr_code = ?, approved_by = NULL, approved_at = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(qrCode(), actor.user, nowIso(), p.id); audit(actor, 'inv_gate_passes', p.id, 'amend', p.company_id, { reason }); return passes.get(actor, p.id); },
    history(actor, id) { const p = pRow(actor, id); return { approvals: db.prepare('SELECT h.event, h.actor, h.comment, h.at, h.step_code FROM wf_history h JOIN wf_instances i ON i.id = h.instance_id WHERE i.doc_type = ? AND i.doc_id = ? AND i.company_id = ? ORDER BY h.id').all(INV_PASS_DOC, String(p.id), p.company_id), audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'inv_gate_passes' AND entity_id = ? ORDER BY id").all(String(p.id)) }; },
    decide(instance, actor, outcome, comment) {
      const p = db.prepare('SELECT * FROM inv_gate_passes WHERE id = ?').get(rid(instance.docId)); if (!p || p.status !== 'SUBMITTED') return; const now = nowIso();
      if (outcome === 'APPROVED') { db.prepare("UPDATE inv_gate_passes SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, p.id); audit(actor, 'inv_gate_passes', p.id, 'approve', p.company_id); evt('inv.gatepass.approved', actor, p.company_id, 'inv_gate_passes', p.id, { passId: p.id, docNo: p.doc_no, type: p.pass_type, siteId: p.org_site_id, vehicleNo: p.vehicle_no }, p.org_project_id); notify(p.company_id, 'inv.gate.decided', [`user:${p.requested_by}`, 'role:GUARD|SECSUP'], p.doc_no, 'approved', `${p.doc_no} is approved: ${PASS_TYPES[p.pass_type]} to ${p.destination}. The gate verifies its QR code when the vehicle leaves.`, `/inv/gate-pass?id=${p.id}`, p.id, { projectId: p.org_project_id }); return; }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE inv_gate_passes SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : p.workflow_instance_id, actor.user, now, p.id); audit(actor, 'inv_gate_passes', p.id, outcome.toLowerCase(), p.company_id, { reason: comment });
      notify(p.company_id, 'inv.gate.decided', [`user:${p.requested_by}`], p.doc_no, outcome.toLowerCase(), `${p.doc_no} is ${outcome === 'RETURNED' ? 'returned to you for correction' : outcome === 'REJECTED' ? 'rejected' : 'closed'}${comment ? `: ${comment}` : ''}.`, `/inv/gate-pass?id=${p.id}`, p.id, { projectId: p.org_project_id });
    },
    /** BR-01: nothing leaves without an approved pass. The guard scans the QR code; only an approved, unused pass for this company opens the gate. */
    verify(actor, { code, vehicleNo }) {
      const p = db.prepare('SELECT * FROM inv_gate_passes WHERE qr_code = ? AND company_id = ? AND deleted_at IS NULL').get(String(code).trim(), actor.companyId);
      if (!p || !may(actor, 'inv.pass.view', p.org_project_id, p.org_site_id)) throw notFound('No gate pass has this code. The vehicle must not leave.'); need(actor, 'inv.pass.verify', 'verify gate passes', p.org_project_id, p.org_site_id);
      if (p.status === 'OUT' || p.status === 'CLOSED') throw unprocessable(`${p.doc_no} was already used at ${String(p.time_out ?? '').slice(0, 16).replace('T', ' ')}. A pass opens the gate once.`); if (p.status !== 'APPROVED') throw unprocessable(`${p.doc_no} is ${PASS_STATUS[p.status].toLowerCase()}: the vehicle must not leave.`);
      const valid = Number(param(p.company_id, 'inv.gate.pass_validity_days') ?? 30); if (p.approved_at && Date.parse(nowIso()) - Date.parse(p.approved_at) > valid * 86_400_000) throw unprocessable(`${p.doc_no} was approved more than ${valid} days ago. Amend it and get it approved again.`);
      if (p.vehicle_no && vehicleNo && vno(vehicleNo) !== p.vehicle_no) throw unprocessable(`${p.doc_no} is for vehicle ${p.vehicle_no}, not ${vno(vehicleNo)}.`);
      return transaction(db, () => {
        const now = nowIso(); const finalStatus = p.returnable ? 'OUT' : 'CLOSED'; db.prepare('UPDATE inv_gate_passes SET status = ?, time_out = ?, verified_by = ?, vehicle_no = COALESCE(vehicle_no, ?), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(finalStatus, now, actor.user, vno(vehicleNo), actor.user, now, p.id); audit(actor, 'inv_gate_passes', p.id, 'verify_out', p.company_id);
        evt('inv.gatepass.out', actor, p.company_id, 'inv_gate_passes', p.id, { passId: p.id, docNo: p.doc_no, type: p.pass_type, returnable: Boolean(p.returnable), expectedReturn: p.expected_return, siteId: p.org_site_id, vehicleNo: vno(vehicleNo) ?? p.vehicle_no, timeOut: now, items: itemsOut(json(p.items_json, [])) }, p.org_project_id);
        notify(p.company_id, 'inv.gate.decided', [`user:${p.requested_by}`], p.doc_no, 'out', `${p.doc_no} left the site at ${now.slice(11, 16)} UTC.`, `/inv/gate-pass?id=${p.id}`, `${p.id}.out`, { projectId: p.org_project_id }); return passView(actor, db.prepare('SELECT * FROM inv_gate_passes WHERE id = ?').get(p.id), { detail: true });
      });
    },
    /** FR-06: the returnable material is back. */
    markReturned(actor, id, { note }) {
      const p = pRow(actor, id, 'inv.pass.return'); if (p.status !== 'OUT' || !p.returnable) throw unprocessable('Only a returnable pass that is out is marked returned.');
      db.prepare("UPDATE inv_gate_passes SET status = 'CLOSED', returned_on = ?, returned_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(todayIST(), note ?? null, actor.user, nowIso(), p.id); audit(actor, 'inv_gate_passes', p.id, 'return', p.company_id);
      evt('inv.gatepass.returned', actor, p.company_id, 'inv_gate_passes', p.id, { passId: p.id, docNo: p.doc_no, returnedOn: todayIST(), late: Boolean(p.expected_return && p.expected_return < todayIST()) }, p.org_project_id); return passes.get(actor, p.id);
    },
    /** FR-06: every morning the returnable passes past their date are told, once a day. */
    sweepOverdue() {
      let n = 0; for (const p of db.prepare(`SELECT * FROM inv_gate_passes WHERE returnable = 1 AND status = 'OUT' AND expected_return < ${NOW_IST} AND (overdue_notified_on IS NULL OR overdue_notified_on < ${NOW_IST}) AND deleted_at IS NULL`).all()) {
        const days = Math.round((Date.parse(`${todayIST()}T00:00:00Z`) - Date.parse(`${p.expected_return}T00:00:00Z`)) / 86_400_000);
        notify(p.company_id, 'inv.pass.overdue', [`user:${p.requested_by}`, 'role:STOREMGR|SECSUP'], p.doc_no, `${days} day(s) overdue`, `${p.doc_no} (${p.destination}) was due back on ${p.expected_return} and is ${days} day(s) overdue.`, `/inv/gate-passes?id=${p.id}`, `${p.id}.${todayIST()}`, { projectId: p.org_project_id });
        evt('inv.gatepass.overdue', null, p.company_id, 'inv_gate_passes', p.id, { passId: p.id, docNo: p.doc_no, expectedReturn: p.expected_return, daysOverdue: days }, p.org_project_id); db.prepare('UPDATE inv_gate_passes SET overdue_notified_on = ? WHERE id = ?').run(todayIST(), p.id); n += 1;
      } return n;
    },
    print(actor, id) {
      const p = pRow(actor, id, 'inv.pass.print'); const v = passView(actor, p, { detail: true }); audit(actor, 'inv_gate_passes', p.id, 'print', p.company_id);
      const columns = [['n', '#'], ['d', 'Item'], ['q', 'Quantity'], ['u', 'Unit']].map(([key, label]) => ({ key, label, type: 'text' })); const rows = v.items.map((l, i) => ({ n: String(i + 1), d: l.description, q: String(l.qty), u: l.uom }));
      const footer = [`${v.docNo}: ${v.typeLabel} from ${v.site} to ${v.destination}`, `Purpose: ${v.purpose}`, `Vehicle ${v.vehicleNo ?? '-'}, driver ${v.driverName ?? '-'}${v.expectedReturn ? `, to be back by ${v.expectedReturn}` : ''}`, `Requested by ${v.requestedBy}${v.approvedBy ? `; approved by ${v.approvedBy}` : ''}`, v.qrCode ? `Gate code: ${v.qrCode}` : 'Not approved: not valid at the gate'];
      return { buffer: toPdf({ columns, rows, footer, title: `Gate pass ${v.docNo}` }), contentType: 'application/pdf', fileName: `${v.docNo.replaceAll('/', '-')}.pdf`, rows: rows.length };
    },
    importRows(actor, { rows }) {
      need(actor, 'inv.pass.import', 'import gate passes'); const problems = []; const made = [];
      rows.forEach((x, i) => { const site = db.prepare("SELECT t.id FROM org_sites t JOIN org_projects p ON p.id = t.org_project_id WHERE t.company_id = ? AND t.code = ? COLLATE NOCASE AND (? IS NULL OR p.code = ? COLLATE NOCASE) AND t.deleted_at IS NULL").get(actor.companyId, x.siteCode, x.projectCode ?? null, x.projectCode ?? null); if (!site) { problems.push({ field: `rows.${i}.siteCode`, message: 'No such site' }); return; }
        made.push({ siteId: site.id, type: x.type, expectedReturn: x.expectedReturn, destination: x.destination, purpose: x.purpose, vehicleNo: x.vehicleNo, driverName: x.driverName, items: [{ description: x.description, qty: x.qty, uom: x.uom }] }); });
      fail(problems); return transaction(db, () => ({ created: made.map((b) => { passes.create(actor, b); return db.prepare('SELECT doc_no FROM inv_gate_passes WHERE company_id = ? ORDER BY id DESC LIMIT 1').get(actor.companyId).doc_no; }) }));
    },
  };

  // ---- the gate register and its figures (FR-07) -----------------------------------------------------------------------------------------------------------------------------------------------
  function dashboard(actor, q = {}) {
    const sc = scope(actor, 'inv.inward.view'); const ps = may(actor, 'inv.pass.view') ? scope(actor, 'inv.pass.view') : null; const today = todayIST(); const P = { ...sc.params }; let extra = ''; if (q.siteId) { extra = ' AND x.org_site_id = :site'; P.site = rid(q.siteId); }
    const n = (sql, params = P) => db.prepare(sql).get(params).n;
    const base = `FROM inv_gate_inward x WHERE ${sc.sql}${extra} AND x.deleted_at IS NULL`;
    const turn = db.prepare(`SELECT x.time_in, x.time_out, x.entry_date ${base} AND x.status = 'EXITED' AND x.entry_date >= date(:today, '-30 days')`).all({ ...P, today }).map((r) => minutes(r.time_in, r.time_out)).sort((a, b) => a - b);
    const byDay = db.prepare(`SELECT x.entry_date AS day, COUNT(*) AS vehicles ${base} AND x.entry_date >= date(:today, '-6 days') AND x.status NOT IN ('DRAFT', 'CANCELLED') GROUP BY x.entry_date ORDER BY x.entry_date`).all({ ...P, today });
    const out = { today, inToday: n(`SELECT COUNT(*) AS n ${base} AND x.entry_date = :today AND x.status NOT IN ('DRAFT', 'CANCELLED')`, { ...P, today }), inYard: n(`SELECT COUNT(*) AS n ${base} AND x.status IN ('AT_GATE', 'UNLOADING', 'HANDED_OVER')`), awaitingAcceptance: n(`SELECT COUNT(*) AS n ${base} AND x.status = 'SUBMITTED'`),
      unexpected30: n(`SELECT COUNT(*) AS n ${base} AND x.unexpected = 1 AND x.entry_date >= date(:today, '-30 days')`, { ...P, today }), weightFlags30: n(`SELECT COUNT(*) AS n ${base} AND x.flags_json LIKE '%WEIGHT_VARIANCE%' AND x.entry_date >= date(:today, '-30 days')`, { ...P, today }),
      turnaround: { vehicles: turn.length, avgMin: turn.length ? Math.round(turn.reduce((a, b) => a + b, 0) / turn.length) : null, p90Min: turn.length ? turn[Math.min(turn.length - 1, Math.floor(turn.length * 0.9))] : null }, byDay,
      slowest: db.prepare(`SELECT x.id, x.doc_no, x.vehicle_no, x.time_in, x.time_out ${base} AND x.status = 'EXITED' AND x.entry_date >= date(:today, '-30 days')`).all({ ...P, today }).map((r) => ({ id: r.id, docNo: r.doc_no, vehicleNo: r.vehicle_no, minutes: minutes(r.time_in, r.time_out) })).sort((a, b) => b.minutes - a.minutes).slice(0, 5) };
    if (ps) { const PP = { ...ps.params }; const pn = (extraSql) => db.prepare(`SELECT COUNT(*) AS n FROM inv_gate_passes x WHERE ${ps.sql} AND x.deleted_at IS NULL ${extraSql}`).get(PP).n; Object.assign(out, { passesAwaitingApproval: pn("AND x.status = 'SUBMITTED'"), passesApproved: pn("AND x.status = 'APPROVED'"), outToday: pn(`AND x.time_out IS NOT NULL AND date(x.time_out, '+330 minutes') = '${today}'`), returnablesOut: pn("AND x.returnable = 1 AND x.status = 'OUT'"), returnablesOverdue: pn(`AND x.returnable = 1 AND x.status = 'OUT' AND x.expected_return < '${today}'`) }); }
    return out;
  }
  const options = (actor) => { need(actor, 'inv.inward.view', 'see the gate'); const sites = db.prepare("SELECT t.id, t.code, t.name, t.org_project_id AS projectId, p.code AS project FROM org_sites t JOIN org_projects p ON p.id = t.org_project_id WHERE t.company_id = ? AND t.deleted_at IS NULL AND t.status = 'ACTIVE' ORDER BY p.code, t.code").all(actor.companyId).filter((s) => may(actor, 'inv.inward.view', s.projectId, s.id)); return { sites, passTypes: Object.entries(PASS_TYPES).map(([code, label]) => ({ code, label })), flags: FLAGS, tolerancePct: Number(param(actor.companyId, 'inv.gate.weight_tolerance_pct') ?? 20000) / 10000 }; };
  const vendors = (actor, q = '') => { need(actor, 'inv.inward.view', 'see the gate'); return db.prepare("SELECT id, code, legal_name AS name FROM mdm_partners WHERE company_id = ? AND deleted_at IS NULL AND (legal_name LIKE ? OR code LIKE ?) ORDER BY legal_name LIMIT 30").all(actor.companyId, `%${q}%`, `%${q}%`); };
  return { inward, appointments, passes, dashboard, options, vendors };
}
