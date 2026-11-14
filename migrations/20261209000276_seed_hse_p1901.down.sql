DELETE FROM ntf_templates WHERE code IN ('hse.plan.decided','hse.hira.decided','hse.induction.expiring') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '19.01';
DELETE FROM ui_navigation_entries WHERE code IN ('hse-plans','hse-hira','hse-jsa','hse-induction','hse-toolbox','hse-library','hse-compliance');
DELETE FROM core_feature_flags WHERE key = 'ff.hse.p1901';
