import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports } from '../../platform/list/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { workflowTypes } from '../../platform/workflow/index.js';
import { createFlagService } from '../core/api.js';
import { createBase } from '../proc/base.js';
import { STATUS } from '../qa/flow.js';
import { createStatutoryService } from '../mdm/statutory.js';
import { ASSIGNMENT_DOC, STATUTORY_DOC, createPaySetupService } from './setup.js';
import { setupRoutes } from './routes.js';

// Payroll and statutory compliance (module M24, code pay): payroll set-up (24.01).
const services = new WeakMap();
export const payOf = (db) => services.get(db) ?? null;
const inr = (p) => `₹${((p ?? 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['pay.assignment.approved', 'An employee pay assignment or revision was approved (part 24.01): data { assignmentId, docNo, employeeId, structureId, kind, ctcAnnual, grossMonthly, effectiveFrom, arrears }. The monthly pay of the employee is set from the date; arrears of a retro-dated revision are paid by the next payroll run (24.02).'],
  ['pay.statutory.approved', 'A statutory parameter change was approved by the CFO (part 24.01): data { paramId, code, state, effectiveFrom, params }. Payroll reads it from its date.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'pay', description });

integrityRegistry.register({
  companyOptional: ['pay_components', 'pay_statutory_params'],
  statuses: { pay_assignments: Object.keys(STATUS), pay_statutory_params: Object.keys(STATUS) },
  uniqueKeys: [{ table: 'pay_assignments', columns: ['company_id', 'doc_no'] }],
});

const step = (code, name, role, slaHours, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours, requireAttachment: false, checklist: [], when, notify: [], action: null });
const hooks = (pick) => Object.fromEntries([['onApproved', 'APPROVED'], ['onRejected', 'REJECTED'], ['onReturned', 'RETURNED'], ['onCancelled', 'CANCELLED']].map(([h, o]) => [h, (db, { instance, actor, comment }) => pick(payOf(db))?.flow.decide(instance, actor, o, comment)]));
workflowTypes.register({
  docType: ASSIGNMENT_DOC, label: 'Salary assignment or revision', processOwner: 'HRMGR', route: (id) => `/payroll/assignments?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT a.*, e.emp_code, e.full_name FROM pay_assignments a JOIN hr_employees e ON e.id = a.employee_id WHERE a.id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.assignment_kind} ${r.emp_code} ${r.full_name} from ${r.effective_from}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT a.*, e.emp_code, e.full_name, s.code AS scode, s.grade, s.senior FROM pay_assignments a JOIN hr_employees e ON e.id = a.employee_id JOIN pay_structures s ON s.id = a.structure_id WHERE a.id = ?').get(Number(id)); if (!r) return null; const p = r.previous_id ? db.prepare('SELECT ctc_annual_paise FROM pay_assignments WHERE id = ?').get(r.previous_id) : null;
    return { fields: [{ label: 'Employee', value: `${r.emp_code} ${r.full_name}` }, { label: 'Kind / from', value: `${r.assignment_kind} from ${r.effective_from}` }, { label: 'Structure / grade', value: `${r.scode} · ${r.grade ?? '—'}${r.senior ? ' (senior)' : ''}` }, { label: 'CTC a year', value: `${inr(r.ctc_annual_paise)}${p ? ` (was ${inr(p.ctc_annual_paise)}, ${r.increment_pct_bp != null ? `${r.increment_pct_bp / 100} %` : ''})` : ''}` }, { label: 'Gross a month', value: inr(r.gross_monthly_paise) }, { label: 'Reason', value: `${r.reason}${r.rating ? ` · rating ${r.rating}` : ''}` }] }; },
  defaultDefinition: { name: 'Salary revision: the HR manager, the CFO, the director for a senior grade', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('HRMGR', 'HR manager', 'HRMGR', 48), step('CFO', 'CFO', 'CFO', 48), step('DIR', 'Director (senior grade)', 'DIR', 72, { field: 'senior', op: 'eq', value: 'yes' })] },
  hooks: hooks((s) => s?.setup.assignments),
});
workflowTypes.register({
  docType: STATUTORY_DOC, label: 'Statutory parameter change', processOwner: 'CFO', route: (id) => `/payroll/statutory?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM pay_statutory_params WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.code} ${r.state_code} from ${r.effective_from}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM pay_statutory_params WHERE id = ?').get(Number(id)); if (!r) return null; const prev = db.prepare("SELECT params_json, effective_from FROM pay_statutory_params WHERE code = ? AND state_code = ? AND status = 'APPROVED' AND (company_id = ? OR company_id IS NULL) AND effective_from <= ? AND deleted_at IS NULL ORDER BY effective_from DESC LIMIT 1").get(r.code, r.state_code, r.company_id, r.effective_from);
    return { fields: [{ label: 'Parameter', value: `${r.code} · ${r.state_code}` }, { label: 'From', value: r.effective_from }, { label: 'New values', value: r.params_json }, { label: 'In force now', value: prev ? `${prev.params_json} (from ${prev.effective_from})` : 'none' }, { label: 'Notification', value: r.legal_ref ?? '—' }] }; },
  defaultDefinition: { name: 'Statutory parameter change: the payroll team proposes, the CFO approves', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('CFO', 'CFO', 'CFO', 72)] },
  hooks: hooks((s) => s?.setup.statutoryParams),
});

export const pay = {
  code: 'pay',
  name: 'Payroll and statutory compliance',
  routePrefix: '/api/v1/pay',
  ownerPart: '24.01',
  status: 'Pay components with formulas of the calculation engine and Code-on-Wages classes; salary structures with the CTC breakup; employee pay assignments and revisions (HRMGR -> CFO, the director for senior grades) with arrears; statutory parameters by date and state (PAY -> CFO); the payroll calendar.',
  tables: ['pay_components', 'pay_structures', 'pay_assignments', 'pay_arrears', 'pay_statutory_params', 'pay_calendar'],
  resources: ['components', 'structures', 'assignments', 'arrears', 'statutory-params', 'calendar', 'employees'],
  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pay_components'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment }); const base = createBase({ db });
    const statutory = createStatutoryService({ db, flags: null });
    const setup = createPaySetupService({ db, base, flags, statutory });
    const ctx = { setup, base, flags };
    services.set(db, ctx);
    listExports.register('pay.assignments', { source: (actor, req) => { base.need(actor, 'pay.assignment.export', 'export pay assignments'); return setup.assignments.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: (actor) => (base.may(actor, 'pay.salary.view') ? [] : ['ctcAnnual', 'grossMonthly', 'arrears']) });
    runtimeOf(db)?.bus?.subscribe('perf.review.approved', (e) => { setup.assignments.onRating(e); }, { consumer: 'pay.rating' }); // D-361
    const r = Router(); const h = { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags };
    setupRoutes(r, setup, h);
    api.use('/pay', r);
  },
};
