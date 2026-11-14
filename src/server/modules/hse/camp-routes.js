import { notFound } from '../../platform/http/errors.js';
import * as v from './validators.js';

/** /api/v1/hse labour camp and welfare (part 19.07, flag ff.hse.p1907). */
export function campRoutes(r, svc, { ok, pid, file, idempotent, idempotentRequired, flags }) {
  const { camps, allocations, meals, recoveries, campInspections } = svc; const q = (req) => req.query;
  r.use(['/camps', '/camp-rooms', '/camp-assets', '/allocations', '/camp-meals', '/camp-recoveries', '/camp-inspections', '/camp-occupancy', '/camp-mess', '/camp-muster'], (req, _res, next) => (flags.isOn(req.actor, 'ff.hse.p1907') ? next() : next(notFound('Labour camp management is not enabled for your company yet.'))));
  r.get('/camps/options', (req, res) => ok(res, camps.options(req.actor)));
  r.get('/camps', (req, res) => res.json(camps.list(req.actor, q(req))));
  r.post('/camps', idempotentRequired, (req, res) => ok(res, camps.create(req.actor, v.parseCampCreate(req.body)), 201));
  r.get('/camps/:id', (req, res) => ok(res, camps.get(req.actor, pid(req))));
  r.patch('/camps/:id', idempotent, (req, res) => ok(res, camps.update(req.actor, pid(req), v.parseCampUpdate(req.body))));
  r.get('/camps/:id/assets', (req, res) => ok(res, camps.assets(req.actor, pid(req))));
  r.get('/camps/:id/muster', (req, res) => ok(res, svc.muster(req.actor, pid(req))));
  r.get('/camps/:id/muster/pdf', (req, res) => file(res, svc.musterPdf(req.actor, pid(req))));
  r.post('/camp-rooms', idempotentRequired, (req, res) => ok(res, camps.addRoom(req.actor, v.parseRoomCreate(req.body)), 201));
  r.patch('/camp-rooms/:id', idempotent, (req, res) => ok(res, camps.updateRoom(req.actor, pid(req), v.parseRoomUpdate(req.body))));
  r.post('/camp-assets', idempotentRequired, (req, res) => ok(res, camps.addAsset(req.actor, v.parseAssetCreate(req.body)), 201));
  r.patch('/camp-assets/:id', idempotent, (req, res) => ok(res, camps.updateAsset(req.actor, pid(req), v.parseAssetUpdate(req.body))));
  r.get('/camp-occupancy', (req, res) => ok(res, svc.occupancy(req.actor, v.parseCampQ(q(req)))));
  r.get('/camp-occupancy/export', (req, res) => file(res, svc.exportOccupancy(req.actor)));
  r.get('/allocations/board', (req, res) => ok(res, allocations.board(req.actor, { campId: v.parseCampQ(q(req)).campId })));
  r.get('/allocations', (req, res) => res.json(allocations.list(req.actor, q(req))));
  r.post('/allocations', idempotentRequired, (req, res) => ok(res, allocations.allocate(req.actor, v.parseAllocate(req.body)), 201));
  r.post('/allocations/:id/check-in', idempotent, (req, res) => ok(res, allocations.checkIn(req.actor, pid(req))));
  r.post('/allocations/:id/check-out', idempotent, (req, res) => ok(res, allocations.checkOut(req.actor, pid(req))));
  r.post('/allocations/:id/cancel', idempotent, (req, res) => ok(res, allocations.cancel(req.actor, pid(req), v.parseReason(req.body))));
  r.get('/camp-meals', (req, res) => ok(res, meals.list(req.actor, { period: v.parseMessQ(q(req)).period, campId: v.parseMessQ(q(req)).campId })));
  r.post('/camp-meals', idempotentRequired, (req, res) => ok(res, meals.record(req.actor, v.parseMeal(req.body)), 201));
  r.get('/camp-mess', (req, res) => ok(res, svc.messReport(req.actor, v.parseMessQ(q(req)))));
  r.get('/camp-inspections', (req, res) => res.json(campInspections.list(req.actor, q(req))));
  r.get('/camp-inspections/compliance', (req, res) => ok(res, campInspections.compliance(req.actor)));
  r.post('/camp-inspections', idempotentRequired, (req, res) => ok(res, campInspections.record(req.actor, v.parseCampInspection(req.body)), 201));
  r.get('/camp-recoveries', (req, res) => res.json(recoveries.list(req.actor, q(req))));
  r.post('/camp-recoveries', idempotentRequired, (req, res) => ok(res, recoveries.create(req.actor, v.parseRecoveryCreate(req.body)), 201));
  r.get('/camp-recoveries/:id', (req, res) => ok(res, recoveries.get(req.actor, pid(req))));
  r.delete('/camp-recoveries/:id', (req, res) => ok(res, recoveries.remove(req.actor, pid(req))));
  r.post('/camp-recoveries/:id/submit', idempotentRequired, (req, res) => ok(res, recoveries.submit(req.actor, pid(req)), 202));
  r.post('/camp-recoveries/:id/withdraw', idempotent, (req, res) => ok(res, recoveries.withdraw(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/camp-recoveries/:id/cancel', idempotent, (req, res) => ok(res, recoveries.cancel(req.actor, pid(req), v.parseReason(req.body))));
  r.get('/camp-recoveries/:id/history', (req, res) => ok(res, recoveries.history(req.actor, pid(req))));
  r.get('/camp-recoveries/:id/print', (req, res) => file(res, recoveries.print(req.actor, pid(req))));
}
