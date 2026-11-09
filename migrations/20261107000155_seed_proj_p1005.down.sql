DELETE FROM ntf_templates WHERE code = 'proj.mom.issued' AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '10.05';
DELETE FROM ui_navigation_entries WHERE code IN ('proj-team', 'proj-stakeholders', 'proj-meetings', 'proj-action-tracker');
DELETE FROM core_feature_flags WHERE key = 'ff.proj.p1005';
