import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { timingSafeEqual } from 'node:crypto';
import { ROOT } from './platform/db/index.js';
import { authenticate, hasPermission } from './platform/auth/index.js';
import { identityOf } from './platform/identity/index.js';
import { authzOf } from './platform/authz/index.js';
import { HttpError, errorHandler, forbidden, unauthorized } from './platform/http/errors.js';
import { onboardingGate } from './platform/http/onboarding.js';
import { createLogger, setAppLogger } from './platform/http/logger.js';
import { instrumentDb } from './platform/observability/dbstats.js';
import { metrics } from './platform/observability/metrics.js';
import { currentContext, pseudonym } from './platform/observability/context.js';
import { opsOf } from './platform/observability/ops.js';
import { tracer } from './platform/observability/tracing.js';
import { applyPipeline } from './platform/http/pipeline.js';
import { runReadiness } from './platform/health/index.js';
import { loadBuildInfo } from './modules/core/about/service.js';
import { mountModules } from './modules/registry.js';

const sameToken = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Composition root: pipeline, health, the authenticated /api/v1 router with every module, static client, error handler. */
export function createApp({ config, db, logger = createLogger(), buildInfo = loadBuildInfo(), storagePath = null, identityOptions = {} }) {
  const app = express();
  // Who is calling (part 02.01): used by every authenticated route when AUTH_MODE=iam; created up front so tests can set its clock and hash cost.
  const identity = identityOf(db, { authSecret: config.authSecret ?? undefined, vaultKey: config.vaultKey ?? undefined, ...identityOptions });
  // What each person may do (part 02.04): computed per request from roles and scoped assignments, cached for 30 seconds.
  const authz = authzOf(db, { now: identity.now });
  setAppLogger(logger);
  instrumentDb(db, { metrics, tracer });
  applyPipeline(app, { logger });

  // Legacy liveness path: kept as is (contract snapshot). New code uses /health/live.
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', environment: config.environment }));

  const storage = storagePath ?? config.storagePath ?? (config.databasePath === ':memory:' ? tmpdir() : join(ROOT, 'data'));
  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));

  // Readiness shows which dependency is down, so it is restricted: ITADM/SYSADM, or a monitoring token.
  app.get('/health/ready', (req, res, next) => {
    const respond = () => {
      const result = runReadiness({ db, storagePath: storage });
      res.status(result.status === 'fail' ? 503 : 200).json(result);
    };
    const token = req.get('x-health-token');
    if (config.healthToken && token && sameToken(token, config.healthToken)) return respond();
    authenticate(config, identity.resolver, authz)(req, res, (err) => {
      if (err) return next(err.status === 401 ? unauthorized('Readiness is restricted: sign in as an administrator or send the monitoring token.') : err);
      if (!hasPermission(req.actor, 'core.health.view')) {
        return next(forbidden('Your role does not include core.health.view. Ask a system administrator for access.'));
      }
      respond();
    });
  });

  // Routes that carry their own proof of access (short-lived signed download links) are mounted before authentication.
  const publicApi = express.Router();
  // Prometheus scrape endpoint: restricted like readiness (ITADM/SYSADM, or the monitoring token).
  const ops = opsOf(db, { metrics, storagePath: storage });
  app.get('/metrics', (req, res, next) => {
    const respond = () => {
      const sys = ops.system();
      const slos = ops.sloReport();
      const gauge = (name, help, value, labels) => ({ name, help, values: [{ value, labels }] });
      const extra = [
        gauge('erp_outbox_unpublished', 'Events waiting to be relayed.', sys.queues.outboxUnpublished),
        gauge('erp_inbox_pending', 'Deliveries waiting for a consumer.', sys.queues.inboxPending),
        gauge('erp_dead_letters', 'Events in the dead-letter queue.', sys.queues.deadLetters),
        gauge('erp_jobs_queued', 'Background jobs waiting to run.', sys.queues.jobsQueued),
        gauge('erp_db_size_mb', 'Database size in megabytes.', sys.database.sizeMb),
        gauge('erp_open_alerts', 'Alerts that are open.', ops.alerts({ status: 'OPEN' }).length),
        gauge('erp_process_uptime_seconds', 'Seconds since the process started.', metrics.process().uptimeSeconds),
        gauge('erp_process_rss_mb', 'Resident memory in megabytes.', metrics.process().rssMb),
        gauge('erp_event_loop_lag_ms', 'Mean event-loop delay in milliseconds.', metrics.process().eventLoopLagMs),
        { name: 'erp_slo_error_budget_remaining_pct', help: 'Error budget left per journey.', values: slos.map((s) => ({ labels: { journey: s.journey }, value: s.errorBudget.remainingPct })) },
        { name: 'erp_slo_breached', help: '1 when a journey is outside its objective.', values: slos.map((s) => ({ labels: { journey: s.journey }, value: s.status === 'breached' ? 1 : 0 })) },
      ];
      if (sys.disk) extra.push(gauge('erp_disk_free_pct', 'Free space of the data disk in percent.', sys.disk.freePct));
      res.type('text/plain; version=0.0.4').send(metrics.prometheus(extra));
    };
    const token = req.get('x-health-token');
    if (config.healthToken && token && sameToken(token, config.healthToken)) return respond();
    authenticate(config, identity.resolver, authz)(req, res, (err) => {
      if (err) return next(err.status === 401 ? unauthorized('Metrics are restricted: sign in as an administrator or send the monitoring token.') : err);
      if (!hasPermission(req.actor, 'core.ops.view')) return next(forbidden('Your role does not include core.ops.view. Ask a system administrator for access.'));
      respond();
    });
  });

  const api = express.Router();
  api.use(authenticate(config, identity.resolver, authz));
  api.use(onboardingGate);
  api.use((req, _res, next) => {
    const ctx = currentContext();
    if (ctx) ctx.user = pseudonym(req.actor?.user);
    next();
  });
  mountModules(api, { db, config, buildInfo, publicApi, storagePath: storage });
  app.use('/api/v1', publicApi);
  app.use('/api/v1', api);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'No such API route.')));

  const dist = join(ROOT, 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/|health\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
  }

  app.use(errorHandler(logger));
  return app;
}
