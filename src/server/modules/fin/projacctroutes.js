import { Router } from 'express';
import { notFound } from '../../platform/http/errors.js';
import { parseId, parseJournalReason, parseMonthRange, parsePeriod, parseProjectExport, parseProjectTb, parseRevrecCreate, parseRevrecImport, parseRevrecUpdate } from './validators.js';

/** Part 23.10: revenue recognition and the project accounts under /api/v1/fin, behind ff.fin.p2310. Rights are checked in the service. */
export function projectAccountingRoutes(pa, { idempotent, idempotentRequired, flags }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const file = (res, f) => res.status(200).set({ 'content-type': f.contentType, 'content-disposition': `attachment; filename="${f.fileName}"`, 'cache-control': 'no-store' }).send(f.buffer);
  const pid = (req) => parseId(req.params.id);
  r.use(['/revenue-recognition', '/project-accounts'], (req, _res, next) => (flags.isOn(req.actor, 'ff.fin.p2310') ? next() : next(notFound('Project accounting is not enabled for your company yet (feature flag ff.fin.p2310 is OFF).'))));
  const { recognition: x, reports: rp, overheads: o } = pa;
  r.get('/revenue-recognition/candidates', (req, res) => ok(res, x.candidates(req.actor, parsePeriod(req.query))));
  r.get('/revenue-recognition/export', (req, res) => file(res, x.exportCsv(req.actor, req.query)));
  r.post('/revenue-recognition/preview', (req, res) => ok(res, x.preview(req.actor, parseRevrecCreate(req.body))));
  r.post('/revenue-recognition/import', idempotentRequired, (req, res) => ok(res, x.importRows(req.actor, parseRevrecImport(req.body)), 201));
  r.get('/revenue-recognition', (req, res) => res.json(x.list(req.actor, req.query)));
  r.post('/revenue-recognition', idempotentRequired, (req, res) => ok(res, x.create(req.actor, parseRevrecCreate(req.body)), 201));
  r.get('/revenue-recognition/:id', (req, res) => ok(res, x.get(req.actor, pid(req))));
  r.patch('/revenue-recognition/:id', idempotent, (req, res) => ok(res, x.update(req.actor, pid(req), parseRevrecUpdate(req.body))));
  r.delete('/revenue-recognition/:id', (req, res) => ok(res, x.remove(req.actor, pid(req))));
  r.post('/revenue-recognition/:id/submit', idempotentRequired, (req, res) => ok(res, x.submit(req.actor, pid(req)), 202));
  r.post('/revenue-recognition/:id/withdraw', idempotent, (req, res) => ok(res, x.withdraw(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/revenue-recognition/:id/cancel', idempotent, (req, res) => ok(res, x.cancel(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/revenue-recognition/:id/amend', idempotentRequired, (req, res) => ok(res, x.amend(req.actor, pid(req), parseJournalReason(req.body)), 201));
  r.get('/revenue-recognition/:id/history', (req, res) => ok(res, x.history(req.actor, pid(req))));
  r.get('/revenue-recognition/:id/print', (req, res) => file(res, x.print(req.actor, pid(req))));
  r.get('/project-accounts/trial-balance', (req, res) => ok(res, rp.trialBalance(req.actor, parseProjectTb(req.query))));
  r.get('/project-accounts/wip', (req, res) => ok(res, rp.wip(req.actor, parsePeriod(req.query))));
  r.get('/project-accounts/overheads', (req, res) => ok(res, rp.overheads(req.actor, parseMonthRange(req.query))));
  r.post('/project-accounts/overheads/catch-up', idempotentRequired, (req, res) => ok(res, o.catchUp(req.actor)));
  r.get('/project-accounts/export', (req, res) => file(res, rp.exportCsv(req.actor, parseProjectExport(req.query))));
  return r;
}
