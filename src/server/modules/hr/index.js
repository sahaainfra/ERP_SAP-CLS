import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports, listExportsOf } from '../../platform/list/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { widgetRegistry } from '../../platform/widgets/index.js';
import { createFlagService } from '../core/api.js';
import { bindDeployments, createDeploymentService } from './deployments.js';
import './deploy-integrations.js';
import { deployRoutes } from './deploy-routes.js';
import { bindEmployees, createEmployeeService } from './employees.js';
import './integrations.js';
import { bindRecruitment, createRecruitmentService } from './recruitment.js';
import { offerLinkRoutes, recruitRoutes } from './recruit-routes.js';
import { employeeRoutes } from './routes.js';
import { bindTransfers, createTransferService } from './transfers.js';

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['hr.employee.activated', 'A new employee was approved and is active: data { code, userId, departmentId, designationId, employmentType, doj, locationType, siteId, projectId, managerId }. Deployment, attendance, payroll, HSE inductions and messaging groups take the person from here.'],
  ['hr.employee.updated', 'An approved employee changed (personal, statutory, bank, employment details, education, documents, the user link) after approval or on its effective date: data { code, userId, changeType, effectiveDate? }. Consumers drop their cached copy.'],
  ['hr.employee.separated', 'An employee became separated or absconding on the effective date; the user account is deactivated through user management: data { code, userId, status, effectiveDate, lastWorkingDate, accessRemoved }. Attendance and payroll stop, final settlement starts.'],
  ['hr.requisition.approved', 'A manpower requisition (or a new revision of it) was approved: data { docNo, revision, positions, departmentId, designationId, band }. Job openings and the manpower plan take it from here.'],
  ['hr.candidate.stage_changed', 'A candidate moved to another stage of the pipeline: data { from, to }.'],
  ['hr.candidate.joined', 'A candidate joined: the employee record was created through the employee master and sent for approval, and the joining checklist was given out: data { employeeId, code, doj, requisitionId }.'],
  ['hr.offer.approved', 'An offer was approved and can be sent: data { docNo, candidateId, band }.'],
  ['hr.offer.accepted', 'The candidate accepted the offer (through the link, or HR recorded it): data { docNo, candidateId, response }.'],
  ['hr.deployment.changed', 'A deployment changed what a person may do or where they are: an approved deployment started, was amended, ended or was closed: data { change (APPROVED, STARTED, AMENDED, CHANGED, ENDED, CLOSED), docNo, revision, personType, personId, employeeId, userId, projectId, siteId, crewId, siteRole, accessRole, isPrimary, fromDate, toDate, transferId }. Geofence eligibility (07.05), site permissions (02.04 scopes), messaging groups (05.04), labour costing and resource planning (17.08) take it from here.'],
  ['hr.transfer.approved', 'A transfer or secondment was approved: the old primary deployment ends on the relieving date and the new one starts on the joining date: data { docNo, employeeId, kind, fromProjectId, fromSiteId, toProjectId, toSiteId, relieveDate, joinDate, deploymentId }.'],
  ['hr.offer.declined', 'The candidate declined the offer: data { docNo, candidateId, response }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'hr', description });

const TABLES = ['hr_site_plans', 'hr_crews', 'hr_crew_members', 'hr_deployments', 'hr_transfers', 'hr_headcount_plans', 'hr_requisitions', 'hr_candidates', 'hr_interviews', 'hr_offers', 'hr_onboarding_tasks', 'hr_employees', 'hr_employee_statutory', 'hr_employee_banks', 'hr_employee_contacts', 'hr_employee_education', 'hr_employee_experience', 'hr_employee_documents', 'hr_employee_changes', 'hr_employee_history'];
integrityRegistry.register({
  allowNegative: [], companyOptional: [],
  statuses: { hr_deployments: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'CLOSED', 'SUPERSEDED'], hr_transfers: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'CLOSED', 'SUPERSEDED'], hr_requisitions: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'CLOSED', 'SUPERSEDED'], hr_offers: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'], hr_candidates: ['APPLIED', 'SCREENED', 'INTERVIEW', 'SELECTED', 'OFFERED', 'ACCEPTED', 'JOINED', 'REJECTED'], hr_onboarding_tasks: ['OPEN', 'DONE', 'WAIVED'], hr_employees: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED'], hr_employee_changes: ['PENDING', 'SCHEDULED', 'APPLIED', 'REJECTED', 'RETURNED', 'CANCELLED'] },
  uniqueKeys: [{ table: 'hr_employees', columns: ['company_id', 'emp_code'] }],
});
/** Module "hr": human resources (Workforce-First, M07). Part 07.01 holds the employee master and employment records. The tables are `hr_*`. */
export const hr = {
  code: 'hr',
  name: 'HR & Workforce Management',
  routePrefix: '/api/v1/hr',
  ownerPart: '07.01, 07.02, 07.03',
  status: 'Employee master: profile, employment, statutory and bank details (masked), documents with expiry, history, approvals of new employees and of changes, user link, effective-dated separation with access removal, directory, import, overview',
  tables: TABLES,
  companyOptional: [],
  resources: ['employees', 'plans', 'requisitions', 'candidates', 'interviews', 'offers', 'offer-link', 'onboarding', 'deployments', 'deployment-board', 'crews', 'transfers', 'site-plans'],

  mount(api, { db, config: appConfig, publicApi }) {
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
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'hr_requisitions'").get()) {
      const recruit = createRecruitmentService({ db, vaultKey: appConfig.vaultKey, baseUrl: () => appConfig.appUrl ?? `http://localhost:${appConfig.port ?? 3000}` });
      bindRecruitment(db, recruit);
      listExports.register('hr.requisitions', { source: (actor, req) => recruit.reqRegister.exportSource(actor, req), hidden: () => [] });
      listExports.register('hr.offers', { source: (actor, req) => recruit.offerRegister.exportSource(actor, req), hidden: () => [] });
      runtime.jobs.register('hr.recruitment_cycle', () => { const out = { offersExpired: 0, anonymised: 0 }; for (const c of companies()) { const r = recruit.cycle(c); for (const k of Object.keys(out)) out[k] += r[k]; } return out; });
      runtime.scheduler.define({ code: 'hr.recruitment_cycle_daily', cron: '25 0 * * *', jobType: 'hr.recruitment_cycle', description: 'Daily (00:25): offers past their date lapse, the personal data of rejected candidates is removed after the retention period' });
      const rr = Router();
      rr.use(gate('ff.hr.p0702', 'Recruitment is'));
      rr.use(recruitRoutes({ recruit, exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
      api.use('/hr', rr);
      // the candidate's own link: no sign-in, the link is the proof (and the feature flag is the company's: the link names no company, so it follows the flag of the default environment)
      publicApi.use('/hr', offerLinkRoutes({ recruit }));
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'hr_deployments'").get()) {
      const dep = createDeploymentService({ db });
      bindDeployments(db, dep);
      const trf = createTransferService({ db, dep });
      bindTransfers(db, trf);
      listExports.register('hr.deployments', { source: (actor, req) => dep.register.exportSource(actor, req), hidden: () => [] });
      listExports.register('hr.transfers', { source: (actor, req) => trf.register.exportSource(actor, req), hidden: () => [] });
      try {
        widgetRegistry.register({ code: 'hr.deployed', provider: (ctx) => { const w = dep.widget(ctx.actor); return { value: w.value, unit: w.value === 1 ? 'person deployed' : 'people deployed', previous: null, trendPct: null, target: null, status: 'green', note: 'In force today on the sites you see.', drill: '/hr/deployment-board' }; } });
      } catch { /* registered once per process */ }
      runtime.jobs.register('hr.deployment_cycle', () => { const out = { started: 0, ended: 0, endingSoon: 0 }; for (const c of companies()) { const r = dep.cycle(c); for (const k of Object.keys(out)) out[k] += r[k]; } return out; }, { maxAttempts: 3 });
      runtime.scheduler.define({ code: 'hr.deployment_cycle_daily', cron: '35 0 * * *', jobType: 'hr.deployment_cycle', description: 'Daily (00:35): deployments that start today give their site access and join the messaging groups; those that ended lose them; project managers are told of deployments about to end.' });
      const dr = Router();
      dr.use(gate('ff.hr.p0703', 'Deployment is'));
      dr.use(deployRoutes({ dep, trf, exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
      api.use('/hr', dr);
    }
  },
};
