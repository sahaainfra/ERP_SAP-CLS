import { Router } from 'express';
import { requirePermission } from '../../../platform/auth/index.js';
import { createEventController } from './controller.js';

/** Events console. Re-driving, discarding and replaying change data, so they need an Idempotency-Key. */
export function eventRoutes(service, { idempotentRequired }) {
  const c = createEventController(service);
  const r = Router();
  r.get('/events/metrics', requirePermission('core.events.view'), c.metrics);
  r.get('/events/types', requirePermission('core.events.view'), c.types);
  r.get('/events/consumers', requirePermission('core.events.view'), c.consumers);
  r.get('/events/dlq', requirePermission('core.events.view'), c.dlq);
  r.post('/events/dlq/:id/redrive', requirePermission('core.events.redrive'), idempotentRequired, c.redrive);
  r.post('/events/dlq/:id/discard', requirePermission('core.events.redrive'), idempotentRequired, c.discard);
  r.post('/events/replay', requirePermission('core.events.replay'), idempotentRequired, c.replay);
  r.get('/events', requirePermission('core.events.view'), c.list);
  return r;
}
