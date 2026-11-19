import { transaction } from '../../platform/db/index.js';
import { taxEngineOf } from '../../platform/tax/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { toPdf } from '../../platform/export/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { json, nowIso, rid, same } from '../proc/base.js';

// Inter-store transfers (part 16.05): a request approved by the chain, a dispatch that takes the stock out of the source into transit (with a gate pass and, where needed, an e-way bill), a receipt at the destination that brings it in, and the discrepancies
// (shortage, damage) held until they are resolved. Between projects the value moves at the book rate. Quantities are thousandths, rates and values paise.
export const INV_TRANSFER_DOC = 'INV_TRANSFER'; export const INV_TRDISC_DOC = 'INV_TRANSFER_DISC';
export const TRANSFER_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', RETURNED: 'Returned for correction', APPROVED: 'Ready to dispatch', IN_TRANSIT: 'In transit', RECEIVED: 'Received', DISCREPANCY: 'Received with a discrepancy', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
export const DISC_STATUS = { OPEN: 'Open', PENDING: 'Waiting for the write-off approval', RESOLVED: 'Resolved' };
export const RESOLUTIONS = { WRITE_OFF: 'Written off', RETURN_TO_SOURCE: 'Returned to the source store', ACCEPT: 'Accepted into the destination store' };
const EDITABLE = ['DRAFT', 'RETURNED']; const BUCKETS = [['0-2', 0, 2], ['3-7', 3, 7], ['8-15', 8, 15], ['16+', 16, Infinity]];

for (const [key, def, description, min, max] of [
  ['inv.transfer.eway_threshold', 5_000_000, 'FR-02: a transfer worth this much or more (paise; ₹ 50,000 is 5000000), or between states, needs an e-way bill number at dispatch.', 0, 1_000_000_000_000],
  ['inv.transfer.transit_alert_days', 3, 'FR-04: stock still in transit after this many days is told to the store managers every day.', 1, 365],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType: 'integer', default: def, scopes: ['system', 'company'], description, min, max });

export const transferList = defineList({
  code: 'inv.transfers', label: 'Stock transfers', permission: 'inv.transfer.view', from: 'inv_transfers x JOIN inv_stores f ON f.id = x.from_store_id JOIN inv_stores t ON t.id = x.to_store_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'f.code', 't.code', 'x.vehicle_no'], defaultSort: '-date',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Transfer' }, date: { sql: 'x.request_date', type: 'date', label: 'Requested' }, from: { sql: 'f.code', type: 'text', label: 'From' }, to: { sql: 't.code', type: 'text', label: 'To' }, requiredBy: { sql: "COALESCE(x.required_by, '')", type: 'date', label: 'Required by' }, vehicle: { sql: "COALESCE(x.vehicle_no, '')", type: 'text', label: 'Vehicle' },
    inTransit: { sql: "CASE WHEN x.status IN ('IN_TRANSIT', 'DISCREPANCY') THEN 'Y' ELSE 'N' END", type: 'enum', label: 'In transit', options: [['Y', 'In transit or held'], ['N', 'Not in transit']] }, interProject: { sql: "CASE WHEN x.inter_project = 1 THEN 'Y' ELSE 'N' END", type: 'enum', label: 'Between projects', options: [['Y', 'Between projects'], ['N', 'Same project']] }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(TRANSFER_STATUS) },
  },
});

const d3 = (n) => (n == null ? null : n / 1000); const t3 = (n) => Math.round(Number(n) * 1000);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function createTransferService({ db, base, invSvc, gate }) {
  const { authz, may, need, fail, audit, notify, number, param } = base; const stock = invSvc.stock;
  const evt = (type, actor, companyId, entity, entityId, data, projectId) => publishEvent(db, { type, entity, entityId, actorId: actor?.user ?? 'system', companyId, projectId: projectId ?? undefined, data });
  const canValues = (actor, pid) => may(actor, 'inv.stock.values', pid); const mask = (v, actor, pid) => (canValues(actor, pid) ? v : null);
  const scope = (actor, key) => {
    need(actor, key, 'see the transfers'); const a = authz.scopeFilter(actor, key, { project: 'x.from_project_id' }); const b = authz.scopeFilter(actor, key, { project: 'x.to_project_id' });
    return { sql: `x.company_id = :c AND ((${a.sql}) OR (${b.sql}))`, params: { c: actor.companyId, ...(a.params ?? {}), ...(b.params ?? {}) } };
  };
  const taskOf = (actor, instanceId) => workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === instanceId)?.id ?? null;
  const itemLabel = (id) => { const i = db.prepare('SELECT code, name FROM mdm_items WHERE id = ?').get(id); return i ? `${i.code} ${i.name}` : ''; };
  const storeOf = (id) => db.prepare('SELECT * FROM inv_stores WHERE id = ?').get(id);
  const inScope = (actor, key, t) => may(actor, key, t.from_project_id) || may(actor, key, t.to_project_id);
  const keeps = (actor, store) => { try { invSvc.storeFor(actor, store.id, 'inv.store.view'); return true; } catch { return false; } };
  /** The balance row that holds what is on its way to (or has arrived in) the destination store. */
  const transitRow = (to, itemId, batch, owner) => stock.balRow(to.company_id, to, stock.defaultBin(to), itemId, batch ?? '', '', owner);
  const toOwner = (to) => stock.ownerOf(to, {});
  const valueUpTo = (l, q) => (l.qty_dispatched > 0 ? Math.round((l.value * q) / l.qty_dispatched) : 0);

  const lineRows = (id) => db.prepare('SELECT l.*, i.code AS icode, i.name AS iname FROM inv_transfer_lines l JOIN mdm_items i ON i.id = l.item_id WHERE l.transfer_id = ? AND l.deleted_at IS NULL ORDER BY l.line_no').all(id);
  const discRows = (id) => db.prepare('SELECT * FROM inv_transfer_discrepancies WHERE transfer_id = ? AND deleted_at IS NULL ORDER BY id').all(id);
  const inTransitQty = (l) => l.qty_dispatched - l.qty_received - l.qty_damaged - l.qty_shortage;
  const view = (actor, t, { detail = false } = {}) => {
    const can = (k) => may(actor, k, t.from_project_id) || may(actor, k, t.to_project_id); const own = same(t.requested_by, actor.user); const from = storeOf(t.from_store_id); const to = storeOf(t.to_store_id); const ds = discRows(t.id); const open = ds.filter((x) => x.status !== 'RESOLVED');
    const o = { id: t.id, docNo: t.doc_no, date: t.request_date, requiredBy: t.required_by, fromStoreId: t.from_store_id, from: from.code, fromName: from.name, toStoreId: t.to_store_id, to: to.code, toName: to.name, fromProjectId: t.from_project_id, toProjectId: t.to_project_id, interProject: Boolean(t.inter_project), interState: Boolean(t.inter_state), documentType: t.document_type, vehicleNo: t.vehicle_no, driverName: t.driver_name, ewayBillNo: t.eway_bill_no, ewayRequired: Boolean(t.eway_required), gatePassId: t.gate_pass_id, dispatchDate: t.dispatch_date, receivedDate: t.received_date, reason: t.reason, mrId: t.mr_id,
      totalValue: mask(t.total_value, actor, t.from_project_id ?? t.to_project_id), status: t.status, statusLabel: TRANSFER_STATUS[t.status], requestedBy: t.requested_by, approvedBy: t.approved_by, workflowInstanceId: t.workflow_instance_id, cancelReason: t.cancel_reason, rowVersion: t.version, openDiscrepancies: open.length, lineCount: lineRows(t.id).length,
      can: { edit: can('inv.transfer.edit') && EDITABLE.includes(t.status), delete: can('inv.transfer.delete') && t.status === 'DRAFT', submit: can('inv.transfer.submit') && EDITABLE.includes(t.status), withdraw: t.status === 'SUBMITTED' && own, cancel: can('inv.transfer.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED', 'APPROVED'].includes(t.status), dispatch: can('inv.transfer.dispatch') && t.status === 'APPROVED' && keeps(actor, from), receive: can('inv.transfer.receive') && t.status === 'IN_TRANSIT' && keeps(actor, to), resolve: can('inv.transfer.resolve') && open.some((x) => x.status === 'OPEN'), print: can('inv.transfer.print'), photo: can('inv.transfer.receive') || can('inv.transfer.dispatch') || can('inv.transfer.create') } };
    if (detail) {
      o.approve = t.status === 'SUBMITTED' && !own && can('inv.transfer.approve'); if (o.approve && t.workflow_instance_id) o.taskId = taskOf(actor, t.workflow_instance_id); const pid = t.from_project_id ?? t.to_project_id;
      o.lines = lineRows(t.id).map((l) => ({ id: l.id, lineNo: l.line_no, itemId: l.item_id, item: `${l.icode} ${l.iname}`, uom: l.uom, requestedQty: d3(l.qty_requested), dispatchedQty: d3(l.qty_dispatched), receivedQty: d3(l.qty_received), damagedQty: d3(l.qty_damaged), shortageQty: d3(l.qty_shortage), inTransitQty: d3(inTransitQty(l)), rate: mask(l.rate, actor, pid), value: mask(l.value, actor, pid), batchNo: l.batch_no, note: l.discrepancy_note }));
      o.discrepancies = ds.map((x) => ({ id: x.id, lineId: x.line_id, item: itemLabel(db.prepare('SELECT item_id FROM inv_transfer_lines WHERE id = ?').get(x.line_id).item_id), kind: x.shortage_qty > 0 ? 'SHORTAGE' : 'DAMAGED', qty: d3(x.shortage_qty || x.damaged_qty), value: mask(x.value, actor, pid), status: x.status, statusLabel: DISC_STATUS[x.status], resolution: x.resolution, resolutionLabel: x.resolution ? RESOLUTIONS[x.resolution] : null, note: x.resolution_note, resolvedBy: x.resolved_by, workflowInstanceId: x.workflow_instance_id, taskId: x.status === 'PENDING' && x.workflow_instance_id && !same(x.raised_by, actor.user) && can('inv.transfer.approve') ? taskOf(actor, x.workflow_instance_id) : null }));
      o.photos = json(t.photos_json, []).map((p) => ({ ...p, name: db.prepare('SELECT original_name FROM core_files WHERE id = ?').get(p.fileId)?.original_name ?? null })); o.gatePass = t.gate_pass_id ? db.prepare('SELECT id, doc_no, status FROM inv_gate_passes WHERE id = ?').get(t.gate_pass_id) : null;
      o.postings = db.prepare("SELECT l.doc_no, l.txn_type, l.txn_date, l.qty_in, l.qty_out, l.value, g.line_no FROM inv_stock_ledger l JOIN inv_transfer_lines g ON g.id = CAST(l.source_id AS INTEGER) WHERE l.source_type = 'inv_transfer_line' AND g.transfer_id = ? ORDER BY l.id").all(t.id).map((p) => ({ docNo: p.doc_no, type: p.txn_type, date: p.txn_date, qty: d3(p.qty_in || p.qty_out), lineNo: p.line_no, value: mask(p.value, actor, pid) }));
    }
    return o;
  };
  const row = (actor, id, key = 'inv.transfer.view') => { const t = db.prepare('SELECT * FROM inv_transfers WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!t || !inScope(actor, 'inv.transfer.view', t)) throw notFound('That transfer does not exist.'); if (key !== 'inv.transfer.view' && !inScope(actor, key, t)) need(actor, key, 'do that to this transfer', t.from_project_id ?? t.to_project_id); return t; };
  function header(actor, b) {
    const from = db.prepare('SELECT * FROM inv_stores WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(b.fromStoreId), actor.companyId); const to = db.prepare('SELECT * FROM inv_stores WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(b.toStoreId), actor.companyId);
    if (!from || !to) throw notFound('That store does not exist.'); if (from.id === to.id) fail([{ field: 'toStoreId', message: 'Choose another store' }]); for (const s of [from, to]) if (s.store_status !== 'ACTIVE') throw unprocessable(`The store ${s.code} is not active.`);
    if (!keeps(actor, from) && !keeps(actor, to)) throw notFound('You may request a transfer from or to a store you work in.'); need(actor, 'inv.transfer.create', 'request a transfer', from.org_project_id ?? to.org_project_id);
    const inter = (from.org_project_id ?? 0) !== (to.org_project_id ?? 0); if (b.requiredBy && b.requiredBy < todayIST()) fail([{ field: 'requiredBy', message: 'The date is in the past' }]);
    let mr = null; if (b.mrId) { mr = db.prepare('SELECT * FROM proc_material_requests WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(b.mrId), actor.companyId); if (!mr || mr.status !== 'APPROVED') throw unprocessable('That material request is not an approved request.'); }
    return { from, to, inter, mr };
  }
  function buildLines(actor, input) {
    const problems = []; const out = []; input.forEach((x, i) => { const item = stock.itemOf(actor.companyId, x.itemId); if (!item) { problems.push({ field: `lines.${i}.itemId`, message: 'Not an item of this company' }); return; } if (!item.stock_tracked) { problems.push({ field: `lines.${i}.itemId`, message: `${item.code} is not kept in stock` }); return; } const uom = x.uom ?? item.base_uom; stock.toBase(item, uom, 1000);
      out.push({ line_no: out.length + 1, item_id: item.id, uom, qty_requested: t3(x.qty), batch_no: (x.batchNo ?? '').trim() || null }); }); fail(problems); if (!out.length) fail([{ field: 'lines', message: 'Add at least one line' }]); return out;
  }
  const saveLines = (actor, h, lines) => {
    for (const l of lines) { const have = db.prepare('SELECT id FROM inv_transfer_lines WHERE transfer_id = ? AND line_no = ?').get(h.id, l.line_no);
      if (have) db.prepare('UPDATE inv_transfer_lines SET item_id = ?, uom = ?, qty_requested = ?, batch_no = ?, deleted_at = NULL, is_active = 1, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(l.item_id, l.uom, l.qty_requested, l.batch_no, actor.user, nowIso(), have.id);
      else db.prepare("INSERT INTO inv_transfer_lines (company_id, transfer_id, line_no, item_id, uom, qty_requested, batch_no, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, h.id, l.line_no, l.item_id, l.uom, l.qty_requested, l.batch_no, h.from_project_id ?? h.to_project_id, actor.user); }
    db.prepare('DELETE FROM inv_transfer_lines WHERE transfer_id = ? AND line_no > ?').run(h.id, lines.length);
  };
  const prefill = (actor, q) => {
    need(actor, 'inv.transfer.create', 'request a transfer'); const mr = db.prepare('SELECT * FROM proc_material_requests WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(q.mrId), actor.companyId); if (!mr || !may(actor, 'inv.transfer.create', mr.org_project_id)) throw notFound('That material request does not exist.'); if (mr.status !== 'APPROVED') throw unprocessable('The material request is not approved.');
    return { mrId: mr.id, mrNo: mr.doc_no, projectId: mr.org_project_id, requiredBy: mr.required_by ?? null, lines: db.prepare('SELECT l.item_id, l.uom, l.qty, l.issue_qty, l.transfer_qty, i.code, i.name FROM proc_mr_lines l JOIN mdm_items i ON i.id = l.item_id WHERE l.mr_id = ? AND l.deleted_at IS NULL').all(mr.id).map((l) => ({ itemId: l.item_id, item: `${l.code} ${l.name}`, uom: l.uom, qty: d3(Math.max(0, l.qty - l.issue_qty - l.transfer_qty)) })).filter((l) => l.qty > 0) };
  };
  const transfers = {
    list(actor, query) { const sc = scope(actor, 'inv.transfer.view'); return runList(db, transferList, parseListRequest(transferList, query), { select: 'x.*', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (t) => view(actor, t) }); },
    get: (actor, id) => view(actor, row(actor, id), { detail: true }),
    prefill,
    options(actor) { need(actor, 'inv.transfer.view', 'see the transfers'); return { stores: db.prepare("SELECT s.id, s.code, s.name, s.org_project_id AS projectId, p.code AS project FROM inv_stores s LEFT JOIN org_projects p ON p.id = s.org_project_id WHERE s.company_id = ? AND s.deleted_at IS NULL AND s.store_status = 'ACTIVE' ORDER BY s.code").all(actor.companyId).filter((s) => !s.projectId || may(actor, 'inv.transfer.view', s.projectId)).map((s) => ({ ...s, mine: keeps(actor, { id: s.id }) })) }; },
    summary(actor) { const sc = scope(actor, 'inv.transfer.view'); const n = (sql) => db.prepare(sql).get(sc.params).n; return { awaitingApproval: n(`SELECT COUNT(*) AS n FROM inv_transfers x WHERE ${sc.sql} AND x.status = 'SUBMITTED' AND x.deleted_at IS NULL`), readyToDispatch: n(`SELECT COUNT(*) AS n FROM inv_transfers x WHERE ${sc.sql} AND x.status = 'APPROVED' AND x.deleted_at IS NULL`), inTransit: n(`SELECT COUNT(*) AS n FROM inv_transfers x WHERE ${sc.sql} AND x.status = 'IN_TRANSIT' AND x.deleted_at IS NULL`), openDiscrepancies: n(`SELECT COUNT(*) AS n FROM inv_transfer_discrepancies d JOIN inv_transfers x ON x.id = d.transfer_id WHERE ${sc.sql} AND d.status <> 'RESOLVED' AND d.deleted_at IS NULL`) }; },
    create(actor, b) {
      const h = header(actor, b); const lines = buildLines(actor, b.lines);
      return transaction(db, () => { const no = number(actor.companyId, actor.user, 'INV_TRANSFER', 'inv_transfers', 'TRF'); const id = Number(db.prepare("INSERT INTO inv_transfers (company_id, doc_no, request_date, required_by, from_store_id, to_store_id, from_project_id, to_project_id, mr_id, inter_project, inter_state, document_type, reason, status, requested_by, project_id, site_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)")
        .run(actor.companyId, no, todayIST(), b.requiredBy ?? null, h.from.id, h.to.id, h.from.org_project_id ?? null, h.to.org_project_id ?? null, h.mr?.id ?? null, h.inter ? 1 : 0, b.interState ? 1 : 0, b.interState ? 'TAX_INVOICE' : 'DELIVERY_CHALLAN', b.reason ?? null, actor.user, h.from.org_project_id ?? h.to.org_project_id, h.from.org_site_id ?? null, actor.user, h.mr ? 'proc_material_request' : 'api', h.mr ? String(h.mr.id) : null).lastInsertRowid);
        saveLines(actor, { id, from_project_id: h.from.org_project_id, to_project_id: h.to.org_project_id }, lines); audit(actor, 'inv_transfers', id, 'create', actor.companyId); return transfers.get(actor, id); });
    },
    update(actor, id, b) {
      const t = row(actor, id, 'inv.transfer.edit'); if (!EDITABLE.includes(t.status)) throw conflict('Only a draft or a returned transfer is changed.'); if (b.rowVersion && b.rowVersion !== t.version) throw conflict('Someone changed this transfer; reload it.');
      return transaction(db, () => { const lines = b.lines ? buildLines(actor, b.lines) : null; db.prepare('UPDATE inv_transfers SET required_by = ?, reason = ?, inter_state = ?, document_type = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.requiredBy !== undefined ? b.requiredBy : t.required_by, b.reason !== undefined ? b.reason : t.reason, b.interState != null ? (b.interState ? 1 : 0) : t.inter_state, (b.interState ?? Boolean(t.inter_state)) ? 'TAX_INVOICE' : 'DELIVERY_CHALLAN', actor.user, nowIso(), t.id); if (lines) saveLines(actor, t, lines); audit(actor, 'inv_transfers', t.id, 'update', t.company_id); return transfers.get(actor, t.id); });
    },
    remove(actor, id) { const t = row(actor, id, 'inv.transfer.delete'); if (t.status !== 'DRAFT') throw conflict('Only a draft is deleted.'); db.prepare('UPDATE inv_transfers SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, t.id); audit(actor, 'inv_transfers', t.id, 'delete', t.company_id); return { id: t.id, deleted: true }; },
    /** The chain: the construction manager (or store manager) of the source; between projects the project managers of both as well. */
    submit(actor, id) {
      const t = row(actor, id, 'inv.transfer.submit'); if (!EDITABLE.includes(t.status)) throw unprocessable('Only a draft or a returned transfer is sent for approval.');
      return transaction(db, () => { const ctx = { projectId: t.from_project_id ?? t.to_project_id ?? undefined, needPm: t.inter_project ? 'yes' : 'no' };
        if (t.status === 'RETURNED' && t.workflow_instance_id) workflowOf(db).resubmit(actor, t.workflow_instance_id, { comment: 'Corrected', context: ctx }); else { const inst = workflowOf(db).submit(actor, { docType: INV_TRANSFER_DOC, docId: String(t.id), comment: `${t.doc_no} ${storeOf(t.from_store_id).code} to ${storeOf(t.to_store_id).code}${t.inter_project ? ' (between projects)' : ''}`.slice(0, 300), context: ctx }); db.prepare('UPDATE inv_transfers SET workflow_instance_id = ? WHERE id = ?').run(inst.id, t.id); }
        db.prepare("UPDATE inv_transfers SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), t.id); audit(actor, 'inv_transfers', t.id, 'submit', t.company_id); return transfers.get(actor, t.id); });
    },
    withdraw(actor, id, { reason }) { const t = row(actor, id); if (t.status !== 'SUBMITTED') throw unprocessable('Only a transfer waiting for approval is withdrawn.'); if (!same(t.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, t.workflow_instance_id, { comment: reason }); return transfers.get(actor, t.id); },
    cancel(actor, id, { reason }) { const t = row(actor, id, 'inv.transfer.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED', 'APPROVED'].includes(t.status)) throw unprocessable('Only a transfer not yet dispatched is cancelled; a dispatched one is received.'); return transaction(db, () => { if (t.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, t.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE inv_transfers SET status = 'CANCELLED', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), t.id); audit(actor, 'inv_transfers', t.id, 'cancel', t.company_id, { reason }); return transfers.get(actor, t.id); }); },
    amend(actor, id) { row(actor, id, 'inv.transfer.amend'); throw unprocessable('An approved transfer is not changed: cancel it before it is dispatched and make a new request, or receive it and resolve the discrepancy.'); },
    history(actor, id) { const t = row(actor, id); return { approvals: db.prepare('SELECT h.event, h.actor, h.comment, h.at, h.step_code FROM wf_history h JOIN wf_instances i ON i.id = h.instance_id WHERE i.doc_type = ? AND i.doc_id = ? AND i.company_id = ? ORDER BY h.id').all(INV_TRANSFER_DOC, String(t.id), t.company_id), audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity IN ('inv_transfers', 'inv_transfer_discrepancies') AND entity_id IN (?, ?) ORDER BY id").all(String(t.id), `t${t.id}`) }; },
    decide(instance, actor, outcome, comment) {
      const t = db.prepare('SELECT * FROM inv_transfers WHERE id = ?').get(rid(instance.docId)); if (!t || t.status !== 'SUBMITTED') return; const now = nowIso();
      if (outcome === 'APPROVED') { db.prepare("UPDATE inv_transfers SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, t.id); audit(actor, 'inv_transfers', t.id, 'approve', t.company_id); notify(t.company_id, 'inv.transfer.decided', [`user:${t.requested_by}`, 'role:SK|STOREMGR'], t.doc_no, 'approved', `${t.doc_no} is approved: the source store dispatches it.`, `/inv/transfers?id=${t.id}`, t.id, { projectId: t.from_project_id ?? undefined }); return; }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE inv_transfers SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : t.workflow_instance_id, actor.user, now, t.id); audit(actor, 'inv_transfers', t.id, outcome.toLowerCase(), t.company_id, { reason: comment });
      notify(t.company_id, 'inv.transfer.decided', [`user:${t.requested_by}`], t.doc_no, outcome.toLowerCase(), `${t.doc_no} is ${outcome === 'RETURNED' ? 'returned to you for correction' : outcome === 'REJECTED' ? 'rejected' : 'closed'}${comment ? `: ${comment}` : ''}.`, `/inv/transfers?id=${t.id}`, t.id, { projectId: t.from_project_id ?? undefined });
    },
    /** BR-01: at dispatch the stock leaves the source for transit. The value that leaves is the source's average (the book rate). Between states, or at or above the threshold, an e-way bill number is needed (FR-02). */
    dispatch(actor, id, b) {
      const t = row(actor, id, 'inv.transfer.dispatch'); if (t.status !== 'APPROVED') throw unprocessable('Only an approved transfer is dispatched.'); const from = storeOf(t.from_store_id); const to = storeOf(t.to_store_id); invSvc.storeFor(actor, from.id, 'inv.store.view');
      const ls = lineRows(t.id); const want = new Map((b.lines ?? []).map((x) => [x.lineId, x.qty])); const problems = [];
      const plan = ls.map((l, i) => { const q = want.size ? (want.has(l.id) ? t3(want.get(l.id)) : 0) : l.qty_requested; if (q > l.qty_requested) { problems.push({ field: `lines.${i}.qty`, message: `More than the ${d3(l.qty_requested)} requested` }); return null; } return { l, q }; }).filter((x) => x && x.q > 0); fail(problems); if (!plan.length) fail([{ field: 'lines', message: 'Dispatch at least one line' }]);
      return transaction(db, () => {
        const now = nowIso(); const date = todayIST(); let total = 0; const out = []; const owner = toOwner(to);
        for (const { l, q } of plan) {
          const item = stock.itemOf(t.company_id, l.item_id); const bq = stock.toBase(item, l.uom, q); const entries = stock.postOut(actor, { store: from, itemId: item.id, batchNo: l.batch_no ?? undefined, type: 'TRANSFER_OUT', qty: bq.qty, date, sourceType: 'inv_transfer_line', sourceId: String(l.id), reason: `Transfer ${t.doc_no} to ${to.code}` });
          const value = entries.reduce((n, e) => n + Math.abs(e.value), 0); total += value; const batches = [...new Set(entries.map((e) => e.batch_no).filter(Boolean))];
          for (const e of entries) { const r = transitRow(to, item.id, e.batch_no ?? '', owner); db.prepare('UPDATE inv_balances SET qty_in_transit = qty_in_transit + ?, updated_at = ?, version = version + 1 WHERE id = ?').run(e.qty_out, now, r.id); }
          db.prepare('UPDATE inv_transfer_lines SET qty_dispatched = ?, rate = ?, value = ?, batch_no = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(q, Math.round((value * 1000) / q), value, batches.length === 1 ? batches[0] : l.batch_no, actor.user, now, l.id); out.push({ lineId: l.id, itemId: item.id, qty: d3(q), value });
        }
        for (const l of ls) if (!plan.some((p) => p.l.id === l.id)) db.prepare('UPDATE inv_transfer_lines SET deleted_at = ?, updated_at = ? WHERE id = ? AND qty_dispatched = 0').run(now, now, l.id);
        const threshold = Number(param(t.company_id, 'inv.transfer.eway_threshold') ?? 5_000_000); const interState = b.interState != null ? Boolean(b.interState) : Boolean(t.inter_state); const required = interState || total >= threshold;
        // part 23.07: the e-way bill generated for this transfer is its number unless another is typed
        const ewbNo = (b.ewayBillNo ?? '').trim() || taxEngineOf(db)?.ewaybills?.activeFor(t.company_id, 'inv_transfers', t.id) || '';
        if (required && !ewbNo) fail([{ field: 'ewayBillNo', message: interState ? 'A transfer between states needs an e-way bill number' : `A transfer worth ${threshold / 100} or more needs an e-way bill number` }]);
        db.prepare("UPDATE inv_transfers SET status = 'IN_TRANSIT', vehicle_no = ?, driver_name = ?, eway_bill_no = ?, eway_required = ?, inter_state = ?, document_type = ?, dispatch_date = ?, dispatched_by = ?, total_value = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run((b.vehicleNo ?? '').toUpperCase().replace(/[\s-]+/g, '') || null, b.driverName ?? null, ewbNo || null, required ? 1 : 0, interState ? 1 : 0, interState ? 'TAX_INVOICE' : 'DELIVERY_CHALLAN', date, actor.user, total, actor.user, now, t.id);
        const fresh = db.prepare('SELECT * FROM inv_transfers WHERE id = ?').get(t.id); const passId = gate.passes.createForTransfer(actor, { companyId: t.company_id, projectId: t.from_project_id, siteId: from.org_site_id, transfer: fresh, destination: `${to.code} ${to.name}`, lines: plan.map(({ l, q }) => ({ description: itemLabel(l.item_id), qty: q, uom: l.uom })) }); db.prepare('UPDATE inv_transfers SET gate_pass_id = ? WHERE id = ?').run(passId, t.id); audit(actor, 'inv_transfers', t.id, 'dispatch', t.company_id);
        evt('inv.transfer.dispatched', actor, t.company_id, 'inv_transfers', t.id, { transferId: t.id, docNo: t.doc_no, fromStoreId: from.id, fromStore: from.code, toStoreId: to.id, toStore: to.code, fromProjectId: t.from_project_id, toProjectId: t.to_project_id, interProject: Boolean(t.inter_project), interState, documentType: interState ? 'TAX_INVOICE' : 'DELIVERY_CHALLAN', vehicleNo: fresh.vehicle_no, ewayBillNo: fresh.eway_bill_no, gatePassId: passId, totalValue: total, lines: out }, t.from_project_id);
        notify(t.company_id, 'inv.transfer.dispatched', ['role:SK|STOREMGR'], t.doc_no, `on its way to ${to.code}`, `${t.doc_no} left ${from.code} for ${to.code}${fresh.vehicle_no ? ` on vehicle ${fresh.vehicle_no}` : ''}. Receive it when it arrives.`, `/inv/transfers?id=${t.id}`, `${t.id}.dispatch`, { projectId: t.to_project_id ?? undefined }); return transfers.get(actor, t.id);
      });
    },
    /** BR-01: at receipt the received quantity enters the destination (the value comes with it, so between projects the cost moves with the stock). Damage and shortage are held as discrepancies until they are resolved. */
    receive(actor, id, b) {
      const t = row(actor, id, 'inv.transfer.receive'); if (t.status !== 'IN_TRANSIT') throw unprocessable('Only a transfer in transit is received.'); const from = storeOf(t.from_store_id); const to = storeOf(t.to_store_id); invSvc.storeFor(actor, to.id, 'inv.store.view');
      const ls = lineRows(t.id); const given = new Map((b.lines ?? []).map((x) => [x.lineId, x])); const problems = [];
      const plan = ls.map((l, i) => { const g = given.get(l.id) ?? { receivedQty: 0, damagedQty: 0 }; const rec = t3(g.receivedQty ?? 0); const dam = t3(g.damagedQty ?? 0); const pend = inTransitQty(l); if (rec + dam > pend) { problems.push({ field: `lines.${i}.receivedQty`, message: `Only ${d3(pend)} of ${l.icode} is still on its way` }); return null; } return { l, rec, dam, note: g.note ?? null, pend }; }).filter(Boolean); fail(problems);
      for (const id2 of given.keys()) if (!ls.some((l) => l.id === id2)) fail([{ field: 'lines', message: 'Not a line of this transfer' }]);
      return transaction(db, () => {
        const now = nowIso(); const date = todayIST(); const owner = toOwner(to); const delta = []; let receivedValue = 0;
        for (const p of plan) {
          const { l } = p; const item = stock.itemOf(t.company_id, l.item_id); const stillAfter = p.pend - p.rec - p.dam; const short = b.final ? stillAfter : 0;
          if (p.rec > 0) {
            const portion = valueUpTo(l, l.qty_received + p.rec) - valueUpTo(l, l.qty_received); const bq = stock.toBase(item, l.uom, p.rec); const counter = db.prepare("SELECT id FROM inv_stock_ledger WHERE source_type = 'inv_transfer_line' AND source_id = ? AND txn_type = 'TRANSFER_OUT' ORDER BY id LIMIT 1").get(String(l.id))?.id;
            stock.postOne(actor, { store: to, itemId: item.id, batchNo: l.batch_no ?? '', type: 'TRANSFER_IN', qty: bq.qty, value: portion, date, ownerProjectId: owner ?? undefined, pool: owner == null, sourceType: 'inv_transfer_line', sourceId: String(l.id), reason: `Transfer ${t.doc_no} from ${from.code}`, counterId: counter }); receivedValue += portion;
            db.prepare('UPDATE inv_balances SET qty_in_transit = MAX(0, qty_in_transit - ?), updated_at = ?, version = version + 1 WHERE id = ?').run(bq.qty, now, transitRow(to, item.id, l.batch_no ?? '', owner).id);
          }
          db.prepare('UPDATE inv_transfer_lines SET qty_received = qty_received + ?, qty_damaged = qty_damaged + ?, qty_shortage = qty_shortage + ?, discrepancy_note = COALESCE(?, discrepancy_note), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(p.rec, p.dam, short, p.note, actor.user, now, l.id);
          delta.push({ lineId: l.id, itemId: l.item_id, receivedQty: d3(p.rec), damagedQty: d3(p.dam), shortageQty: d3(short) });
        }
        const after = lineRows(t.id); const done = after.every((l) => inTransitQty(l) === 0);
        if (done) {
          const remValue = (l) => l.value - valueUpTo(l, l.qty_received);
          for (const l of after) { const total = l.qty_damaged + l.qty_shortage; if (total === 0 || db.prepare('SELECT 1 FROM inv_transfer_discrepancies WHERE line_id = ? AND deleted_at IS NULL').get(l.id)) continue; const rem = remValue(l);
            const part = (qty, key) => { if (qty > 0) db.prepare(`INSERT INTO inv_transfer_discrepancies (company_id, transfer_id, line_id, ${key}, value, status, raised_by, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, 'inv_transfer')`).run(t.company_id, t.id, l.id, qty, Math.round((rem * qty) / total), actor.user, t.from_project_id ?? t.to_project_id, actor.user); };
            part(l.qty_shortage, 'shortage_qty'); part(l.qty_damaged, 'damaged_qty'); }
        }
        const open = done && db.prepare("SELECT 1 FROM inv_transfer_discrepancies WHERE transfer_id = ? AND status <> 'RESOLVED' AND deleted_at IS NULL").get(t.id);
        if (done) db.prepare('UPDATE inv_transfers SET status = ?, received_date = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(open ? 'DISCREPANCY' : 'RECEIVED', date, actor.user, now, t.id); else db.prepare('UPDATE inv_transfers SET updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, now, t.id);
        audit(actor, 'inv_transfers', t.id, 'receive', t.company_id, { newValues: delta });
        evt('inv.transfer.received', actor, t.company_id, 'inv_transfers', t.id, { transferId: t.id, docNo: t.doc_no, fromStoreId: from.id, toStoreId: to.id, fromProjectId: t.from_project_id, toProjectId: t.to_project_id, interProject: Boolean(t.inter_project), receivedOn: date, final: done, receivedValue, costTransfer: t.inter_project && receivedValue > 0 ? { fromProjectId: t.from_project_id, toProjectId: t.to_project_id, value: receivedValue } : null, lines: delta }, t.to_project_id ?? t.from_project_id);
        if (t.inter_project && receivedValue > 0) evt('inv.stock.transferred', actor, t.company_id, 'inv_transfers', t.id, { itemId: null, qty: null, value: receivedValue, fromStoreId: from.id, toStoreId: to.id, fromProjectId: t.from_project_id, toProjectId: t.to_project_id, outIds: [], inIds: [], reason: `Transfer ${t.doc_no}` }, t.to_project_id);
        if (open) notify(t.company_id, 'inv.transfer.discrepancy', ['role:STOREMGR|PROCMGR'], t.doc_no, 'received with a discrepancy', `${t.doc_no}: ${after.filter((l) => l.qty_damaged + l.qty_shortage > 0).map((l) => `${l.icode} short ${d3(l.qty_shortage)}, damaged ${d3(l.qty_damaged)}`).join('; ')}. The stock is held until it is resolved.`, `/inv/transfers?id=${t.id}`, `${t.id}.disc`, { projectId: t.from_project_id ?? undefined });
        return transfers.get(actor, t.id);
      });
    },
    photo(actor, id, { fileId, kind }) {
      const t = row(actor, id); if (!['inv.transfer.create', 'inv.transfer.dispatch', 'inv.transfer.receive'].some((k) => inScope(actor, k, t))) throw forbidden('You may not add photos to this transfer.'); if (['CANCELLED', 'REJECTED'].includes(t.status)) throw conflict('This transfer is closed.');
      const f = db.prepare('SELECT id FROM core_files WHERE id = ? AND company_id = ? AND linked_entity = ? AND linked_id = ?').get(rid(fileId), actor.companyId, 'inv_transfer', t.id); if (!f) throw unprocessable('That file is not attached to this transfer. Upload it to the transfer first.');
      const list = json(t.photos_json, []).filter((p) => p.fileId !== f.id); list.push({ fileId: f.id, kind, by: actor.user, at: nowIso() }); db.prepare('UPDATE inv_transfers SET photos_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(list), actor.user, nowIso(), t.id); audit(actor, 'inv_transfers', t.id, 'photo', t.company_id); return transfers.get(actor, t.id);
    },
    /** Discrepancy resolution: a shortage found is accepted, damaged goods go back to the source, or the loss is written off (the store manager, then the procurement manager). */
    resolve(actor, id, did, b) {
      const t = row(actor, id, 'inv.transfer.resolve'); const d = db.prepare('SELECT * FROM inv_transfer_discrepancies WHERE id = ? AND transfer_id = ? AND deleted_at IS NULL').get(rid(did), t.id); if (!d) throw notFound('That discrepancy does not exist.'); if (d.status !== 'OPEN') throw unprocessable('This discrepancy is already resolved or waiting for approval.');
      const l = db.prepare('SELECT * FROM inv_transfer_lines WHERE id = ?').get(d.line_id); const qty = d.shortage_qty || d.damaged_qty; const from = storeOf(t.from_store_id); const to = storeOf(t.to_store_id); const item = stock.itemOf(t.company_id, l.item_id); const owner = toOwner(to); const now = nowIso(); const date = todayIST();
      if (b.action === 'RETURN_TO_SOURCE' && d.shortage_qty > 0) throw unprocessable('A shortage is not on site to send back: write it off, or accept it if it was found.');
      return transaction(db, () => {
        const finish = () => { db.prepare("UPDATE inv_transfer_discrepancies SET status = 'RESOLVED', resolution = ?, resolution_note = ?, resolved_by = ?, resolved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(b.action, b.note, actor.user, now, actor.user, now, d.id); if (!db.prepare("SELECT 1 FROM inv_transfer_discrepancies WHERE transfer_id = ? AND status <> 'RESOLVED' AND deleted_at IS NULL").get(t.id)) db.prepare("UPDATE inv_transfers SET status = 'RECEIVED', updated_at = ?, version = version + 1 WHERE id = ?").run(now, t.id); };
        const bq = stock.toBase(item, l.uom, qty); const drop = () => db.prepare('UPDATE inv_balances SET qty_in_transit = MAX(0, qty_in_transit - ?), updated_at = ?, version = version + 1 WHERE id = ?').run(bq.qty, now, transitRow(to, item.id, l.batch_no ?? '', owner).id);
        if (b.action === 'ACCEPT') { stock.postOne(actor, { store: to, itemId: item.id, batchNo: l.batch_no ?? '', type: 'TRANSFER_IN', qty: bq.qty, value: d.value, date, ownerProjectId: owner ?? undefined, pool: owner == null, sourceType: 'inv_transfer_line', sourceId: String(l.id), reason: `Transfer ${t.doc_no}: ${d.shortage_qty ? 'shortage found' : 'damaged accepted'}`, counterId: db.prepare("SELECT id FROM inv_stock_ledger WHERE source_type = 'inv_transfer_line' AND source_id = ? AND txn_type = 'TRANSFER_OUT' ORDER BY id LIMIT 1").get(String(l.id))?.id }); drop();
          db.prepare(`UPDATE inv_transfer_lines SET qty_received = qty_received + ?, ${d.shortage_qty ? 'qty_shortage = qty_shortage - ?' : 'qty_damaged = qty_damaged - ?'}, updated_at = ?, version = version + 1 WHERE id = ?`).run(qty, qty, now, l.id); finish(); audit(actor, 'inv_transfer_discrepancies', `t${t.id}`, 'accept', t.company_id, { reason: b.note });
          evt('inv.transfer.received', actor, t.company_id, 'inv_transfers', t.id, { transferId: t.id, docNo: t.doc_no, fromStoreId: from.id, toStoreId: to.id, fromProjectId: t.from_project_id, toProjectId: t.to_project_id, interProject: Boolean(t.inter_project), receivedOn: date, final: true, receivedValue: d.value, costTransfer: t.inter_project ? { fromProjectId: t.from_project_id, toProjectId: t.to_project_id, value: d.value } : null, lines: [{ lineId: l.id, itemId: l.item_id, receivedQty: d3(qty), damagedQty: 0, shortageQty: 0 }], resolution: 'ACCEPT' }, t.to_project_id ?? t.from_project_id); }
        else if (b.action === 'RETURN_TO_SOURCE') { stock.postOne(actor, { store: from, itemId: item.id, batchNo: l.batch_no ?? '', type: 'TRANSFER_IN', qty: bq.qty, value: d.value, date, sourceType: 'inv_transfer_line', sourceId: String(l.id), reason: `Transfer ${t.doc_no}: damaged goods returned to ${from.code}` }); drop(); finish(); audit(actor, 'inv_transfer_discrepancies', `t${t.id}`, 'return_to_source', t.company_id, { reason: b.note }); }
        else {
          db.prepare('UPDATE inv_transfer_discrepancies SET resolved_by = ? WHERE id = ?').run(actor.user, d.id);
          const inst = workflowOf(db).submit(actor, { docType: INV_TRDISC_DOC, docId: String(d.id), comment: `${t.doc_no} ${itemLabel(l.item_id)} ${d3(qty)} ${d.shortage_qty ? 'short' : 'damaged'}: ${b.note}`.slice(0, 300), context: { projectId: t.from_project_id ?? t.to_project_id ?? undefined } });
          db.prepare("UPDATE inv_transfer_discrepancies SET status = 'PENDING', resolution = 'WRITE_OFF', resolution_note = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(b.note, inst.id, actor.user, now, d.id); audit(actor, 'inv_transfer_discrepancies', `t${t.id}`, 'write_off_submit', t.company_id, { reason: b.note });
        }
        return transfers.get(actor, t.id);
      });
    },
    /** The write-off is decided by the store manager and then the procurement manager. */
    decideWriteOff(instance, actor, outcome, comment) {
      const d = db.prepare('SELECT * FROM inv_transfer_discrepancies WHERE id = ?').get(rid(instance.docId)); if (!d || d.status !== 'PENDING') return; const t = db.prepare('SELECT * FROM inv_transfers WHERE id = ?').get(d.transfer_id); const now = nowIso();
      if (outcome !== 'APPROVED') { db.prepare("UPDATE inv_transfer_discrepancies SET status = 'OPEN', resolution = NULL, workflow_instance_id = NULL, updated_at = ?, version = version + 1 WHERE id = ?").run(now, d.id); audit(actor, 'inv_transfer_discrepancies', `t${t.id}`, outcome.toLowerCase(), t.company_id, { reason: comment }); return; }
      const l = db.prepare('SELECT * FROM inv_transfer_lines WHERE id = ?').get(d.line_id); const to = storeOf(t.to_store_id); const item = stock.itemOf(t.company_id, l.item_id); const qty = d.shortage_qty || d.damaged_qty; const bq = stock.toBase(item, l.uom, qty);
      db.prepare('UPDATE inv_balances SET qty_in_transit = MAX(0, qty_in_transit - ?), updated_at = ?, version = version + 1 WHERE id = ?').run(bq.qty, now, transitRow(to, item.id, l.batch_no ?? '', toOwner(to)).id);
      db.prepare("UPDATE inv_transfer_discrepancies SET status = 'RESOLVED', resolved_by = ?, resolved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, d.id); if (!db.prepare("SELECT 1 FROM inv_transfer_discrepancies WHERE transfer_id = ? AND status <> 'RESOLVED' AND deleted_at IS NULL").get(t.id)) db.prepare("UPDATE inv_transfers SET status = 'RECEIVED', updated_at = ?, version = version + 1 WHERE id = ?").run(now, t.id);
      audit(actor, 'inv_transfer_discrepancies', `t${t.id}`, 'write_off', t.company_id, { reason: comment });
      evt('inv.transfer.written_off', actor, t.company_id, 'inv_transfers', t.id, { transferId: t.id, docNo: t.doc_no, itemId: l.item_id, qty: d3(qty), kind: d.shortage_qty ? 'SHORTAGE' : 'DAMAGED', value: d.value, fromProjectId: t.from_project_id, toProjectId: t.to_project_id, reason: d.resolution_note }, t.to_project_id ?? t.from_project_id);
    },
    print(actor, id) {
      const t = row(actor, id, 'inv.transfer.print'); const v = view(actor, t, { detail: true }); audit(actor, 'inv_transfers', t.id, 'print', t.company_id);
      const columns = [['n', '#'], ['i', 'Item'], ['r', 'Requested'], ['d', 'Dispatched'], ['c', 'Received'], ['x', 'Damaged'], ['s', 'Short'], ['b', 'Batch']].map(([key, label]) => ({ key, label, type: 'text' })); const rows = v.lines.map((l) => ({ n: String(l.lineNo), i: l.item, r: String(l.requestedQty), d: String(l.dispatchedQty), c: String(l.receivedQty), x: String(l.damagedQty), s: String(l.shortageQty), b: l.batchNo ?? '' }));
      return { buffer: toPdf({ columns, rows, footer: [`${v.docNo}: ${v.from} to ${v.to}; ${v.documentType === 'TAX_INVOICE' ? 'tax invoice (between states)' : 'delivery challan'}${v.interProject ? '; between projects' : ''}`, `Vehicle ${v.vehicleNo ?? '-'}, driver ${v.driverName ?? '-'}, e-way bill ${v.ewayBillNo ?? '-'}; dispatched ${v.dispatchDate ?? '-'}`, `Requested by ${v.requestedBy}${v.approvedBy ? `; approved by ${v.approvedBy}` : ''}`], title: `Stock transfer ${v.docNo}` }), contentType: 'application/pdf', fileName: `${v.docNo.replaceAll('/', '-')}.pdf`, rows: rows.length };
    },
    importRows(actor, { rows }) {
      need(actor, 'inv.transfer.import', 'import transfers'); const problems = []; const groups = new Map();
      rows.forEach((x, i) => { const f = db.prepare('SELECT id FROM inv_stores WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, x.fromStore); const to = db.prepare('SELECT id FROM inv_stores WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, x.toStore); const it = db.prepare('SELECT id FROM mdm_items WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, x.itemCode);
        if (!f) { problems.push({ field: `rows.${i}.fromStore`, message: 'No such store' }); return; } if (!to) { problems.push({ field: `rows.${i}.toStore`, message: 'No such store' }); return; } if (!it) { problems.push({ field: `rows.${i}.itemCode`, message: 'No such item' }); return; }
        const k = `${f.id}|${to.id}`; const g = groups.get(k) ?? { fromStoreId: f.id, toStoreId: to.id, lines: [] }; g.lines.push({ itemId: it.id, qty: x.qty }); groups.set(k, g); });
      fail(problems); return transaction(db, () => ({ created: [...groups.values()].map((g) => transfers.create(actor, g).docNo) }));
    },
  };

  // ---- the in-transit report and its ageing (FR-04) -------------------------------------------------------------------------------------------------------------------------------------------------
  const inTransit = {
    report(actor, q = {}) {
      const sc = scope(actor, 'inv.transfer.view'); const P = { ...sc.params }; let extra = ''; if (q.storeId) { extra += ' AND (x.from_store_id = :st OR x.to_store_id = :st)'; P.st = rid(q.storeId); } if (q.projectId) { extra += ' AND (x.from_project_id = :pj OR x.to_project_id = :pj)'; P.pj = rid(q.projectId); }
      const today = todayIST(); const rows = []; const ts = db.prepare(`SELECT x.* FROM inv_transfers x WHERE ${sc.sql}${extra} AND x.status IN ('IN_TRANSIT', 'DISCREPANCY') AND x.deleted_at IS NULL ORDER BY x.dispatch_date, x.id`).all(P);
      for (const t of ts) { const pid = t.from_project_id ?? t.to_project_id; const age = t.dispatch_date ? daysBetween(t.dispatch_date, today) : 0; const open = new Map(); for (const d of discRows(t.id).filter((x) => x.status !== 'RESOLVED')) open.set(d.line_id, (open.get(d.line_id) ?? 0) + (d.shortage_qty || d.damaged_qty));
        for (const l of lineRows(t.id)) { const road = inTransitQty(l); const held = open.get(l.id) ?? 0; if (road + held <= 0) continue; const q2 = road + held;
          rows.push({ transferId: t.id, docNo: t.doc_no, item: `${l.icode} ${l.iname}`, uom: l.uom, from: storeOf(t.from_store_id).code, to: storeOf(t.to_store_id).code, dispatchDate: t.dispatch_date, ageDays: age, onTheRoadQty: d3(road), heldQty: d3(held), qty: d3(q2), value: mask(l.qty_dispatched ? Math.round((l.value * q2) / l.qty_dispatched) : 0, actor, pid), interProject: Boolean(t.inter_project), status: t.status, vehicleNo: t.vehicle_no }); } }
      const alertDays = Number(param(actor.companyId, 'inv.transfer.transit_alert_days') ?? 3); const ageing = BUCKETS.map(([label, lo, hi]) => { const rs = rows.filter((r) => r.ageDays >= lo && r.ageDays <= hi); return { label, lines: rs.length, qty: rs.reduce((n, r) => n + r.qty, 0), value: rs.some((r) => r.value == null) ? null : rs.reduce((n, r) => n + r.value, 0) }; });
      return { today, alertDays, rows, ageing, totals: { lines: rows.length, transfers: new Set(rows.map((r) => r.transferId)).size, overdue: rows.filter((r) => r.ageDays > alertDays).length, value: rows.some((r) => r.value == null) ? null : rows.reduce((n, r) => n + r.value, 0) } };
    },
    /** FR-04: every morning the store managers are told of stock that has been on the road too long. */
    sweepAged() {
      let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) { const days = Number(param(c.id, 'inv.transfer.transit_alert_days') ?? 3);
        for (const t of db.prepare("SELECT * FROM inv_transfers WHERE company_id = ? AND status = 'IN_TRANSIT' AND deleted_at IS NULL AND dispatch_date IS NOT NULL").all(c.id)) { const age = daysBetween(t.dispatch_date, todayIST()); if (age <= days) continue; notify(c.id, 'inv.transfer.aged', ['role:STOREMGR'], t.doc_no, `${age} days in transit`, `${t.doc_no} from ${storeOf(t.from_store_id).code} to ${storeOf(t.to_store_id).code} has been on its way for ${age} days and is not received.`, `/inv/transfers?id=${t.id}`, `${t.id}.${todayIST()}`, { projectId: t.to_project_id ?? undefined }); n += 1; } } return n;
    },
  };
  return { transfers, inTransit };
}
