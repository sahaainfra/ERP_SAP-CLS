DELETE FROM ui_page_migration WHERE source_type = 'reference_seed' AND migrated_in_part = '04.12';
DELETE FROM ui_navigation_entries WHERE source_type = 'reference_seed' AND code = 'admin-signatures';
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.eng.p0412';
