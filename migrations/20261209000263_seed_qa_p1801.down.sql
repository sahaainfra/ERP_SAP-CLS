DELETE FROM ntf_templates WHERE code IN ('qa.plan.decided','qa.inspection.decided','qa.inspection.failed') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '18.01';
DELETE FROM ui_navigation_entries WHERE code IN ('qa-itps','qa-templates','qa-perform','qa-inspections');
DELETE FROM core_feature_flags WHERE key = 'ff.qa.p1801';
