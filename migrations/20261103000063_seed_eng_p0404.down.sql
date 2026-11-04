DELETE FROM ui_widgets WHERE source_type = 'reference_seed' AND code = 'controls.exceptions';
DELETE FROM ui_page_migration WHERE source_type = 'reference_seed' AND migrated_in_part = '04.04';
DELETE FROM ui_navigation_entries WHERE source_type = 'reference_seed' AND code IN ('admin-controls', 'admin-reason-codes', 'controls-exceptions', 'controls-dashboard');
DELETE FROM pcs_reason_codes WHERE source_type = 'reference_seed';
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.eng.p0404';
