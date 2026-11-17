DELETE FROM ui_page_migration WHERE migrated_in_part = '166.2';
DELETE FROM ui_navigation_entries WHERE code = 'admin-design-system-patterns';
DELETE FROM core_feature_flags WHERE key = 'ff.ui.p16602';
