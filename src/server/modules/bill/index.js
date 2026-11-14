import { authzOf } from '../../platform/authz/index.js';
import { eventTypes } from '../../platform/events/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports } from '../../platform/list/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { workflowTypes } from '../../platform/workflow/index.js';
import { createFlagService } from '../core/api.js';
import { createBase } from '../proc/base.js';
import { STATUS } from '../qa/flow.js';
import { createMbService } from './mb.js';
import { billRoutes } from './routes.js';

// Measurement and billing (module M22): the measurement book and check measurement (22.01); later quantity reconciliation, the client RA bill, subcontractor measurements and bills.
const services = new WeakMap();
export const billOf = (db) => services.get(db) ?? null;
export const BILL_DOCS = { mb: 'BILL_MB_ENTRY' };

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['bill.mb.certified', 'A measurement was certified and locked (part 22.01 FR-05): data { mbId, docNo, projectId, boqLineId, boqCode, description, locationId, waId, activityId, irId, uom, measuredQty, certifiedQty, checkedQty, checkStatus, measuredBy, measuredOn, certifiedOn, period, book, page, line }. The client RA bill (22.03), the quantity reconciliation (22.02) and the financial progress (14.05) read it.'],
  ['bill.mb.checked', 'The check measurement of an entry was recorded (part 22.01 FR-04): data { mbId, docNo, projectId, measuredQty, checkedQty, difference, checkedBy, checkPct }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'bill', description });

integrityRegistry.register({
  statuses: { bill_mb_entries: Object.keys(STATUS) },
  uniqueKeys: [{ table: 'bill_mb_entries', columns: ['company_id', 'doc_no'] }],
});

export const bill = {
  code: 'bill',
  name: 'Measurement and Billing',
  routePrefix: '/api/v1/bill',
  ownerPart: '22.01',
  status: 'Measurement book with dimension formulas, eligibility checks, check measurement, certification and locking, the abstract of the bill period and the book in print.',
  tables: ['bill_mb_entries'],
  resources: ['mb-entries', 'mb-abstract', 'mb-book'],
  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bill_mb_entries'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment }); const base = createBase({ db });
    const m = createMbService({ db, base, flags }); const deciders = { [BILL_DOCS.mb]: m.mb.decide }; const svc = { ...m };
    services.set(db, { svc, base, flags, deciders });
    listExports.register('bill.mb_entries', { source: (actor, req) => { base.need(actor, 'bill.mb_entry.export', 'export measurements'); return m.mb.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
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
