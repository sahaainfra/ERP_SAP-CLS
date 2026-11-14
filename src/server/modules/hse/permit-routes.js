import { notFound } from '../../platform/http/errors.js';
import * as v from './validators.js';

/** /api/v1/hse permits to work (part 19.02, flag ff.hse.p1902). */
export function permitRoutes(r, svc, { ok, pid, file, idempotent, idempotentRequired, flags }) {
  const { permits, types } = svc; const q = (req) => req.query;
  r.use(['/permits', '/permit-types'], (req, _res, next) => (flags.isOn(req.actor, 'ff.hse.p1902') ? next() : next(notFound('Permits to work are not enabled for your company yet.'))));
  r.get('/permit-types/options', (req, res) => ok(res, types.options(req.actor)));
  r.get('/permit-types', (req, res) => res.json(types.list(req.actor, q(req))));
  r.post('/permit-types', idempotentRequired, (req, res) => ok(res, types.create(req.actor, v.parsePermitTypeCreate(req.body)), 201));
  r.get('/permit-types/:id', (req, res) => ok(res, types.get(req.actor, pid(req))));
  r.patch('/permit-types/:id', idempotent, (req, res) => ok(res, types.update(req.actor, pid(req), v.parsePermitTypeUpdate(req.body))));
  r.delete('/permit-types/:id', (req, res) => ok(res, types.remove(req.actor, pid(req))));
  r.get('/permits/options', (req, res) => ok(res, permits.options(req.actor, q(req).projectId ? { projectId: Number(q(req).projectId) } : {})));
  r.get('/permits/board', (req, res) => ok(res, permits.board(req.actor, v.parseBoardQ(q(req)))));
  r.get('/permits/pending', (req, res) => ok(res, permits.pending(req.actor)));
  r.get('/permits/conflicts', (req, res) => ok(res, permits.conflicts(req.actor, v.parseConflictQ(q(req)))));
  r.get('/permits/export', (req, res) => file(res, svc.exportPermits(req.actor)));
  r.get('/permits', (req, res) => res.json(permits.list(req.actor, q(req))));
  r.post('/permits', idempotentRequired, (req, res) => ok(res, permits.create(req.actor, v.parsePermitCreate(req.body)), 201));
  r.get('/permits/:id', (req, res) => ok(res, permits.get(req.actor, pid(req))));
  r.patch('/permits/:id', idempotent, (req, res) => ok(res, permits.update(req.actor, pid(req), v.parsePermitUpdate(req.body))));
  r.delete('/permits/:id', (req, res) => ok(res, permits.remove(req.actor, pid(req))));
  r.get('/permits/:id/check', (req, res) => ok(res, permits.check(req.actor, pid(req))));
  r.post('/permits/:id/submit', idempotentRequired, (req, res) => ok(res, permits.submit(req.actor, pid(req)), 202));
  r.post('/permits/:id/withdraw', idempotent, (req, res) => ok(res, permits.withdraw(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/permits/:id/cancel', idempotent, (req, res) => ok(res, permits.cancel(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/permits/:id/amend', idempotent, (req, res) => ok(res, permits.amend(req.actor, pid(req), v.parseReason(req.body))));
  r.get('/permits/:id/history', (req, res) => ok(res, permits.history(req.actor, pid(req))));
  r.get('/permits/:id/print', (req, res) => file(res, permits.print(req.actor, pid(req))));
  r.post('/permits/:id/gas-tests', idempotent, (req, res) => ok(res, permits.gasTest(req.actor, pid(req), v.parseGasTest(req.body)), 201));
  r.post('/permits/:id/isolations', idempotent, (req, res) => ok(res, permits.isolate(req.actor, pid(req), v.parseIsolation(req.body)), 201));
  r.post('/permits/:id/isolations/remove', idempotent, (req, res) => ok(res, permits.deisolate(req.actor, pid(req), v.parseIsolationRemove(req.body))));
  r.post('/permits/:id/extend', idempotent, (req, res) => ok(res, permits.extend(req.actor, pid(req), v.parseExtend(req.body))));
  r.post('/permits/:id/suspend', idempotent, (req, res) => ok(res, permits.suspend(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/permits/:id/resume', idempotent, (req, res) => ok(res, permits.resume(req.actor, pid(req), v.parseResume(req.body))));
  r.post('/permits/:id/activate', idempotent, (req, res) => ok(res, permits.activate(req.actor, pid(req))));
  r.post('/permits/:id/close', idempotent, (req, res) => ok(res, permits.close(req.actor, pid(req), v.parseClose(req.body))));
}
