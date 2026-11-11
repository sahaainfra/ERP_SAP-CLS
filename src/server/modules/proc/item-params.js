import { transaction } from '../../platform/db/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { d3, nowIso, q3, rid, same } from './base.js';

// Item planning parameters (part 15.02, FR-03, FR-06, section 9): how MRP plans an item: lead time, minimum order and pack size, safety stock, whether it is long-lead, and a note of what the supplier can supply. These are configuration,
// so a change is made by a planner or procurement officer (maker), approved by the procurement manager (checker), written to the audit trail and never changes the one in force until it is approved.
export const PARAM_DOC = 'PROC_ITEM_PARAM';
export const PARAM_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'In force', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', SUPERSEDED: 'Superseded' };
export const paramList = defineList({
  code: 'proc.item_params', label: 'Item planning parameters', permission: 'proc.item_param.view', from: 'proc_item_params x JOIN mdm_items i ON i.id = x.item_id LEFT JOIN mdm_partners v ON v.id = x.vendor_id', where: 'x.deleted_at IS NULL', searchable: ['i.code', 'i.name', 'v.display_name'], defaultSort: 'item',
  columns: {
    item: { sql: 'i.code', type: 'text', label: 'Item' }, itemName: { sql: 'i.name', type: 'text', label: 'Name' }, vendor: { sql: 'COALESCE(v.display_name, v.legal_name)', type: 'text', label: 'Supplier' }, leadDays: { sql: 'x.lead_time_days', type: 'number', label: 'Lead time (days)' },
    moq: { sql: 'x.moq', type: 'text', label: 'Minimum order' }, safety: { sql: 'x.safety_stock', type: 'text', label: 'Safety stock' }, longLead: { sql: "CASE WHEN x.long_lead = 1 THEN 'YES' ELSE 'NO' END", type: 'enum', label: 'Long lead', options: [['YES', 'Yes'], ['NO', 'No']] },
    effectiveFrom: { sql: 'x.effective_from', type: 'date', label: 'From' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(PARAM_STATUS) },
  },
});

export function createItemParamService({ db, base }) {
  const { authz, may, need, fail, audit, notify, itemOf } = base;
  const row = (actor, id, key = 'proc.item_param.view') => {
    const r = db.prepare('SELECT * FROM proc_item_params WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r || !may(actor, 'proc.item_param.view')) throw notFound('That planning parameter does not exist.'); if (key !== 'proc.item_param.view') need(actor, key, 'do that with a planning parameter'); return r;
  };
  const view = (actor, r) => {
    const it = itemOf(r.company_id, r.item_id); const v = r.vendor_id ? db.prepare('SELECT display_name, legal_name FROM mdm_partners WHERE id = ?').get(r.vendor_id) : null; const own = same(r.requested_by, actor.user); const can = (k) => may(actor, k);
    return { id: r.id, itemId: r.item_id, itemCode: it?.code, itemName: it?.name, uom: it?.base_uom, vendorId: r.vendor_id, vendor: v?.display_name ?? v?.legal_name ?? null, leadTimeDays: r.lead_time_days, moq: d3(r.moq), packSize: d3(r.pack_size), safetyStock: d3(r.safety_stock), longLead: Boolean(r.long_lead), capacityNote: r.capacity_note, effectiveFrom: r.effective_from, status: r.status, statusLabel: PARAM_STATUS[r.status],
      requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, workflowInstanceId: r.workflow_instance_id, rowVersion: r.version,
      can: { edit: can('proc.item_param.edit') && ['DRAFT', 'RETURNED'].includes(r.status), submit: can('proc.item_param.submit') && ['DRAFT', 'RETURNED'].includes(r.status), withdraw: r.status === 'SUBMITTED' && own, cancel: can('proc.item_param.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status), delete: can('proc.item_param.edit') && r.status === 'DRAFT' && !r.workflow_instance_id, approve: can('proc.item_param.approve') && r.status === 'SUBMITTED' && !own } };
  };
  const check = (actor, b, id = null) => {
    const problems = []; const it = itemOf(actor.companyId, b.itemId); if (!it) problems.push({ field: 'itemId', message: 'Choose an item of the item master' });
    if (b.vendorId && !db.prepare('SELECT 1 FROM mdm_partners WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.vendorId, actor.companyId)) problems.push({ field: 'vendorId', message: 'Not a business partner of this company' });
    if (b.pack > 0 && b.moq > 0 && q3(b.moq) % q3(b.pack) !== 0) problems.push({ field: 'moq', message: 'The minimum order is a whole number of packs' });
    if (db.prepare("SELECT 1 FROM proc_item_params WHERE company_id = ? AND item_id = ? AND COALESCE(vendor_id, 0) = ? AND effective_from = ? AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED') AND deleted_at IS NULL AND id <> ?").get(actor.companyId, b.itemId, b.vendorId ?? 0, b.effectiveFrom, id ?? 0)) problems.push({ field: 'effectiveFrom', message: 'Parameters of this item and supplier already start on that date: change them, or give a later date' });
    fail(problems);
  };
  const params = {
    list(actor, query) { if (!authz.check(actor, 'proc.item_param.view').allowed) throw forbidden('You may not see item planning parameters (permission proc.item_param.view).'); return runList(db, paramList, parseListRequest(paramList, query), { select: 'x.*', scopeSql: 'x.company_id = :c', params: { c: actor.companyId }, tieBreaker: 'x.id', map: (x) => { const v = view(actor, x); return { id: x.id, item: v.itemCode, itemName: v.itemName, vendor: v.vendor, leadDays: x.lead_time_days, moq: String(v.moq), safety: String(v.safetyStock), longLead: x.long_lead ? 'YES' : 'NO', effectiveFrom: x.effective_from, status: x.status, statusLabel: v.statusLabel }; } }); },
    get: (actor, id) => { const v = view(actor, row(actor, id)); if (v.can.approve && v.workflowInstanceId) v.taskId = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === v.workflowInstanceId)?.id ?? null; return v; },
    create(actor, b) {
      need(actor, 'proc.item_param.edit', 'change item planning parameters'); check(actor, b);
      return transaction(db, () => { const id = Number(db.prepare("INSERT INTO proc_item_params (company_id, item_id, vendor_id, lead_time_days, moq, pack_size, safety_stock, long_lead, capacity_note, effective_from, status, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, 'api')").run(actor.companyId, b.itemId, b.vendorId ?? null, b.leadTimeDays, q3(b.moq ?? 0), q3(b.packSize ?? 0), q3(b.safetyStock ?? 0), b.longLead ? 1 : 0, b.capacityNote ?? null, b.effectiveFrom, actor.user, actor.user).lastInsertRowid); audit(actor, 'proc_item_params', id, 'create', actor.companyId); return params.get(actor, id); });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'proc.item_param.edit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict(r.status === 'APPROVED' ? 'Parameters in force are locked: enter new ones from a later date.' : `${PARAM_STATUS[r.status]}: they are not changed now.`); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed these parameters; reload them.');
      const m = { itemId: r.item_id, vendorId: r.vendor_id, leadTimeDays: b.leadTimeDays ?? r.lead_time_days, moq: b.moq ?? d3(r.moq), packSize: b.packSize ?? d3(r.pack_size), pack: b.packSize ?? d3(r.pack_size), safetyStock: b.safetyStock ?? d3(r.safety_stock), effectiveFrom: b.effectiveFrom ?? r.effective_from }; check(actor, m, r.id);
      db.prepare('UPDATE proc_item_params SET lead_time_days = ?, moq = ?, pack_size = ?, safety_stock = ?, long_lead = ?, capacity_note = ?, effective_from = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(m.leadTimeDays, q3(m.moq), q3(m.packSize), q3(m.safetyStock), 'longLead' in b ? (b.longLead ? 1 : 0) : r.long_lead, 'capacityNote' in b ? b.capacityNote : r.capacity_note, m.effectiveFrom, actor.user, nowIso(), r.id); audit(actor, 'proc_item_params', r.id, 'update', r.company_id, { oldValues: { lead: r.lead_time_days, moq: d3(r.moq), safety: d3(r.safety_stock) }, newValues: { lead: m.leadTimeDays, moq: m.moq, safety: m.safetyStock } }); return params.get(actor, r.id);
    },
    remove(actor, id) { const r = row(actor, id, 'proc.item_param.edit'); if (r.status !== 'DRAFT' || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted. Cancel it instead.'); db.prepare('UPDATE proc_item_params SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); audit(actor, 'proc_item_params', r.id, 'delete', r.company_id); return { id: r.id, deleted: true }; },
    submit(actor, id) {
      const r = row(actor, id, 'proc.item_param.submit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw unprocessable('Only a draft or returned parameter set is sent for approval.');
      return transaction(db, () => { const ctx = { itemId: r.item_id }; if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx }); else { const inst = workflowOf(db).submit(actor, { docType: PARAM_DOC, docId: String(r.id), comment: `${itemOf(r.company_id, r.item_id)?.code}: lead ${r.lead_time_days} days from ${r.effective_from}`.slice(0, 300), context: ctx }); db.prepare('UPDATE proc_item_params SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); } db.prepare("UPDATE proc_item_params SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id); audit(actor, 'proc_item_params', r.id, 'submit', r.company_id); return params.get(actor, r.id); });
    },
    withdraw(actor, id, { reason }) { const r = row(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only parameters waiting for approval are withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent them withdraws them.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return params.get(actor, r.id); },
    cancel(actor, id, { reason }) { const r = row(actor, id, 'proc.item_param.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status)) throw unprocessable('Only parameters that are not in force are cancelled.'); return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE proc_item_params SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'proc_item_params', r.id, 'cancel', r.company_id, { reason }); return params.get(actor, r.id); }); },
    history(actor, id) { const r = row(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'proc_item_params' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    decide(instance, actor, outcome, comment) {
      const r = db.prepare('SELECT * FROM proc_item_params WHERE id = ?').get(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return; const now = nowIso(); const it = itemOf(r.company_id, r.item_id);
      if (outcome === 'APPROVED') {
        db.prepare("UPDATE proc_item_params SET status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND item_id = ? AND COALESCE(vendor_id, 0) = ? AND status = 'APPROVED' AND effective_from <= ? AND id <> ? AND deleted_at IS NULL").run(actor.user, now, r.company_id, r.item_id, r.vendor_id ?? 0, r.effective_from, r.id);
        db.prepare("UPDATE proc_item_params SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, r.id); audit(actor, 'proc_item_params', r.id, 'approve', r.company_id);
        notify(r.company_id, 'proc.param.approved', [`user:${r.requested_by}`], it?.code ?? String(r.item_id), String(it?.code), `The planning parameters of ${it?.code} (lead time ${r.lead_time_days} days) are in force from ${r.effective_from}; the next MRP run uses them.`, `/proc/item-params?id=${r.id}`, r.id); return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE proc_item_params SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, now, r.id); audit(actor, 'proc_item_params', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
      if (outcome === 'REJECTED') notify(r.company_id, 'proc.param.rejected', [`user:${r.requested_by}`], it?.code ?? String(r.item_id), String(it?.code), `The planning parameters of ${it?.code} were not approved${comment ? `: ${comment}` : ''}.`, `/proc/item-params?id=${r.id}`, r.id);
    },
  };
  return { params, decide: params.decide };
}
