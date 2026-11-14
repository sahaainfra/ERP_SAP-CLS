DELETE FROM ntf_templates WHERE code IN ('ctr.wo.decided','ctr.wo.accepted') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '21.03';
DELETE FROM ui_navigation_entries WHERE code IN ('ctr-work-orders','ctr-wo-margin');
DELETE FROM core_feature_flags WHERE key = 'ff.ctr.p2103';
