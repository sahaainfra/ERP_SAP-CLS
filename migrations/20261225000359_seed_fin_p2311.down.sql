DELETE FROM ntf_templates WHERE code IN ('fin.forecast.decided', 'fin.forecast.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '23.11';
DELETE FROM ui_navigation_entries WHERE code IN ('fin-forecast', 'fin-forecast-reports');
DELETE FROM core_feature_flags WHERE key = 'ff.fin.p2311';
