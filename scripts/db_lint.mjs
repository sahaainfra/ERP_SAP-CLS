// npm run erp:db-lint -- [--migrations-dir <dir>]
// Checks the schema against the database standards (FR-05): standard columns on business tables, an index on every
// foreign key, integer minor units for money, a (company_id, doc_no) key, every migration registered in
// docs/erp/DB_CHANGES.md, and docs/erp/DB_BASELINE.md up to date. Errors exit 1; warnings are printed.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { integrityRegistry } from '../src/server/platform/integrity/index.js';
import '../src/server/modules/registry.js';
import { lintMigrationRegistry, lintSchema, migratedDatabase, renderBaseline } from './lib/schema_lint.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const i = args.indexOf('--migrations-dir');
const dir = i >= 0 ? resolve(args[i + 1]) : join(root, 'migrations');

const db = migratedDatabase(dir);
const { errors, warnings, tables } = lintSchema(db, integrityRegistry);
const changes = join(root, 'docs', 'erp', 'DB_CHANGES.md');
if (existsSync(changes)) errors.push(...lintMigrationRegistry(dir, readFileSync(changes, 'utf8')));
const baseline = join(root, 'docs', 'erp', 'DB_BASELINE.md');
if (i < 0) {
  const expected = renderBaseline(db);
  if (!existsSync(baseline) || readFileSync(baseline, 'utf8').replace(/\r\n/g, '\n') !== expected) {
    errors.push('docs/erp/DB_BASELINE.md is out of date: run `npm run erp:db-baseline` and commit it');
  }
}
for (const w of warnings) console.log(`warning  ${w}`);
for (const e of errors) console.error(`ERROR    ${e}`);
if (errors.length) {
  console.error(`\nSchema lint FAILED: ${errors.length} error(s), ${warnings.length} warning(s) in ${tables} tables.`);
  process.exit(1);
}
console.log(`Schema lint OK: ${tables} tables, ${warnings.length} warning(s).`);
