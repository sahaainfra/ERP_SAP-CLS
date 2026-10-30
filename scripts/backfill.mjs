// npm run backfill -- --list | <name> [--batch 500] [--max-batches n]
// Runs a back-fill from backfills/<name>.mjs (default export: { name, description, run }). Resumable and logged:
// see src/server/platform/db/backfill.js and docs/erp/MIGRATIONS.md.
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from '../src/server/platform/config/index.js';
import { migrateUp, openDatabase } from '../src/server/platform/db/index.js';
import { listBackfillRuns, runBackfill } from '../src/server/platform/db/backfill.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'backfills');
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);

async function available() {
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.mjs'));
  } catch {
    /* no back-fills yet */
  }
  const out = [];
  for (const f of files) out.push((await import(pathToFileURL(join(dir, f)).href)).default);
  return out;
}

const db = openDatabase(loadConfig().databasePath);
migrateUp(db);
const backfills = await available();

if (args.includes('--list') || args.length === 0) {
  const ledger = new Map(listBackfillRuns(db).map((r) => [r.name, r]));
  if (backfills.length === 0) console.log('No back-fills defined (backfills/*.mjs).');
  for (const b of backfills) {
    const r = ledger.get(b.name);
    console.log(`${b.name.padEnd(36)} ${r ? `${r.status}, ${r.processed} rows, ${r.batches} batches` : 'not started'}  ${b.description ?? ''}`);
  }
  process.exit(0);
}

const wanted = backfills.find((b) => b.name === args[0]);
if (!wanted) {
  console.error(`No back-fill named "${args[0]}". Run with --list.`);
  process.exit(1);
}
const result = runBackfill(db, wanted, { actor: 'cli', batchSize: Number(opt('batch', 500)), maxBatches: Number(opt('max-batches', Infinity)) });
console.log(JSON.stringify(result));
process.exit(result.status === 'failed' ? 1 : 0);
