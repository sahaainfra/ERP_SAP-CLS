DELETE FROM plan_templates WHERE company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM ntf_templates WHERE code IN ('plan.schedule.approved', 'plan.schedule.rejected') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '13.01';
DELETE FROM ui_navigation_entries WHERE code IN ('g-plan', 'plan-schedules', 'plan-activities', 'plan-generate', 'plan-critical', 'plan-calendars');
DELETE FROM core_feature_flags WHERE key = 'ff.plan.p1301';
