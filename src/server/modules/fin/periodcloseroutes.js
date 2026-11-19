import { Router } from 'express';
import { notFound } from '../../platform/http/errors.js';
import { parseCloseCreate, parseCloseLock, parseCloseReopen, parseCloseTaskAdd, parseCloseTaskComplete, parseCloseTaskUpdate, parseCloseUpdate, parseDashboard, parseId, parseJournalReason, parseStatements, parseYearEnd } from './validators.js';

/** Part 23.14: period close under /api/v1/fin/periods (with its tasks, locks and reopen), the statements, the year end and the finance dashboard, behind ff.fin.p2314. Rights are checked in the service. */
export function periodCloseRoutes(pc, { idempotent, idempotentRequired, flags }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const file = (res, f) => res.status(200).set({ 'content-type': f.contentType, 'content-disposition': `attachment; filename="${f.fileName}"`, 'cache-control': 'no-store' }).send(f.buffer);
  const pid = (req) => parseId(req.params.id); const tid = (req) => parseId(req.params.taskId);
  r.use(['/periods', '/period-reopens', '/statements', '/year-end', '/finance-dashboard'], (req, _res, next) => (flags.isOn(req.actor, 'ff.fin.p2314') ? next() : next(notFound('Period close and statements are not enabled for your company yet (feature flag ff.fin.p2314 is OFF).'))));
  const { closes: c, reopens: ro } = pc;
  r.get('/statements', (req, res) => ok(res, pc.statements.get(req.actor, parseStatements(req.query))));
  r.get('/statements/export', (req, res) => file(res, pc.statements.exportCsv(req.actor, parseStatements(req.query))));
  r.get('/statements/print', (req, res) => file(res, pc.statements.print(req.actor, parseStatements(req.query))));
  r.get('/finance-dashboard', (req, res) => ok(res, pc.dashboard(req.actor, parseDashboard(req.query))));
  r.get('/year-end', (req, res) => ok(res, pc.yearEnd.get(req.actor, parseYearEnd(req.query))));
  r.post('/year-end/:id/carry-forward', idempotentRequired, (req, res) => ok(res, pc.yearEnd.carryForward(req.actor, { fyId: pid(req) }), 201));
  r.post('/year-end/:id/close', idempotentRequired, (req, res) => ok(res, pc.yearEnd.close(req.actor, { fyId: pid(req) }, parseJournalReason(req.body))));
  r.get('/periods', (req, res) => res.json(c.list(req.actor, req.query)));
  r.get('/periods/export', (req, res) => file(res, c.exportCsv(req.actor, req.query)));
  r.post('/periods', idempotentRequired, (req, res) => ok(res, c.create(req.actor, parseCloseCreate(req.body)), 201));
  r.get('/periods/:id', (req, res) => ok(res, c.get(req.actor, pid(req))));
  r.patch('/periods/:id', idempotent, (req, res) => ok(res, c.update(req.actor, pid(req), parseCloseUpdate(req.body))));
  r.delete('/periods/:id', (req, res) => ok(res, c.remove(req.actor, pid(req))));
  r.post('/periods/:id/tasks', idempotentRequired, (req, res) => ok(res, c.addTask(req.actor, pid(req), parseCloseTaskAdd(req.body)), 201));
  r.patch('/periods/:id/tasks/:taskId', idempotent, (req, res) => ok(res, c.updateTask(req.actor, pid(req), tid(req), parseCloseTaskUpdate(req.body))));
  r.post('/periods/:id/tasks/:taskId/complete', idempotentRequired, (req, res) => ok(res, c.completeTask(req.actor, pid(req), tid(req), parseCloseTaskComplete(req.body))));
  r.post('/periods/:id/tasks/:taskId/reopen', idempotent, (req, res) => ok(res, c.reopenTask(req.actor, pid(req), tid(req), parseJournalReason(req.body))));
  r.post('/periods/:id/locks', idempotentRequired, (req, res) => ok(res, c.lock(req.actor, pid(req), parseCloseLock(req.body))));
  r.post('/periods/:id/submit', idempotentRequired, (req, res) => ok(res, c.submit(req.actor, pid(req)), 202));
  r.post('/periods/:id/withdraw', idempotent, (req, res) => ok(res, c.withdraw(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/periods/:id/cancel', idempotent, (req, res) => ok(res, c.cancel(req.actor, pid(req), parseJournalReason(req.body))));
  r.get('/periods/:id/history', (req, res) => ok(res, c.history(req.actor, pid(req))));
  r.get('/periods/:id/print', (req, res) => file(res, c.print(req.actor, pid(req))));
  r.post('/periods/:id/reopen', idempotentRequired, (req, res) => ok(res, ro.request(req.actor, pid(req), parseCloseReopen(req.body)), 202));
  r.get('/period-reopens/:id', (req, res) => ok(res, ro.get(req.actor, pid(req))));
  r.post('/period-reopens/:id/withdraw', idempotent, (req, res) => ok(res, ro.withdraw(req.actor, pid(req), parseJournalReason(req.body))));
  return r;
}
