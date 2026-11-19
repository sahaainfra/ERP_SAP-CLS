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
import { RUN_DOC, createPayRunService } from './runs.js';
import { runRoutes, setupRoutes, wageRoutes } from './routes.js';
import { statutoryRoutes } from './statroutes.js';
import { FILING_DOC, createStatutoryService as createFilingService } from './statutory.js';
import { WAGE_DOC, createPayWageService } from './wages.js';
import { fileEntities } from '../../platform/files/entities.js';
import { authzOf } from '../../platform/authz/index.js';
import { labourOf } from '../hr/labour.js';
import { ctrOf } from '../ctr/index.js';
import { subHoldSources } from '../ctr/subcontractors.js';
import { expensesOf } from '../hr/expenses.js';

// Payroll and statutory compliance (module M24, code pay): payroll set-up (24.01).
const services = new WeakMap();
export const payOf = (db) => services.get(db) ?? null;
const inr = (p) => `₹${((p ?? 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['pay.assignment.approved', 'An employee pay assignment or revision was approved (part 24.01): data { assignmentId, docNo, employeeId, structureId, kind, ctcAnnual, grossMonthly, effectiveFrom, arrears }. The monthly pay of the employee is set from the date; arrears of a retro-dated revision are paid by the next payroll run (24.02).'],
  ['pay.run.approved', 'A payroll run was approved by the CFO and locked (part 24.02): data { runId, docNo, period, type, branchId, employees, gross, deductions, employer, net, tds, held }. Statutory returns (24.04) and posting and payment (24.05) read it.'],
  ['pay.wage_run.approved', 'A labour wage run was approved SACC -> PM -> HRMGR and locked (part 24.03): data { runId, docNo, projectId, siteId, contractorId, cycle, periodFrom, periodTo, payDueOn, workers, gross, deductions, employer, net }. Statutory returns (24.04) and posting (24.05) read it.'],
  ['pay.wage_run.paid', 'Workers of an approved wage run were paid (part 24.03): data { runId, docNo, projectId, siteId, mode, paidOn, workers, net, late, complete }. Payment posting (24.05) reads it.'],
  ['pay.contractor_wage.verified', 'A labour contractor\'s wage sheet of a month was verified against the attendance (part 24.03): data { checkId, docNo, contractorId, projectId, siteId, period, workers, variances, blocking, hold, decision }.'],
  ['pay.contractor_wage.variance', 'A labour contractor\'s wage sheet was held for variances (part 24.03): data as pay.contractor_wage.verified; the subcontractor workspace (21.04) holds the contractor\'s payments on the project.'],
  ['pay.statutory.filing_approved', 'A statutory payment (ECR, ESI, PT, LWF, TDS deposit or BOCW cess) was approved ACCMGR -> CFO (part 24.04): data { filingId, docNo, type, period, state, amount, dueDate }. The payment request goes to the bank through 24.05 (23.04 pays bills only today).'],
  ['pay.statutory.paid', 'The challan of an approved statutory payment was recorded (part 24.04): data { filingId, docNo, type, period, paidOn, late, amount }.'],
  ['pay.statutory.file_generated', 'A statutory file or register was generated and validated (part 24.04): data { registerId, type, period, rows }.'],
  ['pay.statutory.approved', 'A statutory parameter change was approved by the CFO (part 24.01): data { paramId, code, state, effectiveFrom, params }. Payroll reads it from its date.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'pay', description });

integrityRegistry.register({
  companyOptional: ['pay_components', 'pay_statutory_params', 'stat_rules'],
  statuses: { stat_filings: Object.keys(STATUS), pay_assignments: Object.keys(STATUS), pay_statutory_params: Object.keys(STATUS), pay_runs: Object.keys(STATUS), pay_wage_runs: Object.keys(STATUS) },
  uniqueKeys: [{ table: 'stat_filings', columns: ['company_id', 'doc_no'] }, { table: 'pay_assignments', columns: ['company_id', 'doc_no'] }, { table: 'pay_runs', columns: ['company_id', 'doc_no'] }, { table: 'pay_wage_runs', columns: ['company_id', 'doc_no'] }, { table: 'pay_contractor_wage_checks', columns: ['company_id', 'doc_no'] }],
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
  docType: STATUTORY_DOC, label: 'Statutory parameter change', processOwner: 'CFO', route: (id) => `/payroll/compliance?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM pay_statutory_params WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.code} ${r.state_code} from ${r.effective_from}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM pay_statutory_params WHERE id = ?').get(Number(id)); if (!r) return null; const prev = db.prepare("SELECT params_json, effective_from FROM pay_statutory_params WHERE code = ? AND state_code = ? AND status = 'APPROVED' AND (company_id = ? OR company_id IS NULL) AND effective_from <= ? AND deleted_at IS NULL ORDER BY effective_from DESC LIMIT 1").get(r.code, r.state_code, r.company_id, r.effective_from);
    return { fields: [{ label: 'Parameter', value: `${r.code} · ${r.state_code}` }, { label: 'From', value: r.effective_from }, { label: 'New values', value: r.params_json }, { label: 'In force now', value: prev ? `${prev.params_json} (from ${prev.effective_from})` : 'none' }, { label: 'Notification', value: r.legal_ref ?? '—' }] }; },
  defaultDefinition: { name: 'Statutory parameter change: the payroll team proposes, the CFO approves', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('CFO', 'CFO', 'CFO', 72)] },
  hooks: hooks((s) => s?.setup.statutoryParams),
});

workflowTypes.register({
  docType: FILING_DOC, label: 'Statutory payment', processOwner: 'ACCMGR', route: (id) => `/payroll/compliance?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM stat_filings WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.filing_type} ${r.period}${r.state_code !== 'ALL' ? ` ${r.state_code}` : ''}: ₹${(r.amount_paise / 100).toFixed(2)}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM stat_filings WHERE id = ?').get(Number(id)); if (!r) return null; return { fields: [{ label: 'Payment', value: `${r.filing_type} · ${r.period} · ${r.state_code}` }, { label: 'Due', value: r.due_date }, { label: 'Amount', value: inr(r.amount_paise) }, { label: 'Source', value: r.register_id ? `register ${r.register_id}` : 'payroll run / BOCW' }] }; },
  defaultDefinition: { name: 'Statutory payment: the accounts manager, then the CFO', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('ACCMGR', 'Accounts manager', 'ACCMGR', 48), step('CFO', 'CFO', 'CFO', 48)] },
  hooks: hooks((s) => s?.stat?.filings),
});

workflowTypes.register({
  docType: RUN_DOC, label: 'Payroll run', processOwner: 'CFO', route: (id) => `/payroll/runs?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM pay_runs WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `Payroll ${r.period} (${r.run_type.toLowerCase()}): ${r.employees_count} employees`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM pay_runs WHERE id = ?').get(Number(id)); if (!r) return null; const x = JSON.parse(r.inputs_json || '{}');
    return { fields: [{ label: 'Period / type', value: `${r.period} · ${r.run_type}` }, { label: 'Employees', value: `${r.employees_count}${x.excluded?.length ? ` (${x.excluded.length} left out: attendance not locked or no pay)` : ''}` }, { label: 'Gross / deductions', value: `${inr(r.gross_paise)} / ${inr(r.deductions_paise)}` }, { label: 'Net (held)', value: `${inr(r.net_paise)} (${r.held_count} held)` }, { label: 'Employer contributions / TDS', value: `${inr(r.employer_paise)} / ${inr(r.tds_paise)}` }, { label: 'Checks raised', value: String(r.flags_count) }] }; },
  defaultDefinition: { name: 'Payroll run: the payroll team prepares, the HR manager and the CFO approve', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('HRMGR', 'HR manager', 'HRMGR', 24), step('CFO', 'CFO', 'CFO', 24)] },
  hooks: hooks((s) => s?.runs.runs),
});

workflowTypes.register({
  docType: WAGE_DOC, label: 'Labour wage run', processOwner: 'HRMGR', route: (id) => `/payroll/wage-runs?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM pay_wage_runs WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `Wages ${r.period_from} to ${r.period_to}: ${r.workers_count} workers`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT x.*, s.name AS site, p.code AS pcode, c.legal_name FROM pay_wage_runs x JOIN org_sites s ON s.id = x.org_site_id JOIN org_projects p ON p.id = x.org_project_id JOIN mdm_partners c ON c.id = x.contractor_id WHERE x.id = ?').get(Number(id)); if (!r) return null;
    return { fields: [{ label: 'Site / contractor', value: `${r.pcode} · ${r.site} · ${r.legal_name}` }, { label: 'Period', value: `${r.cycle.toLowerCase()} ${r.period_from} to ${r.period_to}; pay by ${r.pay_due_on}` }, { label: 'Workers / days / OT hours', value: `${r.workers_count} / ${r.days_milli / 1000} / ${r.ot_milli / 1000}` }, { label: 'Gross / deductions', value: `${inr(r.gross_paise)} / ${inr(r.deductions_paise)}` }, { label: 'Net / employer PF and ESI', value: `${inr(r.net_paise)} / ${inr(r.employer_paise)}` }, { label: 'Checks raised', value: String(r.flags_count) }] }; },
  defaultDefinition: { name: 'Labour wage run: the site accountant (unless he prepared it), the project manager, the HR manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('SACC', 'Site accountant', 'SACC', 24, { field: 'makerRole', op: 'ne', value: 'SACC' }), step('PM', 'Project manager', 'PM', 24), step('HRMGR', 'HR manager (compliance)', 'HRMGR', 24)] },
  hooks: hooks((s) => s?.wages?.runs),
});
const fileOn = (table, key) => (db, actor, id) => { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(Number(id), actor.companyId); if (!r) return null; const a = authzOf(db); const pid = r.org_project_id ?? r.project_id ?? null; const sid = r.org_site_id ?? r.site_id ?? null; const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: pid, siteId: sid }).allowed;
  return { companyId: r.company_id, projectId: pid, siteId: sid, canView: at(`${key}.view`), canEdit: key === 'pay.wage_check' ? at('pay.wage_check.manage') && ['DRAFT', 'RETURNED', 'VARIANCE'].includes(r.check_status) : at('pay.wage_run.acknowledge') && r.ack_status === 'PENDING', locked: key === 'pay.wage_check' ? ['SUBMITTED', 'VERIFIED'].includes(r.check_status) : r.ack_status !== 'PENDING' }; };
fileEntities.register({ entity: 'pay_contractor_wage_checks', label: 'Contractor wage sheet and proof of payment', resolve: fileOn('pay_contractor_wage_checks', 'pay.wage_check') });
fileEntities.register({ entity: 'pay_wage_lines', label: 'Wage acknowledgement (photograph)', resolve: fileOn('pay_wage_lines', 'pay.wage_run') });
subHoldSources.push((db, companyId, contractorId, projectId) => payOf(db)?.wages?.checks.holdReasons(companyId, contractorId, projectId) ?? []);

export const pay = {
  code: 'pay',
  name: 'Payroll and statutory compliance',
  routePrefix: '/api/v1/pay',
  ownerPart: '24.01',
  status: 'Pay components with formulas of the calculation engine and Code-on-Wages classes; salary structures with the CTC breakup; employee pay assignments and revisions (HRMGR -> CFO, the director for senior grades) with arrears; statutory parameters by date and state (PAY -> CFO); the payroll calendar.',
  tables: ['stat_filings', 'stat_registers', 'stat_rules', 'stat_bocw_months', 'pay_components', 'pay_structures', 'pay_assignments', 'pay_arrears', 'pay_statutory_params', 'pay_calendar', 'pay_runs', 'pay_run_lines', 'pay_inputs', 'pay_tax_declarations', 'pay_wage_runs', 'pay_wage_lines', 'pay_contractor_wage_checks'],
  resources: ['stat', 'components', 'structures', 'assignments', 'arrears', 'statutory-params', 'calendar', 'employees', 'runs', 'inputs', 'declarations', 'wage-runs', 'wage-register', 'wage-checks'],
  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pay_components'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment }); const base = createBase({ db });
    const statutory = createStatutoryService({ db, flags: null });
    const setup = createPaySetupService({ db, base, flags, statutory });
    const runs = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pay_runs'").get() ? createPayRunService({ db, base, flags, setup, expenses: () => expensesOf(db) }) : null;
    const wages = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pay_wage_runs'").get() ? createPayWageService({ db, base, flags, setup, labour: () => labourOf(db), ctr: () => ctrOf(db) }) : null;
    const stat = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'stat_filings'").get() ? createFilingService({ db, base, flags, setup }) : null;
    const ctx = { setup, runs, wages, stat, base, flags };
    services.set(db, ctx);
    listExports.register('pay.assignments', { source: (actor, req) => { base.need(actor, 'pay.assignment.export', 'export pay assignments'); return setup.assignments.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: (actor) => (base.may(actor, 'pay.salary.view') ? [] : ['ctcAnnual', 'grossMonthly', 'arrears']) });
    runtimeOf(db)?.bus?.subscribe('perf.review.approved', (e) => { setup.assignments.onRating(e); }, { consumer: 'pay.rating' }); // D-361
    const r = Router(); const h = { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags };
    setupRoutes(r, setup, h); if (runs) { runRoutes(r, runs, h); const bus = runtimeOf(db)?.bus; bus?.subscribe('lv.encashment.input', (e) => { runs.consumers.onEncashment(e); }, { consumer: 'pay.encashment' }); bus?.subscribe('inv.asset.recovery_approved', (e) => { runs.consumers.onLossRecovery(e); }, { consumer: 'pay.loss_recovery' }); }
    if (wages) wageRoutes(r, wages, h);
    if (stat) statutoryRoutes(r, stat, h);
    api.use('/pay', r);
  },
};
