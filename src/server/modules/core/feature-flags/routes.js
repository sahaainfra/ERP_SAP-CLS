import { Router } from 'express';
import { requirePermission } from '../../../platform/auth/index.js';
import { createFlagController } from './controller.js';

/** `idempotent` replays a stored response when a client retries with the same Idempotency-Key. */
export function featureFlagRoutes(service, { idempotent = (_req, _res, next) => next() } = {}) {
  const c = createFlagController(service);
  const r = Router();
  r.get('/feature-flags', requirePermission('core.flag.view'), c.list);
  r.get('/feature-flags/evaluate', c.evaluate);
  r.patch('/feature-flags/:key', requirePermission('core.flag.configure'), idempotent, c.patch);
  return r;
}
