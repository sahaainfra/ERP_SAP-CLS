DELETE FROM ntf_templates WHERE code IN ('plant.equipment.decided','plant.certificate.due') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '17.01';
DELETE FROM ui_navigation_entries WHERE code IN ('plant-dashboard','plant-equipment','plant-equipment-new');
DELETE FROM core_feature_flags WHERE key = 'ff.plant.p1701';
