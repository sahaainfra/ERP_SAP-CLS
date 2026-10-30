import { Router } from 'express';
import { requirePermission } from '../../../platform/auth/index.js';
import { createSettingsController } from './controller.js';

/** Formats needed to display numbers and dates: any signed-in user, and never behind a feature flag. */
export function displaySettingsRoutes(service) {
  const c = createSettingsController(service);
  const r = Router();
  r.get('/display-settings', c.display);
  return r;
}

export function settingsRoutes(service, { idempotent }) {
  const c = createSettingsController(service);
  const r = Router();
  r.get('/company-settings', requirePermission('core.settings.view'), c.get);
  r.put('/company-settings', requirePermission('core.settings.configure'), idempotent, c.save);
  return r;
}
