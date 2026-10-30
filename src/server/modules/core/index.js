import { aboutRoutes } from './about/routes.js';
import { createAboutService } from './about/service.js';
import { architectureRoutes } from './architecture/routes.js';
import { createArchitectureService } from './architecture/service.js';
import { featureFlagRoutes } from './feature-flags/routes.js';
import { createFlagService } from './feature-flags/service.js';
import { sessionRoutes } from './session/routes.js';

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
  tables: ['core_feature_flags', 'core_audit_log', 'core_outbox', 'core_schema_migrations'],
  resources: ['session', 'about', 'feature-flags', 'architecture'],
  /** Build the module's services and attach its routes to the authenticated /api/v1 router. */
  mount(api, { db, config, buildInfo, modules }) {
    const flags = createFlagService({ db, environment: config.environment });
    api.use('/core', sessionRoutes({ config }));
    api.use('/core', aboutRoutes(createAboutService({ db, config, buildInfo })));
    api.use('/core', architectureRoutes(createArchitectureService({ modules, isFlagOn: (actor, key) => flags.isOn(actor, key) })));
    api.use('/core', featureFlagRoutes(flags));
  },
};
