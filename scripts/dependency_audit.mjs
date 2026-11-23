#!/usr/bin/env node
// Part 30.05 FR-02: the dependency audit. Runs `npm audit --json` (or reads a saved report: --file audit.json) and records each advisory
// as a DEPENDENCIES finding (POST /api/v1/tst/security/scans/results) with --post; npm severities map to critical, high, moderate → MEDIUM, low.
// Usage: node scripts/dependency_audit.mjs [--file audit.json] [--post] [--base http://127.0.0.1:3000] [--token …]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
let text;
if (opt('file')) text = readFileSync(opt('file'), 'utf8');
else { try { text = execFileSync('npm', ['audit', '--json', '--omit=dev'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (err) { text = err.stdout ?? ''; } }
let report; try { report = JSON.parse(text); } catch { console.error('npm audit gave no JSON (no network to the registry?)'); process.exit(2); }
const SEV = { critical: 'CRITICAL', high: 'HIGH', moderate: 'MEDIUM', low: 'LOW', info: 'INFO' };
const findings = [];
for (const [name, v] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of (v.via ?? []).filter((x) => typeof x === 'object')) {
    const ghsa = /GHSA-[\w-]+/.exec(via.url ?? '')?.[0];
    findings.push({ severity: SEV[via.severity] ?? 'MEDIUM', rule: 'npm-audit', title: `${name}: ${via.title}`.slice(0, 300), endpoint: `${name}@${v.range ?? '*'}`, ...(ghsa ? { cwe: ghsa } : {}), description: `${via.url ?? ''} ${v.fixAvailable ? 'A fix is available.' : 'No fix yet.'}`.trim(), key: `${name}|${via.source ?? via.url ?? via.title}` });
  }
}
const deps = report.metadata?.dependencies?.total ?? report.metadata?.totalDependencies ?? 0;
console.log(`${deps} dependencies, ${findings.length} advisories`);
for (const f of findings) console.log(`  ${f.severity.padEnd(8)} ${f.title}`);
if (args.includes('--post')) {
  const base = opt('base', process.env.ERP_BASE_URL ?? 'http://127.0.0.1:3000'); const token = opt('token', process.env.ERP_TOKEN ?? null);
  const r = await fetch(`${base}/api/v1/tst/security/scans/results`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `deps-${Date.now()}`, ...(token ? { authorization: `Bearer ${token}` } : { 'x-erp-user': 'dependency-audit', 'x-erp-roles': 'ITADM', 'x-erp-company': process.env.ERP_COMPANY ?? '1' }) }, body: JSON.stringify({ kind: 'DEPENDENCIES', checked: deps, findings: findings.slice(0, 200) }) });
  const j = await r.json().catch(() => null); console.log(r.ok ? `recorded as ${j.data.runNo}` : `could not record: ${r.status} ${j?.error?.message ?? ''}`);
}
process.exit(findings.some((f) => ['CRITICAL', 'HIGH'].includes(f.severity)) ? 1 : 0);
