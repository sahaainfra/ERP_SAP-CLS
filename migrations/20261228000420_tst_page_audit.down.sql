UPDATE ui_page_migration SET page_code = 'help.raise' WHERE page_code = 'help' AND source_type = 'reference_seed' AND migrated_in_part = '29.08';
UPDATE ui_page_migration SET page_code = 'admin.data_migration' WHERE page_code = 'admin.data-migration' AND source_type = 'reference_seed' AND migrated_in_part = '29.05';
DELETE FROM ui_page_migration WHERE page_code = 'admin.page-audit' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'tst-page-audit' AND source_type = 'reference_seed';
DROP TABLE IF EXISTS tst_page_audit;
DROP TABLE IF EXISTS tst_page_audit_runs;
DELETE FROM core_feature_flags WHERE key = 'ff.qa.p3003' AND company_id IS NULL AND source_type = 'reference_seed';
