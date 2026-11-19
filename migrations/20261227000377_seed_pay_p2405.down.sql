DELETE FROM ntf_templates WHERE code IN ('pay.fnf.decided', 'pay.settle.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '24.05';
DELETE FROM ui_navigation_entries WHERE code IN ('pay-posting', 'pay-fnf', 'pay-my-payslips');
DELETE FROM core_feature_flags WHERE key = 'ff.pay.p2405';
DELETE FROM pay_fnf_rules WHERE source_type = 'reference_seed' AND created_by = 'migration';
DELETE FROM fin_posting_rules WHERE company_id IS NULL AND doc_no LIKE 'PRL/P2405-%' AND source_type = 'reference_seed';
DELETE FROM fin_accounts WHERE code IN ('230010', '230011', '230012', '230013', '230014', '230015', '240011', '530003', '530004', '420010', '160003') AND source_type = 'pay_p2405' AND NOT EXISTS (SELECT 1 FROM fin_journal_lines l WHERE l.account_id = fin_accounts.id);
