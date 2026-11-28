DELETE FROM core_feature_flags WHERE key = 'ff.ui.pack07' AND source_type = 'reference_seed';
DROP INDEX IF EXISTS ix_ui_context_recent_person_used;
DROP INDEX IF EXISTS ux_ui_context_recent_person_context;
DROP INDEX IF EXISTS ix_ui_context_recent_context_project_id;
DROP INDEX IF EXISTS ix_ui_context_recent_context_site_id;
DROP INDEX IF EXISTS ix_ui_context_recent_project;
DROP INDEX IF EXISTS ix_ui_context_recent_company_status;
DROP TABLE IF EXISTS ui_context_recent;
