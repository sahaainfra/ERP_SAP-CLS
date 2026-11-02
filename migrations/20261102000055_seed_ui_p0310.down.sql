DELETE FROM ui_page_migration WHERE source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE source_type = 'reference_seed' AND code = 'admin-migration';
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.ui.p0310';
