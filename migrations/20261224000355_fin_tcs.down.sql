DELETE FROM fin_accounts WHERE code = '230007' AND source_type = 'fin_d736' AND NOT EXISTS (SELECT 1 FROM fin_journal_lines l WHERE l.account_id = fin_accounts.id);
DROP TABLE IF EXISTS tcs_collections;
