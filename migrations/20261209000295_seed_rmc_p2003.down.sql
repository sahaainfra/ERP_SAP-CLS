DELETE FROM ntf_templates WHERE code IN ('rmc.cost.alert','rmc.transfer_rate.decided') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '20.03';
DELETE FROM ui_navigation_entries WHERE code IN ('rmc-costing','rmc-cost-report','rmc-transfer-rates');
DELETE FROM core_feature_flags WHERE key = 'ff.rmc.p2003';
DELETE FROM ui_widgets WHERE code = 'rmc.cost_per_m3' AND source_type = 'reference_seed';
