DROP INDEX IF EXISTS ix_core_sample_documents_list;
DELETE FROM ui_page_migration WHERE page_code = 'admin.performance-tests' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'tst-performance' AND source_type = 'reference_seed';
DROP TABLE IF EXISTS tst_perf_results;
DROP TABLE IF EXISTS tst_perf_runs;
DELETE FROM core_feature_flags WHERE key = 'ff.qa.p3006' AND company_id IS NULL AND source_type = 'reference_seed';
