import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports, listExportsOf } from '../../platform/list/index.js';
import { createFlagService } from '../core/api.js';
import './integrations.js';
import { bindBaseline, createBaselineService } from './baseline.js';
import { bindProjects, createProjectService } from './project.js';
import { baselineRoutes, boqRoutes, projectRoutes, structureRoutes, teamRoutes } from './routes.js';
import { bindMeetings, createMeetingService } from './meetings.js';
import { bindTeam, createTeamService } from './team.js';
import { bindBoq, createBoqService } from './boq.js';
import { bindStructure, createStructureService } from './structure.js';

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['proj.project.created', 'A project was set up with the wizard (the project, its sites, its numbering series and its document folders in one transaction): data { projectId, code, tenderId, sites, series, folders }.'],
  ['proj.project.activated', 'The activation of a project was approved (project director, then the director): the project is in Mobilisation, its organisation status and its sites are active: data { projectId, code, name, clientPartnerId, contractValue, startDate, scheduledCompletion, pm, director, sites, setup }. Numbering, folders, the messaging groups and Project 360 (10.08) follow it.'],
  ['proj.project.state_changed', 'A project moved in its lifecycle (the project of the organisation master follows): data { projectId, code, from, to }.'],
  ['proj.project.amended', 'An approved amendment changed the contract terms of a live project: data { projectId, code, changes }.'],
  ['proj.milestone.achieved', 'A milestone of a project was achieved: data { projectId, code, name, plannedDate, actualDate, contractual, paymentLinked }. Billing (later) reads the payment-linked ones.'],
  ['proj.project.created_from_award', 'A project was set up from an awarded tender: the project, the BOQ of the approved estimate with its rates and a draft baseline pack in one transaction: data { projectId, code, tenderId, awardId, estimateId, boqItems, packId }.'],
  ['proj.baseline.signed_off', 'The commercial baseline pack of a project was signed off (estimation, commercial manager, project director, and the director above the limit) and is now the immutable reference for the budget (12.01), the contract (21.01), the forecast (23.11) and the P&L (23.12): data { packId, docNo, packNo, supersedes, projectId, code, tenderId, awardId, estimateId, contractValue, totalCost, totalSelling, margin, boqItems, snapshotHash, signedOffBy }.'],
  ['proj.handover.held', 'A handover meeting between the estimation team and the execution team was recorded on a baseline pack: data { packId, meetingId, projectId, meetingDate, attendees, actions }.'],
  ['proj.wbs.updated', 'The structure of a project was edited before the WBS baseline (a node created, updated, moved, deleted, a template applied, a structure copied, a bulk edit): data { projectId, wbsId, code, action }. Consumers that cache the WBS refresh it.'],
  ['proj.wbs.baselined', 'The WBS of a project was baselined (its structure is locked; later changes are approved versions): data { projectId, code, versionNo, nodes, controlAccounts }. The BOQ (10.04), the budget (12.01) and the schedule (13.01) may now link to the nodes.'],
  ['proj.wbs.changed', 'A change of the baselined WBS was approved (planning, the project manager, the project controls manager) and applied as a new version: data { projectId, code, versionNo, reason, changes, added, moved, removed }.'],
  ['proj.location.updated', 'A location of the breakdown was created, updated, moved or deleted: data { projectId, locationId, code, action }.'],
  ['proj.workpackage.updated', 'A work package was created or changed: data { projectId, workPackageId, code, type, action }.'],
  ['proj.matrix.updated', 'The WBS x location matrix of a project was changed: data { projectId, on, off }.'],
  ['boq.version.created', 'A BOQ version was made (from the award, an import, another version or an approved variation): data { projectId, versionId, docNo, type, items }.'],
  ['boq.version.frozen', 'A BOQ version was frozen by approval (QS, the commercial manager, the project manager) and is now immutable: the reference for the budget (12.01), the schedule (13.01), measurements (22.01), material planning (15.02) and billing (22.03): data { projectId, code, versionId, docNo, type, versionNo, total, items, supersedes, variationRef, frozenBy }.'],
  ['boq.mapping.changed', 'The mapping of BOQ items to WBS nodes and locations changed (directly in a draft, or by an approved change of a frozen version): data { projectId, versionId, lineId, lines, splits, afterFreeze }.'],
  ['proj.team.added', 'A person was approved as a member of the project team (project manager, project director); the scoped role assignment is requested of the role engine (02.04): data { projectId, code, username, projectRole, fromDate, toDate, accessRequested }.'],
  ['proj.team.ended', 'A membership of the project team ended and the role assignment for the project was ended: data { projectId, username, projectRole, assignmentEnded }.'],
  ['proj.meeting.issued', 'The chair approved the minutes of a meeting: they are issued (locked), each action became a task of its owner and the attendees were told: data { projectId, code, meetingId, docNo, revNo, title, meetingDate, decisions, actions, tasksMade, attendees, external }.'],
  ['proj.action.updated', 'The owner of a meeting action changed its status (the task of the task service moved): data { projectId, meetingId, actionId, owner, status }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'proj', description });

integrityRegistry.register({
  allowNegative: [], companyOptional: [],
  statuses: { proj_projects: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED'], proj_baseline_packs: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'], proj_wbs_versions: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED'], proj_boq_versions: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED'], proj_meetings: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'], proj_team: ['REQUESTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'ENDED'] },
  uniqueKeys: [{ table: 'proj_milestones', columns: ['project_id', 'code'] }, { table: 'proj_baseline_packs', columns: ['company_id', 'doc_no'] }, { table: 'proj_wbs', columns: ['project_id', 'code'] }, { table: 'proj_locations', columns: ['project_id', 'code'] }, { table: 'proj_work_packages', columns: ['project_id', 'code'] }, { table: 'proj_boq_versions', columns: ['company_id', 'doc_no'] }, { table: 'proj_meetings', columns: ['company_id', 'doc_no', 'rev_no'] }],
});
/** Module "proj": project setup, WBS and BOQ (M10). Part 10.01 holds the project master, its lifecycle, the setup wizard and the key dates. The tables are `proj_*`. */
export const proj = {
  code: 'proj',
  name: 'Project Setup, WBS & BOQ',
  routePrefix: '/api/v1/proj',
  ownerPart: '10.01',
  status: 'The project master as a 1:1 extension of the organisation project: client, consultant and funding agency from the partner master, the contract summary, key dates, settings and the lifecycle (Setup, Mobilisation, Execution, Suspended, Substantially complete, Defect liability period, Closed, Archived) with a checklist at each move; the setup wizard that makes the project, its sites, numbering series and document folders in one transaction; activation, suspension and closure by approval; the milestones register and the portfolio with health.',
  tables: ['proj_projects', 'proj_milestones', 'proj_lifecycle_log', 'proj_baseline_packs', 'proj_handover_meetings', 'proj_boq_items', 'proj_wbs', 'proj_wbs_versions', 'proj_work_packages', 'proj_locations', 'proj_wbs_locations', 'proj_boq_versions', 'proj_boq_lines', 'proj_boq_line_wbs', 'proj_boq_line_norms', 'proj_boq_changes', 'proj_team', 'proj_stakeholders', 'proj_comm_matrix', 'proj_meetings', 'proj_meeting_actions'],
  companyOptional: [],
  resources: ['projects', 'project-options', 'project-prefill', 'milestones', 'award-candidates', 'award-preview', 'baseline-packs', 'handover-meetings', 'boq', 'baseline-report', 'wbs', 'wbs-versions', 'wbs-changes', 'locations', 'wbs-matrix', 'work-packages', 'versions', 'boq-lines', 'boq-changes', 'boq-projects', 'team', 'stakeholders', 'comm-matrix', 'meetings', 'meeting-actions'],

  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'proj_projects'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment });
    const gate = (key, what) => (req, _res, next) => (flags.isOn(req.actor, key) ? next() : next(notFound(`${what} not enabled for your company yet (feature flag ${key} is OFF).`)));
    const svc = createProjectService({ db });
    bindProjects(db, svc);
    listExports.register('proj.projects', { source: (actor, req) => svc.projects.exportSource(actor, req), hidden: () => [] });
    const router = Router();
    router.use(gate('ff.proj.p1001', 'The project master is'));
    router.use(projectRoutes({ svc, exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
    api.use('/proj', router);
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'proj_baseline_packs'").get()) {
      const bl = createBaselineService({ db });
      bindBaseline(db, bl);
      listExports.register('proj.baseline_packs', { source: (actor, req) => bl.packs.exportSource(actor, req), hidden: () => [] });
      const router2 = Router();
      router2.use(gate('ff.proj.p1002', 'The project from an award and the commercial baseline are'));
      router2.use(baselineRoutes(bl, { exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
      api.use('/proj', router2);
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'proj_wbs'").get()) {
      const sv = createStructureService({ db });
      bindStructure(db, sv);
      listExports.register('proj.work_packages', { source: (actor, req) => sv.packages.exportSource(actor, req), hidden: () => [] });
      const router3 = Router();
      router3.use(gate('ff.proj.p1003', 'The project structure (WBS, work packages and locations) is'));
      router3.use(structureRoutes(sv, { exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
      api.use('/proj', router3);
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'proj_boq_versions'").get()) {
      const bq = createBoqService({ db });
      bindBoq(db, bq);
      listExports.register('proj.boq_versions', { source: (actor, req) => bq.versions.exportSource(actor, req), hidden: () => [] });
      const router4 = Router();
      router4.use(gate('ff.proj.p1004', 'BOQ management is'));
      router4.use(boqRoutes(bq, { exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
      api.use('/proj', router4);
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'proj_meetings'").get()) {
      const tm = createTeamService({ db }); const mt = createMeetingService({ db });
      bindTeam(db, tm); bindMeetings(db, mt);
      listExports.register('proj.meetings', { source: (actor, req) => mt.meetings.exportSource(actor, req), hidden: () => [] });
      const router5 = Router();
      router5.use(gate('ff.proj.p1005', 'The project team, stakeholders and meetings are'));
      router5.use(teamRoutes(tm, mt, { exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
      api.use('/proj', router5);
    }
  },
};
