// npm run erp:db-check -- [--fresh] [--db <file>] [--record] [--json] [--fail-on Critical|High|Medium|Low]
// Runs the data-integrity suite (FR-03). With no options it checks the database in DATABASE_PATH if the file
// exists, otherwise a freshly migrated empty one. `--fresh` always uses a new in-memory database (what CI does).
// Exit code 1 when a failed check is at or above --fail-on (default Critical, BR-03): this blocks CI and deploys.
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/server/platform/config/index.js';
import { migrateUp, openDatabase } from '../src/server/platform/db/index.js';
import { blocks, runChecks } from '../src/server/platform/integrity/index.js';
import { recordRun } from '../src/server/modules/core/integrity/service.js';
import '../src/server/modules/registry.js'; // modules register their tables with the integrity registry

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);

let db;
let label;
if (args.includes('--fresh')) {
  db = new DatabaseSync(':memory:');
  migrateUp(db);
  label = 'a freshly migrated in-memory database';
} else {
  const file = opt('db', null) ?? (() => {
    try {
      return resolve(root, loadConfig().databasePath);
    } catch {
      return null;
    }
  })();
  if (file && existsSync(file)) {
    db = openDatabase(file);
    label = file;
  } else {
    db = new DatabaseSync(':memory:');
    label = 'a freshly migrated in-memory database (no database file found)';
  }
  migrateUp(db);
}

const run = runChecks(db);
if (args.includes('--record')) recordRun(db, run, { actor: 'cli' });
const failOn = opt('fail-on', 'Critical');
const blocked = blocks(run, failOn);

if (args.includes('--json')) {
  console.log(JSON.stringify(run, null, 2));
} else {
  console.log(`Integrity checks on ${label}`);
  for (const r of run.results) {
    const tag = r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : 'N/A ';
    console.log(`${tag}  ${r.severity.padEnd(8)} ${r.code.padEnd(26)} checked ${String(r.checked).padStart(3)}, failures ${r.failures}`);
    for (const s of r.status === 'fail' ? r.samples : []) console.log(`        ${JSON.stringify(s)}`);
  }
  console.log(`\n${run.summary.pass} passed, ${run.summary.fail} failed, ${run.summary.notApplicable} not applicable (nothing to check yet).`);
  console.log(blocked ? `Integrity gate FAILED: a ${failOn}-or-higher check failed.` : `Integrity gate OK (blocks on ${failOn} or higher).`);
}
process.exit(blocked ? 1 : 0);
