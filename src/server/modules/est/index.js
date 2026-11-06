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

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['est.estimate.created', 'An estimate was started for a tender or a project: data { estimateId, docNo, versionNo, tenderId, projectId }.'],
  ['est.estimate.versioned', 'A new draft version of an estimate was copied from another: data { estimateId, docNo, fromVersion }.'],
  ['est.estimate.boq_imported', 'Rows of a client BOQ were added to a draft estimate: data { estimateId, docNo, versionNo, rows }.'],
  ['est.estimate.approved', 'An estimate version was approved (it supersedes the version approved before): data { estimateId, docNo, versionNo, tenderId, projectId, totalSelling, totalCost, marginPct, bidValue, gst, resources: [{ type, itemId, itemCode, description, uom, qty }] }. The review (09.03), the material take-off (09.02) and the bid submission (08.03) read it.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'est', description });

const TABLES = ['est_estimates', 'est_estimate_items', 'est_item_components', 'est_indirects', 'est_risks'];
integrityRegistry.register({
  allowNegative: ['est_estimates.margin_amount', 'est_estimates.margin_pct'], companyOptional: [],
  statuses: { est_estimates: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'] },
  uniqueKeys: [{ table: 'est_estimates', columns: ['company_id', 'doc_no', 'version_no'] }],
});
/** Module "est": estimation and quantity take-off (M09). Part 09.01 holds the estimate workspace. The tables are `est_*`. */
export const est = {
  code: 'est',
  name: 'Estimation & Quantity Take-off',
  routePrefix: '/api/v1/est',
  ownerPart: '09.01',
  status: 'Estimate versions of a tender or a project, items in BOQ sections priced from rate analyses, manual build-ups or typed rates with a markup, the indirect costs sheet, contingency by risk, escalation, HO overhead and GST worked out by the calculation engine, the resource summary and the comparison of versions.',
  tables: TABLES,
  companyOptional: [],
  resources: ['estimates'],

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
  },
};
