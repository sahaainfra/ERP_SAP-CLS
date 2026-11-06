import { Router } from 'express';
import { parseBoq, parseCompare, parseCreate, parseId, parseIndirects, parseItems, parseOptReason, parseReason, parseReprice, parseResources, parseRisks, parseUpdate } from './validators.js';

/** Part 09.01: the estimate workspace. Rights, scope and masking are checked in the service. */
export function estimateRoutes({ est, exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const html = (res, body) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(body);
  const pid = (req) => parseId(req.params.id);
  const s = est.estimates;
  r.get('/estimates', (req, res) => res.json(s.list(req.actor, req.query)));
  r.get('/estimates/export', (req, res) => {
    const svc = exportsOf(); if (!svc) throw new Error('The list export service is not running');
    const out = svc.start(req.actor, 'est.estimates', req.query);
    if (out.kind === 'job') return res.status(202).json({ data: out });
    res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' });
    return res.send(out.buffer);
  });
  r.post('/estimates', idempotentRequired, (req, res) => ok(res, s.create(req.actor, parseCreate(req.body)), 201));
  r.get('/estimates/:id', (req, res) => ok(res, s.get(req.actor, pid(req))));
  r.patch('/estimates/:id', idempotent, (req, res) => ok(res, s.update(req.actor, pid(req), parseUpdate(req.body))));
  r.delete('/estimates/:id', (req, res) => ok(res, s.remove(req.actor, pid(req))));
  r.put('/estimates/:id/items', idempotent, (req, res) => ok(res, s.putItems(req.actor, pid(req), parseItems(req.body))));
  r.post('/estimates/:id/boq', idempotent, (req, res) => ok(res, s.importBoq(req.actor, pid(req), parseBoq(req.body))));
  r.put('/estimates/:id/indirects', idempotent, (req, res) => ok(res, s.putIndirects(req.actor, pid(req), parseIndirects(req.body))));
  r.put('/estimates/:id/risks', idempotent, (req, res) => ok(res, s.putRisks(req.actor, pid(req), parseRisks(req.body))));
  r.post('/estimates/:id/reprice', idempotent, (req, res) => ok(res, s.reprice(req.actor, pid(req), parseReprice(req.body))));
  r.post('/estimates/:id/versions', idempotentRequired, (req, res) => ok(res, s.newVersion(req.actor, pid(req), parseOptReason(req.body)), 201));
  r.post('/estimates/:id/submit', idempotentRequired, (req, res) => ok(res, s.submit(req.actor, pid(req)), 202));
  r.post('/estimates/:id/withdraw', idempotent, (req, res) => ok(res, s.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/estimates/:id/cancel', idempotent, (req, res) => ok(res, s.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/estimates/:id/amend', idempotentRequired, (req, res) => ok(res, s.newVersion(req.actor, pid(req), parseReason(req.body)), 201));
  r.get('/estimates/:id/history', (req, res) => ok(res, s.history(req.actor, pid(req))));
  r.get('/estimates/:id/compare', (req, res) => ok(res, s.compare(req.actor, pid(req), parseCompare(req.query).with)));
  r.get('/estimates/:id/resources', (req, res) => ok(res, s.resources(req.actor, pid(req), parseResources(req.query))));
  r.get('/estimates/:id/print', (req, res) => html(res, s.print(req.actor, pid(req))));
  return r;
}
