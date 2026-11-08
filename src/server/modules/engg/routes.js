import { Router } from 'express';
import { parseAmend, parseCheck, parseCompare, parseDistribute, parseDrawingCreate, parseDrawingUpdate, parseId, parseImport, parseProject, parseReason, parseResponses, parseRevisionUpdate, parseTransmittalCreate, parseTransmittalUpdate } from './validators.js';

/** Part 11.01: the drawing register, its revisions, the controlled copies, the transmittals and the schedule. Rights and scope are checked in the services. */
export function enggRoutes(svc, { exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pid = (req) => parseId(req.params.id);
  const exportOf = (code) => (req, res) => {
    const x = exportsOf(); if (!x) throw new Error('The list export service is not running');
    const out = x.start(req.actor, code, req.query);
    if (out.kind === 'job') return res.status(202).json({ data: out });
    res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' });
    return res.send(out.buffer);
  };
  const html = (res, body) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(body);
  const d = svc.drawings; const v = svc.revisions; const t = svc.transmittals;
  r.get('/dashboard', (req, res) => ok(res, svc.dashboard.get(req.actor, parseProject(req.query))));
  r.get('/schedule', (req, res) => ok(res, svc.schedule.report(req.actor, parseProject(req.query))));
  r.get('/site-drawings', (req, res) => ok(res, svc.distribution.site(req.actor, { ...parseProject(req.query), locationId: req.query.locationId, discipline: req.query.discipline })));
  r.get('/drawings/use-check', (req, res) => ok(res, svc.useCheck(req.actor, parseCheck(req.query))));
  r.get('/drawings/compare', (req, res) => ok(res, v.compare(req.actor, parseCompare(req.query))));
  r.get('/drawings', (req, res) => res.json(d.list(req.actor, req.query)));
  r.get('/drawings/export', exportOf('engg.drawings'));
  r.post('/drawings/import', idempotentRequired, (req, res) => ok(res, d.import(req.actor, parseImport(req.body)), 201));
  r.post('/drawings', idempotentRequired, (req, res) => ok(res, d.create(req.actor, parseDrawingCreate(req.body)), 201));
  r.get('/drawings/:id', (req, res) => ok(res, d.get(req.actor, pid(req))));
  r.patch('/drawings/:id', idempotent, (req, res) => ok(res, d.update(req.actor, pid(req), parseDrawingUpdate(req.body))));
  r.delete('/drawings/:id', (req, res) => ok(res, d.remove(req.actor, pid(req))));
  r.post('/drawings/:id/cancel', idempotent, (req, res) => ok(res, d.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/drawings/:id/amend', idempotentRequired, (req, res) => ok(res, v.amend(req.actor, pid(req), parseAmend(req.body)), 201));
  r.post('/drawings/:id/distribute', idempotent, (req, res) => ok(res, svc.distribution.distribute(req.actor, pid(req), parseDistribute(req.body)), 201));
  r.get('/drawings/:id/history', (req, res) => ok(res, d.history(req.actor, pid(req))));
  r.get('/drawings/:id/print', (req, res) => html(res, d.print(req.actor, pid(req))));
  r.get('/revisions/:id', (req, res) => ok(res, v.get(req.actor, pid(req))));
  r.patch('/revisions/:id', idempotent, (req, res) => ok(res, v.update(req.actor, pid(req), parseRevisionUpdate(req.body))));
  r.delete('/revisions/:id', (req, res) => ok(res, v.remove(req.actor, pid(req))));
  r.post('/revisions/:id/submit', idempotentRequired, (req, res) => ok(res, v.submit(req.actor, pid(req)), 202));
  r.post('/revisions/:id/withdraw', idempotent, (req, res) => ok(res, v.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/revisions/:id/cancel', idempotent, (req, res) => ok(res, v.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/copies/:id/acknowledge', idempotent, (req, res) => ok(res, svc.distribution.acknowledge(req.actor, pid(req))));
  r.get('/transmittals', (req, res) => res.json(t.list(req.actor, req.query)));
  r.get('/transmittals/export', exportOf('engg.transmittals'));
  r.post('/transmittals', idempotentRequired, (req, res) => ok(res, t.create(req.actor, parseTransmittalCreate(req.body)), 201));
  r.get('/transmittals/:id', (req, res) => ok(res, t.get(req.actor, pid(req))));
  r.patch('/transmittals/:id', idempotent, (req, res) => ok(res, t.update(req.actor, pid(req), parseTransmittalUpdate(req.body))));
  r.delete('/transmittals/:id', (req, res) => ok(res, t.remove(req.actor, pid(req))));
  r.post('/transmittals/:id/submit', idempotentRequired, (req, res) => ok(res, t.submit(req.actor, pid(req)), 202));
  r.post('/transmittals/:id/withdraw', idempotent, (req, res) => ok(res, t.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/transmittals/:id/cancel', idempotent, (req, res) => ok(res, t.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/transmittals/:id/amend', idempotentRequired, (req, res) => ok(res, t.amend(req.actor, pid(req), parseReason(req.body)), 201));
  r.post('/transmittals/:id/responses', idempotent, (req, res) => ok(res, t.respond(req.actor, pid(req), parseResponses(req.body))));
  r.get('/transmittals/:id/history', (req, res) => ok(res, t.history(req.actor, pid(req))));
  r.get('/transmittals/:id/print', (req, res) => html(res, t.print(req.actor, pid(req))));
  return r;
}
