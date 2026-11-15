DELETE FROM ntf_templates WHERE code IN ('bill.client_bill.decided','bill.client_bill.sent') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '22.03';
DELETE FROM ui_navigation_entries WHERE code IN ('bill-client-bills','bill-client-bill-new','bill-client-bill-abstract');
DELETE FROM core_feature_flags WHERE key = 'ff.bill.p2203';
