import { core } from './core/index.js';
import { iam } from './iam/index.js';
import { ui } from './ui/index.js';
import { eng } from './eng/index.js';
import { msg } from './msg/index.js';
import { sec } from './sec/index.js';
import { pol } from './pol/index.js';
import { mdm } from './mdm/index.js';
import { fin } from './fin/index.js';
import { hr } from './hr/index.js';
import { bd } from './bd/index.js';
import { est } from './est/index.js';
import { proj } from './proj/index.js';
import { engg } from './engg/index.js';
import { bud } from './bud/index.js';
import { plan } from './plan/index.js';
import { site } from './site/index.js';
import { proc } from './proc/index.js';
import { inv } from './inv/index.js';
import { plant } from './plant/index.js';
import { qa } from './qa/index.js';
import { hse } from './hse/index.js';
import { rmc } from './rmc/index.js';
import { ctr } from './ctr/index.js';
import { bill } from './bill/index.js';
import { pay } from './pay/index.js';
import { portal } from './portal/index.js';
import { bi } from './bi/index.js';
import { ai } from './ai/index.js';

/**
 * Every server module, in mount order. A new module adds one line here and one folder under modules/<code>/
 * (routes, controllers, services, repositories, validators, events, jobs, tests). A module owns its tables:
 * other modules call its service or react to its events and never write into its tables.
 */
export const MODULES = [core, iam, ui, eng, msg, sec, pol, mdm, fin, hr, bd, est, proj, engg, bud, plan, site, proc, inv, plant, qa, hse, rmc, ctr, bill, pay, portal, bi, ai];

export function mountModules(api, deps) {
  for (const m of MODULES) m.mount(api, { ...deps, modules: MODULES });
}
