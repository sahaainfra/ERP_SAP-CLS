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
import { ctrRoutes } from './routes.js';

// Contracts, subcontracts and commercial (module M21): client contracts with clauses, obligations, milestones and amendments (21.01); later securities, subcontracts, variations, claims, price variation and LD.
const services = new WeakMap();
export const ctrOf = (db) => services.get(db) ?? null;
export const CTR_DOCS = { contract: 'CTR_CONTRACT', amendment: 'CTR_AMENDMENT' };

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['ctr.contract.activated', 'A client contract was approved and is in force (part 21.01): data { contractId, docNo, contractNo, projectId, clientPartnerId, type, original, revised, startDate, completionDate, dlpMonths, paymentTerms, retentionPct, retentionCapPct, advanceTerms, pvcApplicable, pvcRef, ldRatePct, ldBasis, ldCapPct, security, insurance, versionNo, clauses, milestones }. Billing (22.03), securities (21.02), price variation and LD (21.07) and claims (21.06) read the terms.'],
  ['ctr.contract.amended', 'An approved amendment or supplementary agreement changed a contract (part 21.01 FR-06): the terms of ctr.contract.activated after the change plus amendmentId, amendmentNo, docNo, kind, valueChange, newCompletion, changedTerms.'],
  ['ctr.contract.value_changed', 'The revised value of a contract changed (part 21.01 BR-01): data { contractId, contractNo, projectId, cause (AMENDMENT or VARIATION), refId, refNo, change, original, revised, pending } in rupees.'],
  ['ctr.obligation.done', 'A contractual obligation was done (part 21.01): data { obligationId, contractId, projectId, description, dueDate, doneOn, late, nextId, nextDue }.'],
  ['ctr.obligation.overdue', 'A contractual obligation passed its due date (part 21.01): data { obligationId, contractId, projectId, dueDate, owner }.'],
  ['ctr.milestone.achieved', 'A contract milestone was achieved (part 21.01 FR-04): data { milestoneId, contractId, contractNo, projectId, code, name, dueDate, achievedOn, paymentLinked, amount }. Milestone billing (22.03) bills the payment-linked ones.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'ctr', description });

integrityRegistry.register({
  statuses: { ctr_contracts: Object.keys(STATUS), ctr_amendments: Object.keys(STATUS), ctr_obligations: ['OPEN', 'DONE', 'WAIVED'], ctr_milestones: ['PENDING', 'ACHIEVED', 'BILLED'] },
  uniqueKeys: [{ table: 'ctr_contracts', columns: ['company_id', 'doc_no'] }, { table: 'ctr_contracts', columns: ['company_id', 'contract_no'] }, { table: 'ctr_amendments', columns: ['company_id', 'doc_no'] }, { table: 'ctr_clauses', columns: ['contract_id', 'clause_no'] }, { table: 'ctr_milestones', columns: ['contract_id', 'code'] }],
});

export const ctr = {
  code: 'ctr',
  name: 'Contracts and Commercial',
  routePrefix: '/api/v1/ctr',
  ownerPart: '21.01',
  status: 'Client contract register made from the commercial baseline, key clauses with time-bars, obligations calendar with reminders, payment milestones, value tracking and amendments through approval.',
  tables: ['ctr_contracts', 'ctr_clauses', 'ctr_obligations', 'ctr_milestones', 'ctr_amendments', 'ctr_value_log'],
  resources: ['contracts', 'clauses', 'obligations', 'milestones', 'amendments'],
  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ctr_contracts'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment }); const base = createBase({ db });
    const cs = createContractService({ db, base, flags });
    const deciders = { [CTR_DOCS.contract]: cs.contracts.decide, [CTR_DOCS.amendment]: cs.amendments.decide };
    const svc = { ...cs };
    const ctx = { svc, base, flags, deciders, parts: {} };
    services.set(db, ctx);
    listExports.register('ctr.contracts', { source: (actor, req) => { base.need(actor, 'ctr.contract.export', 'export contracts'); return cs.contracts.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: (actor) => (authzOf(db).check(actor, 'ctr.contract.value').allowed ? [] : ['original', 'revised']) });
    listExports.register('ctr.amendments', { source: (actor, req) => { base.need(actor, 'ctr.amendment.export', 'export amendments'); return cs.amendments.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    const runtime = runtimeOf(db);
    runtime?.jobs?.register('ctr.obligation_sweep', (jctx) => { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) n += cs.obligationSweep(c.id).told; jctx.log(`${n} obligation reminder(s)`); return { n }; }, { maxAttempts: 2, description: 'Contract obligations falling due or overdue, told to their owners (and the commercial manager when overdue)' });
    runtime?.scheduler?.define({ code: 'ctr.obligation_sweep_morning', cron: '5 2 * * *', jobType: 'ctr.obligation_sweep', description: 'Every morning 07:35 India time: contract obligation reminders' });
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

// FR: the contract documents (agreement, LoA, conditions, drawings list) are attachments of the contract through the document service (04.10).
fileEntities.register({ entity: 'ctr_contracts', label: 'Client contract (agreement, letter of award, conditions)', resolve: (db, actor, id) => {
  const r = db.prepare('SELECT * FROM ctr_contracts WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null; const a = authzOf(db); const scope = { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined }; const at = (k) => a.check(actor, k, scope).allowed; if (!at('ctr.contract.view')) return null;
  return { ...scope, canView: true, canEdit: at('ctr.contract.edit') || at('ctr.amendment.create'), locked: false };
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
