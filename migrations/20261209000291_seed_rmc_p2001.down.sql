DELETE FROM ntf_templates WHERE code IN ('rmc.plant.alert','rmc.plant.decided','rmc.mix_design.decided') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '20.01';
DELETE FROM ui_navigation_entries WHERE code IN ('rmc-plants','rmc-mix-designs');
DELETE FROM core_feature_flags WHERE key = 'ff.rmc.p2001';
DELETE FROM ui_navigation_entries WHERE code = 'g-rmc';
