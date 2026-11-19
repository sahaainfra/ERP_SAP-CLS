DELETE FROM pay_statutory_params WHERE company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM pay_components WHERE company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM ntf_templates WHERE code IN ('pay.decided', 'pay.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '24.01';
DELETE FROM ui_navigation_entries WHERE code IN ('pay-components', 'pay-assignments', 'pay-statutory', 'pay-calendar', 'g-payroll');
DELETE FROM core_feature_flags WHERE key = 'ff.pay.p2401';
