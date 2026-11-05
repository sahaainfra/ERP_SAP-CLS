DELETE FROM ui_page_migration WHERE source_type = 'reference_seed' AND migrated_in_part = '04.15';
DELETE FROM ui_navigation_entries WHERE source_type = 'reference_seed' AND (code IN ('field-forms', 'field-sync', 'field-conflicts', 'admin-devices') OR route IN ('/field/forms', '/field/sync', '/field/sync/conflicts', '/admin/devices'));
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.eng.p0415';
