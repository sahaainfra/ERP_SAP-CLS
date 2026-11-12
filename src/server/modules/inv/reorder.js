import QRCode from 'qrcode';
import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { json, nowIso, rid, same } from '../proc/base.js';

// Reorder control, stock ageing and labels (part 16.07): reorder parameters per store and item (changed only through an approved change set), suggestions that lead to a DRAFT material request (never an approved one, BR-01),
// the ageing of stock by receipt date with the non-moving and slow-moving lists and redeployment opportunities, and QR labels for items, bins and batches that the store screens can scan. Quantities are thousandths, money paise.
export const INV_REORDER_DOC = 'INV_REORDER';
export const CHANGE_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', RETURNED: 'Returned for correction', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
export const SUGGESTION_STATUS = { OPEN: 'To decide', CONVERTED: 'Material request made', DISMISSED: 'Dismissed', SUPERSEDED: 'No longer needed' };
/** @type {[string, number, number][]} */
export const BUCKETS = [['0-30', 0, 30], ['31-90', 31, 90], ['91-180', 91, 180], ['181-365', 181, 365], ['>365', 366, Infinity]];
const EDITABLE = ['DRAFT', 'RETURNED']; const IN_TYPES = ['OPENING', 'RECEIPT', 'RETURN', 'TRANSFER_IN', 'ADJUSTMENT'];

for (const [key, def, description, min, max] of [
  ['inv.ageing.slow_days', 90, 'FR-03: stock with no issue or transfer out for this many days is slow-moving.', 1, 3650],
  ['inv.ageing.nonmoving_days', 180, 'FR-03: stock with no issue or transfer out for this many days is non-moving (dead stock).', 1, 3650],
  ['inv.reorder.history_days', 90, 'FR-01: the days of issues the automatic calculation looks back over.', 7, 730],
  ['inv.reorder.safety_days', 7, 'FR-01: the safety days added to the lead time by the automatic calculation.', 0, 365],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType: 'integer', default: def, scopes: ['system', 'company'], description, min, max });

export const suggestionList = defineList({
  code: 'inv.reorder_suggestions', label: 'Reorder suggestions', permission: 'inv.reorder.view', from: 'inv_reorder_suggestions x JOIN inv_stores s ON s.id = x.store_id JOIN mdm_items i ON i.id = x.item_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 's.code', 'i.code', 'i.name'], defaultSort: 'requiredBy',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Suggestion' }, requiredBy: { sql: 'x.required_by', type: 'date', label: 'Needed by' }, store: { sql: 's.code', type: 'text', label: 'Store' }, item: { sql: "i.code || ' ' || i.name", type: 'text', label: 'Item' },
    priority: { sql: 'x.priority', type: 'enum', label: 'Priority', options: [['URGENT', 'Urgent'], ['NORMAL', 'Normal']] }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(SUGGESTION_STATUS) },
  },
});
export const changeList = defineList({
  code: 'inv.reorder_changes', label: 'Reorder parameter changes', permission: 'inv.reorder.view', from: 'inv_reorder_changes x JOIN inv_stores s ON s.id = x.store_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 's.code'], defaultSort: '-date',
  columns: { docNo: { sql: 'x.doc_no', type: 'text', label: 'Change' }, date: { sql: 'x.change_date', type: 'date', label: 'Date' }, store: { sql: 's.code', type: 'text', label: 'Store' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(CHANGE_STATUS) } },
});

const d3 = (n) => (n == null ? null : n / 1000); const t3 = (n) => Math.round(Number(n) * 1000);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10); const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function qrSvg(text) {
  const m = QRCode.create(text, { errorCorrectionLevel: 'M' }).modules; const n = m.size; let d = '';
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) if (m.get(x, y)) d += `M${x + 2} ${y + 2}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 4} ${n + 4}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

export function createReorderService({ db, base, invSvc, mr }) {
  const { may, need, fail, audit, notify, number, param } = base; const stock = invSvc.stock;
  const evt = (type, actor, companyId, entity, entityId, data, projectId) => publishEvent(db, { type, entity, entityId, actorId: actor?.user ?? 'system', companyId, projectId: projectId ?? undefined, data });
  const canValues = (actor, pid) => may(actor, 'inv.stock.values', pid); const mask = (v, actor, pid) => (canValues(actor, pid) ? v : null);
  const taskOf = (actor, instanceId) => workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === instanceId)?.id ?? null;
  const storeOf = (id) => db.prepare('SELECT * FROM inv_stores WHERE id = ?').get(id);
  const itemRow = (companyId, id) => db.prepare('SELECT * FROM mdm_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), companyId);
  const itemLabel = (id) => { const i = db.prepare('SELECT code, name FROM mdm_items WHERE id = ?').get(id); return i ? `${i.code} ${i.name}` : ''; };
  const keeps = (actor, store) => { try { invSvc.storeFor(actor, store.id, 'inv.store.view'); return true; } catch { return false; } };
  /** The stores a person may see under a permission: their own project grants, and for a keeper only the store they keep (unless they see all stores). */
  const stores = (actor, key) => { need(actor, key, 'see this'); return db.prepare("SELECT * FROM inv_stores WHERE company_id = ? AND deleted_at IS NULL AND store_status = 'ACTIVE' ORDER BY code").all(actor.companyId).filter((s) => (!s.org_project_id || may(actor, key, s.org_project_id)) && (keeps(actor, s) || may(actor, 'inv.store.all'))); };
  const storeFor = (actor, id, key) => { const s = storeOf(rid(id)); if (!s || s.company_id !== actor.companyId || s.deleted_at) throw notFound('That store does not exist.'); need(actor, key, 'do this in this store', s.org_project_id); if (!keeps(actor, s) && !may(actor, 'inv.store.all')) throw notFound('That store does not exist.'); return s; };
  const projected = (companyId, storeId, itemId) => stock.freeQty(companyId, storeId, itemId) + (db.prepare('SELECT COALESCE(SUM(qty_in_transit), 0) AS q FROM inv_balances WHERE company_id = ? AND store_id = ? AND item_id = ? AND deleted_at IS NULL').get(companyId, storeId, itemId).q);

  // ---- reorder parameters and their change sets (FR-01, AC-04) -----------------------------------------------------------------------
  const paramView = (actor, p) => ({ id: p.id, storeId: p.store_id, store: storeOf(p.store_id).code, itemId: p.item_id, item: itemLabel(p.item_id), uom: db.prepare('SELECT base_uom FROM mdm_items WHERE id = ?').get(p.item_id).base_uom, minQty: d3(p.min_qty), maxQty: d3(p.max_qty), reorderLevel: d3(p.reorder_level), reorderQty: d3(p.reorder_qty), leadDays: p.lead_days, autoCalc: Boolean(p.auto_calc), effectiveFrom: p.effective_from, onHand: d3(stock.freeQty(p.company_id, p.store_id, p.item_id)), projected: d3(projected(p.company_id, p.store_id, p.item_id)) });
  const params = {
    list(actor, q = {}) {
      const ss = stores(actor, 'inv.reorder.view'); const ids = new Set(ss.map((s) => s.id)); const rows = db.prepare('SELECT * FROM inv_reorder_params WHERE company_id = ? AND deleted_at IS NULL ORDER BY store_id, item_id').all(actor.companyId).filter((p) => ids.has(p.store_id) && (!q.storeId || p.store_id === rid(q.storeId)));
      return rows.map((p) => paramView(actor, p));
    },
    options(actor) { return { stores: stores(actor, 'inv.reorder.view').map((s) => ({ id: s.id, code: s.code, name: s.name, projectId: s.org_project_id })), canEdit: may(actor, 'inv.reorder.edit') }; },
  };
  const checkLines = (actor, store, lines) => {
    const problems = []; const out = []; const seen = new Set();
    if (!lines.length) problems.push({ field: 'lines', message: 'Add at least one item' });
    lines.forEach((l, i) => {
      const at = `lines.${i}`; const it = itemRow(actor.companyId, l.itemId); if (!it || it.item_status !== 'ACTIVE' || !it.stock_tracked) { problems.push({ field: `${at}.itemId`, message: 'Choose an active stock item' }); return; }
      if (seen.has(it.id)) problems.push({ field: `${at}.itemId`, message: 'The same item is already on this change' }); seen.add(it.id);
      const min = t3(l.minQty); const max = t3(l.maxQty); const level = t3(l.reorderLevel); const qty = t3(l.reorderQty);
      if (!(min <= level)) problems.push({ field: `${at}.reorderLevel`, message: 'The reorder level is not below the minimum' }); if (max && !(level <= max)) problems.push({ field: `${at}.maxQty`, message: 'The maximum is not below the reorder level' });
      if (!l.autoCalc && qty <= 0) problems.push({ field: `${at}.reorderQty`, message: 'Give the reorder quantity (or switch on the automatic calculation)' });
      out.push({ itemId: it.id, code: it.code, minQty: min, maxQty: max, reorderLevel: level, reorderQty: qty, leadDays: l.leadDays ?? 0, autoCalc: Boolean(l.autoCalc) });
    });
    fail(problems); return out;
  };
  const crow = (actor, id, key = 'inv.reorder.view') => { const c = db.prepare('SELECT * FROM inv_reorder_changes WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!c) throw notFound('That change does not exist.'); need(actor, key, 'do this', c.org_project_id); if (!keeps(actor, storeOf(c.store_id)) && !may(actor, 'inv.store.all')) throw notFound('That change does not exist.'); return c; };
  const changeView = (actor, c, { detail = false } = {}) => {
    const can = (k) => may(actor, k, c.org_project_id); const own = same(c.requested_by, actor.user);
    const o = { id: c.id, docNo: c.doc_no, date: c.change_date, storeId: c.store_id, store: storeOf(c.store_id).code, effectiveFrom: c.effective_from, reason: c.reason, status: c.status, statusLabel: CHANGE_STATUS[c.status], requestedBy: c.requested_by, approvedBy: c.approved_by, workflowInstanceId: c.workflow_instance_id, rowVersion: c.version, lineCount: json(c.lines_json, []).length, cancelReason: c.cancel_reason,
      can: { edit: can('inv.reorder.edit') && EDITABLE.includes(c.status), submit: can('inv.reorder.submit') && EDITABLE.includes(c.status), withdraw: c.status === 'SUBMITTED' && own, cancel: can('inv.reorder.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(c.status) } };
    if (detail) { o.approve = c.status === 'SUBMITTED' && !own && can('inv.reorder.approve'); if (o.approve && c.workflow_instance_id) o.taskId = taskOf(actor, c.workflow_instance_id); o.lines = json(c.lines_json, []).map((l) => ({ ...l, item: itemLabel(l.itemId), minQty: d3(l.minQty), maxQty: d3(l.maxQty), reorderLevel: d3(l.reorderLevel), reorderQty: d3(l.reorderQty) })); }
    return o;
  };
  const changes = {
    list(actor, query) { const ss = stores(actor, 'inv.reorder.view'); if (!ss.length) return { rows: [], total: 0 }; const ids = ss.map((s) => s.id).join(','); return runList(db, changeList, parseListRequest(changeList, query), { select: 'x.*', scopeSql: `x.company_id = :c AND x.store_id IN (${ids})`, params: { c: actor.companyId }, tieBreaker: 'x.id', map: (c) => changeView(actor, c) }); },
    get: (actor, id) => changeView(actor, crow(actor, id), { detail: true }),
    create(actor, b) {
      const store = storeFor(actor, b.storeId, 'inv.reorder.edit'); const lines = checkLines(actor, store, b.lines); const eff = b.effectiveFrom ?? todayIST(); if (eff < todayIST()) fail([{ field: 'effectiveFrom', message: 'The date is not before today' }]);
      return transaction(db, () => { const no = number(actor.companyId, actor.user, 'INV_REORDER_CHANGE', 'inv_reorder_changes', 'ROC'); const id = Number(db.prepare("INSERT INTO inv_reorder_changes (company_id, doc_no, store_id, org_project_id, change_date, effective_from, lines_json, reason, status, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, 'api')").run(actor.companyId, no, store.id, store.org_project_id ?? null, todayIST(), eff, JSON.stringify(lines), b.reason ?? null, actor.user, actor.user).lastInsertRowid); audit(actor, 'inv_reorder_changes', id, 'create', actor.companyId, { newValues: { docNo: no, lines: lines.length } }); return changes.get(actor, id); });
    },
    update(actor, id, b) {
      const c = crow(actor, id, 'inv.reorder.edit'); if (!EDITABLE.includes(c.status)) throw conflict('Only a draft or a returned change is edited.'); if (b.rowVersion && b.rowVersion !== c.version) throw conflict('Someone changed this; reload it.'); const store = storeOf(c.store_id); const lines = b.lines ? checkLines(actor, store, b.lines) : json(c.lines_json, []);
      db.prepare('UPDATE inv_reorder_changes SET lines_json = ?, reason = ?, effective_from = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(lines), 'reason' in b ? b.reason : c.reason, b.effectiveFrom ?? c.effective_from, actor.user, nowIso(), c.id); audit(actor, 'inv_reorder_changes', c.id, 'update', c.company_id); return changes.get(actor, c.id);
    },
    submit(actor, id) {
      const c = crow(actor, id, 'inv.reorder.submit'); if (!EDITABLE.includes(c.status)) throw unprocessable('Only a draft or a returned change is sent for approval.'); const store = storeOf(c.store_id);
      return transaction(db, () => { const ctx = { projectId: c.org_project_id ?? undefined, lines: json(c.lines_json, []).length };
        if (c.status === 'RETURNED' && c.workflow_instance_id) workflowOf(db).resubmit(actor, c.workflow_instance_id, { comment: 'Corrected', context: ctx }); else { const inst = workflowOf(db).submit(actor, { docType: INV_REORDER_DOC, docId: String(c.id), comment: `${c.doc_no} ${store.code}: ${ctx.lines} item(s)`.slice(0, 300), context: ctx }); db.prepare('UPDATE inv_reorder_changes SET workflow_instance_id = ? WHERE id = ?').run(inst.id, c.id); }
        db.prepare("UPDATE inv_reorder_changes SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), c.id); audit(actor, 'inv_reorder_changes', c.id, 'submit', c.company_id); return changes.get(actor, c.id); });
    },
    withdraw(actor, id, { reason }) { const c = crow(actor, id); if (c.status !== 'SUBMITTED') throw unprocessable('Only a change waiting for approval is withdrawn.'); if (!same(c.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, c.workflow_instance_id, { comment: reason }); return changes.get(actor, c.id); },
    cancel(actor, id, { reason }) { const c = crow(actor, id, 'inv.reorder.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(c.status)) throw unprocessable('Only a change not yet approved is cancelled.'); return transaction(db, () => { if (c.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, c.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE inv_reorder_changes SET status = 'CANCELLED', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), c.id); audit(actor, 'inv_reorder_changes', c.id, 'cancel', c.company_id, { reason }); return changes.get(actor, c.id); }); },
    history(actor, id) { const c = crow(actor, id); return { approvals: c.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(c.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'inv_reorder_changes' AND entity_id = ? ORDER BY id").all(String(c.id)) }; },
    /** The approval makes the live parameters (nothing changes before it, AC-04). */
    decide(instance, actor, outcome, comment) {
      const c = db.prepare('SELECT * FROM inv_reorder_changes WHERE id = ?').get(rid(instance.docId)); if (!c || c.status !== 'SUBMITTED') return; const now = nowIso();
      if (outcome === 'APPROVED') {
        const store = storeOf(c.store_id);
        for (const l of json(c.lines_json, [])) {
          const cur = db.prepare('SELECT id FROM inv_reorder_params WHERE company_id = ? AND store_id = ? AND item_id = ? AND deleted_at IS NULL').get(c.company_id, c.store_id, l.itemId);
          if (cur) { db.prepare('UPDATE inv_reorder_params SET min_qty = ?, max_qty = ?, reorder_level = ?, reorder_qty = ?, lead_days = ?, auto_calc = ?, effective_from = ?, change_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(l.minQty, l.maxQty, l.reorderLevel, l.reorderQty, l.leadDays, l.autoCalc ? 1 : 0, c.effective_from, c.id, actor.user, now, cur.id); audit(actor, 'inv_reorder_params', cur.id, 'update', c.company_id, { newValues: l }); }
          else { const id = Number(db.prepare("INSERT INTO inv_reorder_params (company_id, store_id, item_id, org_project_id, min_qty, max_qty, reorder_level, reorder_qty, lead_days, auto_calc, effective_from, change_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inv_reorder_change', ?)").run(c.company_id, c.store_id, l.itemId, store.org_project_id ?? null, l.minQty, l.maxQty, l.reorderLevel, l.reorderQty, l.leadDays, l.autoCalc ? 1 : 0, c.effective_from, c.id, actor.user, String(c.id)).lastInsertRowid); audit(actor, 'inv_reorder_params', id, 'create', c.company_id, { newValues: l }); }
        }
        db.prepare("UPDATE inv_reorder_changes SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, c.id); audit(actor, 'inv_reorder_changes', c.id, 'approve', c.company_id);
        notify(c.company_id, 'inv.reorder.decided', [`user:${c.requested_by}`], c.doc_no, 'approved', `${c.doc_no} is approved: the reorder parameters of ${store.code} are in force.`, `/inv/reorder-params?id=${c.id}`, c.id, { projectId: c.org_project_id ?? undefined }); return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE inv_reorder_changes SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : c.workflow_instance_id, actor.user, now, c.id); audit(actor, 'inv_reorder_changes', c.id, outcome.toLowerCase(), c.company_id, { reason: comment });
      notify(c.company_id, 'inv.reorder.decided', [`user:${c.requested_by}`], c.doc_no, outcome.toLowerCase(), `${c.doc_no} is ${outcome === 'RETURNED' ? 'returned to you for correction' : outcome === 'REJECTED' ? 'rejected' : 'closed'}${comment ? `: ${comment}` : ''}.`, `/inv/reorder-params?id=${c.id}`, c.id, { projectId: c.org_project_id ?? undefined });
    },
    /** FR-01 automatic calculation: from the issues of the last days, the minimum is the lead time's consumption, the reorder level adds the safety days, the quantity is a month's use. A draft change to approve. */
    recalc(actor, { storeId }) {
      const store = storeFor(actor, storeId, 'inv.reorder.edit'); const days = Number(param(actor.companyId, 'inv.reorder.history_days') ?? 90); const safety = Number(param(actor.companyId, 'inv.reorder.safety_days') ?? 7); const since = addDays(todayIST(), -days); const lines = [];
      for (const p of db.prepare('SELECT * FROM inv_reorder_params WHERE company_id = ? AND store_id = ? AND auto_calc = 1 AND deleted_at IS NULL').all(actor.companyId, store.id)) {
        const used = db.prepare("SELECT COALESCE(SUM(qty_out), 0) AS q FROM inv_stock_ledger WHERE store_id = ? AND item_id = ? AND txn_type = 'ISSUE' AND txn_date >= ? AND reverses_id IS NULL").get(store.id, p.item_id, since).q; const daily = used / days;
        const min = Math.ceil(daily * p.lead_days); const level = Math.ceil(daily * (p.lead_days + safety)); const qty = Math.ceil(daily * 30); const max = level + qty;
        if (min === p.min_qty && level === p.reorder_level && qty === p.reorder_qty && max === p.max_qty) continue;
        lines.push({ itemId: p.item_id, minQty: min / 1000, maxQty: max / 1000, reorderLevel: level / 1000, reorderQty: qty / 1000, leadDays: p.lead_days, autoCalc: true });
      }
      if (!lines.length) throw unprocessable('The issues of the last days give the same figures: nothing to change.'); return changes.create(actor, { storeId: store.id, lines, reason: `Automatic calculation from the issues of the last ${days} days` });
    },
    importRows(actor, { rows }) {
      need(actor, 'inv.reorder.import', 'import reorder parameters'); const problems = []; const by = new Map();
      rows.forEach((x, i) => { const st = db.prepare('SELECT id FROM inv_stores WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, x.storeCode); const it = db.prepare('SELECT id FROM mdm_items WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, x.itemCode); if (!st) problems.push({ field: `rows.${i}.storeCode`, message: 'No such store' }); if (!it) problems.push({ field: `rows.${i}.itemCode`, message: 'No such item' }); if (!st || !it) return; if (!by.has(st.id)) by.set(st.id, []); by.get(st.id).push({ itemId: it.id, minQty: x.minQty, maxQty: x.maxQty, reorderLevel: x.reorderLevel, reorderQty: x.reorderQty, leadDays: x.leadDays ?? 0, autoCalc: Boolean(x.autoCalc) }); });
      fail(problems); return transaction(db, () => ({ created: [...by.entries()].map(([storeId, lines]) => changes.create(actor, { storeId, lines, reason: 'Imported' }).docNo) }));
    },
  };

  // ---- reorder suggestions (FR-02, BR-01) ----------------------------------------------------------------------------------------------
  const sRow = (actor, id, key = 'inv.reorder.view') => { const s = db.prepare('SELECT * FROM inv_reorder_suggestions WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!s) throw notFound('That suggestion does not exist.'); need(actor, key, 'do this', s.org_project_id); if (!keeps(actor, storeOf(s.store_id)) && !may(actor, 'inv.store.all')) throw notFound('That suggestion does not exist.'); return s; };
  const suggestionView = (actor, s) => { const mrRow = s.mr_id ? db.prepare('SELECT id, doc_no, status FROM proc_material_requests WHERE id = ?').get(s.mr_id) : null; return { id: s.id, docNo: s.doc_no, storeId: s.store_id, store: storeOf(s.store_id).code, itemId: s.item_id, item: itemLabel(s.item_id), uom: db.prepare('SELECT base_uom FROM mdm_items WHERE id = ?').get(s.item_id).base_uom, projectedQty: d3(s.projected_qty), reorderLevel: d3(s.reorder_level), minQty: d3(s.min_qty), suggestedQty: d3(s.suggested_qty), requiredBy: s.required_by, priority: s.priority, status: s.status, statusLabel: SUGGESTION_STATUS[s.status], mr: mrRow ? { id: mrRow.id, docNo: mrRow.doc_no, status: mrRow.status } : null, dismissReason: s.dismiss_reason, ageDays: daysBetween(s.created_at.slice(0, 10), todayIST()), can: { convert: s.status === 'OPEN' && may(actor, 'inv.reorder.suggest', s.org_project_id), dismiss: s.status === 'OPEN' && may(actor, 'inv.reorder.suggest', s.org_project_id) } }; };
  const suggestions = {
    list(actor, query) { const ss = stores(actor, 'inv.reorder.view'); if (!ss.length) return []; const ids = ss.map((s) => s.id).join(','); return runList(db, suggestionList, parseListRequest(suggestionList, query), { select: 'x.*', scopeSql: `x.company_id = :c AND x.store_id IN (${ids})`, params: { c: actor.companyId }, tieBreaker: 'x.id', map: (s) => suggestionView(actor, s) }); },
    get: (actor, id) => suggestionView(actor, sRow(actor, id)),
    summary(actor) { const ids = stores(actor, 'inv.reorder.view').map((s) => s.id); const rows = db.prepare("SELECT status, priority FROM inv_reorder_suggestions WHERE company_id = ? AND deleted_at IS NULL").all(actor.companyId).length ? db.prepare("SELECT store_id, status, priority FROM inv_reorder_suggestions WHERE company_id = ? AND deleted_at IS NULL").all(actor.companyId).filter((s) => ids.includes(s.store_id)) : []; return { open: rows.filter((s) => s.status === 'OPEN').length, urgent: rows.filter((s) => s.status === 'OPEN' && s.priority === 'URGENT').length, converted: rows.filter((s) => s.status === 'CONVERTED').length }; },
    /** FR-02: below the reorder level once what is in transit is counted, a suggestion is made (or kept up to date); what is no longer short is closed. Never an approved request. */
    run(actor, { companyId = actor.companyId } = {}) {
      let made = 0; let closed = 0; const today = todayIST();
      return transaction(db, () => {
        for (const p of db.prepare("SELECT p.*, s.store_status, s.org_project_id AS sproject FROM inv_reorder_params p JOIN inv_stores s ON s.id = p.store_id WHERE p.company_id = ? AND p.deleted_at IS NULL AND s.deleted_at IS NULL AND s.store_status = 'ACTIVE' AND p.effective_from <= ?").all(companyId, today)) {
          const proj = projected(companyId, p.store_id, p.item_id); const open = db.prepare("SELECT * FROM inv_reorder_suggestions WHERE store_id = ? AND item_id = ? AND status = 'OPEN' AND deleted_at IS NULL").get(p.store_id, p.item_id);
          const short = p.reorder_level > 0 && proj < p.reorder_level; let qty = p.reorder_qty > 0 ? p.reorder_qty : Math.max(p.max_qty - proj, 0); if (p.max_qty > 0 && p.reorder_qty > 0 && proj + qty > p.max_qty && p.max_qty - proj > 0) qty = Math.max(p.max_qty - proj, p.reorder_qty);
          if (!short || qty <= 0) { if (open) { db.prepare("UPDATE inv_reorder_suggestions SET status = 'SUPERSEDED', decided_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), nowIso(), open.id); closed += 1; } continue; }
          const priority = proj <= p.min_qty ? 'URGENT' : 'NORMAL'; const by = addDays(today, Math.max(p.lead_days, 0));
          if (open) { db.prepare('UPDATE inv_reorder_suggestions SET projected_qty = ?, reorder_level = ?, min_qty = ?, suggested_qty = ?, required_by = ?, priority = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(proj, p.reorder_level, p.min_qty, qty, by, priority, nowIso(), open.id); continue; }
          const no = number(companyId, 'system', 'INV_REORDER_SUGGESTION', 'inv_reorder_suggestions', 'RSG'); const id = Number(db.prepare("INSERT INTO inv_reorder_suggestions (company_id, doc_no, store_id, item_id, org_project_id, param_id, projected_qty, reorder_level, min_qty, suggested_qty, required_by, priority, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', 'inv_reorder_param', ?)").run(companyId, no, p.store_id, p.item_id, p.sproject ?? null, p.id, proj, p.reorder_level, p.min_qty, qty, by, priority, String(p.id)).lastInsertRowid); made += 1;
          evt('inv.reorder.suggested', actor, companyId, 'inv_reorder_suggestions', id, { suggestionId: id, docNo: no, storeId: p.store_id, itemId: p.item_id, projectedQty: proj, reorderLevel: p.reorder_level, suggestedQty: qty, priority }, p.sproject);
          notify(companyId, 'inv.reorder.suggested', ['role:STOREMGR|SK'], no, `${itemLabel(p.item_id)} is below its reorder level`, `${itemLabel(p.item_id)} in ${storeOf(p.store_id).code}: ${d3(proj)} against a reorder level of ${d3(p.reorder_level)}. Order ${d3(qty)}.`, '/inv/reorder-suggestions', `${id}`, { projectId: p.sproject ?? undefined });
        }
        return { made, closed };
      });
    },
    /** The suggestions become DRAFT material requests of the store's project and site (one per store); the person confirms and sends them (BR-01). */
    convert(actor, { ids }) {
      need(actor, 'inv.reorder.suggest', 'turn suggestions into material requests'); const rows = ids.map((i) => sRow(actor, i, 'inv.reorder.suggest')); if (rows.some((s) => s.status !== 'OPEN')) throw unprocessable('Only a suggestion still to decide becomes a request.');
      const byStore = new Map(); for (const s of rows) { if (!byStore.has(s.store_id)) byStore.set(s.store_id, []); byStore.get(s.store_id).push(s); }
      return transaction(db, () => {
        const made = [];
        for (const [storeId, list] of byStore) {
          const st = storeOf(storeId); if (!st.org_project_id || !st.org_site_id) fail([{ field: 'ids', message: `Store ${st.code} has no project and site: a material request needs both.` }]);
          const svc = mr(); if (!svc) throw unprocessable('Material requests are not available.');
          const req = svc.create(actor, { projectId: st.org_project_id, siteId: st.org_site_id, requiredBy: list.map((s) => s.required_by).sort()[0], priority: list.some((s) => s.priority === 'URGENT') ? 'HIGH' : 'NORMAL', purpose: `Reorder suggestion ${list.map((s) => s.doc_no).join(', ')}`.slice(0, 500), lines: list.map((s) => ({ itemId: s.item_id, qty: d3(s.suggested_qty), uom: db.prepare('SELECT base_uom FROM mdm_items WHERE id = ?').get(s.item_id).base_uom })) });
          for (const s of list) { db.prepare("UPDATE inv_reorder_suggestions SET status = 'CONVERTED', mr_id = ?, decided_by = ?, decided_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(req.id, actor.user, nowIso(), actor.user, nowIso(), s.id); audit(actor, 'inv_reorder_suggestions', s.id, 'convert', s.company_id, { newValues: { mrId: req.id } }); }
          made.push({ storeId, mrId: req.id, docNo: req.docNo, status: req.status, suggestions: list.length });
        }
        return { requests: made };
      });
    },
    dismiss(actor, id, { reason }) { const s = sRow(actor, id, 'inv.reorder.suggest'); if (s.status !== 'OPEN') throw unprocessable('Only a suggestion still to decide is dismissed.'); db.prepare("UPDATE inv_reorder_suggestions SET status = 'DISMISSED', dismiss_reason = ?, decided_by = ?, decided_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), actor.user, nowIso(), s.id); audit(actor, 'inv_reorder_suggestions', s.id, 'dismiss', s.company_id, { reason }); return suggestions.get(actor, s.id); },
  };

  // ---- ageing, non-moving and redeployment (FR-03) ---------------------------------------------------------------------------------
  const ageingRows = (companyId, storeList, today) => {
    const slow = Number(param(companyId, 'inv.ageing.slow_days') ?? 90); const dead = Number(param(companyId, 'inv.ageing.nonmoving_days') ?? 180); const rows = [];
    for (const s of storeList) {
      for (const g of db.prepare('SELECT item_id, SUM(qty_on_hand) AS q, SUM(value) AS v, SUM(qty_reserved) AS r FROM inv_balances WHERE company_id = ? AND store_id = ? AND deleted_at IS NULL GROUP BY item_id HAVING SUM(qty_on_hand) > 0').all(companyId, s.id)) {
        let left = g.q; const buckets = BUCKETS.map(() => 0);
        for (const e of db.prepare(`SELECT txn_date, qty_in FROM inv_stock_ledger WHERE store_id = ? AND item_id = ? AND qty_in > 0 AND txn_type IN (${IN_TYPES.map(() => '?').join(',')}) AND deleted_at IS NULL ORDER BY txn_date DESC, id DESC`).all(s.id, g.item_id, ...IN_TYPES)) { if (left <= 0) break; const take = Math.min(left, e.qty_in); const age = daysBetween(e.txn_date, today); buckets[BUCKETS.findIndex(([, lo, hi]) => age >= lo && age <= hi)] += take; left -= take; }
        if (left > 0) buckets[0] += left;
        const out = db.prepare("SELECT MAX(txn_date) AS d FROM inv_stock_ledger WHERE store_id = ? AND item_id = ? AND qty_out > 0 AND txn_type IN ('ISSUE', 'TRANSFER_OUT') AND reverses_id IS NULL AND deleted_at IS NULL").get(s.id, g.item_id).d;
        const first = db.prepare(`SELECT MIN(txn_date) AS d FROM inv_stock_ledger WHERE store_id = ? AND item_id = ? AND qty_in > 0 AND deleted_at IS NULL`).get(s.id, g.item_id).d ?? today; const since = daysBetween(out ?? first, today);
        const cls = since >= dead ? 'NON_MOVING' : since >= slow ? 'SLOW' : 'ACTIVE'; const rate = g.q ? g.v / g.q : 0;
        rows.push({ storeId: s.id, store: s.code, projectId: s.org_project_id, itemId: g.item_id, item: itemLabel(g.item_id), uom: db.prepare('SELECT base_uom FROM mdm_items WHERE id = ?').get(g.item_id).base_uom, qty: g.q, value: g.v, free: g.q - g.r, buckets, bucketValues: buckets.map((b) => Math.round(b * rate)), lastIssue: out, daysSinceMove: since, class: cls });
      }
    }
    return rows;
  };
  const ageing = {
    report(actor, q = {}) {
      const ss = stores(actor, 'inv.ageing.view').filter((s) => !q.storeId || s.id === rid(q.storeId)); const today = todayIST(); let rows = ageingRows(actor.companyId, ss, today); if (q.class) rows = rows.filter((r) => r.class === q.class); if (q.itemId) rows = rows.filter((r) => r.itemId === rid(q.itemId));
      const view = rows.map((r) => ({ storeId: r.storeId, store: r.store, itemId: r.itemId, item: r.item, uom: r.uom, qty: d3(r.qty), value: mask(r.value, actor, r.projectId), buckets: r.buckets.map(d3), bucketValues: r.bucketValues.map((v) => mask(v, actor, r.projectId)), lastIssue: r.lastIssue, daysSinceMove: r.daysSinceMove, class: r.class })).sort((a, b) => b.daysSinceMove - a.daysSinceMove);
      const totals = BUCKETS.map(([label], i) => ({ label, qty: d3(rows.reduce((n, r) => n + r.buckets[i], 0)), value: rows.some((r) => !canValues(actor, r.projectId)) ? null : rows.reduce((n, r) => n + r.bucketValues[i], 0) }));
      return { today, slowDays: Number(param(actor.companyId, 'inv.ageing.slow_days') ?? 90), nonMovingDays: Number(param(actor.companyId, 'inv.ageing.nonmoving_days') ?? 180), rows: view, totals, counts: { nonMoving: view.filter((r) => r.class === 'NON_MOVING').length, slow: view.filter((r) => r.class === 'SLOW').length, active: view.filter((r) => r.class === 'ACTIVE').length } };
    },
    /** FR-03: stock that does not move in one store while another store (often another project) is short of the same item. */
    redeploy(actor) {
      need(actor, 'inv.ageing.view', 'see redeployment opportunities'); const ss = stores(actor, 'inv.ageing.view'); const today = todayIST(); const idle = ageingRows(actor.companyId, ss, today).filter((r) => r.class !== 'ACTIVE' && r.free > 0); const out = [];
      for (const r of idle) {
        for (const p of db.prepare("SELECT p.*, s.code AS scode, s.org_project_id AS sproject FROM inv_reorder_params p JOIN inv_stores s ON s.id = p.store_id WHERE p.company_id = ? AND p.item_id = ? AND p.store_id <> ? AND p.deleted_at IS NULL AND s.deleted_at IS NULL AND s.store_status = 'ACTIVE' AND p.reorder_level > 0").all(actor.companyId, r.itemId, r.storeId)) {
          const proj = projected(actor.companyId, p.store_id, p.item_id); if (proj >= p.reorder_level) continue; const need3 = Math.max(p.reorder_level - proj, p.reorder_qty > 0 ? Math.min(p.reorder_qty, p.max_qty || p.reorder_qty) : 0); const qty = Math.min(r.free, need3); if (qty <= 0) continue;
          out.push({ itemId: r.itemId, item: r.item, uom: r.uom, fromStoreId: r.storeId, fromStore: r.store, fromProjectId: r.projectId, class: r.class, daysSinceMove: r.daysSinceMove, toStoreId: p.store_id, toStore: p.scode, toProjectId: p.sproject, shortBy: d3(p.reorder_level - proj), qty: d3(qty), value: mask(Math.round((r.value / r.qty) * qty), actor, r.projectId), betweenProjects: (r.projectId ?? 0) !== (p.sproject ?? 0) });
        }
      }
      return { rows: out.sort((a, b) => b.daysSinceMove - a.daysSinceMove), total: out.length };
    },
  };

  // ---- labels and scanning (FR-04, FR-05) ---------------------------------------------------------------------------------------------
  const codeOf = { ITEM: (it) => `ERP:I:${it.code}`, BIN: (st, bin) => `ERP:B:${st.code}/${bin.code}`, BATCH: (it, batch) => `ERP:T:${it.code}/${batch}` };
  const labels = {
    targets(actor, q = {}) {
      need(actor, 'inv.label.print', 'print labels'); const like = `%${(q.q ?? '').trim()}%`;
      const items = db.prepare("SELECT id, code, name, base_uom FROM mdm_items WHERE company_id = ? AND deleted_at IS NULL AND item_status = 'ACTIVE' AND stock_tracked = 1 AND (code LIKE ? OR name LIKE ?) ORDER BY code LIMIT 30").all(actor.companyId, like, like);
      const ss = stores(actor, 'inv.label.print'); const bins = q.storeId ? db.prepare('SELECT id, code, zone, rack, shelf FROM inv_bins WHERE store_id = ? AND deleted_at IS NULL ORDER BY code LIMIT 200').all(rid(q.storeId)).filter(() => ss.some((s) => s.id === rid(q.storeId))) : [];
      const batches = q.storeId && ss.some((s) => s.id === rid(q.storeId)) ? db.prepare("SELECT DISTINCT b.item_id AS itemId, b.batch_no AS batchNo, i.code, i.name FROM inv_balances b JOIN mdm_items i ON i.id = b.item_id WHERE b.store_id = ? AND b.batch_no <> '' AND b.deleted_at IS NULL ORDER BY i.code, b.batch_no LIMIT 200").all(rid(q.storeId)) : [];
      return { items, bins, batches, stores: ss.map((s) => ({ id: s.id, code: s.code, name: s.name })) };
    },
    print(actor, b) {
      need(actor, 'inv.label.print', 'print labels'); const store = b.storeId ? storeFor(actor, b.storeId, 'inv.label.print') : null; const problems = []; const made = [];
      b.refs.forEach((r, i) => {
        const at = `refs.${i}`;
        if (b.type === 'ITEM') { const it = itemRow(actor.companyId, r.itemId); if (!it) { problems.push({ field: `${at}.itemId`, message: 'No such item' }); return; } made.push({ type: 'ITEM', refId: it.id, code: codeOf.ITEM(it), title: it.code, lines: [it.name, `Unit: ${it.base_uom}`] }); }
        else if (b.type === 'BIN') { if (!store) { problems.push({ field: 'storeId', message: 'Choose the store of the bins' }); return; } const bin = db.prepare('SELECT * FROM inv_bins WHERE id = ? AND store_id = ? AND deleted_at IS NULL').get(rid(r.binId), store.id); if (!bin) { problems.push({ field: `${at}.binId`, message: 'No such bin in this store' }); return; } made.push({ type: 'BIN', refId: bin.id, code: codeOf.BIN(store, bin), title: `${store.code} / ${bin.code}`, lines: [[bin.zone, bin.rack, bin.shelf].filter(Boolean).join(' · ') || store.name] }); }
        else { const it = itemRow(actor.companyId, r.itemId); if (!it || !store) { problems.push({ field: `${at}.itemId`, message: 'Choose the store and an item of it' }); return; } const has = db.prepare('SELECT 1 FROM inv_balances WHERE store_id = ? AND item_id = ? AND batch_no = ? AND deleted_at IS NULL').get(store.id, it.id, r.batchNo ?? ''); if (!r.batchNo || !has) { problems.push({ field: `${at}.batchNo`, message: 'No such batch in this store' }); return; } made.push({ type: 'BATCH', refId: it.id, code: codeOf.BATCH(it, r.batchNo), title: `${it.code} / ${r.batchNo}`, lines: [it.name, store.code], batchNo: r.batchNo }); }
      });
      fail(problems);
      return transaction(db, () => { const now = nowIso(); for (const m of made) { db.prepare('INSERT INTO inv_labels (company_id, label_type, ref_id, store_id, batch_no, code_value, format, copies, printed_at, printed_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, m.type, m.refId, store?.id ?? null, m.batchNo ?? null, m.code, b.format, b.copies, now, actor.user, actor.user, 'api'); } audit(actor, 'inv_labels', made.length, 'print', actor.companyId, { newValues: { type: b.type, format: b.format, copies: b.copies, labels: made.length } }); return { format: b.format, copies: b.copies, labels: made.map((m) => ({ ...m, svg: qrSvg(m.code) })) }; });
    },
    log(actor) { need(actor, 'inv.label.view', 'see the label log'); return db.prepare('SELECT label_type AS type, code_value AS code, format, copies, printed_at AS printedAt, printed_by AS printedBy FROM inv_labels WHERE company_id = ? ORDER BY id DESC LIMIT 100').all(actor.companyId); },
    /** FR-05: the screens scan a label (or type a code) and learn what it is. */
    resolve(actor, code) {
      if (!/^ERP:A:/.test(String(code ?? '').trim())) need(actor, 'inv.stock.view', 'scan'); const raw = String(code ?? '').trim(); if (!raw) fail([{ field: 'code', message: 'Scan or type a code' }]); const m = /^ERP:([IBTA]):(.+)$/.exec(raw);
      const itemBy = (c) => db.prepare("SELECT id, code, name, base_uom FROM mdm_items WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL AND item_status = 'ACTIVE'").get(actor.companyId, c);
      if (m?.[1] === 'A') { need(actor, 'inv.small_asset.view', 'scan a tool'); const x = db.prepare('SELECT id, tag_code, item_id, asset_state, custodian_name, org_project_id FROM ast_small_assets WHERE company_id = ? AND tag_code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, m[2]); if (!x) throw notFound('No tool has this tag.'); return { type: 'ASSET', assetId: x.id, tag: x.tag_code, code: x.tag_code, item: itemLabel(x.item_id), state: x.asset_state, custodian: x.custodian_name }; }
      if (m?.[1] === 'B') { const [sc, bc] = m[2].split('/'); const s = db.prepare('SELECT * FROM inv_stores WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, sc); const bin = s && db.prepare('SELECT * FROM inv_bins WHERE store_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(s.id, bc); if (!bin) throw notFound('No bin has this code.'); need(actor, 'inv.stock.view', 'scan this store', s.org_project_id); return { type: 'BIN', storeId: s.id, store: s.code, binId: bin.id, bin: bin.code }; }
      if (m?.[1] === 'T') { const [ic, ...rest] = m[2].split('/'); const it = itemBy(ic); if (!it) throw notFound('No item has this code.'); return { type: 'BATCH', itemId: it.id, code: it.code, name: it.name, uom: it.base_uom, batchNo: rest.join('/') }; }
      const it = itemBy(m?.[1] === 'I' ? m[2] : raw); if (!it) throw notFound('No item has this code.'); return { type: 'ITEM', itemId: it.id, code: it.code, name: it.name, uom: it.base_uom };
    },
  };
  return { params, changes, suggestions, ageing, labels, mrOf: mr };
}
