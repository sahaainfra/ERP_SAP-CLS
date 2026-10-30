// Usage: node scripts/coverage_gate.mjs [--lcov coverage/lcov.info] [--base origin/main] [--min 60]
// Run `npm run test:coverage` first. COVERAGE_MIN and COVERAGE_BASE can set the defaults (CI).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedFiles, gateCoverage, parseLcov } from './lib/coverage.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const lcovPath = resolve(root, opt('lcov', 'coverage/lcov.info'));
const min = Number(opt('min', process.env.COVERAGE_MIN ?? '60'));
const base = opt('base', process.env.COVERAGE_BASE ?? 'origin/main');

if (!existsSync(lcovPath)) {
  console.error(`No coverage data at ${lcovPath}. Run: npm run test:coverage`);
  process.exit(2);
}
const lcov = readFileSync(lcovPath, 'utf8');
let changed = changedFiles(root, base);
let scope = `changed against ${base}`;
if (changed === null) {
  const all = Object.keys(parseLcov(lcov));
  changed = all.map((f) => f.slice(Math.max(f.search(/(src\/server|scripts\/lib)\//), 0)));
  scope = `all measured files (base ${base} not found)`;
}
const { failures, checked } = gateCoverage({ lcov, changed, minPercent: min });
for (const c of checked) console.log(`${c.percent >= min ? 'ok  ' : 'LOW '} ${String(c.percent).padStart(5)}%  ${c.file}`);
if (failures.length) {
  console.error(`Coverage gate FAILED: ${failures.length} file(s) below ${min}% (${scope}).`);
  process.exit(1);
}
console.log(`Coverage gate OK: ${checked.length} file(s) at or above ${min}% (${scope}).`);
