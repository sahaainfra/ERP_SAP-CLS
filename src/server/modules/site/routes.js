import { Router } from 'express';
import { parseClose, parseDailyCreate, parseDailyUpdate, parseDateQ, parseFrontCreate, parseFrontUpdate, parseId, parseIssue, parseMove, parseReason, parseSiteQ, parseUse, parseWaCreate, parseWaUpdate } from './validators.js';

/** /api/v1/site: work fronts, daily work plans, work authorisations and the uses that name them (part 14.01). Rights and scope are checked in the service. */
export function siteRoutes(svc, { exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router(); const w = svc.was; const d = svc.daily;
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pid = (req) => parseId(req.params.id);
  r.get('/sites', (req, res) => ok(res, svc.sites(req.actor)));
  r.get('/board', (req, res) => ok(res, svc.board(req.actor, parseSiteQ(req.query))));
  r.get('/wa-mobile', (req, res) => ok(res, svc.mobile(req.actor, parseDateQ(req.query))));
  // work fronts
  r.get('/work-fronts', (req, res) => ok(res, svc.fronts.list(req.actor, parseSiteQ(req.query))));
  r.post('/work-fronts', idempotent, (req, res) => ok(res, svc.fronts.create(req.actor, parseFrontCreate(req.body)), 201));
  r.patch('/work-fronts/:id', idempotent, (req, res) => ok(res, svc.fronts.update(req.actor, pid(req), parseFrontUpdate(req.body))));
  r.delete('/work-fronts/:id', (req, res) => ok(res, svc.fronts.remove(req.actor, pid(req))));
  // work authorisations
  r.get('/work-authorisations', (req, res) => res.json(w.list(req.actor, req.query)));
  r.get('/work-authorisations/export', async (req, res, next) => { try { const out = await exportsOf().start(req.actor, 'site.work_authorisations', req.query); if (out.job) return res.status(202).json({ data: out.job }); return res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' }).send(out.buffer); } catch (e) { return next(e); } });
  r.get('/work-authorisations/options', (req, res) => ok(res, w.options(req.actor, parseSiteQ(req.query))));
  r.get('/work-authorisations/active', (req, res) => ok(res, svc.active(req.actor, parseSiteQ(req.query))));
  r.post('/work-authorisations', idempotentRequired, (req, res) => ok(res, w.create(req.actor, parseWaCreate(req.body)), 201));
  r.get('/work-authorisations/:id', (req, res) => ok(res, w.get(req.actor, pid(req))));
  r.patch('/work-authorisations/:id', idempotent, (req, res) => ok(res, w.update(req.actor, pid(req), parseWaUpdate(req.body))));
  r.delete('/work-authorisations/:id', (req, res) => ok(res, w.remove(req.actor, pid(req))));
  r.post('/work-authorisations/:id/move', idempotent, (req, res) => ok(res, w.move(req.actor, pid(req), parseMove(req.body))));
  r.post('/work-authorisations/:id/submit', idempotentRequired, (req, res) => ok(res, w.submit(req.actor, pid(req)), 202));
  r.post('/work-authorisations/:id/withdraw', idempotent, (req, res) => ok(res, w.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/work-authorisations/:id/cancel', idempotent, (req, res) => ok(res, w.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/work-authorisations/:id/amend', idempotentRequired, (req, res) => ok(res, w.amend(req.actor, pid(req), parseReason(req.body)), 201));
  r.post('/work-authorisations/:id/close', idempotentRequired, (req, res) => ok(res, w.close(req.actor, pid(req), parseClose(req.body))));
  r.get('/work-authorisations/:id/history', (req, res) => ok(res, w.history(req.actor, pid(req))));
  r.get('/work-authorisations/:id/print', (req, res) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(w.print(req.actor, pid(req))));
  // daily work plans
  r.get('/daily-plans', (req, res) => res.json(d.list(req.actor, req.query)));
  r.post('/daily-plans', idempotentRequired, (req, res) => ok(res, d.create(req.actor, parseDailyCreate(req.body)), 201));
  r.get('/daily-plans/:id', (req, res) => ok(res, d.get(req.actor, pid(req))));
  r.patch('/daily-plans/:id', idempotent, (req, res) => ok(res, d.update(req.actor, pid(req), parseDailyUpdate(req.body))));
  r.post('/daily-plans/:id/cancel', idempotent, (req, res) => ok(res, d.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/daily-plans/:id/issue', idempotentRequired, (req, res) => ok(res, d.issue(req.actor, pid(req), parseIssue(req.body))));
  // FR-07: a use of labour, material, plant, progress or measurement against a WA
  r.post('/wa-uses', idempotent, (req, res) => ok(res, svc.recordUse(req.actor, parseUse(req.body)), 201));
  return r;
}
