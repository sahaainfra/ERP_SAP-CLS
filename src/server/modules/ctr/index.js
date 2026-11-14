import { authzOf } from '../../platform/authz/index.js';
import { eventTypes } from '../../platform/events/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports } from '../../platform/list/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { workflowTypes } from '../../platform/workflow/index.js';
import { createFlagService } from '../core/api.js';
import { createBase } from '../proc/base.js';
import { registerProject360Widget } from '../proj/p360.js';
import { STATUS } from '../qa/flow.js';
import { createContractService } from './contracts.js';
import { createSecurityService } from './securities.js';
import { securityRoutes } from './security-routes.js';
import { createWorkOrderService } from './workorders.js';
import { workOrderRoutes } from './wo-routes.js';
import { ctrRoutes } from './routes.js';

// Contracts, subcontracts and commercial (module M21): client contracts with clauses, obligations, milestones and amendments (21.01); later securities, subcontracts, variations, claims, price variation and LD.
const services = new WeakMap();
export const ctrOf = (db) => services.get(db) ?? null;
export const CTR_DOCS = { contract: 'CTR_CONTRACT', amendment: 'CTR_AMENDMENT', bg: 'CTR_BG', insurance: 'CTR_INSURANCE', workOrder: 'CTR_WORK_ORDER', woAmendment: 'CTR_WO_AMENDMENT' };

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['ctr.contract.activated', 'A client contract was approved and is in force (part 21.01): data { contractId, docNo, contractNo, projectId, clientPartnerId, type, original, revised, startDate, completionDate, dlpMonths, paymentTerms, retentionPct, retentionCapPct, advanceTerms, pvcApplicable, pvcRef, ldRatePct, ldBasis, ldCapPct, security, insurance, versionNo, clauses, milestones }. Billing (22.03), securities (21.02), price variation and LD (21.07) and claims (21.06) read the terms.'],
  ['ctr.contract.amended', 'An approved amendment or supplementary agreement changed a contract (part 21.01 FR-06): the terms of ctr.contract.activated after the change plus amendmentId, amendmentNo, docNo, kind, valueChange, newCompletion, changedTerms.'],
  ['ctr.contract.value_changed', 'The revised value of a contract changed (part 21.01 BR-01): data { contractId, contractNo, projectId, cause (AMENDMENT or VARIATION), refId, refNo, change, original, revised, pending } in rupees.'],
  ['ctr.obligation.done', 'A contractual obligation was done (part 21.01): data { obligationId, contractId, projectId, description, dueDate, doneOn, late, nextId, nextDue }.'],
  ['ctr.obligation.overdue', 'A contractual obligation passed its due date (part 21.01): data { obligationId, contractId, projectId, dueDate, owner }.'],
  ['ctr.milestone.achieved', 'A contract milestone was achieved (part 21.01 FR-04): data { milestoneId, contractId, contractNo, projectId, code, name, dueDate, achievedOn, paymentLinked, amount }. Milestone billing (22.03) bills the payment-linked ones.'],
  ['ctr.bg.issued', 'A bank guarantee was approved and is in force (part 21.02): data { bgId, docNo, bgNo, direction, bgType, projectId, contractId, partnerId, bank, amount, original, issueDate, expiryDate, claimExpiry, marginPct, commissionPct, commission, margin, state } in rupees. Finance (23.02) books the commission and the margin money.'],
  ['ctr.bg.extended', 'The validity of a guarantee was extended (part 21.02): the data of ctr.bg.issued plus eventId, referenceNo, reason, before, after and commissionForPeriod.'],
  ['ctr.bg.reduced', 'A guarantee was reduced, for an advance guarantee only as far as the advance was recovered (part 21.02 BR-01): the data of ctr.bg.extended.'],
  ['ctr.bg.released', 'A guarantee was released by the bank (part 21.02): the data of ctr.bg.extended. Retention release (22.07) reads it.'],
  ['ctr.bg.invoked', 'A guarantee was invoked (part 21.02): the data of ctr.bg.extended; the amount at risk is the amount before.'],
  ['ctr.insurance.approved', 'An insurance policy (or its renewal) was approved (part 21.02): data { insuranceId, docNo, policyNo, policyType, insurer, projectId, contractId, sumInsured, premium, validFrom, validTo, renewalOf }. Finance books the premium.'],
  ['ctr.insurance.claim_made', 'A claim was made on a policy (part 21.02): data { claimId, claimNo, policyId, policyNo, projectId, incidentRef, incidentDate, claimed }.'],
  ['ctr.insurance.claim_settled', 'A claim was settled (part 21.02): data { claimId, claimNo, policyId, projectId, claimed, settled, settledOn }.'],
  ['ctr.wo.approved', 'A subcontract work order was approved and issued (part 21.03): data { workOrderId, docNo, woNo, woType, projectId, contractId, subcontractorId, subcontractor, workPackageId, value, startDate, endDate, retentionPct, sdPct, advancePct, advanceRecoveryPct, tdsSection, gstMode, gstPct, paymentDays, ldPct, amendmentNo, negativeMargin, items, freeIssue } in rupees. Commitments (12.03) are posted in the same transaction; the subcontractor bills (22.05), the workspace (21.04) and the portal (25.03) read it.'],
  ['ctr.wo.accepted', 'The subcontractor accepted the work order (part 21.03): the data of ctr.wo.approved plus acceptedBy and reference.'],
  ['ctr.wo.amended', 'An amendment of a work order was approved and applied (part 21.03): the data of ctr.wo.approved after the change plus amendmentId, amendmentDocNo, amendmentNo, description, before, after and delta; the commitment moved by the delta.'],
  ['ctr.wo.closed', 'A work order was closed with its final bill (part 21.03): the data of ctr.wo.approved plus finalBillRef and releasedCommitment.'],
  ['ctr.security.expiring', 'A guarantee or policy is within an alert offset of its expiry (part 21.02 FR-04): data { kind, bgId or insuranceId, projectId, expiryDate or validTo, daysLeft, offset }. The alert engine (04.09) reads it.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'ctr', description });

integrityRegistry.register({
  statuses: { ctr_contracts: Object.keys(STATUS), ctr_amendments: Object.keys(STATUS), ctr_obligations: ['OPEN', 'DONE', 'WAIVED'], ctr_bank_guarantees: Object.keys(STATUS), ctr_insurances: Object.keys(STATUS), ctr_work_orders: Object.keys(STATUS), ctr_wo_amendments: Object.keys(STATUS), ctr_milestones: ['PENDING', 'ACHIEVED', 'BILLED'] },
  uniqueKeys: [{ table: 'ctr_contracts', columns: ['company_id', 'doc_no'] }, { table: 'ctr_contracts', columns: ['company_id', 'contract_no'] }, { table: 'ctr_amendments', columns: ['company_id', 'doc_no'] }, { table: 'ctr_bank_guarantees', columns: ['company_id', 'doc_no'] }, { table: 'ctr_insurances', columns: ['company_id', 'doc_no'] }, { table: 'ctr_work_orders', columns: ['company_id', 'doc_no'] }, { table: 'ctr_work_orders', columns: ['company_id', 'wo_no'] }, { table: 'ctr_wo_amendments', columns: ['company_id', 'doc_no'] }, { table: 'ctr_clauses', columns: ['contract_id', 'clause_no'] }, { table: 'ctr_milestones', columns: ['contract_id', 'code'] }],
});

export const ctr = {
  code: 'ctr',
  name: 'Contracts and Commercial',
  routePrefix: '/api/v1/ctr',
  ownerPart: '21.01',
  status: 'Client contract register made from the commercial baseline, key clauses with time-bars, obligations calendar with reminders, payment milestones, value tracking and amendments through approval.',
  tables: ['ctr_contracts', 'ctr_clauses', 'ctr_obligations', 'ctr_milestones', 'ctr_amendments', 'ctr_value_log', 'ctr_bank_guarantees', 'ctr_bg_events', 'ctr_advances', 'ctr_insurances', 'ctr_insurance_claims', 'ctr_bank_limits', 'ctr_work_orders', 'ctr_wo_items', 'ctr_wo_free_issue', 'ctr_wo_amendments'],
  resources: ['contracts', 'clauses', 'obligations', 'milestones', 'amendments', 'bank-guarantees', 'bg-requests', 'insurances', 'insurance-claims', 'bank-limits', 'securities', 'work-orders', 'wo-amendments', 'wo-margin'],
  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ctr_contracts'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment }); const base = createBase({ db });
    const cs = createContractService({ db, base, flags }); const sc = createSecurityService({ db, base, flags, contracts: cs.contracts }); const wk = createWorkOrderService({ db, base, flags });
    const deciders = { [CTR_DOCS.contract]: cs.contracts.decide, [CTR_DOCS.amendment]: cs.amendments.decide, [CTR_DOCS.bg]: sc.guarantees.decide, [CTR_DOCS.insurance]: sc.insurances.decide, [CTR_DOCS.workOrder]: wk.workOrders.decide, [CTR_DOCS.woAmendment]: wk.woAmendments.decide };
    const svc = { ...cs, ...sc, ...wk, securities: sc };
    const ctx = { svc, base, flags, deciders, parts: { securities: (r, h) => securityRoutes(r, svc, h), workOrders: (r, h) => workOrderRoutes(r, svc, h) } };
    services.set(db, ctx);
    listExports.register('ctr.contracts', { source: (actor, req) => { base.need(actor, 'ctr.contract.export', 'export contracts'); return cs.contracts.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: (actor) => (authzOf(db).check(actor, 'ctr.contract.value').allowed ? [] : ['original', 'revised']) });
    listExports.register('ctr.amendments', { source: (actor, req) => { base.need(actor, 'ctr.amendment.export', 'export amendments'); return cs.amendments.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    const runtime = runtimeOf(db);
    runtime?.jobs?.register('ctr.obligation_sweep', (jctx) => { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) n += cs.obligationSweep(c.id).told; jctx.log(`${n} obligation reminder(s)`); return { n }; }, { maxAttempts: 2, description: 'Contract obligations falling due or overdue, told to their owners (and the commercial manager when overdue)' });
    runtime?.scheduler?.define({ code: 'ctr.obligation_sweep_morning', cron: '5 2 * * *', jobType: 'ctr.obligation_sweep', description: 'Every morning 07:35 India time: contract obligation reminders' });
    listExports.register('ctr.bank_guarantees', { source: (actor, req) => { base.need(actor, 'ctr.bank_guarantee.export', 'export bank guarantees'); return sc.guarantees.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('ctr.work_orders', { source: (actor, req) => { base.need(actor, 'ctr.work_order.export', 'export work orders'); return wk.workOrders.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('ctr.insurances', { source: (actor, req) => { base.need(actor, 'ctr.insurance.export', 'export insurance policies'); return sc.insurances.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    runtime?.jobs?.register('ctr.security_sweep', (jctx) => { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) n += sc.securitySweep(c.id).told; jctx.log(`${n} expiry alert(s)`); return { n }; }, { maxAttempts: 2, description: 'Bank guarantees and insurance policies within an alert offset of their expiry, told to the commercial and accounts managers; what has run out is closed' });
    runtime?.scheduler?.define({ code: 'ctr.security_sweep_morning', cron: '20 2 * * *', jobType: 'ctr.security_sweep', description: 'Every morning 07:50 India time: guarantee and policy expiry alerts' });
    api.use('/ctr', ctrRoutes(svc, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags, parts: ctx.parts }));
  },
};

const ctrObject = (table, perm, route, label, codeCol = 'doc_no') => objectTypes.register({
  type: table, label, permission: `${perm}.view`, route: (id) => `${route}${id}`, attachmentEntity: table, approvalTarget: table,
  access(db, actor, id) { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(Number(id), actor.companyId); if (!r || !authzOf(db).check(actor, `${perm}.view`, { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined }).allowed) return null; return { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined }; },
  auditEntities: (id) => [{ entity: table, id }],
  summary(db, actor, id) { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ?`).get(Number(id), actor.companyId); return r ? { label: `${r[codeCol]} ${r.title ?? r.description ?? ''}`.trim().slice(0, 200), status: r.status ?? 'ACTIVE' } : null; },
  related: () => [],
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, `${perm}.view`).allowed) return []; return db.prepare(`SELECT id FROM ${table} WHERE company_id = ? AND deleted_at IS NULL AND ${codeCol} LIKE ? ORDER BY id DESC LIMIT ?`).all(actor.companyId, `%${q}%`, limit).map((x) => x.id); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare(`SELECT id FROM ${table} WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?`).all(companyId, projectId, limit).map((x) => x.id); },
});
ctrObject('ctr_contracts', 'ctr.contract', '/ctr/contracts?id=', 'Client contract', 'contract_no');
ctrObject('ctr_amendments', 'ctr.amendment', '/ctr/amendments?id=', 'Contract amendment');
ctrObject('ctr_work_orders', 'ctr.work_order', '/ctr/work-orders?id=', 'Work order', 'wo_no');
ctrObject('ctr_bank_guarantees', 'ctr.bank_guarantee', '/ctr/bank-guarantees?id=', 'Bank guarantee', 'bg_no');
ctrObject('ctr_insurances', 'ctr.insurance', '/ctr/insurances?id=', 'Insurance policy', 'policy_no');

// FR: the contract documents (agreement, LoA, conditions, drawings list) are attachments of the contract through the document service (04.10).
fileEntities.register({ entity: 'ctr_contracts', label: 'Client contract (agreement, letter of award, conditions)', resolve: (db, actor, id) => {
  const r = db.prepare('SELECT * FROM ctr_contracts WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null; const a = authzOf(db); const scope = { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined }; const at = (k) => a.check(actor, k, scope).allowed; if (!at('ctr.contract.view')) return null;
  return { ...scope, canView: true, canEdit: at('ctr.contract.edit') || at('ctr.amendment.create'), locked: false };
} });

fileEntities.register({ entity: 'ctr_work_orders', label: 'Work order (signed copy, scope, drawings, acceptance)', resolve: (db, actor, id) => {
  const r = db.prepare('SELECT * FROM ctr_work_orders WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null; const a = authzOf(db); const scope = { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined }; const at = (k) => a.check(actor, k, scope).allowed; if (!at('ctr.work_order.view')) return null;
  return { ...scope, canView: true, canEdit: at('ctr.work_order.edit') || at('ctr.work_order.accept'), locked: false };
} });

registerProject360Widget('contract', (ctx) => {
  const s = ctrOf(ctx.db); const pid = ctx.project.project_id;
  if (!s || !s.flags.isOn(ctx.actor, 'ff.ctr.p2101')) return { figures: [], rows: [], note: 'Contract management is not enabled for your company yet.' };
  if (!s.base.may(ctx.actor, 'ctr.contract.view', pid)) return { figures: [], rows: [], note: 'You have no right to see the contract of this project.' };
  return s.svc.projectWidget(ctx.actor, pid);
});

const approver = (code, name, role, slaHours, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours, requireAttachment: false, checklist: [], when, notify: [], action: null });
const decideHook = (docType) => ({ onApproved: (db, { instance, actor, comment }) => ctrOf(db)?.deciders[docType](instance, actor, 'APPROVED', comment), onRejected: (db, { instance, actor, comment }) => ctrOf(db)?.deciders[docType](instance, actor, 'REJECTED', comment), onReturned: (db, { instance, actor, comment }) => ctrOf(db)?.deciders[docType](instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => ctrOf(db)?.deciders[docType](instance, actor, 'CANCELLED', comment) });
/** @param {any} o */
export function registerCtrWorkflow({ docType, label, table, route, name, steps, title, fields, owner = 'COMMGR' }) {
  workflowTypes.register({
    docType, label, processOwner: owner, route: (id) => `${route}${id}`,
    describe(db, companyId, id) { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.doc_no} ${title(r)}`.slice(0, 300), originator: r.requested_by, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined } : null; },
    summarise(db, _actor, id) { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id)); return r ? { fields: fields(r, db) } : null; },
    defaultDefinition: { name, settings: { resubmit: 'first', distinctApprovers: true }, steps },
    hooks: decideHook(docType),
  });
}
const chain = [approver('COMMGR', 'Commercial manager', 'COMMGR', 48), approver('PD', 'Project director', 'PD', 48), approver('DIR', 'Director', 'DIR', 72)];
registerCtrWorkflow({ docType: CTR_DOCS.contract, label: 'Client contract activation', table: 'ctr_contracts', route: '/ctr/contracts?id=', name: 'Client contract: the commercial manager, the project director, then the director', steps: chain, title: (r) => `${r.contract_no} ${r.title}`, fields: (r) => [{ label: 'Contract', value: `${r.contract_no} (${r.contract_type})` }, { label: 'Original value', value: String((r.original_paise ?? 0) / 100) }, { label: 'Completion', value: r.completion_date ?? '-' }] });
registerCtrWorkflow({ docType: CTR_DOCS.amendment, label: 'Contract amendment', table: 'ctr_amendments', route: '/ctr/amendments?id=', name: 'Contract amendment: the commercial manager, the project director, then the director', steps: chain, title: (a) => `amendment ${a.amendment_no}`, fields: (a, db) => [{ label: 'Contract', value: db.prepare('SELECT contract_no FROM ctr_contracts WHERE id = ?').get(a.contract_id)?.contract_no ?? '-' }, { label: 'Value change', value: String((a.value_change_paise ?? 0) / 100) }, { label: 'New completion', value: a.new_completion ?? '-' }] });
registerCtrWorkflow({ docType: CTR_DOCS.bg, label: 'Bank guarantee', table: 'ctr_bank_guarantees', route: '/ctr/bank-guarantees?id=', name: 'Bank guarantee: accounts, then the CFO for a guarantee given', owner: 'ACCMGR', steps: [approver('ACCMGR', 'Accounts manager', 'ACCMGR', 24), approver('CFO', 'CFO (guarantee given)', 'CFO', 48, { field: 'direction', op: 'eq', value: 'GIVEN' })], title: (r) => `${r.bg_no} ${r.bank_name}`, fields: (r) => [{ label: 'Guarantee', value: `${r.bg_no} (${r.bg_type}, ${r.direction})` }, { label: 'Bank', value: r.bank_name }, { label: 'Amount', value: String((r.original_paise ?? 0) / 100) }, { label: 'Expiry', value: r.expiry_date }] });
registerCtrWorkflow({ docType: CTR_DOCS.insurance, label: 'Insurance policy', table: 'ctr_insurances', route: '/ctr/insurances?id=', name: 'Insurance policy: the accounts manager', owner: 'ACCMGR', steps: [approver('ACCMGR', 'Accounts manager', 'ACCMGR', 48)], title: (r) => `${r.policy_no} ${r.insurer}`, fields: (r) => [{ label: 'Policy', value: `${r.policy_no} (${r.policy_type})` }, { label: 'Insurer', value: r.insurer }, { label: 'Sum insured', value: String((r.sum_insured_paise ?? 0) / 100) }, { label: 'Period', value: `${r.valid_from} to ${r.valid_to}` }] });

const woChain = [approver('COMMGR', 'Commercial manager', 'COMMGR', 24), approver('PD', 'Project director (above Rs 10 lakh)', 'PD', 48, { field: 'needsPd', op: 'eq', value: 1 }), approver('DIR', 'Director (above Rs 50 lakh or a negative margin)', 'DIR', 72, { field: 'needsDir', op: 'eq', value: 1 })];
registerCtrWorkflow({ docType: CTR_DOCS.workOrder, label: 'Subcontract work order', table: 'ctr_work_orders', route: '/ctr/work-orders?id=', name: 'Work order: the commercial manager; the project director above Rs 10 lakh; the director above Rs 50 lakh or for a negative margin', steps: woChain, title: (r) => `${r.wo_no} ${r.title}`, fields: (r, db) => [{ label: 'Work order', value: `${r.wo_no} (${r.wo_type})` }, { label: 'Subcontractor', value: db.prepare('SELECT legal_name FROM mdm_partners WHERE id = ?').get(r.subcontractor_id)?.legal_name ?? '-' }, { label: 'Value', value: String((r.value_paise ?? 0) / 100) }, { label: 'Negative margin', value: r.negative_margin ? 'Yes' : 'No' }] });
registerCtrWorkflow({ docType: CTR_DOCS.woAmendment, label: 'Work order amendment', table: 'ctr_wo_amendments', route: '/ctr/work-orders?amendment=', name: 'Work order amendment: by the band of the change', steps: woChain, title: (a) => `amendment ${a.amendment_no}`, fields: (a, db) => [{ label: 'Work order', value: db.prepare('SELECT wo_no FROM ctr_work_orders WHERE id = ?').get(a.wo_id)?.wo_no ?? '-' }, { label: 'Value change', value: String((a.delta_paise ?? 0) / 100) }] });
