DELETE FROM ui_field_tiles WHERE source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE source_type = 'reference_seed' AND code IN ('field-home', 'field-scan');
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.ui.p0306';
