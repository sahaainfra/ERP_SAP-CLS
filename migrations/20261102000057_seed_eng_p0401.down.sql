DELETE FROM ui_page_migration WHERE source_type = 'reference_seed' AND migrated_in_part = '04.01';
DELETE FROM ui_navigation_entries WHERE source_type = 'reference_seed' AND code IN ('admin-workflows', 'admin-workflow-monitor', 'eng-sample-docs', 'workflow-instance', 'admin-workflow-editor');
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key IN ('ff.eng.p0401', 'ff.eng.p0401.legacy.ui_translation_change');
