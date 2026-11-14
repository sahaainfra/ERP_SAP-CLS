import { notFound } from '../../platform/http/errors.js';
import * as v from './validators.js';

/** /api/v1/hse/esg environment, waste and ESG metrics (part 19.05, flag ff.hse.p1905). */
export function esgRoutes(r, svc, { ok, pid, file, idempotent, idempotentRequired, flags }) {
  const { readings, waste, factors, consents } = svc; const q = (req) => req.query;
  r.use('/esg', (req, _res, next) => (flags.isOn(req.actor, 'ff.hse.p1905') ? next() : next(notFound('Environment and ESG metrics are not enabled for your company yet.'))));
  r.get('/esg/dashboard', (req, res) => ok(res, svc.esgDashboard(req.actor, v.parseEsgQ(q(req)))));
  r.get('/esg/brsr', (req, res) => ok(res, svc.brsr(req.actor, v.parseEsgQ(q(req)))));
  r.get('/esg/carbon', (req, res) => ok(res, svc.emissions(req.actor, v.parseEsgQ(q(req)))));
  r.get('/esg/carbon/export', (req, res) => file(res, svc.exportCarbon(req.actor, v.parseEsgQ(q(req)))));
  r.get('/esg/carbon/pdf', (req, res) => file(res, svc.carbonPdf(req.actor, v.parseEsgQ(q(req)))));
  r.get('/esg/readings/options', (req, res) => ok(res, readings.options(req.actor)));
  r.get('/esg/readings', (req, res) => res.json(readings.list(req.actor, q(req))));
  r.post('/esg/readings', idempotentRequired, (req, res) => ok(res, readings.create(req.actor, v.parseReadingCreate(req.body)), 201));
  r.post('/esg/readings/bulk', idempotentRequired, (req, res) => ok(res, readings.bulk(req.actor, v.parseReadingBulk(req.body)), 201));
  r.post('/esg/readings/pull', idempotent, (req, res) => ok(res, readings.pull(req.actor, v.parsePullQ(req.body))));
  r.delete('/esg/readings/:id', (req, res) => ok(res, readings.remove(req.actor, pid(req))));
  r.get('/esg/waste/options', (req, res) => ok(res, waste.options(req.actor)));
  r.get('/esg/waste', (req, res) => res.json(waste.list(req.actor, q(req))));
  r.post('/esg/waste', idempotentRequired, (req, res) => ok(res, waste.create(req.actor, v.parseWasteCreate(req.body)), 201));
  r.post('/esg/waste/:id/manifest', idempotent, (req, res) => ok(res, waste.manifest(req.actor, pid(req), v.parseFileAttach(req.body))));
  r.delete('/esg/waste/:id', (req, res) => ok(res, waste.remove(req.actor, pid(req))));
  r.get('/esg/factors', (req, res) => res.json(factors.list(req.actor, q(req))));
  r.post('/esg/factors', idempotentRequired, (req, res) => ok(res, factors.create(req.actor, v.parseFactorCreate(req.body)), 201));
  r.post('/esg/factors/:id/activate', idempotent, (req, res) => ok(res, factors.activate(req.actor, pid(req))));
  r.post('/esg/factors/:id/retire', idempotent, (req, res) => ok(res, factors.retire(req.actor, pid(req))));
  r.get('/esg/consents', (req, res) => res.json(consents.list(req.actor, q(req))));
  r.post('/esg/consents', idempotentRequired, (req, res) => ok(res, consents.create(req.actor, v.parsePermitEsgCreate(req.body)), 201));
  r.patch('/esg/consents/:id', idempotent, (req, res) => ok(res, consents.update(req.actor, pid(req), v.parsePermitEsgUpdate(req.body))));
}
