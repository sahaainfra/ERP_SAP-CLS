DELETE FROM ntf_templates WHERE code IN ('hse.camp.alert','hse.recovery.decided') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '19.07';
DELETE FROM ui_navigation_entries WHERE code IN ('camp-occupancy','camp-allocation','camp-inspections','camp-mess','camp-setup');
DELETE FROM core_feature_flags WHERE key = 'ff.hse.p1907';
