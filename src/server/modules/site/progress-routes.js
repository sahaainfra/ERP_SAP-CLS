import { Router } from 'express';
import { parsePeriodCreate, parsePeriodUpdate, parseId, parseProgressExportQ, parseProgressQ, parseProjectQ, parseReason, parseWeights } from './validators.js';

/** /api/v1/site/periods and /api/v1/site/progress: progress periods, dashboards, reports and weights (part 14.05). Rights and scope are checked in the services. */
export function progressRoutes(svc, { exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router(); const g = svc.progressSvc; const p = g.periods;
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pid = (req) => parseId(req.params.id);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-export-rows': String(out.rows ?? 0) }).send(out.buffer);
  // periods
  r.get('/periods', (req, res) => res.json(p.list(req.actor, req.query)));
  r.get('/periods/export', async (req, res, next) => { try { const out = await exportsOf().start(req.actor, 'site.periods', req.query); if (out.job) return res.status(202).json({ data: out.job }); return res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' }).send(out.buffer); } catch (e) { return next(e); } });
  r.get('/periods/options', (req, res) => ok(res, p.options(req.actor, parseProgressQ(req.query).projectId)));
  r.post('/periods', idempotentRequired, (req, res) => ok(res, p.create(req.actor, parsePeriodCreate(req.body)), 201));
  r.get('/periods/:id', (req, res) => ok(res, p.get(req.actor, pid(req))));
  r.patch('/periods/:id', idempotent, (req, res) => ok(res, p.update(req.actor, pid(req), parsePeriodUpdate(req.body))));
  r.delete('/periods/:id', (req, res) => ok(res, p.remove(req.actor, pid(req))));
  r.post('/periods/:id/submit', idempotentRequired, (req, res) => ok(res, p.submit(req.actor, pid(req)), 202));
  r.post('/periods/:id/withdraw', idempotent, (req, res) => ok(res, p.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/periods/:id/cancel', idempotent, (req, res) => ok(res, p.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/periods/:id/amend', idempotentRequired, (req, res) => ok(res, p.amend(req.actor, pid(req), parseReason(req.body)), 201));
  r.get('/periods/:id/history', (req, res) => ok(res, p.history(req.actor, pid(req))));
  r.get('/periods/:id/print', (req, res) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(p.print(req.actor, pid(req))));
  // progress
  r.get('/progress/projects', (req, res) => ok(res, g.periods.projects(req.actor)));
  r.get('/progress/dashboard', (req, res) => ok(res, g.dashboard(req.actor, parseProgressQ(req.query))));
  r.get('/progress/scurve', (req, res) => { const q = parseProgressQ(req.query); ok(res, g.scurve(req.actor, q)); });
  r.get('/progress/report', (req, res) => ok(res, g.report(req.actor, parseProgressQ(req.query))));
  r.get('/progress/report/export', (req, res) => file(res, g.reportExport(req.actor, parseProgressExportQ(req.query))));
  r.get('/progress/client-report', (req, res) => ok(res, g.clientReport(req.actor, parseProgressQ(req.query))));
  r.get('/progress/client-report/export', (req, res) => file(res, g.clientExport(req.actor, parseProgressExportQ(req.query))));
  r.get('/progress/weights', (req, res) => ok(res, g.weights.get(req.actor, parseProjectQ(req.query).projectId)));
  r.put('/progress/weights', idempotent, (req, res) => ok(res, g.weights.set(req.actor, parseWeights(req.body))));
  return r;
}
