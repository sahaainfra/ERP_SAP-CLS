import { Router } from 'express';
import { parseAmendRevise, parseApply, parseBbsCreate, parseBbsLines, parseBbsUpdate, parseDelta, parseId, parseReason, parseRevise, parseSummary, parseTakeoffCreate, parseTakeoffLines, parseTakeoffUpdate } from './mto-validators.js';

/** Part 09.02: take-off sheets, engineering MTOs and bar bending schedules. Rights and scope are checked in the service. */
export function mtoRoutes({ mto, exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const html = (res, body) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(body);
  const pid = (req) => parseId(req.params.id);
  const exportOf = (code) => (req, res) => {
    const svc = exportsOf(); if (!svc) throw new Error('The list export service is not running');
    const out = svc.start(req.actor, code, req.query);
    if (out.kind === 'job') return res.status(202).json({ data: out });
    res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' });
    return res.send(out.buffer);
  };
  const t = mto.takeoffs;
  r.get('/takeoffs', (req, res) => res.json(t.list(req.actor, req.query)));
  r.get('/takeoffs/export', exportOf('est.takeoffs'));
  r.get('/takeoff-templates', (req, res) => ok(res, t.templates()));
  r.post('/takeoffs', idempotentRequired, (req, res) => ok(res, t.create(req.actor, parseTakeoffCreate(req.body)), 201));
  r.get('/takeoffs/:id', (req, res) => ok(res, t.get(req.actor, pid(req))));
  r.patch('/takeoffs/:id', idempotent, (req, res) => ok(res, t.update(req.actor, pid(req), parseTakeoffUpdate(req.body))));
  r.delete('/takeoffs/:id', (req, res) => ok(res, t.remove(req.actor, pid(req))));
  r.put('/takeoffs/:id/lines', idempotent, (req, res) => ok(res, t.putLines(req.actor, pid(req), parseTakeoffLines(req.body))));
  r.post('/takeoffs/:id/submit', idempotentRequired, (req, res) => ok(res, t.submit(req.actor, pid(req)), 202));
  r.post('/takeoffs/:id/withdraw', idempotent, (req, res) => ok(res, t.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/takeoffs/:id/cancel', idempotent, (req, res) => ok(res, t.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/takeoffs/:id/revisions', idempotentRequired, (req, res) => ok(res, t.revise(req.actor, pid(req), parseRevise(req.body)), 201));
  r.post('/takeoffs/:id/amend', idempotentRequired, (req, res) => ok(res, t.revise(req.actor, pid(req), parseAmendRevise(req.body)), 201));
  r.get('/takeoffs/:id/history', (req, res) => ok(res, t.history(req.actor, pid(req))));
  r.get('/takeoffs/:id/delta', (req, res) => ok(res, t.delta(req.actor, pid(req), parseDelta(req.query).with ?? null)));
  r.get('/takeoffs/:id/explosion', (req, res) => ok(res, t.explosion(req.actor, pid(req))));
  r.post('/takeoffs/:id/apply', idempotent, (req, res) => ok(res, t.applyToEstimate(req.actor, pid(req), parseApply(req.body))));
  r.get('/takeoffs/:id/print', (req, res) => html(res, t.print(req.actor, pid(req))));
  const b = mto.bbs;
  r.get('/bbs', (req, res) => res.json(b.list(req.actor, req.query)));
  r.get('/bbs/export', exportOf('est.bbs'));
  r.get('/bbs-shapes', (req, res) => ok(res, b.shapes(req.actor)));
  r.get('/bbs-summary', (req, res) => ok(res, b.summary(req.actor, parseSummary(req.query))));
  r.post('/bbs', idempotentRequired, (req, res) => ok(res, b.create(req.actor, parseBbsCreate(req.body)), 201));
  r.get('/bbs/:id', (req, res) => ok(res, b.get(req.actor, pid(req))));
  r.patch('/bbs/:id', idempotent, (req, res) => ok(res, b.update(req.actor, pid(req), parseBbsUpdate(req.body))));
  r.delete('/bbs/:id', (req, res) => ok(res, b.remove(req.actor, pid(req))));
  r.put('/bbs/:id/lines', idempotent, (req, res) => ok(res, b.putLines(req.actor, pid(req), parseBbsLines(req.body))));
  r.post('/bbs/:id/submit', idempotentRequired, (req, res) => ok(res, b.submit(req.actor, pid(req)), 202));
  r.post('/bbs/:id/withdraw', idempotent, (req, res) => ok(res, b.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/bbs/:id/cancel', idempotent, (req, res) => ok(res, b.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/bbs/:id/revisions', idempotentRequired, (req, res) => ok(res, b.revise(req.actor, pid(req), parseRevise(req.body)), 201));
  r.post('/bbs/:id/amend', idempotentRequired, (req, res) => ok(res, b.revise(req.actor, pid(req), parseAmendRevise(req.body)), 201));
  r.get('/bbs/:id/history', (req, res) => ok(res, b.history(req.actor, pid(req))));
  r.get('/bbs/:id/delta', (req, res) => ok(res, b.delta(req.actor, pid(req), parseDelta(req.query).with ?? null)));
  r.get('/bbs/:id/explosion', (req, res) => ok(res, b.explosion(req.actor, pid(req))));
  r.get('/bbs/:id/print', (req, res) => html(res, b.print(req.actor, pid(req))));
  return r;
}
