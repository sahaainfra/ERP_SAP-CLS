import { Router } from 'express';
import { notFound } from '../../platform/http/errors.js';
import { parseCfAdjust, parseCfCreate, parseCfUpdate, parseCfVariance, parseCfView, parseCritical, parseFacility, parseId, parseJournalReason, parsePriority, parseProjectQuery } from './validators.js';

/** Part 23.13: cash forecasts under /api/v1/fin/cash-forecasts (the part's /fin/forecasts, kept apart from the cost forecast of 23.11) and the treasury, behind ff.fin.p2313. Rights are checked in the service. */
export function cashForecastRoutes(cs, { idempotent, idempotentRequired, flags }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const file = (res, f) => res.status(200).set({ 'content-type': f.contentType, 'content-disposition': `attachment; filename="${f.fileName}"`, 'cache-control': 'no-store' }).send(f.buffer);
  const pid = (req) => parseId(req.params.id);
  r.use(['/cash-forecasts', '/treasury'], (req, _res, next) => (flags.isOn(req.actor, 'ff.fin.p2313') ? next() : next(notFound('Cash forecasting is not enabled for your company yet (feature flag ff.fin.p2313 is OFF).'))));
  const { forecasts: f } = cs;
  r.get('/cash-forecasts/variance', (req, res) => ok(res, cs.variance(req.actor, parseCfVariance(req.query))));
  r.get('/cash-forecasts/project-curve', (req, res) => ok(res, cs.projectCurve(req.actor, parseProjectQuery(req.query))));
  r.get('/cash-forecasts', (req, res) => res.json(f.list(req.actor, req.query)));
  r.post('/cash-forecasts', idempotentRequired, (req, res) => ok(res, f.create(req.actor, parseCfCreate(req.body)), 201));
  r.get('/cash-forecasts/:id', (req, res) => ok(res, f.get(req.actor, pid(req), parseCfView(req.query))));
  r.patch('/cash-forecasts/:id', idempotent, (req, res) => ok(res, f.update(req.actor, pid(req), parseCfUpdate(req.body))));
  r.delete('/cash-forecasts/:id', (req, res) => ok(res, f.remove(req.actor, pid(req))));
  r.post('/cash-forecasts/:id/refresh', idempotent, (req, res) => ok(res, f.refresh(req.actor, pid(req))));
  r.post('/cash-forecasts/:id/adjustments', idempotentRequired, (req, res) => ok(res, f.adjust(req.actor, pid(req), parseCfAdjust(req.body)), 201));
  r.delete('/cash-forecasts/:id/adjustments/:lineId', (req, res) => ok(res, f.removeAdjustment(req.actor, pid(req), parseId(req.params.lineId), parseJournalReason(req.body))));
  r.post('/cash-forecasts/:id/submit', idempotentRequired, (req, res) => ok(res, f.submit(req.actor, pid(req)), 202));
  r.post('/cash-forecasts/:id/withdraw', idempotent, (req, res) => ok(res, f.withdraw(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/cash-forecasts/:id/cancel', idempotent, (req, res) => ok(res, f.cancel(req.actor, pid(req), parseJournalReason(req.body))));
  r.get('/cash-forecasts/:id/history', (req, res) => ok(res, f.history(req.actor, pid(req))));
  r.get('/cash-forecasts/:id/print', (req, res) => file(res, f.print(req.actor, pid(req), parseCfView(req.query))));
  r.get('/cash-forecasts/:id/export', (req, res) => file(res, f.exportCsv(req.actor, pid(req))));
  r.get('/treasury', (req, res) => ok(res, cs.treasury(req.actor)));
  r.post('/treasury/facilities', idempotentRequired, (req, res) => ok(res, cs.facilities.save(req.actor, parseFacility(req.body))));
  r.get('/treasury/priorities', (req, res) => ok(res, cs.priority.list(req.actor, parsePriority(req.query))));
  r.post('/treasury/critical-suppliers', idempotentRequired, (req, res) => ok(res, cs.priority.mark(req.actor, parseCritical(req.body)), 201));
  r.delete('/treasury/critical-suppliers/:id', (req, res) => ok(res, cs.priority.unmark(req.actor, pid(req), parseJournalReason(req.body))));
  return r;
}
