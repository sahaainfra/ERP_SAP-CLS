import { Router } from 'express';
import { notFound } from '../../platform/http/errors.js';
import { parseDateRange, parseId, parseJournalReason, parsePlDrill, parsePlLine, parseProjectPl, parseSnapshotCreate } from './validators.js';

/** Part 23.12: the project P&L, its structure, the snapshots and the portfolio under /api/v1/fin, behind ff.fin.p2312. Rights are checked in the service. */
export function projectPlRoutes(ps, { idempotent, idempotentRequired, flags }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const file = (res, f) => res.status(200).set({ 'content-type': f.contentType, 'content-disposition': `attachment; filename="${f.fileName}"`, 'cache-control': 'no-store' }).send(f.buffer);
  const pid = (req) => parseId(req.params.id);
  r.use(['/project-pl', '/pl-structure', '/pl-snapshots', '/profitability'], (req, _res, next) => (flags.isOn(req.actor, 'ff.fin.p2312') ? next() : next(notFound('The project P&L is not enabled for your company yet (feature flag ff.fin.p2312 is OFF).'))));
  const { structure: st, pl, snapshots: s } = ps;
  r.get('/project-pl', (req, res) => ok(res, pl.project(req.actor, parseProjectPl(req.query))));
  r.get('/project-pl/drill', (req, res) => ok(res, pl.drill(req.actor, parsePlDrill(req.query))));
  r.get('/profitability', (req, res) => ok(res, ps.portfolio(req.actor, parseDateRange(req.query))));
  r.get('/pl-structure', (req, res) => ok(res, st.get(req.actor)));
  r.put('/pl-structure/:code', idempotent, (req, res) => ok(res, st.setLine(req.actor, String(req.params.code).toUpperCase(), parsePlLine(req.body))));
  r.get('/pl-snapshots/export', (req, res) => file(res, s.exportCsv(req.actor, req.query)));
  r.get('/pl-snapshots', (req, res) => res.json(s.list(req.actor, req.query)));
  r.post('/pl-snapshots', idempotentRequired, (req, res) => ok(res, s.create(req.actor, parseSnapshotCreate(req.body)), 201));
  r.get('/pl-snapshots/:id', (req, res) => ok(res, s.get(req.actor, pid(req))));
  r.delete('/pl-snapshots/:id', (req, res) => ok(res, s.remove(req.actor, pid(req))));
  r.post('/pl-snapshots/:id/recompute', idempotent, (req, res) => ok(res, s.recompute(req.actor, pid(req))));
  r.post('/pl-snapshots/:id/submit', idempotentRequired, (req, res) => ok(res, s.submit(req.actor, pid(req)), 202));
  r.post('/pl-snapshots/:id/withdraw', idempotent, (req, res) => ok(res, s.withdraw(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/pl-snapshots/:id/cancel', idempotent, (req, res) => ok(res, s.cancel(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/pl-snapshots/:id/amend', idempotentRequired, (req, res) => ok(res, s.amend(req.actor, pid(req), parseJournalReason(req.body)), 201));
  r.get('/pl-snapshots/:id/history', (req, res) => ok(res, s.history(req.actor, pid(req))));
  r.get('/pl-snapshots/:id/print', (req, res) => file(res, s.print(req.actor, pid(req))));
  return r;
}
