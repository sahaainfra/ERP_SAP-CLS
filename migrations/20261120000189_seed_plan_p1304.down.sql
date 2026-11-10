DELETE FROM ntf_templates WHERE code IN ('plan.weekly_plan.approved', 'plan.weekly_plan.rejected') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '13.04';
DELETE FROM ui_navigation_entries WHERE code IN ('plan-lookahead', 'plan-constraints', 'plan-weekly');
DELETE FROM core_feature_flags WHERE key = 'ff.plan.p1304';
