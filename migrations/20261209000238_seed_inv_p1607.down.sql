DELETE FROM ntf_templates WHERE code IN ('inv.reorder.suggested','inv.reorder.decided') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '16.07';
DELETE FROM ui_navigation_entries WHERE code IN ('inv-reorder-params','inv-reorder-suggestions','inv-ageing','inv-labels');
DELETE FROM core_feature_flags WHERE key = 'ff.inv.p1607';
