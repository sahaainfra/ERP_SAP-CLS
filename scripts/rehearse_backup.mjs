// npm run db:rehearse -- [--documents 100000]
// Backup and restore rehearsal (FR-08, AC-04): build a database of realistic size, back it up, destroy it, restore
// it and prove the checksums are identical. Prints the timings and writes reports/backup-rehearsal.json.
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackup, restoreBackup } from './lib/backup.mjs';
import { createPerfDatabase } from './lib/testdata.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const documents = Number(args.includes('--documents') ? args[args.indexOf('--documents') + 1] : 100_000);
const work = join(root, '.deploy-rehearsal', 'backup');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const dbFile = join(work, 'staging.sqlite');

const gen = createPerfDatabase(dbFile, { documents });
gen.db.close();
const bytes = statSync(dbFile).size;
const backup = createBackup(dbFile, join(work, 'backups'), 'rehearsal');
rmSync(dbFile, { force: true });
for (const s of ['-wal', '-shm']) rmSync(`${dbFile}${s}`, { force: true });
const restored = restoreBackup(backup.manifestPath, dbFile);

const report = {
  documents,
  rows: Object.values(backup.manifest.tables).reduce((n, t) => n + t.rows, 0),
  databaseBytes: bytes,
  generateMs: gen.ms,
  backupMs: backup.timings.totalMs,
  restoreMs: restored.timings.totalMs,
  restoreTimings: restored.timings,
  identical: restored.ok,
  problems: restored.problems,
};
mkdirSync(join(root, 'reports'), { recursive: true });
writeFileSync(join(root, 'reports', 'backup-rehearsal.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Database: ${report.rows} rows, ${(bytes / 1048576).toFixed(1)} MB (generated in ${gen.ms} ms)`);
console.log(`Backup:   ${report.backupMs} ms (copy ${backup.timings.copyMs} ms, checksums ${backup.timings.verifyMs} ms)`);
console.log(`Restore:  ${report.restoreMs} ms (verify ${restored.timings.verifyMs} ms, copy ${restored.timings.copyMs} ms, re-check ${restored.timings.checkMs} ms)`);
console.log(report.identical ? 'Checksums identical after restore.' : `RESTORE MISMATCH: ${restored.problems.join('; ')}`);
process.exit(report.identical ? 0 : 1);
