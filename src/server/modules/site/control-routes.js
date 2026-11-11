import { Router } from 'express';
import { parseAllocSubmit, parseCtlDrillQ, parseCtlExportQ, parseCtlProject, parseCtlQ, parseId, parseProjectQ, parseReason } from './validators.js';

/** /api/v1/site/control: the project control engine (part 14.07). The part's text names /ctl/facts and /ctl/drill; they are served here, under the module. Rights and scope are checked in the services.
 *  There is no route that writes a fact: the facts are derived from their owners (BR-01). */
export function controlRoutes(svc, _ctx, { idempotent, idempotentRequired }) {
  const r = Router(); const g = svc.controlSvc; const u = g.unallocated;
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pid = (req) => parseId(req.params.id);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-export-rows': String(out.rows ?? 0) }).send(out.buffer);
  r.get('/projects', (req, res) => ok(res, g.projects(req.actor)));
  r.get('/facts', (req, res) => ok(res, g.facts(req.actor, parseCtlQ(req.query))));
  r.get('/dashboard', (req, res) => ok(res, g.dashboard(req.actor, parseCtlQ(req.query))));
  r.get('/variance', (req, res) => ok(res, g.variance(req.actor, parseCtlQ(req.query))));
  r.get('/variance/export', (req, res) => file(res, g.varianceExport(req.actor, parseCtlExportQ(req.query))));
  r.get('/drill', (req, res) => ok(res, g.drill(req.actor, parseCtlDrillQ(req.query))));
  r.get('/reconciliation', (req, res) => ok(res, g.reconRuns(req.actor, parseProjectQ(req.query).projectId)));
  r.post('/reconciliation/run', idempotentRequired, (req, res) => ok(res, g.runReconcile(req.actor, parseCtlProject(req.body)), 201));
  r.post('/refresh', idempotentRequired, (req, res) => ok(res, g.rebuildNow(req.actor, parseCtlProject(req.body))));
  r.get('/unallocated', (req, res) => res.json(u.list(req.actor, req.query)));
  r.get('/unallocated/options', (req, res) => ok(res, u.options(req.actor, parseProjectQ(req.query).projectId)));
  r.get('/unallocated/:id', (req, res) => ok(res, u.get(req.actor, pid(req))));
  r.post('/unallocated/:id/submit', idempotentRequired, (req, res) => ok(res, u.submit(req.actor, pid(req), parseAllocSubmit(req.body)), 202));
  r.post('/unallocated/:id/withdraw', idempotent, (req, res) => ok(res, u.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.get('/unallocated/:id/history', (req, res) => ok(res, u.history(req.actor, pid(req))));
  return r;
}
