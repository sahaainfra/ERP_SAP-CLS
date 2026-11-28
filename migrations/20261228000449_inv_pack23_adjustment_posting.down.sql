DELETE FROM fin_posting_rules WHERE doc_no IN ('PRL/P2301', 'PRL/P2302') AND company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM fin_accounts WHERE code IN ('560040', '420021') AND source_type = 'inv_pack23' AND NOT EXISTS (SELECT 1 FROM fin_journal_lines l WHERE l.account_id = fin_accounts.id);
DELETE FROM core_feature_flags WHERE key = 'ff.inv.pack23';
