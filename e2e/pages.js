import { readFileSync } from 'node:fs';

// The pages of the application as the client registers them (src/client/modules/*/index.js), for the checks of part 03.10 that visit every page.
const MODULES = ['core', 'iam', 'ui', 'eng', 'msg', 'pol', 'mdm', 'fin', 'hr', 'bd', 'est', 'proj'];
export function registeredPages() {
  const out = [];
  for (const module of MODULES) {
    const src = readFileSync(new URL(`../src/client/modules/${module}/index.js`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/\{ path: '([^']+)', label: '([^']+)'([^}]*?)Page: /g)) {
      out.push({ module, route: m[1], label: m[2], permission: /permission: '([^']+)'/.exec(m[3])?.[1] ?? null, onboardingOnly: /onboardingOnly: true/.test(m[3]) });
    }
  }
  return out;
}
/** The code of a page in the migration tracker: its route without the first slash, slashes as dots. */
export const pageCode = (route) => route.replace(/^\//, '').replace(/\//g, '.');
