DELETE FROM ntf_templates WHERE code IN ('hse.kpi.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '19.08';
DELETE FROM ui_navigation_entries WHERE code IN ('hse-dashboard');
DELETE FROM core_feature_flags WHERE key = 'ff.hse.p1908';
DELETE FROM ui_widgets WHERE code IN ('hse.ltifr', 'hse.safe_manhours') AND source_type = 'reference_seed';
