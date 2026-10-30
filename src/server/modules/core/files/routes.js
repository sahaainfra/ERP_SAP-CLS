import { Router } from 'express';
import { requirePermission } from '../../../platform/auth/index.js';
import { createFileController } from './controller.js';

/**
 * Who may attach, open or remove a file is decided by the record it is attached to (the service asks the module that
 * owns the record), so these routes need only a signed-in user; the administration routes need core.files.* permissions.
 */
export function fileRoutes(service, { idempotent }, controllerOptions) {
  const c = createFileController(service, controllerOptions);
  const r = Router();
  r.get('/files/settings', requirePermission('core.files.admin'), c.settings);
  r.post('/files/settings/change-requests', requirePermission('core.files.configure'), idempotent, c.requestSettingsChange);
  r.get('/files/overview', requirePermission('core.files.admin'), c.overview);
  r.get('/files/admin', requirePermission('core.files.admin'), c.admin);
  r.post('/files/uploads', idempotent, c.begin);
  r.get('/files/uploads/:uploadId', c.getUpload);
  r.put('/files/uploads/:uploadId', c.chunk);
  r.post('/files/uploads/:uploadId/complete', idempotent, c.complete);
  r.post('/files', c.upload);
  r.get('/files', c.list);
  r.get('/files/:id', c.get);
  r.get('/files/:id/url', c.url);
  r.post('/files/:id/rescan', requirePermission('core.files.admin'), idempotent, c.rescan);
  r.delete('/files/:id', idempotent, c.remove);
  return r;
}

/** The download itself carries its own proof (a signed, short-lived link), so it is mounted before sign-in is required. */
export function fileContentRoutes(service) {
  const c = createFileController(service);
  const r = Router();
  r.get('/core/files/:id/content', c.content);
  return r;
}
