# DB_CATALOGUE

Database: SQLite (node:sqlite). Source of truth: `migrations/*.up.sql`.
Row counts are not recorded: the catalogue is generated from migrations, not from a live database.

## Tables

| Table | Migration | Columns |
|---|---|---|
| core_feature_flags | 20261030000001_core_feature_flags.up.sql | id, key, description, default_enabled, environment, company_id, project_id, enabled, changed_by, changed_at, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_audit_log | 20261030000002_core_audit_and_outbox.up.sql | id, entity, entity_id, action, old_values, new_values, reason, actor, correlation_id, created_at |
| core_outbox | 20261030000002_core_audit_and_outbox.up.sql | id, event_type, aggregate_id, payload, created_at, published_at |
| core_idempotency_keys | 20261030000006_core_database_foundation.up.sql | id, key, user_id, endpoint, request_hash, response_status, response_body, created_at, expires_at |
| core_integrity_runs | 20261030000006_core_database_foundation.up.sql | id, run_id, run_at, check_code, severity, status, failures_count, checked_count, sample_json, duration_ms, triggered_by, company_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_backfill_runs | 20261030000006_core_database_foundation.up.sql | id, name, status, cursor, processed, batches, started_at, finished_at, last_error, company_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_company_settings | 20261030000008_core_system_configuration.up.sql | id, company_id, legal_name, trade_name, address_json, gstins_json, pan, cin, logo_file_id, currency, timezone, date_format, number_format, fy_start_month, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_financial_years | 20261030000008_core_system_configuration.up.sql | id, company_id, code, start_date, end_date, status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_periods | 20261030000008_core_system_configuration.up.sql | id, company_id, fy_id, period_no, name, start_date, end_date, module_status_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_parameters | 20261030000008_core_system_configuration.up.sql | id, key, value, data_type, scope_type, scope_id, effective_from, effective_to, company_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_holiday_calendars | 20261030000008_core_system_configuration.up.sql | id, company_id, code, name, state_code, site_id, project_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_holidays | 20261030000008_core_system_configuration.up.sql | id, company_id, calendar_id, holiday_date, name, type, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_document_types | 20261030000009_core_numbering_and_approvals.up.sql | id, company_id, code, name, module, template_id, workflow_code, retention_class, statutory, assign_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_number_series | 20261030000009_core_numbering_and_approvals.up.sql | id, company_id, doc_type_id, branch_code, project_id, name, prefix, format, gap_free, reset_rule, seq_start, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_number_counters | 20261030000009_core_numbering_and_approvals.up.sql | series_id, period_key, next_value |
| core_number_issues | 20261030000009_core_numbering_and_approvals.up.sql | id, company_id, series_id, doc_type_id, period_key, seq, number, status, ref_type, ref_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_change_requests | 20261030000009_core_numbering_and_approvals.up.sql | id, company_id, type, title, target_type, target_id, payload_json, reason, status, chain_json, current_step, requested_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_change_request_steps | 20261030000009_core_numbering_and_approvals.up.sql | id, request_id, step_no, role_code, decision, decided_by, decided_at, comment |
| core_sample_documents | 20261030000009_core_numbering_and_approvals.up.sql | id, company_id, project_id, site_id, doc_no, doc_date, status, title, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |

## Indexes

| Index | Table | Unique | Migration |
|---|---|---|---|
| ux_core_feature_flags_scope | core_feature_flags | yes | 20261030000001_core_feature_flags.up.sql |
| ix_core_feature_flags_company | core_feature_flags | no | 20261030000001_core_feature_flags.up.sql |
| ix_core_feature_flags_project | core_feature_flags | no | 20261030000001_core_feature_flags.up.sql |
| ix_core_audit_log_entity | core_audit_log | no | 20261030000002_core_audit_and_outbox.up.sql |
| ix_core_outbox_unpublished | core_outbox | no | 20261030000002_core_audit_and_outbox.up.sql |
| ux_core_idempotency_scope | core_idempotency_keys | yes | 20261030000006_core_database_foundation.up.sql |
| ix_core_idempotency_expiry | core_idempotency_keys | no | 20261030000006_core_database_foundation.up.sql |
| ix_core_integrity_runs_run | core_integrity_runs | no | 20261030000006_core_database_foundation.up.sql |
| ix_core_integrity_runs_check | core_integrity_runs | no | 20261030000006_core_database_foundation.up.sql |
| ix_core_integrity_runs_company | core_integrity_runs | no | 20261030000006_core_database_foundation.up.sql |
| ux_core_backfill_runs_name | core_backfill_runs | yes | 20261030000006_core_database_foundation.up.sql |
| ix_core_backfill_runs_company | core_backfill_runs | no | 20261030000006_core_database_foundation.up.sql |
| ux_core_company_settings_company | core_company_settings | yes | 20261030000008_core_system_configuration.up.sql |
| ux_core_financial_years_code | core_financial_years | yes | 20261030000008_core_system_configuration.up.sql |
| ix_core_financial_years_company_status | core_financial_years | no | 20261030000008_core_system_configuration.up.sql |
| ix_core_financial_years_dates | core_financial_years | no | 20261030000008_core_system_configuration.up.sql |
| ux_core_periods_fy_no | core_periods | yes | 20261030000008_core_system_configuration.up.sql |
| ix_core_periods_company_dates | core_periods | no | 20261030000008_core_system_configuration.up.sql |
| ux_core_parameters_version | core_parameters | yes | 20261030000008_core_system_configuration.up.sql |
| ix_core_parameters_key | core_parameters | no | 20261030000008_core_system_configuration.up.sql |
| ix_core_parameters_company | core_parameters | no | 20261030000008_core_system_configuration.up.sql |
| ux_core_holiday_calendars_code | core_holiday_calendars | yes | 20261030000008_core_system_configuration.up.sql |
| ix_core_holiday_calendars_site | core_holiday_calendars | no | 20261030000008_core_system_configuration.up.sql |
| ux_core_holidays_calendar_date | core_holidays | yes | 20261030000008_core_system_configuration.up.sql |
| ix_core_holidays_company_date | core_holidays | no | 20261030000008_core_system_configuration.up.sql |
| ux_core_document_types_code | core_document_types | yes | 20261030000009_core_numbering_and_approvals.up.sql |
| ix_core_document_types_module | core_document_types | no | 20261030000009_core_numbering_and_approvals.up.sql |
| ix_core_document_types_company | core_document_types | no | 20261030000009_core_numbering_and_approvals.up.sql |
| ux_core_number_series_scope | core_number_series | yes | 20261030000009_core_numbering_and_approvals.up.sql |
| ix_core_number_series_doc_type | core_number_series | no | 20261030000009_core_numbering_and_approvals.up.sql |
| ux_core_number_issues_seq | core_number_issues | yes | 20261030000009_core_numbering_and_approvals.up.sql |
| ux_core_number_issues_number | core_number_issues | yes | 20261030000009_core_numbering_and_approvals.up.sql |
| ix_core_number_issues_company | core_number_issues | no | 20261030000009_core_numbering_and_approvals.up.sql |
| ix_core_number_issues_doc_type | core_number_issues | no | 20261030000009_core_numbering_and_approvals.up.sql |
| ix_core_number_issues_ref | core_number_issues | no | 20261030000009_core_numbering_and_approvals.up.sql |
| ix_core_change_requests_company_status | core_change_requests | no | 20261030000009_core_numbering_and_approvals.up.sql |
| ix_core_change_requests_type | core_change_requests | no | 20261030000009_core_numbering_and_approvals.up.sql |
| ix_core_change_requests_target | core_change_requests | no | 20261030000009_core_numbering_and_approvals.up.sql |
| ix_core_change_request_steps_request | core_change_request_steps | no | 20261030000009_core_numbering_and_approvals.up.sql |
| ux_core_sample_documents_doc_no | core_sample_documents | yes | 20261030000009_core_numbering_and_approvals.up.sql |
| ix_core_sample_documents_company_status | core_sample_documents | no | 20261030000009_core_numbering_and_approvals.up.sql |
| ix_core_sample_documents_project | core_sample_documents | no | 20261030000009_core_numbering_and_approvals.up.sql |

Views, triggers and functions: none.

## ER diagram

```mermaid
erDiagram
  core_feature_flags
  core_audit_log
  core_outbox
  core_idempotency_keys
  core_integrity_runs
  core_backfill_runs
  core_company_settings
  core_financial_years
  core_periods
  core_parameters
  core_holiday_calendars
  core_holidays
  core_document_types
  core_number_series
  core_number_counters
  core_number_issues
  core_change_requests
  core_change_request_steps
  core_sample_documents
```

No foreign keys exist yet; tables are independent until the organisation tables (02.02) are built.
