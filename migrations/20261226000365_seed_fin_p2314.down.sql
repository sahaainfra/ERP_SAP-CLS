DELETE FROM ntf_templates WHERE code IN ('fin.close.decided', 'fin.close.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '23.14';
DELETE FROM ui_navigation_entries WHERE code IN ('fin-close', 'fin-statements', 'fin-dashboard', 'fin-year-end');
DELETE FROM core_feature_flags WHERE key = 'ff.fin.p2314';
