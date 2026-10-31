import { Router } from 'express';
import { requirePermission, requirePermissionAnywhere } from '../../../platform/auth/index.js';
import { createSampleDocumentController } from './controller.js';

/** Submitting is a posting action, so it needs an Idempotency-Key (`idempotentRequired`); a retry never submits twice. */
export function sampleDocumentRoutes(service, { idempotent, idempotentRequired }) {
  const c = createSampleDocumentController(service);
  const r = Router();
  r.get('/sample-documents', requirePermissionAnywhere('core.sample.use'), c.list);
  r.get('/sample-documents/number-preview', requirePermission('core.sample.use'), c.preview);
  r.post('/sample-documents', requirePermissionAnywhere('core.sample.use'), idempotent, c.create);
  r.post('/sample-documents/:id/submit', requirePermissionAnywhere('core.sample.use'), idempotentRequired, c.submit);
  r.post('/sample-documents/:id/cancel', requirePermissionAnywhere('core.sample.use'), idempotentRequired, c.cancel);
  return r;
}
