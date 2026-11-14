import { Router } from 'express';
import { notFound } from '../../platform/http/errors.js';
import * as v from './validators.js';

/** /api/v1/rmc: batching plants and mix designs (part 20.01), later production and dispatch (20.02) and costing (20.03). Each part behind its own flag. */
export function rmcRoutes(svc, { idempotent, idempotentRequired, flags, parts = {} }) {
  const r = Router(); const ok = (res, data, status = 200) => res.status(status).json({ data }); const pid = (req) => v.parseId(req.params.id);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(out.buffer);
  const { plants, mixes } = svc; const q = (req) => req.query;
  r.use((req, _res, next) => (flags.isOn(req.actor, 'ff.rmc.p2001') ? next() : next(notFound('Batching plant management is not enabled for your company yet.'))));
  const doc = (path, s, parseCreate, parseUpdate) => {
    r.get(`${path}/options`, (req, res) => ok(res, s.options(req.actor)));
    r.get(`${path}/export`, (req, res) => file(res, s.exportCsv(req.actor)));
    r.post(`${path}/import`, idempotentRequired, (req, res) => ok(res, s.importRows(req.actor, { rows: Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 500) : [] }), 201));
    r.get(path, (req, res) => res.json(s.list(req.actor, q(req))));
    r.post(path, idempotentRequired, (req, res) => ok(res, s.create(req.actor, parseCreate(req.body)), 201));
    r.get(`${path}/:id`, (req, res) => ok(res, s.get(req.actor, pid(req))));
    r.patch(`${path}/:id`, idempotent, (req, res) => ok(res, s.update(req.actor, pid(req), parseUpdate(req.body))));
    r.delete(`${path}/:id`, (req, res) => ok(res, s.remove(req.actor, pid(req))));
    r.post(`${path}/:id/submit`, idempotentRequired, (req, res) => ok(res, s.submit(req.actor, pid(req)), 202));
    r.post(`${path}/:id/withdraw`, idempotent, (req, res) => ok(res, s.withdraw(req.actor, pid(req), v.parseReason(req.body))));
    r.post(`${path}/:id/cancel`, idempotent, (req, res) => ok(res, s.cancel(req.actor, pid(req), v.parseReason(req.body))));
    r.post(`${path}/:id/amend`, idempotent, (req, res) => ok(res, s.amend(req.actor, pid(req), v.parseReason(req.body))));
    r.get(`${path}/:id/history`, (req, res) => ok(res, s.history(req.actor, pid(req))));
    r.get(`${path}/:id/print`, (req, res) => file(res, s.print(req.actor, pid(req))));
  };
  doc('/plants', plants, v.parsePlantCreate, v.parsePlantUpdate);
  r.post('/plants/:id/silos', idempotentRequired, (req, res) => ok(res, plants.addSilo(req.actor, pid(req), v.parseSiloCreate(req.body)), 201));
  r.patch('/silos/:id', idempotent, (req, res) => ok(res, plants.updateSilo(req.actor, pid(req), v.parseSiloUpdate(req.body))));
  r.post('/silos/:id/level', idempotent, (req, res) => ok(res, plants.setLevel(req.actor, pid(req), v.parseSiloLevel(req.body))));
  r.post('/plants/:id/scales', idempotentRequired, (req, res) => ok(res, plants.addScale(req.actor, pid(req), v.parseScaleCreate(req.body)), 201));
  r.patch('/scales/:id', idempotent, (req, res) => ok(res, plants.updateScale(req.actor, pid(req), v.parseScaleUpdate(req.body))));
  r.post('/mix-designs/check', (req, res) => ok(res, mixes.check(req.actor, v.parseMixCheck(req.body))));
  doc('/mix-designs', mixes, v.parseMixCreate, v.parseMixUpdate);
  for (const mount of Object.values(parts)) mount(r, { ok, pid, file, idempotent, idempotentRequired, flags });
  return r;
}
