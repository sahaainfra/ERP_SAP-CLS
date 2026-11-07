DELETE FROM ui_page_migration WHERE migrated_in_part = '10.01';
DELETE FROM ui_navigation_entries WHERE code IN ('proj-projects', 'proj-wizard', 'g-proj-master');
DELETE FROM core_feature_flags WHERE key = 'ff.proj.p1001';
