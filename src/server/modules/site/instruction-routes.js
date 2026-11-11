import { Router } from 'express';
import { parseAckAct, parseAckAdd, parseComply, parseId, parseInstructionClose, parseInstructionCreate, parseInstructionQ, parseInstructionUpdate, parseReason, parseVariationDecision } from './validators.js';

/** /api/v1/site/instructions: site instructions and memos (part 14.04). Rights and scope are checked in the services. */
export function instructionRoutes(svc, { exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router(); const i = svc.instructionsSvc.instructions;
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pid = (req) => parseId(req.params.id); const aid = (req) => parseId(req.params.ackId);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(out.buffer);
  r.get('/', (req, res) => res.json(i.list(req.actor, req.query)));
  r.get('/export', async (req, res, next) => { try { const out = await exportsOf().start(req.actor, 'site.instructions', req.query); if (out.job) return res.status(202).json({ data: out.job }); return res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' }).send(out.buffer); } catch (e) { return next(e); } });
  r.get('/sites', (req, res) => ok(res, i.sites(req.actor)));
  r.get('/options', (req, res) => ok(res, i.options(req.actor, parseInstructionQ(req.query).siteId)));
  r.get('/tracker', (req, res) => ok(res, i.tracker(req.actor, parseInstructionQ(req.query))));
  r.post('/', idempotentRequired, (req, res) => ok(res, i.create(req.actor, parseInstructionCreate(req.body)), 201));
  r.get('/:id', (req, res) => ok(res, i.get(req.actor, pid(req))));
  r.patch('/:id', idempotent, (req, res) => ok(res, i.update(req.actor, pid(req), parseInstructionUpdate(req.body))));
  r.delete('/:id', (req, res) => ok(res, i.remove(req.actor, pid(req))));
  r.post('/:id/submit', idempotentRequired, (req, res) => ok(res, i.submit(req.actor, pid(req)), 202));
  r.post('/:id/withdraw', idempotent, (req, res) => ok(res, i.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/:id/cancel', idempotent, (req, res) => ok(res, i.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/:id/amend', idempotentRequired, (req, res) => ok(res, i.amend(req.actor, pid(req), parseReason(req.body)), 201));
  r.post('/:id/close', idempotentRequired, (req, res) => ok(res, i.close(req.actor, pid(req), parseInstructionClose(req.body))));
  r.post('/:id/variation-decision', idempotentRequired, (req, res) => ok(res, i.variationDecision(req.actor, pid(req), parseVariationDecision(req.body))));
  r.post('/:id/recipients', idempotent, (req, res) => ok(res, i.addParties(req.actor, pid(req), parseAckAdd(req.body)), 201));
  r.post('/:id/recipients/:ackId/acknowledge', idempotentRequired, (req, res) => ok(res, i.acknowledge(req.actor, pid(req), aid(req), parseAckAct(req.body))));
  r.post('/:id/recipients/:ackId/comply', idempotentRequired, (req, res) => ok(res, i.comply(req.actor, pid(req), aid(req), parseComply(req.body))));
  r.get('/:id/history', (req, res) => ok(res, i.history(req.actor, pid(req))));
  r.get('/:id/print', (req, res) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(i.print(req.actor, pid(req))));
  r.get('/:id/pdf', (req, res) => file(res, i.pdf(req.actor, pid(req))));
  return r;
}
