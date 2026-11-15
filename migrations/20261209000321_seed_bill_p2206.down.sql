DELETE FROM ntf_templates WHERE code IN ('bill.vendor_invoice.decided','bill.vendor_invoice.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '22.06';
DELETE FROM ui_navigation_entries WHERE code IN ('bill-vendor-invoices','bill-vendor-invoice-new','bill-invoice-hub');
DELETE FROM core_feature_flags WHERE key = 'ff.bill.p2206';
