DELETE FROM ntf_templates WHERE code IN ('plant.rp.decided','plant.rp.shortage') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '17.08';
DELETE FROM ui_navigation_entries WHERE code IN ('plant-capacity','plant-shortage','plant-resource-plans');
DELETE FROM core_feature_flags WHERE key = 'ff.plant.p1708';
