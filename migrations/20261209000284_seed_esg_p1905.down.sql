DELETE FROM ntf_templates WHERE code IN ('hse.esg.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '19.05';
DELETE FROM ui_navigation_entries WHERE code IN ('esg-dashboard','esg-entry','esg-waste','esg-carbon','esg-consents','esg-factors');
DELETE FROM core_feature_flags WHERE key = 'ff.hse.p1905';
