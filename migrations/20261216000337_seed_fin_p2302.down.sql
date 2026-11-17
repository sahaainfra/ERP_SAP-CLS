DELETE FROM fin_posting_rules WHERE company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM ntf_templates WHERE code IN ('fin.posting.failed','fin.posting_rule.decided','fin.replay.decided') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '23.02';
DELETE FROM ui_navigation_entries WHERE code IN ('fin-posting-rules','fin-failed-postings','fin-posting-replay','fin-reconciliation');
DELETE FROM core_feature_flags WHERE key = 'ff.fin.p2302';
DELETE FROM fin_accounts WHERE code = '240002' AND source_type = 'fin_p2302';
