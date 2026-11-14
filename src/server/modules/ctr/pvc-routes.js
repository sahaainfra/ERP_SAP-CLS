import { notFound } from '../../platform/http/errors.js';
import * as v from './validators.js';

/** /api/v1/ctr price variation and liquidated damages: formulas, indices, escalation computations and the LD exposure (part 21.07, flag ff.ctr.p2107). */
export function pvcRoutes(r, svc, { ok, pid, file, idempotent, idempotentRequired, flags }) {
  const { pvcIndices: ix, pvcFormulas: fm, escalations: es, ld } = svc; const q = (req) => req.query;
  r.use(['/pvc-formulas', '/pvc-indices', '/escalations', '/ld-exposure', '/ld-assessments'], (req, _res, next) => (flags.isOn(req.actor, 'ff.ctr.p2107') ? next() : next(notFound('Price variation and liquidated damages are not enabled for your company yet.'))));
  r.get('/pvc-indices', (req, res) => ok(res, ix.list(req.actor, v.parseIndexQ(q(req)).code)));
  r.put('/pvc-indices', idempotent, (req, res) => ok(res, ix.set(req.actor, v.parseIndexSet(req.body))));
  r.get('/pvc-formulas', (req, res) => ok(res, fm.list(req.actor, { projectId: q(req).projectId ? v.parseId(q(req).projectId) : undefined })));
  r.put('/pvc-formulas', idempotent, (req, res) => ok(res, fm.set(req.actor, v.parsePvcFormula(req.body)), 201));
  r.get('/pvc-formulas/:id', (req, res) => ok(res, fm.get(req.actor, pid(req))));
  r.get('/escalations/export', (req, res) => file(res, es.exportCsv(req.actor)));
  r.get('/escalations', (req, res) => res.json(es.list(req.actor, q(req))));
  r.post('/escalations', idempotentRequired, (req, res) => ok(res, es.create(req.actor, v.parseEscCreate(req.body)), 201));
  r.get('/escalations/:id', (req, res) => ok(res, es.get(req.actor, pid(req))));
  r.patch('/escalations/:id', idempotent, (req, res) => ok(res, es.update(req.actor, pid(req), v.parseEscUpdate(req.body))));
  r.post('/escalations/:id/recompute', idempotentRequired, (req, res) => ok(res, es.recompute(req.actor, pid(req))));
  r.delete('/escalations/:id', (req, res) => ok(res, es.remove(req.actor, pid(req))));
  r.post('/escalations/:id/submit', idempotentRequired, (req, res) => ok(res, es.submit(req.actor, pid(req)), 202));
  r.post('/escalations/:id/withdraw', idempotent, (req, res) => ok(res, es.withdraw(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/escalations/:id/cancel', idempotent, (req, res) => ok(res, es.cancel(req.actor, pid(req), v.parseReason(req.body))));
  r.get('/escalations/:id/history', (req, res) => ok(res, es.history(req.actor, pid(req))));
  r.get('/escalations/:id/print', (req, res) => file(res, es.print(req.actor, pid(req))));
  r.get('/ld-exposure/export', (req, res) => file(res, ld.exportCsv(req.actor)));
  r.get('/ld-exposure', (req, res) => ok(res, ld.exposure(req.actor, v.parseLdQ(q(req)))));
  r.post('/ld-assessments', idempotentRequired, (req, res) => ok(res, ld.assess(req.actor, v.parseLdAssess(req.body)), 201));
  r.post('/ld-assessments/:id/deductions', idempotentRequired, (req, res) => ok(res, ld.recordDeduction(req.actor, pid(req), v.parseLdDeduction(req.body)), 201));
}
