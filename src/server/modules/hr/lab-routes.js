import { Router } from 'express';
import {
  parseApplicable, parseCards, parseClearance, parseCompliance, parseContractorQuery, parseId, parsePhoto, parsePpe, parseReason, parseSubmit, parseWageCreate, parseWageUpdate, parseWorkerCreate, parseWorkerUpdate,
} from './lab-validators.js';

/** Part 07.08: contract workers, labour contractors, wage rates and ID cards. Rights and scope are checked in the service. */
export function labourRoutes({ lab, exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const html = (res, body) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(body);
  const exportOf = (code) => (req, res) => {
    const svc = exportsOf();
    if (!svc) throw new Error('The list export service is not running');
    const out = svc.start(req.actor, code, req.query);
    if (out.kind === 'job') return res.status(202).json({ data: out });
    res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' });
    return res.send(out.buffer);
  };
  const w = lab.workers;
  r.get('/workers', (req, res) => res.json(lab.register.list(req.actor, req.query)));
  r.get('/workers/export', exportOf('hr.workers'));
  r.post('/workers', idempotentRequired, (req, res) => ok(res, w.create(req.actor, parseWorkerCreate(req.body)), 201));
  r.post('/workers/cards', idempotentRequired, async (req, res) => ok(res, await w.cards(req.actor, parseCards(req.body))));
  r.get('/workers/:id', (req, res) => ok(res, w.get(req.actor, parseId(req.params.id))));
  r.patch('/workers/:id', idempotent, (req, res) => ok(res, w.update(req.actor, parseId(req.params.id), parseWorkerUpdate(req.body))));
  r.delete('/workers/:id', (req, res) => ok(res, w.remove(req.actor, parseId(req.params.id))));
  r.post('/workers/:id/submit', idempotentRequired, (req, res) => ok(res, w.submit(req.actor, parseId(req.params.id), parseSubmit(req.body)), 202));
  r.post('/workers/:id/withdraw', idempotent, (req, res) => ok(res, w.withdraw(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/workers/:id/cancel', idempotent, (req, res) => ok(res, w.cancel(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/workers/:id/amend', idempotentRequired, (req, res) => ok(res, w.amend(req.actor, parseId(req.params.id), parseReason(req.body)), 201));
  r.get('/workers/:id/history', (req, res) => ok(res, w.history(req.actor, parseId(req.params.id))));
  r.get('/workers/:id/print', (req, res) => html(res, w.print(req.actor, parseId(req.params.id))));
  r.put('/workers/:id/clearance', idempotent, (req, res) => ok(res, w.clearance(req.actor, parseId(req.params.id), parseClearance(req.body))));
  r.put('/workers/:id/photo', idempotent, (req, res) => ok(res, w.photo(req.actor, parseId(req.params.id), parsePhoto(req.body))));
  r.post('/workers/:id/ppe', idempotentRequired, (req, res) => ok(res, w.ppe(req.actor, parseId(req.params.id), parsePpe(req.body)), 201));
  r.post('/workers/:id/blacklist', idempotentRequired, (req, res) => ok(res, w.blacklist(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/workers/:id/unblacklist', idempotentRequired, (req, res) => ok(res, w.unblacklist(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.get('/labour/trades', (req, res) => ok(res, lab.trades(req.actor.companyId)));
  r.get('/labour/contractors', (req, res) => ok(res, lab.contractors.list(req.actor, parseContractorQuery(req.query))));
  r.get('/labour/strength', (req, res) => ok(res, lab.contractors.strength(req.actor, parseContractorQuery(req.query))));
  r.get('/labour/contractors/:id', (req, res) => ok(res, lab.contractors.get(req.actor, parseId(req.params.id))));
  r.put('/labour/contractors/:id/compliance', idempotent, (req, res) => ok(res, lab.contractors.setCompliance(req.actor, parseId(req.params.id), parseCompliance(req.body))));
  const g = lab.wages;
  r.get('/labour/wage-rates', (req, res) => res.json(g.list(req.actor, req.query)));
  r.get('/labour/wage-rates/export', exportOf('hr.wage_rates'));
  r.get('/labour/wage-rates/applicable', (req, res) => ok(res, g.applicable(req.actor, parseApplicable(req.query))));
  r.post('/labour/wage-rates', idempotentRequired, (req, res) => ok(res, g.create(req.actor, parseWageCreate(req.body)), 201));
  r.get('/labour/wage-rates/:id', (req, res) => ok(res, g.get(req.actor, parseId(req.params.id))));
  r.patch('/labour/wage-rates/:id', idempotent, (req, res) => ok(res, g.update(req.actor, parseId(req.params.id), parseWageUpdate(req.body))));
  r.delete('/labour/wage-rates/:id', (req, res) => ok(res, g.remove(req.actor, parseId(req.params.id))));
  r.post('/labour/wage-rates/:id/submit', idempotentRequired, (req, res) => ok(res, g.submit(req.actor, parseId(req.params.id), parseSubmit(req.body)), 202));
  r.post('/labour/wage-rates/:id/withdraw', idempotent, (req, res) => ok(res, g.withdraw(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/labour/wage-rates/:id/cancel', idempotent, (req, res) => ok(res, g.cancel(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.get('/labour/wage-rates/:id/history', (req, res) => ok(res, g.history(req.actor, parseId(req.params.id))));
  return r;
}
