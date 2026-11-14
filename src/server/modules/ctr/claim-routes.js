import { notFound } from '../../platform/http/errors.js';
import * as v from './validators.js';

/** /api/v1/ctr claims: events, claims, evidence, quantum, submissions, determination, the time-bar watchlist and disputes (part 21.06, flag ff.ctr.p2106). */
export function claimRoutes(r, svc, { ok, pid, file, idempotent, idempotentRequired, flags }) {
  const { claims: cl, claimEvents: ev, disputes: dp } = svc; const q = (req) => req.query;
  r.use(['/claims', '/claim-events', '/claim-watchlist', '/disputes'], (req, _res, next) => (flags.isOn(req.actor, 'ff.ctr.p2106') ? next() : next(notFound('Claims management is not enabled for your company yet.'))));
  r.get('/claims/options', (req, res) => ok(res, cl.options(req.actor)));
  r.get('/claims/export', (req, res) => file(res, cl.exportCsv(req.actor)));
  r.get('/claims', (req, res) => res.json(cl.list(req.actor, q(req))));
  r.post('/claims', idempotentRequired, (req, res) => ok(res, cl.create(req.actor, v.parseClaimCreate(req.body)), 201));
  r.get('/claims/:id', (req, res) => ok(res, cl.get(req.actor, pid(req))));
  r.patch('/claims/:id', idempotent, (req, res) => ok(res, cl.update(req.actor, pid(req), v.parseClaimUpdate2(req.body))));
  r.delete('/claims/:id', (req, res) => ok(res, cl.remove(req.actor, pid(req))));
  r.post('/claims/:id/submit', idempotentRequired, (req, res) => ok(res, cl.submit(req.actor, pid(req)), 202));
  r.post('/claims/:id/withdraw', idempotent, (req, res) => ok(res, cl.withdraw(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/claims/:id/cancel', idempotent, (req, res) => ok(res, cl.cancel(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/claims/:id/notice', idempotentRequired, (req, res) => ok(res, cl.serveNotice(req.actor, pid(req), v.parseNotice(req.body))));
  r.post('/claims/:id/waive-bar', idempotentRequired, (req, res) => ok(res, cl.waiveBar(req.actor, pid(req), v.parseWaiveBar(req.body))));
  r.put('/claims/:id/quantum', idempotent, (req, res) => ok(res, cl.setQuantum(req.actor, pid(req), v.parseQuantum(req.body))));
  r.post('/claims/:id/evidence/assemble', idempotentRequired, (req, res) => ok(res, cl.assembleEvidence(req.actor, pid(req)), 201));
  r.post('/claims/:id/evidence', idempotentRequired, (req, res) => ok(res, cl.addEvidence(req.actor, pid(req), v.parseEvidenceAdd(req.body)), 201));
  r.post('/claims/:id/to-client', idempotentRequired, (req, res) => ok(res, cl.submitToClient(req.actor, pid(req), v.parseClaimSubmit(req.body))));
  r.post('/claims/:id/responses', idempotentRequired, (req, res) => ok(res, cl.logResponse(req.actor, pid(req), v.parseClaimLog(req.body)), 201));
  r.post('/claims/:id/determination', idempotentRequired, (req, res) => ok(res, cl.determine(req.actor, pid(req), v.parseDetermine(req.body))));
  r.get('/claims/:id/history', (req, res) => ok(res, cl.history(req.actor, pid(req))));
  r.get('/claims/:id/print', (req, res) => file(res, cl.print(req.actor, pid(req))));
  r.get('/claim-events', (req, res) => ok(res, ev.list(req.actor, { projectId: q(req).projectId ? v.parseId(q(req).projectId) : undefined })));
  r.post('/claim-events', idempotentRequired, (req, res) => ok(res, ev.add(req.actor, v.parseEventAdd(req.body)), 201));
  r.get('/claim-watchlist', (req, res) => ok(res, svc.claimWatchlist(req.actor, v.parseClaimQ(q(req)))));
  r.get('/disputes', (req, res) => res.json(dp.list(req.actor, q(req))));
  r.post('/disputes', idempotentRequired, (req, res) => ok(res, dp.create(req.actor, v.parseDisputeCreate(req.body)), 201));
  r.get('/disputes/:id', (req, res) => ok(res, dp.get(req.actor, pid(req))));
  r.patch('/disputes/:id', idempotent, (req, res) => ok(res, dp.update(req.actor, pid(req), v.parseDisputeUpdate(req.body))));
  r.delete('/disputes/:id', (req, res) => ok(res, dp.remove(req.actor, pid(req))));
  r.post('/disputes/:id/submit', idempotentRequired, (req, res) => ok(res, dp.submit(req.actor, pid(req)), 202));
  r.post('/disputes/:id/withdraw', idempotent, (req, res) => ok(res, dp.withdraw(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/disputes/:id/cancel', idempotent, (req, res) => ok(res, dp.cancel(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/disputes/:id/log', idempotentRequired, (req, res) => ok(res, dp.log(req.actor, pid(req), v.parseDisputeLog(req.body)), 201));
  r.get('/disputes/:id/history', (req, res) => ok(res, dp.history(req.actor, pid(req))));
}
