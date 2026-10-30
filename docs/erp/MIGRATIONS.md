# Migrations, back-fills, integrity and backups

How the database changes safely. Read `docs/erp/ARCHITECTURE.md` section 10 first for the rules; this page is the how-to.

## 1. Baseline (migration zero)
Part 00.01 found no database, so migration `20261030000001_core_feature_flags` is migration zero and `docs/erp/DB_BASELINE.md` is the schema as it stood at the end of part 01.02. The document is generated (`npm run erp:db-baseline`) and `npm run erp:db-lint` fails if it is stale. `schema/baseline.json` locks the objects that must never be altered or dropped (`npm run erp:schema-diff`); it is re-locked, with a reason in `DECISIONS.md`, when a part is accepted.

## 2. Writing a migration
1. `npm run migration:new -- <name>` (an empty additive pair) or `npm run migration:new -- <name> --table proc_orders --numbered --money total_amount --fk project_id=proj_projects` (a business table with the standard columns, indexes, key and non-negative money columns).
2. Files are `<14-digit UTC timestamp>_<name>.up.sql` and `.down.sql`. The id is always later than the previous one.
3. The up script is **additive and idempotent**: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `INSERT OR IGNORE`. Never alter, rename, retype or drop an object that exists; add a column or a table instead. Never edit a migration that has been merged.
4. The down script undoes exactly what the up script added.
5. Add a row to `docs/erp/DB_CHANGES.md`, run `npm run erp:db-baseline`.
6. `npm run erp:regression` runs everything below.

Each migration runs in one transaction. SQLite creates indexes without locking readers, so there is no separate "concurrent index" step today; when the database moves to PostgreSQL, create indexes with `CREATE INDEX CONCURRENTLY` outside the transaction (decision recorded in ADR-14).

## 3. What CI checks
| Command | Fails when |
|---|---|
| `npm run erp:migration-check` | a migration has no down script, the down script does not restore the exact schema and rows, or the up script cannot be re-applied |
| `npm run erp:db-lint` | a business table lacks a standard column, a foreign key has no index, a money/quantity column is not INTEGER, a numbered table lacks a `(company_id, doc_no)` unique key, a migration is missing from `DB_CHANGES.md`, `DB_BASELINE.md` is out of date |
| `npm run erp:db-check` | a **Critical** integrity check fails on a freshly migrated database (orphan foreign keys, duplicate business keys, header totals, unbalanced journals) |
| `npm run erp:schema-diff` | a locked object was altered or dropped |

## 4. Back-fills
A back-fill repairs data in batches after a schema change. Put it in `backfills/<name>.mjs`:

```js
export default {
  name: 'proc_orders_total_in_paise',
  description: 'Fill total_amount from the lines',
  run(db, { cursor, batchSize }) {
    // do one batch of work, starting after `cursor`
    return { nextCursor: '123', processed: 500, done: false };
  },
};
```

`npm run backfill -- --list` shows them, `npm run backfill -- <name> --batch 500` runs one. Every batch and its ledger update (`core_backfill_runs`) commit together, so a crash or a failed batch leaves nothing half-done and the next run resumes from the saved cursor. Each batch is written to the audit log. A completed back-fill is skipped. `--max-batches n` runs in slices.

## 5. Integrity checks
`npm run erp:db-check` (and Administration > Data Health, or `POST /api/v1/core/integrity/run` for ITADM) runs seven checks and stores the result in `core_integrity_runs`. A module tells the checks what the schema cannot say:

```js
integrityRegistry.register({
  companyOptional: ['core_feature_flags'],
  statuses: { proc_orders: ['DRAFT', 'APPROVED', 'CANCELLED'] },
  allowNegative: ['inv_stock_adjustments.quantity'],
  headerLines: [{ header: 'proc_orders', line: 'proc_order_lines', lineKey: 'order_id', headerTotal: 'total_amount', lineAmount: 'amount' }],
  journals: [{ table: 'fin_journal_lines', group: 'journal_id', debit: 'debit', credit: 'credit' }],
});
```
Tables that follow the standard column names are found automatically. `--fail-on High` also blocks on High failures. Results never contain amounts: samples are table, id, company and key only.

## 6. Backup and restore
- `npm run db:backup -- [--db file] [--dir backups] [--name n]` writes `<name>.sqlite` (a consistent copy, safe while the app runs) and `<name>.manifest.json` (file hash, SQLite integrity result, row count and hash of every table).
- `npm run db:restore -- <name>.manifest.json --to <database file> --yes` stops nothing by itself: **stop the application first**. It verifies the backup, puts it in place and re-checks the restored database against the manifest. A backup that fails verification is never restored and the target is left untouched.
- `npm run db:rehearse` does the whole drill on 100,000 documents and writes `reports/backup-rehearsal.json`. Run it before relying on a backup procedure, and after changing it.
- Backups taken by the deploy tool (`<env>/backups/`) use the same copy method.
Off-machine copies and full disaster recovery are part 29.06 (defect D-011).

## 7. Performance test data
`npm run erp:gen-data -- --documents 100000` builds a deterministic database (same seed, same data) of companies, projects, documents and lines in `data/perf.sqlite`, separate from the demo seeds. It runs the integrity suite on it and times the list and record queries, failing on a full table scan.
