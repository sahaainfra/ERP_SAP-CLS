import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports, listExportsOf } from '../../platform/list/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { widgetRegistry } from '../../platform/widgets/index.js';
import { createFlagService } from '../core/api.js';
import { bindEmployees, createEmployeeService } from './employees.js';
import './integrations.js';
import { employeeRoutes } from './routes.js';

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['hr.employee.activated', 'A new employee was approved and is active: data { code, userId, departmentId, designationId, employmentType, doj, locationType, siteId, projectId, managerId }. Deployment, attendance, payroll, HSE inductions and messaging groups take the person from here.'],
  ['hr.employee.updated', 'An approved employee changed (personal, statutory, bank, employment details, education, documents, the user link) after approval or on its effective date: data { code, userId, changeType, effectiveDate? }. Consumers drop their cached copy.'],
  ['hr.employee.separated', 'An employee became separated or absconding on the effective date; the user account is deactivated through user management: data { code, userId, status, effectiveDate, lastWorkingDate, accessRemoved }. Attendance and payroll stop, final settlement starts.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'hr', description });

const TABLES = ['hr_employees', 'hr_employee_statutory', 'hr_employee_banks', 'hr_employee_contacts', 'hr_employee_education', 'hr_employee_experience', 'hr_employee_documents', 'hr_employee_changes', 'hr_employee_history'];
integrityRegistry.register({
  allowNegative: [], companyOptional: [],
  statuses: { hr_employees: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED'], hr_employee_changes: ['PENDING', 'SCHEDULED', 'APPLIED', 'REJECTED', 'RETURNED', 'CANCELLED'] },
  uniqueKeys: [{ table: 'hr_employees', columns: ['company_id', 'emp_code'] }],
});
/** Module "hr": human resources (Workforce-First, M07). Part 07.01 holds the employee master and employment records. The tables are `hr_*`. */
export const hr = {
  code: 'hr',
  name: 'HR & Workforce Management',
  routePrefix: '/api/v1/hr',
  ownerPart: '07.01',
  status: 'Employee master: profile, employment, statutory and bank details (masked), documents with expiry, history, approvals of new employees and of changes, user link, effective-dated separation with access removal, directory, import, overview',
  tables: TABLES,
  companyOptional: [],
  resources: ['employees'],

  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'hr_employees'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment });
    const gate = (key, what) => (req, _res, next) => (flags.isOn(req.actor, key) ? next() : next(notFound(`${what} not enabled for your company yet (feature flag ${key} is OFF).`)));
    const employees = createEmployeeService({ db, vaultKey: appConfig.vaultKey });
    bindEmployees(db, employees);
    const runtime = runtimeOf(db);
    listExports.register('hr.employees', { source: (actor, req) => employees.register.exportSource(actor, req), hidden: () => [] });
    const companies = () => db.prepare('SELECT id FROM org_companies').all().map((r) => r.id);
    runtime.jobs.register('hr.employee_cycle', () => { const out = { applied: 0, documentsDue: 0, documentsExpired: 0 }; for (const c of companies()) { const r = employees.cycle(c); for (const k of Object.keys(out)) out[k] += r[k]; } return out; });
    runtime.scheduler.define({ code: 'hr.employee_cycle_daily', cron: '15 0 * * *', jobType: 'hr.employee_cycle', description: 'Daily (00:15): approved changes whose effective date has come are applied (a separation removes the user account), documents that expire soon or have expired are reported to HR' });
    try {
      widgetRegistry.register({ code: 'hr.headcount', provider: (ctx) => { const w = employees.widget(ctx.actor); return { value: w.value, unit: w.value === 1 ? 'employee' : 'employees', previous: null, trendPct: null, target: null, status: w.attention > 0 ? 'amber' : 'green', note: `${w.joiners} joined and ${w.leavers} left in the last 30 days.`, drill: '/hr' }; } });
    } catch { /* registered once per process */ }
    const router = Router();
    router.use(gate('ff.hr.p0701', 'The employee master is'));
    router.use(employeeRoutes({ employees, exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
    api.use('/hr', router);
  },
};
