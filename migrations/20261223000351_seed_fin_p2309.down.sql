DELETE FROM ntf_templates WHERE code IN ('fin.fa.decided','fin.fa.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '23.09';
DELETE FROM ui_navigation_entries WHERE code IN ('fin-assets','fin-assets-work');
DELETE FROM fa_classes WHERE source_type = 'reference_seed_p2309';
DELETE FROM fin_accounts WHERE code IN ('110003','110004','110005','110006','119001','119002','119003','119004','119005','119006','160010','420002','560013') AND source_type = 'fin_p2309' AND NOT EXISTS (SELECT 1 FROM fin_journal_lines l WHERE l.account_id = fin_accounts.id);
DELETE FROM core_feature_flags WHERE key = 'ff.fin.p2309';
