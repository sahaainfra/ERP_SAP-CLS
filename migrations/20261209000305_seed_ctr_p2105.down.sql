DELETE FROM ntf_templates WHERE code IN ('ctr.change.decided','ctr.variation.decided','ctr.variation.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '21.05';
DELETE FROM ui_navigation_entries WHERE code IN ('ctr-variations','ctr-variation-summary');
DELETE FROM core_feature_flags WHERE key = 'ff.ctr.p2105';
