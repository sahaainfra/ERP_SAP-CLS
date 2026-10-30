// npm run erp:db-baseline  -> rewrites docs/erp/DB_BASELINE.md from the migrations (FR-01).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migratedDatabase, renderBaseline } from './lib/schema_lint.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs', 'erp', 'DB_BASELINE.md');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, renderBaseline(migratedDatabase(join(root, 'migrations'))), 'utf8');
console.log(`Wrote ${out}`);
