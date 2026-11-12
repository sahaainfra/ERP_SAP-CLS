import { publishEvent } from '../../platform/events/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { json, nowIso, rid, same } from '../proc/base.js';
import { STORE_TYPES, TXN_TYPES, createStockEngine } from './stock.js';

// Stores, bins, balances, the item card, valuation, reservations, adjustments and the dashboard of the stock module (part 16.01). Posting goes through the stock engine; this layer checks who may do it, in which store, and what the person may see.
export const INV_STORE_DOC = 'INV_STORE'; export const INV_CHG_DOC = 'INV_STORE_CHG'; export const INV_ADJ_DOC = 'INV_ADJ';
export const STORE_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', RETURNED: 'Returned for correction', ACTIVE: 'Active', REJECTED: 'Rejected', CANCELLED: 'Cancelled', INACTIVE: 'Inactive' };
export const ADJ_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', RETURNED: 'Returned for correction', APPROVED: 'Approved and posted', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
export const ADJ_TYPES = { QUANTITY: 'Quantity (gain or loss)', REVALUATION: 'Revaluation (rate correction)' };
const EDITABLE = ['DRAFT', 'RETURNED']; const SENSITIVE = ['storeType', 'valuationMethod', 'allowNegative', 'projectId', 'siteId'];
/** @type {[string, number, number][]} */
const AGE_BUCKETS = [['0-30', 0, 30], ['31-90', 31, 90], ['91-180', 91, 180], ['181+', 181, Infinity]];
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export const storeList = defineList({
  code: 'inv.stores', label: 'Stores', permission: 'inv.store.view', from: 'inv_stores s LEFT JOIN org_projects p ON p.id = s.org_project_id LEFT JOIN org_sites t ON t.id = s.org_site_id', where: 's.deleted_at IS NULL', searchable: ['s.code', 's.name', 'p.code', 't.name'], defaultSort: 'code',
  columns: {
    code: { sql: 's.code', type: 'text', label: 'Code' }, name: { sql: 's.name', type: 'text', label: 'Name' }, type: { sql: 's.store_type', type: 'enum', label: 'Type', options: Object.entries(STORE_TYPES) }, project: { sql: "COALESCE(p.code, '')", type: 'text', label: 'Project' }, site: { sql: "COALESCE(t.name, '')", type: 'text', label: 'Site' },
    valuation: { sql: 's.valuation_method', type: 'enum', label: 'Valuation', options: [['WAVG', 'Weighted average'], ['FIFO', 'FIFO']] }, status: { sql: 's.store_status', type: 'enum', label: 'Status', options: Object.entries(STORE_STATUS) },
  },
});
export const balanceList = defineList({
  code: 'inv.balances', label: 'Stock balances', permission: 'inv.stock.view', from: 'inv_balances x JOIN inv_stores s ON s.id = x.store_id JOIN inv_bins b ON b.id = x.bin_id JOIN mdm_items i ON i.id = x.item_id LEFT JOIN org_projects p ON p.id = x.project_id', where: 'x.deleted_at IS NULL AND (x.qty_on_hand <> 0 OR x.qty_reserved <> 0 OR x.qty_inspection <> 0 OR x.qty_in_transit <> 0)', searchable: ['i.code', 'i.name', 's.code', 's.name', 'b.code', 'x.batch_no'], defaultSort: 'item',
  columns: {
    item: { sql: 'i.name', type: 'text', label: 'Item' }, itemCode: { sql: 'i.code', type: 'text', label: 'Code' }, store: { sql: 's.code', type: 'text', label: 'Store' }, bin: { sql: 'b.code', type: 'text', label: 'Bin' }, batch: { sql: 'x.batch_no', type: 'text', label: 'Batch' }, project: { sql: "COALESCE(p.code, 'POOL')", type: 'text', label: 'Owner' },
    onHand: { sql: 'x.qty_on_hand', type: 'number', label: 'On hand' }, reserved: { sql: 'x.qty_reserved', type: 'number', label: 'Reserved' }, inspection: { sql: 'x.qty_inspection', type: 'number', label: 'Under inspection' }, inTransit: { sql: 'x.qty_in_transit', type: 'number', label: 'In transit' },
  },
});
export const adjList = defineList({
  code: 'inv.adjustments', label: 'Stock adjustments', permission: 'inv.adjustment.view', from: 'inv_adjustments x JOIN inv_stores s ON s.id = x.store_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 's.code', 's.name'], defaultSort: '-date',
  columns: { docNo: { sql: 'x.doc_no', type: 'text', label: 'Adjustment' }, store: { sql: 's.code', type: 'text', label: 'Store' }, date: { sql: 'x.doc_date', type: 'date', label: 'Date' }, type: { sql: 'x.adj_type', type: 'enum', label: 'Type', options: Object.entries(ADJ_TYPES) }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(ADJ_STATUS) } },
});

export function createInvService({ db, base }) {
  const { authz, may, need, fail, audit, notify, number } = base; const stock = createStockEngine({ db, base });
  const allStores = (actor) => may(actor, 'inv.store.all'); const canValues = (actor) => may(actor, 'inv.stock.values');
  const isKeeper = (store, actor) => json(store.keeper_ids_json, []).some((k) => same(k, actor.user));
  const evt = (type, actor, companyId, entity, entityId, data, projectId) => publishEvent(db, { type, entity, entityId, actorId: actor?.user ?? 'system', companyId, projectId: projectId ?? undefined, data });
  /** The stores a person may read: inside the data scope of the key, and for a storekeeper only the stores they keep. */
  function storeScope(actor, key, alias = 's') {
    need(actor, key, 'see stores'); const f = authz.scopeFilter(actor, key, { project: `${alias}.org_project_id` }); const keeper = allStores(actor) ? '' : ` AND EXISTS (SELECT 1 FROM json_each(${alias}.keeper_ids_json) WHERE lower(value) = lower(:u))`;
    return { sql: `${alias}.company_id = :c AND ${f.sql}${keeper}`, params: { c: actor.companyId, ...(allStores(actor) ? {} : { u: actor.user }), ...(f.params ?? {}) }, unrestricted: Boolean(f.unrestricted) && allStores(actor) };
  }
  /** A store the person may use for the action named by `key`. */
  function storeFor(actor, id, key = 'inv.store.view', { keeperOnly = false } = {}) {
    const s = db.prepare('SELECT * FROM inv_stores WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!s || !may(actor, 'inv.store.view', s.org_project_id)) throw notFound('That store does not exist.'); if (!allStores(actor) && !isKeeper(s, actor)) throw notFound('That store does not exist.');
    if (key !== 'inv.store.view') need(actor, key, 'do that in this store', s.org_project_id); void keeperOnly; return s;
  }
  const pname = (id) => (id ? (db.prepare('SELECT code FROM org_projects WHERE id = ?').get(id)?.code ?? '') : 'POOL');
  const mask = (v, actor) => (canValues(actor) ? v : null);

  // ---- stores and bins (FR-01, FR-02) -----------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const binView = (b) => ({ id: b.id, code: b.code, zone: b.zone, rack: b.rack, shelf: b.shelf, capacity: b.capacity == null ? null : b.capacity / 1000, isDefault: Boolean(b.is_default) });
  const storeView = (actor, s, { detail = false } = {}) => {
    const can = (k) => may(actor, k, s.org_project_id); const own = same(s.requested_by, actor.user);
    const o = { id: s.id, code: s.code, name: s.name, type: s.store_type, typeLabel: STORE_TYPES[s.store_type], projectId: s.org_project_id, project: pname(s.org_project_id), siteId: s.org_site_id, site: s.org_site_id ? db.prepare('SELECT name FROM org_sites WHERE id = ?').get(s.org_site_id)?.name : null, address: s.address, keepers: json(s.keeper_ids_json, []), valuation: s.valuation_method, allowNegative: Boolean(s.allow_negative),
      status: s.store_status, statusLabel: STORE_STATUS[s.store_status], requestedBy: s.requested_by, approvedBy: s.approved_by, workflowInstanceId: s.workflow_instance_id, cancelReason: s.cancel_reason, rowVersion: s.version,
      can: { edit: can('inv.store.edit') && ['DRAFT', 'RETURNED', 'ACTIVE'].includes(s.store_status), submit: can('inv.store.create') && EDITABLE.includes(s.store_status), withdraw: s.store_status === 'SUBMITTED' && own, approve: can('inv.store.approve') && s.store_status === 'SUBMITTED' && !own, cancel: can('inv.store.edit') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(s.store_status),
        change: can('inv.store.edit') && s.store_status === 'ACTIVE', deactivate: can('inv.store.edit') && s.store_status === 'ACTIVE', reactivate: can('inv.store.edit') && s.store_status === 'INACTIVE', bins: can('inv.bin.manage') && ['DRAFT', 'RETURNED', 'ACTIVE'].includes(s.store_status) } };
    if (detail) {
      o.bins = db.prepare('SELECT * FROM inv_bins WHERE store_id = ? AND deleted_at IS NULL ORDER BY is_default DESC, code').all(s.id).map(binView);
      o.changes = db.prepare('SELECT * FROM inv_store_changes WHERE store_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 10').all(s.id).map((c) => ({ id: c.id, docNo: c.doc_no, changes: json(c.changes_json, {}), reason: c.reason, status: c.status, requestedBy: c.requested_by }));
      o.stockLines = db.prepare('SELECT COUNT(*) AS n FROM inv_balances WHERE store_id = ? AND qty_on_hand <> 0').get(s.id).n;
      if (o.can.approve && s.workflow_instance_id) o.taskId = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === s.workflow_instance_id)?.id ?? null;
    }
    return o;
  };
  const checkStoreInput = (companyId, b) => {
    const problems = []; if (b.projectId && !db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.projectId, companyId)) problems.push({ field: 'projectId', message: 'Not a project of this company' });
    if (b.siteId && !db.prepare('SELECT 1 FROM org_sites WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.siteId, companyId)) problems.push({ field: 'siteId', message: 'Not a site of this company' });
    if (b.siteId && b.projectId && !db.prepare('SELECT 1 FROM org_sites WHERE id = ? AND org_project_id = ?').get(b.siteId, b.projectId)) problems.push({ field: 'siteId', message: 'The site belongs to another project' });
    if (b.type === 'SITE_STORE' && !(b.siteId || b.projectId)) problems.push({ field: 'projectId', message: 'A site store belongs to a project and a site' });
    for (const [i, k] of (b.keepers ?? []).entries()) if (!db.prepare('SELECT 1 FROM iam_users WHERE company_id = ? AND lower(username) = lower(?)').get(companyId, k)) problems.push({ field: `keepers.${i}`, message: `${k} is not a user` }); fail(problems);
  };
  const stores = {
    list(actor, query) { const sc = storeScope(actor, 'inv.store.view'); return runList(db, storeList, parseListRequest(storeList, query), { select: 's.*', scopeSql: sc.sql, params: sc.params, tieBreaker: 's.id', map: (s) => ({ id: s.id, code: s.code, name: s.name, type: s.store_type, typeLabel: STORE_TYPES[s.store_type], project: pname(s.org_project_id), site: s.org_site_id ? (db.prepare('SELECT name FROM org_sites WHERE id = ?').get(s.org_site_id)?.name ?? '') : '', valuation: s.valuation_method, status: s.store_status, statusLabel: STORE_STATUS[s.store_status] }) }); },
    exportSource(actor, req) { need(actor, 'inv.store.export', 'export stores'); return stores.list(actor, { ...req, page: 1, pageSize: 100 }); },
    options(actor) { need(actor, 'inv.store.view', 'see stores'); return { projects: db.prepare("SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code").all(actor.companyId).filter((p) => may(actor, 'inv.store.view', p.id)), sites: db.prepare('SELECT id, org_project_id AS projectId, code, name FROM org_sites WHERE company_id = ? AND deleted_at IS NULL ORDER BY code').all(actor.companyId), types: STORE_TYPES }; },
    get: (actor, id) => storeView(actor, storeFor(actor, id), { detail: true }),
    create(actor, b) {
      if (!may(actor, 'inv.store.create', b.projectId ?? null)) throw forbidden('You may not make a store (permission inv.store.create).'); checkStoreInput(actor.companyId, b);
      if (db.prepare('SELECT 1 FROM inv_stores WHERE company_id = ? AND code = ? COLLATE NOCASE').get(actor.companyId, b.code)) throw conflict(`A store with the code ${b.code} exists already.`);
      return stock.transaction(() => { const id = Number(db.prepare("INSERT INTO inv_stores (company_id, code, name, store_type, org_project_id, org_site_id, address, keeper_ids_json, valuation_method, allow_negative, store_status, requested_by, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, 'api')").run(actor.companyId, b.code.toUpperCase(), b.name, b.type, b.projectId ?? null, b.siteId ?? null, b.address ?? null, JSON.stringify(b.keepers ?? []), b.valuation ?? 'WAVG', b.allowNegative ? 1 : 0, actor.user, b.projectId ?? null, b.siteId ?? null, actor.user).lastInsertRowid);
        stock.defaultBin(db.prepare('SELECT * FROM inv_stores WHERE id = ?').get(id)); audit(actor, 'inv_stores', id, 'create', actor.companyId, { newValues: { code: b.code, type: b.type } }); return stores.get(actor, id); });
    },
    /** Name, address and keepers change directly (audited); the type, valuation, negative stock, project and site change only by an approved change request. */
    update(actor, id, b) {
      const s = storeFor(actor, id, 'inv.store.edit'); if (b.rowVersion && b.rowVersion !== s.version) throw conflict('Someone changed this store; reload it.');
      const touched = SENSITIVE.filter((k) => k in b && JSON.stringify(b[k]) !== JSON.stringify({ storeType: s.store_type, valuationMethod: s.valuation_method, allowNegative: Boolean(s.allow_negative), projectId: s.org_project_id, siteId: s.org_site_id }[k]));
      if (touched.length && s.store_status !== 'DRAFT' && s.store_status !== 'RETURNED') throw unprocessable(`${touched.join(', ')} change only by a change request that is approved.`);
      checkStoreInput(s.company_id, { type: b.type ?? s.store_type, projectId: 'projectId' in b ? b.projectId : s.org_project_id, siteId: 'siteId' in b ? b.siteId : s.org_site_id, keepers: b.keepers });
      db.prepare('UPDATE inv_stores SET name = ?, address = ?, keeper_ids_json = ?, store_type = ?, valuation_method = ?, allow_negative = ?, org_project_id = ?, org_site_id = ?, project_id = ?, site_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.name ?? s.name, 'address' in b ? b.address : s.address, b.keepers ? JSON.stringify(b.keepers) : s.keeper_ids_json, b.type ?? s.store_type, b.valuation ?? s.valuation_method, 'allowNegative' in b ? (b.allowNegative ? 1 : 0) : s.allow_negative, 'projectId' in b ? b.projectId : s.org_project_id, 'siteId' in b ? b.siteId : s.org_site_id, 'projectId' in b ? b.projectId : s.org_project_id, 'siteId' in b ? b.siteId : s.org_site_id, actor.user, nowIso(), s.id);
      audit(actor, 'inv_stores', s.id, 'update', s.company_id, { oldValues: { name: s.name, keepers: json(s.keeper_ids_json, []) }, newValues: { name: b.name, keepers: b.keepers } }); return stores.get(actor, s.id);
    },
    /** A change to the sensitive settings of a live store: a request that goes to the store manager and the accounts manager. */
    requestChange(actor, id, b) {
      const s = storeFor(actor, id, 'inv.store.edit'); if (s.store_status !== 'ACTIVE') throw unprocessable('Change requests are for an active store; edit a draft directly.'); const changes = {};
      for (const k of SENSITIVE) if (k in b) changes[k] = b[k];
      if (!Object.keys(changes).length) fail([{ field: 'valuationMethod', message: 'Name the setting to change' }]); checkStoreInput(s.company_id, { type: changes.storeType ?? s.store_type, projectId: 'projectId' in changes ? changes.projectId : s.org_project_id, siteId: 'siteId' in changes ? changes.siteId : s.org_site_id });
      if (changes.valuationMethod && changes.valuationMethod !== s.valuation_method && db.prepare('SELECT 1 FROM inv_balances WHERE store_id = ? AND qty_on_hand <> 0').get(s.id)) throw unprocessable('The valuation method cannot change while the store holds stock.');
      if (db.prepare("SELECT 1 FROM inv_store_changes WHERE store_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(s.id)) throw conflict('A change request of this store is open already.');
      return stock.transaction(() => { const no = number(s.company_id, actor.user, 'INV_STORE_CHG', 'inv_store_changes', 'SCR'); const cid = Number(db.prepare("INSERT INTO inv_store_changes (company_id, doc_no, store_id, changes_json, reason, status, requested_by, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 'inv_store', ?)").run(s.company_id, no, s.id, JSON.stringify(changes), b.reason, actor.user, s.org_project_id, actor.user, String(s.id)).lastInsertRowid);
        const inst = workflowOf(db).submit(actor, { docType: INV_CHG_DOC, docId: String(cid), comment: `${no}: ${s.code} ${Object.keys(changes).join(', ')}`.slice(0, 300), context: { projectId: s.org_project_id ?? undefined } }); db.prepare("UPDATE inv_store_changes SET workflow_instance_id = ?, status = 'SUBMITTED' WHERE id = ?").run(inst.id, cid);
        audit(actor, 'inv_store_changes', cid, 'submit', s.company_id, { newValues: changes, reason: b.reason }); return stores.get(actor, s.id); });
    },
    submit(actor, id) {
      const s = storeFor(actor, id, 'inv.store.create'); if (!EDITABLE.includes(s.store_status)) throw unprocessable('Only a draft or a returned store is sent for approval.');
      return stock.transaction(() => { const ctx = { projectId: s.org_project_id ?? undefined }; if (s.store_status === 'RETURNED' && s.workflow_instance_id) workflowOf(db).resubmit(actor, s.workflow_instance_id, { comment: 'Corrected', context: ctx }); else { const inst = workflowOf(db).submit(actor, { docType: INV_STORE_DOC, docId: String(s.id), comment: `${s.code} ${s.name}`.slice(0, 300), context: ctx }); db.prepare('UPDATE inv_stores SET workflow_instance_id = ? WHERE id = ?').run(inst.id, s.id); }
        db.prepare("UPDATE inv_stores SET store_status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), s.id); audit(actor, 'inv_stores', s.id, 'submit', s.company_id); return stores.get(actor, s.id); });
    },
    withdraw(actor, id, { reason }) { const s = storeFor(actor, id); if (s.store_status !== 'SUBMITTED') throw unprocessable('Only a store waiting for approval is withdrawn.'); if (!same(s.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, s.workflow_instance_id, { comment: reason }); return stores.get(actor, s.id); },
    cancel(actor, id, { reason }) { const s = storeFor(actor, id, 'inv.store.edit'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(s.store_status)) throw unprocessable('Only a store not yet approved is cancelled.'); return stock.transaction(() => { if (s.store_status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, s.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE inv_stores SET store_status = 'CANCELLED', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), s.id); audit(actor, 'inv_stores', s.id, 'cancel', s.company_id, { reason }); return stores.get(actor, s.id); }); },
    deactivate(actor, id, { reason }) {
      const s = storeFor(actor, id, 'inv.store.edit'); if (s.store_status !== 'ACTIVE') throw unprocessable('Only an active store is closed.'); if (db.prepare('SELECT 1 FROM inv_balances WHERE store_id = ? AND (qty_on_hand <> 0 OR qty_reserved <> 0 OR qty_inspection <> 0)').get(s.id)) throw unprocessable('The store still holds stock: issue or transfer it first.');
      db.prepare("UPDATE inv_stores SET store_status = 'INACTIVE', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), s.id); audit(actor, 'inv_stores', s.id, 'deactivate', s.company_id, { reason }); return stores.get(actor, s.id);
    },
    reactivate(actor, id, { reason }) { const s = storeFor(actor, id, 'inv.store.edit'); if (s.store_status !== 'INACTIVE') throw unprocessable('Only a closed store is opened again.'); db.prepare("UPDATE inv_stores SET store_status = 'ACTIVE', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), s.id); audit(actor, 'inv_stores', s.id, 'reactivate', s.company_id, { reason }); return stores.get(actor, s.id); },
    history(actor, id) { const s = storeFor(actor, id); return { approvals: s.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(s.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity IN ('inv_stores', 'inv_store_changes') AND (entity_id = ? OR entity_id IN (SELECT CAST(id AS TEXT) FROM inv_store_changes WHERE store_id = ?)) ORDER BY id").all(String(s.id), s.id) }; },
    decide(instance, actor, outcome, comment) {
      const s = db.prepare('SELECT * FROM inv_stores WHERE id = ?').get(rid(instance.docId)); if (!s || s.store_status !== 'SUBMITTED') return; const now = nowIso();
      if (outcome === 'APPROVED') { db.prepare("UPDATE inv_stores SET store_status = 'ACTIVE', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, s.id); stock.defaultBin(s); audit(actor, 'inv_stores', s.id, 'approve', s.company_id); evt('inv.store.activated', actor, s.company_id, 'inv_store', s.id, { storeId: s.id, code: s.code, type: s.store_type, projectId: s.org_project_id, siteId: s.org_site_id }, s.org_project_id);
        notify(s.company_id, 'inv.store.decided', [`user:${s.requested_by}`, ...json(s.keeper_ids_json, []).map((k) => `user:${k}`)], s.code, 'approved', `The store ${s.code} ${s.name} is active: stock can be received.`, `/inv/stores?id=${s.id}`, s.id, { projectId: s.org_project_id ?? undefined }); return; }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED'; db.prepare('UPDATE inv_stores SET store_status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : s.workflow_instance_id, actor.user, now, s.id); audit(actor, 'inv_stores', s.id, outcome.toLowerCase(), s.company_id, { reason: comment });
    },
    changeDecide(instance, actor, outcome, comment) {
      const c = db.prepare('SELECT * FROM inv_store_changes WHERE id = ?').get(rid(instance.docId)); if (!c || c.status !== 'SUBMITTED') return; const s = db.prepare('SELECT * FROM inv_stores WHERE id = ?').get(c.store_id); const now = nowIso();
      if (outcome === 'APPROVED') { const ch = json(c.changes_json, {}); db.prepare('UPDATE inv_stores SET store_type = ?, valuation_method = ?, allow_negative = ?, org_project_id = ?, org_site_id = ?, project_id = ?, site_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(ch.storeType ?? s.store_type, ch.valuationMethod ?? s.valuation_method, 'allowNegative' in ch ? (ch.allowNegative ? 1 : 0) : s.allow_negative, 'projectId' in ch ? ch.projectId : s.org_project_id, 'siteId' in ch ? ch.siteId : s.org_site_id, 'projectId' in ch ? ch.projectId : s.org_project_id, 'siteId' in ch ? ch.siteId : s.org_site_id, actor.user, now, s.id);
        db.prepare("UPDATE inv_store_changes SET status = 'APPROVED', approved_by = ?, approved_at = ? WHERE id = ?").run(actor.user, now, c.id); audit(actor, 'inv_stores', s.id, 'change', s.company_id, { oldValues: { type: s.store_type, valuation: s.valuation_method, allowNegative: Boolean(s.allow_negative), project: s.org_project_id }, newValues: ch, reason: c.reason }); return; }
      const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : 'CANCELLED'; db.prepare('UPDATE inv_store_changes SET status = ? WHERE id = ?').run(to, c.id); audit(actor, 'inv_store_changes', c.id, outcome.toLowerCase(), s.company_id, { reason: comment });
    },
  };
  const bins = {
    add(actor, storeId, b) {
      const s = storeFor(actor, storeId, 'inv.bin.manage'); if (db.prepare('SELECT 1 FROM inv_bins WHERE store_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(s.id, b.code)) throw conflict(`A bin ${b.code} exists in this store.`);
      const id = Number(db.prepare('INSERT INTO inv_bins (company_id, store_id, code, zone, rack, shelf, capacity, is_default, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)').run(s.company_id, s.id, b.code.toUpperCase(), b.zone ?? null, b.rack ?? null, b.shelf ?? null, b.capacity == null ? null : Math.round(b.capacity * 1000), s.org_project_id ?? null, s.org_site_id ?? null, actor.user, 'api').lastInsertRowid);
      if (b.isDefault) { db.prepare('UPDATE inv_bins SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE store_id = ?').run(id, s.id); } audit(actor, 'inv_bins', id, 'create', s.company_id, { newValues: { store: s.code, code: b.code } }); return stores.get(actor, s.id);
    },
    update(actor, binId, b) {
      const bin = db.prepare('SELECT * FROM inv_bins WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(binId), actor.companyId); if (!bin) throw notFound('That bin does not exist.'); const s = storeFor(actor, bin.store_id, 'inv.bin.manage');
      db.prepare('UPDATE inv_bins SET zone = ?, rack = ?, shelf = ?, capacity = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run('zone' in b ? b.zone : bin.zone, 'rack' in b ? b.rack : bin.rack, 'shelf' in b ? b.shelf : bin.shelf, 'capacity' in b ? (b.capacity == null ? null : Math.round(b.capacity * 1000)) : bin.capacity, actor.user, nowIso(), bin.id);
      if (b.isDefault) db.prepare('UPDATE inv_bins SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE store_id = ?').run(bin.id, s.id); audit(actor, 'inv_bins', bin.id, 'update', s.company_id); return stores.get(actor, s.id);
    },
    remove(actor, binId) {
      const bin = db.prepare('SELECT * FROM inv_bins WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(binId), actor.companyId); if (!bin) throw notFound('That bin does not exist.'); const s = storeFor(actor, bin.store_id, 'inv.bin.manage');
      if (bin.is_default) throw unprocessable('The default bin cannot be removed: make another bin the default first.'); if (db.prepare('SELECT 1 FROM inv_stock_ledger WHERE bin_id = ? LIMIT 1').get(bin.id)) throw unprocessable('Stock has moved through this bin: it stays on record.');
      db.prepare('UPDATE inv_bins SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, bin.id); audit(actor, 'inv_bins', bin.id, 'delete', s.company_id); return stores.get(actor, s.id);
    },
  };

  // ---- balances, the item card, valuation (FR-03, FR-04, FR-05) -----------------------------------------------------------------------------------------------------------------------------------
  const balanceMap = (actor) => (x) => ({ id: x.id, itemId: x.item_id, item: db.prepare('SELECT code, name, base_uom FROM mdm_items WHERE id = ?').get(x.item_id), storeId: x.store_id, store: db.prepare('SELECT code, name FROM inv_stores WHERE id = ?').get(x.store_id), bin: db.prepare('SELECT code FROM inv_bins WHERE id = ?').get(x.bin_id)?.code, batch: x.batch_no, serial: x.serial_no, owner: pname(x.project_id), onHand: x.qty_on_hand / 1000, reserved: x.qty_reserved / 1000, inspection: x.qty_inspection / 1000, inTransit: x.qty_in_transit / 1000, available: (x.qty_on_hand - x.qty_reserved - x.qty_inspection) / 1000, avgRate: mask(x.avg_rate, actor), value: mask(x.value, actor), lastReceiptOn: x.last_receipt_on });
  const balances = {
    list(actor, query) {
      const sc = storeScope(actor, 'inv.stock.view');
      const rows = runList(db, balanceList, parseListRequest(balanceList, query), { select: 'x.*', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (x) => { const m = balanceMap(actor)(x); return { id: x.id, itemCode: m.item.code, item: m.item.name, uom: m.item.base_uom, store: m.store.code, bin: m.bin, batch: m.batch, project: m.owner, onHand: m.onHand, reserved: m.reserved, inspection: m.inspection, inTransit: m.inTransit, available: m.available, avgRate: m.avgRate, value: m.value }; } });
      return rows;
    },
    exportSource(actor, req) { need(actor, 'inv.stock.export', 'export stock balances'); return balances.list(actor, { ...req, page: 1, pageSize: 100 }); },
    /** Stock free to use for the items in the stores a person may see, for requisitions and planning. */
    availability(actor, itemIds) { const sc = storeScope(actor, 'inv.stock.view'); return itemIds.map((itemId) => ({ itemId, stores: db.prepare(`SELECT s.id AS storeId, s.code, s.name, COALESCE(SUM(x.qty_on_hand - x.qty_reserved - x.qty_inspection), 0) AS free, COALESCE(SUM(x.qty_on_hand), 0) AS onHand FROM inv_stores s JOIN inv_balances x ON x.store_id = s.id AND x.item_id = :i WHERE ${sc.sql} GROUP BY s.id HAVING onHand <> 0`).all({ ...sc.params, i: itemId }).map((r) => ({ storeId: r.storeId, code: r.code, name: r.name, free: r.free / 1000, onHand: r.onHand / 1000 })) })); },
  };
  /** FR-03: the item card: entries in order with the running balance, and the balance before the first of them. */
  function itemCard(actor, q) {
    const sc = storeScope(actor, 'inv.stock.view'); const item = stock.itemOf(actor.companyId, q.itemId); if (!item) throw notFound('That item does not exist.'); const from = q.from ?? '0000-00-00'; const to = q.to ?? todayIST(); const P = { ...sc.params, i: item.id, from, to }; const storeSql = q.storeId ? ' AND l.store_id = :st' : ''; if (q.storeId) P.st = rid(q.storeId);
    const rows = db.prepare(`SELECT l.* FROM inv_stock_ledger l JOIN inv_stores s ON s.id = l.store_id WHERE ${sc.sql} AND l.item_id = :i AND l.txn_date BETWEEN :from AND :to${storeSql} ORDER BY l.id LIMIT 1000`).all(P);
    const { to: _to, ...P2 } = P; void _to; const opening = q.storeId && q.from ? db.prepare(`SELECT balance_qty, balance_value FROM inv_stock_ledger l JOIN inv_stores s ON s.id = l.store_id WHERE ${sc.sql} AND l.item_id = :i AND l.txn_date < :from${storeSql} ORDER BY l.id DESC LIMIT 1`).get(P2) : null; const v = canValues(actor);
    const store = (id) => db.prepare('SELECT code FROM inv_stores WHERE id = ?').get(id)?.code;
    return { item: { id: item.id, code: item.code, name: item.name, uom: item.base_uom }, storeId: q.storeId ?? null, from: q.from ?? null, to, opening: { qty: (opening?.balance_qty ?? 0) / 1000, value: v ? (opening?.balance_value ?? 0) : null },
      rows: rows.map((l) => ({ id: l.id, docNo: l.doc_no, date: l.txn_date, store: store(l.store_id), bin: db.prepare('SELECT code FROM inv_bins WHERE id = ?').get(l.bin_id)?.code, batch: l.batch_no, serial: l.serial_no, type: l.txn_type, typeLabel: TXN_TYPES[l.txn_type], qtyIn: l.qty_in / 1000, qtyOut: l.qty_out / 1000, rate: v ? l.rate : null, value: v ? l.value : null, balanceQty: l.balance_qty / 1000, balanceValue: v ? l.balance_value : null, owner: pname(l.project_id), sourceType: l.source_type, sourceId: l.source_id, reason: l.reason, reversesId: l.reverses_id, reversed: Boolean(db.prepare('SELECT 1 FROM inv_stock_ledger WHERE reverses_id = ?').get(l.id)), postedBy: l.posted_by })),
      totals: { qtyIn: rows.reduce((n, l) => n + l.qty_in, 0) / 1000, qtyOut: rows.reduce((n, l) => n + l.qty_out, 0) / 1000 }, truncated: rows.length === 1000, canReverse: may(actor, 'inv.stock.reverse') };
  }
  /** FR-05: stock value by store, project (owner) or item category. */
  function valuation(actor, q) {
    need(actor, 'inv.stock.values', 'see stock values'); const sc = storeScope(actor, 'inv.stock.values'); const P = { ...sc.params }; let extra = '';
    if (q.storeId) { extra += ' AND x.store_id = :st'; P.st = rid(q.storeId); } if (q.projectId) { extra += ' AND x.project_id = :pj'; P.pj = rid(q.projectId); } if (q.categoryId) { extra += ' AND i.category_id = :cat'; P.cat = rid(q.categoryId); }
    const from = `inv_balances x JOIN inv_stores s ON s.id = x.store_id JOIN mdm_items i ON i.id = x.item_id`; const groupBy = q.groupBy ?? 'store';
    const sql = groupBy === 'project' ? `SELECT COALESCE(x.project_id, 0) AS k, COALESCE((SELECT code FROM org_projects WHERE id = x.project_id), 'Common pool') AS label, SUM(x.value) AS v, COUNT(DISTINCT x.item_id) AS items FROM ${from} WHERE ${sc.sql}${extra} AND x.qty_on_hand <> 0 GROUP BY COALESCE(x.project_id, 0) ORDER BY v DESC`
      : groupBy === 'category' ? `SELECT COALESCE(i.category_id, 0) AS k, COALESCE((SELECT name FROM mdm_item_categories WHERE id = i.category_id), 'No category') AS label, SUM(x.value) AS v, COUNT(DISTINCT x.item_id) AS items FROM ${from} WHERE ${sc.sql}${extra} AND x.qty_on_hand <> 0 GROUP BY COALESCE(i.category_id, 0) ORDER BY v DESC`
        : `SELECT x.store_id AS k, s.code || ' ' || s.name AS label, SUM(x.value) AS v, COUNT(DISTINCT x.item_id) AS items FROM ${from} WHERE ${sc.sql}${extra} AND x.qty_on_hand <> 0 GROUP BY x.store_id ORDER BY v DESC`;
    const rows = db.prepare(sql).all(P); const total = rows.reduce((n, r) => n + r.v, 0);
    return { groupBy, rows: rows.map((r) => ({ key: r.k, label: r.label, value: r.v, items: r.items, sharePct: total ? Math.round((r.v / total) * 1000) / 10 : 0 })), total, lines: db.prepare(`SELECT COUNT(*) AS n FROM ${from} WHERE ${sc.sql}${extra} AND x.qty_on_hand <> 0`).get(P).n };
  }

  // ---- movements (FR-03, FR-07) ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const ledgerView = (l, actor) => ({ id: l.id, docNo: l.doc_no, type: l.txn_type, qtyIn: l.qty_in / 1000, qtyOut: l.qty_out / 1000, rate: mask(l.rate, actor), value: mask(l.value, actor), balanceQty: l.balance_qty / 1000, balanceValue: mask(l.balance_value, actor), date: l.txn_date, owner: pname(l.project_id) });
  const resvOf = (actor, store, itemId, id) => { if (!id) return null; const r = db.prepare('SELECT * FROM inv_reservations WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r || r.store_id !== store.id || r.item_id !== itemId) fail([{ field: 'reservationId', message: 'Not a reservation of this item in this store' }]); if (r.reservation_status !== 'ACTIVE') throw unprocessable('That reservation is not active.'); return r; };
  const movements = {
    post(actor, b) {
      const store = storeFor(actor, b.storeId, 'inv.stock.post'); const item = stock.itemOf(actor.companyId, b.itemId); if (!item) fail([{ field: 'itemId', message: 'Not an item of this company' }]);
      const conv = stock.toBase(item, b.uom, Math.round(b.qty * 1000), b.rate == null ? null : Math.round(b.rate * 100));
      return stock.transaction(() => {
        const common = { store, itemId: item.id, binId: b.binId, batchNo: b.batchNo, serialNo: b.serialNo, qty: conv.qty, date: b.date, ownerProjectId: b.ownerProjectId, pool: b.pool, sourceType: b.sourceType ?? 'manual', sourceId: b.sourceId, reason: b.reason, wbsId: b.wbsId };
        if (b.type === 'RECEIPT' || b.type === 'RETURN') { if (conv.rate == null) fail([{ field: 'rate', message: 'Give the rate' }]); return { entries: [stock.postOne(actor, { ...common, type: b.type, rate: conv.rate })].map((l) => ledgerView(l, actor)) }; }
        const resv = resvOf(actor, store, item.id, b.reservationId); return { entries: stock.postOut(actor, { ...common, type: b.type, resv }).map((l) => ledgerView(l, actor)) };
      });
    },
    /** FR-07: stock moved from one store to another, between owners when the project changes (then a financial transfer event is published). */
    transfer(actor, b) {
      const from = storeFor(actor, b.fromStoreId, 'inv.stock.post'); const to = db.prepare('SELECT * FROM inv_stores WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(b.toStoreId), actor.companyId); if (!to || !may(actor, 'inv.stock.post', to.org_project_id)) throw notFound('The receiving store does not exist.'); if (from.id === to.id) fail([{ field: 'toStoreId', message: 'Choose another store' }]);
      const item = stock.itemOf(actor.companyId, b.itemId); if (!item) fail([{ field: 'itemId', message: 'Not an item of this company' }]); const conv = stock.toBase(item, b.uom, Math.round(b.qty * 1000));
      return stock.transaction(() => {
        const fromOwner = stock.ownerOf(from, { ownerProjectId: b.ownerProjectId, pool: b.pool }); const toOwner = b.toPool ? null : (b.toOwnerProjectId !== undefined ? b.toOwnerProjectId : fromOwner);
        const outs = stock.postOut(actor, { store: from, itemId: item.id, binId: b.binId, batchNo: b.batchNo, serialNo: b.serialNo, type: 'TRANSFER_OUT', qty: conv.qty, date: b.date, ownerProjectId: b.ownerProjectId, pool: b.pool, sourceType: b.sourceType ?? 'manual', sourceId: b.sourceId, reason: b.reason, resv: resvOf(actor, from, item.id, b.reservationId) });
        const ins = outs.map((o) => stock.postOne(actor, { store: to, itemId: item.id, binId: b.toBinId, batchNo: o.batch_no, serialNo: o.serial_no, type: 'TRANSFER_IN', qty: o.qty_out, value: Math.abs(o.value), date: b.date, ownerProjectId: toOwner, pool: toOwner == null, sourceType: b.sourceType ?? 'manual', sourceId: b.sourceId ?? String(o.id), reason: b.reason, counterId: o.id }));
        const value = ins.reduce((n, l) => n + l.value, 0);
        if ((fromOwner ?? 0) !== (toOwner ?? 0)) { evt('inv.stock.transferred', actor, from.company_id, 'inv_stock_ledger', ins[0].id, { itemId: item.id, qty: conv.qty / 1000, value, fromStoreId: from.id, toStoreId: to.id, fromProjectId: fromOwner, toProjectId: toOwner, outIds: outs.map((o) => o.id), inIds: ins.map((i) => i.id), reason: b.reason ?? null }, toOwner); audit(actor, 'inv_stock_ledger', ins[0].id, 'inter_project_transfer', from.company_id, { newValues: { from: fromOwner, to: toOwner, value } }); }
        return { out: outs.map((o) => ledgerView(o, actor)), in: ins.map((i) => ledgerView(i, actor)), interProject: (fromOwner ?? 0) !== (toOwner ?? 0) };
      });
    },
    /** FR-04: stock held for inspection is not free; released it is free again. */
    inspection(actor, b) {
      const x = db.prepare('SELECT * FROM inv_balances WHERE id = ? AND company_id = ?').get(rid(b.balanceId), actor.companyId); if (!x) throw notFound('That stock line does not exist.'); const store = storeFor(actor, x.store_id, 'inv.stock.post'); const q = Math.round(b.qty * 1000);
      if (b.action === 'HOLD') { if (q > x.qty_on_hand - x.qty_reserved - x.qty_inspection) throw unprocessable('Only free stock is held for inspection.'); db.prepare('UPDATE inv_balances SET qty_inspection = qty_inspection + ?, updated_at = ?, version = version + 1 WHERE id = ?').run(q, nowIso(), x.id); }
      else { if (q > x.qty_inspection) throw unprocessable('Less than that is held for inspection.'); db.prepare('UPDATE inv_balances SET qty_inspection = qty_inspection - ?, updated_at = ?, version = version + 1 WHERE id = ?').run(q, nowIso(), x.id); }
      audit(actor, 'inv_balances', x.id, `inspection_${b.action.toLowerCase()}`, store.company_id, { newValues: { qty: b.qty, note: b.note } }); const it = stock.itemOf(x.company_id, x.item_id);
      evt('inv.stock.moved', actor, store.company_id, 'inv_balances', x.id, { ledgerId: null, storeId: store.id, storeCode: store.code, storeName: store.name, storeType: store.store_type, siteId: store.org_site_id ?? null, itemId: it.id, txnType: `INSPECTION_${b.action}`, qty: 0, value: 0, freeQty: stock.freeQty(store.company_id, store.id, it.id) / 1000 }, store.org_project_id);
      return balanceMap(actor)(db.prepare('SELECT * FROM inv_balances WHERE id = ?').get(x.id));
    },
    /** BR-02: a correction is a reversing entry; nothing in the ledger is changed. */
    reverse(actor, id, { reason }) {
      const e = db.prepare('SELECT * FROM inv_stock_ledger WHERE id = ? AND company_id = ?').get(rid(id), actor.companyId); if (!e) throw notFound('That ledger entry does not exist.'); const store = storeFor(actor, e.store_id, 'inv.stock.reverse');
      if (e.txn_type === 'REVERSAL') throw unprocessable('A reversing entry is not reversed: post the movement again.'); if (db.prepare('SELECT 1 FROM inv_stock_ledger WHERE reverses_id = ?').get(e.id)) throw conflict('This entry was reversed already.');
      const dir = e.qty_in > 0 ? 'OUT' : e.qty_out > 0 ? 'IN' : 'NONE'; const qty = e.qty_in || e.qty_out;
      if (dir === 'OUT' && store.valuation_method === 'FIFO') { const layer = db.prepare('SELECT qty_remaining FROM inv_fifo_layers WHERE ledger_id = ?').get(e.id); if (!layer || layer.qty_remaining < qty) throw unprocessable('Part of this receipt has been issued already: reverse the issues first.'); }
      return stock.transaction(() => ({ entry: ledgerView(stock.postOne(actor, { store, itemId: e.item_id, binId: e.bin_id, batchNo: e.batch_no, serialNo: e.serial_no, type: dir === 'NONE' ? 'REVALUATION' : 'REVERSAL', direction: dir === 'NONE' ? undefined : dir, qty, value: dir === 'NONE' ? -e.value : Math.abs(e.value), date: todayIST(), ownerProjectId: e.project_id, pool: e.project_id == null, sourceType: 'inv_stock_ledger', sourceId: String(e.id), reason, reversesId: e.id, layerLedgerId: dir === 'OUT' ? e.id : undefined }), actor) }));
    },
    /** FR-08: opening stock from a file, all or nothing. */
    openingImport(actor, { rows }) {
      need(actor, 'inv.stock.import', 'import opening stock'); const problems = []; const plan = [];
      rows.forEach((r, i) => {
        const st = db.prepare('SELECT * FROM inv_stores WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, r.storeCode); if (!st) { problems.push({ field: `rows.${i}.storeCode`, message: `${r.storeCode}: not a store` }); return; }
        if (!may(actor, 'inv.stock.import', st.org_project_id)) { problems.push({ field: `rows.${i}.storeCode`, message: `${r.storeCode}: you may not load stock here` }); return; }
        const it = db.prepare('SELECT id FROM mdm_items WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, r.itemCode); if (!it) { problems.push({ field: `rows.${i}.itemCode`, message: `${r.itemCode}: not an item` }); return; }
        let bin = null; if (r.binCode) { bin = db.prepare('SELECT id FROM inv_bins WHERE store_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(st.id, r.binCode); if (!bin) { problems.push({ field: `rows.${i}.binCode`, message: `${r.binCode}: not a bin of ${st.code}` }); return; } }
        let owner; if (r.projectCode) { const p = db.prepare('SELECT id FROM org_projects WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, r.projectCode); if (!p) { problems.push({ field: `rows.${i}.projectCode`, message: `${r.projectCode}: not a project` }); return; } owner = p.id; }
        if (db.prepare('SELECT 1 FROM inv_stock_ledger WHERE company_id = ? AND store_id = ? AND item_id = ? LIMIT 1').get(actor.companyId, st.id, it.id) && !plan.some((p) => p.st.id === st.id && p.itemId === it.id)) problems.push({ field: `rows.${i}.itemCode`, message: `${r.itemCode} has stock movements in ${st.code} already: opening stock is loaded once` });
        plan.push({ st, itemId: it.id, binId: bin?.id, batchNo: r.batchNo, serialNo: r.serialNo, qty: Math.round(r.qty * 1000), rate: Math.round(r.rate * 100), owner, pool: r.projectCode == null && st.org_project_id == null, date: r.date });
      });
      fail(problems);
      return stock.transaction(() => { const out = plan.map((p) => stock.postOne(actor, { store: p.st, itemId: p.itemId, binId: p.binId, batchNo: p.batchNo, serialNo: p.serialNo, type: 'OPENING', qty: p.qty, rate: p.rate, date: p.date, ownerProjectId: p.owner, pool: p.owner === undefined && p.pool, sourceType: 'opening_import', sourceId: undefined, reason: 'Opening stock' })); audit(actor, 'inv_stock_ledger', out[0]?.id ?? 0, 'opening_import', actor.companyId, { newValues: { rows: out.length } }); return { loaded: out.length, entries: out.map((l) => ledgerView(l, actor)) }; });
    },
  };

  // ---- reservations (FR-06) -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const resView = (r, actor) => ({ id: r.id, docNo: r.doc_no, storeId: r.store_id, store: db.prepare('SELECT code FROM inv_stores WHERE id = ?').get(r.store_id)?.code, itemId: r.item_id, item: db.prepare('SELECT code, name FROM mdm_items WHERE id = ?').get(r.item_id), qty: r.qty / 1000, consumed: r.qty_consumed / 1000, open: (r.qty - r.qty_consumed) / (r.reservation_status === 'ACTIVE' ? 1000 : 1e12), status: r.reservation_status, neededBy: r.needed_by, sourceType: r.source_type, sourceId: r.source_id, owner: pname(r.project_id), reservedBy: r.reserved_by, can: { release: may(actor, 'inv.reservation.reserve', null) && r.reservation_status === 'ACTIVE' } });
  const reservations = {
    list(actor, q = {}) {
      const sc = storeScope(actor, 'inv.reservation.view'); const P = { ...sc.params }; let extra = ''; if (q.storeId) { extra += ' AND r.store_id = :st'; P.st = rid(q.storeId); } if (q.itemId) { extra += ' AND r.item_id = :it'; P.it = rid(q.itemId); } if (q.status) { extra += ' AND r.reservation_status = :rs'; P.rs = q.status; }
      return db.prepare(`SELECT r.* FROM inv_reservations r JOIN inv_stores s ON s.id = r.store_id WHERE ${sc.sql} AND r.deleted_at IS NULL${extra} ORDER BY r.id DESC LIMIT 200`).all(P).map((r) => resView(r, actor));
    },
    create(actor, b) {
      const store = storeFor(actor, b.storeId, 'inv.reservation.reserve'); const item = stock.itemOf(actor.companyId, b.itemId); if (!item) fail([{ field: 'itemId', message: 'Not an item of this company' }]); const conv = stock.toBase(item, b.uom, Math.round(b.qty * 1000)); const owner = stock.ownerOf(store, b);
      if (b.neededBy && b.neededBy < todayIST()) fail([{ field: 'neededBy', message: 'The date has passed' }]);
      return stock.transaction(() => { const alloc = stock.allocate(actor.companyId, store, item.id, owner, conv.qty); const no = number(actor.companyId, actor.user, 'INV_RESERVATION', 'inv_reservations', 'RSV');
        const id = Number(db.prepare('INSERT INTO inv_reservations (company_id, doc_no, store_id, item_id, qty, alloc_json, needed_by, reserved_by, project_id, site_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, no, store.id, item.id, conv.qty, JSON.stringify(alloc), b.neededBy ?? null, actor.user, owner, store.org_site_id ?? null, actor.user, b.sourceType, String(b.sourceId)).lastInsertRowid); stock.reserveRows(alloc);
        audit(actor, 'inv_reservations', id, 'create', actor.companyId, { newValues: { item: item.code, qty: b.qty, source: `${b.sourceType} ${b.sourceId}` } }); evt('inv.stock.reserved', actor, actor.companyId, 'inv_reservation', id, { reservationId: id, storeId: store.id, itemId: item.id, qty: conv.qty / 1000, sourceType: b.sourceType, sourceId: String(b.sourceId), freeQty: stock.freeQty(actor.companyId, store.id, item.id) / 1000, storeCode: store.code, storeName: store.name, storeType: store.store_type, siteId: store.org_site_id ?? null }, owner);
        return resView(db.prepare('SELECT * FROM inv_reservations WHERE id = ?').get(id), actor); });
    },
    release(actor, id, { reason }) {
      const r = db.prepare('SELECT * FROM inv_reservations WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r) throw notFound('That reservation does not exist.'); const store = storeFor(actor, r.store_id, 'inv.reservation.reserve'); if (r.reservation_status !== 'ACTIVE') throw unprocessable('Only an active reservation is released.');
      return stock.transaction(() => { stock.releaseReservation(r); db.prepare("UPDATE inv_reservations SET reservation_status = 'RELEASED', released_reason = ?, alloc_json = '[]', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'inv_reservations', r.id, 'release', r.company_id, { reason });
        evt('inv.stock.reserved', actor, r.company_id, 'inv_reservation', r.id, { reservationId: r.id, storeId: store.id, itemId: r.item_id, qty: 0, released: true, freeQty: stock.freeQty(r.company_id, store.id, r.item_id) / 1000, storeCode: store.code, storeName: store.name, storeType: store.store_type, siteId: store.org_site_id ?? null }, r.project_id); return resView(db.prepare('SELECT * FROM inv_reservations WHERE id = ?').get(r.id), actor); });
    },
  };

  // ---- adjustments: quantity corrections and revaluation, approved before they post (FR-05) ----------------------------------------------------------------------------------------------------------------
  const adjLines = (store, b, existing = null) => {
    const problems = []; const out = []; (b.lines ?? existing ?? []).forEach((l, i) => {
      const it = stock.itemOf(store.company_id, l.itemId); if (!it) { problems.push({ field: `lines.${i}.itemId`, message: 'Not an item of this company' }); return; }
      const val = stock.valRow(store.company_id, store.id, it.id);
      if (b.type === 'REVALUATION') { if (!(l.newRate >= 0)) { problems.push({ field: `lines.${i}.newRate`, message: 'Give the corrected rate' }); return; } const newRate = Math.round(l.newRate * 100); out.push({ itemId: it.id, code: it.code, onHand: val.qty, oldRate: val.avg_rate, newRate, delta: Math.round((val.qty * (newRate - val.avg_rate)) / 1000) }); }
      else { if (!l.qtyDelta) { problems.push({ field: `lines.${i}.qtyDelta`, message: 'Give the quantity to add or take off' }); return; } const q = Math.round(l.qtyDelta * 1000); const rate = l.rate != null ? Math.round(l.rate * 100) : val.avg_rate; out.push({ itemId: it.id, code: it.code, binId: l.binId ?? null, batchNo: l.batchNo ?? '', serialNo: l.serialNo ?? '', ownerProjectId: l.ownerProjectId, qtyDelta: q, rate, delta: Math.round((q * rate) / 1000) }); }
    }); fail(problems); if (!out.length) fail([{ field: 'lines', message: 'Add at least one line' }]); return out;
  };
  const adjView = (actor, a, { detail = false } = {}) => {
    const store = db.prepare('SELECT code, name, org_project_id FROM inv_stores WHERE id = ?').get(a.store_id); const can = (k) => may(actor, k, store.org_project_id); const own = same(a.requested_by, actor.user);
    const o = { id: a.id, docNo: a.doc_no, date: a.doc_date, storeId: a.store_id, store: store.code, type: a.adj_type, typeLabel: ADJ_TYPES[a.adj_type], reason: a.reason, valueDelta: mask(a.value_delta, actor), status: a.status, statusLabel: ADJ_STATUS[a.status], requestedBy: a.requested_by, approvedBy: a.approved_by, postedAt: a.posted_at, workflowInstanceId: a.workflow_instance_id, cancelReason: a.cancel_reason, rowVersion: a.version,
      can: { edit: can('inv.adjustment.create') && EDITABLE.includes(a.status), submit: can('inv.adjustment.submit') && EDITABLE.includes(a.status), withdraw: a.status === 'SUBMITTED' && own, approve: can('inv.adjustment.approve') && a.status === 'SUBMITTED' && !own, cancel: can('inv.adjustment.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(a.status) } };
    if (detail) { const it = (id) => db.prepare('SELECT code, name FROM mdm_items WHERE id = ?').get(id); o.lines = json(a.lines_json, []).map((l) => ({ ...l, item: it(l.itemId)?.name, rate: canValues(actor) ? l.rate : null, oldRate: canValues(actor) ? l.oldRate : null, newRate: canValues(actor) ? l.newRate : null, delta: canValues(actor) ? l.delta : null, qtyDelta: l.qtyDelta == null ? undefined : l.qtyDelta / 1000, onHand: l.onHand == null ? undefined : l.onHand / 1000 })); if (o.can.approve && a.workflow_instance_id) o.taskId = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === a.workflow_instance_id)?.id ?? null; }
    return o;
  };
  const adjRow = (actor, id, key = 'inv.adjustment.view') => { const a = db.prepare('SELECT * FROM inv_adjustments WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!a) throw notFound('That adjustment does not exist.'); storeFor(actor, a.store_id, key); return a; };
  const adjustments = {
    list(actor, query) { const sc = storeScope(actor, 'inv.adjustment.view'); return runList(db, adjList, parseListRequest(adjList, query), { select: 'x.*', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (a) => ({ id: a.id, docNo: a.doc_no, store: db.prepare('SELECT code FROM inv_stores WHERE id = ?').get(a.store_id)?.code, date: a.doc_date, type: a.adj_type, valueDelta: mask(a.value_delta, actor), status: a.status, statusLabel: ADJ_STATUS[a.status] }) }); },
    get: (actor, id) => adjView(actor, adjRow(actor, id), { detail: true }),
    create(actor, b) {
      const store = storeFor(actor, b.storeId, 'inv.adjustment.create'); const lines = adjLines(store, b); const delta = lines.reduce((n, l) => n + l.delta, 0);
      return stock.transaction(() => { const no = number(actor.companyId, actor.user, 'INV_ADJUSTMENT', 'inv_adjustments', 'ADJ'); const id = Number(db.prepare("INSERT INTO inv_adjustments (company_id, doc_no, doc_date, store_id, adj_type, reason, lines_json, value_delta, status, requested_by, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, 'api')").run(actor.companyId, no, todayIST(), store.id, b.type, b.reason, JSON.stringify(lines), delta, actor.user, store.org_project_id ?? null, store.org_site_id ?? null, actor.user).lastInsertRowid); audit(actor, 'inv_adjustments', id, 'create', actor.companyId, { newValues: { docNo: no, type: b.type, delta } }); return adjustments.get(actor, id); });
    },
    update(actor, id, b) {
      const a = adjRow(actor, id, 'inv.adjustment.create'); if (!EDITABLE.includes(a.status)) throw conflict('Only a draft or a returned adjustment is changed.'); if (b.rowVersion && b.rowVersion !== a.version) throw conflict('Someone changed this adjustment; reload it.'); const store = storeFor(actor, a.store_id); const type = b.type ?? a.adj_type; const lines = b.lines ? adjLines(store, { ...b, type }) : json(a.lines_json, []);
      db.prepare('UPDATE inv_adjustments SET adj_type = ?, reason = ?, lines_json = ?, value_delta = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(type, b.reason ?? a.reason, JSON.stringify(lines), lines.reduce((n, l) => n + l.delta, 0), actor.user, nowIso(), a.id); audit(actor, 'inv_adjustments', a.id, 'update', a.company_id); return adjustments.get(actor, a.id);
    },
    submit(actor, id) {
      const a = adjRow(actor, id, 'inv.adjustment.submit'); if (!EDITABLE.includes(a.status)) throw unprocessable('Only a draft or a returned adjustment is sent for approval.'); const store = storeFor(actor, a.store_id); const lines = adjLines(store, { type: a.adj_type, lines: json(a.lines_json, []).map((l) => (a.adj_type === 'REVALUATION' ? { itemId: l.itemId, newRate: l.newRate / 100 } : { itemId: l.itemId, binId: l.binId, batchNo: l.batchNo, serialNo: l.serialNo, ownerProjectId: l.ownerProjectId, qtyDelta: l.qtyDelta / 1000, rate: l.rate / 100 })) }); const delta = lines.reduce((n, l) => n + l.delta, 0);
      return stock.transaction(() => { db.prepare('UPDATE inv_adjustments SET lines_json = ?, value_delta = ? WHERE id = ?').run(JSON.stringify(lines), delta, a.id); const band = a.source_type === 'inv_count_plan'; const ctx = band ? { projectId: store.org_project_id ?? undefined, needProc: Math.abs(delta) > 5_000_000 ? 'yes' : 'no', needCfo: Math.abs(delta) > 50_000_000 ? 'yes' : 'no' } : { projectId: store.org_project_id ?? undefined, needAcc: a.adj_type === 'REVALUATION' || Math.abs(delta) >= 10_000_000 ? 'yes' : 'no' };
        if (a.status === 'RETURNED' && a.workflow_instance_id) workflowOf(db).resubmit(actor, a.workflow_instance_id, { comment: 'Corrected', context: ctx }); else { const inst = workflowOf(db).submit(actor, { docType: band ? 'INV_ADJ_BAND' : INV_ADJ_DOC, docId: String(a.id), comment: `${a.doc_no} ${store.code}: ${a.reason}`.slice(0, 300), context: ctx }); db.prepare('UPDATE inv_adjustments SET workflow_instance_id = ? WHERE id = ?').run(inst.id, a.id); }
        db.prepare("UPDATE inv_adjustments SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), a.id); audit(actor, 'inv_adjustments', a.id, 'submit', a.company_id); return adjustments.get(actor, a.id); });
    },
    withdraw(actor, id, { reason }) { const a = adjRow(actor, id); if (a.status !== 'SUBMITTED') throw unprocessable('Only an adjustment waiting for approval is withdrawn.'); if (!same(a.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, a.workflow_instance_id, { comment: reason }); return adjustments.get(actor, a.id); },
    cancel(actor, id, { reason }) { const a = adjRow(actor, id, 'inv.adjustment.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(a.status)) throw unprocessable('Only an adjustment not yet approved is cancelled.'); return stock.transaction(() => { if (a.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, a.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE inv_adjustments SET status = 'CANCELLED', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), a.id); audit(actor, 'inv_adjustments', a.id, 'cancel', a.company_id, { reason }); return adjustments.get(actor, a.id); }); },
    history(actor, id) { const a = adjRow(actor, id); return { approvals: a.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(a.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'inv_adjustments' AND entity_id = ? ORDER BY id").all(String(a.id)) }; },
    /** The approval posts the lines (the maker never posts). */
    decide(instance, actor, outcome, comment) {
      const a = db.prepare('SELECT * FROM inv_adjustments WHERE id = ?').get(rid(instance.docId)); if (!a || a.status !== 'SUBMITTED') return; const store = db.prepare('SELECT * FROM inv_stores WHERE id = ?').get(a.store_id); const now = nowIso();
      if (outcome === 'APPROVED') {
        if (a.source_type === 'inv_count_plan') { const counters = db.prepare('SELECT DISTINCT counted_by AS u FROM inv_count_lines WHERE plan_id = ? AND counted_by IS NOT NULL UNION SELECT DISTINCT recounted_by FROM inv_count_lines WHERE plan_id = ? AND recounted_by IS NOT NULL').all(Number(a.source_id), Number(a.source_id)); if (counters.some((c) => same(c.u, actor.user))) throw forbidden('The person who counted the stock does not approve the adjustment it leads to (SoD-09).'); }
        for (const l of json(a.lines_json, [])) {
          if (a.adj_type === 'REVALUATION') { const val = stock.valRow(a.company_id, store.id, l.itemId); const delta = Math.round((val.qty * (l.newRate - val.avg_rate)) / 1000); stock.postOne(actor, { store, itemId: l.itemId, type: 'REVALUATION', value: delta, date: todayIST(), sourceType: 'inv_adjustment', sourceId: String(a.id), reason: a.reason }); }
          else if (l.qtyDelta > 0) stock.postOne(actor, { store, itemId: l.itemId, binId: l.binId ?? undefined, batchNo: l.batchNo, serialNo: l.serialNo, type: 'ADJUSTMENT', direction: 'IN', qty: l.qtyDelta, rate: l.rate, date: todayIST(), ownerProjectId: l.ownerProjectId, sourceType: 'inv_adjustment', sourceId: String(a.id), reason: a.reason });
          else stock.postOut(actor, { store, itemId: l.itemId, binId: l.binId ?? undefined, batchNo: l.binId ? l.batchNo : undefined, serialNo: l.binId ? l.serialNo : undefined, type: 'ADJUSTMENT', direction: 'OUT', qty: -l.qtyDelta, date: todayIST(), ownerProjectId: l.ownerProjectId, sourceType: 'inv_adjustment', sourceId: String(a.id), reason: a.reason });
        }
        db.prepare("UPDATE inv_adjustments SET status = 'APPROVED', approved_by = ?, approved_at = ?, posted_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, now, actor.user, now, a.id); audit(actor, 'inv_adjustments', a.id, 'approve', a.company_id); if (a.source_type === 'inv_count_plan') db.prepare("UPDATE inv_count_plans SET status = 'CLOSED', updated_at = ?, version = version + 1 WHERE id = ? AND status = 'ADJUSTED'").run(now, Number(a.source_id));
        notify(a.company_id, 'inv.adjustment.decided', [`user:${a.requested_by}`], a.doc_no, 'approved', `${a.doc_no} is approved and posted to the stock ledger.`, `/inv/adjustments?id=${a.id}`, a.id, { projectId: store.org_project_id ?? undefined }); return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED'; db.prepare('UPDATE inv_adjustments SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : a.workflow_instance_id, actor.user, now, a.id); audit(actor, 'inv_adjustments', a.id, outcome.toLowerCase(), a.company_id, { reason: comment });
    },
  };

  // ---- the dashboard and the check of the books (BR-03) ---------------------------------------------------------------------------------------------------------------------------------------------
  function dashboard(actor, q = {}) {
    const sc = storeScope(actor, 'inv.stock.view'); const v = canValues(actor); const today = todayIST(); const P = { ...sc.params }; let extra = ''; if (q.projectId) { extra += ' AND s.org_project_id = :pj'; P.pj = rid(q.projectId); }
    const byStore = db.prepare(`SELECT s.id, s.code, s.name, COALESCE(SUM(x.value), 0) AS value, COUNT(DISTINCT CASE WHEN x.qty_on_hand <> 0 THEN x.item_id END) AS items FROM inv_stores s LEFT JOIN inv_balances x ON x.store_id = s.id WHERE ${sc.sql} AND s.deleted_at IS NULL AND s.store_status = 'ACTIVE'${extra} GROUP BY s.id ORDER BY value DESC, s.code`).all(P);
    const below = db.prepare(`SELECT i.id, i.code, i.name, i.base_uom, i.reorder_level, COALESCE(SUM(x.qty_on_hand - x.qty_reserved - x.qty_inspection), 0) AS free FROM mdm_items i LEFT JOIN inv_balances x ON x.item_id = i.id AND x.store_id IN (SELECT s.id FROM inv_stores s WHERE ${sc.sql}${extra}) WHERE i.company_id = :c AND i.deleted_at IS NULL AND i.stock_tracked = 1 AND i.reorder_level > 0 GROUP BY i.id HAVING free < i.reorder_level ORDER BY (i.reorder_level - free) DESC LIMIT 25`).all(P);
    const ageRows = db.prepare(`SELECT x.value, x.last_receipt_on FROM inv_balances x JOIN inv_stores s ON s.id = x.store_id WHERE ${sc.sql}${extra} AND x.qty_on_hand > 0`).all(P);
    const ageing = AGE_BUCKETS.map(([label, lo, hi]) => ({ label, value: v ? ageRows.filter((r) => { const d = r.last_receipt_on ? daysBetween(r.last_receipt_on, today) : 0; return d >= lo && d <= hi; }).reduce((n, r) => n + r.value, 0) : null, lines: ageRows.filter((r) => { const d = r.last_receipt_on ? daysBetween(r.last_receipt_on, today) : 0; return d >= lo && d <= hi; }).length }));
    const reserved = db.prepare(`SELECT COALESCE(SUM(x.qty_reserved), 0) AS q, COUNT(*) AS n FROM inv_balances x JOIN inv_stores s ON s.id = x.store_id WHERE ${sc.sql}${extra} AND x.qty_reserved > 0`).get(P);
    const recent = db.prepare(`SELECT l.* FROM inv_stock_ledger l JOIN inv_stores s ON s.id = l.store_id WHERE ${sc.sql}${extra.replace(/s\.org_project_id/g, 's.org_project_id')} ORDER BY l.id DESC LIMIT 8`).all(P).map((l) => ({ ...ledgerView(l, actor), store: db.prepare('SELECT code FROM inv_stores WHERE id = ?').get(l.store_id)?.code, item: db.prepare('SELECT code, name FROM mdm_items WHERE id = ?').get(l.item_id) }));
    const pending = { stores: db.prepare(`SELECT COUNT(*) AS n FROM inv_stores s WHERE ${sc.sql} AND s.store_status = 'SUBMITTED' AND s.deleted_at IS NULL`).get(sc.params).n, adjustments: may(actor, 'inv.adjustment.view') ? db.prepare(`SELECT COUNT(*) AS n FROM inv_adjustments x JOIN inv_stores s ON s.id = x.store_id WHERE ${sc.sql} AND x.status = 'SUBMITTED' AND x.deleted_at IS NULL`).get(sc.params).n : 0 };
    const check = sc.unrestricted && may(actor, 'inv.stock.reconcile') ? stock.integrity(actor.companyId) : null;
    return { tiles: { stores: byStore.length, totalValue: v ? byStore.reduce((n, s) => n + s.value, 0) : null, belowReorder: below.length, reservedLines: reserved.n, pendingApprovals: pending.stores + pending.adjustments, integrityProblems: check ? check.length : null }, byStore: byStore.map((s) => ({ id: s.id, code: s.code, name: s.name, value: v ? s.value : null, items: s.items })), belowReorder: below.map((r) => ({ itemId: r.id, code: r.code, name: r.name, uom: r.base_uom, free: r.free / 1000, reorderLevel: r.reorder_level / 1000 })), ageing, recent, pending, canValues: v, integrity: check ? check.slice(0, 20) : null };
  }
  const integrity = (actor) => { need(actor, 'inv.stock.reconcile', 'check the stock books'); return { checkedAt: nowIso(), problems: stock.integrity(actor.companyId) }; };
  /** The nightly check: a mismatch is told to the store managers. */
  function nightly() {
    let told = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) { const p = stock.integrity(c.id); if (p.length) { notify(c.id, 'inv.integrity', ['role:STOREMGR|ACCMGR'], 'Stock books', `${p.length} difference(s)`, `The stock balances differ from the ledger in ${p.length} place(s): ${p.slice(0, 3).map((x) => x.kind).join(', ')}.`, '/inv/dashboard', `integrity.${todayIST()}`); evt('inv.integrity.failed', null, c.id, 'inv_balances', 0, { problems: p.length, kinds: [...new Set(p.map((x) => x.kind))] }); told += 1; } } return told;
  }
  const projects = (actor) => { need(actor, 'inv.store.view', 'see stores'); return db.prepare("SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code").all(actor.companyId).filter((p) => may(actor, 'inv.store.view', p.id)); };
  const items = (actor, qs = '') => { need(actor, 'inv.stock.view', 'see stock'); return db.prepare("SELECT id, code, name, base_uom FROM mdm_items WHERE company_id = ? AND deleted_at IS NULL AND stock_tracked = 1 AND (code LIKE ? OR name LIKE ?) ORDER BY name LIMIT 60").all(actor.companyId, `%${qs}%`, `%${qs}%`); };
  return { stock, stores, bins, balances, itemCard, valuation, movements, reservations, adjustments, dashboard, integrity, nightly, projects, items, storeFor, storeScope };
}
