// npm run db:restore -- <manifest.json> --to <database file> [--yes]
// Verifies a backup, puts it in place of the database and proves the result matches the manifest.
// Stop the application first. Refuses to overwrite an existing database unless --yes is given.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { restoreBackup } from './lib/backup.mjs';

const args = process.argv.slice(2);
// part 29.06 (BR-01): a production restore approved by ITADM and DIR in Backup & DR; the application must be stopped
if (args.includes('--approved')) {
  const { loadConfig } = await import('../src/server/platform/config/index.js');
  const { executeApprovedRestore } = await import('../src/server/modules/admin/backups.js');
  const config = loadConfig();
  const root = resolve(new URL('..', import.meta.url).pathname);
  const r = executeApprovedRestore({ dbPath: resolve(root, config.databasePath), requestId: args[args.indexOf('--approved') + 1], secret: config.backupKey ?? config.vaultKey ?? 'development-backup-key-not-for-production-use', storagePath: config.storagePath ?? resolve(root, 'data'), by: process.env.USER ?? 'operator' });
  if (!r.ok) { console.error(`Restore refused:\n  - ${r.problems.join('\n  - ')}`); process.exit(1); }
  console.log(`Restored ${r.backup}. The database as it was before is kept at ${r.safetyCopy}.`);
  process.exit(0);
}
const manifest = args[0];
const to = args.includes('--to') ? args[args.indexOf('--to') + 1] : null;
if (!manifest || !to) {
  console.error('Usage: db_restore.mjs <backup.manifest.json> --to <database file> [--yes]');
  process.exit(2);
}
if (existsSync(resolve(to)) && !args.includes('--yes')) {
  console.error(`${resolve(to)} exists. Restoring replaces it; run again with --yes if that is what you want.`);
  process.exit(2);
}
const r = restoreBackup(resolve(manifest), resolve(to));
if (!r.ok) {
  console.error(`Restore FAILED:\n  - ${r.problems.join('\n  - ')}`);
  process.exit(1);
}
const rows = Object.values(r.manifest.tables).reduce((n, t) => n + t.rows, 0);
console.log(`Restored ${r.manifest.name} to ${resolve(to)}: ${Object.keys(r.manifest.tables).length} tables, ${rows} rows, checksums identical.`);
console.log(`  took ${r.timings.totalMs} ms (verify ${r.timings.verifyMs} ms, copy ${r.timings.copyMs} ms, re-check ${r.timings.checkMs} ms)`);
