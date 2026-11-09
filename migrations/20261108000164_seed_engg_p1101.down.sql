DELETE FROM ntf_templates WHERE code = 'engg.drawing.superseded' AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '11.01';
DELETE FROM ui_navigation_entries WHERE code IN ('engg-dashboard', 'engg-drawings', 'engg-transmittals', 'engg-site', 'g-engg');
DELETE FROM core_feature_flags WHERE key = 'ff.engg.p1101';
