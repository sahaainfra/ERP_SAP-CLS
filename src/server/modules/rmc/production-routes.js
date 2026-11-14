import { notFound } from '../../platform/http/errors.js';
import * as v from './validators.js';

/** /api/v1/rmc production, dispatch and delivery tickets (part 20.02, flag ff.rmc.p2002). */
export function productionRoutes(r, svc, { ok, pid, file, idempotent, idempotentRequired, flags }) {
  const { requisitions, batches, tickets } = svc; const q = (req) => req.query;
  r.use(['/requisitions', '/batches', '/delivery-tickets', '/consumption', '/production'], (req, _res, next) => (flags.isOn(req.actor, 'ff.rmc.p2002') ? next() : next(notFound('Production and dispatch are not enabled for your company yet.'))));
  const approved = (path, s) => {
    r.post(`${path}/:id/submit`, idempotentRequired, (req, res) => ok(res, s.submit(req.actor, pid(req)), 202));
    r.post(`${path}/:id/withdraw`, idempotent, (req, res) => ok(res, s.withdraw(req.actor, pid(req), v.parseReason(req.body))));
    r.post(`${path}/:id/cancel`, idempotent, (req, res) => ok(res, s.cancel(req.actor, pid(req), v.parseReason(req.body))));
    r.post(`${path}/:id/amend`, idempotent, (req, res) => ok(res, s.amend(req.actor, pid(req), v.parseReason(req.body))));
    r.get(`${path}/:id/history`, (req, res) => ok(res, s.history(req.actor, pid(req))));
    r.get(`${path}/:id/print`, (req, res) => file(res, s.print(req.actor, pid(req))));
  };
  r.get('/requisitions/options', (req, res) => ok(res, requisitions.options(req.actor, q(req).projectId ? { projectId: Number(q(req).projectId) } : {})));
  r.get('/requisitions/export', (req, res) => file(res, requisitions.exportCsv(req.actor)));
  r.post('/requisitions/import', idempotentRequired, (req, res) => ok(res, requisitions.importRows(req.actor, { rows: Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 500) : [] }), 201));
  r.get('/requisitions', (req, res) => res.json(requisitions.list(req.actor, q(req))));
  r.post('/requisitions', idempotentRequired, (req, res) => ok(res, requisitions.create(req.actor, v.parseReqCreate(req.body)), 201));
  r.get('/requisitions/:id', (req, res) => ok(res, requisitions.get(req.actor, pid(req))));
  r.patch('/requisitions/:id', idempotent, (req, res) => ok(res, requisitions.update(req.actor, pid(req), v.parseReqUpdate(req.body))));
  r.delete('/requisitions/:id', (req, res) => ok(res, requisitions.remove(req.actor, pid(req))));
  approved('/requisitions', requisitions);
  r.post('/requisitions/:id/schedule', idempotent, (req, res) => ok(res, requisitions.schedule(req.actor, pid(req), v.parseSchedule(req.body))));
  r.post('/requisitions/:id/close', idempotent, (req, res) => ok(res, requisitions.close(req.actor, pid(req), v.parseReason(req.body))));
  r.get('/production/board', (req, res) => ok(res, requisitions.board(req.actor, v.parseBoardQ(q(req)))));
  r.get('/batches/options', (req, res) => ok(res, batches.options(req.actor)));
  r.get('/batches', (req, res) => res.json(batches.list(req.actor, q(req))));
  r.post('/batches', idempotentRequired, (req, res) => ok(res, batches.record(req.actor, v.parseBatch(req.body)), 201));
  r.post('/batches/import', idempotentRequired, (req, res) => ok(res, batches.importRows(req.actor, v.parseBatchImport(req.body)), 201));
  r.get('/batches/:id', (req, res) => ok(res, batches.get(req.actor, pid(req))));
  r.post('/batches/:id/cancel', idempotent, (req, res) => ok(res, batches.cancel(req.actor, pid(req), v.parseReason(req.body))));
  r.get('/delivery-tickets/options', (req, res) => ok(res, tickets.options(req.actor)));
  r.get('/delivery-tickets/export', (req, res) => file(res, tickets.exportCsv(req.actor)));
  r.get('/delivery-tickets/by-code', (req, res) => ok(res, tickets.byCode(req.actor, v.parseCodeQ(q(req)).code)));
  r.post('/delivery-tickets/import', idempotentRequired, (req, res) => ok(res, tickets.importRows(req.actor, { rows: Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 500) : [] }), 201));
  r.get('/delivery-tickets', (req, res) => res.json(tickets.list(req.actor, q(req))));
  r.post('/delivery-tickets', idempotentRequired, (req, res) => ok(res, tickets.create(req.actor, v.parseTicketCreate(req.body)), 201));
  r.get('/delivery-tickets/:id', (req, res) => ok(res, tickets.get(req.actor, pid(req))));
  r.patch('/delivery-tickets/:id', idempotent, (req, res) => ok(res, tickets.update(req.actor, pid(req), v.parseTicketUpdate(req.body))));
  r.delete('/delivery-tickets/:id', (req, res) => ok(res, tickets.remove(req.actor, pid(req))));
  approved('/delivery-tickets', tickets);
  r.post('/delivery-tickets/:id/arrive', idempotent, (req, res) => ok(res, tickets.arrive(req.actor, pid(req), v.parseArrive(req.body))));
  r.post('/delivery-tickets/:id/receive', idempotentRequired, (req, res) => ok(res, tickets.receive(req.actor, pid(req), v.parseReceive(req.body))));
  r.post('/delivery-tickets/:id/reject', idempotent, (req, res) => ok(res, tickets.reject(req.actor, pid(req), v.parseReason(req.body))));
  r.get('/consumption', (req, res) => ok(res, svc.consumption(req.actor, v.parseConsumptionQ(q(req)))));
  r.get('/consumption/export', (req, res) => file(res, svc.exportConsumption(req.actor, v.parseConsumptionQ(q(req)))));
}
