DELETE FROM ntf_templates WHERE code IN ('plan.baseline.approved', 'plan.baseline.rejected') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '13.03';
DELETE FROM ui_navigation_entries WHERE code IN ('plan-import', 'plan-baselines', 'plan-variance');
DELETE FROM core_feature_flags WHERE key = 'ff.plan.p1303';
