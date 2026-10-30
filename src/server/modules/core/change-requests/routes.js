import { Router } from 'express';
import { requirePermission } from '../../../platform/auth/index.js';
import { createChangeRequestController } from './controller.js';

/** Deciding a request is an approval action: the Idempotency-Key is required so a retry cannot decide twice. */
export function changeRequestRoutes(service, { idempotentRequired }) {
  const c = createChangeRequestController(service);
  const r = Router();
  r.get('/change-requests', requirePermission('core.requests.view'), c.list);
  r.get('/change-requests/:id', requirePermission('core.requests.view'), c.get);
  r.post('/change-requests/:id/act', requirePermission('core.requests.view'), idempotentRequired, c.act);
  r.post('/change-requests/:id/resubmit', requirePermission('core.requests.view'), idempotentRequired, c.resubmit);
  r.post('/change-requests/:id/withdraw', requirePermission('core.requests.view'), idempotentRequired, c.withdraw);
  return r;
}
