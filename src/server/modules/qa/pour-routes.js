import { notFound } from '../../platform/http/errors.js';
import { parseId, parseReason, parsePourCreate, parsePourUpdate, parsePourRecord, parseTicket, parseSampleCreate, parseCubeResult, parseScanQ, parseAcceptanceQ, parseTraceQ } from './validators.js';

/** /api/v1/qa pour cards, cube register, acceptance and traceability (part 18.05, flag ff.qa.p1805). */
export function pourRoutes(r, svc, { ok, pid, file, idempotent, idempotentRequired, flags }) {
  const { cards, samples } = svc; const p = '/pour-cards'; const c = '/cube-samples';
  r.use([p, c, '/concrete-acceptance', '/concrete-traceability', '/cube-results'], (req, _res, next) => (flags.isOn(req.actor, 'ff.qa.p1805') ? next() : next(notFound('Concrete control is not enabled for your company yet.'))));
  r.get('/concrete-acceptance', (req, res) => ok(res, svc.acceptance(req.actor, parseAcceptanceQ(req.query))));
  r.get('/concrete-acceptance/export', (req, res) => file(res, svc.exportCsv(req.actor, { ...parseAcceptanceQ(req.query), kind: 'acceptance' })));
  r.get('/concrete-traceability', (req, res) => ok(res, svc.traceability(req.actor, parseTraceQ(req.query))));
  r.get(`${p}/options`, (req, res) => ok(res, cards.options(req.actor, req.query.projectId ? { projectId: Number(req.query.projectId) } : {})));
  r.get(`${p}/export`, (req, res) => file(res, svc.exportCsv(req.actor, { kind: 'cards' })));
  r.get(p, (req, res) => res.json(cards.list(req.actor, req.query)));
  r.post(p, idempotentRequired, (req, res) => ok(res, cards.create(req.actor, parsePourCreate(req.body)), 201));
  r.get(`${p}/:id`, (req, res) => ok(res, cards.get(req.actor, pid(req))));
  r.patch(`${p}/:id`, idempotent, (req, res) => ok(res, cards.update(req.actor, pid(req), parsePourUpdate(req.body))));
  r.delete(`${p}/:id`, (req, res) => ok(res, cards.remove(req.actor, pid(req))));
  r.post(`${p}/:id/submit`, idempotentRequired, (req, res) => ok(res, cards.submit(req.actor, pid(req)), 202));
  r.post(`${p}/:id/withdraw`, idempotent, (req, res) => ok(res, cards.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post(`${p}/:id/cancel`, idempotent, (req, res) => ok(res, cards.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post(`${p}/:id/amend`, idempotent, (req, res) => ok(res, cards.amend(req.actor, pid(req), parseReason(req.body))));
  r.post(`${p}/:id/record`, idempotent, (req, res) => ok(res, cards.record(req.actor, pid(req), parsePourRecord(req.body))));
  r.post(`${p}/:id/tickets`, idempotentRequired, (req, res) => ok(res, cards.addTicket(req.actor, pid(req), parseTicket(req.body)), 201));
  r.post(`${p}/:id/samples`, idempotentRequired, (req, res) => ok(res, samples.create(req.actor, pid(req), parseSampleCreate(req.body)), 201));
  r.get(`${p}/:id/history`, (req, res) => ok(res, cards.history(req.actor, pid(req))));
  r.get(`${p}/:id/print`, (req, res) => file(res, cards.print(req.actor, pid(req))));
  r.get(`${c}/export`, (req, res) => file(res, svc.exportCsv(req.actor, { kind: 'cubes' })));
  r.get(`${c}/scan`, (req, res) => ok(res, samples.scan(req.actor, parseScanQ(req.query).code)));
  r.get(c, (req, res) => res.json(samples.list(req.actor, req.query)));
  r.get(`${c}/:id`, (req, res) => ok(res, samples.get(req.actor, pid(req))));
  r.get(`${c}/:id/label`, (req, res) => ok(res, samples.label(req.actor, pid(req))));
  r.post(`${c}/:id/cancel`, idempotent, (req, res) => ok(res, samples.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post(`${c}/:id/results`, idempotentRequired, (req, res) => ok(res, samples.addResult(req.actor, pid(req), parseCubeResult(req.body)), 201));
  r.post('/cube-results/:id/raise-ncr', idempotentRequired, (req, res) => ok(res, samples.raiseNcr(req.actor, parseId(req.params.id)), 201));
}
