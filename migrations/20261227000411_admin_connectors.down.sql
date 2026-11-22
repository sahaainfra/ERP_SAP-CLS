DELETE FROM ui_page_migration WHERE page_code = 'admin.connectors' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'admin-connectors' AND source_type = 'reference_seed';
DROP TABLE IF EXISTS int_sync_runs;
DROP TABLE IF EXISTS int_mappings;
DELETE FROM core_feature_flags WHERE key = 'ff.admin.p2902' AND company_id IS NULL AND source_type = 'reference_seed';
