DELETE FROM ui_widgets WHERE source_type = 'reference_seed' AND code = 'workflow.inbox';
DELETE FROM ui_page_migration WHERE source_type = 'reference_seed' AND migrated_in_part = '04.03';
DELETE FROM ui_navigation_entries WHERE source_type = 'reference_seed' AND code IN ('approvals-inbox', 'approvals-task', 'approvals-submissions', 'field-approvals');
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.eng.p0403';
