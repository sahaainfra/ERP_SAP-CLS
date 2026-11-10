DELETE FROM ntf_templates WHERE code IN ('plan.delay.approved', 'plan.delay.rejected') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '13.05';
DELETE FROM ui_navigation_entries WHERE code IN ('plan-delays', 'plan-tia', 'plan-delay-summary');
DELETE FROM core_feature_flags WHERE key = 'ff.plan.p1305';
