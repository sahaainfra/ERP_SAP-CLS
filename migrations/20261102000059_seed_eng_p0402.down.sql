DELETE FROM ui_page_migration WHERE source_type = 'reference_seed' AND migrated_in_part = '04.02';
DELETE FROM ui_navigation_entries WHERE source_type = 'reference_seed' AND code IN ('admin-approval-matrix', 'admin-matrix-editor', 'admin-authority-limits', 'admin-approval-simulator', 'workflow-delegations', 'admin-escalation');
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.eng.p0402';
