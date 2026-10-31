// Prints every route of the application as JSON (used to build and check the route policy).
import { createApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/platform/config/index.js';
import { migrateUp, openDatabase } from '../src/server/platform/db/index.js';
import { collectRoutes } from '../src/server/platform/security/routes.js';
import { silentLogger } from '../src/server/platform/http/logger.js';
import '../src/server/modules/registry.js';

const db = openDatabase(':memory:');
migrateUp(db);
const app = createApp({ config: loadConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', AUTH_MODE: 'dev-headers' }), db, logger: silentLogger });
console.log(JSON.stringify(collectRoutes(app)));
