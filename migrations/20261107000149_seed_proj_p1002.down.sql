DELETE FROM ui_page_migration WHERE migrated_in_part = '10.02';
DELETE FROM ui_navigation_entries WHERE code IN ('proj-from-award', 'proj-baseline-packs', 'proj-baseline-compare');
DELETE FROM core_feature_flags WHERE key = 'ff.proj.p1002';
