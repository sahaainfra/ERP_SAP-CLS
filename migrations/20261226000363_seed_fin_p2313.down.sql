DELETE FROM ntf_templates WHERE code IN ('fin.cf.decided', 'fin.cf.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '23.13';
DELETE FROM ui_navigation_entries WHERE code IN ('fin-treasury', 'fin-cash-reports');
DELETE FROM core_feature_flags WHERE key = 'ff.fin.p2313';
