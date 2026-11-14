DELETE FROM ntf_templates WHERE code IN ('plant.job.decided','plant.pm.due','plant.job.spares') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '17.05';
DELETE FROM ui_navigation_entries WHERE code IN ('plant-maintenance','plant-pm-schedule','plant-job-cards');
DELETE FROM core_feature_flags WHERE key = 'ff.plant.p1705';
