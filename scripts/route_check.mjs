// Fails if any route of the application is missing from the route policy, if the policy names a route that does not exist, or if a
// declared permission is not a known permission (part 02.07, FR-01). Run by `npm run erp:regression` and in CI.
import { createApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/platform/config/index.js';
import { migrateUp, openDatabase } from '../src/server/platform/db/index.js';
import { silentLogger } from '../src/server/platform/http/logger.js';
import { buildRegistry, checkKeys, createPolicy } from '../src/server/platform/security/index.js';
import { ROLE_TEMPLATES } from '../src/server/platform/authz/index.js';
import '../src/server/modules/registry.js';

const db = openDatabase(':memory:');
migrateUp(db);
const app = createApp({ config: loadConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', AUTH_MODE: 'dev-headers' }), db, logger: silentLogger });
const built = buildRegistry(app, createPolicy());
const known = new Set([...db.prepare('SELECT perm_key FROM iam_permissions').all().map((p) => p.perm_key), ...ROLE_TEMPLATES.flatMap((t) => t.permissions)]);
const badKeys = checkKeys(built, known);
const problems = [...built.undeclared.map((r) => `not declared: ${r}`), ...built.stale.map((r) => `declared but not a route: ${r}`), ...badKeys.map((r) => `unknown permission: ${r}`)];
if (problems.length) {
  console.error(`Route check FAILED: ${problems.length} problem(s).`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('Declare every route in src/server/platform/security/route-policy.js (a permission, "self", "record" or "public").');
  process.exit(1);
}
console.log(`Route check OK: ${built.routes.length} routes, every one declared.`);
