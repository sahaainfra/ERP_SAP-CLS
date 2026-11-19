DELETE FROM ntf_templates WHERE code IN ('pay.run.decided', 'pay.run.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '24.02';
DELETE FROM ui_navigation_entries WHERE code IN ('pay-runs', 'pay-register', 'pay-declarations');
DELETE FROM core_feature_flags WHERE key = 'ff.pay.p2402';
