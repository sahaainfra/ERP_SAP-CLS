DELETE FROM ui_page_migration WHERE migrated_in_part = '08.03';
DELETE FROM ui_navigation_entries WHERE code IN ('bd-credentials','bd-emd','bd-competitors','bd-awards');
DELETE FROM core_feature_flags WHERE key = 'ff.bd.p0803';
