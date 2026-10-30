// Usage: node scripts/migration_check.mjs [--migrations-dir <dir>]
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMigrations } from './lib/migration_check.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const i = args.indexOf('--migrations-dir');
const dir = i >= 0 ? resolve(args[i + 1]) : join(root, 'migrations');
const problems = checkMigrations(dir);
if (problems.length) {
  console.error(`Migration check FAILED (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('Migration check OK: every migration applies, reverses cleanly and re-applies.');
