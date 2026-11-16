import './platform/security/routes.js'; // wraps Router.use so mounted routers are recorded: must load before any router is built
import express from 'express';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { timingSafeEqual } from 'node:crypto';
import { ROOT } from './platform/db/index.js';
import { authenticate, hasPermission } from './platform/auth/index.js';
import { elevationLogger } from './modules/iam/privileged/elevation.js';
import { recordSecurityEvent } from './platform/audit/index.js';
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
import { createFlagService } from './modules/core/api.js';
import { attachSocketServer } from './platform/realtime/socket.js';
import { assertDeclared, buildRegistry, cors, csrfGuard, enforcePolicy, persistRegistry, securityHeaders, securityOf } from './platform/security/index.js';
import { staticAssets } from './platform/http/staticAssets.js';
import { compressJson } from './platform/http/compressJson.js';

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
  // The secure request pipeline (part 02.07): headers, CORS allow-list, cookie-session CSRF guard and the per-address rate limit run
  // before anything else; the Authorise stage (route policy) and the per-person rate limit run right after sign-in.
  const sec = securityOf(db, { now: identity.now });
  const flags = createFlagService({ db, environment: config.environment });
  const rateClass = (req) => sec.policy.find(req.method, req.originalUrl.split('?')[0])?.rate ?? (req.method === 'GET' ? 'read' : 'write');
  applyPipeline(app, {
    logger,
    headers: securityHeaders({ settings: sec.settings, config }),
    before: [cors({ settings: sec.settings, config }), csrfGuard(), (req, _res, next) => { try { if (req.originalUrl.startsWith('/api/')) sec.limiter.check(req, rateClass(req), 'ip'); next(); } catch (err) { next(err); } }],
  });

  app.use('/api', compressJson()); // part 166.4: JSON answers compressed for a browser that accepts it (the error answers too)

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
  api.use(elevationLogger(db));
  // a refused request is a security event (part 02.06, FR-04)
  api.use((req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode !== 403 || !req.actor) return;
      try {
        recordSecurityEvent(db, { companyId: req.actor.companyId, userId: req.actor.userId ?? null, username: req.actor.user, type: 'authz.denied', severity: 'WARNING', details: { method: req.method, route: `${req.baseUrl.replace(/^\/api\/v1/, '')}${req.route?.path ?? req.path}`.slice(0, 200) }, ip: req.ip ?? null, correlationId: req.correlationId ?? null });
      } catch { /* the log must never break a response */ }
    });
    next();
  });
  api.use((req, _res, next) => {
    const ctx = currentContext();
    if (ctx) {
      ctx.user = pseudonym(req.actor?.user);
      // where the work came from, for the audit trail and the security event log (part 02.06)
      ctx.companyId = req.actor?.companyId ?? null;
      ctx.userId = req.actor?.userId ?? null;
      ctx.ip = req.ip ?? null;
      ctx.device = String(req.get('user-agent') ?? '').slice(0, 200) || null;
    }
    next();
  });
  // the Authorise stage and the per-person limit come after the logging stages above, so a refusal here is logged as a security event too
  api.use(enforcePolicy({ policy: sec.policy, isFlagOn: (actor, key) => flags.isOn(actor, key) }));
  api.use((req, _res, next) => { try { sec.limiter.check(req, req.routePolicy?.rate ?? (req.method === 'GET' ? 'read' : 'write'), 'user'); next(); } catch (err) { next(err); } });
  mountModules(api, { db, config, buildInfo, publicApi, storagePath: storage });
  app.use('/api/v1', publicApi);
  app.use('/api/v1', api);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'No such API route.')));

  const dist = join(ROOT, 'dist');
  if (existsSync(dist)) {
    // the service worker and the manifest are always asked for again, so a new version of the app is noticed (part 03.06)
    app.use(staticAssets(dist)); // part 166.4: the compressed copy of a script or style, and a year's cache for the hashed files
    app.use(express.static(dist, { setHeaders: (res, file) => { if (['sw.js', 'manifest.webmanifest'].includes(basename(file))) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.get(/^\/(?!api\/|health\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
  }

  app.use(errorHandler(logger));
  // Part 04.06: the Socket.IO layer rides on the HTTP server that listen() makes, so every way of starting the application (the process, the tests, the browser tests) has it.
  const listen = app.listen.bind(app);
  app.listen = (...args) => {
    const server = listen(...args);
    attachSocketServer({ server, db, config, authenticate: authenticate(config, identity.resolver, authz), isOn: (actor) => flags.isOn(actor, 'ff.eng.p0406') });
    return server;
  };
  // The route registry (part 02.07, FR-01): every live route against the route policy; an undeclared route stops a staging or production start.
  const built = buildRegistry(app, sec.policy);
  assertDeclared(built, { environment: config.environment, log: (text) => logger.warn({ msg: 'route policy', problem: text }) });
  persistRegistry(db, built);
  sec.registry = built;
  sec.app = app;
  return app;
}
