import { authzOf } from '../../platform/authz/index.js';
import { eventTypes } from '../../platform/events/index.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { fileEntities } from '../../platform/files/entities.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports } from '../../platform/list/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { workflowTypes } from '../../platform/workflow/index.js';
import { createFlagService } from '../core/api.js';
import { createBase } from '../proc/base.js';
import { registerOfflineForm, registerOfflineMaster } from '../eng/offline.js';
import { STATUS } from './flow.js';
import { createInspectService } from './inspect.js';
import { qaRoutes } from './routes.js';

const services = new WeakMap();
export const qaOf = (db) => services.get(db) ?? null;
export const QA_DOCS = { plan: 'QA_QUALITY_PLAN', itp: 'QA_ITP', template: 'QA_TEMPLATE', inspection: 'QA_INSPECTION' };

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['qa.itp.approved', 'An inspection and test plan version was approved and is in force (part 18.01): data { itpId, code, version, activityType, steps }.'],
  ['qa.points.planned', 'An ITP was applied to activities, generating planned inspection points (part 18.01): data { itpId, code, projectId, points, activityIds }. Inspection requests (18.02) are raised against them.'],
  ['qa.template.activated', 'A checklist template version was approved and is in force (part 18.01): data { templateId, code, version, module }.'],
  ['qa.inspection.submitted', 'An inspection was completed and sent for approval (part 18.01): data { inspectionId, docNo, module, template, templateVersion, projectId, siteId, locationId, activityId, waId, itpStepCode, entityType, entityId, result, scorePct, defects [], inspectedBy, inspectedAt }.'],
  ['qa.inspection.approved', 'An inspection was approved (part 18.01): same data as qa.inspection.submitted. Failed items become defects for NCRs (18.04) and snags (18.06).'],
  ['qa.inspection.failed', 'An inspection failed (part 18.01): same data as qa.inspection.submitted; the quality control manager is told and defects can be raised as NCRs (18.04).'],
]) eventTypes.define({ type, version: 1, schema, owner: 'qa', description });

integrityRegistry.register({
  statuses: { qa_quality_plans: Object.keys(STATUS), qa_itps: Object.keys(STATUS), qa_checklist_templates: Object.keys(STATUS), qa_inspections: Object.keys(STATUS) },
  uniqueKeys: [{ table: 'qa_quality_plans', columns: ['company_id', 'doc_no'] }, { table: 'qa_inspections', columns: ['company_id', 'doc_no'] }],
});

export const qa = {
  code: 'qa',
  name: 'Quality Management (QA/QC)',
  routePrefix: '/api/v1/qa',
  ownerPart: '18.01',
  status: 'Quality plans, the ITP library with hold/witness/review/surveillance points applied to activities, versioned checklist templates and inspections with tolerance, photo and signature rules, offline on the phone.',
  tables: ['qa_quality_plans', 'qa_itps', 'qa_checklist_templates', 'qa_inspections', 'qa_inspection_answers', 'qa_planned_points'],
  resources: ['quality-plans', 'itps', 'templates', 'inspections', 'planned-points', 'export'],
  /** Later parts of the module add their routes and services here. */
  parts: new Map(),
  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'qa_inspections'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment }); const base = createBase({ db }); const svc = createInspectService({ db, base, flags });
    const deciders = { [QA_DOCS.plan]: svc.flows.plan.decide, [QA_DOCS.itp]: svc.flows.itp.decide, [QA_DOCS.template]: svc.flows.template.decide, [QA_DOCS.inspection]: svc.flows.inspection.decide };
    const ctx = { svc, base, flags, deciders, parts: {} }; for (const [, make] of qa.parts) make(db, ctx);
    services.set(db, ctx);
    listExports.register('qa.inspections', { source: (actor, req) => { base.need(actor, 'qa.inspection.export', 'export inspections'); return svc.inspections.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('qa.itps', { source: (actor, req) => { base.need(actor, 'qa.itp.export', 'export ITPs'); return svc.itps.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    api.use('/qa', qaRoutes(svc, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags, parts: ctx.parts }));
  },
};

const approver = (code, name, role, slaHours, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours, requireAttachment: false, checklist: [], when, notify: [], action: null });
const decideHook = (docType) => ({ onApproved: (db, { instance, actor }) => qaOf(db)?.deciders[docType](instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => qaOf(db)?.deciders[docType](instance, actor, 'REJECTED', comment), onReturned: (db, { instance, actor, comment }) => qaOf(db)?.deciders[docType](instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => qaOf(db)?.deciders[docType](instance, actor, 'CANCELLED', comment) });
/** Registers the workflow type of an approval document of the module: `table` and `title(row)` describe it in the inbox. */
/** @param {any} o */
export function registerQaWorkflow({ docType, label, table, owner, route, name, steps, title, fields, amount }) {
  workflowTypes.register({
    docType, label, processOwner: owner, route: (id) => `${route}${id}`,
    describe(db, companyId, id) { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no ?? r.code, title: `${r.doc_no ?? r.code} ${title(db, r)}`.slice(0, 300), originator: r.requested_by, amount: amount?.(r), projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined } : null; },
    summarise(db, _actor, id) { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id)); return r ? { fields: fields(db, r) } : null; },
    defaultDefinition: { name, settings: { resubmit: 'first', distinctApprovers: true }, steps },
    hooks: decideHook(docType),
  });
}
const tpl = (db, id) => db.prepare('SELECT code, name, version_no FROM qa_checklist_templates WHERE id = ?').get(id);
registerQaWorkflow({ docType: QA_DOCS.plan, label: 'Quality plan', table: 'qa_quality_plans', owner: 'QCMGR', route: '/qa/quality-plans?id=', name: 'Quality plan: the quality control manager', steps: [approver('QCMGR', 'Quality control manager', 'QCMGR', 48)], title: (_db, r) => r.title, fields: (_db, r) => [{ label: 'Plan', value: r.doc_no }, { label: 'Title', value: r.title }, { label: 'Revision', value: String(r.revision) }] });
registerQaWorkflow({ docType: QA_DOCS.itp, label: 'Inspection and test plan', table: 'qa_itps', owner: 'QCMGR', route: '/qa/itps?id=', name: 'ITP: the quality control manager', steps: [approver('QCMGR', 'Quality control manager', 'QCMGR', 48)], title: (_db, r) => `${r.title} v${r.version_no}`, fields: (_db, r) => [{ label: 'ITP', value: `${r.code} v${r.version_no}` }, { label: 'Activity', value: r.activity_type }, { label: 'Steps', value: String(JSON.parse(r.steps_json).length) }] });
registerQaWorkflow({ docType: QA_DOCS.template, label: 'Checklist template', table: 'qa_checklist_templates', owner: 'QCMGR', route: '/qa/templates?id=', name: 'Checklist template: the owner of its module, then the quality control manager',
  steps: [approver('HSEO', 'HSE officer (HSE checklists)', 'HSEO', 48, { field: 'module', op: 'eq', value: 'HSE' }), approver('PLANTMGR', 'Plant manager (plant checks)', 'PLANTMGR', 48, { field: 'module', op: 'eq', value: 'PLANT' }), approver('STOREMGR', 'Store manager (stores checks)', 'STOREMGR', 48, { field: 'module', op: 'eq', value: 'STORES' }), approver('QCMGR', 'Quality control manager', 'QCMGR', 48)],
  title: (_db, r) => `${r.name} v${r.version_no}`, fields: (_db, r) => [{ label: 'Checklist', value: `${r.code} v${r.version_no}` }, { label: 'Module', value: r.module }, { label: 'Sections', value: String(JSON.parse(r.sections_json).length) }] });
registerQaWorkflow({ docType: QA_DOCS.inspection, label: 'Inspection', table: 'qa_inspections', owner: 'QCMGR', route: '/qa/inspections?id=', name: 'Inspection: the owner of its module (quality control manager for quality, handover and snag)',
  steps: [approver('QCMGR', 'Quality control manager', 'QCMGR', 24, { field: 'module', op: 'in', value: ['QUALITY', 'HANDOVER', 'SNAG'] }), approver('HSEO', 'HSE officer', 'HSEO', 24, { field: 'module', op: 'eq', value: 'HSE' }), approver('PLANTMGR', 'Plant manager', 'PLANTMGR', 24, { field: 'module', op: 'eq', value: 'PLANT' }), approver('STOREMGR', 'Store manager', 'STOREMGR', 24, { field: 'module', op: 'eq', value: 'STORES' })],
  title: (db, r) => `${tpl(db, r.template_id)?.name ?? ''} ${r.result ?? ''}`, fields: (db, r) => [{ label: 'Checklist', value: `${tpl(db, r.template_id)?.name} v${tpl(db, r.template_id)?.version_no}` }, { label: 'Result', value: r.result ?? '-' }, { label: 'Score %', value: r.score_bp == null ? '-' : String(r.score_bp / 100) }, { label: 'Inspected by', value: r.inspected_by }] });

const objectOf = (type, table, perm, route, label) => objectTypes.register({
  type: table, label, permission: `${perm}.view`, route: (id) => `${route}${id}`, attachmentEntity: table, approvalTarget: table,
  access(db, actor, id) { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(Number(id), actor.companyId); if (!r || !authzOf(db).check(actor, `${perm}.view`, { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined }).allowed) return null; return { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined, status: r.status }; },
  auditEntities: (id) => [{ entity: table, id }],
  summary(db, actor, id) { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ?`).get(Number(id), actor.companyId); return r ? { label: `${r.doc_no ?? r.code} ${r.title ?? r.name ?? ''}`.trim(), status: r.status } : null; },
  related: () => [],
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, `${perm}.view`).allowed) return []; const col = table === 'qa_inspections' || table === 'qa_quality_plans' ? 'doc_no' : 'code'; return db.prepare(`SELECT id FROM ${table} WHERE company_id = ? AND deleted_at IS NULL AND ${col} LIKE ? ORDER BY id DESC LIMIT ?`).all(actor.companyId, `%${q}%`, limit).map((x) => x.id); },
  projectRecords(db, companyId, projectId, limit) { return table === 'qa_itps' || table === 'qa_checklist_templates' ? [] : db.prepare(`SELECT id FROM ${table} WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?`).all(companyId, projectId, limit).map((x) => x.id); },
});
void objectOf;
objectOf('plan', 'qa_quality_plans', 'qa.quality_plan', '/qa/quality-plans?id=', 'Quality plan');
objectOf('inspection', 'qa_inspections', 'qa.inspection', '/qa/inspections?id=', 'Inspection');
objectOf('itp', 'qa_itps', 'qa.itp', '/qa/itps?id=', 'Inspection and test plan');
objectOf('template', 'qa_checklist_templates', 'qa.template', '/qa/templates?id=', 'Checklist template');

const fileAccess = (table, perm, edit) => (db, actor, id) => {
  const r = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(Number(id), actor.companyId); if (!r) return null; const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined }).allowed; if (!at(`${perm}.view`)) return null;
  return { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined, canView: true, canEdit: at(`${perm}.${edit}`) && ['DRAFT', 'RETURNED'].includes(r.status), locked: !['DRAFT', 'RETURNED'].includes(r.status) };
};
fileEntities.register({ entity: 'qa_quality_plans', label: 'Quality plan (document)', resolve: fileAccess('qa_quality_plans', 'qa.quality_plan', 'edit') });
fileEntities.register({ entity: 'qa_inspections', label: 'Inspection (photographs and signatures)', resolve: fileAccess('qa_inspections', 'qa.inspection', 'edit') });

// ---- the phone (04.15): the whole inspection is one command; its photographs follow, named <question code>__<anything> ------------------------------------------------------------------------------
const issuesOf = (v) => { const p = []; if (!v.templateId) p.push({ field: 'templateId', message: 'Choose the checklist' }); if (!v.projectId) p.push({ field: 'projectId', message: 'Choose the project' }); if (!Array.isArray(v.answers)) p.push({ field: 'answers', message: 'Answer the checklist' }); return p; };
registerOfflineForm({
  code: 'inspection_checklist', label: 'Inspection checklist', labelHi: 'निरीक्षण चेकलिस्ट', module: '18.01', route: '/qa/perform', permission: 'qa.inspection.create', attachmentEntity: 'qa_inspections',
  fields: [{ key: 'templateId', label: 'Checklist', labelHi: 'चेकलिस्ट', type: 'text', required: true }, { key: 'projectId', label: 'Project', labelHi: 'परियोजना', type: 'text', required: true }],
  rules: () => ({}),
  validate: (values, _rules, op) => (op === 'update' ? [] : issuesOf(values)),
  create: (db, actor, values, ctx) => qaOf(db).svc.inspections.offline.create(actor, values, ctx),
  load: (db, actor, id) => qaOf(db)?.svc.inspections.offline.load(actor, id) ?? null,
  update: (db, actor, id, changes, ctx) => qaOf(db).svc.inspections.offline.update(actor, id, changes, ctx),
});
registerOfflineMaster({
  code: 'qa_templates', label: 'Checklists in force', permission: 'qa.inspection.create',
  rows: (db, actor) => ({ rows: db.prepare("SELECT id, code, name, module, version_no AS versionNo, sections_json AS sections, scoring_json AS scoring FROM qa_checklist_templates WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY name LIMIT 500").all(actor.companyId).map((r) => ({ ...r, sections: JSON.parse(r.sections), scoring: JSON.parse(r.scoring) })), removed: [] }),
});
