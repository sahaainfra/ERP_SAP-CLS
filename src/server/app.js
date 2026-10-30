import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { timingSafeEqual } from 'node:crypto';
import { ROOT } from './platform/db/index.js';
import { authenticate, hasPermission } from './platform/auth/index.js';
import { HttpError, errorHandler, forbidden, unauthorized } from './platform/http/errors.js';
import { createLogger } from './platform/http/logger.js';
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
export function createApp({ config, db, logger = createLogger(), buildInfo = loadBuildInfo(), storagePath = null }) {
  const app = express();
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
    authenticate(config)(req, res, (err) => {
      if (err) return next(err.status === 401 ? unauthorized('Readiness is restricted: sign in as an administrator or send the monitoring token.') : err);
      if (!hasPermission(req.actor, 'core.health.view')) {
        return next(forbidden('Your role does not include core.health.view. Ask a system administrator for access.'));
      }
      respond();
    });
  });

  const api = express.Router();
  api.use(authenticate(config));
  mountModules(api, { db, config, buildInfo });
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
