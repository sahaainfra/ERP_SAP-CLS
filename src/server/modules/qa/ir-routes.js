import { notFound } from '../../platform/http/errors.js';
import { parseId, parseReason, parseIrCreate, parseIrUpdate, parseIrAssess, parseIrOptionsQ, parseGateQ, parseIrAnalysisQ } from './validators.js';

/** /api/v1/qa inspection requests and hold points (part 18.02, flag ff.qa.p1802). */
export function irRoutes(r, svc, { ok, pid, file, idempotent, idempotentRequired, flags }) {
  const { requests } = svc; const path = '/inspection-requests';
  r.use([path, '/hold-points', '/ir-analysis'], (req, _res, next) => (flags.isOn(req.actor, 'ff.qa.p1802') ? next() : next(notFound('Inspection requests are not enabled for your company yet.'))));
  r.get('/hold-points/check', (req, res) => ok(res, svc.gateCheck(req.actor, parseGateQ(req.query))));
  r.get('/ir-analysis', (req, res) => ok(res, svc.analysis(req.actor, parseIrAnalysisQ(req.query))));
  r.get(`${path}/options`, (req, res) => ok(res, requests.options(req.actor, parseIrOptionsQ(req.query))));
  r.get(`${path}/export`, (req, res) => file(res, svc.exportCsv(req.actor, {})));
  r.get(path, (req, res) => res.json(requests.list(req.actor, req.query)));
  r.post(path, idempotentRequired, (req, res) => ok(res, requests.create(req.actor, parseIrCreate(req.body)), 201));
  r.get(`${path}/:id`, (req, res) => ok(res, requests.get(req.actor, pid(req))));
  r.patch(`${path}/:id`, idempotent, (req, res) => ok(res, requests.update(req.actor, pid(req), parseIrUpdate(req.body))));
  r.delete(`${path}/:id`, (req, res) => ok(res, requests.remove(req.actor, pid(req))));
  r.post(`${path}/:id/submit`, idempotentRequired, (req, res) => ok(res, requests.submit(req.actor, pid(req)), 202));
  r.post(`${path}/:id/withdraw`, idempotent, (req, res) => ok(res, requests.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post(`${path}/:id/cancel`, idempotent, (req, res) => ok(res, requests.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post(`${path}/:id/assess`, idempotent, (req, res) => ok(res, requests.assess(req.actor, pid(req), parseIrAssess(req.body))));
  r.get(`${path}/:id/history`, (req, res) => ok(res, requests.history(req.actor, pid(req))));
  r.get(`${path}/:id/print`, (req, res) => file(res, requests.print(req.actor, pid(req))));
  void parseId;
}
