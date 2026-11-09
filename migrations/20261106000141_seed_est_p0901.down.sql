DELETE FROM ui_page_migration WHERE migrated_in_part = '09.01';
DELETE FROM ui_navigation_entries WHERE code IN ('est-estimates', 'est-import', 'est-compare', 'est-resources', 'g-est');
DELETE FROM core_feature_flags WHERE key = 'ff.est.p0901';
