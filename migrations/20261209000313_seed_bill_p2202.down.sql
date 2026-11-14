DELETE FROM ntf_templates WHERE code IN ('bill.deviation_statement.decided','bill.qty.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '22.02';
DELETE FROM ui_navigation_entries WHERE code IN ('bill-qty-recon','bill-qty-limits','bill-deviations');
DELETE FROM core_feature_flags WHERE key = 'ff.bill.p2202';
