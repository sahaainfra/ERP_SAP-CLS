import { notFound } from '../../platform/http/errors.js';
import { parseDeclQuery, parseDeclaration, parseFy, parseHold, parseInput, parseInputQuery, parseReadiness, parseRunCreate, parseVerify, parseArrears, parseAssignment, parseAssignmentUpdate, parseCalendarGen, parseCalendarQuery, parseCalendarUpdate, parseComponent, parseEmpQuery, parseFormulaTest, parseId, parsePreview, parseReason, parseStatParam, parseStatParamUpdate, parseStatQuery, parseStructure } from './validators.js';

/** Part 24.01: payroll set-up under /api/v1/pay, behind ff.pay.p2401. Rights are checked in the services. */
export function setupRoutes(r, s, { idempotent, idempotentRequired, flags }) {
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const file = (res, f) => res.status(200).set({ 'content-type': f.contentType, 'content-disposition': `attachment; filename="${f.fileName}"`, 'cache-control': 'no-store' }).send(f.buffer);
  const pid = (req) => parseId(req.params.id);
  r.use(['/components', '/structures', '/assignments', '/arrears', '/statutory-params', '/calendar', '/employees'], (req, _res, next) => (flags.isOn(req.actor, 'ff.pay.p2401') ? next() : next(notFound('Payroll set-up is not enabled for your company yet (feature flag ff.pay.p2401 is OFF).'))));
  r.get('/components', (req, res) => ok(res, s.components.list(req.actor)));
  r.post('/components', idempotentRequired, (req, res) => ok(res, s.components.save(req.actor, parseComponent(req.body))));
  r.post('/components/test', (req, res) => ok(res, s.components.test(req.actor, parseFormulaTest(req.body))));
  r.get('/structures', (req, res) => ok(res, s.structures.list(req.actor, { status: req.query.status === 'ALL' ? 'ALL' : 'ACTIVE' })));
  r.post('/structures', idempotentRequired, (req, res) => ok(res, s.structures.save(req.actor, parseStructure(req.body))));
  r.post('/structures/preview', (req, res) => ok(res, s.structures.preview(req.actor, parsePreview(req.body))));
  r.get('/structures/:id', (req, res) => ok(res, s.structures.get(req.actor, pid(req))));
  r.get('/employees', (req, res) => ok(res, s.assignments.employees(req.actor, parseEmpQuery(req.query))));
  r.get('/arrears', (req, res) => ok(res, s.assignments.arrears(req.actor, parseArrears(req.query))));
  r.get('/assignments', (req, res) => res.json(s.assignments.list(req.actor, req.query)));
  r.get('/assignments/export', (req, res) => file(res, s.assignments.exportCsv(req.actor, req.query)));
  r.post('/assignments', idempotentRequired, (req, res) => ok(res, s.assignments.create(req.actor, parseAssignment(req.body)), 201));
  r.get('/assignments/:id', (req, res) => ok(res, s.assignments.get(req.actor, pid(req))));
  r.patch('/assignments/:id', idempotent, (req, res) => ok(res, s.assignments.update(req.actor, pid(req), parseAssignmentUpdate(req.body))));
  r.delete('/assignments/:id', (req, res) => ok(res, s.assignments.remove(req.actor, pid(req))));
  r.post('/assignments/:id/submit', idempotentRequired, (req, res) => ok(res, s.assignments.submit(req.actor, pid(req)), 202));
  r.post('/assignments/:id/withdraw', idempotent, (req, res) => ok(res, s.assignments.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/assignments/:id/cancel', idempotent, (req, res) => ok(res, s.assignments.cancel(req.actor, pid(req), parseReason(req.body))));
  r.get('/assignments/:id/history', (req, res) => ok(res, s.assignments.history(req.actor, pid(req))));
  r.get('/assignments/:id/print', (req, res) => file(res, s.assignments.print(req.actor, pid(req))));
  r.get('/statutory-params', (req, res) => ok(res, s.statutoryParams.list(req.actor, parseStatQuery(req.query))));
  r.post('/statutory-params', idempotentRequired, (req, res) => ok(res, s.statutoryParams.create(req.actor, parseStatParam(req.body)), 201));
  r.get('/statutory-params/:id', (req, res) => ok(res, s.statutoryParams.get(req.actor, pid(req))));
  r.patch('/statutory-params/:id', idempotent, (req, res) => ok(res, s.statutoryParams.update(req.actor, pid(req), parseStatParamUpdate(req.body))));
  r.delete('/statutory-params/:id', (req, res) => ok(res, s.statutoryParams.remove(req.actor, pid(req))));
  r.post('/statutory-params/:id/submit', idempotentRequired, (req, res) => ok(res, s.statutoryParams.submit(req.actor, pid(req)), 202));
  r.post('/statutory-params/:id/withdraw', idempotent, (req, res) => ok(res, s.statutoryParams.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/statutory-params/:id/cancel', idempotent, (req, res) => ok(res, s.statutoryParams.cancel(req.actor, pid(req), parseReason(req.body))));
  r.get('/calendar', (req, res) => ok(res, s.calendar.list(req.actor, parseCalendarQuery(req.query))));
  r.post('/calendar/generate', idempotentRequired, (req, res) => ok(res, s.calendar.generate(req.actor, parseCalendarGen(req.body))));
  r.patch('/calendar/:id', idempotent, (req, res) => ok(res, s.calendar.update(req.actor, pid(req), parseCalendarUpdate(req.body))));
  return r;
}

/** Part 24.02: payroll runs, inputs and tax declarations under /api/v1/pay, behind ff.pay.p2402. */
export function runRoutes(r, s, { idempotent, idempotentRequired, flags }) {
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const file = (res, f) => res.status(200).set({ 'content-type': f.contentType, 'content-disposition': `attachment; filename="${f.fileName}"`, 'cache-control': 'no-store' }).send(f.buffer);
  const pid = (req) => parseId(req.params.id);
  r.use(['/runs', '/inputs', '/declarations'], (req, _res, next) => (flags.isOn(req.actor, 'ff.pay.p2402') ? next() : next(notFound('Payroll runs are not enabled for your company yet (feature flag ff.pay.p2402 is OFF).'))));
  r.get('/runs/readiness', (req, res) => ok(res, s.runs.readiness(req.actor, parseReadiness(req.query))));
  r.get('/runs', (req, res) => res.json(s.runs.list(req.actor, req.query)));
  r.post('/runs', idempotentRequired, (req, res) => ok(res, s.runs.create(req.actor, parseRunCreate(req.body)), 201));
  r.get('/runs/:id', (req, res) => ok(res, s.runs.get(req.actor, pid(req))));
  r.delete('/runs/:id', (req, res) => ok(res, s.runs.remove(req.actor, pid(req))));
  r.post('/runs/:id/compute', idempotent, (req, res) => ok(res, s.runs.recompute(req.actor, pid(req))));
  r.post('/runs/:id/lines/:lineId/hold', idempotent, (req, res) => ok(res, s.runs.hold(req.actor, pid(req), parseId(req.params.lineId), parseHold(req.body))));
  r.post('/runs/:id/submit', idempotentRequired, (req, res) => ok(res, s.runs.submit(req.actor, pid(req)), 202));
  r.post('/runs/:id/withdraw', idempotent, (req, res) => ok(res, s.runs.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/runs/:id/cancel', idempotent, (req, res) => ok(res, s.runs.cancel(req.actor, pid(req), parseReason(req.body))));
  r.get('/runs/:id/history', (req, res) => ok(res, s.runs.history(req.actor, pid(req))));
  r.get('/runs/:id/variance', (req, res) => ok(res, s.runs.variance(req.actor, pid(req))));
  r.get('/runs/:id/print', (req, res) => file(res, s.runs.print(req.actor, pid(req))));
  r.get('/runs/:id/export', (req, res) => file(res, s.runs.exportCsv(req.actor, pid(req))));
  r.get('/inputs', (req, res) => ok(res, s.inputs.list(req.actor, parseInputQuery(req.query))));
  r.post('/inputs', idempotentRequired, (req, res) => ok(res, s.inputs.add(req.actor, parseInput(req.body)), 201));
  r.post('/inputs/:id/cancel', idempotent, (req, res) => ok(res, s.inputs.cancel(req.actor, pid(req), parseReason(req.body))));
  r.get('/declarations/mine', (req, res) => ok(res, s.declarations.mine(req.actor, parseFy(req.query))));
  r.post('/declarations/mine', idempotentRequired, (req, res) => ok(res, s.declarations.saveMine(req.actor, parseDeclaration(req.body))));
  r.get('/declarations', (req, res) => ok(res, s.declarations.list(req.actor, parseDeclQuery(req.query))));
  r.post('/declarations/:id/verify', idempotentRequired, (req, res) => ok(res, s.declarations.verify(req.actor, pid(req), parseVerify(req.body))));
  return r;
}
