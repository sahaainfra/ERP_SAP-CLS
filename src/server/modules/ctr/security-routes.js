import { notFound } from '../../platform/http/errors.js';
import * as v from './validators.js';

/** /api/v1/ctr securities: bank guarantees, insurance, bank limits and exposure (part 21.02, flag ff.ctr.p2102). */
export function securityRoutes(r, svc, { ok, pid, file, idempotent, idempotentRequired, flags }) {
  const { guarantees, insurances, limits } = svc; const q = (req) => req.query;
  r.use(['/bank-guarantees', '/bg-requests', '/insurances', '/insurance-claims', '/bank-limits', '/securities'], (req, _res, next) => (flags.isOn(req.actor, 'ff.ctr.p2102') ? next() : next(notFound('Securities tracking is not enabled for your company yet.'))));
  const doc = (path, s, parseCreate, parseUpdate) => {
    r.get(`${path}/options`, (req, res) => ok(res, s.options(req.actor)));
    r.get(`${path}/export`, (req, res) => file(res, s.exportCsv(req.actor)));
    r.post(`${path}/import`, idempotentRequired, (req, res) => ok(res, s.importRows(req.actor, { rows: Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 500) : [] }), 201));
    r.get(path, (req, res) => res.json(s.list(req.actor, q(req))));
    r.post(path, idempotentRequired, (req, res) => ok(res, s.create(req.actor, parseCreate(req.body)), 201));
    r.get(`${path}/:id`, (req, res) => ok(res, s.get(req.actor, pid(req))));
    r.patch(`${path}/:id`, idempotent, (req, res) => ok(res, s.update(req.actor, pid(req), parseUpdate(req.body))));
    r.delete(`${path}/:id`, (req, res) => ok(res, s.remove(req.actor, pid(req))));
    r.post(`${path}/:id/submit`, idempotentRequired, (req, res) => ok(res, s.submit(req.actor, pid(req)), 202));
    r.post(`${path}/:id/withdraw`, idempotent, (req, res) => ok(res, s.withdraw(req.actor, pid(req), v.parseReason(req.body))));
    r.post(`${path}/:id/cancel`, idempotent, (req, res) => ok(res, s.cancel(req.actor, pid(req), v.parseReason(req.body))));
    r.post(`${path}/:id/amend`, idempotent, (req, res) => ok(res, s.amend(req.actor, pid(req), v.parseReason(req.body))));
    r.get(`${path}/:id/history`, (req, res) => ok(res, s.history(req.actor, pid(req))));
    r.get(`${path}/:id/print`, (req, res) => file(res, s.print(req.actor, pid(req))));
  };
  doc('/bank-guarantees', guarantees, v.parseBgCreate, v.parseBgUpdate);
  r.post('/bank-guarantees/:id/requests', idempotentRequired, (req, res) => ok(res, guarantees.request(req.actor, pid(req), v.parseBgRequest(req.body)), 201));
  r.get('/bank-guarantees/:id/letter', (req, res) => file(res, guarantees.letter(req.actor, pid(req), v.parseLetterQ(q(req)))));
  r.post('/bg-requests/:id/decide', idempotentRequired, (req, res) => ok(res, guarantees.decideRequest(req.actor, pid(req), v.parseBgDecide(req.body))));
  doc('/insurances', insurances, v.parseInsCreate, v.parseInsUpdate);
  r.post('/insurances/:id/renew', idempotentRequired, (req, res) => ok(res, insurances.renew(req.actor, pid(req), v.parseReason(req.body)), 201));
  r.post('/insurances/:id/claims', idempotentRequired, (req, res) => ok(res, insurances.addClaim(req.actor, pid(req), v.parseClaim(req.body)), 201));
  r.patch('/insurance-claims/:id', idempotent, (req, res) => ok(res, insurances.updateClaim(req.actor, pid(req), v.parseClaimUpdate(req.body))));
  r.get('/bank-limits', (req, res) => ok(res, limits.list(req.actor)));
  r.put('/bank-limits', idempotent, (req, res) => ok(res, limits.set(req.actor, v.parseLimit(req.body))));
  r.delete('/bank-limits/:id', (req, res) => ok(res, limits.remove(req.actor, pid(req))));
  r.get('/securities/exposure', (req, res) => ok(res, svc.exposure(req.actor, v.parseExposureQ(q(req)))));
  r.get('/securities/position', (req, res) => ok(res, svc.position(req.actor, v.parseId(q(req).contractId))));
}
