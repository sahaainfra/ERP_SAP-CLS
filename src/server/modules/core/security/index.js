import { Router } from 'express';
import { eventTypes } from '../../../platform/events/index.js';
import { notFound } from '../../../platform/http/errors.js';
import { requirePermission } from '../../../platform/auth/index.js';
import { createSecurityService } from './service.js';
import { parseRouteList, parseSettingsChange } from './validators.js';

// Part 02.07: the secure request pipeline. Events this module publishes:
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required });
const str = { type: 'string' };
eventTypes.define({ type: 'core.security.settings_changed', version: 1, schema: obj({ version: { type: 'number' }, requestId: { type: 'number' } }, ['version']), owner: 'core', description: 'The rate limits, security headers, CORS list or export thresholds were changed after approval.' });
eventTypes.define({ type: 'core.export.completed', version: 1, schema: obj({ report: str, format: str, rows: { type: 'number' }, personal: { type: 'boolean' } }, ['report']), owner: 'core', description: 'A person exported data; the export is in the audit trail and, for personal data, the security log.' });

/** Mount the route registry and security settings routes (behind ff.iam.p0207). */
export function mountSecurity({ api, db, config, approvals, opts, isFlagOn }) {
  const service = createSecurityService({ db, config, approvals });
  const r = Router();
  r.get('/routes', requirePermission('core.routes.view'), (req, res) => res.json(service.routes(req.actor, parseRouteList(req.query))));
  r.post('/routes/self-test', requirePermission('core.security.configure'), opts.idempotent, async (req, res) => res.json({ data: await service.selfTest(req.actor) }));
  r.get('/security-settings', requirePermission('core.routes.view'), (req, res) => res.json({ data: service.settings(req.actor) }));
  r.post('/security-settings/change-requests', requirePermission('core.security.configure'), opts.idempotentRequired, (req, res) => res.status(201).json({ data: service.requestChange(req.actor, parseSettingsChange(req.body)) }));
  const router = Router();
  const mine = (req) => ['/routes', '/security-settings'].some((p) => req.path === p || req.path.startsWith(`${p}/`));
  router.use((req, _res, next) => (!mine(req) || isFlagOn(req.actor, 'ff.iam.p0207') ? next() : next(notFound('The route registry and security settings are not enabled for your company yet (feature flag ff.iam.p0207 is OFF).'))));
  router.use(r);
  api.use('/core', router);
  return service;
}
