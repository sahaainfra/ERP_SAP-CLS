import { Router } from 'express';
import {
  parseAssignmentCreate, parseAssignmentEnd, parseAssignmentList, parseBoard, parseChangeCreate, parseChangeList, parseEvaluate, parseId, parseMine, parsePeriodDef, parsePeriodList, parsePolicyAmend, parsePolicyCreate, parsePolicyUpdate, parseReason,
  parseResolve, parseRosterCreate, parseRosterEnd, parseRosterList, parseShiftCreate, parseShiftUpdate, parseSubmit,
} from './att-validators.js';

/** Part 07.04: shifts, attendance policies, assignments, rosters and changes, attendance periods. Rights and scope are checked in the service. */
export function attRoutes({ att: s, exportsOf }, { idempotent, idempotentRequired }) {
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
  r.get('/att/shifts', (req, res) => res.json(s.shifts.list(req.actor, req.query)));
  r.get('/att/shifts/active', (req, res) => ok(res, s.shifts.all(req.actor)));
  r.get('/att/shifts/export', exportOf('att.shifts'));
  r.post('/att/shifts', idempotentRequired, (req, res) => ok(res, s.shifts.create(req.actor, parseShiftCreate(req.body)), 201));
  r.get('/att/shifts/:id', (req, res) => ok(res, s.shifts.get(req.actor, parseId(req.params.id))));
  r.patch('/att/shifts/:id', idempotent, (req, res) => ok(res, s.shifts.update(req.actor, parseId(req.params.id), parseShiftUpdate(req.body))));

  r.get('/att/policies', (req, res) => res.json(s.policies.list(req.actor, req.query)));
  r.get('/att/policies/export', exportOf('att.policies'));
  r.get('/att/policies/codes', (req, res) => ok(res, s.policies.codes(req.actor)));
  r.post('/att/policies', idempotentRequired, (req, res) => ok(res, s.policies.create(req.actor, parsePolicyCreate(req.body)), 201));
  r.get('/att/policies/:id', (req, res) => ok(res, s.policies.get(req.actor, parseId(req.params.id))));
  r.patch('/att/policies/:id', idempotent, (req, res) => ok(res, s.policies.update(req.actor, parseId(req.params.id), parsePolicyUpdate(req.body))));
  r.delete('/att/policies/:id', (req, res) => ok(res, s.policies.remove(req.actor, parseId(req.params.id))));
  r.post('/att/policies/:id/submit', idempotentRequired, (req, res) => ok(res, s.policies.submit(req.actor, parseId(req.params.id), parseSubmit(req.body)), 202));
  r.post('/att/policies/:id/withdraw', idempotent, (req, res) => ok(res, s.policies.withdraw(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/att/policies/:id/cancel', idempotent, (req, res) => ok(res, s.policies.cancel(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/att/policies/:id/amend', idempotentRequired, (req, res) => ok(res, s.policies.amend(req.actor, parseId(req.params.id), parsePolicyAmend(req.body)), 201));
  r.get('/att/policies/:id/compare', (req, res) => ok(res, s.policies.compare(req.actor, parseId(req.params.id))));
  r.get('/att/policies/:id/print', (req, res) => html(res, s.policies.print(req.actor, parseId(req.params.id))));
  r.post('/att/evaluate', (req, res) => ok(res, s.evaluate(req.actor, parseEvaluate(req.body))));

  r.get('/att/assignments', (req, res) => ok(res, s.assignments.list(req.actor, parseAssignmentList(req.query))));
  r.post('/att/assignments', idempotentRequired, (req, res) => ok(res, s.assignments.create(req.actor, parseAssignmentCreate(req.body)), 201));
  r.post('/att/assignments/:id/end', idempotent, (req, res) => ok(res, s.assignments.end(req.actor, parseId(req.params.id), parseAssignmentEnd(req.body))));
  r.get('/att/resolve', (req, res) => { const q = parseResolve(req.query); ok(res, s.resolve(req.actor, q.employeeId, q.date)); });
  r.get('/att/my-shift', (req, res) => ok(res, s.mine(req.actor, parseMine(req.query))));

  r.get('/att/rosters', (req, res) => ok(res, s.rosters.list(req.actor, parseRosterList(req.query))));
  r.get('/att/roster-board', (req, res) => ok(res, s.rosters.board(req.actor, parseBoard(req.query))));
  r.post('/att/rosters', idempotentRequired, (req, res) => ok(res, s.rosters.create(req.actor, parseRosterCreate(req.body)), 201));
  r.post('/att/rosters/:id/end', idempotent, (req, res) => ok(res, s.rosters.end(req.actor, parseId(req.params.id), parseRosterEnd(req.body))));
  r.get('/att/roster-changes', (req, res) => ok(res, s.rosterChanges.list(req.actor, parseChangeList(req.query))));
  r.post('/att/roster-changes', idempotentRequired, (req, res) => ok(res, s.rosterChanges.create(req.actor, parseChangeCreate(req.body)), 201));
  r.get('/att/roster-changes/:id', (req, res) => ok(res, s.rosterChanges.get(req.actor, parseId(req.params.id))));
  r.post('/att/roster-changes/:id/submit', idempotentRequired, (req, res) => ok(res, s.rosterChanges.submit(req.actor, parseId(req.params.id)), 202));
  r.post('/att/roster-changes/:id/withdraw', idempotent, (req, res) => ok(res, s.rosterChanges.withdraw(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/att/roster-changes/:id/cancel', idempotent, (req, res) => ok(res, s.rosterChanges.cancel(req.actor, parseId(req.params.id), parseReason(req.body))));

  r.get('/att/period', (req, res) => ok(res, s.periods.def(req.actor)));
  r.put('/att/period', idempotent, (req, res) => ok(res, s.periods.setDef(req.actor, parsePeriodDef(req.body))));
  r.get('/att/periods', (req, res) => ok(res, s.periods.list(req.actor, parsePeriodList(req.query))));
  r.post('/att/periods/:id/close', idempotent, (req, res) => ok(res, s.periods.close(req.actor, parseId(req.params.id))));
  return r;
}
