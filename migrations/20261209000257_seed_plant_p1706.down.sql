DELETE FROM ntf_templates WHERE code IN ('plant.hire.decided','plant.hire.bill','plant.hire.expiring') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '17.06';
DELETE FROM ui_navigation_entries WHERE code IN ('plant-hire-agreements','plant-hire-bill','plant-hire-comparison');
DELETE FROM core_feature_flags WHERE key = 'ff.plant.p1706';
