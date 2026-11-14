DELETE FROM ntf_templates WHERE code IN ('plant.log.decided','plant.breakdown.reported','plant.log.anomaly') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '17.03';
DELETE FROM ui_navigation_entries WHERE code IN ('plant-log-entry','plant-logs','plant-log-verification','plant-utilisation');
DELETE FROM core_feature_flags WHERE key = 'ff.plant.p1703';
