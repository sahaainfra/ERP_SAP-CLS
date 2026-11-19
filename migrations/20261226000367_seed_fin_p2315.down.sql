DELETE FROM ntf_templates WHERE code IN ('fin.ic.decided', 'fin.ic.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '23.15';
DELETE FROM ui_navigation_entries WHERE code IN ('fin-ic', 'fin-ic-recon', 'fin-consolidation', 'fin-jv');
DELETE FROM fin_accounts WHERE code IN ('160090', '230090') AND source_type = 'fin_p2315' AND NOT EXISTS (SELECT 1 FROM fin_journal_lines l WHERE l.account_id = fin_accounts.id);
DELETE FROM core_feature_flags WHERE key = 'ff.fin.p2315';
