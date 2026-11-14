DELETE FROM ntf_templates WHERE code IN ('qa.ncr.decided','qa.ncr.assigned') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '18.04';
DELETE FROM ui_navigation_entries WHERE code IN ('qa-ncrs','qa-ncr-raise','qa-ncr-analysis');
DELETE FROM core_feature_flags WHERE key = 'ff.qa.p1804';
