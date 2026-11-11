import { Router } from 'express';
import { parseAvailQ, parseConsolidate, parseId, parseMrCreate, parseMrFulfil, parseMrImport, parseMrUpdate, parsePrCreate, parsePrImport, parsePrUpdate, parseProjectQ, parseRateQ, parseReason, parseStockIngest, parseRunCreate, parseRunUpdate, parseRunImport, parseRunExport, parseProposalModify, parseProposalAccept, parseParamCreate, parseParamUpdate, parseSupplyIngest, parseRfqCreate, parseRfqUpdate, parseRfqAmend, parseRfqOptionsQ, parseVendorsQ, parseReissue, parseRegret, parseAsk, parseAnswer, parseQuoteCreate, parseQuoteUpdate, parseQuoteImport, parseToken, parseVendorQuote, parseVendorDecline, parseVendorAsk, parseCsCreate, parseCsUpdate, parseCsImport, parseCsNegotiate } from './validators.js';
import { HttpError } from '../../platform/http/errors.js';
import { createRateLimiter } from '../../platform/integrations/breaker.js';

/** /api/v1/proc: material requests and purchase requisitions (part 15.01). Rights and scope are checked in the services. */
export function procRoutes(svc, { idempotent, idempotentRequired }) {
  const r = Router(); const run = svc.mrpSvc.mrp; const pp = svc.mrpSvc.props; const ip = svc.paramSvc.params; const m = svc.mrSvc.mrs; const p = svc.prSvc.prs; const c = svc.prSvc.consolidate; const rf = svc.rfqSvc.rfqs; const qt = svc.rfqSvc.quotes; const cs = svc.csSvc.css;
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pid = (req) => parseId(req.params.id);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(out.buffer);
  r.get('/projects', (req, res) => ok(res, m.projects(req.actor)));
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
  // MRP runs (15.02): the standard `submit` of a run makes it (it has no approval of its own: the planner's decision on each proposal is the gate, BR-01)
  r.get('/mrp/projects', (req, res) => ok(res, run.projects(req.actor)));
  r.get('/runs/options', (req, res) => ok(res, svc.mrpSvc.options(req.actor, parseProjectQ(req.query).projectId)));
  r.get('/runs', (req, res) => res.json(run.list(req.actor, req.query)));
  r.post('/runs', idempotentRequired, (req, res) => ok(res, run.create(req.actor, parseRunCreate(req.body)), 201));
  r.get('/runs/:id', (req, res) => ok(res, run.get(req.actor, pid(req))));
  r.patch('/runs/:id', idempotent, (req, res) => ok(res, run.update(req.actor, pid(req), parseRunUpdate(req.body))));
  r.delete('/runs/:id', (req, res) => ok(res, run.remove(req.actor, pid(req))));
  r.post('/runs/:id/submit', idempotentRequired, (req, res) => ok(res, run.submit(req.actor, pid(req)), 202));
  r.post('/runs/:id/cancel', idempotent, (req, res) => ok(res, run.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/runs/:id/amend', idempotentRequired, (req, res) => ok(res, run.amend(req.actor, pid(req), parseReason(req.body)), 201));
  r.post('/runs/:id/import', idempotentRequired, (req, res) => ok(res, run.importDemand(req.actor, pid(req), parseRunImport(req.body))));
  r.get('/runs/:id/history', (req, res) => ok(res, run.history(req.actor, pid(req))));
  r.get('/runs/:id/heatmap', (req, res) => ok(res, run.heatmap(req.actor, pid(req))));
  r.get('/runs/:id/long-lead', (req, res) => ok(res, run.longLead(req.actor, pid(req))));
  r.get('/runs/:id/print', (req, res) => file(res, run.print(req.actor, pid(req))));
  r.get('/runs/:id/export', (req, res) => file(res, run.reportExport(req.actor, pid(req), parseRunExport(req.query))));
  r.get('/proposals', (req, res) => res.json(pp.list(req.actor, req.query)));
  r.post('/proposals/accept', idempotentRequired, (req, res) => ok(res, pp.accept(req.actor, parseProposalAccept(req.body)), 201));
  r.get('/proposals/:id', (req, res) => ok(res, pp.get(req.actor, pid(req))));
  r.patch('/proposals/:id', idempotent, (req, res) => ok(res, pp.modify(req.actor, pid(req), parseProposalModify(req.body))));
  r.post('/proposals/:id/reject', idempotentRequired, (req, res) => ok(res, pp.reject(req.actor, pid(req), parseReason(req.body))));
  // item planning parameters (maker-checker)
  r.get('/item-params', (req, res) => res.json(ip.list(req.actor, req.query)));
  r.post('/item-params', idempotentRequired, (req, res) => ok(res, ip.create(req.actor, parseParamCreate(req.body)), 201));
  r.get('/item-params/:id', (req, res) => ok(res, ip.get(req.actor, pid(req))));
  r.patch('/item-params/:id', idempotent, (req, res) => ok(res, ip.update(req.actor, pid(req), parseParamUpdate(req.body))));
  r.delete('/item-params/:id', (req, res) => ok(res, ip.remove(req.actor, pid(req))));
  r.post('/item-params/:id/submit', idempotentRequired, (req, res) => ok(res, ip.submit(req.actor, pid(req)), 202));
  r.post('/item-params/:id/withdraw', idempotent, (req, res) => ok(res, ip.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/item-params/:id/cancel', idempotent, (req, res) => ok(res, ip.cancel(req.actor, pid(req), parseReason(req.body))));
  r.get('/item-params/:id/history', (req, res) => ok(res, ip.history(req.actor, pid(req))));
  r.post('/supply/ingest', idempotentRequired, (req, res) => ok(res, svc.mrpSvc.ingestSupply(req.actor, parseSupplyIngest(req.body)), 201));
  // RFQs (15.03): `submit` sends the single-source justification for approval; `issue` sends the RFQ to the vendors
  r.get('/rfqs/options', (req, res) => { const q = parseRfqOptionsQ(req.query); ok(res, rf.options(req.actor, q.projectId, q.prLineIds)); });
  r.get('/rfqs/vendors', (req, res) => ok(res, rf.vendors(req.actor, parseVendorsQ(req.query))));
  r.get('/rfqs', (req, res) => res.json(rf.list(req.actor, req.query)));
  r.post('/rfqs', idempotentRequired, (req, res) => ok(res, rf.create(req.actor, parseRfqCreate(req.body)), 201));
  r.get('/rfqs/:id', (req, res) => ok(res, rf.get(req.actor, pid(req))));
  r.patch('/rfqs/:id', idempotent, (req, res) => ok(res, rf.update(req.actor, pid(req), parseRfqUpdate(req.body))));
  r.delete('/rfqs/:id', (req, res) => ok(res, rf.remove(req.actor, pid(req))));
  r.post('/rfqs/:id/submit', idempotentRequired, (req, res) => ok(res, rf.submit(req.actor, pid(req)), 202));
  r.post('/rfqs/:id/withdraw', idempotent, (req, res) => ok(res, rf.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/rfqs/:id/issue', idempotentRequired, (req, res) => ok(res, rf.issue(req.actor, pid(req))));
  r.post('/rfqs/:id/reissue', idempotentRequired, (req, res) => ok(res, rf.reissue(req.actor, pid(req), parseReissue(req.body))));
  r.post('/rfqs/:id/remind', idempotent, (req, res) => ok(res, rf.remind(req.actor, pid(req))));
  r.post('/rfqs/:id/close', idempotentRequired, (req, res) => ok(res, rf.close(req.actor, pid(req), parseReason(req.body))));
  r.post('/rfqs/:id/cancel', idempotent, (req, res) => ok(res, rf.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/rfqs/:id/amend', idempotentRequired, (req, res) => ok(res, rf.amend(req.actor, pid(req), parseRfqAmend(req.body))));
  r.post('/rfqs/:id/regret', idempotentRequired, (req, res) => ok(res, rf.regret(req.actor, pid(req), parseRegret(req.body))));
  r.post('/rfqs/:id/clarifications', idempotentRequired, (req, res) => ok(res, rf.ask(req.actor, pid(req), parseAsk(req.body)), 201));
  r.post('/rfqs/:id/clarifications/:cid/answer', idempotent, (req, res) => ok(res, rf.answer(req.actor, pid(req), parseId(req.params.cid), parseAnswer(req.body))));
  r.get('/rfqs/:id/comparison', (req, res) => ok(res, rf.comparison(req.actor, pid(req))));
  r.get('/rfqs/:id/history', (req, res) => ok(res, rf.history(req.actor, pid(req))));
  r.get('/rfqs/:id/print', (req, res) => file(res, rf.print(req.actor, pid(req))));
  // vendor quotations
  r.get('/quotations', (req, res) => res.json(qt.list(req.actor, req.query)));
  r.post('/quotations', idempotentRequired, (req, res) => ok(res, qt.create(req.actor, parseQuoteCreate(req.body)), 201));
  r.get('/quotations/:id', (req, res) => ok(res, qt.get(req.actor, pid(req))));
  r.patch('/quotations/:id', idempotent, (req, res) => ok(res, qt.update(req.actor, pid(req), parseQuoteUpdate(req.body))));
  r.delete('/quotations/:id', (req, res) => ok(res, qt.remove(req.actor, pid(req))));
  r.post('/quotations/:id/submit', idempotentRequired, (req, res) => ok(res, qt.submit(req.actor, pid(req))));
  r.post('/quotations/:id/withdraw', idempotent, (req, res) => ok(res, qt.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/quotations/:id/cancel', idempotent, (req, res) => ok(res, qt.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/quotations/:id/amend', idempotentRequired, (req, res) => ok(res, qt.amend(req.actor, pid(req), parseReason(req.body)), 201));
  r.post('/quotations/:id/import', idempotentRequired, (req, res) => ok(res, qt.importLines(req.actor, pid(req), parseQuoteImport(req.body))));
  r.get('/quotations/:id/history', (req, res) => ok(res, qt.history(req.actor, pid(req))));
  r.get('/quotations/:id/print', (req, res) => file(res, qt.print(req.actor, pid(req))));
  // comparative statements (15.04): `create` generates the matrix and the recommendation from the quotations received
  r.get('/comparative-statements/rfqs', (req, res) => ok(res, cs.rfqs(req.actor)));
  r.get('/comparative-statements', (req, res) => res.json(cs.list(req.actor, req.query)));
  r.post('/comparative-statements', idempotentRequired, (req, res) => ok(res, cs.create(req.actor, parseCsCreate(req.body)), 201));
  r.get('/comparative-statements/:id', (req, res) => ok(res, cs.get(req.actor, pid(req))));
  r.patch('/comparative-statements/:id', idempotent, (req, res) => ok(res, cs.update(req.actor, pid(req), parseCsUpdate(req.body))));
  r.delete('/comparative-statements/:id', (req, res) => ok(res, cs.remove(req.actor, pid(req))));
  r.post('/comparative-statements/:id/submit', idempotentRequired, (req, res) => ok(res, cs.submit(req.actor, pid(req)), 202));
  r.post('/comparative-statements/:id/withdraw', idempotent, (req, res) => ok(res, cs.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/comparative-statements/:id/cancel', idempotent, (req, res) => ok(res, cs.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/comparative-statements/:id/amend', idempotentRequired, (req, res) => ok(res, cs.amend(req.actor, pid(req), parseReason(req.body)), 201));
  r.post('/comparative-statements/:id/import', idempotentRequired, (req, res) => ok(res, cs.importSelections(req.actor, pid(req), parseCsImport(req.body))));
  r.post('/comparative-statements/:id/negotiations', idempotentRequired, (req, res) => ok(res, cs.negotiate(req.actor, pid(req), parseCsNegotiate(req.body)), 201));
  r.get('/comparative-statements/:id/history', (req, res) => ok(res, cs.history(req.actor, pid(req))));
  r.get('/comparative-statements/:id/print', (req, res) => file(res, cs.print(req.actor, pid(req))));
  return r;
}

/** The vendor's side of an RFQ with no sign-in: the link is the proof, it works until the due date plus the grace days and is used up by the quotation. Rate limited per address. */
export function vendorQuoteRoutes({ portal }) {
  const r = Router(); const limiter = createRateLimiter();
  const limit = (name, perMinute) => (req, _res, next) => (limiter.take(`${name}:${req.ip}`, perMinute).ok ? next() : next(new HttpError(429, 'RATE_LIMITED', 'Too many attempts from this address. Wait a minute and try again.')));
  r.get('/vendor-quote/:token', limit('vq-look', 30), (req, res) => res.json({ data: portal.info(parseToken(req.params.token)) }));
  r.post('/vendor-quote/:token/submit', limit('vq-submit', 10), (req, res) => res.status(201).json({ data: portal.submit(parseToken(req.params.token), parseVendorQuote(req.body)) }));
  r.post('/vendor-quote/:token/decline', limit('vq-decline', 10), (req, res) => res.json({ data: portal.decline(parseToken(req.params.token), parseVendorDecline(req.body)) }));
  r.post('/vendor-quote/:token/clarify', limit('vq-ask', 10), (req, res) => res.status(201).json({ data: portal.clarify(parseToken(req.params.token), parseVendorAsk(req.body)) }));
  return r;
}
