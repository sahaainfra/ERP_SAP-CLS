import { notFound } from '../../platform/http/errors.js';
import * as v from './validators.js';

/** /api/v1/hse inspection schedules, observations, PPE, safety equipment and contractor scores (part 19.04, flag ff.hse.p1904). */
export function safetyRoutes(r, svc, { ok, pid, file, idempotent, idempotentRequired, flags }) {
  const { observations, schedules, ppe, ppeItems, equipment } = svc; const q = (req) => req.query;
  r.use(['/observations', '/inspection-schedules', '/ppe', '/ppe-items', '/equipment', '/contractor-scores'], (req, _res, next) => (flags.isOn(req.actor, 'ff.hse.p1904') ? next() : next(notFound('Observations, PPE and contractor safety are not enabled for your company yet.'))));
  r.get('/observations/options', (req, res) => ok(res, observations.options(req.actor, q(req).projectId ? { projectId: Number(q(req).projectId) } : {})));
  r.get('/observations/export', (req, res) => file(res, svc.exportObservations(req.actor)));
  r.get('/observations', (req, res) => res.json(observations.list(req.actor, q(req))));
  r.post('/observations', idempotentRequired, (req, res) => ok(res, observations.create(req.actor, v.parseObsCreate(req.body)), 201));
  r.get('/observations/:id', (req, res) => ok(res, observations.get(req.actor, pid(req))));
  r.patch('/observations/:id', idempotent, (req, res) => ok(res, observations.update(req.actor, pid(req), v.parseObsUpdate(req.body))));
  r.delete('/observations/:id', (req, res) => ok(res, observations.remove(req.actor, pid(req))));
  r.post('/observations/:id/photos', idempotent, (req, res) => ok(res, observations.photo(req.actor, pid(req), v.parseFileAttach(req.body))));
  r.post('/observations/:id/act', idempotent, (req, res) => ok(res, observations.act(req.actor, pid(req), v.parseObsAct(req.body))));
  r.post('/observations/:id/close', idempotent, (req, res) => ok(res, observations.close(req.actor, pid(req), v.parseResume(req.body))));
  r.post('/observations/:id/reopen', idempotent, (req, res) => ok(res, observations.reopen(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/observations/:id/penalty', idempotent, (req, res) => ok(res, observations.penalty(req.actor, pid(req), v.parsePenalty(req.body))));
  r.post('/observations/:id/submit', idempotentRequired, (req, res) => ok(res, observations.submit(req.actor, pid(req)), 202));
  r.post('/observations/:id/withdraw', idempotent, (req, res) => ok(res, observations.withdraw(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/observations/:id/cancel', idempotent, (req, res) => ok(res, observations.cancel(req.actor, pid(req), v.parseReason(req.body))));
  r.get('/observations/:id/history', (req, res) => ok(res, observations.history(req.actor, pid(req))));
  r.get('/observations/:id/print', (req, res) => file(res, observations.print(req.actor, pid(req))));
  r.get('/inspection-schedules/options', (req, res) => ok(res, schedules.options(req.actor)));
  r.get('/inspection-schedules', (req, res) => res.json(schedules.list(req.actor, q(req))));
  r.post('/inspection-schedules', idempotentRequired, (req, res) => ok(res, schedules.create(req.actor, v.parseScheduleCreate(req.body)), 201));
  r.get('/inspection-schedules/:id', (req, res) => ok(res, schedules.get(req.actor, pid(req))));
  r.patch('/inspection-schedules/:id', idempotent, (req, res) => ok(res, schedules.update(req.actor, pid(req), v.parseScheduleUpdate(req.body))));
  r.delete('/inspection-schedules/:id', (req, res) => ok(res, schedules.remove(req.actor, pid(req))));
  r.post('/inspection-schedules/:id/record', idempotent, (req, res) => ok(res, schedules.record(req.actor, pid(req), v.parseScheduleRecord(req.body))));
  r.get('/ppe-items', (req, res) => ok(res, ppeItems.list(req.actor)));
  r.post('/ppe-items', idempotentRequired, (req, res) => ok(res, ppeItems.create(req.actor, v.parsePpeItemCreate(req.body)), 201));
  r.patch('/ppe-items/:id', idempotent, (req, res) => ok(res, ppeItems.update(req.actor, pid(req), v.parsePpeItemUpdate(req.body))));
  r.get('/ppe/options', (req, res) => ok(res, ppe.options(req.actor)));
  r.get('/ppe/person', (req, res) => ok(res, ppe.byPerson(req.actor, v.parsePpeQ(q(req)))));
  r.get('/ppe', (req, res) => res.json(ppe.list(req.actor, q(req))));
  r.post('/ppe', idempotentRequired, (req, res) => ok(res, ppe.issue(req.actor, v.parsePpeIssue(req.body)), 201));
  r.post('/ppe/:id/return', idempotent, (req, res) => ok(res, ppe.return(req.actor, pid(req), v.parsePpeReturn(req.body))));
  r.get('/equipment/options', (req, res) => ok(res, equipment.options(req.actor, q(req).projectId ? { projectId: Number(q(req).projectId) } : {})));
  r.get('/equipment', (req, res) => res.json(equipment.list(req.actor, q(req))));
  r.post('/equipment', idempotentRequired, (req, res) => ok(res, equipment.create(req.actor, v.parseEquipCreate(req.body)), 201));
  r.get('/equipment/:id', (req, res) => ok(res, equipment.get(req.actor, pid(req))));
  r.patch('/equipment/:id', idempotent, (req, res) => ok(res, equipment.update(req.actor, pid(req), v.parseEquipUpdate(req.body))));
  r.delete('/equipment/:id', (req, res) => ok(res, equipment.remove(req.actor, pid(req))));
  r.post('/equipment/:id/inspect', idempotent, (req, res) => ok(res, equipment.inspect(req.actor, pid(req), v.parseEquipInspect(req.body))));
  r.get('/contractor-scores/export', (req, res) => file(res, svc.exportScores(req.actor, v.parseScoreQ(q(req)))));
  r.get('/contractor-scores', (req, res) => ok(res, svc.scores.list(req.actor, v.parseScoreQ(q(req)))));
}
