import { notFound } from '../../platform/http/errors.js';
import * as v from './validators.js';

/** /api/v1/ctr change and variation management: change requests, variation orders and the summary (part 21.05, flag ff.ctr.p2105). */
export function variationRoutes(r, svc, { ok, pid, file, idempotent, idempotentRequired, flags }) {
  const { changeRequests: cr, variationOrders: vo, variations } = svc; const q = (req) => req.query;
  r.use(['/change-requests', '/variation-orders', '/variation-summary', '/variation-gate'], (req, _res, next) => (flags.isOn(req.actor, 'ff.ctr.p2105') ? next() : next(notFound('Variation management is not enabled for your company yet.'))));
  r.get('/change-requests/options', (req, res) => ok(res, cr.options(req.actor)));
  r.get('/change-requests/export', (req, res) => file(res, cr.exportCsv(req.actor)));
  r.get('/change-requests', (req, res) => res.json(cr.list(req.actor, q(req))));
  r.post('/change-requests', idempotentRequired, (req, res) => ok(res, cr.create(req.actor, v.parseCrCreate(req.body)), 201));
  r.get('/change-requests/:id', (req, res) => ok(res, cr.get(req.actor, pid(req))));
  r.patch('/change-requests/:id', idempotent, (req, res) => ok(res, cr.update(req.actor, pid(req), v.parseCrUpdate(req.body))));
  r.delete('/change-requests/:id', (req, res) => ok(res, cr.remove(req.actor, pid(req))));
  r.put('/change-requests/:id/review', idempotent, (req, res) => ok(res, cr.review(req.actor, pid(req), v.parseCrReview(req.body))));
  r.put('/change-requests/:id/evaluation', idempotent, (req, res) => ok(res, cr.evaluate(req.actor, pid(req), v.parseCrEvaluate(req.body))));
  r.post('/change-requests/:id/submit', idempotentRequired, (req, res) => ok(res, cr.submit(req.actor, pid(req)), 202));
  r.post('/change-requests/:id/withdraw', idempotent, (req, res) => ok(res, cr.withdraw(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/change-requests/:id/cancel', idempotent, (req, res) => ok(res, cr.cancel(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/change-requests/:id/to-client', idempotentRequired, (req, res) => ok(res, cr.toClient(req.actor, pid(req), v.parseCrToClient(req.body))));
  r.post('/change-requests/:id/client-response', idempotentRequired, (req, res) => ok(res, cr.respond(req.actor, pid(req), v.parseCrResponse(req.body))));
  r.get('/change-requests/:id/history', (req, res) => ok(res, cr.history(req.actor, pid(req))));
  r.get('/change-requests/:id/proposal', (req, res) => file(res, cr.proposal(req.actor, pid(req))));
  r.get('/variation-orders/:id', (req, res) => ok(res, vo.get(req.actor, pid(req))));
  r.patch('/variation-orders/:id', idempotent, (req, res) => ok(res, vo.update(req.actor, pid(req), v.parseVoUpdate(req.body))));
  r.post('/variation-orders/:id/submit', idempotentRequired, (req, res) => ok(res, vo.submit(req.actor, pid(req)), 202));
  r.post('/variation-orders/:id/withdraw', idempotent, (req, res) => ok(res, vo.withdraw(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/variation-orders/:id/cancel', idempotent, (req, res) => ok(res, vo.cancel(req.actor, pid(req), v.parseReason(req.body))));
  r.get('/variation-orders/:id/history', (req, res) => ok(res, vo.history(req.actor, pid(req))));
  r.get('/variation-summary', (req, res) => ok(res, cr.summary(req.actor, v.parseVarSummaryQ(q(req)))));
  r.get('/variation-gate', (req, res) => ok(res, variations.billingGate(req.actor.companyId, v.parseGateVoQ(q(req)))));
}
