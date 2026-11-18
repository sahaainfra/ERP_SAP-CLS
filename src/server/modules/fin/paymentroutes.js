import { Router } from 'express';
import { notFound } from '../../platform/http/errors.js';
import { parseBankAccount, parseCandidates, parseChequeRegister, parseConfirm, parseDropLine, parseId, parseJournalReason, parseProposalCreate, parseProposalUpdate } from './validators.js';

/** Part 23.04: the payments API under /api/v1/fin (bank accounts, proposals, runs, payments), behind ff.fin.p2304. Rights are checked in the service. */
export function paymentRoutes(pm, { idempotent, idempotentRequired, flags }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const file = (res, f) => res.status(200).set({ 'content-type': f.contentType, 'content-disposition': `attachment; filename="${f.fileName}"`, 'cache-control': 'no-store' }).send(f.buffer);
  const pid = (req) => parseId(req.params.id);
  r.use(['/bank-accounts', '/proposals', '/payments'], (req, _res, next) => (flags.isOn(req.actor, 'ff.fin.p2304') ? next() : next(notFound('Payments are not enabled for your company yet (feature flag ff.fin.p2304 is OFF).'))));
  const { banks: b, proposals: p, run, payments: y } = pm;
  r.get('/bank-accounts/formats', (req, res) => ok(res, b.formats()));
  r.get('/bank-accounts', (req, res) => ok(res, b.list(req.actor)));
  r.post('/bank-accounts', idempotentRequired, (req, res) => ok(res, b.save(req.actor, null, parseBankAccount(req.body)), 201));
  r.get('/bank-accounts/:id', (req, res) => ok(res, b.get(req.actor, pid(req))));
  r.put('/bank-accounts/:id', idempotent, (req, res) => ok(res, b.save(req.actor, pid(req), parseBankAccount(req.body))));
  r.get('/proposals/candidates', (req, res) => ok(res, p.candidates(req.actor, parseCandidates(req.query))));
  r.get('/proposals/export', (req, res) => file(res, p.exportCsv(req.actor, req.query)));
  r.get('/proposals', (req, res) => res.json(p.list(req.actor, req.query)));
  r.post('/proposals', idempotentRequired, (req, res) => ok(res, p.create(req.actor, parseProposalCreate(req.body)), 201));
  r.get('/proposals/:id', (req, res) => ok(res, p.get(req.actor, pid(req))));
  r.patch('/proposals/:id', idempotent, (req, res) => ok(res, p.update(req.actor, pid(req), parseProposalUpdate(req.body))));
  r.delete('/proposals/:id', (req, res) => ok(res, p.remove(req.actor, pid(req))));
  r.post('/proposals/:id/submit', idempotentRequired, (req, res) => ok(res, p.submit(req.actor, pid(req)), 202));
  r.post('/proposals/:id/withdraw', idempotent, (req, res) => ok(res, p.withdraw(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/proposals/:id/cancel', idempotent, (req, res) => ok(res, p.cancel(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/proposals/:id/lines/:lineId/drop', idempotentRequired, (req, res) => ok(res, p.dropLine(req.actor, pid(req), parseId(req.params.lineId), parseDropLine(req.body))));
  r.post('/proposals/:id/release', idempotentRequired, (req, res) => ok(res, run.release(req.actor, pid(req))));
  r.get('/proposals/:id/bank-file', (req, res) => file(res, run.file(req.actor, pid(req))));
  r.get('/proposals/:id/cheques', (req, res) => file(res, run.cheques(req.actor, pid(req))));
  r.get('/proposals/:id/history', (req, res) => ok(res, p.history(req.actor, pid(req))));
  r.get('/proposals/:id/print', (req, res) => file(res, p.print(req.actor, pid(req))));
  r.get('/payments/export', (req, res) => file(res, y.exportCsv(req.actor, req.query)));
  r.get('/payments/cheque-register', (req, res) => ok(res, y.chequeRegister(req.actor, parseChequeRegister(req.query))));
  r.post('/payments/confirm', idempotentRequired, (req, res) => ok(res, y.confirm(req.actor, parseConfirm(req.body))));
  r.get('/payments', (req, res) => res.json(y.list(req.actor, req.query)));
  r.get('/payments/:id', (req, res) => ok(res, y.get(req.actor, pid(req))));
  r.post('/payments/:id/advice', idempotentRequired, (req, res) => ok(res, y.adviceAgain(req.actor, pid(req))));
  r.get('/payments/:id/advice', (req, res) => file(res, y.advicePdf(req.actor, pid(req))));
  return r;
}
