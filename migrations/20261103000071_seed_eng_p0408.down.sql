DELETE FROM ui_page_migration WHERE source_type = 'reference_seed' AND migrated_in_part = '04.08';
DELETE FROM ui_navigation_entries WHERE source_type = 'reference_seed' AND code IN ('tasks-my','tasks-task','tasks-new','tasks-team','admin-task-routing');
DELETE FROM ntf_templates WHERE source_type = 'reference_seed' AND code IN ('tsk.task.assigned','tsk.task.reminder','tsk.task.escalated','tsk.task.verify','tsk.task.reopened');
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.eng.p0408';
