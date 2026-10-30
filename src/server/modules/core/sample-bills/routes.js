import { Router } from 'express';
import { requirePermission } from '../../../platform/auth/index.js';
import { parseBillAction, parseBillCreate, parseBillId, parseBillList, parseBillUpdate } from './service.js';

/** The sample bill: amounts are always calculated by the engine on the server; submitting is a posting action (Idempotency-Key required). */
export function sampleBillRoutes(service, { idempotent, idempotentRequired }) {
  const r = Router();
  const use = requirePermission('core.sample.use');
  r.get('/sample-bills', use, (req, res) => res.json(service.list(req.actor, parseBillList(req.query))));
  r.post('/sample-bills', use, idempotent, (req, res) => res.status(201).json({ data: service.create(req.actor, parseBillCreate(req.body), req.correlationId) }));
  r.get('/sample-bills/:id', use, (req, res) => res.json({ data: service.get(req.actor, parseBillId(req.params.id)) }));
  r.patch('/sample-bills/:id', use, idempotent, (req, res) => res.json({ data: service.update(req.actor, parseBillId(req.params.id), parseBillUpdate(req.body), req.correlationId) }));
  r.post('/sample-bills/:id/submit', use, idempotentRequired, (req, res) => res.json({ data: service.submit(req.actor, parseBillId(req.params.id), parseBillAction(req.body), req.correlationId) }));
  r.post('/sample-bills/:id/recalculate', use, idempotent, (req, res) => res.json({ data: service.recalculate(req.actor, parseBillId(req.params.id), req.correlationId) }));
  return r;
}
