import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports, listExportsOf } from '../../platform/list/index.js';
import { createFlagService } from '../core/api.js';
import { bindEstimates, createEstimateService } from './estimate.js';
import './integrations.js';
import { estimateRoutes } from './routes.js';
import { bindMto, createMtoService } from './mto.js';
import { mtoRoutes } from './mto-routes.js';
import { bindReview, createReviewService } from './review.js';
import { reviewRoutes } from './review-routes.js';

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['est.estimate.created', 'An estimate was started for a tender or a project: data { estimateId, docNo, versionNo, tenderId, projectId }.'],
  ['est.estimate.versioned', 'A new draft version of an estimate was copied from another: data { estimateId, docNo, fromVersion }.'],
  ['est.estimate.boq_imported', 'Rows of a client BOQ were added to a draft estimate: data { estimateId, docNo, versionNo, rows }.'],
  ['est.estimate.approved', 'An estimate version was approved (it supersedes the version approved before): data { estimateId, docNo, versionNo, tenderId, projectId, totalSelling, totalCost, marginPct, bidValue, gst, resources: [{ type, itemId, itemCode, description, uom, qty }] }. The review (09.03), the material take-off (09.02) and the bid submission (08.03) read it.'],
  ['est.takeoff.released', 'A take-off sheet or engineering MTO revision was released by its checker (the earlier released revision is superseded): data { takeoffId, docNo, revisionNo, kind, projectId, tenderId, estimateId, drawingRef, drawingRev, quantities: [{ boqItemRef, description, uom, qty }], requirements: [{ itemId, itemCode, description, uom, net, qty }], delta }. Estimation (09.01), the BOQ (10.04) and MRP (15.02) read it.'],
  ['est.bbs.released', 'A bar bending schedule revision was released: data { bbsId, docNo, revisionNo, projectId, member, drawingRef, byDia: [{ dia, marks, bars, totalLength, weightKg, weightMt }], totalKg, requirements, delta }. Procurement of steel reads it.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'est', description });

const TABLES = ['est_reviews', 'est_bid_summary', 'est_assumptions', 'est_estimates', 'est_estimate_items', 'est_item_components', 'est_indirects', 'est_risks', 'mto_takeoffs', 'mto_takeoff_lines', 'mto_bbs', 'mto_bbs_lines', 'mto_material_requirements'];
integrityRegistry.register({
  allowNegative: ['est_estimates.margin_amount', 'est_estimates.margin_pct', 'est_bid_summary.profit_amount'], companyOptional: [],
  statuses: { est_estimates: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'], mto_takeoffs: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'], mto_bbs: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'] },
  uniqueKeys: [{ table: 'est_estimates', columns: ['company_id', 'doc_no', 'version_no'] }, { table: 'mto_takeoffs', columns: ['company_id', 'doc_no', 'revision_no'] }, { table: 'mto_bbs', columns: ['company_id', 'doc_no', 'revision_no'] }],
});
/** Module "est": estimation and quantity take-off (M09). Part 09.01 holds the estimate workspace. The tables are `est_*`. */
export const est = {
  code: 'est',
  name: 'Estimation & Quantity Take-off',
  routePrefix: '/api/v1/est',
  ownerPart: '09.01, 09.02, 09.03',
  status: 'Estimate versions of a tender or a project, items in BOQ sections priced from rate analyses, manual build-ups or typed rates with a markup, the indirect costs sheet, contingency by risk, escalation, HO overhead and GST worked out by the calculation engine, the resource summary and the comparison of versions.',
  tables: TABLES,
  companyOptional: [],
  resources: ['estimates', 'takeoffs', 'takeoff-templates', 'bbs', 'bbs-shapes', 'bbs-summary'],

  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'est_estimates'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment });
    const gate = (key, what) => (req, _res, next) => (flags.isOn(req.actor, key) ? next() : next(notFound(`${what} not enabled for your company yet (feature flag ${key} is OFF).`)));
    const svc = createEstimateService({ db });
    bindEstimates(db, svc);
    listExports.register('est.estimates', { source: (actor, req) => svc.estimates.exportSource(actor, req), hidden: (actor) => svc.estimates.hidden(actor) });
    const router = Router();
    router.use(gate('ff.est.p0901', 'The estimate workspace is'));
    router.use(estimateRoutes({ est: svc, exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
    api.use('/est', router);
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'mto_takeoffs'").get()) {
      const mto = createMtoService({ db });
      bindMto(db, mto);
      listExports.register('est.takeoffs', { source: (actor, req) => mto.takeoffs.exportSource(actor, req), hidden: () => [] });
      listExports.register('est.bbs', { source: (actor, req) => mto.bbs.exportSource(actor, req), hidden: () => [] });
      const mr = Router();
      mr.use(gate('ff.est.p0902', 'Quantity take-off and bar bending schedules are'));
      mr.use(mtoRoutes({ mto, exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
      api.use('/est', mr);
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'est_bid_summary'").get()) {
      const rv = createReviewService({ db });
      bindReview(db, rv);
      const rr = Router();
      rr.use(gate('ff.est.p0903', 'The estimate review and the bid price are'));
      rr.use(reviewRoutes({ rv }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
      api.use('/est', rr);
    }
  },
};
