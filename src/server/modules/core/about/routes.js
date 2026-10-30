import { Router } from 'express';
import { requirePermission } from '../../../platform/auth/index.js';
import { createAboutController } from './controller.js';

// Build information for administrators only; never shown on business screens.
export function aboutRoutes(service) {
  const c = createAboutController(service);
  const r = Router();
  r.get('/about', requirePermission('core.about.view'), c.show);
  return r;
}
