DELETE FROM ntf_templates WHERE code IN ('bill.sub_bill.decided','bill.sub_bill.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '22.05';
DELETE FROM ui_navigation_entries WHERE code IN ('bill-sub-measure','bill-sub-bills','bill-sub-bill-new');
DELETE FROM core_feature_flags WHERE key = 'ff.bill.p2205';
