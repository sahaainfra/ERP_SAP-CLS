// npm run migration:new -- <name> [--table proc_purchase_orders] [--numbered] [--money total_amount,tax_amount]
//                                 [--fk project_id=proj_projects,vendor_id=mst_vendors]
// Creates the next timestamped migration pair in migrations/. With --table the SQL follows the database standard:
// standard columns, indexes, (company_id, doc_no) key, non-negative integer money columns.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffoldMigration } from './lib/scaffold.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [name, ...rest] = process.argv.slice(2);
const opt = (n) => (rest.includes(`--${n}`) ? rest[rest.indexOf(`--${n}`) + 1] : null);
if (!name) {
  console.error('Usage: new_migration.mjs <name> [--table <module_table>] [--numbered] [--money a,b] [--fk col=table,col=table]');
  process.exit(2);
}
try {
  const r = scaffoldMigration(join(root, 'migrations'), name, {
    table: opt('table'),
    numbered: rest.includes('--numbered'),
    money: opt('money')?.split(',').filter(Boolean) ?? [],
    fks: opt('fk')?.split(',').filter(Boolean).map((p) => {
      const [column, references] = p.split('=');
      return { column, references };
    }) ?? [],
  });
  console.log(`Created ${r.upPath}\n        ${r.downPath}\nNext: edit them, add a row for ${r.id} to docs/erp/DB_CHANGES.md, run npm run erp:db-baseline and npm run erp:migration-check.`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
