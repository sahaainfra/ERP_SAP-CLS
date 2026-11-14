DELETE FROM ntf_templates WHERE code IN ('hse.incident.decided','hse.incident.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '19.03';
DELETE FROM ui_navigation_entries WHERE code IN ('hse-incident-report','hse-incidents','hse-lessons');
DELETE FROM core_feature_flags WHERE key = 'ff.hse.p1903';
