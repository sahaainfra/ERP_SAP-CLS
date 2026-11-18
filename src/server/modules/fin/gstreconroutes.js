import { Router } from 'express';
import { notFound } from '../../platform/http/errors.js';
import { parse26as, parse2bImport, parseCalendar, parseFy, parseId, parseItcCreate, parseItcOverride, parseJournalReason, parsePeriod, parseQuarter, parseReconAct, parseReturnAct, parseReturnFile, parseTdsCert, parseTdsFile, parseTdsPrepare, parseWorklist2b } from './validators.js';

/** Part 23.08: GST reconciliation, the ITC review, GSTR-1/3B, TDS returns and the compliance calendar under /api/v1/fin, behind ff.fin.p2308. Rights are checked in the service. */
export function gstReconRoutes(gr, { idempotent, idempotentRequired, flags }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const file = (res, f) => res.status(200).set({ 'content-type': f.contentType, 'content-disposition': `attachment; filename="${f.fileName}"`, 'cache-control': 'no-store' }).send(f.buffer);
  const pid = (req) => parseId(req.params.id);
  r.use(['/gst-recon', '/itc-reviews', '/gst-returns', '/tds-returns', '/compliance-calendar'], (req, _res, next) => (flags.isOn(req.actor, 'ff.fin.p2308') ? next() : next(notFound('GST reconciliation and TDS compliance are not enabled for your company yet (feature flag ff.fin.p2308 is OFF).'))));
  const { recon: x, reviews: v, returns: g, tds: t } = gr;
  r.post('/gst-recon/import', idempotentRequired, (req, res) => ok(res, x.import(req.actor, parse2bImport(req.body)), 201));
  r.post('/gst-recon/rematch', idempotentRequired, (req, res) => ok(res, x.rematch(req.actor, parsePeriod(req.body))));
  r.get('/gst-recon/export', (req, res) => file(res, x.exportCsv(req.actor, parsePeriod(req.query))));
  r.get('/gst-recon', (req, res) => ok(res, x.worklist(req.actor, parseWorklist2b(req.query))));
  r.get('/gst-recon/lines/:id', (req, res) => ok(res, x.line(req.actor, pid(req))));
  r.post('/gst-recon/lines/:id/act', idempotentRequired, (req, res) => ok(res, x.act(req.actor, pid(req), parseReconAct(req.body))));
  r.get('/itc-reviews', (req, res) => ok(res, v.list(req.actor)));
  r.post('/itc-reviews', idempotentRequired, (req, res) => ok(res, v.create(req.actor, parseItcCreate(req.body)), 201));
  r.get('/itc-reviews/:id', (req, res) => ok(res, v.get(req.actor, pid(req))));
  r.delete('/itc-reviews/:id', (req, res) => ok(res, v.remove(req.actor, pid(req))));
  r.post('/itc-reviews/:id/recompute', idempotent, (req, res) => ok(res, v.recompute(req.actor, pid(req))));
  r.post('/itc-reviews/:id/override', idempotentRequired, (req, res) => ok(res, v.override(req.actor, pid(req), parseItcOverride(req.body))));
  r.post('/itc-reviews/:id/submit', idempotentRequired, (req, res) => ok(res, v.submit(req.actor, pid(req)), 202));
  r.post('/itc-reviews/:id/withdraw', idempotent, (req, res) => ok(res, v.withdraw(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/itc-reviews/:id/cancel', idempotent, (req, res) => ok(res, v.cancel(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/itc-reviews/:id/amend', idempotentRequired, (req, res) => ok(res, v.amend(req.actor, pid(req)), 201));
  r.get('/itc-reviews/:id/history', (req, res) => ok(res, v.history(req.actor, pid(req))));
  r.get('/itc-reviews/:id/print', (req, res) => file(res, v.print(req.actor, pid(req))));
  r.get('/itc-reviews/:id/export', (req, res) => file(res, v.exportCsv(req.actor, pid(req))));
  r.get('/gst-returns', (req, res) => ok(res, g.gst(req.actor, parsePeriod(req.query))));
  r.post('/gst-returns/prepare', idempotentRequired, (req, res) => ok(res, g.prepare(req.actor, parseReturnAct(req.body))));
  r.post('/gst-returns/file', idempotentRequired, (req, res) => ok(res, g.file(req.actor, parseReturnFile(req.body))));
  r.get('/gst-returns/export', (req, res) => { const b = parseReturnAct(req.query); file(res, g.exportJson(req.actor, b)); });
  r.get('/tds-returns', (req, res) => ok(res, t.quarter(req.actor, parseQuarter(req.query))));
  r.post('/tds-returns/prepare', idempotentRequired, (req, res) => ok(res, t.prepare(req.actor, parseTdsPrepare(req.body))));
  r.post('/tds-returns/file', idempotentRequired, (req, res) => ok(res, t.file(req.actor, parseTdsFile(req.body))));
  r.get('/tds-returns/certificate', (req, res) => file(res, t.certificate(req.actor, parseTdsCert(req.query))));
  r.post('/tds-returns/26as', idempotentRequired, (req, res) => ok(res, t.import26as(req.actor, parse26as(req.body)), 201));
  r.get('/tds-returns/26as', (req, res) => ok(res, t.recon26as(req.actor, parseFy(req.query))));
  r.get('/compliance-calendar', (req, res) => ok(res, gr.calendar(req.actor, parseCalendar(req.query))));
  return r;
}
