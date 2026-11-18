DELETE FROM ntf_templates WHERE code IN ('fin.revrec.decided', 'fin.revrec.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '23.10';
DELETE FROM ui_navigation_entries WHERE code IN ('fin-revrec', 'fin-project-ledger');
DELETE FROM fin_accounts WHERE code IN ('170010', '230020', '240010', '410090', '560020', '560030', '560031') AND source_type = 'fin_p2310' AND NOT EXISTS (SELECT 1 FROM fin_journal_lines l WHERE l.account_id = fin_accounts.id);
DELETE FROM core_feature_flags WHERE key = 'ff.fin.p2310';
