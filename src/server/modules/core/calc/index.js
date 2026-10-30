import { Router } from 'express';
import { calcOf } from '../../../platform/calc/index.js';
import { ensureReferenceUnits } from '../../../platform/calc/reference.js';
import { eventTypes } from '../../../platform/events/index.js';
import { notFound } from '../../../platform/http/errors.js';
import { sampleBillRoutes } from '../sample-bills/routes.js';
import { createSampleBillService } from '../sample-bills/service.js';
import { calcRoutes } from './routes.js';
import { createCalcService } from './service.js';

// Part 01.06: the calculation engine. Events this module publishes:
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required });
const str = { type: 'string' };
/** @type {[string, string, any][]} */
const CALC_EVENTS = [
  ['core.formula.version_created', 'A draft formula version was created.', obj({ code: str, version: { type: 'integer' } }, ['code', 'version'])],
  ['core.formula.shadow_started', 'A draft formula version started running alongside the active one.', obj({ code: str, version: { type: 'integer' } }, ['code', 'version'])],
  ['core.formula.activated', 'A formula version became active after approval.', obj({ code: str, version: { type: 'integer' }, effectiveFrom: str }, ['code', 'version'])],
  ['core.uom_conversion.changed', 'A unit-of-measure conversion factor was added or removed.', obj({ from: str, to: str }, ['from', 'to'])],
  ['core.sample_bill.created', 'A sample bill was created and calculated.', obj()],
  ['core.sample_bill.submitted', 'A sample bill was submitted; its amounts and formula versions are frozen.', obj()],
  ['core.sample_bill.recalculated', 'A sample bill was calculated again.', obj({ changed: { type: 'boolean' } })],
];
for (const [type, description, schema] of CALC_EVENTS) eventTypes.define({ type, version: 1, schema, owner: 'core', description });

/** Build the calculation service for a database and mount its routes (behind ff.core.p0106). Returns the engine other modules call. */
export function mountCalc({ api, db, approvals, opts, isFlagOn, persist = true }) {
  const engine = calcOf(db);
  if (persist) {
    const drift = engine.ensureBuiltins();
    if (drift.length) throw new Error(`The stored definition of the built-in formula(s) ${drift.join(', ')} differs from the code. A version never changes: add a new version in code.`);
    ensureReferenceUnits(db);
  }
  const router = Router();
  const mine = (req) => ['/formulas', '/calc-traces', '/uoms', '/uom-conversions', '/calc', '/sample-bills'].some((p) => req.path === p || req.path.startsWith(`${p}/`));
  router.use((req, _res, next) => (!mine(req) || isFlagOn(req.actor, 'ff.core.p0106') ? next() : next(notFound('The calculation engine is not enabled for your company yet (feature flag ff.core.p0106 is OFF).'))));
  router.use(calcRoutes(createCalcService({ db, engine, approvals }), opts));
  router.use(sampleBillRoutes(createSampleBillService({ db, engine }), opts));
  api.use('/core', router);
  return engine;
}
