import { Router } from 'express';
import { requirePermission } from '../../../platform/auth/index.js';
import { createFlagController } from './controller.js';

export function featureFlagRoutes(service) {
  const c = createFlagController(service);
  const r = Router();
  r.get('/feature-flags', requirePermission('core.flag.view'), c.list);
  r.get('/feature-flags/evaluate', c.evaluate);
  r.patch('/feature-flags/:key', requirePermission('core.flag.configure'), c.patch);
  return r;
}
