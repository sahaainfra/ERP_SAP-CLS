DELETE FROM ntf_templates WHERE code IN ('bill.certification.decided','bill.tax_invoice.decided','bill.invoice.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '22.04';
DELETE FROM ui_navigation_entries WHERE code IN ('bill-certification-new','bill-certifications','bill-tax-invoices','bill-cert-analysis');
DELETE FROM core_feature_flags WHERE key = 'ff.bill.p2204';
