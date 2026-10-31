import { core } from './core/index.js';
import { iam } from './iam/index.js';

/**
 * Every server module, in mount order. A new module adds one line here and one folder under modules/<code>/
 * (routes, controllers, services, repositories, validators, events, jobs, tests). A module owns its tables:
 * other modules call its service or react to its events and never write into its tables.
 */
export const MODULES = [core, iam];

export function mountModules(api, deps) {
  for (const m of MODULES) m.mount(api, { ...deps, modules: MODULES });
}
