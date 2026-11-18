DELETE FROM ntf_templates WHERE code IN ('fin.itc.decided','fin.gst_recon.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '23.08';
DELETE FROM ui_navigation_entries WHERE code IN ('fin-gst-recon','fin-gst-returns');
DELETE FROM mdm_statutory_calendar WHERE source_type = 'reference_seed_p2308';
DELETE FROM fin_accounts WHERE code = '560011' AND source_type = 'fin_p2308' AND NOT EXISTS (SELECT 1 FROM fin_journal_lines l WHERE l.account_id = fin_accounts.id);
DELETE FROM core_feature_flags WHERE key = 'ff.fin.p2308';
