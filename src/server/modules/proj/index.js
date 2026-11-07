import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports, listExportsOf } from '../../platform/list/index.js';
import { createFlagService } from '../core/api.js';
import './integrations.js';
import { bindProjects, createProjectService } from './project.js';
import { projectRoutes } from './routes.js';

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['proj.project.created', 'A project was set up with the wizard (the project, its sites, its numbering series and its document folders in one transaction): data { projectId, code, tenderId, sites, series, folders }.'],
  ['proj.project.activated', 'The activation of a project was approved (project director, then the director): the project is in Mobilisation, its organisation status and its sites are active: data { projectId, code, name, clientPartnerId, contractValue, startDate, scheduledCompletion, pm, director, sites, setup }. Numbering, folders, the messaging groups and Project 360 (10.08) follow it.'],
  ['proj.project.state_changed', 'A project moved in its lifecycle (the project of the organisation master follows): data { projectId, code, from, to }.'],
  ['proj.project.amended', 'An approved amendment changed the contract terms of a live project: data { projectId, code, changes }.'],
  ['proj.milestone.achieved', 'A milestone of a project was achieved: data { projectId, code, name, plannedDate, actualDate, contractual, paymentLinked }. Billing (later) reads the payment-linked ones.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'proj', description });

integrityRegistry.register({
  allowNegative: [], companyOptional: [],
  statuses: { proj_projects: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED'] },
  uniqueKeys: [{ table: 'proj_milestones', columns: ['project_id', 'code'] }],
});
/** Module "proj": project setup, WBS and BOQ (M10). Part 10.01 holds the project master, its lifecycle, the setup wizard and the key dates. The tables are `proj_*`. */
export const proj = {
  code: 'proj',
  name: 'Project Setup, WBS & BOQ',
  routePrefix: '/api/v1/proj',
  ownerPart: '10.01',
  status: 'The project master as a 1:1 extension of the organisation project: client, consultant and funding agency from the partner master, the contract summary, key dates, settings and the lifecycle (Setup, Mobilisation, Execution, Suspended, Substantially complete, Defect liability period, Closed, Archived) with a checklist at each move; the setup wizard that makes the project, its sites, numbering series and document folders in one transaction; activation, suspension and closure by approval; the milestones register and the portfolio with health.',
  tables: ['proj_projects', 'proj_milestones', 'proj_lifecycle_log'],
  companyOptional: [],
  resources: ['projects', 'project-options', 'project-prefill', 'milestones'],

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
  },
};
