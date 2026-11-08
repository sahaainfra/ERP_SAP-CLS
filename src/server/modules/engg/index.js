import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports, listExportsOf } from '../../platform/list/index.js';
import { createFlagService } from '../core/api.js';
import { bindEngg, createEnggService } from './drawings.js';
import { createTransmittalService } from './transmittals.js';
import { enggRoutes } from './routes.js';

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['engg.drawing.issued', 'A drawing revision was issued (an IFC one after the approval of document control, the design coordinator and the project manager): data { projectId, drawingId, drawingNo, revisionId, revision, statusCode, superseded, holdersNotified, wbsId, locationId }. Work authorisation (14.01) and the site view follow it.'],
  ['engg.drawing.superseded', 'Issuing a revision superseded earlier ones (BR-02): they are marked "SUPERSEDED, DO NOT USE" and the holders of their controlled copies were told: data { projectId, drawingId, drawingNo, by, revisions, holdersNotified }.'],
  ['engg.transmittal.issued', 'A transmittal left (or an incoming one was registered): data { projectId, transmittalId, docNo, direction, purpose, party, items, dueOn }.'],
  ['engg.transmittal.response', 'A response code (A approved, B approved with comments, C revise and resubmit, D rejected) was recorded on a drawing of a transmittal: data { projectId, transmittalId, docNo, drawingId, drawingNo, revision, code, comments }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'engg', description });

integrityRegistry.register({
  allowNegative: [], companyOptional: [],
  statuses: { engg_drawing_revisions: ['DRAFT', 'SUBMITTED', 'ISSUED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'], engg_transmittals: ['DRAFT', 'SUBMITTED', 'ISSUED', 'RETURNED', 'REJECTED', 'CANCELLED', 'CLOSED'], engg_copies: ['ISSUED', 'ACKNOWLEDGED', 'SUPERSEDED', 'WITHDRAWN'], engg_drawings: ['ACTIVE', 'CANCELLED'] },
  uniqueKeys: [{ table: 'engg_drawings', columns: ['company_id', 'org_project_id', 'drawing_no'] }, { table: 'engg_transmittals', columns: ['company_id', 'doc_no'] }, { table: 'engg_drawing_revisions', columns: ['drawing_id', 'rev_seq'] }],
});

/** Module "engg": engineering and drawing control (M11). Part 11.01 holds the drawing register, its revisions with the IFC approval and supersession, transmittals with response codes, controlled copies and the site view. The tables are `engg_*`. */
export const engg = {
  code: 'engg',
  name: 'Engineering & Drawings',
  routePrefix: '/api/v1/engg',
  ownerPart: '11.01',
  status: 'The drawing register (number, title, discipline, package, location, scale, size, originator, current revision and status code), the revision workflow (draft, check, approval of issue for construction, issue) with the change note and revision-cloud summary and a side-by-side comparison, outgoing and incoming transmittals with response codes A to D, controlled copies with acknowledgement, the site view of current IFC drawings only, links to WBS, location, BOQ and activity, the drawing schedule with the overdue report, and the use check that work authorisation reads.',
  tables: ['engg_drawings', 'engg_drawing_revisions', 'engg_drawing_links', 'engg_transmittals', 'engg_transmittal_items', 'engg_copies'],
  companyOptional: [],
  resources: ['dashboard', 'schedule', 'site-drawings', 'drawings', 'revisions', 'copies', 'transmittals'],

  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'engg_drawings'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment });
    const gate = (key, what) => (req, _res, next) => (flags.isOn(req.actor, key) ? next() : next(notFound(`${what} not enabled for your company yet (feature flag ${key} is OFF).`)));
    const base = createEnggService({ db });
    const svc = { ...base, ...createTransmittalService({ db, base }) };
    bindEngg(db, svc);
    listExports.register('engg.drawings', { source: (actor, req) => svc.drawings.exportSource(actor, req), hidden: () => [] });
    listExports.register('engg.transmittals', { source: (actor, req) => svc.transmittals.exportSource(actor, req), hidden: () => [] });
    const router = Router();
    router.use(gate('ff.engg.p1101', 'Drawing control is'));
    router.use(enggRoutes(svc, { exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
    api.use('/engg', router);
  },
};
