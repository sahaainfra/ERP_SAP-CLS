import { Router } from 'express';
import { notFound } from '../../platform/http/errors.js';
import { parseAdjust, parseAsOf, parseDirectCreate, parseDirectUpdate, parseDnCreate, parseDnUpdate, parseHold, parseId, parseJournalReason, parsePayable, parseRange, parseTdsPreview, parseVendorLedger } from './validators.js';

/** Part 23.03: the accounts payable API under /api/v1/fin (bills, debit notes, the vendor ledger and the payables reports), behind ff.fin.p2303. Rights are checked in the service. */
export function apRoutes(ap, { idempotent, idempotentRequired, flags }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const file = (res, f) => res.status(200).set({ 'content-type': f.contentType, 'content-disposition': `attachment; filename="${f.fileName}"`, 'cache-control': 'no-store' }).send(f.buffer);
  const pid = (req) => parseId(req.params.id);
  r.use(['/bills', '/debit-notes', '/payables'], (req, _res, next) => (flags.isOn(req.actor, 'ff.fin.p2303') ? next() : next(notFound('Accounts payable is not enabled for your company yet (feature flag ff.fin.p2303 is OFF).'))));
  const { bills: b, notes: n } = ap;
  r.get('/bills/tds-preview', (req, res) => ok(res, b.tdsPreview(req.actor, parseTdsPreview(req.query))));
  r.get('/bills/payable', (req, res) => ok(res, b.payable(req.actor, parsePayable(req.query))));
  r.get('/bills/export', (req, res) => file(res, b.exportCsv(req.actor, req.query)));
  r.get('/bills', (req, res) => res.json(b.list(req.actor, req.query)));
  r.post('/bills', idempotentRequired, (req, res) => ok(res, b.createDirect(req.actor, parseDirectCreate(req.body)), 201));
  r.get('/bills/:id', (req, res) => ok(res, b.get(req.actor, pid(req))));
  r.patch('/bills/:id', idempotent, (req, res) => ok(res, b.updateDirect(req.actor, pid(req), parseDirectUpdate(req.body))));
  r.delete('/bills/:id', (req, res) => ok(res, b.remove(req.actor, pid(req))));
  r.post('/bills/:id/submit', idempotentRequired, (req, res) => ok(res, b.submit(req.actor, pid(req)), 202));
  r.post('/bills/:id/withdraw', idempotent, (req, res) => ok(res, b.withdraw(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/bills/:id/cancel', idempotent, (req, res) => ok(res, b.cancel(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/bills/:id/hold', idempotentRequired, (req, res) => ok(res, b.hold(req.actor, pid(req), parseHold(req.body))));
  r.post('/bills/:id/adjust-advance', idempotentRequired, (req, res) => ok(res, b.adjustAdvance(req.actor, pid(req), parseAdjust(req.body))));
  r.get('/bills/:id/history', (req, res) => ok(res, b.history(req.actor, pid(req))));
  r.get('/bills/:id/print', (req, res) => file(res, b.print(req.actor, pid(req))));
  r.get('/debit-notes', (req, res) => res.json(n.list(req.actor, req.query)));
  r.post('/debit-notes', idempotentRequired, (req, res) => ok(res, n.create(req.actor, parseDnCreate(req.body)), 201));
  r.get('/debit-notes/:id', (req, res) => ok(res, n.get(req.actor, pid(req))));
  r.patch('/debit-notes/:id', idempotent, (req, res) => ok(res, n.update(req.actor, pid(req), parseDnUpdate(req.body))));
  r.delete('/debit-notes/:id', (req, res) => ok(res, n.remove(req.actor, pid(req))));
  r.post('/debit-notes/:id/submit', idempotentRequired, (req, res) => ok(res, n.submit(req.actor, pid(req)), 202));
  r.post('/debit-notes/:id/withdraw', idempotent, (req, res) => ok(res, n.withdraw(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/debit-notes/:id/cancel', idempotent, (req, res) => ok(res, n.cancel(req.actor, pid(req), parseJournalReason(req.body))));
  r.get('/debit-notes/:id/history', (req, res) => ok(res, n.history(req.actor, pid(req))));
  r.get('/payables/partners', (req, res) => ok(res, ap.partners(req.actor)));
  r.get('/payables/vendor-ledger', (req, res) => ok(res, ap.vendorLedger(req.actor, parseVendorLedger(req.query))));
  r.get('/payables/statement', (req, res) => file(res, ap.statementPdf(req.actor, parseVendorLedger(req.query))));
  r.get('/payables/confirmation', (req, res) => file(res, ap.statementPdf(req.actor, parseVendorLedger(req.query), true)));
  r.get('/payables/ageing', (req, res) => ok(res, ap.ageing(req.actor, parseAsOf(req.query))));
  r.get('/payables/msme', (req, res) => ok(res, ap.msmeReport(req.actor, parseAsOf(req.query))));
  r.get('/payables/tds', (req, res) => ok(res, ap.tdsReport(req.actor, parseRange(req.query))));
  r.get('/payables/:kind/export', (req, res) => { const kind = ['ageing', 'msme', 'tds'].includes(req.params.kind) ? req.params.kind : 'ageing'; file(res, ap.reportCsv(req.actor, kind, { ...parseRange({ from: req.query.from, to: req.query.to }), ...(req.query.asOf ? { asOf: String(req.query.asOf) } : {}) })); });
  return r;
}
