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
import { createRequestService, holdGate } from './requests.js';
import { irRoutes } from './ir-routes.js';
import { createTestService } from './tests.js';
import { testRoutes } from './test-routes.js';
import { createNcrService } from './ncr.js';
import { ncrRoutes } from './ncr-routes.js';
import { createPourService } from './pour.js';
import { pourRoutes } from './pour-routes.js';
import { createSnagService } from './snags.js';
import { snagRoutes } from './snag-routes.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { waCheckHooks } from '../site/service.js';
import { qaRoutes } from './routes.js';

const services = new WeakMap();
export const qaOf = (db) => services.get(db) ?? null;
export const QA_DOCS = { pour: 'QA_POUR_CARD', ncrClosure: 'QA_NCR_CLOSURE', ncrConcession: 'QA_NCR_CONCESSION', test: 'QA_TEST', ir: 'QA_IR', plan: 'QA_QUALITY_PLAN', itp: 'QA_ITP', template: 'QA_TEMPLATE', inspection: 'QA_INSPECTION' };

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['qa.itp.approved', 'An inspection and test plan version was approved and is in force (part 18.01): data { itpId, code, version, activityType, steps }.'],
  ['qa.points.planned', 'An ITP was applied to activities, generating planned inspection points (part 18.01): data { itpId, code, projectId, points, activityIds }. Inspection requests (18.02) are raised against them.'],
  ['qa.template.activated', 'A checklist template version was approved and is in force (part 18.01): data { templateId, code, version, module }.'],
  ['qa.inspection.submitted', 'An inspection was completed and sent for approval (part 18.01): data { inspectionId, docNo, module, template, templateVersion, projectId, siteId, locationId, activityId, waId, itpStepCode, entityType, entityId, result, scorePct, defects [], inspectedBy, inspectedAt }.'],
  ['qa.inspection.approved', 'An inspection was approved (part 18.01): same data as qa.inspection.submitted. Failed items become defects for NCRs (18.04) and snags (18.06).'],
  ['qa.ir.raised', 'An inspection request was raised (part 18.02): data { requestId, docNo, projectId, siteId, locationId, activityId, waId, plannedPointId, itpStepCode, pointType, holdPoint, consultantRequired, reinspectionOfId, requestedFor }.'],
  ['qa.ir.approved', 'An inspection request was approved by the quality engineer (and the consultant when required), with or without comments (part 18.02): same data as qa.ir.raised plus result. A hold point released here lets the next activities start: work authorisations (14.01) and measurement lines (22.01) read it.'],
  ['qa.ir.rejected', 'An inspection request was rejected (part 18.02): same data as qa.ir.approved plus reasonCode. A re-inspection request linked to it is needed (BR-01).'],
  ['qa.material.accepted', 'Material under inspection was accepted after its test or receiving check, by result or by concession (part 18.03): data { requestId, docNo, projectId, grnId, grnLineId, grnNo, itemId, item, vendorId, qty, uom, test, result, outcome, concessionRef, sampleRef }. The quantity is released from the inspection stock (16.01, 16.03); the vendor quality score (15.08) reads it.'],
  ['qa.material.rejected', 'Material under inspection failed its test and no concession was approved (part 18.03): same data as qa.material.accepted. It stays held in the inspection stock until it is returned to the vendor (16.03); the vendor quality score (15.08) reads it.'],
  ['qa.calibration.overdue', 'Laboratory equipment passed its calibration due date and cannot be used for tests (part 18.03): data { equipmentId, code, dueOn, daysOverdue }.'],
  ['qa.ncr.raised', 'A non-conformance report was raised (part 18.04): data { ncrId, docNo, projectId, siteId, locationId, activityId, severity, type, responsibleType, partnerId, originKind, originId, disposition, status }.'],
  ['qa.ncr.rectified', 'The responsible party reported an NCR as rectified (part 18.04): same data as qa.ncr.raised.'],
  ['qa.ncr.concession_approved', 'A use-as-is concession was approved by the quality control manager and the consultant (part 18.04): same data as qa.ncr.raised plus concessionReason.'],
  ['qa.ncr.closed', 'An NCR was closed after a verified re-inspection (or an approved concession) and all actions done (part 18.04): same data as qa.ncr.raised plus closedAt, ageDays. Quality KPIs (18.07) and the detection tower (27.09) read it.'],
  ['qa.ncr.backcharge_raised', 'A closed NCR carries a back-charge against a subcontractor or supplier (part 18.04): data { ncrId, docNo, projectId, responsibleType, partnerId, rectificationCost, amount (rupees), severity }. Subcontractor bills (22.05) deduct it and vendor debit notes (23.03) take it.'],
  ['qa.capa.overdue', 'A corrective or preventive action passed its due date (part 18.04): data { capaId, ncrId, docNo, owner, dueDate, type }.'],
  ['qa.pour.approved', 'A concrete pour card was approved: the pour may start (part 18.05): data { pourCardId, docNo, projectId, siteId, locationId, activityId, element, grade, fck, plannedVolume, actualVolume, pourStatus }. The batching plant (20.01) and ready-mix (20.02) read it.'],
  ['qa.pour.completed', 'A concrete pour was completed (part 18.05): same data as qa.pour.approved, with the volume poured.'],
  ['qa.cube.tested', 'A cube result was recorded at an age (part 18.05): data { sampleId, sampleNo, resultId, pourCardId, pourNo, projectId, element, grade, fck, ageDays, mean, lowest, acceptance }. The quality dashboard (18.07) reads it.'],
  ['qa.cube.failed', 'A cube result failed IS 456, individually or as a group of four (part 18.05): same data as qa.cube.tested plus reason (INDIVIDUAL|GROUP), required, groupMean. An NCR (18.04) with core tests or a load test follows.'],
  ['qa.snag.raised', 'A snag was raised on a plan or in a room (part 18.06): data { snagId, docNo, projectId, siteId, locationId, unitRef, category, punchClass, priority, responsibleType, partnerId, dueDate, status, raisedKind }.'],
  ['qa.snag.rectified', 'The responsible party reported a snag rectified, with an after-photograph (part 18.06): same data as qa.snag.raised.'],
  ['qa.snag.closed', 'A snag was verified and closed by someone other than the person who rectified it (part 18.06): same data as qa.snag.raised plus closedOn, ageDays, reopenCount. Handover (26.02) and commissioning (26.01) read the open punches; the quality dashboard (18.07) the closure.'],
  ['qa.snag.reopened', 'A rectification did not hold and the snag went back to its party (part 18.06): same data plus reason, reopenCount.'],
  ['qa.snag.backcharge_raised', 'A closed snag carries a back-charge against a subcontractor or supplier (part 18.06): data { snagId, docNo, projectId, responsibleType, partnerId, amount (rupees) }. Subcontractor bills (22.05) deduct it.'],
  ['qa.inspection.failed', 'An inspection failed (part 18.01): same data as qa.inspection.submitted; the quality control manager is told and defects can be raised as NCRs (18.04).'],
]) eventTypes.define({ type, version: 1, schema, owner: 'qa', description });

integrityRegistry.register({
  statuses: { qa_quality_plans: Object.keys(STATUS), qa_itps: Object.keys(STATUS), qa_checklist_templates: Object.keys(STATUS), qa_inspections: Object.keys(STATUS), qa_inspection_requests: Object.keys(STATUS), qa_test_requests: Object.keys(STATUS), qa_pour_cards: Object.keys(STATUS), qa_snags: ['OPEN', 'RECTIFIED', 'CLOSED', 'CANCELLED'], qa_ncrs: ['DRAFT', 'OPEN', 'RECTIFIED', 'CONCESSION_REVIEW', 'CLOSURE_REVIEW', 'CLOSED', 'CANCELLED'] },
  uniqueKeys: [{ table: 'qa_quality_plans', columns: ['company_id', 'doc_no'] }, { table: 'qa_inspections', columns: ['company_id', 'doc_no'] }, { table: 'qa_inspection_requests', columns: ['company_id', 'doc_no'] }, { table: 'qa_test_requests', columns: ['company_id', 'doc_no'] }, { table: 'qa_ncrs', columns: ['company_id', 'doc_no'] }, { table: 'qa_pour_cards', columns: ['company_id', 'doc_no'] }, { table: 'qa_snags', columns: ['company_id', 'doc_no'] }, { table: 'qa_cube_samples', columns: ['company_id', 'doc_no'] }, { table: 'qa_test_catalogue', columns: ['company_id', 'code'] }, { table: 'qa_lab_equipment', columns: ['company_id', 'code'] }],
});

export const qa = {
  code: 'qa',
  name: 'Quality Management (QA/QC)',
  routePrefix: '/api/v1/qa',
  ownerPart: '18.01',
  status: 'Quality plans, the ITP library with hold/witness/review/surveillance points applied to activities, versioned checklist templates and inspections with tolerance, photo and signature rules, offline on the phone.',
  tables: ['qa_snags', 'qa_pour_cards', 'qa_pour_tickets', 'qa_cube_samples', 'qa_cube_results', 'qa_ncrs', 'qa_capa_actions', 'qa_test_catalogue', 'qa_lab_equipment', 'qa_test_requests', 'qa_test_results', 'qa_inspection_requests', 'qa_quality_plans', 'qa_itps', 'qa_checklist_templates', 'qa_inspections', 'qa_inspection_answers', 'qa_planned_points'],
  resources: ['snags', 'snag-status', 'snag-report', 'pour-cards', 'cube-samples', 'cube-results', 'concrete-acceptance', 'concrete-traceability', 'ncrs', 'ncr-analysis', 'test-requests', 'test-catalogue', 'lab-equipment', 'receiving', 'test-compliance', 'inspection-requests', 'hold-points', 'ir-analysis', 'quality-plans', 'itps', 'templates', 'inspections', 'planned-points', 'export'],
  /** Later parts of the module add their routes and services here. */
  parts: new Map(),
  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'qa_inspections'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment }); const base = createBase({ db }); const svc = createInspectService({ db, base, flags });
    const deciders = { [QA_DOCS.plan]: svc.flows.plan.decide, [QA_DOCS.itp]: svc.flows.itp.decide, [QA_DOCS.template]: svc.flows.template.decide, [QA_DOCS.inspection]: svc.flows.inspection.decide };
    const irs = createRequestService({ db, base, flags }); deciders[QA_DOCS.ir] = irs.flow.decide;
    const tsv = createTestService({ db, base, flags }); deciders[QA_DOCS.test] = tsv.flow.decide;
    const ncv = createNcrService({ db, base, flags }); deciders[QA_DOCS.ncrClosure] = ncv.decides.QA_NCR_CLOSURE; deciders[QA_DOCS.ncrConcession] = ncv.decides.QA_NCR_CONCESSION;
    const pov = createPourService({ db, base, flags, ncv: () => ncv }); deciders[QA_DOCS.pour] = pov.flow.decide;
    const sgv = createSnagService({ db, base, flags });
    const ctx = { svc, base, flags, deciders, irs, tsv, ncv, pov, sgv, parts: { snag: (r, h) => snagRoutes(r, sgv, h), pour: (r, h) => pourRoutes(r, pov, h), ncr: (r, h) => ncrRoutes(r, ncv, h), ir: (r, h) => irRoutes(r, irs, h), tests: (r, h) => testRoutes(r, tsv, h) } }; for (const [, make] of qa.parts) make(db, ctx);
    services.set(db, ctx);
    listExports.register('qa.inspections', { source: (actor, req) => { base.need(actor, 'qa.inspection.export', 'export inspections'); return svc.inspections.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('qa.inspection_requests', { source: (actor, req) => { base.need(actor, 'qa.inspection_request.export', 'export inspection requests'); return irs.requests.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('qa.test_requests', { source: (actor, req) => { base.need(actor, 'qa.test_request.export', 'export test requests'); return tsv.requests.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('qa.ncrs', { source: (actor, req) => { base.need(actor, 'qa.ncr.export', 'export NCRs'); return ncv.ncrs.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('qa.pour_cards', { source: (actor, req) => { base.need(actor, 'qa.pour_card.export', 'export pour cards'); return pov.cards.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('qa.snags', { source: (actor, req) => { base.need(actor, 'qa.snag.export', 'export snags'); return sgv.snags.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    const runtime = runtimeOf(db);
    runtime?.jobs?.register('qa.snag_sweep', (jctx) => { let told = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) told += sgv.sweep(c.id).told; jctx.log(`Told about ${told} snag(s) past their date`); return { told }; }, { maxAttempts: 2, description: 'Snags past their due date, told to the plant and quality supervisors' });
    runtime?.scheduler?.define({ code: 'qa.snag_sweep_morning', cron: '55 2 * * *', jobType: 'qa.snag_sweep', description: 'Every morning 08:25 India time: overdue snags are told' });
    runtime?.jobs?.register('qa.cube_sweep', (jctx) => { let told = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) told += pov.sweep(c.id).told; jctx.log(`Told about ${told} cube test(s) due or overdue`); return { told }; }, { maxAttempts: 2, description: 'Cube tests due today or overdue, told to the quality engineers' });
    runtime?.scheduler?.define({ code: 'qa.cube_sweep_morning', cron: '50 2 * * *', jobType: 'qa.cube_sweep', description: 'Every morning 08:20 India time: cube tests due or overdue are told' });
    runtime?.jobs?.register('qa.ncr_sweep', (jctx) => { let told = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) told += ncv.sweep(c.id).told; jctx.log(`Told about ${told} overdue action(s)`); return { told }; }, { maxAttempts: 2, description: 'Corrective and preventive actions past their date, told to their owners and the quality control manager' });
    runtime?.scheduler?.define({ code: 'qa.ncr_sweep_morning', cron: '40 2 * * *', jobType: 'qa.ncr_sweep', description: 'Every morning 08:10 India time: overdue corrective and preventive actions are told' });
    runtime?.jobs?.register('qa.lab_sweep', (jctx) => { let told = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) told += tsv.sweep(c.id).told; jctx.log(`Told about ${told} equipment due or overdue for calibration`); return { told }; }, { maxAttempts: 2, description: 'Laboratory equipment whose calibration is overdue or due soon, told to the quality team' });
    runtime?.scheduler?.define({ code: 'qa.lab_sweep_morning', cron: '20 2 * * *', jobType: 'qa.lab_sweep', description: 'Every morning 07:50 India time: calibration due or overdue is told' });
    listExports.register('qa.itps', { source: (actor, req) => { base.need(actor, 'qa.itp.export', 'export ITPs'); return svc.itps.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    api.use('/qa', qaRoutes(svc, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags, parts: ctx.parts }));
  },
};

const approver = (code, name, role, slaHours, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours, requireAttachment: false, checklist: [], when, notify: [], action: null });
const decideHook = (docType) => ({ onApproved: (db, { instance, actor, comment }) => qaOf(db)?.deciders[docType](instance, actor, 'APPROVED', comment), onRejected: (db, { instance, actor, comment }) => qaOf(db)?.deciders[docType](instance, actor, 'REJECTED', comment), onReturned: (db, { instance, actor, comment }) => qaOf(db)?.deciders[docType](instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => qaOf(db)?.deciders[docType](instance, actor, 'CANCELLED', comment) });
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
// the work authorisation (14.01) is stopped while a hold point before its activity is not released (part 18.02, BR-01)
waCheckHooks.push((db, r) => { if (!r.activity_id) return null; const pts = holdGate(db, { activityId: r.activity_id, locationId: r.location_id ?? null }); if (!pts.length) return null; return { code: 'HOLD_POINT', result: 'FAIL', message: `Hold point ${pts.map((p) => `${p.activityCode} ${p.stepCode}`).join(', ')} is not released: raise and clear an inspection request (18.02).` }; });
const tpl = (db, id) => db.prepare('SELECT code, name, version_no FROM qa_checklist_templates WHERE id = ?').get(id);
registerQaWorkflow({ docType: QA_DOCS.plan, label: 'Quality plan', table: 'qa_quality_plans', owner: 'QCMGR', route: '/qa/quality-plans?id=', name: 'Quality plan: the quality control manager', steps: [approver('QCMGR', 'Quality control manager', 'QCMGR', 48)], title: (_db, r) => r.title, fields: (_db, r) => [{ label: 'Plan', value: r.doc_no }, { label: 'Title', value: r.title }, { label: 'Revision', value: String(r.revision) }] });
registerQaWorkflow({ docType: QA_DOCS.itp, label: 'Inspection and test plan', table: 'qa_itps', owner: 'QCMGR', route: '/qa/itps?id=', name: 'ITP: the quality control manager', steps: [approver('QCMGR', 'Quality control manager', 'QCMGR', 48)], title: (_db, r) => `${r.title} v${r.version_no}`, fields: (_db, r) => [{ label: 'ITP', value: `${r.code} v${r.version_no}` }, { label: 'Activity', value: r.activity_type }, { label: 'Steps', value: String(JSON.parse(r.steps_json).length) }] });
registerQaWorkflow({ docType: QA_DOCS.template, label: 'Checklist template', table: 'qa_checklist_templates', owner: 'QCMGR', route: '/qa/templates?id=', name: 'Checklist template: the owner of its module, then the quality control manager',
  steps: [approver('HSEO', 'HSE officer (HSE checklists)', 'HSEO', 48, { field: 'module', op: 'eq', value: 'HSE' }), approver('PLANTMGR', 'Plant manager (plant checks)', 'PLANTMGR', 48, { field: 'module', op: 'eq', value: 'PLANT' }), approver('STOREMGR', 'Store manager (stores checks)', 'STOREMGR', 48, { field: 'module', op: 'eq', value: 'STORES' }), approver('QCMGR', 'Quality control manager', 'QCMGR', 48)],
  title: (_db, r) => `${r.name} v${r.version_no}`, fields: (_db, r) => [{ label: 'Checklist', value: `${r.code} v${r.version_no}` }, { label: 'Module', value: r.module }, { label: 'Sections', value: String(JSON.parse(r.sections_json).length) }] });
registerQaWorkflow({ docType: QA_DOCS.inspection, label: 'Inspection', table: 'qa_inspections', owner: 'QCMGR', route: '/qa/inspections?id=', name: 'Inspection: the owner of its module (quality control manager for quality, handover and snag)',
  steps: [approver('QCMGR', 'Quality control manager', 'QCMGR', 24, { field: 'module', op: 'in', value: ['QUALITY', 'HANDOVER', 'SNAG'] }), approver('HSEO', 'HSE officer', 'HSEO', 24, { field: 'module', op: 'eq', value: 'HSE' }), approver('PLANTMGR', 'Plant manager', 'PLANTMGR', 24, { field: 'module', op: 'eq', value: 'PLANT' }), approver('STOREMGR', 'Store manager', 'STOREMGR', 24, { field: 'module', op: 'eq', value: 'STORES' })],
  title: (db, r) => `${tpl(db, r.template_id)?.name ?? ''} ${r.result ?? ''}`, fields: (db, r) => [{ label: 'Checklist', value: `${tpl(db, r.template_id)?.name} v${tpl(db, r.template_id)?.version_no}` }, { label: 'Result', value: r.result ?? '-' }, { label: 'Score %', value: r.score_bp == null ? '-' : String(r.score_bp / 100) }, { label: 'Inspected by', value: r.inspected_by }] });

registerQaWorkflow({ docType: QA_DOCS.ir, label: 'Inspection request', table: 'qa_inspection_requests', owner: 'QCE', route: '/qa/inspection-requests?id=', name: 'Inspection request: the quality engineer inspects; the consultant also, when required',
  steps: [approver('QCE', 'Quality engineer (inspection)', 'QCE', 24), approver('XCON', 'Consultant', 'X-CON', 48, { field: 'consultant', op: 'eq', value: 'yes' })],
  title: (_db, r) => r.description, fields: (_db, r) => [{ label: 'Request', value: r.doc_no }, { label: 'What', value: r.description }, { label: 'Point', value: r.point_type }, { label: 'Wanted for', value: r.requested_for }] });
registerQaWorkflow({ docType: QA_DOCS.test, label: 'Material test', table: 'qa_test_requests', owner: 'QCE', route: '/qa/test-requests?id=', name: 'Material test: the quality engineer verifies; the quality control manager also when a failed result is accepted by concession',
  steps: [approver('QCE', 'Quality engineer (verification)', 'QCE', 24), approver('QCMGR', 'Quality control manager (concession)', 'QCMGR', 24, { field: 'concession', op: 'eq', value: 'yes' })],
  title: (_db, r) => `${r.sample_ref ?? ''} ${r.result ?? ''}`, fields: (_db, r) => [{ label: 'Request', value: r.doc_no }, { label: 'Sample', value: r.sample_ref ?? '-' }, { label: 'Result', value: r.result ?? '-' }, { label: 'Concession', value: r.concession_ref ?? '-' }] });
registerQaWorkflow({ docType: QA_DOCS.ncrClosure, label: 'NCR closure', table: 'qa_ncrs', owner: 'QCMGR', route: '/qa/ncrs?id=', name: 'NCR closure by severity: the quality engineer; a major also the quality control manager; a critical also the project director',
  steps: [approver('QCE', 'Quality engineer', 'QCE', 24), approver('QCMGR', 'Quality control manager (major and critical)', 'QCMGR', 24, { field: 'severity', op: 'in', value: ['MAJOR', 'CRITICAL'] }), approver('PD', 'Project director (critical)', 'PD', 48, { field: 'severity', op: 'eq', value: 'CRITICAL' })],
  title: (_db, r) => r.description, fields: (_db, r) => [{ label: 'NCR', value: r.doc_no }, { label: 'Severity', value: r.severity }, { label: 'Disposition', value: r.disposition ?? '-' }, { label: 'Description', value: r.description }] });
registerQaWorkflow({ docType: QA_DOCS.ncrConcession, label: 'NCR concession', table: 'qa_ncrs', owner: 'QCMGR', route: '/qa/ncrs?id=', name: 'Use-as-is concession: the quality control manager, then the consultant',
  steps: [approver('QCMGR', 'Quality control manager', 'QCMGR', 24), approver('XCON', 'Consultant', 'X-CON', 48)],
  title: (_db, r) => r.description, fields: (_db, r) => [{ label: 'NCR', value: r.doc_no }, { label: 'Severity', value: r.severity }, { label: 'Reason for the concession', value: r.concession_reason ?? '-' }] });
registerQaWorkflow({ docType: QA_DOCS.pour, label: 'Concrete pour card', table: 'qa_pour_cards', owner: 'QCE', route: '/qa/pour-cards?id=', name: 'Pour card: the quality engineer, then the construction manager',
  steps: [approver('QCE', 'Quality engineer', 'QCE', 12), approver('CM', 'Construction manager', 'CM', 12)],
  title: (_db, r) => `${r.element} ${r.grade}`, fields: (_db, r) => [{ label: 'Pour card', value: r.doc_no }, { label: 'Element', value: r.element }, { label: 'Grade', value: r.grade }, { label: 'Planned volume (m3)', value: String(r.planned_volume / 1000) }] });
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
objectOf('snag', 'qa_snags', 'qa.snag', '/qa/snags?id=', 'Snag');
objectOf('pour', 'qa_pour_cards', 'qa.pour_card', '/qa/pour-cards?id=', 'Concrete pour card');
objectOf('ncr', 'qa_ncrs', 'qa.ncr', '/qa/ncrs?id=', 'Non-conformance report');
objectOf('test', 'qa_test_requests', 'qa.test_request', '/qa/test-requests?id=', 'Material test');
objectOf('ir', 'qa_inspection_requests', 'qa.inspection_request', '/qa/inspection-requests?id=', 'Inspection request');
objectOf('plan', 'qa_quality_plans', 'qa.quality_plan', '/qa/quality-plans?id=', 'Quality plan');
objectOf('inspection', 'qa_inspections', 'qa.inspection', '/qa/inspections?id=', 'Inspection');
objectOf('itp', 'qa_itps', 'qa.itp', '/qa/itps?id=', 'Inspection and test plan');
objectOf('template', 'qa_checklist_templates', 'qa.template', '/qa/templates?id=', 'Checklist template');

const fileAccess = (table, perm, edit) => (db, actor, id) => {
  const r = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(Number(id), actor.companyId); if (!r) return null; const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined }).allowed; if (!at(`${perm}.view`)) return null;
  return { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined, canView: true, canEdit: at(`${perm}.${edit}`) && ['DRAFT', 'RETURNED'].includes(r.status), locked: !['DRAFT', 'RETURNED'].includes(r.status) };
};
fileEntities.register({ entity: 'qa_quality_plans', label: 'Quality plan (document)', resolve: fileAccess('qa_quality_plans', 'qa.quality_plan', 'edit') });
fileEntities.register({ entity: 'qa_snags', label: 'Snag (before and after photographs)', resolve: (db, actor, id) => { const r = db.prepare('SELECT * FROM qa_snags WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null; const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id, siteId: r.org_site_id ?? undefined }).allowed; if (!at('qa.snag.view')) return null; return { companyId: r.company_id, projectId: r.org_project_id, siteId: r.org_site_id ?? undefined, canView: true, canEdit: at('qa.snag.create') || at('qa.snag.edit') || at('qa.snag.submit'), locked: ['CLOSED', 'CANCELLED'].includes(r.status) }; } });
fileEntities.register({ entity: 'qa_pour_cards', label: 'Concrete pour card (photographs)', resolve: (db, actor, id) => { const r = db.prepare('SELECT * FROM qa_pour_cards WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null; const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id, siteId: r.org_site_id ?? undefined }).allowed; if (!at('qa.pour_card.view')) return null; return { companyId: r.company_id, projectId: r.org_project_id, siteId: r.org_site_id ?? undefined, canView: true, canEdit: at('qa.pour_card.edit') || at('qa.pour_card.record'), locked: r.pour_status === 'COMPLETED' }; } });
fileEntities.register({ entity: 'qa_ncrs', label: 'NCR (photographs and evidence)', resolve: (db, actor, id) => { const r = db.prepare('SELECT * FROM qa_ncrs WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null; const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id, siteId: r.org_site_id ?? undefined }).allowed; if (!at('qa.ncr.view')) return null; return { companyId: r.company_id, projectId: r.org_project_id, siteId: r.org_site_id ?? undefined, canView: true, canEdit: (at('qa.ncr.edit') || at('qa.ncr.rectify') || at('qa.ncr.create')) && !['CLOSED', 'CANCELLED'].includes(r.status), locked: ['CLOSED', 'CANCELLED'].includes(r.status) }; } });
fileEntities.register({ entity: 'qa_capa_actions', label: 'Corrective or preventive action (evidence)', resolve: (db, actor, id) => { const c = db.prepare('SELECT c.*, n.org_project_id AS pid, n.org_site_id AS sid FROM qa_capa_actions c JOIN qa_ncrs n ON n.id = c.ncr_id WHERE c.id = ? AND c.company_id = ? AND c.deleted_at IS NULL').get(Number(id), actor.companyId); if (!c) return null; const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: c.company_id, projectId: c.pid, siteId: c.sid ?? undefined }).allowed; if (!at('qa.ncr.view')) return null; return { companyId: c.company_id, projectId: c.pid, siteId: c.sid ?? undefined, canView: true, canEdit: c.owner_user === actor.user || at('qa.ncr.edit') || at('qa.ncr.rectify'), locked: c.status !== 'OPEN' }; } });
fileEntities.register({ entity: 'qa_test_requests', label: 'Material test (laboratory certificate)', resolve: fileAccess('qa_test_requests', 'qa.test_request', 'edit') });
fileEntities.register({ entity: 'qa_lab_equipment', label: 'Laboratory equipment (calibration certificate)', resolve: (db, actor, id) => { const r = db.prepare('SELECT * FROM qa_lab_equipment WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null; const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined }).allowed; if (!at('qa.lab_equipment.view')) return null; return { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined, canView: true, canEdit: at('qa.lab_equipment.calibrate') || at('qa.lab_equipment.edit'), locked: false }; } });
fileEntities.register({ entity: 'qa_inspection_requests', label: 'Inspection request (photographs and records)', resolve: fileAccess('qa_inspection_requests', 'qa.inspection_request', 'edit') });
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
