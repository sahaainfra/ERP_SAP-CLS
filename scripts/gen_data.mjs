// npm run erp:gen-data -- [--out data/perf.sqlite] [--documents 100000] [--projects 50] [--companies 3] [--seed 1]
// Builds a performance-test database (separate from the demo seeds), checks its integrity and times the list
// queries. Prints the numbers; exits 1 on an integrity failure or a full table scan in a list query.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIntegrityRegistry } from '../src/server/platform/integrity/registry.js';
import { blocks, runChecks } from '../src/server/platform/integrity/index.js';
import { PERF_RULES, createPerfDatabase, measureQueries } from './lib/testdata.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const out = resolve(root, opt('out', 'data/perf.sqlite'));

const { db, counts, ms } = createPerfDatabase(out, {
  seed: Number(opt('seed', 1)),
  companies: Number(opt('companies', 3)),
  projects: Number(opt('projects', 50)),
  documents: Number(opt('documents', 100_000)),
});
console.log(`Generated ${counts.documents} documents, ${counts.lines} lines, ${counts.projects} projects, ${counts.companies} companies in ${ms} ms -> ${out}`);

const registry = createIntegrityRegistry();
registry.register(PERF_RULES);
registry.register({ companyOptional: ['perf_companies'] });
const run = runChecks(db, { registry });
for (const r of run.results) console.log(`  integrity ${r.status.toUpperCase().padEnd(14)} ${r.code} (checked ${r.checked}, failures ${r.failures})`);

const timings = measureQueries(db);
let scans = 0;
for (const [name, t] of Object.entries(timings)) {
  if (t.fullScan) scans++;
  console.log(`  ${name.padEnd(48)} p50 ${String(t.p50).padStart(7)} ms   p95 ${String(t.p95).padStart(7)} ms   ${t.fullScan ? 'FULL SCAN' : 'indexed'}`);
}
const bad = blocks(run, 'High') || scans > 0;
console.log(bad ? '\nFAILED' : '\nOK');
process.exit(bad ? 1 : 0);
