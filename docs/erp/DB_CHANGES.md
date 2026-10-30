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
| 20261030000008_core_system_configuration | 01.03 | tables `core_company_settings`, `core_financial_years`, `core_periods` (per-module status), `core_parameters` (typed, scoped, effective-dated), `core_holiday_calendars`, `core_holidays` and their indexes | drops the six tables |
| 20261030000009_core_numbering_and_approvals | 01.03 | tables `core_document_types`, `core_number_series`, `core_number_counters`, `core_number_issues`, `core_change_requests`, `core_change_request_steps`, `core_sample_documents` and their indexes | drops the seven tables |
| 20261030000010_seed_core_p0103 | 01.03 | reference-seed rows: flag `ff.core.p0103` (default OFF; ON in development and test) and document type `SAMPLE_DOC` | deletes those seed rows |
| 20261030000011_core_events_and_jobs | 01.04 | tables `core_event_types` (event catalogue), `core_inbox` (consumer de-duplication, retry, dead letters), `core_jobs` (background job history), `core_schedules` (cron schedules), `core_projection_event_counts` (demonstration projection for replay) and their indexes | drops the five tables |
| 20261030000012_seed_flag_core_p0104 | 01.04 | reference-seed rows for `ff.core.p0104` (default OFF; ON in development and test) | deletes those seed rows |
| 20261030000013_core_change_request_types | 01.04 | rebuilds `core_change_requests` and `core_change_request_steps` without the CHECK on the request type (ADR-31); rows, ids and indexes kept | rebuilds both tables with the CHECK; removes `schedule_change` requests and their steps |
| 20261030000014_core_files | 01.05 | tables `core_files` (stored files: key, name, type, size, SHA-256, scan status, linked record, version, retention class, photo metadata, thumbnail), `core_file_uploads` (resumable upload sessions) and `core_file_settings` (per-company types, limits, retention, link life) and their indexes | drops the three tables |
| 20261030000015_seed_flag_core_p0105 | 01.05 | reference-seed rows for `ff.core.p0105` (default OFF; ON in development and test) | deletes those seed rows |

Existing objects altered or dropped: none. Schema-diff against `schema/baseline.json`: clean.

Parts 00.03 and 01.01 add no tables or columns; 01.02 adds three tables; 01.03 adds thirteen tables (configuration, numbering, change requests and a sample document); 01.04 adds five (event catalogue, inbox, jobs, schedules, a demonstration projection) and rebuilds the two change-request tables once, to take the request-type CHECK out; 01.05 adds three (files, upload sessions, file settings). Every migration is now verified in CI: it must apply, reverse to the exact previous schema and data, and re-apply (`npm run erp:migration-check`).
