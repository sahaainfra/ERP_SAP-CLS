DELETE FROM ntf_templates WHERE code IN ('hse.permit.decided','hse.permit.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '19.02';
DELETE FROM ui_navigation_entries WHERE code IN ('hse-permit-request','hse-permit-approvals','hse-permit-board','hse-permits','hse-permit-types');
DELETE FROM core_feature_flags WHERE key = 'ff.hse.p1902';
