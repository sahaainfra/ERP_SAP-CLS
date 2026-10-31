import { authzOf } from '../authz/index.js';
import { createActAs } from './actAs.js';
import { createRateLimiter } from './limits.js';
import { createPolicy } from './policy.js';
import { createRoomGuard } from './rooms.js';
import { securitySettingsOf } from './settings.js';

export { collectRoutes, patternRegex } from './routes.js';
export { cors, csrfGuard, securityHeaders } from './headers.js';
export { createPolicy, enforcePolicy } from './policy.js';
export { createExportGuard } from './export.js';
export { securityHandlers } from './handlers.js';
export { toCsv, csvCell, neutralise } from './csv.js';
export { RATE_CLASSES, DEFAULT_SETTINGS, settingsSchema, securitySettingsOf } from './settings.js';
export { assertDeclared, buildRegistry, checkKeys, persistRegistry, moduleOf } from './registry.js';
export { runRouteTests } from './probe.js';
export { authorise, validate, audit } from './middleware.js';
export { rotateVaultKey } from './rotate.js';

const instances = new WeakMap();

/**
 * The security runtime of an application (part 02.07): settings, the rate limiter, the route policy, the room guard and the
 * "act as a person" helper. Created once by createApp; modules that need it ask for it with `securityOf(db)`.
 */
export function securityOf(db, /** @type {{ now?: () => number }} */ { now } = {}) {
  let s = instances.get(db);
  if (!s) {
    const settings = securitySettingsOf(db);
    const authz = authzOf(db);
    s = { settings, limiter: createRateLimiter({ db, settings, now }), policy: createPolicy(), rooms: createRoomGuard({ db, authz }), actAs: createActAs({ db, authz }), registry: null, app: null };
    instances.set(db, s);
  }
  return s;
}
