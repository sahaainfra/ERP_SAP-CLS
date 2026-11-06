import { Router } from 'express';
import {
  parseArrearsQuery, parseBulk, parseDayQuery, parseId, parseLock, parseLockStatus, parsePeriodLock, parsePeriodReopen, parseManualCreate, parseManualUpdate, parseMusterQuery, parseOtCreate, parseOtUpdate, parseReason, parseRecompute, parseRegCreate, parseRegUpdate,
  parseRegisterQuery, parseReopen, parseSubmit,
} from './reg-validators.js';

/** Part 07.06: the attendance register, regularisation, overtime and manual entries, the period lock and arrears. Rights and scope are checked in the services. */
export function registerRoutes({ reg, req: rq, exportsOf }, { idempotent, idempotentRequired }) {
  const hr = Router(); const att = Router();
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
  // the three kinds of request share one set of routes
  const doc = (path, kind, create, update, exportCode) => {
    const s = rq[kind]; const list = rq.registers[kind];
    hr.get(`/${path}`, (req, res) => res.json(list.list(req.actor, req.query)));
    hr.get(`/${path}/export`, exportOf(exportCode));
    hr.post(`/${path}`, idempotentRequired, (req, res) => ok(res, s.create(req.actor, create(req.body)), 201));
    hr.get(`/${path}/:id`, (req, res) => ok(res, s.get(req.actor, parseId(req.params.id))));
    hr.patch(`/${path}/:id`, idempotent, (req, res) => ok(res, s.update(req.actor, parseId(req.params.id), update(req.body))));
    hr.delete(`/${path}/:id`, (req, res) => ok(res, s.remove(req.actor, parseId(req.params.id))));
    hr.post(`/${path}/:id/submit`, idempotentRequired, (req, res) => ok(res, s.submit(req.actor, parseId(req.params.id), parseSubmit(req.body)), 202));
    hr.post(`/${path}/:id/withdraw`, idempotent, (req, res) => ok(res, s.withdraw(req.actor, parseId(req.params.id), parseReason(req.body))));
    hr.post(`/${path}/:id/cancel`, idempotent, (req, res) => ok(res, s.cancel(req.actor, parseId(req.params.id), parseReason(req.body))));
    hr.post(`/${path}/:id/amend`, idempotentRequired, (req, res) => ok(res, s.amend(req.actor, parseId(req.params.id), parseReason(req.body)), 201));
    hr.get(`/${path}/:id/history`, (req, res) => ok(res, s.history(req.actor, parseId(req.params.id))));
    hr.get(`/${path}/:id/print`, (req, res) => html(res, s.print(req.actor, parseId(req.params.id))));
  };
  doc('regularisations', 'regularisation', parseRegCreate, parseRegUpdate, 'hr.regularisations');
  doc('overtime-requests', 'overtime', parseOtCreate, parseOtUpdate, 'hr.overtime_requests');
  doc('manual-entries', 'manual', parseManualCreate, parseManualUpdate, 'att.manual_entries');

  att.get('/register', (req, res) => ok(res, reg.register(req.actor, parseRegisterQuery(req.query))));
  att.get('/register/export', exportOf('att.register'));
  att.get('/register/print', (req, res) => html(res, reg.printRegister(req.actor, parseRegisterQuery(req.query), false)));
  att.get('/muster', (req, res) => ok(res, reg.muster(req.actor, parseMusterQuery(req.query))));
  att.get('/muster/export', exportOf('att.muster'));
  att.get('/muster/print', (req, res) => html(res, reg.printRegister(req.actor, parseMusterQuery(req.query), true)));
  att.get('/daily', (req, res) => res.json(reg.daily.list(req.actor, req.query)));
  att.get('/daily/export', exportOf('att.daily'));
  att.get('/day', (req, res) => { const q = parseDayQuery(req.query); ok(res, reg.dayDetail(req.actor, q.employeeId, q.date)); });
  att.post('/recompute', idempotentRequired, (req, res) => ok(res, reg.recompute(req.actor, parseRecompute(req.body))));
  att.get('/approvals', (req, res) => ok(res, rq.approvals.list(req.actor)));
  att.post('/approvals/bulk', idempotentRequired, (req, res) => ok(res, rq.approvals.bulk(req.actor, parseBulk(req.body))));
  att.get('/periods/status', (req, res) => ok(res, reg.locks.status(req.actor, parseLockStatus(req.query))));
  att.get('/period-locks', (req, res) => ok(res, reg.locks.list(req.actor, parseLockStatus(req.query))));
  att.post('/period-locks', idempotentRequired, (req, res) => ok(res, reg.locks.lock(req.actor, parseLock(req.body)), 201));
  att.get('/period-locks/:id', (req, res) => ok(res, reg.locks.get(req.actor, parseId(req.params.id))));
  att.post('/periods/:id/lock', idempotentRequired, (req, res) => ok(res, reg.locks.lock(req.actor, { ...parsePeriodLock(req.body), periodId: parseId(req.params.id) }), 201));
  att.post('/periods/:id/reopen', idempotentRequired, (req, res) => ok(res, reg.locks.reopenPeriod(req.actor, parseId(req.params.id), parsePeriodReopen(req.body)), 202));
  att.post('/period-locks/:id/reopen', idempotentRequired, (req, res) => ok(res, reg.locks.reopen(req.actor, parseId(req.params.id), parseReopen(req.body)), 202));
  att.get('/arrears', (req, res) => ok(res, reg.arrears.list(req.actor, parseArrearsQuery(req.query))));
  return { hr, att };
}
