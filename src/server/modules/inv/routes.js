import { Router } from 'express';
import { parseAdjCreate, parseAdjUpdate, parseBin, parseBinUpdate, parseCardQ, parseDashQ, parseId, parseInspection, parseItemsQ, parseMovement, parseOpening, parseReason, parseResQ, parseReservation, parseStoreChange, parseStoreCreate, parseStoreUpdate, parseTransfer, parseValuationQ } from './validators.js';

/** /api/v1/inv: stores, bins, the stock ledger, balances, valuation, reservations and adjustments (part 16.01). Rights and scope are checked in the services. */
export function invRoutes(svc, { idempotent, idempotentRequired }) {
  const r = Router(); const s = svc.invSvc; const ok = (res, data, status = 200) => res.status(status).json({ data }); const pid = (req) => parseId(req.params.id);
  r.get('/projects', (req, res) => ok(res, s.projects(req.actor)));
  r.get('/items', (req, res) => ok(res, s.items(req.actor, parseItemsQ(req.query).q ?? '')));
  r.get('/dashboard', (req, res) => ok(res, s.dashboard(req.actor, parseDashQ(req.query))));
  r.get('/integrity', (req, res) => ok(res, s.integrity(req.actor)));
  r.get('/stores/options', (req, res) => ok(res, s.stores.options(req.actor)));
  r.get('/stores', (req, res) => res.json(s.stores.list(req.actor, req.query)));
  r.post('/stores', idempotentRequired, (req, res) => ok(res, s.stores.create(req.actor, parseStoreCreate(req.body)), 201));
  r.get('/stores/:id', (req, res) => ok(res, s.stores.get(req.actor, pid(req))));
  r.patch('/stores/:id', idempotent, (req, res) => ok(res, s.stores.update(req.actor, pid(req), parseStoreUpdate(req.body))));
  r.post('/stores/:id/submit', idempotentRequired, (req, res) => ok(res, s.stores.submit(req.actor, pid(req)), 202));
  r.post('/stores/:id/withdraw', idempotent, (req, res) => ok(res, s.stores.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/stores/:id/cancel', idempotent, (req, res) => ok(res, s.stores.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/stores/:id/change', idempotentRequired, (req, res) => ok(res, s.stores.requestChange(req.actor, pid(req), parseStoreChange(req.body)), 202));
  r.post('/stores/:id/deactivate', idempotent, (req, res) => ok(res, s.stores.deactivate(req.actor, pid(req), parseReason(req.body))));
  r.post('/stores/:id/reactivate', idempotent, (req, res) => ok(res, s.stores.reactivate(req.actor, pid(req), parseReason(req.body))));
  r.get('/stores/:id/history', (req, res) => ok(res, s.stores.history(req.actor, pid(req))));
  r.post('/stores/:id/bins', idempotentRequired, (req, res) => ok(res, s.bins.add(req.actor, pid(req), parseBin(req.body)), 201));
  r.patch('/bins/:id', idempotent, (req, res) => ok(res, s.bins.update(req.actor, pid(req), parseBinUpdate(req.body))));
  r.delete('/bins/:id', (req, res) => ok(res, s.bins.remove(req.actor, pid(req))));
  r.get('/balances', (req, res) => res.json(s.balances.list(req.actor, req.query)));
  r.get('/ledger', (req, res) => ok(res, s.itemCard(req.actor, parseCardQ(req.query))));
  r.get('/valuation', (req, res) => ok(res, s.valuation(req.actor, parseValuationQ(req.query))));
  r.post('/movements', idempotentRequired, (req, res) => ok(res, s.movements.post(req.actor, parseMovement(req.body)), 201));
  r.post('/transfers', idempotentRequired, (req, res) => ok(res, s.movements.transfer(req.actor, parseTransfer(req.body)), 201));
  r.post('/inspection', idempotent, (req, res) => ok(res, s.movements.inspection(req.actor, parseInspection(req.body))));
  r.post('/ledger/:id/reverse', idempotentRequired, (req, res) => ok(res, s.movements.reverse(req.actor, pid(req), parseReason(req.body)), 201));
  r.post('/opening-stock', idempotentRequired, (req, res) => ok(res, s.movements.openingImport(req.actor, parseOpening(req.body)), 201));
  r.get('/reservations', (req, res) => ok(res, s.reservations.list(req.actor, parseResQ(req.query))));
  r.post('/reservations', idempotentRequired, (req, res) => ok(res, s.reservations.create(req.actor, parseReservation(req.body)), 201));
  r.post('/reservations/:id/release', idempotent, (req, res) => ok(res, s.reservations.release(req.actor, pid(req), parseReason(req.body))));
  r.get('/adjustments', (req, res) => res.json(s.adjustments.list(req.actor, req.query)));
  r.post('/adjustments', idempotentRequired, (req, res) => ok(res, s.adjustments.create(req.actor, parseAdjCreate(req.body)), 201));
  r.get('/adjustments/:id', (req, res) => ok(res, s.adjustments.get(req.actor, pid(req))));
  r.patch('/adjustments/:id', idempotent, (req, res) => ok(res, s.adjustments.update(req.actor, pid(req), parseAdjUpdate(req.body))));
  r.post('/adjustments/:id/submit', idempotentRequired, (req, res) => ok(res, s.adjustments.submit(req.actor, pid(req)), 202));
  r.post('/adjustments/:id/withdraw', idempotent, (req, res) => ok(res, s.adjustments.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/adjustments/:id/cancel', idempotent, (req, res) => ok(res, s.adjustments.cancel(req.actor, pid(req), parseReason(req.body))));
  r.get('/adjustments/:id/history', (req, res) => ok(res, s.adjustments.history(req.actor, pid(req))));
  return r;
}
