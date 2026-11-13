DELETE FROM ui_page_migration WHERE migrated_in_part = '16.11';
DELETE FROM ui_navigation_entries WHERE code IN ('inv-materials-dashboard','inv-material-funnel');
DELETE FROM core_feature_flags WHERE key = 'ff.inv.p1611';
