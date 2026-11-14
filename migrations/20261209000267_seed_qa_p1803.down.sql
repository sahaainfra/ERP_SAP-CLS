DELETE FROM ntf_templates WHERE code IN ('qa.test.decided','qa.calibration.due') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '18.03';
DELETE FROM ui_navigation_entries WHERE code IN ('qa-receiving','qa-test-requests','qa-test-compliance','qa-lab-equipment','qa-test-catalogue');
DELETE FROM core_feature_flags WHERE key = 'ff.qa.p1803';
