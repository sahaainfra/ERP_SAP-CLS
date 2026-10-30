// npm run db:backup -- [--db <file>] [--dir backups] [--name <name>]
// Takes a verified backup (file + manifest with integrity result and per-table checksums). Safe while the app runs.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/server/platform/config/index.js';
import { createBackup } from './lib/backup.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const db = resolve(root, opt('db', null) ?? loadConfig().databasePath);
const name = opt('name', `backup-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`);
const r = createBackup(db, resolve(root, opt('dir', 'backups')), name);
const tables = Object.entries(r.manifest.tables);
console.log(`Backup ${name}: ${r.manifest.bytes} bytes, ${tables.length} tables, ${tables.reduce((n, [, t]) => n + t.rows, 0)} rows, integrity ${r.manifest.integrity}`);
console.log(`  file     ${r.file}\n  manifest ${r.manifestPath}\n  took     ${r.timings.totalMs} ms (copy ${r.timings.copyMs} ms, checksums ${r.timings.verifyMs} ms)`);
