import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports, listExportsOf } from '../../platform/list/index.js';
import { createFlagService } from '../core/api.js';
import { bindEngg, createEnggService } from './drawings.js';
import { createTransmittalService } from './transmittals.js';
import { createRfiService } from './rfis.js';
import { createSubmittalService } from './submittals.js';
import { createDeliverableService } from './deliverables.js';
import { createVdrService } from './vdr.js';
import { createLetterService } from './letters.js';
import { enggRoutes } from './routes.js';

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['engg.drawing.issued', 'A drawing revision was issued (an IFC one after the approval of document control, the design coordinator and the project manager): data { projectId, drawingId, drawingNo, revisionId, revision, statusCode, superseded, holdersNotified, wbsId, locationId }. Work authorisation (14.01) and the site view follow it.'],
  ['engg.drawing.superseded', 'Issuing a revision superseded earlier ones (BR-02): they are marked "SUPERSEDED, DO NOT USE" and the holders of their controlled copies were told: data { projectId, drawingId, drawingNo, by, revisions, holdersNotified }.'],
  ['engg.transmittal.issued', 'A transmittal left (or an incoming one was registered): data { projectId, transmittalId, docNo, direction, purpose, party, items, dueOn }.'],
  ['engg.rfi.issued', 'An RFI was checked by the design coordinator and issued to the consultant: data { projectId, rfiId, rfiNo, priority, requiredBy, drawingId, activityRef, hold, consultant }.'],
  ['engg.rfi.responded', 'The consultant answered an RFI (a clarification, a design change or an instruction): data { projectId, rfiId, rfiNo, responseType, drawingId, drawingRevisionId, instructionRef, costImpact, timeImpactDays, variationRef, activityRef, hold, delayDraftId }. The drawing page, the variation draft (21.05), the delay register (13.05) and the constraints (13.04) follow it.'],
  ['engg.rfi.closed', 'An RFI was closed after its answer was verified by the design coordinator and the raiser\'s lead: data { projectId, rfiId, rfiNo, responseType, costImpact, timeImpactDays, activityRef, verifiedBy }. The activity it held is free.'],
  ['engg.rfi.escalated', 'An RFI late against its SLA or its required-by date was escalated: data { projectId, rfiId, rfiNo, priority, ageDays, critical, ballInCourt }.'],
  ['engg.submittal.submitted', 'A submittal passed its internal approval and went to the consultant: data { projectId, submittalId, submittalNo, type, revision, consultant, requiredBy }.'],
  ['engg.submittal.responded', 'The consultant\'s response code (A approved, B approved as noted, C revise and resubmit, D rejected) was recorded on a submittal: data { projectId, submittalId, submittalNo, type, revision, code, status }.'],
  ['engg.submittal.approved', 'A submittal was approved (code A or B): an approved material approval makes its make and model an approved make that procurement (15.03, 15.05) and receiving inspection (18.03) read; an approved method statement goes to HSE (19.01): data { projectId, submittalId, submittalNo, type, code, itemId, materialRef, make, model, supplier, approvedMakeId, activityRef, hseRef, drawingId }.'],
  ['engg.progress.updated', 'The engineering progress of a deliverable changed (a milestone was recorded, an IFC release was approved, a deliverable was cancelled, reopened or re-weighted): data { projectId, deliverableId, deliverableNo, discipline, milestone, progressBp, projectProgressBp, reason }. Project progress (14.05) reads the project figure.'],
  ['engg.deliverable.released', 'The IFC release of a deliverable was approved (discipline lead, engineering manager, project manager): data { projectId, deliverableId, deliverableNo, discipline, drawingId, documentId }.'],
  ['engg.hold.raised', 'An engineering hold was raised on a deliverable awaiting information: data { projectId, holdId, holdNo, deliverableId, deliverableNo, poRef, activityRef, impactProcurement, impactConstruction }. Procurement expediting (15.07) reads it.'],
  ['engg.hold.cleared', 'An engineering hold was cleared: data { projectId, holdId, holdNo, deliverableId, poRef, activityRef }.'],
  ['engg.vdr.reviewed', 'The review of a vendor document was approved: data { projectId, vdrId, vdrNo, poRef, vendor, docType, code, status }. The vendor portal (25.02) tells the vendor.'],
  ['engg.letter.registered', 'An inward letter, notice or instruction was registered: data { projectId, letterId, letterNo, category, clauseRef, party, theirRef, responseDue, links }. Claims (21.06), variations (21.05) and site instructions (14.04) read the links as evidence.'],
  ['engg.letter.issued', 'An approved outward letter was issued by e-mail, courier, portal or hand: data { projectId, letterId, letterNo, category, clauseRef, contractual, party, issueMode, parentLetterId, timeBarId, timeBarState, links }.'],
  ['engg.letter.acknowledged', 'The other party acknowledged an outward letter (the proof of delivery): data { projectId, letterId, letterNo, ackBy, ackOn }.'],
  ['engg.letter.response_overdue', 'The reply to an inward letter is overdue: data { projectId, letterId, letterNo, responseDue, assignedTo }.'],
  ['engg.timebar.opened', 'A notice with a time limit in the contract was opened: data { projectId, timeBarId, barNo, clauseRef, deadline, limitDays, claimRef }. Claims (21.06) read it.'],
  ['engg.timebar.alert', 'An open time bar came within 7, 3 or 1 days of its deadline: data { projectId, timeBarId, barNo, deadline, daysLeft, step, claimRef, ownerUser }.'],
  ['engg.timebar.served', 'A time bar was served in time by an outward letter: data { projectId, timeBarId, barNo, deadline, letterId, letterNo, servedOn, claimRef }.'],
  ['engg.timebar.lapsed', 'A time bar lapsed: its deadline passed before the notice was served: data { projectId, timeBarId, barNo, deadline, claimRef, servedOn }.'],
  ['engg.transmittal.response', 'A response code (A approved, B approved with comments, C revise and resubmit, D rejected) was recorded on a drawing of a transmittal: data { projectId, transmittalId, docNo, drawingId, drawingNo, revision, code, comments }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'engg', description });

integrityRegistry.register({
  allowNegative: [], companyOptional: [],
  statuses: { engg_drawing_revisions: ['DRAFT', 'SUBMITTED', 'ISSUED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'], engg_transmittals: ['DRAFT', 'SUBMITTED', 'ISSUED', 'RETURNED', 'REJECTED', 'CANCELLED', 'CLOSED'], engg_copies: ['ISSUED', 'ACKNOWLEDGED', 'SUPERSEDED', 'WITHDRAWN'], engg_drawings: ['ACTIVE', 'CANCELLED'], engg_rfis: ['DRAFT', 'SUBMITTED', 'ISSUED', 'RESPONDED', 'CLOSE_REQUESTED', 'CLOSED', 'RETURNED', 'REJECTED', 'CANCELLED'], engg_rfi_delay_drafts: ['DRAFT', 'TAKEN_OVER', 'DISCARDED'], engg_submittals: ['DRAFT', 'SUBMITTED', 'WITH_CONSULTANT', 'APPROVED', 'REVISE', 'REJECTED', 'RETURNED', 'CANCELLED'], engg_approved_makes: ['ACTIVE', 'WITHDRAWN'], engg_deliverables: ['ACTIVE', 'CANCELLED'], engg_crs: ['OPEN', 'RESPONDED', 'CLOSED'], engg_vdr_items: ['REQUIRED', 'RECEIVED', 'IN_REVIEW', 'ACCEPTED', 'RESUBMIT', 'RETURNED', 'CANCELLED'], engg_holds: ['OPEN', 'CLEARED'], engg_letters: ['DRAFT', 'SUBMITTED', 'APPROVED', 'ISSUED', 'ACKNOWLEDGED', 'REGISTERED', 'CLOSED', 'RETURNED', 'REJECTED', 'CANCELLED'], engg_time_bars: ['OPEN', 'SERVED', 'LAPSED', 'WAIVED'] },
  uniqueKeys: [{ table: 'engg_drawings', columns: ['company_id', 'org_project_id', 'drawing_no'] }, { table: 'engg_transmittals', columns: ['company_id', 'doc_no'] }, { table: 'engg_drawing_revisions', columns: ['drawing_id', 'rev_seq'] }, { table: 'engg_rfis', columns: ['company_id', 'rfi_no'] }, { table: 'engg_submittals', columns: ['company_id', 'submittal_no'] }, { table: 'engg_deliverables', columns: ['company_id', 'deliverable_no'] }, { table: 'engg_vdr_items', columns: ['company_id', 'vdr_no'] }, { table: 'engg_holds', columns: ['company_id', 'hold_no'] }, { table: 'engg_time_bars', columns: ['company_id', 'bar_no'] }],
});

/** Module "engg": engineering and drawing control (M11). Part 11.01 holds the drawing register, its revisions with the IFC approval and supersession, transmittals with response codes, controlled copies and the site view. The tables are `engg_*`. */
export const engg = {
  code: 'engg',
  name: 'Engineering & Drawings',
  routePrefix: '/api/v1/engg',
  ownerPart: '11.01',
  status: 'The drawing register (number, title, discipline, package, location, scale, size, originator, current revision and status code), the revision workflow (draft, check, approval of issue for construction, issue) with the change note and revision-cloud summary and a side-by-side comparison, outgoing and incoming transmittals with response codes A to D, controlled copies with acknowledgement, the site view of current IFC drawings only, links to WBS, location, BOQ and activity, the drawing schedule with the overdue report, and the use check that work authorisation reads.',
  tables: ['engg_drawings', 'engg_drawing_revisions', 'engg_drawing_links', 'engg_transmittals', 'engg_transmittal_items', 'engg_copies', 'engg_rfis', 'engg_rfi_routing', 'engg_rfi_delay_drafts', 'engg_submittals', 'engg_submittal_revisions', 'engg_approved_makes', 'engg_deliverables', 'engg_crs', 'engg_vdr_items', 'engg_holds', 'engg_letters', 'engg_letter_links', 'engg_time_bars'],
  companyOptional: [],
  resources: ['letters', 'time-bars', 'letter-templates', 'deliverables', 'comments', 'holds', 'vdr-items', 'engineering-progress', 'submittals', 'submittal-schedule', 'approved-makes', 'rfis', 'rfi-dashboard', 'project-options', 'structure-options', 'dashboard', 'schedule', 'site-drawings', 'drawings', 'revisions', 'copies', 'transmittals'],

  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'engg_drawings'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment });
    const gate = (key, what) => (req, _res, next) => (flags.isOn(req.actor, key) ? next() : next(notFound(`${what} not enabled for your company yet (feature flag ${key} is OFF).`)));
    const base = createEnggService({ db });
    const svc = { ...base, ...createTransmittalService({ db, base }), ...createRfiService({ db, base }), ...createSubmittalService({ db, base }), ...createDeliverableService({ db, base }), ...createVdrService({ db, base }), ...createLetterService({ db, base }) };
    bindEngg(db, svc);
    listExports.register('engg.drawings', { source: (actor, req) => svc.drawings.exportSource(actor, req), hidden: () => [] });
    listExports.register('engg.transmittals', { source: (actor, req) => svc.transmittals.exportSource(actor, req), hidden: () => [] });
    listExports.register('engg.rfis', { source: (actor, req) => svc.rfis.exportSource(actor, req), hidden: () => [] });
    listExports.register('engg.submittals', { source: (actor, req) => svc.submittals.exportSource(actor, req), hidden: () => [] });
    listExports.register('engg.deliverables', { source: (actor, req) => svc.deliverables.exportSource(actor, req), hidden: () => [] });
    listExports.register('engg.vdr_items', { source: (actor, req) => svc.vdr.exportSource(actor, req), hidden: () => [] });
    listExports.register('engg.letters', { source: (actor, req) => svc.letters.exportSource(actor, req), hidden: () => [] });
    const router = Router();
    router.use((req, res, next) => (/^\/(rfis|rfi-dashboard)(\/|$)/.test(req.path) ? gate('ff.engg.p1102', 'RFI management is')(req, res, next) : /^\/(submittals|submittal-schedule|approved-makes)(\/|$)/.test(req.path) ? gate('ff.engg.p1103', 'Submittals are')(req, res, next) : /^\/(deliverables|comments|holds|vdr-items|engineering-progress)(\/|$)/.test(req.path) ? gate('ff.engg.p1104', 'EPC engineering deliverables are')(req, res, next) : /^\/(letters|time-bars|letter-templates)(\/|$)/.test(req.path) ? gate('ff.engg.p1105', 'The correspondence register is')(req, res, next) : gate('ff.engg.p1101', 'Drawing control is')(req, res, next)));
    router.use(enggRoutes(svc, { exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
    api.use('/engg', router);
  },
};
