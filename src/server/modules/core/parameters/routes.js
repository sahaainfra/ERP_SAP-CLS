import { Router } from 'express';
import { requirePermission } from '../../../platform/auth/index.js';
import { createParameterController } from './controller.js';

export function parameterRoutes(service, { idempotent }) {
  const c = createParameterController(service);
  const r = Router();
  r.get('/parameters/definitions', requirePermission('core.param.view'), c.definitions);
  r.get('/parameters/resolve', requirePermission('core.param.view'), c.resolve);
  r.get('/parameters', requirePermission('core.param.view'), c.list);
  // The permission for the scope (company or system) is checked in the service, which knows the scope.
  r.post('/parameters', idempotent, c.set);
  return r;
}
