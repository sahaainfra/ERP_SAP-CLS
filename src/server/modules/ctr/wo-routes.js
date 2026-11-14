import { notFound } from '../../platform/http/errors.js';
import * as v from './validators.js';

/** /api/v1/ctr work orders: subcontract work orders, their amendments and the back-to-back margin (part 21.03, flag ff.ctr.p2103). */
export function workOrderRoutes(r, svc, { ok, pid, file, idempotent, idempotentRequired, flags }) {
  const { workOrders: wo, woAmendments: am } = svc; const q = (req) => req.query;
  r.use(['/work-orders', '/wo-amendments', '/wo-margin'], (req, _res, next) => (flags.isOn(req.actor, 'ff.ctr.p2103') ? next() : next(notFound('Work order management is not enabled for your company yet.'))));
  r.get('/work-orders/options', (req, res) => ok(res, wo.options(req.actor)));
  r.get('/work-orders/export', (req, res) => file(res, wo.exportCsv(req.actor)));
  r.post('/work-orders/import', idempotentRequired, (req, res) => ok(res, wo.importRows(req.actor, { rows: Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 500) : [] }), 201));
  r.get('/work-orders', (req, res) => res.json(wo.list(req.actor, q(req))));
  r.post('/work-orders', idempotentRequired, (req, res) => ok(res, wo.create(req.actor, v.parseWoCreate(req.body)), 201));
  r.get('/work-orders/:id', (req, res) => ok(res, wo.get(req.actor, pid(req))));
  r.patch('/work-orders/:id', idempotent, (req, res) => ok(res, wo.update(req.actor, pid(req), v.parseWoUpdate(req.body))));
  r.delete('/work-orders/:id', (req, res) => ok(res, wo.remove(req.actor, pid(req))));
  r.post('/work-orders/:id/submit', idempotentRequired, (req, res) => ok(res, wo.submit(req.actor, pid(req)), 202));
  r.post('/work-orders/:id/withdraw', idempotent, (req, res) => ok(res, wo.withdraw(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/work-orders/:id/cancel', idempotent, (req, res) => ok(res, wo.cancel(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/work-orders/:id/amend', idempotentRequired, (req, res) => ok(res, am.create(req.actor, pid(req), v.parseWoAmend(req.body)), 201));
  r.post('/work-orders/:id/accept', idempotentRequired, (req, res) => ok(res, wo.accept(req.actor, pid(req), v.parseWoAccept(req.body))));
  r.post('/work-orders/:id/close', idempotentRequired, (req, res) => ok(res, wo.close(req.actor, pid(req), v.parseWoClose(req.body))));
  r.get('/work-orders/:id/history', (req, res) => ok(res, wo.history(req.actor, pid(req))));
  r.get('/work-orders/:id/print', (req, res) => file(res, wo.print(req.actor, pid(req))));
  r.get('/wo-amendments/:id', (req, res) => ok(res, am.get(req.actor, pid(req))));
  r.post('/wo-amendments/:id/submit', idempotentRequired, (req, res) => ok(res, am.submit(req.actor, pid(req)), 202));
  r.post('/wo-amendments/:id/withdraw', idempotent, (req, res) => ok(res, am.withdraw(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/wo-amendments/:id/cancel', idempotent, (req, res) => ok(res, am.cancel(req.actor, pid(req), v.parseReason(req.body))));
  r.get('/wo-amendments/:id/history', (req, res) => ok(res, am.history(req.actor, pid(req))));
  r.get('/wo-margin', (req, res) => ok(res, wo.marginReport(req.actor, v.parseMarginQ(q(req)))));
}
