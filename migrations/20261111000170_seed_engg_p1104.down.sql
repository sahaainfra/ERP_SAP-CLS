DELETE FROM ui_page_migration WHERE migrated_in_part = '11.04';
DELETE FROM ui_navigation_entries WHERE code IN ('engg-progress', 'engg-deliverables', 'engg-vdr');
DELETE FROM core_feature_flags WHERE key = 'ff.engg.p1104';
