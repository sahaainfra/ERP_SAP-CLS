#!/usr/bin/env node
// Part 30.04 FR-01: records a run of a test suite in the test catalogue. Reads the JUnit output of
//   node --test --test-reporter=junit --test-reporter-destination=results.xml "tests/*.test.js"
//   npx playwright test --reporter=junit (PLAYWRIGHT_JUNIT_OUTPUT_NAME=results.xml)
// and posts it to POST /api/v1/tst/test-runs (after POST /api/v1/tst/tests/sync).
// Usage: node scripts/test_results.mjs results.xml [--suite UNIT_API|E2E|VISUAL|AUTHZ|PERF|ALL] [--source CI|LOCAL|SANDBOX]
//        [--base http://127.0.0.1:3000] [--token <bearer>] [--commit <sha>] [--dry-run]
// Without a token it signs in with the development headers as an IT administrator (development and sandbox installations only).
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { parseJunit } from '../src/server/modules/tst/catalogue.js';

const args = process.argv.slice(2);
const opt = (name, d = null) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : d; };
const file = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
if (!file) { console.error('usage: node scripts/test_results.mjs results.xml [--suite …] [--source …] [--base …] [--token …]'); process.exit(2); }
const results = parseJunit(readFileSync(file, 'utf8'));
const counts = results.reduce((a, r) => ({ ...a, [r.result]: (a[r.result] ?? 0) + 1 }), {});
console.log(`${results.length} results: ${JSON.stringify(counts)}`);
if (args.includes('--dry-run')) process.exit(0);
let commit = opt('commit'); try { commit ??= execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
const base = opt('base', process.env.ERP_BASE_URL ?? 'http://127.0.0.1:3000');
const token = opt('token', process.env.ERP_TOKEN ?? null);
const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : { 'x-erp-user': 'qa-runner', 'x-erp-roles': 'ITADM', 'x-erp-company': process.env.ERP_COMPANY ?? '1' }) };
const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { ...headers, 'idempotency-key': `results-${Date.now()}-${Math.random().toString(36).slice(2)}` }, body: JSON.stringify(body) }); const j = await r.json().catch(() => null); if (!r.ok) throw new Error(`${path}: ${r.status} ${j?.error?.message ?? ''}`); return j.data; };
console.log('sync', await post('/api/v1/tst/tests/sync', {}));
let out = null;
// the API takes bodies up to 50 kB: batches of about 40 kB, each after the first naming the run it adds to
const batches = []; let cur = []; let size = 0;
for (const r of results) { const n = JSON.stringify(r).length + 1; if (cur.length && (size + n > 40_000 || cur.length >= 1000)) { batches.push(cur); cur = []; size = 0; } cur.push(r); size += n; }
if (cur.length) batches.push(cur);
for (const b of batches) out = await post('/api/v1/tst/test-runs', { source: opt('source', process.env.CI ? 'CI' : 'LOCAL'), suite: opt('suite', 'UNIT_API'), ...(commit ? { commitRef: commit } : {}), ...(out ? { runId: out.id } : {}), results: b });
if (!out) process.exit(0);
console.log(`run ${out.runNo} recorded (${results.length} results; the last batch: ${out.passed} pass, ${out.failed} fail, ${out.unmatched} not in the catalogue)`);
if (counts.FAIL) process.exitCode = 1;
