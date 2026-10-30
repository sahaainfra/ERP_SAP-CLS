import { Router } from 'express';
import { requirePermission } from '../../../platform/auth/index.js';
import { createJobController } from './controller.js';

export function jobRoutes(service, { idempotentRequired }) {
  const c = createJobController(service);
  const r = Router();
  r.get('/jobs/types', requirePermission('core.jobs.view'), c.types);
  r.get('/jobs', requirePermission('core.jobs.view'), c.list);
  r.get('/jobs/:id', requirePermission('core.jobs.view'), c.get);
  r.post('/jobs/:id/cancel', requirePermission('core.jobs.manage'), idempotentRequired, c.cancel);
  r.post('/jobs/:id/retry', requirePermission('core.jobs.manage'), idempotentRequired, c.retry);
  r.get('/schedules/preview', requirePermission('core.schedule.view'), c.preview);
  r.get('/schedules', requirePermission('core.schedule.view'), c.schedules);
  r.post('/schedules/:id/change-requests', requirePermission('core.schedule.manage'), idempotentRequired, c.requestChange);
  return r;
}
