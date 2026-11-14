import { notFound } from '../../platform/http/errors.js';
import * as v from './validators.js';

/** /api/v1/ctr subcontractor workspace: compliance, waivers, manpower, strength, ratings and the payment gate (part 21.04, flag ff.ctr.p2104). */
export function subcontractorRoutes(r, svc, { ok, pid, file, idempotent, idempotentRequired, flags }) {
  const { compliance: cp, waivers: wv, manpower: mp, ratings: rt } = svc.subcontractors; const sb = svc.subcontractors; const q = (req) => req.query;
  r.use(['/subcontractors', '/sub-compliance', '/sub-waivers', '/sub-manpower', '/sub-strength', '/sub-ratings', '/sub-payment-check'], (req, _res, next) => (flags.isOn(req.actor, 'ff.ctr.p2104') ? next() : next(notFound('The subcontractor workspace is not enabled for your company yet.'))));
  r.get('/subcontractors', (req, res) => res.json(sb.list(req.actor, v.parseSubListQ(q(req)))));
  r.get('/subcontractors/workspace', (req, res) => ok(res, sb.workspace(req.actor, v.parseWorkspaceQ(q(req)))));
  r.get('/sub-payment-check', (req, res) => ok(res, sb.paymentGate(req.actor.companyId, v.parseGateQ(q(req)))));
  r.get('/sub-compliance/export', (req, res) => file(res, cp.exportCsv(req.actor)));
  r.post('/sub-compliance/open', idempotentRequired, (req, res) => ok(res, cp.open(req.actor, v.parseSubOpen(req.body)), 201));
  r.get('/sub-compliance', (req, res) => res.json(cp.list(req.actor, q(req))));
  r.get('/sub-compliance/:id', (req, res) => ok(res, cp.get(req.actor, pid(req))));
  r.put('/sub-compliance/:id/items', idempotent, (req, res) => ok(res, cp.saveItems(req.actor, pid(req), v.parseSubItems(req.body))));
  r.post('/sub-compliance/:id/submit', idempotentRequired, (req, res) => ok(res, cp.submit(req.actor, pid(req)), 202));
  r.post('/sub-compliance/:id/verify', idempotentRequired, (req, res) => ok(res, cp.verify(req.actor, pid(req), v.parseSubVerify(req.body))));
  r.get('/sub-waivers', (req, res) => res.json(wv.list(req.actor)));
  r.post('/sub-waivers', idempotentRequired, (req, res) => ok(res, wv.create(req.actor, v.parseWaiverCreate(req.body)), 201));
  r.get('/sub-waivers/:id', (req, res) => ok(res, wv.get(req.actor, pid(req))));
  r.patch('/sub-waivers/:id', idempotent, (req, res) => ok(res, wv.update(req.actor, pid(req), v.parseWaiverUpdate(req.body))));
  r.delete('/sub-waivers/:id', (req, res) => ok(res, wv.remove(req.actor, pid(req))));
  r.post('/sub-waivers/:id/submit', idempotentRequired, (req, res) => ok(res, wv.submit(req.actor, pid(req)), 202));
  r.post('/sub-waivers/:id/withdraw', idempotent, (req, res) => ok(res, wv.withdraw(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/sub-waivers/:id/cancel', idempotent, (req, res) => ok(res, wv.cancel(req.actor, pid(req), v.parseReason(req.body))));
  r.get('/sub-waivers/:id/history', (req, res) => ok(res, wv.history(req.actor, pid(req))));
  r.get('/sub-manpower', (req, res) => ok(res, mp.list(req.actor, { projectId: q(req).projectId ? v.parseId(q(req).projectId) : undefined })));
  r.put('/sub-manpower', idempotent, (req, res) => ok(res, mp.set(req.actor, v.parseManpower(req.body))));
  r.delete('/sub-manpower/:id', (req, res) => ok(res, mp.remove(req.actor, pid(req))));
  r.get('/sub-strength', (req, res) => ok(res, sb.strength(req.actor, v.parseStrengthQ(q(req)))));
  r.get('/sub-ratings', (req, res) => ok(res, rt.list(req.actor, v.parseRatingQ(q(req)))));
  r.post('/sub-ratings/run', idempotentRequired, (req, res) => ok(res, rt.run(req.actor, v.parseRatingRun(req.body)), 201));
}
