DELETE FROM ntf_templates WHERE code IN ('plant.fuel.decided','plant.fuel.anomaly','plant.fuel.dip_missing') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '17.04';
DELETE FROM ui_navigation_entries WHERE code IN ('plant-fuel-issue','plant-fuel-dip','plant-fuel-issues','plant-fuel-tanks','plant-fuel-reports','plant-fuel-anomalies');
DELETE FROM core_feature_flags WHERE key = 'ff.plant.p1704';
