import { Router } from 'express';
import { requirePermission } from '../../../platform/auth/index.js';
import { createIntegrityController } from './controller.js';

/** `idempotent` is the idempotency middleware for this database: a retried "run" returns the stored result. */
export function integrityRoutes(service, { idempotent }) {
  const c = createIntegrityController(service);
  const r = Router();
  r.post('/integrity/run', requirePermission('core.integrity.run'), idempotent, c.run);
  r.get('/integrity/summary', requirePermission('core.integrity.view'), c.summary);
  r.get('/integrity/runs', requirePermission('core.integrity.view'), c.runs);
  return r;
}
