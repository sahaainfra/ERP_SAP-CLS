import { Router } from 'express';
import { requirePermission } from '../../../platform/auth/index.js';

// Technical Console: the architecture and API conventions guide, rendered from docs/erp/ARCHITECTURE.md.
export function architectureRoutes(service) {
  const r = Router();
  r.get('/architecture', requirePermission('core.arch.view'), (req, res) => {
    res.json({ data: service.guide(req.actor) });
  });
  return r;
}
