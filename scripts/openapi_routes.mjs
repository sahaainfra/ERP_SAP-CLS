#!/usr/bin/env node
// Audit AUD-DEF-005: every declared route is documented in OpenAPI.
//   node scripts/openapi_routes.mjs --write   writes docs/erp/routes-openapi.yaml for the routes no hand-written file documents
//   node scripts/openapi_routes.mjs --check   fails when a declared route is in no OpenAPI file, a documented operation has no route,
//                                             or routes-openapi.yaml is not what --write would write (a regression stage)
// The hand-written files (openapi.yaml and the module files) describe their routes in the words of the requirements and take precedence.
// The generated file describes the rest from the route policy (src/server/platform/security/route-policy.js), the one place every
// route is declared: method, path and its parameters, guard and permission, data scope, rate class, audit, idempotency, and the
// validator that defines the input (its body schema is not repeated here: the validator in the module's validators file is the contract).
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTE_POLICY } from '../src/server/platform/security/route-policy.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(root, 'docs', 'erp');
const GENERATED = 'routes-openapi.yaml';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** A route's identity regardless of how a file spells it: method, full path, parameters as ':'. */
export const routeKey = (method, path) => `${method.toUpperCase()} ${path.replace(/\{[^}]+\}/g, ':').replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':').replace(/\/+$/, '')}`;
const fullPath = (p) => (/^\/(api|health|metrics)(\/|$)/.test(p) ? p : `/api/v1${p}`);

/** The operations of one OpenAPI file (both the block and the flow styles of the hand-written files). */
export function operationsOf(text) {
  const ops = []; let current = null;
  for (const line of text.split('\n')) {
    const path = /^ {2}(\/[^:\s]*):\s*(.*)$/.exec(line);
    if (path) {
      current = fullPath(path[1]);
      for (const m of METHODS) if (new RegExp(`(^|[{,]\\s*)${m}\\s*:`).test(path[2])) ops.push(routeKey(m, current));
      continue;
    }
    if (/^\S/.test(line)) { current = null; continue; }
    const method = /^ {4}(get|post|put|patch|delete)\s*:/.exec(line);
    if (current && method) ops.push(routeKey(method[1], current));
  }
  return ops;
}

const handWritten = () => readdirSync(DOCS).filter((f) => /openapi\.yaml$/.test(f) && f !== GENERATED);
const documented = () => new Set(handWritten().flatMap((f) => operationsOf(readFileSync(join(DOCS, f), 'utf8'))));

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const GUARD = { permission: 'needs the permission', self: 'any signed-in person (the service decides what they see)', public: 'public (no sign-in)', infra: 'infrastructure (health token or permission)' };
function operation(r) {
  const params = [...r.p.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
  const write = r.m !== 'GET';
  const who = r.g === 'permission' ? `${GUARD.permission} ${r.k}` : GUARD[r.g] ?? r.g;
  const summary = `${r.m} ${r.p.replace(/^\/api\/v1/, '')}: ${who}; scope ${r.scope}`;
  const lines = [`    ${r.m.toLowerCase()}:`, `      summary: ${q(summary)}`];
  lines.push(`      description: ${q(`Generated from the route policy. Rate class ${r.rate}${r.audit ? '; audited' : ''}${write ? '; send an Idempotency-Key' : ''}.${r.s ? ` The input is defined by ${r.s} in the module's validators.` : ''}`)}`);
  lines.push(`      x-erp-guard: ${r.g}`); if (r.k) lines.push(`      x-erp-permission: ${r.k}`);
  lines.push(`      x-erp-scope: ${r.scope}`, `      x-erp-rate: ${r.rate}`, `      x-erp-audited: ${Boolean(r.audit)}`); if (r.s) lines.push(`      x-erp-validator: ${r.s}`);
  const ps = [...params.map((n) => `        - { name: ${n}, in: path, required: true, schema: { type: string } }`), ...(write ? ['        - { name: Idempotency-Key, in: header, required: false, schema: { type: string, minLength: 8, maxLength: 128 } }'] : [])];
  if (ps.length) lines.push('      parameters:', ...ps);
  if (['POST', 'PUT', 'PATCH'].includes(r.m)) lines.push('      requestBody: { required: false, content: { application/json: { schema: { type: object } } } }');
  lines.push('      responses:', `        '${r.m === 'POST' ? '200' : '200'}': { description: 'The result in { data } (lists also carry meta)' }`,
    "        '400': { $ref: '#/components/responses/Error' }", "        '401': { $ref: '#/components/responses/Error' }", "        '403': { $ref: '#/components/responses/Error' }",
    "        '404': { $ref: '#/components/responses/Error' }", ...(write ? ["        '409': { $ref: '#/components/responses/Error' }", "        '422': { $ref: '#/components/responses/Error' }"] : []));
  return lines;
}

export function generate() {
  const have = documented();
  const missing = ROUTE_POLICY.filter((r) => !have.has(routeKey(r.m, r.p)));
  const byPath = new Map(); for (const r of missing) { if (!byPath.has(r.p)) byPath.set(r.p, []); byPath.get(r.p).push(r); }
  const out = ["openapi: 3.0.3", "info:", "  title: 'ERP routes documented from the route policy'", "  version: 1.0.0",
    `  description: ${q(`Generated by scripts/openapi_routes.mjs (audit AUD-DEF-005); do not edit by hand. ${missing.length} operations that no hand-written OpenAPI file documents, from the route policy. Every route needs the module flag of its part; writes take an Idempotency-Key; errors use the common envelope with a correlation ID.`)}`,
    'servers:', '  - url: /', 'paths:'];
  for (const [p, rs] of [...byPath.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`  ${p.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')}:`);
    for (const r of rs) out.push(...operation(r));
  }
  out.push('components:', '  responses:', '    Error:', "      description: 'The error envelope: { error: { code, message, details[], correlationId } }'",
    '      content: { application/json: { schema: { type: object, properties: { error: { type: object, properties: { code: { type: string }, message: { type: string }, details: { type: array, items: { type: object } }, correlationId: { type: string } } } } } } }');
  return { text: `${out.join('\n')}\n`, count: missing.length };
}

const args = process.argv.slice(2);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (args.includes('--write')) {
    const { text, count } = generate(); writeFileSync(join(DOCS, GENERATED), text);
    console.log(`Wrote docs/erp/${GENERATED}: ${count} operations from the route policy.`);
  } else {
    const problems = [];
    const { text, count } = generate();
    const current = existsSync(join(DOCS, GENERATED)) ? readFileSync(join(DOCS, GENERATED), 'utf8') : '';
    if (current !== text) problems.push(`docs/erp/${GENERATED} is out of date (run node scripts/openapi_routes.mjs --write)`);
    const declared = new Set(ROUTE_POLICY.map((r) => routeKey(r.m, r.p)));
    const all = [...handWritten(), GENERATED].flatMap((f) => (existsSync(join(DOCS, f)) ? operationsOf(readFileSync(join(DOCS, f), 'utf8')).map((op) => [f, op]) : []));
    const stale = all.filter(([, op]) => !declared.has(op));
    for (const [f, op] of stale) problems.push(`${f}: ${op} is documented but no route is declared for it`);
    if (problems.length) { console.log(`OpenAPI check FAILED:\n${problems.map((x) => `- ${x}`).join('\n')}`); process.exit(1); }
    console.log(`OpenAPI check OK: ${declared.size} routes, ${declared.size - count} in the hand-written files, ${count} generated from the route policy; none stale.`);
  }
}
