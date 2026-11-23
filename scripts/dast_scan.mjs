#!/usr/bin/env node
// Part 30.05 FR-02: the dynamic scan (DAST) of a running installation. It probes what an attacker sees from outside:
//  - the security headers of the page and the API (CSP, nosniff, framing, referrer, permissions, HSTS over https, no-store on the API);
//  - CORS from a foreign origin; error responses that leak stack traces or file paths; a request body over the limit;
//  - every guarded list (GET without a path parameter) as an administrator with injection payloads in `q`: no server error, no SQL error text;
//  - path traversal on the file routes; every route signed out answers 401 (sampled).
// Usage: node scripts/dast_scan.mjs [--base https://erp.example.com] [--post] [--out report.json] [--limit 400]
// Without --base it starts the application in this process on an empty database (CI). With --post the findings are recorded as a DAST
// scan (POST /api/v1/tst/security/scans/results) of the installation at --base, as an IT administrator (development headers) or --token.
import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
let base = opt('base'); let close = async () => {};
if (!base) {
  const { loadConfig } = await import('../src/server/platform/config/index.js');
  const { migrateUp } = await import('../src/server/platform/db/index.js');
  const { createApp } = await import('../src/server/app.js');
  const { silentLogger } = await import('../src/server/platform/http/logger.js');
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys = ON;'); migrateUp(db);
  const app = createApp({ config: loadConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', AUTH_MODE: 'dev-headers' }), db, logger: silentLogger });
  const { securityOf } = await import('../src/server/platform/security/index.js'); securityOf(db).limiter.suspend(true);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`; close = () => new Promise((r) => server.close(r));
}
const token = opt('token', process.env.ERP_TOKEN ?? null);
const admin = token ? { authorization: `Bearer ${token}` } : { 'x-erp-user': 'dast-scanner', 'x-erp-roles': 'SYSADM', 'x-erp-company': process.env.ERP_COMPANY ?? '1' };
const findings = []; let checked = 0;
const add = (severity, rule, title, endpoint, cwe, description = '') => findings.push({ severity, rule, title, endpoint, cwe, description: description.slice(0, 1500) });
const req = async (method, path, { headers = {}, body } = {}) => { checked += 1; const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body, redirect: 'manual' }); const text = await r.text(); return { status: r.status, headers: r.headers, text }; };
const LEAK = /\bat [\w.<>]+ \(?(?:file:\/\/|\/)[^)]*:\d+:\d+|\/src\/server\/|node_modules\/|SQLITE_ERROR|syntax error|no such (?:table|column)/i;

// 1. headers
for (const path of ['/', '/api/v1/core/session']) {
  const r = await req('GET', path, { headers: path === '/' ? {} : admin });
  const h = (n) => r.headers.get(n);
  if (!h('x-content-type-options')?.includes('nosniff')) add('MEDIUM', 'HEADER', `No X-Content-Type-Options: nosniff on ${path}`, `GET ${path}`, 'CWE-693');
  if (!(h('x-frame-options') || /frame-ancestors/.test(h('content-security-policy') ?? ''))) add('MEDIUM', 'HEADER', `The page can be framed (no X-Frame-Options or frame-ancestors) on ${path}`, `GET ${path}`, 'CWE-1021');
  if (path === '/' && r.status === 200 && !h('content-security-policy')) add('MEDIUM', 'HEADER', 'No Content-Security-Policy on the application page', 'GET /', 'CWE-693');
  if (!h('referrer-policy')) add('LOW', 'HEADER', `No Referrer-Policy on ${path}`, `GET ${path}`, 'CWE-200');
  if (base.startsWith('https:') && !h('strict-transport-security')) add('HIGH', 'HEADER', `No Strict-Transport-Security over https on ${path}`, `GET ${path}`, 'CWE-319');
  if (h('x-powered-by')) add('LOW', 'HEADER', `The server announces itself (X-Powered-By: ${h('x-powered-by')})`, `GET ${path}`, 'CWE-200');
  if (path.startsWith('/api') && r.status === 200 && !/no-store|private/.test(h('cache-control') ?? '')) add('MEDIUM', 'CACHE', `A personal API answer may be cached (Cache-Control: ${h('cache-control') ?? 'none'})`, `GET ${path}`, 'CWE-525');
}
// 2. CORS from a foreign origin
{
  const r = await req('GET', '/api/v1/core/session', { headers: { ...admin, origin: 'https://evil.example' } });
  const allow = r.headers.get('access-control-allow-origin');
  if (allow === '*' || allow === 'https://evil.example') add(r.headers.get('access-control-allow-credentials') === 'true' ? 'HIGH' : 'MEDIUM', 'CORS', `CORS lets a foreign origin read the API (${allow})`, 'GET /api/v1/core/session', 'CWE-942');
}
// 3. errors that leak, and the body limit
for (const [method, path, body] of [['GET', '/api/v1/no-such-route', undefined], ['POST', '/api/v1/core/financial-years', '{"startDate": '], ['GET', '/api/v1/core/files/abc', undefined]]) {
  const r = await req(method, path, { headers: admin, body });
  if (LEAK.test(r.text)) add('MEDIUM', 'ERROR_LEAK', `An error answer shows internals (${method} ${path})`, `${method} ${path}`, 'CWE-209', r.text.slice(0, 300));
  if (r.status >= 500) add('MEDIUM', 'SERVER_ERROR', `A malformed request causes a server error (${method} ${path}: ${r.status})`, `${method} ${path}`, 'CWE-755');
}
{ const r = await req('POST', '/api/v1/core/financial-years', { headers: admin, body: JSON.stringify({ x: 'a'.repeat(1_100_000) }) }); if (r.status !== 413) add('MEDIUM', 'BODY_LIMIT', `A 1 MB body is accepted (${r.status})`, 'POST /api/v1/core/financial-years', 'CWE-770'); }
// 4. injection payloads on every guarded list
const { ROUTE_POLICY } = await import('../src/server/platform/security/route-policy.js');
const lists = ROUTE_POLICY.filter((r) => r.m === 'GET' && r.g === 'permission' && !r.p.includes(':') && !/export|pdf|xlsx|csv|download/.test(r.p)).slice(0, Number(opt('limit', 2000)));
const PAYLOADS = ["' OR '1'='1' --", '"><script>alert(1)</script>', '../../../../etc/passwd', '%00', "1; DROP TABLE iam_users; --"];
for (const r of lists) {
  for (const p of PAYLOADS) {
    const x = await req('GET', `${r.p}?q=${encodeURIComponent(p)}`, { headers: admin });
    if (x.status >= 500) { add('HIGH', 'INJECTION_500', `An injection payload causes a server error: GET ${r.p}`, `GET ${r.p}`, 'CWE-74', `q=${p} → ${x.status}`); break; }
    if (LEAK.test(x.text)) { add('HIGH', 'INJECTION_LEAK', `An injection payload shows database or code internals: GET ${r.p}`, `GET ${r.p}`, 'CWE-89', x.text.slice(0, 300)); break; }
  }
}
// 5. path traversal on files; 6. signed out (sampled)
for (const p of ['/api/v1/core/files/..%2f..%2f..%2fetc%2fpasswd', '/api/v1/core/files/1/download?name=../../../../etc/passwd']) { const x = await req('GET', p, { headers: admin }); if (/root:.*:0:0:/.test(x.text)) add('CRITICAL', 'TRAVERSAL', `Path traversal reads server files: ${p}`, `GET ${p}`, 'CWE-22'); }
for (const r of ROUTE_POLICY.filter((x) => !['public', 'infra'].includes(x.g)).filter((_, i) => i % 25 === 0)) { const x = await req(r.m, r.p.replace(/:[A-Za-z0-9_]+/g, '1'), { body: r.m === 'GET' ? undefined : '{}' }); if (x.status !== 401) add('HIGH', 'NO_AUTH', `A guarded route answers signed out: ${r.m} ${r.p} (${x.status})`, `${r.m} ${r.p}`, 'CWE-306'); }

const bySeverity = findings.reduce((a, f) => ({ ...a, [f.severity]: (a[f.severity] ?? 0) + 1 }), {});
console.log(`DAST of ${base}: ${checked} requests, ${lists.length} lists probed, ${findings.length} findings ${JSON.stringify(bySeverity)}`);
for (const f of findings) console.log(`  ${f.severity.padEnd(8)} ${f.rule.padEnd(14)} ${f.title}`);
const out = opt('out'); if (out) writeFileSync(out, JSON.stringify({ base, checked, findings }, null, 2));
if (args.includes('--post')) {
  const target = opt('base') ?? base;
  const r = await fetch(`${target}/api/v1/tst/security/scans/results`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `dast-${Date.now()}`, ...(token ? { authorization: `Bearer ${token}` } : { 'x-erp-user': 'dast-scanner', 'x-erp-roles': 'ITADM', 'x-erp-company': process.env.ERP_COMPANY ?? '1' }) }, body: JSON.stringify({ kind: 'DAST', checked, findings: findings.slice(0, 200) }) });
  const j = await r.json().catch(() => null); console.log(r.ok ? `recorded as ${j.data.runNo}: ${j.data.summary.raised} new, ${j.data.summary.reopened} reopened` : `could not record: ${r.status} ${j?.error?.message ?? ''}`);
}
await close();
process.exit(findings.some((f) => ['CRITICAL', 'HIGH'].includes(f.severity)) ? 1 : 0);
