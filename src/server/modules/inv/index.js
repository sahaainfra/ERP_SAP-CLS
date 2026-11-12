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
import { invRoutes } from './routes.js';

const services = new WeakMap();
export const invOf = (db) => services.get(db) ?? null;

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['inv.stock.moved', 'Stock moved in a store (part 16.01): data { ledgerId, storeId, storeCode, storeName, storeType, siteId, itemId, txnType, qty (signed, base unit), value (signed, paise), rate, batchNo, serialNo, ownerProjectId, sourceType, sourceId, freeQty, onHand, date }. For finance posting (23.02), project cost (14.07) and the stock the requisition sees (15.01).'],
  ['inv.stock.transferred', 'Stock changed owner between projects in a transfer (part 16.01, FR-07): data { itemId, qty, value, fromStoreId, toStoreId, fromProjectId, toProjectId, outIds, inIds, reason }. The financial transfer between the projects.'],
  ['inv.stock.reserved', 'Stock was reserved or a reservation was released (part 16.01): data { reservationId, storeId, itemId, qty, sourceType, sourceId, freeQty }.'],
  ['inv.store.activated', 'A store was approved and is active (part 16.01): data { storeId, code, type, projectId, siteId }.'],
  ['inv.integrity.failed', 'The nightly check found the stock balances different from the ledger (part 16.01): data { problems, kinds }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'inv', description });

integrityRegistry.register({
  statuses: { inv_stores: Object.keys(STORE_STATUS), inv_adjustments: Object.keys(ADJ_STATUS) },
  uniqueKeys: [{ table: 'inv_stores', columns: ['company_id', 'code'] }, { table: 'inv_stock_ledger', columns: ['company_id', 'doc_no'] }, { table: 'inv_adjustments', columns: ['company_id', 'doc_no'] }, { table: 'inv_reservations', columns: ['company_id', 'doc_no'] }, { table: 'inv_store_changes', columns: ['company_id', 'doc_no'] }],
});

/** Module "inv": stores, inventory and site logistics (M16). Part 16.01 holds the stores, bins, the append-only stock ledger, balances, valuation, reservations and adjustments. The tables are `inv_*`. */
export const inv = {
  code: 'inv',
  name: 'Stores & Inventory',
  routePrefix: '/api/v1/inv',
  ownerPart: '16.01',
  status: 'Stores and warehouses with bins, an append-only stock ledger, balances by item, store, bin, batch and owner, moving weighted average or FIFO valuation, reservations, project ownership with inter-project transfers, approved adjustments and revaluation, opening stock import and a nightly check that balances equal the ledger.',
  tables: ['inv_stores', 'inv_store_changes', 'inv_bins', 'inv_stock_ledger', 'inv_balances', 'inv_valuation', 'inv_fifo_layers', 'inv_reservations', 'inv_adjustments'],
  resources: ['stores', 'bins', 'balances', 'ledger', 'valuation', 'movements', 'transfers', 'inspection', 'opening-stock', 'reservations', 'adjustments', 'dashboard', 'integrity'],

  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'inv_stores'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment }); const base = createBase({ db }); const invSvc = createInvService({ db, base });
    const svc = { flags, base, invSvc, storeDecide: invSvc.stores.decide, changeDecide: invSvc.stores.changeDecide, adjDecide: invSvc.adjustments.decide }; services.set(db, svc);
    listExports.register('inv.stores', { source: (actor, req) => invSvc.stores.exportSource(actor, req), hidden: () => [] });
    listExports.register('inv.balances', { source: (actor, req) => invSvc.balances.exportSource(actor, req), hidden: () => [] });
    const runtime = runtimeOf(db);
    // BR-03: every night at 02:30 India time the balances are checked against the ledger
    runtime?.jobs?.register('inv.integrity_check', (ctx) => { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) { if (!flags.isOn({ companyId: c.id }, 'ff.inv.p1601')) continue; n = invSvc.nightly(); break; } ctx.log(`Stock books checked: ${n} company(ies) with differences`); return { withDifferences: n }; }, { maxAttempts: 2, description: 'Checks that the stock balances and valuations equal the sum of the stock ledger and tells the store managers of any difference.' });
    runtime?.scheduler?.define({ code: 'inv.integrity_check_nightly', cron: '0 21 * * *', jobType: 'inv.integrity_check', description: 'Every night 02:30 India time: the stock balances are checked against the ledger' });
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

/** @type {any[][]} */
const invObjects = [
  ['inv_store', 'Store', 'inv.store.view', 'inv_stores', (s, a, id) => s.invSvc.stores.get(a, id), (r) => ({ projectId: r.projectId ?? undefined, status: r.status }), (r) => ({ label: `${r.code} ${r.name}`, status: r.status }), '/inv/stores', 'code'],
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
