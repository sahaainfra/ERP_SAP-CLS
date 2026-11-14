import { notFound } from '../../platform/http/errors.js';
import * as v from './validators.js';

/** /api/v1/rmc plant costing (part 20.03, flag ff.rmc.p2003). */
export function costingRoutes(r, svc, { ok, pid, file, idempotent, idempotentRequired, flags }) {
  const { rates, periods, budgets } = svc; const q = (req) => req.query;
  r.use(['/transfer-rates', '/cost-periods', '/costing', '/cost-report', '/budgets'], (req, _res, next) => (flags.isOn(req.actor, 'ff.rmc.p2003') ? next() : next(notFound('Plant costing is not enabled for your company yet.'))));
  r.get('/transfer-rates/options', (req, res) => ok(res, rates.options(req.actor)));
  r.get('/transfer-rates/export', (req, res) => file(res, rates.exportCsv(req.actor)));
  r.get('/transfer-rates', (req, res) => res.json(rates.list(req.actor, q(req))));
  r.post('/transfer-rates', idempotentRequired, (req, res) => ok(res, rates.create(req.actor, v.parseRateCreate(req.body)), 201));
  r.get('/transfer-rates/:id', (req, res) => ok(res, rates.get(req.actor, pid(req))));
  r.patch('/transfer-rates/:id', idempotent, (req, res) => ok(res, rates.update(req.actor, pid(req), v.parseRateUpdate(req.body))));
  r.delete('/transfer-rates/:id', (req, res) => ok(res, rates.remove(req.actor, pid(req))));
  r.post('/transfer-rates/:id/submit', idempotentRequired, (req, res) => ok(res, rates.submit(req.actor, pid(req)), 202));
  r.post('/transfer-rates/:id/withdraw', idempotent, (req, res) => ok(res, rates.withdraw(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/transfer-rates/:id/cancel', idempotent, (req, res) => ok(res, rates.cancel(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/transfer-rates/:id/amend', idempotent, (req, res) => ok(res, rates.amend(req.actor, pid(req), v.parseReason(req.body))));
  r.get('/transfer-rates/:id/history', (req, res) => ok(res, rates.history(req.actor, pid(req))));
  r.get('/transfer-rates/:id/print', (req, res) => file(res, rates.print(req.actor, pid(req))));
  r.get('/cost-periods/options', (req, res) => ok(res, periods.options(req.actor)));
  r.get('/cost-periods', (req, res) => res.json(periods.list(req.actor, q(req))));
  r.post('/cost-periods', idempotentRequired, (req, res) => ok(res, periods.create(req.actor, v.parsePeriodCreate(req.body)), 201));
  r.get('/cost-periods/:id', (req, res) => ok(res, periods.get(req.actor, pid(req))));
  r.post('/cost-periods/:id/collect', idempotent, (req, res) => ok(res, periods.collect(req.actor, pid(req))));
  r.post('/cost-periods/:id/lines', idempotentRequired, (req, res) => ok(res, periods.addLine(req.actor, pid(req), v.parseCostLine(req.body)), 201));
  r.delete('/cost-periods/:id/lines/:lineId', (req, res) => ok(res, periods.removeLine(req.actor, pid(req), v.parseCostLineId(req.params.lineId))));
  r.post('/cost-periods/:id/close', idempotentRequired, (req, res) => ok(res, periods.close(req.actor, pid(req))));
  r.post('/cost-periods/:id/reopen', idempotent, (req, res) => ok(res, periods.reopen(req.actor, pid(req), v.parseReason(req.body))));
  r.get('/cost-periods/:id/print', (req, res) => file(res, periods.print(req.actor, pid(req))));
  r.get('/costing', (req, res) => ok(res, svc.dashboard(req.actor, v.parseCostQ(q(req)))));
  r.get('/cost-report', (req, res) => ok(res, svc.report(req.actor, v.parseCostQ(q(req)))));
  r.get('/cost-report/export', (req, res) => file(res, svc.exportCostCsv(req.actor, v.parseCostQ(q(req)))));
  r.get('/budgets', (req, res) => ok(res, budgets.get(req.actor, v.parseCostQ(q(req)))));
  r.put('/budgets', idempotent, (req, res) => ok(res, budgets.set(req.actor, v.parseBudget(req.body))));
}
