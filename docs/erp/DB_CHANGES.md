# DB_CHANGES

Every migration is additive, idempotent and reversible (`.up.sql` and `.down.sql`). Run `npm run migrate` and `npm run migrate:down`.

| Migration | Part | Adds | Reversal |
|---|---|---|---|
| 20261030000001_core_feature_flags | 00.02 | table `core_feature_flags` (scope columns, version, audit columns), unique scope index, company and project indexes | drops the table and its indexes |
| 20261030000002_core_audit_and_outbox | 00.02 | tables `core_audit_log`, `core_outbox` and their indexes | drops both tables |
| 20261030000003_seed_reference_feature_flags | 00.02 | reference-seed rows for `ff.prog.p0001` and `ff.prog.p0002` (default OFF; ON in development and test) | deletes those seed rows |
| 20261030000004_seed_flag_p0003 | 00.03 | reference-seed rows for `ff.prog.p0003` (default OFF; ON in development and test) | deletes those seed rows |
| 20261030000005_seed_flag_core_p0101 | 01.01 | reference-seed rows for `ff.core.p0101` (default OFF; ON in development and test) | deletes those seed rows |
| 20261030000006_core_database_foundation | 01.02 | tables `core_idempotency_keys` (replay protection), `core_integrity_runs` (integrity-check history), `core_backfill_runs` (back-fill ledger) and their indexes | drops the three tables |
| 20261030000007_seed_flag_core_p0102 | 01.02 | reference-seed rows for `ff.core.p0102` (default OFF; ON in development and test) | deletes those seed rows |

Existing objects altered or dropped: none. Schema-diff against `schema/baseline.json`: clean.

Parts 00.03 and 01.01 add no tables or columns; 01.02 adds three tables. Every migration is now verified in CI: it must apply, reverse to the exact previous schema and data, and re-apply (`npm run erp:migration-check`).
