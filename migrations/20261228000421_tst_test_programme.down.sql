DELETE FROM ui_page_migration WHERE page_code = 'admin.test-coverage' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'tst-test-coverage' AND source_type = 'reference_seed';
DROP TABLE IF EXISTS tst_sandbox_runs;
DROP TABLE IF EXISTS tst_test_catalogue;
DROP TABLE IF EXISTS tst_test_runs;
DELETE FROM core_feature_flags WHERE key = 'ff.qa.p3004' AND company_id IS NULL AND source_type = 'reference_seed';
