DELETE FROM ui_navigation_entries WHERE source_type = 'reference_seed' AND code = 'admin-translations';
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.ui.p0309';
