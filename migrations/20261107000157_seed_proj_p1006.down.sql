DELETE FROM ui_page_migration WHERE migrated_in_part = '10.06';
DELETE FROM ui_navigation_entries WHERE code IN ('proj-risk-dashboard', 'proj-risks', 'proj-issues');
DELETE FROM core_feature_flags WHERE key = 'ff.proj.p1006';
DELETE FROM alr_alerts WHERE rule_code = 'risk.trigger_fired';
DELETE FROM alr_rules WHERE code = 'risk.trigger_fired';
