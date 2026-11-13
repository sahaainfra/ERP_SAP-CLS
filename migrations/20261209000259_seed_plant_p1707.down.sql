DELETE FROM ntf_templates WHERE code IN ('plant.fleet.decided','plant.fleet.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '17.07';
DELETE FROM ui_navigation_entries WHERE code IN ('plant-fleet-tower','plant-owning-cost','plant-replacement');
DELETE FROM core_feature_flags WHERE key = 'ff.plant.p1707';
