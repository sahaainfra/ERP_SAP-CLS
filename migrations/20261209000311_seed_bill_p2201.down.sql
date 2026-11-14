DELETE FROM ntf_templates WHERE code IN ('bill.mb_entry.decided','bill.mb.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '22.01';
DELETE FROM ui_navigation_entries WHERE code IN ('bill-mb-record','bill-mb-entries','bill-mb-abstract');
DELETE FROM core_feature_flags WHERE key = 'ff.bill.p2201';
