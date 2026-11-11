import { Router } from 'express';
import { parseId, parseLossCreate, parseLossQ, parseNormCreate, parseNormRefresh, parseNormUpdate, parseProdExportQ, parseProdQ, parseProjectQ, parseReason } from './validators.js';

/** /api/v1/site/productivity: productivity tracking and analysis (part 14.06). Rights and scope are checked in the services. */
export function productivityRoutes(svc, _ctx, { idempotent, idempotentRequired }) {
  const r = Router(); const g = svc.productivitySvc; const n = g.norms;
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pid = (req) => parseId(req.params.id);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-export-rows': String(out.rows ?? 0) }).send(out.buffer);
  r.get('/projects', (req, res) => ok(res, g.projects(req.actor)));
  r.get('/options', (req, res) => ok(res, g.options(req.actor, parseProjectQ(req.query).projectId)));
  r.get('/dashboard', (req, res) => ok(res, g.dashboard(req.actor, parseProdQ(req.query))));
  r.get('/report', (req, res) => ok(res, g.report(req.actor, parseProdQ(req.query))));
  r.get('/report/export', (req, res) => file(res, g.reportExport(req.actor, parseProdExportQ(req.query))));
  r.get('/benchmarks', (req, res) => ok(res, g.benchmarks(req.actor, parseProdQ(req.query))));
  r.get('/alerts', (req, res) => ok(res, g.alerts(req.actor, parseProdQ(req.query))));
  r.get('/rows', (req, res) => res.json(g.rows.list(req.actor, req.query)));
  r.get('/losses', (req, res) => ok(res, g.losses.list(req.actor, parseLossQ(req.query))));
  r.post('/losses', idempotentRequired, (req, res) => ok(res, g.losses.create(req.actor, parseLossCreate(req.body)), 201));
  r.delete('/losses/:id', (req, res) => ok(res, g.losses.remove(req.actor, pid(req))));
  r.get('/norms', (req, res) => res.json(n.list(req.actor, req.query)));
  r.post('/norms/refresh-boq', idempotentRequired, (req, res) => ok(res, n.refreshBoq(req.actor, parseNormRefresh(req.body))));
  r.post('/norms', idempotentRequired, (req, res) => ok(res, n.create(req.actor, parseNormCreate(req.body)), 201));
  r.get('/norms/:id', (req, res) => ok(res, n.get(req.actor, pid(req))));
  r.patch('/norms/:id', idempotent, (req, res) => ok(res, n.update(req.actor, pid(req), parseNormUpdate(req.body))));
  r.delete('/norms/:id', (req, res) => ok(res, n.remove(req.actor, pid(req))));
  r.post('/norms/:id/submit', idempotentRequired, (req, res) => ok(res, n.submit(req.actor, pid(req)), 202));
  r.post('/norms/:id/withdraw', idempotent, (req, res) => ok(res, n.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/norms/:id/cancel', idempotent, (req, res) => ok(res, n.cancel(req.actor, pid(req), parseReason(req.body))));
  r.get('/norms/:id/history', (req, res) => ok(res, n.history(req.actor, pid(req))));
  return r;
}
