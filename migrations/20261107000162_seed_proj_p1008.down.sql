DELETE FROM ui_widgets WHERE code IN ('proj.risks.critical', 'proj.milestones.late', 'proj.map.located') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '10.08';
DELETE FROM ui_navigation_entries WHERE code = 'proj-portfolio';
DELETE FROM proj_360_widgets WHERE source_type = 'reference_seed';
DELETE FROM core_feature_flags WHERE key = 'ff.proj.p1008';
