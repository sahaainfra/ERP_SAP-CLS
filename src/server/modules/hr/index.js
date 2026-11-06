import { join } from 'node:path';
import { Router } from 'express';
import { createLocalStorage } from '../../platform/files/storage.js';
import { eventTypes } from '../../platform/events/index.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports, listExportsOf } from '../../platform/list/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { widgetRegistry } from '../../platform/widgets/index.js';
import { createFlagService } from '../core/api.js';
import { bindPunches, createPunchService } from './punches.js';
import { bindRegister, createRegisterService } from './att-register.js';
import { bindRequests, createRequestService } from './att-requests.js';
import './reg-integrations.js';
import { registerRoutes } from './reg-routes.js';
import { bindLeave, createLeaveService } from './leave.js';
import { leaveRoutes } from './lv-routes.js';
import './lab-integrations.js';
import './trn-integrations.js';
import { bindLabour, createLabourService } from './labour.js';
import { labourRoutes } from './lab-routes.js';
import { bindEss, createEssService } from './ess.js';
import { bindTraining, createTrainingService } from './training.js';
import { bindPerformance, createPerformanceService } from './performance.js';
import { perfRoutes } from './perf-routes.js';
import { trainingRoutes } from './trn-routes.js';
import { essRoutes } from './ess-routes.js';
import { punchRoutes } from './punch-routes.js';
import { bindAttendance, createAttendanceService } from './attendance.js';
import { attRoutes } from './att-routes.js';
import { parseRules } from './att-validators.js';
import { bindDeployments, createDeploymentService, deploymentsOf } from './deployments.js';
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
  ['att.policy.approved', 'An attendance policy version was approved and governs the dates from its effective date: data { code, version, effectiveFrom, band }. Punch evaluation (07.05, 07.06), leave (07.07) and payroll (24.02, 24.03) resolve policies through the attendance service.'],
  ['att.assignment.changed', 'The policy, shift, weekly off or holiday calendar of the company, a site, a crew or an employee was assigned or ended: data { scopeType, scopeId, policyCode, shiftId, effectiveFrom, effectiveTo }.'],
  ['att.roster.changed', 'A roster pattern was made or ended, or a day was changed or swapped after approval: data { siteId, crewId, workDate, kind }.'],
  ['att.punch.recorded', 'An attendance punch was recorded (or a pending visit punch was decided): data { personType, personId, siteId, type, workDate, effectiveTime, result (ACCEPTED, FLAGGED, PENDING, REJECTED), reason, method, offline, insideFence, anomalies }. The attendance register (07.06), the DPR labour prefill (14.02) and the workforce dashboards (07.14) take it from here; a rejected punch does not count.'],
  ['att.anomaly.raised', 'A punch looked wrong and waits for review: data { punchId, personId, type, severity }.'],
  ['att.anomaly.reviewed', 'A reviewer accepted or rejected an anomaly: data { punchId, personId, type, decision }.'],
  ['att.period.closed', 'An attendance period was closed and is never recalculated: data { start, end, label }.'],
  ['att.period.locked', 'An attendance period was locked for a site (or all sites) after the approvals: data { lockId, periodStart, periodEnd, siteId, employees, days, paidDays, lopDays, otMinutes }. Payroll (24.02) takes the locked register as its input.'],
  ['att.period.reopened', 'A locked attendance period was reopened (HR manager and finance head approved): data { lockId, periodStart, periodEnd, siteId, reason }. Payroll takes the period again.'],
  ['att.arrears.raised', 'An approved change touched a day in a locked period; the register stayed as it was and the difference waits for payroll: data { personId, workDate, periodStart, siteId, deltaPaidDays, deltaLopDays, deltaOtMinutes }.'],
  ['att.regularisation.approved', 'A regularisation was approved and the day recomputed: data { docNo, employeeId, workDate, arrears, band }.'],
  ['att.overtime.approved', 'Overtime was approved (before or after the work): data { docNo, employeeId, workDate, arrears, band }. Labour hours reach the daily progress report (14.02) and labour cost (14.07) through the register.'],
  ['att.manual.approved', 'A manual attendance entry was approved (maker and checker) and the day recomputed: data { docNo, employeeId, workDate, arrears, band }.'],
  ['lv.application.approved', 'A leave application (or a new revision of it) was approved: data { docNo, revision, employeeId, leaveType, paid, from, to, halfDay, days }. The attendance register (07.06) shows the days as leave, approvals are delegated for the days (04.02) and payroll (24.02) takes the unpaid leave as loss of pay.'],
  ['lv.application.cancelled', 'An approved leave was cancelled before it started; the days went back to the balance and the register is recomputed: data { docNo, employeeId, from, to, days }.'],
  ['lv.balance.adjusted', 'A leave balance was adjusted by HR after approval: data { docNo, employeeId, leaveType, year, days }.'],
  ['lv.year_end.processed', 'Year-end processing of leave ran: balances were carried forward, encashed or lapsed: data { year, people, carry, lapse, encash }.'],
  ['lv.encashment.input', 'Leave to be encashed at year-end, one event per person and type: data { year, employeeId, leaveType, days }. Payroll (24.02) pays it.'],
  ['lab.worker.registered', 'A contract worker was registered and approved (supervisor, then the HR manager): data { workerCode, name, contractorId, tradeCode, skillCategory }. Attendance (07.05), HSE (19.01, 19.04), camp (19.07) and payroll (24.03) take the worker from here.'],
  ['lab.worker.updated', 'An approved worker was changed through an amendment: data { workerCode, contractorId, tradeCode }.'],
  ['lab.worker.clearance_changed', 'The induction or medical clearance of a worker changed: data { workerCode, induction, medical, medicalValidUntil }. A worker who is not cleared is not deployed.'],
  ['lab.worker.blacklisted', 'A worker was blacklisted for a safety violation: data { workerCode, contractorId, reason }. The worker is not deployed or punched in until HR lifts it.'],
  ['lab.worker.reinstated', 'A blacklisting was lifted: data { workerCode, reason }.'],
  ['lab.contractor.compliance_changed', 'The licence, registrations or the most workers allowed of a labour contractor changed: data { contractorId, licenceValidUntil, maxWorkers }.'],
  ['lab.contractor.licence_expiring', 'The CLRA licence of a labour contractor has expired or expires within the alert days; HR was told: data { contractorId, name, licenceValidUntil, expired }.'],
  ['lab.wage_rate.approved', 'A minimum wage notification or a contract rate was approved: data { docNo, kind, contractorId, tradeCode, skillCategory, stateCode, payBasis, rate, effectiveFrom }. Labour payroll (24.03) and costing take the rate from its date.'],
  ['ess.letter.approved', 'A letter request (employment, salary or no-objection certificate) was approved by the HR manager and waits to be issued: data { docNo, employeeId, letterType }.'],
  ['ess.letter.issued', 'A letter was issued from the template library and the employee can download it: data { docNo, employeeId, letterType, generatedDocId }.'],
  ['trn.session.approved', 'A training session is open for nomination (internal, or an external one with a fee approved): data { docNo, courseId, startAt }.'],
  ['trn.session.cancelled', 'An open training session was cancelled: data { docNo, reason }.'],
  ['trn.session.completed', 'A training session was completed: data { docNo, courseId, certificates }.'],
  ['trn.attendance.nominated', 'A person was nominated to a session: data { sessionId, personType, personId }.'],
  ['trn.attendance.recorded', 'A person signed in or was marked attended or absent: data { sessionId, personType, personId, attendance, score }.'],
  ['trn.cert.added', 'A certificate or licence was recorded: data { personType, personId, certType, validUntil }.'],
  ['trn.cert.verified', 'HR verified a certificate: data { personType, personId, certType, validUntil }. Permit-to-work (19.02) and plant operator assignment (17.02) ask the check service.'],
  ['trn.cert.revoked', 'A certificate was revoked: data { personType, personId, certType, reason }.'],
  ['trn.cert.expiring', 'A certificate ends within its alert days: data { personType, personId, certType, validUntil }.'],
  ['trn.cert.expired', 'A certificate has expired: data { personType, personId, certType, validUntil }.'],
  ['trn.skill.assessed', 'A skill level was assessed: data { personType, personId, skillCode, level }.'],
  ['perf.cycle.opened', 'A review cycle was opened: data { code, startDate, endDate }.'],
  ['perf.cycle.closed', 'A review cycle was closed: data { code }.'],
  ['perf.review.launched', 'The reviews of a cycle were made: data { code, reviews }.'],
  ['perf.review.self_submitted', 'An employee sent their self-review: data { employeeId, cycleId }.'],
  ['perf.review.manager_reviewed', 'A manager sent their review: data { employeeId, cycleId }.'],
  ['perf.review.calibrated', 'HR calibrated a rating: data { employeeId, cycleId, managerRating, rating }.'],
  ['perf.review.approved', 'A final appraisal rating was approved: data { docNo, employeeId, cycleId, finalRating, band }. Payroll increments (24.01) read the rating from this event.'],
  ['perf.kpi.disputed', 'An employee disputed a KPI value (it is frozen): data { employeeId, kpiCode, period }.'],
  ['perf.kpi.dispute_resolved', 'HR resolved a KPI dispute: data { employeeId, kpiCode, period, outcome }.'],
  ['perf.goal.agreed', 'A manager agreed a goal: data { employeeId, cycleId, title, weight }.'],
  ['perf.feedback.given', 'Feedback, recognition or a one-to-one note was written: data { employeeId, kind }.'],
  ['hr.offer.declined', 'The candidate declined the offer: data { docNo, candidateId, response }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'hr', description });

const TABLES = ['perf_cycles', 'perf_kpis', 'perf_kpi_values', 'perf_kpi_disputes', 'perf_goals', 'perf_feedback', 'perf_reviews', 'trn_courses', 'trn_sessions', 'trn_attendance', 'trn_cert_types', 'trn_certifications', 'trn_skill_defs', 'trn_skills', 'ess_requests', 'lab_workers', 'lab_contractor_compliance', 'lab_wage_rates', 'lv_types', 'lv_entitlements', 'lv_ledger', 'lv_applications', 'lv_adjustments', 'lv_year_runs', 'att_daily', 'att_regularisations', 'att_overtime_requests', 'att_manual_entries', 'att_period_locks', 'att_arrears', 'att_punches', 'att_anomalies', 'att_visits', 'att_device_bindings', 'att_site_settings', 'att_shifts', 'att_policies', 'att_policy_assignments', 'att_rosters', 'att_roster_changes', 'att_period_defs', 'att_periods', 'hr_site_plans', 'hr_crews', 'hr_crew_members', 'hr_deployments', 'hr_transfers', 'hr_headcount_plans', 'hr_requisitions', 'hr_candidates', 'hr_interviews', 'hr_offers', 'hr_onboarding_tasks', 'hr_employees', 'hr_employee_statutory', 'hr_employee_banks', 'hr_employee_contacts', 'hr_employee_education', 'hr_employee_experience', 'hr_employee_documents', 'hr_employee_changes', 'hr_employee_history'];
integrityRegistry.register({
  allowNegative: [], companyOptional: [],
  statuses: { perf_reviews: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED'], trn_sessions: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'COMPLETED'], ess_requests: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'ISSUED'], lab_workers: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'], lab_wage_rates: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'], lv_applications: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'], lv_adjustments: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'], lv_types: ['ACTIVE', 'INACTIVE'], att_daily: ['PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY', 'WEEKLY_OFF', 'ON_DUTY', 'COMP_OFF', 'MISSING_PUNCH', 'HOLIDAY_WORKED', 'WEEKLY_OFF_WORKED'], att_regularisations: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'], att_overtime_requests: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'], att_manual_entries: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'], att_period_locks: ['LOCKED', 'REOPEN_PENDING', 'REOPENED'], att_arrears: ['OPEN', 'FOLDED'], att_anomalies: ['OPEN', 'PENDING_APPROVAL', 'ACCEPTED', 'REJECTED'], att_visits: ['SUBMITTED', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED'], att_punches: ['ACCEPTED', 'FLAGGED', 'REJECTED', 'PENDING'], att_policies: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'], att_roster_changes: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'], att_shifts: ['ACTIVE', 'INACTIVE'], att_periods: ['OPEN', 'CLOSED'], hr_deployments: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'CLOSED', 'SUPERSEDED'], hr_transfers: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'CLOSED', 'SUPERSEDED'], hr_requisitions: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'CLOSED', 'SUPERSEDED'], hr_offers: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'], hr_candidates: ['APPLIED', 'SCREENED', 'INTERVIEW', 'SELECTED', 'OFFERED', 'ACCEPTED', 'JOINED', 'REJECTED'], hr_onboarding_tasks: ['OPEN', 'DONE', 'WAIVED'], hr_employees: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED'], hr_employee_changes: ['PENDING', 'SCHEDULED', 'APPLIED', 'REJECTED', 'RETURNED', 'CANCELLED'] },
  uniqueKeys: [{ table: 'hr_employees', columns: ['company_id', 'emp_code'] }],
});
/** Module "hr": human resources (Workforce-First, M07). Part 07.01 holds the employee master and employment records. The tables are `hr_*`. */
export const hr = {
  code: 'hr',
  name: 'HR & Workforce Management',
  routePrefix: '/api/v1/hr',
  ownerPart: '07.01, 07.02, 07.03, 07.04, 07.05, 07.06, 07.07, 07.08, 07.09, 07.10, 07.11',
  status: 'Employee master: profile, employment, statutory and bank details (masked), documents with expiry, history, approvals of new employees and of changes, user link, effective-dated separation with access removal, directory, import, overview',
  tables: TABLES,
  companyOptional: [],
  resources: ['reviews', 'performance', 'sessions', 'training', 'employees', 'plans', 'requisitions', 'candidates', 'interviews', 'offers', 'offer-link', 'onboarding', 'deployments', 'deployment-board', 'crews', 'transfers', 'site-plans', 'att', 'regularisations', 'overtime-requests', 'manual-entries', 'applications', 'leave', 'workers', 'labour', 'ess'],

  mount(api, { db, config: appConfig, publicApi, storagePath }) {
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
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'att_shifts'").get()) {
      const att = createAttendanceService({ db, validRules: parseRules });
      bindAttendance(db, att);
      listExports.register('att.shifts', { source: (actor, req) => att.shifts.exportSource(actor, req), hidden: () => [] });
      listExports.register('att.policies', { source: (actor, req) => att.policies.exportSource(actor, req), hidden: () => [] });
      try {
        widgetRegistry.register({ code: 'att.roster_waiting', provider: (ctx) => { const w = att.widget(ctx.actor); return { value: w.value, unit: w.value === 1 ? 'roster change waiting' : 'roster changes waiting', previous: null, trendPct: null, target: null, status: w.value > 0 ? 'amber' : 'green', note: 'Waiting for the supervisor or the project manager.', drill: '/hr/attendance/roster' }; } });
      } catch { /* registered once per process */ }
      const ar = Router();
      ar.use(gate('ff.hr.p0704', 'Attendance configuration is'));
      ar.use(attRoutes({ att, exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
      api.use('/hr', ar);
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'att_punches'").get()) {
      const punch = createPunchService({ db, storage: createLocalStorage({ root: join(storagePath ?? join(process.cwd(), 'data'), 'files') }) });
      bindPunches(db, punch);
      runtime.jobs.register('att.punch_retention', () => { let removed = 0; for (const c of companies()) removed += punch.retention(c).removed; return { removed }; }, { maxAttempts: 3 });
      runtime.scheduler.define({ code: 'att.punch_retention_daily', cron: '45 0 * * *', jobType: 'att.punch_retention', description: 'Daily (00:45): the coordinates and the selfie of punches older than the retention period are removed; the punch stays as a record of attendance.' });
      try {
        widgetRegistry.register({ code: 'att.anomalies_open', provider: (ctx) => { const w = punch.widget(ctx.actor); return { value: w.value, unit: w.value === 1 ? 'attendance anomaly' : 'attendance anomalies', previous: null, trendPct: null, target: null, status: w.value > 0 ? 'amber' : 'green', note: 'Waiting for review.', drill: '/att/anomalies' }; } });
      } catch { /* registered once per process */ }
      const pr = Router();
      pr.use(gate('ff.hr.p0705', 'Geo-fenced attendance is'));
      pr.use(punchRoutes({ punch }, { idempotent: idempotency(db) }));
      api.use('/att', pr);
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'att_daily'").get()) {
      const dep = deploymentsOf(db);
      const regsvc = createRegisterService({ db, dep });
      bindRegister(db, regsvc);
      const rq = createRequestService({ db, dep });
      bindRequests(db, rq);
      listExports.register('att.daily', { source: (actor, req) => regsvc.daily.exportSource(actor, req), hidden: () => [] });
      listExports.register('att.register', { source: (actor, req) => regsvc.registerExport(actor, req), hidden: () => [] });
      listExports.register('att.muster', { source: (actor, req) => regsvc.registerExport(actor, req, { muster: true }), hidden: () => [] });
      listExports.register('hr.regularisations', { source: (actor, req) => rq.registers.regularisation.exportSource(actor, req), hidden: () => [] });
      listExports.register('hr.overtime_requests', { source: (actor, req) => rq.registers.overtime.exportSource(actor, req), hidden: () => [] });
      listExports.register('att.manual_entries', { source: (actor, req) => rq.registers.manual.exportSource(actor, req), hidden: () => [] });
      // an input of a day changed: a punch arrives (or a pending visit punch is decided); the approvals recompute the day themselves
      runtime.bus.subscribe('att.punch.recorded', (event) => {
        const d = event.data ?? {};
        if (d.personType !== 'EMPLOYEE' || !d.workDate || !['ACCEPTED', 'FLAGGED'].includes(d.result)) return;
        regsvc.queueChange(event.companyId ?? event.company_id, d.personId, d.workDate);
      }, { consumer: 'att.register' });
      runtime.jobs.register('att.register_nightly', () => { const out = { employees: 0, days: 0, arrears: 0 }; for (const c of companies()) { const r = regsvc.nightly(c); for (const k of Object.keys(out)) out[k] += r[k]; } return out; }, { maxAttempts: 3 });
      runtime.scheduler.define({ code: 'att.register_nightly_daily', cron: '5 1 * * *', jobType: 'att.register_nightly', description: 'Daily (01:05): the attendance register of yesterday and the two days before is computed again, so that late punches and approvals are in it; days in a locked period are not rewritten (arrears are kept).' });
      try {
        widgetRegistry.register({ code: 'att.missing_punches', provider: (ctx) => { const w = regsvc.widget(ctx.actor); return { value: w.value, unit: w.value === 1 ? 'missing punch yesterday' : 'missing punches yesterday', previous: null, trendPct: null, target: null, status: w.value > 0 ? 'amber' : 'green', note: 'Days to regularise before the period is locked' }; } });
      } catch { /* registered once per process */ }
      const { hr: hrRoutes, att: attRoutes2 } = registerRoutes({ reg: regsvc, req: rq, exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) });
      const hrR = Router(); hrR.use(gate('ff.hr.p0706', 'The attendance register is')); hrR.use(hrRoutes); api.use('/hr', hrR);
      const attR = Router(); attR.use(gate('ff.hr.p0706', 'The attendance register is')); attR.use(attRoutes2); api.use('/att', attR);
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'lv_applications'").get()) {
      const lv = createLeaveService({ db, dep: deploymentsOf(db) });
      bindLeave(db, lv);
      listExports.register('hr.leave_applications', { source: (actor, req) => lv.register.exportSource(actor, req), hidden: () => [] });
      listExports.register('lv.balances', { source: (actor, req) => lv.balances.exportSource(actor, req), hidden: () => [] });
      runtime.jobs.register('lv.daily', () => { const out = { credited: 0, compOff: 0, lapsed: 0 }; for (const c of companies()) { const r = lv.daily(c); for (const k of Object.keys(out)) out[k] += r[k]; } return out; }, { maxAttempts: 3 });
      runtime.scheduler.define({ code: 'lv.daily_run', cron: '50 0 * * *', jobType: 'lv.daily', description: 'Daily (00:50): the accrual of the month is credited to everyone not yet credited (a joiner mid-month gets a pro-rata share), comp-off earned on days off is credited, expired comp-off lapses.' });
      try {
        widgetRegistry.register({ code: 'lv.approvals_waiting', provider: (ctx) => { const w = lv.widget(ctx.actor); return { value: w.value, unit: w.value === 1 ? 'leave application waiting' : 'leave applications waiting', previous: null, trendPct: null, target: null, status: w.value > 0 ? 'amber' : 'green', note: 'Waiting for your decision' }; } });
      } catch { /* registered once per process */ }
      const lr = Router(); lr.use(gate('ff.hr.p0707', 'Leave management is'));
      lr.use(leaveRoutes({ lv, exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
      api.use('/hr', lr);
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'lab_workers'").get()) {
      const lab = createLabourService({ db, dep: deploymentsOf(db), vaultKey: appConfig.vaultKey });
      bindLabour(db, lab);
      listExports.register('hr.workers', { source: (actor, req) => lab.register.exportSource(actor, req), hidden: () => [] });
      listExports.register('hr.wage_rates', { source: (actor, req) => lab.wages.exportSource(actor, req), hidden: () => [] });
      runtime.jobs.register('lab.daily', () => { const out = { licencesAlerted: 0, medicalExpired: 0 }; for (const c of companies()) { const r = lab.cycle(c); for (const k of Object.keys(out)) out[k] += r[k]; } return out; }, { maxAttempts: 3 });
      runtime.scheduler.define({ code: 'lab.daily_check', cron: '55 0 * * *', jobType: 'lab.daily', description: 'Daily (00:55): contractors whose CLRA licence has ended or ends within the alert days are told to HR (once for each state); medical clearances that ran out are marked expired.' });
      try {
        widgetRegistry.register({ code: 'lab.licences_expiring', provider: (ctx) => { const w = lab.widget(ctx.actor); return { value: w.value, unit: w.value === 1 ? 'contractor needs attention' : 'contractors need attention', previous: null, trendPct: null, target: null, status: w.value > 0 ? 'amber' : 'green', note: 'Licence expired or ending, or more workers than licensed' }; } });
      } catch { /* registered once per process */ }
      const br = Router(); br.use(gate('ff.hr.p0708', 'Contract labour is'));
      br.use(labourRoutes({ lab, exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
      api.use('/hr', br);
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ess_requests'").get()) {
      const ess = createEssService({ db, dep: deploymentsOf(db) });
      bindEss(db, ess);
      try {
        widgetRegistry.register({ code: 'ess.team_present', provider: (ctx) => { const w = ess.team.widget(ctx.actor); return { value: w.value, unit: 'of your team present today', previous: null, trendPct: null, target: w.total ?? null, status: 'green', note: 'People who report to you, directly or through others' }; } });
      } catch { /* registered once per process */ }
      const er = Router(); er.use(gate('ff.hr.p0709', 'Self-service is'));
      er.use(essRoutes({ ess }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
      api.use('/hr', er);
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'trn_sessions'").get()) {
      const trn = createTrainingService({ db, dep: deploymentsOf(db) });
      bindTraining(db, trn);
      listExports.register('hr.training_sessions', { source: (actor, req) => trn.sessions.exportSource(actor, req), hidden: () => [] });
      listExports.register('hr.certifications', { source: (actor, req) => trn.certs.exportSource(actor, req), hidden: () => [] });
      runtime.jobs.register('trn.daily', () => { const out = { alerted: 0 }; for (const c of companies()) out.alerted += trn.cycle(c).alerted; return out; }, { maxAttempts: 3 });
      runtime.scheduler.define({ code: 'trn.daily_check', cron: '58 0 * * *', jobType: 'trn.daily', description: 'Daily (00:58): certificates and licences that have expired or end within their alert days are told to HR and to the holder (once for each state).' });
      try {
        widgetRegistry.register({ code: 'trn.certs_expiring', provider: (ctx) => { const w = trn.widget(ctx.actor); return { value: w.value, unit: w.value === 1 ? 'certificate needs attention' : 'certificates need attention', previous: null, trendPct: null, target: null, status: w.value > 0 ? 'amber' : 'green', note: 'Expired or ending within the alert days' }; } });
      } catch { /* registered once per process */ }
      const tr = Router(); tr.use(gate('ff.hr.p0710', 'Training is'));
      tr.use(trainingRoutes({ trn, exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
      api.use('/hr', tr);
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'perf_reviews'").get()) {
      const perf = createPerformanceService({ db, dep: deploymentsOf(db) });
      bindPerformance(db, perf);
      listExports.register('hr.reviews', { source: (actor, req) => perf.reviews.exportSource(actor, req), hidden: () => [] });
      runtime.jobs.register('perf.daily', () => { const out = { people: 0, values: 0 }; for (const c of companies()) { const r = perf.cycle(c); out.people += r.people; out.values += r.values; } return out; }, { maxAttempts: 3 });
      runtime.scheduler.define({ code: 'perf.daily_compute', cron: '20 1 * * *', jobType: 'perf.daily', description: 'Daily (01:20): the KPIs of everybody are computed again for the month so far (the first days of a month finish the month before); a disputed or adjusted value is never overwritten.' });
      try {
        widgetRegistry.register({ code: 'perf.calibration_waiting', provider: (ctx) => { const w = perf.widget(ctx.actor); return { value: w.value, unit: w.value === 1 ? 'review waits for calibration' : 'reviews wait for calibration', previous: null, trendPct: null, target: null, status: w.value > 0 ? 'amber' : 'green', note: 'Manager review is done; HR sets the final rating' }; } });
      } catch { /* registered once per process */ }
      const pr = Router(); pr.use(gate('ff.hr.p0711', 'Performance management is'));
      pr.use(perfRoutes({ perf, exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
      api.use('/hr', pr);
    }
  },
};
