import { Router } from 'express';
import { parseDiaryCreate, parseDiaryUpdate, parseHindranceClose, parseHindranceCreate, parseHindranceQ, parseHindranceUpdate, parseId, parseReason, parseVisitorCreate, parseVisitorUpdate, parseWeatherCreate, parseWeatherFetch, parseWeatherQ, parseWeatherSiteQ, parseWeatherUpdate } from './validators.js';

/** /api/v1/site/{weather,hindrances,diary,visitors}: site conditions (part 14.03). Rights and scope are checked in the services. */
export function conditionsRoutes(svc, { exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router(); const c = svc.conditions; const w = c.weather; const h = c.hindrances; const d = c.diary; const v = c.visitors;
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pid = (req) => parseId(req.params.id);
  const exp = (code) => async (req, res, next) => { try { const out = await exportsOf().start(req.actor, code, req.query); if (out.job) return res.status(202).json({ data: out.job }); return res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' }).send(out.buffer); } catch (e) { return next(e); } };
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-export-rows': String(out.rows ?? 0) }).send(out.buffer);
  // weather
  r.get('/weather', (req, res) => res.json(w.list(req.actor, req.query)));
  r.get('/weather/export', exp('site.weather'));
  r.get('/weather/sites', (req, res) => ok(res, w.sites(req.actor)));
  r.get('/weather/monthly', (req, res) => ok(res, w.monthly(req.actor, parseWeatherQ(req.query))));
  r.get('/weather/lookup', (req, res) => ok(res, w.lookup(req.actor, parseWeatherSiteQ(req.query))));
  r.post('/weather/fetch', idempotentRequired, async (req, res, next) => { try { ok(res, await w.fetch(req.actor, parseWeatherFetch(req.body)), 201); } catch (e) { next(e); } });
  r.post('/weather', idempotentRequired, (req, res) => ok(res, w.create(req.actor, parseWeatherCreate(req.body)), 201));
  r.get('/weather/:id', (req, res) => ok(res, w.get(req.actor, pid(req))));
  r.patch('/weather/:id', idempotent, (req, res) => ok(res, w.update(req.actor, pid(req), parseWeatherUpdate(req.body))));
  r.delete('/weather/:id', (req, res) => ok(res, w.remove(req.actor, pid(req))));
  // hindrances
  r.get('/hindrances', (req, res) => res.json(h.list(req.actor, req.query)));
  r.get('/hindrances/export', exp('site.hindrances'));
  r.get('/hindrances/sites', (req, res) => ok(res, h.sites(req.actor)));
  r.get('/hindrances/options', (req, res) => ok(res, h.options(req.actor, parseHindranceQ(req.query).siteId)));
  r.post('/hindrances', idempotentRequired, (req, res) => ok(res, h.create(req.actor, parseHindranceCreate(req.body)), 201));
  r.get('/hindrances/:id', (req, res) => ok(res, h.get(req.actor, pid(req))));
  r.patch('/hindrances/:id', idempotent, (req, res) => ok(res, h.update(req.actor, pid(req), parseHindranceUpdate(req.body))));
  r.delete('/hindrances/:id', (req, res) => ok(res, h.remove(req.actor, pid(req))));
  r.post('/hindrances/:id/submit', idempotentRequired, (req, res) => ok(res, h.submit(req.actor, pid(req)), 202));
  r.post('/hindrances/:id/withdraw', idempotent, (req, res) => ok(res, h.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/hindrances/:id/cancel', idempotent, (req, res) => ok(res, h.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/hindrances/:id/amend', idempotentRequired, (req, res) => ok(res, h.amend(req.actor, pid(req), parseReason(req.body)), 201));
  r.post('/hindrances/:id/close', idempotentRequired, (req, res) => ok(res, h.close(req.actor, pid(req), parseHindranceClose(req.body))));
  r.get('/hindrances/:id/history', (req, res) => ok(res, h.history(req.actor, pid(req))));
  r.get('/hindrances/:id/print', (req, res) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(h.print(req.actor, pid(req))));
  r.get('/hindrances/:id/pdf', (req, res) => file(res, h.pdf(req.actor, pid(req))));
  // diary
  r.get('/diary', (req, res) => res.json(d.list(req.actor, req.query)));
  r.get('/diary/export', exp('site.diary'));
  r.get('/diary/sites', (req, res) => ok(res, d.sites(req.actor)));
  r.post('/diary/sign-day', idempotentRequired, (req, res) => ok(res, d.signDay(req.actor, parseWeatherFetch(req.body))));
  r.post('/diary', idempotentRequired, (req, res) => ok(res, d.create(req.actor, parseDiaryCreate(req.body)), 201));
  r.get('/diary/:id', (req, res) => ok(res, d.get(req.actor, pid(req))));
  r.patch('/diary/:id', idempotent, (req, res) => ok(res, d.update(req.actor, pid(req), parseDiaryUpdate(req.body))));
  r.delete('/diary/:id', (req, res) => ok(res, d.remove(req.actor, pid(req))));
  r.post('/diary/:id/sign', idempotent, (req, res) => ok(res, d.sign(req.actor, pid(req))));
  // visitors
  r.get('/visitors', (req, res) => res.json(v.list(req.actor, req.query)));
  r.get('/visitors/export', exp('site.visitors'));
  r.get('/visitors/sites', (req, res) => ok(res, v.sites(req.actor)));
  r.post('/visitors', idempotentRequired, (req, res) => ok(res, v.create(req.actor, parseVisitorCreate(req.body)), 201));
  r.get('/visitors/:id', (req, res) => ok(res, v.get(req.actor, pid(req))));
  r.patch('/visitors/:id', idempotent, (req, res) => ok(res, v.update(req.actor, pid(req), parseVisitorUpdate(req.body))));
  r.delete('/visitors/:id', (req, res) => ok(res, v.remove(req.actor, pid(req))));
  return r;
}
