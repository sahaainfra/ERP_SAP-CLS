DELETE FROM ntf_templates WHERE source_type = 'reference_seed' AND code IN ('mdm.request.decided', 'mdm.duplicate.found');
DELETE FROM ui_page_migration WHERE source_type = 'reference_seed' AND migrated_in_part = '06.01';
DELETE FROM ui_navigation_entries WHERE source_type = 'reference_seed' AND code IN ('mdm-governance', 'mdm-requests', 'mdm-duplicates', 'mdm-quality', 'mdm-records');
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.mdm.p0601';
