// Usage: node scripts/rehearse_zero_downtime.mjs [--post <base url>]
// Part 30.08 T-01: blue-green deploy and rollback under steady traffic, with the two failure drills, on a local "staging" directory.
// Writes docs/erp/perf/zero-downtime.json (the evidence of T-01); with --post records the rehearsal on the Operations page of that installation (development headers
// or ERP_TOKEN). Exit code 1 if any step fails or any request failed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rehearseZeroDowntime } from './lib/zero_downtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const result = await rehearseZeroDowntime({ root, workDir: join(root, '.deploy-zero-downtime'), basePort: Number(process.env.ZD_PORT ?? 3392), log: () => {} });
for (const s of result.steps) console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.name} (${s.ms} ms) ${s.detail}${s.traffic ? ` [${s.traffic.requests} requests, ${s.traffic.failed} failed, builds ${s.traffic.builds.join(' → ')}]` : ''}`);
mkdirSync(join(root, 'docs', 'erp', 'perf'), { recursive: true });
const report = { ...result, at: new Date().toISOString() };
writeFileSync(join(root, 'docs', 'erp', 'perf', 'zero-downtime.json'), `${JSON.stringify(report, null, 2)}\n`);
const i = args.indexOf('--post');
if (i >= 0) {
  const token = process.env.ERP_TOKEN;
  const r = await fetch(`${args[i + 1]}/api/v1/tst/ops/rehearsals`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `zd-${Date.now()}`, ...(token ? { authorization: `Bearer ${token}` } : { 'x-erp-user': 'devops-rehearsal', 'x-erp-roles': 'ITADM', 'x-erp-company': process.env.ERP_COMPANY ?? '1' }) }, body: JSON.stringify({ environment: 'staging', kind: 'ZERO_DOWNTIME', ok: result.ok, requests: result.requests, failed: result.failed, steps: result.steps.map((s) => ({ name: s.name, ok: s.ok, ms: s.ms, detail: s.detail.slice(0, 300) })) }) });
  console.log(r.ok ? 'Recorded on the Operations page.' : `Could not record: ${r.status}`);
}
console.log(result.ok ? `\nZero-downtime rehearsal PASSED: ${result.requests} requests, 0 failed.` : '\nZero-downtime rehearsal FAILED.');
process.exit(result.ok ? 0 : 1);
