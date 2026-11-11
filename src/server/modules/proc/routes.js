import { Router } from 'express';
import { parseAvailQ, parseConsolidate, parseId, parseMrCreate, parseMrFulfil, parseMrImport, parseMrUpdate, parsePrCreate, parsePrImport, parsePrUpdate, parseProjectQ, parseRateQ, parseReason, parseStockIngest } from './validators.js';

/** /api/v1/proc: material requests and purchase requisitions (part 15.01). Rights and scope are checked in the services. */
export function procRoutes(svc, { idempotent, idempotentRequired }) {
  const r = Router(); const m = svc.mrSvc.mrs; const p = svc.prSvc.prs; const c = svc.prSvc.consolidate;
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pid = (req) => parseId(req.params.id);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(out.buffer);
  // material requests
  r.get('/material-requests/options', (req, res) => ok(res, m.options(req.actor, parseProjectQ(req.query).projectId)));
  r.get('/material-requests/availability', (req, res) => ok(res, m.availability(req.actor, parseAvailQ(req.query))));
  r.get('/material-requests', (req, res) => res.json(m.list(req.actor, req.query)));
  r.post('/material-requests', idempotentRequired, (req, res) => ok(res, m.create(req.actor, parseMrCreate(req.body)), 201));
  r.get('/material-requests/:id', (req, res) => ok(res, m.get(req.actor, pid(req))));
  r.patch('/material-requests/:id', idempotent, (req, res) => ok(res, m.update(req.actor, pid(req), parseMrUpdate(req.body))));
  r.delete('/material-requests/:id', (req, res) => ok(res, m.remove(req.actor, pid(req))));
  r.post('/material-requests/:id/submit', idempotentRequired, (req, res) => ok(res, m.submit(req.actor, pid(req)), 202));
  r.post('/material-requests/:id/withdraw', idempotent, (req, res) => ok(res, m.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/material-requests/:id/cancel', idempotent, (req, res) => ok(res, m.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/material-requests/:id/amend', idempotentRequired, (req, res) => ok(res, m.amend(req.actor, pid(req), parseReason(req.body)), 201));
  r.post('/material-requests/:id/fulfil', idempotentRequired, (req, res) => ok(res, m.fulfil(req.actor, pid(req), parseMrFulfil(req.body))));
  r.post('/material-requests/:id/import', idempotentRequired, (req, res) => ok(res, m.importLines(req.actor, pid(req), parseMrImport(req.body))));
  r.get('/material-requests/:id/history', (req, res) => ok(res, m.history(req.actor, pid(req))));
  r.get('/material-requests/:id/print', (req, res) => file(res, m.print(req.actor, pid(req))));
  // requisitions
  r.get('/requisitions/options', (req, res) => ok(res, p.options(req.actor, parseProjectQ(req.query).projectId)));
  r.get('/requisitions/rate', (req, res) => ok(res, p.rate(req.actor, parseRateQ(req.query))));
  r.post('/requisitions/consolidate/preview', (req, res) => ok(res, c.preview(req.actor, parseConsolidate(req.body))));
  r.post('/requisitions/consolidate', idempotentRequired, (req, res) => ok(res, c.create(req.actor, parseConsolidate(req.body)), 201));
  r.get('/requisitions', (req, res) => res.json(p.list(req.actor, req.query)));
  r.post('/requisitions', idempotentRequired, (req, res) => ok(res, p.create(req.actor, parsePrCreate(req.body)), 201));
  r.get('/requisitions/:id', (req, res) => ok(res, p.get(req.actor, pid(req))));
  r.patch('/requisitions/:id', idempotent, (req, res) => ok(res, p.update(req.actor, pid(req), parsePrUpdate(req.body))));
  r.delete('/requisitions/:id', (req, res) => ok(res, p.remove(req.actor, pid(req))));
  r.get('/requisitions/:id/checks', (req, res) => ok(res, p.checks(req.actor, pid(req))));
  r.post('/requisitions/:id/submit', idempotentRequired, (req, res) => ok(res, p.submit(req.actor, pid(req)), 202));
  r.post('/requisitions/:id/withdraw', idempotent, (req, res) => ok(res, p.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/requisitions/:id/cancel', idempotent, (req, res) => ok(res, p.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/requisitions/:id/close', idempotentRequired, (req, res) => ok(res, p.close(req.actor, pid(req), parseReason(req.body))));
  r.post('/requisitions/:id/amend', idempotentRequired, (req, res) => ok(res, p.amend(req.actor, pid(req), parseReason(req.body)), 201));
  r.post('/requisitions/:id/import', idempotentRequired, (req, res) => ok(res, p.importLines(req.actor, pid(req), parsePrImport(req.body))));
  r.get('/requisitions/:id/history', (req, res) => ok(res, p.history(req.actor, pid(req))));
  r.get('/requisitions/:id/print', (req, res) => file(res, p.print(req.actor, pid(req))));
  // the stock the procurement part reads, until the stock module (16.01) keeps it
  r.post('/stock/ingest', idempotentRequired, (req, res) => ok(res, svc.stockSvc.ingest(req.actor, parseStockIngest(req.body)), 201));
  return r;
}
