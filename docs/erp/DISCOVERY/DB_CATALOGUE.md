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
| core_event_types | 20261030000011_core_events_and_jobs.up.sql | id, type, version, schema_json, owner_module, description, created_at, updated_at |
| core_inbox | 20261030000011_core_events_and_jobs.up.sql | id, consumer, event_id, outbox_id, event_type, company_id, status, attempts, next_attempt_at, last_error, processed_at, resolved_by, resolution, created_at, updated_at |
| core_jobs | 20261030000011_core_events_and_jobs.up.sql | id, job_id, type, params_json, status, progress, progress_message, attempts, max_attempts, run_after, started_at, finished_at, heartbeat_at, error, result_json, log_json, cancel_requested, created_by, company_id, schedule_code, scheduled_for, created_at, updated_at |
| core_schedules | 20261030000011_core_events_and_jobs.up.sql | id, company_id, code, description, cron, job_type, params_json, enabled, last_run_at, next_run_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_projection_event_counts | 20261030000011_core_events_and_jobs.up.sql | company_id, event_type, total, last_event_at |
| core_change_requests | 20261030000013_core_change_request_types.up.sql | id, company_id, type, title, target_type, target_id, payload_json, reason, status, chain_json, current_step, requested_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_change_request_steps | 20261030000013_core_change_request_types.up.sql | id, request_id, step_no, role_code, decision, decided_by, decided_at, comment |
| core_files | 20261030000014_core_files.up.sql | id, company_id, storage_key, original_name, extension, mime, category, size_bytes, scan_status, scan_detail, scanned_at, linked_entity, linked_id, supersedes_id, version_no, retention_class, exif_json, exif_stripped, thumbnail_key, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_file_uploads | 20261030000014_core_files.up.sql | id, upload_id, company_id, user_id, file_name, declared_size, received, meta_json, status, file_id, expires_at, created_at, updated_at |
| core_file_settings | 20261030000014_core_files.up.sql | id, company_id, settings_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_formulas | 20261030000016_core_calculation_engine.up.sql | id, company_id, code, formula_version, description, owner_module, financial, expression, inputs_json, outputs_json, rounding_policy, tests_json, effective_from, effective_to, status, activated_at, activated_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_calc_traces | 20261030000016_core_calculation_engine.up.sql | id, company_id, formula_code, formula_version, entity, entity_id, field, inputs_json, result_json, steps_json, computed_by, computed_at |
| core_calc_shadow_results | 20261030000016_core_calculation_engine.up.sql | id, company_id, formula_code, baseline_version, candidate_version, inputs_json, baseline_json, candidate_json, differs, candidate_error, computed_at |
| core_uoms | 20261030000016_core_calculation_engine.up.sql | id, company_id, code, name, dimension, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_uom_conversions | 20261030000016_core_calculation_engine.up.sql | id, company_id, item_code, from_uom, to_uom, factor, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_sample_bills | 20261030000016_core_calculation_engine.up.sql | id, company_id, title, quantity, unit_rate, gst_percent, supply, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount, formula_pins_json, status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |

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
| ux_core_event_types_type | core_event_types | yes | 20261030000011_core_events_and_jobs.up.sql |
| ix_core_event_types_owner | core_event_types | no | 20261030000011_core_events_and_jobs.up.sql |
| ux_core_inbox_consumer_event | core_inbox | yes | 20261030000011_core_events_and_jobs.up.sql |
| ix_core_inbox_due | core_inbox | no | 20261030000011_core_events_and_jobs.up.sql |
| ix_core_inbox_outbox | core_inbox | no | 20261030000011_core_events_and_jobs.up.sql |
| ux_core_jobs_job_id | core_jobs | yes | 20261030000011_core_events_and_jobs.up.sql |
| ix_core_jobs_due | core_jobs | no | 20261030000011_core_events_and_jobs.up.sql |
| ix_core_jobs_type | core_jobs | no | 20261030000011_core_events_and_jobs.up.sql |
| ix_core_jobs_company | core_jobs | no | 20261030000011_core_events_and_jobs.up.sql |
| ux_core_jobs_schedule_run | core_jobs | yes | 20261030000011_core_events_and_jobs.up.sql |
| ux_core_schedules_code | core_schedules | yes | 20261030000011_core_events_and_jobs.up.sql |
| ix_core_schedules_due | core_schedules | no | 20261030000011_core_events_and_jobs.up.sql |
| ix_core_schedules_company | core_schedules | no | 20261030000011_core_events_and_jobs.up.sql |
| ix_core_change_requests_company_status | core_change_requests | no | 20261030000013_core_change_request_types.up.sql |
| ix_core_change_requests_type | core_change_requests | no | 20261030000013_core_change_request_types.up.sql |
| ix_core_change_requests_target | core_change_requests | no | 20261030000013_core_change_request_types.up.sql |
| ix_core_change_request_steps_request | core_change_request_steps | no | 20261030000013_core_change_request_types.up.sql |
| ux_core_files_storage_key | core_files | yes | 20261030000014_core_files.up.sql |
| ix_core_files_entity | core_files | no | 20261030000014_core_files.up.sql |
| ix_core_files_sha256 | core_files | no | 20261030000014_core_files.up.sql |
| ix_core_files_scan | core_files | no | 20261030000014_core_files.up.sql |
| ix_core_files_supersedes | core_files | no | 20261030000014_core_files.up.sql |
| ux_core_file_uploads_upload_id | core_file_uploads | yes | 20261030000014_core_files.up.sql |
| ix_core_file_uploads_expiry | core_file_uploads | no | 20261030000014_core_files.up.sql |
| ix_core_file_uploads_file | core_file_uploads | no | 20261030000014_core_files.up.sql |
| ux_core_file_settings_company | core_file_settings | yes | 20261030000014_core_files.up.sql |
| ux_core_formulas_code_version | core_formulas | yes | 20261030000016_core_calculation_engine.up.sql |
| ix_core_formulas_status | core_formulas | no | 20261030000016_core_calculation_engine.up.sql |
| ix_core_formulas_owner | core_formulas | no | 20261030000016_core_calculation_engine.up.sql |
| ix_core_formulas_company | core_formulas | no | 20261030000016_core_calculation_engine.up.sql |
| ix_core_calc_traces_entity | core_calc_traces | no | 20261030000016_core_calculation_engine.up.sql |
| ix_core_calc_traces_formula | core_calc_traces | no | 20261030000016_core_calculation_engine.up.sql |
| ix_core_calc_shadow_formula | core_calc_shadow_results | no | 20261030000016_core_calculation_engine.up.sql |
| ux_core_uoms_code | core_uoms | yes | 20261030000016_core_calculation_engine.up.sql |
| ix_core_uoms_company | core_uoms | no | 20261030000016_core_calculation_engine.up.sql |
| ux_core_uom_conversions_pair | core_uom_conversions | yes | 20261030000016_core_calculation_engine.up.sql |
| ix_core_uom_conversions_item | core_uom_conversions | no | 20261030000016_core_calculation_engine.up.sql |
| ix_core_uom_conversions_company | core_uom_conversions | no | 20261030000016_core_calculation_engine.up.sql |
| ix_core_sample_bills_company | core_sample_bills | no | 20261030000016_core_calculation_engine.up.sql |

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
  core_event_types
  core_inbox
  core_jobs
  core_schedules
  core_projection_event_counts
  core_change_requests
  core_change_request_steps
  core_files
  core_file_uploads
  core_file_settings
  core_formulas
  core_calc_traces
  core_calc_shadow_results
  core_uoms
  core_uom_conversions
  core_sample_bills
```

No foreign keys exist yet; tables are independent until the organisation tables (02.02) are built.
