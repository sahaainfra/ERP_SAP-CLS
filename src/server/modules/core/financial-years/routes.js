import { Router } from 'express';
import { requirePermission } from '../../../platform/auth/index.js';
import { createFinancialYearController } from './controller.js';

export function financialYearRoutes(service, { idempotent, idempotentRequired }) {
  const c = createFinancialYearController(service);
  const r = Router();
  r.get('/financial-years', requirePermission('core.fy.view'), c.list);
  r.post('/financial-years', requirePermission('core.fy.configure'), idempotent, c.create);
  r.get('/financial-years/:id', requirePermission('core.fy.view'), c.get);
  r.post('/financial-years/:id/close', requirePermission('core.period.manage'), idempotentRequired, c.close);
  r.post('/periods/:id/status', requirePermission('core.period.manage'), c.setStatus);
  r.post('/period-reopen-requests', requirePermission('core.period.request_reopen'), idempotentRequired, c.requestReopen);
  return r;
}
