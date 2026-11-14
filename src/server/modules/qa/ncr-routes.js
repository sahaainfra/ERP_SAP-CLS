import { notFound } from '../../platform/http/errors.js';
import { parseId, parseReason, parseNcrCreate, parseNcrUpdate, parseNcrPrefillQ, parseCapaCreate, parseCapaComplete, parseRectify, parseReinspection, parseConcession, parseClosure, parseNcrAnalysisQ, parseBackchargeQ, parseBackchargePosted } from './validators.js';

/** /api/v1/qa NCRs and CAPA (part 18.04, flag ff.qa.p1804). */
export function ncrRoutes(r, svc, { ok, pid, file, idempotent, idempotentRequired, flags }) {
  const { ncrs } = svc; const p = '/ncrs'; const sub = (req) => parseId(req.params.cid);
  r.use([p, '/ncr-analysis'], (req, _res, next) => (flags.isOn(req.actor, 'ff.qa.p1804') ? next() : next(notFound('Non-conformance reports are not enabled for your company yet.'))));
  r.get('/ncr-analysis', (req, res) => ok(res, svc.analysis(req.actor, parseNcrAnalysisQ(req.query))));
  r.get(`${p}/options`, (req, res) => ok(res, ncrs.options(req.actor)));
  r.get(`${p}/prefill`, (req, res) => ok(res, ncrs.prefill(req.actor, parseNcrPrefillQ(req.query))));
  r.get(`${p}/backcharges`, (req, res) => ok(res, svc.backcharges(req.actor, parseBackchargeQ(req.query))));
  r.get(`${p}/export`, (req, res) => file(res, svc.exportCsv(req.actor, {})));
  r.get(p, (req, res) => res.json(ncrs.list(req.actor, req.query)));
  r.post(p, idempotentRequired, (req, res) => ok(res, ncrs.create(req.actor, parseNcrCreate(req.body)), 201));
  r.get(`${p}/:id`, (req, res) => ok(res, ncrs.get(req.actor, pid(req))));
  r.patch(`${p}/:id`, idempotent, (req, res) => ok(res, ncrs.update(req.actor, pid(req), parseNcrUpdate(req.body))));
  r.delete(`${p}/:id`, (req, res) => ok(res, ncrs.remove(req.actor, pid(req))));
  r.post(`${p}/:id/raise`, idempotentRequired, (req, res) => ok(res, ncrs.raise(req.actor, pid(req))));
  r.post(`${p}/:id/cancel`, idempotent, (req, res) => ok(res, ncrs.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post(`${p}/:id/capa`, idempotentRequired, (req, res) => ok(res, ncrs.addCapa(req.actor, pid(req), parseCapaCreate(req.body)), 201));
  r.post(`${p}/:id/capa/:cid/complete`, idempotent, (req, res) => ok(res, ncrs.completeCapa(req.actor, pid(req), sub(req), parseCapaComplete(req.body))));
  r.post(`${p}/:id/capa/:cid/cancel`, idempotent, (req, res) => ok(res, ncrs.cancelCapa(req.actor, pid(req), sub(req), parseReason(req.body))));
  r.post(`${p}/:id/rectify`, idempotentRequired, (req, res) => ok(res, ncrs.rectify(req.actor, pid(req), parseRectify(req.body))));
  r.post(`${p}/:id/reinspection`, idempotent, (req, res) => ok(res, ncrs.reinspection(req.actor, pid(req), parseReinspection(req.body))));
  r.post(`${p}/:id/request-concession`, idempotentRequired, (req, res) => ok(res, ncrs.requestConcession(req.actor, pid(req), parseConcession(req.body)), 202));
  r.post(`${p}/:id/request-closure`, idempotentRequired, (req, res) => ok(res, ncrs.requestClosure(req.actor, pid(req), parseClosure(req.body)), 202));
  r.post(`${p}/:id/withdraw`, idempotent, (req, res) => ok(res, ncrs.withdrawReview(req.actor, pid(req), parseReason(req.body))));
  r.post(`${p}/:id/backcharge-posted`, idempotent, (req, res) => ok(res, svc.markBackchargePosted(req.actor, pid(req), parseBackchargePosted(req.body))));
  r.get(`${p}/:id/history`, (req, res) => ok(res, ncrs.history(req.actor, pid(req))));
  r.get(`${p}/:id/print`, (req, res) => file(res, ncrs.print(req.actor, pid(req))));
}
