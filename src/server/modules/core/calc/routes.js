import { Router } from 'express';
import { requirePermission } from '../../../platform/auth/index.js';
import { createCalcController } from './controller.js';

/**
 * Reading the registry and using the test bench need core.calc.view. Changing it (new formula, new version, shadow mode,
 * an activation request, units and conversion factors) needs core.calc.manage, and a version only becomes active through
 * an approved request. Requests that change data need an Idempotency-Key where a retry must not repeat them.
 */
export function calcRoutes(service, { idempotent, idempotentRequired }) {
  const c = createCalcController(service);
  const view = requirePermission('core.calc.view');
  const manage = requirePermission('core.calc.manage');
  const r = Router();
  r.get('/formulas', view, c.list);
  r.post('/formulas', manage, idempotent, c.create);
  r.get('/formulas/:code', view, c.get);
  r.post('/formulas/:code/versions', manage, idempotent, c.createVersion);
  r.patch('/formulas/:code/versions/:version', manage, idempotent, c.updateVersion);
  r.get('/formulas/:code/versions/:version/check', view, c.check);
  r.post('/formulas/:code/versions/:version/shadow', manage, idempotentRequired, c.startShadow);
  r.post('/formulas/:code/versions/:version/shadow/stop', manage, idempotentRequired, c.stopShadow);
  r.post('/formulas/:code/versions/:version/activation-requests', manage, idempotentRequired, c.requestActivation);
  r.post('/formulas/:code/test', view, c.test);
  r.post('/formulas/:code/compare', view, c.compare);
  r.get('/formulas/:code/shadow-summary', view, c.shadowSummary);
  r.get('/calc-traces', c.traces);
  r.get('/uoms', view, c.uoms);
  r.post('/uoms', manage, idempotent, c.createUom);
  r.get('/uom-conversions', view, c.conversions);
  r.post('/uom-conversions', manage, idempotent, c.createConversion);
  r.delete('/uom-conversions/:id', manage, idempotent, c.removeConversion);
  r.post('/calc/convert', view, c.convert);
  return r;
}
