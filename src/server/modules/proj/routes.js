import { Router } from 'express';
import { parseAmend, parseId, parseMilestone, parseMilestoneUpdate, parsePrefill, parseReason, parseSubmit, parseTransition, parseUpdate, parseWizard } from './validators.js';

/** Part 10.01: the project master. Rights and scope are checked in the service. */
export function projectRoutes({ svc, exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pid = (req) => parseId(req.params.id);
  const p = svc.projects; const t = svc.transitions; const m = svc.milestones;
  r.get('/projects', (req, res) => res.json(p.list(req.actor, req.query)));
  r.get('/projects/export', (req, res) => {
    const x = exportsOf(); if (!x) throw new Error('The list export service is not running');
    const out = x.start(req.actor, 'proj.projects', req.query);
    if (out.kind === 'job') return res.status(202).json({ data: out });
    res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' });
    return res.send(out.buffer);
  });
  r.get('/project-options', (req, res) => ok(res, p.options(req.actor)));
  r.get('/project-prefill', (req, res) => ok(res, p.prefill(req.actor, parsePrefill(req.query).tenderId)));
  r.post('/projects', idempotentRequired, (req, res) => ok(res, p.create(req.actor, parseWizard(req.body)), 201));
  r.get('/projects/:id', (req, res) => ok(res, p.get(req.actor, pid(req))));
  r.patch('/projects/:id', idempotent, (req, res) => ok(res, p.update(req.actor, pid(req), parseUpdate(req.body))));
  r.delete('/projects/:id', (req, res) => ok(res, p.remove(req.actor, pid(req))));
  r.post('/projects/:id/submit', idempotentRequired, (req, res) => ok(res, p.submit(req.actor, pid(req), parseSubmit(req.body)), 202));
  r.post('/projects/:id/withdraw', idempotent, (req, res) => ok(res, p.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/projects/:id/cancel', idempotent, (req, res) => ok(res, p.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/projects/:id/amend', idempotentRequired, (req, res) => ok(res, p.amend(req.actor, pid(req), parseAmend(req.body)), 202));
  r.post('/projects/:id/transitions', idempotentRequired, (req, res) => ok(res, t.move(req.actor, pid(req), parseTransition(req.body)), 202));
  r.post('/projects/:id/transitions/withdraw', idempotent, (req, res) => ok(res, t.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.get('/projects/:id/history', (req, res) => ok(res, p.history(req.actor, pid(req))));
  r.get('/projects/:id/print', (req, res) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(p.print(req.actor, pid(req))));
  r.get('/projects/:id/milestones', (req, res) => ok(res, m.list(req.actor, pid(req))));
  r.post('/projects/:id/milestones', idempotentRequired, (req, res) => ok(res, m.create(req.actor, pid(req), parseMilestone(req.body)), 201));
  r.patch('/milestones/:id', idempotent, (req, res) => ok(res, m.update(req.actor, pid(req), parseMilestoneUpdate(req.body))));
  r.delete('/milestones/:id', (req, res) => ok(res, m.remove(req.actor, pid(req))));
  return r;
}
