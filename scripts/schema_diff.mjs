// Schema-diff: fails when an object in the locked baseline was altered or dropped (FR-06).
// Usage: node scripts/schema_diff.mjs [--migrations-dir <dir>] [--lock]
//   --lock  rewrites schema/baseline.json from the current migrations. Record why in docs/erp/DECISIONS.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffSchema, snapshotFromMigrations } from './lib/schema.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(root, 'schema', 'baseline.json');
const args = process.argv.slice(2);
const dirFlag = args.indexOf('--migrations-dir');
const migrationsDir = dirFlag >= 0 ? resolve(args[dirFlag + 1]) : join(root, 'migrations');

const current = snapshotFromMigrations(migrationsDir);

if (args.includes('--lock')) {
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Locked baseline with ${Object.keys(current).length} objects.`);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error('schema/baseline.json is missing. Run: node scripts/schema_diff.mjs --lock');
  process.exit(2);
}
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const problems = diffSchema(baseline, current);
const added = Object.keys(current).filter((n) => !(n in baseline));
if (problems.length) {
  console.error(`Schema-diff FAILED: ${problems.length} change(s) to locked objects:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Schema-diff OK: ${Object.keys(baseline).length} locked objects unchanged, ${added.length} new.`);
