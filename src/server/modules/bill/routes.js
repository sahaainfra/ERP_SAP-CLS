import { Router } from 'express';
import { notFound } from '../../platform/http/errors.js';
import * as v from './validators.js';

/** /api/v1/bill: the measurement book (part 22.01, flag ff.bill.p2201); later the billing parts of the module. */
export function billRoutes(svc, { idempotent, idempotentRequired, flags }) {
  const r = Router(); const ok = (res, data, status = 200) => res.status(status).json({ data }); const pid = (req) => v.parseId(req.params.id); const q = (req) => req.query;
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(out.buffer);
  const { mb } = svc;
  r.use('/mb-entries', (req, _res, next) => (flags.isOn(req.actor, 'ff.bill.p2201') ? next() : next(notFound('The measurement book is not enabled for your company yet.'))));
  r.use(['/mb-abstract', '/mb-book'], (req, _res, next) => (flags.isOn(req.actor, 'ff.bill.p2201') ? next() : next(notFound('The measurement book is not enabled for your company yet.'))));
  r.get('/mb-entries/options', (req, res) => ok(res, mb.options(req.actor)));
  r.get('/mb-entries/export', (req, res) => file(res, mb.exportCsv(req.actor)));
  r.post('/mb-entries/import', idempotentRequired, (req, res) => ok(res, mb.importRows(req.actor, { rows: Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 500) : [] }), 201));
  r.post('/mb-entries/preview', idempotent, (req, res) => ok(res, mb.preview(req.actor, v.parseMbCreate(req.body))));
  r.get('/mb-entries/suggestions', (req, res) => ok(res, mb.suggestions(req.actor, v.parseSuggestQ(q(req)))));
  r.get('/mb-entries', (req, res) => res.json(mb.list(req.actor, q(req))));
  r.post('/mb-entries', idempotentRequired, (req, res) => ok(res, mb.create(req.actor, v.parseMbCreate(req.body)), 201));
  r.get('/mb-entries/:id', (req, res) => ok(res, mb.get(req.actor, pid(req))));
  r.patch('/mb-entries/:id', idempotent, (req, res) => ok(res, mb.update(req.actor, pid(req), v.parseMbUpdate(req.body))));
  r.delete('/mb-entries/:id', (req, res) => ok(res, mb.remove(req.actor, pid(req))));
  r.post('/mb-entries/:id/submit', idempotentRequired, (req, res) => ok(res, mb.submit(req.actor, pid(req)), 202));
  r.post('/mb-entries/:id/withdraw', idempotent, (req, res) => ok(res, mb.withdraw(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/mb-entries/:id/cancel', idempotent, (req, res) => ok(res, mb.cancel(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/mb-entries/:id/amend', idempotent, (req, res) => ok(res, mb.amend(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/mb-entries/:id/check', idempotentRequired, (req, res) => ok(res, mb.check(req.actor, pid(req), v.parseMbCheck(req.body))));
  r.get('/mb-entries/:id/history', (req, res) => ok(res, mb.history(req.actor, pid(req))));
  r.get('/mb-entries/:id/print', (req, res) => file(res, mb.print(req.actor, pid(req))));
  r.get('/mb-abstract', (req, res) => ok(res, mb.abstract(req.actor, v.parseAbstractQ(q(req)))));
  r.get('/mb-book/pdf', (req, res) => file(res, mb.bookPdf(req.actor, v.parsePdfQ(q(req)))));
  return r;
}
