import { Router } from 'express';
import { notFound } from '../../platform/http/errors.js';
import { todayIST } from '../../../shared/dates.js';
import { parseConsolidation, parseIcAccept, parseIcCreate, parseIcRecon, parseIcRelationship, parseIcUpdate, parseId, parseJournalReason, parseJvQuery, parseJvShare } from './validators.js';

/** Part 23.15: inter-company transactions under /api/v1/fin/ic-transactions (the part's /fin/transactions), relationships, reconciliation, consolidation and JV shares, behind ff.fin.p2315. Rights are checked in the service. */
export function interCompanyRoutes(ic, { idempotent, idempotentRequired, flags }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const file = (res, f) => res.status(200).set({ 'content-type': f.contentType, 'content-disposition': `attachment; filename="${f.fileName}"`, 'cache-control': 'no-store' }).send(f.buffer);
  const pid = (req) => parseId(req.params.id);
  r.use(['/ic-transactions', '/ic-relationships', '/ic-reconciliation', '/consolidations', '/jv-shares', '/jv-statement'], (req, _res, next) => (flags.isOn(req.actor, 'ff.fin.p2315') ? next() : next(notFound('Inter-company and consolidation are not enabled for your company yet (feature flag ff.fin.p2315 is OFF).'))));
  const { transactions: t } = ic;
  r.get('/ic-relationships', (req, res) => ok(res, ic.relationships.list(req.actor)));
  r.post('/ic-relationships', idempotentRequired, (req, res) => ok(res, ic.relationships.save(req.actor, parseIcRelationship(req.body))));
  r.get('/ic-reconciliation', (req, res) => ok(res, ic.reconciliation.get(req.actor, parseIcRecon(req.query))));
  r.get('/ic-transactions', (req, res) => res.json(t.list(req.actor, req.query)));
  r.get('/ic-transactions/export', (req, res) => file(res, t.exportCsv(req.actor, req.query)));
  r.post('/ic-transactions', idempotentRequired, (req, res) => ok(res, t.create(req.actor, parseIcCreate(req.body)), 201));
  r.get('/ic-transactions/:id', (req, res) => ok(res, t.get(req.actor, pid(req))));
  r.patch('/ic-transactions/:id', idempotent, (req, res) => ok(res, t.update(req.actor, pid(req), parseIcUpdate(req.body))));
  r.delete('/ic-transactions/:id', (req, res) => ok(res, t.remove(req.actor, pid(req))));
  r.post('/ic-transactions/:id/submit', idempotentRequired, (req, res) => ok(res, t.submit(req.actor, pid(req)), 202));
  r.post('/ic-transactions/:id/withdraw', idempotent, (req, res) => ok(res, t.withdraw(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/ic-transactions/:id/cancel', idempotent, (req, res) => ok(res, t.cancel(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/ic-transactions/:id/accept', idempotentRequired, (req, res) => ok(res, t.accept(req.actor, pid(req), parseIcAccept(req.body))));
  r.post('/ic-transactions/:id/dispute', idempotentRequired, (req, res) => ok(res, t.dispute(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/ic-transactions/:id/drop', idempotent, (req, res) => ok(res, t.drop(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/ic-transactions/:id/reverse', idempotentRequired, (req, res) => ok(res, t.reverse(req.actor, pid(req), parseJournalReason(req.body))));
  r.get('/ic-transactions/:id/history', (req, res) => ok(res, t.history(req.actor, pid(req))));
  r.get('/ic-transactions/:id/print', (req, res) => file(res, t.print(req.actor, pid(req))));
  r.get('/consolidations/preview', (req, res) => ok(res, ic.consolidations.preview(req.actor, parseConsolidation(req.query))));
  r.get('/consolidations/export', (req, res) => file(res, ic.consolidations.exportCsv(req.actor, parseConsolidation(req.query))));
  r.get('/consolidations', (req, res) => ok(res, ic.consolidations.list(req.actor)));
  r.post('/consolidations', idempotentRequired, (req, res) => ok(res, ic.consolidations.run(req.actor, parseConsolidation(req.body)), 201));
  r.get('/consolidations/:id', (req, res) => ok(res, ic.consolidations.get(req.actor, pid(req))));
  r.post('/consolidations/:id/finalise', idempotentRequired, (req, res) => ok(res, ic.consolidations.finalise(req.actor, pid(req))));
  r.get('/jv-shares', (req, res) => ok(res, ic.jv.list(req.actor, parseJvQuery(req.query))));
  r.post('/jv-shares', idempotentRequired, (req, res) => ok(res, ic.jv.save(req.actor, parseJvShare(req.body))));
  r.delete('/jv-shares/:id', (req, res) => ok(res, ic.jv.remove(req.actor, pid(req), parseJournalReason(req.body))));
  r.get('/jv-statement', (req, res) => { const q = parseJvQuery(req.query); const to = q.to ?? todayIST(); ok(res, ic.jv.statement(req.actor, { projectId: q.projectId, from: q.from ?? `${to.slice(0, 4)}-04-01`, to })); });
  return r;
}
