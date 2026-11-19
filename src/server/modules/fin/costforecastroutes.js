import { Router } from 'express';
import { notFound } from '../../platform/http/errors.js';
import { parseForecastCreate, parseForecastImport, parseForecastLine, parseForecastUpdate, parseId, parseJournalReason, parsePeriod, parseProjectQuery } from './validators.js';

/** Part 23.11: cost forecasts under /api/v1/fin/cost-forecasts (the part's /fin/forecasts, named apart from the cash forecast of 23.13), behind ff.fin.p2311. Rights are checked in the service. */
export function costForecastRoutes(cf, { idempotent, idempotentRequired, flags }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const file = (res, f) => res.status(200).set({ 'content-type': f.contentType, 'content-disposition': `attachment; filename="${f.fileName}"`, 'cache-control': 'no-store' }).send(f.buffer);
  const pid = (req) => parseId(req.params.id);
  r.use(['/cost-forecasts', '/forecast-reports'], (req, _res, next) => (flags.isOn(req.actor, 'ff.fin.p2311') ? next() : next(notFound('Cost forecasting is not enabled for your company yet (feature flag ff.fin.p2311 is OFF).'))));
  const { forecasts: f, reports: rp } = cf;
  r.get('/cost-forecasts/candidates', (req, res) => ok(res, rp.candidates(req.actor, parsePeriod(req.query))));
  r.get('/cost-forecasts/export', (req, res) => file(res, f.exportCsv(req.actor, req.query)));
  r.get('/cost-forecasts', (req, res) => res.json(f.list(req.actor, req.query)));
  r.post('/cost-forecasts', idempotentRequired, (req, res) => ok(res, f.create(req.actor, parseForecastCreate(req.body)), 201));
  r.get('/cost-forecasts/:id', (req, res) => ok(res, f.get(req.actor, pid(req))));
  r.patch('/cost-forecasts/:id', idempotent, (req, res) => ok(res, f.update(req.actor, pid(req), parseForecastUpdate(req.body))));
  r.delete('/cost-forecasts/:id', (req, res) => ok(res, f.remove(req.actor, pid(req))));
  r.patch('/cost-forecasts/:id/lines/:lineId', idempotent, (req, res) => ok(res, f.updateLine(req.actor, pid(req), parseId(req.params.lineId), parseForecastLine(req.body))));
  r.post('/cost-forecasts/:id/import', idempotentRequired, (req, res) => ok(res, f.importLines(req.actor, pid(req), parseForecastImport(req.body))));
  r.post('/cost-forecasts/:id/refresh', idempotent, (req, res) => ok(res, f.refresh(req.actor, pid(req))));
  r.post('/cost-forecasts/:id/submit', idempotentRequired, (req, res) => ok(res, f.submit(req.actor, pid(req)), 202));
  r.post('/cost-forecasts/:id/withdraw', idempotent, (req, res) => ok(res, f.withdraw(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/cost-forecasts/:id/cancel', idempotent, (req, res) => ok(res, f.cancel(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/cost-forecasts/:id/amend', idempotentRequired, (req, res) => ok(res, f.amend(req.actor, pid(req), parseJournalReason(req.body)), 201));
  r.get('/cost-forecasts/:id/history', (req, res) => ok(res, f.history(req.actor, pid(req))));
  r.get('/cost-forecasts/:id/print', (req, res) => file(res, f.print(req.actor, pid(req))));
  r.get('/forecast-reports/trend', (req, res) => ok(res, rp.trend(req.actor, parseProjectQuery(req.query))));
  r.get('/forecast-reports/variance', (req, res) => ok(res, rp.variance(req.actor, parsePeriod(req.query))));
  return r;
}
