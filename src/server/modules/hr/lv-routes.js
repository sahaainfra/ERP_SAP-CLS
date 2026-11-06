import { Router } from 'express';
import { badRequest } from '../../platform/http/errors.js';
import {
  parseAccrual, parseAdjust, parseAppCreate, parseAppUpdate, parseBalanceQuery, parseBulk, parseCalendar, parseCheck, parseId, parseReason, parseSubmit, parseTypeCreate, parseTypeOptions, parseTypeUpdate, parseYear, parseYearRun,
} from './lv-validators.js';

/** Part 07.07: leave. Rights and scope are checked in the service. */
export function leaveRoutes({ lv, exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const html = (res, body) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(body);
  const exportOf = (code) => (req, res) => {
    const svc = exportsOf();
    if (!svc) throw new Error('The list export service is not running');
    const out = svc.start(req.actor, code, req.query);
    if (out.kind === 'job') return res.status(202).json({ data: out });
    res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' });
    return res.send(out.buffer);
  };
  const a = lv.applications;
  r.get('/applications', (req, res) => res.json(lv.register.list(req.actor, req.query)));
  r.get('/applications/export', exportOf('hr.leave_applications'));
  r.post('/applications', idempotentRequired, (req, res) => ok(res, a.create(req.actor, parseAppCreate(req.body)), 201));
  r.get('/applications/:id', (req, res) => ok(res, a.get(req.actor, parseId(req.params.id))));
  r.patch('/applications/:id', idempotent, (req, res) => ok(res, a.update(req.actor, parseId(req.params.id), parseAppUpdate(req.body))));
  r.delete('/applications/:id', (req, res) => ok(res, a.remove(req.actor, parseId(req.params.id))));
  r.post('/applications/:id/submit', idempotentRequired, (req, res) => ok(res, a.submit(req.actor, parseId(req.params.id), parseSubmit(req.body)), 202));
  r.post('/applications/:id/withdraw', idempotent, (req, res) => ok(res, a.withdraw(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/applications/:id/cancel', idempotent, (req, res) => ok(res, a.cancel(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/applications/:id/amend', idempotentRequired, (req, res) => ok(res, a.amend(req.actor, parseId(req.params.id), parseReason(req.body)), 201));
  r.get('/applications/:id/history', (req, res) => ok(res, a.history(req.actor, parseId(req.params.id))));
  r.get('/applications/:id/print', (req, res) => html(res, a.print(req.actor, parseId(req.params.id))));
  r.get('/leave/check', (req, res) => ok(res, lv.check(req.actor, parseCheck(req.query))));
  r.get('/leave/my', (req, res) => ok(res, lv.mine(req.actor, parseBalanceQuery(req.query).year)));
  r.get('/leave/types', (req, res) => ok(res, lv.types.list(req.actor)));
  r.get('/leave/type-options', (req, res) => ok(res, lv.types.options(req.actor, parseTypeOptions(req.query).employeeId)));
  r.post('/leave/types', idempotentRequired, (req, res) => ok(res, lv.types.create(req.actor, parseTypeCreate(req.body)), 201));
  r.patch('/leave/types/:id', idempotent, (req, res) => ok(res, lv.types.update(req.actor, parseId(req.params.id), parseTypeUpdate(req.body))));
  r.get('/leave/balance', (req, res) => { const q = parseBalanceQuery(req.query); if (!q.employeeId) throw badRequest('Some fields are not valid.', [{ field: 'employeeId', message: 'Name the employee' }]); ok(res, lv.balances.of(req.actor, q.employeeId, q.year)); });
  r.get('/leave/ledger', (req, res) => { const q = parseBalanceQuery(req.query); if (!q.employeeId) throw badRequest('Some fields are not valid.', [{ field: 'employeeId', message: 'Name the employee' }]); ok(res, lv.balances.ledger(req.actor, q.employeeId, q)); });
  r.get('/leave/balances', (req, res) => res.json(lv.balances.list(req.actor, req.query)));
  r.get('/leave/balances/export', exportOf('lv.balances'));
  r.get('/leave/adjustments', (req, res) => ok(res, lv.adjustments.list(req.actor)));
  r.post('/leave/adjustments', idempotentRequired, (req, res) => ok(res, lv.adjustments.create(req.actor, parseAdjust(req.body)), 201));
  r.get('/leave/adjustments/:id', (req, res) => ok(res, lv.adjustments.get(req.actor, parseId(req.params.id))));
  r.post('/leave/adjustments/:id/submit', idempotentRequired, (req, res) => ok(res, lv.adjustments.submit(req.actor, parseId(req.params.id)), 202));
  r.post('/leave/adjustments/:id/cancel', idempotent, (req, res) => ok(res, lv.adjustments.cancel(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.get('/leave/calendar', (req, res) => ok(res, lv.calendar.get(req.actor, parseCalendar(req.query))));
  r.get('/leave/approvals', (req, res) => ok(res, lv.approvals.list(req.actor)));
  r.post('/leave/approvals/bulk', idempotentRequired, (req, res) => ok(res, lv.approvals.bulk(req.actor, parseBulk(req.body))));
  r.post('/leave/accrual/run', idempotentRequired, (req, res) => ok(res, lv.runAccrual(req.actor, parseAccrual(req.body))));
  r.get('/leave/year-end', (req, res) => ok(res, lv.yearEnd.runs(req.actor)));
  r.get('/leave/year-end/preview', (req, res) => ok(res, lv.yearEnd.preview(req.actor, parseYear(req.query).year)));
  r.post('/leave/year-end', idempotentRequired, (req, res) => ok(res, lv.yearEnd.run(req.actor, parseYearRun(req.body).year), 201));
  return r;
}
