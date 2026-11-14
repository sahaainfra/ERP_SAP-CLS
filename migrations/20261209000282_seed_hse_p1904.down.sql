DELETE FROM ntf_templates WHERE code IN ('hse.observation.decided','hse.observation.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '19.04';
DELETE FROM ui_navigation_entries WHERE code IN ('hse-observation','hse-observations','hse-ppe-issue','hse-ppe-register','hse-equipment','hse-schedules','hse-contractor-scores');
DELETE FROM core_feature_flags WHERE key = 'ff.hse.p1904';
