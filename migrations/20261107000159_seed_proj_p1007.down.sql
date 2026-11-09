DELETE FROM ui_page_migration WHERE migrated_in_part = '10.07';
DELETE FROM ui_navigation_entries WHERE code IN ('proj-map', 'proj-strip-chart', 'proj-gis-config');
DELETE FROM core_feature_flags WHERE key = 'ff.proj.p1007';
