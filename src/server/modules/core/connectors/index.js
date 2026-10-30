import { Router } from 'express';
import { notFound } from '../../../platform/http/errors.js';
import { integrationsOf } from '../../../platform/integrations/index.js';
import { connectorRoutes, webhookRoutes } from './routes.js';
import { createConnectorChangeHandler, createConnectorService } from './service.js';

/** The approval handler for connector creation and changes; it needs the integration service of the database. */
export const connectorChangeHandlerFor = (db, config) => {
  const { providers, secrets } = integrationsOf(db, { vaultKey: config.vaultKey });
  return createConnectorChangeHandler({ providers, secrets });
};

/**
 * Part 01.08: the integration hub. Mounts connectors and the log (behind ff.core.p0108) and the public webhook receiver, and
 * registers the health-check and log-retention jobs.
 */
export function mountConnectors({ api, publicApi, db, config, runtime, approvals, opts, isFlagOn, persist = true }) {
  const integrations = integrationsOf(db, { vaultKey: config.vaultKey });
  const service = createConnectorService({ db, integrations, approvals, isFlagOn });

  runtime.jobs.register(
    'core.connector_health',
    async (ctx) => {
      const rows = db.prepare("SELECT id, code FROM core_connectors WHERE status = 'ENABLED' AND is_active = 1").all();
      let failed = 0;
      for (const [n, c] of rows.entries()) {
        const out = await integrations.hub.testConnection(c.id, {});
        if (out.status !== 'ok') failed += 1;
        ctx.log(`${c.code}: ${out.status} - ${out.message}`);
        ctx.setProgress(Math.round(((n + 1) / rows.length) * 100));
      }
      return { checked: rows.length, failed };
    },
    { maxAttempts: 1, description: 'Tests every switched-on connector and records its health.' },
  );
  runtime.jobs.register(
    'core.integration_log_purge',
    (ctx) => {
      const removed = integrations.hub.purgeLogs();
      ctx.log(`Removed ${removed} integration log rows past their retention`);
      return { removed };
    },
    { maxAttempts: 2, description: 'Deletes integration log rows older than the retention of each connector (FR-05).' },
  );
  if (persist) {
    runtime.scheduler.define({ code: 'core.connector_health_15m', cron: '*/15 * * * *', jobType: 'core.connector_health', description: 'Connector health checks every 15 minutes' });
    runtime.scheduler.define({ code: 'core.integration_log_purge_daily', cron: '15 3 * * *', jobType: 'core.integration_log_purge', description: 'Daily integration log retention (03:15 IST)' });
  }

  publicApi.use('/core', webhookRoutes(service));

  const router = Router();
  const mine = (req) => ['/connectors', '/integration-logs'].some((p) => req.path === p || req.path.startsWith(`${p}/`));
  router.use((req, _res, next) => (!mine(req) || isFlagOn(req.actor, 'ff.core.p0108') ? next() : next(notFound('Integrations are not enabled for your company yet (feature flag ff.core.p0108 is OFF).'))));
  router.use(connectorRoutes(service, opts));
  api.use('/core', router);
  return integrations;
}
