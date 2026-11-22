DELETE FROM ui_page_migration WHERE page_code = 'admin.control' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'admin-control' AND source_type = 'reference_seed';
DROP TABLE IF EXISTS adm_config_snapshots;
DROP TABLE IF EXISTS adm_emergency_actions;
DROP TABLE IF EXISTS adm_controls;
DELETE FROM core_feature_flags WHERE key = 'ff.admin.p2901' AND company_id IS NULL AND source_type = 'reference_seed';
