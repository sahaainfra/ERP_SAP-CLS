# DB_CHANGES

Every migration is additive, idempotent and reversible (`.up.sql` and `.down.sql`). Run `npm run migrate` and `npm run migrate:down`.

| Migration | Part | Adds | Reversal |
|---|---|---|---|
| 20261030000001_core_feature_flags | 00.02 | table `core_feature_flags` (scope columns, version, audit columns), unique scope index, company and project indexes | drops the table and its indexes |
| 20261030000002_core_audit_and_outbox | 00.02 | tables `core_audit_log`, `core_outbox` and their indexes | drops both tables |
| 20261030000003_seed_reference_feature_flags | 00.02 | reference-seed rows for `ff.prog.p0001` and `ff.prog.p0002` (default OFF; ON in development and test) | deletes those seed rows |

Existing objects altered or dropped: none. Schema-diff against `schema/baseline.json`: clean.
