// Turns the reviewed draft (scripts/gen_route_policy.mjs output) into src/server/platform/security/route-policy.js.
import { readFileSync, writeFileSync } from 'node:fs';

const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const q = (v) => (v === null || v === undefined ? 'null' : JSON.stringify(v).replace(/"/g, "'"));
const lines = rows.map((r) => `  { m: '${r.m}', p: '${r.p}', g: '${r.g}', k: ${q(r.k)}, s: ${q(r.s)}, scope: '${r.scope}', rate: '${r.rate}', audit: ${r.audit} },`);
writeFileSync('src/server/platform/security/route-policy.js', `// The route policy (part 02.07): every route of the application, with how it is protected. Read by the pipeline (platform/security/policy.js),
// checked at start-up and in CI (npm run erp:route-check), and shown on the Route Registry page. A route that is not listed here
// stops the application from starting in staging and production. Fields: m method, p path, g guard (permission, self, record, public,
// infra), k permission key or any-of list, s validation schema, scope what the route is scoped by, rate the rate-limit class,
// audit whether it changes data.
/** @type {{ m: string, p: string, g: 'permission' | 'self' | 'record' | 'public' | 'infra', k: string | string[] | null, s: string | null, scope: string, rate: string, audit: boolean }[]} */
export const ROUTE_POLICY = [
${lines.join('\n')}
];
`);
console.log(`${rows.length} routes`);
