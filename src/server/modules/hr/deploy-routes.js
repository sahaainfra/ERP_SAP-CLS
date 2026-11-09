import { Router } from 'express';
import {
  parseBoard, parseCrewCreate, parseCrewUpdate, parseDepAmend, parseDepCreate, parseDepPlanCheck, parseDepUpdate, parseEligibility, parseHandover, parseId, parseMember, parseMemberEnd, parseMove, parseReason, parseSitePlan, parseSitePlanQuery,
  parseSubmit, parseTrfAmend, parseTrfCreate, parseTrfUpdate,
} from './deploy-validators.js';

/** Part 07.03: deployments, the board, crews and gangs, the site manpower plan and transfers. Rights and scope are checked in the service. */
export function deployRoutes({ dep: s, trf, exportsOf }, { idempotent, idempotentRequired }) {
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
  r.get('/site-plans', (req, res) => ok(res, s.sitePlans.list(req.actor, parseSitePlanQuery(req.query))));
  r.put('/site-plans', idempotent, (req, res) => ok(res, s.sitePlans.set(req.actor, parseSitePlan(req.body))));
  r.get('/deployment-board', (req, res) => ok(res, s.board.get(req.actor, parseBoard(req.query))));
  r.get('/deployment-board/print', (req, res) => html(res, s.board.print(req.actor, parseBoard(req.query))));
  r.get('/deployments/eligibility', (req, res) => ok(res, s.deployments.eligible(req.actor, parseEligibility(req.query))));
  r.get('/deployments/plan-check', (req, res) => ok(res, s.deployments.planCheck(req.actor, parseDepPlanCheck(req.query))));
  r.get('/deployments', (req, res) => res.json(s.register.list(req.actor, req.query)));
  r.get('/deployments/export', exportOf('hr.deployments'));
  r.post('/deployments', idempotentRequired, (req, res) => ok(res, s.deployments.create(req.actor, parseDepCreate(req.body)), 201));
  r.get('/deployments/:id', (req, res) => ok(res, s.deployments.get(req.actor, parseId(req.params.id))));
  r.patch('/deployments/:id', idempotent, (req, res) => ok(res, s.deployments.update(req.actor, parseId(req.params.id), parseDepUpdate(req.body))));
  r.delete('/deployments/:id', (req, res) => ok(res, s.deployments.remove(req.actor, parseId(req.params.id))));
  r.post('/deployments/:id/submit', idempotentRequired, (req, res) => ok(res, s.deployments.submit(req.actor, parseId(req.params.id), parseSubmit(req.body)), 202));
  r.post('/deployments/:id/withdraw', idempotent, (req, res) => ok(res, s.deployments.withdraw(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/deployments/:id/cancel', idempotent, (req, res) => ok(res, s.deployments.cancel(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/deployments/:id/amend', idempotentRequired, (req, res) => ok(res, s.deployments.amend(req.actor, parseId(req.params.id), parseDepAmend(req.body)), 201));
  r.post('/deployments/:id/move', idempotentRequired, (req, res) => ok(res, s.deployments.move(req.actor, parseId(req.params.id), parseMove(req.body)), 202));
  r.get('/deployments/:id/compare', (req, res) => ok(res, s.deployments.compare(req.actor, parseId(req.params.id))));
  r.get('/deployments/:id/history', (req, res) => ok(res, s.deployments.get(req.actor, parseId(req.params.id)).history));
  r.get('/deployments/:id/print', (req, res) => html(res, s.deployments.print(req.actor, parseId(req.params.id))));
  r.get('/employees/:id/deployments', (req, res) => ok(res, s.deployments.historyOf(req.actor, parseId(req.params.id))));

  r.get('/crews', (req, res) => res.json(s.crews.list(req.actor, req.query)));
  r.post('/crews', idempotentRequired, (req, res) => ok(res, s.crews.create(req.actor, parseCrewCreate(req.body)), 201));
  r.get('/crews/:id', (req, res) => ok(res, s.crews.get(req.actor, parseId(req.params.id))));
  r.patch('/crews/:id', idempotent, (req, res) => ok(res, s.crews.update(req.actor, parseId(req.params.id), parseCrewUpdate(req.body))));
  r.post('/crews/:id/members', idempotent, (req, res) => ok(res, s.crews.addMember(req.actor, parseId(req.params.id), parseMember(req.body)), 201));
  r.post('/crews/:id/members/:memberId/end', idempotent, (req, res) => ok(res, s.crews.endMember(req.actor, parseId(req.params.id), parseId(req.params.memberId), parseMemberEnd(req.body))));

  r.get('/transfers', (req, res) => res.json(trf.register.list(req.actor, req.query)));
  r.get('/transfers/export', exportOf('hr.transfers'));
  r.post('/transfers', idempotentRequired, (req, res) => ok(res, trf.transfers.create(req.actor, parseTrfCreate(req.body)), 201));
  r.get('/transfers/:id', (req, res) => ok(res, trf.transfers.get(req.actor, parseId(req.params.id))));
  r.patch('/transfers/:id', idempotent, (req, res) => ok(res, trf.transfers.update(req.actor, parseId(req.params.id), parseTrfUpdate(req.body))));
  r.delete('/transfers/:id', (req, res) => ok(res, trf.transfers.remove(req.actor, parseId(req.params.id))));
  r.post('/transfers/:id/submit', idempotentRequired, (req, res) => ok(res, trf.transfers.submit(req.actor, parseId(req.params.id), parseSubmit(req.body)), 202));
  r.post('/transfers/:id/withdraw', idempotent, (req, res) => ok(res, trf.transfers.withdraw(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/transfers/:id/cancel', idempotent, (req, res) => ok(res, trf.transfers.cancel(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/transfers/:id/amend', idempotentRequired, (req, res) => ok(res, trf.transfers.amend(req.actor, parseId(req.params.id), parseTrfAmend(req.body)), 201));
  r.put('/transfers/:id/handover', idempotent, (req, res) => ok(res, trf.transfers.handover(req.actor, parseId(req.params.id), parseHandover(req.body))));
  r.get('/transfers/:id/compare', (req, res) => ok(res, trf.transfers.compare(req.actor, parseId(req.params.id))));
  r.get('/transfers/:id/history', (req, res) => ok(res, trf.transfers.get(req.actor, parseId(req.params.id)).history));
  r.get('/transfers/:id/print', (req, res) => html(res, trf.transfers.print(req.actor, parseId(req.params.id))));
  return r;
}
