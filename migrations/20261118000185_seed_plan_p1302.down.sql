DELETE FROM ui_page_migration WHERE migrated_in_part = '13.02';
DELETE FROM ui_navigation_entries WHERE code IN ('plan-gantt', 'plan-histogram', 'plan-programme');
DELETE FROM core_feature_flags WHERE key = 'ff.plan.p1302';
