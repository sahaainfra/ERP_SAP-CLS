import { createAuthz } from './engine.js';

export { createAuthz } from './engine.js';
export { CONFIDENTIALITY_LEVELS, DIRECTOR_APPROVED_ROLES, PERMISSIONS_02_04, PERMISSIONS_02_05, PERMISSIONS_02_06, PERMISSIONS_02_07, PERMISSIONS_03_01, PERMISSIONS_03_03, PERMISSIONS_03_05, PERMISSIONS_03_07, PERMISSIONS_03_08, PERMISSIONS_03_09, PERMISSIONS_03_10, PERMISSIONS_SINCE_LEGACY, ROLE_TEMPLATES, SENSITIVE_ACTIONS, TEMPLATE_PERMISSIONS } from './templates.js';
export { LEGACY_ROLE_PERMISSIONS } from './legacy.js';
export { MASK_RULES, fieldRegistry, hierarchyRegistry, isSensitiveKey, parseKey, permissionRegistry, recordResolvers } from './registry.js';

const instances = new WeakMap();

/** The authorisation engine of a database, created once (options apply the first time only: tests pass a clock). */
export function authzOf(db, options = {}) {
  let a = instances.get(db);
  if (!a) {
    a = createAuthz({ db, ...options });
    instances.set(db, a);
  }
  return a;
}
