import { notFound } from '../../platform/http/errors.js';
import * as v from './validators.js';

/** /api/v1/hse incidents, investigations and lessons learned (part 19.03, flag ff.hse.p1903). */
export function incidentRoutes(r, svc, { ok, pid, file, idempotent, idempotentRequired, flags }) {
  const { incidents } = svc; const q = (req) => req.query; const aid = (req) => v.parseActionRef(req.params.aid);
  r.use(['/incidents', '/lessons'], (req, _res, next) => (flags.isOn(req.actor, 'ff.hse.p1903') ? next() : next(notFound('Incident management is not enabled for your company yet.'))));
  r.get('/incidents/options', (req, res) => ok(res, incidents.options(req.actor, q(req).projectId ? { projectId: Number(q(req).projectId) } : {})));
  r.get('/incidents/stats', (req, res) => ok(res, svc.stats(req.actor, v.parseStatsQ(q(req)))));
  r.get('/incidents/export', (req, res) => file(res, svc.exportIncidents(req.actor)));
  r.get('/lessons', (req, res) => ok(res, svc.lessons(req.actor, q(req))));
  r.get('/incidents', (req, res) => res.json(incidents.list(req.actor, q(req))));
  r.post('/incidents', idempotentRequired, (req, res) => ok(res, incidents.create(req.actor, v.parseIncidentCreate(req.body)), 201));
  r.get('/incidents/:id', (req, res) => ok(res, incidents.get(req.actor, pid(req))));
  r.patch('/incidents/:id', idempotent, (req, res) => ok(res, incidents.update(req.actor, pid(req), v.parseIncidentUpdate(req.body))));
  r.delete('/incidents/:id', (req, res) => ok(res, incidents.remove(req.actor, pid(req))));
  r.post('/incidents/:id/submit', idempotentRequired, (req, res) => ok(res, incidents.submit(req.actor, pid(req)), 202));
  r.post('/incidents/:id/withdraw', idempotent, (req, res) => ok(res, incidents.withdraw(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/incidents/:id/cancel', idempotent, (req, res) => ok(res, incidents.cancel(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/incidents/:id/amend', idempotent, (req, res) => ok(res, incidents.amend(req.actor, pid(req), v.parseReason(req.body))));
  r.get('/incidents/:id/history', (req, res) => ok(res, incidents.history(req.actor, pid(req))));
  r.get('/incidents/:id/print', (req, res) => file(res, incidents.print(req.actor, pid(req))));
  r.post('/incidents/:id/photos', idempotent, (req, res) => ok(res, incidents.photo(req.actor, pid(req), v.parseFileAttach(req.body))));
  r.post('/incidents/:id/investigation', idempotent, (req, res) => ok(res, incidents.investigate(req.actor, pid(req), v.parseInvestigation(req.body))));
  r.post('/incidents/:id/actions', idempotent, (req, res) => ok(res, incidents.addAction(req.actor, pid(req), v.parseIncidentAction(req.body)), 201));
  r.post('/incidents/:id/actions/:aid/done', idempotent, (req, res) => ok(res, incidents.doneAction(req.actor, pid(req), aid(req), v.parseActionDone(req.body))));
  r.post('/incidents/:id/actions/:aid/cancel', idempotent, (req, res) => ok(res, incidents.cancelAction(req.actor, pid(req), aid(req), v.parseReason(req.body))));
  r.post('/incidents/:id/statutory', idempotent, (req, res) => ok(res, incidents.statutory(req.actor, pid(req), v.parseStatutory(req.body)), 201));
  r.post('/incidents/:id/insurance', idempotent, (req, res) => ok(res, incidents.insurance(req.actor, pid(req), v.parseInsurance(req.body)), 201));
  r.post('/incidents/:id/lessons', idempotent, (req, res) => ok(res, incidents.publish(req.actor, pid(req), v.parseLessons(req.body))));
}
