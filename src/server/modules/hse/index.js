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
import { waCheckHooks } from '../site/service.js';
import { labourOf } from '../hr/labour.js';
import { STATUS } from '../qa/flow.js';
import { createPlanService } from './plans.js';
import { createInductionService } from './induction.js';
import { createPermitService } from './permits.js';
import { permitRoutes } from './permit-routes.js';
import { createIncidentService } from './incidents.js';
import { incidentRoutes } from './incident-routes.js';
import { createSafetyService } from './safety.js';
import { safetyRoutes } from './safety-routes.js';
import { createEsgService } from './esg.js';
import { esgRoutes } from './esg-routes.js';
import { createSecurityService } from './security.js';
import { securityRoutes } from './security-routes.js';
import { createCampService } from './camp.js';
import { campRoutes } from './camp-routes.js';
import { createKpiService } from './kpi.js';
import { kpiRoutes } from './kpi-routes.js';
import { registerProject360Widget } from '../proj/p360.js';
import { widgetRegistry } from '../../platform/widgets/index.js';
import { hseRoutes } from './routes.js';

const services = new WeakMap();
export const hseOf = (db) => services.get(db) ?? null;
export const HSE_DOCS = { plan: 'HSE_PLAN', hira: 'HSE_HIRA', permit: 'HSE_PERMIT', incident: 'HSE_INCIDENT', penalty: 'HSE_PENALTY', roster: 'SCY_ROSTER', secIncident: 'SCY_INCIDENT', recovery: 'CAMP_RECOVERY' };

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['hse.plan.approved', 'A project HSE plan version was approved and is in force (part 19.01): data { planId, docNo, projectId, siteId, versionNo }.'],
  ['hse.hira.approved', 'A hazard identification and risk assessment was approved (part 19.01): data { hiraId, docNo, projectId, siteId, activityId, activityType, riskLevel, maxResidual, versionNo }. Permits (19.02) and the work authorisation check read it.'],
  ['hse.jsa.released', 'A job safety analysis was released for the day (part 19.01): data { jsaId, docNo, projectId, siteId, waId, activityId, hiraId, validOn }. A work authorisation (14.01) that needs one reads it.'],
  ['hse.jsa.completed', 'A job safety analysis was closed after the work (part 19.01): data { jsaId, docNo, projectId }.'],
  ['hse.induction.recorded', 'A person passed the site induction (part 19.01): data { inductionId, docNo, projectId, siteId, personType, personId, personCode, contentId, scorePct, passed, validUntil, via }. The labour register (07.08) shows the worker as cleared.'],
  ['hse.induction.failed', 'A person did not reach the pass mark of the induction quiz (part 19.01): same data as hse.induction.recorded.'],
  ['hse.induction.expired', 'The induction of a worker passed its date and the worker is no longer cleared (part 19.01): data { inductionId, docNo, projectId, siteId, personType, personId, personCode, validUntil }. Deployment (07.04) is blocked or warned as configured.'],
  ['hse.medical.recorded', 'The medical fitness status of a worker was recorded (part 19.01): data { recordId, workerId, workerCode, fitness, validUntil }. Status only, no clinical detail.'],
  ['hse.toolbox.recorded', 'A toolbox talk was recorded with its attendance (part 19.01): data { talkId, docNo, projectId, siteId, talkDate, topic, attendeeCount, withoutInduction }.'],
  ['hse.permit.requested', 'A permit to work was sent for approval (part 19.02): data { permitId, docNo, projectId, siteId, typeId, typeCode, riskClass, locationId, waId, validFrom, validTo, permitStatus }.'],
  ['hse.permit.activated', 'A permit to work was approved and is active (part 19.02): same data as hse.permit.requested. The work authorisation check (14.01) reads it.'],
  ['hse.permit.extended', 'An active permit was extended (part 19.02): same data plus previousValidTo, reason.'],
  ['hse.permit.suspended', 'An active permit was suspended for an unsafe condition, a failed gas test or an incident (part 19.02): same data plus reason. The work stops.'],
  ['hse.permit.resumed', 'A suspended permit was resumed after the checks were made again (part 19.02): same data as hse.permit.requested.'],
  ['hse.permit.closed', 'A permit was closed with the site handback (part 19.02): same data plus handback.'],
  ['hse.permit.expired', 'A permit ran out of time and is no longer valid for a work authorisation (part 19.02): same data as hse.permit.requested.'],
  ['hse.incident.reported', 'An incident or near miss was reported (part 19.03): data { incidentId, docNo, projectId, siteId, locationId, incidentType, classification, severity, occurredAt, lostDays, persons, serious, reportedBy }. HSE, the project manager and (serious) the director are alerted, permits are suspended, claims (21.06) and the HSE KPIs (19.08) read it.'],
  ['hse.incident.reclassified', 'An incident was reclassified (part 19.03): same data plus from.'],
  ['hse.incident.investigated', 'The investigation of an incident was recorded (part 19.03): same data plus rootCause.'],
  ['hse.incident.statutory_reported', 'A statutory notification of an incident was recorded (part 19.03): same data plus authority, form, referenceNo.'],
  ['hse.incident.claim_linked', 'An insurance claim was linked to an incident (part 19.03): same data plus claimRef, insurer. Claims (21.06) read it.'],
  ['hse.incident.closed', 'The closure of an incident was approved (part 19.03): same data plus closedAt.'],
  ['hse.lesson.shared', 'A lesson learned from a closed incident was shared with every site (part 19.03): same data plus title.'],
  ['hse.observation.raised', 'A safety observation was raised (part 19.04): data { observationId, docNo, projectId, siteId, obsType, severity, partnerId, responsibleType, dueAt, state }.'],
  ['hse.observation.closed', 'A safety observation was verified and closed (part 19.04): same data plus closedOn, onTime.'],
  ['hse.observation.escalated', 'A safety observation passed its time and was escalated (part 19.04): same data plus level (1 project manager, 2 director).'],
  ['hse.penalty.approved', 'A penalty or back-charge against a subcontractor for a safety violation was approved (part 19.04): data { observationId, docNo, projectId, siteId, partnerId, amount (rupees), reason, severity }. Subcontractor bills (22.05) deduct it.'],
  ['hse.inspection.recorded', 'A scheduled safety inspection was done and linked (part 19.04): data { scheduleId, code, registerType, projectId, siteId, inspectionId, result, observationId }.'],
  ['hse.ppe.issued', 'PPE was issued to a worker or employee (part 19.04): data { issueId, docNo, projectId, siteId, personType, personId, personCode, ppeItemId, ppeCode, stockItemId, qty, replacement, replaceDue, issueRef }. Stores (16.04, issue type PPE) read it.'],
  ['hse.ppe.returned', 'PPE was returned (part 19.04): data { issueId, docNo, personType, personId, ppeItemId, condition, projectId }.'],
  ['hse.contractor_score.published', 'The safety score of a subcontractor for the month was published for the vendor scorecard (part 19.04): data { partnerId, name, period, score, band, workers, inductionPct, ppePct, violations, incidents }. Vendor scorecards (15.08) take it.'],
  ['hse.esg.reading_recorded', 'An environmental reading was recorded or pulled (part 19.05): data { readingId, projectId, siteId, metric, period, value, uom, breach, origin }.'],
  ['hse.esg.limit_breached', 'A monitoring reading (dust, noise, turbidity) was above its limit (part 19.05): data { readingId, projectId, siteId, metric, value, limit, uom, date }.'],
  ['hse.esg.waste_recorded', 'Construction waste was recorded with its disposal (part 19.05): data { wasteId, projectId, siteId, category, qtyKg, disposal, vendorId, manifestNo }.'],
  ['hse.esg.factor_activated', 'A new emission factor version was activated by someone other than its maker (part 19.05): data { factorId, metric, scope, factor, unit, versionNo, effectiveFrom }.'],
  ['hse.patrol.scanned', 'A patrol checkpoint was scanned by a guard (part 19.06): data { scanId, checkpointId, checkpointCode, siteId, guardId, guardCode, distanceM, offSite }.'],
  ['hse.patrol.missed', 'A checkpoint was not scanned in its patrol slot (part 19.06): data { checkpointId, code, siteId, date, slotFrom, slotTo }.'],
  ['hse.visitor.registered', 'A visitor was pre-registered or registered at the gate (part 19.06): data { visitId, docNo, projectId, siteId, host, preRegistered, expectedOn }.'],
  ['hse.visitor.approved', 'The host approved a visitor (part 19.06): data { visitId, docNo, siteId, host, reason }.'],
  ['hse.visitor.declined', 'The host declined a visitor (part 19.06): same data with the reason.'],
  ['hse.visitor.checked_in', 'A visitor entered the site (part 19.06): data { visitId, docNo, siteId, host }.'],
  ['hse.visitor.checked_out', 'A visitor left the site (part 19.06): data { visitId, docNo, siteId, minutes }.'],
  ['hse.visitor.overstay', 'A visitor stayed beyond the hours allowed (part 19.06): data { visitId, docNo, siteId, host, checkIn, maxHours }.'],
  ['hse.security_incident.reported', 'A security incident (theft, trespass, damage) was reported (part 19.06): data { incidentId, docNo, projectId, siteId, incidentType, occurredAt, loss }. The HSE dashboard (19.08) reads it.'],
  ['hse.security_incident.closed', 'The closure of a security incident was approved (part 19.06): data { incidentId, docNo, siteId, incidentType, loss }.'],
  ['hse.handover.logged', 'A guard shift handover was logged (part 19.06): data { handoverId, siteId, postId, shift, issues }.'],
  ['hse.camp.allocated', 'A worker or employee was given a bed in a labour camp (part 19.07): data { allocationId, docNo, campId, roomId, bedNo, personType, personId, contractorId, projectId, siteId }.'],
  ['hse.camp.checked_out', 'A resident left the camp and the bed is free (part 19.07): data { allocationId, personType, personId, campId }.'],
  ['hse.camp.inspected', 'A welfare inspection of a camp was recorded (part 19.07): data { inspectionId, campId, area, result, observationId, projectId, siteId }. The HSE dashboard (19.08) reads it.'],
  ['hse.camp.recovery_approved', 'The mess and bed charges recovered from a contractor for a month were approved (part 19.07): data { recoveryId, docNo, campId, projectId, siteId, contractorId, period, mealsServed, bedDays, amount (rupees) }. Subcontractor bills (22.05) deduct it.'],
  ['hse.kpi.breached', 'The lost-time injury frequency rate of the year is over its target (part 19.08): data { metric, value, target, period, manHours, lti }. The control towers read it.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'hse', description });

integrityRegistry.register({
  statuses: { hse_plans: Object.keys(STATUS), hse_hira: Object.keys(STATUS), hse_inductions: Object.keys(STATUS), hse_toolbox_talks: Object.keys(STATUS), hse_jsa: ['DRAFT', 'ISSUED', 'COMPLETED', 'CANCELLED'], hse_induction_content: ['ACTIVE', 'INACTIVE'], hse_toolbox_topics: ['ACTIVE', 'INACTIVE'], hse_permits: Object.keys(STATUS), hse_permit_types: ['ACTIVE', 'INACTIVE'], hse_incidents: Object.keys(STATUS), hse_incident_actions: ['OPEN', 'DONE', 'CANCELLED'], hse_observations: Object.keys(STATUS), hse_inspection_schedules: ['ACTIVE', 'INACTIVE'], hse_ppe_items: ['ACTIVE', 'INACTIVE'], hse_ppe_issues: ['ISSUED', 'RETURNED', 'REPLACED', 'CANCELLED'], hse_equipment_register: ['ACTIVE', 'OUT_OF_SERVICE', 'RETIRED'], esg_emission_factors: ['DRAFT', 'ACTIVE', 'RETIRED'], esg_permits: ['ACTIVE', 'SURRENDERED'], scy_rosters: Object.keys(STATUS), scy_incidents: Object.keys(STATUS), scy_posts: ['ACTIVE', 'INACTIVE'], scy_checkpoints: ['ACTIVE', 'INACTIVE'], camp_camps: ['ACTIVE', 'INACTIVE'], camp_rooms: ['ACTIVE', 'MAINTENANCE', 'INACTIVE'], camp_allocations: ['ALLOCATED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'], camp_recoveries: Object.keys(STATUS) },
  uniqueKeys: [{ table: 'hse_plans', columns: ['company_id', 'doc_no'] }, { table: 'hse_hira', columns: ['company_id', 'doc_no'] }, { table: 'hse_jsa', columns: ['company_id', 'doc_no'] }, { table: 'hse_inductions', columns: ['company_id', 'doc_no'] }, { table: 'hse_toolbox_talks', columns: ['company_id', 'doc_no'] }, { table: 'hse_induction_content', columns: ['company_id', 'code'] }, { table: 'hse_toolbox_topics', columns: ['company_id', 'code'] }, { table: 'hse_permits', columns: ['company_id', 'doc_no'] }, { table: 'hse_permit_types', columns: ['company_id', 'code'] }, { table: 'hse_incidents', columns: ['company_id', 'doc_no'] }, { table: 'hse_observations', columns: ['company_id', 'doc_no'] }, { table: 'hse_ppe_issues', columns: ['company_id', 'doc_no'] }, { table: 'hse_inspection_schedules', columns: ['company_id', 'code'] }, { table: 'hse_ppe_items', columns: ['company_id', 'code'] }, { table: 'hse_equipment_register', columns: ['company_id', 'tag'] }, { table: 'hse_contractor_scores', columns: ['company_id', 'partner_id', 'period'] }, { table: 'esg_emission_factors', columns: ['company_id', 'metric', 'version_no'] }, { table: 'esg_permits', columns: ['company_id', 'permit_type', 'permit_no'] }, { table: 'scy_rosters', columns: ['company_id', 'doc_no'] }, { table: 'scy_visitors', columns: ['company_id', 'doc_no'] }, { table: 'scy_incidents', columns: ['company_id', 'doc_no'] }, { table: 'scy_posts', columns: ['company_id', 'code'] }, { table: 'scy_checkpoints', columns: ['company_id', 'code'] }, { table: 'camp_camps', columns: ['company_id', 'code'] }, { table: 'camp_allocations', columns: ['company_id', 'doc_no'] }, { table: 'camp_recoveries', columns: ['company_id', 'doc_no'] }],
});

export const hse = {
  code: 'hse',
  name: 'HSE and Site Security',
  routePrefix: '/api/v1/hse',
  ownerPart: '19.01',
  status: 'HSE plans, HIRA (5 x 5) and job safety analyses, site inductions with QR attendance, quiz and validity (feeding worker clearance), toolbox talks with attendance and photographs, medical fitness status.',
  tables: ['camp_camps', 'camp_rooms', 'camp_allocations', 'camp_meals', 'camp_inspections', 'camp_assets', 'camp_recoveries', 'scy_posts', 'scy_checkpoints', 'scy_patrol_scans', 'scy_rosters', 'scy_visitors', 'scy_incidents', 'scy_handovers', 'esg_readings', 'esg_waste', 'esg_emission_factors', 'esg_permits', 'hse_observations', 'hse_inspection_schedules', 'hse_ppe_items', 'hse_ppe_issues', 'hse_equipment_register', 'hse_contractor_scores', 'hse_incidents', 'hse_incident_actions', 'hse_permits', 'hse_permit_types', 'hse_plans', 'hse_hira', 'hse_jsa', 'hse_induction_content', 'hse_inductions', 'hse_toolbox_topics', 'hse_toolbox_talks', 'hse_medical_records'],
  resources: ['camps', 'camp-rooms', 'camp-assets', 'allocations', 'camp-meals', 'camp-recoveries', 'camp-inspections', 'camp-occupancy', 'camp-mess', 'security-posts', 'checkpoints', 'patrol', 'rosters', 'visitors', 'security-incidents', 'handovers', 'gate-movements', 'esg', 'observations', 'inspection-schedules', 'ppe', 'ppe-items', 'equipment', 'contractor-scores', 'incidents', 'lessons', 'permits', 'permit-types', 'plans', 'hira', 'jsa', 'induction-content', 'inductions', 'medical', 'toolbox-topics', 'toolbox-talks', 'compliance'],
  /** Later parts of the module add their routes and services here. */
  parts: new Map(),
  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'hse_plans'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment }); const base = createBase({ db });
    const pl = createPlanService({ db, base, flags }); const ind = createInductionService({ db, base, flags });
    pl.setLabour((actor, badge) => labourOf(db)?.byToken(actor.companyId, badge) ?? null);
    const pm = createPermitService({ db, base, flags });
    const inc = createIncidentService({ db, base, flags, permits: () => pm.permits });
    const sf = createSafetyService({ db, base, flags });
    const es = createEsgService({ db, base, flags });
    const sc = createSecurityService({ db, base, flags });
    const cm = createCampService({ db, base, flags, observations: () => sf.observations });
    const kp = createKpiService({ db, base, flags, parts: () => ({ inc, ind, sf, cm }) });
    const deciders = { [HSE_DOCS.plan]: pl.plans.decide, [HSE_DOCS.hira]: pl.hira.decide, [HSE_DOCS.permit]: pm.permits.decide, [HSE_DOCS.incident]: inc.incidents.decide, [HSE_DOCS.penalty]: sf.observations.decide, [HSE_DOCS.roster]: sc.rosters.decide, [HSE_DOCS.secIncident]: sc.secIncidents.decide, [HSE_DOCS.recovery]: cm.recoveries.decide };
    const svc = { ...pl, ...ind, ...pm, ...inc, ...sf, ...es, ...sc, ...cm, kpi: kp, waCheck: pl.waCheck, waPermitCheck: pm.waCheck, exportHira: pl.exportCsv };
    const ctx = { svc, base, flags, deciders, parts: { permits: (r, h) => permitRoutes(r, svc, h), incidents: (r, h) => incidentRoutes(r, svc, h), safety: (r, h) => safetyRoutes(r, svc, h), esg: (r, h) => esgRoutes(r, svc, h), security: (r, h) => securityRoutes(r, svc, h), camp: (r, h) => campRoutes(r, svc, h), kpi: (r, h) => kpiRoutes(r, svc, h) } }; for (const [, make] of hse.parts) make(db, ctx);
    services.set(db, ctx);
    listExports.register('hse.plans', { source: (actor, req) => { base.need(actor, 'hse.plan.export', 'export HSE plans'); return pl.plans.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('hse.hira', { source: (actor, req) => { base.need(actor, 'hse.hira.export', 'export the HIRA register'); return pl.hira.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('hse.inductions', { source: (actor, req) => { base.need(actor, 'hse.induction.export', 'export inductions'); return ind.inductions.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    listExports.register('hse.toolbox_talks', { source: (actor, req) => { base.need(actor, 'hse.toolbox_talk.export', 'export toolbox talks'); return ind.talks.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    const runtime = runtimeOf(db);
    runtime?.jobs?.register('hse.induction_sweep', (jctx) => { let expired = 0; let told = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) { const r = ind.sweep(c.id); expired += r.expired; told += r.told; } jctx.log(`${expired} induction(s) expired, ${told} person(s) told`); return { expired, told }; }, { maxAttempts: 2, description: 'Inductions past their date clear the worker no more; the HSE officers are told of those about to expire' });
    runtime?.scheduler?.define({ code: 'hse.induction_sweep_morning', cron: '30 0 * * *', jobType: 'hse.induction_sweep', description: 'Every morning 06:00 India time: expired and expiring inductions' });
    listExports.register('hse.permits', { source: (actor, req) => { base.need(actor, 'hse.permit.export', 'export permits'); return pm.permits.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    runtime?.jobs?.register('hse.permit_sweep', (jctx) => { let expired = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) expired += pm.permits.sweep(c.id).expired; jctx.log(`${expired} permit(s) expired`); return { expired }; }, { maxAttempts: 2, description: 'Permits past their end are no longer valid for a work authorisation; the requester and the HSE engineer are told' });
    runtime?.scheduler?.define({ code: 'hse.permit_sweep_quarter', cron: '*/15 * * * *', jobType: 'hse.permit_sweep', description: 'Every 15 minutes: permits past their end expire' });
    listExports.register('hse.incidents', { source: (actor, req) => { base.need(actor, 'hse.incident.export', 'export incidents'); return inc.incidents.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    runtime?.jobs?.register('hse.incident_sweep', (jctx) => { let told = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) told += inc.incidentSweep(c.id).told; jctx.log(`${told} overdue action(s) told`); return { told }; }, { maxAttempts: 2, description: 'Corrective and preventive actions past their date, told to their owners and the HSE engineers' });
    runtime?.scheduler?.define({ code: 'hse.incident_sweep_morning', cron: '45 2 * * *', jobType: 'hse.incident_sweep', description: 'Every morning 08:15 India time: overdue incident actions are told' });
    listExports.register('hse.observations', { source: (actor, req) => { base.need(actor, 'hse.observation.export', 'export observations'); return sf.observations.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    runtime?.jobs?.register('hse.safety_daily', (jctx) => { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) { n += sf.obsSweep(c.id).escalated + sf.schedules.sweep(c.id).told + sf.ppe.sweep(c.id).told + sf.equipment.sweep(c.id).told; } jctx.log(`${n} escalation(s) and reminder(s)`); return { n }; }, { maxAttempts: 2, description: 'Observations past their time escalate; inspections, PPE replacements and equipment expiries due are told' });
    runtime?.scheduler?.define({ code: 'hse.safety_daily_hourly', cron: '20 * * * *', jobType: 'hse.safety_daily', description: 'Every hour: observation escalation, due inspections, PPE and equipment reminders' });
    runtime?.jobs?.register('hse.contractor_scores', (jctx) => { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) n += sf.scores.publish(c.id).published; jctx.log(`Published ${n} contractor safety score(s)`); return { published: n }; }, { maxAttempts: 2, description: 'The safety score of each subcontractor, published for the vendor scorecards' });
    runtime?.scheduler?.define({ code: 'hse.contractor_scores_night', cron: '40 21 * * *', jobType: 'hse.contractor_scores', description: 'Every night 03:10 India time: contractor safety scores are published' });
    runtime?.jobs?.register('hse.esg_daily', (jctx) => { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) n += es.esgSweep(c.id).told; jctx.log(`${n} consent(s) told`); return { n }; }, { maxAttempts: 2, description: 'Environmental consents ending or ended, told to the HSE team' });
    runtime?.scheduler?.define({ code: 'hse.esg_daily_morning', cron: '35 2 * * *', jobType: 'hse.esg_daily', description: 'Every morning 08:05 India time: consent expiry is told' });
    listExports.register('hse.visitors', { source: (actor, req) => { base.need(actor, 'hse.visitor.export', 'export visitors'); return sc.visitors.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
    runtime?.jobs?.register('hse.security_sweep', (jctx) => { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) { const r = sc.securitySweep(c.id); n += r.overstay + r.noShow + r.missed; } jctx.log(`${n} overstay, no-show or missed checkpoint alert(s)`); return { n }; }, { maxAttempts: 1, description: 'Missed patrol checkpoints and visitors who overstay, told to the security team' });
    runtime?.scheduler?.define({ code: 'hse.security_sweep_quarter', cron: '*/10 * * * *', jobType: 'hse.security_sweep', description: 'Every 10 minutes: missed checkpoints and visitor overstay' });
    runtime?.jobs?.register('hse.kpi_daily', (jctx) => { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) n += kp.breachCheck(c.id).told; jctx.log(`${n} rate alert(s)`); return { n }; }, { maxAttempts: 2, description: 'The lost-time injury frequency rate of the year against its target; the HSE head and the project director are told once a month' });
    runtime?.scheduler?.define({ code: 'hse.kpi_daily_night', cron: '50 21 * * *', jobType: 'hse.kpi_daily', description: 'Every night 03:20 India time: the safety rates are checked against their targets' });
    api.use('/hse', hseRoutes(svc, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags, parts: ctx.parts }));
  },
};

// BR-01: a work authorisation needs a released job safety analysis, when the company asks for it
waCheckHooks.push((db, r) => hseOf(db)?.svc.waCheck(r) ?? null);
// FR-05: a work authorisation that needs a permit needs an active one from the register
waCheckHooks.push((db, r) => hseOf(db)?.svc.waPermitCheck(r) ?? null);

const approver = (code, name, role, slaHours, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours, requireAttachment: false, checklist: [], when, notify: [], action: null });
const decideHook = (docType) => ({ onApproved: (db, { instance, actor, comment }) => hseOf(db)?.deciders[docType](instance, actor, 'APPROVED', comment), onRejected: (db, { instance, actor, comment }) => hseOf(db)?.deciders[docType](instance, actor, 'REJECTED', comment), onReturned: (db, { instance, actor, comment }) => hseOf(db)?.deciders[docType](instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => hseOf(db)?.deciders[docType](instance, actor, 'CANCELLED', comment) });
/** Registers the workflow type of an approval document of the module: `title(row)` and `fields(row)` describe it in the inbox. */
/** @param {any} o */
export function registerHseWorkflow({ docType, label, table, route, name, steps, title, fields }) {
  workflowTypes.register({
    docType, label, processOwner: 'HSEO', route: (id) => `${route}${id}`,
    describe(db, companyId, id) { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no ?? r.code, title: `${r.doc_no ?? r.code} ${title(r)}`.slice(0, 300), originator: r.requested_by, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined } : null; },
    summarise(db, _actor, id) { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id)); return r ? { fields: fields(r) } : null; },
    defaultDefinition: { name, settings: { resubmit: 'first', distinctApprovers: true }, steps },
    hooks: decideHook(docType),
  });
}
registerHseWorkflow({ docType: HSE_DOCS.plan, label: 'HSE plan', table: 'hse_plans', route: '/hse/plans?id=', name: 'HSE plan: the project manager, then the HSE head', steps: [approver('PM', 'Project manager', 'PM', 48), approver('HSEO', 'HSE head', 'HSEO', 48)], title: (r) => r.title, fields: (r) => [{ label: 'Plan', value: `${r.doc_no} version ${r.version_no}` }, { label: 'Title', value: r.title }] });
registerHseWorkflow({ docType: HSE_DOCS.hira, label: 'Risk assessment (HIRA)', table: 'hse_hira', route: '/hse/hira?id=', name: 'HIRA: the project manager; the HSE head also for a high residual risk', steps: [approver('PM', 'Project manager', 'PM', 48), approver('HSEO', 'HSE head (high or extreme residual risk)', 'HSEO', 48, { field: 'riskLevel', op: 'in', value: ['HIGH', 'EXTREME'] })], title: (r) => r.title, fields: (r) => [{ label: 'HIRA', value: `${r.doc_no} version ${r.version_no}` }, { label: 'Title', value: r.title }, { label: 'Residual risk', value: `${r.risk_level} (${r.max_residual})` }] });

/** Registers a table of the module as a record that the universal search, the related tab and the attachments know. */
export const hseObject = (table, perm, route, label, { codeCol = 'doc_no', projectCol = 'org_project_id', siteCol = 'org_site_id' } = {}) => objectTypes.register({
  type: table, label, permission: `${perm}.view`, route: (id) => `${route}${id}`, attachmentEntity: table, approvalTarget: table,
  access(db, actor, id) { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(Number(id), actor.companyId); if (!r || !authzOf(db).check(actor, `${perm}.view`, { companyId: r.company_id, projectId: r[projectCol] ?? undefined, siteId: r[siteCol] ?? undefined }).allowed) return null; return { companyId: r.company_id, projectId: r[projectCol] ?? undefined, siteId: r[siteCol] ?? undefined, status: r.status ?? r[`${table.split('_').pop()}_status`] }; },
  auditEntities: (id) => [{ entity: table, id }],
  summary(db, actor, id) { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ?`).get(Number(id), actor.companyId); return r ? { label: `${r[codeCol]} ${r.title ?? r.task ?? r.person_name ?? r.topic_text ?? ''}`.trim(), status: r.status ?? 'ACTIVE' } : null; },
  related: () => [],
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, `${perm}.view`).allowed) return []; return db.prepare(`SELECT id FROM ${table} WHERE company_id = ? AND deleted_at IS NULL AND ${codeCol} LIKE ? ORDER BY id DESC LIMIT ?`).all(actor.companyId, `%${q}%`, limit).map((x) => x.id); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare(`SELECT id FROM ${table} WHERE company_id = ? AND ${projectCol} = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?`).all(companyId, projectId, limit).map((x) => x.id); },
});
hseObject('hse_plans', 'hse.plan', '/hse/plans?id=', 'HSE plan');
hseObject('hse_hira', 'hse.hira', '/hse/hira?id=', 'Risk assessment (HIRA)');
hseObject('hse_jsa', 'hse.jsa', '/hse/jsa?id=', 'Job safety analysis');
hseObject('hse_inductions', 'hse.induction', '/hse/induction?id=', 'Site induction');
hseObject('hse_toolbox_talks', 'hse.toolbox_talk', '/hse/toolbox?id=', 'Toolbox talk');
hseObject('hse_permits', 'hse.permit', '/hse/permits?id=', 'Permit to work');
hseObject('hse_incidents', 'hse.incident', '/hse/incidents?id=', 'Incident');
hseObject('hse_observations', 'hse.observation', '/hse/observations?id=', 'Safety observation');
hseObject('camp_recoveries', 'hse.recovery', '/hse/camp-mess?id=', 'Camp recovery');
hseObject('scy_incidents', 'hse.security_incident', '/hse/security-incidents?id=', 'Security incident');
hseObject('scy_rosters', 'hse.roster', '/hse/rosters?id=', 'Guard roster');
hseObject('scy_visitors', 'hse.visitor', '/hse/visitors?id=', 'Visitor', { codeCol: 'doc_no' });

/** The files of an HSE record: who may see them and who may add. */
export const hseFiles = (table, label, perm, editKeys, locked) => fileEntities.register({ entity: table, label, resolve: (db, actor, id) => {
  const r = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(Number(id), actor.companyId); if (!r) return null; const a = authzOf(db); const scope = { companyId: r.company_id, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined }; const at = (k) => a.check(actor, k, scope).allowed; if (!at(`${perm}.view`)) return null;
  return { ...scope, canView: true, canEdit: editKeys.some((k) => at(`${perm}.${k}`)) && !locked(r), locked: locked(r) };
} });
hseFiles('hse_plans', 'HSE plan (document)', 'hse.plan', ['edit'], (r) => !['DRAFT', 'RETURNED'].includes(r.status));
hseFiles('hse_hira', 'Risk assessment (supporting records)', 'hse.hira', ['edit'], (r) => !['DRAFT', 'RETURNED'].includes(r.status));
hseFiles('hse_jsa', 'Job safety analysis (method statement, photographs)', 'hse.jsa', ['edit', 'create'], (r) => ['COMPLETED', 'CANCELLED'].includes(r.jsa_status));
hseFiles('hse_toolbox_talks', 'Toolbox talk (photographs and sign sheet)', 'hse.toolbox_talk', ['edit', 'create'], (r) => r.status !== 'DRAFT');
hseFiles('hse_permits', 'Permit to work (photographs, checklist and isolation records)', 'hse.permit', ['edit', 'record'], (r) => r.permit_status === 'CLOSED' || r.status === 'CANCELLED');
registerHseWorkflow({ docType: HSE_DOCS.permit, label: 'Permit to work', table: 'hse_permits', route: '/hse/permits?id=', name: 'Permit to work: the HSE engineer issues; the construction manager also authorises a high-risk permit',
  steps: [approver('HSEE', 'HSE engineer (issuer)', 'HSEE', 2), approver('CM', 'Construction manager (high risk)', 'CM', 2, { field: 'riskClass', op: 'eq', value: 'HIGH' })], title: (r) => r.title, fields: (r) => [{ label: 'Permit', value: r.doc_no }, { label: 'Work', value: r.title }, { label: 'Valid', value: `${r.valid_from} to ${r.valid_to}` }, { label: 'Risk class', value: r.risk_class }] });
hseFiles('hse_incidents', 'Incident (photographs, statements and evidence)', 'hse.incident', ['edit', 'create', 'investigate'], (r) => ['CLOSED', 'CANCELLED'].includes(r.incident_status));
registerHseWorkflow({ docType: HSE_DOCS.incident, label: 'Incident investigation closure', table: 'hse_incidents', route: '/hse/incidents?id=', name: 'Incident closure: the HSE engineer, the project manager; the director also for a serious incident',
  steps: [approver('HSEE', 'HSE engineer (review)', 'HSEE', 24), approver('PM', 'Project manager', 'PM', 24), approver('DIR', 'Director (serious incident)', 'DIR', 24, { field: 'serious', op: 'eq', value: 'yes' })], title: (r) => `${r.classification}: ${r.description}`, fields: (r) => [{ label: 'Incident', value: r.doc_no }, { label: 'Classification', value: r.classification }, { label: 'Lost days', value: String(r.lost_days) }, { label: 'Occurred', value: r.occurred_at }] });
hseFiles('hse_observations', 'Safety observation (photographs and evidence)', 'hse.observation', ['edit', 'create', 'act'], (r) => ['CLOSED', 'CANCELLED'].includes(r.obs_status));
registerHseWorkflow({ docType: HSE_DOCS.penalty, label: 'Safety penalty on a subcontractor', table: 'hse_observations', route: '/hse/observations?id=', name: 'Safety penalty: the HSE engineer, then the project manager',
  steps: [approver('HSEE', 'HSE engineer', 'HSEE', 24), approver('PM', 'Project manager', 'PM', 48)], title: (r) => `Penalty: ${r.description}`, fields: (r) => [{ label: 'Observation', value: r.doc_no }, { label: 'Severity', value: r.severity }, { label: 'Penalty (Rs)', value: String(r.penalty_amount / 100) }, { label: 'Reason', value: r.penalty_reason ?? '-' }] });
hseFiles('scy_incidents', 'Security incident (photographs and evidence)', 'hse.security_incident', ['edit', 'create'], (r) => ['APPROVED', 'CANCELLED'].includes(r.status));
hseFiles('scy_visitors', 'Visitor (photograph)', 'hse.visitor', ['checkin', 'create'], (r) => ['CHECKED_OUT', 'CANCELLED', 'DECLINED', 'NO_SHOW'].includes(r.visit_status));
registerHseWorkflow({ docType: HSE_DOCS.roster, label: 'Guard roster', table: 'scy_rosters', route: '/hse/rosters?id=', name: 'Guard roster: the security manager approves the supervisor\'s roster', steps: [approver('SECMGR', 'Security manager', 'SECMGR', 48)], title: (r) => `Guard roster ${r.period}`, fields: (r) => [{ label: 'Roster', value: r.doc_no }, { label: 'Month', value: r.period }, { label: 'Assignments', value: String(JSON.parse(r.assignments_json).length) }] });
registerHseWorkflow({ docType: HSE_DOCS.secIncident, label: 'Security incident closure', table: 'scy_incidents', route: '/hse/security-incidents?id=', name: 'Security incident: the security manager closes it after the investigation', steps: [approver('SECMGR', 'Security manager', 'SECMGR', 48)], title: (r) => `${r.incident_type}: ${r.description}`, fields: (r) => [{ label: 'Incident', value: r.doc_no }, { label: 'Type', value: r.incident_type }, { label: 'Investigation', value: r.investigation ?? '-' }] });
registerHseWorkflow({ docType: HSE_DOCS.recovery, label: 'Camp recovery from a contractor', table: 'camp_recoveries', route: '/hse/camp-mess?id=', name: 'Camp recovery: the camp in-charge, then the project manager',
  steps: [approver('HRMGR', 'Camp in-charge (HR)', 'HRMGR', 48), approver('PM', 'Project manager', 'PM', 48)], title: (r) => `Camp recovery ${r.period}`, fields: (r) => [{ label: 'Recovery', value: r.doc_no }, { label: 'Month', value: r.period }, { label: 'Meals served', value: String(r.meals_served) }, { label: 'Total (Rs)', value: String(r.total_paise / 100) }] });

// the safety slot of Project 360 (10.08, part 19.08): the figures of the project, only for a person who may see the HSE dashboard and where the part is on
registerProject360Widget('hse', (ctx) => {
  const s = hseOf(ctx.db); const pid = ctx.project.project_id;
  if (!s || !s.flags.isOn(ctx.actor, 'ff.hse.p1908')) return { figures: [], rows: [], note: 'The HSE dashboard is not enabled for your company yet.' };
  if (!s.base.may(ctx.actor, 'hse.dashboard.view', pid)) return { figures: [], rows: [], note: 'You have no right to see the safety figures of this project.' };
  return s.svc.kpi.projectWidget(ctx.actor, pid);
});
for (const code of ['hse.ltifr', 'hse.safe_manhours']) widgetRegistry.register({ code, provider: (ctx) => hseOf(ctx.db)?.svc.kpi.widget(ctx.actor, code) ?? { value: 0, unit: '', previous: null, trendPct: null, target: null, status: 'neutral', note: 'The HSE dashboard is not available.' } });
