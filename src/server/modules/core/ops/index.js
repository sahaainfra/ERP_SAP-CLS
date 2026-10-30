import { Router } from 'express';
import { eventTypes } from '../../../platform/events/index.js';
import { log } from '../../../platform/http/logger.js';
import { notFound } from '../../../platform/http/errors.js';
import { metrics } from '../../../platform/observability/metrics.js';
import { opsOf } from '../../../platform/observability/ops.js';
import { tracer } from '../../../platform/observability/tracing.js';
import { opsRoutes } from './routes.js';
import { createOpsService } from './service.js';

// Part 01.07: observability. Events this module publishes:
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required });
const str = { type: 'string' };
/** @type {[string, string, any][]} */
const OPS_EVENTS = [
  ['core.alert.fired', 'An alert rule was breached; the notification service delivers it to the administrators.', obj({ rule: str, severity: str, message: str }, ['rule', 'severity', 'message'])],
  ['core.alert.resolved', 'The condition behind an alert cleared.', obj({ rule: str }, ['rule'])],
  ['core.ops_config.changed', 'An alert rule or service-level objective was changed after approval.', obj({ target: str, key: str }, ['target', 'key'])],
  ['core.ops.diagnostic', 'An administrator ran the follow-one-request diagnostic.', obj()],
];
for (const [type, description, schema] of OPS_EVENTS) eventTypes.define({ type, version: 1, schema, owner: 'core', description });

/** Mount the operations routes (behind ff.core.p0107), the diagnostic consumer and job, and keep the defaults in place. */
export function mountOps({ api, db, runtime, approvals, opts, isFlagOn, storagePath, persist = true }) {
  const ops = opsOf(db, { metrics, storagePath });
  if (persist) ops.ensureDefaults();
  runtime.bus.subscribe('core.ops.diagnostic', (event) => log.info({ msg: 'diagnostic event consumed', eventType: event.type, eventId: event.eventId }), { consumer: 'core.ops.diagnostic', maxAttempts: 1 });
  runtime.jobs.register('core.ops_diagnostic', (ctx) => {
    log.info({ msg: 'diagnostic job running', jobId: ctx.jobId });
    return { ok: true };
  }, { maxAttempts: 1, description: 'Logs a line under the correlation ID of the diagnostic request, to show it reaching a job.' });

  const router = Router();
  const mine = (req) => req.path === '/ops' || req.path.startsWith('/ops/');
  router.use((req, _res, next) => {
    if (!mine(req) || req.path === '/ops/client-events' || isFlagOn(req.actor, 'ff.core.p0107')) return next();
    return next(notFound('Operations monitoring is not enabled for your company yet (feature flag ff.core.p0107 is OFF).'));
  });
  router.use(opsRoutes(createOpsService({ db, ops, metrics, tracer, approvals, jobs: runtime.jobs }), opts));
  api.use('/core', router);
  return ops;
}
