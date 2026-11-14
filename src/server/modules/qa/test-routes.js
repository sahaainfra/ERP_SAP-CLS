import { notFound } from '../../platform/http/errors.js';
import { parseReason, parseCatalogueCreate, parseCatalogueUpdate, parseEquipCreate, parseEquipUpdate, parseCalibrate, parseTestCreate, parseTestUpdate, parseComplianceQ } from './validators.js';

/** /api/v1/qa material testing, laboratory and calibration (part 18.03, flag ff.qa.p1803). */
export function testRoutes(r, svc, { ok, pid, file, idempotent, idempotentRequired, flags }) {
  const { catalogue, equipment, requests } = svc;
  r.use(['/test-requests', '/test-catalogue', '/lab-equipment', '/receiving', '/test-compliance'], (req, _res, next) => (flags.isOn(req.actor, 'ff.qa.p1803') ? next() : next(notFound('Material testing is not enabled for your company yet.'))));
  r.get('/test-compliance', (req, res) => ok(res, svc.compliance(req.actor, parseComplianceQ(req.query))));
  r.get('/test-compliance/export', (req, res) => file(res, svc.exportCsv(req.actor, { ...parseComplianceQ(req.query), kind: 'compliance' })));
  r.get('/receiving', (req, res) => ok(res, requests.receiving(req.actor)));
  r.get('/test-catalogue/options', (req, res) => ok(res, catalogue.options(req.actor)));
  r.get('/test-catalogue', (req, res) => res.json(catalogue.list(req.actor, req.query)));
  r.post('/test-catalogue', idempotentRequired, (req, res) => ok(res, catalogue.create(req.actor, parseCatalogueCreate(req.body)), 201));
  r.get('/test-catalogue/:id', (req, res) => ok(res, catalogue.get(req.actor, pid(req))));
  r.patch('/test-catalogue/:id', idempotent, (req, res) => ok(res, catalogue.update(req.actor, pid(req), parseCatalogueUpdate(req.body))));
  r.delete('/test-catalogue/:id', (req, res) => ok(res, catalogue.remove(req.actor, pid(req))));
  r.get('/lab-equipment/export', (req, res) => file(res, svc.exportCsv(req.actor, { kind: 'equipment' })));
  r.get('/lab-equipment', (req, res) => res.json(equipment.list(req.actor, req.query)));
  r.post('/lab-equipment', idempotentRequired, (req, res) => ok(res, equipment.create(req.actor, parseEquipCreate(req.body)), 201));
  r.get('/lab-equipment/:id', (req, res) => ok(res, equipment.get(req.actor, pid(req))));
  r.patch('/lab-equipment/:id', idempotent, (req, res) => ok(res, equipment.update(req.actor, pid(req), parseEquipUpdate(req.body))));
  r.delete('/lab-equipment/:id', (req, res) => ok(res, equipment.remove(req.actor, pid(req))));
  r.post('/lab-equipment/:id/calibrate', idempotentRequired, (req, res) => ok(res, equipment.calibrate(req.actor, pid(req), parseCalibrate(req.body))));
  r.get('/test-requests/export', (req, res) => file(res, svc.exportCsv(req.actor, { kind: 'requests' })));
  r.get('/test-requests', (req, res) => res.json(requests.list(req.actor, req.query)));
  r.post('/test-requests', idempotentRequired, (req, res) => ok(res, requests.create(req.actor, parseTestCreate(req.body)), 201));
  r.get('/test-requests/:id', (req, res) => ok(res, requests.get(req.actor, pid(req))));
  r.patch('/test-requests/:id', idempotent, (req, res) => ok(res, requests.update(req.actor, pid(req), parseTestUpdate(req.body))));
  r.delete('/test-requests/:id', (req, res) => ok(res, requests.remove(req.actor, pid(req))));
  r.post('/test-requests/:id/submit', idempotentRequired, (req, res) => ok(res, requests.submit(req.actor, pid(req)), 202));
  r.post('/test-requests/:id/withdraw', idempotent, (req, res) => ok(res, requests.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/test-requests/:id/cancel', idempotent, (req, res) => ok(res, requests.cancel(req.actor, pid(req), parseReason(req.body))));
  r.get('/test-requests/:id/history', (req, res) => ok(res, requests.history(req.actor, pid(req))));
  r.get('/test-requests/:id/print', (req, res) => file(res, requests.print(req.actor, pid(req))));
}
