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
| core_slo_definitions | 20261030000018_core_observability.up.sql | id, company_id, journey, label, description, route_patterns_json, target_latency_ms, latency_percentile, target_availability_bp, window_days, enabled, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_alert_rules | 20261030000018_core_observability.up.sql | id, company_id, code, kind, description, threshold, unit, window_minutes, min_requests, severity, channels_json, cooldown_minutes, enabled, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_alerts | 20261030000018_core_observability.up.sql | id, rule_code, dedupe_key, severity, message, value, threshold, status, fired_at, resolved_at, acknowledged_by, acknowledged_at, notified_json, correlation_id |
| core_metric_samples | 20261030000018_core_observability.up.sql | id, bucket_hour, route_key, requests, server_errors, client_errors, sum_ms, hist_json |
| core_client_events | 20261030000018_core_observability.up.sql | id, company_id, user_ref, type, message, path, status, correlation_id, duration_ms, created_at |
| core_connectors | 20261030000020_core_integration_hub.up.sql | id, company_id, code, name, type, provider, environment, config_json, status, timeout_ms, max_retries, retry_backoff_ms, rate_limit_per_minute, breaker_threshold, breaker_reset_seconds, retention_days, last_health_at, last_health_status, last_health_message, last_used_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_connector_secrets | 20261030000020_core_integration_hub.up.sql | id, company_id, connector_id, key, encrypted_value, key_version, status, rotated_at, expires_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_integration_logs | 20261030000020_core_integration_hub.up.sql | id, company_id, connector_id, direction, operation, endpoint, status, http_status, duration_ms, attempts, request_redacted, response_redacted, error, correlation_id, user_ref, created_at |
| core_webhook_receipts | 20261030000020_core_integration_hub.up.sql | id, connector_id, delivery_id, received_at |
| iam_users | 20261030000022_iam_authentication.up.sql | id, company_id, username, email, mobile, display_name, roles_json, status, last_login_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| iam_credentials | 20261030000022_iam_authentication.up.sql | id, company_id, user_id, password_hash, algo, changed_at, expires_at, must_change, history_json, failed_count, locked_until, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| iam_mfa_factors | 20261030000022_iam_authentication.up.sql | id, company_id, user_id, type, secret_encrypted, phone, meta_json, verified_at, last_used_at, last_counter, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| iam_devices | 20261030000022_iam_authentication.up.sql | id, company_id, user_id, device_fingerprint, name, platform, token_hash, trusted_until, pin_hash, pin_failed, registered_at, last_seen_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| iam_auth_policy | 20261030000022_iam_authentication.up.sql | id, company_id, settings_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| iam_sessions | 20261030000022_iam_authentication.up.sql | id, public_id, company_id, user_id, device_id, ip, user_agent, auth_method, mfa_at, created_at, last_seen_at, expires_at, revoked_at, revoked_reason, revoked_by |
| iam_refresh_tokens | 20261030000022_iam_authentication.up.sql | id, session_id, token_hash, status, created_at, used_at |
| iam_login_events | 20261030000022_iam_authentication.up.sql | id, company_id, user_id, username_attempted, result, ip, user_agent, device_label, device_fingerprint, geo_country, reason, session_public_id, at |
| iam_login_throttle | 20261030000022_iam_authentication.up.sql | key, failed_count, locked_until, last_failed_at |
| iam_password_resets | 20261030000022_iam_authentication.up.sql | id, user_id, token_hash, expires_at, used_at, ip, created_at |
| org_companies | 20261030000024_iam_organisation.up.sql | id, company_id, code, legal_name, short_name, gstin_primary, pan, status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| org_branches | 20261030000024_iam_organisation.up.sql | id, company_id, parent_id, kind, code, name, state_code, address, gstin, status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| org_departments | 20261030000024_iam_organisation.up.sql | id, company_id, parent_id, branch_id, kind, code, name, head_user_id, status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| org_designations | 20261030000024_iam_organisation.up.sql | id, company_id, code, name, grade, level, status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| org_projects | 20261030000024_iam_organisation.up.sql | id, company_id, branch_id, code, name, type, client_name, status, start_date, end_date, pm_user_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| org_sites | 20261030000024_iam_organisation.up.sql | id, company_id, org_project_id, code, name, site_type, status, address, latitude, longitude, geofence_type, geofence_radius_m, geofence_polygon_json, working_start, working_end, in_charge_user_id, timezone, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| org_locations | 20261030000024_iam_organisation.up.sql | id, company_id, type, code, name, state_code, address, latitude, longitude, status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| org_cost_centres | 20261030000024_iam_organisation.up.sql | id, company_id, parent_id, code, name, type, linked_type, linked_id, status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| org_assignments | 20261030000024_iam_organisation.up.sql | id, company_id, entity_type, entity_id, role, user_id, effective_from, effective_to, applied, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| iam_user_profiles | 20261030000026_iam_user_management.up.sql | id, company_id, user_id, lifecycle, user_type, language, employee_id, employee_code, department_id, home_project_id, photo_file_id, signature_file_id, preferences_json, lifecycle_at, lifecycle_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| iam_invitations | 20261030000026_iam_user_management.up.sql | id, company_id, user_id, token_hash, channel, sent_to, status, expires_at, accepted_at, sent_by, resend_count, delivered, delivery_note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| iam_role_grants | 20261030000026_iam_user_management.up.sql | id, company_id, user_id, role_code, action, request_id, reason, granted_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| iam_permissions | 20261030000028_iam_role_engine.up.sql | id, company_id, perm_key, module, entity, action, description, sensitive, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| iam_roles | 20261030000028_iam_role_engine.up.sql | id, company_id, code, name, description, kind, category, is_system, status, department_id, parent_template_id, clearance, authority_json, grants_hash, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| iam_role_permissions | 20261030000028_iam_role_engine.up.sql | id, company_id, role_id, perm_key, effect, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| iam_field_masks | 20261030000028_iam_role_engine.up.sql | id, company_id, role_id, entity, field, rule, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| iam_assignments | 20261030000028_iam_role_engine.up.sql | id, company_id, user_id, role_id, scope_type, scope_ids_json, effective_from, effective_to, status, reason, request_id, ended_at, ended_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| iam_role_mapping | 20261030000028_iam_role_engine.up.sql | id, company_id, legacy_role, new_role_id, mapping_type, notes, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| iam_sod_rules | 20261030000030_iam_sod_privileged_reviews.up.sql | id, company_id, code, name, description, kind, set_a_json, set_b_json, scope, severity, conditions_json, active, catalogue_ref, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| iam_sod_violations | 20261030000030_iam_sod_privileged_reviews.up.sql | id, company_id, rule_id, user_id, user_ref, source, outcome, severity, document_type, document_id, detail_json, detected_at, status, resolved_at, resolved_by, resolution, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| iam_sod_actions | 20261030000030_iam_sod_privileged_reviews.up.sql | id, company_id, user_ref, action_key, subject_type, subject_id, project_id, period, vendor_ref, amount_paise, at |
| iam_elevations | 20261030000030_iam_sod_privileged_reviews.up.sql | id, company_id, user_id, role_id, scope_type, scope_ids_json, reason, status, requested_hours, requested_start, financial, approved_by, starts_at, ends_at, revoked_at, revoked_by, revoke_reason, request_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| iam_elevation_log | 20261030000030_iam_sod_privileged_reviews.up.sql | id, elevation_id, user_id, at, method, route, status, correlation_id, duration_ms |
| iam_access_campaigns | 20261030000030_iam_sod_privileged_reviews.up.sql | id, company_id, campaign_code, name, scope, department_id, due_date, status, closed_at, closed_by, summary_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| iam_access_reviews | 20261030000030_iam_sod_privileged_reviews.up.sql | id, company_id, campaign_id, campaign_code, scope, reviewer_id, status, due_date, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| iam_access_review_items | 20261030000030_iam_sod_privileged_reviews.up.sql | id, company_id, review_id, assignment_id, user_id, source, role_code, role_name, scope_text, privileged, last_login_at, decision, comment, decided_at, decided_by, applied_at, applied_note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_audit_chain | 20261030000032_audit_chain_security_events.up.sql | audit_id, seq, company_id, occurred_at, actor_id, on_behalf_of, ip, device, changes_json, prev_hash, hash |
| core_security_events | 20261030000032_audit_chain_security_events.up.sql | id, company_id, occurred_at, user_id, username, type, severity, details_json, ip, correlation_id, source_type, source_id |
| core_audit_verifications | 20261030000032_audit_chain_security_events.up.sql | id, started_at, finished_at, trigger, checked, ok, broken_seq, problem, head_hash |
| core_audit_segments | 20261030000032_audit_chain_security_events.up.sql | period, first_seq, last_seq, entry_count, head_hash, sealed_at |
| core_route_registry | 20261030000034_security_route_registry_settings.up.sql | id, method, path, module, guard, permission_key, scope_resolver, schema_ref, limit_class, is_public, audit_flag, last_test_at, last_test_result, last_test_detail, registered_at |
| core_security_settings | 20261030000034_security_route_registry_settings.up.sql | id, version, settings_json, updated_by, updated_at |
| ui_user_preferences | 20261030000036_ui_user_preferences.up.sql | id, company_id, user_id, user_ref, theme, density, language, start_page, table_settings_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_drafts | 20261030000038_ui_forms_and_drafts.up.sql | id, company_id, user_id, user_ref, form_code, entity_key, title, payload_json, bytes, saved_at, saved_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_form_metadata | 20261030000038_ui_forms_and_drafts.up.sql | id, company_id, form_code, form_version, name, module, status, schema_json, layout_json, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_sample_requests | 20261030000038_ui_forms_and_drafts.up.sql | id, company_id, doc_no, doc_date, status, title, project_id, site_id, cost_centre_id, department_id, requested_by, required_by, priority, urgency_reason, returnable, return_by, delivery_note, delivery_lat, delivery_lng, total_amount, line_count, formula_pins_json, submitted_at, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_sample_request_lines | 20261030000038_ui_forms_and_drafts.up.sql | id, company_id, request_id, line_no, description, uom, quantity, unit_rate, line_amount, needed_on, comment, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_saved_views | 20261030000040_ui_saved_views_and_exports.up.sql | id, company_id, owner_user_id, owner_ref, list_code, name, is_shared, share_scope_json, config_json, is_default, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_export_jobs | 20261030000040_ui_saved_views_and_exports.up.sql | id, company_id, user_id, user_ref, list_code, format, query_json, actor_json, status, rows_planned, rows_written, file_name, storage_key, bytes, error, job_id, finished_at, expires_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_record_comments | 20261030000042_ui_object_page.up.sql | id, company_id, entity_type, entity_id, body, mentions_json, author_ref, author_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_record_versions | 20261030000042_ui_object_page.up.sql | id, company_id, entity_type, entity_id, version_no, snapshot_json, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_reason_codes | 20261030000042_ui_object_page.up.sql | id, company_id, applies_to, code, label, needs_text, sort_order, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_required_documents | 20261030000042_ui_object_page.up.sql | id, company_id, doc_type, code, label, description, required_at, sort_order, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_record_documents | 20261030000042_ui_object_page.up.sql | id, company_id, entity_type, entity_id, requirement_code, file_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_navigation_entries | 20261030000044_ui_shell.up.sql | id, company_id, code, parent_code, kind, placement, label, label_hi, route, icon, permission_key, feature_flag, sort_order, keywords, mobile_visible, requires_context, onboarding, shortcut, tile, quick_create_label, quick_create_route, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_favourites | 20261030000044_ui_shell.up.sql | id, company_id, user_ref, ref_key, kind, nav_code, entity, entity_id, title, route, sort_order, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_recent_records | 20261030000044_ui_shell.up.sql | id, company_id, user_ref, entity, entity_id, title, route, visited_at, visit_count, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_user_context | 20261030000044_ui_shell.up.sql | id, company_id, user_ref, context_project_id, context_site_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_push_subscriptions | 20261030000046_ui_device.up.sql | id, company_id, user_ref, endpoint, auth, user_agent, device_label, expires_at, last_used_at, failure_count, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_field_tiles | 20261030000046_ui_device.up.sql | id, company_id, code, nav_code, label, label_hi, sort_order, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_widgets | 20261030000048_ui_dashboards.up.sql | id, company_id, code, module, title, title_hi, description, type, data_endpoint, params_schema_json, permission_key, default_w, default_h, refresh_sec, drill_route, sort_order, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_dashboards | 20261030000048_ui_dashboards.up.sql | id, company_id, code, name, owner_type, owner_ref, permission_key, layout_json, filters_json, is_default, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_search_index | 20261102000050_core_search_index.up.sql | id, company_id, entity, entity_id, project_id, site_id, branch_id, department_id, owner_user_id, code, code_key, title, title_lc, subtitle, body, phon, record_status, doc_date, permission_key, route, indexed_at, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| core_search_queries | 20261102000050_core_search_index.up.sql | id, company_id, user_ref, q, q_norm, source, types, result_count, took_ms, clicked_entity, clicked_id, clicked_pos, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_translations | 20261102000052_ui_translations.up.sql | id, company_id, namespace, msg_key, lang, text, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_locale_preferences | 20261102000052_ui_translations.up.sql | id, company_id, user_id, user_ref, number_style, time_format, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_page_migration | 20261102000054_ui_page_migration.up.sql | id, company_id, page_code, module, label, old_route, new_route, page_type, status, owner_role, migrated_in_part, migrated_by, migrated_at, verified_by, verified_at, scheduled_part, defects_json, notes, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| wf_definitions | 20261102000056_eng_workflow.up.sql | id, company_id, doc_type, version, name, status, steps_json, activation_instance_id, activated_at, activated_by, retired_at, project_id, site_id, created_by, created_at, updated_by, updated_at, row_version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| wf_instances | 20261102000056_eng_workflow.up.sql | id, company_id, doc_type, doc_id, doc_ref, title, definition_id, definition_version, steps_json, status, current_step, cycle, context_json, previous_instance_id, needs_admin, submitted_by, submitted_at, completed_at, completed_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| wf_tasks | 20261102000056_eng_workflow.up.sql | id, company_id, instance_id, step_code, step_no, cycle, kind, assignee_user_id, assignee_role, scope_json, status, due_at, acted_at, action, comment, on_behalf_of, delegated_from, clarification, reminded_at, escalated_at, superseded, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| wf_task_attachments | 20261102000056_eng_workflow.up.sql | id, company_id, task_id, file_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| wf_history | 20261102000056_eng_workflow.up.sql | id, company_id, instance_id, task_id, cycle, step_code, event, actor, comment, data_json, at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| wf_watchers | 20261102000056_eng_workflow.up.sql | id, company_id, instance_id, user_ref, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| eng_sample_docs | 20261102000056_eng_workflow.up.sql | id, company_id, doc_no, title, amount, status, locked, amends_id, requested_by, instance_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| wf_matrix | 20261102000058_eng_approval_matrix.up.sql | id, company_id, doc_type, scope_type, scope_id, matrix_version, name, status, effective_from, effective_to, activation_instance_id, activated_at, activated_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| wf_matrix_rules | 20261102000058_eng_approval_matrix.up.sql | id, company_id, matrix_id, priority, name, condition_json, steps_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| wf_authority_limits | 20261102000058_eng_approval_matrix.up.sql | id, company_id, role_code, doc_type, max_amount, currency, status, effective_from, effective_to, batch_id, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| wf_delegations | 20261102000058_eng_approval_matrix.up.sql | id, company_id, delegator, delegate, doc_types_json, delegator_roles_json, max_amount, from_date, to_date, reason, status, instance_id, revoked_by, revoked_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| wf_escalation_paths | 20261102000058_eng_approval_matrix.up.sql | id, company_id, scope_type, scope_id, levels_json, status, effective_from, effective_to, batch_id, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| wf_sla_settings | 20261102000058_eng_approval_matrix.up.sql | id, company_id, doc_type, sla_hours, remind_pct, escalate_pct, second_pct, status, effective_from, effective_to, batch_id, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| wf_approval_policies | 20261102000060_eng_approval_inbox.up.sql | id, company_id, doc_type, bulk_eligible, bulk_max_amount, link_eligible, link_reauth_amount, link_expiry_minutes, status, effective_from, effective_to, batch_id, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| wf_link_tokens | 20261102000060_eng_approval_inbox.up.sql | id, company_id, task_id, instance_id, user_ref, roles_json, token_hash, channel, status, reauth_required, expires_at, used_at, used_action, used_via, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pcs_control_points | 20261103000062_eng_protocol_control.up.sql | id, company_id, code, module, stage, description, rule_ref, enforcement, thresholds_json, evidence_required, escalation_level, mode, owner_role, emergency_allowed, observe_since, mode_changed_at, pending_change_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pcs_check_results | 20261103000062_eng_protocol_control.up.sql | id, company_id, control_id, control_code, entity, entity_id, result, mode, details_json, check_source, user_id, value_at_risk, at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pcs_exceptions | 20261103000062_eng_protocol_control.up.sql | id, company_id, exception_no, control_id, control_code, entity, entity_id, entity_ref, reason_code, justification, evidence_file_ids, value_at_risk, level, status, emergency, regularise_by, regularised_at, escalated_at, workflow_instance_id, raised_by, used_at, used_by, decided_at, check_context_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pcs_reason_codes | 20261103000062_eng_protocol_control.up.sql | id, company_id, action_type, code, label, requires_evidence, needs_text, sort_order, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pcs_control_changes | 20261103000062_eng_protocol_control.up.sql | id, company_id, control_id, control_code, change_json, from_mode, to_mode, observed_days, status, instance_id, requested_by, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pcs_cycle_stages | 20261103000062_eng_protocol_control.up.sql | id, company_id, entity, entity_id, stage, control_code, done_at, done_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| acc_raci_templates | 20261103000064_eng_accountability.up.sql | id, company_id, process_code, name, description, roles_json, doc_types_json, sort_order, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| acc_raci_assignments | 20261103000064_eng_accountability.up.sql | id, company_id, scope_type, scope_id, process_code, user_id, role_code, raci, status, effective_from, effective_to, batch_id, reason, instance_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| acc_action_ledger | 20261103000064_eng_accountability.up.sql | id, company_id, occurred_at, actor_id, role_code, action, entity, entity_id, entity_ref, process_code, outcome, due_at, on_time, affected_user, details_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| acc_ledger_cursors | 20261103000064_eng_accountability.up.sql | source_type, last_id, updated_at |
| ntf_templates | 20261103000066_eng_notifications.up.sql | id, company_id, code, category, channel, lang, subject, body, variables_json, template_version, status, reason, instance_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ntf_notifications | 20261103000066_eng_notifications.up.sql | id, company_id, user_ref, template_code, title, body, link, category, priority, in_app, read_at, archived_at, event_key, data_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ntf_preferences | 20261103000066_eng_notifications.up.sql | id, company_id, user_ref, category, channels_json, digest, quiet_hours_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ntf_deliveries | 20261103000066_eng_notifications.up.sql | id, company_id, notification_id, user_ref, channel, address, subject, body, status, provider_msg_id, attempts, last_error, delivered_at, next_attempt_at, deliver_after, digest_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ntf_realtime_events | 20261103000066_eng_notifications.up.sql | id, company_id, room, event_type, entity, entity_id, data_json, occurred_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| comm_messages | 20261103000068_eng_communication.up.sql | id, company_id, channel, direction, purpose, priority, to_address, from_address, template_code, provider_template_id, subject, body_redacted, payload_json, attachments_json, related_entity, related_id, conversation_key, contact_type, contact_id, status, block_reason, connector_code, provider_msg_id, reply_token, attempts, route_json, last_error, next_attempt_at, sent_at, delivered_at, read_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| comm_consents | 20261103000068_eng_communication.up.sql | id, company_id, contact_type, contact_id, contact_name, address, channel, status, source, changed_at, changed_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| comm_otps | 20261103000068_eng_communication.up.sql | id, company_id, purpose, channel, address, user_ref, subject_ref, code_hash, expires_at, attempts, max_attempts, verified_at, status, sent_at, message_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| comm_channels | 20261103000068_eng_communication.up.sql | id, company_id, channel, primary_connector, secondary_connector, sender_id, dlt_entity_id, rate_per_minute, enabled, channel_version, status, batch_id, reason, instance_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| comm_dlt_templates | 20261103000068_eng_communication.up.sql | id, company_id, template_code, dlt_template_id, sender_id, body_pattern, dlt_version, status, batch_id, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| comm_wa_templates | 20261103000068_eng_communication.up.sql | id, company_id, name, language, category, provider_status, template_code, variables_json, synced_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tsk_tasks | 20261103000070_eng_tasks.up.sql | id, company_id, task_no, title, description, entity, entity_id, entity_label, department_id, topic_code, priority, start_date, due_date, status, blocked_reason, recurrence_rule, series_id, requires_acceptance, requires_evidence, requires_verification, verified_by, verified_at, completed_by, completed_at, closed_at, origin, assigner, routing_json, escalation_level, last_reminded_at, last_escalated_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tsk_assignees | 20261103000070_eng_tasks.up.sql | id, company_id, task_id, user_ref, role, accepted_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tsk_checklist_items | 20261103000070_eng_tasks.up.sql | id, company_id, task_id, position, text, done, done_by, done_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tsk_dependencies | 20261103000070_eng_tasks.up.sql | id, company_id, task_id, depends_on_task_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tsk_comments | 20261103000070_eng_tasks.up.sql | id, company_id, task_id, body, author_ref, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tsk_escalations | 20261103000070_eng_tasks.up.sql | id, company_id, task_id, level, to_role, to_user, days_late, at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tsk_routing_matrix | 20261103000070_eng_tasks.up.sql | id, company_id, topic_code, topic_name, department_id, role_code, fallback_user_ref, raci_process_code, default_priority, default_due_days, requires_evidence, requires_verification, effective_from, effective_to, matrix_version, status, batch_id, instance_id, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| alr_rules | 20261103000072_eng_alerts.up.sql | id, company_id, code, name, description, trigger_type, event_type, schedule, dataset, condition_json, actions_json, message_template, throttle_minutes, severity, owner_module, owner_role, external, enabled, rule_version, status, instance_id, reason, last_run_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| alr_alerts | 20261103000072_eng_alerts.up.sql | id, company_id, rule_code, rule_version, entity, entity_id, entity_label, route, severity, message, status, owner_user_ref, recipients_json, occurrences, first_seen_at, last_seen_at, last_notified_at, acknowledged_at, acknowledged_by, resolved_at, resolved_by, resolution, escalated_at, deliveries_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| alr_rule_runs | 20261103000072_eng_alerts.up.sql | id, company_id, rule_code, rule_version, trigger, started_at, finished_at, matched, created, throttled, actions_done, errors, error_text, duration_ms, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| doc_types | 20261104000074_eng_documents.up.sql | id, company_id, code, name, requires_review, reviewer_role, approver_role, has_validity, default_confidentiality, retention_class, sort_order, type_version, status, batch_id, instance_id, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| doc_folder_templates | 20261104000074_eng_documents.up.sql | id, company_id, code, name, tree_json, template_version, status, batch_id, instance_id, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| doc_folders | 20261104000074_eng_documents.up.sql | id, company_id, parent_id, name, path, template_code, default_acl_json, sort_order, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| doc_documents | 20261104000074_eng_documents.up.sql | id, company_id, doc_no, title, doc_type, discipline, folder_id, wbs_ref, location_ref, current_revision, current_version_id, status, confidentiality, owner_user_ref, retention_class, valid_until, expiry_notified_at, tags_json, checked_out_by, checked_out_at, checkout_note, archived_at, archive_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| doc_versions | 20261104000074_eng_documents.up.sql | id, company_id, document_id, revision, revision_no, file_id, change_note, status, instance_id, submitted_by, submitted_at, approved_at, superseded_at, superseded_by, metadata_json, text_extract, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| doc_shares | 20261104000074_eng_documents.up.sql | id, company_id, document_id, principal_type, principal_id, principal_name, permission, expires_at, granted_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| doc_distributions | 20261104000074_eng_documents.up.sql | id, company_id, document_id, version_id, recipient_type, recipient_id, recipient_name, recipient_email, sent_by, sent_at, message, due_at, acknowledged_at, acknowledged_by, ack_note, reminded_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| doc_annotations | 20261104000074_eng_documents.up.sql | id, company_id, version_id, user_ref, page, shape_json, comment, resolved, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| doc_links | 20261104000074_eng_documents.up.sql | id, company_id, document_id, entity, entity_id, label, route, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tpl_templates | 20261104000076_eng_templates.up.sql | id, company_id, doc_type, code, template_version, name, html, css, orientation, brand_json, variables_json, status, is_default, change_note, instance_id, approved_by, approved_at, effective_from, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tpl_records | 20261104000076_eng_templates.up.sql | id, company_id, doc_type, entity_id, doc_no, data_json, approved, is_sample, record_version, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tpl_generated_docs | 20261104000076_eng_templates.up.sql | id, company_id, template_id, doc_type, entity, entity_id, doc_number, version_no, file_id, hash, pages, pdfa, purpose, reason, verify_code, is_current, superseded_by, bulk_job_id, generated_by, generated_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tpl_deliveries | 20261104000076_eng_templates.up.sql | id, company_id, generated_doc_id, channel, recipient, status, comm_message_id, sent_at, error, link_expires_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tpl_bulk_jobs | 20261104000076_eng_templates.up.sql | id, company_id, doc_type, template_code, total, done, failed, status, job_id, entity_ids_json, results_json, purpose, pdfa, requested_by, started_at, finished_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tpl_auto_rules | 20261104000076_eng_templates.up.sql | id, company_id, workflow_doc_type, doc_type, template_code, enabled, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| sig_signatures | 20261104000078_eng_signatures.up.sql | id, company_id, generated_doc_id, signer_user_id, signer_name, signer_label, method, signed_at, hash, digest, prev_digest, certificate_ref, workflow_instance_id, ip, status, revoked_at, revoked_by, revoke_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| sig_copies | 20261104000078_eng_signatures.up.sql | id, company_id, generated_doc_id, file_id, hash, signature_count, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| sig_verifications | 20261104000078_eng_signatures.up.sql | id, company_id, code, generated_doc_id, verify_count, mismatch_count, last_verified_at, status, cancelled_at, cancelled_by, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| sig_profiles | 20261104000078_eng_signatures.up.sql | id, company_id, user_name, image_data, image_hash, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| sig_config | 20261104000078_eng_signatures.up.sql | id, company_id, config_json, config_version, status, instance_id, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| xl_templates | 20261104000080_eng_excel_engine.up.sql | id, company_id, import_type, template_version, columns_json, instructions, settings_json, status, instance_id, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| xl_jobs | 20261104000080_eng_excel_engine.up.sql | id, company_id, import_type, template_version, file_id, file_name, file_hash, status, mode, on_existing, total_rows, valid_rows, error_rows, create_rows, update_rows, skip_rows, committed_rows, progress, core_job_id, last_error, result_json, started_by, started_at, validated_at, committed_by, committed_at, cancelled_at, actor_json, commit_actor_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| xl_job_errors | 20261104000080_eng_excel_engine.up.sql | id, company_id, job_id, sheet, row_no, column_key, column_label, value, message, code, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| col_comments | 20261104000082_eng_collaboration.up.sql | id, company_id, entity, entity_id, entity_label, parent_id, body, status, edited_at, edit_count, delete_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| col_mentions | 20261104000082_eng_collaboration.up.sql | id, company_id, comment_id, mentioned_user, read_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| col_reactions | 20261104000082_eng_collaboration.up.sql | id, company_id, comment_id, reaction, reacted_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| col_trace_links | 20261104000082_eng_collaboration.up.sql | id, company_id, from_entity, from_id, to_entity, to_id, relation, link_kind, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| off_devices | 20261104000084_eng_offline.up.sql | id, company_id, user_ref, device_id, device_name, platform, registered_at, last_sync_at, last_seen_at, clock_drift_ms, revoked_at, revoked_by, revoke_reason, wiped_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| off_sync_log | 20261104000084_eng_offline.up.sql | id, company_id, device_pk, user_ref, command_id, seq, command_type, op, client_ref, status, server_entity_id, base_version, payload_json, conflict_json, result_json, error_message, client_created_at, device_clock_at, effective_at, lat, lng, accuracy, received_at, processed_at, confirmed_by, confirmed_at, actor_json, resolution, resolved_by, resolved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| off_uploads | 20261104000084_eng_offline.up.sql | id, company_id, device_pk, user_ref, upload_id, command_id, file_name, total_size, chunk_size, total_chunks, received_json, status, file_id, error_message, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_conversations | 20261104000086_msg_conversations.up.sql | id, company_id, conv_type, title, direct_key, department_id, entity, entity_id, external_key, external_channel, auto_membership, is_archived, last_message_id, last_activity_at, message_count, last_external_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_members | 20261104000086_msg_conversations.up.sql | id, company_id, conversation_id, user_ref, member_role, member_source, joined_at, left_at, muted_until, mention_only, last_read_message_id, pinned, archived, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_messages | 20261104000086_msg_conversations.up.sql | id, company_id, conversation_id, sender_ref, kind, body, status, reply_to_id, forwarded_from_id, mentions_json, attachments_json, record_links_json, client_id, edited_at, delete_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_reactions | 20261104000086_msg_conversations.up.sql | id, company_id, message_id, user_ref, emoji, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_receipts | 20261104000088_msg_features.up.sql | id, company_id, message_id, user_ref, delivered_at, read_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_stars | 20261104000088_msg_features.up.sql | id, company_id, message_id, user_ref, starred_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_pins | 20261104000088_msg_features.up.sql | id, company_id, conversation_id, message_id, pinned_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_hidden | 20261104000088_msg_features.up.sql | id, company_id, message_id, user_ref, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_voice | 20261104000088_msg_features.up.sql | id, company_id, message_id, duration_ms, waveform_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_user_settings | 20261104000088_msg_features.up.sql | id, company_id, user_ref, show_last_seen, share_read_receipts, show_online, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_presence | 20261104000088_msg_features.up.sql | id, company_id, user_ref, status, last_seen_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_holds | 20261104000088_msg_features.up.sql | id, company_id, conversation_id, reason, released_at, released_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_member_periods | 20261104000088_msg_features.up.sql | id, company_id, conversation_id, user_ref, started_at, ended_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_calls | 20261104000088_msg_features.up.sql | id, company_id, conversation_id, initiated_by, call_type, status, provider, provider_room_id, started_at, answered_at, ended_at, participants_json, invited_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_config | 20261104000088_msg_features.up.sql | id, company_id, config_json, config_version, status, instance_id, effective_from, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| sec_devices | 20261104000090_sec_messaging.up.sql | id, company_id, user_ref, device_no, device_name, platform, registration_id, identity_key, fingerprint, revoked_at, revoked_by, revoke_reason, last_seen_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| sec_prekeys | 20261104000090_sec_messaging.up.sql | id, company_id, device_id, key_id, public_key, signature, signed, used_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| sec_conversations | 20261104000090_sec_messaging.up.sql | id, company_id, conversation_id, kind, pair_key, disappear_seconds, policy_version, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| sec_envelopes | 20261104000090_sec_messaging.up.sql | id, company_id, conversation_id, message_uid, sender_user, sender_device_id, recipient_user, recipient_device_id, ciphertext, size_bytes, delivered_at, expires_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| sec_policy | 20261104000090_sec_messaging.up.sql | id, company_id, config_json, config_version, status, instance_id, effective_from, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| sec_licence_reviews | 20261104000090_sec_messaging.up.sql | id, company_id, review_version, subject, document_json, status, instance_id, decided_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| oss_register | 20261104000090_sec_messaging.up.sql | id, company_id, component, component_version, licence, usage, obligations, compliance_status, entry_source, review_id, reviewed_by, reviewed_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_auto_group_rules | 20261104000092_msg_comcenter.up.sql | id, company_id, rule_version, group_type, scope_type, scope_id, role_filter_json, title, enabled, rule_status, instance_id, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_auto_group_links | 20261104000092_msg_comcenter.up.sql | id, company_id, rule_id, scope_key, conversation_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_instructions | 20261104000092_msg_comcenter.up.sql | id, company_id, message_id, conversation_id, sender_ref, title, priority, due_at, requires_ack, instruction_status, escalated_at, escalation_level, completed_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_acknowledgements | 20261104000092_msg_comcenter.up.sql | id, company_id, instruction_id, user_ref, acknowledged_at, response, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_announcements | 20261104000092_msg_comcenter.up.sql | id, company_id, title, body, sender_ref, audience_json, require_confirmation, quiz_json, publish_at, expires_at, announcement_status, published_at, recipient_count, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_announcement_reads | 20261104000092_msg_comcenter.up.sql | id, company_id, announcement_id, user_ref, read_at, confirmed_at, quiz_score, attempts, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_escalations | 20261104000092_msg_comcenter.up.sql | id, company_id, conversation_id, message_id, raised_by, reason, escalation_status, escalate_at, escalated_at, escalated_to_json, resolved_by, resolved_at, resolution, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| msg_actions | 20261104000092_msg_comcenter.up.sql | id, company_id, message_id, conversation_id, action_type, target_entity, target_id, target_label, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pol_policies | 20261104000094_pol_policies.up.sql | id, company_id, policy_no, title, category, owner_ref, department_id, applicability_json, current_version_id, policy_status, effective_from, review_due, archived_at, archive_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pol_versions | 20261104000094_pol_policies.up.sql | id, company_id, policy_id, version_no, body_html, attachments_json, change_summary, quiz_json, pass_mark, applicability_json, effective_from, review_due, ack_due_days, version_status, instance_id, submitted_by, submitted_at, approved_at, published_at, superseded_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pol_acknowledgements | 20261104000094_pol_policies.up.sql | id, company_id, policy_version_id, user_ref, due_at, notified_at, read_at, acknowledged_at, quiz_score, attempts, reminded_at, reminder_count, escalated_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pol_requirements | 20261104000094_pol_policies.up.sql | id, company_id, policy_version_id, clause_ref, requirement_text, proposed_artifact_type, proposed_config_json, req_status, artifact_entity, artifact_id, artifact_label, converted_by, converted_at, dismiss_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_records | 20261105000096_mdm_governance.up.sql | id, company_id, master_type, record_code, display_name, record_status, current_version_id, merged_into_id, dq_score, last_changed_at, last_reviewed_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_change_requests | 20261105000096_mdm_governance.up.sql | id, company_id, master_type, record_id, change_type, change_json, before_json, justification, effective_from, sensitive, duplicates_json, request_status, workflow_instance_id, requested_by, decided_by, decided_at, applied_at, target_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_record_versions | 20261105000096_mdm_governance.up.sql | id, company_id, record_id, version_no, data_json, effective_from, version_status, change_request_id, record_status_after, approved_by, approved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_duplicates | 20261105000096_mdm_governance.up.sql | id, company_id, master_type, record_a, record_b, score, match_rule, duplicate_status, resolution, resolved_by, resolved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_merge_map | 20261105000096_mdm_governance.up.sql | id, company_id, master_type, from_id, to_id, merged_at, merged_by, change_request_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_quality_rules | 20261105000096_mdm_governance.up.sql | id, company_id, config_version, master_type, field, rule, param, severity, active, config_status, instance_id, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_stewards | 20261105000096_mdm_governance.up.sql | id, company_id, config_version, master_type, user_id, user_ref, steward_role, config_status, instance_id, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_uoms | 20261105000098_mdm_common_masters.up.sql | id, company_id, code, name, name_hi, category, base_uom, factor_to_base, decimals, effective_from, effective_to, row_status, change_request_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_gst_rates | 20261105000098_mdm_common_masters.up.sql | id, company_id, code, description, igst_pct, cgst_pct, sgst_pct, cess_pct, effective_from, effective_to, row_status, change_request_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_hsn_sac | 20261105000098_mdm_common_masters.up.sql | id, company_id, code, code_type, description, default_gst_code, reverse_charge, effective_from, effective_to, row_status, change_request_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_tds_sections | 20261105000098_mdm_common_masters.up.sql | id, company_id, section, tax_kind, description, rate_individual, rate_company, threshold_single, threshold_annual, effective_from, effective_to, row_status, change_request_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_states | 20261105000098_mdm_common_masters.up.sql | id, company_id, code, gst_code, name, name_hi, is_ut, effective_from, effective_to, row_status, change_request_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_districts | 20261105000098_mdm_common_masters.up.sql | id, company_id, state_code, code, name, name_hi, effective_from, effective_to, row_status, change_request_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_currencies | 20261105000098_mdm_common_masters.up.sql | id, company_id, code, name, symbol, decimals, effective_from, effective_to, row_status, change_request_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_exchange_rates | 20261105000098_mdm_common_masters.up.sql | id, company_id, currency_code, fx_date, rate_to_inr, fx_source, effective_from, effective_to, row_status, change_request_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_banks | 20261105000098_mdm_common_masters.up.sql | id, company_id, bank_name, ifsc, branch, city, state_name, address, micr, effective_from, effective_to, row_status, change_request_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_payment_terms | 20261105000098_mdm_common_masters.up.sql | id, company_id, code, term_kind, description, advance_pct, credit_days, structure_json, effective_from, effective_to, row_status, change_request_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_lookup_lists | 20261105000098_mdm_common_masters.up.sql | id, company_id, code, name, name_hi, system_list, effective_from, effective_to, row_status, change_request_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_lookups | 20261105000098_mdm_common_masters.up.sql | id, company_id, list_code, code, label_en, label_hi, sort_order, active, effective_from, effective_to, row_status, change_request_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_item_categories | 20261105000100_mdm_items.up.sql | id, company_id, parent_id, code, name, name_hi, code_prefix, item_types_json, attribute_template_json, default_hsn_code, gl_mapping_code, steward_role, category_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_items | 20261105000100_mdm_items.up.sql | id, company_id, code, version_no, name, name_hi, item_type, category_id, description, spec_json, spec_key, search_text, base_uom, hsn_sac_code, gst_code, stock_tracked, batch_tracked, serial_tracked, shelf_life_days, reorder_level, reorder_quantity, standard_amount, last_purchase_amount, last_purchase_at, preferred_brands_json, image_file_id, item_status, effective_from, effective_to, supersedes_id, workflow_instance_id, requested_by, legacy_code, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_item_uoms | 20261105000100_mdm_items.up.sql | id, company_id, item_id, uom, factor_to_base, purpose, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_item_resources | 20261105000100_mdm_items.up.sql | id, company_id, parent_item_id, component_item_id, qty_per_unit, uom, wastage_pct, sort_order, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_item_makes | 20261105000100_mdm_items.up.sql | id, company_id, item_id, make, model, approved, approved_by, approved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_item_alternates | 20261105000100_mdm_items.up.sql | id, company_id, item_id, alternate_item_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_item_code_counters | 20261105000100_mdm_items.up.sql | id, company_id, category_id, next_seq, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_item_user_marks | 20261105000100_mdm_items.up.sql | id, company_id, user_ref, item_id, mark, used_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_item_legacy_map | 20261105000100_mdm_items.up.sql | id, company_id, legacy_source, legacy_key, item_id, mapped_by, mapped_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_partners | 20261105000102_mdm_partners.up.sql | id, company_id, code, legal_name, trade_name, name_key, constitution, pan, msme_no, msme_category, cin, partner_status, status_reason, blacklist_reason, blacklist_until, payment_hold_until, payment_hold_reason, steward_role, workflow_instance_id, requested_by, activated_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_partner_roles | 20261105000102_mdm_partners.up.sql | id, company_id, partner_id, partner_role, categories_json, regions_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_partner_gstins | 20261105000102_mdm_partners.up.sql | id, company_id, partner_id, state_code, gstin, gstin_status, verify_source, verified_at, verified_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_partner_addresses | 20261105000102_mdm_partners.up.sql | id, company_id, partner_id, address_type, address, city, state_code, pin, is_default, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_partner_contacts | 20261105000102_mdm_partners.up.sql | id, company_id, partner_id, name, designation, email, mobile, is_primary, portal_user_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_partner_banks | 20261105000102_mdm_partners.up.sql | id, company_id, partner_id, account_no_encrypted, account_hash, ifsc, bank_name, branch, account_name, bank_status, verified_status, verify_method, verify_note, verified_at, otp_id, cheque_file_id, cooling_off_until, is_primary, change_reason, workflow_instance_id, requested_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_partner_documents | 20261105000102_mdm_partners.up.sql | id, company_id, partner_id, doc_type, document_ref, file_id, valid_from, valid_until, verified_by, verified_at, alert_stage, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_partner_tds | 20261105000102_mdm_partners.up.sql | id, company_id, partner_id, section, ldc_no, ldc_rate, ldc_limit, valid_from, valid_until, verified_by, verified_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_partner_status_requests | 20261105000102_mdm_partners.up.sql | id, company_id, partner_id, action, reason, until_date, request_status, workflow_instance_id, requested_by, decided_by, decided_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_account_groups | 20261105000104_fin_chart_of_accounts.up.sql | id, company_id, parent_id, code, name, nature, sort_order, group_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_accounts | 20261105000104_fin_chart_of_accounts.up.sql | id, company_id, group_id, code, name, account_type, normal_side, currency_code, is_control, control_kind, manual_posting_allowed, account_status, block_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_cost_heads | 20261105000104_fin_chart_of_accounts.up.sql | id, company_id, parent_id, code, name, default_account_id, default_account_code, head_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_cost_codes | 20261105000104_fin_chart_of_accounts.up.sql | id, company_id, code, name, cost_head_id, uom, code_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_dimension_rules | 20261105000104_fin_chart_of_accounts.up.sql | id, company_id, account_id, dimension, requirement, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_category_mappings | 20261105000104_fin_chart_of_accounts.up.sql | id, company_id, item_category_id, inventory_account_id, expense_account_id, cost_code_id, effective_from, effective_to, mapping_status, change_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_master_changes | 20261105000104_fin_chart_of_accounts.up.sql | id, company_id, entity, action, entity_id, change_json, before_json, reason, maker_role, request_status, workflow_instance_id, requested_by, decided_by, decided_at, applied_entity_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ra_resource_rates | 20261105000106_mdm_rate_analysis.up.sql | id, company_id, item_id, region_code, rate, uom, source_kind, basis_ref, effective_from, effective_to, entry_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ra_sor_books | 20261105000106_mdm_rate_analysis.up.sql | id, company_id, code, edition, name, authority, book_year, region_code, book_status, supersedes_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ra_sor_items | 20261105000106_mdm_rate_analysis.up.sql | id, company_id, book_id, item_code, parent_code, description, uom, rate, sort_order, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ra_analyses | 20261105000106_mdm_rate_analysis.up.sql | id, company_id, analysis_no, version_no, work_item_id, title, scope, region_code, basis_qty, basis_uom, water_pct, overhead_pct, profit_pct, contingency_pct, insurance_pct, escalation_pct, gst_pct, gst_treatment, direct_cost, unit_rate, unit_rate_gross, breakdown_json, formulas_json, sor_item_id, analysis_status, effective_from, effective_to, supersedes_id, template_code, workflow_instance_id, requested_by, released_by, released_at, calculated_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ra_analysis_lines | 20261105000106_mdm_rate_analysis.up.sql | id, company_id, analysis_id, line_no, component_type, component_item_id, description, uom, qty_per_basis, wastage_pct, rate, amount, line_origin, resource_rate_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_employees | 20261105000108_hr_employees.up.sql | id, company_id, emp_code, first_name, last_name, full_name, name_key, photo_file_id, gender, dob, blood_group, marital_status, mobile, email, permanent_address, current_address, branch_id, department_id, designation_id, grade, employment_type, doj, confirmation_date, manager_id, cost_centre_id, location_type, salary_payment_mode, employment_status, status_effective_date, last_working_date, separation_reason, access_note, record_status, languages_json, skills_json, user_id, workflow_instance_id, requested_by, activated_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_employee_statutory | 20261105000108_hr_employees.up.sql | id, company_id, employee_id, pan_enc, pan_hash, aadhaar_hash, uan, esic_ip, pf_applicable, esi_applicable, pt_state, lwf_state, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_employee_banks | 20261105000108_hr_employees.up.sql | id, company_id, employee_id, account_enc, account_hash, ifsc, bank_name, branch_name, account_name, bank_status, verified_status, verified_by, verified_at, verify_note, is_primary, change_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_employee_contacts | 20261105000108_hr_employees.up.sql | id, company_id, employee_id, contact_type, name, relation, phone, dob, share_pct, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_employee_education | 20261105000108_hr_employees.up.sql | id, company_id, employee_id, qualification, institute, pass_year, grade_text, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_employee_experience | 20261105000108_hr_employees.up.sql | id, company_id, employee_id, employer, job_title, from_date, to_date, leaving_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_employee_documents | 20261105000108_hr_employees.up.sql | id, company_id, employee_id, doc_type, document_ref, file_id, valid_from, valid_until, verified_by, verified_at, alert_stage, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_employee_changes | 20261105000108_hr_employees.up.sql | id, company_id, employee_id, change_type, effective_date, payload_enc, summary_json, before_json, reason, change_status, senior, workflow_instance_id, requested_by, requested_self, decided_by, decided_at, applied_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_employee_history | 20261105000108_hr_employees.up.sql | id, company_id, employee_id, event_type, effective_date, from_json, to_json, reference_doc, reason, change_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_headcount_plans | 20261105000110_hr_recruitment.up.sql | id, company_id, department_id, designation_id, approved_positions, valid_from, valid_to, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_requisitions | 20261105000110_hr_recruitment.up.sql | id, company_id, doc_no, revision_no, root_id, supersedes_id, doc_date, department_id, designation_id, positions, reason, replaces_employee_id, employment_type, location_type, manager_id, ctc_min, ctc_max, required_by, justification, plan_json, band, status, workflow_instance_id, requested_by, closed_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_candidates | 20261105000110_hr_recruitment.up.sql | id, company_id, full_name, mobile, email, source, source_detail, requisition_id, resume_file_id, current_ctc, expected_ctc, notice_days, stage, stage_at, reject_reason, rejected_from, retention_until, anonymised_at, profile_json, sensitive_enc, bgv_status, medical_status, employee_id, joined_on, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_interviews | 20261105000110_hr_recruitment.up.sql | id, company_id, candidate_id, round_no, scheduled_at, mode, panel_json, feedback_json, score, result, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_offers | 20261105000110_hr_recruitment.up.sql | id, company_id, doc_no, revision_no, supersedes_id, doc_date, candidate_id, designation_id, grade, employment_type, ctc_annual, breakup_json, doj_proposed, valid_days, band, band_reason, status, response, workflow_instance_id, requested_by, token_hash, sent_at, valid_until, responded_at, response_note, file_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_onboarding_tasks | 20261105000110_hr_recruitment.up.sql | id, company_id, candidate_id, employee_id, task_code, title, assigned_department_id, assigned_role, due_date, task_status, completed_at, completed_by, note, task_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_site_plans | 20261105000112_hr_deployments.up.sql | id, company_id, plan_site_id, designation_id, planned, valid_from, valid_to, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_crews | 20261105000112_hr_deployments.up.sql | id, company_id, crew_site_id, code, name, trade, supervisor_id, labour_contractor_id, active, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_crew_members | 20261105000112_hr_deployments.up.sql | id, company_id, crew_id, person_type, person_id, from_date, to_date, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_deployments | 20261105000112_hr_deployments.up.sql | id, company_id, doc_no, revision_no, root_id, supersedes_id, doc_date, person_type, person_id, dep_project_id, dep_site_id, crew_id, site_role, access_role, from_date, to_date, is_primary, default_wbs_id, default_cost_code_id, band, plan_json, status, workflow_instance_id, requested_by, closed_reason, transfer_id, activated_at, ended_event_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_transfers | 20261105000112_hr_deployments.up.sql | id, company_id, doc_no, revision_no, root_id, supersedes_id, doc_date, employee_id, kind, from_project_id, from_site_id, to_project_id, to_site_id, to_crew_id, site_role, relieve_date, join_date, return_date, reason, travel_required, accommodation_required, handover_json, scope, status, workflow_instance_id, requested_by, closed_reason, applied_at, applied_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| att_shifts | 20261105000114_att_config.up.sql | id, company_id, code, name, start_minute, end_minute, night_shift, break_minutes, grace_minutes, half_day_minutes, full_day_minutes, ot_after_minutes, rounding_minutes, rounding_mode, status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| att_policies | 20261105000114_att_config.up.sql | id, company_id, code, name, version_no, root_id, supersedes_id, effective_from, rules_json, band, status, workflow_instance_id, requested_by, change_note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| att_policy_assignments | 20261105000114_att_config.up.sql | id, company_id, scope_type, scope_id, policy_code, shift_id, weekly_off_json, holiday_calendar_id, effective_from, effective_to, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| att_rosters | 20261105000114_att_config.up.sql | id, company_id, roster_site_id, crew_id, name, pattern_json, from_date, to_date, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| att_roster_changes | 20261105000114_att_config.up.sql | id, company_id, doc_no, change_site_id, kind, employee_id, swap_employee_id, work_date, shift_id, is_off, swap_shift_id, swap_is_off, reason, band, status, workflow_instance_id, requested_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| att_period_defs | 20261105000114_att_config.up.sql | id, company_id, start_day, effective_from, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| att_periods | 20261105000114_att_config.up.sql | id, company_id, period_start, period_end, label, status, closed_by, closed_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| att_punches | 20261106000116_att_punches.up.sql | id, company_id, person_type, person_id, punch_site_id, punch_type, work_date, device_time, server_time, effective_time, lat, lng, accuracy_m, inside_fence, distance_m, selfie_file_id, method, recorded_by, device_id, offline, client_uuid, group_id, deployment_id, visit_id, result, reason_code, flags_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| att_anomalies | 20261106000116_att_punches.up.sql | id, company_id, punch_id, anomaly_type, severity, status, detail, reviewed_by, reviewed_at, review_note, band, workflow_instance_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| att_visits | 20261106000116_att_punches.up.sql | id, company_id, doc_no, employee_id, visit_site_id, work_date, reason, status, workflow_instance_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| att_device_bindings | 20261106000116_att_punches.up.sql | id, company_id, device_id, employee_id, first_seen_at, last_seen_at, punches, status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| att_site_settings | 20261106000116_att_punches.up.sql | id, company_id, setting_site_id, selfie_mode, flag_accuracy_m, reject_accuracy_m, tolerance_m, kiosk_enabled, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| att_daily | 20261106000118_att_register.up.sql | id, company_id, person_type, person_id, work_date, daily_site_id, status, late, early_going, late_minutes, early_minutes, in_time, out_time, worked_minutes, ot_minutes, ot_approved_minutes, ot_paid_minutes, ot_multiplier, paid_day, lop_day, comp_off, source, source_ids_json, flags_json, period_start, locked, computed_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| att_regularisations | 20261106000118_att_register.up.sql | id, company_id, doc_no, revision_no, root_id, supersedes_id, doc_date, employee_id, doc_site_id, work_date, requested_in, requested_out, reason, evidence_file_id, band, arrears, status, workflow_instance_id, requested_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| att_overtime_requests | 20261106000118_att_register.up.sql | id, company_id, doc_no, revision_no, root_id, supersedes_id, doc_date, employee_id, doc_site_id, work_date, ot_type, minutes_requested, minutes_approved, reason, band, arrears, status, workflow_instance_id, requested_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| att_manual_entries | 20261106000118_att_register.up.sql | id, company_id, doc_no, revision_no, root_id, supersedes_id, doc_date, employee_id, doc_site_id, work_date, entry_status, in_time, out_time, reason, evidence_file_id, band, arrears, status, workflow_instance_id, requested_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| att_period_locks | 20261106000118_att_register.up.sql | id, company_id, period_start, period_end, lock_site_id, status, locked_at, locked_by, summary_json, reopen_reason, reopen_requested_by, reopened_at, reopened_by, workflow_instance_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| att_arrears | 20261106000118_att_register.up.sql | id, company_id, person_type, person_id, work_date, arrears_site_id, period_start, lock_id, before_json, after_json, delta_paid, delta_lop, delta_ot_minutes, cause, status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| lv_types | 20261106000120_lv_leave.up.sql | id, company_id, code, name, paid, rules_json, status, sort_order, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| lv_entitlements | 20261106000120_lv_leave.up.sql | id, company_id, employee_id, leave_type_id, year, opening, accrued, adjusted, availed, lapsed, encashed, remaining, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| lv_ledger | 20261106000120_lv_leave.up.sql | id, company_id, employee_id, leave_type_id, year, txn_date, txn_type, days, ref_type, ref_id, ref_key, expires_on, note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| lv_applications | 20261106000120_lv_leave.up.sql | id, company_id, doc_no, revision_no, root_id, supersedes_id, doc_date, employee_id, leave_type_id, doc_site_id, from_date, to_date, half_day, days, leave_year, reason, attachment_file_id, delegate_user, delegation_id, applied_at, band, status, workflow_instance_id, requested_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| lv_adjustments | 20261106000120_lv_leave.up.sql | id, company_id, doc_no, revision_no, root_id, supersedes_id, doc_date, employee_id, leave_type_id, doc_site_id, year, days, reason, applied_at, band, status, workflow_instance_id, requested_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| lv_year_runs | 20261106000120_lv_leave.up.sql | id, company_id, year, status, summary_json, run_by, run_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| lab_workers | 20261106000122_lab_contract_labour.up.sql | id, company_id, doc_no, revision_no, root_id, supersedes_id, doc_date, status, band, workflow_instance_id, requested_by, worker_code, name, photo_file_id, aadhaar_hash, mobile, dob, gender, home_state, trade_code, skill_category, contractor_id, bank_enc, ifsc, uan, esic_ip, bocw_no, emergency_name, emergency_mobile, induction_status, induction_date, medical_status, medical_valid_until, ppe_json, worker_status, blacklist_reason, blacklisted_by, blacklisted_at, qr_token, card_issued_at, card_version, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| lab_contractor_compliance | 20261106000122_lab_contract_labour.up.sql | id, company_id, contractor_id, clra_licence_no, licence_valid_until, max_workers, pf_code, esi_code, wo_reference, wo_valid_until, alerted_for, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| lab_wage_rates | 20261106000122_lab_contract_labour.up.sql | id, company_id, doc_no, revision_no, root_id, supersedes_id, doc_date, status, band, workflow_instance_id, requested_by, kind, contractor_id, trade_code, skill_category, state_code, pay_basis, rate_minor, min_wage_ref, effective_from, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ess_requests | 20261106000124_ess_requests.up.sql | id, company_id, doc_no, revision_no, root_id, doc_date, employee_id, request_type, letter_type, purpose, addressed_to, payload_json, status, band, workflow_instance_id, requested_by, generated_doc_id, issued_at, issued_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| trn_courses | 20261106000126_trn_training.up.sql | id, company_id, code, title, title_hi, category, mode, mandatory_for_json, validity_months, pass_score, cert_type_code, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| trn_sessions | 20261106000126_trn_training.up.sql | id, company_id, doc_no, doc_date, course_id, start_at, end_at, trainer, venue, department_id, capacity, cost_minor, status, band, workflow_instance_id, requested_by, qr_token, completed_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| trn_attendance | 20261106000126_trn_training.up.sql | id, company_id, session_id, person_type, person_id, nominated_by, attendance, signed_in_at, sign_in_method, score, passed, feedback_rating, feedback, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| trn_cert_types | 20261106000126_trn_training.up.sql | id, company_id, code, name, name_hi, validity_months, alert_days, required_for_json, mandatory, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| trn_certifications | 20261106000126_trn_training.up.sql | id, company_id, person_type, person_id, cert_type, number, issuer, valid_from, valid_until, file_id, verified, verified_by, verified_at, cert_status, revoked_reason, session_id, alerted_state, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| trn_skill_defs | 20261106000126_trn_training.up.sql | id, company_id, code, name, name_hi, trade, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| trn_skills | 20261106000126_trn_training.up.sql | id, company_id, person_type, person_id, skill_code, level, assessed_on, assessor_id, assessor, notes, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| perf_cycles | 20261106000128_perf_performance.up.sql | id, company_id, code, name, kind, start_date, end_date, self_due, senior_from_level, cycle_status, opened_at, closed_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| perf_kpis | 20261106000128_perf_performance.up.sql | id, company_id, code, name, name_hi, applies_to_json, formula_ref, unit, direction, target_value, weight, effective_from, effective_to, kpi_status, activated_by, activated_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| perf_kpi_values | 20261106000128_perf_performance.up.sql | id, company_id, employee_id, kpi_code, period, as_of, value, target_value, score, sample_size, excluded_days, evidence_json, value_status, adjusted_by, adjust_reason, computed_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| perf_kpi_disputes | 20261106000128_perf_performance.up.sql | id, company_id, kpi_value_id, employee_id, reason, dispute_status, resolution, adjusted_value, resolved_by, resolved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| perf_goals | 20261106000128_perf_performance.up.sql | id, company_id, employee_id, cycle_id, title, measure, target_text, weight, progress_pct, goal_status, manager_note, agreed_by, agreed_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| perf_feedback | 20261106000128_perf_performance.up.sql | id, company_id, employee_id, author, author_employee_id, kind, body, shared, meeting_date, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| perf_reviews | 20261106000128_perf_performance.up.sql | id, company_id, doc_no, doc_date, employee_id, cycle_id, stage, status, band, self_rating, self_comments, self_at, manager_rating, manager_comments, manager_by, manager_at, calibrated_rating, calibration_reason, calibrated_by, calibrated_at, final_rating, kpi_score, goal_score, development_plan, workflow_instance_id, requested_by, letter_doc_id, letter_at, approved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| exp_policies | 20261106000130_exp_expenses.up.sql | id, company_id, grade, category, city_tier, limit_minor, per_diem_minor, mileage_rate_minor, receipt_above_minor, effective_from, effective_to, policy_status, activated_by, activated_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| exp_travel_requests | 20261106000130_exp_expenses.up.sql | id, company_id, doc_no, doc_date, employee_id, purpose, from_place, to_place, start_date, end_date, mode, est_cost_minor, advance_minor, status, workflow_instance_id, requested_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| exp_advances | 20261106000130_exp_expenses.up.sql | id, company_id, doc_no, doc_date, employee_id, advance_type, amount_minor, purpose, recovery_mode, instalments, balance_minor, travel_request_id, status, workflow_instance_id, requested_by, disbursed_at, disbursed_by, disbursed_ref, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| exp_claims | 20261106000130_exp_expenses.up.sql | id, company_id, doc_no, doc_date, employee_id, period_from, period_to, purpose, city_tier, travel_request_id, advance_id, total_minor, gst_minor, advance_adjusted_minor, net_payable_minor, recoverable_minor, flag_count, level, status, workflow_instance_id, requested_by, approved_at, passed_by, passed_at, paid_at, paid_ref, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| exp_claim_lines | 20261106000130_exp_expenses.up.sql | id, company_id, claim_id, line_no, category, spend_date, description, amount_minor, gst_minor, vendor_name, vendor_gstin, invoice_no, file_id, cost_code_id, km, days, limit_minor, policy_flag, flag_text, justification, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| exp_advance_recoveries | 20261106000130_exp_expenses.up.sql | id, company_id, advance_id, claim_id, kind, rec_status, due_month, amount_minor, done_on, reference, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_separations | 20261106000132_hr_exit_relations.up.sql | id, company_id, doc_no, doc_date, employee_id, sep_type, reason_code, reason, submitted_on, notice_days, standard_lwd, last_working_day, early_mode, waiver_days, buyout_days, notice_pay_days, status, workflow_instance_id, requested_by, approved_at, notice_change_id, exit_change_id, fnf_json, fnf_released_at, fnf_released_by, relieving_doc_id, experience_doc_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_clearances | 20261106000132_hr_exit_relations.up.sql | id, company_id, separation_id, department_code, department_name, owner_roles, owner_user, items_json, due_date, clr_status, cleared_by, cleared_at, waived_by, waive_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_exit_interviews | 20261106000132_hr_exit_relations.up.sql | id, company_id, separation_id, responses_json, overall_rating, reason_code, would_rejoin, conducted_by, conducted_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_grievances | 20261106000132_hr_exit_relations.up.sql | id, company_id, doc_no, doc_date, complainant_type, complainant_id, anonymous, tracking_hash, raised_by, category, subject, description, priority, assigned_to, sla_due, overdue_alerted, status, notes_json, resolution, resolved_by, resolved_at, closed_at, reopen_count, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_disciplinary_cases | 20261106000132_hr_exit_relations.up.sql | id, company_id, doc_no, doc_date, employee_id, incident_date, category, severity, incident, documents_json, actions_json, case_status, response_due, final_action, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bd_leads | 20261106000134_bd_crm.up.sql | id, company_id, doc_no, doc_date, source, source_ref, title, client_partner_id, client_name, contact_name, phone, email, sector, location, region, est_value_minor, qualification_json, qual_score, owner, status, workflow_instance_id, requested_by, amendment_no, opportunity_id, converted_at, converted_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bd_opportunities | 20261106000134_bd_crm.up.sql | id, company_id, doc_no, doc_date, lead_id, client_partner_id, name, sector, location, region, est_value_minor, probability_pct, probability_default_pct, probability_reason, expected_tender_date, expected_award_date, stage, competitors_json, owner, lost_reason_code, lost_reason, lost_to, won_via, won_value_minor, closed_on, status, workflow_instance_id, requested_by, amendment_no, award_status, award_instance_id, award_reason, award_value_minor, converted_at, converted_by, tender_ref, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bd_interactions | 20261106000134_bd_crm.up.sql | id, company_id, entity, entity_id, client_partner_id, type, interaction_date, participants_json, notes, email_ref, next_action, next_action_date, next_action_owner, next_done, task_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bd_contacts | 20261106000134_bd_crm.up.sql | id, company_id, partner_id, name, designation, email, mobile, influence_role, influence_level, stance, reports_to_id, relationship_owner, mdm_contact_id, notes, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bd_stage_log | 20261106000134_bd_crm.up.sql | id, company_id, opportunity_id, from_stage, to_stage, probability_pct, reason, changed_by, changed_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bd_amendments | 20261106000134_bd_crm.up.sql | id, company_id, entity, entity_id, amendment_no, snapshot_json, reason, amended_by, amended_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tdr_tenders | 20261106000136_tdr_tenders.up.sql | id, company_id, doc_no, doc_date, opportunity_id, client_partner_id, reference_no, portal, portal_name, name_of_work, location, region, est_cost_minor, emd_minor, tender_fee_minor, bid_type, period_months, publish_date, prebid_date, submission_at, opening_at, owner, bc_turnover_minor, bc_commitments_minor, bc_factor, bid_capacity_minor, capacity_json, stage, status, workflow_instance_id, requested_by, amendment_no, ready_at, ready_by, submitted_on, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tdr_eligibility | 20261106000136_tdr_tenders.up.sql | id, company_id, tender_id, seq, criterion, title, requirement_text, requirement_minor, our_minor, our_text, result, result_mode, waive_reason, notes, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tdr_bid_decisions | 20261106000136_tdr_tenders.up.sql | id, company_id, doc_no, doc_date, tender_id, scores_json, total_score, threshold, recommendation, decision, reasons, status, workflow_instance_id, requested_by, amendment_no, decided_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tdr_addenda | 20261106000136_tdr_tenders.up.sql | id, company_id, tender_id, number, kind, addendum_date, summary, impact, impact_note, new_prebid_date, new_submission_at, new_opening_at, ack_by, ack_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tdr_queries | 20261106000136_tdr_tenders.up.sql | id, company_id, tender_id, seq, clause_ref, query_text, addendum_number, status, submitted_on, response, response_date, raised_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tdr_team_tasks | 20261106000136_tdr_tenders.up.sql | id, company_id, tender_id, kind, title, assignee, due_date, status, task_id, done_at, notes, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tdr_date_log | 20261106000136_tdr_tenders.up.sql | id, company_id, tender_id, field, old_value, new_value, reason, addendum_number, changed_by, changed_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tdr_amendments | 20261106000136_tdr_tenders.up.sql | id, company_id, entity, entity_id, amendment_no, snapshot_json, reason, amended_by, amended_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tdr_credentials | 20261106000138_tdr_awards.up.sql | id, company_id, doc_no, cred_type, title, client_name, client_partner_id, sector, value_minor, completion_date, valid_until, tags_json, notes, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tdr_tender_credentials | 20261106000138_tdr_awards.up.sql | id, company_id, tender_id, credential_id, purpose, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tdr_emd | 20261106000138_tdr_awards.up.sql | id, company_id, doc_no, doc_date, tender_id, kind, mode, amount_minor, payee, exemption_reason, needed_by, instrument_no, bank, issue_date, valid_until, issued_by, status, workflow_instance_id, requested_by, amendment_no, refund_status, result_on, refund_requested_on, refunded_on, refund_ref, refund_note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tdr_submissions | 20261106000138_tdr_awards.up.sql | id, company_id, doc_no, doc_date, tender_id, checklist_json, estimate_minor, estimate_source, estimate_ref, bid_amount_minor, adjustment_minor, adjustment_reason, status, workflow_instance_id, requested_by, amendment_no, submitted_at, submitted_by, portal_ref, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tdr_competitors | 20261106000138_tdr_awards.up.sql | id, company_id, name, name_key, partner_id, notes, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tdr_bid_results | 20261106000138_tdr_awards.up.sql | id, company_id, tender_id, competitor_id, bidder_partner_id, bidder_name, is_us, qualified, quoted_minor, bid_rank, opened_on, note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tdr_negotiations | 20261106000138_tdr_awards.up.sql | id, company_id, tender_id, round_no, held_on, our_offer_minor, client_counter_minor, notes, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tdr_awards | 20261106000138_tdr_awards.up.sql | id, company_id, doc_no, doc_date, tender_id, outcome, loa_no, loa_date, awarded_value_minor, awarded_to, loss_reason_code, loss_reason, status, workflow_instance_id, requested_by, amendment_no, decided_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| est_estimates | 20261106000140_est_estimates.up.sql | id, company_id, doc_no, version_no, title, tender_id, basis_date, region_code, currency_code, ho_overhead_pct, contingency_pct, escalation_pct, gst_pct, direct_cost, indirect_cost, overhead_amount, risk_amount, contingency_amount, escalation_amount, total_cost, total_selling, margin_amount, margin_pct, gst_amount, bid_value, breakdown_json, calculated_at, status, workflow_instance_id, requested_by, approved_at, supersedes_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| est_estimate_items | 20261106000140_est_estimates.up.sql | id, company_id, estimate_id, section_code, section_name, item_no, sort_order, description, uom, qty, client_rate, work_item_id, build_mode, analysis_id, cost_rate, markup_pct, selling_rate, cost_amount, amount, priced_at, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| est_item_components | 20261106000140_est_estimates.up.sql | id, company_id, estimate_item_id, line_no, component_type, component_item_id, description, uom, qty_per_unit, rate, amount, line_origin, resource_rate_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| est_indirects | 20261106000140_est_estimates.up.sql | id, company_id, estimate_id, sort_order, category, description, basis, qty, rate, percent, amount, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| est_risks | 20261106000140_est_estimates.up.sql | id, company_id, estimate_id, sort_order, description, impact, probability_pct, exposure, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mto_takeoffs | 20261106000142_mto_takeoffs.up.sql | id, company_id, doc_no, revision_no, kind, discipline, title, tender_id, estimate_id, drawing_ref, drawing_rev, status, workflow_instance_id, requested_by, released_at, supersedes_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mto_takeoff_lines | 20261106000142_mto_takeoffs.up.sql | id, company_id, takeoff_id, line_no, boq_item_ref, description, location, formula_code, work_item_id, material_item_id, spec, nos, length, breadth, height, deduction, quantity, uom, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mto_bbs | 20261106000142_mto_takeoffs.up.sql | id, company_id, doc_no, revision_no, title, drawing_ref, drawing_rev, member, total_weight, status, workflow_instance_id, requested_by, released_at, supersedes_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mto_bbs_lines | 20261106000142_mto_takeoffs.up.sql | id, company_id, bbs_id, line_no, member, bar_mark, dia_mm, shape_code, dim_a, dim_b, dim_c, dim_d, members_count, bars_each, nos, cut_length_m, total_length_m, unit_weight, weight_kg, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mto_material_requirements | 20261106000142_mto_takeoffs.up.sql | id, company_id, source_ref, item_id, description, boq_item_ref, net_qty, wastage_pct, qty, uom, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| est_reviews | 20261107000144_est_reviews.up.sql | id, company_id, estimate_id, reviewer, checklist_json, comments, verdict, review_status, workflow_task_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| est_bid_summary | 20261107000144_est_reviews.up.sql | id, company_id, estimate_id, direct_cost, indirect_cost, overhead_amount, contingency_amount, escalation_amount, total_cost, profit_amount, selling_amount, discount_pct, discount_amount, net_price, gst_pct, gst_amount, bid_price, discount_reason, discount_status, workflow_instance_id, requested_by, decided_at, calculated_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| est_assumptions | 20261107000144_est_reviews.up.sql | id, company_id, estimate_id, kind, sort_order, text, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_projects | 20261107000146_proj_projects.up.sql | id, company_id, project_id, status, lifecycle_state, sector, location, client_partner_id, consultant_partner_id, funder_partner_id, tender_id, contract_type, contract_no, contract_value, start_date, scheduled_completion, revised_completion, dlp_months, retention_pct, mob_advance_pct, ld_summary, pm_user, director_user, settings_json, setup_json, pending_json, workflow_instance_id, requested_by, activated_at, activated_by, closed_at, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_milestones | 20261107000146_proj_projects.up.sql | id, company_id, project_id, code, name, planned_date, actual_date, contractual, payment_linked, milestone_status, sort_order, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_lifecycle_log | 20261107000146_proj_projects.up.sql | id, company_id, project_id, kind, from_state, to_state, log_status, checklist_json, warnings_json, changes_json, reason, workflow_instance_id, by_user, decided_at, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_baseline_packs | 20261107000148_proj_baseline.up.sql | id, company_id, doc_no, doc_date, pack_no, supersedes_id, project_id, tender_id, award_id, estimate_id, contract_value, snapshot_json, snapshot_hash, clauses_json, file_id, status, workflow_instance_id, requested_by, amend_reason, signed_off_at, signed_off_by, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_handover_meetings | 20261107000148_proj_baseline.up.sql | id, company_id, pack_id, meeting_date, venue, attendees_json, questions_json, minutes, actions_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_boq_items | 20261107000148_proj_baseline.up.sql | id, company_id, estimate_item_id, section_code, section_name, item_no, sort_order, description, uom, qty, client_rate, cost_rate, markup_pct, selling_rate, cost_amount, amount, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_wbs | 20261107000150_proj_structure.up.sql | id, company_id, project_id, parent_id, code, name, level, weight, discipline, responsible_user, is_control_account, sort_order, wbs_status, description, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_wbs_versions | 20261107000150_proj_structure.up.sql | id, company_id, project_id, version_no, kind, version_status, reason, ops_json, snapshot_json, diff_json, workflow_instance_id, requested_by, decided_at, project_ref_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_work_packages | 20261107000150_proj_structure.up.sql | id, company_id, project_id, code, name, wp_type, wbs_ids_json, owner_user, wp_status, description, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_locations | 20261107000150_proj_structure.up.sql | id, company_id, project_id, parent_id, loc_type, code, name, chainage_from, chainage_to, lat, lng, sort_order, loc_status, description, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_wbs_locations | 20261107000150_proj_structure.up.sql | id, company_id, project_id, wbs_id, location_id, note, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_boq_versions | 20261107000152_proj_boq.up.sql | id, company_id, doc_no, org_project_id, vtype, version_no, name, source_ref, parent_version_id, variation_ref, status, total_amount, items_count, import_map_json, frozen_at, frozen_by, workflow_instance_id, requested_by, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_boq_lines | 20261107000152_proj_boq.up.sql | id, company_id, version_id, parent_id, line_kind, item_code, description, uom, qty, rate, amount, is_extra, work_item_id, analysis_id, cost_code_id, sort_order, source_line_id, source_row, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_boq_line_wbs | 20261107000152_proj_boq.up.sql | id, company_id, line_id, wbs_id, location_id, qty, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_boq_line_norms | 20261107000152_proj_boq.up.sql | id, company_id, line_id, resource_item_id, norm_type, description, uom, qty_per_unit, wastage_pct, sort_order, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_boq_changes | 20261107000152_proj_boq.up.sql | id, company_id, version_id, change_status, reason, ops_json, diff_json, workflow_instance_id, requested_by, decided_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_boq_import_rows | 20261107000152_proj_boq.up.sql | id, company_id, stage_id, user_ref, org_project_id, row_no, data_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_team | 20261107000154_proj_team_meetings.up.sql | id, company_id, org_project_id, user_id, username, project_role, from_date, to_date, team_status, reason, workflow_instance_id, requested_by, assignment_request_id, assignment_id, access_note, decided_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_stakeholders | 20261107000154_proj_team_meetings.up.sql | id, company_id, org_project_id, skind, organisation, name, role_title, influence, interest, email, phone, partner_id, sstatus, notes, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_comm_matrix | 20261107000154_proj_team_meetings.up.sql | id, company_id, org_project_id, info, stakeholder_id, audience, frequency, channel, owner_user, notes, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_meetings | 20261107000154_proj_team_meetings.up.sql | id, company_id, doc_no, rev_no, supersedes_id, org_project_id, mtype, title, meeting_date, start_time, location, chair_user, minute_taker, attendees_json, agenda_json, minutes, decisions_json, distribution_json, status, workflow_instance_id, requested_by, revision_reason, issued_at, issued_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_meeting_actions | 20261107000154_proj_team_meetings.up.sql | id, company_id, meeting_id, org_project_id, action_no, description, owner_user, due_date, priority, task_id, action_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_risk_settings | 20261107000156_proj_risks.up.sql | id, company_id, org_project_id, contingency_pool, thresholds_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_risks | 20261107000156_proj_risks.up.sql | id, company_id, doc_no, org_project_id, rtype, title, description, cause, effect, category, wbs_id, cost_code_id, activity_ref, clause_ref, owner_user, probability, impact_cost, impact_time, impact_quality, impact_safety, score, level, strategy, residual_probability, residual_impact, residual_score, residual_level, exposure_cost_min, exposure_cost_ml, exposure_cost_max, exposure_time_min, exposure_time_ml, exposure_time_max, probability_pct, emv, contingency_allocated, status, close_reason, close_occurred, closed_at, closed_by, workflow_instance_id, requested_by, occurred_issue_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_risk_actions | 20261107000156_proj_risks.up.sql | id, company_id, risk_id, org_project_id, action_no, description, owner_user, due_date, task_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_risk_triggers | 20261107000156_proj_risks.up.sql | id, company_id, risk_id, org_project_id, name, indicator, comparator, threshold, unit, current_value, trigger_status, fired_at, last_reading_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_risk_contingency | 20261107000156_proj_risks.up.sql | id, company_id, risk_id, org_project_id, kind, amount, entry_status, reason, by_user, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_risk_issues | 20261107000156_proj_risks.up.sql | id, company_id, doc_no, org_project_id, risk_id, title, description, priority, owner_user, due_date, wbs_id, impact_cost, impact_time, impact_text, resolution, status, resolved_at, resolved_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_risk_snapshots | 20261107000156_proj_risks.up.sql | id, company_id, org_project_id, period, data_json, notes, snap_status, workflow_instance_id, requested_by, approved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| gis_layers | 20261107000158_gis.up.sql | id, company_id, org_project_id, name, ltype, geojson, style_json, visible_roles_json, cfg_status, has_live, pending_json, revision, workflow_instance_id, requested_by, approved_at, effective_from, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| gis_overlays | 20261107000158_gis.up.sql | id, company_id, org_project_id, name, image_url, file_id, bounds_json, opacity, cfg_status, has_live, pending_json, revision, workflow_instance_id, requested_by, approved_at, effective_from, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| gis_progress | 20261107000158_gis.up.sql | id, company_id, org_project_id, location_id, activity, pct, as_of, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proj_360_widgets | 20261107000161_proj_360.up.sql | id, company_id, widget_code, module, tab, slot, sort_order, permission_key, owner_part, title, title_hi, empty_text, drill_route, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| engg_drawings | 20261108000163_engg_drawings.up.sql | id, company_id, org_project_id, drawing_no, title, discipline, package_name, wbs_id, location_id, scale, sheet_size, originator_type, originator, document_id, planned_receipt, actual_receipt, current_revision_id, current_revision, current_status_code, current_ifc_revision_id, response_code, response_date, register_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| engg_drawing_revisions | 20261108000163_engg_drawings.up.sql | id, company_id, drawing_id, org_project_id, rev_seq, rev_label, status_code, issue_purpose, change_note, cloud_summary, received_on, issued_on, file_id, supersedes_id, rev_status, superseded_by_id, superseded_at, workflow_instance_id, requested_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| engg_drawing_links | 20261108000163_engg_drawings.up.sql | id, company_id, drawing_id, org_project_id, link_type, target_id, target_ref, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| engg_transmittals | 20261108000163_engg_drawings.up.sql | id, company_id, doc_no, org_project_id, direction, party, contact, purpose, cover_note, issued_on, due_on, status, closed_at, workflow_instance_id, requested_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| engg_transmittal_items | 20261108000163_engg_drawings.up.sql | id, company_id, transmittal_id, org_project_id, drawing_id, revision_id, copies, response_code, response_date, comments, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| engg_copies | 20261108000163_engg_drawings.up.sql | id, company_id, drawing_id, revision_id, org_project_id, holder_user, holder_site_id, copy_no, issued_on, acknowledged_at, acknowledged_by, copy_status, replaced_by_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| engg_rfis | 20261109000165_engg_rfis.up.sql | id, company_id, rfi_no, org_project_id, subject, question, discipline, rfi_site_id, wbs_id, location_id, activity_ref, activity_critical, hold_activity, boq_item_id, drawing_id, drawing_revision_id, spec_ref, proposed_solution, priority, required_by, cost_impact_flag, time_impact_flag, ball_in_court, status, issued_on, consultant, response_type, response_text, responded_on, responded_by, response_revision_id, instruction_ref, cost_impact, time_impact_days, variation_ref, verified_by, verified_on, closed_at, escalated_at, issue_workflow_id, close_workflow_id, requested_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| engg_rfi_routing | 20261109000165_engg_rfis.up.sql | id, company_id, rfi_id, org_project_id, seq, event, from_party, to_party, note, at, by_user, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| engg_rfi_delay_drafts | 20261109000165_engg_rfis.up.sql | id, company_id, rfi_id, org_project_id, delay_days, activity_ref, reason, draft_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| engg_submittals | 20261110000167_engg_submittals.up.sql | id, company_id, submittal_no, org_project_id, submittal_type, title, spec_section, activity_ref, wbs_id, item_id, material_ref, make, model, supplier, drawing_id, hse_ref, consultant, need_date, lead_time_days, review_days, required_by, current_rev, submitted_on, response_code, response_on, response_text, status, workflow_instance_id, requested_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| engg_submittal_revisions | 20261110000167_engg_submittals.up.sql | id, company_id, submittal_id, org_project_id, rev_no, change_note, submitted_on, response_code, response_on, response_by, response_text, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| engg_approved_makes | 20261110000167_engg_submittals.up.sql | id, company_id, submittal_id, org_project_id, item_id, material_ref, make, model, supplier, approved_on, approval_code, make_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| engg_deliverables | 20261111000169_engg_deliverables.up.sql | id, company_id, deliverable_no, org_project_id, title, discipline, deliverable_type, package_name, weight, plan_ifr, plan_ifa, plan_ifc, plan_asbuilt, act_ifr, act_ifa, act_ifc, act_asbuilt, milestone, progress_bp, drawing_id, document_id, owner_user, release_status, workflow_instance_id, requested_by, reg_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| engg_crs | 20261111000169_engg_deliverables.up.sql | id, company_id, deliverable_id, org_project_id, revision, comment_no, comment_text, raised_by, response_text, responded_by, responded_on, comment_status, closed_on, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| engg_vdr_items | 20261111000169_engg_deliverables.up.sql | id, company_id, vdr_no, org_project_id, po_ref, vendor, doc_type, title, due_date, submitted_on, cycle_no, review_code, review_text, reviewed_on, status, workflow_instance_id, requested_by, pending_code, pending_text, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| engg_holds | 20261111000169_engg_deliverables.up.sql | id, company_id, hold_no, deliverable_id, org_project_id, description, impact_procurement, impact_construction, po_ref, activity_ref, raised_on, raised_by, cleared_on, cleared_by, clear_note, hold_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| engg_letters | 20261112000171_engg_letters.up.sql | id, company_id, org_project_id, direction, letter_no, series_seq, their_ref, letter_date, received_on, issued_on, party, party_contact, subject, category, clause_ref, contractual, confidentiality, response_due, assigned_to, tags, body_text, template_code, document_id, parent_letter_id, time_bar_id, issue_mode, delivery_ref, ack_on, ack_by, ack_note, overdue_alerted_on, status, workflow_instance_id, requested_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| engg_letter_links | 20261112000171_engg_letters.up.sql | id, company_id, letter_id, org_project_id, entity, entity_id, entity_ref, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| engg_time_bars | 20261112000171_engg_letters.up.sql | id, company_id, org_project_id, bar_no, description, clause_ref, trigger_letter_id, event_date, limit_days, deadline, claim_ref, owner_user, last_alert_days, served_letter_id, served_on, bar_status, waive_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bud_budgets | 20261113000173_bud_budgets.up.sql | id, company_id, doc_no, doc_date, org_project_id, version_no, vtype, name, baseline_pack_id, boq_version_id, parent_budget_id, status, contract_value, target_margin_pct, direct_total, overhead_total, contingency_total, reserve_total, total_amount, baseline_cost, lines_count, phasing_method, generated_at, approved_at, approved_by, locked_at, workflow_instance_id, requested_by, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bud_lines | 20261113000173_bud_budgets.up.sql | id, company_id, budget_id, line_kind, wbs_id, work_package_id, boq_line_id, cost_code_id, cost_head_id, resource_type, resource_name, uom, qty, rate, amount, gen_qty, gen_rate, gen_amount, origin, adjust_reason, adjusted_by, adjusted_at, unrated, sort_order, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bud_phasing | 20261113000173_bud_budgets.up.sql | id, company_id, budget_id, line_id, period, amount, qty, method, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bud_changes | 20261114000175_bud_changes.up.sql | id, company_id, doc_no, doc_date, org_project_id, budget_id, change_type, reason_code, title, justification, risk_id, variation_id, variation_ref, budget_total_before, total_delta, moved_amount, pct_of_budget, margin_before, margin_after, status, result_budget_id, amends_change_id, approved_at, approved_by, workflow_instance_id, requested_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bud_change_lines | 20261114000175_bud_changes.up.sql | id, company_id, change_id, line_id, line_kind, wbs_id, cost_code_id, resource_type, resource_name, uom, qty_before, amount_before, qty_delta, amount_delta, note, sort_order, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bud_check_config | 20261115000177_bud_ledger.up.sql | id, company_id, doc_no, cost_head_id, stage, mode, tolerance_pct, effective_from, status, reason, workflow_instance_id, requested_by, approved_by, approved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bud_commitments | 20261115000177_bud_ledger.up.sql | id, company_id, org_project_id, wbs_id, cost_code_id, cost_head_id, resource_type, stage, commit_type, doc_ref, vendor_ref, vendor_name, description, qty, amount, consumed_qty, consumed_amount, released_amount, status, commit_date, src_type, src_id, src_line_id, exception_id, check_result, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bud_commitment_log | 20261115000177_bud_ledger.up.sql | id, company_id, commitment_id, action, amount_delta, qty_delta, ref_type, ref_id, note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bud_actuals | 20261115000177_bud_ledger.up.sql | id, company_id, org_project_id, wbs_id, cost_code_id, cost_head_id, resource_type, commitment_id, consumed_amount, consumed_qty, doc_ref, vendor_ref, vendor_name, description, qty, amount, actual_date, status, src_type, src_id, src_line_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bud_dept_budgets | 20261116000179_bud_dept.up.sql | id, company_id, doc_no, doc_date, fy_id, cost_centre_id, department_id, version_no, vtype, name, status, total_amount, lines_count, parent_budget_id, reason, workflow_instance_id, requested_by, approved_by, approved_at, locked_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bud_dept_lines | 20261116000179_bud_dept.up.sql | id, company_id, budget_id, account_id, period_id, amount, note, sort_order, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bud_dept_actuals | 20261116000179_bud_dept.up.sql | id, company_id, fy_id, period_id, cost_centre_id, account_id, amount, src_type, src_id, src_line_id, doc_ref, narration, posted_date, status, reversed_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bud_alloc_rules | 20261116000179_bud_dept.up.sql | id, company_id, doc_no, fy_id, name, basis, rules_json, status, reason, requested_by, approved_by, approved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bud_alloc_runs | 20261116000179_bud_dept.up.sql | id, company_id, doc_no, fy_id, rule_id, basis, from_period_id, to_period_id, pool_source, basis_source, pool_amount, allocated_amount, projects_count, pool_json, status, run_by, reversed_by, reversed_at, reverse_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bud_alloc_lines | 20261116000179_bud_dept.up.sql | id, company_id, run_id, org_project_id, basis_value, share, amount, residual, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plan_calendars | 20261117000182_plan_core.up.sql | id, company_id, org_project_id, code, name, work_week, hours_per_day, holiday_calendar_id, exceptions_json, status, reason, requested_by, approved_by, approved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plan_schedules | 20261117000182_plan_core.up.sql | id, company_id, doc_no, doc_date, org_project_id, name, version_type, version_no, parent_schedule_id, calendar_id, start_date, data_date, finish_date, status, activities_count, critical_count, needs_calc, calculated_at, calc_ms, reason, workflow_instance_id, requested_by, approved_by, approved_at, locked_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plan_activities | 20261117000182_plan_core.up.sql | id, company_id, schedule_id, code, name, wbs_id, location_id, act_type, duration_days, calendar_id, constraint_type, constraint_date, qty, uom, es, ef, ls, lf, total_float, free_float, is_critical, actual_start, actual_finish, pct_complete, pct_source, remaining_days, responsible_user, sort_order, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plan_dependencies | 20261117000182_plan_core.up.sql | id, company_id, schedule_id, pred_id, succ_id, dep_type, lag_days, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plan_activity_boq | 20261117000182_plan_core.up.sql | id, company_id, activity_id, boq_line_id, qty, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plan_templates | 20261117000182_plan_core.up.sql | id, company_id, code, name, target, steps_json, chain_step, status, reason, requested_by, approved_by, approved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plan_activity_resources | 20261118000184_plan_gantt.up.sql | id, company_id, schedule_id, activity_id, resource_type, item_id, trade, res_key, label, uom, basis, qty_total, qty_per_day, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plan_resource_capacity | 20261118000184_plan_gantt.up.sql | id, company_id, org_project_id, resource_type, item_id, trade, res_key, label, uom, qty_per_day, from_date, to_date, status, reason, requested_by, approved_by, approved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plan_gantt_edits | 20261118000184_plan_gantt.up.sql | id, company_id, schedule_id, op, summary, before_json, after_json, finish_before, finish_after, undone_at, undone_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plan_baselines | 20261119000186_plan_baselines.up.sql | id, company_id, doc_no, doc_date, org_project_id, schedule_id, schedule_version_no, baseline_no, name, revision_type, reason, change_summary, reference_no, previous_baseline_id, snapshot_json, snapshot_hash, change_json, start_date, finish_date, data_date, activities_count, critical_count, links_count, status, is_current, workflow_instance_id, requested_by, approved_by, approved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plan_imports | 20261119000186_plan_baselines.up.sql | id, company_id, org_project_id, schedule_id, file_id, file_name, file_size, format, mode, mapping_json, parsed_json, result_json, activities_count, links_count, errors_count, warnings_count, status, imported_at, imported_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plan_lookaheads | 20261120000188_plan_lookahead.up.sql | id, company_id, org_project_id, schedule_id, la_site_id, location_id, from_date, to_date, weeks, generated_at, generated_by, activities_count, ready_count, blocked_count, status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plan_constraints | 20261120000188_plan_lookahead.up.sql | id, company_id, org_project_id, schedule_id, activity_id, ctype, description, owner_user, due_date, origin, src_entity, src_id, status, cleared_on, cleared_by, clear_note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plan_weekly_plans | 20261120000188_plan_lookahead.up.sql | id, company_id, doc_no, doc_date, org_project_id, wp_site_id, schedule_id, week_start, revision_no, parent_plan_id, status, items_count, completed_count, ppc, note, reason, workflow_instance_id, requested_by, approved_by, approved_at, closed_at, closed_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plan_weekly_items | 20261120000188_plan_lookahead.up.sql | id, company_id, plan_id, activity_id, crew_id, committed_qty, completed_qty, uom, completed, variance_code, note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plan_delays | 20261121000190_plan_delays.up.sql | id, company_id, doc_no, doc_date, org_project_id, schedule_id, title, description, cause_category, responsibility, start_date, end_date, delay_days, affected_activities_json, mitigation, concurrency_note, impact_days, tia_id, revision_no, parent_delay_id, status, src_entity, src_id, reason, workflow_instance_id, requested_by, approved_by, approved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plan_tia | 20261121000190_plan_delays.up.sql | id, company_id, delay_id, schedule_id, schedule_copy_ref, data_date, fragnet_json, completion_before, completion_after, impact_days, impact_working_days, result_json, analysed_by, analysed_at, note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plan_delay_evidence | 20261121000190_plan_delays.up.sql | id, company_id, delay_id, entity, entity_id, label, note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| site_work_fronts | 20261122000192_site_core.up.sql | id, company_id, org_project_id, wf_site_id, location_id, code, name, status, constraints_summary, sort_order, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| site_daily_plans | 20261122000192_site_core.up.sql | id, company_id, doc_no, org_project_id, dp_site_id, schedule_id, plan_date, supervisor, weekly_plan_id, copied_from_id, status, issued_at, issued_by, note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| site_daily_plan_lines | 20261122000192_site_core.up.sql | id, company_id, plan_id, activity_id, work_front_id, crew_id, planned_qty, uom, weekly_item_id, wa_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| site_work_authorisations | 20261122000192_site_core.up.sql | id, company_id, wa_no, org_project_id, wa_site_id, work_front_id, daily_plan_id, plan_date, activity_id, wbs_id, location_id, planned_qty, uom, drawing_id, drawing_revision, cost_code_id, budget_amount, budget_line_ref, permit_required, permit_ref, hold_points, start_time, end_time, supervisor, in_plan, is_emergency, emergency_reason, regularise_by, regularised_at, checks_json, revision_no, parent_wa_id, status, actual_qty, closure_notes, variance_reason, closed_at, closed_by, reason, workflow_instance_id, requested_by, approved_by, approved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| site_wa_resources | 20261122000192_site_core.up.sql | id, company_id, wa_id, resource_type, item_id, trade, crew_id, res_key, label, uom, headcount, planned_qty, actual_qty, source, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| site_wa_uses | 20261122000192_site_core.up.sql | id, company_id, org_project_id, wa_id, use_kind, src_entity, src_id, resource_type, res_key, qty, uom, use_date, result, control_result, exception_no, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| site_dprs | 20261123000194_site_dpr.up.sql | id, company_id, doc_no, org_project_id, dpr_site_id, dpr_date, supervisor, scope, work_front_id, weather_code, rain_mm, weather_ref, summary, status, revision_no, parent_dpr_id, submitted_at, submitted_via, received_at, cutoff_at, late, late_minutes, flags_json, reason, workflow_instance_id, requested_by, approved_by, approved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| site_dpr_work | 20261123000194_site_dpr.up.sql | id, company_id, dpr_id, wa_id, activity_id, location_id, qty, uom, planned_qty, prefill_qty, over_wa, reason, line_remarks, sort_order, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| site_dpr_labour | 20261123000194_site_dpr.up.sql | id, company_id, dpr_id, category, contractor_id, trade_code, headcount, man_days, ot_hours, att_headcount, att_man_days, variance_pct, flagged, reason, sort_order, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| site_dpr_materials | 20261123000194_site_dpr.up.sql | id, company_id, dpr_id, item_id, qty, uom, wa_id, issue_ref, prefill_qty, reason, sort_order, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| site_dpr_equipment | 20261123000194_site_dpr.up.sql | id, company_id, dpr_id, equipment_key, label, hours_worked, hours_idle, hours_breakdown, log_ref, prefill_hours, reason, sort_order, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| site_dpr_photos | 20261123000194_site_dpr.up.sql | id, company_id, dpr_id, file_id, caption, lat, lng, taken_at, location_id, markup_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| site_dpr_notes | 20261123000194_site_dpr.up.sql | id, company_id, dpr_id, note_type, note_text, linked_entity, linked_id, sort_order, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| site_weather | 20261124000196_site_conditions.up.sql | id, company_id, org_project_id, wx_site_id, wx_date, rainfall_mm, temp_min, temp_max, humidity_pct, wind_kmh, condition_code, source, connector_code, hours_lost, shutdown, shutdown_reason, pour_restricted, pour_reason, notes, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| site_hindrances | 20261124000196_site_conditions.up.sql | id, company_id, doc_no, org_project_id, hin_site_id, title, description, hin_type, start_date, end_date, affected_json, responsible_party, responsible_name, letter_id, status, revision_no, parent_hindrance_id, closure_notes, closed_at, closed_by, escalated_at, escalation_level, reason, workflow_instance_id, requested_by, approved_by, approved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| site_diary | 20261124000196_site_conditions.up.sql | id, company_id, org_project_id, dy_site_id, diary_date, category, entry_text, signed_by, signed_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| site_visitors | 20261124000196_site_conditions.up.sql | id, company_id, org_project_id, vis_site_id, visit_date, time_in, time_out, visitor_name, organisation, visitor_type, purpose, instructions, linked_letter_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| site_instructions | 20261125000198_site_instructions.up.sql | id, company_id, doc_no, org_project_id, ins_site_id, ins_type, ins_date, their_ref, from_party, to_party, subject, description, location_id, activity_id, due_date, cost_implication, time_implication, backcharge, backcharge_amount, backcharge_partner_id, letter_id, notice_due_date, variation_decision, variation_ref, variation_note, variation_by, variation_at, parties_json, status, revision_no, parent_instruction_id, closure_notes, closed_at, closed_by, reminded_at, reminder_level, reason, workflow_instance_id, requested_by, approved_by, approved_at, issued_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| site_instruction_acks | 20261125000198_site_instructions.up.sql | id, company_id, instruction_id, party_type, party_id, party_name, acknowledged_at, acknowledged_by, compliance_note, closed_at, closed_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| prs_periods | 20261126000200_site_progress.up.sql | id, company_id, doc_no, org_project_id, period_type, period_start, period_end, actual_cost, adjustments_json, snapshot_json, snapshot_hash, physical_pct, planned_pct, financial_pct, status, revision_no, parent_period_id, reason, workflow_instance_id, requested_by, closed_by, closed_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| prs_activity_progress | 20261126000200_site_progress.up.sql | id, company_id, org_project_id, activity_id, activity_code, work_date, qty, cum_qty, pct_complete, source, dpr_id, dpr_scope, prog_site_id, period_id, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| prs_evm | 20261126000200_site_progress.up.sql | id, company_id, org_project_id, period_id, wbs_id, period_end, bac, pv, ev, ac, sv, cv, spi, cpi, eac, tcpi, planned_pct, physical_pct, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| prs_weights | 20261126000200_site_progress.up.sql | id, company_id, org_project_id, activity_code, weight_amount, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| prod_norms | 20261127000202_site_productivity.up.sql | id, company_id, org_project_id, activity_code, work_type, resource_type, output_per_unit, uom, source, effective_from, status, note, workflow_instance_id, requested_by, approved_by, approved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| prod_actuals | 20261127000202_site_productivity.up.sql | id, company_id, org_project_id, prod_site_id, work_date, activity_id, activity_code, work_type, crew_id, contractor_id, dpr_id, dpr_work_id, dpr_scope, qty, uom, man_days, machine_hours, alloc_basis, norm_labour, norm_equipment, productivity, productivity_machine, variance_pct, machine_variance_pct, shortfall_md, loss_reason, derived_reason, outlier, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| prod_losses | 20261127000202_site_productivity.up.sql | id, company_id, org_project_id, loss_site_id, loss_date, activity_code, reason_code, hours_lost, note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| prod_alerts | 20261127000202_site_productivity.up.sql | id, company_id, org_project_id, alert_site_id, activity_code, work_type, days, from_date, to_date, avg_pct, status, raised_at, cleared_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctl_facts | 20261128000204_site_control.up.sql | id, company_id, org_project_id, wbs_id, cost_code_id, resource_type, period_key, planned_qty, planned_cost, budget_qty, budget_cost, committed_cost, actual_qty, actual_cost, earned_cost, certified_value, billed_value, forecast_cost, refreshed_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctl_unallocated | 20261128000204_site_control.up.sql | id, company_id, org_project_id, src_type, src_id, src_line_id, doc_ref, vendor_name, description, resource_type, amount, qty, actual_date, reason, status, alloc_wbs_id, alloc_cost_code_id, allocated_to_json, note, workflow_instance_id, requested_by, approved_by, approved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctl_recon_runs | 20261128000204_site_control.up.sql | id, company_id, org_project_id, run_kind, status, tolerance, checked, diff_count, diff_json, run_at, run_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_material_requests | 20261129000206_proc_requests.up.sql | id, company_id, doc_no, doc_date, org_project_id, mr_site_id, requested_by, required_by, wa_id, activity_id, priority, purpose, status, revision_no, parent_id, workflow_instance_id, submitted_at, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_mr_lines | 20261129000206_proc_requests.up.sql | id, company_id, mr_id, line_no, item_id, qty, uom, wbs_id, cost_code_id, fulfilment_mode, issue_qty, transfer_qty, pr_qty, fulfilled_qty, from_store_code, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_requisitions | 20261129000206_proc_requests.up.sql | id, company_id, doc_no, doc_date, org_project_id, pr_site_id, pr_source, direct_reason, requested_by, required_by, priority, purpose, total_amount, budget_check_status, checks_json, is_emergency, emergency_reason, regularise_by, regularised_at, overdue_notified, status, revision_no, parent_id, root_id, workflow_instance_id, submitted_at, approved_by, approved_at, cancel_reason, closed_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_pr_lines | 20261129000206_proc_requests.up.sql | id, company_id, pr_id, line_no, item_id, service_desc, qty, uom, est_rate, est_amount, valued_from, required_by, delivery_site_id, wbs_id, cost_code_id, spec, preferred_vendor_id, approved_makes, ordered_qty, balance_qty, closed_qty, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_pr_sources | 20261129000206_proc_requests.up.sql | id, company_id, pr_line_id, mr_line_id, qty, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_stock_levels | 20261129000206_proc_requests.up.sql | id, company_id, item_id, store_code, store_name, store_kind, store_site_id, free_qty, as_of, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_mrp_runs | 20261130000208_proc_mrp.up.sql | id, company_id, doc_no, doc_date, org_project_id, run_kind, horizon_weeks, buffer_days, include_mto, parameters_json, status, schedule_id, run_at, run_by, item_count, shortage_count, proposal_count, warnings_json, revision_no, parent_id, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_mrp_lines | 20261130000208_proc_mrp.up.sql | id, company_id, run_id, item_id, week_start, gross_req, free_stock, open_po, in_transit, open_pr, safety_stock, net_req, proposed_qty, projected_end, required_by, order_by, late, source_activities_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_mrp_proposals | 20261130000208_proc_mrp.up.sql | id, company_id, run_id, org_project_id, item_id, uom, qty, proposed_qty, required_by, order_by, late, long_lead, lead_days, vendor_id, alternates_json, substitute_item_id, decision, decided_by, decided_at, reason, modified, pr_id, source_activities_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_item_params | 20261130000208_proc_mrp.up.sql | id, company_id, item_id, vendor_id, lead_time_days, moq, pack_size, safety_stock, long_lead, capacity_note, effective_from, status, workflow_instance_id, requested_by, approved_by, approved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_open_supply | 20261130000208_proc_mrp.up.sql | id, company_id, org_project_id, item_id, supply_kind, doc_ref, balance_qty, expected_on, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_rfqs | 20261201000210_proc_rfq.up.sql | id, company_id, doc_no, doc_date, org_project_id, title, issue_date, due_date, terms_json, est_total, status, revision_no, parent_id, justified, justification, workflow_instance_id, requested_by, issued_at, issued_by, closed_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_rfq_lines | 20261201000210_proc_rfq.up.sql | id, company_id, rfq_id, line_no, pr_line_id, item_id, service_desc, qty, uom, spec, required_by, delivery_site_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_rfq_vendors | 20261201000210_proc_rfq.up.sql | id, company_id, rfq_id, vendor_id, channel, contact_to, token_hash, token_expires, token_used_at, response_status, sent_at, send_status, send_note, viewed_at, responded_at, decline_reason, reminder_count, last_reminder_at, regret_sent_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_quotations | 20261201000210_proc_rfq.up.sql | id, company_id, doc_no, rfq_id, vendor_id, org_project_id, quote_ref, quote_date, valid_until, delivery_days, payment_terms, freight_terms, gst_inclusive, gst_recoverable, version_no, parent_id, status, entered_via, entered_by, received_at, total_landed, deviations, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_quotation_lines | 20261201000210_proc_rfq.up.sql | id, company_id, quotation_id, rfq_line_id, offered_qty, rate, discount_pct, gst_rate, freight, loading, other_charges, landed_rate, landed_amount, make, deviation, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_rfq_clarifications | 20261201000210_proc_rfq.up.sql | id, company_id, rfq_id, vendor_id, asked_by, question, answer, answered_by, answered_at, share_all, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_comparative_statements | 20261202000212_proc_cs.up.sql | id, company_id, doc_no, doc_date, rfq_id, org_project_id, recommendation_type, recommended_split_json, reason_code, justification, total_value, savings_vs_budget, round_no, status, revision_no, parent_id, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_cs_lines | 20261202000212_proc_cs.up.sql | id, company_id, cs_id, rfq_line_id, vendor_id, quotation_id, quotation_line_id, offered_qty, landed_rate, rank_no, compliance, selected_qty, last_po_rate, last_project_rate, budget_rate, rc_rate, market_rate, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_cs_negotiations | 20261202000212_proc_cs.up.sql | id, company_id, cs_id, round_no, vendor_id, note, quotation_before_id, quotation_after_id, recorded_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_purchase_orders | 20261203000214_proc_po.up.sql | id, company_id, doc_no, doc_date, org_project_id, po_site_id, vendor_id, po_source, cs_id, direct_reason, is_emergency, delivery_address, delivery_state, vendor_state, vendor_gstin, supply_type, payment_terms, advance_pct, credit_days, milestone_terms, delivery_basis, freight_terms, insurance_terms, warranty_terms, ld_terms, ld_pct_per_week, ld_cap_pct, tc_text, documents_required, approved_makes, total_basic, total_freight, total_tax, total_amount, variance_flag, status, amendment_no, workflow_instance_id, requested_by, approved_by, approved_at, sent_at, sent_status, sent_note, ack_token_hash, ack_expires, acknowledged_at, acknowledged_by, close_reason, closed_at, cancel_reason, overdue_notified_on, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_po_lines | 20261203000214_proc_po.up.sql | id, company_id, po_id, line_no, pr_line_id, cs_line_id, item_id, description, qty, uom, rate, discount_pct, tax_code, gst_pct, basic_amount, freight_amount, cgst_amount, sgst_amount, igst_amount, tax_amount, line_amount, cs_rate, benchmark_rate, wbs_id, cost_code_id, delivery_site_id, received_qty, accepted_qty, invoiced_qty, short_closed_qty, balance_qty, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_po_schedules | 20261203000214_proc_po.up.sql | id, company_id, po_id, po_line_id, due_date, qty, received_qty, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_po_amendments | 20261203000214_proc_po.up.sql | id, company_id, po_id, kind, amendment_no, reason, changes_json, before_json, after_json, delta_amount, new_total, rate_increase, status, workflow_instance_id, requested_by, approved_by, approved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_dispatches | 20261203000214_proc_po.up.sql | id, company_id, po_id, asn_no, vendor_invoice_no, lr_no, vehicle_no, eway_bill_no, dispatch_date, expected_arrival, lines_json, entered_via, entered_by, status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_po_receipts | 20261203000214_proc_po.up.sql | id, company_id, po_id, po_line_id, grn_ref, received_on, qty, accepted_qty, on_time, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_po_advances | 20261203000214_proc_po.up.sql | id, company_id, po_id, doc_no, advance_amount, needed_by, reason, status, workflow_instance_id, requested_by, approved_by, approved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_price_indices | 20261204000216_proc_rc_so.up.sql | id, company_id, index_code, period, index_value, index_source, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_rate_contracts | 20261204000216_proc_rc_so.up.sql | id, company_id, doc_no, doc_date, title, vendor_id, valid_from, valid_to, ceiling_value, consumed_value, projects_json, regions_json, pv_json, terms, payment_terms, status, revision_no, parent_id, workflow_instance_id, requested_by, approved_by, approved_at, alerted_expiry, cancel_reason, close_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_rc_lines | 20261204000216_proc_rc_so.up.sql | id, company_id, rc_id, line_no, item_id, description, uom, rate, base_rate, tax_code, ceiling_qty, consumed_qty, pv_linked, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_rc_revisions | 20261204000216_proc_rc_so.up.sql | id, company_id, rc_id, revision_no, index_code, period, index_value, base_index, effective_from, changes_json, status, workflow_instance_id, requested_by, approved_by, approved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_service_orders | 20261204000216_proc_rc_so.up.sql | id, company_id, doc_no, doc_date, org_project_id, so_site_id, vendor_id, title, scope, deliverables, start_date, end_date, payment_terms, terms, total_value, certified_value, status, revision_no, parent_id, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, close_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_so_lines | 20261204000216_proc_rc_so.up.sql | id, company_id, so_id, line_no, description, pricing_kind, uom, qty, rate, line_amount, tax_code, wbs_id, cost_code_id, certified_qty, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_service_entries | 20261204000216_proc_rc_so.up.sql | id, company_id, doc_no, doc_date, so_id, org_project_id, period_from, period_to, entry_amount, certified_by, status, revision_no, parent_id, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_se_lines | 20261204000216_proc_rc_so.up.sql | id, company_id, se_id, so_line_id, qty, rate, line_amount, note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_po_rc | 20261204000216_proc_rc_so.up.sql | id, company_id, po_id, rc_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| proc_po_line_rc | 20261204000216_proc_rc_so.up.sql | id, company_id, po_line_id, rc_line_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| xpd_expediting_plans | 20261205000218_xpd_core.up.sql | id, company_id, doc_no, doc_date, po_id, org_project_id, required_on_site, transit_days, long_lead, inspection_required, expediter, status, revision_no, parent_id, workflow_instance_id, requested_by, approved_by, approved_at, eta, days_late, at_risk, alerted_late, alerted_on, cancel_reason, close_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| xpd_milestones | 20261205000218_xpd_core.up.sql | id, company_id, plan_id, seq_no, name, kind, planned_date, forecast_date, actual_date, ms_status, updated_via, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| xpd_inspections | 20261205000218_xpd_core.up.sql | id, company_id, doc_no, doc_date, po_id, org_project_id, itype, mandatory, call_date, inspection_date, inspector, agency, location, scope, result, punch_points_json, lines_json, irn_no, irn_date, status, revision_no, parent_id, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| xpd_shipments | 20261205000218_xpd_core.up.sql | id, company_id, doc_no, doc_date, po_id, org_project_id, transporter, vehicle_no, lr_no, bl_no, eway_bill_no, packing_list, packages, is_odc, odc_permit_no, odc_valid_to, odc_dimensions, dispatched_on, eta, delivered_on, lines_json, clearance, irn_id, status, requested_by, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| xpd_shipment_events | 20261205000218_xpd_core.up.sql | id, company_id, shipment_id, event_at, location, note, eta_after, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| vnd_prequalifications | 20261206000220_vnd_core.up.sql | id, company_id, doc_no, doc_date, partner_id, category_ids_json, regions_json, strategic, questionnaire_json, score, visit_date, visit_notes, visit_report_file_id, result, valid_until, conditions, status, revision_no, parent_id, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| vnd_avl | 20261206000220_vnd_core.up.sql | id, company_id, partner_id, category_id, region_code, avl_status, valid_from, valid_until, prequal_id, conditions, suspended_reason, suspended_on, reminded_for, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| vnd_scorecards | 20261206000220_vnd_core.up.sql | id, company_id, partner_id, period, period_from, period_to, on_time_pct, quality_pct, price_score, responsiveness, safety_score, invoice_accuracy, weights_json, evidence_json, total_score, rating, computed_at, computed_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| vnd_score_inputs | 20261206000220_vnd_core.up.sql | id, company_id, partner_id, period, kind, value_pct, note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| vnd_suspensions | 20261206000220_vnd_core.up.sql | id, company_id, doc_no, doc_date, partner_id, avl_ids_json, reason, auto_suggested, scorecard_id, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| vnd_actions | 20261206000220_vnd_core.up.sql | id, company_id, doc_no, partner_id, scorecard_id, kind, title, detail, owner_user, due_date, action_status, response, closed_by, closed_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| rti_observations | 20261207000222_rti_core.up.sql | id, company_id, item_id, spec_key, region_code, org_project_id, vendor_id, obs_date, rate, uom, landed_rate, base_uom, base_landed_rate, basis, is_outlier, outlier_reason, supersedes_id, correction_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| rti_indices | 20261207000222_rti_core.up.sql | id, company_id, index_group, region_code, period, index_value, index_source, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_stores | 20261209000225_inv_core.up.sql | id, company_id, code, name, store_type, org_project_id, org_site_id, address, keeper_ids_json, valuation_method, allow_negative, store_status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_store_changes | 20261209000225_inv_core.up.sql | id, company_id, doc_no, store_id, changes_json, reason, status, workflow_instance_id, requested_by, approved_by, approved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_bins | 20261209000225_inv_core.up.sql | id, company_id, store_id, code, zone, rack, shelf, capacity, is_default, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_stock_ledger | 20261209000225_inv_core.up.sql | id, company_id, doc_no, store_id, bin_id, item_id, batch_no, serial_no, txn_type, txn_date, qty_in, qty_out, rate, value, balance_qty, balance_value, wbs_id, reverses_id, reason, counter_id, posted_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_balances | 20261209000225_inv_core.up.sql | id, company_id, store_id, bin_id, item_id, batch_no, serial_no, qty_on_hand, qty_reserved, qty_inspection, qty_in_transit, avg_rate, value, last_receipt_on, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_valuation | 20261209000225_inv_core.up.sql | id, company_id, store_id, item_id, qty, value, avg_rate, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_fifo_layers | 20261209000225_inv_core.up.sql | id, company_id, store_id, item_id, ledger_id, layer_date, qty_remaining, layer_rate, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_reservations | 20261209000225_inv_core.up.sql | id, company_id, doc_no, store_id, item_id, qty, qty_consumed, alloc_json, reservation_status, needed_by, released_reason, reserved_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_adjustments | 20261209000225_inv_core.up.sql | id, company_id, doc_no, doc_date, store_id, adj_type, reason, lines_json, value_delta, status, workflow_instance_id, requested_by, approved_by, approved_at, posted_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_gate_appointments | 20261209000227_inv_gate_core.up.sql | id, company_id, doc_no, expected_on, expected_slot, org_project_id, org_site_id, vendor_id, po_id, shipment_id, vehicle_no, driver_name, driver_phone, material_desc, status, cancel_reason, requested_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_gate_inward | 20261209000227_inv_gate_core.up.sql | id, company_id, doc_no, entry_date, org_project_id, org_site_id, appointment_id, vehicle_no, driver_name, driver_phone, transporter, vendor_id, po_id, shipment_id, challan_no, challan_date, challan_kg, eway_bill_no, material_desc, time_in, time_out, unloading_store_id, unloading_note, unexpected, unexpected_why, flags_json, photos_json, status, workflow_instance_id, amendment_no, requested_by, approved_by, approved_at, handed_over_by, handed_over_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_gate_weighments | 20261209000227_inv_gate_core.up.sql | id, company_id, inward_id, gross_kg, tare_kg, net_kg, challan_kg, variance_pct, tolerance_pct, flagged, weigh_source, device_ref, slip_file_id, weighed_by, weighed_at, superseded, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_gate_passes | 20261209000227_inv_gate_core.up.sql | id, company_id, doc_no, pass_date, org_project_id, org_site_id, pass_type, returnable, expected_return, items_json, reference_type, reference_id, vendor_id, vehicle_no, driver_name, destination, purpose, qr_code, time_out, verified_by, returned_on, returned_note, overdue_notified_on, status, workflow_instance_id, amendment_no, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_grns | 20261209000229_inv_grn_core.up.sql | id, company_id, doc_no, received_date, org_project_id, org_site_id, store_id, po_id, gate_inward_id, vendor_id, challan_no, challan_date, invoice_no, emergency, emergency_why, excess, total_value, photos_json, status, workflow_instance_id, amendment_no, requested_by, approved_by, approved_at, posted_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_grn_lines | 20261209000229_inv_grn_core.up.sql | id, company_id, grn_id, line_no, po_line_id, item_id, uom, ordered_qty, balance_qty, challan_qty, received_qty, accepted_qty, rejected_qty, rate, line_value, batch_no, heat_no, mfg_date, cert_file_id, inspection_required, inspection_status, released_qty, qc_rejected_qty, returned_qty, wbs_id, cost_code_id, direct_charge, excess_qty, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_rtvs | 20261209000229_inv_grn_core.up.sql | id, company_id, doc_no, rtv_date, org_project_id, grn_id, vendor_id, store_id, reason, lines_json, total_value, gate_pass_id, debit_note_trigger, status, workflow_instance_id, amendment_no, requested_by, approved_by, approved_at, posted_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_issues | 20261209000231_inv_issue_core.up.sql | id, company_id, doc_no, issue_date, org_project_id, org_site_id, store_id, issue_type, wa_id, mr_id, activity_id, wbs_id, cost_code_id, issued_to_type, issued_to_id, issued_to_name, receiver_user, ack_method, ack_hash, ack_expires, ack_attempts, receiver_ack, receiver_name, receiver_ack_at, signature_file_id, exception_needed, total_value, recoverable_value, reason, status, workflow_instance_id, requested_by, approved_by, approved_at, posted_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_issue_lines | 20261209000231_inv_issue_core.up.sql | id, company_id, issue_id, line_no, item_id, uom, qty, authorised_qty, issued_before, excess_qty, batch_no, rate, value, charge_rate, returned_qty, mr_line_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_site_returns | 20261209000231_inv_issue_core.up.sql | id, company_id, doc_no, return_date, org_project_id, store_id, issue_id, from_type, from_id, from_name, condition, reason, lines_json, total_value, status, workflow_instance_id, requested_by, approved_by, approved_at, posted_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_sub_certified | 20261209000231_inv_issue_core.up.sql | id, company_id, org_project_id, subcontractor_id, boq_line_id, period, certified_qty, certificate_ref, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_free_issue_ledger | 20261209000231_inv_issue_core.up.sql | id, company_id, org_project_id, subcontractor_id, item_id, period, issued_qty, returned_qty, entitled_qty, excess_qty, recovery_rate, recovery_amount, computed_at, computed_by, notified, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_transfers | 20261209000233_inv_transfer_core.up.sql | id, company_id, doc_no, request_date, required_by, from_store_id, to_store_id, from_project_id, to_project_id, mr_id, inter_project, inter_state, document_type, vehicle_no, driver_name, eway_bill_no, eway_required, gate_pass_id, dispatch_date, dispatched_by, received_date, total_value, reason, photos_json, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_transfer_lines | 20261209000233_inv_transfer_core.up.sql | id, company_id, transfer_id, line_no, item_id, uom, qty_requested, qty_dispatched, qty_received, qty_damaged, qty_shortage, rate, value, batch_no, discrepancy_note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_transfer_discrepancies | 20261209000233_inv_transfer_core.up.sql | id, company_id, transfer_id, line_id, shortage_qty, damaged_qty, value, status, resolution, resolution_note, workflow_instance_id, raised_by, resolved_by, resolved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_count_plans | 20261209000235_inv_count_core.up.sql | id, company_id, doc_no, store_id, org_project_id, plan_type, abc_class, scheduled_date, freeze, scope_json, tolerance_pct, adjustment_id, started_at, closed_at, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_count_lines | 20261209000235_inv_count_core.up.sql | id, company_id, plan_id, line_no, item_id, bin_id, batch_no, owner_project_id, abc_class, book_qty, rate, counted_qty, recount_qty, final_qty, variance_qty, variance_value, needs_recount, reason, counted_by, counted_at, recounted_by, recounted_at, line_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_scrap_entries | 20261209000235_inv_count_core.up.sql | id, company_id, doc_no, entry_date, store_id, org_project_id, item_id, description, scrap_source, from_stock, batch_no, qty, uom, weight_kg, book_value, entry_status, disposal_id, recorded_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_scrap_disposals | 20261209000235_inv_count_core.up.sql | id, company_id, doc_no, disposal_date, store_id, org_project_id, method, buyer_partner_id, invoice_no, items_json, weight_kg, book_value, amount, gate_pass_id, reason, status, workflow_instance_id, requested_by, approved_by, approved_at, posted_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_reorder_params | 20261209000237_inv_reorder_core.up.sql | id, company_id, store_id, item_id, org_project_id, min_qty, max_qty, reorder_level, reorder_qty, lead_days, auto_calc, effective_from, change_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_reorder_changes | 20261209000237_inv_reorder_core.up.sql | id, company_id, doc_no, store_id, org_project_id, change_date, effective_from, lines_json, reason, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_reorder_suggestions | 20261209000237_inv_reorder_core.up.sql | id, company_id, doc_no, store_id, item_id, org_project_id, param_id, projected_qty, reorder_level, min_qty, suggested_qty, required_by, priority, status, mr_id, decided_by, decided_at, dismiss_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| inv_labels | 20261209000237_inv_reorder_core.up.sql | id, company_id, label_type, ref_id, store_id, batch_no, code_value, format, copies, printed_at, printed_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| rta_assets | 20261209000239_rta_core.up.sql | id, company_id, item_id, asset_group, unit_weight, internal_rate, charge_basis, replacement_value, life_months, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| rta_positions | 20261209000239_rta_core.up.sql | id, company_id, item_id, location_type, location_id, party_id, holder_project_id, holder_site_id, work_front, ownership, hire_id, qty, since_date, expected_return, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| rta_movements | 20261209000239_rta_core.up.sql | id, company_id, doc_no, movement_type, item_id, org_project_id, from_store_id, to_store_id, party_id, vendor_id, holding_id, dest_project_id, dest_site_id, work_front, wa_id, ownership, hire_id, qty, qty_good, qty_repairable, qty_scrap, qty_lost, movement_date, expected_return, hire_rate, hire_basis, order_ref, reason, status, workflow_instance_id, requested_by, approved_by, approved_at, posted_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| rta_hire_periods | 20261209000239_rta_core.up.sql | id, company_id, kind, item_id, vendor_id, org_project_id, movement_id, holder_key, qty, start_date, end_date, rate, charge_basis, amount, period_status, order_ref, bill_no, bill_amount, bill_diff, bill_status, bill_by, bill_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| rta_damage_recoveries | 20261209000239_rta_core.up.sql | id, company_id, doc_no, movement_id, item_id, org_project_id, party_id, loss_kind, qty, amount, disposition, reason, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ast_small_assets | 20261209000241_ast_core.up.sql | id, company_id, doc_no, tag_code, item_id, org_project_id, store_id, serial_no, make, model, purchase_ref, asset_value, custodian_type, custodian_id, custodian_name, asset_condition, calibration_required, calibration_due, inspection_days, last_inspection, next_inspection, asset_state, pending_log_id, purchase_date, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, dispose_status, dispose_method, dispose_amount, dispose_reason, dispose_workflow_id, disposed_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ast_custody_log | 20261209000241_ast_core.up.sql | id, company_id, asset_id, action, from_type, from_id, from_name, to_type, to_id, to_name, log_date, ack_method, ack_status, ack_hash, ack_expires, ack_attempts, ack_by, ack_at, asset_condition, reference, cost, note, done_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ast_loss_reports | 20261209000241_ast_core.up.sql | id, company_id, doc_no, asset_id, org_project_id, reported_by, report_date, loss_kind, description, investigation, custodian_type, custodian_id, custodian_name, recovery_from, recovery_party_id, recovery_amount, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mrc_key_materials | 20261209000243_mrc_core.up.sql | id, company_id, item_id, default_wastage_pct, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mrc_reconciliations | 20261209000243_mrc_core.up.sql | id, company_id, doc_no, org_project_id, org_site_id, period, period_start, period_end, status, computed_at, generated_by, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mrc_lines | 20261209000243_mrc_core.up.sql | id, company_id, recon_id, item_id, opening, receipts, transfers_in, transfers_out, returns_vendor, issues, site_returns, adjustments, book_closing, physical_closing, count_plan_id, executed_ref, theoretical_base, theoretical, actual, variance, variance_pct, allowed_wastage_pct, wastage_pct, over_allowed, avg_rate, reason_code, explanation, recovery_party_id, recovery_amount, sort_order, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mrc_contributions | 20261209000243_mrc_core.up.sql | id, company_id, recon_id, line_id, contributor_role, note, contributed_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_equipment | 20261209000246_plt_core.up.sql | id, company_id, doc_no, asset_code, class_item_id, make, model, mfg_year, serial_no, chassis_no, engine_no, reg_no, capacity, ownership, owner_partner_id, purchase_value, purchase_date, meter_type, fuel_type, tank_capacity, fuel_norm, fuel_norm_unit, gps_device_id, road_vehicle, lifting, operator_required, operator_licence_class, equip_state, org_project_id, org_site_id, state_since, state_note, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_documents | 20261209000246_plt_core.up.sql | id, company_id, equipment_id, doc_type, doc_number, issuer, valid_from, valid_until, file_id, mandatory, doc_status, superseded_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_timeline | 20261209000246_plt_core.up.sql | id, company_id, equipment_id, event, from_state, to_state, org_project_id, org_site_id, note, done_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_requisitions | 20261209000248_plt_alloc_core.up.sql | id, company_id, doc_no, org_project_id, org_site_id, class_item_id, capacity, qty, from_date, to_date, purpose, activity_id, priority, hire_qty, hire_reason, hire_decided_by, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_allocations | 20261209000248_plt_alloc_core.up.sql | id, company_id, doc_no, equipment_id, org_project_id, org_site_id, requisition_id, alloc_kind, transfer_from_id, transfer_reason, source, from_date, to_date, internal_rate, charge_basis, estimated_amount, phase, vehicle_no, trailer_no, driver_name, gate_pass_id, dispatched_on, dispatch_meter, arrived_on, arrival_meter, arrival_checklist_json, departed_on, departure_meter, demob_note, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_operator_assignments | 20261209000248_plt_alloc_core.up.sql | id, company_id, equipment_id, allocation_id, person_type, person_id, person_name, shift, from_date, to_date, cert_types_json, assign_status, ended_reason, assigned_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_logs | 20261209000250_plt_log_core.up.sql | id, company_id, doc_no, equipment_id, allocation_id, org_project_id, org_site_id, log_date, shift, operator_type, operator_id, operator_name, start_meter, end_meter, working_hrs, idle_hrs, idle_reason, breakdown_hrs, breakdown_id, wa_id, activity_id, wbs_id, cost_code_id, work_qty, work_uom, fuel_litres, fuel_ref, meter_photo_file_id, anomalies_json, anomaly_note, vendor_id, vendor_rep, vendor_signed_at, vendor_signature_file_id, charge_rate, charge_basis, cost_amount, use_recorded, use_note, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_breakdowns | 20261209000250_plt_log_core.up.sql | id, company_id, doc_no, equipment_id, allocation_id, org_project_id, org_site_id, category, description, reported_on, reported_at, reported_by, prior_state, breakdown_status, resolved_on, resolved_by, resolution, job_card_ref, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_fuel_tanks | 20261209000252_plt_fuel_core.up.sql | id, company_id, code, name, tank_type, fuel_type, org_project_id, org_site_id, capacity, opening_litres, opening_date, opening_rate, card_no, tank_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_fuel_receipts | 20261209000252_plt_fuel_core.up.sql | id, company_id, doc_no, tank_id, receipt_date, source, grn_id, vendor_id, bill_no, petty_ref, litres, rate, amount, received_by, receipt_status, cancel_reason, org_project_id, org_site_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_fuel_issues | 20261209000252_plt_fuel_core.up.sql | id, company_id, doc_no, tank_id, equipment_id, allocation_id, org_project_id, org_site_id, issue_at, issue_date, meter_reading, prev_issue_id, prev_meter, no_advance_reason, litres, full_tank, issued_by, received_by, photo_file_id, rate, cost_amount, consumption, norm, deviation_pct, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_fuel_dips | 20261209000252_plt_fuel_core.up.sql | id, company_id, tank_id, dip_date, dip_litres, opening_litres, receipts, issues, book_litres, variance, tolerance, within_tolerance, photo_file_id, recorded_by, note, org_project_id, org_site_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_fuel_anomalies | 20261209000252_plt_fuel_core.up.sql | id, company_id, doc_no, rule_code, severity, equipment_id, tank_id, issue_id, dip_id, log_id, org_project_id, org_site_id, detected_on, details_json, dedupe_key, litres_at_risk, anomaly_status, reason_code, explanation, workflow_instance_id, explained_by, approved_by, approved_at, review_comment, confirmed_by, confirmed_at, confirm_note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_pm_plans | 20261209000254_plt_maint_core.up.sql | id, company_id, code, task, class_item_id, equipment_id, interval_type, interval_value, warn_before, critical, checklist_json, plan_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_pm_status | 20261209000254_plt_maint_core.up.sql | id, company_id, plan_id, equipment_id, last_done_meter, last_done_date, next_due_meter, next_due_date, due_state, last_told_on, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_job_cards | 20261209000254_plt_maint_core.up.sql | id, company_id, doc_no, equipment_id, job_type, pm_status_ids_json, breakdown_id, org_project_id, org_site_id, complaint, diagnosis, work_done, opened_at, started_at, closed_at, downtime_start, downtime_end, downtime_hrs, meter_at_service, mechanic, vendor_id, external_ref, external_cost, labour_hrs, labour_cost, spares_cost, total_cost, warranty, warranty_ref, warranty_status, warranty_amount, prior_state, job_status, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_job_spares | 20261209000254_plt_maint_core.up.sql | id, company_id, job_card_id, item_id, store_id, uom, qty, spare_status, reservation_id, ledger_ids_json, issued_qty, returned_qty, unit_cost, cost, issued_by, issued_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_hire_agreements | 20261209000256_plt_hire_core.up.sql | id, company_id, doc_no, equipment_id, direction, partner_id, org_project_id, org_site_id, charge_basis, hire_rate, min_guarantee, fuel_included, operator_included, idle_rule, breakdown_rule, mob_charge, demob_charge, gst_bp, from_date, to_date, monthly_value, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_hire_bills | 20261209000256_plt_hire_core.up.sql | id, company_id, doc_no, agreement_id, period_from, period_to, working_hrs, idle_hrs, breakdown_hrs, pending_hrs, guarantee_hrs, billable_hrs, dispute_hrs, dispute_reason, hire_amount, mob_amount, fuel_recovery, gst_amount, amount, log_count, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_cost_items | 20261209000258_plt_fleet_core.up.sql | id, company_id, equipment_id, item_type, monthly_amount, from_date, to_date, note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_cost_snapshots | 20261209000258_plt_fleet_core.up.sql | id, company_id, equipment_id, period, owning_cost, operating_cost, fuel_cost, maintenance_cost, hire_cost, operator_cost, hours, km, cost_per_hour, cost_per_km, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_telematics | 20261209000258_plt_fleet_core.up.sql | id, company_id, equipment_id, ts, engine_hours, ignition, fuel_level, source, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| plt_disposal_recs | 20261209000258_plt_fleet_core.up.sql | id, company_id, doc_no, equipment_id, reason, flags_json, age_years, purchase_value, repair_cost, utilisation_bp, est_value, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| rp_demand | 20261209000260_rp_core.up.sql | id, company_id, org_project_id, week_start, resource_type, res_key, label, qty_required, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| rp_supply | 20261209000260_rp_core.up.sql | id, company_id, org_project_id, week_start, resource_type, res_key, label, qty_available, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| rp_plans | 20261209000260_rp_core.up.sql | id, company_id, doc_no, name, plan_date, scenario_json, projects_json, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| rp_requests | 20261209000260_rp_core.up.sql | id, company_id, plan_id, action_no, kind, target_module, resource_type, res_key, qty, from_project_id, to_project_id, from_week, to_week, request_status, ref_doc, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| qa_quality_plans | 20261209000262_qa_core.up.sql | id, company_id, doc_no, org_project_id, org_site_id, title, revision, summary, document_file_id, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| qa_itps | 20261209000262_qa_core.up.sql | id, company_id, code, version_no, title, activity_type, org_project_id, standard_ref, steps_json, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| qa_checklist_templates | 20261209000262_qa_core.up.sql | id, company_id, code, version_no, name, module, sections_json, scoring_json, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| qa_inspections | 20261209000262_qa_core.up.sql | id, company_id, doc_no, template_id, module, org_project_id, org_site_id, location_id, activity_id, wa_id, planned_point_id, itp_step_code, entity_type, entity_id, subject, inspected_by, inspected_at, result, score_bp, signatures_json, defects_json, client_ref, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| qa_inspection_answers | 20261209000262_qa_core.up.sql | id, company_id, inspection_id, question_code, section_code, answer, num_value, text_value, passed, within_tolerance, photo_file_ids, remark, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| qa_planned_points | 20261209000262_qa_core.up.sql | id, company_id, itp_id, org_project_id, activity_id, wbs_id, location_id, step_code, seq_no, point_type, title, point_status, inspection_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| qa_inspection_requests | 20261209000264_qa_requests.up.sql | id, company_id, doc_no, org_project_id, org_site_id, location_id, activity_id, wa_id, planned_point_id, itp_step_code, point_type, description, requested_for, requested_at, consultant_required, inspection_id, reinspection_of_id, result, reason_code, assessment, assessed_by, decided_at, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| qa_test_catalogue | 20261209000266_qa_tests.up.sql | id, company_id, code, name, material_category_id, material_item_id, standard, parameters_json, freq_basis, freq_qty, freq_uom, lab_type, status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| qa_lab_equipment | 20261209000266_qa_tests.up.sql | id, company_id, code, org_project_id, org_site_id, name, make, serial_no, last_calibrated, calibration_due, interval_days, certificate_file_id, status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| qa_test_requests | 20261209000266_qa_tests.up.sql | id, company_id, doc_no, org_project_id, org_site_id, catalogue_id, material_item_id, grn_id, grn_line_id, lot_qty, sample_ref, lab_type, lab_name, requested_on, sampled_on, visual_ok, documents_ok, sampling_decision, certificate_file_id, result, concession_ref, concession_reason, outcome, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| qa_test_results | 20261209000266_qa_tests.up.sql | id, company_id, request_id, parameter_code, parameter_name, unit, passed, equipment_id, tested_on, certificate_file_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| qa_ncrs | 20261209000268_qa_ncr.up.sql | id, company_id, doc_no, org_project_id, org_site_id, origin_kind, origin_id, location_id, activity_id, ncr_type, severity, responsible_type, responsible_id, spec_ref, description, disposition, root_cause_json, rectification_cost, backcharge, backcharge_status, rectified_on, rectified_by, rectification_note, reinspection_kind, reinspection_ref_id, reinspection_verified, concession_status, concession_reason, review_from, review_requested_by, closed_at, closed_by, closure_note, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| qa_capa_actions | 20261209000268_qa_ncr.up.sql | id, company_id, ncr_id, capa_type, description, owner_user, due_date, status, completed_on, completion_note, evidence_file_ids, task_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| qa_pour_cards | 20261209000270_qa_pour.up.sql | id, company_id, doc_no, org_project_id, org_site_id, location_id, activity_id, element, grade, fck_mpa, planned_volume, actual_volume, planned_on, ir_links_json, checks_json, weather, pour_status, pour_start, pour_end, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| qa_pour_tickets | 20261209000270_qa_pour.up.sql | id, company_id, pour_card_id, ticket_no, batch_ref, truck_no, vendor_id, qty, delivered_at, slump_mm, temperature_c, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| qa_cube_samples | 20261209000270_qa_pour.up.sql | id, company_id, doc_no, pour_card_id, ticket_id, cubes_count, cast_date, qr_code, status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| qa_cube_results | 20261209000270_qa_pour.up.sql | id, company_id, sample_id, age_days, strengths_json, tested_on, equipment_id, acceptance, ncr_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| qa_snags | 20261209000272_qa_snags.up.sql | id, company_id, doc_no, org_project_id, org_site_id, location_id, unit_ref, drawing_id, pin_x, pin_y, category, punch_class, priority, description, responsible_type, responsible_id, due_date, raised_kind, inspection_id, before_photos_json, after_photos_json, rectified_by, rectified_on, rectification_note, closed_by, closed_on, reopen_count, backcharge, status, raised_by, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hse_plans | 20261209000275_hse_core.up.sql | id, company_id, doc_no, org_project_id, org_site_id, title, version_no, document_file_id, emergency_json, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hse_hira | 20261209000275_hse_core.up.sql | id, company_id, doc_no, org_project_id, org_site_id, activity_id, activity_type, title, hazards_json, max_score, max_residual, risk_level, version_no, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hse_jsa | 20261209000275_hse_core.up.sql | id, company_id, doc_no, org_project_id, org_site_id, hira_id, wa_id, activity_id, task, method_statement_ref, steps_json, participants_json, jsa_status, prepared_by, valid_on, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hse_induction_content | 20261209000275_hse_core.up.sql | id, company_id, code, org_project_id, org_site_id, title, body, quiz_json, pass_pct, validity_days, content_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hse_inductions | 20261209000275_hse_core.up.sql | id, company_id, doc_no, org_project_id, org_site_id, content_id, person_type, person_id, person_code, person_name, induction_date, conducted_by, quiz_score_pct, passed, valid_until, answers_json, via, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hse_toolbox_topics | 20261209000275_hse_core.up.sql | id, company_id, code, title, body, category, frequency, topic_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hse_toolbox_talks | 20261209000275_hse_core.up.sql | id, company_id, doc_no, org_project_id, org_site_id, talk_date, topic_id, topic_text, conducted_by, attendees_json, attendee_count, photo_file_ids, duration_min, notes, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hse_medical_records | 20261209000275_hse_core.up.sql | id, company_id, worker_id, fitness, examined_on, valid_until, recorded_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hse_permit_types | 20261209000277_hse_permits.up.sql | id, company_id, code, name, name_hi, risk_class, required_certs_json, checklist_template_id, requires_gas_test, gases_json, requires_isolation, max_hours, conflicts_json, ppe_json, type_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hse_permits | 20261209000277_hse_permits.up.sql | id, company_id, doc_no, org_project_id, org_site_id, type_id, risk_class, location_id, wa_id, jsa_id, checklist_inspection_id, title, work_description, supervisor, valid_from, valid_to, extension_count, workers_json, ppe_json, emergency_text, gas_tests_json, isolations_json, permit_status, activated_at, suspended_at, suspended_reason, expired_at, closed_at, closed_by, handback_json, hold_reason, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hse_incidents | 20261209000279_hse_incidents.up.sql | id, company_id, doc_no, org_project_id, org_site_id, incident_type, classification, severity, occurred_at, location_id, location_text, description, persons_json, immediate_action, photo_file_ids, lost_days, return_to_work_on, investigation_json, statutory_json, insurance_json, lessons_title, lessons_text, lessons_shared_at, serious_alerted, permits_suspended, reported_by, incident_status, closed_at, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hse_incident_actions | 20261209000279_hse_incidents.up.sql | id, company_id, incident_id, action_type, action, owner_user, due_date, done_on, done_note, evidence_file_id, action_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hse_inspection_schedules | 20261209000281_hse_safety_ops.up.sql | id, company_id, code, title, register_type, org_project_id, org_site_id, template_id, frequency_days, next_due, last_done_on, last_inspection_id, last_result, schedule_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hse_observations | 20261209000281_hse_safety_ops.up.sql | id, company_id, doc_no, org_project_id, org_site_id, obs_type, description, location_id, location_text, photo_file_ids, responsible_type, responsible_id, severity, immediate_action, action_required, due_at, schedule_id, inspection_id, observed_by, obs_status, action_done_by, action_done_on, action_note, closed_by, closed_on, escalation_level, escalated_at, penalty_amount, penalty_reason, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hse_ppe_items | 20261209000281_hse_safety_ops.up.sql | id, company_id, code, name, name_hi, item_id, replace_days, ppe_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hse_ppe_issues | 20261209000281_hse_safety_ops.up.sql | id, company_id, doc_no, org_project_id, org_site_id, ppe_item_id, person_type, person_id, person_code, person_name, issue_date, qty, replace_due, acknowledged_at, via, issue_ref, replaces_id, returned_on, return_condition, issued_by, issue_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hse_equipment_register | 20261209000281_hse_safety_ops.up.sql | id, company_id, org_project_id, org_site_id, equip_type, tag, location_id, location_text, capacity, expiry_date, last_inspected_on, last_inspection_id, alerted_state, eq_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hse_contractor_scores | 20261209000281_hse_safety_ops.up.sql | id, company_id, partner_id, period, workers, induction_bp, ppe_bp, violations, incidents, score, band, computed_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| esg_readings | 20261209000283_esg_core.up.sql | id, company_id, org_project_id, org_site_id, metric, period, reading_date, value_milli, uom, limit_milli, breach, origin, entered_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| esg_waste | 20261209000283_esg_core.up.sql | id, company_id, org_project_id, org_site_id, waste_date, category, qty_milli, disposal_method, vendor_id, manifest_no, manifest_file_id, entered_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| esg_emission_factors | 20261209000283_esg_core.up.sql | id, company_id, metric, scope_no, factor_milli, unit, factor_source, effective_from, version_no, factor_status, entered_by, activated_by, activated_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| esg_permits | 20261209000283_esg_core.up.sql | id, company_id, org_project_id, org_site_id, permit_type, permit_no, authority, valid_from, valid_until, file_id, alerted_state, consent_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| scy_posts | 20261209000285_scy_core.up.sql | id, company_id, org_project_id, org_site_id, code, name, post_type, required_guards, agency_id, post_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| scy_checkpoints | 20261209000285_scy_core.up.sql | id, company_id, org_site_id, post_id, code, name, qr_token, lat, lng, interval_min, active_from, active_to, last_alert_slot, cp_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| scy_patrol_scans | 20261209000285_scy_core.up.sql | id, company_id, checkpoint_id, org_site_id, guard_id, scanned_at, lat, lng, distance_m, off_site, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| scy_rosters | 20261209000285_scy_core.up.sql | id, company_id, doc_no, org_project_id, org_site_id, period, assignments_json, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| scy_visitors | 20261209000285_scy_core.up.sql | id, company_id, doc_no, org_project_id, org_site_id, visitor_name, phone, organisation, id_type, id_ref_masked, host_user, purpose, expected_on, vehicle_no, photo_file_id, badge_token, pre_registered, safety_briefed, decided_by, decided_at, decline_reason, check_in, check_out, checked_in_by, overstay_alerted, visit_status, status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| scy_incidents | 20261209000285_scy_core.up.sql | id, company_id, doc_no, org_project_id, org_site_id, post_id, incident_type, occurred_at, description, action_taken, investigation, loss_estimate, reported_by, photo_file_ids, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| scy_handovers | 20261209000285_scy_core.up.sql | id, company_id, org_site_id, post_id, shift_date, shift, from_guard_id, to_guard_id, notes, items_json, acknowledged_by, acknowledged_at, logged_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| camp_camps | 20261209000287_camp_core.up.sql | id, company_id, org_project_id, org_site_id, code, name, location_id, amenities_json, in_charge, camp_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| camp_rooms | 20261209000287_camp_core.up.sql | id, company_id, camp_id, block, room_no, beds, room_type, room_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| camp_allocations | 20261209000287_camp_core.up.sql | id, company_id, doc_no, camp_id, room_id, bed_no, person_type, person_id, person_code, person_name, contractor_id, from_date, check_in, check_out, alloc_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| camp_meals | 20261209000287_camp_core.up.sql | id, company_id, camp_id, contractor_id, meal_date, meal, planned_count, served_count, rate_paise, recovered, entered_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| camp_inspections | 20261209000287_camp_core.up.sql | id, company_id, camp_id, area, inspection_id, inspected_on, result, observation_id, inspected_by, findings, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| camp_assets | 20261209000287_camp_core.up.sql | id, company_id, camp_id, asset_name, category, qty, asset_condition, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| camp_recoveries | 20261209000287_camp_core.up.sql | id, company_id, doc_no, camp_id, org_project_id, org_site_id, contractor_id, period, meals_served, mess_paise, bed_days, rent_paise, total_paise, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bp_plants | 20261209000290_rmc_core.up.sql | id, company_id, doc_no, code, name, org_project_id, org_site_id, location_id, equipment_id, make_model, ownership, cc_code, head_code, project_ids_json, crew_json, plant_status, version_no, root_id, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bp_silos | 20261209000290_rmc_core.up.sql | id, company_id, plant_id, code, item_id, kind, capacity_milli, current_level_milli, uom, silo_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bp_scales | 20261209000290_rmc_core.up.sql | id, company_id, plant_id, code, scale_type, capacity_milli, calibrated_on, calibration_due, certificate_ref, scale_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bp_mix_designs | 20261209000290_rmc_core.up.sql | id, company_id, doc_no, code, plant_id, org_project_id, org_site_id, grade, version_no, proportions_json, binder_milli, wc_ratio_milli, volume_ppm, slump_mm, trial_results_json, effective_from, effective_to, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bp_requisitions | 20261209000292_rmc_production.up.sql | id, company_id, doc_no, org_project_id, org_site_id, pour_card_id, location_id, location_text, grade, qty_milli, required_at, pump_required, slump_mm, plant_id, mix_design_id, supplier_id, slot_from, slot_to, scheduled_by, scheduled_at, prod_status, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bp_batches | 20261209000292_rmc_production.up.sql | id, company_id, doc_no, batch_ref, plant_id, org_project_id, org_site_id, requisition_id, mix_design_id, grade, batch_time, qty_milli, actual_weights_json, theoretical_json, max_variance_bp, variance_flag, origin, batch_status, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bp_delivery_tickets | 20261209000292_rmc_production.up.sql | id, company_id, doc_no, ticket_no, qr_code, requisition_id, plant_id, supplier_id, batch_id, mix_design_id, org_project_id, org_site_id, grade, qty_milli, truck_no, driver, driver_phone, batched_at, departed_at, arrived_at, unload_start, unload_end, slump_mm, temperature_c, slump_flag, received_by, returned_milli, wasted_milli, return_reason, outside_premises, eway_no, ticket_state, pour_ticket_id, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bp_silo_moves | 20261209000292_rmc_production.up.sql | id, company_id, silo_id, batch_id, delta_milli, level_after_milli, reason, moved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bp_cost_periods | 20261209000294_rmc_costing.up.sql | id, company_id, doc_no, plant_id, org_project_id, org_site_id, period, material_paise, power_paise, fuel_paise, labour_paise, maintenance_paise, depreciation_paise, overhead_paise, total_paise, volume_milli, produced_milli, wasted_milli, revenue_paise, period_status, collected_at, closed_by, closed_at, reopen_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bp_cost_lines | 20261209000294_rmc_costing.up.sql | id, company_id, period_id, category, grade, amount_paise, line_origin, basis, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bp_cost_grades | 20261209000294_rmc_costing.up.sql | id, company_id, period_id, grade, volume_milli, material_paise, conversion_paise, total_paise, rate_paise, revenue_paise, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bp_transfer_rates | 20261209000294_rmc_costing.up.sql | id, company_id, doc_no, plant_id, org_project_id, org_site_id, grade, rate_paise, effective_from, previous_paise, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bp_charges | 20261209000294_rmc_costing.up.sql | id, company_id, period_id, plant_id, org_project_id, grade, volume_milli, rate_paise, amount_paise, cost_alloc_paise, variance_paise, posted_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bp_budgets | 20261209000294_rmc_costing.up.sql | id, company_id, plant_id, period, category, amount_paise, volume_milli, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_contracts | 20261209000296_ctr_core.up.sql | id, company_id, doc_no, contract_no, org_project_id, org_site_id, client_partner_id, baseline_pack_id, title, loa_no, loa_date, agreement_no, agreement_date, contract_type, original_paise, amended_paise, variation_paise, pending_var_paise, revised_paise, scope_summary, start_date, completion_date, revised_completion, dlp_months, payment_terms_json, retention_bp, retention_cap_bp, advance_terms_json, pvc_applicable, pvc_ref, ld_rate_bp, ld_basis, ld_cap_bp, bonus_clause, insurance_json, security_json, dispute_resolution, version_no, contract_state, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_clauses | 20261209000296_ctr_core.up.sql | id, company_id, contract_id, clause_no, title, category, summary, text_ref, time_bar_days, tags, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_obligations | 20261209000296_ctr_core.up.sql | id, company_id, contract_id, clause_id, description, party, owner_user, due_date, recurrence, remind_days, obligation_status, done_on, done_by, done_note, previous_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_milestones | 20261209000296_ctr_core.up.sql | id, company_id, contract_id, code, name, due_date, payment_linked, amount_paise, milestone_status, achieved_on, achieved_by, evidence, sort_order, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_amendments | 20261209000296_ctr_core.up.sql | id, company_id, doc_no, contract_id, org_project_id, org_site_id, amendment_no, kind, description, reference_no, signed_date, value_change_paise, new_completion, terms_json, applied_at, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_value_log | 20261209000296_ctr_core.up.sql | id, company_id, contract_id, entry_kind, ref_type, ref_id, ref_no, description, amount_paise, entry_status, revised_after_paise, entered_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_bank_guarantees | 20261209000298_ctr_securities.up.sql | id, company_id, doc_no, bg_no, direction, bg_type, org_project_id, org_site_id, contract_id, partner_id, advance_id, bank_id, bank_name, original_paise, current_paise, issue_date, expiry_date, claim_expiry, linked_type, linked_id, linked_ref, margin_bp, commission_bp, commission_paise, bg_state, released_on, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_bg_events | 20261209000298_ctr_securities.up.sql | id, company_id, bg_id, event_kind, event_status, amount_before_paise, amount_after_paise, expiry_before, expiry_after, reference_no, reason, requested_by, decided_by, decided_at, decision_note, commission_paise, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_advances | 20261209000298_ctr_securities.up.sql | id, company_id, contract_id, org_project_id, partner_id, advance_kind, ref_no, advance_paise, recovered_paise, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_insurances | 20261209000298_ctr_securities.up.sql | id, company_id, doc_no, org_project_id, org_site_id, contract_id, policy_type, policy_no, insurer, sum_insured_paise, premium_paise, valid_from, valid_to, coverage, renewal_of_id, ins_state, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_insurance_claims | 20261209000298_ctr_securities.up.sql | id, company_id, policy_id, claim_no, incident_ref, incident_date, description, claimed_paise, settled_paise, claim_status, settled_on, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_bank_limits | 20261209000298_ctr_securities.up.sql | id, company_id, bank_name, limit_kind, limit_paise, valid_to, margin_bp, limit_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_work_orders | 20261209000300_ctr_work_orders.up.sql | id, company_id, doc_no, wo_no, wo_type, org_project_id, org_site_id, contract_id, subcontractor_id, work_package_id, cs_id, selection_kind, justification, title, scope_text, start_date, end_date, value_paise, retention_bp, sd_bp, advance_bp, advance_recovery_bp, tds_section, gst_mode, gst_bp, payment_days, ld_bp, ld_cap_bp, safety_penalty_paise, terms_json, negative_margin, over_budget, amendment_no, wo_state, accepted_by, accepted_at, acceptance_ref, closed_on, final_bill_ref, close_note, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_wo_items | 20261209000300_ctr_work_orders.up.sql | id, company_id, wo_id, line_no, item_kind, boq_line_id, description, uom, qty_th, amount_paise, wbs_id, client_boq_line_id, due_date, executed_qty_th, billed_qty_th, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_wo_free_issue | 20261209000300_ctr_work_orders.up.sql | id, company_id, wo_id, item_id, uom, norm_th, wastage_bp, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_wo_amendments | 20261209000300_ctr_work_orders.up.sql | id, company_id, doc_no, wo_id, org_project_id, org_site_id, amendment_no, description, changes_json, new_end_date, delta_paise, negative_margin, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_sub_compliance | 20261209000302_ctr_subcontractor_workspace.up.sql | id, company_id, doc_no, subcontractor_id, org_project_id, org_site_id, period, due_date, items_json, comp_state, missing_mandatory, score_bp, compiled_by, compiled_at, verified_by, verified_at, verify_note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_sub_waivers | 20261209000302_ctr_subcontractor_workspace.up.sql | id, company_id, doc_no, compliance_id, subcontractor_id, org_project_id, org_site_id, items_json, reason, valid_until, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_sub_manpower | 20261209000302_ctr_subcontractor_workspace.up.sql | id, company_id, subcontractor_id, org_project_id, trade_code, committed, from_date, to_date, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_sub_holds | 20261209000302_ctr_subcontractor_workspace.up.sql | id, company_id, subcontractor_id, org_project_id, hold, reasons_json, since, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_sub_ratings | 20261209000302_ctr_subcontractor_workspace.up.sql | id, company_id, subcontractor_id, org_project_id, period, progress_score, quality_score, safety_score, compliance_score, total, band, weights_json, details_json, computed_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_change_requests | 20261209000304_ctr_variations.up.sql | id, company_id, doc_no, cr_no, kind, org_project_id, org_site_id, contract_id, work_order_id, origin_type, origin_ref, origin_id, title, description, technical_review, technical_by, technical_at, qs_json, value_claimed_paise, time_claimed_days, cr_state, client_ref, to_client_on, response_on, response_note, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_variation_orders | 20261209000304_ctr_variations.up.sql | id, company_id, doc_no, vo_no, kind, org_project_id, org_site_id, contract_id, work_order_id, cr_id, client_ref, title, value_approved_paise, time_approved_days, approved_on, vo_state, boq_version_id, outputs_json, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_vo_items | 20261209000304_ctr_variations.up.sql | id, company_id, vo_id, line_no, boq_line_id, wo_line_no, description, uom, qty_change_th, amount_paise, basis_kind, basis_ref, analysis_id, wbs_id, cost_code_id, is_extra, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_claims | 20261209000306_ctr_claims.up.sql | id, company_id, doc_no, claim_no, claim_type, org_project_id, org_site_id, contract_id, title, event_date, clause_refs, entitlement, time_bar_days, time_bar_date, notice_letter_id, notice_date, bar_status, delay_id, eot_claimed_days, amount_claimed_paise, eot_granted_days, amount_awarded_paise, submission_no, claim_state, determined_on, determination_note, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_claim_events | 20261209000306_ctr_claims.up.sql | id, company_id, org_project_id, contract_id, claim_id, event_kind, event_date, description, ref_entity, ref_id, ref_label, time_bar_date, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_claim_quantum | 20261209000306_ctr_claims.up.sql | id, company_id, claim_id, line_no, head, basis, calculation_json, amount_paise, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_claim_evidence | 20261209000306_ctr_claims.up.sql | id, company_id, claim_id, entity, entity_id, label, snapshot_json, snapshot_hash, snapshot_file_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_claim_log | 20261209000306_ctr_claims.up.sql | id, company_id, claim_id, seq, log_kind, on_date, eot_days, amount_paise, reference_no, note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_eot_awards | 20261209000306_ctr_claims.up.sql | id, company_id, claim_id, contract_id, days, completion_before, completion_after, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_disputes | 20261209000306_ctr_claims.up.sql | id, company_id, doc_no, dispute_no, org_project_id, org_site_id, claim_id, contract_id, title, forum, stage, amount_in_dispute_paise, next_hearing, counsel, cost_to_date_paise, dispute_state, outcome, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_dispute_log | 20261209000306_ctr_claims.up.sql | id, company_id, dispute_id, log_kind, on_date, amount_paise, note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_pvc_formulas | 20261209000308_ctr_pvc_ld.up.sql | id, company_id, kind, contract_id, work_order_id, org_project_id, version_no, base_month, components_json, exclusions_json, threshold_bp, cap_bp, fixed_bp, formula_status, clause_ref, change_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_pvc_index_refs | 20261209000308_ctr_pvc_ld.up.sql | id, company_id, index_code, period, document_ref, notified_on, document_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_escalation_calcs | 20261209000308_ctr_pvc_ld.up.sql | id, company_id, doc_no, kind, contract_id, work_order_id, formula_id, org_project_id, org_site_id, bill_ref, period, r_value_paise, excluded_paise, exclusions_json, eligible_paise, components_json, trace_json, net_bp, amount_paise, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ctr_ld_assessments | 20261209000308_ctr_pvc_ld.up.sql | id, company_id, contract_id, org_project_id, as_of, completion_date, eot_days, effective_date, forecast_date, delay_days, ld_rate_bp, ld_basis, base_value_paise, gross_paise, cap_paise, ld_paise, capped, deducted_paise, deductions_json, note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bill_mb_entries | 20261209000310_bill_mb_entries.up.sql | id, company_id, doc_no, org_project_id, org_site_id, boq_line_id, location_id, wa_id, activity_id, ir_id, dpr_work_id, drawing_id, drawing_ref, description, template, nos_th, length_th, breadth_th, depth_th, deduction_th, qty_th, uom, measured_by, measured_on, client_check_required, check_status, checked_qty_th, check_pct_bp, check_diff_th, checked_by, checker_name, checker_org, checked_on, signature_ref, check_note, certified_qty_th, certified_on, bill_period, mb_book, mb_page, mb_line, bill_ref, eligibility_json, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bill_deviation_statements | 20261209000312_bill_deviation_extra.up.sql | id, company_id, doc_no, ds_no, org_project_id, org_site_id, contract_id, period, threshold_bp, items_json, item_count, over_count, under_count, net_effect_paise, notes, client_state, sent_on, client_ref, responded_on, outcome, cr_id, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bill_qty_forecasts | 20261209000312_bill_deviation_extra.up.sql | id, company_id, org_project_id, item_code, boq_line_id, forecast_qty_th, basis, updated_on, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bill_extra_items | 20261209000312_bill_deviation_extra.up.sql | id, company_id, doc_no, org_project_id, org_site_id, kind, description, uom, provisional_qty_th, substitutes_boq_line_id, reason, instruction_ref, ds_id, cr_id, decision_state, decided_by, decided_on, decision_ref, decision_note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bill_client_bills | 20261209000314_bill_client_bills.up.sql | id, company_id, doc_no, bill_no, org_project_id, org_site_id, contract_id, bill_type, seq_no, period_from, period_to, prev_bill_id, supply, gst_pct_bp, prev_gross_paise, gross_paise, cum_gross_paise, escalation_paise, escalation_calc_id, taxable_paise, gst_json, gst_paise, manual_json, ld_input_paise, deductions_json, deductions_paise, net_paise, issues_json, mb_ids_json, client_state, sent_on, client_ref, notes, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bill_client_bill_items | 20261209000314_bill_client_bills.up.sql | id, company_id, bill_id, line_no, item_kind, boq_line_id, milestone_id, item_code, description, uom, vo_no, prev_qty_th, this_qty_th, cum_qty_th, certified_cum_th, prev_amount_paise, this_amount_paise, cum_amount_paise, mb_ids_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bill_certifications | 20261209000316_bill_certifications_invoices.up.sql | id, company_id, doc_no, cert_no, org_project_id, org_site_id, contract_id, bill_id, cert_date, submitted_gross_paise, submitted_net_paise, certified_gross_paise, certified_escalation_paise, certified_taxable_paise, certified_gst_paise, certified_gst_json, certified_deductions_json, certified_deductions_paise, certified_net_paise, diff_gross_paise, diff_net_paise, diff_pct_bp, big_diff, items_json, disputed_paise, due_date, file_ref, notes, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bill_tax_invoices | 20261209000316_bill_certifications_invoices.up.sql | id, company_id, doc_no, invoice_no, invoice_date, fy, seq_no, org_project_id, org_site_id, contract_id, bill_id, certification_id, gstin_from, gstin_to, place_state, supply, sac_code, description, taxable_paise, gst_pct_bp, cgst_paise, sgst_paise, igst_paise, total_paise, due_date, irn_state, irn, ack_no, ack_date, ar_state, ar_ref, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bill_invoice_counters | 20261209000316_bill_certifications_invoices.up.sql | id, company_id, gstin, fy, last_seq, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bill_sub_measurements | 20261209000318_bill_sub_bills.up.sql | id, company_id, doc_no, org_project_id, org_site_id, wo_id, subcontractor_id, wo_item_id, location_id, description, template, nos_th, length_th, breadth_th, depth_th, deduction_th, qty_th, measured_by, measured_on, sub_signer, sub_signed_on, signature_ref, sign_method, verified_by, verified_on, bill_id, meas_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bill_sub_bills | 20261209000318_bill_sub_bills.up.sql | id, company_id, doc_no, bill_no, org_project_id, org_site_id, wo_id, subcontractor_id, bill_type, seq_no, period_from, period_to, prev_bill_id, prev_gross_paise, gross_paise, cum_gross_paise, gst_mode, gst_pct_bp, gst_paise, rcm_paise, tds_paise, manual_json, deductions_json, deductions_paise, net_paise, issues_json, meas_ids_json, compliance_ok, compliance_json, payable_state, payable_ref, notes, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bill_sub_bill_items | 20261209000318_bill_sub_bills.up.sql | id, company_id, bill_id, line_no, wo_item_id, wo_line_no, item_kind, description, uom, prev_qty_th, this_qty_th, cum_qty_th, measured_cum_th, client_cert_th, prev_amount_paise, this_amount_paise, cum_amount_paise, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bill_sub_claims | 20261209000318_bill_sub_bills.up.sql | id, company_id, bill_id, source_kind, source_ref, amount_paise, active, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bill_vendor_invoices | 20261209000320_bill_vendor_invoices.up.sql | id, company_id, doc_no, org_project_id, org_site_id, vendor_id, invoice_kind, po_id, so_id, service_entry_id, hire_bill_id, vendor_gstin, invoice_no, invoice_date, fy, source, taxable_paise, tax_paise, total_paise, declared_total_paise, debit_paise, payable_paise, irn, irn_checked, due_date, match_status, exceptions_json, override_reason, resolution_json, blocked, price_exception, variance_paise, matched_at, ap_state, ap_ref, notes, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bill_vendor_invoice_lines | 20261209000320_bill_vendor_invoices.up.sql | id, company_id, invoice_id, line_no, po_line_id, item_id, description, uom, hsn, qty_th, rate_paise, gst_pct_bp, taxable_paise, tax_paise, amount_paise, grn_qty_th, invoiced_before_th, po_rate_paise, match_result, match_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bill_retention_ledger | 20261209000322_bill_ledgers.up.sql | id, company_id, org_project_id, party_type, kind, contract_id, wo_id, party_id, txn_type, txn_source, txn_source_id, bill_ref, amount_paise, txn_date, balance_paise, release_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bill_advances | 20261209000322_bill_ledgers.up.sql | id, company_id, doc_no, ref_no, org_project_id, org_site_id, direction, party_type, party_id, contract_id, wo_id, po_id, adv_type, amount_paise, advance_date, rule_mode, rule_pct_bp, rule_fixed_paise, interest_bp, recovered_paise, interest_paise, bg_id, adv_state, notes, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bill_advance_recoveries | 20261209000322_bill_ledgers.up.sql | id, company_id, advance_id, rec_source, rec_source_id, bill_ref, rec_date, principal_paise, interest_paise, outstanding_paise, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bill_releases | 20261209000322_bill_ledgers.up.sql | id, company_id, doc_no, org_project_id, org_site_id, release_type, party_type, party_id, contract_id, wo_id, release_basis, amount_paise, balance_before_paise, bg_id, checklist_json, waiver_reason, expected_date, released_on, notes, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| bill_cvr_reports | 20261209000325_bill_cvr_reports.up.sql | id, company_id, doc_no, org_project_id, org_site_id, period, as_of, value_lines_json, expense_lines_json, assessments_json, value_paise, cost_paise, margin_paise, margin_bp, budget_margin_bp, prev_margin_bp, prev_report_id, forecast_value_paise, forecast_cost_paise, forecast_margin_bp, commentary_qs, commentary_pm, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_navigation_labels | 20261209000328_field_p16603.up.sql | id, company_id, nav_code, lang, label, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_field_tile_rules | 20261209000328_field_p16603.up.sql | id, company_id, tile_code, role_codes, feature_flag, retired_flag, tone, label_te, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ui_bottom_bar | 20261209000328_field_p16603.up.sql | id, company_id, role_code, slot, item, nav_code, label, label_hi, label_te, icon, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_gates | 20261212000331_hr_p0714.up.sql | id, company_id, code, name, status, catalogue_version, workflow_instance_id, submitted_by, submitted_at, passed_at, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_gate_criteria | 20261212000331_hr_p0714.up.sql | id, company_id, gate_id, code, title, part_id, kind, status, note, reviewed_by, reviewed_at, extra_evidence_json, sort_order, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_tds_forms | 20261214000333_mdm_p16608.up.sql | id, company_id, purpose, form_code, act_code, replaces, legal_ref, description, effective_from, effective_to, row_status, change_request_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_statutory_calendar | 20261214000333_mdm_p16608.up.sql | id, company_id, code, obligation, purpose, period_kind, period_no, due_months_after, due_day, alert_days, owner_role, legal_ref, effective_from, effective_to, row_status, change_request_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_labour_rules | 20261214000333_mdm_p16608.up.sql | id, company_id, state_code, code_kind, rule_ref, notified_on, effective_from, effective_to, row_status, change_request_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| mdm_pay_components | 20261214000333_mdm_p16608.up.sql | id, company_id, code, name, wage_class, legal_ref, effective_from, effective_to, row_status, change_request_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| hr_employee_pay | 20261214000333_mdm_p16608.up.sql | id, company_id, employee_id, component_code, monthly_paise, effective_from, effective_to, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_journals | 20261215000334_fin_gl.up.sql | id, company_id, doc_no, voucher_type, voucher_no, voucher_date, fy_id, period_id, kind, narration, total_paise, status, auto_reverse_on, reversal_of_id, reversed_by_id, recurring_id, posted_at, posted_by, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_journal_lines | 20261215000334_fin_gl.up.sql | id, company_id, journal_id, line_no, account_id, debit_paise, credit_paise, branch_id, wbs_id, cost_centre_id, profit_centre_id, department_id, cost_code_id, partner_id, employee_id, equipment_id, narration, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_balances | 20261215000334_fin_gl.up.sql | id, company_id, account_id, period_id, dimension_hash, branch_id, cost_centre_id, debit_paise, credit_paise, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_recurring_journals | 20261215000334_fin_gl.up.sql | id, company_id, doc_no, name, voucher_type, frequency, day_of_month, next_run_on, end_on, narration, lines_json, total_paise, rec_status, runs, last_run_on, owner_user, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_posting_rules | 20261216000336_fin_posting.up.sql | id, company_id, doc_no, rule_code, event_type, name, action, reverses_event, priority, condition_json, lines_json, narration_template, voucher_type, rule_version, effective_from, status, change_reason, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_replay_runs | 20261216000336_fin_posting.up.sql | id, company_id, doc_no, event_types_json, from_date, to_date, dry_run_json, dry_run_hash, result_json, committed_at, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_posting_log | 20261216000336_fin_posting.up.sql | id, company_id, event_id, outbox_id, event_type, event_date, doc_type, doc_id, doc_ref, rule_id, journal_id, log_status, error_code, error, attempts, amount_paise, payload_json, posted_at, resolved_by, resolved_at, resolution_note, replay_run_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ap_bills | 20261217000338_ap_payables.up.sql | id, company_id, doc_no, bill_source, source_ref, org_project_id, org_site_id, partner_id, employee_id, payee_name, bill_no, bill_date, due_date, msme, msme_due_date, description, expense_account_id, gross_paise, gst_input_paise, total_paise, tds_nature, tds_section, tds_act, tds_rate, tds_base_paise, tds_paise, tds_payment_code, tds_certificate, tds_basis, ldc_no, net_payable_paise, adjusted_paise, paid_paise, hold_reason, hold_by, hold_at, journal_id, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ap_debit_notes | 20261217000338_ap_payables.up.sql | id, company_id, doc_no, note_kind, partner_id, org_project_id, reference_type, reference_id, bill_id, reason, note_date, vendor_note_no, description, amount_paise, gst_paise, total_paise, credit_account_id, journal_id, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ap_bill_adjustments | 20261217000338_ap_payables.up.sql | id, company_id, bill_id, adj_kind, ref_id, amount_paise, adjusted_on, journal_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_bank_accounts | 20261218000340_pmt_payments.up.sql | id, company_id, code, name, bank_name, ifsc, account_no_enc, gl_account_id, file_format, file_template_json, cheque_next_no, cheque_last_no, acct_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pmt_proposals | 20261218000340_pmt_payments.up.sql | id, company_id, doc_no, bank_account_id, pay_mode, pay_date, purpose, total_paise, lines_count, run_status, released_by, released_at, file_name, file_hash, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pmt_proposal_lines | 20261218000340_pmt_payments.up.sql | id, company_id, proposal_id, line_no, line_kind, ap_bill_id, advance_id, partner_id, payee_name, partner_bank_id, bank_ifsc, bank_account_name, name_match, amount_paise, tds_paise, purpose, line_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pmt_payments | 20261218000340_pmt_payments.up.sql | id, company_id, doc_no, proposal_id, line_id, partner_id, payee_name, pay_mode, bank_account_id, amount_paise, utr, cheque_no, released_on, paid_on, pay_status, failure_reason, journal_id, advice_at, advice_status, advice_message_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ar_invoices | 20261219000342_ar_receivables.up.sql | id, company_id, doc_no, inv_source, source_ref, org_project_id, partner_id, contract_id, income_kind, income_account_id, description, invoice_no, invoice_date, due_date, taxable_paise, gst_paise, amount_paise, received_paise, credited_paise, written_off_paise, interest_bp, promised_date, last_followup_at, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, journal_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ar_receipts | 20261219000342_ar_receivables.up.sql | id, company_id, doc_no, partner_id, receipt_date, bank_account_id, reference, amount_paise, tds_paise, gst_tds_paise, retention_paise, other_ded_paise, other_ded_json, allocated_paise, unallocated_paise, tds_section, tds_quarter, org_project_id, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, journal_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ar_allocations | 20261219000342_ar_receivables.up.sql | id, company_id, receipt_id, invoice_id, amount_paise, allocated_on, alloc_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ar_credit_notes | 20261219000342_ar_receivables.up.sql | id, company_id, doc_no, invoice_id, partner_id, org_project_id, reason, note_date, description, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, irn_required, irn_due_date, irn, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, journal_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ar_writeoffs | 20261219000342_ar_receivables.up.sql | id, company_id, doc_no, invoice_id, partner_id, org_project_id, amount_paise, reason, writeoff_date, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, journal_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ar_followups | 20261219000342_ar_receivables.up.sql | id, company_id, invoice_id, partner_id, org_project_id, followup_date, action, notes, contact_person, promised_date, promised_paise, next_date, by_user, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_bank_account_profiles | 20261220000344_fin_cash_bank.up.sql | id, company_id, bank_account_id, account_kind, scope_kind, branch_id, org_project_id, escrow_purpose, od_limit_paise, opening_date, opening_paise, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_bank_statement_imports | 20261220000344_fin_cash_bank.up.sql | id, company_id, doc_no, bank_account_id, file_name, file_format, from_date, to_date, opening_paise, closing_paise, lines_count, duplicates_count, matched_count, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_bank_statements | 20261220000344_fin_cash_bank.up.sql | id, company_id, import_id, bank_account_id, line_no, txn_date, value_date, description, ref, cheque_no, debit_paise, credit_paise, balance_paise, line_hash, match_status, matched_entity, matched_id, match_rule, matched_by, matched_at, journal_id, ignore_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_bank_recons | 20261220000344_fin_cash_bank.up.sql | id, company_id, bank_account_id, as_of, book_paise, bank_paise, unpresented_paise, uncredited_paise, bank_only_dr_paise, bank_only_cr_paise, difference_paise, signed_by, signed_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_imprests | 20261220000344_fin_cash_bank.up.sql | id, company_id, doc_no, name, imprest_kind, org_project_id, org_site_id, custodian, gl_account_id, limit_paise, balance_paise, imprest_status, last_count_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_imprest_replenishments | 20261220000344_fin_cash_bank.up.sql | id, company_id, doc_no, imprest_id, org_project_id, org_site_id, bank_account_id, vouchers_json, vouchers_count, amount_paise, paid_on, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, journal_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_imprest_vouchers | 20261220000344_fin_cash_bank.up.sql | id, company_id, doc_no, imprest_id, voucher_date, payee, category, description, amount_paise, gst_paise, total_paise, expense_account_id, cost_code_id, wbs_id, org_project_id, org_site_id, replenishment_id, client_ref, lat, lng, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, journal_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_cash_counts | 20261220000344_fin_cash_bank.up.sql | id, company_id, imprest_id, count_date, denominations_json, counted_paise, book_paise, difference_paise, counted_by, witness, note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fin_contras | 20261220000344_fin_cash_bank.up.sql | id, company_id, doc_no, contra_kind, contra_date, from_bank_id, from_imprest_id, to_bank_id, to_imprest_id, amount_paise, reference, purpose, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, journal_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| gst_settings | 20261221000346_fin_gst.up.sql | id, company_id, doc_no, effective_from, aato_paise, einvoice_enabled, einvoice_threshold_paise, irn_window_aato_paise, irn_window_days, irn_alert_days_json, irn_cancel_hours, eway_enabled, eway_threshold_paise, eway_max_doc_age_days, eway_ext_cap_days, eway_km_per_day, eway_odc_km_per_day, eway_ext_window_hours, eway_cancel_hours, eway_alert_hours, gsp_connector_code, gsp_mode, change_note, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| gst_gstin_checks | 20261221000346_fin_gst.up.sql | id, company_id, gstin, format_ok, problem, api_status, legal_name, trade_name, state_code, checked_at, check_source, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| gst_einvoices | 20261221000346_fin_gst.up.sql | id, company_id, doc_no, document_type, document_id, irp_doc_type, document_no, document_date, fy, seller_gstin, buyer_gstin, supply_type, reverse_charge, taxable_paise, tax_paise, total_paise, request_json, irn, ack_no, ack_date, signed_qr, einv_status, error_code, error, attempts, next_retry_at, due_by, gsp_mode, cancel_reason_code, cancel_remark, cancelled_at, cancelled_by, org_project_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| gst_ewaybills | 20261221000346_fin_gst.up.sql | id, company_id, doc_no, document_type, document_id, document_no, document_date, ewb_doc_type, sub_type, from_gstin, to_gstin, from_state, to_state, from_pin, to_pin, distance_km, hsn_code, value_paise, tax_paise, transport_mode, vehicle_type, vehicle_no, transporter_id, transporter_doc, request_json, ewb_no, ewb_date, valid_until, extensions_count, ewb_status, error_code, error, attempts, alerted_at, history_json, gsp_mode, cancel_reason_code, cancel_remark, cancelled_at, org_project_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| gst_compliance_log | 20261221000346_fin_gst.up.sql | id, company_id, document_type, document_id, ref_kind, ref_id, action, gsp_mode, outcome, request_json, response_json, error, correlation_id, actor, integration_log_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| gst_2b_imports | 20261222000348_fin_gst_recon.up.sql | id, company_id, doc_no, period, gstin, file_name, file_format, lines_count, duplicates_count, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| gst_2b_lines | 20261222000348_fin_gst_recon.up.sql | id, company_id, import_id, period, line_hash, supplier_gstin, supplier_name, doc_type, invoice_no, invoice_date, pos, reverse_charge, rate_pct, taxable_paise, igst_paise, cgst_paise, sgst_paise, cess_paise, itc_available, match_status, matched_bill_id, match_note, books_tax_paise, diff_paise, owner, resolution_status, resolution_note, resolved_by, resolved_at, followups_count, next_followup, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| gst_recon_followups | 20261222000348_fin_gst_recon.up.sql | id, company_id, line_id, bill_id, partner_id, channel, note, next_date, by_user, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| gst_itc_reviews | 20261222000348_fin_gst_recon.up.sql | id, company_id, doc_no, period, eligible_paise, blocked_paise, held_paise, reversed_paise, override_paise, claimable_paise, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, journal_id, amends_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| gst_itc_review_lines | 20261222000348_fin_gst_recon.up.sql | id, company_id, review_id, bill_id, supplier_gstin, supplier_name, invoice_no, invoice_date, taxable_paise, tax_paise, decision, reason, claim_paise, reverse_paise, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| gst_return_filings | 20261222000348_fin_gst_recon.up.sql | id, company_id, return_type, period, gstin, data_json, filing_status, arn, filed_on, filed_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tds_returns | 20261222000348_fin_gst_recon.up.sql | id, company_id, doc_no, quarter, form, data_json, challans_json, deducted_paise, deposited_paise, return_status, token_no, filed_on, filed_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tds_26as_lines | 20261222000348_fin_gst_recon.up.sql | id, company_id, fy, line_hash, deductor_tan, deductor_name, section, txn_date, amount_paise, tds_paise, matched_receipt_id, match_status, diff_paise, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fa_classes | 20261223000350_fin_fixed_assets.up.sql | id, company_id, code, name, asset_account_code, accum_account_code, book_method, useful_life_months, residual_bp, tax_block, tax_rate_bp, legal_ref, effective_from, effective_to, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fa_cwip | 20261223000350_fin_fixed_assets.up.sql | id, company_id, doc_no, title, org_project_id, cost_paise, settled_paise, cwip_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fa_cwip_lines | 20261223000350_fin_fixed_assets.up.sql | id, company_id, cwip_id, bill_id, amount_paise, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fa_assets | 20261223000350_fin_fixed_assets.up.sql | id, company_id, doc_no, asset_no, class_code, description, cost_paise, cap_date, org_project_id, org_site_id, custodian, equipment_id, small_asset_id, cap_source, source_bill_id, cwip_id, useful_life_months, residual_paise, book_method, wdv_rate_bp, tax_block, tax_rate_bp, opening_accum_paise, accumulated_dep_paise, wdv_paise, fy_base_paise, fy_base_year, dep_until, hsn_code, asset_state, disposed_on, journal_id, last_verified_on, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fa_dep_runs | 20261223000350_fin_fixed_assets.up.sql | id, company_id, doc_no, period, period_id, assets_count, total_paise, journal_id, run_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fa_depreciation | 20261223000350_fin_fixed_assets.up.sql | id, company_id, asset_id, run_id, period, period_id, from_date, to_date, book_dep_paise, tax_dep_paise, wdv_after_paise, dep_kind, posted_journal_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fa_transfers | 20261223000350_fin_fixed_assets.up.sql | id, company_id, doc_no, asset_id, transfer_date, from_project_id, to_project_id, from_site_id, to_site_id, from_custodian, to_custodian, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fa_disposals | 20261223000350_fin_fixed_assets.up.sql | id, company_id, doc_no, asset_id, disposal_date, method, buyer_partner_id, proceeds_paise, gst_paise, dep_to_date_paise, wdv_paise, gain_loss_paise, reason, journal_id, ar_invoice_ref, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fa_verifications | 20261223000350_fin_fixed_assets.up.sql | id, company_id, doc_no, org_project_id, org_site_id, verify_date, verify_status, expected_count, found_count, closed_by, closed_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fa_verification_lines | 20261223000350_fin_fixed_assets.up.sql | id, company_id, verification_id, asset_id, line_status, asset_condition, scanned_by, scanned_at, note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fa_tax_openings | 20261224000352_fin_fa_tax_openings.up.sql | id, company_id, tax_block, fy, opening_wdv_paise, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fa_asset_components | 20261224000353_fin_fa_components.up.sql | id, company_id, asset_id, parent_asset_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tcs_collections | 20261224000355_fin_tcs.up.sql | id, company_id, invoice_id, partner_id, nature, section, collected_on, base_paise, rate_bp, tcs_paise, pan, tcs_status, journal_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pa_revenue_recognition | 20261225000356_fin_project_accounting.up.sql | id, company_id, doc_no, org_project_id, period, period_id, method, survey_pct_ppm, survey_note, cost_to_date_paise, eac_paise, eac_source, eac_ref, output_paise, poc_ppm, contract_revenue_paise, recognised_cum_paise, recognised_prev_paise, recognised_period_paise, billed_cum_paise, unbilled_paise, excess_billing_paise, expected_loss_paise, loss_provision_paise, prev_unbilled_paise, prev_excess_paise, prev_provision_paise, calc_json, journal_id, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, amends_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pa_overhead_allocations | 20261225000356_fin_project_accounting.up.sql | id, company_id, run_id, pool, period, period_id, org_project_id, basis_value_paise, amount_paise, journal_id, alloc_status, reversal_journal_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fc_forecasts | 20261225000358_fin_cost_forecast.up.sql | id, company_id, doc_no, org_project_id, period, period_id, version_no, budget_paise, committed_paise, actual_paise, accrued_paise, etc_paise, lines_eac_paise, risk_allowance_paise, pending_var_cost_paise, pending_var_note, eac_total_paise, vac_total_paise, contract_revenue_paise, loss_making, confidence, commentary, prev_forecast_id, bridge_json, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, amends_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| fc_forecast_lines | 20261225000358_fin_cost_forecast.up.sql | id, company_id, forecast_id, wbs_id, cost_code_id, line_label, budget_paise, budget_qty_milli, committed_paise, actual_paise, actual_qty_milli, earned_paise, accrued_paise, etc_method, remaining_qty_milli, manual_paise, etc_paise, eac_paise, vac_paise, method_note, notes, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pl_structure | 20261225000360_fin_project_pl.up.sql | id, company_id, line_code, name, line_type, mapping_json, catch_all, overhead, sort, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pl_snapshots | 20261225000360_fin_project_pl.up.sql | id, company_id, doc_no, org_project_id, period, period_id, lines_json, revenue_paise, gross_profit_paise, operating_profit_paise, revenue_cum_paise, operating_profit_cum_paise, gl_total_paise, pl_total_paise, gl_lines_count, gl_max_line_id, budget_json, forecast_json, frozen_at, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, amends_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| cf_forecasts | 20261226000362_fin_cash_forecast.up.sql | id, company_id, doc_no, version_no, week_start, weeks, opening_paise, inflow_paise, outflow_paise, closing_paise, lowest_paise, lowest_week, sources_json, commentary, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, amends_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| cf_lines | 20261226000362_fin_cash_forecast.up.sql | id, company_id, forecast_id, org_project_id, category, week_start, due_date, inflow_paise, outflow_paise, source, source_doc, counterparty, confidence, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| cf_bank_limits | 20261226000362_fin_cash_forecast.up.sql | id, company_id, bank_account_id, bank_name, limit_type, limit_paise, utilised_paise, emi_paise, emi_day, start_date, end_date, limit_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| cf_priority_partners | 20261226000362_fin_cash_forecast.up.sql | id, company_id, partner_id, reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| close_periods | 20261226000364_fin_period_close.up.sql | id, company_id, doc_no, version_no, period_id, period, close_state, checklist_json, figures_json, soft_closed_at, locked_at, reopened_at, commentary, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, amends_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| close_tasks | 20261226000364_fin_period_close.up.sql | id, company_id, close_id, task_code, name, module, sort_order, mandatory, depends_on_json, owner_role, owner_id, due_date, task_status, check_json, evidence_note, evidence_file_ids, done_by, done_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| close_reopens | 20261226000364_fin_period_close.up.sql | id, company_id, doc_no, close_id, period_id, modules_json, target_status, reason, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, amends_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ic_relationships | 20261226000366_fin_intercompany.up.sql | id, company_id, counterpart_company_id, relationship_type, holding_pct, consolidate, receivable_code, payable_code, cp_receivable_code, cp_payable_code, rel_status, valid_from, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ic_transactions | 20261226000366_fin_intercompany.up.sql | id, company_id, doc_no, version_no, relationship_id, to_company_id, ic_type, txn_date, amount_paise, reference, description, from_account_id, to_account_id, org_project_id, from_dims_json, to_dims_json, ic_state, journals_json, accepted_by, accepted_at, dispute_reason, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, amends_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ic_consolidations | 20261226000366_fin_intercompany.up.sql | id, company_id, doc_no, period, basis, companies_json, result_json, eliminations_paise, unmatched_paise, run_status, finalised_by, finalised_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| jv_shares | 20261226000366_fin_intercompany.up.sql | id, company_id, org_project_id, partner_id, partner_company_id, partner_name, share_pct, share_role, valid_from, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pay_components | 20261227000368_pay_setup.up.sql | id, company_id, code, name, comp_type, calc_method, formula, percent_bp, base_codes_json, statutory_code, taxable, pf_applicable, esi_applicable, pt_applicable, wage_class, prorate, sequence, gl_account_code, comp_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pay_structures | 20261227000368_pay_setup.up.sql | id, company_id, code, name, grade, senior, components_json, version_no, previous_id, structure_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pay_assignments | 20261227000368_pay_setup.up.sql | id, company_id, doc_no, employee_id, structure_id, assignment_kind, ctc_annual_paise, component_values_json, overrides_json, gross_monthly_paise, effective_from, effective_to, reason, previous_id, rating, increment_pct_bp, arrears_paise, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, amends_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pay_arrears | 20261227000368_pay_setup.up.sql | id, company_id, assignment_id, employee_id, arrear_month, component_code, days_factor, old_paise, new_paise, amount_paise, arrear_status, paid_run_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pay_statutory_params | 20261227000368_pay_setup.up.sql | id, company_id, doc_no, code, state_code, params_json, effective_from, effective_to, legal_ref, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, amends_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pay_calendar | 20261227000368_pay_setup.up.sql | id, company_id, period, period_from, period_to, attendance_cutoff, inputs_cutoff, pay_date, cal_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pay_runs | 20261227000370_pay_runs.up.sql | id, company_id, doc_no, period, period_id, run_type, branch_id, employees_count, gross_paise, deductions_paise, employer_paise, net_paise, tds_paise, held_count, flags_count, blocking_count, inputs_json, computed_at, locked_at, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, amends_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pay_run_lines | 20261227000370_pay_runs.up.sql | id, company_id, run_id, employee_id, assignment_id, days_in_month, payable_days, paid_days, lop_days, ot_hours, components_json, gross_paise, taxable_paise, deductions_paise, employer_paise, net_paise, tds_paise, tds_json, wages_json, flags_json, hold, hold_reason, hold_released_at, allocation_json, bank_ok, payment_mode, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pay_inputs | 20261227000370_pay_runs.up.sql | id, company_id, employee_id, period, component_code, amount_paise, qty_milli, basis, note, input_status, run_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pay_tax_declarations | 20261227000370_pay_runs.up.sql | id, company_id, employee_id, fy, regime, declarations_json, proofs_json, verified_json, decl_status, submitted_at, verified_by, verified_at, verify_note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pay_wage_runs | 20261227000372_pay_wages.up.sql | id, company_id, doc_no, org_project_id, org_site_id, contractor_id, cycle, period_from, period_to, pay_due_on, state_code, workers_count, days_milli, ot_milli, gross_paise, deductions_paise, employer_paise, net_paise, flags_count, blocking_count, paid_count, acked_count, computed_at, locked_at, disbursed_at, summary_json, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, amends_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pay_wage_lines | 20261227000372_pay_wages.up.sql | id, company_id, run_id, worker_id, trade_code, skill_category, pay_basis, days_milli, ot_milli, piece_qty_milli, piece_uom, piece_rate_paise, piece_source_json, rate_paise, min_rate_paise, wage_source, rate_override_paise, ot_rate_paise, basic_paise, ot_paise, piece_paise, topup_paise, allowances_paise, gross_paise, advance_paise, canteen_paise, other_ded_paise, pf_paise, esi_paise, deductions_paise, employer_paise, net_paise, days_json, adjust_json, flags_json, paid_mode, paid_on, paid_ref, paid_by, ack_status, ack_method, ack_file_id, ack_by, ack_at, ack_note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pay_contractor_wage_checks | 20261227000372_pay_wages.up.sql | id, company_id, doc_no, contractor_id, org_project_id, org_site_id, period, pay_due_on, verify_due_on, state_code, workers_count, attendance_days_milli, sheet_days_milli, sheet_gross_paise, sheet_net_paise, sheet_json, wage_sheet_file_id, proof_file_id, variances_json, variance_count, blocking_count, check_status, hold_requested, submitted_by, submitted_at, verified_by, verified_at, decision_note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| stat_filings | 20261227000374_stat_compliance.up.sql | id, company_id, doc_no, filing_type, period, state_code, due_date, amount_paise, source_run_id, register_id, challan_ref, challan_date, paid_on, payment_ref, approved_amount_paise, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, amends_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| stat_registers | 20261227000374_stat_compliance.up.sql | id, company_id, register_type, period, state_code, org_site_id, source_run_id, row_count, amount_paise, file_name, content_type, content, checksum, generated_at, generated_by, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| stat_rules | 20261227000374_stat_compliance.up.sql | id, company_id, rule_type, state_code, params_json, effective_from, effective_to, legal_ref, rule_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| stat_bocw_months | 20261227000374_stat_compliance.up.sql | id, company_id, org_project_id, period, construction_cost_paise, source_note, cess_rate_bp, cess_paise, cess_status, filing_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pay_fnf | 20261227000376_pay_settle.up.sql | id, company_id, doc_no, employee_id, separation_id, last_working_day, due_date, inputs_json, components_json, adjustments_json, working_json, bonus_rate_bp, gross_paise, deductions_paise, tds_paise, net_paise, payable_paise, recoverable_paise, computed_at, pay_status, paid_on, late, status, requested_by, approved_by, approved_at, workflow_instance_id, cancel_reason, amends_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pay_payslips | 20261227000376_pay_settle.up.sql | id, company_id, run_id, run_line_id, employee_id, period, lang, generated_doc_id, file_id, net_paise, protected, email_status, email_to, email_error, emailed_at, delivery_id, viewed_at, view_count, slip_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pay_transfers | 20261227000376_pay_settle.up.sql | id, company_id, doc_no, source_kind, run_id, fnf_id, bank_account_id, pay_mode, pay_date, lines_count, total_paise, paid_paise, file_name, file_text, file_hash, transfer_status, prepared_by, released_by, released_at, journal_id, cancel_reason, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pay_transfer_lines | 20261227000376_pay_settle.up.sql | id, company_id, transfer_id, employee_id, run_line_id, fnf_id, amount_paise, employee_bank_id, bank_ifsc, account_name, name_match, line_status, utr, paid_on, failure_reason, reversal_journal_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| pay_fnf_rules | 20261227000376_pay_settle.up.sql | id, company_id, rule_type, state_code, params_json, effective_from, effective_to, legal_ref, rule_status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ptl_accounts | 20261227000378_portal_core.up.sql | id, company_id, doc_no, partner_id, contact_id, stakeholder_id, portal_type, status, invite_hash, invite_expires_at, password_hash, totp_enc, last_counter, failed_attempts, locked_until, terms_version, terms_accepted_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ptl_sessions | 20261227000378_portal_core.up.sql | token_hash, account_id, expires_at, last_seen |
| ptl_messages | 20261227000379_portal_exchange.up.sql | id, company_id, account_id, doc_no, kind, subject, body, status, submission_key, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ptl_shares | 20261227000379_portal_exchange.up.sql | id, company_id, account_id, version_id, doc_no, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ptl_registrations | 20261227000379_portal_exchange.up.sql | id, company_id, partner_id, doc_no, receipt_hash, submission_hash, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ptl_asn_invoices | 20261227000382_supplier_intake.up.sql | dispatch_id, file_id |
| ptl_vdr_orders | 20261227000382_supplier_intake.up.sql | item_id, po_id |
| ptl_rfq_files | 20261227000382_supplier_intake.up.sql | file_id |
| rpt_subscriptions | 20261227000392_bi_subscriptions.up.sql | id, company_id, owner_id, saved_view_id, name, frequency, format, channel, lifecycle_state, next_run_at, status, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by, version, is_active, source_type, source_id, remarks |
| rpt_runs | 20261227000392_bi_subscriptions.up.sql | id, company_id, subscription_id, subscription_version, report_name, channel, export_id, notification_id, scheduled_at, status, detail, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by, version, is_active, source_type, source_id, remarks |
| bi_metrics | 20261227000394_metric_catalogue.up.sql | id, company_id, code, dataset_version, status, request_id, version, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, source_type, source_id, remarks |
| bi_refresh_log | 20261227000394_metric_catalogue.up.sql | id, company_id, period, dataset_version, captured_at, row_count, status, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks |
| bi_project_snapshots | 20261227000394_metric_catalogue.up.sql | id, company_id, refresh_id, project_id, lifecycle_state, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, status, source_type, source_id, remarks |
| bi_domain_refreshes | 20261227000395_bi_domain_observations.up.sql | id, company_id, metric_code, dataset_version, period, captured_at, row_count, missing_count, status, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks |
| bi_domain_observations | 20261227000395_bi_domain_observations.up.sql | id, company_id, refresh_id, project_id, value_scaled, source_period, source_version, status, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks |
| exec_alerts | 20261227000397_control_tower.up.sql | id, company_id, alert_no, rule_code, rule_version, dimension, project_id, severity, message, observed_value, threshold, evidence_key, route, raised_at, last_seen_at, occurrences, owner_id, owner_user, task_id, status, acknowledged_by, acknowledged_at, resolved_by, resolved_at, resolution, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks |
| exec_alert_settings | 20261227000397_control_tower.up.sql | id, company_id, rule_code, enabled, threshold, periods, severity, request_id, status, version, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, source_type, source_id, remarks |
| mr_configs | 20261227000398_morning_report.up.sql | id, company_id, scope_type, scope_ref, sections_json, delivery_json, active, request_id, status, version, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, source_type, source_id, remarks |
| mr_reports | 20261227000398_morning_report.up.sql | id, company_id, report_no, report_date, recipient_id, recipient_user, config_id, file_id, cutoff_at, snapshot_json, snapshot_hash, data_snapshot_ref, exceptions, generated_at, delivered_at, channels_json, trigger, status, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks |
| dei_daily | 20261227000399_execution_intelligence.up.sql | id, company_id, project_id, site_id, site_key, snap_date, planned_value, executed_value, cost_value, wip_value, cum_value, billed_gap_value, balance_value, labour_count, plant_hours, idle_hours, hindrances_open, rfis_raised, rfis_answered, rfis_open, snapshot_json, captured_at, status, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks |
| mc_monthly_closes | 20261227000400_monthly_close.up.sql | id, company_id, doc_no, project_id, period, period_id, version_no, parent_close_id, checklist_json, mis_json, budget_master_json, mis_file_id, snapshot_at, status, lock_state, locked_at, workflow_instance_id, requested_by, approved_by, approved_at, reason, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks |
| det_rules | 20261227000402_leakage_detection.up.sql | id, company_id, code, name, module, query_ref, threshold_json, severity, active, request_id, status, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| det_findings | 20261227000402_leakage_detection.up.sql | id, company_id, doc_no, rule_code, rule_version, project_id, site_id, entity, entity_id, entity_ref, title, value_at_risk, evidence_json, dedupe_key, severity, owner_id, owner_user, owner_role, owner_basis, status, outcome, loss_amount, resolution, detected_at, last_seen_at, occurrences, due_at, escalated_at, closed_by, closed_at, task_id, workflow_instance_id, requested_by, approved_by, approved_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks |
| scn_scenarios | 20261227000404_scenarios.up.sql | id, company_id, doc_no, name, project_id, scope_json, drivers_json, results_json, base_json, overhead_per_day, eac_delta, margin_delta, finish_delta_days, cash_low_delta, computed_at, status, shared_json, actions_json, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, site_id |
| ai_providers | 20261227000405_ai_gateway.up.sql | id, company_id, code, provider, model, endpoint_ref, price_in_per_mtok, price_out_per_mtok, status, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| ai_features | 20261227000405_ai_gateway.up.sql | id, company_id, doc_no, code, description, provider_code, prompt_version, tools_json, enabled_scope_json, quota_json, eval_json, eval_passed_at, version_no, parent_id, enabled, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, reason, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| ai_logs | 20261227000405_ai_gateway.up.sql | id, company_id, feature_code, feature_version, provider_code, model, user_id, user_name, request_ref, prompt_version, context_refs_json, prompt_redacted, response_redacted, tokens_in, tokens_out, cost, outcome, block_reason, latency_ms, redactions, label, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| ai_controls | 20261227000405_ai_gateway.up.sql | id, company_id, kill_switch, kill_reason, kill_by, kill_at, retention_days, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| ai_drafts | 20261227000406_ai_assistant.up.sql | id, company_id, log_id, kind, owner_user, title, body, target_entity, target_id, target_ref, status, applied_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| ai_feedback | 20261227000406_ai_assistant.up.sql | id, company_id, log_id, feature_code, user_name, rating, comment, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| aif_models | 20261227000407_ai_forecasting.up.sql | id, company_id, doc_no, code, name, use_case, method, params_json, horizon, version_no, parent_id, backtest_json, backtest_at, status, workflow_instance_id, requested_by, approved_by, approved_at, cancel_reason, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| aif_forecasts | 20261227000407_ai_forecasting.up.sql | id, company_id, model_id, use_case, subject_key, subject_label, as_of, points_json, next_value, next_low, next_high, completion_json, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| aif_anomalies | 20261227000407_ai_forecasting.up.sql | id, company_id, kind, subject, observed, expected, score, detail, route, status, detected_at, reviewed_by, reviewed_at, review_note, source_ref, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| di_extractions | 20261227000408_ai_docintel.up.sql | id, company_id, doc_no, file_id, file_name, linked_entity, linked_id, doc_type, class_confidence, engine, ocr_confidence, pages, text_content, simhash, fields_json, clauses_json, summary, duplicate_of_file_id, duplicate_json, status, reason, extracted_at, final_json, changed_json, applied_json, reviewed_by, reviewed_at, review_note, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| cv_results | 20261227000409_ai_vision.up.sql | id, company_id, doc_no, file_id, file_name, linked_entity, linked_id, model, labels_json, confidence, status, reason, blurred_file_id, blur_regions_json, analysed_at, confirmed_by, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| adm_controls | 20261227000410_admin_control.up.sql | id, company_id, read_only, read_only_reason, read_only_by, read_only_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| adm_emergency_actions | 20261227000410_admin_control.up.sql | id, company_id, action, reason, detail_json, executed_by, executed_at, ratify_due, ratification_request_id, status, ratified_by, ratified_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| adm_config_snapshots | 20261227000410_admin_control.up.sql | id, company_id, environment, taken_at, checksum, content_json, file_id, note, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| int_mappings | 20261227000411_admin_connectors.up.sql | id, company_id, connector_code, entity, internal_value, external_value, status, request_id, approved_by, approved_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| int_sync_runs | 20261227000411_admin_connectors.up.sql | id, company_id, connector_code, kind, direction, started_at, finished_at, records, errors, errors_json, params_json, detail_json, output_text, status, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| api_clients | 20261227000412_admin_api_platform.up.sql | id, company_id, client_id, name, owner_partner_id, service_user_id, role_code, scopes_json, project_ids_json, tier_code, environment, status, secret_hash, secret_hint, secret_rotated_at, prev_secret_hash, prev_secret_expires_at, request_id, approved_by, approved_at, last_used_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| api_tokens | 20261227000412_admin_api_platform.up.sql | id, company_id, client_ref, token_hash, scopes_json, expires_at, revoked_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| api_webhooks | 20261227000412_admin_api_platform.up.sql | id, company_id, client_ref, url, event_types_json, secret_enc, secret_hint, status, failure_streak, last_delivery_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| api_webhook_deliveries | 20261227000412_admin_api_platform.up.sql | id, company_id, webhook_id, event_id, event_type, payload_json, status, attempts, response_code, last_error, next_attempt_at, delivered_at, duration_ms, replay_of, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| api_usage | 20261227000412_admin_api_platform.up.sql | id, company_id, client_ref, day, endpoint_id, calls, errors, throttled, total_ms, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| xl_packs | 20261227000413_admin_bulk_entry.up.sql | id, company_id, code, module, name, template_codes_json, pack_version, instructions, examples_json, notes, status, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| xl_bulk_batches | 20261227000413_admin_bulk_entry.up.sql | id, company_id, doc_no, title, template_code, pack_code, rows_json, row_count, error_count, errors_json, on_existing, needs_approval, approver_role, status, request_id, actor_json, submitted_at, imported_at, result_json, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| mig_objects | 20261227000414_admin_migration.up.sql | id, company_id, code, name, kind, phase, sequence, owner_role, owner_user, financial, mapping_json, mapping_version, status, request_id, signed_off_by, signed_off_at, last_trial_at, loaded_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| mig_runs | 20261227000414_admin_migration.up.sql | id, company_id, object_code, environment, run_type, mode, status, records, errors, legacy_rows, dropped, mapping_version, input_hash, reconciliation_json, errors_json, detail_json, started_at, finished_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| mig_cutovers | 20261227000414_admin_migration.up.sql | id, company_id, name, freeze_from, freeze_to, rollback_point, steps_json, status, frozen_at, closed_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| ops_backups | 20261227000415_admin_backups.up.sql | id, backup_type, name, started_at, finished_at, size_bytes, location, offsite_location, checksum, offsite_checksum, encrypted, table_count, row_count, manifest_json, tiers_json, files_json, status, error, expired_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks |
| ops_restore_tests | 20261227000415_admin_backups.up.sql | id, backup_id, kind, environment, started_at, finished_at, validated, status, checks_json, restore_minutes, data_loss_minutes, rto_target, rpo_target, report_file_id, note, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks |
| ops_backup_alerts | 20261227000415_admin_backups.up.sql | id, check_code, message, status, fired_at, resolved_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks |
| ops_restore_requests | 20261227000415_admin_backups.up.sql | id, company_id, backup_id, incident_ref, incident_summary, status, request_id, approved_by, approved_at, executed_at, executed_by, safety_copy, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| arc_policies | 20261227000416_admin_archive.up.sql | id, company_id, record_class, archive_after_months, retention_years, legal_basis, action_after, status, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| arc_jobs | 20261227000416_admin_archive.up.sql | id, company_id, record_class, scope_json, records, held, status, request_id, approved_by, executed_at, file_name, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| arc_disposals | 20261227000416_admin_archive.up.sql | id, company_id, record_class, record_ids_json, records, held, action_after, status, request_id, disposed, anonymised, certificate_no, executed_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| arc_records | 20261227000416_admin_archive.up.sql | id, company_id, record_class, entity, entity_id, ref, project_ref, record_date, payload_json, job_id, archived_at, disposed_at, disposal_action, disposal_id, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| arc_holds | 20261227000416_admin_archive.up.sql | id, company_id, entity, entity_id, label, reason, placed_by, released_at, released_by, release_reason, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| arc_erasures | 20261227000416_admin_archive.up.sql | id, company_id, subject_type, subject_id, subject_label, basis, checks_json, status, request_id, executed_at, fields_json, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| hd_tickets | 20261227000417_admin_helpdesk.up.sql | id, company_id, ticket_no, subject, description, category, priority, team, status, assigned_to, sla_due, escalation_level, escalated_at, page_ref, page_title, entity, entity_id, correlation_id, failed_call_json, user_agent, screenshot_file_id, channels_json, resolution, resolved_at, rating, rating_comment, raised_by, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| hd_ticket_notes | 20261227000417_admin_helpdesk.up.sql | id, company_id, ticket_id, kind, body, internal, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| hd_corrections | 20261227000417_admin_helpdesk.up.sql | id, company_id, ticket_id, module, entity, entity_id, record_ref, changes_json, reason, owner_role, financial, status, request_id, approved_by, approved_at, transaction_ref, implemented_by, implemented_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| hd_articles | 20261227000417_admin_helpdesk.up.sql | id, company_id, kind, title, body, module, page_codes_json, roles_json, steps_json, valid_from, valid_to, article_version, status, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| hd_tour_views | 20261227000417_admin_helpdesk.up.sql | id, company_id, article_id, user_name, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| tst_integration_runs | 20261228000418_tst_integration.up.sql | id, company_id, run_no, status, result_status, started_at, finished_at, totals_json, result_json, error, requested_by, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| tst_latency_probes | 20261228000418_tst_integration.up.sql | id, company_id, probe_no, status, sent_at, consumed_at, realtime_at, notified_at, latency_ms, target_ms, requested_by, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| tst_recon_runs | 20261228000419_tst_reconciliation.up.sql | id, company_id, run_no, as_of, status, result_status, checks_count, failed_count, critical_count, trace_bp, trace_json, tolerance_json, started_at, finished_at, error, requested_by, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| tst_recon_results | 20261228000419_tst_reconciliation.up.sql | id, company_id, run_id, check_code, scope_key, label, expected_value, actual_value, difference_value, unit, status, severity, drill_route, detail, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| tst_page_audit_runs | 20261228000420_tst_page_audit.up.sql | id, company_id, run_no, run_kind, viewport, status, pages_count, failed_count, started_at, finished_at, requested_by, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| tst_page_audit | 20261228000420_tst_page_audit.up.sql | id, company_id, page_code, route, audit_kind, viewport, role_tested, checklist_json, defects_json, evidence_file_ids, status, notes, run_id, tested_by, tested_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| tst_test_runs | 20261228000421_tst_test_programme.up.sql | id, company_id, run_no, run_source, suite, commit_ref, started_at, finished_at, total_count, passed_count, failed_count, skipped_count, status, requested_by, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| tst_test_catalogue | 20261228000421_tst_test_programme.up.sql | id, company_id, test_id, part_id, requirement_ref, test_type, automated, file, name, last_result, last_run_id, last_run_at, last_duration_ms, status, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| tst_sandbox_runs | 20261228000421_tst_test_programme.up.sql | id, company_id, run_no, kind, pack, status, result_status, params_json, expected_json, actual_json, counts_json, error, started_at, finished_at, requested_by, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| sct_scan_runs | 20261228000422_sct_security.up.sql | id, company_id, run_no, scan_kind, status, checked_count, findings_count, summary_json, started_at, finished_at, requested_by, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| sct_findings | 20261228000422_sct_security.up.sql | id, company_id, finding_no, source, severity, title, description, endpoint, cwe, fingerprint, status, scan_run_id, reported_by, fixed_in, fixed_by, fixed_at, retested_by, retested_at, retest_note, request_id, last_seen_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| sct_reviews | 20261228000422_sct_security.up.sql | id, company_id, control_code, area, status, evidence, reviewed_by, reviewed_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| tst_perf_runs | 20261228000423_tst_performance.up.sql | id, company_id, run_no, profile, tool, environment, machine, started_at, finished_at, duration_s, users_count, requests_count, errors_count, rss_start_mb, rss_end_mb, rss_max_mb, memory_json, result_status, commit_ref, requested_by, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| tst_perf_results | 20261228000423_tst_performance.up.sql | id, company_id, run_id, model, journey, slo_kind, slo_ms, requests_count, errors_count, max_ms, throughput_rps, target_rps, status, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| tst_devices | 20261228000424_tst_a11y.up.sql | id, company_id, code, label, device_class, os, browser, width, height, ram_gb, cpu_slowdown, network, automation, sort_order, status, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| tst_a11y_runs | 20261228000424_tst_a11y.up.sql | id, company_id, run_no, run_kind, device_id, width, height, theme, language, network, assistive_tech, status, items_count, failed_count, serious_count, started_at, finished_at, requested_by, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| tst_a11y_results | 20261228000424_tst_a11y.up.sql | id, company_id, run_id, page_code, route, journey, status, critical_count, serious_count, moderate_count, minor_count, violations_json, overflow_px, small_targets, tiny_inputs, load_ms, steps_json, notes, issue_status, fixed_in, fixed_by, fixed_at, retested_run_id, retested_at, tested_by, tested_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| ops_environments | 20261228000425_ops_devops.up.sql | id, company_id, code, name, url, hosts, status, active_build, active_slot, last_deploy_at, last_health_at, health_status, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| ops_deployments | 20261228000425_ops_devops.up.sql | id, company_id, deploy_no, environment_id, kind, method, build_id, version_label, commit_ref, pipeline_run, status, started_at, finished_at, duration_ms, requests_count, failed_requests, steps_json, reason, requested_by, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| ops_runbooks | 20261228000425_ops_devops.up.sql | id, company_id, code, title, path, content_hash, version_no, status, request_id, approved_by, approved_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| ops_oncall | 20261228000425_ops_devops.up.sql | id, company_id, username, support_level, from_at, to_at, status, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| ops_pages | 20261228000425_ops_devops.up.sql | id, company_id, alert_id, rule_code, severity, message, username, support_level, status, paged_at, acknowledged_at, acknowledged_by, escalated_page_id, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| man_captures | 20261228000426_man_manuals.up.sql | id, company_id, capture_no, build_id, status, baseline_id, screens_count, same_count, changed_count, new_count, removed_count, removed_json, compared_at, accepted_by, accepted_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| man_screens | 20261228000426_man_manuals.up.sql | id, company_id, capture_id, route, viewport, role_code, title, signature_hash, signature_json, image_file_id, drift, diff_json, captured_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| man_packages | 20261228000426_man_manuals.up.sql | id, company_id, package_no, build_id, version_label, capture_id, status, zip_path, zip_bytes, manuals_count, files_count, progress_pct, error, requested_by, started_at, finished_at, approved_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| man_manuals | 20261228000426_man_manuals.up.sql | id, company_id, package_id, code, kind, role_or_module, language, title, owner_role, build_id, version_no, content_hash, sections_count, pages_count, screens_count, routes_json, files_json, status, stale_reason, request_id, approved_by, approved_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| golive_checklist | 20261228000427_golive.up.sql | id, company_id, criterion, title, category, mandatory, evaluation, owner_role, owner_id, evidence_links, status, detail, measured_value, target_value, checked_by, checked_at, waiver_reason, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| uat_scripts | 20261228000427_golive.up.sql | id, company_id, code, module, role_code, title, scenario_source, steps_json, expected, status, executed_by, executed_at, notes, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| uat_defects | 20261228000427_golive.up.sql | id, company_id, defect_no, phase, module, script_id, title, description, severity, status, owner_id, reported_by, reported_at, triaged_by, triaged_at, fixed_in, fixed_at, closed_by, closed_at, deferred_reason, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| uat_signoffs | 20261228000427_golive.up.sql | id, company_id, module, owner_role, status, scripts_total, scripts_passed, open_defects, requested_by, requested_at, signed_by, signed_at, request_id, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| golive_cutover_runs | 20261228000427_golive.up.sql | id, company_id, run_no, kind, window_minutes, planned_start, status, rollback_point, decision_id, started_at, finished_at, elapsed_minutes, within_window, started_by, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| golive_cutover_steps | 20261228000427_golive.up.sql | id, company_id, run_id, seq, code, title, owner_role, mode, planned_minutes, status, started_at, finished_at, done_by, detail, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| golive_decisions | 20261228000427_golive.up.sql | id, company_id, decision_no, meeting_at, attendees_json, recommendation, go_live_at, criteria_json, minutes, status, request_id, decided_at, communicated_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| golive_hypercare | 20261228000427_golive.up.sql | id, company_id, decision_id, start_date, end_date, status, war_room_json, handover_notes, handover_request_id, handed_over_by, handed_over_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| golive_hypercare_days | 20261228000427_golive.up.sql | id, company_id, hypercare_id, report_date, opened_count, closed_count, open_by_severity_json, kpis_json, triage_notes, status, published_by, published_at, created_by, created_at, updated_by, updated_at, deleted_by, deleted_at, is_active, version, source_type, source_id, remarks, project_id, site_id |
| core_flag_changes | 20261228000429_core_flag_changes.up.sql | id, company_id, doc_no, flag_key, scope_level, scope_environment, scope_company_id, scope_project_id, enabled, area, reason, status, requested_by, first_approved_by, first_approved_at, decided_by, decided_at, decision_note, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tnc_systems | 20261228000430_tnc_commissioning.up.sql | id, company_id, org_project_id, org_site_id, parent_id, code, name, discipline, stage, status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tnc_tags | 20261228000430_tnc_commissioning.up.sql | id, company_id, system_id, tag_no, description, status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tnc_checksheets | 20261228000430_tnc_commissioning.up.sql | id, company_id, tag_id, sheet_class, title, inspection_id, status, result_note, done_by, done_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tnc_test_packs | 20261228000430_tnc_commissioning.up.sql | id, company_id, system_id, doc_no, pack_type, procedure_ref, status, witnessed_by, witness_party, tested_on, result_note, evidence_file_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tnc_punch_links | 20261228000430_tnc_commissioning.up.sql | id, company_id, system_id, snag_id, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| tnc_certificates | 20261228000430_tnc_commissioning.up.sql | id, company_id, system_id, doc_no, kind, status, workflow_instance_id, requested_by, approved_at, client_signatory, client_signed_on, client_file_id, issued_by, issued_at, readiness_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ho_handovers | 20261228000431_ho_handover.up.sql | id, company_id, org_project_id, org_site_id, location_id, doc_no, title, scope_type, area_label, planned_on, effective_on, dlp_months, status, workflow_instance_id, requested_by, approved_at, client_signatory, client_signed_on, client_file_id, issued_by, issued_at, readiness_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ho_checklist_items | 20261228000431_ho_handover.up.sql | id, company_id, handover_id, category, title, mandatory, status, file_id, doc_revision_id, tnc_certificate_id, note, done_by, done_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| ho_client_assets | 20261228000431_ho_handover.up.sql | id, company_id, handover_id, org_project_id, tnc_system_id, tag_no, description, category, location_text, make, model, serial_no, capacity, warranty_until, maintenance_note, status, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| dlp_periods | 20261228000432_dlp.up.sql | id, company_id, org_project_id, org_site_id, handover_id, doc_no, area_label, starts_on, ends_on, status, workflow_instance_id, requested_by, completed_at, expiry_notified_on, readiness_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| dlp_complaints | 20261228000432_dlp.up.sql | id, company_id, period_id, asset_id, doc_no, reported_on, reported_by, source, location_text, description, severity, due_at, responsible_type, partner_id, status, rectified_by, rectified_at, rectification_note, rectify_file_id, verified_by, closed_at, recovery_amount, escalation_level, escalated_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| dlp_warranty_claims | 20261228000432_dlp.up.sql | id, company_id, period_id, asset_id, complaint_id, partner_id, doc_no, claimed_on, description, status, resolution_note, resolved_on, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| cls_closures | 20261228000433_cls_closeout.up.sql | id, company_id, org_project_id, doc_no, status, final_account_paise, final_account_agreed_on, final_account_file_id, pl_snapshot_id, revenue_paise, cost_paise, performance_json, summary, workflow_instance_id, requested_by, closed_at, readiness_json, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| cls_checklist_items | 20261228000433_cls_closeout.up.sql | id, company_id, closure_id, code, title, kind, mandatory, status, file_id, note, done_by, done_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| kb_lessons | 20261228000433_cls_closeout.up.sql | id, company_id, org_project_id, doc_no, title, category, impact, what_happened, recommendation, tags, status, author, workflow_instance_id, published_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| kb_benchmarks | 20261228000433_cls_closeout.up.sql | id, company_id, org_project_id, closure_id, metric_code, label, unit, value_milli, basis, status, approved_at, project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks |
| iam_captcha_uses | 20261228000435_iam_captcha_uses.up.sql | token_hash, expires_at |

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
| ux_core_slo_definitions_journey | core_slo_definitions | yes | 20261030000018_core_observability.up.sql |
| ix_core_slo_definitions_company | core_slo_definitions | no | 20261030000018_core_observability.up.sql |
| ux_core_alert_rules_code | core_alert_rules | yes | 20261030000018_core_observability.up.sql |
| ix_core_alert_rules_company | core_alert_rules | no | 20261030000018_core_observability.up.sql |
| ix_core_alerts_status | core_alerts | no | 20261030000018_core_observability.up.sql |
| ix_core_alerts_rule | core_alerts | no | 20261030000018_core_observability.up.sql |
| ux_core_metric_samples_bucket | core_metric_samples | yes | 20261030000018_core_observability.up.sql |
| ix_core_client_events_time | core_client_events | no | 20261030000018_core_observability.up.sql |
| ix_core_client_events_type | core_client_events | no | 20261030000018_core_observability.up.sql |
| ix_core_client_events_correlation | core_client_events | no | 20261030000018_core_observability.up.sql |
| ux_core_connectors_code | core_connectors | yes | 20261030000020_core_integration_hub.up.sql |
| ix_core_connectors_company | core_connectors | no | 20261030000020_core_integration_hub.up.sql |
| ix_core_connectors_type | core_connectors | no | 20261030000020_core_integration_hub.up.sql |
| ux_core_connector_secrets_active | core_connector_secrets | yes | 20261030000020_core_integration_hub.up.sql |
| ux_core_connector_secrets_pending | core_connector_secrets | yes | 20261030000020_core_integration_hub.up.sql |
| ix_core_connector_secrets_company | core_connector_secrets | no | 20261030000020_core_integration_hub.up.sql |
| ix_core_integration_logs_connector | core_integration_logs | no | 20261030000020_core_integration_hub.up.sql |
| ix_core_integration_logs_company | core_integration_logs | no | 20261030000020_core_integration_hub.up.sql |
| ix_core_integration_logs_status | core_integration_logs | no | 20261030000020_core_integration_hub.up.sql |
| ix_core_integration_logs_correlation | core_integration_logs | no | 20261030000020_core_integration_hub.up.sql |
| ux_core_webhook_receipts_delivery | core_webhook_receipts | yes | 20261030000020_core_integration_hub.up.sql |
| ux_iam_users_username | iam_users | yes | 20261030000022_iam_authentication.up.sql |
| ux_iam_users_email | iam_users | yes | 20261030000022_iam_authentication.up.sql |
| ux_iam_users_mobile | iam_users | yes | 20261030000022_iam_authentication.up.sql |
| ix_iam_users_company | iam_users | no | 20261030000022_iam_authentication.up.sql |
| ux_iam_credentials_user | iam_credentials | yes | 20261030000022_iam_authentication.up.sql |
| ix_iam_credentials_company | iam_credentials | no | 20261030000022_iam_authentication.up.sql |
| ix_iam_mfa_factors_user | iam_mfa_factors | no | 20261030000022_iam_authentication.up.sql |
| ix_iam_mfa_factors_company | iam_mfa_factors | no | 20261030000022_iam_authentication.up.sql |
| ux_iam_devices_user_fingerprint | iam_devices | yes | 20261030000022_iam_authentication.up.sql |
| ix_iam_devices_company | iam_devices | no | 20261030000022_iam_authentication.up.sql |
| ux_iam_auth_policy_company | iam_auth_policy | yes | 20261030000022_iam_authentication.up.sql |
| ux_iam_sessions_public | iam_sessions | yes | 20261030000022_iam_authentication.up.sql |
| ix_iam_sessions_user | iam_sessions | no | 20261030000022_iam_authentication.up.sql |
| ix_iam_sessions_device | iam_sessions | no | 20261030000022_iam_authentication.up.sql |
| ix_iam_sessions_company | iam_sessions | no | 20261030000022_iam_authentication.up.sql |
| ux_iam_refresh_tokens_hash | iam_refresh_tokens | yes | 20261030000022_iam_authentication.up.sql |
| ix_iam_refresh_tokens_session | iam_refresh_tokens | no | 20261030000022_iam_authentication.up.sql |
| ix_iam_login_events_user | iam_login_events | no | 20261030000022_iam_authentication.up.sql |
| ix_iam_login_events_company | iam_login_events | no | 20261030000022_iam_authentication.up.sql |
| ix_iam_login_events_result | iam_login_events | no | 20261030000022_iam_authentication.up.sql |
| ux_iam_password_resets_hash | iam_password_resets | yes | 20261030000022_iam_authentication.up.sql |
| ix_iam_password_resets_user | iam_password_resets | no | 20261030000022_iam_authentication.up.sql |
| ux_org_companies_code | org_companies | yes | 20261030000024_iam_organisation.up.sql |
| ux_org_branches_code | org_branches | yes | 20261030000024_iam_organisation.up.sql |
| ix_org_branches_parent | org_branches | no | 20261030000024_iam_organisation.up.sql |
| ux_org_departments_code | org_departments | yes | 20261030000024_iam_organisation.up.sql |
| ix_org_departments_parent | org_departments | no | 20261030000024_iam_organisation.up.sql |
| ix_org_departments_branch | org_departments | no | 20261030000024_iam_organisation.up.sql |
| ix_org_departments_head | org_departments | no | 20261030000024_iam_organisation.up.sql |
| ux_org_designations_code | org_designations | yes | 20261030000024_iam_organisation.up.sql |
| ux_org_projects_code | org_projects | yes | 20261030000024_iam_organisation.up.sql |
| ix_org_projects_branch | org_projects | no | 20261030000024_iam_organisation.up.sql |
| ix_org_projects_pm | org_projects | no | 20261030000024_iam_organisation.up.sql |
| ix_org_projects_status | org_projects | no | 20261030000024_iam_organisation.up.sql |
| ux_org_sites_code | org_sites | yes | 20261030000024_iam_organisation.up.sql |
| ix_org_sites_company | org_sites | no | 20261030000024_iam_organisation.up.sql |
| ix_org_sites_in_charge | org_sites | no | 20261030000024_iam_organisation.up.sql |
| ux_org_locations_code | org_locations | yes | 20261030000024_iam_organisation.up.sql |
| ux_org_cost_centres_code | org_cost_centres | yes | 20261030000024_iam_organisation.up.sql |
| ix_org_cost_centres_parent | org_cost_centres | no | 20261030000024_iam_organisation.up.sql |
| ix_org_cost_centres_link | org_cost_centres | no | 20261030000024_iam_organisation.up.sql |
| ix_org_assignments_entity | org_assignments | no | 20261030000024_iam_organisation.up.sql |
| ix_org_assignments_user | org_assignments | no | 20261030000024_iam_organisation.up.sql |
| ix_org_assignments_pending | org_assignments | no | 20261030000024_iam_organisation.up.sql |
| ix_org_assignments_company_id | org_assignments | no | 20261030000024_iam_organisation.up.sql |
| ux_iam_user_profiles_user | iam_user_profiles | yes | 20261030000026_iam_user_management.up.sql |
| ux_iam_user_profiles_employee | iam_user_profiles | yes | 20261030000026_iam_user_management.up.sql |
| ix_iam_user_profiles_lifecycle | iam_user_profiles | no | 20261030000026_iam_user_management.up.sql |
| ix_iam_user_profiles_type | iam_user_profiles | no | 20261030000026_iam_user_management.up.sql |
| ix_iam_user_profiles_department | iam_user_profiles | no | 20261030000026_iam_user_management.up.sql |
| ix_iam_user_profiles_project | iam_user_profiles | no | 20261030000026_iam_user_management.up.sql |
| ix_iam_user_profiles_photo | iam_user_profiles | no | 20261030000026_iam_user_management.up.sql |
| ix_iam_user_profiles_signature | iam_user_profiles | no | 20261030000026_iam_user_management.up.sql |
| ix_iam_users_company_name | iam_users | no | 20261030000026_iam_user_management.up.sql |
| ux_iam_invitations_token | iam_invitations | yes | 20261030000026_iam_user_management.up.sql |
| ux_iam_invitations_pending | iam_invitations | yes | 20261030000026_iam_user_management.up.sql |
| ix_iam_invitations_user | iam_invitations | no | 20261030000026_iam_user_management.up.sql |
| ix_iam_invitations_company | iam_invitations | no | 20261030000026_iam_user_management.up.sql |
| ix_iam_role_grants_user | iam_role_grants | no | 20261030000026_iam_user_management.up.sql |
| ix_iam_role_grants_request | iam_role_grants | no | 20261030000026_iam_user_management.up.sql |
| ix_iam_role_grants_company | iam_role_grants | no | 20261030000026_iam_user_management.up.sql |
| ux_iam_permissions_key | iam_permissions | yes | 20261030000028_iam_role_engine.up.sql |
| ix_iam_permissions_module | iam_permissions | no | 20261030000028_iam_role_engine.up.sql |
| ux_iam_roles_code | iam_roles | yes | 20261030000028_iam_role_engine.up.sql |
| ix_iam_roles_company | iam_roles | no | 20261030000028_iam_role_engine.up.sql |
| ix_iam_roles_department | iam_roles | no | 20261030000028_iam_role_engine.up.sql |
| ix_iam_roles_template | iam_roles | no | 20261030000028_iam_role_engine.up.sql |
| ux_iam_role_permissions | iam_role_permissions | yes | 20261030000028_iam_role_engine.up.sql |
| ix_iam_role_permissions_key | iam_role_permissions | no | 20261030000028_iam_role_engine.up.sql |
| ux_iam_field_masks | iam_field_masks | yes | 20261030000028_iam_role_engine.up.sql |
| ix_iam_field_masks_field | iam_field_masks | no | 20261030000028_iam_role_engine.up.sql |
| ix_iam_assignments_user | iam_assignments | no | 20261030000028_iam_role_engine.up.sql |
| ix_iam_assignments_role | iam_assignments | no | 20261030000028_iam_role_engine.up.sql |
| ix_iam_assignments_request | iam_assignments | no | 20261030000028_iam_role_engine.up.sql |
| ix_iam_assignments_company | iam_assignments | no | 20261030000028_iam_role_engine.up.sql |
| ux_iam_role_mapping | iam_role_mapping | yes | 20261030000028_iam_role_engine.up.sql |
| ix_iam_role_mapping_role | iam_role_mapping | no | 20261030000028_iam_role_engine.up.sql |
| ux_iam_sod_rules_code | iam_sod_rules | yes | 20261030000030_iam_sod_privileged_reviews.up.sql |
| ux_iam_sod_violations_standing | iam_sod_violations | yes | 20261030000030_iam_sod_privileged_reviews.up.sql |
| ix_iam_sod_violations_company | iam_sod_violations | no | 20261030000030_iam_sod_privileged_reviews.up.sql |
| ix_iam_sod_violations_rule | iam_sod_violations | no | 20261030000030_iam_sod_privileged_reviews.up.sql |
| ix_iam_sod_violations_user | iam_sod_violations | no | 20261030000030_iam_sod_privileged_reviews.up.sql |
| ix_iam_sod_actions_subject | iam_sod_actions | no | 20261030000030_iam_sod_privileged_reviews.up.sql |
| ix_iam_sod_actions_user | iam_sod_actions | no | 20261030000030_iam_sod_privileged_reviews.up.sql |
| ix_iam_elevations_user | iam_elevations | no | 20261030000030_iam_sod_privileged_reviews.up.sql |
| ix_iam_elevations_role | iam_elevations | no | 20261030000030_iam_sod_privileged_reviews.up.sql |
| ix_iam_elevations_request | iam_elevations | no | 20261030000030_iam_sod_privileged_reviews.up.sql |
| ix_iam_elevations_company | iam_elevations | no | 20261030000030_iam_sod_privileged_reviews.up.sql |
| ix_iam_elevation_log_elevation | iam_elevation_log | no | 20261030000030_iam_sod_privileged_reviews.up.sql |
| ux_iam_access_campaigns_code | iam_access_campaigns | yes | 20261030000030_iam_sod_privileged_reviews.up.sql |
| ix_iam_access_campaigns_department | iam_access_campaigns | no | 20261030000030_iam_sod_privileged_reviews.up.sql |
| ux_iam_access_reviews_reviewer | iam_access_reviews | yes | 20261030000030_iam_sod_privileged_reviews.up.sql |
| ix_iam_access_reviews_reviewer | iam_access_reviews | no | 20261030000030_iam_sod_privileged_reviews.up.sql |
| ix_iam_access_reviews_company_id | iam_access_reviews | no | 20261030000030_iam_sod_privileged_reviews.up.sql |
| ix_iam_access_review_items_company_id | iam_access_review_items | no | 20261030000030_iam_sod_privileged_reviews.up.sql |
| ix_iam_access_review_items_review | iam_access_review_items | no | 20261030000030_iam_sod_privileged_reviews.up.sql |
| ix_iam_access_review_items_assignment | iam_access_review_items | no | 20261030000030_iam_sod_privileged_reviews.up.sql |
| ix_iam_access_review_items_user | iam_access_review_items | no | 20261030000030_iam_sod_privileged_reviews.up.sql |
| ix_core_audit_chain_company | core_audit_chain | no | 20261030000032_audit_chain_security_events.up.sql |
| ix_core_security_events_company | core_security_events | no | 20261030000032_audit_chain_security_events.up.sql |
| ix_core_security_events_type | core_security_events | no | 20261030000032_audit_chain_security_events.up.sql |
| ux_core_security_events_source | core_security_events | yes | 20261030000032_audit_chain_security_events.up.sql |
| ux_core_route_registry_route | core_route_registry | yes | 20261030000034_security_route_registry_settings.up.sql |
| ix_core_route_registry_module | core_route_registry | no | 20261030000034_security_route_registry_settings.up.sql |
| ux_ui_user_preferences_person | ui_user_preferences | yes | 20261030000036_ui_user_preferences.up.sql |
| ix_ui_user_preferences_user | ui_user_preferences | no | 20261030000036_ui_user_preferences.up.sql |
| ux_ui_drafts_live | ui_drafts | yes | 20261030000038_ui_forms_and_drafts.up.sql |
| ix_ui_drafts_owner | ui_drafts | no | 20261030000038_ui_forms_and_drafts.up.sql |
| ix_ui_drafts_user | ui_drafts | no | 20261030000038_ui_forms_and_drafts.up.sql |
| ux_ui_form_metadata_code | ui_form_metadata | yes | 20261030000038_ui_forms_and_drafts.up.sql |
| ix_ui_form_metadata_company | ui_form_metadata | no | 20261030000038_ui_forms_and_drafts.up.sql |
| ux_ui_sample_requests_doc_no | ui_sample_requests | yes | 20261030000038_ui_forms_and_drafts.up.sql |
| ix_ui_sample_requests_status | ui_sample_requests | no | 20261030000038_ui_forms_and_drafts.up.sql |
| ix_ui_sample_requests_project | ui_sample_requests | no | 20261030000038_ui_forms_and_drafts.up.sql |
| ix_ui_sample_requests_site | ui_sample_requests | no | 20261030000038_ui_forms_and_drafts.up.sql |
| ix_ui_sample_requests_cost_centre | ui_sample_requests | no | 20261030000038_ui_forms_and_drafts.up.sql |
| ix_ui_sample_requests_department | ui_sample_requests | no | 20261030000038_ui_forms_and_drafts.up.sql |
| ix_ui_sample_requests_dup | ui_sample_requests | no | 20261030000038_ui_forms_and_drafts.up.sql |
| ix_ui_sample_request_lines_request | ui_sample_request_lines | no | 20261030000038_ui_forms_and_drafts.up.sql |
| ix_ui_sample_request_lines_company | ui_sample_request_lines | no | 20261030000038_ui_forms_and_drafts.up.sql |
| ux_ui_saved_views_name | ui_saved_views | yes | 20261030000040_ui_saved_views_and_exports.up.sql |
| ix_ui_saved_views_list | ui_saved_views | no | 20261030000040_ui_saved_views_and_exports.up.sql |
| ix_ui_saved_views_owner | ui_saved_views | no | 20261030000040_ui_saved_views_and_exports.up.sql |
| ix_ui_export_jobs_owner | ui_export_jobs | no | 20261030000040_ui_saved_views_and_exports.up.sql |
| ix_ui_export_jobs_status | ui_export_jobs | no | 20261030000040_ui_saved_views_and_exports.up.sql |
| ix_ui_export_jobs_user | ui_export_jobs | no | 20261030000040_ui_saved_views_and_exports.up.sql |
| ix_ui_record_comments_record | ui_record_comments | no | 20261030000042_ui_object_page.up.sql |
| ix_ui_record_comments_author | ui_record_comments | no | 20261030000042_ui_object_page.up.sql |
| ux_ui_record_versions_no | ui_record_versions | yes | 20261030000042_ui_object_page.up.sql |
| ux_ui_reason_codes_code | ui_reason_codes | yes | 20261030000042_ui_object_page.up.sql |
| ix_ui_reason_codes_company | ui_reason_codes | no | 20261030000042_ui_object_page.up.sql |
| ux_ui_required_documents_code | ui_required_documents | yes | 20261030000042_ui_object_page.up.sql |
| ix_ui_required_documents_company | ui_required_documents | no | 20261030000042_ui_object_page.up.sql |
| ux_ui_record_documents_link | ui_record_documents | yes | 20261030000042_ui_object_page.up.sql |
| ix_ui_record_documents_file | ui_record_documents | no | 20261030000042_ui_object_page.up.sql |
| ix_ui_record_documents_record | ui_record_documents | no | 20261030000042_ui_object_page.up.sql |
| ix_ui_navigation_parent | ui_navigation_entries | no | 20261030000044_ui_shell.up.sql |
| ix_ui_navigation_company | ui_navigation_entries | no | 20261030000044_ui_shell.up.sql |
| ux_ui_navigation_route | ui_navigation_entries | yes | 20261030000044_ui_shell.up.sql |
| ux_ui_favourites_ref | ui_favourites | yes | 20261030000044_ui_shell.up.sql |
| ix_ui_favourites_user | ui_favourites | no | 20261030000044_ui_shell.up.sql |
| ux_ui_recent_records_ref | ui_recent_records | yes | 20261030000044_ui_shell.up.sql |
| ix_ui_recent_records_user | ui_recent_records | no | 20261030000044_ui_shell.up.sql |
| ux_ui_user_context_user | ui_user_context | yes | 20261030000044_ui_shell.up.sql |
| ix_ui_user_context_project | ui_user_context | no | 20261030000044_ui_shell.up.sql |
| ix_ui_user_context_site | ui_user_context | no | 20261030000044_ui_shell.up.sql |
| ux_ui_push_subscriptions_endpoint | ui_push_subscriptions | yes | 20261030000046_ui_device.up.sql |
| ix_ui_push_subscriptions_user | ui_push_subscriptions | no | 20261030000046_ui_device.up.sql |
| ux_ui_field_tiles_code | ui_field_tiles | yes | 20261030000046_ui_device.up.sql |
| ix_ui_field_tiles_nav | ui_field_tiles | no | 20261030000046_ui_device.up.sql |
| ix_ui_field_tiles_company | ui_field_tiles | no | 20261030000046_ui_device.up.sql |
| ix_ui_widgets_module | ui_widgets | no | 20261030000048_ui_dashboards.up.sql |
| ix_ui_widgets_company | ui_widgets | no | 20261030000048_ui_dashboards.up.sql |
| ux_ui_dashboards_owner | ui_dashboards | yes | 20261030000048_ui_dashboards.up.sql |
| ix_ui_dashboards_company | ui_dashboards | no | 20261030000048_ui_dashboards.up.sql |
| ix_ui_dashboards_owner_ref | ui_dashboards | no | 20261030000048_ui_dashboards.up.sql |
| ux_core_search_index_record | core_search_index | yes | 20261102000050_core_search_index.up.sql |
| ix_core_search_index_code | core_search_index | no | 20261102000050_core_search_index.up.sql |
| ix_core_search_index_title | core_search_index | no | 20261102000050_core_search_index.up.sql |
| ix_core_search_index_scope | core_search_index | no | 20261102000050_core_search_index.up.sql |
| ix_core_search_index_status | core_search_index | no | 20261102000050_core_search_index.up.sql |
| ix_core_search_queries_company | core_search_queries | no | 20261102000050_core_search_index.up.sql |
| ix_core_search_queries_user | core_search_queries | no | 20261102000050_core_search_index.up.sql |
| ix_core_search_queries_norm | core_search_queries | no | 20261102000050_core_search_index.up.sql |
| ux_ui_translations_key | ui_translations | yes | 20261102000052_ui_translations.up.sql |
| ix_ui_translations_lang | ui_translations | no | 20261102000052_ui_translations.up.sql |
| ux_ui_locale_preferences_person | ui_locale_preferences | yes | 20261102000052_ui_translations.up.sql |
| ix_ui_page_migration_module | ui_page_migration | no | 20261102000054_ui_page_migration.up.sql |
| ix_ui_page_migration_status | ui_page_migration | no | 20261102000054_ui_page_migration.up.sql |
| ix_ui_page_migration_company | ui_page_migration | no | 20261102000054_ui_page_migration.up.sql |
| ux_ui_page_migration_new_route | ui_page_migration | yes | 20261102000054_ui_page_migration.up.sql |
| ix_ui_page_migration_old_route | ui_page_migration | no | 20261102000054_ui_page_migration.up.sql |
| ux_wf_definitions_version | wf_definitions | yes | 20261102000056_eng_workflow.up.sql |
| ux_wf_definitions_active | wf_definitions | yes | 20261102000056_eng_workflow.up.sql |
| ix_wf_definitions_activation | wf_definitions | no | 20261102000056_eng_workflow.up.sql |
| ix_wf_definitions_status | wf_definitions | no | 20261102000056_eng_workflow.up.sql |
| ix_wf_instances_doc | wf_instances | no | 20261102000056_eng_workflow.up.sql |
| ix_wf_instances_status | wf_instances | no | 20261102000056_eng_workflow.up.sql |
| ix_wf_instances_definition | wf_instances | no | 20261102000056_eng_workflow.up.sql |
| ix_wf_instances_submitter | wf_instances | no | 20261102000056_eng_workflow.up.sql |
| ix_wf_instances_previous | wf_instances | no | 20261102000056_eng_workflow.up.sql |
| ux_wf_instances_running | wf_instances | yes | 20261102000056_eng_workflow.up.sql |
| ix_wf_tasks_instance | wf_tasks | no | 20261102000056_eng_workflow.up.sql |
| ix_wf_tasks_user | wf_tasks | no | 20261102000056_eng_workflow.up.sql |
| ix_wf_tasks_role | wf_tasks | no | 20261102000056_eng_workflow.up.sql |
| ix_wf_tasks_due | wf_tasks | no | 20261102000056_eng_workflow.up.sql |
| ux_wf_task_attachments | wf_task_attachments | yes | 20261102000056_eng_workflow.up.sql |
| ix_wf_task_attachments_file | wf_task_attachments | no | 20261102000056_eng_workflow.up.sql |
| ix_wf_task_attachments_company_id | wf_task_attachments | no | 20261102000056_eng_workflow.up.sql |
| ix_wf_history_instance | wf_history | no | 20261102000056_eng_workflow.up.sql |
| ix_wf_history_company_id | wf_history | no | 20261102000056_eng_workflow.up.sql |
| ix_wf_history_task | wf_history | no | 20261102000056_eng_workflow.up.sql |
| ux_wf_watchers | wf_watchers | yes | 20261102000056_eng_workflow.up.sql |
| ix_wf_watchers_user | wf_watchers | no | 20261102000056_eng_workflow.up.sql |
| ux_eng_sample_docs_no | eng_sample_docs | yes | 20261102000056_eng_workflow.up.sql |
| ix_eng_sample_docs_status | eng_sample_docs | no | 20261102000056_eng_workflow.up.sql |
| ix_eng_sample_docs_instance | eng_sample_docs | no | 20261102000056_eng_workflow.up.sql |
| ix_eng_sample_docs_amends | eng_sample_docs | no | 20261102000056_eng_workflow.up.sql |
| ux_wf_matrix_version | wf_matrix | yes | 20261102000058_eng_approval_matrix.up.sql |
| ix_wf_matrix_resolve | wf_matrix | no | 20261102000058_eng_approval_matrix.up.sql |
| ix_wf_matrix_activation | wf_matrix | no | 20261102000058_eng_approval_matrix.up.sql |
| ux_wf_matrix_rules_priority | wf_matrix_rules | yes | 20261102000058_eng_approval_matrix.up.sql |
| ix_wf_matrix_rules_company | wf_matrix_rules | no | 20261102000058_eng_approval_matrix.up.sql |
| ix_wf_authority_resolve | wf_authority_limits | no | 20261102000058_eng_approval_matrix.up.sql |
| ix_wf_authority_batch | wf_authority_limits | no | 20261102000058_eng_approval_matrix.up.sql |
| ix_wf_delegations_delegate | wf_delegations | no | 20261102000058_eng_approval_matrix.up.sql |
| ix_wf_delegations_delegator | wf_delegations | no | 20261102000058_eng_approval_matrix.up.sql |
| ix_wf_delegations_instance | wf_delegations | no | 20261102000058_eng_approval_matrix.up.sql |
| ix_wf_escalation_resolve | wf_escalation_paths | no | 20261102000058_eng_approval_matrix.up.sql |
| ix_wf_escalation_batch | wf_escalation_paths | no | 20261102000058_eng_approval_matrix.up.sql |
| ix_wf_sla_resolve | wf_sla_settings | no | 20261102000058_eng_approval_matrix.up.sql |
| ix_wf_sla_batch | wf_sla_settings | no | 20261102000058_eng_approval_matrix.up.sql |
| ix_wf_policies_resolve | wf_approval_policies | no | 20261102000060_eng_approval_inbox.up.sql |
| ix_wf_policies_batch | wf_approval_policies | no | 20261102000060_eng_approval_inbox.up.sql |
| ux_wf_link_tokens_hash | wf_link_tokens | yes | 20261102000060_eng_approval_inbox.up.sql |
| ix_wf_link_tokens_task | wf_link_tokens | no | 20261102000060_eng_approval_inbox.up.sql |
| ix_wf_link_tokens_instance | wf_link_tokens | no | 20261102000060_eng_approval_inbox.up.sql |
| ix_wf_link_tokens_company | wf_link_tokens | no | 20261102000060_eng_approval_inbox.up.sql |
| ix_pcs_controls_module | pcs_control_points | no | 20261103000062_eng_protocol_control.up.sql |
| ix_pcs_results_control | pcs_check_results | no | 20261103000062_eng_protocol_control.up.sql |
| ix_pcs_results_entity | pcs_check_results | no | 20261103000062_eng_protocol_control.up.sql |
| ix_pcs_results_company | pcs_check_results | no | 20261103000062_eng_protocol_control.up.sql |
| ux_pcs_exceptions_no | pcs_exceptions | yes | 20261103000062_eng_protocol_control.up.sql |
| ux_pcs_exceptions_open | pcs_exceptions | yes | 20261103000062_eng_protocol_control.up.sql |
| ix_pcs_exceptions_control | pcs_exceptions | no | 20261103000062_eng_protocol_control.up.sql |
| ix_pcs_exceptions_status | pcs_exceptions | no | 20261103000062_eng_protocol_control.up.sql |
| ix_pcs_exceptions_user | pcs_exceptions | no | 20261103000062_eng_protocol_control.up.sql |
| ix_pcs_exceptions_instance | pcs_exceptions | no | 20261103000062_eng_protocol_control.up.sql |
| ix_pcs_exceptions_regularise | pcs_exceptions | no | 20261103000062_eng_protocol_control.up.sql |
| ux_pcs_reason_codes | pcs_reason_codes | yes | 20261103000062_eng_protocol_control.up.sql |
| ix_pcs_reason_codes_company | pcs_reason_codes | no | 20261103000062_eng_protocol_control.up.sql |
| ix_pcs_changes_control | pcs_control_changes | no | 20261103000062_eng_protocol_control.up.sql |
| ix_pcs_changes_company | pcs_control_changes | no | 20261103000062_eng_protocol_control.up.sql |
| ix_pcs_changes_instance | pcs_control_changes | no | 20261103000062_eng_protocol_control.up.sql |
| ux_pcs_cycle | pcs_cycle_stages | yes | 20261103000062_eng_protocol_control.up.sql |
| ix_pcs_cycle_company | pcs_cycle_stages | no | 20261103000062_eng_protocol_control.up.sql |
| ux_acc_templates | acc_raci_templates | yes | 20261103000064_eng_accountability.up.sql |
| ix_acc_templates_company | acc_raci_templates | no | 20261103000064_eng_accountability.up.sql |
| ix_acc_raci_scope | acc_raci_assignments | no | 20261103000064_eng_accountability.up.sql |
| ix_acc_raci_user | acc_raci_assignments | no | 20261103000064_eng_accountability.up.sql |
| ix_acc_raci_role | acc_raci_assignments | no | 20261103000064_eng_accountability.up.sql |
| ix_acc_raci_batch | acc_raci_assignments | no | 20261103000064_eng_accountability.up.sql |
| ix_acc_raci_instance | acc_raci_assignments | no | 20261103000064_eng_accountability.up.sql |
| ux_acc_ledger_source | acc_action_ledger | yes | 20261103000064_eng_accountability.up.sql |
| ix_acc_ledger_actor | acc_action_ledger | no | 20261103000064_eng_accountability.up.sql |
| ix_acc_ledger_project | acc_action_ledger | no | 20261103000064_eng_accountability.up.sql |
| ix_acc_ledger_entity | acc_action_ledger | no | 20261103000064_eng_accountability.up.sql |
| ix_acc_ledger_process | acc_action_ledger | no | 20261103000064_eng_accountability.up.sql |
| ix_acc_ledger_affected | acc_action_ledger | no | 20261103000064_eng_accountability.up.sql |
| ux_ntf_templates | ntf_templates | yes | 20261103000066_eng_notifications.up.sql |
| ix_ntf_templates_lookup | ntf_templates | no | 20261103000066_eng_notifications.up.sql |
| ix_ntf_templates_company | ntf_templates | no | 20261103000066_eng_notifications.up.sql |
| ix_ntf_templates_instance | ntf_templates | no | 20261103000066_eng_notifications.up.sql |
| ux_ntf_notifications_key | ntf_notifications | yes | 20261103000066_eng_notifications.up.sql |
| ix_ntf_notifications_user | ntf_notifications | no | 20261103000066_eng_notifications.up.sql |
| ix_ntf_notifications_category | ntf_notifications | no | 20261103000066_eng_notifications.up.sql |
| ux_ntf_preferences | ntf_preferences | yes | 20261103000066_eng_notifications.up.sql |
| ix_ntf_deliveries_notification | ntf_deliveries | no | 20261103000066_eng_notifications.up.sql |
| ix_ntf_deliveries_status | ntf_deliveries | no | 20261103000066_eng_notifications.up.sql |
| ix_ntf_deliveries_due | ntf_deliveries | no | 20261103000066_eng_notifications.up.sql |
| ix_ntf_deliveries_digest | ntf_deliveries | no | 20261103000066_eng_notifications.up.sql |
| ix_ntf_deliveries_digest_id | ntf_deliveries | no | 20261103000066_eng_notifications.up.sql |
| ix_ntf_realtime_room | ntf_realtime_events | no | 20261103000066_eng_notifications.up.sql |
| ix_ntf_realtime_time | ntf_realtime_events | no | 20261103000066_eng_notifications.up.sql |
| ix_comm_messages_queue | comm_messages | no | 20261103000068_eng_communication.up.sql |
| ix_comm_messages_company | comm_messages | no | 20261103000068_eng_communication.up.sql |
| ix_comm_messages_address | comm_messages | no | 20261103000068_eng_communication.up.sql |
| ix_comm_messages_related | comm_messages | no | 20261103000068_eng_communication.up.sql |
| ix_comm_messages_conversation | comm_messages | no | 20261103000068_eng_communication.up.sql |
| ix_comm_messages_provider | comm_messages | no | 20261103000068_eng_communication.up.sql |
| ix_comm_messages_log | comm_messages | no | 20261103000068_eng_communication.up.sql |
| ix_comm_messages_token | comm_messages | no | 20261103000068_eng_communication.up.sql |
| ix_comm_messages_contact | comm_messages | no | 20261103000068_eng_communication.up.sql |
| ux_comm_consents | comm_consents | yes | 20261103000068_eng_communication.up.sql |
| ix_comm_consents_contact | comm_consents | no | 20261103000068_eng_communication.up.sql |
| ix_comm_consents_status | comm_consents | no | 20261103000068_eng_communication.up.sql |
| ix_comm_otps_subject | comm_otps | no | 20261103000068_eng_communication.up.sql |
| ix_comm_otps_address | comm_otps | no | 20261103000068_eng_communication.up.sql |
| ix_comm_otps_message | comm_otps | no | 20261103000068_eng_communication.up.sql |
| ux_comm_channels | comm_channels | yes | 20261103000068_eng_communication.up.sql |
| ix_comm_channels_active | comm_channels | no | 20261103000068_eng_communication.up.sql |
| ix_comm_channels_batch | comm_channels | no | 20261103000068_eng_communication.up.sql |
| ix_comm_channels_instance | comm_channels | no | 20261103000068_eng_communication.up.sql |
| ux_comm_dlt | comm_dlt_templates | yes | 20261103000068_eng_communication.up.sql |
| ix_comm_dlt_active | comm_dlt_templates | no | 20261103000068_eng_communication.up.sql |
| ix_comm_dlt_batch | comm_dlt_templates | no | 20261103000068_eng_communication.up.sql |
| ux_comm_wa | comm_wa_templates | yes | 20261103000068_eng_communication.up.sql |
| ix_comm_wa_code | comm_wa_templates | no | 20261103000068_eng_communication.up.sql |
| ux_tsk_tasks_no | tsk_tasks | yes | 20261103000070_eng_tasks.up.sql |
| ix_tsk_tasks_list | tsk_tasks | no | 20261103000070_eng_tasks.up.sql |
| ix_tsk_tasks_log | tsk_tasks | no | 20261103000070_eng_tasks.up.sql |
| ix_tsk_tasks_record | tsk_tasks | no | 20261103000070_eng_tasks.up.sql |
| ix_tsk_tasks_project | tsk_tasks | no | 20261103000070_eng_tasks.up.sql |
| ix_tsk_tasks_department | tsk_tasks | no | 20261103000070_eng_tasks.up.sql |
| ix_tsk_tasks_assigner | tsk_tasks | no | 20261103000070_eng_tasks.up.sql |
| ix_tsk_tasks_series | tsk_tasks | no | 20261103000070_eng_tasks.up.sql |
| ix_tsk_tasks_source | tsk_tasks | no | 20261103000070_eng_tasks.up.sql |
| ux_tsk_assignees | tsk_assignees | yes | 20261103000070_eng_tasks.up.sql |
| ix_tsk_assignees_user | tsk_assignees | no | 20261103000070_eng_tasks.up.sql |
| ix_tsk_checklist_items_company_id | tsk_checklist_items | no | 20261103000070_eng_tasks.up.sql |
| ix_tsk_checklist_task | tsk_checklist_items | no | 20261103000070_eng_tasks.up.sql |
| ix_tsk_dependencies_company_id | tsk_dependencies | no | 20261103000070_eng_tasks.up.sql |
| ux_tsk_dependencies | tsk_dependencies | yes | 20261103000070_eng_tasks.up.sql |
| ix_tsk_dependencies_on | tsk_dependencies | no | 20261103000070_eng_tasks.up.sql |
| ix_tsk_comments_company_id | tsk_comments | no | 20261103000070_eng_tasks.up.sql |
| ix_tsk_comments_task | tsk_comments | no | 20261103000070_eng_tasks.up.sql |
| ix_tsk_escalations_company_id | tsk_escalations | no | 20261103000070_eng_tasks.up.sql |
| ix_tsk_escalations_task | tsk_escalations | no | 20261103000070_eng_tasks.up.sql |
| ix_tsk_routing_topic | tsk_routing_matrix | no | 20261103000070_eng_tasks.up.sql |
| ix_tsk_routing_department | tsk_routing_matrix | no | 20261103000070_eng_tasks.up.sql |
| ix_tsk_routing_batch | tsk_routing_matrix | no | 20261103000070_eng_tasks.up.sql |
| ux_alr_rules_version | alr_rules | yes | 20261103000072_eng_alerts.up.sql |
| ix_alr_rules_company | alr_rules | no | 20261103000072_eng_alerts.up.sql |
| ix_alr_rules_event | alr_rules | no | 20261103000072_eng_alerts.up.sql |
| ix_alr_rules_code | alr_rules | no | 20261103000072_eng_alerts.up.sql |
| ix_alr_alerts_company_id | alr_alerts | no | 20261103000072_eng_alerts.up.sql |
| ix_alr_alerts_list | alr_alerts | no | 20261103000072_eng_alerts.up.sql |
| ix_alr_alerts_key | alr_alerts | no | 20261103000072_eng_alerts.up.sql |
| ix_alr_alerts_owner | alr_alerts | no | 20261103000072_eng_alerts.up.sql |
| ix_alr_alerts_project | alr_alerts | no | 20261103000072_eng_alerts.up.sql |
| ix_alr_runs_company_id | alr_rule_runs | no | 20261103000072_eng_alerts.up.sql |
| ix_alr_runs_rule | alr_rule_runs | no | 20261103000072_eng_alerts.up.sql |
| ux_doc_types | doc_types | yes | 20261104000074_eng_documents.up.sql |
| ix_doc_types_company | doc_types | no | 20261104000074_eng_documents.up.sql |
| ix_doc_types_batch | doc_types | no | 20261104000074_eng_documents.up.sql |
| ux_doc_folder_templates | doc_folder_templates | yes | 20261104000074_eng_documents.up.sql |
| ix_doc_folder_templates_company | doc_folder_templates | no | 20261104000074_eng_documents.up.sql |
| ix_doc_folder_templates_batch | doc_folder_templates | no | 20261104000074_eng_documents.up.sql |
| ix_doc_folders_company_id | doc_folders | no | 20261104000074_eng_documents.up.sql |
| ix_doc_folders_project | doc_folders | no | 20261104000074_eng_documents.up.sql |
| ix_doc_folders_parent | doc_folders | no | 20261104000074_eng_documents.up.sql |
| ux_doc_folders_name | doc_folders | yes | 20261104000074_eng_documents.up.sql |
| ux_doc_documents_no | doc_documents | yes | 20261104000074_eng_documents.up.sql |
| ix_doc_documents_list | doc_documents | no | 20261104000074_eng_documents.up.sql |
| ix_doc_documents_log | doc_documents | no | 20261104000074_eng_documents.up.sql |
| ix_doc_documents_project | doc_documents | no | 20261104000074_eng_documents.up.sql |
| ix_doc_documents_folder | doc_documents | no | 20261104000074_eng_documents.up.sql |
| ix_doc_documents_owner | doc_documents | no | 20261104000074_eng_documents.up.sql |
| ix_doc_documents_valid | doc_documents | no | 20261104000074_eng_documents.up.sql |
| ix_doc_documents_checkout | doc_documents | no | 20261104000074_eng_documents.up.sql |
| ux_doc_versions_rev | doc_versions | yes | 20261104000074_eng_documents.up.sql |
| ix_doc_versions_company_id | doc_versions | no | 20261104000074_eng_documents.up.sql |
| ix_doc_versions_document | doc_versions | no | 20261104000074_eng_documents.up.sql |
| ix_doc_versions_file | doc_versions | no | 20261104000074_eng_documents.up.sql |
| ix_doc_versions_instance | doc_versions | no | 20261104000074_eng_documents.up.sql |
| ix_doc_versions_superseded_by | doc_versions | no | 20261104000074_eng_documents.up.sql |
| ix_doc_shares_company_id | doc_shares | no | 20261104000074_eng_documents.up.sql |
| ix_doc_shares_document | doc_shares | no | 20261104000074_eng_documents.up.sql |
| ix_doc_shares_principal | doc_shares | no | 20261104000074_eng_documents.up.sql |
| ux_doc_distributions | doc_distributions | yes | 20261104000074_eng_documents.up.sql |
| ix_doc_distributions_company_id | doc_distributions | no | 20261104000074_eng_documents.up.sql |
| ix_doc_distributions_document | doc_distributions | no | 20261104000074_eng_documents.up.sql |
| ix_doc_distributions_recipient | doc_distributions | no | 20261104000074_eng_documents.up.sql |
| ix_doc_annotations_company_id | doc_annotations | no | 20261104000074_eng_documents.up.sql |
| ix_doc_annotations_version | doc_annotations | no | 20261104000074_eng_documents.up.sql |
| ux_doc_links | doc_links | yes | 20261104000074_eng_documents.up.sql |
| ix_doc_links_company_id | doc_links | no | 20261104000074_eng_documents.up.sql |
| ix_doc_links_record | doc_links | no | 20261104000074_eng_documents.up.sql |
| ux_tpl_templates_version | tpl_templates | yes | 20261104000076_eng_templates.up.sql |
| ux_tpl_templates_active | tpl_templates | yes | 20261104000076_eng_templates.up.sql |
| ux_tpl_templates_open | tpl_templates | yes | 20261104000076_eng_templates.up.sql |
| ix_tpl_templates_company | tpl_templates | no | 20261104000076_eng_templates.up.sql |
| ix_tpl_templates_instance | tpl_templates | no | 20261104000076_eng_templates.up.sql |
| ux_tpl_records_key | tpl_records | yes | 20261104000076_eng_templates.up.sql |
| ux_tpl_records_doc_no | tpl_records | yes | 20261104000076_eng_templates.up.sql |
| ix_tpl_records_project | tpl_records | no | 20261104000076_eng_templates.up.sql |
| ux_tpl_generated_version | tpl_generated_docs | yes | 20261104000076_eng_templates.up.sql |
| ux_tpl_generated_verify | tpl_generated_docs | yes | 20261104000076_eng_templates.up.sql |
| ix_tpl_generated_template | tpl_generated_docs | no | 20261104000076_eng_templates.up.sql |
| ix_tpl_generated_file | tpl_generated_docs | no | 20261104000076_eng_templates.up.sql |
| ix_tpl_generated_list | tpl_generated_docs | no | 20261104000076_eng_templates.up.sql |
| ix_tpl_generated_project | tpl_generated_docs | no | 20261104000076_eng_templates.up.sql |
| ix_tpl_generated_bulk | tpl_generated_docs | no | 20261104000076_eng_templates.up.sql |
| ix_tpl_generated_superseded | tpl_generated_docs | no | 20261104000076_eng_templates.up.sql |
| ix_tpl_deliveries_doc | tpl_deliveries | no | 20261104000076_eng_templates.up.sql |
| ix_tpl_deliveries_company | tpl_deliveries | no | 20261104000076_eng_templates.up.sql |
| ix_tpl_deliveries_message | tpl_deliveries | no | 20261104000076_eng_templates.up.sql |
| ix_tpl_bulk_company | tpl_bulk_jobs | no | 20261104000076_eng_templates.up.sql |
| ix_tpl_bulk_job | tpl_bulk_jobs | no | 20261104000076_eng_templates.up.sql |
| ux_tpl_auto_rules | tpl_auto_rules | yes | 20261104000076_eng_templates.up.sql |
| ux_sig_signatures_signer | sig_signatures | yes | 20261104000078_eng_signatures.up.sql |
| ix_sig_signatures_doc | sig_signatures | no | 20261104000078_eng_signatures.up.sql |
| ix_sig_signatures_user | sig_signatures | no | 20261104000078_eng_signatures.up.sql |
| ix_sig_signatures_list | sig_signatures | no | 20261104000078_eng_signatures.up.sql |
| ix_sig_signatures_filter | sig_signatures | no | 20261104000078_eng_signatures.up.sql |
| ix_sig_signatures_project | sig_signatures | no | 20261104000078_eng_signatures.up.sql |
| ix_sig_copies_company_id | sig_copies | no | 20261104000078_eng_signatures.up.sql |
| ix_sig_copies_doc | sig_copies | no | 20261104000078_eng_signatures.up.sql |
| ix_sig_copies_file | sig_copies | no | 20261104000078_eng_signatures.up.sql |
| ix_sig_copies_hash | sig_copies | no | 20261104000078_eng_signatures.up.sql |
| ux_sig_verifications_code | sig_verifications | yes | 20261104000078_eng_signatures.up.sql |
| ux_sig_verifications_doc | sig_verifications | yes | 20261104000078_eng_signatures.up.sql |
| ix_sig_verifications_company | sig_verifications | no | 20261104000078_eng_signatures.up.sql |
| ux_sig_profiles_user | sig_profiles | yes | 20261104000078_eng_signatures.up.sql |
| ux_sig_config_version | sig_config | yes | 20261104000078_eng_signatures.up.sql |
| ux_sig_config_active | sig_config | yes | 20261104000078_eng_signatures.up.sql |
| ix_sig_config_instance | sig_config | no | 20261104000078_eng_signatures.up.sql |
| ux_xl_templates_version | xl_templates | yes | 20261104000080_eng_excel_engine.up.sql |
| ux_xl_templates_active | xl_templates | yes | 20261104000080_eng_excel_engine.up.sql |
| ux_xl_templates_pending | xl_templates | yes | 20261104000080_eng_excel_engine.up.sql |
| ix_xl_templates_instance | xl_templates | no | 20261104000080_eng_excel_engine.up.sql |
| ix_xl_jobs_company_id | xl_jobs | no | 20261104000080_eng_excel_engine.up.sql |
| ix_xl_jobs_file | xl_jobs | no | 20261104000080_eng_excel_engine.up.sql |
| ix_xl_jobs_list | xl_jobs | no | 20261104000080_eng_excel_engine.up.sql |
| ix_xl_jobs_filter | xl_jobs | no | 20261104000080_eng_excel_engine.up.sql |
| ix_xl_jobs_user | xl_jobs | no | 20261104000080_eng_excel_engine.up.sql |
| ix_xl_job_errors_company_id | xl_job_errors | no | 20261104000080_eng_excel_engine.up.sql |
| ix_xl_job_errors_job | xl_job_errors | no | 20261104000080_eng_excel_engine.up.sql |
| ix_col_comments_record | col_comments | no | 20261104000082_eng_collaboration.up.sql |
| ix_col_comments_parent | col_comments | no | 20261104000082_eng_collaboration.up.sql |
| ix_col_comments_project | col_comments | no | 20261104000082_eng_collaboration.up.sql |
| ux_col_mentions_comment_user | col_mentions | yes | 20261104000082_eng_collaboration.up.sql |
| ix_col_mentions_inbox | col_mentions | no | 20261104000082_eng_collaboration.up.sql |
| ux_col_reactions_one | col_reactions | yes | 20261104000082_eng_collaboration.up.sql |
| ux_col_trace_pair | col_trace_links | yes | 20261104000082_eng_collaboration.up.sql |
| ix_col_trace_from | col_trace_links | no | 20261104000082_eng_collaboration.up.sql |
| ix_col_trace_to | col_trace_links | no | 20261104000082_eng_collaboration.up.sql |
| ix_col_reactions_company_id | col_reactions | no | 20261104000082_eng_collaboration.up.sql |
| ux_off_devices_user_device | off_devices | yes | 20261104000084_eng_offline.up.sql |
| ix_off_devices_user | off_devices | no | 20261104000084_eng_offline.up.sql |
| ux_off_sync_command | off_sync_log | yes | 20261104000084_eng_offline.up.sql |
| ix_off_sync_device | off_sync_log | no | 20261104000084_eng_offline.up.sql |
| ix_off_sync_user | off_sync_log | no | 20261104000084_eng_offline.up.sql |
| ix_off_sync_status | off_sync_log | no | 20261104000084_eng_offline.up.sql |
| ix_off_sync_ref | off_sync_log | no | 20261104000084_eng_offline.up.sql |
| ix_off_sync_entity | off_sync_log | no | 20261104000084_eng_offline.up.sql |
| ux_off_uploads_id | off_uploads | yes | 20261104000084_eng_offline.up.sql |
| ix_off_uploads_device | off_uploads | no | 20261104000084_eng_offline.up.sql |
| ix_off_uploads_command | off_uploads | no | 20261104000084_eng_offline.up.sql |
| ix_off_uploads_file | off_uploads | no | 20261104000084_eng_offline.up.sql |
| ix_off_uploads_company_id | off_uploads | no | 20261104000084_eng_offline.up.sql |
| ix_off_sync_log_company_id | off_sync_log | no | 20261104000084_eng_offline.up.sql |
| ix_off_devices_company_id | off_devices | no | 20261104000084_eng_offline.up.sql |
| ux_msg_conv_direct | msg_conversations | yes | 20261104000086_msg_conversations.up.sql |
| ux_msg_conv_record | msg_conversations | yes | 20261104000086_msg_conversations.up.sql |
| ux_msg_conv_external | msg_conversations | yes | 20261104000086_msg_conversations.up.sql |
| ux_msg_conv_place | msg_conversations | yes | 20261104000086_msg_conversations.up.sql |
| ix_msg_conv_activity | msg_conversations | no | 20261104000086_msg_conversations.up.sql |
| ix_msg_conv_project | msg_conversations | no | 20261104000086_msg_conversations.up.sql |
| ix_msg_conv_department | msg_conversations | no | 20261104000086_msg_conversations.up.sql |
| ux_msg_members_conv_user | msg_members | yes | 20261104000086_msg_conversations.up.sql |
| ix_msg_members_user | msg_members | no | 20261104000086_msg_conversations.up.sql |
| ix_msg_members_company_id | msg_members | no | 20261104000086_msg_conversations.up.sql |
| ix_msg_messages_conv | msg_messages | no | 20261104000086_msg_conversations.up.sql |
| ux_msg_messages_client | msg_messages | yes | 20261104000086_msg_conversations.up.sql |
| ix_msg_messages_reply | msg_messages | no | 20261104000086_msg_conversations.up.sql |
| ix_msg_messages_forward | msg_messages | no | 20261104000086_msg_conversations.up.sql |
| ix_msg_messages_company_id | msg_messages | no | 20261104000086_msg_conversations.up.sql |
| ux_msg_reactions_one | msg_reactions | yes | 20261104000086_msg_conversations.up.sql |
| ix_msg_reactions_company_id | msg_reactions | no | 20261104000086_msg_conversations.up.sql |
| ux_msg_receipts_one | msg_receipts | yes | 20261104000088_msg_features.up.sql |
| ix_msg_receipts_user | msg_receipts | no | 20261104000088_msg_features.up.sql |
| ux_msg_stars_one | msg_stars | yes | 20261104000088_msg_features.up.sql |
| ix_msg_stars_user | msg_stars | no | 20261104000088_msg_features.up.sql |
| ux_msg_pins_one | msg_pins | yes | 20261104000088_msg_features.up.sql |
| ix_msg_pins_message | msg_pins | no | 20261104000088_msg_features.up.sql |
| ix_msg_pins_company_id | msg_pins | no | 20261104000088_msg_features.up.sql |
| ux_msg_hidden_one | msg_hidden | yes | 20261104000088_msg_features.up.sql |
| ix_msg_hidden_company_id | msg_hidden | no | 20261104000088_msg_features.up.sql |
| ux_msg_voice_message | msg_voice | yes | 20261104000088_msg_features.up.sql |
| ix_msg_voice_company_id | msg_voice | no | 20261104000088_msg_features.up.sql |
| ux_msg_user_settings_one | msg_user_settings | yes | 20261104000088_msg_features.up.sql |
| ux_msg_presence_one | msg_presence | yes | 20261104000088_msg_features.up.sql |
| ux_msg_holds_active | msg_holds | yes | 20261104000088_msg_features.up.sql |
| ix_msg_holds_company_id | msg_holds | no | 20261104000088_msg_features.up.sql |
| ix_msg_periods_member | msg_member_periods | no | 20261104000088_msg_features.up.sql |
| ix_msg_periods_company_id | msg_member_periods | no | 20261104000088_msg_features.up.sql |
| ix_msg_calls_conv | msg_calls | no | 20261104000088_msg_features.up.sql |
| ix_msg_calls_company | msg_calls | no | 20261104000088_msg_features.up.sql |
| ux_msg_config_version | msg_config | yes | 20261104000088_msg_features.up.sql |
| ux_msg_config_active | msg_config | yes | 20261104000088_msg_features.up.sql |
| ux_msg_config_pending | msg_config | yes | 20261104000088_msg_features.up.sql |
| ix_msg_config_instance | msg_config | no | 20261104000088_msg_features.up.sql |
| ix_msg_calls_company_id | msg_calls | no | 20261104000088_msg_features.up.sql |
| ix_msg_user_settings_company_id | msg_user_settings | no | 20261104000088_msg_features.up.sql |
| ux_sec_devices_no | sec_devices | yes | 20261104000090_sec_messaging.up.sql |
| ix_sec_devices_user | sec_devices | no | 20261104000090_sec_messaging.up.sql |
| ix_sec_devices_company_id | sec_devices | no | 20261104000090_sec_messaging.up.sql |
| ux_sec_prekeys_key | sec_prekeys | yes | 20261104000090_sec_messaging.up.sql |
| ix_sec_prekeys_free | sec_prekeys | no | 20261104000090_sec_messaging.up.sql |
| ix_sec_prekeys_company_id | sec_prekeys | no | 20261104000090_sec_messaging.up.sql |
| ux_sec_conv_conversation | sec_conversations | yes | 20261104000090_sec_messaging.up.sql |
| ux_sec_conv_pair | sec_conversations | yes | 20261104000090_sec_messaging.up.sql |
| ix_sec_conv_company_id | sec_conversations | no | 20261104000090_sec_messaging.up.sql |
| ux_sec_env_one | sec_envelopes | yes | 20261104000090_sec_messaging.up.sql |
| ix_sec_env_device | sec_envelopes | no | 20261104000090_sec_messaging.up.sql |
| ix_sec_env_sender | sec_envelopes | no | 20261104000090_sec_messaging.up.sql |
| ix_sec_env_unread | sec_envelopes | no | 20261104000090_sec_messaging.up.sql |
| ix_sec_env_expiry | sec_envelopes | no | 20261104000090_sec_messaging.up.sql |
| ix_sec_env_conversation | sec_envelopes | no | 20261104000090_sec_messaging.up.sql |
| ix_sec_env_company_id | sec_envelopes | no | 20261104000090_sec_messaging.up.sql |
| ux_sec_policy_version | sec_policy | yes | 20261104000090_sec_messaging.up.sql |
| ix_sec_policy_status | sec_policy | no | 20261104000090_sec_messaging.up.sql |
| ux_sec_review_version | sec_licence_reviews | yes | 20261104000090_sec_messaging.up.sql |
| ix_sec_review_status | sec_licence_reviews | no | 20261104000090_sec_messaging.up.sql |
| ux_oss_component | oss_register | yes | 20261104000090_sec_messaging.up.sql |
| ix_oss_status | oss_register | no | 20261104000090_sec_messaging.up.sql |
| ix_oss_review | oss_register | no | 20261104000090_sec_messaging.up.sql |
| ix_msg_rules_status | msg_auto_group_rules | no | 20261104000092_msg_comcenter.up.sql |
| ix_msg_rules_company_id | msg_auto_group_rules | no | 20261104000092_msg_comcenter.up.sql |
| ux_msg_links_rule_scope | msg_auto_group_links | yes | 20261104000092_msg_comcenter.up.sql |
| ix_msg_links_conversation | msg_auto_group_links | no | 20261104000092_msg_comcenter.up.sql |
| ix_msg_links_company_id | msg_auto_group_links | no | 20261104000092_msg_comcenter.up.sql |
| ux_msg_instr_message | msg_instructions | yes | 20261104000092_msg_comcenter.up.sql |
| ix_msg_instr_conversation | msg_instructions | no | 20261104000092_msg_comcenter.up.sql |
| ix_msg_instr_list | msg_instructions | no | 20261104000092_msg_comcenter.up.sql |
| ix_msg_instr_sender | msg_instructions | no | 20261104000092_msg_comcenter.up.sql |
| ux_msg_ack_one | msg_acknowledgements | yes | 20261104000092_msg_comcenter.up.sql |
| ix_msg_ack_user | msg_acknowledgements | no | 20261104000092_msg_comcenter.up.sql |
| ix_msg_ack_company_id | msg_acknowledgements | no | 20261104000092_msg_comcenter.up.sql |
| ix_msg_ann_status | msg_announcements | no | 20261104000092_msg_comcenter.up.sql |
| ix_msg_ann_sender | msg_announcements | no | 20261104000092_msg_comcenter.up.sql |
| ux_msg_annread_one | msg_announcement_reads | yes | 20261104000092_msg_comcenter.up.sql |
| ix_msg_annread_user | msg_announcement_reads | no | 20261104000092_msg_comcenter.up.sql |
| ix_msg_annread_company_id | msg_announcement_reads | no | 20261104000092_msg_comcenter.up.sql |
| ix_msg_esc_status | msg_escalations | no | 20261104000092_msg_comcenter.up.sql |
| ix_msg_esc_conversation | msg_escalations | no | 20261104000092_msg_comcenter.up.sql |
| ix_msg_esc_message | msg_escalations | no | 20261104000092_msg_comcenter.up.sql |
| ix_msg_actions_message | msg_actions | no | 20261104000092_msg_comcenter.up.sql |
| ix_msg_actions_conversation | msg_actions | no | 20261104000092_msg_comcenter.up.sql |
| ix_msg_actions_company_id | msg_actions | no | 20261104000092_msg_comcenter.up.sql |
| ux_pol_policy_no | pol_policies | yes | 20261104000094_pol_policies.up.sql |
| ix_pol_policy_list | pol_policies | no | 20261104000094_pol_policies.up.sql |
| ix_pol_policy_owner | pol_policies | no | 20261104000094_pol_policies.up.sql |
| ix_pol_policy_department | pol_policies | no | 20261104000094_pol_policies.up.sql |
| ix_pol_policy_review | pol_policies | no | 20261104000094_pol_policies.up.sql |
| ux_pol_version_no | pol_versions | yes | 20261104000094_pol_policies.up.sql |
| ix_pol_version_status | pol_versions | no | 20261104000094_pol_policies.up.sql |
| ix_pol_version_company_id | pol_versions | no | 20261104000094_pol_policies.up.sql |
| ux_pol_ack_one | pol_acknowledgements | yes | 20261104000094_pol_policies.up.sql |
| ix_pol_ack_user | pol_acknowledgements | no | 20261104000094_pol_policies.up.sql |
| ix_pol_ack_due | pol_acknowledgements | no | 20261104000094_pol_policies.up.sql |
| ix_pol_req_version | pol_requirements | no | 20261104000094_pol_policies.up.sql |
| ix_pol_req_status | pol_requirements | no | 20261104000094_pol_policies.up.sql |
| ux_mdm_record_code | mdm_records | yes | 20261105000096_mdm_governance.up.sql |
| ix_mdm_record_list | mdm_records | no | 20261105000096_mdm_governance.up.sql |
| ix_mdm_record_name | mdm_records | no | 20261105000096_mdm_governance.up.sql |
| ix_mdm_record_merged | mdm_records | no | 20261105000096_mdm_governance.up.sql |
| ix_mdm_cr_list | mdm_change_requests | no | 20261105000096_mdm_governance.up.sql |
| ix_mdm_cr_record | mdm_change_requests | no | 20261105000096_mdm_governance.up.sql |
| ix_mdm_cr_target | mdm_change_requests | no | 20261105000096_mdm_governance.up.sql |
| ix_mdm_cr_requester | mdm_change_requests | no | 20261105000096_mdm_governance.up.sql |
| ux_mdm_version_no | mdm_record_versions | yes | 20261105000096_mdm_governance.up.sql |
| ix_mdm_version_asof | mdm_record_versions | no | 20261105000096_mdm_governance.up.sql |
| ix_mdm_version_cr | mdm_record_versions | no | 20261105000096_mdm_governance.up.sql |
| ix_mdm_version_due | mdm_record_versions | no | 20261105000096_mdm_governance.up.sql |
| ux_mdm_dup_pair | mdm_duplicates | yes | 20261105000096_mdm_governance.up.sql |
| ix_mdm_dup_status | mdm_duplicates | no | 20261105000096_mdm_governance.up.sql |
| ix_mdm_dup_a | mdm_duplicates | no | 20261105000096_mdm_governance.up.sql |
| ix_mdm_dup_b | mdm_duplicates | no | 20261105000096_mdm_governance.up.sql |
| ux_mdm_merge_from | mdm_merge_map | yes | 20261105000096_mdm_governance.up.sql |
| ix_mdm_merge_to | mdm_merge_map | no | 20261105000096_mdm_governance.up.sql |
| ix_mdm_merge_cr | mdm_merge_map | no | 20261105000096_mdm_governance.up.sql |
| ix_mdm_merge_company_id | mdm_merge_map | no | 20261105000096_mdm_governance.up.sql |
| ix_mdm_rules_status | mdm_quality_rules | no | 20261105000096_mdm_governance.up.sql |
| ix_mdm_rules_version | mdm_quality_rules | no | 20261105000096_mdm_governance.up.sql |
| ix_mdm_stewards_status | mdm_stewards | no | 20261105000096_mdm_governance.up.sql |
| ix_mdm_stewards_user | mdm_stewards | no | 20261105000096_mdm_governance.up.sql |
| ix_mdm_stewards_version | mdm_stewards | no | 20261105000096_mdm_governance.up.sql |
| ux_mdm_uoms_key | mdm_uoms | yes | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_uoms_company | mdm_uoms | no | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_uoms_cr | mdm_uoms | no | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_uoms_category | mdm_uoms | no | 20261105000098_mdm_common_masters.up.sql |
| ux_mdm_gst_rates_key | mdm_gst_rates | yes | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_gst_rates_company | mdm_gst_rates | no | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_gst_rates_cr | mdm_gst_rates | no | 20261105000098_mdm_common_masters.up.sql |
| ux_mdm_hsn_sac_key | mdm_hsn_sac | yes | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_hsn_sac_company | mdm_hsn_sac | no | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_hsn_sac_cr | mdm_hsn_sac | no | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_hsn_sac_code_type | mdm_hsn_sac | no | 20261105000098_mdm_common_masters.up.sql |
| ux_mdm_tds_sections_key | mdm_tds_sections | yes | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_tds_sections_company | mdm_tds_sections | no | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_tds_sections_cr | mdm_tds_sections | no | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_tds_sections_tax_kind | mdm_tds_sections | no | 20261105000098_mdm_common_masters.up.sql |
| ux_mdm_states_key | mdm_states | yes | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_states_company | mdm_states | no | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_states_cr | mdm_states | no | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_states_gst_code | mdm_states | no | 20261105000098_mdm_common_masters.up.sql |
| ux_mdm_districts_key | mdm_districts | yes | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_districts_company | mdm_districts | no | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_districts_cr | mdm_districts | no | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_districts_state_code | mdm_districts | no | 20261105000098_mdm_common_masters.up.sql |
| ux_mdm_currencies_key | mdm_currencies | yes | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_currencies_company | mdm_currencies | no | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_currencies_cr | mdm_currencies | no | 20261105000098_mdm_common_masters.up.sql |
| ux_mdm_exchange_rates_key | mdm_exchange_rates | yes | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_exchange_rates_company | mdm_exchange_rates | no | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_exchange_rates_cr | mdm_exchange_rates | no | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_exchange_rates_fx_date | mdm_exchange_rates | no | 20261105000098_mdm_common_masters.up.sql |
| ux_mdm_banks_key | mdm_banks | yes | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_banks_company | mdm_banks | no | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_banks_cr | mdm_banks | no | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_banks_bank_name | mdm_banks | no | 20261105000098_mdm_common_masters.up.sql |
| ux_mdm_payment_terms_key | mdm_payment_terms | yes | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_payment_terms_company | mdm_payment_terms | no | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_payment_terms_cr | mdm_payment_terms | no | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_payment_terms_term_kind | mdm_payment_terms | no | 20261105000098_mdm_common_masters.up.sql |
| ux_mdm_lookup_lists_key | mdm_lookup_lists | yes | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_lookup_lists_company | mdm_lookup_lists | no | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_lookup_lists_cr | mdm_lookup_lists | no | 20261105000098_mdm_common_masters.up.sql |
| ux_mdm_lookups_key | mdm_lookups | yes | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_lookups_company | mdm_lookups | no | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_lookups_cr | mdm_lookups | no | 20261105000098_mdm_common_masters.up.sql |
| ix_mdm_lookups_list_code | mdm_lookups | no | 20261105000098_mdm_common_masters.up.sql |
| ux_mdm_item_categories_code | mdm_item_categories | yes | 20261105000100_mdm_items.up.sql |
| ix_mdm_item_categories_parent | mdm_item_categories | no | 20261105000100_mdm_items.up.sql |
| ix_mdm_item_categories_company | mdm_item_categories | no | 20261105000100_mdm_items.up.sql |
| ux_mdm_items_code | mdm_items | yes | 20261105000100_mdm_items.up.sql |
| ix_mdm_items_list | mdm_items | no | 20261105000100_mdm_items.up.sql |
| ix_mdm_items_category | mdm_items | no | 20261105000100_mdm_items.up.sql |
| ix_mdm_items_spec | mdm_items | no | 20261105000100_mdm_items.up.sql |
| ix_mdm_items_supersedes | mdm_items | no | 20261105000100_mdm_items.up.sql |
| ix_mdm_items_name | mdm_items | no | 20261105000100_mdm_items.up.sql |
| ux_mdm_item_uoms | mdm_item_uoms | yes | 20261105000100_mdm_items.up.sql |
| ix_mdm_item_uoms_company | mdm_item_uoms | no | 20261105000100_mdm_items.up.sql |
| ix_mdm_item_resources_parent | mdm_item_resources | no | 20261105000100_mdm_items.up.sql |
| ix_mdm_item_resources_component | mdm_item_resources | no | 20261105000100_mdm_items.up.sql |
| ix_mdm_item_resources_company | mdm_item_resources | no | 20261105000100_mdm_items.up.sql |
| ix_mdm_item_makes_item | mdm_item_makes | no | 20261105000100_mdm_items.up.sql |
| ix_mdm_item_makes_company | mdm_item_makes | no | 20261105000100_mdm_items.up.sql |
| ux_mdm_item_alternates | mdm_item_alternates | yes | 20261105000100_mdm_items.up.sql |
| ix_mdm_item_alternates_alt | mdm_item_alternates | no | 20261105000100_mdm_items.up.sql |
| ix_mdm_item_alternates_company | mdm_item_alternates | no | 20261105000100_mdm_items.up.sql |
| ux_mdm_item_code_counters | mdm_item_code_counters | yes | 20261105000100_mdm_items.up.sql |
| ix_mdm_item_code_counters_category | mdm_item_code_counters | no | 20261105000100_mdm_items.up.sql |
| ux_mdm_item_user_marks | mdm_item_user_marks | yes | 20261105000100_mdm_items.up.sql |
| ix_mdm_item_user_marks_item | mdm_item_user_marks | no | 20261105000100_mdm_items.up.sql |
| ix_mdm_item_user_marks_user | mdm_item_user_marks | no | 20261105000100_mdm_items.up.sql |
| ux_mdm_item_legacy_map | mdm_item_legacy_map | yes | 20261105000100_mdm_items.up.sql |
| ix_mdm_item_legacy_map_item | mdm_item_legacy_map | no | 20261105000100_mdm_items.up.sql |
| ux_mdm_partners_code | mdm_partners | yes | 20261105000102_mdm_partners.up.sql |
| ix_mdm_partners_list | mdm_partners | no | 20261105000102_mdm_partners.up.sql |
| ix_mdm_partners_pan | mdm_partners | no | 20261105000102_mdm_partners.up.sql |
| ix_mdm_partners_name | mdm_partners | no | 20261105000102_mdm_partners.up.sql |
| ux_mdm_partner_roles | mdm_partner_roles | yes | 20261105000102_mdm_partners.up.sql |
| ix_mdm_partner_roles_role | mdm_partner_roles | no | 20261105000102_mdm_partners.up.sql |
| ix_mdm_partner_gstins_partner | mdm_partner_gstins | no | 20261105000102_mdm_partners.up.sql |
| ix_mdm_partner_gstins_gstin | mdm_partner_gstins | no | 20261105000102_mdm_partners.up.sql |
| ix_mdm_partner_addresses_partner | mdm_partner_addresses | no | 20261105000102_mdm_partners.up.sql |
| ix_mdm_partner_addresses_company | mdm_partner_addresses | no | 20261105000102_mdm_partners.up.sql |
| ix_mdm_partner_contacts_partner | mdm_partner_contacts | no | 20261105000102_mdm_partners.up.sql |
| ix_mdm_partner_contacts_mobile | mdm_partner_contacts | no | 20261105000102_mdm_partners.up.sql |
| ix_mdm_partner_contacts_portal | mdm_partner_contacts | no | 20261105000102_mdm_partners.up.sql |
| ix_mdm_partner_banks_partner | mdm_partner_banks | no | 20261105000102_mdm_partners.up.sql |
| ix_mdm_partner_banks_hash | mdm_partner_banks | no | 20261105000102_mdm_partners.up.sql |
| ix_mdm_partner_documents_partner | mdm_partner_documents | no | 20261105000102_mdm_partners.up.sql |
| ix_mdm_partner_documents_expiry | mdm_partner_documents | no | 20261105000102_mdm_partners.up.sql |
| ix_mdm_partner_tds_partner | mdm_partner_tds | no | 20261105000102_mdm_partners.up.sql |
| ix_mdm_partner_tds_company | mdm_partner_tds | no | 20261105000102_mdm_partners.up.sql |
| ix_mdm_partner_status_requests_partner | mdm_partner_status_requests | no | 20261105000102_mdm_partners.up.sql |
| ix_mdm_partner_status_requests_list | mdm_partner_status_requests | no | 20261105000102_mdm_partners.up.sql |
| ux_fin_account_groups_code | fin_account_groups | yes | 20261105000104_fin_chart_of_accounts.up.sql |
| ix_fin_account_groups_parent | fin_account_groups | no | 20261105000104_fin_chart_of_accounts.up.sql |
| ix_fin_account_groups_company | fin_account_groups | no | 20261105000104_fin_chart_of_accounts.up.sql |
| ux_fin_accounts_code | fin_accounts | yes | 20261105000104_fin_chart_of_accounts.up.sql |
| ix_fin_accounts_group | fin_accounts | no | 20261105000104_fin_chart_of_accounts.up.sql |
| ix_fin_accounts_list | fin_accounts | no | 20261105000104_fin_chart_of_accounts.up.sql |
| ux_fin_cost_heads_code | fin_cost_heads | yes | 20261105000104_fin_chart_of_accounts.up.sql |
| ix_fin_cost_heads_parent | fin_cost_heads | no | 20261105000104_fin_chart_of_accounts.up.sql |
| ix_fin_cost_heads_account | fin_cost_heads | no | 20261105000104_fin_chart_of_accounts.up.sql |
| ix_fin_cost_heads_company | fin_cost_heads | no | 20261105000104_fin_chart_of_accounts.up.sql |
| ux_fin_cost_codes_code | fin_cost_codes | yes | 20261105000104_fin_chart_of_accounts.up.sql |
| ix_fin_cost_codes_head | fin_cost_codes | no | 20261105000104_fin_chart_of_accounts.up.sql |
| ix_fin_cost_codes_company | fin_cost_codes | no | 20261105000104_fin_chart_of_accounts.up.sql |
| ux_fin_dimension_rules | fin_dimension_rules | yes | 20261105000104_fin_chart_of_accounts.up.sql |
| ix_fin_dimension_rules_company | fin_dimension_rules | no | 20261105000104_fin_chart_of_accounts.up.sql |
| ix_fin_category_mappings_category | fin_category_mappings | no | 20261105000104_fin_chart_of_accounts.up.sql |
| ix_fin_category_mappings_company | fin_category_mappings | no | 20261105000104_fin_chart_of_accounts.up.sql |
| ix_fin_category_mappings_inv | fin_category_mappings | no | 20261105000104_fin_chart_of_accounts.up.sql |
| ix_fin_category_mappings_exp | fin_category_mappings | no | 20261105000104_fin_chart_of_accounts.up.sql |
| ix_fin_category_mappings_cc | fin_category_mappings | no | 20261105000104_fin_chart_of_accounts.up.sql |
| ix_fin_master_changes_list | fin_master_changes | no | 20261105000104_fin_chart_of_accounts.up.sql |
| ix_fin_master_changes_entity | fin_master_changes | no | 20261105000104_fin_chart_of_accounts.up.sql |
| ix_ra_resource_rates_item | ra_resource_rates | no | 20261105000106_mdm_rate_analysis.up.sql |
| ix_ra_resource_rates_list | ra_resource_rates | no | 20261105000106_mdm_rate_analysis.up.sql |
| ix_ra_resource_rates_project | ra_resource_rates | no | 20261105000106_mdm_rate_analysis.up.sql |
| ux_ra_sor_books_code | ra_sor_books | yes | 20261105000106_mdm_rate_analysis.up.sql |
| ix_ra_sor_books_list | ra_sor_books | no | 20261105000106_mdm_rate_analysis.up.sql |
| ix_ra_sor_books_supersedes | ra_sor_books | no | 20261105000106_mdm_rate_analysis.up.sql |
| ux_ra_sor_items_code | ra_sor_items | yes | 20261105000106_mdm_rate_analysis.up.sql |
| ix_ra_sor_items_company | ra_sor_items | no | 20261105000106_mdm_rate_analysis.up.sql |
| ux_ra_analyses_no | ra_analyses | yes | 20261105000106_mdm_rate_analysis.up.sql |
| ix_ra_analyses_list | ra_analyses | no | 20261105000106_mdm_rate_analysis.up.sql |
| ix_ra_analyses_item | ra_analyses | no | 20261105000106_mdm_rate_analysis.up.sql |
| ix_ra_analyses_sor | ra_analyses | no | 20261105000106_mdm_rate_analysis.up.sql |
| ix_ra_analyses_supersedes | ra_analyses | no | 20261105000106_mdm_rate_analysis.up.sql |
| ix_ra_analyses_project | ra_analyses | no | 20261105000106_mdm_rate_analysis.up.sql |
| ix_ra_analysis_lines_analysis | ra_analysis_lines | no | 20261105000106_mdm_rate_analysis.up.sql |
| ix_ra_analysis_lines_item | ra_analysis_lines | no | 20261105000106_mdm_rate_analysis.up.sql |
| ix_ra_analysis_lines_rate | ra_analysis_lines | no | 20261105000106_mdm_rate_analysis.up.sql |
| ix_ra_analysis_lines_company | ra_analysis_lines | no | 20261105000106_mdm_rate_analysis.up.sql |
| ux_hr_employees_code | hr_employees | yes | 20261105000108_hr_employees.up.sql |
| ux_hr_employees_user | hr_employees | yes | 20261105000108_hr_employees.up.sql |
| ix_hr_employees_list | hr_employees | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employees_name | hr_employees | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employees_mobile | hr_employees | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employees_dob | hr_employees | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employees_branch | hr_employees | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employees_department | hr_employees | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employees_designation | hr_employees | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employees_manager | hr_employees | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employees_cost_centre | hr_employees | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employees_project | hr_employees | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employees_site | hr_employees | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employees_user_id | hr_employees | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employees_doj | hr_employees | no | 20261105000108_hr_employees.up.sql |
| ux_hr_employee_statutory_employee | hr_employee_statutory | yes | 20261105000108_hr_employees.up.sql |
| ix_hr_employee_statutory_pan | hr_employee_statutory | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employee_statutory_aadhaar | hr_employee_statutory | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employee_banks_employee | hr_employee_banks | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employee_banks_hash | hr_employee_banks | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employee_banks_status | hr_employee_banks | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employee_contacts_employee | hr_employee_contacts | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employee_education_employee | hr_employee_education | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employee_experience_employee | hr_employee_experience | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employee_documents_employee | hr_employee_documents | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employee_documents_expiry | hr_employee_documents | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employee_changes_employee | hr_employee_changes | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employee_changes_list | hr_employee_changes | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employee_changes_due | hr_employee_changes | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employee_history_employee | hr_employee_history | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employee_contacts_company_id | hr_employee_contacts | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employee_education_company_id | hr_employee_education | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employee_experience_company_id | hr_employee_experience | no | 20261105000108_hr_employees.up.sql |
| ix_hr_employee_history_company_id | hr_employee_history | no | 20261105000108_hr_employees.up.sql |
| ix_hr_headcount_plans_company_id | hr_headcount_plans | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_headcount_plans_department | hr_headcount_plans | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_headcount_plans_designation | hr_headcount_plans | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_headcount_plans_project | hr_headcount_plans | no | 20261105000110_hr_recruitment.up.sql |
| ux_hr_requisitions_doc | hr_requisitions | yes | 20261105000110_hr_recruitment.up.sql |
| ix_hr_requisitions_list | hr_requisitions | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_requisitions_department | hr_requisitions | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_requisitions_designation | hr_requisitions | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_requisitions_root | hr_requisitions | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_requisitions_supersedes | hr_requisitions | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_requisitions_replaces | hr_requisitions | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_requisitions_manager | hr_requisitions | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_requisitions_project | hr_requisitions | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_requisitions_required | hr_requisitions | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_candidates_list | hr_candidates | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_candidates_requisition | hr_candidates | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_candidates_mobile | hr_candidates | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_candidates_employee | hr_candidates | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_candidates_retention | hr_candidates | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_interviews_company_id | hr_interviews | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_interviews_candidate | hr_interviews | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_interviews_when | hr_interviews | no | 20261105000110_hr_recruitment.up.sql |
| ux_hr_offers_doc | hr_offers | yes | 20261105000110_hr_recruitment.up.sql |
| ix_hr_offers_list | hr_offers | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_offers_candidate | hr_offers | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_offers_designation | hr_offers | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_offers_supersedes | hr_offers | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_offers_token | hr_offers | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_onboarding_tasks_company_id | hr_onboarding_tasks | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_onboarding_tasks_candidate | hr_onboarding_tasks | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_onboarding_tasks_employee | hr_onboarding_tasks | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_onboarding_tasks_department | hr_onboarding_tasks | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_onboarding_tasks_queue | hr_onboarding_tasks | no | 20261105000110_hr_recruitment.up.sql |
| ix_hr_site_plans_company_id | hr_site_plans | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_site_plans_site | hr_site_plans | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_site_plans_designation | hr_site_plans | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_crews_company_id | hr_crews | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_crews_site | hr_crews | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_crews_supervisor | hr_crews | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_crew_members_company_id | hr_crew_members | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_crew_members_crew | hr_crew_members | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_crew_members_person | hr_crew_members | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_deployments_company_id | hr_deployments | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_deployments_person | hr_deployments | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_deployments_project | hr_deployments | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_deployments_site | hr_deployments | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_deployments_crew | hr_deployments | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_deployments_status | hr_deployments | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_deployments_dates | hr_deployments | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_deployments_supersedes_id | hr_deployments | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_deployments_root_id | hr_deployments | no | 20261105000112_hr_deployments.up.sql |
| ux_hr_deployments_doc | hr_deployments | yes | 20261105000112_hr_deployments.up.sql |
| ix_hr_transfers_company_id | hr_transfers | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_transfers_employee | hr_transfers | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_transfers_to_project | hr_transfers | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_transfers_status | hr_transfers | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_transfers_from_project_id | hr_transfers | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_transfers_from_site_id | hr_transfers | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_transfers_to_site_id | hr_transfers | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_transfers_to_crew_id | hr_transfers | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_transfers_supersedes_id | hr_transfers | no | 20261105000112_hr_deployments.up.sql |
| ix_hr_transfers_root_id | hr_transfers | no | 20261105000112_hr_deployments.up.sql |
| ux_hr_transfers_doc | hr_transfers | yes | 20261105000112_hr_deployments.up.sql |
| ux_att_shifts_code | att_shifts | yes | 20261105000114_att_config.up.sql |
| ix_att_shifts_company_id | att_shifts | no | 20261105000114_att_config.up.sql |
| ux_att_policies_version | att_policies | yes | 20261105000114_att_config.up.sql |
| ix_att_policies_company_id | att_policies | no | 20261105000114_att_config.up.sql |
| ix_att_policies_status | att_policies | no | 20261105000114_att_config.up.sql |
| ix_att_policies_root_id | att_policies | no | 20261105000114_att_config.up.sql |
| ix_att_policies_supersedes_id | att_policies | no | 20261105000114_att_config.up.sql |
| ix_att_policy_assignments_company_id | att_policy_assignments | no | 20261105000114_att_config.up.sql |
| ix_att_policy_assignments_scope | att_policy_assignments | no | 20261105000114_att_config.up.sql |
| ix_att_policy_assignments_shift | att_policy_assignments | no | 20261105000114_att_config.up.sql |
| ix_att_policy_assignments_calendar | att_policy_assignments | no | 20261105000114_att_config.up.sql |
| ix_att_rosters_company_id | att_rosters | no | 20261105000114_att_config.up.sql |
| ix_att_rosters_site | att_rosters | no | 20261105000114_att_config.up.sql |
| ix_att_rosters_crew | att_rosters | no | 20261105000114_att_config.up.sql |
| ux_att_roster_changes_doc | att_roster_changes | yes | 20261105000114_att_config.up.sql |
| ix_att_roster_changes_company_id | att_roster_changes | no | 20261105000114_att_config.up.sql |
| ix_att_roster_changes_site | att_roster_changes | no | 20261105000114_att_config.up.sql |
| ix_att_roster_changes_employee | att_roster_changes | no | 20261105000114_att_config.up.sql |
| ix_att_roster_changes_swap | att_roster_changes | no | 20261105000114_att_config.up.sql |
| ix_att_roster_changes_shift | att_roster_changes | no | 20261105000114_att_config.up.sql |
| ix_att_roster_changes_swap_shift | att_roster_changes | no | 20261105000114_att_config.up.sql |
| ix_att_roster_changes_status | att_roster_changes | no | 20261105000114_att_config.up.sql |
| ix_att_period_defs_company_id | att_period_defs | no | 20261105000114_att_config.up.sql |
| ux_att_periods_start | att_periods | yes | 20261105000114_att_config.up.sql |
| ix_att_periods_company_id | att_periods | no | 20261105000114_att_config.up.sql |
| ux_att_punches_client | att_punches | yes | 20261106000116_att_punches.up.sql |
| ix_att_punches_company_id | att_punches | no | 20261106000116_att_punches.up.sql |
| ix_att_punches_person | att_punches | no | 20261106000116_att_punches.up.sql |
| ix_att_punches_site_day | att_punches | no | 20261106000116_att_punches.up.sql |
| ix_att_punches_day | att_punches | no | 20261106000116_att_punches.up.sql |
| ix_att_punches_device | att_punches | no | 20261106000116_att_punches.up.sql |
| ix_att_punches_group | att_punches | no | 20261106000116_att_punches.up.sql |
| ix_att_punches_deployment | att_punches | no | 20261106000116_att_punches.up.sql |
| ix_att_punches_visit | att_punches | no | 20261106000116_att_punches.up.sql |
| ix_att_punches_selfie | att_punches | no | 20261106000116_att_punches.up.sql |
| ux_att_anomalies_punch_type | att_anomalies | yes | 20261106000116_att_punches.up.sql |
| ix_att_anomalies_company_id | att_anomalies | no | 20261106000116_att_punches.up.sql |
| ix_att_anomalies_queue | att_anomalies | no | 20261106000116_att_punches.up.sql |
| ux_att_visits_doc | att_visits | yes | 20261106000116_att_punches.up.sql |
| ix_att_visits_company_id | att_visits | no | 20261106000116_att_punches.up.sql |
| ix_att_visits_employee | att_visits | no | 20261106000116_att_punches.up.sql |
| ix_att_visits_site | att_visits | no | 20261106000116_att_punches.up.sql |
| ux_att_device_bindings | att_device_bindings | yes | 20261106000116_att_punches.up.sql |
| ix_att_device_bindings_company_id | att_device_bindings | no | 20261106000116_att_punches.up.sql |
| ix_att_device_bindings_employee | att_device_bindings | no | 20261106000116_att_punches.up.sql |
| ix_att_site_settings_company_id | att_site_settings | no | 20261106000116_att_punches.up.sql |
| ix_att_site_settings_setting_site_id | att_site_settings | no | 20261106000116_att_punches.up.sql |
| ux_att_daily_person_day | att_daily | yes | 20261106000118_att_register.up.sql |
| ix_att_daily_company_id | att_daily | no | 20261106000118_att_register.up.sql |
| ix_att_daily_site_day | att_daily | no | 20261106000118_att_register.up.sql |
| ix_att_daily_period | att_daily | no | 20261106000118_att_register.up.sql |
| ix_att_daily_status | att_daily | no | 20261106000118_att_register.up.sql |
| ux_att_regularisations_doc | att_regularisations | yes | 20261106000118_att_register.up.sql |
| ix_att_regularisations_company_id | att_regularisations | no | 20261106000118_att_register.up.sql |
| ix_att_regularisations_employee | att_regularisations | no | 20261106000118_att_register.up.sql |
| ix_att_regularisations_site | att_regularisations | no | 20261106000118_att_register.up.sql |
| ix_att_regularisations_status | att_regularisations | no | 20261106000118_att_register.up.sql |
| ix_att_regularisations_root_id | att_regularisations | no | 20261106000118_att_register.up.sql |
| ix_att_regularisations_supersedes_id | att_regularisations | no | 20261106000118_att_register.up.sql |
| ix_att_regularisations_evidence | att_regularisations | no | 20261106000118_att_register.up.sql |
| ux_att_overtime_requests_doc | att_overtime_requests | yes | 20261106000118_att_register.up.sql |
| ix_att_overtime_requests_company_id | att_overtime_requests | no | 20261106000118_att_register.up.sql |
| ix_att_overtime_requests_employee | att_overtime_requests | no | 20261106000118_att_register.up.sql |
| ix_att_overtime_requests_site | att_overtime_requests | no | 20261106000118_att_register.up.sql |
| ix_att_overtime_requests_status | att_overtime_requests | no | 20261106000118_att_register.up.sql |
| ix_att_overtime_requests_root_id | att_overtime_requests | no | 20261106000118_att_register.up.sql |
| ix_att_overtime_requests_supersedes_id | att_overtime_requests | no | 20261106000118_att_register.up.sql |
| ux_att_manual_entries_doc | att_manual_entries | yes | 20261106000118_att_register.up.sql |
| ix_att_manual_entries_company_id | att_manual_entries | no | 20261106000118_att_register.up.sql |
| ix_att_manual_entries_employee | att_manual_entries | no | 20261106000118_att_register.up.sql |
| ix_att_manual_entries_site | att_manual_entries | no | 20261106000118_att_register.up.sql |
| ix_att_manual_entries_status | att_manual_entries | no | 20261106000118_att_register.up.sql |
| ix_att_manual_entries_root_id | att_manual_entries | no | 20261106000118_att_register.up.sql |
| ix_att_manual_entries_supersedes_id | att_manual_entries | no | 20261106000118_att_register.up.sql |
| ix_att_manual_entries_evidence | att_manual_entries | no | 20261106000118_att_register.up.sql |
| ux_att_period_locks_active | att_period_locks | yes | 20261106000118_att_register.up.sql |
| ix_att_period_locks_company_id | att_period_locks | no | 20261106000118_att_register.up.sql |
| ix_att_period_locks_site | att_period_locks | no | 20261106000118_att_register.up.sql |
| ux_att_arrears_open | att_arrears | yes | 20261106000118_att_register.up.sql |
| ix_att_arrears_company_id | att_arrears | no | 20261106000118_att_register.up.sql |
| ix_att_arrears_lock | att_arrears | no | 20261106000118_att_register.up.sql |
| ix_att_arrears_site | att_arrears | no | 20261106000118_att_register.up.sql |
| ux_lv_types_code | lv_types | yes | 20261106000120_lv_leave.up.sql |
| ix_lv_types_company_id | lv_types | no | 20261106000120_lv_leave.up.sql |
| ux_lv_entitlements_key | lv_entitlements | yes | 20261106000120_lv_leave.up.sql |
| ix_lv_entitlements_company_id | lv_entitlements | no | 20261106000120_lv_leave.up.sql |
| ix_lv_entitlements_type | lv_entitlements | no | 20261106000120_lv_leave.up.sql |
| ix_lv_entitlements_employee | lv_entitlements | no | 20261106000120_lv_leave.up.sql |
| ux_lv_ledger_ref | lv_ledger | yes | 20261106000120_lv_leave.up.sql |
| ix_lv_ledger_company_id | lv_ledger | no | 20261106000120_lv_leave.up.sql |
| ix_lv_ledger_person | lv_ledger | no | 20261106000120_lv_leave.up.sql |
| ix_lv_ledger_type | lv_ledger | no | 20261106000120_lv_leave.up.sql |
| ux_lv_applications_doc | lv_applications | yes | 20261106000120_lv_leave.up.sql |
| ix_lv_applications_company_id | lv_applications | no | 20261106000120_lv_leave.up.sql |
| ix_lv_applications_employee | lv_applications | no | 20261106000120_lv_leave.up.sql |
| ix_lv_applications_type | lv_applications | no | 20261106000120_lv_leave.up.sql |
| ix_lv_applications_site | lv_applications | no | 20261106000120_lv_leave.up.sql |
| ix_lv_applications_status | lv_applications | no | 20261106000120_lv_leave.up.sql |
| ix_lv_applications_root_id | lv_applications | no | 20261106000120_lv_leave.up.sql |
| ix_lv_applications_supersedes_id | lv_applications | no | 20261106000120_lv_leave.up.sql |
| ix_lv_applications_dates | lv_applications | no | 20261106000120_lv_leave.up.sql |
| ix_lv_applications_attachment | lv_applications | no | 20261106000120_lv_leave.up.sql |
| ux_lv_adjustments_doc | lv_adjustments | yes | 20261106000120_lv_leave.up.sql |
| ix_lv_adjustments_company_id | lv_adjustments | no | 20261106000120_lv_leave.up.sql |
| ix_lv_adjustments_employee | lv_adjustments | no | 20261106000120_lv_leave.up.sql |
| ix_lv_adjustments_type | lv_adjustments | no | 20261106000120_lv_leave.up.sql |
| ix_lv_adjustments_site | lv_adjustments | no | 20261106000120_lv_leave.up.sql |
| ix_lv_adjustments_status | lv_adjustments | no | 20261106000120_lv_leave.up.sql |
| ix_lv_adjustments_root_id | lv_adjustments | no | 20261106000120_lv_leave.up.sql |
| ix_lv_adjustments_supersedes_id | lv_adjustments | no | 20261106000120_lv_leave.up.sql |
| ux_lv_year_runs_year | lv_year_runs | yes | 20261106000120_lv_leave.up.sql |
| ix_lv_year_runs_company_id | lv_year_runs | no | 20261106000120_lv_leave.up.sql |
| ux_lab_workers_doc | lab_workers | yes | 20261106000122_lab_contract_labour.up.sql |
| ix_lab_workers_company_id | lab_workers | no | 20261106000122_lab_contract_labour.up.sql |
| ix_lab_workers_contractor | lab_workers | no | 20261106000122_lab_contract_labour.up.sql |
| ix_lab_workers_status | lab_workers | no | 20261106000122_lab_contract_labour.up.sql |
| ix_lab_workers_root_id | lab_workers | no | 20261106000122_lab_contract_labour.up.sql |
| ix_lab_workers_supersedes_id | lab_workers | no | 20261106000122_lab_contract_labour.up.sql |
| ix_lab_workers_photo | lab_workers | no | 20261106000122_lab_contract_labour.up.sql |
| ux_lab_workers_qr | lab_workers | yes | 20261106000122_lab_contract_labour.up.sql |
| ux_lab_workers_aadhaar | lab_workers | yes | 20261106000122_lab_contract_labour.up.sql |
| ux_lab_compliance_contractor | lab_contractor_compliance | yes | 20261106000122_lab_contract_labour.up.sql |
| ix_lab_compliance_company_id | lab_contractor_compliance | no | 20261106000122_lab_contract_labour.up.sql |
| ix_lab_compliance_contractor | lab_contractor_compliance | no | 20261106000122_lab_contract_labour.up.sql |
| ux_lab_wage_rates_doc | lab_wage_rates | yes | 20261106000122_lab_contract_labour.up.sql |
| ix_lab_wage_rates_company_id | lab_wage_rates | no | 20261106000122_lab_contract_labour.up.sql |
| ix_lab_wage_rates_contractor | lab_wage_rates | no | 20261106000122_lab_contract_labour.up.sql |
| ix_lab_wage_rates_lookup | lab_wage_rates | no | 20261106000122_lab_contract_labour.up.sql |
| ix_lab_wage_rates_root_id | lab_wage_rates | no | 20261106000122_lab_contract_labour.up.sql |
| ix_lab_wage_rates_supersedes_id | lab_wage_rates | no | 20261106000122_lab_contract_labour.up.sql |
| ux_ess_requests_doc | ess_requests | yes | 20261106000124_ess_requests.up.sql |
| ix_ess_requests_company_id | ess_requests | no | 20261106000124_ess_requests.up.sql |
| ix_ess_requests_employee | ess_requests | no | 20261106000124_ess_requests.up.sql |
| ix_ess_requests_status | ess_requests | no | 20261106000124_ess_requests.up.sql |
| ix_ess_requests_root_id | ess_requests | no | 20261106000124_ess_requests.up.sql |
| ix_ess_requests_generated | ess_requests | no | 20261106000124_ess_requests.up.sql |
| ux_trn_courses_code | trn_courses | yes | 20261106000126_trn_training.up.sql |
| ix_trn_courses_company_id | trn_courses | no | 20261106000126_trn_training.up.sql |
| ux_trn_sessions_doc | trn_sessions | yes | 20261106000126_trn_training.up.sql |
| ix_trn_sessions_company_id | trn_sessions | no | 20261106000126_trn_training.up.sql |
| ix_trn_sessions_course | trn_sessions | no | 20261106000126_trn_training.up.sql |
| ix_trn_sessions_when | trn_sessions | no | 20261106000126_trn_training.up.sql |
| ix_trn_sessions_status | trn_sessions | no | 20261106000126_trn_training.up.sql |
| ix_trn_sessions_site | trn_sessions | no | 20261106000126_trn_training.up.sql |
| ix_trn_sessions_project | trn_sessions | no | 20261106000126_trn_training.up.sql |
| ix_trn_sessions_department | trn_sessions | no | 20261106000126_trn_training.up.sql |
| ux_trn_attendance_person | trn_attendance | yes | 20261106000126_trn_training.up.sql |
| ix_trn_attendance_company_id | trn_attendance | no | 20261106000126_trn_training.up.sql |
| ix_trn_attendance_who | trn_attendance | no | 20261106000126_trn_training.up.sql |
| ix_trn_attendance_site | trn_attendance | no | 20261106000126_trn_training.up.sql |
| ix_trn_attendance_project | trn_attendance | no | 20261106000126_trn_training.up.sql |
| ux_trn_cert_types_code | trn_cert_types | yes | 20261106000126_trn_training.up.sql |
| ix_trn_cert_types_company_id | trn_cert_types | no | 20261106000126_trn_training.up.sql |
| ix_trn_certifications_company_id | trn_certifications | no | 20261106000126_trn_training.up.sql |
| ix_trn_certifications_person | trn_certifications | no | 20261106000126_trn_training.up.sql |
| ix_trn_certifications_type | trn_certifications | no | 20261106000126_trn_training.up.sql |
| ix_trn_certifications_session | trn_certifications | no | 20261106000126_trn_training.up.sql |
| ix_trn_certifications_file | trn_certifications | no | 20261106000126_trn_training.up.sql |
| ix_trn_certifications_site | trn_certifications | no | 20261106000126_trn_training.up.sql |
| ix_trn_certifications_project | trn_certifications | no | 20261106000126_trn_training.up.sql |
| ux_trn_skill_defs_code | trn_skill_defs | yes | 20261106000126_trn_training.up.sql |
| ix_trn_skill_defs_company_id | trn_skill_defs | no | 20261106000126_trn_training.up.sql |
| ix_trn_skills_company_id | trn_skills | no | 20261106000126_trn_training.up.sql |
| ix_trn_skills_person | trn_skills | no | 20261106000126_trn_training.up.sql |
| ix_trn_skills_assessor | trn_skills | no | 20261106000126_trn_training.up.sql |
| ix_trn_skills_site | trn_skills | no | 20261106000126_trn_training.up.sql |
| ix_trn_skills_project | trn_skills | no | 20261106000126_trn_training.up.sql |
| ux_perf_cycles_code | perf_cycles | yes | 20261106000128_perf_performance.up.sql |
| ix_perf_cycles_company_id | perf_cycles | no | 20261106000128_perf_performance.up.sql |
| ix_perf_cycles_status | perf_cycles | no | 20261106000128_perf_performance.up.sql |
| ix_perf_cycles_project | perf_cycles | no | 20261106000128_perf_performance.up.sql |
| ix_perf_cycles_site | perf_cycles | no | 20261106000128_perf_performance.up.sql |
| ux_perf_kpis_code | perf_kpis | yes | 20261106000128_perf_performance.up.sql |
| ix_perf_kpis_company_id | perf_kpis | no | 20261106000128_perf_performance.up.sql |
| ix_perf_kpis_status | perf_kpis | no | 20261106000128_perf_performance.up.sql |
| ix_perf_kpis_project | perf_kpis | no | 20261106000128_perf_performance.up.sql |
| ix_perf_kpis_site | perf_kpis | no | 20261106000128_perf_performance.up.sql |
| ux_perf_kpi_values_key | perf_kpi_values | yes | 20261106000128_perf_performance.up.sql |
| ix_perf_kpi_values_company_id | perf_kpi_values | no | 20261106000128_perf_performance.up.sql |
| ix_perf_kpi_values_employee | perf_kpi_values | no | 20261106000128_perf_performance.up.sql |
| ix_perf_kpi_values_status | perf_kpi_values | no | 20261106000128_perf_performance.up.sql |
| ix_perf_kpi_values_project | perf_kpi_values | no | 20261106000128_perf_performance.up.sql |
| ix_perf_kpi_values_site | perf_kpi_values | no | 20261106000128_perf_performance.up.sql |
| ix_perf_kpi_disputes_company_id | perf_kpi_disputes | no | 20261106000128_perf_performance.up.sql |
| ix_perf_kpi_disputes_value | perf_kpi_disputes | no | 20261106000128_perf_performance.up.sql |
| ix_perf_kpi_disputes_employee | perf_kpi_disputes | no | 20261106000128_perf_performance.up.sql |
| ix_perf_kpi_disputes_project | perf_kpi_disputes | no | 20261106000128_perf_performance.up.sql |
| ix_perf_kpi_disputes_site | perf_kpi_disputes | no | 20261106000128_perf_performance.up.sql |
| ix_perf_goals_company_id | perf_goals | no | 20261106000128_perf_performance.up.sql |
| ix_perf_goals_employee | perf_goals | no | 20261106000128_perf_performance.up.sql |
| ix_perf_goals_cycle | perf_goals | no | 20261106000128_perf_performance.up.sql |
| ix_perf_goals_project | perf_goals | no | 20261106000128_perf_performance.up.sql |
| ix_perf_goals_site | perf_goals | no | 20261106000128_perf_performance.up.sql |
| ix_perf_feedback_company_id | perf_feedback | no | 20261106000128_perf_performance.up.sql |
| ix_perf_feedback_employee | perf_feedback | no | 20261106000128_perf_performance.up.sql |
| ix_perf_feedback_author | perf_feedback | no | 20261106000128_perf_performance.up.sql |
| ix_perf_feedback_project | perf_feedback | no | 20261106000128_perf_performance.up.sql |
| ix_perf_feedback_site | perf_feedback | no | 20261106000128_perf_performance.up.sql |
| ux_perf_reviews_doc | perf_reviews | yes | 20261106000128_perf_performance.up.sql |
| ux_perf_reviews_person | perf_reviews | yes | 20261106000128_perf_performance.up.sql |
| ix_perf_reviews_company_id | perf_reviews | no | 20261106000128_perf_performance.up.sql |
| ix_perf_reviews_employee | perf_reviews | no | 20261106000128_perf_performance.up.sql |
| ix_perf_reviews_status | perf_reviews | no | 20261106000128_perf_performance.up.sql |
| ix_perf_reviews_letter | perf_reviews | no | 20261106000128_perf_performance.up.sql |
| ix_perf_reviews_project | perf_reviews | no | 20261106000128_perf_performance.up.sql |
| ix_perf_reviews_site | perf_reviews | no | 20261106000128_perf_performance.up.sql |
| ix_exp_policies_company_id | exp_policies | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_policies_lookup | exp_policies | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_policies_project | exp_policies | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_policies_site | exp_policies | no | 20261106000130_exp_expenses.up.sql |
| ux_exp_travel_doc | exp_travel_requests | yes | 20261106000130_exp_expenses.up.sql |
| ix_exp_travel_company_id | exp_travel_requests | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_travel_employee | exp_travel_requests | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_travel_status | exp_travel_requests | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_travel_project | exp_travel_requests | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_travel_site | exp_travel_requests | no | 20261106000130_exp_expenses.up.sql |
| ux_exp_advances_doc | exp_advances | yes | 20261106000130_exp_expenses.up.sql |
| ix_exp_advances_company_id | exp_advances | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_advances_employee | exp_advances | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_advances_status | exp_advances | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_advances_travel | exp_advances | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_advances_project | exp_advances | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_advances_site | exp_advances | no | 20261106000130_exp_expenses.up.sql |
| ux_exp_claims_doc | exp_claims | yes | 20261106000130_exp_expenses.up.sql |
| ix_exp_claims_company_id | exp_claims | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_claims_employee | exp_claims | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_claims_status | exp_claims | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_claims_travel | exp_claims | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_claims_advance | exp_claims | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_claims_project | exp_claims | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_claims_site | exp_claims | no | 20261106000130_exp_expenses.up.sql |
| ux_exp_claim_lines_no | exp_claim_lines | yes | 20261106000130_exp_expenses.up.sql |
| ix_exp_claim_lines_company_id | exp_claim_lines | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_claim_lines_duplicate | exp_claim_lines | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_claim_lines_cost_code | exp_claim_lines | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_claim_lines_file | exp_claim_lines | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_claim_lines_project | exp_claim_lines | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_claim_lines_site | exp_claim_lines | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_recoveries_company_id | exp_advance_recoveries | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_recoveries_advance | exp_advance_recoveries | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_recoveries_claim | exp_advance_recoveries | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_recoveries_due | exp_advance_recoveries | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_recoveries_project | exp_advance_recoveries | no | 20261106000130_exp_expenses.up.sql |
| ix_exp_recoveries_site | exp_advance_recoveries | no | 20261106000130_exp_expenses.up.sql |
| ux_hr_separations_doc | hr_separations | yes | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_separations_company_id | hr_separations | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_separations_employee | hr_separations | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_separations_status | hr_separations | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_separations_lwd | hr_separations | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_separations_notice_change | hr_separations | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_separations_exit_change | hr_separations | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_separations_relieving | hr_separations | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_separations_experience | hr_separations | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_separations_project | hr_separations | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_separations_site | hr_separations | no | 20261106000132_hr_exit_relations.up.sql |
| ux_hr_clearances_dept | hr_clearances | yes | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_clearances_company_id | hr_clearances | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_clearances_status | hr_clearances | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_clearances_separation | hr_clearances | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_clearances_project | hr_clearances | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_clearances_site | hr_clearances | no | 20261106000132_hr_exit_relations.up.sql |
| ux_hr_exit_interviews_sep | hr_exit_interviews | yes | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_exit_interviews_company_id | hr_exit_interviews | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_exit_interviews_project | hr_exit_interviews | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_exit_interviews_site | hr_exit_interviews | no | 20261106000132_hr_exit_relations.up.sql |
| ux_hr_grievances_doc | hr_grievances | yes | 20261106000132_hr_exit_relations.up.sql |
| ux_hr_grievances_tracking | hr_grievances | yes | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_grievances_company_id | hr_grievances | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_grievances_status | hr_grievances | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_grievances_assigned | hr_grievances | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_grievances_raised_by | hr_grievances | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_grievances_complainant | hr_grievances | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_grievances_project | hr_grievances | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_grievances_site | hr_grievances | no | 20261106000132_hr_exit_relations.up.sql |
| ux_hr_disciplinary_doc | hr_disciplinary_cases | yes | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_disciplinary_cases_company_id | hr_disciplinary_cases | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_disciplinary_cases_employee | hr_disciplinary_cases | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_disciplinary_cases_status | hr_disciplinary_cases | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_disciplinary_cases_project | hr_disciplinary_cases | no | 20261106000132_hr_exit_relations.up.sql |
| ix_hr_disciplinary_cases_site | hr_disciplinary_cases | no | 20261106000132_hr_exit_relations.up.sql |
| ux_bd_leads_doc | bd_leads | yes | 20261106000134_bd_crm.up.sql |
| ix_bd_leads_company_id | bd_leads | no | 20261106000134_bd_crm.up.sql |
| ix_bd_leads_status | bd_leads | no | 20261106000134_bd_crm.up.sql |
| ix_bd_leads_owner | bd_leads | no | 20261106000134_bd_crm.up.sql |
| ix_bd_leads_client | bd_leads | no | 20261106000134_bd_crm.up.sql |
| ix_bd_leads_source | bd_leads | no | 20261106000134_bd_crm.up.sql |
| ux_bd_opportunities_doc | bd_opportunities | yes | 20261106000134_bd_crm.up.sql |
| ix_bd_opportunities_company_id | bd_opportunities | no | 20261106000134_bd_crm.up.sql |
| ix_bd_opportunities_stage | bd_opportunities | no | 20261106000134_bd_crm.up.sql |
| ix_bd_opportunities_status | bd_opportunities | no | 20261106000134_bd_crm.up.sql |
| ix_bd_opportunities_owner | bd_opportunities | no | 20261106000134_bd_crm.up.sql |
| ix_bd_opportunities_client | bd_opportunities | no | 20261106000134_bd_crm.up.sql |
| ix_bd_opportunities_lead | bd_opportunities | no | 20261106000134_bd_crm.up.sql |
| ix_bd_opportunities_award | bd_opportunities | no | 20261106000134_bd_crm.up.sql |
| ix_bd_opportunities_sector | bd_opportunities | no | 20261106000134_bd_crm.up.sql |
| ix_bd_interactions_company_id | bd_interactions | no | 20261106000134_bd_crm.up.sql |
| ix_bd_interactions_entity | bd_interactions | no | 20261106000134_bd_crm.up.sql |
| ix_bd_interactions_client | bd_interactions | no | 20261106000134_bd_crm.up.sql |
| ix_bd_interactions_next | bd_interactions | no | 20261106000134_bd_crm.up.sql |
| ix_bd_contacts_company_id | bd_contacts | no | 20261106000134_bd_crm.up.sql |
| ix_bd_contacts_partner | bd_contacts | no | 20261106000134_bd_crm.up.sql |
| ix_bd_contacts_reports | bd_contacts | no | 20261106000134_bd_crm.up.sql |
| ix_bd_stage_log_company_id | bd_stage_log | no | 20261106000134_bd_crm.up.sql |
| ix_bd_stage_log_opportunity | bd_stage_log | no | 20261106000134_bd_crm.up.sql |
| ix_bd_amendments_company_id | bd_amendments | no | 20261106000134_bd_crm.up.sql |
| ux_bd_amendments | bd_amendments | yes | 20261106000134_bd_crm.up.sql |
| ux_tdr_tenders_doc | tdr_tenders | yes | 20261106000136_tdr_tenders.up.sql |
| ux_tdr_tenders_ref | tdr_tenders | yes | 20261106000136_tdr_tenders.up.sql |
| ix_tdr_tenders_company_id | tdr_tenders | no | 20261106000136_tdr_tenders.up.sql |
| ix_tdr_tenders_stage | tdr_tenders | no | 20261106000136_tdr_tenders.up.sql |
| ix_tdr_tenders_status | tdr_tenders | no | 20261106000136_tdr_tenders.up.sql |
| ix_tdr_tenders_owner | tdr_tenders | no | 20261106000136_tdr_tenders.up.sql |
| ix_tdr_tenders_client | tdr_tenders | no | 20261106000136_tdr_tenders.up.sql |
| ix_tdr_tenders_opportunity | tdr_tenders | no | 20261106000136_tdr_tenders.up.sql |
| ix_tdr_tenders_submission | tdr_tenders | no | 20261106000136_tdr_tenders.up.sql |
| ux_tdr_eligibility_seq | tdr_eligibility | yes | 20261106000136_tdr_tenders.up.sql |
| ix_tdr_eligibility_company_id | tdr_eligibility | no | 20261106000136_tdr_tenders.up.sql |
| ux_tdr_bid_decisions_doc | tdr_bid_decisions | yes | 20261106000136_tdr_tenders.up.sql |
| ix_tdr_bid_decisions_company_id | tdr_bid_decisions | no | 20261106000136_tdr_tenders.up.sql |
| ix_tdr_bid_decisions_tender | tdr_bid_decisions | no | 20261106000136_tdr_tenders.up.sql |
| ux_tdr_addenda_number | tdr_addenda | yes | 20261106000136_tdr_tenders.up.sql |
| ix_tdr_addenda_company_id | tdr_addenda | no | 20261106000136_tdr_tenders.up.sql |
| ux_tdr_queries_seq | tdr_queries | yes | 20261106000136_tdr_tenders.up.sql |
| ix_tdr_queries_company_id | tdr_queries | no | 20261106000136_tdr_tenders.up.sql |
| ix_tdr_team_tasks_company_id | tdr_team_tasks | no | 20261106000136_tdr_tenders.up.sql |
| ix_tdr_team_tasks_tender | tdr_team_tasks | no | 20261106000136_tdr_tenders.up.sql |
| ix_tdr_team_tasks_due | tdr_team_tasks | no | 20261106000136_tdr_tenders.up.sql |
| ix_tdr_date_log_company_id | tdr_date_log | no | 20261106000136_tdr_tenders.up.sql |
| ix_tdr_date_log_tender | tdr_date_log | no | 20261106000136_tdr_tenders.up.sql |
| ix_tdr_amendments_company_id | tdr_amendments | no | 20261106000136_tdr_tenders.up.sql |
| ux_tdr_amendments | tdr_amendments | yes | 20261106000136_tdr_tenders.up.sql |
| ux_tdr_credentials_doc | tdr_credentials | yes | 20261106000138_tdr_awards.up.sql |
| ix_tdr_credentials_company_id | tdr_credentials | no | 20261106000138_tdr_awards.up.sql |
| ix_tdr_credentials_type | tdr_credentials | no | 20261106000138_tdr_awards.up.sql |
| ix_tdr_credentials_client | tdr_credentials | no | 20261106000138_tdr_awards.up.sql |
| ux_tdr_tender_credentials | tdr_tender_credentials | yes | 20261106000138_tdr_awards.up.sql |
| ix_tdr_tender_credentials_company_id | tdr_tender_credentials | no | 20261106000138_tdr_awards.up.sql |
| ix_tdr_tender_credentials_credential | tdr_tender_credentials | no | 20261106000138_tdr_awards.up.sql |
| ux_tdr_emd_doc | tdr_emd | yes | 20261106000138_tdr_awards.up.sql |
| ix_tdr_emd_company_id | tdr_emd | no | 20261106000138_tdr_awards.up.sql |
| ix_tdr_emd_tender | tdr_emd | no | 20261106000138_tdr_awards.up.sql |
| ix_tdr_emd_status | tdr_emd | no | 20261106000138_tdr_awards.up.sql |
| ix_tdr_emd_refund | tdr_emd | no | 20261106000138_tdr_awards.up.sql |
| ux_tdr_submissions_doc | tdr_submissions | yes | 20261106000138_tdr_awards.up.sql |
| ix_tdr_submissions_company_id | tdr_submissions | no | 20261106000138_tdr_awards.up.sql |
| ix_tdr_submissions_tender | tdr_submissions | no | 20261106000138_tdr_awards.up.sql |
| ux_tdr_competitors_name | tdr_competitors | yes | 20261106000138_tdr_awards.up.sql |
| ix_tdr_competitors_company_id | tdr_competitors | no | 20261106000138_tdr_awards.up.sql |
| ix_tdr_competitors_partner | tdr_competitors | no | 20261106000138_tdr_awards.up.sql |
| ix_tdr_bid_results_company_id | tdr_bid_results | no | 20261106000138_tdr_awards.up.sql |
| ix_tdr_bid_results_tender | tdr_bid_results | no | 20261106000138_tdr_awards.up.sql |
| ix_tdr_bid_results_competitor | tdr_bid_results | no | 20261106000138_tdr_awards.up.sql |
| ix_tdr_bid_results_partner | tdr_bid_results | no | 20261106000138_tdr_awards.up.sql |
| ux_tdr_negotiations_round | tdr_negotiations | yes | 20261106000138_tdr_awards.up.sql |
| ix_tdr_negotiations_company_id | tdr_negotiations | no | 20261106000138_tdr_awards.up.sql |
| ux_tdr_awards_doc | tdr_awards | yes | 20261106000138_tdr_awards.up.sql |
| ix_tdr_awards_company_id | tdr_awards | no | 20261106000138_tdr_awards.up.sql |
| ix_tdr_awards_tender | tdr_awards | no | 20261106000138_tdr_awards.up.sql |
| ix_tdr_awards_outcome | tdr_awards | no | 20261106000138_tdr_awards.up.sql |
| ix_tdr_submissions_status | tdr_submissions | no | 20261106000138_tdr_awards.up.sql |
| ix_tdr_awards_status | tdr_awards | no | 20261106000138_tdr_awards.up.sql |
| ux_est_estimates_doc | est_estimates | yes | 20261106000140_est_estimates.up.sql |
| ix_est_estimates_company_id | est_estimates | no | 20261106000140_est_estimates.up.sql |
| ix_est_estimates_status | est_estimates | no | 20261106000140_est_estimates.up.sql |
| ix_est_estimates_tender | est_estimates | no | 20261106000140_est_estimates.up.sql |
| ix_est_estimates_project | est_estimates | no | 20261106000140_est_estimates.up.sql |
| ix_est_estimates_supersedes | est_estimates | no | 20261106000140_est_estimates.up.sql |
| ux_est_items_no | est_estimate_items | yes | 20261106000140_est_estimates.up.sql |
| ix_est_estimate_items_company_id | est_estimate_items | no | 20261106000140_est_estimates.up.sql |
| ix_est_estimate_items_estimate | est_estimate_items | no | 20261106000140_est_estimates.up.sql |
| ix_est_estimate_items_work_item | est_estimate_items | no | 20261106000140_est_estimates.up.sql |
| ix_est_estimate_items_analysis | est_estimate_items | no | 20261106000140_est_estimates.up.sql |
| ix_est_item_components_company_id | est_item_components | no | 20261106000140_est_estimates.up.sql |
| ix_est_item_components_item | est_item_components | no | 20261106000140_est_estimates.up.sql |
| ix_est_item_components_component | est_item_components | no | 20261106000140_est_estimates.up.sql |
| ix_est_item_components_rate | est_item_components | no | 20261106000140_est_estimates.up.sql |
| ix_est_indirects_company_id | est_indirects | no | 20261106000140_est_estimates.up.sql |
| ix_est_indirects_estimate | est_indirects | no | 20261106000140_est_estimates.up.sql |
| ix_est_risks_company_id | est_risks | no | 20261106000140_est_estimates.up.sql |
| ix_est_risks_estimate | est_risks | no | 20261106000140_est_estimates.up.sql |
| ux_mto_takeoffs_doc | mto_takeoffs | yes | 20261106000142_mto_takeoffs.up.sql |
| ix_mto_takeoffs_company_id | mto_takeoffs | no | 20261106000142_mto_takeoffs.up.sql |
| ix_mto_takeoffs_status | mto_takeoffs | no | 20261106000142_mto_takeoffs.up.sql |
| ix_mto_takeoffs_project | mto_takeoffs | no | 20261106000142_mto_takeoffs.up.sql |
| ix_mto_takeoffs_tender | mto_takeoffs | no | 20261106000142_mto_takeoffs.up.sql |
| ix_mto_takeoffs_estimate | mto_takeoffs | no | 20261106000142_mto_takeoffs.up.sql |
| ix_mto_takeoffs_drawing | mto_takeoffs | no | 20261106000142_mto_takeoffs.up.sql |
| ix_mto_takeoff_lines_company_id | mto_takeoff_lines | no | 20261106000142_mto_takeoffs.up.sql |
| ix_mto_takeoff_lines_takeoff | mto_takeoff_lines | no | 20261106000142_mto_takeoffs.up.sql |
| ix_mto_takeoff_lines_work_item | mto_takeoff_lines | no | 20261106000142_mto_takeoffs.up.sql |
| ix_mto_takeoff_lines_material | mto_takeoff_lines | no | 20261106000142_mto_takeoffs.up.sql |
| ux_mto_bbs_doc | mto_bbs | yes | 20261106000142_mto_takeoffs.up.sql |
| ix_mto_bbs_company_id | mto_bbs | no | 20261106000142_mto_takeoffs.up.sql |
| ix_mto_bbs_status | mto_bbs | no | 20261106000142_mto_takeoffs.up.sql |
| ix_mto_bbs_project | mto_bbs | no | 20261106000142_mto_takeoffs.up.sql |
| ix_mto_bbs_drawing | mto_bbs | no | 20261106000142_mto_takeoffs.up.sql |
| ix_mto_bbs_lines_company_id | mto_bbs_lines | no | 20261106000142_mto_takeoffs.up.sql |
| ix_mto_bbs_lines_bbs | mto_bbs_lines | no | 20261106000142_mto_takeoffs.up.sql |
| ix_mto_bbs_lines_dia | mto_bbs_lines | no | 20261106000142_mto_takeoffs.up.sql |
| ix_mto_material_requirements_company_id | mto_material_requirements | no | 20261106000142_mto_takeoffs.up.sql |
| ix_mto_material_requirements_source | mto_material_requirements | no | 20261106000142_mto_takeoffs.up.sql |
| ix_mto_material_requirements_item | mto_material_requirements | no | 20261106000142_mto_takeoffs.up.sql |
| ix_mto_material_requirements_project | mto_material_requirements | no | 20261106000142_mto_takeoffs.up.sql |
| ix_est_reviews_company_id | est_reviews | no | 20261107000144_est_reviews.up.sql |
| ix_est_reviews_estimate | est_reviews | no | 20261107000144_est_reviews.up.sql |
| ux_est_bid_summary_estimate | est_bid_summary | yes | 20261107000144_est_reviews.up.sql |
| ix_est_bid_summary_company_id | est_bid_summary | no | 20261107000144_est_reviews.up.sql |
| ix_est_bid_summary_status | est_bid_summary | no | 20261107000144_est_reviews.up.sql |
| ix_est_assumptions_company_id | est_assumptions | no | 20261107000144_est_reviews.up.sql |
| ix_est_assumptions_estimate | est_assumptions | no | 20261107000144_est_reviews.up.sql |
| ux_proj_projects_project | proj_projects | yes | 20261107000146_proj_projects.up.sql |
| ix_proj_projects_company_id | proj_projects | no | 20261107000146_proj_projects.up.sql |
| ix_proj_projects_status | proj_projects | no | 20261107000146_proj_projects.up.sql |
| ix_proj_projects_state | proj_projects | no | 20261107000146_proj_projects.up.sql |
| ix_proj_projects_client | proj_projects | no | 20261107000146_proj_projects.up.sql |
| ix_proj_projects_consultant | proj_projects | no | 20261107000146_proj_projects.up.sql |
| ix_proj_projects_funder | proj_projects | no | 20261107000146_proj_projects.up.sql |
| ix_proj_projects_tender | proj_projects | no | 20261107000146_proj_projects.up.sql |
| ux_proj_milestones_code | proj_milestones | yes | 20261107000146_proj_projects.up.sql |
| ix_proj_milestones_company_id | proj_milestones | no | 20261107000146_proj_projects.up.sql |
| ix_proj_milestones_project | proj_milestones | no | 20261107000146_proj_projects.up.sql |
| ix_proj_lifecycle_log_company_id | proj_lifecycle_log | no | 20261107000146_proj_projects.up.sql |
| ix_proj_lifecycle_log_project | proj_lifecycle_log | no | 20261107000146_proj_projects.up.sql |
| ix_proj_lifecycle_log_status | proj_lifecycle_log | no | 20261107000146_proj_projects.up.sql |
| ux_proj_baseline_packs_doc | proj_baseline_packs | yes | 20261107000148_proj_baseline.up.sql |
| ux_proj_baseline_packs_live | proj_baseline_packs | yes | 20261107000148_proj_baseline.up.sql |
| ix_proj_baseline_packs_company_id | proj_baseline_packs | no | 20261107000148_proj_baseline.up.sql |
| ix_proj_baseline_packs_status | proj_baseline_packs | no | 20261107000148_proj_baseline.up.sql |
| ix_proj_baseline_packs_project | proj_baseline_packs | no | 20261107000148_proj_baseline.up.sql |
| ix_proj_baseline_packs_tender | proj_baseline_packs | no | 20261107000148_proj_baseline.up.sql |
| ix_proj_baseline_packs_award | proj_baseline_packs | no | 20261107000148_proj_baseline.up.sql |
| ix_proj_baseline_packs_estimate | proj_baseline_packs | no | 20261107000148_proj_baseline.up.sql |
| ix_proj_baseline_packs_supersedes | proj_baseline_packs | no | 20261107000148_proj_baseline.up.sql |
| ix_proj_handover_meetings_company_id | proj_handover_meetings | no | 20261107000148_proj_baseline.up.sql |
| ix_proj_handover_meetings_pack | proj_handover_meetings | no | 20261107000148_proj_baseline.up.sql |
| ux_proj_boq_items_item | proj_boq_items | yes | 20261107000148_proj_baseline.up.sql |
| ix_proj_boq_items_company_id | proj_boq_items | no | 20261107000148_proj_baseline.up.sql |
| ix_proj_boq_items_project | proj_boq_items | no | 20261107000148_proj_baseline.up.sql |
| ix_proj_boq_items_estimate_item | proj_boq_items | no | 20261107000148_proj_baseline.up.sql |
| ux_proj_wbs_code | proj_wbs | yes | 20261107000150_proj_structure.up.sql |
| ix_proj_wbs_parent_id | proj_wbs | no | 20261107000150_proj_structure.up.sql |
| ix_proj_wbs_company_id | proj_wbs | no | 20261107000150_proj_structure.up.sql |
| ix_proj_wbs_parent | proj_wbs | no | 20261107000150_proj_structure.up.sql |
| ix_proj_wbs_responsible | proj_wbs | no | 20261107000150_proj_structure.up.sql |
| ix_proj_wbs_versions_company_id | proj_wbs_versions | no | 20261107000150_proj_structure.up.sql |
| ix_proj_wbs_versions_project | proj_wbs_versions | no | 20261107000150_proj_structure.up.sql |
| ux_proj_wbs_versions_open | proj_wbs_versions | yes | 20261107000150_proj_structure.up.sql |
| ux_proj_work_packages_code | proj_work_packages | yes | 20261107000150_proj_structure.up.sql |
| ix_proj_work_packages_company_id | proj_work_packages | no | 20261107000150_proj_structure.up.sql |
| ix_proj_work_packages_project | proj_work_packages | no | 20261107000150_proj_structure.up.sql |
| ix_proj_work_packages_owner | proj_work_packages | no | 20261107000150_proj_structure.up.sql |
| ux_proj_locations_code | proj_locations | yes | 20261107000150_proj_structure.up.sql |
| ix_proj_locations_parent_id | proj_locations | no | 20261107000150_proj_structure.up.sql |
| ix_proj_locations_company_id | proj_locations | no | 20261107000150_proj_structure.up.sql |
| ix_proj_locations_parent | proj_locations | no | 20261107000150_proj_structure.up.sql |
| ux_proj_wbs_locations_cell | proj_wbs_locations | yes | 20261107000150_proj_structure.up.sql |
| ix_proj_wbs_locations_company_id | proj_wbs_locations | no | 20261107000150_proj_structure.up.sql |
| ix_proj_wbs_locations_project | proj_wbs_locations | no | 20261107000150_proj_structure.up.sql |
| ix_proj_wbs_locations_location | proj_wbs_locations | no | 20261107000150_proj_structure.up.sql |
| ux_proj_boq_versions_doc | proj_boq_versions | yes | 20261107000152_proj_boq.up.sql |
| ux_proj_boq_versions_no | proj_boq_versions | yes | 20261107000152_proj_boq.up.sql |
| ux_proj_boq_versions_contract | proj_boq_versions | yes | 20261107000152_proj_boq.up.sql |
| ix_proj_boq_versions_company_id | proj_boq_versions | no | 20261107000152_proj_boq.up.sql |
| ix_proj_boq_versions_status | proj_boq_versions | no | 20261107000152_proj_boq.up.sql |
| ix_proj_boq_versions_parent | proj_boq_versions | no | 20261107000152_proj_boq.up.sql |
| ux_proj_boq_lines_code | proj_boq_lines | yes | 20261107000152_proj_boq.up.sql |
| ix_proj_boq_lines_company_id | proj_boq_lines | no | 20261107000152_proj_boq.up.sql |
| ix_proj_boq_lines_parent | proj_boq_lines | no | 20261107000152_proj_boq.up.sql |
| ix_proj_boq_lines_parent_id | proj_boq_lines | no | 20261107000152_proj_boq.up.sql |
| ix_proj_boq_lines_work_item | proj_boq_lines | no | 20261107000152_proj_boq.up.sql |
| ix_proj_boq_lines_analysis | proj_boq_lines | no | 20261107000152_proj_boq.up.sql |
| ix_proj_boq_lines_cost_code | proj_boq_lines | no | 20261107000152_proj_boq.up.sql |
| ux_proj_boq_line_wbs | proj_boq_line_wbs | yes | 20261107000152_proj_boq.up.sql |
| ix_proj_boq_line_wbs_company_id | proj_boq_line_wbs | no | 20261107000152_proj_boq.up.sql |
| ix_proj_boq_line_wbs_wbs | proj_boq_line_wbs | no | 20261107000152_proj_boq.up.sql |
| ix_proj_boq_line_wbs_location | proj_boq_line_wbs | no | 20261107000152_proj_boq.up.sql |
| ix_proj_boq_line_norms_company_id | proj_boq_line_norms | no | 20261107000152_proj_boq.up.sql |
| ix_proj_boq_line_norms_line | proj_boq_line_norms | no | 20261107000152_proj_boq.up.sql |
| ix_proj_boq_line_norms_item | proj_boq_line_norms | no | 20261107000152_proj_boq.up.sql |
| ix_proj_boq_changes_company_id | proj_boq_changes | no | 20261107000152_proj_boq.up.sql |
| ix_proj_boq_changes_version | proj_boq_changes | no | 20261107000152_proj_boq.up.sql |
| ix_proj_boq_import_rows_company_id | proj_boq_import_rows | no | 20261107000152_proj_boq.up.sql |
| ix_proj_boq_import_rows_stage | proj_boq_import_rows | no | 20261107000152_proj_boq.up.sql |
| ix_proj_boq_import_rows_project | proj_boq_import_rows | no | 20261107000152_proj_boq.up.sql |
| ix_proj_team_company_id | proj_team | no | 20261107000154_proj_team_meetings.up.sql |
| ix_proj_team_project | proj_team | no | 20261107000154_proj_team_meetings.up.sql |
| ix_proj_team_user | proj_team | no | 20261107000154_proj_team_meetings.up.sql |
| ux_proj_team_open | proj_team | yes | 20261107000154_proj_team_meetings.up.sql |
| ix_proj_stakeholders_company_id | proj_stakeholders | no | 20261107000154_proj_team_meetings.up.sql |
| ix_proj_stakeholders_project | proj_stakeholders | no | 20261107000154_proj_team_meetings.up.sql |
| ix_proj_stakeholders_partner | proj_stakeholders | no | 20261107000154_proj_team_meetings.up.sql |
| ix_proj_comm_matrix_company_id | proj_comm_matrix | no | 20261107000154_proj_team_meetings.up.sql |
| ix_proj_comm_matrix_project | proj_comm_matrix | no | 20261107000154_proj_team_meetings.up.sql |
| ix_proj_comm_matrix_stakeholder | proj_comm_matrix | no | 20261107000154_proj_team_meetings.up.sql |
| ux_proj_meetings_doc | proj_meetings | yes | 20261107000154_proj_team_meetings.up.sql |
| ix_proj_meetings_company_id | proj_meetings | no | 20261107000154_proj_team_meetings.up.sql |
| ix_proj_meetings_project | proj_meetings | no | 20261107000154_proj_team_meetings.up.sql |
| ix_proj_meetings_status | proj_meetings | no | 20261107000154_proj_team_meetings.up.sql |
| ix_proj_meetings_supersedes | proj_meetings | no | 20261107000154_proj_team_meetings.up.sql |
| ix_proj_meeting_actions_company_id | proj_meeting_actions | no | 20261107000154_proj_team_meetings.up.sql |
| ix_proj_meeting_actions_meeting | proj_meeting_actions | no | 20261107000154_proj_team_meetings.up.sql |
| ix_proj_meeting_actions_project | proj_meeting_actions | no | 20261107000154_proj_team_meetings.up.sql |
| ix_proj_meeting_actions_owner | proj_meeting_actions | no | 20261107000154_proj_team_meetings.up.sql |
| ix_proj_meeting_actions_task | proj_meeting_actions | no | 20261107000154_proj_team_meetings.up.sql |
| ux_proj_risk_settings_project | proj_risk_settings | yes | 20261107000156_proj_risks.up.sql |
| ix_proj_risk_settings_company_id | proj_risk_settings | no | 20261107000156_proj_risks.up.sql |
| ux_proj_risks_doc | proj_risks | yes | 20261107000156_proj_risks.up.sql |
| ix_proj_risks_company_id | proj_risks | no | 20261107000156_proj_risks.up.sql |
| ix_proj_risks_project | proj_risks | no | 20261107000156_proj_risks.up.sql |
| ix_proj_risks_owner | proj_risks | no | 20261107000156_proj_risks.up.sql |
| ix_proj_risks_wbs | proj_risks | no | 20261107000156_proj_risks.up.sql |
| ix_proj_risks_cost_code | proj_risks | no | 20261107000156_proj_risks.up.sql |
| ix_proj_risks_level | proj_risks | no | 20261107000156_proj_risks.up.sql |
| ix_proj_risk_actions_company_id | proj_risk_actions | no | 20261107000156_proj_risks.up.sql |
| ix_proj_risk_actions_risk | proj_risk_actions | no | 20261107000156_proj_risks.up.sql |
| ix_proj_risk_actions_project | proj_risk_actions | no | 20261107000156_proj_risks.up.sql |
| ix_proj_risk_actions_owner | proj_risk_actions | no | 20261107000156_proj_risks.up.sql |
| ix_proj_risk_actions_task | proj_risk_actions | no | 20261107000156_proj_risks.up.sql |
| ix_proj_risk_triggers_company_id | proj_risk_triggers | no | 20261107000156_proj_risks.up.sql |
| ix_proj_risk_triggers_risk | proj_risk_triggers | no | 20261107000156_proj_risks.up.sql |
| ix_proj_risk_triggers_project | proj_risk_triggers | no | 20261107000156_proj_risks.up.sql |
| ix_proj_risk_contingency_company_id | proj_risk_contingency | no | 20261107000156_proj_risks.up.sql |
| ix_proj_risk_contingency_risk | proj_risk_contingency | no | 20261107000156_proj_risks.up.sql |
| ix_proj_risk_contingency_project | proj_risk_contingency | no | 20261107000156_proj_risks.up.sql |
| ux_proj_risk_issues_doc | proj_risk_issues | yes | 20261107000156_proj_risks.up.sql |
| ix_proj_risk_issues_company_id | proj_risk_issues | no | 20261107000156_proj_risks.up.sql |
| ix_proj_risk_issues_project | proj_risk_issues | no | 20261107000156_proj_risks.up.sql |
| ix_proj_risk_issues_risk | proj_risk_issues | no | 20261107000156_proj_risks.up.sql |
| ix_proj_risk_issues_owner | proj_risk_issues | no | 20261107000156_proj_risks.up.sql |
| ix_proj_risk_issues_wbs | proj_risk_issues | no | 20261107000156_proj_risks.up.sql |
| ux_proj_risk_snapshots_period | proj_risk_snapshots | yes | 20261107000156_proj_risks.up.sql |
| ix_proj_risk_snapshots_company_id | proj_risk_snapshots | no | 20261107000156_proj_risks.up.sql |
| ix_proj_risk_snapshots_project | proj_risk_snapshots | no | 20261107000156_proj_risks.up.sql |
| ux_gis_layers_name | gis_layers | yes | 20261107000158_gis.up.sql |
| ix_gis_layers_company_id | gis_layers | no | 20261107000158_gis.up.sql |
| ix_gis_layers_project | gis_layers | no | 20261107000158_gis.up.sql |
| ux_gis_overlays_name | gis_overlays | yes | 20261107000158_gis.up.sql |
| ix_gis_overlays_company_id | gis_overlays | no | 20261107000158_gis.up.sql |
| ix_gis_overlays_project | gis_overlays | no | 20261107000158_gis.up.sql |
| ix_gis_progress_company_id | gis_progress | no | 20261107000158_gis.up.sql |
| ix_gis_progress_project | gis_progress | no | 20261107000158_gis.up.sql |
| ix_gis_progress_location | gis_progress | no | 20261107000158_gis.up.sql |
| ux_proj_360_widgets_code | proj_360_widgets | yes | 20261107000161_proj_360.up.sql |
| ix_proj_360_widgets_company_id | proj_360_widgets | no | 20261107000161_proj_360.up.sql |
| ix_proj_360_widgets_tab | proj_360_widgets | no | 20261107000161_proj_360.up.sql |
| ux_engg_drawings_no | engg_drawings | yes | 20261108000163_engg_drawings.up.sql |
| ix_engg_drawings_company_id | engg_drawings | no | 20261108000163_engg_drawings.up.sql |
| ix_engg_drawings_project | engg_drawings | no | 20261108000163_engg_drawings.up.sql |
| ix_engg_drawings_wbs | engg_drawings | no | 20261108000163_engg_drawings.up.sql |
| ix_engg_drawings_location | engg_drawings | no | 20261108000163_engg_drawings.up.sql |
| ix_engg_drawings_document | engg_drawings | no | 20261108000163_engg_drawings.up.sql |
| ix_engg_drawings_planned | engg_drawings | no | 20261108000163_engg_drawings.up.sql |
| ux_engg_drawing_revisions_seq | engg_drawing_revisions | yes | 20261108000163_engg_drawings.up.sql |
| ix_engg_drawing_revisions_company_id | engg_drawing_revisions | no | 20261108000163_engg_drawings.up.sql |
| ix_engg_drawing_revisions_project | engg_drawing_revisions | no | 20261108000163_engg_drawings.up.sql |
| ix_engg_drawing_revisions_supersedes | engg_drawing_revisions | no | 20261108000163_engg_drawings.up.sql |
| ix_engg_drawing_revisions_superseded_by | engg_drawing_revisions | no | 20261108000163_engg_drawings.up.sql |
| ix_engg_drawing_revisions_file | engg_drawing_revisions | no | 20261108000163_engg_drawings.up.sql |
| ux_engg_drawing_links_target | engg_drawing_links | yes | 20261108000163_engg_drawings.up.sql |
| ix_engg_drawing_links_company_id | engg_drawing_links | no | 20261108000163_engg_drawings.up.sql |
| ix_engg_drawing_links_project | engg_drawing_links | no | 20261108000163_engg_drawings.up.sql |
| ux_engg_transmittals_doc | engg_transmittals | yes | 20261108000163_engg_drawings.up.sql |
| ix_engg_transmittals_company_id | engg_transmittals | no | 20261108000163_engg_drawings.up.sql |
| ix_engg_transmittals_project | engg_transmittals | no | 20261108000163_engg_drawings.up.sql |
| ix_engg_transmittals_due | engg_transmittals | no | 20261108000163_engg_drawings.up.sql |
| ux_engg_transmittal_items_pair | engg_transmittal_items | yes | 20261108000163_engg_drawings.up.sql |
| ix_engg_transmittal_items_company_id | engg_transmittal_items | no | 20261108000163_engg_drawings.up.sql |
| ix_engg_transmittal_items_drawing | engg_transmittal_items | no | 20261108000163_engg_drawings.up.sql |
| ix_engg_transmittal_items_revision_id | engg_transmittal_items | no | 20261108000163_engg_drawings.up.sql |
| ix_engg_transmittal_items_project | engg_transmittal_items | no | 20261108000163_engg_drawings.up.sql |
| ix_engg_copies_company_id | engg_copies | no | 20261108000163_engg_drawings.up.sql |
| ix_engg_copies_drawing | engg_copies | no | 20261108000163_engg_drawings.up.sql |
| ix_engg_copies_revision | engg_copies | no | 20261108000163_engg_drawings.up.sql |
| ix_engg_copies_holder | engg_copies | no | 20261108000163_engg_drawings.up.sql |
| ix_engg_copies_project | engg_copies | no | 20261108000163_engg_drawings.up.sql |
| ix_engg_copies_site | engg_copies | no | 20261108000163_engg_drawings.up.sql |
| ix_engg_copies_replaced | engg_copies | no | 20261108000163_engg_drawings.up.sql |
| ux_engg_rfis_no | engg_rfis | yes | 20261109000165_engg_rfis.up.sql |
| ix_engg_rfis_company_id | engg_rfis | no | 20261109000165_engg_rfis.up.sql |
| ix_engg_rfis_project | engg_rfis | no | 20261109000165_engg_rfis.up.sql |
| ix_engg_rfis_site | engg_rfis | no | 20261109000165_engg_rfis.up.sql |
| ix_engg_rfis_wbs | engg_rfis | no | 20261109000165_engg_rfis.up.sql |
| ix_engg_rfis_location | engg_rfis | no | 20261109000165_engg_rfis.up.sql |
| ix_engg_rfis_drawing | engg_rfis | no | 20261109000165_engg_rfis.up.sql |
| ix_engg_rfis_revision | engg_rfis | no | 20261109000165_engg_rfis.up.sql |
| ix_engg_rfis_response_revision | engg_rfis | no | 20261109000165_engg_rfis.up.sql |
| ix_engg_rfis_required | engg_rfis | no | 20261109000165_engg_rfis.up.sql |
| ix_engg_rfis_ball | engg_rfis | no | 20261109000165_engg_rfis.up.sql |
| ux_engg_rfi_routing_seq | engg_rfi_routing | yes | 20261109000165_engg_rfis.up.sql |
| ix_engg_rfi_routing_company_id | engg_rfi_routing | no | 20261109000165_engg_rfis.up.sql |
| ix_engg_rfi_routing_project | engg_rfi_routing | no | 20261109000165_engg_rfis.up.sql |
| ux_engg_rfi_delay_drafts_rfi | engg_rfi_delay_drafts | yes | 20261109000165_engg_rfis.up.sql |
| ix_engg_rfi_delay_drafts_company_id | engg_rfi_delay_drafts | no | 20261109000165_engg_rfis.up.sql |
| ix_engg_rfi_delay_drafts_project | engg_rfi_delay_drafts | no | 20261109000165_engg_rfis.up.sql |
| ux_engg_submittals_no | engg_submittals | yes | 20261110000167_engg_submittals.up.sql |
| ix_engg_submittals_company_id | engg_submittals | no | 20261110000167_engg_submittals.up.sql |
| ix_engg_submittals_project | engg_submittals | no | 20261110000167_engg_submittals.up.sql |
| ix_engg_submittals_wbs | engg_submittals | no | 20261110000167_engg_submittals.up.sql |
| ix_engg_submittals_item | engg_submittals | no | 20261110000167_engg_submittals.up.sql |
| ix_engg_submittals_drawing | engg_submittals | no | 20261110000167_engg_submittals.up.sql |
| ix_engg_submittals_required | engg_submittals | no | 20261110000167_engg_submittals.up.sql |
| ux_engg_submittal_revisions_rev | engg_submittal_revisions | yes | 20261110000167_engg_submittals.up.sql |
| ix_engg_submittal_revisions_company_id | engg_submittal_revisions | no | 20261110000167_engg_submittals.up.sql |
| ix_engg_submittal_revisions_project | engg_submittal_revisions | no | 20261110000167_engg_submittals.up.sql |
| ux_engg_approved_makes_submittal | engg_approved_makes | yes | 20261110000167_engg_submittals.up.sql |
| ix_engg_approved_makes_company_id | engg_approved_makes | no | 20261110000167_engg_submittals.up.sql |
| ix_engg_approved_makes_project | engg_approved_makes | no | 20261110000167_engg_submittals.up.sql |
| ix_engg_approved_makes_item | engg_approved_makes | no | 20261110000167_engg_submittals.up.sql |
| ux_engg_deliverables_no | engg_deliverables | yes | 20261111000169_engg_deliverables.up.sql |
| ix_engg_deliverables_company_id | engg_deliverables | no | 20261111000169_engg_deliverables.up.sql |
| ix_engg_deliverables_project | engg_deliverables | no | 20261111000169_engg_deliverables.up.sql |
| ix_engg_deliverables_drawing | engg_deliverables | no | 20261111000169_engg_deliverables.up.sql |
| ix_engg_deliverables_document | engg_deliverables | no | 20261111000169_engg_deliverables.up.sql |
| ux_engg_crs_no | engg_crs | yes | 20261111000169_engg_deliverables.up.sql |
| ix_engg_crs_company_id | engg_crs | no | 20261111000169_engg_deliverables.up.sql |
| ix_engg_crs_project | engg_crs | no | 20261111000169_engg_deliverables.up.sql |
| ux_engg_vdr_items_no | engg_vdr_items | yes | 20261111000169_engg_deliverables.up.sql |
| ix_engg_vdr_items_company_id | engg_vdr_items | no | 20261111000169_engg_deliverables.up.sql |
| ix_engg_vdr_items_project | engg_vdr_items | no | 20261111000169_engg_deliverables.up.sql |
| ix_engg_vdr_items_po | engg_vdr_items | no | 20261111000169_engg_deliverables.up.sql |
| ux_engg_holds_no | engg_holds | yes | 20261111000169_engg_deliverables.up.sql |
| ix_engg_holds_company_id | engg_holds | no | 20261111000169_engg_deliverables.up.sql |
| ix_engg_holds_deliverable | engg_holds | no | 20261111000169_engg_deliverables.up.sql |
| ix_engg_holds_project | engg_holds | no | 20261111000169_engg_deliverables.up.sql |
| ux_engg_letters_no | engg_letters | yes | 20261112000171_engg_letters.up.sql |
| ux_engg_letters_series | engg_letters | yes | 20261112000171_engg_letters.up.sql |
| ix_engg_letters_company_id | engg_letters | no | 20261112000171_engg_letters.up.sql |
| ix_engg_letters_project | engg_letters | no | 20261112000171_engg_letters.up.sql |
| ix_engg_letters_parent | engg_letters | no | 20261112000171_engg_letters.up.sql |
| ix_engg_letters_document | engg_letters | no | 20261112000171_engg_letters.up.sql |
| ix_engg_letters_due | engg_letters | no | 20261112000171_engg_letters.up.sql |
| ix_engg_letters_time_bar | engg_letters | no | 20261112000171_engg_letters.up.sql |
| ux_engg_letter_links_target | engg_letter_links | yes | 20261112000171_engg_letters.up.sql |
| ix_engg_letter_links_company_id | engg_letter_links | no | 20261112000171_engg_letters.up.sql |
| ix_engg_letter_links_entity | engg_letter_links | no | 20261112000171_engg_letters.up.sql |
| ux_engg_time_bars_no | engg_time_bars | yes | 20261112000171_engg_letters.up.sql |
| ix_engg_time_bars_company_id | engg_time_bars | no | 20261112000171_engg_letters.up.sql |
| ix_engg_time_bars_project | engg_time_bars | no | 20261112000171_engg_letters.up.sql |
| ix_engg_time_bars_trigger | engg_time_bars | no | 20261112000171_engg_letters.up.sql |
| ix_engg_time_bars_served | engg_time_bars | no | 20261112000171_engg_letters.up.sql |
| ux_bud_budgets_doc | bud_budgets | yes | 20261113000173_bud_budgets.up.sql |
| ux_bud_budgets_version | bud_budgets | yes | 20261113000173_bud_budgets.up.sql |
| ix_bud_budgets_company_id | bud_budgets | no | 20261113000173_bud_budgets.up.sql |
| ix_bud_budgets_status | bud_budgets | no | 20261113000173_bud_budgets.up.sql |
| ix_bud_budgets_project | bud_budgets | no | 20261113000173_bud_budgets.up.sql |
| ix_bud_budgets_pack | bud_budgets | no | 20261113000173_bud_budgets.up.sql |
| ix_bud_budgets_boq | bud_budgets | no | 20261113000173_bud_budgets.up.sql |
| ix_bud_budgets_parent | bud_budgets | no | 20261113000173_bud_budgets.up.sql |
| ix_bud_lines_company_id | bud_lines | no | 20261113000173_bud_budgets.up.sql |
| ix_bud_lines_budget | bud_lines | no | 20261113000173_bud_budgets.up.sql |
| ix_bud_lines_wbs | bud_lines | no | 20261113000173_bud_budgets.up.sql |
| ix_bud_lines_wp | bud_lines | no | 20261113000173_bud_budgets.up.sql |
| ix_bud_lines_boq | bud_lines | no | 20261113000173_bud_budgets.up.sql |
| ix_bud_lines_code | bud_lines | no | 20261113000173_bud_budgets.up.sql |
| ix_bud_lines_head | bud_lines | no | 20261113000173_bud_budgets.up.sql |
| ux_bud_phasing | bud_phasing | yes | 20261113000173_bud_budgets.up.sql |
| ix_bud_phasing_company_id | bud_phasing | no | 20261113000173_bud_budgets.up.sql |
| ix_bud_phasing_budget | bud_phasing | no | 20261113000173_bud_budgets.up.sql |
| ux_bud_changes_doc | bud_changes | yes | 20261114000175_bud_changes.up.sql |
| ux_bud_changes_variation | bud_changes | yes | 20261114000175_bud_changes.up.sql |
| ix_bud_changes_company_id | bud_changes | no | 20261114000175_bud_changes.up.sql |
| ix_bud_changes_status | bud_changes | no | 20261114000175_bud_changes.up.sql |
| ix_bud_changes_project | bud_changes | no | 20261114000175_bud_changes.up.sql |
| ix_bud_changes_budget | bud_changes | no | 20261114000175_bud_changes.up.sql |
| ix_bud_changes_risk | bud_changes | no | 20261114000175_bud_changes.up.sql |
| ix_bud_changes_result | bud_changes | no | 20261114000175_bud_changes.up.sql |
| ix_bud_changes_amends | bud_changes | no | 20261114000175_bud_changes.up.sql |
| ix_bud_change_lines_company_id | bud_change_lines | no | 20261114000175_bud_changes.up.sql |
| ix_bud_change_lines_change | bud_change_lines | no | 20261114000175_bud_changes.up.sql |
| ix_bud_change_lines_line | bud_change_lines | no | 20261114000175_bud_changes.up.sql |
| ix_bud_change_lines_wbs | bud_change_lines | no | 20261114000175_bud_changes.up.sql |
| ix_bud_change_lines_code | bud_change_lines | no | 20261114000175_bud_changes.up.sql |
| ux_bud_check_config_doc | bud_check_config | yes | 20261115000177_bud_ledger.up.sql |
| ux_bud_check_config_open | bud_check_config | yes | 20261115000177_bud_ledger.up.sql |
| ix_bud_check_config_company_id | bud_check_config | no | 20261115000177_bud_ledger.up.sql |
| ix_bud_check_config_head | bud_check_config | no | 20261115000177_bud_ledger.up.sql |
| ix_bud_check_config_status | bud_check_config | no | 20261115000177_bud_ledger.up.sql |
| ux_bud_commitments_src | bud_commitments | yes | 20261115000177_bud_ledger.up.sql |
| ix_bud_commitments_company_id | bud_commitments | no | 20261115000177_bud_ledger.up.sql |
| ix_bud_commitments_project | bud_commitments | no | 20261115000177_bud_ledger.up.sql |
| ix_bud_commitments_wbs | bud_commitments | no | 20261115000177_bud_ledger.up.sql |
| ix_bud_commitments_code | bud_commitments | no | 20261115000177_bud_ledger.up.sql |
| ix_bud_commitments_head | bud_commitments | no | 20261115000177_bud_ledger.up.sql |
| ix_bud_commitments_vendor | bud_commitments | no | 20261115000177_bud_ledger.up.sql |
| ix_bud_commitment_log_company_id | bud_commitment_log | no | 20261115000177_bud_ledger.up.sql |
| ix_bud_commitment_log_commitment | bud_commitment_log | no | 20261115000177_bud_ledger.up.sql |
| ux_bud_actuals_src | bud_actuals | yes | 20261115000177_bud_ledger.up.sql |
| ix_bud_actuals_company_id | bud_actuals | no | 20261115000177_bud_ledger.up.sql |
| ix_bud_actuals_project | bud_actuals | no | 20261115000177_bud_ledger.up.sql |
| ix_bud_actuals_wbs | bud_actuals | no | 20261115000177_bud_ledger.up.sql |
| ix_bud_actuals_code | bud_actuals | no | 20261115000177_bud_ledger.up.sql |
| ix_bud_actuals_head | bud_actuals | no | 20261115000177_bud_ledger.up.sql |
| ix_bud_actuals_commitment | bud_actuals | no | 20261115000177_bud_ledger.up.sql |
| ux_bud_dept_budgets_doc | bud_dept_budgets | yes | 20261116000179_bud_dept.up.sql |
| ux_bud_dept_budgets_version | bud_dept_budgets | yes | 20261116000179_bud_dept.up.sql |
| ux_bud_dept_budgets_inforce | bud_dept_budgets | yes | 20261116000179_bud_dept.up.sql |
| ux_bud_dept_budgets_open | bud_dept_budgets | yes | 20261116000179_bud_dept.up.sql |
| ix_bud_dept_budgets_company_id | bud_dept_budgets | no | 20261116000179_bud_dept.up.sql |
| ix_bud_dept_budgets_fy | bud_dept_budgets | no | 20261116000179_bud_dept.up.sql |
| ix_bud_dept_budgets_cc | bud_dept_budgets | no | 20261116000179_bud_dept.up.sql |
| ix_bud_dept_budgets_dept | bud_dept_budgets | no | 20261116000179_bud_dept.up.sql |
| ix_bud_dept_budgets_parent | bud_dept_budgets | no | 20261116000179_bud_dept.up.sql |
| ix_bud_dept_budgets_status | bud_dept_budgets | no | 20261116000179_bud_dept.up.sql |
| ux_bud_dept_lines_cell | bud_dept_lines | yes | 20261116000179_bud_dept.up.sql |
| ix_bud_dept_lines_company_id | bud_dept_lines | no | 20261116000179_bud_dept.up.sql |
| ix_bud_dept_lines_budget | bud_dept_lines | no | 20261116000179_bud_dept.up.sql |
| ix_bud_dept_lines_account | bud_dept_lines | no | 20261116000179_bud_dept.up.sql |
| ix_bud_dept_lines_period | bud_dept_lines | no | 20261116000179_bud_dept.up.sql |
| ux_bud_dept_actuals_src | bud_dept_actuals | yes | 20261116000179_bud_dept.up.sql |
| ix_bud_dept_actuals_company_id | bud_dept_actuals | no | 20261116000179_bud_dept.up.sql |
| ix_bud_dept_actuals_fy | bud_dept_actuals | no | 20261116000179_bud_dept.up.sql |
| ix_bud_dept_actuals_period | bud_dept_actuals | no | 20261116000179_bud_dept.up.sql |
| ix_bud_dept_actuals_cc | bud_dept_actuals | no | 20261116000179_bud_dept.up.sql |
| ix_bud_dept_actuals_account | bud_dept_actuals | no | 20261116000179_bud_dept.up.sql |
| ux_bud_alloc_rules_doc | bud_alloc_rules | yes | 20261116000179_bud_dept.up.sql |
| ux_bud_alloc_rules_name | bud_alloc_rules | yes | 20261116000179_bud_dept.up.sql |
| ix_bud_alloc_rules_company_id | bud_alloc_rules | no | 20261116000179_bud_dept.up.sql |
| ix_bud_alloc_rules_fy | bud_alloc_rules | no | 20261116000179_bud_dept.up.sql |
| ux_bud_alloc_runs_doc | bud_alloc_runs | yes | 20261116000179_bud_dept.up.sql |
| ux_bud_alloc_runs_once | bud_alloc_runs | yes | 20261116000179_bud_dept.up.sql |
| ix_bud_alloc_runs_company_id | bud_alloc_runs | no | 20261116000179_bud_dept.up.sql |
| ix_bud_alloc_runs_fy | bud_alloc_runs | no | 20261116000179_bud_dept.up.sql |
| ix_bud_alloc_runs_rule | bud_alloc_runs | no | 20261116000179_bud_dept.up.sql |
| ix_bud_alloc_runs_from | bud_alloc_runs | no | 20261116000179_bud_dept.up.sql |
| ix_bud_alloc_runs_to | bud_alloc_runs | no | 20261116000179_bud_dept.up.sql |
| ux_bud_alloc_lines_run_project | bud_alloc_lines | yes | 20261116000179_bud_dept.up.sql |
| ix_bud_alloc_lines_company_id | bud_alloc_lines | no | 20261116000179_bud_dept.up.sql |
| ix_bud_alloc_lines_run | bud_alloc_lines | no | 20261116000179_bud_dept.up.sql |
| ix_bud_alloc_lines_project | bud_alloc_lines | no | 20261116000179_bud_dept.up.sql |
| ix_bud_dept_actuals_report | bud_dept_actuals | no | 20261116000181_bud_dept_report_indexes.up.sql |
| ix_bud_dept_lines_report | bud_dept_lines | no | 20261116000181_bud_dept_report_indexes.up.sql |
| ux_plan_calendars_code | plan_calendars | yes | 20261117000182_plan_core.up.sql |
| ix_plan_calendars_company_id | plan_calendars | no | 20261117000182_plan_core.up.sql |
| ix_plan_calendars_project | plan_calendars | no | 20261117000182_plan_core.up.sql |
| ix_plan_calendars_holidays | plan_calendars | no | 20261117000182_plan_core.up.sql |
| ux_plan_schedules_doc | plan_schedules | yes | 20261117000182_plan_core.up.sql |
| ux_plan_schedules_version | plan_schedules | yes | 20261117000182_plan_core.up.sql |
| ux_plan_schedules_inforce | plan_schedules | yes | 20261117000182_plan_core.up.sql |
| ux_plan_schedules_open | plan_schedules | yes | 20261117000182_plan_core.up.sql |
| ix_plan_schedules_company_id | plan_schedules | no | 20261117000182_plan_core.up.sql |
| ix_plan_schedules_project | plan_schedules | no | 20261117000182_plan_core.up.sql |
| ix_plan_schedules_calendar | plan_schedules | no | 20261117000182_plan_core.up.sql |
| ix_plan_schedules_parent | plan_schedules | no | 20261117000182_plan_core.up.sql |
| ux_plan_activities_code | plan_activities | yes | 20261117000182_plan_core.up.sql |
| ix_plan_activities_company_id | plan_activities | no | 20261117000182_plan_core.up.sql |
| ix_plan_activities_schedule | plan_activities | no | 20261117000182_plan_core.up.sql |
| ix_plan_activities_wbs | plan_activities | no | 20261117000182_plan_core.up.sql |
| ix_plan_activities_location | plan_activities | no | 20261117000182_plan_core.up.sql |
| ix_plan_activities_calendar | plan_activities | no | 20261117000182_plan_core.up.sql |
| ix_plan_activities_critical | plan_activities | no | 20261117000182_plan_core.up.sql |
| ix_plan_activities_responsible | plan_activities | no | 20261117000182_plan_core.up.sql |
| ux_plan_dependencies_pair | plan_dependencies | yes | 20261117000182_plan_core.up.sql |
| ix_plan_dependencies_company_id | plan_dependencies | no | 20261117000182_plan_core.up.sql |
| ix_plan_dependencies_pred | plan_dependencies | no | 20261117000182_plan_core.up.sql |
| ix_plan_dependencies_succ | plan_dependencies | no | 20261117000182_plan_core.up.sql |
| ux_plan_activity_boq | plan_activity_boq | yes | 20261117000182_plan_core.up.sql |
| ix_plan_activity_boq_company_id | plan_activity_boq | no | 20261117000182_plan_core.up.sql |
| ix_plan_activity_boq_line | plan_activity_boq | no | 20261117000182_plan_core.up.sql |
| ux_plan_templates_code | plan_templates | yes | 20261117000182_plan_core.up.sql |
| ix_plan_templates_company_id | plan_templates | no | 20261117000182_plan_core.up.sql |
| ux_plan_activity_resources_key | plan_activity_resources | yes | 20261118000184_plan_gantt.up.sql |
| ix_plan_activity_resources_company_id | plan_activity_resources | no | 20261118000184_plan_gantt.up.sql |
| ix_plan_activity_resources_schedule | plan_activity_resources | no | 20261118000184_plan_gantt.up.sql |
| ix_plan_activity_resources_activity | plan_activity_resources | no | 20261118000184_plan_gantt.up.sql |
| ix_plan_activity_resources_item | plan_activity_resources | no | 20261118000184_plan_gantt.up.sql |
| ix_plan_resource_capacity_company_id | plan_resource_capacity | no | 20261118000184_plan_gantt.up.sql |
| ix_plan_resource_capacity_project | plan_resource_capacity | no | 20261118000184_plan_gantt.up.sql |
| ix_plan_resource_capacity_item | plan_resource_capacity | no | 20261118000184_plan_gantt.up.sql |
| ix_plan_gantt_edits_company_id | plan_gantt_edits | no | 20261118000184_plan_gantt.up.sql |
| ix_plan_gantt_edits_schedule | plan_gantt_edits | no | 20261118000184_plan_gantt.up.sql |
| ux_plan_baselines_doc | plan_baselines | yes | 20261119000186_plan_baselines.up.sql |
| ux_plan_baselines_no | plan_baselines | yes | 20261119000186_plan_baselines.up.sql |
| ux_plan_baselines_current | plan_baselines | yes | 20261119000186_plan_baselines.up.sql |
| ix_plan_baselines_company_id | plan_baselines | no | 20261119000186_plan_baselines.up.sql |
| ix_plan_baselines_project | plan_baselines | no | 20261119000186_plan_baselines.up.sql |
| ix_plan_baselines_schedule | plan_baselines | no | 20261119000186_plan_baselines.up.sql |
| ix_plan_baselines_previous | plan_baselines | no | 20261119000186_plan_baselines.up.sql |
| ix_plan_baselines_date | plan_baselines | no | 20261119000186_plan_baselines.up.sql |
| ix_plan_imports_company_id | plan_imports | no | 20261119000186_plan_baselines.up.sql |
| ix_plan_imports_project | plan_imports | no | 20261119000186_plan_baselines.up.sql |
| ix_plan_imports_schedule | plan_imports | no | 20261119000186_plan_baselines.up.sql |
| ix_plan_imports_file | plan_imports | no | 20261119000186_plan_baselines.up.sql |
| ix_plan_lookaheads_company_id | plan_lookaheads | no | 20261120000188_plan_lookahead.up.sql |
| ix_plan_lookaheads_project | plan_lookaheads | no | 20261120000188_plan_lookahead.up.sql |
| ix_plan_lookaheads_schedule | plan_lookaheads | no | 20261120000188_plan_lookahead.up.sql |
| ix_plan_lookaheads_site | plan_lookaheads | no | 20261120000188_plan_lookahead.up.sql |
| ix_plan_lookaheads_location | plan_lookaheads | no | 20261120000188_plan_lookahead.up.sql |
| ux_plan_constraints_auto | plan_constraints | yes | 20261120000188_plan_lookahead.up.sql |
| ix_plan_constraints_company_id | plan_constraints | no | 20261120000188_plan_lookahead.up.sql |
| ix_plan_constraints_project | plan_constraints | no | 20261120000188_plan_lookahead.up.sql |
| ix_plan_constraints_schedule | plan_constraints | no | 20261120000188_plan_lookahead.up.sql |
| ix_plan_constraints_activity | plan_constraints | no | 20261120000188_plan_lookahead.up.sql |
| ix_plan_constraints_source | plan_constraints | no | 20261120000188_plan_lookahead.up.sql |
| ix_plan_constraints_owner | plan_constraints | no | 20261120000188_plan_lookahead.up.sql |
| ux_plan_weekly_plans_doc | plan_weekly_plans | yes | 20261120000188_plan_lookahead.up.sql |
| ux_plan_weekly_plans_week | plan_weekly_plans | yes | 20261120000188_plan_lookahead.up.sql |
| ix_plan_weekly_plans_company_id | plan_weekly_plans | no | 20261120000188_plan_lookahead.up.sql |
| ix_plan_weekly_plans_project | plan_weekly_plans | no | 20261120000188_plan_lookahead.up.sql |
| ix_plan_weekly_plans_site | plan_weekly_plans | no | 20261120000188_plan_lookahead.up.sql |
| ix_plan_weekly_plans_schedule | plan_weekly_plans | no | 20261120000188_plan_lookahead.up.sql |
| ix_plan_weekly_plans_parent | plan_weekly_plans | no | 20261120000188_plan_lookahead.up.sql |
| ux_plan_weekly_items_line | plan_weekly_items | yes | 20261120000188_plan_lookahead.up.sql |
| ix_plan_weekly_items_company_id | plan_weekly_items | no | 20261120000188_plan_lookahead.up.sql |
| ix_plan_weekly_items_plan | plan_weekly_items | no | 20261120000188_plan_lookahead.up.sql |
| ix_plan_weekly_items_activity | plan_weekly_items | no | 20261120000188_plan_lookahead.up.sql |
| ix_plan_weekly_items_crew | plan_weekly_items | no | 20261120000188_plan_lookahead.up.sql |
| ux_plan_delays_doc | plan_delays | yes | 20261121000190_plan_delays.up.sql |
| ix_plan_delays_company_id | plan_delays | no | 20261121000190_plan_delays.up.sql |
| ix_plan_delays_project | plan_delays | no | 20261121000190_plan_delays.up.sql |
| ix_plan_delays_class | plan_delays | no | 20261121000190_plan_delays.up.sql |
| ix_plan_delays_schedule | plan_delays | no | 20261121000190_plan_delays.up.sql |
| ix_plan_delays_parent | plan_delays | no | 20261121000190_plan_delays.up.sql |
| ix_plan_delays_source | plan_delays | no | 20261121000190_plan_delays.up.sql |
| ix_plan_delays_tia | plan_delays | no | 20261121000190_plan_delays.up.sql |
| ix_plan_tia_company_id | plan_tia | no | 20261121000190_plan_delays.up.sql |
| ix_plan_tia_delay | plan_tia | no | 20261121000190_plan_delays.up.sql |
| ix_plan_tia_schedule | plan_tia | no | 20261121000190_plan_delays.up.sql |
| ux_plan_delay_evidence_link | plan_delay_evidence | yes | 20261121000190_plan_delays.up.sql |
| ix_plan_delay_evidence_company_id | plan_delay_evidence | no | 20261121000190_plan_delays.up.sql |
| ix_plan_delay_evidence_delay | plan_delay_evidence | no | 20261121000190_plan_delays.up.sql |
| ix_plan_delay_evidence_entity | plan_delay_evidence | no | 20261121000190_plan_delays.up.sql |
| ux_site_work_fronts_code | site_work_fronts | yes | 20261122000192_site_core.up.sql |
| ix_site_work_fronts_company_id | site_work_fronts | no | 20261122000192_site_core.up.sql |
| ix_site_work_fronts_project | site_work_fronts | no | 20261122000192_site_core.up.sql |
| ix_site_work_fronts_site | site_work_fronts | no | 20261122000192_site_core.up.sql |
| ix_site_work_fronts_location | site_work_fronts | no | 20261122000192_site_core.up.sql |
| ux_site_daily_plans_doc | site_daily_plans | yes | 20261122000192_site_core.up.sql |
| ux_site_daily_plans_day | site_daily_plans | yes | 20261122000192_site_core.up.sql |
| ix_site_daily_plans_company_id | site_daily_plans | no | 20261122000192_site_core.up.sql |
| ix_site_daily_plans_project | site_daily_plans | no | 20261122000192_site_core.up.sql |
| ix_site_daily_plans_site | site_daily_plans | no | 20261122000192_site_core.up.sql |
| ix_site_daily_plans_schedule | site_daily_plans | no | 20261122000192_site_core.up.sql |
| ix_site_daily_plans_weekly | site_daily_plans | no | 20261122000192_site_core.up.sql |
| ix_site_daily_plans_copied | site_daily_plans | no | 20261122000192_site_core.up.sql |
| ix_site_daily_plan_lines_company_id | site_daily_plan_lines | no | 20261122000192_site_core.up.sql |
| ix_site_daily_plan_lines_plan | site_daily_plan_lines | no | 20261122000192_site_core.up.sql |
| ix_site_daily_plan_lines_activity | site_daily_plan_lines | no | 20261122000192_site_core.up.sql |
| ix_site_daily_plan_lines_front | site_daily_plan_lines | no | 20261122000192_site_core.up.sql |
| ix_site_daily_plan_lines_crew | site_daily_plan_lines | no | 20261122000192_site_core.up.sql |
| ix_site_daily_plan_lines_weekly | site_daily_plan_lines | no | 20261122000192_site_core.up.sql |
| ix_site_daily_plan_lines_wa | site_daily_plan_lines | no | 20261122000192_site_core.up.sql |
| ux_site_work_authorisations_no | site_work_authorisations | yes | 20261122000192_site_core.up.sql |
| ix_site_work_authorisations_company_id | site_work_authorisations | no | 20261122000192_site_core.up.sql |
| ix_site_work_authorisations_project | site_work_authorisations | no | 20261122000192_site_core.up.sql |
| ix_site_work_authorisations_site | site_work_authorisations | no | 20261122000192_site_core.up.sql |
| ix_site_work_authorisations_front | site_work_authorisations | no | 20261122000192_site_core.up.sql |
| ix_site_work_authorisations_daily | site_work_authorisations | no | 20261122000192_site_core.up.sql |
| ix_site_work_authorisations_activity | site_work_authorisations | no | 20261122000192_site_core.up.sql |
| ix_site_work_authorisations_wbs | site_work_authorisations | no | 20261122000192_site_core.up.sql |
| ix_site_work_authorisations_location | site_work_authorisations | no | 20261122000192_site_core.up.sql |
| ix_site_work_authorisations_drawing | site_work_authorisations | no | 20261122000192_site_core.up.sql |
| ix_site_work_authorisations_parent | site_work_authorisations | no | 20261122000192_site_core.up.sql |
| ix_site_work_authorisations_supervisor | site_work_authorisations | no | 20261122000192_site_core.up.sql |
| ix_site_work_authorisations_emergency | site_work_authorisations | no | 20261122000192_site_core.up.sql |
| ix_site_wa_resources_company_id | site_wa_resources | no | 20261122000192_site_core.up.sql |
| ix_site_wa_resources_wa | site_wa_resources | no | 20261122000192_site_core.up.sql |
| ix_site_wa_resources_item | site_wa_resources | no | 20261122000192_site_core.up.sql |
| ix_site_wa_resources_crew | site_wa_resources | no | 20261122000192_site_core.up.sql |
| ux_site_wa_uses_source | site_wa_uses | yes | 20261122000192_site_core.up.sql |
| ix_site_wa_uses_company_id | site_wa_uses | no | 20261122000192_site_core.up.sql |
| ix_site_wa_uses_project | site_wa_uses | no | 20261122000192_site_core.up.sql |
| ix_site_wa_uses_wa | site_wa_uses | no | 20261122000192_site_core.up.sql |
| ux_site_dprs_doc | site_dprs | yes | 20261123000194_site_dpr.up.sql |
| ux_site_dprs_site_day | site_dprs | yes | 20261123000194_site_dpr.up.sql |
| ux_site_dprs_supervisor_day | site_dprs | yes | 20261123000194_site_dpr.up.sql |
| ix_site_dprs_company_id | site_dprs | no | 20261123000194_site_dpr.up.sql |
| ix_site_dprs_project | site_dprs | no | 20261123000194_site_dpr.up.sql |
| ix_site_dprs_site | site_dprs | no | 20261123000194_site_dpr.up.sql |
| ix_site_dprs_date | site_dprs | no | 20261123000194_site_dpr.up.sql |
| ix_site_dprs_front | site_dprs | no | 20261123000194_site_dpr.up.sql |
| ix_site_dprs_parent | site_dprs | no | 20261123000194_site_dpr.up.sql |
| ix_site_dprs_late | site_dprs | no | 20261123000194_site_dpr.up.sql |
| ix_site_dprs_supervisor | site_dprs | no | 20261123000194_site_dpr.up.sql |
| ix_site_dpr_work_company_id | site_dpr_work | no | 20261123000194_site_dpr.up.sql |
| ix_site_dpr_work_dpr | site_dpr_work | no | 20261123000194_site_dpr.up.sql |
| ix_site_dpr_work_wa | site_dpr_work | no | 20261123000194_site_dpr.up.sql |
| ix_site_dpr_work_activity | site_dpr_work | no | 20261123000194_site_dpr.up.sql |
| ix_site_dpr_work_location | site_dpr_work | no | 20261123000194_site_dpr.up.sql |
| ix_site_dpr_labour_company_id | site_dpr_labour | no | 20261123000194_site_dpr.up.sql |
| ix_site_dpr_labour_dpr | site_dpr_labour | no | 20261123000194_site_dpr.up.sql |
| ix_site_dpr_labour_contractor | site_dpr_labour | no | 20261123000194_site_dpr.up.sql |
| ix_site_dpr_labour_trade | site_dpr_labour | no | 20261123000194_site_dpr.up.sql |
| ix_site_dpr_materials_company_id | site_dpr_materials | no | 20261123000194_site_dpr.up.sql |
| ix_site_dpr_materials_dpr | site_dpr_materials | no | 20261123000194_site_dpr.up.sql |
| ix_site_dpr_materials_item | site_dpr_materials | no | 20261123000194_site_dpr.up.sql |
| ix_site_dpr_materials_wa | site_dpr_materials | no | 20261123000194_site_dpr.up.sql |
| ix_site_dpr_equipment_company_id | site_dpr_equipment | no | 20261123000194_site_dpr.up.sql |
| ix_site_dpr_equipment_dpr | site_dpr_equipment | no | 20261123000194_site_dpr.up.sql |
| ix_site_dpr_equipment_key | site_dpr_equipment | no | 20261123000194_site_dpr.up.sql |
| ux_site_dpr_photos_file | site_dpr_photos | yes | 20261123000194_site_dpr.up.sql |
| ix_site_dpr_photos_company_id | site_dpr_photos | no | 20261123000194_site_dpr.up.sql |
| ix_site_dpr_photos_file | site_dpr_photos | no | 20261123000194_site_dpr.up.sql |
| ix_site_dpr_photos_location | site_dpr_photos | no | 20261123000194_site_dpr.up.sql |
| ix_site_dpr_notes_company_id | site_dpr_notes | no | 20261123000194_site_dpr.up.sql |
| ix_site_dpr_notes_dpr | site_dpr_notes | no | 20261123000194_site_dpr.up.sql |
| ux_site_weather_site_day | site_weather | yes | 20261124000196_site_conditions.up.sql |
| ix_site_weather_company | site_weather | no | 20261124000196_site_conditions.up.sql |
| ix_site_weather_project | site_weather | no | 20261124000196_site_conditions.up.sql |
| ix_site_weather_shutdown | site_weather | no | 20261124000196_site_conditions.up.sql |
| ux_site_hindrances_doc | site_hindrances | yes | 20261124000196_site_conditions.up.sql |
| ix_site_hindrances_company | site_hindrances | no | 20261124000196_site_conditions.up.sql |
| ix_site_hindrances_project | site_hindrances | no | 20261124000196_site_conditions.up.sql |
| ix_site_hindrances_site | site_hindrances | no | 20261124000196_site_conditions.up.sql |
| ix_site_hindrances_letter | site_hindrances | no | 20261124000196_site_conditions.up.sql |
| ix_site_hindrances_parent | site_hindrances | no | 20261124000196_site_conditions.up.sql |
| ix_site_hindrances_open | site_hindrances | no | 20261124000196_site_conditions.up.sql |
| ix_site_diary_company | site_diary | no | 20261124000196_site_conditions.up.sql |
| ix_site_diary_site | site_diary | no | 20261124000196_site_conditions.up.sql |
| ix_site_diary_project | site_diary | no | 20261124000196_site_conditions.up.sql |
| ix_site_diary_unsigned | site_diary | no | 20261124000196_site_conditions.up.sql |
| ix_site_visitors_company | site_visitors | no | 20261124000196_site_conditions.up.sql |
| ix_site_visitors_site | site_visitors | no | 20261124000196_site_conditions.up.sql |
| ix_site_visitors_project | site_visitors | no | 20261124000196_site_conditions.up.sql |
| ix_site_visitors_letter | site_visitors | no | 20261124000196_site_conditions.up.sql |
| ux_site_instructions_doc | site_instructions | yes | 20261125000198_site_instructions.up.sql |
| ix_site_instructions_company | site_instructions | no | 20261125000198_site_instructions.up.sql |
| ix_site_instructions_project | site_instructions | no | 20261125000198_site_instructions.up.sql |
| ix_site_instructions_site | site_instructions | no | 20261125000198_site_instructions.up.sql |
| ix_site_instructions_type | site_instructions | no | 20261125000198_site_instructions.up.sql |
| ix_site_instructions_due | site_instructions | no | 20261125000198_site_instructions.up.sql |
| ix_site_instructions_location | site_instructions | no | 20261125000198_site_instructions.up.sql |
| ix_site_instructions_activity | site_instructions | no | 20261125000198_site_instructions.up.sql |
| ix_site_instructions_partner | site_instructions | no | 20261125000198_site_instructions.up.sql |
| ix_site_instructions_letter | site_instructions | no | 20261125000198_site_instructions.up.sql |
| ix_site_instructions_parent | site_instructions | no | 20261125000198_site_instructions.up.sql |
| ix_site_instruction_acks_instruction | site_instruction_acks | no | 20261125000198_site_instructions.up.sql |
| ix_site_instruction_acks_open | site_instruction_acks | no | 20261125000198_site_instructions.up.sql |
| ux_prs_periods_doc | prs_periods | yes | 20261126000200_site_progress.up.sql |
| ux_prs_periods_closed | prs_periods | yes | 20261126000200_site_progress.up.sql |
| ix_prs_periods_company | prs_periods | no | 20261126000200_site_progress.up.sql |
| ix_prs_periods_project | prs_periods | no | 20261126000200_site_progress.up.sql |
| ix_prs_periods_parent | prs_periods | no | 20261126000200_site_progress.up.sql |
| ix_prs_progress_project | prs_activity_progress | no | 20261126000200_site_progress.up.sql |
| ix_prs_progress_company | prs_activity_progress | no | 20261126000200_site_progress.up.sql |
| ix_prs_progress_activity | prs_activity_progress | no | 20261126000200_site_progress.up.sql |
| ix_prs_progress_dpr | prs_activity_progress | no | 20261126000200_site_progress.up.sql |
| ix_prs_progress_site | prs_activity_progress | no | 20261126000200_site_progress.up.sql |
| ix_prs_progress_period | prs_activity_progress | no | 20261126000200_site_progress.up.sql |
| ux_prs_evm | prs_evm | yes | 20261126000200_site_progress.up.sql |
| ix_prs_evm_project | prs_evm | no | 20261126000200_site_progress.up.sql |
| ix_prs_evm_company | prs_evm | no | 20261126000200_site_progress.up.sql |
| ix_prs_evm_wbs | prs_evm | no | 20261126000200_site_progress.up.sql |
| ux_prs_weights | prs_weights | yes | 20261126000200_site_progress.up.sql |
| ix_prs_weights_company | prs_weights | no | 20261126000200_site_progress.up.sql |
| ux_prod_norms_live | prod_norms | yes | 20261127000202_site_productivity.up.sql |
| ix_prod_norms_company | prod_norms | no | 20261127000202_site_productivity.up.sql |
| ix_prod_norms_project | prod_norms | no | 20261127000202_site_productivity.up.sql |
| ix_prod_norms_type | prod_norms | no | 20261127000202_site_productivity.up.sql |
| ix_prod_actuals_project | prod_actuals | no | 20261127000202_site_productivity.up.sql |
| ix_prod_actuals_site | prod_actuals | no | 20261127000202_site_productivity.up.sql |
| ix_prod_actuals_company | prod_actuals | no | 20261127000202_site_productivity.up.sql |
| ix_prod_actuals_type | prod_actuals | no | 20261127000202_site_productivity.up.sql |
| ix_prod_actuals_dpr | prod_actuals | no | 20261127000202_site_productivity.up.sql |
| ix_prod_actuals_crew | prod_actuals | no | 20261127000202_site_productivity.up.sql |
| ix_prod_actuals_contractor | prod_actuals | no | 20261127000202_site_productivity.up.sql |
| ix_prod_actuals_activity | prod_actuals | no | 20261127000202_site_productivity.up.sql |
| ix_prod_actuals_outlier | prod_actuals | no | 20261127000202_site_productivity.up.sql |
| ix_prod_losses_site | prod_losses | no | 20261127000202_site_productivity.up.sql |
| ix_prod_losses_project | prod_losses | no | 20261127000202_site_productivity.up.sql |
| ix_prod_losses_company | prod_losses | no | 20261127000202_site_productivity.up.sql |
| ux_prod_alerts_open | prod_alerts | yes | 20261127000202_site_productivity.up.sql |
| ix_prod_alerts_company | prod_alerts | no | 20261127000202_site_productivity.up.sql |
| ix_prod_alerts_project | prod_alerts | no | 20261127000202_site_productivity.up.sql |
| ux_ctl_facts_key | ctl_facts | yes | 20261128000204_site_control.up.sql |
| ix_ctl_facts_company | ctl_facts | no | 20261128000204_site_control.up.sql |
| ix_ctl_facts_wbs | ctl_facts | no | 20261128000204_site_control.up.sql |
| ix_ctl_facts_code | ctl_facts | no | 20261128000204_site_control.up.sql |
| ix_ctl_facts_period | ctl_facts | no | 20261128000204_site_control.up.sql |
| ux_ctl_unallocated_src | ctl_unallocated | yes | 20261128000204_site_control.up.sql |
| ix_ctl_unallocated_company | ctl_unallocated | no | 20261128000204_site_control.up.sql |
| ix_ctl_unallocated_project | ctl_unallocated | no | 20261128000204_site_control.up.sql |
| ix_ctl_unallocated_wbs | ctl_unallocated | no | 20261128000204_site_control.up.sql |
| ix_ctl_unallocated_code | ctl_unallocated | no | 20261128000204_site_control.up.sql |
| ix_ctl_recon_runs_company | ctl_recon_runs | no | 20261128000204_site_control.up.sql |
| ix_ctl_recon_runs_project | ctl_recon_runs | no | 20261128000204_site_control.up.sql |
| ux_proc_mr_doc | proc_material_requests | yes | 20261129000206_proc_requests.up.sql |
| ix_proc_mr_company | proc_material_requests | no | 20261129000206_proc_requests.up.sql |
| ix_proc_mr_project | proc_material_requests | no | 20261129000206_proc_requests.up.sql |
| ix_proc_mr_site | proc_material_requests | no | 20261129000206_proc_requests.up.sql |
| ix_proc_mr_wa | proc_material_requests | no | 20261129000206_proc_requests.up.sql |
| ix_proc_mr_activity | proc_material_requests | no | 20261129000206_proc_requests.up.sql |
| ix_proc_mr_parent | proc_material_requests | no | 20261129000206_proc_requests.up.sql |
| ux_proc_mr_lines_no | proc_mr_lines | yes | 20261129000206_proc_requests.up.sql |
| ix_proc_mr_lines_company | proc_mr_lines | no | 20261129000206_proc_requests.up.sql |
| ix_proc_mr_lines_item | proc_mr_lines | no | 20261129000206_proc_requests.up.sql |
| ix_proc_mr_lines_wbs | proc_mr_lines | no | 20261129000206_proc_requests.up.sql |
| ix_proc_mr_lines_code | proc_mr_lines | no | 20261129000206_proc_requests.up.sql |
| ux_proc_pr_doc | proc_requisitions | yes | 20261129000206_proc_requests.up.sql |
| ix_proc_pr_company | proc_requisitions | no | 20261129000206_proc_requests.up.sql |
| ix_proc_pr_project | proc_requisitions | no | 20261129000206_proc_requests.up.sql |
| ix_proc_pr_site | proc_requisitions | no | 20261129000206_proc_requests.up.sql |
| ix_proc_pr_parent | proc_requisitions | no | 20261129000206_proc_requests.up.sql |
| ix_proc_pr_emergency | proc_requisitions | no | 20261129000206_proc_requests.up.sql |
| ux_proc_pr_lines_no | proc_pr_lines | yes | 20261129000206_proc_requests.up.sql |
| ix_proc_pr_lines_company | proc_pr_lines | no | 20261129000206_proc_requests.up.sql |
| ix_proc_pr_lines_item | proc_pr_lines | no | 20261129000206_proc_requests.up.sql |
| ix_proc_pr_lines_site | proc_pr_lines | no | 20261129000206_proc_requests.up.sql |
| ix_proc_pr_lines_wbs | proc_pr_lines | no | 20261129000206_proc_requests.up.sql |
| ix_proc_pr_lines_code | proc_pr_lines | no | 20261129000206_proc_requests.up.sql |
| ix_proc_pr_lines_vendor | proc_pr_lines | no | 20261129000206_proc_requests.up.sql |
| ux_proc_pr_sources | proc_pr_sources | yes | 20261129000206_proc_requests.up.sql |
| ix_proc_pr_sources_company | proc_pr_sources | no | 20261129000206_proc_requests.up.sql |
| ix_proc_pr_sources_mr | proc_pr_sources | no | 20261129000206_proc_requests.up.sql |
| ux_proc_stock_levels | proc_stock_levels | yes | 20261129000206_proc_requests.up.sql |
| ix_proc_stock_levels_item | proc_stock_levels | no | 20261129000206_proc_requests.up.sql |
| ix_proc_stock_levels_site | proc_stock_levels | no | 20261129000206_proc_requests.up.sql |
| ux_proc_mrp_runs_doc | proc_mrp_runs | yes | 20261130000208_proc_mrp.up.sql |
| ix_proc_mrp_runs_company | proc_mrp_runs | no | 20261130000208_proc_mrp.up.sql |
| ix_proc_mrp_runs_project | proc_mrp_runs | no | 20261130000208_proc_mrp.up.sql |
| ix_proc_mrp_runs_schedule | proc_mrp_runs | no | 20261130000208_proc_mrp.up.sql |
| ix_proc_mrp_runs_parent | proc_mrp_runs | no | 20261130000208_proc_mrp.up.sql |
| ux_proc_mrp_lines | proc_mrp_lines | yes | 20261130000208_proc_mrp.up.sql |
| ix_proc_mrp_lines_company | proc_mrp_lines | no | 20261130000208_proc_mrp.up.sql |
| ix_proc_mrp_lines_item | proc_mrp_lines | no | 20261130000208_proc_mrp.up.sql |
| ix_proc_mrp_proposals_company | proc_mrp_proposals | no | 20261130000208_proc_mrp.up.sql |
| ix_proc_mrp_proposals_run | proc_mrp_proposals | no | 20261130000208_proc_mrp.up.sql |
| ix_proc_mrp_proposals_project | proc_mrp_proposals | no | 20261130000208_proc_mrp.up.sql |
| ix_proc_mrp_proposals_item | proc_mrp_proposals | no | 20261130000208_proc_mrp.up.sql |
| ix_proc_mrp_proposals_pr | proc_mrp_proposals | no | 20261130000208_proc_mrp.up.sql |
| ix_proc_mrp_proposals_vendor | proc_mrp_proposals | no | 20261130000208_proc_mrp.up.sql |
| ix_proc_mrp_proposals_sub | proc_mrp_proposals | no | 20261130000208_proc_mrp.up.sql |
| ux_proc_item_params_live | proc_item_params | yes | 20261130000208_proc_mrp.up.sql |
| ix_proc_item_params_company | proc_item_params | no | 20261130000208_proc_mrp.up.sql |
| ix_proc_item_params_item | proc_item_params | no | 20261130000208_proc_mrp.up.sql |
| ix_proc_item_params_vendor | proc_item_params | no | 20261130000208_proc_mrp.up.sql |
| ux_proc_open_supply | proc_open_supply | yes | 20261130000208_proc_mrp.up.sql |
| ix_proc_open_supply_item | proc_open_supply | no | 20261130000208_proc_mrp.up.sql |
| ix_proc_open_supply_project | proc_open_supply | no | 20261130000208_proc_mrp.up.sql |
| ux_proc_rfqs_doc | proc_rfqs | yes | 20261201000210_proc_rfq.up.sql |
| ix_proc_rfqs_company | proc_rfqs | no | 20261201000210_proc_rfq.up.sql |
| ix_proc_rfqs_project | proc_rfqs | no | 20261201000210_proc_rfq.up.sql |
| ix_proc_rfqs_parent | proc_rfqs | no | 20261201000210_proc_rfq.up.sql |
| ux_proc_rfq_lines_no | proc_rfq_lines | yes | 20261201000210_proc_rfq.up.sql |
| ix_proc_rfq_lines_company | proc_rfq_lines | no | 20261201000210_proc_rfq.up.sql |
| ix_proc_rfq_lines_pr | proc_rfq_lines | no | 20261201000210_proc_rfq.up.sql |
| ix_proc_rfq_lines_item | proc_rfq_lines | no | 20261201000210_proc_rfq.up.sql |
| ux_proc_rfq_vendors | proc_rfq_vendors | yes | 20261201000210_proc_rfq.up.sql |
| ux_proc_rfq_vendors_token | proc_rfq_vendors | yes | 20261201000210_proc_rfq.up.sql |
| ix_proc_rfq_vendors_company | proc_rfq_vendors | no | 20261201000210_proc_rfq.up.sql |
| ix_proc_rfq_vendors_vendor | proc_rfq_vendors | no | 20261201000210_proc_rfq.up.sql |
| ix_proc_rfq_vendors_status | proc_rfq_vendors | no | 20261201000210_proc_rfq.up.sql |
| ux_proc_quotations_doc | proc_quotations | yes | 20261201000210_proc_rfq.up.sql |
| ix_proc_quotations_company | proc_quotations | no | 20261201000210_proc_rfq.up.sql |
| ix_proc_quotations_rfq | proc_quotations | no | 20261201000210_proc_rfq.up.sql |
| ix_proc_quotations_vendor | proc_quotations | no | 20261201000210_proc_rfq.up.sql |
| ix_proc_quotations_project | proc_quotations | no | 20261201000210_proc_rfq.up.sql |
| ix_proc_quotations_parent | proc_quotations | no | 20261201000210_proc_rfq.up.sql |
| ux_proc_quotation_lines | proc_quotation_lines | yes | 20261201000210_proc_rfq.up.sql |
| ix_proc_quotation_lines_company | proc_quotation_lines | no | 20261201000210_proc_rfq.up.sql |
| ix_proc_quotation_lines_rfq_line | proc_quotation_lines | no | 20261201000210_proc_rfq.up.sql |
| ix_proc_rfq_clar_company | proc_rfq_clarifications | no | 20261201000210_proc_rfq.up.sql |
| ix_proc_rfq_clar_rfq | proc_rfq_clarifications | no | 20261201000210_proc_rfq.up.sql |
| ix_proc_rfq_clar_vendor | proc_rfq_clarifications | no | 20261201000210_proc_rfq.up.sql |
| ix_proc_rfq_lines_delivery_site_id | proc_rfq_lines | no | 20261201000210_proc_rfq.up.sql |
| ux_proc_cs_doc | proc_comparative_statements | yes | 20261202000212_proc_cs.up.sql |
| ix_proc_cs_company | proc_comparative_statements | no | 20261202000212_proc_cs.up.sql |
| ix_proc_cs_rfq | proc_comparative_statements | no | 20261202000212_proc_cs.up.sql |
| ix_proc_cs_project | proc_comparative_statements | no | 20261202000212_proc_cs.up.sql |
| ix_proc_cs_parent | proc_comparative_statements | no | 20261202000212_proc_cs.up.sql |
| ux_proc_cs_lines | proc_cs_lines | yes | 20261202000212_proc_cs.up.sql |
| ix_proc_cs_lines_company | proc_cs_lines | no | 20261202000212_proc_cs.up.sql |
| ix_proc_cs_lines_rfq_line | proc_cs_lines | no | 20261202000212_proc_cs.up.sql |
| ix_proc_cs_lines_vendor | proc_cs_lines | no | 20261202000212_proc_cs.up.sql |
| ix_proc_cs_lines_quotation | proc_cs_lines | no | 20261202000212_proc_cs.up.sql |
| ix_proc_cs_lines_quotation_line | proc_cs_lines | no | 20261202000212_proc_cs.up.sql |
| ix_proc_cs_neg_company | proc_cs_negotiations | no | 20261202000212_proc_cs.up.sql |
| ix_proc_cs_neg_cs | proc_cs_negotiations | no | 20261202000212_proc_cs.up.sql |
| ix_proc_cs_neg_vendor | proc_cs_negotiations | no | 20261202000212_proc_cs.up.sql |
| ix_proc_cs_neg_before | proc_cs_negotiations | no | 20261202000212_proc_cs.up.sql |
| ix_proc_cs_neg_after | proc_cs_negotiations | no | 20261202000212_proc_cs.up.sql |
| ux_proc_po_doc | proc_purchase_orders | yes | 20261203000214_proc_po.up.sql |
| ux_proc_po_token | proc_purchase_orders | yes | 20261203000214_proc_po.up.sql |
| ix_proc_po_company | proc_purchase_orders | no | 20261203000214_proc_po.up.sql |
| ix_proc_po_project | proc_purchase_orders | no | 20261203000214_proc_po.up.sql |
| ix_proc_po_vendor | proc_purchase_orders | no | 20261203000214_proc_po.up.sql |
| ix_proc_po_cs | proc_purchase_orders | no | 20261203000214_proc_po.up.sql |
| ix_proc_po_site | proc_purchase_orders | no | 20261203000214_proc_po.up.sql |
| ux_proc_po_lines_no | proc_po_lines | yes | 20261203000214_proc_po.up.sql |
| ix_proc_po_lines_company | proc_po_lines | no | 20261203000214_proc_po.up.sql |
| ix_proc_po_lines_pr | proc_po_lines | no | 20261203000214_proc_po.up.sql |
| ix_proc_po_lines_cs | proc_po_lines | no | 20261203000214_proc_po.up.sql |
| ix_proc_po_lines_item | proc_po_lines | no | 20261203000214_proc_po.up.sql |
| ix_proc_po_lines_wbs | proc_po_lines | no | 20261203000214_proc_po.up.sql |
| ix_proc_po_lines_cost_code | proc_po_lines | no | 20261203000214_proc_po.up.sql |
| ix_proc_po_lines_site | proc_po_lines | no | 20261203000214_proc_po.up.sql |
| ix_proc_po_sched_company | proc_po_schedules | no | 20261203000214_proc_po.up.sql |
| ix_proc_po_sched_po | proc_po_schedules | no | 20261203000214_proc_po.up.sql |
| ix_proc_po_sched_line | proc_po_schedules | no | 20261203000214_proc_po.up.sql |
| ix_proc_po_sched_due | proc_po_schedules | no | 20261203000214_proc_po.up.sql |
| ix_proc_po_amend_company | proc_po_amendments | no | 20261203000214_proc_po.up.sql |
| ix_proc_po_amend_po | proc_po_amendments | no | 20261203000214_proc_po.up.sql |
| ux_proc_dispatch_no | proc_dispatches | yes | 20261203000214_proc_po.up.sql |
| ix_proc_dispatch_po | proc_dispatches | no | 20261203000214_proc_po.up.sql |
| ix_proc_dispatch_arrival | proc_dispatches | no | 20261203000214_proc_po.up.sql |
| ux_proc_po_receipts | proc_po_receipts | yes | 20261203000214_proc_po.up.sql |
| ix_proc_po_receipts_po | proc_po_receipts | no | 20261203000214_proc_po.up.sql |
| ix_proc_po_receipts_line | proc_po_receipts | no | 20261203000214_proc_po.up.sql |
| ux_proc_po_adv_doc | proc_po_advances | yes | 20261203000214_proc_po.up.sql |
| ix_proc_po_adv_po | proc_po_advances | no | 20261203000214_proc_po.up.sql |
| ux_proc_price_indices | proc_price_indices | yes | 20261204000216_proc_rc_so.up.sql |
| ux_proc_rc_doc | proc_rate_contracts | yes | 20261204000216_proc_rc_so.up.sql |
| ix_proc_rc_company | proc_rate_contracts | no | 20261204000216_proc_rc_so.up.sql |
| ix_proc_rc_vendor | proc_rate_contracts | no | 20261204000216_proc_rc_so.up.sql |
| ix_proc_rc_valid | proc_rate_contracts | no | 20261204000216_proc_rc_so.up.sql |
| ix_proc_rc_parent | proc_rate_contracts | no | 20261204000216_proc_rc_so.up.sql |
| ux_proc_rc_lines | proc_rc_lines | yes | 20261204000216_proc_rc_so.up.sql |
| ix_proc_rc_lines_company | proc_rc_lines | no | 20261204000216_proc_rc_so.up.sql |
| ix_proc_rc_lines_item | proc_rc_lines | no | 20261204000216_proc_rc_so.up.sql |
| ix_proc_rc_rev_company | proc_rc_revisions | no | 20261204000216_proc_rc_so.up.sql |
| ix_proc_rc_rev_rc | proc_rc_revisions | no | 20261204000216_proc_rc_so.up.sql |
| ux_proc_so_doc | proc_service_orders | yes | 20261204000216_proc_rc_so.up.sql |
| ix_proc_so_company | proc_service_orders | no | 20261204000216_proc_rc_so.up.sql |
| ix_proc_so_project | proc_service_orders | no | 20261204000216_proc_rc_so.up.sql |
| ix_proc_so_vendor | proc_service_orders | no | 20261204000216_proc_rc_so.up.sql |
| ix_proc_so_site | proc_service_orders | no | 20261204000216_proc_rc_so.up.sql |
| ix_proc_so_parent | proc_service_orders | no | 20261204000216_proc_rc_so.up.sql |
| ux_proc_so_lines | proc_so_lines | yes | 20261204000216_proc_rc_so.up.sql |
| ix_proc_so_lines_company | proc_so_lines | no | 20261204000216_proc_rc_so.up.sql |
| ix_proc_so_lines_wbs | proc_so_lines | no | 20261204000216_proc_rc_so.up.sql |
| ix_proc_so_lines_cost_code | proc_so_lines | no | 20261204000216_proc_rc_so.up.sql |
| ux_proc_se_doc | proc_service_entries | yes | 20261204000216_proc_rc_so.up.sql |
| ix_proc_se_company | proc_service_entries | no | 20261204000216_proc_rc_so.up.sql |
| ix_proc_se_so | proc_service_entries | no | 20261204000216_proc_rc_so.up.sql |
| ix_proc_se_project | proc_service_entries | no | 20261204000216_proc_rc_so.up.sql |
| ix_proc_se_parent | proc_service_entries | no | 20261204000216_proc_rc_so.up.sql |
| ux_proc_se_lines | proc_se_lines | yes | 20261204000216_proc_rc_so.up.sql |
| ix_proc_se_lines_company | proc_se_lines | no | 20261204000216_proc_rc_so.up.sql |
| ix_proc_se_lines_so_line | proc_se_lines | no | 20261204000216_proc_rc_so.up.sql |
| ux_proc_po_rc_po | proc_po_rc | yes | 20261204000216_proc_rc_so.up.sql |
| ix_proc_po_rc_company | proc_po_rc | no | 20261204000216_proc_rc_so.up.sql |
| ix_proc_po_rc_rc | proc_po_rc | no | 20261204000216_proc_rc_so.up.sql |
| ux_proc_po_line_rc_line | proc_po_line_rc | yes | 20261204000216_proc_rc_so.up.sql |
| ix_proc_po_line_rc_company | proc_po_line_rc | no | 20261204000216_proc_rc_so.up.sql |
| ix_proc_po_line_rc_rc | proc_po_line_rc | no | 20261204000216_proc_rc_so.up.sql |
| ux_xpd_plan_doc | xpd_expediting_plans | yes | 20261205000218_xpd_core.up.sql |
| ix_xpd_plan_company | xpd_expediting_plans | no | 20261205000218_xpd_core.up.sql |
| ix_xpd_plan_po | xpd_expediting_plans | no | 20261205000218_xpd_core.up.sql |
| ix_xpd_plan_project | xpd_expediting_plans | no | 20261205000218_xpd_core.up.sql |
| ix_xpd_plan_parent | xpd_expediting_plans | no | 20261205000218_xpd_core.up.sql |
| ux_xpd_ms_seq | xpd_milestones | yes | 20261205000218_xpd_core.up.sql |
| ix_xpd_ms_company | xpd_milestones | no | 20261205000218_xpd_core.up.sql |
| ix_xpd_ms_status | xpd_milestones | no | 20261205000218_xpd_core.up.sql |
| ux_xpd_insp_doc | xpd_inspections | yes | 20261205000218_xpd_core.up.sql |
| ux_xpd_insp_irn | xpd_inspections | yes | 20261205000218_xpd_core.up.sql |
| ix_xpd_insp_company | xpd_inspections | no | 20261205000218_xpd_core.up.sql |
| ix_xpd_insp_po | xpd_inspections | no | 20261205000218_xpd_core.up.sql |
| ix_xpd_insp_project | xpd_inspections | no | 20261205000218_xpd_core.up.sql |
| ix_xpd_insp_parent | xpd_inspections | no | 20261205000218_xpd_core.up.sql |
| ux_xpd_ship_doc | xpd_shipments | yes | 20261205000218_xpd_core.up.sql |
| ix_xpd_ship_company | xpd_shipments | no | 20261205000218_xpd_core.up.sql |
| ix_xpd_ship_po | xpd_shipments | no | 20261205000218_xpd_core.up.sql |
| ix_xpd_ship_project | xpd_shipments | no | 20261205000218_xpd_core.up.sql |
| ix_xpd_ship_irn | xpd_shipments | no | 20261205000218_xpd_core.up.sql |
| ix_xpd_ship_ev_company | xpd_shipment_events | no | 20261205000218_xpd_core.up.sql |
| ix_xpd_ship_ev_ship | xpd_shipment_events | no | 20261205000218_xpd_core.up.sql |
| ux_vnd_preq_doc | vnd_prequalifications | yes | 20261206000220_vnd_core.up.sql |
| ix_vnd_preq_list | vnd_prequalifications | no | 20261206000220_vnd_core.up.sql |
| ix_vnd_preq_partner | vnd_prequalifications | no | 20261206000220_vnd_core.up.sql |
| ix_vnd_preq_parent | vnd_prequalifications | no | 20261206000220_vnd_core.up.sql |
| ux_vnd_avl_key | vnd_avl | yes | 20261206000220_vnd_core.up.sql |
| ix_vnd_avl_list | vnd_avl | no | 20261206000220_vnd_core.up.sql |
| ix_vnd_avl_category | vnd_avl | no | 20261206000220_vnd_core.up.sql |
| ix_vnd_avl_prequal | vnd_avl | no | 20261206000220_vnd_core.up.sql |
| ix_vnd_avl_partner | vnd_avl | no | 20261206000220_vnd_core.up.sql |
| ux_vnd_score_key | vnd_scorecards | yes | 20261206000220_vnd_core.up.sql |
| ix_vnd_score_list | vnd_scorecards | no | 20261206000220_vnd_core.up.sql |
| ix_vnd_score_partner | vnd_scorecards | no | 20261206000220_vnd_core.up.sql |
| ix_vnd_input_key | vnd_score_inputs | no | 20261206000220_vnd_core.up.sql |
| ix_vnd_input_partner | vnd_score_inputs | no | 20261206000220_vnd_core.up.sql |
| ux_vnd_susp_doc | vnd_suspensions | yes | 20261206000220_vnd_core.up.sql |
| ix_vnd_susp_list | vnd_suspensions | no | 20261206000220_vnd_core.up.sql |
| ix_vnd_susp_partner | vnd_suspensions | no | 20261206000220_vnd_core.up.sql |
| ix_vnd_susp_score | vnd_suspensions | no | 20261206000220_vnd_core.up.sql |
| ux_vnd_action_doc | vnd_actions | yes | 20261206000220_vnd_core.up.sql |
| ix_vnd_action_list | vnd_actions | no | 20261206000220_vnd_core.up.sql |
| ix_vnd_action_partner | vnd_actions | no | 20261206000220_vnd_core.up.sql |
| ix_vnd_action_score | vnd_actions | no | 20261206000220_vnd_core.up.sql |
| ux_rti_obs_source | rti_observations | yes | 20261207000222_rti_core.up.sql |
| ix_rti_obs_item_id | rti_observations | no | 20261207000222_rti_core.up.sql |
| ix_rti_obs_item | rti_observations | no | 20261207000222_rti_core.up.sql |
| ix_rti_obs_project | rti_observations | no | 20261207000222_rti_core.up.sql |
| ix_rti_obs_vendor | rti_observations | no | 20261207000222_rti_core.up.sql |
| ix_rti_obs_supersedes | rti_observations | no | 20261207000222_rti_core.up.sql |
| ux_rti_idx_key | rti_indices | yes | 20261207000222_rti_core.up.sql |
| ux_inv_store_code | inv_stores | yes | 20261209000225_inv_core.up.sql |
| ix_inv_store_list | inv_stores | no | 20261209000225_inv_core.up.sql |
| ix_inv_store_project | inv_stores | no | 20261209000225_inv_core.up.sql |
| ix_inv_store_site | inv_stores | no | 20261209000225_inv_core.up.sql |
| ux_inv_chg_doc | inv_store_changes | yes | 20261209000225_inv_core.up.sql |
| ix_inv_chg_store | inv_store_changes | no | 20261209000225_inv_core.up.sql |
| ux_inv_bin_code | inv_bins | yes | 20261209000225_inv_core.up.sql |
| ix_inv_bin_company | inv_bins | no | 20261209000225_inv_core.up.sql |
| ux_inv_ledger_doc | inv_stock_ledger | yes | 20261209000225_inv_core.up.sql |
| ix_inv_ledger_card | inv_stock_ledger | no | 20261209000225_inv_core.up.sql |
| ix_inv_ledger_item_id | inv_stock_ledger | no | 20261209000225_inv_core.up.sql |
| ix_inv_ledger_store | inv_stock_ledger | no | 20261209000225_inv_core.up.sql |
| ix_inv_ledger_bin | inv_stock_ledger | no | 20261209000225_inv_core.up.sql |
| ix_inv_ledger_project | inv_stock_ledger | no | 20261209000225_inv_core.up.sql |
| ix_inv_ledger_source | inv_stock_ledger | no | 20261209000225_inv_core.up.sql |
| ix_inv_ledger_reverses | inv_stock_ledger | no | 20261209000225_inv_core.up.sql |
| ix_inv_ledger_counter | inv_stock_ledger | no | 20261209000225_inv_core.up.sql |
| ux_inv_bal_key | inv_balances | yes | 20261209000225_inv_core.up.sql |
| ix_inv_bal_item | inv_balances | no | 20261209000225_inv_core.up.sql |
| ix_inv_bal_item_id | inv_balances | no | 20261209000225_inv_core.up.sql |
| ix_inv_bal_store | inv_balances | no | 20261209000225_inv_core.up.sql |
| ix_inv_bal_bin | inv_balances | no | 20261209000225_inv_core.up.sql |
| ux_inv_val_key | inv_valuation | yes | 20261209000225_inv_core.up.sql |
| ix_inv_val_item | inv_valuation | no | 20261209000225_inv_core.up.sql |
| ix_inv_val_store_id | inv_valuation | no | 20261209000225_inv_core.up.sql |
| ix_inv_fifo_open | inv_fifo_layers | no | 20261209000225_inv_core.up.sql |
| ix_inv_fifo_ledger | inv_fifo_layers | no | 20261209000225_inv_core.up.sql |
| ix_inv_fifo_item_id | inv_fifo_layers | no | 20261209000225_inv_core.up.sql |
| ix_inv_fifo_store_id | inv_fifo_layers | no | 20261209000225_inv_core.up.sql |
| ux_inv_res_doc | inv_reservations | yes | 20261209000225_inv_core.up.sql |
| ix_inv_res_item | inv_reservations | no | 20261209000225_inv_core.up.sql |
| ix_inv_res_source | inv_reservations | no | 20261209000225_inv_core.up.sql |
| ix_inv_res_item_id | inv_reservations | no | 20261209000225_inv_core.up.sql |
| ix_inv_res_store_id | inv_reservations | no | 20261209000225_inv_core.up.sql |
| ux_inv_adj_doc | inv_adjustments | yes | 20261209000225_inv_core.up.sql |
| ix_inv_adj_list | inv_adjustments | no | 20261209000225_inv_core.up.sql |
| ix_inv_adj_store | inv_adjustments | no | 20261209000225_inv_core.up.sql |
| ux_inv_gapp_doc | inv_gate_appointments | yes | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gapp_list | inv_gate_appointments | no | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gapp_project | inv_gate_appointments | no | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gapp_site | inv_gate_appointments | no | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gapp_vendor | inv_gate_appointments | no | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gapp_po | inv_gate_appointments | no | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gapp_shipment | inv_gate_appointments | no | 20261209000227_inv_gate_core.up.sql |
| ux_inv_gin_doc | inv_gate_inward | yes | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gin_list | inv_gate_inward | no | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gin_project | inv_gate_inward | no | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gin_site | inv_gate_inward | no | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gin_appt | inv_gate_inward | no | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gin_vendor | inv_gate_inward | no | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gin_po | inv_gate_inward | no | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gin_shipment | inv_gate_inward | no | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gin_store | inv_gate_inward | no | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gin_vehicle | inv_gate_inward | no | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gwt_inward | inv_gate_weighments | no | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gwt_slip | inv_gate_weighments | no | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gwt_flag | inv_gate_weighments | no | 20261209000227_inv_gate_core.up.sql |
| ux_inv_gps_doc | inv_gate_passes | yes | 20261209000227_inv_gate_core.up.sql |
| ux_inv_gps_qr | inv_gate_passes | yes | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gps_list | inv_gate_passes | no | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gps_project | inv_gate_passes | no | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gps_site | inv_gate_passes | no | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gps_vendor | inv_gate_passes | no | 20261209000227_inv_gate_core.up.sql |
| ix_inv_gps_overdue | inv_gate_passes | no | 20261209000227_inv_gate_core.up.sql |
| ux_inv_grn_doc | inv_grns | yes | 20261209000229_inv_grn_core.up.sql |
| ix_inv_grn_list | inv_grns | no | 20261209000229_inv_grn_core.up.sql |
| ix_inv_grn_project | inv_grns | no | 20261209000229_inv_grn_core.up.sql |
| ix_inv_grn_site | inv_grns | no | 20261209000229_inv_grn_core.up.sql |
| ix_inv_grn_store | inv_grns | no | 20261209000229_inv_grn_core.up.sql |
| ix_inv_grn_po | inv_grns | no | 20261209000229_inv_grn_core.up.sql |
| ix_inv_grn_gate | inv_grns | no | 20261209000229_inv_grn_core.up.sql |
| ix_inv_grn_vendor | inv_grns | no | 20261209000229_inv_grn_core.up.sql |
| ux_inv_grnl_no | inv_grn_lines | yes | 20261209000229_inv_grn_core.up.sql |
| ix_inv_grnl_po_line | inv_grn_lines | no | 20261209000229_inv_grn_core.up.sql |
| ix_inv_grnl_item | inv_grn_lines | no | 20261209000229_inv_grn_core.up.sql |
| ix_inv_grnl_cert | inv_grn_lines | no | 20261209000229_inv_grn_core.up.sql |
| ix_inv_grnl_wbs | inv_grn_lines | no | 20261209000229_inv_grn_core.up.sql |
| ix_inv_grnl_cost | inv_grn_lines | no | 20261209000229_inv_grn_core.up.sql |
| ix_inv_grnl_insp | inv_grn_lines | no | 20261209000229_inv_grn_core.up.sql |
| ux_inv_rtv_doc | inv_rtvs | yes | 20261209000229_inv_grn_core.up.sql |
| ix_inv_rtv_list | inv_rtvs | no | 20261209000229_inv_grn_core.up.sql |
| ix_inv_rtv_project | inv_rtvs | no | 20261209000229_inv_grn_core.up.sql |
| ix_inv_rtv_grn | inv_rtvs | no | 20261209000229_inv_grn_core.up.sql |
| ix_inv_rtv_vendor | inv_rtvs | no | 20261209000229_inv_grn_core.up.sql |
| ix_inv_rtv_store | inv_rtvs | no | 20261209000229_inv_grn_core.up.sql |
| ix_inv_rtv_pass | inv_rtvs | no | 20261209000229_inv_grn_core.up.sql |
| ux_inv_iss_doc | inv_issues | yes | 20261209000231_inv_issue_core.up.sql |
| ix_inv_iss_list | inv_issues | no | 20261209000231_inv_issue_core.up.sql |
| ix_inv_iss_project | inv_issues | no | 20261209000231_inv_issue_core.up.sql |
| ix_inv_iss_site | inv_issues | no | 20261209000231_inv_issue_core.up.sql |
| ix_inv_iss_store | inv_issues | no | 20261209000231_inv_issue_core.up.sql |
| ix_inv_iss_wa | inv_issues | no | 20261209000231_inv_issue_core.up.sql |
| ix_inv_iss_mr | inv_issues | no | 20261209000231_inv_issue_core.up.sql |
| ix_inv_iss_activity | inv_issues | no | 20261209000231_inv_issue_core.up.sql |
| ix_inv_iss_wbs | inv_issues | no | 20261209000231_inv_issue_core.up.sql |
| ix_inv_iss_cost | inv_issues | no | 20261209000231_inv_issue_core.up.sql |
| ix_inv_iss_to | inv_issues | no | 20261209000231_inv_issue_core.up.sql |
| ix_inv_iss_sig | inv_issues | no | 20261209000231_inv_issue_core.up.sql |
| ux_inv_issl_no | inv_issue_lines | yes | 20261209000231_inv_issue_core.up.sql |
| ix_inv_issl_company | inv_issue_lines | no | 20261209000231_inv_issue_core.up.sql |
| ix_inv_issl_item | inv_issue_lines | no | 20261209000231_inv_issue_core.up.sql |
| ix_inv_issl_mr | inv_issue_lines | no | 20261209000231_inv_issue_core.up.sql |
| ux_inv_ret_doc | inv_site_returns | yes | 20261209000231_inv_issue_core.up.sql |
| ix_inv_ret_list | inv_site_returns | no | 20261209000231_inv_issue_core.up.sql |
| ix_inv_ret_project | inv_site_returns | no | 20261209000231_inv_issue_core.up.sql |
| ix_inv_ret_store | inv_site_returns | no | 20261209000231_inv_issue_core.up.sql |
| ix_inv_ret_issue | inv_site_returns | no | 20261209000231_inv_issue_core.up.sql |
| ux_inv_cert_key | inv_sub_certified | yes | 20261209000231_inv_issue_core.up.sql |
| ix_inv_cert_sub | inv_sub_certified | no | 20261209000231_inv_issue_core.up.sql |
| ix_inv_cert_project | inv_sub_certified | no | 20261209000231_inv_issue_core.up.sql |
| ix_inv_cert_boq | inv_sub_certified | no | 20261209000231_inv_issue_core.up.sql |
| ux_inv_fil_key | inv_free_issue_ledger | yes | 20261209000231_inv_issue_core.up.sql |
| ix_inv_fil_sub | inv_free_issue_ledger | no | 20261209000231_inv_issue_core.up.sql |
| ix_inv_fil_item | inv_free_issue_ledger | no | 20261209000231_inv_issue_core.up.sql |
| ix_inv_fil_project | inv_free_issue_ledger | no | 20261209000231_inv_issue_core.up.sql |
| ux_inv_trf_doc | inv_transfers | yes | 20261209000233_inv_transfer_core.up.sql |
| ix_inv_trf_list | inv_transfers | no | 20261209000233_inv_transfer_core.up.sql |
| ix_inv_trf_from | inv_transfers | no | 20261209000233_inv_transfer_core.up.sql |
| ix_inv_trf_to | inv_transfers | no | 20261209000233_inv_transfer_core.up.sql |
| ix_inv_trf_fproject | inv_transfers | no | 20261209000233_inv_transfer_core.up.sql |
| ix_inv_trf_tproject | inv_transfers | no | 20261209000233_inv_transfer_core.up.sql |
| ix_inv_trf_mr | inv_transfers | no | 20261209000233_inv_transfer_core.up.sql |
| ix_inv_trf_pass | inv_transfers | no | 20261209000233_inv_transfer_core.up.sql |
| ux_inv_trfl_no | inv_transfer_lines | yes | 20261209000233_inv_transfer_core.up.sql |
| ix_inv_trfl_company | inv_transfer_lines | no | 20261209000233_inv_transfer_core.up.sql |
| ix_inv_trfl_item | inv_transfer_lines | no | 20261209000233_inv_transfer_core.up.sql |
| ix_inv_trfd_company | inv_transfer_discrepancies | no | 20261209000233_inv_transfer_core.up.sql |
| ix_inv_trfd_transfer | inv_transfer_discrepancies | no | 20261209000233_inv_transfer_core.up.sql |
| ix_inv_trfd_line | inv_transfer_discrepancies | no | 20261209000233_inv_transfer_core.up.sql |
| ux_inv_cpl_doc | inv_count_plans | yes | 20261209000235_inv_count_core.up.sql |
| ix_inv_cpl_list | inv_count_plans | no | 20261209000235_inv_count_core.up.sql |
| ix_inv_cpl_store | inv_count_plans | no | 20261209000235_inv_count_core.up.sql |
| ix_inv_cpl_project | inv_count_plans | no | 20261209000235_inv_count_core.up.sql |
| ix_inv_cpl_adj | inv_count_plans | no | 20261209000235_inv_count_core.up.sql |
| ux_inv_cln_no | inv_count_lines | yes | 20261209000235_inv_count_core.up.sql |
| ix_inv_cln_company | inv_count_lines | no | 20261209000235_inv_count_core.up.sql |
| ix_inv_cln_item | inv_count_lines | no | 20261209000235_inv_count_core.up.sql |
| ix_inv_cln_bin | inv_count_lines | no | 20261209000235_inv_count_core.up.sql |
| ix_inv_cln_owner | inv_count_lines | no | 20261209000235_inv_count_core.up.sql |
| ux_inv_scr_doc | inv_scrap_entries | yes | 20261209000235_inv_count_core.up.sql |
| ix_inv_scr_list | inv_scrap_entries | no | 20261209000235_inv_count_core.up.sql |
| ix_inv_scr_store | inv_scrap_entries | no | 20261209000235_inv_count_core.up.sql |
| ix_inv_scr_project | inv_scrap_entries | no | 20261209000235_inv_count_core.up.sql |
| ix_inv_scr_item | inv_scrap_entries | no | 20261209000235_inv_count_core.up.sql |
| ix_inv_scr_disposal | inv_scrap_entries | no | 20261209000235_inv_count_core.up.sql |
| ux_inv_dsp_doc | inv_scrap_disposals | yes | 20261209000235_inv_count_core.up.sql |
| ix_inv_dsp_list | inv_scrap_disposals | no | 20261209000235_inv_count_core.up.sql |
| ix_inv_dsp_store | inv_scrap_disposals | no | 20261209000235_inv_count_core.up.sql |
| ix_inv_dsp_project | inv_scrap_disposals | no | 20261209000235_inv_count_core.up.sql |
| ix_inv_dsp_buyer | inv_scrap_disposals | no | 20261209000235_inv_count_core.up.sql |
| ix_inv_dsp_pass | inv_scrap_disposals | no | 20261209000235_inv_count_core.up.sql |
| ux_inv_rop_key | inv_reorder_params | yes | 20261209000237_inv_reorder_core.up.sql |
| ix_inv_rop_store | inv_reorder_params | no | 20261209000237_inv_reorder_core.up.sql |
| ix_inv_rop_item | inv_reorder_params | no | 20261209000237_inv_reorder_core.up.sql |
| ix_inv_rop_project | inv_reorder_params | no | 20261209000237_inv_reorder_core.up.sql |
| ux_inv_roc_doc | inv_reorder_changes | yes | 20261209000237_inv_reorder_core.up.sql |
| ix_inv_roc_list | inv_reorder_changes | no | 20261209000237_inv_reorder_core.up.sql |
| ix_inv_roc_store | inv_reorder_changes | no | 20261209000237_inv_reorder_core.up.sql |
| ix_inv_roc_project | inv_reorder_changes | no | 20261209000237_inv_reorder_core.up.sql |
| ux_inv_rsg_doc | inv_reorder_suggestions | yes | 20261209000237_inv_reorder_core.up.sql |
| ux_inv_rsg_open | inv_reorder_suggestions | yes | 20261209000237_inv_reorder_core.up.sql |
| ix_inv_rsg_list | inv_reorder_suggestions | no | 20261209000237_inv_reorder_core.up.sql |
| ix_inv_rsg_item | inv_reorder_suggestions | no | 20261209000237_inv_reorder_core.up.sql |
| ix_inv_reorder_suggestions_param_id | inv_reorder_suggestions | no | 20261209000237_inv_reorder_core.up.sql |
| ix_inv_rsg_project | inv_reorder_suggestions | no | 20261209000237_inv_reorder_core.up.sql |
| ix_inv_lbl_list | inv_labels | no | 20261209000237_inv_reorder_core.up.sql |
| ix_inv_lbl_ref | inv_labels | no | 20261209000237_inv_reorder_core.up.sql |
| ix_inv_lbl_store | inv_labels | no | 20261209000237_inv_reorder_core.up.sql |
| ux_rta_asset_item | rta_assets | yes | 20261209000239_rta_core.up.sql |
| ix_rta_asset_item_id | rta_assets | no | 20261209000239_rta_core.up.sql |
| ux_rta_pos_key | rta_positions | yes | 20261209000239_rta_core.up.sql |
| ix_rta_pos_item | rta_positions | no | 20261209000239_rta_core.up.sql |
| ix_rta_pos_list | rta_positions | no | 20261209000239_rta_core.up.sql |
| ux_rta_mov_doc | rta_movements | yes | 20261209000239_rta_core.up.sql |
| ix_rta_mov_list | rta_movements | no | 20261209000239_rta_core.up.sql |
| ix_rta_mov_item | rta_movements | no | 20261209000239_rta_core.up.sql |
| ix_rta_mov_project | rta_movements | no | 20261209000239_rta_core.up.sql |
| ix_rta_mov_from | rta_movements | no | 20261209000239_rta_core.up.sql |
| ix_rta_mov_to | rta_movements | no | 20261209000239_rta_core.up.sql |
| ix_rta_mov_party | rta_movements | no | 20261209000239_rta_core.up.sql |
| ix_rta_mov_vendor | rta_movements | no | 20261209000239_rta_core.up.sql |
| ix_rta_mov_holding | rta_movements | no | 20261209000239_rta_core.up.sql |
| ix_rta_mov_dproject | rta_movements | no | 20261209000239_rta_core.up.sql |
| ix_rta_mov_dsite | rta_movements | no | 20261209000239_rta_core.up.sql |
| ix_rta_hire_list | rta_hire_periods | no | 20261209000239_rta_core.up.sql |
| ix_rta_hire_item | rta_hire_periods | no | 20261209000239_rta_core.up.sql |
| ix_rta_hire_vendor | rta_hire_periods | no | 20261209000239_rta_core.up.sql |
| ix_rta_hire_project | rta_hire_periods | no | 20261209000239_rta_core.up.sql |
| ix_rta_hire_movement | rta_hire_periods | no | 20261209000239_rta_core.up.sql |
| ix_rta_hire_holder | rta_hire_periods | no | 20261209000239_rta_core.up.sql |
| ux_rta_rec_doc | rta_damage_recoveries | yes | 20261209000239_rta_core.up.sql |
| ix_rta_rec_list | rta_damage_recoveries | no | 20261209000239_rta_core.up.sql |
| ix_rta_rec_movement | rta_damage_recoveries | no | 20261209000239_rta_core.up.sql |
| ix_rta_rec_item | rta_damage_recoveries | no | 20261209000239_rta_core.up.sql |
| ix_rta_rec_project | rta_damage_recoveries | no | 20261209000239_rta_core.up.sql |
| ix_rta_rec_party | rta_damage_recoveries | no | 20261209000239_rta_core.up.sql |
| ux_ast_doc | ast_small_assets | yes | 20261209000241_ast_core.up.sql |
| ux_ast_tag | ast_small_assets | yes | 20261209000241_ast_core.up.sql |
| ix_ast_list | ast_small_assets | no | 20261209000241_ast_core.up.sql |
| ix_ast_item | ast_small_assets | no | 20261209000241_ast_core.up.sql |
| ix_ast_store | ast_small_assets | no | 20261209000241_ast_core.up.sql |
| ix_ast_project | ast_small_assets | no | 20261209000241_ast_core.up.sql |
| ix_ast_custodian | ast_small_assets | no | 20261209000241_ast_core.up.sql |
| ix_ast_calibration | ast_small_assets | no | 20261209000241_ast_core.up.sql |
| ix_astlog_asset | ast_custody_log | no | 20261209000241_ast_core.up.sql |
| ix_astlog_list | ast_custody_log | no | 20261209000241_ast_core.up.sql |
| ix_astlog_to | ast_custody_log | no | 20261209000241_ast_core.up.sql |
| ux_astloss_doc | ast_loss_reports | yes | 20261209000241_ast_core.up.sql |
| ix_astloss_list | ast_loss_reports | no | 20261209000241_ast_core.up.sql |
| ix_astloss_asset | ast_loss_reports | no | 20261209000241_ast_core.up.sql |
| ix_astloss_project | ast_loss_reports | no | 20261209000241_ast_core.up.sql |
| ux_mrc_km_item | mrc_key_materials | yes | 20261209000243_mrc_core.up.sql |
| ix_mrc_km_item_id | mrc_key_materials | no | 20261209000243_mrc_core.up.sql |
| ux_mrc_doc | mrc_reconciliations | yes | 20261209000243_mrc_core.up.sql |
| ux_mrc_site_period | mrc_reconciliations | yes | 20261209000243_mrc_core.up.sql |
| ix_mrc_list | mrc_reconciliations | no | 20261209000243_mrc_core.up.sql |
| ix_mrc_project | mrc_reconciliations | no | 20261209000243_mrc_core.up.sql |
| ix_mrc_site | mrc_reconciliations | no | 20261209000243_mrc_core.up.sql |
| ux_mrc_line | mrc_lines | yes | 20261209000243_mrc_core.up.sql |
| ix_mrc_lines_company | mrc_lines | no | 20261209000243_mrc_core.up.sql |
| ix_mrc_lines_item | mrc_lines | no | 20261209000243_mrc_core.up.sql |
| ix_mrc_lines_party | mrc_lines | no | 20261209000243_mrc_core.up.sql |
| ix_mrc_contrib_recon | mrc_contributions | no | 20261209000243_mrc_core.up.sql |
| ix_mrc_contrib_line | mrc_contributions | no | 20261209000243_mrc_core.up.sql |
| ix_mrc_contrib_company | mrc_contributions | no | 20261209000243_mrc_core.up.sql |
| ux_plt_eq_doc | plt_equipment | yes | 20261209000246_plt_core.up.sql |
| ux_plt_eq_code | plt_equipment | yes | 20261209000246_plt_core.up.sql |
| ix_plt_eq_class | plt_equipment | no | 20261209000246_plt_core.up.sql |
| ix_plt_eq_owner | plt_equipment | no | 20261209000246_plt_core.up.sql |
| ix_plt_eq_project | plt_equipment | no | 20261209000246_plt_core.up.sql |
| ix_plt_eq_site | plt_equipment | no | 20261209000246_plt_core.up.sql |
| ix_plt_eq_list | plt_equipment | no | 20261209000246_plt_core.up.sql |
| ix_plt_eq_reg | plt_equipment | no | 20261209000246_plt_core.up.sql |
| ix_plt_doc_eq | plt_documents | no | 20261209000246_plt_core.up.sql |
| ix_plt_doc_expiry | plt_documents | no | 20261209000246_plt_core.up.sql |
| ix_plt_doc_file | plt_documents | no | 20261209000246_plt_core.up.sql |
| ix_plt_tl_eq | plt_timeline | no | 20261209000246_plt_core.up.sql |
| ix_plt_tl_project | plt_timeline | no | 20261209000246_plt_core.up.sql |
| ix_plt_documents_superseded_by | plt_documents | no | 20261209000246_plt_core.up.sql |
| ix_plt_timeline_org_site_id | plt_timeline | no | 20261209000246_plt_core.up.sql |
| ix_plt_timeline_company_id | plt_timeline | no | 20261209000246_plt_core.up.sql |
| ux_plt_req_doc | plt_requisitions | yes | 20261209000248_plt_alloc_core.up.sql |
| ix_plt_req_project | plt_requisitions | no | 20261209000248_plt_alloc_core.up.sql |
| ix_plt_req_site | plt_requisitions | no | 20261209000248_plt_alloc_core.up.sql |
| ix_plt_req_class | plt_requisitions | no | 20261209000248_plt_alloc_core.up.sql |
| ix_plt_req_activity | plt_requisitions | no | 20261209000248_plt_alloc_core.up.sql |
| ix_plt_req_list | plt_requisitions | no | 20261209000248_plt_alloc_core.up.sql |
| ux_plt_alloc_doc | plt_allocations | yes | 20261209000248_plt_alloc_core.up.sql |
| ix_plt_alloc_eq | plt_allocations | no | 20261209000248_plt_alloc_core.up.sql |
| ix_plt_alloc_project | plt_allocations | no | 20261209000248_plt_alloc_core.up.sql |
| ix_plt_alloc_site | plt_allocations | no | 20261209000248_plt_alloc_core.up.sql |
| ix_plt_alloc_req | plt_allocations | no | 20261209000248_plt_alloc_core.up.sql |
| ix_plt_alloc_from | plt_allocations | no | 20261209000248_plt_alloc_core.up.sql |
| ix_plt_alloc_gate | plt_allocations | no | 20261209000248_plt_alloc_core.up.sql |
| ix_plt_alloc_list | plt_allocations | no | 20261209000248_plt_alloc_core.up.sql |
| ix_plt_op_eq | plt_operator_assignments | no | 20261209000248_plt_alloc_core.up.sql |
| ix_plt_op_alloc | plt_operator_assignments | no | 20261209000248_plt_alloc_core.up.sql |
| ix_plt_op_person | plt_operator_assignments | no | 20261209000248_plt_alloc_core.up.sql |
| ux_plt_logs_doc | plt_logs | yes | 20261209000250_plt_log_core.up.sql |
| ix_plt_logs_eq | plt_logs | no | 20261209000250_plt_log_core.up.sql |
| ix_plt_logs_alloc | plt_logs | no | 20261209000250_plt_log_core.up.sql |
| ix_plt_logs_project | plt_logs | no | 20261209000250_plt_log_core.up.sql |
| ix_plt_logs_site | plt_logs | no | 20261209000250_plt_log_core.up.sql |
| ix_plt_logs_wa | plt_logs | no | 20261209000250_plt_log_core.up.sql |
| ix_plt_logs_activity | plt_logs | no | 20261209000250_plt_log_core.up.sql |
| ix_plt_logs_wbs | plt_logs | no | 20261209000250_plt_log_core.up.sql |
| ix_plt_logs_vendor | plt_logs | no | 20261209000250_plt_log_core.up.sql |
| ix_plt_logs_breakdown | plt_logs | no | 20261209000250_plt_log_core.up.sql |
| ix_plt_logs_photo | plt_logs | no | 20261209000250_plt_log_core.up.sql |
| ix_plt_logs_sign | plt_logs | no | 20261209000250_plt_log_core.up.sql |
| ix_plt_logs_list | plt_logs | no | 20261209000250_plt_log_core.up.sql |
| ux_plt_bd_doc | plt_breakdowns | yes | 20261209000250_plt_log_core.up.sql |
| ix_plt_bd_eq | plt_breakdowns | no | 20261209000250_plt_log_core.up.sql |
| ix_plt_bd_alloc | plt_breakdowns | no | 20261209000250_plt_log_core.up.sql |
| ix_plt_bd_project | plt_breakdowns | no | 20261209000250_plt_log_core.up.sql |
| ix_plt_bd_site | plt_breakdowns | no | 20261209000250_plt_log_core.up.sql |
| ux_plt_ft_code | plt_fuel_tanks | yes | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_ft_project | plt_fuel_tanks | no | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_ft_site | plt_fuel_tanks | no | 20261209000252_plt_fuel_core.up.sql |
| ux_plt_fr_doc | plt_fuel_receipts | yes | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fr_tank | plt_fuel_receipts | no | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fr_grn | plt_fuel_receipts | no | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fr_vendor | plt_fuel_receipts | no | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fr_project | plt_fuel_receipts | no | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fr_site | plt_fuel_receipts | no | 20261209000252_plt_fuel_core.up.sql |
| ux_plt_fi_doc | plt_fuel_issues | yes | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fi_tank | plt_fuel_issues | no | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fi_eq | plt_fuel_issues | no | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fi_alloc | plt_fuel_issues | no | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fi_project | plt_fuel_issues | no | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fi_site | plt_fuel_issues | no | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fi_prev | plt_fuel_issues | no | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fi_photo | plt_fuel_issues | no | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fi_list | plt_fuel_issues | no | 20261209000252_plt_fuel_core.up.sql |
| ux_plt_fd_tank_date | plt_fuel_dips | yes | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fd_company | plt_fuel_dips | no | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fd_photo | plt_fuel_dips | no | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fd_project | plt_fuel_dips | no | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fd_site | plt_fuel_dips | no | 20261209000252_plt_fuel_core.up.sql |
| ux_plt_fa_doc | plt_fuel_anomalies | yes | 20261209000252_plt_fuel_core.up.sql |
| ux_plt_fa_key | plt_fuel_anomalies | yes | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fa_eq | plt_fuel_anomalies | no | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fa_tank | plt_fuel_anomalies | no | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fa_issue | plt_fuel_anomalies | no | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fa_dip | plt_fuel_anomalies | no | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fa_log | plt_fuel_anomalies | no | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fa_project | plt_fuel_anomalies | no | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fa_site | plt_fuel_anomalies | no | 20261209000252_plt_fuel_core.up.sql |
| ix_plt_fa_list | plt_fuel_anomalies | no | 20261209000252_plt_fuel_core.up.sql |
| ux_plt_pmp_code | plt_pm_plans | yes | 20261209000254_plt_maint_core.up.sql |
| ix_plt_pmp_class | plt_pm_plans | no | 20261209000254_plt_maint_core.up.sql |
| ix_plt_pmp_equip | plt_pm_plans | no | 20261209000254_plt_maint_core.up.sql |
| ux_plt_pms_plan_eq | plt_pm_status | yes | 20261209000254_plt_maint_core.up.sql |
| ix_plt_pms_equip | plt_pm_status | no | 20261209000254_plt_maint_core.up.sql |
| ix_plt_pms_state | plt_pm_status | no | 20261209000254_plt_maint_core.up.sql |
| ux_plt_jc_doc | plt_job_cards | yes | 20261209000254_plt_maint_core.up.sql |
| ix_plt_jc_equip | plt_job_cards | no | 20261209000254_plt_maint_core.up.sql |
| ix_plt_jc_bd | plt_job_cards | no | 20261209000254_plt_maint_core.up.sql |
| ix_plt_jc_project | plt_job_cards | no | 20261209000254_plt_maint_core.up.sql |
| ix_plt_jc_site | plt_job_cards | no | 20261209000254_plt_maint_core.up.sql |
| ix_plt_jc_vendor | plt_job_cards | no | 20261209000254_plt_maint_core.up.sql |
| ix_plt_jc_status | plt_job_cards | no | 20261209000254_plt_maint_core.up.sql |
| ix_plt_js_job | plt_job_spares | no | 20261209000254_plt_maint_core.up.sql |
| ix_plt_js_item | plt_job_spares | no | 20261209000254_plt_maint_core.up.sql |
| ix_plt_js_store | plt_job_spares | no | 20261209000254_plt_maint_core.up.sql |
| ix_plt_js_resv | plt_job_spares | no | 20261209000254_plt_maint_core.up.sql |
| ix_plt_job_spares_company_id | plt_job_spares | no | 20261209000254_plt_maint_core.up.sql |
| ux_plt_ha_doc | plt_hire_agreements | yes | 20261209000256_plt_hire_core.up.sql |
| ix_plt_ha_equip | plt_hire_agreements | no | 20261209000256_plt_hire_core.up.sql |
| ix_plt_ha_partner | plt_hire_agreements | no | 20261209000256_plt_hire_core.up.sql |
| ix_plt_ha_project | plt_hire_agreements | no | 20261209000256_plt_hire_core.up.sql |
| ix_plt_ha_site | plt_hire_agreements | no | 20261209000256_plt_hire_core.up.sql |
| ix_plt_ha_status | plt_hire_agreements | no | 20261209000256_plt_hire_core.up.sql |
| ux_plt_hb_doc | plt_hire_bills | yes | 20261209000256_plt_hire_core.up.sql |
| ix_plt_hb_agr | plt_hire_bills | no | 20261209000256_plt_hire_core.up.sql |
| ix_plt_hb_status | plt_hire_bills | no | 20261209000256_plt_hire_core.up.sql |
| ix_plt_hb_period | plt_hire_bills | no | 20261209000256_plt_hire_core.up.sql |
| ix_plt_ci_equip | plt_cost_items | no | 20261209000258_plt_fleet_core.up.sql |
| ix_plt_ci_company | plt_cost_items | no | 20261209000258_plt_fleet_core.up.sql |
| ux_plt_cs_eq_period | plt_cost_snapshots | yes | 20261209000258_plt_fleet_core.up.sql |
| ix_plt_cs_company | plt_cost_snapshots | no | 20261209000258_plt_fleet_core.up.sql |
| ux_plt_tm_eq_ts | plt_telematics | yes | 20261209000258_plt_fleet_core.up.sql |
| ix_plt_tm_company | plt_telematics | no | 20261209000258_plt_fleet_core.up.sql |
| ux_plt_dr_doc | plt_disposal_recs | yes | 20261209000258_plt_fleet_core.up.sql |
| ix_plt_dr_equip | plt_disposal_recs | no | 20261209000258_plt_fleet_core.up.sql |
| ux_rp_demand_key | rp_demand | yes | 20261209000260_rp_core.up.sql |
| ix_rp_demand_company | rp_demand | no | 20261209000260_rp_core.up.sql |
| ux_rp_supply_key | rp_supply | yes | 20261209000260_rp_core.up.sql |
| ix_rp_supply_company | rp_supply | no | 20261209000260_rp_core.up.sql |
| ix_rp_supply_project | rp_supply | no | 20261209000260_rp_core.up.sql |
| ux_rp_plans_doc | rp_plans | yes | 20261209000260_rp_core.up.sql |
| ix_rp_plans_status | rp_plans | no | 20261209000260_rp_core.up.sql |
| ix_rp_requests_plan | rp_requests | no | 20261209000260_rp_core.up.sql |
| ix_rp_requests_from | rp_requests | no | 20261209000260_rp_core.up.sql |
| ix_rp_requests_to | rp_requests | no | 20261209000260_rp_core.up.sql |
| ix_rp_requests_company | rp_requests | no | 20261209000260_rp_core.up.sql |
| ux_qa_qp_doc | qa_quality_plans | yes | 20261209000262_qa_core.up.sql |
| ix_qa_qp_project | qa_quality_plans | no | 20261209000262_qa_core.up.sql |
| ix_qa_qp_site | qa_quality_plans | no | 20261209000262_qa_core.up.sql |
| ux_qa_itp_code | qa_itps | yes | 20261209000262_qa_core.up.sql |
| ix_qa_itp_type | qa_itps | no | 20261209000262_qa_core.up.sql |
| ix_qa_itp_project | qa_itps | no | 20261209000262_qa_core.up.sql |
| ux_qa_ct_code | qa_checklist_templates | yes | 20261209000262_qa_core.up.sql |
| ix_qa_ct_module | qa_checklist_templates | no | 20261209000262_qa_core.up.sql |
| ux_qa_in_doc | qa_inspections | yes | 20261209000262_qa_core.up.sql |
| ux_qa_in_client | qa_inspections | yes | 20261209000262_qa_core.up.sql |
| ix_qa_in_template | qa_inspections | no | 20261209000262_qa_core.up.sql |
| ix_qa_in_project | qa_inspections | no | 20261209000262_qa_core.up.sql |
| ix_qa_in_site | qa_inspections | no | 20261209000262_qa_core.up.sql |
| ix_qa_in_location | qa_inspections | no | 20261209000262_qa_core.up.sql |
| ix_qa_in_activity | qa_inspections | no | 20261209000262_qa_core.up.sql |
| ix_qa_in_wa | qa_inspections | no | 20261209000262_qa_core.up.sql |
| ix_qa_in_entity | qa_inspections | no | 20261209000262_qa_core.up.sql |
| ux_qa_ia_q | qa_inspection_answers | yes | 20261209000262_qa_core.up.sql |
| ix_qa_ia_company | qa_inspection_answers | no | 20261209000262_qa_core.up.sql |
| ux_qa_pp_key | qa_planned_points | yes | 20261209000262_qa_core.up.sql |
| ix_qa_pp_project | qa_planned_points | no | 20261209000262_qa_core.up.sql |
| ix_qa_pp_activity | qa_planned_points | no | 20261209000262_qa_core.up.sql |
| ix_qa_pp_location | qa_planned_points | no | 20261209000262_qa_core.up.sql |
| ix_qa_pp_wbs | qa_planned_points | no | 20261209000262_qa_core.up.sql |
| ix_qa_pp_inspection | qa_planned_points | no | 20261209000262_qa_core.up.sql |
| ix_qa_pp_company | qa_planned_points | no | 20261209000262_qa_core.up.sql |
| ux_qa_ir_doc | qa_inspection_requests | yes | 20261209000264_qa_requests.up.sql |
| ix_qa_ir_project | qa_inspection_requests | no | 20261209000264_qa_requests.up.sql |
| ix_qa_ir_site | qa_inspection_requests | no | 20261209000264_qa_requests.up.sql |
| ix_qa_ir_location | qa_inspection_requests | no | 20261209000264_qa_requests.up.sql |
| ix_qa_ir_activity | qa_inspection_requests | no | 20261209000264_qa_requests.up.sql |
| ix_qa_ir_wa | qa_inspection_requests | no | 20261209000264_qa_requests.up.sql |
| ix_qa_ir_point | qa_inspection_requests | no | 20261209000264_qa_requests.up.sql |
| ix_qa_ir_inspection | qa_inspection_requests | no | 20261209000264_qa_requests.up.sql |
| ix_qa_ir_reinspect | qa_inspection_requests | no | 20261209000264_qa_requests.up.sql |
| ux_qa_tc_code | qa_test_catalogue | yes | 20261209000266_qa_tests.up.sql |
| ix_qa_tc_category | qa_test_catalogue | no | 20261209000266_qa_tests.up.sql |
| ix_qa_tc_item | qa_test_catalogue | no | 20261209000266_qa_tests.up.sql |
| ux_qa_le_code | qa_lab_equipment | yes | 20261209000266_qa_tests.up.sql |
| ix_qa_le_project | qa_lab_equipment | no | 20261209000266_qa_tests.up.sql |
| ix_qa_le_site | qa_lab_equipment | no | 20261209000266_qa_tests.up.sql |
| ix_qa_le_due | qa_lab_equipment | no | 20261209000266_qa_tests.up.sql |
| ix_qa_le_cert | qa_lab_equipment | no | 20261209000266_qa_tests.up.sql |
| ux_qa_tr_doc | qa_test_requests | yes | 20261209000266_qa_tests.up.sql |
| ix_qa_tr_project | qa_test_requests | no | 20261209000266_qa_tests.up.sql |
| ix_qa_tr_site | qa_test_requests | no | 20261209000266_qa_tests.up.sql |
| ix_qa_tr_catalogue | qa_test_requests | no | 20261209000266_qa_tests.up.sql |
| ix_qa_tr_item | qa_test_requests | no | 20261209000266_qa_tests.up.sql |
| ix_qa_tr_grn | qa_test_requests | no | 20261209000266_qa_tests.up.sql |
| ix_qa_tr_line | qa_test_requests | no | 20261209000266_qa_tests.up.sql |
| ix_qa_tr_cert | qa_test_requests | no | 20261209000266_qa_tests.up.sql |
| ux_qa_trs_param | qa_test_results | yes | 20261209000266_qa_tests.up.sql |
| ix_qa_trs_company | qa_test_results | no | 20261209000266_qa_tests.up.sql |
| ix_qa_trs_equipment | qa_test_results | no | 20261209000266_qa_tests.up.sql |
| ix_qa_trs_cert | qa_test_results | no | 20261209000266_qa_tests.up.sql |
| ux_qa_ncr_doc | qa_ncrs | yes | 20261209000268_qa_ncr.up.sql |
| ix_qa_ncr_project | qa_ncrs | no | 20261209000268_qa_ncr.up.sql |
| ix_qa_ncr_site | qa_ncrs | no | 20261209000268_qa_ncr.up.sql |
| ix_qa_ncr_location | qa_ncrs | no | 20261209000268_qa_ncr.up.sql |
| ix_qa_ncr_activity | qa_ncrs | no | 20261209000268_qa_ncr.up.sql |
| ix_qa_ncr_responsible | qa_ncrs | no | 20261209000268_qa_ncr.up.sql |
| ix_qa_ncr_origin | qa_ncrs | no | 20261209000268_qa_ncr.up.sql |
| ix_qa_capa_company | qa_capa_actions | no | 20261209000268_qa_ncr.up.sql |
| ix_qa_capa_ncr | qa_capa_actions | no | 20261209000268_qa_ncr.up.sql |
| ux_qa_pc_doc | qa_pour_cards | yes | 20261209000270_qa_pour.up.sql |
| ix_qa_pc_project | qa_pour_cards | no | 20261209000270_qa_pour.up.sql |
| ix_qa_pc_site | qa_pour_cards | no | 20261209000270_qa_pour.up.sql |
| ix_qa_pc_location | qa_pour_cards | no | 20261209000270_qa_pour.up.sql |
| ix_qa_pc_activity | qa_pour_cards | no | 20261209000270_qa_pour.up.sql |
| ux_qa_pt_ticket | qa_pour_tickets | yes | 20261209000270_qa_pour.up.sql |
| ix_qa_pt_card | qa_pour_tickets | no | 20261209000270_qa_pour.up.sql |
| ix_qa_pt_vendor | qa_pour_tickets | no | 20261209000270_qa_pour.up.sql |
| ix_qa_pt_batch | qa_pour_tickets | no | 20261209000270_qa_pour.up.sql |
| ux_qa_cs_no | qa_cube_samples | yes | 20261209000270_qa_pour.up.sql |
| ix_qa_cs_card | qa_cube_samples | no | 20261209000270_qa_pour.up.sql |
| ix_qa_cs_ticket | qa_cube_samples | no | 20261209000270_qa_pour.up.sql |
| ix_qa_cs_due7 | qa_cube_samples | no | 20261209000270_qa_pour.up.sql |
| ix_qa_cs_due28 | qa_cube_samples | no | 20261209000270_qa_pour.up.sql |
| ux_qa_cr_age | qa_cube_results | yes | 20261209000270_qa_pour.up.sql |
| ix_qa_cr_company | qa_cube_results | no | 20261209000270_qa_pour.up.sql |
| ix_qa_cr_equipment | qa_cube_results | no | 20261209000270_qa_pour.up.sql |
| ix_qa_cr_ncr | qa_cube_results | no | 20261209000270_qa_pour.up.sql |
| ux_qa_sn_doc | qa_snags | yes | 20261209000272_qa_snags.up.sql |
| ix_qa_sn_project | qa_snags | no | 20261209000272_qa_snags.up.sql |
| ix_qa_sn_site | qa_snags | no | 20261209000272_qa_snags.up.sql |
| ix_qa_sn_location | qa_snags | no | 20261209000272_qa_snags.up.sql |
| ix_qa_sn_drawing | qa_snags | no | 20261209000272_qa_snags.up.sql |
| ix_qa_sn_responsible | qa_snags | no | 20261209000272_qa_snags.up.sql |
| ix_qa_sn_due | qa_snags | no | 20261209000272_qa_snags.up.sql |
| ix_qa_sn_inspection | qa_snags | no | 20261209000272_qa_snags.up.sql |
| ux_hse_pl_doc | hse_plans | yes | 20261209000275_hse_core.up.sql |
| ix_hse_pl_project | hse_plans | no | 20261209000275_hse_core.up.sql |
| ix_hse_pl_site | hse_plans | no | 20261209000275_hse_core.up.sql |
| ux_hse_hira_doc | hse_hira | yes | 20261209000275_hse_core.up.sql |
| ix_hse_hira_project | hse_hira | no | 20261209000275_hse_core.up.sql |
| ix_hse_hira_site | hse_hira | no | 20261209000275_hse_core.up.sql |
| ix_hse_hira_activity | hse_hira | no | 20261209000275_hse_core.up.sql |
| ux_hse_jsa_doc | hse_jsa | yes | 20261209000275_hse_core.up.sql |
| ix_hse_jsa_project | hse_jsa | no | 20261209000275_hse_core.up.sql |
| ix_hse_jsa_site | hse_jsa | no | 20261209000275_hse_core.up.sql |
| ix_hse_jsa_hira | hse_jsa | no | 20261209000275_hse_core.up.sql |
| ix_hse_jsa_wa | hse_jsa | no | 20261209000275_hse_core.up.sql |
| ix_hse_jsa_activity | hse_jsa | no | 20261209000275_hse_core.up.sql |
| ux_hse_ic_code | hse_induction_content | yes | 20261209000275_hse_core.up.sql |
| ix_hse_ic_project | hse_induction_content | no | 20261209000275_hse_core.up.sql |
| ix_hse_ic_site | hse_induction_content | no | 20261209000275_hse_core.up.sql |
| ux_hse_in_doc | hse_inductions | yes | 20261209000275_hse_core.up.sql |
| ix_hse_in_site | hse_inductions | no | 20261209000275_hse_core.up.sql |
| ix_hse_in_project | hse_inductions | no | 20261209000275_hse_core.up.sql |
| ix_hse_in_content | hse_inductions | no | 20261209000275_hse_core.up.sql |
| ix_hse_in_person | hse_inductions | no | 20261209000275_hse_core.up.sql |
| ux_hse_tt_code | hse_toolbox_topics | yes | 20261209000275_hse_core.up.sql |
| ux_hse_tk_doc | hse_toolbox_talks | yes | 20261209000275_hse_core.up.sql |
| ix_hse_tk_site | hse_toolbox_talks | no | 20261209000275_hse_core.up.sql |
| ix_hse_tk_project | hse_toolbox_talks | no | 20261209000275_hse_core.up.sql |
| ix_hse_tk_topic | hse_toolbox_talks | no | 20261209000275_hse_core.up.sql |
| ix_hse_med_worker | hse_medical_records | no | 20261209000275_hse_core.up.sql |
| ix_hse_med_company | hse_medical_records | no | 20261209000275_hse_core.up.sql |
| ux_hse_pt_code | hse_permit_types | yes | 20261209000277_hse_permits.up.sql |
| ix_hse_pt_template | hse_permit_types | no | 20261209000277_hse_permits.up.sql |
| ux_hse_pm_doc | hse_permits | yes | 20261209000277_hse_permits.up.sql |
| ix_hse_pm_site | hse_permits | no | 20261209000277_hse_permits.up.sql |
| ix_hse_pm_project | hse_permits | no | 20261209000277_hse_permits.up.sql |
| ix_hse_pm_type | hse_permits | no | 20261209000277_hse_permits.up.sql |
| ix_hse_pm_location | hse_permits | no | 20261209000277_hse_permits.up.sql |
| ix_hse_pm_wa | hse_permits | no | 20261209000277_hse_permits.up.sql |
| ix_hse_pm_jsa | hse_permits | no | 20261209000277_hse_permits.up.sql |
| ix_hse_pm_inspection | hse_permits | no | 20261209000277_hse_permits.up.sql |
| ix_hse_pm_window | hse_permits | no | 20261209000277_hse_permits.up.sql |
| ux_hse_inc_doc | hse_incidents | yes | 20261209000279_hse_incidents.up.sql |
| ix_hse_inc_site | hse_incidents | no | 20261209000279_hse_incidents.up.sql |
| ix_hse_inc_project | hse_incidents | no | 20261209000279_hse_incidents.up.sql |
| ix_hse_inc_location | hse_incidents | no | 20261209000279_hse_incidents.up.sql |
| ix_hse_inc_state | hse_incidents | no | 20261209000279_hse_incidents.up.sql |
| ix_hse_inc_lessons | hse_incidents | no | 20261209000279_hse_incidents.up.sql |
| ix_hse_ia_incident | hse_incident_actions | no | 20261209000279_hse_incidents.up.sql |
| ix_hse_ia_due | hse_incident_actions | no | 20261209000279_hse_incidents.up.sql |
| ux_hse_is_code | hse_inspection_schedules | yes | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_is_site | hse_inspection_schedules | no | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_is_project | hse_inspection_schedules | no | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_is_template | hse_inspection_schedules | no | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_is_inspection | hse_inspection_schedules | no | 20261209000281_hse_safety_ops.up.sql |
| ux_hse_ob_doc | hse_observations | yes | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_ob_site | hse_observations | no | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_ob_project | hse_observations | no | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_ob_party | hse_observations | no | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_ob_location | hse_observations | no | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_ob_schedule | hse_observations | no | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_ob_inspection | hse_observations | no | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_ob_due | hse_observations | no | 20261209000281_hse_safety_ops.up.sql |
| ux_hse_pp_code | hse_ppe_items | yes | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_pp_item | hse_ppe_items | no | 20261209000281_hse_safety_ops.up.sql |
| ux_hse_pi_doc | hse_ppe_issues | yes | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_pi_person | hse_ppe_issues | no | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_pi_item | hse_ppe_issues | no | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_pi_site | hse_ppe_issues | no | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_pi_project | hse_ppe_issues | no | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_pi_due | hse_ppe_issues | no | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_pi_replaces | hse_ppe_issues | no | 20261209000281_hse_safety_ops.up.sql |
| ux_hse_eq_tag | hse_equipment_register | yes | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_eq_site | hse_equipment_register | no | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_eq_project | hse_equipment_register | no | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_eq_location | hse_equipment_register | no | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_eq_inspection | hse_equipment_register | no | 20261209000281_hse_safety_ops.up.sql |
| ux_hse_cs_period | hse_contractor_scores | yes | 20261209000281_hse_safety_ops.up.sql |
| ix_hse_cs_partner | hse_contractor_scores | no | 20261209000281_hse_safety_ops.up.sql |
| ix_esg_rd_site | esg_readings | no | 20261209000283_esg_core.up.sql |
| ix_esg_rd_project | esg_readings | no | 20261209000283_esg_core.up.sql |
| ix_esg_rd_breach | esg_readings | no | 20261209000283_esg_core.up.sql |
| ux_esg_rd_pull | esg_readings | yes | 20261209000283_esg_core.up.sql |
| ix_esg_w_site | esg_waste | no | 20261209000283_esg_core.up.sql |
| ix_esg_w_project | esg_waste | no | 20261209000283_esg_core.up.sql |
| ix_esg_w_vendor | esg_waste | no | 20261209000283_esg_core.up.sql |
| ux_esg_ef_ver | esg_emission_factors | yes | 20261209000283_esg_core.up.sql |
| ix_esg_ef_metric | esg_emission_factors | no | 20261209000283_esg_core.up.sql |
| ux_esg_pm_no | esg_permits | yes | 20261209000283_esg_core.up.sql |
| ix_esg_pm_project | esg_permits | no | 20261209000283_esg_core.up.sql |
| ix_esg_pm_site | esg_permits | no | 20261209000283_esg_core.up.sql |
| ix_esg_waste_company_id | esg_waste | no | 20261209000283_esg_core.up.sql |
| ux_scy_post_code | scy_posts | yes | 20261209000285_scy_core.up.sql |
| ix_scy_post_site | scy_posts | no | 20261209000285_scy_core.up.sql |
| ix_scy_post_project | scy_posts | no | 20261209000285_scy_core.up.sql |
| ix_scy_post_agency | scy_posts | no | 20261209000285_scy_core.up.sql |
| ux_scy_cp_code | scy_checkpoints | yes | 20261209000285_scy_core.up.sql |
| ux_scy_cp_token | scy_checkpoints | yes | 20261209000285_scy_core.up.sql |
| ix_scy_cp_site | scy_checkpoints | no | 20261209000285_scy_core.up.sql |
| ix_scy_cp_post | scy_checkpoints | no | 20261209000285_scy_core.up.sql |
| ix_scy_ps_cp | scy_patrol_scans | no | 20261209000285_scy_core.up.sql |
| ix_scy_ps_site | scy_patrol_scans | no | 20261209000285_scy_core.up.sql |
| ix_scy_ps_guard | scy_patrol_scans | no | 20261209000285_scy_core.up.sql |
| ux_scy_ro_doc | scy_rosters | yes | 20261209000285_scy_core.up.sql |
| ix_scy_ro_site | scy_rosters | no | 20261209000285_scy_core.up.sql |
| ix_scy_ro_project | scy_rosters | no | 20261209000285_scy_core.up.sql |
| ux_scy_vi_doc | scy_visitors | yes | 20261209000285_scy_core.up.sql |
| ux_scy_vi_badge | scy_visitors | yes | 20261209000285_scy_core.up.sql |
| ix_scy_vi_site | scy_visitors | no | 20261209000285_scy_core.up.sql |
| ix_scy_vi_host | scy_visitors | no | 20261209000285_scy_core.up.sql |
| ix_scy_vi_project | scy_visitors | no | 20261209000285_scy_core.up.sql |
| ux_scy_in_doc | scy_incidents | yes | 20261209000285_scy_core.up.sql |
| ix_scy_in_site | scy_incidents | no | 20261209000285_scy_core.up.sql |
| ix_scy_in_project | scy_incidents | no | 20261209000285_scy_core.up.sql |
| ix_scy_in_post | scy_incidents | no | 20261209000285_scy_core.up.sql |
| ix_scy_ho_site | scy_handovers | no | 20261209000285_scy_core.up.sql |
| ix_scy_ho_post | scy_handovers | no | 20261209000285_scy_core.up.sql |
| ix_scy_ho_from | scy_handovers | no | 20261209000285_scy_core.up.sql |
| ix_scy_ho_to | scy_handovers | no | 20261209000285_scy_core.up.sql |
| ix_scy_handovers_company_id | scy_handovers | no | 20261209000285_scy_core.up.sql |
| ix_scy_patrol_scans_company_id | scy_patrol_scans | no | 20261209000285_scy_core.up.sql |
| ux_camp_code | camp_camps | yes | 20261209000287_camp_core.up.sql |
| ix_camp_site | camp_camps | no | 20261209000287_camp_core.up.sql |
| ix_camp_project | camp_camps | no | 20261209000287_camp_core.up.sql |
| ix_camp_location | camp_camps | no | 20261209000287_camp_core.up.sql |
| ux_camp_room | camp_rooms | yes | 20261209000287_camp_core.up.sql |
| ix_camp_room_status | camp_rooms | no | 20261209000287_camp_core.up.sql |
| ux_camp_al_doc | camp_allocations | yes | 20261209000287_camp_core.up.sql |
| ux_camp_al_bed | camp_allocations | yes | 20261209000287_camp_core.up.sql |
| ux_camp_al_person | camp_allocations | yes | 20261209000287_camp_core.up.sql |
| ix_camp_al_camp | camp_allocations | no | 20261209000287_camp_core.up.sql |
| ix_camp_al_contractor | camp_allocations | no | 20261209000287_camp_core.up.sql |
| ux_camp_meal | camp_meals | yes | 20261209000287_camp_core.up.sql |
| ix_camp_meal_date | camp_meals | no | 20261209000287_camp_core.up.sql |
| ix_camp_meal_contractor | camp_meals | no | 20261209000287_camp_core.up.sql |
| ix_camp_in_camp | camp_inspections | no | 20261209000287_camp_core.up.sql |
| ix_camp_in_inspection | camp_inspections | no | 20261209000287_camp_core.up.sql |
| ix_camp_in_observation | camp_inspections | no | 20261209000287_camp_core.up.sql |
| ix_camp_as_camp | camp_assets | no | 20261209000287_camp_core.up.sql |
| ux_camp_rc_doc | camp_recoveries | yes | 20261209000287_camp_core.up.sql |
| ix_camp_rc_contractor | camp_recoveries | no | 20261209000287_camp_core.up.sql |
| ix_camp_rc_camp | camp_recoveries | no | 20261209000287_camp_core.up.sql |
| ix_camp_rc_project | camp_recoveries | no | 20261209000287_camp_core.up.sql |
| ix_camp_assets_company_id | camp_assets | no | 20261209000287_camp_core.up.sql |
| ix_camp_inspections_company_id | camp_inspections | no | 20261209000287_camp_core.up.sql |
| ix_camp_meals_company_id | camp_meals | no | 20261209000287_camp_core.up.sql |
| ix_camp_recoveries_org_site_id | camp_recoveries | no | 20261209000287_camp_core.up.sql |
| ix_camp_rooms_company_id | camp_rooms | no | 20261209000287_camp_core.up.sql |
| ix_bp_plants_root | bp_plants | no | 20261209000290_rmc_core.up.sql |
| ux_bp_plants_doc | bp_plants | yes | 20261209000290_rmc_core.up.sql |
| ux_bp_plants_code | bp_plants | yes | 20261209000290_rmc_core.up.sql |
| ix_bp_plants_org_project_id | bp_plants | no | 20261209000290_rmc_core.up.sql |
| ix_bp_plants_org_site_id | bp_plants | no | 20261209000290_rmc_core.up.sql |
| ix_bp_plants_location_id | bp_plants | no | 20261209000290_rmc_core.up.sql |
| ix_bp_plants_equipment_id | bp_plants | no | 20261209000290_rmc_core.up.sql |
| ux_bp_silos_code | bp_silos | yes | 20261209000290_rmc_core.up.sql |
| ix_bp_silos_company_id | bp_silos | no | 20261209000290_rmc_core.up.sql |
| ix_bp_silos_item_id | bp_silos | no | 20261209000290_rmc_core.up.sql |
| ux_bp_scales_code | bp_scales | yes | 20261209000290_rmc_core.up.sql |
| ix_bp_scales_company_id | bp_scales | no | 20261209000290_rmc_core.up.sql |
| ux_bp_mix_doc | bp_mix_designs | yes | 20261209000290_rmc_core.up.sql |
| ux_bp_mix_code | bp_mix_designs | yes | 20261209000290_rmc_core.up.sql |
| ix_bp_mix_designs_plant_id | bp_mix_designs | no | 20261209000290_rmc_core.up.sql |
| ix_bp_mix_designs_org_project_id | bp_mix_designs | no | 20261209000290_rmc_core.up.sql |
| ix_bp_mix_designs_org_site_id | bp_mix_designs | no | 20261209000290_rmc_core.up.sql |
| ux_bp_req_doc | bp_requisitions | yes | 20261209000292_rmc_production.up.sql |
| ix_bp_requisitions_org_project_id | bp_requisitions | no | 20261209000292_rmc_production.up.sql |
| ix_bp_requisitions_org_site_id | bp_requisitions | no | 20261209000292_rmc_production.up.sql |
| ix_bp_requisitions_pour_card_id | bp_requisitions | no | 20261209000292_rmc_production.up.sql |
| ix_bp_requisitions_location_id | bp_requisitions | no | 20261209000292_rmc_production.up.sql |
| ix_bp_requisitions_plant_id | bp_requisitions | no | 20261209000292_rmc_production.up.sql |
| ix_bp_requisitions_mix_design_id | bp_requisitions | no | 20261209000292_rmc_production.up.sql |
| ix_bp_requisitions_supplier_id | bp_requisitions | no | 20261209000292_rmc_production.up.sql |
| ix_bp_req_board | bp_requisitions | no | 20261209000292_rmc_production.up.sql |
| ux_bp_batch_doc | bp_batches | yes | 20261209000292_rmc_production.up.sql |
| ux_bp_batch_ref | bp_batches | yes | 20261209000292_rmc_production.up.sql |
| ix_bp_batches_org_project_id | bp_batches | no | 20261209000292_rmc_production.up.sql |
| ix_bp_batches_org_site_id | bp_batches | no | 20261209000292_rmc_production.up.sql |
| ix_bp_batches_requisition_id | bp_batches | no | 20261209000292_rmc_production.up.sql |
| ix_bp_batches_mix_design_id | bp_batches | no | 20261209000292_rmc_production.up.sql |
| ix_bp_batch_time | bp_batches | no | 20261209000292_rmc_production.up.sql |
| ux_bp_tkt_doc | bp_delivery_tickets | yes | 20261209000292_rmc_production.up.sql |
| ux_bp_tkt_no | bp_delivery_tickets | yes | 20261209000292_rmc_production.up.sql |
| ix_bp_delivery_tickets_requisition_id | bp_delivery_tickets | no | 20261209000292_rmc_production.up.sql |
| ix_bp_delivery_tickets_plant_id | bp_delivery_tickets | no | 20261209000292_rmc_production.up.sql |
| ix_bp_delivery_tickets_supplier_id | bp_delivery_tickets | no | 20261209000292_rmc_production.up.sql |
| ix_bp_delivery_tickets_batch_id | bp_delivery_tickets | no | 20261209000292_rmc_production.up.sql |
| ix_bp_delivery_tickets_mix_design_id | bp_delivery_tickets | no | 20261209000292_rmc_production.up.sql |
| ix_bp_delivery_tickets_org_project_id | bp_delivery_tickets | no | 20261209000292_rmc_production.up.sql |
| ix_bp_delivery_tickets_org_site_id | bp_delivery_tickets | no | 20261209000292_rmc_production.up.sql |
| ix_bp_delivery_tickets_pour_ticket_id | bp_delivery_tickets | no | 20261209000292_rmc_production.up.sql |
| ix_bp_moves_company | bp_silo_moves | no | 20261209000292_rmc_production.up.sql |
| ix_bp_moves_silo | bp_silo_moves | no | 20261209000292_rmc_production.up.sql |
| ix_bp_moves_batch | bp_silo_moves | no | 20261209000292_rmc_production.up.sql |
| ux_bp_cp_doc | bp_cost_periods | yes | 20261209000294_rmc_costing.up.sql |
| ux_bp_cp_plant | bp_cost_periods | yes | 20261209000294_rmc_costing.up.sql |
| ix_bp_cost_periods_org_project_id | bp_cost_periods | no | 20261209000294_rmc_costing.up.sql |
| ix_bp_cost_periods_org_site_id | bp_cost_periods | no | 20261209000294_rmc_costing.up.sql |
| ix_bp_cost_lines_company_id | bp_cost_lines | no | 20261209000294_rmc_costing.up.sql |
| ix_bp_cost_lines_period_id | bp_cost_lines | no | 20261209000294_rmc_costing.up.sql |
| ux_bp_cg | bp_cost_grades | yes | 20261209000294_rmc_costing.up.sql |
| ix_bp_cost_grades_company_id | bp_cost_grades | no | 20261209000294_rmc_costing.up.sql |
| ux_bp_tr_doc | bp_transfer_rates | yes | 20261209000294_rmc_costing.up.sql |
| ix_bp_tr_plant | bp_transfer_rates | no | 20261209000294_rmc_costing.up.sql |
| ix_bp_transfer_rates_org_project_id | bp_transfer_rates | no | 20261209000294_rmc_costing.up.sql |
| ix_bp_transfer_rates_org_site_id | bp_transfer_rates | no | 20261209000294_rmc_costing.up.sql |
| ux_bp_ch | bp_charges | yes | 20261209000294_rmc_costing.up.sql |
| ix_bp_charges_company_id | bp_charges | no | 20261209000294_rmc_costing.up.sql |
| ix_bp_charges_plant_id | bp_charges | no | 20261209000294_rmc_costing.up.sql |
| ix_bp_charges_org_project_id | bp_charges | no | 20261209000294_rmc_costing.up.sql |
| ux_bp_bud | bp_budgets | yes | 20261209000294_rmc_costing.up.sql |
| ix_bp_budgets_company_id | bp_budgets | no | 20261209000294_rmc_costing.up.sql |
| ux_ctr_contracts_doc | ctr_contracts | yes | 20261209000296_ctr_core.up.sql |
| ux_ctr_contracts_no | ctr_contracts | yes | 20261209000296_ctr_core.up.sql |
| ix_ctr_contracts_org_project_id | ctr_contracts | no | 20261209000296_ctr_core.up.sql |
| ix_ctr_contracts_org_site_id | ctr_contracts | no | 20261209000296_ctr_core.up.sql |
| ix_ctr_contracts_client_partner_id | ctr_contracts | no | 20261209000296_ctr_core.up.sql |
| ix_ctr_contracts_baseline_pack_id | ctr_contracts | no | 20261209000296_ctr_core.up.sql |
| ux_ctr_clauses_no | ctr_clauses | yes | 20261209000296_ctr_core.up.sql |
| ix_ctr_clauses_company_id | ctr_clauses | no | 20261209000296_ctr_core.up.sql |
| ix_ctr_clauses_cat | ctr_clauses | no | 20261209000296_ctr_core.up.sql |
| ix_ctr_obligations_company_id | ctr_obligations | no | 20261209000296_ctr_core.up.sql |
| ix_ctr_obligations_contract_id | ctr_obligations | no | 20261209000296_ctr_core.up.sql |
| ix_ctr_obligations_clause_id | ctr_obligations | no | 20261209000296_ctr_core.up.sql |
| ix_ctr_obligations_previous_id | ctr_obligations | no | 20261209000296_ctr_core.up.sql |
| ix_ctr_obl_due | ctr_obligations | no | 20261209000296_ctr_core.up.sql |
| ux_ctr_ms_code | ctr_milestones | yes | 20261209000296_ctr_core.up.sql |
| ix_ctr_milestones_company_id | ctr_milestones | no | 20261209000296_ctr_core.up.sql |
| ux_ctr_amd_doc | ctr_amendments | yes | 20261209000296_ctr_core.up.sql |
| ix_ctr_amendments_contract_id | ctr_amendments | no | 20261209000296_ctr_core.up.sql |
| ix_ctr_amendments_org_project_id | ctr_amendments | no | 20261209000296_ctr_core.up.sql |
| ix_ctr_amendments_org_site_id | ctr_amendments | no | 20261209000296_ctr_core.up.sql |
| ix_ctr_value_log_company_id | ctr_value_log | no | 20261209000296_ctr_core.up.sql |
| ix_ctr_value_log_contract_id | ctr_value_log | no | 20261209000296_ctr_core.up.sql |
| ux_ctr_vlog_ref | ctr_value_log | yes | 20261209000296_ctr_core.up.sql |
| ux_ctr_bg_doc | ctr_bank_guarantees | yes | 20261209000298_ctr_securities.up.sql |
| ux_ctr_bg_no | ctr_bank_guarantees | yes | 20261209000298_ctr_securities.up.sql |
| ix_ctr_bank_guarantees_org_project_id | ctr_bank_guarantees | no | 20261209000298_ctr_securities.up.sql |
| ix_ctr_bank_guarantees_org_site_id | ctr_bank_guarantees | no | 20261209000298_ctr_securities.up.sql |
| ix_ctr_bank_guarantees_contract_id | ctr_bank_guarantees | no | 20261209000298_ctr_securities.up.sql |
| ix_ctr_bank_guarantees_partner_id | ctr_bank_guarantees | no | 20261209000298_ctr_securities.up.sql |
| ix_ctr_bank_guarantees_bank_id | ctr_bank_guarantees | no | 20261209000298_ctr_securities.up.sql |
| ix_ctr_bg_expiry | ctr_bank_guarantees | no | 20261209000298_ctr_securities.up.sql |
| ix_ctr_bg_events_company_id | ctr_bg_events | no | 20261209000298_ctr_securities.up.sql |
| ix_ctr_bg_events_bg_id | ctr_bg_events | no | 20261209000298_ctr_securities.up.sql |
| ux_ctr_adv_ref | ctr_advances | yes | 20261209000298_ctr_securities.up.sql |
| ix_ctr_advances_company_id | ctr_advances | no | 20261209000298_ctr_securities.up.sql |
| ix_ctr_advances_org_project_id | ctr_advances | no | 20261209000298_ctr_securities.up.sql |
| ix_ctr_advances_partner_id | ctr_advances | no | 20261209000298_ctr_securities.up.sql |
| ux_ctr_ins_doc | ctr_insurances | yes | 20261209000298_ctr_securities.up.sql |
| ux_ctr_ins_no | ctr_insurances | yes | 20261209000298_ctr_securities.up.sql |
| ix_ctr_insurances_org_project_id | ctr_insurances | no | 20261209000298_ctr_securities.up.sql |
| ix_ctr_insurances_org_site_id | ctr_insurances | no | 20261209000298_ctr_securities.up.sql |
| ix_ctr_insurances_contract_id | ctr_insurances | no | 20261209000298_ctr_securities.up.sql |
| ix_ctr_insurances_renewal_of_id | ctr_insurances | no | 20261209000298_ctr_securities.up.sql |
| ix_ctr_ins_valid | ctr_insurances | no | 20261209000298_ctr_securities.up.sql |
| ux_ctr_clm_no | ctr_insurance_claims | yes | 20261209000298_ctr_securities.up.sql |
| ix_ctr_insurance_claims_company_id | ctr_insurance_claims | no | 20261209000298_ctr_securities.up.sql |
| ux_ctr_lim | ctr_bank_limits | yes | 20261209000298_ctr_securities.up.sql |
| ux_ctr_wo_doc | ctr_work_orders | yes | 20261209000300_ctr_work_orders.up.sql |
| ux_ctr_wo_no | ctr_work_orders | yes | 20261209000300_ctr_work_orders.up.sql |
| ix_ctr_work_orders_org_project_id | ctr_work_orders | no | 20261209000300_ctr_work_orders.up.sql |
| ix_ctr_work_orders_org_site_id | ctr_work_orders | no | 20261209000300_ctr_work_orders.up.sql |
| ix_ctr_work_orders_contract_id | ctr_work_orders | no | 20261209000300_ctr_work_orders.up.sql |
| ix_ctr_work_orders_subcontractor_id | ctr_work_orders | no | 20261209000300_ctr_work_orders.up.sql |
| ix_ctr_work_orders_work_package_id | ctr_work_orders | no | 20261209000300_ctr_work_orders.up.sql |
| ix_ctr_work_orders_cs_id | ctr_work_orders | no | 20261209000300_ctr_work_orders.up.sql |
| ix_ctr_wo_state | ctr_work_orders | no | 20261209000300_ctr_work_orders.up.sql |
| ux_ctr_wo_item_line | ctr_wo_items | yes | 20261209000300_ctr_work_orders.up.sql |
| ix_ctr_wo_items_company_id | ctr_wo_items | no | 20261209000300_ctr_work_orders.up.sql |
| ix_ctr_wo_items_boq_line_id | ctr_wo_items | no | 20261209000300_ctr_work_orders.up.sql |
| ix_ctr_wo_items_wbs_id | ctr_wo_items | no | 20261209000300_ctr_work_orders.up.sql |
| ix_ctr_wo_items_client_boq_line_id | ctr_wo_items | no | 20261209000300_ctr_work_orders.up.sql |
| ux_ctr_wo_fi | ctr_wo_free_issue | yes | 20261209000300_ctr_work_orders.up.sql |
| ix_ctr_wo_free_issue_company_id | ctr_wo_free_issue | no | 20261209000300_ctr_work_orders.up.sql |
| ix_ctr_wo_free_issue_item_id | ctr_wo_free_issue | no | 20261209000300_ctr_work_orders.up.sql |
| ux_ctr_woa_doc | ctr_wo_amendments | yes | 20261209000300_ctr_work_orders.up.sql |
| ix_ctr_wo_amendments_wo_id | ctr_wo_amendments | no | 20261209000300_ctr_work_orders.up.sql |
| ix_ctr_wo_amendments_org_project_id | ctr_wo_amendments | no | 20261209000300_ctr_work_orders.up.sql |
| ix_ctr_wo_amendments_org_site_id | ctr_wo_amendments | no | 20261209000300_ctr_work_orders.up.sql |
| ux_ctr_sc_doc | ctr_sub_compliance | yes | 20261209000302_ctr_subcontractor_workspace.up.sql |
| ux_ctr_sc_key | ctr_sub_compliance | yes | 20261209000302_ctr_subcontractor_workspace.up.sql |
| ix_ctr_sub_compliance_subcontractor_id | ctr_sub_compliance | no | 20261209000302_ctr_subcontractor_workspace.up.sql |
| ix_ctr_sub_compliance_org_project_id | ctr_sub_compliance | no | 20261209000302_ctr_subcontractor_workspace.up.sql |
| ix_ctr_sub_compliance_org_site_id | ctr_sub_compliance | no | 20261209000302_ctr_subcontractor_workspace.up.sql |
| ix_ctr_sc_due | ctr_sub_compliance | no | 20261209000302_ctr_subcontractor_workspace.up.sql |
| ux_ctr_sw_doc | ctr_sub_waivers | yes | 20261209000302_ctr_subcontractor_workspace.up.sql |
| ix_ctr_sub_waivers_compliance_id | ctr_sub_waivers | no | 20261209000302_ctr_subcontractor_workspace.up.sql |
| ix_ctr_sub_waivers_subcontractor_id | ctr_sub_waivers | no | 20261209000302_ctr_subcontractor_workspace.up.sql |
| ix_ctr_sub_waivers_org_project_id | ctr_sub_waivers | no | 20261209000302_ctr_subcontractor_workspace.up.sql |
| ix_ctr_sub_waivers_org_site_id | ctr_sub_waivers | no | 20261209000302_ctr_subcontractor_workspace.up.sql |
| ux_ctr_sm_key | ctr_sub_manpower | yes | 20261209000302_ctr_subcontractor_workspace.up.sql |
| ix_ctr_sub_manpower_subcontractor_id | ctr_sub_manpower | no | 20261209000302_ctr_subcontractor_workspace.up.sql |
| ix_ctr_sub_manpower_org_project_id | ctr_sub_manpower | no | 20261209000302_ctr_subcontractor_workspace.up.sql |
| ux_ctr_sh_key | ctr_sub_holds | yes | 20261209000302_ctr_subcontractor_workspace.up.sql |
| ix_ctr_sub_holds_subcontractor_id | ctr_sub_holds | no | 20261209000302_ctr_subcontractor_workspace.up.sql |
| ix_ctr_sub_holds_org_project_id | ctr_sub_holds | no | 20261209000302_ctr_subcontractor_workspace.up.sql |
| ux_ctr_sr_key | ctr_sub_ratings | yes | 20261209000302_ctr_subcontractor_workspace.up.sql |
| ix_ctr_sub_ratings_subcontractor_id | ctr_sub_ratings | no | 20261209000302_ctr_subcontractor_workspace.up.sql |
| ix_ctr_sub_ratings_org_project_id | ctr_sub_ratings | no | 20261209000302_ctr_subcontractor_workspace.up.sql |
| ux_ctr_cr_doc | ctr_change_requests | yes | 20261209000304_ctr_variations.up.sql |
| ux_ctr_cr_no | ctr_change_requests | yes | 20261209000304_ctr_variations.up.sql |
| ix_ctr_change_requests_org_project_id | ctr_change_requests | no | 20261209000304_ctr_variations.up.sql |
| ix_ctr_change_requests_org_site_id | ctr_change_requests | no | 20261209000304_ctr_variations.up.sql |
| ix_ctr_change_requests_contract_id | ctr_change_requests | no | 20261209000304_ctr_variations.up.sql |
| ix_ctr_change_requests_work_order_id | ctr_change_requests | no | 20261209000304_ctr_variations.up.sql |
| ix_ctr_cr_state | ctr_change_requests | no | 20261209000304_ctr_variations.up.sql |
| ux_ctr_vo_doc | ctr_variation_orders | yes | 20261209000304_ctr_variations.up.sql |
| ux_ctr_vo_no | ctr_variation_orders | yes | 20261209000304_ctr_variations.up.sql |
| ix_ctr_variation_orders_org_project_id | ctr_variation_orders | no | 20261209000304_ctr_variations.up.sql |
| ix_ctr_variation_orders_org_site_id | ctr_variation_orders | no | 20261209000304_ctr_variations.up.sql |
| ix_ctr_variation_orders_contract_id | ctr_variation_orders | no | 20261209000304_ctr_variations.up.sql |
| ix_ctr_variation_orders_work_order_id | ctr_variation_orders | no | 20261209000304_ctr_variations.up.sql |
| ix_ctr_variation_orders_cr_id | ctr_variation_orders | no | 20261209000304_ctr_variations.up.sql |
| ix_ctr_variation_orders_boq_version_id | ctr_variation_orders | no | 20261209000304_ctr_variations.up.sql |
| ux_ctr_voi_line | ctr_vo_items | yes | 20261209000304_ctr_variations.up.sql |
| ix_ctr_vo_items_company_id | ctr_vo_items | no | 20261209000304_ctr_variations.up.sql |
| ix_ctr_vo_items_boq_line_id | ctr_vo_items | no | 20261209000304_ctr_variations.up.sql |
| ix_ctr_vo_items_analysis_id | ctr_vo_items | no | 20261209000304_ctr_variations.up.sql |
| ix_ctr_vo_items_wbs_id | ctr_vo_items | no | 20261209000304_ctr_variations.up.sql |
| ix_ctr_vo_items_cost_code_id | ctr_vo_items | no | 20261209000304_ctr_variations.up.sql |
| ux_ctr_clm_doc | ctr_claims | yes | 20261209000306_ctr_claims.up.sql |
| ux_ctr_clm_no | ctr_claims | yes | 20261209000306_ctr_claims.up.sql |
| ix_ctr_claims_org_project_id | ctr_claims | no | 20261209000306_ctr_claims.up.sql |
| ix_ctr_claims_org_site_id | ctr_claims | no | 20261209000306_ctr_claims.up.sql |
| ix_ctr_claims_contract_id | ctr_claims | no | 20261209000306_ctr_claims.up.sql |
| ix_ctr_claims_notice_letter_id | ctr_claims | no | 20261209000306_ctr_claims.up.sql |
| ix_ctr_claims_delay_id | ctr_claims | no | 20261209000306_ctr_claims.up.sql |
| ix_ctr_clm_bar | ctr_claims | no | 20261209000306_ctr_claims.up.sql |
| ix_ctr_claim_events_company_id | ctr_claim_events | no | 20261209000306_ctr_claims.up.sql |
| ix_ctr_claim_events_org_project_id | ctr_claim_events | no | 20261209000306_ctr_claims.up.sql |
| ix_ctr_claim_events_contract_id | ctr_claim_events | no | 20261209000306_ctr_claims.up.sql |
| ix_ctr_claim_events_claim_id | ctr_claim_events | no | 20261209000306_ctr_claims.up.sql |
| ux_ctr_ce_ref | ctr_claim_events | yes | 20261209000306_ctr_claims.up.sql |
| ux_ctr_cq_line | ctr_claim_quantum | yes | 20261209000306_ctr_claims.up.sql |
| ix_ctr_claim_quantum_company_id | ctr_claim_quantum | no | 20261209000306_ctr_claims.up.sql |
| ix_ctr_claim_quantum_claim_id | ctr_claim_quantum | no | 20261209000306_ctr_claims.up.sql |
| ux_ctr_cev_key | ctr_claim_evidence | yes | 20261209000306_ctr_claims.up.sql |
| ix_ctr_claim_evidence_company_id | ctr_claim_evidence | no | 20261209000306_ctr_claims.up.sql |
| ix_ctr_claim_evidence_claim_id | ctr_claim_evidence | no | 20261209000306_ctr_claims.up.sql |
| ux_ctr_cl_seq | ctr_claim_log | yes | 20261209000306_ctr_claims.up.sql |
| ix_ctr_claim_log_company_id | ctr_claim_log | no | 20261209000306_ctr_claims.up.sql |
| ix_ctr_claim_log_claim_id | ctr_claim_log | no | 20261209000306_ctr_claims.up.sql |
| ux_ctr_eot_claim | ctr_eot_awards | yes | 20261209000306_ctr_claims.up.sql |
| ix_ctr_eot_awards_company_id | ctr_eot_awards | no | 20261209000306_ctr_claims.up.sql |
| ix_ctr_eot_awards_contract_id | ctr_eot_awards | no | 20261209000306_ctr_claims.up.sql |
| ux_ctr_dsp_doc | ctr_disputes | yes | 20261209000306_ctr_claims.up.sql |
| ux_ctr_dsp_no | ctr_disputes | yes | 20261209000306_ctr_claims.up.sql |
| ix_ctr_disputes_org_project_id | ctr_disputes | no | 20261209000306_ctr_claims.up.sql |
| ix_ctr_disputes_org_site_id | ctr_disputes | no | 20261209000306_ctr_claims.up.sql |
| ix_ctr_disputes_claim_id | ctr_disputes | no | 20261209000306_ctr_claims.up.sql |
| ix_ctr_disputes_contract_id | ctr_disputes | no | 20261209000306_ctr_claims.up.sql |
| ix_ctr_dispute_log_company_id | ctr_dispute_log | no | 20261209000306_ctr_claims.up.sql |
| ix_ctr_dispute_log_dispute_id | ctr_dispute_log | no | 20261209000306_ctr_claims.up.sql |
| ux_ctr_pvf_active | ctr_pvc_formulas | yes | 20261209000308_ctr_pvc_ld.up.sql |
| ix_ctr_pvc_formulas_contract_id | ctr_pvc_formulas | no | 20261209000308_ctr_pvc_ld.up.sql |
| ix_ctr_pvc_formulas_work_order_id | ctr_pvc_formulas | no | 20261209000308_ctr_pvc_ld.up.sql |
| ix_ctr_pvc_formulas_org_project_id | ctr_pvc_formulas | no | 20261209000308_ctr_pvc_ld.up.sql |
| ux_ctr_pir_key | ctr_pvc_index_refs | yes | 20261209000308_ctr_pvc_ld.up.sql |
| ix_ctr_pvc_index_refs_company_id | ctr_pvc_index_refs | no | 20261209000308_ctr_pvc_ld.up.sql |
| ux_ctr_esc_doc | ctr_escalation_calcs | yes | 20261209000308_ctr_pvc_ld.up.sql |
| ux_ctr_esc_bill | ctr_escalation_calcs | yes | 20261209000308_ctr_pvc_ld.up.sql |
| ix_ctr_escalation_calcs_contract_id | ctr_escalation_calcs | no | 20261209000308_ctr_pvc_ld.up.sql |
| ix_ctr_escalation_calcs_work_order_id | ctr_escalation_calcs | no | 20261209000308_ctr_pvc_ld.up.sql |
| ix_ctr_escalation_calcs_formula_id | ctr_escalation_calcs | no | 20261209000308_ctr_pvc_ld.up.sql |
| ix_ctr_escalation_calcs_org_project_id | ctr_escalation_calcs | no | 20261209000308_ctr_pvc_ld.up.sql |
| ix_ctr_escalation_calcs_org_site_id | ctr_escalation_calcs | no | 20261209000308_ctr_pvc_ld.up.sql |
| ux_ctr_ld_key | ctr_ld_assessments | yes | 20261209000308_ctr_pvc_ld.up.sql |
| ix_ctr_ld_assessments_contract_id | ctr_ld_assessments | no | 20261209000308_ctr_pvc_ld.up.sql |
| ix_ctr_ld_assessments_org_project_id | ctr_ld_assessments | no | 20261209000308_ctr_pvc_ld.up.sql |
| ux_bill_mb_doc | bill_mb_entries | yes | 20261209000310_bill_mb_entries.up.sql |
| ux_bill_mb_page | bill_mb_entries | yes | 20261209000310_bill_mb_entries.up.sql |
| ix_bill_mb_entries_org_project_id | bill_mb_entries | no | 20261209000310_bill_mb_entries.up.sql |
| ix_bill_mb_entries_org_site_id | bill_mb_entries | no | 20261209000310_bill_mb_entries.up.sql |
| ix_bill_mb_entries_boq_line_id | bill_mb_entries | no | 20261209000310_bill_mb_entries.up.sql |
| ix_bill_mb_entries_location_id | bill_mb_entries | no | 20261209000310_bill_mb_entries.up.sql |
| ix_bill_mb_entries_wa_id | bill_mb_entries | no | 20261209000310_bill_mb_entries.up.sql |
| ix_bill_mb_entries_activity_id | bill_mb_entries | no | 20261209000310_bill_mb_entries.up.sql |
| ix_bill_mb_entries_ir_id | bill_mb_entries | no | 20261209000310_bill_mb_entries.up.sql |
| ix_bill_mb_entries_dpr_work_id | bill_mb_entries | no | 20261209000310_bill_mb_entries.up.sql |
| ix_bill_mb_entries_drawing_id | bill_mb_entries | no | 20261209000310_bill_mb_entries.up.sql |
| ix_bill_mb_status | bill_mb_entries | no | 20261209000310_bill_mb_entries.up.sql |
| ix_bill_mb_period | bill_mb_entries | no | 20261209000310_bill_mb_entries.up.sql |
| ux_bill_ds_doc | bill_deviation_statements | yes | 20261209000312_bill_deviation_extra.up.sql |
| ux_bill_ds_no | bill_deviation_statements | yes | 20261209000312_bill_deviation_extra.up.sql |
| ix_bill_deviation_statements_org_project_id | bill_deviation_statements | no | 20261209000312_bill_deviation_extra.up.sql |
| ix_bill_deviation_statements_org_site_id | bill_deviation_statements | no | 20261209000312_bill_deviation_extra.up.sql |
| ix_bill_deviation_statements_contract_id | bill_deviation_statements | no | 20261209000312_bill_deviation_extra.up.sql |
| ix_bill_deviation_statements_cr_id | bill_deviation_statements | no | 20261209000312_bill_deviation_extra.up.sql |
| ix_bill_ds_status | bill_deviation_statements | no | 20261209000312_bill_deviation_extra.up.sql |
| ux_bill_fc_item | bill_qty_forecasts | yes | 20261209000312_bill_deviation_extra.up.sql |
| ix_bill_qty_forecasts_org_project_id | bill_qty_forecasts | no | 20261209000312_bill_deviation_extra.up.sql |
| ix_bill_qty_forecasts_boq_line_id | bill_qty_forecasts | no | 20261209000312_bill_deviation_extra.up.sql |
| ux_bill_xi_doc | bill_extra_items | yes | 20261209000312_bill_deviation_extra.up.sql |
| ix_bill_extra_items_org_project_id | bill_extra_items | no | 20261209000312_bill_deviation_extra.up.sql |
| ix_bill_extra_items_org_site_id | bill_extra_items | no | 20261209000312_bill_deviation_extra.up.sql |
| ix_bill_extra_items_substitutes_boq_line_id | bill_extra_items | no | 20261209000312_bill_deviation_extra.up.sql |
| ix_bill_extra_items_ds_id | bill_extra_items | no | 20261209000312_bill_deviation_extra.up.sql |
| ix_bill_extra_items_cr_id | bill_extra_items | no | 20261209000312_bill_deviation_extra.up.sql |
| ix_bill_xi_state | bill_extra_items | no | 20261209000312_bill_deviation_extra.up.sql |
| ux_bill_cb_doc | bill_client_bills | yes | 20261209000314_bill_client_bills.up.sql |
| ux_bill_cb_no | bill_client_bills | yes | 20261209000314_bill_client_bills.up.sql |
| ux_bill_cb_seq | bill_client_bills | yes | 20261209000314_bill_client_bills.up.sql |
| ix_bill_client_bills_org_project_id | bill_client_bills | no | 20261209000314_bill_client_bills.up.sql |
| ix_bill_client_bills_org_site_id | bill_client_bills | no | 20261209000314_bill_client_bills.up.sql |
| ix_bill_client_bills_contract_id | bill_client_bills | no | 20261209000314_bill_client_bills.up.sql |
| ix_bill_client_bills_prev_bill_id | bill_client_bills | no | 20261209000314_bill_client_bills.up.sql |
| ix_bill_client_bills_escalation_calc_id | bill_client_bills | no | 20261209000314_bill_client_bills.up.sql |
| ix_bill_cb_status | bill_client_bills | no | 20261209000314_bill_client_bills.up.sql |
| ux_bill_cbi_line | bill_client_bill_items | yes | 20261209000314_bill_client_bills.up.sql |
| ix_bill_client_bill_items_company_id | bill_client_bill_items | no | 20261209000314_bill_client_bills.up.sql |
| ix_bill_client_bill_items_bill_id | bill_client_bill_items | no | 20261209000314_bill_client_bills.up.sql |
| ix_bill_client_bill_items_boq_line_id | bill_client_bill_items | no | 20261209000314_bill_client_bills.up.sql |
| ix_bill_client_bill_items_milestone_id | bill_client_bill_items | no | 20261209000314_bill_client_bills.up.sql |
| ux_bill_cert_doc | bill_certifications | yes | 20261209000316_bill_certifications_invoices.up.sql |
| ux_bill_cert_bill | bill_certifications | yes | 20261209000316_bill_certifications_invoices.up.sql |
| ix_bill_certifications_org_project_id | bill_certifications | no | 20261209000316_bill_certifications_invoices.up.sql |
| ix_bill_certifications_org_site_id | bill_certifications | no | 20261209000316_bill_certifications_invoices.up.sql |
| ix_bill_certifications_contract_id | bill_certifications | no | 20261209000316_bill_certifications_invoices.up.sql |
| ix_bill_cert_status | bill_certifications | no | 20261209000316_bill_certifications_invoices.up.sql |
| ux_bill_ti_doc | bill_tax_invoices | yes | 20261209000316_bill_certifications_invoices.up.sql |
| ux_bill_ti_no | bill_tax_invoices | yes | 20261209000316_bill_certifications_invoices.up.sql |
| ux_bill_ti_seq | bill_tax_invoices | yes | 20261209000316_bill_certifications_invoices.up.sql |
| ux_bill_ti_bill | bill_tax_invoices | yes | 20261209000316_bill_certifications_invoices.up.sql |
| ix_bill_tax_invoices_org_project_id | bill_tax_invoices | no | 20261209000316_bill_certifications_invoices.up.sql |
| ix_bill_tax_invoices_org_site_id | bill_tax_invoices | no | 20261209000316_bill_certifications_invoices.up.sql |
| ix_bill_tax_invoices_contract_id | bill_tax_invoices | no | 20261209000316_bill_certifications_invoices.up.sql |
| ix_bill_tax_invoices_certification_id | bill_tax_invoices | no | 20261209000316_bill_certifications_invoices.up.sql |
| ix_bill_ti_status | bill_tax_invoices | no | 20261209000316_bill_certifications_invoices.up.sql |
| ux_bill_ic_key | bill_invoice_counters | yes | 20261209000316_bill_certifications_invoices.up.sql |
| ux_bill_sm_doc | bill_sub_measurements | yes | 20261209000318_bill_sub_bills.up.sql |
| ix_bill_sub_measurements_company_id | bill_sub_measurements | no | 20261209000318_bill_sub_bills.up.sql |
| ix_bill_sub_measurements_org_project_id | bill_sub_measurements | no | 20261209000318_bill_sub_bills.up.sql |
| ix_bill_sub_measurements_org_site_id | bill_sub_measurements | no | 20261209000318_bill_sub_bills.up.sql |
| ix_bill_sub_measurements_wo_id | bill_sub_measurements | no | 20261209000318_bill_sub_bills.up.sql |
| ix_bill_sub_measurements_subcontractor_id | bill_sub_measurements | no | 20261209000318_bill_sub_bills.up.sql |
| ix_bill_sub_measurements_wo_item_id | bill_sub_measurements | no | 20261209000318_bill_sub_bills.up.sql |
| ix_bill_sub_measurements_location_id | bill_sub_measurements | no | 20261209000318_bill_sub_bills.up.sql |
| ix_bill_sub_measurements_bill_id | bill_sub_measurements | no | 20261209000318_bill_sub_bills.up.sql |
| ix_bill_sm_status | bill_sub_measurements | no | 20261209000318_bill_sub_bills.up.sql |
| ux_bill_sb_doc | bill_sub_bills | yes | 20261209000318_bill_sub_bills.up.sql |
| ux_bill_sb_no | bill_sub_bills | yes | 20261209000318_bill_sub_bills.up.sql |
| ux_bill_sb_seq | bill_sub_bills | yes | 20261209000318_bill_sub_bills.up.sql |
| ix_bill_sub_bills_org_project_id | bill_sub_bills | no | 20261209000318_bill_sub_bills.up.sql |
| ix_bill_sub_bills_org_site_id | bill_sub_bills | no | 20261209000318_bill_sub_bills.up.sql |
| ix_bill_sub_bills_wo_id | bill_sub_bills | no | 20261209000318_bill_sub_bills.up.sql |
| ix_bill_sub_bills_subcontractor_id | bill_sub_bills | no | 20261209000318_bill_sub_bills.up.sql |
| ix_bill_sub_bills_prev_bill_id | bill_sub_bills | no | 20261209000318_bill_sub_bills.up.sql |
| ix_bill_sb_status | bill_sub_bills | no | 20261209000318_bill_sub_bills.up.sql |
| ux_bill_sbi_line | bill_sub_bill_items | yes | 20261209000318_bill_sub_bills.up.sql |
| ix_bill_sub_bill_items_company_id | bill_sub_bill_items | no | 20261209000318_bill_sub_bills.up.sql |
| ix_bill_sub_bill_items_bill_id | bill_sub_bill_items | no | 20261209000318_bill_sub_bills.up.sql |
| ix_bill_sub_bill_items_wo_item_id | bill_sub_bill_items | no | 20261209000318_bill_sub_bills.up.sql |
| ux_bill_sc_src | bill_sub_claims | yes | 20261209000318_bill_sub_bills.up.sql |
| ix_bill_sub_claims_company_id | bill_sub_claims | no | 20261209000318_bill_sub_bills.up.sql |
| ix_bill_sub_claims_bill_id | bill_sub_claims | no | 20261209000318_bill_sub_bills.up.sql |
| ux_bill_vi_doc | bill_vendor_invoices | yes | 20261209000320_bill_vendor_invoices.up.sql |
| ux_bill_vi_dup | bill_vendor_invoices | yes | 20261209000320_bill_vendor_invoices.up.sql |
| ix_bill_vendor_invoices_org_project_id | bill_vendor_invoices | no | 20261209000320_bill_vendor_invoices.up.sql |
| ix_bill_vendor_invoices_org_site_id | bill_vendor_invoices | no | 20261209000320_bill_vendor_invoices.up.sql |
| ix_bill_vendor_invoices_vendor_id | bill_vendor_invoices | no | 20261209000320_bill_vendor_invoices.up.sql |
| ix_bill_vendor_invoices_po_id | bill_vendor_invoices | no | 20261209000320_bill_vendor_invoices.up.sql |
| ix_bill_vendor_invoices_so_id | bill_vendor_invoices | no | 20261209000320_bill_vendor_invoices.up.sql |
| ix_bill_vendor_invoices_service_entry_id | bill_vendor_invoices | no | 20261209000320_bill_vendor_invoices.up.sql |
| ix_bill_vendor_invoices_hire_bill_id | bill_vendor_invoices | no | 20261209000320_bill_vendor_invoices.up.sql |
| ix_bill_vi_status | bill_vendor_invoices | no | 20261209000320_bill_vendor_invoices.up.sql |
| ix_bill_vi_date | bill_vendor_invoices | no | 20261209000320_bill_vendor_invoices.up.sql |
| ux_bill_vil_line | bill_vendor_invoice_lines | yes | 20261209000320_bill_vendor_invoices.up.sql |
| ix_bill_vendor_invoice_lines_company_id | bill_vendor_invoice_lines | no | 20261209000320_bill_vendor_invoices.up.sql |
| ix_bill_vendor_invoice_lines_invoice_id | bill_vendor_invoice_lines | no | 20261209000320_bill_vendor_invoices.up.sql |
| ix_bill_vendor_invoice_lines_po_line_id | bill_vendor_invoice_lines | no | 20261209000320_bill_vendor_invoices.up.sql |
| ix_bill_vendor_invoice_lines_item_id | bill_vendor_invoice_lines | no | 20261209000320_bill_vendor_invoices.up.sql |
| ux_bill_rl_src | bill_retention_ledger | yes | 20261209000322_bill_ledgers.up.sql |
| ix_bill_retention_ledger_company_id | bill_retention_ledger | no | 20261209000322_bill_ledgers.up.sql |
| ix_bill_retention_ledger_org_project_id | bill_retention_ledger | no | 20261209000322_bill_ledgers.up.sql |
| ix_bill_retention_ledger_contract_id | bill_retention_ledger | no | 20261209000322_bill_ledgers.up.sql |
| ix_bill_retention_ledger_wo_id | bill_retention_ledger | no | 20261209000322_bill_ledgers.up.sql |
| ix_bill_retention_ledger_party_id | bill_retention_ledger | no | 20261209000322_bill_ledgers.up.sql |
| ix_bill_retention_ledger_release_id | bill_retention_ledger | no | 20261209000322_bill_ledgers.up.sql |
| ix_bill_rl_scope | bill_retention_ledger | no | 20261209000322_bill_ledgers.up.sql |
| ux_bill_adv_doc | bill_advances | yes | 20261209000322_bill_ledgers.up.sql |
| ux_bill_adv_ref | bill_advances | yes | 20261209000322_bill_ledgers.up.sql |
| ix_bill_advances_org_project_id | bill_advances | no | 20261209000322_bill_ledgers.up.sql |
| ix_bill_advances_org_site_id | bill_advances | no | 20261209000322_bill_ledgers.up.sql |
| ix_bill_advances_party_id | bill_advances | no | 20261209000322_bill_ledgers.up.sql |
| ix_bill_advances_contract_id | bill_advances | no | 20261209000322_bill_ledgers.up.sql |
| ix_bill_advances_wo_id | bill_advances | no | 20261209000322_bill_ledgers.up.sql |
| ix_bill_advances_po_id | bill_advances | no | 20261209000322_bill_ledgers.up.sql |
| ix_bill_advances_bg_id | bill_advances | no | 20261209000322_bill_ledgers.up.sql |
| ix_bill_adv_status | bill_advances | no | 20261209000322_bill_ledgers.up.sql |
| ux_bill_ar_src | bill_advance_recoveries | yes | 20261209000322_bill_ledgers.up.sql |
| ix_bill_advance_recoveries_company_id | bill_advance_recoveries | no | 20261209000322_bill_ledgers.up.sql |
| ix_bill_advance_recoveries_advance_id | bill_advance_recoveries | no | 20261209000322_bill_ledgers.up.sql |
| ux_bill_rel_doc | bill_releases | yes | 20261209000322_bill_ledgers.up.sql |
| ix_bill_releases_org_project_id | bill_releases | no | 20261209000322_bill_ledgers.up.sql |
| ix_bill_releases_org_site_id | bill_releases | no | 20261209000322_bill_ledgers.up.sql |
| ix_bill_releases_party_id | bill_releases | no | 20261209000322_bill_ledgers.up.sql |
| ix_bill_releases_contract_id | bill_releases | no | 20261209000322_bill_ledgers.up.sql |
| ix_bill_releases_wo_id | bill_releases | no | 20261209000322_bill_ledgers.up.sql |
| ix_bill_releases_bg_id | bill_releases | no | 20261209000322_bill_ledgers.up.sql |
| ix_bill_rel_status | bill_releases | no | 20261209000322_bill_ledgers.up.sql |
| ux_bill_cvr_doc | bill_cvr_reports | yes | 20261209000325_bill_cvr_reports.up.sql |
| ux_bill_cvr_period | bill_cvr_reports | yes | 20261209000325_bill_cvr_reports.up.sql |
| ix_bill_cvr_reports_org_project_id | bill_cvr_reports | no | 20261209000325_bill_cvr_reports.up.sql |
| ix_bill_cvr_reports_org_site_id | bill_cvr_reports | no | 20261209000325_bill_cvr_reports.up.sql |
| ix_bill_cvr_reports_prev_report_id | bill_cvr_reports | no | 20261209000325_bill_cvr_reports.up.sql |
| ix_bill_cvr_status | bill_cvr_reports | no | 20261209000325_bill_cvr_reports.up.sql |
| ux_ui_navigation_labels | ui_navigation_labels | yes | 20261209000328_field_p16603.up.sql |
| ix_ui_navigation_labels_nav_code | ui_navigation_labels | no | 20261209000328_field_p16603.up.sql |
| ix_ui_navigation_labels_company_id | ui_navigation_labels | no | 20261209000328_field_p16603.up.sql |
| ux_ui_field_tile_rules | ui_field_tile_rules | yes | 20261209000328_field_p16603.up.sql |
| ix_ui_field_tile_rules_company_id | ui_field_tile_rules | no | 20261209000328_field_p16603.up.sql |
| ux_ui_bottom_bar_slot | ui_bottom_bar | yes | 20261209000328_field_p16603.up.sql |
| ix_ui_bottom_bar_nav_code | ui_bottom_bar | no | 20261209000328_field_p16603.up.sql |
| ix_ui_bottom_bar_company_id | ui_bottom_bar | no | 20261209000328_field_p16603.up.sql |
| ix_ui_widgets_module | ui_widgets | no | 20261211000330_ui_p16605.up.sql |
| ix_ui_widgets_company | ui_widgets | no | 20261211000330_ui_p16605.up.sql |
| ux_hr_gates_company_code | hr_gates | yes | 20261212000331_hr_p0714.up.sql |
| ux_hr_gate_criteria_gate_code | hr_gate_criteria | yes | 20261212000331_hr_p0714.up.sql |
| ix_hr_gate_criteria_company | hr_gate_criteria | no | 20261212000331_hr_p0714.up.sql |
| ix_mdm_tds_sections_company | mdm_tds_sections | no | 20261214000333_mdm_p16608.up.sql |
| ix_mdm_tds_sections_cr | mdm_tds_sections | no | 20261214000333_mdm_p16608.up.sql |
| ix_mdm_tds_sections_tax_kind | mdm_tds_sections | no | 20261214000333_mdm_p16608.up.sql |
| ux_mdm_tds_sections_key | mdm_tds_sections | yes | 20261214000333_mdm_p16608.up.sql |
| ix_mdm_tds_sections_nature | mdm_tds_sections | no | 20261214000333_mdm_p16608.up.sql |
| ux_mdm_tds_forms_key | mdm_tds_forms | yes | 20261214000333_mdm_p16608.up.sql |
| ix_mdm_tds_forms_company | mdm_tds_forms | no | 20261214000333_mdm_p16608.up.sql |
| ix_mdm_tds_forms_cr | mdm_tds_forms | no | 20261214000333_mdm_p16608.up.sql |
| ux_mdm_statutory_calendar_key | mdm_statutory_calendar | yes | 20261214000333_mdm_p16608.up.sql |
| ix_mdm_statutory_calendar_company | mdm_statutory_calendar | no | 20261214000333_mdm_p16608.up.sql |
| ix_mdm_statutory_calendar_cr | mdm_statutory_calendar | no | 20261214000333_mdm_p16608.up.sql |
| ux_mdm_labour_rules_key | mdm_labour_rules | yes | 20261214000333_mdm_p16608.up.sql |
| ix_mdm_labour_rules_company | mdm_labour_rules | no | 20261214000333_mdm_p16608.up.sql |
| ix_mdm_labour_rules_cr | mdm_labour_rules | no | 20261214000333_mdm_p16608.up.sql |
| ux_mdm_pay_components_key | mdm_pay_components | yes | 20261214000333_mdm_p16608.up.sql |
| ix_mdm_pay_components_company | mdm_pay_components | no | 20261214000333_mdm_p16608.up.sql |
| ix_mdm_pay_components_cr | mdm_pay_components | no | 20261214000333_mdm_p16608.up.sql |
| ux_hr_employee_pay_key | hr_employee_pay | yes | 20261214000333_mdm_p16608.up.sql |
| ix_hr_employee_pay_company | hr_employee_pay | no | 20261214000333_mdm_p16608.up.sql |
| ux_fin_journals_doc | fin_journals | yes | 20261215000334_fin_gl.up.sql |
| ux_fin_journals_voucher | fin_journals | yes | 20261215000334_fin_gl.up.sql |
| ux_fin_journals_source | fin_journals | yes | 20261215000334_fin_gl.up.sql |
| ix_fin_journals_list | fin_journals | no | 20261215000334_fin_gl.up.sql |
| ix_fin_journals_type | fin_journals | no | 20261215000334_fin_gl.up.sql |
| ix_fin_journals_period | fin_journals | no | 20261215000334_fin_gl.up.sql |
| ix_fin_journals_fy | fin_journals | no | 20261215000334_fin_gl.up.sql |
| ix_fin_journals_reversal | fin_journals | no | 20261215000334_fin_gl.up.sql |
| ix_fin_journals_reversed | fin_journals | no | 20261215000334_fin_gl.up.sql |
| ix_fin_journals_recurring | fin_journals | no | 20261215000334_fin_gl.up.sql |
| ix_fin_journals_auto | fin_journals | no | 20261215000334_fin_gl.up.sql |
| ix_fin_journals_wf | fin_journals | no | 20261215000334_fin_gl.up.sql |
| ux_fin_journal_lines_no | fin_journal_lines | yes | 20261215000334_fin_gl.up.sql |
| ix_fin_journal_lines_account | fin_journal_lines | no | 20261215000334_fin_gl.up.sql |
| ix_fin_journal_lines_company | fin_journal_lines | no | 20261215000334_fin_gl.up.sql |
| ix_fin_journal_lines_project | fin_journal_lines | no | 20261215000334_fin_gl.up.sql |
| ix_fin_journal_lines_site | fin_journal_lines | no | 20261215000334_fin_gl.up.sql |
| ix_fin_journal_lines_branch | fin_journal_lines | no | 20261215000334_fin_gl.up.sql |
| ix_fin_journal_lines_wbs | fin_journal_lines | no | 20261215000334_fin_gl.up.sql |
| ix_fin_journal_lines_cc | fin_journal_lines | no | 20261215000334_fin_gl.up.sql |
| ix_fin_journal_lines_code | fin_journal_lines | no | 20261215000334_fin_gl.up.sql |
| ix_fin_journal_lines_pc | fin_journal_lines | no | 20261215000334_fin_gl.up.sql |
| ix_fin_journal_lines_dept | fin_journal_lines | no | 20261215000334_fin_gl.up.sql |
| ix_fin_journal_lines_partner | fin_journal_lines | no | 20261215000334_fin_gl.up.sql |
| ix_fin_journal_lines_employee | fin_journal_lines | no | 20261215000334_fin_gl.up.sql |
| ix_fin_journal_lines_equipment | fin_journal_lines | no | 20261215000334_fin_gl.up.sql |
| ux_fin_balances_key | fin_balances | yes | 20261215000334_fin_gl.up.sql |
| ix_fin_balances_period | fin_balances | no | 20261215000334_fin_gl.up.sql |
| ix_fin_balances_account | fin_balances | no | 20261215000334_fin_gl.up.sql |
| ux_fin_recurring_doc | fin_recurring_journals | yes | 20261215000334_fin_gl.up.sql |
| ix_fin_recurring_due | fin_recurring_journals | no | 20261215000334_fin_gl.up.sql |
| ux_fin_posting_rules_doc | fin_posting_rules | yes | 20261216000336_fin_posting.up.sql |
| ux_fin_posting_rules_company_doc | fin_posting_rules | yes | 20261216000336_fin_posting.up.sql |
| ux_fin_posting_rules_version | fin_posting_rules | yes | 20261216000336_fin_posting.up.sql |
| ix_fin_posting_rules_company | fin_posting_rules | no | 20261216000336_fin_posting.up.sql |
| ix_fin_posting_rules_event | fin_posting_rules | no | 20261216000336_fin_posting.up.sql |
| ix_fin_posting_rules_wf | fin_posting_rules | no | 20261216000336_fin_posting.up.sql |
| ux_fin_replay_runs_doc | fin_replay_runs | yes | 20261216000336_fin_posting.up.sql |
| ix_fin_replay_runs_list | fin_replay_runs | no | 20261216000336_fin_posting.up.sql |
| ix_fin_replay_runs_wf | fin_replay_runs | no | 20261216000336_fin_posting.up.sql |
| ux_fin_posting_log_event | fin_posting_log | yes | 20261216000336_fin_posting.up.sql |
| ix_fin_posting_log_queue | fin_posting_log | no | 20261216000336_fin_posting.up.sql |
| ix_fin_posting_log_doc | fin_posting_log | no | 20261216000336_fin_posting.up.sql |
| ix_fin_posting_log_rule | fin_posting_log | no | 20261216000336_fin_posting.up.sql |
| ix_fin_posting_log_journal | fin_posting_log | no | 20261216000336_fin_posting.up.sql |
| ix_fin_posting_log_replay | fin_posting_log | no | 20261216000336_fin_posting.up.sql |
| ux_ap_bills_doc | ap_bills | yes | 20261217000338_ap_payables.up.sql |
| ux_ap_bills_source | ap_bills | yes | 20261217000338_ap_payables.up.sql |
| ix_ap_bills_list | ap_bills | no | 20261217000338_ap_payables.up.sql |
| ix_ap_bills_partner | ap_bills | no | 20261217000338_ap_payables.up.sql |
| ix_ap_bills_tds | ap_bills | no | 20261217000338_ap_payables.up.sql |
| ix_ap_bills_msme | ap_bills | no | 20261217000338_ap_payables.up.sql |
| ix_ap_bills_project | ap_bills | no | 20261217000338_ap_payables.up.sql |
| ix_ap_bills_site | ap_bills | no | 20261217000338_ap_payables.up.sql |
| ix_ap_bills_employee | ap_bills | no | 20261217000338_ap_payables.up.sql |
| ix_ap_bills_account | ap_bills | no | 20261217000338_ap_payables.up.sql |
| ix_ap_bills_journal | ap_bills | no | 20261217000338_ap_payables.up.sql |
| ix_ap_bills_wf | ap_bills | no | 20261217000338_ap_payables.up.sql |
| ux_ap_debit_notes_doc | ap_debit_notes | yes | 20261217000338_ap_payables.up.sql |
| ix_ap_debit_notes_list | ap_debit_notes | no | 20261217000338_ap_payables.up.sql |
| ix_ap_debit_notes_partner | ap_debit_notes | no | 20261217000338_ap_payables.up.sql |
| ix_ap_debit_notes_project | ap_debit_notes | no | 20261217000338_ap_payables.up.sql |
| ix_ap_debit_notes_bill | ap_debit_notes | no | 20261217000338_ap_payables.up.sql |
| ix_ap_debit_notes_account | ap_debit_notes | no | 20261217000338_ap_payables.up.sql |
| ix_ap_debit_notes_journal | ap_debit_notes | no | 20261217000338_ap_payables.up.sql |
| ix_ap_debit_notes_wf | ap_debit_notes | no | 20261217000338_ap_payables.up.sql |
| ix_ap_bill_adjustments_bill | ap_bill_adjustments | no | 20261217000338_ap_payables.up.sql |
| ix_ap_bill_adjustments_company | ap_bill_adjustments | no | 20261217000338_ap_payables.up.sql |
| ix_ap_bill_adjustments_journal | ap_bill_adjustments | no | 20261217000338_ap_payables.up.sql |
| ux_fin_bank_accounts_code | fin_bank_accounts | yes | 20261218000340_pmt_payments.up.sql |
| ix_fin_bank_accounts_gl | fin_bank_accounts | no | 20261218000340_pmt_payments.up.sql |
| ux_pmt_proposals_doc | pmt_proposals | yes | 20261218000340_pmt_payments.up.sql |
| ix_pmt_proposals_list | pmt_proposals | no | 20261218000340_pmt_payments.up.sql |
| ix_pmt_proposals_bank | pmt_proposals | no | 20261218000340_pmt_payments.up.sql |
| ix_pmt_proposals_wf | pmt_proposals | no | 20261218000340_pmt_payments.up.sql |
| ux_pmt_lines_no | pmt_proposal_lines | yes | 20261218000340_pmt_payments.up.sql |
| ix_pmt_lines_bill | pmt_proposal_lines | no | 20261218000340_pmt_payments.up.sql |
| ix_pmt_lines_partner | pmt_proposal_lines | no | 20261218000340_pmt_payments.up.sql |
| ix_pmt_lines_advance | pmt_proposal_lines | no | 20261218000340_pmt_payments.up.sql |
| ix_pmt_lines_bank | pmt_proposal_lines | no | 20261218000340_pmt_payments.up.sql |
| ix_pmt_lines_company | pmt_proposal_lines | no | 20261218000340_pmt_payments.up.sql |
| ux_pmt_payments_doc | pmt_payments | yes | 20261218000340_pmt_payments.up.sql |
| ux_pmt_payments_line | pmt_payments | yes | 20261218000340_pmt_payments.up.sql |
| ux_pmt_payments_utr | pmt_payments | yes | 20261218000340_pmt_payments.up.sql |
| ux_pmt_payments_cheque | pmt_payments | yes | 20261218000340_pmt_payments.up.sql |
| ix_pmt_payments_list | pmt_payments | no | 20261218000340_pmt_payments.up.sql |
| ix_pmt_payments_proposal | pmt_payments | no | 20261218000340_pmt_payments.up.sql |
| ix_pmt_payments_line_status | pmt_payments | no | 20261218000340_pmt_payments.up.sql |
| ix_pmt_payments_partner | pmt_payments | no | 20261218000340_pmt_payments.up.sql |
| ix_pmt_payments_bank | pmt_payments | no | 20261218000340_pmt_payments.up.sql |
| ix_pmt_payments_journal | pmt_payments | no | 20261218000340_pmt_payments.up.sql |
| ux_ar_invoices_doc | ar_invoices | yes | 20261219000342_ar_receivables.up.sql |
| ux_ar_invoices_source | ar_invoices | yes | 20261219000342_ar_receivables.up.sql |
| ix_ar_invoices_list | ar_invoices | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_invoices_partner | ar_invoices | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_invoices_project | ar_invoices | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_invoices_contract | ar_invoices | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_invoices_income | ar_invoices | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_invoices_journal | ar_invoices | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_invoices_wf | ar_invoices | no | 20261219000342_ar_receivables.up.sql |
| ux_ar_receipts_doc | ar_receipts | yes | 20261219000342_ar_receivables.up.sql |
| ix_ar_receipts_list | ar_receipts | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_receipts_partner | ar_receipts | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_receipts_bank | ar_receipts | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_receipts_project | ar_receipts | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_receipts_journal | ar_receipts | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_receipts_wf | ar_receipts | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_allocations_receipt | ar_allocations | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_allocations_invoice | ar_allocations | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_allocations_company | ar_allocations | no | 20261219000342_ar_receivables.up.sql |
| ux_ar_credit_notes_doc | ar_credit_notes | yes | 20261219000342_ar_receivables.up.sql |
| ix_ar_credit_notes_list | ar_credit_notes | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_credit_notes_invoice | ar_credit_notes | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_credit_notes_partner | ar_credit_notes | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_credit_notes_project | ar_credit_notes | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_credit_notes_journal | ar_credit_notes | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_credit_notes_wf | ar_credit_notes | no | 20261219000342_ar_receivables.up.sql |
| ux_ar_writeoffs_doc | ar_writeoffs | yes | 20261219000342_ar_receivables.up.sql |
| ix_ar_writeoffs_list | ar_writeoffs | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_writeoffs_invoice | ar_writeoffs | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_writeoffs_partner | ar_writeoffs | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_writeoffs_project | ar_writeoffs | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_writeoffs_journal | ar_writeoffs | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_writeoffs_wf | ar_writeoffs | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_followups_invoice | ar_followups | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_followups_partner | ar_followups | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_followups_project | ar_followups | no | 20261219000342_ar_receivables.up.sql |
| ix_ar_followups_company | ar_followups | no | 20261219000342_ar_receivables.up.sql |
| ux_fin_bank_profiles_account | fin_bank_account_profiles | yes | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_bank_profiles_company | fin_bank_account_profiles | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_bank_profiles_branch | fin_bank_account_profiles | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_bank_profiles_project | fin_bank_account_profiles | no | 20261220000344_fin_cash_bank.up.sql |
| ux_fin_bank_imports_doc | fin_bank_statement_imports | yes | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_bank_imports_account | fin_bank_statement_imports | no | 20261220000344_fin_cash_bank.up.sql |
| ux_fin_bank_statements_hash | fin_bank_statements | yes | 20261220000344_fin_cash_bank.up.sql |
| ux_fin_bank_statements_match | fin_bank_statements | yes | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_bank_statements_queue | fin_bank_statements | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_bank_statements_import | fin_bank_statements | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_bank_statements_company | fin_bank_statements | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_bank_statements_journal | fin_bank_statements | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_bank_statements_entity | fin_bank_statements | no | 20261220000344_fin_cash_bank.up.sql |
| ux_fin_bank_recons_date | fin_bank_recons | yes | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_bank_recons_company | fin_bank_recons | no | 20261220000344_fin_cash_bank.up.sql |
| ux_fin_imprests_doc | fin_imprests | yes | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_imprests_custodian | fin_imprests | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_imprests_project | fin_imprests | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_imprests_site | fin_imprests | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_imprests_gl | fin_imprests | no | 20261220000344_fin_cash_bank.up.sql |
| ux_fin_imprest_repl_doc | fin_imprest_replenishments | yes | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_imprest_repl_imprest | fin_imprest_replenishments | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_imprest_repl_list | fin_imprest_replenishments | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_imprest_repl_project | fin_imprest_replenishments | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_imprest_repl_site | fin_imprest_replenishments | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_imprest_repl_bank | fin_imprest_replenishments | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_imprest_repl_journal | fin_imprest_replenishments | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_imprest_repl_wf | fin_imprest_replenishments | no | 20261220000344_fin_cash_bank.up.sql |
| ux_fin_imprest_vouchers_doc | fin_imprest_vouchers | yes | 20261220000344_fin_cash_bank.up.sql |
| ux_fin_imprest_vouchers_client | fin_imprest_vouchers | yes | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_imprest_vouchers_imprest | fin_imprest_vouchers | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_imprest_vouchers_list | fin_imprest_vouchers | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_imprest_vouchers_expense | fin_imprest_vouchers | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_imprest_vouchers_cost | fin_imprest_vouchers | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_imprest_vouchers_project | fin_imprest_vouchers | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_imprest_vouchers_site | fin_imprest_vouchers | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_imprest_vouchers_repl | fin_imprest_vouchers | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_imprest_vouchers_journal | fin_imprest_vouchers | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_imprest_vouchers_wf | fin_imprest_vouchers | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_cash_counts_imprest | fin_cash_counts | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_cash_counts_company | fin_cash_counts | no | 20261220000344_fin_cash_bank.up.sql |
| ux_fin_contras_doc | fin_contras | yes | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_contras_list | fin_contras | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_contras_from_bank | fin_contras | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_contras_to_bank | fin_contras | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_contras_from_imprest | fin_contras | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_contras_to_imprest | fin_contras | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_contras_journal | fin_contras | no | 20261220000344_fin_cash_bank.up.sql |
| ix_fin_contras_wf | fin_contras | no | 20261220000344_fin_cash_bank.up.sql |
| ux_gst_settings_doc | gst_settings | yes | 20261221000346_fin_gst.up.sql |
| ix_gst_settings_list | gst_settings | no | 20261221000346_fin_gst.up.sql |
| ix_gst_settings_wf | gst_settings | no | 20261221000346_fin_gst.up.sql |
| ux_gst_gstin_checks | gst_gstin_checks | yes | 20261221000346_fin_gst.up.sql |
| ix_gst_gstin_checks_status | gst_gstin_checks | no | 20261221000346_fin_gst.up.sql |
| ux_gst_einvoices_doc | gst_einvoices | yes | 20261221000346_fin_gst.up.sql |
| ux_gst_einvoices_source | gst_einvoices | yes | 20261221000346_fin_gst.up.sql |
| ux_gst_einvoices_number | gst_einvoices | yes | 20261221000346_fin_gst.up.sql |
| ux_gst_einvoices_irn | gst_einvoices | yes | 20261221000346_fin_gst.up.sql |
| ix_gst_einvoices_list | gst_einvoices | no | 20261221000346_fin_gst.up.sql |
| ix_gst_einvoices_retry | gst_einvoices | no | 20261221000346_fin_gst.up.sql |
| ix_gst_einvoices_project | gst_einvoices | no | 20261221000346_fin_gst.up.sql |
| ux_gst_ewaybills_doc | gst_ewaybills | yes | 20261221000346_fin_gst.up.sql |
| ux_gst_ewaybills_no | gst_ewaybills | yes | 20261221000346_fin_gst.up.sql |
| ux_gst_ewaybills_live | gst_ewaybills | yes | 20261221000346_fin_gst.up.sql |
| ix_gst_ewaybills_list | gst_ewaybills | no | 20261221000346_fin_gst.up.sql |
| ix_gst_ewaybills_source | gst_ewaybills | no | 20261221000346_fin_gst.up.sql |
| ix_gst_ewaybills_project | gst_ewaybills | no | 20261221000346_fin_gst.up.sql |
| ix_gst_compliance_log_doc | gst_compliance_log | no | 20261221000346_fin_gst.up.sql |
| ix_gst_compliance_log_company | gst_compliance_log | no | 20261221000346_fin_gst.up.sql |
| ux_gst_2b_imports_doc | gst_2b_imports | yes | 20261222000348_fin_gst_recon.up.sql |
| ix_gst_2b_imports_period | gst_2b_imports | no | 20261222000348_fin_gst_recon.up.sql |
| ux_gst_2b_lines_hash | gst_2b_lines | yes | 20261222000348_fin_gst_recon.up.sql |
| ix_gst_2b_lines_list | gst_2b_lines | no | 20261222000348_fin_gst_recon.up.sql |
| ix_gst_2b_lines_supplier | gst_2b_lines | no | 20261222000348_fin_gst_recon.up.sql |
| ix_gst_2b_lines_import | gst_2b_lines | no | 20261222000348_fin_gst_recon.up.sql |
| ix_gst_2b_lines_bill | gst_2b_lines | no | 20261222000348_fin_gst_recon.up.sql |
| ix_gst_2b_lines_owner | gst_2b_lines | no | 20261222000348_fin_gst_recon.up.sql |
| ix_gst_recon_followups_line | gst_recon_followups | no | 20261222000348_fin_gst_recon.up.sql |
| ix_gst_recon_followups_bill | gst_recon_followups | no | 20261222000348_fin_gst_recon.up.sql |
| ix_gst_recon_followups_partner | gst_recon_followups | no | 20261222000348_fin_gst_recon.up.sql |
| ix_gst_recon_followups_company_id | gst_recon_followups | no | 20261222000348_fin_gst_recon.up.sql |
| ux_gst_itc_reviews_doc | gst_itc_reviews | yes | 20261222000348_fin_gst_recon.up.sql |
| ux_gst_itc_reviews_open | gst_itc_reviews | yes | 20261222000348_fin_gst_recon.up.sql |
| ix_gst_itc_reviews_list | gst_itc_reviews | no | 20261222000348_fin_gst_recon.up.sql |
| ix_gst_itc_reviews_wf | gst_itc_reviews | no | 20261222000348_fin_gst_recon.up.sql |
| ix_gst_itc_reviews_journal | gst_itc_reviews | no | 20261222000348_fin_gst_recon.up.sql |
| ix_gst_itc_reviews_amends | gst_itc_reviews | no | 20261222000348_fin_gst_recon.up.sql |
| ix_gst_itc_review_lines_review | gst_itc_review_lines | no | 20261222000348_fin_gst_recon.up.sql |
| ix_gst_itc_review_lines_bill | gst_itc_review_lines | no | 20261222000348_fin_gst_recon.up.sql |
| ix_gst_itc_review_lines_2b | gst_itc_review_lines | no | 20261222000348_fin_gst_recon.up.sql |
| ix_gst_itc_review_lines_company_id | gst_itc_review_lines | no | 20261222000348_fin_gst_recon.up.sql |
| ux_gst_return_filings | gst_return_filings | yes | 20261222000348_fin_gst_recon.up.sql |
| ix_gst_return_filings_status | gst_return_filings | no | 20261222000348_fin_gst_recon.up.sql |
| ux_tds_returns_doc | tds_returns | yes | 20261222000348_fin_gst_recon.up.sql |
| ux_tds_returns_quarter | tds_returns | yes | 20261222000348_fin_gst_recon.up.sql |
| ix_tds_returns_status | tds_returns | no | 20261222000348_fin_gst_recon.up.sql |
| ux_tds_26as_lines_hash | tds_26as_lines | yes | 20261222000348_fin_gst_recon.up.sql |
| ix_tds_26as_lines_fy | tds_26as_lines | no | 20261222000348_fin_gst_recon.up.sql |
| ix_tds_26as_lines_receipt | tds_26as_lines | no | 20261222000348_fin_gst_recon.up.sql |
| ux_fa_classes | fa_classes | yes | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_classes_company_id | fa_classes | no | 20261223000350_fin_fixed_assets.up.sql |
| ux_fa_cwip_doc | fa_cwip | yes | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_cwip_project | fa_cwip | no | 20261223000350_fin_fixed_assets.up.sql |
| ux_fa_cwip_lines_bill | fa_cwip_lines | yes | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_cwip_lines_cwip | fa_cwip_lines | no | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_cwip_lines_company_id | fa_cwip_lines | no | 20261223000350_fin_fixed_assets.up.sql |
| ux_fa_assets_doc | fa_assets | yes | 20261223000350_fin_fixed_assets.up.sql |
| ux_fa_assets_equipment | fa_assets | yes | 20261223000350_fin_fixed_assets.up.sql |
| ux_fa_assets_small | fa_assets | yes | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_assets_list | fa_assets | no | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_assets_project | fa_assets | no | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_assets_site | fa_assets | no | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_assets_bill | fa_assets | no | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_assets_cwip | fa_assets | no | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_assets_wf | fa_assets | no | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_assets_journal | fa_assets | no | 20261223000350_fin_fixed_assets.up.sql |
| ux_fa_dep_runs_doc | fa_dep_runs | yes | 20261223000350_fin_fixed_assets.up.sql |
| ux_fa_dep_runs_period | fa_dep_runs | yes | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_dep_runs_journal | fa_dep_runs | no | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_dep_runs_period_id | fa_dep_runs | no | 20261223000350_fin_fixed_assets.up.sql |
| ux_fa_depreciation | fa_depreciation | yes | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_depreciation_run | fa_depreciation | no | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_depreciation_period | fa_depreciation | no | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_depreciation_period_id | fa_depreciation | no | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_depreciation_journal | fa_depreciation | no | 20261223000350_fin_fixed_assets.up.sql |
| ux_fa_transfers_doc | fa_transfers | yes | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_transfers_asset | fa_transfers | no | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_transfers_from | fa_transfers | no | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_transfers_to | fa_transfers | no | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_transfers_from_site | fa_transfers | no | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_transfers_to_site | fa_transfers | no | 20261223000350_fin_fixed_assets.up.sql |
| ux_fa_disposals_doc | fa_disposals | yes | 20261223000350_fin_fixed_assets.up.sql |
| ux_fa_disposals_live | fa_disposals | yes | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_disposals_list | fa_disposals | no | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_disposals_buyer | fa_disposals | no | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_disposals_wf | fa_disposals | no | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_disposals_journal | fa_disposals | no | 20261223000350_fin_fixed_assets.up.sql |
| ux_fa_verifications_doc | fa_verifications | yes | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_verifications_project | fa_verifications | no | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_verifications_site | fa_verifications | no | 20261223000350_fin_fixed_assets.up.sql |
| ux_fa_verification_lines | fa_verification_lines | yes | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_verification_lines_asset | fa_verification_lines | no | 20261223000350_fin_fixed_assets.up.sql |
| ix_fa_verification_lines_company_id | fa_verification_lines | no | 20261223000350_fin_fixed_assets.up.sql |
| ux_fa_tax_openings_block | fa_tax_openings | yes | 20261224000352_fin_fa_tax_openings.up.sql |
| ux_fa_asset_components_asset | fa_asset_components | yes | 20261224000353_fin_fa_components.up.sql |
| ix_fa_asset_components_parent | fa_asset_components | no | 20261224000353_fin_fa_components.up.sql |
| ix_fa_asset_components_company | fa_asset_components | no | 20261224000353_fin_fa_components.up.sql |
| ix_gst_itc_review_lines_review | gst_itc_review_lines | no | 20261224000354_fin_itc_reclaim.up.sql |
| ix_gst_itc_review_lines_bill | gst_itc_review_lines | no | 20261224000354_fin_itc_reclaim.up.sql |
| ix_gst_itc_review_lines_2b | gst_itc_review_lines | no | 20261224000354_fin_itc_reclaim.up.sql |
| ix_gst_itc_review_lines_company_id | gst_itc_review_lines | no | 20261224000354_fin_itc_reclaim.up.sql |
| ux_tcs_collections_invoice | tcs_collections | yes | 20261224000355_fin_tcs.up.sql |
| ix_tcs_collections_date | tcs_collections | no | 20261224000355_fin_tcs.up.sql |
| ix_tcs_collections_partner | tcs_collections | no | 20261224000355_fin_tcs.up.sql |
| ix_tcs_collections_journal | tcs_collections | no | 20261224000355_fin_tcs.up.sql |
| ux_pa_revenue_recognition_doc | pa_revenue_recognition | yes | 20261225000356_fin_project_accounting.up.sql |
| ux_pa_revenue_recognition_open | pa_revenue_recognition | yes | 20261225000356_fin_project_accounting.up.sql |
| ix_pa_revenue_recognition_list | pa_revenue_recognition | no | 20261225000356_fin_project_accounting.up.sql |
| ix_pa_revenue_recognition_project | pa_revenue_recognition | no | 20261225000356_fin_project_accounting.up.sql |
| ix_pa_revenue_recognition_period | pa_revenue_recognition | no | 20261225000356_fin_project_accounting.up.sql |
| ix_pa_revenue_recognition_wf | pa_revenue_recognition | no | 20261225000356_fin_project_accounting.up.sql |
| ix_pa_revenue_recognition_journal | pa_revenue_recognition | no | 20261225000356_fin_project_accounting.up.sql |
| ix_pa_revenue_recognition_amends | pa_revenue_recognition | no | 20261225000356_fin_project_accounting.up.sql |
| ux_pa_overhead_allocations_run | pa_overhead_allocations | yes | 20261225000356_fin_project_accounting.up.sql |
| ix_pa_overhead_allocations_list | pa_overhead_allocations | no | 20261225000356_fin_project_accounting.up.sql |
| ix_pa_overhead_allocations_project | pa_overhead_allocations | no | 20261225000356_fin_project_accounting.up.sql |
| ix_pa_overhead_allocations_period | pa_overhead_allocations | no | 20261225000356_fin_project_accounting.up.sql |
| ix_pa_overhead_allocations_journal | pa_overhead_allocations | no | 20261225000356_fin_project_accounting.up.sql |
| ix_pa_overhead_allocations_rev | pa_overhead_allocations | no | 20261225000356_fin_project_accounting.up.sql |
| ux_fc_forecasts_doc | fc_forecasts | yes | 20261225000358_fin_cost_forecast.up.sql |
| ux_fc_forecasts_open | fc_forecasts | yes | 20261225000358_fin_cost_forecast.up.sql |
| ix_fc_forecasts_list | fc_forecasts | no | 20261225000358_fin_cost_forecast.up.sql |
| ix_fc_forecasts_project | fc_forecasts | no | 20261225000358_fin_cost_forecast.up.sql |
| ix_fc_forecasts_period | fc_forecasts | no | 20261225000358_fin_cost_forecast.up.sql |
| ix_fc_forecasts_wf | fc_forecasts | no | 20261225000358_fin_cost_forecast.up.sql |
| ix_fc_forecasts_prev | fc_forecasts | no | 20261225000358_fin_cost_forecast.up.sql |
| ix_fc_forecasts_amends | fc_forecasts | no | 20261225000358_fin_cost_forecast.up.sql |
| ux_fc_forecast_lines_key | fc_forecast_lines | yes | 20261225000358_fin_cost_forecast.up.sql |
| ix_fc_forecast_lines_forecast | fc_forecast_lines | no | 20261225000358_fin_cost_forecast.up.sql |
| ix_fc_forecast_lines_wbs | fc_forecast_lines | no | 20261225000358_fin_cost_forecast.up.sql |
| ix_fc_forecast_lines_code | fc_forecast_lines | no | 20261225000358_fin_cost_forecast.up.sql |
| ix_fc_forecast_lines_company | fc_forecast_lines | no | 20261225000358_fin_cost_forecast.up.sql |
| ux_pl_structure_line | pl_structure | yes | 20261225000360_fin_project_pl.up.sql |
| ix_pl_structure_company | pl_structure | no | 20261225000360_fin_project_pl.up.sql |
| ux_pl_snapshots_doc | pl_snapshots | yes | 20261225000360_fin_project_pl.up.sql |
| ux_pl_snapshots_open | pl_snapshots | yes | 20261225000360_fin_project_pl.up.sql |
| ix_pl_snapshots_list | pl_snapshots | no | 20261225000360_fin_project_pl.up.sql |
| ix_pl_snapshots_project | pl_snapshots | no | 20261225000360_fin_project_pl.up.sql |
| ix_pl_snapshots_period | pl_snapshots | no | 20261225000360_fin_project_pl.up.sql |
| ix_pl_snapshots_wf | pl_snapshots | no | 20261225000360_fin_project_pl.up.sql |
| ix_pl_snapshots_amends | pl_snapshots | no | 20261225000360_fin_project_pl.up.sql |
| ux_cf_forecasts_doc | cf_forecasts | yes | 20261226000362_fin_cash_forecast.up.sql |
| ux_cf_forecasts_open | cf_forecasts | yes | 20261226000362_fin_cash_forecast.up.sql |
| ix_cf_forecasts_list | cf_forecasts | no | 20261226000362_fin_cash_forecast.up.sql |
| ix_cf_forecasts_wf | cf_forecasts | no | 20261226000362_fin_cash_forecast.up.sql |
| ix_cf_forecasts_amends | cf_forecasts | no | 20261226000362_fin_cash_forecast.up.sql |
| ix_cf_lines_forecast | cf_lines | no | 20261226000362_fin_cash_forecast.up.sql |
| ix_cf_lines_project | cf_lines | no | 20261226000362_fin_cash_forecast.up.sql |
| ix_cf_lines_company | cf_lines | no | 20261226000362_fin_cash_forecast.up.sql |
| ix_cf_bank_limits_company | cf_bank_limits | no | 20261226000362_fin_cash_forecast.up.sql |
| ix_cf_bank_limits_bank | cf_bank_limits | no | 20261226000362_fin_cash_forecast.up.sql |
| ux_cf_priority_partners | cf_priority_partners | yes | 20261226000362_fin_cash_forecast.up.sql |
| ix_cf_priority_partners_partner | cf_priority_partners | no | 20261226000362_fin_cash_forecast.up.sql |
| ux_close_periods_doc | close_periods | yes | 20261226000364_fin_period_close.up.sql |
| ux_close_periods_open | close_periods | yes | 20261226000364_fin_period_close.up.sql |
| ix_close_periods_list | close_periods | no | 20261226000364_fin_period_close.up.sql |
| ix_close_periods_period_id | close_periods | no | 20261226000364_fin_period_close.up.sql |
| ix_close_periods_wf | close_periods | no | 20261226000364_fin_period_close.up.sql |
| ix_close_periods_amends | close_periods | no | 20261226000364_fin_period_close.up.sql |
| ux_close_tasks_code | close_tasks | yes | 20261226000364_fin_period_close.up.sql |
| ix_close_tasks_close_id | close_tasks | no | 20261226000364_fin_period_close.up.sql |
| ix_close_tasks_company_id | close_tasks | no | 20261226000364_fin_period_close.up.sql |
| ix_close_tasks_owner | close_tasks | no | 20261226000364_fin_period_close.up.sql |
| ux_close_reopens_doc | close_reopens | yes | 20261226000364_fin_period_close.up.sql |
| ux_close_reopens_open | close_reopens | yes | 20261226000364_fin_period_close.up.sql |
| ix_close_reopens_close_id | close_reopens | no | 20261226000364_fin_period_close.up.sql |
| ix_close_reopens_period_id | close_reopens | no | 20261226000364_fin_period_close.up.sql |
| ix_close_reopens_list | close_reopens | no | 20261226000364_fin_period_close.up.sql |
| ix_close_reopens_wf | close_reopens | no | 20261226000364_fin_period_close.up.sql |
| ix_close_reopens_amends | close_reopens | no | 20261226000364_fin_period_close.up.sql |
| ux_ic_relationships_pair | ic_relationships | yes | 20261226000366_fin_intercompany.up.sql |
| ix_ic_relationships_cp | ic_relationships | no | 20261226000366_fin_intercompany.up.sql |
| ix_ic_relationships_company_id | ic_relationships | no | 20261226000366_fin_intercompany.up.sql |
| ux_ic_transactions_doc | ic_transactions | yes | 20261226000366_fin_intercompany.up.sql |
| ix_ic_transactions_list | ic_transactions | no | 20261226000366_fin_intercompany.up.sql |
| ix_ic_transactions_to | ic_transactions | no | 20261226000366_fin_intercompany.up.sql |
| ix_ic_transactions_rel | ic_transactions | no | 20261226000366_fin_intercompany.up.sql |
| ix_ic_transactions_from_acct | ic_transactions | no | 20261226000366_fin_intercompany.up.sql |
| ix_ic_transactions_to_acct | ic_transactions | no | 20261226000366_fin_intercompany.up.sql |
| ix_ic_transactions_project | ic_transactions | no | 20261226000366_fin_intercompany.up.sql |
| ix_ic_transactions_wf | ic_transactions | no | 20261226000366_fin_intercompany.up.sql |
| ix_ic_transactions_amends | ic_transactions | no | 20261226000366_fin_intercompany.up.sql |
| ux_ic_consolidations_doc | ic_consolidations | yes | 20261226000366_fin_intercompany.up.sql |
| ix_ic_consolidations_list | ic_consolidations | no | 20261226000366_fin_intercompany.up.sql |
| ux_jv_shares_partner | jv_shares | yes | 20261226000366_fin_intercompany.up.sql |
| ix_jv_shares_project | jv_shares | no | 20261226000366_fin_intercompany.up.sql |
| ix_jv_shares_partner_id | jv_shares | no | 20261226000366_fin_intercompany.up.sql |
| ix_jv_shares_partner_company | jv_shares | no | 20261226000366_fin_intercompany.up.sql |
| ux_pay_components_code | pay_components | yes | 20261227000368_pay_setup.up.sql |
| ix_pay_components_list | pay_components | no | 20261227000368_pay_setup.up.sql |
| ux_pay_structures_active | pay_structures | yes | 20261227000368_pay_setup.up.sql |
| ix_pay_structures_list | pay_structures | no | 20261227000368_pay_setup.up.sql |
| ix_pay_structures_prev | pay_structures | no | 20261227000368_pay_setup.up.sql |
| ux_pay_assignments_doc | pay_assignments | yes | 20261227000368_pay_setup.up.sql |
| ux_pay_assignments_open | pay_assignments | yes | 20261227000368_pay_setup.up.sql |
| ix_pay_assignments_list | pay_assignments | no | 20261227000368_pay_setup.up.sql |
| ix_pay_assignments_employee | pay_assignments | no | 20261227000368_pay_setup.up.sql |
| ix_pay_assignments_structure | pay_assignments | no | 20261227000368_pay_setup.up.sql |
| ix_pay_assignments_prev | pay_assignments | no | 20261227000368_pay_setup.up.sql |
| ix_pay_assignments_wf | pay_assignments | no | 20261227000368_pay_setup.up.sql |
| ix_pay_assignments_amends | pay_assignments | no | 20261227000368_pay_setup.up.sql |
| ix_pay_arrears_assignment | pay_arrears | no | 20261227000368_pay_setup.up.sql |
| ix_pay_arrears_employee | pay_arrears | no | 20261227000368_pay_setup.up.sql |
| ix_pay_arrears_employee_id | pay_arrears | no | 20261227000368_pay_setup.up.sql |
| ux_pay_statutory_params_doc | pay_statutory_params | yes | 20261227000368_pay_setup.up.sql |
| ix_pay_statutory_params_key | pay_statutory_params | no | 20261227000368_pay_setup.up.sql |
| ix_pay_statutory_params_company | pay_statutory_params | no | 20261227000368_pay_setup.up.sql |
| ix_pay_statutory_params_wf | pay_statutory_params | no | 20261227000368_pay_setup.up.sql |
| ix_pay_statutory_params_amends | pay_statutory_params | no | 20261227000368_pay_setup.up.sql |
| ux_pay_calendar_period | pay_calendar | yes | 20261227000368_pay_setup.up.sql |
| ix_pay_calendar_status | pay_calendar | no | 20261227000368_pay_setup.up.sql |
| ux_pay_runs_doc | pay_runs | yes | 20261227000370_pay_runs.up.sql |
| ux_pay_runs_regular | pay_runs | yes | 20261227000370_pay_runs.up.sql |
| ix_pay_runs_list | pay_runs | no | 20261227000370_pay_runs.up.sql |
| ix_pay_runs_period_id | pay_runs | no | 20261227000370_pay_runs.up.sql |
| ix_pay_runs_branch | pay_runs | no | 20261227000370_pay_runs.up.sql |
| ix_pay_runs_wf | pay_runs | no | 20261227000370_pay_runs.up.sql |
| ix_pay_runs_amends | pay_runs | no | 20261227000370_pay_runs.up.sql |
| ux_pay_run_lines_emp | pay_run_lines | yes | 20261227000370_pay_runs.up.sql |
| ix_pay_run_lines_run_id | pay_run_lines | no | 20261227000370_pay_runs.up.sql |
| ix_pay_run_lines_company_id | pay_run_lines | no | 20261227000370_pay_runs.up.sql |
| ix_pay_run_lines_employee | pay_run_lines | no | 20261227000370_pay_runs.up.sql |
| ix_pay_run_lines_assignment | pay_run_lines | no | 20261227000370_pay_runs.up.sql |
| ux_pay_inputs_source | pay_inputs | yes | 20261227000370_pay_runs.up.sql |
| ix_pay_inputs_employee | pay_inputs | no | 20261227000370_pay_runs.up.sql |
| ix_pay_inputs_company | pay_inputs | no | 20261227000370_pay_runs.up.sql |
| ix_pay_inputs_run_id | pay_inputs | no | 20261227000370_pay_runs.up.sql |
| ux_pay_tax_declarations_emp | pay_tax_declarations | yes | 20261227000370_pay_runs.up.sql |
| ix_pay_tax_declarations_company | pay_tax_declarations | no | 20261227000370_pay_runs.up.sql |
| ux_pay_wage_runs_doc | pay_wage_runs | yes | 20261227000372_pay_wages.up.sql |
| ix_pay_wage_runs_list | pay_wage_runs | no | 20261227000372_pay_wages.up.sql |
| ix_pay_wage_runs_site | pay_wage_runs | no | 20261227000372_pay_wages.up.sql |
| ix_pay_wage_runs_org_project_id | pay_wage_runs | no | 20261227000372_pay_wages.up.sql |
| ix_pay_wage_runs_contractor_id | pay_wage_runs | no | 20261227000372_pay_wages.up.sql |
| ix_pay_wage_runs_wf | pay_wage_runs | no | 20261227000372_pay_wages.up.sql |
| ix_pay_wage_runs_amends | pay_wage_runs | no | 20261227000372_pay_wages.up.sql |
| ux_pay_wage_lines_worker | pay_wage_lines | yes | 20261227000372_pay_wages.up.sql |
| ix_pay_wage_lines_run_id | pay_wage_lines | no | 20261227000372_pay_wages.up.sql |
| ix_pay_wage_lines_company_id | pay_wage_lines | no | 20261227000372_pay_wages.up.sql |
| ix_pay_wage_lines_worker_id | pay_wage_lines | no | 20261227000372_pay_wages.up.sql |
| ix_pay_wage_lines_ack_file_id | pay_wage_lines | no | 20261227000372_pay_wages.up.sql |
| ux_pay_contractor_wage_checks_doc | pay_contractor_wage_checks | yes | 20261227000372_pay_wages.up.sql |
| ux_pay_contractor_wage_checks_key | pay_contractor_wage_checks | yes | 20261227000372_pay_wages.up.sql |
| ix_pay_contractor_wage_checks_list | pay_contractor_wage_checks | no | 20261227000372_pay_wages.up.sql |
| ix_pay_contractor_wage_checks_contractor_id | pay_contractor_wage_checks | no | 20261227000372_pay_wages.up.sql |
| ix_pay_contractor_wage_checks_org_project_id | pay_contractor_wage_checks | no | 20261227000372_pay_wages.up.sql |
| ix_pay_contractor_wage_checks_org_site_id | pay_contractor_wage_checks | no | 20261227000372_pay_wages.up.sql |
| ix_pay_contractor_wage_checks_wage_sheet_file_id | pay_contractor_wage_checks | no | 20261227000372_pay_wages.up.sql |
| ix_pay_contractor_wage_checks_proof_file_id | pay_contractor_wage_checks | no | 20261227000372_pay_wages.up.sql |
| ux_stat_filings_doc | stat_filings | yes | 20261227000374_stat_compliance.up.sql |
| ux_stat_filings_period | stat_filings | yes | 20261227000374_stat_compliance.up.sql |
| ix_stat_filings_list | stat_filings | no | 20261227000374_stat_compliance.up.sql |
| ix_stat_filings_source_run_id | stat_filings | no | 20261227000374_stat_compliance.up.sql |
| ix_stat_filings_register_id | stat_filings | no | 20261227000374_stat_compliance.up.sql |
| ix_stat_filings_wf | stat_filings | no | 20261227000374_stat_compliance.up.sql |
| ix_stat_filings_amends | stat_filings | no | 20261227000374_stat_compliance.up.sql |
| ix_stat_registers_list | stat_registers | no | 20261227000374_stat_compliance.up.sql |
| ix_stat_registers_site_id | stat_registers | no | 20261227000374_stat_compliance.up.sql |
| ix_stat_registers_source_run_id | stat_registers | no | 20261227000374_stat_compliance.up.sql |
| ux_stat_rules_key | stat_rules | yes | 20261227000374_stat_compliance.up.sql |
| ix_stat_rules_type | stat_rules | no | 20261227000374_stat_compliance.up.sql |
| ux_stat_bocw_months | stat_bocw_months | yes | 20261227000374_stat_compliance.up.sql |
| ix_stat_bocw_months_filing_id | stat_bocw_months | no | 20261227000374_stat_compliance.up.sql |
| ix_stat_bocw_months_period | stat_bocw_months | no | 20261227000374_stat_compliance.up.sql |
| ix_stat_bocw_months_project | stat_bocw_months | no | 20261227000374_stat_compliance.up.sql |
| ix_stat_rules_company_id | stat_rules | no | 20261227000374_stat_compliance.up.sql |
| ux_pay_fnf_doc | pay_fnf | yes | 20261227000376_pay_settle.up.sql |
| ux_pay_fnf_separation | pay_fnf | yes | 20261227000376_pay_settle.up.sql |
| ix_pay_fnf_list | pay_fnf | no | 20261227000376_pay_settle.up.sql |
| ix_pay_fnf_employee_id | pay_fnf | no | 20261227000376_pay_settle.up.sql |
| ix_pay_fnf_separation_id | pay_fnf | no | 20261227000376_pay_settle.up.sql |
| ix_pay_fnf_amends_id | pay_fnf | no | 20261227000376_pay_settle.up.sql |
| ix_pay_fnf_wf | pay_fnf | no | 20261227000376_pay_settle.up.sql |
| ix_pay_fnf_pay | pay_fnf | no | 20261227000376_pay_settle.up.sql |
| ux_pay_payslips_current | pay_payslips | yes | 20261227000376_pay_settle.up.sql |
| ix_pay_payslips_list | pay_payslips | no | 20261227000376_pay_settle.up.sql |
| ix_pay_payslips_run_id | pay_payslips | no | 20261227000376_pay_settle.up.sql |
| ix_pay_payslips_run_line_id | pay_payslips | no | 20261227000376_pay_settle.up.sql |
| ix_pay_payslips_employee_id | pay_payslips | no | 20261227000376_pay_settle.up.sql |
| ix_pay_payslips_generated_doc_id | pay_payslips | no | 20261227000376_pay_settle.up.sql |
| ix_pay_payslips_file_id | pay_payslips | no | 20261227000376_pay_settle.up.sql |
| ux_pay_transfers_doc | pay_transfers | yes | 20261227000376_pay_settle.up.sql |
| ix_pay_transfers_list | pay_transfers | no | 20261227000376_pay_settle.up.sql |
| ix_pay_transfers_run_id | pay_transfers | no | 20261227000376_pay_settle.up.sql |
| ix_pay_transfers_fnf_id | pay_transfers | no | 20261227000376_pay_settle.up.sql |
| ix_pay_transfers_bank_account_id | pay_transfers | no | 20261227000376_pay_settle.up.sql |
| ix_pay_transfers_journal_id | pay_transfers | no | 20261227000376_pay_settle.up.sql |
| ux_pay_transfer_lines_run_line | pay_transfer_lines | yes | 20261227000376_pay_settle.up.sql |
| ux_pay_transfer_lines_fnf | pay_transfer_lines | yes | 20261227000376_pay_settle.up.sql |
| ix_pay_transfer_lines_transfer_id | pay_transfer_lines | no | 20261227000376_pay_settle.up.sql |
| ix_pay_transfer_lines_company_id | pay_transfer_lines | no | 20261227000376_pay_settle.up.sql |
| ix_pay_transfer_lines_employee_id | pay_transfer_lines | no | 20261227000376_pay_settle.up.sql |
| ix_pay_transfer_lines_employee_bank_id | pay_transfer_lines | no | 20261227000376_pay_settle.up.sql |
| ix_pay_transfer_lines_reversal | pay_transfer_lines | no | 20261227000376_pay_settle.up.sql |
| ux_pay_fnf_rules | pay_fnf_rules | yes | 20261227000376_pay_settle.up.sql |
| ix_pay_fnf_rules_company_id | pay_fnf_rules | no | 20261227000376_pay_settle.up.sql |
| ux_ptl_accounts_doc_no | ptl_accounts | yes | 20261227000378_portal_core.up.sql |
| ux_ptl_accounts_invite | ptl_accounts | yes | 20261227000378_portal_core.up.sql |
| ux_ptl_accounts_contact | ptl_accounts | yes | 20261227000378_portal_core.up.sql |
| ux_ptl_accounts_stakeholder | ptl_accounts | yes | 20261227000378_portal_core.up.sql |
| ix_ptl_accounts_contact_id | ptl_accounts | no | 20261227000378_portal_core.up.sql |
| ix_ptl_accounts_partner_id | ptl_accounts | no | 20261227000378_portal_core.up.sql |
| ix_ptl_accounts_company_status | ptl_accounts | no | 20261227000378_portal_core.up.sql |
| ix_ptl_accounts_company_created | ptl_accounts | no | 20261227000378_portal_core.up.sql |
| ix_ptl_accounts_company_role | ptl_accounts | no | 20261227000378_portal_core.up.sql |
| ix_ptl_sessions_account | ptl_sessions | no | 20261227000378_portal_core.up.sql |
| ix_ptl_sessions_expiry | ptl_sessions | no | 20261227000378_portal_core.up.sql |
| ix_ptl_messages_account | ptl_messages | no | 20261227000379_portal_exchange.up.sql |
| ix_ptl_messages_company_status | ptl_messages | no | 20261227000379_portal_exchange.up.sql |
| ix_ptl_messages_company_kind | ptl_messages | no | 20261227000379_portal_exchange.up.sql |
| ux_ptl_shares_active | ptl_shares | yes | 20261227000379_portal_exchange.up.sql |
| ix_ptl_shares_version | ptl_shares | no | 20261227000379_portal_exchange.up.sql |
| ix_ptl_shares_account | ptl_shares | no | 20261227000379_portal_exchange.up.sql |
| ix_ptl_shares_company | ptl_shares | no | 20261227000379_portal_exchange.up.sql |
| ix_ptl_registrations_partner | ptl_registrations | no | 20261227000379_portal_exchange.up.sql |
| ix_ptl_asn_invoices_file | ptl_asn_invoices | no | 20261227000382_supplier_intake.up.sql |
| ix_ptl_vdr_orders_po | ptl_vdr_orders | no | 20261227000382_supplier_intake.up.sql |
| ix_rpt_subscriptions_company_status | rpt_subscriptions | no | 20261227000392_bi_subscriptions.up.sql |
| ix_rpt_subscriptions_owner | rpt_subscriptions | no | 20261227000392_bi_subscriptions.up.sql |
| ix_rpt_subscriptions_view | rpt_subscriptions | no | 20261227000392_bi_subscriptions.up.sql |
| ix_rpt_subscriptions_due | rpt_subscriptions | no | 20261227000392_bi_subscriptions.up.sql |
| ux_rpt_subscriptions_name | rpt_subscriptions | yes | 20261227000392_bi_subscriptions.up.sql |
| ix_rpt_runs_company_status | rpt_runs | no | 20261227000392_bi_subscriptions.up.sql |
| ix_rpt_runs_company_date | rpt_runs | no | 20261227000392_bi_subscriptions.up.sql |
| ux_rpt_runs_slot | rpt_runs | yes | 20261227000392_bi_subscriptions.up.sql |
| ix_rpt_runs_export | rpt_runs | no | 20261227000392_bi_subscriptions.up.sql |
| ix_rpt_runs_notification | rpt_runs | no | 20261227000392_bi_subscriptions.up.sql |
| ix_rpt_runs_pending | rpt_runs | no | 20261227000392_bi_subscriptions.up.sql |
| ix_bi_metrics_company_status | bi_metrics | no | 20261227000394_metric_catalogue.up.sql |
| ix_bi_refresh_log_company_status | bi_refresh_log | no | 20261227000394_metric_catalogue.up.sql |
| ix_bi_project_snapshots_project | bi_project_snapshots | no | 20261227000394_metric_catalogue.up.sql |
| ix_bi_project_snapshots_company_status | bi_project_snapshots | no | 20261227000394_metric_catalogue.up.sql |
| ix_bi_project_snapshots_company_refresh | bi_project_snapshots | no | 20261227000394_metric_catalogue.up.sql |
| ix_bi_domain_refreshes_company_status | bi_domain_refreshes | no | 20261227000395_bi_domain_observations.up.sql |
| ix_bi_domain_observations_project | bi_domain_observations | no | 20261227000395_bi_domain_observations.up.sql |
| ix_bi_domain_observations_company_status | bi_domain_observations | no | 20261227000395_bi_domain_observations.up.sql |
| ux_exec_alerts_open | exec_alerts | yes | 20261227000397_control_tower.up.sql |
| ix_exec_alerts_company_status | exec_alerts | no | 20261227000397_control_tower.up.sql |
| ix_exec_alerts_project | exec_alerts | no | 20261227000397_control_tower.up.sql |
| ix_exec_alerts_owner | exec_alerts | no | 20261227000397_control_tower.up.sql |
| ix_exec_alerts_owner_user | exec_alerts | no | 20261227000397_control_tower.up.sql |
| ix_exec_alerts_task | exec_alerts | no | 20261227000397_control_tower.up.sql |
| ix_exec_alerts_evidence | exec_alerts | no | 20261227000397_control_tower.up.sql |
| ix_exec_alert_settings_company | exec_alert_settings | no | 20261227000397_control_tower.up.sql |
| ix_exec_alert_settings_company_status | exec_alert_settings | no | 20261227000397_control_tower.up.sql |
| ix_mr_configs_company_status | mr_configs | no | 20261227000398_morning_report.up.sql |
| ix_mr_configs_scope | mr_configs | no | 20261227000398_morning_report.up.sql |
| ix_mr_reports_company_status | mr_reports | no | 20261227000398_morning_report.up.sql |
| ix_mr_reports_recipient | mr_reports | no | 20261227000398_morning_report.up.sql |
| ix_mr_reports_recipient_id | mr_reports | no | 20261227000398_morning_report.up.sql |
| ix_mr_reports_config | mr_reports | no | 20261227000398_morning_report.up.sql |
| ix_mr_reports_file | mr_reports | no | 20261227000398_morning_report.up.sql |
| ix_dei_daily_company_status | dei_daily | no | 20261227000399_execution_intelligence.up.sql |
| ix_dei_daily_date | dei_daily | no | 20261227000399_execution_intelligence.up.sql |
| ix_dei_daily_project | dei_daily | no | 20261227000399_execution_intelligence.up.sql |
| ix_dei_daily_site | dei_daily | no | 20261227000399_execution_intelligence.up.sql |
| ux_mc_monthly_closes_active | mc_monthly_closes | yes | 20261227000400_monthly_close.up.sql |
| ix_mc_monthly_closes_company_status | mc_monthly_closes | no | 20261227000400_monthly_close.up.sql |
| ix_mc_monthly_closes_project | mc_monthly_closes | no | 20261227000400_monthly_close.up.sql |
| ix_mc_monthly_closes_period | mc_monthly_closes | no | 20261227000400_monthly_close.up.sql |
| ix_mc_monthly_closes_period_id | mc_monthly_closes | no | 20261227000400_monthly_close.up.sql |
| ix_mc_monthly_closes_parent | mc_monthly_closes | no | 20261227000400_monthly_close.up.sql |
| ix_mc_monthly_closes_file | mc_monthly_closes | no | 20261227000400_monthly_close.up.sql |
| ix_det_rules_company_status | det_rules | no | 20261227000402_leakage_detection.up.sql |
| ix_det_rules_request | det_rules | no | 20261227000402_leakage_detection.up.sql |
| ix_det_findings_company_status | det_findings | no | 20261227000402_leakage_detection.up.sql |
| ix_det_findings_project | det_findings | no | 20261227000402_leakage_detection.up.sql |
| ix_det_findings_site | det_findings | no | 20261227000402_leakage_detection.up.sql |
| ix_det_findings_rule | det_findings | no | 20261227000402_leakage_detection.up.sql |
| ix_det_findings_owner | det_findings | no | 20261227000402_leakage_detection.up.sql |
| ix_det_findings_owner_user | det_findings | no | 20261227000402_leakage_detection.up.sql |
| ix_det_findings_detected | det_findings | no | 20261227000402_leakage_detection.up.sql |
| ix_det_findings_value | det_findings | no | 20261227000402_leakage_detection.up.sql |
| ix_det_findings_task | det_findings | no | 20261227000402_leakage_detection.up.sql |
| ix_det_findings_workflow | det_findings | no | 20261227000402_leakage_detection.up.sql |
| ix_scn_scenarios_company_status | scn_scenarios | no | 20261227000404_scenarios.up.sql |
| ix_scn_scenarios_project | scn_scenarios | no | 20261227000404_scenarios.up.sql |
| ix_scn_scenarios_owner | scn_scenarios | no | 20261227000404_scenarios.up.sql |
| ix_ai_providers_company_status | ai_providers | no | 20261227000405_ai_gateway.up.sql |
| ux_ai_features_version | ai_features | yes | 20261227000405_ai_gateway.up.sql |
| ix_ai_features_company_status | ai_features | no | 20261227000405_ai_gateway.up.sql |
| ix_ai_features_parent | ai_features | no | 20261227000405_ai_gateway.up.sql |
| ix_ai_features_workflow | ai_features | no | 20261227000405_ai_gateway.up.sql |
| ix_ai_logs_company_created | ai_logs | no | 20261227000405_ai_gateway.up.sql |
| ix_ai_logs_feature | ai_logs | no | 20261227000405_ai_gateway.up.sql |
| ix_ai_logs_user | ai_logs | no | 20261227000405_ai_gateway.up.sql |
| ix_ai_logs_user_id | ai_logs | no | 20261227000405_ai_gateway.up.sql |
| ix_ai_logs_outcome | ai_logs | no | 20261227000405_ai_gateway.up.sql |
| ix_ai_logs_project | ai_logs | no | 20261227000405_ai_gateway.up.sql |
| ix_ai_drafts_owner | ai_drafts | no | 20261227000406_ai_assistant.up.sql |
| ix_ai_drafts_log | ai_drafts | no | 20261227000406_ai_assistant.up.sql |
| ix_ai_drafts_company_status | ai_drafts | no | 20261227000406_ai_assistant.up.sql |
| ix_ai_drafts_project | ai_drafts | no | 20261227000406_ai_assistant.up.sql |
| ix_ai_feedback_feature | ai_feedback | no | 20261227000406_ai_assistant.up.sql |
| ux_aif_models_version | aif_models | yes | 20261227000407_ai_forecasting.up.sql |
| ix_aif_models_use_case | aif_models | no | 20261227000407_ai_forecasting.up.sql |
| ix_aif_models_parent | aif_models | no | 20261227000407_ai_forecasting.up.sql |
| ix_aif_models_workflow | aif_models | no | 20261227000407_ai_forecasting.up.sql |
| ix_aif_forecasts_model | aif_forecasts | no | 20261227000407_ai_forecasting.up.sql |
| ix_aif_forecasts_project | aif_forecasts | no | 20261227000407_ai_forecasting.up.sql |
| ix_aif_forecasts_company_as_of | aif_forecasts | no | 20261227000407_ai_forecasting.up.sql |
| ix_aif_anomalies_status | aif_anomalies | no | 20261227000407_ai_forecasting.up.sql |
| ix_aif_anomalies_project | aif_anomalies | no | 20261227000407_ai_forecasting.up.sql |
| ix_aif_anomalies_site | aif_anomalies | no | 20261227000407_ai_forecasting.up.sql |
| ux_di_extractions_file | di_extractions | yes | 20261227000408_ai_docintel.up.sql |
| ix_di_extractions_queue | di_extractions | no | 20261227000408_ai_docintel.up.sql |
| ix_di_extractions_type | di_extractions | no | 20261227000408_ai_docintel.up.sql |
| ix_di_extractions_sha | di_extractions | no | 20261227000408_ai_docintel.up.sql |
| ix_di_extractions_file | di_extractions | no | 20261227000408_ai_docintel.up.sql |
| ix_di_extractions_dup | di_extractions | no | 20261227000408_ai_docintel.up.sql |
| ix_di_extractions_project | di_extractions | no | 20261227000408_ai_docintel.up.sql |
| ix_di_extractions_site | di_extractions | no | 20261227000408_ai_docintel.up.sql |
| ux_cv_results_file | cv_results | yes | 20261227000409_ai_vision.up.sql |
| ix_cv_results_queue | cv_results | no | 20261227000409_ai_vision.up.sql |
| ix_cv_results_file | cv_results | no | 20261227000409_ai_vision.up.sql |
| ix_cv_results_blurred | cv_results | no | 20261227000409_ai_vision.up.sql |
| ix_cv_results_project | cv_results | no | 20261227000409_ai_vision.up.sql |
| ix_cv_results_site | cv_results | no | 20261227000409_ai_vision.up.sql |
| ix_adm_emergency_company | adm_emergency_actions | no | 20261227000410_admin_control.up.sql |
| ix_adm_emergency_request | adm_emergency_actions | no | 20261227000410_admin_control.up.sql |
| ix_adm_snapshots_company | adm_config_snapshots | no | 20261227000410_admin_control.up.sql |
| ix_adm_snapshots_file | adm_config_snapshots | no | 20261227000410_admin_control.up.sql |
| ux_int_mappings_active | int_mappings | yes | 20261227000411_admin_connectors.up.sql |
| ix_int_mappings_lookup | int_mappings | no | 20261227000411_admin_connectors.up.sql |
| ix_int_mappings_request | int_mappings | no | 20261227000411_admin_connectors.up.sql |
| ix_int_sync_runs_list | int_sync_runs | no | 20261227000411_admin_connectors.up.sql |
| ix_int_sync_runs_company | int_sync_runs | no | 20261227000411_admin_connectors.up.sql |
| ux_api_clients_client_id | api_clients | yes | 20261227000412_admin_api_platform.up.sql |
| ix_api_clients_list | api_clients | no | 20261227000412_admin_api_platform.up.sql |
| ix_api_clients_partner | api_clients | no | 20261227000412_admin_api_platform.up.sql |
| ix_api_clients_user | api_clients | no | 20261227000412_admin_api_platform.up.sql |
| ix_api_clients_request | api_clients | no | 20261227000412_admin_api_platform.up.sql |
| ux_api_tokens_hash | api_tokens | yes | 20261227000412_admin_api_platform.up.sql |
| ix_api_tokens_client | api_tokens | no | 20261227000412_admin_api_platform.up.sql |
| ix_api_tokens_company | api_tokens | no | 20261227000412_admin_api_platform.up.sql |
| ix_api_webhooks_list | api_webhooks | no | 20261227000412_admin_api_platform.up.sql |
| ix_api_webhooks_client | api_webhooks | no | 20261227000412_admin_api_platform.up.sql |
| ux_api_webhook_deliveries_event | api_webhook_deliveries | yes | 20261227000412_admin_api_platform.up.sql |
| ix_api_webhook_deliveries_due | api_webhook_deliveries | no | 20261227000412_admin_api_platform.up.sql |
| ix_api_webhook_deliveries_list | api_webhook_deliveries | no | 20261227000412_admin_api_platform.up.sql |
| ix_api_webhook_deliveries_replay | api_webhook_deliveries | no | 20261227000412_admin_api_platform.up.sql |
| ux_api_usage_day | api_usage | yes | 20261227000412_admin_api_platform.up.sql |
| ix_api_usage_company | api_usage | no | 20261227000412_admin_api_platform.up.sql |
| ux_xl_packs_version | xl_packs | yes | 20261227000413_admin_bulk_entry.up.sql |
| ux_xl_packs_active | xl_packs | yes | 20261227000413_admin_bulk_entry.up.sql |
| ux_xl_bulk_batches_doc | xl_bulk_batches | yes | 20261227000413_admin_bulk_entry.up.sql |
| ix_xl_bulk_batches_list | xl_bulk_batches | no | 20261227000413_admin_bulk_entry.up.sql |
| ix_xl_bulk_batches_status | xl_bulk_batches | no | 20261227000413_admin_bulk_entry.up.sql |
| ix_xl_bulk_batches_request | xl_bulk_batches | no | 20261227000413_admin_bulk_entry.up.sql |
| ux_mig_objects_code | mig_objects | yes | 20261227000414_admin_migration.up.sql |
| ix_mig_objects_board | mig_objects | no | 20261227000414_admin_migration.up.sql |
| ix_mig_objects_request | mig_objects | no | 20261227000414_admin_migration.up.sql |
| ix_mig_runs_object | mig_runs | no | 20261227000414_admin_migration.up.sql |
| ix_mig_runs_company | mig_runs | no | 20261227000414_admin_migration.up.sql |
| ix_mig_cutovers_company | mig_cutovers | no | 20261227000414_admin_migration.up.sql |
| ux_ops_backups_name | ops_backups | yes | 20261227000415_admin_backups.up.sql |
| ix_ops_backups_status | ops_backups | no | 20261227000415_admin_backups.up.sql |
| ix_ops_backups_type | ops_backups | no | 20261227000415_admin_backups.up.sql |
| ix_ops_restore_tests_backup | ops_restore_tests | no | 20261227000415_admin_backups.up.sql |
| ix_ops_restore_tests_kind | ops_restore_tests | no | 20261227000415_admin_backups.up.sql |
| ix_ops_restore_tests_report | ops_restore_tests | no | 20261227000415_admin_backups.up.sql |
| ix_ops_backup_alerts_open | ops_backup_alerts | no | 20261227000415_admin_backups.up.sql |
| ix_ops_restore_requests_company | ops_restore_requests | no | 20261227000415_admin_backups.up.sql |
| ix_ops_restore_requests_backup | ops_restore_requests | no | 20261227000415_admin_backups.up.sql |
| ix_ops_restore_requests_request | ops_restore_requests | no | 20261227000415_admin_backups.up.sql |
| ux_arc_policies_active | arc_policies | yes | 20261227000416_admin_archive.up.sql |
| ix_arc_policies_company | arc_policies | no | 20261227000416_admin_archive.up.sql |
| ix_arc_jobs_company | arc_jobs | no | 20261227000416_admin_archive.up.sql |
| ix_arc_jobs_request | arc_jobs | no | 20261227000416_admin_archive.up.sql |
| ix_arc_disposals_company | arc_disposals | no | 20261227000416_admin_archive.up.sql |
| ix_arc_disposals_request | arc_disposals | no | 20261227000416_admin_archive.up.sql |
| ux_arc_records_entity | arc_records | yes | 20261227000416_admin_archive.up.sql |
| ix_arc_records_search | arc_records | no | 20261227000416_admin_archive.up.sql |
| ix_arc_records_job | arc_records | no | 20261227000416_admin_archive.up.sql |
| ix_arc_records_disposal | arc_records | no | 20261227000416_admin_archive.up.sql |
| ix_arc_holds_entity | arc_holds | no | 20261227000416_admin_archive.up.sql |
| ix_arc_erasures_company | arc_erasures | no | 20261227000416_admin_archive.up.sql |
| ix_arc_erasures_request | arc_erasures | no | 20261227000416_admin_archive.up.sql |
| ux_hd_tickets_no | hd_tickets | yes | 20261227000417_admin_helpdesk.up.sql |
| ix_hd_tickets_queue | hd_tickets | no | 20261227000417_admin_helpdesk.up.sql |
| ix_hd_tickets_mine | hd_tickets | no | 20261227000417_admin_helpdesk.up.sql |
| ix_hd_tickets_assigned | hd_tickets | no | 20261227000417_admin_helpdesk.up.sql |
| ix_hd_tickets_sla | hd_tickets | no | 20261227000417_admin_helpdesk.up.sql |
| ix_hd_tickets_shot | hd_tickets | no | 20261227000417_admin_helpdesk.up.sql |
| ix_hd_ticket_notes_ticket | hd_ticket_notes | no | 20261227000417_admin_helpdesk.up.sql |
| ix_hd_ticket_notes_company | hd_ticket_notes | no | 20261227000417_admin_helpdesk.up.sql |
| ix_hd_corrections_company | hd_corrections | no | 20261227000417_admin_helpdesk.up.sql |
| ix_hd_corrections_ticket | hd_corrections | no | 20261227000417_admin_helpdesk.up.sql |
| ix_hd_corrections_request | hd_corrections | no | 20261227000417_admin_helpdesk.up.sql |
| ix_hd_articles_company | hd_articles | no | 20261227000417_admin_helpdesk.up.sql |
| ux_hd_tour_views | hd_tour_views | yes | 20261227000417_admin_helpdesk.up.sql |
| ix_hd_tour_views_article | hd_tour_views | no | 20261227000417_admin_helpdesk.up.sql |
| ux_tst_integration_runs_no | tst_integration_runs | yes | 20261228000418_tst_integration.up.sql |
| ix_tst_integration_runs_status | tst_integration_runs | no | 20261228000418_tst_integration.up.sql |
| ux_tst_latency_probes_no | tst_latency_probes | yes | 20261228000418_tst_integration.up.sql |
| ix_tst_latency_probes_status | tst_latency_probes | no | 20261228000418_tst_integration.up.sql |
| ux_tst_recon_runs_no | tst_recon_runs | yes | 20261228000419_tst_reconciliation.up.sql |
| ix_tst_recon_runs_status | tst_recon_runs | no | 20261228000419_tst_reconciliation.up.sql |
| ix_tst_recon_results_run | tst_recon_results | no | 20261228000419_tst_reconciliation.up.sql |
| ix_tst_recon_results_company | tst_recon_results | no | 20261228000419_tst_reconciliation.up.sql |
| ix_tst_recon_results_status | tst_recon_results | no | 20261228000419_tst_reconciliation.up.sql |
| ux_tst_page_audit_runs_no | tst_page_audit_runs | yes | 20261228000420_tst_page_audit.up.sql |
| ix_tst_page_audit_runs_kind | tst_page_audit_runs | no | 20261228000420_tst_page_audit.up.sql |
| ix_tst_page_audit_runs_status | tst_page_audit_runs | no | 20261228000420_tst_page_audit.up.sql |
| ix_tst_page_audit_page | tst_page_audit | no | 20261228000420_tst_page_audit.up.sql |
| ix_tst_page_audit_status | tst_page_audit | no | 20261228000420_tst_page_audit.up.sql |
| ix_tst_page_audit_run | tst_page_audit | no | 20261228000420_tst_page_audit.up.sql |
| ux_tst_test_runs_no | tst_test_runs | yes | 20261228000421_tst_test_programme.up.sql |
| ix_tst_test_runs_status | tst_test_runs | no | 20261228000421_tst_test_programme.up.sql |
| ux_tst_test_catalogue_id | tst_test_catalogue | yes | 20261228000421_tst_test_programme.up.sql |
| ix_tst_test_catalogue_part | tst_test_catalogue | no | 20261228000421_tst_test_programme.up.sql |
| ix_tst_test_catalogue_status | tst_test_catalogue | no | 20261228000421_tst_test_programme.up.sql |
| ix_tst_test_catalogue_run | tst_test_catalogue | no | 20261228000421_tst_test_programme.up.sql |
| ux_tst_sandbox_runs_no | tst_sandbox_runs | yes | 20261228000421_tst_test_programme.up.sql |
| ix_tst_sandbox_runs_status | tst_sandbox_runs | no | 20261228000421_tst_test_programme.up.sql |
| ux_sct_scan_runs_no | sct_scan_runs | yes | 20261228000422_sct_security.up.sql |
| ix_sct_scan_runs_kind | sct_scan_runs | no | 20261228000422_sct_security.up.sql |
| ix_sct_scan_runs_status | sct_scan_runs | no | 20261228000422_sct_security.up.sql |
| ux_sct_findings_no | sct_findings | yes | 20261228000422_sct_security.up.sql |
| ux_sct_findings_fp | sct_findings | yes | 20261228000422_sct_security.up.sql |
| ix_sct_findings_status | sct_findings | no | 20261228000422_sct_security.up.sql |
| ix_sct_findings_source | sct_findings | no | 20261228000422_sct_security.up.sql |
| ix_sct_findings_run | sct_findings | no | 20261228000422_sct_security.up.sql |
| ix_sct_findings_request | sct_findings | no | 20261228000422_sct_security.up.sql |
| ix_sct_reviews_control | sct_reviews | no | 20261228000422_sct_security.up.sql |
| ix_sct_reviews_status | sct_reviews | no | 20261228000422_sct_security.up.sql |
| ux_tst_perf_runs_no | tst_perf_runs | yes | 20261228000423_tst_performance.up.sql |
| ix_tst_perf_runs_profile | tst_perf_runs | no | 20261228000423_tst_performance.up.sql |
| ix_tst_perf_runs_status | tst_perf_runs | no | 20261228000423_tst_performance.up.sql |
| ix_tst_perf_results_run | tst_perf_results | no | 20261228000423_tst_performance.up.sql |
| ix_tst_perf_results_status | tst_perf_results | no | 20261228000423_tst_performance.up.sql |
| ix_core_sample_documents_list | core_sample_documents | no | 20261228000423_tst_performance.up.sql |
| ux_tst_devices_code | tst_devices | yes | 20261228000424_tst_a11y.up.sql |
| ix_tst_devices_status | tst_devices | no | 20261228000424_tst_a11y.up.sql |
| ux_tst_a11y_runs_no | tst_a11y_runs | yes | 20261228000424_tst_a11y.up.sql |
| ix_tst_a11y_runs_kind | tst_a11y_runs | no | 20261228000424_tst_a11y.up.sql |
| ix_tst_a11y_runs_status | tst_a11y_runs | no | 20261228000424_tst_a11y.up.sql |
| ix_tst_a11y_runs_device | tst_a11y_runs | no | 20261228000424_tst_a11y.up.sql |
| ix_tst_a11y_results_run | tst_a11y_results | no | 20261228000424_tst_a11y.up.sql |
| ix_tst_a11y_results_page | tst_a11y_results | no | 20261228000424_tst_a11y.up.sql |
| ix_tst_a11y_results_issue | tst_a11y_results | no | 20261228000424_tst_a11y.up.sql |
| ix_tst_a11y_results_retest | tst_a11y_results | no | 20261228000424_tst_a11y.up.sql |
| ux_ops_environments_code | ops_environments | yes | 20261228000425_ops_devops.up.sql |
| ix_ops_environments_status | ops_environments | no | 20261228000425_ops_devops.up.sql |
| ux_ops_deployments_no | ops_deployments | yes | 20261228000425_ops_devops.up.sql |
| ix_ops_deployments_env | ops_deployments | no | 20261228000425_ops_devops.up.sql |
| ix_ops_deployments_status | ops_deployments | no | 20261228000425_ops_devops.up.sql |
| ux_ops_runbooks_version | ops_runbooks | yes | 20261228000425_ops_devops.up.sql |
| ix_ops_runbooks_status | ops_runbooks | no | 20261228000425_ops_devops.up.sql |
| ix_ops_runbooks_request | ops_runbooks | no | 20261228000425_ops_devops.up.sql |
| ix_ops_oncall_window | ops_oncall | no | 20261228000425_ops_devops.up.sql |
| ix_ops_oncall_status | ops_oncall | no | 20261228000425_ops_devops.up.sql |
| ux_ops_pages_alert | ops_pages | yes | 20261228000425_ops_devops.up.sql |
| ix_ops_pages_status | ops_pages | no | 20261228000425_ops_devops.up.sql |
| ix_ops_pages_escalated | ops_pages | no | 20261228000425_ops_devops.up.sql |
| ux_man_captures_no | man_captures | yes | 20261228000426_man_manuals.up.sql |
| ix_man_captures_status | man_captures | no | 20261228000426_man_manuals.up.sql |
| ix_man_captures_baseline | man_captures | no | 20261228000426_man_manuals.up.sql |
| ux_man_screens_route | man_screens | yes | 20261228000426_man_manuals.up.sql |
| ix_man_screens_company | man_screens | no | 20261228000426_man_manuals.up.sql |
| ix_man_screens_drift | man_screens | no | 20261228000426_man_manuals.up.sql |
| ix_man_screens_file | man_screens | no | 20261228000426_man_manuals.up.sql |
| ux_man_packages_no | man_packages | yes | 20261228000426_man_manuals.up.sql |
| ix_man_packages_status | man_packages | no | 20261228000426_man_manuals.up.sql |
| ix_man_packages_capture | man_packages | no | 20261228000426_man_manuals.up.sql |
| ux_man_manuals_code | man_manuals | yes | 20261228000426_man_manuals.up.sql |
| ix_man_manuals_package | man_manuals | no | 20261228000426_man_manuals.up.sql |
| ix_man_manuals_list | man_manuals | no | 20261228000426_man_manuals.up.sql |
| ix_man_manuals_owner | man_manuals | no | 20261228000426_man_manuals.up.sql |
| ix_man_manuals_request | man_manuals | no | 20261228000426_man_manuals.up.sql |
| ux_golive_checklist_criterion | golive_checklist | yes | 20261228000427_golive.up.sql |
| ix_golive_checklist_status | golive_checklist | no | 20261228000427_golive.up.sql |
| ux_uat_scripts_code | uat_scripts | yes | 20261228000427_golive.up.sql |
| ix_uat_scripts_module | uat_scripts | no | 20261228000427_golive.up.sql |
| ux_uat_defects_no | uat_defects | yes | 20261228000427_golive.up.sql |
| ix_uat_defects_open | uat_defects | no | 20261228000427_golive.up.sql |
| ix_uat_defects_module | uat_defects | no | 20261228000427_golive.up.sql |
| ix_uat_defects_script | uat_defects | no | 20261228000427_golive.up.sql |
| ix_uat_signoffs_module | uat_signoffs | no | 20261228000427_golive.up.sql |
| ix_uat_signoffs_request | uat_signoffs | no | 20261228000427_golive.up.sql |
| ux_golive_cutover_runs_no | golive_cutover_runs | yes | 20261228000427_golive.up.sql |
| ix_golive_cutover_runs_status | golive_cutover_runs | no | 20261228000427_golive.up.sql |
| ix_golive_cutover_runs_decision | golive_cutover_runs | no | 20261228000427_golive.up.sql |
| ux_golive_cutover_steps_seq | golive_cutover_steps | yes | 20261228000427_golive.up.sql |
| ix_golive_cutover_steps_company | golive_cutover_steps | no | 20261228000427_golive.up.sql |
| ux_golive_decisions_no | golive_decisions | yes | 20261228000427_golive.up.sql |
| ix_golive_decisions_status | golive_decisions | no | 20261228000427_golive.up.sql |
| ix_golive_decisions_request | golive_decisions | no | 20261228000427_golive.up.sql |
| ix_golive_hypercare_status | golive_hypercare | no | 20261228000427_golive.up.sql |
| ix_golive_hypercare_decision | golive_hypercare | no | 20261228000427_golive.up.sql |
| ux_golive_hypercare_days_date | golive_hypercare_days | yes | 20261228000427_golive.up.sql |
| ix_golive_hypercare_days_company | golive_hypercare_days | no | 20261228000427_golive.up.sql |
| ux_core_flag_changes_doc | core_flag_changes | yes | 20261228000429_core_flag_changes.up.sql |
| ix_core_flag_changes_company_id | core_flag_changes | no | 20261228000429_core_flag_changes.up.sql |
| ix_core_flag_changes_status | core_flag_changes | no | 20261228000429_core_flag_changes.up.sql |
| ix_core_flag_changes_key | core_flag_changes | no | 20261228000429_core_flag_changes.up.sql |
| ix_core_flag_changes_scope_company_id | core_flag_changes | no | 20261228000429_core_flag_changes.up.sql |
| ix_core_flag_changes_scope_project_id | core_flag_changes | no | 20261228000429_core_flag_changes.up.sql |
| ux_tnc_systems_code | tnc_systems | yes | 20261228000430_tnc_commissioning.up.sql |
| ix_tnc_systems_company_id | tnc_systems | no | 20261228000430_tnc_commissioning.up.sql |
| ix_tnc_systems_project | tnc_systems | no | 20261228000430_tnc_commissioning.up.sql |
| ix_tnc_systems_site | tnc_systems | no | 20261228000430_tnc_commissioning.up.sql |
| ix_tnc_systems_parent | tnc_systems | no | 20261228000430_tnc_commissioning.up.sql |
| ix_tnc_systems_status | tnc_systems | no | 20261228000430_tnc_commissioning.up.sql |
| ux_tnc_tags_no | tnc_tags | yes | 20261228000430_tnc_commissioning.up.sql |
| ix_tnc_tags_company_id | tnc_tags | no | 20261228000430_tnc_commissioning.up.sql |
| ix_tnc_tags_system | tnc_tags | no | 20261228000430_tnc_commissioning.up.sql |
| ix_tnc_tags_status | tnc_tags | no | 20261228000430_tnc_commissioning.up.sql |
| ix_tnc_checksheets_company_id | tnc_checksheets | no | 20261228000430_tnc_commissioning.up.sql |
| ix_tnc_checksheets_tag | tnc_checksheets | no | 20261228000430_tnc_commissioning.up.sql |
| ix_tnc_checksheets_inspection | tnc_checksheets | no | 20261228000430_tnc_commissioning.up.sql |
| ix_tnc_checksheets_status | tnc_checksheets | no | 20261228000430_tnc_commissioning.up.sql |
| ux_tnc_test_packs_doc | tnc_test_packs | yes | 20261228000430_tnc_commissioning.up.sql |
| ix_tnc_test_packs_company_id | tnc_test_packs | no | 20261228000430_tnc_commissioning.up.sql |
| ix_tnc_test_packs_system | tnc_test_packs | no | 20261228000430_tnc_commissioning.up.sql |
| ix_tnc_test_packs_status | tnc_test_packs | no | 20261228000430_tnc_commissioning.up.sql |
| ix_tnc_test_packs_evidence_file_id | tnc_test_packs | no | 20261228000430_tnc_commissioning.up.sql |
| ux_tnc_punch_links | tnc_punch_links | yes | 20261228000430_tnc_commissioning.up.sql |
| ix_tnc_punch_links_company_id | tnc_punch_links | no | 20261228000430_tnc_commissioning.up.sql |
| ix_tnc_punch_links_snag | tnc_punch_links | no | 20261228000430_tnc_commissioning.up.sql |
| ux_tnc_certificates_doc | tnc_certificates | yes | 20261228000430_tnc_commissioning.up.sql |
| ux_tnc_certificates_open | tnc_certificates | yes | 20261228000430_tnc_commissioning.up.sql |
| ix_tnc_certificates_company_id | tnc_certificates | no | 20261228000430_tnc_commissioning.up.sql |
| ix_tnc_certificates_system | tnc_certificates | no | 20261228000430_tnc_commissioning.up.sql |
| ix_tnc_certificates_status | tnc_certificates | no | 20261228000430_tnc_commissioning.up.sql |
| ix_tnc_certificates_client_file_id | tnc_certificates | no | 20261228000430_tnc_commissioning.up.sql |
| ux_ho_handovers_doc | ho_handovers | yes | 20261228000431_ho_handover.up.sql |
| ix_ho_handovers_company_id | ho_handovers | no | 20261228000431_ho_handover.up.sql |
| ix_ho_handovers_project | ho_handovers | no | 20261228000431_ho_handover.up.sql |
| ix_ho_handovers_site | ho_handovers | no | 20261228000431_ho_handover.up.sql |
| ix_ho_handovers_location | ho_handovers | no | 20261228000431_ho_handover.up.sql |
| ix_ho_handovers_status | ho_handovers | no | 20261228000431_ho_handover.up.sql |
| ix_ho_handovers_client_file_id | ho_handovers | no | 20261228000431_ho_handover.up.sql |
| ix_ho_checklist_items_company_id | ho_checklist_items | no | 20261228000431_ho_handover.up.sql |
| ix_ho_checklist_items_handover | ho_checklist_items | no | 20261228000431_ho_handover.up.sql |
| ix_ho_checklist_items_status | ho_checklist_items | no | 20261228000431_ho_handover.up.sql |
| ix_ho_checklist_items_file_id | ho_checklist_items | no | 20261228000431_ho_handover.up.sql |
| ix_ho_checklist_items_certificate | ho_checklist_items | no | 20261228000431_ho_handover.up.sql |
| ix_ho_checklist_items_revision | ho_checklist_items | no | 20261228000431_ho_handover.up.sql |
| ux_ho_client_assets_tag | ho_client_assets | yes | 20261228000431_ho_handover.up.sql |
| ix_ho_client_assets_company_id | ho_client_assets | no | 20261228000431_ho_handover.up.sql |
| ix_ho_client_assets_handover | ho_client_assets | no | 20261228000431_ho_handover.up.sql |
| ix_ho_client_assets_project | ho_client_assets | no | 20261228000431_ho_handover.up.sql |
| ix_ho_client_assets_system | ho_client_assets | no | 20261228000431_ho_handover.up.sql |
| ix_ho_client_assets_status | ho_client_assets | no | 20261228000431_ho_handover.up.sql |
| ux_dlp_periods_doc | dlp_periods | yes | 20261228000432_dlp.up.sql |
| ux_dlp_periods_handover | dlp_periods | yes | 20261228000432_dlp.up.sql |
| ix_dlp_periods_company_id | dlp_periods | no | 20261228000432_dlp.up.sql |
| ix_dlp_periods_project | dlp_periods | no | 20261228000432_dlp.up.sql |
| ix_dlp_periods_site | dlp_periods | no | 20261228000432_dlp.up.sql |
| ix_dlp_periods_handover | dlp_periods | no | 20261228000432_dlp.up.sql |
| ix_dlp_periods_status | dlp_periods | no | 20261228000432_dlp.up.sql |
| ux_dlp_complaints_doc | dlp_complaints | yes | 20261228000432_dlp.up.sql |
| ix_dlp_complaints_company_id | dlp_complaints | no | 20261228000432_dlp.up.sql |
| ix_dlp_complaints_period | dlp_complaints | no | 20261228000432_dlp.up.sql |
| ix_dlp_complaints_status | dlp_complaints | no | 20261228000432_dlp.up.sql |
| ix_dlp_complaints_asset | dlp_complaints | no | 20261228000432_dlp.up.sql |
| ix_dlp_complaints_partner | dlp_complaints | no | 20261228000432_dlp.up.sql |
| ix_dlp_complaints_file | dlp_complaints | no | 20261228000432_dlp.up.sql |
| ux_dlp_warranty_claims_doc | dlp_warranty_claims | yes | 20261228000432_dlp.up.sql |
| ix_dlp_warranty_claims_company_id | dlp_warranty_claims | no | 20261228000432_dlp.up.sql |
| ix_dlp_warranty_claims_period | dlp_warranty_claims | no | 20261228000432_dlp.up.sql |
| ix_dlp_warranty_claims_asset | dlp_warranty_claims | no | 20261228000432_dlp.up.sql |
| ix_dlp_warranty_claims_complaint | dlp_warranty_claims | no | 20261228000432_dlp.up.sql |
| ix_dlp_warranty_claims_partner | dlp_warranty_claims | no | 20261228000432_dlp.up.sql |
| ix_dlp_warranty_claims_status | dlp_warranty_claims | no | 20261228000432_dlp.up.sql |
| ux_cls_closures_doc | cls_closures | yes | 20261228000433_cls_closeout.up.sql |
| ux_cls_closures_live | cls_closures | yes | 20261228000433_cls_closeout.up.sql |
| ix_cls_closures_company_id | cls_closures | no | 20261228000433_cls_closeout.up.sql |
| ix_cls_closures_project | cls_closures | no | 20261228000433_cls_closeout.up.sql |
| ix_cls_closures_status | cls_closures | no | 20261228000433_cls_closeout.up.sql |
| ix_cls_closures_file | cls_closures | no | 20261228000433_cls_closeout.up.sql |
| ix_cls_closures_snapshot | cls_closures | no | 20261228000433_cls_closeout.up.sql |
| ux_cls_checklist_code | cls_checklist_items | yes | 20261228000433_cls_closeout.up.sql |
| ix_cls_checklist_items_company_id | cls_checklist_items | no | 20261228000433_cls_closeout.up.sql |
| ix_cls_checklist_items_closure | cls_checklist_items | no | 20261228000433_cls_closeout.up.sql |
| ix_cls_checklist_items_status | cls_checklist_items | no | 20261228000433_cls_closeout.up.sql |
| ix_cls_checklist_items_file | cls_checklist_items | no | 20261228000433_cls_closeout.up.sql |
| ux_kb_lessons_doc | kb_lessons | yes | 20261228000433_cls_closeout.up.sql |
| ix_kb_lessons_company_id | kb_lessons | no | 20261228000433_cls_closeout.up.sql |
| ix_kb_lessons_project | kb_lessons | no | 20261228000433_cls_closeout.up.sql |
| ix_kb_lessons_status | kb_lessons | no | 20261228000433_cls_closeout.up.sql |
| ix_kb_lessons_author | kb_lessons | no | 20261228000433_cls_closeout.up.sql |
| ux_kb_benchmarks_metric | kb_benchmarks | yes | 20261228000433_cls_closeout.up.sql |
| ix_kb_benchmarks_company_id | kb_benchmarks | no | 20261228000433_cls_closeout.up.sql |
| ix_kb_benchmarks_project | kb_benchmarks | no | 20261228000433_cls_closeout.up.sql |
| ix_kb_benchmarks_closure | kb_benchmarks | no | 20261228000433_cls_closeout.up.sql |
| ix_kb_benchmarks_status | kb_benchmarks | no | 20261228000433_cls_closeout.up.sql |
| ux_ho_client_assets_tag | ho_client_assets | yes | 20261228000434_close_review_fixes.up.sql |
| ux_cls_closures_live | cls_closures | yes | 20261228000434_close_review_fixes.up.sql |
| ix_iam_captcha_uses_expires | iam_captcha_uses | no | 20261228000435_iam_captcha_uses.up.sql |

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
  core_slo_definitions
  core_alert_rules
  core_alerts
  core_metric_samples
  core_client_events
  core_connectors
  core_connector_secrets
  core_integration_logs
  core_webhook_receipts
  iam_users
  iam_credentials
  iam_mfa_factors
  iam_devices
  iam_auth_policy
  iam_sessions
  iam_refresh_tokens
  iam_login_events
  iam_login_throttle
  iam_password_resets
  org_companies
  org_branches
  org_departments
  org_designations
  org_projects
  org_sites
  org_locations
  org_cost_centres
  org_assignments
  iam_user_profiles
  iam_invitations
  iam_role_grants
  iam_permissions
  iam_roles
  iam_role_permissions
  iam_field_masks
  iam_assignments
  iam_role_mapping
  iam_sod_rules
  iam_sod_violations
  iam_sod_actions
  iam_elevations
  iam_elevation_log
  iam_access_campaigns
  iam_access_reviews
  iam_access_review_items
  core_audit_chain
  core_security_events
  core_audit_verifications
  core_audit_segments
  core_route_registry
  core_security_settings
  ui_user_preferences
  ui_drafts
  ui_form_metadata
  ui_sample_requests
  ui_sample_request_lines
  ui_saved_views
  ui_export_jobs
  ui_record_comments
  ui_record_versions
  ui_reason_codes
  ui_required_documents
  ui_record_documents
  ui_navigation_entries
  ui_favourites
  ui_recent_records
  ui_user_context
  ui_push_subscriptions
  ui_field_tiles
  ui_widgets
  ui_dashboards
  core_search_index
  core_search_queries
  ui_translations
  ui_locale_preferences
  ui_page_migration
  wf_definitions
  wf_instances
  wf_tasks
  wf_task_attachments
  wf_history
  wf_watchers
  eng_sample_docs
  wf_matrix
  wf_matrix_rules
  wf_authority_limits
  wf_delegations
  wf_escalation_paths
  wf_sla_settings
  wf_approval_policies
  wf_link_tokens
  pcs_control_points
  pcs_check_results
  pcs_exceptions
  pcs_reason_codes
  pcs_control_changes
  pcs_cycle_stages
  acc_raci_templates
  acc_raci_assignments
  acc_action_ledger
  acc_ledger_cursors
  ntf_templates
  ntf_notifications
  ntf_preferences
  ntf_deliveries
  ntf_realtime_events
  comm_messages
  comm_consents
  comm_otps
  comm_channels
  comm_dlt_templates
  comm_wa_templates
  tsk_tasks
  tsk_assignees
  tsk_checklist_items
  tsk_dependencies
  tsk_comments
  tsk_escalations
  tsk_routing_matrix
  alr_rules
  alr_alerts
  alr_rule_runs
  doc_types
  doc_folder_templates
  doc_folders
  doc_documents
  doc_versions
  doc_shares
  doc_distributions
  doc_annotations
  doc_links
  tpl_templates
  tpl_records
  tpl_generated_docs
  tpl_deliveries
  tpl_bulk_jobs
  tpl_auto_rules
  sig_signatures
  sig_copies
  sig_verifications
  sig_profiles
  sig_config
  xl_templates
  xl_jobs
  xl_job_errors
  col_comments
  col_mentions
  col_reactions
  col_trace_links
  off_devices
  off_sync_log
  off_uploads
  msg_conversations
  msg_members
  msg_messages
  msg_reactions
  msg_receipts
  msg_stars
  msg_pins
  msg_hidden
  msg_voice
  msg_user_settings
  msg_presence
  msg_holds
  msg_member_periods
  msg_calls
  msg_config
  sec_devices
  sec_prekeys
  sec_conversations
  sec_envelopes
  sec_policy
  sec_licence_reviews
  oss_register
  msg_auto_group_rules
  msg_auto_group_links
  msg_instructions
  msg_acknowledgements
  msg_announcements
  msg_announcement_reads
  msg_escalations
  msg_actions
  pol_policies
  pol_versions
  pol_acknowledgements
  pol_requirements
  mdm_records
  mdm_change_requests
  mdm_record_versions
  mdm_duplicates
  mdm_merge_map
  mdm_quality_rules
  mdm_stewards
  mdm_uoms
  mdm_gst_rates
  mdm_hsn_sac
  mdm_tds_sections
  mdm_states
  mdm_districts
  mdm_currencies
  mdm_exchange_rates
  mdm_banks
  mdm_payment_terms
  mdm_lookup_lists
  mdm_lookups
  mdm_item_categories
  mdm_items
  mdm_item_uoms
  mdm_item_resources
  mdm_item_makes
  mdm_item_alternates
  mdm_item_code_counters
  mdm_item_user_marks
  mdm_item_legacy_map
  mdm_partners
  mdm_partner_roles
  mdm_partner_gstins
  mdm_partner_addresses
  mdm_partner_contacts
  mdm_partner_banks
  mdm_partner_documents
  mdm_partner_tds
  mdm_partner_status_requests
  fin_account_groups
  fin_accounts
  fin_cost_heads
  fin_cost_codes
  fin_dimension_rules
  fin_category_mappings
  fin_master_changes
  ra_resource_rates
  ra_sor_books
  ra_sor_items
  ra_analyses
  ra_analysis_lines
  hr_employees
  hr_employee_statutory
  hr_employee_banks
  hr_employee_contacts
  hr_employee_education
  hr_employee_experience
  hr_employee_documents
  hr_employee_changes
  hr_employee_history
  hr_headcount_plans
  hr_requisitions
  hr_candidates
  hr_interviews
  hr_offers
  hr_onboarding_tasks
  hr_site_plans
  hr_crews
  hr_crew_members
  hr_deployments
  hr_transfers
  att_shifts
  att_policies
  att_policy_assignments
  att_rosters
  att_roster_changes
  att_period_defs
  att_periods
  att_punches
  att_anomalies
  att_visits
  att_device_bindings
  att_site_settings
  att_daily
  att_regularisations
  att_overtime_requests
  att_manual_entries
  att_period_locks
  att_arrears
  lv_types
  lv_entitlements
  lv_ledger
  lv_applications
  lv_adjustments
  lv_year_runs
  lab_workers
  lab_contractor_compliance
  lab_wage_rates
  ess_requests
  trn_courses
  trn_sessions
  trn_attendance
  trn_cert_types
  trn_certifications
  trn_skill_defs
  trn_skills
  perf_cycles
  perf_kpis
  perf_kpi_values
  perf_kpi_disputes
  perf_goals
  perf_feedback
  perf_reviews
  exp_policies
  exp_travel_requests
  exp_advances
  exp_claims
  exp_claim_lines
  exp_advance_recoveries
  hr_separations
  hr_clearances
  hr_exit_interviews
  hr_grievances
  hr_disciplinary_cases
  bd_leads
  bd_opportunities
  bd_interactions
  bd_contacts
  bd_stage_log
  bd_amendments
  tdr_tenders
  tdr_eligibility
  tdr_bid_decisions
  tdr_addenda
  tdr_queries
  tdr_team_tasks
  tdr_date_log
  tdr_amendments
  tdr_credentials
  tdr_tender_credentials
  tdr_emd
  tdr_submissions
  tdr_competitors
  tdr_bid_results
  tdr_negotiations
  tdr_awards
  est_estimates
  est_estimate_items
  est_item_components
  est_indirects
  est_risks
  mto_takeoffs
  mto_takeoff_lines
  mto_bbs
  mto_bbs_lines
  mto_material_requirements
  est_reviews
  est_bid_summary
  est_assumptions
  proj_projects
  proj_milestones
  proj_lifecycle_log
  proj_baseline_packs
  proj_handover_meetings
  proj_boq_items
  proj_wbs
  proj_wbs_versions
  proj_work_packages
  proj_locations
  proj_wbs_locations
  proj_boq_versions
  proj_boq_lines
  proj_boq_line_wbs
  proj_boq_line_norms
  proj_boq_changes
  proj_boq_import_rows
  proj_team
  proj_stakeholders
  proj_comm_matrix
  proj_meetings
  proj_meeting_actions
  proj_risk_settings
  proj_risks
  proj_risk_actions
  proj_risk_triggers
  proj_risk_contingency
  proj_risk_issues
  proj_risk_snapshots
  gis_layers
  gis_overlays
  gis_progress
  proj_360_widgets
  engg_drawings
  engg_drawing_revisions
  engg_drawing_links
  engg_transmittals
  engg_transmittal_items
  engg_copies
  engg_rfis
  engg_rfi_routing
  engg_rfi_delay_drafts
  engg_submittals
  engg_submittal_revisions
  engg_approved_makes
  engg_deliverables
  engg_crs
  engg_vdr_items
  engg_holds
  engg_letters
  engg_letter_links
  engg_time_bars
  bud_budgets
  bud_lines
  bud_phasing
  bud_changes
  bud_change_lines
  bud_check_config
  bud_commitments
  bud_commitment_log
  bud_actuals
  bud_dept_budgets
  bud_dept_lines
  bud_dept_actuals
  bud_alloc_rules
  bud_alloc_runs
  bud_alloc_lines
  plan_calendars
  plan_schedules
  plan_activities
  plan_dependencies
  plan_activity_boq
  plan_templates
  plan_activity_resources
  plan_resource_capacity
  plan_gantt_edits
  plan_baselines
  plan_imports
  plan_lookaheads
  plan_constraints
  plan_weekly_plans
  plan_weekly_items
  plan_delays
  plan_tia
  plan_delay_evidence
  site_work_fronts
  site_daily_plans
  site_daily_plan_lines
  site_work_authorisations
  site_wa_resources
  site_wa_uses
  site_dprs
  site_dpr_work
  site_dpr_labour
  site_dpr_materials
  site_dpr_equipment
  site_dpr_photos
  site_dpr_notes
  site_weather
  site_hindrances
  site_diary
  site_visitors
  site_instructions
  site_instruction_acks
  prs_periods
  prs_activity_progress
  prs_evm
  prs_weights
  prod_norms
  prod_actuals
  prod_losses
  prod_alerts
  ctl_facts
  ctl_unallocated
  ctl_recon_runs
  proc_material_requests
  proc_mr_lines
  proc_requisitions
  proc_pr_lines
  proc_pr_sources
  proc_stock_levels
  proc_mrp_runs
  proc_mrp_lines
  proc_mrp_proposals
  proc_item_params
  proc_open_supply
  proc_rfqs
  proc_rfq_lines
  proc_rfq_vendors
  proc_quotations
  proc_quotation_lines
  proc_rfq_clarifications
  proc_comparative_statements
  proc_cs_lines
  proc_cs_negotiations
  proc_purchase_orders
  proc_po_lines
  proc_po_schedules
  proc_po_amendments
  proc_dispatches
  proc_po_receipts
  proc_po_advances
  proc_price_indices
  proc_rate_contracts
  proc_rc_lines
  proc_rc_revisions
  proc_service_orders
  proc_so_lines
  proc_service_entries
  proc_se_lines
  proc_po_rc
  proc_po_line_rc
  xpd_expediting_plans
  xpd_milestones
  xpd_inspections
  xpd_shipments
  xpd_shipment_events
  vnd_prequalifications
  vnd_avl
  vnd_scorecards
  vnd_score_inputs
  vnd_suspensions
  vnd_actions
  rti_observations
  rti_indices
  inv_stores
  inv_store_changes
  inv_bins
  inv_stock_ledger
  inv_balances
  inv_valuation
  inv_fifo_layers
  inv_reservations
  inv_adjustments
  inv_gate_appointments
  inv_gate_inward
  inv_gate_weighments
  inv_gate_passes
  inv_grns
  inv_grn_lines
  inv_rtvs
  inv_issues
  inv_issue_lines
  inv_site_returns
  inv_sub_certified
  inv_free_issue_ledger
  inv_transfers
  inv_transfer_lines
  inv_transfer_discrepancies
  inv_count_plans
  inv_count_lines
  inv_scrap_entries
  inv_scrap_disposals
  inv_reorder_params
  inv_reorder_changes
  inv_reorder_suggestions
  inv_labels
  rta_assets
  rta_positions
  rta_movements
  rta_hire_periods
  rta_damage_recoveries
  ast_small_assets
  ast_custody_log
  ast_loss_reports
  mrc_key_materials
  mrc_reconciliations
  mrc_lines
  mrc_contributions
  plt_equipment
  plt_documents
  plt_timeline
  plt_requisitions
  plt_allocations
  plt_operator_assignments
  plt_logs
  plt_breakdowns
  plt_fuel_tanks
  plt_fuel_receipts
  plt_fuel_issues
  plt_fuel_dips
  plt_fuel_anomalies
  plt_pm_plans
  plt_pm_status
  plt_job_cards
  plt_job_spares
  plt_hire_agreements
  plt_hire_bills
  plt_cost_items
  plt_cost_snapshots
  plt_telematics
  plt_disposal_recs
  rp_demand
  rp_supply
  rp_plans
  rp_requests
  qa_quality_plans
  qa_itps
  qa_checklist_templates
  qa_inspections
  qa_inspection_answers
  qa_planned_points
  qa_inspection_requests
  qa_test_catalogue
  qa_lab_equipment
  qa_test_requests
  qa_test_results
  qa_ncrs
  qa_capa_actions
  qa_pour_cards
  qa_pour_tickets
  qa_cube_samples
  qa_cube_results
  qa_snags
  hse_plans
  hse_hira
  hse_jsa
  hse_induction_content
  hse_inductions
  hse_toolbox_topics
  hse_toolbox_talks
  hse_medical_records
  hse_permit_types
  hse_permits
  hse_incidents
  hse_incident_actions
  hse_inspection_schedules
  hse_observations
  hse_ppe_items
  hse_ppe_issues
  hse_equipment_register
  hse_contractor_scores
  esg_readings
  esg_waste
  esg_emission_factors
  esg_permits
  scy_posts
  scy_checkpoints
  scy_patrol_scans
  scy_rosters
  scy_visitors
  scy_incidents
  scy_handovers
  camp_camps
  camp_rooms
  camp_allocations
  camp_meals
  camp_inspections
  camp_assets
  camp_recoveries
  bp_plants
  bp_silos
  bp_scales
  bp_mix_designs
  bp_requisitions
  bp_batches
  bp_delivery_tickets
  bp_silo_moves
  bp_cost_periods
  bp_cost_lines
  bp_cost_grades
  bp_transfer_rates
  bp_charges
  bp_budgets
  ctr_contracts
  ctr_clauses
  ctr_obligations
  ctr_milestones
  ctr_amendments
  ctr_value_log
  ctr_bank_guarantees
  ctr_bg_events
  ctr_advances
  ctr_insurances
  ctr_insurance_claims
  ctr_bank_limits
  ctr_work_orders
  ctr_wo_items
  ctr_wo_free_issue
  ctr_wo_amendments
  ctr_sub_compliance
  ctr_sub_waivers
  ctr_sub_manpower
  ctr_sub_holds
  ctr_sub_ratings
  ctr_change_requests
  ctr_variation_orders
  ctr_vo_items
  ctr_claims
  ctr_claim_events
  ctr_claim_quantum
  ctr_claim_evidence
  ctr_claim_log
  ctr_eot_awards
  ctr_disputes
  ctr_dispute_log
  ctr_pvc_formulas
  ctr_pvc_index_refs
  ctr_escalation_calcs
  ctr_ld_assessments
  bill_mb_entries
  bill_deviation_statements
  bill_qty_forecasts
  bill_extra_items
  bill_client_bills
  bill_client_bill_items
  bill_certifications
  bill_tax_invoices
  bill_invoice_counters
  bill_sub_measurements
  bill_sub_bills
  bill_sub_bill_items
  bill_sub_claims
  bill_vendor_invoices
  bill_vendor_invoice_lines
  bill_retention_ledger
  bill_advances
  bill_advance_recoveries
  bill_releases
  bill_cvr_reports
  ui_navigation_labels
  ui_field_tile_rules
  ui_bottom_bar
  hr_gates
  hr_gate_criteria
  mdm_tds_forms
  mdm_statutory_calendar
  mdm_labour_rules
  mdm_pay_components
  hr_employee_pay
  fin_journals
  fin_journal_lines
  fin_balances
  fin_recurring_journals
  fin_posting_rules
  fin_replay_runs
  fin_posting_log
  ap_bills
  ap_debit_notes
  ap_bill_adjustments
  fin_bank_accounts
  pmt_proposals
  pmt_proposal_lines
  pmt_payments
  ar_invoices
  ar_receipts
  ar_allocations
  ar_credit_notes
  ar_writeoffs
  ar_followups
  fin_bank_account_profiles
  fin_bank_statement_imports
  fin_bank_statements
  fin_bank_recons
  fin_imprests
  fin_imprest_replenishments
  fin_imprest_vouchers
  fin_cash_counts
  fin_contras
  gst_settings
  gst_gstin_checks
  gst_einvoices
  gst_ewaybills
  gst_compliance_log
  gst_2b_imports
  gst_2b_lines
  gst_recon_followups
  gst_itc_reviews
  gst_itc_review_lines
  gst_return_filings
  tds_returns
  tds_26as_lines
  fa_classes
  fa_cwip
  fa_cwip_lines
  fa_assets
  fa_dep_runs
  fa_depreciation
  fa_transfers
  fa_disposals
  fa_verifications
  fa_verification_lines
  fa_tax_openings
  fa_asset_components
  tcs_collections
  pa_revenue_recognition
  pa_overhead_allocations
  fc_forecasts
  fc_forecast_lines
  pl_structure
  pl_snapshots
  cf_forecasts
  cf_lines
  cf_bank_limits
  cf_priority_partners
  close_periods
  close_tasks
  close_reopens
  ic_relationships
  ic_transactions
  ic_consolidations
  jv_shares
  pay_components
  pay_structures
  pay_assignments
  pay_arrears
  pay_statutory_params
  pay_calendar
  pay_runs
  pay_run_lines
  pay_inputs
  pay_tax_declarations
  pay_wage_runs
  pay_wage_lines
  pay_contractor_wage_checks
  stat_filings
  stat_registers
  stat_rules
  stat_bocw_months
  pay_fnf
  pay_payslips
  pay_transfers
  pay_transfer_lines
  pay_fnf_rules
  ptl_accounts
  ptl_sessions
  ptl_messages
  ptl_shares
  ptl_registrations
  ptl_asn_invoices
  ptl_vdr_orders
  ptl_rfq_files
  rpt_subscriptions
  rpt_runs
  bi_metrics
  bi_refresh_log
  bi_project_snapshots
  bi_domain_refreshes
  bi_domain_observations
  exec_alerts
  exec_alert_settings
  mr_configs
  mr_reports
  dei_daily
  mc_monthly_closes
  det_rules
  det_findings
  scn_scenarios
  ai_providers
  ai_features
  ai_logs
  ai_controls
  ai_drafts
  ai_feedback
  aif_models
  aif_forecasts
  aif_anomalies
  di_extractions
  cv_results
  adm_controls
  adm_emergency_actions
  adm_config_snapshots
  int_mappings
  int_sync_runs
  api_clients
  api_tokens
  api_webhooks
  api_webhook_deliveries
  api_usage
  xl_packs
  xl_bulk_batches
  mig_objects
  mig_runs
  mig_cutovers
  ops_backups
  ops_restore_tests
  ops_backup_alerts
  ops_restore_requests
  arc_policies
  arc_jobs
  arc_disposals
  arc_records
  arc_holds
  arc_erasures
  hd_tickets
  hd_ticket_notes
  hd_corrections
  hd_articles
  hd_tour_views
  tst_integration_runs
  tst_latency_probes
  tst_recon_runs
  tst_recon_results
  tst_page_audit_runs
  tst_page_audit
  tst_test_runs
  tst_test_catalogue
  tst_sandbox_runs
  sct_scan_runs
  sct_findings
  sct_reviews
  tst_perf_runs
  tst_perf_results
  tst_devices
  tst_a11y_runs
  tst_a11y_results
  ops_environments
  ops_deployments
  ops_runbooks
  ops_oncall
  ops_pages
  man_captures
  man_screens
  man_packages
  man_manuals
  golive_checklist
  uat_scripts
  uat_defects
  uat_signoffs
  golive_cutover_runs
  golive_cutover_steps
  golive_decisions
  golive_hypercare
  golive_hypercare_days
  core_flag_changes
  tnc_systems
  tnc_tags
  tnc_checksheets
  tnc_test_packs
  tnc_punch_links
  tnc_certificates
  ho_handovers
  ho_checklist_items
  ho_client_assets
  dlp_periods
  dlp_complaints
  dlp_warranty_claims
  cls_closures
  cls_checklist_items
  kb_lessons
  kb_benchmarks
  iam_captcha_uses
```

No foreign keys exist yet; tables are independent until the organisation tables (02.02) are built.
