DELETE FROM stat_rules WHERE source_type = 'reference_seed' AND created_by = 'migration';
DELETE FROM ntf_templates WHERE code IN ('stat.filing.decided', 'stat.filing.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '24.04';
DELETE FROM ui_navigation_entries WHERE code IN ('pay-compliance', 'pay-registers');
DELETE FROM core_feature_flags WHERE key = 'ff.pay.p2404';
