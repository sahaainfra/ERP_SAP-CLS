import { Router } from 'express';
import { requirePermission } from '../../../platform/auth/index.js';
import { createNumberingController } from './controller.js';

/** `idempotentRequired` makes the Idempotency-Key mandatory: issuing a number is an action a retry must not repeat. */
export function numberingRoutes(service, { idempotent, idempotentRequired }) {
  const c = createNumberingController(service);
  const r = Router();
  r.get('/document-types', requirePermission('core.numbering.view'), c.listTypes);
  r.post('/document-types', requirePermission('core.numbering.configure'), idempotent, c.createType);
  r.patch('/document-types/:id', requirePermission('core.numbering.configure'), idempotent, c.updateType);

  r.get('/number-series', requirePermission('core.numbering.view'), c.listSeries);
  r.post('/number-series', requirePermission('core.numbering.configure'), idempotent, c.createSeries);
  r.get('/number-series/:id', requirePermission('core.numbering.view'), c.getSeries);
  r.patch('/number-series/:id', requirePermission('core.numbering.configure'), idempotent, c.updateSeries);
  r.post('/number-series/:id/change-requests', requirePermission('core.numbering.configure'), idempotentRequired, c.requestChange);

  r.get('/numbering/preview', requirePermission('core.numbering.preview'), c.preview);
  r.post('/numbering/next', requirePermission('core.numbering.issue'), idempotentRequired, c.next);
  r.get('/numbering/issues', requirePermission('core.numbering.view'), c.issues);
  return r;
}
