// npm run erp:perf-baseline -- [--save] [--compare docs/erp/perf/baseline.json] [--duration 4000] [--concurrency 8] [--small]
// Runs the baseline load test of the critical journeys that exist today and writes reports/perf-baseline.json. With --save the
// report also becomes the stored baseline (docs/erp/perf/baseline.json). With --compare it exits 1 when a journey got slower by
// more than 25% (and 20 ms) than the given report.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareBaselines, runBaseline } from './lib/perf.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);

const report = await runBaseline({
  durationMs: Number(opt('duration', 4000)),
  concurrency: Number(opt('concurrency', 8)),
  ...(args.includes('--small') ? { size: { documents: 2000, bills: 2000, events: 10_000 } } : {}),
  log: (line) => console.log(line),
});

const text = `${JSON.stringify(report, null, 2)}\n`;
mkdirSync(resolve(root, 'reports'), { recursive: true });
writeFileSync(resolve(root, 'reports', 'perf-baseline.json'), text);
console.log('\nWrote reports/perf-baseline.json');
if (args.includes('--save')) {
  mkdirSync(resolve(root, 'docs', 'erp', 'perf'), { recursive: true });
  writeFileSync(resolve(root, 'docs', 'erp', 'perf', 'baseline.json'), text);
  console.log('Stored as the baseline: docs/erp/perf/baseline.json');
}

let failed = report.journeys.some((j) => j.errors > 0);
const missing = report.journeys.filter((j) => !j.meetsStandard);
if (missing.length) console.log(`\n${missing.length} journey(s) miss the standard: ${missing.map((j) => `${j.id} p95 ${j.p95Ms} ms > ${j.standardMs} ms`).join('; ')}`);
const compareTo = opt('compare', null);
if (compareTo) {
  const file = resolve(root, compareTo);
  if (!existsSync(file)) {
    console.error(`No baseline at ${compareTo}`);
    process.exit(1);
  }
  const diff = compareBaselines(JSON.parse(readFileSync(file, 'utf8')), report);
  console.log('\nAgainst the baseline:');
  for (const d of diff) console.log(`  ${d.id.padEnd(24)} ${d.status.padEnd(10)} ${d.baselineP95Ms ?? '-'} ms -> ${d.currentP95Ms} ms${d.changePct !== undefined ? ` (${d.changePct > 0 ? '+' : ''}${d.changePct}%)` : ''}`);
  if (diff.some((d) => d.status === 'regression')) failed = true;
}
process.exit(failed ? 1 : 0);
