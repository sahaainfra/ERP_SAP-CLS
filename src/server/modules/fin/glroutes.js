import { Router } from 'express';
import { notFound } from '../../platform/http/errors.js';
import { parseCarryForward, parseId, parseJournalCheck, parseJournalCreate, parseJournalImport, parseJournalReason, parseJournalReverse, parseJournalUpdate, parseLedger, parseRecurring, parseRecurringStatus, parseTrialBalance } from './validators.js';

/** Part 23.01: the general ledger API under /api/v1/fin (journals, recurring journals, the account ledger, the trial balance, carry-forward), behind ff.fin.p2301. Rights are checked in the service. */
export function glRoutes(gl, { idempotent, idempotentRequired, flags }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const file = (res, f) => res.status(200).set({ 'content-type': f.contentType, 'content-disposition': `attachment; filename="${f.fileName}"`, 'cache-control': 'no-store' }).send(f.buffer);
  const pid = (req) => parseId(req.params.id);
  r.use(['/journals', '/recurring-journals', '/ledger', '/trial-balance', '/gl'], (req, _res, next) => (flags.isOn(req.actor, 'ff.fin.p2301') ? next() : next(notFound('The general ledger is not enabled for your company yet (feature flag ff.fin.p2301 is OFF).'))));
  const { journals: j, recurring: rc } = gl;
  r.get('/journals/options', (req, res) => ok(res, j.options(req.actor)));
  r.get('/journals/export', (req, res) => file(res, j.exportCsv(req.actor, req.query)));
  r.post('/journals/check', (req, res) => ok(res, j.check(req.actor, parseJournalCheck(req.body))));
  r.post('/journals/import', idempotentRequired, (req, res) => ok(res, j.importRows(req.actor, parseJournalImport(req.body)), 201));
  r.get('/journals', (req, res) => res.json(j.list(req.actor, req.query)));
  r.post('/journals', idempotentRequired, (req, res) => ok(res, j.create(req.actor, parseJournalCreate(req.body)), 201));
  r.get('/journals/:id', (req, res) => ok(res, j.get(req.actor, pid(req))));
  r.patch('/journals/:id', idempotent, (req, res) => ok(res, j.update(req.actor, pid(req), parseJournalUpdate(req.body))));
  r.delete('/journals/:id', (req, res) => ok(res, j.remove(req.actor, pid(req))));
  r.post('/journals/:id/submit', idempotentRequired, (req, res) => ok(res, j.submit(req.actor, pid(req)), 202));
  r.post('/journals/:id/withdraw', idempotent, (req, res) => ok(res, j.withdraw(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/journals/:id/cancel', idempotent, (req, res) => ok(res, j.cancel(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/journals/:id/reverse', idempotentRequired, (req, res) => ok(res, j.reverse(req.actor, pid(req), parseJournalReverse(req.body)), 202));
  r.post('/journals/:id/amend', idempotentRequired, (req, res) => ok(res, j.amend(req.actor, pid(req), parseJournalReason(req.body)), 202));
  r.get('/journals/:id/history', (req, res) => ok(res, j.history(req.actor, pid(req))));
  r.get('/journals/:id/print', (req, res) => file(res, j.print(req.actor, pid(req))));
  r.get('/recurring-journals', (req, res) => res.json(rc.list(req.actor, req.query)));
  r.post('/recurring-journals', idempotentRequired, (req, res) => ok(res, rc.save(req.actor, null, parseRecurring(req.body)), 201));
  r.get('/recurring-journals/:id', (req, res) => ok(res, rc.get(req.actor, pid(req))));
  r.put('/recurring-journals/:id', idempotent, (req, res) => ok(res, rc.save(req.actor, pid(req), parseRecurring(req.body))));
  r.post('/recurring-journals/:id/status', idempotent, (req, res) => ok(res, rc.setStatus(req.actor, pid(req), parseRecurringStatus(req.body))));
  r.get('/ledger', (req, res) => ok(res, gl.ledger(req.actor, parseLedger(req.query))));
  r.get('/ledger/export', (req, res) => file(res, gl.exportLedger(req.actor, parseLedger(req.query))));
  r.get('/trial-balance', (req, res) => ok(res, gl.trialBalance(req.actor, parseTrialBalance(req.query))));
  r.get('/trial-balance/export', (req, res) => file(res, gl.exportTb(req.actor, parseTrialBalance(req.query))));
  r.post('/gl/carry-forward', idempotentRequired, (req, res) => ok(res, gl.carryForward(req.actor, parseCarryForward(req.body)), 201));
  r.get('/gl/integrity', (req, res) => ok(res, gl.integrity(req.actor)));
  return r;
}
