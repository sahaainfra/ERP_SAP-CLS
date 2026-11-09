DELETE FROM ntf_templates WHERE code IN ('engg.rfi.responded', 'engg.rfi.overdue') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '11.02';
DELETE FROM ui_navigation_entries WHERE code IN ('engg-rfi-dashboard', 'engg-rfis', 'engg-rfi-raise');
DELETE FROM core_feature_flags WHERE key = 'ff.engg.p1102';
