import { authzOf } from '../../platform/authz/index.js';
import { eventTypes } from '../../platform/events/index.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { fileEntities } from '../../platform/files/entities.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports } from '../../platform/list/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { workflowTypes } from '../../platform/workflow/index.js';
import { createFlagService } from '../core/api.js';
import { createBase } from '../proc/base.js';
import { registerProject360Widget } from '../proj/p360.js';
import { trainingOf } from '../hr/training.js';
import { EQUIP_STATE, EQUIP_STATUS, PLANT_EQUIP_DOC, createPlantService } from './equipment.js';
import { PLANT_ALLOC_DOC, PLANT_REQ_DOC, REQ_STATUS, PHASE, createAllocService } from './alloc.js';
import { plantRoutes } from './routes.js';

const services = new WeakMap();
export const plantOf = (db) => services.get(db) ?? null;
// the plant slot of Project 360 (10.08, part 17.01): the equipment of the project, only for a person who may see the register and where the part is on
registerProject360Widget('plant', (ctx) => {
  const s = plantOf(ctx.db); const pid = ctx.project.project_id;
  if (!s || !s.flags.isOn(ctx.actor, 'ff.plant.p1701')) return { figures: [], rows: [], note: 'The equipment register is not enabled for your company yet.' };
  if (!s.base.may(ctx.actor, 'plant.equipment.view', pid)) return { figures: [], rows: [], note: 'You have no right to see the equipment of this project.' };
  return s.svc.projectWidget(ctx.actor, pid);
});

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['plant.equipment.registered', 'A machine or vehicle was approved into the register (part 17.01): data { equipmentId, docNo, assetCode, classItemId, ownership, ownerPartnerId, purchaseValue (paise), capitalise, meterType, fuelType, fuelNorm, fuelNormUnit, tankCapacity, projectId, siteId, state }. Allocation (17.02) offers it; fixed assets (23.09) capitalise an owned one; the batching plant (20.01) reads its capacity.'],
  ['plant.equipment.amended', 'The particulars of a registered machine were changed and approved again (part 17.01): same data as plant.equipment.registered.'],
  ['plant.equipment.status_changed', 'A machine changed status or location (part 17.01): data { equipmentId, assetCode, from, to, projectId, siteId, note }.'],
  ['plant.certificate.renewed', 'A statutory certificate was renewed (part 17.01): data { equipmentId, assetCode, docType, validUntil }.'],
  ['plant.certificate.expiring', 'A statutory certificate expires soon (part 17.01): data { equipmentId, assetCode, docType, validUntil, daysLeft }.'],
  ['plant.requisition.approved', 'An equipment requisition was approved by the construction manager and the project manager (part 17.02): data { requisitionId, docNo, projectId, siteId, classItemId, capacity, qty, fromDate, toDate, priority, activityId }. The allocation desk meets it from the fleet.'],
  ['plant.requisition.hire_requested', 'The plant manager decided that machines of a requisition are hired in (part 17.02): data { requisitionId, docNo, projectId, siteId, classItemId, capacity, qty, fromDate, toDate, reason }. Hire-in (17.06) takes it from here.'],
  ['plant.allocation.approved', 'An allocation or transfer of a machine to a project and site was approved (part 17.02): data { allocationId, docNo, equipmentId, assetCode, projectId, siteId, requisitionId, fromDate, toDate, rate (rupees), rateBasis, source, transfer }.'],
  ['plant.allocation.cancelled', 'An approved allocation that had not left was cancelled (part 17.02): data { allocationId, docNo, equipmentId, reason }.'],
  ['plant.allocation.mobilised', 'A machine left for its site (part 17.02): data { allocationId, docNo, equipmentId, assetCode, toProjectId, toSiteId, fromProjectId, fromSiteId, vehicleNo, gatePassId, dispatchMeter, dispatchedOn }.'],
  ['plant.allocation.arrived', 'A machine arrived and was accepted against the checklist; it is deployed at the site (part 17.02): data { allocationId, docNo, equipmentId, assetCode, projectId, siteId, arrivedOn, arrivalMeter, meterType, fromDate, toDate, rate, rateBasis, transfer, failedItems, operators }. The log books (17.03) start from it.'],
  ['plant.allocation.demobilised', 'A machine left its site and the allocation was released (part 17.02): data { allocationId, docNo, equipmentId, projectId, siteId, arrivedOn, departedOn, usage (meter units), meterType, rate, rateBasis, source }. Internal and hire charges (17.06) read the usage.'],
  ['plant.operator.assigned', 'An operator with a valid certificate was assigned to a machine (part 17.02): data { assignmentId, equipmentId, assetCode, allocationId, personType, personId, shift, fromDate, toDate, certTypes }.'],
  ['plant.operator.ended', 'An operator assignment ended (part 17.02): data { assignmentId, equipmentId, personType, personId, reason }.'],
  ['plant.certificate.expired', 'A statutory certificate expired and the machine can no longer be allocated or logged (part 17.01): data { equipmentId, assetCode, docType, validUntil }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'plant', description });

integrityRegistry.register({
  statuses: { plt_equipment: Object.keys(EQUIP_STATUS), plt_requisitions: Object.keys(REQ_STATUS), plt_allocations: Object.keys(REQ_STATUS) }, uniqueKeys: [{ table: 'plt_requisitions', columns: ['company_id', 'doc_no'] }, { table: 'plt_allocations', columns: ['company_id', 'doc_no'] }, { table: 'plt_equipment', columns: ['company_id', 'doc_no'] }, { table: 'plt_equipment', columns: ['company_id', 'asset_code'] }],
});

export const plant = {
  code: 'plant',
  name: 'Plant, Machinery & Equipment',
  routePrefix: '/api/v1/plant',
  ownerPart: '17.01',
  status: 'Equipment and vehicle register (owned, hired, subcontractor) with approval, documents and statutory certificates with expiry alerts, status and location, history timeline, QR tag, fleet import and the plant dashboard. A mandatory certificate that is missing or has expired blocks allocation and logging.',
  tables: ['plt_equipment', 'plt_documents', 'plt_timeline', 'plt_requisitions', 'plt_allocations', 'plt_operator_assignments'],
  resources: ['equipment', 'documents', 'dashboard', 'requisitions', 'allocations', 'operators', 'availability', 'gantt'],
  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plt_equipment'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment }); const base = createBase({ db }); const svc = createPlantService({ db, base, flags }); const alloc = createAllocService({ db, base, flags, equipment: svc, training: () => trainingOf(db) });
    services.set(db, { svc, alloc, flags, base, equipmentDecide: svc.equipment.decide, reqDecide: alloc.requisitions.decide, allocDecide: alloc.allocations.decide });
    listExports.register('plant.requisitions', { source: (actor, req) => { base.need(actor, 'plant.requisition.export', 'export requisitions'); return alloc.requisitions.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('plant.allocations', { source: (actor, req) => { base.need(actor, 'plant.allocation.export', 'export allocations'); return alloc.allocations.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('plant.equipment', { source: (actor, req) => { base.need(actor, 'plant.equipment.export', 'export the equipment register'); return svc.equipment.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    const runtime = runtimeOf(db);
    runtime?.jobs?.register('plant.cert_expiry_daily', (ctx) => { const n = svc.documents.sweep(); ctx.log(`Told about ${n} certificate(s) expired or expiring`); return { told: n }; }, { maxAttempts: 2, description: 'Statutory certificates of equipment that have expired or expire soon' });
    runtime?.scheduler?.define({ code: 'plant.cert_expiry_morning', cron: '0 2 * * *', jobType: 'plant.cert_expiry_daily', description: 'Every morning 07:30 India time: certificates that expired or expire soon are told to the plant managers' });
    api.use('/plant', plantRoutes(svc, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags, alloc }));
  },
};

const approver = (code, name, role, slaHours, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours, requireAttachment: false, checklist: [], when, notify: [], action: null });
const eqLine = (db, id) => db.prepare('SELECT x.*, i.code AS icode, i.name AS iname FROM plt_equipment x JOIN mdm_items i ON i.id = x.class_item_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: PLANT_EQUIP_DOC, label: 'Equipment registration', processOwner: 'PLANTMGR', route: (id) => `/plant/equipment?id=${id}`,
  describe(db, companyId, id) { const e = eqLine(db, Number(id)); return e && e.company_id === companyId ? { ref: e.doc_no, title: `${e.doc_no} ${e.asset_code}: ${e.icode} ${e.iname}`, originator: e.requested_by, amount: e.purchase_value, projectId: e.org_project_id ?? undefined, siteId: e.org_site_id ?? undefined } : null; },
  summarise(db, _actor, id) { const e = eqLine(db, Number(id)); if (!e) return null; return { fields: [{ label: 'Asset code', value: e.asset_code }, { label: 'Class', value: `${e.icode} ${e.iname}` }, { label: 'Make / model', value: `${e.make ?? '-'} / ${e.model ?? '-'}` }, { label: 'Registration', value: e.reg_no ?? '-' }, { label: 'Ownership', value: e.ownership }, { label: 'Purchase value', value: String(e.purchase_value / 100) }, { label: 'Fuel norm', value: `${e.fuel_norm / 1000} ${e.fuel_norm_unit === 'L_PER_HOUR' ? 'l/h' : 'km/l'}` }] }; },
  defaultDefinition: { name: 'Equipment registration: the plant manager; an owned asset also accounts (capitalisation)', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('PLANTMGR', 'Plant manager', 'PLANTMGR', 24), approver('ACCMGR', 'Accounts manager (capitalisation of an owned asset)', 'ACCMGR', 48, { field: 'needAcc', op: 'eq', value: 'yes' })] },
  hooks: {
    onApproved: (db, { instance, actor }) => plantOf(db)?.equipmentDecide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => plantOf(db)?.equipmentDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => plantOf(db)?.equipmentDecide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => plantOf(db)?.equipmentDecide(instance, actor, 'CANCELLED', comment),
  },
});
objectTypes.register({
  type: 'plt_equipment', label: 'Equipment', permission: 'plant.equipment.view', route: (id) => `/plant/equipment?id=${id}`, attachmentEntity: 'plt_equipment', approvalTarget: 'plt_equipment',
  access(db, actor, id) { const s = plantOf(db); if (!s) return null; try { const e = s.svc.equipment.get(actor, Number(id)); return { companyId: actor.companyId, projectId: e.projectId ?? undefined, siteId: e.siteId ?? undefined, status: e.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'plt_equipment', id }],
  summary(db, actor, id) { const s = plantOf(db); if (!s) return null; try { const e = s.svc.equipment.get(actor, Number(id)); return { label: `${e.assetCode} ${e.class}`, status: e.status }; } catch { return null; } },
  related(db, actor, id) { const s = plantOf(db); if (!s) return []; try { const e = s.svc.equipment.get(actor, Number(id)); return [{ kind: 'equipment class', label: e.class, route: `/mdm/items?id=${e.classItemId}` }, ...(e.ownerPartnerId ? [{ kind: 'owner', label: e.owner, route: `/mdm/partners?id=${e.ownerPartnerId}` }] : [])]; } catch { return []; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'plant.equipment.view').allowed) return []; return db.prepare('SELECT id, org_project_id, org_site_id FROM plt_equipment WHERE company_id = ? AND deleted_at IS NULL AND (asset_code LIKE ? OR reg_no LIKE ? OR doc_no LIKE ?) ORDER BY id DESC LIMIT ?').all(actor.companyId, `%${q}%`, `%${q}%`, `%${q}%`, limit).filter((x) => authzOf(db).check(actor, 'plant.equipment.view', { companyId: actor.companyId, projectId: x.org_project_id, siteId: x.org_site_id }).allowed).map((x) => x.id); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare('SELECT id FROM plt_equipment WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((x) => x.id); },
});
const fileAccess = (table, view, edit, lock) => (db, actor, id) => {
  const r = table === 'plt_equipment' ? db.prepare('SELECT company_id, org_project_id AS pid, org_site_id AS sid, status FROM plt_equipment WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId)
    : db.prepare('SELECT d.company_id, e.org_project_id AS pid, e.org_site_id AS sid, e.status FROM plt_documents d JOIN plt_equipment e ON e.id = d.equipment_id WHERE d.id = ? AND d.company_id = ? AND d.deleted_at IS NULL').get(Number(id), actor.companyId);
  if (!r) return null; const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.pid, siteId: r.sid }).allowed; if (!at(view)) return null;
  return { companyId: r.company_id, projectId: r.pid ?? undefined, siteId: r.sid ?? undefined, canView: true, canEdit: edit.some(at), locked: lock };
};
fileEntities.register({ entity: 'plt_equipment', label: 'Equipment (photographs)', resolve: fileAccess('plt_equipment', 'plant.equipment.view', ['plant.equipment.edit', 'plant.document.manage'], false) });
fileEntities.register({ entity: 'plt_documents', label: 'Equipment certificate (scan)', resolve: fileAccess('plt_documents', 'plant.equipment.view', ['plant.document.manage'], false) });
void EQUIP_STATE;

// ---- requisition and allocation approvals (part 17.02) -------------------------------------------------------------------------------------------------------------------------------------------------------
const rqLine = (db, id) => db.prepare('SELECT x.*, p.code AS pcode, i.code AS icode, i.name AS iname FROM plt_requisitions x JOIN org_projects p ON p.id = x.org_project_id JOIN mdm_items i ON i.id = x.class_item_id WHERE x.id = ?').get(id);
const hookOf = (fn) => ({ onApproved: (db, { instance, actor }) => plantOf(db)?.[fn](instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => plantOf(db)?.[fn](instance, actor, 'REJECTED', comment), onReturned: (db, { instance, actor, comment }) => plantOf(db)?.[fn](instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => plantOf(db)?.[fn](instance, actor, 'CANCELLED', comment) });
workflowTypes.register({
  docType: PLANT_REQ_DOC, label: 'Equipment requisition', processOwner: 'PLANTMGR', route: (id) => `/plant/requisitions?id=${id}`,
  describe(db, companyId, id) { const r = rqLine(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.doc_no} ${r.pcode}: ${r.qty} x ${r.icode} ${r.iname}`, originator: r.requested_by, projectId: r.org_project_id, siteId: r.org_site_id ?? undefined } : null; },
  summarise(db, _actor, id) { const r = rqLine(db, Number(id)); if (!r) return null; return { fields: [{ label: 'Project', value: r.pcode }, { label: 'Class', value: `${r.icode} ${r.iname}` }, { label: 'Capacity', value: r.capacity ?? '-' }, { label: 'Quantity', value: String(r.qty) }, { label: 'Period', value: `${r.from_date} to ${r.to_date}` }, { label: 'Purpose', value: r.purpose }, { label: 'Priority', value: r.priority }] }; },
  defaultDefinition: { name: 'Equipment requisition: the construction manager, then the project manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('CM', 'Construction manager', 'CM', 24), approver('PM', 'Project manager', 'PM', 48)] }, hooks: hookOf('reqDecide'),
});
const alLine = (db, id) => db.prepare('SELECT x.*, e.asset_code, p.code AS pcode FROM plt_allocations x JOIN plt_equipment e ON e.id = x.equipment_id JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: PLANT_ALLOC_DOC, label: 'Equipment allocation or transfer', processOwner: 'PLANTMGR', route: (id) => `/plant/allocations?id=${id}`,
  describe(db, companyId, id) { const a = alLine(db, Number(id)); return a && a.company_id === companyId ? { ref: a.doc_no, title: `${a.doc_no} ${a.asset_code} to ${a.pcode}${a.alloc_kind === 'TRANSFER' ? ' (transfer)' : ''}`, originator: a.requested_by, amount: a.estimated_amount, projectId: a.org_project_id, siteId: a.org_site_id ?? undefined } : null; },
  summarise(db, _actor, id) { const a = alLine(db, Number(id)); if (!a) return null; return { fields: [{ label: 'Equipment', value: a.asset_code }, { label: 'To', value: a.pcode }, { label: 'Kind', value: a.alloc_kind === 'TRANSFER' ? 'Transfer' : 'Allocation' }, { label: 'Period', value: `${a.from_date} to ${a.to_date}` }, { label: 'Source', value: a.source === 'OWN' ? 'Own fleet' : 'Hired in' }, { label: 'Internal rate', value: `${a.internal_rate / 100} ${a.charge_basis.toLowerCase()}` }, ...(a.transfer_reason ? [{ label: 'Why moved', value: a.transfer_reason }] : [])] }; },
  defaultDefinition: { name: 'Allocation: the project manager of the project; a transfer between projects also the project manager of the source and the plant manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('PM_FROM', 'Project manager of the source (transfer between projects)', 'PM', 24, { field: 'needPmFrom', op: 'eq', value: 'yes' }), approver('PM', 'Project manager', 'PM', 48), approver('PLANTMGR', 'Plant manager (transfer between projects)', 'PLANTMGR', 48, { field: 'needPlant', op: 'eq', value: 'yes' })] }, hooks: hookOf('allocDecide'),
});
objectTypes.register({
  type: 'plt_requisition', label: 'Equipment requisition', permission: 'plant.requisition.view', route: (id) => `/plant/requisitions?id=${id}`, attachmentEntity: 'plt_requisition', approvalTarget: 'plt_requisition',
  access(db, actor, id) { const s = plantOf(db); if (!s) return null; try { const r = s.alloc.requisitions.get(actor, Number(id)); return { companyId: actor.companyId, projectId: r.projectId, siteId: r.siteId ?? undefined, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'plt_requisitions', id }], summary(db, actor, id) { const s = plantOf(db); if (!s) return null; try { const r = s.alloc.requisitions.get(actor, Number(id)); return { label: `${r.docNo} ${r.class}`, status: r.status }; } catch { return null; } },
  related(db, actor, id) { const s = plantOf(db); if (!s) return []; try { const r = s.alloc.requisitions.get(actor, Number(id)); return r.allocations.map((a) => ({ kind: 'allocation', label: `${a.docNo} ${a.assetCode}`, route: `/plant/allocations?id=${a.id}` })); } catch { return []; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'plant.requisition.view').allowed) return []; return db.prepare('SELECT id, org_project_id, org_site_id FROM plt_requisitions WHERE company_id = ? AND deleted_at IS NULL AND (doc_no LIKE ? OR purpose LIKE ?) ORDER BY id DESC LIMIT ?').all(actor.companyId, `%${q}%`, `%${q}%`, limit).filter((x) => authzOf(db).check(actor, 'plant.requisition.view', { companyId: actor.companyId, projectId: x.org_project_id, siteId: x.org_site_id }).allowed).map((x) => x.id); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare('SELECT id FROM plt_requisitions WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((x) => x.id); },
});
objectTypes.register({
  type: 'plt_allocation', label: 'Equipment allocation', permission: 'plant.allocation.view', route: (id) => `/plant/allocations?id=${id}`, attachmentEntity: 'plt_allocation', approvalTarget: 'plt_allocation',
  access(db, actor, id) { const s = plantOf(db); if (!s) return null; try { const a = s.alloc.allocations.get(actor, Number(id)); return { companyId: actor.companyId, projectId: a.projectId, siteId: a.siteId ?? undefined, status: a.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'plt_allocations', id }], summary(db, actor, id) { const s = plantOf(db); if (!s) return null; try { const a = s.alloc.allocations.get(actor, Number(id)); return { label: `${a.docNo} ${a.assetCode}`, status: a.status }; } catch { return null; } },
  related(db, actor, id) { const s = plantOf(db); if (!s) return []; try { const a = s.alloc.allocations.get(actor, Number(id)); return [{ kind: 'equipment', label: a.assetCode, route: `/plant/equipment?id=${a.equipmentId}` }, ...(a.requisitionId ? [{ kind: 'requisition', label: a.requisition, route: `/plant/requisitions?id=${a.requisitionId}` }] : []), ...(a.transferFromId ? [{ kind: 'transferred from', label: a.transferFrom, route: `/plant/allocations?id=${a.transferFromId}` }] : [])]; } catch { return []; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'plant.allocation.view').allowed) return []; return db.prepare('SELECT id, org_project_id, org_site_id FROM plt_allocations WHERE company_id = ? AND deleted_at IS NULL AND doc_no LIKE ? ORDER BY id DESC LIMIT ?').all(actor.companyId, `%${q}%`, limit).filter((x) => authzOf(db).check(actor, 'plant.allocation.view', { companyId: actor.companyId, projectId: x.org_project_id, siteId: x.org_site_id }).allowed).map((x) => x.id); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare('SELECT id FROM plt_allocations WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((x) => x.id); },
});
void PHASE;
