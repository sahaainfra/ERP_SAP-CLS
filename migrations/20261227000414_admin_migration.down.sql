DELETE FROM ui_page_migration WHERE page_code = 'admin.data_migration' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'admin-data-migration' AND source_type = 'reference_seed';
DROP TABLE IF EXISTS mig_cutovers;
DROP TABLE IF EXISTS mig_runs;
DROP TABLE IF EXISTS mig_objects;
DELETE FROM core_feature_flags WHERE key = 'ff.admin.p2905' AND company_id IS NULL AND source_type = 'reference_seed';
