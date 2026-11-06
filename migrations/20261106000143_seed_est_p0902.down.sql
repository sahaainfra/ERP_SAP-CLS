DELETE FROM ui_page_migration WHERE migrated_in_part = '09.02';
DELETE FROM ui_navigation_entries WHERE code IN ('est-takeoffs', 'est-bbs', 'est-bbs-summary', 'est-mto-delta', 'est-mto-explosion');
DELETE FROM core_feature_flags WHERE key = 'ff.est.p0902';
