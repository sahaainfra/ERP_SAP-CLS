DELETE FROM ui_page_migration WHERE page_code = 'admin.accessibility-validation' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'tst-a11y-validation' AND source_type = 'reference_seed';
DROP TABLE IF EXISTS tst_a11y_results;
DROP TABLE IF EXISTS tst_a11y_runs;
DROP TABLE IF EXISTS tst_devices;
DELETE FROM core_feature_flags WHERE key = 'ff.qa.p3007' AND source_type = 'reference_seed';
