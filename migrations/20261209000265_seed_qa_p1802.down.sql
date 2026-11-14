DELETE FROM ntf_templates WHERE code IN ('qa.ir.decided','qa.ir.raised') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '18.02';
DELETE FROM ui_navigation_entries WHERE code IN ('qa-irs','qa-ir-raise','qa-ir-analysis');
DELETE FROM core_feature_flags WHERE key = 'ff.qa.p1802';
