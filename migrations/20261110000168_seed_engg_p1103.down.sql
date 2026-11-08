DELETE FROM ntf_templates WHERE code = 'engg.submittal.responded' AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '11.03';
DELETE FROM ui_navigation_entries WHERE code IN ('engg-submittals', 'engg-submittal-schedule');
DELETE FROM core_feature_flags WHERE key = 'ff.engg.p1103';
