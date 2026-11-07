DELETE FROM ui_page_migration WHERE migrated_in_part = '09.03';
DELETE FROM ui_navigation_entries WHERE code IN ('est-review', 'est-bid-price');
DELETE FROM core_feature_flags WHERE key = 'ff.est.p0903';
