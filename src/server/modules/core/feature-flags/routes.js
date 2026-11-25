import { Router } from 'express';
import { requirePermission } from '../../../platform/auth/index.js';
import { createFlagController } from './controller.js';

/** `idempotent` replays a stored response when a client retries with the same Idempotency-Key. */
export function featureFlagRoutes(service, { idempotent = (_req, _res, next) => next(), changes = null } = {}) {
  const c = createFlagController(service, changes);
  const r = Router();
  r.get('/feature-flags', requirePermission('core.flag.view'), c.list);
  r.get('/feature-flags/evaluate', c.evaluate);
  // audit AUD-DEF-009: the changes waiting for their checkers (staging and production); declared before /:key so 'changes' is not a key
  if (changes) {
    r.get('/feature-flags/changes', requirePermission('core.flag.view'), c.changes);
    r.post('/feature-flags/changes/:id/decide', requirePermission('core.flag.approve'), idempotent, c.decide);
    r.post('/feature-flags/changes/:id/cancel', requirePermission('core.flag.configure'), idempotent, c.cancel);
  }
  r.patch('/feature-flags/:key', requirePermission('core.flag.configure'), idempotent, c.patch);
  return r;
}
