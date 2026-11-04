DELETE FROM ui_page_migration WHERE source_type = 'reference_seed' AND migrated_in_part = '04.09';
DELETE FROM ui_navigation_entries WHERE source_type = 'reference_seed' AND code IN ('alerts-centre', 'admin-alert-rules', 'admin-alert-rule-editor');
DELETE FROM alr_rules WHERE source_type = 'reference_seed' AND status = 'LIBRARY';
DELETE FROM ntf_templates WHERE source_type = 'reference_seed' AND code = 'alr.alert';
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.eng.p0409';
