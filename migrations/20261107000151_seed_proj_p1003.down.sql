DELETE FROM ui_page_migration WHERE migrated_in_part = '10.03';
DELETE FROM ui_navigation_entries WHERE code IN ('proj-wbs-editor', 'proj-locations', 'proj-work-packages');
DELETE FROM core_feature_flags WHERE key = 'ff.proj.p1003';
