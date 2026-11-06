import { Router } from 'express';
import {
  parseAdvanceCreate, parseAdvanceUpdate, parseAnalysis, parseBulk, parseClaimCreate, parseClaimPreview, parseClaimUpdate, parseDisburse, parseDue, parseId, parsePaid, parsePolicy, parseReason, parseRecover, parseSubmit, parseTravelCreate, parseTravelUpdate,
} from './exp-validators.js';

/** Part 07.12: travel requests, advances, expense claims, the policies and the approvals worklist. Rights, the reporting line and the policy checks are in the service. */
export function expRoutes({ exp, exportsOf }, { idempotent, idempotentRequired }) {
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
  const crud = (base, svc, code, parseCreate) => {
    r.get(`/${base}`, (req, res) => res.json(svc.list(req.actor, req.query)));
    r.get(`/${base}/export`, exportOf(code));
    r.post(`/${base}`, idempotentRequired, (req, res) => ok(res, svc.create(req.actor, parseCreate(req.body)), 201));
  };
  const rest = (base, svc, parseUpdate) => {
    r.get(`/${base}/:id`, (req, res) => ok(res, svc.get(req.actor, parseId(req.params.id))));
    r.patch(`/${base}/:id`, idempotent, (req, res) => ok(res, svc.update(req.actor, parseId(req.params.id), parseUpdate(req.body))));
    r.delete(`/${base}/:id`, (req, res) => ok(res, svc.remove(req.actor, parseId(req.params.id))));
    r.post(`/${base}/:id/submit`, idempotentRequired, (req, res) => ok(res, svc.submit(req.actor, parseId(req.params.id), parseSubmit(req.body)), 202));
    r.post(`/${base}/:id/withdraw`, idempotent, (req, res) => ok(res, svc.withdraw(req.actor, parseId(req.params.id), parseReason(req.body))));
    r.post(`/${base}/:id/cancel`, idempotent, (req, res) => ok(res, svc.cancel(req.actor, parseId(req.params.id), parseReason(req.body))));
    r.get(`/${base}/:id/history`, (req, res) => ok(res, svc.history(req.actor, parseId(req.params.id))));
    r.get(`/${base}/:id/print`, (req, res) => html(res, svc.print(req.actor, parseId(req.params.id))));
  };
  crud('travel-requests', exp.travel, 'hr.travel_requests', parseTravelCreate);
  rest('travel-requests', exp.travel, parseTravelUpdate);
  crud('advances', exp.advances, 'hr.advances', parseAdvanceCreate);
  r.get('/advances/recoveries', (req, res) => ok(res, exp.advances.recoveries.due(req.actor, parseDue(req.query))));
  r.post('/advances/recoveries/:id/recover', idempotentRequired, (req, res) => ok(res, exp.advances.recoveries.recover(req.actor, parseId(req.params.id), parseRecover(req.body))));
  rest('advances', exp.advances, parseAdvanceUpdate);
  r.post('/advances/:id/disburse', idempotentRequired, (req, res) => ok(res, exp.advances.disburse(req.actor, parseId(req.params.id), parseDisburse(req.body))));
  crud('claims', exp.claims, 'hr.claims', parseClaimCreate);
  r.post('/claims/preview', (req, res) => ok(res, exp.claims.preview(req.actor, parseClaimPreview(req.body))));
  rest('claims', exp.claims, parseClaimUpdate);
  r.post('/claims/:id/pass', idempotentRequired, (req, res) => ok(res, exp.claims.pass(req.actor, parseId(req.params.id))));
  r.post('/claims/:id/paid', idempotentRequired, (req, res) => ok(res, exp.claims.paid(req.actor, parseId(req.params.id), parsePaid(req.body))));
  r.get('/expenses/policies', (req, res) => ok(res, exp.policies.list(req.actor)));
  r.put('/expenses/policies', idempotent, (req, res) => ok(res, exp.policies.save(req.actor, parsePolicy(req.body))));
  r.post('/expenses/policies/:id/activate', idempotentRequired, (req, res) => ok(res, exp.policies.activate(req.actor, parseId(req.params.id))));
  r.post('/expenses/policies/:id/retire', idempotentRequired, (req, res) => ok(res, exp.policies.retire(req.actor, parseId(req.params.id))));
  r.get('/expenses/policies/:id/history', (req, res) => ok(res, exp.policies.history(req.actor, parseId(req.params.id))));
  r.get('/expenses/approvals', (req, res) => ok(res, exp.approvals.list(req.actor)));
  r.post('/expenses/approvals/bulk', idempotentRequired, (req, res) => ok(res, exp.approvals.bulk(req.actor, parseBulk(req.body))));
  r.get('/expenses/analysis', (req, res) => ok(res, exp.analysis(req.actor, parseAnalysis(req.query))));
  return r;
}
