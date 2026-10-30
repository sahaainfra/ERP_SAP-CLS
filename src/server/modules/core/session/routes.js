import { Router } from 'express';
import { permissionsOf } from '../../../platform/auth/index.js';

// Who am I, which permissions do I hold, and the environment: drives UI permission states.
export function sessionRoutes({ config }) {
  const r = Router();
  r.get('/session', (req, res) => {
    res.json({
      data: {
        user: req.actor.user,
        roles: req.actor.roles,
        companyId: req.actor.companyId,
        permissions: permissionsOf(req.actor),
        environment: config.environment,
      },
    });
  });
  return r;
}
