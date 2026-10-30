import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { aboutRoutes } from './about/routes.js';
import { createAboutService } from './about/service.js';
import { architectureRoutes } from './architecture/routes.js';
import { createArchitectureService } from './architecture/service.js';
import { featureFlagRoutes } from './feature-flags/routes.js';
import { createFlagService } from './feature-flags/service.js';
import { integrityRoutes } from './integrity/routes.js';
import { createIntegrityService } from './integrity/service.js';
import { sessionRoutes } from './session/routes.js';

// The core module's tables for the integrity checks: flag, run and back-fill rows are installation-wide (no company
// needed), and the two run ledgers have their own status words.
integrityRegistry.register({
  companyOptional: ['core_feature_flags', 'core_integrity_runs', 'core_backfill_runs'],
  statuses: {
    core_integrity_runs: ['pass', 'fail', 'not_applicable'],
    core_backfill_runs: ['running', 'completed', 'failed'],
  },
});

/**
 * Module "core": the reference implementation of the layered architecture
 * (route -> controller -> service -> repository). Other modules copy this shape.
 */
export const core = {
  code: 'core',
  name: 'Core Architecture & Platform Services',
  routePrefix: '/api/v1/core',
  ownerPart: '01.x',
  status: 'Reference implementation',
  tables: ['core_feature_flags', 'core_audit_log', 'core_outbox', 'core_idempotency_keys', 'core_integrity_runs', 'core_backfill_runs', 'core_schema_migrations'],
  resources: ['session', 'about', 'feature-flags', 'architecture', 'integrity'],
  /** Build the module's services and attach its routes to the authenticated /api/v1 router. */
  mount(api, { db, config, buildInfo, modules }) {
    const flags = createFlagService({ db, environment: config.environment });
    const isFlagOn = (actor, key) => flags.isOn(actor, key);
    const idempotent = idempotency(db); // honoured when the client sends an Idempotency-Key; never required here
    api.use('/core', sessionRoutes({ config }));
    api.use('/core', aboutRoutes(createAboutService({ db, config, buildInfo })));
    api.use('/core', architectureRoutes(createArchitectureService({ modules, isFlagOn })));
    api.use('/core', integrityRoutes(createIntegrityService({ db, isFlagOn }), { idempotent }));
    api.use('/core', featureFlagRoutes(flags, { idempotent }));
  },
};
